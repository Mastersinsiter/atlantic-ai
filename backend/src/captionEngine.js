/**
 * captionEngine.js — Atlantic AI Caption Engine v5
 *
 * Clean rewrite. Transcription sources: OpenAI Whisper API or Gemini (via
 * transcription.js). No ElevenLabs, no Python aligner, no Groq.
 *
 * Pipeline:
 *   words[] → segmentIntoCards() → cues[] → cuesToASS() → ASS file
 *
 * A "cue" is one on-screen caption card:
 *   { start, end, text, displayText, words, styledWords, lines, emphasis, emotion }
 * All times are CLIP-RELATIVE seconds (0 = clip start).
 */

import { buildStyleConfig } from './captionStyles.js';
import { splitIntoNaturalLines, wrapWordsToLines, computeMaxWidthPx } from './captionLayout.js';

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────

/** Minimum on-screen time for any cue (seconds). */
const MIN_CUE_DURATION = 0.55;
/** Maximum on-screen time before we force a break. */
const MAX_CUE_DURATION = 2.8;
/** Reading-speed ceiling in chars/sec (matches subtitleQuality scorer). */
const MAX_CPS = 25;
/** Silence gap (seconds) that forces a new card. */
const SILENCE_BREAK_SEC = 0.28;

const EMPHASIS_WORDS = new Set([
  'NO', 'BRO', 'WAIT', 'RUN', 'WHAT', 'INSANE', 'WTF', 'OMG', "LET'S GO",
  'HEADSHOT', 'WIN', 'LOSE', 'STOP', 'OH', 'HOLY', 'LMAO', 'CLUTCH', 'RAGE',
  'BHAI', 'YAAR', 'ARRE', 'ABE', 'OP', 'GG', 'NOOB', 'PRO',
]);

const EMOTION_HINTS = {
  scream:    ['scream', 'screaming', 'ahhh', 'aaa', 'nooo'],
  laugh:     ['haha', 'lol', 'lmao', 'laugh', 'funny'],
  surprise:  ['wait', 'what', 'insane', 'holy', 'no way', 'wtf', 'bhai'],
  excitement:["let's go", 'win', 'clutch', 'headshot', 'yes', 'ohhh', 'op'],
  fear:      ['no', 'run', 'dont', 'stop', 'help'],
  anger:     ['rage', 'annoying', 'trash', 'lose', 'bad'],
};

const EMOJI_POOL = ['💀', '😂', '🔥', '😭', '😳', '🤯'];

// ─────────────────────────────────────────────
//  Time formatting
// ─────────────────────────────────────────────

