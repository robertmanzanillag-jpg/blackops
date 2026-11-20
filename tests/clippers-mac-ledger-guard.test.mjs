import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMacLedgerGuard, sourceIdentity, macSegment, captionLanguage, macRoutingRefusal, MAC_LEDGER_FILE } from '../script/clippers-mac-ledger-guard.mjs';
import { mediaEntriesOf, cloudPublishOf } from '../script/clippers-streamer-cloud-worker.mjs';
import { runMetricoolAutopilot } from '../script/clippers-metricool-autopilot.mjs';

const MEMES = { brandId: 6431685, network: 'tiktok', account: 'streamersus' };
const SPORTS = { brandId: 6431687, network: 'tiktok', account: 'streamersclipusa' };
const MIAMI = { brandId: 6591612, network: 'tiktok', account: 'news305miami' };
const item = (over = {}) => ({ id: 'a1', caption: 'Wait for it… he did not see this coming 👀\nWhat would you have done?', mediaSha256: 'a'.repeat(64),
  sourceUrl: 'https://www.youtube.com/watch?v=abcDEF12345', scheduledAt: '2026-11-21T15:00:00.000Z', mediaUrl: 'https://e.com/a.mp4', ...over });
const calendar = (impl = async () => ({ checkedDays: ['2026-11-21'] })) => { const calls = []; return { calls, crossAccountPreflight: async (d, i) => { calls.push([d, i]); return impl(d, i); } }; };

/** In-memory stand-in for the council store (same read/transact contract as Postgres). */
function memoryStore(initial = null, { fail = false } = {}) {
  let raw = initial == null ? null : JSON.stringify(initial);
  return { get raw() { return raw ? JSON.parse(raw) : null; }, async read() { return raw; },
    async transact(_ns, update) { if (fail) throw new Error('ECONNREFUSED'); const next = await update(raw); raw = next; return next; } };
}
async function root(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'mac-ledger-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('source identity uses the cloud worker key space', () => {
  assert.equal(sourceIdentity('https://youtu.be/abcDEF12345?si=x'), 'youtube:abcDEF12345');
  assert.equal(sourceIdentity('https://www.youtube.com/shorts/abcDEF12345'), 'youtube:abcDEF12345');
  assert.equal(sourceIdentity('https://clips.twitch.tv/FunnySlug-abc'), 'twitch-clip:FunnySlug-abc');
  assert.equal(sourceIdentity('https://www.twitch.tv/kaicenat/clip/FunnySlug-abc'), 'twitch-clip:FunnySlug-abc');
  assert.equal(sourceIdentity('https://www.twitch.tv/videos/123456'), 'twitch-vod:123456');
  assert.equal(sourceIdentity('javascript:alert(1)'), null);
  assert.deepEqual(macSegment(item()), { key: 'youtube:abcDEF12345', start: null });
  assert.deepEqual(macSegment(item({ sourceUrl: 'https://www.twitch.tv/videos/9', sourceStartSec: 30, vodOffsetSec: 100 })), { key: 'twitch-vod:9', start: 130 });
});

test('caption language is only reported when confident', () => {
  assert.equal(captionLanguage('¿Qué acaba de pasar? No se lo esperaba, nadie en la sala'), 'es');
  assert.equal(captionLanguage('Wait for it… he did not see this coming, what would you have done?'), 'en');
  assert.equal(captionLanguage('#fyp #streamer KAI 👀'), null);
});

test('routing rules: account language, creator lane and stream owner', () => {
  assert.equal(macRoutingRefusal({ destination: MIAMI, item: item({ language: 'en' }), entries: [] }), 'language_mismatch:en_on_es');
  assert.equal(macRoutingRefusal({ destination: MEMES, item: item({ caption: '¿Qué acaba de pasar? No se lo esperaba en la sala' }), entries: [] }), 'language_mismatch:es_on_en');
  assert.equal(macRoutingRefusal({ destination: MEMES, item: item({ creatorGroupId: 'plaqueboymax' }), entries: [] }), 'creator_routed_to_other_account:sports');
  // Language decides first (main): an English Westcol clip may go to an English lane.
  assert.equal(macRoutingRefusal({ destination: MEMES, item: item({ creatorGroupId: 'westcol' }), entries: [] }), null);
  assert.equal(macRoutingRefusal({ destination: MEMES, item: item({ creatorGroupId: 'kai-cenat' }), entries: [] }), null);
  const owned = [{ candidateId: 'youtube:abcDEF12345', streamKey: 'youtube:abcDEF12345', segment: { key: 'youtube:abcDEF12345', start: 900 }, destinationKey: '6431687:tiktok:streamersclipusa', lane: 'sports' }];
  assert.equal(macRoutingRefusal({ destination: MEMES, item: item({ sourceStartSec: 2000 }), entries: owned }), 'stream_owned_by_other_account');
  assert.equal(macRoutingRefusal({ destination: SPORTS, item: item({ sourceStartSec: 2000 }), entries: owned }), null);
});

