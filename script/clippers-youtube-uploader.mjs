import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LANES = Object.freeze({
  motivation_es: "ES",
  motivation_en: "EN",
  sleep: "SLEEP",
});
const PRIVACY = new Set(["private", "unlisted", "public"]);
const RIGHTS = new Set(["owned", "explicitly_authorized"]);
const SHA256 = /^[a-f0-9]{64}$/i;
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,30}$/;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{6,32}$/;
const ACTIVE_LEDGER_STATES = new Set(["upload_started", "uncertain_outcome", "uploaded", "scheduled"]);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true";
const UPLOAD_START_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus";
const EMPTY_LOCK_STALE_MS = 30 * 60 * 1000;
const PRIVACY_POLICY_VERSION = "2026-08-26";

const clean = (value) => String(value ?? "").trim();
const sha256Buffer = (value) => createHash("sha256").update(value).digest("hex");

export function privacyPolicyAcceptanceValid(value) {
  return value?.accepted === true
    && clean(value?.version) === PRIVACY_POLICY_VERSION
    && clean(value?.acceptedBy).toLowerCase() === "robert"
    && Number.isFinite(Date.parse(clean(value?.acceptedAt)));
}

export function privacyPolicyAcceptanceMatches(left, right) {
  return privacyPolicyAcceptanceValid(left)
    && privacyPolicyAcceptanceValid(right)
    && clean(left.version) === clean(right.version)
    && clean(left.acceptedBy).toLowerCase() === clean(right.acceptedBy).toLowerCase()
    && clean(left.acceptedAt) === clean(right.acceptedAt);
}

async function jsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function safeRegularFile(root, relativeFile) {
  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, clean(relativeFile));
  const relative = path.relative(rootPath, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [rootReal, fileReal, info] = await Promise.all([
    realpath(rootPath).catch(() => null),
    realpath(candidate).catch(() => null),
    lstat(candidate).catch(() => null),
  ]);
  if (!rootReal || !fileReal || !info?.isFile() || info.isSymbolicLink()) return null;
  const realRelative = path.relative(rootReal, fileReal);
  return realRelative && !realRelative.startsWith("..") && !path.isAbsolute(realRelative) ? candidate : null;
}

