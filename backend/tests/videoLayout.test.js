import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyframedCropExpr, buildMasterCommand, findSafeClipEnd } from '../src/videoLayout.js';

test('buildKeyframedCropExpr clamps crop positions to the frame bounds', () => {
  const expr = buildKeyframedCropExpr([{ time: 0, cropX: 1.5 }, { time: 2, cropX: 0.2 }], 1080);
  assert.match(expr, /min\(/);
  assert.match(expr, /iw-1080/);
  assert.ok(expr.length > 0);
});

test('findSafeClipEnd prefers a word boundary near the target end', () => {
  const end = findSafeClipEnd({
    targetEnd: 30.4,
    words: [
      { start: 29.9, end: 30.1 },
      { start: 30.3, end: 30.6 },
    ],
    maxLookahead: 0.8,
  });

  assert.ok(end >= 30.3);
  assert.ok(end <= 30.6);
});

test('buildMasterCommand trims to the safe clip end when word timings are available', () => {
  const args = buildMasterCommand({
    inputPath: 'input.mp4',
    outputPath: 'out.mp4',
    start: 10,
    duration: 20,
    srtPath: null,
    watermark: {},
    reframeMode: 'blur-pad',
    words: [{ start: 10.2, end: 10.5 }, { start: 29.7, end: 30.0 }],
  });

  const trimIndex = args.indexOf('-t');
  assert.notEqual(trimIndex, -1);
  assert.match(args[trimIndex + 1], /20(?:\.0+)?/);
});
