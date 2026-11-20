import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CLOUD_LANES_NAMESPACE, CLOUD_WORKSPACE_NAMESPACE, LANE_LEASE_MS, acquireLane, emptyLanesState, laneCloudQa, laneView, parseLanesState, recordLaneRun, retireMacLanes, unretireMacLanes,
} from '../shared/clippers-cloud-lanes.mjs';
import { WORKSPACE_TOKEN, mergeTextFiles, planHydration, planPersist, seedAllowed, textOverlay } from '../script/clippers-drive-workspace.mjs';
import { laneTimeoutMs, macLaneGate, missingSecrets, retireMac, runCloudJob, seedWorkspace, skipByInterval, youtubeEnv } from '../script/clippers-cloud-lanes.mjs';

const NOW = Date.parse('2026-11-20T09:05:00Z');
const memStore = (init = {}) => {
  const rows = new Map(Object.entries(init));
  return { rows, async read(k) { return rows.get(k) ?? null; }, async transact(k, fn) { const raw = await fn(rows.get(k) ?? null); JSON.parse(raw); rows.set(k, raw); return raw; } };
};
const DRIVE_ENV = { GOOGLE_DRIVE_CLIENT_ID: 'id', GOOGLE_DRIVE_CLIENT_SECRET: 'x', GOOGLE_DRIVE_REFRESH_TOKEN: 'r', CLIPPERS_DRIVE_WORKSPACE_FOLDER_ID: 'root' };
const YT = Object.fromEntries(['CHANNEL_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN'].map(k => [`CLIPPERS_YOUTUBE_ES_${k}`, 'v']));

function fakeDrive(files) {
  const uploads = [];
  return { uploads, files,
    async walk() { return { files: Object.entries(files).map(([rel, f], i) => ({ rel, id: `f${i}`, size: Buffer.byteLength(f.content), modifiedTime: f.modifiedTime })), folders: new Map([['', 'root']]) }; },
    async download(id, dest) { const rel = Object.keys(files)[Number(id.slice(1))]; await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, files[rel].content); },
    async ensureFolder(folders, rel) { folders.set(rel, `d:${rel}`); return `d:${rel}`; },
    async upload(local, { name, parentId, existingId }) { uploads.push({ name, parentId, existingId }); return 'u'; } };
}

test('lease: retirement is the only handover; Mac refuses once retired; unretire hands the lease back to the Mac', () => {
  const s = emptyLanesState();
  assert.equal(acquireLane(s, 'content', 'mac', NOW).ok, true);
  assert.deepEqual(acquireLane(s, 'content', 'cloud', NOW + 3600_000).reason, 'mac_lane_not_retired');
  // Even with a stale Mac heartbeat (Mac off), no takeover without retirement.
  assert.deepEqual(acquireLane(s, 'content', 'cloud', NOW + LANE_LEASE_MS + 1).reason, 'mac_lane_not_retired');
  assert.deepEqual(acquireLane(emptyLanesState(), 'content', 'cloud', NOW).reason, 'mac_lane_not_retired');
  const t = emptyLanesState();
  acquireLane(t, 'marketplace', 'mac', NOW);
  retireMacLanes(t, ['marketplace'], NOW + 60_000);
  assert.equal(acquireLane(t, 'marketplace', 'cloud', NOW + 120_000).ok, true);
  assert.equal(acquireLane(t, 'marketplace', 'mac', NOW + 10 * LANE_LEASE_MS).reason, 'mac_lane_retired');
  unretireMacLanes(t, ['marketplace'], NOW + 200_000);
  assert.equal(t.leases.marketplace.holder, 'mac');
  assert.equal(acquireLane(t, 'marketplace', 'cloud', NOW + 300_000).reason, 'mac_lane_not_retired');
  assert.equal(acquireLane(t, 'marketplace', 'mac', NOW + 300_000).ok, true);
});

