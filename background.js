const TILE_AUTH_RULE_ID = 1;
const REQUIRED_COOKIES = [
  'CloudFront-Key-Pair-Id',
  'CloudFront-Policy',
  'CloudFront-Signature',
  '_strava_idcf'
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
      if (REQUIRED_COOKIES.includes(c.name)) {
        found[c.name] = c.value;
      }
    }

    const missing = REQUIRED_COOKIES.filter(n => !found[n]);
    if (missing.length > 0) {
      return { authenticated: false, missing };
    }

    const cookieStr = REQUIRED_COOKIES.map(n => `${n}=${found[n]}`).join('; ');

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
          urlFilter: '||content-*.strava.com/identified/',
          resourceTypes: ['image', 'xmlhttprequest', 'other']
        }
      }]
    });

    return { authenticated: true };
  } catch (err) {
    return { authenticated: false, error: err.message };
  }
}
