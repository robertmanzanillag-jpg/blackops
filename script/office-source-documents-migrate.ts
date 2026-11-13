import pg from "pg";
import { pathToFileURL } from "node:url";
import { OFFICE_SOURCE_DOCUMENT_SCHEMA_SQL } from "../server/office-source-documents";
import { OFFICE_WEB_ROLE_SOURCE_SCHEMA_SQL } from "../server/office-web-role-store";

// Operator-only. Dry run by default (creates inside a transaction, verifies, ROLLBACK);
// `--apply` commits. Additive only: CREATE TABLE IF NOT EXISTS, never ALTER/DROP/UPDATE.
// Prints static JSON and static error codes only; never connection strings or driver errors.
export const OFFICE_SOURCE_MIGRATION_TABLES = ["office_source_documents", "office_web_role_sources"] as const;
type Client = { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }> };

export function parseOfficeSourceMigrateArgs(argv: string[]): { apply: boolean } {
  if (argv.length > 1 || argv.some(arg => arg !== "--apply")) throw new Error("ARGUMENT_INVALID");
  return { apply: argv.includes("--apply") };
}

export async function runOfficeSourceDocumentsMigration(client: Client, apply: boolean) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = 2000");
    await client.query("SET LOCAL statement_timeout = 15000");
    await client.query(OFFICE_SOURCE_DOCUMENT_SCHEMA_SQL);
    await client.query(OFFICE_WEB_ROLE_SOURCE_SCHEMA_SQL);
    const result = await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename=ANY($2)", ["public", [...OFFICE_SOURCE_MIGRATION_TABLES]]);
    const present = new Set(result.rows.map(row => String(row.tablename)));
    if (!OFFICE_SOURCE_MIGRATION_TABLES.every(table => present.has(table))) throw new Error("OFFICE_SOURCE_SCHEMA_VERIFICATION_FAILED");
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { migrationValidated: true, applied: apply, tables: [...OFFICE_SOURCE_MIGRATION_TABLES] };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}

function safeCode(error: unknown): string {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code)) return `CODE_${code.toUpperCase()}`;
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
  if (typeof message === "string" && /^[A-Z][A-Z0-9_]{2,60}$/.test(message)) return message;
  return "UNKNOWN";
}

async function main() {
  await import("../server/env-loader");
  const { apply } = parseOfficeSourceMigrateArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL_REQUIRED");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  pool.on("error", () => undefined);
  try {
    const client = await pool.connect();
    try { console.log(JSON.stringify(await runOfficeSourceDocumentsMigration(client, apply))); }
    finally { client.release(); }
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    console.error(JSON.stringify({ error: "Office source documents migration failed; no credentials or database details are logged.", code: safeCode(error) }));
    process.exitCode = 1;
  });
}
