import { hasRealValue } from "./ceo-doctor-cli";

export type CeoBackupCheckOptions = {
  json: boolean;
};

export type CeoBackupToolCheck = {
  tool: "pg_dump" | "pg_restore" | "psql" | "tar";
  ok: boolean;
  detail: string;
};

export type CeoBackupArtifactCheck = {
  path: string;
  exists: boolean;
  sensitive: boolean;
  policy: "include_if_exists" | "encrypted_only";
  detail: string;
};

export type CeoBackupCheckReport = {
  ready: boolean;
  databaseUrlConfigured: boolean;
  backupDir: string;
  backupDirWritable: boolean;
  encryptedSecretBackupConfigured: boolean;
  tools: CeoBackupToolCheck[];
  artifacts: CeoBackupArtifactCheck[];
  commands: string[];
  sensitiveArtifactNote: string;
};

export const DEFAULT_CEO_BACKUP_DIR = "backups/ceo-assistant";

export const CEO_BACKUP_ARTIFACT_PATHS = [
  { path: "revenue_engine_data", sensitive: false, policy: "include_if_exists" },
  { path: "revenue_mockups", sensitive: false, policy: "include_if_exists" },
  { path: "radio_video_edits", sensitive: false, policy: "include_if_exists" },
  { path: "promo_video_edits", sensitive: false, policy: "include_if_exists" },
  { path: "clippers_workspace", sensitive: false, policy: "include_if_exists" },
  { path: "CEO_ASSISTANT_ENV", sensitive: true, policy: "encrypted_only" },
  { path: ".env", sensitive: true, policy: "encrypted_only" },
  { path: ".env.local", sensitive: true, policy: "encrypted_only" },
  { path: "credentials", sensitive: true, policy: "encrypted_only" },
  { path: "secrets", sensitive: true, policy: "encrypted_only" },
] as const;

export function parseCeoBackupCheckArgs(argv: string[]): CeoBackupCheckOptions {
  return {
    json: argv.includes("--json"),
  };
}

export function resolveCeoBackupDir(value: string | undefined): string {
  return hasRealValue(value) ? value : DEFAULT_CEO_BACKUP_DIR;
}

export function buildCeoBackupCheckReport(input: {
  databaseUrlConfigured: boolean;
  backupDir: string;
  backupDirWritable: boolean;
  encryptedSecretBackupConfigured: boolean;
  availableTools: Partial<Record<CeoBackupToolCheck["tool"], boolean>>;
  existingArtifactPaths: string[];
}): CeoBackupCheckReport {
  const existingArtifacts = new Set(input.existingArtifactPaths);
  const tools: CeoBackupToolCheck[] = (["pg_dump", "pg_restore", "psql", "tar"] as const).map((tool) => ({
    tool,
    ok: Boolean(input.availableTools[tool]),
    detail: input.availableTools[tool]
      ? `${tool} available.`
      : `${tool} missing. Install PostgreSQL client tools and system tar before relying on backup/restore.`,
  }));
  const artifacts: CeoBackupArtifactCheck[] = CEO_BACKUP_ARTIFACT_PATHS.map((artifact) => {
    const exists = existingArtifacts.has(artifact.path);
    const encrypted = !artifact.sensitive || input.encryptedSecretBackupConfigured;
    return {
      ...artifact,
      exists,
      detail: !exists
        ? `${artifact.path} not present; nothing to include right now.`
        : artifact.sensitive && !encrypted
          ? `${artifact.path} exists and must only be backed up with encrypted off-machine storage. Set CEO_BACKUP_SECRETS_ENCRYPTED=true after configuring that process.`
          : `${artifact.path} exists and is covered by the ${artifact.policy} policy.`,
    };
  });
  const sensitiveArtifactsReady = artifacts.every((artifact) => !artifact.exists || !artifact.sensitive || input.encryptedSecretBackupConfigured);
  const existingSensitiveArtifacts = artifacts.filter((artifact) => artifact.exists && artifact.sensitive);
  const ready = input.databaseUrlConfigured
    && input.backupDirWritable
    && tools.every((tool) => tool.ok)
    && sensitiveArtifactsReady;

  return {
    ready,
    databaseUrlConfigured: input.databaseUrlConfigured,
    backupDir: input.backupDir,
    backupDirWritable: input.backupDirWritable,
    encryptedSecretBackupConfigured: input.encryptedSecretBackupConfigured,
    tools,
    artifacts,
    commands: buildCeoBackupCommands(input.backupDir),
    sensitiveArtifactNote: buildSensitiveArtifactNote({
      existingSensitiveArtifacts: existingSensitiveArtifacts.map((artifact) => artifact.path),
      encryptedSecretBackupConfigured: input.encryptedSecretBackupConfigured,
    }),
  };
}

export function buildCeoBackupCommands(backupDir: string): string[] {
  const dir = backupDir || DEFAULT_CEO_BACKUP_DIR;
  return [
    `mkdir -p ${dir}`,
    `pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="${dir}/postgres.dump"`,
    `tar -czf "${dir}/local-artifacts.tgz" revenue_engine_data revenue_mockups radio_video_edits promo_video_edits clippers_workspace 2>/dev/null || true`,
    `psql "$DATABASE_URL" -c "select 1"`,
    `RESTORE_DATABASE_URL=<staging-db-url> pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" "${dir}/postgres.dump"`,
  ];
}

export function buildSensitiveArtifactNote(input: {
  existingSensitiveArtifacts: string[];
  encryptedSecretBackupConfigured: boolean;
}): string {
  if (input.existingSensitiveArtifacts.length === 0) {
    return "No sensitive local artifact directories were found.";
  }
  const paths = input.existingSensitiveArtifacts.join(", ");
  if (input.encryptedSecretBackupConfigured) {
    return `Sensitive artifact directories found (${paths}). They are intentionally excluded from local-artifacts.tgz; keep the separate encrypted off-machine backup evidence current.`;
  }
  return `Sensitive artifact directories found (${paths}). Do not run production with real data until they are covered by separate encrypted off-machine backup evidence.`;
}

export function formatCeoBackupCheckText(report: CeoBackupCheckReport): string {
  const lines = [
    "CEO Assistant Backup Check",
    `Ready: ${report.ready ? "yes" : "no"}`,
    `DATABASE_URL: ${report.databaseUrlConfigured ? "configured" : "missing"}`,
    `Backup dir: ${report.backupDir} (${report.backupDirWritable ? "writable" : "not writable"})`,
    `Sensitive artifacts: ${report.encryptedSecretBackupConfigured ? "encrypted backup configured" : "encrypted backup not confirmed"}`,
    "",
    "Tools:",
    ...report.tools.map((check) => `- [${check.ok ? "ok" : "missing"}] ${check.tool}: ${check.detail}`),
    "",
    "Artifacts:",
    ...report.artifacts.map((check) => `- [${check.exists ? "found" : "absent"}] ${check.path}: ${check.detail}`),
    "",
    `Sensitive artifact note: ${report.sensitiveArtifactNote}`,
    "",
    "Backup/restore commands:",
    ...report.commands.map((command) => `- ${command}`),
  ];
  return lines.join("\n");
}

export function formatCeoBackupCheckJson(report: CeoBackupCheckReport): string {
  return JSON.stringify(report, null, 2);
}
