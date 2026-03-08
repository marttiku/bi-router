# Chrome Web Store Publishing Guide

## Required Assets

### Icons (done)
- `icons/icon-16.png` — toolbar icon
- `icons/icon-48.png` — extensions page
- `icons/icon-128.png` — store listing and install dialog

### Screenshots (you need to capture these)

Chrome Web Store requires **1-5 screenshots** at **1280x800** or **640x400** pixels.

Suggested screenshots:

1. **Route planning view** — show the map with the Strava heatmap overlay, a few waypoints, and a calculated route. Include the sidebar with stats.
2. **Bike roads layer** — toggle on the Tallinn bike roads layer to show the blue road overlay alongside the heatmap.
3. **QR code modal** — click "Send to Phone" with a route planned to show the QR code dialog.
4. **Mobile navigation** — open `nav.html` on your phone (or phone-sized browser window) with a route loaded, showing GPS position and stats.

How to capture at the right size:
- Open DevTools (F12), click the device toolbar icon
- Set dimensions to 1280x800
- Take a screenshot (Cmd+Shift+P → "Capture screenshot")

### Optional: Promotional images
- Small promo tile: 440x280 (shown in store search results)
- Marquee promo: 1400x560 (for featured placement)

## Publishing Steps

1. Go to https://chrome.google.com/webstore/devconsole
2. Pay the one-time $5 registration fee (if not already registered)
3. Click **New Item**
4. Upload a ZIP of the extension folder (exclude `store/`, `.git/`, `nav.html`)
5. Fill in:
   - **Name**: Bi-Router — Strava Heatmap Route Planner
   - **Description**: paste from `store/description.txt`
   - **Category**: Productivity (or Travel)
   - **Language**: English
6. Upload screenshots and icons
7. Set **Visibility**: Public
8. Submit for review (typically 1-3 business days)

## Creating the ZIP

```bash
cd /Users/martti.kuldma/Coding/strava-scraper
zip -r bi-router.zip . \
  -x ".git/*" \
  -x "store/*" \
  -x "nav.html" \
  -x "icons/icon.svg" \
  -x ".gitignore" \
  -x "*.md"
```

Note: `nav.html` is excluded because it's hosted on GitHub Pages, not bundled with the extension.
