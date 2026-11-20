import { nativeReceiptDigest, externalScheduleCollision } from '../script/clippers-native-media-receipts.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runClippersDailyLearning } from '../script/clippers-daily-learning.mjs';
import { createPortfolioMetricool, DESTINATIONS, destinationKey } from '../script/clippers-portfolio-metricool.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const NOW = new Date('2026-11-18T15:00:00Z');
const target = DESTINATIONS[0];
const rootKey = destinationKey(target);
const LEGACY_KEY = '6431685:tiktok:streamersclips';
const token = 'sanitized-fixture-token';
function days(days) { return new Date(+NOW + days * 24 * 3_600_000); }
function iso(date) { return date.toISOString(); }

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'daily-clippers-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDir = path.join(root, 'config', 'clippers-daily-learning');
  const reportDir = path.join(root, 'reports', 'clippers-daily-learning');
  await mkdir(path.join(configDir, 'evidence'), { recursive: true, mode: 0o700 });
  await mkdir(reportDir, { recursive: true, mode: 0o700 });
  await mkdir(path.join(configDir, 'render-policies', rootKey.replaceAll(':', '__')), { recursive: true, mode: 0o700 });
  const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
  const write = (file, body) => writeFile(path.join(root, file), JSON.stringify(body), { mode: 0o600 });
  const configure = (assets = [], options = {}) => write('config/clippers-daily-learning/approved-input.json',
    { schemaVersion: 1, assets, reviews: [], publish: true, collect: true, ...options });
  const state = () => read('reports/clippers-daily-learning/state.json');
  const stateFile = 'reports/clippers-daily-learning/state.json';
  return { root, read, write, configure, state, stateFile };
}

async function approved(fixture, id = 'clip-1', overrides = {}, evidenceOverrides = {}) {
  const item = {
    ...target, id, campaignId: 'campaign', sourceId: 'source', sourceUrl: 'https://example.com/video/' + id,
    sourcePublishedAt: iso(days(-1)), rightsObservedAt: iso(NOW), rightsValidUntil: iso(days(1)),
    policyVersion: 'baseline-1', language: 'en', creator: 'creator', caption: 'Original edit ' + id,
    mediaReceiptFileId: 'drive-' + id, draftFile: id + '.mp4',
    mediaUrl: 'https://drive.google.com/uc?export=download&id=drive-' + id, mediaSha256: digest(id),
    scheduledAt: new Date(+NOW + 600_000).toISOString(), thirdPartyCommercial: false, ...overrides,
  };
  const evidence = {
    ...item, assetId: id, destination: { brandId: item.brandId, network: item.network, account: item.account },
    commercialPermission: 'approved', termsUrl: 'https://example.com/campaign/terms',
    sourceScope: 'exact_asset', rightsBasis: 'campaign', membership: 'verified', quality: 'passed', originalEdit: 'verified',
    disclosure: 'verified', reviewedBy: 'rights-reviewer', authorizedSpendUsd: 0, providerIncrementalCostUsd: 0, ...evidenceOverrides,
  };
  item.evidenceSha256 = digest(evidence);
  await fixture.write('config/clippers-daily-learning/evidence/' + item.evidenceSha256 + '.json', evidence);
  return item;
}
const receipt = item => ({
  fileId: item.mediaReceiptFileId, status: 'ready', campaignId: item.campaignId, draftFile: item.draftFile,
  mediaUrl: item.mediaUrl, sha256: item.mediaSha256, paidSpendAllowed: false,
});
const forbidden = () => assert.fail('unexpected provider request');

test('empty workspace reports four honest shortages and disconnected brand without calling provider', async t => {
  const f = await setup(t);
  const result = await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW, adapter: new Proxy({}, { get: forbidden }) });
  assert.deepEqual(result.destinations.map(d => d.shortfall), [5, 5, 5, 5]);
  assert.deepEqual(result.disconnected.map(d => d.brandId), [6595747]);
  assert.equal(result.observations, 0);
  assert.equal(result.rendererPolicyBinding, 'required_for_experiments_and_candidate_versions');
  assert.equal(result.versions[0].scope, 'approved_media_queue');
  assert.equal(result.paidSpendUsd, 0);
  assert.equal((await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW })).status, 'already_completed');
});

