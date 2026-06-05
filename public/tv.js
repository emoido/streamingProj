// Radio Calico — TV player. Channels are fetched from /api/tv and streamed
// through our own server proxy at /api/tv/<id>/<manifest>, so playback is
// consistent regardless of each CDN's CORS/edge behaviour. When the server is
// hosted in-region, the proxy is also what makes a channel reachable from
// blocked locations.

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('tv-overlay');
const startBtn = $('tv-start');
const startLabel = $('tv-start-label');
const statusEl = $('tv-status');
const qualitySelect = $('quality');
const channelsEl = $('channels');
const channelNameEl = $('channel-name');

let hls = null;
let started = false;
let current = null; // currently selected channel { id, name, ready, src }

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

function hideOverlay() {
  overlay.classList.add('hidden');
}
function showOverlay() {
  overlay.classList.remove('hidden');
}

// --- Channel switching -------------------------------------------------
async function loadChannels() {
  let channels = [];
  try {
    const res = await fetch('/api/tv');
    channels = await res.json();
  } catch {
    setStatus('Could not load channel list.');
    showOverlay();
    return;
  }
  renderChannelTabs(channels);
  // Default to the first channel that has a configured upstream.
  const first = channels.find((c) => c.ready) ?? channels[0];
  if (first) selectChannel(first);
}

function renderChannelTabs(channels) {
  channelsEl.innerHTML = '';
  channels.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'tv-channel';
    btn.textContent = c.name;
    btn.dataset.id = c.id;
    if (!c.ready) {
      btn.classList.add('not-ready');
      btn.title = 'Not configured — supply an upstream URL via env to enable';
    }
    btn.addEventListener('click', () => selectChannel(c));
    channelsEl.appendChild(btn);
  });
}

function selectChannel(channel) {
  if (current && current.id === channel.id) return;
  current = channel;
  channelNameEl.textContent = channel.name;
  startLabel.textContent = `Watch ${channel.name}`;
  startBtn.setAttribute('aria-label', `Play ${channel.name}`);

  // Highlight the active tab.
  [...channelsEl.children].forEach((b) =>
    b.classList.toggle('active', b.dataset.id === channel.id)
  );

  // Tear down any existing playback before loading the new channel.
  teardown();
  qualitySelect.innerHTML = '<option value="auto">Auto</option>';

  if (!channel.ready) {
    fail(`${channel.name} isn't configured yet. See the README to point it at an authorised stream.`);
    return;
  }
  showOverlay();
  setStatus('');
  start(); // auto-start the newly selected channel
}

function teardown() {
  started = false;
  if (hls) {
    hls.destroy();
    hls = null;
  }
  video.removeAttribute('src');
  video.load();
}

// --- Playback ----------------------------------------------------------
function start() {
  if (started || !current || !current.ready) return;
  started = true;
  setStatus('Connecting…');
  const streamUrl = current.src;

  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      // Start at the highest rendition (HD) rather than ramping up.
      startLevel: -1,
      capLevelToPlayerSize: false,
    });
    hls.loadSource(streamUrl);
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
          fail('Stream unavailable. It may be geo-restricted or require a configured source.');
          break;
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari plays HLS natively.
    video.src = streamUrl;
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

loadChannels();