test('cloud QA: a delivery dry run (no upload) or a disabled upload is never retirement evidence', () => {
  const s = emptyLanesState();
  recordLaneRun(s, 'youtube_delivery', { at: new Date(NOW).toISOString(), status: 'completed', heldReasons: ['dry_run_no_upload'], errors: [], dryRun: true });
  assert.equal(laneCloudQa(s, 'youtube_delivery', NOW).ok, false);
  recordLaneRun(s, 'content', { at: new Date(NOW).toISOString(), status: 'completed', heldReasons: [], errors: [], dryRun: true });
  assert.equal(laneCloudQa(s, 'content', NOW).ok, true);
});

test('text state: ledgers are never evicted; over the cap the merge fails instead of dropping', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cap-'));
  await writeFile(path.join(root, 'notes.md'), 'n');
  const big = 'x'.repeat(4 * 1024 * 1024);
  const stored = { files: { 'reports/old-report.json': { content: big, updatedAt: '2026-01-01T00:00:00Z' }, 'reports/motivation-ledger.json': { content: big.slice(0, 3 * 1024 * 1024), updatedAt: '2026-01-01T00:00:00Z' } } };
  const doc = await mergeTextFiles(stored, root, ['notes.md'], NOW);
  assert.ok(doc.files['reports/motivation-ledger.json'] && doc.files['notes.md'] && !doc.files['reports/old-report.json']);
  const ledgers = { files: { 'reports/a-ledger.json': { content: big, updatedAt: '2026-01-01T00:00:00Z' }, 'reports/b-ledger.json': { content: big, updatedAt: '2026-01-01T00:00:00Z' } } };
  await assert.rejects(mergeTextFiles(ledgers, root, ['notes.md'], NOW), /workspace_text_over_cap/);
});

test('seed allowlist: only workspace content folders with text/media; never credentials, browser state or dot-dirs', () => {
  for (const ok of ['config/clippers-content-worker.json', 'visuals/bg.png', 'renders/a.mp4', 'reports/ledger.json', 'research/marketplace-snapshots/vyro.json']) assert.equal(seedAllowed(ok), true, ok);
  for (const ok of ['reports/metricool-autopilot-ledger.json', 'reports/metricool-public-media-receipts.json', 'content/session-1.md', 'visuals/default-bg.png', 'content/login-motivation.md']) assert.equal(seedAllowed(ok), true, ok);
  for (const bad of ['config/creds.json', 'config/service-account.json', 'config/application_default_credentials.json', 'config/adc.json', 'research/sessions/x.json',
    'renders/a.partial.mp4', 'renders/a.mp4.1.2.captions/c.png', 'renders/a.mp4.part', 'renders/out.tmp.mp4']) assert.equal(seedAllowed(bad), false, bad);
  for (const bad of ['notes.json', 'source-drop/a.mp4', 'config/storage-state.json', 'config/cookies.json', 'research/auth.json', 'config/session.json', 'reports/.metricool/x.json',
    '.ssh/id_rsa', 'config/.netrc', 'config/.npmrc', 'rights/cert.pfx', 'rights/keys.jks', 'visuals/chrome-profile/Cookies', 'config/a.keystore', 'renders/a.exe', 'config/youtube-token.json']) assert.equal(seedAllowed(bad), false, bad);
});

test('failure streak counts code failures only; parse drops unsafe codes', () => {
  const s = emptyLanesState();
  for (const status of ['failed', 'held', 'failed']) recordLaneRun(s, 'content', { at: new Date(NOW).toISOString(), status, heldReasons: ['ok_code', 'bad code!'], errors: [] });
  const p = parseLanesState(JSON.stringify(s));
  assert.equal(p.lanes.content.failureStreak, 2);
  assert.deepEqual(p.lanes.content.lastRun.heldReasons, ['ok_code']);
  assert.deepEqual(parseLanesState('not json'), emptyLanesState());
});

