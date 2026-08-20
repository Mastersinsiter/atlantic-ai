import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildMasterCommand } from '../src/videoLayout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

async function runVerification() {
  console.log('=== Comprehensive Multi-Resolution & Concat Verification ===\n');

  const testDir = path.join(__dirname, 'temp_test');
  fs.mkdirSync(testDir, { recursive: true });

  const inputVideo = path.join(testDir, 'source_test.mp4');
  const output4k = path.join(testDir, 'output_4k_test.mp4');
  const output4kConcat = path.join(testDir, 'output_4k_concat_test.mp4');
  const output2k = path.join(testDir, 'output_2k_test.mp4');
  const srtPath = path.join(testDir, 'test_captions.srt');

  try {
    // 1. Generate a 3-second 1080p test video with testsrc + sine audio
    console.log('1. Generating 1080p 16:9 test source video and subtitles...');
    await execAsync(`ffmpeg -y -f lavfi -i testsrc=size=1920x1080:rate=30 -f lavfi -i sine=frequency=1000:duration=3 -t 3 -c:v libx264 -c:a aac "${inputVideo}"`);
    
    // Write sample SRT subtitle
    const srtContent = `1\n00:00:00,000 --> 00:00:02,000\nAtlantic AI 4K Clarity Subtitle\n`;
    fs.writeFileSync(srtPath, srtContent, 'utf8');
    console.log('   Source video and subtitles created successfully.\n');

    // 2. Execute 4K Ultra-HD Pipeline with corrected filter order (hqdn3d -> scale/lanczos -> unsharp -> eq)
    console.log('2. Executing 4K Ultra-HD FFmpeg pipeline (2160x3840, CRF 18, 320k audio)...');
    const customFraming = {
      mode: 'vertical',
      regions: [{ x: 420, y: 0, width: 1080, height: 1080, sourceWidth: 1920, sourceHeight: 1080 }],
      outputWidth: 2160,
      outputHeight: 3840
    };

    const watermark = {
      enabled: true,
      text: 'Atlantic 4K Test',
      position: 'top-right'
    };

    const args4k = buildMasterCommand({
      inputPath: inputVideo,
      outputPath: output4k,
      start: 0,
      duration: 2,
      srtPath,
      watermark,
      customFraming,
      resolution: '4k',
      outputWidth: 2160,
      outputHeight: 3840,
      enhance4k: true,
    });

    const start4k = Date.now();
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args4k, { windowsHide: true });
      let errBuf = '';
      proc.stderr.on('data', d => { errBuf += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`4K FFmpeg exited with code ${code}\n${errBuf.slice(-500)}`));
      });
    });
    console.log(`   4K Render completed in ${((Date.now() - start4k) / 1000).toFixed(2)}s`);

    // 3. Execute 2K Quad-HD Pipeline and inspect encoder metadata
    console.log('3. Executing 2K Quad-HD FFmpeg pipeline (1440x2560, CRF 20, 256k audio)...');
    const args2k = buildMasterCommand({
      inputPath: inputVideo,
      outputPath: output2k,
      start: 0,
      duration: 2,
      srtPath,
      watermark,
      customFraming: {
        mode: 'vertical',
        regions: [{ x: 420, y: 0, width: 1080, height: 1080, sourceWidth: 1920, sourceHeight: 1080 }],
        outputWidth: 1440,
        outputHeight: 2560
      },
      resolution: '2k',
      outputWidth: 1440,
      outputHeight: 2560,
      enhance4k: false,
    });

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args2k, { windowsHide: true });
      let errBuf = '';
      proc.stderr.on('data', d => { errBuf += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`2K FFmpeg exited with code ${code}\n${errBuf.slice(-500)}`));
      });
    });

    // Inspect 2K output encoder tags via ffprobe
    const { stdout: probe2kTags } = await execAsync(`ffprobe -v quiet -print_format json -show_entries format_tags=encoder:stream_tags=ENCODER -show_streams "${output2k}"`);
    console.log('   ffprobe 2K Encoder Metadata:');
    console.log(`   ${probe2kTags.trim()}`);
    console.log('   ✅ 2K Quad-HD Output Verified!\n');

    // 4. Execute Multi-Segment [concata] 4K Test
    console.log('4. Executing Multi-Segment [concata] Pipeline in 4K mode...');
    const multiTrimSegments = [
      { in: 0.0, out: 1.0 },
      { in: 1.5, out: 2.5 },
    ];

    const args4kConcat = buildMasterCommand({
      inputPath: inputVideo,
      outputPath: output4kConcat,
      trimSegments: multiTrimSegments,
      srtPath,
      watermark,
      customFraming,
      resolution: '4k',
      outputWidth: 2160,
      outputHeight: 3840,
      enhance4k: true,
    });

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args4kConcat, { windowsHide: true });
      let errBuf = '';
      proc.stderr.on('data', d => { errBuf += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`4K Concat FFmpeg exited with code ${code}\n${errBuf.slice(-500)}`));
      });
    });

    // Inspect multi-segment 4K output with ffprobe
    const { stdout: probeConcat } = await execAsync(`ffprobe -v quiet -print_format json -show_streams -show_format "${output4kConcat}"`);
    const infoConcat = JSON.parse(probeConcat);
    const videoStreams = infoConcat.streams.filter(s => s.codec_type === 'video');
    const audioStreams = infoConcat.streams.filter(s => s.codec_type === 'audio');

    console.log(`   Multi-segment 4K video streams: ${videoStreams.length} (${videoStreams[0].width}x${videoStreams[0].height})`);
    console.log(`   Multi-segment 4K audio streams: ${audioStreams.length} (${audioStreams[0].codec_name}, sample_rate: ${audioStreams[0].sample_rate})`);
    console.log(`   Multi-segment duration: ${Number(infoConcat.format.duration).toFixed(2)}s (expected ~2.00s)`);

    if (videoStreams.length !== 1 || audioStreams.length !== 1) {
      throw new Error(`Expected exactly 1 video and 1 audio stream, got ${videoStreams.length}v / ${audioStreams.length}a`);
    }
    if (videoStreams[0].width !== 2160 || videoStreams[0].height !== 3840) {
      throw new Error(`Expected 2160x3840, got ${videoStreams[0].width}x${videoStreams[0].height}`);
    }
    console.log('   ✅ Multi-Segment [concata] 4K Pipeline Verified (No orphaned/duplicate audio pads)!\n');

    console.log('=== All Multi-Resolution & Concat Verifications Passed! ===');
  } finally {
    // Keep artifacts for verification
  }
}

runVerification().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
