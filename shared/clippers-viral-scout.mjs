import { ALL_DISCOVERY_CREATORS } from './clippers-priority-creators.mjs';

// Pure public-metadata scouting. This module never fetches, downloads, grants
// rights, prepares media or changes the publisher's ready queue.
const HOUR = 3_600_000;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_CANDIDATES = 20;
const creators = new Map(ALL_DISCOVERY_CREATORS.map(c => [c.channelId, c]));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const count = value => Number.isSafeInteger(value) && value >= 0;
const keys = (value, names) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && Object.keys(value).every(k => names.includes(k));
const feedUrl = channel => `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`;
const watchUrl = video => `https://www.youtube.com/watch?v=${video}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function feedProof(feed, creator) {
  return object(feed) && !!creator && feed.creatorId === creator.id && feed.channelId === creator.channelId &&
    feed.sourceUrl === feedUrl(creator.channelId) && feed.status === 'observed' && typeof feed.feedSha256 === 'string' && SHA.test(feed.feedSha256);
}

function observation(raw, receipt, now) {
  if (!object(raw)) return null;
  const c = creators.get(raw?.channelId);
  if (!c || c.id !== raw.creatorId || typeof raw.videoId !== 'string' || !VIDEO.test(raw.videoId) || raw.network !== 'youtube' ||
      raw.url !== watchUrl(raw.videoId) || raw.sourceUrl !== feedUrl(c.channelId) ||
      raw.permission !== 'unknown' || raw.mayPublish !== false ||
      typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 500 || /[\x00-\x1f\x7f]/.test(raw.title) ||
      !iso(raw.publishedAt) || !iso(raw.observedAt) || Date.parse(raw.publishedAt) > Date.parse(raw.observedAt) || Date.parse(raw.observedAt) > now || Date.parse(raw.observedAt) > Date.parse(receipt.observedAt) ||
      (raw.metricEvidence === 'direct_public_feed' ? !count(raw.views) : raw.metricEvidence !== 'not_provided' || raw.views !== null) ||
      !receipt.feeds.some(f => feedProof(f, c))) return null;
  return { creatorId: c.id, channelId: c.channelId, creatorName: c.name ?? c.handle, videoId: raw.videoId,
    title: raw.title, url: raw.url, sourceUrl: raw.sourceUrl, publishedAt: raw.publishedAt, observedAt: raw.observedAt, views: raw.views };
}

/** Rank candidates from existing receipts; replayed summaries never add samples. */
export function buildViralScout(receipts, now = new Date()) {
  const at = +now;
  if (!Number.isFinite(at)) throw Error('invalid_scout_time');
  const result = { schemaVersion: 1, evaluatedAt: new Date(at).toISOString(), status: 'no_data', source: 'official_youtube_feeds',
    scope: 'configured_catalogue', requestsAdded: 0, paidSpendUsd: 0, mayPublish: false, candidates: [] };
  if (!Array.isArray(receipts) || receipts.length > 128) return result;
  const snapshots = new Map(), conflicts = new Set(), owners = new Map();
  let seen = 0, readable = false;
  for (const receipt of receipts) {
    if (![1, 2].includes(receipt?.schemaVersion) || receipt.paidSpendUsd !== 0 || receipt.mayPublish !== false || receipt.permission !== 'unknown' ||
        !iso(receipt.observedAt) || Date.parse(receipt.observedAt) > at || !Array.isArray(receipt.feeds) || receipt.feeds.length > 14 ||
        !Array.isArray(receipt.observations) || receipt.observations.length > 350) continue;
    if ((seen += receipt.observations.length) > 10_000) return result;
    if (receipt.feeds.some(f => feedProof(f, object(f) ? creators.get(f.channelId) : null)) && at - Date.parse(receipt.observedAt) <= 26 * HOUR) readable = true;
    for (const raw of receipt.observations) {
      const row = observation(raw, receipt, at);
      if (!row) continue;
      const owner = owners.get(row.videoId);
      if (owner && owner !== row.channelId) conflicts.add(row.videoId);
      owners.set(row.videoId, row.channelId);
      const key = `${row.channelId}:${row.videoId}:${row.observedAt}`;
      if (snapshots.has(key) && !same(snapshots.get(key), row)) conflicts.add(row.videoId);
      snapshots.set(key, row);
    }
  }
  const videos = new Map();
  for (const row of snapshots.values()) {
    if (conflicts.has(row.videoId)) continue;
    const rows = videos.get(row.videoId) ?? []; rows.push(row); videos.set(row.videoId, rows);
  }
  for (const rows of videos.values()) {
    rows.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const current = rows.at(-1);
    if (at - Date.parse(current.publishedAt) > 72 * HOUR || at - Date.parse(current.observedAt) > 26 * HOUR) continue;
    const previous = current.views === null ? null : rows.slice(0, -1).filter(r => r.publishedAt === current.publishedAt && r.views !== null &&
      Date.parse(r.observedAt) <= Date.parse(current.observedAt) - HOUR && at - Date.parse(r.observedAt) <= 72 * HOUR).at(-1);
    const sampleSpanHours = previous ? (Date.parse(current.observedAt) - Date.parse(previous.observedAt)) / HOUR : null;
    const growthViews = previous ? current.views - previous.views : null;
    result.candidates.push({ ...current, likes: null, ageHoursWhenObserved: (Date.parse(current.observedAt) - Date.parse(current.publishedAt)) / HOUR,
      previousObservedAt: previous?.observedAt ?? null, previousViews: previous?.views ?? null, sampleSpanHours, growthViews,
      growthPerHour: previous ? growthViews / sampleSpanHours : null,
      evidence: current.views === null ? 'metrics_unknown' : !previous ? 'popularity_observed' : growthViews > 0 ? 'growth_observed' : growthViews === 0 ? 'counter_unchanged' : 'counter_decreased',
      rights: 'unknown', mayPublish: false });
  }
  result.candidates.sort(compareCandidates);
  result.candidates = result.candidates.slice(0, MAX_CANDIDATES);
  result.status = result.candidates.length ? 'candidates' : readable ? 'no_recent_candidates' : 'no_data';
  return result;
}

function compareCandidates(a, b) {
  return Number(b.evidence === 'growth_observed') - Number(a.evidence === 'growth_observed') ||
    (b.evidence === 'growth_observed' ? b.growthPerHour - a.growthPerHour : 0) ||
    Number(b.views !== null) - Number(a.views !== null) || (b.views ?? 0) - (a.views ?? 0) ||
    b.publishedAt.localeCompare(a.publishedAt) || a.videoId.localeCompare(b.videoId);
}

/** Optional wire extension: old reports remain valid; new data is exact and bounded. */
export function parseViralScout(value, now = Date.now()) {
  if (!keys(value, ['schemaVersion','evaluatedAt','status','source','scope','requestsAdded','paidSpendUsd','mayPublish','candidates']) || value.schemaVersion !== 1 ||
      !iso(value.evaluatedAt) || Date.parse(value.evaluatedAt) > now || value.source !== 'official_youtube_feeds' || value.scope !== 'configured_catalogue' ||
      value.requestsAdded !== 0 || value.paidSpendUsd !== 0 || value.mayPublish !== false ||
      !['candidates','no_recent_candidates','no_data'].includes(value.status) || !Array.isArray(value.candidates) || value.candidates.length > MAX_CANDIDATES ||
      (value.status === 'candidates') !== (value.candidates.length > 0) || new Set(value.candidates.map(c => c?.videoId)).size !== value.candidates.length) return null;
  const at = Date.parse(value.evaluatedAt);
  for (const row of value.candidates) {
    const c = creators.get(row?.channelId);
    if (!keys(row, ['creatorId','channelId','creatorName','videoId','title','url','sourceUrl','publishedAt','observedAt','views','likes','ageHoursWhenObserved','previousObservedAt','previousViews','sampleSpanHours','growthViews','growthPerHour','evidence','rights','mayPublish']) || !c || c.id !== row.creatorId || row.creatorName !== (c.name ?? c.handle) ||
        typeof row.videoId !== 'string' || !VIDEO.test(row.videoId) || row.url !== watchUrl(row.videoId) || row.sourceUrl !== feedUrl(c.channelId) ||
        typeof row.title !== 'string' || !row.title.trim() || row.title.length > 500 || /[\x00-\x1f\x7f]/.test(row.title) ||
        !iso(row.publishedAt) || !iso(row.observedAt) || Date.parse(row.observedAt) > at || Date.parse(row.publishedAt) > Date.parse(row.observedAt) ||
        at - Date.parse(row.publishedAt) > 72 * HOUR || at - Date.parse(row.observedAt) > 26 * HOUR ||
        row.ageHoursWhenObserved !== (Date.parse(row.observedAt) - Date.parse(row.publishedAt)) / HOUR || !(row.views === null || count(row.views)) || row.likes !== null || row.rights !== 'unknown' || row.mayPublish !== false) return null;
    if (row.previousObservedAt === null) {
      if ([row.previousViews,row.sampleSpanHours,row.growthViews,row.growthPerHour].some(v => v !== null) || row.evidence !== (row.views === null ? 'metrics_unknown' : 'popularity_observed')) return null;
    } else {
      if (!iso(row.previousObservedAt) || Date.parse(row.previousObservedAt) < Date.parse(row.publishedAt) || at - Date.parse(row.previousObservedAt) > 72 * HOUR || !count(row.previousViews) || !count(row.views) ||
          row.sampleSpanHours !== (Date.parse(row.observedAt) - Date.parse(row.previousObservedAt)) / HOUR || row.sampleSpanHours < 1 ||
          row.growthViews !== row.views - row.previousViews || row.growthPerHour !== row.growthViews / row.sampleSpanHours ||
          row.evidence !== (row.growthViews > 0 ? 'growth_observed' : row.growthViews === 0 ? 'counter_unchanged' : 'counter_decreased')) return null;
    }
  }
  if (value.candidates.some((c, i) => i && compareCandidates(value.candidates[i - 1], c) > 0)) return null;
  return structuredClone(value);
}
