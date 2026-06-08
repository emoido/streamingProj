// HLS reverse proxy for live TV channels.
//
// Why this exists: a browser fetching a geo-restricted stream uses the
// VIEWER's IP, so a front-end alone can't unblock anything. Routing playback
// through this server means the *server's* IP is what the CDN sees — so when
// this app is hosted in-region (e.g. a Turkey-based host for TRT), the channel
// becomes reachable for every visitor. Hosted locally it still helps by giving
// the player a single, CORS-stable origin. Per-channel outbound proxies
// (<ID>_PROXY / TV_PROXY) let upstream fetches egress via another region while
// the app runs on your machine.
//
// Two manifest-handling modes:
//  - Path-preserving (default): HLS manifests reference children with RELATIVE
//    URLs, so we forward `/<path>` straight to the upstream and stream the body
//    untouched. Cheapest; used by TRT 1.
//  - Rewriting (opt-in per channel via `rewrite`): we buffer the manifest and
//    rewrite every child URI to flow back through this proxy. Needed when a
//    channel uses ABSOLUTE URLs or serves segments from a DIFFERENT CDN host
//    (e.g. Brightcove/Akamai) — those would otherwise be fetched directly by
//    the browser, defeating the proxy.
import { Readable } from 'node:stream';
import { CHANNELS, allowedOrigins } from './channels.js';
import { proxyDispatcher, upstreamFetch } from './upstream-fetch.js';

// Some CDNs reject requests without a browser-like UA / Referer.
const BASE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: '*/*',
};

// Only HLS playlist/segment/key files may be proxied. This keeps the proxy
// from being used to fetch arbitrary upstream resources.
const ALLOWED_FILE = /\.(m3u8|ts|aac|mp4|m4s|key)(\?|$)/i;

// Fetch, following only redirects that stay within the channel's allowed
// origins. Default redirect handling would let an upstream 3xx point us at an
// internal address (SSRF); we refuse to leave the allowlist.
async function fetchAllowed(url, allowed, opts, max = 3) {
  let current = url;
  for (let hop = 0; hop <= max; hop++) {
    const res = await upstreamFetch(current, { ...opts, redirect: 'manual' });
    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.has('location');
    if (!isRedirect) return res;
    const next = new URL(res.headers.get('location'), current);
    if (!allowed.has(next.origin)) {
      throw Object.assign(new Error('redirect outside allowlist blocked'), { code: 'BLOCKED_REDIRECT' });
    }
    current = next;
  }
  throw Object.assign(new Error('too many redirects'), { code: 'TOO_MANY_REDIRECTS' });
}

// Resolve one manifest URI against the manifest's own URL, then either route it
// back through this proxy (if its origin is allowlisted) or leave it as a
// resolved absolute URL (non-allowlisted host — the browser fetches it directly
// and we never proxy an unvetted origin).
function proxyUri(rawUri, manifestUrl, channelId, allowed) {
  let resolved;
  try {
    resolved = new URL(rawUri, manifestUrl);
  } catch {
    return rawUri;
  }
  if (!/^https?:$/.test(resolved.protocol)) return rawUri;
  if (!allowed.has(resolved.origin)) return resolved.href;
  const enc = encodeURIComponent(Buffer.from(resolved.href).toString('base64url'));
  return `/api/tv/${channelId}/?__abs=${enc}`;
}

// Rewrite an HLS manifest so every allowlisted child URI (variant playlists,
// segments, EXT-X-KEY/MAP/MEDIA URIs) is proxied. Exported for unit testing.
export function rewriteManifest(text, manifestUrl, channelId, allowed) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (line === '') return line;
      if (line.startsWith('#')) {
        // Attributes like URI="enc.key" / URI="init.mp4" inside #EXT-X-* tags.
        return line.replace(/URI="([^"]*)"/g, (_m, u) => `URI="${proxyUri(u, manifestUrl, channelId, allowed)}"`);
      }
      return proxyUri(line, manifestUrl, channelId, allowed);
    })
    .join('\n');
}

