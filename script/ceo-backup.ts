import "../server/env-loader";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildCeoBackupManifest,
  buildCeoBackupRunPlan,
  formatCeoBackupRunText,
  parseCeoBackupRunArgs,
} from "../server/ceo-backup-run-cli";
import { CEO_BACKUP_ARTIFACT_PATHS } from "../server/ceo-backup-check-cli";
import { hasRealValue } from "../server/ceo-doctor-cli";

function hasTool(command: string): boolean {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
}

const options = parseCeoBackupRunArgs(process.argv.slice(2));
const existingArtifactPaths = CEO_BACKUP_ARTIFACT_PATHS
  .filter((artifact) => fs.existsSync(path.resolve(process.cwd(), artifact.path)))
  .map((artifact) => artifact.path);
const plan = buildCeoBackupRunPlan({
  options,
  databaseUrlConfigured: hasRealValue(process.env.DATABASE_URL),
  encryptedSecretBackupConfigured: process.env.CEO_BACKUP_SECRETS_ENCRYPTED === "true",
  availableTools: {
    pg_dump: hasTool("pg_dump"),
    tar: hasTool("tar"),
  },
  existingArtifactPaths,
});

if (options.json) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log(formatCeoBackupRunText(plan));
}

if (!plan.ready) {
  process.exit(options.execute ? 1 : 0);
}

fs.mkdirSync(plan.backupDir, { recursive: true });
run("pg_dump", [
  process.env.DATABASE_URL!,
  "--format=custom",
  "--no-owner",
  "--no-acl",
  `--file=${plan.postgresDumpPath}`,
]);
if (plan.localArtifactPaths.length > 0) {
  run("tar", ["-czf", plan.localArtifactsPath, ...plan.localArtifactPaths]);
}

fs.writeFileSync(plan.manifestPath, JSON.stringify(buildCeoBackupManifest({
  plan,
  includeLocalArtifacts: fs.existsSync(plan.localArtifactsPath),
}), null, 2));
