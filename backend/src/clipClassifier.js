import { textInWindow } from './transcriptSchema.js';

const RULES = [
  { category: 'funny', re: /lol|lmao|funny|hilarious|हँस|मजाक|हा हा|rofl/i, weight: 1 },
  { category: 'rage', re: /rage|angry|wtf|mad|गुस्सा|पागल|scream/i, weight: 1 },
  { category: 'reaction', re: /react|omg|wow|no way|अरे|वाह|shocked/i, weight: 0.9 },
  { category: 'clutch', re: /clutch|1v\d|ace|last second|किल|बचा/i, weight: 1 },
  { category: 'win', re: /win|victory|champion|जीत|winner/i, weight: 0.9 },
  { category: 'educational', re: /learn|tip|how to|tutorial|सीख|टिप/i, weight: 0.8 },
  { category: 'most-viral', re: /.*/i, weight: 0.1 }
];

export const CLIP_CATEGORIES = [
  'funny', 'rage', 'reaction', 'clutch', 'win', 'educational', 'most-viral'
];

export function classifyClip(seg, transcriptSegments = [], virality = {}) {
  const text = `${seg.title || ''} ${seg.summary || ''} ${textInWindow(transcriptSegments, seg.start, seg.end)}`;
  let best = { category: 'reaction', score: 0 };

  for (const rule of RULES) {
    if (rule.category === 'most-viral') continue;
    if (rule.re.test(text)) {
      const s = rule.weight * 100 + (virality.finalScore || 0) * 0.1;
      if (s > best.score) best = { category: rule.category, score: s };
    }
  }

  if ((virality.finalScore || seg.score || 0) >= 85) {
    return { category: 'most-viral', ...virality };
  }
  return { category: best.category, categoryScore: best.score };
}

export function groupClipsByCategory(clips) {
  const groups = {};
  for (const c of CLIP_CATEGORIES) groups[c] = [];
  for (const clip of clips) {
    const cat = clip.category || 'reaction';
    if (groups[cat]) groups[cat].push(clip);
    else groups.reaction.push(clip);
  }
  return groups;
}


