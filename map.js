/* global L, chrome */

// ── URL Params (passed from Strava heatmap page) ─────────────────
function parseHashParams() {
  const defaults = { lat: 59.3212, lng: 24.6635, zoom: 11, sport: null, color: null };
  const hash = window.location.hash.replace('#', '');
  if (!hash) return defaults;

  const [coordPart, queryPart] = hash.split('?');
  const parts = coordPart.split('/');
  if (parts.length >= 3) {
    defaults.zoom = parseFloat(parts[0]) || defaults.zoom;
    defaults.lat = parseFloat(parts[1]) || defaults.lat;
    defaults.lng = parseFloat(parts[2]) || defaults.lng;
  }
  if (queryPart) {
    const qs = new URLSearchParams(queryPart);
    defaults.sport = qs.get('sport');
    defaults.color = qs.get('color');
  }
  return defaults;
}

const initParams = parseHashParams();

// ── State ────────────────────────────────────────────────────────
let waypoints = [];
let deleteMode = false;
let routePolyline = null;
let routeCoordinates = [];
let stravaLayer = null;
let authenticated = false;
let bikeRoadsLayer = null;
let bikeRoadsData = null;
let gpsMarker = null;
let gpsFollowing = true;
let gpsWatchId = null;

// ── Map Setup ────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: true }).setView([initParams.lat, initParams.lng], Math.round(initParams.zoom));

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19
}).addTo(map);

// ── Strava Auth ──────────────────────────────────────────────────
async function setupAuth() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'setupTileAuth' }, resolve);
  });
}

async function checkAuth() {
  const el = document.getElementById('auth-status');
  const text = document.getElementById('auth-text');

  const result = await setupAuth();
  authenticated = result.authenticated;

  if (result.authenticated) {
    el.className = 'auth-badge connected';
    text.textContent = 'Connected to Strava';
    initHeatmap();
  } else if (result.error) {
    el.className = 'auth-badge disconnected';
    text.textContent = 'Auth error';
    showToast(`Auth setup failed: ${result.error}. Falling back to public tiles.`, 'error', 6000);
    initHeatmap();
  } else {
    el.className = 'auth-badge disconnected';
    const missingStr = result.missing?.join(', ') || 'cookies';
    text.textContent = 'Not logged into Strava';
    showToast(`Missing cookies: ${missingStr}. Visit strava.com/maps/global-heatmap while logged in, then reload.`, 'error', 8000);
    initHeatmap();
  }
}

// ── Heatmap Layer ────────────────────────────────────────────────
function getTileUrl() {
  const activity = document.getElementById('sport-select').value;
  const color = document.getElementById('color-select').value;

  if (authenticated) {
    return `https://content-a.strava.com/identified/globalheat/${activity}/${color}/{z}/{x}/{y}.png?v=19`;
  }
  return `https://content-a.strava.com/identified/globalheat/${activity}/${color}/{z}/{x}/{y}.png?v=19`;
}

function initHeatmap() {
  if (stravaLayer) map.removeLayer(stravaLayer);

  stravaLayer = L.tileLayer(getTileUrl(), {
    maxNativeZoom: authenticated ? 15 : 11,
    maxZoom: 19,
    minZoom: 2,
    opacity: parseInt(document.getElementById('opacity-slider').value) / 100,
    tileSize: 256,
    errorTileUrl: ''
  });

  stravaLayer.addTo(map);
}

