import type { CeoDoctorCheck, CeoDoctorOptions } from "./ceo-doctor-cli";
import type { CeoBackupCheckReport } from "./ceo-backup-check-cli";
import type { CeoDbCheckReport } from "./ceo-db-check-cli";
import type { CeoReadinessReport } from "./ceo-readiness";
import { validateRequiredRealCliValue } from "./cli-validation";

export type CeoSmokeOptions = CeoDoctorOptions & {
  sendBrief: boolean;
  execute: boolean;
};

export type CeoSmokeBriefResult = {
  attempted: boolean;
  success: boolean;
  message: string;
};

export type CeoSmokeReport = {
  ready: boolean;
  doctorReady: boolean;
  dbReady: boolean;
  backupReady: boolean;
  readinessReady: boolean;
  brief: CeoSmokeBriefResult;
  checks: CeoDoctorCheck[];
  db: CeoDbCheckReport;
  backup: CeoBackupCheckReport;
  readiness: CeoReadinessReport;
  commands: string[];
};

function getArgValue(argv: string[], name: string): string {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

export function parseCeoSmokeArgs(argv: string[]): CeoSmokeOptions {
  return {
    userId: getArgValue(argv, "--user-id"),
    chatId: getArgValue(argv, "--chat-id"),
    json: argv.includes("--json"),
    sendBrief: argv.includes("--send-brief"),
    execute: argv.includes("--execute"),
  };
}

export function validateCeoSmokeOptions(options: CeoSmokeOptions): string[] {
  const errors: string[] = [];
  const userIdError = validateRequiredRealCliValue(options.userId, "--user-id=<real-user-id>");
  const chatIdError = validateRequiredRealCliValue(options.chatId, "--chat-id=<telegram-chat-id>");
  if (userIdError) errors.push(userIdError);
  if (chatIdError) errors.push(chatIdError);
  if (options.sendBrief && !options.execute) {
    errors.push("--execute is required with --send-brief to send a real Telegram CEO brief.");
  }
  return errors;
}

export function buildCeoSmokeReport(input: {
  checks: CeoDoctorCheck[];
  db: CeoDbCheckReport;
  backup: CeoBackupCheckReport;
  readiness: CeoReadinessReport;
  commands: string[];
  brief: CeoSmokeBriefResult;
}): CeoSmokeReport {
  const doctorReady = input.checks.every((check) => check.ok);
  const dbReady = input.db.ready;
  const backupReady = input.backup.ready;
  const readinessReady = input.readiness.ready;
  const briefReady = !input.brief.attempted || input.brief.success;

  return {
    ready: doctorReady && dbReady && backupReady && readinessReady && briefReady,
    doctorReady,
    dbReady,
    backupReady,
    readinessReady,
    brief: input.brief,
    checks: input.checks,
    db: input.db,
    backup: input.backup,
    readiness: input.readiness,
    commands: input.commands,
  };
}

export function formatCeoSmokeText(report: CeoSmokeReport): string {
  const lines = [
    "CEO Assistant Smoke",
    `Ready: ${report.ready ? "yes" : "no"}`,
    `Doctor: ${report.doctorReady ? "ready" : "needs_action"}`,
    `Database schema: ${report.dbReady ? "ready" : "needs_action"}`,
    `Backup/restore preflight: ${report.backupReady ? "ready" : "needs_action"}`,
    `Readiness: ${report.readiness.status}`,
    `Brief: ${report.brief.attempted ? report.brief.message : "skipped; pass --send-brief --execute to send a real Telegram brief."}`,
    "",
    "Doctor checks:",
    ...report.checks.map((check) => `- [${check.ok ? "ok" : "missing"}] ${check.label}: ${check.detail}`),
    "",
    "Database schema checks:",
    ...report.db.checks.map((check) => `- [${check.exists ? "ok" : "missing"}] ${check.table}: ${check.detail}`),
    "",
    "Backup/restore preflight checks:",
    `- [${report.backup.databaseUrlConfigured ? "ok" : "missing"}] DATABASE_URL`,
    `- [${report.backup.backupDirWritable ? "ok" : "missing"}] Backup dir: ${report.backup.backupDir}`,
    ...report.backup.tools.map((check) => `- [${check.ok ? "ok" : "missing"}] ${check.tool}: ${check.detail}`),
    ...report.backup.artifacts.map((check) => `- [${check.exists ? "found" : "absent"}] ${check.path}: ${check.detail}`),
    "",
    "Readiness checks:",
    ...report.readiness.checks.map((check) => `- [${check.status}] ${check.label}: ${check.detail}`),
    "",
    "Next commands:",
    ...report.commands.map((command) => `- ${command}`),
  ];
  return lines.join("\n");
}

export function formatCeoSmokeJson(report: CeoSmokeReport): string {
  return JSON.stringify(report, null, 2);
}
