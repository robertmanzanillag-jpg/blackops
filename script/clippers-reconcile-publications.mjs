import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TIMEZONE = "America/New_York";
const DEFAULT_ACCOUNT = "streamersclipusa";
const DEFAULT_GRACE_MS = 90 * 60_000;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeAccount(value) {
  return clean(value).replace(/^@/, "").toLowerCase();
}

function finiteNonNegative(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function exactTikTokPostUrl(value, account) {
  try {
    const url = new URL(clean(value));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const match = /^\/@([^/]+)\/video\/(\d+)$/.exec(url.pathname.replace(/\/$/, ""));
    if (url.protocol !== "https:" || host !== "tiktok.com" || !match) return "";
    if (match[1].toLowerCase() !== normalizeAccount(account)) return "";
    return `https://www.tiktok.com/@${normalizeAccount(account)}/video/${match[2]}`;
  } catch {
    return "";
  }
}

function objects(value) {
  const rows = [];
  const visit = (candidate) => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== "object") return;
    rows.push(candidate);
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return rows;
}

function strings(value) {
  const rows = [];
  const visit = (candidate) => {
    if (typeof candidate === "string") rows.push(candidate);
    else if (Array.isArray(candidate)) candidate.forEach(visit);
    else if (candidate && typeof candidate === "object") Object.values(candidate).forEach(visit);
  };
  visit(value);
  return rows;
}

function publicationId(record) {
  return clean(record?.id ?? record?.uuid ?? record?.postId ?? record?.publicationId);
}

function publicationStatus(record) {
  const values = objects(record).flatMap((row) => [
    row.status,
    row.state,
    row.publicationStatus,
    row.publishStatus,
  ]).map((value) => clean(value).toLowerCase()).filter(Boolean);
  if (values.some((value) => /failed|error|rejected|cancelled|canceled/.test(value))) return "failed";
  if (values.some((value) => /published|posted|completed|success/.test(value))) return "published";
  return "pending";
}

function explicitMetrics(record) {
  const candidates = objects(record);
  const firstNumber = (...names) => {
    for (const row of candidates) {
      for (const name of names) {
        const value = finiteNonNegative(row?.[name]);
        if (value !== undefined) return value;
      }
    }
    return undefined;
  };
  const result = {};
  const fields = {
    views: ["views", "viewCount", "videoViews"],
    likes: ["likes", "likeCount"],
    comments: ["comments", "commentCount"],
    shares: ["shares", "shareCount"],
    completionRate: ["completionRate", "videoCompletionRate"],
    shareRate: ["shareRate"],
    earningsUsd: ["earningsUsd", "approvedEarningsUsd"],
  };
  for (const [field, names] of Object.entries(fields)) {
    const value = firstNumber(...names);
    if (value !== undefined) result[field] = value;
  }
  for (const row of candidates) {
    if (typeof row?.qualifiedForPayout === "boolean") {
      result.qualifiedForPayout = row.qualifiedForPayout;
      break;
    }
  }
  return result;
}

function zonedInstant(localDateTime) {
  if (/Z$|[+-]\d\d:\d\d$/.test(localDateTime)) return Date.parse(localDateTime);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(localDateTime);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second] = match;
  const desired = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let instant = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const observed = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    instant += desired - observed;
  }
  return instant;
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

