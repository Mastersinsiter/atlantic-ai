/* Atlantic AI — Application Logic 
*/
const API = location.protocol === 'file:' ? 'http://localhost:3000' : '';
let selectedFile = null, pollingIntervals = {}, activeJobId = null;
let selectedClipCount = 'auto'; // 'auto' | number
let selectedLanguage = 'auto'; // 'auto' | 'en' | 'hi' | 'hinglish'

// Ensure PixelWorld receives app state updates
function setWorldState(state) {
  if (window.pixelWorld) window.pixelWorld.setAppState(state);
}

document.addEventListener('DOMContentLoaded', () => {
  checkBackend();
  loadJobs();
  
  // File drag & drop
  const dz = document.getElementById('dashDropZone'), fi = document.getElementById('dashFileInput');
  if(dz) {
    dz.addEventListener('click', () => fi?.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover') });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if(f?.type.startsWith('video/')) {
        selectedFile = f;
        document.getElementById('dashFileName').textContent = `${f.name} (${(f.size/1048576).toFixed(1)} MB)`;
      }
    });
  }
});

setInterval(checkBackend, 15000);

/* ── Language & Clip Count ── */
function setLanguage(val, btn) {
  selectedLanguage = val;
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setClipCount(val, btn) {
  selectedClipCount = val;
  document.querySelectorAll('.clip-cnt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

/* ── Tabs ── */
// NOTE: switchTab is defined in index.html inline <script> (window.switchTab) to match
// the live markup (class .tab, not .tab-btn). The app.js version was dead/broken — removed.
function dashFileSelect(e) {
  const f = e.target.files[0];
  if(!f) return;
  selectedFile = f;
  document.getElementById('dashFileName').textContent = `${f.name} (${(f.size/1048576).toFixed(1)} MB)`;
}

/* ── Watermark Controls ── */
window.uploadedWatermarkPath = null;

function toggleWmFields(enabled) {
  const container = document.getElementById('wmControlsContainer');
  if (container) {
    container.style.opacity = enabled ? '1' : '0.4';
    container.style.pointerEvents = enabled ? 'auto' : 'none';
  }
}

function setWmPreset(type) {
  const input = document.getElementById('wmTextInput');
  if (!input) return;
  const raw = input.value.trim().replace(/^(https?:\/\/)?(www\.)?(twitch\.tv\/|youtube\.com\/@?|@)/i, '');
  const handle = raw || 'yourchannel';
  if (type === 'twitch') input.value = `twitch.tv/${handle}`;
  else if (type === 'youtube') input.value = `youtube.com/@${handle}`;
  else if (type === 'tiktok') input.value = `@${handle}`;
  else input.value = type;
  updateWmPreview();
}

function updateWmPreview() {
  const input = document.getElementById('wmTextInput');
  const previewEl = document.getElementById('wmBadgePreview');
  const text = input?.value?.trim() || '';
  const hasLogo = !!window.uploadedWatermarkPath;

  if (!previewEl) return;

  if (!text && !hasLogo) {
    previewEl.style.background = 'rgba(255,255,255,0.04)';
    previewEl.style.border = '1px dashed var(--glass-border)';
    previewEl.style.color = 'var(--text2)';
    previewEl.style.fontStyle = 'italic';
    previewEl.style.fontWeight = '400';
    previewEl.innerHTML = '<span id="wmBadgeText">Your watermark preview will appear here</span>';
    return;
  }

  previewEl.style.background = 'rgba(255,255,255,0.08)';
  previewEl.style.border = '1px solid rgba(255,255,255,0.2)';
  previewEl.style.color = '#fff';
  previewEl.style.fontStyle = 'normal';
  previewEl.style.fontWeight = '600';

  let icon = '';
  if (hasLogo) {
    icon = '📁 ';
  } else if (/twitch\.tv/i.test(text)) {
    icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:#a855f7;"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.429h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>`;
  } else if (/youtube\.com|youtu\.be/i.test(text)) {
    icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:#ef4444;"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
  } else if (text.startsWith('@')) {
    icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:#06b6d4;"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`;
  }

  const displayText = hasLogo ? (window.uploadedWatermarkName || 'Custom Logo') : text;
  previewEl.innerHTML = `${icon}<span id="wmBadgeText">${displayText}</span>`;
}

async function uploadWmImage(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('watermark', file);
  try {
    const res = await fetch('/api/profile/watermark-image', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success && data.path) {
      window.uploadedWatermarkPath = data.path;
      window.uploadedWatermarkName = file.name;
      const statusEl = document.getElementById('wmImageStatus');
      if (statusEl) {
        statusEl.style.display = 'inline';
        statusEl.textContent = `Logo: ${file.name} ✓`;
      }
      updateWmPreview();
    }
  } catch (err) {
    console.error('Failed to upload watermark image:', err);
  }
}

/* ── Process Options ── */
function getProcessOptions() {
  const reframeToggle = document.querySelector('input[name="reframeMode"]:checked');
  const qualityToggle = document.querySelector('input[name="renderQuality"]:checked');
  const compilationEnabled = document.getElementById('compilationToggle')?.checked || false;
  const maxClips = compilationEnabled ? 15 : (selectedClipCount === 'auto' ? 3 : parseInt(selectedClipCount) || 3);
  const wmEnabled = document.getElementById('wmEnableToggle')?.checked ?? true;
  const wmText = document.getElementById('wmTextInput')?.value?.trim() || '';
  const wmPosition = document.getElementById('wmPositionSelect')?.value || 'bottom-center';
  const resolution = qualityToggle ? qualityToggle.value : '4k';
  const enhance4k = resolution === '4k';

  return {
    compilation: compilationEnabled,
    maxClips,
    clipLength: 60,
    captionStyle: selectedLanguage === 'none' ? 'none' : 'classic',
    contentType: 'auto',
    language: selectedLanguage,
    layoutMode: 'auto',
    reframeMode: reframeToggle ? reframeToggle.value : 'blur-pad',
    resolution,
    enhance4k,
    watermark: {
      enabled: wmEnabled && !!(wmText || window.uploadedWatermarkPath),
      text: wmText,
      image_path: window.uploadedWatermarkPath || null,
      position: wmPosition,
      opacity: 0.9,
      size: 240
    }
  };
}

/* ── Submit — intercept for URL preview ── */
function handleSubmit() {
  const isFile = document.getElementById('tab-file')?.classList.contains('on');
  if (isFile) {
    // File mode: just show a confirmation with filename
    showFilePreview();
  } else {
    // URL mode: show video preview modal
    showUrlPreview();
  }
}

/* ── Extract YouTube video ID from URL ── */
function extractYtId(url) {
  if (!url) return null;
  const m = url.match(/(?:v=|\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/* ── Show URL preview modal ── */
function showUrlPreview() {
  const url = document.getElementById('dashUrl')?.value.trim();
  if (!url) { toast('Paste a video URL first', 'error'); return; }

  const ytId = extractYtId(url);
  const previewContent = document.getElementById('previewContent');
  const previewTitle = document.getElementById('previewTitle');
  const previewClipInfo = document.getElementById('previewClipInfo');

  // Set clip info text
  const clipCount = selectedClipCount === 'auto' ? '3 (auto)' : selectedClipCount;
  previewTitle.textContent = 'Video URL Detected';
  previewClipInfo.textContent = `Will extract ${clipCount} clip${selectedClipCount === 1 ? '' : 's'} from this video`;

  if (ytId) {
    // YouTube: embed iframe
    previewContent.innerHTML = `
      <iframe 
        src="https://www.youtube.com/embed/${ytId}?autoplay=0&rel=0&modestbranding=1"
        style="width:100%;aspect-ratio:16/9;border:none"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
      ></iframe>
    `;
  } else {
    // Non-YouTube URL: show URL with icon
    previewContent.innerHTML = `
      <div style="padding:32px;text-align:center">
        <div style="font-size:48px;margin-bottom:16px">🎬</div>
        <div style="font-family:var(--fm);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--fgm);margin-bottom:8px">Video URL</div>
        <div style="color:var(--fg);font-size:13px;word-break:break-all;opacity:.8">${url}</div>
      </div>
    `;
  }

  openPreviewModal();
}

/* ── Show file preview modal ── */
function showFilePreview() {
  if (!selectedFile) { toast('Select a file first', 'error'); return; }

  const previewContent = document.getElementById('previewContent');
  const previewTitle = document.getElementById('previewTitle');
  const previewClipInfo = document.getElementById('previewClipInfo');
  const clipCount = selectedClipCount === 'auto' ? '3 (auto)' : selectedClipCount;

  previewTitle.textContent = 'Local File Selected';
  previewClipInfo.textContent = `Will extract ${clipCount} clip${selectedClipCount === 1 ? '' : 's'} from this video`;

  // Create object URL for local video preview
  const objUrl = URL.createObjectURL(selectedFile);
  previewContent.innerHTML = `
    <video 
      src="${objUrl}" 
      controls 
      preload="metadata"
      style="width:100%;max-height:240px;border-radius:10px"
    ></video>
  `;

  openPreviewModal();
}

/* ── Modal helpers ── */
function openPreviewModal() {
  const modal = document.getElementById('previewModal');
  const box = document.getElementById('previewBox');
  modal.style.opacity = '1';
  modal.style.pointerEvents = 'all';
  box.style.transform = 'translateY(0)';
}

function closePreviewModal() {
  const modal = document.getElementById('previewModal');
  const box = document.getElementById('previewBox');
  modal.style.opacity = '0';
  modal.style.pointerEvents = 'none';
  box.style.transform = 'translateY(24px)';
  // Clear iframe to stop video
  setTimeout(() => {
    const pc = document.getElementById('previewContent');
    if (pc) pc.innerHTML = '';
  }, 350);
}

/* ✨ Confirmed - now actually process ✨ */
let _processFullVideo = false;
function confirmAndProcess(isFullVideo = false) {
  _processFullVideo = isFullVideo;
  closePreviewModal();
  setTimeout(() => {
    const isFile = document.getElementById('tab-file')?.classList.contains('on');
    if (isFile) {
      dashProcessFile();
    } else {
      dashProcessUrl();
    }
  }, 100);
}

async function dashProcessUrl() {
  const url = document.getElementById('dashUrl').value.trim();
  if(!url) { toast('Paste a video URL first'); return; }
  const btn = document.getElementById('dashProcessBtn');
  btn.disabled = true; btn.classList.add('ld');
  setWorldState('uploading');
  
  try {
    const res = await fetch(`${API}/api/process-yt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        url,
        mode: 'auto',
        source: 'youtube',
        options: {
          ...getProcessOptions(),
          processFullVideo: _processFullVideo
        }
      })
    });
    const data = await res.json();
    if(data.jobId) {
      activeJobId = data.jobId;
      toast('Processing started', 'success');
      showProgress();
      startPolling(data.jobId);
    } else {
      toast('Failed: ' + (data.error || 'Unknown'), 'error');
      setWorldState('error');
    }
  } catch {
    toast('Backend not running', 'error');
    setWorldState('error');
  }
  btn.disabled = false; btn.classList.remove('ld');
}

async function dashProcessFile() {
  if(!selectedFile) { toast('Select a file first'); return; }
  const btn = document.getElementById('dashProcessBtn');
  btn.disabled = true; btn.classList.add('ld');
  setWorldState('uploading');

  const fd = new FormData();
  fd.append('video', selectedFile);
  fd.append('options', JSON.stringify({
    ...getProcessOptions(),
    processFullVideo: _processFullVideo
  }));
  
  try {
    const res = await fetch(`${API}/api/process-file`, { method: 'POST', body: fd });
    const data = await res.json();
    if(data.jobId) {
      activeJobId = data.jobId;
      toast('Upload started', 'success');
      showProgress();
      startPolling(data.jobId);
    } else {
      toast('Failed: ' + (data.error || 'Unknown'), 'error');
      setWorldState('error');
    }
  } catch {
    toast('Cannot connect', 'error');
    setWorldState('error');
  }
  btn.disabled = false; btn.classList.remove('ld');
}

/* ── Polling ── */
function startPolling(id) {
  if(pollingIntervals[id]) return;
  pollingIntervals[id] = setInterval(() => pollJob(id), 2500);
}

// NOTE: pollJob is defined in index.html inline <script> (window.pollJob) which updates the
// forge overlay. The app.js version was dead (the override never calls _origPollJob) — removed.
// startPolling is kept; its arrow closure resolves pollJob dynamically, picking up window.pollJob.
async function loadJobs() {
  try {
    const res = await fetch(`${API}/api/jobs`);
    const jobs = await res.json();
    const list = document.getElementById('jobsList');
    list.innerHTML = '';
    if(!jobs.length) {
      list.innerHTML = '<p>No projects yet.</p>';
      return;
    }
    jobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'job-card';
      card.innerHTML = `<div style="display:flex;justify-content:space-between">
        <strong>${job.videoTitle || job.url || 'Upload'}</strong>
        <span style="color:var(--accent-blue)">${job.status}</span>
      </div>`;
      list.appendChild(card);
      if(job.status === 'processing' || job.status === 'queued') startPolling(job.id);
    });
  } catch {}
}

function handleAwaitingFraming(job) {
  if (job.clips && job.clips.length === 1) {
    if (typeof window.openNewEditor === 'function') {
      window.openNewEditor(job.id, 0);
    } else {
      toast('Editor component not found', 'error');
    }
  } else {
    showResults(job);
  }
}

/* ── UI Transitions ── */
function showProgress() {
  document.getElementById('input-section').classList.remove('active');
  document.getElementById('progress-section').classList.add('active');
  document.getElementById('results-section').classList.remove('active');
}

// NOTE: showResults and resetToInput are defined in index.html inline <script>
// (window.showResults / window.resetToInput) which use the new results UI + forge overlay.
// The app.js versions were dead (overridden at runtime) — removed. Callers in app.js
// (handleAwaitingFraming) resolve them dynamically via window.*, picking up the overrides.
/* ── Utils ── */
let toastTimer;
function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

async function checkBackend() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    const r = await fetch(`${API}/api/health`, { signal: c.signal });
    clearTimeout(t);
    if(!r.ok) throw 0;
  } catch {
    toast('Backend offline — please run server.js', 'error');
  }
}

/* ── Editor Modal Logic ── */
let currentClip = null;
let clipDataMap = {};
let subtitles = [];
let audioContext = null;

// ── Layout & Keyframe State ──
let selectedLayout = 'blur-pad';
let reframeKeyframes = []; // Array<{ id, time, cropX }>  cropX: 0 = left, 0.5 = center, 1 = right

function setLayout(mode, btn) {
  selectedLayout = mode;
  document.querySelectorAll('.layout-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  updateOverlay();
}

function addReframeKeyframe() {
  const video = document.getElementById('editorVideo');
  const t = Math.round(video.currentTime * 100) / 100;

  // Don't add duplicate at same timestamp
  if (reframeKeyframes.some(kf => Math.abs(kf.time - t) < 0.1)) {
    toast('Keyframe already exists near this time', 'error');
    return;
  }

  // Default cropX based on current layout
  let defaultCropX = 0.5;
  if (selectedLayout === 'focus-left') defaultCropX = 0;
  else if (selectedLayout === 'focus-right') defaultCropX = 1;

  reframeKeyframes.push({ id: Date.now(), time: t, cropX: defaultCropX });
  reframeKeyframes.sort((a, b) => a.time - b.time);
  renderKeyframeList();
  renderKeyframeMarkers();
}

function deleteReframeKeyframe(index) {
  reframeKeyframes.splice(index, 1);
  renderKeyframeList();
  renderKeyframeMarkers();
}

function updateKeyframeCropX(index, value) {
  reframeKeyframes[index].cropX = parseFloat(value);
  const label = document.getElementById(`kf-pos-label-${index}`);
  if (label) {
    const pct = Math.round(parseFloat(value) * 100);
    label.textContent = pct + '%';
  }
}

function renderKeyframeList() {
  const list = document.getElementById('keyframeList');
  if (!list) return;

  if (reframeKeyframes.length === 0) {
    list.innerHTML = '<div class="keyframe-empty">No keyframes — static layout will be used</div>';
    return;
  }

  list.innerHTML = reframeKeyframes.map((kf, i) => {
    const pct = Math.round(kf.cropX * 100);
    return `
    <div class="keyframe-item">
      <div class="kf-diamond"></div>
      <span class="kf-time">${formatTime(kf.time)}</span>
      <button class="kf-seek" onclick="seekTo(${kf.time})">▶</button>
      <input type="range" class="kf-pos-slider" min="0" max="1" step="0.01" value="${kf.cropX}"
        oninput="updateKeyframeCropX(${i}, this.value)">
      <span class="kf-pos-label" id="kf-pos-label-${i}">${pct}%</span>
      <button class="kf-del" onclick="deleteReframeKeyframe(${i})">✕</button>
    </div>`;
  }).join('');
}

function renderKeyframeMarkers() {
  // Remove existing markers
  document.querySelectorAll('.kf-marker').forEach(m => m.remove());

  const scrubber = document.getElementById('videoScrubber');
  const video = document.getElementById('editorVideo');
  if (!scrubber || !video || !video.duration) return;

  // Wrap scrubber in a relative container if not already
  let container = scrubber.parentElement;
  if (!container.classList.contains('scrubber-container')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'scrubber-container';
    wrapper.style.cssText = 'flex:1;position:relative;';
    container.insertBefore(wrapper, scrubber);
    wrapper.appendChild(scrubber);
    container = wrapper;
  }

  reframeKeyframes.forEach(kf => {
    const pct = (kf.time / video.duration) * 100;
    const marker = document.createElement('div');
    marker.className = 'kf-marker';
    marker.style.left = `${pct}%`;
    container.appendChild(marker);
  });
}

let editorStyle = {
  font: 'Impact',
  color: '#ffffff',
  outline: 2,
  shadow: 5,
  size: 48,
  posY: 80,
  animation: 'none'
};

let watermarkStyle = {
  text: '',
  pos: 'br',
  opacity: 50,
  size: 24
};

function openEditor(id, url, title) {
  const clipInfo = clipDataMap[id] || {};
  currentClip = { id, url, title, ...clipInfo };
  document.getElementById('editorClipTitle').textContent = title || 'Clip';
  const video = document.getElementById('editorVideo');
  video.src = API + url;

  const duration = currentClip.end > currentClip.start ? (currentClip.end - currentClip.start) : 60;

  // PRIORITY 1: pre-built cues from backend (ElevenLabs or Gemini word-timestamp accurate)
  if (currentClip.cues && currentClip.cues.length > 0) {
    subtitles = currentClip.cues.map((cue, i) => ({
      id: Date.now() + i,
      start: cue.start,
      end: cue.end,
      text: cue.text
    }));

  // PRIORITY 2: word-level timestamps, rebuild cues client-side (3 words per chunk)
  } else if (currentClip.words && currentClip.words.length > 2) {
    const clipStart = currentClip.start || 0;
    const wordsPerChunk = 3;
    const words = currentClip.words
      .filter(w => w.t >= clipStart - 0.5 && w.t <= clipStart + duration + 0.5)
      .sort((a, b) => a.t - b.t);

    subtitles = [];
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      const chunk = words.slice(i, i + wordsPerChunk);
      const start = Math.max(0, chunk[0].t - clipStart);
      const nextWord = words[i + wordsPerChunk];
      const end = nextWord
        ? Math.min(nextWord.t - clipStart - 0.05, duration - 0.02)
        : Math.min(duration - 0.02, start + 2.5);
      if (end > start) {
        subtitles.push({
          id: Date.now() + i,
          start: Math.round(start * 100) / 100,
          end: Math.round(end * 100) / 100,
          text: chunk.map(w => w.word).join(' ')
        });
      }
    }

  // PRIORITY 3: flat transcript, speech-rate heuristic, 3 words per chunk
  } else if (currentClip.transcript && currentClip.transcript.trim()) {
    const words = currentClip.transcript.trim().split(/\s+/).filter(w => w.length > 0);
    const wordsPerChunk = 3;
    const estimatedDur = Math.min(words.length / 2.5, duration * 0.9);
    const speechStart = (duration - estimatedDur) * 0.1;
    const secPerWord = estimatedDur / Math.max(1, words.length);

    subtitles = [];
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      const chunk = words.slice(i, i + wordsPerChunk);
      const start = speechStart + i * secPerWord;
      const end = Math.min(speechStart + (i + wordsPerChunk) * secPerWord - 0.05, duration - 0.02);
      if (end > start) {
        subtitles.push({
          id: Date.now() + i,
          start: Math.round(start * 100) / 100,
          end: Math.round(end * 100) / 100,
          text: chunk.join(' ')
        });
      }
    }

  // PRIORITY 4: nothing available — leave captions empty (user can add manually)
  } else {
    subtitles = [];
  }

  renderSubtitlesList();
  setupVideoPlayer();
  setupAudioWaveform(video);

  // Initialize layout & keyframes FROM this clip's actual framing, not a hardcoded
  // default — otherwise opening a split-screen clip and exporting without touching
  // Layout silently re-renders it as blur-pad with the AI crop discarded.
  selectedLayout = (currentClip.jobReframeMode === 'split-screen') ? 'split-screen' : 'blur-pad';
  reframeKeyframes = Array.isArray(currentClip.reframe?.keyframes)
    ? currentClip.reframe.keyframes.map(kf => ({ ...kf }))
    : [];
  document.querySelectorAll('.layout-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.layout === selectedLayout);
  });
  renderKeyframeList();

  // Hide Multi-Layout Editor unless the clip was processed with split-screen
  const isSplitScreen = currentClip.jobReframeMode === 'split-screen';
  const layoutSection = document.querySelector('.layout-section');
  const keyframeSection = document.querySelector('.keyframe-section');
  if (layoutSection) layoutSection.style.display = isSplitScreen ? 'block' : 'none';
  if (keyframeSection) keyframeSection.style.display = isSplitScreen ? 'block' : 'none';

  // Render keyframe markers once video metadata loads
  video.addEventListener('loadedmetadata', () => renderKeyframeMarkers(), { once: true });

  document.getElementById('editorModal').classList.add('open');
}

function closeEditor() {
  document.getElementById('editorModal').classList.remove('open');
  const video = document.getElementById('editorVideo');
  video.pause();
}

function renderSubtitlesList() {
  const list = document.getElementById('subtitlesList');
  list.innerHTML = subtitles.map((sub, i) => `
    <div class="subtitle-block" id="sub-block-${i}">
      <div class="subtitle-time" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <input type="number" class="sub-time-input" value="${sub.start.toFixed(2)}"
          step="0.1" min="0" onchange="updateSubTime(${i}, 'start', parseFloat(this.value))" />
        <span style="color:var(--text2)">&rarr;</span>
        <input type="number" class="sub-time-input" value="${sub.end.toFixed(2)}"
          step="0.1" min="0" onchange="updateSubTime(${i}, 'end', parseFloat(this.value))" />
        <button class="btn-seek" onclick="seekTo(${sub.start})">&#9654;</button>
      </div>
      <textarea class="subtitle-text" onchange="updateSubText(${i}, this.value)" onclick="event.stopPropagation()">${sub.text}</textarea>
      <div class="subtitle-actions">
        <button class="btn-del" onclick="event.stopPropagation(); deleteSub(${i})">Delete</button>
      </div>
    </div>
  `).join('');
}

function updateSubTime(index, field, value) {
  if (isNaN(value)) return;
  subtitles[index][field] = Math.max(0, value);
  updateOverlay();
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  const ms = Math.floor((sec % 1) * 100).toString().padStart(2, '0');
  return `${m}:${s}:${ms}`;
}

function seekTo(time) {
  const video = document.getElementById('editorVideo');
  video.currentTime = time;
}

function updateSubText(index, text) {
  subtitles[index].text = text;
  updateOverlay();
}

function deleteSub(index) {
  subtitles.splice(index, 1);
  renderSubtitlesList();
  updateOverlay();
}

function addSubtitle() {
  const video = document.getElementById('editorVideo');
  const start = video.currentTime;
  subtitles.push({ id: Date.now(), start, end: start + 2, text: 'New Subtitle' });
  subtitles.sort((a,b) => a.start - b.start);
  renderSubtitlesList();
}

function setupVideoPlayer() {
  const video = document.getElementById('editorVideo');
  const scrubber = document.getElementById('videoScrubber');
  const timeDisp = document.getElementById('videoTime');
  
  video.ontimeupdate = () => {
    scrubber.value = (video.currentTime / video.duration) * 100 || 0;
    timeDisp.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration || 0)}`;
    updateOverlay();
  };
  
  scrubber.oninput = (e) => {
    video.currentTime = (e.target.value / 100) * video.duration;
  };
}

function togglePlay() {
  const video = document.getElementById('editorVideo');
  const btn = document.getElementById('playPauseBtn');
  if(video.paused) { video.play(); btn.textContent = 'Pause'; }
  else { video.pause(); btn.textContent = 'Play'; }
}

function updateOverlay() {
  const video = document.getElementById('editorVideo');
  const overlay = document.getElementById('videoOverlay');
  const t = video.currentTime;

  // Kill any native subtitle track the browser might render
  Array.from(video.textTracks || []).forEach(tr => tr.mode = 'hidden');

  // Sidebar highlight
  document.querySelectorAll('.subtitle-block').forEach((el, i) => {
    const sub = subtitles[i];
    if (sub && t >= sub.start && t <= sub.end) {
      el.classList.add('sub-active');
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      el.classList.remove('sub-active');
    }
  });

  const activeSub = subtitles.find(s => t >= s.start && t <= s.end);
  let html = '';

  if (activeSub) {
    const containerH = overlay.offsetHeight || 400;
    const scale = containerH / 1920;
    const displaySize = Math.max(8, Math.round(editorStyle.size * scale));
    const displayOutline = Math.max(1, Math.round(editorStyle.outline * scale));
    const displayShadow = Math.max(1, Math.round(editorStyle.shadow * scale));

    html += `<div class="overlay-subtitle" style="
      position: absolute;
      bottom: 5%;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
      white-space: normal;
      max-width: 90%;
      font-family: '${editorStyle.font}', Impact, sans-serif;
      font-weight: bold;
      font-size: ${displaySize}px;
      color: ${editorStyle.color};
      -webkit-text-stroke: ${displayOutline}px #000;
      paint-order: stroke fill;
      filter: drop-shadow(${displayShadow}px ${displayShadow}px 2px rgba(0,0,0,0.6));
      pointer-events: none;
    ">${activeSub.text}</div>`;
  }

  // Watermark
  if (watermarkStyle.text) {
    const p = watermarkStyle.pos;
    let posCss = '';
    if (p.includes('t')) posCss += 'top:10px;';
    if (p.includes('b')) posCss += 'bottom:10px;';
    if (p.includes('m')) posCss += 'top:50%;transform:translateY(-50%);';
    if (p.includes('l')) posCss += 'left:10px;';
    if (p.includes('r')) posCss += 'right:10px;';
    if (p.includes('c')) {
      posCss += 'left:50%;';
      posCss += p.includes('m') ? 'transform:translate(-50%,-50%);' : 'transform:translateX(-50%);';
    }
    html += `<div class="overlay-watermark" style="
      position:absolute;${posCss}
      color: rgba(255,255,255,${watermarkStyle.opacity / 100});
      font-size: ${watermarkStyle.size}px;
      font-weight: bold;
      font-family: var(--font-ui);
      pointer-events: none;
    ">${watermarkStyle.text}</div>`;
  }

  overlay.innerHTML = html;
}

function setupAudioWaveform(video) {
  const canvas = document.getElementById('waveformCanvas');
  const ctx = canvas.getContext('2d');
  
  function draw() {
    if(!document.getElementById('editorModal').classList.contains('open')) return;
    
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const pct = video.currentTime / (video.duration || 1);
    const playX = canvas.width * pct;
    
    // Draw fake waves
    ctx.beginPath();
    for(let i=0; i<canvas.width; i+=4) {
      const h = 20 + Math.sin(i * 0.05 + video.currentTime * 5) * 15 + Math.random() * 10;
      ctx.moveTo(i, canvas.height/2 - h/2);
      ctx.lineTo(i, canvas.height/2 + h/2);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.stroke();
    
    // Progress wave
    ctx.beginPath();
    for(let i=0; i<playX; i+=4) {
      const h = 20 + Math.sin(i * 0.05 + video.currentTime * 5) * 15 + Math.random() * 10;
      ctx.moveTo(i, canvas.height/2 - h/2);
      ctx.lineTo(i, canvas.height/2 + h/2);
    }
    ctx.strokeStyle = 'var(--accent-blue)';
    ctx.stroke();
    
    // Playhead
    ctx.fillStyle = 'white';
    ctx.fillRect(playX, 0, 2, canvas.height);
    
    requestAnimationFrame(draw);
  }
  draw();
}

// Event Listeners for Styles
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fontPills')?.addEventListener('click', e => {
    if(e.target.classList.contains('font-pill')) {
      document.querySelectorAll('.font-pill').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      editorStyle.font = e.target.dataset.font;
      updateOverlay();
    }
  });
  
  document.getElementById('colorSwatches')?.addEventListener('click', e => {
    if(e.target.classList.contains('color-swatch')) {
      document.querySelectorAll('.color-swatch').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      editorStyle.color = e.target.dataset.color;
      updateOverlay();
    }
  });
  
  ['styleOutline', 'styleShadow', 'styleSize', 'stylePosY'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => {
      editorStyle[id.replace('style','').toLowerCase()] = e.target.value;
      updateOverlay();
    });
  });
  
  document.getElementById('styleAnimation')?.addEventListener('change', e => {
    editorStyle.animation = e.target.value;
  });
  
  document.getElementById('watermarkText')?.addEventListener('input', e => {
    watermarkStyle.text = e.target.value;
    updateOverlay();
  });
  
  document.getElementById('watermarkGrid')?.addEventListener('click', e => {
    if(e.target.classList.contains('pos-btn')) {
      document.querySelectorAll('.pos-btn').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      watermarkStyle.pos = e.target.dataset.pos;
      updateOverlay();
    }
  });
  
  ['watermarkOpacity', 'watermarkSize'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', e => {
      watermarkStyle[id.replace('watermark','').toLowerCase()] = e.target.value;
      updateOverlay();
    });
  });

  // Close preview modal when clicking backdrop
  document.getElementById('previewModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('previewModal')) closePreviewModal();
  });
});

