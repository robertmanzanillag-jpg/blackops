import "../server/env-loader";
import pg from "pg";
import { createCouncilStore, type CouncilClient } from "../server/agent-council-store";
import {
  creditLedgerOwner, currentMonth, factoryTableNames, ownerKeyFor, parseStatusArgs, safeErrorCode,
  shapeCreditSummary, shapeJobCounts, shapeProjects,
} from "./software-factory-db-cli";

// READ-ONLY preflight. Everything runs inside one READ ONLY transaction that is always rolled back,
// so PostgreSQL itself rejects any write. Prints one JSON line without secrets or connection details.
async function main() {
  const { owner, creditScope } = parseStatusArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL_REQUIRED");
  const tables = factoryTableNames();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, max: 1 });
  pool.on("error", () => undefined);
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query("SET LOCAL lock_timeout = 2000");
      await client.query("SET LOCAL statement_timeout = 15000");
      const found = await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename=ANY($2)", ["public", [...tables, "agent_council_state"]]);
      const present = new Set(found.rows.map(row => String(row.tablename)));
      const has = (table: string) => present.has(table);
      const month = currentMonth();
      const key = owner ? ownerKeyFor(owner) : undefined;
      const report: Record<string, unknown> = {
        readOnly: true,
        tables: Object.fromEntries(tables.map(table => [table, has(table)])),
        allTablesPresent: tables.every(has),
        ownerProvided: !!owner,
        month,
      };

      if (key && has("software_factory_controls")) {
        const controls = await client.query("SELECT paused FROM software_factory_controls WHERE owner_key=$1", [key]);
        // A missing controls row is treated as paused by the factory store.
        report.controls = { rowExists: controls.rows.length > 0, paused: controls.rows.length ? controls.rows[0].paused !== false : true };
      }
      if (key && has("software_factory_budget")) {
        const budget = await client.query("SELECT fixed_cents,spent_cents,reserved_cents FROM software_factory_budget WHERE owner_key=$1 AND month=$2", [key, month]);
        const row = budget.rows[0];
        report.budget = row
          ? { rowExists: true, fixedCents: Number(row.fixed_cents), spentCents: Number(row.spent_cents), reservedCents: Number(row.reserved_cents), limitCents: 10000 }
          : { rowExists: false };
      }
      if (key && has("software_factory_projects")) {
        const projects = await client.query("SELECT id, config->'journeys' AS journeys FROM software_factory_projects WHERE owner_key=$1 ORDER BY id", [key]);
        report.projects = shapeProjects(projects.rows as Array<{ id: unknown; journeys: unknown }>);
      }
      if (has("software_factory_jobs")) {
        // Global on purpose: the factory holds ONE execution slot across all owners while a job is running/unknown.
        const jobs = await client.query("SELECT status, count(*)::int AS count FROM software_factory_jobs GROUP BY status ORDER BY status");
        report.jobs = shapeJobCounts(jobs.rows as Array<{ status: unknown; count: unknown }>);
      }
      if (creditScope) {
        if (!has("agent_council_state")) report.credit = { provisioned: false, storageTableMissing: true };
        else {
          // council store read() is a plain SELECT; route it through this read-only transaction.
          const inTransaction: CouncilClient = { query: (sql, values) => client.query(sql, values as unknown[]), release: () => undefined };
          const store = createCouncilStore({ connect: async () => inTransaction });
          report.credit = { scope: creditScope, ...shapeCreditSummary(await store.read(creditLedgerOwner(creditScope)), creditScope) };
        }
      }
      await client.query("ROLLBACK");
      console.log(JSON.stringify(report));
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(JSON.stringify({ error: "Software factory status failed; no credentials or database details are logged.", code: safeErrorCode(error) }));
  process.exitCode = 1;
});
