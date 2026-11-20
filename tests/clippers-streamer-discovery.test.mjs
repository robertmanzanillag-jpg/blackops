import test from 'node:test';
import assert from 'node:assert/strict';
import { detectClipProhibition, resolveClipPolicy, buildCreditCaption, captionHasCredit, parseCityPageNames, parseTakedown, clipLengthAllowed } from '../shared/clippers-streamer-policy.mjs';
import { runStreamerDiscovery, streamerConfig, isoDurationSeconds, twitchClipMp4Guess, localWorkQueue, STREAMER_STATE_NAMESPACE, STREAMER_APPROVAL_ACTION, popScore, approvalModeFor, approvalRow } from '../script/clippers-streamer-discovery.mjs';
import { ALL_DISCOVERY_CREATORS } from '../shared/clippers-priority-creators.mjs';

const NOW = Date.parse('2026-11-19T15:00:00.000Z');
const ENV = { TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: 'csecret', YOUTUBE_API_KEY: 'ykey', CLIPPERS_CITY_PAGE_NAMES: JSON.stringify({ '6591612': { name: 'Miami Streamers' }, '6595747': { name: 'NYC Streamers' } }) };

test('prohibition detector matches explicit Spanish/English no-clip language only', () => {
  for (const t of ['NO CLIPS please', 'Do not repost my content', 'Clipping is not allowed', 'Prohibido clipear mis directos', 'No se permiten clips', 'Está prohibido resubir', 'no reuploads!', 'No hagáis clips', 'Re-uploads are prohibited'])
    assert.equal(detectClipProhibition(t).prohibited, true, t);
  for (const t of ['Best clips every day', 'clips permitidos con créditos', 'Business: mail@x.com', 'I love clipping highlights', '', 'no clipeo nada hoy? jaja'.replace('clipeo', 'juego')])
    assert.equal(detectClipProhibition(t).prohibited, false, t);
});

test('policy order: takedown > known list > description > allowed', () => {
  const td = [parseTakedown({ creatorKey: 'twitch:1', reason: 'DMCA email', receivedAt: '2026-11-19T10:00:00.000Z' }, NOW)];
  assert.equal(td[0].removeBy, '2026-11-20T10:00:00.000Z');
  assert.equal(resolveClipPolicy({ creatorKey: 'twitch:1', description: '', takedowns: td }).source, 'takedown');
  assert.equal(resolveClipPolicy({ creatorKey: 'twitch:2', creatorGroupId: 'x', knownProhibited: [{ creatorGroupId: 'x', evidenceUrl: 'https://e' }] }).status, 'prohibited');
  const d = resolveClipPolicy({ creatorKey: 'twitch:3', description: 'Hola! prohibido clipear', descriptionSource: 'https://www.twitch.tv/a/about' });
  assert.equal(d.status, 'prohibited'); assert.match(d.evidence.excerpt, /prohibido clipear/);
  assert.equal(resolveClipPolicy({ creatorKey: 'twitch:4', description: 'hi' }).status, 'allowed_unless_prohibited');
  assert.equal(parseTakedown({ reason: 'x', receivedAt: '2026-11-19T10:00:00.000Z' }, NOW), null);
});

test('caption always credits @handle and links the source; city names default to Clipwave, env overrides', () => {
  const c = buildCreditCaption({ handle: 'TheGrefg', platform: 'twitch', sourceUrl: 'https://clips.twitch.tv/Abc', title: 'Locura' });
  assert.ok(captionHasCredit(c, 'TheGrefg', 'https://clips.twitch.tv/Abc'));
  assert.throws(() => buildCreditCaption({ handle: 'a', platform: 'twitch', sourceUrl: 'http://x', title: '' }));
  const defaults = parseCityPageNames('');
  assert.deepEqual(defaults.heldReasons, []);
  assert.deepEqual(defaults.pages.map(p => [p.name, p.handle, p.source]), [['Clipwave Miami', '@clipwave.mia', 'default'], ['Clipwave NYC', '@clipwave.nyc', 'default']]);
  const partial = parseCityPageNames('{"6595747":{"name":"NYC Clips"}}');
  assert.deepEqual(partial.pages.map(p => p.name), ['Clipwave Miami', 'NYC Clips']);
  const named = parseCityPageNames(ENV.CLIPPERS_CITY_PAGE_NAMES);
  assert.deepEqual(named.pages.map(p => p.name), ['Miami Streamers', 'NYC Streamers']);
  assert.match(parseCityPageNames('{"6431692":{"name":"KONG"}}').heldReasons[0], /city_page_brand_not_allowed/);
  assert.equal(clipLengthAllowed(60), true); assert.equal(clipLengthAllowed(3600), false);
  assert.equal(isoDurationSeconds('PT1H2M3S'), 3723);
  assert.equal(twitchClipMp4Guess('https://clips-media-assets2.twitch.tv/AT-cm%7C1-preview-480x272.jpg'), 'https://clips-media-assets2.twitch.tv/AT-cm%7C1.mp4');
  assert.ok(popScore({ views: 1000, publishedAt: '2026-11-19T14:00:00.000Z', observedAt: '2026-11-19T15:00:00.000Z', priority: true }).score > 3);
});

