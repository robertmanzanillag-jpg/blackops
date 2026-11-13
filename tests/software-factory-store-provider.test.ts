import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createFactoryStoreProvider } from "../server/software-factory-store-provider";
import { softwareFactoryStore } from "../server/software-factory-store";

function fixture() {
  let postgresCalls = 0, objectCalls = 0, loads = 0;
  const postgres = Object.fromEntries(Object.keys(softwareFactoryStore).map(key => [key, async () => { postgresCalls++; return "postgres"; }])) as unknown as typeof softwareFactoryStore;
  const object = Object.fromEntries(Object.keys(softwareFactoryStore).map(key => [key, async () => { objectCalls++; return "object"; }])) as unknown as typeof softwareFactoryStore;
  const config: { backend?: string; modulePath?: string } = { backend: "object", modulePath: path.resolve("trusted-store.mjs") };
  const options = { configuration: () => config, postgres, loadModule: async (url: string) => { assert.ok(url.startsWith("file:")); loads++; return { createFactoryStore: async () => object }; } };
  return { config, options, object, get counts() { return { postgresCalls, objectCalls, loads }; } };
}

test("web and worker methods share one lazy selected provider under concurrent calls", async () => {
  const f = fixture(), store = createFactoryStoreProvider(f.options);
  await Promise.all([store.status("owner"), store.list("owner"), store.claim("worker")]);
  assert.deepEqual(f.counts, { postgresCalls: 0, objectCalls: 3, loads: 1 });
  f.config.backend = "postgres"; f.config.modulePath = undefined;
  await store.projects("owner");
  assert.deepEqual(f.counts, { postgresCalls: 0, objectCalls: 4, loads: 1 });
});

test("failed object provider is cached and never falls back to PostgreSQL", async () => {
  const f = fixture(); let attempts = 0;
  const store = createFactoryStoreProvider({ ...f.options, loadModule: async () => { attempts++; throw Error("UNAVAILABLE"); } });
  await assert.rejects(store.status("owner"), /UNAVAILABLE/);
  f.config.backend = "postgres"; f.config.modulePath = undefined;
  await assert.rejects(store.claim("worker"), /UNAVAILABLE/);
  assert.equal(attempts, 1); assert.equal(f.counts.postgresCalls, 0);
});

test("partial provider or ambiguous configuration blocks before database use", async () => {
  for (const config of [{ backend: "typo" }, { backend: "object" }, { backend: "object", modulePath: "relative.mjs" }, { modulePath: path.resolve("ignored.mjs") }]) {
    const f = fixture(); const store = createFactoryStoreProvider({ ...f.options, configuration: () => config });
    await assert.rejects(store.status("owner"), /SELECTION_INVALID/);
    assert.equal(f.counts.postgresCalls, 0); assert.equal(f.counts.loads, 0);
  }
  const f = fixture();
  const store = createFactoryStoreProvider({ ...f.options, loadModule: async () => ({ createFactoryStore: async () => ({ status: f.object.status }) }) });
  await assert.rejects(store.status("owner"), /PROVIDER_INVALID/);
  assert.equal(f.counts.postgresCalls, 0);
});

test("legacy PostgreSQL selection loads no external module", async () => {
  const f = fixture(), store = createFactoryStoreProvider({ ...f.options, configuration: () => ({}) });
  await store.status("owner"); assert.deepEqual(f.counts, { postgresCalls: 1, objectCalls: 0, loads: 0 });
});
