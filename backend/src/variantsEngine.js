import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const VARIANT_DURATIONS = [15, 30, 45, 60];

/** Trim composed highlight (keeps layout + captions + effects) */
export async function generateVariantsFromFinal(jobId, clipIndex, finalPath, outputDir) {
  const variants = [];
  for (const dur of VARIANT_DURATIONS) {
    const filename = `${jobId}_v${dur}_${clipIndex}.mp4`;
    const outPath = path.join(outputDir, filename);
    try {
      await execAsync(
        `ffmpeg -y -i "${finalPath}" -t ${dur} -c:v libx264 -c:a aac -b:a 128k -preset fast -crf 22 -avoid_negative_ts make_zero -async 1 -vsync cfr -movflags +faststart "${outPath}"`
      );
      variants.push({ duration: dur, filename, url: `/outputs/${filename}` });
    } catch { /* skip if shorter than dur */ }
  }
  return variants;
}

export function planVariantsFromSegment(seg) {
  const dur = seg.end - seg.start;
  return VARIANT_DURATIONS.filter(d => d <= dur + 2).map(d => ({ duration: d }));
}