test('office view: missing secret is a held role with an owner note; Mac active is idle; watchdog retired is completed', () => {
  const s = emptyLanesState();
  recordLaneRun(s, 'youtube_delivery', { at: new Date(NOW).toISOString(), status: 'held', heldReasons: ['missing_secret:CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN'], errors: [] });
  const v = laneView(s, 'youtube_delivery', NOW + 60_000);
  assert.equal(v.state, 'held');
  assert.match(v.note, /CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN/);
  acquireLane(s, 'content', 'mac', NOW);
  assert.equal(laneView(s, 'content', NOW).state, 'idle');
  assert.equal(laneView(s, 'watchdog', NOW).state, 'idle');
  retireMacLanes(s, ['watchdog'], NOW);
  assert.equal(laneView(s, 'watchdog', NOW).state, 'completed');
  recordLaneRun(s, 'marketplace', { at: new Date(NOW - 40 * 3600_000).toISOString(), status: 'completed', heldReasons: [], errors: [] });
  assert.equal(laneView(s, 'marketplace', NOW).state, 'stale');
});

test('missing secrets per lane and the exact YouTube env allowlist', () => {
  assert.deepEqual(missingSecrets('content', {}), ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN', 'CLIPPERS_DRIVE_WORKSPACE_FOLDER_ID']);
  assert.deepEqual(missingSecrets('youtube_delivery', { ...DRIVE_ENV, ...YT }), []);
  assert.ok(missingSecrets('youtube_delivery', DRIVE_ENV).includes('CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN'));
  assert.deepEqual(missingSecrets('marketplace', { ...DRIVE_ENV, CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: 'true' }), ['METRICOOL_USER_TOKEN', 'METRICOOL_USER_ID', 'CLIPPERS_METRICOOL_BLOG_ID']);
  assert.deepEqual(Object.keys(youtubeEnv({ ...YT, OFFICE_DATABASE_URL: 'postgres://x', GOOGLE_DRIVE_REFRESH_TOKEN: 'r' })).sort(), Object.keys(YT).sort());
});

test('hydration plan keeps inputs and recent media, skips old media; stored text wins when newer', () => {
  const files = [
    { rel: 'config/a.json', size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
    { rel: 'visuals/bg.png', size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
    { rel: 'renders/old.mp4', size: 10, modifiedTime: '2026-11-01T00:00:00Z' },
    { rel: 'renders/new.mp4', size: 10, modifiedTime: '2026-11-19T00:00:00Z' },
  ];
  assert.deepEqual(planHydration(files, { now: NOW }).map(f => f.rel).sort(), ['config/a.json', 'renders/new.mp4', 'visuals/bg.png']);
  const stored = { files: { 'config/a.json': { content: 'S', updatedAt: '2026-02-01T00:00:00Z' }, 'reports/l.json': { content: 'L', updatedAt: '2026-02-01T00:00:00Z' }, '../x.json': { content: 'X', updatedAt: '2026-02-01T00:00:00Z' } } };
  assert.deepEqual(textOverlay(stored, files).map(f => f.rel).sort(), ['config/a.json', 'reports/l.json']);
  const before = new Map([['a.json', { size: 1, sha256: 'a' }]]);
  const after = new Map([['a.json', { size: 1, sha256: 'a' }], ['b.json', { size: 2, sha256: 'b' }], ['r/x.mp4', { size: 9, sha256: 'c' }]]);
  assert.deepEqual(planPersist(before, after), { text: ['b.json'], media: ['r/x.mp4'] });
});

test('cloud job without Drive secrets: held missing_secret for each lane, no runner, exit-clean record', async () => {
  const store = memStore();
  let ran = false;
  const r = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: {}, now: NOW, runners: { content: () => { ran = true; } }, workspaceRoot: '/nonexistent' });
  assert.equal(ran, false);
  assert.equal(r.lanes.content.status, 'held');
  assert.ok(r.lanes.youtube_delivery.heldReasons.includes('missing_secret:GOOGLE_DRIVE_REFRESH_TOKEN'));
  assert.equal(parseLanesState(store.rows.get(CLOUD_LANES_NAMESPACE('o'))).lanes.content.lastRun.status, 'held');
});

test('cloud job runs only retired lanes (youtube not retired -> mac_lane_not_retired) and persists after each lane', async () => {
  const s = emptyLanesState(); acquireLane(s, 'youtube_delivery', 'mac', NOW - 3600_000); retireMacLanes(s, ['content'], NOW - 60_000);
  const store = memStore({ [CLOUD_LANES_NAMESPACE('o')]: JSON.stringify(s) });
  const ws = await mkdtemp(path.join(os.tmpdir(), 'cl-'));
  const drive = fakeDrive({ 'config/clippers-content-worker.json': { content: `{"root":"${WORKSPACE_TOKEN}/x"}`, modifiedTime: '2026-11-19T00:00:00Z' } });
  const calls = [];
  const runners = { content: async ({ workspaceRoot }) => { calls.push('content'); await mkdir(path.join(workspaceRoot, 'renders'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'renders', 'a.mp4'), 'video'); await mkdir(path.join(workspaceRoot, 'reports'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'reports', 'ledger.json'), JSON.stringify({ out: `${workspaceRoot}/renders/a.mp4` }));
    return { status: 'completed', heldReasons: [], errors: [], counts: { motivation_rendered: 1 } }; },
    youtube_delivery: async () => { calls.push('yt'); return { status: 'completed', heldReasons: [], errors: [], counts: {} }; } };
  const r = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: { ...DRIVE_ENV, ...YT }, now: NOW, drive, runners, workspaceRoot: ws });
  assert.deepEqual(calls, ['content']);
  assert.deepEqual(r.lanes.youtube_delivery.heldReasons, ['mac_lane_not_retired']);
  assert.equal(r.lanes.content.status, 'completed');
  // Token substituted on hydration; ledger persisted to Postgres with the token; media to Drive.
  assert.match(await readFile(path.join(ws, 'config/clippers-content-worker.json'), 'utf8'), new RegExp(ws.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const doc = JSON.parse(store.rows.get(CLOUD_WORKSPACE_NAMESPACE('o')));
  assert.equal(JSON.parse(doc.files['reports/ledger.json'].content).out, `${WORKSPACE_TOKEN}/renders/a.mp4`);
  assert.deepEqual(drive.uploads.map(u => [u.name, u.parentId]), [['a.mp4', 'd:renders']]);
  const lanes = parseLanesState(store.rows.get(CLOUD_LANES_NAMESPACE('o')));
  assert.equal(lanes.leases.content.holder, 'cloud');
  assert.equal(lanes.leases.youtube_delivery.holder, 'mac');
});

test('dry run takes no lease, uploads nothing, persists nothing and skips YouTube', async () => {
  const s = emptyLanesState(); acquireLane(s, 'content', 'mac', NOW - 3600_000);
  const store = memStore({ [CLOUD_LANES_NAMESPACE('o')]: JSON.stringify(s) });
  const drive = fakeDrive({ 'config/clippers-content-worker.json': { content: '{}', modifiedTime: '2026-11-19T00:00:00Z' } });
  const ws = await mkdtemp(path.join(os.tmpdir(), 'cl-'));
  const r = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: { ...DRIVE_ENV, ...YT }, now: NOW, drive, workspaceRoot: ws, dryRun: true,
    runners: { content: async ({ workspaceRoot }) => { await writeFile(path.join(workspaceRoot, 'x.mp4'), 'v'); return { status: 'completed', heldReasons: [], errors: [], counts: {} }; } } });
  assert.equal(r.lanes.content.status, 'completed');
  assert.deepEqual(r.lanes.youtube_delivery.heldReasons, ['dry_run_no_upload']);
  assert.equal(drive.uploads.length, 0);
  assert.equal(store.rows.has(CLOUD_WORKSPACE_NAMESPACE('o')), false);
  const lanes = parseLanesState(store.rows.get(CLOUD_LANES_NAMESPACE('o')));
  assert.equal(lanes.leases.content.holder, 'mac');
  assert.equal(lanes.lanes.content.lastDryRun.status, 'completed');
  assert.equal(lanes.lanes.content.lastRun, null);
});

