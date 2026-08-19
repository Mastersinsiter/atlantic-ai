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
  { label: 'CLIPPING', href: '#clipping' },
  { label: 'DEMO', href: '#demo' },
  { label: 'SUBTITLES', href: '#subtitles' },
  { label: 'REFRAME', href: '#reframe' },
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
    <section className="relative h-screen w-full overflow-hidden bg-[#070b0a]">
      {/* ── Background video ── */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover opacity-60"
      />

      {/* ── Overlays ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to right, #070b0a 0%, transparent 55%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, #070b0a 0%, transparent 45%)',
        }}
      />

      {/* ── Grid lines (desktop only) ── */}
      <div className="absolute inset-0 pointer-events-none hidden md:block">
        <div className="absolute top-0 bottom-0 left-1/4 w-px bg-white/10" />
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/10" />
        <div className="absolute top-0 bottom-0 left-3/4 w-px bg-white/10" />
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
      <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 md:px-12 py-6">
        <a href="#" className="text-white font-semibold text-lg tracking-tight">
          Atlantic <span className="text-[#5ed29c]">AI</span>
        </a>

        <nav className="hidden md:flex items-center gap-10">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-white text-[16px] font-[Inter] transition-colors hover:text-[#5ed29c]"
            >
              {link.label}
            </a>
          ))}
        </nav>

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
            <span className="text-white font-semibold text-lg">
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
                className="text-white text-2xl font-[Inter] transition-colors hover:text-[#5ed29c]"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      )}

      {/* ── Hero content ── */}
      <div className="relative z-20 flex h-full flex-col items-center justify-center px-6 text-center">
        {/* Liquid glass card */}
        <div className="liquid-glass-card relative translate-y-[-50px] flex h-[200px] w-[200px] flex-col items-center justify-center gap-2 rounded-2xl px-5 text-center">
          <span className="text-[14px] text-[#5ed29c] font-[Plus_Jakarta_Sans] font-bold tracking-wide">
            [ FAILSAFE ]
          </span>
          <span className="text-[18px] leading-snug text-white font-[Inter]">
            Failure is not the end.{' '}
            <span className="font-['Instrument_Serif'] italic text-[#5ed29c]">
              Atlantic
            </span>{' '}
            still ships the clip.
          </span>
          <span className="text-[11px] text-white/60 font-[Inter]">
            Analysis fails sometimes. The render never stops.
          </span>
        </div>

        <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#5ed29c] font-[Plus_Jakarta_Sans]">
          Built for creators who post daily
        </p>

        <h1 className="mt-4 max-w-4xl font-[Inter] font-extrabold uppercase tracking-tight text-white text-[40px] md:text-[72px] leading-[0.95]">
          TURN LONG FOOTAGE INTO CLIPS THAT ACTUALLY GET WATCHED
          <span className="text-[#5ed29c]">.</span>
        </h1>

        <p className="mt-6 max-w-[512px] text-[14px] text-white/70 font-[Inter]">
          Atlantic AI watches your full upload, finds the moments worth
          keeping, and cuts them into vertical clips with word-accurate
          captions — reframed properly, never just zoomed in.
        </p>

        <a
          href={import.meta.env.VITE_ATLANTIC_APP_URL || 'http://localhost:3000'}
          className="group mt-8 inline-flex items-center gap-3 rounded-full bg-[#5ed29c] px-6 py-3 text-[13px] font-bold uppercase tracking-wide text-[#070b0a] font-[Inter] transition-transform hover:scale-[1.03]"
        >
          Get Started
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
        </a>
      </div>

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
