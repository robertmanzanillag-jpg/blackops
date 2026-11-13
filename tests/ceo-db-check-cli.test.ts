import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_CEO_DB_TABLES,
  buildCeoDbCheckReport,
  formatCeoDbCheckJson,
  formatCeoDbCheckText,
  parseCeoDbCheckArgs,
} from "../server/ceo-db-check-cli";

test("parses CEO DB check CLI options", () => {
  assert.deepEqual(parseCeoDbCheckArgs(["--json"]), { json: true });
  assert.deepEqual(parseCeoDbCheckArgs([]), { json: false });
});

test("reports CEO DB schema ready when all required tables exist", () => {
  const report = buildCeoDbCheckReport({
    databaseUrlConfigured: true,
    existingTables: Array.from(REQUIRED_CEO_DB_TABLES),
  });

  assert.equal(report.ready, true);
  assert.equal(report.checks.every((check) => check.exists), true);
});

test("blocks CEO DB schema readiness when operational tables are missing", () => {
  const report = buildCeoDbCheckReport({
    databaseUrlConfigured: true,
    existingTables: ["users", "tasks", "telegram_config"],
  });

  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check) => check.table === "telegram_processed_updates")?.exists, false);
  assert.equal(report.checks.find((check) => check.table === "app_rate_limit_buckets")?.exists, false);
});

test("formats CEO DB check text and JSON", () => {
  const report = buildCeoDbCheckReport({
    databaseUrlConfigured: false,
    existingTables: [],
  });

  assert.match(formatCeoDbCheckText(report), /CEO Assistant DB Check/);
  assert.equal(JSON.parse(formatCeoDbCheckJson(report)).ready, false);
});