test('runner exception is a failed run with a fixed code; config missing is held', async () => {
  const retiredBoth = owner => ({ [CLOUD_LANES_NAMESPACE(owner)]: JSON.stringify(retireMacLanes(emptyLanesState(), ['content', 'youtube_delivery'], NOW - 60_000)) });
  const store = memStore({ ...retiredBoth('o'), ...retiredBoth('p') });
  const r = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: { ...DRIVE_ENV, ...YT }, now: NOW, drive: fakeDrive({}), workspaceRoot: await mkdtemp(path.join(os.tmpdir(), 'cl-')),
    runners: { content: async () => { throw new Error('secret value https://x?token=1'); } } });
  assert.deepEqual(r.lanes.content.heldReasons, ['workspace_config_missing:content']);
  const r2 = await runCloudJob({ job: 'owned_content', store, owner: 'p', env: { ...DRIVE_ENV, ...YT }, now: NOW, drive: fakeDrive({ 'config/clippers-content-worker.json': { content: '{}', modifiedTime: '2026-11-19T00:00:00Z' } }),
    workspaceRoot: await mkdtemp(path.join(os.tmpdir(), 'cl-')), runners: { content: async () => { throw new Error('secret value https://x?token=1'); } } });
  assert.deepEqual(r2.lanes.content.errors, ['internal_error']);
  assert.deepEqual(r2.lanes.youtube_delivery.heldReasons, ['content_lane_not_completed']);
});

