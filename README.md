# Bi-Router

A Chrome extension for planning cycling and walking routes using Strava's global heatmap as an overlay. See where people actually ride and run, then plan your own route with turn-by-turn mobile navigation.

## Features

- **Strava heatmap overlay** -- shows popular cycling, running, and other activity routes with configurable sport type, color scheme, and opacity
- **Click-to-route planning** -- click the map to add waypoints; routes are calculated via BRouter (with OSRM fallback)
- **Tallinn bicycle roads layer** -- toggle official bike road data from Tallinn city GIS
- **GPX export** -- download your planned route as a GPX file
- **Google Maps integration** -- open your route directly in Google Maps (walking mode)
- **Mobile navigation via QR code** -- scan a QR code to open a GPS-tracked navigation page on your phone, no app install needed
- **Route stats** -- distance, estimated time, adjustable average speed

## How It Works

1. Visit [Strava's global heatmap](https://www.strava.com/maps/global-heatmap) while logged in
2. Click the **Plan Route** button injected by the extension
3. Plan your route by clicking waypoints on the map
4. Export as GPX, open in Google Maps, or scan the QR code for mobile navigation

## Mobile Navigation

The **Send to Phone** button generates a QR code that opens a self-contained navigation page (`nav.html`) on your phone. The planned route is encoded directly in the URL -- no server, no file transfer.

The navigation page provides:
- Live GPS tracking with your position on the map
- Distance remaining and ETA
- Direction compass arrow
- Route progress indicator
- Screen wake lock to keep the display on

## Installation

### From source (this repo)

1. Download or clone the repository:
   ```
   git clone https://github.com/marttiku/bi-router.git
   ```
2. Open **chrome://extensions/** in Chrome (or any Chromium-based browser)
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `bi-router` folder you just cloned
6. The extension icon (blue bike pin) appears in your toolbar — click it to open the route planner

To update later, `git pull` in the folder and click the reload button on the extensions page.

### Strava authentication

The extension works without a Strava account (public heatmap tiles at lower zoom). For full-resolution heatmap tiles:

1. Go to [strava.com](https://www.strava.com) and log in
2. Visit the [global heatmap](https://www.strava.com/maps/global-heatmap) at least once
3. Reload the route planner — it will pick up your session automatically

## Project Structure

```
├── manifest.json      Chrome extension manifest (MV3)
├── background.js      Service worker: tab management, tile auth
├── content.js         Injects "Plan Route" button on Strava heatmap
├── content.css        Styles for injected button
├── map.html           Route planner UI
├── map.js             Map logic, routing, layers, GPX export, QR
├── map.css            Planner styles
├── nav.html           Mobile navigation page (for GitHub Pages)
└── lib/
    ├── leaflet.js     Leaflet mapping library
    ├── leaflet.css    Leaflet styles
    └── qrcode.js      QR code generation
```

## Tech Stack

- **Leaflet** for mapping
- **BRouter** / **OSRM** for route calculation
- **Tallinn GIS ArcGIS REST API** for bicycle road data
- **Google polyline encoding** for compact route transfer via QR
- Vanilla JS, no build step

## License

MIT
