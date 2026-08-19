/**
 * Atlantic AI — Single Gemini Pipeline
 *
 * One gemini-2.5-flash call does BOTH:
 *   - clip analysis (best moments, virality scores, hooks, categories, thumbnails)
 *   - word-by-word transcription with absolute timestamps for every clip
 *
 * This replaces the old dual-model pipeline (analysis + separate per-clip
 * transcription calls). The dual pipeline was hitting 429 quota errors on
 * almost every transcription call because it burned through the free-tier
 * per-minute token quota with Model 1, then immediately tried to burn it
 * again with 3 sequential Model 2 calls. When those calls failed, the code
 * fell back to `clip.words || []` — which is empty, since Model 1 never
 * produced words. So the dual pipeline wasn't even producing better
 * transcription than a single pass; it was mostly producing 429 retries
 * and ~3+ minutes of wasted wait time, and often ended up with no words
 * captured at all in the fallback case.
 *
 * One call, one upload, one quota hit. Simpler and cheaper.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { buildClipCues } from './captionEngine.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const DEBUG_GEMINI_ANALYSIS = process.env.DEBUG_GEMINI_ANALYSIS === '1';
const DEBUG_ANALYSIS_DIR = path.join(__dirname, '../outputs/debug');

function makeDebugDumpPath(videoPath, jobId, suffix) {
  const safeVideoName = path.basename(videoPath)
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(DEBUG_ANALYSIS_DIR, `analysis-${safeVideoName}-${jobId.slice(0, 8)}-${timestamp}${suffix}`);
}

function writeGeminiAnalysisTextDump(rawText, videoPath, jobId) {
  if (!DEBUG_GEMINI_ANALYSIS) return null;
  try {
    fs.mkdirSync(DEBUG_ANALYSIS_DIR, { recursive: true });
    const dumpPath = makeDebugDumpPath(videoPath, jobId, '-raw.txt');
    fs.writeFileSync(dumpPath, String(rawText), 'utf8');
    return dumpPath;
  } catch (err) {
    console.warn(`[debug] Failed to write Gemini raw response dump: ${err.message}`);
    return null;
  }
}

function writeGeminiAnalysisJsonDump(analysisJson, videoPath, jobId) {
  if (!DEBUG_GEMINI_ANALYSIS) return null;
  try {
    fs.mkdirSync(DEBUG_ANALYSIS_DIR, { recursive: true });
    const dumpPath = makeDebugDumpPath(videoPath, jobId, '-parsed.json');
    fs.writeFileSync(dumpPath, JSON.stringify(analysisJson, null, 2), 'utf8');
    return dumpPath;
  } catch (err) {
    console.warn(`[debug] Failed to write Gemini analysis dump: ${err.message}`);
    return null;
  }
}

/**
 * Repairs a JSON string cut off mid-output (e.g. by maxOutputTokens).
 * Finds the last comma that directly follows a closed `}` or `]` — i.e. the
 * boundary right after a complete array element — trims there, and closes
 * whatever structures were still open at that point.
 *
 * Returns the repaired string, or null if nothing could be salvaged.
 * Call JSON.parse() on the result yourself.
 */
function repairTruncatedJSON(text) {
  const stack = [];
  let inString = false;
  let escaped = false;
  let lastNonSpace = '';
  let lastSafeCut = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
    else if (ch === ',' && (lastNonSpace === '}' || lastNonSpace === ']')) {
      lastSafeCut = i;
    }

    if (!/\s/.test(ch)) lastNonSpace = ch;
  }

  if (stack.length === 0) return text;   // wasn't actually truncated
  if (lastSafeCut === -1) return null;   // nothing complete enough to salvage

  // Replay up to the cut point to know exactly what's still open there
  const openAtCut = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < lastSafeCut; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') openAtCut.push(ch);
    else if (ch === '}' || ch === ']') openAtCut.pop();
  }

  const closers = openAtCut.reverse().map(o => (o === '{' ? '}' : ']')).join('');
  return text.slice(0, lastSafeCut) + closers;
}

// ─────────────────────────────────────────────
//  Model config
// ─────────────────────────────────────────────
const ANALYSIS_MODEL = 'gemini-2.5-flash'; // finds best moments AND transcribes them

// ─────────────────────────────────────────────
//  Proxy video for Gemini (reduce token costs)
// ─────────────────────────────────────────────
async function createAnalysisProxy(inputPath, suffix = '_proxy') {
  const proxyPath = inputPath.replace(/\.[^/.]+$/, `${suffix}.mp4`);
  // 640x360 @ 10fps — Bumping resolution/framerate to improve multimodal action/loudness detection
  const cmd = [
    'ffmpeg', '-y',
    '-i', `"${inputPath}"`,
    '-vf', 'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2',
    '-r', '10',
    '-threads', '0',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '38', '-b:v', '150k',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '1', '-ar', '44100',
    '-movflags', '+faststart',
    `"${proxyPath}"`
  ].join(' ');
  await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
  return proxyPath;
}

