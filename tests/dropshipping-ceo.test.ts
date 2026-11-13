import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeDropshippingSocialPerformance,
  buildDropshippingCapitalPlan,
  buildDropshippingDailyReport,
  buildDropshippingGrowthSprint,
  buildDropshippingLaunchPack,
  buildDropshippingLaunchPlan,
  buildDropshippingMarketingCampaign,
  createDropshippingProductScoutCandidate,
  createDropshippingSocialPostBatch,
  createDropshippingShopifyDraft,
  getDropshippingCeoSnapshot,
  getDropshippingExecutionSetup,
  getDropshippingLaunchReadiness,
  getDropshippingLiveSignalReadiness,
  markDropshippingApprovalOutboxQueued,
  prepareDropshippingFulfillment,
  prepareDropshippingApprovalOutboxMigration,
  prepareDropshippingLaunchPackApprovalQueue,
  promoteDropshippingScoutCandidate,
  publishDropshippingSocialPost,
  preflightDropshippingShopifyDraft,
  recordDropshippingApprovalDecision,
  recordDropshippingApprovalOutboxRequests,
  recordDropshippingLedgerEntry,
  recordDropshippingLearningReview,
  recordDropshippingOrder,
  recordDropshippingSocialMetrics,
  researchDropshippingProduct,
  resetDropshippingEngineForTests,
  reviewDropshippingSupplier,
  runDropshippingAutopilotProductHunter,
  setDropshippingApprovalsPathForTests,
  setDropshippingApprovalOutboxPathForTests,
  setDropshippingAutopilotProductHunterRunsPathForTests,
  setDropshippingCeoCyclesPathForTests,
  setDropshippingCapitalPlansPathForTests,
  setDropshippingProductScoutCandidatesPathForTests,
  setDropshippingLaunchPlansPathForTests,
  setDropshippingLearningPathForTests,
  setDropshippingLedgerPathForTests,
  setDropshippingMarketingCampaignsPathForTests,
  setDropshippingOrdersPathForTests,
  setDropshippingFulfillmentActionsPathForTests,
  setDropshippingGrowthSprintsPathForTests,
  setDropshippingLaunchPacksPathForTests,
  setDropshippingProductsPathForTests,
  setDropshippingShopifyDraftsPathForTests,
  setDropshippingSocialAnalysesPathForTests,
  setDropshippingSocialMetricsPathForTests,
  setDropshippingSocialPostsPathForTests,
  setDropshippingSuppliersPathForTests,
  runDropshippingCeoCycle,
  runDropshippingDailyOperatingCycle,
  runDropshippingProductScoutBatch,
} from "../server/dropshipping-ceo";

const testDir = path.join(os.tmpdir(), "dropshipping-ceo-tests");
const originalShopifyShopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
const originalShopifyAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const originalShopifyApiVersion = process.env.SHOPIFY_API_VERSION;
const originalSocialWebhookUrl = process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL;
const originalSocialWebhookToken = process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_TOKEN;
const originalMetricoolUserToken = process.env.METRICOOL_USER_TOKEN;
const originalMetricoolUserId = process.env.METRICOOL_USER_ID;
const originalMetricoolMcpUrl = process.env.METRICOOL_MCP_URL;
const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const originalSupplierExecutionMode = process.env.DROPSHIPPING_SUPPLIER_EXECUTION_MODE;
const originalSupplierPortalUrl = process.env.DROPSHIPPING_SUPPLIER_PORTAL_URL;
const originalStorePaymentProcessor = process.env.STORE_PAYMENT_PROCESSOR;
const originalReturnPolicyUrl = process.env.DROPSHIPPING_RETURN_POLICY_URL;
const originalPrivacyPolicyUrl = process.env.DROPSHIPPING_PRIVACY_POLICY_URL;
const originalPublicAppUrl = process.env.PUBLIC_APP_URL;
const originalExpoPublicDomain = process.env.EXPO_PUBLIC_DOMAIN;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalLiveProductSignalsJson = process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON;
const originalLiveProductSignalsPath = process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_PATH;

test.beforeEach(() => {
  setDropshippingProductsPathForTests(path.join(testDir, "products.json"));
  setDropshippingProductScoutCandidatesPathForTests(path.join(testDir, "product-scout-candidates.json"));
  setDropshippingSuppliersPathForTests(path.join(testDir, "suppliers.json"));
  setDropshippingLaunchPlansPathForTests(path.join(testDir, "launch-plans.json"));
  setDropshippingLedgerPathForTests(path.join(testDir, "ledger.json"));
  setDropshippingApprovalsPathForTests(path.join(testDir, "approvals.json"));
  setDropshippingLearningPathForTests(path.join(testDir, "learning.json"));
  setDropshippingMarketingCampaignsPathForTests(path.join(testDir, "campaigns.json"));
  setDropshippingCeoCyclesPathForTests(path.join(testDir, "cycles.json"));
  setDropshippingShopifyDraftsPathForTests(path.join(testDir, "shopify-drafts.json"));
  setDropshippingSocialPostsPathForTests(path.join(testDir, "social-posts.json"));
  setDropshippingSocialMetricsPathForTests(path.join(testDir, "social-metrics.json"));
  setDropshippingSocialAnalysesPathForTests(path.join(testDir, "social-analyses.json"));
  setDropshippingOrdersPathForTests(path.join(testDir, "orders.json"));
  setDropshippingFulfillmentActionsPathForTests(path.join(testDir, "fulfillment-actions.json"));
  setDropshippingCapitalPlansPathForTests(path.join(testDir, "capital-plans.json"));
  setDropshippingGrowthSprintsPathForTests(path.join(testDir, "growth-sprints.json"));
  setDropshippingLaunchPacksPathForTests(path.join(testDir, "launch-packs.json"));
  setDropshippingApprovalOutboxPathForTests(path.join(testDir, "approval-outbox.json"));
  setDropshippingAutopilotProductHunterRunsPathForTests(path.join(testDir, "autopilot-product-hunter-runs.json"));
  delete process.env.SHOPIFY_SHOP_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  delete process.env.SHOPIFY_API_VERSION;
  delete process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL;
  delete process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_TOKEN;
  delete process.env.METRICOOL_USER_TOKEN;
  delete process.env.METRICOOL_USER_ID;
  delete process.env.METRICOOL_MCP_URL;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.DROPSHIPPING_SUPPLIER_EXECUTION_MODE;
  delete process.env.DROPSHIPPING_SUPPLIER_PORTAL_URL;
  delete process.env.STORE_PAYMENT_PROCESSOR;
  delete process.env.DROPSHIPPING_RETURN_POLICY_URL;
  delete process.env.DROPSHIPPING_PRIVACY_POLICY_URL;
  delete process.env.PUBLIC_APP_URL;
  delete process.env.EXPO_PUBLIC_DOMAIN;
  delete process.env.DATABASE_URL;
  delete process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON;
  delete process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_PATH;
  resetDropshippingEngineForTests();
});