async function defaultGetPublication({ row, fetcher, env }) {
  const token = clean(env.METRICOOL_USER_TOKEN);
  const userId = clean(env.METRICOOL_USER_ID);
  const blogId = clean(row.metricoolBlogId || env.CLIPPERS_METRICOOL_BLOG_ID);
  if (!token || !userId || !blogId) throw new Error("metricool_reconciliation_credentials_missing");
  const date = clean(row.scheduledFor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("scheduled_date_missing");
  const url = `https://app.metricool.com/api/v2/scheduler/posts?blogId=${encodeURIComponent(blogId)}`
    + `&userId=${encodeURIComponent(userId)}&integrationSource=MCP`
    + `&start=${date}T00%3A00%3A00&end=${date}T23%3A59%3A59`
    + `&timezone=${encodeURIComponent(TIMEZONE)}&extendedRange=false`;
  const response = await fetcher(url, {
    headers: { "X-Mc-Auth": token, accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`metricool_http_${response.status}`);
  const payload = JSON.parse(await response.text());
  return objects(payload).find((candidate) => publicationId(candidate) === clean(row.metricoolId)) || null;
}

function markdownReport(report) {
  const lines = [
    "# Clippers post-publication reconciliation",
    "",
    `Generated: ${report.generatedAt}`,
    `Account: @${report.account}`,
    `Published: ${report.totals.published}`,
    `Pending: ${report.totals.pending}`,
    `Blocked: ${report.totals.blocked}`,
    "",
  ];
  for (const row of report.results) {
    lines.push(`- ${row.metricoolId || row.itemId || "unknown"}: ${row.status}${row.publicUrl ? ` — ${row.publicUrl}` : ""}${row.reason ? ` (${row.reason})` : ""}`);
  }
  lines.push("", "Only metrics explicitly returned by the publication source are recorded; missing values are not replaced with zero.", "");
  return lines.join("\n");
}

function metricIdentity(row) {
  if (clean(row.metricoolId)) return `metricool:${clean(row.metricoolId)}`;
  if (clean(row.itemId)) return `item:${clean(row.itemId)}`;
  return `delivery:${clean(row.campaignId)}|${clean(row.draftFile)}`;
}

function upsertPublishedMetric({ metrics, row, account, publicUrl, observed, now, workspaceRoot, reportPath }) {
  const identity = metricIdentity(row);
  const existingIndex = metrics.findIndex((candidate) => metricIdentity(candidate) === identity
    || exactTikTokPostUrl(candidate.publishedPostUrl, account) === publicUrl);
  const previous = existingIndex >= 0 ? metrics[existingIndex] : {};
  const metricRow = {
    ...previous,
    campaignId: row.campaignId,
    strategyId: row.strategyId,
    draftFile: row.draftFile,
    itemId: row.itemId,
    metricoolId: row.metricoolId,
    account: `@${account}`,
    finalStatus: "published",
    publishedPostUrl: publicUrl,
    publishedAt: row.publishedAt,
    observedAt: now.toISOString(),
    metricoolProofPath: path.relative(workspaceRoot, reportPath),
    metricEvidenceVerified: observed.views !== undefined,
    ...observed,
  };
  if (existingIndex >= 0) metrics[existingIndex] = metricRow;
  else metrics.push(metricRow);
}

export async function reconcileClipperPublications(options = {}) {
  const env = options.env || process.env;
  const workspaceRoot = path.resolve(options.workspaceRoot || env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const reportDir = path.join(workspaceRoot, "reports");
  const researchDir = path.join(workspaceRoot, "research");
  const ledgerPath = options.ledgerPath || path.join(reportDir, "metricool-autopilot-ledger.json");
  const metricsPath = options.metricsPath || path.join(researchDir, "paid-streamer-campaign-metrics.json");
  const reportPath = options.reportPath || path.join(reportDir, "metricool-publication-reconciliation.json");
  const markdownPath = options.markdownPath || path.join(reportDir, "metricool-publication-reconciliation.md");
  const lockPath = `${reportPath}.lock`;
  await mkdir(reportDir, { recursive: true });
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") return null;
    throw error;
  });
  if (!lock) return { status: "skipped", reason: "already_running", published: 0, pending: 0, blocked: 0 };

  try {
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8").catch(() => "[]"));
    const metrics = JSON.parse(await readFile(metricsPath, "utf8").catch(() => "[]"));
    if (!Array.isArray(ledger) || !Array.isArray(metrics)) throw new Error("invalid_reconciliation_storage");
    const account = normalizeAccount(env.CLIPPERS_TIKTOK_ACCOUNT || DEFAULT_ACCOUNT);
    if (!account) throw new Error("tiktok_account_missing");
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const graceMs = Math.max(0, Number(options.graceMs ?? DEFAULT_GRACE_MS));
    const fetcher = options.fetcher || fetch;
    const getPublication = options.dependencies?.getPublication || defaultGetPublication;
    const results = [];

    for (const row of ledger) {
      const deliveryStatus = clean(row?.status).toLowerCase();
      if (!['scheduled', 'verification_pending', 'published'].includes(deliveryStatus)) continue;
      if (normalizeAccount(row.account || account) !== account) continue;
      if (deliveryStatus === "published" && exactTikTokPostUrl(row.publicUrl || row.publishedPostUrl, account)) {
        const publicUrl = exactTikTokPostUrl(row.publicUrl || row.publishedPostUrl, account);
        const observed = row.publicationReconciliation?.metrics && typeof row.publicationReconciliation.metrics === "object"
          ? explicitMetrics(row.publicationReconciliation.metrics)
          : {};
        upsertPublishedMetric({ metrics, row, account, publicUrl, observed, now, workspaceRoot, reportPath });
        results.push({ metricoolId: clean(row.metricoolId), itemId: clean(row.itemId), status: "published", publicUrl, reason: "already_reconciled" });
        continue;
      }

      let remote;
      try {
        remote = await getPublication({ row, fetcher, env, account });
      } catch (error) {
        const result = { metricoolId: clean(row.metricoolId), itemId: clean(row.itemId), status: "blocked", reason: clean(error?.message || error).slice(0, 200) || "publication_lookup_failed" };
        row.publicationReconciliation = { ...result, checkedAt: now.toISOString() };
        results.push(result);
        continue;
      }

      const scheduledAt = zonedInstant(clean(row.scheduledFor));
      const pastGrace = Number.isFinite(scheduledAt) && now.getTime() > scheduledAt + graceMs;
      if (!remote) {
        const status = pastGrace ? "blocked" : "pending";
        const reason = pastGrace ? "metricool_post_missing_after_grace" : "awaiting_metricool_publication";
        row.publicationReconciliation = { status, reason, checkedAt: now.toISOString() };
        results.push({ metricoolId: clean(row.metricoolId), itemId: clean(row.itemId), status, reason });
        continue;
      }

      const remoteStatus = publicationStatus(remote);
      const publicUrl = strings(remote).map((value) => exactTikTokPostUrl(value, account)).find(Boolean) || "";
      if (remoteStatus === "failed") {
        const result = { metricoolId: clean(row.metricoolId), itemId: clean(row.itemId), status: "blocked", reason: "metricool_publication_failed" };
        row.publicationReconciliation = { ...result, checkedAt: now.toISOString() };
        results.push(result);
        continue;
      }
      if (!publicUrl) {
        const status = remoteStatus === "published" || pastGrace ? "blocked" : "pending";
        const reason = remoteStatus === "published"
          ? "published_without_exact_account_url"
          : pastGrace ? "public_url_missing_after_grace" : "awaiting_public_tiktok_url";
        row.publicationReconciliation = { status, reason, checkedAt: now.toISOString() };
        results.push({ metricoolId: clean(row.metricoolId), itemId: clean(row.itemId), status, reason });
        continue;
      }

      const observed = explicitMetrics(remote);
      row.status = "published";
      row.publicUrl = publicUrl;
      row.publishedPostUrl = publicUrl;
      row.publishedAt = clean(remote.publishedAt || remote.publicationDate || row.scheduledFor) || now.toISOString();
      row.reconciledAt = now.toISOString();
      row.publicationReconciliation = { status: "published", publicUrl, checkedAt: now.toISOString(), metrics: observed };

      upsertPublishedMetric({ metrics, row, account, publicUrl, observed, now, workspaceRoot, reportPath });
      results.push({ metricoolId: clean(row.metricoolId), itemId: clean(row.itemId), status: "published", publicUrl, metrics: observed });
    }

    const totals = {
      published: results.filter((row) => row.status === "published").length,
      pending: results.filter((row) => row.status === "pending").length,
      blocked: results.filter((row) => row.status === "blocked").length,
    };
    const report = { generatedAt: now.toISOString(), account, totals, results };
    await writeJsonAtomic(ledgerPath, ledger);
    await writeJsonAtomic(metricsPath, metrics);
    await writeJsonAtomic(reportPath, report);
    await writeFile(markdownPath, markdownReport(report), { mode: 0o600 });
    return {
      status: totals.blocked ? "attention_required" : totals.pending ? "pending" : "completed",
      ...totals,
      results,
      ledgerPath,
      metricsPath,
      reportPath,
      markdownPath,
    };
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await reconcileClipperPublications();
  console.log(JSON.stringify(result, null, 2));
  if (!["completed", "pending"].includes(result.status)) process.exitCode = 1;
}

export { exactTikTokPostUrl, explicitMetrics };
