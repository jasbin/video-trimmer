// Video Trimmer front end: load a video, pick a section, trim it, manage clips.
const $ = id => document.getElementById(id);
const state = { info: null, duration: 0, start: 0, end: 0, player: null, previewTimer: null, activeClip: null, lastResults: null };

// ---------- time helpers ----------
function parseTime(text) {
  const parts = String(text).trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some(p => p === '' || isNaN(p) || +p < 0)) return null;
  return parts.reduce((total, p) => total * 60 + parseFloat(p), 0);
}
function formatTime(seconds) {
  seconds = Math.max(0, seconds);
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  const sec = Number.isInteger(Math.round(s * 10) / 10) ? String(Math.round(s)).padStart(2, '0')
                                                          : (Math.round(s * 10) / 10).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
const formatSize = b => b < 1e6 ? `${Math.round(b / 1e3)} KB` : `${(b / 1e6).toFixed(1)} MB`;
const formatDate = t => new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

// ---------- segmented controls & appearance: sliding lens ----------
function placeLens(group, target) {
  let lens = group.querySelector(':scope > .lens');
  if (!lens) { lens = document.createElement('span'); lens.className = 'lens'; group.prepend(lens); }
  if (!target || !target.offsetParent) return;
  const first = !lens.dataset.placed, moved = !first && +lens.dataset.x !== target.offsetLeft;
  if (first) lens.style.transition = 'none';
  lens.style.width = target.offsetWidth + 'px';
  lens.style.height = target.offsetHeight + 'px';
  lens.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
  lens.dataset.x = target.offsetLeft;
  if (first) { lens.dataset.placed = 1; lens.offsetWidth; lens.style.transition = ''; }
  if (moved) { lens.classList.add('moving'); clearTimeout(lens._t); lens._t = setTimeout(() => lens.classList.remove('moving'), 420); }
}
function segmented(id, onChange) {
  const group = $(id);
  const select = button => {
    group.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b === button ? 'true' : 'false'));
    placeLens(group, button);
    onChange && onChange(button.dataset.value);
  };
  group.addEventListener('click', e => { const b = e.target.closest('button'); if (b) select(b); });
  return { value: () => group.querySelector('[aria-checked="true"]').dataset.value,
           place: () => placeLens(group, group.querySelector('[aria-checked="true"]')) };
}
function updateMode() {
  const whole = span.value() === 'full', audio = kind.value() === 'audio';
  $('section-card').classList.toggle('whole', whole);
  $('section-controls').setAttribute('aria-disabled', whole ? 'true' : 'false');
  $('precise-row').hidden = whole;  // precise cuts only apply to sections
  $('span-hint').textContent = whole && state.duration ? `${formatTime(state.duration)} · everything` : '';
  // a section covering the entire video downloads the whole thing, so say so
  const everything = whole || (state.duration && state.start <= 0.5 && state.end >= state.duration - 0.5);
  $('trim').textContent = everything ? (audio ? 'Download audio' : 'Download video') : 'Trim clip';
}
const kind = segmented('kind', value => { $('quality-row').hidden = value === 'audio'; updateMode(); });
const quality = segmented('quality');
const span = segmented('span', updateMode);

const appearanceGroup = document.querySelector('.appearance');
function syncAppearance() {
  let current = 'auto';
  try { current = localStorage.getItem('vt-appearance') || 'auto'; } catch (_) {}
  appearanceGroup.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.appearance === current ? 'true' : 'false'));
  placeLens(appearanceGroup, appearanceGroup.querySelector('[aria-pressed="true"]'));
}
appearanceGroup.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const mode = b.dataset.appearance;
  try { localStorage.setItem('vt-appearance', mode); } catch (_) {}
  if (mode === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
  syncAppearance();
});
window.addEventListener('resize', () => { kind.place(); quality.place(); span.place(); syncAppearance(); });

// light that follows the pointer across buttons
document.addEventListener('pointermove', e => {
  const b = e.target.closest && e.target.closest('.btn'); if (!b) return;
  const r = b.getBoundingClientRect();
  b.style.setProperty('--mx', (e.clientX - r.left) + 'px'); b.style.setProperty('--my', (e.clientY - r.top) + 'px');
}, { passive: true });

