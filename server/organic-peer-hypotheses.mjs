/** Public observations propose experiments; they never constitute own-brand winners. */
export function buildOrganicPeerHypotheses(input, now = new Date()) {
  const cutoff = now.getTime() - 30 * 86400000;
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid evaluation time');
  const seen = new Set();
  const rows = (Array.isArray(input) ? input : []).slice(0, 1000).flatMap(row => {
    try {
      const u = new URL(row.url);
      const observed = Date.parse(row.observedAt), published = Date.parse(row.publishedAt);
      if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash ||
          !['www.youtube.com', 'youtube.com'].includes(u.hostname) || !/^\/shorts\/[A-Za-z0-9_-]{11}$/.test(u.pathname) ||
          !['blackroom', 'kong'].includes(row.relevantTo) || !Number.isFinite(observed) || !Number.isFinite(published) ||
          observed < cutoff || observed > now.getTime() || published > observed || published < cutoff ||
          !Number.isFinite(row.durationSeconds) || row.durationSeconds <= 0 || row.durationSeconds > 180 ||
          !Number.isInteger(row.views) || row.views < 0) return [];
      const key = row.relevantTo + u.pathname;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ relevantTo: row.relevantTo, url: 'https://www.youtube.com' + u.pathname,
        observedAt: row.observedAt, publishedAt: row.publishedAt, durationSeconds: row.durationSeconds, views: row.views }];
    } catch { return []; }
  });
  return { version: 1, evaluatedAt: now.toISOString(), mode: 'proposal_only', mayPublish: false,
    brands: ['blackroom', 'kong'].map(brand => {
      const evidence = rows.filter(row => row.relevantTo === brand);
      const eligible = evidence.length >= 3;
      const durations = evidence.map(e => e.durationSeconds).sort((a,b)=>a-b);
      const medianSeconds = durations.length ? durations[Math.floor(durations.length/2)] : null;
      return { brand, reasoningMode:'deterministic_observational', medianSeconds, status: eligible ? 'hypothesis' : 'insufficient_evidence', evidence,
        proposal: eligible ? `Observed median duration ${medianSeconds}s; test nearby own-content durations against the existing control, not a winner claim.` : null,
        peer: brand === 'blackroom' ? 'kong' : 'blackroom',
        challenge: brand === 'blackroom' ? 'KONG perspective: a DJ-set clip does not measure local event intent; views cannot justify changing event promotion.' : 'BlackRoom perspective: local venue promotion cannot establish a DJ-set retention winner.',
        experiment: eligible ? { durations: [15, 30, 60], outcome: 'own_network_matched_age_results',
          controls: ['source', 'language', 'orientation', 'hook', 'daypart'], replaceVerifiedWinner: false } : null };
    }) };
}
