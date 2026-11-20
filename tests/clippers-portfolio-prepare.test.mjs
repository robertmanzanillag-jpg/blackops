import { nativeReceiptDigest, nativeAssetMediaFields, approvedNativeMedia, verifyMetricoolNativeBytes, metricoolNativeUrl, reconcileExternalMetricoolSchedule, verifiedExternalSchedules } from '../script/clippers-native-media-receipts.mjs';
import { buildClippersOrchestraReport } from '../script/clippers-orchestra-report.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, stat, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import test from 'node:test';
import { runClippersPortfolioPrepare, verifyPublicBytes, publicDriveUrl, driveHelperEnvironment, claimDriveOperation } from '../script/clippers-portfolio-prepare.mjs';
import { renderClippersPortfolio, confirmedRenderReceipt } from '../script/clippers-portfolio-render.mjs';
import { runClippersDailyLearning, validateApprovedClippersAsset } from '../script/clippers-daily-learning.mjs';
import { DESTINATIONS, destinationKey } from '../script/clippers-portfolio-metricool.mjs';

const exec = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const now = new Date('2026-11-18T15:00:00.000Z');
const env = { CLIPPERS_PORTFOLIO_PREPARE_ENABLED: 'true', CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: 'true' };
const CONFIG = 'config/clippers-daily-learning';
const REPORT = 'reports/clippers-daily-learning';
const hasTools = ['ffmpeg', 'ffprobe'].every(cmd => spawnSync(cmd, ['-version']).status === 0);

async function fixture(t, targets = [DESTINATIONS[0]], creatorSelection) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'portfolio-prepare-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (relative, data) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true, mode: 0o700 });
    await writeFile(path.join(root, relative), JSON.stringify(data), { mode: 0o600 });
  };
  await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=8:d=6',
    '-f', 'lavfi', '-i', 'sine=frequency=300:duration=6', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', path.join(root, 'original.mp4')]);
  const sourceSha256 = hash(await readFile(path.join(root, 'original.mp4')));
  const engineSha256 = hash(await readFile(new URL('../script/clippers-portfolio-render.mjs', import.meta.url)));
  const packets = [];
  for (const [index, destination] of targets.entries()) {
    const id = 'original-' + index, scoped = destinationKey(destination).replaceAll(':', '__');
    await write(`${CONFIG}/render-policies/${scoped}/baseline-1.json`, { schemaVersion: 1, version: 'baseline-1',
      destination, engineSha256, reviewedBy: 'independent-qa',
      params: { hook: 0, duration: 5, crop: 'center', caption_layout: 'off', posting_slot: ['12:00', '14:00', '16:00', '18:00', '20:00'] } });
    const request = { schemaVersion: 1, ...destination, id, policyVersion: 'baseline-1', sourceFile: 'original.mp4',
      sourceSha256, sourceStartSeconds: 0, rights: { destination, sourceSha256, termsUrl: 'https://example.com/owned-policy',
        sourceScope: 'exact_asset', commercialPermission: 'approved', reviewedBy: 'rights-reviewer', basis: 'owned',
        membership: 'not_required', ownership: 'verified', sourcePublishedAt: '2026-11-18T13:00:00.000Z',
        observedAt: '2026-11-18T14:00:00.000Z', validUntil: '2026-11-19T15:00:00.000Z',
        permittedNetworks: [destination.network], thirdPartyCommercial: false } };
    if (creatorSelection !== undefined) request.creatorSelection = creatorSelection;
    await write(`${CONFIG}/render-requests/${id}.json`, request);
    const rendered = await renderClippersPortfolio({ workspaceRoot: root, requestId: id, now });
    const packet = { schemaVersion: 1, id, destination, renderRequestSha256: digest(request),
      renderReceiptSha256: rendered.receiptSha256, outputSha256: rendered.outputSha256,
      publicUploadAuthorized: true, schedulerAssetAuthorized: true, reviewedBy: 'media-reviewer',
      campaignId: 'owned-fixture', sourceId: 'source-' + index, sourceUrl: creatorSelection ? 'https://www.youtube.com/watch?v=aaaaaaaaaaa' : 'https://example.com/original/' + index,
      creator: creatorSelection ? 'mrbeast' : 'original-owner', language: 'en', caption: 'Original fixture ' + index,
      scheduledAt: '2026-11-18T17:00:00.000Z', thirdPartyCommercial: false, quality: 'passed',
      originalEdit: 'verified', disclosure: 'verified', authorizedSpendUsd: 0, providerIncrementalCostUsd: 0 };
    await write(`${CONFIG}/prepare-requests/${id}.json`, packet);
    packets.push({ packet, request, rendered });
  }
  const calls = { folder: 0, upload: 0, public: 0, verify: 0 }; const files = new Map();
  const adapter = {
    async ensureFolder() { calls.folder++; return 'private-folder-0001'; },
    async uploadFile({ filePath }) { calls.upload++; const fileId = 'fixture-drive-file-' + calls.upload;
      files.set(fileId, { bytes: await readFile(filePath), public: false }); return { fileId }; },
    async makePublic(fileId) { calls.public++; files.get(fileId).public = true; return publicDriveUrl(fileId); },
    async verifyPublic(url, sha, size) { calls.verify++; const file = files.get(new URL(url).searchParams.get('id'));
      return file?.public && file.bytes.length === size && hash(file.bytes) === sha; },
  };
  const renderer = { confirmedRenderReceipt, renderClippersPortfolio() { throw Error('prepare must not rerender reviewed output'); } };
  const run = options => runClippersPortfolioPrepare({ workspaceRoot: root, now, env, dependencies: adapter, renderer, ...options });
  return { root, write, packets, calls, files, adapter, renderer, run };
}

