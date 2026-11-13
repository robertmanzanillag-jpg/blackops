import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const sourceDropDir = path.join(rootDir, "source-drop");
const allowlistDir = path.join(rootDir, "allowlist");
const queuePath = path.join(rootDir, "scheduled", "metricool-execution-queue.json");
const queueMarkdownPath = path.join(rootDir, "scheduled", "metricool-execution-queue.md");
const queueCsvPath = path.join(rootDir, "scheduled", "metricool-execution-queue.csv");
const rightsAuditTimeoutMs = 120_000;

const categories = ["sports", "memes", "streamers"];

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

function runRightsAudit() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["script/clippers-record-owned-source-rights.mjs", "--dry-run"], {
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
      reject(new Error(`Rights audit dry-run timed out after ${rightsAuditTimeoutMs}ms`));
    }, rightsAuditTimeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(`Rights audit failed with code ${code}${stderr ? `\n${stderr}` : ""}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(new Error(`Rights audit returned invalid JSON: ${error.message}\n${stdout.slice(-1000)}`));
        }
      });
    });
  });
}

function renderMarkdown(queue) {
  const rows = queue.sourceReadiness.categories.map((category) =>
    `- ${category.accountName}: ${category.rightsReadyAssets} rights-ready assets, ${category.missingSourceAssets} missing, networks ${category.connectedNetworks.join(", ") || "none"}`
  );
  return [
    "# Clippers Metricool Execution Queue",
    "",
    `Status: ${queue.status}`,
    `Generated: ${queue.generatedAt}`,
    `Publish mode: ${queue.publishMode}`,
    `Real publish enabled: ${queue.realPublishEnabled ? "yes" : "no"}`,
    "",
    "## Source Readiness",
    "",
    ...rows,
    "",
    "## Totals",
    "",
    `- Connected accounts: ${queue.sourceReadiness.totals.accounts}`,
    `- Connected networks: ${queue.sourceReadiness.totals.connectedNetworks}`,
    `- Rights-ready assets for connected Metricool accounts: ${queue.sourceReadiness.totals.rightsReadyAssets}`,
    `- Local owned source assets across all categories: ${queue.sourceReadiness.localOwnedSourceTotals.total}`,
    `- Queue items: ${queue.totals.items}`,
    `- Queued for approval: ${queue.totals.queuedForApproval}`,
    "",
    "Guardrail: this queue is approval_required only and does not auto-publish.",
    "",
  ].join("\n");
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function renderCsv(queue) {
  return [
    "account_id,account_name,category,connected_networks,rights_ready_assets,missing_source_assets,next_step",
    ...queue.sourceReadiness.categories.map((category) => [
      category.accountId,
      category.accountName,
      category.category,
      category.connectedNetworks.join("|"),
      category.rightsReadyAssets,
      category.missingSourceAssets,
      category.nextStep,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

async function main() {
  const queue = JSON.parse(await readFile(queuePath, "utf8"));
  if (queue.realPublishEnabled !== false) throw new Error("Metricool realPublishEnabled must remain false.");
  if (queue.publishMode !== "approval_required" && queue.status !== "approval_required") {
    throw new Error("Metricool queue must remain approval_required.");
  }

  const rightsAudit = await runRightsAudit();
  const rightsByCategory = Object.fromEntries(categories.map((category) => [
    category,
    rightsAudit.byCategory?.[category]?.rightsReady || 0,
  ]));

  const items = (Array.isArray(queue.items) ? queue.items : []).map((item) => ({
    ...item,
    status: item.status === "blocked" ? "blocked" : "queued_for_approval",
    approvalRequired: true,
    canSendNow: false,
  }));
  const itemTotals = items.reduce((totals, item) => {
    totals.items += 1;
    if (item.status === "blocked") totals.blocked += 1;
    if (item.status === "queued_for_approval") totals.queuedForApproval += 1;
    if (item.approvalRequired) totals.approvalRequired += 1;
    return totals;
  }, { items: 0, blocked: 0, queuedForApproval: 0, readyToSend: 0, approvalRequired: 0 });

  const sourceReadiness = queue.sourceReadiness || {};
  const connectedCategories = (Array.isArray(sourceReadiness.categories) ? sourceReadiness.categories : []).map((category) => {
    const rightsReadyAssets = rightsByCategory[category.category] || 0;
    return {
      ...category,
      rightsReadyAssets,
      missingSourceAssets: Math.max(0, (category.minimumWeeklySourceAssets || 0) - rightsReadyAssets),
      nextStep: rightsReadyAssets >= (category.minimumWeeklySourceAssets || 0)
        ? `${category.accountName} tiene source assets suficientes para Metricool approval_required.`
        : `${category.accountName} necesita mas source assets con allowlist valida antes de entrar a Metricool.`,
    };
  });
  const sourceTotals = connectedCategories.reduce((totals, category) => {
    totals.accounts += 1;
    totals.connectedNetworks += Array.isArray(category.connectedNetworks) ? category.connectedNetworks.length : 0;
    totals.dailyClipTarget += category.dailyClipTarget || 0;
    totals.weeklyTargetClips += category.weeklyTargetClips || 0;
    totals.minimumWeeklySourceAssets += category.minimumWeeklySourceAssets || 0;
    totals.rightsReadyAssets += category.rightsReadyAssets || 0;
    totals.missingSourceAssets += category.missingSourceAssets || 0;
    return totals;
  }, { accounts: 0, connectedNetworks: 0, dailyClipTarget: 0, weeklyTargetClips: 0, minimumWeeklySourceAssets: 0, rightsReadyAssets: 0, missingSourceAssets: 0 });

  const syncedQueue = {
    ...queue,
    status: "approval_required",
    generatedAt: new Date().toISOString(),
    publishMode: "approval_required",
    realPublishEnabled: false,
    sourceReadiness: {
      ...sourceReadiness,
      status: sourceTotals.missingSourceAssets > 0 ? "blocked" : "ready",
      categories: connectedCategories,
      totals: sourceTotals,
      localOwnedSourceTotals: {
        sports: rightsByCategory.sports,
        memes: rightsByCategory.memes,
        streamers: rightsByCategory.streamers,
        total: Object.values(rightsByCategory).reduce((sum, value) => sum + value, 0),
      },
      nextStep: "SPORT y memes estan listos para cola Metricool approval_required; streamers queda listo localmente pero requiere cuenta conectada antes de entrar a Metricool.",
    },
    items,
    totals: itemTotals,
    nextStep: "Revisar y aprobar manualmente en Metricool; no hay publicacion automatica.",
  };

  await writeFile(queuePath, JSON.stringify(syncedQueue, null, 2));
  await writeFile(queueMarkdownPath, renderMarkdown(syncedQueue));
  await writeFile(queueCsvPath, renderCsv(syncedQueue));

  console.log(JSON.stringify({
    status: syncedQueue.status,
    realPublishEnabled: syncedQueue.realPublishEnabled,
    publishMode: syncedQueue.publishMode,
    connectedRightsReadyAssets: syncedQueue.sourceReadiness.totals.rightsReadyAssets,
    localOwnedSourceTotals: syncedQueue.sourceReadiness.localOwnedSourceTotals,
    totals: syncedQueue.totals,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
