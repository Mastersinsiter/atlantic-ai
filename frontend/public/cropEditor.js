/**
 * Atlantic AI — Clipzi-Style Crop/Reframe Editor v2
 *
 * ARCHITECTURE:
 *   - ONE video element (source)
 *   - CSS clip-path dark overlay (dims everything outside crop)
 *   - Draggable/resizable crop regions with professional handles
 *   - Canvas-based 9:16 preview (reads from the same decoded video)
 *   - Percentage-based crop state for responsive scaling
 *
 * Layout modes: Vertical, Split, Trio, Spotlight, Centered, Horizontal
 */

const CROP_API = location.protocol === 'file:' ? 'http://localhost:3000' : '';

// ═══════════════════════════════════════
//  LAYOUT MODE DEFINITIONS
// ═══════════════════════════════════════

const CROP_MODES = {
  vertical:   { label: 'Vertical',   regions: 1, desc: 'Single 9:16 crop' },
  split:      { label: 'Split',      regions: 2, desc: 'Top + bottom panels' },
  trio:       { label: 'Trio',       regions: 3, desc: 'Three-panel grid' },
  spotlight:  { label: 'Spotlight',  regions: 2, desc: 'Zoom + context' },
  centered:   { label: 'Centered',   regions: 1, desc: 'Auto-centered crop' },
  horizontal: { label: 'Horizontal', regions: 1, desc: 'Full-width strip' },
};

const REGION_COLORS = ['green', 'orange', 'cyan', 'magenta'];
const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2];


// ═══════════════════════════════════════
//  CROP EDITOR CLASS
// ═══════════════════════════════════════

class CropEditor {
  constructor() {
    this.overlay = document.getElementById('cropEditorOverlay');
    this.video = document.getElementById('cropSourceVideo');
    this.previewCanvas = document.getElementById('cropPreviewCanvas');
    this.previewCtx = this.previewCanvas ? this.previewCanvas.getContext('2d') : null;
    this.regionsLayer = document.getElementById('cropRegionsLayer');
    this.darkOverlay = document.getElementById('cropDarkOverlay');

    this.currentMode = 'vertical';
    this.regions = [];
    this.clipUrl = '';
    this.clipData = null;
    this.jobId = '';
    this.clipIndex = 0;
    this.isPlaying = false;
    this.playbackSpeed = 1;
    this.animFrame = null;

    this.undoStack = [];
    this.redoStack = [];

    // Source video dimensions (actual pixel size)
    this.srcW = 1920;
    this.srcH = 1080;

    this._bindPlaybackControls();
  }

  // ── Open the editor for a specific clip ──
  open(jobId, clipIndex, clipUrl, clipData) {
    this.jobId = jobId;
    this.clipUrl = clipUrl;
    this.clipData = clipData;
    this.clipIndex = clipIndex;

    // Set video source
    this.video.src = CROP_API + clipUrl;
    this.video.load();

    // Set title
    const titleEl = document.getElementById('cropEditorTitle');
    if (titleEl) titleEl.textContent = clipData?.title || `Clip ${clipIndex + 1}`;

    // Wait for metadata then init
    this.video.addEventListener('loadedmetadata', () => {
      this.srcW = this.video.videoWidth || 1920;
      this.srcH = this.video.videoHeight || 1080;
      this.setMode('vertical');
      
      if (this.clipData && this.clipData.start !== undefined) {
        this.video.currentTime = this.clipData.start;
      }
      
      this._startPreviewLoop();
    }, { once: true });

    // Show overlay
    requestAnimationFrame(() => {
      this.overlay.classList.add('open');
    });
  }

  // ── Close the editor ──
  close() {
    this.overlay.classList.remove('open');
    this.video.pause();
    this.isPlaying = false;
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this._updatePlayBtn();
  }

  // ── Set the layout mode ──
  setMode(mode) {
    if (!CROP_MODES[mode]) return;
    this.currentMode = mode;

    // Update tab UI
    document.querySelectorAll('.crop-mode-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });

    // Create regions for this mode
    this._initRegions(mode);
    this._updateDarkOverlay();
    
    this.pushUndoSnapshot();
  }

  // ── Undo / Redo ──
  pushUndoSnapshot() {
    this.undoStack.push(this.regions.map(r => r.getCropState()));
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length > 1) {
      this.redoStack.push(this.undoStack.pop());
      const state = this.undoStack[this.undoStack.length - 1];
      this._restoreState(state);
    }
  }

  redo() {
    if (this.redoStack.length > 0) {
      const state = this.redoStack.pop();
      this.undoStack.push(state);
      this._restoreState(state);
    }
  }