test('disabled and empty default paths never import an uploader or contact a provider', async t => {
  assert.equal((await runClippersPortfolioPrepare()).status, 'disabled');
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'portfolio-empty-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const r = await runClippersPortfolioPrepare({ workspaceRoot: root, now, env,
    dependencies: new Proxy({}, { get() { throw Error('no provider activity expected'); } }) });
  assert.equal(r.reason, 'no_reviewed_prepare_packets');
  assert.equal(r.prepared, 0);
});

test('Drive helper receives the configured owner and only its existing credential scope', () => {
  const cleaned = driveHelperEnvironment({ DEFAULT_USER_ID: 'owner-fixture', GOOGLE_DRIVE_CLIENT_ID: 'drive-client',
    GOOGLE_DRIVE_CLIENT_SECRET: 'synthetic-drive-secret', REPL_IDENTITY: 'synthetic-existing-identity',
    OPENAI_API_KEY: 'synthetic-unused-key', GOOGLE_MAPS_API_KEY: 'synthetic-unused-key',
    METRICOOL_USER_TOKEN: 'synthetic-unused-token', YOUTUBE_REFRESH_TOKEN: 'synthetic-unused-token',
    NODE_OPTIONS: '--require unsafe-hook' });
  assert.deepEqual(Object.keys(cleaned).sort(), ['DEFAULT_USER_ID', 'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'REPL_IDENTITY']);
});

test('real original renders prepare all four exact destinations with one upload and preserve publisher switches', { skip: !hasTools }, async t => {
  const f = await fixture(t, DESTINATIONS);
  assert.equal(new Set(f.packets.map(x => x.rendered.outputSha256)).size, 1);
  const r = await f.run();
  assert.equal(r.prepared, 4); assert.equal(r.uploaded, 1); assert.equal(r.paidSpendUsd, 0);
  assert.deepEqual([f.calls.folder, f.calls.upload, f.calls.public], [1, 1, 1]);
  const input = JSON.parse(await readFile(path.join(f.root, CONFIG, 'approved-input.json')));
  assert.equal(input.publish, false); assert.equal(input.collect, false); assert.equal(input.assets.length, 4);
  const receipts = JSON.parse(await readFile(path.join(f.root, REPORT, 'portfolio-media-receipts.json')));
  assert.equal(receipts.length, 4); assert.equal(new Set(receipts.map(destinationKey)).size, 4);
  assert.ok(receipts.every(x => x.renderReceiptSha256 && x.paidSpendAllowed === false));
  assert.equal((await stat(path.join(f.root, REPORT, 'portfolio-media-receipts.json'))).mode & 0o077, 0);
  const learning = await runClippersDailyLearning({ workspaceRoot: f.root, now,
    adapter: new Proxy({}, { get() { throw Error('publisher remains disabled'); } }) });
  assert.ok(learning.destinations.every(row => row.eligible === 1));
  const again = await f.run(); assert.equal(again.prepared, 4);
  assert.deepEqual([f.calls.folder, f.calls.upload, f.calls.public], [1, 1, 1], 'retries only verify existing public bytes');
});

test('protected, wrong-network, changed render or unreviewed packets hold before any provider call', { skip: !hasTools }, async t => {
  const f = await fixture(t); const original = f.packets[0];
  const mutations = [
    p => { p.destination = { brandId: 6431692, network: 'tiktok', account: 'kongnightlife' }; },
    p => { p.publicUploadAuthorized = false; }, p => { p.outputSha256 = 'f'.repeat(64); },
    p => { p.renderRequestSha256 = 'e'.repeat(64); }, p => { p.thirdPartyCommercial = true; },
    p => { p.scheduledAt = '2026-11-19T17:00:00.000Z'; }, p => { p.authorizedSpendUsd = 1; },
  ];
  for (const change of mutations) {
    const p = structuredClone(original.packet); change(p);
    await f.write(`${CONFIG}/prepare-requests/${p.id}.json`, p);
    assert.equal((await f.run()).prepared, 0);
    assert.equal(f.calls.upload, 0); assert.equal(f.calls.folder, 0);
  }
  const request = structuredClone(original.request); request.rights.permittedNetworks = ['facebook'];
  const packet = { ...original.packet, renderRequestSha256: digest(request) };
  await f.write(`${CONFIG}/render-requests/${request.id}.json`, request);
  await f.write(`${CONFIG}/prepare-requests/${packet.id}.json`, packet);
  assert.equal((await f.run()).prepared, 0, 'a public policy is not automatically valid for another network');
  assert.equal(f.calls.upload, 0);
});

test('cached media cannot be relabeled with another approved source or cut', { skip: !hasTools }, async t => {
  const f = await fixture(t), original = f.packets[0];
  for (const change of [request => { request.sourceSha256 = 'b'.repeat(64); request.rights.sourceSha256 = request.sourceSha256; },
    request => { request.sourceStartSeconds = 1; }]) {
    const request = structuredClone(original.request); change(request);
    await f.write(`${CONFIG}/render-requests/${request.id}.json`, request);
    await f.write(`${CONFIG}/prepare-requests/${request.id}.json`, { ...original.packet, renderRequestSha256: digest(request) });
    const result = await f.run();
    assert.equal(result.prepared, 0); assert.equal(result.outcomes[0].reason, 'reviewed_render_output_changed');
    assert.equal(f.calls.upload, 0); assert.equal(f.calls.public, 0);
  }
});

test('obvious same-id queue conflicts and stale packets cannot trigger needless public writes or starve a valid packet', { skip: !hasTools }, async t => {
  const f = await fixture(t), original = f.packets[0];
  await f.write(`${CONFIG}/approved-input.json`, { schemaVersion: 1, publish: false, collect: false, reviews: [],
    assets: [{ ...DESTINATIONS[0], id: original.packet.id, caption: 'Known conflicting text', scheduledAt: original.packet.scheduledAt }] });
  const held = await f.run(); assert.equal(held.prepared, 0); assert.equal(held.outcomes[0].reason, 'approved_asset_conflict');
  assert.equal(f.calls.upload, 0); assert.equal(f.calls.public, 0);
  await f.write(`${CONFIG}/approved-input.json`, { schemaVersion: 1, publish: false, collect: false, reviews: [], assets: [] });
  for (let index = 0; index < 20; index++) await f.write(`${CONFIG}/prepare-requests/aaa-stale-${index}.json`,
    { ...original.packet, id: 'aaa-stale-' + index, scheduledAt: '2026-11-17T17:00:00.000Z' });
  const prepared = await f.run(); assert.equal(prepared.prepared, 1);
  assert.equal(f.calls.upload, 1, 'twenty invalid earlier names do not consume the usable-packet budget');
});

test('Drive mutations have one-time durable claims tied to a live preparation and expected ledger state', { skip: !hasTools }, async t => {
  const f = await fixture(t), item = f.packets[0], sha = item.rendered.outputSha256;
  const active = { pid: process.ppid, nonce: randomUUID(), startedAt: new Date().toISOString() };
  await f.write(`${REPORT}/portfolio-prepare.lock`, active);
  const upload = { sha256: sha, status: 'upload_unknown', folderId: 'private-folder-0001' };
  await f.write(`${REPORT}/portfolio-upload-state.json`, { schemaVersion: 1, uploads: { [sha]: upload }, targets: [] });
  const auth = { outputSha256: sha, packetSha256: digest(item.packet), parentPid: active.pid, operationNonce: active.nonce };
  await assert.rejects(claimDriveOperation(f.root, auth, 'upload', { folderId: 'wrong-folder-0001' }), /drive_operation_state_invalid/);
  await claimDriveOperation(f.root, auth, 'upload', { folderId: upload.folderId });
  await assert.rejects(claimDriveOperation(f.root, auth, 'upload', { folderId: upload.folderId }), /EEXIST/);
  upload.status = 'sharing_unknown'; upload.fileId = 'fixture-drive-file-1';
  await f.write(`${REPORT}/portfolio-upload-state.json`, { schemaVersion: 1, uploads: { [sha]: upload }, targets: [] });
  await claimDriveOperation(f.root, auth, 'public', { fileId: upload.fileId });
  await assert.rejects(claimDriveOperation(f.root, auth, 'public', { fileId: upload.fileId }), /EEXIST/);
  upload.status = 'ready';
  await f.write(`${REPORT}/portfolio-upload-state.json`, { schemaVersion: 1, uploads: { [sha]: upload }, targets: [] });
  await assert.rejects(claimDriveOperation(f.root, auth, 'upload', { folderId: upload.folderId }), /drive_operation_state_invalid/);
  await f.write(`${REPORT}/portfolio-prepare.lock`, { ...active, nonce: randomUUID() });
  await assert.rejects(claimDriveOperation(f.root, auth, 'public', { fileId: upload.fileId }), /prepare_parent_unconfirmed/);
});

test('a pre-existing nonprivate staging directory holds before provider writes', { skip: !hasTools }, async t => {
  const f = await fixture(t), stage = path.join(f.root, REPORT, 'upload-stage');
  await mkdir(stage, { recursive: true }); await chmod(stage, 0o777);
  const result = await f.run();
  assert.equal(result.prepared, 0); assert.equal(result.outcomes[0].reason, 'private_stage_directory_required');
  assert.equal(f.calls.folder, 0); assert.equal(f.calls.upload, 0); assert.equal(f.calls.public, 0);
});

test('an uncertain upload is persisted before the call and never repeated', { skip: !hasTools }, async t => {
  const f = await fixture(t); let uploads = 0;
  f.adapter.uploadFile = async () => { uploads++; const state = JSON.parse(await readFile(path.join(f.root, REPORT, 'portfolio-upload-state.json')));
    assert.equal(Object.values(state.uploads)[0].status, 'upload_unknown'); throw Error('lost acknowledgement'); };
  assert.equal((await f.run()).prepared, 0);
  const again = await f.run(); assert.equal(again.outcomes[0].reason, 'upload_outcome_unknown_no_replay');
  assert.equal(uploads, 1); assert.equal(f.calls.public, 0);
});

test('a lost public-sharing acknowledgement is reconciled by exact public read only', { skip: !hasTools }, async t => {
  const f = await fixture(t); let shares = 0;
  f.adapter.makePublic = async fileId => { shares++; f.files.get(fileId).public = true; throw Error('sharing acknowledgement lost'); };
  assert.equal((await f.run()).prepared, 0);
  assert.equal((await f.run()).prepared, 1);
  assert.equal(f.calls.upload, 1); assert.equal(shares, 1);
});

test('an occupied scheduler slot prevents new public upload', { skip: !hasTools }, async t => {
  const f = await fixture(t); const destination = DESTINATIONS[0];
  await f.write(`${CONFIG}/approved-input.json`, { schemaVersion: 1, publish: false, collect: false, reviews: [],
    assets: [{ ...destination, id: 'previous', scheduledAt: f.packets[0].packet.scheduledAt }] });
  const result = await f.run(); assert.equal(result.prepared, 0);
  assert.equal(result.outcomes[0].reason, 'destination_daily_cap_or_slot_conflict'); assert.equal(f.calls.upload, 0);
});

test('five existing slots, full queue and changed approved bytes hold before upload', { skip: !hasTools }, async t => {
  const f = await fixture(t); const destination = DESTINATIONS[0];
  await f.write(`${CONFIG}/approved-input.json`, { schemaVersion: 1, publish: false, collect: false, reviews: [],
    assets: ['17', '19', '21', '23'].map((hour, i) => ({ ...destination, id: 'old-' + i,
      scheduledAt: `2026-11-18T${hour}:00:00.000Z` })).concat([{ ...destination, id: 'old-4', scheduledAt: '2026-11-19T01:00:00.000Z' }]) });
  assert.equal((await f.run()).outcomes[0].reason, 'destination_daily_cap_or_slot_conflict');
  assert.equal(f.calls.upload, 0);
  await f.write(`${CONFIG}/approved-input.json`, { schemaVersion: 1, publish: false, collect: false, reviews: [],
    assets: Array.from({ length: 250 }, (_, i) => ({ ...destination, id: 'historic-' + i, scheduledAt: '2026-01-01T17:00:00.000Z' })) });
  assert.equal((await f.run()).outcomes[0].reason, 'approved_queue_capacity'); assert.equal(f.calls.upload, 0);
  await f.write(`${CONFIG}/approved-input.json`, { schemaVersion: 1, publish: false, collect: false, reviews: [], assets: [] });
  await writeFile(path.join(f.root, f.packets[0].rendered.draftFile), 'changed after review');
  assert.equal((await f.run()).prepared, 0); assert.equal(f.calls.upload, 0);
});

test('the internal Drive helper rejects an unbound direct public-sharing command', () => {
  const result = spawnSync(process.execPath, [new URL('../script/clippers-portfolio-prepare.mjs', import.meta.url).pathname,
    '--drive-operation', 'public'], { input: JSON.stringify({ fileId: 'not-an-approved-file' }),
    env: { PATH: process.env.PATH, CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: 'true' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});

test('the whole prepare cycle has a deadline and an uncertain provider write stays fenced', { skip: !hasTools }, async t => {
  const f = await fixture(t); f.adapter.ensureFolder = () => new Promise(() => {});
  const started = Date.now(); const r = await f.run({ maxCycleMs: 200 });
  assert.equal(r.prepared, 0); assert.ok(Date.now() - started < 2000);
  assert.equal(r.outcomes[0].reason, 'prepare_time_budget_reached');
  assert.equal((await f.run()).outcomes[0].reason, 'upload_outcome_unknown_no_replay');
});

test('public verification rejects wrong bytes, HTML and redirects outside Google without credentials', async () => {
  const bytes = Buffer.from('owned-video'); const url = publicDriveUrl('fixture-drive-id');
  const good = async (_url, options) => { assert.equal(options.redirect, 'manual'); assert.equal(options.headers, undefined);
    return new Response(bytes, { headers: { 'content-type': 'video/mp4' } }); };
  assert.equal(await verifyPublicBytes(url, hash(bytes), bytes.length, good), true);
  assert.equal(await verifyPublicBytes(url, 'f'.repeat(64), bytes.length, good), false);
  assert.equal(await verifyPublicBytes(url, hash(bytes), bytes.length,
    async () => new Response(bytes, { headers: { 'content-type': 'text/html' } })), false);
  let calls = 0;
  assert.equal(await verifyPublicBytes(url, hash(bytes), bytes.length, async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'https://evil.example/content.mp4' } });
  }), false);
  assert.equal(calls, 1);
});

test('reviewed render-request creator context reaches hash-bound evidence without granting publication', { skip: !hasTools }, async t => {
 const m={format:'vertical_clip',context:'streamer_clip',channelId:'UCX6OQ3DkcsbYNE6H8uQQuVA',sourceVideoId:'aaaaaaaaaaa',postingBand:'12:00',timezone:'America/New_York',windowHours:24};const f=await fixture(t,[DESTINATIONS[0]],m);const r=await f.run();assert.equal(r.prepared,1);
 const input=JSON.parse(await readFile(path.join(f.root,CONFIG,'approved-input.json')));const evidence=JSON.parse(await readFile(path.join(f.root,CONFIG,'evidence',input.assets[0].evidenceSha256+'.json')));assert.deepEqual(evidence.creatorSelection,m);assert.equal(digest(evidence),input.assets[0].evidenceSha256);assert.equal(input.publish,false);assert.equal(input.collect,false);
});
test('malformed optional creator context remains unmeasured and preserves otherwise authorized legacy preparation', { skip: !hasTools }, async t => {
 const m={format:'vertical_clip',context:'streamer_clip',channelId:'UCX6OQ3DkcsbYNE6H8uQQuVA',sourceVideoId:'aaaaaaaaaaa',postingBand:'13:00',timezone:'America/New_York',windowHours:24};const f=await fixture(t,[DESTINATIONS[0]],m);const r=await f.run();assert.equal(r.prepared,1);assert.equal(r.outcomes[0].creatorSelectionHeld,'creator_context_not_reviewed');const input=JSON.parse(await readFile(path.join(f.root,CONFIG,'approved-input.json')));const evidence=JSON.parse(await readFile(path.join(f.root,CONFIG,'evidence',input.assets[0].evidenceSha256+'.json')));assert.equal(evidence.creatorSelection,undefined);assert.equal(input.publish,false);
});

test('changing optional creator metadata after rendering cannot relabel a reviewed cached render', { skip: !hasTools }, async t => {
 const m={format:'vertical_clip',context:'streamer_clip',channelId:'UCX6OQ3DkcsbYNE6H8uQQuVA',sourceVideoId:'aaaaaaaaaaa',postingBand:'12:00',timezone:'America/New_York',windowHours:24};const f=await fixture(t,[DESTINATIONS[0]],m),p=f.packets[0];p.request.creatorSelection.context='different_context';p.packet.renderRequestSha256=digest(p.request);await f.write(`${CONFIG}/render-requests/${p.packet.id}.json`,p.request);await f.write(`${CONFIG}/prepare-requests/${p.packet.id}.json`,p.packet);const r=await f.run();assert.equal(r.prepared,0);assert.equal(f.calls.upload,0);assert.equal(f.calls.public,0);
});

const NATIVE_URL='https://static.metricool.com/video/123/202611/synthetic-original.mp4';
async function nativeFixture(t){
 const f=await fixture(t),{packet,rendered}=f.packets[0];packet.mediaProvider='metricool';await f.write(`${CONFIG}/prepare-requests/${packet.id}.json`,packet);
 const bytes=await readFile(path.join(f.root,rendered.draftFile));
 const receipt={schemaVersion:1,provider:'metricool',kind:'metricool_native_media_receipt',status:'ready',assetId:packet.id,destination:packet.destination,renderReceiptSha256:packet.renderReceiptSha256,renderRequestSha256:packet.renderRequestSha256,sha256:packet.outputSha256,sizeBytes:bytes.length,mediaUrl:NATIVE_URL,resource:{kind:'metricool_cdn_url',url:NATIVE_URL},verifiedAt:now.toISOString(),verification:'anonymous_exact_bytes_sha256',paidSpendAllowed:false,paidSpendUsd:0,authorizedManifestSha256:digest(packet)};
 await f.write(`${REPORT}/native-media-imports/${packet.id}.json`,receipt);
 f.adapter.nativeFetch=async(url,options)=>{assert.equal(url,NATIVE_URL);assert.equal(options.redirect,'error');assert.equal(Object.keys(options.headers).some(k=>/auth|token/i.test(k)),false);return new Response(bytes,{headers:{'content-type':'video/mp4','content-length':String(bytes.length)}});};
 return {...f,receipt,bytes};
}
test('typed native exact bytes prepare without Drive IDs, uploads or provider scheduling; replay stays immutable',{skip:!hasTools},async t=>{
 const f=await nativeFixture(t);const first=await f.run();assert.equal(first.prepared,1);assert.equal(first.uploaded,0);assert.equal(f.calls.upload,0);assert.equal(f.calls.folder,0);
 const input=JSON.parse(await readFile(path.join(f.root,CONFIG,'approved-input.json')));const asset=input.assets[0];assert.equal(asset.mediaProvider,'metricool');assert.equal(Object.hasOwn(asset,'mediaReceiptFileId'),false);assert.equal(asset.mediaReceiptSha256,digest(f.receipt));assert.equal(input.publish,false);
 const rows=JSON.parse(await readFile(path.join(f.root,REPORT,'portfolio-media-receipts.json')));assert.equal(approvedNativeMedia(asset,rows),true);assert.equal(Object.hasOwn(rows[0],'fileId'),false);
 assert.equal((await f.run()).prepared,1);assert.equal(f.calls.upload,0);
 const state={deliveries:[],observations:[],history:[],versions:{}};assert.ok(await validateApprovedClippersAsset(asset,f.root,now,rows,state));assert.equal(await validateApprovedClippersAsset({...asset,mediaReceiptFileId:'forged-drive-id'},f.root,now,rows,state),null);assert.equal(await validateApprovedClippersAsset({...asset,mediaReceiptSha256:'0'.repeat(64)},f.root,now,rows,state),null);
 for(const mutate of [x=>x.assetId='other',x=>x.destination=DESTINATIONS[1],x=>x.sha256='a'.repeat(64),x=>x.authorizedManifestSha256='b'.repeat(64),x=>x.renderRequestSha256='c'.repeat(64)]){const bad=structuredClone(f.receipt);mutate(bad);await f.write(`${REPORT}/native-media-imports/${asset.id}.json`,bad);const r=await f.run();assert.equal(r.prepared,0);assert.equal(f.calls.upload,0);}
});
test('native remote media refuses redirects, query credentials, response shape and mismatching exact bytes',async()=>{
 const bytes=Buffer.from('original synthetic bytes'),h=hash(bytes);
 assert.equal(await verifyMetricoolNativeBytes(NATIVE_URL,h,bytes.length,{fetcher:async()=>new Response(bytes,{headers:{'content-type':'video/mp4'}})}),true);
 for(const u of [NATIVE_URL+'?token=no',NATIVE_URL+'#x',NATIVE_URL.replace('static.metricool.com','evil.example'),NATIVE_URL.replace('https://','https://user:pass@'),[NATIVE_URL]])assert.equal(metricoolNativeUrl(u),null);
 for(const fetcher of [async()=>Response.redirect(NATIVE_URL),async()=>new Response(bytes,{headers:{'content-type':'text/html'}}),async()=>new Response(Buffer.concat([bytes,bytes]),{headers:{'content-type':'video/mp4'}}),async()=>new Response(Buffer.alloc(bytes.length),{headers:{'content-type':'video/mp4'}})])assert.equal(await verifyMetricoolNativeBytes(NATIVE_URL,h,bytes.length,{fetcher}),false);
});
test('external owner UI exact GET and bytes are observed separately, even after scheduled time; never make pipeline deliveries',{skip:!hasTools},async t=>{
 const f=await nativeFixture(t),{packet}=f.packets[0];let reads=0;
 const external={destination:packet.destination,metricoolId:'123456',scheduledAt:packet.scheduledAt,caption:packet.caption,mediaUrl:NATIVE_URL,sha256:packet.outputSha256,sizeBytes:f.bytes.length};
 const observationTime=new Date('2026-11-18T18:00:00Z');
 const adapter={confirmSchedule:async(d,item)=>{reads++;assert.equal(item.caption,packet.caption);return{id:'123456',mediaUrl:NATIVE_URL};},schedule(){throw Error('no schedule');}};
 const options={workspaceRoot:f.root,assetId:packet.id,external,now:observationTime,adapter,fetcher:f.adapter.nativeFetch};
 assert.equal((await reconcileExternalMetricoolSchedule(options)).learnerStateChanged,false);const old=await readFile(path.join(f.root,REPORT,'native-media-imports',packet.id+'.json'),'utf8');
 assert.equal((await reconcileExternalMetricoolSchedule({...options,now:new Date(+observationTime+1000)})).providerWrites,0);assert.equal(await readFile(path.join(f.root,REPORT,'native-media-imports',packet.id+'.json'),'utf8'),old);
 const rows=JSON.parse(await readFile(path.join(f.root,REPORT,'external-schedules.json')));assert.equal(rows.length,1);assert.equal(verifiedExternalSchedules(rows,new Date(+observationTime+1000)).length,1);await assert.rejects(readFile(path.join(f.root,REPORT,'state.json')),/ENOENT/);
 const report=await buildClippersOrchestraReport({workspaceRoot:f.root,now:new Date(+observationTime+1000)});assert.equal(report.accounts[0].confirmedScheduledOrPublished,1);assert.equal(report.accounts[0].shortfall,null);assert.equal(report.accounts[1].confirmedScheduledOrPublished,null);assert.equal(report.roles.find(r=>r.stage==='publisher').outcomes.length,0);
 await assert.rejects(reconcileExternalMetricoolSchedule({...options,external:{...external,caption:'different'}}),/binding/);assert.equal(reads,2);
});

test('external observation is durable before failed native import publication, and repeat repairs import only',{skip:!hasTools},async t=>{
 const f=await nativeFixture(t),{packet}=f.packets[0],relative=`${REPORT}/native-media-imports/${packet.id}.json`;await rm(path.join(f.root,relative));await mkdir(path.join(f.root,relative),{mode:0o700});
 const options={workspaceRoot:f.root,assetId:packet.id,external:{destination:packet.destination,metricoolId:'999',scheduledAt:packet.scheduledAt,caption:packet.caption,mediaUrl:NATIVE_URL,sha256:packet.outputSha256,sizeBytes:f.bytes.length},now,fetcher:f.adapter.nativeFetch,adapter:{confirmSchedule:async()=>({id:'999',mediaUrl:NATIVE_URL})}};
 await assert.rejects(reconcileExternalMetricoolSchedule(options));const rows=JSON.parse(await readFile(path.join(f.root,REPORT,'external-schedules.json')));assert.equal(verifiedExternalSchedules(rows,now).length,1);assert.equal(Object.hasOwn(rows[0],'weeklySourceProof'),true);
 await rm(path.join(f.root,relative),{recursive:true});assert.equal((await reconcileExternalMetricoolSchedule(options)).providerWrites,0);assert.equal((await f.run()).prepared,1);
});
