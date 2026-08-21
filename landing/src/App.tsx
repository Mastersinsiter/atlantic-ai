import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { ArrowRight, Check, Sparkles, Captions, Zap } from 'lucide-react';
import { WordsPullUp } from './components/WordsPullUp';
import { WordsPullUpMultiStyle } from './components/WordsPullUpMultiStyle';
import { AnimatedLetter } from './components/AnimatedLetter';

import AtlanticHero from './components/AtlanticHero';

const NAV_ITEMS = [
  { label: 'How it works', id: 'about' },
  { label: 'Demo', id: 'demo' },
  { label: 'Pricing', id: 'pricing' },
  { label: 'Creator profile', id: 'creator-profile' },
  { label: 'Showcase', id: 'features' },
  { label: 'Get started', id: 'get-started' },
];

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// URL of the real Atlantic AI app (backend/src/server.js serves frontend/public/
// directly, default port 3000). Change VITE_ATLANTIC_APP_URL in .env for prod.
const ATLANTIC_APP_URL =
  import.meta.env.VITE_ATLANTIC_APP_URL || 'http://localhost:3000';

function FeatureCard({ children, delay }: { children: React.ReactNode; delay: number }) {
  const ref = React.useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  return (
    <motion.div
      ref={ref}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={isInView ? { scale: 1, opacity: 1 } : { scale: 0.95, opacity: 0 }}
      transition={{ delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="bg-[#1A1A1A] rounded-2xl p-6 flex flex-col h-full"
    >
      {children}
    </motion.div>
  );
}

function App() {
  const heroRef = useRef<HTMLElement>(null);

  return (
    <main className="w-full relative selection:bg-primary/30 selection:text-primary">
      {/* SECTION 1: HERO */}
      <AtlanticHero />

      {/* SECTION 2: ABOUT */}
      <section id="about" className="bg-black py-24 px-4 md:px-6">
        <div className="max-w-6xl mx-auto bg-[#111111] rounded-[2rem] p-8 md:p-16 text-center">
          <div className="text-primary text-[10px] sm:text-xs uppercase tracking-widest font-bold mb-8">
            Built for creators
          </div>

          <WordsPullUpMultiStyle
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl max-w-4xl mx-auto leading-[0.95] sm:leading-[0.9] text-[#ECECEC] mb-12"
            segments={[
              { text: 'We watched a thousand hours of footage, ', className: 'font-normal' },
              { text: 'so an AI editor never has to sleep. ', className: 'font-serif italic' },
              { text: 'It finds the hook, the punchline, the clutch play — and ships the clip.', className: 'font-normal' },
            ]}
          />

          <div className="max-w-2xl mx-auto text-[#ECECEC] text-xs sm:text-sm md:text-base leading-relaxed">
            <AnimatedLetter text="Every clip runs through the same pipeline: Gemini watches the video and times every spoken word, FFmpeg reframes it to vertical in a single pass, and your captions land exactly when the words are said — frame-accurate, every time." />
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-black py-12 px-4 md:px-6">
        <div className="max-w-4xl mx-auto text-center text-gray-500 text-sm">
          Pricing details coming soon.
        </div>
      </section>

      <section id="creator-profile" className="bg-black py-12 px-4 md:px-6">
        <div className="max-w-4xl mx-auto text-center text-gray-500 text-sm">
          Creator profile settings coming soon.
        </div>
      </section>

      {/* SECTION 3: FEATURES */}
      <section id="features" className="min-h-screen bg-black relative px-4 md:px-6 py-24 overflow-hidden">
        <div className="absolute inset-0 bg-noise opacity-[0.15] pointer-events-none"></div>

        <div className="max-w-7xl mx-auto relative z-10">
          <div className="mb-16 max-w-3xl">
            <WordsPullUpMultiStyle
              className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-normal text-left justify-start"
              segments={[
                { text: 'One upload. Every format your audience scrolls past. ', className: 'text-[#ECECEC] block mb-2' },
                { text: 'Captions that move with the voice, not against it.', className: 'text-gray-500 block' },
              ]}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-2 md:gap-4 lg:h-[480px]">
            <FeatureCard delay={0}>
              <div className="relative w-full h-full min-h-[250px] rounded-xl overflow-hidden mb-4">
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                  src="/demos/final-clip-1.mp4"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-4">
                  <span className="text-[#ECECEC] font-medium text-sm">Your raw footage, reframed.</span>
                </div>
              </div>
            </FeatureCard>

            <FeatureCard delay={0.15}>
              <Sparkles className="w-10 h-10 sm:w-12 sm:h-12 text-[#ECECEC] mb-6" />
              <h3 className="text-[#ECECEC] text-xl font-medium mb-6">
                <span className="text-gray-500 mr-2">01</span> Highlight Detection.
              </h3>
              <ul className="space-y-4 mb-auto">
                {['Scores every moment for virality', 'Finds hooks, punchlines, clutch plays', 'Picks the best thumbnail frame', 'Works on uploads or a pasted URL'].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-gray-400 text-sm">
                    <Check className="w-5 h-5 text-primary shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => scrollToSection('about')}
                className="flex items-center gap-2 text-[#ECECEC] text-sm mt-8 hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-0 w-fit"
              >
                Learn more <ArrowRight className="w-4 h-4 -rotate-45" />
              </button>
            </FeatureCard>

            <FeatureCard delay={0.3}>
              <Captions className="w-10 h-10 sm:w-12 sm:h-12 text-[#ECECEC] mb-6" />
              <h3 className="text-[#ECECEC] text-xl font-medium mb-6">
                <span className="text-gray-500 mr-2">02</span> Word-Level Captions.
              </h3>
              <ul className="space-y-4 mb-auto">
                {['Timed to the exact spoken word', '7 caption styles — TikTok, gaming, karaoke, neon', 'Editable timing and text after export'].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-gray-400 text-sm">
                    <Check className="w-5 h-5 text-primary shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => scrollToSection('about')}
                className="flex items-center gap-2 text-[#ECECEC] text-sm mt-8 hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-0 w-fit"
              >
                Learn more <ArrowRight className="w-4 h-4 -rotate-45" />
              </button>
            </FeatureCard>

            <FeatureCard delay={0.45}>
              <Zap className="w-10 h-10 sm:w-12 sm:h-12 text-[#ECECEC] mb-6" />
              <h3 className="text-[#ECECEC] text-xl font-medium mb-6">
                <span className="text-gray-500 mr-2">03</span> One-Pass Render.
              </h3>
              <ul className="space-y-4 mb-auto">
                {['Cut, reframe, caption, watermark — single FFmpeg pass', 'No sync drift between audio and captions', 'Exports ready for TikTok, Reels, Shorts'].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-gray-400 text-sm">
                    <Check className="w-5 h-5 text-primary shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => scrollToSection('about')}
                className="flex items-center gap-2 text-[#ECECEC] text-sm mt-8 hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-0 w-fit"
              >
                Learn more <ArrowRight className="w-4 h-4 -rotate-45" />
              </button>
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* SECTION 4: DEMO SHOWCASE */}
      <section id="demo" className="bg-[#0A0A0A] py-24 px-4 md:px-6 relative overflow-hidden border-t border-[#222]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="text-primary text-[10px] sm:text-xs uppercase tracking-widest font-bold mb-4">
              Interactive Demo
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl text-[#ECECEC] font-medium tracking-tight mb-4">
              From Raw Stream to Viral Clips
            </h2>
            <p className="text-gray-400 max-w-xl mx-auto text-sm sm:text-base">
              Click or play the demo stream below to watch Atlantic AI analyze moments, reframe portrait compositions, and generate ready-to-publish shorts.
            </p>
          </div>

          {/* Full NVIDIA Demo Video (Always shown initially) */}
          <div className="mb-8 bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden shadow-2xl relative">
            <div className="px-6 py-4 bg-[#1A1A1A] border-b border-[#262626] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
                <span className="text-xs uppercase tracking-wider text-[#ECECEC] font-mono font-medium">Input Stream Footage</span>
              </div>
              <span className="text-xs text-gray-400 font-mono">NVIDIA Stream • 1080p 60fps</span>
            </div>
            <div className="aspect-video w-full bg-black relative group">
              <video
                controls
                preload="metadata"
                className="w-full h-full object-contain cursor-pointer"
                src="/demos/nvidia-demo-video.mp4"
                onPlay={() => {
                  const el = document.getElementById('landing-interactive-results');
                  if (el) el.style.display = 'block';
                }}
              />
            </div>
          </div>

          {/* Trigger button */}
          <div className="text-center mb-12">
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('landing-interactive-results');
                if (el) {
                  el.style.display = 'block';
                  el.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className="bg-primary text-black font-semibold px-6 py-3 rounded-full text-sm hover:scale-105 transition-transform inline-flex items-center gap-2"
            >
              ⚡ Extract Clips & Open Interactive Reframe Studio
            </button>
            <p className="text-xs text-gray-500 mt-2">👆 Click to test the highlight detection & reframing engine</p>
          </div>

          {/* Interactive Results (Revealed on click/play) */}
          <div id="landing-interactive-results" style={{ display: 'none' }}>
            
            {/* Live Reframe Preview Studio */}
            <div className="mb-16 bg-[#111] border border-[#222] rounded-3xl p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-[#222]">
                <div>
                  <span className="text-primary text-[10px] font-mono uppercase tracking-wider bg-primary/10 px-2 py-1 rounded">Interactive Feature</span>
                  <h3 className="text-xl font-bold text-white mt-2">Live AI Reframing Studio</h3>
                  <p className="text-xs text-gray-400">Centers gameplay, facecams, and auto-generates animated subtitles in real-time.</p>
                </div>
                <a
                  href={ATLANTIC_APP_URL}
                  className="px-4 py-2 bg-[#222] hover:bg-[#333] text-white text-xs font-semibold rounded-lg border border-[#333] transition-colors w-fit"
                >
                  Open in Atlantic Studio →
                </a>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 16:9 Stage */}
                <div className="lg:col-span-2 bg-black rounded-xl overflow-hidden border border-[#262626] relative aspect-video flex items-center justify-center">
                  <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-contain"
                    src="/demos/nvidia-demo-video.mp4"
                  />
                  {/* Visual 9:16 crop framing overlay */}
                  <div className="absolute inset-y-0 w-[31.6%] border-2 border-primary bg-primary/10 shadow-[0_0_25px_rgba(236,236,236,0.3)] flex items-start justify-center pt-2 pointer-events-none">
                    <span className="bg-black/80 text-[10px] text-primary px-2 py-0.5 rounded-full font-mono">9:16 Subject Focus</span>
                  </div>
                </div>

                {/* 9:16 Vertical Output Card */}
                <div className="bg-black rounded-xl overflow-hidden border border-[#262626] p-4 flex flex-col items-center justify-center">
                  <div className="text-xs font-mono text-gray-400 mb-2 w-full flex justify-between">
                    <span>Live 9:16 Mobile</span>
                    <span className="text-primary">● Active</span>
                  </div>
                  <div className="w-[180px] aspect-[9/16] rounded-2xl overflow-hidden border-2 border-[#333] relative bg-black shadow-xl">
                    <video
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                      src="/demos/final-clip-1.mp4"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Output Clips Header & Row */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
                <h3 className="text-lg font-medium text-[#ECECEC]">2 AI-Generated Output Clips</h3>
              </div>
              <p className="text-xs text-gray-400">Extracted, reframed to 9:16 portrait, and auto-captioned.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden flex flex-col hover:border-[#444] transition-all">
                <div className="p-3 bg-[#1A1A1A] border-b border-[#262626] flex items-center justify-between text-xs text-gray-400 font-mono">
                  <span>Clip 01</span>
                  <span className="text-primary text-[10px] uppercase font-bold">9:16 Reframe</span>
                </div>
                <div className="aspect-[9/16] w-full bg-black">
                  <video
                    controls
                    preload="metadata"
                    playsInline
                    className="w-full h-full object-cover"
                    src="/demos/final-clip-1.mp4"
                  />
                </div>
              </div>

              <div className="bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden flex flex-col hover:border-[#444] transition-all">
                <div className="p-3 bg-[#1A1A1A] border-b border-[#262626] flex items-center justify-between text-xs text-gray-400 font-mono">
                  <span>Clip 02</span>
                  <span className="text-primary text-[10px] uppercase font-bold">Auto Captions</span>
                </div>
                <div className="aspect-[9/16] w-full bg-black">
                  <video
                    controls
                    preload="metadata"
                    playsInline
                    className="w-full h-full object-cover"
                    src="/demos/final-clip-2.mp4"
                  />
                </div>
              </div>

            </div>

          </div>
        </div>
      </section>

      <section id="get-started" className="bg-black py-24 px-4 md:px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl text-[#ECECEC] font-medium mb-6">
            Drop in a video or paste a link.
          </h2>
          <p className="text-gray-400 text-sm sm:text-base mb-10">
            Atlantic AI handles the rest — highlight detection, vertical reframe, word-accurate captions.
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.href = ATLANTIC_APP_URL;
            }}
            className="group bg-primary text-black rounded-full font-medium text-sm sm:text-base px-1 py-1 pl-6 flex items-center gap-4 hover:gap-6 transition-all duration-300 mx-auto"
          >
            Go to Atlantic AI
            <div className="bg-black rounded-full w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center transition-transform duration-300 group-hover:scale-110">
              <ArrowRight className="text-[#ECECEC] w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </button>
        </div>
      </section>
    </main>
  );
}

export default App;
