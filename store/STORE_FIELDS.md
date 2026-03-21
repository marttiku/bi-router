# Chrome Web Store — Fields to Fill In

Copy-paste reference for the Developer Console.

---

## Listing tab

**Name:** Strava Heatmap Route Planner

**Detailed description:** paste from `store/description.txt`

**Category:** Productivity

**Language:** English

**Icon:** upload `icons/icon-128.png`

**Screenshots:** capture at least one at 1280x800 (see PUBLISHING.md)

**Promotional tile (optional):** upload `store/promo-440x280.png`

---

## Privacy practices tab

### Single purpose description

```
Plan cycling and walking routes on a map with Strava's global heatmap overlay, and export routes for mobile navigation.
```

### Justification for cookies

```
The extension reads Strava session cookies (CloudFront key-pair cookies) to authenticate requests for heatmap tile images. Without these cookies, only low-resolution public heatmap tiles are available. No cookies are written, modified, or sent to any third party.
```

### Justification for declarativeNetRequest

```
The extension uses declarativeNetRequest to attach Strava authentication headers (CloudFront cookies) to heatmap tile image requests made from the extension's map page. This is required because the heatmap tiles are served from a different origin (heatmap-external-*.strava.com) and the browser does not automatically include cookies for cross-origin image requests. No requests are blocked, redirected, or modified for any other purpose.
```

### Justification for host permissions

```
strava.com — required to read Strava session cookies for heatmap tile authentication and to inject the "Plan Route" button on Strava's global heatmap page.

gis.tallinn.ee — required to fetch bicycle road geodata from Tallinn's public city GIS ArcGIS REST API, displayed as an optional map layer.

squadrats.com — required to read the user's Squadrats UID from localStorage (via content script) so the extension can fetch and display the user's explored squares on the route planning map.
```

### Justification for storage

```
The extension uses chrome.storage.local to persist the user's Squadrats UID across sessions. This avoids re-reading it from the Squadrats website on every use. No personal data, browsing history, or analytics are stored.
```

### Justification for remote code use

```
The extension does not use remote code. All JavaScript is bundled locally (including Leaflet and QRCode.js in the lib/ folder). The extension makes fetch() calls to external APIs for data only:
- brouter.de — route calculation (returns GeoJSON)
- gis.tallinn.ee — bicycle road geodata (returns JSON)
- squadrats.com — explored squares data (returns JSON)
No remotely hosted scripts are loaded or executed.
```

### Data usage certification

Check the box confirming compliance with developer programme policies.

---

## Account tab

**Contact email:** martti.kuldma@omniva.ee

Verify the email after entering it.