// ─────────────────────────────────────────────
//  Files API helpers
// ─────────────────────────────────────────────
async function waitForFileActive(fileManager, uploadedFile, maxWaitMs = 300_000, logFn) {
  const start = Date.now();
  let delay = 5000;
  let file = uploadedFile;
  while (Date.now() - start < maxWaitMs) {
    file = await fileManager.getFile(uploadedFile.name);
    if (file.state === 'ACTIVE') return file;
    if (file.state === 'FAILED') throw new Error(`Gemini file processing failed: ${file.name}`);
    logFn(`[gemini] File state: ${file.state}. Waiting ${delay / 1000}s...`);
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 30_000);
  }
  throw new Error('Gemini file took too long to become ACTIVE.');
}

// Parse the "retryDelay":"11s" field Gemini sends back in 429 responses
function parseRetryDelay(errMessage) {
  const m = errMessage?.match(/"retryDelay":"(\d+)s"/);
  return m ? parseInt(m[1]) * 1000 : null;
}

async function generateWithRetry(model, content, maxRetries = 5, logFn) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(content, { timeout: 1200000 });
    } catch (err) {
      const is429 = err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('exceeded');
      if (is429 && attempt < maxRetries) {
        // Use the delay the API tells us to wait, minimum 65s (one full quota minute + buffer)
        const apiDelay = parseRetryDelay(err.message) || 0;
        const waitMs = Math.max(apiDelay + 5_000, 65_000);
        logFn(`[gemini] 429 quota hit. Waiting ${Math.round(waitMs / 1000)}s for quota reset (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

// ─────────────────────────────────────────────
//  Combined analysis + transcription prompt
// ─────────────────────────────────────────────
const DEFAULT_PROFILE = {
  name: 'Creator', content_type: 'gaming', audience_age: '13-25',
  style: 'energetic', clip_style: 'start with action not buildup',
  avoid: 'slow sections, long talking, boring intros', language: 'auto',
  example_hooks: ["You won't believe what happened next...", 'This is insane...', 'Wait for it...'],
};

function buildAnalysisPrompt(profile, numClips, clipLength, videoDuration, transcriptText = '') {
  const p = { ...DEFAULT_PROFILE, ...profile };
  return `You are an expert viral video editor working for a ${p.content_type} creator targeting ${p.audience_age} year olds with a ${p.style} style.
Think of Indian gaming/content creators like CarryMinati, Mythpat, GamerFleet, Scout, Mortal, Triggered Insaan.

CREATOR PREFERENCES:
- Clip style: ${p.clip_style}
- Avoid: ${p.avoid}
- Example hooks they like: ${(p.example_hooks || []).join(', ')}

Watch this entire video carefully (duration: ${Math.round(videoDuration)} seconds). Find the ${numClips} best moments for YouTube Shorts/Reels.

Here is the full transcript of the video for your reference:
=== TRANSCRIPT ===
${transcriptText}
=== END TRANSCRIPT ===

CLIP SELECTION RULES:
- Each clip 30-${clipLength} seconds
- IMPORTANT: The video is ${Math.round(videoDuration)}s long. DO NOT select clips that start after ${Math.round(videoDuration)}s or end after ${Math.round(videoDuration)}s!
- ALWAYS start at a moment of action, emotion, or surprise — never in the middle of buildup
- NEVER overlap clips
- CRITICAL: Prioritize the LOUDEST, MOST REACTIVE, and HIGHEST ENERGY moments over general topical relevance. If there is screaming, loud laughter, or sudden loud noises, that is a better clip than a calm explanation.
- For GAMING content prioritize: clutch moments, insane plays, rage/funny reactions, headshots, squad wipes, unexpected kills, 200 IQ plays, epic fails
- For GENERAL content prioritize: high energy moments, emotional peaks, surprising reveals, funny reactions
- Avoid: slow intros, long pauses, technical explanations unless they build to a punchline
- Titles should sound like Indian creator hooks: energetic, meme-worthy, Hinglish if the video is in Hindi/Hinglish
  Examples: "Bhai WHAT Just Happened?!", "100 IQ Clutch Play", "Ye Banda Hacker Hai"

Return ONLY this exact JSON (no markdown, no explanation):
{
  "clips": [
    {
      "start": 12.5,
      "end": 75.0,
      "title": "Punchy title max 6 words",
      "hook": "Opening line that grabs attention in 2 seconds",
      "why_viral": "One sentence on virality potential",
      "virality_score": 87,
      "has_face": true,
      "face_position": "top-left",
      "emotion": "excited",
      "category": "clutch",
      "suggested_caption_style": "tiktok",
      "best_thumbnail_second": 5.0,
      "has_music": false
    }
  ],
  "video_language": "en",
  "overall_energy": "high"
}`;
}

function buildTranscriptionPrompt() {
  return `You are an expert transcriptionist AND an Indian gaming/content creator caption writer.
Watch this entire video carefully. Transcribe every spoken word in the video, word-by-word, from start to finish.

WORD TRANSCRIPTION RULES:
- "t" must be the absolute timestamp in seconds relative to the very beginning of the video (0.0).
- "t" values MUST be accurate to within 0.3 seconds of when the word is actually spoken. Listen carefully and place each timestamp precisely at the moment each word begins.
- ALWAYS transcribe using English (Roman) script ONLY. NEVER use Devanagari or any non-Latin script.
- For Hindi/Hinglish content: write exactly how Indian creators speak. Use natural Hinglish.
  Examples: "bhai sach mein" NOT "भाई सच में", "yaar ye toh OP hai" NOT "यार ये तो ओपी है"
- Include every spoken word verbatim, in order.
- CRITICAL: Only transcribe the PRIMARY SPEAKER — the main content creator or narrator. Do NOT transcribe:
  * Background music or song lyrics — these are NOT speech, do NOT include them
  * Singing voices in background songs — this is music, NOT the primary speaker
  * Game audio, in-game character dialogue, or announcer voices
  * Other people talking in the background or in a crowd
  * Sound effects, notification sounds, or ambient noise
  * Text-to-speech or automated voices from apps/games
  * Co-commentators or casters that are NOT the primary speaker
  If unsure whether a voice is the primary speaker, SKIP it.
- Do not summarize, skip words, add punctuation, or use filler tags like "[music]".
- If a section has ONLY music/songs playing and NO primary speaker talking, do NOT output any words for that time range.

INDIAN GAMING CREATOR CAPTION STYLE:
Think of how creators like CarryMinati, Mythpat, GamerFleet, Scout, Mortal, Triggered Insaan speak.
- Use natural Hinglish — NOT formal Hindi, NOT textbook Hindi, NOT robotic translated Hindi.
- Keep common filler words exactly as spoken: bro, bhai, yaar, arre, abe, oh bhai, matlab, bas, like, actually, seriously, literally
- NEVER translate gaming vocabulary. Keep these words in English exactly:
  Headshot, Revive, Knock, Clutch, Reload, Camping, Push, Rush, Loot, Scope, Aim, Spray, Lag, Ping, Buff, Nerf, Zone, Rank, OP, GG, noob, pro, squad, rush, rotate, drop, loot, circle, safe zone
- Keep reactions exactly as spoken: "Bhai WHAT?!", "No way!", "Ye toh free kill tha", "100 IQ play"
- Keep swear words exactly as spoken — do NOT censor.
- Capitalize important English emphasis words: NO WAY, BRO, INSANE, OP, WHAT, 100%

Return ONLY this exact JSON (no markdown, no explanation):
{
  "video_language": "en",
  "words": [
    { "word": "hello", "t": 0.3 },
    { "word": "there", "t": 0.6 }
  ]
}`;
}

// ─────────────────────────────────────────────
//  MIME type helper
// ─────────────────────────────────────────────
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
    '.avi': 'video/x-msvideo', '.mov': 'video/quicktime'
  }[ext] || 'video/mp4';
}

// ─────────────────────────────────────────────
//  MAIN EXPORT — Single-model analysis + transcription
// ─────────────────────────────────────────────
export async function analyzeWithGemini(videoPath, duration, jobId, profile = {}, options = {}, transcriptText = '', logFn = console.log) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing from backend/.env');
  logFn('[gemini] API key looks valid, starts with: ' + apiKey.substring(0, 8));

  const numClips = Math.min(options.maxClips || 3, 50);
  const clipLength = options.clipLength || 90;

  const genAI = new GoogleGenerativeAI(apiKey);
  const fileManager = new GoogleAIFileManager(apiKey);

  // ── 1. Create proxy & upload ONCE ──
  let proxyPath = null;
  let uploadedFile = null;
  let file = null;

  try {
    logFn('[gemini] Creating analysis proxy...');
    proxyPath = await createAnalysisProxy(videoPath);
    logFn(`[gemini] Proxy: ${(fs.statSync(proxyPath).size / 1048576).toFixed(1)} MB`);

    logFn('[gemini] Uploading to Files API...');
    const uploadResult = await fileManager.uploadFile(proxyPath, {
      mimeType: 'video/mp4',
      displayName: path.basename(proxyPath),
    });
    uploadedFile = uploadResult.file;

    logFn('[gemini] Waiting for ACTIVE state...');
    file = await waitForFileActive(fileManager, uploadedFile, 300_000, logFn);
    logFn(`[gemini] File ACTIVE: ${file.uri}`);

    // ── 2. Single combined call: clips + words ──
    logFn(`[gemini] Model (${ANALYSIS_MODEL}): finding best clips + transcribing...`);
    const analysisModel = genAI.getGenerativeModel({
      model: ANALYSIS_MODEL,
      generationConfig: {
        maxOutputTokens: 65536, // gemini-2.5-flash supports up to 65,536 — the default 8,192 was causing truncation
        // gemini-2.5-flash spends part of maxOutputTokens on internal "thinking"
        // tokens before writing the visible answer. For a structured JSON
        // extraction task we don't need reasoning, and leaving thinking on
        // was starving the actual output — responses were getting cut off
        // mid-JSON (e.g. 850 chars in, mid-string) well before hitting the
        // token cap. Setting thinkingBudget to 0 disables thinking mode so
        // the full token budget goes to the real answer.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const analysisResult = await generateWithRetry(
      analysisModel,
      [{ fileData: { fileUri: file.uri, mimeType: 'video/mp4' } },
      { text: buildAnalysisPrompt(profile, numClips, clipLength, duration, transcriptText) }],
      3,
      logFn
    );
    const analysisText = analysisResult.response.text();
    const rawDumpPath = writeGeminiAnalysisTextDump(analysisText, videoPath, jobId);
    if (rawDumpPath) {
      logFn(`[debug] Gemini raw analysis response dumped to ${rawDumpPath}`);
    }
    const finishReason = analysisResult.response.candidates?.[0]?.finishReason || 'unknown';
    logFn(`[gemini] Analysis response length: ${analysisText.length} | finishReason: ${finishReason}`);
    if (finishReason === 'MAX_TOKENS') {
      logFn(`[gemini] WARNING: response was cut off by maxOutputTokens — JSON is likely incomplete. Consider raising maxOutputTokens or reducing numClips.`);
    }

    // ── 3. Parse ──
    let analysis;
    try {
      analysis = JSON.parse(analysisText);
    } catch {
      const cleaned = analysisText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```[\s\S]*$/i, '').trim();
      try {
        analysis = JSON.parse(cleaned);
      } catch {
        const repaired = repairTruncatedJSON(cleaned);
        if (repaired) {
          analysis = JSON.parse(repaired);
          logFn(`[gemini] WARNING: response was truncated (finishReason: ${finishReason}). Recovered a partial result — some clips/words near the end of the video may be missing.`);
        } else {
          throw new Error(`Failed to parse analysis JSON (finishReason: ${finishReason}, length: ${analysisText.length}). Raw tail: ${analysisText.slice(-200)}`);
        }
      }
    }

    const parsedDumpPath = writeGeminiAnalysisJsonDump(analysis, videoPath, jobId);
    if (parsedDumpPath) {
      logFn(`[debug] Gemini parsed analysis JSON dumped to ${parsedDumpPath}`);
    }

    let clips = (analysis.clips || []).map((c, i) => {
      const start = Math.max(0, Math.min(duration - 10, parseFloat(c.start) || 0));
      const end = Math.max(start + 10, Math.min(duration, parseFloat(c.end) || (start + 60)));
      const words = (c.words || [])
        .filter(w => w && typeof w.word === 'string' && (typeof w.t === 'number' || typeof w.t === 'string'))
        // Gemini gives "t" as clip-relative (0 = clip start); convert to absolute
        // video time here in code, rather than relying on the model to do the
        // addition itself. Doing the math ourselves means it's always exact.
        .map(w => {
          let tVal = parseFloat(w.t);
          if (isNaN(tVal)) tVal = 0;
          return { word: w.word.trim(), t: start + tVal };
        })
        .filter(w => w.word.length > 0 && w.t >= start - 1 && w.t <= end + 5)
        .sort((a, b) => a.t - b.t);
      const transcript = words.map(w => w.word).join(' ');

      return {
        index: i,
        start,
        end,
        title: c.title || `Clip ${i + 1}`,
        hook: c.hook || c.title || 'Check this out!',
        why_viral: c.why_viral || '',
        score: Math.min(100, Math.max(0, parseInt(c.virality_score) || 70)),
        words: [], // No longer filled by Gemini
        transcript: '',
        cues: [], // filled in later
        has_face: c.has_face ?? false,
        has_music: c.has_music ?? false,
        face_position: c.face_position || 'none',
        emotion: c.emotion || 'neutral',
        category: c.category || 'reaction',
        suggested_caption_style: c.suggested_caption_style || 'tiktok',
        best_thumbnail_second: parseFloat(c.best_thumbnail_second) || 3,
      };
    });

    // Filter obviously bad clips
    const preFilterCount = clips.length;
    clips = clips.filter(c => c.end > c.start + 10);
    const postFilter10 = clips.length;

    // ── 4. Removed legacy cue building (handled in processor.js) ──

    // ── 5. Dedupe & sort ──
    clips = clips.filter(c => c.end > c.start + 15).sort((a, b) => a.start - b.start);
    const postFilter15 = clips.length;
    const deduped = [];
    for (const c of clips) {
      const last = deduped[deduped.length - 1];
      if (!last || c.start >= last.end) deduped.push(c);
      else if ((c.score || 0) > (last.score || 0)) deduped[deduped.length - 1] = c;
    }
    clips = deduped.map((c, i) => ({ ...c, index: i }));

    // Debug: if we ended up with 0 clips, log the full raw response and filter funnel
    if (clips.length === 0) {
      logFn(`[gemini] WARNING: 0 clips after filtering. Funnel: parsed=${preFilterCount} → >10s=${postFilter10} → >15s=${postFilter15} → deduped=${clips.length}`);
      logFn(`[gemini] Raw Gemini analysis response (${analysisText.length} chars):\n${analysisText}`);
      if (preFilterCount > 0) {
        const rawClips = (analysis.clips || []).map(c => ({ start: c.start, end: c.end, title: c.title, duration: ((parseFloat(c.end) || 0) - (parseFloat(c.start) || 0)).toFixed(1) + 's' }));
        logFn(`[gemini] Raw clip boundaries: ${JSON.stringify(rawClips)}`);
      }
    }

    logFn(`[gemini] Done — ${clips.length} clips | lang: ${analysis.video_language || '?'} | energy: ${analysis.overall_energy || '?'}`);

    return {
      clips,
      video_language: analysis?.video_language || 'unknown',
      overall_energy: analysis?.overall_energy || 'medium',
    };
  } finally {
    // Cleanup
    if (proxyPath && fs.existsSync(proxyPath)) {
      try { fs.unlinkSync(proxyPath); } catch (e) { logFn('[gemini] Failed to delete proxy: ' + e.message); }
    }
    if (uploadedFile) {
      logFn('[gemini] Cleaning up remote file...');
      try { await fileManager.deleteFile(uploadedFile.name); } catch (e) { logFn('[gemini] Failed to delete remote file: ' + e.message); }
    }
  }
}