test('untrusted destination, altered experiment, stale source, bad media and cross-worker duplicates hold', async t => {
  const f = await setup(t);
  const base = await approved(f);
  const stale = await approved(f, 'stale', { sourcePublishedAt: iso(days(-4)) });
  const lookalike = await approved(f, 'url', { mediaUrl: 'https://evildrive.google.com/uc?id=drive-url' });
  const duplicate = await approved(f, 'duplicate');
  const wrongBrand = [6431692, 6475033, 6585226, '6431685', 6595747].map(brandId => ({ ...base, brandId }));
  const changed = { ...base, experiment: { id: 'a', context: 'b', variable: 'hook', arm: 'control', baselineVersion: 'baseline-1', candidateVersion: 'new' } };
  await f.configure([...wrongBrand, changed, stale, lookalike, duplicate]);
  await f.write('reports/metricool-public-media-receipts.json', [base, stale, lookalike, duplicate].map(receipt));
  await f.write('reports/metricool-autopilot-ledger.json', [{ metricoolBlogId: target.brandId, account: target.account, sha256: duplicate.mediaSha256 }]);
  const result = await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW, adapter: new Proxy({}, { get: forbidden }) });
  assert.ok(result.destinations[0].blockers.includes('asset_rights_media_or_scope_unverified'));
  assert.ok(result.destinations[0].blockers.includes('duplicate_delivery'));
  assert.equal(result.scheduled, 0);
});

test('a legacy autopilot row under the old account name still blocks a duplicate delivery', async t => {
  const f = await setup(t);
  const duplicate = await approved(f, 'duplicate');
  await f.configure([duplicate]);
  await f.write('reports/metricool-public-media-receipts.json', [receipt(duplicate)]);
  await f.write('reports/metricool-autopilot-ledger.json', [{ metricoolBlogId: target.brandId, account: '@streamersclips', sha256: duplicate.mediaSha256 }]);
  const result = await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW, adapter: new Proxy({}, { get: forbidden }) });
  assert.ok(result.destinations[0].blockers.includes('duplicate_delivery'));
  assert.equal(result.scheduled, 0);
});

test('unreadable ownership boundary and legacy worker lock perform no action', async t => {
  const f = await setup(t);
  await symlink('missing-authority.json', path.join(f.root, 'config/clippers-daily-learning/approved-input.json'));
  await assert.rejects(runClippersDailyLearning({ workspaceRoot: f.root, now: NOW }), { code: 'ELOOP' });
  await f.write('reports/metricool-autopilot.lock', {});
  const result = await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW });
  assert.equal(result.reason, 'metricool_worker_busy');
});

test('attempt is persisted before remote write, uncertain receipt is reconciled without reposting', async t => {
  const f = await setup(t);
  const item = await approved(f), second = await approved(f, 'second', { scheduledAt: new Date(+NOW + 1_200_000).toISOString() });
  await f.configure([item, second]);
  await f.write('reports/metricool-public-media-receipts.json', [item, second].map(receipt));
  const adapter = {
    async preflight(dest) { assert.deepEqual(dest, target); },
    async crossAccountPreflight() { return { checkedDays: [] }; },
    async schedule(dest, candidate) {
      assert.deepEqual(dest, target); assert.equal(candidate.id, item.id);
      assert.equal((await f.state()).deliveries[0].status, 'verification_pending');
      throw new Error('network after submission');
    },
  };
  const result = await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW, adapter });
  assert.equal(result.scheduled, 0);
  assert.equal((await f.state()).deliveries.length, 1);
  const observed = await runClippersDailyLearning({
    workspaceRoot: f.root, now: new Date(+days(1) + 1_200_000),
    adapter: {
      schedule: forbidden,
      confirmSchedule: async () => 'scheduler-1',
      publication: async () => ({ id: '123', url: 'https://www.tiktok.com/@streamersclips/video/123', publishedAt: item.scheduledAt, source: 'metricool_scheduler' }),
      metrics: async (_destination, _publication, now) => ({ views: 0, completionRate: null, observedAt: iso(now), timing: 'provider_observation_time', source: 'metricool_post_analytics' }),
    },
  });
  assert.equal(observed.verifiedPublications, 1);
  assert.equal(observed.snapshots, 1);
  assert.equal(observed.proposalCount, 0);
  assert.equal((await f.state()).observations[0].completionRate, null);
});