test.after(() => {
  if (originalShopifyShopDomain === undefined) delete process.env.SHOPIFY_SHOP_DOMAIN;
  else process.env.SHOPIFY_SHOP_DOMAIN = originalShopifyShopDomain;
  if (originalShopifyAccessToken === undefined) delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  else process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = originalShopifyAccessToken;
  if (originalShopifyApiVersion === undefined) delete process.env.SHOPIFY_API_VERSION;
  else process.env.SHOPIFY_API_VERSION = originalShopifyApiVersion;
  if (originalSocialWebhookUrl === undefined) delete process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL;
  else process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL = originalSocialWebhookUrl;
  if (originalSocialWebhookToken === undefined) delete process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_TOKEN;
  else process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_TOKEN = originalSocialWebhookToken;
  if (originalMetricoolUserToken === undefined) delete process.env.METRICOOL_USER_TOKEN;
  else process.env.METRICOOL_USER_TOKEN = originalMetricoolUserToken;
  if (originalMetricoolUserId === undefined) delete process.env.METRICOOL_USER_ID;
  else process.env.METRICOOL_USER_ID = originalMetricoolUserId;
  if (originalMetricoolMcpUrl === undefined) delete process.env.METRICOOL_MCP_URL;
  else process.env.METRICOOL_MCP_URL = originalMetricoolMcpUrl;
  if (originalTelegramBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalTelegramBotToken;
  if (originalSupplierExecutionMode === undefined) delete process.env.DROPSHIPPING_SUPPLIER_EXECUTION_MODE;
  else process.env.DROPSHIPPING_SUPPLIER_EXECUTION_MODE = originalSupplierExecutionMode;
  if (originalSupplierPortalUrl === undefined) delete process.env.DROPSHIPPING_SUPPLIER_PORTAL_URL;
  else process.env.DROPSHIPPING_SUPPLIER_PORTAL_URL = originalSupplierPortalUrl;
  if (originalStorePaymentProcessor === undefined) delete process.env.STORE_PAYMENT_PROCESSOR;
  else process.env.STORE_PAYMENT_PROCESSOR = originalStorePaymentProcessor;
  if (originalReturnPolicyUrl === undefined) delete process.env.DROPSHIPPING_RETURN_POLICY_URL;
  else process.env.DROPSHIPPING_RETURN_POLICY_URL = originalReturnPolicyUrl;
  if (originalPrivacyPolicyUrl === undefined) delete process.env.DROPSHIPPING_PRIVACY_POLICY_URL;
  else process.env.DROPSHIPPING_PRIVACY_POLICY_URL = originalPrivacyPolicyUrl;
  if (originalPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = originalPublicAppUrl;
  if (originalExpoPublicDomain === undefined) delete process.env.EXPO_PUBLIC_DOMAIN;
  else process.env.EXPO_PUBLIC_DOMAIN = originalExpoPublicDomain;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalLiveProductSignalsJson === undefined) delete process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON;
  else process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON = originalLiveProductSignalsJson;
  if (originalLiveProductSignalsPath === undefined) delete process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_PATH;
  else process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_PATH = originalLiveProductSignalsPath;
});

function createProductAndCampaign() {
  const product = researchDropshippingProduct({
    productName: "Foldable travel hanger",
    niche: "travel hacks",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 2.5,
    shippingCostUsd: 1.5,
    targetSellPriceUsd: 18.99,
    estimatedMonthlyDemand: 500,
    competitorPriceUsd: 22,
    supplierRating: 4.7,
    reviewCount: 650,
    shippingDaysMin: 6,
    shippingDaysMax: 12,
    returnPolicy: "Defective returns accepted.",
    evidence: "Travel packing videos show repeatable hook and clear problem.",
    legalRisk: "low",
    qualityRisk: "low",
  }).product;
  const campaign = buildDropshippingMarketingCampaign({
    productId: product.id,
    campaignName: "Travel hanger validation",
    channel: "tiktok",
    objective: "validate_product",
    targetAudience: "frequent travelers and small apartment buyers",
    primaryHook: "This tiny hanger saves luggage space in seconds.",
    offer: "Trial offer with clear shipping and no inventory held.",
    dailyOrganicPosts: 3,
    paidTestBudgetUsd: 0,
    approvalToPublish: false,
    approvalToSpend: false,
  }).campaign;

  return { product, campaign };
}

test("starts as a no-inventory CEO with a 100 dollar budget and 1k target", () => {
  const snapshot = getDropshippingCeoSnapshot();

  assert.equal(snapshot.strategy.model, "dropshipping_sin_inventario");
  assert.equal(snapshot.strategy.startingBudgetUsd, 100);
  assert.equal(snapshot.strategy.targetMonthlyRevenueUsd, 1000);
  assert.equal(snapshot.ceoOperatingPlan.stage, "research");
  assert.equal(snapshot.ceoOperatingPlan.largeCampaignReadiness.status, "locked_until_signal");
  assert.equal(snapshot.growthBoard.status, "research_board");
  assert.equal(snapshot.growthBoard.capitalDoctrine.startingBudgetUsd, 100);
  assert.equal(snapshot.growthBoard.campaignScaleLadder.find((step) => step.stage === "winner_scale")?.status, "locked");
  assert.equal(snapshot.growthBoard.sourceIntelligence.some((source) => source.source.includes("Shopify")), true);
  assert.match(snapshot.strategy.inventoryPolicy, /No comprar stock/);
  assert.equal(snapshot.operatingContract.requiresRobertApproval.includes("gastar dinero"), true);
});

test("product scout builds a starter shortlist without spending budget", () => {
  const result = runDropshippingProductScoutBatch({
    focusNiche: "mixed",
    maxCandidates: 4,
    budgetUsd: 100,
    notes: "Start the first CEO scouting run.",
  });

  assert.equal(result.status, "completed");
  assert.equal(result.spentUsd, 0);
  assert.equal(result.createdCandidates.length, 4);
  assert.equal(result.createdCandidates.some((candidate) => candidate.status === "needs_tiktok_validation"), true);
  assert.equal(result.createdCandidates.every((candidate) => candidate.validation.evidence.some((item) => item.source === "tiktok_search")), true);
  assert.equal(result.topCandidate?.scorecard.pass, true);
  assert.equal(result.snapshot.metrics.productScoutCandidates, 4);
  assert.equal(result.snapshot.metrics.scoutReadyCandidates > 0, true);
});

test("product scout uses live product signals when connected", () => {
  process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON = JSON.stringify({
    signals: [
      {
        candidateName: "Kitchen sink organizer rack",
        source: "tiktok_search",
        status: "verified",
        confidence: "high",
        signal: "Multiple current TikTok demos show problem/solution hooks and purchase comments.",
        evidenceScore: 24,
        demandSignal: "breakout",
        estimatedMonthlyDemand: 1200,
      },
      {
        candidateName: "Kitchen sink organizer rack",
        source: "aliexpress_search",
        status: "verified",
        confidence: "high",
        signal: "Supplier candidates show high reviews, tracking, and faster estimated shipping.",
        evidenceScore: 22,
        supplierRating: 4.8,
        reviewCount: 1800,
        shippingDaysMax: 9,
      },
      {
        candidateName: "Kitchen sink organizer rack",
        source: "google_trends",
        status: "verified",
        confidence: "medium",
        signal: "Search interest is stable enough for organic validation.",
        evidenceScore: 14,
      },
    ],
  });

  const readiness = getDropshippingLiveSignalReadiness();
  assert.equal(readiness.status, "connected");
  assert.equal(readiness.verifiedSignals, 3);

  const result = runDropshippingProductScoutBatch({
    focusNiche: "kitchen_organization",
    maxCandidates: 3,
    budgetUsd: 0,
  });
  const candidate = result.topCandidate;

  assert.equal(candidate?.candidateName, "Kitchen sink organizer rack");
  assert.equal(candidate?.validation.liveValidation.status, "connected");
  assert.equal(candidate?.validation.status, "externally_validated");
  assert.equal(candidate?.validation.evidence.some((item) => item.source === "tiktok_search" && item.status === "verified"), true);
  assert.equal(candidate?.demandSignal, "breakout");
  assert.equal(candidate?.supplierRating, 4.8);
  assert.equal(candidate?.shippingDaysMax, 9);
});

test("live signals require an exact normalized candidate name", () => {
  process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON = JSON.stringify({
    signals: ["tiktok_search", "aliexpress_search", "google_trends"].map((source) => ({
      candidateName: "rack",
      source,
      status: "verified",
      confidence: "high",
      signal: "Evidence for a different generic product name.",
      evidenceScore: 30,
    })),
  });

  const result = runDropshippingProductScoutBatch({
    focusNiche: "kitchen_organization",
    maxCandidates: 3,
    budgetUsd: 0,
  });

  assert.equal(result.topCandidate?.candidateName, "Kitchen sink organizer rack");
  assert.equal(result.topCandidate?.validation.liveValidation.status, "partial");
  assert.equal(result.topCandidate?.validation.liveValidation.signals.length, 0);
  assert.notEqual(result.topCandidate?.validation.status, "externally_validated");
});

test("live signal readiness stays partial without core proof and sanitizes warnings", () => {
  process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON = JSON.stringify({
    signals: [
      {
        candidateName: "Kitchen sink organizer rack",
        source: "manual",
        status: "verified",
        confidence: "high",
        signal: "Manual note alone is not enough to unlock live validation readiness.",
        evidenceScore: 30,
      },
      {
        candidateName: "Kitchen sink organizer rack",
        source: "tiktok_search",
        status: "stale",
        confidence: "high",
        signal: "Old TikTok signal should not count as verified proof.",
        evidenceScore: 24,
      },
    ],
  });
  process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_PATH = "/private/very-sensitive/live-signals.json";

  const readiness = getDropshippingLiveSignalReadiness();

  assert.equal(readiness.status, "partial");
  assert.equal(readiness.configured, true);
  assert.equal(readiness.verifiedSignals, 1);
  assert.equal(readiness.verifiedSources.includes("manual"), true);
  assert.equal(readiness.warnings.includes("live_signals_path_unreadable_or_invalid"), true);
  assert.equal(readiness.warnings.some((warning) => warning.includes("/private/very-sensitive")), false);

  const result = runDropshippingProductScoutBatch({
    focusNiche: "kitchen_organization",
    maxCandidates: 3,
    budgetUsd: 0,
  });

  assert.equal(result.topCandidate?.validation.liveValidation.status, "partial");
  assert.notEqual(result.topCandidate?.validation.status, "externally_validated");
  assert.equal(result.topCandidate?.validation.liveValidation.blockers.some((blocker) => blocker.includes("aliexpress_search")), true);
});

test("product scout candidate can be promoted into formal product research", () => {
  const candidate = createDropshippingProductScoutCandidate({
    candidateName: "Silicone drain protector",
    niche: "home_problem_solvers",
    trendSource: "shopify_2026",
    supplierPlatform: "aliexpress",
    sourceUrl: "https://www.shopify.com/blog/best-dropshipping-products",
    sourceLabel: "Shopify 2026 dropshipping products",
    demandSignal: "strong",
    problemSolved: "Stops visible drain debris with a simple low-ticket home solution.",
    contentAngle: "Before/after cleaning demo that can be filmed in seconds.",
    targetAudience: "renters and home cleaning buyers",
    estimatedProductCostUsd: 1.5,
    estimatedShippingCostUsd: 2,
    targetSellPriceUsd: 12.99,
    competitorPriceUsd: 14.99,
    estimatedMonthlyDemand: 500,
    supplierRating: 4.4,
    reviewCount: 700,
    shippingDaysMin: 7,
    shippingDaysMax: 20,
    legalRisk: "low",
    qualityRisk: "low",
    requiresSample: false,
  }).candidate;

  const result = promoteDropshippingScoutCandidate({
    candidateId: candidate.id,
    approvalToPromote: true,
    notes: "Promote for starter validation.",
  });

  assert.equal(result.candidate.status, "promoted");
  assert.equal(result.product?.productName, "Silicone drain protector");
  assert.equal(result.snapshot.metrics.productsResearched, 1);
  assert.equal(result.snapshot.recentProducts[0].productName, "Silicone drain protector");
});

test("autopilot product hunter prepares one winner package without spending or publishing", () => {
  const result = runDropshippingAutopilotProductHunter({
    focusNiche: "mixed",
    maxCandidates: 5,
    requestedBudgetUsd: 100,
    dailyOrganicPosts: 3,
    postsPerPlatform: 1,
    notes: "Robert wants one best product to approve.",
  });

  assert.equal(result.run.status, "prepared_for_robert_review");
  assert.equal(result.run.safety.spentUsd, 0);
  assert.equal(result.run.safety.publishedExternally, false);
  assert.equal(result.run.safety.inventoryPurchased, false);
  assert.ok(result.product);
  assert.ok(result.supplier);
  assert.ok(result.launchPack);
  assert.equal(result.launchPack?.safety.spentUsd, 0);
  assert.equal(result.launchPack?.safety.publishedExternally, 0);
  assert.equal(result.run.approvalRequired.some((approval) => approval.actionType === "dropshipping.publish_product"), true);
  assert.equal(result.run.approvalRequired.some((approval) => approval.actionType === "dropshipping.spend"), true);
  assert.equal(result.snapshot.metrics.autopilotProductHunterRuns, 1);
  assert.equal(result.snapshot.latestAutopilotProductHunterRun?.winnerProductId, result.product?.id);
  assert.equal(result.snapshot.recentLaunchPacks[0].id, result.launchPack?.id);
});

test("autopilot product hunter ranks only candidates from the requested niche", () => {
  runDropshippingProductScoutBatch({
    focusNiche: "mixed",
    maxCandidates: 5,
    budgetUsd: 0,
  });

  const result = runDropshippingAutopilotProductHunter({
    focusNiche: "pet_supplies",
    maxCandidates: 3,
    requestedBudgetUsd: 100,
    dailyOrganicPosts: 2,
    postsPerPlatform: 1,
  });

  assert.equal(result.run.status, "prepared_for_robert_review");
  assert.equal(result.product?.productName, "Pet water bottle for walks");
  assert.equal(result.run.rankedCandidates[0].candidateName, "Pet water bottle for walks");
  assert.equal(result.run.rankedCandidates.every((candidate) => candidate.candidateName.includes("Pet")), true);
});

test("autopilot winner approval promotes product and prepares launch approvals without spend or sample", () => {
  const result = runDropshippingAutopilotProductHunter({
    focusNiche: "mixed",
    maxCandidates: 5,
    requestedBudgetUsd: 100,
    dailyOrganicPosts: 3,
    postsPerPlatform: 1,
  });

  const decision = recordDropshippingApprovalDecision({
    targetId: result.run.winnerProductId,
    targetType: "product",
    decision: "approved",
    approvedAction: "Approve Autopilot winner for launch",
    maxSpendUsd: 0,
  });
  const preview = prepareDropshippingLaunchPackApprovalQueue({
    launchPackId: result.run.launchPackId,
    includeSpendApproval: false,
    includeSampleApproval: false,
  });

  assert.equal(decision.snapshot.recentProducts.find((product) => product.id === result.run.winnerProductId)?.status, "launch_ready");
  assert.equal(preview.status, "ready");
  assert.equal(preview.requests.some((request) => request.actionType === "dropshipping.create_shopify_draft"), true);
  assert.equal(preview.requests.some((request) => request.actionType === "dropshipping.publish_social"), true);
  assert.equal(preview.requests.some((request) => request.actionType === "dropshipping.spend"), false);
  assert.equal(preview.requests.some((request) => request.actionType === "dropshipping.order_sample"), false);
  assert.equal(result.run.safety.spentUsd, 0);
  assert.equal(result.run.safety.publishedExternally, false);
  assert.equal(result.run.safety.inventoryPurchased, false);
});

test("autopilot winner rejection blocks winner and candidate without queueing launch approvals", () => {
  const result = runDropshippingAutopilotProductHunter({
    focusNiche: "mixed",
    maxCandidates: 5,
    requestedBudgetUsd: 100,
    dailyOrganicPosts: 3,
    postsPerPlatform: 1,
  });

  const decision = recordDropshippingApprovalDecision({
    targetId: result.run.winnerProductId,
    targetType: "product",
    decision: "rejected",
    approvedAction: "Reject Autopilot winner",
    maxSpendUsd: 0,
  });

  const blockedProduct = decision.snapshot.recentProducts.find((product) => product.id === result.run.winnerProductId);
  const rejectedCandidate = decision.snapshot.recentProductScoutCandidates.find((candidate) => candidate.id === result.run.winnerCandidateId);
  assert.equal(blockedProduct?.status, "blocked");
  assert.equal(rejectedCandidate?.status, "rejected");
  assert.equal(decision.snapshot.metrics.localApprovalOutbox, 0);
  assert.equal(result.run.safety.spentUsd, 0);
  assert.equal(result.run.safety.publishedExternally, false);
  assert.equal(result.run.safety.inventoryPurchased, false);
});

test("launch pack blocks safely when no product exists", () => {
  const result = buildDropshippingLaunchPack({
    mode: "starter_validation",
    requestedBudgetUsd: 0,
  });

  assert.equal(result.launchPack.status, "needs_product");
  assert.equal(result.launchPack.safety.spentUsd, 0);
  assert.equal(result.launchPack.socialPosts.length, 0);
  assert.equal(result.launchPack.launchChecklist.some((item) => item.owner === "Product Scout"), true);
  assert.equal(result.snapshot.metrics.launchPacks, 1);
});

test("launch pack prepares safe organic launch assets without external spend", () => {
  const { product } = createProductAndCampaign();

  const result = buildDropshippingLaunchPack({
    productId: product.id,
    mode: "starter_validation",
    dailyOrganicPosts: 3,
    platforms: ["tiktok", "instagram"],
    postsPerPlatform: 1,
    requestedBudgetUsd: 0,
    approvalToPrepareDraft: false,
    approvalToPublish: false,
    approvalToSpend: false,
  });

  assert.equal(result.launchPack.status, "approval_required");
  assert.equal(result.launchPack.launchPlan?.productId, product.id);
  assert.equal(result.launchPack.campaign?.productId, product.id);
  assert.equal(result.launchPack.socialPosts.length, 2);
  assert.equal(result.launchPack.socialPosts.every((post) => post.status === "approval_required"), true);
  assert.equal(result.launchPack.shopifyPreflight?.dryRun, true);
  assert.equal(result.launchPack.safety.spentUsd, 0);
  assert.equal(result.launchPack.safety.publishedExternally, 0);
  assert.equal(result.launchPack.safety.inventoryPurchased, false);
  assert.equal(result.launchPack.capitalPlan?.requestedCampaignEnvelopeUsd, 0);
  assert.equal(result.snapshot.metrics.launchPacks, 1);
  assert.equal(result.snapshot.metrics.socialPosts, 2);
});

test("launch pack approval queue prepares pending actions without auto-approving spend or samples", () => {
  const { product } = createProductAndCampaign();
  const pack = buildDropshippingLaunchPack({
    productId: product.id,
    mode: "starter_validation",
    dailyOrganicPosts: 3,
    platforms: ["tiktok", "instagram"],
    postsPerPlatform: 1,
    requestedBudgetUsd: 100,
    approvalToPrepareDraft: false,
    approvalToPublish: false,
    approvalToSpend: false,
  }).launchPack;

  const preview = prepareDropshippingLaunchPackApprovalQueue({ launchPackId: pack.id });

  assert.equal(preview.status, "ready");
  assert.equal(preview.requests.some((request) => request.actionType === "dropshipping.publish_product"), true);
  assert.equal(preview.requests.some((request) => request.actionType === "dropshipping.create_shopify_draft"), true);
  assert.equal(preview.requests.some((request) => request.actionType === "dropshipping.publish_social"), true);
  assert.equal(preview.requests.some((request) => request.actionType === "dropshipping.spend"), false);
  assert.equal(preview.skipped.some((item) => item.includes("Spend approval omitido")), true);
  assert.equal(preview.guardrails.some((item) => item.includes("no ejecuta")), true);
});

test("launch pack approval outbox saves local fallback without duplicating requests", () => {
  const { product } = createProductAndCampaign();
  const pack = buildDropshippingLaunchPack({
    productId: product.id,
    mode: "starter_validation",
    dailyOrganicPosts: 3,
    platforms: ["tiktok", "instagram"],
    postsPerPlatform: 1,
    requestedBudgetUsd: 100,
    approvalToPrepareDraft: false,
    approvalToPublish: false,
    approvalToSpend: false,
  }).launchPack;
  const preview = prepareDropshippingLaunchPackApprovalQueue({ launchPackId: pack.id });

  const first = recordDropshippingApprovalOutboxRequests(preview.requests, "Postgres unavailable in local dev.");
  const second = recordDropshippingApprovalOutboxRequests(preview.requests, "Postgres still unavailable.");

  assert.equal(first.status, "saved_local_outbox");
  assert.equal(first.queued.length, preview.requests.length);
  assert.equal(first.queued.every((item) => item.status === "pending_local" && item.queuedExternally === false), true);
  assert.equal(first.queued.some((item) => item.actionType === "dropshipping.spend"), false);
  assert.equal(second.status, "duplicates_only");
  assert.equal(second.duplicates.length, preview.requests.length);
  assert.equal(second.snapshot.metrics.localApprovalOutbox, preview.requests.length);
  assert.equal(buildDropshippingDailyReport("morning").includes("Approval outbox local"), true);
});

test("approval outbox migration dry run and mark queued keep actions gated", () => {
  const { product } = createProductAndCampaign();
  const pack = buildDropshippingLaunchPack({
    productId: product.id,
    mode: "starter_validation",
    dailyOrganicPosts: 3,
    platforms: ["tiktok", "instagram"],
    postsPerPlatform: 1,
    requestedBudgetUsd: 100,
    approvalToPrepareDraft: false,
    approvalToPublish: false,
    approvalToSpend: false,
  }).launchPack;
  const preview = prepareDropshippingLaunchPackApprovalQueue({ launchPackId: pack.id });
  const outbox = recordDropshippingApprovalOutboxRequests(preview.requests, "Postgres unavailable in local dev.");

  const dryRun = prepareDropshippingApprovalOutboxMigration({ dryRun: true });
  assert.equal(dryRun.status, "ready");
  assert.equal(dryRun.items.length, preview.requests.length);
  assert.equal(dryRun.snapshot.metrics.localApprovalOutbox, preview.requests.length);

  const marked = markDropshippingApprovalOutboxQueued(outbox.queued.map((item, index) => ({
    id: item.id,
    pendingActionId: `pending-${index + 1}`,
  })));
  const after = prepareDropshippingApprovalOutboxMigration({ dryRun: true });

  assert.equal(marked.status, "marked");
  assert.equal(marked.marked.every((item) => item.status === "queued_in_trust_center"), true);
  assert.equal(marked.marked.every((item) => item.queuedExternally === true), true);
  assert.equal(marked.pendingLocalCount, 0);
  assert.equal(after.status, "empty");
  assert.equal(after.snapshot.metrics.localApprovalOutbox, 0);
});

test("exposes dedicated marketing CMO department with subagents", () => {
  const snapshot = getDropshippingCeoSnapshot();

  assert.equal(snapshot.marketingDepartment.cmoAgent.id, "marketing-cmo");
  assert.equal(snapshot.marketingDepartment.cmoAgent.reportsTo, "Dropshipping CEO");
  assert.equal(snapshot.marketingDepartment.subagents.some((agent) => agent.id === "hook-copywriter"), true);
  assert.equal(snapshot.marketingDepartment.subagents.some((agent) => agent.id === "ads-strategist"), true);
  assert.equal(snapshot.marketingDepartment.subagents.some((agent) => agent.id === "brand-legal-safety"), true);
  assert.equal(snapshot.marketingDepartment.operatingModel.requiresApproval.includes("gastar en ads"), true);
  assert.equal(snapshot.agents.some((agent) => agent.id === "marketing-cmo"), true);
});

test("execution setup stays safe and manual without external credentials", () => {
  const result = getDropshippingExecutionSetup();
  const shopify = result.executionSetup.connectors.find((connector) => connector.id === "shopify");
  const social = result.executionSetup.connectors.find((connector) => connector.id === "social_publisher");
  const supplier = result.executionSetup.connectors.find((connector) => connector.id === "supplier_ops");
  const approvals = result.executionSetup.connectors.find((connector) => connector.id === "approvals");

  assert.equal(result.executionSetup.status, "needs_setup");
  assert.equal(shopify?.mode, "dry_run");
  assert.equal(shopify?.missingEnv.includes("SHOPIFY_SHOP_DOMAIN"), true);
  assert.equal(social?.mode, "manual");
  assert.equal(supplier?.status, "ready");
  assert.equal(approvals?.missingEnv.includes("DATABASE_URL"), true);
  assert.match(result.executionSetup.supplierOps.fulfillmentPolicy, /No comprar stock/);
});

test("execution setup becomes ready for dry run when external readiness markers exist", () => {
  process.env.SHOPIFY_SHOP_DOMAIN = "example.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
  process.env.TELEGRAM_BOT_TOKEN = "telegram_test";
  process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL = "https://publisher.example/webhook";
  process.env.DROPSHIPPING_SUPPLIER_EXECUTION_MODE = "dsers";
  process.env.DROPSHIPPING_SUPPLIER_PORTAL_URL = "https://www.dsers.com/";
  process.env.STORE_PAYMENT_PROCESSOR = "shopify_payments";
  process.env.DROPSHIPPING_RETURN_POLICY_URL = "https://store.example/returns";
  process.env.DROPSHIPPING_PRIVACY_POLICY_URL = "https://store.example/privacy";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/blackops_test";

  const result = getDropshippingExecutionSetup();
  const shopify = result.executionSetup.connectors.find((connector) => connector.id === "shopify");
  const social = result.executionSetup.connectors.find((connector) => connector.id === "social_publisher");
  const supplier = result.executionSetup.connectors.find((connector) => connector.id === "supplier_ops");
  const approvals = result.executionSetup.connectors.find((connector) => connector.id === "approvals");

  assert.equal(result.executionSetup.status, "ready_for_dry_run");
  assert.equal(shopify?.status, "ready");
  assert.equal(shopify?.mode, "api");
  assert.equal(social?.mode, "webhook");
  assert.equal(supplier?.status, "ready");
  assert.equal(approvals?.status, "ready");
  assert.equal(result.executionSetup.launchSequence.every((step) => step.blockedUntil.length === 0), true);
});

test("execution setup accepts Metricool as social publisher readiness", () => {
  process.env.METRICOOL_USER_TOKEN = "metricool_token";
  process.env.METRICOOL_USER_ID = "12345";
  process.env.METRICOOL_MCP_URL = "https://ai.metricool.com/mcp";

  const result = getDropshippingExecutionSetup();
  const social = result.executionSetup.connectors.find((connector) => connector.id === "social_publisher");

  assert.equal(social?.status, "ready");
  assert.equal(social?.mode, "metricool_mcp");
  assert.equal(social?.missingEnv.length, 0);
});

test("snapshot readiness card accepts Metricool social publisher", () => {
  process.env.METRICOOL_USER_TOKEN = "metricool_token";
  process.env.METRICOOL_USER_ID = "12345";

  const snapshot = getDropshippingCeoSnapshot();
  const socialReadiness = snapshot.readiness.find((item) => item.id === "social_publisher");

  assert.equal(socialReadiness?.status, "ready");
  assert.match(socialReadiness?.detail || "", /Metricool MCP listo/);
});

test("execution setup derives dropshipping policy URLs from public app URL", () => {
  process.env.PUBLIC_APP_URL = "https://robplanner.replit.app";
  process.env.STORE_PAYMENT_PROCESSOR = "shopify_payments";

  const result = getDropshippingExecutionSetup();
  const paymentsTax = result.executionSetup.connectors.find((connector) => connector.id === "payments_tax");

  assert.equal(paymentsTax?.status, "ready");
  assert.equal(paymentsTax?.missingEnv.length, 0);
  assert.equal(paymentsTax?.evidence.some((item) => item.includes("https://robplanner.replit.app/dropshipping/legal/refund-policy")), true);
  assert.equal(paymentsTax?.evidence.some((item) => item.includes("https://robplanner.replit.app/dropshipping/legal/privacy")), true);
});

test("launch readiness separates pre-account work from real checkout blockers", () => {
  const readiness = getDropshippingLaunchReadiness().launchReadiness;

  assert.equal(readiness.status, "blocked_needs_accounts");
  assert.equal(readiness.postgresTrustCenter.status, "needs_database");
  assert.equal(readiness.checkout.status, "draft_ready");
  assert.equal(readiness.budgetLimits.startingMonthlyBudgetUsd, 100);
  assert.equal(readiness.budgetLimits.dailySpendCapUsd, 10);
  assert.equal(readiness.canDoNow.some((item) => item.includes("investigando productos")), true);
  assert.equal(readiness.requiresConnectedAccounts.some((item) => item.includes("Shopify")), true);
});

test("launch readiness becomes ready for test order after accounts and validation markers exist", () => {
  process.env.SHOPIFY_SHOP_DOMAIN = "example.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
  process.env.TELEGRAM_BOT_TOKEN = "telegram_test";
  process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL = "https://publisher.example/webhook";
  process.env.STORE_PAYMENT_PROCESSOR = "shopify_payments";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/blackops_test";

  const product = researchDropshippingProduct({
    productName: "Pet water bottle for walks",
    niche: "pet supplies",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 5,
    shippingCostUsd: 2,
    targetSellPriceUsd: 24.99,
    estimatedMonthlyDemand: 800,
    competitorPriceUsd: 29.99,
    supplierRating: 4.8,
    reviewCount: 1800,
    shippingDaysMin: 7,
    shippingDaysMax: 14,
    returnPolicy: "Supplier supports damaged-item returns.",
    evidence: "Walking/pet problem is visible and easy to explain in short video.",
    legalRisk: "low",
    qualityRisk: "low",
  }).product;

  reviewDropshippingSupplier({
    supplierName: "AliExpress Pet Supplier",
    platform: "aliexpress",
    productName: product.productName,
    rating: 4.8,
    reviewCount: 1800,
    ordersCount: 5000,
    shipsFrom: "China",
    estimatedShippingDays: 12,
    hasTracking: true,
    hasReturns: true,
    hasMultipleSuppliers: true,
  });

  const readiness = getDropshippingLaunchReadiness().launchReadiness;

  assert.equal(readiness.status, "ready_for_test_order");
  assert.equal(readiness.postgresTrustCenter.status, "ready");
  assert.equal(readiness.checkout.status, "ready_for_test_order");
  assert.equal(readiness.productSupplier.supplierReviewed, true);
  assert.equal(readiness.automation.status, "ready");
});

test("researches a viral product and keeps launch actions behind approval", () => {
  const result = researchDropshippingProduct({
    productName: "Mini portable lint remover",
    niche: "productos virales",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 4,
    shippingCostUsd: 2,
    targetSellPriceUsd: 24.99,
    estimatedMonthlyDemand: 600,
    competitorPriceUsd: 29.99,
    supplierRating: 4.7,
    reviewCount: 900,
    shippingDaysMin: 7,
    shippingDaysMax: 14,
    returnPolicy: "Supplier accepts returns for damaged products.",
    evidence: "Multiple TikTok cleaning videos show this product solving a simple visible problem.",
    legalRisk: "low",
    qualityRisk: "medium",
    requiresSample: true,
  });

  assert.equal(result.product.economics.grossMarginPercent >= 60, true);
  assert.equal(result.product.status, "sample_recommended");
  assert.equal(result.product.requiredApprovals.includes("aprobar compra de 1 muestra antes de escalar"), true);
  assert.equal(result.snapshot.metrics.approvalQueue, 1);
});

test("approval decision promotes an approved product to launch ready", () => {
  const product = researchDropshippingProduct({
    productName: "Mini portable lint remover",
    niche: "productos virales",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 4,
    shippingCostUsd: 2,
    targetSellPriceUsd: 24.99,
    estimatedMonthlyDemand: 600,
    competitorPriceUsd: 29.99,
    supplierRating: 4.7,
    reviewCount: 900,
    shippingDaysMin: 7,
    shippingDaysMax: 14,
    returnPolicy: "Supplier accepts returns for damaged products.",
    evidence: "Multiple TikTok cleaning videos show this product solving a simple visible problem.",
    legalRisk: "low",
    qualityRisk: "low",
  }).product;

  const result = recordDropshippingApprovalDecision({
    targetId: product.id,
    targetType: "product",
    decision: "approved",
    approvedAction: "Approve product for launch",
    maxSpendUsd: 0,
  });

  assert.equal(result.snapshot.recentProducts[0].status, "launch_ready");
  assert.equal(result.snapshot.metrics.approvalQueue, 0);
});

test("approval decision can reject or request changes on a product", () => {
  const rejectedProduct = researchDropshippingProduct({
    productName: "Risky skincare mask",
    niche: "productos virales",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 3,
    shippingCostUsd: 2,
    targetSellPriceUsd: 19.99,
    estimatedMonthlyDemand: 300,
    competitorPriceUsd: 24.99,
    supplierRating: 4.2,
    reviewCount: 200,
    shippingDaysMin: 8,
    shippingDaysMax: 18,
    evidence: "Needs Robert review before launch.",
    legalRisk: "medium",
    qualityRisk: "medium",
  }).product;

  const rejected = recordDropshippingApprovalDecision({
    targetId: rejectedProduct.id,
    targetType: "product",
    decision: "rejected",
    approvedAction: "Reject winner and run another scout",
    maxSpendUsd: 0,
  });

  assert.equal(rejected.snapshot.recentProducts.find((product) => product.id === rejectedProduct.id)?.status, "blocked");

  const changesProduct = researchDropshippingProduct({
    productName: "Adjustable pet leash light",
    niche: "productos virales",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 5,
    shippingCostUsd: 3,
    targetSellPriceUsd: 24.99,
    estimatedMonthlyDemand: 450,
    competitorPriceUsd: 29.99,
    supplierRating: 4.4,
    reviewCount: 500,
    shippingDaysMin: 7,
    shippingDaysMax: 16,
    evidence: "Pet walking videos show demand, but supplier needs backup.",
    legalRisk: "low",
    qualityRisk: "medium",
  }).product;

  const needsChanges = recordDropshippingApprovalDecision({
    targetId: changesProduct.id,
    targetType: "product",
    decision: "needs_changes",
    approvedAction: "Need supplier backup before launch",
    maxSpendUsd: 0,
  });

  const updated = needsChanges.snapshot.recentProducts.find((product) => product.id === changesProduct.id);
  assert.equal(updated?.status, "approval_required");
  assert.equal(updated?.requiredApprovals.includes("resolver cambios pedidos por Robert antes de launch"), true);
});

test("blocks bad economics before launch", () => {
  const result = researchDropshippingProduct({
    productName: "Heavy fragile lamp",
    niche: "productos virales",
    trendSource: "manual",
    supplierPlatform: "manual",
    productCostUsd: 20,
    shippingCostUsd: 15,
    targetSellPriceUsd: 25,
    estimatedMonthlyDemand: 50,
    competitorPriceUsd: 25,
    supplierRating: 3.5,
    reviewCount: 20,
    shippingDaysMin: 15,
    shippingDaysMax: 45,
    returnPolicy: "",
    evidence: "Manual idea with weak supplier data.",
    legalRisk: "medium",
    qualityRisk: "high",
  });

  assert.equal(result.product.status, "blocked");
  assert.equal(result.product.subagentReviews.some((review) => review.verdict === "block"), true);
});

test("supplier review requires backup or blocks weak suppliers", () => {
  const review = reviewDropshippingSupplier({
    supplierName: "AliExpress Store 123",
    platform: "aliexpress",
    productName: "Mini portable lint remover",
    rating: 4.6,
    reviewCount: 800,
    ordersCount: 1200,
    shipsFrom: "China",
    estimatedShippingDays: 12,
    hasTracking: true,
    hasReturns: true,
    hasMultipleSuppliers: false,
  });

  assert.equal(review.supplier.status, "approved_candidate");
  assert.equal(review.supplier.riskFlags.includes("falta proveedor backup"), true);
});

test("launch plan never publishes without approval", () => {
  const product = researchDropshippingProduct({
    productName: "Magnetic cable organizer",
    niche: "productos virales",
    trendSource: "instagram",
    supplierPlatform: "dsers",
    productCostUsd: 3,
    shippingCostUsd: 1,
    targetSellPriceUsd: 19.99,
    estimatedMonthlyDemand: 400,
    competitorPriceUsd: 21.99,
    supplierRating: 4.8,
    reviewCount: 700,
    shippingDaysMin: 5,
    shippingDaysMax: 12,
    returnPolicy: "Returns accepted for defective product.",
    evidence: "Desk setup videos show clear use case.",
    legalRisk: "low",
    qualityRisk: "low",
  }).product;

  const plan = buildDropshippingLaunchPlan({
    productId: product.id,
    storeChannel: "shopify_social",
    dailyOrganicPosts: 3,
    paidAdTestBudgetUsd: 20,
    approvalToPublish: false,
    approvalToSpend: false,
  });

  assert.equal(plan.launchPlan.status, "blocked");
  assert.equal(plan.launchPlan.gatedActions.includes("publicar producto en Shopify"), true);
});

test("profit guard blocks approval spend beyond cash and budget", () => {
  recordDropshippingLedgerEntry({
    kind: "expense",
    label: "Sample test",
    amountUsd: 95,
    cashCollectedUsd: 0,
    notes: "One sample plus shipping.",
  });

  const result = recordDropshippingApprovalDecision({
    targetId: "manual",
    targetType: "expense",
    decision: "approved",
    approvedAction: "Run first paid ad test",
    maxSpendUsd: 10,
  });

  assert.equal(result.decision.guardrail.status, "blocked");
  assert.match(result.decision.guardrail.reason, /excede|Profit Guard/);
});

test("learning review recommends scale only after real signal", () => {
  const review = recordDropshippingLearningReview({
    periodLabel: "dia 1",
    postsPublished: 4,
    visitors: 300,
    addToCarts: 18,
    orders: 5,
    revenueUsd: 125,
    spendUsd: 0,
    refundsUsd: 0,
    bestHook: "Esto ordena tu setup en 5 segundos",
  });

  assert.equal(review.review.decisionStatus, "scale_content");
  assert.equal(review.review.nextBatch.maxProducts, 3);
});

test("budget ladder can move beyond 100 only after real revenue signal", () => {
  recordDropshippingLedgerEntry({
    kind: "sale",
    label: "First validation sales",
    amountUsd: 300,
    cashCollectedUsd: 300,
    notes: "Cash collected before asking for larger tests.",
  });
  recordDropshippingLearningReview({
    periodLabel: "validation week",
    postsPublished: 8,
    visitors: 600,
    addToCarts: 40,
    orders: 6,
    revenueUsd: 300,
    spendUsd: 0,
    refundsUsd: 0,
    bestHook: "Tiny travel fix",
  });

  const snapshot = getDropshippingCeoSnapshot();

  assert.equal(snapshot.budgetPolicy.stage, "validation_250");
  assert.equal(snapshot.budgetPolicy.activeMonthlyBudgetUsd, 250);
  assert.equal(snapshot.ceoOperatingPlan.stage, "research");
  assert.equal(snapshot.ceoOperatingPlan.campaignPortfolio.some((campaign) => campaign.id === "winner-scale"), true);
  assert.equal(snapshot.profitGuard.canSpendUsd <= snapshot.budgetPolicy.maxSingleTestUsd, true);
});

test("growth sprint starts with 100 budget and no external spend before a product exists", () => {
  const result = buildDropshippingGrowthSprint({
    focus: "first_100_validation",
    days: 7,
    requestedBudgetUsd: 100,
    approvalToPrepareSpend: true,
  });

  assert.equal(result.growthSprint.status, "needs_product");
  assert.equal(result.growthSprint.budgetEnvelope.requestedBudgetUsd, 100);
  assert.equal(result.growthSprint.budgetEnvelope.approvedToRiskUsd, 0);
  assert.equal(result.growthSprint.budgetEnvelope.spendMode, "organic_only");
  assert.equal(result.growthSprint.campaignCalendar.length, 7);
  assert.equal(result.growthSprint.campaignCalendar.every((day) => day.budgetUsd === 0), true);
  assert.equal(result.growthSprint.subagentOrders.some((order) => order.owner === "Product Scout"), true);
  assert.equal(result.snapshot.metrics.growthSprints, 1);
});

test("CEO operating plan unlocks larger campaigns only after growth signals", () => {
  const product = researchDropshippingProduct({
    productName: "Compact sink caddy",
    niche: "home organization",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 6,
    shippingCostUsd: 4,
    targetSellPriceUsd: 20,
    estimatedMonthlyDemand: 50,
    competitorPriceUsd: 24,
    supplierRating: 4,
    reviewCount: 120,
    shippingDaysMin: 12,
    shippingDaysMax: 25,
    returnPolicy: "Defective returns accepted.",
    evidence: "Kitchen organization content shows visible before and after.",
    legalRisk: "medium",
    qualityRisk: "low",
  }).product;
  recordDropshippingApprovalDecision({
    targetId: product.id,
    targetType: "product",
    decision: "approved",
    approvedAction: "Approve product for larger campaign planning",
    maxSpendUsd: 0,
  });
  const campaign = buildDropshippingMarketingCampaign({
    productId: product.id,
    campaignName: "Sink caddy growth",
    channel: "tiktok",
    objective: "scale_winner",
    targetAudience: "small apartment buyers",
    primaryHook: "This compact caddy clears the sink in seconds.",
    offer: "Clear price and shipping with supplier fulfillment.",
    dailyOrganicPosts: 3,
    paidTestBudgetUsd: 0,
    approvalToPublish: true,
    approvalToSpend: false,
  }).campaign;
  const post = createDropshippingSocialPostBatch({
    campaignId: campaign.id,
    platforms: ["tiktok"],
    postsPerPlatform: 1,
    approvalToPublish: true,
  }).posts[0];
  recordDropshippingLedgerEntry({
    kind: "sale",
    label: "Growth signal sales",
    amountUsd: 800,
    cashCollectedUsd: 800,
    notes: "Enough real sales to move beyond starter stage.",
  });
  recordDropshippingSocialMetrics({
    postId: post.id,
    views: 6000,
    clicks: 420,
    addToCarts: 60,
    orders: 14,
    revenueUsd: 800,
    spendUsd: 0,
    notes: "Winning post with repeatable sales.",
  });

  const snapshot = getDropshippingCeoSnapshot();
  const winnerScale = snapshot.ceoOperatingPlan.campaignPortfolio.find((item) => item.id === "winner-scale");

  assert.equal(snapshot.budgetPolicy.stage, "growth_500");
  assert.equal(snapshot.ceoOperatingPlan.stage, "scale");
  assert.equal(snapshot.ceoOperatingPlan.largeCampaignReadiness.status, "ready_after_approval");
  assert.equal(snapshot.growthBoard.status, "scale_ready");
  assert.equal(snapshot.growthBoard.capitalDoctrine.canRiskNowUsd <= snapshot.budgetPolicy.maxSingleTestUsd, true);
  assert.equal(snapshot.growthBoard.campaignScaleLadder.find((item) => item.stage === "winner_scale")?.status, "ready_after_approval");
  assert.equal(snapshot.growthBoard.approvalRequests.some((request) => request.actionType === "dropshipping.spend" && request.maxSpendUsd <= snapshot.budgetPolicy.maxSingleTestUsd), true);
  assert.equal((winnerScale?.spendCapUsd || 0) > 0, true);
  assert.match(snapshot.ceoOperatingPlan.nextExecutiveDecision, /approval|hook|pagado|paid/i);
});

test("growth sprint prepares a large campaign only as a controlled tranche after growth signals", () => {
  const product = researchDropshippingProduct({
    productName: "Compact sink caddy",
    niche: "home organization",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 6,
    shippingCostUsd: 4,
    targetSellPriceUsd: 20,
    estimatedMonthlyDemand: 50,
    competitorPriceUsd: 24,
    supplierRating: 4,
    reviewCount: 120,
    shippingDaysMin: 12,
    shippingDaysMax: 25,
    returnPolicy: "Defective returns accepted.",
    evidence: "Kitchen organization content shows visible before and after.",
    legalRisk: "medium",
    qualityRisk: "low",
  }).product;
  recordDropshippingApprovalDecision({
    targetId: product.id,
    targetType: "product",
    decision: "approved",
    approvedAction: "Approve product for growth sprint",
    maxSpendUsd: 0,
  });
  const campaign = buildDropshippingMarketingCampaign({
    productId: product.id,
    campaignName: "Sink caddy scale sprint",
    channel: "facebook_ads",
    objective: "scale_winner",
    targetAudience: "small apartment buyers",
    primaryHook: "This compact caddy clears the sink in seconds.",
    offer: "Clear price and shipping with supplier fulfillment.",
    dailyOrganicPosts: 3,
    paidTestBudgetUsd: 0,
    approvalToPublish: true,
    approvalToSpend: false,
  }).campaign;
  const post = createDropshippingSocialPostBatch({
    campaignId: campaign.id,
    platforms: ["tiktok"],
    postsPerPlatform: 1,
    approvalToPublish: true,
  }).posts[0];
  recordDropshippingLedgerEntry({
    kind: "sale",
    label: "Growth sprint sales",
    amountUsd: 900,
    cashCollectedUsd: 900,
    notes: "Real signal before large campaign sprint.",
  });
  recordDropshippingSocialMetrics({
    postId: post.id,
    views: 8000,
    clicks: 550,
    addToCarts: 80,
    orders: 15,
    revenueUsd: 900,
    spendUsd: 0,
    notes: "Repeatable demand.",
  });

  const result = buildDropshippingGrowthSprint({
    focus: "scale_winner",
    days: 7,
    requestedBudgetUsd: 500,
    approvalToPrepareSpend: true,
  });

  assert.equal(result.growthSprint.status, "ready");
  assert.equal(result.growthSprint.budgetEnvelope.stage, "growth_500");
  assert.equal(result.growthSprint.budgetEnvelope.requestedBudgetUsd, 500);
  assert.equal(result.growthSprint.budgetEnvelope.approvedToRiskUsd > 0, true);
  assert.equal(result.growthSprint.budgetEnvelope.approvedToRiskUsd <= result.snapshot.budgetPolicy.maxSingleTestUsd, true);
  assert.equal(result.growthSprint.budgetEnvelope.spendMode, "scale_plan_only");
  assert.equal(result.growthSprint.boardApprovals.some((approval) => approval.actionType === "dropshipping.spend"), true);
  assert.equal(result.growthSprint.scaleRules.scale.some((rule) => rule.includes("growth_500")), true);
});

test("capital allocator blocks a 500 dollar campaign while still at starter budget", () => {
  const { campaign } = createProductAndCampaign();

  const result = buildDropshippingCapitalPlan({
    campaignId: campaign.id,
    objective: "scale_winner",
    requestedBudgetUsd: 500,
    approvalToPrepareLargeCampaign: true,
  });

  assert.equal(result.capitalPlan.status, "blocked");
  assert.equal(result.capitalPlan.approvedInitialBudgetUsd, 0);
  assert.equal(result.capitalPlan.stageGate.requiredSignals.some((signal) => signal.includes("budget activo")), true);
  assert.equal(result.snapshot.metrics.capitalPlans, 1);
});

test("capital allocator prepares a larger campaign envelope after real growth signals", () => {
  const product = researchDropshippingProduct({
    productName: "Compact sink caddy",
    niche: "home organization",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 6,
    shippingCostUsd: 4,
    targetSellPriceUsd: 20,
    estimatedMonthlyDemand: 800,
    competitorPriceUsd: 24,
    supplierRating: 4.8,
    reviewCount: 900,
    shippingDaysMin: 7,
    shippingDaysMax: 14,
    returnPolicy: "Defective returns accepted.",
    evidence: "Kitchen organization content shows visible before and after.",
    legalRisk: "low",
    qualityRisk: "low",
  }).product;
  recordDropshippingApprovalDecision({
    targetId: product.id,
    targetType: "product",
    decision: "approved",
    approvedAction: "Approve product for larger campaign planning",
    maxSpendUsd: 0,
  });
  const campaign = buildDropshippingMarketingCampaign({
    productId: product.id,
    campaignName: "Sink caddy scale",
    channel: "facebook_ads",
    objective: "scale_winner",
    targetAudience: "small apartment buyers",
    primaryHook: "This compact caddy clears the sink in seconds.",
    offer: "Clear price and shipping with supplier fulfillment.",
    dailyOrganicPosts: 5,
    paidTestBudgetUsd: 0,
    approvalToPublish: true,
    approvalToSpend: false,
  }).campaign;
  recordDropshippingLedgerEntry({
    kind: "sale",
    label: "Growth signal sales",
    amountUsd: 900,
    cashCollectedUsd: 900,
    notes: "Enough cash to request a larger campaign envelope.",
  });
  recordDropshippingLearningReview({
    periodLabel: "growth week",
    postsPublished: 12,
    visitors: 900,
    addToCarts: 80,
    orders: 15,
    revenueUsd: 900,
    spendUsd: 0,
    refundsUsd: 0,
    bestHook: "Clear the sink in seconds",
  });

  const result = buildDropshippingCapitalPlan({
    campaignId: campaign.id,
    objective: "scale_winner",
    requestedBudgetUsd: 500,
    approvalToPrepareLargeCampaign: true,
  });
  const allocatedUsd = Number(result.capitalPlan.allocation.reduce((sum, item) => sum + item.budgetUsd, 0).toFixed(2));

  assert.equal(result.capitalPlan.status, "ready_after_approval");
  assert.equal(result.capitalPlan.activeStage, "growth_500");
  assert.equal(result.capitalPlan.requestedCampaignEnvelopeUsd, 500);
  assert.equal(result.capitalPlan.approvedInitialBudgetUsd > 0, true);
  assert.equal(result.capitalPlan.approvedInitialBudgetUsd <= result.capitalPlan.maxSingleTestUsd, true);
  assert.equal(allocatedUsd, result.capitalPlan.approvedInitialBudgetUsd);
  assert.equal(result.capitalPlan.approvalsRequired.some((approval) => approval.includes("envelope")), true);
});

test("marketing campaign creates drafts and keeps publish or spend behind approval", () => {
  const product = researchDropshippingProduct({
    productName: "Foldable travel hanger",
    niche: "travel hacks",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 2.5,
    shippingCostUsd: 1.5,
    targetSellPriceUsd: 18.99,
    estimatedMonthlyDemand: 500,
    competitorPriceUsd: 22,
    supplierRating: 4.7,
    reviewCount: 650,
    shippingDaysMin: 6,
    shippingDaysMax: 12,
    returnPolicy: "Defective returns accepted.",
    evidence: "Travel packing videos show repeatable hook and clear problem.",
    legalRisk: "low",
    qualityRisk: "low",
  }).product;

  const result = buildDropshippingMarketingCampaign({
    productId: product.id,
    campaignName: "Travel hanger validation",
    channel: "tiktok",
    objective: "validate_product",
    targetAudience: "frequent travelers and small apartment buyers",
    primaryHook: "This tiny hanger saves luggage space in seconds.",
    offer: "Trial offer with clear shipping and no inventory held.",
    dailyOrganicPosts: 3,
    paidTestBudgetUsd: 10,
    approvalToPublish: false,
    approvalToSpend: false,
  });

  assert.equal(result.campaign.status, "approval_required");
  assert.equal(result.campaign.budgetPlan.approvedSpendUsd, 0);
  assert.equal(result.campaign.socialDrafts.length, 3);
  assert.equal(result.campaign.requiredApprovals.some((item) => item.includes("paid test")), true);
});

test("social post batch creates approval-required drafts from a campaign", () => {
  const { campaign } = createProductAndCampaign();

  const result = createDropshippingSocialPostBatch({
    campaignId: campaign.id,
    platforms: ["tiktok", "instagram"],
    postsPerPlatform: 2,
    approvalToPublish: false,
  });

  assert.equal(result.posts.length, 4);
  assert.equal(result.posts.every((post) => post.status === "approval_required"), true);
  assert.equal(result.snapshot.metrics.socialPosts, 4);
  assert.equal(result.snapshot.metrics.approvalQueue >= 4, true);
});

test("social publish without approval is blocked and never calls webhook", async () => {
  const { campaign } = createProductAndCampaign();
  const post = createDropshippingSocialPostBatch({
    campaignId: campaign.id,
    platforms: ["tiktok"],
    postsPerPlatform: 1,
    approvalToPublish: false,
  }).posts[0];
  let called = false;
  const fetchMock = async () => {
    called = true;
    throw new Error("should not publish without approval");
  };

  const result = await publishDropshippingSocialPost({
    postId: post.id,
    approvalToPublish: false,
    dryRun: false,
  }, fetchMock as typeof fetch);

  assert.equal(called, false);
  assert.equal(result.published, false);
  assert.equal(result.post?.status, "approval_required");
  assert.match(result.guardrail.reason, /approval/);
});

test("social publish dry run queues an approved post without network", async () => {
  const { campaign } = createProductAndCampaign();
  const post = createDropshippingSocialPostBatch({
    campaignId: campaign.id,
    platforms: ["instagram"],
    postsPerPlatform: 1,
    approvalToPublish: true,
  }).posts[0];
  let called = false;
  const fetchMock = async () => {
    called = true;
    throw new Error("dry run should not call fetch");
  };

  const result = await publishDropshippingSocialPost({
    postId: post.id,
    approvalToPublish: true,
    dryRun: true,
  }, fetchMock as typeof fetch);

  assert.equal(called, false);
  assert.equal(result.published, false);
  assert.equal(result.post?.status, "queued");
  assert.equal(result.post?.publishResult.mode, "dry_run");
});

test("social metrics analysis identifies a winning hook", () => {
  const { campaign } = createProductAndCampaign();
  const post = createDropshippingSocialPostBatch({
    campaignId: campaign.id,
    platforms: ["tiktok"],
    postsPerPlatform: 1,
    approvalToPublish: true,
  }).posts[0];

  recordDropshippingSocialMetrics({
    postId: post.id,
    views: 1200,
    likes: 80,
    comments: 12,
    shares: 9,
    clicks: 96,
    addToCarts: 12,
    orders: 4,
    revenueUsd: 75.96,
    spendUsd: 0,
    notes: "Organic post produced first orders.",
  });
  const result = analyzeDropshippingSocialPerformance({ periodLabel: "dia 1", campaignId: campaign.id });

  assert.equal(result.analysis.status, "scale_content");
  assert.equal(result.analysis.winningPlatform, "tiktok");
  assert.equal(result.analysis.winningHook.length > 0, true);
  assert.equal(result.snapshot.metrics.socialOrders, 4);
});

test("paid order records revenue, profit estimate, and fulfillment approval queue", () => {
  const { product } = createProductAndCampaign();

  const result = recordDropshippingOrder({
    source: "shopify",
    externalOrderId: "1001",
    productId: product.id,
    productName: product.productName,
    quantity: 1,
    saleSubtotalUsd: 18.99,
    productCostUsd: 0,
    supplierShippingUsd: 0,
    paymentStatus: "paid",
  });

  assert.equal(result.order.status, "approval_required");
  assert.equal(result.order.ledgerEntryId.length > 0, true);
  assert.equal(result.order.estimatedCostUsd, 4);
  assert.equal(result.snapshot.metrics.orders, 1);
  assert.equal(result.snapshot.metrics.paidOrders, 1);
  assert.equal(result.snapshot.metrics.orderRevenueUsd, 18.99);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 18.99);
  assert.equal(result.snapshot.metrics.approvalQueue >= 1, true);
});

