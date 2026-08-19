/**
 * captionLayout.js
 *
 * Pixel-accurate line wrapping for caption text, replacing the character-count
 * heuristic in splitIntoNaturalLines / buildStyledAssBody's internal chunking.
 *
 * WHY: maxChars budgets (22/24) are tuned by eye against Latin ALL-CAPS text.
 * Two things silently break that assumption:
 *   1. Font SIZE varies a lot across presets (18px classic -> 40px+ meme) but
 *      the char budget doesn't scale with it — same 24-char cap for a 40px
 *      Bebas Neue word as for an 18px Montserrat word.
 *   2. Devanagari (and other Indic scripts, via the Nirmala UI branch in
 *      pickFont) don't share Latin's average glyph-width-per-character, so a
 *      budget tuned on English text wraps Hindi/Hinglish lines at the wrong
 *      point relative to the actual safe-area width.
 *
 * This measures real glyph widths via node-canvas and wraps against an
 * actual pixel budget derived from the ASS PlayResX safe area, so both
 * problems disappear at the root instead of needing per-script tuning.
 *
 * FONT FILES: you must point FONT_FILES at the *same* font files your
 * render box resolves "Montserrat ExtraBold" / "Nirmala UI" / etc to for
 * libass. If measurement uses a different font than what actually renders,
 * you've just moved the drift instead of fixing it.
 */

import { createCanvas, registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── EDIT THIS to point at your actual font files ──────────────────────────
// Keys must match the fontFamily strings used in captionStyles.js presets
// exactly (font/fontFamily field), including the Nirmala UI branch from
// pickFont(). This demo uses stand-in fonts (DejaVu Sans / Noto Sans
// Devanagari) so it runs without your real font assets — swap the paths.
const FONTS_DIR = process.env.CAPTION_FONTS_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '../fonts');
const FONT_FILES = {
  'Montserrat': 'Montserrat-ExtraBold.ttf',
  'Montserrat ExtraBold': 'Montserrat-ExtraBold.ttf',
  'Bebas Neue': 'BebasNeue-Regular.ttf',
  'Anton': 'Anton-Regular.ttf',
  'Poppins ExtraBold': 'Poppins-ExtraBold.ttf',
  'Noto Sans Devanagari': 'NotoSansDevanagari-Regular.ttf',
  'Noto Sans Gujarati': 'NotoSansGujarati-Regular.ttf',
  'Noto Sans Bengali': 'NotoSansBengali-Regular.ttf',
  'Noto Sans Tamil': 'NotoSansTamil-Regular.ttf',
  'Noto Sans Telugu': 'NotoSansTelugu-Regular.ttf',
  'Noto Sans Kannada': 'NotoSansKannada-Regular.ttf',
  'Noto Sans Malayalam': 'NotoSansMalayalam-Regular.ttf',
  'Noto Sans Gurmukhi': 'NotoSansGurmukhi-Regular.ttf',
  'Noto Naskh Arabic': 'NotoNaskhArabic-Regular.ttf',
  'Noto Sans Oriya': 'NotoSansOriya-Regular.ttf',
};

let registered = false;
let registeredFamilies = new Set();

function ensureFontsRegistered() {
  if (registered) return;
  registered = true;
  for (const [family, filename] of Object.entries(FONT_FILES)) {
    const fontPath = path.join(FONTS_DIR, filename);
    try {
      if (fs.existsSync(fontPath)) {
        registerFont(fontPath, { family });
        registeredFamilies.add(family);
      } else {
        console.warn(
          `[caption-layout] Font file missing for "${family}": ${fontPath}`
        );
      }
    } catch (err) {
      console.error(`[caption-layout] FATAL: registerFont failed for "${family}": ${err.message}`);
      throw new Error(`Font registration failed for "${family}": ${err.message}`);
    }
  }
}

// Reused across calls — creating a canvas per measurement is wasteful.
let measureCtx = null;
function getMeasureContext() {
  if (!measureCtx) measureCtx = createCanvas(8, 8).getContext('2d');
  return measureCtx;
}

// Rough average glyph-width-to-fontSize ratio — ONLY used if canvas or the
// specific font isn't available, so behavior degrades to "old heuristic",
// never to "captions break".
const FALLBACK_PX_PER_CHAR_RATIO = 0.58;

