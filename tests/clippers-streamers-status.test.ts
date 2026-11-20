import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStreamerOverlay, streamerStatusView, registerClippersStreamerRoutes } from '../server/clippers-streamers-status';
import { localNewsSenderRetired, deliverClipperLocalNewsToMetricool, LOCAL_NEWS_SENDER_RETIRED_REASON } from '../server/clippers-local-news-metricool';

const AT = Date.parse('2026-11-19T15:00:00.000Z');
const role = (stage: string) => ({ id: `clippers-${stage}`, stage, state: 'idle', evidenceAt: null, activeUntil: null, lastRunAt: null, heartbeatAt: null, nextDueAt: null, runId: null, evidenceIds: [], outputs: {}, heldReasons: [], lifePenaltyExempt: false, career: {} });
const stateWith = (lastRun: any, extra: any = {}) => JSON.stringify({ version: 1, updatedAt: null, lastRun, creators: {}, takedowns: [], candidates: [], signals: [], ...extra });

test('office Streamers role shows the cloud job state and missing-secret reason', () => {
  const report: any = { roles: [role('streamers'), role('editor')] };
  applyStreamerOverlay(report, stateWith({ at: '2026-11-19T14:30:00.000Z', status: 'skipped_missing_secrets', heldReasons: ['missing_secret:TWITCH_CLIENT_ID'], errors: [], counts: { candidates: 0 } }), AT);
  const r = report.roles[0];
  assert.equal(r.state, 'held'); assert.ok(r.heldReasons.includes('missing_secret:TWITCH_CLIENT_ID')); assert.equal(r.outputs.cloud_candidates, 0);
  assert.equal(report.roles[1].state, 'idle');
  const ok: any = { roles: [role('streamers')] };
  applyStreamerOverlay(ok, stateWith({ at: '2026-11-19T14:30:00.000Z', status: 'completed', heldReasons: [], errors: [], counts: { candidates: 4 } }), AT);
  assert.equal(ok.roles[0].state, 'completed');
  const stale: any = { roles: [role('streamers')] };
  applyStreamerOverlay(stale, stateWith({ at: '2026-11-19T05:00:00.000Z', status: 'completed', heldReasons: [], errors: [], counts: {} }), AT);
  assert.equal(stale.roles[0].state, 'stale');
  const none: any = { roles: [role('streamers')] };
  applyStreamerOverlay(none, null, AT); assert.equal(none.roles[0].state, 'idle');
});

test('owner-only status, takedown (rejects open approvals) and removal confirmation; invalid state is 503 and untouched', async () => {
  const data = new Map<string, string>();
  data.set('clippers-streamers:o', stateWith(null, { creators: { 'twitch:1': { creatorGroupId: 'g1' } }, candidates: [
    { id: 'twitch-clip:a', creatorKey: 'twitch:1', clipPolicy: { status: 'allowed_unless_prohibited' }, approval: { status: 'pending', pendingActionId: 'pa-1' }, download: { mode: 'needs_local_download' } },
    { id: 'twitch-clip:b', creatorKey: 'twitch:9', clipPolicy: { status: 'allowed_unless_prohibited' }, approval: { status: 'pending', pendingActionId: 'pa-2' }, download: { mode: 'needs_local_download' } }] }));
  const store = { read: async (k: string) => data.get(k) ?? null, transact: async (k: string, fn: (raw: string | null) => Promise<string>) => { const v = await fn(data.get(k) ?? null); data.set(k, v); return v; } };
  const routes: Record<string, Function> = {};
  let owner = true, clock = AT;
  const rejected: string[][] = [];
  registerClippersStreamerRoutes({ get: (p: string, h: Function) => { routes['GET ' + p] = h; }, post: (p: string, h: Function) => { routes['POST ' + p] = h; } } as any,
    { isOwner: () => owner, store: async () => store, owner: () => 'o', now: () => clock, rejectPending: async (_o, ids) => { rejected.push(ids); return ids.length; } });
  const call = async (key: string, body?: any) => { const out: any = { code: 200 }; const res: any = { set() {}, status(c: number) { out.code = c; return res; }, json(b: any) { out.body = b; return res; } }; await routes[key]({ body }, res); return out; };
  owner = false;
  for (const k of ['GET /api/clippers/streamers/status', 'POST /api/clippers/streamers/takedown', 'POST /api/clippers/streamers/takedown/removed']) assert.equal((await call(k, {})).code, 403);
  owner = true;
  assert.equal((await call('POST /api/clippers/streamers/takedown', { reason: '' })).code, 400);
  const t = await call('POST /api/clippers/streamers/takedown', { creatorKey: 'twitch:1', reason: 'creator asked by DM' });
  assert.equal(t.body.removeBy, '2026-11-20T15:00:00.000Z'); assert.equal(t.body.rejectedApprovals, 1);
  assert.deepEqual(rejected, [['twitch-clip:a']]);
  let s = await call('GET /api/clippers/streamers/status');
  assert.equal(s.body.candidates[0].clipPolicy, 'prohibited'); assert.equal(s.body.candidates[0].approval, 'rejected'); assert.equal(s.body.safety.publishesHere, false);
  clock = AT + 25 * 3600_000;
  assert.equal((await call('GET /api/clippers/streamers/status')).body.takedowns[0].overdue, true);
  assert.equal((await call('POST /api/clippers/streamers/takedown/removed', { id: 'nothex' })).code, 400);
  assert.equal((await call('POST /api/clippers/streamers/takedown/removed', { id: '0'.repeat(16) })).code, 404);
  assert.ok((await call('POST /api/clippers/streamers/takedown/removed', { id: t.body.id })).body.removedAt);
  s = await call('GET /api/clippers/streamers/status');
  assert.equal(s.body.takedowns[0].overdue, false); assert.equal(s.body.candidates[0].clipPolicy, 'prohibited');
  // Existing but invalid state: 503, never overwritten.
  data.set('clippers-streamers:o', '{"version":7}');
  assert.equal((await call('GET /api/clippers/streamers/status')).code, 503);
  assert.equal((await call('POST /api/clippers/streamers/takedown', { creatorKey: 'twitch:1', reason: 'x' })).code, 503);
  assert.equal(data.get('clippers-streamers:o'), '{"version":7}');
});

