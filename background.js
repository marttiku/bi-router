const TILE_AUTH_RULE_ID = 1;
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

  if (message.type === 'fetchSquadrats') {
    fetchSquadratsData(message.uid).then(sendResponse);
    return true;
  }

  if (message.type === 'getSquadratsUid') {
    chrome.storage.local.get(['squadrats_uid'], (result) => {
      sendResponse({ uid: result?.squadrats_uid || null });
    });
    return true;
  }

  if (message.type === 'squadratsUidCaptured') {
    if (message.uid) {
      chrome.storage.local.set({ squadrats_uid: message.uid });
    }
    return;
  }
});

const SQUADRATS_MAINFRAMES = [
  'https://mainframe-proxy-01.squadrats.com',
  'https://mainframe-proxy-02.squadrats.com',
];

async function fetchSquadratsData(uid) {
  if (!uid) return { error: 'No Squadrats UID' };

  for (const base of SQUADRATS_MAINFRAMES) {
    try {
      const resp = await fetch(
        `${base}/anonymous/squadrants/${uid}?planner=strava`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data?.raw) return { raw: data.raw, geojson: data.geojson };
    } catch { /* try next server */ }
  }

  return { error: 'Could not reach Squadrats servers' };
}

async function setupTileAuth() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.strava.com' });

    const hasCF = CF_COOKIES.every(name => cookies.some(c => c.name === name));
    if (!hasCF) {
      const missing = CF_COOKIES.filter(name => !cookies.some(c => c.name === name));
      return { authenticated: false, missing };
    }

    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [TILE_AUTH_RULE_ID],
      addRules: [{
        id: TILE_AUTH_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: 'Cookie',
            operation: 'set',
            value: cookieStr
          }]
        },
        condition: {
          urlFilter: '||content-*.strava.com/',
          resourceTypes: ['image', 'xmlhttprequest', 'other']
        }
      }]
    });

    return { authenticated: true };
  } catch (err) {
    return { authenticated: false, error: err.message };
  }
}
