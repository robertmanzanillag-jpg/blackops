import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { runClippersDailyLearning } from '../script/clippers-daily-learning.mjs';
import { confirmedRenderReceipt, renderClippersPortfolio } from '../script/clippers-portfolio-render.mjs';
import { DESTINATIONS, destinationKey } from '../script/clippers-portfolio-metricool.mjs';

const exec = promisify(execFile);
const engineSha = value => createHash('sha256').update(value).digest('hex');
const now = new Date('2026-11-18T15:00:00Z');
const target = DESTINATIONS[0];
const key = destinationKey(target);
const scoped = key.replaceAll(':', '__');
const hasLocalRenderTools = ['ffmpeg', 'ffprobe'].every(cmd => spawnSync(cmd, ['-version']).status === 0);
const hasMagick = spawnSync('magick', ['-version']).status === 0;

test('local portfolio renderer applies reviewed parameters, binds actual bytes and rejects invalid moves', {
  skip: hasLocalRenderTools ? false : 'local ffmpeg and ffprobe required',
}, async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'clippers-portfolio-render-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const root = await realpath(fixture);
  const config = 'config/clippers-daily-learning';
  const policyDir = config + '/render-policies/' + scoped;
  const requests = config + '/render-requests';
  const write = (file, value) => writeFile(path.join(root, file), JSON.stringify(value), { mode: 0o600 });
  await Promise.all([policyDir, requests, 'reports/clippers-daily-learning'].map(p => mkdir(path.join(root, p), { recursive: true })));
  await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
    'color=c=red:s=320x180:r=8:d=10,drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill,drawbox=x=160:y=0:w=160:h=180:color=lime:t=fill:enable=\'gte(t,1)\'',
    '-f', 'lavfi', '-i', 'sine=frequency=300:duration=10', '-c:v', 'libx264', '-c:a', 'aac',
    '-shortest', path.join(root, 'source.mp4')]);
  const sourceSha256 = engineSha(await readFile(path.join(root, 'source.mp4')));
  const engineSha256 = engineSha(await readFile(new URL('../script/clippers-portfolio-render.mjs', import.meta.url)));
  const standard = { hook: 0, duration: 5, crop: 'left', caption_layout: 'off', posting_slot: ['12:00', '14:00', '16:00', '18:00', '20:00'] };
  const manifest = (version, overrides = {}) => ({
    schemaVersion: 1, destination: target, version, engineSha256, reviewedBy: 'qa',
    params: { ...standard, ...overrides },
  });
  await write(policyDir + '/baseline-1.json', manifest('baseline-1'));
  await write(policyDir + '/candidate.json', manifest('candidate', { crop: 'right' }));
  const request = (id, policyVersion, experiment, overrides = {}) => ({
    schemaVersion: 1, ...target, id, policyVersion, experiment, sourceFile: 'source.mp4', sourceSha256,
    sourceStartSeconds: 0, rights: { destination: target, sourceSha256, termsUrl: 'https://example.com/owned',
      sourceScope: 'exact_asset', commercialPermission: 'approved', reviewedBy: 'reviewer', basis: 'owned',
      membership: 'not_required', ownership: 'verified', sourcePublishedAt: '2026-11-17T14:00:00Z',
      observedAt: '2026-11-18T14:00:00Z', validUntil: '2026-11-19T14:00:00Z' }, ...overrides,
  });
  const trial = { id: 'trial', context: 'original', baselineVersion: 'baseline-1', candidateVersion: 'candidate', variable: 'crop' };
  const baseRequest = request('control', 'baseline-1', { ...trial, arm: 'control' });
  const candidateRequest = request('candidate', 'candidate', { ...trial, arm: 'candidate' });
  await write(requests + '/control.json', baseRequest);
  await write(requests + '/candidate.json', candidateRequest);
  const run = requestId => renderClippersPortfolio({ workspaceRoot: root, requestId, now });
  const baseline = await run('control');
  assert.equal((await run('control')).draftFile, baseline.draftFile, 'an identical retry returns the existing receipt');
  assert.equal(baseline.renderRequestSha256, engineSha(JSON.stringify(baseRequest)));
  assert.equal(baseline.captionTextSha256, engineSha(''));
  const oldControl = { ...target, id: 'control', policyVersion: 'baseline-1', experiment: baseRequest.experiment,
    draftFile: baseline.draftFile, mediaSha256: baseline.outputSha256, renderReceiptSha256: baseline.receiptSha256,
    scheduledAt: '2026-11-18T17:00:00.000Z' };
  const revisedRights = { ...baseRequest, rights: { ...baseRequest.rights, observedAt: '2026-11-18T14:01:00Z' } };
  await write(requests + '/control.json', revisedRights);
  assert.equal(await confirmedRenderReceipt(root, oldControl, target), null, 'a current request cannot relabel an old receipt');
  await assert.rejects(run('control'), /render_receipt_conflict/, 'same bytes do not overwrite an older request receipt');
  await write(requests + '/control.json', baseRequest);
  assert.ok(await confirmedRenderReceipt(root, oldControl, target), 'the original immutable receipt remains usable with its original request');
  const other = DESTINATIONS[3];
  const otherPolicyDir = config + '/render-policies/' + destinationKey(other).replaceAll(':', '__');
  await mkdir(path.join(root, otherPolicyDir), { recursive: true });
  await write(otherPolicyDir + '/baseline-1.json', { ...manifest('baseline-1'), destination: other });
  const crossRequest = request('cross-account', 'baseline-1', null, other);
  crossRequest.rights.destination = other;
  await write(requests + '/cross-account.json', crossRequest);
  const crossAccount = await run('cross-account');
  assert.equal(crossAccount.outputSha256, baseline.outputSha256, 'identical bytes may have independently scoped receipts');
  assert.notEqual(crossAccount.receiptSha256, baseline.receiptSha256);
  const candidate = await run('candidate');
  assert.equal(candidate.actualParams.crop, 'right');
  assert.equal(candidate.actualParams.duration, 5);
  assert.notEqual(candidate.outputSha256, baseline.outputSha256);
  const middlePixel = async receipt => (await exec('ffmpeg', ['-v', 'error', '-i', path.join(root, receipt.draftFile),
    '-frames:v', '1', '-vf', 'crop=2:2:540:960', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'],
  { encoding: 'buffer' })).stdout;
  assert.ok((await middlePixel(baseline))[0] > 200);
  assert.ok((await middlePixel(candidate))[2] > 200);
  const asset = { ...target, id: 'candidate', policyVersion: 'candidate', experiment: candidateRequest.experiment,
    draftFile: candidate.draftFile, mediaSha256: candidate.outputSha256, renderReceiptSha256: candidate.receiptSha256,
    scheduledAt: '2026-11-18T17:00:00.000Z' };
  assert.ok(await confirmedRenderReceipt(root, asset, target));
  assert.ok(await confirmedRenderReceipt(root, { ...asset, scheduledAt: '2026-11-18T19:00:00.000Z' }, target));
  assert.equal(await confirmedRenderReceipt(root, { ...asset, scheduledAt: '2026-11-18T17:10:00.000Z' }, target), null);
  assert.equal(await confirmedRenderReceipt(root, asset, DESTINATIONS[1]), null);
  const draftPath = path.join(root, asset.draftFile);
  const originalBytes = await readFile(draftPath);
  await writeFile(draftPath, 'tampered media');
  assert.equal(await confirmedRenderReceipt(root, asset, target), null);
  await writeFile(draftPath, originalBytes);
  await mkdir(path.join(root, config, 'evidence'), { recursive: true });
  const publishable = {
    ...asset, campaignId: 'owned-fixture', sourceId: 'owned', creator: 'owner', language: 'en',
    sourceUrl: 'https://example.com/source/one', sourcePublishedAt: candidateRequest.rights.sourcePublishedAt,
    rightsObservedAt: candidateRequest.rights.observedAt, rightsValidUntil: candidateRequest.rights.validUntil,
    caption: 'Fixture original', thirdPartyCommercial: false, mediaReceiptFileId: 'approved-drive-file',
    mediaUrl: 'https://drive.google.com/uc?id=approved-drive-file',
  };
  const evidence = {
    ...publishable, assetId: publishable.id, destination: target, commercialPermission: 'approved', sourceScope: 'exact_asset',
    rightsBasis: 'owned', membership: 'not_required', ownership: 'verified', quality: 'passed', originalEdit: 'verified',
    disclosure: 'verified', reviewedBy: 'qa', authorizedSpendUsd: 0, providerIncrementalCostUsd: 0,
    termsUrl: candidateRequest.rights.termsUrl,
  };
  const evidenceSha256 = engineSha(JSON.stringify(evidence));
  await write(config + '/evidence/' + evidenceSha256 + '.json', evidence);
  await write(config + '/approved-input.json', { schemaVersion: 1, assets: [{ ...publishable, evidenceSha256 }],
    reviews: [], publish: true, collect: false });
  const publicReceipt = { ...target, renderReceiptSha256: publishable.renderReceiptSha256,
    fileId: publishable.mediaReceiptFileId, campaignId: publishable.campaignId, status: 'ready', draftFile: publishable.draftFile,
    mediaUrl: publishable.mediaUrl, sha256: publishable.mediaSha256, paidSpendAllowed: false };
  const scopedMediaLedger = 'reports/clippers-daily-learning/portfolio-media-receipts.json';
  await write(scopedMediaLedger, [{ ...publicReceipt, brandId: DESTINATIONS[1].brandId, account: DESTINATIONS[1].account }]);
  await write('reports/metricool-public-media-receipts.json', [publicReceipt]);
  const mismatch = await runClippersDailyLearning({ workspaceRoot: root, now, adapter: {
    preflight() { throw new Error('cross-account upload receipt must never reach the provider'); },
  } });
  assert.equal(mismatch.destinations[0].eligible, 0, 'a render is not approved by a different destination or legacy upload receipt');
  await write('reports/clippers-daily-learning/state.json', { schemaVersion: 1, day: null,
    deliveries: [], observations: [], history: [], versions: {} });
  await write(scopedMediaLedger, [publicReceipt]);
  const report = await runClippersDailyLearning({ workspaceRoot: root, now, adapter: {
    preflight: async () => {},
    crossAccountPreflight: async () => ({ checkedDays: [] }),
    schedule: async (_destination, verified) => {
      assert.equal(verified.renderProof.manifestSha, candidate.manifestSha);
      assert.equal(verified.mediaSha256, candidate.outputSha256);
      return 'fixture-remote-schedule';
    },
  } });
  assert.equal(report.scheduled, 1);
  await write(policyDir + '/candidate.json', manifest('candidate', { crop: 'right', hook: 1 }));
  await assert.rejects(run('candidate'), /must_change_one_variable/);

  await write(policyDir + '/slot-candidate.json', manifest('slot-candidate', { posting_slot: ['12:00', '21:00'] }));
  const slotExperiment = { ...trial, variable: 'posting_slot', arm: 'candidate', candidateVersion: 'slot-candidate' };
  await write(requests + '/slot-test.json', request('slot-test', 'slot-candidate', slotExperiment));
  const slotResult = await run('slot-test');
  const slotAsset = { ...target, id: 'slot-test', policyVersion: 'slot-candidate', experiment: slotExperiment,
    draftFile: slotResult.draftFile, mediaSha256: slotResult.outputSha256, renderReceiptSha256: slotResult.receiptSha256 };
  assert.equal(await confirmedRenderReceipt(root, { ...slotAsset, scheduledAt: '2026-11-18T17:00:00.000Z' }, target), null,
    'a shared slot does not prove a posting-slot experiment');
  assert.ok(await confirmedRenderReceipt(root, { ...slotAsset, scheduledAt: '2026-11-19T02:00:00.000Z' }, target));
  const active = manifest('active', { hook: 1, duration: 6, crop: 'right' });
  const activeDigest = engineSha(JSON.stringify(active));
  await write(policyDir + '/active.json', active);
  await write('reports/clippers-daily-learning/state.json', { schemaVersion: 1, versions: { [key]: 'active' },
    history: [{ destination: key, toManifestSha: activeDigest }] });
  await assert.rejects(run('control'), /experiment_version_invalid/);
  await write(requests + '/active.json', request('active', 'active', null, { captionText: 'Verified edit' }));
  const result = await run('active');
  assert.equal(result.actualParams.caption_layout, 'off');
  assert.equal(result.startSeconds, 1);
  assert.ok((await middlePixel(result))[1] > 200, 'the reviewed hook offset seeks into the green segment');
  assert.equal(result.actualParams.duration, 6);
  await t.test('optional caption output uses reviewed placement', { skip: !hasMagick && 'ImageMagick unavailable' }, async () => {
    const captioned = manifest('captioned', { hook: 1, duration: 6, crop: 'right', caption_layout: 'upper' });
    await write(policyDir + '/captioned.json', captioned);
    await write('reports/clippers-daily-learning/state.json', { schemaVersion: 1, versions: { [key]: 'captioned' },
      history: [{ destination: key, toManifestSha: engineSha(JSON.stringify(captioned)) }] });
    const captionRequest = request('captioned', 'captioned', null, { captionText: 'Verified edit' });
    await write(requests + '/captioned.json', captionRequest);
    const overlay = await run('captioned');
    assert.equal(overlay.actualParams.caption_layout, 'upper');
    assert.notEqual(overlay.outputSha256, result.outputSha256);
    assert.equal(overlay.captionTextSha256, engineSha('Verified edit'));
    const captionAsset = { ...target, id: 'captioned', policyVersion: 'captioned',
      draftFile: overlay.draftFile, mediaSha256: overlay.outputSha256, renderReceiptSha256: overlay.receiptSha256,
      scheduledAt: '2026-11-18T17:00:00.000Z' };
    assert.ok(await confirmedRenderReceipt(root, captionAsset, target));
    await write(requests + '/captioned.json', { ...captionRequest, captionText: 'Another reviewed caption' });
    assert.equal(await confirmedRenderReceipt(root, captionAsset, target), null, 'changing a caption cannot approve the old video');
    await write(requests + '/captioned.json', captionRequest);
    await write('reports/clippers-daily-learning/state.json', { schemaVersion: 1, versions: { [key]: 'active' },
      history: [{ destination: key, toManifestSha: activeDigest }] });
  });
  await write(policyDir + '/active.json', manifest('active', { hook: 3, duration: 6, crop: 'right', caption_layout: 'upper' }));
  await assert.rejects(run('active'), /active_render_manifest_changed/);
});
