import { scoreSubtitles } from './src/subtitleQuality.js';

const res = await fetch('http://localhost:3000/api/status/103345aa-1093-477e-a274-b6faaa653423');
const job = await res.json();

console.log(`JOB status=${job.status} progress=${job.progress} clips=${job.clips.length}\n`);

// Quality-gate warnings from the log
console.log('=== QUALITY-GATE LOG LINES ===');
for (const l of job.logs) {
  if (/quality|Score|⚠️|overlap|Reading speed|too (short|long)/i.test(l.msg)) console.log(' ', l.msg);
}

console.log('\n=== PER-CLIP SCORED LIVE ===');
for (const c of job.clips) {
  const dur = c.end - c.start;
  const cues = c.cues || [];
  if (!cues.length) { console.log(`Clip ${c.index + 1} (${c.start}-${c.end}s): NO CUES`); continue; }
  const q = scoreSubtitles(cues, dur);
  // overlap check
  let overlaps = 0;
  for (let i = 0; i < cues.length - 1; i++) if (cues[i].end > cues[i + 1].start + 0.001) overlaps++;
  const pastEnd = cues.filter(x => x.end > dur + 0.001).length;
  console.log(`Clip ${c.index + 1} (${c.start}-${c.end}s, dur=${dur.toFixed(0)}s): cues=${cues.length} | SCORE=${q.score} | overlaps=${overlaps} | pastEnd=${pastEnd}`);
  if (q.issues.length) console.log(`    issues: ${q.issues.join(' | ')}`);
}
