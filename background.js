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

  if (message.type === 'fetchSquadratsForNav') {
    (async () => {
      try {
        const uid = message.uid;
        const routeCoords = message.routeCoords;
        if (!uid || !routeCoords?.length) {
          sendResponse({ error: 'missing uid or route' });
          return;
        }
        const full = await fetchSquadratsData(uid);
        if (full?.error || !full?.raw) {
          sendResponse({ error: full?.error || 'no raw' });
          return;
        }
        const filtered = squadratsRawForNavRoute(full.raw, routeCoords);
        if (!filtered) {
          sendResponse({ error: 'filter empty' });
          return;
        }
        sendResponse({ raw: filtered });
      } catch (e) {
        sendResponse({ error: String(e) });
      }
    })();
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

function tile2latSq(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (1 << z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tile2lonSq(x, z) {
  return x / (1 << z) * 360 - 180;
}

function tileCenterFromSquadratKey(key, z) {
  const parts = String(key).split('-').map(Number);
  if (parts.length !== 2 || parts.some(n => Number.isNaN(n))) return null;
  const [x, y] = parts;
  return [
    (tile2latSq(y, z) + tile2latSq(y + 1, z)) / 2,
    (tile2lonSq(x, z) + tile2lonSq(x + 1, z)) / 2,
  ];
}

function routeBBoxDeg(routeCoords, padDeg) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const p of routeCoords) {
    const lat = p[0];
    const lng = p[1];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return {
    minLat: minLat - padDeg,
    maxLat: maxLat + padDeg,
    minLng: minLng - padDeg,
    maxLng: maxLng + padDeg,
  };
}

function filterSquadratKeys(rawSlice, z, bbox) {
  if (rawSlice == null) return [];
  const keys = Array.isArray(rawSlice) ? rawSlice : Object.keys(rawSlice);
  const out = [];
  for (const k of keys) {
    const c = tileCenterFromSquadratKey(k, z);
    if (!c) continue;
    if (c[0] < bbox.minLat || c[0] > bbox.maxLat || c[1] < bbox.minLng || c[1] > bbox.maxLng) continue;
    out.push(k);
  }
  return out;
}

/** Visited tile keys limited to a padded bbox around the route (for embedding in nav URL). */
function squadratsRawForNavRoute(raw, routeCoords) {
  if (!raw || !routeCoords?.length) return null;
  const padDeg = 0.06;
  const bbox = routeBBoxDeg(routeCoords, padDeg);
  const out = {};
  if (raw[14] != null) out[14] = filterSquadratKeys(raw[14], 14, bbox);
  if (raw[17] != null) out[17] = filterSquadratKeys(raw[17], 17, bbox);
  if (out[14] === undefined && out[17] === undefined) return null;
  return out;
}


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
