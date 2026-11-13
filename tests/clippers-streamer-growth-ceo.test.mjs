import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildHashtagPolicy,
  buildMetricoolApprovalRows,
  buildStreamerGrowthCeoPlan,
  dedupePublishedMetrics,
  refreshDecisionOperationalState,
  resolveWorkspaceMediaPath,
  validateMetricoolMp4,
} from "../script/clippers-streamer-growth-ceo.mjs";

const now = new Date("2026-07-21T18:00:00.000Z");
const publishedPostUrl = "https://www.tiktok.com/@streamersclipusa/video/1234567890123456789";
const campaign = {
  id: "mrbeast-jre",
  title: "MrBeast x Joe Rogan",
  creator: "MrBeast",
  creatorTier: "top",
  creatorReachEvidence: "https://www.youtube.com/@MrBeast",
  marketplace: "vyro",
  active: true,
  joined: true,
  statusObservedAt: "2026-07-21T17:30:00.000Z",
  expiresAt: "2026-07-29T18:00:00.000Z",
  payoutCpm: 1.5,
  minViewsPerPost: 5000,
  maxPayoutPerPost: 1000,
  rightsEvidencePath: "evidence-drop/vyro/mrbeast.md",
  evidenceVerified: true,
  sourceUrl: "https://f.io/authorized-source",
  accountHandle: "streamersclipusa",
  sourceFilesReady: 7,
  draftsReady: 7,
  payoutIdentityReady: true,
  payoutMethodReady: true,
  requiredHashtags: ["#MrBeast", "#paidpartner"],
  draftFiles: ["draft-01.mp4", "draft-02.mp4", "draft-03.mp4", "draft-04.mp4", "draft-05.mp4", "draft-06.mp4", "draft-07.mp4"],
};

test("blocks famous creators when campaign rights evidence is missing", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [{ ...campaign, rightsEvidencePath: "" }], metrics: [], now });
  assert.equal(plan.status, "blocked");
  assert.equal(plan.decisions[0].decision, "blocked");
  assert.ok(plan.decisions[0].productionBlockers.includes("campaign_rights_evidence_missing"));
  assert.equal(plan.decisions[0].priorityScore, 0);
  const authorizedPlan = buildStreamerGrowthCeoPlan({
    campaigns: [{ ...campaign, rightsEvidencePath: "" }],
    metrics: [],
    now,
    publishingAuthorized: true,
  });
  assert.match(authorizedPlan.nextBestAction, /campaign_rights_evidence_missing/);
});

test("tests a verified top creator without fabricating expected revenue", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now });
  assert.equal(plan.status, "testing");
  assert.equal(plan.decisions[0].decision, "test");
  assert.equal(plan.decisions[0].observed.totalViews, 0);
  assert.equal(plan.goal.projection, "insufficient_real_posts");
  assert.equal(plan.operatingPolicy.dailyTestClips, 5);
  assert.equal(plan.decisions[0].assignments.length, 7);
  assert.deepEqual(
    new Set(plan.decisions[0].assignments.map((row) => row.strategyId)),
    new Set(["direct_insight", "curiosity_question", "context_first", "hook_only"]),
  );
  assert.deepEqual(plan.decisions[0].assignments[0].requiredHashtags, ["#MrBeast", "#paidpartner"]);
  assert.match(plan.decisions[0].assignments[0].captionText, /#MrBeast #paidpartner$/);
  assert.ok(plan.decisions[0].assignments.every((row) => row.publishAllowed === false));
  assert.deepEqual(plan.decisions[0].hashtagPolicy.required, [
    { tag: "#MrBeast", locked: true, reason: "campaign_requirement" },
    { tag: "#paidpartner", locked: true, reason: "campaign_disclosure_required" },
  ]);
});

test("never treats campaign disclosure hashtags as removable experiments", () => {
  const policy = buildHashtagPolicy(campaign, [
    { optionalHashtags: ["#viral"], views: 100 },
    { optionalHashtags: ["#viral"], views: 200 },
    { optionalHashtags: ["#viral"], views: 300 },
  ]);
  assert.equal(policy.required.find((row) => row.tag === "#paidpartner").locked, true);
  assert.equal(policy.optional.find((row) => row.tag === "#viral").recommendation, "compare_against_control");
  assert.ok(!policy.optional.some((row) => row.tag === "#paidpartner"));
});

