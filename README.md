# WaveHub

A local prototype web stack: an Express server serving a static front-end with
a **lossless radio** player and a **live TV** player (TRT 1, Bloomberg HT,
NOW TV, and configurable subscription channels), backed by SQLite.

> Logo and name are placeholders and will change.

## Run

```bash
npm install
npm run seed     # populate sample radio tracks
npm start        # http://localhost:3000
npm run dev      # same, with auto-restart
```

## Pages

- `/` — start page; choose **Radio** or **TV**
- `/radio.html` — lossless HLS radio player with live now-playing + ratings
- `/tv.html` — live TV player with a channel switcher. Free-to-air channels
  (**TRT 1**, **Bloomberg HT**, **NOW TV**) play out of the box; the subscription channels
  (**S Sport**, **S Sport 2**, **S Sport+**) need configuring (see below)

## Live TV & geo-restrictions (important)

The TV player streams TRT 1 over HLS **through this server**, not directly from
the broadcaster's CDN:

```
browser → /api/tv/trt1/master.m3u8 → Express proxy → tv-trt1.medya.trt.com.tr
```

Why it's a server proxy and not a direct embed: **a webpage cannot change the
viewer's IP address.** Geo-blocking is enforced by the broadcaster's CDN based
on where the request originates. So:

- **Hosted locally / outside the allowed region:** the proxy egresses from your
  machine's IP. It gives stable CORS and a single origin, but it does **not**
  bypass geo-blocking — if TRT blocks your location, playback still fails.
- **Hosted on a server inside the allowed region (e.g. a Turkey-based host):**
  the CDN sees the *server's* in-region IP, so the channel becomes reachable for
  every visitor worldwide. **This is the supported way to watch from a blocked
  location.** Deploy this app there and point viewers at it.

The upstream URL per channel is overridable via environment variable, so you can
swap endpoints without code changes:

```bash
TRT1_UPSTREAM=https://tv-trt1.medya.trt.com.tr npm start
```

Channels live in one registry, `tv/channels.js`; the front-end reads the list
from `GET /api/tv`, so adding a channel is a single entry there (no front-end
edits). `GET /api/tv` returns each channel's id, label, and proxied manifest
URL — upstream hosts are never exposed to the browser.

### Bloomberg HT (free-to-air, works out of the box)

A second free-to-air channel and a real example of the multi-host/rewrite
path: its master playlist is on `ciner.daioncdn.net` but segments are served
from `ciner-live.daioncdn.net`, so the channel ships with that segment host
allowlisted (`hosts: ['ciner-live.daioncdn.net']`), which auto-enables manifest
rewriting. No token or DRM, and the endpoint is globally reachable, so it plays
without any env configuration.

### NOW TV (free-to-air, works out of the box)

NOW TV (the national entertainment channel formerly known as Fox TV Türkiye) is
free-to-air with no token or DRM. It's served from EkoCDN (`ercdn.net`) and —
unlike Bloomberg HT — its master, variant playlists, and segments are all
relative, same-host URIs, so it uses the cheap **path-preserving** mode like
TRT 1 (no host allowlist or manifest rewriting). The default upstream host and
manifest path look session-/token-derived and may rotate over time; if playback
stops, point it at a fresh endpoint without code changes:

```bash
NOW_UPSTREAM=https://<host> NOW_MANIFEST=<path>/nowtv.m3u8 npm start
```

### S Sport / S Sport 2 / S Sport+

These are **Saran Media subscription channels**, not free-to-air like TRT 1.
They publish no open HLS URL — playback is token/DRM-gated behind a login — so
they ship here with **no default upstream** and appear in the UI marked "needs
configuration" (a small amber dot). Point each at a stream you're authorised to
use and they light up:

```bash
SSPORT_UPSTREAM=https://<host>      \
SSPORT2_UPSTREAM=https://<host>     \
SSPORTPLUS_UPSTREAM=https://<host>  \
  npm start
```

