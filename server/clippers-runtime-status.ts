import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export type ClipperWorkerRuntimeState = "running" | "completed" | "blocked" | "stale" | "never_run";

const DEFAULT_STALE_AFTER_MS = 26 * 60 * 60_000;
const DEFAULT_RUNNING_MAX_AGE_MS = 2 * 60 * 60_000;
const KNOWN_FAILED_STAGES = new Set(["runtime_report", "supply", "media_upload", "planning", "delivery", "reconciliation", "cleanup"]);
const KNOWN_CONFIGURATION_BLOCKERS = new Set([
  "metricool_autopublish_not_authorized",
  "metricool_user_token_missing",
  "metricool_user_id_missing",
  "metricool_blog_id_missing",
]);

type RuntimeReport = Record<string, unknown>;

type RuntimeStatusOptions = {
  workspaceRoot?: string;
  now?: Date;
  staleAfterMs?: number;
  runningMaxAgeMs?: number;
};

function validTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function readJsonObject(filePath: string): Promise<{ exists: boolean; value: RuntimeReport | null }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return {
      exists: true,
      value: parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as RuntimeReport
        : null,
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { exists: false, value: null };
    return { exists: true, value: null };
  }
}

function reportOutcome(report: RuntimeReport | null): "completed" | "blocked" | null {
  if (report?.status === "completed" || report?.status === "blocked") return report.status;
  return null;
}

function safeFailedStage(report: RuntimeReport | null): string | null {
  const stage = typeof report?.failedStage === "string" ? report.failedStage : null;
  return stage && KNOWN_FAILED_STAGES.has(stage) ? stage : null;
}

function safeBlockers(report: RuntimeReport | null): string[] {
  if (!Array.isArray(report?.configurationBlockers)) return [];
  return report.configurationBlockers
    .filter((blocker): blocker is string => typeof blocker === "string" && KNOWN_CONFIGURATION_BLOCKERS.has(blocker));
}

function nextActionFor(input: {
  state: ClipperWorkerRuntimeState;
  failedStage: string | null;
  blockers: string[];
  deliveryEnabled: boolean;
  uploadEnabled: boolean;
}) {
  if (input.state === "running") {
    return { code: "wait_for_current_run", message: "Wait for the active worker run to finish, then refresh this status." };
  }
  if (input.state === "never_run") {
    return { code: "start_worker", message: "Start the Clippers worker and verify that its first report is written." };
  }
  if (input.state === "stale") {
    return { code: "restore_worker_schedule", message: "Run the worker now and verify its daily scheduler because the latest execution is stale." };
  }
  if (input.failedStage === "runtime_report") {
    return { code: "repair_runtime_report", message: "Repair or regenerate the unreadable worker report, then refresh runtime status." };
  }
  if (input.failedStage === "supply") {
    return { code: "refresh_marketplace_supply", message: "Refresh the authorized marketplace snapshots and rights evidence, then retry the worker." };
  }
  if (input.failedStage === "media_upload") {
    return { code: "repair_media_upload", message: "Repair the public media upload stage, then retry the same worker run." };
  }
  if (input.failedStage === "planning") {
    return { code: "repair_planning", message: "Inspect the non-secret planning report and eligible campaign supply, then rerun the worker." };
  }
  if (input.failedStage === "delivery") {
    if (input.blockers.includes("metricool_autopublish_not_authorized") || !input.deliveryEnabled) {
      return { code: "enable_metricool_delivery", message: "Enable the already-approved Metricool delivery setting, then run the worker again." };
    }
    if (input.blockers.length) {
      return { code: "repair_metricool_configuration", message: "Repair the missing Metricool configuration, then retry without exposing credentials in reports." };
    }
    return { code: "repair_metricool_delivery", message: "Inspect the Metricool delivery receipt and queue, then retry without creating duplicates." };
  }
  if (input.failedStage === "reconciliation") {
    return { code: "repair_publication_reconciliation", message: "Inspect the publication receipt and exact public TikTok URL, then reconcile without creating another post." };
  }
  if (input.failedStage === "cleanup") {
    return { code: "repair_cleanup", message: "Inspect the cleanup report; do not delete local media until public publication is confirmed." };
  }
  if (input.blockers.includes("metricool_autopublish_not_authorized") || !input.deliveryEnabled) {
    return { code: "enable_metricool_delivery", message: "Enable the already-approved Metricool delivery setting, then run the worker again." };
  }
  if (input.blockers.length) {
    return { code: "repair_metricool_configuration", message: "Repair the missing Metricool configuration, then retry without exposing credentials in reports." };
  }
  if (!input.uploadEnabled) {
    return { code: "enable_public_media_upload", message: "Enable the approved public media upload stage before the next delivery run." };
  }
  if (input.state === "blocked") {
    return { code: "inspect_worker_report", message: "Inspect the latest non-secret worker report and retry only the failed stage." };
  }
  return { code: "monitor_next_run", message: "No runtime failure is reported; monitor the next scheduled run and publication receipts." };
}

