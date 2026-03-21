/**
 * Ephemeral nav snapshots: full encoded polyline + optional Squadrats uid + raw tile data.
 * In-memory only (lost on restart / Render sleep). No persistence.
 */
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const TTL_MS = Number(process.env.SNAPSHOT_TTL_MS) || 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES) || 25 * 1024 * 1024;
const MAX_ENTRIES = Number(process.env.MAX_SNAPSHOTS) || 8000;

/** @type {Map<string, { payload: object, expires: number }>} */
const store = new Map();

function prune() {
  const now = Date.now();
  for (const [id, row] of store) {
    if (row.expires <= now) store.delete(id);
  }
  while (store.size > MAX_ENTRIES) {
    const first = store.keys().next().value;
    if (first == null) break;
    store.delete(first);
  }
}

setInterval(prune, 60 * 1000).unref();

const app = express();
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400,
  })
);
app.use(express.json({ limit: MAX_BODY_BYTES }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, entries: store.size });
});

app.post('/sessions', (req, res) => {
  prune();
  const { encodedPoly, uid, raw } = req.body || {};
  if (typeof encodedPoly !== 'string' || encodedPoly.length < 4) {
    return res.status(400).json({ error: 'encodedPoly required (encoded route string)' });
  }
  const id = crypto.randomUUID();
  const payload = {
    encodedPoly,
    uid: uid == null ? null : String(uid),
    raw: raw == null ? null : raw,
  };
  store.set(id, { payload, expires: Date.now() + TTL_MS });
  res.status(201).json({ id });
});

app.get('/sessions/:id', (req, res) => {
  prune();
  const row = store.get(req.params.id);
  if (!row || row.expires <= Date.now()) {
    if (row) store.delete(req.params.id);
    return res.status(404).json({ error: 'not found or expired' });
  }
  res.json(row.payload);
});

app.listen(PORT, () => {
  console.log(`nav-snapshots listening on ${PORT} ttl=${TTL_MS}ms maxEntries=${MAX_ENTRIES}`);
});
