/**
 * transcription.js — Unified speech-to-text for Atlantic AI
 *
 * Priority order:
 *   1. OpenAI Whisper API (whisper-1, verbose_json word timestamps) — primary
 *   2. Gemini 2.5 Flash chunked audio transcription — fallback
 *
 * Both return the same shape:
 *   { words: [{ word, t, end }], transcript, language }
 *
 * `t` and `end` are absolute seconds from the start of the source video.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

// ─────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────

/** Extract mono 16kHz audio from a video (or audio) file. Returns path to .wav */
async function extractAudio(inputPath, outPath) {
  const cmd = [
    'ffmpeg', '-y',
    '-i', `"${inputPath}"`,
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    `"${outPath}"`
  ].join(' ');
  await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
  return outPath;
}

/** Split audio into chunks of `chunkSec` seconds. Returns array of { path, offset }. */
async function splitAudioIntoChunks(audioPath, chunkSec = 240, workDir) {
  const dur = await getAudioDuration(audioPath);
  const chunks = [];
  let idx = 0;
  for (let start = 0; start < dur; start += chunkSec) {
    const len = Math.min(chunkSec, dur - start);
    if (len < 1) break;
    const out = path.join(workDir, `chunk_${idx}.wav`);
    const cmd = [
      'ffmpeg', '-y',
      '-i', `"${audioPath}"`,
      '-ss', String(start),
      '-t', String(len),
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      `"${out}"`
    ].join(' ');
    await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    chunks.push({ path: out, offset: start, duration: len });
    idx++;
  }
  return chunks;
}

async function getAudioDuration(audioPath) {
  const { stdout } = await execAsync(
    `ffprobe -v quiet -print_format json -show_format "${audioPath}"`
  );
  const info = JSON.parse(stdout);
  return parseFloat(info.format?.duration || 0);
}

function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

// ─────────────────────────────────────────────
//  1. OpenAI Whisper API
// ─────────────────────────────────────────────

/**
 * Transcribe a single audio file (≤25MB) via OpenAI Whisper API.
 * Returns { words: [{word, t, end}], transcript, language } with absolute times.
 */
async function whisperTranscribeChunk(audioPath, offsetSec, logFn) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const fileBuf = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);

  const form = new FormData();
  form.append('file', new Blob([fileBuf]), fileName);
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Whisper API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const words = (data.words || [])
    .filter(w => w && typeof w.word === 'string' && typeof w.start === 'number')
    .map(w => ({
      word: w.word.trim(),
      t: offsetSec + parseFloat(w.start),
      end: offsetSec + parseFloat(w.end ?? (w.start + 0.3)),
    }))
    .filter(w => w.word.length > 0);

  return {
    words,
    transcript: (data.text || '').trim(),
    language: data.language || 'unknown',
  };
}

/**
 * Full Whisper transcription with automatic chunking for long files.
 * Whisper API has a 25MB upload limit; 16kHz mono WAV ≈ 1.9MB/min, so
 * 10-minute chunks stay well under the limit.
 */
