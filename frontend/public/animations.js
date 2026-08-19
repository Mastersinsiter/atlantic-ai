/* ═══════════════════════════════════════════════════════════════
   ATLANTIC AI — ORGANIC WATERCOLOR & EDITORIAL MOTION ENGINE
   ───────────────────────────────────────────────────────────────
   Atmosphere: White Paper × Soft Watercolor Washes × Gallery Studio
   Provides:
     - Organic Watercolor Pigment Drift & Breathing Physics
     - Subtle Interactive Mouse Pigment Shift
     - Editorial Staggered Typography Entrances
     - Apple-grade Spring Button Physics
     - Fluid Scroll Parallax & Gallery Scene Transitions
     - Real-Time Progress Ring & Stage Tracking
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const AtlanticAnim = {};
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ═══════════════════════════════════════════════════════════
  //  1. EDITORIAL HERO ENTRANCE
  // ═══════════════════════════════════════════════════════════
  AtlanticAnim.heroEntrance = function () {
    if (prefersReducedMotion) {
      document.querySelectorAll('.hero-badge, .hero-title, .hero-subtitle, .fw, .sstrip, .nav-pill').forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
      return;
    }

    if (typeof anime !== 'undefined') {
      const tl = anime.timeline({
        easing: 'cubicBezier(0.16, 1, 0.3, 1)'
      });

      // 0.20s: Watercolor Bloom
      tl.add({
        targets: '.watercolor-wash',
        opacity: [0, 1],
        scale: [0.92, 1],
        duration: 1800,
        delay: anime.stagger(150),
        easing: 'easeOutQuad'
      })
      // 0.50s: Navigation
      .add({
        targets: '.nav-container',
        opacity: [0, 1],
        translateY: [-16, 0],
        duration: 800,
        easing: 'easeOutCubic'
      }, 400)
      // 0.70s: Hero Badge
      .add({
        targets: '.hero-badge',
        opacity: [0, 1],
        translateY: [16, 0],
        duration: 700,
        easing: 'easeOutCubic'
      }, 600)
      // 0.90s: Editorial Typography
      .add({
        targets: '.hero-title .title-line',
        opacity: [0, 1],
        translateY: [32, 0],
        delay: anime.stagger(120),
        duration: 900,
        easing: 'cubicBezier(0.16, 1, 0.3, 1)'
      }, 800)
      // 1.20s: Subtitle & Description
      .add({
        targets: '.hero-subtitle',
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 750,
        easing: 'easeOutQuad'
      }, 1100)
      // 1.50s: White Ingestion Studio Canvas (Spring Entry)
      .add({
        targets: '.fw',
        opacity: [0, 1],
        translateY: [28, 0],
        scale: [0.98, 1],
        duration: 900,
        easing: 'cubicBezier(0.16, 1, 0.3, 1)'
      }, 1400)
      // 1.80s: Status Telemetry
      .add({
        targets: '.sstrip',
        opacity: [0, 1],
        translateY: [12, 0],
        duration: 600,
        easing: 'easeOutQuad'
      }, 1700);
    }
  };

  // ═══════════════════════════════════════════════════════════
  //  2. ORGANIC WATERCOLOR MOUSE SHIFT
  // ═══════════════════════════════════════════════════════════
  AtlanticAnim.initWatercolorPhysics = function () {
    if (window.matchMedia('(pointer: coarse)').matches || prefersReducedMotion) return;

    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;

    window.addEventListener('mousemove', (e) => {
      // Normalized offset (-1 to 1)
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      targetX = nx * 35; // 35px gentle max travel
      targetY = ny * 35;
    }, { passive: true });

    function renderWatercolor() {
      // Extremely smooth organic lerp
      currentX += (targetX - currentX) * 0.04;
      currentY += (targetY - currentY) * 0.04;

      const wash1 = document.getElementById('wash1');
      const wash2 = document.getElementById('wash2');
      const wash3 = document.getElementById('wash3');
      const wash4 = document.getElementById('wash4');

      if (wash1) wash1.style.transform = `translate3d(${currentX * 0.8}px, ${currentY * 0.8}px, 0)`;
      if (wash2) wash2.style.transform = `translate3d(${-currentX * 1.1}px, ${-currentY * 0.9}px, 0)`;
      if (wash3) wash3.style.transform = `translate3d(${currentX * 0.5}px, ${-currentY * 0.6}px, 0)`;
      if (wash4) wash4.style.transform = `translate3d(${-currentX * 0.7}px, ${currentY * 0.5}px, 0)`;

      requestAnimationFrame(renderWatercolor);
    }
    requestAnimationFrame(renderWatercolor);
  };

  // ═══════════════════════════════════════════════════════════
  //  3. SCROLL REVEAL (GALLERY SCENE PROGRESSION)
  // ═══════════════════════════════════════════════════════════
  AtlanticAnim.initScrollReveal = function (selector) {
    selector = selector || '.rv';
    const els = document.querySelectorAll(selector);
    if (!els.length) return;

    if (prefersReducedMotion) {
      els.forEach(el => el.classList.add('in'));
      return;
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        if (typeof anime !== 'undefined') {
          anime({
            targets: entry.target,
            opacity: [0, 1],
            translateY: [28, 0],
            duration: 850,
            easing: 'cubicBezier(0.16, 1, 0.3, 1)'
          });
        } else {
          entry.target.classList.add('in');
        }
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12 });

    els.forEach((el) => {
      el.style.opacity = 0;
      io.observe(el);
    });
  };

  // ═══════════════════════════════════════════════════════════
  //  4. TACTILE EDITORIAL BUTTON PHYSICS
  // ═══════════════════════════════════════════════════════════
  AtlanticAnim.wireButtonPress = function (selector) {
    const targets = document.querySelectorAll(selector || '.fbtn, .bctabtn, .clip-cnt-btn, .lang-btn, .tab, .clip-pill, .crop-mode-tab, .btn-reframe, .btn, .nav-btn-profile');
    
    targets.forEach((btn) => {
      if (btn.dataset.animWired) return;
      btn.dataset.animWired = '1';

      btn.addEventListener('pointerdown', () => {
        if (typeof anime !== 'undefined') {
          anime({ targets: btn, scale: 0.97, duration: 90, easing: 'easeOutQuad' });
        } else {
          btn.style.transform = 'scale(0.97)';
        }
      });

      const release = () => {
        if (typeof anime !== 'undefined') {
          anime({ targets: btn, scale: 1, duration: 220, easing: 'cubicBezier(0.16, 1, 0.3, 1)' });
        } else {
          btn.style.transform = '';
        }
      };

      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointerleave', release);
    });
  };

  // ═══════════════════════════════════════════════════════════
  //  5. STAGGERED RESULTS CARD EXPANSION
  // ═══════════════════════════════════════════════════════════
  AtlanticAnim.staggerIn = function (containerSelector, itemSelector) {
    const items = document.querySelectorAll(`${containerSelector} ${itemSelector}`);
    if (!items.length) return;

    if (typeof anime !== 'undefined') {
      anime({
        targets: items,
        opacity: [0, 1],
        translateY: [24, 0],
        scale: [0.97, 1],
        delay: anime.stagger(80, { start: 100 }),
        duration: 650,
        easing: 'cubicBezier(0.16, 1, 0.3, 1)'
      });
    } else {
      items.forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
    }
  };

  // ═══════════════════════════════════════════════════════════
  //  6. TOAST NOTIFICATION
  // ═══════════════════════════════════════════════════════════
  AtlanticAnim.animateToast = function (el) {
    if (!el) return;
    if (typeof anime !== 'undefined') {
      anime({
        targets: el,
        translateY: [32, 0],
        opacity: [0, 1],
        duration: 400,
        easing: 'cubicBezier(0.16, 1, 0.3, 1)'
      });
    }
  };

  // ═══════════════════════════════════════════════════════════
  //  7. PROGRESS RING & STAGES
  // ═══════════════════════════════════════════════════════════
  let _displayedPct = 0;

  const STAGE_LABELS = [
    { max: 15, label: 'Fetching stream footage...' },
    { max: 35, label: 'Discovering peak viral moments...' },
    { max: 55, label: 'Generating word-level transcript...' },
    { max: 80, label: 'Reframing 9:16 portrait composition...' },
    { max: 98, label: 'Styling dynamic captions & rendering...' },
    { max: 100, label: 'Clips ready in studio...' }
  ];

  function stageLabelFor(pct) {
    const hit = STAGE_LABELS.find((s) => pct <= s.max);
    return hit ? hit.label : 'Processing...';
  }

  AtlanticAnim.animateLoaderProgress = function (targetPct) {
    const ring = document.getElementById('loaderRingFill');
    const pctEl = document.getElementById('forgePct');
    const stageEl = document.getElementById('forgeStatus');
    if (!pctEl) return;

    const circumference = 2 * Math.PI * 52; // r = 52
    const state = { pct: _displayedPct };

    if (typeof anime !== 'undefined') {
      anime({
        targets: state,
        pct: targetPct,
        duration: 400,
        easing: 'easeOutQuad',
        update: () => {
          if (ring) {
            const offset = circumference * (1 - state.pct / 100);
            ring.style.strokeDashoffset = offset;
          }
          pctEl.textContent = `${Math.round(state.pct)}%`;
        }
      });
    } else {
      if (ring) ring.style.strokeDashoffset = circumference * (1 - targetPct / 100);
      pctEl.textContent = `${Math.round(targetPct)}%`;
    }

    if (stageEl) stageEl.textContent = stageLabelFor(targetPct);
    _displayedPct = targetPct;
  };

  AtlanticAnim.resetLoaderProgress = function () {
    _displayedPct = 0;
    const ring = document.getElementById('loaderRingFill');
    const pctEl = document.getElementById('forgePct');
    const stageEl = document.getElementById('forgeStatus');
    const circumference = 2 * Math.PI * 52;
    if (ring) ring.style.strokeDashoffset = circumference;
    if (pctEl) pctEl.textContent = '0%';
    if (stageEl) stageEl.textContent = STAGE_LABELS[0].label;
  };

  window.AtlanticAnim = AtlanticAnim;

  document.addEventListener('DOMContentLoaded', () => {
    AtlanticAnim.heroEntrance();
    AtlanticAnim.initWatercolorPhysics();
    AtlanticAnim.initScrollReveal('.rv');
    AtlanticAnim.wireButtonPress();
  });
})();
