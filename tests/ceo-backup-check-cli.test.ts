import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCeoBackupCheckReport,
  DEFAULT_CEO_BACKUP_DIR,
  formatCeoBackupCheckJson,
  formatCeoBackupCheckText,
  parseCeoBackupCheckArgs,
  resolveCeoBackupDir,
} from "../server/ceo-backup-check-cli";
import {
  buildCeoBackupManifest,
  buildCeoBackupRunPlan,
  buildCeoRestoreRunPlan,
  parseCeoBackupRunArgs,
  parseCeoRestoreRunArgs,
  validateRestoreTargetDatabaseEnvName,
  verifyCeoBackupManifest,
} from "../server/ceo-backup-run-cli";

const allTools = {
  pg_dump: true,
  pg_restore: true,
  psql: true,
  tar: true,
};

test("parses CEO backup check CLI options", () => {
  assert.deepEqual(parseCeoBackupCheckArgs(["--json"]), { json: true });
  assert.deepEqual(parseCeoBackupCheckArgs([]), { json: false });
});

test("resolves CEO backup dir from real values only", () => {
  assert.equal(resolveCeoBackupDir("backups/prod"), "backups/prod");
  assert.equal(resolveCeoBackupDir("replace-with-backup-dir"), DEFAULT_CEO_BACKUP_DIR);
  assert.equal(resolveCeoBackupDir(undefined), DEFAULT_CEO_BACKUP_DIR);
});

test("reports backup readiness when database tools and policies are configured", () => {
  const report = buildCeoBackupCheckReport({
    databaseUrlConfigured: true,
    backupDir: "backups/ceo-assistant",
    backupDirWritable: true,
    encryptedSecretBackupConfigured: true,
    availableTools: allTools,
    existingArtifactPaths: ["revenue_engine_data", "clippers_workspace", "CEO_ASSISTANT_ENV", "credentials"],
  });

  assert.equal(report.ready, true);
  assert.equal(report.tools.every((tool) => tool.ok), true);
  assert.equal(report.artifacts.find((artifact) => artifact.path === "clippers_workspace")?.policy, "include_if_exists");
  assert.match(report.commands.find((command) => command.includes("local-artifacts.tgz")) || "", /clippers_workspace/);
  assert.equal(report.artifacts.find((artifact) => artifact.path === "CEO_ASSISTANT_ENV")?.policy, "encrypted_only");
  assert.equal(report.artifacts.find((artifact) => artifact.path === "credentials")?.policy, "encrypted_only");
  assert.match(report.sensitiveArtifactNote, /intentionally excluded from local-artifacts\.tgz/);
  assert.doesNotMatch(report.commands.find((command) => command.includes("local-artifacts.tgz")) || "", /CEO_ASSISTANT_ENV|\.env|credentials|secrets/);
  assert.ok(report.commands.some((command) => command.includes("RESTORE_DATABASE_URL=<staging-db-url> pg_restore")));
  assert.doesNotMatch(report.commands.join("\n"), /pg_restore[^\n]+--dbname="\$DATABASE_URL"/);
});

test("blocks backup readiness when PostgreSQL tools are missing", () => {
  const report = buildCeoBackupCheckReport({
    databaseUrlConfigured: true,
    backupDir: "backups/ceo-assistant",
    backupDirWritable: true,
    encryptedSecretBackupConfigured: true,
    availableTools: { ...allTools, pg_dump: false },
    existingArtifactPaths: [],
  });

  assert.equal(report.ready, false);
  assert.equal(report.tools.find((tool) => tool.tool === "pg_dump")?.ok, false);
});

test("blocks backup readiness when sensitive local artifacts are not covered by encrypted backups", () => {
  const report = buildCeoBackupCheckReport({
    databaseUrlConfigured: true,
    backupDir: "backups/ceo-assistant",
    backupDirWritable: true,
    encryptedSecretBackupConfigured: false,
    availableTools: allTools,
    existingArtifactPaths: ["CEO_ASSISTANT_ENV", "secrets"],
  });

  assert.equal(report.ready, false);
  assert.match(report.artifacts.find((artifact) => artifact.path === "CEO_ASSISTANT_ENV")?.detail || "", /encrypted off-machine storage/);
  assert.match(report.artifacts.find((artifact) => artifact.path === "secrets")?.detail || "", /encrypted off-machine storage/);
  assert.match(report.sensitiveArtifactNote, /Do not run production with real data/);
});

