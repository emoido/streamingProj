// Radio Calico — local prototype web server.
// Serves a static front-end from /public and a small JSON API backed by SQLite.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, migrate } from './db/index.js';
import { tvProxy } from './tv/proxy.js';
import { channelList } from './tv/channels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;

migrate();

const app = express();

// --- Security headers --------------------------------------------------
// Hand-rolled (no helmet dependency) and scoped to what this app actually
// loads: self, the hls.js CDN, Google Fonts, and the station's CloudFront
// host (HLS + metadata + cover art). hls.js uses blob: workers and MSE.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' https://d3d4yli4hf5bmh.cloudfront.net data:",
  "media-src 'self' blob: https://d3d4yli4hf5bmh.cloudfront.net",
  "connect-src 'self' https://d3d4yli4hf5bmh.cloudfront.net",
  "worker-src blob:",
].join('; ');

app.use((_req, res, next) => {
  res.set('Content-Security-Policy', CSP);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
});

// Small JSON bodies only (votes, track logging).
app.use(express.json({ limit: '16kb' }));

// --- API ---------------------------------------------------------------
const api = express.Router();

api.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// List recently played tracks, newest first.
api.get('/tracks', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM tracks ORDER BY played_at DESC, id DESC')
    .all();
  res.json(rows);
});

// Reject absurdly long free-text fields (storage abuse / DoS surface).
const MAX_FIELD = 300;
const tooLong = (...vals) => vals.some((v) => typeof v === 'string' && v.length > MAX_FIELD);

// Log a track as played.
api.post('/tracks', (req, res) => {
  const { title, artist, album } = req.body ?? {};
  if (!title || !artist) {
    return res.status(400).json({ error: 'title and artist are required' });
  }
  if (tooLong(title, artist, album)) {
    return res.status(400).json({ error: `fields must be <= ${MAX_FIELD} chars` });
  }
  const info = db
    .prepare('INSERT INTO tracks (title, artist, album) VALUES (?, ?, ?)')
    .run(title, artist, album ?? null);
  const created = db
    .prepare('SELECT * FROM tracks WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json(created);
});

// --- Ratings ---------------------------------------------------------
// Thumbs up/down for the currently playing song, keyed by "artist - title".
api.get('/ratings/:key', (req, res) => {
  const row = db
    .prepare('SELECT up, down FROM song_ratings WHERE song_key = ?')
    .get(req.params.key);
  res.json(row ?? { up: 0, down: 0 });
});

api.post('/ratings/:key', (req, res) => {
  const { value } = req.body ?? {};
  if (value !== 1 && value !== -1) {
    return res.status(400).json({ error: 'value must be 1 or -1' });
  }
  if (req.params.key.length > MAX_FIELD) {
    return res.status(400).json({ error: 'key too long' });
  }
  const column = value === 1 ? 'up' : 'down';
  db.prepare(
    `INSERT INTO song_ratings (song_key, ${column}) VALUES (?, 1)
     ON CONFLICT(song_key) DO UPDATE SET ${column} = ${column} + 1`
  ).run(req.params.key);
  const row = db
    .prepare('SELECT up, down FROM song_ratings WHERE song_key = ?')
    .get(req.params.key);
  res.json(row);
});

// Live TV channel list (ids, labels, proxied manifest URLs). Upstream hosts
// are not exposed. Defined before the proxy mount so `/api/tv` is not swallowed
// by the `/api/tv/:channel` matcher.
api.get('/tv', (_req, res) => {
  res.json(channelList());
});

app.use('/api', api);

// --- Live TV proxy -----------------------------------------------------
// Streams HLS channels (TRT 1, S Sport, …) through this server. See
// tv/proxy.js and the registry in tv/channels.js.
app.use('/api/tv/:channel', tvProxy);

// --- Static front-end --------------------------------------------------
app.use(express.static(join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Radio Calico prototype running at http://localhost:${PORT}`);
});