test('catalogue keeps licence fields honest and adds the owner clip policy', () => {
  assert.ok(ALL_DISCOVERY_CREATORS.every(c => c.permission === 'unknown' && c.mayPublish === false && c.clipPolicy === 'allowed_unless_prohibited'));
});

function memoryStore() {
  const data = new Map();
  return { data, async read(k) { return data.get(k) ?? null; }, async transact(k, fn) { const v = await fn(data.get(k) ?? null); data.set(k, v); return v; } };
}
function memoryQueue() {
  const rows = new Map(); let n = 0;
  return { rows, async insert(row) { const id = `pa-${++n}`; rows.set(id, { ...row, id }); return id; },
    async statuses(owner, ids) { return new Map(ids.filter(id => rows.has(id)).map(id => [id, rows.get(id).status])); } };
}
function mockFetch() {
  const calls = [];
  const res = body => ({ ok: true, status: 200, json: async () => body, headers: new Map() });
  const fn = async (url, init = {}) => {
    const u = new URL(String(url)); calls.push({ url: u, init });
    if (u.host === 'id.twitch.tv') return res({ access_token: 'tok' });
    if (u.host === 'api.twitch.tv') {
      assert.equal(init.headers['Client-Id'], 'cid'); assert.equal(init.headers.Authorization, 'Bearer tok');
      const p = u.pathname.replace('/helix/', '');
      if (p === 'users' && u.searchParams.getAll('login').length) return res({ data: [
        { id: '100', login: 'thegrefg', display_name: 'TheGrefg', description: 'Streamer' },
        { id: '200', login: 'rubius', display_name: 'Rubius', description: 'PROHIBIDO CLIPEAR mis directos' }] });
      if (p === 'users') return res({ data: [{ id: '300', login: 'bigguy', display_name: 'BigGuy', description: 'variety' }] });
      if (p === 'games/top') return res({ data: [] });
      if (p === 'streams') return res({ data: [{ user_id: '300', user_login: 'bigguy', title: 'live', viewer_count: 50000, started_at: '2026-11-19T12:00:00Z', game_name: 'Just Chatting' }] });
      if (p === 'clips') {
        const b = u.searchParams.get('broadcaster_id');
        return res({ data: [{ id: `clip${b}`, broadcaster_id: b, broadcaster_name: b, title: `clip ${b}`, url: `https://clips.twitch.tv/clip${b}`, duration: 30, view_count: 9000,
          created_at: '2026-11-19T13:00:00Z', thumbnail_url: `https://clips-media-assets2.twitch.tv/x${b}-preview-480x272.jpg` }] });
      }
    }
    if (u.host === 'www.googleapis.com') {
      assert.equal(u.searchParams.get('key'), 'ykey');
      const p = u.pathname.split('/').pop();
      if (p === 'channels') return res({ items: [{ id: 'UCX6OQ3DkcsbYNE6H8uQQuVA', snippet: { title: 'MrBeast', description: 'New videos weekly' } }] });
      if (p === 'playlistItems') return res({ items: u.searchParams.get('playlistId') === 'UUX6OQ3DkcsbYNE6H8uQQuVA' ? [{ contentDetails: { videoId: 'abcdefghijk' } }] : [] });
      if (p === 'videos' && u.searchParams.get('chart')) return res({ items: [] });
      if (p === 'videos') return res({ items: [{ id: 'abcdefghijk', snippet: { channelId: 'UCX6OQ3DkcsbYNE6H8uQQuVA', title: 'Big video', publishedAt: '2026-11-19T05:00:00Z', liveBroadcastContent: 'none' },
        statistics: { viewCount: '5000000' }, contentDetails: { duration: 'PT20M' } }] });
    }
    throw new Error('unexpected ' + u);
  };
  return { fn, calls };
}

