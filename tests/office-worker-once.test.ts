import test from "node:test";
import assert from "node:assert/strict";
import { runOfficeWorkerOnce, OFFICE_ONCE_MAX_DURATION_MS, OFFICE_ONCE_CLAIM_WINDOW_MS, type OfficeOnceHost } from "../server/office-worker-once";

/** In-memory exclusive lock: try-only, like pg_try_advisory_lock. */
function memoryLock() {
  let holder: symbol | undefined; let lost = false;
  return {
    get held() { return holder !== undefined; },
    lose() { lost = true; },
    async acquire() {
      if (holder) return undefined;
      const me = Symbol("owner"); holder = me;
      return { verify: async () => holder === me && !lost, release: async () => { if (holder === me) holder = undefined; } };
    },
  };
}

function fixture(overrides: Partial<OfficeOnceHost> = {}, lock = memoryLock()) {
  let time = 0, serial = 0;
  const deadlines = new Map<number, () => void>(), intervals = new Map<number, () => void>();
  const clock = {
    setTimeout: (fn: () => void, ms: number) => {
      const id = ++serial;
      if (ms >= OFFICE_ONCE_CLAIM_WINDOW_MS) deadlines.set(id, fn);
      else { time += ms; queueMicrotask(() => { if (!cancelled.has(id)) fn(); }); }
      return id;
    },
    clearTimeout: (id: unknown) => { deadlines.delete(id as number); cancelled.add(id as number); },
    setInterval: (fn: () => void) => { intervals.set(++serial, fn); return serial; },
    clearInterval: (id: unknown) => { intervals.delete(id as number); },
  };
  const cancelled = new Set<number>();
  const calls = { ticks: 0, maintain: 0, capabilities: 0, academy: 0, stops: 0, protocol: 0, tickStartRemaining: [] as number[] };
  const host: OfficeOnceHost = {
    paused: () => false,
    acquire: () => lock.acquire(),
    otherExecutorActive: async () => false,
    checkProtocol: async () => { calls.protocol++; },
    refreshCapabilities: async () => { calls.capabilities++; },
    maintain: async () => { calls.maintain++; },
    tick: async () => { calls.ticks++; calls.tickStartRemaining.push(OFFICE_ONCE_MAX_DURATION_MS - time); },
    academyCycle: async () => { calls.academy++; },
    requestStop: () => { calls.stops++; },
    ...overrides,
  };
  const controller = new AbortController();
  return {
    host, lock, calls, controller, clock,
    advance: (ms: number) => { time += ms; },
    runIntervals: () => { for (const fn of [...intervals.values()]) fn(); },
    pending: () => ({ deadlines: deadlines.size, intervals: intervals.size }),
    options: { signal: controller.signal, durationMs: OFFICE_ONCE_MAX_DURATION_MS, clock, now: () => time },
  };
}

test("run is bounded: no claim starts without a full lease inside the budget, then exits and releases", async () => {
  const f = fixture();
  const result = await runOfficeWorkerOnce(f.host, f.options);
  assert.equal(result.reason, "deadline");
  assert.ok(f.calls.ticks > 0 && f.calls.ticks <= (OFFICE_ONCE_MAX_DURATION_MS - OFFICE_ONCE_CLAIM_WINDOW_MS) / 5000 + 1);
  assert.ok(f.calls.tickStartRemaining.every(left => left >= OFFICE_ONCE_CLAIM_WINDOW_MS));
  assert.equal(f.calls.academy, 1, "one academy pass per invocation");
  assert.equal(f.lock.held, false);
  assert.deepEqual(f.pending(), { deadlines: 0, intervals: 0 });
  assert.ok(f.calls.stops >= 1);
});

test("slow work is never followed by a claim past the cutoff", async () => {
  const f = fixture();
  f.host.tick = async () => { f.calls.ticks++; f.calls.tickStartRemaining.push(0); f.advance(5 * 60_000); };
  const result = await runOfficeWorkerOnce(f.host, f.options);
  assert.equal(result.reason, "deadline");
  assert.equal(f.calls.ticks, 2); // 13 min budget, 6 min window: claims at t=0 and t≈5m only.
  const g = fixture();
  g.host.academyCycle = async () => { g.advance(OFFICE_ONCE_MAX_DURATION_MS - OFFICE_ONCE_CLAIM_WINDOW_MS + 1); };
  assert.equal((await runOfficeWorkerOnce(g.host, g.options)).reason, "deadline");
  assert.equal(g.calls.ticks, 0);
});

