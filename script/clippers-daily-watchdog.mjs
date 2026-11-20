import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runClippersDailyLearning } from "./clippers-daily-learning.mjs";
import { runPortfolioDiscovery } from "./clippers-portfolio-discovery.mjs";
import { readWeeklyPrivateJson } from "./clippers-weekly-policy.mjs";
import { remainingWeeklyWindow, runWeeklySchedulingChild } from "./clippers-weekly-scheduler.mjs";

const DEFAULT_TIME_ZONE = "America/New_York";
const DEFAULT_CHECK_HOUR = 10;
const DEFAULT_ACCOUNT = "streamersclipusa";

export async function runPortfolioPrepareChild({ workspaceRoot, env = process.env, timeoutMs = 120_000, spawnProcess = spawn } = {}) {
  if (env.CLIPPERS_PORTFOLIO_PREPARE_ENABLED !== "true" || env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED !== "true") {
    return { status: "disabled", prepared: 0, uploaded: 0, paidSpendUsd: 0 };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error("invalid_prepare_child_timeout");
  const { driveHelperEnvironment } = await import("./clippers-portfolio-prepare.mjs");
  const childEnv = { ...driveHelperEnvironment(env),
    CLIPPERS_PORTFOLIO_PREPARE_ENABLED: "true", CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: "true",
    CLIPPERS_WORKSPACE_ROOT: await realpath(workspaceRoot),
  };
  return new Promise(resolve => {
    let output = "", outputBytes = 0, failure, settled = false, killTimer;
    const child = spawnProcess(process.execPath, [fileURLToPath(new URL("./clippers-portfolio-prepare.mjs", import.meta.url))],
      { cwd: fileURLToPath(new URL("..", import.meta.url)), env: childEnv, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const stop = signal => {
      try { if (process.platform === "win32") child.kill(signal); else process.kill(-child.pid, signal); } catch {}
    };
    const blocked = reason => ({ status: "blocked", reason, prepared: 0, uploaded: 0, paidSpendUsd: 0 });
    const finish = value => {
      if (settled) return;
      // A closing parent does not prove its process-group descendants exited.
      // Finish escalation before clearing timers on every unconfirmed outcome.
      if (failure || value.status === "blocked") stop("SIGKILL");
      settled = true; clearTimeout(timer); clearTimeout(killTimer); resolve(value);
    };
    const terminate = reason => {
      failure ||= reason; stop("SIGTERM");
      killTimer ||= setTimeout(() => { stop("SIGKILL"); finish(blocked(failure)); }, 250);
    };
    const timer = setTimeout(() => terminate("portfolio_prepare_deadline_exceeded"), Math.min(120_000, timeoutMs));
    child.stdout.on("data", chunk => {
      if (settled || failure) return;
      outputBytes += chunk.length;
      if (outputBytes > 256 * 1024) { terminate("portfolio_prepare_output_limit"); return; }
      output += chunk.toString();
    });
    // Provider stderr is intentionally not included in reports or error text.
    child.stderr.on("data", () => {});
    child.on("error", () => finish(blocked("portfolio_prepare_child_unavailable")));
    child.on("close", exitCode => {
      if (failure) return finish(blocked(failure));
      if (exitCode !== 0) return finish(blocked("portfolio_prepare_child_failed"));
      try {
        const body = JSON.parse(output);
        if (!["disabled", "held", "prepared", "held_or_partial"].includes(body.status) || body.paidSpendUsd !== 0 ||
            !Number.isSafeInteger(body.prepared) || body.prepared < 0 || body.prepared > 20 ||
            !Number.isSafeInteger(body.uploaded) || body.uploaded < 0 || body.uploaded > 20 || body.publisherEnabledChanged === true) throw Error();
        const reasons = new Set(["no_reviewed_prepare_packets", "prepare_request_retention_required", "portfolio_prepare_busy"]);
        finish({ status: body.status, prepared: body.prepared, uploaded: body.uploaded, paidSpendUsd: 0,
          ...(reasons.has(body.reason) ? { reason: body.reason } : {}) });
      } catch { finish(blocked("portfolio_prepare_report_unconfirmed")); }
    });
  });
}

function clean(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function dateParts(value, timeZone) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return { date: value.trim(), hour: 0 };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter(({ type }) => type !== "literal").map(({ type, value: part }) => [type, part]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function atomicWrite(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, file);
}

function normalizedAccount(value) {
  return clean(value).replace(/^@/, "").toLowerCase();
}

function exactPublicUrl(value, account) {
  const escaped = account.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^https://(?:www\\.)?tiktok\\.com/@${escaped}/video/\\d+(?:[/?#].*)?$`, "i").test(clean(value));
}

function eventDate(row, status, timeZone) {
  const candidates = status === "published"
    ? [row.publishedAt, row.publicationDate, row.scheduledFor]
    : [row.scheduledFor, row.publishAt, row.date];
  for (const candidate of candidates) {
    const parts = dateParts(candidate, timeZone);
    if (parts) return parts.date;
  }
  return null;
}

function collectEvidence(ledger, { today, timeZone, account }) {
  const evidence = [];
  const seen = new Set();
  for (const row of Array.isArray(ledger) ? ledger : []) {
    if (normalizedAccount(row?.account || account) !== account) continue;
    const status = clean(row?.status).toLowerCase();
    const publicUrl = clean(row?.publicUrl || row?.publishedPostUrl);
    const published = status === "published" && exactPublicUrl(publicUrl, account);
    const scheduled = ["scheduled", "verification_pending"].includes(status)
      && clean(row?.metricoolId)
      && clean(row?.scheduledFor);
    if (!published && !scheduled) continue;
    const evidenceStatus = published ? "published" : "scheduled";
    if (eventDate(row, evidenceStatus, timeZone) !== today) continue;
    const identity = clean(row.metricoolId) || publicUrl;
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    evidence.push({
      status: evidenceStatus,
      metricoolId: clean(row.metricoolId) || null,
      scheduledFor: clean(row.scheduledFor) || null,
      publishedAt: clean(row.publishedAt) || null,
      publicUrl: published ? publicUrl : null,
      campaignId: clean(row.campaignId) || null,
    });
  }
  return evidence;
}

function workerState(worker, supply, now) {
  const finishedAt = clean(worker?.finishedAt || worker?.startedAt);
  const finishedMs = Date.parse(finishedAt);
  const ageMinutes = Number.isFinite(finishedMs)
    ? Math.max(0, Math.round((now.getTime() - finishedMs) / 60_000))
    : null;
  const workerStatus = clean(worker?.status).toLowerCase();
  const stage = clean(worker?.failedStage) || (["running", "completed", "partial"].includes(workerStatus) ? workerStatus : "no_worker_report");
  const blockers = Array.isArray(worker?.configurationBlockers) ? worker.configurationBlockers.map(clean).filter(Boolean) : [];
  if (stage === "supply") {
    if (Number(supply?.summary?.snapshotsRead || 0) === 0) blockers.push("no_fresh_marketplace_snapshots");
    for (const rejection of Array.isArray(supply?.rejected) ? supply.rejected : []) {
      for (const blocker of Array.isArray(rejection?.blockers) ? rejection.blockers : []) blockers.push(clean(blocker));
    }
  }
  if (stage === "partial" && Number(worker?.renderingReport?.summary?.missingAgainstTarget) > 0) {
    blockers.push(`renderer_shortfall_${Number(worker.renderingReport.summary.missingAgainstTarget)}`);
  }
  if (!blockers.length && !["running", "completed"].includes(stage)) blockers.push(`${stage}_blocked`);
  return {
    status: clean(worker?.status) || "missing",
    stage,
    blockers: [...new Set(blockers)],
    lastRunAt: finishedAt || null,
    lastRunAgeMinutes: ageMinutes,
  };
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function contentLaneState(value) {
  const lane = value && typeof value === "object" ? value : {};
  const planned = nonNegativeInteger(lane.planned);
  const rendered = nonNegativeInteger(lane.rendered);
  return {
    channelId: clean(lane.channelId) || null,
    planned,
    attempted: nonNegativeInteger(lane.attempted),
    rendered,
    shortfall: Math.max(nonNegativeInteger(lane.shortfall), planned - rendered),
  };
}

function hasNonNegativeIntegerFields(value, fields) {
  return Boolean(value && typeof value === "object")
    && fields.every((field) => Number.isInteger(value[field]) && value[field] >= 0);
}

function validMotivationLane(value) {
  return hasNonNegativeIntegerFields(value, ["planned", "attempted", "rendered", "shortfall"])
    && Boolean(clean(value.channelId));
}

function validSleepLane(value) {
  return hasNonNegativeIntegerFields(value, ["planned", "attempted", "generated", "shortfall"]);
}

function contentWorkerState(contentWorker, { now, today, timeZone }) {
  const hasReport = Boolean(contentWorker && typeof contentWorker === "object");
  const schemaValid = hasReport
    && contentWorker.schemaVersion === 1
    && ["completed", "completed_with_shortfall"].includes(clean(contentWorker.status))
    && validMotivationLane(contentWorker.motivation?.es)
    && validMotivationLane(contentWorker.motivation?.en)
    && validSleepLane(contentWorker.sleep);
  const generatedAt = clean(contentWorker?.generatedAt);
  const generatedMs = Date.parse(generatedAt);
  const reportDate = dateParts(generatedAt, timeZone)?.date || null;
  const ageMinutes = Number.isFinite(generatedMs)
    ? Math.max(0, Math.round((now.getTime() - generatedMs) / 60_000))
    : null;
  const es = contentLaneState(contentWorker?.motivation?.es);
  const en = contentLaneState(contentWorker?.motivation?.en);
  const sleepValue = contentWorker?.sleep && typeof contentWorker.sleep === "object" ? contentWorker.sleep : {};
  const sleep = {
    planned: nonNegativeInteger(sleepValue.planned),
    attempted: nonNegativeInteger(sleepValue.attempted),
    generated: nonNegativeInteger(sleepValue.generated),
    shortfall: Math.max(
      nonNegativeInteger(sleepValue.shortfall),
      nonNegativeInteger(sleepValue.planned) - nonNegativeInteger(sleepValue.generated),
    ),
  };
  sleep.status = sleep.generated > 0
    ? "generated"
    : sleep.shortfall > 0
      ? "shortfall"
      : sleep.planned > 0
        ? "planned"
        : "not_planned";
  const freshForToday = reportDate === today;
  const parsedApiCostUsd = contentWorker?.apiCostUsd == null ? 0 : Number(contentWorker.apiCostUsd);
  const apiCostUsd = Number.isFinite(parsedApiCostUsd) ? parsedApiCostUsd : null;
  const blockers = [];
  if (!generatedAt) blockers.push("content_worker_report_missing");
  else if (!freshForToday) blockers.push("content_worker_report_stale");
  if (hasReport && !schemaValid) blockers.push("content_worker_report_schema_invalid");
  if (hasReport && contentWorker.publishEnabled !== false) blockers.push("content_worker_publish_must_remain_disabled");
  if (hasReport && contentWorker.networkUsed !== false) blockers.push("content_worker_network_must_remain_disabled");
  if (hasReport && apiCostUsd !== 0) blockers.push("content_worker_api_cost_must_remain_zero");
  if (es.shortfall > 0) blockers.push(`motivation_es_shortfall_${es.shortfall}`);
  if (en.shortfall > 0) blockers.push(`motivation_en_shortfall_${en.shortfall}`);
  if (sleep.shortfall > 0) blockers.push(`sleep_shortfall_${sleep.shortfall}`);
  return {
    status: clean(contentWorker?.status) || "missing",
    generatedAt: generatedAt || null,
    reportDate,
    reportAgeMinutes: ageMinutes,
    freshForToday,
    reportPresent: hasReport,
    schemaValid,
    motivation: { es, en },
    sleep,
    blockers,
    networkUsed: hasReport ? contentWorker.networkUsed : null,
    publishEnabled: hasReport ? contentWorker.publishEnabled : null,
    apiCostUsd,
    publicationProof: false,
  };
}

function exactYouTubeUrl(value) {
  return /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,32}$/.test(clean(value));
}

function youtubeDeliveryState(delivery, { now, today, timeZone }) {
  const present = Boolean(delivery && typeof delivery === "object");
  const finishedAt = clean(delivery?.finishedAt);
  const reportDate = dateParts(finishedAt, timeZone)?.date || null;
  const finishedMs = Date.parse(finishedAt);
  const freshForToday = reportDate === today;
  const status = clean(delivery?.status) || "missing";
  const allowedStatuses = new Set(["completed", "completed_with_blockers", "completed_with_uncertain_outcomes", "blocked"]);
  const urls = (Array.isArray(delivery?.publicUrls) ? delivery.publicUrls : [])
    .filter((row) => row && typeof row === "object" && clean(row.itemId) && clean(row.lane) && exactYouTubeUrl(row.youtubeUrl))
    .map((row) => ({ itemId: clean(row.itemId), lane: clean(row.lane), privacyStatus: clean(row.privacyStatus) || null, youtubeUrl: clean(row.youtubeUrl) }));
  const schemaValid = present && delivery.schemaVersion === 1 && allowedStatuses.has(status)
    && Number.isInteger(delivery.published) && delivery.published >= 0
    && delivery.published === urls.length && Number(delivery.apiCostUsd) === 0;
  const blockers = [];
  if (!present) blockers.push("youtube_delivery_report_missing");
  else if (!freshForToday) blockers.push("youtube_delivery_report_stale");
  if (present && !schemaValid) blockers.push("youtube_delivery_report_schema_invalid");
  if (status === "completed_with_uncertain_outcomes") blockers.push("youtube_delivery_uncertain_outcomes");
  if (["blocked", "completed_with_blockers"].includes(status)) blockers.push("youtube_delivery_blocked");
  for (const blocker of Array.isArray(delivery?.blockers) ? delivery.blockers : []) {
    if (clean(blocker)) blockers.push(clean(blocker));
  }
  return {
    status,
    stage: clean(delivery?.stage) || null,
    finishedAt: finishedAt || null,
    reportDate,
    reportAgeMinutes: Number.isFinite(finishedMs) ? Math.max(0, Math.round((now.getTime() - finishedMs) / 60_000)) : null,
    freshForToday,
    reportPresent: present,
    schemaValid,
    published: urls.length,
    publicUrls: urls,
    blockers: [...new Set(blockers)],
    publicationProof: urls.length > 0,
  };
}

function markdown(report) {
  const title = report.alert ? "Clippers daily alert" : "Clippers daily watchdog";
  return [
    `# ${title}`,
    "",
    `- Date: ${report.date} (${report.timeZone})`,
    `- Status: ${report.status}`,
    `- Evidence-backed posts today: ${report.counts.total}`,
    `- Scheduled: ${report.counts.scheduled}`,
    `- Published: ${report.counts.published}`,
    `- Worker stage: ${report.worker.stage}`,
    `- Worker last run age: ${report.worker.lastRunAgeMinutes == null ? "unknown" : `${report.worker.lastRunAgeMinutes} minutes`}`,
    `- Blockers: ${report.worker.blockers.length ? report.worker.blockers.join(", ") : "none"}`,
    `- Content worker: ${report.contentWorker.status} (${report.contentWorker.freshForToday ? "fresh today" : "missing or stale"})`,
    `- Motivation ES planned/rendered/shortfall: ${report.contentWorker.motivation.es.planned}/${report.contentWorker.motivation.es.rendered}/${report.contentWorker.motivation.es.shortfall}`,
    `- Motivation EN planned/rendered/shortfall: ${report.contentWorker.motivation.en.planned}/${report.contentWorker.motivation.en.rendered}/${report.contentWorker.motivation.en.shortfall}`,
    `- Sleep status: ${report.contentWorker.sleep.status} (planned/generated/shortfall ${report.contentWorker.sleep.planned}/${report.contentWorker.sleep.generated}/${report.contentWorker.sleep.shortfall})`,
    `- Content blockers: ${report.contentWorker.blockers.length ? report.contentWorker.blockers.join(", ") : "none"}`,
    "- Content plan/render output is not publication proof; no YouTube upload is claimed from content-worker output.",
    `- YouTube delivery: ${report.youtubeDelivery.status} (${report.youtubeDelivery.freshForToday ? "fresh today" : "missing or stale"})`,
    `- Confirmed YouTube uploads: ${report.youtubeDelivery.published}`,
    `- YouTube URLs: ${report.youtubeDelivery.publicUrls.length ? report.youtubeDelivery.publicUrls.map((row) => row.youtubeUrl).join(", ") : "none"}`,
    `- YouTube delivery blockers: ${report.youtubeDelivery.blockers.length ? report.youtubeDelivery.blockers.join(", ") : "none"}`,
    ...(report.portfolioPreparation ? [
      `- Portfolio preparation: ${report.portfolioPreparation.status}; prepared ${report.portfolioPreparation.prepared}, confirmed uploads ${report.portfolioPreparation.uploaded}${report.portfolioPreparation.reason ? ` (${report.portfolioPreparation.reason})` : ""}`,
      "- Preparation is not social publication evidence; existing publisher switches are preserved.",
    ] : []),
    `- Cost: USD ${report.costUsd}`,
    "",
    report.alert
      ? `Local alert only; no message was sent. Causes: ${Object.entries(report.alerts).filter(([, active]) => active).map(([name]) => name).join(", ")}.`
      : report.status === "not_due"
        ? "The configured check hour has not arrived yet."
        : "At least one evidence-backed post was found for today.",
    "",
  ].join("\n");
}

export async function runClippersDailyWatchdog(options = {}) {
  const env = options.env || process.env;
  const workspaceRoot = path.resolve(options.workspaceRoot || env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const timeZone = clean(options.timeZone || env.CLIPPERS_WATCHDOG_TIME_ZONE) || DEFAULT_TIME_ZONE;
  const checkHour = Number(options.checkHour ?? env.CLIPPERS_WATCHDOG_HOUR ?? DEFAULT_CHECK_HOUR);
  if (!Number.isInteger(checkHour) || checkHour < 0 || checkHour > 23) throw new Error("CLIPPERS_WATCHDOG_HOUR must be an integer from 0 to 23");
  const account = normalizedAccount(options.account || env.CLIPPERS_TIKTOK_ACCOUNT || DEFAULT_ACCOUNT);
  if (!account) throw new Error("CLIPPERS_TIKTOK_ACCOUNT is required");
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const current = dateParts(now, timeZone);
  if (!current) throw new Error("invalid watchdog time");

  const reportsRoot = path.join(workspaceRoot, "reports");
  const ledgerPath = path.join(reportsRoot, "metricool-autopilot-ledger.json");
  const workerPath = path.join(reportsRoot, "free-local-worker", "latest.json");
  const supplyPath = path.join(reportsRoot, "marketplace-supply-report.json");
  const contentWorkerPath = path.resolve(
    options.contentWorkerReportPath
      || env.CLIPPERS_CONTENT_WORKER_REPORT
      || path.join(reportsRoot, "content-worker", "clippers-content-local-worker-latest.json"),
  );
  const youtubeDeliveryPath = path.resolve(
    options.youtubeDeliveryReportPath
      || env.CLIPPERS_YOUTUBE_DELIVERY_REPORT
      || path.join(reportsRoot, "youtube-delivery-worker-latest.json"),
  );
  const ledger = await readJson(ledgerPath, []);
  const worker = await readJson(workerPath, null);
  const supply = await readJson(supplyPath, null);
  const contentWorkerReport = await readJson(contentWorkerPath, null);
  const youtubeDeliveryReport = await readJson(youtubeDeliveryPath, null);
  const evidence = collectEvidence(ledger, { today: current.date, timeZone, account });
  const due = current.hour >= checkHour;
  const contentWorker = contentWorkerState(contentWorkerReport, {
    now,
    today: current.date,
    timeZone,
  });
  const youtubeDelivery = youtubeDeliveryState(youtubeDeliveryReport, { now, today: current.date, timeZone });
  const alerts = {
    noEvidenceBackedTikTokPost: due && evidence.length === 0,
    contentWorkerMissingOrStale: due && !contentWorker.freshForToday,
    contentWorkerInvalidReport: due && contentWorker.reportPresent && !contentWorker.schemaValid,
    contentWorkerShortfall: due && (
      contentWorker.motivation.es.shortfall > 0
      || contentWorker.motivation.en.shortfall > 0
      || contentWorker.sleep.shortfall > 0
    ),
    contentWorkerSafetyViolation: due && (
      contentWorker.blockers.includes("content_worker_publish_must_remain_disabled")
      || contentWorker.blockers.includes("content_worker_network_must_remain_disabled")
      || contentWorker.blockers.includes("content_worker_api_cost_must_remain_zero")
    ),
    youtubeDeliveryMissingOrStale: due && !youtubeDelivery.freshForToday,
    youtubeDeliveryInvalidReport: due && youtubeDelivery.reportPresent && !youtubeDelivery.schemaValid,
    youtubeDeliveryBlockedOrUncertain: due && ["blocked", "completed_with_blockers", "completed_with_uncertain_outcomes"].includes(youtubeDelivery.status),
  };
  const alert = Object.values(alerts).some(Boolean);
  const report = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    date: current.date,
    timeZone,
    checkHour,
    account: `@${account}`,
    status: !due ? "not_due" : alert ? "alert" : "healthy",
    alert,
    alerts,
    counts: {
      total: evidence.length,
      scheduled: evidence.filter((row) => row.status === "scheduled").length,
      published: evidence.filter((row) => row.status === "published").length,
    },
    evidence,
    worker: workerState(worker, supply, now),
    contentWorker,
    youtubeDelivery,
    evidenceFiles: { ledger: ledgerPath, worker: workerPath, supply: supplyPath, contentWorker: contentWorkerPath, youtubeDelivery: youtubeDeliveryPath },
    notificationSent: false,
    paidSpendAllowed: false,
    costUsd: 0,
  };
  if (due && options.dailyDiscovery === true) {
    try {
      const discovery = await (options.runPortfolioDiscovery || runPortfolioDiscovery)({
        stateDir: path.join(await realpath(workspaceRoot), "portfolio-discovery"), now,
      });
      report.publicDiscovery = {
        status: discovery.status, observedAt: discovery.observedAt,
        feedsObserved: discovery.feeds.filter(feed => feed.status === "observed").length,
        observations: discovery.observations.length,
        recentUnder72Hours: discovery.observations.filter(row => {
          const age = now.getTime() - Date.parse(row.publishedAt);
          return Number.isFinite(age) && age >= 0 && age <= 72 * 3_600_000;
        }).length,
        eligibleAssets: 0, mayPublish: false, paidSpendUsd: 0,
        reused: discovery.reused === true,
      };
      if (discovery.status !== "observed") report.alerts.publicDiscoveryBlocked = true;
    } catch {
      report.publicDiscovery = { status: "blocked", reason: "public_discovery_failed", eligibleAssets: 0, mayPublish: false, paidSpendUsd: 0 };
      report.alerts.publicDiscoveryBlocked = true;
    }
  }
  if (due && options.dailyOrchestraAnalytics === true) {
    try {
      const { collectClippersAccountAnalytics } = await import('./clippers-orchestra-analytics.mjs');
      const analytics=await collectClippersAccountAnalytics({workspaceRoot,now,env});
      report.accountAnalytics={generatedAt:analytics.generatedAt,paidSpendUsd:0,
        status:analytics.accounts.every(row=>row.status==='observed')?'observed':'held_or_partial',
        accounts:analytics.accounts.map(({brandId,network,account,status,reason,posts})=>({brandId,network,account,status,reason,samples:posts.length}))};
      if(report.accountAnalytics.status!=='observed')report.alerts.accountAnalyticsHeld=true;
    } catch { report.accountAnalytics={status:'held',reason:'account_analytics_unavailable',paidSpendUsd:0};report.alerts.accountAnalyticsHeld=true; }
  }
  if (due && options.dailyPrepare === true) {
    if (env.CLIPPERS_PORTFOLIO_PREPARE_ENABLED !== "true" || env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED !== "true") {
      report.portfolioPreparation = { status: "disabled", prepared: 0, uploaded: 0, paidSpendUsd: 0 };
    } else {
      try {
        report.portfolioPreparation = await (options.runPortfolioPrepare || runPortfolioPrepareChild)({ workspaceRoot, env });
        if (["blocked", "held", "held_or_partial"].includes(report.portfolioPreparation.status)) report.alerts.portfolioPreparationBlocked = true;
      } catch {
        report.portfolioPreparation = { status: "blocked", reason: "portfolio_prepare_failed", prepared: 0, uploaded: 0, paidSpendUsd: 0 };
        report.alerts.portfolioPreparationBlocked = true;
      }
    }
  }
  if (due && options.dailyLearning === true) {
    try {
      const root=await realpath(workspaceRoot);
      const input=await readWeeklyPrivateJson(root,'config/clippers-daily-learning/approved-input.json',{publish:false,assets:[]});
      if(input.publish===true && Array.isArray(input.assets) && input.assets.some(a=>a?.weeklyAuthorizationSha256||a?.editorialPolicy==='evergreen_streamer_clip')){
        report.weeklyScheduling=await (options.runWeeklySchedulingChild||runWeeklySchedulingChild)({workspaceRoot:root,window:remainingWeeklyWindow(now),env,now});
        if(report.weeklyScheduling.status==='blocked'||report.weeklyScheduling.scheduled===null)report.alerts.weeklySchedulingBlocked=true;
      }
    }catch{report.weeklyScheduling={status:'blocked',reason:'weekly_scheduling_unavailable',scheduled:null,paidSpendUsd:0};report.alerts.weeklySchedulingBlocked=true;}
  }
  if (due && options.dailyLearning === true) {
    try {
      const learning = await (options.runClippersDailyLearning || runClippersDailyLearning)({ workspaceRoot, now, env });
      report.dailyLearning = {
        status: learning.status, date: learning.date ?? current.date, reason: learning.reason ?? null,
        scheduled: learning.scheduled ?? null, observations: learning.observations ?? null,
        missedSnapshots: learning.missedSnapshots ?? null,
      };
      if (learning.status === "blocked" || learning.providerReadFailures > 0 || learning.timeBudgetReached) {
        report.alerts.dailyLearningBlocked = true;
      }
    } catch {
      report.dailyLearning = { status: "blocked", reason: "daily_learning_failed", date: current.date };
      report.alerts.dailyLearningBlocked = true;
    }
  }
  if (report.alerts.dailyLearningBlocked || report.alerts.publicDiscoveryBlocked || report.alerts.portfolioPreparationBlocked || report.alerts.accountAnalyticsHeld || report.alerts.weeklySchedulingBlocked) {
    report.alert = true;
    report.status = "alert";
  }
  const outputDirectory = path.resolve(options.outputDirectory || path.join(reportsRoot, "clippers-daily-watchdog"));
  await atomicWrite(path.join(outputDirectory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await atomicWrite(path.join(outputDirectory, "latest.md"), markdown(report));
  if (report.alert) {
    await atomicWrite(path.join(outputDirectory, "alerts", `${current.date}.json`), `${JSON.stringify(report, null, 2)}\n`);
    await atomicWrite(path.join(outputDirectory, "alerts", `${current.date}.md`), markdown(report));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // Retired Mac lane (covered by the cloud streamer jobs): exit without running.
  if (!(await import("./clippers-cloud-lanes.mjs").then((m) => m.macLaneGate("watchdog")).catch(() => true))) process.exit(0);
  const report = await runClippersDailyWatchdog({ dailyLearning: true, dailyDiscovery: true, dailyPrepare: true, dailyOrchestraAnalytics: true });
  console.log(JSON.stringify(report, null, 2));
  if (report.alert) process.exitCode = 2;
}
