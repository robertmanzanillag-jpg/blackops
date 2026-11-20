import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import ts from 'typescript';
import { isPublicApiRequest } from '../server/user-context';
import { parseClippersEnvelope } from '../server/clippers-orchestra-state';
import { orchestraFixture } from './fixtures/clippers-orchestra.mjs';

const ENDPOINT = '/api/blackroom-agent/clippers-orchestra';
const TOKEN = 'synthetic-scope-safe-'.repeat(3);
const source = readFileSync(new URL('../server/blackroom-control-routes.ts', import.meta.url), 'utf8');
const verifier = source.slice(source.indexOf('export function hasValidBlackRoomRemoteToken'), source.indexOf('export function summarizeBlackRoomAnalyticsImports'));
const verifiers = new Function('timingSafeEqual', ts.transpile(verifier.replaceAll('export ', ''), { target: ts.ScriptTarget.ES2022 }) + '; return { hasValidBlackRoomRemoteToken, hasValidClippersDeviceToken };')(timingSafeEqual);
function setup() {
  const counts = { blackRoomRead: 0, blackRoomMutate: 0, heartbeat: 0, control: 0, ingest: 0 };
  const start = source.indexOf('  app.post("' + ENDPOINT + '"');
  const end = source.indexOf('\n  app.post("/api/blackroom-agent/remote"', start);
  assert.ok(start > 0 && end > start);
  const route = ts.transpile(source.slice(start, end).replace('await import("./clippers-orchestra-state")', '__telemetry'), { target: ts.ScriptTarget.ES2022 });
  let handler: any;
  new Function('app', 'hasValidClippersDeviceToken', '__telemetry', 'readBlackRoomRemoteControl', 'mutateBlackRoomRemoteControl', 'recordBlackRoomRemoteHeartbeat', 'remoteView', route)(
    { post: (url: string, callback: any) => { assert.equal(url, ENDPOINT); handler = callback; } },
    (req: any) => verifiers.hasValidClippersDeviceToken(req, TOKEN),
    { parseClippersEnvelope, ingestOptionalClippersTelemetry: async () => { counts.ingest++; return { accepted: true, duplicate: false, code: 'CLIPPERS_ORCHESTRA_ACCEPTED' }; } },
    () => { counts.blackRoomRead++; throw Error('BlackRoom read forbidden'); },
    () => { counts.blackRoomMutate++; throw Error('BlackRoom mutation forbidden'); },
    () => { counts.heartbeat++; throw Error('BlackRoom heartbeat forbidden'); },
    () => { counts.control++; throw Error('BlackRoom control forbidden'); },
  );
  return { handler, counts };
}
function envelope() {
  const report: any = orchestraFixture(Date.now());
  report.transport = { state: 'disconnected', lastIngestAt: null, maxAgeMs: 90_000 };
  report.sourceFreshness.transport = 'local_reports'; report.sourceFreshness.receivedAt = null;
  for (const role of report.roles) role.career = { registered: false, generation: null, points: null, battery: null, inTraining: false, hiredAt: null, skillIds: [], lastEvidenceId: null };
  const value = { version: 1, nonce: randomUUID(), generatedAt: report.generatedAt, report };
  assert.ok(parseClippersEnvelope(value)); return value;
}
function request(body: any, patch: any = {}) {
  const headers = patch.headers ?? { authorization: 'Bearer ' + TOKEN };
  return { body, headers, rawHeaders: [], query: {}, originalUrl: ENDPOINT, rawBody: Buffer.from(JSON.stringify(body) ?? ''),
    get: (name: string) => headers[name.toLowerCase()], is: (type: string) => type === 'application/json', ...patch };
}
function response() {
  return { statusCode: 200, body: undefined as any, headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; }, set(key: string, value: string) { this.headers[key] = value; return this; }, json(value: any) { this.body = value; return this; } };
}
function noBlackRoom(counts: ReturnType<typeof setup>['counts']) {
  assert.equal(counts.blackRoomRead + counts.blackRoomMutate + counts.heartbeat + counts.control, 0);
}

test('only the exact POST has session bypass, never GET, method aliases, query or related paths', () => {
  const req = (method: string, url = ENDPOINT): any => ({ method, originalUrl: url, path: url.split('?')[0], query: {} });
  assert.equal(isPublicApiRequest(req('POST')), true);
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'post']) assert.equal(isPublicApiRequest(req(method)), false);
  for (const url of [ENDPOINT + '/', ENDPOINT + '?', ENDPOINT + '?x=1', ENDPOINT + '/extra', ENDPOINT.toUpperCase()]) assert.equal(isPublicApiRequest(req('POST', url)), false);
});

test('valid telemetry uses actual strict parser and existing bearer verifier, ACK only and no BlackRoom calls', async () => {
  const f = setup(), res = response();
  await f.handler(request({ kind: 'clippers-orchestra', clippersOrchestra: envelope() }), res);
  assert.equal(res.statusCode, 200); assert.equal(f.counts.ingest, 1); noBlackRoom(f.counts);
  assert.deepEqual(Object.keys(res.body), ['clippersOrchestra']);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(res.body.clippersOrchestra.accepted, true);
});

