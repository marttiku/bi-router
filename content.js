(() => {
  if (document.getElementById('strava-route-planner-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'strava-route-planner-btn';
  btn.title = 'Open Route Planner';
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12h4l3-9 4 18 3-9h4"/>
    </svg>
    <span>Plan Route</span>`;

  btn.addEventListener('click', () => {
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    const sport = params.get('sport') || 'ride';
    const color = params.get('gColor') || 'mobileblue';

    let lat = 59.3212, lng = 24.6635, zoom = 11;
    if (hash) {
      const parts = hash.replace('#', '').split('/');
      if (parts.length >= 3) {
        zoom = parseFloat(parts[0]) || zoom;
        lat = parseFloat(parts[1]) || lat;
        lng = parseFloat(parts[2]) || lng;
      }
    }

    const sportMap = { RideLike: 'ride', RunLike: 'run', WaterLike: 'water', WinterLike: 'winter' };
    const mappedSport = sportMap[sport] || 'all';

    chrome.runtime.sendMessage({
      type: 'openPlanner',
      hash: `${zoom}/${lat}/${lng}?sport=${mappedSport}&color=${color}`
    });
  });

  document.body.appendChild(btn);
})();
