import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { canonicalRepairJson, createKongRepairBridge, repairKey, KONG_REPAIR_REPOSITORY } from "../server/kong-repair-bridge";
import { pullRepairSources, readRepairPullStatus, createRepairPullLoop, KONG_REPAIR_PULL_INTERVAL_MS, RepairPullInitializationError, KONG_REPAIR_PULL_STARTUP_RETRY_MS } from "../server/kong-repair-pull";
const now = Date.parse("2026-11-18T00:00:00Z"), owner = "fixture-owner", token = "fixture-read-token-only-12345678901234567890";
function fixture() {
  const data = new Map<string, string>(); let tail = Promise.resolve(), issues = 0;
  const store = { read: async (key: string) => data.get(key) || null, transact: async (key: string, change: (raw: string | null) => Promise<string>) => {
    const job = tail.then(async () => { const result = await change(data.get(key) || null); data.set(key, result); return result; }); tail = job.then(() => {}, () => {}); return job;
  } };
  const bridge = createKongRepairBridge({ owner, store, now: () => now, createHandoff: async () => { issues++; return { repository: KONG_REPAIR_REPOSITORY, issueUrl: `https://github.com/${KONG_REPAIR_REPOSITORY}/issues/${issues}` }; }, readProof: async () => { throw Error("unused"); }, readPaidState: async () => "blocked_unknown_credit" });
  const payload = { company: "kong" as const, repository: KONG_REPAIR_REPOSITORY, sourceTaskId: randomUUID(), errorId: randomUUID(), fingerprint: "a".repeat(64), generation: 1,
    summary: "Source TypeError in readiness", regressionScenario: "api_ready_contract" as const, reportedAt: new Date(now).toISOString(),
    evidence: { route: "/api/ready", httpMethod: "GET" as const, httpStatus: 503, errorClass: "TypeError", message: "TypeError: Cannot read length", locations: [{ filePath: "server/readiness.ts", lineNumber: 42 }] } };
  const request = { key: repairKey(payload), payloadSha256: createHash("sha256").update(canonicalRepairJson(payload)).digest("hex"), payload };
  const source = { version: 1, company: "kong", repository: KONG_REPAIR_REPOSITORY, observedAt: new Date(now).toISOString(), total: 1, requests: [request] };
  return { store, bridge, source, calls: () => issues };
}
test("fixed existing GET/read credential imports durable source once, without paid-credit admission", async () => {
  const f = fixture(); let reads = 0;
  const options = { bridge: f.bridge, store: f.store, owner, token, handoffEnabled: true, now: () => now,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => { reads++; assert.equal(String(url), "https://kongnightlife.com/api/admin/ceo/operations"); assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`); return Response.json({ softwareRepairs: f.source }); }) as typeof fetch };
  assert.equal((await pullRepairSources(options)).newlyQueued, 1);
  assert.equal((await pullRepairSources(options)).newlyQueued, 0);
  assert.equal(f.calls(), 1); assert.equal(reads, 2);
  assert.equal((await f.bridge.view()).paidExecution, "blocked_unknown_credit");
  assert.equal((await readRepairPullStatus(f.store, owner, now)).sourceConnected, true);
  assert.equal((await readRepairPullStatus(f.store, owner, now + 2 * KONG_REPAIR_PULL_INTERVAL_MS + 1)).sourceConnected, false);
});
test("invalid source hash, stale source and missing credentials never become a connected source or issue", async () => {
  for (const mode of ["digest", "stale", "credential"] as const) {
    const f = fixture(); if (mode === "digest") f.source.requests[0].payloadSha256 = "b".repeat(64);
    if (mode === "stale") f.source.observedAt = new Date(now - 120001).toISOString();
    let fetched = 0;
    await pullRepairSources({ bridge: f.bridge, store: f.store, owner, token: mode === "credential" ? undefined : token, handoffEnabled: true, now: () => now,
      fetch: (async () => { fetched++; return Response.json({ softwareRepairs: f.source }); }) as typeof fetch });
    assert.equal((await readRepairPullStatus(f.store, owner, now)).sourceConnected, false); assert.equal(f.calls(), 0);
    assert.equal((await f.bridge.view()).entries.length, 0); if (mode === "credential") assert.equal(fetched, 0);
  }
});
test("persistent hook has fixed bounded cadence, one in-flight cycle, and disabled/stop really stop", async () => {
  let interval!: () => void, calls = 0, cleared = 0, finish!: () => void;
  const stop = createRepairPullLoop({ enabled: true, run: async () => { calls++; await new Promise<void>(resolve => { finish = resolve; }); },
    setInterval: (callback, ms) => { assert.equal(ms, 900000); interval = callback; return 1; }, clearInterval: () => { cleared++; } });
  interval(); interval(); assert.equal(calls, 1); finish(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  stop(); interval(); assert.equal(calls, 1); assert.equal(cleared, 1);
  createRepairPullLoop({ enabled: false, run: async () => { throw Error("must not run"); }, setInterval: () => { throw Error("must not schedule"); }, clearInterval() {} })();
});
test("outstanding and daily private issue caps retain additional repairs durably without dispatch", async () => {
  const f = fixture();
  for (let index = 0; index < 4; index++) {
    const payload = { ...structuredClone(f.source.requests[0].payload), sourceTaskId: randomUUID(), errorId: randomUUID() };
    const key = repairKey(payload), stamp = new Date(now).toISOString();
    await f.bridge.receive({ schemaVersion: "1", eventType: "software_repair_request", eventId: randomUUID(), correlationId: payload.sourceTaskId, taskId: payload.sourceTaskId, issuedAt: stamp, expiresAt: new Date(now + 300000).toISOString(), nonce: randomUUID(), idempotencyKey: key, payload });
    const entry = await f.bridge.dispatch(key); assert.equal(entry.status, index < 3 ? "handoff_created" : "blocked_handoff_capacity");
  }
  assert.equal(f.calls(), 3); assert.equal((await f.bridge.view()).entries.length, 4);
});

test("pull-only mode synchronizes at most three exact currently reported repair keys without HMAC", async () => {
  const f = fixture(), calls: Array<[string, boolean | undefined]> = [];
  const entries = [] as Awaited<ReturnType<typeof f.bridge.view>>["entries"];
  for (let index = 0; index < 4; index++) {
    const payload = { ...structuredClone(f.source.requests[0].payload), sourceTaskId: randomUUID(), errorId: randomUUID() };
    entries.push({ key: repairKey(payload), payload, payloadHash: createHash("sha256").update(canonicalRepairJson(payload)).digest("hex"), eventId: randomUUID(), nonce: randomUUID(), status: "handoff_created", receivedAt: new Date(now).toISOString(), issueUrl: `https://github.com/${KONG_REPAIR_REPOSITORY}/issues/${index + 1}` });
  }
  f.source.requests = entries.slice(0, 3).map(entry => ({ key: entry.key, payloadSha256: entry.payloadHash, payload: entry.payload as typeof f.source.requests[0]["payload"] })); f.source.total = 3;
  const bridge = { ...f.bridge, view: async () => ({ entries, paidExecution: "blocked_unknown_credit" as const, subscriptionProviderCalls: false, makerConsumer: "pending_no_maker" }),
    sync: async (key?: string, refresh?: boolean) => { calls.push([key!, refresh]); return []; } };
  await pullRepairSources({ bridge, store: f.store, owner, token, handoffEnabled: false, now: () => now, fetch: (async () => Response.json({ softwareRepairs: f.source })) as typeof fetch });
  assert.deepEqual(calls, entries.slice(0, 3).map(entry => [entry.key, false]));
});

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
test("a cold initial store read retries before the first HTTP read instead of waiting fifteen minutes", async () => {
  const f = fixture(); let cold = true, calls = 0, fetches = 0; const waits: number[] = [];
  const store = { ...f.store, read: async (key: string) => { if (cold) { cold = false; throw Error("fixture database starting"); } return f.store.read(key); } };
  const stop = createRepairPullLoop({ enabled: true, setInterval: () => 1, clearInterval() {}, waitBeforeRetry: async ms => { waits.push(ms); },
    run: () => { calls++; return pullRepairSources({ bridge: f.bridge, store, owner, token, handoffEnabled: false, now: () => now,
      fetch: (async () => { fetches++; return Response.json({ softwareRepairs: f.source }); }) as typeof fetch }); } });
  await settle(); stop();
  assert.equal(calls, 2); assert.deepEqual(waits, [1000]); assert.equal(fetches, 1); assert.equal(f.calls(), 0);
  assert.equal((await readRepairPullStatus(store, owner, now)).sourceConnected, true);
  assert.equal((await f.bridge.view()).entries.length, 1); assert.equal((await f.bridge.view()).paidExecution, "blocked_unknown_credit");
});
test("failure of the initial metadata transaction is retryable before HTTP and creates one source entry", async () => {
  const f = fixture(); let cold = true, fetches = 0; const waits: number[] = [];
  const store = { ...f.store, transact: async (key: string, change: (raw: string | null) => Promise<string>) => {
    if (cold) { cold = false; throw Error("fixture first metadata transaction unavailable"); } return f.store.transact(key, change);
  } };
  const stop = createRepairPullLoop({ enabled: true, setInterval: () => 1, clearInterval() {}, waitBeforeRetry: async ms => { waits.push(ms); },
    run: () => pullRepairSources({ bridge: f.bridge, store, owner, token, handoffEnabled: false, now: () => now,
      fetch: (async () => { fetches++; return Response.json({ softwareRepairs: f.source }); }) as typeof fetch }) });
  await settle(); stop(); assert.deepEqual(waits, [1000]); assert.equal(fetches, 1); assert.equal((await f.bridge.view()).entries.length, 1);
});
test("persistent initialization failure has exactly two bounded delays, normal cadence and no HTTP request", async () => {
  let calls = 0, fetches = 0, interval!: () => void; const waits: number[] = [];
  const f = fixture(), store = { ...f.store, read: async () => { throw Error("fixture unavailable"); } };
  const stop = createRepairPullLoop({ enabled: true, setInterval: (callback, ms) => { assert.equal(ms, 900000); interval = callback; return 1; }, clearInterval() {},
    waitBeforeRetry: async ms => { waits.push(ms); }, run: () => { calls++; return pullRepairSources({ bridge: f.bridge, store, owner, token, handoffEnabled: true, now: () => now,
      fetch: (async () => { fetches++; throw Error("must not fetch"); }) as typeof fetch }); } });
  await settle(); assert.equal(calls, 3); assert.deepEqual(waits, [...KONG_REPAIR_PULL_STARTUP_RETRY_MS]); assert.equal(fetches, 0); assert.equal(f.calls(), 0);
  stop(); interval(); await settle(); assert.equal(calls, 3);
});
test("a failure after HTTP and GitHub handoff is never fast-retried or re-dispatched", async () => {
  const f = fixture(); let calls = 0, fetches = 0, metadataWrites = 0; const waits: number[] = [];
  const store = { ...f.store, transact: async (key: string, change: (raw: string | null) => Promise<string>) => {
    if (key.includes("kong-repair-pull-v1") && ++metadataWrites >= 3) throw Error("fixture post-handoff persistence unconfirmed");
    return f.store.transact(key, change);
  } };
  const stop = createRepairPullLoop({ enabled: true, setInterval: () => 1, clearInterval() {}, waitBeforeRetry: async ms => { waits.push(ms); },
    run: () => { calls++; return pullRepairSources({ bridge: f.bridge, store, owner, token, handoffEnabled: true, now: () => now,
      fetch: (async () => { fetches++; return Response.json({ softwareRepairs: f.source }); }) as typeof fetch }); } });
  await settle(); stop(); assert.equal(calls, 1); assert.equal(fetches, 1); assert.equal(f.calls(), 1); assert.deepEqual(waits, []);
  assert.equal((await f.bridge.view()).entries.length, 1);
});
test("an ordinary error with the initialization code cannot grant retry authority", async () => {
  let calls = 0; const waits: number[] = [];
  const stop = createRepairPullLoop({ enabled: true, setInterval: () => 1, clearInterval() {}, waitBeforeRetry: async ms => { waits.push(ms); },
    run: async () => { calls++; throw Error("REPAIR_PULL_INITIALIZATION_UNCONFIRMED"); } });
  await settle(); stop(); assert.equal(calls, 1); assert.deepEqual(waits, []);
});
test("stop during initialization backoff prevents retries and concurrent interval ticks", async () => {
  let calls = 0, interval!: () => void, release!: () => void;
  const stop = createRepairPullLoop({ enabled: true, setInterval: callback => { interval = callback; return 1; }, clearInterval() {},
    waitBeforeRetry: () => new Promise<void>(resolve => { release = resolve; }), run: async () => { calls++; throw new RepairPullInitializationError(); } });
  await settle(); interval(); assert.equal(calls, 1); stop(); release(); await settle(); assert.equal(calls, 1);
});