test('local-news sender is retired for the repurposed brands unless explicitly re-enabled', async () => {
  assert.equal(localNewsSenderRetired({}), true);
  assert.equal(localNewsSenderRetired({ CLIPPERS_LOCAL_NEWS_SENDER_ENABLED: 'true' }), false);
  const r = await deliverClipperLocalNewsToMetricool({ env: { METRICOOL_USER_TOKEN: 'real-token', METRICOOL_USER_ID: '123' }, readPolicy: async () => ({ paused: false, reason: '', destinations: {} }) as any,
    fetch: async () => { throw new Error('no network'); } } as any);
  assert.equal(r.status, 'paused'); assert.equal(r.reason, LOCAL_NEWS_SENDER_RETIRED_REASON);
});

import { cloudFallbackReport, streamerSelfHealAudits, STREAMER_SELF_HEAL_RECORD } from '../server/clippers-streamers-status';
import { parseClippersOrchestraStatus } from '../shared/clippers-orchestra';
import { planSelfHeal, isValidSelfHealOrder } from '../server/office-self-heal';
import { emptyCompanyState } from '../shared/agent-company';
import { createClippersOrchestraState } from '../server/clippers-orchestra-state';

test('Mac off: orchestra view falls back to the cloud streamer state (valid contract, real reason)', async () => {
  assert.equal(cloudFallbackReport(null, AT), null);
  const raw = stateWith({ at: '2026-11-19T14:30:00.000Z', status: 'skipped_missing_secrets', heldReasons: ['missing_secret:TWITCH_CLIENT_ID'], errors: [], counts: { candidates: 0 } },
    { cityPages: [{ brandId: '6591612', city: 'miami', name: 'Miami Streamers', status: 'named' }] });
  const fb = cloudFallbackReport(raw, AT)!;
  assert.ok(fb && parseClippersOrchestraStatus(fb, AT));
  const s = fb.roles.find(r => r.stage === 'streamers')!;
  assert.equal(s.state, 'held'); assert.ok(s.heldReasons.includes('missing_secret:TWITCH_CLIENT_ID')); assert.ok(!s.heldReasons.includes('mac_worker_offline'));
  assert.equal(fb.roles.find(r => r.stage === 'editor')!.state, 'disconnected');
  assert.ok(fb.accounts.some(a => a.label.startsWith('Miami Streamers')));
  // No cityPages stored (older state): Clipwave defaults label the office.
  const def = cloudFallbackReport(stateWith({ at: '2026-11-19T14:30:00.000Z', status: 'ok', heldReasons: [], errors: [], counts: { candidates: 0 } }), AT)!;
  assert.ok(def.accounts.some(a => a.label.startsWith('Clipwave Miami')));
  assert.equal(def.disconnectedDestinations[0].label, 'Clipwave NYC');
  // Through the real read(): no Mac envelope stored -> cloud fallback instead of null.
  const data = new Map<string, string>([['clippers-streamers:o', raw]]);
  const orchestra = createClippersOrchestraState({ owner: () => 'o', now: () => AT, store: async () => ({ read: async (k: string) => data.get(k) ?? null, transact: async () => '' }) });
  const view = await orchestra.read();
  assert.ok(view); assert.equal(view!.roles.find(r => r.stage === 'streamers')!.state, 'held');
});

