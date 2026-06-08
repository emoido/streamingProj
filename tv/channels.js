// Live TV channel registry — the single source of truth shared by the HLS
// proxy (tv/proxy.js) and the channel-list API (server.js).
//
// Each channel resolves from env (prefix = the channel id upper-cased, e.g.
// `ssport` -> SSPORT_*). Fields:
//   upstream   - <ID>_UPSTREAM  origin base URL of the channel's HLS CDN
//   manifest   - <ID>_MANIFEST  master playlist path relative to `upstream`
//                               (default master.m3u8; may be a deep path)
//   referer    - <ID>_REFERER   sent as the Referer request header upstream
//   origin     - <ID>_ORIGIN    sent as the Origin request header upstream
//   allowHosts - <ID>_HOSTS     comma-separated extra hostnames the proxy may
//                               fetch from (for segments on a different CDN)
//   rewrite    - <ID>_REWRITE   rewrite manifest bodies so child URIs route
//                               back through the proxy (auto-on when allowHosts
//                               is set; needed for absolute / cross-host URLs)
//   proxy      - <ID>_PROXY     outbound HTTP/SOCKS proxy for upstream CDN
//                               fetches (http://, https://, socks5://,
//                               socks5h://). Falls back to TV_PROXY when unset.
//
// NOTE ON THE S SPORT CHANNELS: unlike TRT 1 (free-to-air public broadcaster),
// S Sport / S Sport 2 / S Sport+ are Saran Media's *subscription* channels.
// They ship no open HLS URL — playback is token/DRM-gated behind a login. They
// are wired in here but default to an empty upstream (`ready: false`), so the
// UI shows them as "needs configuration" until you supply a legitimate endpoint
// you're authorised to use, e.g.  SSPORT_UPSTREAM=https://… npm start
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function channel(id, name, defaults = {}) {
  const P = id.toUpperCase();
  const e = process.env;
  const envHosts = (e[`${P}_HOSTS`] ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const allowHosts = envHosts.length ? envHosts : defaults.hosts ?? [];
  const proxy =
    e[`${P}_PROXY`] ?? defaults.proxy ?? e.TV_PROXY ?? '';
  return {
    name,
    upstream: e[`${P}_UPSTREAM`] ?? defaults.upstream ?? '',
    manifest: e[`${P}_MANIFEST`] ?? defaults.manifest ?? 'master.m3u8',
    referer: e[`${P}_REFERER`] ?? defaults.referer ?? '',
    origin: e[`${P}_ORIGIN`] ?? defaults.origin ?? '',
    allowHosts,
    proxy,
    rewrite:
      TRUTHY.has((e[`${P}_REWRITE`] ?? '').toLowerCase()) || allowHosts.length > 0,
  };
}

export const CHANNELS = {
  trt1: channel('trt1', 'TRT 1', { upstream: 'https://tv-trt1.medya.trt.com.tr' }),
  // Bloomberg HT — free-to-air, globally reachable, no token/DRM. The master
  // lives on ciner.daioncdn.net but segments are served from a second host
  // (ciner-live.daioncdn.net), so it ships with that host allowlisted, which
  // auto-enables manifest rewriting.
  bloomberght: channel('bloomberght', 'Bloomberg HT', {
    upstream: 'https://ciner.daioncdn.net',
    manifest: 'bloomberght/bloomberght.m3u8',
    hosts: ['ciner-live.daioncdn.net'],
  }),
  // NOW TV — free-to-air national entertainment channel (ex-Fox TV Türkiye).
  // Served from EkoCDN (ercdn.net); master + variants + segments are all
  // relative, same-host URIs, so this is path-preserving like TRT 1 (no host
  // allowlist / rewrite needed). The upstream host and manifest path look
  // token-ish and may rotate; override NOW_UPSTREAM / NOW_MANIFEST if it drifts.
  now: channel('now', 'NOW TV', {
    upstream: 'https://uycyyuuzyh.turknet.ercdn.net',
    manifest: 'nphindgytw/nowtv/nowtv.m3u8',
  }),
  ssport: channel('ssport', 'S Sport'),
  ssport2: channel('ssport2', 'S Sport 2'),
  ssportplus: channel('ssportplus', 'S Sport+'),
};

// Origins the proxy may fetch from for a channel: its upstream origin plus any
// configured extra hosts. Used for the SSRF host check, redirect following, and
// deciding which manifest URIs to route back through the proxy.
export function allowedOrigins(ch) {
  const set = new Set();
  if (ch.upstream) set.add(new URL(ch.upstream).origin);
  for (const h of ch.allowHosts) {
    set.add(h.includes('://') ? new URL(h).origin : `https://${h}`);
  }
  return set;
}

// Public, front-end-safe view of the registry: ids, labels, the proxied
// manifest URL, and whether the channel has an upstream configured. Upstream
// hosts and per-channel headers are intentionally NOT exposed.
export function channelList() {
  return Object.entries(CHANNELS).map(([id, c]) => ({
    id,
    name: c.name,
    ready: Boolean(c.upstream),
    src: c.upstream ? `/api/tv/${id}/${c.manifest}` : null,
  }));
}
