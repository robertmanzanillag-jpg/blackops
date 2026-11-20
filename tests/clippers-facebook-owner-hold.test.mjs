// Facebook owner-action hold (Metricool "Confirm your identity" ERROR): hold Facebook, keep TikTok,
// queue Facebook copies locally, resume on owner flag/endpoint or a later PUBLISHED Facebook post.
// Fixtures only: no Metricool write API is ever called (the adapter under test only GETs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { buildCreditCaption } from '../shared/clippers-streamer-policy.mjs';
import { STREAMER_STATE_NAMESPACE } from '../script/clippers-streamer-discovery.mjs';
import { createPortfolioMetricool, facebookOwnerActionReason, providerHealthFromRows } from '../script/clippers-portfolio-metricool.mjs';
import { runCloudPublisher, nextHold, HOLD_OWNER_NOTE } from '../script/clippers-streamer-cloud-worker.mjs';
import { applyStreamerOverlay, cloudPublishSummary, registerClippersStreamerRoutes, streamerSelfHealAudits } from '../server/clippers-streamers-status.ts';

const NOW = Date.parse('2026-11-20T14:00:00.000Z'); // 09:00 New York
const FB = { brandId: 6591612, network: 'facebook', account: '1193011863901514' };
const FB_KEY = '6591612:facebook:1193011863901514';
const IDENTITY = 'Confirm your identity before you can publish as this Page. Open the Facebook app on your phone and follow the instructions.';
const ENV = { CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true', METRICOOL_USER_TOKEN: 'metricool-token-123', METRICOOL_USER_ID: '12345',
  CLIPPERS_STREAMER_CLOUD_DESTINATIONS: `6591612:tiktok:news305miami,${FB_KEY}` };

// Fixture: Metricool /api/v2/scheduler/posts rows for brand 6591612 on 2026-11-19 (5 Facebook ERROR, TikTok PUBLISHED).
const errorRow = (i) => ({ id: 9000 + i, blogId: 6591612, text: `fb ${i}`, publicationDate: { dateTime: `2026-11-19T${11 + i}:00:00`, timezone: 'America/New_York' },
  providers: [{ network: 'facebook', status: 'ERROR', detailedStatus: IDENTITY }] });
const tiktokRow = { id: 8000, blogId: 6591612, text: 'tt', publicationDate: { dateTime: '2026-11-19T11:00:00', timezone: 'America/New_York' },
  providers: [{ network: 'tiktok', status: 'PUBLISHED', detailedStatus: 'Published' }] };
const FIXTURE_ERRORS = [...[0, 1, 2, 3, 4].map(errorRow), tiktokRow];
const fbPublishedRow = { id: 9100, blogId: 6591612, text: 'fb ok', publicationDate: { dateTime: '2026-11-20T12:00:00', timezone: 'America/New_York' },
  providers: [{ network: 'facebook', status: 'PUBLISHED', detailedStatus: 'Published' }] };

test('detects identity / checkpoint Facebook errors, ignores ordinary errors', () => {
  assert.equal(facebookOwnerActionReason(IDENTITY), 'facebook_identity_confirmation_required');
  assert.equal(facebookOwnerActionReason('Your account is restricted. Please complete the security check.'), 'facebook_account_action_required');
  assert.equal(facebookOwnerActionReason('Media could not be processed'), null);
  const h = providerHealthFromRows(FIXTURE_ERRORS, FB);
  assert.equal(h.ownerAction.reason, 'facebook_identity_confirmation_required');
  assert.equal(h.ownerAction.at, '2026-11-19T20:00:00.000Z');
  assert.equal(h.published, null, 'TikTok PUBLISHED does not count for Facebook');
});

test('adapter providerHealth only GETs the scheduler (fixture responses)', async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    const day = new URL(url).searchParams.get('start').slice(0, 10);
    return { ok: true, json: async () => ({ data: day === '2026-11-19' ? FIXTURE_ERRORS : [] }), headers: new Map() };
  };
  const m = createPortfolioMetricool({ token: 'metricool-token-123', userId: '12345', fetcher });
  const h = await m.providerHealth(FB, ['2026-11-19', '2026-11-20']);
  assert.equal(h.ownerAction.reason, 'facebook_identity_confirmation_required');
  assert.ok(calls.every(c => c.method === 'GET' && c.url.includes('/api/v2/scheduler/posts')));
});

