# Atlantic AI — Production Container
# Serves the Express backend + frontend static files on $PORT (default 8080).
FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

# System dependencies:
#   ffmpeg/ffprobe  – video/audio processing & 4K render pipeline
#   python3 + pip   – aligner.py tooling
#   yt-dlp          – YouTube source downloads
#   fonts-dejavu    – subtitle rendering (libass needs a system font)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
       python3 \
       python3-pip \
       ca-certificates \
       curl \
       fonts-dejavu-core \
    && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend Node dependencies first (better Docker layer caching).
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy backend source + frontend static files.
# server.js expects frontend at ../../frontend/public relative to backend/src/.
COPY backend ./backend
COPY frontend ./frontend

# Pre-create writable dirs the app needs at runtime.
RUN mkdir -p backend/uploads backend/outputs

EXPOSE 8080

CMD ["node", "backend/src/server.js"]