test('Mac gate: fail-open without a database, refused once retired', async () => {
  const logs = [];
  assert.equal(await macLaneGate('content', { env: {}, log: m => logs.push(m) }), true);
  const s = emptyLanesState(); retireMacLanes(s, ['content'], NOW);
  const store = memStore({ [CLOUD_LANES_NAMESPACE('test-owner')]: JSON.stringify(s) });
  assert.equal(await macLaneGate('content', { env: {}, store, now: NOW, log: m => logs.push(m) }), false);
  assert.ok(logs.some(l => /mac_lane_retired/.test(l)));
});

test('retirement needs cloud QA unless forced; seeding tokenizes the Mac root and never uploads credential files', async () => {
  const store = memStore();
  assert.deepEqual((await retireMac({ lanes: ['content'], store, owner: 'o', now: NOW })).failures, ['content:cloud_qa_missing']);
  await store.transact(CLOUD_LANES_NAMESPACE('o'), async raw => { const s = parseLanesState(raw); recordLaneRun(s, 'content', { at: new Date(NOW).toISOString(), status: 'completed', heldReasons: [], errors: [], dryRun: true }); return JSON.stringify(s); });
  assert.equal((await retireMac({ lanes: ['content'], store, owner: 'o', now: NOW })).ok, true);
  assert.equal((await retireMac({ lanes: ['watchdog'], store, owner: 'o', now: NOW })).ok, false);
  assert.equal((await retireMac({ lanes: ['watchdog'], store, owner: 'o', now: NOW, force: true })).ok, true);

  const mac = await mkdtemp(path.join(os.tmpdir(), 'mac-'));
  await mkdir(path.join(mac, 'reports'), { recursive: true }); await mkdir(path.join(mac, 'credentials'), { recursive: true });
  await writeFile(path.join(mac, 'reports', 'ledger.json'), JSON.stringify({ p: `${mac}/renders/a.mp4` }));
  await writeFile(path.join(mac, 'credentials', 'drive.json'), '{"refresh_token":"x"}');
  await writeFile(path.join(mac, '.env'), 'A=1'); await mkdir(path.join(mac, 'renders')); await writeFile(path.join(mac, 'renders', 'clip.mp4'), 'v'); await writeFile(path.join(mac, 'loose.mp4'), 'v');
  const drive = fakeDrive({});
  await seedWorkspace({ macRoot: mac, store, owner: 'o', drive, folderId: 'root', now: NOW, log: () => {} });
  const doc = JSON.parse(store.rows.get(CLOUD_WORKSPACE_NAMESPACE('o')));
  assert.deepEqual(Object.keys(doc.files), ['reports/ledger.json']);
  assert.equal(JSON.parse(doc.files['reports/ledger.json'].content).p, `${WORKSPACE_TOKEN}/renders/a.mp4`);
  assert.deepEqual(drive.uploads.map(u => u.name), ['clip.mp4']);
});