test('self-heal: 3+ consecutive code failures open a factory order; missing secrets never do', () => {
  const failing = stateWith({ at: '2026-11-19T14:30:00.000Z', status: 'failed', heldReasons: [], errors: ['TWITCH_HELIX_FAILED'], counts: {} }, { failureStreak: 3 });
  const audits = streamerSelfHealAudits(failing);
  assert.deepEqual(audits[0].findings, [{ code: 'STREAMER_DISCOVERY_FAILING', recordId: STREAMER_SELF_HEAL_RECORD }]);
  const out = planSelfHeal({ state: undefined, company: emptyCompanyState(), journal: { jobs: [] }, owner: 'o', now: AT, maxPerDay: 2, extraAudits: audits });
  assert.equal(out.created.length, 1);
  assert.equal(out.created[0].selfHeal!.code, 'STREAMER_DISCOVERY_FAILING'); assert.equal(out.created[0].assignees[0].agentId, 'code');
  assert.ok(isValidSelfHealOrder(out.created[0])); assert.match(out.created[0].text, /clippers-streamer-discovery/);
  // Two failures: not yet. Missing secrets: data-absence note only.
  assert.equal(streamerSelfHealAudits(stateWith({ at: '2026-11-19T14:30:00.000Z', status: 'failed', heldReasons: [], errors: ['X'], counts: {} }, { failureStreak: 2 }))[0].findings.length, 0);
  const secrets = streamerSelfHealAudits(stateWith({ at: '2026-11-19T14:30:00.000Z', status: 'skipped_missing_secrets', heldReasons: ['missing_secret:YOUTUBE_API_KEY'], errors: [], counts: {} }, { failureStreak: 0 }));
  const noOrder = planSelfHeal({ state: undefined, company: emptyCompanyState(), journal: { jobs: [] }, owner: 'o', now: AT, maxPerDay: 2, extraAudits: secrets });
  assert.equal(noOrder.created.length, 0); assert.ok(noOrder.state.notes.some(n => n.code === 'CAPABILITY_UNAVAILABLE'));
  // Injection is limited to the streamer role.
  const forged = planSelfHeal({ state: undefined, company: emptyCompanyState(), journal: { jobs: [] }, owner: 'o', now: AT, maxPerDay: 2, extraAudits: [{ ...audits[0], role: 'github' }] });
  assert.equal(forged.created.length, 0);
});

test('default takedown rejection reuses one module-level pool (no pool per takedown)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../server/clippers-streamers-status.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function defaultRejectPending'), src.indexOf('export function registerClippersStreamerRoutes'));
  assert.match(fn, /rejectPool \?\?=/);
  assert.equal((fn.match(/createCouncilPool\('streamers-takedown'\)/g) ?? []).length, 1);
});

test('status view lists cloud-published posts (for takedown removal) and the learning summary', () => {
  const view: any = streamerStatusView(stateWith(null, { cloudPublish: { version: 1, clips: {}, lastRun: { at: '2026-11-19T14:00:00.000Z', status: 'completed', counts: { scheduled: 4 }, heldReasons: [], errors: [] },
    posts: [{ id: 'stc-1', candidateId: 'twitch-clip:a', creatorKey: 'twitch:100', destinationKey: '6431685:tiktok:streamersus', scheduledAt: '2026-11-19T16:00:00.000Z', status: 'scheduled', metricoolId: 'mc-1', hookVariant: 'title', caption: 'secret-free', observation: { views: 10 } }],
    learning: { evaluatedAt: '2026-11-19T14:00:00.000Z', samples: 1, hookPreference: {}, creatorBoost: {}, experiments: [] } } }), AT);
  assert.equal(view.cloudPublish.lastRun.counts.scheduled, 4);
  assert.deepEqual(view.cloudPublish.posts[0], { id: 'stc-1', candidateId: 'twitch-clip:a', creatorKey: 'twitch:100', destination: '6431685:tiktok:streamersus', scheduledAt: '2026-11-19T16:00:00.000Z', status: 'scheduled', metricoolId: 'mc-1', hookVariant: 'title', views: 10 });
  assert.equal(view.cloudPublish.learning.samples, 1);
  assert.equal(streamerStatusView(stateWith(null), AT).cloudPublish, null);
});
