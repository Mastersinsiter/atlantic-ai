const fs = require('fs');
const http = require('http');
const path = require('path');

const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
const filePath = path.join(__dirname, 'uploads', 'bc4258d4-bd25-4253-a106-9d0ffe263d0b.mp4');

if (!fs.existsSync(filePath)) {
  console.error('Source file not found:', filePath);
  process.exit(1);
}

const stat = fs.statSync(filePath);
console.log(`Source file: ${filePath}`);
console.log(`Size: ${stat.size} bytes`);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/process-file',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  },
};

const optionsJson = JSON.stringify({ maxClips: 2, clipLength: 60, language: 'auto' });

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => console.log('Response:', data));
});

req.on('error', (e) => {
  console.error('Error:', e.message);
  process.exit(1);
});

// Build multipart body
const fileStream = fs.createReadStream(filePath);

// Write mode field
req.write(`--${boundary}\r\n`);
req.write('Content-Disposition: form-data; name="mode"\r\n\r\n');
req.write('auto\r\n');

// Write options field
req.write(`--${boundary}\r\n`);
req.write('Content-Disposition: form-data; name="options"\r\n\r\n');
req.write(`${optionsJson}\r\n`);

// Write file field header
req.write(`--${boundary}\r\n`);
req.write(`Content-Disposition: form-data; name="video"; filename="bc4258d4.mp4"\r\n`);
req.write('Content-Type: video/mp4\r\n\r\n');

fileStream.on('data', (chunk) => req.write(chunk));
fileStream.on('end', () => {
  req.write(`\r\n--${boundary}--\r\n`);
  req.end();
});