test('without keys: clean skip, office-visible held reasons, no network', async () => {
  const store = memoryStore(), queue = memoryQueue();
  const fetch = async () => { throw new Error('no network expected'); };
  const { report } = await runStreamerDiscovery({ env: {}, now: NOW, fetch, store, queue, owner: 'o' });
  assert.equal(report.status, 'skipped_missing_secrets');
  assert.deepEqual(report.heldReasons.slice(0, 3), ['missing_secret:TWITCH_CLIENT_ID', 'missing_secret:TWITCH_CLIENT_SECRET', 'missing_secret:YOUTUBE_API_KEY']);
  assert.equal(queue.rows.size, 0);
  assert.ok(store.data.has(STREAMER_STATE_NAMESPACE('o')));
});

test('with mocked APIs: ranks, blocks prohibited creator with evidence, queues approvals, never publishes', async () => {
  const store = memoryStore(), queue = memoryQueue(), { fn, calls } = mockFetch();
  const { report, state } = await runStreamerDiscovery({ env: ENV, now: NOW, fetch: fn, store, queue, owner: 'o' });
  assert.equal(report.status, 'completed', JSON.stringify(report.errors));
  assert.equal(report.published, 0); assert.equal(report.paidSpendUsd, 0);
  assert.ok(!calls.some(c => /metricool/i.test(c.url.host)), 'never calls Metricool');
  assert.ok(!calls.some(c => c.url.pathname.endsWith('/search')), 'never uses search.list');
  assert.equal(state.creators['twitch:200'].policy.status, 'prohibited');
  assert.equal(state.creators['twitch:200'].policy.source, 'channel_description');
  const rubiusClip = state.candidates.find(c => c.id === 'twitch-clip:clip200');
  assert.equal(rubiusClip.clipPolicy.status, 'prohibited'); assert.equal(rubiusClip.approval.status, 'not_requested');
  const rows = [...queue.rows.values()];
  assert.ok(rows.length >= 2);
  assert.ok(rows.every(r => r.actionType === STREAMER_APPROVAL_ACTION && r.status === 'pending' && r.userId === 'o'));
  assert.ok(rows.every(r => r.input.caption.includes('@') && r.input.caption.includes(r.input.sourceUrl)));
  assert.ok(!rows.some(r => r.resourceId === 'twitch-clip:clip200'));
  const yt = state.candidates.find(c => c.id === 'youtube:abcdefghijk');
  assert.equal(yt.download.mode, 'needs_local_download'); assert.equal(yt.download.needsCutSelection, true);
  assert.ok(state.signals.some(s => s.kind === 'live' && s.handle === 'bigguy'));
  // Approval flows back and becomes Mac work.
  const first = rows[0]; queue.rows.get(first.id).status = 'approved';
  const second = await runStreamerDiscovery({ env: ENV, now: NOW + 3600_000, fetch: fn, store, queue, owner: 'o' });
  const work = localWorkQueue(second.state);
  assert.ok(work.some(w => w.pendingActionId === first.id && w.maxSeconds === 60));
  // Takedown blocks forever.
  const s = second.state; s.takedowns.push({ creatorKey: work[0] && s.candidates.find(c => c.id === work[0].candidateId).creatorKey, reason: 'owner asked', receivedAt: new Date(NOW).toISOString() });
  assert.equal(localWorkQueue(s).length, 0);
});

test('auto-publish flag pre-approves rows but is off by default', async () => {
  assert.equal(streamerConfig(ENV).autoPublish, false);
  const queue = memoryQueue();
  await runStreamerDiscovery({ env: { ...ENV, CLIPPERS_STREAMER_AUTO_PUBLISH: 'true' }, now: NOW, fetch: mockFetch().fn, store: memoryStore(), queue, owner: 'o' });
  assert.ok([...queue.rows.values()].every(r => r.status === 'approved' && r.input.approvalMode === 'auto_publish_flag'));
});

