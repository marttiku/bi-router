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
    return `https://content-a.strava.com/identified/globalheat/${activity}/${color}/{z}/{x}/{y}.png`;
  }
  return `https://heatmap-external-a.strava.com/tiles/${activity}/${color}/{z}/{x}/{y}.png`;
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

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);

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
    },
    (err) => {
      showToast(`Could not get location: ${err.message}`, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
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
  document.getElementById('btn-google').disabled = waypoints.length < 2;
  document.getElementById('btn-send-device').disabled = waypoints.length < 2;

  if (!hasWp && deleteMode) toggleDeleteMode();
}

function toggleDeleteMode() {
  deleteMode = !deleteMode;
  const btn = document.getElementById('btn-delete-mode');
  btn.classList.toggle('active', deleteMode);
  document.getElementById('map').style.cursor = deleteMode ? 'crosshair' : '';
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
  const mapsUrl = buildGoogleMapsUrl();
  if (!mapsUrl) return;

  const container = document.getElementById('qr-code');
  container.innerHTML = '';

  try {
    const qr = qrcode(0, 'L');
    qr.addData(mapsUrl);
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
document.getElementById('btn-google').addEventListener('click', openInGoogleMaps);
document.getElementById('btn-send-device').addEventListener('click', sendToDevice);

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
