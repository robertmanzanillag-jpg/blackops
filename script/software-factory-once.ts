// Dedicated trusted entrypoint: never loads repository .env or arbitrary adapters.
import { runSoftwareFactoryOnce } from "../server/software-factory-once";
import { factoryOnceFailure, type FactoryOncePhase } from "../server/software-factory-diagnostics";
import { blackopsApplicationName } from "../server/agent-council-store";

let phase: FactoryOncePhase = "configuration";

async function main() {
  if (process.argv.length !== 2 || process.env.SOFTWARE_FACTORY_ENABLED !== "true" || process.env.AGENT_COUNCIL_STORAGE !== "postgres" || process.env.SOFTWARE_FACTORY_STORAGE_BACKEND !== "postgres" || process.env.OPENAI_SHARED_CREDITS_REQUIRED !== "true") throw Error("FACTORY_ONCE_CONFIGURATION_REQUIRED");
  let pool: import("pg").Pool | undefined;
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    phase = "imports";
    const [{ createSoftwareFactoryStore }, { createFactoryWorkerOptions }, { validateFactoryWorkerOptions }, { createSoftwareFactoryWorker }, { Pool }, { resolveDatabaseConnectionString }] = await Promise.all([
      import("../server/software-factory-store"), import("../server/software-factory-asistente-operator"), import("../server/software-factory-runtime"), import("../server/software-factory-worker"), import("pg"), import("../server/database-url"),
    ]);
    phase = "database";
    pool = new Pool({ connectionString: resolveDatabaseConnectionString(), max: 2, connectionTimeoutMillis: 10000, statement_timeout: 30000, query_timeout: 35000, allowExitOnIdle: true, application_name: blackopsApplicationName("factory-once") });
    const store = createSoftwareFactoryStore(pool);
    const owner = process.env.SOFTWARE_FACTORY_OWNER_ID;
    if (!owner || shutdown.signal.aborted) throw Error("FACTORY_OWNER_REQUIRED");
    phase = "operator";
    const config = await createFactoryWorkerOptions({ store });
    validateFactoryWorkerOptions(config);
    if (config.store !== store || config.releaseMode !== "review-only" || config.discoveryMode !== "company-orders-only") throw Error("FACTORY_ONCE_SCOPE_INVALID");
    phase = "state";
    const state = await store.status(owner);
    if (!state.configured) throw Error("FACTORY_ONCE_NOT_CONFIGURED");
    if (state.paused) { console.log(JSON.stringify({ reason: "paused", progressed: 0 })); return; }
    phase = "execution";
    const result = await runSoftwareFactoryOnce(createSoftwareFactoryWorker({ ...config, store, scheduleOwner: owner }), { signal: shutdown.signal, maxStages: 4, durationMs: 30 * 60 * 1000 });
    console.log(JSON.stringify(result));
    if (["quarantined", "aborted"].includes(result.reason)) process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    try { await pool?.end(); }
    catch (error) {
      // Report cleanup independently so it cannot erase the primary failure.
      console.error(JSON.stringify(factoryOnceFailure(error, "shutdown")));
      process.exitCode = 1;
    }
  }
}
void main().catch(error => { console.error(JSON.stringify(factoryOnceFailure(error, phase))); process.exitCode = 1; });