// ---------- range ----------
function setRange(start, end, from) {
  const d = state.duration || 0;
  start = Math.max(0, Math.min(start, d)); end = Math.max(0, Math.min(end, d));
  if (end - start < 0.1) { if (from === 'start') start = Math.max(0, end - 0.1); else end = Math.min(d, start + 0.1); }
  state.start = start; state.end = end;
  $('range-start').value = start; $('range-end').value = end;
  if (from !== 'start-field') $('start').value = formatTime(start);
  if (from !== 'end-field') $('end').value = formatTime(end);
  $('length').textContent = formatTime(end - start);
  if (typeof updateMode === 'function' && !$('trim').disabled) updateMode();
  const pct = v => d ? (100 * v / d) : 0;
  $('range-fill').style.left = pct(start) + '%'; $('range-fill').style.right = (100 - pct(end)) + '%';
}
$('range-start').addEventListener('input', e => setRange(+e.target.value, state.end, 'start'));
$('range-end').addEventListener('input', e => setRange(state.start, +e.target.value, 'end'));
for (const which of ['start', 'end']) {
  $(which).addEventListener('change', e => {
    const t = parseTime(e.target.value);
    if (t === null) { e.target.value = formatTime(state[which]); return; }
    which === 'start' ? setRange(t, state.end, 'start') : setRange(state.start, t, 'end');
  });
}

// ---------- YouTube player (for "Set to now" and preview) ----------
let ytReady = null;
function loadYouTubeApi() {
  if (!ytReady) ytReady = new Promise(resolve => {
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.append(s);
  });
  return ytReady;
}
// Some videos (often label-owned music) refuse to play in embedded players even though they can be downloaded.
// When the player reports that, show the thumbnail and a note instead; trimming still works.
const EMBED_BLOCKED = new Set([100, 101, 150, 152, 153]);
function setPreviewAvailable(available, videoId) {
  $('editor').classList.toggle('no-player', !available);
  const frame = document.getElementById('player');  // the YouTube API swaps the div for an iframe with this id
  if (frame) frame.style.visibility = available ? '' : 'hidden';
  $('thumb').hidden = available;
  if (!available && videoId) $('thumb').src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  $('preview-note').hidden = available;
}
async function showPlayer(videoId) {
  state.videoId = videoId;
  setPreviewAvailable(true);
  await loadYouTubeApi();
  if (state.player) { state.player.cueVideoById(videoId); return; }
  state.player = new YT.Player('player', {
    videoId,
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
    events: { onError: e => { if (EMBED_BLOCKED.has(e.data)) setPreviewAvailable(false, state.videoId); } },
  });
}
document.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => {
  if (!state.player || !state.player.getCurrentTime) return;
  const now = state.player.getCurrentTime();
  b.dataset.set === 'start' ? setRange(now, Math.max(state.end, now + 0.1), 'start') : setRange(state.start, now, 'end');
}));
function stopPreview() { clearInterval(state.previewTimer); state.previewTimer = null; }
$('preview').addEventListener('click', () => {
  if (!state.player) return;
  stopPreview();
  state.player.seekTo(state.start, true); state.player.playVideo();
  const giveUpAt = Date.now() + (state.end - state.start + 20) * 1000;  // in case playback is paused or stalls
  state.previewTimer = setInterval(() => {
    if (state.player.getCurrentTime() >= state.end) { state.player.pauseVideo(); stopPreview(); }
    else if (Date.now() > giveUpAt) stopPreview();
  }, 100);
});

// ---------- load ----------
const looksLikeLink = text => /^(https?:\/\/|www\.|youtu\.be\/|(m\.)?youtube\.com\/)/i.test(text.trim());
const setLoadLabel = () => { $('load').textContent = looksLikeLink($('url').value) ? 'Load' : 'Search'; };
$('url').addEventListener('input', setLoadLabel);

function setBusy(label) {
  $('load').disabled = !!label; $('load').textContent = label || (looksLikeLink($('url').value) ? 'Load' : 'Search');
}
function showError(message) { $('load-error').textContent = message; $('load-error').hidden = !message; }

