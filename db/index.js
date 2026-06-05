// Database access layer.
// Uses Node's built-in `node:sqlite` (stable in Node 22.5+), so there is no
// native module to compile. Swap this file's internals to switch to Postgres
// later without touching the route handlers.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH ?? join(__dirname, '..', 'radiocalico.db');

export const db = new DatabaseSync(DB_PATH);

// Pragmas suited to local prototyping: WAL for concurrent reads, foreign keys on.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Schema is created on startup if it does not exist yet. For a prototype this
// is simpler than a migration tool; introduce migrations once the schema settles.
export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      artist     TEXT    NOT NULL,
      album      TEXT,
      played_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
