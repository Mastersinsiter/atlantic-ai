import fs from 'fs';
import { buildClipCuesWithSTT } from './src/captionEngine.js';

const raw = fs.readFileSync('full_status.json', 'utf-8').replace(/^﻿/, '');
const s = JSON.parse(raw);
const videoPath = fs.existsSync(s.filePath) ? s.filePath : 'uploads/' + s.filePath.split(/[\\/]/).pop();

for (const idx of [0, 1]) {
  const clip = s.clips[idx];
  const cues = await buildClipCuesWithSTT(
    { index: clip.index, start: clip.start, end: clip.end, words: clip.words, transcript: clip.transcript },
    videoPath, 'auto', () => {}
  );
  const inWords = clip.words.length;
  const outWords = cues.reduce((n, c) => n + (c.words ? c.words.length : 0), 0);
  const outStyled = cues.reduce((n, c) => n + (c.styledWords ? c.styledWords.length : 0), 0);
  console.log(`\nclip${idx}: inputWords=${inWords} outputWords=${outWords} outputStyled=${outStyled} | dropped=${inWords - outWords}`);
  console.log(`  cues=${cues.length}`);
  cues.forEach((c, i) => console.log(`  cue[${i}] ${c.start.toFixed(2)}-${c.end.toFixed(2)} words=${c.words ? c.words.length : 0} styled=${c.styledWords ? c.styledWords.length : 0} emphasis=${c.emphasis}`));
}