async function loadVideo(url) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  showError(''); setBusy('Loading…');
  try {
    const info = await api('/api/probe', { method: 'POST', body: JSON.stringify({ url }) });
    if (info.is_live) throw new Error("This is a live stream. It can be trimmed once the stream has ended.");
    if (!info.duration) throw new Error("Couldn't read this video's length, so it can't be trimmed.");
    stopPreview();
    state.info = { ...info, url }; state.duration = info.duration;
    $('title').textContent = info.title;
    $('meta').textContent = [info.channel, formatTime(info.duration)].filter(Boolean).join(' · ');
    $('info').hidden = false;
    $('results').hidden = true;
    $('back').hidden = !state.lastResults;
    const editor = $('editor');
    editor.classList.remove('disabled'); editor.removeAttribute('aria-disabled');
    editor.classList.toggle('no-player', !info.youtube_id);
    for (const r of ['range-start', 'range-end']) $(r).max = state.duration;
    setRange(0, state.duration);
    if (info.youtube_id) { $('thumb').hidden = true; $('player').hidden = false; showPlayer(info.youtube_id); }
    else { $('player').hidden = true; $('thumb').src = info.thumbnail; $('thumb').hidden = !info.thumbnail; $('preview-note').hidden = true; }
    kind.place(); quality.place(); span.place(); updateMode();
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(null);
  }
}

function renderResults(results) {
  const list = $('results'); list.innerHTML = ''; list.hidden = false;
  if (!results.length) {
    const li = document.createElement('li'); li.className = 'results-status'; li.textContent = 'No videos found.'; list.append(li);
    return;
  }
  for (const r of results) {
    const li = document.createElement('li');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'result';
    b.innerHTML = '<img alt="" loading="lazy"><span class="result-text"><span class="result-title"></span><span class="result-meta"></span></span>';
    b.querySelector('img').src = r.thumbnail;
    b.querySelector('.result-title').textContent = r.title;
    b.querySelector('.result-meta').textContent = [r.channel, r.duration ? formatTime(r.duration) : ''].filter(Boolean).join(' · ');
    b.addEventListener('click', () => { $('url').value = r.url; setLoadLabel(); loadVideo(r.url); });
    li.append(b); list.append(li);
  }
}

// Search: on Enter/Search immediately, or while typing after a short pause (see below)
const searchCache = new Map();
let searchSeq = 0;
async function runSearch(query, { live = false } = {}) {
  const key = query.toLowerCase().split(/\s+/).join(' ');
  const seq = ++searchSeq;
  showError('');
  $('info').hidden = true; $('back').hidden = true;
  const list = $('results');
  if (searchCache.has(key)) { state.lastResults = searchCache.get(key); renderResults(state.lastResults); return; }
  list.hidden = false;
  if (!live || !list.querySelector('.result')) list.innerHTML = '<li class="results-status">Searching YouTube…</li>';
  list.classList.add('searching');
  if (!live) setBusy('Searching…');
  try {
    const results = await api('/api/search', { method: 'POST', body: JSON.stringify({ query }) });
    searchCache.set(key, results);
    if (seq !== searchSeq) return;  // a newer search has started; drop this answer
    state.lastResults = results; renderResults(results);
  } catch (err) {
    if (seq !== searchSeq) return;
    list.hidden = true; showError(err.message);
  } finally {
    if (seq === searchSeq) { list.classList.remove('searching'); if (!live) setBusy(null); }
  }
}

let typingTimer = null;
$('url').addEventListener('input', () => {
  clearTimeout(typingTimer);
  const text = $('url').value.trim();
  if (looksLikeLink(text) || text.length < 3) { if (!text) searchSeq++; return; }
  typingTimer = setTimeout(() => runSearch(text, { live: true }), 600);
});

