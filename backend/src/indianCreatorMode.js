/** Indian creator optimizations — hooks, titles, caption hints */

const HOOKS_HI = [
  'ये देखो क्या हुआ...',
  'कोई ये expect नहीं कर रहा था...',
  'आगे देखो क्या होता है...',
  'इसने सब कुछ बदल दिया...',
  'Wait for the end...'
];

const HOOKS_HINGLISH = [
  'Nobody expected this...',
  'Bhai ye dekh...',
  'Watch till the end...',
  'This changed everything...',
  'Full video mein ye best part hai...'
];

export function optimizeHooksForIndia(hooks = [], mode = {}) {
  if (!mode.enabled) return hooks;
  const pool = ['hi', 'mr', 'gu', 'bn', 'ta', 'te', 'kn', 'ml', 'pa', 'ur', 'or', 'as'].includes(mode.language) ? HOOKS_HI : HOOKS_HINGLISH;
  const out = [...hooks];
  for (let i = 0; i < Math.min(5, pool.length); i++) {
    if (!out[i] || out.length < 5) out[i] = out[i] || pool[i];
  }
  return out.slice(0, 5);
}

export function optimizeTitle(title, mode = {}) {
  if (!mode.enabled || !title) return title;
  if (mode.language === 'hi' && !/[\u0900-\u097F]/.test(title)) {
    return `${title} | Shorts`;
  }
  return title;
}

export function captionOptionsForIndia(options = {}, mode = {}) {
  if (!mode.enabled) return options;
  return {
    ...options,
    fontScale: (options.fontScale || 1) * 1.05,
    wordsPerLine: options.wordsPerLine || 4,
    indicFont: undefined   // let pickFont() choose per-script; was: hindiFont: 'Nirmala UI'
  };
}


