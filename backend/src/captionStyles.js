/**
 * Caption preset registry for premium short-form captions.
 *
 * These presets drive the ASS subtitle styling, safe-area logic,
 * and emphasis behaviour used during export.
 */

function pickFont(language, options = {}) {
  const lang = (language || '').toLowerCase().split('-')[0];
  const scriptFont = {
    hi: 'Noto Sans Devanagari',
    mr: 'Noto Sans Devanagari',
    gu: 'Noto Sans Gujarati',
    bn: 'Noto Sans Bengali',
    as: 'Noto Sans Bengali',
    ta: 'Noto Sans Tamil',
    te: 'Noto Sans Telugu',
    kn: 'Noto Sans Kannada',
    ml: 'Noto Sans Malayalam',
    pa: 'Noto Sans Gurmukhi',
    ur: 'Noto Naskh Arabic',
    or: 'Noto Sans Oriya',
  };
  const family = scriptFont[lang];
  if (family) return options.indicFont || family;
  // 'hinglish' and anything else: fall through to the Latin default
  return options.font || 'Montserrat';
}

function normalizeStyleKey(styleId = 'gaming') {
  return String(styleId || 'gaming').toLowerCase().replace(/\s+/g, '-');
}

function toHexColor(value, fallback = '#FFFFFF') {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return trimmed;
  return fallback;
}

export const CAPTION_STYLE_IDS = [
  'classic', 'tiktok', 'gaming', 'gaming-pro', 'streamer', 'meme', 'modern', 'cinematic', 'clean', 'minimal', 'karaoke', 'neon', 'viral'
];