test('refuses a clip the cloud already gave to another account (Postgres ledger) and claims free ones there', async t => {
  const workspaceRoot = await root(t);
  const cloudState = { version: 1, candidates: [], creators: {}, takedowns: [], cloudPublish: { version: 1, clips: {}, learning: null, lastRun: null,
    posts: [{ id: 'p1', candidateId: 'youtube:abcDEF12345', destinationKey: '6431687:tiktok:streamersclipusa', status: 'scheduled', lane: 'sports', streamKey: 'youtube:abcDEF12345', segment: { key: 'youtube:abcDEF12345', start: 10 }, mediaSha256: 'c'.repeat(64) }] } };
  const store = memoryStore(cloudState);
  const metricool = calendar();
  const guard = createMacLedgerGuard({ env: { OFFICE_OWNER_ID: 'owner' }, workspaceRoot, metricool, store });
  assert.equal(guard.mode, 'postgres');
  const dup = await guard.reserve(MEMES, item());
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'stream_owned_by_other_account');
  const sameHash = await guard.reserve(MEMES, item({ id: 'h', sourceUrl: 'https://youtu.be/zzzzzzzzzzz', mediaSha256: 'c'.repeat(64) }));
  assert.equal(sameHash.reason, 'cross_account_duplicate');
  const free = await guard.reserve(MEMES, item({ id: 'b2', sourceUrl: 'https://youtu.be/otherVideo1', mediaSha256: 'b'.repeat(64) }));
  assert.equal(free.ok, true, free.reason);
  assert.equal(free.evidence.ledger, 'postgres');
  assert.equal(free.evidence.mirrored, true);
  // The cloud worker now sees the Mac claim and would refuse the same source for another account.
  const cloudEntries = mediaEntriesOf(cloudPublishOf(store.raw));
  assert.ok(cloudEntries.some(e => e.candidateId === 'mac:b2' && e.destinationKey === '6431685:tiktok:streamersus' && e.lane === 'memes'));
  const local = JSON.parse(await readFile(path.join(workspaceRoot, MAC_LEDGER_FILE), 'utf8'));
  assert.equal(local.entries.length, 1);
  const again = await guard.reserve(SPORTS, item({ id: 'b3', sourceUrl: 'https://youtu.be/otherVideo1', mediaSha256: 'd'.repeat(64) }));
  assert.equal(again.ok, false);
});

test('without a database: calendar check is mandatory, local ledger blocks cross-account, later mirror to Postgres', async t => {
  const workspaceRoot = await root(t);
  const metricool = calendar();
  const guard = createMacLedgerGuard({ env: {}, workspaceRoot, metricool });
  assert.equal(guard.mode, 'local_plus_calendar');
  const first = await guard.reserve(MEMES, item());
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.evidence.mirrored, false);
  assert.equal(metricool.calls.length, 1);
  const cross = await guard.reserve(SPORTS, item({ id: 'a2', mediaSha256: 'e'.repeat(64) }));
  assert.equal(cross.ok, false);
  assert.equal(metricool.calls.length, 1, 'local refusal happens before any provider call');
  // Same account again is left to the script's own dedupe/cap (not a cross-account refusal).
  assert.equal((await guard.reserve(MEMES, item({ id: 'a1' }))).ok, true);
  // Next run with Postgres pushes the unmirrored local entries.
  const store = memoryStore(null);
  const withDb = createMacLedgerGuard({ env: { OFFICE_OWNER_ID: 'owner' }, workspaceRoot, metricool, store });
  assert.equal((await withDb.reserve(MEMES, item({ id: 'z', sourceUrl: 'https://youtu.be/third000000', mediaSha256: 'f'.repeat(64) }))).ok, true);
  const ids = cloudPublishOf(store.raw).mediaLedger.map(e => e.candidateId);
  assert.deepEqual(ids.sort(), ['mac:a1', 'mac:z']);
});

