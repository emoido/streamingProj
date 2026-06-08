# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Radio Calico — a local prototype web stack for a website being built. Express
serves a static front-end (a lossless **radio** player and a live **TV** player)
plus a small JSON API backed by SQLite. The brand name/logo are placeholders and
will change.

## Commands

```bash
npm install      # install dependencies (Express, undici, fetch-socks)
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
  (defined inline via an `express.Router`), the live-TV proxy under
  `/api/tv/:channel`, and serves `public/` as static files. Calls `migrate()`
  on startup. Port comes from `PORT` (default 3000).
- **`tv/channels.js`** — the channel registry (single source of truth). Each
  channel resolves from env, prefixed by its id upper-cased: `*_UPSTREAM`,
  `*_MANIFEST`, `*_REFERER`, `*_ORIGIN`, `*_HOSTS` (extra allowed segment
  hosts), `*_REWRITE` (rewrite manifest URIs through the proxy; auto-on when
  `*_HOSTS` is set), `*_PROXY` / `TV_PROXY` (outbound HTTP/SOCKS proxy for
  upstream CDN fetches). `allowedOrigins(ch)` returns the SSRF allowlist (upstream
  origin + extra hosts). `channelList()` exposes a browser-safe view (id, label,
  proxied manifest URL, `ready` flag) — upstream hosts and headers are never
  sent to the client. TRT 1 and Bloomberg HT are free-to-air and ship with
  working defaults (Bloomberg HT also defaults a segment host into the
  allowlist, exercising the rewrite path); the S Sport channels are
  subscription/DRM-gated and default to an empty upstream (`ready: false`)
  until configured.
- **`tv/upstream-fetch.js`** — outbound `fetch` wrapper; optional per-channel
  HTTP/SOCKS dispatcher (`*_PROXY` / `TV_PROXY`) for geo-blocked upstreams.
- **`tv/proxy.js`** — HLS reverse proxy for live TV channels. Reads `CHANNELS`
  from `tv/channels.js`. The front-end streams through this rather than hitting
  the broadcaster CDN directly. Key point: it only defeats geo-blocking when
  upstream fetches egress from the allowed region (host the app there, or set
  `*_PROXY`) — a webpage can't change the
  viewer's IP. Two manifest modes: **path-preserving** (default; relative URIs
  streamed untouched — TRT 1) and **rewriting** (opt-in; buffers the manifest
  and routes every allowlisted child URI back through the proxy via a
  `?__abs=<base64url>` param — needed for absolute / cross-host streams like
  Brightcove). Unknown channel → 404; known but unconfigured (no upstream) →
  503. See `README.md`.
- **`db/index.js`** — the single database boundary. Exports a `db` connection
  and `migrate()`. Uses Node's built-in **`node:sqlite`** (`DatabaseSync`) — no
  native module to compile, requires Node ≥ 22.5 (this machine runs Node 26).
  To move off SQLite later (e.g. Postgres), reimplement this file; route
  handlers in `server.js` should not need to change.
- **`db/seed.js`** — standalone script that runs `migrate()` then replaces all
  `tracks` rows with sample data.
- **`public/`** — static front-end, no server-side rendering. `index.html` is
  the radio/TV chooser; `radio.html` + `app.js` is the radio player (fetches
  `/api/tracks` and station metadata client-side); `tv.html` + `tv.js` is the
  live-TV player — it fetches the channel list from `/api/tv`, renders a channel
  switcher, and plays the selected channel (hls.js video via the
  `/api/tv/<id>/` proxy). `WaveHubLogo.png` is the brand logo; `style.css` is shared.

## Conventions

- ESM throughout (`"type": "module"`); use `import`, and derive `__dirname`
  from `import.meta.url` (Node has no `__dirname` in ESM).
- The schema is created idempotently via `CREATE TABLE IF NOT EXISTS` in
  `migrate()` — there is no migration tool. Add new tables/columns there for
  now; introduce real migrations once the schema stabilizes.
- The SQLite files (`radiocalico.db`, `-wal`, `-shm`) are gitignored and
  regenerable via `npm run seed` — never commit them.

## Security posture (don't regress)

- `server.js` sets a hand-rolled CSP + security headers tuned to exactly what
  the app loads (self, jsdelivr for hls.js, Google Fonts, the CloudFront host).
  If you add a script/style/media/connect source, update the CSP or it breaks.
- `hls.js` is loaded from a CDN with an **SRI** `integrity` hash in `radio.html`
  and `tv.html`; bump the hash if you change the version.
- `tv/proxy.js` is hardened against SSRF: it only fetches origins in the
  channel's allowlist (`allowedOrigins` = upstream + `*_HOSTS`), only HLS file
  types (`ALLOWED_FILE`), rejects `..`, validates the decoded `?__abs=` target's
  protocol/origin/path, and follows **redirects within the allowlist only**.
  Keep these guards if you extend it — every externally-reachable target (path
  or `__abs`) must be allowlist-checked before fetch.
- API writes validate types and cap field/key length; `express.json` is limited
  to 16 kb. Ratings have no server-side dedupe (the localStorage guard is
  client-side only) — vote-stuffing is a known, accepted prototype limitation.