/**
 * Real pixel width of `text` rendered at `fontSize`px in `fontFamily`.
 * Throws if a configured font fails to register/load.
 */
export function measureTextWidthPx(text, fontFamily, fontSize, bold = true) {
  ensureFontsRegistered();
  if (FONT_FILES[fontFamily] && !registeredFamilies.has(fontFamily)) {
    throw new Error(`[caption-layout] Required font "${fontFamily}" is configured but failed to load/register.`);
  }
  const ctx = getMeasureContext();
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px "${fontFamily}"`;
  return ctx.measureText(String(text || '')).width;
}

function estimateWidthPx(text, fontSize) {
  return String(text || '').length * fontSize * FALLBACK_PX_PER_CHAR_RATIO;
}

function widthOf(text, fontFamily, fontSize, bold) {
  const measured = measureTextWidthPx(text, fontFamily, fontSize, bold);
  return measured != null ? measured : estimateWidthPx(text, fontSize);
}

/**
 * Greedy word-wrap a list of word tokens into lines that fit maxWidthPx.
 * Word order and content are never altered — only where line breaks land —
 * so callers that need to re-associate styled word objects (e.g.
 * buildStyledAssBody's per-word color tags) can safely re-slice their
 * original array using each returned line's word count.
 *
 * @param {string[]} words
 * @param {{fontFamily?: string, fontSize?: number, bold?: boolean}} fontConfig
 * @param {number} maxWidthPx  available width in px (safe-area width, not full canvas width)
 * @param {number} maxLines    default 2, matches the old splitIntoNaturalLines behavior
 * @returns {string[]} lines
 */
export function wrapWordsToLines(words, fontConfig = {}, maxWidthPx, maxLines = 2) {
  const cleanWords = (words || []).map(w => String(w || '').trim()).filter(Boolean);
  if (!cleanWords.length) return [''];

  const { fontFamily = 'Montserrat ExtraBold', fontSize = 26, bold = true } = fontConfig;
  const spaceWidth = widthOf(' ', fontFamily, fontSize, bold);

  const lines = [];
  let currentWords = [];
  let currentWidth = 0;

  for (const word of cleanWords) {
    const w = widthOf(word, fontFamily, fontSize, bold);
    const addWidth = currentWords.length ? spaceWidth + w : w;
    const wouldOverflow = currentWords.length && currentWidth + addWidth > maxWidthPx;

    if (wouldOverflow) {
      if (lines.length + 1 >= maxLines) {
        // Last allowed line — let it run long rather than silently dropping
        // words. Matches the old function's behavior of returning the full
        // string when it couldn't find a clean break.
        currentWords.push(word);
        currentWidth += addWidth;
        continue;
      }
      lines.push(currentWords.join(' '));
      currentWords = [word];
      currentWidth = w;
      continue;
    }

    currentWords.push(word);
    currentWidth += addWidth;
  }

  if (currentWords.length) lines.push(currentWords.join(' '));
  return lines.length ? lines : [''];
}

/**
 * Drop-in replacement for the old splitIntoNaturalLines(text, maxChars).
 * New signature takes styleConfig + a pixel budget instead of a char count.
 */
export function splitIntoNaturalLines(text, styleConfig = {}, maxWidthPx = 900) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return [cleaned];
  const words = cleaned.split(/\s+/).filter(Boolean);
  const bold = styleConfig.bold === '1' || styleConfig.fontWeight === 'bold' ||
    Number(styleConfig.fontWeight) >= 700;
  return wrapWordsToLines(
    words,
    {
      fontFamily: styleConfig.fontFamily || styleConfig.font || 'Montserrat ExtraBold',
      fontSize: styleConfig.size || 26,
      bold,
    },
    maxWidthPx,
    2
  );
}

// PlayResX from the ASS header in captionEngine.js, minus the Default
// style's MarginL/MarginR (30 each), times a small safety factor so text
// never touches the frame edge even with libass's own font hinting slop.
export const PLAY_RES_X = 1080;
export const DEFAULT_MARGIN_L = 30;
export const DEFAULT_MARGIN_R = 30;
export function computeMaxWidthPx(styleConfig = {}, safetyFactor = 0.94) {
  const marginL = styleConfig.marginL ?? DEFAULT_MARGIN_L;
  const marginR = styleConfig.marginR ?? DEFAULT_MARGIN_R;
  return (PLAY_RES_X - marginL - marginR) * safetyFactor;
}
