import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CEO_BACKUP_ARTIFACT_PATHS, resolveCeoBackupDir } from "./ceo-backup-check-cli";

export type CeoBackupRunOptions = {
  execute: boolean;
  json: boolean;
  backupDir: string;
  label: string | null;
};

export type CeoRestoreRunOptions = {
  execute: boolean;
  json: boolean;
  confirmRestore: boolean;
  dumpPath: string | null;
  artifactsPath: string | null;
  manifestPath: string | null;
  artifactsOutputDir: string;
  targetDatabaseUrlEnv: string;
};

export type CeoBackupRunPlan = {
  ready: boolean;
  execute: boolean;
  backupDir: string;
  postgresDumpPath: string;
  localArtifactsPath: string;
  manifestPath: string;
  localArtifactPaths: string[];
  sensitiveArtifactPaths: string[];
  blockers: string[];
  commands: string[];
};

export type CeoRestoreRunPlan = {
  ready: boolean;
  execute: boolean;
  confirmRestore: boolean;
  dumpPath: string | null;
  artifactsPath: string | null;
  manifestPath: string | null;
  artifactsOutputDir: string;
  targetDatabaseUrlEnv: string;
  blockers: string[];
  commands: string[];
};

export type CeoBackupManifestFile = {
  role: "postgres_dump" | "local_artifacts";
  path: string;
  sha256: string;
  bytes: number;
};

export type CeoBackupManifest = {
  createdAt: string;
  backupDir: string;
  includedLocalArtifactDirs: string[];
  excludedSensitiveDirs: string[];
  files: CeoBackupManifestFile[];
};

export type CeoBackupManifestVerificationCheck = {
  path: string;
  ok: boolean;
  expectedSha256: string | null;
  actualSha256: string | null;
  expectedBytes: number | null;
  actualBytes: number | null;
  error: string | null;
};

export type CeoBackupManifestVerification = {
  ready: boolean;
  manifestPath: string;
  checks: CeoBackupManifestVerificationCheck[];
  blockers: string[];
};

const LOCAL_ARTIFACT_PATHS = CEO_BACKUP_ARTIFACT_PATHS
  .filter((artifact) => !artifact.sensitive && artifact.policy === "include_if_exists")
  .map((artifact) => artifact.path);

const SENSITIVE_ARTIFACT_PATHS = CEO_BACKUP_ARTIFACT_PATHS
  .filter((artifact) => artifact.sensitive)
  .map((artifact) => artifact.path);