test('hold transitions: held, owner resolved, provider published, old error not re-held', () => {
  const held = nextHold(undefined, providerHealthFromRows(FIXTURE_ERRORS, FB), { now: NOW });
  assert.equal(held.change, 'held'); assert.equal(held.hold.status, 'held_owner_action'); assert.equal(held.hold.since, '2026-11-19T20:00:00.000Z');
  assert.equal(nextHold(held.hold, providerHealthFromRows(FIXTURE_ERRORS, FB), { now: NOW }).change, null);
  const owner = nextHold(held.hold, providerHealthFromRows(FIXTURE_ERRORS, FB), { now: NOW, ownerResolvedAt: '2026-11-20T13:00:00.000Z' });
  assert.equal(owner.change, 'cleared'); assert.equal(owner.hold.clearedBy, 'owner_resolved');
  assert.equal(nextHold(owner.hold, providerHealthFromRows(FIXTURE_ERRORS, FB), { now: NOW + 1000 }).change, null, 'the 5 old errors are history');
  const pub = nextHold(held.hold, providerHealthFromRows([...FIXTURE_ERRORS, fbPublishedRow], FB), { now: NOW });
  assert.equal(pub.change, 'cleared'); assert.equal(pub.hold.clearedBy, 'provider_published');
});

function candidate(id, ageMin = 120) {
  const sourceUrl = `https://clips.twitch.tv/${id}`;
  return { id: `twitch-clip:${id}`, platform: 'twitch', kind: 'clip', creatorKey: 'twitch:100', handle: 'westcol', title: 'Locura', language: 'es', sourceUrl, durationSec: 30, views: 9000,
    publishedAt: new Date(NOW - ageMin * 60_000).toISOString(), observedAt: new Date(NOW).toISOString(), score: 4, clipPolicy: { status: 'allowed_unless_prohibited' },
    download: { mode: 'needs_local_download' }, approval: { status: 'approved', pendingActionId: `pa-${id}` },
    caption: buildCreditCaption({ handle: 'westcol', platform: 'twitch', sourceUrl, title: 'Locura' }) };
}
const baseState = (cands) => ({ version: 1, updatedAt: null, lastRun: null, takedowns: [], signals: [], candidates: cands,
  creators: { 'twitch:100': { key: 'twitch:100', platform: 'twitch', handle: 'westcol', creatorGroupId: null, policy: { status: 'allowed_unless_prohibited', source: 'channel_description_checked' } } } });
function memoryStore(state) {
  const data = new Map([[STREAMER_STATE_NAMESPACE('o'), JSON.stringify(state)]]);
  return { data, get state() { return JSON.parse(data.get(STREAMER_STATE_NAMESPACE('o'))); }, set state(v) { data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(v)); },
    async read(k) { return data.get(k) ?? null; }, async transact(k, fn) { const v = await fn(data.get(k) ?? null); data.set(k, v); return v; } };
}
function fakeMetricool(rows) {
  const calls = { schedule: [], health: 0, cross: [] };
  return { calls, rows,
    async providerHealth(d) { calls.health++; return providerHealthFromRows(this.rows, d); },
    async preflight() {}, async crossAccountPreflight(d, item) { calls.cross.push(item); }, async schedule(d, item) { calls.schedule.push(item); return { id: `mc-${item.id}`, mediaUrl: 'https://static.metricool.com/x.mp4' }; },
    async confirmSchedule(d, item) { return { id: `mc-${item.id}`, mediaUrl: 'https://static.metricool.com/x.mp4' }; },
    async publication() { return null; }, async metrics() { return null; } };
}
const stager = () => { const s = { removed: [], async upload(f, name) { return { id: 1, url: `https://github.com/o/r/releases/download/t/${name}`, createdAt: new Date(NOW).toISOString() }; }, async remove(id) { s.removed.push(id); return true; }, async sweep() { return 0; } }; return s; };
let renders = 0;
const media = { download: async () => ({ file: '/tmp/x/s.mp4', cut: { start: 0, duration: 30, source: 'full_clip' } }),
  render: async ({ hook }) => ({ file: '/tmp/x/r.mp4', sha256: (renders++ % 2 ? 'b' : 'a').repeat(64), durationSec: 30, sizeBytes: 1000 }), makeDir: async () => mkdtemp(path.join(tmpdir(), 'fbhold-')) };
const okFetch = async () => ({ status: 206, ok: true });
const approvals = { async statuses(o, ids) { return new Map(ids.map(i => [i, 'approved'])); }, async markExecuted() {} };

const FB_ONLY = { ...ENV, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: FB_KEY };
const run = (store, m, st, env, now) => runCloudPublisher({ env, now, owner: 'o', store, approvals, metricool: m, stager: st, fetch: okFetch, ...media, clock: () => now });