test("formats CEO backup check text and JSON", () => {
  const report = buildCeoBackupCheckReport({
    databaseUrlConfigured: false,
    backupDir: "backups/ceo-assistant",
    backupDirWritable: false,
    encryptedSecretBackupConfigured: false,
    availableTools: {},
    existingArtifactPaths: [],
  });

  assert.match(formatCeoBackupCheckText(report), /CEO Assistant Backup Check/);
  assert.match(formatCeoBackupCheckText(report), /Sensitive artifact note:/);
  assert.equal(JSON.parse(formatCeoBackupCheckJson(report)).ready, false);
  assert.ok(report.commands.some((command) => command.includes("pg_restore")));
});

test("builds guarded backup execution plans without including secret directories", () => {
  const originalBackupDir = process.env.CEO_BACKUP_DIR;
  process.env.CEO_BACKUP_DIR = "replace-with-backup-dir";
  try {
    assert.equal(parseCeoBackupRunArgs([]).backupDir, DEFAULT_CEO_BACKUP_DIR);
  } finally {
    if (originalBackupDir === undefined) delete process.env.CEO_BACKUP_DIR;
    else process.env.CEO_BACKUP_DIR = originalBackupDir;
  }

  const dryRun = buildCeoBackupRunPlan({
    options: parseCeoBackupRunArgs(["--backup-dir", "backups/ceo-assistant", "--label=nightly"]),
    databaseUrlConfigured: true,
    encryptedSecretBackupConfigured: true,
    availableTools: { pg_dump: true, tar: true },
    existingArtifactPaths: ["revenue_engine_data", "clippers_workspace", "CEO_ASSISTANT_ENV", ".env", ".env.local", "credentials", "secrets"],
    now: new Date("2026-06-17T12:00:00.000Z"),
  });

  assert.equal(dryRun.ready, false);
  assert.match(dryRun.blockers.join("\n"), /Dry run only/);
  assert.deepEqual(dryRun.localArtifactPaths, ["revenue_engine_data", "clippers_workspace"]);
  assert.deepEqual(dryRun.sensitiveArtifactPaths, ["CEO_ASSISTANT_ENV", ".env", ".env.local", "credentials", "secrets"]);
  assert.doesNotMatch(dryRun.commands.join("\n"), /CEO_ASSISTANT_ENV|\.env|credentials|secrets/);

  const executable = buildCeoBackupRunPlan({
    options: parseCeoBackupRunArgs(["--execute", "--backup-dir=backups/ceo-assistant", "--label=nightly"]),
    databaseUrlConfigured: true,
    encryptedSecretBackupConfigured: true,
    availableTools: { pg_dump: true, tar: true },
    existingArtifactPaths: ["revenue_engine_data"],
    now: new Date("2026-06-17T12:00:00.000Z"),
  });

  assert.equal(executable.ready, true);
  assert.match(executable.postgresDumpPath, /backups\/ceo-assistant\/nightly\/postgres\.dump$/);
  assert.match(executable.manifestPath, /backups\/ceo-assistant\/nightly\/backup-manifest\.json$/);
  assert.match(executable.commands.join("\n"), /write SHA-256 manifest/);
});

