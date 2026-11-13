import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createOfficeCloudSchemaSql, createOfficeCloudStore, OfficeCloudStoreError, type OfficeCloudPool, type OfficeCloudClient, type OfficeCloudQueryResult } from "../server/office-cloud-store";

// Deterministic contract driver, not PostgreSQL integration. It verifies bound
// parameters, transaction ordering, fencing, and no-retry transitions. Real
// PostgreSQL locking and migration execution require a staging database test.
class ContractPool implements OfficeCloudPool {
  rows: Record<string, unknown>[] = [];
  calls: { sql: string; parameters: unknown[] }[] = [];
  heartbeats = new Map<string, string>();
  workerCapabilities = new Map<string, unknown>();
  time = Date.now();
  failNext = false;
  private pending: Promise<void> = Promise.resolve();
  async connect(): Promise<OfficeCloudClient> {
    let unlock: (() => void) | undefined;
    return {
      query: async (sql, parameters = []) => {
        if (sql === "BEGIN") {
          const predecessor = this.pending;
          this.pending = new Promise<void>(resolve => { unlock = resolve; });
          await predecessor;
        }
        try { return await this.query(sql, parameters); }
        finally { if (sql === "COMMIT" || sql === "ROLLBACK") { unlock?.(); unlock = undefined; } }
      },
      release: () => { unlock?.(); unlock = undefined; },
    };
  }
  async query(sql: string, parameters: unknown[] = []): Promise<OfficeCloudQueryResult> {
    this.calls.push({ sql, parameters });
    if (this.failNext && !["BEGIN", "ROLLBACK"].includes(sql)) { this.failNext = false; throw new Error("database-password-supersecret"); }
    const copy = (rows: Record<string, unknown>[]) => ({ rows: JSON.parse(JSON.stringify(rows)), rowCount: rows.length });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("office:owner-lock")) return copy([]);
    if (sql.includes("office:find-key")) return copy(this.rows.filter(row => row.owner_key === parameters[0] && row.idempotency_key === parameters[1]));
    if (sql.includes("office:kong-schedule-slot")) return copy([{ slot: String(Math.floor(this.time / 240_000)) }]);
    if (sql.includes("office:kong-schedule-retention")) {
      assert.match(sql, /input->>'source'='scheduled'/);
      this.rows = this.rows.filter(row => row.owner_key !== parameters[0] || (row.input as { source?: string }).source !== "scheduled" ||
        ["pending", "running"].includes(String(row.status)) || Date.parse(String(row.created_at)) >= this.time - 86_400_000);
      return copy([]);
    }
    if (sql.includes("office:submit") || sql.includes("office:kong-schedule*/")) {
      const [id, owner_key, idempotency_key, request_hash, input] = parameters;
      if (sql.includes("office:kong-schedule*/") && this.rows.some(row => {
        const task = row.input as { kind: string; source?: string };
        return row.owner_key === owner_key && task.kind === "kong_audit" && (["pending", "running"].includes(String(row.status)) ||
          (task.source === "scheduled" && Date.parse(String(row.created_at)) > this.time - 180_000));
      })) return copy([]);
      if (this.rows.some(row => row.owner_key === owner_key && row.idempotency_key === idempotency_key)) return copy([]);
      const row = { id, owner_key, idempotency_key, request_hash, input: JSON.parse(input as string), status: "pending", created_at: new Date(this.time++).toISOString() };
      this.rows.push(row); return copy([row]);
    }
    if (sql.includes("office:claim")) {
      assert.match(sql, /FOR UPDATE SKIP LOCKED/); assert.match(sql, /status\s*=\s*'pending'/);
      assert.match(sql, /owner_key=\$4 AND input->>'kind'='claude_review'/);
      const row = this.rows.find(item => item.status === "pending" && (!parameters[3] || (item.owner_key === parameters[3] && (item.input as any).kind === "claude_review")));
      if (!row) return copy([]);
      Object.assign(row, { status: "running", worker_id: parameters[0], fence: parameters[1], lease_expires_at: new Date(this.time + Number(parameters[2])).toISOString(), started_at: new Date(this.time).toISOString() });
      return copy([row]);
    }
    if (sql.includes("office:release-unstarted")) {
      const row = this.rows.find(item => item.id === parameters[0] && item.worker_id === parameters[1] && item.fence === parameters[2] && item.status === "running" && Date.parse(String(item.lease_expires_at)) > this.time);
      if (!row) return copy([]);
      Object.assign(row, { status: "pending", worker_id: null, fence: null, lease_expires_at: null, started_at: null }); return copy([row]);
    }
    if (sql.includes("office:complete")) {
      assert.match(sql, /worker_id=\$2 AND fence=\$3 AND status='running' AND lease_expires_at > CURRENT_TIMESTAMP/);
      const row = this.rows.find(item => item.id === parameters[0] && item.worker_id === parameters[1] && item.fence === parameters[2] && item.status === "running" && Date.parse(String(item.lease_expires_at)) > this.time);
      if (!row) return copy([]);
      Object.assign(row, { status: parameters[3], result: JSON.parse(String(parameters[4])), completed_at: new Date(this.time).toISOString() }); return copy([row]);
    }
    if (sql.includes("office:expire")) {
      assert.match(sql, /status='unknown'/); assert.match(sql, /WHERE status='running' AND lease_expires_at <= CURRENT_TIMESTAMP/);
      const expired = this.rows.filter(row => row.status === "running" && Date.parse(String(row.lease_expires_at)) <= this.time);
      for (const row of expired) Object.assign(row, { status: "unknown", completed_at: new Date(this.time).toISOString(), result: { status: "unknown", error: { code: "LEASE_EXPIRED", reason: "Uncertain; no retry" } } });
      return copy(expired);
    }
    if (sql.includes("office:list")) {
      assert.match(sql, /WHERE owner_key=\$1/);
      const owned = this.rows.filter(row => row.owner_key === parameters[0]).reverse();
      const scheduled = (row: Record<string, unknown>) => (row.input as { source?: string }).source === "scheduled";
      return copy([...owned.filter(row => !scheduled(row)).slice(0, 200), ...owned.filter(scheduled).slice(0, 3)]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
    }
    if (sql.includes("office:heartbeat")) {
      const id = String(parameters[0]);
      this.heartbeats.set(id, new Date(this.time++).toISOString());
      if (parameters[1]) this.workerCapabilities.set(id, JSON.parse(String(parameters[1])));
      return copy([{ id, last_seen_at: this.heartbeats.get(id), capabilities: this.workerCapabilities.get(id) }]);
    }
    if (sql.includes("office:get-heartbeat")) return copy([...this.heartbeats].sort((a, b) => b[1].localeCompare(a[1])).slice(0, 1).map(([id, last_seen_at]) => ({ id, last_seen_at, capabilities: this.workerCapabilities.get(id) })));
    throw new Error(`unexpected query: ${sql}`);
  }
}
const input = () => ({ kind: "claude_chat" as const, message: "Review my task", key: randomUUID() });

