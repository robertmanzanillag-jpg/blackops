#!/usr/bin/env node
// Release gate: runs EVERY tests/*.test.ts and tests/*.test.mjs file, each in its own
// `node --import tsx --test --test-reporter=tap` process with a hard timeout, collects the names of
// the failing TESTS (not just files) and compares them with the tracked allowlist
// script/release-gate/known-failures.json, where each entry lists its expected "failing" names.
//
//   - a failing test whose file is NOT in the allowlist          -> gate fails (new regression)
//   - a failing test NOT listed in its entry's "failing" names   -> gate fails (new regression),
//     also for "flaky" entries (flaky only tolerates the listed tests passing sometimes)
//   - a listed test (or the whole file) that now passes           -> gate fails (stale: remove it),
//     unless the entry is marked "flaky"
//   - an allowlist entry whose file no longer exists             -> gate fails (stale entry)
//   - a STRICT file fails                                         -> gate fails even if allowlisted.
//     Strict files = every tests/* script named in the factory workflows given with --strict-from
//     (factory-candidate-checks.yml, factory-build-recovery-checks.yml), so the factory list is
//     always 100% green and stays in sync with those files without copying it. Strict scripts that
//     are not *.test.* files (e.g. tests/marketing-learning-ui.mjs) run as `node --import tsx <file>`.
//     A --strict-from workflow that is missing or names no tests is an error.
//
// Special failing names: "<timeout>" (killed at the time limit), "<exit N without a failing test>".
//
// Usage: node script/release-gate/run-tests.mjs [--out report.json] [--only a.test.ts,b.test.ts]
//                                               [--strict-from wf1.yml,wf2.yml]
// Env:   GATE_TEST_CONCURRENCY (default: CPU count), GATE_TEST_TIMEOUT_MS (default 240000)
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const outFile = argValue("--out");
const only = argValue("--only")?.split(",").map((value) => value.trim()).filter(Boolean);
const concurrency = Math.max(1, Number(process.env.GATE_TEST_CONCURRENCY) || os.cpus().length);
const timeoutMs = Math.max(10_000, Number(process.env.GATE_TEST_TIMEOUT_MS) || 240_000);
const allowlistPath = path.join(root, "script/release-gate/known-failures.json");
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const known = new Map(Object.entries(allowlist.knownFailures || {}));
const strict = new Set();
for (const workflow of (argValue("--strict-from") || "").split(",").map((v) => v.trim()).filter(Boolean)) {
  if (!existsSync(workflow)) {
    console.log(`::error file=${workflow}::--strict-from workflow is missing; the factory test list cannot be verified`);
    process.exit(1);
  }
  const before = strict.size;
  for (const match of readFileSync(workflow, "utf8").matchAll(/tests\/[A-Za-z0-9._-]+\.(?:test\.)?(?:ts|mjs)\b/g)) strict.add(match[0]);
  if (strict.size === before) {
    console.log(`::error file=${workflow}::--strict-from workflow names no tests; the factory test list cannot be verified`);
    process.exit(1);
  }
}
const isTestFile = (file) => /\.test\.(ts|mjs)$/.test(file);

const files = [...new Set([
  ...(only || readdirSync(path.join(root, "tests"))
    // "._*" are tracked macOS AppleDouble metadata files, not tests.
    .filter((name) => isTestFile(name) && !name.startsWith("._"))
    .map((name) => `tests/${name}`)),
  // Strict scripts that are not *.test.* files are not picked up by the directory scan.
  ...(only ? [] : [...strict].filter((file) => !isTestFile(file) && existsSync(path.join(root, file)))),
])].sort();

// Tests must never see real credentials or a real database: the gate passes a scrubbed env.
const SCRUB = /(^DATABASE_URL$|_DATABASE_URL$|API_KEY|TOKEN|SECRET|PASSWORD|^PG[A-Z]+$|^GH_|^GITHUB_TOKEN$)/;
function testEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!SCRUB.test(key)) env[key] = value;
  env.NODE_ENV = "test";
  env.CI = "true";
  return env;
}