test('only timely matching snapshots persist at 24, 72 and 168 hours', async t => {
  const f = await setup(t);
  const item = await approved(f, 'public-rights-item', {}, { rightsBasis: 'public_policy', membership: 'not_required' });
  await f.configure([item]);
  await f.write('reports/metricool-public-media-receipts.json', [receipt(item)]);
  const adapter = {
    preflight: async () => {},
    crossAccountPreflight: async () => ({ checkedDays: [] }),
    schedule: async () => 'metricool-1',
    publication: async () => ({ id: '123', url: 'https://www.tiktok.com/@streamersclips/video/123?share=1', publishedAt: item.scheduledAt, source: 'metricool_scheduler' }),
    metrics: async (_target, _pub, now) => ({ views: 10, completionRate: 0.5, observedAt: iso(now), timing: 'provider_observation_time', source: 'metricool_post_analytics' }),
  };
  assert.equal((await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW, adapter })).scheduled, 1);
  for (const day of [1, 3, 7]) {
    const now = new Date(+days(day) + 1_200_000);
    assert.equal((await runClippersDailyLearning({ workspaceRoot: f.root, now, adapter })).snapshots, 1);
    assert.equal((await runClippersDailyLearning({ workspaceRoot: f.root, now, adapter })).status, 'already_completed');
  }
  const persisted = await f.state();
  assert.deepEqual(persisted.observations.map(row => row.window), [24, 72, 168]);
  assert.ok(persisted.observations.every(row => row.postId === '123' && row.source === 'metricool_post_analytics'));
  assert.equal(persisted.deliveries[0].post.url, 'https://www.tiktok.com/@streamersclips/video/123');
});

test('activation requires three independent version-bound proposals and rollback selects the prior version', async t => {
  const f = await setup(t);
  const engineSha256 = createHash('sha256').update(await readFile(new URL('../script/clippers-portfolio-render.mjs', import.meta.url))).digest('hex');
  const manifests = ['baseline-1', 'candidate-1'].map((version, index) => ({
    schemaVersion: 1, destination: target, version, engineSha256, reviewedBy: 'qa',
    params: { hook: index, duration: 7, crop: 'center', caption_layout: 'off', posting_slot: '10:00' },
  }));
  for (const manifest of manifests) {
    await f.write('config/clippers-daily-learning/render-policies/' + rootKey.replaceAll(':', '__') + '/' + manifest.version + '.json', manifest);
  }
  const renderProof = { comparison: { baselineManifestSha: digest(manifests[0]), candidateManifestSha: digest(manifests[1]), variable: 'hook' } };
  const deliveries = [], observations = [];
  for (const experiment of [0, 1, 2]) {
    for (const arm of ['control', 'candidate']) {
      for (let sample = 0; sample < 5; sample++) {
        const id = [experiment, arm, sample].join('-');
        const postId = String(deliveries.length + 1);
        deliveries.push({ ...target, id, post: { id: postId, publishedAt: iso(days(-1)) },
          status: 'published', scheduledAt: iso(days(-1)), elapsedMs: 10, costUsd: 0, renderProof,
          policyVersion: arm === 'control' ? 'baseline-1' : 'candidate-1',
          experiment: { id: 'trial-' + experiment, context: 'control', variable: 'hook', arm, baselineVersion: 'baseline-1', candidateVersion: 'candidate-1' } });
        observations.push({ key: id, deliveryId: id, postId, destination: rootKey,
          publishedAt: iso(days(-1)), observedAt: iso(NOW), window: 24, timing: 'provider_observation_time',
          views: arm === 'control' ? 100 : 125, completionRate: arm === 'control' ? 0.50 : 0.55 });
      }
    }
  }
  await f.write(f.stateFile, { schemaVersion: 1, day: null, deliveries, observations, versions: {}, history: [] });
  await f.configure([], { collect: false, publish: false });
  const { proposals, qualifiedCandidates } = await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW });
  const comparisons = proposals.map(proposal => proposal.id);
  assert.equal(comparisons.length, 3);
  assert.equal(qualifiedCandidates[0].status, 'qualified_for_queue_review');
  const review = { id: 'approve-candidate', destination: target, reviewer: 'qa', authorizedBy: 'owner', action: 'activate',
    from: 'baseline-1', to: 'candidate-1', comparisons, evidenceDigest: digest([...comparisons].sort()) };
  await f.configure([], { collect: false, publish: false, reviews: [{ ...review, to: 'wrong-version' }] });
  assert.equal((await runClippersDailyLearning({ workspaceRoot: f.root, now: days(1) })).versions[0].active, 'baseline-1');
  await f.configure([], { collect: false, publish: false, reviews: [review] });
  const activation = await runClippersDailyLearning({ workspaceRoot: f.root, now: days(2) });
  assert.equal(activation.versions[0].active, 'candidate-1');
  assert.equal(activation.versions[0].status, 'queue_policy_active_outcome_pending');
  assert.equal(activation.versions[0].scope, 'approved_media_queue');
  assert.equal(activation.rendererPolicyBinding, 'required_for_experiments_and_candidate_versions');
  const rollbackDate = days(3);
  const unrendered = await approved(f, 'unrendered-baseline', {
    sourcePublishedAt: new Date(+rollbackDate - 3_600_000).toISOString(),
    rightsObservedAt: iso(rollbackDate), rightsValidUntil: iso(days(4)),
    scheduledAt: new Date(+rollbackDate + 600_000).toISOString(),
  });
  await f.write('reports/metricool-public-media-receipts.json', [receipt(unrendered)]);
  await f.configure([unrendered], { collect: false, publish: true,
    reviews: [{ ...review, id: 'rollback-1', action: 'rollback', from: 'candidate-1', to: 'baseline-1' }] });
  const rollback = await runClippersDailyLearning({ workspaceRoot: f.root, now: rollbackDate, adapter: new Proxy({}, { get: forbidden }) });
  assert.equal(rollback.versions[0].active, 'baseline-1');
  assert.equal(rollback.versions[0].status, 'queue_policy_rolled_back');
  assert.equal(rollback.destinations[0].eligible, 0, 'reinstated renderer baseline requires a verified render receipt');
  assert.equal(rollback.scheduled, 0);
  assert.deepEqual((await f.state()).history.map(row => row.action), ['activate', 'rollback']);
});

