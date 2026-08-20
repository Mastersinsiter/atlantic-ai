/**
 * Atlantic AI — Video Layout & Single-Pass FFmpeg Command Builder
 *
 * Builds ONE master FFmpeg command per clip that handles:
 *   Cut → Reframe 9:16 → Captions → Watermark
 * in a single filter_complex graph. Zero intermediate files.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Bundled caption fonts (Bebas Neue, Anton, Montserrat, Poppins) live here so
// libass can resolve them via fontsdir= regardless of system font installs.
// Resolved from __dirname (this file's location), NOT process.cwd(), so it's
// correct no matter which directory the server was launched from.
const CAPTION_FONTS_DIR = path.resolve(__dirname, '..', 'fonts');

/**
 * Escape a fontsdir path for the subtitles filter. Unlike escapeFFmpegPath
 * (which relativizes to CWD), this keeps the path ABSOLUTE so it works
 * regardless of the server's launch directory. Applies the same single-
 * backslash colon convention FFmpeg expects on Windows: C\:/...
 */
function escapeFontsDir(p) {
  return path.resolve(p)
    .replace(/\\/g, '/')              // backslashes → forward slashes
    .replace(/^([A-Za-z]):\//, '$1\\:/')  // C:/ → C\:/ (FFmpeg colon escape)
    .replace(/'/g, '');               // strip single quotes
}

// ═══════════════════════════════════════
//  PATH ESCAPING (critical on Windows)
// ═══════════════════════════════════════

/**
 * Escape a file path for use INSIDE FFmpeg -filter_complex strings.
 * Do NOT use this on -i or -o arguments — those just need double-quoting.
 *
 * FFmpeg filter_complex requires EXACTLY ONE backslash before the colon
 * in Windows drive letters: C\:/Users/... NOT C\\:/Users/...
 * Using shell: false (direct spawn) means no shell layer, so we only
 * need one level of escaping — single backslash in the JS string.
 */
export function escapeFFmpegPath(p) {
  let safePath = p;
  try {
    // Convert to relative path from CWD to avoid Windows drive letter colon issues
    // inside FFmpeg filter graphs entirely.
    if (path.isAbsolute(p)) {
      safePath = path.relative(process.cwd(), p);
    }
  } catch (e) {}

  return safePath
    .replace(/\\/g, '/')           // all backslashes → forward slashes
    .replace(/^([A-Za-z]):\//, '$1\\:/')  // fallback: C:/ → C\:/ (if still absolute)
    .replace(/'/g, '');            // strip single quotes (unsafe in filter strings)
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function buildReactionZoomFilter({ cues = [], virality = {}, duration = 6 }) {
  const reactionScore = Number(virality?.reactionScore || 0);
  const surpriseScore = Number(virality?.surpriseScore || 0);
  const emotionScore = Number(virality?.emotionScore || 0);
  const strongEmotion = cues.some(cue => ['scream', 'surprise', 'excitement', 'anger'].includes(String(cue.emotion || '').toLowerCase()));
  const shouldZoom = strongEmotion || reactionScore >= 76 || surpriseScore >= 74 || emotionScore >= 75;
  if (!shouldZoom) return null;

  const cue = cues.find(cue => cue && ['scream', 'surprise', 'excitement', 'anger'].includes(String(cue.emotion || '').toLowerCase())) || cues[0];
  const startTime = cue ? Math.max(0.1, Math.min(Math.max(duration * 0.2, Number(cue.start || 0) + 0.1), Math.max(0.2, duration - 0.35))) : Math.max(0.1, duration * 0.25);
  const endTime = Math.min(duration, startTime + 0.35);
  const effectFrames = Math.max(10, Math.round(Math.min(0.35, Math.max(0.2, duration * 0.16)) * 30));
  const zoomStart = 1.0;
  const zoomEnd = 1.12;
  return `zoompan=z='if(lte(on,${effectFrames}),${zoomStart}+(${zoomEnd}-${zoomStart})*(on/${effectFrames}),${zoomEnd})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${effectFrames}:s=1080x1920:fps=30:enable='between(t,${startTime},${endTime})'`;
}

export function buildKeyframedCropExpr(keyframes, targetWidth = 1080) {
  if (!keyframes || keyframes.length === 0) {
    return `(iw-${targetWidth})/2`;
  }

  if (keyframes.length === 1) {
    const cropX = clampNumber(keyframes[0].cropX, 0, 1);
    return `max(0\\,min(${targetWidth}\\,${cropX}*(iw-${targetWidth})))`;
  }

  const parts = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const kf = keyframes[i];
    const kfNext = keyframes[i + 1];
    const x0 = `min(${targetWidth}\\,max(0\\,${clampNumber(kf.cropX, 0, 1)}*(iw-${targetWidth})))`;
    const x1 = `min(${targetWidth}\\,max(0\\,${clampNumber(kfNext.cropX, 0, 1)}*(iw-${targetWidth})))`;
    const t0 = kf.time.toFixed(3);
    const t1 = kfNext.time.toFixed(3);

    if (i === 0) {
      parts.push(`if(lt(t\\,${t0})\\,${x0}\\,`);
    }

    const dur = (kfNext.time - kf.time).toFixed(3);
    parts.push(
      `if(lt(t\\,${t1})\\,${x0}+(${x1}-${x0})*((t-${t0})/${dur})\\,`
    );
  }

  const lastX = `min(${targetWidth}\\,max(0\\,${clampNumber(keyframes[keyframes.length - 1].cropX, 0, 1)}*(iw-${targetWidth})))`;
  parts.push(lastX);

  for (let i = 0; i < keyframes.length; i++) {
    parts.push(')');
  }

  return parts.join('');
}

export function findSafeClipEnd({ targetEnd, words = [], maxLookahead = 0.8, minGap = 0.2 }) {
  const end = Number(targetEnd);
  if (!Number.isFinite(end) || !Array.isArray(words) || words.length === 0) {
    return end;
  }

  const sortedWords = words
    .filter(word => word && Number.isFinite(word.start) && Number.isFinite(word.end))
    .map(word => ({ ...word, start: Number(word.start), end: Number(word.end) }))
    .sort((a, b) => a.start - b.start);

  if (!sortedWords.length) return end;

  const candidates = sortedWords.filter(word => word.end >= end - maxLookahead && word.end <= end + maxLookahead);
  if (!candidates.length) return end;

  const beforeTarget = candidates.filter(word => word.end <= end).sort((a, b) => b.end - a.end);
  if (beforeTarget.length) {
    const lastWord = beforeTarget[0];
    const followingWord = sortedWords.find(word => word.start >= lastWord.end);
    if (!followingWord || followingWord.start - lastWord.end >= minGap) {
      return clampNumber(lastWord.end, 0.1, end);
    }
  }

  const afterTarget = candidates.filter(word => word.start >= end).sort((a, b) => a.start - b.start);
  if (afterTarget.length) {
    return clampNumber(afterTarget[0].start, 0.1, end + maxLookahead);
  }

  return end;
}

// ═══════════════════════════════════════
// ═══════════════════════════════════════
//  RESOLUTION PRESETS & AI ENHANCER
// ═══════════════════════════════════════

export const RESOLUTION_PRESETS = {
  '4k': { width: 2160, height: 3840, label: '4K Ultra HD', scaleFactor: 2.0 },
  '2k': { width: 1440, height: 2560, label: '2K Quad HD', scaleFactor: 1.333 },
  '1080p': { width: 1080, height: 1920, label: '1080p Full HD', scaleFactor: 1.0 },
};

export function getResolutionDims(resolution = '1080p', defaultW = 1080, defaultH = 1920) {
  if (RESOLUTION_PRESETS[resolution]) {
    return {
      width: RESOLUTION_PRESETS[resolution].width,
      height: RESOLUTION_PRESETS[resolution].height,
      scaleFactor: RESOLUTION_PRESETS[resolution].scaleFactor,
    };
  }
  return { width: defaultW, height: defaultH, scaleFactor: defaultW / 1080 };
}

export function buildPreScaleEnhancerFilter() {
  return 'hqdn3d=1.2:1.2:2:2';
}

export function buildPostScaleEnhancerFilter() {
  return 'unsharp=5:5:0.8:5:5:0.4,eq=contrast=1.04:brightness=0.01:saturation=1.06';
}

/**
 * Video Detail & Clarity Enhancement filter chain for FFmpeg:
 * 1. hqdn3d (Pre-Scale): High Quality 3D Denoising to clean compression noise and macroblocks before scaling
 * 2. lanczos (Scaling): Sharp sinc interpolation
 * 3. unsharp (Post-Scale): Advanced unsharp masking for sharp edge, contour, and facial definition
 * 4. eq (Post-Scale): Subtle contrast, brightness, and color saturation calibration for social media pop
 */
export function buildEnhancerFilter(scaleFactor = 1.0) {
  return `${buildPreScaleEnhancerFilter()},${buildPostScaleEnhancerFilter()}`;
}

// ═══════════════════════════════════════
//  WATERMARK POSITION
// ═══════════════════════════════════════

/**
 * Returns { x, y } expressions for FFmpeg overlay/drawtext filters.
 * bottom positions use H-h-80 to sit above the caption zone.
 */
export function getWatermarkPosition(position, isDrawText = false, scaleFactor = 1) {
  const m30 = Math.round(30 * scaleFactor);
  const m140 = Math.round(140 * scaleFactor);
  const m160 = Math.round(160 * scaleFactor);
  const map = {
    'top-left':      { x: `${m30}`,                               y: `${m30}` },
    'top-center':    { x: isDrawText ? '(w-tw)/2' : '(W-w)/2',    y: `${m30}` },
    'top-right':     { x: isDrawText ? `w-tw-${m30}` : `W-w-${m30}`, y: `${m30}` },
    'center-left':   { x: `${m30}`,                               y: '(H-h)/2' },
    'center':        { x: isDrawText ? '(w-tw)/2' : '(W-w)/2',    y: '(H-h)/2' },
    'center-right':  { x: isDrawText ? `w-tw-${m30}` : `W-w-${m30}`, y: '(H-h)/2' },
    'bottom-left':   { x: `${m30}`,                               y: isDrawText ? `h-th-${m140}` : `H-h-${m140}` },
    'bottom-center': { x: isDrawText ? '(w-tw)/2' : '(W-w)/2',    y: isDrawText ? `h-th-${m160}` : `H-h-${m160}` },
    'bottom-right':  { x: isDrawText ? `w-tw-${m30}` : `W-w-${m30}`, y: isDrawText ? `h-th-${m140}` : `H-h-${m140}` },
  };
  return map[position] || map['bottom-center'];
}

// ═══════════════════════════════════════
//  CAPTION STYLE
// ═══════════════════════════════════════

export function getCaptionStyle(styleName) {
  // Small, clean bottom-of-screen captions — no opaque background box.
  // BorderStyle=1 = outline only (no box), keeps text readable over any video.
  // FontSize ~18 on a 1080x1920 canvas = subtle social-media subtitle size.
  const styles = {
    tiktok:  { size: 18, primary: '&Hffffff', outline: '&H000000', outlineW: 2, shadow: 1, align: 2, marginV: 60, borderStyle: 1, backColour: '&H00000000' },
    gaming:  { size: 18, primary: '&H00ffff', outline: '&H000000', outlineW: 2, shadow: 1, align: 2, marginV: 60, borderStyle: 1, backColour: '&H00000000' },
    viral:   { size: 18, primary: '&Hffffff', outline: '&H000000', outlineW: 2, shadow: 1, align: 2, marginV: 60, borderStyle: 1, backColour: '&H00000000' },
    classic: { size: 16, primary: '&Hffffff', outline: '&H000000', outlineW: 2, shadow: 0, align: 2, marginV: 60, borderStyle: 1, backColour: '&H00000000' },
  };
  return styles[styleName] || styles.tiktok;
}

// ═══════════════════════════════════════
//  KEYFRAMED CROP EXPRESSION BUILDER
// ═══════════════════════════════════════

/**
 * Build an FFmpeg expression for the crop X position that changes over time.
 * Each keyframe defines a crop X position at a given timestamp.
 * Between keyframes we use linear interpolation (lerp) via FFmpeg expressions.
 *
 * @param {Array<{time: number, cropX: number}>} keyframes  Sorted by time
 * @param {number} targetWidth   Target crop width (1080)
 * @returns {string} FFmpeg expression string for the crop x parameter
 */

/**
 * Returns a static crop X expression for the named focus mode.
 * @param {'focus-left'|'focus-center'|'focus-right'} mode
 * @param {number} targetWidth
 * @returns {string} FFmpeg expression
 */
export function getFocusCropX(mode, targetWidth = 1080) {
  switch (mode) {
    case 'focus-left':   return '0';
    case 'focus-right':  return `iw-${targetWidth}`;
    case 'focus-center':
    default:             return `(iw-${targetWidth})/2`;
  }
}

function buildReframeFilters(inputLabel, reframeMode, reframeKeyframes, outputLabel = 'reframed', targetW = 1080, targetH = 1920, enhance4k = false) {
  const filters = [];
  const isFocusMode = reframeMode.startsWith('focus-');
  const hasKeyframes = Array.isArray(reframeKeyframes) && reframeKeyframes.length > 0;
  const panelH = Math.round(targetH / 2);
  const scaleFlags = enhance4k ? ':flags=lanczos+accurate_rnd' : '';
  const enhancer = enhance4k ? `,${buildEnhancerFilter(targetW / 1080)}` : '';

  if (reframeMode === 'split-screen') {
    let topCropX = `(iw-${targetW})/2`;
    if (hasKeyframes) {
      const sortedKF = [...reframeKeyframes].sort((a, b) => a.time - b.time);
      topCropX = buildKeyframedCropExpr(sortedKF, targetW);
    }
    filters.push(`[${inputLabel}]split=3[in0][in1][in2]`);
    filters.push(`[in0]scale=${targetW}:${panelH}:force_original_aspect_ratio=increase${scaleFlags},crop=${targetW}:${panelH}:${topCropX}:0[top]`);
    filters.push(`[in1]scale=${targetW}:${panelH}:force_original_aspect_ratio=increase,crop=${targetW}:${panelH},boxblur=20:4[botbg]`);
    filters.push(`[in2]scale=${targetW}:-2:force_original_aspect_ratio=decrease${scaleFlags}[botfg]`);
    filters.push(`[botbg][botfg]overlay=(W-w)/2:(H-h)/2:format=auto:eof_action=repeat[bottom]`);
    filters.push(`[top][bottom]vstack=inputs=2${enhancer},format=yuv420p[${outputLabel}]`);
  } else if (isFocusMode) {
    let cropX = getFocusCropX(reframeMode, targetW);
    if (hasKeyframes) {
      const sortedKF = [...reframeKeyframes].sort((a, b) => a.time - b.time);
      cropX = buildKeyframedCropExpr(sortedKF, targetW);
    }
    filters.push(
      `[${inputLabel}]scale=-2:${targetH}:force_original_aspect_ratio=increase${scaleFlags},crop=${targetW}:${targetH}:${cropX}:0${enhancer},format=yuv420p[${outputLabel}]`
    );
  } else {
    filters.push(`[${inputLabel}]split=2[in0][in1]`);
    filters.push(`[in0]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=25:5[bg]`);
    filters.push(`[in1]scale=${targetW}:-2:force_original_aspect_ratio=decrease${scaleFlags}[fg]`);
    filters.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto:eof_action=repeat${enhancer},format=yuv420p[${outputLabel}]`);
  }

  return { filters, outputLabel };
}

// ═══════════════════════════════════════
//  MASTER COMMAND BUILDER
// ═══════════════════════════════════════

/**
 * Build a single FFmpeg command that does everything in one pass:
 *   1. Input-seek & trim
 *   2. Reframe to 9:16 with blurred background
 *   3. Burn SRT captions (optional)
 *   4. Add watermark — text or image (optional)
 *
 * @param {Object} opts
 * @param {string} opts.inputPath     Source video file
 * @param {string} opts.outputPath    Final output file
 * @param {number} opts.start         Clip start in seconds
 * @param {number} opts.duration      Clip duration in seconds
 * @param {string|null} opts.srtPath  Path to SRT file, or null
 * @param {string} opts.captionStyle  'tiktok' | 'gaming' | 'viral' | 'classic'
 * @param {Object} opts.watermark     { enabled, text, image_path, position, opacity, size }
 * @returns {string[]} FFmpeg args array (ready for spawn)
 */
export function buildMasterCommand({
  inputPath,
  outputPath,
  start,
  duration,
  srtPath = null,
  captionStyle = 'tiktok',
  watermark = {},
  reframeMode = 'blur-pad', // 'blur-pad' | 'split-screen' | 'focus-left' | 'focus-center' | 'focus-right'
  reframeKeyframes = null,   // Array<{ time, cropX }>
  customFraming = null,      // { mode, regions, outputWidth, outputHeight }
  trimSegments = null,       // Array<{ in: number, out: number }>
  voiceoverPath = null,
  layoutTransitions = null,
  words = null,
  cues = [],
  virality = null,
  resolution = '1080p',
  outputWidth = null,
  outputHeight = null,
  enhance4k = false,
}) {
  const hasCaptions = !!srtPath;
  const wmEnabled = watermark?.enabled;
  const wmHasImage = wmEnabled && watermark.image_path;
  const wmHasText = wmEnabled && Boolean(watermark.text && String(watermark.text).trim().length > 0) && !wmHasImage;

  // Determine output canvas resolution & scaling
  const is4K = resolution === '4k' || enhance4k || (outputWidth && outputWidth >= 2160);
  const targetDims = getResolutionDims(is4K ? '4k' : resolution, outputWidth || 1080, outputHeight || 1920);
  const targetW = outputWidth || customFraming?.outputWidth || targetDims.width;
  const targetH = outputHeight || customFraming?.outputHeight || targetDims.height;
  const scaleFactor = targetW / 1080;
  const isEnhanced = Boolean(enhance4k || is4K);

  // ── Input arguments ──
  const inputArgs = [];
  const filters = [];
  let currentLabel = '0:v';

  if (trimSegments && trimSegments.length > 0) {
    inputArgs.push('-i', inputPath);
    if (trimSegments.length === 1) {
       filters.push(`[0:v]trim=start=${trimSegments[0].in}:end=${trimSegments[0].out},setpts=PTS-STARTPTS[concatv]`);
       filters.push(`[0:a]atrim=start=${trimSegments[0].in}:end=${trimSegments[0].out},asetpts=PTS-STARTPTS[concata]`);
       currentLabel = 'concatv';
    } else {
       let concatInputs = '';
       trimSegments.forEach((seg, i) => {
         filters.push(`[0:v]trim=start=${seg.in}:end=${seg.out},setpts=PTS-STARTPTS[v${i}]`);
         filters.push(`[0:a]atrim=start=${seg.in}:end=${seg.out},asetpts=PTS-STARTPTS[a${i}]`);
         concatInputs += `[v${i}][a${i}]`;
       });
       filters.push(`${concatInputs}concat=n=${trimSegments.length}:v=1:a=1[concatv][concata]`);
       currentLabel = 'concatv';
    }
  } else {
    // Frame-accurate seeking via trim/atrim filters instead of input-seeking.
    inputArgs.push('-i', inputPath);
    const trimEnd = start + duration;
    const safeEnd = findSafeClipEnd({ targetEnd: trimEnd, words, maxLookahead: 0.8, minGap: 0.2 });
    const effectiveDuration = Math.max(0.1, safeEnd - start);
    filters.push(`[0:v]trim=start=${start}:end=${safeEnd},setpts=PTS-STARTPTS[trimmedv]`);
    filters.push(`[0:a]atrim=start=${start}:end=${safeEnd},asetpts=PTS-STARTPTS[trimmeda]`);
    currentLabel = 'trimmedv';
  }

  if (wmHasImage) {
    inputArgs.push('-i', watermark.image_path);
  }
  let voiceoverIndex = -1;
  if (voiceoverPath) {
    inputArgs.push('-i', voiceoverPath);
    voiceoverIndex = inputArgs.filter(a => a === '-i').length - 1;
  }

  // ── Build filter_complex graph ──
  if (customFraming && customFraming.mode && customFraming.regions && customFraming.regions.length > 0) {
    const cropResult = buildCustomCropFilter(
      customFraming.mode,
      customFraming.regions,
      targetW,
      targetH,
      currentLabel,
      isEnhanced
    );
    filters.push(...cropResult.filters);
    currentLabel = cropResult.mapLabel;
  } else {
    const transitions = Array.isArray(layoutTransitions) ? layoutTransitions.filter(item => item && Number.isFinite(item.at)) : [];
    if (transitions.length > 0) {
      const transition = transitions[0];
      const transitionAt = clampNumber(transition.at ?? (duration / 2), 0.2, Math.max(0.2, duration - 0.2));
      const transitionDuration = clampNumber(transition.duration ?? 0.2, 0.15, 0.25);
      const prefixInput = `${currentLabel}_prefix`;
      const prefixTrim = `${prefixInput}_trim`;
      const suffixInput = `${currentLabel}_suffix`;
      const suffixTrim = `${suffixInput}_trim`;

      filters.push(`[${currentLabel}]split=2[${prefixInput}][${suffixInput}]`);
      filters.push(`[${prefixInput}]trim=start=0:end=${transitionAt},setpts=PTS-STARTPTS[${prefixTrim}]`);
      filters.push(`[${suffixInput}]trim=start=${transitionAt}:end=${duration},setpts=PTS-STARTPTS[${suffixTrim}]`);

      const prefixResult = buildReframeFilters(prefixTrim, transition.from || reframeMode, reframeKeyframes, `${prefixInput}_reframed`, targetW, targetH, isEnhanced);
      const suffixResult = buildReframeFilters(suffixTrim, transition.to || reframeMode, reframeKeyframes, `${suffixInput}_reframed`, targetW, targetH, isEnhanced);
      filters.push(...prefixResult.filters);
      filters.push(...suffixResult.filters);
      filters.push(`[${prefixInput}_reframed][${suffixInput}_reframed]xfade=transition=fade:duration=${transitionDuration}:offset=${transitionAt}[transitioned]`);
      currentLabel = 'transitioned';
    } else {
      const isFocusMode = reframeMode.startsWith('focus-');
      const hasKeyframes = Array.isArray(reframeKeyframes) && reframeKeyframes.length > 0;
      const panelH = Math.round(targetH / 2);
      const scaleFlags = isEnhanced ? ':flags=lanczos+accurate_rnd' : '';
      const postEnhancer = isEnhanced ? `,${buildPostScaleEnhancerFilter()}` : '';

      let baseInput = currentLabel;
      if (isEnhanced) {
        filters.push(`[${currentLabel}]${buildPreScaleEnhancerFilter()}[denoised]`);
        baseInput = 'denoised';
      }

      if (reframeMode === 'split-screen') {
        let topCropX = `(iw-${targetW})/2`;
        if (hasKeyframes) {
          const sortedKF = [...reframeKeyframes].sort((a, b) => a.time - b.time);
          topCropX = buildKeyframedCropExpr(sortedKF, targetW);
        }
        filters.push(`[${baseInput}]split=3[in0][in1][in2]`);
        filters.push(`[in0]scale=${targetW}:${panelH}:force_original_aspect_ratio=increase${scaleFlags},crop=${targetW}:${panelH}:${topCropX}:0[top]`);
        filters.push(`[in1]scale=${targetW}:${panelH}:force_original_aspect_ratio=increase,crop=${targetW}:${panelH},boxblur=20:4[botbg]`);
        filters.push(`[in2]scale=${targetW}:-2:force_original_aspect_ratio=decrease${scaleFlags}[botfg]`);
        filters.push(`[botbg][botfg]overlay=(W-w)/2:(H-h)/2:format=auto:eof_action=repeat[bottom]`);
        filters.push(`[top][bottom]vstack=inputs=2${postEnhancer},format=yuv420p[reframed]`);
        currentLabel = 'reframed';

      } else if (isFocusMode) {
        let cropX = getFocusCropX(reframeMode, targetW);
        if (hasKeyframes) {
          const sortedKF = [...reframeKeyframes].sort((a, b) => a.time - b.time);
          cropX = buildKeyframedCropExpr(sortedKF, targetW);
        }
        filters.push(
          `[${baseInput}]scale=-2:${targetH}:force_original_aspect_ratio=increase${scaleFlags},crop=${targetW}:${targetH}:${cropX}:0${postEnhancer},format=yuv420p[reframed]`
        );
        currentLabel = 'reframed';

      } else {
        // blur-pad (default)
        filters.push(`[${baseInput}]split=2[in0][in1]`);
        filters.push(
          `[in0]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=25:5[bg]`
        );
        filters.push(
          `[in1]scale=${targetW}:-2:force_original_aspect_ratio=decrease${scaleFlags}[fg]`
        );
        filters.push(
          `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto:eof_action=repeat${postEnhancer},format=yuv420p[reframed]`
        );
        currentLabel = 'reframed';
      }
    }
  }

  // Stage 2: Watermark (optional)
  if (wmHasText) {
    const pos = getWatermarkPosition(watermark.position || 'top-right', true, scaleFactor);
    const opacity = watermark.opacity ?? 0.9;
    const baseFontSize = Math.min(28, Math.max(16, Math.round((typeof watermark.size === 'number' ? watermark.size : 24) * 0.55)));
    const fontSize = Math.round(baseFontSize * scaleFactor);
    const borderW = Math.max(1, Math.round(1.5 * scaleFactor));
    const safeText = String(watermark.text).replace(/'/g, "\\\\'").replace(/:/g, '\\\\:');
    const fontPath = escapeFFmpegPath('C:/Windows/Fonts/arialbd.ttf');

    filters.push(
      `[${currentLabel}]drawtext=text='${safeText}':fontfile='${fontPath}':fontsize=${fontSize}:fontcolor=white@${opacity}:borderw=${borderW}:bordercolor=black@0.8:box=0:x=${pos.x}:y=${pos.y}[watermarked]`
    );
    currentLabel = 'watermarked';
  } else if (wmHasImage) {
    const pos = getWatermarkPosition(watermark.position || 'top-right', false, scaleFactor);
    const opacity = watermark.opacity ?? 0.9;
    const baseWmWidth = typeof watermark.size === 'number' && watermark.size > 10 ? Math.min(220, Math.round(watermark.size * 0.8)) : 180;
    const wmWidth = Math.round(baseWmWidth * scaleFactor);

    filters.push(
      `[1:v]scale=${wmWidth}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm]`
    );
    filters.push(
      `[${currentLabel}][wm]overlay=${pos.x}:${pos.y}:format=auto:eof_action=repeat[watermarked]`
    );
    currentLabel = 'watermarked';
  }

  // Stage 3: Captions (optional)
  if (hasCaptions) {
    const srtEscaped = escapeFFmpegPath(srtPath);
    const fontsDirEscaped = escapeFontsDir(CAPTION_FONTS_DIR);
    const fontsDirOpt = `:fontsdir='${fontsDirEscaped}'`;
    if (srtPath.toLowerCase().endsWith('.ass')) {
      filters.push(
        `[${currentLabel}]subtitles='${srtEscaped}'${fontsDirOpt}[captioned]`
      );
    } else {
      const style = getCaptionStyle(captionStyle);
      const scaledSize = Math.round(style.size * scaleFactor);
      const scaledOutline = Math.round(style.outlineW * scaleFactor);
      const scaledMarginV = Math.round(style.marginV * scaleFactor);
      const forceStyle = [
        `FontName=Arial`,
        `FontSize=${scaledSize}`,
        `PrimaryColour=${style.primary}`,
        `OutlineColour=${style.outline}`,
        `BackColour=${style.backColour || '&H80000000'}`,
        `Outline=${scaledOutline}`,
        `Shadow=${style.shadow}`,
        `BorderStyle=${style.borderStyle || 3}`,
        `Alignment=${style.align}`,
        `MarginV=${scaledMarginV}`,
      ].join(',');

      filters.push(
        `[${currentLabel}]subtitles='${srtEscaped}':original_size=${targetW}x${targetH}:force_style='${forceStyle}'[captioned]`
      );
    }
    currentLabel = 'captioned';
  }

  // ── Assemble command ──
  const filterStr = filters.join(';');
  console.log('[caption-debug] Full filter graph:', filterStr);
  const audioMap = (trimSegments && trimSegments.length > 0) ? '[concata]' : '[trimmeda]';
  let effectiveDuration;
  if (trimSegments && trimSegments.length > 0) {
    effectiveDuration = Math.max(0.1, trimSegments.reduce(
      (sum, seg) => sum + (Number(seg.out) - Number(seg.in)),
      0
    ));
  } else {
    effectiveDuration = Math.max(0.1, (findSafeClipEnd({ targetEnd: start + duration, words, maxLookahead: 0.8, minGap: 0.2 }) - start));
  }

  // Optimize encoding parameters for 4K UHD vs 2K Quad-HD vs standard HD
  const crf = is4K ? '18' : (resolution === '2k' ? '20' : '22');
  const audioBitrate = is4K ? '320k' : (resolution === '2k' ? '256k' : '192k');

  const args = [
    '-y',
    ...inputArgs,
    '-t', effectiveDuration.toFixed(3).toString(),
    '-filter_complex', filterStr,
    '-map', `[${currentLabel}]`,
    '-map', audioMap,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', crf,
    '-c:a', 'aac',
    '-b:a', audioBitrate,
    '-avoid_negative_ts', 'make_zero',
    '-async', '1',
    '-vsync', '1',
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    outputPath
  ];
  return args;
}

// ═══════════════════════════════════════
//  LEGACY EXPORTS (backward compat)
// ═══════════════════════════════════════

export const REFRAME_MODES = [
  'blur-pad',
  'split-screen',
  'focus-left',
  'focus-center',
  'focus-right',
];

export const STREAM_LAYOUTS = {
  'stream-top': 'Blurred BG + centered',
  'stream-bottom': 'Blurred BG + centered',
  'stream-left': 'Blurred BG + centered',
  'stream-right': 'Blurred BG + centered',
};

export function isStreamLayout(layoutId) {
  return String(layoutId || '').startsWith('stream-');
}

export function resolveStreamLayout() { return 'stream-top'; }
export function buildStreamLayoutFilter() { return null; }
export function buildPortraitFilter() { return null; }
export function buildPortraitFilterComplex() { return null; }
export function buildLayoutFilterComplex() { return null; }
export function buildLayoutFilterSimple() { return null; }
export function buildLayoutFilter() { return null; }
export function normalizeWebcamRegion() { return 'top'; }
export function inferReframeV2(metadata, segments) { return segments; }
export function shouldUseStackedLayout() { return false; }
export function usesFilterComplex() { return false; }

export const LAYOUT_MODES = ['auto', 'top', 'bottom', 'left', 'right', ...Object.keys(STREAM_LAYOUTS)];

// ═══════════════════════════════════════
//  CUSTOM CROP FILTER (Clipzi-Style Reframe)
// ═══════════════════════════════════════

/**
 * Build an FFmpeg filter_complex string from user-defined crop regions.
 * Supports all 6 Clipzi-style layout modes with AI 4K enhancement.
 *
 * @param {string} mode         One of: vertical, split, trio, spotlight, centered, horizontal
 * @param {Array}  regions      Array of { x, y, width, height, sourceWidth, sourceHeight }
 * @param {number} outputW      Output width (default 1080)
 * @param {number} outputH      Output height (default 1920)
 * @param {string} inputLabel   Input stream label
 * @param {boolean} enhance4k   Apply AI sharpening & clarity boost
 * @returns {{ filters: string[], mapLabel: string }}
 */
export function buildCustomCropFilter(mode, regions, outputW = 1080, outputH = 1920, inputLabel = '0:v', enhance4k = false) {
  const filters = [];
  const scaleFlags = enhance4k ? ':flags=lanczos+accurate_rnd' : '';
  const postEnhancer = enhance4k ? `,${buildPostScaleEnhancerFilter()}` : '';
  const preFilter = enhance4k ? `${buildPreScaleEnhancerFilter()},` : '';

  switch (mode) {
    case 'vertical':
    case 'centered':
    case 'horizontal': {
      // Single crop: hqdn3d -> crop -> scale(lanczos) -> crop -> unsharp -> eq
      const r = regions[0] || { x: 0, y: 0, width: outputW, height: outputH };
      const pad = `${outputW}:${outputH}`;
      const scaleStr = mode === 'horizontal' ? `${outputW}:-2` : `${outputW}:${outputH}`;
      
      filters.push(
        `[${inputLabel}]${preFilter}crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${scaleStr}:force_original_aspect_ratio=increase${scaleFlags},crop=${pad}${postEnhancer},format=yuv420p[reframed]`
      );
      return { filters, mapLabel: 'reframed' };
    }

    case 'split': {
      // Two crops: hqdn3d -> split -> scale(lanczos) -> vstack -> unsharp -> eq
      const panelH = Math.round(outputH / 2);
      let inLabel = inputLabel;
      if (enhance4k) {
        filters.push(`[${inputLabel}]${buildPreScaleEnhancerFilter()}[denoised]`);
        inLabel = 'denoised';
      }
      filters.push(`[${inLabel}]split=2[in0][in1]`);
      regions.slice(0, 2).forEach((r, i) => {
        filters.push(
          `[in${i}]crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${outputW}:${panelH}:force_original_aspect_ratio=increase${scaleFlags},crop=${outputW}:${panelH}[split${i}]`
        );
      });
      filters.push(`[split0][split1]vstack=inputs=2${postEnhancer},format=yuv420p[reframed]`);
      return { filters, mapLabel: 'reframed' };
    }

    case 'trio': {
      const panelH = Math.round(outputH / 3);
      let inLabel = inputLabel;
      if (enhance4k) {
        filters.push(`[${inputLabel}]${buildPreScaleEnhancerFilter()}[denoised]`);
        inLabel = 'denoised';
      }
      filters.push(`[${inLabel}]split=3[in0][in1][in2]`);
      regions.slice(0, 3).forEach((r, i) => {
        filters.push(
          `[in${i}]crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${outputW}:${panelH}:force_original_aspect_ratio=increase${scaleFlags},crop=${outputW}:${panelH}[trio${i}]`
        );
      });
      filters.push(`[trio0][trio1][trio2]vstack=inputs=3${postEnhancer},format=yuv420p[reframed]`);
      return { filters, mapLabel: 'reframed' };
    }

    case 'spotlight': {
      const spotH = Math.round(outputH * 0.6);
      const ctxH = outputH - spotH;
      let inLabel = inputLabel;
      if (enhance4k) {
        filters.push(`[${inputLabel}]${buildPreScaleEnhancerFilter()}[denoised]`);
        inLabel = 'denoised';
      }
      const inputs = [];
      if (regions[0]) inputs.push('in0');
      if (regions[1]) inputs.push('in1');
      
      if (inputs.length > 0) {
        filters.push(`[${inLabel}]split=${inputs.length}[${inputs.join('][')}]`);
      }

      if (regions[0]) {
        const r = regions[0];
        filters.push(
          `[in0]crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${outputW}:${spotH}:force_original_aspect_ratio=increase${scaleFlags},crop=${outputW}:${spotH}[spot]`
        );
      }
      if (regions[1]) {
        const r = regions[1];
        filters.push(
          `[in1]crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${outputW}:${ctxH}:force_original_aspect_ratio=increase${scaleFlags},crop=${outputW}:${ctxH}[ctx]`
        );
      }
      
      if (regions[0] && regions[1]) {
        filters.push(`[spot][ctx]vstack=inputs=2${postEnhancer},format=yuv420p[reframed]`);
      } else {
        filters.push(`[${regions[0] ? 'spot' : 'ctx'}]${postEnhancer ? buildPostScaleEnhancerFilter() + ',' : ''}format=yuv420p[reframed]`);
      }
      return { filters, mapLabel: 'reframed' };
    }

    default: {
      const r = regions[0] || { x: 0, y: 0, width: outputW, height: outputH };
      filters.push(
        `[${inputLabel}]${preFilter}crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${outputW}:${outputH}:force_original_aspect_ratio=increase${scaleFlags},crop=${outputW}:${outputH}${postEnhancer},format=yuv420p[reframed]`
      );
      return { filters, mapLabel: 'reframed' };
    }
  }
}
