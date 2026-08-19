// Submit the original source video as a real job via the live API.
import fs from 'fs';
import path from 'path';

const videoPath = path.resolve('uploads/81fa1de5-a3c3-4090-b700-537b4e36f046.mp4');
const options = JSON.stringify({ captionStyle: 'gaming', language: 'auto', numClips: 3 });

const boundary = '----atlantic' + Date.now();
const fileBuf = fs.readFileSync(videoPath);
const fname = path.basename(videoPath);

const pre = Buffer.from(
  `--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\nauto\r\n` +
  `--${boundary}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${options}\r\n` +
  `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${fname}"\r\nContent-Type: video/mp4\r\n\r\n`
);
const post = Buffer.from(`\r\n--${boundary}--\r\n`);
const body = Buffer.concat([pre, fileBuf, post]);

const res = await fetch('http://localhost:3000/api/process-file', {
  method: 'POST',
  headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
  body
});
const json = await res.json();
console.log('SUBMITTED:', JSON.stringify(json));