export async function sha256FileStream(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function secretPresent(value) {
  const normalized = clean(value);
  return Boolean(normalized && !/^(?:changeme|replace|example|todo|your[-_ ])/i.test(normalized));
}

export function channelConfigFromEnv(env, lane) {
  const suffix = LANES[lane];
  if (!suffix) return null;
  return {
    lane,
    expectedChannelId: clean(env[`CLIPPERS_YOUTUBE_${suffix}_CHANNEL_ID`]),
    clientId: clean(env[`CLIPPERS_YOUTUBE_${suffix}_CLIENT_ID`]),
    clientSecret: clean(env[`CLIPPERS_YOUTUBE_${suffix}_CLIENT_SECRET`]),
    refreshToken: clean(env[`CLIPPERS_YOUTUBE_${suffix}_REFRESH_TOKEN`]),
  };
}

function configBlockers(config) {
  const blockers = [];
  if (!config || !LANES[config.lane]) blockers.push("lane_config_missing");
  if (!YOUTUBE_CHANNEL_ID.test(clean(config?.expectedChannelId))) blockers.push("expected_channel_id_missing_or_invalid");
  if (![config?.clientId, config?.clientSecret, config?.refreshToken].every(secretPresent)) blockers.push("oauth_refresh_config_missing");
  return blockers;
}

function publishAtBlockers(item, now) {
  const publishAt = clean(item?.publishAt);
  if (!publishAt) return [];
  if (!RFC3339.test(publishAt) || !Number.isFinite(Date.parse(publishAt))) return ["publish_at_rfc3339_invalid"];
  if (Date.parse(publishAt) <= now.getTime()) return ["publish_at_must_be_future"];
  if ((clean(item?.privacyStatus) || "private") !== "private") return ["scheduled_upload_must_be_private"];
  return [];
}

export function validateUploadItem(item, options = {}) {
  const blockers = [];
  const now = options.now instanceof Date ? options.now : new Date();
  if (Number(item?.schemaVersion) !== 1) blockers.push("schema_version_invalid");
  if (!/^[a-z0-9][a-z0-9_-]{1,99}$/.test(clean(item?.itemId))) blockers.push("item_id_invalid");
  if (!LANES[clean(item?.lane)]) blockers.push("lane_invalid");
  if (!clean(item?.file).toLowerCase().endsWith(".mp4")) blockers.push("mp4_file_required");
  if (!SHA256.test(clean(item?.sha256))) blockers.push("media_hash_missing_or_invalid");
  const title = clean(item?.title);
  if (!title || title.length > 100) blockers.push("title_invalid");
  if (clean(item?.description).length > 5_000) blockers.push("description_too_long");
  const privacyStatus = clean(item?.privacyStatus) || "private";
  if (!PRIVACY.has(privacyStatus)) blockers.push("privacy_status_invalid");
  if (typeof item?.madeForKids !== "boolean") blockers.push("made_for_kids_choice_required");
  if (!privacyPolicyAcceptanceValid(item?.privacyPolicyAcceptance)) blockers.push("youtube_privacy_policy_acceptance_required");
  if (!clean(item?.rightsEvidence?.file) || !SHA256.test(clean(item?.rightsEvidence?.sha256))) blockers.push("rights_evidence_reference_invalid");
  if (!clean(item?.qaEvidence?.file) || !SHA256.test(clean(item?.qaEvidence?.sha256))) blockers.push("qa_evidence_reference_invalid");
  blockers.push(...publishAtBlockers(item, now));
  if (privacyStatus === "public" || clean(item?.publishAt)) {
    const authorization = item?.publishAuthorization;
    if (authorization?.public !== true || !clean(authorization?.authorizedBy)
      || !Number.isFinite(Date.parse(clean(authorization?.authorizedAt)))) blockers.push("per_item_public_authorization_missing");
    if (item?.youtubeApiProjectAuditVerified !== true) blockers.push("youtube_api_project_audit_required");
  }
  return [...new Set(blockers)];
}

function rightsEvidenceValid(evidence, item, actualHash) {
  return Number(evidence?.schemaVersion) === 1
    && clean(evidence?.assetType) === "youtube_video"
    && clean(evidence?.itemId) === clean(item.itemId)
    && clean(evidence?.file) === clean(item.file)
    && clean(evidence?.sha256).toLowerCase() === actualHash
    && RIGHTS.has(clean(evidence?.rightsStatus))
    && evidence?.commercialUseAuthorized === true
    && Boolean(clean(evidence?.verifiedBy))
    && Number.isFinite(Date.parse(clean(evidence?.verifiedAt)));
}

function qaEvidenceValid(evidence, item, actualHash) {
  const checks = evidence?.checks;
  return Number(evidence?.schemaVersion) === 1
    && clean(evidence?.assetType) === "youtube_video_qa"
    && clean(evidence?.itemId) === clean(item.itemId)
    && clean(evidence?.file) === clean(item.file)
    && clean(evidence?.sha256).toLowerCase() === actualHash
    && evidence?.approved === true
    && checks?.playbackComplete === true
    && checks?.videoValid === true
    && checks?.audioValid === true
    && checks?.formatAccepted === true
    && Boolean(clean(evidence?.reviewedBy))
    && Number.isFinite(Date.parse(clean(evidence?.reviewedAt)));
}

function ledgerItems(value) {
  return Array.isArray(value?.items) ? value.items : [];
}

async function readLedger(ledgerPath) {
  try {
    const parsed = JSON.parse(await readFile(ledgerPath, "utf8"));
    return Number(parsed?.schemaVersion) === 1 && Array.isArray(parsed?.items) ? parsed : null;
  } catch (error) {
    return error?.code === "ENOENT" ? { schemaVersion: 1, items: [] } : null;
  }
}

function duplicateReason(rows, item, actualHash) {
  const active = rows.filter((row) => ACTIVE_LEDGER_STATES.has(clean(row?.status)));
  if (active.some((row) => clean(row?.itemId) === clean(item.itemId))) return "duplicate_item_id";
  if (active.some((row) => clean(row?.sha256).toLowerCase() === actualHash)) return "duplicate_media_hash";
  if (active.some((row) => clean(row?.file) === clean(item.file))) return "duplicate_media_file";
  return null;
}

async function appendLedger(ledgerPath, row) {
  const current = await readLedger(ledgerPath);
  if (!current) throw new Error("youtube_upload_ledger_invalid");
  const items = ledgerItems(current);
  await atomicJson(ledgerPath, { schemaVersion: 1, items: [...items, row] });
}

async function acquireLedgerLock(lockPath) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
      await lock.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
      return lock;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await lock?.close().catch(() => {});
      const [existing, info] = await Promise.all([
        jsonFile(lockPath).catch(() => null),
        lstat(lockPath).catch(() => null),
      ]);
      const pid = Number(existing?.pid);
      const isOldEmptyLock = info?.size === 0 && Date.now() - info.mtimeMs > EMPTY_LOCK_STALE_MS;
      if (processAlive(pid) || (!pid && !isOldEmptyLock)) return null;
      await rm(lockPath, { force: true });
    }
  }
  return null;
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function oauthAccessToken(config, fetcher) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await responseJson(response);
  if (!response.ok || !secretPresent(payload?.access_token)) throw new Error("oauth_refresh_failed");
  return payload.access_token;
}

