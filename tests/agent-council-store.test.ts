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
