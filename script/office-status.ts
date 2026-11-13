import "../server/env-loader";
import pg from "pg";
import { createCouncilStore, type CouncilClient } from "../server/agent-council-store";
import { safeErrorCode } from "./software-factory-db-cli";
import { parseOwner, shapeCouncil, shapeWebSources, shapeWorkers, webSourceOwnerKey } from "./office-status-shape";

// READ-ONLY office diagnostic. Everything runs inside one READ ONLY transaction that is always rolled
// back, so PostgreSQL itself rejects any write. Prints ONE JSON line that is safe for public logs:
// no user/worker/job ids, no URLs, no free text, no prompts or answers; only enum codes, counts and dates.
const TABLES = ["agent_council_state", "office_agent_workers", "office_web_role_sources"] as const;

async function main() {
  const owner = parseOwner(process.env);
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL_REQUIRED");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, max: 1 });
  pool.on("error", () => undefined);
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query("SET LOCAL lock_timeout = 2000");
      await client.query("SET LOCAL statement_timeout = 15000");
      const found = await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename=ANY($2)", ["public", [...TABLES]]);
      const present = new Set(found.rows.map(row => String(row.tablename)));
      const has = (table: string) => present.has(table);
      const now = Date.now();
      const report: Record<string, unknown> = {
        readOnly: true,
        observedAt: new Date(now).toISOString(),
        tables: Object.fromEntries(TABLES.map(table => [table, has(table)])),
      };

      if (has("agent_council_state")) {
        // council store read() is a plain SELECT; route it through this read-only transaction.
        const inTransaction: CouncilClient = { query: (sql, values) => client.query(sql, values as unknown[]), release: () => undefined };
        Object.assign(report, shapeCouncil(await createCouncilStore({ connect: async () => inTransaction }).read(owner), owner, now));
      }
      if (has("office_agent_workers")) {
        // The id is only used to derive the cloud flag inside SQL; it is never selected.
        const workers = await client.query("SELECT (id LIKE 'office-cloud-%') AS cloud, last_seen_at FROM office_agent_workers WHERE last_seen_at > CURRENT_TIMESTAMP - interval '3 days' ORDER BY last_seen_at DESC LIMIT 50");
        report.workers = shapeWorkers(workers.rows);
      }
      if (has("office_web_role_sources")) {
        const sources = await client.query("SELECT role, observed_at, source->'provenance' AS provenance FROM office_web_role_sources WHERE owner_key=$1", [webSourceOwnerKey(owner)]);
        report.webSources = shapeWebSources(sources.rows, now);
      }
      await client.query("ROLLBACK");
      console.log(JSON.stringify(report));
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(JSON.stringify({ error: "Office status failed; no credentials or database details are logged.", code: safeErrorCode(error) }));
  process.exitCode = 1;
});