test('fails closed: calendar duplicate, calendar unavailable, database down, required database missing, corrupt ledger', async t => {
  const workspaceRoot = await root(t);
  const dup = createMacLedgerGuard({ env: {}, workspaceRoot, metricool: calendar(async () => { throw new Error('cross_account_duplicate'); }) });
  assert.deepEqual([(await dup.reserve(MEMES, item())).ok, (await dup.reserve(MEMES, item())).reason], [false, 'cross_account_duplicate']);
  const down = createMacLedgerGuard({ env: {}, workspaceRoot, metricool: calendar(async () => { throw new Error('HTTP 503'); }) });
  assert.match((await down.reserve(MEMES, item())).reason, /^calendar_check_failed:/);
  const none = createMacLedgerGuard({ env: {}, workspaceRoot, metricool: null });
  assert.equal((await none.reserve(MEMES, item())).reason, 'calendar_check_unavailable');
  const db = createMacLedgerGuard({ env: { OFFICE_OWNER_ID: 'o' }, workspaceRoot, metricool: calendar(), store: memoryStore(null, { fail: true }) });
  assert.match((await db.reserve(MEMES, item())).reason, /^ledger_check_unavailable:/);
  const required = createMacLedgerGuard({ env: { CLIPPERS_LEDGER_REQUIRE_DATABASE: 'true' }, workspaceRoot, metricool: calendar() });
  assert.equal((await required.reserve(MEMES, item())).reason, 'ledger_database_required_unavailable');
  const invalidState = createMacLedgerGuard({ env: { OFFICE_OWNER_ID: 'o' }, workspaceRoot, metricool: calendar(), store: memoryStore({ version: 2 }) });
  assert.match((await invalidState.reserve(MEMES, item())).reason, /STREAMER_STATE_INVALID/);
  assert.equal((await none.reserve(MEMES, { caption: 'x' })).reason, 'ledger_identity_missing');
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(path.join(workspaceRoot, 'reports'), { recursive: true });
  await writeFile(path.join(workspaceRoot, MAC_LEDGER_FILE), '{not json');
  const corrupt = createMacLedgerGuard({ env: {}, workspaceRoot, metricool: calendar() });
  assert.match((await corrupt.reserve(MEMES, item())).reason, /^ledger_check_unavailable:/);
});

