# Atlantic AI — Monorepo

AI video clipping platform. Watches long-form video, finds the best moments,
cuts vertical clips with word-accurate burned-in captions.

## Structure

```
atlantic-ai/
├── backend/          Node/Express server. FFmpeg + Gemini pipeline.
│   ├── src/          All processing logic (analysis, captions, render).
│   ├── .env.example  Copy to .env and fill in GEMINI_API_KEY.
│   └── package.json
│
├── frontend/         The REAL app — upload, job status, clip editor.
│   └── public/       Vanilla JS + HTML/CSS. Served directly by backend
│                     (backend/src/server.js serves this folder).
│
├── landing/          NEW marketing homepage. React + Vite + TS + Tailwind.
│   ├── src/
│   ├── .env          Points "Start clipping" button at the backend URL.
│   └── package.json
│
└── package.json      Root scripts to run everything together.
```

Both `frontend/public` (the working app) and `landing/` (the new homepage)
now share the same green/black visual identity — colors, fonts, and overall
feel match across both.

## First-time setup

```bash
npm run install:all
```

This installs dependencies for both `backend/` and `landing/`.

Then set up your Gemini API key:

```bash
cp backend/.env.example backend/.env
# open backend/.env and paste in your GEMINI_API_KEY
```

Get a key at https://aistudio.google.com/apikey if you don't have one.

You'll also need **FFmpeg** and **yt-dlp** installed and available on your
system PATH (these are not npm packages — install them separately).
- **yt-dlp**: Keep updated regularly via `yt-dlp -U` to avoid YouTube 403 / extractor blocks.
- **Deno / Node / QuickJS**: A JavaScript runtime like **Deno** (`winget install DenoLand.Deno`) should be available on PATH for yt-dlp YouTube challenge/PO-token solving.
- **YouTube Cookies**: If YouTube downloads require authentication or 403, export your YouTube cookies using a browser extension (like "Get cookies.txt LOCALLY") and save them into `backend/cookies.txt`.

## Running everything

**Option A — run both at once:**

```bash
npm run dev
```

This starts the backend on `http://localhost:3000` (which also serves the
real Atlantic AI app at that same URL) and the new landing page on
`http://localhost:5173`, in parallel.

**Option B — run them separately (two terminals):**

```bash
# Terminal 1
npm run dev:backend     # -> http://localhost:3000  (real app)

# Terminal 2
npm run dev:landing     # -> http://localhost:5173  (new homepage)
```

## How they connect

Visit `http://localhost:5173` to see the new homepage. Clicking
**"Start clipping"** or **"Go to Atlantic AI"** redirects to
`http://localhost:3000` — the real, working app with upload, Gemini
analysis, FFmpeg clipping, and the caption editor.

That redirect target is set in `landing/.env`:

```
VITE_ATLANTIC_APP_URL=http://localhost:3000
```

When you deploy for real, change this to your production backend URL.

## Opening this in Antigravity

1. Unzip this folder.
2. In Antigravity, choose **Open Folder** and select the unzipped
   `atlantic-ai` directory (the one containing this README).
3. Open a terminal inside Antigravity and run `npm run install:all`.
4. Run `npm run dev` to start both apps.

No file uploads, no copy-pasting code into chat — Antigravity opens the
whole project directly from disk.

## What NOT to touch unless you mean to

- `backend/src/processor.js`, `mediaAnalysis.js`, `captionEngine.js` — the
  core pipeline. Already fixed for word-accurate subtitle timing.
- `frontend/public/app.js`, `canvas.js` — the real app's logic.

Everything here is a straight, working port of the original Atlantic AI
codebase plus the new landing page — no functionality was removed.
