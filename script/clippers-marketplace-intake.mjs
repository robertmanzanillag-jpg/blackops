import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_SNAPSHOT_AGE_HOURS = 48;
const SUPPORTED_MARKETPLACES = new Map([
  ["content rewards", "content_rewards"],
  ["content-rewards", "content_rewards"],
  ["content_rewards", "content_rewards"],
  ["contentrewards", "content_rewards"],
  ["whop", "whop"],
  ["vyro", "vyro"],
  ["clipping", "clipping"],
  ["clipping.net", "clipping"],
]);
const PLACEHOLDER_PATTERN = /<[^>]+>|placeholder|paste here|example\.com|todo\b|tbd\b/i;
const RIGHTS_LANGUAGE_PATTERN = /authori[sz](?:ation|ed)|commercial rights?|licensed?|permission|transform(?:ation)? and publish|publish(?:ing)? rights?|campaign brief/i;

function text(value) {
  return String(value ?? "").trim();
}

function finiteNonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizedMarketplace(value) {
  return SUPPORTED_MARKETPLACES.get(text(value).toLowerCase()) || null;
}

function normalizedHandle(value) {
  return text(value).replace(/^@/, "").toLowerCase();
}

function normalizedStringList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value))
    .filter(Boolean))];
}

function isoDate(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function snapshotCampaigns(snapshot) {
  if (Array.isArray(snapshot)) return snapshot;
  return Array.isArray(snapshot?.campaigns) ? snapshot.campaigns : [];
}

async function containedRegularFile(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, text(candidate).replace(/^\/clippers-workspace\//, ""));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [rootReal, fileReal, stats] = await Promise.all([
    realpath(resolvedRoot).catch(() => null),
    realpath(resolved).catch(() => null),
    lstat(resolved).catch(() => null),
  ]);
  if (!rootReal || !fileReal || !stats?.isFile() || stats.isSymbolicLink()) return null;
  const realRelative = path.relative(rootReal, fileReal);
  return realRelative && !realRelative.startsWith("..") && !path.isAbsolute(realRelative) ? resolved : null;
}

async function verifyRightsEvidence(workspaceRoot, campaign, marketplace) {
  const evidencePath = text(campaign.rightsEvidencePath || campaign.rights?.evidencePath);
  if (campaign.evidenceVerified !== true && campaign.rightsVerified !== true && campaign.rights?.verified !== true) {
    return { verified: false, reason: "rights_evidence_not_attested" };
  }
  const resolved = await containedRegularFile(workspaceRoot, evidencePath);
  if (!resolved) return { verified: false, reason: "rights_evidence_file_missing_or_unsafe" };
  const evidence = await readFile(resolved, "utf8").catch(() => "");
  const required = [text(campaign.id), marketplace, text(campaign.sourceUrl)].filter(Boolean);
  const lowered = evidence.toLowerCase();
  if (evidence.length < 80 || PLACEHOLDER_PATTERN.test(evidence)) {
    return { verified: false, reason: "rights_evidence_content_invalid" };
  }
  if (!required.every((value) => lowered.includes(value.toLowerCase()))) {
    return { verified: false, reason: "rights_evidence_campaign_mismatch" };
  }
  if (!RIGHTS_LANGUAGE_PATTERN.test(evidence)) {
    return { verified: false, reason: "rights_evidence_scope_missing" };
  }
  return { verified: true, evidencePath };
}

function compatibleAccounts(campaign) {
  return normalizedStringList([
    ...(Array.isArray(campaign.compatibleAccounts) ? campaign.compatibleAccounts : []),
    ...(Array.isArray(campaign.allowedAccounts) ? campaign.allowedAccounts : []),
    campaign.accountHandle,
  ]).map(normalizedHandle).filter(Boolean);
}

function campaignCandidate(snapshot, campaign, filename, now, maxSnapshotAgeHours, destinationAccount) {
  const marketplace = normalizedMarketplace(campaign.marketplace || snapshot.marketplace);
  const observedAt = isoDate(campaign.observedAt || snapshot.observedAt);
  const expiresAt = isoDate(campaign.expiresAt);
  const rightsExpiresAt = isoDate(campaign.rightsExpiresAt || campaign.rights?.expiresAt || campaign.expiresAt);
  const accounts = compatibleAccounts(campaign);
  const blockers = [];
  if (!marketplace) blockers.push("unsupported_marketplace");
  if (!text(campaign.id)) blockers.push("campaign_id_missing");
  if (!text(campaign.title)) blockers.push("campaign_title_missing");
  if (!observedAt) blockers.push("snapshot_observed_at_missing");
  if (observedAt && now.getTime() - Date.parse(observedAt) > maxSnapshotAgeHours * 3_600_000) blockers.push("snapshot_stale");
  if (observedAt && Date.parse(observedAt) > now.getTime() + 5 * 60_000) blockers.push("snapshot_from_future");
  if (campaign.active !== true) blockers.push("campaign_not_active");
  if (campaign.joined !== true) blockers.push("campaign_not_joined");
  if (!expiresAt) blockers.push("campaign_expiry_missing");
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) blockers.push("campaign_expired");
  if (!rightsExpiresAt) blockers.push("rights_expiry_missing");
  if (rightsExpiresAt && Date.parse(rightsExpiresAt) <= now.getTime()) blockers.push("rights_expired");
  if (!/^https:\/\//i.test(text(campaign.sourceUrl)) || PLACEHOLDER_PATTERN.test(text(campaign.sourceUrl))) blockers.push("authorized_source_missing");
  if (!accounts.includes(destinationAccount)) blockers.push("destination_account_incompatible");
  if (finiteNonNegative(campaign.payoutCpm) === null || Number(campaign.payoutCpm) <= 0) blockers.push("payout_cpm_missing");
  if (finiteNonNegative(campaign.minViewsPerPost) === null) blockers.push("minimum_views_missing");
  return { marketplace, observedAt, expiresAt, rightsExpiresAt, accounts, blockers, filename };
}

