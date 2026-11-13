import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorld, filterWorld, freshness, readSource, worldReadAllowlist } from '../client/src/lib/agents-world';
import { readLearning } from '../client/src/lib/agents-world-learning';
import { renderBudget, stationLayout, visualMotion } from '../client/src/lib/agents-world-layout';
import { worldOwnerMatches } from '../client/src/lib/agents-world-session';

const now = Date.parse('2026-10-08T12:00:00Z');
const empty = { state: 'ready' as const, data: [] };
const denied = { state: 'denied' as const };
const entities = () => buildWorld('fixture-user', empty, empty, denied, now);

test('catalog and disconnected content roles never imply real activity', () => {
  const world = entities();
  assert.equal(world.length, 26);
  const roles = world.filter(entity => entity.area === 'Contenido' && entity.id.startsWith('content-'));
  assert.equal(roles.length, 5);
  assert.ok(roles.every(entity => entity.connection === 'No conectado' && entity.result === 'No verificado'));
  assert.ok(world.every(entity => entity.task === 'Sin tarea actual verificada'));
});
test('owned rows only; health and completed agenda do not prove agent work', () => {
  const projects = { state: 'ready' as const, data: [
    { id: 'own', name: 'KONG fixture', userId: 'fixture-user', status: 'online', lastCheck: new Date(now).toISOString() },
    { id: 'foreign', name: 'FOREIGN PRIVATE', userId: 'other' },
  ] };
  const tasks = { state: 'ready' as const, data: [{ id: 'task', title: 'Fixture task', userId: 'fixture-user', completed: true }] };
  const world = buildWorld('fixture-user', projects, tasks, denied, now);
  assert.ok(!world.some(entity => entity.name.includes('FOREIGN')));
  assert.match(world.find(entity => entity.id === 'project:own')!.result, /no ejecución/);
  assert.match(world.find(entity => entity.id === 'task:task')!.result, /no verificado/);
  assert.equal(buildWorld('other', projects, tasks, denied, now).some(entity => entity.id === 'task:task'), false);
});
test('freshness handles old, invalid and future dates without invented signals', () => {
  assert.equal(freshness('invalid', now), 'No verificado');
  assert.equal(freshness(new Date(now + 120_000).toISOString(), now), 'No verificado');
  assert.equal(freshness('2020-01-01T00:00:00Z', now), 'Obsoleto');
  assert.equal(freshness(new Date(now).toISOString(), now), 'Señal reciente');
});
test('BlackRoom desired enable and online flags never imply execution', () => {
  const world = buildWorld('fixture-user', empty, empty, { state: 'ready', data: { remote: { online: true, desiredEnabled: true, device: {} } } }, now);
  const room = world.find(entity => entity.id === 'blackroom')!;
  assert.equal(room.signal, 'Sin señal');
  assert.equal(room.result, 'No verificado');
});
test('learning stays provisional; stale observations cannot claim improvement', () => {
  const decision = { id: 'fixture-decision', testId: 'fixture-test', sourceObservedAt: new Date(now).toISOString(), windowHours: 24, evidencePostIds: ['fixture-post'], status: 'testing', winner: 'drop_first' };
  const source = { state: 'ready' as const, data: { agent: { analytics: { lastCheckedAt: new Date(now).toISOString(), verifiedLearning: { tiktok: decision } } } } };
  assert.match(readLearning(source, now)[0].winner, /provisionalmente/);
  assert.equal(readLearning(source, now + 24 * 3600_000)[0].winner, 'Sin mejora verificada');
  assert.deepEqual(readLearning(denied, now), []);
});
test('owner verification fails closed on expired or mismatched native session', () => {
  assert.equal(worldOwnerMatches('fixture-user', { state: 'ready', data: { authenticated: true, user: { id: 'fixture-user' } } }), true);
  for (const source of [denied, { state: 'error' as const }, { state: 'ready' as const, data: { authenticated: true, user: { id: 'other' } } }, { state: 'ready' as const, data: { authenticated: false, user: { id: 'fixture-user' } } }]) {
    assert.equal(worldOwnerMatches('fixture-user', source), false);
  }
});
test('filters and placement remain deterministic across large inventory', () => {
  const base = entities();
  assert.equal(filterWorld(base, 'publicación', 'Contenido', 'Todas', 'Todas')[0].id, 'content-publication');
  assert.equal(filterWorld(base, 'not-found', 'Todos', 'Todas', 'Todas').length, 0);
  assert.deepEqual(stationLayout(base), stationLayout(base));
  const large = Array.from({ length: 1000 }, (_, index) => ({ ...base[0], id: `fixture:${index}` }));
  assert.equal(stationLayout(large).length, 1000);
  assert.ok(stationLayout(large).every(station => Number.isFinite(station.x) && Number.isFinite(station.z)));
});
test('decorative motion and render budgets honor pause and device limits', () => {
  assert.deepEqual(visualMotion(0, 10, false), { x: 0, z: 0, leg: 0, yaw: 0 });
  assert.notDeepEqual(visualMotion(0, 1, true), visualMotion(0, 2, true));
  assert.deepEqual(renderBudget(true, 3), { fps: 20, pixelRatio: 1 });
  assert.deepEqual(renderBudget(false, 3), { fps: 30, pixelRatio: 1.5 });
});
test('proposed CTO/evaluator stay disconnected with unknown activity and no operational link', () => {
  const world = entities();
  for (const name of ['CTO', 'Entrenador/evaluador de IA']) {
    const role = world.find(entity => entity.name === name)!;
    assert.ok(role);
    assert.equal(role.catalogStatus, 'Propuesto · No conectado');
    assert.equal(role.connection, 'No conectado');
    assert.equal(role.href, undefined);
    assert.equal(role.signal, 'Sin señal');
    assert.equal(role.result, 'No verificado');
    assert.equal(role.lastSignal, undefined);
    assert.equal(role.task, 'Sin tarea actual verificada');
    assert.match(role.evidence, /No se ha creado un agente/);
  }
  assert.equal(world.find(entity => entity.id === 'cto')!.department, 'Ingeniería');
  assert.equal(world.find(entity => entity.id === 'ai-evaluator')!.department, 'IA y evaluación');
});
test('department and brand/project filters are independent; names do not invent KONG membership', () => {
  const world = buildWorld('fixture-user', { state: 'ready', data: [
    { id: 'own', name: 'KONG fixture', userId: 'fixture-user' },
    { id: 'assigned', name: 'Owned project', userId: 'fixture-user', department: 'Ingeniería' },
    { id: 'invalid', name: 'Unknown classification', userId: 'fixture-user', department: 'KONG' },
    { id: 'foreign', name: 'PRIVATE', userId: 'other', department: 'Ingeniería' },
  ] }, empty, denied, now);
  const own = world.find(entity => entity.id === 'project:own')!;
  assert.equal(own.department, 'Desconocido');
  assert.equal(own.brandProject, 'KONG fixture');
  assert.equal(world.find(entity => entity.id === 'project:invalid')!.department, 'Desconocido');
  assert.deepEqual(filterWorld(world, '', 'Ingeniería', 'Owned project', 'Todas').map(entity => entity.id), ['project:assigned']);
  assert.equal(filterWorld(world, '', 'Ingeniería', 'KONG fixture', 'Todas').length, 0);
  assert.deepEqual(filterWorld(world, '', 'Desconocido', 'KONG fixture', 'Sin señal').map(entity => entity.id), ['project:own']);
  assert.deepEqual(filterWorld(world, '', 'Todos', 'KONG', 'Todas').map(entity => entity.id), ['kong']);
  assert.equal(filterWorld(world, 'PRIVATE', 'Todos', 'Todas', 'Todas').length, 0);
  assert.ok(!stationLayout(world).some(station => station.entity.id === 'project:own'));
});
test('transport enforces allowlist before fetch and explicit response failures', async () => {
  assert.deepEqual(worldReadAllowlist, ['/api/auth/me', '/api/projects', '/api/tasks']);
  const original = globalThis.fetch;
  let calls = 0;
  const signal = new AbortController().signal;
  try {
    globalThis.fetch = (async (_url, options) => { calls++; assert.equal(options?.method, undefined); return new Response('[]', { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
    for (const path of ['/api/automations', '/api/app-qa-agent/history', '/api/projects/github-overview', '/api/legal-compliance/reports', '/api/clippers/status', '/api/clippers/local-news/status', '/api/revenue-engine']) assert.equal((await readSource(path, signal)).state, 'denied');
    assert.equal(calls, 0);
    assert.equal((await readSource('/api/projects', signal)).state, 'ready');
    globalThis.fetch = (async () => new Response('{}', { status: 403 })) as typeof fetch;
    assert.equal((await readSource('/api/blackroom-agent', signal)).state, 'denied');
    globalThis.fetch = (async () => new Response('{}', { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    assert.equal((await readSource('/api/tasks', signal)).state, 'error');
    globalThis.fetch = (async () => new Response('<html/>', { headers: { 'content-type': 'text/html' } })) as typeof fetch;
    assert.equal((await readSource('/api/projects', signal)).state, 'error');
    globalThis.fetch = (async () => { throw new Error('fixture abort'); }) as typeof fetch;
    assert.equal((await readSource('/api/projects', signal)).state, 'error');
  } finally { globalThis.fetch = original; }
});
