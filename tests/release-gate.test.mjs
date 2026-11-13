import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluate } from "../script/release-gate/post-publish-evaluate.mjs";
import { parseArgs, reviewKey } from "../script/release-gate/office-review-enqueue.ts";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const healthy = {
  readOnly: true,
  councilStateFound: true,
  roleWork: { present: true, valid: true },
  capabilityTraining: { present: true, valid: true },
  workers: [{ kind: "cloud", lastSeenAt: "2026-11-13T11:50:00Z" }],
  webSources: { ceo: { stored: true, ageSeconds: 600 }, cmo: { stored: true, ageSeconds: 1200 } },
};
const run = (conclusion, minutesAgo) => ({ status: "completed", conclusion, created_at: new Date(NOW - minutesAgo * 60_000).toISOString() });

test("post-publish watch: healthy production yields no codes", () => {
  const result = evaluate({ status: healthy, runs: [run("success", 5), run("failure", 20)], officeCloudEnabled: true, webSourcesEnabled: true, now: NOW });
  assert.deepEqual(result, { ok: true, codes: [] });
});

test("post-publish watch: three failed office runs in a row, invalid roleWork and stale export", () => {
  const status = { ...healthy, roleWork: { present: true, valid: false }, webSources: { ceo: { stored: true, ageSeconds: 7200 }, cmo: { stored: false } } };
  const result = evaluate({ status, runs: [run("failure", 5), run("cancelled", 10), run("failure", 20), run("failure", 35), run("success", 50)], officeCloudEnabled: true, webSourcesEnabled: true, now: NOW });
  assert.equal(result.ok, false);
  assert.deepEqual(result.codes.map((c) => c.code), ["OFFICE_RUNS_FAILING", "ROLE_WORK_INVALID", "WEB_EXPORT_MISSING", "WEB_EXPORT_STALE"]);
});

test("post-publish watch: paused features are not reported; missing diagnostic is", () => {
  const silent = { ...healthy, workers: [], webSources: {} };
  assert.deepEqual(evaluate({ status: silent, runs: [run("failure", 1), run("failure", 2), run("failure", 3)], officeCloudEnabled: false, webSourcesEnabled: false, now: NOW }).codes, []);
  assert.deepEqual(evaluate({ status: silent, runs: [], officeCloudEnabled: true, webSourcesEnabled: false, now: NOW }).codes.map((c) => c.code), ["OFFICE_WORKER_SILENT"]);
  assert.deepEqual(evaluate({ status: undefined, runs: [], officeCloudEnabled: false, webSourcesEnabled: false, now: NOW }).codes.map((c) => c.code), ["OFFICE_STATUS_UNAVAILABLE"]);
  const noTable = { readOnly: true, tables: { agent_council_state: false, office_agent_workers: true, office_web_role_sources: true } };
  assert.deepEqual(evaluate({ status: noTable, runs: [], officeCloudEnabled: false, webSourcesEnabled: false, now: NOW }).codes.map((c) => c.code), ["COUNCIL_STATE_MISSING"]);
});