test('both lanes retired: content ledger is in Postgres before delivery starts; delivery off by default; a hung lane is recorded as lane_timeout', async () => {
  const store = memStore({ [CLOUD_LANES_NAMESPACE('o')]: JSON.stringify(retireMacLanes(emptyLanesState(), ['content', 'youtube_delivery'], NOW - 60_000)) });
  const files = { 'config/clippers-content-worker.json': { content: '{}', modifiedTime: '2026-11-19T00:00:00Z' }, 'config/clippers-youtube-upload-packager.json': { content: '{}', modifiedTime: '2026-11-19T00:00:00Z' } };
  let seenAtDelivery = null;
  const runners = {
    content: async ({ workspaceRoot }) => { await mkdir(path.join(workspaceRoot, 'reports'), { recursive: true }); await writeFile(path.join(workspaceRoot, 'reports', 'motivation-ledger.json'), '{"n":1}'); return { status: 'completed', heldReasons: [], errors: [], counts: {} }; },
    youtube_delivery: async () => { seenAtDelivery = JSON.parse(store.rows.get(CLOUD_WORKSPACE_NAMESPACE('o'))).files['reports/motivation-ledger.json']?.content; return { status: 'completed', heldReasons: [], errors: [], counts: {} }; },
  };
  const off = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: { ...DRIVE_ENV, ...YT }, now: NOW, drive: fakeDrive(files), runners, workspaceRoot: await mkdtemp(path.join(os.tmpdir(), 'cl-')) });
  assert.deepEqual(off.lanes.youtube_delivery.heldReasons, ['youtube_cloud_upload_disabled']);
  assert.equal(laneView(parseLanesState(store.rows.get(CLOUD_LANES_NAMESPACE('o'))), 'youtube_delivery', NOW).state, 'completed');
  await runCloudJob({ job: 'owned_content', store, owner: 'o', env: { ...DRIVE_ENV, ...YT, CLIPPERS_YOUTUBE_CLOUD_UPLOAD_ENABLED: 'true' }, now: NOW, drive: fakeDrive(files), runners, workspaceRoot: await mkdtemp(path.join(os.tmpdir(), 'cl-')) });
  assert.equal(seenAtDelivery, '{"n":1}');
  const hung = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: { ...DRIVE_ENV, ...YT, CLIPPERS_CLOUD_LANE_TIMEOUT_MINUTES: '0.001' }, now: NOW, drive: fakeDrive(files),
    runners: { content: () => new Promise(() => {}) }, workspaceRoot: await mkdtemp(path.join(os.tmpdir(), 'cl-')) });
  assert.deepEqual(hung.lanes.content.errors, ['lane_timeout']);
  assert.equal(parseLanesState(store.rows.get(CLOUD_LANES_NAMESPACE('o'))).lanes.content.lastRun.errors[0], 'lane_timeout');
  assert.ok(laneTimeoutMs('sleep_content', 'sleep', {}) > laneTimeoutMs('content', 'owned_content', {}));
  assert.ok(laneTimeoutMs('sleep_content', 'sleep', {}) < 340 * 60_000);
});

test('scheduled interval skip: not after a failure, Mac hold or missing secret', () => {
  const run = (status, heldReasons = []) => ({ at: new Date(NOW - 3600_000).toISOString(), status, heldReasons });
  assert.equal(skipByInterval(run('completed'), NOW, 20), true);
  assert.equal(skipByInterval(run('failed'), NOW, 20), false);
  assert.equal(skipByInterval(run('held', ['mac_lane_active']), NOW, 20), false);
  assert.equal(skipByInterval(null, NOW, 20), false);
});