test("draft metadata cannot remove campaign disclosure hashtags", () => {
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [{
      ...campaign,
      draftMetadata: {
        "draft-01.mp4": {
          caption: "Custom campaign caption #MrBeast",
          requiredHashtags: [],
        },
      },
    }],
    metrics: [],
    now,
  });
  assert.deepEqual(plan.decisions[0].assignments[0].requiredHashtags, ["#MrBeast", "#paidpartner"]);
  assert.match(plan.decisions[0].assignments[0].captionText, /#paidpartner$/);
});

test("deduplicates repeated public post URLs before learning", () => {
  const repeated = [
    { publishedPostUrl, views: 100 },
    { publishedPostUrl, views: 250 },
  ];
  assert.deepEqual(dedupePublishedMetrics(repeated), [repeated[1]]);
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: repeated.map((row) => ({
      ...row,
      campaignId: campaign.id,
      finalStatus: "published",
      metricEvidenceVerified: true,
    })),
    now,
  });
  assert.equal(plan.goal.measuredViews, 250);
  assert.equal(plan.decisions[0].observed.publishedPosts, 1);
});

test("requires an explicit runtime opt-in before enabling Metricool publishing", () => {
  const defaultPlan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now });
  const authorizedPlan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: [],
    now,
    publishingAuthorized: true,
  });

  assert.equal(defaultPlan.operatingPolicy.realPublishEnabled, false);
  assert.equal(defaultPlan.operatingPolicy.metricoolApprovalRequired, true);
  assert.equal(authorizedPlan.operatingPolicy.publishingAuthorized, true);
  assert.equal(authorizedPlan.operatingPolicy.realPublishEnabled, false);
  assert.equal(authorizedPlan.operatingPolicy.metricoolApprovalRequired, true);
  assert.equal(authorizedPlan.decisions[0].publishingAuthorized, true);
  assert.equal(authorizedPlan.decisions[0].realPublishEnabled, false);
  const authorizedRows = buildMetricoolApprovalRows(authorizedPlan.decisions[0], {
    1: { ready: true, relativePath: "drafts/vyro/authorized.mp4" },
  });
  assert.equal(authorizedRows[0].status, "authorized_for_metricool");
  assert.equal(authorizedRows[0].publishAllowed, true);
  assert.equal(authorizedRows[1].status, "blocked_media_missing");
  assert.equal(authorizedRows[1].publishAllowed, false);
  const deliveredRows = buildMetricoolApprovalRows(authorizedPlan.decisions[0], {
    1: { ready: true, relativePath: "draft-01.mp4" },
  }, [{ draftFile: "draft-01.mp4", status: "verification_pending" }]);
  assert.equal(deliveredRows[0].status, "already_scheduled_or_published");
  assert.equal(deliveredRows[0].publishAllowed, false);
  assert.equal(buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now, targetDailyClips: 20 }).operatingPolicy.dailyTestClips, 5);
  assert.equal(buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now, targetDailyClips: -3 }).operatingPolicy.dailyTestClips, 5);
});

test("starts at five daily and reduces only after enough verified poor results", () => {
  const metrics = Array.from({ length: 15 }, (_, index) => ({
    campaignId: campaign.id,
    strategyId: index % 2 ? "hook_only" : "curiosity_question",
    finalStatus: "published",
    publishedPostUrl: `https://www.tiktok.com/@streamersclipusa/video/${1234567890123456700n + BigInt(index)}`,
    views: 500 + index * 50,
    earningsUsd: 0,
    qualifiedForPayout: false,
    metricEvidenceVerified: true,
  }));

  const learningPlan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: metrics.slice(0, 5), now });
  assert.equal(learningPlan.operatingPolicy.dailyTestClips, 5);
  assert.equal(learningPlan.operatingPolicy.minimumInitialDailyClips, 5);
  assert.equal(learningPlan.operatingPolicy.volumeReason, "initial_learning_floor");

  const recutPlan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics, now });
  assert.equal(recutPlan.operatingPolicy.dailyTestClips, 2);
  assert.equal(recutPlan.operatingPolicy.maximumDailyClipsPerAccount, 5);
  assert.equal(recutPlan.operatingPolicy.volumeReason, "reduce_while_recutting");
});

