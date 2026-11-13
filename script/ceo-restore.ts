import "../server/env-loader";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  buildCeoRestoreRunPlan,
  formatCeoRestoreRunText,
  parseCeoRestoreRunArgs,
  verifyCeoBackupManifest,
} from "../server/ceo-backup-run-cli";
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

const options = parseCeoRestoreRunArgs(process.argv.slice(2));
const targetDatabaseUrl = process.env[options.targetDatabaseUrlEnv];
const plan = buildCeoRestoreRunPlan({
  options,
  targetDatabaseUrlConfigured: hasRealValue(targetDatabaseUrl),
  dumpExists: Boolean(options.dumpPath && fs.existsSync(options.dumpPath)),
  artifactsExist: Boolean(options.artifactsPath && fs.existsSync(options.artifactsPath)),
  manifestExists: Boolean(options.manifestPath && fs.existsSync(options.manifestPath)),
  availableTools: {
    pg_restore: hasTool("pg_restore"),
    psql: hasTool("psql"),
    tar: hasTool("tar"),
  },
});
const manifestExpectedPaths = [options.dumpPath, options.artifactsPath].filter((value): value is string => Boolean(value));
const canVerifyManifest = Boolean(
  options.manifestPath &&
  fs.existsSync(options.manifestPath) &&
  manifestExpectedPaths.length > 0 &&
  manifestExpectedPaths.every((filePath) => fs.existsSync(filePath))
);
const manifestVerification = canVerifyManifest
  ? verifyCeoBackupManifest({ manifestPath: options.manifestPath!, expectedPaths: manifestExpectedPaths })
  : null;

if (options.json) {
  console.log(JSON.stringify({ ...plan, manifestVerification }, null, 2));
} else {
  console.log(formatCeoRestoreRunText(plan));
  if (manifestVerification) {
    console.log("");
    console.log("Manifest verification:");
    console.log(`- Ready: ${manifestVerification.ready ? "yes" : "no"}`);
    for (const check of manifestVerification.checks) {
      console.log(`- [${check.ok ? "ok" : "failed"}] ${check.path}${check.error ? `: ${check.error}` : ""}`);
    }
  }
}

if (manifestVerification && !manifestVerification.ready) {
  process.exit(1);
}

if (!plan.ready) {
  process.exit(options.execute ? 1 : 0);
}

run("psql", [targetDatabaseUrl!, "-c", "select 1"]);
run("pg_restore", [
  "--clean",
  "--if-exists",
  "--no-owner",
  "--no-acl",
  `--dbname=${targetDatabaseUrl}`,
  options.dumpPath!,
]);
if (options.artifactsPath) {
  fs.mkdirSync(plan.artifactsOutputDir, { recursive: true });
  run("tar", ["-xzf", options.artifactsPath, "-C", plan.artifactsOutputDir]);
}