test("office review enqueue: strict arguments and one deterministic key per PR head", () => {
  const pr = "https://github.com/robertmanzanillag-jpg/blackops/pull/12";
  const sha = "a".repeat(40);
  assert.deepEqual(parseArgs([`--pr-url=${pr}`, `--head-sha=${sha}`]), { prUrl: pr, headSha: sha, apply: false });
  assert.equal(parseArgs([`--pr-url=${pr}`, `--head-sha=${sha}`, "--apply"]).apply, true);
  assert.throws(() => parseArgs([`--pr-url=${pr}/files`, `--head-sha=${sha}`]), /PR_URL_INVALID/);
  assert.throws(() => parseArgs([`--pr-url=${pr}`, "--head-sha=abc"]), /HEAD_SHA_INVALID/);
  assert.throws(() => parseArgs([`--pr-url=${pr}`, `--head-sha=${sha}`, "--force"]), /ARGUMENT_INVALID/);
  assert.equal(reviewKey(pr, sha), reviewKey(pr, sha));
  assert.notEqual(reviewKey(pr, sha), reviewKey(pr, "b".repeat(40)));
  assert.match(reviewKey(pr, sha), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("diff hygiene: blocks secrets, env files and silent allowlist growth, never prints the secret", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gate-hygiene-"));
  try {
    const git = (...args) => execFileSync("git", ["-c", "user.email=gate@example.invalid", "-c", "user.name=gate", ...args], { cwd: dir, encoding: "utf8" });
    git("init", "--quiet");
    mkdirSync(path.join(dir, "script/release-gate"), { recursive: true });
    copyFileSync(path.resolve("script/release-gate/diff-hygiene.mjs"), path.join(dir, "script/release-gate/diff-hygiene.mjs"));
    writeFileSync(path.join(dir, "script/release-gate/known-failures.json"), JSON.stringify({ knownFailures: {} }));
    writeFileSync(path.join(dir, "app.ts"), "export const ok = 1;\n");
    git("add", "-A"); git("commit", "--quiet", "-m", "base");
    const base = git("rev-parse", "HEAD").trim();
    const hygiene = (labels = "") => spawnSync(process.execPath, ["script/release-gate/diff-hygiene.mjs", "--base", base], { cwd: dir, encoding: "utf8", env: { ...process.env, GATE_PR_LABELS: labels } });

    writeFileSync(path.join(dir, "app.ts"), "export const ok = 2;\n");
    git("commit", "--quiet", "-am", "clean");
    assert.equal(hygiene().status, 0);

    const fakeKey = ["ghp", "_", "A".repeat(36)].join("");
    writeFileSync(path.join(dir, "leak.ts"), `export const token = "${fakeKey}";\n`);
    writeFileSync(path.join(dir, ".env"), "X=1\n");
    git("add", "-A"); git("commit", "--quiet", "-m", "leak");
    const leaked = hygiene("gate-justified");
    assert.equal(leaked.status, 1);
    assert.match(leaked.stdout, /possible secret: GitHub token/);
    assert.match(leaked.stdout, /env file/);
    assert.doesNotMatch(leaked.stdout, new RegExp(fakeKey));
    git("rm", "--quiet", "leak.ts", ".env"); git("commit", "--quiet", "-m", "unleak");

    const entry = { reason: "fails because of a documented reason", failing: ["a", "b"] };
    const writeAllowlist = (knownFailures, sandboxIntegrationRoutes = {}) => {
      writeFileSync(path.join(dir, "script/release-gate/known-failures.json"), JSON.stringify({ knownFailures, sandboxIntegrationRoutes }));
      git("commit", "--quiet", "-am", "allowlist");
      return git("rev-parse", "HEAD").trim();
    };
    writeAllowlist({ "tests/x.test.ts": entry });
    assert.equal(hygiene().status, 1, "a new entry needs the label");
    assert.equal(hygiene("gate-justified").status, 0);

    // From a base that already has the entry: shrinking "failing" is free, any other change is not.
    const withEntry = git("rev-parse", "HEAD").trim();
    const hygieneFrom = (rev, labels = "") => spawnSync(process.execPath, ["script/release-gate/diff-hygiene.mjs", "--base", rev], { cwd: dir, encoding: "utf8", env: { ...process.env, GATE_PR_LABELS: labels } });
    writeAllowlist({ "tests/x.test.ts": { ...entry, failing: ["a"] } });
    assert.equal(hygieneFrom(withEntry).status, 0, "removing a fixed test name needs no label");
    git("reset", "--quiet", "--hard", withEntry);
    writeAllowlist({ "tests/x.test.ts": { ...entry, flaky: true } });
    const flaky = hygieneFrom(withEntry);
    assert.equal(flaky.status, 1, "making an entry flaky needs the label");
    assert.match(flaky.stdout, /changed allowlist entry/);
    git("reset", "--quiet", "--hard", withEntry);
    writeAllowlist({ "tests/x.test.ts": { ...entry, failing: ["a", "b", "c"] } });
    assert.equal(hygieneFrom(withEntry).status, 1, "adding a failing name needs the label");
    git("reset", "--quiet", "--hard", withEntry);
    writeAllowlist({}, {});
    assert.equal(hygieneFrom(withEntry).status, 0, "removing an entry needs no label");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
