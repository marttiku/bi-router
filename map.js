/* global L, chrome */

// ── State ────────────────────────────────────────────────────────
let waypoints = [];
let routePolyline = null;
let routeCoordinates = [];
let stravaLayer = null;
let isAuthenticated = false;

// ── Map Setup ────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: true }).setView([59.3212, 24.6635], 11);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19
}).addTo(map);

// ── Custom Strava Heatmap Tile Layer ─────────────────────────────
const StravaHeatmapLayer = L.TileLayer.extend({
  options: {
    activity: 'ride',
    color: 'mobileblue',
    opacity: 0.7,
    maxZoom: 15,
    minZoom: 2
  },

  getTileUrl(coords) {
    const subdomains = ['a', 'b', 'c'];
    const s = subdomains[Math.abs(coords.x + coords.y) % 3];
    return `https://heatmap-external-${s}.strava.com/tiles-auth/${this.options.activity}/${this.options.color}/${coords.z}/${coords.x}/${coords.y}.png`;
  },

  createTile(coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    const url = this.getTileUrl(coords);

    chrome.runtime.sendMessage({ type: 'fetchTile', url }, (response) => {
      if (chrome.runtime.lastError) {
        done(new Error(chrome.runtime.lastError.message), tile);
        return;
      }
      if (response && response.dataUrl) {
        tile.src = response.dataUrl;
        done(null, tile);
      } else {
        done(new Error(response?.error || 'Tile load failed'), tile);
      }
    });

    return tile;
  }
});

// ── Auth Check ───────────────────────────────────────────────────
async function checkAuth() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'checkAuth' }, (response) => {
      const el = document.getElementById('auth-status');
      const text = document.getElementById('auth-text');
      if (response?.authenticated) {
        el.className = 'auth-badge connected';
        text.textContent = 'Connected to Strava';
        isAuthenticated = true;
        initHeatmap();
      } else {
        el.className = 'auth-badge disconnected';
        text.textContent = 'Not logged into Strava';
        showToast('Log into strava.com in this browser, then reload this page.', 'error', 8000);
      }
      resolve(response);
    });
  });
}

function initHeatmap() {
  if (stravaLayer) map.removeLayer(stravaLayer);

  stravaLayer = new StravaHeatmapLayer({
    activity: document.getElementById('sport-select').value,
    color: document.getElementById('color-select').value,
    opacity: parseInt(document.getElementById('opacity-slider').value) / 100
  });

  stravaLayer.addTo(map);
}

// ── Waypoint Management ──────────────────────────────────────────
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
    wp.marker.setIcon(createNumberedIcon(i + 1));
  });
}

function addWaypoint(latlng) {
  const id = Date.now() + Math.random();
  const marker = L.marker(latlng, {
    draggable: true,
    icon: createNumberedIcon(waypoints.length + 1)
  }).addTo(map);

  marker.on('dragend', () => updateRoute());

  marker.on('contextmenu', (e) => {
    L.DomEvent.stopPropagation(e);
    removeWaypoint(id);
  });

  waypoints.push({ id, marker });
  updateWaypointList();
  updateRoute();
  updateButtons();
}

function removeWaypoint(id) {
  const idx = waypoints.findIndex(w => w.id === id);
  if (idx === -1) return;

  map.removeLayer(waypoints[idx].marker);
  waypoints.splice(idx, 1);
  renumberWaypoints();
  updateWaypointList();
  updateRoute();
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

// ── Waypoint List UI ─────────────────────────────────────────────
function updateWaypointList() {
  const container = document.getElementById('waypoint-list');

  if (waypoints.length === 0) {
    container.innerHTML = '<p class="empty-state">Click the map to add waypoints</p>';
    return;
  }

  container.innerHTML = waypoints.map((wp, i) => {
    const ll = wp.marker.getLatLng();
    return `
      <div class="waypoint-item" data-id="${wp.id}">
        <span class="waypoint-number">${i + 1}</span>
        <span class="waypoint-coords">${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}</span>
        <button class="waypoint-remove" title="Remove waypoint">&times;</button>
      </div>`;
  }).join('');

  container.querySelectorAll('.waypoint-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseFloat(btn.closest('.waypoint-item').dataset.id);
      removeWaypoint(id);
    });
  });
}

// ── Routing via OSRM ─────────────────────────────────────────────
let routeAbort = null;

async function updateRoute() {
  if (routeAbort) routeAbort.abort();

  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  routeCoordinates = [];

  if (waypoints.length < 2) {
    updateStats(null);
    return;
  }

  routeAbort = new AbortController();

  const coords = waypoints
    .map(w => {
      const ll = w.marker.getLatLng();
      return `${ll.lng},${ll.lat}`;
    })
    .join(';');

  try {
    const url = `https://router.project-osrm.org/route/v1/bicycle/${coords}?overview=full&geometries=geojson&steps=false`;
    const resp = await fetch(url, { signal: routeAbort.signal });
    const data = await resp.json();

    if (data.code !== 'Ok' || !data.routes?.[0]) {
      showToast('Could not calculate route. Try adjusting waypoints.', 'error');
      updateStats(null);
      return;
    }

    const route = data.routes[0];
    routeCoordinates = route.geometry.coordinates.map(c => [c[1], c[0]]);

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
function updateStats(route) {
  const distEl = document.getElementById('route-distance');
  const durEl = document.getElementById('route-duration');

  if (!route) {
    distEl.textContent = '—';
    durEl.textContent = '—';
    return;
  }

  const km = route.distance / 1000;
  distEl.textContent = km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;

  const mins = Math.round(route.duration / 60);
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
  document.getElementById('btn-undo').disabled = waypoints.length === 0;
  document.getElementById('btn-clear').disabled = waypoints.length === 0;
  document.getElementById('btn-export').disabled = routeCoordinates.length === 0;
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

// ── Toast Notifications ──────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── Heatmap Controls ─────────────────────────────────────────────
document.getElementById('sport-select').addEventListener('change', () => {
  if (isAuthenticated) initHeatmap();
});

document.getElementById('color-select').addEventListener('change', () => {
  if (isAuthenticated) initHeatmap();
});

document.getElementById('opacity-slider').addEventListener('input', (e) => {
  const val = e.target.value;
  document.getElementById('opacity-value').textContent = `${val}%`;
  if (stravaLayer) stravaLayer.setOpacity(val / 100);
});

// ── Action Buttons ───────────────────────────────────────────────
document.getElementById('btn-undo').addEventListener('click', undoLastWaypoint);
document.getElementById('btn-clear').addEventListener('click', clearAllWaypoints);
document.getElementById('btn-export').addEventListener('click', exportGPX);

// ── Map Click ────────────────────────────────────────────────────
map.on('click', (e) => addWaypoint(e.latlng));

// ── Init ─────────────────────────────────────────────────────────
checkAuth();