$('load-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('url').value.trim();
  if (!text) return;
  clearTimeout(typingTimer);
  looksLikeLink(text) ? loadVideo(text) : runSearch(text);
});
$('back').addEventListener('click', () => {
  if (!state.lastResults) return;
  $('info').hidden = true; $('back').hidden = true; renderResults(state.lastResults);
  $('results').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

// ---------- trim ----------
function showResult(name, kindOfClip) {
  $('empty').hidden = true; $('progress').hidden = true; $('output').hidden = false;
  const src = `/clips/${encodeURIComponent(name)}`;
  $('media').innerHTML = '';
  const el = document.createElement(kindOfClip === 'audio' ? 'audio' : 'video');
  el.controls = true; el.playsInline = true; el.preload = 'metadata'; el.src = src;
  $('media').append(el);
  $('output-name').textContent = name;
  $('download').href = src + '?download=true';
  $('download').setAttribute('download', name);
  state.activeClip = name; highlightClip();
}
$('trim').addEventListener('click', async () => {
  if (!state.info) return;
  const whole = span.value() === 'full';
  const body = { url: state.info.url, full: whole, start: whole ? null : state.start, end: whole ? null : state.end,
                 audio: kind.value() === 'audio',
                 precise: $('precise').checked, max_height: quality.value() ? +quality.value() : null };
  $('trim-error').hidden = true; $('empty').hidden = true; $('output').hidden = true; $('progress').hidden = false;
  $('stage').textContent = 'Starting'; $('elapsed').textContent = '0s';
  $('progress-fill').classList.add('indeterminate'); $('progress-fill').style.width = '';
  $('trim').disabled = true; $('trim').textContent = whole ? 'Downloading…' : 'Trimming…';
  try {
    const { id } = await api('/api/trim', { method: 'POST', body: JSON.stringify(body) });
    for (;;) {
      await new Promise(r => setTimeout(r, 700));
      const job = await api(`/api/jobs/${id}`);
      $('stage').textContent = job.stage + (job.percent != null && job.status === 'running' ? ` · ${job.percent}%` : '');
      $('elapsed').textContent = `${Math.round(job.elapsed)}s`;
      if (job.percent != null && job.status === 'running') {
        $('progress-fill').classList.remove('indeterminate'); $('progress-fill').style.width = job.percent + '%';
      }
      if (job.status === 'done') { await refreshClips(); showResult(job.file, body.audio ? 'audio' : 'video'); break; }
      if (job.status === 'error') throw new Error(job.error);
    }
  } catch (err) {
    $('progress').hidden = true; $('empty').hidden = !$('output').hidden || false;
    $('trim-error').textContent = err.message; $('trim-error').hidden = false;
  } finally {
    $('trim').disabled = false; updateMode();
  }
});

// ---------- clips ----------
const ICONS = {
  download: '<svg viewBox="0 0 16 16"><path d="M8 2v8M4.8 6.8L8 10l3.2-3.2M2.5 11.5v1.5h11v-1.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  delete: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
function highlightClip() {
  document.querySelectorAll('#clips li').forEach(li => li.classList.toggle('active', li.dataset.name === state.activeClip));
}
async function refreshClips() {
  const clips = await api('/api/clips');
  const list = $('clips'); list.innerHTML = '';
  $('clips-empty').hidden = clips.length > 0;
  for (const c of clips) {
    const li = document.createElement('li'); li.dataset.name = c.name;
    const main = document.createElement('button'); main.className = 'clip-main'; main.type = 'button';
    main.innerHTML = '<span class="clip-name"></span><span class="clip-meta"></span>';
    main.querySelector('.clip-name').textContent = c.name.replace(/\.[^.]+$/, '');
    main.querySelector('.clip-meta').textContent = `${c.kind === 'audio' ? 'Audio' : 'Video'} · ${formatSize(c.size)} · ${formatDate(c.modified)}`;
    main.addEventListener('click', () => showResult(c.name, c.kind));
    const dl = document.createElement('a'); dl.className = 'icon-btn'; dl.innerHTML = ICONS.download;
    dl.href = `/clips/${encodeURIComponent(c.name)}?download=true`; dl.setAttribute('download', c.name);
    dl.setAttribute('aria-label', `Download ${c.name}`);
    const del = document.createElement('button'); del.className = 'icon-btn delete'; del.type = 'button'; del.innerHTML = ICONS.delete;
    del.setAttribute('aria-label', `Delete ${c.name}`);
    del.addEventListener('click', async () => {
      if (!confirm(`Delete “${c.name}” permanently?`)) return;
      await api(`/api/clips/${encodeURIComponent(c.name)}`, { method: 'DELETE' });
      if (state.activeClip === c.name) { $('output').hidden = true; $('empty').hidden = false; state.activeClip = null; }
      refreshClips();
    });
    li.append(main, dl, del); list.append(li);
  }
  highlightClip();
}

syncAppearance(); kind.place(); quality.place(); span.place(); refreshClips();
