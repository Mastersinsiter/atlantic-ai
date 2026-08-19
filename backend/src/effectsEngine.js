/** Auto effects for stream highlights — punch zoom, shake, impact */

const EFFECT_BY_CATEGORY = {
  clutch: 'punch',
  win: 'impact',
  rage: 'shake',
  funny: 'punch',
  reaction: 'faceZoom'
};

export function pickEffectType(virality = {}, category = '') {
  if (category && EFFECT_BY_CATEGORY[category]) return EFFECT_BY_CATEGORY[category];
  const r = virality.reactionScore || 0;
  const s = virality.surpriseScore || 0;
  const e = virality.emotionScore || 0;
  if (r >= 82) return 'faceZoom';
  if (s >= 80) return 'impact';
  if (e >= 85) return 'punch';
  if (r >= 70) return 'motion';
  return null;
}

export function shouldApplyEffects(virality = {}, options = {}, category = '') {
  if (options.autoEffects === false) return false;
  const r = virality.reactionScore || 0;
  const e = virality.emotionScore || 0;
  const s = virality.surpriseScore || 0;
  if (pickEffectType(virality, category)) return true;
  return r >= 65 || e >= 72 || s >= 70;
}

/** Punch-in zoom for first ~0.8s (works on composed 9:16) */
function punchZoomFilter() {
  return `zoompan=z='if(lte(on,24),1+0.08*(on/24),1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,scale=1080:1920,setsar=1`;
}

function impactZoomFilter() {
  return `zoompan=z='if(lte(on,18),1.12-0.12*(on/18),1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,scale=1080:1920,setsar=1`;
}

function subtleShakeFilter() {
  return `crop=iw-2:ih-2:1+mod(n\\,4):1+mod(n+2\\,4),scale=1080:1920,setsar=1`;
}

function faceZoomFilter() {
  return `zoompan=z='min(zoom+0.002,1.1)':x='iw/2-(iw/zoom/2)':y='ih/3-(ih/zoom/3)':d=1:s=1080x1920:fps=30,scale=1080:1920,setsar=1`;
}

function motionEmphasisFilter() {
  return `scale=iw*1.04:ih*1.04,crop=1080:1920:(iw-1080)/2:(ih-1920)/2,setsar=1`;
}

export function buildEffectsFilter(virality = {}, duration = 60, category = '', options = {}) {
  if (!shouldApplyEffects(virality, options, category)) return null;
  const type = pickEffectType(virality, category);
  switch (type) {
    case 'punch': return punchZoomFilter();
    case 'impact': return impactZoomFilter();
    case 'shake': return subtleShakeFilter();
    case 'faceZoom': return faceZoomFilter();
    case 'motion': return motionEmphasisFilter();
    default: return motionEmphasisFilter();
  }
}

/** Append effects after layout in filter_complex: [v] in → [vout] out */
export function chainEffectsInComplex(layoutFilter, virality, category, options = {}) {
  const fx = buildEffectsFilter(virality, 60, category, options);
  if (!fx) return layoutFilter;
  if (!layoutFilter.includes('[v]')) return layoutFilter;
  return layoutFilter.replace('[v]', `[vfx];[vfx]${fx}[v]`);
}

export function combineVideoFilters(...parts) {
  return parts.filter(Boolean).join(',');
}