// ── Waypoint Management ──────────────────────────────────────────
function createStartIcon() {
  return L.divIcon({
    className: 'waypoint-icon',
    html: '<div class="start-marker">▶</div>',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

function createNumberedIcon(number) {
  return L.divIcon({
    className: 'waypoint-icon',
    html: `<div class="waypoint-marker">${number}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function renumberWaypoints() {
  waypoints.forEach((wp, i) => {
    wp.marker.setIcon(i === 0 ? createStartIcon() : createNumberedIcon(i));
  });
}

function addWaypoint(latlng) {
  const id = Date.now() + Math.random();
  const icon = waypoints.length === 0 ? createStartIcon() : createNumberedIcon(waypoints.length);
  const marker = L.marker(latlng, {
    draggable: true,
    icon
  }).addTo(map);

  marker.on('dragend', () => scheduleRoute());

  marker.on('click', (e) => {
    if (deleteMode) {
      L.DomEvent.stopPropagation(e);
      removeWaypoint(id);
    }
  });

  marker.on('contextmenu', (e) => {
    L.DomEvent.stopPropagation(e);
    removeWaypoint(id);
  });

  waypoints.push({ id, marker });
  updateWaypointList();
  scheduleRoute();
  updateButtons();
}

function removeWaypoint(id) {
  const idx = waypoints.findIndex(w => w.id === id);
  if (idx === -1) return;

  map.removeLayer(waypoints[idx].marker);
  waypoints.splice(idx, 1);
  renumberWaypoints();
  updateWaypointList();
  scheduleRoute();
  updateButtons();
}

function clearAllWaypoints() {
  waypoints.forEach(w => map.removeLayer(w.marker));
  waypoints = [];
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  routeCoordinates = [];
  updateWaypointList();
  updateStats(null);
  updateButtons();
}

function undoLastWaypoint() {
  if (waypoints.length === 0) return;
  const last = waypoints[waypoints.length - 1];
  removeWaypoint(last.id);
}

function insertWaypointAt(latlng, index) {
  const id = Date.now() + Math.random();
  const icon = index === 0 ? createStartIcon() : createNumberedIcon(index);
  const marker = L.marker(latlng, { draggable: true, icon }).addTo(map);

  marker.on('dragend', () => scheduleRoute());
  marker.on('click', (e) => {
    if (deleteMode) {
      L.DomEvent.stopPropagation(e);
      removeWaypoint(id);
    }
  });
  marker.on('contextmenu', (e) => {
    L.DomEvent.stopPropagation(e);
    removeWaypoint(id);
  });

  waypoints.splice(index, 0, { id, marker });
  renumberWaypoints();
  updateWaypointList();
  scheduleRoute();
  updateButtons();
}

function findSegmentIndex(latlng) {
  if (waypoints.length < 2 || routeCoordinates.length < 2) return waypoints.length;

  const pt = [latlng.lat, latlng.lng];
  let minDist = Infinity, closestIdx = 0;
  for (let i = 0; i < routeCoordinates.length; i++) {
    const d = haversine(routeCoordinates[i], pt);
    if (d < minDist) { minDist = d; closestIdx = i; }
  }

  const wpIndices = waypoints.map(wp => {
    const ll = wp.marker.getLatLng();
    let best = 0, bestD = Infinity;
    for (let j = 0; j < routeCoordinates.length; j++) {
      const d = haversine(routeCoordinates[j], [ll.lat, ll.lng]);
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  });

  for (let i = 0; i < wpIndices.length - 1; i++) {
    if (closestIdx <= wpIndices[i + 1]) return i + 1;
  }
  return waypoints.length - 1;
}

let routeDragging = false;

function setupRouteDrag() {
  if (!routePolyline) return;

  let ghostMarker = null;

  routePolyline.on('mousedown', (e) => {
    if (deleteMode) return;
    L.DomEvent.stopPropagation(e.originalEvent);
    L.DomEvent.preventDefault(e.originalEvent);

    routeDragging = true;
    const insertIdx = findSegmentIndex(e.latlng);

    ghostMarker = L.marker(e.latlng, {
      icon: createNumberedIcon(insertIdx),
      zIndexOffset: 2000,
      opacity: 0.7,
    }).addTo(map);

    map.dragging.disable();

    function onMove(me) {
      ghostMarker.setLatLng(me.latlng);
    }

    function onUp() {
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      map.dragging.enable();

      const pos = ghostMarker.getLatLng();
      map.removeLayer(ghostMarker);
      ghostMarker = null;

      insertWaypointAt(pos, insertIdx);
      setTimeout(() => { routeDragging = false; }, 50);
    }

    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
  });
}

function returnToStart() {
  if (waypoints.length < 2) return;
  const startLatLng = waypoints[0].marker.getLatLng();
  addWaypoint(L.latLng(startLatLng.lat, startLatLng.lng));
}

function startFromCurrentLocation() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.', 'error');
    return;
  }

  showToast('Getting your location…', 'info');

  function applyStartLocation(latlng) {
    if (waypoints.length === 0) {
      addWaypoint(latlng);
    } else {
      const id = Date.now() + Math.random();
      const icon = createStartIcon();
      const marker = L.marker(latlng, { draggable: true, icon }).addTo(map);

      marker.on('dragend', () => scheduleRoute());
      marker.on('click', (e) => {
        if (deleteMode) {
          L.DomEvent.stopPropagation(e);
          removeWaypoint(id);
        }
      });
      marker.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e);
        removeWaypoint(id);
      });

      waypoints.unshift({ id, marker });
      renumberWaypoints();
      updateWaypointList();
      scheduleRoute();
      updateButtons();
    }

    map.setView(latlng, Math.max(map.getZoom(), 13));
    showToast('Start set to your current location.', 'success');
  }

  if (gpsMarker) {
    applyStartLocation(gpsMarker.getLatLng());
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => applyStartLocation(L.latLng(pos.coords.latitude, pos.coords.longitude)),
    (err) => {
      showToast(`Could not get location: ${err.message}`, 'error');
    },
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }
  );
}

// ── Waypoint List UI ─────────────────────────────────────────────
function updateWaypointList() {
  const container = document.getElementById('waypoint-list');

  if (waypoints.length === 0) {
    container.innerHTML = '<p class="empty-state">Click the map to add waypoints</p>';
    return;
  }

  container.innerHTML = waypoints.map((wp, i) => {
    const ll = wp.marker.getLatLng();
    const isStart = i === 0;
    const label = isStart ? '▶' : i;
    const cls = isStart ? 'waypoint-number start' : 'waypoint-number';
    return `
      <div class="waypoint-item" data-id="${wp.id}">
        <span class="${cls}">${label}</span>
        <span class="waypoint-coords">${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}</span>
        <button class="waypoint-remove" title="Remove waypoint">&#9632;</button>
      </div>`;
  }).join('');

  container.querySelectorAll('.waypoint-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseFloat(btn.closest('.waypoint-item').dataset.id);
      removeWaypoint(id);
    });
  });
}

// ── Routing via BRouter ──────────────────────────────────────────
async function fetchRoute(profile, lonlatPairs, signal) {
  try {
    const lonlats = lonlatPairs.map(([lng, lat]) => `${lng},${lat}`).join('|');
    const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;
    const resp = await fetch(url, { signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    const feat = data.features?.[0];
    if (!feat) return null;
    return {
      distance: parseFloat(feat.properties['track-length']),
      duration: parseFloat(feat.properties['total-time']),
      geometry: { coordinates: feat.geometry.coordinates.map(c => [c[0], c[1]]) }
    };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
  }
  return null;
}

let routeAbort = null;
let routeDebounce = null;

function scheduleRoute() {
  clearTimeout(routeDebounce);
  clearTimeout(optimizeDebounce);
  if (optimizeAbort) { optimizeAbort.abort(); optimizeAbort = null; }
  if (baseRoutePolyline) { map.removeLayer(baseRoutePolyline); baseRoutePolyline = null; }
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  routeCoordinates = [];
  baseRouteCoordinates = [];
  baseRouteDistanceKm = 0;

  if (waypoints.length < 2) {
    updateStats(null);
    updateButtons();
    if (sqNewLayer) sqNewLayer.setNewTiles(null, null);
    const statusEl = document.getElementById('detour-status');
    if (statusEl) statusEl.innerHTML = '';
    return;
  }

  routeDebounce = setTimeout(() => updateRoute(), 300);
}

async function updateRoute() {
  if (routeAbort) routeAbort.abort();

  const controller = new AbortController();
  routeAbort = controller;
  const signal = controller.signal;

  const lonlatPairs = waypoints.map(w => {
    const ll = w.marker.getLatLng();
    return [ll.lng, ll.lat];
  });

  try {
    const route = await fetchRoute('trekking', lonlatPairs, signal)
      || await fetchRoute('hiking-mountain', lonlatPairs, signal);

    if (routeAbort !== controller) return;

    if (!route) {
      showToast('Could not calculate route. Try adjusting waypoints.', 'error');
      updateStats(null);
      return;
    }

    routeCoordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

    baseRouteCoordinates = routeCoordinates.slice();
    baseRouteDistanceKm = route.distance / 1000;

    if (baseRoutePolyline) {
      map.removeLayer(baseRoutePolyline);
      baseRoutePolyline = null;
    }

    if (routePolyline) map.removeLayer(routePolyline);
    routePolyline = L.polyline(routeCoordinates, {
      color: '#fc4c02',
      weight: 4,
      opacity: 0.85,
      smoothFactor: 1,
      className: 'route-line'
    }).addTo(map);
    setupRouteDrag();

    updateStats(route);
    updateButtons();
    updateSqNewLayer();

    if (sqEnabled && sqRaw[SQINHO_ZOOM] && detourBudgetPct > 0) {
      scheduleOptimization();
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Routing error:', err);
    showToast('Routing failed. Check your connection.', 'error');
    updateStats(null);
  }
}

// ── Stats ────────────────────────────────────────────────────────
let lastRouteDistanceKm = 0;

function updateStats(route) {
  const distEl = document.getElementById('route-distance');
  const durEl = document.getElementById('route-duration');

  if (!route) {
    lastRouteDistanceKm = 0;
    distEl.textContent = '—';
    durEl.textContent = '—';
    return;
  }

  lastRouteDistanceKm = route.distance / 1000;
  distEl.textContent = lastRouteDistanceKm < 10
    ? `${lastRouteDistanceKm.toFixed(1)} km`
    : `${Math.round(lastRouteDistanceKm)} km`;

  updateDuration();
}

function updateDuration() {
  const durEl = document.getElementById('route-duration');
  if (lastRouteDistanceKm === 0) { durEl.textContent = '—'; return; }

  const speedKmh = parseInt(document.getElementById('speed-slider').value);
  const mins = Math.round((lastRouteDistanceKm / speedKmh) * 60);

  if (mins < 60) {
    durEl.textContent = `${mins} min`;
  } else {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    durEl.textContent = `${h}h ${m}m`;
  }
}

// ── Buttons ──────────────────────────────────────────────────────
function updateButtons() {
  const hasWp = waypoints.length > 0;
  document.getElementById('btn-undo').disabled = !hasWp;
  document.getElementById('btn-clear').disabled = !hasWp;
  document.getElementById('btn-delete-mode').disabled = !hasWp;
  document.getElementById('btn-return-start').disabled = waypoints.length < 2;
  document.getElementById('btn-export').disabled = routeCoordinates.length === 0;
  document.getElementById('btn-navigate').disabled = routeCoordinates.length < 2;
  document.getElementById('btn-navigate-dev').disabled = routeCoordinates.length < 2;
  document.getElementById('btn-share').disabled = routeCoordinates.length < 2;
  document.getElementById('btn-google').disabled = waypoints.length < 2;
  document.getElementById('btn-send-device').disabled = routeCoordinates.length < 2;

  if (!hasWp && deleteMode) toggleDeleteMode();
}

function toggleDeleteMode() {
  deleteMode = !deleteMode;
  const btn = document.getElementById('btn-delete-mode');
  btn.classList.toggle('active', deleteMode);
  document.getElementById('map').style.cursor = deleteMode ? 'crosshair' : '';
}

// ── Polyline Encoding & Route Simplification ─────────────────────
function encodePolyline(coords) {
  let prev = [0, 0], out = '';
  for (const [lat, lng] of coords) {
    const rounded = [Math.round(lat * 1e5), Math.round(lng * 1e5)];
    for (const val of [rounded[0] - prev[0], rounded[1] - prev[1]]) {
      let v = val < 0 ? ~(val << 1) : (val << 1);
      while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      out += String.fromCharCode(v + 63);
    }
    prev = rounded;
  }
  return out;
}

function perpendicularDist(pt, a, b) {
  const [x, y] = pt, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function douglasPeucker(pts, epsilon) {
  if (pts.length <= 2) return pts;
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist <= epsilon) return [pts[0], pts[pts.length - 1]];
  const left = douglasPeucker(pts.slice(0, maxIdx + 1), epsilon);
  const right = douglasPeucker(pts.slice(maxIdx), epsilon);
  return left.slice(0, -1).concat(right);
}

const MAX_NAV_ENCODED_LEN = 2800;
const MAX_NAV_URL_CHARS = 4500;
const MAX_NAV_SQD_CHARS = 2600;

function encodeNavSqdPayload(obj) {
  try {
    const s = JSON.stringify(obj);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

async function buildNavSquadratsParam(coords, uid) {
  if (!uid || coords.length < 2) return '';
  try {
    const res = await new Promise(resolve =>
      chrome.runtime.sendMessage(
        { type: 'fetchSquadratsForNav', uid, routeCoords: coords },
        resolve
      )
    );
    if (!res?.raw) return '';

    let packed = encodeNavSqdPayload(res.raw);
    if (packed.length > MAX_NAV_SQD_CHARS) {
      packed = encodeNavSqdPayload({ 14: res.raw[14] || [] });
    }
    if (packed.length > MAX_NAV_SQD_CHARS) {
      const keys = res.raw[14] || [];
      let n = Math.max(1, Math.floor((MAX_NAV_SQD_CHARS - 24) / 12));
      while (n > 0 && encodeNavSqdPayload({ 14: keys.slice(0, n) }).length > MAX_NAV_SQD_CHARS) {
        n = Math.floor(n * 0.85);
      }
      if (n < 1) return '';
      packed = encodeNavSqdPayload({ 14: keys.slice(0, n) });
    }
    if (packed.length > MAX_NAV_SQD_CHARS) return '';
    return packed;
  } catch {
    return '';
  }
}

async function buildNavLinkWithHash(basePrefix, coords, uid, extraHashSuffix) {
  let pts = coords;
  let epsilon = 0.00001;
  let encoded = encodePolyline(pts);
  while (encoded.length > MAX_NAV_ENCODED_LEN && epsilon < 0.01) {
    epsilon *= 2;
    pts = douglasPeucker(coords, epsilon);
    encoded = encodePolyline(pts);
  }

  const sqd = uid ? await buildNavSquadratsParam(coords, uid) : '';

  function makeUrl(enc, sqdPart) {
    let tail = extraHashSuffix || '';
    if (uid) tail += `&uid=${encodeURIComponent(uid)}`;
    if (sqdPart) tail += `&sqd=${sqdPart}`;
    return `${basePrefix}#${encodeURIComponent(enc)}${tail}`;
  }

  let url = makeUrl(encoded, sqd);
  while (url.length > MAX_NAV_URL_CHARS && epsilon < 0.05) {
    epsilon *= 1.5;
    pts = douglasPeucker(coords, epsilon);
    encoded = encodePolyline(pts);
    url = makeUrl(encoded, sqd);
  }
  if (url.length > MAX_NAV_URL_CHARS && sqd) {
    url = makeUrl(encoded, '');
    while (url.length > MAX_NAV_URL_CHARS && epsilon < 0.08) {
      epsilon *= 1.5;
      pts = douglasPeucker(coords, epsilon);
      encoded = encodePolyline(pts);
      url = makeUrl(encoded, '');
    }
  }
  return url;
}

async function buildNavUrl(coords, uidOverride = null) {
  const uid = uidOverride || sqRaw._uid;
  return buildNavLinkWithHash(
    'https://marttiku.github.io/bi-router/nav.html',
    coords,
    uid,
    ''
  );
}

async function buildDevNavUrl(coords, uidOverride = null) {
  const uid = uidOverride || sqRaw._uid;
  return buildNavLinkWithHash(
    'http://localhost:8080/nav.html',
    coords,
    uid,
    '&dev=1'
  );
}

async function ensureSquadratsUid() {
  if (sqRaw._uid) return sqRaw._uid;
  try {
    const result = await new Promise(resolve =>
      chrome.runtime.sendMessage({ type: 'getSquadratsUid' }, resolve)
    );
    if (result?.uid) {
      sqRaw._uid = result.uid;
      return result.uid;
    }
  } catch {
    // Extension messaging may be unavailable outside extension context.
  }
  return null;
}

// ── GPX Export ───────────────────────────────────────────────────
function exportGPX() {
  if (routeCoordinates.length === 0) return;

  const now = new Date().toISOString();
  const trackpoints = routeCoordinates
    .map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
    .join('\n');

  const waypointXml = waypoints
    .map((wp, i) => {
      const ll = wp.marker.getLatLng();
      const name = i === 0 ? 'Start' : i === waypoints.length - 1 ? 'Finish' : `Waypoint ${i + 1}`;
      return `  <wpt lat="${ll.lat}" lon="${ll.lng}"><name>${name}</name></wpt>`;
    })
    .join('\n');

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Strava Heatmap Route Planner">
  <metadata>
    <name>Planned Route</name>
    <time>${now}</time>
  </metadata>
${waypointXml}
  <trk>
    <name>Planned Route</name>
    <trkseg>
${trackpoints}
    </trkseg>
  </trk>
</gpx>`;

  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `route-${new Date().toISOString().slice(0, 10)}.gpx`;
  a.click();
  URL.revokeObjectURL(url);

  showToast('GPX exported! Import it into Google My Maps.', 'success');
}

// ── Google Maps Navigation ───────────────────────────────────────
function openInGoogleMaps() {
  const url = buildGoogleMapsUrl();
  if (url) window.open(url, '_blank');
}

// ── Send to Phone (QR Code) ──────────────────────────────────────
function buildGoogleMapsUrl() {
  if (waypoints.length < 2) return null;

  const startLL = waypoints[0].marker.getLatLng();
  const endLL = waypoints[waypoints.length - 1].marker.getLatLng();
  const origin = `${startLL.lat},${startLL.lng}`;
  const destination = `${endLL.lat},${endLL.lng}`;

  const maxWaypoints = 23;
  let intermediatePoints = [];

  if (routeCoordinates.length > 2) {
    const step = Math.max(1, Math.floor(routeCoordinates.length / (maxWaypoints + 1)));
    for (let i = step; i < routeCoordinates.length - 1; i += step) {
      if (intermediatePoints.length >= maxWaypoints) break;
      const [lat, lng] = routeCoordinates[i];
      intermediatePoints.push(`${lat},${lng}`);
    }
  } else {
    intermediatePoints = waypoints.slice(1, -1).map(w => {
      const ll = w.marker.getLatLng();
      return `${ll.lat},${ll.lng}`;
    });
  }

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
  if (intermediatePoints.length > 0) {
    url += `&waypoints=${intermediatePoints.join('|')}`;
  }
  return url;
}

async function sendToDevice() {
  if (routeCoordinates.length < 2) return;
  const uid = await ensureSquadratsUid();
  const navUrl = await buildNavUrl(routeCoordinates, uid);

  const container = document.getElementById('qr-code');
  container.innerHTML = '';

  try {
    const qr = qrcode(0, 'L');
    qr.addData(navUrl);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const cellSize = Math.max(4, Math.floor(240 / moduleCount));
    const size = moduleCount * cellSize;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';

    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        }
      }
    }

    const img = document.createElement('img');
    img.src = canvas.toDataURL();
    img.width = 250;
    img.height = 250;
    img.alt = 'QR Code';
    container.appendChild(img);
  } catch (err) {
    container.textContent = 'Could not generate QR code';
    console.error('QR generation failed:', err);
  }

  document.getElementById('qr-modal').hidden = false;
}

document.getElementById('qr-close').addEventListener('click', () => {
  document.getElementById('qr-modal').hidden = true;
});

document.getElementById('qr-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('qr-modal').hidden = true;
  }
});

// ── Toast Notifications ──────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── Tallinn Bicycle Roads Layer ──────────────────────────────────
const BIKE_ROADS_URL = 'https://gis.tallinn.ee/arcgis/rest/services/veebikaart/Kergliiklusteed_veebikaart/MapServer/0/query';

const BIKE_ROAD_STYLES = {
  1:  { color: '#005499', weight: 2, dashArray: '6 4' },  // marked lane on road
  2:  { color: '#005499', weight: 2.5 },                  // bike & pedestrian path
  3:  { color: '#005499', weight: 2, dashArray: '2 6' },  // planned
  5:  { color: '#005499', weight: 2.5 },                  // bike road
  6:  { color: '#005499', weight: 2, dashArray: '6 4' },  // marked lane on sidewalk
};

const BIKE_ROAD_LABELS = {
  1: 'Marked lane on road',
  2: 'Bike & pedestrian path',
  3: 'Planned',
  5: 'Bicycle road',
  6: 'Marked lane on sidewalk',
};

function bikeRoadStyle(feature) {
  const kind = feature.properties?.rattatee_liik;
  return BIKE_ROAD_STYLES[kind] || { color: '#005499', weight: 2, opacity: 0.6 };
}

async function fetchBikeRoads() {
  if (bikeRoadsData) return bikeRoadsData;

  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'rattatee_liik',
    outSR: '4326',
    f: 'geojson',
  });

  const resp = await fetch(`${BIKE_ROADS_URL}?${params}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  bikeRoadsData = await resp.json();
  return bikeRoadsData;
}

async function toggleBikeRoads(show) {
  if (!show) {
    if (bikeRoadsLayer) { map.removeLayer(bikeRoadsLayer); }
    return;
  }

  if (bikeRoadsLayer) { bikeRoadsLayer.addTo(map); return; }

  try {
    const geojson = await fetchBikeRoads();
    bikeRoadsLayer = L.geoJSON(geojson, {
      style: bikeRoadStyle,
      interactive: true,
      onEachFeature(feature, layer) {
        const kind = feature.properties?.rattatee_liik;
        const label = BIKE_ROAD_LABELS[kind] || `Type ${kind}`;
        layer.bindTooltip(label, { sticky: true, className: 'bike-road-tooltip' });
      },
    }).addTo(map);
  } catch (err) {
    console.error('Failed to load bike roads:', err);
    showToast('Could not load bicycle roads layer.', 'error');
    document.getElementById('toggle-bike-roads').checked = false;
  }
}

document.getElementById('toggle-bike-roads').addEventListener('change', (e) => {
  toggleBikeRoads(e.target.checked);
});

// ── Squadrats Layer ──────────────────────────────────────────────
const SQ_ZOOM = 14;
const SQINHO_ZOOM = 17;
let sqRaw = { 14: null, 17: null };
let sqTileLayer = null;
let sqNewLayer = null;
let sqEnabled = false;
const sqShowNew = true;
let sqOpacity = 0.12;

function lon2tile(lng, zoom) {
  return Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  return Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)
  );
}

function tile2lon(x, z) { return x / (1 << z) * 360 - 180; }

function tile2lat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (1 << z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

const EARTH_R = 6371000;
const _toRad = d => d * Math.PI / 180;

function haversine(a, b) {
  const dLat = _toRad(b[0] - a[0]), dLng = _toRad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(_toRad(a[0])) * Math.cos(_toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function tileCenter(key, z) {
  const [x, y] = key.split('-').map(Number);
  return [(tile2lat(y, z) + tile2lat(y + 1, z)) / 2, (tile2lon(x, z) + tile2lon(x + 1, z)) / 2];
}

function tileBorderDistToPoint(key, z, pt) {
  const [x, y] = key.split('-').map(Number);
  const north = tile2lat(y, z), south = tile2lat(y + 1, z);
  const west = tile2lon(x, z), east = tile2lon(x + 1, z);
  const clampLat = Math.max(south, Math.min(north, pt[0]));
  const clampLng = Math.max(west, Math.min(east, pt[1]));
  return haversine(pt, [clampLat, clampLng]);
}

function nearestBorderPoint(key, z, pt) {
  const [x, y] = key.split('-').map(Number);
  const north = tile2lat(y, z), south = tile2lat(y + 1, z);
  const west = tile2lon(x, z), east = tile2lon(x + 1, z);
  return [Math.max(south, Math.min(north, pt[0])), Math.max(west, Math.min(east, pt[1]))];
}

function _makeCanvas(size) {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size.x * dpr;
  canvas.height = size.y * dpr;
  canvas.style.width = `${size.x}px`;
  canvas.style.height = `${size.y}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { canvas, ctx };
}

function _drawUnvisited(ctx, tileX, tileY, zoom, tileSize, sqZoom, rawSet, color, alpha) {
  const scale = Math.pow(2, sqZoom - zoom);
  const cellPx = tileSize / scale;
  if (cellPx < 0.5) return;

  const minX = Math.floor(tileX * scale);
  const minY = Math.floor(tileY * scale);
  const maxX = Math.ceil((tileX + 1) * scale) - 1;
  const maxY = Math.ceil((tileY + 1) * scale) - 1;

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (!rawSet.has(`${x}-${y}`)) {
        ctx.fillRect(
          (x - tileX * scale) * cellPx,
          (y - tileY * scale) * cellPx,
          cellPx, cellPx
        );
      }
    }
  }
  ctx.globalAlpha = 1;
}

function _drawUnvisitedBorders(ctx, tileX, tileY, zoom, tileSize, sqZoom, rawSet, color, lineWidth, alpha) {
  const scale = Math.pow(2, sqZoom - zoom);
  const cellPx = tileSize / scale;
  if (cellPx < 3) return;

  const minX = Math.floor(tileX * scale) - 1;
  const minY = Math.floor(tileY * scale) - 1;
  const maxX = Math.ceil((tileX + 1) * scale);
  const maxY = Math.ceil((tileY + 1) * scale);

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;
  ctx.beginPath();

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (rawSet.has(`${x}-${y}`)) continue;
      const px = (x - tileX * scale) * cellPx;
      const py = (y - tileY * scale) * cellPx;
      if (rawSet.has(`${x}-${y - 1}`)) { ctx.moveTo(px, py); ctx.lineTo(px + cellPx, py); }
      if (rawSet.has(`${x}-${y + 1}`)) { ctx.moveTo(px, py + cellPx); ctx.lineTo(px + cellPx, py + cellPx); }
      if (rawSet.has(`${x - 1}-${y}`)) { ctx.moveTo(px, py); ctx.lineTo(px, py + cellPx); }
      if (rawSet.has(`${x + 1}-${y}`)) { ctx.moveTo(px + cellPx, py); ctx.lineTo(px + cellPx, py + cellPx); }
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function createSqTileLayer() {
  return L.GridLayer.extend({
    options: { tileSize: 256 },
    createTile(coords, done) {
      const size = this.getTileSize();
      const { canvas, ctx } = _makeCanvas(size);
      setTimeout(() => {
        if (sqRaw[14]) {
          _drawUnvisited(ctx, coords.x, coords.y, coords.z, size.x, SQ_ZOOM, sqRaw[14], '#663399', sqOpacity);
          _drawUnvisitedBorders(ctx, coords.x, coords.y, coords.z, size.x, SQ_ZOOM, sqRaw[14], '#663399', 1, 0.25);
        }
        if (sqRaw[17]) {
          _drawUnvisited(ctx, coords.x, coords.y, coords.z, size.x, SQINHO_ZOOM, sqRaw[17], '#996633', sqOpacity * 0.7);
          _drawUnvisitedBorders(ctx, coords.x, coords.y, coords.z, size.x, SQINHO_ZOOM, sqRaw[17], '#996633', 0.5, 0.2);
        }
        done(null, canvas);
      }, 0);
      return canvas;
    }
  });
}

function _drawBitmap(ctx, tileX, tileY, zoom, tileSize, sqZoom, tileSet, color, alpha) {
  const scale = Math.pow(2, sqZoom - zoom);
  const cellPx = tileSize / scale;
  if (cellPx < 0.5) return;

  const minX = Math.floor(tileX * scale);
  const minY = Math.floor(tileY * scale);
  const maxX = Math.ceil((tileX + 1) * scale) - 1;
  const maxY = Math.ceil((tileY + 1) * scale) - 1;

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (tileSet.has(`${x}-${y}`)) {
        ctx.fillRect(
          (x - tileX * scale) * cellPx,
          (y - tileY * scale) * cellPx,
          cellPx, cellPx
        );
      }
    }
  }
  ctx.globalAlpha = 1;
}

function createSqNewLayer() {
  return L.GridLayer.extend({
    options: { tileSize: 256 },
    _new14: null,
    _new17: null,
    setNewTiles(n14, n17) {
      this._new14 = n14;
      this._new17 = n17;
      this.redraw();
    },
    createTile(coords, done) {
      const size = this.getTileSize();
      const { canvas, ctx } = _makeCanvas(size);
      setTimeout(() => {
        if (this._new14?.size) _drawBitmap(ctx, coords.x, coords.y, coords.z, size.x, SQ_ZOOM, this._new14, '#4cf095', 0.6);
        if (this._new17?.size) _drawBitmap(ctx, coords.x, coords.y, coords.z, size.x, SQINHO_ZOOM, this._new17, '#00fcca', 0.6);
        done(null, canvas);
      }, 0);
      return canvas;
    }
  });
}

function getRouteNewTiles(zoom, rawSet) {
  if (routeCoordinates.length < 2 || !rawSet) return null;
  const newTiles = new Set();
  let prevKey = null;
  for (const [lat, lng] of routeCoordinates) {
    const key = `${lon2tile(lng, zoom)}-${lat2tile(lat, zoom)}`;
    if (key !== prevKey) {
      if (!rawSet.has(key)) newTiles.add(key);
      prevKey = key;
    }
  }
  return newTiles;
}

function updateSqNewLayer() {
  if (!sqEnabled || !sqShowNew || !sqNewLayer) return;
  const new14 = getRouteNewTiles(SQ_ZOOM, sqRaw[14]);
  const new17 = getRouteNewTiles(SQINHO_ZOOM, sqRaw[17]);
  sqNewLayer.setNewTiles(new14, new17);

  const statsEl = document.getElementById('squadrats-status');
  if (statsEl.style.display === 'none') return;

  const parts = [];
  if (new14?.size) parts.push(`<strong>+${new14.size}</strong> sq`);
  if (new17?.size) parts.push(`<strong>+${new17.size}</strong> inho`);

  const existing = statsEl.querySelector('.sq-route-new');
  if (parts.length) {
    const html = `<span class="sq-stat sq-route-new">Route: ${parts.join(', ')}</span>`;
    if (existing) existing.outerHTML = html;
    else {
      const container = statsEl.querySelector('.sq-stats');
      if (container) container.insertAdjacentHTML('beforeend', html);
    }
  } else if (existing) {
    existing.remove();
  }
}

function _parseRawSet(data) {
  if (!data) return null;
  if (data instanceof Set) return data;
  if (Array.isArray(data)) return new Set(data);
  return new Set(Object.keys(data));
}

async function loadSquadratsData() {
  const statusEl = document.getElementById('squadrats-status');
  statusEl.style.display = 'block';
  statusEl.className = 'squadrats-status';
  statusEl.textContent = 'Connecting to Squadrats…';

  const uidResult = await new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'getSquadratsUid' }, resolve)
  );

  if (!uidResult?.uid) {
    statusEl.className = 'squadrats-status error';
    statusEl.innerHTML = 'Not connected. <a href="https://squadrats.com/map" target="_blank" style="color:#bb86fc">Visit squadrats.com</a> while logged in, then toggle this again.';
    return false;
  }

  const result = await new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'fetchSquadrats', uid: uidResult.uid }, resolve)
  );

  if (result?.error) {
    statusEl.className = 'squadrats-status error';
    statusEl.textContent = result.error;
    return false;
  }

  sqRaw[14] = _parseRawSet(result?.raw?.[14]);
  sqRaw[17] = _parseRawSet(result?.raw?.[17]);
  sqRaw._uid = uidResult.uid;

  if (!sqRaw[14] && !sqRaw[17]) {
    statusEl.className = 'squadrats-status error';
    statusEl.textContent = 'No tile data received.';
    return false;
  }

  statusEl.className = 'squadrats-status';
  statusEl.textContent = '';
  return true;
}

async function toggleSquadrats(show) {
  if (!show) {
    if (sqTileLayer) map.removeLayer(sqTileLayer);
    if (sqNewLayer) map.removeLayer(sqNewLayer);
    document.getElementById('squadrats-controls').style.display = 'none';
    document.getElementById('squadrats-status').style.display = 'none';
    sqEnabled = false;
    clearOptimization();
    document.getElementById('detour-status').innerHTML = '';
    return;
  }

  sqEnabled = true;
  document.getElementById('squadrats-controls').style.display = 'block';

  if (!sqRaw[14] && !sqRaw[17]) {
    const ok = await loadSquadratsData();
    if (!ok) {
      document.getElementById('toggle-squadrats').checked = false;
      sqEnabled = false;
      return;
    }
  } else {
    document.getElementById('squadrats-status').style.display = 'block';
  }

  sqTileLayer = new (createSqTileLayer())();
  sqTileLayer.addTo(map);

  if (sqShowNew) {
    sqNewLayer = new (createSqNewLayer())();
    sqNewLayer.addTo(map);
    updateSqNewLayer();
  }

  if (detourBudgetPct > 0 && baseRouteCoordinates.length >= 2) {
    scheduleOptimization();
  }
}

document.getElementById('toggle-squadrats').addEventListener('change', (e) => {
  toggleSquadrats(e.target.checked);
});

document.getElementById('squadrats-opacity-slider').addEventListener('input', (e) => {
  sqOpacity = parseInt(e.target.value) / 100;
  document.getElementById('squadrats-opacity-value').textContent = `${e.target.value}%`;
  if (sqTileLayer) sqTileLayer.redraw();
});

document.getElementById('detour-slider').addEventListener('input', (e) => {
  detourBudgetPct = parseInt(e.target.value);
  document.getElementById('detour-value').textContent = `${detourBudgetPct}%`;
  scheduleOptimization();
});

// ── Squadratinho Route Optimizer ─────────────────────────────────
let detourBudgetPct = 0;
let baseRouteCoordinates = [];
let baseRouteDistanceKm = 0;
let baseRoutePolyline = null;
let optimizeDebounce = null;
let optimizeAbort = null;

const SEARCH_RADIUS_M = 500;
const MAX_SEARCH_RADIUS_M = 5000;
const DETOUR_ROAD_FACTOR = 1.4;
const MAX_VIA_POINTS = 15;
const CLUSTER_RADIUS_M = 300;
const CORRIDOR_BUDGET_SHARE = 0.5;
const MIN_CORRIDOR_BUDGET_PCT = 10;
const CORRIDOR_ANCHOR_INTERVAL_KM = 10;
const MAX_CORRIDOR_ANCHORS = 5;

function scanSquadratinhoOpportunities(routeCoords, radiusM) {
  const rawSet = sqRaw[SQINHO_ZOOM];
  if (!rawSet || routeCoords.length < 2) return [];

  const candidates = new Map();
  const maxSamples = radiusM > SEARCH_RADIUS_M ? 200 : 500;
  const step = Math.max(1, Math.floor(routeCoords.length / maxSamples));

  for (let i = 0; i < routeCoords.length; i += step) {
    const [lat, lng] = routeCoords[i];
    const cx = lon2tile(lng, SQINHO_ZOOM);
    const cy = lat2tile(lat, SQINHO_ZOOM);
    const span = Math.ceil(radiusM / 150) + 1;

      for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        const key = `${cx + dx}-${cy + dy}`;
        if (rawSet.has(key)) continue;

        const borderDist = tileBorderDistToPoint(key, SQINHO_ZOOM, [lat, lng]);
        if (borderDist > radiusM) continue;

        const existing = candidates.get(key);
        if (!existing || borderDist < existing.borderDist) {
          candidates.set(key, {
            key,
            routeIdx: i,
            borderDist,
            borderPoint: nearestBorderPoint(key, SQINHO_ZOOM, [lat, lng]),
            center: tileCenter(key, SQINHO_ZOOM),
          });
        }
      }
    }
  }

  return Array.from(candidates.values());
}

function clusterDetourCandidates(candidates) {
  const used = new Set();
  const clusters = [];

  const sorted = candidates.slice().sort((a, b) => a.borderDist - b.borderDist);

  for (const c of sorted) {
    if (used.has(c.key)) continue;
    used.add(c.key);

    const cluster = {
      tiles: [c],
      routeIdx: c.routeIdx,
      borderDist: c.borderDist,
    };

    for (const other of sorted) {
      if (used.has(other.key)) continue;
      if (haversine(c.center, other.center) < CLUSTER_RADIUS_M) {
        cluster.tiles.push(other);
        used.add(other.key);
      }
    }

    let latSum = 0, lngSum = 0;
    for (const t of cluster.tiles) {
      latSum += t.borderPoint[0];
      lngSum += t.borderPoint[1];
    }
    cluster.viaPoint = [latSum / cluster.tiles.length, lngSum / cluster.tiles.length];

    const avgBorderDist = cluster.tiles.reduce((s, t) => s + t.borderDist, 0) / cluster.tiles.length;
    cluster.estimatedDetourM = 2 * avgBorderDist * DETOUR_ROAD_FACTOR;
    cluster.tileCount = cluster.tiles.length;
    cluster.efficiency = cluster.tileCount / Math.max(cluster.estimatedDetourM / 1000, 0.01);
    cluster.routeIdx = Math.min(...cluster.tiles.map(t => t.routeIdx));

    clusters.push(cluster);
  }

  return clusters;
}

function selectDetours(clusters, budgetKm, maxVias = MAX_VIA_POINTS) {
  const sorted = clusters.slice().sort((a, b) => b.efficiency - a.efficiency);
  const selected = [];
  let usedKm = 0;

  for (const cl of sorted) {
    if (selected.length >= maxVias) break;
    const costKm = cl.estimatedDetourM / 1000;
    if (usedKm + costKm > budgetKm) continue;
    selected.push(cl);
    usedKm += costKm;
  }

  selected.sort((a, b) => a.routeIdx - b.routeIdx);
  return selected;
}

function buildOptimizedWaypoints(userWaypoints, selectedClusters, routeCoords) {
  if (selectedClusters.length === 0) return null;

  const wpPositions = userWaypoints.map(w => {
    const ll = w.marker.getLatLng();
    return [ll.lat, ll.lng];
  });

  const wpRouteIndices = wpPositions.map(wp => {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < routeCoords.length; i++) {
      const d = haversine(wp, routeCoords[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  });

  const result = [];
  let clusterPtr = 0;

  for (let w = 0; w < wpPositions.length; w++) {
    result.push(wpPositions[w]);

    const segEnd = w < wpPositions.length - 1 ? wpRouteIndices[w + 1] : routeCoords.length;

    while (clusterPtr < selectedClusters.length && selectedClusters[clusterPtr].routeIdx < segEnd) {
      result.push(selectedClusters[clusterPtr].viaPoint);
      clusterPtr++;
    }
  }

  while (clusterPtr < selectedClusters.length) {
    result.push(selectedClusters[clusterPtr].viaPoint);
    clusterPtr++;
  }

  return result;
}

async function fetchAlternatives(lonlatPairs, signal) {
  const promises = [0, 1, 2, 3].map(async (idx) => {
    try {
      const lonlats = lonlatPairs.map(([lng, lat]) => `${lng},${lat}`).join('|');
      const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=trekking&alternativeidx=${idx}&format=geojson`;
      const resp = await fetch(url, { signal });
      if (!resp.ok) return null;
      const data = await resp.json();
      const feat = data.features?.[0];
      if (!feat) return null;
      return {
        idx,
        distance: parseFloat(feat.properties['track-length']),
        coordinates: feat.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      return null;
    }
  });
  return (await Promise.all(promises)).filter(Boolean);
}

function selectBestCorridor(alternatives, baseDistKm, budgetKm, rawSet) {
  if (alternatives.length <= 1) return null;

  const corridorBudgetKm = budgetKm * CORRIDOR_BUDGET_SHARE;
  const baseAlt = alternatives.find(a => a.idx === 0);
  const baseTiles = baseAlt
    ? getRouteNewTilesFromCoords(baseAlt.coordinates, SQINHO_ZOOM, rawSet)
    : null;
  const baseCount = baseTiles?.size || 0;

  let best = null;
  let bestExtra = 0;

  for (const alt of alternatives) {
    if (alt.idx === 0) continue;
    const altDistKm = alt.distance / 1000;
    const extraDistKm = Math.max(0, altDistKm - baseDistKm);
    if (extraDistKm > corridorBudgetKm) continue;

    const altTiles = getRouteNewTilesFromCoords(alt.coordinates, SQINHO_ZOOM, rawSet);
    const altCount = altTiles?.size || 0;
    const extraTiles = altCount - baseCount;

    if (extraTiles > bestExtra) {
      bestExtra = extraTiles;
      best = { ...alt, distanceKm: altDistKm, extraDistKm, extraTiles };
    }
  }

  return best;
}

function getCorridorAnchors(corridorCoords, corridorDistKm) {
  const numAnchors = Math.max(1, Math.min(
    MAX_CORRIDOR_ANCHORS,
    Math.floor(corridorDistKm / CORRIDOR_ANCHOR_INTERVAL_KM)
  ));
  const anchors = [];
  const interval = Math.floor(corridorCoords.length / (numAnchors + 1));
  for (let i = 1; i <= numAnchors; i++) {
    const idx = i * interval;
    if (idx > 0 && idx < corridorCoords.length - 1) {
      anchors.push({ routeIdx: idx, viaPoint: corridorCoords[idx] });
    }
  }
  return anchors;
}

async function runOptimization() {
  const statusEl = document.getElementById('detour-status');

  if (!sqEnabled || !sqRaw[SQINHO_ZOOM] || detourBudgetPct <= 0 || baseRouteCoordinates.length < 2) {
    clearOptimization();
    return;
  }

  statusEl.innerHTML = '<span class="detour-computing">Optimizing…</span>';

  if (optimizeAbort) optimizeAbort.abort();
  const controller = new AbortController();
  optimizeAbort = controller;

  await new Promise(r => setTimeout(r, 50));
  if (controller.signal.aborted) return;

  const totalBudgetKm = baseRouteDistanceKm * (detourBudgetPct / 100);
  const rawSet = sqRaw[SQINHO_ZOOM];

  // ── Phase 1: Explore alternative corridors ──
  let corridorCoords = baseRouteCoordinates;
  let corridorDistKm = baseRouteDistanceKm;
  let corridorAnchors = [];
  let corridorCostKm = 0;
  let corridorExtraTiles = 0;

  if (detourBudgetPct >= MIN_CORRIDOR_BUDGET_PCT && waypoints.length >= 2) {
    statusEl.innerHTML = '<span class="detour-computing">Exploring corridors…</span>';

    const lonlatPairs = waypoints.map(w => {
      const ll = w.marker.getLatLng();
      return [ll.lng, ll.lat];
    });

    const alternatives = await fetchAlternatives(lonlatPairs, controller.signal);
    if (controller.signal.aborted) return;

    const best = selectBestCorridor(alternatives, baseRouteDistanceKm, totalBudgetKm, rawSet);
    if (best) {
      corridorCoords = best.coordinates;
      corridorDistKm = best.distanceKm;
      corridorCostKm = best.extraDistKm;
      corridorExtraTiles = best.extraTiles;
      corridorAnchors = getCorridorAnchors(corridorCoords, corridorDistKm);
    }
  }

  if (controller.signal.aborted) return;
  statusEl.innerHTML = '<span class="detour-computing">Scanning detours…</span>';

  // ── Phase 2: Near-route detours with budget-scaled radius ──
  const remainingBudgetKm = totalBudgetKm - corridorCostKm;
  const effectiveRadius = Math.min(
    SEARCH_RADIUS_M + remainingBudgetKm * 200,
    MAX_SEARCH_RADIUS_M
  );

  const candidates = scanSquadratinhoOpportunities(corridorCoords, effectiveRadius);
  const clusters = clusterDetourCandidates(candidates);
  const maxDetourVias = MAX_VIA_POINTS - corridorAnchors.length;
  const selected = selectDetours(clusters, remainingBudgetKm, maxDetourVias);

  const allViaPoints = [
    ...corridorAnchors,
    ...selected,
  ].sort((a, b) => a.routeIdx - b.routeIdx);

  if (allViaPoints.length === 0) {
    if (corridorExtraTiles === 0) {
      statusEl.innerHTML = candidates.length === 0
        ? '<span class="detour-none">No nearby squadratinhos found</span>'
        : '<span class="detour-none">Budget too small for detours</span>';
      clearOptimization();
      return;
    }
    const midIdx = Math.floor(corridorCoords.length / 2);
    allViaPoints.push({ routeIdx: midIdx, viaPoint: corridorCoords[midIdx] });
  }

  const expandedWaypoints = buildOptimizedWaypoints(waypoints, allViaPoints, corridorCoords);
  if (!expandedWaypoints || controller.signal.aborted) return;

  const lonlatPairs = expandedWaypoints.map(([lat, lng]) => [lng, lat]);

  try {
    const route = await fetchRoute('trekking', lonlatPairs, controller.signal)
      || await fetchRoute('hiking-mountain', lonlatPairs, controller.signal);

    if (optimizeAbort !== controller) return;

    if (!route) {
      statusEl.innerHTML = '<span class="detour-none">Optimization routing failed</span>';
      clearOptimization();
      return;
    }

    routeCoordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

    if (routePolyline) map.removeLayer(routePolyline);

    if (!baseRoutePolyline) {
      baseRoutePolyline = L.polyline(baseRouteCoordinates, {
        color: '#888',
        weight: 3,
        opacity: 0.4,
        dashArray: '8 6',
        interactive: false,
      }).addTo(map);
    } else {
      baseRoutePolyline.setLatLngs(baseRouteCoordinates);
    }

    routePolyline = L.polyline(routeCoordinates, {
      color: '#fc4c02',
      weight: 4,
      opacity: 0.85,
      smoothFactor: 1,
      className: 'route-line'
    }).addTo(map);
    setupRouteDrag();

    const optimizedDistKm = route.distance / 1000;
    const deltaKm = optimizedDistKm - baseRouteDistanceKm;
    const deltaPct = ((deltaKm / baseRouteDistanceKm) * 100).toFixed(0);

    const newInhos = getRouteNewTiles(SQINHO_ZOOM, sqRaw[SQINHO_ZOOM]);
    const baseInhos = getRouteNewTilesFromCoords(baseRouteCoordinates, SQINHO_ZOOM, sqRaw[SQINHO_ZOOM]);
    const extraInhos = (newInhos?.size || 0) - (baseInhos?.size || 0);

    lastRouteDistanceKm = optimizedDistKm;
    const distEl = document.getElementById('route-distance');
    distEl.textContent = optimizedDistKm < 10
      ? `${optimizedDistKm.toFixed(1)} km`
      : `${Math.round(optimizedDistKm)} km`;
    updateDuration();

    const statusParts = [];
    if (corridorExtraTiles > 0) statusParts.push(`corridor +${corridorExtraTiles}`);
    const detourTiles = extraInhos - corridorExtraTiles;
    if (selected.length > 0 && detourTiles > 0) statusParts.push(`detours +${detourTiles}`);
    const tileSummary = statusParts.length > 0
      ? statusParts.join(', ')
      : `+${extraInhos > 0 ? extraInhos : newInhos?.size || 0}`;

    statusEl.innerHTML = `<span class="detour-result"><strong>${tileSummary}</strong> inhos · <strong>+${deltaKm.toFixed(1)} km</strong> (+${deltaPct}%)</span>`;

    updateSqNewLayer();
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Optimization routing error:', err);
    statusEl.innerHTML = '<span class="detour-none">Optimization failed</span>';
    clearOptimization();
  }
}

function getRouteNewTilesFromCoords(coords, zoom, rawSet) {
  if (coords.length < 2 || !rawSet) return null;
  const newTiles = new Set();
  let prevKey = null;
  for (const [lat, lng] of coords) {
    const key = `${lon2tile(lng, zoom)}-${lat2tile(lat, zoom)}`;
    if (key !== prevKey) {
      if (!rawSet.has(key)) newTiles.add(key);
      prevKey = key;
    }
  }
  return newTiles;
}

function clearOptimization() {
  if (baseRoutePolyline) {
    map.removeLayer(baseRoutePolyline);
    baseRoutePolyline = null;
  }
  if (baseRouteCoordinates.length > 0 && routePolyline) {
    routeCoordinates = baseRouteCoordinates;
    routePolyline.setLatLngs(routeCoordinates);
    lastRouteDistanceKm = baseRouteDistanceKm;
    const distEl = document.getElementById('route-distance');
    distEl.textContent = baseRouteDistanceKm < 10
      ? `${baseRouteDistanceKm.toFixed(1)} km`
      : `${Math.round(baseRouteDistanceKm)} km`;
    updateDuration();
    updateSqNewLayer();
  }
}

function scheduleOptimization() {
  clearTimeout(optimizeDebounce);
  if (detourBudgetPct <= 0) {
    clearOptimization();
    const statusEl = document.getElementById('detour-status');
    statusEl.innerHTML = '';
    return;
  }
  optimizeDebounce = setTimeout(() => runOptimization(), 800);
}

// ── Heatmap Controls ─────────────────────────────────────────────
document.getElementById('sport-select').addEventListener('change', () => initHeatmap());
document.getElementById('color-select').addEventListener('change', () => initHeatmap());

document.getElementById('opacity-slider').addEventListener('input', (e) => {
  const val = e.target.value;
  document.getElementById('opacity-value').textContent = `${val}%`;
  if (stravaLayer) stravaLayer.setOpacity(val / 100);
});

document.getElementById('speed-slider').addEventListener('input', (e) => {
  document.getElementById('speed-value').textContent = `${e.target.value} km/h`;
  updateDuration();
});

// ── Action Buttons ───────────────────────────────────────────────
document.getElementById('btn-delete-mode').addEventListener('click', toggleDeleteMode);
document.getElementById('btn-undo').addEventListener('click', undoLastWaypoint);
document.getElementById('btn-clear').addEventListener('click', clearAllWaypoints);
document.getElementById('btn-return-start').addEventListener('click', returnToStart);
document.getElementById('btn-start-here').addEventListener('click', startFromCurrentLocation);
document.getElementById('btn-export').addEventListener('click', exportGPX);
document.getElementById('btn-navigate').addEventListener('click', () => {
  if (routeCoordinates.length < 2) return;
  (async () => {
    const uid = await ensureSquadratsUid();
    window.open(await buildNavUrl(routeCoordinates, uid), '_blank');
  })();
});
document.getElementById('btn-navigate-dev').addEventListener('click', async () => {
  if (routeCoordinates.length < 2) return;
  const uid = await ensureSquadratsUid();
  window.open(await buildDevNavUrl(routeCoordinates, uid), '_blank');
});
document.getElementById('btn-share').addEventListener('click', async () => {
  if (routeCoordinates.length < 2) return;
  const uid = await ensureSquadratsUid();
  const navUrl = await buildNavUrl(routeCoordinates, uid);
  const distKm = lastRouteDistanceKm < 10
    ? `${lastRouteDistanceKm.toFixed(1)} km`
    : `${Math.round(lastRouteDistanceKm)} km`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: `Route — ${distKm}`,
        text: `Check out this ${distKm} route!`,
        url: navUrl,
      });
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Share failed:', e);
    }
  } else {
    try {
      await navigator.clipboard.writeText(navUrl);
      showToast('Route link copied to clipboard!', 'success');
    } catch (e) {
      showToast('Could not copy link.', 'error');
    }
  }
});
document.getElementById('btn-google').addEventListener('click', openInGoogleMaps);
document.getElementById('btn-send-device').addEventListener('click', sendToDevice);