// ─────────────────────────────────────────────
//  Full-Video Transcription (Split-screen bypass)
//
//  For short videos (≤8 min): single Gemini call on the full proxy.
//  For long videos (>8 min) or when the single call truncates: split
//  into sequential ~4 min audio chunks, transcribe each separately,
//  and merge the word arrays with time-offset adjustment.
// ─────────────────────────────────────────────
const CHUNK_DURATION_SEC = 240; // 4-minute chunks — well under 65k token ceiling per chunk
const CHUNK_OVERLAP_SEC = 3;   // small overlap so words at boundaries aren't lost
const LONG_VIDEO_THRESHOLD_SEC = 480; // 8 minutes — beyond this, go straight to chunked

/**
 * Transcribe a single audio chunk via Gemini. Returns raw word array.
 * Caller is responsible for proxy/upload cleanup (via the returned handles).
 */
async function transcribeSingleChunk(videoPath, chunkStart, chunkDuration, chunkIndex, genAI, fileManager, logFn) {
  const suffix = `_chunk${chunkIndex}`;
  // Extract audio-only segment — much smaller than video, faster upload
  const chunkPath = videoPath.replace(/\.[^/.]+$/, `${suffix}.aac`);

  try {
    const cmd = [
      'ffmpeg', '-y',
      '-i', `"${videoPath}"`,
      '-ss', String(Math.max(0, chunkStart)),
      '-t', String(chunkDuration),
      '-vn', '-acodec', 'aac', '-b:a', '96k', '-ac', '1', '-ar', '44100',
      `"${chunkPath}"`
    ].join(' ');
    await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });

    const uploadResult = await fileManager.uploadFile(chunkPath, {
      mimeType: 'audio/aac',
      displayName: `chunk_${chunkIndex}.aac`,
    });
    const uploadedFile = uploadResult.file;

    try {
      const file = await waitForFileActive(fileManager, uploadedFile, 300_000, logFn);

      const model = genAI.getGenerativeModel({
        model: ANALYSIS_MODEL,
        generationConfig: {
          maxOutputTokens: 65536,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      let lastError = null;
      let rawText = '';

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (attempt > 1) {
            logFn(`[gemini-transcribe] Chunk ${chunkIndex} retrying (attempt ${attempt}/2)...`);
          }
          const result = await generateWithRetry(
            model,
            [{ fileData: { fileUri: file.uri, mimeType: 'audio/aac' } }, { text: buildTranscriptionPrompt() }],
            3,
            logFn
          );

          rawText = result.response.text();
          const finishReason = result.response.candidates?.[0]?.finishReason || 'unknown';
          
          const cleanedText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```[\s\S]*$/i, '').trim();
          
          let data;
          try {
            data = JSON.parse(cleanedText);
          } catch (parseErr) {
            const repaired = repairTruncatedJSON(cleanedText);
            if (repaired) {
              data = JSON.parse(repaired);
              logFn(`[gemini-transcribe] Chunk ${chunkIndex}: recovered truncated JSON (finishReason: ${finishReason})`);
            } else {
              throw new Error(`JSON parse failed: ${parseErr.message}`);
            }
          }

          logFn(`[gemini-transcribe] Chunk ${chunkIndex}: ${rawText.length} chars | finishReason: ${finishReason}`);
          return (data.words || [])
            .filter(w => w && typeof w.word === 'string' && typeof w.t === 'number')
            .map(w => ({ word: w.word.trim(), t: chunkStart + parseFloat(w.t) }))
            .filter(w => w.word.length > 0);

        } catch (err) {
          lastError = err;
          logFn(`[gemini-transcribe] Chunk ${chunkIndex} attempt ${attempt} error: ${err.message}`);
        }
      }

      const tail = rawText ? rawText.slice(-200).replace(/\n/g, '\\n') : 'No output';
      logFn(`[gemini-transcribe] ERROR: Chunk ${chunkIndex} failed after 2 attempts. Raw tail: ${tail}`);
      return [];

    } finally {
      try { await fileManager.deleteFile(uploadedFile.name); } catch { }
    }
  } finally {
    if (fs.existsSync(chunkPath)) {
      try { fs.unlinkSync(chunkPath); } catch { }
    }
  }
}

/**
 * Chunked transcription: split the video into sequential ~4 min segments,
 * transcribe each via Gemini, and merge word arrays.
 */
async function transcribeChunked(videoPath, duration, genAI, fileManager, logFn) {
  const chunks = [];
  for (let t = 0; t < duration; t += CHUNK_DURATION_SEC - CHUNK_OVERLAP_SEC) {
    const chunkDur = Math.min(CHUNK_DURATION_SEC, duration - t);
    if (chunkDur < 2) break; // skip tiny tail
    chunks.push({ start: t, duration: chunkDur, index: chunks.length });
  }

  logFn(`[gemini-transcribe] Chunked mode: ${chunks.length} chunks of ~${CHUNK_DURATION_SEC}s each`);

  const allWords = [];
  for (const chunk of chunks) {
    logFn(`[gemini-transcribe] Transcribing chunk ${chunk.index + 1}/${chunks.length} (${chunk.start.toFixed(0)}s – ${(chunk.start + chunk.duration).toFixed(0)}s)...`);
    try {
      const words = await transcribeSingleChunk(
        videoPath, chunk.start, chunk.duration, chunk.index, genAI, fileManager, logFn
      );
      allWords.push(...words);
      logFn(`[gemini-transcribe] Chunk ${chunk.index + 1}: ${words.length} words`);
    } catch (err) {
      logFn(`[gemini-transcribe] ERROR: Chunk ${chunk.index + 1} failed completely: ${err.message}. Continuing with next chunk...`);
    }
  }

  // Dedupe words from overlapping regions: if two words have the same text
  // and timestamps within 0.5s, keep only the first occurrence
  const deduped = [];
  for (const w of allWords) {
    const dup = deduped.find(d => d.word === w.word && Math.abs(d.t - w.t) < 0.5);
    if (!dup) deduped.push(w);
  }

  return deduped.sort((a, b) => a.t - b.t);
}

export async function transcribeOnly(videoPath, jobId, duration, options = {}, logFn = console.log) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing from backend/.env');

  const genAI = new GoogleGenerativeAI(apiKey);
  const fileManager = new GoogleAIFileManager(apiKey);

  // ── Long videos: go straight to chunked transcription ──
  if (duration > LONG_VIDEO_THRESHOLD_SEC) {
    logFn(`[gemini-transcribe] Video is ${Math.round(duration)}s (>${LONG_VIDEO_THRESHOLD_SEC}s) — using chunked transcription`);
    const words = await transcribeChunked(videoPath, duration, genAI, fileManager, logFn);
    const transcript = words.map(w => w.word).join(' ');
    const dummyClip = { start: 0, end: duration, words };
    const cues = buildClipCues(dummyClip, { wordsPerChunk: 3 });
    logFn(`[gemini-transcribe] Chunked transcription complete: ${words.length} words, ${cues.length} cues`);
    return { words, transcript, cues };
  }

  // ── Short videos: try single-shot first ──
  let proxyPath = null;
  let uploadedFile = null;

  try {
    logFn('[gemini-transcribe] Creating proxy for full transcription...');
    proxyPath = await createAnalysisProxy(videoPath, '_proxy_transcribe');

    const uploadResult = await fileManager.uploadFile(proxyPath, {
      mimeType: 'video/mp4',
      displayName: path.basename(proxyPath),
    });
    uploadedFile = uploadResult.file;

    const file = await waitForFileActive(fileManager, uploadedFile, 300_000, logFn);

    const model = genAI.getGenerativeModel({
      model: ANALYSIS_MODEL,
      generationConfig: {
        maxOutputTokens: 65536,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    logFn('[gemini-transcribe] Generating word-level transcript for full video...');
    const result = await generateWithRetry(
      model,
      [{ fileData: { fileUri: file.uri, mimeType: 'video/mp4' } }, { text: buildTranscriptionPrompt() }],
      3,
      logFn
    );

    const text = result.response.text();
    const finishReason = result.response.candidates?.[0]?.finishReason || 'unknown';
    logFn(`[gemini-transcribe] Response length: ${text.length} | finishReason: ${finishReason}`);

    // If truncated, fall back to chunked transcription instead of trying to salvage
    if (finishReason === 'MAX_TOKENS') {
      logFn('[gemini-transcribe] Single-shot was truncated (MAX_TOKENS) — falling back to chunked transcription');
      // Clean up the single-shot resources first
      if (proxyPath && fs.existsSync(proxyPath)) { try { fs.unlinkSync(proxyPath); } catch { } }
      if (uploadedFile) { try { await fileManager.deleteFile(uploadedFile.name); } catch { } }
      proxyPath = null;
      uploadedFile = null;

      const words = await transcribeChunked(videoPath, duration, genAI, fileManager, logFn);
      const transcript = words.map(w => w.word).join(' ');
      const dummyClip = { start: 0, end: duration, words };
      const cues = buildClipCues(dummyClip, { wordsPerChunk: 3 });
      logFn(`[gemini-transcribe] Chunked fallback complete: ${words.length} words, ${cues.length} cues`);
      return { words, transcript, cues };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```[\s\S]*$/i, '').trim();
      logFn(`[gemini-transcribe] RAW RESPONSE LENGTH: ${text?.length}`);
      try {
        data = JSON.parse(cleaned);
      } catch (err) {
        const repaired = repairTruncatedJSON(cleaned);
        if (repaired) {
          data = JSON.parse(repaired);
          logFn(`[gemini-transcribe] WARNING: response was truncated (finishReason: ${finishReason}). Recovered partial result.`);
        } else {
          logFn(`[gemini-transcribe] Parse failed. Raw tail: ${text?.slice(-200)}`);
          throw new Error(`Transcript JSON parse failed: ${err.message}`);
        }
      }
    }

    const words = (data.words || [])
      .filter(w => w && typeof w.word === 'string' && typeof w.t === 'number')
      .map(w => ({ word: w.word.trim(), t: parseFloat(w.t) }))
      .filter(w => w.word.length > 0)
      .sort((a, b) => a.t - b.t);

    const transcript = words.map(w => w.word).join(' ');

    const dummyClip = { start: 0, end: duration, words };
    const cues = buildClipCues(dummyClip, { wordsPerChunk: 3 });

    logFn(`[gemini-transcribe] Single-shot complete: ${words.length} words, ${cues.length} cues`);
    return { words, transcript, cues, language: data.video_language || 'unknown' };
  } finally {
    if (proxyPath && fs.existsSync(proxyPath)) {
      try { fs.unlinkSync(proxyPath); } catch { }
    }
    if (uploadedFile) {
      try { await fileManager.deleteFile(uploadedFile.name); } catch { }
    }
  }
}


