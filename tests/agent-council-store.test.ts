import test from "node:test";
import assert from "node:assert/strict";
import { createCouncilStore, type CouncilPool } from "../server/agent-council-store";

function harness() {
  const rows = new Map<string, unknown>();
  const calls: string[] = [];
  let released = 0;
  let queue = Promise.resolve();
  const pool: CouncilPool = { async connect() {
    let unlock: (() => void) | undefined;
    let pending: [string, unknown] | undefined;
    return {
      async query(sql, values = []) {
        calls.push(sql);
        if (sql.includes("pg_advisory")) {
          const before = queue;
          queue = new Promise<void>(resolve => { unlock = resolve; });
          await before;
        }
        if (sql.startsWith("SELECT state")) return { rows: rows.has(String(values[0])) ? [{ state: rows.get(String(values[0])) }] : [] };
        if (sql.startsWith("INSERT")) pending = [String(values[0]), JSON.parse(String(values[1]))];
        if (sql === "COMMIT") { if (pending) rows.set(...pending); unlock?.(); }
        if (sql === "ROLLBACK") unlock?.();
        return { rows: [] };
      },
      release() { released++; },
    };
  } };
  return { pool, calls, rows, releases: () => released };
}

test("independent stores serialize updates and survive recreation", async () => {
  const h = harness();
  const a = createCouncilStore(h.pool), b = createCouncilStore(h.pool);
  const increment = async (raw: string | null) => JSON.stringify({ count: (raw ? JSON.parse(raw).count : 0) + 1 });
  await Promise.all([a.transact("owner", increment), b.transact("owner", increment)]);
  assert.deepEqual(JSON.parse((await createCouncilStore(h.pool).read("owner"))!), { count: 2 });
  assert.equal(await a.read("other"), null);
  assert.equal(h.releases(), 4);
  assert.equal(h.calls.filter(c => c.includes("pg_advisory")).length, 2);
});

test("failed transition rolls back and releases without replacing state", async () => {
  const h = harness(), store = createCouncilStore(h.pool);
  await store.transact("owner", async () => '{"count":1}');
  await assert.rejects(store.transact("owner", async () => { throw new Error("evaluation failed"); }), /evaluation failed/);
  assert.deepEqual(JSON.parse((await store.read("owner"))!), { count: 1 });
  assert.ok(h.calls.includes("ROLLBACK"));
  assert.equal(h.releases(), 3);
});

test("database outage is propagated instead of manufacturing empty state", async () => {
  const store = createCouncilStore({ async connect() { throw new Error("database unavailable"); } });
  await assert.rejects(store.read("owner"), /database unavailable/);
  await assert.rejects(store.transact("owner", async () => '{}'), /database unavailable/);
});

function lockTimeoutPool(failures: number) {
  const rows = new Map<string, unknown>();
  let lockAttempts = 0, updates = 0;
  const pool: CouncilPool = { async connect() {
    let pending: [string, unknown] | undefined;
    return {
      async query(sql, values = []) {
        if (sql.includes("pg_advisory") && ++lockAttempts <= failures) {
          throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
        }
        if (sql.startsWith("SELECT state")) return { rows: rows.has(String(values[0])) ? [{ state: rows.get(String(values[0])) }] : [] };
        if (sql.startsWith("INSERT")) pending = [String(values[0]), JSON.parse(String(values[1]))];
        if (sql === "COMMIT" && pending) rows.set(...pending);
        return { rows: [] };
      },
      release() {},
    };
  } };
  return { pool, lockAttempts: () => lockAttempts, countUpdate: () => updates++ };
}

test("a lock timeout before the update is retried once the other writer finishes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = lockTimeoutPool(1), store = createCouncilStore(h.pool);
  const pending = store.transact("owner", async () => { h.countUpdate(); return '{"count":1}'; });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(20_000);
  assert.equal(await pending, '{"count":1}');
  assert.equal(h.lockAttempts(), 2);
  assert.equal(h.countUpdate(), 1, "the update ran exactly once");
});

test("persistent lock contention still fails after bounded retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = lockTimeoutPool(99), store = createCouncilStore(h.pool);
  const pending = assert.rejects(store.transact("owner", async () => '{}'), (error: any) => error.code === "55P03");
  for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(20_000); }
  await pending;
  assert.equal(h.lockAttempts(), 4);
});

test("a lock timeout raised after the update started is never retried", async () => {
  const store = createCouncilStore({ async connect() { return {
    async query(sql) { if (sql.startsWith("INSERT")) throw Object.assign(new Error("lock timeout"), { code: "55P03" }); return { rows: [] }; },
    release() {},
  }; } });
  let updates = 0;
  await assert.rejects(store.transact("owner", async () => { updates++; return '{}'; }), (error: any) => error.code === "55P03");
  assert.equal(updates, 1);
});

test("every council transaction caps idle-in-transaction so a stalled holder cannot block other writers", async () => {
  const calls: string[] = [];
  const pool: CouncilPool = { async connect() { return { async query(sql: string) { calls.push(sql); return { rows: [] }; }, release() {} }; } };
  await createCouncilStore(pool).transact("owner-1", async () => "{}");
  const idx = calls.findIndex(sql => /SET LOCAL idle_in_transaction_session_timeout = '30000ms'/.test(sql));
  assert.ok(idx > calls.indexOf("BEGIN") && idx < calls.findIndex(sql => sql.includes("pg_advisory")), calls.join(" | "));
});
