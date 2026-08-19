export function scoreSubtitles(cards, clipDuration) {
  let score = 100;
  const issues = [];

  for (const card of cards) {
    const duration = Math.max(0.01, card.end - card.start);
    const charsPerSec = card.text.length / duration;

    // Reading speed check
    if (charsPerSec > 25) {
      score -= 10;
      issues.push(`Card "${card.text.slice(0,20)}..." too fast: ${charsPerSec.toFixed(1)} chars/sec`);
    }

    // Duration check
    if (duration < 0.4) {
      score -= 15;
      issues.push(`Card "${card.text.slice(0,20)}..." too short: ${(duration*1000).toFixed(0)}ms`);
    }
    if (duration > 4.0) {
      score -= 5;
      issues.push(`Card "${card.text.slice(0,20)}..." too long: ${duration.toFixed(1)}s`);
    }
  }

  // Overlap check
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].start < cards[i-1].end) {
      score -= 20;
      issues.push(`Overlap between cards ${i} and ${i+1}`);
    }
  }

  // Coverage check
  const speechTime = cards.reduce((sum, c) => sum + (c.end - c.start), 0);
  const coverage = Math.max(0, Math.min(1, speechTime / (clipDuration || 1)));
  if (coverage < 0.3) {
    score -= 10;
    issues.push(`Low coverage: only ${(coverage*100).toFixed(0)}% of clip has captions`);
  }

  return { score: Math.max(0, score), issues };
}
