export type CeoDbCheckOptions = {
  json: boolean;
};

export type CeoDbTableCheck = {
  table: string;
  required: boolean;
  exists: boolean;
  detail: string;
};

export type CeoDbCheckReport = {
  ready: boolean;
  databaseUrlConfigured: boolean;
  checks: CeoDbTableCheck[];
};

export const REQUIRED_CEO_DB_TABLES = [
  "users",
  "tasks",
  "telegram_config",
  "telegram_processed_updates",
  "revenue_stripe_events",
  "app_rate_limit_buckets",
  "automation_definitions",
  "automation_runs",
  "pending_actions",
  "audit_logs",
] as const;

export function parseCeoDbCheckArgs(argv: string[]): CeoDbCheckOptions {
  return {
    json: argv.includes("--json"),
  };
}

export function buildCeoDbCheckReport(input: {
  databaseUrlConfigured: boolean;
  existingTables: string[];
}): CeoDbCheckReport {
  const existing = new Set(input.existingTables);
  const checks = REQUIRED_CEO_DB_TABLES.map((table) => ({
    table,
    required: true,
    exists: existing.has(table),
    detail: existing.has(table)
      ? `${table} exists.`
      : `${table} missing. Run npm run db:push against the production database.`,
  }));

  return {
    ready: input.databaseUrlConfigured && checks.every((check) => check.exists),
    databaseUrlConfigured: input.databaseUrlConfigured,
    checks,
  };
}

export function formatCeoDbCheckText(report: CeoDbCheckReport): string {
  const lines = [
    "CEO Assistant DB Check",
    `Ready: ${report.ready ? "yes" : "no"}`,
    `DATABASE_URL: ${report.databaseUrlConfigured ? "configured" : "missing"}`,
    "",
    ...report.checks.map((check) => `- [${check.exists ? "ok" : "missing"}] ${check.table}: ${check.detail}`),
  ];
  return lines.join("\n");
}

export function formatCeoDbCheckJson(report: CeoDbCheckReport): string {
  return JSON.stringify(report, null, 2);
}
