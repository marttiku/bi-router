# Bi-Router — Strava Heatmap Route Planner

A Chrome extension for planning cycling and walking routes using Strava's global heatmap as an overlay. See where people actually ride and run, then plan your own route with turn-by-turn mobile navigation.

## Features

- **Strava heatmap overlay** — shows popular cycling, running, water, and winter sport routes with configurable color scheme and opacity
- **Click-to-route planning** — click the map to add waypoints; routes are calculated via BRouter (with OSRM fallback)
- **Tallinn bicycle roads layer** — toggle official bike infrastructure data from Tallinn city GIS
- **Squadrats integration** — connects with [Squadrats](https://squadrats.com) to show your explored squares on the map
- **GPX export** — download your planned route as a GPX file for any GPS device or app
- **Google Maps integration** — open your route directly in Google Maps with one click
- **Mobile navigation via QR code** — scan a QR code to open a GPS-tracked navigation page on your phone, no app install needed
- **Route stats** — live distance, estimated time, and adjustable average speed

## How It Works

1. Visit [Strava's global heatmap](https://www.strava.com/maps/global-heatmap) while logged in
2. Click the **Plan Route** button injected by the extension (or click the extension icon anytime)
3. Click the map to add waypoints — the route calculates automatically
4. Export as GPX, open in Google Maps, or tap **Send to Phone** and scan the QR code

## Mobile Navigation

The **Send to Phone** button generates a QR code that opens a self-contained navigation page on your phone. The planned route is encoded directly in the URL — no server, no file transfer, no app install.

The navigation page provides:
- Live GPS tracking with your position on the map
- Distance remaining and ETA
- Direction compass arrow
- Route progress indicator
- Screen wake lock to keep the display on

## Installation

### From the Chrome Web Store

<!-- TODO: replace with actual link after publishing -->
Install from the [Chrome Web Store](https://chrome.google.com/webstore) — search for **Strava Heatmap Route Planner**.

### From source

1. Clone the repository:
   ```
   git clone https://github.com/marttiku/bi-router.git
   ```
2. Open **chrome://extensions/** in Chrome (or any Chromium-based browser)
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the cloned folder
5. The extension icon appears in your toolbar — click it to open the route planner

To update later, `git pull` in the folder and click the reload button on the extensions page.

### Strava authentication

The extension works without a Strava account (public heatmap tiles at lower zoom). For full-resolution heatmap tiles:

1. Go to [strava.com](https://www.strava.com) and log in
2. Visit the [global heatmap](https://www.strava.com/maps/global-heatmap) at least once
3. Reload the route planner — it will pick up your session automatically

## Project Structure

```
├── manifest.json          Chrome extension manifest (MV3)
├── background.js          Service worker: tab management, tile auth
├── content.js             Injects "Plan Route" button on Strava heatmap
├── content.css            Styles for injected button
├── squadrats-connect.js   Captures Squadrats UID for map integration
├── map.html               Route planner UI
├── map.js                 Map logic, routing, layers, GPX export, QR
├── map.css                Planner styles
├── nav.html               Mobile navigation page (hosted on GitHub Pages)
├── icons/                 Extension icons (SVG source + generated PNGs)
├── lib/
│   ├── leaflet.js         Leaflet mapping library
│   ├── leaflet.css        Leaflet styles
│   └── qrcode.js          QR code generation
└── store/                 Chrome Web Store listing assets
```

## Tech Stack

- **Leaflet** for mapping
- **BRouter** / **OSRM** for route calculation
- **Tallinn GIS ArcGIS REST API** for bicycle road data
- **Google polyline encoding** for compact route transfer via QR
- Vanilla JS, no build step

## Permissions

- **Cookies** — reads Strava session cookies to authenticate heatmap tile requests
- **DeclarativeNetRequest** — attaches auth headers to heatmap tile requests
- **Host permissions** — `strava.com`, `gis.tallinn.ee`, `squadrats.com`

## License

MIT