/** seconds → ASS time "H:MM:SS.cc" */
function formatAssTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** seconds → SRT time "HH:MM:SS,mmm" */
function formatSrtTime(sec) {
  let totalMs = Math.round(Math.max(0, sec) * 1000);
  const h = Math.floor(totalMs / 3600000); totalMs -= h * 3600000;
  const m = Math.floor(totalMs / 60000);   totalMs -= m * 60000;
  const s = Math.floor(totalMs / 1000);
  const ms = totalMs - s * 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// ─────────────────────────────────────────────
//  Color / style helpers
// ─────────────────────────────────────────────

/** '#RRGGBB' → '&H00BBGGRR' (ASS BGR). Safe fallback white. */
function hexToASS(hex) {
  const clean = String(hex || '').replace(/^#/, '').trim();
  let r, g, b;
  if (clean.length === 3) { r = clean[0] + clean[0]; g = clean[1] + clean[1]; b = clean[2] + clean[2]; }
  else if (clean.length === 6) { r = clean.slice(0, 2); g = clean.slice(2, 4); b = clean.slice(4, 6); }
  else return '&H00FFFFFF';
  if (!/^[0-9A-Fa-f]{6}$/.test(r + g + b)) return '&H00FFFFFF';
  return `&H00${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

function normalizeWord(text = '') {
  return String(text || '').trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').toUpperCase();
}

function detectEmotionHint(text = '') {
  const n = String(text || '').toLowerCase();
  for (const [emotion, hints] of Object.entries(EMOTION_HINTS)) {
    if (hints.some(h => n.includes(h))) return emotion;
  }
  return null;
}

function pickWordStyle(word, styleConfig = {}) {
  const n = normalizeWord(word);
  const em = styleConfig.emphasis || {};
  if (['WHAT', 'WAIT', 'BRO', 'OMG', 'WTF', 'BHAI'].includes(n)) {
    return { color: em.question || '#60A5FA', weight: 'bold', emphasis: 'question' };
  }
  if (['WIN', "LET'S GO", 'CLUTCH', 'GG', 'OP'].includes(n)) {
    return { color: em.positive || '#4ADE80', weight: 'bold', emphasis: 'positive' };
  }
  if (['LOSE', 'NO', 'RUN', 'STOP'].includes(n)) {
    return { color: em.danger || '#F87171', weight: 'bold', emphasis: 'danger' };
  }
  if (EMPHASIS_WORDS.has(n)) {
    return { color: em.important || '#FACC15', weight: 'bold', emphasis: 'important' };
  }
  return { color: em.default || '#FFFFFF', weight: 'normal', emphasis: 'default' };
}

function maybeAddEmoji(text, styleConfig = {}, cueIndex = 0) {
  if (!styleConfig.emoji) return text;
  if (cueIndex % 7 !== 0 || Math.random() <= 0.4) return text;
  return `${text} ${EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)]}`;
}

function buildCueText(words, styleConfig, cueIndex) {
  const parts = words.map(w => {
    const text = String(w.word || '').trim();
    if (!text) return null;
    return { text, style: pickWordStyle(text, styleConfig) };
  }).filter(Boolean);

  if (!parts.length) return { plainText: '', styledWords: [] };

  const hasEmphasis = parts.some(p => p.style.emphasis !== 'default');
  const plainText = parts.map(p => p.text).join(' ');
  const finalText = hasEmphasis ? maybeAddEmoji(plainText, styleConfig, cueIndex) : plainText;

  const styledWords = parts.map(p => ({ text: p.text, style: p.style }));
  if (finalText !== plainText) {
    const emoji = finalText.slice(plainText.length).trim();
    if (emoji) styledWords.push({ text: emoji, style: { color: (styleConfig.emphasis || {}).default || '#FFFFFF', weight: 'normal', emphasis: 'default' } });
  }
  return { plainText: finalText, styledWords };
}

// ─────────────────────────────────────────────
//  Timing sanitizer — single chokepoint
// ─────────────────────────────────────────────

/**
 * Guarantee a cue is renderable: 0 ≤ start < end ≤ clipDuration, end-start ≥ minFloor.
 */
function sanitizeCueTiming(start, end, clipDuration, minFloor = MIN_CUE_DURATION) {
  const safeClip = Math.max(minFloor + 0.01, Number(clipDuration) || 0);
  let s = Math.max(0, Number(start) || 0);
  let e = Number(end) || 0;
  if (s > safeClip - minFloor) s = safeClip - minFloor;
  if (e > safeClip) e = safeClip;
  if (e - s < minFloor) {
    e = Math.min(safeClip, s + minFloor);
    if (e - s < minFloor) s = Math.max(0, e - minFloor);
  }
  return { start: Math.round(s * 1000) / 1000, end: Math.round(e * 1000) / 1000 };
}

// ─────────────────────────────────────────────
//  Word normalization
// ─────────────────────────────────────────────

/**
 * Normalize any word array to clip-relative { word, start, end }.
 * Accepts { word, t, end } (absolute) or { word, start, end } (either timeline).
 */
export function normalizeWordsToClip(rawWords, clipStart, clipDuration) {
  if (!Array.isArray(rawWords) || !rawWords.length) return [];

  // Detect timeline: if the first word's time is near/past clipStart, it's absolute
  const firstT = Number(rawWords[0].start ?? rawWords[0].t ?? 0);
  const isAbsolute = firstT >= clipStart - 0.5 && clipStart > 1;

  const words = rawWords.map((w, i) => {
    const absStart = Number(w.start ?? w.t ?? 0);
    let absEnd = Number(w.end ?? NaN);
    if (!Number.isFinite(absEnd) || absEnd <= absStart) {
      const next = rawWords[i + 1];
      const nextStart = next ? Number(next.start ?? next.t ?? NaN) : NaN;
      absEnd = Number.isFinite(nextStart) && nextStart > absStart
        ? Math.min(nextStart, absStart + 0.6)
        : absStart + 0.35;
    }

    const relStart = isAbsolute ? absStart - clipStart : absStart;
    const relEnd = isAbsolute ? absEnd - clipStart : absEnd;

    return {
      word: String(w.word || '').trim(),
      start: Math.max(0, relStart),
      end: Math.min(clipDuration, Math.max(relStart + 0.08, relEnd)),
    };
  }).filter(w => w.word.length > 0 && w.end > w.start && w.start < clipDuration);

  // Sort + dedupe (same word within 0.35s)
  words.sort((a, b) => a.start - b.start);
  const out = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && prev.word.toLowerCase() === w.word.toLowerCase() && Math.abs(prev.start - w.start) < 0.35) continue;
    out.push(w);
  }
  return out;
}

// ─────────────────────────────────────────────
//  Segmentation: words → caption cards
// ─────────────────────────────────────────────

/**
 * Segment clip-relative words into caption cards.
 * Breaks on: silence gaps, punctuation, max words/chars, reading speed.
 */
export function segmentIntoCards(words, clipDuration, options = {}) {
  if (!words || !words.length) return [];

  const maxWords = options.maxWords || 4;
  const maxChars = options.maxChars || 32;
  const styleConfig = options.styleConfig || {};

  const cues = [];
  let chunk = [];
  let chunkChars = 0;

  const flush = () => {
    if (!chunk.length) return;

    let start = chunk[0].start;
    let end = chunk[chunk.length - 1].end + 0.08; // small trailing buffer

    // Enforce min/max duration
    if (end - start < MIN_CUE_DURATION) end = start + MIN_CUE_DURATION;
    if (end - start > MAX_CUE_DURATION) end = start + MAX_CUE_DURATION;

    const { plainText, styledWords } = buildCueText(chunk, styleConfig, cues.length);
    const text = chunk.map(w => w.word).join(' ').trim();

    // Reading-speed extension
    const dur = end - start;
    if (dur > 0 && plainText.length / dur > MAX_CPS) {
      end = start + plainText.length / MAX_CPS;
    }

    const safe = sanitizeCueTiming(start, end, clipDuration);
    const maxWidthPx = computeMaxWidthPx(styleConfig);
    const lines = splitIntoNaturalLines(plainText || text, styleConfig, maxWidthPx);

    cues.push({
      start: safe.start,
      end: safe.end,
      text,
      displayText: lines.join('\n'),
      words: [...chunk],
      styledWords,
      lines,
      emphasis: styledWords.some(w => w.style.emphasis !== 'default') ? 'rich' : 'basic',
      emotion: detectEmotionHint(text),
      styleHint: styleConfig.id || 'gaming',
    });

    chunk = [];
    chunkChars = 0;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const text = w.word.trim();
    if (!text) continue;

    // Break on silence
    if (chunk.length > 0) {
      const gap = w.start - chunk[chunk.length - 1].end;
      if (gap >= SILENCE_BREAK_SEC) flush();
    }

    // Break on size limits
    if (chunk.length > 0 && (chunk.length >= maxWords || chunkChars + text.length + 1 > maxChars)) {
      flush();
    }

    // Break on reading speed (projected)
    if (chunk.length > 1) {
      const span = w.end - chunk[0].start;
      const effDur = Math.max(span + 0.1, MIN_CUE_DURATION);
      if (effDur > 0 && (chunkChars + text.length + 1) / effDur > MAX_CPS) flush();
    }

    chunk.push(w);
    chunkChars += text.length + 1;

    // Break on sentence-ending punctuation
    if (/[.!?]$/.test(text)) flush();
  }
  flush();

  // ── Overlap resolution ──
  for (let i = 0; i < cues.length - 1; i++) {
    const cur = cues[i], nxt = cues[i + 1];
    if (cur.end >= nxt.start) {
      let newEnd = Math.min(nxt.start - 0.04, clipDuration);
      if (newEnd < cur.start + MIN_CUE_DURATION) newEnd = Math.min(cur.start + MIN_CUE_DURATION, clipDuration);
      cur.end = Math.round(newEnd * 1000) / 1000;
      nxt.start = Math.min(Math.max(cur.end + 0.04, nxt.start), Math.max(0, clipDuration - MIN_CUE_DURATION));
      nxt.start = Math.round(nxt.start * 1000) / 1000;
    }
  }

  // Final clamp
  for (const cue of cues) {
    const safe = sanitizeCueTiming(cue.start, cue.end, clipDuration);
    cue.start = safe.start;
    cue.end = safe.end;
  }

  // Merge pathological overlaps (deck infeasible)
  let guard = 0;
  const hasOverlap = () => cues.some((c, i) => i < cues.length - 1 && c.end > cues[i + 1].start + 0.001);
  while (hasOverlap() && cues.length > 1 && guard < cues.length * 8) {
    guard++;
    const idx = cues.findIndex((c, i) => i < cues.length - 1 && c.end > cues[i + 1].start + 0.001);
    if (idx === -1) break;
    const keep = cues[idx], drop = cues[idx + 1];
    keep.end = Math.max(keep.end, drop.end);
    keep.text = `${keep.text} ${drop.text}`.replace(/\s+/g, ' ').trim();
    keep.displayText = `${keep.displayText || keep.text} ${drop.displayText || drop.text}`.replace(/\s+/g, ' ').trim();
    keep.words = [...(keep.words || []), ...(drop.words || [])];
    keep.styledWords = [...(keep.styledWords || []), ...(drop.styledWords || [])];
    keep.emphasis = keep.styledWords.some(w => w.style.emphasis !== 'default') ? 'rich' : 'basic';
    cues.splice(idx + 1, 1);
    const safe = sanitizeCueTiming(keep.start, keep.end, clipDuration);
    keep.start = safe.start; keep.end = safe.end;
  }

  return cues;
}

// ─────────────────────────────────────────────
//  Heuristic fallback (no word timestamps)
// ─────────────────────────────────────────────

export function buildCuesFromTranscript(transcript, clipDuration, options = {}) {
  if (!transcript || !transcript.trim()) return [];
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const phrases = [];
  let cur = [], curLen = 0;
  for (const word of words) {
    if (cur.length > 0 && (curLen + word.length + 1 > 40 || /^[.!?]$/.test(word))) {
      phrases.push(cur.join(' ')); cur = []; curLen = 0;
    }
    cur.push(word); curLen += word.length + 1;
    if (/[.!?]$/.test(word)) { phrases.push(cur.join(' ')); cur = []; curLen = 0; }
  }
  if (cur.length) phrases.push(cur.join(' '));

  const speechDur = Math.min(words.length / 2.5, clipDuration * 0.9);
  const speechStart = (clipDuration - speechDur) * 0.1;
  const secPerWord = speechDur / words.length;

  const cues = [];
  let wi = 0;
  for (const text of phrases) {
    const n = text.split(' ').length;
    const start = speechStart + wi * secPerWord;
    const end = Math.min(speechStart + (wi + n) * secPerWord - 0.05, clipDuration - 0.02);
    if (end > start && text.trim()) {
      const safe = sanitizeCueTiming(start, end, clipDuration);
      cues.push({ start: safe.start, end: safe.end, text: text.trim() });
    }
    wi += n;
  }
  return cues;
}

// ─────────────────────────────────────────────
//  ASS rendering
// ─────────────────────────────────────────────

function getCueMarginV(cue, styleConfig) {
  const base = Number(styleConfig.safeArea?.marginV || styleConfig.marginV || 150);
  const len = String(cue.displayText || cue.text || '').length;
  const lines = Array.isArray(cue.lines) ? cue.lines.length : 1;
  const emotional = ['scream', 'surprise', 'excitement', 'anger'].includes(String(cue.emotion || '').toLowerCase());
  let mv = base;
  if (len > 24) mv -= 10;
  if (lines > 1) mv -= 8;
  if (emotional) mv -= 12;
  return Math.max(90, Math.min(180, Math.round(mv)));
}

function buildStyledAssBody(styledWords, styleConfig, primaryASS, maxWidthPx) {
  if (!Array.isArray(styledWords) || !styledWords.length) return '';

  const fontFamily = styleConfig.fontFamily || styleConfig.font || 'Montserrat ExtraBold';
  const fontSize = styleConfig.size || 26;
  const bold = styleConfig.bold === '1' || styleConfig.fontWeight === 'bold' || Number(styleConfig.fontWeight) >= 700;

  const wordTexts = styledWords.map(w => String(w.text || '').trim()).filter(Boolean);
  const lineTexts = wrapWordsToLines(wordTexts, { fontFamily, fontSize, bold }, maxWidthPx, 2);

  const lines = [];
  let cursor = 0;
  for (const lt of lineTexts) {
    const count = lt.split(' ').filter(Boolean).length;
    lines.push(styledWords.slice(cursor, cursor + count));
    cursor += count;
  }

  const renderWord = (w) => {
    const t = String(w.text || '').trim();
    if (!t) return '';
    const style = w.style || {};
    const assColor = hexToASS(style.color);
    const boldTag = style.weight === 'bold' ? '{\\b1}' : '';
    const base = `{\\c${assColor}}${boldTag}${t}{\\c${primaryASS}}{\\b0}`;
    if (style.emphasis === 'danger') {
      return `{\\t(0,40,\\fscx120\\fscy120)}{\\t(40,120,\\fscx100\\fscy100)}${base}`;
    }
    return base;
  };

  return lines.map(lw => lw.map(renderWord).filter(Boolean).join(' ')).join('\\N');
}

export function cuesToASS(cues, styleConfig) {
  if (!cues || !cues.length) return null;

  const font = styleConfig.fontFamily || styleConfig.font || 'Montserrat ExtraBold';
  const size = styleConfig.size || 26;
  const primary = styleConfig.primary || '&H00FFFFFF';
  const outline = styleConfig.outline || '&H00000000';
  const back = styleConfig.back || styleConfig.backColour || '&H00000000';
  const marginV = styleConfig.safeArea?.marginV || 150;
  const outlineW = styleConfig.outlineWidth || 4;
  const shadowW = styleConfig.shadowWidth || 2;
  const animation = styleConfig.animation || 'pop';
  const lineSpacing = styleConfig.lineSpacing || 8;
  const primaryASS = hexToASS(styleConfig.primary || '#FFFFFF');

  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},${size},${primary},&H0000FFFF,${outline},${back},-1,0,0,0,100,100,${lineSpacing},0,1,${outlineW},${shadowW},2,30,30,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (const cue of cues) {
    const startAss = formatAssTime(cue.start);
    const endAss = formatAssTime(cue.end);
    const cueMarginV = getCueMarginV(cue, styleConfig);

    let bodyText;
    if (Array.isArray(cue.styledWords) && cue.styledWords.length) {
      bodyText = buildStyledAssBody(cue.styledWords, styleConfig, primaryASS, computeMaxWidthPx(styleConfig));
    } else {
      bodyText = String(cue.displayText || cue.text || '').replace(/\n/g, '\\N').replace(/[{}]/g, '');
    }
    if (!bodyText) bodyText = cue.text || '';

    if (animation === 'bounce' || animation === 'scale-up') {
      bodyText = `{\\t(0,120,\\fscx105\\fscy105)}{\\fscx95\\fscy95}${bodyText}`;
    } else if (animation === 'elastic') {
      bodyText = `{\\t(0,120,\\fscx110\\fscy110)}{\\fscx90\\fscy90}${bodyText}`;
    } else if (animation === 'fade') {
      bodyText = `{\\fad(80,80)}${bodyText}`;
    }

    const emo = String(cue.emotion || '').toLowerCase();
    const punch = ['scream', 'surprise', 'excitement', 'anger'].includes(emo) ? '{\\fscx110\\fscy110}' : '';
    ass += `Dialogue: 0,${startAss},${endAss},Default,,0,0,${cueMarginV},,${punch}${bodyText}\n`;
  }

  return ass;
}

export function cuesToSRT(cues) {
  if (!cues || !cues.length) return null;
  return cues.map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}`).join('\n\n');
}

