import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");
const accountReadinessPath = path.join(rootDir, "account-permission-readiness.json");
const metricoolQueuePath = path.join(scheduledDir, "metricool-execution-queue.json");
const outJsonPath = path.join(reportsDir, "clippers-operational-readiness.json");
const outMarkdownPath = path.join(reportsDir, "clippers-operational-readiness.md");
const outCsvPath = path.join(reportsDir, "clippers-operational-readiness.csv");
const jsonScriptTimeoutMs = 120_000;
const nestedJsonScriptTimeoutMs = 60_000;

function killScriptProcess(child) {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to killing only the direct child when process groups are unavailable.
    }
  }
  child.kill("SIGKILL");
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!raw) return null;
  return JSON.parse(raw);
}

function runJsonScript(scriptPath, label, timeoutMs = jsonScriptTimeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killScriptProcess(child);
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(`${label} failed with code ${code}${stderr ? `\n${stderr}` : ""}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(new Error(`${label} returned invalid JSON: ${error.message}`));
        }
      });
    });
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function checkPort(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (open, error = null) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ port, open, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false, "timeout"));
    socket.once("error", (error) => done(false, error?.code || error?.message || "connection_error"));
  });
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildMetricoolMvpBlockers({ accountReadiness, metricoolQueue }) {
  const blockers = [];
  if (!accountReadiness) blockers.push("account-permission-readiness.json missing; run npm run clippers:account-permission-readiness.");
  if (!metricoolQueue) blockers.push("metricool-execution-queue.json missing; run npm run clippers:sync-metricool-source-readiness.");
  if (metricoolQueue?.realPublishEnabled === true) blockers.push("realPublishEnabled is true; MVP requires approval_required and no auto-publish.");
  if (metricoolQueue && metricoolQueue.publishMode !== "approval_required") blockers.push(`Metricool publishMode is ${metricoolQueue.publishMode}; expected approval_required.`);
  if (metricoolQueue && metricoolQueue.status !== "approval_required") blockers.push(`Metricool queue status is ${metricoolQueue.status}; expected approval_required.`);
  if ((metricoolQueue?.totals?.readyToSend || 0) > 0) blockers.push("Metricool queue has readyToSend items; MVP must stay queued_for_approval only.");
  if (Array.isArray(metricoolQueue?.items) && metricoolQueue.items.some((item) => item?.canSendNow === true || item?.status === "ready_to_send")) {
    blockers.push("Metricool queue contains item(s) that can send now; MVP must stay approval-only.");
  }
  if (metricoolQueue && metricoolQueue?.sourceReadiness?.status !== "ready") blockers.push(`Metricool source readiness is ${metricoolQueue?.sourceReadiness?.status || "missing"}; expected ready.`);
  if ((metricoolQueue?.sourceReadiness?.totals?.rightsReadyAssets || 0) <= 0) blockers.push("Metricool source readiness has no connected rights-ready assets.");
  if (!Array.isArray(metricoolQueue?.sourceReadiness?.categories) || metricoolQueue.sourceReadiness.categories.length < 2) blockers.push("Metricool source readiness has fewer than two connected lanes.");
  if ((accountReadiness?.totals?.metricoolReadyLanes || 0) < 2) blockers.push("Fewer than two Metricool approval lanes are ready; SPORT and memes must stay connected first.");
  return unique(blockers);
}

function buildQaFollowups({ localAppPorts, accountReadiness }) {
  const followups = [];
  if (!localAppPorts.some((item) => item.open)) followups.push("Local app is not listening on 127.0.0.1:5010 or 127.0.0.1:5000; browser QA cannot run yet.");
  if ((accountReadiness?.externalCloseout?.proofFilesNeedRealEvidence || 0) > 0) followups.push("External closeout proof files still need real non-secret evidence before claiming full readiness.");
  return unique(followups);
}

function buildDirectApiBacklog({ accountReadiness }) {
  const blockers = [];
  if ((accountReadiness?.totals?.developerAppsApproved || 0) < (accountReadiness?.totals?.developerApps || 0)) blockers.push("Developer apps are not all approved; direct API publishing remains blocked.");
  if ((accountReadiness?.totals?.permissionGroupsApproved || 0) < (accountReadiness?.totals?.permissionGroups || 0)) blockers.push("Platform permission groups are not all approved; direct API publishing remains blocked.");
  if ((accountReadiness?.totals?.verifiedAccounts || 0) < (accountReadiness?.totals?.accountProfiles || 0)) blockers.push("Not every account/platform profile is verified; only connected Metricool MVP lanes can be used.");
  return unique(blockers);
}

function renderMarkdown(summary) {
  const portLines = summary.localApp.ports.map((item) => `- 127.0.0.1:${item.port}: ${item.open ? "open" : `closed (${item.error || "unknown"})`}`);
  const blockerLines = summary.metricoolMvpBlockers.length ? summary.metricoolMvpBlockers.map((item) => `- ${item}`) : ["- None"];
  const qaLines = summary.qaFollowups.length ? summary.qaFollowups.map((item) => `- ${item}`) : ["- None"];
  const directApiLines = summary.directApiBacklog.length ? summary.directApiBacklog.map((item) => `- ${item}`) : ["- None"];
  const laneLines = summary.metricool.lanes.map((lane) => `- ${lane.accountName} (${lane.category}): ${lane.connectedNetworks.join(", ") || "none"}; rights-ready ${lane.rightsReadyAssets}`);
  return [
    "# Clippers Operational Readiness",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    "",
    "## MVP",
    "",
    `- Metricool MVP ready: ${summary.mvp.metricoolReady ? "yes" : "no"}`,
    `- Launch mode: ${summary.mvp.launchMode}`,
    `- Approval queue ready: ${summary.mvp.approvalQueueReady ? "yes" : "no"}`,
    `- Real publish enabled: ${summary.metricool.realPublishEnabled ? "yes" : "no"}`,
    `- Publish mode: ${summary.metricool.publishMode}`,
    `- Direct social APIs required for MVP: no`,
    "",
    "## Totals",
    "",
    `- Verified account/platform profiles: ${summary.accounts.verified}/${summary.accounts.total}`,
    `- Metricool-ready lanes: ${summary.accounts.metricoolReadyLanes}`,
    `- Direct API-ready lanes: ${summary.accounts.directApiReadyLanes}`,
    `- Local owned source assets: ${summary.sources.localOwnedSourceAssets}`,
    `- Connected rights-ready assets: ${summary.sources.connectedRightsReadyAssets}`,
    `- Queued for Metricool approval: ${summary.metricool.queuedForApproval}`,
    `- Ready to send automatically: ${summary.metricool.readyToSend}`,
    "",
    "## Metricool Lanes",
    "",
    ...laneLines,
    "",
    "## Local App",
    "",
    ...portLines,
    "",
    "## Metricool MVP Blockers",
    "",
    ...blockerLines,
    "",
    "## QA Followups",
    "",
    ...qaLines,
    "",
    "## Direct API Backlog",
    "",
    ...directApiLines,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const rows = [
    ["status", summary.status],
    ["metricool_mvp_ready", summary.mvp.metricoolReady],
    ["launch_mode", summary.mvp.launchMode],
    ["approval_queue_ready", summary.mvp.approvalQueueReady],
    ["full_direct_api_ready", summary.fullDirectApiReady],
    ["verified_account_profiles", `${summary.accounts.verified}/${summary.accounts.total}`],
    ["metricool_ready_lanes", summary.accounts.metricoolReadyLanes],
    ["direct_api_ready_lanes", summary.accounts.directApiReadyLanes],
    ["local_owned_source_assets", summary.sources.localOwnedSourceAssets],
    ["connected_rights_ready_assets", summary.sources.connectedRightsReadyAssets],
    ["queued_for_approval", summary.metricool.queuedForApproval],
    ["ready_to_send", summary.metricool.readyToSend],
    ["real_publish_enabled", summary.metricool.realPublishEnabled],
    ["metricool_mvp_blockers", summary.metricoolMvpBlockers.join(" | ")],
    ["qa_followups", summary.qaFollowups.join(" | ")],
    ["direct_api_backlog", summary.directApiBacklog.join(" | ")],
    ["next_step", summary.nextStep],
  ];
  return `metric,value\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  await runJsonScript("script/clippers-account-permission-readiness.mjs", "Account permission readiness", nestedJsonScriptTimeoutMs);
  const [accountReadiness, metricoolQueue, ...localAppPorts] = await Promise.all([
    readJson(accountReadinessPath),
    readJson(metricoolQueuePath),
    checkPort(5010),
    checkPort(5000),
  ]);

  const accountTotals = accountReadiness?.totals || {};
  const queueTotals = metricoolQueue?.totals || {};
  const sourceTotals = metricoolQueue?.sourceReadiness?.localOwnedSourceTotals || {};
  const lanes = Array.isArray(metricoolQueue?.sourceReadiness?.categories) ? metricoolQueue.sourceReadiness.categories : [];
  const metricoolMvpBlockers = buildMetricoolMvpBlockers({ accountReadiness, metricoolQueue });
  const qaFollowups = buildQaFollowups({ accountReadiness, localAppPorts });
  const directApiBacklog = buildDirectApiBacklog({ accountReadiness });
  const sourceReadinessReady = metricoolQueue?.sourceReadiness?.status === "ready"
    && (metricoolQueue?.sourceReadiness?.totals?.rightsReadyAssets || 0) > 0
    && lanes.length >= 2
    && lanes.every((lane) => (lane.rightsReadyAssets || 0) > 0 && Array.isArray(lane.connectedNetworks) && lane.connectedNetworks.length > 0);
  const approvalQueueReady = metricoolQueue?.status === "approval_required"
    && metricoolQueue?.publishMode === "approval_required"
    && metricoolQueue?.realPublishEnabled === false
    && (queueTotals.queuedForApproval || 0) > 0
    && (queueTotals.readyToSend || 0) === 0;
  const metricoolMvpStatus = accountReadiness?.status === "metricool_mvp_ready"
    || accountReadiness?.status === "metricool_mvp_ready_with_external_blockers";
  const metricoolReady = metricoolMvpStatus
    && (accountTotals.metricoolReadyLanes || 0) >= 2
    && sourceReadinessReady
    && approvalQueueReady
    && metricoolMvpBlockers.length === 0;
  const fullDirectApiReady = (accountTotals.directApiReadyLanes || 0) >= (accountTotals.accountProfiles || 1)
    && (accountTotals.developerAppsApproved || 0) >= (accountTotals.developerApps || 1)
    && (accountTotals.permissionGroupsApproved || 0) >= (accountTotals.permissionGroups || 1);
  const localAppReady = localAppPorts.some((item) => item.open);
  const status = fullDirectApiReady && metricoolReady && localAppReady
    ? "full_ready"
    : metricoolReady
      ? "metricool_mvp_ready"
      : "blocked";
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
    },
    mvp: {
      metricoolReady,
      launchMode: "metricool_approval_required",
      approvalQueueReady,
      directSocialApisRequired: false,
    },
    fullDirectApiReady,
    accounts: {
      total: accountTotals.accountProfiles || 0,
      verified: accountTotals.verifiedAccounts || 0,
      metricoolReadyLanes: accountTotals.metricoolReadyLanes || 0,
      directApiReadyLanes: accountTotals.directApiReadyLanes || 0,
      developerAppsApproved: accountTotals.developerAppsApproved || 0,
      developerApps: accountTotals.developerApps || 0,
      permissionGroupsApproved: accountTotals.permissionGroupsApproved || 0,
      permissionGroups: accountTotals.permissionGroups || 0,
    },
    sources: {
      sourceReadinessReady,
      localOwnedSourceAssets: sourceTotals.total || 0,
      connectedRightsReadyAssets: metricoolQueue?.sourceReadiness?.totals?.rightsReadyAssets || 0,
      byCategory: sourceTotals,
    },
    metricool: {
      status: metricoolQueue?.status || "missing",
      publishMode: metricoolQueue?.publishMode || "missing",
      realPublishEnabled: metricoolQueue?.realPublishEnabled === true,
      queuedForApproval: queueTotals.queuedForApproval || 0,
      readyToSend: queueTotals.readyToSend || 0,
      approvalRequired: queueTotals.approvalRequired || 0,
      lanes: lanes.map((lane) => ({
        accountId: lane.accountId,
        accountName: lane.accountName,
        category: lane.category,
        connectedNetworks: lane.connectedNetworks || [],
        rightsReadyAssets: lane.rightsReadyAssets || 0,
      })),
    },
    localApp: {
      ready: localAppReady,
      ports: localAppPorts,
    },
    metricoolMvpBlockers,
    qaFollowups,
    directApiBacklog,
    blockers: metricoolMvpBlockers,
    nextStep: metricoolMvpBlockers.length
      ? "Keep Metricool in approval_required, fix the listed Metricool MVP blockers, then rerun this script."
      : "Use Metricool approval_required for SPORT and memes. Direct social APIs are future scale work, not required for this launch mode.",
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    metricoolMvpReady: summary.mvp.metricoolReady,
    fullDirectApiReady: summary.fullDirectApiReady,
    localAppReady: summary.localApp.ready,
    queuedForApproval: summary.metricool.queuedForApproval,
    readyToSend: summary.metricool.readyToSend,
    metricoolMvpBlockers: summary.metricoolMvpBlockers.length,
    qaFollowups: summary.qaFollowups.length,
    directApiBacklog: summary.directApiBacklog.length,
    blockers: summary.blockers.length,
    reportPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
