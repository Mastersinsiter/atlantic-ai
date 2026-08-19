/**
 * Atlantic AI Processor v5 — Parallel Single-Pass FFmpeg Pipeline
 *
 * Each clip is processed in ONE FFmpeg command (Cut → Reframe → Captions → Watermark).
 * Clips now run IN PARALLEL (max 2 concurrent FFmpeg processes) for ~2× speed on
 * multi-core machines. Progress tracking uses per-slot allocation to stay monotonic.
 */
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { jobs } from './queue.js';
import { analyzeWithGemini, heuristicSegments, detectSplitScreenFraming } from './mediaAnalysis.js';
import { transcribeVideo } from './transcription.js';
import { buildMasterCommand, buildCustomCropFilter } from './videoLayout.js';
import { generateASS } from './subtitleGenerator.js';
import { buildClipCuesWithSTT, buildClipCues, cuesToASS, getCaptionStyleConfig } from './captionEngine.js';
import { scoreSubtitles } from './subtitleQuality.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
const execAsync = promisify(exec);
const OUTPUT_DIR = path.join(__dirname, '../outputs');
const UPLOAD_DIR = path.join(__dirname, '../uploads');
const COOKIES_PATH = path.join(__dirname, '../cookies.txt');
const DEBUG_GEMINI_ANALYSIS = process.env.DEBUG_GEMINI_ANALYSIS === '1';
[OUTPUT_DIR, UPLOAD_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

function hasValidCookiesFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    const validLines = content.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));
    return validLines.length > 0;
  } catch {
    return false;
  }
}

function logAnalysisScoreSummary(jobId, clips) {
  if (!DEBUG_GEMINI_ANALYSIS || !Array.isArray(clips) || clips.length === 0) return;
  const sorted = [...clips].sort((a, b) => (b.score || 0) - (a.score || 0));
  const rows = sorted.map((c, idx) => {
    const score = c.score ?? 0;
    const id = c.index ?? idx;
    const start = c.start?.toFixed?.(1) ?? 'NA';
    const end = c.end?.toFixed?.(1) ?? 'NA';
    const category = c.category || 'unknown';
    const emotion = c.emotion || 'neutral';
    const face = c.has_face === true ? 'face' : c.has_face === false ? 'noface' : 'unknown';
    return `clip${id + 1}: score=${score} start=${start} end=${end} cat=${category} emo=${emotion} face=${face}`;
  });
  log(jobId, `[debug] Gemini clip score summary (${rows.length} clips):`);
  rows.forEach(r => log(jobId, `  ${r}`));
}

// Max parallel FFmpeg encodes. 2 is safe on most machines.
// Raise to 3 only if you have 8+ cores and fast NVMe storage.
const MAX_PARALLEL_CLIPS = 2;

// ═══════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════

function log(jobId, msg) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.logs.push({ time: new Date().toISOString(), msg });
  console.log(`[${jobId.slice(0, 8)}] ${msg}`);
}

function setProgress(jobId, pct) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.progress = Math.round(Math.min(100, Math.max(0, pct)));
}

function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch { }
}

function loadProfile() {
  const profilePath = path.join(__dirname, '../creator_profile.json');
  const defaults = {
    name: 'Creator', content_type: 'gaming', audience_age: '13-25',
    style: 'energetic', clip_style: 'start with action not buildup',
    avoid: 'slow sections, long talking, boring intros', language: 'auto',
    example_hooks: ["You won't believe what happened next...", 'This is insane...', 'Wait for it...'],
    watermark: { enabled: false, text: '@yourchannel', image_path: '', position: 'bottom-right', opacity: 0.8, size: 36 }
  };
  try {
    if (fs.existsSync(profilePath)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(profilePath, 'utf8')) };
    }
  } catch { }
  return defaults;
}

// ═══════════════════════════════════════
//  SRT CAPTION BUILDER
// ═══════════════════════════════════════

