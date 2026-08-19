/**
 * Atlantic AI — Groq Provider
 *
 * Groq-backed implementations of the two pipeline stages that normally run on
 * Gemini / Faster-Whisper:
 *
 *   1. transcribeVideoChunkedWithGroq() — word-level transcription via
 *      Groq's hosted Whisper (whisper-large-v3-turbo). Audio is extracted
 *      with ffmpeg and split into chunks that fit Groq's file-size limit,
 *      then each chunk is transcribed with verbose_json word timestamps and
 *      merged back with absolute offsets.
 *
 *   2. analyzeClipsWithGroq() — viral clip selection via a Groq chat model
 *      (llama-3.3-70b-versatile by default) using the transcript text.
 *
 * Both functions log with [groq-transcribe] / [groq-analysis] prefixes so
 * job logs stay parseable the same way as the existing [gemini-transcribe]
 * lines. The Gemini code path is untouched — this module is only called as
 * a fallback or when explicitly selected via env vars.
 */
// Groq SDK dynamically imported in getClient()
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

// ─────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────
const GROQ_TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo';
const GROQ_ANALYSIS_MODEL = process.env.GROQ_ANALYSIS_MODEL || 'llama-3.3-70b-versatile';

// Groq's audio endpoint rejects files >25 MB. At 64 kbps mono AAC, 25 MB is
// ~52 minutes, so 10-minute chunks are comfortably safe even with overhead.
const GROQ_CHUNK_DURATION_SEC = 600;
const GROQ_CHUNK_OVERLAP_SEC = 3;

async function getClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is missing from backend/.env');
  const { default: Groq } = await import('groq-sdk');
  return new Groq({ apiKey });
}

// ─────────────────────────────────────────────
//  Transcription
// ─────────────────────────────────────────────

/**
 * Extract a mono 16 kHz MP3 audio chunk from the source video.
 * Groq Whisper accepts: flac mp3 mp4 mpeg mpga m4a ogg opus wav webm.
 * MP3 at 64kbps mono is compact and well-supported.
 * Returns the chunk file path (caller deletes).
 */
async function extractAudioChunk(videoPath, chunkPath, startSec, durationSec) {
  const cmd = [
    'ffmpeg', '-y',
    '-i', `"${videoPath}"`,
    '-ss', String(Math.max(0, startSec)),
    '-t', String(durationSec),
    '-vn', '-acodec', 'libmp3lame', '-b:a', '64k', '-ac', '1', '-ar', '16000',
    `"${chunkPath}"`
  ].join(' ');
  await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
  return chunkPath;
}

/**
 * Transcribe one audio chunk via Groq Whisper. Returns words with
 * chunk-relative timestamps converted to absolute video time.
 */
async function transcribeSingleChunkWithGroq(client, chunkPath, chunkStart, chunkIndex, logFn) {
  const fileStream = fs.createReadStream(chunkPath);

  const response = await client.audio.transcriptions.create({
    file: fileStream,
    model: GROQ_TRANSCRIBE_MODEL,
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
    temperature: 0.0,
  });

  const words = (response.words || [])
    .filter(w => w && typeof w.word === 'string' && typeof w.start === 'number')
    .map(w => ({
      word: w.word.trim(),
      t: chunkStart + w.start,
      end: chunkStart + (typeof w.end === 'number' ? w.end : w.start + 0.3),
    }))
    .filter(w => w.word.length > 0);

  logFn(`[groq-transcribe] Chunk ${chunkIndex}: ${words.length} words`);

  // Also extract real segments from Groq's response for downstream use
  const segments = (response.segments || []).map(s => ({
    start: chunkStart + s.start,
    end: chunkStart + s.end,
    text: s.text,
  }));

  return { words, segments };
}

/**
 * Chunked transcription via Groq Whisper.
 *
 * Splits the video's audio into ~10-minute chunks, transcribes each with
 * word-level timestamps, dedupes the small overlap regions, and returns the
 * same shape as mediaAnalysis.transcribeOnly(): { words, transcript, cues }.
 *
 * @param {string} videoPath  absolute path to the source video
 * @param {string} jobId      job id (for temp file naming)
 * @param {number} duration   real video duration in seconds
 * @param {object} options    { language?: 'en' | 'hi' | 'auto' | ... }
 * @param {function} logFn    logging callback
 */