test('legacy-key state (observations, versions, history under streamersclips) is still found for proposals, activation and rollback', async t => {
  const f = await setup(t);
  const engineSha256 = createHash('sha256').update(await readFile(new URL('../script/clippers-portfolio-render.mjs', import.meta.url))).digest('hex');
  const manifests = ['baseline-1', 'candidate-1'].map((version, index) => ({
    schemaVersion: 1, destination: target, version, engineSha256, reviewedBy: 'qa',
    params: { hook: index, duration: 7, crop: 'center', caption_layout: 'off', posting_slot: '10:00' },
  }));
  for (const manifest of manifests) {
    await f.write('config/clippers-daily-learning/render-policies/' + rootKey.replaceAll(':', '__') + '/' + manifest.version + '.json', manifest);
  }
  const renderProof = { comparison: { baselineManifestSha: digest(manifests[0]), candidateManifestSha: digest(manifests[1]), variable: 'hook' } };
  const deliveries = [], observations = [];
  for (const experiment of [0, 1, 2]) {
    for (const arm of ['control', 'candidate']) {
      for (let sample = 0; sample < 5; sample++) {
        const id = [experiment, arm, sample].join('-');
        const postId = String(deliveries.length + 1);
        deliveries.push({ ...target, id, post: { id: postId, publishedAt: iso(days(-1)) },
          status: 'published', scheduledAt: iso(days(-1)), elapsedMs: 10, costUsd: 0, renderProof,
          policyVersion: arm === 'control' ? 'baseline-1' : 'candidate-1',
          experiment: { id: 'trial-' + experiment, context: 'control', variable: 'hook', arm, baselineVersion: 'baseline-1', candidateVersion: 'candidate-1' } });
        observations.push({ key: id, deliveryId: id, postId, destination: LEGACY_KEY,
          publishedAt: iso(days(-1)), observedAt: iso(NOW), window: 24, timing: 'provider_observation_time',
          views: arm === 'control' ? 100 : 125, completionRate: arm === 'control' ? 0.50 : 0.55 });
      }
    }
  }
  await f.write(f.stateFile, { schemaVersion: 1, day: null, deliveries, observations, versions: {}, history: [] });
  await f.configure([], { collect: false, publish: false });
  const { proposals, qualifiedCandidates } = await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW });
  const comparisons = proposals.map(proposal => proposal.id);
  assert.equal(comparisons.length, 3);
  assert.equal(qualifiedCandidates[0].status, 'qualified_for_queue_review');
  const review = { id: 'approve-candidate', destination: target, reviewer: 'qa', authorizedBy: 'owner', action: 'activate',
    from: 'baseline-1', to: 'candidate-1', comparisons, evidenceDigest: digest([...comparisons].sort()) };
  await f.configure([], { collect: false, publish: false, reviews: [{ ...review, to: 'wrong-version' }] });
  assert.equal((await runClippersDailyLearning({ workspaceRoot: f.root, now: days(1) })).versions[0].active, 'baseline-1');
  await f.configure([], { collect: false, publish: false, reviews: [review] });
  const activation = await runClippersDailyLearning({ workspaceRoot: f.root, now: days(2) });
  assert.equal(activation.versions[0].active, 'candidate-1');
  assert.equal(activation.versions[0].status, 'queue_policy_active_outcome_pending');
  assert.equal(activation.versions[0].scope, 'approved_media_queue');
  assert.equal(activation.rendererPolicyBinding, 'required_for_experiments_and_candidate_versions');
  // Rewrite the persisted state as an older worker would have stored it (legacy account key).
  const legacyState = await f.state();
  legacyState.versions = { [LEGACY_KEY]: legacyState.versions[rootKey] };
  legacyState.history = legacyState.history.map(row => ({ ...row, destination: LEGACY_KEY }));
  legacyState.day = null;
  await f.write(f.stateFile, legacyState);
  await f.configure([], { collect: false, publish: false });
  const legacyRun = await runClippersDailyLearning({ workspaceRoot: f.root, now: days(2.5) });
  assert.equal(legacyRun.versions[0].active, 'candidate-1', 'legacy versions/history keys are found');
  const rollbackDate = days(3);
  const unrendered = await approved(f, 'unrendered-baseline', {
    sourcePublishedAt: new Date(+rollbackDate - 3_600_000).toISOString(),
    rightsObservedAt: iso(rollbackDate), rightsValidUntil: iso(days(4)),
    scheduledAt: new Date(+rollbackDate + 600_000).toISOString(),
  });
  await f.write('reports/metricool-public-media-receipts.json', [receipt(unrendered)]);
  await f.configure([unrendered], { collect: false, publish: true,
    reviews: [{ ...review, id: 'rollback-1', action: 'rollback', from: 'candidate-1', to: 'baseline-1' }] });
  const rollback = await runClippersDailyLearning({ workspaceRoot: f.root, now: rollbackDate, adapter: new Proxy({}, { get: forbidden }) });
  assert.equal(rollback.versions[0].active, 'baseline-1');
  assert.equal(rollback.versions[0].status, 'queue_policy_rolled_back');
  assert.equal(rollback.destinations[0].eligible, 0, 'reinstated renderer baseline requires a verified render receipt');
  assert.equal(rollback.scheduled, 0);
  assert.deepEqual((await f.state()).history.map(row => row.action), ['activate', 'rollback']);
});