function normalizeCampaign(campaign, candidate, destinationAccount) {
  return {
    id: text(campaign.id),
    title: text(campaign.title),
    creator: text(campaign.creator) || text(campaign.title),
    creatorTier: text(campaign.creatorTier) || "unknown",
    creatorReachEvidence: text(campaign.creatorReachEvidence),
    marketplace: candidate.marketplace,
    marketplaceCampaignUrl: text(campaign.marketplaceCampaignUrl || campaign.campaignUrl),
    active: true,
    joined: true,
    observedAt: candidate.observedAt,
    expiresAt: candidate.expiresAt,
    payoutCpm: Number(campaign.payoutCpm),
    minViewsPerPost: Number(campaign.minViewsPerPost),
    maxPayoutPerPost: finiteNonNegative(campaign.maxPayoutPerPost),
    rightsEvidencePath: text(campaign.rightsEvidencePath || campaign.rights?.evidencePath),
    evidenceVerified: true,
    rightsScope: text(campaign.rightsScope || campaign.rights?.scope) || "transform_and_publish",
    rightsExpiresAt: candidate.rightsExpiresAt,
    sourceUrl: text(campaign.sourceUrl),
    accountHandle: destinationAccount,
    compatibleAccounts: candidate.accounts,
    sourceFilesReady: Math.trunc(finiteNonNegative(campaign.sourceFilesReady) || 0),
    draftsReady: Math.trunc(finiteNonNegative(campaign.draftsReady) || 0),
    payoutIdentityReady: campaign.payoutIdentityReady === true,
    payoutMethodReady: campaign.payoutMethodReady === true,
    requiredHashtags: normalizedStringList(campaign.requiredHashtags),
    requiredMentions: normalizedStringList(campaign.requiredMentions),
    requiredCaption: text(campaign.requiredCaption),
    draftFiles: normalizedStringList(campaign.draftFiles),
    intakeSourceFile: candidate.filename,
  };
}