test("fulfillment without approval remains approval required", () => {
  const { product } = createProductAndCampaign();
  const order = recordDropshippingOrder({
    source: "shopify",
    externalOrderId: "1002",
    productId: product.id,
    productName: product.productName,
    quantity: 1,
    saleSubtotalUsd: 18.99,
    productCostUsd: 0,
    supplierShippingUsd: 0,
    paymentStatus: "paid",
  }).order;

  const result = prepareDropshippingFulfillment({
    orderId: order.id,
    supplierName: "AliExpress supplier",
    supplierPlatform: "aliexpress",
    approvalToFulfill: false,
    dryRun: false,
  });

  assert.equal(result.action.status, "approval_required");
  assert.equal(result.action.guardrail.missing.includes("approval de Robert para fulfillment"), true);
  assert.equal(result.snapshot.metrics.fulfillmentActions, 1);
  assert.equal(result.snapshot.metrics.unfulfilledOrders, 1);
});

test("approved fulfillment dry run prepares supplier action without marking fulfilled", () => {
  const { product } = createProductAndCampaign();
  const order = recordDropshippingOrder({
    source: "shopify",
    externalOrderId: "1003",
    productId: product.id,
    productName: product.productName,
    quantity: 1,
    saleSubtotalUsd: 18.99,
    productCostUsd: 0,
    supplierShippingUsd: 0,
    paymentStatus: "paid",
  }).order;

  const result = prepareDropshippingFulfillment({
    orderId: order.id,
    supplierName: "AliExpress supplier",
    supplierPlatform: "aliexpress",
    approvalToFulfill: true,
    dryRun: true,
  });

  assert.equal(result.action.status, "preflight");
  assert.equal(result.action.guardrail.status, "ready");
  assert.equal(result.snapshot.recentOrders[0].status, "approval_required");
});

