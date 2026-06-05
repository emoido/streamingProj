// HLS reverse proxy for live TV channels.
//
// Why this exists: a browser fetching a geo-restricted stream uses the
// VIEWER's IP, so a front-end alone can't unblock anything. Routing playback
// through this server means the *server's* IP is what the CDN sees — so when
// this app is hosted in-region (e.g. a Turkey-based host for TRT), the channel
// becomes reachable for every visitor. Hosted locally it still helps by giving
// the player a single, CORS-stable origin.
//
// The proxy is path-preserving: HLS manifests reference their child playlists
// and segments with RELATIVE URLs, so we can forward `/<path>` straight to the
// upstream without rewriting manifest bodies.
import { Readable } from 'node:stream';
import { CHANNELS } from './channels.js';

// Some CDNs reject requests without a browser-like UA / Referer.
const UPSTREAM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: '*/*',
};

// Only HLS playlist/segment/key files may be proxied. This keeps the proxy
// from being used to fetch arbitrary upstream resources.
const ALLOWED_FILE = /\.(m3u8|ts|aac|mp4|m4s|key)$/i;

// Fetch, following only SAME-ORIGIN redirects. Default redirect handling would
// let an upstream 3xx point us at an internal address (SSRF); we refuse to
// leave the configured upstream origin.
async function fetchSameOrigin(url, baseOrigin, opts, max = 3) {
  let current = url;
  for (let hop = 0; hop <= max; hop++) {
    const res = await fetch(current, { ...opts, redirect: 'manual' });
    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has('location');
    if (!isRedirect) return res;
    const next = new URL(res.headers.get('location'), current);
    if (next.origin !== baseOrigin) {
      throw Object.assign(new Error('cross-origin redirect blocked'), { code: 'BLOCKED_REDIRECT' });
    }
    current = next;
  }
  throw Object.assign(new Error('too many redirects'), { code: 'TOO_MANY_REDIRECTS' });
}

// Express middleware. Mount at `/api/tv/:channel`.
export async function tvProxy(req, res) {
  const channel = CHANNELS[req.params.channel];
  if (!channel) return res.status(404).json({ error: 'unknown channel' });
  // Known channel but no upstream wired up yet (e.g. a subscription channel
  // awaiting a configured SSPORT_UPSTREAM). Treat as not-yet-available.
  const base = channel.upstream;
  if (!base) return res.status(503).json({ error: 'channel not configured' });

  // `req.path` is the part after the mount point, e.g. "/master.m3u8".
  const sub = req.path.replace(/^\/+/, '');
  if (sub.includes('..')) return res.status(400).json({ error: 'bad path' });
  if (!ALLOWED_FILE.test(sub)) {
    return res.status(400).json({ error: 'unsupported path' });
  }

  const baseOrigin = new URL(base).origin;
  const target = new URL(sub, base + '/');
  // Never let a crafted path escape the configured upstream host.
  if (target.origin !== baseOrigin) {
    return res.status(400).json({ error: 'bad path' });
  }
  // Preserve query string (tokens, cache-busters).
  target.search = new URL(req.originalUrl, 'http://x').search;

  // Bound only the *connection*, not the body transfer: a too-aggressive
  // whole-request timeout would abort long live segments mid-stream. We clear
  // the timer once headers arrive, then let the body flow freely.
  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(), 15000);
  // If the client (browser/hls.js) goes away, stop pulling from upstream.
  res.on('close', () => controller.abort());

  let upstream;
  try {
    upstream = await fetchSameOrigin(target, baseOrigin, {
      headers: UPSTREAM_HEADERS,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(connectTimer);
    if (controller.signal.aborted && res.writableEnded) return; // client left
    if (!res.headersSent) {
      const msg =
        err?.name === 'AbortError'
          ? 'upstream timeout'
          : err?.code === 'BLOCKED_REDIRECT'
            ? 'blocked redirect'
            : 'upstream error';
      res.status(502).json({ error: msg });
    }
    return;
  }
  clearTimeout(connectTimer);

  res.status(upstream.status);
  const type = upstream.headers.get('content-type');
  if (type) res.set('Content-Type', type);
  // Allow the player (and any embedding page) to read the response.
  res.set('Access-Control-Allow-Origin', '*');
  // Manifests are live; don't let intermediaries cache them.
  if (/mpegurl|m3u8/i.test(type ?? '') || sub.endsWith('.m3u8')) {
    res.set('Cache-Control', 'no-store');
  }

  if (!upstream.body) return res.end();

  // Pipe with explicit error handling so a mid-stream failure (timeout,
  // client disconnect, upstream reset) never becomes an unhandled 'error'
  // event that crashes the process.
  const source = Readable.fromWeb(upstream.body);
  source.on('error', () => res.destroyed || res.destroy());
  res.on('error', () => source.destroy());
  source.pipe(res);
}