test('autopilot never calls createScheduledPost when the ledger guard refuses', async t => {
  const workspaceRoot = await root(t);
  const posts = [];
  const queueItem = { campaignId: 'c1', draftFile: 'd1.mp4', account: 'streamersclipusa', publishAllowed: true, status: 'ready_for_metricool_autopilot',
    mediaUrl: 'https://media.example.com/d1.mp4', caption: 'Wait for it #sports', requiredHashtags: [], sourceUrl: 'https://youtu.be/abcDEF12345' };
  const result = await runMetricoolAutopilot({
    env: { CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: 'true', METRICOOL_USER_TOKEN: 'token-123456789', METRICOOL_USER_ID: '3558197', CLIPPERS_METRICOOL_BLOG_ID: '6431687', CLIPPERS_TIKTOK_ACCOUNT: 'streamersclipusa' },
    workspaceRoot, now: new Date('2026-11-20T12:00:00Z'),
    queue: { targetDailyClips: 1, items: [queueItem] }, ledger: [],
    mediaReceipts: [{ campaignId: 'c1', draftFile: 'd1.mp4', fileId: 'f1', mediaUrl: queueItem.mediaUrl, sha256: 'a'.repeat(64) }],
    ledgerGuard: { reserve: async () => ({ ok: false, reason: 'cross_account_duplicate' }) },
    fetch: async (url, init) => {
      if (String(url).includes('/mcp')) { posts.push(init); throw new Error('must not write'); }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(posts.length, 0);
  assert.ok(result.results.some(r => r.status === 'blocked' && r.blockers.includes('cross_account_ledger:cross_account_duplicate')));
});

test('Twitch: cloud claim blocks the Mac and a Mac claim blocks the cloud (clip id, VOD and moment keys)', async t => {
  const { mediaConflict, mediaEntry, sourceSegment } = await import('../shared/clippers-account-lanes.mjs');
  // Cloud clip without VOD: segment twitch-moment:..., candidateId twitch-clip:<slug>.
  const cloudCandidate = { id: 'twitch-clip:FunnySlug-abc', platform: 'twitch', creatorKey: 'twitch:123', publishedAt: '2026-11-20T15:00:00Z' };
  const cloudEntry = mediaEntry({ candidate: cloudCandidate, segment: sourceSegment(cloudCandidate, { start: 0 }), mediaSha256: 'c'.repeat(64), destinationKey: '6431687:tiktok:streamersclipusa', at: 'x' });
  assert.match(cloudEntry.segment.key, /^twitch-moment:/);
  const store = memoryStore({ version: 1, candidates: [], creators: {}, takedowns: [], cloudPublish: { version: 1, clips: {}, posts: [], mediaLedger: [cloudEntry] } });
  const guard = createMacLedgerGuard({ env: { OFFICE_OWNER_ID: 'o' }, workspaceRoot: await root(t), metricool: calendar(), store });
  // Same clip URL (no timing info on the Mac side): matched through sourceId <-> candidateId.
  const r1 = await guard.reserve(MEMES, item({ id: 'm1', sourceUrl: 'https://www.twitch.tv/kai/clip/FunnySlug-abc', mediaSha256: '1'.repeat(64) }));
  assert.match(r1.reason, /^(cross_account_duplicate|stream_owned_by_other_account)$/);
  // A different clip slug of the same moment (creatorKey + time within 60 s): matched through the moment key.
  const r2 = await guard.reserve(MEMES, item({ id: 'm2', sourceUrl: 'https://clips.twitch.tv/OtherSlug', creatorKey: 'twitch:123', sourcePublishedAt: '2026-11-20T15:00:30Z', mediaSha256: '2'.repeat(64) }));
  assert.match(r2.reason, /^(cross_account_duplicate|stream_owned_by_other_account)$/);
  // Mac claims a VOD segment; the cloud's own check (same mediaConflict call as the worker) refuses it.
  const ok = await guard.reserve(MEMES, item({ id: 'm3', sourceUrl: 'https://www.twitch.tv/videos/777', sourceStartSec: 100, mediaSha256: '3'.repeat(64) }));
  assert.equal(ok.ok, true, ok.reason);
  const cloudVod = { id: 'twitch-clip:VodClip', platform: 'twitch', vodId: '777', vodOffset: 90 };
  const entries = mediaEntriesOf(cloudPublishOf(store.raw));
  const hit = mediaConflict(entries, { segment: sourceSegment(cloudVod, { start: 0 }), candidateId: cloudVod.id, destinationKey: '6431687:tiktok:streamersclipusa' });
  assert.equal(hit?.reason, 'cross_account_duplicate');
  // And a Mac claim of a clip URL blocks the cloud candidate with that id.
  assert.equal((await guard.reserve(MEMES, item({ id: 'm4', sourceUrl: 'https://clips.twitch.tv/Fresh-1', mediaSha256: '4'.repeat(64) }))).ok, true);
  const hit2 = mediaConflict(mediaEntriesOf(cloudPublishOf(store.raw)), { segment: { key: 'twitch-moment:twitch:999', start: 1 }, candidateId: 'twitch-clip:Fresh-1', destinationKey: '6431687:tiktok:streamersclipusa' });
  assert.equal(hit2?.reason, 'cross_account_duplicate');
});

test('local ledger lock: concurrent reserves never double-claim; a held lock refuses; a stale lock is broken', async t => {
  const workspaceRoot = await root(t);
  let release;
  const slow = calendar(() => new Promise(r => { release = r; }));
  const g1 = createMacLedgerGuard({ env: {}, workspaceRoot, metricool: slow });
  const g2 = createMacLedgerGuard({ env: {}, workspaceRoot, metricool: calendar() });
  const first = g1.reserve(MEMES, item());
  await new Promise(r => setTimeout(r, 50));
  const second = g2.reserve(SPORTS, item({ id: 'x2', mediaSha256: '9'.repeat(64) }));
  await new Promise(r => setTimeout(r, 300));
  release({ checkedDays: [] });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, false, 'second waited for the lock, then saw the first claim');
  const { writeFile, utimes } = await import('node:fs/promises');
  const lock = path.join(workspaceRoot, MAC_LEDGER_FILE) + '.lock';
  await writeFile(lock, 'other');
  const busy = await createMacLedgerGuard({ env: {}, workspaceRoot, metricool: calendar() }).reserve(MEMES, item({ id: 'y', sourceUrl: 'https://youtu.be/yyyyyyyyyyy', mediaSha256: '8'.repeat(64) }));
  assert.equal(busy.reason, 'ledger_check_unavailable:ledger_lock_busy');
  const old = new Date(Date.now() - 10 * 60_000);
  await utimes(lock, old, old);
  const after = await createMacLedgerGuard({ env: {}, workspaceRoot, metricool: calendar() }).reserve(MEMES, item({ id: 'y', sourceUrl: 'https://youtu.be/yyyyyyyyyyy', mediaSha256: '8'.repeat(64) }));
  assert.equal(after.ok, true, after.reason);
});

test('reasons are fixed codes (no hostnames) and refused runs still mirror pending local entries', async t => {
  const { safeCode } = await import('../script/clippers-mac-ledger-guard.mjs');
  assert.equal(safeCode(Object.assign(new Error('connect ECONNREFUSED db.internal.example:5432'), { code: 'ECONNREFUSED' })), 'database_unreachable');
  assert.equal(safeCode(Object.assign(new Error('password authentication failed for user "x"'), { code: '28P01' })), 'database_auth_failed');
  assert.equal(safeCode(new Error('getaddrinfo ENOTFOUND secret-host')), 'internal_error');
  const workspaceRoot = await root(t);
  const leak = createMacLedgerGuard({ env: {}, workspaceRoot, metricool: calendar(async () => { throw new Error('GET https://app.metricool.com/api?token=abc failed'); }) });
  assert.equal((await leak.reserve(MEMES, item())).reason, 'calendar_check_failed:provider_error');
  assert.equal((await createMacLedgerGuard({ env: {}, workspaceRoot, metricool: calendar() }).reserve(MEMES, item({ id: 'p1' }))).ok, true);
  const store = memoryStore(null);
  const refused = await createMacLedgerGuard({ env: { OFFICE_OWNER_ID: 'o' }, workspaceRoot, metricool: calendar(), store }).reserve(SPORTS, item({ id: 'p2', mediaSha256: '7'.repeat(64) }));
  assert.equal(refused.ok, false);
  assert.deepEqual(cloudPublishOf(store.raw).mediaLedger.map(e => e.candidateId), ['mac:p1']);
});

test('lock: holder refreshes mtime while held; stale break never removes a fresh lock that raced in', async t => {
  const mod = await import('../script/clippers-mac-ledger-guard.mjs');
  const { writeFile, utimes, stat: st, readFile: rf } = await import('node:fs/promises');
  const workspaceRoot = await root(t);
  const lock = path.join(workspaceRoot, MAC_LEDGER_FILE) + '.lock';
  t.mock.timers.enable({ apis: ['setInterval'] });
  let release, mtimes = [];
  const guard = createMacLedgerGuard({ env: {}, workspaceRoot, metricool: calendar(() => new Promise(r => { release = r; })) });
  const pending = guard.reserve(MEMES, item());
  await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, 30));
  const old = new Date(Date.now() - 10 * 60_000);
  await utimes(lock, old, old);
  t.mock.timers.tick(mod.LEDGER_LOCK_HEARTBEAT_MS);
  await new Promise(r => setTimeout(r, 30));
  mtimes.push((await st(lock)).mtimeMs);
  assert.ok(Date.now() - mtimes[0] < 60_000, 'heartbeat refreshed the lock');
  release({ checkedDays: [] });
  assert.equal((await pending).ok, true);
  t.mock.timers.reset();
  // Stale info refers to an old inode; the file now at lockPath is a different (fresh) lock -> it is put back.
  await writeFile(lock, 'old'); const staleInfo = await st(lock);
  const { rename: mv } = await import('node:fs/promises'); await mv(lock, lock + '.keep'); await writeFile(lock, 'fresh'); // old inode stays alive
  assert.equal(await mod.breakStaleLock(lock, staleInfo), false);
  assert.equal(await rf(lock, 'utf8'), 'fresh');
  // Same inode -> removed.
  assert.equal(await mod.breakStaleLock(lock, await st(lock)), true);
  await assert.rejects(st(lock));
});
