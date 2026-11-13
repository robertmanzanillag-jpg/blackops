import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const METRICOOL_MCP_URL = "https://ai.metricool.com/mcp";
const TIMEZONE = "America/New_York";
const DAILY_SLOTS = ["10:00:00", "12:30:00", "15:00:00", "17:30:00", "20:00:00"];

function requiredEnv(env, name) {
  const value = String(env[name] || "").trim();
  if (!value || /replace|example|your[-_ ]?token/i.test(value)) throw new Error(`${name} is not configured`);
  return value;
}

function validPublicMediaUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:"
      && !/^(?:localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url.hostname);
  } catch {
    return false;
  }
}

function normalizeTags(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^[@#][A-Za-z0-9._-]{2,80}$/.test(value))));
}

function captionHasTag(caption, tag) {
  const captionTags = new Set((String(caption || "").match(/#[A-Za-z0-9._-]+/g) || [])
    .map((value) => value.toLowerCase()));
  return captionTags.has(String(tag || "").toLowerCase());
}

function parseMcpEnvelope(raw, contentType = "") {
  if (/^text\/event-stream\b/i.test(contentType) || /^\s*(?:event:|data:)/m.test(raw)) {
    const events = raw.split(/\r?\n\r?\n/).flatMap((event) => {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") return [];
      return [JSON.parse(data)];
    });
    return events.findLast((event) => event?.result || event?.error) || events.at(-1);
  }
  return JSON.parse(raw);
}

async function callMetricoolMcp(fetcher, token, args) {
  const response = await fetcher(METRICOOL_MCP_URL, {
    method: "POST",
    headers: {
      "X-Mc-Auth": token,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `clippers-${Date.now()}`,
      method: "tools/call",
      params: { name: "createScheduledPost", arguments: args },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Metricool MCP failed with HTTP ${response.status}`);
  const envelope = parseMcpEnvelope(raw, response.headers.get("content-type") || "");
  if (envelope?.error || envelope?.result?.isError) throw new Error("Metricool MCP rejected the scheduled post");
  return envelope?.result;
}

function objects(value) {
  const found = [];
  const visit = (candidate) => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== "object") return;
    found.push(candidate);
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return found;
}

async function verifyMetricoolSchedule(fetcher, token, userId, blogId, caption, publicationDateTime, options = {}) {
  const date = publicationDateTime.slice(0, 10);
  const url = `https://app.metricool.com/api/v2/scheduler/posts?blogId=${blogId}`
    + `&userId=${encodeURIComponent(userId)}&integrationSource=MCP`
    + `&start=${date}T00%3A00%3A00&end=${date}T23%3A59%3A59`
    + `&timezone=${encodeURIComponent(TIMEZONE)}&extendedRange=false`;
  const attempts = Math.max(1, Math.min(10, Math.trunc(Number(options.attempts ?? 6)) || 1));
  const delayMs = Math.max(0, Math.min(30_000, Math.trunc(Number(options.delayMs ?? 2_000)) || 0));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const response = await fetcher(url, {
      headers: { "X-Mc-Auth": token, accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Metricool verification failed with HTTP ${response.status}`);
    const value = JSON.parse(await response.text());
    const match = objects(value).find((record) => {
      const text = String(record.text ?? record.caption ?? record.content ?? "");
      const publication = record.publicationDate;
      const dateTime = typeof publication === "string"
        ? publication
        : String(publication?.dateTime ?? record.publicationDateTime ?? record.date ?? "");
      return text === caption && dateTime.startsWith(publicationDateTime);
    });
    const id = verifiedRecordId(match);
    if (id) return id;
  }
  throw new Error("Metricool scheduling outcome is unverified");
}

async function listMetricoolTikTokSchedule(fetcher, token, userId, blogId, startDate, endDate) {
  const url = `https://app.metricool.com/api/v2/scheduler/posts?blogId=${blogId}`
    + `&userId=${encodeURIComponent(userId)}&integrationSource=MCP`
    + `&start=${startDate}T00%3A00%3A00&end=${endDate}T23%3A59%3A59`
    + `&timezone=${encodeURIComponent(TIMEZONE)}&extendedRange=false`;
  const response = await fetcher(url, {
    headers: { "X-Mc-Auth": token, accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Metricool schedule preflight failed with HTTP ${response.status}`);
  const value = JSON.parse(await response.text());
  return objects(value).flatMap((record) => {
    const providers = Array.isArray(record.providers) ? record.providers : [];
    if (!providers.some((provider) => String(provider?.network || "").toLowerCase() === "tiktok")) return [];
    const publication = record.publicationDate;
    const dateTime = typeof publication === "string"
      ? publication
      : String(publication?.dateTime ?? record.publicationDateTime ?? record.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateTime)) return [];
    return [{
      id: verifiedRecordId(record),
      caption: String(record.text ?? record.caption ?? record.content ?? ""),
      dateTime: dateTime.slice(0, 19),
      mediaUrl: String(record.mediaUrl ?? record.media?.url ?? record.media?.[0]?.url ?? ""),
    }];
  });
}

function localDateParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zonedDateTime(localDateTime) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match) throw new Error("Invalid publication date");
  const [, year, month, day, hour, minute, second] = match;
  const wallClockMs = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instantMs = wallClockMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]));
    const observed = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    instantMs += wallClockMs - observed;
  }
  const offsetMinutes = Math.round((wallClockMs - instantMs) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${localDateTime}${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function buildPublicationSchedule(now = new Date(), count = 5, options = {}) {
  const safeCount = Math.max(0, Math.min(8, Math.trunc(Number(count) || 0)));
  const occupied = new Set(Array.isArray(options.occupiedLocalDateTimes) ? options.occupiedLocalDateTimes : []);
  const dailyCounts = new Map(Object.entries(options.existingDailyCounts || {})
    .map(([date, value]) => [date, Math.max(0, Math.trunc(Number(value) || 0))]));
  const dailyLimit = Math.max(1, Math.min(8, Math.trunc(Number(options.dailyLimit) || safeCount || 5)));
  const rows = [];
  let dayOffset = 0;
  while (rows.length < safeCount) {
    const day = new Date(now.getTime() + dayOffset * 86_400_000);
    const localDate = localDateParts(day);
    for (const slot of DAILY_SLOTS) {
      const local = `${localDate}T${slot}`;
      const instant = new Date(zonedDateTime(local));
      if (instant.getTime() <= now.getTime() + 30 * 60_000) continue;
      if (occupied.has(local) || (dailyCounts.get(localDate) || 0) >= dailyLimit) continue;
      rows.push(local);
      dailyCounts.set(localDate, (dailyCounts.get(localDate) || 0) + 1);
      if (rows.length >= safeCount) break;
    }
    dayOffset += 1;
  }
  return rows;
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function queueItemId(item) {
  return createHash("sha256")
    .update([item.campaignId, item.draftFile, item.account].map((value) => String(value || "")).join("|"))
    .digest("hex").slice(0, 16);
}

function itemDedupeKeys(item) {
  return [
    ["item", queueItemId(item)],
    ["draft", item.draftFile],
    ["media", item.mediaUrl],
    ["hash", item.mediaSha256 || item.sha256],
    ["caption", item.caption],
    ["source", item.sourceUrl],
  ].flatMap(([kind, value]) => normalized(value) ? [`${kind}:${normalized(value)}`] : []);
}

function hasDedupeCollision(item, keys) {
  return itemDedupeKeys(item).some((key) => keys.has(key));
}

function addDedupeKeys(item, keys) {
  itemDedupeKeys(item).forEach((key) => keys.add(key));
}

function verifiedRecordId(record) {
  const id = String(record?.id ?? record?.uuid ?? "").trim();
  return id && !/^(?:null|undefined|0)$/i.test(id) ? id : "";
}

export function validateAutopilotItem(item, expectedAccount) {
  const requiredHashtags = normalizeTags(item.requiredHashtags);
  const caption = String(item.caption || "").trim();
  const account = String(item.account || "").replace(/^@/, "").toLowerCase();
  const blockers = [
    item.publishAllowed !== true ? "publish_not_authorized" : null,
    item.status !== "ready_for_metricool_autopilot" ? "queue_status_not_ready" : null,
    account !== expectedAccount.toLowerCase() ? "wrong_account" : null,
    !validPublicMediaUrl(item.mediaUrl) ? "public_https_media_required" : null,
    !caption ? "caption_missing" : null,
    requiredHashtags.some((tag) => !captionHasTag(caption, tag)) ? "required_hashtag_missing" : null,
  ].filter(Boolean);
  return { blockers, requiredHashtags, account, caption };
}

function validateMediaReceipt(item, mediaReceipts) {
  const receipt = mediaReceipts.find((row) => normalized(row?.draftFile) === normalized(item.draftFile)
    && normalized(row?.campaignId) === normalized(item.campaignId));
  if (!receipt) return { blocker: "verified_media_receipt_missing", receipt: null };
  if (!verifiedRecordId({ id: receipt.fileId })) return { blocker: "verified_media_file_id_missing", receipt };
  if (normalized(receipt.mediaUrl) !== normalized(item.mediaUrl)) {
    return { blocker: "media_url_receipt_mismatch", receipt };
  }
  const expectedHash = normalized(item.mediaSha256 || item.sha256);
  if (expectedHash && normalized(receipt.sha256) !== expectedHash) {
    return { blocker: "media_hash_receipt_mismatch", receipt };
  }
  return { blocker: null, receipt };
}

function slotIsBeforeCampaignExpiry(item, publicationDateTime) {
  if (!item.campaignExpiresAt) return true;
  const expiresAt = Date.parse(String(item.campaignExpiresAt));
  return Number.isFinite(expiresAt) && new Date(zonedDateTime(publicationDateTime)).getTime() < expiresAt;
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

async function acquireAutopilotLock(lockPath) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const lockAgeMs = Date.now() - (await stat(lockPath).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      if (lockAgeMs <= 2 * 60 * 60_000) return null;
      const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
      try {
        await rename(lockPath, stalePath);
        await unlink(stalePath).catch(() => {});
      } catch (renameError) {
        if (renameError?.code !== "ENOENT") throw renameError;
      }
    }
  }
  return null;
}

export async function runMetricoolAutopilot(options = {}) {
  const env = options.env || process.env;
  const dryRun = options.dryRun === true || env.CLIPPERS_METRICOOL_DRY_RUN === "true";
  if (!dryRun && env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED !== "true") {
    return { status: "blocked", reason: "explicit_autopublish_authorization_required", scheduled: 0 };
  }
  const fetcher = options.fetch || fetch;
  const workspaceRoot = path.resolve(options.workspaceRoot || env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const reportDir = path.join(workspaceRoot, "reports");
  const queuePath = path.join(reportDir, "metricool-autopilot-queue.json");
  const ledgerPath = path.join(reportDir, "metricool-autopilot-ledger.json");
  const mediaReceiptsPath = path.join(reportDir, "metricool-public-media-receipts.json");
  const lockPath = path.join(reportDir, "metricool-autopilot.lock");
  await mkdir(reportDir, { recursive: true });
  const lock = await acquireAutopilotLock(lockPath);
  if (!lock) return { status: "skipped", reason: "already_running", scheduled: 0, blocked: 0 };
  try {
  const queue = options.queue || JSON.parse(await readFile(queuePath, "utf8").catch(() => "{\"items\":[]}"));
  const ledger = options.ledger || JSON.parse(await readFile(ledgerPath, "utf8").catch(() => "[]"));
  const mediaReceipts = options.mediaReceipts
    || JSON.parse(await readFile(mediaReceiptsPath, "utf8").catch(() => "[]"));
  const token = dryRun ? "" : requiredEnv(env, "METRICOOL_USER_TOKEN");
  const userId = dryRun ? String(env.METRICOOL_USER_ID || "dry-run") : requiredEnv(env, "METRICOOL_USER_ID");
  const expectedBlogId = Number(requiredEnv(env, "CLIPPERS_METRICOOL_BLOG_ID"));
  if (!Number.isInteger(expectedBlogId) || expectedBlogId <= 0) throw new Error("CLIPPERS_METRICOOL_BLOG_ID is invalid");
  const expectedAccount = String(env.CLIPPERS_TIKTOK_ACCOUNT || "streamersclipusa").replace(/^@/, "");
  const targetDailyClips = Math.max(0, Math.min(8, Math.trunc(Number(queue.targetDailyClips) || 0)));
  const now = options.now || new Date();
  const deliveredKeys = new Set();
  const pendingByItemId = new Map();
  for (const row of Array.isArray(ledger) ? ledger : []) {
    const status = normalized(row?.status);
    if (["scheduled", "published"].includes(status)) addDedupeKeys(row, deliveredKeys);
    if (status === "verification_pending" && row?.itemId) pendingByItemId.set(String(row.itemId), row);
  }
  const candidatesById = new Map();
  const results = [];
  const queuedKeys = new Set();
  for (const rawItem of Array.isArray(queue.items) ? queue.items : []) {
    const item = { ...rawItem, itemId: queueItemId(rawItem) };
    if (hasDedupeCollision(item, deliveredKeys)) {
      results.push({ itemId: item.itemId, status: "deduplicated", reason: "equivalent_delivery_already_recorded" });
      continue;
    }
    if (pendingByItemId.has(item.itemId)) continue;
    if (hasDedupeCollision(item, queuedKeys)) {
      results.push({ itemId: item.itemId, status: "deduplicated", reason: "equivalent_queue_item" });
      continue;
    }
    addDedupeKeys(item, queuedKeys);
    candidatesById.set(item.itemId, item);
  }
  const candidates = [];
  for (const item of candidatesById.values()) {
    const validation = validateAutopilotItem(item, expectedAccount);
    const mediaValidation = validateMediaReceipt(item, Array.isArray(mediaReceipts) ? mediaReceipts : []);
    const blogId = Number(item.blogId || expectedBlogId);
    const campaignExpiresAt = item.campaignExpiresAt ? Date.parse(String(item.campaignExpiresAt)) : null;
    const blockers = [
      ...validation.blockers,
      mediaValidation.blocker,
      !Number.isInteger(blogId) || blogId <= 0 ? "metricool_blog_id_missing" : null,
      Number.isInteger(blogId) && blogId > 0 && blogId !== expectedBlogId ? "wrong_metricool_blog" : null,
      campaignExpiresAt !== null && (!Number.isFinite(campaignExpiresAt) || campaignExpiresAt <= now.getTime())
        ? "campaign_expired_or_invalid"
        : null,
    ].filter(Boolean);
    if (blockers.length) {
      results.push({ itemId: item.itemId, status: "blocked", blockers });
    } else {
      candidates.push({ item, validation, blogId, mediaReceipt: mediaValidation.receipt });
    }
  }
  if (!candidates.length && !pendingByItemId.size) {
    return {
      status: "blocked",
      scheduled: 0,
      blocked: results.length,
      verificationPending: 0,
      results,
      ledgerPath,
    };
  }
  if (dryRun) {
    const schedule = buildPublicationSchedule(now, Math.min(targetDailyClips, candidates.length), {
      dailyLimit: targetDailyClips,
    });
    candidates.slice(0, schedule.length).forEach(({ item, validation, blogId, mediaReceipt }, index) => {
      results.push({
        itemId: item.itemId,
        campaignId: item.campaignId,
        draftFile: item.draftFile,
        account: validation.account,
        metricoolBlogId: blogId,
        mediaReceiptFileId: mediaReceipt.fileId,
        scheduledFor: schedule[index],
        status: "dry_run",
        paidSpendAllowed: false,
      });
    });
    return {
      status: results.some((row) => row.status === "dry_run") ? "dry_run" : "blocked",
      dryRun: true,
      scheduled: 0,
      wouldSchedule: results.filter((row) => row.status === "dry_run").length,
      blocked: results.filter((row) => row.status === "blocked").length,
      results,
      ledgerPath,
    };
  }
  const startDate = localDateParts(now);
  const endDate = localDateParts(new Date(now.getTime() + 7 * 86_400_000));
  const existingSchedule = await listMetricoolTikTokSchedule(
    fetcher,
    token,
    userId,
    expectedBlogId,
    startDate,
    endDate,
  );
  for (const [itemId, pending] of pendingByItemId) {
    const match = existingSchedule.find((row) => row.id
      && normalized(row.caption) === normalized(pending.caption)
      && (!pending.scheduledFor || row.dateTime === pending.scheduledFor));
    if (match) {
      pending.status = "scheduled";
      pending.metricoolId = match.id;
      pending.reconciledAt = new Date().toISOString();
      delete pending.reason;
      delete pending.error;
      results.push(pending);
    } else {
      results.push({ ...pending, status: "verification_pending", reason: "retry_suppressed_until_remote_outcome_is_known" });
    }
  }
  if (pendingByItemId.size) await writeJsonAtomic(ledgerPath, ledger);
  const existingDailyCounts = {};
  for (const row of existingSchedule) {
    const date = row.dateTime.slice(0, 10);
    existingDailyCounts[date] = (existingDailyCounts[date] || 0) + 1;
  }
  const schedule = buildPublicationSchedule(now, Math.min(targetDailyClips, candidates.length), {
    occupiedLocalDateTimes: existingSchedule.map((row) => row.dateTime),
    existingDailyCounts,
    dailyLimit: targetDailyClips,
  });
  let scheduleIndex = 0;

  for (const candidate of candidates) {
    if (scheduleIndex >= schedule.length) break;
    const { item, validation, blogId, mediaReceipt } = candidate;
    const publicationDateTime = schedule[scheduleIndex];
    if (!slotIsBeforeCampaignExpiry(item, publicationDateTime)) {
      results.push({ itemId: item.itemId, status: "blocked", blockers: ["campaign_expires_before_slot"] });
      continue;
    }
    scheduleIndex += 1;
    const immediateSchedule = await listMetricoolTikTokSchedule(
      fetcher, token, userId, blogId, publicationDateTime.slice(0, 10), publicationDateTime.slice(0, 10),
    );
    const equivalent = immediateSchedule.find((row) => normalized(row.caption) === normalized(validation.caption)
      || (row.mediaUrl && normalized(row.mediaUrl) === normalized(item.mediaUrl)));
    if (equivalent) {
      if (!equivalent.id) {
        results.push({ itemId: item.itemId, status: "blocked", blockers: ["unverified_remote_duplicate"] });
        continue;
      }
      const receipt = {
        itemId: item.itemId,
        campaignId: item.campaignId,
        draftFile: item.draftFile,
        account: validation.account,
        caption: validation.caption,
        mediaUrl: item.mediaUrl,
        mediaSha256: mediaReceipt.sha256,
        scheduledFor: equivalent.dateTime,
        metricoolBlogId: blogId,
        metricoolUserId: userId,
        status: "scheduled",
        metricoolId: equivalent.id,
        reconciledAt: new Date().toISOString(),
        paidSpendAllowed: false,
      };
      ledger.push(receipt);
      results.push(receipt);
      await writeJsonAtomic(ledgerPath, ledger);
      continue;
    }
    const payload = {
      autoPublish: true,
      descendants: [],
      draft: false,
      firstCommentText: "",
      hasNotReadNotes: false,
      mediaAltText: [],
      providers: [{ network: "tiktok" }],
      publicationDate: { dateTime: publicationDateTime, timezone: TIMEZONE },
      shortener: false,
      smartLinkData: { ids: [] },
      text: validation.caption,
      tiktokData: {
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
        privacyOption: "PUBLIC_TO_EVERYONE",
        commercialContentThirdParty: validation.requiredHashtags.some((tag) => tag.toLowerCase() === "#paidpartner"),
        commercialContentOwnBrand: false,
        title: validation.caption.slice(0, 100),
        autoAddMusic: false,
        photoCoverIndex: 0,
      },
    };
    const receiptBase = {
      itemId: item.itemId,
      campaignId: item.campaignId,
      draftFile: item.draftFile,
      account: validation.account,
      caption: validation.caption,
      requiredHashtags: validation.requiredHashtags,
      strategyId: item.strategyId,
      subtitleStyle: item.subtitleStyle,
      hookStyle: item.hookStyle,
      mediaUrl: item.mediaUrl,
      mediaSha256: mediaReceipt.sha256,
      mediaReceiptFileId: mediaReceipt.fileId,
      scheduledFor: publicationDateTime,
      metricoolBlogId: blogId,
      metricoolUserId: userId,
      createdAt: new Date().toISOString(),
      paidSpendAllowed: false,
    };
    let receipt;
    try {
      await callMetricoolMcp(fetcher, token, {
        date: zonedDateTime(publicationDateTime),
        blogId: String(blogId),
        info: JSON.stringify(payload),
        mediaFiles: [{
          download_url: item.mediaUrl,
          file_id: `clippers-${item.itemId}.mp4`,
        }],
      });
      const metricoolId = await verifyMetricoolSchedule(
        fetcher,
        token,
        userId,
        blogId,
        validation.caption,
        publicationDateTime,
        { attempts: options.verifyAttempts, delayMs: options.verifyDelayMs },
      );
      receipt = { ...receiptBase, status: "scheduled", metricoolId };
    } catch (error) {
      receipt = {
        ...receiptBase,
        status: "verification_pending",
        reason: "metricool_outcome_not_verified_retry_suppressed",
        error: String(error?.message || error).slice(0, 300),
      };
    }
    ledger.push(receipt);
    results.push(receipt);
    await writeJsonAtomic(ledgerPath, ledger);
  }
  const attentionRequired = results.some((row) => row.status === "verification_pending");
  return {
    status: attentionRequired
      ? "attention_required"
      : results.some((row) => row.status === "scheduled") ? "completed" : "blocked",
    scheduled: results.filter((row) => row.status === "scheduled").length,
    blocked: results.filter((row) => row.status === "blocked").length,
    verificationPending: results.filter((row) => row.status === "verification_pending").length,
    results,
    ledgerPath,
  };
  } finally {
    await lock?.close();
    await unlink(lockPath).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runMetricoolAutopilot();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "completed") process.exitCode = 1;
}
