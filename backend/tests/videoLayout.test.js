import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeyframedCropExpr, buildMasterCommand, findSafeClipEnd, getResolutionDims, buildEnhancerFilter, buildCustomCropFilter } from '../src/videoLayout.js';

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

test('getResolutionDims returns correct dimensions for 4k, 2k, 1080p', () => {
  const dims4k = getResolutionDims('4k');
  assert.equal(dims4k.width, 2160);
  assert.equal(dims4k.height, 3840);
  assert.equal(dims4k.scaleFactor, 2.0);

  const dims1080 = getResolutionDims('1080p');
  assert.equal(dims1080.width, 1080);
  assert.equal(dims1080.height, 1920);
});

test('buildEnhancerFilter generates valid unsharp and eq filters', () => {
  const filter = buildEnhancerFilter(2.0);
  assert.match(filter, /unsharp=/);
  assert.match(filter, /eq=/);
  assert.match(filter, /hqdn3d=/);
});

test('buildMasterCommand with 4K and detail boost sets 2160x3840 and CRF 18 with correct filter order', () => {
  const args = buildMasterCommand({
    inputPath: 'input.mp4',
    outputPath: 'out_4k.mp4',
    start: 0,
    duration: 10,
    resolution: '4k',
    enhance4k: true,
  });

  const filterComplexIdx = args.indexOf('-filter_complex');
  assert.notEqual(filterComplexIdx, -1);
  const filterGraph = args[filterComplexIdx + 1];
  assert.match(filterGraph, /2160:3840/);
  assert.match(filterGraph, /unsharp=/);
  assert.match(filterGraph, /lanczos/);
  
  // Verify order: hqdn3d -> lanczos -> unsharp -> eq
  const hqdn3dPos = filterGraph.indexOf('hqdn3d=');
  const lanczosPos = filterGraph.indexOf('lanczos');
  const unsharpPos = filterGraph.indexOf('unsharp=');
  const eqPos = filterGraph.indexOf('eq=');
  assert.ok(hqdn3dPos !== -1 && lanczosPos !== -1 && unsharpPos !== -1 && eqPos !== -1);
  assert.ok(hqdn3dPos < lanczosPos, 'hqdn3d must run before lanczos scaling');
  assert.ok(lanczosPos < unsharpPos, 'lanczos scaling must run before unsharp');
  assert.ok(unsharpPos < eqPos, 'unsharp must run before eq');

  const crfIdx = args.indexOf('-crf');
  assert.notEqual(crfIdx, -1);
  assert.equal(args[crfIdx + 1], '18');

  const audioBitrateIdx = args.indexOf('-b:a');
  assert.notEqual(audioBitrateIdx, -1);
  assert.equal(args[audioBitrateIdx + 1], '320k');
});

test('buildMasterCommand with 2K sets 1440x2560, CRF 20, and 256k audio', () => {
  const args = buildMasterCommand({
    inputPath: 'input.mp4',
    outputPath: 'out_2k.mp4',
    start: 0,
    duration: 10,
    resolution: '2k',
  });

  const filterComplexIdx = args.indexOf('-filter_complex');
  assert.notEqual(filterComplexIdx, -1);
  const filterGraph = args[filterComplexIdx + 1];
  assert.match(filterGraph, /1440:2560/);

  const crfIdx = args.indexOf('-crf');
  assert.notEqual(crfIdx, -1);
  assert.equal(args[crfIdx + 1], '20');

  const audioBitrateIdx = args.indexOf('-b:a');
  assert.notEqual(audioBitrateIdx, -1);
  assert.equal(args[audioBitrateIdx + 1], '256k');
});

test('buildCustomCropFilter in 4K mode scales regions to 2160x3840 with correct filter order', () => {
  const res = buildCustomCropFilter('vertical', [{ x: 100, y: 0, width: 600, height: 1080 }], 2160, 3840, '0:v', true);
  assert.equal(res.mapLabel, 'reframed');
  const f = res.filters[0];
  assert.match(f, /2160:3840/);
  assert.match(f, /lanczos/);
  assert.match(f, /unsharp=/);

  // Verify order: hqdn3d -> lanczos -> unsharp -> eq
  const hqdn3dPos = f.indexOf('hqdn3d=');
  const lanczosPos = f.indexOf('lanczos');
  const unsharpPos = f.indexOf('unsharp=');
  const eqPos = f.indexOf('eq=');
  assert.ok(hqdn3dPos !== -1 && lanczosPos !== -1 && unsharpPos !== -1 && eqPos !== -1);
  assert.ok(hqdn3dPos < lanczosPos, 'hqdn3d must run before lanczos in custom crop');
  assert.ok(lanczosPos < unsharpPos, 'lanczos must run before unsharp in custom crop');
  assert.ok(unsharpPos < eqPos, 'unsharp must run before eq in custom crop');
});