function readFlagValue(argv: string[], name: string): string | null {
  const exactIndex = argv.indexOf(name);
  if (exactIndex >= 0) return argv[exactIndex + 1] || null;
  const prefix = `${name}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function safeBackupLabel(value: string | null, now = new Date()): string {
  const fallback = now.toISOString().replace(/[:.]/g, "-");
  const safe = (value || fallback).trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 80);
  return safe || fallback;
}

function toPortablePath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function validateRestoreTargetDatabaseEnvName(value: string): string | null {
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) {
    return "--target-database-url-env must be an uppercase environment variable name.";
  }
  if (value === "DATABASE_URL" || !/(^|_)(RESTORE|STAGING|TEST)(_|$)/.test(value)) {
    return "Refusing unsafe restore target. Use an explicit restore/staging/test env such as RESTORE_DATABASE_URL, STAGING_DATABASE_URL, or TEST_DATABASE_URL.";
  }
  return null;
}

export function hashFileSha256(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

export function parseCeoBackupRunArgs(argv: string[]): CeoBackupRunOptions {
  const backupDirFlag = readFlagValue(argv, "--backup-dir");
  return {
    execute: argv.includes("--execute"),
    json: argv.includes("--json"),
    backupDir: backupDirFlag || resolveCeoBackupDir(process.env.CEO_BACKUP_DIR),
    label: readFlagValue(argv, "--label"),
  };
}

export function parseCeoRestoreRunArgs(argv: string[]): CeoRestoreRunOptions {
  return {
    execute: argv.includes("--execute"),
    json: argv.includes("--json"),
    confirmRestore: argv.includes("--confirm-restore"),
    dumpPath: readFlagValue(argv, "--dump"),
    artifactsPath: readFlagValue(argv, "--artifacts"),
    manifestPath: readFlagValue(argv, "--manifest"),
    artifactsOutputDir: readFlagValue(argv, "--artifacts-output-dir") || toPortablePath(path.join("restored-artifacts", safeBackupLabel(null))),
    targetDatabaseUrlEnv: readFlagValue(argv, "--target-database-url-env") || "RESTORE_DATABASE_URL",
  };
}

export function buildCeoBackupRunPlan(input: {
  options: CeoBackupRunOptions;
  databaseUrlConfigured: boolean;
  encryptedSecretBackupConfigured: boolean;
  availableTools: Partial<Record<"pg_dump" | "tar", boolean>>;
  existingArtifactPaths: string[];
  now?: Date;
}): CeoBackupRunPlan {
  const label = safeBackupLabel(input.options.label, input.now);
  const backupDir = toPortablePath(path.join(input.options.backupDir, label));
  const postgresDumpPath = toPortablePath(path.join(backupDir, "postgres.dump"));
  const localArtifactsPath = toPortablePath(path.join(backupDir, "local-artifacts.tgz"));
  const manifestPath = toPortablePath(path.join(backupDir, "backup-manifest.json"));
  const existing = new Set(input.existingArtifactPaths);
  const localArtifactPaths = LOCAL_ARTIFACT_PATHS.filter((artifactPath) => existing.has(artifactPath));
  const sensitiveArtifactPaths = SENSITIVE_ARTIFACT_PATHS.filter((artifactPath) => existing.has(artifactPath));
  const blockers = [
    !input.databaseUrlConfigured && "DATABASE_URL is required.",
    !input.availableTools.pg_dump && "pg_dump is required.",
    !input.availableTools.tar && "tar is required.",
    sensitiveArtifactPaths.length > 0 && !input.encryptedSecretBackupConfigured
      ? `${sensitiveArtifactPaths.join(", ")} exist; configure encrypted off-machine backup and set CEO_BACKUP_SECRETS_ENCRYPTED=true before executing.`
      : null,
    !input.options.execute && "Dry run only. Re-run with --execute after reviewing this plan.",
  ].filter((blocker): blocker is string => Boolean(blocker));

  return {
    ready: blockers.length === 0,
    execute: input.options.execute,
    backupDir,
    postgresDumpPath,
    localArtifactsPath,
    manifestPath,
    localArtifactPaths,
    sensitiveArtifactPaths,
    blockers,
    commands: [
      `mkdir -p ${backupDir}`,
      `pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="${postgresDumpPath}"`,
      localArtifactPaths.length
        ? `tar -czf "${localArtifactsPath}" ${localArtifactPaths.join(" ")}`
        : `tar skipped: no local artifact directories found.`,
      `write SHA-256 manifest to "${manifestPath}"`,
    ],
  };
}

export function buildCeoRestoreRunPlan(input: {
  options: CeoRestoreRunOptions;
  targetDatabaseUrlConfigured: boolean;
  dumpExists: boolean;
  artifactsExist: boolean;
  manifestExists: boolean;
  availableTools: Partial<Record<"pg_restore" | "psql" | "tar", boolean>>;
}): CeoRestoreRunPlan {
  const targetEnvError = validateRestoreTargetDatabaseEnvName(input.options.targetDatabaseUrlEnv);
  const blockers = [
    targetEnvError,
    !input.options.dumpPath && "Pass --dump=<path-to-postgres.dump>.",
    input.options.dumpPath && !input.dumpExists && `Dump file not found: ${input.options.dumpPath}.`,
    input.options.artifactsPath && !input.artifactsExist && `Artifacts archive not found: ${input.options.artifactsPath}.`,
    input.options.manifestPath && !input.manifestExists && `Backup manifest not found: ${input.options.manifestPath}.`,
    !input.targetDatabaseUrlConfigured && `${input.options.targetDatabaseUrlEnv} is required.`,
    !input.availableTools.pg_restore && "pg_restore is required.",
    !input.availableTools.psql && "psql is required.",
    input.options.artifactsPath && !input.availableTools.tar && "tar is required when restoring local artifacts.",
    !input.options.confirmRestore && "Restore is destructive. Pass --confirm-restore after verifying the target database.",
    !input.options.execute && "Dry run only. Re-run with --execute after reviewing this plan.",
  ].filter((blocker): blocker is string => Boolean(blocker));

  return {
    ready: blockers.length === 0,
    execute: input.options.execute,
    confirmRestore: input.options.confirmRestore,
    dumpPath: input.options.dumpPath,
    artifactsPath: input.options.artifactsPath,
    manifestPath: input.options.manifestPath,
    artifactsOutputDir: input.options.artifactsOutputDir,
    targetDatabaseUrlEnv: input.options.targetDatabaseUrlEnv,
    blockers,
    commands: [
      input.options.manifestPath
        ? `verify SHA-256 checksums from "${input.options.manifestPath}"`
        : "checksum verification skipped; pass --manifest=<backup-manifest.json> to verify dump/artifacts before restore.",
      `psql "$${input.options.targetDatabaseUrlEnv}" -c "select 1"`,
      `pg_restore --clean --if-exists --no-owner --no-acl --dbname="$${input.options.targetDatabaseUrlEnv}" "${input.options.dumpPath || "<dump-path>"}"`,
      input.options.artifactsPath
        ? `mkdir -p "${input.options.artifactsOutputDir}" && tar -xzf "${input.options.artifactsPath}" -C "${input.options.artifactsOutputDir}"`
        : "local artifacts restore skipped; pass --artifacts=<local-artifacts.tgz> to verify artifact recovery.",
    ],
  };
}

export function formatCeoBackupRunText(plan: CeoBackupRunPlan): string {
  return [
    "CEO Assistant Backup",
    `Ready: ${plan.ready ? "yes" : "no"}`,
    `Mode: ${plan.execute ? "execute" : "dry-run"}`,
    `Backup dir: ${plan.backupDir}`,
    `Postgres dump: ${plan.postgresDumpPath}`,
    `Local artifacts: ${plan.localArtifactsPath}`,
    `Manifest: ${plan.manifestPath}`,
    `Included local artifact dirs: ${plan.localArtifactPaths.length ? plan.localArtifactPaths.join(", ") : "none"}`,
    `Sensitive dirs found: ${plan.sensitiveArtifactPaths.length ? plan.sensitiveArtifactPaths.join(", ") : "none"}`,
    "",
    "Blockers:",
    ...(plan.blockers.length ? plan.blockers.map((blocker) => `- ${blocker}`) : ["- none"]),
    "",
    "Commands:",
    ...plan.commands.map((command) => `- ${command}`),
  ].join("\n");
}

export function formatCeoRestoreRunText(plan: CeoRestoreRunPlan): string {
  return [
    "CEO Assistant Restore",
    `Ready: ${plan.ready ? "yes" : "no"}`,
    `Mode: ${plan.execute ? "execute" : "dry-run"}`,
    `Target env: ${plan.targetDatabaseUrlEnv}`,
    `Dump: ${plan.dumpPath || "missing"}`,
    `Artifacts: ${plan.artifactsPath || "skipped"}`,
    `Manifest: ${plan.manifestPath || "skipped"}`,
    `Artifacts output dir: ${plan.artifactsOutputDir}`,
    "",
    "Blockers:",
    ...(plan.blockers.length ? plan.blockers.map((blocker) => `- ${blocker}`) : ["- none"]),
    "",
    "Commands:",
    ...plan.commands.map((command) => `- ${command}`),
  ].join("\n");
}

export function buildCeoBackupManifest(input: {
  plan: CeoBackupRunPlan;
  includeLocalArtifacts: boolean;
  now?: Date;
}): CeoBackupManifest {
  const files: CeoBackupManifestFile[] = [
    {
      role: "postgres_dump",
      path: input.plan.postgresDumpPath,
      sha256: hashFileSha256(input.plan.postgresDumpPath),
      bytes: statSync(input.plan.postgresDumpPath).size,
    },
  ];

  if (input.includeLocalArtifacts) {
    files.push({
      role: "local_artifacts",
      path: input.plan.localArtifactsPath,
      sha256: hashFileSha256(input.plan.localArtifactsPath),
      bytes: statSync(input.plan.localArtifactsPath).size,
    });
  }

  return {
    createdAt: (input.now || new Date()).toISOString(),
    backupDir: input.plan.backupDir,
    includedLocalArtifactDirs: input.plan.localArtifactPaths,
    excludedSensitiveDirs: input.plan.sensitiveArtifactPaths,
    files,
  };
}

export function verifyCeoBackupManifest(input: {
  manifestPath: string;
  expectedPaths: string[];
}): CeoBackupManifestVerification {
  let parsed: CeoBackupManifest;
  try {
    parsed = JSON.parse(readFileSync(input.manifestPath, "utf8")) as CeoBackupManifest;
  } catch (error: any) {
    return {
      ready: false,
      manifestPath: input.manifestPath,
      checks: [],
      blockers: [`Could not read backup manifest: ${error.message || String(error)}`],
    };
  }

  const manifestFiles = Array.isArray(parsed.files) ? parsed.files : [];
  const checks = input.expectedPaths.map((filePath): CeoBackupManifestVerificationCheck => {
    const entry = manifestFiles.find((file) => file.path === filePath);
    if (!entry?.sha256) {
      return {
        path: filePath,
        ok: false,
        expectedSha256: null,
        actualSha256: null,
        expectedBytes: null,
        actualBytes: null,
        error: `Backup manifest does not include checksum for ${filePath}`,
      };
    }

    try {
      const actualSha256 = hashFileSha256(filePath);
      const actualBytes = statSync(filePath).size;
      const expectedBytes = typeof entry.bytes === "number" ? entry.bytes : null;
      const ok = actualSha256 === entry.sha256 && (expectedBytes === null || actualBytes === expectedBytes);
      return {
        path: filePath,
        ok,
        expectedSha256: entry.sha256,
        actualSha256,
        expectedBytes,
        actualBytes,
        error: ok
          ? null
          : actualSha256 !== entry.sha256
            ? `Checksum mismatch for ${filePath}`
            : `Size mismatch for ${filePath}`,
      };
    } catch (error: any) {
      return {
        path: filePath,
        ok: false,
        expectedSha256: entry.sha256,
        actualSha256: null,
        expectedBytes: typeof entry.bytes === "number" ? entry.bytes : null,
        actualBytes: null,
        error: error.message || String(error),
      };
    }
  });

  const blockers = checks.filter((check) => !check.ok).map((check) => check.error || `Manifest check failed for ${check.path}`);
  return {
    ready: blockers.length === 0,
    manifestPath: input.manifestPath,
    checks,
    blockers,
  };
}