function formatSrtTime(sec) {
  // NOTE: currently unused/dead code in this file (nothing calls formatSrtTime
  // anymore now that captions go through ASS via captionEngine.js), but fixed
  // for correctness in case it gets wired back up later. The old version
  // rounded ms up to 1000 and bumped `s` by 1 without cascading into minutes/
  // hours, so a clip ending near a whole second could render an invalid
  // "SS:60,000" timestamp instead of rolling into the next minute.
  let totalMs = Math.round(sec * 1000);
  const h = Math.floor(totalMs / 3600000);
  totalMs -= h * 3600000;
  const m = Math.floor(totalMs / 60000);
  totalMs -= m * 60000;
  const s = Math.floor(totalMs / 1000);
  const ms = totalMs - s * 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

async function buildASS(clip, clipId, videoPath, jobId, style, options = {}, language = 'auto') {
  if (language === 'none' || style === 'none' || options.captionStyle === 'none') {
    log(jobId, `[caption] Captions disabled by user preference (language=${language}, style=${style})`);
    return null;
  }
  // Cues are now generated during analysis step (Phase 2 segmentation)
  const cues = clip.cues && clip.cues.length > 0 ? clip.cues : [];
  if (!cues.length) return null;

  const styleConfig = getCaptionStyleConfig(style, options, language);
  const assContent = cuesToASS(cues, styleConfig);
  if (!assContent) return null;

  const { score, issues } = scoreSubtitles(cues, clip.end - clip.start);
  if (score < 50) {
    log(jobId, `[caption] Warning: Subtitle quality score ${score}/100. Issues: ${issues.join('; ')}`);
  }

  const assPath = path.join(UPLOAD_DIR, `${clipId}.ass`);
  fs.writeFileSync(assPath, assContent, 'utf8');
  log(jobId, `[caption] ${cues.length} cues written for clip ${clipId} (score: ${score}/100)`);
  return assPath;
}

// ═══════════════════════════════════════
//  FFMPEG PROGRESS RUNNER (per-slot)
// ═══════════════════════════════════════

/**
 * Spawn FFmpeg and track progress into a dedicated slot of the 45-90% range.
 *
 * Each clip owns an exclusive band: slot 0 of 3 → 45%-60%, slot 1 → 60%-75%, etc.
 * With parallel execution, multiple clips write to different bands simultaneously —
 * no contention, progress stays monotonically non-decreasing overall.
 *
 * @param {string[]} args       FFmpeg argument array
 * @param {number}   duration   Expected clip duration in seconds
 * @param {string}   jobId      Job ID for progress updates
 * @param {number}   slotIndex  This clip's slot index (0-based)
 * @param {number}   totalSlots Total number of clips
 */
function runFFmpegWithProgress(args, duration, jobId, slotIndex, totalSlots) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderrLines = [];
    // Each slot owns an equal share of the 45%-90% progress band
    const slotSize = 45 / totalSlots;
    const slotStart = 45 + slotIndex * slotSize;

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrLines.push(text);
      // Keep the full stderr for diagnostics on failure — don't truncate.
      // (Progress parsing only needs the most recent chunk, handled below.)

      // Parse FFmpeg's time= progress line
      const m = text.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
      if (m && duration > 0) {
        const currentSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 100;
        const clipFraction = Math.min(1, currentSec / duration);
        // Write only into this clip's slot — never touches other clips' ranges
        setProgress(jobId, slotStart + clipFraction * slotSize);
      }
    });

    child.stdout.on('data', () => { }); // drain stdout

    child.on('close', (code) => {
      if (code === 0) {
        // Mark this slot as 100% complete
        setProgress(jobId, slotStart + slotSize);
        resolve();
      } else {
        const lastLines = stderrLines.join('').split('\n').slice(-10).join('\n');
        reject(new Error(`FFmpeg exited with code ${code}\n${lastLines}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

// ═══════════════════════════════════════
//  PROCESS SINGLE CLIP
// ═══════════════════════════════════════

async function processClip(clip, sourcePath, jobId, slotIndex, totalSlots, profile, options = {}) {
  const clipId = `${jobId}_clip${clip.index + 1}`;
  const outputPath = path.join(OUTPUT_DIR, `${clipId}.mp4`);
  const duration = clip.end - clip.start;
  const captionStyle = clip.suggested_caption_style || 'tiktok';
  const reframeMode = options.reframeMode || 'blur-pad';
  const language = options.language || 'auto';

  const srtPath = await buildASS(clip, clipId, sourcePath, jobId, captionStyle, options, language);
  const watermark = (options.watermark && typeof options.watermark.enabled === 'boolean') ? options.watermark : (profile.watermark || {});

  const ffmpegArgs = buildMasterCommand({
    inputPath: sourcePath,
    outputPath,
    start: clip.start,
    duration,
    srtPath,
    captionStyle,
    watermark,
    reframeMode,
    reframeKeyframes: clip.reframe?.keyframes || null,
    customFraming: clip.customFraming || null,
    trimSegments: clip.trimSegments || null,
    words: clip.words || [],
    cues: clip.cues || [],
    virality: clip.virality || null,
  });

  try {
    log(jobId, `  Clip ${clip.index + 1}: running single-pass FFmpeg (${reframeMode})${srtPath ? ' + captions' : ''}...`);
    await runFFmpegWithProgress(ffmpegArgs, duration, jobId, slotIndex, totalSlots);
  } catch (err1) {
    log(jobId, `[warn] Clip ${clip.index + 1} full pipeline failed (full stderr below):`);
    err1.message.split('\n').forEach(line => log(jobId, `  ${line}`));
    log(jobId, `  Clip ${clip.index + 1}: retrying bare reframe (no captions, no watermark)...`);
    safeUnlink(outputPath);

    const fallbackArgs = buildMasterCommand({
      inputPath: sourcePath,
      outputPath,
      start: clip.start,
      duration,
      srtPath: null,
      watermark: {},
      reframeMode,
      reframeKeyframes: clip.reframe?.keyframes || null,
      customFraming: clip.customFraming || null,
      trimSegments: clip.trimSegments || null,
      words: [],      // Strip words — fallback should be minimal
      cues: [],       // Strip cues — prevents reaction zoom re-triggering
      virality: null,  // Strip virality — prevents reaction zoom re-triggering
    });
    try {
      await runFFmpegWithProgress(fallbackArgs, duration, jobId, slotIndex, totalSlots);
    } catch (err2) {
      log(jobId, `[error] Clip ${clip.index + 1} failed completely (full stderr below):`);
      err2.message.split('\n').forEach(line => log(jobId, `  ${line}`));
      safeUnlink(outputPath);
      safeUnlink(srtPath);
      return null;
    }
  }

  safeUnlink(srtPath);

  if (!fs.existsSync(outputPath)) {
    log(jobId, `[error] Clip ${clip.index + 1}: output file missing after FFmpeg`);
    return null;
  }

  const stats = fs.statSync(outputPath);
  if (stats.size < 50000) {
    log(jobId, `[error] Clip ${clip.index + 1}: output file is too small (${stats.size} bytes). Likely empty or corrupted due to invalid timestamps. Filtering out.`);
    safeUnlink(outputPath);
    return null;
  }

  log(jobId, `✅ Clip ${clip.index + 1} done (${Math.round(duration)}s, ${(stats.size / 1048576).toFixed(1)} MB)`);

  return {
    clip_id: clipId,
    index: clip.index,
    reframe: clip.reframe || null,
    filename: `${clipId}.mp4`,
    url: `/outputs/${clipId}.mp4`,
    duration: Math.round(duration),
    title: clip.title,
    hook: clip.hook,
    summary: clip.why_viral,
    why_viral: clip.why_viral,
    score: clip.score,
    virality_score: clip.score,
    category: clip.category,
    emotion: clip.emotion,
    thumbnail_second: clip.best_thumbnail_second,
    has_watermark: !!(watermark.enabled),
    start: clip.start,
    end: clip.end,
    size: stats.size,
    createdAt: new Date().toISOString(),
    words: clip.words || [],
    cues: clip.cues || [],
    transcript: clip.transcript || '',
  };
}

// ═══════════════════════════════════════
//  PARALLEL CLIP RUNNER
// ═══════════════════════════════════════

/**
 * Run all clips in parallel with a concurrency cap.
 * Uses a simple semaphore — at most MAX_PARALLEL_CLIPS FFmpeg processes
 * run simultaneously. Remaining clips queue and start as slots free up.
 */
async function processClipsParallel(clips, sourcePath, jobId, profile, options = {}) {
  const total = clips.length;
  const results = new Array(total).fill(null);
  let nextClip = 0;

  async function runWorker() {
    while (nextClip < total) {
      const i = nextClip++;
      const clip = clips[i];
      // slotIndex = i so each clip owns its own progress band
      results[i] = await processClip(clip, sourcePath, jobId, i, total, profile, options);
    }
  }

  // Spawn up to MAX_PARALLEL_CLIPS workers — they pull clips from the shared queue
  const workers = [];
  for (let w = 0; w < Math.min(MAX_PARALLEL_CLIPS, total); w++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);

  return results.filter(Boolean);
}

// ═══════════════════════════════════════
//  YOUTUBE DOWNLOAD
// ═══════════════════════════════════════

function extractYouTubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:v=|\/|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

async function fetchYouTubeMeta(jobId, url) {
  try {
    const cookieArg = hasValidCookiesFile(COOKIES_PATH) ? `--cookies "${COOKIES_PATH}"` : '';
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-playlist --extractor-args "youtube:player_client=web,mweb,tv" ${cookieArg} "${url}"`,
      { maxBuffer: 15 * 1024 * 1024 }
    );
    const info = JSON.parse(stdout);
    return {
      id: info.id || extractYouTubeId(url),
      title: info.title || '',
      description: (info.description || '').slice(0, 2500),
      channel: info.channel || info.uploader || '',
      duration: info.duration,
    };
  } catch (err) {
    log(jobId, `Could not fetch video info: ${String(err.message).slice(0, 80)}`);
    return { id: extractYouTubeId(url), title: '', description: '', channel: '' };
  }
}

function runYtDlp(jobId, url, outPath, format, useCookies = false) {
  return new Promise((resolve) => {
    const args = [
      '-f', format,
      '--merge-output-format', 'mp4',
      '-o', outPath,
      '--no-playlist',
      '--force-overwrites',
      '--no-continue',
      '--concurrent-fragments', '4',
      '--extractor-args', 'youtube:player_client=web,mweb,tv'
    ];

    if (useCookies && hasValidCookiesFile(COOKIES_PATH)) {
      args.push('--cookies', COOKIES_PATH);
    }

    args.push(url);

    const proc = spawn('yt-dlp', args);
    let fullStderr = '';

    const handleOutput = (d, isErrorStream) => {
      const line = d.toString().trim();
      if (!line) return;

      const m = line.match(/\[download\]\s+([\d.]+)%/);
      if (m) {
        setProgress(jobId, Math.min(14, parseFloat(m[1]) * 0.14));
      } else {
        log(jobId, line);
      }

      if (isErrorStream) {
        fullStderr += line + '\n';
      }
    };

    proc.stdout.on('data', d => handleOutput(d, false));
    proc.stderr.on('data', d => handleOutput(d, true));

    proc.on('error', err => {
      resolve({ success: false, code: null, errorLog: `Spawn Error: ${err.message}` });
    });

    proc.on('close', code => {
      resolve({ success: code === 0, code, errorLog: fullStderr });
    });
  });
}

async function downloadAttempt(jobId, url, outPath, format, useCookies, attemptLabel) {
  log(jobId, `Download attempt ${attemptLabel} (format: ${format}${useCookies ? ', cookies: cookies.txt' : ''})...`);
  return await runYtDlp(jobId, url, outPath, format, useCookies);
}

async function downloadWithRetries(jobId, url, outPath) {
  const formats = ['bv*+ba/b', 'bestvideo+bestaudio/best', 'best'];
  let lastErrorLog = '';

  for (let i = 0; i < formats.length; i++) {
    const format = formats[i];
    const attemptNum = i + 1;

    let result = await downloadAttempt(jobId, url, outPath, format, false, attemptNum);

    if (result.success) {
      log(jobId, 'Download complete');
      return;
    }

    lastErrorLog = result.errorLog;
    log(jobId, `[warn] Attempt ${attemptNum} failed (Code: ${result.code})`);

    if (lastErrorLog.toLowerCase().includes('http error 403') || lastErrorLog.toLowerCase().includes('video unavailable') || lastErrorLog.toLowerCase().includes('sign in')) {
      if (hasValidCookiesFile(COOKIES_PATH)) {
        log(jobId, 'Detected YouTube blocking (403/Sign-in required). Retrying with backend/cookies.txt...');
        result = await downloadAttempt(jobId, url, outPath, format, true, `${attemptNum} (cookies.txt)`);
        if (result.success) {
          log(jobId, 'Download complete (via cookies.txt)');
          return;
        }
        lastErrorLog = result.errorLog;
        log(jobId, `[warn] cookies.txt attempt failed (Code: ${result.code})`);
      } else {
        log(jobId, '[warn] YouTube 403/Sign-in required, and backend/cookies.txt is missing or empty. Please export your YouTube cookies (Netscape format via browser extension like "Get cookies.txt LOCALLY") into backend/cookies.txt to enable authenticated downloads.');
      }
    }
  }

  throw new Error(`yt-dlp failed after all retries.\nLast Error Log:\n${lastErrorLog}`);
}

async function downloadYouTube(jobId, url, outPath) {
  log(jobId, 'Initializing video download...');
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  await downloadWithRetries(jobId, url, outPath);
}

// ═══════════════════════════════════════
//  VIDEO METADATA
// ═══════════════════════════════════════

async function getVideoMetadata(videoPath) {
  const { stdout } = await execAsync(
    `ffprobe -v quiet -print_format json -show_streams -show_format "${videoPath}"`
  );
  const info = JSON.parse(stdout);
  const vs = info.streams.find(s => s.codec_type === 'video') || {};
  const fmt = info.format || {};
  const fpsStr = vs.r_frame_rate || '30/1';
  const fpsParts = fpsStr.split('/');
  const fps = fpsParts.length === 2
    ? parseFloat(fpsParts[0]) / (parseFloat(fpsParts[1]) || 1)
    : parseFloat(fpsStr) || 30;
  return {
    duration: parseFloat(fmt.duration || 0),
    width: vs.width || 1920,
    height: vs.height || 1080,
    fps,
    bitrate: parseInt(fmt.bit_rate || 0),
    codec: vs.codec_name || 'h264',
  };
}

// ═══════════════════════════════════════
//  RENDER EDITED CLIP
// ═══════════════════════════════════════

export async function renderClipWithEdits({ job, clip, subtitles, style, watermark, layout, reframeKeyframes, trimSegments, voiceoverScript, customFraming }) {
  const sourcePath = job.filePath || path.join(UPLOAD_DIR, `${job.id}.mp4`);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Source video file not found at ${sourcePath}`);
  }

  const assContent = generateASS(subtitles, style, job.options || {}, job.language || 'en');
  const clipId = `${job.id}-edited-${clip.index}`;
  const assPath = path.join(OUTPUT_DIR, `${clipId}.ass`);
  fs.writeFileSync(assPath, assContent);

  const outPath = path.join(OUTPUT_DIR, `${clipId}.mp4`);
  safeUnlink(outPath);

  const start = clip.start;
  let duration = clip.end - clip.start;
  if (trimSegments && trimSegments.length > 0) {
    duration = trimSegments.reduce((sum, seg) => sum + (seg.out - seg.in), 0);
  }

  // Voiceover generation removed (ElevenLabs dependency dropped).
  const voiceoverPath = null;

  // Determine reframe mode: explicit layout from editor > job-level option > default
  const reframeMode = layout || (job.options?.reframeMode === 'split-screen' ? 'split-screen' : 'blur-pad');

  const args = buildMasterCommand({
    inputPath: sourcePath,
    outputPath: outPath,
    start,
    duration,
    srtPath: assPath,
    watermark,
    reframeMode,
    reframeKeyframes: Array.isArray(reframeKeyframes) && reframeKeyframes.length > 0 ? reframeKeyframes : null,
    trimSegments,
    voiceoverPath,
    customFraming,
    words: clip.words || []
  });

  log(job.id, `Rendering edited clip ${clip.index} with FFmpeg (layout: ${reframeMode}, keyframes: ${reframeKeyframes?.length || 0})...`);
  await runFFmpegWithProgress(args, duration, job.id, 0, 1);
  log(job.id, `Rendered edited clip ${clip.index} successfully.`);

  safeUnlink(assPath);
  if (voiceoverPath) safeUnlink(voiceoverPath);
  return { url: `/outputs/${clipId}.mp4` };
}

// ═══════════════════════════════════════
//  MAIN PIPELINE
// ═══════════════════════════════════════

export async function processVideo(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job not found');
  const profile = loadProfile();

  try {
    job.status = 'processing';
    let videoPath;

    // ── STEP 1: Download / Get video (0-15%) ──
    if (job.type === 'youtube') {
      log(jobId, 'Fetching video info...');
      const meta = await fetchYouTubeMeta(jobId, job.url);
      job.videoId = meta.id;
      job.videoTitle = meta.title;
      job.videoMeta = meta;
      log(jobId, `Source: "${meta.title || 'Unknown'}"`);

      videoPath = path.join(UPLOAD_DIR, `${jobId}.mp4`);
      await downloadYouTube(jobId, job.url, videoPath);
      job.filePath = videoPath;
    } else {
      videoPath = job.filePath;
      log(jobId, 'Using uploaded file');
      setProgress(jobId, 15);
    }

    // ── STEP 2: Video metadata ──
    const metadata = await getVideoMetadata(videoPath);
    job.metadata = metadata;
    log(jobId, `Video: ${Math.round(metadata.duration)}s, ${metadata.width}x${metadata.height}`);

    // ── STEP 3: Gemini AI analysis + transcription (15-45%) ──
    setProgress(jobId, 15);
    let analysis;

    // Full-video / split-screen mode produces exactly ONE "clip" spanning the
    // entire source video. This flag is reused below to skip the multi-clip
    // padding logic and the per-clip cues/words reassignment block — both of
    // which assume analysis._globalWords/_transcriptData exist (they're only
    // ever populated in the normal multi-clip branch below) and would
    // otherwise silently wipe out the transcript this branch already fetched
    // via transcribeOnly().
    const isFullVideoPass = job.options?.reframeMode === 'split-screen' || job.options?.processFullVideo;

    if (isFullVideoPass) {
      const modeText = job.options?.processFullVideo ? 'Full video mode' : 'Split-screen mode';
      log(jobId, `${modeText} selected. Skipping AI clip extraction, processing full video...`);

      const promises = [
        transcribeVideo(videoPath, jobId, metadata.duration, msg => log(jobId, msg))
          .catch(err => {
            log(jobId, `[warn] Full-video transcription failed: ${err.message}`);
            return { words: [], transcript: '', language: 'unknown' };
          })
      ];

      // If split-screen, also detect framing
      let keyframes = [];
      if (job.options?.reframeMode === 'split-screen') {
        promises.push(
          detectSplitScreenFraming(videoPath, jobId, metadata.duration, msg => log(jobId, msg))
            .then(res => { keyframes = res; })
        );
      }

      const results = await Promise.all(promises);
      const transcriptResult = results[0];

      analysis = {
        clips: [{
          index: 0,
          start: 0,
          end: metadata.duration,
          title: job.videoTitle || 'Full Video',
          why_viral: `Full video processed`,
          category: 'full',
          score: 100,
          reframe: { layout: job.options?.reframeMode || 'vertical', keyframes },
          captionStyle: { style: job.options?.style || 'tiktok', size: 18 },
          trimSegments: [{ in: 0, out: metadata.duration }],
          words: transcriptResult.words,
          transcript: transcriptResult.transcript,
          cues: transcriptResult.cues,
        }],
        video_language: 'unknown',
        overall_energy: 'medium'
      };
    } else {
      let globalWords = [];
      let transcriptText = '';
      let detectedLanguage = 'unknown';

      try {
        log(jobId, 'Transcribing video (Whisper API → Gemini fallback)...');
        const txResult = await transcribeVideo(videoPath, jobId, metadata.duration, msg => log(jobId, msg));
        globalWords = txResult.words || [];
        transcriptText = txResult.transcript || '';
        detectedLanguage = txResult.language || 'unknown';
        log(jobId, `[transcribe] ${txResult.source}: ${globalWords.length} words, lang=${detectedLanguage}`);
      } catch (err) {
        log(jobId, `[warn] Transcription failed: ${err.message}. Continuing without captions.`);
      }

      log(jobId, 'Running Gemini clip analysis...');
      try {
        analysis = await analyzeWithGemini(videoPath, metadata.duration, jobId, profile, job.options, transcriptText, msg => log(jobId, msg));
        if (!analysis?.clips?.length) throw new Error('Gemini returned 0 usable clips');
      } catch (geminiErr) {
        log(jobId, `[warn] Gemini analysis failed (${geminiErr.message}). Using heuristic clip selection...`);
        analysis = {
          clips: heuristicSegments(metadata.duration, Math.min(job.options?.maxClips || 3, 50), job.options?.clipLength || 60),
          video_language: detectedLanguage,
          overall_energy: 'medium',
        };
      }
      if (DEBUG_GEMINI_ANALYSIS && analysis?.clips) {
        logAnalysisScoreSummary(jobId, analysis.clips);
      }

      // Stash for the per-clip word assignment loop below.
      analysis._globalWords = globalWords;
      analysis._detectedLanguage = detectedLanguage;
    }
    setProgress(jobId, 45);

    let clips = analysis.clips;

    const requestedClips = Math.min(job.options?.maxClips || 3, 50);
    // Skip fallback/padding entirely in full-video/split-screen mode. That mode
    // deliberately produces exactly one "clip" covering the whole video — padding
    // it up to requestedClips (default 3) with unrelated heuristic segments was
    // a bug (it used to silently turn a single full-video render into 3 unrelated
    // sub-clips), not a feature.
    if (!isFullVideoPass) {
      if (!clips.length) {
        log(jobId, 'No valid clips — using heuristic fallback');
        clips = heuristicSegments(metadata.duration, requestedClips, job.options?.clipLength || 60);
      } else if (clips.length < requestedClips) {
        log(jobId, `Gemini only found ${clips.length} clips (requested ${requestedClips}). Padding with heuristic segments...`);
        const extra = heuristicSegments(metadata.duration, requestedClips, job.options?.clipLength || 60);
        for (const h of extra) {
          if (clips.length >= requestedClips) break;
          const overlap = clips.some(c => (h.start < c.end && h.end > c.start));
          if (!overlap) clips.push({ ...h, index: clips.length });
        }
      }
    }

    // Assign words and cues to ALL clips — Gemini's and heuristic ones alike.
    // This is the actual fix: previously this only ran on analysis.clips
    // *before* heuristic padding existed, so padded/fallback clips never
    // got captions.
    //
    // Full-video/split-screen mode is skipped here on purpose: analysis._globalWords
    // and analysis._transcriptData are only ever populated in the normal
    // multi-clip branch above. Running this block unconditionally used to
    // silently overwrite the words/cues/transcript that transcribeOnly() already
    // produced for that mode — globalWords defaulted to `[]`, so every clip's
    // words got filtered down to nothing and clip.cues/words/transcript ended
    // up empty even though the transcript had already been fetched.
    if (!isFullVideoPass) {
      const globalWords = analysis._globalWords || [];

      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];

        if (job.options?.language === 'none') {
          clip.cues = [];
          clip.words = [];
          clip.transcript = '';
          continue;
        }

        // Filter global words to this clip's time range (absolute video time)
        const clipWords = globalWords.filter(w => w.t >= clip.start - 0.5 && (w.end ?? w.t + 0.3) <= clip.end + 0.5);

        if (!clipWords.length) {
          log(jobId, `[warn] Clip ${clip.index + 1} (${clip.start.toFixed(1)}s-${clip.end.toFixed(1)}s): no transcript words matched.`);
        }

        // Attach absolute-time words; captionEngine normalizes to clip-relative internally
        clip.words = clipWords;
        clip.cues = await buildClipCuesWithSTT(clip, videoPath, 'auto', msg => log(jobId, msg));
        clip.transcript = clipWords.map(w => w.word).join(' ');
      }

      delete analysis._globalWords;
      delete analysis._detectedLanguage;
    }

    job.clips = clips.map(c => {
      // If a clip made it this far without cues (e.g. heuristic fallback), generate fallback cues
      if (!c.cues || c.cues.length === 0) {
        c.cues = buildClipCues(c, job.options || {});
      }

      // -- QUALITY GATE --
      if (c.cues && c.cues.length > 0) {
        const quality = scoreSubtitles(c.cues, c.end - c.start);
        if (quality.score < 80) {
          log(jobId, `⚠️ Clip ${c.index + 1} subtitle quality warning (Score: ${quality.score}): ${quality.issues.join(' | ')}`);
        }
      }

      return {
        ...c,
        approved: true, // Default to true
        customFraming: { index: c.index } // Auto-approve with defaults
      };
    });

    // Add relative video URL for frontend preview
    job.videoUrl = `/uploads/${path.basename(videoPath)}`;

    job.progress = 50;
    log(jobId, `✅ Analysis complete! ${clips.length} clips found. Rendering automatically...`);

    const finalClips = await processClipsParallel(job.clips, job.filePath, jobId, profile, job.options || {});

    job.clips = finalClips;
    job.progress = 100;

    if (finalClips.length > 0) {
      job.status = 'completed';
      log(jobId, `✅ Done! Rendered ${finalClips.length} clips for "${job.videoTitle || job.url || 'upload'}".`);

      if (job.options?.compilation) {
        log(jobId, 'Compilation mode enabled. Stitching clips...');
        const concatListPath = path.join(OUTPUT_DIR, `${jobId}_concat.txt`);
        const compilationFilename = `${jobId}_compilation.mp4`;
        const compilationPath = path.join(OUTPUT_DIR, compilationFilename);
        
        let concatText = '';
        for (const clip of finalClips) {
          if (clip && clip.filename) {
            const absolutePath = path.join(OUTPUT_DIR, clip.filename).replace(/\\/g, '/');
            concatText += `file '${absolutePath}'\n`;
          }
        }
        
        fs.writeFileSync(concatListPath, concatText);
        
        try {
          // -c copy is fast and lossless, works because all clips share exact same encode params
          await execAsync(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${compilationPath}"`);
          log(jobId, `✅ Compilation created successfully: ${compilationFilename}`);
          job.compilationUrl = `/outputs/${compilationFilename}`;
        } catch (err) {
          log(jobId, `[error] Compilation stitching failed: ${err.message}`);
        } finally {
          try { fs.unlinkSync(concatListPath); } catch(e) {}
        }
      }
    } else {
      job.status = 'failed';
      job.error = `All ${clips.length} clips failed to process. Check logs for FFmpeg errors.`;
      log(jobId, `❌ All clips failed.`);
    }

  } catch (err) {
    job.error = err.stack || err.message || String(err);
    job.status = 'failed';
    log(jobId, `[FATAL] ${job.error}`);
    throw err;
  }
}