function buildSplitScreenFramingPrompt(duration) {
  return `You are an expert video editor choosing camera framing for a split-screen short-form layout.

This video will be cropped into a narrow 1080px-wide vertical strip taken from somewhere within the frame width, used as the TOP half of a 9:16 split-screen (the bottom half separately shows the full frame, blurred and padded — you're only choosing the TOP crop).

Watch the entire video (duration: ~${Math.round(duration)}s). Identify the horizontal position of the main subject (the speaker's face, or the most important visual focus) throughout. Output one keyframe at t=0, plus one more each time the subject's position changes enough that the current crop would no longer frame them well — a cut to a different angle, the subject moving to a different part of the frame, a layout change.
HARD LIMIT: output AT MOST 15 keyframes total, no matter the video length or how much the subject moves. If you're adding more than that, you're tracking movement too finely — merge nearby changes and keep only the ones that matter.

"cropX" is a fraction from 0.0 to 1.0:
- 0.0 = crop window all the way LEFT
- 0.5 = CENTERED
- 1.0 = crop window all the way RIGHT
Pick whichever value keeps the subject centered in the crop.

Return ONLY this exact JSON (no markdown, no explanation):
{
  "keyframes": [
    { "time": 0.0, "cropX": 0.5 },
    { "time": 14.2, "cropX": 0.2 }
  ]
}`;
}