test('real request adapter binds the exact account, sends a single network, verifies receipt and rejects stale or changed evidence', async () => {
  const fb = DESTINATIONS[3];
  const item = { id: 'clip', scheduledAt: '2026-11-18T16:30:00.000Z', caption: 'Approved reel', mediaUrl: 'https://drive.google.com/uc?id=clip' };
  let posts = [], analytics = [], calls = 0;
  const fetcher = async (resource, options) => {
    const url = new URL(resource);
    assert.equal(options.headers['X-Mc-Auth'], token);
    if (url.pathname === '/api/admin/simpleProfiles') return Response.json([{ id: fb.brandId, canPublish: true, networksData: { facebookData: fb.account } }]);
    if (url.hostname === 'ai.metricool.com') {
      const request = JSON.parse(options.body);
      assert.equal(request.params.arguments.blogId, String(fb.brandId));
      assert.deepEqual(JSON.parse(request.params.arguments.info).providers, [{ network: 'facebook' }]);
      assert.equal(JSON.parse(request.params.arguments.info).facebookData.type, 'REEL');
      assert.deepEqual(JSON.parse(request.params.arguments.info).media,[item.mediaUrl]);
      assert.equal(request.params.arguments.mediaFiles,undefined);
      calls++;
      posts = [{
        id: 'mc-receipt', autoPublish: true, draft: false, providers: [{ network: 'facebook', status: 'scheduled' }],
        text: item.caption, media: [{ url: item.mediaUrl }], publicationDate: { dateTime: '2026-11-18T11:30:00', timezone: 'America/New_York' },
      }];
      return Response.json({ result: { content: [] } });
    }
    assert.equal(url.searchParams.get('blogId'), String(fb.brandId));
    return Response.json(url.pathname.includes('analytics') ? analytics : posts);
  };
  const adapter = createPortfolioMetricool({ token, userId: 12, fetcher });
  await assert.rejects(adapter.destinationSettings({ ...fb, brandId: 6585226 }), /allowlist/);
  await assert.rejects(adapter.destinationSettings({ ...fb, account: 'wrong' }), /allowlist/);
  await adapter.preflight(fb, item);
  assert.deepEqual(await adapter.schedule(fb, item), { id: 'mc-receipt', mediaUrl: item.mediaUrl });
  assert.equal(calls, 1);
  await assert.rejects(adapter.preflight(fb, item), /daily_cap/);
  posts[0].autoPublish = false;
  assert.equal(await adapter.confirmSchedule(fb, item), null);
  posts[0].autoPublish = true;
  posts[0].providers[0] = { network: 'facebook', status: 'published',
    publicUrl: 'https://www.facebook.com/' + fb.account + '/videos/15', publishedAt: item.scheduledAt };
  posts[0].text = 'Wrong edit';
  assert.equal(await adapter.publication(fb, { ...item, metricoolId: 'mc-receipt' }), null);
  posts[0].text = item.caption;
  const post = await adapter.publication(fb, { ...item, metricoolId: 'mc-receipt' });
  assert.equal(post.id, '15');
  analytics = [{ postId: '15', views: 15, completionRate: 0.5 }];
  assert.equal((await adapter.metrics(fb, post, days(1))).timing, 'retrieved_at_only');
  analytics[0].observedAt = iso(days(1));
  const observed = await adapter.metrics(fb, post, days(1));
  assert.equal(observed.views, 15);
});

