// ═══════════════════════════════════════
// NEW MODULAR SPLIT-SCREEN EDITOR
// ═══════════════════════════════════════
class SplitScreenEditor {
  constructor(jobId, clipIndex = 0) {
    this.jobId = jobId;
    this.clipIndex = clipIndex;
    this.job = null;
    this.clip = null;

    // DOM Elements
    this.overlay = document.getElementById('newEditorOverlay');
    this.video = document.getElementById('newEditorVideo');
    this.previewCanvas = document.getElementById('newEditorPreview');
    this.ctx = this.previewCanvas ? this.previewCanvas.getContext('2d') : null;
    
    // State
    this.mode = 'split-screen'; // split-screen, focus-center, etc
    this.trimSegments = []; // { in, out }
    this.keyframes = []; // { time, cropX, cropY, cropW, cropH }
    this.activeTab = 'layout';

    this.init();
  }

  async init() {
    try {
      const res = await fetch(`/api/status/${this.jobId}`);
      this.job = await res.json();
      this.clip = this.job.clips[this.clipIndex];
      
      if (!this.clip.trimSegments) {
        this.clip.trimSegments = [{ in: 0, out: this.job.metadata?.duration || this.clip.end }];
      }
      if (!this.clip.reframe) {
        this.clip.reframe = { layout: 'split-screen', keyframes: [] };
      }
      
      this.trimSegments = this.clip.trimSegments;
      this.keyframes = this.clip.reframe.keyframes || [];
      this.mode = this.clip.reframe.layout;
      this.clip.captionStyle = this.clip.captionStyle || this.clip.suggested_caption_style || 'gaming';

      this.video.src = this.job.url || `/uploads/${this.jobId}.mp4`;
      this.overlay.style.opacity = '1';
      this.overlay.style.pointerEvents = 'all';
      this.overlay.classList.add('open');

      this.bindEvents();
      this.renderTimeline();
      this.updatePreview();
    } catch (e) {
      console.error('Failed to init editor:', e);
    }
  }

  bindEvents() {
    // Tabs
    document.querySelectorAll('.editor-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.activeTab = e.target.dataset.tab;
        this.renderSidebar();
      });
    });

    // Playback
    this.video.addEventListener('timeupdate', () => this.updatePreview());
  }

  renderSidebar() {
    const pane = document.getElementById('editorSidebarPane');
    if (!pane) return;
    if (this.activeTab === 'layout') {
      pane.innerHTML = `
        <div class="control-group">
          <label>Layout Mode</label>
          <div class="layout-picker">
            <button class="${this.mode === 'split-screen' ? 'active' : ''}" onclick="window.currentEditor.setMode('split-screen')">Split Screen</button>
            <button class="${this.mode === 'focus-center' ? 'active' : ''}" onclick="window.currentEditor.setMode('focus-center')">Focus Center</button>
          </div>
        </div>
        <div class="control-group mt-16">
          <label>Keyframes</label>
          <button class="btn btn-outline w-full" onclick="window.currentEditor.addKeyframe()">+ Add Keyframe at Current Time</button>
          <div id="kfList" class="mt-8"></div>
        </div>
      `;
      this.renderKeyframesList();
    } else if (this.activeTab === 'captions') {
      pane.innerHTML = `
        <div class="control-group">
          <label>Caption Style</label>
          <select class="w-full" onchange="window.currentEditor.setCaptionStyle(this.value)">
            <option value="gaming" ${this.clip.captionStyle === 'gaming' ? 'selected' : ''}>Gaming</option>
            <option value="gaming-pro" ${this.clip.captionStyle === 'gaming-pro' ? 'selected' : ''}>Gaming Pro</option>
            <option value="streamer" ${this.clip.captionStyle === 'streamer' ? 'selected' : ''}>Streamer</option>
            <option value="meme" ${this.clip.captionStyle === 'meme' ? 'selected' : ''}>Meme</option>
            <option value="modern" ${this.clip.captionStyle === 'modern' ? 'selected' : ''}>Modern</option>
            <option value="cinematic" ${this.clip.captionStyle === 'cinematic' ? 'selected' : ''}>Cinematic</option>
            <option value="clean" ${this.clip.captionStyle === 'clean' ? 'selected' : ''}>Clean</option>
            <option value="minimal" ${this.clip.captionStyle === 'minimal' ? 'selected' : ''}>Minimal</option>
            <option value="tiktok" ${this.clip.captionStyle === 'tiktok' ? 'selected' : ''}>TikTok</option>
            <option value="none">None (No Captions)</option>
          </select>
        </div>
      `;
    }
  }

  setMode(mode) {
    this.mode = mode;
    this.clip.reframe.layout = mode;
    this.renderSidebar();
    this.updatePreview();
  }

  setCaptionStyle(style) {
    this.clip.captionStyle = style;
    this.renderSidebar();
  }

  addKeyframe() {
    const t = this.video.currentTime;
    this.keyframes.push({
      time: t, cropX: '(iw-1080)/2', cropY: 0, cropW: 1080, cropH: 1920
    });
    this.keyframes.sort((a, b) => a.time - b.time);
    this.renderKeyframesList();
  }

  renderKeyframesList() {
    const list = document.getElementById('kfList');
    if (!list) return;
    list.innerHTML = this.keyframes.map((kf, i) => `
      <div class="kf-item flex justify-between items-center p-8 bg-surf rounded mb-4 border border-bdr">
        <span>Time: ${kf.time.toFixed(2)}s</span>
        <button class="text-rose text-sm" onclick="window.currentEditor.removeKeyframe(${i})">Remove</button>
      </div>
    `).join('');
  }

  removeKeyframe(i) {
    this.keyframes.splice(i, 1);
    this.renderKeyframesList();
  }

  renderTimeline() {
    const strip = document.getElementById('editorTimelineStrip');
    if (!strip) return;
    const dur = this.job.metadata?.duration || 60;
    
    // Draw segments
    strip.innerHTML = this.trimSegments.map(seg => {
      const left = (seg.in / dur) * 100;
      const width = ((seg.out - seg.in) / dur) * 100;
      return `<div class="timeline-segment absolute h-full bg-pril opacity-50 border-x border-pri" style="left: ${left}%; width: ${width}%;"></div>`;
    }).join('');
  }

  updatePreview() {
    if (!this.ctx || !this.video) return;
    this.ctx.drawImage(this.video, 0, 0, this.previewCanvas.width, this.previewCanvas.height);
  }

  async saveAndExport() {
    this.clip.reframe.layout = this.mode;
    this.clip.reframe.keyframes = this.keyframes;
    this.clip.trimSegments = this.trimSegments;

    try {
      const voiceoverTextEl = document.getElementById('voiceoverText');
      const voiceoverScript = voiceoverTextEl ? voiceoverTextEl.value : '';

      const res = await fetch('/api/render/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clip_id: this.clip.clip_id || `${this.jobId}-0`,
          subtitles: this.clip.cues,
          style: this.clip.captionStyle,
          trimSegments: this.clip.trimSegments,
          reframeKeyframes: this.clip.reframe.keyframes,
          layout: this.clip.reframe.layout,
          voiceoverScript: voiceoverScript
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Exporting started!');
        this.close();
      }
    } catch (e) {
      alert('Error exporting');
    }
  }

  close() {
    this.overlay.classList.remove('open');
    this.overlay.style.opacity = '0';
    this.overlay.style.pointerEvents = 'none';
    this.video.pause();
  }
}

window.openNewEditor = function(jobId, clipIndex = 0) {
  window.currentEditor = new SplitScreenEditor(jobId, clipIndex);
};