// Capture PRE-LOOP gaps for both clips using persisted inputs.
process.env.CAPTION_DEBUG = '1';
import fs from 'fs';
import { buildClipCuesWithSTT } from './src/captionEngine.js';

const raw = fs.readFileSync('full_status.json', 'utf-8').replace(/^﻿/, '');
const s = JSON.parse(raw);
const videoPath = fs.existsSync(s.filePath) ? s.filePath : 'uploads/' + s.filePath.split(/[\\/]/).pop();

for (const idx of [0, 1]) {
  const clip = s.clips[idx];
  const clipDur = clip.end - clip.start;
  console.log(`\n===== clip${idx} (start=${clip.start} end=${clip.end} words=${clip.words.length} clipDur=${clipDur}) =====`);
  const cues = await buildClipCuesWithSTT(
    { index: clip.index, start: clip.start, end: clip.end, words: clip.words, transcript: clip.transcript },
    videoPath, 'auto', () => {}
  );

  // POST-LOOP verification on the returned cues.
  let overlaps = 0, pastEnd = 0, negStart = 0, shortDur = 0, badOrder = 0;
  const overlapPairs = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.start < -0.001) negStart++;
    if (c.end > clipDur + 0.001) pastEnd++;
    if (c.end - c.start < 0.55 - 0.001) shortDur++;
    if (c.end <= c.start) badOrder++;
    if (i < cues.length - 1 && c.end > cues[i + 1].start + 0.001) {
      overlaps++;
      if (overlapPairs.length < 10) overlapPairs.push(`[${i}] end=${c.end.toFixed(3)} > [${i + 1}].start=${cues[i + 1].start.toFixed(3)}`);
    }
  }
  console.log(`[postloop-check] cues=${cues.length} | overlaps=${overlaps} | pastClipEnd=${pastEnd} | negStart=${negStart} | dur<550ms=${shortDur} | end<=start=${badOrder}`);
  if (overlapPairs.length) console.log(`[postloop-check] overlap pairs: ${overlapPairs.join(' | ')}`);
  console.log(`[postloop-check] last cue: start=${cues[cues.length-1].start.toFixed(3)} end=${cues[cues.length-1].end.toFixed(3)} (clipDur=${clipDur})`);
}
