/**
 * Future-ready chat explosion detection (Twitch / Kick / YouTube Live)
 * Stub pipeline — wire when chat logs are available per job.
 */

export const CHAT_SPAM_PATTERNS = {
  w: /^w+$/i,
  gg: /^gg+$/i,
  lol: /^lol+$/i,
  noway: /no\s*way|noway/i
};

export function analyzeChatWindow(messages = [], windowStart, windowEnd) {
  const inWindow = messages.filter(m => m.t >= windowStart && m.t <= windowEnd);
  if (!inWindow.length) return { spike: false, score: 0, dominant: null };

  const counts = { w: 0, gg: 0, lol: 0, noway: 0, total: inWindow.length };
  for (const m of inWindow) {
    const text = (m.text || '').trim();
    if (CHAT_SPAM_PATTERNS.w.test(text)) counts.w++;
    else if (CHAT_SPAM_PATTERNS.gg.test(text)) counts.gg++;
    else if (CHAT_SPAM_PATTERNS.lol.test(text)) counts.lol++;
    else if (CHAT_SPAM_PATTERNS.noway.test(text)) counts.noway++;
  }

  const rate = inWindow.length / Math.max(1, windowEnd - windowStart);
  const spike = rate > 2.5 || counts.w > 15 || counts.gg > 10;
  let dominant = null;
  let max = 0;
  for (const k of ['w', 'gg', 'lol', 'noway']) {
    if (counts[k] > max) { max = counts[k]; dominant = k; }
  }

  return {
    spike,
    score: Math.min(100, Math.round(rate * 12 + max * 2)),
    dominant,
    counts,
    platform: 'generic'
  };
}

export function createChatPipeline(job) {
  return {
    jobId: job.id,
    status: 'ready',
    platforms: ['twitch', 'kick', 'youtube_live'],
    ingest(messages) {
      job.chatMessages = job.chatMessages || [];
      job.chatMessages.push(...messages);
    },
    scoreWindow(start, end) {
      return analyzeChatWindow(job.chatMessages || [], start, end);
    }
  };
}


