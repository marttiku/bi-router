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
    maxZoom: authenticated ? 15 : 11,
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
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  routeCoordinates = [];

  if (waypoints.length < 2) {
    updateStats(null);
    updateButtons();
    if (squadratsNewLayer) squadratsNewLayer.setNewTiles(null);
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

    if (routePolyline) map.removeLayer(routePolyline);
    routePolyline = L.polyline(routeCoordinates, {
      color: '#fc4c02',
      weight: 4,
      opacity: 0.85,
      smoothFactor: 1
    }).addTo(map);

    updateStats(route);
    updateButtons();
    updateSquadratsNewLayer();
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

function buildNavUrl(coords) {
  const MAX_ENCODED_LEN = 2800;
  let pts = coords;
  let epsilon = 0.00001;

  let encoded = encodePolyline(pts);
  while (encoded.length > MAX_ENCODED_LEN && epsilon < 0.01) {
    epsilon *= 2;
    pts = douglasPeucker(coords, epsilon);
    encoded = encodePolyline(pts);
  }

  const baseUrl = 'https://marttiku.github.io/bi-router/nav.html';
  return `${baseUrl}#${encodeURIComponent(encoded)}`;
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

function sendToDevice() {
  if (routeCoordinates.length < 2) return;
  const navUrl = buildNavUrl(routeCoordinates);

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
const SQUADRATS_ZOOM = 14;
let squadratsRaw14 = null;
let squadratsTileLayer = null;
let squadratsGridLayer = null;
let squadratsNewLayer = null;
let squadratsEnabled = false;
let squadratsShowGrid = true;
let squadratsShowNew = true;
let squadratsOpacity = 0.5;

function lon2tile(lng, zoom) {
  return Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  return Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)
  );
}

function tile2lon(x, zoom) {
  return x / Math.pow(2, zoom) * 360 - 180;
}

function tile2lat(y, zoom) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function createSquadratsTileLayer() {
  return L.GridLayer.extend({
    options: { tileSize: 256 },
    createTile(coords, done) {
      const canvas = document.createElement('canvas');
      const size = this.getTileSize();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size.x * dpr;
      canvas.height = size.y * dpr;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      setTimeout(() => {
        if (squadratsRaw14) {
          this._drawVisited(ctx, coords.x, coords.y, coords.z, size.x);
        }
        done(null, canvas);
      }, 0);
      return canvas;
    },
    _drawVisited(ctx, tileX, tileY, zoom, tileSize) {
      const scale = Math.pow(2, SQUADRATS_ZOOM - zoom);
      const minSqX = Math.floor(tileX * scale);
      const minSqY = Math.floor(tileY * scale);
      const maxSqX = Math.ceil((tileX + 1) * scale) - 1;
      const maxSqY = Math.ceil((tileY + 1) * scale) - 1;
      const cellPx = tileSize / scale;

      if (cellPx < 1) return;

      ctx.fillStyle = '#c8a0e8';
      ctx.globalAlpha = squadratsOpacity;

      for (let sx = minSqX; sx <= maxSqX; sx++) {
        for (let sy = minSqY; sy <= maxSqY; sy++) {
          if (squadratsRaw14.has(`${sx}-${sy}`)) {
            const px = (sx - tileX * scale) * cellPx;
            const py = (sy - tileY * scale) * cellPx;
            ctx.fillRect(px, py, cellPx, cellPx);
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  });
}

function createSquadratsGridLayer() {
  return L.GridLayer.extend({
    options: { tileSize: 256 },
    createTile(coords, done) {
      const canvas = document.createElement('canvas');
      const size = this.getTileSize();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size.x * dpr;
      canvas.height = size.y * dpr;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      setTimeout(() => {
        this._drawGrid(ctx, coords.x, coords.y, coords.z, size.x);
        done(null, canvas);
      }, 0);
      return canvas;
    },
    _drawGrid(ctx, tileX, tileY, zoom, tileSize) {
      const scale = Math.pow(2, SQUADRATS_ZOOM - zoom);
      const cellPx = tileSize / scale;
      if (cellPx < 4) return;

      ctx.strokeStyle = '#663399';
      ctx.lineWidth = cellPx > 20 ? 1 : 0.5;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();

      const minSqX = Math.floor(tileX * scale);
      const minSqY = Math.floor(tileY * scale);
      const maxSqX = Math.ceil((tileX + 1) * scale);
      const maxSqY = Math.ceil((tileY + 1) * scale);

      for (let sx = minSqX; sx <= maxSqX; sx++) {
        const px = (sx - tileX * scale) * cellPx;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, tileSize);
      }
      for (let sy = minSqY; sy <= maxSqY; sy++) {
        const py = (sy - tileY * scale) * cellPx;
        ctx.moveTo(0, py);
        ctx.lineTo(tileSize, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });
}

function createSquadratsNewLayer() {
  return L.GridLayer.extend({
    options: { tileSize: 256 },
    _newTiles: null,
    setNewTiles(tiles) {
      this._newTiles = tiles;
      this.redraw();
    },
    createTile(coords, done) {
      const canvas = document.createElement('canvas');
      const size = this.getTileSize();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size.x * dpr;
      canvas.height = size.y * dpr;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      setTimeout(() => {
        if (this._newTiles?.size) {
          this._drawNew(ctx, coords.x, coords.y, coords.z, size.x);
        }
        done(null, canvas);
      }, 0);
      return canvas;
    },
    _drawNew(ctx, tileX, tileY, zoom, tileSize) {
      const scale = Math.pow(2, SQUADRATS_ZOOM - zoom);
      const minSqX = Math.floor(tileX * scale);
      const minSqY = Math.floor(tileY * scale);
      const maxSqX = Math.ceil((tileX + 1) * scale) - 1;
      const maxSqY = Math.ceil((tileY + 1) * scale) - 1;
      const cellPx = tileSize / scale;
      if (cellPx < 1) return;

      ctx.fillStyle = '#4cf095';
      ctx.globalAlpha = 0.5;

      for (let sx = minSqX; sx <= maxSqX; sx++) {
        for (let sy = minSqY; sy <= maxSqY; sy++) {
          if (this._newTiles.has(`${sx}-${sy}`)) {
            const px = (sx - tileX * scale) * cellPx;
            const py = (sy - tileY * scale) * cellPx;
            ctx.fillRect(px, py, cellPx, cellPx);
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  });
}

function getRouteSquadrats() {
  if (routeCoordinates.length < 2 || !squadratsRaw14) return null;

  const newTiles = new Set();
  let prevKey = null;

  for (const [lat, lng] of routeCoordinates) {
    const tx = lon2tile(lng, SQUADRATS_ZOOM);
    const ty = lat2tile(lat, SQUADRATS_ZOOM);
    const key = `${tx}-${ty}`;
    if (key !== prevKey) {
      if (!squadratsRaw14.has(key)) newTiles.add(key);
      prevKey = key;
    }
  }
  return newTiles;
}

function updateSquadratsNewLayer() {
  if (!squadratsEnabled || !squadratsShowNew || !squadratsNewLayer) return;
  const newTiles = getRouteSquadrats();
  squadratsNewLayer.setNewTiles(newTiles);

  const statsEl = document.getElementById('squadrats-status');
  if (newTiles?.size && statsEl.style.display !== 'none') {
    const existing = statsEl.querySelector('.sq-route-new');
    const html = `<span class="sq-stat sq-route-new">Route: <strong>+${newTiles.size}</strong> new</span>`;
    if (existing) existing.outerHTML = html;
    else {
      const container = statsEl.querySelector('.sq-stats');
      if (container) container.insertAdjacentHTML('beforeend', html);
    }
  }
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

  if (result?.raw?.[14]) {
    squadratsRaw14 = new Set(Array.isArray(result.raw[14]) ? result.raw[14] : Object.keys(result.raw[14]));
  } else {
    statusEl.className = 'squadrats-status error';
    statusEl.textContent = 'No tile data received.';
    return false;
  }

  statusEl.className = 'squadrats-status';
  statusEl.innerHTML = `<div class="sq-stats"><span class="sq-stat">Tiles: <strong>${squadratsRaw14.size}</strong></span></div>`;
  return true;
}

async function toggleSquadrats(show) {
  if (!show) {
    if (squadratsTileLayer) { map.removeLayer(squadratsTileLayer); }
    if (squadratsGridLayer) { map.removeLayer(squadratsGridLayer); }
    if (squadratsNewLayer) { map.removeLayer(squadratsNewLayer); }
    document.getElementById('squadrats-controls').style.display = 'none';
    document.getElementById('squadrats-status').style.display = 'none';
    squadratsEnabled = false;
    return;
  }

  squadratsEnabled = true;
  document.getElementById('squadrats-controls').style.display = 'block';

  if (!squadratsRaw14) {
    const ok = await loadSquadratsData();
    if (!ok) {
      document.getElementById('toggle-squadrats').checked = false;
      squadratsEnabled = false;
      return;
    }
  } else {
    document.getElementById('squadrats-status').style.display = 'block';
  }

  const TileLayer = createSquadratsTileLayer();
  squadratsTileLayer = new TileLayer();
  squadratsTileLayer.addTo(map);

  if (squadratsShowGrid) {
    const GridLayer = createSquadratsGridLayer();
    squadratsGridLayer = new GridLayer();
    squadratsGridLayer.addTo(map);
  }

  if (squadratsShowNew) {
    const NewLayer = createSquadratsNewLayer();
    squadratsNewLayer = new NewLayer();
    squadratsNewLayer.addTo(map);
    updateSquadratsNewLayer();
  }
}

document.getElementById('toggle-squadrats').addEventListener('change', (e) => {
  toggleSquadrats(e.target.checked);
});

document.getElementById('squadrats-opacity-slider').addEventListener('input', (e) => {
  squadratsOpacity = parseInt(e.target.value) / 100;
  document.getElementById('squadrats-opacity-value').textContent = `${e.target.value}%`;
  if (squadratsTileLayer) squadratsTileLayer.redraw();
});

document.getElementById('toggle-squadrats-grid').addEventListener('change', (e) => {
  squadratsShowGrid = e.target.checked;
  if (squadratsShowGrid && squadratsEnabled) {
    if (!squadratsGridLayer) {
      const GridLayer = createSquadratsGridLayer();
      squadratsGridLayer = new GridLayer();
    }
    squadratsGridLayer.addTo(map);
  } else if (squadratsGridLayer) {
    map.removeLayer(squadratsGridLayer);
  }
});

document.getElementById('toggle-squadrats-new').addEventListener('change', (e) => {
  squadratsShowNew = e.target.checked;
  if (squadratsShowNew && squadratsEnabled) {
    if (!squadratsNewLayer) {
      const NewLayer = createSquadratsNewLayer();
      squadratsNewLayer = new NewLayer();
    }
    squadratsNewLayer.addTo(map);
    updateSquadratsNewLayer();
  } else if (squadratsNewLayer) {
    map.removeLayer(squadratsNewLayer);
  }
});

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
  window.open(buildNavUrl(routeCoordinates), '_blank');
});
document.getElementById('btn-share').addEventListener('click', async () => {
  if (routeCoordinates.length < 2) return;
  const navUrl = buildNavUrl(routeCoordinates);
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
  if (!deleteMode) addWaypoint(e.latlng);
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
