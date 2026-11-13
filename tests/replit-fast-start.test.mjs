import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startReplitFastStart } from "../script/replit-fast-start.mjs";

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

test("Replit launcher answers health immediately and proxies after the app is ready", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replit-fast-start-"));
  const childEntry = path.join(directory, "delayed-app.mjs");
  const upstreamPort = await reservePort();
  await writeFile(childEntry, `
    import http from "node:http";
    setTimeout(() => http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", path: req.url }));
    }).listen(Number(process.env.PORT), process.env.HOST), 450);
  `);

  const runtime = await startReplitFastStart({
    publicHost: "127.0.0.1",
    publicPort: 0,
    upstreamPort,
    childEntry,
    preflightEntry: false,
    readinessIntervalMs: 25,
    startupHoldMs: 0,
    childStdio: "ignore",
  });
  t.after(() => runtime.stop("SIGKILL"));

  const starting = await fetch(`http://127.0.0.1:${runtime.port}/api/health`);
  assert.equal(starting.status, 200);
  assert.equal((await starting.json()).status, "starting");

  const unavailable = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks`);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("retry-after"), "2");
  assert.deepEqual(await unavailable.json(), { status: "starting" });

  const browserRoot = await fetch(`http://127.0.0.1:${runtime.port}/`, { headers: { accept: "text/html" } });
  assert.equal(browserRoot.status, 200, "platform health check on / stays 200 during startup");
  assert.match(await browserRoot.text(), /http-equiv="refresh"/);

  await waitFor(() => runtime.isUpstreamReady(), "delayed app startup");
  const ready = await fetch(`http://127.0.0.1:${runtime.port}/api/health`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ok", path: "/api/health" });
});

test("Replit deployment runs through the fast-start launcher", async () => {
  const [{ readFile }, packageJson] = await Promise.all([
    import("node:fs/promises"),
    import("../package.json", { with: { type: "json" } }),
  ]);
  const replit = await readFile(new URL("../.replit", import.meta.url), "utf8");
  assert.match(replit, /run = \["node", "script\/replit-fast-start\.mjs"\]/);
  assert.equal(packageJson.default.scripts["start:replit"], "NODE_ENV=production node script/replit-fast-start.mjs");
});

