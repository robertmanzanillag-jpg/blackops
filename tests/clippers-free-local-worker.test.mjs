import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runClipperFreeLocalWorker } from "../script/clippers-free-local-worker.mjs";

test("writes an observable running report before starting marketplace work", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-start-report-"));
  let observed;
  await runClipperFreeLocalWorker({
    projectRoot,
    run() {
      if (!observed) {
        observed = JSON.parse(readFileSync(path.join(projectRoot, "clippers_workspace/reports/free-local-worker/latest.json"), "utf8"));
      }
      return { command: "mock", status: 2, signal: null, stdout: "", stderr: "blocked" };
    },
  });
  assert.equal(observed.status, "running");
  assert.equal(observed.projectRoot, projectRoot);
  assert.match(observed.startedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("recovers a fresh lock left by a dead worker process during reinstall", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-dead-lock-"));
  const stateDir = path.join(projectRoot, "clippers_workspace/reports/free-local-worker");
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, "worker.lock"), JSON.stringify({ pid: 2_147_483_647, startedAt: new Date().toISOString() }));
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    run() {
      return { command: "mock", status: 2, signal: null, stdout: "", stderr: "blocked" };
    },
  });
  assert.notEqual(result.status, "skipped");
  assert.equal(result.projectRoot, projectRoot);
});

test("recovers an empty lock left when a worker dies before writing its pid", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-empty-lock-"));
  const stateDir = path.join(projectRoot, "clippers_workspace/reports/free-local-worker");
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, "worker.lock"), "");
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    run() {
      return { command: "mock", status: 2, signal: null, stdout: "", stderr: "blocked" };
    },
  });
  assert.notEqual(result.status, "skipped");
  assert.equal(result.projectRoot, projectRoot);
});

test("stops honestly when no fresh authorized marketplace supply is available", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-no-supply-"));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    run(command, args) {
      calls.push([command, ...args]);
      const isIntake = args.includes("clippers:marketplace-intake");
      return { command: [command, ...args].join(" "), status: isIntake ? 2 : 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.failedStage, "supply");
  assert.equal(result.retryable, true);
  assert.deepEqual(calls, [
    ["npm", "run", "clippers:marketplace-refresh"],
    ["npm", "run", "clippers:marketplace-intake"],
  ]);
  assert.equal(result.planning.status, null);
  assert.equal(result.delivery.status, null);
});

test("runs local CEO planning but reports a clear blocker when publishing is not authorized", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-"));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    run(command, args, options) {
      calls.push({ command, args, env: options.env });
      return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "ok", stderr: "" };
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.failedStage, "delivery");
  assert.equal(result.retryable, true);
  assert.deepEqual(result.configurationBlockers, ["metricool_autopublish_not_authorized"]);
  assert.equal(result.paidAiUsed, false);
  assert.equal(result.paidSpendAllowed, false);
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
    ["npm", "run", "clippers:marketplace-refresh"],
    ["npm", "run", "clippers:marketplace-intake"],
    ["npm", "run", "clippers:render-campaign-drafts"],
    ["npm", "run", "clippers:streamer-growth-ceo"],
    ["node", "script/clippers-cleanup-published-vyro-media.mjs"],
  ]);
  assert.equal(calls[0].env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED, "false");
  assert.equal(calls[0].env.CLIPPERS_TARGET_DAILY_CLIPS, "5");
  const saved = JSON.parse(await readFile(result.reportPath, "utf8"));
  assert.equal(saved.metricoolDeliveryEnabled, false);
  assert.match(saved.note, /did not run because explicit authorization is missing/);
});

test("honors an explicit workspace root outside the project directory", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-project-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-workspace-"));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    env: { CLIPPERS_WORKSPACE_ROOT: workspaceRoot },
    run(command, args, options) {
      calls.push({ command, args, env: options.env });
      return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.reportPath, path.join(workspaceRoot, "reports", "free-local-worker", "latest.json"));
  assert.equal(calls[0].env.CLIPPERS_WORKSPACE_ROOT, workspaceRoot);
});

