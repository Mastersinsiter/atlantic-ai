/** Normalized word-level transcript schema for all pipelines */

export function normalizeWord(w) {
  const word = (w.word ?? w.text ?? '').trim();
  if (!word) return null;
  return {
    word,
    start: Number(w.start) || 0,
    end: Number(w.end) || 0,
    probability: w.probability != null ? Number(w.probability) : undefined
  };
}

export function normalizeSegment(seg) {
  const words = (seg.words || [])
    .map(normalizeWord)
    .filter(Boolean);
  const text = (seg.text || words.map(w => w.word).join(' ')).trim();
  return {
    start: Number(seg.start) || 0,
    end: Number(seg.end) || 0,
    text,
    words
  };
}

export function normalizeTranscript(segments = []) {
  return segments.map(normalizeSegment).filter(s => s.text || s.words.length);
}

export function wordsInWindow(segments, start, end) {
  const out = [];
  for (const seg of segments) {
    if (seg.end <= start || seg.start >= end) continue;
    if (seg.words?.length) {
      for (const w of seg.words) {
        if (w.end > start && w.start < end) out.push(w);
      }
    } else if (seg.text) {
      out.push({ word: seg.text, start: Math.max(seg.start, start), end: Math.min(seg.end, end) });
    }
  }
  return out;
}

export function textInWindow(segments, start, end) {
  return wordsInWindow(segments, start, end).map(w => w.word).join(' ');
}

export function chunkTranscriptForSearch(segments, chunkSec = 12) {
  if (!segments.length) return [];
  const end = segments[segments.length - 1].end;
  const chunks = [];
  for (let t = 0; t < end; t += chunkSec) {
    const text = textInWindow(segments, t, t + chunkSec);
    if (text.trim().length > 8) {
      chunks.push({ start: t, end: t + chunkSec, text: text.trim() });
    }
  }
  return chunks;
}

export const SUPPORTED_LANGUAGES = [
  'hi', 'en', 'hinglish', 'mr', 'gu', 'bn', 'ta', 'te',
  'kn', 'ml', 'pa', 'ur', 'or', 'as'
];

export function detectIndianCreatorMode(language, segments = []) {
  const lang = (language || '').toLowerCase();
  const sample = segments.slice(0, 30).map(s => s.text).join(' ');
  const hinglish = /(yaar|bhai|kya|hai|nahi|acha|matlab|bro|arre)/i.test(sample);
  const indicLangs = ['hi', 'mr', 'gu', 'bn', 'ta', 'te', 'kn', 'ml', 'pa', 'ur', 'or', 'as', 'hinglish'];
  if (indicLangs.includes(lang) || hinglish) {
    return { enabled: true, language: lang === 'en' && hinglish ? 'hinglish' : lang };
  }
  return { enabled: false, language: lang || 'en' };
}