async function waitFor(predicate, label, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function controlledRuntime(t, initialMode = "ok", overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replit-proxy-health-"));
  const childEntry = path.join(directory, "app.mjs");
  const upstreamPort = await reservePort();
  await writeFile(childEntry, `
    import http from "node:http";
    let mode = ${JSON.stringify(initialMode)}, delay = 0, active = 0, maxActive = 0, probes = 0;
    let hangOpen = 0, resetOnce = 0;
    const sockets = new Set();
    setInterval(() => {}, 1 << 30); // keep the process alive while the server is "dead"
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/die') {
        // Upstream stops answering while the child process stays alive.
        res.end('dying');
        setTimeout(() => {
          server.close();
          for (const socket of sockets) socket.destroy();
          const revive = Number(url.searchParams.get('revive') || 0);
          if (revive) setTimeout(() => server.listen(Number(process.env.PORT), process.env.HOST), revive);
        }, 10);
        return;
      }
      if (url.pathname === '/reset-once') {
        if (resetOnce++ === 0) { req.socket.destroy(); return; }
        res.end('retried'); return;
      }
      if (url.pathname === '/hang-count') { res.end(String(hangOpen)); return; }
      if (url.pathname === '/slow') { setTimeout(() => res.end('slow'), Number(url.searchParams.get('ms') || 300)); return; }
      if (url.pathname === '/control') {
        mode = url.searchParams.get('mode') || 'ok';
        delay = Number(url.searchParams.get('delay') || 0);
        res.end('ok'); return;
      }
      if (url.pathname === '/stats') {
        res.end(JSON.stringify({active, maxActive, probes})); return;
      }
      if (url.pathname === '/reset') { req.socket.destroy(); return; }
      if (url.pathname === '/hang') { hangOpen++; res.once('close', () => hangOpen--); return; }
      if (url.pathname === '/route-error') { res.writeHead(500); res.end('route failed'); return; }
      if (url.pathname !== '/api/health') { res.end('application'); return; }
      active++; probes++; maxActive = Math.max(active,maxActive);
      res.once('close', () => active--);
      if (mode === 'hang') return;
      if (mode === 'hang-once') { mode = 'ok'; return; }
      if (mode === 'body-hang') { res.writeHead(200); res.write('partial'); return; }
      const status = mode === 'ok' ? 200 : Number(mode);
      setTimeout(() => { if (!res.destroyed) { res.writeHead(status); res.end('health'); } }, delay);
    });
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    server.listen(Number(process.env.PORT), process.env.HOST);
  `);
  const runtime = await startReplitFastStart({ publicHost: '127.0.0.1', publicPort: 0,
    upstreamPort, childEntry, preflightEntry: false, childStdio: 'ignore',
    readinessIntervalMs: 30, readinessTimeoutMs: 140, readinessFailureThreshold: 3,
    proxyTimeoutMs: 500, startupHoldMs: 0, retryDelayMs: 20,
    log: () => {}, logError: () => {}, ...overrides });
  t.after(async () => {
    await runtime.stop('SIGKILL');
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });
  if (initialMode === 'ok') await waitFor(() => runtime.isUpstreamReady(), 'initial readiness');
  const direct = `http://127.0.0.1:${upstreamPort}`;
  const control = async (mode, delay = 0) => {
    const response = await fetch(`${direct}/control?mode=${mode}&delay=${delay}`);
    await response.text();
  };
  const stats = async () => (await fetch(`${direct}/stats`)).json();
  await waitFor(async () => { try { await stats(); return true; } catch { return false; } }, 'child listening');
  return { runtime, control, stats, direct, publicUrl: `http://127.0.0.1:${runtime.port}` };
}

test('route errors, resets and request deadlines do not downgrade global readiness', async t => {
  const {runtime, publicUrl} = await controlledRuntime(t);
  for (const [route, status, body] of [['/reset', 502, 'upstream_error'], ['/hang', 504, 'upstream_timeout']]) {
    const response = await fetch(publicUrl + route);
    assert.equal(response.status, status, `${route} fails only this request`);
    assert.equal((await response.json()).status, body);
    assert.equal(runtime.isUpstreamReady(), true);
    assert.equal(await (await fetch(publicUrl + '/application')).text(), 'application');
  }
  const error = await fetch(publicUrl + '/route-error');
  assert.equal(error.status, 500);
  assert.equal(await error.text(), 'route failed');
  assert.equal(runtime.isUpstreamReady(), true);
});

test('health probes are serial and tolerate transient failure but reject sustained unhealthy responses', async t => {
  const {runtime, control, stats} = await controlledRuntime(t);
  await control('ok', 80); // Longer than poll interval: old implementation overlaps.
  const initial = (await stats()).probes;
  await waitFor(async () => (await stats()).probes >= initial + 4, 'delayed successful probes');
  assert.equal((await stats()).maxActive, 1);
  assert.equal(runtime.isUpstreamReady(), true);
  await control('503');
  const beforeFailure = (await stats()).probes;
  await waitFor(async () => (await stats()).probes > beforeFailure, 'one failed probe');
  assert.equal(runtime.isUpstreamReady(), true, 'one failure must not flap readiness');
  await control('ok');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(runtime.isUpstreamReady(), true);
  for (const mode of ['503', '404', '302']) {
    await control(mode);
    await waitFor(() => !runtime.isUpstreamReady(), `sustained ${mode} unready`);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(runtime.isUpstreamReady(), false, `${mode} must not promote readiness`);
    await control('ok');
    await waitFor(() => runtime.isUpstreamReady(), 'successful recovery');
  }
});

test('hanging health response and body have bounded deadlines and recover without overlapping probes', async t => {
  const {runtime, control, stats} = await controlledRuntime(t);
  for (const mode of ['hang', 'body-hang']) {
    await control(mode);
    await waitFor(() => !runtime.isUpstreamReady(), `${mode} deadline failures`);
    assert.equal((await stats()).maxActive, 1);
    await control('ok');
    await waitFor(() => runtime.isUpstreamReady(), `${mode} recovery`);
  }
});

test('child exit immediately clears readiness and stops further probes', async t => {
  const {runtime, control, stats} = await controlledRuntime(t);
  await control('ok', 110);
  const count = (await stats()).probes;
  await waitFor(async () => (await stats()).probes > count, 'pending delayed health probe');
  const exited = new Promise(resolve => runtime.child.once('exit', resolve));
  runtime.child.kill('SIGTERM');
  await exited;
  assert.equal(runtime.isUpstreamReady(), false);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(runtime.isUpstreamReady(), false, 'late probe must not resurrect exited child');
  assert.equal(runtime.server.listening, false);
  // Allow the launcher's asynchronous close handler to set its exit code first.
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test('startup requires a complete successful health response before accepting application traffic', async t => {
  const {runtime, control, stats, publicUrl} = await controlledRuntime(t, '404');
  await waitFor(async () => (await stats()).probes >= 3, 'initial rejected probes');
  assert.equal(runtime.isUpstreamReady(), false);
  assert.equal((await fetch(publicUrl + '/application')).status, 503);
  await control('body-hang');
  const count = (await stats()).probes;
  await waitFor(async () => (await stats()).probes >= count + 3, 'incomplete 200 responses');
  assert.equal(runtime.isUpstreamReady(), false, '200 headers alone do not establish readiness');
  await control('ok');
  await waitFor(() => runtime.isUpstreamReady(), 'complete 200 response');
  assert.equal(await (await fetch(publicUrl + '/application')).text(), 'application');
});

test('production defaults: 1 s interval, 3 s timeout, 5 consecutive failures', async t => {
  const {runtime} = await controlledRuntime(t, 'ok', {
    readinessIntervalMs: undefined, readinessTimeoutMs: undefined, readinessFailureThreshold: undefined,
    proxyTimeoutMs: undefined, startupHoldMs: undefined,
  });
  assert.deepEqual(runtime.config, {
    readinessIntervalMs: 1000, startupIntervalMs: 250, readinessTimeoutMs: 3000,
    readinessFailureThreshold: 5, proxyTimeoutMs: 30000, startupHoldMs: 15000,
  });
});

test('a single timed-out health probe after ready never produces a 503', async t => {
  const {runtime, control, stats, publicUrl} = await controlledRuntime(t, 'ok', { readinessFailureThreshold: 5 });
  await control('hang-once');
  const before = (await stats()).probes;
  const statuses = [];
  const deadline = Date.now() + 600; // spans the 140 ms probe timeout and recovery
  while (Date.now() < deadline) {
    statuses.push((await fetch(publicUrl + '/application')).status);
    assert.equal(runtime.isUpstreamReady(), true);
  }
  assert.ok((await stats()).probes >= before + 2, 'the hung probe was followed by healthy probes');
  assert.ok(statuses.length > 5);
  assert.deepEqual([...new Set(statuses)], [200]);
});

test('client abort of a proxied request does not flip readiness and releases the upstream request', async t => {
  const {runtime, direct, publicUrl} = await controlledRuntime(t);
  const controller = new AbortController();
  const pending = fetch(publicUrl + '/hang', { signal: controller.signal }).catch(error => error);
  await waitFor(async () => (await (await fetch(direct + '/hang-count')).text()) === '1', 'upstream hang open');
  controller.abort();
  assert.equal((await pending).name, 'AbortError');
  await waitFor(async () => (await (await fetch(direct + '/hang-count')).text()) === '0', 'upstream request released');
  assert.equal(runtime.isUpstreamReady(), true);
  assert.equal(runtime.failedProbeCount(), 0);
  assert.equal((await fetch(publicUrl + '/application')).status, 200);
});

test('idempotent GET is retried once after a connection reset before any response', async t => {
  const {runtime, publicUrl} = await controlledRuntime(t);
  const response = await fetch(publicUrl + '/reset-once');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'retried');
  assert.equal(runtime.isUpstreamReady(), true);
});

test('real upstream death goes unready only after N consecutive failures and recovers', async t => {
  const {runtime, direct, publicUrl} = await controlledRuntime(t, 'ok', { readinessFailureThreshold: 5 });
  await (await fetch(direct + '/die?revive=1200')).text();
  await waitFor(() => runtime.failedProbeCount() >= 1, 'first failed probe');
  assert.equal(runtime.isUpstreamReady(), true, 'still ready after one failure');
  await waitFor(() => !runtime.isUpstreamReady(), 'unready after sustained failure');
  assert.ok(runtime.failedProbeCount() >= 5);
  const down = await fetch(publicUrl + '/application');
  assert.equal(down.status, 503);
  assert.equal(down.headers.get('retry-after'), '2');
  assert.deepEqual(await down.json(), { status: 'unavailable' });
  await waitFor(() => runtime.isUpstreamReady(), 'recovery after upstream returns', 4000);
  assert.equal(await (await fetch(publicUrl + '/application')).text(), 'application');
});

test('requests during startup are held until ready instead of failing with 503', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replit-fast-start-hold-"));
  const childEntry = path.join(directory, "delayed-app.mjs");
  const upstreamPort = await reservePort();
  await writeFile(childEntry, `
    import http from "node:http";
    setTimeout(() => http.createServer((req, res) => res.end("app:" + req.url))
      .listen(Number(process.env.PORT), process.env.HOST), 400);
  `);
  const runtime = await startReplitFastStart({
    publicHost: "127.0.0.1", publicPort: 0, upstreamPort, childEntry, preflightEntry: false,
    childStdio: "ignore", startupHoldMs: 5000, log: () => {}, logError: () => {},
  });
  t.after(() => runtime.stop("SIGKILL"));
  assert.equal(runtime.isUpstreamReady(), false);
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/tasks`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "app:/api/tasks");
});

test('POST with a body still gets 504/502 when the route stalls or resets (no hanging client)', async t => {
  const {runtime, publicUrl} = await controlledRuntime(t);
  for (const [route, status, body] of [['/hang', 504, 'upstream_timeout'], ['/reset', 502, 'upstream_error']]) {
    const started = Date.now();
    const response = await fetch(publicUrl + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 1 }), signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, status, `${route} POST answers instead of hanging`);
    assert.equal((await response.json()).status, body);
    assert.ok(Date.now() - started < 2500);
    assert.equal(runtime.isUpstreamReady(), true);
  }
});

test('after the app has been ready, health paths report 503 while it is unhealthy', async t => {
  const {runtime, control, publicUrl} = await controlledRuntime(t);
  await control('500');
  await waitFor(() => !runtime.isUpstreamReady(), 'unready after sustained failures');
  const health = await fetch(publicUrl + '/api/health');
  assert.equal(health.status, 503);
  await health.text();
  await control('ok');
  await waitFor(() => runtime.isUpstreamReady(), 'recovered');
});

test('auth callbacks are never retried after a reset (one-time codes)', async t => {
  const {publicUrl} = await controlledRuntime(t);
  const response = await fetch(publicUrl + '/api/auth/callback-reset-check');
  assert.equal(response.status, 200, 'normal auth GET still proxied');
  await response.text();
});
