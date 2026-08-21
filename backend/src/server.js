import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { jobQueue, jobs } from './queue.js';
import { processVideo, renderClipWithEdits, reframeClip, renderJobClips } from './processor.js';
import { searchMoments } from './searchEngine.js';

const app = express();
const PORT = process.env.PORT || 8080;

const UPLOAD_DIR = path.join(__dirname, '../uploads');
const OUTPUT_DIR = path.join(__dirname, '../outputs');
const FRONTEND_DIR = path.join(__dirname, '../../frontend/public');
[UPLOAD_DIR, OUTPUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/outputs', express.static(OUTPUT_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(FRONTEND_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ── Concurrent job limiter ──
const MAX_CONCURRENT_JOBS = 2;

function activeJobCount() {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.status === 'processing') count++;
  }
  return count;
}

function scheduleNextJob() {
  while (activeJobCount() < MAX_CONCURRENT_JOBS && jobQueue.length > 0) {
    const nextId = jobQueue.shift();
    const nextJob = jobs.get(nextId);
    if (!nextJob) continue; // job was deleted
    processVideo(nextId)
      .catch(err => {
        const j = jobs.get(nextId);
        if (j) { j.status = 'failed'; j.error = err.message; }
      })
      .finally(() => scheduleNextJob()); // free slot → try next queued job
  }
}

app.post('/api/process-yt', async (req, res) => {
  const { url, mode = 'auto', options = {}, source = 'youtube' } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const jobId = uuidv4();
  const job = {
    id: jobId, type: 'youtube', status: 'queued', progress: 0,
    url, source, mode, options,
    clips: [], createdAt: new Date().toISOString(), logs: []
  };
  jobs.set(jobId, job);
  jobQueue.push(jobId);
  scheduleNextJob();
  res.json({ jobId, message: 'Processing started' });
});

app.post('/api/process-file', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { mode = 'auto', options = '{}' } = req.body;
  // Tolerate malformed options JSON (e.g. shell quote-stripping) instead of
  // crashing the whole server and killing in-flight jobs.
  let parsedOptions = {};
  try {
    parsedOptions = typeof options === 'string' ? JSON.parse(options) : (options || {});
  } catch (e) {
    console.warn(`[server] Malformed options JSON, using defaults. Raw: ${String(options).slice(0, 120)}`);
    parsedOptions = {};
  }
  const jobId = uuidv4();
  const job = {
    id: jobId, type: 'upload', status: 'queued', progress: 0,
    filePath: req.file.path, mode, options: parsedOptions,
    clips: [], createdAt: new Date().toISOString(), logs: []
  };
  jobs.set(jobId, job);
  jobQueue.push(jobId);
  scheduleNextJob();
  res.json({ jobId, message: 'File processing started' });
});

// ── New mode routes ──

function scheduleNewModeJob(jobId, processFn) {
  const run = () => processFn(jobId)
    .catch(err => {
      const j = jobs.get(jobId);
      if (j) { j.status = 'failed'; j.error = err.message; }
    })
    .finally(() => scheduleNextJob());

  if (activeJobCount() < MAX_CONCURRENT_JOBS) {
    run();
  } else {
    jobQueue.push(jobId);
  }
}


app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.get('/api/jobs', (req, res) => {
  const list = Array.from(jobs.values())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);
  res.json(list);
});

