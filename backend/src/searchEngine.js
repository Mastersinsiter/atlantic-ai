import { chunkTranscriptForSearch } from './transcriptSchema.js';

const QUERY_PATTERNS = {
  funny: /funny|hilarious|lol|joke|हँस|मजाक/i,
  rage: /rage|angry|mad|wtf|गुस्सा/i,
  clutch: /clutch|ace|1v|kill|किल/i,
  money: /money|paisa|rupee|salary|earn|पैसा|कमाई/i,
  sponsor: /sponsor|promo|code|discount|brand deal/i,
  reaction: /react|omg|wow|shock|अरे/i,
  win: /win|victory|जीत/i
};

function tokenize(s) {
  return String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 1);
}

function scoreOverlap(queryTokens, text) {
  const docTokens = new Set(tokenize(text));
  let hit = 0;
  for (const t of queryTokens) if (docTokens.has(t)) hit++;
  return queryTokens.length ? hit / queryTokens.length : 0;
}

export function buildSearchIndex(jobId, segments) {
  const chunks = chunkTranscriptForSearch(segments, 10);
  return {
    jobId,
    builtAt: new Date().toISOString(),
    chunks: chunks.map((c, i) => ({
      id: i,
      start: c.start,
      end: c.end,
      text: c.text,
      tokens: tokenize(c.text)
    }))
  };
}

export function searchMoments(index, query, limit = 12) {
  if (!index?.chunks?.length) return [];
  const q = String(query || '').trim();
  if (!q) return [];

  let patternBoost = null;
  for (const [key, re] of Object.entries(QUERY_PATTERNS)) {
    if (re.test(q) || q.toLowerCase().includes(key)) {
      patternBoost = key;
      break;
    }
  }

  const queryTokens = tokenize(q);
  const results = index.chunks.map(chunk => {
    let score = scoreOverlap(queryTokens, chunk.text) * 100;
    if (patternBoost && QUERY_PATTERNS[patternBoost]?.test(chunk.text)) score += 35;
    return { ...chunk, score: Math.round(score) };
  }).filter(r => r.score > 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}


