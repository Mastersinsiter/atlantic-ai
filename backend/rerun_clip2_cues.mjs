// Rerun clip2's cue generation with the EXACT persisted inputs from full_status.json.
process.env.CAPTION_DEBUG = '1';

import fs from 'fs';
import { buildClipCuesWithSTT } from './src/captionEngine.js';

const raw = fs.readFileSync('full_status.json', 'utf-8').replace(/^﻿/, '');
const s = JSON.parse(raw);

const clip2 = s.clips[1];
const videoPath = s.filePath;
if (!fs.existsSync(videoPath)) {
  // filePath may be absolute from the original run; try local uploads dir
  const alt = 'uploads/' + videoPath.split(/[\\/]/).pop();
  console.log('filePath missing, trying', alt);
  if (!fs.existsSync(alt)) { console.error('NO VIDEO'); process.exit(1); }
}

console.log(`clip2: start=${clip2.start} end=${clip2.end} words=${clip2.words.length} word[0]=${JSON.stringify(clip2.words[0])}`);

const cues = await buildClipCuesWithSTT(
  { index: clip2.index, start: clip2.start, end: clip2.end, words: clip2.words, transcript: clip2.transcript },
  fs.existsSync(videoPath) ? videoPath : 'uploads/' + videoPath.split(/[\\/]/).pop(),
  'auto',
  m => console.log('[log]', m)
);

console.log(`RESULT: ${cues.length} cues`);
console.log(`cue[0]: start=${cues[0]?.start} end=${cues[0]?.end} text=${JSON.stringify(cues[0]?.text)}`);
console.log(`MATCHES persisted (51.22/51.83)? ${cues[0]?.start === 51.22 && cues[0]?.end === 51.83}`);