// ─────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────

/**
 * Build caption cues for a clip.
 * clip: { start, end, words?, transcript? }
 * Words may be absolute or clip-relative; they are normalized internally.
 */
export function buildClipCues(clip, options = {}) {
  const duration = clip.end - clip.start;
  const styleConfig = options.styleConfig || {};

  if (clip.words && clip.words.length > 2) {
    const relWords = normalizeWordsToClip(clip.words, clip.start, duration);
    const cues = segmentIntoCards(relWords, duration, { maxWords: 4, maxChars: 40, styleConfig });
    if (cues.length) return cues;
  }

  const heuristic = buildCuesFromTranscript(clip.transcript || '', duration, options);
  if (heuristic.length) return heuristic;

  return [];
}

/**
 * Async version kept for API compatibility with processor.js.
 * Now purely local (no external STT calls — transcription happens once
 * up-front via transcription.js and words are attached to the clip).
 */
export async function buildClipCuesWithSTT(clip, videoPath, language = 'auto', logFn = console.log) {
  const cues = buildClipCues(clip, { styleConfig: {} });
  if (cues.length) {
    logFn(`[caption] Clip ${(clip.index ?? 0) + 1}: ${cues.length} cues`);
  } else {
    logFn(`[caption] Clip ${(clip.index ?? 0) + 1}: no speech — skipping captions`);
  }
  return cues;
}

