// Radio Calico — local prototype web server.
// Serves a static front-end from /public and a small JSON API backed by SQLite.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, migrate } from './db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;

migrate();

const app = express();
app.use(express.json());

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

// Log a track as played.
api.post('/tracks', (req, res) => {
  const { title, artist, album } = req.body ?? {};
  if (!title || !artist) {
    return res.status(400).json({ error: 'title and artist are required' });
  }
  const info = db
    .prepare('INSERT INTO tracks (title, artist, album) VALUES (?, ?, ?)')
    .run(title, artist, album ?? null);
  const created = db
    .prepare('SELECT * FROM tracks WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json(created);
});

app.use('/api', api);

// --- Static front-end --------------------------------------------------
app.use(express.static(join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Radio Calico prototype running at http://localhost:${PORT}`);
});
