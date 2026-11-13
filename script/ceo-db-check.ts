import "../server/env-loader";
import { Pool } from "pg";
import {
  REQUIRED_CEO_DB_TABLES,
  buildCeoDbCheckReport,
  formatCeoDbCheckJson,
  formatCeoDbCheckText,
  parseCeoDbCheckArgs,
} from "../server/ceo-db-check-cli";
import { hasRealValue } from "../server/ceo-doctor-cli";

async function getExistingTables(databaseUrl: string): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [Array.from(REQUIRED_CEO_DB_TABLES)],
    );
    return result.rows.map((row) => row.table_name);
  } finally {
    await pool.end();
  }
}

async function main() {
  const options = parseCeoDbCheckArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  const existingTables = hasRealValue(databaseUrl) ? await getExistingTables(databaseUrl) : [];
  const report = buildCeoDbCheckReport({
    databaseUrlConfigured: hasRealValue(databaseUrl),
    existingTables,
  });

  console.log(options.json ? formatCeoDbCheckJson(report) : formatCeoDbCheckText(report));
  process.exit(report.ready ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
