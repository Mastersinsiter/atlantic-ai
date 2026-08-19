import { cuesToASS, getCaptionStyleConfig } from './captionEngine.js';

export function generateASS(subtitles, style, options = {}, language = 'en') {
  if (!subtitles || !subtitles.length) return '';
  const styleConfig = typeof style === 'object' && style.id ? style : getCaptionStyleConfig(style, options, language);
  return cuesToASS(subtitles, styleConfig) || '';
}



