chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('map.html') });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'getStravaCookies') {
    chrome.cookies.getAll({ domain: '.strava.com' }).then(cookies => {
      const cf = {};
      for (const c of cookies) {
        if (c.name === 'CloudFront-Key-Pair-Id') cf.keyPairId = c.value;
        if (c.name === 'CloudFront-Policy') cf.policy = c.value;
        if (c.name === 'CloudFront-Signature') cf.signature = c.value;
      }
      const authenticated = !!(cf.keyPairId && cf.policy && cf.signature);
      sendResponse({ authenticated, ...cf });
    });
    return true;
  }
});
