# Nav snapshot API (Render)

Temporary in-memory storage so phone nav links stay short (`#snap=<uuid>`) while carrying the full route polyline and Squadrats `raw` payload.

## Deploy on Render (free)

1. Create a **Web Service** from this repo.
2. **Root Directory:** `server`
3. **Runtime:** Node
4. **Build Command:** `npm install`
5. **Start Command:** `npm start`
6. Copy the service URL (e.g. `https://bi-router-snap.onrender.com`).

## Configure the extension & nav

Edit the repo root **`config.js`** and set:

```js
globalThis.NAV_SNAPSHOT_BASE = 'https://your-service.onrender.com';
```

Reload the extension; ensure `config.js` loads before `map.js` in `map.html`, and that `nav.html` loads `config.js` before the main script.

## Environment variables (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `SNAPSHOT_TTL_MS` | `86400000` (24h) | Time until a snapshot expires |
| `MAX_BODY_BYTES` | `26214400` (25MB) | Max JSON body for large Squadrats payloads |
| `MAX_SNAPSHOTS` | `8000` | Cap in-memory entries (oldest evicted) |

## API

- `POST /sessions` — body `{ encodedPoly, uid?, raw? }` → `{ id }`
- `GET /sessions/:id` — returns stored JSON (same shape)
- `GET /health` — `{ ok, entries }`

Data is **not** written to disk; Render restarts and cold starts clear the store.