app.post('/api/reframe/:jobId/:clipIndex', async (req, res) => {
  const { jobId, clipIndex } = req.params;
  const idx = parseInt(clipIndex);
  if (isNaN(idx) || idx < 0) {
    return res.status(400).json({ error: 'Invalid clip index' });
  }
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.clips || !job.clips[idx]) {
    return res.status(404).json({ error: `Clip ${idx} not found in job` });
  }

  try {
    const result = await reframeClip(jobId, idx, req.body);
    res.json(result);
  } catch (error) {
    console.error(`[reframeClip] Failed:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/render-job-clips', async (req, res) => {
  const { jobId, approvedClips } = req.body;
  if (!jobId || !approvedClips) {
    return res.status(400).json({ error: 'Missing jobId or approvedClips' });
  }

  try {
    // We launch this asynchronously so the request doesn't hang
    renderJobClips(jobId, approvedClips).catch(e => console.error(e));
    res.json({ success: true, message: 'Rendering started' });
  } catch (err) {
    console.error('[renderJobClips] Failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/render/clip', async (req, res) => {
  const { clip_id, subtitles, style, watermark, trimStart, trimEnd, trimSegments, layout, reframeKeyframes, voiceoverScript, customFraming } = req.body;
  if (!clip_id || !subtitles || !style) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  // Find the job that contains this clip_id
  let targetJob = null;
  let targetClip = null;
  for (const job of jobs.values()) {
    const cIndex = (job.clips || []).findIndex(c => `${job.id}-${c.index}` === clip_id || `${job.id}-edited-${c.index}` === clip_id || c.clip_id === clip_id);
    if (cIndex !== -1) {
      targetJob = job;
      targetClip = job.clips[cIndex];
      break;
    }
  }

  if (!targetJob || !targetClip) {
    return res.status(404).json({ error: 'Clip not found in any job' });
  }

  try {
    const result = await renderClipWithEdits({
      job: targetJob,
      clip: targetClip,
      subtitles,
      style,
      watermark,
      trimStart,
      trimEnd,
      trimSegments,
      layout,
      reframeKeyframes,
      voiceoverScript,
      customFraming
    });
    res.json(result);
  } catch (error) {
    console.error(`[renderClipWithEdits] Failed:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/upload-to-youtube', async (req, res) => {
  const { jobId, clipIndex, title, description, tags = [] } = req.body;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.clips[clipIndex]) return res.status(404).json({ error: 'Clip not found' });

  try {
    const { uploadToYouTube } = await import('./uploader.js');
    const clip = job.clips[clipIndex];
    const result = await uploadToYouTube({
      filePath: path.join(OUTPUT_DIR, clip.filename),
      title: title || clip.title || `Clip ${clipIndex + 1}`,
      description: description || clip.summary || '',
      tags, categoryId: '22', privacyStatus: 'public'
    });
    clip.youtubeUrl = result.url;
    clip.youtubeId = result.id;
    res.json({ success: true, url: result.url, id: result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload-to-tiktok', async (req, res) => {
  res.json({ error: 'TikTok integration coming soon' });
});

app.post('/api/upload-to-instagram', async (req, res) => {
  res.json({ error: 'Instagram integration coming soon' });
});

app.post('/api/save-brand-kit', async (req, res) => {
  const { colors, watermark, intro, outro } = req.body;
  const brandKit = { colors, watermark, intro, outro, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(__dirname, '../brand-kit.json'), JSON.stringify(brandKit, null, 2));
  res.json({ success: true });
});

app.get('/api/brand-kit', (req, res) => {
  const p = path.join(__dirname, '../brand-kit.json');
  if (fs.existsSync(p)) {
    res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
  } else {
    res.json({ colors: ['#7c3aed', '#a855f7', '#c084fc'], watermark: null });
  }
});

app.post('/api/save-schedule', async (req, res) => {
  const schedule = { ...req.body, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(__dirname, '../schedule.json'), JSON.stringify(schedule, null, 2));
  res.json({ success: true });
});

app.get('/api/auth/youtube', async (req, res) => {
  const { getAuthUrl } = await import('./uploader.js');
  res.json({ url: getAuthUrl() });
});

app.get('/api/auth/youtube/callback', async (req, res) => {
  const { handleCallback } = await import('./uploader.js');
  await handleCallback(req.query.code);
  res.send('<script>window.close()</script><p>Authenticated! You can close this tab.</p>');
});

app.get('/api/auth/status', (req, res) => {
  const tokenPath = path.join(__dirname, '../youtube_token.json');
  if (fs.existsSync(tokenPath)) {
    res.json({ connected: true });
  } else {
    res.status(401).json({ connected: false });
  }
});

app.delete('/api/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.clips.forEach(clip => {
    const p = path.join(OUTPUT_DIR, clip.filename);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  if (job.filePath && fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
  jobs.delete(req.params.jobId);
  res.json({ success: true });
});

app.post('/api/search/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const query = req.body?.query || req.query?.q || '';
  if (!query.trim()) return res.status(400).json({ error: 'query is required' });
  const index = job.searchIndex;
  if (!index) return res.json({ results: [], message: 'No transcript index for this job' });
  const results = searchMoments(index, query, 15);
  res.json({ query, results, count: results.length });
});

// ── Creator Profile ──
const PROFILE_PATH = path.join(__dirname, '../creator_profile.json');

app.get('/api/profile', (req, res) => {
  try {
    if (fs.existsSync(PROFILE_PATH)) {
      res.json(JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8')));
    } else {
      const defaults = {
        name: 'Creator',
        content_type: 'gaming',
        audience_age: '13-25',
        style: 'energetic',
        clip_style: 'start with action not buildup',
        avoid: 'slow sections, long talking, boring intros',
        language: 'auto',
        example_hooks: ["You won't believe what happened next...", "This is insane...", "Wait for it..."],
        watermark: {
          enabled: false,
          text: '@yourchannel',
          image_path: '',
          position: 'bottom-right',
          opacity: 0.8,
          size: 36
        }
      };
      res.json(defaults);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/profile', (req, res) => {
  try {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/profile/watermark-image', upload.single('watermark'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const dest = path.join(UPLOAD_DIR, 'watermark.png');
  try {
    fs.copyFileSync(req.file.path, dest);
    let profile = {};
    if (fs.existsSync(PROFILE_PATH)) profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    if (!profile.watermark) profile.watermark = {};
    profile.watermark.image_path = dest;
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
    res.json({ success: true, path: dest });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get(['/healthz', '/api/health'], (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    jobsCount: jobs.size,
    features: {
      fasterWhisper: true,
      whisperLargeV3: process.env.WHISPER_MODEL === 'large-v3',
      facecamDetection: true,
      faceReactions: true,
      sceneDetection: true,
      semanticSearch: true,
      chatPipeline: true,
      indianCreatorMode: true,
      captionStyles: ['classic', 'tiktok', 'gaming', 'gaming-pro', 'streamer', 'meme', 'modern', 'cinematic', 'clean', 'minimal', 'karaoke', 'neon', 'viral'],
      contentTypes: ['auto', 'gaming', 'podcast', 'commentary', 'education', 'finance'],
      layoutModes: ['auto', 'top', 'bottom', 'left', 'right'],
      streamLayouts: ['stream-top', 'stream-bottom', 'stream-left', 'stream-right'],
      editorMode: 'stream-highlight',
      clipCategories: ['funny', 'rage', 'reaction', 'clutch', 'win', 'educational', 'most-viral'],
      variantDurations: [15, 30, 45, 60]
    }
  });
});

// Serve frontend (open http://localhost:3000 in browser)
app.use(express.static(FRONTEND_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/outputs')) return next();
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

async function checkDependencies() {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const run = promisify(exec);
  const need = ['ffmpeg', 'yt-dlp'];
  for (const cmd of need) {
    try {
      await run(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`);
    } catch {
      console.warn(`⚠️  Missing ${cmd} — install via winget or add to PATH`);
    }
  }
  try {
    const { stdout: ytdlpVer } = await run('yt-dlp --version');
    console.log(`ℹ️  yt-dlp version: ${ytdlpVer.trim()} (keep updated with 'yt-dlp -U' to prevent YouTube 403 errors)`);
  } catch {}
  try {
    let jsSolver = null;
    for (const js of ['deno', 'node', 'bun', 'qjs']) {
      try {
        await run(process.platform === 'win32' ? `where ${js}` : `which ${js}`);
        jsSolver = js;
        break;
      } catch {}
    }
    if (jsSolver) {
      console.log(`ℹ️  yt-dlp JS challenge solver runtime detected: ${jsSolver}`);
    } else {
      console.warn(`⚠️  No JS runtime (deno/quickjs/bun) found for yt-dlp challenge solving. Install Deno if YouTube downloads fail.`);
    }
  } catch {}
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('paste_your')) {
    console.warn('⚠️  GEMINI_API_KEY missing in backend/.env — AI clip detection will fail');
  }
}

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`⚡ Atlantic AI running at http://0.0.0.0:${PORT} (local: http://localhost:${PORT})`);
  console.log(`   Open that URL in your browser — do not type a folder path in the address bar.`);
  await checkDependencies();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use. Close the other Atlantic AI window or run:`);
    console.error(`   npx kill-port ${PORT}\n`);
    process.exit(1);
  }
  throw err;
});