// Express middleware. Mount at `/api/tv/:channel`.
export async function tvProxy(req, res) {
  const channel = CHANNELS[req.params.channel];
  if (!channel) return res.status(404).json({ error: 'unknown channel' });
  // Known channel but no upstream wired up yet (e.g. a subscription channel
  // awaiting a configured SSPORT_UPSTREAM). Treat as not-yet-available.
  if (!channel.upstream) return res.status(503).json({ error: 'channel not configured' });

  const allowed = allowedOrigins(channel);

  // Resolve the upstream target. Two shapes:
  //  - `?__abs=<base64url>`: a child URI we rewrote into an absolute proxied
  //    link (used by `rewrite` channels for cross-host / absolute segments).
  //  - otherwise: path-preserving — the sub-path after the mount point.
  let target;
  const absRaw = typeof req.query.__abs === 'string' ? req.query.__abs : '';
  if (absRaw) {
    try {
      target = new URL(Buffer.from(absRaw, 'base64url').toString());
    } catch {
      return res.status(400).json({ error: 'bad target' });
    }
    if (!/^https?:$/.test(target.protocol)) return res.status(400).json({ error: 'bad target' });
    if (!allowed.has(target.origin)) return res.status(400).json({ error: 'host not allowed' });
    if (!ALLOWED_FILE.test(target.pathname)) return res.status(400).json({ error: 'unsupported path' });
  } else {
    const sub = req.path.replace(/^\/+/, '');
    if (sub.includes('..')) return res.status(400).json({ error: 'bad path' });
    if (!ALLOWED_FILE.test(sub)) return res.status(400).json({ error: 'unsupported path' });
    target = new URL(sub, channel.upstream + '/');
    // Never let a crafted path escape the configured upstream host.
    if (!allowed.has(target.origin)) return res.status(400).json({ error: 'bad path' });
    // Preserve query string (tokens, cache-busters).
    target.search = new URL(req.originalUrl, 'http://x').search;
  }

  // Per-channel upstream headers (some CDNs gate on Referer/Origin).
  const headers = { ...BASE_HEADERS };
  if (channel.referer) headers.Referer = channel.referer;
  if (channel.origin) headers.Origin = channel.origin;

  // Bound only the *connection*, not the body transfer: a too-aggressive
  // whole-request timeout would abort long live segments mid-stream. We clear
  // the timer once headers arrive, then let the body flow freely.
  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(), 15000);
  // If the client (browser/hls.js) goes away, stop pulling from upstream.
  res.on('close', () => controller.abort());

  let upstream;
  try {
    const dispatcher = proxyDispatcher(channel.proxy);
    upstream = await fetchAllowed(target, allowed, {
      headers,
      signal: controller.signal,
      dispatcher,
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

  const isManifest = /mpegurl|m3u8/i.test(type ?? '') || /\.m3u8$/i.test(target.pathname);
  // Manifests are live; don't let intermediaries cache them.
  if (isManifest) res.set('Cache-Control', 'no-store');

  if (!upstream.body) return res.end();

  // Rewriting mode: buffer the (small) manifest, rewrite child URIs, send.
  if (channel.rewrite && isManifest) {
    try {
      const body = await upstream.text();
      res.send(rewriteManifest(body, target.href, req.params.channel, allowed));
    } catch {
      if (!res.headersSent) res.status(502).json({ error: 'upstream error' });
      else if (!res.writableEnded) res.end();
    }
    return;
  }

  // Streaming mode (default + all segments): pipe with explicit error handling
  // so a mid-stream failure (timeout, client disconnect, upstream reset) never
  // becomes an unhandled 'error' event that crashes the process.
  const source = Readable.fromWeb(upstream.body);
  source.on('error', () => res.destroyed || res.destroy());
  res.on('error', () => source.destroy());
  source.pipe(res);
}