test('lane mode while held: the Miami clip goes to TikTok only, nothing queued for Facebook (one account per clip)', async () => {
  const store = memoryStore(baseState([candidate('a')]));
  const m = fakeMetricool(FIXTURE_ERRORS);
  const { report } = await run(store, m, stager(), ENV, NOW);
  assert.deepEqual(m.calls.schedule.map(i => i.destinationKey), ['6591612:tiktok:news305miami']);
  assert.equal(report.counts.heldQueued, 0);
  assert.equal(store.state.cloudPublish.heldQueue.length, 0);
  assert.equal(store.state.cloudPublish.holds[FB_KEY].status, 'held_owner_action');
  assert.ok(!report.heldReasons.some(r => r.includes('facebook')), 'hold is an owner note, not a failure reason');
});

test('lane mode, only Facebook listed: copy queued with lane fields + draft, not sent; owner resolve releases one per run with claim + cross-account check', async () => {
  const store = memoryStore(baseState([candidate('a'), candidate('b', 60)]));
  const m = fakeMetricool(FIXTURE_ERRORS), st = stager();
  const { report } = await run(store, m, st, FB_ONLY, NOW);
  assert.equal(m.calls.schedule.length, 0, 'nothing sent to Metricool while held');
  assert.equal(report.counts.heldQueued, 2);
  assert.equal(report.ownerHolds[0].destination, FB_KEY); assert.equal(report.ownerHolds[0].note, HOLD_OWNER_NOTE);
  let c = store.state.cloudPublish;
  assert.equal(c.heldQueue.length, 2);
  assert.ok(c.heldQueue.every(q => q.destinationKey === FB_KEY && q.lane?.lane === 'miami' && q.lane.segment && q.draft === true));
  assert.equal(c.posts.length, 0, 'never counted as published');
  assert.equal(c.clips['twitch-clip:a'].status, 'held_owner_action');
  assert.ok(c.clips['twitch-clip:a'].mediaAsset, 'media kept for the queued copy');
  assert.equal(st.removed.length, 0);

  // Office: owner note on the Streamers role, no failure, no self-heal order.
  const role = (stage) => ({ id: `clippers-${stage}`, stage, state: 'idle', evidenceAt: null, activeUntil: null, lastRunAt: null, heartbeatAt: null, nextDueAt: null, runId: null, evidenceIds: [], outputs: {}, heldReasons: [], lifePenaltyExempt: false, career: {} });
  const office = { roles: ['supervisor', 'streamers'].map(role) };
  store.state = { ...store.state, lastRun: { at: new Date(NOW).toISOString(), status: 'completed', heldReasons: [], errors: [], counts: {} } };
  applyStreamerOverlay(office, store.data.get(STREAMER_STATE_NAMESPACE('o')), NOW + 60_000);
  const r = office.roles.find(x => x.stage === 'streamers');
  assert.deepEqual(r.ownerNotes, ['Facebook pide verificar identidad en la app']);
  assert.equal(r.state, 'completed');
  assert.deepEqual(streamerSelfHealAudits(store.data.get(STREAMER_STATE_NAMESPACE('o')))[0].findings, []);
  assert.equal(cloudPublishSummary(c).ownerHolds[0].queued, 2);

  // Still held: nothing sent, the 5 failed posts never retried.
  await run(store, m, st, FB_ONLY, NOW + 3600_000);
  assert.equal(m.calls.schedule.length, 0);

  const resolved = { ...FB_ONLY, CLIPPERS_FACEBOOK_HOLD_RESOLVED_AT: '2026-11-20T15:30:00Z' };
  const r1 = await run(store, m, st, resolved, NOW + 2 * 3600_000);
  assert.equal(r1.report.counts.heldReleased, 1);
  c = store.state.cloudPublish;
  assert.equal(c.holds[FB_KEY].clearedBy, 'owner_resolved');
  assert.equal(c.heldQueue.length, 1);
  assert.equal(m.calls.schedule.length, 1);
  const sent = m.calls.schedule[0];
  assert.equal(sent.destinationKey, FB_KEY); assert.equal(sent.lane, 'miami'); assert.equal(sent.draft, true, 'below the 1k gate -> draft');
  assert.equal(m.calls.cross.length, 1, 'cross-account check before the write');
  assert.ok(c.mediaLedger.some(e => e.destinationKey === FB_KEY), 'media-ledger claim recorded');
  await run(store, m, st, resolved, NOW + 3 * 3600_000);
  assert.equal(store.state.cloudPublish.heldQueue.length, 0);
  assert.equal(m.calls.schedule.length, 2);
  assert.notEqual(m.calls.schedule[0].scheduledAt, m.calls.schedule[1].scheduledAt);
});

