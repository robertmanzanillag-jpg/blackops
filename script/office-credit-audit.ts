// Trusted read-only entrypoint. Never loads .env, provider keys or writer runtime.
import { auditFailure, parseAuditInput, runCreditAudit } from "./office-credit-audit-core";
import { blackopsApplicationName } from "../server/agent-council-store";
async function main() {
  const input = parseAuditInput(process.env, process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) throw Error("AUDIT_INPUT_INVALID");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 15000, application_name: blackopsApplicationName("credit-audit") });
  pool.on("error", () => undefined);
  try {
    const client = await pool.connect();
    try { console.log(JSON.stringify(await runCreditAudit(client, input))); }
    finally { client.release(); }
  } finally { await pool.end(); }
}
void main().catch(error => {
  console.error(JSON.stringify(auditFailure(error)));
  process.exitCode = 1;
});