// ── GPS Tracking ─────────────────────────────────────────────────
function startGpsTracking() {
  if (!navigator.geolocation || gpsWatchId != null) return;

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);

      if (!gpsMarker) {
        gpsMarker = L.marker(latlng, {
          icon: L.divIcon({
            className: 'gps-location-icon',
            html: '<div class="gps-location-pulse"></div><div class="gps-location-dot"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
          zIndexOffset: 2000,
          interactive: false,
        }).addTo(map);
      } else {
        gpsMarker.setLatLng(latlng);
      }

      if (gpsFollowing) {
        map.setView(latlng, Math.max(map.getZoom(), 15), { animate: true });
      }

      updateFollowButton();
    },
    (err) => {
      if (err.code === 1) showToast('Location access denied. Enable it in browser settings.', 'error', 6000);
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
  );
}

function updateFollowButton() {
  const btn = document.getElementById('btn-follow');
  btn.style.display = gpsMarker ? '' : 'none';
  btn.classList.toggle('active', gpsFollowing);
}

map.on('dragstart', () => {
  gpsFollowing = false;
  updateFollowButton();
});

document.getElementById('btn-follow').addEventListener('click', () => {
  gpsFollowing = true;
  updateFollowButton();
  if (gpsMarker) {
    map.setView(gpsMarker.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
  }
});

startGpsTracking();

// ── Map Click ────────────────────────────────────────────────────
map.on('click', (e) => {
  if (routeDragging || deleteMode) return;
  addWaypoint(e.latlng);
});

// ── Init ─────────────────────────────────────────────────────────
if (initParams.sport) {
  const sportSel = document.getElementById('sport-select');
  if ([...sportSel.options].some(o => o.value === initParams.sport)) {
    sportSel.value = initParams.sport;
  }
}
if (initParams.color) {
  const colorSel = document.getElementById('color-select');
  if ([...colorSel.options].some(o => o.value === initParams.color)) {
    colorSel.value = initParams.color;
  }
}

checkAuth();
