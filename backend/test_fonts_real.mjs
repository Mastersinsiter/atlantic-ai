// Test: exercise the REAL escapeFontsDir + escapeFFmpegPath from videoLayout.js
// against the REAL CAPTION_FONTS_DIR path. Print the exact string that gets
// passed to ffmpeg's :fontsdir= option.
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Exact copies from videoLayout.js lines 16, 24-29, 44-58 ──
const CAPTION_FONTS_DIR = path.resolve(__dirname, 'src', '..', 'fonts');

function escapeFontsDir(p) {
  return path.resolve(p)
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):\//, '$1\\:/')
    .replace(/'/g, '');
}

function escapeFFmpegPath(p) {
  let safePath = p;
  try {
    if (path.isAbsolute(p)) {
      safePath = path.relative(process.cwd(), p);
    }
  } catch (e) {}
  return safePath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):\//, '$1\\:/')
    .replace(/'/g, '');
}

// ── Run them ──
console.log('=== RAW CAPTION_FONTS_DIR ===');
console.log(CAPTION_FONTS_DIR);
console.log();

console.log('=== escapeFontsDir(CAPTION_FONTS_DIR) ===');
const fontsDirEscaped = escapeFontsDir(CAPTION_FONTS_DIR);
console.log(fontsDirEscaped);
console.log();

console.log('=== Exact :fontsdir= value passed to ffmpeg ===');
const fontsDirOpt = `:fontsdir='${fontsDirEscaped}'`;
console.log(fontsDirOpt);
console.log();

console.log('=== escapeFFmpegPath(CAPTION_FONTS_DIR) for comparison ===');
console.log(escapeFFmpegPath(CAPTION_FONTS_DIR));
console.log('  (CWD =', process.cwd(), ')');
console.log();

console.log('=== Fonts actually in that directory ===');
try {
  const files = fs.readdirSync(CAPTION_FONTS_DIR);
  files.forEach(f => console.log('  ', f));
} catch (e) {
  console.log('  ERROR:', e.message);
}
