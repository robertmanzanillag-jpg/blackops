import { spawnSync } from "node:child_process";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLIPPERS_ALLOWED_ENV_KEYS, loadClipperSelectedEnv } from "./clippers-selected-env.mjs";

const SAFE_ENV_KEYS = ["HOME", "LANG", "LC_ALL", "NODE_ENV", "PATH", "SHELL", "TMPDIR", "USER"];
const DEFAULT_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_MAX_AGE_MS = 2 * 60 * 60_000;

function localOnlyEnv(source, overrides = {}) {
  const safe = Object.fromEntries(SAFE_ENV_KEYS
    .filter((key) => typeof source[key] === "string")
    .map((key) => [key, source[key]]));
  return { ...safe, ...overrides };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: 30 * 60_000,
  });
  return {
    command: [command, ...args].join(" "),
    status: result.status ?? 1,
    signal: result.signal,
    stdout: "",
    stderr: result.status === 0
      ? ""
      : result.error?.code === "ETIMEDOUT"
        ? "Subprocess timed out after 30 minutes; output omitted to prevent credential leakage."
        : result.error?.code
          ? `Subprocess could not start (${result.error.code}); output omitted to prevent credential leakage.`
          : `Subprocess exited with status ${result.status ?? "unknown"}; output omitted to prevent credential leakage.`,
  };
}

function skippedStep(command, reason, status = null) {
  return { command, status, signal: null, stdout: "", stderr: reason };
}

async function writeReport(reportPath, report) {
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, reportPath);
}