test("approved manual fulfillment records tracking and completes order", () => {
  const { product } = createProductAndCampaign();
  const order = recordDropshippingOrder({
    source: "shopify",
    externalOrderId: "1004",
    productId: product.id,
    productName: product.productName,
    quantity: 1,
    saleSubtotalUsd: 18.99,
    productCostUsd: 0,
    supplierShippingUsd: 0,
    paymentStatus: "paid",
  }).order;

  const result = prepareDropshippingFulfillment({
    orderId: order.id,
    supplierName: "AliExpress supplier",
    supplierPlatform: "aliexpress",
    supplierOrderId: "AE-1004",
    trackingNumber: "TRACK1004",
    approvalToFulfill: true,
    dryRun: false,
  });

  assert.equal(result.action.status, "manual_fulfillment_recorded");
  assert.equal(result.snapshot.recentOrders[0].status, "fulfilled");
  assert.equal(result.snapshot.metrics.unfulfilledOrders, 0);
});

test("CEO cycle drafts organic campaign without spending when cash is not available", () => {
  const product = researchDropshippingProduct({
    productName: "Cable label clips",
    niche: "desk setup",
    trendSource: "instagram",
    supplierPlatform: "dsers",
    productCostUsd: 2,
    shippingCostUsd: 1,
    targetSellPriceUsd: 16.99,
    estimatedMonthlyDemand: 450,
    competitorPriceUsd: 19.99,
    supplierRating: 4.8,
    reviewCount: 800,
    shippingDaysMin: 5,
    shippingDaysMax: 11,
    returnPolicy: "Returns accepted for damaged clips.",
    evidence: "Desk setup videos repeatedly show messy cable problem.",
    legalRisk: "low",
    qualityRisk: "low",
  }).product;

  const result = runDropshippingCeoCycle({ mode: "daily", forcePaidTest: true });

  assert.equal(result.cycle.generatedCampaignIds.length, 1);
  assert.equal(result.cycle.generatedPostIds.length, 2);
  assert.match(result.cycle.summary, new RegExp(product.productName));
  assert.equal(result.snapshot.recentMarketingCampaigns[0].budgetPlan.requestedSpendUsd, 0);
  assert.equal(result.snapshot.metrics.socialPosts, 2);
  assert.equal(result.snapshot.metrics.ceoCycles, 1);
});

