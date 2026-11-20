import test from 'node:test';
import assert from 'node:assert/strict';
import { buildViralScout, parseViralScout } from '../shared/clippers-viral-scout.mjs';
import { ALL_DISCOVERY_CREATORS } from '../shared/clippers-priority-creators.mjs';

const NOW = Date.parse('2026-11-18T16:00:00.000Z'), HOUR = 3_600_000;
const at = hours => new Date(NOW + hours * HOUR).toISOString();
const c = ALL_DISCOVERY_CREATORS[0];
function row(overrides = {}) {
  return { creatorId: c.id, channelId: c.channelId, network: 'youtube', videoId: 'abcdefghijk', title: 'Original public research fixture',
    url: 'https://www.youtube.com/watch?v=abcdefghijk', sourceUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`,
    publishedAt: at(-12), observedAt: at(0), views: 100, metricEvidence: 'direct_public_feed', permission: 'unknown', mayPublish: false, ...overrides };
}
function receipt(rows = [row()], overrides = {}) {
  return { schemaVersion: 2, observedAt: at(0), paidSpendUsd: 0, permission: 'unknown', mayPublish: false,
    feeds: ALL_DISCOVERY_CREATORS.map(c => ({ creatorId: c.id, channelId: c.channelId, sourceUrl:`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`, status: 'observed', feedSha256: 'a'.repeat(64) })).slice(0, 14), observations: rows, ...overrides };
}
const run = (receipts, now = NOW) => buildViralScout(receipts, new Date(now));

test('official-feed candidates preserve source, title and unknown rights without work or spend', () => {
  const r = run([receipt()]);
  assert.equal(r.status, 'candidates'); assert.equal(r.requestsAdded, 0); assert.equal(r.paidSpendUsd, 0); assert.equal(r.mayPublish, false);
  assert.deepEqual(r.candidates[0], { creatorId: c.id, channelId: c.channelId, creatorName: c.name, videoId: 'abcdefghijk', title: row().title,
    url: row().url, sourceUrl: row().sourceUrl, publishedAt: at(-12), observedAt: at(0), views: 100, likes: null, ageHoursWhenObserved: 12,
    previousObservedAt: null, previousViews: null, sampleSpanHours: null, growthViews: null, growthPerHour: null, evidence: 'popularity_observed', rights: 'unknown', mayPublish: false });
  assert.deepEqual(parseViralScout(r, NOW), r);
});
test('two same-author/video/publication snapshots at least an hour apart measure growth', () => {
  const prior = row({ observedAt: at(-2), views: 40 });
  const r = run([receipt([prior], { observedAt: at(-2) }), receipt()]);
  assert.equal(r.candidates[0].growthPerHour, 30); assert.equal(r.candidates[0].growthViews, 60);
  assert.equal(r.candidates[0].evidence, 'growth_observed'); assert.ok(parseViralScout(r, NOW));
});
test('measured growth outranks a larger one-sample public counter', () => {
  const big = row({ videoId: 'aaaaaaaaaaa', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', views: 1_000_000 });
  const r = run([receipt([row({ observedAt: at(-2), views: 40 })]), receipt([big, row()])]);
  assert.deepEqual(r.candidates.map(c => c.videoId), ['abcdefghijk', 'aaaaaaaaaaa']);
});
test('replayed summaries and same-hour snapshots never fabricate growth', () => {
  const r = receipt(); assert.equal(run([r, structuredClone(r), receipt([row({ observedAt: at(-.5), views: 1 })])]).candidates[0].growthPerHour, null);
});
test('a changed publication timestamp cannot join a prior snapshot', () => {
  assert.equal(run([receipt([row({ observedAt: at(-2), views: 40, publishedAt: at(-13) })]), receipt()]).candidates[0].growthPerHour, null);
});
test('unchanged and falling counters remain explicit, with no positive growth claim', () => {
  for (const [priorViews, evidence] of [[100, 'counter_unchanged'], [200, 'counter_decreased']]) {
    const r = run([receipt([row({ observedAt: at(-2), views: priorViews })]), receipt()]);
    assert.equal(r.candidates[0].evidence, evidence); assert.ok(parseViralScout(r, NOW));
  }
});
test('missing latest views stays unknown rather than borrowing an old value or zero', () => {
  const r = run([receipt([row({ observedAt: at(-2), views: 40 })]), receipt([row({ views: null, metricEvidence: 'not_provided' })])]);
  assert.equal(r.candidates[0].views, null); assert.equal(r.candidates[0].evidence, 'metrics_unknown'); assert.equal(r.candidates[0].previousViews, null);
});
test('views zero is a real counter and not missing data', () => {
  const r = run([receipt([row({ views: 0 })])]); assert.equal(r.candidates[0].views, 0); assert.equal(r.candidates[0].evidence, 'popularity_observed');
});
test('unavailable, stale and empty feeds have distinct no-data states', () => {
  assert.equal(run([]).status, 'no_data'); assert.equal(run([receipt([], { feeds: [] })]).status, 'no_data');
  assert.equal(run([receipt([])]).status, 'no_recent_candidates');
  assert.equal(run([receipt([row({ publishedAt: at(-73) })])]).status, 'no_recent_candidates');
  assert.equal(run([receipt([row({ observedAt: at(-27), publishedAt: at(-30) })], { observedAt: at(-27) })]).status, 'no_data');
});
test('conflicting authors or same-time counters exclude the entire video', () => {
  const other = ALL_DISCOVERY_CREATORS[1];
  assert.equal(run([receipt([row(), row({ creatorId: other.id, channelId: other.channelId, sourceUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${other.channelId}` })])]).candidates.length, 0);
  assert.equal(run([receipt(), receipt([row({ views: 999 })])]).candidates.length, 0);
});
test('unsafe links, channel mismatches, rights injection and unsupported counters are excluded', () => {
  const bad = [ { url: 'https://evil.example/video' }, { sourceUrl: row().sourceUrl + '&tracking=x' }, { creatorId: 'unknown' }, { views: -1 },
    { views: NaN }, { views: null }, { metricEvidence: 'inferred' }, { mayPublish: true }, { permission: 'granted' },
    { publishedAt: at(1) }, { observedAt: at(1) }, { title: 'bad\ntext' }, { title: '' }, { title: 'x'.repeat(501) } ];
  for (const change of bad) assert.equal(run([receipt([row(change)])]).candidates.length, 0, JSON.stringify(change));
});
test('a receipt cannot assert an observation after its own authoritative time', () => {
  assert.equal(run([receipt([row()], { observedAt: at(-1) })]).candidates.length, 0);
});
test('malformed JSON rows are ignored without losing valid candidates or crashing', () => {
  const r = receipt();r.feeds.unshift(null, [], 1);r.observations.unshift(null, [], {}, 1);
  // Stay within the per-receipt feed cap while exercising malformed rows.
  r.feeds = r.feeds.slice(0, 14);
  assert.equal(run([r]).candidates.length,1);
  assert.equal(run([receipt([], {feeds:[null]})]).status,'no_data');
});
test('identity arrays and forged/coerced feed proofs are rejected', () => {
  assert.equal(run([receipt([row({videoId:['abcdefghijk']})])]).candidates.length,0);
  for(const change of [{sourceUrl:'https://evil.example/feed'}, {sourceUrl:row().sourceUrl+'&extra=1'}, {feedSha256:['a'.repeat(64)]}]){
    const r=receipt();r.feeds=[{...r.feeds[0],...change}];assert.equal(run([r]).status,'no_data');
  }
  const r=run([receipt()]);r.candidates[0].videoId=['abcdefghijk'];assert.equal(parseViralScout(r,NOW),null);
});
test('foreign/malformed/paid/publishing envelopes do not create candidates', () => {
  for (const change of [{ paidSpendUsd: 1 }, { mayPublish: true }, { permission: 'approved' }, { schemaVersion: 9 }, { observedAt: at(1) }, { feeds: [] }])
    assert.equal(run([receipt([row()], change)]).candidates.length, 0);
});
test('shortlist bounds, stable ranking and input immutability', () => {
  const rows = Array.from({ length: 30 }, (_, i) => { const videoId = String(i).padStart(11, 'a'); return row({ videoId, url: `https://www.youtube.com/watch?v=${videoId}`, views: i }); });
  const input = [receipt(rows)], before = structuredClone(input), r = run(input);
  assert.equal(r.candidates.length, 20); assert.equal(r.candidates[0].views, 29); assert.equal(r.candidates.at(-1).views, 10); assert.deepEqual(input, before);
  assert.deepEqual(run([receipt(rows.reverse())]), r);
});
test('oversized inputs are held without extending work', () => {
  assert.equal(run(Array(129).fill(receipt())).status, 'no_data');
  assert.equal(run(Array(32).fill(receipt(Array(350).fill(row())))).status, 'no_data');
});
test('wire refuses forged rank, URL, metrics, identity, permission and new fields', () => {
  const good = run([receipt([row({ observedAt: at(-2), views: 40 })]), receipt()]);
  for (const change of [{ growthViews: 999 }, { growthPerHour: 999 }, { previousObservedAt: at(-.5) }, { evidence: 'viral_confirmed' }, { likes: 1 }, { mayPublish: true },
    { url: 'javascript:alert(1)' }, { creatorName: 'forged' }, { sourceUrl: 'https://evil.example/' }, { extra: 1 }]) {
    const bad = structuredClone(good); Object.assign(bad.candidates[0], change); assert.equal(parseViralScout(bad, NOW), null, JSON.stringify(change));
  }
  for (const change of [{ requestsAdded: 1 }, { paidSpendUsd: 1 }, { status: 'no_data' }, { evaluatedAt: at(1) }, { scope: 'all_internet' }]) {
    assert.equal(parseViralScout({ ...good, ...change }, NOW), null);
  }
});
test('stored snapshots remain parseable later without relabeling them as fresh', () => {
  const r = run([receipt()]); assert.ok(parseViralScout(r, NOW + 96 * HOUR)); assert.equal(r.candidates[0].observedAt, at(0));
});