test('release: cross-account conflict keeps the copy queued and drops the claim (nothing written)', async () => {
  const store = memoryStore(baseState([candidate('a')]));
  const m = fakeMetricool(FIXTURE_ERRORS);
  await run(store, m, stager(), FB_ONLY, NOW);
  m.crossAccountPreflight = async () => { m.calls.cross.push(1); throw new Error('cross_account_duplicate'); };
  const resolved = { ...FB_ONLY, CLIPPERS_FACEBOOK_HOLD_RESOLVED_AT: '2026-11-20T15:30:00Z' };
  const { report } = await run(store, m, stager(), resolved, NOW + 2 * 3600_000);
  assert.equal(m.calls.schedule.length, 0);
  assert.ok(report.heldReasons.includes('held_release_deferred:cross_account_duplicate'));
  const c = store.state.cloudPublish;
  assert.equal(c.heldQueue.length, 1); assert.equal(c.posts.length, 0);
  assert.ok(!(c.mediaLedger ?? []).some(e => e.destinationKey === FB_KEY));
});

test('hold clears automatically when a later Facebook post shows PUBLISHED', async () => {
  const store = memoryStore(baseState([]));
  const m = fakeMetricool(FIXTURE_ERRORS);
  const runAt = (now) => runCloudPublisher({ env: ENV, now, owner: 'o', store, approvals, metricool: m, stager: stager(), fetch: okFetch, ...media, clock: () => now });
  await runAt(NOW);
  assert.equal(store.state.cloudPublish.holds[FB_KEY].status, 'held_owner_action');
  m.rows = [...FIXTURE_ERRORS, fbPublishedRow];
  const { report } = await runAt(NOW + 3 * 3600_000);
  assert.equal(store.state.cloudPublish.holds[FB_KEY].clearedBy, 'provider_published');
  assert.deepEqual(report.ownerHolds, []);
});

test('owner-only endpoint marks the hold resolved', async () => {
  const state = baseState([]);
  state.cloudPublish = { version: 1, clips: {}, posts: [], learning: null, lastRun: null, heldQueue: [], holds: { [FB_KEY]: { status: 'held_owner_action', reason: 'facebook_identity_confirmation_required', since: '2026-11-19T20:00:00.000Z' } } };
  const store = memoryStore(state);
  let owner = false;
  const app = express(); app.use(express.json());
  registerClippersStreamerRoutes(app, { isOwner: () => owner, store: async () => store, owner: () => 'o', now: () => NOW });
  const server = app.listen(0); const port = server.address().port;
  try {
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/clippers/streamers/holds/resolved`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ destination: FB_KEY })).status, 403);
    owner = true;
    assert.equal((await post({ destination: 'x' })).status, 400);
    assert.equal((await post({ destination: FB_KEY })).status, 200);
    assert.equal(store.state.cloudPublish.holds[FB_KEY].ownerResolvedAt, new Date(NOW).toISOString());
  } finally { server.close(); }
});

test('copy queued with lanes off is released as a draft even after lanes are turned on', async () => {
  const store = memoryStore(baseState([candidate('a')]));
  const m = fakeMetricool(FIXTURE_ERRORS);
  const off = { ...FB_ONLY, CLIPPERS_STREAMER_LANES_ENABLED: 'false' };
  await run(store, m, stager(), off, NOW);
  const q = store.state.cloudPublish.heldQueue;
  assert.equal(q.length, 1); assert.equal(q[0].lane, null); assert.equal(q[0].draft, true);
  const resolvedOn = { ...FB_ONLY, CLIPPERS_FACEBOOK_HOLD_RESOLVED_AT: '2026-11-20T15:30:00Z' };
  await run(store, m, stager(), resolvedOn, NOW + 2 * 3600_000);
  assert.equal(m.calls.schedule.length, 1);
  assert.equal(m.calls.schedule[0].draft, true, 'never released live');
});

test('held Facebook release stays a draft with the owner override on (override is TikTok-only), even if facebook is listed', async () => {
  const store = memoryStore(baseState([candidate('a')]));
  const m = fakeMetricool(FIXTURE_ERRORS), st = stager();
  const override = { CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE: 'memes:tiktok,sport:tiktok,miami:tiktok,miami:facebook' };
  await run(store, m, st, { ...FB_ONLY, ...override }, NOW);
  assert.equal(store.state.cloudPublish.heldQueue.length, 1);
  const r = await run(store, m, st, { ...FB_ONLY, ...override, CLIPPERS_FACEBOOK_HOLD_RESOLVED_AT: '2026-11-20T15:30:00Z' }, NOW + 2 * 3600_000);
  assert.equal(r.report.counts.heldReleased, 1);
  assert.equal(m.calls.schedule[0].destinationKey, FB_KEY);
  assert.equal(m.calls.schedule[0].draft, true, 'Facebook never auto-publishes via the override');
});
