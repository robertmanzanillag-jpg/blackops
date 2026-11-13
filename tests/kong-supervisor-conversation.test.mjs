import test from 'node:test';
import assert from 'node:assert/strict';
import { createKongSupervisorConversation, KongConversationInputError } from '../server/kong-supervisor-conversation.ts';
import { emptyKongSupervision, parseKongSupervision } from '../shared/kong-supervisor.ts';
import { registerKongSupervisorRoutes } from '../server/kong-supervisor-routes.ts';

function harness(readVideoStatus = async () => ({ state: 'working' })) {
  let raw = JSON.stringify(emptyKongSupervision());
  let queue = Promise.resolve();
  let reads = 0;
  let writes = 0;
  const service = createKongSupervisorConversation({
    now: () => Date.parse('2026-11-05T01:00:00Z'),
    read: async () => parseKongSupervision(JSON.parse(raw)),
    readVideoStatus: async () => { reads++; return readVideoStatus(); },
    commit: change => {
      const job = queue.then(async () => {
        const next = await change(parseKongSupervision(JSON.parse(raw)));
        raw = JSON.stringify(next);
        writes++;
        return next;
      });
      queue = job.catch(() => {});
      return job;
    },
  });
  return { service, get reads() { return reads; }, get writes() { return writes; } };
}
const input = (message, requestId = 'request-0001', agentId = 'kong-supervisor') => ({ message, requestId, agentId });

test('conversation answers help and recorded status without executing a task', async () => {
  const h = harness();
  assert.match((await h.service.talk(input('ayuda'))).reply.text, /solo lee estado/);
  assert.match((await h.service.talk(input('estado', 'request-0002'))).reply.text, /sin revision registrada/);
  assert.equal(h.reads, 0);
  assert.equal((await h.service.view()).messages.length, 4);
});
test('supervisor assigns actual read-only review and persists verifiable outcomes', async () => {
  const h = harness();
  const result = await h.service.talk(input('revisar'));
  assert.equal(h.reads, 1);
  assert.equal(result.state.records.length, 5);
  assert.equal(result.state.records[0].result, 'completed');
  assert.ok(result.state.records.slice(1).every(item => item.result === 'blocked'));
  assert.match(result.reply.text, /No se ha ejecutado una orden comercial/);
  assert.deepEqual((await h.service.view()).records, result.state.records);
});
test('unconnected guide never invokes video producer or penalizes external workers', async () => {
  const h = harness();
  const result = await h.service.talk(input('revisar', 'request-0001', 'kong:Venues'));
  assert.equal(h.reads, 0);
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].result, 'blocked');
  assert.match(result.reply.text, /Integracion no conectada/);
  assert.equal(Object.hasOwn(result.state, 'careers'), false);
});
test('commercial requests are declined explicitly rather than executed', async () => {
  const h = harness();
  const result = await h.service.talk(input('Publica el video ahora'));
  assert.match(result.reply.text, /no se ha ejecutado/);
  assert.equal(h.reads, 0);
  assert.equal(result.state.records.length, 0);
});
test('concurrent retries are idempotent under council mutation queue', async () => {
  const h = harness();
  await Promise.all(Array.from({ length: 5 }, () => h.service.talk(input('revisar'))));
  assert.equal(h.reads, 1);
  assert.equal((await h.service.view()).messages.length, 2);
  assert.equal((await h.service.view()).records.length, 5);
});
test('recent checks avoid repeated reads and do not claim a new task', async () => {
  const h = harness();
  await h.service.talk(input('revisar'));
  const result = await h.service.talk(input('revisar', 'request-0002'));
  assert.equal(h.reads, 1);
  assert.equal(result.state.records.length, 5);
  assert.match(result.reply.text, /No se inicio otra lectura/);
});
test('persistence conflict replay reuses one observed read', async () => {
  let state = emptyKongSupervision();
  let reads = 0;
  const service = createKongSupervisorConversation({
    now: () => Date.parse('2026-11-05T01:00:00Z'),
    read: async () => state,
    readVideoStatus: async () => { reads++; return { state: 'working' }; },
    commit: async change => {
      await change(state); // A competing writer invalidates the first revision.
      state = await change({ ...state, messages: [...state.messages] });
      return state;
    },
  });
  const result = await service.talk(input('revisar'));
  assert.equal(reads, 1);
  assert.equal(result.state.messages.length, 2);
  assert.equal(result.state.records.length, 5);
});
test('input validation runs before reads or persistence', async () => {
  const h = harness();
  for (const value of [null, {}, input(''), input('a'.repeat(501)), input('revisar', '../bad'), input('revisar', 'request-0001', '../escape')]) await assert.rejects(h.service.talk(value), KongConversationInputError);
  assert.equal(h.reads, 0);
  assert.equal(h.writes, 0);
});
test('reader failures redact error details; stale content is blocked', async () => {
  const h = harness(async () => { throw new Error('private connection details'); });
  const result = await h.service.talk(input('revisar'));
  assert.equal(result.state.records[0].result, 'failed');
  assert.doesNotMatch(JSON.stringify(result), /private connection details/);
  const stale = harness(async () => ({ state: 'offline' }));
  assert.equal((await stale.service.talk(input('revisar'))).state.records[0].result, 'blocked');
});
test('conversation history is bounded across many messages', async () => {
  const h = harness();
  for (let n = 0; n < 60; n++) await h.service.talk(input('ayuda', `request-${String(n).padStart(4, '0')}`));
  assert.equal((await h.service.view()).messages.length, 80);
});

test('route contract: read is no-store, validation 400, storage failure 503 without leaks', async () => {
  const routes = new Map();
  const app = { get: (path, handler) => routes.set(`GET ${path}`, handler), post: (path, handler) => routes.set(`POST ${path}`, handler) };
  const h = harness();
  const auth = { requestUserId: req => req.userId || null, ownerUserId: () => 'test-owner' };
  registerKongSupervisorRoutes(app, h.service, auth);
  function response() { return { code: 200, headers: {}, body: undefined, set(k,v) { this.headers[k]=v; return this; }, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } }; }
  for (const userId of [null, 'other-account']) {
    for (const method of ['GET /api/kong-supervisor/state', 'POST /api/kong-supervisor/chat']) {
      const denied = response();
      await routes.get(method)({ userId, body: input('revisar') }, denied);
      assert.equal(denied.code, userId ? 403 : 401);
    }
  }
  assert.equal(h.reads, 0);
  assert.equal(h.writes, 0);
  const get = response();
  await routes.get('GET /api/kong-supervisor/state')({ userId: 'test-owner' }, get);
  assert.equal(get.headers['Cache-Control'], 'no-store');
  assert.equal(h.writes, 0);
  const invalid = response();
  await routes.get('POST /api/kong-supervisor/chat')({ userId: 'test-owner', body: {} }, invalid);
  assert.equal(invalid.code, 400);
  const ok = response();
  await routes.get('POST /api/kong-supervisor/chat')({ userId: 'test-owner', body: input('revisar') }, ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.body.state.records.length, 5);
  registerKongSupervisorRoutes(app, { view: async () => { throw new Error('private'); }, talk: async () => { throw new Error('private'); } }, auth);
  for (const method of ['GET /api/kong-supervisor/state', 'POST /api/kong-supervisor/chat']) {
    const failed = response();
    await routes.get(method)({ userId: 'test-owner' }, failed);
    assert.equal(failed.code, 503);
    assert.doesNotMatch(JSON.stringify(failed), /private/);
  }
});
