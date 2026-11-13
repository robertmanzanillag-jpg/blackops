import "../server/env-loader";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CEO_BACKUP_ARTIFACT_PATHS,
  buildCeoBackupCheckReport,
  formatCeoBackupCheckJson,
  formatCeoBackupCheckText,
  parseCeoBackupCheckArgs,
  resolveCeoBackupDir,
} from "../server/ceo-backup-check-cli";
import { hasRealValue } from "../server/ceo-doctor-cli";

function hasTool(tool: string): boolean {
  return spawnSync(tool, ["--version"], { stdio: "ignore" }).status === 0;
}

function ensureWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const options = parseCeoBackupCheckArgs(process.argv.slice(2));
const backupDir = resolveCeoBackupDir(process.env.CEO_BACKUP_DIR);
const absoluteBackupDir = path.resolve(process.cwd(), backupDir);
const existingArtifactPaths = CEO_BACKUP_ARTIFACT_PATHS
  .filter((artifact) => fs.existsSync(path.resolve(process.cwd(), artifact.path)))
  .map((artifact) => artifact.path);

const report = buildCeoBackupCheckReport({
  databaseUrlConfigured: hasRealValue(process.env.DATABASE_URL),
  backupDir,
  backupDirWritable: ensureWritableDir(absoluteBackupDir),
  encryptedSecretBackupConfigured: process.env.CEO_BACKUP_SECRETS_ENCRYPTED === "true",
  availableTools: {
    pg_dump: hasTool("pg_dump"),
    pg_restore: hasTool("pg_restore"),
    psql: hasTool("psql"),
    tar: hasTool("tar"),
  },
  existingArtifactPaths,
});

console.log(options.json ? formatCeoBackupCheckJson(report) : formatCeoBackupCheckText(report));
process.exit(report.ready ? 0 : 1);