test("daily operating cycle prepares safe work and report without external actions", () => {
  researchDropshippingProduct({
    productName: "Cable label clips",
    niche: "desk setup",
    trendSource: "instagram",
    supplierPlatform: "dsers",
    productCostUsd: 2,
    shippingCostUsd: 1,
    targetSellPriceUsd: 16.99,
    estimatedMonthlyDemand: 450,
    competitorPriceUsd: 19.99,
    supplierRating: 4.8,
    reviewCount: 800,
    shippingDaysMin: 5,
    shippingDaysMax: 11,
    returnPolicy: "Returns accepted for damaged clips.",
    evidence: "Desk setup videos repeatedly show messy cable problem.",
    legalRisk: "low",
    qualityRisk: "low",
  });

  const result = runDropshippingDailyOperatingCycle();

  assert.equal(result.status, "completed");
  assert.equal(result.safety.externalActionsBlocked, true);
  assert.equal(result.safety.spentUsd, 0);
  assert.equal(result.safety.publishedExternally, 0);
  assert.equal(result.cycle.generatedCampaignIds.length, 1);
  assert.equal(result.cycle.generatedPostIds.length, 2);
  assert.match(result.reportPreview, /Dropshipping CEO - Reporte AM/);
});

test("Shopify preflight blocks draft creation without approval and credentials", () => {
  const product = researchDropshippingProduct({
    productName: "Countertop bag sealer",
    niche: "kitchen hacks",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 5,
    shippingCostUsd: 2,
    targetSellPriceUsd: 24.99,
    estimatedMonthlyDemand: 500,
    competitorPriceUsd: 29.99,
    supplierRating: 4.7,
    reviewCount: 900,
    shippingDaysMin: 7,
    shippingDaysMax: 14,
    returnPolicy: "Defective returns accepted.",
    evidence: "Kitchen videos show simple repeated use case.",
    legalRisk: "low",
    qualityRisk: "low",
  }).product;

  const result = preflightDropshippingShopifyDraft({
    productId: product.id,
    approvalToCreateDraft: false,
    dryRun: true,
  });

  assert.equal(result.draft.status, "blocked");
  assert.equal(result.draft.guardrail.missing.includes("SHOPIFY_SHOP_DOMAIN"), true);
  assert.equal(result.draft.guardrail.missing.includes("approval de Robert para crear draft externo"), true);
});