export async function transcribeWithWhisper(videoPath, jobId, duration, logFn = console.log) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing from backend/.env');

  const workDir = path.join(__dirname, '../uploads', `_whisper_${jobId}`);
  fs.mkdirSync(workDir, { recursive: true });
  const audioPath = path.join(workDir, 'full.wav');

  try {
    logFn('[whisper] Extracting audio...');
    await extractAudio(videoPath, audioPath);

    const WHISPER_CHUNK_SEC = 600; // 10 min ≈ 19MB at 16kHz mono — safe under 25MB
    const chunks = await splitAudioIntoChunks(audioPath, WHISPER_CHUNK_SEC, workDir);
    logFn(`[whisper] ${chunks.length} chunk(s) to transcribe`);

    const allWords = [];
    let fullTranscript = '';
    let detectedLang = 'unknown';

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      logFn(`[whisper] Transcribing chunk ${i + 1}/${chunks.length} (offset ${c.offset.toFixed(0)}s)...`);
      try {
        const result = await whisperTranscribeChunk(c.path, c.offset, logFn);
        allWords.push(...result.words);
        fullTranscript += (fullTranscript ? ' ' : '') + result.transcript;
        if (result.language !== 'unknown') detectedLang = result.language;
        logFn(`[whisper] Chunk ${i + 1}: ${result.words.length} words`);
      } catch (err) {
        logFn(`[whisper] Chunk ${i + 1} failed: ${err.message}`);
        // Continue with remaining chunks — partial transcript is better than none
      }
    }

    // Dedupe words at chunk boundaries (same word within 0.4s)
    allWords.sort((a, b) => a.t - b.t);
    const deduped = [];
    for (const w of allWords) {
      const prev = deduped[deduped.length - 1];
      if (prev && prev.word.toLowerCase() === w.word.toLowerCase() && Math.abs(prev.t - w.t) < 0.4) continue;
      deduped.push(w);
    }

    logFn(`[whisper] Done: ${deduped.length} words, language=${detectedLang}`);
    return { words: deduped, transcript: fullTranscript, language: detectedLang };
  } finally {
    // Cleanup work dir
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

// ─────────────────────────────────────────────
//  2. Gemini chunked transcription (fallback)
// ─────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_CHUNK_SEC = 240; // 4 min per chunk — well under token ceiling

function buildTranscriptionPrompt() {
  return `You are an expert transcriptionist for Indian gaming/content creators.
Transcribe every spoken word in this audio, word-by-word.

RULES:
- "t" = absolute timestamp in seconds from the START of this audio chunk (0.0).
- Timestamps must be accurate to within 0.3 seconds.
- ALWAYS use English (Roman) script ONLY. NEVER Devanagari.
- For Hindi/Hinglish: write exactly how Indian creators speak.
  Examples: "bhai sach mein" NOT "भाई सच में", "yaar ye toh OP hai"
- Transcribe ONLY the PRIMARY SPEAKER. Skip background music, songs, game audio, other voices.
- Keep filler words: bro, bhai, yaar, arre, abe, matlab, bas, like, actually, seriously, literally
- NEVER translate gaming vocab: Headshot, Revive, Knock, Clutch, Reload, Camping, Push, Rush, Loot, Scope, Aim, Spray, Lag, Ping, Buff, Nerf, Zone, Rank, OP, GG, noob, pro, squad, rotate, drop, circle, safe zone
- Keep swear words exactly as spoken.
- Capitalize emphasis words: NO WAY, BRO, INSANE, OP, WHAT, 100%

Return ONLY this JSON (no markdown):
{
  "video_language": "en",
  "words": [
    { "word": "hello", "t": 0.3 },
    { "word": "there", "t": 0.6 }
  ]
}`;
}

function repairTruncatedJSON(text) {
  const stack = [];
  let inString = false, escaped = false, lastNonSpace = '', lastSafeCut = -1;
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
    else if (ch === ',' && (lastNonSpace === '}' || lastNonSpace === ']')) lastSafeCut = i;
    if (!/\s/.test(ch)) lastNonSpace = ch;
  }
  if (stack.length === 0) return text;
  if (lastSafeCut === -1) return null;
  const openAtCut = [];
  inString = false; escaped = false;
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
  return text.slice(0, lastSafeCut) + openAtCut.reverse().map(o => (o === '{' ? '}' : ']')).join('');
}

async function waitForFileActive(fileManager, uploadedFile, maxWaitMs = 300_000, logFn) {
  const start = Date.now();
  let delay = 5000;
  let file = uploadedFile;
  while (Date.now() - start < maxWaitMs) {
    file = await fileManager.getFile(uploadedFile.name);
    if (file.state === 'ACTIVE') return file;
    if (file.state === 'FAILED') throw new Error(`Gemini file processing failed: ${file.name}`);
    logFn(`[gemini-transcribe] File state: ${file.state}. Waiting ${delay / 1000}s...`);
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 30_000);
  }
  throw new Error('Gemini file took too long to become ACTIVE.');
}

function parseRetryDelay(errMessage) {
  const m = errMessage?.match(/"retryDelay":"(\d+)s"/);
  return m ? parseInt(m[1]) * 1000 : null;
}