export async function transcribeVideoChunkedWithGroq(videoPath, jobId, duration, options = {}, logFn = console.log) {
  const client = await getClient();

  const chunks = [];
  for (let t = 0; t < duration; t += GROQ_CHUNK_DURATION_SEC - GROQ_CHUNK_OVERLAP_SEC) {
    const chunkDur = Math.min(GROQ_CHUNK_DURATION_SEC, duration - t);
    if (chunkDur < 2) break; // skip tiny tail
    chunks.push({ start: t, duration: chunkDur, index: chunks.length });
  }

  logFn(`[groq-transcribe] Chunked mode: ${chunks.length} chunks of ~${GROQ_CHUNK_DURATION_SEC}s each (model: ${GROQ_TRANSCRIBE_MODEL})`);

  const allWords = [];
  const allSegments = [];
  for (const chunk of chunks) {
    logFn(`[groq-transcribe] Transcribing chunk ${chunk.index + 1}/${chunks.length} (${chunk.start.toFixed(0)}s – ${(chunk.start + chunk.duration).toFixed(0)}s)...`);
    const chunkPath = videoPath.replace(/\.[^/.]+$/, `_groq_chunk${chunk.index}.mp3`);
    try {
      await extractAudioChunk(videoPath, chunkPath, chunk.start, chunk.duration);
      const sizeMb = (fs.statSync(chunkPath).size / 1048576).toFixed(1);
      logFn(`[groq-transcribe] Chunk ${chunk.index + 1} audio: ${sizeMb} MB`);
      const { words, segments } = await transcribeSingleChunkWithGroq(client, chunkPath, chunk.start, chunk.index + 1, logFn);
      allWords.push(...words);
      allSegments.push(...segments);
    } catch (err) {
      logFn(`[groq-transcribe] ERROR: Chunk ${chunk.index + 1} failed: ${err.message}. Continuing with next chunk...`);
    } finally {
      if (fs.existsSync(chunkPath)) {
        try { fs.unlinkSync(chunkPath); } catch { }
      }
    }
  }

  // Dedupe words from overlapping regions: same text within 0.5s → keep first
  const deduped = [];
  for (const w of allWords) {
    const dup = deduped.find(d => d.word === w.word && Math.abs(d.t - w.t) < 0.5);
    if (!dup) deduped.push(w);
  }
  deduped.sort((a, b) => a.t - b.t);

  const transcript = deduped.map(w => w.word).join(' ');
  const dummyClip = { start: 0, end: duration, words: deduped };
  const cues = buildClipCues(dummyClip, { wordsPerChunk: 3 });

  logFn(`[groq-transcribe] Chunked transcription complete: ${deduped.length} words, ${allSegments.length} segments, ${cues.length} cues`);
  return { words: deduped, transcript, cues, segments: allSegments, language: options.language || 'auto' };
}

// ─────────────────────────────────────────────
//  Clip analysis
// ─────────────────────────────────────────────

/**
 * Pick the most engaging clips from a transcript using a Groq chat model.
 *
 * Returns an array of { start, end, title, hook, score, category, emotion }
 * — the same fields processor.js consumes from the Gemini analysis result.
 *
 * @param {string} transcriptText  full transcript (word timestamps optional)
 * @param {number} numClips        how many clips to pick
 * @param {object} options         { videoDuration?: number, clipLength?: number }
 * @param {function} logFn         logging callback
 */
export async function analyzeClipsWithGroq(transcriptText, numClips, options = {}, logFn = console.log) {
  const client = await getClient();
  const clipLength = options.clipLength || 90;
  const videoDuration = options.videoDuration || 0;

  const completion = await client.chat.completions.create({
    model: GROQ_ANALYSIS_MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a viral-clip-selection assistant. Given a transcript with word-level timestamps, pick the ${numClips} most engaging 30-${clipLength}s segments.${videoDuration ? ` The video is ${Math.round(videoDuration)}s long — never select clips starting or ending after ${Math.round(videoDuration)}s.` : ''} Return ONLY valid JSON in this exact shape: {"clips": [{"start": number, "end": number, "title": string, "hook": string, "score": integer 0-100, "category": string, "emotion": string}, ...]}. No prose, no markdown fences.`,
      },
      { role: 'user', content: transcriptText },
    ],
  });

  logFn(`[groq-analysis] ${completion.usage?.total_tokens ?? '?'} tokens used`);

  const parsed = JSON.parse(completion.choices[0].message.content);
  return parsed.clips || [];
}