test("Shopify draft dry run never calls network even when ready", async () => {
  process.env.SHOPIFY_SHOP_DOMAIN = "example.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
  process.env.SHOPIFY_API_VERSION = "2026-04";
  const product = researchDropshippingProduct({
    productName: "Mini travel steamer",
    niche: "travel hacks",
    trendSource: "instagram",
    supplierPlatform: "dsers",
    productCostUsd: 8,
    shippingCostUsd: 2,
    targetSellPriceUsd: 39.99,
    estimatedMonthlyDemand: 400,
    competitorPriceUsd: 45,
    supplierRating: 4.8,
    reviewCount: 1000,
    shippingDaysMin: 5,
    shippingDaysMax: 12,
    returnPolicy: "Damaged returns accepted.",
    evidence: "Travel content shows clear wrinkle problem.",
    legalRisk: "low",
    qualityRisk: "low",
  }).product;
  let called = false;
  const fetchMock = async () => {
    called = true;
    throw new Error("should not call fetch in dry run");
  };

  const result = await createDropshippingShopifyDraft({
    productId: product.id,
    approvalToCreateDraft: true,
    dryRun: true,
  }, fetchMock as typeof fetch);

  assert.equal(called, false);
  assert.equal(result.created, false);
  assert.equal(result.draft.status, "preflight");
  assert.equal(result.draft.productCreateInput.status, "DRAFT");
});

