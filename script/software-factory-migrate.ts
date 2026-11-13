import "../server/env-loader";
import pg from "pg";
import { createSoftwareFactorySchemaSql } from "../server/software-factory-store";
import { factoryTableNames, parseMigrateArgs, safeErrorCode } from "./software-factory-db-cli";

// Operator-only. Dry run by default (ROLLBACK); `--apply` commits. Never log connection strings or driver errors.
async function main() {
  const { apply } = parseMigrateArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL_REQUIRED");
  const tables = factoryTableNames();
  if (!tables.length) throw new Error("FACTORY_SCHEMA_EMPTY");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  pool.on("error", () => undefined);
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = 2000");
      await client.query("SET LOCAL statement_timeout = 15000");
      await client.query(createSoftwareFactorySchemaSql());
      const result = await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename=ANY($2)", ["public", tables]);
      const present = new Set(result.rows.map(row => String(row.tablename)));
      if (!tables.every(table => present.has(table))) throw new Error("FACTORY_SCHEMA_VERIFICATION_FAILED");
      await client.query(apply ? "COMMIT" : "ROLLBACK");
      console.log(JSON.stringify({ migrationValidated: true, applied: apply, tables }));
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(JSON.stringify({ error: "Software factory migration failed; no credentials or database details are logged.", code: safeErrorCode(error) }));
  process.exitCode = 1;
});
