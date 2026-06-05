// Fetches recently played tracks from the API and renders them.
async function loadTracks() {
  const list = document.getElementById('tracks');
  try {
    const res = await fetch('/api/tracks');
    const tracks = await res.json();
    if (!tracks.length) {
      list.innerHTML = '<li class="loading">No tracks yet. Run <code>npm run seed</code>.</li>';
      return;
    }
    list.innerHTML = tracks
      .map(
        (t) => `
        <li>
          <div class="title">${escapeHtml(t.title)}</div>
          <div class="meta">${escapeHtml(t.artist)}${t.album ? ' · ' + escapeHtml(t.album) : ''}</div>
        </li>`
      )
      .join('');
  } catch (err) {
    list.innerHTML = '<li class="loading">Failed to load tracks.</li>';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

loadTracks();
