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
});

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