// ═══════════════════════════════════════
//  PHASE 2: RENDER APPROVED CLIPS
// ═══════════════════════════════════════

export async function renderJobClips(jobId, approvedClipsConfig) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job not found');
  const profile = loadProfile();

  try {
    job.status = 'processing';
    log(jobId, `Starting render phase for ${approvedClipsConfig.length} approved clips...`);

    // Map the user configs back to the original clips
    const clipsToRender = [];
    // Kept in lockstep with clipsToRender so index i always refers to the same
    // clip in both arrays. Previously the code below indexed straight into
    // approvedClipsConfig[i], which silently drifted out of sync with
    // clipsToRender[i] any time a config's clip lookup was skipped (e.g. a
    // stale/out-of-range config.index) — every config after the gap ended up
    // paired with the wrong clip, so custom crop regions could get applied
    // to a different clip than the one the user actually edited.
    const matchedConfigs = [];
    for (const config of approvedClipsConfig) {
      const origClip = job.clips[config.index];
      if (origClip) {
        // Merge in the user's framing choices and edited subtitles
        const renderClip = { ...origClip };
        if (config.subtitles) {
          renderClip.cues = config.subtitles;
        } else if (config.cues) {
          renderClip.cues = config.cues;
        }
        // We can pass the layout/regions down in job options or directly on the clip
        // For now, let's just use the job options reframeMode or per-clip reframe config
        clipsToRender.push(renderClip);
        matchedConfigs.push(config);
      } else {
        log(jobId, `[warn] Approved clip config referenced clip index ${config.index}, which no longer exists on this job — skipping`);
      }
    }

    if (!clipsToRender.length) {
      throw new Error('No valid clips selected for rendering');
    }

    const processOptions = job.options ? { ...job.options } : {};

    // We need to pass the framing configs down to processClip
    // The easiest way is to attach it to each clip object so processClip can read it
    for (let i = 0; i < clipsToRender.length; i++) {
      const config = matchedConfigs[i];
      // Only treat this as custom framing if the user actually drew a region.
      // framingConfig defaults to { mode: 'vertical', regions: [] } — an empty
      // array is truthy, so this used to silently win over reframeMode /
      // reframeKeyframes even when nobody touched the crop handles.
      if (config?.regions && config.regions.length > 0) {
        clipsToRender[i].customFraming = config;
      }
    }

    const finalClips = await processClipsParallel(clipsToRender, job.filePath, jobId, profile, processOptions);

    job.clips = finalClips; // Overwrite with finished clips containing URLs
    job.progress = 100;

    if (finalClips.length > 0) {
      job.status = 'completed';
      log(jobId, `✅ Done! Rendered ${finalClips.length} clips for "${job.videoTitle || job.url || 'upload'}".`);
    } else {
      job.status = 'failed';
      job.error = `All ${clipsToRender.length} clips failed to process. Check logs for FFmpeg errors.`;
      log(jobId, `❌ All clips failed.`);
    }

  } catch (err) {
    job.error = err.stack || err.message || String(err);
    job.status = 'failed';
    log(jobId, `[FATAL] ${job.error}`);
    throw err;
  }
}

