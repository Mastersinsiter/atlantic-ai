import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, '../youtube_token.json');

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/api/auth/youtube/callback'
);

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

if (fs.existsSync(TOKEN_PATH)) {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oauth2Client.setCredentials(token);
}

export function getAuthUrl() {
  return oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
}

export async function handleCallback(code) {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  return tokens;
}

export async function uploadToYouTube({ filePath, title, description, tags, categoryId = '22', privacyStatus = 'public' }) {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error('YouTube not authenticated. Visit /api/auth/youtube first.');
  }

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const fileSize = fs.statSync(filePath).size;

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 100),
        description,
        tags,
        categoryId,
        defaultLanguage: 'en',
      },
      status: { privacyStatus, selfDeclaredMadeForKids: false }
    },
    media: {
      body: fs.createReadStream(filePath)
    }
  }, {
    onUploadProgress: evt => {
      const pct = Math.round((evt.bytesRead / fileSize) * 100);
      console.log(`Upload progress: ${pct}%`);
    }
  });

  return {
    id: res.data.id,
    url: `https://www.youtube.com/shorts/${res.data.id}`
  };
}

// TikTok upload (placeholder - requires TikTok API integration)
export async function uploadToTikTok({ filePath, title, tags }) {
  // TikTok API requires developer account and app approval
  // https://developers.tiktok.com/
  throw new Error('TikTok integration: Set TIKTOK_CLIENT_ID and TIKTOK_CLIENT_SECRET in .env');
}

// Instagram upload (placeholder - requires Graph API)
export async function uploadToInstagram({ filePath, caption, tags }) {
  // Instagram Graph API requires Facebook Developer account
  // https://developers.facebook.com/docs/instagram-api/
  throw new Error('Instagram integration: Set INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET in .env');
}