  _restoreState(state) {
    if (state && state.length === this.regions.length) {
      this.regions.forEach((r, i) => {
        r.setCropState(state[i]);
      });
      this._updateDarkOverlay();
      this._renderPreview();
    }
  }

  // ── Create crop regions for the chosen mode ──
  _initRegions(mode) {
    // Clear existing regions
    this.regionsLayer.innerHTML = '';
    this.regions = [];
    this.undoStack = [];
    this.redoStack = [];

    const modeDef = CROP_MODES[mode];
    const regionCount = modeDef.regions;

    // Compute default region positions based on mode (percentage-based)
    const defaults = this._getDefaultRegions(mode);

    for (let i = 0; i < regionCount; i++) {
      const def = defaults[i];
      const region = new CropRegionBox({
        index: i,
        x: def.x,
        y: def.y,
        width: def.w,
        height: def.h,
        aspectRatio: def.aspectRatio,
        color: REGION_COLORS[i % REGION_COLORS.length],
        label: def.label,
        containerEl: this.regionsLayer,
        onUpdate: () => {
          this._updateDarkOverlay();
          this._renderPreview();
        },
        onDragEnd: () => this.pushUndoSnapshot(),
      });
      this.regions.push(region);
    }
  }

  // ══════════════════════════════════════
  //  DEFAULT REGIONS (percentage-based)
  //  All values are 0-100 percent
  // ══════════════════════════════════════
  _getDefaultRegions(mode) {
    switch (mode) {
      case 'vertical': {
        // 9:16 crop centered on the source
        const cropWPct = (this.srcH * (9 / 16)) / this.srcW * 100;
        const cropHPct = 100;
        const x = (100 - cropWPct) / 2;
        return [{ x, y: 0, w: cropWPct, h: cropHPct, aspectRatio: 9 / 16, label: 'Crop' }];
      }

      case 'split': {
        const halfH = 50;
        const rw = (this.srcH * 0.5 * (9 / 8)) / this.srcW * 100;
        const x = (100 - rw) / 2;
        return [
          { x, y: 0, w: rw, h: halfH, aspectRatio: 9 / 8, label: 'Top' },
          { x, y: halfH, w: rw, h: halfH, aspectRatio: 9 / 8, label: 'Bottom' },
        ];
      }

      case 'trio': {
        const thirdH = 100 / 3;
        const rw = (this.srcH * (1 / 3) * (27 / 16)) / this.srcW * 100;
        const x = Math.max(0, (100 - rw) / 2);
        return [
          { x, y: 0, w: Math.min(100, rw), h: thirdH, aspectRatio: 27 / 16, label: 'Top' },
          { x, y: thirdH, w: Math.min(100, rw), h: thirdH, aspectRatio: 27 / 16, label: 'Middle' },
          { x, y: 2 * thirdH, w: Math.min(100, rw), h: thirdH, aspectRatio: 27 / 16, label: 'Bottom' },
        ];
      }

      case 'spotlight': {
        const spotHPct = 40;
        const spotWPct = (this.srcH * 0.4 * (1080 / (1920 * 0.6))) / this.srcW * 100;
        const ctxWPct = 70;
        const ctxHPct = (this.srcW * 0.7 / (1080 / (1920 * 0.4))) / this.srcH * 100;
        return [
          { x: (100 - spotWPct) / 2, y: 10, w: spotWPct, h: spotHPct, aspectRatio: 1080 / (1920 * 0.6), label: 'Spotlight' },
          { x: (100 - ctxWPct) / 2, y: 5, w: ctxWPct, h: Math.min(90, ctxHPct), aspectRatio: 1080 / (1920 * 0.4), label: 'Full frame' },
        ];
      }

      case 'centered': {
        const cropWPct = (this.srcH * (9 / 16)) / this.srcW * 100;
        const x = (100 - cropWPct) / 2;
        return [{ x, y: 0, w: cropWPct, h: 100, aspectRatio: 9 / 16, label: 'Center' }];
      }

      case 'horizontal': {
        const stripH = 50;
        return [{ x: 0, y: 25, w: 100, h: stripH, aspectRatio: null, label: 'Strip' }];
      }

      default: {
        const cropWPct = (this.srcH * (9 / 16)) / this.srcW * 100;
        const x = (100 - cropWPct) / 2;
        return [{ x, y: 0, w: cropWPct, h: 100, aspectRatio: 9 / 16, label: 'Crop' }];
      }
    }
  }

