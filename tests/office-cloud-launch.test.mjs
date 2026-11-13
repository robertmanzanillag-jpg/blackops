import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createOfficeCloudLauncher } from "../script/office-cloud-launch.mjs";

function fixture(patch = {}) {
  const calls = [];
  const kills = [];
  const children = [];
  const signals = new EventEmitter();
  let timer;
  let cleared = 0;
  const options = {
    env: { OFFICE_WORKER_ENABLED: "true", OFFICE_HOSTING_MODE: "reserved-vm", PATH: "local-vendor-cli-path" },
    platform: "linux", executable: "/trusted/node", cwd: "/trusted/application", signals, graceMs: 2500,
    spawnImpl: (...args) => {
      calls.push(args);
      const child = new EventEmitter(); child.pid = 1000 + children.length;
      child.kill = signal => { kills.push({ direct: child.pid, signal }); return true; };
      children.push(child); return child;
    },
    killGroup: (pid, signal) => { kills.push({ group: pid, signal }); },
    setTimeoutImpl: (callback, milliseconds) => { timer = { callback, milliseconds }; return timer; },
    clearTimeoutImpl: () => { cleared++; },
    ...patch,
  };
  return { calls, kills, children, signals, launcher: createOfficeCloudLauncher(options), expire: () => { assert.ok(timer); timer.callback(); }, timer: () => timer, cleared: () => cleared };
}

for (const env of [
  {}, { OFFICE_WORKER_ENABLED: "true" }, { OFFICE_HOSTING_MODE: "reserved-vm" },
  { OFFICE_WORKER_ENABLED: "false", OFFICE_HOSTING_MODE: "reserved-vm" },
  { OFFICE_WORKER_ENABLED: "true", OFFICE_HOSTING_MODE: "autoscale" },
]) test(`hosting guards create zero children: ${JSON.stringify(env)}`, async () => {
  const f = fixture({ env });
  assert.equal(await f.launcher.run(), 1); assert.equal(f.calls.length, 0); assert.equal(f.kills.length, 0);
  assert.equal(f.signals.listenerCount("SIGTERM"), 0);
});

test("unsupported platforms fail closed without starting children", async () => {
  const f = fixture({ platform: "win32" });
  assert.equal(await f.launcher.run(), 1); assert.equal(f.calls.length, 0);
});

test("approved Linux supervisor starts exact web and compiled-worker commands once without a shell", async () => {
  const f = fixture(); const first = f.launcher.run(); const repeated = f.launcher.run();
  assert.equal(first, repeated); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.map(call => call.slice(0, 2)), [["/trusted/node", ["script/replit-fast-start.mjs"]], ["/trusted/node", ["dist/office-worker.cjs"]]]);
  for (const [, , config] of f.calls) {
    assert.equal(config.shell, false); assert.equal(config.detached, true); assert.equal(config.stdio, "inherit");
    assert.equal(config.cwd, "/trusted/application"); assert.equal(config.env.NODE_ENV, "production");
    assert.equal(config.env.PATH, "local-vendor-cli-path");
  }
  f.launcher.stop(); f.expire(); assert.equal(await first, 0);
});

test("unexpected child exit stops both process groups and stays nonzero even when exit code was zero", async () => {
  const f = fixture(); const running = f.launcher.run();
  f.children[0].emit("exit", 0, null);
  assert.deepEqual(f.kills, [{ group: 1000, signal: "SIGTERM" }, { group: 1001, signal: "SIGTERM" }]);
  assert.equal(f.timer().milliseconds, 2500);
  // The web wrapper can exit before its own child. Grace still kills its group.
  f.children[1].emit("exit", 0, "SIGTERM");
  f.expire();
  assert.equal(await running, 1);
  assert.deepEqual(f.kills.slice(2), [{ group: 1000, signal: "SIGKILL" }, { group: 1001, signal: "SIGKILL" }]);
  assert.equal(f.calls.length, 2);
});

test("child error initiates bounded cleanup of both groups and removes parent signal listeners", async () => {
  const f = fixture(); const running = f.launcher.run();
  f.children[1].emit("error", new Error("private child error"));
  f.expire(); assert.equal(await running, 1);
  assert.equal(f.kills.length, 4); assert.equal(f.cleared(), 1);
  assert.equal(f.signals.listenerCount("SIGTERM"), 0); assert.equal(f.signals.listenerCount("SIGINT"), 0);
});

test("a synchronous second spawn failure still stops the already-started web group", async () => {
  const f = fixture(); let count = 0;
  const child = new EventEmitter(); child.pid = 2200; child.kill = () => true;
  const g = fixture({ spawnImpl: () => { if (++count === 2) throw new Error("Spawn failed"); return child; } });
  const running = g.launcher.run(); g.expire();
  assert.equal(await running, 1);
  assert.deepEqual(g.kills, [{ group: 2200, signal: "SIGTERM" }, { group: 2200, signal: "SIGKILL" }]);
  assert.equal(f.calls.length, 0);
});

test("a first spawn failure needs no timer or unrelated process cleanup", async () => {
  const f = fixture({ spawnImpl: () => { throw new Error("Unavailable"); } });
  assert.equal(await f.launcher.run(), 1); assert.deepEqual(f.kills, []); assert.equal(f.timer(), undefined);
});

for (const signal of ["SIGTERM", "SIGINT"]) test(`parent ${signal} terminates both groups cleanly`, async () => {
  const f = fixture(); const running = f.launcher.run();
  f.signals.emit(signal);
  assert.deepEqual(f.kills.slice(0, 2), [{ group: 1000, signal }, { group: 1001, signal }]);
  f.expire(); assert.equal(await running, 0);
  assert.equal(f.calls.length, 2);
});

test("stop before run prevents all child creation", async () => {
  const f = fixture(); f.launcher.stop();
  assert.equal(await f.launcher.run(), 0); assert.equal(f.calls.length, 0);
});

test("invalid process-group identifiers never signal existing groups", async () => {
  const f = fixture({ spawnImpl: () => { const child = new EventEmitter(); child.pid = -1; return child; } });
  assert.equal(await f.launcher.run(), 1); assert.deepEqual(f.kills, []);
});

test("missing own process groups are harmless; denied group cleanup uses direct-child fallback and fails", async () => {
  const f = fixture({ killGroup: () => { const error = new Error("Denied"); error.code = "EPERM"; throw error; } });
  const running = f.launcher.run(); f.launcher.stop(); f.expire();
  assert.equal(await running, 1);
  assert.deepEqual(f.kills.map(item => item.signal), ["SIGTERM", "SIGTERM", "SIGKILL", "SIGKILL"]);
  const g = fixture({ killGroup: () => { const error = new Error("Gone"); error.code = "ESRCH"; throw error; } });
  const ended = g.launcher.run(); g.launcher.stop(); g.expire(); assert.equal(await ended, 0);
});
