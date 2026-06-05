// Radio Calico player: HLS playback + live now-playing metadata + ratings.
const STREAM_URL = 'https://d3d4yli4hf5bmh.cloudfront.net/hls/live.m3u8';
const META_URL = 'https://d3d4yli4hf5bmh.cloudfront.net/metadatav2.json';
const COVER_URL = 'https://d3d4yli4hf5bmh.cloudfront.net/cover.jpg';
const META_POLL_MS = 10000;

const $ = (id) => document.getElementById(id);
const audio = $('audio');

// ---------------------------------------------------------------------------
// HLS playback. Prefer the lossless FLAC rendition; fall back to AAC / native.
// ---------------------------------------------------------------------------
let hls = null;

function attachStream() {
  if (audio.dataset.attached) return;
  audio.dataset.attached = '1';

  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true });
    hls.loadSource(STREAM_URL);
    hls.attachMedia(audio);

    // Prefer the highest-quality (lossless FLAC) level once levels are known.
    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      let best = -1, bestBw = -1;
      data.levels.forEach((lvl, i) => {
        const flac = /flac/i.test(lvl.audioCodec || lvl.codecs || '');
        const score = (flac ? 1e9 : 0) + (lvl.bitrate || 0);
        if (score > bestBw) { bestBw = score; best = i; }
      });
      if (best >= 0) hls.currentLevel = best;
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          // If the lossless codec can't be decoded, drop ABR cap and recover.
          hls.currentLevel = -1;
          hls.recoverMediaError();
          break;
        default:
          setStatus('Stream error');
          break;
      }
    });
  } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari plays HLS (and FLAC-in-HLS) natively.
    audio.src = STREAM_URL;
  } else {
    setStatus('HLS not supported');
  }
}

// ---------------------------------------------------------------------------
// Play / pause + volume
// ---------------------------------------------------------------------------
const playBtn = $('play');
const iconPlay = playBtn.querySelector('.icon-play');
const iconPause = playBtn.querySelector('.icon-pause');

playBtn.addEventListener('click', () => {
  attachStream();
  if (audio.paused) {
    audio.play().catch(() => setStatus('Tap play to start'));
  } else {
    audio.pause();
  }
});

audio.addEventListener('playing', () => {
  setPlaying(true);
  setStatus('Live');
});
audio.addEventListener('pause', () => { setPlaying(false); setStatus('Stopped'); });
audio.addEventListener('waiting', () => setStatus('Buffering…'));

function setPlaying(on) {
  iconPlay.hidden = on;
  iconPause.hidden = !on;
  playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
  $('live-dot').hidden = !on;
}
function setStatus(text) { $('status').textContent = text; }

const volume = $('volume');
audio.volume = Number(volume.value);
volume.addEventListener('input', () => { audio.volume = Number(volume.value); });

// ---------------------------------------------------------------------------
// Now-playing metadata (polled)
// ---------------------------------------------------------------------------
let currentKey = null;

async function refreshMetadata() {
  try {
    const res = await fetch(`${META_URL}?t=${Date.now()}`, { cache: 'no-store' });
    const m = await res.json();
    render(m);
  } catch {
    /* keep last-known info on transient failures */
  }
}

function render(m) {
  $('artist').textContent = m.artist || 'Unknown artist';
  $('title').textContent = m.title || '';
  $('album').textContent = [m.album, m.date && `(${m.date})`].filter(Boolean).join(' ');
  $('year').textContent = m.date || '';

  if (m.bit_depth && m.sample_rate) {
    $('source-quality').textContent =
      `${m.bit_depth}-bit / ${(m.sample_rate / 1000).toFixed(m.sample_rate % 1000 ? 1 : 0)} kHz`;
  }
  $('stream-quality').textContent = 'Lossless FLAC (HLS)';

  // Cover art is reused across tracks server-side; bust the cache on change.
  $('cover').src = `${COVER_URL}?t=${Date.now()}`;

  // Previous tracks
  const prev = [];
  for (let i = 1; i <= 5; i++) {
    const a = m[`prev_artist_${i}`], t = m[`prev_title_${i}`];
    if (a && t) prev.push({ artist: a, title: t });
  }
  $('recent-list').innerHTML = prev
    .map((p) => `<li><span class="r-artist">${esc(p.artist)}</span> — ${esc(p.title)}</li>`)
    .join('');

  // Reset rating UI when the song changes.
  const key = `${m.artist} - ${m.title}`;
  if (key !== currentKey) {
    currentKey = key;
    loadRating(key);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Ratings (persisted via our own API; one vote per song per browser)
// ---------------------------------------------------------------------------
const upBtn = $('thumb-up');
const downBtn = $('thumb-down');

function votedValue(key) {
  return localStorage.getItem(`vote:${key}`);
}

async function loadRating(key) {
  upBtn.classList.remove('selected');
  downBtn.classList.remove('selected');
  const mine = votedValue(key);
  upBtn.classList.toggle('selected', mine === '1');
  downBtn.classList.toggle('selected', mine === '-1');
  const locked = mine != null;
  upBtn.disabled = downBtn.disabled = locked;

  try {
    const res = await fetch(`/api/ratings/${encodeURIComponent(key)}`);
    const r = await res.json();
    $('up-count').textContent = r.up ?? 0;
    $('down-count').textContent = r.down ?? 0;
  } catch {
    $('up-count').textContent = '0';
    $('down-count').textContent = '0';
  }
}

async function vote(value) {
  const key = currentKey;
  if (!key || votedValue(key) != null) return;
  localStorage.setItem(`vote:${key}`, String(value));
  (value === 1 ? upBtn : downBtn).classList.add('selected');
  upBtn.disabled = downBtn.disabled = true;
  try {
    const res = await fetch(`/api/ratings/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    const r = await res.json();
    $('up-count').textContent = r.up ?? 0;
    $('down-count').textContent = r.down ?? 0;
  } catch {
    /* leave optimistic UI in place */
  }
}

upBtn.addEventListener('click', () => vote(1));
downBtn.addEventListener('click', () => vote(-1));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
refreshMetadata();
setInterval(refreshMetadata, META_POLL_MS);
