// Outbound fetch for tv/proxy.js — optional per-channel HTTP/SOCKS proxy so
// upstream CDN requests egress from another region (e.g. Turkey) while the app
// runs locally elsewhere.
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { socksDispatcher } from 'fetch-socks';

const SOCKS_RE = /^socks[45](h?)?:/i;
const dispatchers = new Map();

// Build (and cache) an undici dispatcher for a proxy URL. Supports:
//   http://  https://          HTTP CONNECT (undici ProxyAgent)
//   socks4:// socks5:// socks5h://   SOCKS (fetch-socks; prefer socks5h so DNS
//                                    resolves on the proxy side)
export function proxyDispatcher(proxyUrl) {
  const key = (proxyUrl ?? '').trim();
  if (!key) return undefined;
  let d = dispatchers.get(key);
  if (!d) {
    d = SOCKS_RE.test(key) ? socksDispatcher(key) : new ProxyAgent(key);
    dispatchers.set(key, d);
  }
  return d;
}

// fetch() to upstream CDNs. Uses undici + dispatcher when proxied, otherwise
// the runtime's native fetch (no extra connection pool for free channels).
export function upstreamFetch(url, opts = {}) {
  const { dispatcher, ...rest } = opts;
  if (dispatcher) return undiciFetch(url, { ...rest, dispatcher });
  return globalThis.fetch(url, rest);
}