async function renderAndExport() {
  toast('Sending render job...', 'success');
  const btn = document.querySelector('.editor-header .btn:not(.btn-outline)');
  btn.disabled = true;
  btn.textContent = 'Rendering...';
  
  const payload = {
    clip_id: currentClip.id,
    subtitles,
    style: editorStyle,
    watermark: watermarkStyle,
    layout: selectedLayout,
    reframeKeyframes: reframeKeyframes.length > 0 ? reframeKeyframes : undefined
  };
  
  try {
    const res = await fetch(`${API}/api/render/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if(res.ok) {
      toast('Render started successfully!', 'success');
      setTimeout(closeEditor, 1000);
    } else {
      toast('Render failed: ' + (data.error || 'Unknown'), 'error');
    }
  } catch(e) {
    toast('Render request failed', 'error');
  }
  
  btn.disabled = false;
  btn.textContent = 'Render & Export';
}

// ╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒
//  FEATURE TOUR — Scroll reveal via Intersection Observer
// ╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒╒
(function initFeatureTour() {
  const targets = document.querySelectorAll('.ft-fade-target');
  if (!targets.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('ft-visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -60px 0px'
  });

  targets.forEach(t => observer.observe(t));

  // Caption style pill toggle
  document.querySelectorAll('.ft-phone-pills .ft-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.ft-phone-pills .ft-pill').forEach(p => p.classList.remove('ft-pill-active'));
      pill.classList.add('ft-pill-active');
    });
  });
})();