test("scheduled rows cannot raise the five-clip initial learning volume", () => {
  const scheduledMetrics = Array.from({ length: 20 }, (_, index) => ({
    campaignId: campaign.id,
    finalStatus: index % 2 ? "scheduled" : "queued",
    views: 1_000_000,
  }));
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: scheduledMetrics,
    now,
    targetDailyClips: 8,
  });
  assert.equal(plan.operatingPolicy.dailyTestClips, 5);
  assert.equal(plan.operatingPolicy.configuredDailyCeiling, 5);
  assert.equal(plan.operatingPolicy.volumeReason, "initial_learning_floor");
});

test("never raises volume above the authorized five clips after verified winning posts", () => {
  const winningMetrics = Array.from({ length: 15 }, (_, index) => ({
    campaignId: campaign.id,
    strategyId: "direct_insight",
    finalStatus: "published",
    publishedPostUrl: `https://www.tiktok.com/@streamersclipusa/video/${2234567890123456700n + BigInt(index)}`,
    views: 10_000 + index * 100,
    earningsUsd: 15,
    qualifiedForPayout: true,
    metricEvidenceVerified: true,
    payoutEvidenceVerified: true,
    qualificationEvidenceVerified: true,
  }));
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: winningMetrics,
    now,
    targetDailyClips: 8,
  });
  assert.equal(plan.operatingPolicy.dailyTestClips, 5);
  assert.equal(plan.operatingPolicy.configuredDailyCeiling, 5);
  assert.equal(plan.operatingPolicy.volumeReason, "increase_verified_winners");
});

test("accepts an observed countdown without inventing an exact campaign deadline", () => {
  const relativeCampaign = {
    ...campaign,
    expiresAt: "",
    remainingTimeObservedAt: "2026-07-21T18:00:00.000Z",
    hoursRemainingObserved: 192,
  };
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [relativeCampaign], metrics: [], now });
  assert.equal(plan.decisions[0].hoursRemaining, 192);
  assert.equal(plan.decisions[0].canProduce, true);
});

test("separates Metricool approval readiness from Vyro cashout readiness", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [{ ...campaign, payoutMethodReady: false }], metrics: [], now });
  assert.equal(plan.decisions[0].canProduce, true);
  assert.equal(plan.decisions[0].canEnterApprovalQueue, true);
  assert.equal(plan.decisions[0].cashoutReady, false);
  assert.ok(plan.decisions[0].cashoutBlockers.includes("payout_method_not_connected"));
  assert.equal(plan.decisions[0].publishBlockers.length, 0);
});

test("scales only after real qualifying posts and keeps exploration", () => {
  const metrics = [
    { campaignId: campaign.id, strategyId: "direct_insight", finalStatus: "published", publishedPostUrl: "https://www.tiktok.com/@streamersclipusa/video/1234567890123456781", views: 12000, earningsUsd: 18, qualifiedForPayout: true, metricEvidenceVerified: true, payoutEvidenceVerified: true, qualificationEvidenceVerified: true, completionRate: 0.41, shareRate: 0.03 },
    { campaignId: campaign.id, strategyId: "direct_insight", finalStatus: "published", publishedPostUrl: "https://www.tiktok.com/@streamersclipusa/video/1234567890123456782", views: 9000, earningsUsd: 13.5, qualifiedForPayout: true, metricEvidenceVerified: true, payoutEvidenceVerified: true, qualificationEvidenceVerified: true, completionRate: 0.38, shareRate: 0.025 },
    { campaignId: campaign.id, strategyId: "direct_insight", finalStatus: "published", publishedPostUrl: "https://www.tiktok.com/@streamersclipusa/video/1234567890123456783", views: 15000, earningsUsd: 22.5, qualifiedForPayout: true, metricEvidenceVerified: true, payoutEvidenceVerified: true, qualificationEvidenceVerified: true, completionRate: 0.45, shareRate: 0.04 },
  ];
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics, now });
  assert.equal(plan.status, "scaling");
  assert.equal(plan.decisions[0].decision, "scale");
  assert.equal(plan.decisions[0].experiment.winnerStrategyId, "direct_insight");
  assert.deepEqual(plan.decisions[0].experiment.allocation, { winnerPercent: 70, explorationPercent: 30 });
  assert.equal(plan.decisions[0].assignments.filter((row) => row.strategyId === "direct_insight").length, 5);
  assert.equal(plan.goal.measuredViews, 36000);
  assert.equal(plan.goal.measuredEarningsUsd, 54);
});