export function getCaptionStyleConfig(style, options = {}, language = 'en') {
  return buildStyleConfig(style, options, language);
}

export function shiftToClipTimeline(cards, clipStart, clipEnd) {
  if (!cards || !cards.length) return [];
  const duration = clipEnd - clipStart;
  return cards
    .filter(c => c.end > clipStart && c.start < clipEnd)
    .map(c => {
      let rs = Math.max(0, c.start - clipStart);
      let re = Math.min(duration, c.end - clipStart);
      if (re - rs < MIN_CUE_DURATION && rs + MIN_CUE_DURATION <= duration) re = rs + MIN_CUE_DURATION;
      return { ...c, start: Math.round(rs * 1000) / 1000, end: Math.round(re * 1000) / 1000 };
    })
    .filter(c => c.end > c.start);
}

/** FFmpeg subtitles filter with Windows-safe path escaping. */
export function buildSubtitleFilter(assPath) {
  const escaped = String(assPath).replace(/\\/g, '/').replace(/^([A-Za-z]):\//, '$1\\:/');
  return `subtitles='${escaped}'`;
}

export function buildSubtitleFilterSafe(assPath) {
  try {
    const f = buildSubtitleFilter(assPath);
    if (/\\\\:/.test(f)) return null;
    return f;
  } catch {
    return null;
  }
}

export { CAPTION_STYLE_IDS } from './captionStyles.js';