test("strips paid AI credentials from subprocesses", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-env-"));
  let observedEnv;
  await runClipperFreeLocalWorker({
    projectRoot,
    env: { OPENAI_API_KEY: "must-not-pass" },
    run(_command, _args, options) {
      observedEnv = options.env;
      return { command: "ok", status: 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(observedEnv.OPENAI_API_KEY, undefined);
  assert.equal(observedEnv.METRICOOL_USER_TOKEN, undefined);
  assert.equal(observedEnv.GOOGLE_API_KEY, undefined);
  assert.equal(observedEnv.PATH, process.env.PATH);
});

test("passes only Metricool delivery credentials after explicit authorization", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-live-"));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    env: {
      CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
      METRICOOL_USER_TOKEN: "metricool-secret",
      METRICOOL_USER_ID: "3558197",
      CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      OPENAI_API_KEY: "must-not-pass",
    },
    run(command, args, options) {
      calls.push({ command, args, env: options.env });
      return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.metricoolDeliveryEnabled, true);
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
    ["npm", "run", "clippers:marketplace-refresh"],
    ["npm", "run", "clippers:marketplace-intake"],
    ["npm", "run", "clippers:render-campaign-drafts"],
    ["npm", "run", "clippers:streamer-growth-ceo"],
    ["node", "script/clippers-metricool-autopilot.mjs"],
    ["npm", "run", "clippers:reconcile-publications"],
    ["node", "script/clippers-cleanup-published-vyro-media.mjs"],
  ]);
  assert.equal(calls[4].env.METRICOOL_USER_TOKEN, "metricool-secret");
  assert.equal(calls[4].env.METRICOOL_USER_ID, "3558197");
  assert.equal(calls[4].env.CLIPPERS_METRICOOL_BLOG_ID, "6431687");
  assert.equal(calls[4].env.OPENAI_API_KEY, undefined);
});

test("reloads selected project authorization on every run instead of freezing LaunchAgent defaults", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-config-"));
  await writeFile(path.join(projectRoot, ".env.local"), [
    "CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED=true",
    "METRICOOL_USER_TOKEN=metricool-secret",
    "METRICOOL_USER_ID=3558197",
    "CLIPPERS_METRICOOL_BLOG_ID=6431687",
  ].join("\n"));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    env: {
      CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "",
      METRICOOL_USER_TOKEN: "",
      METRICOOL_USER_ID: "",
      CLIPPERS_METRICOOL_BLOG_ID: "",
    },
    run(command, args, options) {
      calls.push({ command, args, env: options.env });
      return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.loadedConfigurationFiles, [".env.local"]);
  assert.equal(calls.some(({ args }) => args.includes("script/clippers-metricool-autopilot.mjs")), true);
});

test("loads selected credentials from a separate config root", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-project-"));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-config-root-"));
  await writeFile(path.join(configRoot, ".env.local"), [
    "METRICOOL_USER_TOKEN=metricool-from-config-root",
    "METRICOOL_USER_ID=3558197",
    "CLIPPERS_METRICOOL_BLOG_ID=6431687",
    "OPENAI_API_KEY=must-not-load",
  ].join("\n"));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    configRoot,
    env: { CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true" },
    run(command, args, options) {
      calls.push({ command, args, env: options.env });
      return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.configRoot, configRoot);
  assert.deepEqual(result.loadedConfigurationFiles, [".env.local"]);
  assert.equal(calls[4].env.METRICOOL_USER_TOKEN, "metricool-from-config-root");
  assert.equal(calls[4].env.OPENAI_API_KEY, undefined);
});

