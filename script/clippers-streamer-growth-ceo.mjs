import { lstat, readFile, realpath, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const captionStrategies = [
  { id: "direct_insight", captionStyle: "direct", subtitleStyle: "clean_sentence", hookStyle: "clear_claim" },
  { id: "curiosity_question", captionStyle: "question", subtitleStyle: "word_by_word", hookStyle: "open_loop" },
  { id: "context_first", captionStyle: "context", subtitleStyle: "clean_sentence", hookStyle: "why_it_matters" },
  { id: "hook_only", captionStyle: "minimal", subtitleStyle: "hook_only", hookStyle: "short_claim" },
];
const exactTikTokPostPattern = /^https:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]{2,40})\/video\/\d{8,30}\/?$/i;
const execFileAsync = promisify(execFile);
const decisionStateSchemaVersion = 1;
const maximumAuthorizedDailyClips = 5;
const maximumCampaignStatusAgeHours = 24;

function tiktokPostMatchesAccount(url, accountHandle) {
  const match = String(url || "").trim().match(exactTikTokPostPattern);
  const expected = String(accountHandle || "").trim().replace(/^@/, "").toLowerCase();
  return Boolean(match && expected && match[1].toLowerCase() === expected);
}

function normalizedTags(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^[@#][A-Za-z0-9._-]{2,80}$/.test(value))));
}

function publishedMetricKey(row) {
  const url = String(row?.publishedPostUrl || "").trim().toLowerCase();
  return url || "";
}

export function dedupePublishedMetrics(metrics = []) {
  const byPost = new Map();
  for (const row of metrics) {
    const key = publishedMetricKey(row);
    if (!key) continue;
    const current = byPost.get(key);
    if (!current || (finiteNumber(row.views) || 0) >= (finiteNumber(current.views) || 0)) byPost.set(key, row);
  }
  return [...byPost.values()];
}

export function buildHashtagPolicy(campaign, metrics = []) {
  const required = normalizedTags(campaign?.requiredHashtags);
  const optionalRows = new Map();
  for (const row of metrics) {
    for (const tag of normalizedTags(row.optionalHashtags)) {
      const current = optionalRows.get(tag) || { tag, samples: 0, views: [] };
      current.samples += 1;
      const views = finiteNumber(row.views);
      if (views !== null) current.views.push(views);
      optionalRows.set(tag, current);
    }
  }
  const optional = [...optionalRows.values()].map((row) => ({
    tag: row.tag,
    samples: row.samples,
    medianViews: median(row.views),
    recommendation: row.samples < 3 ? "keep_testing" : "compare_against_control",
  }));
  return {
    required: required.map((tag) => ({
      tag,
      locked: true,
      reason: tag.toLowerCase() === "#paidpartner"
        ? "campaign_disclosure_required"
        : "campaign_requirement",
    })),
    optional,
    rule: "Required campaign tags are immutable. The CEO may test or remove only optional tags after at least three published samples.",
  };
}

function draftAssignments(campaign, experiment, rows) {
  const draftCount = Math.floor(finiteNumber(campaign.draftsReady) || 0);
  const namedDrafts = Array.isArray(campaign.draftFiles)
    ? campaign.draftFiles.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const testedCounts = new Map(captionStrategies.map((strategy) => [
    strategy.id,
    rows.filter((row) => row.strategyId === strategy.id).length,
  ]));
  const ordered = [...captionStrategies].sort((a, b) => {
    if (experiment.winnerStrategyId) {
      if (a.id === experiment.winnerStrategyId) return -1;
      if (b.id === experiment.winnerStrategyId) return 1;
    }
    return testedCounts.get(a.id) - testedCounts.get(b.id) || a.id.localeCompare(b.id);
  });
  const requiredHashtags = normalizedTags(campaign.requiredHashtags);
  const winnerSlots = experiment.winnerStrategyId ? Math.round(draftCount * 0.7) : 0;
  const explorationOrder = experiment.winnerStrategyId
    ? ordered.filter((strategy) => strategy.id !== experiment.winnerStrategyId)
    : ordered;
  return Array.from({ length: draftCount }, (_, index) => {
    const strategy = experiment.winnerStrategyId && index < winnerSlots
      ? captionStrategies.find((row) => row.id === experiment.winnerStrategyId)
      : explorationOrder[(index - winnerSlots + explorationOrder.length) % explorationOrder.length];
    const requiresTranscript = strategy.subtitleStyle !== "hook_only";
    const topic = (namedDrafts[index] ? path.basename(namedDrafts[index], path.extname(namedDrafts[index])) : campaign.title)
      .replace(/^streamersclipusa-|^streamersclips-/i, "")
      .replace(/^[^-]+-[^-]+-\d+-/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const metadata = campaign.draftMetadata?.[path.basename(namedDrafts[index] || "")] || {};
    const assignmentRequiredHashtags = normalizedTags([
      ...requiredHashtags,
      ...(Array.isArray(metadata.requiredHashtags) ? metadata.requiredHashtags : []),
    ]);
    const generatedCaptionText = strategy.captionStyle === "question"
      ? `Would you have expected this from ${campaign.creator}: ${topic}?`
      : strategy.captionStyle === "context"
        ? `${campaign.creator} explains the context behind ${topic}.`
        : strategy.captionStyle === "minimal"
          ? `${campaign.creator}: ${topic}.`
          : `${topic}: the part worth watching.`;
    const metadataCaption = String(metadata.caption || "").trim();
    const captionTags = new Set((metadataCaption.match(/#[A-Za-z0-9._-]+/g) || [])
      .map((tag) => tag.toLowerCase()));
    const missingRequiredTags = assignmentRequiredHashtags
      .filter((tag) => !captionTags.has(tag.toLowerCase()));
    const captionText = metadataCaption
      ? `${metadataCaption} ${missingRequiredTags.join(" ")}`.trim()
      : `${generatedCaptionText} ${assignmentRequiredHashtags.join(" ")}`.trim();
    return {
      slot: index + 1,
      draftFile: namedDrafts[index] || null,
      strategyId: strategy.id,
      captionStyle: strategy.captionStyle,
      subtitleStyle: String(metadata.subtitleStyle || "").trim() || strategy.subtitleStyle,
      hookStyle: strategy.hookStyle,
      finalMediaFile: String(metadata.finalMediaFile || "").trim() || null,
      requiredHashtags: assignmentRequiredHashtags,
      captionText,
      mediaUrl: String(campaign.publicMediaUrls?.[namedDrafts[index]] || campaign.publicMediaUrls?.[path.basename(namedDrafts[index] || "")] || "").trim(),
      requiresTranscript: metadata.requiresTranscript === false ? false : requiresTranscript,
      preparationStatus: String(metadata.preparationStatus || "").trim()
        || (requiresTranscript ? "needs_local_transcript" : "ready_with_hook_only"),
      metricoolStatus: "approval_required",
      publishAllowed: false,
    };
  });
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function exactEvidence(value) {
  const text = String(value || "").trim();
  return text.length >= 12 && !/<[^>]+>|placeholder|paste here|example\.com/i.test(text);
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function htmlValue(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildMetricoolApprovalRows(decision, mediaReadyBySlot = {}, deliveryLedger = []) {
  const deliveredFiles = new Set((Array.isArray(deliveryLedger) ? deliveryLedger : [])
    .filter((row) => ["scheduled", "published", "verification_pending"].includes(String(row?.status || "").toLowerCase()))
    .map((row) => String(row?.draftFile || "").trim())
    .filter(Boolean));
  return (decision.assignments || []).map((assignment) => {
    const media = mediaReadyBySlot[assignment.slot] || {};
    const publishingAuthorized = decision.publishingAuthorized === true;
    const alreadyDelivered = deliveredFiles.has(String(media.relativePath || assignment.draftFile || "").trim())
      || deliveredFiles.has(String(assignment.draftFile || "").trim());
    const status = alreadyDelivered
      ? "already_scheduled_or_published"
      : decision.canProduce !== true
      ? "blocked_campaign"
      : media.ready !== true
        ? "blocked_media_missing"
        : decision.canEnterApprovalQueue !== true
          ? "blocked_payout_setup"
          : publishingAuthorized
            ? "authorized_for_metricool"
            : "approval_required";
    return {
      order: assignment.slot,
      account: decision.accountHandle,
      platform: "tiktok",
      campaignId: decision.campaignId,
      campaignExpiresAt: decision.campaignExpiresAt,
      draftFile: media.relativePath || assignment.draftFile,
      strategyId: assignment.strategyId,
      subtitleStyle: assignment.subtitleStyle,
      hookStyle: assignment.hookStyle,
      caption: assignment.captionText,
      requiredHashtags: assignment.requiredHashtags,
      mediaUrl: assignment.mediaUrl,
      status,
      publishAllowed: status === "authorized_for_metricool",
    };
  });
}

function metricoolRowsCsv(rows) {
  const columns = ["order", "account", "platform", "campaignId", "draftFile", "strategyId", "caption", "status", "publishAllowed"];
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")).join("\n")}\n`;
}

function metricoolRowsHtml(decision, rows) {
  const authorizedRows = rows.filter((row) => row.status === "authorized_for_metricool");
  const approvalLabel = authorizedRows.length ? "Authorized" : "Blocked";
  const notice = authorizedRows.length
    ? "Eligible clips may be scheduled through Metricool. Scheduled items are not counted as published until a public TikTok URL is verified."
    : "No clip is published or scheduled. Review and explicit approval are still required.";
  const clips = rows.map((row) => `
    <article class="clip-row">
      <video controls preload="metadata" src="/clippers-workspace/${htmlValue(row.draftFile)}"></video>
      <div class="clip-copy">
        <div class="meta"><span>#${htmlValue(row.order)}</span><span>${htmlValue(row.strategyId)}</span><span>${htmlValue(row.status)}</span></div>
        <h2>${htmlValue(row.caption)}</h2>
        <p>${htmlValue(row.draftFile)}</p>
      </div>
    </article>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Metricool Review Queue</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f7f5;color:#171717;font-family:Inter,Arial,sans-serif;letter-spacing:0}header{background:#171717;color:#fff;padding:28px max(20px,calc((100vw - 1120px)/2))}header h1{font-size:28px;margin:0 0 8px}header p{margin:0;color:#cfcfc9}.summary{display:flex;gap:20px;flex-wrap:wrap;padding:18px max(20px,calc((100vw - 1120px)/2));border-bottom:1px solid #d9d9d4;background:#fff}.summary strong{display:block;font-size:20px}.summary span{font-size:12px;color:#666}.notice{padding:14px max(20px,calc((100vw - 1120px)/2));background:#fff3cd;color:#5d4600;border-bottom:1px solid #ead58d}main{max-width:1120px;margin:auto}.clip-row{display:grid;grid-template-columns:180px 1fr;gap:24px;padding:24px 20px;border-bottom:1px solid #d9d9d4}.clip-row video{width:180px;aspect-ratio:9/16;background:#000}.clip-copy{align-self:center;min-width:0}.meta{display:flex;gap:8px;flex-wrap:wrap}.meta span{font-size:12px;border:1px solid #bbb;padding:4px 7px;border-radius:4px}.clip-copy h2{font-size:18px;line-height:1.35;margin:14px 0 8px}.clip-copy p{font-size:12px;color:#666;overflow-wrap:anywhere;margin:0}@media(max-width:620px){.clip-row{grid-template-columns:110px 1fr;gap:14px}.clip-row video{width:110px}.clip-copy h2{font-size:15px}}
</style></head><body><header><h1>Metricool Review Queue</h1><p>${htmlValue(decision.title)} · @${htmlValue(decision.accountHandle)}</p></header>
<section class="summary"><div><strong>${rows.length}</strong><span>real clips</span></div><div><strong>${approvalLabel}</strong><span>Metricool mode</span></div><div><strong>${decision.cashoutReady ? "Ready" : "Pending"}</strong><span>Vyro cashout</span></div></section>
<div class="notice">${notice}</div><main>${clips}</main></body></html>`;
}

function campaignExpiryMs(campaign) {
  const exact = Date.parse(String(campaign.expiresAt || ""));
  if (Number.isFinite(exact)) return exact;
  const observedAt = Date.parse(String(campaign.remainingTimeObservedAt || ""));
  const hoursRemaining = finiteNumber(campaign.hoursRemainingObserved);
  return Number.isFinite(observedAt) && hoursRemaining !== null ? observedAt + hoursRemaining * 3_600_000 : NaN;
}

function campaignStatusObservedMs(campaign) {
  const candidates = [
    campaign.statusObservedAt,
    campaign.remainingTimeObservedAt,
    campaign.evidenceVerifiedAt,
  ];
  for (const candidate of candidates) {
    const parsed = Date.parse(String(candidate || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function campaignStatusFreshness(campaign, now) {
  const observedAtMs = campaignStatusObservedMs(campaign);
  const ageHours = Number.isFinite(observedAtMs)
    ? Math.max(0, Math.round(((now.getTime() - observedAtMs) / 3_600_000) * 10) / 10)
    : null;
  return {
    observedAt: Number.isFinite(observedAtMs) ? new Date(observedAtMs).toISOString() : null,
    ageHours,
    maximumAgeHours: maximumCampaignStatusAgeHours,
    status: ageHours === null
      ? "unknown"
      : ageHours > maximumCampaignStatusAgeHours
        ? "stale"
        : "fresh",
  };
}

function campaignBlockers(campaign, now) {
  const expiresAt = campaignExpiryMs(campaign);
  const freshness = campaignStatusFreshness(campaign, now);
  return [
    campaign.active !== true ? "campaign_not_active" : null,
    campaign.joined !== true ? "campaign_not_joined" : null,
    !Number.isFinite(expiresAt) ? "campaign_expiry_unknown" : null,
    Number.isFinite(expiresAt) && expiresAt <= now.getTime() ? "campaign_expired" : null,
    freshness.status === "stale" ? "campaign_status_stale" : null,
    !exactEvidence(campaign.rightsEvidencePath) || campaign.evidenceVerified !== true ? "campaign_rights_evidence_missing" : null,
    !exactEvidence(campaign.sourceUrl) ? "authorized_source_missing" : null,
    !exactEvidence(campaign.creatorReachEvidence) ? "creator_reach_evidence_missing" : null,
    finiteNumber(campaign.payoutCpm) === null || Number(campaign.payoutCpm) <= 0 ? "payout_cpm_missing" : null,
    finiteNumber(campaign.minViewsPerPost) === null ? "minimum_views_missing" : null,
    !String(campaign.accountHandle || "").trim() ? "destination_account_missing" : null,
    finiteNumber(campaign.sourceFilesReady) === null || Number(campaign.sourceFilesReady) < 1 ? "source_files_missing" : null,
    finiteNumber(campaign.draftsReady) === null || Number(campaign.draftsReady) < 1 ? "drafts_missing" : null,
  ].filter(Boolean);
}

function campaignWarnings(campaign, now) {
  const freshness = campaignStatusFreshness(campaign, now);
  return [
    freshness.status === "unknown" ? "campaign_status_freshness_unknown" : null,
  ].filter(Boolean);
}

function blockerDomain(code) {
  if (code.startsWith("campaign_") || code === "authorized_source_missing" || code === "creator_reach_evidence_missing") return "campaign";
  if (code.startsWith("payout_")) return "payment";
  if (code.includes("media") || code === "drafts_missing" || code === "source_files_missing") return "media";
  if (code.includes("authorization")) return "authorization";
  if (code.includes("metricool") || code.includes("delivery")) return "delivery";
  return "policy";
}

function typedBlocker(code, blockingCapability) {
  return {
    code,
    domain: blockerDomain(code),
    severity: "blocking",
    blocks: blockingCapability,
  };
}

function typedWarning(code) {
  return {
    code,
    domain: blockerDomain(code),
    severity: "warning",
    blocks: "refresh_campaign_status",
  };
}

function decisionOperationalState({
  productionBlockers,
  warnings = [],
  paymentBlockers,
  publishingAuthorized,
  mediaStatus = "unchecked",
  validatedMediaCount = 0,
  deliverableCount = 0,
}) {
  const canProduce = productionBlockers.length === 0;
  const canDeliver = canProduce && publishingAuthorized && deliverableCount > 0;
  const blockers = [
    ...productionBlockers.map((code) => typedBlocker(code, "produce")),
    ...paymentBlockers.map((code) => typedBlocker(code, "cashout")),
    ...(!publishingAuthorized ? [typedBlocker("publishing_not_authorized", "deliver")] : []),
    ...(canProduce && mediaStatus === "checked" && validatedMediaCount === 0
      ? [typedBlocker("validated_media_missing", "deliver")]
      : []),
    ...(canProduce && publishingAuthorized && mediaStatus === "checked" && validatedMediaCount > 0 && deliverableCount === 0
      ? [typedBlocker("metricool_delivery_input_missing", "deliver")]
      : []),
    ...warnings.map(typedWarning),
  ];
  const phase = !canProduce
    ? "blocked_campaign"
    : mediaStatus !== "checked"
      ? "ready_for_media_validation"
      : validatedMediaCount === 0
        ? "blocked_media"
        : !publishingAuthorized
          ? "awaiting_publish_authorization"
          : deliverableCount === 0
            ? "blocked_delivery"
            : "ready_for_delivery";
  const nextStep = blockers.find((row) => row.blocks === "produce")?.code
    || (mediaStatus !== "checked" ? "validate_final_media" : null)
    || (validatedMediaCount === 0 ? "render_or_repair_final_media" : null)
    || (!publishingAuthorized ? "obtain_publish_authorization" : null)
    || (deliverableCount === 0 ? "attach_public_media_and_verify_metricool_account" : "deliver_next_eligible_clip");
  return {
    schemaVersion: decisionStateSchemaVersion,
    phase,
    activity: "idle",
    canClaimWorking: false,
    capabilities: {
      canAnalyze: true,
      canProduce,
      canValidateMedia: canProduce,
      canDeliver,
      canCashout: paymentBlockers.length === 0,
    },
    authorization: {
      status: publishingAuthorized ? "authorized" : "not_authorized",
      dailyClipLimit: maximumAuthorizedDailyClips,
      paidSpendLimitUsd: 0,
    },
    media: {
      status: mediaStatus,
      validatedCount: validatedMediaCount,
      deliverableCount,
    },
    blockers,
    nextStep: { code: nextStep },
    truth: canDeliver
      ? "Ready for the worker to deliver; no delivery has started yet."
      : canProduce
        ? "Planning is complete, but delivery cannot start until the listed gates pass."
        : "The CEO is blocked and cannot produce or deliver this campaign.",
  };
}

export function refreshDecisionOperationalState(decision, {
  rows = [],
  deliverableCount = 0,
} = {}) {
  const validatedMediaCount = rows.filter((row) => !["blocked_media_missing", "blocked_campaign"].includes(row.status)).length;
  decision.operationalState = decisionOperationalState({
    productionBlockers: decision.productionBlockers || [],
    warnings: decision.warnings || [],
    paymentBlockers: decision.cashoutBlockers || [],
    publishingAuthorized: decision.publishingAuthorized === true,
    mediaStatus: "checked",
    validatedMediaCount,
    deliverableCount,
  });
  return decision.operationalState;
}

function payoutBlockers(campaign) {
  return [
    campaign.payoutIdentityReady !== true ? "payout_identity_not_verified" : null,
    campaign.payoutMethodReady !== true ? "payout_method_not_connected" : null,
  ].filter(Boolean);
}

function metricRowsForCampaign(metrics, campaignId, campaign) {
  return dedupePublishedMetrics(metrics).filter((row) => row.campaignId === campaignId
    && row.finalStatus === "published"
    && tiktokPostMatchesAccount(row.publishedPostUrl, campaign?.accountHandle)
    && row.metricEvidenceVerified === true
    && finiteNumber(row.views) !== null);
}

function strategyPerformance(rows, strategyId) {
  const strategyRows = rows.filter((row) => row.strategyId === strategyId);
  const views = strategyRows.map((row) => Number(row.views));
  const qualifying = strategyRows.filter((row) => row.qualifiedForPayout === true && row.qualificationEvidenceVerified === true).length;
  return {
    strategyId,
    samples: strategyRows.length,
    medianViews: median(views),
    totalViews: views.reduce((sum, value) => sum + value, 0),
    qualifyingPosts: qualifying,
    totalEarningsUsd: strategyRows.reduce((sum, row) => sum + (row.payoutEvidenceVerified === true ? (finiteNumber(row.earningsUsd) || 0) : 0), 0),
    medianCompletionRate: median(strategyRows.map((row) => finiteNumber(row.completionRate)).filter((value) => value !== null)),
    medianShareRate: median(strategyRows.map((row) => finiteNumber(row.shareRate)).filter((value) => value !== null)),
  };
}

function chooseExperiment(rows) {
  const performance = captionStrategies.map((strategy) => strategyPerformance(rows, strategy.id));
  const proven = performance
    .filter((row) => row.samples >= 3 && row.medianViews !== null)
    .sort((a, b) => (b.medianViews - a.medianViews) || (b.totalEarningsUsd - a.totalEarningsUsd));
  const leastTested = [...performance].sort((a, b) => a.samples - b.samples || a.strategyId.localeCompare(b.strategyId))[0];
  const winner = proven[0] || null;
  const nextStrategyId = winner && rows.length >= 8 && rows.length % 10 < 7 ? winner.strategyId : leastTested.strategyId;
  return {
    status: winner ? "winner_with_exploration" : "learning",
    winnerStrategyId: winner?.strategyId || null,
    nextStrategyId,
    allocation: winner ? { winnerPercent: 70, explorationPercent: 30 } : { balancedTestPercent: 25 },
    performance,
    minimumSamplesPerStrategy: 3,
  };
}

function campaignDecision(campaign, metrics, now, publishingAuthorized = false) {
  const productionBlockers = campaignBlockers(campaign, now);
  const warnings = campaignWarnings(campaign, now);
  const paymentBlockers = payoutBlockers(campaign);
  const freshness = campaignStatusFreshness(campaign, now);
  const rows = metricRowsForCampaign(metrics, campaign.id, campaign);
  const medianViews = median(rows.map((row) => Number(row.views)));
  const totalViews = rows.reduce((sum, row) => sum + Number(row.views), 0);
  const totalEarningsUsd = rows.reduce((sum, row) => sum + (row.payoutEvidenceVerified === true ? (finiteNumber(row.earningsUsd) || 0) : 0), 0);
  const qualifyingPosts = rows.filter((row) => row.qualifiedForPayout === true && row.qualificationEvidenceVerified === true).length;
  const minViews = Number(campaign.minViewsPerPost || 0);
  const experiment = chooseExperiment(rows);
  const assignments = draftAssignments(campaign, experiment, rows);
  const hashtagPolicy = buildHashtagPolicy(campaign, rows);
  let decision = "blocked";
  if (!productionBlockers.length) {
    if (rows.length < 3) decision = "test";
    else if (medianViews >= minViews && qualifyingPosts / rows.length >= 0.5) decision = "scale";
    else if (rows.length >= 6 && qualifyingPosts === 0) decision = "pause_and_recut";
    else decision = "optimize";
  }
  const expiryMs = campaignExpiryMs(campaign);
  const hoursRemaining = Number.isFinite(expiryMs)
    ? Math.max(0, Math.round((expiryMs - now.getTime()) / 3_600_000))
    : null;
  const payoutCpm = finiteNumber(campaign.payoutCpm);
  const observedRevenuePerThousand = totalViews > 0 ? Math.round((totalEarningsUsd / totalViews) * 1000 * 100) / 100 : null;
  const priorityScore = productionBlockers.length ? 0 : Math.round(
    (payoutCpm || 0) * 20
    + Math.min(30, (hoursRemaining || 0) / 24)
    + Math.min(25, Number(campaign.draftsReady || 0) * 3)
    + (campaign.creatorTier === "top" ? 20 : campaign.creatorTier === "major" ? 12 : 4)
    + (medianViews !== null && minViews > 0 ? Math.min(30, (medianViews / minViews) * 15) : 0)
  );
  return {
    campaignId: campaign.id,
    campaignExpiresAt: Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : null,
    campaignStatusFreshness: freshness,
    title: campaign.title,
    creator: campaign.creator,
    creatorTier: campaign.creatorTier || "unknown",
    marketplace: campaign.marketplace,
    accountHandle: campaign.accountHandle,
    decision,
    priorityScore,
    productionBlockers,
    warnings,
    publishBlockers: productionBlockers,
    cashoutBlockers: paymentBlockers,
    canProduce: productionBlockers.length === 0,
    canEnterApprovalQueue: productionBlockers.length === 0,
    cashoutReady: paymentBlockers.length === 0,
    publishingAuthorized,
    realPublishEnabled: false,
    metricoolApprovalRequired: true,
    payoutCpm,
    minViewsPerPost: minViews,
    maxPayoutPerPost: finiteNumber(campaign.maxPayoutPerPost),
    hoursRemaining,
    observed: {
      publishedPosts: rows.length,
      totalViews,
      medianViews,
      qualifyingPosts,
      totalEarningsUsd: Math.round(totalEarningsUsd * 100) / 100,
      observedRevenuePerThousand,
    },
    experiment,
    hashtagPolicy,
    assignments,
    operationalState: decisionOperationalState({
      productionBlockers,
      warnings,
      paymentBlockers,
      publishingAuthorized,
    }),
    nextAction: productionBlockers.length
      ? `Resolve ${productionBlockers[0]}.`
      : decision === "scale"
          ? `Allocate 70% to ${experiment.winnerStrategyId || experiment.nextStrategyId} and 30% to controlled exploration.`
          : decision === "pause_and_recut"
            ? "Pause this cut style and create materially different hooks before another paid test."
            : paymentBlockers.length
              ? publishingAuthorized
                ? `Validate final media for the next ${experiment.nextStrategyId} test before Metricool scheduling; resolve ${paymentBlockers[0]} before cashout.`
                : `Queue the next ${experiment.nextStrategyId} test for approval; resolve ${paymentBlockers[0]} before cashout.`
              : `Run the next controlled test with ${experiment.nextStrategyId}.`,
  };
}

export function buildStreamerGrowthCeoPlan({
  campaigns = [],
  metrics = [],
  now = new Date(),
  monthlyViewsTarget = 1_000_000,
  publishingAuthorized = false,
  targetDailyClips = 5,
}) {
  const parsedTargetDailyClips = Number(targetDailyClips);
  const safeConfiguredDailyClips = Number.isFinite(parsedTargetDailyClips) && parsedTargetDailyClips > 0
    ? Math.max(1, Math.min(maximumAuthorizedDailyClips, Math.trunc(parsedTargetDailyClips)))
    : 5;
  const decisions = campaigns.map((campaign) => campaignDecision(campaign, metrics, now, publishingAuthorized))
    .sort((a, b) => b.priorityScore - a.priorityScore || a.title.localeCompare(b.title));
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const actualPublishedRows = dedupePublishedMetrics(metrics).filter((row) => {
    const campaign = campaignById.get(row.campaignId);
    return row.finalStatus === "published"
      && tiktokPostMatchesAccount(row.publishedPostUrl, campaign?.accountHandle)
      && row.metricEvidenceVerified === true
      && finiteNumber(row.views) !== null;
  });
  const measuredViews = actualPublishedRows.reduce((sum, row) => sum + Number(row.views), 0);
  const measuredEarningsUsd = actualPublishedRows.reduce((sum, row) => sum + (row.payoutEvidenceVerified === true ? (finiteNumber(row.earningsUsd) || 0) : 0), 0);
  const active = decisions.filter((row) => row.canProduce);
  const scaling = decisions.filter((row) => row.decision === "scale");
  const recutting = decisions.some((row) => row.decision === "pause_and_recut");
  const optimizing = decisions.some((row) => row.decision === "optimize");
  const dailyTestClips = !active.length
    ? 0
    : actualPublishedRows.length < 15
      ? safeConfiguredDailyClips
      : recutting
        ? Math.min(2, safeConfiguredDailyClips)
        : scaling.length
          ? safeConfiguredDailyClips
          : optimizing
            ? Math.min(4, safeConfiguredDailyClips)
            : safeConfiguredDailyClips;
  const volumeReason = !active.length
    ? "no_active_campaign"
    : actualPublishedRows.length < 15
      ? "initial_learning_floor"
      : recutting
        ? "reduce_while_recutting"
        : scaling.length
          ? "increase_verified_winners"
          : optimizing
            ? "reduce_for_efficiency"
            : "hold_baseline";
  const next = decisions[0] || null;
  return {
    status: !campaigns.length ? "needs_campaign_catalog" : !active.length ? "blocked" : scaling.length ? "scaling" : "testing",
    generatedAt: now.toISOString(),
    goal: {
      monthlyViewsTarget,
      measuredViews,
      measuredEarningsUsd: Math.round(measuredEarningsUsd * 100) / 100,
      progressPercent: Math.min(100, Math.round((measuredViews / monthlyViewsTarget) * 10000) / 100),
      requiredDailyViews: Math.ceil(monthlyViewsTarget / 30),
      projection: actualPublishedRows.length >= 7 ? "eligible_for_projection_after_date_window_check" : "insufficient_real_posts",
    },
    portfolio: {
      campaigns: campaigns.length,
      activeProduction: active.length,
      approvalQueueEligible: decisions.filter((row) => row.canEnterApprovalQueue).length,
      scaling: scaling.length,
      blocked: decisions.filter((row) => !row.canProduce).length,
    },
    operatingPolicy: {
      dailyTestClips,
      initialDailyClips: 5,
      minimumInitialDailyClips: Math.min(5, safeConfiguredDailyClips),
      configuredDailyCeiling: safeConfiguredDailyClips,
      maximumDailyClipsPerAccount: maximumAuthorizedDailyClips,
      volumeReason,
      exploitPercent: scaling.length ? 70 : 0,
      explorePercent: scaling.length ? 30 : 100,
      minimumSamplesBeforeWinner: 3,
      paidSpendAllowed: false,
      publishingAuthorized,
      metricoolApprovalRequired: true,
      realPublishEnabled: false,
    },
    executionState: {
      schemaVersion: decisionStateSchemaVersion,
      activity: "idle",
      canClaimWorking: false,
      phase: !campaigns.length ? "needs_campaign_catalog" : !active.length ? "blocked" : "ready_for_production",
      objective: {
        targetDailyClips: dailyTestClips,
        maximumDailyClips: maximumAuthorizedDailyClips,
        paidSpendLimitUsd: 0,
      },
      authorization: {
        status: publishingAuthorized ? "authorized" : "not_authorized",
        canPublish: publishingAuthorized,
      },
      capabilities: {
        canAnalyze: true,
        canProduceNow: active.length > 0,
        canDeliverNow: false,
      },
      blockerCodes: Array.from(new Set(decisions.flatMap((row) => row.operationalState.blockers.map((blocker) => blocker.code)))),
      truth: active.length
        ? "The CEO has a production plan, but no delivery is executing."
        : "The CEO is blocked and is not producing or publishing.",
    },
    decisions,
    nextBestAction: next?.nextAction || "Add a verified paid campaign with evidence; do not fabricate campaign availability.",
    guardrails: [
      "Campaign authorization is required; creator fame never replaces commercial rights.",
      "Only proof-backed finalStatus=published Metricool rows count as views; earnings require separate payout evidence.",
      "No caption or subtitle winner is declared before three real posts per strategy.",
      "Required campaign hashtags and disclosures are immutable; only optional hashtags may be tested.",
      "Payout identity and payment method affect cashout readiness, not campaign-source or Metricool approval readiness.",
      publishingAuthorized
        ? "Metricool publishing is authorized only for proof-backed eligible clips on the configured TikTok account."
        : "The CEO may prepare and rank work, but real publishing remains disabled.",
    ],
  };
}

async function containedRegularFile(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, String(candidate || "").replace(/^\/clippers-workspace\//, ""));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [rootReal, fileReal, fileStats] = await Promise.all([
    realpath(resolvedRoot).catch(() => null),
    realpath(resolved).catch(() => null),
    lstat(resolved).catch(() => null),
  ]);
  if (!rootReal || !fileReal || !fileStats?.isFile() || fileStats.isSymbolicLink()) return null;
  const realRelative = path.relative(rootReal, fileReal);
  return realRelative && !realRelative.startsWith("..") && !path.isAbsolute(realRelative) ? resolved : null;
}

export function resolveWorkspaceMediaPath(workspaceRoot, candidate) {
  return path.resolve(workspaceRoot, String(candidate || "").replace(/^\/clippers-workspace\//, ""));
}

export async function validateMetricoolMp4(workspaceRoot, candidate) {
  const resolved = await containedRegularFile(workspaceRoot, resolveWorkspaceMediaPath(workspaceRoot, candidate));
  if (!resolved || path.extname(resolved).toLowerCase() !== ".mp4") return null;
  const fileStats = await lstat(resolved).catch(() => null);
  if (!fileStats || fileStats.size < 1024) return null;
  const probe = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height",
    "-of", "json", resolved,
  ], { timeout: 30_000, maxBuffer: 1_000_000 }).catch(() => null);
  if (!probe) return null;
  const stream = JSON.parse(probe.stdout || "{}").streams?.[0];
  return stream?.codec_name && Number(stream.width) > 0 && Number(stream.height) > 0 ? resolved : null;
}

export function resolveAssignmentFinalMediaPath(workspaceRoot, assignment) {
  if (assignment?.finalMediaFile) {
    return resolveWorkspaceMediaPath(workspaceRoot, assignment.finalMediaFile);
  }
  const original = resolveWorkspaceMediaPath(workspaceRoot, assignment?.draftFile);
  if (assignment?.subtitleStyle === "hook_only" || assignment?.requiresTranscript === false) return original;
  const extension = path.extname(original);
  return path.join(
    path.dirname(original),
    "subtitled",
    `${path.basename(original, extension)}-${assignment?.subtitleStyle}.mp4`,
  );
}

export async function verifyTextEvidence(workspaceRoot, evidencePath, requiredValues) {
  const resolved = await containedRegularFile(workspaceRoot, evidencePath);
  if (!resolved) return false;
  const text = await readFile(resolved, "utf8").catch(() => "");
  return text.length >= 80
    && !/<[^>]+>|placeholder|paste here/i.test(text)
    && requiredValues.every((value) => text.toLowerCase().includes(String(value || "").toLowerCase()));
}

async function main() {
  const workspaceRoot = path.resolve(process.env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const inputDir = path.join(workspaceRoot, "research");
  const reportDir = path.join(workspaceRoot, "reports");
  const campaignsPath = path.join(inputDir, "paid-streamer-campaigns.json");
  const metricsPath = path.join(inputDir, "paid-streamer-campaign-metrics.json");
  const deliveryLedgerPath = path.join(reportDir, "metricool-autopilot-ledger.json");
  const deliveryQueuePath = path.join(reportDir, "metricool-autopilot-queue.json");
  const campaigns = JSON.parse(await readFile(campaignsPath, "utf8").catch(() => "[]"));
  const metrics = JSON.parse(await readFile(metricsPath, "utf8").catch(() => "[]"));
  const deliveryLedger = JSON.parse(await readFile(deliveryLedgerPath, "utf8").catch(() => "[]"));
  for (const campaign of campaigns) {
    campaign.evidenceVerified = await verifyTextEvidence(workspaceRoot, campaign.rightsEvidencePath, [
      campaign.id,
      campaign.marketplace,
      campaign.sourceUrl,
    ]);
  }
  for (const row of metrics) {
    const campaign = campaigns.find((candidate) => candidate.id === row.campaignId);
    const exactPost = tiktokPostMatchesAccount(row.publishedPostUrl, campaign?.accountHandle);
    row.metricEvidenceVerified = exactPost && await verifyTextEvidence(workspaceRoot, row.metricoolProofPath, [
      "Metricool",
      row.publishedPostUrl,
      String(row.views),
    ]);
    row.payoutEvidenceVerified = exactPost && await verifyTextEvidence(workspaceRoot, row.payoutProofPath, [
      row.campaignId,
      row.publishedPostUrl,
      String(row.earningsUsd),
    ]);
    row.qualificationEvidenceVerified = row.payoutEvidenceVerified;
  }
  const publishingAuthorized = process.env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED === "true";
  const targetDailyClips = process.env.CLIPPERS_TARGET_DAILY_CLIPS || 5;
  const expectedMetricoolBlogId = finiteNumber(process.env.CLIPPERS_METRICOOL_BLOG_ID);
  const plan = buildStreamerGrowthCeoPlan({ campaigns, metrics, publishingAuthorized, targetDailyClips });
  await mkdir(reportDir, { recursive: true });
  const autopilotQueueItems = [];
  for (const decision of plan.decisions) {
    const mediaReadyBySlot = {};
    for (const assignment of decision.assignments || []) {
      const finalMedia = resolveAssignmentFinalMediaPath(workspaceRoot, assignment);
      const validatedMedia = await validateMetricoolMp4(workspaceRoot, finalMedia);
      mediaReadyBySlot[assignment.slot] = {
        ready: Boolean(validatedMedia),
        relativePath: validatedMedia ? path.relative(workspaceRoot, validatedMedia) : "",
      };
    }
    const rows = buildMetricoolApprovalRows(decision, mediaReadyBySlot, deliveryLedger);
    const campaign = campaigns.find((row) => row.id === decision.campaignId);
    const campaignMetricoolBlogId = finiteNumber(campaign?.metricoolBlogId) ?? expectedMetricoolBlogId;
    const readyForAutopilot = rows
      .filter((row) => row.publishAllowed
        && /^https:\/\//i.test(row.mediaUrl)
        && expectedMetricoolBlogId !== null
        && campaignMetricoolBlogId === expectedMetricoolBlogId)
      .map((row) => ({
        ...row,
        blogId: campaignMetricoolBlogId,
        account: String(row.account || "").replace(/^@/, ""),
        status: "ready_for_metricool_autopilot",
      }));
    autopilotQueueItems.push(...readyForAutopilot);
    decision.realPublishEnabled = readyForAutopilot.length > 0;
    decision.metricoolAutopilotReady = readyForAutopilot.length > 0;
    decision.metricoolApprovalRequired = !decision.realPublishEnabled;
    refreshDecisionOperationalState(decision, {
      rows,
      deliverableCount: readyForAutopilot.length,
    });
    if (decision.publishingAuthorized && decision.canProduce) {
      decision.nextAction = decision.realPublishEnabled
        ? `Deliver the next eligible ${decision.experiment.nextStrategyId} test through the verified Metricool autopilot${decision.cashoutBlockers.length ? `; resolve ${decision.cashoutBlockers[0]} before cashout` : ""}.`
        : rows.some((row) => row.status === "authorized_for_metricool")
          ? "Attach a public HTTPS media URL for the validated clip before Metricool automation can run."
          : `Render and validate final media for the next ${decision.experiment.nextStrategyId} test before scheduling.`;
    }
    const firstDraft = decision.assignments?.[0]?.draftFile;
    if (firstDraft && rows.length) {
      const firstOriginal = await containedRegularFile(workspaceRoot, resolveWorkspaceMediaPath(workspaceRoot, firstDraft));
      const queueDir = firstOriginal ? path.dirname(firstOriginal) : "";
      const rootRelative = queueDir ? path.relative(workspaceRoot, queueDir) : "";
      if (rootRelative && !rootRelative.startsWith("..") && !path.isAbsolute(rootRelative)) {
        await writeFile(path.join(queueDir, "metricool-approval-queue.csv"), metricoolRowsCsv(rows));
        await writeFile(path.join(queueDir, "metricool-approval-queue.html"), metricoolRowsHtml(decision, rows));
      }
    }
  }
  plan.operatingPolicy.realPublishEnabled = plan.decisions.some((decision) => decision.realPublishEnabled);
  plan.operatingPolicy.metricoolApprovalRequired = !plan.operatingPolicy.realPublishEnabled;
  const deliverableItems = plan.decisions.reduce((sum, decision) => sum + decision.operationalState.media.deliverableCount, 0);
  const validatedItems = plan.decisions.reduce((sum, decision) => sum + decision.operationalState.media.validatedCount, 0);
  plan.executionState = {
    ...plan.executionState,
    phase: deliverableItems > 0
      ? "ready_for_delivery"
      : validatedItems > 0
        ? "blocked_delivery"
        : plan.portfolio.activeProduction > 0
          ? "blocked_media"
          : "blocked",
    capabilities: {
      ...plan.executionState.capabilities,
      canDeliverNow: deliverableItems > 0,
    },
    media: { validatedItems, deliverableItems },
    blockerCodes: Array.from(new Set(plan.decisions.flatMap((row) => row.operationalState.blockers.map((blocker) => blocker.code)))),
    truth: deliverableItems > 0
      ? `${deliverableItems} item(s) are ready for the worker; no delivery has started yet.`
      : "No item can be delivered now; the CEO is not working on a publish action.",
  };
  plan.nextBestAction = plan.decisions[0]?.nextAction || plan.nextBestAction;
  await writeFile(deliveryQueuePath, `${JSON.stringify({
    schemaVersion: decisionStateSchemaVersion,
    generatedAt: new Date().toISOString(),
    paidSpendAllowed: false,
    targetDailyClips: plan.operatingPolicy.dailyTestClips,
    authorization: plan.executionState.authorization,
    executionState: plan.executionState,
    items: autopilotQueueItems,
  }, null, 2)}\n`, { mode: 0o600 });
  await writeFile(path.join(reportDir, "streamer-growth-ceo.json"), `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