function rejectionRow(campaign, candidate, blockers) {
  return {
    id: text(campaign.id) || null,
    title: text(campaign.title) || null,
    marketplace: candidate.marketplace || text(campaign.marketplace) || null,
    snapshot: candidate.filename,
    blockers: [...new Set(blockers)].sort(),
  };
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function reportMarkdown(report) {
  const lines = [
    "# Clippers marketplace supply report",
    "",
    `Generated: ${report.generatedAt}`,
    `Destination account: @${report.destinationAccount}`,
    `Snapshots read: ${report.summary.snapshotsRead}`,
    `Campaigns observed: ${report.summary.campaignsObserved}`,
    `Campaigns accepted: ${report.summary.accepted}`,
    `Production ready: ${report.summary.productionReady}`,
    `Campaigns rejected: ${report.summary.rejected}`,
    "",
    "## Accepted supply",
    "",
    ...(report.accepted.length
      ? report.accepted.map((row) => `- ${row.marketplace}/${row.id}: expires ${row.expiresAt}; drafts ${row.draftsReady}; rights ${row.rightsEvidencePath}`)
      : ["- None."]),
    "",
    "## Rejected supply",
    "",
    ...(report.rejected.length
      ? report.rejected.map((row) => `- ${row.marketplace || "unknown"}/${row.id || "unknown"}: ${row.blockers.join(", ")}`)
      : ["- None."]),
    "",
    "This report is based only on local snapshots and local rights evidence. It does not log in, scrape authenticated pages, spend money, or publish content.",
    "",
  ];
  return lines.join("\n");
}

export async function runMarketplaceIntake(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const snapshotDir = path.resolve(options.snapshotDir || path.join(workspaceRoot, "research", "marketplace-snapshots"));
  const outputPath = path.resolve(options.outputPath || path.join(workspaceRoot, "research", "paid-streamer-campaigns.json"));
  const reportPath = path.resolve(options.reportPath || path.join(workspaceRoot, "reports", "marketplace-supply-report.json"));
  const markdownPath = path.resolve(options.markdownPath || path.join(workspaceRoot, "reports", "marketplace-supply-report.md"));
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error("invalid intake timestamp");
  const maxSnapshotAgeHours = finiteNonNegative(options.maxSnapshotAgeHours ?? process.env.CLIPPERS_MARKETPLACE_SNAPSHOT_MAX_AGE_HOURS)
    ?? DEFAULT_MAX_SNAPSHOT_AGE_HOURS;
  const destinationAccount = normalizedHandle(options.destinationAccount || process.env.CLIPPERS_STREAMER_ACCOUNT_HANDLE || "streamersclipusa");
  if (!destinationAccount) throw new Error("destination account is required");

  const filenames = (await readdir(snapshotDir).catch(() => []))
    .filter((filename) => filename.toLowerCase().endsWith(".json"))
    .sort();
  const acceptedByKey = new Map();
  const rejected = [];
  let campaignsObserved = 0;
  for (const filename of filenames) {
    const snapshotPath = path.join(snapshotDir, filename);
    const safeSnapshotPath = await containedRegularFile(workspaceRoot, snapshotPath);
    if (!safeSnapshotPath) {
      rejected.push({ id: null, title: null, marketplace: null, snapshot: filename, blockers: ["snapshot_file_missing_or_unsafe"] });
      continue;
    }
    let snapshot;
    try {
      snapshot = JSON.parse(await readFile(safeSnapshotPath, "utf8"));
    } catch {
      rejected.push({ id: null, title: null, marketplace: null, snapshot: filename, blockers: ["snapshot_json_invalid"] });
      continue;
    }
    const campaigns = snapshotCampaigns(snapshot);
    if (!campaigns.length) {
      rejected.push({ id: null, title: null, marketplace: normalizedMarketplace(snapshot?.marketplace), snapshot: filename, blockers: ["snapshot_campaigns_missing"] });
      continue;
    }
    campaignsObserved += campaigns.length;
    for (const campaign of campaigns) {
      const candidate = campaignCandidate(snapshot, campaign, filename, now, maxSnapshotAgeHours, destinationAccount);
      const rights = candidate.marketplace
        ? await verifyRightsEvidence(workspaceRoot, campaign, candidate.marketplace)
        : { verified: false, reason: "unsupported_marketplace" };
      const blockers = [...candidate.blockers];
      if (!rights.verified) blockers.push(rights.reason);
      if (blockers.length) {
        rejected.push(rejectionRow(campaign, candidate, blockers));
        continue;
      }
      const normalized = normalizeCampaign(campaign, candidate, destinationAccount);
      const key = `${normalized.marketplace}:${normalized.id.toLowerCase()}`;
      const current = acceptedByKey.get(key);
      if (!current || Date.parse(normalized.observedAt) > Date.parse(current.observedAt)) {
        if (current) rejected.push(rejectionRow(current, { ...candidate, filename: current.intakeSourceFile }, ["superseded_by_newer_snapshot"]));
        acceptedByKey.set(key, normalized);
      } else {
        rejected.push(rejectionRow(campaign, candidate, ["superseded_by_newer_snapshot"]));
      }
    }
  }
  const accepted = [...acceptedByKey.values()].sort((a, b) => a.marketplace.localeCompare(b.marketplace) || a.id.localeCompare(b.id));
  rejected.sort((a, b) => String(a.marketplace).localeCompare(String(b.marketplace)) || String(a.id).localeCompare(String(b.id)) || a.snapshot.localeCompare(b.snapshot));
  const report = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    destinationAccount,
    maxSnapshotAgeHours,
    summary: {
      snapshotsRead: filenames.length,
      campaignsObserved,
      accepted: accepted.length,
      productionReady: accepted.filter((row) => row.sourceFilesReady > 0 && row.draftsReady > 0).length,
      rejected: rejected.length,
    },
    byMarketplace: [...SUPPORTED_MARKETPLACES.values()].filter((value, index, all) => all.indexOf(value) === index).sort()
      .map((marketplace) => ({
        marketplace,
        accepted: accepted.filter((row) => row.marketplace === marketplace).length,
        rejected: rejected.filter((row) => row.marketplace === marketplace).length,
      })),
    accepted,
    rejected,
    costUsd: 0,
    networkAccessUsed: false,
  };
  await atomicJson(outputPath, accepted);
  await atomicJson(reportPath, report);
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, reportMarkdown(report), "utf8");
  return report;
}

async function main() {
  const report = await runMarketplaceIntake();
  console.log(JSON.stringify({ status: report.summary.accepted ? "ready" : "blocked", ...report.summary, report: "reports/marketplace-supply-report.json" }, null, 2));
  if (!report.summary.accepted) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}