test('sleep job: own lane ids and records, handed over by the content/delivery retirement; never touches owned_content records', async () => {
  const s = retireMacLanes(emptyLanesState(), ['content', 'youtube_delivery'], NOW - 60_000);
  recordLaneRun(s, 'content', { at: new Date(NOW - 3600_000).toISOString(), status: 'completed', heldReasons: [], errors: [] });
  const store = memStore({ [CLOUD_LANES_NAMESPACE('o')]: JSON.stringify(s) });
  const files = { 'config/clippers-content-worker.json': { content: '{}', modifiedTime: '2026-11-19T00:00:00Z' }, 'config/clippers-youtube-upload-packager.json': { content: '{}', modifiedTime: '2026-11-19T00:00:00Z' } };
  const modes = [];
  const r = await runCloudJob({ job: 'sleep', store, owner: 'o', env: { ...DRIVE_ENV, ...YT, CLIPPERS_YOUTUBE_CLOUD_UPLOAD_ENABLED: 'true' }, now: NOW, drive: fakeDrive(files), workspaceRoot: await mkdtemp(path.join(os.tmpdir(), 'cl-')),
    runners: { content: async ({ mode }) => { modes.push(mode); return { status: 'completed', heldReasons: [], errors: [], counts: {} }; }, youtube_delivery: async () => ({ status: 'completed', heldReasons: [], errors: [], counts: {} }) } });
  assert.deepEqual(Object.keys(r.lanes).sort(), ['sleep_content', 'sleep_delivery']);
  assert.deepEqual(modes, ['sleep']);
  const after = parseLanesState(store.rows.get(CLOUD_LANES_NAMESPACE('o')));
  assert.equal(after.lanes.content.lastRun.at, new Date(NOW - 3600_000).toISOString()); // owned_content record untouched
  assert.equal(after.lanes.sleep_content.lastRun.status, 'completed');
  // Not retired -> held; Mac can never take a cloud-only lane; it cannot be retired on its own.
  assert.equal(acquireLane(emptyLanesState(), 'sleep_content', 'cloud', NOW).reason, 'mac_lane_not_retired');
  assert.equal(acquireLane(emptyLanesState(), 'sleep_content', 'mac', NOW).reason, 'unknown_lane');
  assert.throws(() => retireMacLanes(emptyLanesState(), ['sleep_content'], NOW), /unknown_lane/);
});

test('after a lane timeout its media are not uploaded (text state still saved)', async () => {
  const store = memStore({ [CLOUD_LANES_NAMESPACE('o')]: JSON.stringify(retireMacLanes(emptyLanesState(), ['content', 'youtube_delivery'], NOW - 60_000)) });
  const drive = fakeDrive({ 'config/clippers-content-worker.json': { content: '{}', modifiedTime: '2026-11-19T00:00:00Z' } });
  const r = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: { ...DRIVE_ENV, ...YT, CLIPPERS_CLOUD_LANE_TIMEOUT_MINUTES: '0.002' }, now: NOW, drive, workspaceRoot: await mkdtemp(path.join(os.tmpdir(), 'cl-')),
    runners: { content: ({ workspaceRoot }) => new Promise(() => { mkdir(path.join(workspaceRoot, 'renders'), { recursive: true }).then(() => Promise.all([writeFile(path.join(workspaceRoot, 'renders', 'half.mp4'), 'v'), writeFile(path.join(workspaceRoot, 'renders', 'r.json'), '{}')])); }) } });
  assert.deepEqual(r.lanes.content.errors, ['lane_timeout']);
  assert.equal(drive.uploads.length, 0);
  assert.ok(JSON.parse(store.rows.get(CLOUD_WORKSPACE_NAMESPACE('o'))).files['renders/r.json']);
});
