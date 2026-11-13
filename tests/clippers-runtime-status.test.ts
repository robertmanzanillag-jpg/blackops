import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getClipperWorkerRuntimeStatus } from "../server/clippers-runtime-status";

async function fixture(report?: Record<string, unknown>, lock?: Record<string, unknown>) {
  const workspaceRoot = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "clippers-runtime-status-")),
  );
  const stateDirectory = path.join(workspaceRoot, "reports", "free-local-worker");
  await mkdir(stateDirectory, { recursive: true });
  if (report) await writeFile(path.join(stateDirectory, "latest.json"), JSON.stringify(report));
  if (lock) await writeFile(path.join(stateDirectory, "worker.lock"), JSON.stringify(lock));
  return workspaceRoot;
}

const NOW = new Date("2026-08-05T11:00:00.000Z");

test("reports never_run without leaking local paths when no worker evidence exists", async () => {
  const workspaceRoot = await fixture();
  const status = await getClipperWorkerRuntimeStatus({ workspaceRoot, now: NOW });

  assert.equal(status.status, "never_run");
  assert.equal(status.lastExecution, null);
  assert.equal(status.delivery.enabled, false);
  assert.equal(status.upload.enabled, false);
  assert.equal(status.nextAction.code, "start_worker");
  assert.equal(JSON.stringify(status).includes(workspaceRoot), false);
});

test("reports a recent lock as running without exposing its pid", async () => {
  const workspaceRoot = await fixture(undefined, {
    pid: 98765,
    startedAt: "2026-08-05T10:58:00.000Z",
  });
  const status = await getClipperWorkerRuntimeStatus({ workspaceRoot, now: NOW });

  assert.equal(status.status, "running");
  assert.equal(status.lastExecution?.startedAt, "2026-08-05T10:58:00.000Z");
  assert.equal(status.nextAction.code, "wait_for_current_run");
  assert.equal(JSON.stringify(status).includes("98765"), false);
});

test("reports completed delivery and upload capabilities from the latest report", async () => {
  const workspaceRoot = await fixture({
    status: "completed",
    startedAt: "2026-08-05T09:59:00.000Z",
    finishedAt: "2026-08-05T10:01:00.000Z",
    metricoolDeliveryEnabled: true,
    publicMediaUploadEnabled: true,
    publishingSurface: "metricool",
    projectRoot: "/private/secret/project",
    loadedConfigurationFiles: ["/private/secret/.env"],
  });
  const status = await getClipperWorkerRuntimeStatus({ workspaceRoot, now: NOW });

  assert.equal(status.status, "completed");
  assert.deepEqual(status.delivery, { enabled: true, surface: "metricool" });
  assert.deepEqual(status.upload, { enabled: true });
  assert.equal(status.nextAction.code, "monitor_next_run");
  assert.equal(JSON.stringify(status).includes("/private/secret"), false);
});

test("reports the failed stage and a safe remediation for a blocked run", async () => {
  const workspaceRoot = await fixture({
    status: "blocked",
    startedAt: "2026-08-05T09:59:00.000Z",
    finishedAt: "2026-08-05T10:01:00.000Z",
    failedStage: "planning",
    metricoolDeliveryEnabled: true,
    publicMediaUploadEnabled: true,
    configurationBlockers: ["metricool_user_token_missing", "arbitrary secret text"],
    planning: { stderr: "token=do-not-expose" },
  });
  const status = await getClipperWorkerRuntimeStatus({ workspaceRoot, now: NOW });

  assert.equal(status.status, "blocked");
  assert.equal(status.failedStage, "planning");
  assert.deepEqual(status.configurationBlockers, ["metricool_user_token_missing"]);
  assert.equal(status.nextAction.code, "repair_planning");
  assert.equal(JSON.stringify(status).includes("do-not-expose"), false);
  assert.equal(JSON.stringify(status).includes("arbitrary secret text"), false);
});

test("preserves safe supply and reconciliation failures with specific remediation", async () => {
  for (const [failedStage, action] of [
    ["supply", "refresh_marketplace_supply"],
    ["reconciliation", "repair_publication_reconciliation"],
  ] as const) {
    const workspaceRoot = await fixture({
      status: "blocked",
      startedAt: "2026-08-05T09:59:00.000Z",
      finishedAt: "2026-08-05T10:01:00.000Z",
      failedStage,
      metricoolDeliveryEnabled: true,
      publicMediaUploadEnabled: true,
    });
    const status = await getClipperWorkerRuntimeStatus({ workspaceRoot, now: NOW });
    assert.equal(status.failedStage, failedStage);
    assert.equal(status.nextAction.code, action);
  }
});

test("marks an old report stale while retaining its safe failed-stage signal", async () => {
  const workspaceRoot = await fixture({
    status: "blocked",
    startedAt: "2026-08-01T09:59:00.000Z",
    finishedAt: "2026-08-01T10:01:00.000Z",
    failedStage: "delivery",
    metricoolDeliveryEnabled: true,
    publicMediaUploadEnabled: true,
  });
  const status = await getClipperWorkerRuntimeStatus({ workspaceRoot, now: NOW });

  assert.equal(status.status, "stale");
  assert.equal(status.failedStage, "delivery");
  assert.equal(status.lastExecution?.outcome, "blocked");
  assert.equal(status.nextAction.code, "restore_worker_schedule");
});

test("fails closed for malformed report fields", async () => {
  const workspaceRoot = await fixture({
    status: "unexpected",
    startedAt: "not-a-date",
    failedStage: "../../credentials",
    metricoolDeliveryEnabled: "true",
    publicMediaUploadEnabled: 1,
  });
  const status = await getClipperWorkerRuntimeStatus({ workspaceRoot, now: NOW });

  assert.equal(status.status, "blocked");
  assert.equal(status.failedStage, null);
  assert.equal(status.lastExecution, null);
  assert.equal(status.delivery.enabled, false);
  assert.equal(status.upload.enabled, false);
  assert.equal(JSON.stringify(status).includes("credentials"), false);
});

test("treats a corrupt report as blocked instead of claiming the worker never ran", async () => {
  const workspaceRoot = await fixture();
  const reportPath = path.join(workspaceRoot, "reports", "free-local-worker", "latest.json");
  await writeFile(reportPath, "{not-json");

  const status = await getClipperWorkerRuntimeStatus({ workspaceRoot, now: NOW });

  assert.equal(status.status, "blocked");
  assert.equal(status.failedStage, "runtime_report");
  assert.equal(status.lastExecution, null);
  assert.equal(status.nextAction.code, "repair_runtime_report");
});

test("treats an abandoned old lock as stale interrupted execution", async () => {
  const workspaceRoot = await fixture(undefined, {
    pid: 12345,
    startedAt: "2026-08-01T10:00:00.000Z",
  });

  const status = await getClipperWorkerRuntimeStatus({ workspaceRoot, now: NOW });

  assert.equal(status.status, "stale");
  assert.equal(status.failedStage, "runtime_report");
  assert.deepEqual(status.lastExecution, {
    startedAt: "2026-08-01T10:00:00.000Z",
    finishedAt: null,
    outcome: "blocked",
  });
  assert.equal(JSON.stringify(status).includes("12345"), false);
});