test("persistent pause: exits before ownership, and mid-run without another claim", async () => {
  let acquired = 0;
  const f = fixture({ paused: () => true });
  const lock = f.lock; f.host.acquire = async () => { acquired++; return lock.acquire(); };
  assert.equal((await runOfficeWorkerOnce(f.host, f.options)).reason, "paused");
  assert.equal(acquired, 0); assert.equal(f.calls.ticks, 0);

  let pausedNow = false;
  const g = fixture({ paused: () => pausedNow });
  g.host.tick = async () => { g.calls.ticks++; if (g.calls.ticks === 3) pausedNow = true; };
  assert.equal((await runOfficeWorkerOnce(g.host, g.options)).reason, "paused");
  assert.equal(g.calls.ticks, 3); assert.equal(g.lock.held, false);
});

test("never steals ownership: a held lock exits busy without work, presence or release", async () => {
  const lock = memoryLock();
  const holder = await lock.acquire();
  const f = fixture({}, lock);
  assert.deepEqual(await runOfficeWorkerOnce(f.host, f.options), { reason: "busy", cycles: 0 });
  assert.equal(f.calls.ticks + f.calls.maintain + f.calls.capabilities + f.calls.protocol, 0);
  assert.equal(lock.held, true, "the existing owner keeps its lock");
  assert.equal(await holder!.verify(), true);

  // Two overlapping invocations: exactly one runs.
  const shared = memoryLock();
  const a = fixture({}, shared), b = fixture({}, shared);
  let releaseA!: () => void; const gate = new Promise<void>(resolve => { releaseA = resolve; });
  a.host.tick = async () => { a.calls.ticks++; await gate; throw Error("stop"); };
  const first = runOfficeWorkerOnce(a.host, a.options);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await runOfficeWorkerOnce(b.host, b.options)).reason, "busy");
  releaseA();
  assert.equal((await first).reason, "unconfirmed");
  assert.equal(b.calls.ticks, 0); assert.equal(shared.held, false);
});

test("an active PC executor blocks the cloud run without any claim", async () => {
  const f = fixture({ otherExecutorActive: async () => true });
  assert.equal((await runOfficeWorkerOnce(f.host, f.options)).reason, "pc-active");
  assert.equal(f.calls.ticks + f.calls.capabilities, 0); assert.equal(f.lock.held, false);
});

test("uncertain cycles and lost ownership end the run without replay", async () => {
  const f = fixture();
  f.host.tick = async () => { f.calls.ticks++; throw Error("OFFICE_COMPLETION_UNCONFIRMED"); };
  assert.equal((await runOfficeWorkerOnce(f.host, f.options)).reason, "unconfirmed");
  assert.equal(f.calls.ticks, 1); assert.equal(f.lock.held, false);

  const g = fixture();
  g.host.tick = async () => { g.calls.ticks++; if (g.calls.ticks === 2) { g.lock.lose(); g.runIntervals(); await new Promise(resolve => setImmediate(resolve)); } };
  assert.equal((await runOfficeWorkerOnce(g.host, g.options)).reason, "unconfirmed");
  assert.equal(g.calls.ticks, 2); assert.equal(g.calls.maintain, 0, "no presence after ownership is lost");

  const h = fixture({ checkProtocol: async () => { throw Error("OFFICE_PROTOCOL_UNAVAILABLE"); } });
  assert.equal((await runOfficeWorkerOnce(h.host, h.options)).reason, "unconfirmed");
  assert.equal(h.calls.ticks, 0);
});

test("abort stops cooperatively and settles before release", async () => {
  const f = fixture();
  f.host.tick = async () => { f.calls.ticks++; f.runIntervals(); f.controller.abort(); };
  assert.equal((await runOfficeWorkerOnce(f.host, f.options)).reason, "aborted");
  assert.equal(f.calls.ticks, 1); assert.equal(f.calls.maintain, 1); assert.ok(f.calls.stops >= 1); assert.equal(f.lock.held, false);
  const g = fixture(); g.controller.abort();
  assert.equal((await runOfficeWorkerOnce(g.host, g.options)).reason, "aborted"); assert.equal(g.lock.held, false); assert.equal(g.calls.ticks, 0);
});

test("invalid bounds are rejected before ownership", async () => {
  const f = fixture();
  for (const durationMs of [OFFICE_ONCE_MAX_DURATION_MS + 1, OFFICE_ONCE_CLAIM_WINDOW_MS, 1.5])
    await assert.rejects(runOfficeWorkerOnce(f.host, { ...f.options, durationMs }), /LIMIT_INVALID/);
  assert.equal(f.lock.held, false);
});
