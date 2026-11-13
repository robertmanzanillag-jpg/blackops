import assert from "node:assert/strict";
import test from "node:test";
import {
  createRevenueEngineStateStore,
  type RevenueEngineStateAdapter,
  type RevenueEngineStateCollection,
} from "../server/revenue-engine-state-store";

function createMemoryAdapter() {
  const rows = new Map<string, RevenueEngineStateCollection>();
  let initializeCalls = 0;
  let healthCalls = 0;

  const adapter: RevenueEngineStateAdapter = {
    async initialize() {
      initializeCalls += 1;
    },
    async loadCollections(ownerUserId) {
      return [...rows.values()].filter((row) => row.ownerUserId === ownerUserId);
    },
    async upsertCollection(input) {
      const key = `${input.ownerUserId}:${input.kind}`;
      const current = rows.get(key);
      if ((!current && input.expectedRevision !== undefined)
        || (current && input.expectedRevision !== current.revision)) {
        throw new Error(`state conflict for ${key}`);
      }
      const row: RevenueEngineStateCollection = {
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        data: input.data,
        revision: (current?.revision || 0) + 1,
        updatedAt: input.updatedAt,
      };
      rows.set(key, row);
      return row;
    },
    async health() {
      healthCalls += 1;
    },
  };

  return {
    adapter,
    rows,
    initializeCalls: () => initializeCalls,
    healthCalls: () => healthCalls,
  };
}

test("initializes once and loads only the requested user's collections", async () => {
  const memory = createMemoryAdapter();
  const store = createRevenueEngineStateStore(memory.adapter);

  await Promise.all([store.initialize(), store.initialize()]);
  await store.upsertCollection({ ownerUserId: "owner-a", kind: "leads", data: [{ id: "lead-1" }] });
  await store.upsertCollection({ ownerUserId: "owner-b", kind: "leads", data: [{ id: "lead-2" }] });

  const rows = await store.loadCollections<Array<{ id: string }>>("owner-a");
  assert.equal(memory.initializeCalls(), 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ownerUserId, "owner-a");
  assert.deepEqual(rows[0].data, [{ id: "lead-1" }]);

  const health = await store.health();
  assert.deepEqual(health, { status: "ready", initialized: true, pendingWrites: 0 });
  assert.equal(memory.healthCalls(), 1);
});

test("queues upserts and makes load wait for queued writes", async () => {
  const memory = createMemoryAdapter();
  const calls: string[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const originalUpsert = memory.adapter.upsertCollection;
  memory.adapter.upsertCollection = async (input) => {
    calls.push(`start:${input.kind}`);
    if (input.kind === "first") await firstBlocked;
    const row = await originalUpsert(input);
    calls.push(`end:${input.kind}`);
    return row;
  };

  const store = createRevenueEngineStateStore(memory.adapter);
  const first = store.upsertCollection({ ownerUserId: "owner-a", kind: "first", data: [1] });
  const second = store.upsertCollection({ ownerUserId: "owner-a", kind: "second", data: [2] });
  const load = store.loadCollections("owner-a");

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["start:first"]);
  releaseFirst();
  await Promise.all([first, second]);

  const loaded = await load;
  assert.deepEqual(calls, ["start:first", "end:first", "start:second", "end:second"]);
  assert.deepEqual(loaded.map((row) => row.kind), ["first", "second"]);
});

test("upsert replaces a collection with the same owner and kind", async () => {
  const memory = createMemoryAdapter();
  const store = createRevenueEngineStateStore(memory.adapter);

  await store.upsertCollection({ ownerUserId: "owner-a", kind: "ledger", data: [{ amount: 10 }] });
  await store.upsertCollection({ ownerUserId: "owner-a", kind: "ledger", data: [{ amount: 25 }] });

  const rows = await store.loadCollections<Array<{ amount: number }>>("owner-a");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].data, [{ amount: 25 }]);
  assert.equal(rows[0].revision, 2);
});

test("rejects a stale writer instead of overwriting a newer collection", async () => {
  const memory = createMemoryAdapter();
  const firstStore = createRevenueEngineStateStore(memory.adapter);
  const staleStore = createRevenueEngineStateStore(memory.adapter);

  await firstStore.upsertCollection({ ownerUserId: "owner-a", kind: "ledger", data: [{ amount: 10 }] });
  await staleStore.loadCollections("owner-a");
  await firstStore.upsertCollection({ ownerUserId: "owner-a", kind: "ledger", data: [{ amount: 20 }] });

  await assert.rejects(
    staleStore.upsertCollection({ ownerUserId: "owner-a", kind: "ledger", data: [{ amount: 15 }] }),
    /state conflict/,
  );
  assert.deepEqual(memory.rows.get("owner-a:ledger")?.data, [{ amount: 20 }]);
});

test("a failed upsert rejects without poisoning the write queue", async () => {
  const memory = createMemoryAdapter();
  const originalUpsert = memory.adapter.upsertCollection;
  let failNext = true;
  memory.adapter.upsertCollection = async (input) => {
    if (failNext) {
      failNext = false;
      throw new Error("database unavailable");
    }
    return originalUpsert(input);
  };
  const store = createRevenueEngineStateStore(memory.adapter);

  await assert.rejects(
    store.upsertCollection({ ownerUserId: "owner-a", kind: "leads", data: [] }),
    /database unavailable/,
  );
  await assert.rejects(store.flush(), /durable write failed.*database unavailable/);
  await store.upsertCollection({ ownerUserId: "owner-a", kind: "ledger", data: [{ amount: 5 }] });
  await store.flush();

  const rows = await store.loadCollections("owner-a");
  assert.deepEqual(rows.map((row) => row.kind), ["ledger"]);
  assert.equal((await store.health()).status, "ready");
});

test("health reports initialization errors and initialization can retry", async () => {
  const memory = createMemoryAdapter();
  let failInitialization = true;
  memory.adapter.initialize = async () => {
    if (failInitialization) throw new Error("state table unavailable");
  };
  const store = createRevenueEngineStateStore(memory.adapter);

  assert.deepEqual(await store.health(), {
    status: "error",
    initialized: false,
    pendingWrites: 0,
    error: "state table unavailable",
  });

  failInitialization = false;
  assert.deepEqual(await store.health(), {
    status: "ready",
    initialized: true,
    pendingWrites: 0,
  });
});
