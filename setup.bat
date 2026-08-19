================================================================================

@echo off
echo ============================================
echo   Atlantic AI Setup
echo ============================================
echo.

echo [1/3] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo ERROR: Node.js not found. Install from https://nodejs.org
  pause & exit /b 1
)
echo OK: Node.js found

echo [2/3] Checking FFmpeg...
ffmpeg -version >nul 2>&1
if %errorlevel% neq 0 (
  echo WARNING: FFmpeg not found.
  echo Install: winget install ffmpeg
)

echo [3/3] Installing backend dependencies...
cd backend
npm install
if %errorlevel% neq 0 (
  echo ERROR: npm install failed
  pause & exit /b 1
)

echo.
echo ============================================
echo   Setup Complete!
echo ============================================
echo.
echo Next steps:
echo 1. Copy backend\.env.example to backend\.env
echo 2. Add your GEMINI_API_KEY to .env
echo 3. Add YouTube credentials to .env (for uploads)
echo 4. Run: cd backend && npm start
echo 5. Open frontend\public\index.html in your browser
echo.
pause


================================================================================