test("review-only claims preserve other owners and task kinds; unstarted admission is fenced", async () => {
  const pool = new ContractPool(); const store = createOfficeCloudStore({ pool });
  await store.submit("owner", { kind: "kong_audit", key: randomUUID() });
  await store.submit("other", { kind: "claude_review", key: randomUUID(), prUrl: "https://github.com/a/b/pull/1" });
  const wanted = await store.submit("owner", { kind: "claude_review", key: randomUUID(), prUrl: "https://github.com/a/b/pull/1" });
  const task = (await store.claim("worker", { ownerId: "owner", reviewOnly: true }))!;
  assert.equal(task.id, wanted.id);
  assert.equal(await store.releaseUnstarted(task.id, "wrong", task.fence!), false);
  assert.equal(await store.releaseUnstarted(task.id, "worker", task.fence!), true);
  const next = (await store.claim("worker", { ownerId: "owner", reviewOnly: true }))!;
  assert.notEqual(next.fence, task.fence);
  assert.equal(await store.releaseUnstarted(task.id, "worker", task.fence!), false);
  assert.equal(pool.rows.filter(r => r.status === "pending").length, 2);
});

test("recurring audits use one database slot across workers, preserve fences and avoid backlog", async () => {
  const pool = new ContractPool();
  pool.time = 240_000_000;
  const store = createOfficeCloudStore({ pool });
  const restarted = createOfficeCloudStore({ pool });
  await Promise.all([store.enqueueScheduledKongAudit("owner"), restarted.enqueueScheduledKongAudit("owner")]);
  const first = (await store.claim("worker-1"))!;
  assert.equal(first.source, "scheduled");
  assert.equal(first.kind, "kong_audit");
  assert.equal(await restarted.claim("worker-2"), undefined);
  assert.equal((await store.complete(first.id, "worker-1", first.fence!, { status: "completed", text: "Confirmed" }))?.source, "scheduled");
  pool.time += 181_000;
  await restarted.enqueueScheduledKongAudit("owner");
  assert.equal(pool.rows.length, 1, "a restart cannot create another audit in the same slot");
  pool.time += 60_000;
  await restarted.enqueueScheduledKongAudit("owner");
  pool.time += 600_000;
  await restarted.enqueueScheduledKongAudit("owner");
  assert.equal(pool.rows.length, 2, "pending audit prevents accumulation across slots");
  assert.deepEqual(await store.list("other"), []);
  await assert.rejects(store.submit("owner", { kind: "kong_audit", key: randomUUID(), source: "scheduled" } as never), /tarea/);
});