function runOne(file) {
  // A known-hanging file may carry a shorter "timeoutMs" so it does not hold the job for the full limit.
  const limit = Math.min(timeoutMs, Number(known.get(file)?.timeoutMs) || timeoutMs);
  return new Promise((resolve) => {
    const started = Date.now();
    const argv = isTestFile(file) ? ["--import", "tsx", "--test", "--test-reporter=tap", file] : ["--import", "tsx", file];
    const child = spawn(process.execPath, argv, {
      cwd: root,
      env: testEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "";
    const append = (chunk) => {
      output += chunk.toString();
      if (output.length > 200_000) output = output.slice(-100_000);
    };
    // TAP is parsed line by line as it arrives so names survive even if the output is truncated.
    const failing = new Set();
    const subtests = [];
    let pending = "";
    const parse = (chunk) => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        const subtest = /^( *)# Subtest: (.*)$/.exec(line);
        if (subtest) { const level = Math.floor(subtest[1].length / 4); subtests.length = level; subtests[level] = subtest[2].trim(); continue; }
        const result = /^( *)not ok \d+ - (.*?)(?: # (?:SKIP|TODO).*)?$/.exec(line);
        if (!result) continue;
        const level = Math.floor(result[1].length / 4);
        const name = result[2].trim();
        failing.add([...subtests.slice(0, level), name].filter(Boolean).join(" > "));
      }
    };
    child.stdout.on("data", (chunk) => { append(chunk); if (isTestFile(file)) parse(chunk); });
    child.stderr.on("data", append);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }, limit);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // Kill any orphaned grandchildren (servers, browsers) the test left behind.
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
      const status = timedOut ? "timeout" : code === 0 ? "pass" : "fail";
      if (timedOut) failing.add("<timeout>");
      else if (status === "fail" && failing.size === 0) failing.add(`<exit ${code ?? signal} without a failing test>`);
      resolve({ file, status, code, signal, failing: [...failing].sort(), durationMs: Date.now() - started, tail: status === "pass" ? "" : output.slice(-4000) });
    });
  });
}

const results = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++];
    const result = await runOne(file);
    results.push(result);
    const mark = result.status === "pass" ? "ok  " : result.status.toUpperCase().padEnd(4);
    console.log(`${mark} ${(result.durationMs / 1000).toFixed(1).padStart(6)}s ${file}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
results.sort((a, b) => a.file.localeCompare(b.file));

const newFailures = [];
const knownFailing = [];
const staleEntries = [];
for (const result of results) {
  const entry = known.get(result.file);
  if (result.status !== "pass" && strict.has(result.file)) { newFailures.push({ ...result, strict: true, unexpected: result.failing }); continue; }
  if (result.status !== "pass" && !entry) { newFailures.push({ ...result, unexpected: result.failing }); continue; }
  if (!entry) continue;
  const expected = new Set(Array.isArray(entry.failing) ? entry.failing : []);
  const unexpected = result.failing.filter((name) => !expected.has(name));
  if (unexpected.length) newFailures.push({ ...result, unexpected });
  else if (result.status !== "pass") knownFailing.push(result);
  if (!entry.flaky) {
    const nowPassing = [...expected].filter((name) => !result.failing.includes(name));
    if (result.status === "pass") staleEntries.push({ file: result.file, reason: "now passes; remove it from known-failures.json" });
    else if (nowPassing.length) staleEntries.push({ file: result.file, reason: `listed tests now pass, remove them from "failing": ${nowPassing.map((n) => JSON.stringify(n)).join(", ")}` });
  }
}
if (!only) {
  for (const file of known.keys()) {
    if (strict.has(file)) staleEntries.push({ file, reason: "factory (strict) test can never be allowlisted" });
    if (!existsSync(path.join(root, file))) staleEntries.push({ file, reason: "file no longer exists; remove it from known-failures.json" });
  }
}

const summary = {
  total: results.length,
  passed: results.filter((r) => r.status === "pass").length,
  strictFiles: strict.size,
  strictMissing: [...strict].filter((file) => !results.some((r) => r.file === file)),
  knownFailing: knownFailing.map((r) => ({ file: r.file, status: r.status, failing: r.failing, reason: known.get(r.file).reason })),
  newFailures: newFailures.map((r) => ({ file: r.file, status: r.status, durationMs: r.durationMs, unexpected: r.unexpected, ...(r.strict ? { strict: true } : {}) })),
  staleEntries,
  slowest: [...results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10).map((r) => ({ file: r.file, seconds: Math.round(r.durationMs / 1000) })),
};

for (const failure of newFailures) {
  console.log(`\n::group::NEW FAILURE ${failure.file} (${failure.status})`);
  console.log(failure.tail);
  // Machine-readable names, to copy into known-failures.json only with an owner-approved reason.
  console.log(`failing names: ${JSON.stringify({ file: failure.file, failing: failure.failing })}`);
  console.log("::endgroup::");
  for (const name of failure.unexpected) console.log(`::error file=${failure.file}::New failing test${failure.strict ? " (factory list)" : ""}: ${name}`);
}
for (const stale of staleEntries) console.log(`::error file=script/release-gate/known-failures.json::${stale.file}: ${stale.reason}`);

console.log(`\n${summary.passed}/${summary.total} test files passed; ${knownFailing.length} known (allowlisted) failures; ${newFailures.length} new failures; ${staleEntries.length} stale allowlist entries.`);
if (outFile) writeFileSync(outFile, `${JSON.stringify({ ...summary, results: results.map(({ tail, ...rest }) => rest) }, null, 2)}\n`);
if (!only) for (const file of summary.strictMissing) console.log(`::error::${file} is listed by a factory workflow but was not run (missing file?)`);
process.exitCode = newFailures.length || staleEntries.length || (!only && summary.strictMissing.length) ? 1 : 0;