export function buildStyleConfig(styleId, options = {}, language = 'en') {
  const font = pickFont(language, options);
  const scale = Number(options.fontScale || 1);
  const baseSize = Math.round((Number(options.fontSize || 24) || 24) * scale);
  const alignment = { bottom: '2', center: '5', top: '8' }[options.captionPosition || 'center'] || '5';

  const registry = {
    classic: {
      id: 'classic', fontFamily: font, fontWeight: 'normal', size: Math.max(18, baseSize),
      primaryColor: '#F8FAFC', outlineColor: '#0F172A', shadowColor: '#000000', backColor: '#00000000',
      bold: '0', outlineWidth: 3, shadowWidth: 2, alignment,
      padding: 8, lineSpacing: 8, animation: 'pop', safeArea: { marginV: 140, minY: 1360, anchor: 'bottom' },
      wordsPerLine: 4, emoji: false, wordPulse: false,
      emphasis: { default: '#F8FAFC', important: '#FACC15', funny: '#FB923C', danger: '#F87171', positive: '#4ADE80', question: '#60A5FA' }
    },
    tiktok: {
      id: 'tiktok', fontFamily: 'Bebas Neue', fontWeight: 'bold', size: Math.max(28, baseSize + 10),
      primaryColor: '#FDE68A', outlineColor: '#111827', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 6, shadowWidth: 5, alignment: '5',
      padding: 10, lineSpacing: 10, animation: 'pop', safeArea: { marginV: 155, minY: 1330, anchor: 'bottom' },
      wordsPerLine: 1, emoji: true, wordPulse: true, uppercase: true,
      emphasis: { default: '#FFFFFF', important: '#FACC15', funny: '#FB923C', danger: '#F87171', positive: '#4ADE80', question: '#60A5FA' }
    },
    gaming: {
      id: 'gaming', fontFamily: 'Anton', fontWeight: 'bold', size: Math.max(30, baseSize + 10),
      primaryColor: '#FDE68A', outlineColor: '#111827', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 6, shadowWidth: 4, alignment: '5',
      padding: 10, lineSpacing: 8, animation: 'bounce', safeArea: { marginV: 170, minY: 1320, anchor: 'bottom' },
      wordsPerLine: 1, emoji: true, wordPulse: true, uppercase: true,
      emphasis: { default: '#FFFFFF', important: '#FACC15', funny: '#FB923C', danger: '#EF4444', positive: '#4ADE80', question: '#60A5FA' }
    },
    'gaming-pro': {
      id: 'gaming-pro', fontFamily: 'Montserrat', fontWeight: '800', size: Math.max(32, baseSize + 12),
      primaryColor: '#FFFFFF', outlineColor: '#111827', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 7, shadowWidth: 4, alignment: '5',
      padding: 11, lineSpacing: 10, animation: 'elastic', safeArea: { marginV: 180, minY: 1300, anchor: 'bottom' },
      wordsPerLine: 1, emoji: true, wordPulse: true, uppercase: true,
      emphasis: { default: '#FFFFFF', important: '#FDE68A', funny: '#FB923C', danger: '#F87171', positive: '#4ADE80', question: '#60A5FA' }
    },
    streamer: {
      id: 'streamer', fontFamily: 'Poppins ExtraBold', fontWeight: '800', size: Math.max(29, baseSize + 8),
      primaryColor: '#E0F2FE', outlineColor: '#0F172A', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 5, shadowWidth: 3, alignment: '5',
      padding: 10, lineSpacing: 9, animation: 'scale-up', safeArea: { marginV: 165, minY: 1325, anchor: 'bottom' },
      wordsPerLine: 1, emoji: true, wordPulse: true, uppercase: false,
      emphasis: { default: '#E0F2FE', important: '#FACC15', funny: '#FB923C', danger: '#F87171', positive: '#A7F3D0', question: '#93C5FD' }
    },
    meme: {
      id: 'meme', fontFamily: 'Bebas Neue', fontWeight: 'bold', size: Math.max(36, baseSize + 16),
      primaryColor: '#FFFFFF', outlineColor: '#111827', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 8, shadowWidth: 6, alignment: '5',
      padding: 12, lineSpacing: 9, animation: 'pop', safeArea: { marginV: 190, minY: 1280, anchor: 'bottom' },
      wordsPerLine: 1, emoji: true, wordPulse: true, uppercase: true,
      emphasis: { default: '#FFFFFF', important: '#FDE68A', funny: '#FB923C', danger: '#F87171', positive: '#4ADE80', question: '#60A5FA' }
    },
    modern: {
      id: 'modern', fontFamily: 'Montserrat', fontWeight: '700', size: Math.max(26, baseSize + 6),
      primaryColor: '#F8FAFC', outlineColor: '#1E293B', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 5, shadowWidth: 3, alignment: '5',
      padding: 9, lineSpacing: 8, animation: 'scale-up', safeArea: { marginV: 150, minY: 1360, anchor: 'bottom' },
      wordsPerLine: 1, emoji: false, wordPulse: true, uppercase: false,
      emphasis: { default: '#F8FAFC', important: '#FACC15', funny: '#FB923C', danger: '#F87171', positive: '#4ADE80', question: '#60A5FA' }
    },
    cinematic: {
      id: 'cinematic', fontFamily: 'Montserrat', fontWeight: '800', size: Math.max(31, baseSize + 10),
      primaryColor: '#FDE68A', outlineColor: '#1F2937', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 6, shadowWidth: 4, alignment: '5',
      padding: 10, lineSpacing: 10, animation: 'elastic', safeArea: { marginV: 175, minY: 1310, anchor: 'bottom' },
      wordsPerLine: 1, emoji: true, wordPulse: true, uppercase: false,
      emphasis: { default: '#FDE68A', important: '#FACC15', funny: '#FB923C', danger: '#EF4444', positive: '#4ADE80', question: '#60A5FA' }
    },
    clean: {
      id: 'clean', fontFamily: 'Poppins ExtraBold', fontWeight: '700', size: Math.max(24, baseSize + 4),
      primaryColor: '#FFFFFF', outlineColor: '#000000', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 4, shadowWidth: 2, alignment: '5',
      padding: 8, lineSpacing: 7, animation: 'fade', safeArea: { marginV: 145, minY: 1370, anchor: 'bottom' },
      wordsPerLine: 2, emoji: false, wordPulse: false, uppercase: false,
      emphasis: { default: '#FFFFFF', important: '#FACC15', funny: '#FB923C', danger: '#F87171', positive: '#4ADE80', question: '#60A5FA' }
    },
    minimal: {
      id: 'minimal', fontFamily: 'Montserrat', fontWeight: '600', size: Math.max(22, baseSize + 2),
      primaryColor: '#F8FAFC', outlineColor: '#111827', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 4, shadowWidth: 2, alignment: '5',
      padding: 7, lineSpacing: 6, animation: 'fade', safeArea: { marginV: 140, minY: 1380, anchor: 'bottom' },
      wordsPerLine: 2, emoji: false, wordPulse: false, uppercase: false,
      emphasis: { default: '#F8FAFC', important: '#FDE68A', funny: '#FB923C', danger: '#F87171', positive: '#4ADE80', question: '#60A5FA' }
    },
    karaoke: {
      id: 'karaoke', fontFamily: font, fontWeight: 'bold', size: Math.max(28, baseSize + 8),
      primaryColor: '#FFFFFF', outlineColor: '#111827', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 5, shadowWidth: 3, alignment: '5',
      padding: 9, lineSpacing: 9, animation: 'scale-up', safeArea: { marginV: 160, minY: 1340, anchor: 'bottom' },
      wordsPerLine: 1, emoji: true, wordPulse: true, uppercase: false, karaoke: true,
      emphasis: { default: '#FFFFFF', important: '#FACC15', funny: '#FB923C', danger: '#F87171', positive: '#4ADE80', question: '#60A5FA' }
    },
    neon: {
      id: 'neon', fontFamily: 'Montserrat', fontWeight: '800', size: Math.max(29, baseSize + 8),
      primaryColor: '#F0ABFC', outlineColor: '#020617', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 6, shadowWidth: 3, alignment: '5',
      padding: 9, lineSpacing: 9, animation: 'elastic', safeArea: { marginV: 160, minY: 1340, anchor: 'bottom' },
      wordsPerLine: 1, emoji: false, wordPulse: true, uppercase: true,
      emphasis: { default: '#F0ABFC', important: '#FDE68A', funny: '#F472B6', danger: '#FB7185', positive: '#4ADE80', question: '#60A5FA' }
    },
    viral: {
      id: 'viral', fontFamily: 'Bebas Neue', fontWeight: 'bold', size: Math.max(34, baseSize + 14),
      primaryColor: '#FFFFFF', outlineColor: '#111827', shadowColor: '#000000', backColor: '#00000000',
      bold: '1', outlineWidth: 7, shadowWidth: 5, alignment: '5',
      padding: 11, lineSpacing: 9, animation: 'bounce', safeArea: { marginV: 180, minY: 1310, anchor: 'bottom' },
      wordsPerLine: 1, emoji: true, wordPulse: true, uppercase: true,
      emphasis: { default: '#FFFFFF', important: '#FDE68A', funny: '#FB923C', danger: '#EF4444', positive: '#4ADE80', question: '#60A5FA' }
    }
  };

  const styleKey = normalizeStyleKey(styleId);
  const preset = registry[styleKey] || registry.gaming;
  const merged = {
    ...preset,
    font: preset.fontFamily,
    fontFamily: preset.fontFamily,
    fontWeight: preset.fontWeight,
    size: Math.max(18, Math.round((preset.size || baseSize) * scale)),
    primary: toHexColor(preset.primaryColor, '#FFFFFF'),
    outline: toHexColor(preset.outlineColor, '#000000'),
    shadow: toHexColor(preset.shadowColor, '#000000'),
    back: toHexColor(preset.backColor, '#00000000'),
    outlineWidth: preset.outlineWidth || 4,
    shadowWidth: preset.shadowWidth || 2,
    padding: preset.padding || 8,
    lineSpacing: preset.lineSpacing || 8,
    animation: preset.animation || 'pop',
    safeArea: preset.safeArea || { marginV: 140, minY: 1360, anchor: 'bottom' },
    emphasis: { ...preset.emphasis, ...options.emphasis },
    wordsPerLine: preset.wordsPerLine || 1,
    emoji: preset.emoji !== undefined ? preset.emoji : true,
    wordPulse: preset.wordPulse !== undefined ? preset.wordPulse : true,
    uppercase: preset.uppercase !== undefined ? preset.uppercase : false,
    alignment: options.captionPosition ? { bottom: '2', center: '5', top: '8' }[options.captionPosition] || '5' : (preset.alignment || alignment),
    marginV: preset.safeArea?.marginV || 140,
    borderStyle: 1,
    backColour: preset.backColor || '#00000000',
    bold: preset.bold || '1',
  };

  return merged;
}

export function styleToFfmpegForceStyle(s) {
  const fontFamily = s.fontFamily || s.font || 'Montserrat';
  return `FontName=${fontFamily},FontSize=${s.size},PrimaryColour=${s.primary},OutlineColour=${s.outline},BackColour=${s.back},Bold=${s.bold},Outline=${s.outlineWidth || s.outlineW || 4},Shadow=${s.shadowWidth || s.shadow || 2},Alignment=${s.alignment || 5},MarginV=${s.marginV || 140}`;
}


