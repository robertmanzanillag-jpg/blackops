import { DISCOVERY_CREATORS } from "../../script/clippers-portfolio-discovery.mjs";
import { DESTINATIONS, destinationKey } from "../../script/clippers-portfolio-metricool.mjs";

// Synthetic evidence for local UI tests, never imported by production.
export function orchestraFixture(now = Date.now()) {
  const at = new Date(now).toISOString();
  return {
    version: 1, generatedAt: at, evidenceAt: at,
    sourceFreshness: { state: "connected", transport: "authenticated_ingest", receivedAt: at, reportedAt: at, ageMinutes: 0, staleAfterMinutes: 30, heldReasons: [] },
    transport: { state: "connected", lastIngestAt: at, maxAgeMs: 90_000 },
    disconnectedDestinations: [{ brandId: "6595747", label: "NY", reason: "destination_not_connected" }],
    accounts: DESTINATIONS.map(destination => ({
      key: destinationKey(destination), brandId: String(destination.brandId), network: destination.network, account: destination.account,
      label: destination.account, connection: "unverified", observedAt: null, dailyTarget: 5,
      eligibleAssets: 0, confirmedScheduledOrPublished: 0, shortfall: 5, heldReasons: ["no_reviewed_assets"],
      activeVersion: "baseline-1", policyStatus: "unmeasured_baseline", metricAgeBuckets: [],
    })),
    roles: ["supervisor", "analytics", "trends", "streamers", "editor", "checker", "publisher", "learning", "health"].map(stage => ({
      id: `clippers-${stage}`, stage, state: stage === "editor" ? "working" : "held", evidenceAt: at,
      activeUntil: stage === "editor" ? new Date(now + 30_000).toISOString() : null,
      lastRunAt: at, heartbeatAt: at, nextDueAt: new Date(now + 3_600_000).toISOString(),
      runId: stage === "editor" ? "run:fixture-editor" : null, evidenceIds: stage === "editor" ? ["run:fixture-editor"] : [],
      outputs: { verified_publications: 0 }, heldReasons: stage === "editor" ? [] : ["no_reviewed_assets"], lifePenaltyExempt: true,
      career: { registered: stage === "editor", generation: stage === "editor" ? 1 : null, points: stage === "editor" ? 0 : null,
        battery: stage === "editor" ? 80 : null, inTraining: false, hiredAt: stage === "editor" ? at : null, skillIds: [], lastEvidenceId: null },
    })),
    discovery: {
      sources: DISCOVERY_CREATORS.map(creator => ({ creatorId: creator.id, channelId: creator.channelId, observedAt: null, status: "not_observed", heldReasons: ["not_observed"], observations: 0 })),
      observations: 0, eligibleAssets: 0, rotationSize: 4, rotationDays: 2,
      signals: [{ creatorId: "thegrefg", videoId: "abcdefghijk", publishedAt: new Date(now - 3_600_000).toISOString(), observedAt: at,
        views: 100, previousObservedAt: null, previousViews: null, growthViews: null, growthPerHour: null, label: "initial_baseline", rights: "unknown" }],
      rightsPolicy: "owner_review_required",
    },
    learning: { comparisons: [], eligibleComparisons: 0, promotions: 0, requiredComparisons: 3, minimumPerArm: 5, improvementThreshold: 0.2, automaticPromotion: false, heldReasons: ["no_measured_pairs"] },
    safety: { paidSpendUsd: 0, deniedBrandIds: ["6431692", "6475033", "6585226"], metadataDoesNotGrantRights: true, publicUploadRequiresReviewedPacket: true, publicationClaimsRequireProviderReceipt: true },
  };
}