export async function runClipperFreeLocalWorker(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
  const workerEnv = { ...process.env, ...(options.env || {}) };
  const configRoot = path.resolve(options.configRoot || workerEnv.CLIPPERS_CONFIG_ROOT || projectRoot);
  const loadedConfigurationFiles = loadClipperSelectedEnv(configRoot, workerEnv);
  const workspaceRoot = path.resolve(
    options.workspaceRoot || workerEnv.CLIPPERS_WORKSPACE_ROOT || path.join(projectRoot, "clippers_workspace"),
  );
  const stateDir = path.join(workspaceRoot, "reports", "free-local-worker");
  const lockPath = path.join(stateDir, "worker.lock");
  const reportPath = path.join(stateDir, "latest.json");
  await mkdir(stateDir, { recursive: true });

  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      const lockAgeMs = Date.now() - (await stat(lockPath)).mtimeMs;
      let existingLock = {};
      try {
        existingLock = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        // A process can be terminated between creating and writing the lock.
        // An unreadable/malformed lock proves no live owner, so it is recoverable.
      }
      const existingPid = Number(existingLock?.pid);
      let processAlive = false;
      if (Number.isInteger(existingPid) && existingPid > 0) {
        try {
          process.kill(existingPid, 0);
          processAlive = true;
        } catch (processError) {
          processAlive = processError?.code === "EPERM";
        }
      }
      if (processAlive && lockAgeMs <= LOCK_MAX_AGE_MS) return { status: "skipped", reason: "already_running", reportPath };
      await unlink(lockPath);
      lock = await open(lockPath, "wx", 0o600);
    }
    if (!lock) throw error;
  }
  await lock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);

  const startedAt = new Date().toISOString();
  const publishingAuthorized = workerEnv.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED === "true";
  const publicMediaUploadAuthorized = workerEnv.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED === "true";
  await writeReport(reportPath, {
    status: "running",
    startedAt,
    projectRoot,
    configRoot,
    workspaceRoot,
    paidAiUsed: false,
    paidSpendAllowed: false,
    publicationRule: "Only proof-backed TikTok posts with an exact public URL count as published or measured.",
  });
  const metricoolEnv = publishingAuthorized ? {
    METRICOOL_USER_TOKEN: workerEnv.METRICOOL_USER_TOKEN,
    METRICOOL_USER_ID: workerEnv.METRICOOL_USER_ID,
    CLIPPERS_METRICOOL_BLOG_ID: workerEnv.CLIPPERS_METRICOOL_BLOG_ID,
    CLIPPERS_TIKTOK_ACCOUNT: workerEnv.CLIPPERS_TIKTOK_ACCOUNT || "streamersclipusa",
  } : {};
  const publicMediaEnv = publicMediaUploadAuthorized ? Object.fromEntries(
    [...CLIPPERS_ALLOWED_ENV_KEYS]
      .filter((key) => key.startsWith("GOOGLE_") || key.startsWith("YOUTUBE_") || key.startsWith("CLIPPERS_PUBLIC_MEDIA"))
      .map((key) => [key, workerEnv[key]])
      .filter(([, value]) => typeof value === "string" && value),
  ) : {};
  if (publicMediaUploadAuthorized && workerEnv.CLIPPERS_METRICOOL_BLOG_ID) {
    publicMediaEnv.CLIPPERS_METRICOOL_BLOG_ID = workerEnv.CLIPPERS_METRICOOL_BLOG_ID;
  }
  const env = localOnlyEnv(workerEnv, {
    CLIPPERS_WORKSPACE_ROOT: workspaceRoot,
    CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: publishingAuthorized ? "true" : "false",
    CLIPPERS_TARGET_DAILY_CLIPS: workerEnv.CLIPPERS_TARGET_DAILY_CLIPS || "5",
    CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: publicMediaUploadAuthorized ? "true" : "false",
    CLIPPERS_PUBLIC_MEDIA_PROVIDER: workerEnv.CLIPPERS_PUBLIC_MEDIA_PROVIDER || "google_drive",
    CLIPPERS_MARKETPLACE_REFRESH_CONFIG: workerEnv.CLIPPERS_MARKETPLACE_REFRESH_CONFIG || "",
    CLIPPERS_MARKETPLACE_REFRESH_TIMEOUT_MS: workerEnv.CLIPPERS_MARKETPLACE_REFRESH_TIMEOUT_MS || "120000",
    ...Object.fromEntries(Object.entries(metricoolEnv).filter(([, value]) => typeof value === "string" && value)),
    ...publicMediaEnv,
  });
  const execute = options.run || run;
  try {
    const configurationBlockers = [];
    if (!publishingAuthorized) configurationBlockers.push("metricool_autopublish_not_authorized");
    if (publishingAuthorized && !workerEnv.METRICOOL_USER_TOKEN) configurationBlockers.push("metricool_user_token_missing");
    if (publishingAuthorized && !workerEnv.METRICOOL_USER_ID) configurationBlockers.push("metricool_user_id_missing");
    if (publishingAuthorized && !workerEnv.CLIPPERS_METRICOOL_BLOG_ID) configurationBlockers.push("metricool_blog_id_missing");

    // Refresh is best-effort: a provider can be temporarily unavailable while a
    // still-fresh, rights-verified snapshot remains safe to consume. Intake is
    // therefore authoritative and always runs after the provider fallback pass.
    const supplyRefresh = execute("npm", ["run", "clippers:marketplace-refresh"], { cwd: projectRoot, env });
    const supply = execute("npm", ["run", "clippers:marketplace-intake"], { cwd: projectRoot, env });
    const rendering = supply.status === 0
      ? execute("npm", ["run", "clippers:render-campaign-drafts"], { cwd: projectRoot, env })
      : skippedStep("Campaign rendering skipped", "Marketplace intake failed.");
    let renderingReport = null;
    if (rendering.status === 0) {
      try {
        renderingReport = JSON.parse(await readFile(path.join(workspaceRoot, "reports", "campaign-draft-renderer.json"), "utf8"));
      } catch {
        // Older verified draft paths can still proceed through uploader validation.
      }
    }
    const renderingShortfall = renderingReport?.status === "partial"
      && Number(renderingReport?.summary?.missingAgainstTarget) > 0;
    const mediaUpload = supply.status !== 0 || rendering.status !== 0
      ? skippedStep(
          "Public media upload skipped",
          supply.status !== 0 ? "Marketplace intake failed." : "Campaign rendering failed.",
        )
      : publicMediaUploadAuthorized
        ? execute("npm", ["run", "clippers:upload-metricool-media"], { cwd: projectRoot, env })
        : skippedStep("Public media upload skipped", "Public media upload is not authorized.", 0);
    const planning = supply.status === 0 && rendering.status === 0 && mediaUpload.status === 0
      ? execute("npm", ["run", "clippers:streamer-growth-ceo"], { cwd: projectRoot, env })
      : skippedStep(
          "CEO planning skipped",
          supply.status !== 0
            ? "Marketplace intake failed."
            : rendering.status !== 0
              ? "Campaign rendering failed."
              : "Public media upload failed.",
        );
    const delivery = planning.status === 0 && configurationBlockers.length === 0
      ? execute("node", ["script/clippers-metricool-autopilot.mjs"], { cwd: projectRoot, env })
      : skippedStep(
          "Metricool delivery skipped",
          planning.status !== 0 ? "CEO planning failed." : `Configuration blockers: ${configurationBlockers.join(", ")}.`,
        );
    // Reconciliation is independent of today's supply. Previously scheduled
    // posts must still reach an exact public URL (or a proven terminal failure)
    // even when every marketplace provider is temporarily unavailable.
    const reconciliation = publishingAuthorized && configurationBlockers.length === 0
      ? execute("npm", ["run", "clippers:reconcile-publications"], { cwd: projectRoot, env })
      : skippedStep(
          "Publication reconciliation skipped",
          publishingAuthorized ? `Configuration blockers: ${configurationBlockers.join(", ")}.` : "Metricool publishing is not authorized.",
          publishingAuthorized ? null : 0,
        );
    const executeCleanup = workerEnv.CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE === "true";
    const cleanup = planning.status === 0 && (reconciliation.status === 0 || !publishingAuthorized)
      ? execute("node", ["script/clippers-cleanup-published-vyro-media.mjs", ...(executeCleanup ? ["--execute"] : [])], { cwd: projectRoot, env })
      : skippedStep("cleanup skipped", "Planning, delivery, or publication reconciliation failed.");
    const failedStage = supply.status !== 0
      ? "supply"
      : rendering.status !== 0
        ? "rendering"
        : mediaUpload.status !== 0
          ? "media_upload"
          : planning.status !== 0
            ? "planning"
            : delivery.status !== 0
              ? "delivery"
              : reconciliation.status !== 0
                ? "reconciliation"
                : cleanup.status !== 0
                  ? "cleanup"
                  : null;
    const report = {
      status: failedStage ? "blocked" : renderingShortfall ? "partial" : "completed",
      startedAt,
      finishedAt: new Date().toISOString(),
      projectRoot,
      configRoot,
      workspaceRoot,
      loadedConfigurationFiles,
      failedStage,
      retryable: Boolean(failedStage || renderingShortfall),
      configurationBlockers,
      paidAiUsed: false,
      paidAiCredentialsPassed: false,
      paidSpendAllowed: false,
      publishingSurface: "metricool",
      metricoolDeliveryEnabled: publishingAuthorized,
      publicMediaUploadEnabled: publicMediaUploadAuthorized,
      cleanupExecuteEnabled: executeCleanup,
      supplyRefresh,
      degradedStages: supplyRefresh.status === 0 ? [] : ["supply_refresh"],
      supply,
      rendering,
      renderingReport,
      mediaUpload,
      planning,
      delivery,
      reconciliation,
      cleanup,
      publicationRule: "Only proof-backed TikTok posts with an exact public URL count as published or measured.",
      note: publishingAuthorized
        ? "Metricool delivery runs only for proof-backed, unique queue items with public HTTPS media and required campaign hashtags."
        : "Metricool delivery did not run because explicit authorization is missing. Set CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED=true in a selected project environment file and retry.",
    };
    await writeReport(reportPath, report);
    return { ...report, reportPath };
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runClipperFreeLocalWorker();
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") process.exitCode = 1;
}