test("prepared migration has permanent owner/key uniqueness and lease indexes; no automatic DDL", async () => {
  const sql = createOfficeCloudSchemaSql();
  assert.match(sql, /UNIQUE \(owner_key, idempotency_key\)/);
  assert.match(sql, /WHERE status = 'pending'/); assert.match(sql, /office_agent_workers/);
  const pool = new ContractPool(); createOfficeCloudStore({ pool });
  assert.equal(pool.calls.length, 0);
});

test("same request is durable/idempotent under concurrent admissions, mismatch conflicts", async () => {
  const pool = new ContractPool(); const store = createOfficeCloudStore({ pool }); const task = input();
  const runs = await Promise.all(Array.from({ length: 12 }, () => store.submit("owner", task)));
  assert.equal(new Set(runs.map(run => run.id)).size, 1); assert.equal(pool.rows.length, 1);
  await assert.rejects(store.submit("owner", { ...task, message: "Changed" }), (error: unknown) => error instanceof OfficeCloudStoreError && error.code === "IDEMPOTENCY_CONFLICT");
  const insert = pool.calls.find(call => call.sql.includes("office:submit"))!;
  assert.ok(!insert.sql.includes(task.message)); assert.equal(JSON.parse(String(insert.parameters[4])).message, task.message);
  assert.ok(pool.calls.some(call => call.sql.includes("pg_advisory_xact_lock")));
  assert.ok(pool.calls.some(call => call.sql === "ROLLBACK"));
});

test("owner reads and idempotency namespaces stay isolated", async () => {
  const pool = new ContractPool(); const store = createOfficeCloudStore({ pool }); const task = input();
  const first = await store.submit("alice/../../bob", task); const second = await store.submit("bob", task);
  assert.notEqual(first.id, second.id);
  assert.deepEqual((await store.list("alice/../../bob")).map(run => run.id), [first.id]);
  assert.deepEqual(await store.list("other"), []);
  assert.ok(pool.rows.every(row => /^[a-f0-9]{64}$/.test(String(row.owner_key))));
});

test("claim commits running intent before caller execution and fences completion", async () => {
  const pool = new ContractPool(); const store = createOfficeCloudStore({ pool, leaseMs: 180000 });
  const submitted = await store.submit("owner", input()); const claimed = await store.claim("worker-1");
  assert.equal(claimed?.id, submitted.id); assert.equal(claimed?.status, "running"); assert.ok(claimed?.fence);
  assert.equal(pool.calls.at(-1)?.sql, "COMMIT");
  assert.equal(await store.claim("worker-2"), undefined);
  assert.equal(await store.complete(claimed!.id, "worker-2", claimed!.fence!, { status: "completed", text: "Result" }), undefined);
  assert.equal(await store.complete(claimed!.id, "worker-1", randomUUID(), { status: "completed", text: "Result" }), undefined);
  const done = await store.complete(claimed!.id, "worker-1", claimed!.fence!, { status: "completed", text: "Verified result", sessionId: "session-proof" });
  assert.equal(done?.status, "completed"); assert.equal(done?.result?.status, "completed");
  assert.equal(await store.complete(claimed!.id, "worker-1", claimed!.fence!, { status: "completed", text: "Repeat" }), undefined);
});