test('actual TikTok response can prove owner and published time without fabricating observation freshness', async () => {
  const item = { id: 'test', metricoolId: 'mc-id', caption: 'Proof', mediaUrl: 'https://drive.google.com/uc?id=test',
    scheduledAt: '2026-11-18T16:30:00.000Z' };
  const publishedAt = '2026-11-18T16:31:00.000Z';
  const postUrl = 'https://www.tiktok.com/@streamersclips/video/123';
  const row = { id: item.metricoolId, text: item.caption, media: [item.mediaUrl],
    publicationDate: { dateTime: '2026-11-18T11:30:00', timezone: 'America/New_York' },
    providers: [{ network: 'tiktok', id: '123', status: 'PUBLISHED', publicUrl: postUrl }],
    draft: false, autoPublish: true };
  const liveShape = { id: target.brandId, tiktok: target.account, ownerUserId: 12, isShared: false };
  const adapter = createPortfolioMetricool({ token, userId: 12, fetcher: async (resource) => {
    const u = new URL(resource);
    if (u.pathname.endsWith('/simpleProfiles')) return Response.json([liveShape]);
    if (u.pathname.includes('/scheduler/')) return Response.json({ data: [row] });
    if (u.pathname.includes('/analytics/')) return Response.json({ data: [{
      videoId: '123', shareUrl: postUrl, createTime: Date.parse(publishedAt) / 1000, viewCount: 42,
    }] });
    assert.fail('unexpected request');
  } });
  assert.equal((await adapter.destinationSettings(target)).canPublish, true);
  const post = await adapter.publication(target, item, days(1));
  assert.equal(post.publishedAt, publishedAt);
  const observed = await adapter.metrics(target, post, days(1));
  assert.equal(observed.timing, 'retrieved_at_only');
  assert.equal(observed.completionRate, null);
  assert.equal(observed.views, 42);
});

