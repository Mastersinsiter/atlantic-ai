const { spawn } = require('child_process');
const proc = spawn('yt-dlp', ['https://youtu.be/95jWleGKgPE?si=IIJWYwsbWvswMfPh', '-o', 'test.mp4']);
proc.stdout.on('data', d => process.stdout.write(d));
proc.stderr.on('data', d => process.stderr.write(d));
proc.on('close', code => {
  if (code !== 0) {
    const err = new Error(`yt-dlp exited ${code}`);
    console.error(err.stack);
  }
});
