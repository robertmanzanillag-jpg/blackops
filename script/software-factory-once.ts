// Dedicated trusted entrypoint: never loads repository .env or arbitrary adapters.
import { runSoftwareFactoryOnce } from "../server/software-factory-once";

async function main() {
  if (process.argv.length !== 2 || process.env.SOFTWARE_FACTORY_ENABLED !== "true" || process.env.AGENT_COUNCIL_STORAGE !== "postgres" || process.env.SOFTWARE_FACTORY_STORAGE_BACKEND !== "postgres" || process.env.OPENAI_SHARED_CREDITS_REQUIRED !== "true") throw Error("FACTORY_ONCE_CONFIGURATION_REQUIRED");
  let pool: import("pg").Pool | undefined;
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    const [{ createSoftwareFactoryStore }, { createFactoryWorkerOptions }, { validateFactoryWorkerOptions }, { createSoftwareFactoryWorker }, { Pool }, { resolveDatabaseConnectionString }] = await Promise.all([
      import("../server/software-factory-store"), import("../server/software-factory-asistente-operator"), import("../server/software-factory-runtime"), import("../server/software-factory-worker"), import("pg"), import("../server/database-url"),
    ]);
    pool = new Pool({ connectionString: resolveDatabaseConnectionString(), max: 2, connectionTimeoutMillis: 10000, statement_timeout: 30000, query_timeout: 35000, allowExitOnIdle: true });
    const store = createSoftwareFactoryStore(pool);
    const owner = process.env.SOFTWARE_FACTORY_OWNER_ID;
    if (!owner || shutdown.signal.aborted) throw Error("FACTORY_OWNER_REQUIRED");
    const config = await createFactoryWorkerOptions({ store });
    validateFactoryWorkerOptions(config);
    if (config.store !== store || config.releaseMode !== "review-only" || config.discoveryMode !== "company-orders-only") throw Error("FACTORY_ONCE_SCOPE_INVALID");
    const state = await store.status(owner);
    if (!state.configured) throw Error("FACTORY_ONCE_NOT_CONFIGURED");
    if (state.paused) { console.log(JSON.stringify({ reason: "paused", progressed: 0 })); return; }
    const result = await runSoftwareFactoryOnce(createSoftwareFactoryWorker({ ...config, store, scheduleOwner: owner }), { signal: shutdown.signal, maxStages: 4, durationMs: 30 * 60 * 1000 });
    console.log(JSON.stringify(result));
    if (["quarantined", "aborted"].includes(result.reason)) process.exitCode = 1;
  } finally { process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); await pool?.end(); }
}
void main().catch(() => { console.error("Factory one-shot unavailable; no automatic replay."); process.exitCode = 1; });