export async function getClipperWorkerRuntimeStatus(options: RuntimeStatusOptions = {}) {
  const workspaceRoot = path.resolve(
    options.workspaceRoot || process.env.CLIPPERS_WORKSPACE_ROOT || path.join(process.cwd(), "clippers_workspace"),
  );
  const stateDirectory = path.join(workspaceRoot, "reports", "free-local-worker");
  const reportPath = path.join(stateDirectory, "latest.json");
  const lockPath = path.join(stateDirectory, "worker.lock");
  const now = options.now || new Date();
  const nowMs = now.getTime();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const runningMaxAgeMs = options.runningMaxAgeMs ?? DEFAULT_RUNNING_MAX_AGE_MS;

  const [reportRead, lock, lockRead] = await Promise.all([
    readJsonObject(reportPath),
    stat(lockPath).catch((error: any) => error?.code === "ENOENT" ? null : null),
    readJsonObject(lockPath),
  ]);
  const report = reportRead.value;
  const lockMetadata = lockRead.value;

  const lockStartedAt = validTimestamp(lockMetadata?.startedAt);
  const lockReferenceMs = lockStartedAt ? Date.parse(lockStartedAt) : lock?.mtimeMs ?? Number.NaN;
  const lockAgeMs = Number.isFinite(lockReferenceMs) ? Math.max(0, nowMs - lockReferenceMs) : Number.POSITIVE_INFINITY;
  const isRunning = Boolean(lock && lockAgeMs <= runningMaxAgeMs);

  const startedAt = validTimestamp(report?.startedAt);
  const finishedAt = validTimestamp(report?.finishedAt);
  const lastExecutionAt = finishedAt || startedAt;
  const outcome = reportOutcome(report);
  const failedStage = (reportRead.exists && !report) || (Boolean(lock) && !isRunning && !report)
    ? "runtime_report"
    : safeFailedStage(report);
  const configurationBlockers = safeBlockers(report);
  const deliveryEnabled = report?.metricoolDeliveryEnabled === true;
  const uploadEnabled = report?.publicMediaUploadEnabled === true;

  let state: ClipperWorkerRuntimeState;
  if (isRunning) {
    state = "running";
  } else if (reportRead.exists && !report) {
    state = "blocked";
  } else if (!report && lock) {
    state = "stale";
  } else if (!report) {
    state = "never_run";
  } else if (!outcome || !lastExecutionAt) {
    state = "blocked";
  } else if (nowMs - Date.parse(lastExecutionAt) > staleAfterMs) {
    state = "stale";
  } else {
    state = outcome;
  }

  const nextAction = nextActionFor({
    state,
    failedStage,
    blockers: configurationBlockers,
    deliveryEnabled,
    uploadEnabled,
  });

  return {
    status: state,
    failedStage: state === "blocked" || state === "stale" ? failedStage : null,
    lastExecution: isRunning
      ? { startedAt: lockStartedAt || null, finishedAt: null, outcome: null }
      : lastExecutionAt
        ? { startedAt, finishedAt, outcome }
        : lockStartedAt
          ? { startedAt: lockStartedAt, finishedAt: null, outcome: "blocked" as const }
        : null,
    delivery: { enabled: deliveryEnabled, surface: report?.publishingSurface === "metricool" ? "metricool" : null },
    upload: { enabled: uploadEnabled },
    configurationBlockers,
    staleAfterMinutes: Math.round(staleAfterMs / 60_000),
    nextAction,
  };
}
