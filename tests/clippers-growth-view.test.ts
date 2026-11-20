import test from 'node:test';
import assert from 'node:assert/strict';
import { growthOutputs, growthRows, growthDecisionLines } from '../shared/clippers-growth-view';
import { applyStreamerOverlay, streamerStatusView } from '../server/clippers-streamers-status';

const AT = Date.parse('2026-11-20T15:00:00.000Z');
const growth = {
  evaluatedAt: '2026-11-20T13:00:00.000Z',
  accounts: {
    '6431685:tiktok:streamersus': { weeklyPosts: 30, weeklyViews: 45000, weeklyMedian: 1200, autoPublish: true },
    '6431687:tiktok:streamersclipusa': { weeklyPosts: 20, weeklyViews: 4000, weeklyMedian: 180, autoPublish: false },
    '6591612:tiktok:news305miami': { weeklyPosts: 10, weeklyViews: 900, weeklyMedian: 90, autoPublish: false },
    '6591612:facebook:1193011863901514': { weeklyPosts: 6, weeklyViews: 12000, weeklyMedian: 2000, autoPublish: true },
  },
  decisions: ['autopublish_on:6431685:tiktok:streamersus', 'kill_creator:6431687:tiktok:streamersclipusa:twitch:42', 'breakout:6431685:tiktok:streamersus:twitch:7', 'double_creator:6431685:tiktok:streamersus:twitch:7'],
};
const role = (stage: string) => ({ id: `clippers-${stage}`, stage, state: 'idle', evidenceAt: null, activeUntil: null, lastRunAt: null, heartbeatAt: null, nextDueAt: null, runId: null, evidenceIds: [], outputs: {} as Record<string, number>, heldReasons: [], lifePenaltyExempt: false, career: {} });

test('growth outputs: per-account weekly views, median, auto-publish flag and decision count (numbers only)', () => {
  const out = growthOutputs(growth);
  assert.equal(out.growth_memes_views, 45000); assert.equal(out.growth_memes_median, 1200); assert.equal(out.growth_memes_autopublish, 1); assert.equal(out.growth_memes_decisions, 2);
  assert.equal(out.growth_sports_autopublish, 0); assert.equal(out.growth_sports_decisions, 1);
  assert.equal(out.growth_nyc_views, undefined, 'no data for NYC -> no row');
  assert.ok(Object.keys(out).length <= 20);
  const rows = growthRows(out);
  assert.deepEqual(rows.map(r => r.lane), ['memes', 'sports', 'miami', 'miamifb']);
  assert.equal(out.growth_miami_median, 90, 'Miami TikTok shown on its own (not the max with Facebook)');
  assert.equal(out.growth_miami_autopublish, 0); assert.equal(out.growth_miamifb_median, 2000); assert.equal(out.growth_miamifb_autopublish, 1);
  assert.equal(rows[0].autoPublish, true); assert.equal(rows[1].weeklyMedian, 180);
  assert.deepEqual(growthOutputs(null), {}); assert.deepEqual(growthRows({ growth_evil_views: 1, other: 2 }), []);
});

test('decision lines are owner-facing Spanish', () => {
  const lines = growthDecisionLines(growth);
  assert.ok(lines.some(l => /memes.*auto-publicación activada/.test(l)));
  assert.ok(lines.some(l => /SPORT.*creador twitch:42 pausado/.test(l)));
  assert.ok(lines.some(l => /> 10k en 24 h · 3 clips más de twitch:7/.test(l)));
  assert.ok(lines.some(l => /doble cuota/.test(l)));
});

test('office: Clippers learning role and streamer status show the growth view', () => {
  const raw = JSON.stringify({ version: 1, updatedAt: null, creators: {}, takedowns: [], candidates: [], signals: [],
    lastRun: { at: '2026-11-20T14:30:00.000Z', status: 'completed', heldReasons: [], errors: [], counts: {} },
    cloudPublish: { version: 1, clips: {}, posts: [], learning: null, lastRun: null, growth } });
  const report: any = { roles: [role('streamers'), role('learning')] };
  applyStreamerOverlay(report, raw, AT);
  assert.equal(report.roles[1].outputs.growth_memes_median, 1200);
  const view: any = streamerStatusView(raw, AT);
  assert.equal(view.cloudPublish.growth.accounts['6431685:tiktok:streamersus'].weeklyMedian, 1200);
  assert.ok(view.cloudPublish.growth.decisions.length >= 4);
});

test('growth view: owner override shows as "auto (owner override)" (output 2), earned auto as 1, drafts 0', () => {
  const out = growthOutputs({ accounts: {
    '6431685:tiktok:streamersus': { weeklyViews: 10, weeklyMedian: 5, autoPublish: true, autoPublishMode: 'owner_override' },
    '6431687:tiktok:streamersclipusa': { weeklyViews: 9000, weeklyMedian: 1200, autoPublish: true, autoPublishMode: 'auto' },
    '6591612:facebook:1193011863901514': { weeklyViews: 0, weeklyMedian: 0, autoPublish: false, autoPublishMode: 'drafts' },
  }, decisions: [] });
  assert.equal(out.growth_memes_autopublish, 2); assert.equal(out.growth_sports_autopublish, 1); assert.equal(out.growth_miamifb_autopublish, 0);
  const rows = growthRows(out);
  const memes = rows.find(r => r.lane === 'memes')!, sports = rows.find(r => r.lane === 'sports')!, fb = rows.find(r => r.lane === 'miamifb')!;
  assert.equal(memes.autoPublish, true); assert.equal(memes.ownerOverride, true);
  assert.equal(sports.autoPublish, true); assert.equal(sports.ownerOverride, false);
  assert.equal(fb.autoPublish, false); assert.equal(fb.ownerOverride, false);
});