test("Shopify draft creation sends DRAFT productCreate when approved", async () => {
  process.env.SHOPIFY_SHOP_DOMAIN = "example.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
  process.env.SHOPIFY_API_VERSION = "2026-04";
  const product = researchDropshippingProduct({
    productName: "Magnetic spice clips",
    niche: "kitchen organization",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 3,
    shippingCostUsd: 1,
    targetSellPriceUsd: 19.99,
    estimatedMonthlyDemand: 500,
    competitorPriceUsd: 24.99,
    supplierRating: 4.9,
    reviewCount: 1300,
    shippingDaysMin: 6,
    shippingDaysMax: 12,
    returnPolicy: "Defective returns accepted.",
    evidence: "Organization videos show visible before and after.",
    legalRisk: "low",
    qualityRisk: "low",
  }).product;
  let requestUrl = "";
  let requestBody: { variables?: { product?: { status?: string; title?: string } } } = {};
  const fetchMock = async (url: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({
      data: {
        productCreate: {
          product: { id: "gid://shopify/Product/123", title: product.productName, handle: "magnetic-spice-clips", status: "DRAFT" },
          userErrors: [],
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await createDropshippingShopifyDraft({
    productId: product.id,
    approvalToCreateDraft: true,
    dryRun: false,
  }, fetchMock as typeof fetch);

  assert.equal(result.created, true);
  assert.match(requestUrl, /example\.myshopify\.com\/admin\/api\/2026-04\/graphql\.json/);
  assert.equal(requestBody.variables?.product?.status, "DRAFT");
  assert.equal(requestBody.variables?.product?.title, product.productName);
  assert.equal(result.draft.shopifyProductId, "gid://shopify/Product/123");
});

test("daily report summarizes CEO next command", () => {
  const report = buildDropshippingDailyReport("morning");

  assert.match(report, /Dropshipping CEO - Reporte AM/);
  assert.match(report, /Meta:/);
  assert.match(report, /Plan CEO:/);
  assert.match(report, /Campanas:/);
  assert.match(report, /Posts:/);
  assert.match(report, /Marketing learnings:/);
  assert.match(report, /Shopify drafts:/);
  assert.match(report, /Ordenes:/);
  assert.match(report, /Fulfillment:/);
  assert.match(report, /Capital plan:/);
  assert.match(report, /Siguiente comando:/);
});
