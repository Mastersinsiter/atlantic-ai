================================================================================

#!/bin/bash
set -e
echo "============================================"
echo "  Atlantic AI Setup"
echo "============================================"
echo

echo "[1/4] Checking Node.js..."
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org"
  exit 1
fi
echo "OK: $(node --version)"

echo "[2/4] Checking FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
  echo "WARNING: FFmpeg not found."
  echo "Install: brew install ffmpeg (Mac) or sudo apt install ffmpeg (Linux)"
fi

echo "[3/4] Checking yt-dlp..."
if ! command -v yt-dlp &> /dev/null; then
  echo "WARNING: yt-dlp not found."
  echo "Install: brew install yt-dlp (Mac) or pip install yt-dlp (Linux)"
fi

echo "[4/4] Installing backend dependencies..."
cd backend
npm install
echo "Done."

echo
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo
echo "Next steps:"
echo "1. cp backend/.env.example backend/.env"
echo "2. Add your ANTHROPIC_API_KEY to .env"
echo "3. Add YouTube credentials to .env (for uploads)"
echo "4. cd backend && npm start"
echo "5. Open frontend/public/index.html in your browser"
echo


================================================================================