/**
 * Collapses a keyframe list to a sane count for FFmpeg's expression parser.
 * One if() per keyframe means deeply nested conditions get slow — and, past
 * some point, crash the parser outright rather than just running slowly.
 * Drops keyframes that don't represent a real position change, then hard-caps
 * whatever's left by keeping the biggest jumps (first/last always survive).
 */
function simplifyKeyframes(keyframes, maxCount = 20, minGapSec = 1.5, minDelta = 0.04) {
  if (!keyframes || keyframes.length <= 1) return keyframes || [];

  const filtered = [keyframes[0]];
  for (let i = 1; i < keyframes.length; i++) {
    const prev = filtered[filtered.length - 1];
    const kf = keyframes[i];
    const isLast = i === keyframes.length - 1;
    const changedEnough = Math.abs(kf.cropX - prev.cropX) >= minDelta;
    const farEnough = (kf.time - prev.time) >= minGapSec;
    if (isLast || (changedEnough && farEnough)) filtered.push(kf);
  }
  if (filtered.length <= maxCount) return filtered;

  const scored = filtered.map((kf, i) => ({
    kf,
    delta: (i === 0 || i === filtered.length - 1) ? Infinity : Math.abs(kf.cropX - filtered[i - 1].cropX),
  }));
  return scored.sort((a, b) => b.delta - a.delta).slice(0, maxCount).map(s => s.kf).sort((a, b) => a.time - b.time);
}