test("loads the marketplace refresh adapter configuration without passing unrelated secrets", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-refresh-config-"));
  await writeFile(path.join(projectRoot, "CEO_ASSISTANT_ENV"), [
    "CLIPPERS_MARKETPLACE_REFRESH_CONFIG=/safe/marketplace-refresh.json",
    "CLIPPERS_MARKETPLACE_REFRESH_TIMEOUT_MS=45000",
    "OPENAI_API_KEY=must-not-load",
  ].join("\n"));
  let refreshEnv;
  await runClipperFreeLocalWorker({
    projectRoot,
    run(_command, args, options) {
      if (args.includes("clippers:marketplace-refresh")) refreshEnv = options.env;
      return { command: "ok", status: 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(refreshEnv.CLIPPERS_MARKETPLACE_REFRESH_CONFIG, "/safe/marketplace-refresh.json");
  assert.equal(refreshEnv.CLIPPERS_MARKETPLACE_REFRESH_TIMEOUT_MS, "45000");
  assert.equal(refreshEnv.OPENAI_API_KEY, undefined);
});

test("uploads public campaign media before CEO planning when explicitly authorized", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-media-"));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    env: {
      CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: "true",
      CLIPPERS_PUBLIC_MEDIA_PROVIDER: "google_drive",
      GOOGLE_CLIENT_ID: "drive-client",
      GOOGLE_CLIENT_SECRET: "drive-secret",
      GOOGLE_DRIVE_REFRESH_TOKEN: "drive-refresh",
      CLIPPERS_METRICOOL_BLOG_ID: "6431687",
    },
    run(command, args, options) {
      calls.push({ command, args, env: options.env });
      return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.publicMediaUploadEnabled, true);
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
    ["npm", "run", "clippers:marketplace-refresh"],
    ["npm", "run", "clippers:marketplace-intake"],
    ["npm", "run", "clippers:render-campaign-drafts"],
    ["npm", "run", "clippers:upload-metricool-media"],
    ["npm", "run", "clippers:streamer-growth-ceo"],
    ["node", "script/clippers-cleanup-published-vyro-media.mjs"],
  ]);
  assert.equal(calls[3].env.GOOGLE_CLIENT_ID, "drive-client");
  assert.equal(calls[3].env.GOOGLE_DRIVE_REFRESH_TOKEN, "drive-refresh");
  assert.equal(calls[3].env.CLIPPERS_METRICOOL_BLOG_ID, "6431687");
  assert.equal(calls[3].env.OPENAI_API_KEY, undefined);
});

test("continues with a fresh verified snapshot when every live provider refresh is temporarily unavailable", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-refresh-fallback-"));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    run(command, args) {
      calls.push([command, ...args]);
      const refresh = args.includes("clippers:marketplace-refresh");
      return { command: [command, ...args].join(" "), status: refresh ? 2 : 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.supplyRefresh.status, 2);
  assert.deepEqual(result.degradedStages, ["supply_refresh"]);
  assert.notEqual(result.failedStage, "supply");
  assert.equal(calls.some((call) => call.includes("clippers:marketplace-intake")), true);
  assert.equal(calls.some((call) => call.includes("clippers:streamer-growth-ceo")), true);
});

test("reconciles earlier Metricool posts even when today's marketplace intake is blocked", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-reconcile-without-supply-"));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    env: {
      CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
      METRICOOL_USER_TOKEN: "metricool-secret",
      METRICOOL_USER_ID: "3558197",
      CLIPPERS_METRICOOL_BLOG_ID: "6431687",
    },
    run(command, args) {
      calls.push([command, ...args]);
      const intake = args.includes("clippers:marketplace-intake");
      return { command: [command, ...args].join(" "), status: intake ? 2 : 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.failedStage, "supply");
  assert.equal(result.reconciliation.status, 0);
  assert.deepEqual(calls, [
    ["npm", "run", "clippers:marketplace-refresh"],
    ["npm", "run", "clippers:marketplace-intake"],
    ["npm", "run", "clippers:reconcile-publications"],
  ]);
});

test("reports an honest partial outcome while delivering the strong clips that passed quality gates", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-free-worker-partial-render-"));
  const workspaceRoot = path.join(projectRoot, "workspace");
  await mkdir(path.join(workspaceRoot, "reports"), { recursive: true });
  await writeFile(path.join(workspaceRoot, "reports", "campaign-draft-renderer.json"), JSON.stringify({
    status: "partial",
    summary: { rendered: 2, missingAgainstTarget: 3 },
  }));
  const calls = [];
  const result = await runClipperFreeLocalWorker({
    projectRoot,
    workspaceRoot,
    env: {
      CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
      METRICOOL_USER_TOKEN: "metricool-secret",
      METRICOOL_USER_ID: "3558197",
      CLIPPERS_METRICOOL_BLOG_ID: "6431687",
    },
    run(command, args) {
      calls.push([command, ...args]);
      return { command: [command, ...args].join(" "), status: 0, signal: null, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "partial");
  assert.equal(result.failedStage, null);
  assert.equal(result.retryable, true);
  assert.equal(result.renderingReport.summary.missingAgainstTarget, 3);
  assert.equal(calls.some((call) => call.includes("clippers:streamer-growth-ceo")), true);
});