test('unauthenticated and wrong bearer never parse or mutate even valid telemetry', async () => {
  for (const authorization of [undefined, 'Bearer wrong']) {
    const f = setup(), res = response();
    await f.handler(request({ kind: 'clippers-orchestra', clippersOrchestra: envelope() }, { get: () => authorization }), res);
    assert.equal(res.statusCode, 401); assert.equal(f.counts.ingest, 0); noBlackRoom(f.counts);
  }
});

test('missing/mixed discriminator, foreign keys, commands, nonJSON and query reject with no legacy fallthrough', async () => {
  const value = envelope();
  for (const body of [undefined, null, [], { clippersOrchestra: value }, { kind: 'other', clippersOrchestra: value },
    { kind: 'clippers-orchestra' }, { kind: 'clippers-orchestra', clippersOrchestra: value, deviceId: 'legacy' },
    { kind: 'clippers-orchestra', clippersOrchestra: value, queue: {} }, { kind: 'clippers-orchestra', clippersOrchestra: value, command: 'start' }, value]) {
    const f = setup(), res = response();
    await f.handler(request(body, { rawBody: Buffer.from(JSON.stringify(body) ?? '') }), res);
    assert.equal(res.statusCode, 400); assert.equal(f.counts.ingest, 0); noBlackRoom(f.counts);
  }
  for (const patch of [{ is: () => false }, { originalUrl: ENDPOINT + '?', query: {} }, { query: { x: '1' } }]) {
    const f = setup(), res = response();
    await f.handler(request({ kind: 'clippers-orchestra', clippersOrchestra: value }, patch), res);
    assert.equal(res.statusCode, 400); assert.equal(f.counts.ingest, 0); noBlackRoom(f.counts);
  }
});

test('size applies to complete raw wrapper and fallback test serialization, schema rejects forged reports', async () => {
  const good = { kind: 'clippers-orchestra', clippersOrchestra: envelope() };
  for (const patch of [{ rawBody: Buffer.alloc(262145) }, { rawBody: undefined, body: { ...good, clippersOrchestra: { report: 'x'.repeat(262144) } } }]) {
    const f = setup(), res = response();
    await f.handler(request(good, patch), res);
    assert.equal(res.statusCode, 413); assert.equal(f.counts.ingest, 0); noBlackRoom(f.counts);
  }
  const bad = structuredClone(good); (bad.clippersOrchestra.report as any).safety.paidSpendUsd = 1;
  const f = setup(), res = response(); await f.handler(request(bad), res);
  assert.equal(res.statusCode, 400); assert.equal(f.counts.ingest, 0); noBlackRoom(f.counts);
});

test('legacy heartbeat source remains byte-identical to the reviewed baseline', () => {
  const start = source.indexOf('  app.post("/api/blackroom-agent/remote"');
  const end = source.indexOf('\n  app.put("/api/blackroom-agent/media/:reservationId"', start);
  assert.ok(start > 0 && end > start);
  assert.equal(createHash('sha256').update(source.slice(start, end)).digest('hex'), '826e8a1e69867dec91d63e031ca212b9cc5f6c0c4adf1a439a6332c263f76491');
});


test('private Shield may strip platform Authorization; explicit device proof still works and never falls back', async () => {
  const good = {kind:'clippers-orchestra',clippersOrchestra:envelope()};
  for (const headers of [{'x-clippers-device-token':TOKEN},{authorization:'Bearer synthetic-platform-only-secret','x-clippers-device-token':TOKEN}]) {
    const f=setup(),res=response();await f.handler(request(good,{headers}),res);assert.equal(res.statusCode,200);assert.equal(f.counts.ingest,1);noBlackRoom(f.counts);
  }
  for (const headers of [{authorization:'Bearer synthetic-platform-only-secret'}, {'x-clippers-device-token':'wrong',authorization:'Bearer '+TOKEN}, {'x-clippers-device-token':'',authorization:'Bearer '+TOKEN}, {'x-clippers-device-token':[TOKEN,TOKEN],authorization:'Bearer '+TOKEN}, {'x-clippers-device-token':TOKEN+','+TOKEN,authorization:'Bearer '+TOKEN}, {'x-clippers-device-token':TOKEN,authorization:['Bearer synthetic-platform','Bearer other']}]) {
    const f=setup(),res=response();await f.handler(request(good,{headers}),res);assert.equal(res.statusCode,401);assert.equal(f.counts.ingest,0);noBlackRoom(f.counts);
  }
});

test('duplicate case-insensitive raw device/Auth headers are ambiguous even if Node joins them', async () => {
  const good={kind:'clippers-orchestra',clippersOrchestra:envelope()};
  for(const rawHeaders of [['X-Clippers-Device-Token',TOKEN,'x-clippers-device-token',TOKEN],['Authorization','Bearer synthetic-platform','authorization','Bearer other']]){
    const f=setup(),res=response();await f.handler(request(good,{headers:{'x-clippers-device-token':TOKEN},rawHeaders}),res);assert.equal(res.statusCode,401);assert.equal(f.counts.ingest,0);noBlackRoom(f.counts);
  }
});
