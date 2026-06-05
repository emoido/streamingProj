# Radio Calico

A local prototype web stack: an Express server serving a static front-end with
a **lossless radio** player and a **live TV** player (TRT 1), backed by SQLite.

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
- `/tv.html` — live TV player for **TRT 1** (HD, up to 720p)

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

Adding more channels later is a one-line entry in `tv/proxy.js` (`CHANNELS`).

## Quick checks

```bash
curl localhost:3000/api/health
curl localhost:3000/api/tracks
curl -s localhost:3000/api/tv/trt1/master.m3u8 | head
```
