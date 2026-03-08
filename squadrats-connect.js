(() => {
  function captureUid() {
    const uid = window.localStorage.getItem('lastKnownUid');
    if (uid) {
      chrome.runtime.sendMessage({ type: 'squadratsUidCaptured', uid });
    }
  }

  captureUid();

  // The web app may set the UID after page load (SPA navigation), so poll briefly
  let attempts = 0;
  const interval = setInterval(() => {
    captureUid();
    if (++attempts >= 10) clearInterval(interval);
  }, 1000);
})();
