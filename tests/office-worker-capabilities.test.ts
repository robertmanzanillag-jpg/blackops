import test from "node:test";
import assert from "node:assert/strict";
import { createOfficeCloudWorker, probeOfficeWorker } from "../server/office-cloud-runtime";
import type { officeCloudStore, OfficeWorkerCapabilities, OfficeWorkerHeartbeat } from "../server/office-cloud-store";

const now = new Date("2026-11-05T03:00:00Z");
const probe = (status: "ready" | "blocked" = "ready", checkedAt = now.toISOString()) => ({ status, checkedAt, reason: "Checked on worker host" });
const heartbeat = (capabilities?: OfficeWorkerCapabilities, lastSeenAt = now.toISOString()): OfficeWorkerHeartbeat => ({ workerId: "worker-a", lastSeenAt, ...(capabilities ? { capabilities } : {}) });

test("cloud connection status comes from the execution host capability record", async () => {
  const capabilities = { claude: probe(), kong: probe("blocked") };
  const status = await probeOfficeWorker({ getHeartbeat: async () => heartbeat(capabilities) }, () => now);
  assert.equal(status.status, "ready");
  assert.equal(status.capabilities.claude.status, "ready");
  assert.equal(status.capabilities.kong.status, "blocked");
  assert.deepEqual(status.capabilities, capabilities);
});

test("fresh process heartbeats cannot refresh stale provider authentication evidence", async () => {
  const capabilities = { claude: probe("ready", new Date(now.getTime() - 90_001).toISOString()), kong: probe("ready", new Date(now.getTime() + 30_001).toISOString()) };
  const status = await probeOfficeWorker({ getHeartbeat: async () => heartbeat(capabilities) }, () => now);
  assert.equal(status.status, "ready");
  assert.equal(status.capabilities.claude.status, "blocked");
  assert.equal(status.capabilities.kong.status, "blocked");
});

test("missing capabilities, missing workers and stale heartbeats never imply provider readiness", async () => {
  for (const record of [undefined, heartbeat(), heartbeat({ claude: probe(), kong: probe() }, new Date(now.getTime() - 45_001).toISOString())]) {
    const status = await probeOfficeWorker({ getHeartbeat: async () => record }, () => now);
    assert.equal(status.capabilities.claude.status, "blocked");
    assert.equal(status.capabilities.kong.status, "blocked");
  }
});

test("database availability failure blocks all worker capability claims", async () => {
  const status = await probeOfficeWorker({ getHeartbeat: async () => { throw new Error("private database error"); } }, () => now);
  assert.equal(status.status, "blocked");
  assert.equal(status.capabilities.claude.status, "blocked");
  assert.ok(!JSON.stringify(status).includes("private database"));
});

test("worker refresh persists only sanitized probe fields and ordinary heartbeats retain probe time", async () => {
  const payloads: Array<OfficeWorkerCapabilities | undefined> = [];
  let claudeChecks = 0; let kongChecks = 0;
  const store = {
    heartbeat: async (_id: string, value?: OfficeWorkerCapabilities) => { payloads.push(value); return heartbeat(value); },
  } as unknown as typeof officeCloudStore;
  const worker = createOfficeCloudWorker({
    store, execute: async () => { throw new Error("No task should run"); },
    probeClaude: async () => { claudeChecks++; return probe(); },
    probeKong: async () => { kongChecks++; return { ...probe("blocked"), agents: [] }; },
  });
  await Promise.all([worker.refreshCapabilities(), worker.refreshCapabilities()]);
  await worker.heartbeat();
  assert.equal(claudeChecks, 1); assert.equal(kongChecks, 1);
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0], { claude: probe(), kong: probe("blocked") });
  assert.deepEqual(payloads[1], payloads[0]);
  assert.ok(!JSON.stringify(payloads).includes("agents"));
});

test("the scheduler needs an opted-in owner and a recent KONG probe while normal claims continue", async () => {
  const admissions: string[] = [];
  let claims = 0;
  let clock = now.getTime();
  let kongProbe = probe("blocked");
  const store = {
    heartbeat: async () => heartbeat(),
    markExpiredUnknown: async () => 0,
    enqueueScheduledKongAudit: async (owner: string) => { admissions.push(owner); },
    claim: async () => { claims++; return undefined; },
  } as unknown as typeof officeCloudStore;
  const options = { store, now: () => new Date(clock), probeClaude: async () => probe("blocked"), probeKong: async () => kongProbe };
  const worker = createOfficeCloudWorker({ ...options, scheduledKongOwner: "configured-owner" });
  await worker.tick();
  await worker.refreshCapabilities();
  await worker.tick();
  assert.deepEqual(admissions, []);
  kongProbe = probe();
  await worker.refreshCapabilities();
  await worker.tick();
  await worker.tick();
  assert.deepEqual(admissions, ["configured-owner"]);
  clock += 90_001;
  await worker.tick();
  assert.deepEqual(admissions, ["configured-owner"]);
  kongProbe = probe("ready", new Date(clock).toISOString());
  const disabled = createOfficeCloudWorker(options);
  await disabled.refreshCapabilities();
  await disabled.tick();
  assert.deepEqual(admissions, ["configured-owner"]);
  assert.equal(claims, 6);
});

test("scheduled cloud executor between runs stays blocked but states its cadence honestly", async () => {
  const capabilities = { claude: probe(), kong: probe() };
  const cloud = (ageMs: number): OfficeWorkerHeartbeat => ({ workerId: "office-cloud-0f8e2a8c-1d2b-4c3d-9e4f-5a6b7c8d9e0f", lastSeenAt: new Date(now.getTime() - ageMs).toISOString(), capabilities });
  const between = await probeOfficeWorker({ getHeartbeat: async () => cloud(5 * 60_000) }, () => now);
  assert.equal(between.status, "blocked");
  assert.equal(between.capabilities.claude.status, "blocked");
  assert.match(between.reason, /programado.*hace 5 min.*proxima ejecucion/);
  const running = await probeOfficeWorker({ getHeartbeat: async () => cloud(10_000) }, () => now);
  assert.equal(running.status, "ready");
  for (const record of [cloud(30 * 60_000 + 1), { ...cloud(5 * 60_000), workerId: "office-pc" }]) {
    const stale = await probeOfficeWorker({ getHeartbeat: async () => record }, () => now);
    assert.equal(stale.status, "blocked");
    assert.match(stale.reason, /No hay una señal reciente/);
  }
});
