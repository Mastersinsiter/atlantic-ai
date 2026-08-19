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
//  WATERMARK POSITION
// ═══════════════════════════════════════

/**
 * Returns { x, y } expressions for FFmpeg overlay/drawtext filters.
 * bottom positions use H-h-80 to sit above the caption zone.
 */
export function getWatermarkPosition(position, isDrawText = false) {
  const map = {
    'top-left':      { x: '30',                   y: '30' },
    'top-center':    { x: isDrawText ? '(w-tw)/2' : '(W-w)/2',  y: '30' },
    'top-right':     { x: isDrawText ? 'w-tw-30'  : 'W-w-30',   y: '30' },
    'center-left':   { x: '30',                   y: '(H-h)/2' },
    'center':        { x: isDrawText ? '(w-tw)/2' : '(W-w)/2',  y: '(H-h)/2' },
    'center-right':  { x: isDrawText ? 'w-tw-30'  : 'W-w-30',   y: '(H-h)/2' },
    'bottom-left':   { x: '30',                   y: isDrawText ? 'h-th-140' : 'H-h-140' },
    'bottom-center': { x: isDrawText ? '(w-tw)/2' : '(W-w)/2',  y: isDrawText ? 'h-th-160' : 'H-h-160' },
    'bottom-right':  { x: isDrawText ? 'w-tw-30'  : 'W-w-30',   y: isDrawText ? 'h-th-140' : 'H-h-140' },
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
 * @returns {string} FFmpeg expression
 */
export function getFocusCropX(mode) {
  switch (mode) {
    case 'focus-left':   return '0';
    case 'focus-right':  return 'iw-1080';
    case 'focus-center':
    default:             return '(iw-1080)/2';
  }
}

function buildReframeFilters(inputLabel, reframeMode, reframeKeyframes, outputLabel = 'reframed') {
  const filters = [];
  const isFocusMode = reframeMode.startsWith('focus-');
  const hasKeyframes = Array.isArray(reframeKeyframes) && reframeKeyframes.length > 0;

  if (reframeMode === 'split-screen') {
    let topCropX = '(iw-1080)/2';
    if (hasKeyframes) {
      const sortedKF = [...reframeKeyframes].sort((a, b) => a.time - b.time);
      topCropX = buildKeyframedCropExpr(sortedKF, 1080);
    }
    filters.push(`[${inputLabel}]split=3[in0][in1][in2]`);
    filters.push(`[in0]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960:${topCropX}:0[top]`);
    filters.push(`[in1]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,boxblur=20:4[botbg]`);
    filters.push(`[in2]scale=1080:-2:force_original_aspect_ratio=decrease[botfg]`);
    filters.push(`[botbg][botfg]overlay=(W-w)/2:(H-h)/2:format=auto:eof_action=repeat[bottom]`);
    filters.push(`[top][bottom]vstack=inputs=2,format=yuv420p[${outputLabel}]`);
  } else if (isFocusMode) {
    let cropX = getFocusCropX(reframeMode);
    if (hasKeyframes) {
      const sortedKF = [...reframeKeyframes].sort((a, b) => a.time - b.time);
      cropX = buildKeyframedCropExpr(sortedKF, 1080);
    }
    filters.push(
      `[${inputLabel}]scale=-2:1920:force_original_aspect_ratio=increase,crop=1080:1920:${cropX}:0,format=yuv420p[${outputLabel}]`
    );
  } else {
    filters.push(`[${inputLabel}]split=2[in0][in1]`);
    filters.push(`[in0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg]`);
    filters.push(`[in1]scale=1080:-2:force_original_aspect_ratio=decrease[fg]`);
    filters.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto:eof_action=repeat,format=yuv420p[${outputLabel}]`);
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
}) {
  const hasCaptions = !!srtPath;
  const wmEnabled = watermark?.enabled;
  const wmHasImage = wmEnabled && watermark.image_path;
  const wmHasText = wmEnabled && Boolean(watermark.text && String(watermark.text).trim().length > 0) && !wmHasImage;

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
    // -ss before -i is keyframe-based (±2s accuracy) which causes A/V sync
    // offset and subtitle drift. trim/atrim decode from the nearest keyframe
    // but output only the exact requested range.
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
      customFraming.outputWidth || 1080,
      customFraming.outputHeight || 1920,
      currentLabel
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

      const prefixResult = buildReframeFilters(prefixTrim, transition.from || reframeMode, reframeKeyframes, `${prefixInput}_reframed`);
      const suffixResult = buildReframeFilters(suffixTrim, transition.to || reframeMode, reframeKeyframes, `${suffixInput}_reframed`);
      filters.push(...prefixResult.filters);
      filters.push(...suffixResult.filters);
      filters.push(`[${prefixInput}_reframed][${suffixInput}_reframed]xfade=transition=fade:duration=${transitionDuration}:offset=${transitionAt}[transitioned]`);
      currentLabel = 'transitioned';
    } else {
      const isFocusMode = reframeMode.startsWith('focus-');
      const hasKeyframes = Array.isArray(reframeKeyframes) && reframeKeyframes.length > 0;

      if (reframeMode === 'split-screen') {
        let topCropX = '(iw-1080)/2';
        if (hasKeyframes) {
          const sortedKF = [...reframeKeyframes].sort((a, b) => a.time - b.time);
          topCropX = buildKeyframedCropExpr(sortedKF, 1080);
        }
        filters.push(`[${currentLabel}]split=3[in0][in1][in2]`);
        filters.push(`[in0]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960:${topCropX}:0[top]`);
        filters.push(`[in1]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,boxblur=20:4[botbg]`);
        filters.push(`[in2]scale=1080:-2:force_original_aspect_ratio=decrease[botfg]`);
        filters.push(`[botbg][botfg]overlay=(W-w)/2:(H-h)/2:format=auto:eof_action=repeat[bottom]`);
        filters.push(`[top][bottom]vstack=inputs=2,format=yuv420p[reframed]`);
        currentLabel = 'reframed';

      } else if (isFocusMode) {
        let cropX = getFocusCropX(reframeMode);
        if (hasKeyframes) {
          const sortedKF = [...reframeKeyframes].sort((a, b) => a.time - b.time);
          cropX = buildKeyframedCropExpr(sortedKF, 1080);
        }
        filters.push(
          `[${currentLabel}]scale=-2:1920:force_original_aspect_ratio=increase,crop=1080:1920:${cropX}:0,format=yuv420p[reframed]`
        );
        currentLabel = 'reframed';

      } else {
        // blur-pad (default)
        filters.push(`[${currentLabel}]split=2[in0][in1]`);
        filters.push(
          `[in0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg]`
        );
        filters.push(
          `[in1]scale=1080:-2:force_original_aspect_ratio=decrease[fg]`
        );
        filters.push(
          `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto:eof_action=repeat,format=yuv420p[reframed]`
        );
        currentLabel = 'reframed';
      }
    }
  }

  // DISABLED: buildReactionZoomFilter uses zoompan with enable='between(t,...)',
  // which is not supported by this FFmpeg build ("Timeline ('enable' option) not
  // supported with filter 'zoompan'"). This broke ALL clip rendering.
  // TODO: Reimplement as time-varying crop expression (like buildKeyframedCropExpr)
  // const reactionZoom = buildReactionZoomFilter({ cues, virality, duration });
  // if (reactionZoom) {
  //   filters.push(`[${currentLabel}]${reactionZoom}[reactioned]`);
  //   currentLabel = 'reactioned';
  // }

  // Stage 2: Watermark (optional)
  if (wmHasText) {
    const pos = getWatermarkPosition(watermark.position || 'top-right', true);
    const opacity = watermark.opacity ?? 0.9;
    const fontSize = Math.min(28, Math.max(16, Math.round((typeof watermark.size === 'number' ? watermark.size : 24) * 0.55)));
    const safeText = String(watermark.text).replace(/'/g, "\\\\'").replace(/:/g, '\\\\:');
    const fontPath = escapeFFmpegPath('C:/Windows/Fonts/arialbd.ttf');

    filters.push(
      `[${currentLabel}]drawtext=text='${safeText}':fontfile='${fontPath}':fontsize=${fontSize}:fontcolor=white@${opacity}:borderw=1:bordercolor=black@0.8:box=0:x=${pos.x}:y=${pos.y}[watermarked]`
    );
    currentLabel = 'watermarked';
  } else if (wmHasImage) {
    const pos = getWatermarkPosition(watermark.position || 'top-right', false);
    const opacity = watermark.opacity ?? 0.9;
    const wmWidth = typeof watermark.size === 'number' && watermark.size > 10 ? Math.min(220, Math.round(watermark.size * 0.8)) : 180;

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
    // Point libass at the repo-bundled fonts so presets like 'Bebas Neue'
    // resolve even when not installed system-wide. Uses escapeFontsDir (absolute,
    // CWD-independent) with the same colon-escape convention as escapeFFmpegPath.
    const fontsDirEscaped = escapeFontsDir(CAPTION_FONTS_DIR);
    const fontsDirOpt = `:fontsdir='${fontsDirEscaped}'`;
    if (srtPath.toLowerCase().endsWith('.ass')) {
      filters.push(
        `[${currentLabel}]subtitles='${srtEscaped}'${fontsDirOpt}[captioned]`
      );
    } else {
      const style = getCaptionStyle(captionStyle);
      const forceStyle = [
        `FontName=Arial`,
        `FontSize=${style.size}`,
        `PrimaryColour=${style.primary}`,
        `OutlineColour=${style.outline}`,
        `BackColour=${style.backColour || '&H80000000'}`,
        `Outline=${style.outlineW}`,
        `Shadow=${style.shadow}`,
        `BorderStyle=${style.borderStyle || 3}`,
        `Alignment=${style.align}`,
        `MarginV=${style.marginV}`,
      ].join(',');

      filters.push(
        `[${currentLabel}]subtitles='${srtEscaped}':original_size=1080x1920:force_style='${forceStyle}'[captioned]`
      );
    }
    currentLabel = 'captioned';
  }

  // ── Assemble command ──
  const filterStr = filters.join(';');
  console.log('[caption-debug] Full filter graph:', filterStr);
  const audioMap = (trimSegments && trimSegments.length > 0) ? '[concata]' : '[trimmeda]';
  // Branch FIRST on whether trimSegments is set, then fall back to the
  // findSafeClipEnd path. Do NOT unify both cases into one formula:
  //   - trimSegments path: the filter graph concatenates [seg.in, seg.out]
  //     ranges, so the output duration is the SUM of segment lengths.
  //     `start`/`duration` are ignored by this path; computing -t from
  //     findSafeClipEnd(start + duration) would be unrelated to the actual
  //     concatenated content and could cut the clip short or run past it.
  //   - non-trim path: the filter graph trims to [start, safeEnd] where
  //     safeEnd = findSafeClipEnd({ targetEnd: start + duration, ... }), so
  //     effectiveDuration = safeEnd - start matches what was actually trimmed.
  let effectiveDuration;
  if (trimSegments && trimSegments.length > 0) {
    effectiveDuration = Math.max(0.1, trimSegments.reduce(
      (sum, seg) => sum + (Number(seg.out) - Number(seg.in)),
      0
    ));
  } else {
    effectiveDuration = Math.max(0.1, (findSafeClipEnd({ targetEnd: start + duration, words, maxLookahead: 0.8, minGap: 0.2 }) - start));
  }
  const args = [
    '-y',
    ...inputArgs,
    '-t', effectiveDuration.toFixed(3).toString(),
    '-filter_complex', filterStr,
    '-map', `[${currentLabel}]`,
    '-map', audioMap,
    '-c:v', 'libx264',
    '-preset', 'veryfast',   // was 'fast' — ~30% faster encode, same quality
    '-crf', '22',
    '-c:a', 'aac',
    '-b:a', '192k',
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
 * Supports all 6 Clipzi-style layout modes.
 *
 * @param {string} mode         One of: vertical, split, trio, spotlight, centered, horizontal
 * @param {Array}  regions      Array of { x, y, width, height, sourceWidth, sourceHeight }
 * @param {number} outputW      Output width (default 1080)
 * @param {number} outputH      Output height (default 1920)
 * @returns {{ filters: string[], mapLabel: string }}
 */
// NOTE: uses force_original_aspect_ratio=increase + crop (fill), consistent with the
// other reframe modes in this file (blur-pad, focus-*, split-screen) — NOT pad/letterbox.
// Black letterbox bars inside individual crop panels would look broken for a Shorts tool.
export function buildCustomCropFilter(mode, regions, outputW = 1080, outputH = 1920, inputLabel = '0:v') {
  const filters = [];

  switch (mode) {
    case 'vertical':
    case 'centered':
    case 'horizontal': {
      // Single crop
      const r = regions[0] || { x: 0, y: 0, width: 1080, height: 1920 };
      const pad = mode === 'horizontal' ? `${outputW}:${outputH}` : `${outputW}:${outputH}`;
      const scaleStr = mode === 'horizontal' ? `${outputW}:-2` : `${outputW}:${outputH}`;
      
      filters.push(
        `[${inputLabel}]crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${scaleStr}:force_original_aspect_ratio=increase,crop=${pad},format=yuv420p[reframed]`
      );
      return { filters, mapLabel: 'reframed' };
    }

    case 'split': {
      // Two crops
      const panelH = Math.round(outputH / 2);
      filters.push(`[${inputLabel}]split=2[in0][in1]`);
      regions.slice(0, 2).forEach((r, i) => {
        filters.push(
          `[in${i}]crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${outputW}:${panelH}:force_original_aspect_ratio=increase,crop=${outputW}:${panelH}[split${i}]`
        );
      });
      filters.push(`[split0][split1]vstack=inputs=2,format=yuv420p[reframed]`);
      return { filters, mapLabel: 'reframed' };
    }

    case 'trio': {
      // Three crops
      const panelH = Math.round(outputH / 3);
      filters.push(`[${inputLabel}]split=3[in0][in1][in2]`);
      regions.slice(0, 3).forEach((r, i) => {
        filters.push(
          `[in${i}]crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${outputW}:${panelH}:force_original_aspect_ratio=increase,crop=${outputW}:${panelH}[trio${i}]`
        );
      });
      filters.push(`[trio0][trio1][trio2]vstack=inputs=3,format=yuv420p[reframed]`);
      return { filters, mapLabel: 'reframed' };
    }

    case 'spotlight': {
      // Zoomed in top, context bottom
      const spotH = Math.round(outputH * 0.6);
      const ctxH = outputH - spotH;
      const inputs = [];
      if (regions[0]) inputs.push('in0');
      if (regions[1]) inputs.push('in1');
      
      if (inputs.length > 0) {
        filters.push(`[${inputLabel}]split=${inputs.length}[${inputs.join('][')}]`);
      }

      if (regions[0]) {
        const r = regions[0];
        filters.push(
          `[in0]crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${outputW}:${spotH}:force_original_aspect_ratio=increase,crop=${outputW}:${spotH}[spot]`
        );
      }
      if (regions[1]) {
        const r = regions[1];
        filters.push(
          `[in1]crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${outputW}:${ctxH}:force_original_aspect_ratio=increase,crop=${outputW}:${ctxH}[ctx]`
        );
      }
      
      if (regions[0] && regions[1]) {
        filters.push(`[spot][ctx]vstack=inputs=2,format=yuv420p[reframed]`);
      } else {
        filters.push(`[${regions[0] ? 'spot' : 'ctx'}]format=yuv420p[reframed]`);
      }
      return { filters, mapLabel: 'reframed' };
    }

    default: {
      const r = regions[0] || { x: 0, y: 0, width: 1080, height: 1920 };
      filters.push(
        `[${inputLabel}]crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${outputW}:${outputH}:force_original_aspect_ratio=increase,crop=${outputW}:${outputH},format=yuv420p[reframed]`
      );
      return { filters, mapLabel: 'reframed' };
    }
  }
}
