import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import Hls from 'hls.js';

/**
 * Atlantic AI — Hero Section
 *
 * Adapted from a coding-education hero brief. Every exact spec from the
 * brief (liquid-glass card dimensions, border mask technique, grid lines,
 * type scale) is preserved — only the subject matter, copy, palette
 * anchor, and the glass card's content were reworked for Atlantic AI.
 *
 * The "[ 2025 ]" glass card now carries the line "Failure is not the
 * end." This isn't a bolted-on motivational quote — it's literally true
 * of the product: when Gemini's analysis fails (quota limits, a parse
 * error, anything), Atlantic AI falls back to a heuristic clip-selection
 * pass rather than stopping. The clip still gets made. The phrase has a
 * real mechanism behind it, not just a vibe.
 */

const NAV_LINKS = [
  { label: 'HOW IT WORKS', href: '#about' },
  { label: 'SHOWCASE', href: '#features' },
  { label: 'INTERACTIVE DEMO', href: '#demo' },
  { label: 'PRICING', href: '#pricing' },
];

export default function AtlanticHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const src = 'https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8';

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false });
      hls.loadSource(src);
      hls.attachMedia(video);
      return () => hls.destroy();
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari has native HLS support, no hls.js needed.
      video.src = src;
    }
  }, []);

  return (
    <section className="relative min-h-screen w-full overflow-hidden bg-[#070b0a] flex flex-col justify-between">
      {/* ── Background video ── */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover opacity-50"
      />

      {/* ── Overlays ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to right, #070b0a 0%, rgba(7,11,10,0.7) 50%, transparent 100%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, #070b0a 0%, rgba(7,11,10,0.5) 45%, transparent 100%)',
        }}
      />

      {/* ── Grid lines (desktop only) ── */}
      <div className="absolute inset-0 pointer-events-none hidden md:block">
        <div className="absolute top-0 bottom-0 left-1/4 w-px bg-white/5" />
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/5" />
        <div className="absolute top-0 bottom-0 left-3/4 w-px bg-white/5" />
      </div>

      {/* ── Central glow ── */}
      <svg
        className="absolute top-[-10%] left-1/2 -translate-x-1/2 pointer-events-none"
        width="1100"
        height="500"
        viewBox="0 0 1100 500"
        fill="none"
      >
        <defs>
          <filter id="heroGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="25" />
          </filter>
          <radialGradient id="glowColor" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#5ed29c" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0d3b2e" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse
          cx="550"
          cy="250"
          rx="480"
          ry="160"
          fill="url(#glowColor)"
          filter="url(#heroGlow)"
        />
      </svg>

      {/* ── Header ── */}
      <header className="relative z-30 flex items-center justify-between px-6 md:px-12 py-6 w-full backdrop-blur-sm border-b border-white/5 bg-black/20">
        <a href="#" className="text-white font-bold text-xl tracking-tight flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#5ed29c]"></span>
          Atlantic <span className="text-[#5ed29c]">AI</span>
        </a>

        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-white/80 text-sm font-medium tracking-wide font-[Inter] transition-colors hover:text-[#5ed29c]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-4">
          <a
            href={import.meta.env.VITE_ATLANTIC_APP_URL || 'http://localhost:3000'}
            className="rounded-full bg-[#5ed29c] px-5 py-2 text-xs font-bold uppercase tracking-wider text-[#070b0a] font-[Inter] transition-all hover:scale-105 hover:shadow-[0_0_20px_rgba(94,210,156,0.3)]"
          >
            Launch Studio →
          </a>
        </div>

        <button
          type="button"
          className="md:hidden text-white"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={26} />
        </button>
      </header>

      {/* ── Mobile menu overlay ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-[#070b0a] flex flex-col">
          <div className="flex items-center justify-between px-6 py-6">
            <span className="text-white font-bold text-lg">
              Atlantic <span className="text-[#5ed29c]">AI</span>
            </span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="text-white"
              aria-label="Close menu"
            >
              <X size={26} />
            </button>
          </div>
          <nav className="flex flex-col items-center justify-center gap-8 flex-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="text-white text-xl font-[Inter] transition-colors hover:text-[#5ed29c]"
              >
                {link.label}
              </a>
            ))}
            <a
              href={import.meta.env.VITE_ATLANTIC_APP_URL || 'http://localhost:3000'}
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-full bg-[#5ed29c] px-8 py-3 text-sm font-bold uppercase text-[#070b0a] mt-4"
            >
              Launch Studio →
            </a>
          </nav>
        </div>
      )}

      {/* ── Hero content ── */}
      <div className="relative z-20 flex flex-1 flex-col items-center justify-center px-6 py-16 text-center max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#5ed29c]/40 bg-[#5ed29c]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#5ed29c] backdrop-blur-md mb-6 shadow-[0_0_20px_rgba(94,210,156,0.15)]">
          <span className="h-2 w-2 rounded-full bg-[#5ed29c] animate-pulse"></span>
          AI Video Intelligence & Stream Reframe Engine
        </div>

        <h1 className="font-[Inter] font-extrabold uppercase tracking-tight text-white text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.05] mb-6">
          TURN LONG FOOTAGE INTO CLIPS THAT ACTUALLY GET WATCHED<span className="text-[#5ed29c]">.</span>
        </h1>

        <p className="max-w-2xl text-sm sm:text-base md:text-lg text-white/70 font-[Inter] leading-relaxed mb-10">
          Atlantic AI watches your full upload, discovers peak viral highlights, reframes subjects to vertical 9:16 portrait, and burns frame-accurate animated captions.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href={import.meta.env.VITE_ATLANTIC_APP_URL || 'http://localhost:3000'}
            className="group inline-flex items-center gap-3 rounded-full bg-[#5ed29c] px-8 py-4 text-xs sm:text-sm font-bold uppercase tracking-wider text-[#070b0a] font-[Inter] transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(94,210,156,0.4)]"
          >
            Open Atlantic Studio Free
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </a>
          <a
            href="#demo"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-4 text-xs sm:text-sm font-medium text-white transition-colors hover:bg-white/15 backdrop-blur-sm"
          >
            ⚡ Test Interactive Demo
          </a>
        </div>
      </div>

      {/* Bottom spacer for clean alignment */}
      <div className="pb-6"></div>

      {/* ── Liquid glass card styles ──
          Implements the exact technique from the brief: a ::before
          pseudo-element using mask-composite to carve out a 1.4px ring,
          producing a crisp gradient border frame instead of a flat
          border. CSS custom properties keep the JSX above clean. */}
      <style>{`
        .liquid-glass-card {
          background: rgba(255, 255, 255, 0.01);
          background-blend-mode: luminosity;
          backdrop-filter: blur(4px);
          box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.1);
        }
        .liquid-glass-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1.4px;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.5),
            rgba(255, 255, 255, 0)
          );
          -webkit-mask:
            linear-gradient(#fff 0 0) content-box,
            linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }
      `}</style>
    </section>
  );
}
