// Radio Calico — TV player. Streams TRT 1 (HLS) through our own server proxy
// at /api/tv/trt1/master.m3u8 so playback is consistent regardless of the
// CDN's CORS/edge behaviour. When the server is hosted in-region, the proxy
// is also what makes the channel reachable from blocked locations.
const STREAM_URL = '/api/tv/trt1/master.m3u8';

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('tv-overlay');
const startBtn = $('tv-start');
const statusEl = $('tv-status');
const qualitySelect = $('quality');

let hls = null;
let started = false;

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

function hideOverlay() {
  overlay.classList.add('hidden');
}
function showOverlay() {
  overlay.classList.remove('hidden');
}

function start() {
  if (started) return;
  started = true;
  setStatus('Connecting…');

  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      // Start at the highest rendition (HD) rather than ramping up.
      startLevel: -1,
      capLevelToPlayerSize: false,
    });
    hls.loadSource(STREAM_URL);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      buildQualityMenu(data.levels);
      // Prefer the highest-resolution level for "high quality".
      const best = data.levels.reduce(
        (hi, lvl, i) => (lvl.height > (data.levels[hi]?.height ?? -1) ? i : hi),
        0
      );
      hls.startLevel = best;
      video.play().then(hideOverlay).catch(() => {
        setStatus('Press play to start');
        showOverlay();
      });
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
      if (qualitySelect.value === 'auto') return;
      // keep the dropdown in sync when ABR is off it stays put
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          setStatus('Network issue — retrying…');
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          break;
        default:
          fail('Stream unavailable. It may be geo-restricted in your region.');
          break;
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari plays HLS natively.
    video.src = STREAM_URL;
    video.play().then(hideOverlay).catch(() => {
      setStatus('Press play to start');
      showOverlay();
    });
  } else {
    fail('Your browser cannot play HLS video.');
  }
}

function fail(msg) {
  started = false;
  setStatus(msg);
  showOverlay();
}

// Quality menu: Auto + each rendition by height.
function buildQualityMenu(levels) {
  qualitySelect.innerHTML = '<option value="auto">Auto</option>';
  levels.forEach((lvl, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)} kbps`;
    qualitySelect.appendChild(opt);
  });
  // Reflect "highest" as the active selection.
  qualitySelect.value = String(
    levels.reduce((hi, lvl, i) => (lvl.height > (levels[hi]?.height ?? -1) ? i : hi), 0)
  );
}

qualitySelect.addEventListener('change', () => {
  if (!hls) return;
  const v = qualitySelect.value;
  hls.currentLevel = v === 'auto' ? -1 : Number(v); // -1 = ABR auto
});

startBtn.addEventListener('click', start);
video.addEventListener('playing', () => { hideOverlay(); setStatus(''); });
video.addEventListener('waiting', () => setStatus('Buffering…'));