test("queued or scheduled rows never count as published performance", () => {
  const metrics = [
    { campaignId: campaign.id, strategyId: "direct_insight", finalStatus: "scheduled", views: 9999999, earningsUsd: 9999, qualifiedForPayout: true },
    { campaignId: campaign.id, strategyId: "direct_insight", finalStatus: "queued", views: 5000000, earningsUsd: 5000, qualifiedForPayout: true },
  ];
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics, now });
  assert.equal(plan.goal.measuredViews, 0);
  assert.equal(plan.goal.measuredEarningsUsd, 0);
  assert.equal(plan.decisions[0].decision, "test");
});

test("pauses a cut style after six posts with no payout qualification", () => {
  const metrics = Array.from({ length: 6 }, (_, index) => ({
    campaignId: campaign.id,
    strategyId: index % 2 ? "hook_only" : "curiosity_question",
    finalStatus: "published",
    publishedPostUrl: `https://www.tiktok.com/@streamersclipusa/video/${4234567890123456700n + BigInt(index)}`,
    views: 500 + index * 100,
    earningsUsd: 0,
    qualifiedForPayout: false,
    metricEvidenceVerified: true,
  }));
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics, now });
  assert.equal(plan.decisions[0].decision, "pause_and_recut");
  assert.match(plan.decisions[0].nextAction, /Pause/);
});

test("ignores published metrics without local Metricool evidence", () => {
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: [{
      campaignId: campaign.id,
      strategyId: "direct_insight",
      finalStatus: "published",
      views: 10_000_000,
      earningsUsd: 15_000,
      qualifiedForPayout: true,
      metricEvidenceVerified: false,
      payoutEvidenceVerified: false,
    }],
    now,
  });
  assert.equal(plan.goal.measuredViews, 0);
  assert.equal(plan.goal.measuredEarningsUsd, 0);
  assert.equal(plan.decisions[0].decision, "test");
});

test("ignores proof flags when the exact TikTok post URL is missing", () => {
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: [{
      campaignId: campaign.id,
      strategyId: "direct_insight",
      finalStatus: "published",
      publishedPostUrl: "",
      views: 10_000_000,
      metricEvidenceVerified: true,
    }],
    now,
  });
  assert.equal(plan.goal.measuredViews, 0);
  assert.equal(plan.decisions[0].observed.publishedPosts, 0);
});

test("ignores verified metrics from a different TikTok account", () => {
  const wrongAccountMetrics = Array.from({ length: 15 }, (_, index) => ({
    campaignId: campaign.id,
    strategyId: "direct_insight",
    finalStatus: "published",
    publishedPostUrl: `https://www.tiktok.com/@wrongaccount/video/${3234567890123456700n + BigInt(index)}`,
    views: 1_000_000,
    qualifiedForPayout: true,
    metricEvidenceVerified: true,
    qualificationEvidenceVerified: true,
  }));
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: wrongAccountMetrics, now, targetDailyClips: 8 });
  assert.equal(plan.goal.measuredViews, 0);
  assert.equal(plan.decisions[0].observed.publishedPosts, 0);
  assert.equal(plan.decisions[0].decision, "test");
  assert.equal(plan.operatingPolicy.dailyTestClips, 5);
});

test("Metricool rows point to final media while cashout setup remains separate", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [{ ...campaign, payoutMethodReady: false }], metrics: [], now });
  const rows = buildMetricoolApprovalRows(plan.decisions[0], {
    1: { ready: true, relativePath: "drafts/vyro/campaign/subtitled/final.mp4" },
  });
  assert.equal(rows[0].draftFile, "drafts/vyro/campaign/subtitled/final.mp4");
  assert.equal(rows[0].status, "approval_required");
  assert.equal(rows[0].publishAllowed, false);
  assert.equal(rows[1].status, "blocked_media_missing");
});

test("Metricool rows require approval even after campaign and payout gates pass", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now });
  const rows = buildMetricoolApprovalRows(plan.decisions[0], {
    1: { ready: true, relativePath: "drafts/vyro/campaign/subtitled/final.mp4" },
  });
  assert.equal(rows[0].status, "approval_required");
  assert.equal(rows[0].publishAllowed, false);
});