async function verifyChannel(accessToken, expectedChannelId, fetcher) {
  const response = await fetcher(CHANNELS_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  const payload = await responseJson(response);
  if (!response.ok || !Array.isArray(payload?.items)) throw new Error("channel_verification_failed");
  if (payload.items.length !== 1 || clean(payload.items[0]?.id) !== expectedChannelId) throw new Error("authenticated_channel_mismatch");
}

function safeResumableUrl(location) {
  try {
    const parsed = new URL(location);
    const isOfficialHost = ["www.googleapis.com", "youtube.googleapis.com"].includes(parsed.hostname);
    const isYouTubeUploadPath = parsed.pathname === "/upload/youtube/v3/videos";
    const isResumable = parsed.searchParams.get("uploadType") === "resumable";
    const hasOpaqueUploadId = Boolean(clean(parsed.searchParams.get("upload_id")));
    return parsed.protocol === "https:" && isOfficialHost && isYouTubeUploadPath && isResumable && hasOpaqueUploadId
      ? parsed.href : null;
  } catch {
    return null;
  }
}

function publicAuthorizationBlocker(item, env) {
  const privacy = clean(item?.privacyStatus) || "private";
  const publicIntent = privacy === "public" || Boolean(clean(item?.publishAt));
  if (!publicIntent) return null;
  if (env.CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED !== "true") return "global_public_publish_authorization_missing";
  return env.CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED === "true" ? null : "youtube_api_project_audit_required";
}

export async function runYouTubeUpload(options = {}) {
  const env = options.env || process.env;
  const workspaceRoot = path.resolve(options.workspaceRoot || env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const itemPath = await safeRegularFile(workspaceRoot, options.itemFile);
  const dryRun = options.dryRun === true || env.CLIPPERS_YOUTUBE_DRY_RUN === "true";
  const now = options.now instanceof Date ? options.now : new Date();
  const fetcher = options.fetcher || fetch;
  const ledgerPath = path.join(workspaceRoot, "reports", "youtube-upload-ledger.json");
  const resultBase = { apiCostUsd: 0, paidSpendAllowed: false, dryRun };
  if (!itemPath) return { ...resultBase, status: "blocked", blockers: ["item_manifest_missing_or_unsafe"] };
  const item = await jsonFile(itemPath);
  const itemBlockers = validateUploadItem(item, { now });
  if (itemBlockers.length) return { ...resultBase, status: "blocked", blockers: itemBlockers };

  const mediaPath = await safeRegularFile(workspaceRoot, item.file);
  const rightsPath = await safeRegularFile(workspaceRoot, item.rightsEvidence.file);
  const qaPath = await safeRegularFile(workspaceRoot, item.qaEvidence.file);
  const artifactBlockers = [];
  if (!mediaPath) artifactBlockers.push("media_missing_or_unsafe");
  if (!rightsPath) artifactBlockers.push("rights_evidence_missing_or_unsafe");
  if (!qaPath) artifactBlockers.push("qa_evidence_missing_or_unsafe");
  if (artifactBlockers.length) return { ...resultBase, status: "blocked", blockers: artifactBlockers };

  const [actualHash, rightsHash, qaHash, rightsEvidence, qaEvidence, mediaStat] = await Promise.all([
    sha256FileStream(mediaPath), sha256FileStream(rightsPath), sha256FileStream(qaPath), jsonFile(rightsPath), jsonFile(qaPath), stat(mediaPath),
  ]);
  const evidenceBlockers = [];
  if (actualHash !== clean(item.sha256).toLowerCase()) evidenceBlockers.push("media_hash_mismatch");
  if (rightsHash !== clean(item.rightsEvidence.sha256).toLowerCase()) evidenceBlockers.push("rights_evidence_hash_mismatch");
  if (qaHash !== clean(item.qaEvidence.sha256).toLowerCase()) evidenceBlockers.push("qa_evidence_hash_mismatch");
  if (!rightsEvidenceValid(rightsEvidence, item, actualHash)) evidenceBlockers.push("rights_evidence_invalid");
  if (!qaEvidenceValid(qaEvidence, item, actualHash)) evidenceBlockers.push("qa_evidence_invalid");
  if (mediaStat.size < 1) evidenceBlockers.push("media_empty");
  const publicBlocker = publicAuthorizationBlocker(item, env);
  if (publicBlocker) evidenceBlockers.push(publicBlocker);
  if (evidenceBlockers.length) return { ...resultBase, status: "blocked", blockers: evidenceBlockers };

  const ledger = await readLedger(ledgerPath);
  if (!ledger) return { ...resultBase, status: "blocked", blockers: ["youtube_upload_ledger_invalid"] };
  const duplicate = duplicateReason(ledgerItems(ledger), item, actualHash);
  if (duplicate) return { ...resultBase, status: "duplicate", blockers: [duplicate], itemId: item.itemId, lane: item.lane };

  const config = options.channelConfigs?.[item.lane] || channelConfigFromEnv(env, item.lane);
  const authBlockers = configBlockers(config);
  const preflight = {
    ...resultBase,
    status: dryRun ? "preflight" : "blocked",
    blockers: authBlockers,
    itemId: item.itemId,
    lane: item.lane,
    privacyStatus: clean(item.privacyStatus) || "private",
    publishAt: clean(item.publishAt) || null,
    scheduled: Boolean(clean(item.publishAt)),
    publicConfirmed: false,
    expectedChannelId: clean(config?.expectedChannelId) || null,
    file: item.file,
    sha256: actualHash,
    sizeBytes: mediaStat.size,
    rightsVerified: true,
    qaApproved: true,
    uploadAttempted: false,
  };
  if (dryRun) return preflight;
  if (authBlockers.length) return preflight;

  const lockPath = `${ledgerPath}.lock`;
  const lock = await acquireLedgerLock(lockPath);
  if (!lock) {
    return { ...resultBase, status: "blocked", blockers: ["upload_lock_busy"], itemId: item.itemId, lane: item.lane };
  }
  try {
    const latestLedger = await readLedger(ledgerPath);
    if (!latestLedger) return { ...resultBase, status: "blocked", blockers: ["youtube_upload_ledger_invalid"], itemId: item.itemId, lane: item.lane };
    const lockedDuplicate = duplicateReason(ledgerItems(latestLedger), item, actualHash);
    if (lockedDuplicate) return { ...resultBase, status: "duplicate", blockers: [lockedDuplicate], itemId: item.itemId, lane: item.lane };

    let accessToken;
    try {
      accessToken = await oauthAccessToken(config, fetcher);
      await verifyChannel(accessToken, config.expectedChannelId, fetcher);
    } catch (error) {
      return { ...resultBase, status: "blocked", blockers: [clean(error?.message) || "youtube_preflight_failed"], itemId: item.itemId, lane: item.lane };
    }

    const privacyStatus = clean(item.privacyStatus) || "private";
    const metadata = {
      snippet: {
        title: clean(item.title),
        description: clean(item.description),
        ...(Array.isArray(item.tags) && item.tags.length ? { tags: item.tags.map(clean).filter(Boolean).slice(0, 50) } : {}),
        ...(clean(item.categoryId) ? { categoryId: clean(item.categoryId) } : {}),
      },
      status: {
        privacyStatus: clean(item.publishAt) ? "private" : privacyStatus,
        ...(clean(item.publishAt) ? { publishAt: clean(item.publishAt) } : {}),
        selfDeclaredMadeForKids: item.madeForKids === true,
      },
    };
    let sessionResponse;
    try {
      sessionResponse = await fetcher(UPLOAD_START_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(mediaStat.size),
          "x-upload-content-type": "video/mp4",
        },
        body: JSON.stringify(metadata),
      });
    } catch {
      return { ...resultBase, status: "blocked", blockers: ["resumable_session_start_failed"], itemId: item.itemId, lane: item.lane };
    }
    const uploadUrl = safeResumableUrl(sessionResponse.headers.get("location"));
    if (!sessionResponse.ok || !uploadUrl) {
      return { ...resultBase, status: "blocked", blockers: ["resumable_session_rejected"], itemId: item.itemId, lane: item.lane };
    }

    const startedAt = now.toISOString();
    const commonLedger = {
      itemId: item.itemId,
      lane: item.lane,
      expectedChannelId: config.expectedChannelId,
      file: item.file,
      sha256: actualHash,
      titleHash: sha256Buffer(clean(item.title)),
      privacyStatus,
      publishAt: clean(item.publishAt) || null,
      sizeBytes: mediaStat.size,
      rightsEvidenceSha256: rightsHash,
      qaEvidenceSha256: qaHash,
      apiCostUsd: 0,
      paidSpendAllowed: false,
    };
    await appendLedger(ledgerPath, { ...commonLedger, status: "upload_started", recordedAt: startedAt });

    let uploadResponse;
    try {
      uploadResponse = await fetcher(uploadUrl, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-length": String(mediaStat.size),
          "content-type": "video/mp4",
        },
        body: createReadStream(mediaPath),
        duplex: "half",
      });
    } catch {
      await appendLedger(ledgerPath, { ...commonLedger, status: "uncertain_outcome", recordedAt: new Date().toISOString(), reason: "upload_transport_outcome_unknown" });
      return { ...resultBase, status: "uncertain_outcome", blockers: ["manual_youtube_reconciliation_required"], itemId: item.itemId, lane: item.lane };
    }
    const uploadPayload = await responseJson(uploadResponse);
    if (!uploadResponse.ok || !YOUTUBE_VIDEO_ID.test(clean(uploadPayload?.id))) {
      await appendLedger(ledgerPath, { ...commonLedger, status: "uncertain_outcome", recordedAt: new Date().toISOString(), reason: "upload_response_outcome_unknown", httpStatus: uploadResponse.status });
      return { ...resultBase, status: "uncertain_outcome", blockers: ["manual_youtube_reconciliation_required"], itemId: item.itemId, lane: item.lane };
    }
    const uploadedAt = new Date().toISOString();
    const responsePrivacy = clean(uploadPayload?.status?.privacyStatus);
    const responsePublishAt = clean(uploadPayload?.status?.publishAt);
    const scheduledConfirmed = Boolean(clean(item.publishAt)) && responsePrivacy === "private"
      && Date.parse(responsePublishAt) === Date.parse(item.publishAt);
    const publicConfirmed = privacyStatus === "public" && responsePrivacy === "public";
    if (clean(item.publishAt) && !scheduledConfirmed) {
      await appendLedger(ledgerPath, { ...commonLedger, status: "uncertain_outcome", recordedAt: uploadedAt,
        youtubeVideoId: clean(uploadPayload.id), reason: "scheduled_status_not_confirmed_by_youtube" });
      return { ...resultBase, status: "uncertain_outcome", blockers: ["manual_youtube_reconciliation_required"],
        itemId: item.itemId, lane: item.lane, uploadAttempted: true, youtubeVideoId: null, youtubeUrl: null };
    }
    const finalStatus = scheduledConfirmed ? "scheduled" : "uploaded";
    await appendLedger(ledgerPath, { ...commonLedger, status: finalStatus, recordedAt: uploadedAt, youtubeVideoId: clean(uploadPayload.id) });
    return {
      ...resultBase,
      status: finalStatus,
      blockers: [],
      itemId: item.itemId,
      lane: item.lane,
      expectedChannelId: config.expectedChannelId,
      privacyStatus,
      publishAt: clean(item.publishAt) || null,
      scheduled: finalStatus === "scheduled",
      publicConfirmed,
      responsePrivacyStatus: responsePrivacy || null,
      youtubeVideoId: clean(uploadPayload.id),
      youtubeUrl: finalStatus === "uploaded" && publicConfirmed
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(clean(uploadPayload.id))}` : null,
      file: item.file,
      sha256: actualHash,
      uploadAttempted: true,
    };
  } finally {
    await lock?.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

function parseArgs(argv) {
  const parsed = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") parsed.workspaceRoot = argv[++index];
    else if (arg === "--item") parsed.itemFile = argv[++index];
    else if (arg === "--dry-run" || arg === "--preflight") parsed.dryRun = true;
  }
  return parsed;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runYouTubeUpload(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = ["uploaded", "preflight", "duplicate"].includes(result.status) ? 0 : 1;
    })
    .catch(() => {
      process.stdout.write(`${JSON.stringify({ status: "blocked", blockers: ["unexpected_uploader_failure"], apiCostUsd: 0 })}\n`);
      process.exitCode = 1;
    });
}