The same geo-restriction reality applies: only an in-region (and, for these,
authorised) source will actually play. If you run the app locally outside
Turkey, route upstream fetches through a Turkey egress proxy (see **Outbound
proxy** below) — the browser still talks to `localhost`, but manifest/segment
requests to the CDN leave via the proxy.

#### Per-channel tuning (env)

Real broadcaster streams (Brightcove/Akamai etc.) often need more than a bare
URL. Every channel reads these, prefixed by its id upper-cased (`SSPORT_*`,
`SSPORT2_*`, `TRT1_*`, …):

| Var            | Purpose                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `*_UPSTREAM`   | Origin base URL of the channel's HLS CDN.                               |
| `*_MANIFEST`   | Master playlist path relative to upstream (default `master.m3u8`; may be a deep path). |
| `*_REFERER`    | Sent as the `Referer` request header upstream (many CDNs gate on it).  |
| `*_ORIGIN`     | Sent as the `Origin` request header upstream.                          |
| `*_HOSTS`      | Comma-separated **extra** hostnames the proxy may fetch from — for segments served by a different CDN host than the manifest. |
| `*_REWRITE`    | `1` to rewrite manifest bodies so child URIs route back through the proxy. Needed when a stream uses **absolute** or **cross-host** URLs. Auto-on whenever `*_HOSTS` is set. |
| `*_PROXY`      | Outbound proxy for upstream CDN fetches (`http://`, `https://`, `socks5://`, `socks5h://`). Falls back to `TV_PROXY` when unset. |
| `TV_PROXY`     | Default outbound proxy for every channel that does not set its own `*_PROXY`. |

Example for a tokenised, multi-host stream:

```bash
SSPORT_UPSTREAM=https://cdn-a.example.com \
SSPORT_MANIFEST=live/eventid/master.m3u8 \
SSPORT_REFERER=https://www.ssport.example/ \
SSPORT_HOSTS=seg-b.example.com,key-c.example.com \
  npm start
```

How the proxy handles manifests:

- **Default (path-preserving):** child URIs are relative, so the body is
  streamed untouched and the browser resolves children back through the proxy.
  This is what TRT 1 uses.
- **Rewriting (`*_REWRITE`/`*_HOSTS`):** the manifest is buffered and every
  child URI is resolved and, if its origin is allowlisted (`*_UPSTREAM` +
  `*_HOSTS`), rewritten to flow back through this proxy. Non-allowlisted hosts
  are left as direct links (never proxied — SSRF guard). Tokens carried in the
  child URLs are preserved.

Still out of scope: **DRM** (Widevine/FairPlay). If the stream is
license-encrypted rather than just token-gated, this proxy won't decrypt it.

#### Outbound proxy (watch geo-blocked channels from abroad)

When the app runs on your local machine, upstream HLS fetches use your PC's IP
unless you set an outbound proxy. Only **server-side** CDN requests go through
the proxy — your browser still opens `http://localhost:3000`.

Supported proxy URLs:

- `http://host:port` / `https://host:port` — HTTP CONNECT
- `socks5://host:port` / `socks5h://host:port` — SOCKS5 (`socks5h` resolves
  DNS on the proxy; prefer this for geo-blocked CDNs)

Example — S Sport from Germany via a Turkey SOCKS proxy, with a captured m3u8:

```bash
SSPORT_UPSTREAM=https://<cdn-host> \
SSPORT_MANIFEST=<path>/master.m3u8?token=<…> \
SSPORT_REFERER=https://www.ssportplus.com/ \
SSPORT_ORIGIN=https://www.ssportplus.com \
SSPORT_PROXY=socks5h://user:pass@tr-proxy.example:1080 \
  npm start
```

Set `TV_PROXY=…` instead of `SSPORT_PROXY` to apply one proxy to all channels.
Manifest tokens still expire — recapture from ssportplus.com (through the same
Turkey proxy in a browser, or while a capture VPN is up) and update
`SSPORT_MANIFEST` when playback stops.

## Quick checks

```bash
curl localhost:3000/api/health
curl localhost:3000/api/tracks
curl -s localhost:3000/api/tv/trt1/master.m3u8 | head
```
