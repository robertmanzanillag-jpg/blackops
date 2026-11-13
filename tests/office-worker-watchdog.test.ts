import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOfficeCloudWorker } from "../server/office-cloud-runtime";
import type { OfficeCloudRun, officeCloudStore } from "../server/office-cloud-store";

test("watchdog expires hung execution without a second claim or a fake readiness heartbeat", async () => {
  let clock = Date.parse("2026-11-05T03:00:00Z");
  const lease = clock + 30_000;
  const run: OfficeCloudRun = { id: randomUUID(), key: randomUUID(), kind: "claude_chat", message: "Question", status: "pending", createdAt: new Date(clock).toISOString() };
  let heartbeats = 0; let claims = 0; let executions = 0; let completions = 0; let expirySweeps = 0;
  let started!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const hanging = new Promise<void>(resolve => { release = resolve; });
  const store = {
    markExpiredUnknown: async () => { expirySweeps++; if (run.status === "running" && clock >= lease) { run.status = "unknown"; return 1; } return 0; },
    heartbeat: async (workerId: string) => { heartbeats++; return { workerId, lastSeenAt: new Date(clock).toISOString() }; },
    claim: async (workerId: string) => { claims++; run.status = "running"; return { ...run, workerId, fence: randomUUID(), leaseExpiresAt: new Date(lease).toISOString() }; },
    complete: async () => { completions++; return undefined; },
  } as unknown as typeof officeCloudStore;
  const providerProbe = async () => ({ status: "ready" as const, reason: "Verified", checkedAt: new Date(clock).toISOString() });
  const worker = createOfficeCloudWorker({ store, now: () => new Date(clock), probeClaude: providerProbe, probeKong: providerProbe, execute: async () => {
    executions++; started(); await hanging; return { text: "Late response", sessionId: "late-session" };
  } });
  const tick = worker.tick();
  await entered;
  assert.equal(heartbeats, 1);
  clock = lease;
  await worker.maintain();
  assert.equal(run.status, "unknown");
  assert.equal(heartbeats, 1);
  await worker.refreshCapabilities();
  assert.equal(heartbeats, 1, "a new provider probe cannot advertise a hung worker as ready");
  await Promise.all([worker.tick(), worker.tick()]);
  assert.equal(claims, 1); assert.equal(executions, 1);
  release();
  await assert.rejects(tick, /OUTLIVED_LEASE/);
  assert.equal(completions, 0, "late results must not overwrite unknown evidence");
  assert.ok(expirySweeps >= 3);
  await worker.maintain();
  await worker.tick();
  assert.equal(heartbeats, 1, "a stalled worker remains quarantined until restart");
  assert.equal(claims, 1);
});

for (const hungStep of ["sweep", "claim"] as const) test(`an overdue admission ${hungStep} never advertises readiness or executes a late claim`, async () => {
  let clock = Date.parse("2026-11-05T03:00:00Z");
  let release!: () => void; let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let sweeps = 0; let claims = 0; let heartbeats = 0; let executions = 0;
  const store = {
    markExpiredUnknown: async () => {
      sweeps++;
      if (hungStep === "sweep" && sweeps === 1) { entered(); await held; }
      return 0;
    },
    heartbeat: async (workerId: string) => { heartbeats++; return { workerId, lastSeenAt: new Date(clock).toISOString() }; },
    claim: async () => {
      claims++;
      if (hungStep === "claim") { entered(); await held; }
      return { id: randomUUID(), key: randomUUID(), kind: "claude_chat", message: "Question", status: "running", createdAt: new Date(clock).toISOString(), leaseExpiresAt: new Date(clock + 300_000).toISOString() };
    },
  } as unknown as typeof officeCloudStore;
  const worker = createOfficeCloudWorker({ store, now: () => new Date(clock), execute: async () => { executions++; return { text: "Unexpected" }; } });
  const tick = worker.tick();
  await started;
  const before = heartbeats;
  clock += 30_001;
  await worker.maintain();
  await worker.heartbeat();
  await worker.tick();
  assert.equal(heartbeats, before);
  release();
  await assert.rejects(tick, /PROGRESS_STALLED/);
  assert.equal(executions, 0);
  await worker.tick(); await worker.maintain();
  assert.equal(claims, hungStep === "claim" ? 1 : 0, "a late DB result cannot reset the guard or start another claim");
  assert.equal(heartbeats, before);
});

test("an invalid claimed lease prevents provider execution", async () => {
  let executions = 0;
  const store = {
    markExpiredUnknown: async () => 0,
    heartbeat: async (workerId: string) => ({ workerId, lastSeenAt: new Date().toISOString() }),
    claim: async () => ({ id: randomUUID(), key: randomUUID(), kind: "claude_chat", message: "Question", status: "running", createdAt: new Date().toISOString(), leaseExpiresAt: "invalid" }),
  } as unknown as typeof officeCloudStore;
  const worker = createOfficeCloudWorker({ store, execute: async () => { executions++; return { text: "Unexpected" }; } });
  await assert.rejects(worker.tick(), /LEASE_UNVERIFIED/);
  assert.equal(executions, 0);
});