  // ══════════════════════════════════════
  //  DARK OVERLAY (canvas-based, reliable)
  // ══════════════════════════════════════
  _updateDarkOverlay() {
    if (!this.darkOverlay) return;

    if (this.regions.length === 0) {
      this.darkOverlay.innerHTML = '';
      return;
    }

    const rects = this.regions.map(r => {
      const s = r.getCropState();
      return { x: s.x, y: s.y, w: s.width, h: s.height };
    });

    // Use a canvas for the dark overlay — most reliable cross-browser
    let canvas = this.darkOverlay.querySelector('canvas');
    if (!canvas) {
      this.darkOverlay.style.background = 'none';
      canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';
      this.darkOverlay.appendChild(canvas);
    }

    // Match canvas resolution to container
    const containerRect = this.darkOverlay.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(containerRect.width * dpr);
    const ch = Math.round(containerRect.height * dpr);

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);

    // Fill entire canvas with dim color
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, cw, ch);

    // Cut out holes for each crop region
    ctx.globalCompositeOperation = 'destination-out';
    rects.forEach(r => {
      const px = (r.x / 100) * cw;
      const py = (r.y / 100) * ch;
      const pw = (r.w / 100) * cw;
      const ph = (r.h / 100) * ch;
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(px, py, pw, ph);
    });

    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over';
  }

  // ══════════════════════════════════════
  //  CANVAS PREVIEW (9:16)
  // ══════════════════════════════════════
  _renderPreview() {
    if (!this.previewCtx || !this.video.videoWidth) return;

    const canvas = this.previewCanvas;
    const ctx = this.previewCtx;
    const outW = 1080;
    const outH = 1920;

    if (canvas.width !== outW || canvas.height !== outH) {
      canvas.width = outW;
      canvas.height = outH;
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outW, outH);

    const mode = this.currentMode;

    switch (mode) {
      case 'vertical':
      case 'centered': {
        const r = this.regions[0];
        if (!r) break;
        const src = r.getSourceCoords(this.srcW, this.srcH);
        ctx.drawImage(this.video, src.x, src.y, src.w, src.h, 0, 0, outW, outH);
        break;
      }

      case 'split': {
        const panelH = outH / 2;
        this.regions.forEach((r, i) => {
          const src = r.getSourceCoords(this.srcW, this.srcH);
          ctx.drawImage(this.video, src.x, src.y, src.w, src.h, 0, i * panelH, outW, panelH);
        });
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, panelH);
        ctx.lineTo(outW, panelH);
        ctx.stroke();
        break;
      }

      case 'trio': {
        const panelH = outH / 3;
        this.regions.forEach((r, i) => {
          const src = r.getSourceCoords(this.srcW, this.srcH);
          ctx.drawImage(this.video, src.x, src.y, src.w, src.h, 0, i * panelH, outW, panelH);
        });
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 2;
        [1, 2].forEach(i => {
          ctx.beginPath();
          ctx.moveTo(0, i * panelH);
          ctx.lineTo(outW, i * panelH);
          ctx.stroke();
        });
        break;
      }

      case 'spotlight': {
        const spotH = Math.round(outH * 0.6);
        const ctxH = outH - spotH;
        if (this.regions[0]) {
          const src = this.regions[0].getSourceCoords(this.srcW, this.srcH);
          ctx.drawImage(this.video, src.x, src.y, src.w, src.h, 0, 0, outW, spotH);
        }
        if (this.regions[1]) {
          const src = this.regions[1].getSourceCoords(this.srcW, this.srcH);
          ctx.drawImage(this.video, src.x, src.y, src.w, src.h, 0, spotH, outW, ctxH);
        }
        ctx.strokeStyle = 'rgba(168,216,160,0.3)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, spotH);
        ctx.lineTo(outW, spotH);
        ctx.stroke();
        break;
      }

      case 'horizontal': {
        const r = this.regions[0];
        if (!r) break;
        const src = r.getSourceCoords(this.srcW, this.srcH);
        const aspect = src.w / src.h;
        const drawW = outW;
        const drawH = Math.round(outW / aspect);
        const yOff = Math.round((outH - drawH) / 2);
        ctx.drawImage(this.video, src.x, src.y, src.w, src.h, 0, yOff, drawW, drawH);
        break;
      }
    }
  }

  // ── Animation loop for live preview ──
  _startPreviewLoop() {
    const loop = () => {
      this._renderPreview();
      this._updateTimeline();
      this.animFrame = requestAnimationFrame(loop);
    };
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = requestAnimationFrame(loop);
  }

  // ── Update timeline / scrubber ──
  _updateTimeline() {
    const v = this.video;
    if (!v.duration) return;

    let pct = 0;
    let curr = v.currentTime;
    let dur = v.duration;

    if (dur > 0) {
      pct = (curr / dur) * 100;
    }

    const scrubber = document.getElementById('cropScrubber');
    if (scrubber && !scrubber._dragging) scrubber.value = pct;

    const timeDisp = document.getElementById('cropTimeDisplay');
    if (timeDisp) {
      timeDisp.textContent = `${this._fmtTime(curr)} / ${this._fmtTime(dur)}`;
    }

    const progress = document.getElementById('cropPositionsProgress');
    if (progress) progress.style.width = pct + '%';
    const playhead = document.getElementById('cropPositionsPlayhead');
    if (playhead) playhead.style.left = pct + '%';

    const posTimeRange = document.getElementById('cropPositionsTimeRange');
    if (posTimeRange) {
       posTimeRange.textContent = `0:00 \u2014 ${this._fmtTime(dur)}`;
    }
    const posRatio = document.getElementById('cropPositionsRatio');
    if (posRatio) {
       if (this.currentMode === 'split') posRatio.textContent = 'T:50% B:50%';
       else if (this.currentMode === 'trio') posRatio.textContent = 'T:33% M:33% B:33%';
       else if (this.currentMode === 'spotlight') posRatio.textContent = 'T:60% B:40%';
       else posRatio.textContent = '';
    }
  }

  _fmtTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── Playback controls ──
  _bindPlaybackControls() {
    document.getElementById('cropUndoBtn')?.addEventListener('click', () => this.undo());
    document.getElementById('cropRedoBtn')?.addEventListener('click', () => this.redo());
    document.getElementById('cropPlayBtn')?.addEventListener('click', () => this.togglePlay());
    document.getElementById('cropStepBack')?.addEventListener('click', () => this.stepFrame(-1));
    document.getElementById('cropStepFwd')?.addEventListener('click', () => this.stepFrame(1));
    document.getElementById('cropSpeedBtn')?.addEventListener('click', () => this.cycleSpeed());

    const scrubber = document.getElementById('cropScrubber');
    if (scrubber) {
      scrubber.addEventListener('mousedown', () => { scrubber._dragging = true; });
      scrubber.addEventListener('mouseup', () => { scrubber._dragging = false; });
      scrubber.addEventListener('input', (e) => {
        if (this.video.duration) {
          this.video.currentTime = (parseFloat(e.target.value) / 100) * this.video.duration;
        }
      });
    }

    this.video?.addEventListener('ended', () => {
      this.isPlaying = false;
      this._updatePlayBtn();
    });
  }

  togglePlay() {
    if (this.video.paused) {
      this.video.play();
      this.isPlaying = true;
    } else {
      this.video.pause();
      this.isPlaying = false;
    }
    this._updatePlayBtn();
  }

  stepFrame(direction) {
    this.video.currentTime = Math.max(0, this.video.currentTime + (direction * (1 / 30)));
  }

  cycleSpeed() {
    const idx = SPEED_OPTIONS.indexOf(this.playbackSpeed);
    this.playbackSpeed = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    this.video.playbackRate = this.playbackSpeed;
    const btn = document.getElementById('cropSpeedBtn');
    if (btn) btn.textContent = this.playbackSpeed + 'x';
  }

  _updatePlayBtn() {
    const btn = document.getElementById('cropPlayBtn');
    if (btn) btn.textContent = this.isPlaying ? '\u23F8' : '\u25B6';
  }

  // ── Export with custom framing ──
  async exportReframed() {
    const btn = document.getElementById('cropExportBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Rendering...'; }

    const regionsData = this.regions.map(r => {
      const src = r.getSourceCoords(this.srcW, this.srcH);
      return { x: src.x, y: src.y, width: src.w, height: src.h, sourceWidth: this.srcW, sourceHeight: this.srcH };
    });

    const payload = {
      mode: this.currentMode,
      regions: regionsData,
      outputWidth: 1080,
      outputHeight: 1920,
    };

    try {
      const res = await fetch(`${CROP_API}/api/reframe/${this.jobId}/${this.clipIndex}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success && data.url) {
        toast('\u2705 Custom framing exported! Downloading...', 'success');
        const a = document.createElement('a');
        a.href = CROP_API + data.url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => this.close(), 1500);
      } else {
        toast('\u274C Export failed: ' + (data.error || 'Unknown'), 'error');
      }
    } catch (e) {
      toast('\u274C Export failed: ' + e.message, 'error');
    }

    if (btn) { btn.disabled = false; btn.textContent = '\u2B07 Export'; }
  }
}


// ═══════════════════════════════════════
//  CROP REGION BOX
//  Professional draggable + resizable crop region
//  with L-bracket corner handles, edge bars,
//  rule-of-thirds grid, and percentage-based state
// ═══════════════════════════════════════

class CropRegionBox {
  constructor({ index, x, y, width, height, aspectRatio, color, label, containerEl, onUpdate, onDragEnd }) {
    this.index = index;
    this.color = color;
    this.label = label;
    this.aspectRatio = aspectRatio;
    this.containerEl = containerEl;
    this.onUpdate = onUpdate;
    this.onDragEnd = onDragEnd;

    // Crop state in percentages (0-100)
    this.pctX = x;
    this.pctY = y;
    this.pctW = width;
    this.pctH = height;

    this._buildDOM();
    this._bindDrag();
    this._updatePosition();
  }

  _buildDOM() {
    this.el = document.createElement('div');
    this.el.className = 'crop-region';
    this.el.dataset.color = this.color;

    this.el.innerHTML = `
      <div class="crop-region-border"></div>
      <div class="crop-grid-overlay">
        <div class="crop-grid-line-v"></div>
        <div class="crop-grid-line-v"></div>
        <div class="crop-grid-line-h"></div>
        <div class="crop-grid-line-h"></div>
      </div>
      <div class="crop-safe-zones">
        <div class="crop-safe-action"></div>
        <div class="crop-safe-title"></div>
      </div>
      <div class="crop-region-label">\</div>
      <div class="crop-aspect-badge">\</div>
      <div class="crop-info-badge">\</div>
      <div class="crop-adjust-hint">\u2194 Drag to reposition</div>
      <div class="crop-edge-bar top"></div>
      <div class="crop-edge-bar bottom"></div>
      <div class="crop-edge-bar left"></div>
      <div class="crop-edge-bar right"></div>
      <div class="crop-resize-handle n"></div>
      <div class="crop-resize-handle s"></div>
      <div class="crop-resize-handle w"></div>
      <div class="crop-resize-handle e"></div>
      <div class="crop-resize-handle nw"></div>
      <div class="crop-resize-handle ne"></div>
      <div class="crop-resize-handle sw"></div>
      <div class="crop-resize-handle se"></div>
    `; 

    this.containerEl.appendChild(this.el);

    // Double click to reset
    this.el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.resetToCenter();
    });

    // Scroll to zoom
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const zoomSpeed = 2; // % per tick
      const dir = e.deltaY > 0 ? 1 : -1;
      
      const oldW = this.pctW;
      const oldH = this.pctH;
      
      let newW = oldW + (dir * zoomSpeed);
      newW = Math.max(5, Math.min(100, newW));
      
      const containerRect = this.containerEl.getBoundingClientRect();
      const containerAspect = containerRect.width / containerRect.height;
      let newH = oldH;
      
      if (this.aspectRatio) {
        newH = newW * containerAspect / this.aspectRatio;
        if (newH > 100) {
          newH = 100;
          newW = newH * this.aspectRatio / containerAspect;
        }
      } else {
        newH = oldH + (dir * zoomSpeed);
        newH = Math.max(5, Math.min(100, newH));
      }
      
      // Update dimensions
      this.pctW = newW;
      this.pctH = newH;
      
      // Center the zoom position and clamp
      this.pctX = Math.max(0, Math.min(100 - newW, this.pctX - (newW - oldW) / 2));
      this.pctY = Math.max(0, Math.min(100 - newH, this.pctY - (newH - oldH) / 2));
      
      this._updatePosition();
      
      if (this.onDragEnd) {
        if (this._zoomEndTimeout) clearTimeout(this._zoomEndTimeout);
        this._zoomEndTimeout = setTimeout(() => {
          this.onDragEnd();
        }, 300);
      }
    }, { passive: false });
  }

  _getAspectLabel() {
    if (!this.aspectRatio) return '';
    if (Math.abs(this.aspectRatio - 9 / 16) < 0.01) return '9:16';
    if (Math.abs(this.aspectRatio - 16 / 9) < 0.01) return '16:9';
    if (Math.abs(this.aspectRatio - 1) < 0.01) return '1:1';
    if (Math.abs(this.aspectRatio - 9 / 8) < 0.01) return '9:8';
    return '';
  }

  _getZoomLabel() {
    const zoom = 100 / Math.max(1, this.pctW);
    return zoom.toFixed(1) + 'x';
  }

  _updatePosition() {
    this.el.style.left = this.pctX + '%';
    this.el.style.top = this.pctY + '%';
    this.el.style.width = this.pctW + '%';
    this.el.style.height = this.pctH + '%';

    const badge = this.el.querySelector('.crop-info-badge');
    if (badge) badge.textContent = this._getZoomLabel();

    if (this.onUpdate) this.onUpdate();
  }

  getCropState() {
    return {
      x: this.pctX,
      y: this.pctY,
      width: this.pctW,
      height: this.pctH,
    };
  }

  setCropState(state) {
    if (!state) return;
    this.pctX = state.x || this.pctX;
    this.pctY = state.y || this.pctY;
    this.pctW = state.width || state.w || this.pctW;
    this.pctH = state.height || state.h || this.pctH;
    this._updatePosition();
  }

  resetToCenter() {
    this.pctX = 50 - (this.pctW / 2);
    this.pctY = 50 - (this.pctH / 2);
    this._updatePosition();
  }

  getSourceCoords(srcW, srcH) {
    return {
      x: Math.round(this.pctX / 100 * srcW),
      y: Math.round(this.pctY / 100 * srcH),
      w: Math.round(this.pctW / 100 * srcW),
      h: Math.round(this.pctH / 100 * srcH),
    };
  }

  _bindDrag() {
    let mode = null;
    let startMX, startMY, startPctX, startPctY, startPctW, startPctH;
    let isShiftPressed = false;

    const getPointerPct = (e) => {
      const rect = this.containerEl.getBoundingClientRect();
      return {
        px: ((e.clientX - rect.left) / rect.width) * 100,
        py: ((e.clientY - rect.top) / rect.height) * 100,
      };
    };

    const updateSnapGuides = () => {
      let gx = document.getElementById('cropSnapGuideX');
      let gy = document.getElementById('cropSnapGuideY');
      
      if (!gx) {
        gx = document.createElement('div');
        gx.id = 'cropSnapGuideX';
        gx.className = 'crop-snap-guide vertical';
        this.containerEl.appendChild(gx);
      }
      if (!gy) {
        gy = document.createElement('div');
        gy.id = 'cropSnapGuideY';
        gy.className = 'crop-snap-guide horizontal';
        this.containerEl.appendChild(gy);
      }
      
      const centerX = this.pctX + (this.pctW / 2);
      const centerY = this.pctY + (this.pctH / 2);
      
      if (Math.abs(centerX - 50) < 1.0) {
        gx.style.opacity = 1;
        gx.style.left = '50%';
        this.pctX = 50 - (this.pctW / 2);
      } else {
        gx.style.opacity = 0;
      }
      
      if (Math.abs(centerY - 50) < 1.0) {
        gy.style.opacity = 1;
        gy.style.top = '50%';
        this.pctY = 50 - (this.pctH / 2);
      } else {
        gy.style.opacity = 0;
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Shift') isShiftPressed = true;
    };
    const onKeyUp = (e) => {
      if (e.key === 'Shift') isShiftPressed = false;
    };
    
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // Keyboard nudging
    this.el.setAttribute('tabindex', '0'); // make focusable
    this.el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 2 : 0.2;
      let moved = false;
      if (e.key === 'ArrowLeft') { this.pctX -= step; moved = true; }
      if (e.key === 'ArrowRight') { this.pctX += step; moved = true; }
      if (e.key === 'ArrowUp') { this.pctY -= step; moved = true; }
      if (e.key === 'ArrowDown') { this.pctY += step; moved = true; }
      
      if (moved) {
        e.preventDefault();
        this.pctX = Math.max(0, Math.min(100 - this.pctW, this.pctX));
        this.pctY = Math.max(0, Math.min(100 - this.pctH, this.pctY));
        this._updatePosition();
      }
    });

    const onDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.el.focus();

      const handle = e.target.closest('.crop-resize-handle');
      if (handle) {
        mode = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].find(c => handle.classList.contains(c)) || 'move';
      } else {
        mode = 'move';
      }

      const p = getPointerPct(e);
      startMX = p.px;
      startMY = p.py;
      startPctX = this.pctX;
      startPctY = this.pctY;
      startPctW = this.pctW;
      startPctH = this.pctH;

      this.el.classList.add('dragging');

      document.addEventListener('mousemove', onMove, { passive: false });
      document.addEventListener('mouseup', onUp);
    };

    const MIN_SIZE_PCT = 3;
    let pendingRaf = null;

    const onMove = (e) => {
      if (pendingRaf) return;
      pendingRaf = requestAnimationFrame(() => {
        pendingRaf = null;
        
        const p = getPointerPct(e);
        let dx = p.px - startMX;
        let dy = p.py - startMY;

        if (isShiftPressed && mode === 'move') {
          dx *= 1.5;
          dy *= 1.5;
        }

        if (mode === 'move') {
          this.pctX = Math.max(0, Math.min(100 - this.pctW, startPctX + dx));
          this.pctY = Math.max(0, Math.min(100 - this.pctH, startPctY + dy));
          updateSnapGuides();
        } else {
          let nx = startPctX, ny = startPctY, nw = startPctW, nh = startPctH;

          if (mode.includes('w')) {
            nx = Math.max(0, startPctX + dx);
            nw = startPctW - (nx - startPctX);
          }
          if (mode.includes('e')) {
            nw = Math.max(MIN_SIZE_PCT, startPctW + dx);
            if (nx + nw > 100) nw = 100 - nx;
          }
          if (mode.includes('n')) {
            ny = Math.max(0, startPctY + dy);
            nh = startPctH - (ny - startPctY);
          }
          if (mode.includes('s')) {
            nh = Math.max(MIN_SIZE_PCT, startPctH + dy);
            if (ny + nh > 100) nh = 100 - ny;
          }

          if (this.aspectRatio) {
            const containerRect = this.containerEl.getBoundingClientRect();
            const containerAspect = containerRect.width / containerRect.height;

            if (mode === 'n' || mode === 's') {
              nw = this.aspectRatio * nh / containerAspect;
              nx = startPctX + (startPctW - nw) / 2;
            } else if (mode === 'e' || mode === 'w') {
              nh = nw * containerAspect / this.aspectRatio;
              ny = startPctY + (startPctH - nh) / 2;
            } else {
              nh = nw * containerAspect / this.aspectRatio;
              if (mode.includes('n')) ny = startPctY + startPctH - nh;
              if (mode.includes('w')) nx = startPctX + startPctW - nw;
            }

            if (nx < 0 || ny < 0 || nx + nw > 100 || ny + nh > 100) {
              nx = this.pctX; ny = this.pctY; nw = this.pctW; nh = this.pctH;
            }
          }

          this.pctX = nx;
          this.pctY = ny;
          this.pctW = nw;
          this.pctH = nh;
        }

        this._updatePosition();
      });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.el.classList.remove('dragging');
      
      const gx = document.getElementById('cropSnapGuideX');
      const gy = document.getElementById('cropSnapGuideY');
      if (gx) gx.style.opacity = 0;
      if (gy) gy.style.opacity = 0;

      if (this.onDragEnd) this.onDragEnd();
    };

    this.el.addEventListener('mousedown', onDown);
  }
}

//  GLOBAL INSTANCE + PUBLIC API
// ═══════════════════════════════════════

let cropEditorInstance = null;

function getCropEditor() {
  if (!cropEditorInstance) {
    cropEditorInstance = new CropEditor();
  }
  return cropEditorInstance;
}

function openCropEditor(jobId, clipIndex, clipUrl, clipData) {
  getCropEditor().open(jobId, clipIndex, clipUrl, clipData);
}

function openCropEditorFullVideo(jobId, videoUrl, clips) {
  getCropEditor().openFullVideo(jobId, videoUrl, clips);
}

function closeCropEditor() {
  getCropEditor().close();
}

function setCropMode(mode) {
  getCropEditor().setMode(mode);
}

function exportCropReframe() {
  getCropEditor().exportReframed();
}

function exportJobClips() {
  getCropEditor().exportJobClips();
}


// ═══════════════════════════════════════
//  FULL-VIDEO MODE (Phase 2)
// ═══════════════════════════════════════

CropEditor.prototype.openFullVideo = function(jobId, videoUrl, clips) {
  this.jobId = jobId;
  this.isFullVideoMode = true;
  this.clips = clips || [];
  this.activeClipIndex = 0;
  
  this.clips.forEach(c => {
    if (c.approved === undefined) c.approved = true;
    if (!c.framingConfig) {
      c.framingConfig = { mode: 'vertical', regions: [] };
    }
  });

  this.video.src = CROP_API + videoUrl;
  this.video.load();

  const titleEl = document.getElementById('cropEditorTitle');
  if (titleEl) titleEl.textContent = 'Frame Your Clips';

  this.video.addEventListener('loadedmetadata', () => {
    console.log('Video metadata loaded. srcW:', this.video.videoWidth, 'srcH:', this.video.videoHeight);
    this.srcW = this.video.videoWidth || 1920;
    this.srcH = this.video.videoHeight || 1080;
    
    this._renderTimelineClips();
    this.selectClip(0);
    this._startPreviewLoop();
  }, { once: true });

  this.video.addEventListener('error', (e) => {
    console.error('Video load error:', this.video.error);
    alert('Failed to load full video for crop editor.');
  }, { once: true });

  const toggle = document.getElementById('cropApproveToggle');
  if (toggle) {
    toggle.onchange = (e) => {
      const c = this.clips[this.activeClipIndex];
      if (c) {
        c.approved = e.target.checked;
        this._renderTimelineClips();
      }
    };
  }

  requestAnimationFrame(() => {
    this.overlay.classList.add('open');
  });
};

CropEditor.prototype._renderTimelineClips = function() {
  const container = document.getElementById('cropClipsTimeline');
  if (!container || !this.video.duration) return;

  container.querySelectorAll('.timeline-clip-block').forEach(e => e.remove());

  const duration = this.video.duration;
  
  this.clips.forEach((c, idx) => {
    const block = document.createElement('div');
    block.className = 'timeline-clip-block';
    const left = (c.start / duration) * 100;
    const width = ((c.end - c.start) / duration) * 100;
    
    block.style.position = 'absolute';
    block.style.left = left + '%';
    block.style.width = Math.max(0.5, width) + '%';
    block.style.top = '10%';
    block.style.height = '80%';
    block.style.borderRadius = '4px';
    block.style.cursor = 'pointer';
    block.style.transition = 'all 0.2s';
    
    if (!c.approved) {
      block.style.background = 'rgba(255, 255, 255, 0.2)';
    } else if (idx === this.activeClipIndex) {
      block.style.background = 'var(--pril)';
      block.style.boxShadow = '0 0 10px var(--pril)';
    } else {
      block.style.background = 'rgba(185, 255, 102, 0.5)';
    }

    block.onclick = () => this.selectClip(idx);
    container.appendChild(block);
  });
};

CropEditor.prototype.selectClip = function(idx) {
  if (idx < 0 || idx >= this.clips.length) return;
  
  if (this.isFullVideoMode && this.clips[this.activeClipIndex]) {
    this.clips[this.activeClipIndex].framingConfig = {
      mode: this.currentMode,
      regions: this.regions.map(r => r.getCropState())
    };
  }

  this.activeClipIndex = idx;
  const clip = this.clips[idx];
  
  this.video.currentTime = clip.start;
  
  const toggle = document.getElementById('cropApproveToggle');
  if (toggle) toggle.checked = clip.approved;
  
  const config = clip.framingConfig;
  if (config && config.mode) {
    this.setMode(config.mode);
    if (config.regions && config.regions.length === this.regions.length) {
      this.regions.forEach((r, i) => {
        r.setCropState(config.regions[i]);
      });
      this._updateDarkOverlay();
      this.undoStack = [this.regions.map(r => r.getCropState())];
    }
  } else {
    this.setMode('vertical');
  }

  this._renderTimelineClips();
};

CropEditor.prototype.exportJobClips = function() {
  if (!this.jobId || !this.isFullVideoMode) return;

  if (this.clips[this.activeClipIndex]) {
    this.clips[this.activeClipIndex].framingConfig = {
      mode: this.currentMode,
      regions: this.regions.map(r => r.getCropState())
    };
  }

  const approvedClips = this.clips
    .map((c, idx) => ({
      index: idx,
      approved: c.approved,
      mode: c.framingConfig.mode,
      regions: c.framingConfig.regions
    }))
    .filter(c => c.approved);

  if (approvedClips.length === 0) {
    alert('Please approve at least one clip.');
    return;
  }

  const btn = document.getElementById('cropExportBtn');
  btn.disabled = true;
  btn.textContent = 'Rendering...';

  fetch(CROP_API + '/api/render-job-clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId: this.jobId,
      approvedClips: approvedClips
    })
  }).then(res => res.json())
  .then(data => {
    this.close();
    if (typeof showProgress === 'function') showProgress();
    if (typeof startPolling === 'function') startPolling(this.jobId);
  }).catch(err => {
    console.error(err);
    alert('Export failed');
  }).finally(() => {
    btn.disabled = false;
    btn.textContent = '\u2B07 Export Approved';
  });
};

// Override the timeline updater for full video mode
const origUpdateTimeline = CropEditor.prototype._updateTimeline;
CropEditor.prototype._updateTimeline = function() {
  origUpdateTimeline.call(this);

  if (this.isFullVideoMode && this.video.duration) {
    const playhead = document.getElementById('cropTimelinePlayhead');
    if (playhead) {
      const pct = (this.video.currentTime / this.video.duration) * 100;
      playhead.style.left = pct + '%';
    }
  }
};

// ═══════════════════════════════════════
//  TOOLTIP INIT
// ═══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const infoBtn = document.getElementById('cropModeInfoBtn');
  if (!infoBtn) return;
  
  infoBtn.addEventListener('mouseenter', (e) => {
    let tooltip = document.getElementById('cropModeInfoTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'cropModeInfoTooltip';
      tooltip.className = 'crop-info-tooltip';
      document.body.appendChild(tooltip);
    }
    
    let html = '';
    for (const [key, val] of Object.entries(CROP_MODES)) {
      html += `<div style="margin-bottom:6px;"><strong>${key.charAt(0).toUpperCase() + key.slice(1)}:</strong> <span style="opacity:0.8;">${val.desc}</span></div>`;
    }
    tooltip.innerHTML = html;
    
    const rect = infoBtn.getBoundingClientRect();
    tooltip.style.left = rect.left + 'px';
    tooltip.style.top = (rect.bottom + 8) + 'px';
    tooltip.style.display = 'block';
  });
  
  infoBtn.addEventListener('mouseleave', () => {
    const tooltip = document.getElementById('cropModeInfoTooltip');
    if (tooltip) tooltip.style.display = 'none';
  });
});