test("normalizes served workspace paths without accepting outside paths as ready media", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-ceo-media-"));
  try {
    await mkdir(path.join(root, "drafts"));
    const fakeMp4 = path.join(root, "drafts", "fake.mp4");
    await writeFile(fakeMp4, "not a real MP4");
    assert.equal(resolveWorkspaceMediaPath(root, "/clippers-workspace/drafts/fake.mp4"), fakeMp4);
    assert.equal(await validateMetricoolMp4(root, "/clippers-workspace/drafts/fake.mp4"), null);
    assert.equal(await validateMetricoolMp4(root, "../outside.mp4"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports authorization, objective and execution truth as typed worker state", () => {
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: [],
    now,
    publishingAuthorized: true,
    targetDailyClips: 3,
  });

  assert.deepEqual(plan.executionState.objective, {
    targetDailyClips: 3,
    maximumDailyClips: 5,
    paidSpendLimitUsd: 0,
  });
  assert.deepEqual(plan.executionState.authorization, {
    status: "authorized",
    canPublish: true,
  });
  assert.equal(plan.executionState.activity, "idle");
  assert.equal(plan.executionState.canClaimWorking, false);
  assert.equal(plan.executionState.capabilities.canProduceNow, true);
  assert.equal(plan.executionState.capabilities.canDeliverNow, false);
  assert.match(plan.executionState.truth, /no delivery is executing/i);
});

test("blocks unknown, stale and expired campaign state with distinct typed reasons", () => {
  const unknown = buildStreamerGrowthCeoPlan({
    campaigns: [{ ...campaign, statusObservedAt: "" }],
    metrics: [],
    now,
  }).decisions[0];
  assert.ok(unknown.warnings.includes("campaign_status_freshness_unknown"));
  assert.equal(unknown.operationalState.phase, "ready_for_media_validation");
  assert.equal(unknown.operationalState.capabilities.canProduce, true);
  assert.equal(unknown.operationalState.canClaimWorking, false);
  assert.ok(unknown.operationalState.blockers.some((row) => row.code === "campaign_status_freshness_unknown" && row.severity === "warning"));

  const stale = buildStreamerGrowthCeoPlan({
    campaigns: [{ ...campaign, statusObservedAt: "2026-07-19T17:00:00.000Z" }],
    metrics: [],
    now,
  }).decisions[0];
  assert.equal(stale.campaignStatusFreshness.status, "stale");
  assert.ok(stale.operationalState.blockers.some((row) => row.code === "campaign_status_stale" && row.blocks === "produce"));

  const expired = buildStreamerGrowthCeoPlan({
    campaigns: [{ ...campaign, expiresAt: "2026-07-21T17:59:59.000Z" }],
    metrics: [],
    now,
  }).decisions[0];
  assert.ok(expired.productionBlockers.includes("campaign_expired"));
  assert.ok(!expired.productionBlockers.includes("campaign_expiry_unknown"));
});

test("separates media, delivery and cashout readiness without claiming active work", () => {
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [{ ...campaign, payoutMethodReady: false }],
    metrics: [],
    now,
    publishingAuthorized: true,
  });
  const decision = plan.decisions[0];
  const rows = buildMetricoolApprovalRows(decision, {
    1: { ready: true, relativePath: "drafts/vyro/final.mp4" },
  });

  const blockedDelivery = refreshDecisionOperationalState(decision, { rows, deliverableCount: 0 });
  assert.equal(blockedDelivery.phase, "blocked_delivery");
  assert.equal(blockedDelivery.capabilities.canDeliver, false);
  assert.equal(blockedDelivery.capabilities.canCashout, false);
  assert.ok(blockedDelivery.blockers.some((row) => row.code === "payout_method_not_connected" && row.blocks === "cashout"));
  assert.ok(blockedDelivery.blockers.some((row) => row.code === "metricool_delivery_input_missing" && row.blocks === "deliver"));

  const ready = refreshDecisionOperationalState(decision, { rows, deliverableCount: 1 });
  assert.equal(ready.phase, "ready_for_delivery");
  assert.equal(ready.capabilities.canDeliver, true);
  assert.equal(ready.activity, "idle");
  assert.equal(ready.canClaimWorking, false);
  assert.match(ready.truth, /no delivery has started/i);
});