test('brand settings fallback is only for omitted identities; conflicts never become authorized', async () => {
  for (const connected of [undefined, null, false, { username: target.account, connected: false }, 'other-account']) {
    let mcpReads = 0;
    const adapter = createPortfolioMetricool({ token, userId: 12, fetcher: async (resource) => {
      const u = new URL(resource);
      if (u.pathname.endsWith('/simpleProfiles')) {
        const profile = { id: target.brandId, ownerUserId: 12, isShared: false };
        if (connected !== undefined) profile.tiktok = connected;
        return Response.json([profile]);
      }
      mcpReads++;
      return Response.json({ result: { structuredContent: { brands: [
        { id: target.brandId, networksData: { tiktokData: target.account } },
      ] } } });
    } });
    if (connected === undefined) {
      assert.equal((await adapter.destinationSettings(target)).canPublish, true);
      assert.equal(mcpReads, 1);
    } else {
      await assert.rejects(adapter.destinationSettings(target), /identity_unverified/);
      assert.equal(mcpReads, 0);
    }
  }
});

test('age 25 and 47 hours never form comparable arms of the same nominal window', async t => {
  const f = await setup(t);
  const deliveries = [], observations = [];
  const publishedAt = iso(days(-2));
  for (const arm of ['control', 'candidate']) for (let index = 0; index < 5; index++) {
    const id = arm + '-' + index;
    const postId = String(deliveries.length + 1);
    deliveries.push({ ...target, id, post: { id: postId, publishedAt }, status: 'published',
      scheduledAt: publishedAt, elapsedMs: 3, costUsd: 0,
      renderProof: { comparison: { baselineManifestSha: 'a'.repeat(64), candidateManifestSha: 'b'.repeat(64), variable: 'hook' } },
      experiment: {
        id: 'test', context: 'test', variable: 'hook', arm, baselineVersion: 'baseline-1', candidateVersion: 'candidate',
      } });
    observations.push({ key: id, deliveryId: id, postId, destination: rootKey, publishedAt,
      observedAt: iso(new Date(+days(-2) + (arm === 'control' ? 25 : 47) * 3_600_000)),
      timing: 'provider_observation_time', window: 24, views: arm === 'control' ? 100 : 1_000, completionRate: 0.5 });
  }
  await f.write(f.stateFile, { schemaVersion: 1, day: null, deliveries, observations, versions: {}, history: [] });
  const report = await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW });
  assert.equal(report.observations, 10);
  assert.equal(report.proposalCount, 0);
  assert.deepEqual(report.qualifiedCandidates, []);
});

test('a destination schedules at most five distinct, freshest eligible items', async t => {
  const f = await setup(t);
  const assets = [];
  for (let index = 0; index < 6; index++) assets.push(await approved(f, 'item-' + index, {
    sourcePublishedAt: new Date(+NOW - (6 - index) * 3_600_000).toISOString(),
    scheduledAt: new Date(+NOW + (index + 2) * 600_000).toISOString(),
  }));
  await f.configure(assets);
  await f.write('reports/metricool-public-media-receipts.json', assets.map(receipt));
  const calls = [];
  const report = await runClippersDailyLearning({ workspaceRoot: f.root, now: NOW, adapter: {
    preflight: async () => {},
    crossAccountPreflight: async () => ({ checkedDays: [] }),
    schedule: async (destination, item) => { assert.deepEqual(destination, target); calls.push(item.id); return item.id; },
  } });
  assert.deepEqual(calls, ['item-5', 'item-4', 'item-3', 'item-2', 'item-1']);
  assert.equal(report.destinations[0].shortfall, 0);
  assert.deepEqual(report.destinations.slice(1).map(row => row.shortfall), [5, 5, 5]);
});

