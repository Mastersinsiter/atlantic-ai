const fs = require('fs');
const http = require('http');

const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
const filePath = './short.mp4';

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/process-file',
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data));
});

req.write('--' + boundary + '\r\n');
req.write('Content-Disposition: form-data; name="video"; filename="test_video.mp4"\r\n');
req.write('Content-Type: video/mp4\r\n\r\n');

const fileStream = fs.createReadStream(filePath);
fileStream.on('data', (chunk) => req.write(chunk));
fileStream.on('end', () => {
  req.write('\r\n--' + boundary + '--\r\n');
  req.end();
});
