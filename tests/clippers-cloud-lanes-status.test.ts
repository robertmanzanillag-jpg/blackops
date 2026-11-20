import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCloudLanesOverlay, cloudLanesSelfHealAudits, CLOUD_LANES_SELF_HEAL_RECORD } from '../server/clippers-cloud-lanes-status';
import { cloudFallbackReport } from '../server/clippers-streamers-status';
import { createClippersOrchestraState } from '../server/clippers-orchestra-state';
import { parseClippersOrchestraStatus } from '../shared/clippers-orchestra';
import { acquireLane, emptyLanesState, recordLaneRun, retireMacLanes } from '../shared/clippers-cloud-lanes.mjs';
import { planSelfHeal, isValidSelfHealOrder } from '../server/office-self-heal';
import { emptyCompanyState } from '../shared/agent-company';

const AT = Date.parse('2026-11-20T15:00:00.000Z');
const streamerRaw = JSON.stringify({ version: 1, updatedAt: null, lastRun: { at: '2026-11-20T14:30:00.000Z', status: 'completed', heldReasons: [], errors: [], counts: { candidates: 3 } }, creators: {}, takedowns: [], candidates: [], signals: [] });
const lanes = () => {
  const s = emptyLanesState();
  recordLaneRun(s, 'content', { at: '2026-11-20T09:05:00.000Z', status: 'completed', heldReasons: [], errors: [], counts: { motivation_rendered: 10 } });
  recordLaneRun(s, 'youtube_delivery', { at: '2026-11-20T09:20:00.000Z', status: 'held', heldReasons: ['missing_secret:CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN'], errors: [] });
  acquireLane(s, 'marketplace', 'mac', AT - 3 * 3600_000);
  retireMacLanes(s, ['watchdog'], AT - 3600_000);
  return s;
};

test('Mac off: every lane role shows its cloud status with reasons and owner notes, and the report stays valid', () => {
  const report = cloudFallbackReport(streamerRaw, AT)!;
  applyCloudLanesOverlay(report, JSON.stringify(lanes()), AT);
  const role = (stage: string) => report.roles.find(r => r.stage === stage)!;
  assert.equal(role('editor').state, 'completed');
  assert.equal(role('editor').outputs.cloud_content_motivation_rendered, 10);
  assert.ok(!role('editor').heldReasons.includes('mac_worker_offline'));
  assert.equal(role('publisher').state, 'held');
  assert.ok(role('publisher').heldReasons.includes('cloud_youtube_delivery:missing_secret:CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN'));
  assert.ok(role('publisher').ownerNotes!.some(n => /CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN/.test(n)));
  assert.equal(role('trends').state, 'idle'); // marketplace still on the Mac: on duty, waiting for retirement
  assert.ok(role('trends').heldReasons.includes('mac_lane_active:marketplace'));
  assert.equal(role('health').state, 'completed');
  assert.ok(role('health').heldReasons.includes('mac_lane_retired:watchdog'));
  assert.ok(parseClippersOrchestraStatus(report, AT));
});

test('read(): Mac never reported -> cloud fallback carries the lane overlay', async () => {
  const data = new Map<string, string>([['clippers-streamers:o', streamerRaw], ['clippers-cloud-lanes:o', JSON.stringify(lanes())]]);
  const orchestra = createClippersOrchestraState({ owner: () => 'o', now: () => AT, store: async () => ({ read: async (k: string) => data.get(k) ?? null, transact: async () => '' }) });
  const view = await orchestra.read();
  assert.equal(view!.roles.find(r => r.stage === 'editor')!.state, 'completed');
});

test('self-heal: a lane failing 3+ runs opens one valid order; missing secrets are data absence only', () => {
  const s = emptyLanesState();
  for (let i = 0; i < 3; i++) recordLaneRun(s, 'marketplace', { at: new Date(AT - (3 - i) * 86400_000).toISOString(), status: 'failed', heldReasons: [], errors: ['internal_error'] });
  const audits = cloudLanesSelfHealAudits(JSON.stringify(s));
  assert.deepEqual(audits[0].findings, [{ code: 'CLOUD_LANE_FAILING', recordId: CLOUD_LANES_SELF_HEAL_RECORD('marketplace') }]);
  const out = planSelfHeal({ state: undefined, company: emptyCompanyState(), journal: { jobs: [] }, owner: 'o', now: AT, maxPerDay: 2, extraAudits: audits });
  assert.equal(out.created.length, 1);
  assert.ok(isValidSelfHealOrder(out.created[0]));
  assert.match(out.created[0].text, /clippers-cloud-lanes/);
  const secrets = cloudLanesSelfHealAudits(JSON.stringify(lanes()));
  const none = planSelfHeal({ state: undefined, company: emptyCompanyState(), journal: { jobs: [] }, owner: 'o', now: AT, maxPerDay: 2, extraAudits: secrets });
  assert.equal(none.created.length, 0);
  assert.deepEqual(cloudLanesSelfHealAudits(null), []);
});

test('flags off by design are informational (not held); a lane timeout counts toward the self-heal streak', () => {
  const s = emptyLanesState();
  retireMacLanes(s, ['marketplace', 'youtube_delivery'], AT - 7200_000);
  recordLaneRun(s, 'marketplace', { at: '2026-11-20T12:05:00.000Z', status: 'completed', heldReasons: ['metricool_autopublish_not_authorized'], errors: [] });
  recordLaneRun(s, 'youtube_delivery', { at: '2026-11-20T09:20:00.000Z', status: 'completed', heldReasons: ['youtube_cloud_upload_disabled'], errors: [] });
  const report = cloudFallbackReport(streamerRaw, AT)!;
  applyCloudLanesOverlay(report, JSON.stringify(s), AT);
  assert.equal(report.roles.find(r => r.stage === 'trends')!.state, 'completed');
  assert.equal(report.roles.find(r => r.stage === 'publisher')!.state, 'completed');
  for (let i = 0; i < 3; i++) recordLaneRun(s, 'content', { at: new Date(AT - (3 - i) * 3600_000).toISOString(), status: 'failed', heldReasons: [], errors: ['lane_timeout'] });
  assert.ok(cloudLanesSelfHealAudits(JSON.stringify(s))[0].findings.some(f => f.code === 'CLOUD_LANE_FAILING' && f.recordId === CLOUD_LANES_SELF_HEAL_RECORD('content')));
});

test('weekly sleep lanes report into editor/publisher with their own record and a weekly staleness window', () => {
  const s = emptyLanesState();
  retireMacLanes(s, ['content', 'youtube_delivery'], AT - 7 * 86400_000);
  recordLaneRun(s, 'content', { at: '2026-11-20T09:05:00.000Z', status: 'completed', heldReasons: [], errors: [], counts: { motivation_rendered: 10 } });
  recordLaneRun(s, 'sleep_content', { at: new Date(AT - 5 * 86400_000).toISOString(), status: 'completed', heldReasons: [], errors: [], counts: { sleep_generated: 1 } });
  const report = cloudFallbackReport(streamerRaw, AT)!;
  applyCloudLanesOverlay(report, JSON.stringify(s), AT);
  const editor = report.roles.find(r => r.stage === 'editor')!;
  assert.equal(editor.state, 'completed');
  assert.equal(editor.outputs.cloud_sleep_content_sleep_generated, 1);
  assert.ok(!editor.heldReasons.some(r => r.includes('sleep_content') && r.includes('stale')));
});
