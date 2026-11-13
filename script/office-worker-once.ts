// Dedicated trusted cloud entrypoint: never loads repository .env files or adapters.
// Runs the reviewed office executor once, bounded, then exits (see docs/office-worker-cloud.md).
import { createHash, randomUUID } from "node:crypto";
import { runOfficeWorkerOnce, safeFailureCode, OFFICE_ONCE_MAX_DURATION_MS, type OfficeOnceOwnership } from "../server/office-worker-once";
export { safeFailureCode };
// Same validation and fixed review-only flags as the reviewed Windows launcher.
import { parseWorkerConfig, safeWorkerEnvironment } from "./office-windows-worker.mjs";

const CONFIG_KEYS = ["DATABASE_URL", "DEFAULT_USER_ID", "OPENAI_API_KEY", "OFFICE_OPENAI_MODEL", "OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT", "OFFICE_OPENAI_MAX_OUTPUT_TOKENS",
  "OFFICE_ACADEMY_PREPARATION_ENABLED", "OFFICE_ACADEMY_EXECUTION_ENABLED", "OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED", "OFFICE_EXPECTED_WEB_REVISION", "GITHUB_TOKEN",
  "OFFICE_INTERNAL_WORK_ENABLED", "OFFICE_ROLE_WORK_ENABLED", "OFFICE_WEB_SOURCES_ENABLED", "OFFICE_ROLE_ACADEMY_ENABLED", "OFFICE_CAPABILITY_TRAINING_ENABLED",
  "OPENAI_SHARED_CREDITS_REQUIRED", "OFFICE_WEB_SOURCE_ORIGIN", "OFFICE_ROLE_ACADEMY_DAILY_PAIRS", "OPENAI_SHARED_CREDIT_CONFIG", "OFFICE_CAPABILITY_MAX_CALLS_PER_DAY"];

async function main() {
  if (process.argv.length !== 2) throw Error("OFFICE_ONCE_ARGUMENTS_INVALID");
  const paused = () => process.env.OFFICE_WORKER_CLOUD_ENABLED !== "true";
  if (paused()) { console.log(JSON.stringify({ reason: "paused", cycles: 0 })); return; }
  const raw = CONFIG_KEYS.filter(key => process.env[key]).map(key => `${key}=${process.env[key]}`).join("\n");
  const config = parseWorkerConfig(raw);
  for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
  Object.assign(process.env, safeWorkerEnvironment(config, {}), { OFFICE_WORKER_RUN_ONCE: "false" });

  const shutdown = new AbortController();
  const abort = () => shutdown.abort();
  process.once("SIGTERM", abort); process.once("SIGINT", abort);
  let stopping = false;
  const { Pool } = (await import("pg")).default;
  const ownerKey = createHash("sha256").update(String(config.DEFAULT_USER_ID)).digest("hex");
  const lockKey = `office-worker-executor:v1:${ownerKey}`;
  // Dedicated session for the advisory lock. Requires a direct (non transaction-pooled) URL;
  // a pooled session makes verify() fail and the run stops instead of running unowned.
  const lockPool = new Pool({ connectionString: config.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 15000, query_timeout: 20000 });
  let host: Awaited<ReturnType<typeof import("../server/office-worker-assembly")["assembleOfficeWorker"]>> | undefined;
  let lockClient: import("pg").PoolClient | undefined;
  try {
    const result = await runOfficeWorkerOnce({
      paused,
      async acquire() {
        lockClient = await lockPool.connect();
        const locked = (await lockClient.query("/*office:cloud-owner*/ SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [lockKey])).rows[0]?.locked === true;
        if (!locked) { lockClient.release(); lockClient = undefined; return undefined; }
        const client = lockClient;
        const ownership: OfficeOnceOwnership = {
          async verify() {
            try {
              return (await client.query(`/*office:cloud-owner-verify*/ SELECT EXISTS(SELECT 1 FROM pg_locks l, (SELECT hashtextextended($1, 0) AS k) h
 WHERE l.locktype='advisory' AND l.pid=pg_backend_pid() AND l.granted AND l.objsubid=1
 AND l.classid=((h.k >> 32) & 4294967295)::oid AND l.objid=(h.k & 4294967295)::oid) AS held`, [lockKey])).rows[0]?.held === true;
            } catch { return false; }
          },
          async release() {
            try { await client.query("/*office:cloud-owner-release*/ SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]); }
            finally { client.release(); lockClient = undefined; }
          },
        };
        return ownership;
      },
      async otherExecutorActive() {
        const rows = (await lockClient!.query("/*office:cloud-other-executor*/ SELECT EXISTS(SELECT 1 FROM office_agent_workers WHERE id NOT LIKE 'office-cloud-%' AND last_seen_at > CURRENT_TIMESTAMP - interval '2 minutes') AS active")).rows;
        if (typeof rows[0]?.active !== "boolean") throw Error("OFFICE_ONCE_EXECUTOR_STATE_UNVERIFIED");
        if (rows[0].active) return true;
        // Assembled only after exclusive ownership; the heartbeat id marks cloud presence.
        host = await (await import("../server/office-worker-assembly")).assembleOfficeWorker({ shouldStop: () => stopping, workerId: `office-cloud-${randomUUID()}` });
        return false;
      },
      checkProtocol: () => host!.checkProtocol(),
      refreshCapabilities: () => host!.worker.refreshCapabilities(),
      maintain: () => host!.worker.maintain(),
      tick: () => host!.worker.tick(),
      get academyCycle() { return host?.academyCycle; },
      get capabilityTick() { return host?.capabilityTick; },
      requestStop() { stopping = true; },
    }, { signal: shutdown.signal, durationMs: OFFICE_ONCE_MAX_DURATION_MS });
    console.log(JSON.stringify(result));
    if (result.reason === "unconfirmed") process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", abort); process.removeListener("SIGINT", abort);
    await host?.close().catch(() => undefined);
    lockClient?.release();
    await lockPool.end().catch(() => undefined);
  }
}
if (process.argv[1]?.endsWith("office-worker-once.ts")) void main().catch(error => { console.error(`Office one-shot unavailable; no automatic replay. code=${safeFailureCode(error)}`); process.exitCode = 1; })
  // Shared database clients (council, queue) may keep the event loop alive after the bounded run.
  .finally(() => process.exit(process.exitCode ?? 0));
