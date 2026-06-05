// Live TV channel registry — the single source of truth shared by the HLS
// proxy (tv/proxy.js) and the channel-list API (server.js).
//
// Each channel has:
//   name      - human label shown in the UI
//   upstream  - origin base URL of the channel's HLS CDN (no trailing path)
//   manifest  - master playlist filename relative to `upstream`
//
// Every upstream is overridable via env so deployments can point a channel at
// an authorised source without code changes (same pattern as TRT1_UPSTREAM).
//
// NOTE ON THE S SPORT CHANNELS: unlike TRT 1 (free-to-air public broadcaster),
// S Sport / S Sport 2 / S Sport+ are Saran Media's *subscription* channels.
// They ship no open HLS URL — playback is token/DRM-gated behind a login. They
// are wired in here but default to an empty upstream (`ready: false`), so the
// UI shows them as "needs configuration" until you supply a legitimate endpoint
// you're authorised to use, e.g.  SSPORT_UPSTREAM=https://… npm start
export const CHANNELS = {
  trt1: {
    name: 'TRT 1',
    upstream: process.env.TRT1_UPSTREAM ?? 'https://tv-trt1.medya.trt.com.tr',
    manifest: process.env.TRT1_MANIFEST ?? 'master.m3u8',
  },
  ssport: {
    name: 'S Sport',
    upstream: process.env.SSPORT_UPSTREAM ?? '',
    manifest: process.env.SSPORT_MANIFEST ?? 'master.m3u8',
  },
  ssport2: {
    name: 'S Sport 2',
    upstream: process.env.SSPORT2_UPSTREAM ?? '',
    manifest: process.env.SSPORT2_MANIFEST ?? 'master.m3u8',
  },
  ssportplus: {
    name: 'S Sport+',
    upstream: process.env.SSPORTPLUS_UPSTREAM ?? '',
    manifest: process.env.SSPORTPLUS_MANIFEST ?? 'master.m3u8',
  },
};

// Public, front-end-safe view of the registry: ids, labels, the proxied
// manifest URL, and whether the channel has an upstream configured. Upstream
// hosts are intentionally NOT exposed.
export function channelList() {
  return Object.entries(CHANNELS).map(([id, c]) => ({
    id,
    name: c.name,
    ready: Boolean(c.upstream),
    src: c.upstream ? `/api/tv/${id}/${c.manifest}` : null,
  }));
}