async function generateWithRetry(model, content, maxRetries = 4, logFn) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(content, { timeout: 600000 });
    } catch (err) {
      const is429 = err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('exceeded');
      if (is429 && attempt < maxRetries) {
        const apiDelay = parseRetryDelay(err.message) || 0;
        const waitMs = Math.max(apiDelay + 5_000, 65_000);
        logFn(`[gemini-transcribe] 429 quota hit. Waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

async function geminiTranscribeChunk(videoPath, chunkStart, chunkDuration, chunkIndex, genAI, fileManager, logFn) {
  const chunkPath = videoPath.replace(/\.[^/.]+$/, `_gchunk${chunkIndex}.aac`);
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
        model: GEMINI_MODEL,
        generationConfig: { maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 0 } },
      });

      const result = await generateWithRetry(
        model,
        [{ fileData: { fileUri: file.uri, mimeType: 'audio/aac' } }, { text: buildTranscriptionPrompt() }],
        3,
        logFn
      );

      const rawText = result.response.text();
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```[\s\S]*$/i, '').trim();
      let data;
      try {
        data = JSON.parse(cleaned);
      } catch {
        const repaired = repairTruncatedJSON(cleaned);
        if (repaired) data = JSON.parse(repaired);
        else throw new Error('JSON parse failed');
      }

      return (data.words || [])
        .filter(w => w && typeof w.word === 'string' && typeof w.t === 'number')
        .map(w => ({ word: w.word.trim(), t: chunkStart + parseFloat(w.t), end: chunkStart + parseFloat(w.t) + 0.3 }))
        .filter(w => w.word.length > 0);
    } finally {
      try { await fileManager.deleteFile(uploadedFile.name); } catch {}
    }
  } finally {
    safeUnlink(chunkPath);
  }
}

export async function transcribeWithGemini(videoPath, jobId, duration, logFn = console.log) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing from backend/.env');

  const genAI = new GoogleGenerativeAI(apiKey);
  const fileManager = new GoogleAIFileManager(apiKey);

  const chunks = [];
  for (let t = 0; t < duration; t += GEMINI_CHUNK_SEC - 3) {
    const chunkDur = Math.min(GEMINI_CHUNK_SEC, duration - t);
    if (chunkDur < 2) break;
    chunks.push({ start: t, duration: chunkDur, index: chunks.length });
  }

  logFn(`[gemini-transcribe] ${chunks.length} chunk(s) of ~${GEMINI_CHUNK_SEC}s`);

  const allWords = [];
  for (const chunk of chunks) {
    logFn(`[gemini-transcribe] Chunk ${chunk.index + 1}/${chunks.length} (${chunk.start.toFixed(0)}s–${(chunk.start + chunk.duration).toFixed(0)}s)...`);
    try {
      const words = await geminiTranscribeChunk(videoPath, chunk.start, chunk.duration, chunk.index, genAI, fileManager, logFn);
      allWords.push(...words);
      logFn(`[gemini-transcribe] Chunk ${chunk.index + 1}: ${words.length} words`);
    } catch (err) {
      logFn(`[gemini-transcribe] Chunk ${chunk.index + 1} failed: ${err.message}`);
    }
  }

  // Dedupe at boundaries
  allWords.sort((a, b) => a.t - b.t);
  const deduped = [];
  for (const w of allWords) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.word.toLowerCase() === w.word.toLowerCase() && Math.abs(prev.t - w.t) < 0.5) continue;
    deduped.push(w);
  }

  const transcript = deduped.map(w => w.word).join(' ');
  logFn(`[gemini-transcribe] Done: ${deduped.length} words`);
  return { words: deduped, transcript, language: 'unknown' };
}

// ─────────────────────────────────────────────
//  Unified entry point
// ─────────────────────────────────────────────

/**
 * Transcribe a video file. Tries Gemini API first (Primary), falls back to OpenAI Whisper.
 * Returns { words: [{word, t, end}], transcript, language, source }
 */
export async function transcribeVideo(videoPath, jobId, duration, logFn = console.log) {
  // Try Gemini first (Primary API)
  if (process.env.GEMINI_API_KEY) {
    try {
      logFn('[transcribe] Using Gemini API (Primary)...');
      const result = await transcribeWithGemini(videoPath, jobId, duration, logFn);
      if (result.words && result.words.length > 0) {
        return { ...result, source: 'gemini' };
      }
      logFn('[transcribe] Gemini returned 0 words — falling back to Whisper');
    } catch (err) {
      logFn(`[transcribe] Gemini failed: ${err.message} — falling back to Whisper`);
    }
  } else {
    logFn('[transcribe] No GEMINI_API_KEY — falling back to Whisper');
  }

  // Fallback to OpenAI Whisper API
  if (process.env.OPENAI_API_KEY) {
    try {
      logFn('[transcribe] Using OpenAI Whisper API (Fallback)...');
      const result = await transcribeWithWhisper(videoPath, jobId, duration, logFn);
      if (result.words && result.words.length > 0) {
        return { ...result, source: 'whisper' };
      }
    } catch (err) {
      logFn(`[transcribe] Whisper fallback failed: ${err.message}`);
    }
  }

  throw new Error('No transcription API available or succeeded. Ensure GEMINI_API_KEY is set in backend/.env');
}
