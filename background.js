const CF_COOKIES = [
  'CloudFront-Key-Pair-Id',
  'CloudFront-Policy',
  'CloudFront-Signature',
];

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('map.html') });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'openPlanner') {
    const url = chrome.runtime.getURL('map.html') + '#' + (message.hash || '');
    chrome.tabs.create({ url });
    return;
  }

  if (message.type === 'setupTileAuth') {
    setupTileAuth().then(sendResponse);
    return true;
  }
});

async function setupTileAuth() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.strava.com' });
    const found = {};
    for (const c of cookies) {
      if (CF_COOKIES.includes(c.name)) {
        found[c.name] = c.value;
      }
    }

    const missing = CF_COOKIES.filter(n => !found[n]);
    if (missing.length > 0) {
      return { authenticated: false, missing };
    }

    return {
      authenticated: true,
      keyPairId: found['CloudFront-Key-Pair-Id'],
      policy: found['CloudFront-Policy'],
      signature: found['CloudFront-Signature'],
    };
  } catch (err) {
    return { authenticated: false, error: err.message };
  }
}