test("expired claims become terminal unknown, never repeat after process restart", async () => {
  const pool = new ContractPool(); const store = createOfficeCloudStore({ pool, leaseMs: 30000 }); const task = input();
  await store.submit("owner", task); const claim = (await store.claim("worker-1"))!;
  pool.time += 30001;
  assert.equal(await store.complete(claim.id, "worker-1", claim.fence!, { status: "completed", text: "Late" }), undefined);
  assert.equal(await store.markExpiredUnknown(), 1); assert.equal(await store.markExpiredUnknown(), 0);
  const restarted = createOfficeCloudStore({ pool });
  assert.equal((await restarted.submit("owner", task)).status, "unknown");
  assert.equal(await restarted.claim("worker-2"), undefined);
  assert.equal((await restarted.list("owner"))[0].status, "unknown");
});

test("listing 200 rows never deletes permanent idempotency keys", async () => {
  const pool = new ContractPool(); const store = createOfficeCloudStore({ pool }); const firstInput = input();
  const first = await store.submit("owner", firstInput);
  for (let n = 0; n < 200; n++) await store.submit("owner", input());
  assert.equal((await store.list("owner")).length, 200);
  assert.equal(pool.rows.length, 201);
  assert.equal((await store.submit("owner", firstInput)).id, first.id);
  assert.equal(pool.rows.length, 201);
});

test("database errors do not leak driver credentials or silently use local storage", async () => {
  const pool = new ContractPool(); const store = createOfficeCloudStore({ pool }); pool.failNext = true;
  await assert.rejects(store.submit("owner", input()), (error: unknown) => error instanceof OfficeCloudStoreError && error.code === "CLOUD_STORE_NOT_READY" && !error.message.includes("supersecret"));
  assert.equal(pool.rows.length, 0); assert.ok(pool.calls.some(call => call.sql === "ROLLBACK"));
});

test("only strict bounded server result fields can be persisted", async () => {
  const pool = new ContractPool(); const store = createOfficeCloudStore({ pool }); await store.submit("owner", input()); const claim = (await store.claim("worker"))!;
  for (const value of [
    { status: "completed" }, { status: "completed", text: "ok", error: { code: "ERR", reason: "Error" } },
    { status: "completed", text: "ok", extra: "untrusted" }, { status: "failed" },
    { status: "completed", text: "Bearer secret123456789" }, { status: "completed", text: "ok", evidence: { api_key: "secret" } },
    { status: "completed", text: "x".repeat(200001) },
  ]) await assert.rejects(store.complete(claim.id, "worker", claim.fence!, value as never), OfficeCloudStoreError);
  assert.equal((await store.list("owner"))[0].status, "running");
});

test("heartbeat persists worker last-seen without claiming task success", async () => {
  const pool = new ContractPool(); const store = createOfficeCloudStore({ pool });
  assert.equal(await store.getHeartbeat(), undefined);
  const first = await store.heartbeat("worker-a");
  assert.equal(first.workerId, "worker-a");
  await store.heartbeat("worker-b");
  assert.equal((await store.getHeartbeat())?.workerId, "worker-b");
  assert.equal(pool.rows.length, 0);
});

test("worker capability evidence is bounded, credential-free and retains original probe times", async () => {
  const pool = new ContractPool(); const store = createOfficeCloudStore({ pool });
  const checkedAt = new Date(pool.time).toISOString();
  const capabilities = { claude: { status: "ready" as const, reason: "Subscription authenticated", checkedAt }, kong: { status: "blocked" as const, reason: "Administrator connection missing", checkedAt } };
  await store.heartbeat("worker-a", capabilities);
  pool.time += 30_000;
  await store.heartbeat("worker-a");
  const heartbeat = (await store.getHeartbeat())!;
  assert.deepEqual(heartbeat.capabilities, capabilities);
  assert.ok(Date.parse(heartbeat.lastSeenAt) > Date.parse(heartbeat.capabilities!.claude.checkedAt));
  assert.ok(pool.calls.some(call => call.sql.includes("COALESCE(EXCLUDED.capabilities,office_agent_workers.capabilities)")));
  for (const invalid of [
    { ...capabilities, authorization: "secret" },
    { ...capabilities, claude: { ...capabilities.claude, checkedAt: "invalid" } },
    { ...capabilities, claude: { ...capabilities.claude, reason: "Bearer supersecret123456789" } },
    { ...capabilities, kong: { ...capabilities.kong, token: "secret" } },
  ]) await assert.rejects(store.heartbeat("worker-a", invalid as never), (error: unknown) => error instanceof OfficeCloudStoreError && error.code === "INVALID_CAPABILITIES");
  assert.deepEqual((await store.getHeartbeat())!.capabilities, capabilities);
});