test('failure streak counts code failures only, not missing secrets', async () => {
  const store = memoryStore();
  const broken = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const env = { TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b' };
  for (let i = 1; i <= 3; i++) assert.equal((await runStreamerDiscovery({ env, now: NOW + i, fetch: broken, store, queue: memoryQueue(), owner: 'o' })).state.failureStreak, i);
  assert.equal((await runStreamerDiscovery({ env: {}, now: NOW + 9, fetch: broken, store, queue: memoryQueue(), owner: 'o' })).state.failureStreak, 0);
});

import { createPendingActionsQueue, creatorPolicyChecked } from '../script/clippers-streamer-discovery.mjs';
const OUTSIDE = 'UCzzzzzzzzzzzzzzzzzzzzzz';

test('YouTube budget exhausted before outside-channel lookup: unchecked creator is never offered or queued', async () => {
  const base = mockFetch().fn;
  const fetch = async (url, init) => {
    const u = new URL(String(url)), p = u.pathname.split('/').pop();
    const res = body => ({ ok: true, status: 200, json: async () => body, headers: new Map() });
    if (p === 'videos' && u.searchParams.get('chart')) return res({ items: [{ id: 'zzzzzzzzzzz' }] });
    if (p === 'videos') return res({ items: u.searchParams.get('id').split(',').map(id => id === 'zzzzzzzzzzz'
      ? { id, snippet: { channelId: OUTSIDE, title: 'Trending', publishedAt: '2026-11-19T10:00:00Z', liveBroadcastContent: 'none' }, statistics: { viewCount: '9000000' }, contentDetails: { duration: 'PT40S' } }
      : { id, snippet: { channelId: 'UCX6OQ3DkcsbYNE6H8uQQuVA', title: 'Big video', publishedAt: '2026-11-19T05:00:00Z', liveBroadcastContent: 'none' }, statistics: { viewCount: '10' }, contentDetails: { duration: 'PT20M' } }) });
    return base(url, init);
  };
  const env = { YOUTUBE_API_KEY: 'ykey', CLIPPERS_YOUTUBE_UNITS_PER_RUN: '16', CLIPPERS_YOUTUBE_TRENDING_REGIONS: 'US', CLIPPERS_CITY_PAGE_NAMES: ENV.CLIPPERS_CITY_PAGE_NAMES };
  const queue = memoryQueue();
  const { report, state } = await runStreamerDiscovery({ env, now: NOW, fetch, store: memoryStore(), queue, owner: 'o' });
  assert.ok(report.heldReasons.includes('youtube_unit_budget_reached'));
  const c = state.candidates.find(x => x.id === 'youtube:zzzzzzzzzzz');
  assert.ok(c); assert.equal(c.clipPolicy.source, 'not_checked'); assert.equal(creatorPolicyChecked(state, c), false);
  assert.ok(![...queue.rows.values()].some(r => r.resourceId === c.id));
  c.approval = { status: 'approved', pendingActionId: 'x' };
  assert.ok(!localWorkQueue(state).some(w => w.candidateId === c.id));
});

test('pending_actions insert is idempotent per owner/action/candidate (SQL reuses a live row)', async () => {
  const seen = [];
  const q = createPendingActionsQueue(async (sql, values) => { seen.push({ sql, values }); return { rows: [{ id: 'existing-1' }] }; });
  const id = await q.insert({ userId: 'o', actionType: STREAMER_APPROVAL_ACTION, resourceType: 'r', resourceId: 'twitch-clip:a', title: 't', description: 'd', riskLevel: 'medium', status: 'pending', input: {} });
  assert.equal(id, 'existing-1');
  assert.match(seen[0].sql, /WHERE NOT EXISTS \(SELECT 1 FROM existing\)/);
  assert.match(seen[0].sql, /status NOT IN \('rejected','failed'\)/);
  assert.deepEqual(seen[0].values.slice(0, 4), ['o', STREAMER_APPROVAL_ACTION, 'r', 'twitch-clip:a']);
  await assert.rejects(createPendingActionsQueue(async () => ({ rows: [] })).insert({ userId: 'o', input: {} }), /PENDING_ACTION_INSERT_FAILED/);
});

test('401/403 become credential_invalid held reasons and never count as code failures', async () => {
  const store = memoryStore();
  const denied = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const r = await runStreamerDiscovery({ env: { TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b', YOUTUBE_API_KEY: 'k' }, now: NOW, fetch: denied, store, queue: memoryQueue(), owner: 'o' });
  assert.equal(r.report.status, 'held_credentials');
  assert.ok(r.report.heldReasons.includes('credential_invalid:TWITCH') && r.report.heldReasons.includes('credential_invalid:YOUTUBE'));
  assert.equal(r.state.failureStreak, 0); assert.deepEqual(r.report.errors, []);
});

test('minimum interval: a second trigger within 45 min skips without writing; invalid stored state is never overwritten', async () => {
  const store = memoryStore();
  await runStreamerDiscovery({ env: {}, now: NOW, fetch: async () => { throw new Error('x'); }, store, queue: memoryQueue(), owner: 'o', minIntervalMs: 45 * 60_000 });
  const before = store.data.get(STREAMER_STATE_NAMESPACE('o'));
  const second = await runStreamerDiscovery({ env: {}, now: NOW + 10 * 60_000, fetch: async () => { throw new Error('x'); }, store, queue: memoryQueue(), owner: 'o', minIntervalMs: 45 * 60_000 });
  assert.equal(second.skipped, true); assert.equal(store.data.get(STREAMER_STATE_NAMESPACE('o')), before);
  const third = await runStreamerDiscovery({ env: {}, now: NOW + 50 * 60_000, fetch: async () => { throw new Error('x'); }, store, queue: memoryQueue(), owner: 'o', minIntervalMs: 45 * 60_000 });
  assert.notEqual(third.skipped, true);
  const bad = memoryStore(); bad.data.set(STREAMER_STATE_NAMESPACE('o'), '{"version":2}');
  await assert.rejects(runStreamerDiscovery({ env: {}, now: NOW, fetch: async () => { throw new Error('x'); }, store: bad, queue: memoryQueue(), owner: 'o' }), /STREAMER_STATE_INVALID/);
  assert.equal(bad.data.get(STREAMER_STATE_NAMESPACE('o')), '{"version":2}');
});

test('approval sync never flips a prohibited/taken-down clip back to approved', async () => {
  const store = memoryStore(), queue = memoryQueue(), { fn } = mockFetch();
  const first = await runStreamerDiscovery({ env: ENV, now: NOW, fetch: fn, store, queue, owner: 'o' });
  const c = first.state.candidates.find(x => x.approval?.pendingActionId);
  queue.rows.get(c.approval.pendingActionId).status = 'approved';
  const s = JSON.parse(store.data.get(STREAMER_STATE_NAMESPACE('o')));
  s.takedowns.push({ creatorKey: c.creatorKey, reason: 'owner asked', receivedAt: new Date(NOW).toISOString() });
  store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s));
  const second = await runStreamerDiscovery({ env: ENV, now: NOW + 3600_000, fetch: fn, store, queue, owner: 'o' });
  const after = second.state.candidates.find(x => x.id === c.id);
  assert.equal(after.clipPolicy.status, 'prohibited'); assert.equal(after.approval.status, 'rejected');
  assert.ok(!localWorkQueue(second.state).some(w => w.candidateId === c.id));
});

test('with the cloud publisher on, approvals go only to platforms it can download (Twitch by default)', async () => {
  const store = memoryStore(), queue = memoryQueue(), { fn } = mockFetch();
  await runStreamerDiscovery({ env: { ...ENV, CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true' }, now: NOW, fetch: fn, store, queue, owner: 'o' });
  const rows = [...queue.rows.values()];
  assert.ok(rows.length >= 1); assert.ok(rows.every(r => r.input.platform === 'twitch'));
});

test('approval-queue IO and HTTP never run while the council owner lock is held', async () => {
  const base = memoryStore(), inner = memoryQueue(), { fn } = mockFetch();
  let inTx = false, ioInTx = 0;
  const store = { data: base.data, read: base.read, async transact(k, update) { inTx = true; try { return await base.transact(k, update); } finally { inTx = false; } } };
  const queue = { rows: inner.rows, async insert(row) { if (inTx) ioInTx++; return inner.insert(row); }, async statuses(o, ids) { if (inTx) ioInTx++; return inner.statuses(o, ids); } };
  const fetch = async (...a) => { if (inTx) ioInTx++; return fn(...a); };
  const { report, state } = await runStreamerDiscovery({ env: ENV, now: NOW, fetch, store, queue, owner: 'o' });
  assert.equal(report.status, 'completed', JSON.stringify(report.errors));
  assert.equal(ioInTx, 0, 'no network or pending_actions IO inside the transaction');
  assert.ok(inner.rows.size >= 2 && report.counts.queuedForApproval === inner.rows.size);
  assert.ok([...inner.rows.values()].every(r => state.candidates.find(c => c.id === r.resourceId)?.approval?.pendingActionId === r.id));
  // A second run reuses existing rows (idempotent) and keeps the recorded approvals.
  const again = await runStreamerDiscovery({ env: ENV, now: NOW + 3_600_000, fetch, store, queue, owner: 'o' });
  assert.equal(ioInTx, 0); assert.equal(again.report.counts.queuedForApproval, 0);
});

test('concurrent approval inserts for one candidate create exactly one live row (advisory lock + fresh statement)', async () => {
  const { approvalInsertLockKey } = await import('../script/clippers-streamer-discovery.mjs');
  const rows = []; const locks = new Map(); const seen = [];
  // Fake PostgreSQL: per-key advisory lock held until COMMIT; the check-and-insert sees committed rows only.
  const transaction = async fn => {
    let release;
    const q = async (sql, values) => {
      seen.push(sql);
      if (sql.includes('pg_advisory_xact_lock')) {
        const key = values[0]; while (locks.has(key)) await locks.get(key);
        locks.set(key, new Promise(r => { release = () => { locks.delete(key); r(); }; })); return { rows: [] };
      }
      await new Promise(r => setTimeout(r, 5)); // widen the race window
      const live = rows.find(r => r.userId === values[0] && r.actionType === values[1] && r.resourceId === values[3]);
      if (live) return { rows: [{ id: live.id }] };
      const row = { id: `pa-${rows.length + 1}`, userId: values[0], actionType: values[1], resourceId: values[3] }; rows.push(row); return { rows: [{ id: row.id }] };
    };
    try { return await fn(q); } finally { release?.(); }
  };
  const q = createPendingActionsQueue(async () => { throw new Error('must use the transaction'); }, { transaction });
  const row = { userId: 'o', actionType: STREAMER_APPROVAL_ACTION, resourceType: 'r', resourceId: 'twitch-clip:a', title: 't', description: 'd', riskLevel: 'medium', status: 'pending', input: {} };
  const ids = await Promise.all([q.insert(row), q.insert(row), q.insert(row)]);
  assert.equal(rows.length, 1); assert.deepEqual(new Set(ids), new Set(['pa-1']));
  assert.ok(seen.indexOf(seen.find(s => s.includes('pg_advisory_xact_lock'))) < seen.findIndex(s => s.includes('WITH existing')));
  assert.equal(approvalInsertLockKey(row), JSON.stringify(['clippers-streamer-approval-v1', 'o', STREAMER_APPROVAL_ACTION, 'twitch-clip:a']));
  assert.notEqual(approvalInsertLockKey(row), approvalInsertLockKey({ ...row, resourceId: 'twitch-clip:b' }));
});

test('owner override lanes skip owner approval only for lane clips; "false" or empty override restores approval', () => {
  const kai = { id: 'twitch-clip:k', platform: 'twitch', handle: 'kaicenat', title: 'LOL', language: 'en', sourceUrl: 'https://clips.twitch.tv/k', caption: 'c', download: { mode: 'direct' }, clipPolicy: { status: 'allowed_unless_prohibited' } };
  const westcol = { ...kai, id: 'twitch-clip:w', handle: 'westcol', language: 'es' };
  const nyc = { ...kai, id: 'twitch-clip:n', handle: 'fanum' };
  const unrouted = { ...kai, id: 'twitch-clip:u', handle: 'random', language: 'fr' };
  const cfg = streamerConfig(ENV);
  assert.deepEqual([...cfg.autoPublishLanes].sort(), ['memes', 'miami', 'sports']);
  assert.equal(approvalModeFor(kai, cfg), 'lane_owner_override');
  assert.equal(approvalModeFor(westcol, cfg), 'lane_owner_override');
  assert.equal(approvalModeFor(nyc, cfg), 'owner_approval', 'NYC stays on owner approval');
  assert.equal(approvalModeFor(unrouted, cfg), 'owner_approval');
  const row = approvalRow(kai, 'o', cfg);
  assert.equal(row.status, 'approved'); assert.equal(row.input.approvalMode, 'lane_owner_override');
  assert.equal(approvalRow(kai, 'o', streamerConfig({ ...ENV, CLIPPERS_STREAMER_AUTO_PUBLISH: 'false' })).status, 'pending');
  assert.equal(approvalRow(kai, 'o', streamerConfig({ ...ENV, CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE: '' })).status, 'pending');
  assert.equal(approvalRow(kai, 'o', streamerConfig({ ...ENV, CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE: 'off' })).status, 'pending');
});
