import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { parseLegacyKongSupervision } from '../shared/kong-supervisor.ts';
import { registerKongSupervisorRoutes } from '../server/kong-supervisor-routes.ts';

const at = new Date(Date.parse('2026-11-05T00:00:00Z')).toISOString();

test('the retired supervisor history parses read-only; corrupt or missing state is an empty archive', () => {
  assert.deepEqual(parseLegacyKongSupervision(undefined), { archived: true, lastRunAt: null, records: [], messages: [] });
  const parsed = parseLegacyKongSupervision({ version: 1, lastRunAt: at,
    records: [null, {}, { agentId: 'outsider', task: 'review-readiness', result: 'completed', reason: 'yes', checkedAt: at },
      { agentId: 'kong-videos', task: 'review-readiness', result: 'completed', reason: 'ok', checkedAt: at }],
    messages: [{ id: 'm1', requestId: 'request-0001', agentId: 'kong:Venues', at, role: 'user', text: 'hola' }, { id: 'x', agentId: 'nobody' }] });
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.lastRunAt, at);
});

test('the old chat endpoint is retired (410 with the agent chat path) and the history stays owner-only', async t => {
  const app = express(); app.use(express.json());
  registerKongSupervisorRoutes(app, async () => parseLegacyKongSupervision({ version: 1, records: [], messages: [{ id: 'm1', requestId: 'request-0001', agentId: 'kong-supervisor', at, role: 'user', text: 'privado' }] }),
    { requestUserId: req => req.headers['x-test-user'] || null, ownerUserId: () => 'owner' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, user) => fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });
  assert.equal((await call('GET', '/api/kong-supervisor/state')).status, 401);
  assert.equal((await call('GET', '/api/kong-supervisor/state', 'member')).status, 403);
  const owner = await (await call('GET', '/api/kong-supervisor/state', 'owner')).json();
  assert.equal(owner.archived, true);
  assert.equal(owner.messages[0].text, 'privado');
  assert.match(owner.chatPath, /agent-chat/);
  assert.equal((await call('POST', '/api/kong-supervisor/chat', 'member')).status, 403);
  const retired = await call('POST', '/api/kong-supervisor/chat', 'owner');
  assert.equal(retired.status, 410);
  assert.match((await retired.json()).chatPath, /agent-chat/);
});
