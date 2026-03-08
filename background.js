const tileCache = new Map();
const MAX_CACHE_SIZE = 500;

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('map.html') });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'fetchTile') {
    handleTileFetch(message.url).then(sendResponse);
    return true;
  }

  if (message.type === 'checkAuth') {
    checkStravaAuth().then(sendResponse);
    return true;
  }
});

async function getCloudFrontCookies() {
  const allCookies = await chrome.cookies.getAll({ domain: '.strava.com' });
  return allCookies.filter(c => c.name.startsWith('CloudFront-'));
}

async function checkStravaAuth() {
  try {
    const cfCookies = await getCloudFrontCookies();
    const hasAuth = cfCookies.length >= 3;
    return { authenticated: hasAuth, cookieCount: cfCookies.length };
  } catch (err) {
    return { authenticated: false, error: err.message };
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function handleTileFetch(url) {
  if (tileCache.has(url)) {
    return { dataUrl: tileCache.get(url) };
  }

  try {
    const cfCookies = await getCloudFrontCookies();
    if (cfCookies.length === 0) {
      return { error: 'not_authenticated' };
    }

    const cookieStr = cfCookies.map(c => `${c.name}=${c.value}`).join('; ');

    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'Cookie': cookieStr }
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const buffer = await response.arrayBuffer();
    const dataUrl = `data:image/png;base64,${arrayBufferToBase64(buffer)}`;

    tileCache.set(url, dataUrl);
    if (tileCache.size > MAX_CACHE_SIZE) {
      const oldest = tileCache.keys().next().value;
      tileCache.delete(oldest);
    }

    return { dataUrl };
  } catch (err) {
    return { error: err.message };
  }
}
