================================================================================

@echo off
title Atlantic AI
cd /d "%~dp0backend"
echo.
echo  Starting Atlantic AI...
echo  Open in browser:  http://localhost:3000
echo  (Do NOT open the HTML file directly)
echo.

REM Kill any existing processes on our ports
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8765 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 /nobreak >nul

REM Start Faster-Whisper transcription server in background
echo  Starting Faster-Whisper transcription server (port 8765)...
start "Faster-Whisper" /min python src\transcription_server.py

REM Wait for transcription server to be ready
echo  Waiting for transcription server...
:wait_transcribe
timeout /t 1 /nobreak >nul
netstat -ano | findstr :8765 | findstr LISTENING >nul
if %errorlevel% neq 0 goto wait_transcribe
echo  Transcription server ready.

start "" "http://localhost:3000"
npm start
pause