export async function detectSplitScreenFraming(videoPath, jobId, duration, logFn = console.log) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing from backend/.env');

  const genAI = new GoogleGenerativeAI(apiKey);
  const fileManager = new GoogleAIFileManager(apiKey);

  let proxyPath = null;
  let uploadedFile = null;

  try {
    logFn('[gemini-framing] Creating proxy for split-screen framing detection...');
    proxyPath = await createAnalysisProxy(videoPath, '_proxy_framing');

    const uploadResult = await fileManager.uploadFile(proxyPath, {
      mimeType: 'video/mp4',
      displayName: path.basename(proxyPath),
    });
    uploadedFile = uploadResult.file;
    const file = await waitForFileActive(fileManager, uploadedFile, 300_000, logFn);

    const model = genAI.getGenerativeModel({
      model: ANALYSIS_MODEL,
      generationConfig: {
        maxOutputTokens: 2048, // small on purpose — a keyframe list, not a transcript
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    logFn('[gemini-framing] Detecting subject position for split-screen crop...');
    const result = await generateWithRetry(
      model,
      [{ fileData: { fileUri: file.uri, mimeType: 'video/mp4' } }, { text: buildSplitScreenFramingPrompt(duration) }],
      3,
      logFn
    );

    const text = result.response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```[\s\S]*$/i, '').trim();
      try {
        data = JSON.parse(cleaned);
      } catch {
        const repaired = repairTruncatedJSON(cleaned);
        if (!repaired) throw new Error(`Framing JSON parse failed. Raw tail: ${text.slice(-200)}`);
        data = JSON.parse(repaired);
        logFn('[gemini-framing] WARNING: response was truncated. Using partial keyframes.');
      }
    }

    let keyframes = (data.keyframes || [])
      .filter(k => k && typeof k.time === 'number' && typeof k.cropX === 'number')
      .map(k => ({
        time: Math.max(0, Math.min(duration, k.time)),
        cropX: Math.max(0, Math.min(1, k.cropX)),
      }))
      .sort((a, b) => a.time - b.time);

    if (!keyframes.length || keyframes[0].time > 0.5) {
      keyframes.unshift({ time: 0, cropX: 0.5 });
    }

    const rawCount = keyframes.length;
    keyframes = simplifyKeyframes(keyframes, 20);
    logFn(rawCount === keyframes.length
      ? `[gemini-framing] Found ${keyframes.length} framing keyframe(s)`
      : `[gemini-framing] Found ${rawCount} keyframes, simplified to ${keyframes.length} — FFmpeg chokes well before 90+ nested conditions`);
    return keyframes;

  } catch (err) {
    logFn(`[gemini-framing] Detection failed, falling back to centered crop: ${err.message}`);
    return [{ time: 0, cropX: 0.5 }]; // same as the old default, minus the units bug
  } finally {
    if (proxyPath && fs.existsSync(proxyPath)) {
      try { fs.unlinkSync(proxyPath); } catch { }
    }
    if (uploadedFile) {
      try { await fileManager.deleteFile(uploadedFile.name); } catch { }
    }
  }
}

// ─────────────────────────────────────────────
//  Heuristic fallback (no Gemini)
// ─────────────────────────────────────────────
export function heuristicSegments(duration, maxClips, clipLength) {
  const margin = 5;
  const usable = Math.max(0, duration - margin * 2);
  const count = Math.min(maxClips, Math.max(1, Math.floor(usable / (clipLength + 10))));
  const step = usable / count;
  return Array.from({ length: count }, (_, i) => {
    const start = margin + i * step;
    const len = Math.min(clipLength, duration - start - 1);
    return {
      index: i, start: Math.round(start), end: Math.round(start + len),
      title: `Highlight ${i + 1}`, hook: `Highlight ${i + 1}`,
      why_viral: 'Auto-selected segment', score: 70 - i * 3,
      transcript: '', words: [], cues: [],
      has_face: false, face_position: 'none', emotion: 'neutral',
      category: 'reaction', suggested_caption_style: 'tiktok', best_thumbnail_second: 3,
    };
  });
}