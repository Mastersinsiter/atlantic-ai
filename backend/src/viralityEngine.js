// NOTE: getSignalBoostForWindow was previously imported from './mediaAnalysis.js'
// but that export does not exist there. The real signal-boost scoring is part
// of Module A (not yet landed), so for now we decouple: viralityEngine.js is
// import-safe and computes scores with boost=0 until Module A wires this in.
// When Module A lands, replace this local stub with the real import:
//   import { getSignalBoostForWindow } from './mediaAnalysis.js';
const getSignalBoostForWindow = () => 0;

import { textInWindow } from './transcriptSchema.js';

const HUMOR_RE = /lol|lmao|funny|hilarious|joke|हँस|मजाक|हा हा/i;
const RAGE_RE = /rage|angry|wtf|mad|गुस्सा|पागल/i;
const CLUTCH_RE = /clutch|1v|ace|clutch|किल/i;

export function computeViralityV3(seg, ctx = {}) {
  const boost = getSignalBoostForWindow(seg.start, seg.end, ctx);
  const reactionScore = Math.min(100, Math.round(
    (seg.faceReactionScore || 0) * 0.6 + boost * 1.2 + (ctx.audioPeaks?.filter(p =>
      p.start >= seg.start - 2 && p.start <= seg.end && p.type === 'scream'
    ).length || 0) * 8
  ));
  const base = seg.score || 70;
  const dur = seg.end - seg.start;
  const transcript = ctx.transcriptSegments
    ? textInWindow(ctx.transcriptSegments, seg.start, seg.end)
    : '';
  const text = `${seg.title || ''} ${seg.summary || ''} ${transcript}`;

  const hookScore = Math.min(100, Math.round(base * 0.32 + boost + (seg.hook?.length > 12 ? 14 : 0)));
  const emotionScore = Math.min(100, Math.round(base * 0.28 + boost * 0.85 + reactionScore * 0.15));
  const surpriseScore = Math.min(100, Math.round(boost * 1.05 + (/shock|unexpected|plot|twist|अचानक/i.test(text) ? 18 : 0)));
  const humorScore = Math.min(100, Math.round(35 + (HUMOR_RE.test(text) ? 40 : 0) + (seg.category === 'funny' ? 25 : 0)));
  const retentionScore = Math.min(100, Math.round(88 - Math.abs(dur - 45) * 0.45));
  const conflictScore = Math.min(100, Math.round(38 + (/vs|fight|debate|wrong|गलत/i.test(text) ? 32 : 0)));

  const finalScore = Math.round(
    hookScore * 0.22 +
    emotionScore * 0.18 +
    surpriseScore * 0.14 +
    humorScore * 0.12 +
    retentionScore * 0.14 +
    reactionScore * 0.12 +
    conflictScore * 0.08
  );

  return {
    hookScore,
    emotionScore,
    surpriseScore,
    humorScore,
    retentionScore,
    reactionScore,
    conflictScore,
    finalScore
  };
}

export function scoreCandidateWindows(windows, ctx) {
  return windows.map(w => {
    const v = computeViralityV3(w, ctx);
    return { ...w, ...v, score: v.finalScore, viralityAnalysis: v };
  }).sort((a, b) => b.finalScore - a.finalScore);
}

export function gamingBoost(seg, ctx) {
  if (ctx.contentType !== 'gaming') return 0;
  const transcript = ctx.transcriptSegments
    ? textInWindow(ctx.transcriptSegments, seg.start, seg.end)
    : '';
  const text = `${seg.title} ${seg.summary} ${transcript}`.toLowerCase();
  let b = 0;
  if (/kill|ace|clutch|1v\d|headshot|no scope/i.test(text)) b += 18;
  if (/win|victory|gg|champion/i.test(text)) b += 14;
  if (/fail|rage|death|lost|noob/i.test(text)) b += 10;
  if (/scream|insane|crazy|wtf|omg|bhai|op/i.test(text)) b += 8;
  for (const p of ctx.audioPeaks || []) {
    if (p.start >= seg.start - 2 && p.start <= seg.end) b += p.type === 'scream' ? 10 : 5;
  }
  return Math.min(30, b);
}