// ═══════════════════════════════════════
//  REFRAME CLIP (Custom Crop Export)
// ═══════════════════════════════════════

/**
 * Re-render a clip with custom crop coordinates from the Clipzi-style editor.
 * Called by POST /api/reframe/:jobId/:clipIndex
 *
 * @param {string} jobId         Job ID
 * @param {number} clipIndex     Clip index within the job
 * @param {Object} cropConfig    { mode, regions: [...], outputWidth, outputHeight }
 * @returns {{ success: boolean, url: string }}
 */
export async function reframeClip(jobId, clipIndex, cropConfig) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Job not found');

  const clip = job.clips?.[clipIndex];
  if (!clip) throw new Error(`Clip ${clipIndex} not found in job`);

  // Resolve source video path
  const sourcePath = job.filePath || path.join(UPLOAD_DIR, `${jobId}.mp4`);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source video not found at ${sourcePath}`);
  }

  const { mode, regions, outputWidth = 1080, outputHeight = 1920 } = cropConfig;
  if (!regions || !regions.length) {
    throw new Error('No crop regions provided');
  }

  // Build the FFmpeg filter graph
  const { filters, mapLabel } = buildCustomCropFilter(mode, regions, outputWidth, outputHeight);
  const filterStr = filters.join(';');

  const outputFilename = `${jobId}_clip${clipIndex + 1}_reframed.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputFilename);
  safeUnlink(outputPath);

  // Get clip duration for progress tracking
  const duration = clip.duration || (clip.end - clip.start) || 30;

  // We MUST process from the original video so we have the full 16:9 frame.
  const inputPath = sourcePath;

  const args = [
    '-y',
    '-ss', String(clip.start),
    '-t', String(duration),
    '-i', inputPath,
    '-filter_complex', filterStr,
    '-map', `[${mapLabel}]`,
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    outputPath,
  ];

  log(jobId, `Reframing clip ${clipIndex + 1} with custom crop (mode: ${mode}, ${regions.length} regions)...`);

  try {
    await runFFmpegWithProgress(args, duration, jobId, 0, 1);
  } catch (err) {
    log(jobId, `[error] Reframe failed: ${err.message.split('\n')[0]}`);
    safeUnlink(outputPath);
    throw new Error(`FFmpeg reframe failed: ${err.message}`);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('Reframed output file missing after FFmpeg');
  }

  const stats = fs.statSync(outputPath);
  log(jobId, `✅ Reframed clip ${clipIndex + 1} (${(stats.size / 1048576).toFixed(1)} MB)`);

  return {
    success: true,
    url: `/outputs/${outputFilename}`,
    size: stats.size,
  };
}