test('a normalized provider video must match the approved hash and never receives the account credential', async () => {
  const bytes = Buffer.from('reviewed fixture bytes');
  const media = 'https://static.metricool.com/normalized.mp4';
  const item = { id: 'known', scheduledAt: '2026-11-18T16:30:00.000Z', caption: 'Proof',
    mediaUrl: 'https://drive.google.com/uc?id=proof', mediaSha256: createHash('sha256').update(bytes).digest('hex') };
  let currentBytes = bytes;
  const adapter = createPortfolioMetricool({ token, userId: 12, fetcher: async (resource, options) => {
    const u = new URL(resource);
    if (u.hostname === 'static.metricool.com') {
      assert.equal(options.headers['X-Mc-Auth'], undefined);
      return new Response(currentBytes);
    }
    if (u.pathname.endsWith('/simpleProfiles')) {
      return Response.json([{ id: target.brandId, ownerUserId: 12, isShared: false, tiktok: target.account }]);
    }
    return Response.json({ data: [{ id: 'receipt-id', media: [media], text: item.caption,
      autoPublish: true, draft: false, publicationDate: item.scheduledAt,
      providers: [{ network: 'tiktok', status: 'pending' }] }] });
  } });
  assert.deepEqual(await adapter.confirmSchedule(target, item), { id: 'receipt-id', mediaUrl: media });
  currentBytes = Buffer.from('changed');
  assert.equal(await adapter.confirmSchedule(target, item), null);
});

test('schedule rereads the destination and holds when its connection changes after preflight', async () => {
  let profileReads = 0, writes = 0;
  const item = { id: 'scope-race', scheduledAt: '2026-11-18T16:30:00.000Z', caption: 'Approved edit',
    mediaUrl: 'https://drive.google.com/uc?id=scope-race' };
  const adapter = createPortfolioMetricool({ token, userId: 12, fetcher: async (resource, options) => {
    const u = new URL(resource);
    if (options.method === 'POST') { writes++; assert.fail('a changed account must never reach Metricool create'); }
    if (u.pathname.endsWith('/simpleProfiles')) {
      return Response.json([{ id: target.brandId, ownerUserId: 12, isShared: false,
        tiktok: ++profileReads === 1 ? target.account : 'reconnected-account' }]);
    }
    return Response.json({ data: [] });
  } });
  await adapter.preflight(target, item);
  await assert.rejects(adapter.schedule(target, item), /destination_identity_unverified/);
  assert.equal(profileReads, 2);
  assert.equal(writes, 0);
});

test('external owner-UI no-replay survives empty provider lists and new asset bytes without creating learner ACK',async t=>{
 const f=await setup(t),item=await approved(f),external={schemaVersion:1,origin:'external_owner_ui',kind:'external_schedule_observation',assetId:'old-ui-asset',destination:target,sourceUrl:item.sourceUrl,caption:'Earlier owner caption',metricoolId:'777',scheduledAt:'2026-11-18T14:00:00.000Z',mediaUrl:'https://static.metricool.com/video/123/202611/owner.mp4',sha256:'a'.repeat(64),sizeBytes:100,renderReceiptSha256:'b'.repeat(64),observedAt:NOW.toISOString(),confirmation:'exact_scheduler_get_and_native_bytes',publicationState:'not_evaluated',paidSpendUsd:0};
 await f.configure([item]);await f.write('reports/metricool-public-media-receipts.json',[receipt(item)]);await f.write('reports/clippers-daily-learning/external-schedules.json',[{...external,proofSha256:digest(external)}]);
 const result=await runClippersDailyLearning({workspaceRoot:f.root,now:NOW,adapter:{preflight:forbidden,schedule:forbidden}});assert.equal(result.scheduled,0);assert.equal((await f.state()).deliveries.length,0);assert.ok(result.destinations[0].blockers.includes('duplicate_delivery'));
 const proof={sourceIdentity:'youtube:aaaaaaaaaaa',sourceSha256:'c'.repeat(64),originalSourceSha256:'d'.repeat(64),startSeconds:10,endSeconds:20};external.weeklySourceProof=proof;
 const overlap={...item,caption:'New caption',sourceUrl:'https://youtu.be/aaaaaaaaaaa',weeklySourceProof:{...proof,sourceSha256:'e'.repeat(64),startSeconds:15,endSeconds:25}};assert.equal(externalScheduleCollision(external,overlap),true);overlap.weeklySourceProof.startSeconds=20;overlap.weeklySourceProof.endSeconds=25;assert.equal(externalScheduleCollision(external,overlap),false);
});
