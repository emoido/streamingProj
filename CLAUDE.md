# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Radio Calico — a local prototype web stack for a website being built. Express
serves a static front-end plus a small JSON API backed by SQLite.

## Commands

```bash
npm install      # install dependencies (Express only)
npm run seed     # reset + populate radiocalico.db with sample tracks
npm start        # run the server at http://localhost:3000
npm run dev      # same, with --watch auto-restart on file changes
```

There is no test runner or linter configured yet.

Quick API check while the server runs:
```bash
curl localhost:3000/api/health
curl localhost:3000/api/tracks
```

## Architecture

- **`server.js`** — Express entry point. Mounts the JSON API under `/api`
  (defined inline via an `express.Router`) and serves `public/` as static
  files. Calls `migrate()` on startup. Port comes from `PORT` (default 3000).
- **`db/index.js`** — the single database boundary. Exports a `db` connection
  and `migrate()`. Uses Node's built-in **`node:sqlite`** (`DatabaseSync`) — no
  native module to compile, requires Node ≥ 22.5 (this machine runs Node 26).
  To move off SQLite later (e.g. Postgres), reimplement this file; route
  handlers in `server.js` should not need to change.
- **`db/seed.js`** — standalone script that runs `migrate()` then replaces all
  `tracks` rows with sample data.
- **`public/`** — static front-end (`index.html`, `style.css`, `app.js`). The
  page fetches `/api/tracks` client-side; there is no server-side rendering.

## Conventions

- ESM throughout (`"type": "module"`); use `import`, and derive `__dirname`
  from `import.meta.url` (Node has no `__dirname` in ESM).
- The schema is created idempotently via `CREATE TABLE IF NOT EXISTS` in
  `migrate()` — there is no migration tool. Add new tables/columns there for
  now; introduce real migrations once the schema stabilizes.
- The SQLite files (`radiocalico.db`, `-wal`, `-shm`) are gitignored and
  regenerable via `npm run seed` — never commit them.