test("restore execution plans require explicit dump target and destructive confirmation", () => {
  const unsafe = buildCeoRestoreRunPlan({
    options: parseCeoRestoreRunArgs(["--dump=backups/ceo-assistant/nightly/postgres.dump"]),
    targetDatabaseUrlConfigured: true,
    dumpExists: true,
    artifactsExist: false,
    manifestExists: false,
    availableTools: { pg_restore: true, psql: true, tar: true },
  });

  assert.equal(unsafe.ready, false);
  assert.equal(unsafe.targetDatabaseUrlEnv, "RESTORE_DATABASE_URL");
  assert.match(unsafe.blockers.join("\n"), /confirm-restore/);
  assert.match(unsafe.blockers.join("\n"), /Dry run only/);

  const executable = buildCeoRestoreRunPlan({
    options: parseCeoRestoreRunArgs([
      "--execute",
      "--confirm-restore",
      "--dump=backups/ceo-assistant/nightly/postgres.dump",
      "--artifacts=backups/ceo-assistant/nightly/local-artifacts.tgz",
      "--manifest=backups/ceo-assistant/nightly/backup-manifest.json",
      "--artifacts-output-dir=restored-artifacts/nightly",
      "--target-database-url-env=STAGING_DATABASE_URL",
    ]),
    targetDatabaseUrlConfigured: true,
    dumpExists: true,
    artifactsExist: true,
    manifestExists: true,
    availableTools: { pg_restore: true, psql: true, tar: true },
  });

  assert.equal(executable.ready, true);
  assert.equal(executable.targetDatabaseUrlEnv, "STAGING_DATABASE_URL");
  assert.equal(executable.manifestPath, "backups/ceo-assistant/nightly/backup-manifest.json");
  assert.match(executable.commands.join("\n"), /verify SHA-256 checksums/);
  assert.match(executable.commands.join("\n"), /\$STAGING_DATABASE_URL/);
  assert.equal(executable.artifactsOutputDir, "restored-artifacts/nightly");
  assert.match(executable.commands.join("\n"), /tar -xzf "backups\/ceo-assistant\/nightly\/local-artifacts\.tgz" -C "restored-artifacts\/nightly"/);
});

test("restore execution plans refuse production database targets", () => {
  assert.equal(validateRestoreTargetDatabaseEnvName("RESTORE_DATABASE_URL"), null);
  assert.equal(validateRestoreTargetDatabaseEnvName("STAGING_DATABASE_URL"), null);
  assert.equal(validateRestoreTargetDatabaseEnvName("TEST_DATABASE_URL"), null);
  assert.match(validateRestoreTargetDatabaseEnvName("DATABASE_URL") || "", /Refusing unsafe restore target/);
  assert.match(validateRestoreTargetDatabaseEnvName("PRODUCTION_DATABASE_URL") || "", /Refusing unsafe restore target/);
  assert.match(validateRestoreTargetDatabaseEnvName("PRIMARY_DB_URL") || "", /Refusing unsafe restore target/);
  assert.match(validateRestoreTargetDatabaseEnvName("restore-database-url") || "", /uppercase environment variable name/);

  const unsafeProductionTarget = buildCeoRestoreRunPlan({
    options: parseCeoRestoreRunArgs([
      "--execute",
      "--confirm-restore",
      "--dump=backups/ceo-assistant/nightly/postgres.dump",
      "--target-database-url-env=DATABASE_URL",
    ]),
    targetDatabaseUrlConfigured: true,
    dumpExists: true,
    artifactsExist: false,
    manifestExists: false,
    availableTools: { pg_restore: true, psql: true, tar: true },
  });

  assert.equal(unsafeProductionTarget.ready, false);
  assert.match(unsafeProductionTarget.blockers.join("\n"), /Refusing unsafe restore target/);
});

test("backup manifests verify dump and artifact checksums before restore", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ceo-backup-manifest-"));
  try {
    const dumpPath = path.join(dir, "postgres.dump");
    const artifactsPath = path.join(dir, "local-artifacts.tgz");
    const manifestPath = path.join(dir, "backup-manifest.json");
    writeFileSync(dumpPath, "dump-v1");
    writeFileSync(artifactsPath, "artifacts-v1");

    const plan = buildCeoBackupRunPlan({
      options: parseCeoBackupRunArgs(["--execute", `--backup-dir=${dir}`, "--label=nightly"]),
      databaseUrlConfigured: true,
      encryptedSecretBackupConfigured: true,
      availableTools: { pg_dump: true, tar: true },
      existingArtifactPaths: ["revenue_engine_data"],
      now: new Date("2026-06-17T12:00:00.000Z"),
    });
    const manifest = buildCeoBackupManifest({ plan: { ...plan, postgresDumpPath: dumpPath, localArtifactsPath: artifactsPath, manifestPath }, includeLocalArtifacts: true, now: new Date("2026-06-17T12:00:00.000Z") });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const valid = verifyCeoBackupManifest({ manifestPath, expectedPaths: [dumpPath, artifactsPath] });
    assert.equal(valid.ready, true);
    assert.equal(valid.checks.every((check) => check.ok), true);

    writeFileSync(artifactsPath, "corrupted");
    const invalid = verifyCeoBackupManifest({ manifestPath, expectedPaths: [dumpPath, artifactsPath] });
    assert.equal(invalid.ready, false);
    assert.match(invalid.blockers.join("\n"), /Checksum mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
