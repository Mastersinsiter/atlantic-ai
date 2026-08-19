# Atlantic AI — Vercel Backend Deployment

This bundle adds a Vercel container deployment for the existing Atlantic AI monorepo.

## Files

- `Dockerfile.vercel` — builds the Node/Express backend with FFmpeg, Python and yt-dlp.
- `.dockerignore` — keeps local secrets, node_modules and generated media out of the image.

## 1. Copy the two files into the repository root

Your repository should look like:

atlantic-ai/
├── backend/
├── frontend/
├── landing/
├── Dockerfile.vercel
└── .dockerignore

Do NOT put Dockerfile.vercel inside `backend/`.

## 2. Commit and push

From PowerShell:

```powershell
cd C:\Users\ASUS\Downloads\atlantic-ai\atlantic-ai

git add Dockerfile.vercel .dockerignore
git commit -m "Add Vercel backend container"
git push origin main
```

## 3. Create the Vercel backend project

In Vercel:

1. Add New Project
2. Import `Mastersinsiter/atlantic-ai`
3. Project name: `atlantic-ai-backend`
4. Root Directory: `./` (repository root)
5. Framework Preset: Other
6. Do not set a Build Command.
7. Do not set an Output Directory.
8. Deploy.

Vercel will detect `Dockerfile.vercel` at the repository root.

## 4. Add environment variables

Vercel Project → Settings → Environment Variables.

At minimum add:

```text
GEMINI_API_KEY=YOUR_GEMINI_KEY
```

If you use YouTube upload/auth, also add the YouTube variables your backend expects:

```text
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=https://YOUR-BACKEND-DOMAIN/api/auth/youtube/callback
```

Do NOT put these values in GitHub.

## 5. Test the backend

After deployment, open:

```text
https://YOUR-BACKEND-DOMAIN/api/health
```

You should receive JSON containing:

```json
{
  "status": "ok"
}
```

## 6. Important architecture note

The existing Express server serves `frontend/public` and the Docker image therefore copies both `backend/` and `frontend/`.

The current project also has a local Python Faster-Whisper service at `127.0.0.1:8765`; when that service is unavailable, the existing code falls back to Gemini transcription. This Vercel container does not invent a new transcription service.

The existing app also writes uploads/outputs and keeps jobs in memory. That is suitable for an initial demo/test deployment, but production-scale video processing should eventually move media to object storage and jobs/state to a persistent queue/database.

## 7. Connect the landing page

After you know the backend URL, update the landing project's environment variable:

```text
VITE_ATLANTIC_APP_URL=https://YOUR-BACKEND-DOMAIN
```

Then redeploy the landing project.

Your flow becomes:

Landing page
  → Start clipping
  → Atlantic AI backend
  → upload / Gemini / FFmpeg
  → clips

## 8. yt-dlp Maintenance Note

YouTube client requirements and PO-token challenges change frequently. Keep yt-dlp updated on the server/host machine via `yt-dlp -U` to prevent 403 Forbidden errors and extractor deprecation.

