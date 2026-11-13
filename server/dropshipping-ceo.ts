import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { mirrorOfficeSourceFile } from "./office-source-document-sync";
import { storage } from "./storage";
import { sendTelegramPlainMessage } from "./telegram";
import { getMetricoolConfigStatus } from "./metricool-tracking";

function envMoney(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name] || fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

function envFlag(name: string, fallback = true) {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

const STARTING_MONTHLY_BUDGET_USD = envMoney("DROPSHIPPING_STARTING_MONTHLY_BUDGET_USD", 100, 0, 10000);
const TARGET_MONTHLY_REVENUE_USD = envMoney("DROPSHIPPING_TARGET_MONTHLY_REVENUE_USD", 1000, 1, 1000000);
const DAILY_SPEND_CAP_USD = envMoney("DROPSHIPPING_DAILY_SPEND_CAP_USD", 10, 0, 5000);
const REQUIRE_APPROVALS_FOR_EXTERNAL_ACTIONS = envFlag("DROPSHIPPING_REQUIRE_APPROVALS_FOR_EXTERNAL_ACTIONS", true);
const REQUIRE_SAMPLE_BEFORE_SCALE = envFlag("DROPSHIPPING_REQUIRE_SAMPLE_BEFORE_SCALE", true);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

const liveProductSignalSourceSchema = z.enum([
  "tiktok_creative_center",
  "tiktok_search",
  "aliexpress_search",
  "google_trends",
  "amazon_search",
  "competitor_scan",
  "shopify_trends",
  "manual",
]);

const liveProductSignalStatusSchema = z.enum(["verified", "needs_review", "stale", "error"]);

const liveProductSignalSchema = z.object({
  candidateName: z.string().trim().min(2).max(160),
  source: liveProductSignalSourceSchema,
  label: z.string().trim().max(180).optional().default(""),
  url: z.string().trim().max(500).optional().default(""),
  status: liveProductSignalStatusSchema.default("verified"),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  observedAt: z.string().trim().max(80).optional().default(""),
  signal: z.string().trim().min(2).max(500),
  evidenceScore: z.coerce.number().min(0).max(30).default(10),
  demandSignal: z.enum(["weak", "medium", "strong", "breakout"]).optional(),
  estimatedMonthlyDemand: z.coerce.number().int().min(0).max(100000).optional(),
  supplierRating: z.coerce.number().min(0).max(5).optional(),
  reviewCount: z.coerce.number().int().min(0).max(1000000).optional(),
  shippingDaysMax: z.coerce.number().int().min(1).max(180).optional(),
  competitorPriceUsd: z.coerce.number().min(0).max(100000).optional(),
  legalRisk: z.enum(["low", "medium", "high"]).optional(),
  qualityRisk: z.enum(["low", "medium", "high"]).optional(),
});

type DropshippingLiveProductSignal = z.infer<typeof liveProductSignalSchema>;
type DropshippingLiveProductSignalSource = z.infer<typeof liveProductSignalSourceSchema>;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export const dropshippingProductResearchSchema = z.object({
  productName: z.string().trim().min(2).max(160),
  niche: z.string().trim().min(2).max(120).default("productos virales"),
  trendSource: z.enum(["tiktok", "instagram", "amazon", "google_trends", "manual"]).default("tiktok"),
  supplierPlatform: z.enum(["aliexpress", "cj_dropshipping", "dsers", "zendrop", "spocket", "manual"]).default("aliexpress"),
  productCostUsd: z.coerce.number().min(0).max(10000),
  shippingCostUsd: z.coerce.number().min(0).max(10000).default(0),
  targetSellPriceUsd: z.coerce.number().min(1).max(100000),
  estimatedMonthlyDemand: z.coerce.number().int().min(0).max(100000).default(100),
  competitorPriceUsd: z.coerce.number().min(0).max(100000).default(0),
  supplierRating: z.coerce.number().min(0).max(5).default(4),
  reviewCount: z.coerce.number().int().min(0).max(1000000).default(100),
  shippingDaysMin: z.coerce.number().int().min(1).max(120).default(7),
  shippingDaysMax: z.coerce.number().int().min(1).max(180).default(21),
  returnPolicy: z.string().trim().max(600).optional().default(""),
  evidence: z.string().trim().min(3).max(1500),
  legalRisk: z.enum(["low", "medium", "high"]).default("medium"),
  qualityRisk: z.enum(["low", "medium", "high"]).default("medium"),
  requiresSample: z.coerce.boolean().default(false),
});

export type DropshippingProductResearchInput = z.infer<typeof dropshippingProductResearchSchema>;

export const dropshippingProductScoutCandidateSchema = z.object({
  candidateName: z.string().trim().min(2).max(160),
  niche: z.string().trim().min(2).max(120).default("productos virales"),
  trendSource: z.enum(["shopify_2026", "tiktok", "instagram", "amazon", "google_trends", "aliexpress", "manual"]).default("manual"),
  supplierPlatform: z.enum(["aliexpress", "cj_dropshipping", "dsers", "zendrop", "spocket", "manual"]).default("aliexpress"),
  sourceUrl: z.string().trim().max(500).optional().default(""),
  sourceLabel: z.string().trim().max(180).optional().default(""),
  demandSignal: z.enum(["weak", "medium", "strong", "breakout"]).default("medium"),
  problemSolved: z.string().trim().min(3).max(500),
  contentAngle: z.string().trim().min(3).max(500),
  targetAudience: z.string().trim().min(3).max(300).default("compradores impulsivos que quieren resolver un problema visible"),
  estimatedProductCostUsd: z.coerce.number().min(0).max(10000),
  estimatedShippingCostUsd: z.coerce.number().min(0).max(10000).default(0),
  targetSellPriceUsd: z.coerce.number().min(1).max(100000),
  competitorPriceUsd: z.coerce.number().min(0).max(100000).default(0),
  estimatedMonthlyDemand: z.coerce.number().int().min(0).max(100000).default(100),
  supplierRating: z.coerce.number().min(0).max(5).default(4),
  reviewCount: z.coerce.number().int().min(0).max(1000000).default(100),
  shippingDaysMin: z.coerce.number().int().min(1).max(120).default(7),
  shippingDaysMax: z.coerce.number().int().min(1).max(180).default(21),
  legalRisk: z.enum(["low", "medium", "high"]).default("medium"),
  qualityRisk: z.enum(["low", "medium", "high"]).default("medium"),
  requiresSample: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingProductScoutCandidateInput = z.infer<typeof dropshippingProductScoutCandidateSchema>;

export const dropshippingProductScoutBatchSchema = z.object({
  focusNiche: z.enum(["mixed", "home_problem_solvers", "kitchen_organization", "car_accessories", "pet_supplies", "beauty_low_claims"]).default("mixed"),
  maxCandidates: z.coerce.number().int().min(1).max(8).default(4),
  budgetUsd: z.coerce.number().min(0).max(10000).default(STARTING_MONTHLY_BUDGET_USD),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingProductScoutBatchInput = z.infer<typeof dropshippingProductScoutBatchSchema>;

export const dropshippingProductScoutPromotionSchema = z.object({
  candidateId: z.string().trim().min(1).max(200),
  approvalToPromote: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingProductScoutPromotionInput = z.infer<typeof dropshippingProductScoutPromotionSchema>;

export const dropshippingAutopilotProductHunterSchema = z.object({
  focusNiche: z.enum(["mixed", "home_problem_solvers", "kitchen_organization", "car_accessories", "pet_supplies", "beauty_low_claims"]).default("mixed"),
  maxCandidates: z.coerce.number().int().min(3).max(8).default(5),
  requestedBudgetUsd: z.coerce.number().min(0).max(STARTING_MONTHLY_BUDGET_USD).default(0),
  dailyOrganicPosts: z.coerce.number().int().min(1).max(10).default(3),
  postsPerPlatform: z.coerce.number().int().min(1).max(4).default(1),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingAutopilotProductHunterInput = z.infer<typeof dropshippingAutopilotProductHunterSchema>;

export const dropshippingSupplierReviewSchema = z.object({
  supplierName: z.string().trim().min(2).max(160),
  platform: z.enum(["aliexpress", "cj_dropshipping", "dsers", "zendrop", "spocket", "manual"]).default("aliexpress"),
  productName: z.string().trim().min(2).max(160),
  rating: z.coerce.number().min(0).max(5).default(4),
  reviewCount: z.coerce.number().int().min(0).max(1000000).default(100),
  ordersCount: z.coerce.number().int().min(0).max(1000000).default(100),
  shipsFrom: z.string().trim().max(120).default("China"),
  estimatedShippingDays: z.coerce.number().int().min(1).max(180).default(21),
  hasTracking: z.coerce.boolean().default(true),
  hasReturns: z.coerce.boolean().default(false),
  hasMultipleSuppliers: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingSupplierReviewInput = z.infer<typeof dropshippingSupplierReviewSchema>;

export const dropshippingLaunchPlanSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  storeChannel: z.enum(["shopify_social", "shopify_tiktok", "research_only"]).default("shopify_social"),
  dailyOrganicPosts: z.coerce.number().int().min(0).max(20).default(3),
  paidAdTestBudgetUsd: z.coerce.number().min(0).max(1000).default(0),
  approvalToPublish: z.coerce.boolean().default(false),
  approvalToSpend: z.coerce.boolean().default(false),
  approvalToOrderSample: z.coerce.boolean().default(false),
});

export type DropshippingLaunchPlanInput = z.infer<typeof dropshippingLaunchPlanSchema>;

export const dropshippingLedgerEntrySchema = z.object({
  kind: z.enum(["sale", "expense", "refund", "sample_order"]),
  label: z.string().trim().min(2).max(180),
  productId: z.string().trim().max(200).optional().default(""),
  amountUsd: z.coerce.number().min(0).max(1000000),
  cashCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type DropshippingLedgerEntryInput = z.infer<typeof dropshippingLedgerEntrySchema>;

export const dropshippingApprovalDecisionSchema = z.object({
  targetId: z.string().trim().min(1).max(200),
  targetType: z.enum(["product", "supplier", "launch_plan", "marketing_campaign", "expense", "social_post", "order", "fulfillment", "sample_order", "manual"]),
  decision: z.enum(["approved", "rejected", "needs_changes"]),
  approvedAction: z.string().trim().min(2).max(500),
  maxSpendUsd: z.coerce.number().min(0).max(5000).default(0),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type DropshippingApprovalDecisionInput = z.infer<typeof dropshippingApprovalDecisionSchema>;

export const dropshippingLearningReviewSchema = z.object({
  periodLabel: z.string().trim().min(2).max(80).default("hoy"),
  productId: z.string().trim().max(200).optional().default(""),
  postsPublished: z.coerce.number().int().min(0).max(10000).default(0),
  visitors: z.coerce.number().int().min(0).max(1000000).default(0),
  addToCarts: z.coerce.number().int().min(0).max(1000000).default(0),
  orders: z.coerce.number().int().min(0).max(1000000).default(0),
  revenueUsd: z.coerce.number().min(0).max(1000000).default(0),
  spendUsd: z.coerce.number().min(0).max(1000000).default(0),
  refundsUsd: z.coerce.number().min(0).max(1000000).default(0),
  bestHook: z.string().trim().max(300).optional().default(""),
  biggestProblem: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingLearningReviewInput = z.infer<typeof dropshippingLearningReviewSchema>;

export const dropshippingMarketingCampaignSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  campaignName: z.string().trim().min(2).max(180).default("Validation campaign"),
  channel: z.enum(["tiktok", "instagram", "facebook_ads", "google_shopping", "email", "shopify_seo", "manual"]).default("tiktok"),
  objective: z.enum(["validate_product", "organic_reach", "collect_sales", "retarget", "scale_winner"]).default("validate_product"),
  targetAudience: z.string().trim().min(2).max(300).default("compradores impulsivos que quieren resolver un problema diario"),
  primaryHook: z.string().trim().min(2).max(300).default("Resuelve este problema diario sin comprar inventario."),
  offer: z.string().trim().min(2).max(300).default("Oferta de prueba con proveedor validado y checkout claro."),
  dailyOrganicPosts: z.coerce.number().int().min(0).max(20).default(3),
  paidTestBudgetUsd: z.coerce.number().min(0).max(5000).default(0),
  approvalToPublish: z.coerce.boolean().default(false),
  approvalToSpend: z.coerce.boolean().default(false),
});

export type DropshippingMarketingCampaignInput = z.infer<typeof dropshippingMarketingCampaignSchema>;

export const dropshippingCeoCycleSchema = z.object({
  mode: z.enum(["daily", "product_validation", "scale_winner"]).default("daily"),
  forcePaidTest: z.coerce.boolean().default(false),
});

export type DropshippingCeoCycleInput = z.infer<typeof dropshippingCeoCycleSchema>;

export const dropshippingShopifyDraftSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  campaignId: z.string().trim().max(200).optional().default(""),
  vendor: z.string().trim().min(2).max(120).default("Dropshipping CEO"),
  productType: z.string().trim().min(2).max(120).default("Dropshipping validation"),
  approvalToCreateDraft: z.coerce.boolean().default(false),
  dryRun: z.coerce.boolean().default(true),
});

export type DropshippingShopifyDraftInput = z.infer<typeof dropshippingShopifyDraftSchema>;

const dropshippingSocialPlatformSchema = z.enum(["tiktok", "instagram", "facebook", "youtube_shorts", "pinterest", "email", "manual"]);
const dropshippingSocialFormatSchema = z.enum(["short_video", "reel", "story", "carousel", "pin", "email", "manual"]);

export const dropshippingSocialPostBatchSchema = z.object({
  campaignId: z.string().trim().min(1).max(200),
  platforms: z.array(dropshippingSocialPlatformSchema).min(1).max(6).default(["tiktok", "instagram"]),
  postsPerPlatform: z.coerce.number().int().min(1).max(10).default(2),
  approvalToPublish: z.coerce.boolean().default(false),
  scheduledDate: z.string().trim().max(40).optional().default(""),
});

export type DropshippingSocialPostBatchInput = z.infer<typeof dropshippingSocialPostBatchSchema>;

export const dropshippingLaunchPackSchema = z.object({
  productId: z.string().trim().max(200).optional().default(""),
  mode: z.enum(["starter_validation", "organic_launch", "scale_candidate"]).default("starter_validation"),
  dailyOrganicPosts: z.coerce.number().int().min(1).max(20).default(3),
  platforms: z.array(dropshippingSocialPlatformSchema).min(1).max(6).default(["tiktok", "instagram"]),
  postsPerPlatform: z.coerce.number().int().min(1).max(10).default(1),
  requestedBudgetUsd: z.coerce.number().min(0).max(10000).default(0),
  approvalToPrepareDraft: z.coerce.boolean().default(false),
  approvalToPublish: z.coerce.boolean().default(false),
  approvalToSpend: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingLaunchPackInput = z.infer<typeof dropshippingLaunchPackSchema>;

export const dropshippingLaunchPackApprovalQueueSchema = z.object({
  launchPackId: z.string().trim().max(200).optional().default(""),
  includeSpendApproval: z.coerce.boolean().default(false),
  includeSampleApproval: z.coerce.boolean().default(false),
});

export type DropshippingLaunchPackApprovalQueueInput = z.infer<typeof dropshippingLaunchPackApprovalQueueSchema>;

export const dropshippingApprovalOutboxMigrationSchema = z.object({
  dryRun: z.coerce.boolean().default(true),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  itemIds: z.array(z.string().trim().min(1).max(220)).optional().default([]),
});

export type DropshippingApprovalOutboxMigrationInput = z.infer<typeof dropshippingApprovalOutboxMigrationSchema>;

export const dropshippingSocialPublishSchema = z.object({
  postId: z.string().trim().min(1).max(200),
  approvalToPublish: z.coerce.boolean().default(false),
  dryRun: z.coerce.boolean().default(true),
  externalPostUrl: z.string().trim().max(500).optional().default(""),
});

export type DropshippingSocialPublishInput = z.infer<typeof dropshippingSocialPublishSchema>;

export const dropshippingSocialMetricsSchema = z.object({
  postId: z.string().trim().min(1).max(200),
  platform: dropshippingSocialPlatformSchema.optional(),
  impressions: z.coerce.number().int().min(0).max(100000000).default(0),
  views: z.coerce.number().int().min(0).max(100000000).default(0),
  likes: z.coerce.number().int().min(0).max(100000000).default(0),
  comments: z.coerce.number().int().min(0).max(100000000).default(0),
  shares: z.coerce.number().int().min(0).max(100000000).default(0),
  clicks: z.coerce.number().int().min(0).max(100000000).default(0),
  addToCarts: z.coerce.number().int().min(0).max(100000000).default(0),
  orders: z.coerce.number().int().min(0).max(100000000).default(0),
  revenueUsd: z.coerce.number().min(0).max(100000000).default(0),
  spendUsd: z.coerce.number().min(0).max(100000000).default(0),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingSocialMetricsInput = z.infer<typeof dropshippingSocialMetricsSchema>;

export const dropshippingSocialAnalysisSchema = z.object({
  periodLabel: z.string().trim().min(2).max(80).default("hoy"),
  campaignId: z.string().trim().max(200).optional().default(""),
});

export type DropshippingSocialAnalysisInput = z.infer<typeof dropshippingSocialAnalysisSchema>;

export const dropshippingOrderSchema = z.object({
  source: z.enum(["shopify", "manual", "tiktok_shop", "social_dm", "other"]).default("manual"),
  externalOrderId: z.string().trim().max(200).optional().default(""),
  productId: z.string().trim().max(200).optional().default(""),
  productName: z.string().trim().min(2).max(160),
  customerAlias: z.string().trim().max(120).optional().default(""),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  saleSubtotalUsd: z.coerce.number().min(0).max(1000000),
  shippingChargedUsd: z.coerce.number().min(0).max(1000000).default(0),
  taxCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  productCostUsd: z.coerce.number().min(0).max(1000000).default(0),
  supplierShippingUsd: z.coerce.number().min(0).max(1000000).default(0),
  paymentStatus: z.enum(["paid", "pending", "refunded", "chargeback"]).default("paid"),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingOrderInput = z.infer<typeof dropshippingOrderSchema>;

export const dropshippingFulfillmentSchema = z.object({
  orderId: z.string().trim().min(1).max(200),
  supplierName: z.string().trim().min(2).max(160).default("Manual supplier"),
  supplierPlatform: z.enum(["aliexpress", "cj_dropshipping", "dsers", "zendrop", "spocket", "manual"]).default("manual"),
  supplierOrderId: z.string().trim().max(200).optional().default(""),
  trackingNumber: z.string().trim().max(200).optional().default(""),
  trackingUrl: z.string().trim().max(500).optional().default(""),
  approvalToFulfill: z.coerce.boolean().default(false),
  dryRun: z.coerce.boolean().default(true),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingFulfillmentInput = z.infer<typeof dropshippingFulfillmentSchema>;

export const dropshippingCapitalPlanSchema = z.object({
  campaignId: z.string().trim().max(200).optional().default(""),
  objective: z.enum(["protect_cash", "validate_winner", "scale_winner", "retarget_customers"]).default("validate_winner"),
  requestedBudgetUsd: z.coerce.number().min(0).max(10000).default(STARTING_MONTHLY_BUDGET_USD),
  approvalToPrepareLargeCampaign: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingCapitalPlanInput = z.infer<typeof dropshippingCapitalPlanSchema>;

export const dropshippingGrowthSprintSchema = z.object({
  focus: z.enum(["first_100_validation", "validate_winner", "scale_winner", "prepare_large_campaign"]).default("first_100_validation"),
  days: z.coerce.number().int().min(3).max(14).default(7),
  requestedBudgetUsd: z.coerce.number().min(0).max(10000).default(STARTING_MONTHLY_BUDGET_USD),
  approvalToPrepareSpend: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DropshippingGrowthSprintInput = z.infer<typeof dropshippingGrowthSprintSchema>;

type DropshippingProduct = DropshippingProductResearchInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "research" | "qualified" | "approval_required" | "sample_recommended" | "launch_ready" | "blocked";
  economics: ReturnType<typeof calculateProductEconomics>;
  scorecard: ReturnType<typeof buildProductScorecard>;
  subagentReviews: Array<{ agent: string; verdict: "pass" | "fix" | "block"; note: string }>;
  requiredApprovals: string[];
  nextActions: string[];
};

type DropshippingProductScoutCandidate = DropshippingProductScoutCandidateInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "seed_candidate" | "needs_tiktok_validation" | "needs_supplier" | "ready_for_research" | "shortlisted" | "promoted" | "rejected";
  validation: {
    status: "seed_only" | "needs_external_validation" | "externally_validated";
    confidence: "low" | "medium" | "high";
    evidenceScore: number;
    evidence: Array<{
      source: DropshippingLiveProductSignalSource;
      label: string;
      url: string;
      status: "seed_reference" | "needs_review" | "verified" | "stale" | "error";
      signal: string;
    }>;
    missingProof: string[];
    liveValidation: {
      status: "not_connected" | "partial" | "connected";
      connectedSources: DropshippingLiveProductSignalSource[];
      verifiedSources: DropshippingLiveProductSignalSource[];
      liveScore: number;
      scoreBonus: number;
      scorePenalty: number;
      signals: DropshippingLiveProductSignal[];
      blockers: string[];
      updatedAt: string;
    };
  };
  scorecard: {
    total: number;
    grade: "A" | "B" | "C" | "D";
    components: {
      marginScore: number;
      demandScore: number;
      contentScore: number;
      supplierScore: number;
      riskScore: number;
      liveSignalScore: number;
    };
    pass: boolean;
  };
  economics: {
    landedCostUsd: number;
    grossProfitUsd: number;
    grossMarginPercent: number;
    breakEvenOrdersAtBudget: number | null;
    ordersNeededForTargetRevenue: number;
  };
  researchInput: DropshippingProductResearchInput;
  nextActions: string[];
  promotedProductId: string;
};

type DropshippingAutopilotProductHunterRun = DropshippingAutopilotProductHunterInput & {
  id: string;
  createdAt: string;
  status: "prepared_for_robert_review" | "blocked_no_candidate";
  winnerCandidateId: string;
  winnerProductId: string;
  supplierId: string;
  launchPackId: string;
  confidence: "low" | "medium" | "high";
  summary: string;
  rankedCandidates: Array<{
    candidateId: string;
    candidateName: string;
    rank: number;
    score: number;
    confidence: "low" | "medium" | "high";
    evidenceScore: number;
    reason: string;
  }>;
  approvalRequired: Array<{
    actionType: "dropshipping.publish_product" | "dropshipping.create_shopify_draft" | "dropshipping.publish_social" | "dropshipping.spend" | "dropshipping.order_sample";
    title: string;
    reason: string;
    maxSpendUsd: number;
  }>;
  nextActions: string[];
  safety: {
    spentUsd: number;
    publishedExternally: boolean;
    inventoryPurchased: boolean;
    message: string;
  };
};

type DropshippingSupplierReview = DropshippingSupplierReviewInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "approved_candidate" | "needs_backup_supplier" | "blocked";
  score: number;
  riskFlags: string[];
  nextActions: string[];
};

type DropshippingLaunchPlan = DropshippingLaunchPlanInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "draft_only" | "approval_required" | "ready_after_approval" | "blocked";
  product: DropshippingProduct | null;
  contentCalendar: Array<{ day: string; channel: string; hook: string; status: "draft" | "needs_approval" }>;
  gatedActions: string[];
  nextActions: string[];
};

type DropshippingLedgerEntry = DropshippingLedgerEntryInput & {
  id: string;
  createdAt: string;
};

type DropshippingApprovalDecision = DropshippingApprovalDecisionInput & {
  id: string;
  createdAt: string;
  guardrail: { status: "recorded" | "blocked"; reason: string };
};

type DropshippingLearningReview = DropshippingLearningReviewInput & {
  id: string;
  createdAt: string;
  decisionStatus: "scale_content" | "iterate_small" | "pause_and_fix";
  metrics: {
    conversionRatePercent: number;
    addToCartRatePercent: number;
    profitUsd: number;
    roiPercent: number;
  };
  playbookUpdates: string[];
  nextBatch: { maxProducts: number; maxSpendUsd: number; requiredBeforeNextAction: string[] };
};

type DropshippingMarketingCampaign = DropshippingMarketingCampaignInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "draft_only" | "approval_required" | "ready_after_approval" | "blocked";
  product: DropshippingProduct | null;
  budgetPlan: {
    organicFirst: boolean;
    requestedSpendUsd: number;
    approvedSpendUsd: number;
    breakEvenOrders: number | null;
    guardrail: string;
  };
  creativeBrief: {
    productPromise: string;
    landingPageDraft: string[];
    riskChecks: string[];
  };
  socialDrafts: Array<{ day: string; channel: string; hook: string; caption: string; status: "draft" | "needs_approval" }>;
  requiredApprovals: string[];
  nextActions: string[];
};

type DropshippingCeoCycle = DropshippingCeoCycleInput & {
  id: string;
  createdAt: string;
  status: "research" | "approval_review" | "campaign_drafted" | "blocked";
  focus: string;
  summary: string;
  commands: string[];
  generatedCampaignIds: string[];
  generatedPostIds: string[];
  approvalRequests: string[];
  metricsSnapshot: {
    productsResearched: number;
    approvalQueue: number;
    totalRevenueUsd: number;
    totalSpendUsd: number;
    profitUsd: number;
    canSpendUsd: number;
  };
};

type DropshippingShopifyDraft = DropshippingShopifyDraftInput & {
  id: string;
  createdAt: string;
  status: "preflight" | "draft_created" | "blocked" | "failed";
  product: DropshippingProduct | null;
  campaign: DropshippingMarketingCampaign | null;
  shopifyProductId: string;
  shopifyHandle: string;
  productCreateInput: Record<string, unknown>;
  guardrail: { status: "ready" | "blocked"; reason: string; missing: string[] };
  userErrors: Array<{ field: string[]; message: string }>;
  nextActions: string[];
};

type DropshippingSocialPlatform = z.infer<typeof dropshippingSocialPlatformSchema>;
type DropshippingSocialFormat = z.infer<typeof dropshippingSocialFormatSchema>;

type DropshippingSocialPost = {
  id: string;
  createdAt: string;
  updatedAt: string;
  campaignId: string;
  productId: string;
  platform: DropshippingSocialPlatform;
  format: DropshippingSocialFormat;
  status: "draft" | "approval_required" | "queued" | "published" | "blocked" | "failed";
  approvalToPublish: boolean;
  scheduledFor: string;
  product: DropshippingProduct | null;
  campaign: DropshippingMarketingCampaign | null;
  hook: string;
  caption: string;
  cta: string;
  assetBrief: string[];
  complianceChecks: string[];
  guardrail: { status: "ready" | "blocked"; reason: string; missing: string[] };
  publishPayload: Record<string, unknown>;
  publishResult: {
    mode: "none" | "dry_run" | "manual" | "webhook";
    externalPostUrl: string;
    responseStatus: number | null;
    message: string;
    publishedAt: string;
  };
  metricsSummary: {
    views: number;
    clicks: number;
    orders: number;
    revenueUsd: number;
    spendUsd: number;
    profitUsd: number;
    conversionRatePercent: number;
  };
  nextActions: string[];
};

type DropshippingSocialMetric = Omit<DropshippingSocialMetricsInput, "platform"> & {
  id: string;
  createdAt: string;
  platform: DropshippingSocialPlatform;
  campaignId: string;
  productId: string;
  post: DropshippingSocialPost | null;
  calculated: {
    engagementRatePercent: number;
    clickRatePercent: number;
    conversionRatePercent: number;
    profitUsd: number;
    roas: number;
  };
};

type DropshippingSocialAnalysis = DropshippingSocialAnalysisInput & {
  id: string;
  createdAt: string;
  status: "needs_data" | "iterate_hooks" | "scale_content" | "pause_social";
  summary: string;
  winningPlatform: DropshippingSocialPlatform | "";
  winningHook: string;
  totalViews: number;
  totalClicks: number;
  totalOrders: number;
  totalRevenueUsd: number;
  totalSpendUsd: number;
  profitUsd: number;
  recommendations: string[];
  nextPostRules: string[];
};

type DropshippingOrder = DropshippingOrderInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "pending_payment" | "approval_required" | "ready_for_fulfillment" | "fulfilled" | "blocked" | "refunded";
  product: DropshippingProduct | null;
  grossRevenueUsd: number;
  estimatedCostUsd: number;
  estimatedProfitUsd: number;
  grossMarginPercent: number;
  ledgerEntryId: string;
  requiredApprovals: string[];
  nextActions: string[];
};

type DropshippingFulfillmentAction = DropshippingFulfillmentInput & {
  id: string;
  createdAt: string;
  status: "preflight" | "approval_required" | "manual_fulfillment_recorded" | "blocked" | "failed";
  order: DropshippingOrder | null;
  guardrail: { status: "ready" | "blocked"; reason: string; missing: string[] };
  costImpactUsd: number;
  nextActions: string[];
};

type DropshippingCapitalPlan = DropshippingCapitalPlanInput & {
  id: string;
  createdAt: string;
  status: "draft" | "locked_until_signal" | "ready_after_approval" | "blocked";
  campaign: DropshippingMarketingCampaign | null;
  product: DropshippingProduct | null;
  activeStage: "starter_100" | "validation_250" | "growth_500" | "scale_1000";
  requestedCampaignEnvelopeUsd: number;
  approvedInitialBudgetUsd: number;
  maxSingleTestUsd: number;
  canSpendUsd: number;
  stageGate: {
    status: "pass" | "locked" | "blocked";
    reason: string;
    requiredSignals: string[];
  };
  allocation: Array<{
    channel: string;
    purpose: string;
    budgetUsd: number;
    stage: "organic" | "test" | "retarget" | "scale";
    approvalRequired: boolean;
    killSwitch: string;
  }>;
  metricsSnapshot: {
    revenueUsd: number;
    cashCollectedUsd: number;
    spendUsd: number;
    profitUsd: number;
    orders: number;
    approvalQueue: number;
  };
  approvalsRequired: string[];
  nextActions: string[];
  boardMemo: string;
};

type DropshippingGrowthSprint = DropshippingGrowthSprintInput & {
  id: string;
  createdAt: string;
  status: "needs_product" | "ready" | "approval_locked" | "scale_locked" | "blocked";
  product: DropshippingProduct | null;
  campaign: DropshippingMarketingCampaign | null;
  ceoDirective: {
    headline: string;
    mission: string;
    constraint: string;
    targetOutcome: string;
  };
  budgetEnvelope: {
    requestedBudgetUsd: number;
    activeMonthlyBudgetUsd: number;
    approvedToRiskUsd: number;
    protectedReserveUsd: number;
    stage: "starter_100" | "validation_250" | "growth_500" | "scale_1000";
    spendMode: "organic_only" | "micro_test_ready" | "scale_plan_only";
    scaleCeilingUsd: number;
    reason: string;
  };
  unitEconomics: {
    productName: string;
    sellPriceUsd: number;
    grossProfitPerOrderUsd: number;
    grossMarginPercent: number;
    dailyRevenueTargetUsd: number;
    sprintRevenueTargetUsd: number;
    monthlyRevenueTargetUsd: number;
    ordersNeededForSprintTarget: number;
    ordersNeededForMonthlyTarget: number;
    breakEvenOrdersForRequestedBudget: number | null;
    breakEvenOrdersForApprovedRisk: number | null;
  };
  sprintScoreboard: {
    revenueUsd: number;
    profitUsd: number;
    orders: number;
    postsReady: number;
    postsPublished: number;
    approvalQueue: number;
    readinessPercent: number;
  };
  subagentOrders: Array<{
    owner: string;
    mission: string;
    output: string;
    deadline: string;
    externalActionAllowed: boolean;
    approvalGate: string;
  }>;
  campaignCalendar: Array<{
    day: number;
    owner: string;
    channel: string;
    task: string;
    kpi: string;
    budgetUsd: number;
    approvalGate: string;
  }>;
  scaleRules: {
    kill: string[];
    iterate: string[];
    scale: string[];
  };
  boardApprovals: Array<{
    actionType: "dropshipping.spend" | "dropshipping.publish_product" | "dropshipping.create_shopify_draft" | "dropshipping.publish_social" | "dropshipping.contact_supplier" | "dropshipping.fulfill_order" | "dropshipping.order_sample";
    title: string;
    reason: string;
    maxSpendUsd: number;
  }>;
  nextActions: string[];
  boardMemo: string;
};

type DropshippingLaunchPack = DropshippingLaunchPackInput & {
  id: string;
  createdAt: string;
  status: "needs_product" | "draft_ready" | "approval_required" | "blocked";
  product: DropshippingProduct | null;
  launchPlan: DropshippingLaunchPlan | null;
  campaign: DropshippingMarketingCampaign | null;
  socialPosts: DropshippingSocialPost[];
  shopifyPreflight: DropshippingShopifyDraft | null;
  capitalPlan: DropshippingCapitalPlan | null;
  safety: {
    spentUsd: number;
    publishedExternally: number;
    shopifyCreatedExternally: boolean;
    inventoryPurchased: boolean;
    guardrails: string[];
  };
  approvalsRequired: Array<{
    actionType: "dropshipping.spend" | "dropshipping.publish_product" | "dropshipping.create_shopify_draft" | "dropshipping.publish_social" | "dropshipping.contact_supplier" | "dropshipping.fulfill_order" | "dropshipping.order_sample";
    title: string;
    reason: string;
    maxSpendUsd: number;
  }>;
  launchChecklist: Array<{
    owner: string;
    item: string;
    status: "ready" | "needs_approval" | "blocked";
  }>;
  nextActions: string[];
  boardMemo: string;
};

type DropshippingExecutionSetup = {
  generatedAt: string;
  status: "ready_for_dry_run" | "needs_setup" | "blocked";
  summary: string;
  connectors: Array<{
    id: "shopify" | "social_publisher" | "telegram" | "supplier_ops" | "approvals" | "payments_tax";
    label: string;
    status: "ready" | "needs_setup" | "blocked";
    mode: "api" | "webhook" | "metricool_mcp" | "manual" | "dry_run";
    ownerAgent: string;
    capabilities: string[];
    requiredEnv: string[];
    missingEnv: string[];
    approvalGate: string;
    nextAction: string;
    evidence: string[];
  }>;
  launchSequence: Array<{
    step: number;
    owner: string;
    action: string;
    mode: "autonomous" | "approval_required" | "manual";
    blockedUntil: string[];
  }>;
  supplierOps: {
    preferredMode: "manual" | "dsers" | "zendrop" | "cj_dropshipping" | "spocket";
    fulfillmentPolicy: string;
    requiredBeforeFirstOrder: string[];
    customerPromiseRules: string[];
  };
  hardBlocks: string[];
  safeDefaults: string[];
  nextApprovalRequest: {
    actionType: "dropshipping.create_shopify_draft" | "dropshipping.publish_social" | "dropshipping.spend" | "dropshipping.fulfill_order" | "dropshipping.contact_supplier";
    title: string;
    description: string;
  };
};

type DropshippingLaunchReadiness = {
  generatedAt: string;
  status: "pre_account_ready" | "ready_for_test_order" | "blocked_needs_accounts" | "blocked_safety";
  summary: string;
  budgetLimits: {
    startingMonthlyBudgetUsd: number;
    activeMonthlyBudgetUsd: number;
    dailySpendCapUsd: number;
    maxSingleTestUsd: number;
    targetMonthlyRevenueUsd: number;
    canSpendUsd: number;
    requiresApprovalForExternalActions: boolean;
    requiresSampleBeforeScale: boolean;
  };
  postgresTrustCenter: {
    databaseUrlConfigured: boolean;
    dbPushCommand: string;
    migrationPath: string;
    localApprovalOutbox: number;
    status: "ready" | "needs_database" | "needs_migration";
    nextAction: string;
  };
  checkout: {
    paymentProcessorConfigured: boolean;
    policyRoutesReady: boolean;
    testOrderReady: boolean;
    status: "ready_for_test_order" | "needs_accounts" | "draft_ready";
    requiredAccounts: string[];
    policyRoutes: string[];
    nextAction: string;
  };
  productSupplier: {
    productSelected: boolean;
    productName: string;
    supplierReviewed: boolean;
    sampleRecommended: boolean;
    status: "ready_for_sample" | "needs_product" | "needs_supplier_validation" | "validation_ready";
    nextAction: string;
  };
  automation: {
    schedulerConfigured: boolean;
    telegramConfigured: boolean;
    reportsMode: "telegram" | "preview_only";
    status: "ready" | "preview_only";
    nextAction: string;
  };
  canDoNow: string[];
  requiresConnectedAccounts: string[];
  hardBlocks: string[];
  tomorrowChecklist: string[];
};

type DropshippingCeoOperatingPlan = {
  mission: string;
  stage: "research" | "validation" | "traction" | "scale";
  revenueGapUsd: number;
  estimatedOrdersNeeded: number;
  averageOrderValueUsd: number;
  currentStageGate: string;
  nextExecutiveDecision: string;
  weeklyOperatingCadence: Array<{ owner: string; focus: string; output: string }>;
  stageRoadmap: Array<{
    stage: "starter_100" | "validation_250" | "growth_500" | "scale_1000";
    budgetUsd: number;
    trigger: string;
    campaignStyle: string;
    allowedChannels: string[];
    lockedActions: string[];
    successMetric: string;
  }>;
  campaignPortfolio: Array<{
    id: string;
    name: string;
    status: "active_now" | "ready_after_approval" | "locked_until_signal" | "blocked";
    spendCapUsd: number;
    objective: string;
    channels: string[];
    approvalGate: string;
    learningGoal: string;
  }>;
  largeCampaignReadiness: {
    status: "locked_until_signal" | "ready_after_approval" | "blocked";
    maxRecommendedBudgetUsd: number;
    reason: string;
    requiredSignals: string[];
  };
  boardRisks: string[];
};

type DropshippingMarketingDepartment = {
  cmoAgent: {
    id: string;
    name: string;
    role: string;
    status: "active" | "draft_only" | "blocked";
    reportsTo: string;
    mandate: string;
  };
  subagents: Array<{
    id: string;
    name: string;
    role: string;
    status: "active" | "draft_only" | "needs_signal" | "approval_locked";
    currentFocus: string;
    autonomousOutputs: string[];
    approvalGates: string[];
  }>;
  operatingModel: {
    mission: string;
    canRunAutonomously: string[];
    requiresApproval: string[];
    dailyWorkflow: string[];
  };
  workstreams: Array<{
    id: string;
    name: string;
    status: "active" | "needs_data" | "approval_locked" | "blocked";
    owner: string;
    output: string;
    nextMove: string;
  }>;
  activeBrief: {
    objective: string;
    productFocus: string;
    primaryAudience: string;
    nextCampaign: string;
    nextPosts: string[];
    blockedUntil: string[];
  };
  scorecard: {
    campaigns: number;
    draftOrApprovalPosts: number;
    queuedPosts: number;
    publishedPosts: number;
    revenueUsd: number;
    spendUsd: number;
    orders: number;
    bestHook: string;
    nextAction: string;
  };
  handoffToCeo: {
    requests: string[];
    risks: string[];
    decisionsNeeded: string[];
  };
};

type DropshippingCeoGrowthBoard = {
  status: "research_board" | "validation_board" | "approval_locked" | "cash_locked" | "scale_locked" | "scale_ready";
  headline: string;
  stage: "research" | "validation" | "traction" | "scale";
  decision: string;
  sourceIntelligence: Array<{
    source: string;
    url: string;
    signal: string;
    ceoAction: string;
  }>;
  kpiScorecard: Array<{
    id: string;
    label: string;
    current: string;
    target: string;
    status: "critical" | "watch" | "on_track" | "locked";
    owner: string;
  }>;
  capitalDoctrine: {
    startingBudgetUsd: number;
    activeMonthlyBudgetUsd: number;
    canRiskNowUsd: number;
    protectedReserveUsd: number;
    reinvestmentRule: string;
    paidSpendRule: string;
    sampleRule: string;
  };
  campaignScaleLadder: Array<{
    stage: "organic_proof" | "micro_test" | "retargeting" | "winner_scale";
    name: string;
    budgetUsd: number;
    channelMix: string[];
    entryCriteria: string[];
    exitCriteria: string[];
    approvalGate: string;
    status: "active" | "ready_after_approval" | "locked" | "blocked";
  }>;
  boardVotes: Array<{
    agent: string;
    vote: "go" | "hold" | "block";
    reason: string;
    requiredProof: string;
  }>;
  thirtyDayPlan: Array<{
    week: number;
    objective: string;
    owner: string;
    output: string;
    budgetUsd: number;
    approvalGate: string;
  }>;
  nextOperatingOrders: Array<{
    owner: string;
    order: string;
    due: string;
    externalActionAllowed: boolean;
  }>;
  blockedUntil: string[];
  approvalRequests: Array<{
    actionType: "dropshipping.spend" | "dropshipping.publish_product" | "dropshipping.create_shopify_draft" | "dropshipping.publish_social" | "dropshipping.contact_supplier" | "dropshipping.order_sample";
    title: string;
    reason: string;
    maxSpendUsd: number;
  }>;
};

type DropshippingApprovalActionType =
  | "dropshipping.spend"
  | "dropshipping.publish_product"
  | "dropshipping.create_shopify_draft"
  | "dropshipping.publish_social"
  | "dropshipping.contact_supplier"
  | "dropshipping.fulfill_order"
  | "dropshipping.order_sample";

type DropshippingPreparedApprovalRequest = {
  actionType: DropshippingApprovalActionType;
  resourceType: string;
  resourceId: string;
  title: string;
  description: string;
  input?: unknown;
  proposedChanges?: unknown;
};

type DropshippingApprovalOutboxItem = DropshippingPreparedApprovalRequest & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "pending_local" | "queued_in_trust_center" | "cancelled";
  source: "launch_pack_approval_queue" | "manual";
  failureReason: string;
  queuedExternally: boolean;
  trustCenterPendingActionId: string;
};

const products: DropshippingProduct[] = [];
const productScoutCandidates: DropshippingProductScoutCandidate[] = [];
const suppliers: DropshippingSupplierReview[] = [];
const launchPlans: DropshippingLaunchPlan[] = [];
const ledger: DropshippingLedgerEntry[] = [];
const approvals: DropshippingApprovalDecision[] = [];
const learningReviews: DropshippingLearningReview[] = [];
const marketingCampaigns: DropshippingMarketingCampaign[] = [];
const ceoCycles: DropshippingCeoCycle[] = [];
const shopifyDrafts: DropshippingShopifyDraft[] = [];
const socialPosts: DropshippingSocialPost[] = [];
const socialMetrics: DropshippingSocialMetric[] = [];
const socialAnalyses: DropshippingSocialAnalysis[] = [];
const orderRecords: DropshippingOrder[] = [];
const fulfillmentActions: DropshippingFulfillmentAction[] = [];
const capitalPlans: DropshippingCapitalPlan[] = [];
const growthSprints: DropshippingGrowthSprint[] = [];
const launchPacks: DropshippingLaunchPack[] = [];
const autopilotProductHunterRuns: DropshippingAutopilotProductHunterRun[] = [];
const approvalOutbox: DropshippingApprovalOutboxItem[] = [];

let productsLoaded = false;
let productScoutCandidatesLoaded = false;
let suppliersLoaded = false;
let launchPlansLoaded = false;
let ledgerLoaded = false;
let approvalsLoaded = false;
let learningLoaded = false;
let marketingCampaignsLoaded = false;
let ceoCyclesLoaded = false;
let shopifyDraftsLoaded = false;
let socialPostsLoaded = false;
let socialMetricsLoaded = false;
let socialAnalysesLoaded = false;
let ordersLoaded = false;
let fulfillmentActionsLoaded = false;
let capitalPlansLoaded = false;
let growthSprintsLoaded = false;
let launchPacksLoaded = false;
let autopilotProductHunterRunsLoaded = false;
let approvalOutboxLoaded = false;

let productsPathOverride: string | null = null;
let productScoutCandidatesPathOverride: string | null = null;
let suppliersPathOverride: string | null = null;
let launchPlansPathOverride: string | null = null;
let ledgerPathOverride: string | null = null;
let approvalsPathOverride: string | null = null;
let learningPathOverride: string | null = null;
let marketingCampaignsPathOverride: string | null = null;
let ceoCyclesPathOverride: string | null = null;
let shopifyDraftsPathOverride: string | null = null;
let socialPostsPathOverride: string | null = null;
let socialMetricsPathOverride: string | null = null;
let socialAnalysesPathOverride: string | null = null;
let ordersPathOverride: string | null = null;
let fulfillmentActionsPathOverride: string | null = null;
let capitalPlansPathOverride: string | null = null;
let growthSprintsPathOverride: string | null = null;
let launchPacksPathOverride: string | null = null;
let autopilotProductHunterRunsPathOverride: string | null = null;
let approvalOutboxPathOverride: string | null = null;

function getDataPath(name: string, override: string | null, envName: string) {
  return override || process.env[envName] || path.join(process.cwd(), "dropshipping_engine_data", `${name}.json`);
}

function readJsonArray<T>(filePath: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallbackMessage: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = z.array(schema).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(fallbackMessage);
  return parsed.data;
}

function writeJsonArray<T>(filePath: string, items: T[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

const productEconomicsPersistedSchema = z.object({
  productCostUsd: z.number(),
  shippingCostUsd: z.number(),
  landedCostUsd: z.number(),
  targetSellPriceUsd: z.number(),
  grossProfitUsd: z.number(),
  grossMarginPercent: z.number(),
  breakEvenOrdersAtBudget: z.number().nullable(),
  targetMonthlyRevenueUsd: z.number(),
  ordersNeededForTargetRevenue: z.number(),
  priceGapVsCompetitorUsd: z.number(),
  insideBudget: z.boolean(),
});

const productScorecardPersistedSchema = z.object({
  total: z.number(),
  grade: z.enum(["A", "B", "C", "D"]),
  components: z.object({
    marginScore: z.number(),
    supplierScore: z.number(),
    shippingScore: z.number(),
    demandScore: z.number(),
    riskScore: z.number(),
  }),
  pass: z.boolean(),
});

const productPersistedSchema: z.ZodType<DropshippingProduct, z.ZodTypeDef, unknown> = dropshippingProductResearchSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["research", "qualified", "approval_required", "sample_recommended", "launch_ready", "blocked"]),
  economics: productEconomicsPersistedSchema,
  scorecard: productScorecardPersistedSchema,
  subagentReviews: z.array(z.object({ agent: z.string(), verdict: z.enum(["pass", "fix", "block"]), note: z.string() })),
  requiredApprovals: z.array(z.string()),
  nextActions: z.array(z.string()),
});

const productScoutCandidatePersistedSchema: z.ZodType<DropshippingProductScoutCandidate, z.ZodTypeDef, unknown> = dropshippingProductScoutCandidateSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["seed_candidate", "needs_tiktok_validation", "needs_supplier", "ready_for_research", "shortlisted", "promoted", "rejected"]),
  validation: z.object({
    status: z.enum(["seed_only", "needs_external_validation", "externally_validated"]),
    confidence: z.enum(["low", "medium", "high"]),
    evidenceScore: z.number(),
    evidence: z.array(z.object({
      source: liveProductSignalSourceSchema,
      label: z.string(),
      url: z.string(),
      status: z.enum(["seed_reference", "needs_review", "verified", "stale", "error"]),
      signal: z.string(),
    })),
    missingProof: z.array(z.string()),
    liveValidation: z.object({
      status: z.enum(["not_connected", "partial", "connected"]),
      connectedSources: z.array(liveProductSignalSourceSchema),
      verifiedSources: z.array(liveProductSignalSourceSchema),
      liveScore: z.number(),
      scoreBonus: z.number(),
      scorePenalty: z.number(),
      signals: z.array(liveProductSignalSchema),
      blockers: z.array(z.string()),
      updatedAt: z.string(),
    }).default({
      status: "not_connected",
      connectedSources: [],
      verifiedSources: [],
      liveScore: 0,
      scoreBonus: 0,
      scorePenalty: 12,
      signals: [],
      blockers: ["Live product signal feed is not connected."],
      updatedAt: "",
    }),
  }).default({
    status: "needs_external_validation",
    confidence: "low",
    evidenceScore: 0,
    evidence: [],
    missingProof: ["validar videos reales en TikTok", "validar supplier real", "validar competidores/precio"],
    liveValidation: {
      status: "not_connected",
      connectedSources: [],
      verifiedSources: [],
      liveScore: 0,
      scoreBonus: 0,
      scorePenalty: 12,
      signals: [],
      blockers: ["Live product signal feed is not connected."],
      updatedAt: "",
    },
  }),
  scorecard: z.object({
    total: z.number(),
    grade: z.enum(["A", "B", "C", "D"]),
    components: z.object({
      marginScore: z.number(),
      demandScore: z.number(),
      contentScore: z.number(),
      supplierScore: z.number(),
      riskScore: z.number(),
      liveSignalScore: z.number().default(0),
    }),
    pass: z.boolean(),
  }),
  economics: z.object({
    landedCostUsd: z.number(),
    grossProfitUsd: z.number(),
    grossMarginPercent: z.number(),
    breakEvenOrdersAtBudget: z.number().nullable(),
    ordersNeededForTargetRevenue: z.number(),
  }),
  researchInput: dropshippingProductResearchSchema,
  nextActions: z.array(z.string()),
  promotedProductId: z.string(),
});

const autopilotProductHunterRunPersistedSchema: z.ZodType<DropshippingAutopilotProductHunterRun, z.ZodTypeDef, unknown> = dropshippingAutopilotProductHunterSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(["prepared_for_robert_review", "blocked_no_candidate"]),
  winnerCandidateId: z.string(),
  winnerProductId: z.string(),
  supplierId: z.string(),
  launchPackId: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string(),
  rankedCandidates: z.array(z.object({
    candidateId: z.string(),
    candidateName: z.string(),
    rank: z.number(),
    score: z.number(),
    confidence: z.enum(["low", "medium", "high"]),
    evidenceScore: z.number(),
    reason: z.string(),
  })),
  approvalRequired: z.array(z.object({
    actionType: z.enum(["dropshipping.publish_product", "dropshipping.create_shopify_draft", "dropshipping.publish_social", "dropshipping.spend", "dropshipping.order_sample"]),
    title: z.string(),
    reason: z.string(),
    maxSpendUsd: z.number(),
  })),
  nextActions: z.array(z.string()),
  safety: z.object({
    spentUsd: z.number(),
    publishedExternally: z.boolean(),
    inventoryPurchased: z.boolean(),
    message: z.string(),
  }),
});

const supplierPersistedSchema: z.ZodType<DropshippingSupplierReview, z.ZodTypeDef, unknown> = dropshippingSupplierReviewSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["approved_candidate", "needs_backup_supplier", "blocked"]),
  score: z.number(),
  riskFlags: z.array(z.string()),
  nextActions: z.array(z.string()),
});

const launchPlanPersistedSchema: z.ZodType<DropshippingLaunchPlan, z.ZodTypeDef, unknown> = dropshippingLaunchPlanSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["draft_only", "approval_required", "ready_after_approval", "blocked"]),
  product: productPersistedSchema.nullable(),
  contentCalendar: z.array(z.object({ day: z.string(), channel: z.string(), hook: z.string(), status: z.enum(["draft", "needs_approval"]) })),
  gatedActions: z.array(z.string()),
  nextActions: z.array(z.string()),
});

const ledgerPersistedSchema: z.ZodType<DropshippingLedgerEntry, z.ZodTypeDef, unknown> = dropshippingLedgerEntrySchema.extend({
  id: z.string(),
  createdAt: z.string(),
});

const approvalPersistedSchema: z.ZodType<DropshippingApprovalDecision, z.ZodTypeDef, unknown> = dropshippingApprovalDecisionSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  guardrail: z.object({ status: z.enum(["recorded", "blocked"]), reason: z.string() }),
});

const approvalOutboxPersistedSchema: z.ZodType<DropshippingApprovalOutboxItem, z.ZodTypeDef, unknown> = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["pending_local", "queued_in_trust_center", "cancelled"]),
  source: z.enum(["launch_pack_approval_queue", "manual"]),
  failureReason: z.string(),
  queuedExternally: z.boolean(),
  trustCenterPendingActionId: z.string().optional().default(""),
  actionType: z.enum([
    "dropshipping.spend",
    "dropshipping.publish_product",
    "dropshipping.create_shopify_draft",
    "dropshipping.publish_social",
    "dropshipping.contact_supplier",
    "dropshipping.fulfill_order",
    "dropshipping.order_sample",
  ]),
  resourceType: z.string(),
  resourceId: z.string(),
  title: z.string(),
  description: z.string(),
  input: z.unknown(),
  proposedChanges: z.unknown(),
});

const learningPersistedSchema: z.ZodType<DropshippingLearningReview, z.ZodTypeDef, unknown> = dropshippingLearningReviewSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  decisionStatus: z.enum(["scale_content", "iterate_small", "pause_and_fix"]),
  metrics: z.object({
    conversionRatePercent: z.number(),
    addToCartRatePercent: z.number(),
    profitUsd: z.number(),
    roiPercent: z.number(),
  }),
  playbookUpdates: z.array(z.string()),
  nextBatch: z.object({
    maxProducts: z.number(),
    maxSpendUsd: z.number(),
    requiredBeforeNextAction: z.array(z.string()),
  }),
});

const marketingCampaignPersistedSchema: z.ZodType<DropshippingMarketingCampaign, z.ZodTypeDef, unknown> = dropshippingMarketingCampaignSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["draft_only", "approval_required", "ready_after_approval", "blocked"]),
  product: productPersistedSchema.nullable(),
  budgetPlan: z.object({
    organicFirst: z.boolean(),
    requestedSpendUsd: z.number(),
    approvedSpendUsd: z.number(),
    breakEvenOrders: z.number().nullable(),
    guardrail: z.string(),
  }),
  creativeBrief: z.object({
    productPromise: z.string(),
    landingPageDraft: z.array(z.string()),
    riskChecks: z.array(z.string()),
  }),
  socialDrafts: z.array(z.object({
    day: z.string(),
    channel: z.string(),
    hook: z.string(),
    caption: z.string(),
    status: z.enum(["draft", "needs_approval"]),
  })),
  requiredApprovals: z.array(z.string()),
  nextActions: z.array(z.string()),
});

const ceoCyclePersistedSchema: z.ZodType<DropshippingCeoCycle, z.ZodTypeDef, unknown> = dropshippingCeoCycleSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(["research", "approval_review", "campaign_drafted", "blocked"]),
  focus: z.string(),
  summary: z.string(),
  commands: z.array(z.string()),
  generatedCampaignIds: z.array(z.string()),
  generatedPostIds: z.array(z.string()).default([]),
  approvalRequests: z.array(z.string()),
  metricsSnapshot: z.object({
    productsResearched: z.number(),
    approvalQueue: z.number(),
    totalRevenueUsd: z.number(),
    totalSpendUsd: z.number(),
    profitUsd: z.number(),
    canSpendUsd: z.number(),
  }),
});

const shopifyDraftPersistedSchema: z.ZodType<DropshippingShopifyDraft, z.ZodTypeDef, unknown> = dropshippingShopifyDraftSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(["preflight", "draft_created", "blocked", "failed"]),
  product: productPersistedSchema.nullable(),
  campaign: marketingCampaignPersistedSchema.nullable(),
  shopifyProductId: z.string(),
  shopifyHandle: z.string(),
  productCreateInput: z.record(z.unknown()),
  guardrail: z.object({ status: z.enum(["ready", "blocked"]), reason: z.string(), missing: z.array(z.string()) }),
  userErrors: z.array(z.object({ field: z.array(z.string()), message: z.string() })),
  nextActions: z.array(z.string()),
});

const socialPostPersistedSchema: z.ZodType<DropshippingSocialPost, z.ZodTypeDef, unknown> = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  campaignId: z.string(),
  productId: z.string(),
  platform: dropshippingSocialPlatformSchema,
  format: dropshippingSocialFormatSchema,
  status: z.enum(["draft", "approval_required", "queued", "published", "blocked", "failed"]),
  approvalToPublish: z.boolean(),
  scheduledFor: z.string(),
  product: productPersistedSchema.nullable(),
  campaign: marketingCampaignPersistedSchema.nullable(),
  hook: z.string(),
  caption: z.string(),
  cta: z.string(),
  assetBrief: z.array(z.string()),
  complianceChecks: z.array(z.string()),
  guardrail: z.object({ status: z.enum(["ready", "blocked"]), reason: z.string(), missing: z.array(z.string()) }),
  publishPayload: z.record(z.unknown()),
  publishResult: z.object({
    mode: z.enum(["none", "dry_run", "manual", "webhook"]),
    externalPostUrl: z.string(),
    responseStatus: z.number().nullable(),
    message: z.string(),
    publishedAt: z.string(),
  }),
  metricsSummary: z.object({
    views: z.number(),
    clicks: z.number(),
    orders: z.number(),
    revenueUsd: z.number(),
    spendUsd: z.number(),
    profitUsd: z.number(),
    conversionRatePercent: z.number(),
  }),
  nextActions: z.array(z.string()),
});

const socialMetricPersistedSchema: z.ZodType<DropshippingSocialMetric, z.ZodTypeDef, unknown> = z.object({
  id: z.string(),
  createdAt: z.string(),
  postId: z.string(),
  platform: dropshippingSocialPlatformSchema,
  impressions: z.number(),
  views: z.number(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
  clicks: z.number(),
  addToCarts: z.number(),
  orders: z.number(),
  revenueUsd: z.number(),
  spendUsd: z.number(),
  notes: z.string(),
  campaignId: z.string(),
  productId: z.string(),
  post: socialPostPersistedSchema.nullable(),
  calculated: z.object({
    engagementRatePercent: z.number(),
    clickRatePercent: z.number(),
    conversionRatePercent: z.number(),
    profitUsd: z.number(),
    roas: z.number(),
  }),
});

const socialAnalysisPersistedSchema: z.ZodType<DropshippingSocialAnalysis, z.ZodTypeDef, unknown> = dropshippingSocialAnalysisSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(["needs_data", "iterate_hooks", "scale_content", "pause_social"]),
  summary: z.string(),
  winningPlatform: z.union([dropshippingSocialPlatformSchema, z.literal("")]),
  winningHook: z.string(),
  totalViews: z.number(),
  totalClicks: z.number(),
  totalOrders: z.number(),
  totalRevenueUsd: z.number(),
  totalSpendUsd: z.number(),
  profitUsd: z.number(),
  recommendations: z.array(z.string()),
  nextPostRules: z.array(z.string()),
});

const orderPersistedSchema: z.ZodType<DropshippingOrder, z.ZodTypeDef, unknown> = dropshippingOrderSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["pending_payment", "approval_required", "ready_for_fulfillment", "fulfilled", "blocked", "refunded"]),
  product: productPersistedSchema.nullable(),
  grossRevenueUsd: z.number(),
  estimatedCostUsd: z.number(),
  estimatedProfitUsd: z.number(),
  grossMarginPercent: z.number(),
  ledgerEntryId: z.string(),
  requiredApprovals: z.array(z.string()),
  nextActions: z.array(z.string()),
});

const fulfillmentActionPersistedSchema: z.ZodType<DropshippingFulfillmentAction, z.ZodTypeDef, unknown> = dropshippingFulfillmentSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(["preflight", "approval_required", "manual_fulfillment_recorded", "blocked", "failed"]),
  order: orderPersistedSchema.nullable(),
  guardrail: z.object({ status: z.enum(["ready", "blocked"]), reason: z.string(), missing: z.array(z.string()) }),
  costImpactUsd: z.number(),
  nextActions: z.array(z.string()),
});

const capitalPlanPersistedSchema: z.ZodType<DropshippingCapitalPlan, z.ZodTypeDef, unknown> = dropshippingCapitalPlanSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(["draft", "locked_until_signal", "ready_after_approval", "blocked"]),
  campaign: marketingCampaignPersistedSchema.nullable(),
  product: productPersistedSchema.nullable(),
  activeStage: z.enum(["starter_100", "validation_250", "growth_500", "scale_1000"]),
  requestedCampaignEnvelopeUsd: z.number(),
  approvedInitialBudgetUsd: z.number(),
  maxSingleTestUsd: z.number(),
  canSpendUsd: z.number(),
  stageGate: z.object({
    status: z.enum(["pass", "locked", "blocked"]),
    reason: z.string(),
    requiredSignals: z.array(z.string()),
  }),
  allocation: z.array(z.object({
    channel: z.string(),
    purpose: z.string(),
    budgetUsd: z.number(),
    stage: z.enum(["organic", "test", "retarget", "scale"]),
    approvalRequired: z.boolean(),
    killSwitch: z.string(),
  })),
  metricsSnapshot: z.object({
    revenueUsd: z.number(),
    cashCollectedUsd: z.number(),
    spendUsd: z.number(),
    profitUsd: z.number(),
    orders: z.number(),
    approvalQueue: z.number(),
  }),
  approvalsRequired: z.array(z.string()),
  nextActions: z.array(z.string()),
  boardMemo: z.string(),
});

const growthSprintPersistedSchema: z.ZodType<DropshippingGrowthSprint, z.ZodTypeDef, unknown> = dropshippingGrowthSprintSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(["needs_product", "ready", "approval_locked", "scale_locked", "blocked"]),
  product: productPersistedSchema.nullable(),
  campaign: marketingCampaignPersistedSchema.nullable(),
  ceoDirective: z.object({
    headline: z.string(),
    mission: z.string(),
    constraint: z.string(),
    targetOutcome: z.string(),
  }),
  budgetEnvelope: z.object({
    requestedBudgetUsd: z.number(),
    activeMonthlyBudgetUsd: z.number(),
    approvedToRiskUsd: z.number(),
    protectedReserveUsd: z.number(),
    stage: z.enum(["starter_100", "validation_250", "growth_500", "scale_1000"]),
    spendMode: z.enum(["organic_only", "micro_test_ready", "scale_plan_only"]),
    scaleCeilingUsd: z.number(),
    reason: z.string(),
  }),
  unitEconomics: z.object({
    productName: z.string(),
    sellPriceUsd: z.number(),
    grossProfitPerOrderUsd: z.number(),
    grossMarginPercent: z.number(),
    dailyRevenueTargetUsd: z.number(),
    sprintRevenueTargetUsd: z.number(),
    monthlyRevenueTargetUsd: z.number(),
    ordersNeededForSprintTarget: z.number(),
    ordersNeededForMonthlyTarget: z.number(),
    breakEvenOrdersForRequestedBudget: z.number().nullable(),
    breakEvenOrdersForApprovedRisk: z.number().nullable(),
  }),
  sprintScoreboard: z.object({
    revenueUsd: z.number(),
    profitUsd: z.number(),
    orders: z.number(),
    postsReady: z.number(),
    postsPublished: z.number(),
    approvalQueue: z.number(),
    readinessPercent: z.number(),
  }),
  subagentOrders: z.array(z.object({
    owner: z.string(),
    mission: z.string(),
    output: z.string(),
    deadline: z.string(),
    externalActionAllowed: z.boolean(),
    approvalGate: z.string(),
  })),
  campaignCalendar: z.array(z.object({
    day: z.number(),
    owner: z.string(),
    channel: z.string(),
    task: z.string(),
    kpi: z.string(),
    budgetUsd: z.number(),
    approvalGate: z.string(),
  })),
  scaleRules: z.object({
    kill: z.array(z.string()),
    iterate: z.array(z.string()),
    scale: z.array(z.string()),
  }),
  boardApprovals: z.array(z.object({
    actionType: z.enum([
      "dropshipping.spend",
      "dropshipping.publish_product",
      "dropshipping.create_shopify_draft",
      "dropshipping.publish_social",
      "dropshipping.contact_supplier",
      "dropshipping.fulfill_order",
      "dropshipping.order_sample",
    ]),
    title: z.string(),
    reason: z.string(),
    maxSpendUsd: z.number(),
  })),
  nextActions: z.array(z.string()),
  boardMemo: z.string(),
});

const launchPackPersistedSchema: z.ZodType<DropshippingLaunchPack, z.ZodTypeDef, unknown> = dropshippingLaunchPackSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  status: z.enum(["needs_product", "draft_ready", "approval_required", "blocked"]),
  product: productPersistedSchema.nullable(),
  launchPlan: launchPlanPersistedSchema.nullable(),
  campaign: marketingCampaignPersistedSchema.nullable(),
  socialPosts: z.array(socialPostPersistedSchema),
  shopifyPreflight: shopifyDraftPersistedSchema.nullable(),
  capitalPlan: capitalPlanPersistedSchema.nullable(),
  safety: z.object({
    spentUsd: z.number(),
    publishedExternally: z.number(),
    shopifyCreatedExternally: z.boolean(),
    inventoryPurchased: z.boolean(),
    guardrails: z.array(z.string()),
  }),
  approvalsRequired: z.array(z.object({
    actionType: z.enum([
      "dropshipping.spend",
      "dropshipping.publish_product",
      "dropshipping.create_shopify_draft",
      "dropshipping.publish_social",
      "dropshipping.contact_supplier",
      "dropshipping.fulfill_order",
      "dropshipping.order_sample",
    ]),
    title: z.string(),
    reason: z.string(),
    maxSpendUsd: z.number(),
  })),
  launchChecklist: z.array(z.object({
    owner: z.string(),
    item: z.string(),
    status: z.enum(["ready", "needs_approval", "blocked"]),
  })),
  nextActions: z.array(z.string()),
  boardMemo: z.string(),
});

function loadProducts() {
  if (productsLoaded) return;
  productsLoaded = true;
  products.splice(0, products.length, ...readJsonArray(getProductsPath(), productPersistedSchema, "Productos dropshipping invalidos."));
}

function loadProductScoutCandidates() {
  if (productScoutCandidatesLoaded) return;
  productScoutCandidatesLoaded = true;
  productScoutCandidates.splice(0, productScoutCandidates.length, ...readJsonArray(getProductScoutCandidatesPath(), productScoutCandidatePersistedSchema, "Candidatos Product Scout dropshipping invalidos."));
}

function loadSuppliers() {
  if (suppliersLoaded) return;
  suppliersLoaded = true;
  suppliers.splice(0, suppliers.length, ...readJsonArray(getSuppliersPath(), supplierPersistedSchema, "Suppliers dropshipping invalidos."));
}

function loadLaunchPlans() {
  if (launchPlansLoaded) return;
  launchPlansLoaded = true;
  launchPlans.splice(0, launchPlans.length, ...readJsonArray(getLaunchPlansPath(), launchPlanPersistedSchema, "Launch plans dropshipping invalidos."));
}

function loadLedger() {
  if (ledgerLoaded) return;
  ledgerLoaded = true;
  ledger.splice(0, ledger.length, ...readJsonArray(getLedgerPath(), ledgerPersistedSchema, "Ledger dropshipping invalido."));
}

function loadApprovals() {
  if (approvalsLoaded) return;
  approvalsLoaded = true;
  approvals.splice(0, approvals.length, ...readJsonArray(getApprovalsPath(), approvalPersistedSchema, "Aprobaciones dropshipping invalidas."));
}

function loadLearningReviews() {
  if (learningLoaded) return;
  learningLoaded = true;
  learningReviews.splice(0, learningReviews.length, ...readJsonArray(getLearningPath(), learningPersistedSchema, "Learning dropshipping invalido."));
}

function loadMarketingCampaigns() {
  if (marketingCampaignsLoaded) return;
  marketingCampaignsLoaded = true;
  marketingCampaigns.splice(0, marketingCampaigns.length, ...readJsonArray(getMarketingCampaignsPath(), marketingCampaignPersistedSchema, "Campanas dropshipping invalidas."));
}

function loadCeoCycles() {
  if (ceoCyclesLoaded) return;
  ceoCyclesLoaded = true;
  ceoCycles.splice(0, ceoCycles.length, ...readJsonArray(getCeoCyclesPath(), ceoCyclePersistedSchema, "Ciclos CEO dropshipping invalidos."));
}

function loadShopifyDrafts() {
  if (shopifyDraftsLoaded) return;
  shopifyDraftsLoaded = true;
  shopifyDrafts.splice(0, shopifyDrafts.length, ...readJsonArray(getShopifyDraftsPath(), shopifyDraftPersistedSchema, "Drafts Shopify dropshipping invalidos."));
}

function loadSocialPosts() {
  if (socialPostsLoaded) return;
  socialPostsLoaded = true;
  socialPosts.splice(0, socialPosts.length, ...readJsonArray(getSocialPostsPath(), socialPostPersistedSchema, "Posts sociales dropshipping invalidos."));
}

function loadSocialMetrics() {
  if (socialMetricsLoaded) return;
  socialMetricsLoaded = true;
  socialMetrics.splice(0, socialMetrics.length, ...readJsonArray(getSocialMetricsPath(), socialMetricPersistedSchema, "Metricas sociales dropshipping invalidas."));
}

function loadSocialAnalyses() {
  if (socialAnalysesLoaded) return;
  socialAnalysesLoaded = true;
  socialAnalyses.splice(0, socialAnalyses.length, ...readJsonArray(getSocialAnalysesPath(), socialAnalysisPersistedSchema, "Analisis social dropshipping invalido."));
}

function loadOrders() {
  if (ordersLoaded) return;
  ordersLoaded = true;
  orderRecords.splice(0, orderRecords.length, ...readJsonArray(getOrdersPath(), orderPersistedSchema, "Ordenes dropshipping invalidas."));
}

function loadFulfillmentActions() {
  if (fulfillmentActionsLoaded) return;
  fulfillmentActionsLoaded = true;
  fulfillmentActions.splice(0, fulfillmentActions.length, ...readJsonArray(getFulfillmentActionsPath(), fulfillmentActionPersistedSchema, "Fulfillment dropshipping invalido."));
}

function loadCapitalPlans() {
  if (capitalPlansLoaded) return;
  capitalPlansLoaded = true;
  capitalPlans.splice(0, capitalPlans.length, ...readJsonArray(getCapitalPlansPath(), capitalPlanPersistedSchema, "Planes de capital dropshipping invalidos."));
}

function loadGrowthSprints() {
  if (growthSprintsLoaded) return;
  growthSprintsLoaded = true;
  growthSprints.splice(0, growthSprints.length, ...readJsonArray(getGrowthSprintsPath(), growthSprintPersistedSchema, "Sprints de crecimiento dropshipping invalidos."));
}

function loadLaunchPacks() {
  if (launchPacksLoaded) return;
  launchPacksLoaded = true;
  launchPacks.splice(0, launchPacks.length, ...readJsonArray(getLaunchPacksPath(), launchPackPersistedSchema, "Launch packs dropshipping invalidos."));
}

function loadAutopilotProductHunterRuns() {
  if (autopilotProductHunterRunsLoaded) return;
  autopilotProductHunterRunsLoaded = true;
  autopilotProductHunterRuns.splice(0, autopilotProductHunterRuns.length, ...readJsonArray(getAutopilotProductHunterRunsPath(), autopilotProductHunterRunPersistedSchema, "Autopilot Product Hunter dropshipping invalido."));
}

function loadApprovalOutbox() {
  if (approvalOutboxLoaded) return;
  approvalOutboxLoaded = true;
  approvalOutbox.splice(0, approvalOutbox.length, ...readJsonArray(getApprovalOutboxPath(), approvalOutboxPersistedSchema, "Outbox de approvals dropshipping invalido."));
}

function loadAll() {
  loadProducts();
  loadProductScoutCandidates();
  loadSuppliers();
  loadLaunchPlans();
  loadLedger();
  loadApprovals();
  loadLearningReviews();
  loadMarketingCampaigns();
  loadCeoCycles();
  loadShopifyDrafts();
  loadSocialPosts();
  loadSocialMetrics();
  loadSocialAnalyses();
  loadOrders();
  loadFulfillmentActions();
  loadCapitalPlans();
  loadGrowthSprints();
  loadLaunchPacks();
  loadAutopilotProductHunterRuns();
  loadApprovalOutbox();
}

function persistProducts() {
  const filePath = getProductsPath();
  writeJsonArray(filePath, products);
  mirrorOfficeSourceFile({ kind: "products", filePath, raw: products });
}

function persistProductScoutCandidates() {
  writeJsonArray(getProductScoutCandidatesPath(), productScoutCandidates);
}

function persistSuppliers() {
  const filePath = getSuppliersPath();
  writeJsonArray(filePath, suppliers);
  mirrorOfficeSourceFile({ kind: "suppliers", filePath, raw: suppliers });
}

function persistLaunchPlans() {
  writeJsonArray(getLaunchPlansPath(), launchPlans);
}

function persistLedger() {
  writeJsonArray(getLedgerPath(), ledger);
}

function persistApprovals() {
  writeJsonArray(getApprovalsPath(), approvals);
}

function persistLearningReviews() {
  writeJsonArray(getLearningPath(), learningReviews);
}

function persistMarketingCampaigns() {
  writeJsonArray(getMarketingCampaignsPath(), marketingCampaigns);
}

function persistCeoCycles() {
  writeJsonArray(getCeoCyclesPath(), ceoCycles);
}

function persistShopifyDrafts() {
  writeJsonArray(getShopifyDraftsPath(), shopifyDrafts);
}

function persistSocialPosts() {
  writeJsonArray(getSocialPostsPath(), socialPosts);
}

function persistSocialMetrics() {
  const filePath = getSocialMetricsPath();
  writeJsonArray(filePath, socialMetrics);
  mirrorOfficeSourceFile({ kind: "social_metrics", filePath, raw: socialMetrics });
}

function persistSocialAnalyses() {
  writeJsonArray(getSocialAnalysesPath(), socialAnalyses);
}

function persistOrders() {
  writeJsonArray(getOrdersPath(), orderRecords);
}

function persistFulfillmentActions() {
  writeJsonArray(getFulfillmentActionsPath(), fulfillmentActions);
}

function persistCapitalPlans() {
  writeJsonArray(getCapitalPlansPath(), capitalPlans);
}

function persistGrowthSprints() {
  writeJsonArray(getGrowthSprintsPath(), growthSprints);
}

function persistLaunchPacks() {
  writeJsonArray(getLaunchPacksPath(), launchPacks);
}

function persistAutopilotProductHunterRuns() {
  writeJsonArray(getAutopilotProductHunterRunsPath(), autopilotProductHunterRuns);
}

function persistApprovalOutbox() {
  writeJsonArray(getApprovalOutboxPath(), approvalOutbox);
}

function getProductsPath() {
  return getDataPath("products", productsPathOverride, "DROPSHIPPING_PRODUCTS_PATH");
}

function getProductScoutCandidatesPath() {
  return getDataPath("product_scout_candidates", productScoutCandidatesPathOverride, "DROPSHIPPING_PRODUCT_SCOUT_CANDIDATES_PATH");
}

function getSuppliersPath() {
  return getDataPath("suppliers", suppliersPathOverride, "DROPSHIPPING_SUPPLIERS_PATH");
}

function getLaunchPlansPath() {
  return getDataPath("launch_plans", launchPlansPathOverride, "DROPSHIPPING_LAUNCH_PLANS_PATH");
}

function getLedgerPath() {
  return getDataPath("ledger", ledgerPathOverride, "DROPSHIPPING_LEDGER_PATH");
}

function getApprovalsPath() {
  return getDataPath("approvals", approvalsPathOverride, "DROPSHIPPING_APPROVALS_PATH");
}

function getLearningPath() {
  return getDataPath("learning_reviews", learningPathOverride, "DROPSHIPPING_LEARNING_REVIEWS_PATH");
}

function getMarketingCampaignsPath() {
  return getDataPath("marketing_campaigns", marketingCampaignsPathOverride, "DROPSHIPPING_MARKETING_CAMPAIGNS_PATH");
}

function getCeoCyclesPath() {
  return getDataPath("ceo_cycles", ceoCyclesPathOverride, "DROPSHIPPING_CEO_CYCLES_PATH");
}

function getShopifyDraftsPath() {
  return getDataPath("shopify_drafts", shopifyDraftsPathOverride, "DROPSHIPPING_SHOPIFY_DRAFTS_PATH");
}

function getSocialPostsPath() {
  return getDataPath("social_posts", socialPostsPathOverride, "DROPSHIPPING_SOCIAL_POSTS_PATH");
}

function getSocialMetricsPath() {
  return getDataPath("social_metrics", socialMetricsPathOverride, "DROPSHIPPING_SOCIAL_METRICS_PATH");
}

function getSocialAnalysesPath() {
  return getDataPath("social_analyses", socialAnalysesPathOverride, "DROPSHIPPING_SOCIAL_ANALYSES_PATH");
}

function getOrdersPath() {
  return getDataPath("orders", ordersPathOverride, "DROPSHIPPING_ORDERS_PATH");
}

function getFulfillmentActionsPath() {
  return getDataPath("fulfillment_actions", fulfillmentActionsPathOverride, "DROPSHIPPING_FULFILLMENT_ACTIONS_PATH");
}

function getCapitalPlansPath() {
  return getDataPath("capital_plans", capitalPlansPathOverride, "DROPSHIPPING_CAPITAL_PLANS_PATH");
}

function getGrowthSprintsPath() {
  return getDataPath("growth_sprints", growthSprintsPathOverride, "DROPSHIPPING_GROWTH_SPRINTS_PATH");
}

function getLaunchPacksPath() {
  return getDataPath("launch_packs", launchPacksPathOverride, "DROPSHIPPING_LAUNCH_PACKS_PATH");
}

function getAutopilotProductHunterRunsPath() {
  return getDataPath("autopilot_product_hunter_runs", autopilotProductHunterRunsPathOverride, "DROPSHIPPING_AUTOPILOT_PRODUCT_HUNTER_RUNS_PATH");
}

function getApprovalOutboxPath() {
  return getDataPath("approval_outbox", approvalOutboxPathOverride, "DROPSHIPPING_APPROVAL_OUTBOX_PATH");
}

function calculateProductEconomics(input: DropshippingProductResearchInput) {
  const landedCostUsd = Number((input.productCostUsd + input.shippingCostUsd).toFixed(2));
  const grossProfitUsd = Number((input.targetSellPriceUsd - landedCostUsd).toFixed(2));
  const grossMarginPercent = input.targetSellPriceUsd > 0 ? Math.round((grossProfitUsd / input.targetSellPriceUsd) * 100) : 0;
  const breakEvenOrdersAtBudget = grossProfitUsd > 0 ? Math.ceil(STARTING_MONTHLY_BUDGET_USD / grossProfitUsd) : null;
  const priceGapVsCompetitorUsd = input.competitorPriceUsd > 0 ? Number((input.targetSellPriceUsd - input.competitorPriceUsd).toFixed(2)) : 0;

  return {
    productCostUsd: input.productCostUsd,
    shippingCostUsd: input.shippingCostUsd,
    landedCostUsd,
    targetSellPriceUsd: input.targetSellPriceUsd,
    grossProfitUsd,
    grossMarginPercent,
    breakEvenOrdersAtBudget,
    targetMonthlyRevenueUsd: TARGET_MONTHLY_REVENUE_USD,
    ordersNeededForTargetRevenue: Math.ceil(TARGET_MONTHLY_REVENUE_USD / input.targetSellPriceUsd),
    priceGapVsCompetitorUsd,
    insideBudget: landedCostUsd <= STARTING_MONTHLY_BUDGET_USD,
  };
}

function buildProductScorecard(input: DropshippingProductResearchInput, economics = calculateProductEconomics(input)) {
  const marginScore = economics.grossMarginPercent >= 60 ? 30 : economics.grossMarginPercent >= 45 ? 20 : economics.grossMarginPercent >= 30 ? 10 : 0;
  const supplierScore = input.supplierRating >= 4.5 && input.reviewCount >= 300 ? 25 : input.supplierRating >= 4 && input.reviewCount >= 100 ? 18 : input.supplierRating >= 3.7 ? 10 : 0;
  const shippingScore = input.shippingDaysMax <= 10 ? 20 : input.shippingDaysMax <= 18 ? 14 : input.shippingDaysMax <= 30 ? 7 : 0;
  const demandScore = input.estimatedMonthlyDemand >= 500 ? 15 : input.estimatedMonthlyDemand >= 100 ? 10 : input.estimatedMonthlyDemand >= 25 ? 5 : 0;
  const riskScore = input.legalRisk === "low" && input.qualityRisk === "low" ? 10 : input.legalRisk === "high" || input.qualityRisk === "high" ? 0 : 5;
  const total = marginScore + supplierScore + shippingScore + demandScore + riskScore;

  return {
    total,
    grade: total >= 80 ? "A" : total >= 65 ? "B" : total >= 50 ? "C" : "D",
    components: { marginScore, supplierScore, shippingScore, demandScore, riskScore },
    pass: total >= 65 && economics.grossProfitUsd > 0 && input.legalRisk !== "high" && input.qualityRisk !== "high",
  };
}

const productScoutLibrary: Array<DropshippingProductScoutCandidateInput & { focusTags: DropshippingProductScoutBatchInput["focusNiche"][] }> = [
  {
    candidateName: "Kitchen sink organizer rack",
    niche: "kitchen_organization",
    trendSource: "shopify_2026",
    supplierPlatform: "aliexpress",
    sourceUrl: "https://www.shopify.com/blog/best-dropshipping-products",
    sourceLabel: "Shopify 2026 dropshipping products: kitchen organizers and storage",
    demandSignal: "strong",
    problemSolved: "Organiza el fregadero y muestra un antes/despues visual en segundos.",
    contentAngle: "Before/after de cocina pequena: desorden visible a setup limpio.",
    targetAudience: "personas en apartamentos, cocinas pequenas y compradores de organizacion",
    estimatedProductCostUsd: 4,
    estimatedShippingCostUsd: 3,
    targetSellPriceUsd: 19.99,
    competitorPriceUsd: 24,
    estimatedMonthlyDemand: 600,
    supplierRating: 4.5,
    reviewCount: 500,
    shippingDaysMin: 7,
    shippingDaysMax: 18,
    legalRisk: "low",
    qualityRisk: "medium",
    requiresSample: false,
    notes: "Producto visual, bajo ticket y facil de demostrar organicamente.",
    focusTags: ["mixed", "home_problem_solvers", "kitchen_organization"],
  },
  {
    candidateName: "Silicone drain protector",
    niche: "home_problem_solvers",
    trendSource: "shopify_2026",
    supplierPlatform: "aliexpress",
    sourceUrl: "https://www.shopify.com/blog/best-dropshipping-products",
    sourceLabel: "Shopify 2026 dropshipping products: silicone drain protectors",
    demandSignal: "strong",
    problemSolved: "Reduce pelos/residuos en drenajes con una solucion barata y demostrable.",
    contentAngle: "Demo rapida: lo que queda atrapado despues de una ducha o lavado.",
    targetAudience: "hogares, renters, estudiantes y compradores de hacks de limpieza",
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
    notes: "Ideal para bundle de 2-4 unidades y contenido de problema visible.",
    focusTags: ["mixed", "home_problem_solvers"],
  },
  {
    candidateName: "Car seat gap organizer",
    niche: "car_accessories",
    trendSource: "shopify_2026",
    supplierPlatform: "aliexpress",
    sourceUrl: "https://www.shopify.com/blog/best-dropshipping-products",
    sourceLabel: "Shopify 2026 dropshipping products: car accessories",
    demandSignal: "strong",
    problemSolved: "Evita que telefono, monedas y llaves caigan entre asiento y consola.",
    contentAngle: "POV del problema en el carro y solucion en 3 segundos.",
    targetAudience: "conductores, rideshare, commuters y compradores de accesorios para carro",
    estimatedProductCostUsd: 5,
    estimatedShippingCostUsd: 4,
    targetSellPriceUsd: 24.99,
    competitorPriceUsd: 29.99,
    estimatedMonthlyDemand: 450,
    supplierRating: 4.3,
    reviewCount: 350,
    shippingDaysMin: 8,
    shippingDaysMax: 22,
    legalRisk: "low",
    qualityRisk: "medium",
    requiresSample: true,
    notes: "Pedir sample antes de escalar porque fit por vehiculo puede variar.",
    focusTags: ["mixed", "car_accessories"],
  },
  {
    candidateName: "Pet water bottle for walks",
    niche: "pet_supplies",
    trendSource: "shopify_2026",
    supplierPlatform: "aliexpress",
    sourceUrl: "https://www.shopify.com/blog/best-dropshipping-products",
    sourceLabel: "Shopify 2026 dropshipping products: pet water bottles",
    demandSignal: "strong",
    problemSolved: "Permite dar agua al perro durante caminatas sin bowl separado.",
    contentAngle: "Walk routine con mascota: problema de sed y solucion portatil.",
    targetAudience: "duenos de perros, caminatas, parques y viajes cortos",
    estimatedProductCostUsd: 4.5,
    estimatedShippingCostUsd: 3.5,
    targetSellPriceUsd: 21.99,
    competitorPriceUsd: 24.99,
    estimatedMonthlyDemand: 400,
    supplierRating: 4.5,
    reviewCount: 450,
    shippingDaysMin: 7,
    shippingDaysMax: 18,
    legalRisk: "low",
    qualityRisk: "medium",
    requiresSample: true,
    notes: "Buen contenido si Robert consigue demo con mascota o UGC aprobado.",
    focusTags: ["mixed", "pet_supplies"],
  },
  {
    candidateName: "Reusable silicone face mask cover",
    niche: "beauty_low_claims",
    trendSource: "shopify_2026",
    supplierPlatform: "aliexpress",
    sourceUrl: "https://www.shopify.com/blog/best-dropshipping-products",
    sourceLabel: "Shopify 2026 dropshipping products: reusable silicone masks",
    demandSignal: "medium",
    problemSolved: "Ayuda a mantener mascarillas/skincare en sitio durante rutinas.",
    contentAngle: "GRWM sin claims medicos: rutina organizada y reusable.",
    targetAudience: "skincare fans, GRWM creators y compradores de beauty tools",
    estimatedProductCostUsd: 2.5,
    estimatedShippingCostUsd: 2.5,
    targetSellPriceUsd: 14.99,
    competitorPriceUsd: 17.99,
    estimatedMonthlyDemand: 300,
    supplierRating: 4.2,
    reviewCount: 250,
    shippingDaysMin: 8,
    shippingDaysMax: 24,
    legalRisk: "medium",
    qualityRisk: "medium",
    requiresSample: true,
    notes: "Solo usar copy cosmetico simple; bloquear claims de resultados de piel.",
    focusTags: ["mixed", "beauty_low_claims"],
  },
];

function calculateScoutEconomics(input: DropshippingProductScoutCandidateInput) {
  const researchLikeInput: DropshippingProductResearchInput = {
    productName: input.candidateName,
    niche: input.niche,
    trendSource: input.trendSource === "shopify_2026" || input.trendSource === "aliexpress" ? "manual" : input.trendSource,
    supplierPlatform: input.supplierPlatform,
    productCostUsd: input.estimatedProductCostUsd,
    shippingCostUsd: input.estimatedShippingCostUsd,
    targetSellPriceUsd: input.targetSellPriceUsd,
    estimatedMonthlyDemand: input.estimatedMonthlyDemand,
    competitorPriceUsd: input.competitorPriceUsd,
    supplierRating: input.supplierRating,
    reviewCount: input.reviewCount,
    shippingDaysMin: input.shippingDaysMin,
    shippingDaysMax: input.shippingDaysMax,
    returnPolicy: "",
    evidence: `${input.sourceLabel || "Product Scout source"}: ${input.problemSolved} ${input.contentAngle}`.slice(0, 1500),
    legalRisk: input.legalRisk,
    qualityRisk: input.qualityRisk,
    requiresSample: input.requiresSample,
  };
  const economics = calculateProductEconomics(researchLikeInput);
  return {
    economics: {
      landedCostUsd: economics.landedCostUsd,
      grossProfitUsd: economics.grossProfitUsd,
      grossMarginPercent: economics.grossMarginPercent,
      breakEvenOrdersAtBudget: economics.breakEvenOrdersAtBudget,
      ordersNeededForTargetRevenue: economics.ordersNeededForTargetRevenue,
    },
    researchInput: researchLikeInput,
  };
}

function productSignalKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function readLiveProductSignalFeed() {
  const sources: string[] = [];
  const warnings: string[] = [];
  const rawSignals: unknown[] = [];
  const json = (process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON || "").trim();
  const filePath = (process.env.DROPSHIPPING_LIVE_PRODUCT_SIGNALS_PATH || "").trim();

  if (json) {
    sources.push("DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON");
    try {
      const parsed = JSON.parse(json) as unknown;
      rawSignals.push(...(Array.isArray(parsed) ? parsed : Array.isArray((parsed as { signals?: unknown[] })?.signals) ? (parsed as { signals: unknown[] }).signals : []));
    } catch (_error) {
      warnings.push("live_signals_json_invalid");
    }
  }

  if (filePath) {
    sources.push("DROPSHIPPING_LIVE_PRODUCT_SIGNALS_PATH");
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      rawSignals.push(...(Array.isArray(parsed) ? parsed : Array.isArray((parsed as { signals?: unknown[] })?.signals) ? (parsed as { signals: unknown[] }).signals : []));
    } catch (_error) {
      warnings.push("live_signals_path_unreadable_or_invalid");
    }
  }

  const signals = rawSignals.flatMap((item) => {
    const parsed = liveProductSignalSchema.safeParse(item);
    if (!parsed.success) {
      warnings.push("live_signal_record_invalid");
      return [];
    }
    return [parsed.data];
  });

  return {
    status: signals.some((signal) => signal.status === "verified") ? "connected" as const : sources.length ? "partial" as const : "not_connected" as const,
    sources,
    warnings,
    signals,
  };
}

function liveSignalsForCandidate(input: Pick<DropshippingProductScoutCandidateInput, "candidateName">) {
  const feed = readLiveProductSignalFeed();
  const candidateKey = productSignalKey(input.candidateName);
  const signals = feed.signals.filter((signal) => {
    const signalKey = productSignalKey(signal.candidateName);
    return signalKey === candidateKey;
  });
  return { ...feed, signals };
}

function buildScoutLiveValidation(input: DropshippingProductScoutCandidateInput) {
  const feed = liveSignalsForCandidate(input);
  const connectedSources = Array.from(new Set(feed.signals.map((signal) => signal.source)));
  const verifiedSources = Array.from(new Set(feed.signals.filter((signal) => signal.status === "verified").map((signal) => signal.source)));
  const liveScore = Math.min(100, Math.round(feed.signals.reduce((sum, signal) => {
    const statusScore = signal.status === "verified" ? signal.evidenceScore : signal.status === "needs_review" ? Math.round(signal.evidenceScore * 0.4) : -8;
    const confidenceBonus = signal.confidence === "high" ? 6 : signal.confidence === "medium" ? 3 : 0;
    return sum + statusScore + confidenceBonus;
  }, 0)));
  const requiredSources: DropshippingLiveProductSignalSource[] = ["tiktok_search", "aliexpress_search"];
  const demandProofSources: DropshippingLiveProductSignalSource[] = ["google_trends", "competitor_scan"];
  const missingCore = [
    ...requiredSources.filter((source) => !verifiedSources.includes(source)),
    ...(!demandProofSources.some((source) => verifiedSources.includes(source)) ? ["google_trends_or_competitor_scan"] : []),
  ];
  const scoreBonus = Math.min(20, Math.max(0, Math.round(liveScore / 5)));
  const scorePenalty = feed.status === "not_connected" ? 12 : missingCore.length * 4 + feed.warnings.length * 2;
  const blockers = [
    ...missingCore.map((source) => `Falta senal verificada de ${source}.`),
    ...feed.warnings,
  ];

  return {
    status: feed.status === "connected" && missingCore.length === 0 ? "connected" as const : feed.status === "not_connected" ? "not_connected" as const : "partial" as const,
    connectedSources,
    verifiedSources,
    liveScore,
    scoreBonus,
    scorePenalty,
    signals: feed.signals,
    blockers,
    updatedAt: new Date().toISOString(),
  };
}

function demandSignalRank(value: DropshippingProductScoutCandidateInput["demandSignal"]) {
  return value === "breakout" ? 4 : value === "strong" ? 3 : value === "medium" ? 2 : 1;
}

function strongerDemandSignal(current: DropshippingProductScoutCandidateInput["demandSignal"], next?: DropshippingProductScoutCandidateInput["demandSignal"]) {
  if (!next) return current;
  return demandSignalRank(next) > demandSignalRank(current) ? next : current;
}

function weakerRisk(current: "low" | "medium" | "high", next?: "low" | "medium" | "high") {
  if (!next) return current;
  const rank = { low: 1, medium: 2, high: 3 };
  return rank[next] > rank[current] ? next : current;
}

function enrichScoutInputWithLiveSignals(input: DropshippingProductScoutCandidateInput, liveValidation: ReturnType<typeof buildScoutLiveValidation>) {
  const verifiedSignals = liveValidation.signals.filter((signal) => signal.status === "verified");
  return verifiedSignals.reduce<DropshippingProductScoutCandidateInput>((next, signal) => ({
    ...next,
    demandSignal: strongerDemandSignal(next.demandSignal, signal.demandSignal),
    estimatedMonthlyDemand: Math.max(next.estimatedMonthlyDemand, signal.estimatedMonthlyDemand || 0),
    supplierRating: signal.supplierRating !== undefined ? Math.max(next.supplierRating, signal.supplierRating) : next.supplierRating,
    reviewCount: signal.reviewCount !== undefined ? Math.max(next.reviewCount, signal.reviewCount) : next.reviewCount,
    shippingDaysMax: signal.shippingDaysMax !== undefined ? Math.min(next.shippingDaysMax, signal.shippingDaysMax) : next.shippingDaysMax,
    competitorPriceUsd: signal.competitorPriceUsd !== undefined ? signal.competitorPriceUsd : next.competitorPriceUsd,
    legalRisk: weakerRisk(next.legalRisk, signal.legalRisk),
    qualityRisk: weakerRisk(next.qualityRisk, signal.qualityRisk),
  }), input);
}

export function getDropshippingLiveSignalReadiness() {
  const feed = readLiveProductSignalFeed();
  const sourceCounts = feed.signals.reduce<Record<string, number>>((counts, signal) => {
    counts[signal.source] = (counts[signal.source] || 0) + 1;
    return counts;
  }, {});
  const verifiedSignals = feed.signals.filter((signal) => signal.status === "verified").length;
  const verifiedSources = Array.from(new Set(feed.signals.filter((signal) => signal.status === "verified").map((signal) => signal.source)));
  const coreReady = verifiedSources.includes("tiktok_search")
    && verifiedSources.includes("aliexpress_search")
    && (verifiedSources.includes("google_trends") || verifiedSources.includes("competitor_scan"));
  const status = coreReady ? "connected" as const : feed.sources.length > 0 ? "partial" as const : "not_connected" as const;
  return {
    status,
    configured: feed.sources.length > 0,
    sources: feed.sources,
    totalSignals: feed.signals.length,
    verifiedSignals,
    verifiedSources,
    sourceCounts,
    warnings: feed.warnings,
    requiredEnv: [
      "DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON",
      "or DROPSHIPPING_LIVE_PRODUCT_SIGNALS_PATH",
    ],
    recommendedSources: ["tiktok_search", "aliexpress_search", "google_trends", "competitor_scan"],
  };
}

function buildScoutScorecard(
  input: DropshippingProductScoutCandidateInput,
  economics = calculateScoutEconomics(input).economics,
  liveValidation?: ReturnType<typeof buildScoutLiveValidation>,
) {
  const marginScore = economics.grossMarginPercent >= 60 ? 30 : economics.grossMarginPercent >= 45 ? 22 : economics.grossMarginPercent >= 30 ? 12 : 0;
  const demandScore = input.demandSignal === "breakout" ? 25 : input.demandSignal === "strong" ? 20 : input.demandSignal === "medium" ? 12 : 4;
  const contentScore = input.contentAngle.length >= 20 && input.problemSolved.length >= 20 ? 20 : 10;
  const supplierScore = input.supplierRating >= 4.5 && input.reviewCount >= 300 ? 15 : input.supplierRating >= 4 && input.reviewCount >= 100 ? 10 : 4;
  const riskScore = input.legalRisk === "low" && input.qualityRisk === "low" ? 10 : input.legalRisk === "high" || input.qualityRisk === "high" ? 0 : 5;
  const liveSignalScore = liveValidation ? Math.max(-20, Math.min(20, liveValidation.scoreBonus - liveValidation.scorePenalty)) : 0;
  const total = marginScore + demandScore + contentScore + supplierScore + riskScore + liveSignalScore;
  return {
    total,
    grade: total >= 85 ? "A" as const : total >= 70 ? "B" as const : total >= 55 ? "C" as const : "D" as const,
    components: { marginScore, demandScore, contentScore, supplierScore, riskScore, liveSignalScore },
    pass: total >= 70 && economics.grossProfitUsd > 0 && input.legalRisk !== "high" && input.qualityRisk !== "high",
  };
}

function encodedQuery(value: string) {
  return encodeURIComponent(value.trim().replace(/\s+/g, " "));
}

function buildScoutValidation(
  input: DropshippingProductScoutCandidateInput,
  scorecard: ReturnType<typeof buildScoutScorecard>,
  liveValidation: ReturnType<typeof buildScoutLiveValidation>,
) {
  const query = encodedQuery(input.candidateName);
  const evidence: DropshippingProductScoutCandidate["validation"]["evidence"] = [
    {
      source: "tiktok_creative_center",
      label: "TikTok Creative Center trend/ad check",
      url: `https://ads.tiktok.com/creative/creativeCenter?query=${query}`,
      status: "needs_review",
      signal: "Buscar top ads, hooks, engagement y formato creativo antes de aprobar.",
    },
    {
      source: "tiktok_search",
      label: "TikTok search validation",
      url: `https://www.tiktok.com/search?q=${query}`,
      status: "needs_review",
      signal: "Confirmar videos reales, comments de compra y repeticion del problema.",
    },
    {
      source: "aliexpress_search",
      label: "AliExpress supplier scan",
      url: `https://www.aliexpress.us/w/wholesale-${query}.html`,
      status: "needs_review",
      signal: "Confirmar proveedor, reviews, ordenes, fotos reales, shipping y returns.",
    },
    {
      source: "google_trends",
      label: "Google Trends interest check",
      url: `https://trends.google.com/trends/explore?geo=US&q=${query}`,
      status: "needs_review",
      signal: "Validar que la demanda no sea solo una idea aislada.",
    },
  ];
  if (input.sourceUrl) {
    evidence.unshift({
      source: input.trendSource === "shopify_2026" ? "shopify_trends" : "manual",
      label: input.sourceLabel || "Seed trend source",
      url: input.sourceUrl,
      status: "seed_reference",
      signal: "Referencia inicial, no prueba suficiente para gastar ads.",
    });
  }
  const liveBySource = new Map(liveValidation.signals.map((signal) => [signal.source, signal]));
  const hydratedEvidence = evidence.map((item) => {
    const liveSignal = liveBySource.get(item.source);
    if (!liveSignal) return item;
    return {
      ...item,
      label: liveSignal.label || item.label,
      url: liveSignal.url || item.url,
      status: liveSignal.status === "verified" ? "verified" as const : liveSignal.status,
      signal: liveSignal.signal || item.signal,
    };
  });

  const evidenceScore = [
    input.sourceUrl ? 12 : 0,
    input.demandSignal === "breakout" ? 20 : input.demandSignal === "strong" ? 14 : input.demandSignal === "medium" ? 8 : 2,
    input.supplierRating >= 4.5 && input.reviewCount >= 300 ? 16 : input.supplierRating >= 4 && input.reviewCount >= 100 ? 10 : 3,
    input.shippingDaysMax <= 18 ? 10 : input.shippingDaysMax <= 25 ? 6 : 2,
    scorecard.total >= 85 ? 12 : scorecard.total >= 70 ? 8 : 3,
    Math.max(0, Math.min(30, liveValidation.liveScore)),
  ].reduce((sum, item) => sum + item, 0);
  const confidence: DropshippingProductScoutCandidate["validation"]["confidence"] = evidenceScore >= 85 ? "high" : evidenceScore >= 55 ? "medium" : "low";
  const externallyValidated = liveValidation.verifiedSources.includes("tiktok_search")
    && liveValidation.verifiedSources.includes("aliexpress_search")
    && (liveValidation.verifiedSources.includes("google_trends") || liveValidation.verifiedSources.includes("competitor_scan"));
  return {
    status: externallyValidated ? "externally_validated" as const : input.sourceUrl ? "needs_external_validation" as const : "seed_only" as const,
    confidence,
    evidenceScore,
    evidence: hydratedEvidence,
    missingProof: [
      ...liveValidation.blockers,
      "captura o link de 3-5 videos TikTok/Creative Center con senal real",
      "supplier principal y backup verificados con shipping/returns",
      "comparacion de 3 competidores y precio final",
      "primer contenido organico medido antes de ads",
    ],
    liveValidation,
  };
}

function buildScoutCandidateStatus(input: DropshippingProductScoutCandidateInput, scorecard: ReturnType<typeof buildScoutScorecard>) {
  if (input.legalRisk === "high" || input.qualityRisk === "high" || scorecard.total < 45) return "rejected" as const;
  if (scorecard.pass) return "needs_tiktok_validation" as const;
  if (input.supplierRating < 4 || input.reviewCount < 100) return "needs_supplier" as const;
  return "seed_candidate" as const;
}

export function createDropshippingProductScoutCandidate(input: DropshippingProductScoutCandidateInput) {
  loadAll();
  const parsed = dropshippingProductScoutCandidateSchema.parse(input);
  const rawLiveValidation = buildScoutLiveValidation(parsed);
  const enriched = enrichScoutInputWithLiveSignals(parsed, rawLiveValidation);
  const liveValidation = buildScoutLiveValidation(enriched);
  const { economics, researchInput } = calculateScoutEconomics(enriched);
  const scorecard = buildScoutScorecard(enriched, economics, liveValidation);
  const status = buildScoutCandidateStatus(enriched, scorecard);
  const now = new Date().toISOString();
  const candidate: DropshippingProductScoutCandidate = {
    ...enriched,
    id: `drop-scout-${Date.now()}-${productScoutCandidates.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status,
    validation: buildScoutValidation(enriched, scorecard, liveValidation),
    scorecard,
    economics,
    researchInput,
    nextActions:
      status === "needs_tiktok_validation"
        ? [
          liveValidation.status === "not_connected" ? "conectar live signal feed antes de gastar" : "revisar fuentes live verificadas",
          "validar en TikTok/Creative Center",
          "buscar supplier backup",
          "crear hooks organicos",
        ]
        : status === "needs_supplier"
          ? ["buscar proveedor con rating/reviews mejores", "confirmar shipping y tracking", "no gastar todavia"]
          : status === "seed_candidate"
            ? ["comparar contra otros candidatos", "mejorar evidencia de demanda", "revisar margen"]
            : ["descartar por riesgo o baja senal", "no usar budget"],
    promotedProductId: "",
  };
  productScoutCandidates.unshift(candidate);
  persistProductScoutCandidates();
  return { candidate, snapshot: getDropshippingCeoSnapshot() };
}

export function runDropshippingProductScoutBatch(input: Partial<DropshippingProductScoutBatchInput> = {}) {
  loadAll();
  const parsed = dropshippingProductScoutBatchSchema.parse(input);
  const selected = productScoutLibrary
    .filter((candidate) => candidate.focusTags.includes(parsed.focusNiche))
    .slice(0, parsed.maxCandidates);
  const existingNames = new Set(productScoutCandidates.map((candidate) => candidate.candidateName.toLowerCase()));
  const created = selected
    .filter((candidate) => !existingNames.has(candidate.candidateName.toLowerCase()))
    .map(({ focusTags: _focusTags, ...candidate }) => createDropshippingProductScoutCandidate({
      ...candidate,
      notes: [candidate.notes, parsed.notes].filter(Boolean).join(" "),
    }).candidate);
  const topCandidate = (created.length ? created : productScoutCandidates)
    .filter((candidate) => candidate.status !== "rejected")
    .sort((a, b) => b.scorecard.total - a.scorecard.total)[0] || null;

  return {
    status: "completed" as const,
    focusNiche: parsed.focusNiche,
    budgetUsd: parsed.budgetUsd,
    spentUsd: 0,
    createdCandidates: created,
    topCandidate,
    summary: created.length
      ? `Product Scout creo ${created.length} candidato(s) sin gastar dinero. Top: ${topCandidate?.candidateName || "none"}.`
      : "Product Scout no duplico candidatos existentes; revisa shortlist actual.",
    snapshot: getDropshippingCeoSnapshot(),
  };
}

export function promoteDropshippingScoutCandidate(input: DropshippingProductScoutPromotionInput) {
  loadAll();
  const parsed = dropshippingProductScoutPromotionSchema.parse(input);
  const candidate = productScoutCandidates.find((item) => item.id === parsed.candidateId);
  if (!candidate) {
    throw new Error("Product Scout candidate not found.");
  }
  if (candidate.status === "rejected") {
    throw new Error("Rejected Product Scout candidate cannot be promoted.");
  }
  if (candidate.promotedProductId) {
    const existingProduct = products.find((product) => product.id === candidate.promotedProductId) || null;
    return { candidate, product: existingProduct, snapshot: getDropshippingCeoSnapshot() };
  }

  const product = researchDropshippingProduct({
    ...candidate.researchInput,
    evidence: `${candidate.researchInput.evidence} Source: ${candidate.sourceUrl || candidate.sourceLabel || "Product Scout"}. ${parsed.notes}`.slice(0, 1500),
  }).product;
  candidate.status = "promoted";
  candidate.updatedAt = new Date().toISOString();
  candidate.promotedProductId = product.id;
  candidate.nextActions = [
    "crear supplier review",
    "crear launch plan draft",
    "crear sprint organico sin gasto",
  ];
  persistProductScoutCandidates();
  return { candidate, product, snapshot: getDropshippingCeoSnapshot() };
}

function rankAutopilotCandidates(candidateList: DropshippingProductScoutCandidate[]) {
  return candidateList
    .filter((candidate) => candidate.status !== "rejected")
    .map((candidate) => {
      const samplePenalty = candidate.requiresSample ? 6 : 0;
      const shippingPenalty = candidate.shippingDaysMax > 21 ? 10 : candidate.shippingDaysMax > 18 ? 4 : 0;
      const qualityPenalty = candidate.qualityRisk === "medium" ? 4 : candidate.qualityRisk === "high" ? 30 : 0;
      const legalPenalty = candidate.legalRisk === "medium" ? 6 : candidate.legalRisk === "high" ? 40 : 0;
      const sourceBonus = candidate.validation.evidence.some((item) => (item.source === "tiktok_creative_center" || item.source === "tiktok_search") && item.status === "verified") ? 6 : 0;
      const score = candidate.scorecard.total + candidate.validation.evidenceScore + sourceBonus - samplePenalty - shippingPenalty - qualityPenalty - legalPenalty;
      return {
        candidate,
        score,
        reason: [
          `${candidate.scorecard.grade}${candidate.scorecard.total} product score`,
          `${candidate.economics.grossMarginPercent}% margin`,
          `${candidate.validation.confidence} confidence`,
          `live ${candidate.validation.liveValidation.status} ${candidate.validation.liveValidation.liveScore}/100`,
          candidate.requiresSample ? "sample recommended before scale" : "no sample required for first organic prep",
        ].join(" / "),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function candidateMatchesAutopilotFocus(candidate: DropshippingProductScoutCandidate, focusNiche: DropshippingAutopilotProductHunterInput["focusNiche"]) {
  if (focusNiche === "mixed") return true;
  const libraryMatch = productScoutLibrary.find((item) => item.candidateName.toLowerCase() === candidate.candidateName.toLowerCase());
  return candidate.niche === focusNiche || Boolean(libraryMatch?.focusTags.includes(focusNiche));
}

export function runDropshippingAutopilotProductHunter(input: Partial<DropshippingAutopilotProductHunterInput> = {}) {
  loadAll();
  const parsed = dropshippingAutopilotProductHunterSchema.parse(input);
  const batch = runDropshippingProductScoutBatch({
    focusNiche: parsed.focusNiche,
    maxCandidates: parsed.maxCandidates,
    budgetUsd: 0,
    notes: [parsed.notes, "Autopilot hunter: seed scan only, no spend, no publishing."].filter(Boolean).join(" "),
  });
  const scopedCandidates = batch.createdCandidates.length
    ? batch.createdCandidates
    : productScoutCandidates.filter((candidate) => candidateMatchesAutopilotFocus(candidate, parsed.focusNiche));
  const ranked = rankAutopilotCandidates(scopedCandidates);
  const now = new Date().toISOString();

  if (!ranked.length) {
    const run: DropshippingAutopilotProductHunterRun = {
      ...parsed,
      id: `drop-autopilot-hunter-${Date.now()}-${autopilotProductHunterRuns.length + 1}`,
      createdAt: now,
      status: "blocked_no_candidate",
      winnerCandidateId: "",
      winnerProductId: "",
      supplierId: "",
      launchPackId: "",
      confidence: "low",
      summary: "Autopilot no encontro candidato aceptable. No se preparo launch ni gasto.",
      rankedCandidates: [],
      approvalRequired: [],
      nextActions: ["correr otro niche", "agregar evidencia manual", "no gastar"],
      safety: {
        spentUsd: 0,
        publishedExternally: false,
        inventoryPurchased: false,
        message: "No se ejecuto ninguna accion externa.",
      },
    };
    autopilotProductHunterRuns.unshift(run);
    persistAutopilotProductHunterRuns();
    return { run, batch, product: null, supplier: null, launchPack: null, approvalsPreview: null, snapshot: getDropshippingCeoSnapshot() };
  }

  const winner = ranked[0].candidate;
  const promoted = promoteDropshippingScoutCandidate({
    candidateId: winner.id,
    approvalToPromote: true,
    notes: "Autopilot winner selected for Robert review. Still requires external validation before spend.",
  });
  const product = promoted.product;
  const supplierResult = reviewDropshippingSupplier({
    supplierName: `${winner.supplierPlatform} supplier candidate`,
    platform: winner.supplierPlatform,
    productName: winner.candidateName,
    rating: winner.supplierRating,
    reviewCount: winner.reviewCount,
    ordersCount: Math.max(100, winner.reviewCount),
    shipsFrom: "China",
    estimatedShippingDays: winner.shippingDaysMax,
    hasTracking: true,
    hasReturns: winner.qualityRisk === "low",
    hasMultipleSuppliers: false,
    notes: `Autopilot supplier precheck. Verify manually before first paid order. Source: ${winner.sourceUrl || winner.sourceLabel || "seed"}`,
  });
  const launchPackResult = buildDropshippingLaunchPack({
    productId: product?.id || "",
    mode: "starter_validation",
    dailyOrganicPosts: parsed.dailyOrganicPosts,
    platforms: ["tiktok", "instagram"],
    postsPerPlatform: parsed.postsPerPlatform,
    requestedBudgetUsd: parsed.requestedBudgetUsd,
    approvalToPrepareDraft: false,
    approvalToPublish: false,
    approvalToSpend: false,
    notes: "Autopilot prepared package. Robert must approve product, Shopify draft, social posts and any spend.",
  });
  const approvalsPreview = prepareDropshippingLaunchPackApprovalQueue({
    launchPackId: launchPackResult.launchPack.id,
    includeSpendApproval: false,
    includeSampleApproval: false,
  });
  const approvalRequired: DropshippingAutopilotProductHunterRun["approvalRequired"] = [
    {
      actionType: "dropshipping.publish_product",
      title: `Aprobar producto ganador: ${winner.candidateName}`,
      reason: "Autopilot eligio este candidato, pero Robert debe aprobar antes de publicar.",
      maxSpendUsd: 0,
    },
    {
      actionType: "dropshipping.create_shopify_draft",
      title: `Preparar Shopify draft: ${winner.candidateName}`,
      reason: "Crear draft no publica el producto, pero sigue requiriendo aprobacion.",
      maxSpendUsd: 0,
    },
    {
      actionType: "dropshipping.publish_social",
      title: `Publicar posts organicos: ${winner.candidateName}`,
      reason: "Primero validar hooks organicos antes de ads.",
      maxSpendUsd: 0,
    },
  ];
  if (parsed.requestedBudgetUsd > 0) {
    approvalRequired.push({
      actionType: "dropshipping.spend",
      title: `Preparar micro test de ads: ${money.format(parsed.requestedBudgetUsd)}`,
      reason: "El budget queda locked hasta Profit Guard, evidencia y approval.",
      maxSpendUsd: parsed.requestedBudgetUsd,
    });
  }
  if (winner.requiresSample) {
    approvalRequired.push({
      actionType: "dropshipping.order_sample",
      title: `Pedir sample: ${winner.candidateName}`,
      reason: "Fit/calidad requieren muestra antes de escalar.",
      maxSpendUsd: winner.economics.landedCostUsd,
    });
  }

  const rankedCandidates = ranked.slice(0, parsed.maxCandidates).map((item, index) => ({
    candidateId: item.candidate.id,
    candidateName: item.candidate.candidateName,
    rank: index + 1,
    score: item.score,
    confidence: item.candidate.validation.confidence,
    evidenceScore: item.candidate.validation.evidenceScore,
    reason: item.reason,
  }));
  const run: DropshippingAutopilotProductHunterRun = {
    ...parsed,
    id: `drop-autopilot-hunter-${Date.now()}-${autopilotProductHunterRuns.length + 1}`,
    createdAt: now,
    status: "prepared_for_robert_review",
    winnerCandidateId: winner.id,
    winnerProductId: product?.id || "",
    supplierId: supplierResult.supplier.id,
    launchPackId: launchPackResult.launchPack.id,
    confidence: winner.validation.confidence,
    summary: `Autopilot recomienda ${winner.candidateName}. Paquete preparado para review: producto, supplier precheck, launch pack, social drafts y approvals. No se gasto ni publico nada.`,
    rankedCandidates,
    approvalRequired,
    nextActions: [
      "Robert revisa producto ganador y evidencia externa",
      "abrir links de TikTok/Creative Center/AliExpress si quiere validar manualmente",
      "aprobar producto/draft/posts antes de cualquier accion externa",
      parsed.requestedBudgetUsd > 0 ? "mantener ads locked hasta Profit Guard + approval" : "lanzar organico primero, sin ads",
    ],
    safety: {
      spentUsd: 0,
      publishedExternally: false,
      inventoryPurchased: false,
      message: "Autopilot solo preparo drafts y approvals. No compro, no publico, no gasto.",
    },
  };
  autopilotProductHunterRuns.unshift(run);
  persistAutopilotProductHunterRuns();
  return {
    run,
    batch,
    product,
    supplier: supplierResult.supplier,
    launchPack: launchPackResult.launchPack,
    approvalsPreview,
    snapshot: getDropshippingCeoSnapshot(),
  };
}

function buildProductSubagentReviews(input: DropshippingProductResearchInput, economics: ReturnType<typeof calculateProductEconomics>, scorecard: ReturnType<typeof buildProductScorecard>) {
  return [
    {
      agent: "Product Scout",
      verdict: scorecard.total >= 50 ? "pass" as const : "fix" as const,
      note: scorecard.total >= 50 ? "Producto viral con evidencia suficiente para investigar." : "Falta evidencia de demanda o diferenciacion.",
    },
    {
      agent: "Supplier Analyst",
      verdict: input.supplierRating >= 4 && input.reviewCount >= 100 ? "pass" as const : "fix" as const,
      note: input.supplierRating >= 4 && input.reviewCount >= 100 ? "Proveedor candidato; revisar backup antes de escalar." : "Proveedor debil; buscar alternativa antes de publicar.",
    },
    {
      agent: "Profit Guard",
      verdict: economics.grossMarginPercent >= 45 && economics.grossProfitUsd > 0 ? "pass" as const : "block" as const,
      note: economics.grossMarginPercent >= 45 && economics.grossProfitUsd > 0 ? "Margen suficiente para operar con budget bajo." : "Margen bajo o negativo; no gastar ni lanzar.",
    },
    {
      agent: "Legal / Compliance",
      verdict: input.legalRisk === "high" ? "block" as const : input.legalRisk === "medium" ? "fix" as const : "pass" as const,
      note: input.legalRisk === "high" ? "Riesgo legal alto: bloquear." : "Evitar claims de salud, marcas, resultados garantizados y promesas de envio no verificadas.",
    },
    {
      agent: "Customer Support",
      verdict: input.shippingDaysMax <= 21 && input.returnPolicy ? "pass" as const : "fix" as const,
      note: input.shippingDaysMax <= 21 && input.returnPolicy ? "Tiempo/politica comunicables." : "Falta politica clara o shipping lento; preparar copy honesto antes de vender.",
    },
  ];
}

function deriveProductStatus(
  input: DropshippingProductResearchInput,
  economics: ReturnType<typeof calculateProductEconomics>,
  scorecard: ReturnType<typeof buildProductScorecard>,
  reviews: ReturnType<typeof buildProductSubagentReviews>
) {
  if (reviews.some((review) => review.verdict === "block") || economics.grossProfitUsd <= 0) return "blocked" as const;
  if (input.requiresSample || input.qualityRisk === "medium") return "sample_recommended" as const;
  if (scorecard.pass) return "approval_required" as const;
  return "qualified" as const;
}

function productApprovals(input: DropshippingProductResearchInput, status: DropshippingProduct["status"]) {
  const approvals = ["aprobar producto antes de publicarlo", "aprobar cualquier gasto o sample", "aprobar posts antes de publicar"];
  if (input.requiresSample || status === "sample_recommended") approvals.push("aprobar compra de 1 muestra antes de escalar");
  return approvals;
}

export function researchDropshippingProduct(input: DropshippingProductResearchInput) {
  loadProducts();
  const parsed = dropshippingProductResearchSchema.parse(input);
  const economics = calculateProductEconomics(parsed);
  const scorecard = buildProductScorecard(parsed, economics);
  const subagentReviews = buildProductSubagentReviews(parsed, economics, scorecard);
  const status = deriveProductStatus(parsed, economics, scorecard, subagentReviews);
  const now = new Date().toISOString();
  const product: DropshippingProduct = {
    ...parsed,
    id: `drop-product-${Date.now()}-${products.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status,
    economics,
    scorecard,
    subagentReviews,
    requiredApprovals: productApprovals(parsed, status),
    nextActions:
      status === "blocked"
        ? ["buscar producto alternativo", "bajar costo o subir precio", "evitar claims/riesgos legales"]
        : status === "sample_recommended"
          ? ["buscar segundo proveedor", "preparar contenido draft", "pedir aprobacion para 1 muestra si el margen lo justifica"]
          : ["crear launch plan draft", "preparar 3 hooks de contenido", "pasar a aprobacion antes de publicar"],
  };

  products.unshift(product);
  persistProducts();
  return { product, snapshot: getDropshippingCeoSnapshot() };
}

export function reviewDropshippingSupplier(input: DropshippingSupplierReviewInput) {
  loadSuppliers();
  const parsed = dropshippingSupplierReviewSchema.parse(input);
  const riskFlags = [
    parsed.rating < 4 && "rating menor a 4",
    parsed.reviewCount < 100 && "pocas reviews",
    parsed.ordersCount < 100 && "pocas ordenes",
    parsed.estimatedShippingDays > 21 && "shipping lento",
    !parsed.hasTracking && "sin tracking",
    !parsed.hasReturns && "returns no claros",
    !parsed.hasMultipleSuppliers && "falta proveedor backup",
  ].filter(Boolean) as string[];
  const score =
    (parsed.rating >= 4.5 ? 25 : parsed.rating >= 4 ? 18 : 8) +
    (parsed.reviewCount >= 500 ? 20 : parsed.reviewCount >= 100 ? 12 : 4) +
    (parsed.ordersCount >= 500 ? 20 : parsed.ordersCount >= 100 ? 12 : 4) +
    (parsed.estimatedShippingDays <= 10 ? 15 : parsed.estimatedShippingDays <= 21 ? 9 : 2) +
    (parsed.hasTracking ? 10 : 0) +
    (parsed.hasReturns ? 5 : 0) +
    (parsed.hasMultipleSuppliers ? 5 : 0);
  const status = score >= 75 && riskFlags.length <= 2 ? "approved_candidate" : score >= 50 ? "needs_backup_supplier" : "blocked";
  const now = new Date().toISOString();
  const review: DropshippingSupplierReview = {
    ...parsed,
    id: `drop-supplier-${Date.now()}-${suppliers.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status,
    score,
    riskFlags,
    nextActions:
      status === "approved_candidate"
        ? ["guardar como proveedor candidato", "buscar backup", "no contactar ni ordenar sin aprobacion"]
        : status === "needs_backup_supplier"
          ? ["buscar proveedor alterno", "confirmar tracking/returns", "no publicar producto todavia"]
          : ["bloquear proveedor", "buscar otro supplier con mejor score"],
  };

  suppliers.unshift(review);
  persistSuppliers();
  return { supplier: review, snapshot: getDropshippingCeoSnapshot() };
}

export function buildDropshippingLaunchPlan(input: DropshippingLaunchPlanInput) {
  loadProducts();
  loadLaunchPlans();
  const parsed = dropshippingLaunchPlanSchema.parse(input);
  const product = products.find((item) => item.id === parsed.productId) || null;
  const blocked = !product || product.status === "blocked" || parsed.paidAdTestBudgetUsd > 0 && !parsed.approvalToSpend;
  const status = blocked
    ? "blocked" as const
    : parsed.approvalToPublish && (parsed.paidAdTestBudgetUsd === 0 || parsed.approvalToSpend)
      ? "ready_after_approval" as const
      : "approval_required" as const;
  const hooks = [
    "El producto viral que resuelve un problema diario sin ocupar espacio.",
    "Probando si esto merece estar en la tienda antes de gastar en ads.",
    "La version simple para mostrar beneficio, uso real y precio claro.",
    "Antes de comprar: mira costo, shipping y por que lo estamos validando.",
    "Oferta de prueba con stock del proveedor, sin inventario propio.",
  ];
  const contentCalendar = Array.from({ length: Math.max(1, parsed.dailyOrganicPosts) }, (_, index) => ({
    day: `Dia ${index + 1}`,
    channel: index % 2 === 0 ? "TikTok draft" : "Instagram Reel draft",
    hook: hooks[index % hooks.length],
    status: "needs_approval" as const,
  }));
  const now = new Date().toISOString();
  const plan: DropshippingLaunchPlan = {
    ...parsed,
    id: `drop-launch-${Date.now()}-${launchPlans.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status,
    product,
    contentCalendar,
    gatedActions: [
      "publicar producto en Shopify",
      "publicar contenido en redes",
      "activar ads",
      "ordenar sample",
      "contactar proveedor",
      "fulfillment de orden real",
    ],
    nextActions:
      status === "blocked"
        ? ["resolver producto o aprobacion de gasto", "mantener solo drafts internos"]
        : ["enviar approval para producto/posts/gasto", "preparar pagina Shopify draft", "medir contenido organico antes de ads"],
  };

  launchPlans.unshift(plan);
  persistLaunchPlans();
  return { launchPlan: plan, snapshot: getDropshippingCeoSnapshot() };
}

export function recordDropshippingLedgerEntry(input: DropshippingLedgerEntryInput) {
  loadLedger();
  const parsed = dropshippingLedgerEntrySchema.parse(input);
  const entry: DropshippingLedgerEntry = {
    ...parsed,
    id: `drop-ledger-${Date.now()}-${ledger.length + 1}`,
    createdAt: new Date().toISOString(),
  };
  ledger.unshift(entry);
  persistLedger();
  return { entry, snapshot: getDropshippingCeoSnapshot() };
}

function calculateOrderEconomics(input: DropshippingOrderInput, product: DropshippingProduct | null) {
  const grossRevenueUsd = Number((input.saleSubtotalUsd + input.shippingChargedUsd + input.taxCollectedUsd).toFixed(2));
  const estimatedUnitCostUsd = input.productCostUsd || product?.economics.landedCostUsd || product?.productCostUsd || 0;
  const estimatedCostUsd = Number(((estimatedUnitCostUsd * input.quantity) + input.supplierShippingUsd).toFixed(2));
  const estimatedProfitUsd = Number((grossRevenueUsd - estimatedCostUsd).toFixed(2));
  const grossMarginPercent = grossRevenueUsd > 0 ? Math.round((estimatedProfitUsd / grossRevenueUsd) * 100) : 0;
  return { grossRevenueUsd, estimatedCostUsd, estimatedProfitUsd, grossMarginPercent };
}

function deriveOrderStatus(input: DropshippingOrderInput, economics: ReturnType<typeof calculateOrderEconomics>) {
  if (input.paymentStatus === "refunded" || input.paymentStatus === "chargeback") return "refunded" as const;
  if (input.paymentStatus === "pending") return "pending_payment" as const;
  if (economics.estimatedProfitUsd <= 0) return "blocked" as const;
  return "approval_required" as const;
}

export function recordDropshippingOrder(input: DropshippingOrderInput) {
  loadAll();
  const parsed = dropshippingOrderSchema.parse(input);
  const product = products.find((item) => item.id === parsed.productId) || null;
  const economics = calculateOrderEconomics(parsed, product);
  const status = deriveOrderStatus(parsed, economics);
  const now = new Date().toISOString();
  let ledgerEntryId = "";

  if (parsed.paymentStatus === "paid" && economics.grossRevenueUsd > 0) {
    const ledgerEntry: DropshippingLedgerEntry = {
      kind: "sale",
      label: `Order ${parsed.externalOrderId || orderRecords.length + 1}: ${parsed.productName}`,
      productId: parsed.productId || product?.id || "",
      amountUsd: economics.grossRevenueUsd,
      cashCollectedUsd: economics.grossRevenueUsd,
      notes: `Auto ledger from dropshipping order. Estimated profit ${money.format(economics.estimatedProfitUsd)}.`,
      id: `drop-ledger-${Date.now()}-${ledger.length + 1}`,
      createdAt: now,
    };
    ledger.unshift(ledgerEntry);
    ledgerEntryId = ledgerEntry.id;
    persistLedger();
  }

  const order: DropshippingOrder = {
    ...parsed,
    id: `drop-order-${Date.now()}-${orderRecords.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status,
    product,
    ledgerEntryId,
    ...economics,
    requiredApprovals:
      status === "approval_required"
        ? ["aprobar fulfillment de orden pagada", "confirmar supplier y costo antes de comprar al proveedor"]
        : status === "pending_payment"
          ? ["confirmar pago antes de fulfillment"]
          : status === "blocked"
            ? ["revisar margen antes de cumplir orden"]
            : [],
    nextActions:
      status === "approval_required"
        ? ["preparar fulfillment dry-run", "verificar direccion fuera del sistema", "comprar al proveedor solo despues de approval"]
        : status === "pending_payment"
          ? ["esperar pago confirmado", "no contactar proveedor todavia"]
          : status === "blocked"
            ? ["pausar fulfillment", "revisar precio/costo/proveedor"]
            : ["registrar refund/chargeback y revisar customer support"],
  };

  orderRecords.unshift(order);
  persistOrders();
  return { order, ledgerEntryId, snapshot: getDropshippingCeoSnapshot() };
}

function applyApprovalDecisionToTargets(decision: DropshippingApprovalDecision) {
  if (decision.guardrail.status !== "recorded") return;
  const now = new Date().toISOString();

  if (decision.targetType === "product") {
    const product = products.find((item) => item.id === decision.targetId);
    if (product && decision.decision === "approved" && product.status !== "blocked") {
      product.status = "launch_ready";
      product.updatedAt = now;
      product.requiredApprovals = [];
      product.nextActions = ["crear launch plan", "preparar Shopify draft", "crear campana organica"];
      persistProducts();
    }
    if (product && decision.decision === "rejected") {
      product.status = "blocked";
      product.updatedAt = now;
      product.requiredApprovals = [];
      product.nextActions = ["descartar producto", "correr Autopilot Product Hunter otra vez", "no gastar en este producto"];
      persistProducts();
      const candidate = productScoutCandidates.find((item) => item.promotedProductId === product.id);
      if (candidate) {
        candidate.status = "rejected";
        candidate.updatedAt = now;
        candidate.nextActions = ["descartado por Robert", "no promover otra vez", "buscar otro candidato"];
        persistProductScoutCandidates();
      }
    }
    if (product && decision.decision === "needs_changes" && product.status !== "blocked") {
      product.status = "approval_required";
      product.updatedAt = now;
      product.requiredApprovals = ["resolver cambios pedidos por Robert antes de launch"];
      product.nextActions = ["ajustar oferta/evidencia/proveedor", "revisar producto otra vez", "mantener todo sin publicar"];
      persistProducts();
    }
  }

  if (decision.decision !== "approved") return;

  if (decision.targetType === "launch_plan") {
    const plan = launchPlans.find((item) => item.id === decision.targetId);
    if (plan && plan.status !== "blocked") {
      plan.status = "ready_after_approval";
      plan.updatedAt = now;
      plan.gatedActions = [];
      plan.nextActions = ["crear drafts Shopify/social", "mantener gasto dentro de Profit Guard"];
      persistLaunchPlans();
    }
  }

  if (decision.targetType === "marketing_campaign") {
    const campaign = marketingCampaigns.find((item) => item.id === decision.targetId);
    if (campaign && campaign.status !== "blocked") {
      campaign.status = "ready_after_approval";
      campaign.updatedAt = now;
      campaign.requiredApprovals = [];
      campaign.nextActions = ["crear posts", "preparar landing page draft", "medir resultados antes de escalar"];
      persistMarketingCampaigns();
    }
  }

  if (decision.targetType === "social_post") {
    const post = socialPosts.find((item) => item.id === decision.targetId);
    if (post && post.status !== "blocked" && post.status !== "published") {
      post.status = "queued";
      post.approvalToPublish = true;
      post.updatedAt = now;
      post.nextActions = ["publicar en dry-run/manual", "registrar metricas despues de publicar"];
      persistSocialPosts();
    }
  }

  if (decision.targetType === "order") {
    const order = orderRecords.find((item) => item.id === decision.targetId);
    if (order && order.status === "approval_required") {
      order.status = "ready_for_fulfillment";
      order.updatedAt = now;
      order.requiredApprovals = [];
      order.nextActions = ["preparar fulfillment", "confirmar supplier order id/tracking"];
      persistOrders();
    }
  }
}

export function recordDropshippingApprovalDecision(input: DropshippingApprovalDecisionInput) {
  loadAll();
  const parsed = dropshippingApprovalDecisionSchema.parse(input);
  const snapshot = getDropshippingCeoSnapshot();
  const projectedSpend = snapshot.metrics.totalSpendUsd + parsed.maxSpendUsd;
  const guardrail =
    parsed.maxSpendUsd > 0 && projectedSpend > snapshot.profitGuard.monthlyBudgetUsd
      ? { status: "blocked" as const, reason: `No aprobado: excede el budget activo de ${money.format(snapshot.profitGuard.monthlyBudgetUsd)}/mes.` }
      : parsed.maxSpendUsd > snapshot.profitGuard.canSpendUsd && parsed.maxSpendUsd > 0
        ? { status: "blocked" as const, reason: "No aprobado: Profit Guard exige cobrar o liberar presupuesto antes de gastar." }
        : { status: "recorded" as const, reason: "Decision registrada dentro del guardrail." };
  const decision: DropshippingApprovalDecision = {
    ...parsed,
    id: `drop-approval-${Date.now()}-${approvals.length + 1}`,
    createdAt: new Date().toISOString(),
    guardrail,
  };
  approvals.unshift(decision);
  persistApprovals();
  applyApprovalDecisionToTargets(decision);
  return { decision, snapshot: getDropshippingCeoSnapshot() };
}

export function recordDropshippingLearningReview(input: DropshippingLearningReviewInput) {
  loadLearningReviews();
  const parsed = dropshippingLearningReviewSchema.parse(input);
  const profitUsd = Number((parsed.revenueUsd - parsed.spendUsd - parsed.refundsUsd).toFixed(2));
  const conversionRatePercent = parsed.visitors > 0 ? Number(((parsed.orders / parsed.visitors) * 100).toFixed(2)) : 0;
  const addToCartRatePercent = parsed.visitors > 0 ? Number(((parsed.addToCarts / parsed.visitors) * 100).toFixed(2)) : 0;
  const roiPercent = parsed.spendUsd > 0 ? Math.round((profitUsd / parsed.spendUsd) * 100) : parsed.revenueUsd > 0 ? 100 : 0;
  const decisionStatus =
    parsed.refundsUsd > 0 || profitUsd < 0
      ? "pause_and_fix" as const
      : parsed.orders >= 3 && conversionRatePercent >= 1
        ? "scale_content" as const
        : "iterate_small" as const;
  const review: DropshippingLearningReview = {
    ...parsed,
    id: `drop-learning-${Date.now()}-${learningReviews.length + 1}`,
    createdAt: new Date().toISOString(),
    decisionStatus,
    metrics: { conversionRatePercent, addToCartRatePercent, profitUsd, roiPercent },
    playbookUpdates: [
      parsed.bestHook ? `Hook ganador: ${parsed.bestHook}` : "Registrar hook ganador antes de escalar.",
      parsed.biggestProblem ? `Problema principal: ${parsed.biggestProblem}` : "Medir objecion principal: precio, shipping, confianza o creatividad.",
      parsed.notes || "Guardar evidencia diaria y no escalar gasto sin ventas/cash.",
    ],
    nextBatch: {
      maxProducts: decisionStatus === "scale_content" ? 3 : 1,
      maxSpendUsd: decisionStatus === "scale_content" ? Math.min(100, Math.max(10, parsed.revenueUsd * 0.1)) : 0,
      requiredBeforeNextAction:
        decisionStatus === "pause_and_fix"
          ? ["resolver refunds/calidad/shipping", "revisar proveedor", "pausar ads y publicaciones externas"]
          : ["aprobar posts", "mantener organic primero", "guardar ventas/gastos en ledger"],
    },
  };
  learningReviews.unshift(review);
  persistLearningReviews();
  return { review, snapshot: getDropshippingCeoSnapshot() };
}

function pickBestDropshippingProduct() {
  const candidates = products.filter((product) => product.status !== "blocked");
  return candidates.sort((a, b) => {
    const scoreDiff = b.scorecard.total - a.scorecard.total;
    if (scoreDiff !== 0) return scoreDiff;
    return b.economics.grossProfitUsd - a.economics.grossProfitUsd;
  })[0] || null;
}

function buildCampaignDrafts(input: DropshippingMarketingCampaignInput, product: DropshippingProduct) {
  const channels = input.channel === "instagram"
    ? ["Instagram Reel", "Instagram Story", "Instagram Carousel"]
    : input.channel === "facebook_ads"
      ? ["Facebook ad draft", "Facebook retargeting draft", "Facebook feed draft"]
      : input.channel === "google_shopping"
        ? ["Shopping title", "Search intent copy", "Product feed note"]
        : input.channel === "email"
          ? ["Email subject", "Email body", "Follow-up note"]
          : ["TikTok hook", "TikTok demo", "TikTok objection reply"];
  const hooks = [
    input.primaryHook,
    `${product.productName}: antes/despues claro en menos de 10 segundos.`,
    `No compramos stock: validamos si la gente realmente lo quiere.`,
    `Lo bueno, lo malo y el shipping real antes de escalar.`,
    `Oferta simple: ${input.offer}`,
  ];

  return Array.from({ length: Math.max(1, input.dailyOrganicPosts || 1) }, (_, index) => ({
    day: `Dia ${index + 1}`,
    channel: channels[index % channels.length],
    hook: hooks[index % hooks.length],
    caption: `${hooks[index % hooks.length]} ${product.productName} con precio claro, beneficio visible y expectativas honestas de envio.`,
    status: "needs_approval" as const,
  }));
}

export function buildDropshippingMarketingCampaign(input: DropshippingMarketingCampaignInput) {
  loadAll();
  const parsed = dropshippingMarketingCampaignSchema.parse(input);
  const product = products.find((item) => item.id === parsed.productId) || null;
  const currentApprovalQueue = approvalQueueCount(products, launchPlans, marketingCampaigns, socialPosts, orderRecords, fulfillmentActions);
  const profitGuard = buildProfitGuard(ledger, currentApprovalQueue);
  const requestedSpendUsd = Number(parsed.paidTestBudgetUsd.toFixed(2));
  const projectedSpendUsd = Number((profitGuard.totalSpendUsd + requestedSpendUsd).toFixed(2));
  const exceedsBudget = requestedSpendUsd > 0 && projectedSpendUsd > profitGuard.monthlyBudgetUsd;
  const approvedSpendWouldOverrunCash = parsed.approvalToSpend && requestedSpendUsd > profitGuard.canSpendUsd;
  const blocked = !product || product.status === "blocked" || exceedsBudget || approvedSpendWouldOverrunCash;
  const needsApproval = !parsed.approvalToPublish || (requestedSpendUsd > 0 && !parsed.approvalToSpend);
  const status = blocked
    ? "blocked" as const
    : needsApproval
      ? "approval_required" as const
      : "ready_after_approval" as const;
  const approvedSpendUsd = status === "ready_after_approval" && parsed.approvalToSpend ? requestedSpendUsd : 0;
  const breakEvenOrders = product && product.economics.grossProfitUsd > 0 && requestedSpendUsd > 0
    ? Math.ceil(requestedSpendUsd / product.economics.grossProfitUsd)
    : null;
  const requiredApprovals = [
    "aprobar copy y assets antes de publicar",
    requestedSpendUsd > 0 && `aprobar paid test de ${money.format(requestedSpendUsd)}`,
    product?.requiresSample && "aprobar sample antes de escalar claims de calidad",
  ].filter(Boolean) as string[];
  const now = new Date().toISOString();
  const campaign: DropshippingMarketingCampaign = {
    ...parsed,
    id: `drop-campaign-${Date.now()}-${marketingCampaigns.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status,
    product,
    budgetPlan: {
      organicFirst: requestedSpendUsd === 0,
      requestedSpendUsd,
      approvedSpendUsd,
      breakEvenOrders,
      guardrail:
        status === "blocked"
          ? "Bloqueado por Profit Guard, producto invalido o presupuesto/cash insuficiente."
          : requestedSpendUsd === 0
            ? "Organic first: publicar solo despues de approval, sin gastar dinero."
            : "Paid test preparado, pero no gasta hasta approval y cash disponible.",
    },
    creativeBrief: {
      productPromise: product
        ? `${product.productName} debe comunicar un beneficio visible sin prometer resultados medicos, marcas ni tiempos no verificados.`
        : "Campana sin producto valido.",
      landingPageDraft: product
        ? [
            `Titulo: ${product.productName}`,
            `Beneficio: ${parsed.primaryHook}`,
            `Oferta: ${parsed.offer}`,
            `Precio objetivo: ${money.format(product.targetSellPriceUsd)} con costo landed ${money.format(product.economics.landedCostUsd)}.`,
            `Shipping: comunicar ${product.shippingDaysMin}-${product.shippingDaysMax} dias como estimado, no promesa absoluta.`,
          ]
        : ["Seleccionar producto valido antes de construir pagina."],
      riskChecks: [
        "sin claims de salud, ingresos, garantias absolutas o marcas no autorizadas",
        "mostrar precio, shipping estimado, politica de returns y soporte antes del checkout",
        "mantener inventario en cero: solo supplier stock y fulfillment por orden pagada",
      ],
    },
    socialDrafts: product ? buildCampaignDrafts(parsed, product) : [],
    requiredApprovals,
    nextActions:
      status === "blocked"
        ? ["corregir producto/presupuesto", "mantener drafts internos", "no publicar ni gastar"]
        : ["enviar campaign a approvals", "preparar asset drafts", "registrar resultados en learning review"],
  };

  marketingCampaigns.unshift(campaign);
  persistMarketingCampaigns();
  return { campaign, snapshot: getDropshippingCeoSnapshot() };
}

export function runDropshippingCeoCycle(input: Partial<DropshippingCeoCycleInput> = {}) {
  loadAll();
  const parsed = dropshippingCeoCycleSchema.parse(input);
  const before = getDropshippingCeoSnapshot();
  const product = pickBestDropshippingProduct();
  const today = new Date().toISOString().slice(0, 10);
  const commands: string[] = [];
  const generatedCampaignIds: string[] = [];
  const generatedPostIds: string[] = [];
  let focus = "research";
  let summary = "No hay productos calificados. El CEO debe investigar 3 productos virales antes de pedir approvals.";
  let status: DropshippingCeoCycle["status"] = "research";
  let approvalRequests: string[] = [];

  if (!product) {
    commands.push(
      "Investigar 3 productos virales con margen bruto minimo 45%.",
      "Buscar al menos 2 suppliers por producto antes de publicar.",
      "Mantener budget en $0 hasta tener producto y approval.",
    );
  } else if (before.profitGuard.status === "pause_spend") {
    focus = "budget_protection";
    status = "blocked";
    summary = "Profit Guard esta pausando gasto. El CEO debe recuperar cash/profit antes de escalar.";
    commands.push("Pausar paid tests.", "Revisar ledger/refunds.", "Resolver approval queue antes de nuevos experimentos.");
  } else {
    const existingToday = marketingCampaigns.find((campaign) => campaign.productId === product.id && campaign.createdAt.startsWith(today));
    const shouldSuggestPaid =
      (parsed.forcePaidTest || parsed.mode === "scale_winner" || learningReviews[0]?.decisionStatus === "scale_content") &&
      before.profitGuard.canSpendUsd > 0;
    const recommendedSpendUsd = shouldSuggestPaid
      ? Number(Math.min(before.profitGuard.canSpendUsd, learningReviews[0]?.nextBatch.maxSpendUsd || 10, 25).toFixed(2))
      : 0;
    focus = shouldSuggestPaid ? "scale_winner" : "organic_validation";
    status = before.metrics.approvalQueue > 0 ? "approval_review" : "campaign_drafted";
    summary = shouldSuggestPaid
      ? `Producto foco: ${product.productName}. Hay cash para test pequeno, pero requiere approval.`
      : `Producto foco: ${product.productName}. Organic first hasta que haya ventas/cash real.`;
    commands.push(
      `Preparar campana para ${product.productName}.`,
      recommendedSpendUsd > 0 ? `Solicitar approval de paid test max ${money.format(recommendedSpendUsd)}.` : "Crear 3 drafts organicos sin gasto.",
      "Actualizar learning review con visitas, add-to-carts, ordenes, revenue y refunds.",
    );

    if (existingToday) {
      generatedCampaignIds.push(existingToday.id);
      approvalRequests = existingToday.requiredApprovals;
      commands.push("Usar campana existente de hoy; no duplicar drafts.");
      const existingPostsToday = socialPosts.filter((post) => post.campaignId === existingToday.id && post.createdAt.startsWith(today));
      if (existingPostsToday.length) {
        generatedPostIds.push(...existingPostsToday.map((post) => post.id));
        commands.push("Usar posts sociales existentes de hoy; no duplicar contenido.");
      } else {
        const batch = createDropshippingSocialPostBatch({
          campaignId: existingToday.id,
          platforms: ["tiktok", "instagram"],
          postsPerPlatform: 1,
          approvalToPublish: false,
          scheduledDate: "",
        });
        generatedPostIds.push(...batch.posts.map((post) => post.id));
        commands.push("Crear batch de posts organicos en approval queue.");
      }
    } else {
      const result = buildDropshippingMarketingCampaign({
        productId: product.id,
        campaignName: `${product.productName} validation ${today}`,
        channel: parsed.mode === "scale_winner" ? "facebook_ads" : "tiktok",
        objective: parsed.mode === "scale_winner" ? "scale_winner" : "validate_product",
        targetAudience: "personas que compran soluciones simples vistas en redes sociales",
        primaryHook: `${product.productName} resuelve un problema visible sin ocupar espacio.`,
        offer: `Precio objetivo ${money.format(product.targetSellPriceUsd)} con validacion sin inventario propio.`,
        dailyOrganicPosts: parsed.mode === "scale_winner" ? 5 : 3,
        paidTestBudgetUsd: recommendedSpendUsd,
        approvalToPublish: false,
        approvalToSpend: false,
      });
      generatedCampaignIds.push(result.campaign.id);
      approvalRequests = result.campaign.requiredApprovals;
      const batch = createDropshippingSocialPostBatch({
        campaignId: result.campaign.id,
        platforms: ["tiktok", "instagram"],
        postsPerPlatform: 1,
        approvalToPublish: false,
        scheduledDate: "",
      });
      generatedPostIds.push(...batch.posts.map((post) => post.id));
      commands.push("Crear posts organicos para TikTok e Instagram como drafts aprobables.");
    }
  }

  const after = getDropshippingCeoSnapshot();
  const cycle: DropshippingCeoCycle = {
    ...parsed,
    id: `drop-cycle-${Date.now()}-${ceoCycles.length + 1}`,
    createdAt: new Date().toISOString(),
    status,
    focus,
    summary,
    commands,
    generatedCampaignIds,
    generatedPostIds,
    approvalRequests,
    metricsSnapshot: {
      productsResearched: after.metrics.productsResearched,
      approvalQueue: after.metrics.approvalQueue,
      totalRevenueUsd: after.metrics.totalRevenueUsd,
      totalSpendUsd: after.metrics.totalSpendUsd,
      profitUsd: after.metrics.profitUsd,
      canSpendUsd: after.profitGuard.canSpendUsd,
    },
  };
  ceoCycles.unshift(cycle);
  persistCeoCycles();
  return { cycle, snapshot: getDropshippingCeoSnapshot() };
}

export function runDropshippingDailyOperatingCycle(input: Partial<DropshippingCeoCycleInput> = {}) {
  loadAll();
  const before = getDropshippingCeoSnapshot();
  const today = new Date().toISOString().slice(0, 10);
  const shouldAnalyzeSocial = socialMetrics.length > 0 && !socialAnalyses.some((analysis) => analysis.createdAt.startsWith(today));
  const analysisResult = shouldAnalyzeSocial
    ? analyzeDropshippingSocialPerformance({ periodLabel: `auto ${today}`, campaignId: "" }).analysis
    : null;
  const scoutResult = products.length === 0 && !productScoutCandidates.some((candidate) => candidate.createdAt.startsWith(today))
    ? runDropshippingProductScoutBatch({
        focusNiche: "mixed",
        maxCandidates: 4,
        budgetUsd: STARTING_MONTHLY_BUDGET_USD,
        notes: "Auto daily scouting: shortlist only, no spend.",
      })
    : null;
  const refreshed = getDropshippingCeoSnapshot();
  const mode =
    input.mode ||
    (refreshed.ceoOperatingPlan.largeCampaignReadiness.status === "ready_after_approval" ? "scale_winner" : "daily");
  const forcePaidTest = Boolean(input.forcePaidTest ?? (
    refreshed.profitGuard.canSpendUsd > 0 &&
    refreshed.metrics.approvalQueue === 0 &&
    refreshed.ceoOperatingPlan.largeCampaignReadiness.status !== "blocked"
  ));
  const capitalPlanResult = capitalPlans.some((plan) => plan.createdAt.startsWith(today))
    ? null
    : buildDropshippingCapitalPlan({
        objective: refreshed.ceoOperatingPlan.largeCampaignReadiness.status === "ready_after_approval" ? "scale_winner" : "validate_winner",
        requestedBudgetUsd: refreshed.budgetPolicy.activeMonthlyBudgetUsd,
        approvalToPrepareLargeCampaign: false,
        notes: "Auto daily capital plan; no external spend.",
      }).capitalPlan;
  const growthSprintResult = growthSprints.some((sprint) => sprint.createdAt.startsWith(today))
    ? null
    : buildDropshippingGrowthSprint({
        focus: refreshed.ceoOperatingPlan.largeCampaignReadiness.status === "ready_after_approval" ? "scale_winner" : "first_100_validation",
        days: 7,
        requestedBudgetUsd: refreshed.budgetPolicy.activeMonthlyBudgetUsd,
        approvalToPrepareSpend: false,
        notes: "Auto daily CEO growth sprint; no external spend.",
      }).growthSprint;
  const cycleResult = runDropshippingCeoCycle({ mode, forcePaidTest });
  const after = getDropshippingCeoSnapshot();
  const generatedPostIds = cycleResult.cycle.generatedPostIds || [];

  return {
    status: "completed" as const,
    dateKey: today,
    mode,
    forcePaidTest,
    scout: scoutResult,
    capitalPlan: capitalPlanResult,
    growthSprint: growthSprintResult,
    analysis: analysisResult,
    cycle: cycleResult.cycle,
    reportPreview: buildDropshippingDailyReport("morning"),
    safety: {
      externalActionsBlocked: true,
      spentUsd: 0,
      publishedExternally: 0,
      guardrails: [
        "No publica contenido externo sin approval.",
        "No gasta dinero sin approval y Profit Guard.",
        "No compra inventario ni ordena samples sin approval.",
      ],
    },
    summary: [
      `Stage antes: ${before.ceoOperatingPlan.stage}; stage despues: ${after.ceoOperatingPlan.stage}.`,
      `Campanas tocadas: ${cycleResult.cycle.generatedCampaignIds.length}. Posts tocados: ${generatedPostIds.length}.`,
      after.executiveSummary.nextCommand,
    ].join(" "),
    snapshot: after,
  };
}

function buildLaunchPackApprovals(input: {
  product: DropshippingProduct | null;
  requestedBudgetUsd: number;
  capitalPlan: DropshippingCapitalPlan | null;
}): DropshippingLaunchPack["approvalsRequired"] {
  const approvals: DropshippingLaunchPack["approvalsRequired"] = [];
  if (input.product) {
    approvals.push({
      actionType: "dropshipping.publish_product",
      title: `Aprobar producto para launch: ${input.product.productName}`,
      reason: "Requiere decision humana antes de publicar producto, claims o oferta externa.",
      maxSpendUsd: 0,
    });
    approvals.push({
      actionType: "dropshipping.create_shopify_draft",
      title: "Aprobar Shopify draft",
      reason: "El pack solo preparo preflight; Shopify sigue en draft/blocked hasta credenciales y approval.",
      maxSpendUsd: 0,
    });
    approvals.push({
      actionType: "dropshipping.publish_social",
      title: "Aprobar posts organicos",
      reason: "Los posts quedan como drafts/approval queue y no se publican solos.",
      maxSpendUsd: 0,
    });
    approvals.push({
      actionType: "dropshipping.contact_supplier",
      title: "Aprobar validacion de supplier",
      reason: "Confirmar stock, tracking, returns y backup antes de escalar.",
      maxSpendUsd: 0,
    });
    if (input.product.requiresSample || input.product.status === "sample_recommended") {
      approvals.push({
        actionType: "dropshipping.order_sample",
        title: "Aprobar sample de 1 unidad",
        reason: "Producto recomienda sample; sigue prohibido comprar inventario.",
        maxSpendUsd: input.product.economics.landedCostUsd,
      });
    }
  }
  if (input.requestedBudgetUsd > 0) {
    approvals.push({
      actionType: "dropshipping.spend",
      title: "Aprobar primer tramo de ads",
      reason: input.capitalPlan?.approvedInitialBudgetUsd
        ? "Capital plan preparo un tramo chico; no activa gasto externo."
        : "Gasto queda bloqueado hasta cash, senales y Profit Guard.",
      maxSpendUsd: input.capitalPlan?.approvedInitialBudgetUsd || 0,
    });
  }
  return approvals;
}

export function buildDropshippingLaunchPack(input: Partial<DropshippingLaunchPackInput> = {}) {
  loadAll();
  const parsed = dropshippingLaunchPackSchema.parse(input);
  const product = parsed.productId
    ? products.find((item) => item.id === parsed.productId) || null
    : pickBestDropshippingProduct();
  const now = new Date().toISOString();
  const safety = {
    spentUsd: 0,
    publishedExternally: 0,
    shopifyCreatedExternally: false,
    inventoryPurchased: false,
    guardrails: [
      "No se publica en Shopify; solo preflight/draft.",
      "No se publica en redes; posts quedan en draft/approval queue.",
      "No se gasta dinero; capital plan queda en proposal/locked.",
      "No se compra inventario ni sample sin approval.",
    ],
  };

  if (!product) {
    const pack: DropshippingLaunchPack = {
      ...parsed,
      id: `drop-launch-pack-${Date.now()}-${launchPacks.length + 1}`,
      createdAt: now,
      status: "needs_product",
      product: null,
      launchPlan: null,
      campaign: null,
      socialPosts: [],
      shopifyPreflight: null,
      capitalPlan: null,
      safety,
      approvalsRequired: [],
      launchChecklist: [
        { owner: "Product Scout", item: "Promover un candidato a producto investigado.", status: "blocked" },
        { owner: "Supplier Analyst", item: "Confirmar supplier primario y backup.", status: "blocked" },
        { owner: "CMO", item: "Crear hooks organicos despues de elegir producto.", status: "blocked" },
      ],
      nextActions: ["correr Product Scout", "promover candidato", "crear launch pack otra vez"],
      boardMemo: "Launch pack bloqueado: falta producto foco investigado.",
    };
    launchPacks.unshift(pack);
    persistLaunchPacks();
    return { launchPack: pack, snapshot: getDropshippingCeoSnapshot() };
  }

  const paidBudget = parsed.approvalToSpend ? Math.max(0, parsed.requestedBudgetUsd) : 0;
  const launchPlan = buildDropshippingLaunchPlan({
    productId: product.id,
    storeChannel: "shopify_social",
    dailyOrganicPosts: parsed.dailyOrganicPosts,
    paidAdTestBudgetUsd: paidBudget,
    approvalToPublish: parsed.approvalToPublish,
    approvalToSpend: parsed.approvalToSpend,
    approvalToOrderSample: false,
  }).launchPlan;
  const campaign = buildDropshippingMarketingCampaign({
    productId: product.id,
    campaignName: `${product.productName} ${parsed.mode} launch`,
    channel: parsed.mode === "scale_candidate" ? "facebook_ads" : "tiktok",
    objective: parsed.mode === "scale_candidate" ? "scale_winner" : "validate_product",
    targetAudience: "compradores de redes que quieren una solucion simple y demostrable",
    primaryHook: `${product.productName} resuelve un problema visible sin comprar inventario.`,
    offer: `Precio objetivo ${money.format(product.targetSellPriceUsd)} con shipping claro y validacion organica.`,
    dailyOrganicPosts: parsed.dailyOrganicPosts,
    paidTestBudgetUsd: paidBudget,
    approvalToPublish: parsed.approvalToPublish,
    approvalToSpend: parsed.approvalToSpend,
  }).campaign;
  const socialBatch = createDropshippingSocialPostBatch({
    campaignId: campaign.id,
    platforms: parsed.platforms,
    postsPerPlatform: parsed.postsPerPlatform,
    approvalToPublish: parsed.approvalToPublish,
    scheduledDate: "",
  });
  const shopifyPreflight = preflightDropshippingShopifyDraft({
    productId: product.id,
    campaignId: campaign.id,
    vendor: "Dropshipping CEO",
    productType: "Dropshipping validation",
    approvalToCreateDraft: parsed.approvalToPrepareDraft,
    dryRun: true,
  }).draft;
  const capitalPlan = buildDropshippingCapitalPlan({
    campaignId: campaign.id,
    objective: parsed.mode === "scale_candidate" ? "scale_winner" : "validate_winner",
    requestedBudgetUsd: parsed.requestedBudgetUsd,
    approvalToPrepareLargeCampaign: parsed.mode === "scale_candidate",
    notes: parsed.notes || "Launch pack capital guard; no spend executed.",
  }).capitalPlan;
  const status: DropshippingLaunchPack["status"] =
    product.status === "blocked" || launchPlan.status === "blocked" || campaign.status === "blocked"
      ? "blocked"
      : launchPlan.status === "ready_after_approval" && campaign.status === "ready_after_approval" && socialBatch.guardrail.status === "ready"
        ? "draft_ready"
        : "approval_required";
  const approvalsRequired = buildLaunchPackApprovals({ product, requestedBudgetUsd: parsed.requestedBudgetUsd, capitalPlan });
  const pack: DropshippingLaunchPack = {
    ...parsed,
    productId: product.id,
    id: `drop-launch-pack-${Date.now()}-${launchPacks.length + 1}`,
    createdAt: now,
    status,
    product,
    launchPlan,
    campaign,
    socialPosts: socialBatch.posts,
    shopifyPreflight,
    capitalPlan,
    safety,
    approvalsRequired,
    launchChecklist: [
      { owner: "Product Scout", item: `Producto foco: ${product.productName}.`, status: product.status === "blocked" ? "blocked" : "ready" },
      { owner: "Store Builder", item: "Shopify preflight creado en dry-run/draft.", status: shopifyPreflight.status === "blocked" ? "needs_approval" : "ready" },
      { owner: "CMO", item: `${socialBatch.posts.length} post(s) organicos preparados.`, status: socialBatch.posts.length ? "needs_approval" : "blocked" },
      { owner: "Profit Guard", item: `Capital plan: ${capitalPlan.status}, tramo ${money.format(capitalPlan.approvedInitialBudgetUsd)}.`, status: capitalPlan.status === "blocked" ? "blocked" : "needs_approval" },
      { owner: "Supplier Analyst", item: "Validar proveedor primario/backup antes de vender fuerte.", status: "needs_approval" },
      { owner: "Legal + Security", item: "Revisar claims, copyright, shipping y returns.", status: "needs_approval" },
    ],
    nextActions:
      status === "blocked"
        ? ["corregir producto o guardrails", "mantener todo interno", "no publicar ni gastar"]
        : ["crear approvals del board", "revisar Shopify preflight", "aprobar posts organicos o mantener drafts", "registrar metricas despues de publicar manual/aprobado"],
    boardMemo: `Launch pack ${parsed.mode} para ${product.productName}: ${socialBatch.posts.length} posts, Shopify preflight ${shopifyPreflight.status}, capital ${capitalPlan.status}. Gasto ejecutado ${money.format(0)}.`,
  };

  launchPacks.unshift(pack);
  persistLaunchPacks();
  return { launchPack: pack, snapshot: getDropshippingCeoSnapshot() };
}

export function prepareDropshippingLaunchPackApprovalQueue(input: Partial<DropshippingLaunchPackApprovalQueueInput> = {}) {
  loadAll();
  const parsed = dropshippingLaunchPackApprovalQueueSchema.parse(input);
  const launchPack = parsed.launchPackId
    ? launchPacks.find((pack) => pack.id === parsed.launchPackId) || null
    : launchPacks[0] || null;

  if (!launchPack) {
    return {
      status: "needs_launch_pack" as const,
      launchPack: null,
      requests: [],
      skipped: ["Crear un launch pack antes de pedir approvals."],
      guardrails: ["No hay accion aprobable sin launch pack."],
      snapshot: getDropshippingCeoSnapshot(),
    };
  }

  const skipped: string[] = [];
  const requests = launchPack.approvalsRequired
    .filter((approval) => {
      if (approval.actionType === "dropshipping.spend" && !parsed.includeSpendApproval) {
        skipped.push("Spend approval omitido: includeSpendApproval=false.");
        return false;
      }
      if (approval.actionType === "dropshipping.order_sample" && !parsed.includeSampleApproval) {
        skipped.push("Sample approval omitido: includeSampleApproval=false.");
        return false;
      }
      return true;
    })
    .map((approval) => ({
      actionType: approval.actionType,
      resourceType: "dropshipping_launch_pack",
      resourceId: launchPack.id,
      title: approval.title,
      description: `${approval.reason} Launch pack: ${launchPack.product?.productName || "sin producto"}. Max spend: ${money.format(approval.maxSpendUsd)}.`,
      input: {
        launchPackId: launchPack.id,
        productId: launchPack.product?.id || launchPack.productId,
        campaignId: launchPack.campaign?.id || "",
        launchPlanId: launchPack.launchPlan?.id || "",
        socialPostIds: launchPack.socialPosts.map((post) => post.id),
        shopifyDraftId: launchPack.shopifyPreflight?.id || "",
        maxSpendUsd: approval.maxSpendUsd,
      },
      proposedChanges: {
        mode: launchPack.mode,
        approval,
        safety: launchPack.safety,
        nextActions: launchPack.nextActions,
      },
    }));

  return {
    status: requests.length ? "ready" as const : "empty" as const,
    launchPack,
    requests,
    skipped,
    guardrails: [
      "Esto solo crea pending approvals; no ejecuta publicaciones, gasto ni Shopify.",
      "Spend/sample requieren flags explicitos.",
      "Cada accion queda auditada antes de poder ejecutarse.",
    ],
    snapshot: getDropshippingCeoSnapshot(),
  };
}

export function recordDropshippingApprovalOutboxRequests(
  requests: DropshippingPreparedApprovalRequest[],
  failureReason = "Trust Center DB unavailable; saved locally for manual review.",
) {
  loadAll();
  const now = new Date().toISOString();
  const queued: DropshippingApprovalOutboxItem[] = [];
  const duplicates: DropshippingApprovalOutboxItem[] = [];

  requests.forEach((request) => {
    const existing = approvalOutbox.find((item) =>
      item.status === "pending_local" &&
      item.actionType === request.actionType &&
      item.resourceId === request.resourceId &&
      item.title === request.title
    );

    if (existing) {
      existing.updatedAt = now;
      existing.failureReason = failureReason;
      duplicates.push(existing);
      return;
    }

    const item: DropshippingApprovalOutboxItem = {
      ...request,
      id: `drop-approval-outbox-${Date.now()}-${approvalOutbox.length + queued.length + 1}`,
      createdAt: now,
      updatedAt: now,
      status: "pending_local",
      source: "launch_pack_approval_queue",
      failureReason,
      queuedExternally: false,
      trustCenterPendingActionId: "",
    };
    approvalOutbox.unshift(item);
    queued.push(item);
  });

  persistApprovalOutbox();

  return {
    status: queued.length ? "saved_local_outbox" as const : "duplicates_only" as const,
    queued,
    duplicates,
    localOutbox: approvalOutbox.slice(0, 20),
    guardrails: [
      "Outbox local no ejecuta acciones.",
      "Cuando Postgres/Trust Center este disponible, migrar o recrear estas approvals.",
      "Spend y sample siguen fuera salvo request explicito.",
    ],
    snapshot: getDropshippingCeoSnapshot(),
  };
}

export function prepareDropshippingApprovalOutboxMigration(input: Partial<DropshippingApprovalOutboxMigrationInput> = {}) {
  loadAll();
  const parsed = dropshippingApprovalOutboxMigrationSchema.parse(input);
  const itemIdSet = new Set(parsed.itemIds);
  const matchingPending = approvalOutbox.filter((item) =>
    item.status === "pending_local" &&
    (itemIdSet.size === 0 || itemIdSet.has(item.id))
  );
  const items = matchingPending.slice(0, parsed.limit);
  return {
    status: items.length ? "ready" as const : "empty" as const,
    dryRun: parsed.dryRun,
    limit: parsed.limit,
    items,
    selectedCount: items.length,
    pendingLocalCount: approvalOutbox.filter((item) => item.status === "pending_local").length,
    skippedCount: Math.max(0, matchingPending.length - items.length),
    guardrails: [
      "Dry run no toca Trust Center ni cambia estados.",
      "Execute solo crea pending approvals; no publica, no gasta, no compra sample y no contacta supplier.",
      "Los items migrados quedan marcados queued_in_trust_center y salen del contador local pending.",
    ],
    snapshot: getDropshippingCeoSnapshot(),
  };
}

export function markDropshippingApprovalOutboxQueued(items: Array<{ id: string; pendingActionId?: string }>) {
  loadAll();
  const now = new Date().toISOString();
  const marked: DropshippingApprovalOutboxItem[] = [];
  const missing: string[] = [];

  items.forEach((result) => {
    const item = approvalOutbox.find((entry) => entry.id === result.id);
    if (!item) {
      missing.push(result.id);
      return;
    }
    item.status = "queued_in_trust_center";
    item.updatedAt = now;
    item.queuedExternally = true;
    item.trustCenterPendingActionId = result.pendingActionId || item.trustCenterPendingActionId || "";
    item.failureReason = "Queued in Trust Center.";
    marked.push(item);
  });

  if (marked.length) persistApprovalOutbox();

  return {
    status: marked.length ? "marked" as const : "empty" as const,
    marked,
    missing,
    pendingLocalCount: approvalOutbox.filter((item) => item.status === "pending_local").length,
    snapshot: getDropshippingCeoSnapshot(),
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getShopifyConfig() {
  const shopDomain = (process.env.SHOPIFY_SHOP_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return {
    shopDomain,
    accessToken: (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim(),
    apiVersion: (process.env.SHOPIFY_API_VERSION || "2026-04").trim(),
  };
}

function findCampaignById(campaignId: string) {
  if (!campaignId) return null;
  return marketingCampaigns.find((campaign) => campaign.id === campaignId) || null;
}

function buildShopifyProductCreateInput(
  product: DropshippingProduct,
  campaign: DropshippingMarketingCampaign | null,
  input: DropshippingShopifyDraftInput,
) {
  const campaignHook = campaign?.primaryHook || product.evidence;
  const offer = campaign?.offer || `Precio objetivo ${money.format(product.targetSellPriceUsd)}.`;
  const tags = [
    "dropshipping-ceo",
    "draft-only",
    product.niche,
    product.supplierPlatform,
    product.legalRisk === "low" ? "legal-low-risk" : "needs-legal-review",
    product.qualityRisk === "low" ? "quality-low-risk" : "needs-quality-review",
  ].filter(Boolean);
  const descriptionHtml = [
    `<p><strong>${escapeHtml(campaignHook)}</strong></p>`,
    `<p>${escapeHtml(offer)}</p>`,
    "<ul>",
    `<li>Modelo: validacion dropshipping sin inventario propio.</li>`,
    `<li>Costo landed estimado: ${escapeHtml(money.format(product.economics.landedCostUsd))}.</li>`,
    `<li>Precio objetivo: ${escapeHtml(money.format(product.targetSellPriceUsd))}.</li>`,
    `<li>Shipping estimado proveedor: ${product.shippingDaysMin}-${product.shippingDaysMax} dias. Comunicar como estimado, no promesa absoluta.</li>`,
    "</ul>",
    `<p>Guardrails: revisar supplier, returns, claims legales y sample antes de escalar.</p>`,
  ].join("");

  return {
    title: product.productName,
    descriptionHtml,
    vendor: input.vendor,
    productType: input.productType,
    status: "DRAFT",
    tags,
    seo: {
      title: product.productName.slice(0, 70),
      description: `${campaignHook} ${offer}`.slice(0, 320),
    },
    metafields: [
      { namespace: "dropshipping_ceo", key: "source_product_id", type: "single_line_text_field", value: product.id },
      { namespace: "dropshipping_ceo", key: "inventory_policy", type: "single_line_text_field", value: "no_stock_supplier_fulfillment_only" },
      { namespace: "dropshipping_ceo", key: "gross_margin_percent", type: "number_integer", value: String(product.economics.grossMarginPercent) },
    ],
  };
}

function buildShopifyDraftGuardrail(product: DropshippingProduct | null, input: DropshippingShopifyDraftInput) {
  const config = getShopifyConfig();
  const missing = [
    !product && "producto valido",
    product?.status === "blocked" && "producto no bloqueado",
    !input.approvalToCreateDraft && "approval de Robert para crear draft externo",
    !config.shopDomain && "SHOPIFY_SHOP_DOMAIN",
    !config.accessToken && "SHOPIFY_ADMIN_ACCESS_TOKEN",
  ].filter(Boolean) as string[];
  const ready = missing.length === 0;

  return {
    config,
    guardrail: {
      status: ready ? "ready" as const : "blocked" as const,
      reason: ready
        ? "Listo para crear producto Shopify en DRAFT. No publica, no activa ads y no compra inventario."
        : `Bloqueado para Shopify draft: falta ${missing.join(", ")}.`,
      missing,
    },
  };
}

function makeShopifyDraftRecord(
  input: DropshippingShopifyDraftInput,
  status: DropshippingShopifyDraft["status"],
  product: DropshippingProduct | null,
  campaign: DropshippingMarketingCampaign | null,
  productCreateInput: Record<string, unknown>,
  guardrail: DropshippingShopifyDraft["guardrail"],
  userErrors: DropshippingShopifyDraft["userErrors"] = [],
  shopifyProductId = "",
  shopifyHandle = "",
) {
  const record: DropshippingShopifyDraft = {
    ...input,
    id: `drop-shopify-${Date.now()}-${shopifyDrafts.length + 1}`,
    createdAt: new Date().toISOString(),
    status,
    product,
    campaign,
    shopifyProductId,
    shopifyHandle,
    productCreateInput,
    guardrail,
    userErrors,
    nextActions:
      status === "draft_created"
        ? ["revisar draft en Shopify", "agregar imagenes reales/supplier", "mantener producto sin publicar hasta approval final"]
        : status === "preflight"
          ? ["revisar preflight", "activar approval y credenciales antes de crear draft"]
          : ["resolver bloqueos", "no publicar ni gastar"],
  };
  shopifyDrafts.unshift(record);
  persistShopifyDrafts();
  return record;
}

export function preflightDropshippingShopifyDraft(input: DropshippingShopifyDraftInput) {
  loadAll();
  const parsed = dropshippingShopifyDraftSchema.parse(input);
  const product = products.find((item) => item.id === parsed.productId) || null;
  const campaign = findCampaignById(parsed.campaignId);
  const { guardrail } = buildShopifyDraftGuardrail(product, parsed);
  const productCreateInput = product ? buildShopifyProductCreateInput(product, campaign, parsed) : {};
  const record = makeShopifyDraftRecord(parsed, guardrail.status === "ready" ? "preflight" : "blocked", product, campaign, productCreateInput, guardrail);
  return { draft: record, snapshot: getDropshippingCeoSnapshot() };
}

const SHOPIFY_PRODUCT_CREATE_MUTATION = `#graphql
mutation DropshippingProductCreate($product: ProductCreateInput!) {
  productCreate(product: $product) {
    product {
      id
      title
      handle
      status
    }
    userErrors {
      field
      message
    }
  }
}`;

export async function createDropshippingShopifyDraft(
  input: DropshippingShopifyDraftInput,
  fetchImpl: typeof fetch = fetch,
) {
  loadAll();
  const parsed = dropshippingShopifyDraftSchema.parse(input);
  const product = products.find((item) => item.id === parsed.productId) || null;
  const campaign = findCampaignById(parsed.campaignId);
  const { config, guardrail } = buildShopifyDraftGuardrail(product, parsed);
  const productCreateInput = product ? buildShopifyProductCreateInput(product, campaign, parsed) : {};

  if (guardrail.status !== "ready" || parsed.dryRun) {
    const draft = makeShopifyDraftRecord(parsed, guardrail.status === "ready" ? "preflight" : "blocked", product, campaign, productCreateInput, guardrail);
    return { created: false, draft, snapshot: getDropshippingCeoSnapshot() };
  }

  const endpoint = `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": config.accessToken,
      },
      body: JSON.stringify({ query: SHOPIFY_PRODUCT_CREATE_MUTATION, variables: { product: productCreateInput } }),
    });
    const payload = await response.json() as {
      data?: { productCreate?: { product?: { id?: string; handle?: string; status?: string }; userErrors?: Array<{ field?: string[]; message?: string }> } };
      errors?: Array<{ message?: string }>;
    };
    const userErrors = [
      ...(payload.data?.productCreate?.userErrors || []).map((error) => ({ field: error.field || [], message: error.message || "Shopify user error" })),
      ...(payload.errors || []).map((error) => ({ field: [], message: error.message || "Shopify GraphQL error" })),
      ...(!response.ok ? [{ field: [], message: `Shopify HTTP ${response.status}` }] : []),
    ];
    const shopifyProduct = payload.data?.productCreate?.product;
    const status = userErrors.length ? "failed" as const : "draft_created" as const;
    const draft = makeShopifyDraftRecord(parsed, status, product, campaign, productCreateInput, guardrail, userErrors, shopifyProduct?.id || "", shopifyProduct?.handle || "");
    return { created: status === "draft_created", draft, snapshot: getDropshippingCeoSnapshot() };
  } catch (error) {
    const draft = makeShopifyDraftRecord(parsed, "failed", product, campaign, productCreateInput, guardrail, [
      { field: [], message: error instanceof Error ? error.message : "Shopify draft request failed" },
    ]);
    return { created: false, draft, snapshot: getDropshippingCeoSnapshot() };
  }
}

function buildFulfillmentGuardrail(order: DropshippingOrder | null, input: DropshippingFulfillmentInput) {
  const missing = [
    !order && "orden valida",
    order?.paymentStatus !== "paid" && "pago confirmado",
    order?.status === "blocked" && "orden no bloqueada",
    order?.status === "refunded" && "orden no reembolsada",
    !input.approvalToFulfill && "approval de Robert para fulfillment",
  ].filter(Boolean) as string[];
  const ready = missing.length === 0;

  return {
    status: ready ? "ready" as const : "blocked" as const,
    reason: ready
      ? "Fulfillment listo para registro manual aprobado. No compra inventario; solo proveedor por orden pagada."
      : `Fulfillment bloqueado: falta ${missing.join(", ")}.`,
    missing,
  };
}

export function prepareDropshippingFulfillment(input: DropshippingFulfillmentInput) {
  loadAll();
  const parsed = dropshippingFulfillmentSchema.parse(input);
  const order = orderRecords.find((item) => item.id === parsed.orderId) || null;
  const guardrail = buildFulfillmentGuardrail(order, parsed);
  const now = new Date().toISOString();
  const status =
    guardrail.status !== "ready"
      ? parsed.approvalToFulfill ? "blocked" as const : "approval_required" as const
      : parsed.dryRun
        ? "preflight" as const
        : "manual_fulfillment_recorded" as const;
  const action: DropshippingFulfillmentAction = {
    ...parsed,
    id: `drop-fulfillment-${Date.now()}-${fulfillmentActions.length + 1}`,
    createdAt: now,
    status,
    order,
    guardrail,
    costImpactUsd: order?.estimatedCostUsd || 0,
    nextActions:
      status === "manual_fulfillment_recorded"
        ? ["guardar tracking", "monitorear delivery", "preparar soporte por shipping/returns"]
        : status === "preflight"
          ? ["revisar supplier/costo/direccion fuera del sistema", "ejecutar fulfillment real solo con approval final"]
          : ["resolver approval/pago/margen", "no comprar al proveedor"],
  };

  fulfillmentActions.unshift(action);
  if (order && status === "manual_fulfillment_recorded") {
    order.status = parsed.trackingNumber || parsed.supplierOrderId ? "fulfilled" : "ready_for_fulfillment";
    order.updatedAt = now;
    order.nextActions = order.status === "fulfilled"
      ? ["enviar tracking al cliente", "monitorear delivery", "registrar incidencias/refunds si aparecen"]
      : ["registrar supplier order id/tracking", "confirmar fulfillment antes de marcar completa"];
    persistOrders();
  }
  persistFulfillmentActions();
  return { action, snapshot: getDropshippingCeoSnapshot() };
}

function formatForPlatform(platform: DropshippingSocialPlatform): DropshippingSocialFormat {
  if (platform === "instagram") return "reel";
  if (platform === "facebook") return "carousel";
  if (platform === "youtube_shorts" || platform === "tiktok") return "short_video";
  if (platform === "pinterest") return "pin";
  if (platform === "email") return "email";
  return "manual";
}

function platformLabel(platform: DropshippingSocialPlatform) {
  return {
    tiktok: "TikTok",
    instagram: "Instagram",
    facebook: "Facebook",
    youtube_shorts: "YouTube Shorts",
    pinterest: "Pinterest",
    email: "Email",
    manual: "Manual",
  }[platform];
}

function getSocialPublisherConfig() {
  const metricool = getMetricoolConfigStatus();
  const webhookUrl = (process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL || "").trim();
  const webhookToken = (process.env.DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_TOKEN || "").trim();
  return {
    webhookUrl,
    webhookToken,
    metricoolMcpUrl: metricool.mcpUrl,
    metricoolReady: metricool.readyForMcp,
    metricoolMissingEnv: metricool.missingEnv,
    mode: webhookUrl ? "webhook" as const : metricool.readyForMcp ? "metricool_mcp" as const : "manual" as const,
  };
}

function cleanBaseUrl(value: string | undefined) {
  const trimmed = (value || "").trim();
  if (!trimmed || /^https:\/\/your-domain\.example/i.test(trimmed)) return "";
  return trimmed.replace(/\/$/, "");
}

function publicPolicyUrl(pathname: string, envName: "DROPSHIPPING_RETURN_POLICY_URL" | "DROPSHIPPING_PRIVACY_POLICY_URL") {
  const explicit = (process.env[envName] || "").trim();
  if (explicit) return explicit;
  const publicBaseUrl = cleanBaseUrl(process.env.PUBLIC_APP_URL || process.env.EXPO_PUBLIC_DOMAIN);
  return publicBaseUrl ? `${publicBaseUrl}${pathname}` : pathname;
}

function getDropshippingPolicyUrls() {
  return {
    privacy: publicPolicyUrl("/dropshipping/legal/privacy", "DROPSHIPPING_PRIVACY_POLICY_URL"),
    refund: publicPolicyUrl("/dropshipping/legal/refund-policy", "DROPSHIPPING_RETURN_POLICY_URL"),
    shipping: `${cleanBaseUrl(process.env.PUBLIC_APP_URL || process.env.EXPO_PUBLIC_DOMAIN) || ""}/dropshipping/legal/shipping-policy`.replace(/^\/\//, "/"),
    terms: `${cleanBaseUrl(process.env.PUBLIC_APP_URL || process.env.EXPO_PUBLIC_DOMAIN) || ""}/dropshipping/legal/terms`.replace(/^\/\//, "/"),
    checkoutReadiness: `${cleanBaseUrl(process.env.PUBLIC_APP_URL || process.env.EXPO_PUBLIC_DOMAIN) || ""}/dropshipping/legal/checkout-readiness`.replace(/^\/\//, "/"),
  };
}

function getSupplierExecutionConfig() {
  const rawMode = (process.env.DROPSHIPPING_SUPPLIER_EXECUTION_MODE || "manual").trim();
  const allowedModes = new Set(["manual", "dsers", "zendrop", "cj_dropshipping", "spocket"]);
  const preferredMode = (allowedModes.has(rawMode) ? rawMode : "manual") as DropshippingExecutionSetup["supplierOps"]["preferredMode"];
  return {
    preferredMode,
    portalUrl: (process.env.DROPSHIPPING_SUPPLIER_PORTAL_URL || "").trim(),
    orderWebhookUrl: (process.env.DROPSHIPPING_SUPPLIER_ORDER_WEBHOOK_URL || "").trim(),
    orderWebhookToken: (process.env.DROPSHIPPING_SUPPLIER_ORDER_WEBHOOK_TOKEN || "").trim(),
  };
}

function missingEnv(names: string[]) {
  return names.filter((name) => !(process.env[name] || "").trim());
}

function isDatabaseUrlConfigured() {
  const value = (process.env.DATABASE_URL || "").trim();
  return Boolean(value && !value.includes("user:password") && !value.includes("replace-with"));
}

function buildDropshippingExecutionSetupCenter(): DropshippingExecutionSetup {
  const shopifyMissing = missingEnv(["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"]);
  const socialConfig = getSocialPublisherConfig();
  const socialMissing = socialConfig.mode === "manual"
    ? ["DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL or METRICOOL_USER_TOKEN + METRICOOL_USER_ID"]
    : [];
  const telegramMissing = missingEnv(["TELEGRAM_BOT_TOKEN"]);
  const supplierConfig = getSupplierExecutionConfig();
  const supplierRequiredEnv = supplierConfig.preferredMode === "manual"
    ? ["DROPSHIPPING_SUPPLIER_EXECUTION_MODE"]
    : ["DROPSHIPPING_SUPPLIER_EXECUTION_MODE", "DROPSHIPPING_SUPPLIER_PORTAL_URL"];
  const supplierMissing = supplierConfig.preferredMode === "manual" ? [] : missingEnv(supplierRequiredEnv);
  const approvalsMissing = isDatabaseUrlConfigured() ? [] : ["DATABASE_URL"];
  const approvalsReady = approvalsMissing.length === 0;
  const policyUrls = getDropshippingPolicyUrls();
  const paymentsTaxMissing = ["STORE_PAYMENT_PROCESSOR"].filter((name) => !(process.env[name] || "").trim());
  const connectors: DropshippingExecutionSetup["connectors"] = [
    {
      id: "shopify",
      label: "Shopify draft/order bridge",
      status: shopifyMissing.length ? "needs_setup" : "ready",
      mode: shopifyMissing.length ? "dry_run" : "api",
      ownerAgent: "Store Builder",
      capabilities: shopifyMissing.length
        ? ["preflight product draft", "prepare Shopify payload"]
        : ["create DRAFT products", "record Shopify draft ids", "keep products unpublished until approval"],
      requiredEnv: ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN", "SHOPIFY_API_VERSION"],
      missingEnv: shopifyMissing,
      approvalGate: "Robert aprueba create_shopify_draft antes de tocar Shopify.",
      nextAction: shopifyMissing.length ? "Configurar Shopify Admin token con write_products." : "Crear solo DRAFT products y revisar antes de publicar.",
      evidence: shopifyMissing.length ? ["No hay credenciales Shopify completas."] : ["Shopify domain/token detectados."],
    },
    {
      id: "social_publisher",
      label: "Social publisher",
      status: socialMissing.length ? "needs_setup" : "ready",
      mode: socialConfig.mode,
      ownerAgent: "Social Media Manager",
      capabilities: socialMissing.length
        ? ["crear posts", "cola interna", "registro manual de URL publicada"]
        : socialConfig.mode === "metricool_mcp"
          ? ["preparar posts aprobados para Metricool", "mantener cola interna", "registrar URL publicada o usar wrapper webhook compatible"]
          : ["enviar posts aprobados por webhook", "guardar respuesta externa", "mantener posts queued si falla"],
      requiredEnv: ["DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL", "DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_TOKEN", "or METRICOOL_USER_TOKEN + METRICOOL_USER_ID"],
      missingEnv: socialMissing,
      approvalGate: "Robert aprueba publish_social antes de publicar.",
      nextAction: socialMissing.length
        ? "Conectar webhook de publisher, configurar Metricool MCP o publicar manual registrando URL."
        : socialConfig.mode === "metricool_mcp"
          ? "Usar Metricool como publisher controlado; para POST automatico agrega un wrapper webhook compatible."
          : "Ejecutar dry-run antes del primer publish real.",
      evidence: socialMissing.length
        ? ["Sin webhook social ni Metricool MCP listo."]
        : socialConfig.mode === "metricool_mcp"
          ? [`Metricool MCP listo en ${socialConfig.metricoolMcpUrl}.`]
          : ["Webhook social detectado."],
    },
    {
      id: "telegram",
      label: "Telegram daily reporting",
      status: telegramMissing.length ? "needs_setup" : "ready",
      mode: telegramMissing.length ? "manual" : "api",
      ownerAgent: "Dropshipping CEO",
      capabilities: telegramMissing.length ? ["preview reporte diario"] : ["enviar reporte AM/PM", "resumir ventas, capital y fulfillment"],
      requiredEnv: ["TELEGRAM_BOT_TOKEN"],
      missingEnv: telegramMissing,
      approvalGate: "Usuario conecta chat y habilita reportes.",
      nextAction: telegramMissing.length ? "Configurar TELEGRAM_BOT_TOKEN y chat id desde Settings." : "Enviar reporte de prueba al chat configurado.",
      evidence: telegramMissing.length ? ["Sin bot token Telegram."] : ["Bot token Telegram detectado."],
    },
    {
      id: "supplier_ops",
      label: "Supplier/order fulfillment",
      status: supplierMissing.length ? "needs_setup" : "ready",
      mode: supplierConfig.orderWebhookUrl ? "webhook" : "manual",
      ownerAgent: "Order Ops",
      capabilities: supplierConfig.orderWebhookUrl
        ? ["preparar handoff proveedor", "registrar supplier order id/tracking", "mantener approval antes de fulfillment"]
        : ["fulfillment manual por orden pagada", "registro de supplier order id", "tracking manual"],
      requiredEnv: supplierRequiredEnv,
      missingEnv: supplierMissing,
      approvalGate: "Robert aprueba fulfill_order antes de comprar al proveedor.",
      nextAction: supplierConfig.preferredMode === "manual" ? "Usar DSers/AliExpress manual al principio y registrar tracking." : `Completar setup ${supplierConfig.preferredMode}.`,
      evidence: [`Modo proveedor: ${supplierConfig.preferredMode}.`, supplierConfig.orderWebhookUrl ? "Webhook proveedor detectado." : "Sin webhook proveedor; modo manual."],
    },
    {
      id: "approvals",
      label: "Approval gate",
      status: approvalsReady ? "ready" : "needs_setup",
      mode: approvalsReady ? "api" : "dry_run",
      ownerAgent: "Profit Guard",
      capabilities: approvalsReady
        ? ["bloquear gasto", "bloquear publish", "bloquear fulfillment", "migrar approvals locales al Trust Center"]
        : ["mantener outbox local", "previsualizar migracion", "bloquear gasto con reglas locales"],
      requiredEnv: ["DATABASE_URL"],
      missingEnv: approvalsMissing,
      approvalGate: "Siempre requerido para dinero, publicacion, Shopify y fulfillment.",
      nextAction: approvalsReady ? "Ejecutar db:push y migrar outbox local si hay pendientes." : "Configurar DATABASE_URL antes de migrar approvals al Trust Center.",
      evidence: approvalsReady ? ["DATABASE_URL detectado."] : ["Sin DATABASE_URL; approvals siguen en outbox local."],
    },
    {
      id: "payments_tax",
      label: "Payments, policy and tax",
      status: paymentsTaxMissing.length ? "needs_setup" : "ready",
      mode: "manual",
      ownerAgent: "Legal + Security",
      capabilities: ["checklist de checkout", "politicas de returns/privacy", "riesgo tax/import"],
      requiredEnv: ["STORE_PAYMENT_PROCESSOR"],
      missingEnv: paymentsTaxMissing,
      approvalGate: "No publicar tienda sin politicas visibles y checkout confirmado.",
      nextAction: paymentsTaxMissing.length ? "Definir processor antes de publicar tienda; policies ya tienen fallback publico." : "Revisar checkout con producto draft.",
      evidence: paymentsTaxMissing.length
        ? [`Policy URLs listas: refund=${policyUrls.refund}, privacy=${policyUrls.privacy}. Falta payment processor.`]
        : [`Policy URLs listas: refund=${policyUrls.refund}, privacy=${policyUrls.privacy}. Payment marker configurado.`],
    },
  ];
  const hardBlocks = connectors
    .filter((connector) => connector.id !== "telegram" && connector.status === "blocked")
    .map((connector) => `${connector.label}: ${connector.nextAction}`);
  const needsSetup = connectors.filter((connector) => connector.status === "needs_setup").length;
  const status = hardBlocks.length
    ? "blocked" as const
    : needsSetup
      ? "needs_setup" as const
      : "ready_for_dry_run" as const;

  return {
    generatedAt: new Date().toISOString(),
    status,
    summary:
      status === "ready_for_dry_run"
        ? "Conectores listos para dry-run controlado; acciones externas siguen detras de approvals."
        : status === "blocked"
          ? "Hay bloqueos duros antes de ejecutar externamente."
          : "El CEO puede operar en modo draft/manual mientras se conectan integraciones externas.",
    connectors,
    launchSequence: [
      { step: 1, owner: "Product Scout", action: "Elegir producto foco con margen, proveedor y riesgo aceptable.", mode: "autonomous", blockedUntil: [] },
      { step: 2, owner: "Store Builder", action: "Crear Shopify draft o payload dry-run.", mode: "approval_required", blockedUntil: shopifyMissing },
      { step: 3, owner: "Social Media Manager", action: "Crear posts y ponerlos en cola/publisher.", mode: "approval_required", blockedUntil: socialMissing },
      { step: 4, owner: "Profit Guard", action: "Liberar primer tramo de capital si hay cash y approvals.", mode: "approval_required", blockedUntil: approvalsMissing },
      { step: 5, owner: "Order Ops", action: "Fulfill solo orden pagada con supplier por pedido.", mode: "approval_required", blockedUntil: supplierMissing },
      { step: 6, owner: "Dropshipping CEO", action: "Enviar reporte AM/PM con ventas, capital, posts y fulfillment.", mode: telegramMissing.length ? "manual" : "autonomous", blockedUntil: telegramMissing },
    ],
    supplierOps: {
      preferredMode: supplierConfig.preferredMode,
      fulfillmentPolicy: "No comprar stock. Comprar al proveedor solo despues de orden pagada, approval y margen positivo.",
      requiredBeforeFirstOrder: [
        "supplier primario y backup",
        "shipping/returns comunicables",
        "checkout probado",
        "approval fulfill_order",
        "customer support template",
      ],
      customerPromiseRules: [
        "No prometer fecha exacta sin tracking.",
        "Mostrar shipping/returns honestos antes del checkout.",
        "Registrar tracking y soporte en cuanto el proveedor lo emita.",
      ],
    },
    hardBlocks,
    safeDefaults: [
      "Shopify siempre DRAFT hasta approval final.",
      "Social publish usa dry-run/manual si falta webhook.",
      "Supplier fulfillment no llama APIs externas sin approval.",
      "Paid spend queda limitado por Profit Guard y capital plan.",
    ],
    nextApprovalRequest: shopifyMissing.length
      ? {
          actionType: "dropshipping.create_shopify_draft",
          title: "Configurar Shopify para drafts",
          description: "Habilitar Shopify Admin token y mantener productos como DRAFT hasta aprobacion final.",
        }
      : socialMissing.length
        ? {
            actionType: "dropshipping.publish_social",
            title: "Conectar publisher social",
            description: "Definir webhook o flujo manual para publicar posts aprobados y registrar URLs.",
          }
        : {
            actionType: "dropshipping.spend",
            title: "Aprobar primer tramo de marketing",
            description: "Usar capital plan y Profit Guard para liberar solo el primer test controlado.",
          },
  };
}

function buildDropshippingLaunchReadinessCenter(input: {
  profitGuard: ReturnType<typeof buildProfitGuard>;
  executionSetup: DropshippingExecutionSetup;
  localApprovalOutbox: number;
  unfulfilledOrders: number;
}): DropshippingLaunchReadiness {
  const bestProduct = pickBestDropshippingProduct();
  const supplierReviewed = bestProduct
    ? suppliers.some((supplier) =>
        supplier.productName.toLowerCase() === bestProduct.productName.toLowerCase() &&
        supplier.status !== "blocked"
      )
    : false;
  const shopifyReady = missingEnv(["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"]).length === 0;
  const paymentProcessorConfigured = Boolean((process.env.STORE_PAYMENT_PROCESSOR || "").trim());
  const socialConfig = getSocialPublisherConfig();
  const socialReady = socialConfig.mode !== "manual";
  const telegramConfigured = missingEnv(["TELEGRAM_BOT_TOKEN"]).length === 0;
  const databaseUrlConfigured = isDatabaseUrlConfigured();
  const policyUrls = getDropshippingPolicyUrls();
  const policyRoutes = [
    policyUrls.privacy,
    policyUrls.refund,
    policyUrls.shipping,
    policyUrls.terms,
    policyUrls.checkoutReadiness,
  ];
  const requiredAccounts = [
    !shopifyReady && "Shopify Admin/API",
    !paymentProcessorConfigured && "Payment processor",
  ].filter(Boolean) as string[];
  const testOrderReady = shopifyReady && paymentProcessorConfigured;
  const postgresStatus: DropshippingLaunchReadiness["postgresTrustCenter"]["status"] =
    !databaseUrlConfigured
      ? "needs_database"
      : input.localApprovalOutbox > 0
        ? "needs_migration"
        : "ready";
  const checkoutStatus: DropshippingLaunchReadiness["checkout"]["status"] =
    testOrderReady
      ? "ready_for_test_order"
      : shopifyReady || paymentProcessorConfigured
        ? "needs_accounts"
        : "draft_ready";
  const sampleRecommended = Boolean(bestProduct && (bestProduct.requiresSample || bestProduct.status === "sample_recommended" || REQUIRE_SAMPLE_BEFORE_SCALE));
  const productSupplierStatus: DropshippingLaunchReadiness["productSupplier"]["status"] =
    !bestProduct
      ? "needs_product"
      : !supplierReviewed
        ? "needs_supplier_validation"
        : sampleRecommended
          ? "ready_for_sample"
          : "validation_ready";
  const automationStatus: DropshippingLaunchReadiness["automation"]["status"] = telegramConfigured ? "ready" : "preview_only";
  const hardBlocks = [
    input.profitGuard.status === "pause_spend" && "Profit Guard pauso gasto: budget activo alcanzado.",
    !bestProduct && "Falta elegir producto foco antes de vender.",
    bestProduct && !supplierReviewed && "Falta validar supplier primario/backup antes de primera orden real.",
    !databaseUrlConfigured && "Falta DATABASE_URL para Postgres/Trust Center.",
    !testOrderReady && "Falta Shopify/payment para checkout y orden de prueba real.",
    input.unfulfilledOrders > 0 && `${input.unfulfilledOrders} orden(es) requieren fulfillment/approval.`,
  ].filter(Boolean) as string[];
  const hasAccountBlock = !testOrderReady || !databaseUrlConfigured || !telegramConfigured || !socialReady;
  const hasProductOrSupplierBlock = !bestProduct || !supplierReviewed;
  const status: DropshippingLaunchReadiness["status"] =
    input.profitGuard.status === "pause_spend"
      ? "blocked_safety"
      : hasAccountBlock
        ? "blocked_needs_accounts"
        : hasProductOrSupplierBlock
          ? "blocked_safety"
          : testOrderReady && databaseUrlConfigured && bestProduct && supplierReviewed
            ? "ready_for_test_order"
            : "pre_account_ready";

  return {
    generatedAt: new Date().toISOString(),
    status,
    summary:
      status === "ready_for_test_order"
        ? "Listo para hacer orden de prueba controlada antes de vender real."
        : status === "blocked_safety"
          ? "Bloqueado por seguridad financiera u operativa."
          : status === "blocked_needs_accounts"
            ? "La preparacion local esta lista, pero faltan cuentas/credenciales para ejecutar real."
            : "Modo pre-cuentas listo: investigar, crear drafts, revisar politicas y preparar approvals sin gastar.",
    budgetLimits: {
      startingMonthlyBudgetUsd: STARTING_MONTHLY_BUDGET_USD,
      activeMonthlyBudgetUsd: input.profitGuard.monthlyBudgetUsd,
      dailySpendCapUsd: DAILY_SPEND_CAP_USD,
      maxSingleTestUsd: input.profitGuard.budgetPolicy.maxSingleTestUsd,
      targetMonthlyRevenueUsd: TARGET_MONTHLY_REVENUE_USD,
      canSpendUsd: input.profitGuard.canSpendUsd,
      requiresApprovalForExternalActions: REQUIRE_APPROVALS_FOR_EXTERNAL_ACTIONS,
      requiresSampleBeforeScale: REQUIRE_SAMPLE_BEFORE_SCALE,
    },
    postgresTrustCenter: {
      databaseUrlConfigured,
      dbPushCommand: "npm run db:push",
      migrationPath: "Approvals > Migrar outbox local",
      localApprovalOutbox: input.localApprovalOutbox,
      status: postgresStatus,
      nextAction:
        postgresStatus === "ready"
          ? "Trust Center listo; mantener approvals externos alli."
          : postgresStatus === "needs_migration"
            ? "Correr dry-run y luego migrar outbox local al Trust Center."
            : "Configurar DATABASE_URL, correr npm run db:push y repetir migracion.",
    },
    checkout: {
      paymentProcessorConfigured,
      policyRoutesReady: true,
      testOrderReady,
      status: checkoutStatus,
      requiredAccounts,
      policyRoutes,
      nextAction: testOrderReady
        ? "Hacer una orden de prueba y verificar pago, taxes, email, shipping y refund path."
        : "Conectar Shopify/payment; las politicas y checklist ya pueden revisarse antes.",
    },
    productSupplier: {
      productSelected: Boolean(bestProduct),
      productName: bestProduct?.productName || "",
      supplierReviewed,
      sampleRecommended,
      status: productSupplierStatus,
      nextAction:
        productSupplierStatus === "needs_product"
          ? "Elegir producto foco con margen, shipping y bajo riesgo."
          : productSupplierStatus === "needs_supplier_validation"
            ? "Validar supplier primario y backup antes de publicar fuerte."
            : productSupplierStatus === "ready_for_sample"
              ? "Pedir approval de sample de 1 unidad antes de escalar."
              : "Producto/supplier listos para checkout de prueba.",
    },
    automation: {
      schedulerConfigured: Boolean((process.env.SCHEDULER_TIMEZONE || "America/New_York").trim()),
      telegramConfigured,
      reportsMode: telegramConfigured ? "telegram" : "preview_only",
      status: automationStatus,
      nextAction: telegramConfigured
        ? "Enviar reporte de prueba y dejar AM/PM activos."
        : "Conectar Telegram; mientras tanto usar preview de reporte en la app.",
    },
    canDoNow: [
      "Seguir investigando productos y suppliers sin comprar inventario.",
      "Crear drafts de Shopify en dry-run/payload local.",
      "Crear posts, captions, hooks y calendario sin publicar.",
      "Revisar politicas publicas y checklist de checkout.",
      "Preparar approvals locales y migrarlos cuando Postgres este listo.",
      "Correr report preview AM/PM sin Telegram real.",
    ],
    requiresConnectedAccounts: [
      "Postgres DATABASE_URL para Trust Center persistente.",
      "Shopify + payment processor para checkout real y orden de prueba.",
      "Telegram Bot + chat para reportes diarios reales.",
      "Redes/social publisher: webhook compatible o Metricool MCP con publicacion aprobada.",
      "Supplier portal/API para fulfillment real por orden pagada.",
    ],
    hardBlocks,
    tomorrowChecklist: [
      "Pegar DATABASE_URL y correr npm run db:push.",
      "Abrir Approvals > Revisar y luego Migrar outbox local.",
      "Conectar Shopify/payment y hacer una orden de prueba.",
      "Conectar Telegram y enviar reporte de prueba.",
      "Conectar redes por Metricool o webhook social y publicar solo posts aprobados.",
      "Validar supplier primario/backup y pedir sample solo con approval.",
    ],
  };
}

function buildSocialPostGuardrail(
  campaign: DropshippingMarketingCampaign | null,
  product: DropshippingProduct | null,
  approvalToPublish: boolean,
) {
  const missing = [
    !campaign && "campana valida",
    !product && "producto valido",
    product?.status === "blocked" && "producto no bloqueado",
    campaign?.status === "blocked" && "campana no bloqueada",
    !approvalToPublish && "approval de Robert para publicar",
  ].filter(Boolean) as string[];
  const ready = missing.length === 0;

  return {
    status: ready ? "ready" as const : "blocked" as const,
    reason: ready
      ? "Post listo para cola de publicacion. No gasta dinero y no sale externo sin ejecucion aprobada."
      : `Publicacion bloqueada o pendiente: falta ${missing.join(", ")}.`,
    missing,
  };
}

function buildSocialPostPayload(
  campaign: DropshippingMarketingCampaign,
  product: DropshippingProduct,
  platform: DropshippingSocialPlatform,
  hook: string,
  caption: string,
  cta: string,
) {
  return {
    source: "dropshipping-ceo",
    campaignId: campaign.id,
    productId: product.id,
    platform,
    format: formatForPlatform(platform),
    hook,
    caption,
    cta,
    product: {
      name: product.productName,
      priceUsd: product.targetSellPriceUsd,
      landedCostUsd: product.economics.landedCostUsd,
      shippingWindow: `${product.shippingDaysMin}-${product.shippingDaysMax} dias estimados`,
    },
    guardrails: [
      "no claims de salud, marcas, resultados garantizados ni tiempos absolutos",
      "no comprar inventario ni prometer stock propio",
      "revisar precio, shipping, returns y proveedor antes de escalar",
    ],
  };
}

export function createDropshippingSocialPostBatch(input: DropshippingSocialPostBatchInput) {
  loadAll();
  const parsed = dropshippingSocialPostBatchSchema.parse(input);
  const campaign = findCampaignById(parsed.campaignId);
  const product = campaign?.product || products.find((item) => item.id === campaign?.productId) || null;
  const guardrail = buildSocialPostGuardrail(campaign, product, parsed.approvalToPublish);

  if (!campaign || !product) {
    return { posts: [], guardrail, snapshot: getDropshippingCeoSnapshot() };
  }

  const drafts = campaign.socialDrafts.length ? campaign.socialDrafts : buildCampaignDrafts(campaign, product);
  const now = new Date().toISOString();
  const posts: DropshippingSocialPost[] = [];
  for (const platform of parsed.platforms) {
    for (let index = 0; index < parsed.postsPerPlatform; index += 1) {
      const draft = drafts[(posts.length + index) % drafts.length];
      const hook = platform === "email"
        ? `${campaign.offer}: ${draft.hook}`
        : draft.hook;
      const cta = platform === "email" ? "Responder o visitar checkout cuando este aprobado." : "Comenta si quieres que probemos este producto.";
      const caption = `${draft.caption} CTA: ${cta}`;
      const hardBlocked = product.status === "blocked" || campaign.status === "blocked";
      const status = hardBlocked
        ? "blocked" as const
        : guardrail.status === "blocked"
          ? "approval_required" as const
        : "queued" as const;
      const post: DropshippingSocialPost = {
        id: `drop-social-${Date.now()}-${socialPosts.length + posts.length + 1}`,
        createdAt: now,
        updatedAt: now,
        campaignId: campaign.id,
        productId: product.id,
        platform,
        format: formatForPlatform(platform),
        status,
        approvalToPublish: parsed.approvalToPublish,
        scheduledFor: parsed.scheduledDate || now,
        product,
        campaign,
        hook,
        caption,
        cta,
        assetBrief: [
          `${platformLabel(platform)} ${formatForPlatform(platform)} mostrando problema visible en los primeros 2 segundos.`,
          `Mostrar el producto en uso, precio objetivo ${money.format(product.targetSellPriceUsd)} y shipping estimado ${product.shippingDaysMin}-${product.shippingDaysMax} dias.`,
          "Cerrar con beneficio claro y sin claims exagerados.",
        ],
        complianceChecks: [
          "sin marcas no autorizadas ni contenido copiado",
          "sin prometer delivery exacto",
          "sin prometer resultados medicos, financieros o garantizados",
        ],
        guardrail,
        publishPayload: buildSocialPostPayload(campaign, product, platform, hook, caption, cta),
        publishResult: { mode: "none", externalPostUrl: "", responseStatus: null, message: "Aun no publicado.", publishedAt: "" },
        metricsSummary: { views: 0, clicks: 0, orders: 0, revenueUsd: 0, spendUsd: 0, profitUsd: 0, conversionRatePercent: 0 },
        nextActions:
          status === "queued"
            ? ["revisar asset", "ejecutar publish dry-run o webhook", "registrar metricas despues de publicar"]
            : ["enviar approval para publicar", "mantener como draft interno", "no gastar en ads"],
      };
      posts.push(post);
    }
  }

  socialPosts.unshift(...posts);
  persistSocialPosts();
  return { posts, guardrail, snapshot: getDropshippingCeoSnapshot() };
}

function buildSocialPublishGuardrail(post: DropshippingSocialPost | null, input: DropshippingSocialPublishInput) {
  const config = getSocialPublisherConfig();
  const missing = [
    !post && "post valido",
    post?.status === "blocked" && "post no bloqueado",
    !input.approvalToPublish && "approval de Robert para publicar",
    !input.dryRun && !input.externalPostUrl && !config.webhookUrl && "DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL o URL manual publicada",
  ].filter(Boolean) as string[];
  const ready = missing.length === 0;

  return {
    config,
    guardrail: {
      status: ready ? "ready" as const : "blocked" as const,
      reason: ready
        ? input.dryRun
          ? "Dry run aprobado: queda en cola y no sale a ninguna red."
          : "Listo para publicar o registrar evidencia externa aprobada."
        : `Publicacion bloqueada: falta ${missing.join(", ")}.`,
      missing,
    },
  };
}

export async function publishDropshippingSocialPost(
  input: DropshippingSocialPublishInput,
  fetchImpl: typeof fetch = fetch,
) {
  loadAll();
  const parsed = dropshippingSocialPublishSchema.parse(input);
  const post = socialPosts.find((item) => item.id === parsed.postId) || null;
  const { config, guardrail } = buildSocialPublishGuardrail(post, parsed);

  if (!post) {
    return { published: false, post: null, guardrail, snapshot: getDropshippingCeoSnapshot() };
  }

  post.approvalToPublish = parsed.approvalToPublish;
  post.guardrail = guardrail;
  post.updatedAt = new Date().toISOString();

  if (guardrail.status !== "ready") {
    post.status = parsed.approvalToPublish ? "blocked" : "approval_required";
    post.publishResult = { mode: "none", externalPostUrl: "", responseStatus: null, message: guardrail.reason, publishedAt: "" };
    post.nextActions = ["crear approval publish_social", "corregir credenciales o evidencia", "mantener post sin publicar"];
    persistSocialPosts();
    return { published: false, post, guardrail, snapshot: getDropshippingCeoSnapshot() };
  }

  if (parsed.dryRun) {
    post.status = "queued";
    post.publishResult = { mode: "dry_run", externalPostUrl: "", responseStatus: null, message: "Dry run: payload validado, sin publicar externo.", publishedAt: "" };
    post.nextActions = ["revisar copy/asset", "ejecutar webhook real o publicar manual", "registrar metricas cuando este vivo"];
    persistSocialPosts();
    return { published: false, post, guardrail, snapshot: getDropshippingCeoSnapshot() };
  }

  if (parsed.externalPostUrl) {
    post.status = "published";
    post.publishResult = { mode: "manual", externalPostUrl: parsed.externalPostUrl, responseStatus: null, message: "Publicacion manual registrada con evidencia.", publishedAt: new Date().toISOString() };
    post.nextActions = ["medir views/clicks/orders", "guardar metricas", "comparar contra otros hooks"];
    persistSocialPosts();
    return { published: true, post, guardrail, snapshot: getDropshippingCeoSnapshot() };
  }

  try {
    const response = await fetchImpl(config.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.webhookToken ? { Authorization: `Bearer ${config.webhookToken}` } : {}),
      },
      body: JSON.stringify(post.publishPayload),
    });
    const payload = await response.json().catch(() => ({})) as { url?: string; postUrl?: string; message?: string };
    post.status = response.ok ? "published" : "failed";
    post.publishResult = {
      mode: "webhook",
      externalPostUrl: payload.url || payload.postUrl || "",
      responseStatus: response.status,
      message: payload.message || (response.ok ? "Webhook de publicacion acepto el post." : "Webhook de publicacion rechazo el post."),
      publishedAt: response.ok ? new Date().toISOString() : "",
    };
    post.nextActions = response.ok
      ? ["medir metricas reales", "guardar resultados", "escalar solo si hay senal"]
      : ["revisar webhook/credenciales", "mantener post en cola", "no reintentar masivo sin revisar"];
    persistSocialPosts();
    return { published: response.ok, post, guardrail, snapshot: getDropshippingCeoSnapshot() };
  } catch (error) {
    post.status = "failed";
    post.publishResult = {
      mode: "webhook",
      externalPostUrl: "",
      responseStatus: null,
      message: error instanceof Error ? error.message : "Social publish webhook failed",
      publishedAt: "",
    };
    post.nextActions = ["revisar conectores sociales", "usar dry-run/manual mientras tanto", "no duplicar publicaciones"];
    persistSocialPosts();
    return { published: false, post, guardrail, snapshot: getDropshippingCeoSnapshot() };
  }
}

export function recordDropshippingSocialMetrics(input: DropshippingSocialMetricsInput) {
  loadAll();
  const parsed = dropshippingSocialMetricsSchema.parse(input);
  const post = socialPosts.find((item) => item.id === parsed.postId) || null;
  const platform = parsed.platform || post?.platform || "manual";
  const visibleCount = parsed.views || parsed.impressions;
  const engagementRatePercent = visibleCount > 0 ? Number((((parsed.likes + parsed.comments + parsed.shares) / visibleCount) * 100).toFixed(2)) : 0;
  const clickRatePercent = visibleCount > 0 ? Number(((parsed.clicks / visibleCount) * 100).toFixed(2)) : 0;
  const conversionRatePercent = parsed.clicks > 0
    ? Number(((parsed.orders / parsed.clicks) * 100).toFixed(2))
    : visibleCount > 0
      ? Number(((parsed.orders / visibleCount) * 100).toFixed(2))
      : 0;
  const profitUsd = Number((parsed.revenueUsd - parsed.spendUsd).toFixed(2));
  const roas = parsed.spendUsd > 0 ? Number((parsed.revenueUsd / parsed.spendUsd).toFixed(2)) : parsed.revenueUsd > 0 ? parsed.revenueUsd : 0;
  const metric: DropshippingSocialMetric = {
    ...parsed,
    id: `drop-social-metric-${Date.now()}-${socialMetrics.length + 1}`,
    createdAt: new Date().toISOString(),
    platform,
    campaignId: post?.campaignId || "",
    productId: post?.productId || "",
    post,
    calculated: { engagementRatePercent, clickRatePercent, conversionRatePercent, profitUsd, roas },
  };

  socialMetrics.unshift(metric);
  persistSocialMetrics();
  if (post) {
    post.metricsSummary = {
      views: parsed.views,
      clicks: parsed.clicks,
      orders: parsed.orders,
      revenueUsd: parsed.revenueUsd,
      spendUsd: parsed.spendUsd,
      profitUsd,
      conversionRatePercent,
    };
    post.updatedAt = new Date().toISOString();
    post.nextActions = profitUsd > 0 && parsed.orders > 0
      ? ["usar hook como candidato ganador", "crear variaciones organicas", "solicitar approval antes de paid test"]
      : ["probar nuevo hook", "revisar oferta/shipping/confianza", "mantener gasto en cero"];
    persistSocialPosts();
  }

  return { metric, snapshot: getDropshippingCeoSnapshot() };
}

export function analyzeDropshippingSocialPerformance(input: Partial<DropshippingSocialAnalysisInput> = {}) {
  loadAll();
  const parsed = dropshippingSocialAnalysisSchema.parse(input);
  const scopedMetrics = parsed.campaignId
    ? socialMetrics.filter((metric) => metric.campaignId === parsed.campaignId)
    : socialMetrics;
  const totalViews = scopedMetrics.reduce((sum, metric) => sum + metric.views, 0);
  const totalClicks = scopedMetrics.reduce((sum, metric) => sum + metric.clicks, 0);
  const totalOrders = scopedMetrics.reduce((sum, metric) => sum + metric.orders, 0);
  const totalRevenueUsd = Number(scopedMetrics.reduce((sum, metric) => sum + metric.revenueUsd, 0).toFixed(2));
  const totalSpendUsd = Number(scopedMetrics.reduce((sum, metric) => sum + metric.spendUsd, 0).toFixed(2));
  const profitUsd = Number((totalRevenueUsd - totalSpendUsd).toFixed(2));
  const bestMetric = [...scopedMetrics].sort((a, b) => {
    const orderDiff = b.orders - a.orders;
    if (orderDiff !== 0) return orderDiff;
    const profitDiff = b.calculated.profitUsd - a.calculated.profitUsd;
    if (profitDiff !== 0) return profitDiff;
    return b.clicks - a.clicks;
  })[0] || null;
  const status =
    scopedMetrics.length === 0
      ? "needs_data" as const
      : profitUsd < 0 || (totalSpendUsd > 0 && totalRevenueUsd === 0)
        ? "pause_social" as const
        : totalOrders >= 3 && profitUsd >= 0
          ? "scale_content" as const
          : "iterate_hooks" as const;
  const winningPlatform = bestMetric?.platform || "";
  const winningHook = bestMetric?.post?.hook || "";
  const summary =
    status === "needs_data"
      ? "Faltan metricas reales para decidir."
      : status === "pause_social"
        ? "Hay gasto o perdida sin senal suficiente; pausar paid y revisar oferta."
        : status === "scale_content"
          ? `Hook ganador detectado en ${platformLabel(winningPlatform as DropshippingSocialPlatform)} con ${totalOrders} ordenes.`
          : "Seguir iterando hooks organicos hasta tener clicks/ordenes claros.";
  const recommendations =
    status === "scale_content"
      ? [
          `Duplicar el angulo ganador: ${winningHook || "hook con mas conversion"}.`,
          "Crear 3 variaciones organicas antes de pedir paid test.",
          "Solicitar approval de gasto solo con cash cobrado y Profit Guard disponible.",
        ]
      : status === "pause_social"
        ? ["Pausar paid tests.", "Revisar precio, shipping, supplier y confianza en la pagina.", "Volver a organico hasta recuperar profit."]
        : status === "needs_data"
          ? ["Publicar/registrar al menos 3 posts y cargar views, clicks y ordenes.", "No escalar sin datos."]
          : ["Cambiar primer segundo del video.", "Probar prueba social/objecion de shipping.", "Mantener CTA simple y medir clicks."];
  const analysis: DropshippingSocialAnalysis = {
    ...parsed,
    id: `drop-social-analysis-${Date.now()}-${socialAnalyses.length + 1}`,
    createdAt: new Date().toISOString(),
    status,
    summary,
    winningPlatform,
    winningHook,
    totalViews,
    totalClicks,
    totalOrders,
    totalRevenueUsd,
    totalSpendUsd,
    profitUsd,
    recommendations,
    nextPostRules: [
      winningPlatform ? `Priorizar ${platformLabel(winningPlatform as DropshippingSocialPlatform)} para el proximo batch.` : "Elegir TikTok + Instagram para el primer batch.",
      winningHook ? `Crear variaciones del hook: ${winningHook}` : "Probar hooks de problema visible, comparacion y objecion de shipping.",
      "Registrar metricas diariamente antes del reporte Telegram.",
    ],
  };

  socialAnalyses.unshift(analysis);
  persistSocialAnalyses();
  return { analysis, snapshot: getDropshippingCeoSnapshot() };
}

function summarizeLedger(entries: DropshippingLedgerEntry[]) {
  const totalRevenueUsd = entries.filter((entry) => entry.kind === "sale").reduce((sum, entry) => sum + entry.amountUsd, 0);
  const cashCollectedUsd = entries.reduce((sum, entry) => sum + entry.cashCollectedUsd, 0);
  const totalSpendUsd = entries
    .filter((entry) => entry.kind === "expense" || entry.kind === "sample_order")
    .reduce((sum, entry) => sum + entry.amountUsd, 0);
  const refundsUsd = entries.filter((entry) => entry.kind === "refund").reduce((sum, entry) => sum + entry.amountUsd, 0);
  const profitUsd = Number((totalRevenueUsd - totalSpendUsd - refundsUsd).toFixed(2));

  return { totalRevenueUsd, cashCollectedUsd, totalSpendUsd, refundsUsd, profitUsd };
}

function buildBudgetPolicy(entries: DropshippingLedgerEntry[], metricList: DropshippingSocialMetric[] = []) {
  const totals = summarizeLedger(entries);
  const orderSignal = Math.max(
    metricList.reduce((sum, metric) => sum + metric.orders, 0),
    learningReviews.reduce((sum, review) => sum + review.orders, 0),
    orderRecords.filter((order) => order.paymentStatus === "paid").reduce((sum, order) => sum + order.quantity, 0),
  );
  const stages = [
    { stage: "starter_100" as const, activeMonthlyBudgetUsd: 100, minRevenueUsd: 0, minProfitUsd: -1000000, minOrders: 0 },
    { stage: "validation_250" as const, activeMonthlyBudgetUsd: 250, minRevenueUsd: 250, minProfitUsd: 50, minOrders: 5 },
    { stage: "growth_500" as const, activeMonthlyBudgetUsd: 500, minRevenueUsd: 750, minProfitUsd: 150, minOrders: 12 },
    { stage: "scale_1000" as const, activeMonthlyBudgetUsd: 1000, minRevenueUsd: 1000, minProfitUsd: 250, minOrders: 20 },
  ];
  const activeStage = [...stages].reverse().find((stage) =>
    totals.totalRevenueUsd >= stage.minRevenueUsd &&
    totals.profitUsd >= stage.minProfitUsd &&
    orderSignal >= stage.minOrders
  ) || stages[0];
  const nextStage = stages[stages.findIndex((stage) => stage.stage === activeStage.stage) + 1] || null;
  const profitBasedTestUsd = Math.max(10, Math.max(totals.profitUsd, 0) * 0.15 || 10);
  const maxSingleTestUsd = Number(Math.min(activeStage.activeMonthlyBudgetUsd * 0.25, profitBasedTestUsd, DAILY_SPEND_CAP_USD).toFixed(2));
  const reasons = [
    `Nivel activo ${activeStage.stage}: budget mensual ${money.format(activeStage.activeMonthlyBudgetUsd)}.`,
    `Cap diario ${money.format(DAILY_SPEND_CAP_USD)} y max test ${money.format(maxSingleTestUsd)}.`,
    `Ventas ledger ${money.format(totals.totalRevenueUsd)}, profit ${money.format(totals.profitUsd)}, ordenes senal ${orderSignal}.`,
    nextStage
      ? `Para subir a ${nextStage.stage}: ventas ${money.format(nextStage.minRevenueUsd)}, profit ${money.format(nextStage.minProfitUsd)} y ${nextStage.minOrders} ordenes.`
      : "Nivel scale_1000 alcanzado; mantener ROAS, supplier y soporte antes de subir mas.",
  ];

  return {
    stage: activeStage.stage,
    activeMonthlyBudgetUsd: activeStage.activeMonthlyBudgetUsd,
    startingMonthlyBudgetUsd: STARTING_MONTHLY_BUDGET_USD,
    targetMonthlyRevenueUsd: TARGET_MONTHLY_REVENUE_USD,
    dailySpendCapUsd: DAILY_SPEND_CAP_USD,
    nextStage: nextStage?.stage || "",
    nextBudgetUsd: nextStage?.activeMonthlyBudgetUsd || activeStage.activeMonthlyBudgetUsd,
    maxSingleTestUsd,
    orderSignal,
    requiresApprovalForExternalActions: REQUIRE_APPROVALS_FOR_EXTERNAL_ACTIONS,
    requiresSampleBeforeScale: REQUIRE_SAMPLE_BEFORE_SCALE,
    reasons,
    scalingRule: "Escalar budget solo con ventas cobradas, profit positivo, ordenes reales y approval humano.",
  };
}

function buildProfitGuard(entries: DropshippingLedgerEntry[], approvalQueue: number, metricList: DropshippingSocialMetric[] = socialMetrics) {
  const totals = summarizeLedger(entries);
  const budgetPolicy = buildBudgetPolicy(entries, metricList);
  const monthlyBudgetUsd = budgetPolicy.activeMonthlyBudgetUsd;
  const remainingBudgetUsd = Number(Math.max(0, monthlyBudgetUsd - totals.totalSpendUsd).toFixed(2));
  const rawCanSpendUsd = totals.cashCollectedUsd > totals.totalSpendUsd && approvalQueue === 0 ? Math.min(remainingBudgetUsd, totals.cashCollectedUsd - totals.totalSpendUsd) : 0;
  const canSpendUsd = Math.min(rawCanSpendUsd, budgetPolicy.maxSingleTestUsd);
  const status =
    totals.totalSpendUsd >= monthlyBudgetUsd
      ? "pause_spend" as const
      : totals.cashCollectedUsd <= totals.totalSpendUsd
        ? "collect_first" as const
        : approvalQueue > 0
          ? "review_queue" as const
          : "scale_carefully" as const;

  return {
    status,
    monthlyBudgetUsd,
    targetMonthlyRevenueUsd: TARGET_MONTHLY_REVENUE_USD,
    totalRevenueUsd: totals.totalRevenueUsd,
    cashCollectedUsd: totals.cashCollectedUsd,
    totalSpendUsd: totals.totalSpendUsd,
    refundsUsd: totals.refundsUsd,
    profitUsd: totals.profitUsd,
    remainingBudgetUsd,
    canSpendUsd: Number(canSpendUsd.toFixed(2)),
    budgetPolicy,
    reason:
      status === "pause_spend"
        ? "Pausar gasto: ya se alcanzo el budget activo."
        : status === "collect_first"
          ? "Cobrar primero: no gastar mas de lo cobrado."
          : status === "review_queue"
            ? "Hay aprobaciones pendientes antes de escalar."
            : "Puede escalar con cuidado, manteniendo approvals y presupuesto.",
  };
}

function buildGrowthSprintCalendar(input: {
  days: number;
  product: DropshippingProduct | null;
  campaign: DropshippingMarketingCampaign | null;
  approvedToRiskUsd: number;
  status: DropshippingGrowthSprint["status"];
  focus: DropshippingGrowthSprintInput["focus"];
}) {
  const productName = input.product?.productName || "producto foco";
  const microBudget = Number(Math.min(input.approvedToRiskUsd, Math.max(0, input.approvedToRiskUsd / 2)).toFixed(2));
  const paidBudget = Number(Math.max(0, input.approvedToRiskUsd - microBudget).toFixed(2));
  const noProduct = !input.product;
  const base: DropshippingGrowthSprint["campaignCalendar"] = noProduct
    ? [
        { day: 1, owner: "Product Scout", channel: "Research", task: "Encontrar 3 productos candidatos con margen 45%+, demanda visible y bajo riesgo legal.", kpi: "3 candidatos con costo, precio, evidencia y supplier.", budgetUsd: 0, approvalGate: "none" },
        { day: 2, owner: "Supplier Analyst", channel: "Supplier ops", task: "Buscar 2 suppliers por candidato y filtrar shipping, tracking, returns y reviews.", kpi: "2 suppliers por candidato o producto descartado.", budgetUsd: 0, approvalGate: "contact_supplier" },
        { day: 3, owner: "Profit Guard", channel: "Finance", task: "Calcular landed cost, margen, break-even y ordenes necesarias para $1k/mes.", kpi: "1 producto rankeado A/B listo para Robert.", budgetUsd: 0, approvalGate: "none" },
        { day: 4, owner: "CMO", channel: "Content", task: "Crear hooks y briefs organicos para el mejor candidato sin publicar.", kpi: "6 hooks + 3 briefs visuales.", budgetUsd: 0, approvalGate: "publish_social" },
        { day: 5, owner: "Store Builder", channel: "Shopify draft", task: "Preparar copy de landing y checklist de confianza.", kpi: "Landing draft listo para approval.", budgetUsd: 0, approvalGate: "create_shopify_draft" },
        { day: 6, owner: "Legal + Security", channel: "Compliance", task: "Revisar claims, marcas, politicas, shipping y returns.", kpi: "0 hard blocks antes de publicar.", budgetUsd: 0, approvalGate: "none" },
        { day: 7, owner: "Dropshipping CEO", channel: "Board review", task: "Elegir producto foco y pedir approvals minimos para iniciar validacion.", kpi: "Decision: aprobar, cambiar o descartar.", budgetUsd: 0, approvalGate: "publish_product" },
      ]
    : [
        { day: 1, owner: "Dropshipping CEO", channel: "Board", task: `Declarar ${productName} como producto foco y fijar meta del sprint.`, kpi: "1 producto foco + KPI claro.", budgetUsd: 0, approvalGate: "none" },
        { day: 2, owner: "Store Builder", channel: "Shopify draft", task: "Preparar pagina draft con precio, shipping, returns, FAQ y confianza.", kpi: "Draft listo o bloqueo documentado.", budgetUsd: 0, approvalGate: "create_shopify_draft" },
        { day: 3, owner: "CMO", channel: "Organic social", task: "Crear batch de posts con 3 angulos: problema, prueba visual y objecion.", kpi: "6 posts draft aprobables.", budgetUsd: 0, approvalGate: "publish_social" },
        { day: 4, owner: "Social Manager", channel: "TikTok + Instagram", task: "Poner en cola los mejores posts aprobados y medir vistas/clicks.", kpi: "2-4 posts publicados si Robert aprueba.", budgetUsd: 0, approvalGate: "publish_social" },
        { day: 5, owner: "Analytics Analyst", channel: "Learning", task: "Leer views, clicks, add-to-carts, ordenes y objeciones.", kpi: "1 winning hook o decision de iterar.", budgetUsd: 0, approvalGate: "none" },
        { day: 6, owner: "Ads Strategist", channel: input.focus === "scale_winner" || input.focus === "prepare_large_campaign" ? "Meta/TikTok scale plan" : "Micro paid test", task: "Preparar test pagado por tramos solo si hay cash y approval.", kpi: "Kill-switch + budget split + ROAS target.", budgetUsd: microBudget, approvalGate: "spend" },
        { day: 7, owner: "Dropshipping CEO", channel: "Board review", task: "Decidir matar, iterar o escalar segun data real.", kpi: "Decision board + siguiente sprint.", budgetUsd: paidBudget, approvalGate: paidBudget > 0 ? "spend" : "none" },
      ];

  while (base.length < input.days) {
    const day = base.length + 1;
    base.push({
      day,
      owner: day % 2 === 0 ? "Learning Analyst" : "CMO",
      channel: "Optimization",
      task: `Iterar ${productName} con la mejor senal del sprint anterior.`,
      kpi: "Mejorar hook, CTR, add-to-cart o ordenes.",
      budgetUsd: 0,
      approvalGate: "publish_social",
    });
  }

  return base.slice(0, input.days);
}

function buildGrowthSprintBoardApprovals(input: {
  product: DropshippingProduct | null;
  campaign: DropshippingMarketingCampaign | null;
  requestedBudgetUsd: number;
  approvedToRiskUsd: number;
}): DropshippingGrowthSprint["boardApprovals"] {
  const approvalsNeeded: DropshippingGrowthSprint["boardApprovals"] = [];

  if (input.product) {
    approvalsNeeded.push({
      actionType: "dropshipping.publish_product",
      title: `Aprobar producto foco: ${input.product.productName}`,
      reason: "Necesario antes de crear pagina publica o oferta externa.",
      maxSpendUsd: 0,
    });
    approvalsNeeded.push({
      actionType: "dropshipping.create_shopify_draft",
      title: "Aprobar draft Shopify",
      reason: "Crear producto en draft con precio, shipping, returns y FAQ antes de publicar.",
      maxSpendUsd: 0,
    });
    if (input.product.requiresSample) {
      approvalsNeeded.push({
        actionType: "dropshipping.order_sample",
        title: "Aprobar sample de 1 unidad",
        reason: "Producto marcado como sample recomendado; no comprar inventario.",
        maxSpendUsd: input.product.economics.landedCostUsd,
      });
    }
    approvalsNeeded.push({
      actionType: "dropshipping.contact_supplier",
      title: "Aprobar contacto/proveedor",
      reason: "Confirmar stock, tracking, returns y tiempos antes de vender fuerte.",
      maxSpendUsd: 0,
    });
  }

  if (input.campaign || input.product) {
    approvalsNeeded.push({
      actionType: "dropshipping.publish_social",
      title: "Aprobar posts organicos",
      reason: "Publicacion externa siempre requiere approval aunque el budget sea $0.",
      maxSpendUsd: 0,
    });
  }

  if (input.requestedBudgetUsd > 0) {
    approvalsNeeded.push({
      actionType: "dropshipping.spend",
      title: "Aprobar tramo de gasto",
      reason: input.approvedToRiskUsd > 0
        ? "Profit Guard permite preparar un tramo pequeno; no usar el envelope completo de golpe."
        : "El budget queda en plan hasta que haya cash, senales y approval.",
      maxSpendUsd: input.approvedToRiskUsd,
    });
  }

  return approvalsNeeded;
}

export function buildDropshippingGrowthSprint(input: Partial<DropshippingGrowthSprintInput> = {}) {
  loadAll();
  const parsed = dropshippingGrowthSprintSchema.parse(input);
  const approvalQueue = approvalQueueCount(products, launchPlans, marketingCampaigns, socialPosts, orderRecords, fulfillmentActions);
  const profitGuard = buildProfitGuard(ledger, approvalQueue, socialMetrics);
  const product = pickBestDropshippingProduct();
  const campaign = product
    ? marketingCampaigns.find((item) => item.productId === product.id) || null
    : marketingCampaigns[0] || null;
  const totals = summarizeLedger(ledger);
  const orders = Math.max(
    socialMetrics.reduce((sum, metric) => sum + metric.orders, 0),
    orderRecords.filter((order) => order.paymentStatus === "paid").reduce((sum, order) => sum + order.quantity, 0),
  );
  const requestedBudgetUsd = Number(Math.min(parsed.requestedBudgetUsd, parsed.focus === "first_100_validation" ? STARTING_MONTHLY_BUDGET_USD : 10000).toFixed(2));
  const asksLargeCampaign = parsed.focus === "scale_winner" || parsed.focus === "prepare_large_campaign" || requestedBudgetUsd > profitGuard.budgetPolicy.activeMonthlyBudgetUsd;
  const largeStageReady = profitGuard.budgetPolicy.stage === "growth_500" || profitGuard.budgetPolicy.stage === "scale_1000";
  const status: DropshippingGrowthSprint["status"] =
    profitGuard.status === "pause_spend"
      ? "blocked"
      : !product
        ? "needs_product"
        : approvalQueue > 0
          ? "approval_locked"
          : asksLargeCampaign && !largeStageReady
            ? "scale_locked"
            : "ready";
  const approvedToRiskUsd = status === "ready" && parsed.approvalToPrepareSpend
    ? Number(Math.min(requestedBudgetUsd, profitGuard.canSpendUsd, profitGuard.budgetPolicy.maxSingleTestUsd).toFixed(2))
    : 0;
  const spendMode: DropshippingGrowthSprint["budgetEnvelope"]["spendMode"] = approvedToRiskUsd > 0
    ? asksLargeCampaign ? "scale_plan_only" : "micro_test_ready"
    : "organic_only";
  const sellPriceUsd = product?.targetSellPriceUsd || 25;
  const grossProfitPerOrderUsd = product?.economics.grossProfitUsd || 10;
  const sprintRevenueTargetUsd = Number(((TARGET_MONTHLY_REVENUE_USD / 30) * parsed.days).toFixed(2));
  const dailyRevenueTargetUsd = Number((TARGET_MONTHLY_REVENUE_USD / 30).toFixed(2));
  const breakEvenOrdersForRequestedBudget = grossProfitPerOrderUsd > 0 && requestedBudgetUsd > 0 ? Math.ceil(requestedBudgetUsd / grossProfitPerOrderUsd) : null;
  const breakEvenOrdersForApprovedRisk = grossProfitPerOrderUsd > 0 && approvedToRiskUsd > 0 ? Math.ceil(approvedToRiskUsd / grossProfitPerOrderUsd) : null;
  const postsReady = socialPosts.filter((post) => post.status === "queued" || post.status === "draft" || post.status === "approval_required").length;
  const postsPublished = socialPosts.filter((post) => post.status === "published").length;
  const readinessPercent = Math.min(100, [
    product ? 20 : 0,
    product?.status === "launch_ready" ? 15 : 0,
    campaign ? 15 : 0,
    postsReady + postsPublished > 0 ? 15 : 0,
    approvalQueue === 0 ? 15 : 0,
    profitGuard.status !== "pause_spend" ? 10 : 0,
    profitGuard.budgetPolicy.stage !== "starter_100" || !asksLargeCampaign ? 10 : 0,
  ].reduce((sum, item) => sum + item, 0));
  const budgetReason =
    status === "needs_product"
      ? "Primero validar producto; budget externo $0."
      : status === "approval_locked"
        ? "Hay approvals pendientes; no preparar gasto."
        : status === "scale_locked"
          ? "Campana grande bloqueada hasta llegar a growth_500 o scale_1000."
          : approvedToRiskUsd > 0
            ? `Tramo inicial permitido ${money.format(approvedToRiskUsd)}; envelope queda protegido.`
            : "Organic first: crear demanda y cobrar antes de gastar.";
  const campaignCalendar = buildGrowthSprintCalendar({
    days: parsed.days,
    product,
    campaign,
    approvedToRiskUsd,
    status,
    focus: parsed.focus,
  });
  const boardApprovals = buildGrowthSprintBoardApprovals({
    product,
    campaign,
    requestedBudgetUsd,
    approvedToRiskUsd,
  });
  const nextActions =
    status === "needs_product"
      ? ["investigar 3 productos candidatos", "rankear por margen/shipping/riesgo", "pedir approval del producto foco"]
      : status === "approval_locked"
        ? ["limpiar approval queue", "mantener drafts internos", "no publicar ni gastar"]
        : status === "scale_locked"
          ? ["seguir organic proof", "registrar ordenes y profit", "pedir solo micro tests si Profit Guard lo permite"]
          : ["ejecutar calendario interno", "preparar approvals del board", "registrar metricas diarias y decidir kill/iterate/scale"];
  const sprint: DropshippingGrowthSprint = {
    ...parsed,
    requestedBudgetUsd,
    id: `drop-growth-sprint-${Date.now()}-${growthSprints.length + 1}`,
    createdAt: new Date().toISOString(),
    status,
    product,
    campaign,
    ceoDirective: {
      headline: status === "ready" ? "Ejecutar sprint de crecimiento con control de cash." : "Preparar empresa antes de gastar.",
      mission: "Subir el negocio de dropshipping hacia $1k/mes sin inventario, usando contenido, aprendizaje y reinversion por etapas.",
      constraint: "No comprar stock, no publicar y no gastar sin approval y Profit Guard.",
      targetOutcome: `${money.format(sprintRevenueTargetUsd)} revenue objetivo del sprint y senal clara para matar, iterar o escalar.`,
    },
    budgetEnvelope: {
      requestedBudgetUsd,
      activeMonthlyBudgetUsd: profitGuard.budgetPolicy.activeMonthlyBudgetUsd,
      approvedToRiskUsd,
      protectedReserveUsd: Number(Math.max(0, profitGuard.budgetPolicy.activeMonthlyBudgetUsd - approvedToRiskUsd).toFixed(2)),
      stage: profitGuard.budgetPolicy.stage,
      spendMode,
      scaleCeilingUsd: largeStageReady ? Number(Math.min(requestedBudgetUsd, profitGuard.budgetPolicy.activeMonthlyBudgetUsd).toFixed(2)) : STARTING_MONTHLY_BUDGET_USD,
      reason: budgetReason,
    },
    unitEconomics: {
      productName: product?.productName || "Producto por definir",
      sellPriceUsd,
      grossProfitPerOrderUsd,
      grossMarginPercent: product?.economics.grossMarginPercent || 40,
      dailyRevenueTargetUsd,
      sprintRevenueTargetUsd,
      monthlyRevenueTargetUsd: TARGET_MONTHLY_REVENUE_USD,
      ordersNeededForSprintTarget: Math.ceil(sprintRevenueTargetUsd / sellPriceUsd),
      ordersNeededForMonthlyTarget: Math.ceil(TARGET_MONTHLY_REVENUE_USD / sellPriceUsd),
      breakEvenOrdersForRequestedBudget,
      breakEvenOrdersForApprovedRisk,
    },
    sprintScoreboard: {
      revenueUsd: totals.totalRevenueUsd,
      profitUsd: totals.profitUsd,
      orders,
      postsReady,
      postsPublished,
      approvalQueue,
      readinessPercent,
    },
    subagentOrders: [
      { owner: "Product Scout", mission: product ? `Defender o reemplazar ${product.productName} con evidencia.` : "Encontrar el primer producto foco.", output: "Shortlist o decision de producto.", deadline: "Day 1", externalActionAllowed: false, approvalGate: "none" },
      { owner: "Supplier Analyst", mission: "Confirmar proveedor principal y backup.", output: "Supplier score + riesgos de shipping/returns.", deadline: "Day 2", externalActionAllowed: false, approvalGate: "contact_supplier" },
      { owner: "Store Builder", mission: "Preparar pagina que pueda convertir sin claims riesgosos.", output: "Shopify draft/preflight + FAQ.", deadline: "Day 2", externalActionAllowed: false, approvalGate: "create_shopify_draft" },
      { owner: "Marketing CMO", mission: "Convertir producto en contenido medible.", output: "Hooks, briefs, calendario y CTA.", deadline: "Day 3", externalActionAllowed: false, approvalGate: "publish_social" },
      { owner: "Ads Strategist", mission: "Preparar solo el primer tramo de paid test.", output: "Budget split + kill-switch.", deadline: "Day 6", externalActionAllowed: false, approvalGate: "spend" },
      { owner: "Learning Analyst", mission: "Decidir kill, iterate o scale con data real.", output: "Scorecard diaria y regla del siguiente sprint.", deadline: "Daily", externalActionAllowed: false, approvalGate: "none" },
      { owner: "Legal + Security", mission: "Bloquear claims, copyright, politica y promesas no verificadas.", output: "Risk check antes de publicar.", deadline: "Before external action", externalActionAllowed: false, approvalGate: "none" },
      { owner: "Order Ops", mission: "Preparar fulfillment por orden pagada, sin inventario.", output: "Checklist de pago, supplier, tracking y soporte.", deadline: "When first order lands", externalActionAllowed: false, approvalGate: "fulfill_order" },
    ],
    campaignCalendar,
    scaleRules: {
      kill: [
        "Pausar producto si no hay clicks/add-to-carts despues de contenido aprobado y medido.",
        "Pausar gasto si refunds, shipping o supplier rompen la promesa.",
        "Pausar ads si el costo por compra supera el margen bruto por orden.",
      ],
      iterate: [
        "Crear 3 hooks nuevos si hay views pero pocos clicks.",
        "Cambiar oferta/landing si hay clicks pero pocos add-to-carts.",
        "Ajustar precio/shipping si hay add-to-carts pero pocas ordenes.",
      ],
      scale: [
        "Escalar solo si hay ordenes pagadas, profit positivo y approval queue limpia.",
        "Subir budget por tramos, maximo el maxSingleTest de Profit Guard por decision.",
        "Mover a campana grande solo en growth_500 o scale_1000.",
      ],
    },
    boardApprovals,
    nextActions,
    boardMemo: `Sprint ${parsed.focus} por ${parsed.days} dias. Stage ${profitGuard.budgetPolicy.stage}, budget activo ${money.format(profitGuard.budgetPolicy.activeMonthlyBudgetUsd)}, requested ${money.format(requestedBudgetUsd)}, riesgo aprobado ${money.format(approvedToRiskUsd)}. ${budgetReason}`,
  };

  growthSprints.unshift(sprint);
  persistGrowthSprints();
  return { growthSprint: sprint, snapshot: getDropshippingCeoSnapshot() };
}

function buildDropshippingCeoOperatingPlan(input: {
  profitGuard: ReturnType<typeof buildProfitGuard>;
  qualifiedProducts: DropshippingProduct[];
  approvalQueue: number;
  socialOrders: number;
  socialRevenueUsd: number;
  latestCampaign: DropshippingMarketingCampaign | undefined;
  latestSocialAnalysis: DropshippingSocialAnalysis | undefined;
}): DropshippingCeoOperatingPlan {
  const bestProduct = pickBestDropshippingProduct();
  const averageOrderValueUsd = input.socialOrders > 0
    ? Number((input.socialRevenueUsd / input.socialOrders).toFixed(2))
    : bestProduct?.targetSellPriceUsd || 25;
  const revenueGapUsd = Number(Math.max(0, TARGET_MONTHLY_REVENUE_USD - input.profitGuard.totalRevenueUsd).toFixed(2));
  const estimatedOrdersNeeded = averageOrderValueUsd > 0 ? Math.ceil(revenueGapUsd / averageOrderValueUsd) : 0;
  const stage =
    input.qualifiedProducts.length === 0
      ? "research" as const
      : input.profitGuard.budgetPolicy.stage === "starter_100"
        ? "validation" as const
        : input.profitGuard.budgetPolicy.stage === "validation_250"
          ? "traction" as const
          : "scale" as const;
  const currentStageGate =
    stage === "research"
      ? "3 productos calificados con margen bruto 45%+ y supplier backup."
      : stage === "validation"
        ? "Primeras 5 ordenes, cash cobrado y al menos 3 hooks medidos."
        : stage === "traction"
          ? "12 ordenes, profit positivo y campana ganadora repetible."
          : "Mantener ROAS/profit, fulfillment estable y soporte preparado antes de subir budget.";
  const largeCampaignReady =
    input.profitGuard.budgetPolicy.stage === "growth_500" || input.profitGuard.budgetPolicy.stage === "scale_1000";
  const largeCampaignBlockedReason =
    input.approvalQueue > 0
      ? "Hay approvals pendientes; el CEO no debe lanzar campanas grandes hasta limpiar cola."
      : input.profitGuard.status === "pause_spend"
        ? "Profit Guard pauso gasto por budget activo."
        : input.profitGuard.status === "collect_first"
          ? "Falta cash cobrado por encima del gasto actual."
          : !largeCampaignReady
            ? "Aun no hay suficientes ventas/profit para campanas grandes."
            : "Lista para proponer campana grande con approval humano.";
  const largeCampaignStatus =
    input.profitGuard.status === "pause_spend"
      ? "blocked" as const
      : largeCampaignReady && input.approvalQueue === 0 && input.profitGuard.canSpendUsd > 0
        ? "ready_after_approval" as const
        : "locked_until_signal" as const;
  const maxRecommendedBudgetUsd = largeCampaignStatus === "ready_after_approval"
    ? Number(Math.min(input.profitGuard.canSpendUsd, input.profitGuard.monthlyBudgetUsd * 0.6).toFixed(2))
    : 0;
  const nextExecutiveDecision =
    input.qualifiedProducts.length === 0
      ? "Ordenar al Product Scout investigar el primer batch de productos virales."
      : input.approvalQueue > 0
        ? "Revisar approvals de producto/posts/gasto antes de cualquier accion externa."
        : input.latestSocialAnalysis?.status === "scale_content"
          ? "Convertir el hook ganador en 3 variaciones y pedir approval para paid test controlado."
          : input.profitGuard.canSpendUsd > 0
            ? "Preparar test pagado pequeno dentro del max test aprobado por Profit Guard."
            : "Publicar/medir contenido organico y cobrar antes de gastar.";

  return {
    mission: "Llegar a $1k/mes validando productos sin inventario propio, reinvirtiendo solo cash cobrado y escalando con approvals.",
    stage,
    revenueGapUsd,
    estimatedOrdersNeeded,
    averageOrderValueUsd: Number(averageOrderValueUsd.toFixed(2)),
    currentStageGate,
    nextExecutiveDecision,
    weeklyOperatingCadence: [
      { owner: "Dropshipping CEO", focus: "Prioridad semanal", output: "1 producto foco, 1 campana activa y 1 decision de escala." },
      { owner: "Product Scout", focus: "Oferta", output: "3 productos nuevos o 3 angles del ganador." },
      { owner: "Social Media Manager", focus: "Contenido", output: "Posts organicos, hooks medidos y variaciones ganadoras." },
      { owner: "Profit Guard", focus: "Cash", output: "Spend cap, budget stage y bloqueo si no hay margen/cash." },
      { owner: "Learning Analyst", focus: "Mejora", output: "Analisis de metricas y reglas para el siguiente batch." },
    ],
    stageRoadmap: [
      {
        stage: "starter_100",
        budgetUsd: 100,
        trigger: "Inicio o sin ventas suficientes.",
        campaignStyle: "Organic-first + micro paid test solo si hay cash y approval.",
        allowedChannels: ["TikTok organico", "Instagram Reels", "Shopify draft", "manual posting"],
        lockedActions: ["ads grandes", "inventario", "claims agresivos", "fulfillment automatico sin review"],
        successMetric: "5 ordenes, profit positivo y 3 hooks medidos.",
      },
      {
        stage: "validation_250",
        budgetUsd: 250,
        trigger: "$250 revenue, $50 profit y 5 ordenes.",
        campaignStyle: "Retestar hook ganador + pequenos paid tests por canal.",
        allowedChannels: ["TikTok", "Instagram", "Facebook small test", "email/manual retarget"],
        lockedActions: ["campanas mayores a max single test", "nuevos proveedores sin backup"],
        successMetric: "12 ordenes, $150 profit y conversion repetible.",
      },
      {
        stage: "growth_500",
        budgetUsd: 500,
        trigger: "$750 revenue, $150 profit y 12 ordenes.",
        campaignStyle: "Campana multicanal con retargeting y creative testing.",
        allowedChannels: ["Meta paid", "TikTok paid/manual", "retarget", "creator outreach manual"],
        lockedActions: ["spend sin ROAS objetivo", "escala sin soporte/returns claros"],
        successMetric: "$1k revenue mensual con profit positivo.",
      },
      {
        stage: "scale_1000",
        budgetUsd: 1000,
        trigger: "$1k revenue, $250 profit y 20 ordenes.",
        campaignStyle: "Campanas grandes por ganador, con presupuesto por cohortes y kill-switch diario.",
        allowedChannels: ["Meta scale", "TikTok scale", "retargeting", "email/SMS cuando exista lista"],
        lockedActions: ["subir spend si refunds o soporte se rompen", "comprar inventario mayorista"],
        successMetric: "Mantener profit, ROAS y cumplimiento estable antes de subir mas.",
      },
    ],
    campaignPortfolio: [
      {
        id: "organic-proof",
        name: "Organic proof batch",
        status: input.qualifiedProducts.length ? "active_now" : "blocked",
        spendCapUsd: 0,
        objective: "Probar hooks y demanda sin gastar.",
        channels: ["TikTok", "Instagram Reels", "YouTube Shorts"],
        approvalGate: "Approval para publicar posts.",
        learningGoal: "Views, clicks, add-to-carts, ordenes y objeciones.",
      },
      {
        id: "micro-paid-test",
        name: "Micro paid test",
        status: input.profitGuard.canSpendUsd > 0 && input.approvalQueue === 0 ? "ready_after_approval" : "locked_until_signal",
        spendCapUsd: input.profitGuard.canSpendUsd,
        objective: "Comprar senal pequena sin romper budget.",
        channels: ["Facebook Ads", "TikTok Ads/manual boost"],
        approvalGate: "Approval de gasto y Profit Guard dentro del max test.",
        learningGoal: "Costo por click, costo por add-to-cart y primeras compras.",
      },
      {
        id: "winner-scale",
        name: "Winner scale campaign",
        status: largeCampaignStatus,
        spendCapUsd: maxRecommendedBudgetUsd,
        objective: "Escalar el hook/producto ganador a campana mas grande.",
        channels: ["Meta scale", "TikTok scale", "retargeting"],
        approvalGate: "Approval humano + stage growth_500 o scale_1000.",
        learningGoal: "ROAS, profit diario, refunds y capacidad de fulfillment.",
      },
      {
        id: "trust-retarget",
        name: "Trust and retargeting pack",
        status: input.latestCampaign ? "ready_after_approval" : "locked_until_signal",
        spendCapUsd: Math.min(input.profitGuard.canSpendUsd, 20),
        objective: "Recuperar visitantes con shipping/returns/precio claro.",
        channels: ["Facebook retargeting", "email", "Shopify SEO"],
        approvalGate: "Approval para copy y gasto si aplica.",
        learningGoal: "Conversion de objeciones: shipping, confianza y precio.",
      },
    ],
    largeCampaignReadiness: {
      status: largeCampaignStatus,
      maxRecommendedBudgetUsd,
      reason: largeCampaignBlockedReason,
      requiredSignals: [
        "cash cobrado mayor que gasto",
        "approval queue limpia",
        "producto ganador con ordenes reales",
        "profit positivo y refunds controlados",
        "supplier/returns/shipping verificables",
      ],
    },
    boardRisks: [
      input.approvalQueue > 0 ? "Approvals pendientes pueden frenar ejecucion." : "Mantener approvals antes de acciones externas.",
      input.profitGuard.status === "collect_first" ? "Todavia no hay cash libre para paid ads." : "No gastar mas que lo cobrado.",
      "Evitar claims no verificados, marcas/copyright y promesas exactas de envio.",
      "No comprar stock; fulfillment solo por orden pagada y proveedor validado.",
    ],
  };
}

function buildDropshippingMarketingDepartment(input: {
  profitGuard: ReturnType<typeof buildProfitGuard>;
  ceoOperatingPlan: DropshippingCeoOperatingPlan;
  qualifiedProducts: DropshippingProduct[];
  latestCampaign: DropshippingMarketingCampaign | undefined;
  latestSocialAnalysis: DropshippingSocialAnalysis | undefined;
  socialRevenueUsd: number;
  socialSpendUsd: number;
  socialOrders: number;
}): DropshippingMarketingDepartment {
  const bestProduct = pickBestDropshippingProduct();
  const draftOrApprovalPosts = socialPosts.filter((post) => post.status === "draft" || post.status === "approval_required").length;
  const queuedPosts = socialPosts.filter((post) => post.status === "queued").length;
  const publishedPosts = socialPosts.filter((post) => post.status === "published").length;
  const nextPosts = socialPosts.length
    ? socialPosts.slice(0, 3).map((post) => `${platformLabel(post.platform)}: ${post.hook}`)
    : [
        "TikTok: problema visible en los primeros 2 segundos",
        "Instagram Reel: beneficio antes/despues",
        "YouTube Shorts: objecion de shipping/precio",
      ];
  const approvalLocked = draftOrApprovalPosts > 0;
  const adsReady = input.profitGuard.canSpendUsd > 0 && input.ceoOperatingPlan.largeCampaignReadiness.status !== "blocked";
  const bestHook = input.latestSocialAnalysis?.winningHook || input.latestCampaign?.primaryHook || "";
  const nextAction =
    input.qualifiedProducts.length === 0
      ? "Pedir al CEO un producto foco antes de producir contenido."
      : approvalLocked
        ? "Preparar approval para publicar posts y mantener todo en draft."
        : input.latestSocialAnalysis?.status === "scale_content"
          ? "Crear variaciones del hook ganador y pedir approval para micro paid test."
          : "Crear batch organico y medir views/clicks/orders antes de gastar.";

  return {
    cmoAgent: {
      id: "marketing-cmo",
      name: "Marketing Director / CMO",
      role: "Dirige contenido, calendario, paid tests, analytics y brand safety para subir ventas.",
      status: "active",
      reportsTo: "Dropshipping CEO",
      mandate: "Convertir productos validados en contenido, demanda, aprendizaje y ventas sin gastar ni publicar sin approval.",
    },
    subagents: [
      {
        id: "content-strategist",
        name: "Content Strategist",
        role: "Decide angulos, pilares y calendario de contenido.",
        status: "active",
        currentFocus: bestProduct ? `Angulos para ${bestProduct.productName}` : "Esperando producto foco del CEO.",
        autonomousOutputs: ["calendario organico", "pilares de contenido", "ideas de batches"],
        approvalGates: ["publicar posts", "usar claims sensibles"],
      },
      {
        id: "hook-copywriter",
        name: "Hook & Copywriter",
        role: "Escribe hooks, captions, CTAs y variaciones por canal.",
        status: "active",
        currentFocus: bestHook || "Crear hooks de problema visible, prueba social y objecion.",
        autonomousOutputs: ["hooks", "captions", "CTAs", "variaciones A/B"],
        approvalGates: ["copy externo", "promesas de envio o resultados"],
      },
      {
        id: "creative-producer",
        name: "Creative Producer",
        role: "Define brief visual para videos, imagenes, UGC y assets.",
        status: "draft_only",
        currentFocus: "Crear briefs visuales que puedan grabarse o producirse despues.",
        autonomousOutputs: ["asset briefs", "shot lists", "creative angles"],
        approvalGates: ["usar assets externos", "publicar creativos"],
      },
      {
        id: "social-scheduler",
        name: "Social Scheduler",
        role: "Organiza cola, frecuencia, canales y estado de aprobacion.",
        status: approvalLocked ? "approval_locked" : "active",
        currentFocus: `${draftOrApprovalPosts} posts esperando approval, ${queuedPosts} en cola.`,
        autonomousOutputs: ["cola interna", "calendario", "prioridad por canal"],
        approvalGates: ["publicar en redes", "programar externo"],
      },
      {
        id: "ads-strategist",
        name: "Ads Strategist",
        role: "Prepara micro tests y campanas grandes cuando Profit Guard lo permite.",
        status: adsReady ? "needs_signal" : "approval_locked",
        currentFocus: adsReady ? `Preparar test max ${money.format(input.profitGuard.canSpendUsd)}.` : "Esperar cash, signals y approval antes de paid ads.",
        autonomousOutputs: ["paid test plan", "kill-switch", "budget split"],
        approvalGates: ["gastar dinero", "activar ads", "subir presupuesto"],
      },
      {
        id: "analytics-analyst",
        name: "Analytics Analyst",
        role: "Lee metricas, detecta ganadores y recomienda matar/repetir.",
        status: socialMetrics.length ? "active" : "needs_signal",
        currentFocus: input.latestSocialAnalysis?.summary || "Esperando views/clicks/orders reales.",
        autonomousOutputs: ["performance readout", "winner/loser calls", "next test rules"],
        approvalGates: ["escalar presupuesto basado en analisis"],
      },
      {
        id: "brand-legal-safety",
        name: "Brand / Legal Safety",
        role: "Bloquea claims, copyright, politicas de plataforma y promesas riesgosas.",
        status: "active",
        currentFocus: "Revisar que todo copy sea honesto con precio, shipping y proveedor.",
        autonomousOutputs: ["risk checks", "policy notes", "copy fixes"],
        approvalGates: ["claims sensibles", "marcas o contenido de terceros"],
      },
      {
        id: "community-agent",
        name: "Community Agent",
        role: "Propone respuestas, FAQs, objeciones y engagement.",
        status: publishedPosts > 0 ? "active" : "draft_only",
        currentFocus: publishedPosts > 0 ? "Preparar respuestas para comentarios y objeciones." : "Crear FAQ base antes de publicar.",
        autonomousOutputs: ["reply drafts", "FAQ", "comment playbook"],
        approvalGates: ["responder publicamente", "contactar clientes"],
      },
    ],
    operatingModel: {
      mission: "Crear demanda diaria para productos validados y convertir datos de marketing en decisiones de escala.",
      canRunAutonomously: [
        "crear ideas, hooks, captions y briefs",
        "armar calendario y cola interna",
        "analizar metricas y recomendar proximos tests",
        "preparar campanas grandes como plan",
      ],
      requiresApproval: [
        "publicar en redes",
        "gastar en ads",
        "usar assets externos o marcas",
        "responder publicamente a clientes/proveedores",
      ],
      dailyWorkflow: [
        "AM: leer plan CEO, elegir producto/campana foco y crear batch organico.",
        "Midday: revisar approvals, comentarios y readiness de assets.",
        "PM: registrar metricas, detectar hooks ganadores y actualizar reglas del proximo batch.",
      ],
    },
    workstreams: [
      {
        id: "content-calendar",
        name: "Content calendar",
        status: input.qualifiedProducts.length ? "active" : "blocked",
        owner: "Content Strategist",
        output: "Posts organicos por canal y calendario interno.",
        nextMove: input.qualifiedProducts.length ? "Crear o mantener batch diario TikTok/Instagram." : "Esperar producto calificado.",
      },
      {
        id: "creative-production",
        name: "Creative production",
        status: "active",
        owner: "Creative Producer",
        output: "Briefs de videos, UGC, imagenes y pruebas visuales.",
        nextMove: "Transformar hooks ganadores en shot lists y assets.",
      },
      {
        id: "publishing-queue",
        name: "Publishing queue",
        status: approvalLocked ? "approval_locked" : "active",
        owner: "Social Scheduler",
        output: "Posts listos, en cola o bloqueados por approval.",
        nextMove: approvalLocked ? "Enviar approval de publish_social." : "Mantener cola y evitar duplicados.",
      },
      {
        id: "paid-growth",
        name: "Paid growth",
        status: adsReady ? "needs_data" : "approval_locked",
        owner: "Ads Strategist",
        output: "Micro paid tests y campanas grandes por etapa.",
        nextMove: adsReady ? "Preparar plan de test con kill-switch." : "Esperar cash/senales.",
      },
      {
        id: "analytics-learning",
        name: "Analytics learning",
        status: socialMetrics.length ? "active" : "needs_data",
        owner: "Analytics Analyst",
        output: "Ganadores, perdedores y reglas del siguiente batch.",
        nextMove: socialMetrics.length ? "Actualizar analysis diario." : "Registrar views/clicks/orders.",
      },
      {
        id: "brand-safety",
        name: "Brand safety",
        status: "active",
        owner: "Brand / Legal Safety",
        output: "Checklist legal/plataforma para cada campana.",
        nextMove: "Bloquear claims no verificados y copyright.",
      },
    ],
    activeBrief: {
      objective: input.ceoOperatingPlan.nextExecutiveDecision,
      productFocus: bestProduct?.productName || "sin producto foco",
      primaryAudience: input.latestCampaign?.targetAudience || "compradores de soluciones simples vistas en redes sociales",
      nextCampaign: input.latestCampaign?.campaignName || "organic proof batch",
      nextPosts,
      blockedUntil: [
        approvalLocked && "Robert apruebe posts pendientes",
        input.profitGuard.canSpendUsd <= 0 && "haya cash libre para paid ads",
        input.qualifiedProducts.length === 0 && "exista producto calificado",
      ].filter(Boolean) as string[],
    },
    scorecard: {
      campaigns: marketingCampaigns.length,
      draftOrApprovalPosts,
      queuedPosts,
      publishedPosts,
      revenueUsd: input.socialRevenueUsd,
      spendUsd: input.socialSpendUsd,
      orders: input.socialOrders,
      bestHook: bestHook || "sin hook ganador todavia",
      nextAction,
    },
    handoffToCeo: {
      requests: [
        approvalLocked ? `Aprobar ${draftOrApprovalPosts} posts antes de publicar.` : "Sin approvals de posts pendientes.",
        adsReady ? `Revisar si se aprueba paid test hasta ${money.format(input.profitGuard.canSpendUsd)}.` : "No pedir paid ads hasta tener cash/senal.",
      ],
      risks: [
        "No publicar claims no verificados.",
        "No gastar sin Profit Guard y approval.",
        "No duplicar contenido diario sin medir resultados.",
      ],
      decisionsNeeded: [
        input.ceoOperatingPlan.nextExecutiveDecision,
        input.ceoOperatingPlan.largeCampaignReadiness.reason,
      ],
    },
  };
}

function buildDropshippingCeoGrowthBoard(input: {
  profitGuard: ReturnType<typeof buildProfitGuard>;
  ceoOperatingPlan: DropshippingCeoOperatingPlan;
  qualifiedProducts: DropshippingProduct[];
  latestCampaign?: DropshippingMarketingCampaign;
  latestSocialAnalysis?: DropshippingSocialAnalysis;
  socialRevenueUsd: number;
  socialSpendUsd: number;
  socialOrders: number;
  approvalQueue: number;
}): DropshippingCeoGrowthBoard {
  const product = input.qualifiedProducts[0] || null;
  const stage = input.ceoOperatingPlan.stage;
  const activeBudgetUsd = input.profitGuard.budgetPolicy.activeMonthlyBudgetUsd;
  const canRiskNowUsd = Number(Math.min(input.profitGuard.canSpendUsd, input.profitGuard.budgetPolicy.maxSingleTestUsd).toFixed(2));
  const protectedReserveUsd = Number(Math.max(0, activeBudgetUsd - canRiskNowUsd).toFixed(2));
  const largeCampaignReady = input.ceoOperatingPlan.largeCampaignReadiness.status === "ready_after_approval";
  const hasAnyRevenue = input.profitGuard.totalRevenueUsd > 0 || input.socialRevenueUsd > 0;
  const status: DropshippingCeoGrowthBoard["status"] =
    !product
      ? "research_board"
      : input.approvalQueue > 0
        ? "approval_locked"
        : input.profitGuard.status === "collect_first" && !hasAnyRevenue
          ? "cash_locked"
          : largeCampaignReady
            ? "scale_ready"
            : input.ceoOperatingPlan.largeCampaignReadiness.status === "locked_until_signal"
              ? "scale_locked"
              : "validation_board";
  const decision =
    status === "research_board"
      ? "Orden CEO: correr Product Scout, elegir 1 producto foco y no gastar nada."
      : status === "approval_locked"
        ? "Orden CEO: limpiar approvals antes de publicar, contactar, crear draft o gastar."
        : status === "cash_locked"
          ? "Orden CEO: generar prueba organica y cobrar primero; paid ads siguen bloqueados."
          : status === "scale_ready"
            ? "Orden CEO: preparar campana grande por tramos, con approval y kill-switch diario."
            : status === "scale_locked"
              ? "Orden CEO: validar mas senales antes de pedir campanas grandes."
              : "Orden CEO: ejecutar validacion controlada y medir cada canal.";
  const targetOrders =
    input.profitGuard.budgetPolicy.stage === "starter_100"
      ? 5
      : input.profitGuard.budgetPolicy.stage === "validation_250"
        ? 12
        : input.profitGuard.budgetPolicy.stage === "growth_500"
          ? 20
          : 30;
  const socialPostsReady = socialPosts.filter((post) => ["draft", "queued", "approval_required", "published"].includes(post.status)).length;
  const roas = input.socialSpendUsd > 0 ? Number((input.socialRevenueUsd / input.socialSpendUsd).toFixed(2)) : null;
  const scaleStatus: DropshippingCeoGrowthBoard["campaignScaleLadder"][number]["status"] =
    input.approvalQueue > 0 ? "locked" : largeCampaignReady ? "ready_after_approval" : "locked";
  const microTestStatus: DropshippingCeoGrowthBoard["campaignScaleLadder"][number]["status"] =
    !product ? "blocked" : input.approvalQueue > 0 ? "locked" : canRiskNowUsd > 0 ? "ready_after_approval" : "locked";
  const retargetingStatus: DropshippingCeoGrowthBoard["campaignScaleLadder"][number]["status"] =
    input.socialOrders > 0 && canRiskNowUsd > 0 && input.approvalQueue === 0 ? "ready_after_approval" : "locked";
  const blockedUntil = [
    !product && "producto foco validado",
    input.approvalQueue > 0 && "approval queue limpia",
    input.profitGuard.canSpendUsd <= 0 && "cash cobrado mayor que gasto",
    !largeCampaignReady && "senales para growth_500 o scale_1000 antes de campana grande",
    input.socialOrders <= 0 && "ordenes o add-to-carts atribuibles a marketing",
  ].filter(Boolean) as string[];
  const approvalRequests: DropshippingCeoGrowthBoard["approvalRequests"] = [];

  if (product) {
    approvalRequests.push({
      actionType: "dropshipping.publish_product",
      title: `Aprobar producto foco: ${product.productName}`,
      reason: "Permite preparar oferta publica, copy y launch pack; no gasta dinero.",
      maxSpendUsd: 0,
    });
    approvalRequests.push({
      actionType: "dropshipping.create_shopify_draft",
      title: "Aprobar draft de Shopify",
      reason: "Crear producto como draft/preflight antes de cualquier publicacion.",
      maxSpendUsd: 0,
    });
    approvalRequests.push({
      actionType: "dropshipping.publish_social",
      title: "Aprobar batch de posts organicos",
      reason: "Publicacion externa siempre requiere aprobacion aunque el budget sea cero.",
      maxSpendUsd: 0,
    });
    if (product.requiresSample) {
      approvalRequests.push({
        actionType: "dropshipping.order_sample",
        title: "Aprobar sample de 1 unidad",
        reason: "Validar calidad antes de escalar; no comprar inventario.",
        maxSpendUsd: product.economics.landedCostUsd,
      });
    }
  }

  if (canRiskNowUsd > 0) {
    approvalRequests.push({
      actionType: "dropshipping.spend",
      title: `Aprobar primer tramo de ads: ${money.format(canRiskNowUsd)}`,
      reason: "Solo se libera el tramo permitido por Profit Guard, no el envelope completo.",
      maxSpendUsd: canRiskNowUsd,
    });
  }

  return {
    status,
    headline:
      status === "scale_ready"
        ? "Board CEO listo para escalar por tramos."
        : status === "approval_locked"
          ? "Board CEO bloqueado por approvals pendientes."
          : status === "research_board"
            ? "Board CEO en investigacion de producto."
            : "Board CEO en validacion controlada.",
    stage,
    decision,
    sourceIntelligence: [
      {
        source: "Shopify 2026 product demand",
        url: "https://www.shopify.com/blog/best-dropshipping-products",
        signal: "Categorias con demanda: kitchen, pet, home, phone y car accessories.",
        ceoAction: "Priorizar problem solvers ligeros, baratos y demostrables en video.",
      },
      {
        source: "Shopify dropshipping/direct fulfillment",
        url: "https://www.shopify.com/blog/best-dropshipping-products",
        signal: "Sourcing y fulfillment pueden operar sin inventario propio.",
        ceoAction: "No comprar stock; solo sample aprobado si el riesgo de calidad lo exige.",
      },
      {
        source: "TikTok Creative Center",
        url: "https://ads.tiktok.com/business/creativecenter/",
        signal: "Top ads favorecen beneficios obvios, antes/despues, curiosidad y creatividad fresca.",
        ceoAction: "Forzar hooks visuales y rotacion de creativos antes de subir budget.",
      },
      {
        source: "Shopify social media pillars",
        url: "https://www.shopify.com/blog/social-media-marketing",
        signal: "Social requiere strategy, publishing, community, advertising y analytics.",
        ceoAction: "CMO opera posts, comunidad y analytics; ads solo tras senales y approval.",
      },
    ],
    kpiScorecard: [
      {
        id: "monthly-revenue",
        label: "Revenue hacia $1k/mes",
        current: money.format(input.profitGuard.totalRevenueUsd),
        target: money.format(TARGET_MONTHLY_REVENUE_USD),
        status: input.profitGuard.totalRevenueUsd >= TARGET_MONTHLY_REVENUE_USD ? "on_track" : input.profitGuard.totalRevenueUsd > 0 ? "watch" : "critical",
        owner: "Dropshipping CEO",
      },
      {
        id: "cash-discipline",
        label: "Cash > gasto",
        current: `${money.format(input.profitGuard.cashCollectedUsd)} cash / ${money.format(input.profitGuard.totalSpendUsd)} spend`,
        target: "cash cobrado mayor que gasto antes de paid ads",
        status: input.profitGuard.cashCollectedUsd > input.profitGuard.totalSpendUsd ? "on_track" : input.profitGuard.totalSpendUsd === 0 ? "watch" : "critical",
        owner: "Profit Guard",
      },
      {
        id: "order-signal",
        label: "Ordenes reales",
        current: String(input.profitGuard.budgetPolicy.orderSignal),
        target: `${targetOrders}+ para subir etapa`,
        status: input.profitGuard.budgetPolicy.orderSignal >= targetOrders ? "on_track" : input.profitGuard.budgetPolicy.orderSignal > 0 ? "watch" : "critical",
        owner: "Learning Analyst",
      },
      {
        id: "creative-throughput",
        label: "Posts listos/publicados",
        current: String(socialPostsReady),
        target: "14+ assets por semana antes de escalar",
        status: socialPostsReady >= 14 ? "on_track" : socialPostsReady > 0 ? "watch" : "critical",
        owner: "Marketing CMO",
      },
      {
        id: "approval-queue",
        label: "Approvals pendientes",
        current: String(input.approvalQueue),
        target: "0 antes de gastar/publicar",
        status: input.approvalQueue === 0 ? "on_track" : "locked",
        owner: "Control",
      },
      {
        id: "paid-efficiency",
        label: "Paid ROAS",
        current: roas === null ? "sin gasto pagado" : `${roas}x`,
        target: ">= 2.0x o pausar",
        status: roas === null ? "watch" : roas >= 2 ? "on_track" : "critical",
        owner: "Ads Strategist",
      },
    ],
    capitalDoctrine: {
      startingBudgetUsd: STARTING_MONTHLY_BUDGET_USD,
      activeMonthlyBudgetUsd: activeBudgetUsd,
      canRiskNowUsd,
      protectedReserveUsd,
      reinvestmentRule: "Reinvertir por tramos solo desde cash cobrado, profit positivo y senales repetibles.",
      paidSpendRule: "Nunca gastar el envelope completo; usar micro tests con kill-switch y approval.",
      sampleRule: "Sample max 1 unidad cuando calidad/claims lo exijan; inventario mayorista bloqueado.",
    },
    campaignScaleLadder: [
      {
        stage: "organic_proof",
        name: "Organic proof engine",
        budgetUsd: 0,
        channelMix: ["TikTok", "Instagram Reels", "YouTube Shorts", "Pinterest"],
        entryCriteria: ["producto foco", "hook visual", "supplier razonable"],
        exitCriteria: ["clicks/add-to-carts", "orden o comentarios de compra", "objeciones documentadas"],
        approvalGate: "publish_social",
        status: product ? "active" : "blocked",
      },
      {
        stage: "micro_test",
        name: "Micro paid test",
        budgetUsd: canRiskNowUsd,
        channelMix: ["TikTok Ads", "Meta Reels"],
        entryCriteria: ["cash libre", "approval queue limpia", "hook organico ganador"],
        exitCriteria: ["add-to-cart o venta antes de 50% del tramo", "CPC/CPA dentro del margen"],
        approvalGate: "dropshipping.spend",
        status: microTestStatus,
      },
      {
        stage: "retargeting",
        name: "Retargeting trust pack",
        budgetUsd: retargetingStatus === "ready_after_approval" ? Number(Math.min(50, canRiskNowUsd).toFixed(2)) : 0,
        channelMix: ["Meta retargeting", "Email", "Shopify abandoned cart"],
        entryCriteria: ["visitas/clicks", "shipping/returns claros", "pixel o conversion tracking"],
        exitCriteria: ["conversion rate mejora", "AOV y refunds sanos"],
        approvalGate: "dropshipping.spend",
        status: retargetingStatus,
      },
      {
        stage: "winner_scale",
        name: "Winner scale campaign",
        budgetUsd: largeCampaignReady ? input.ceoOperatingPlan.largeCampaignReadiness.maxRecommendedBudgetUsd : 0,
        channelMix: ["Meta", "TikTok", "creator/UGC", "retargeting"],
        entryCriteria: ["growth_500 o scale_1000", "12+ ordenes", "profit positivo", "fulfillment listo"],
        exitCriteria: ["ROAS >= 2x", "refund/support bajo control", "supplier backup"],
        approvalGate: "human approval + Profit Guard",
        status: scaleStatus,
      },
    ],
    boardVotes: [
      {
        agent: "Product Scout",
        vote: product ? "go" : "hold",
        reason: product ? `${product.productName} puede ser defendido con margen y contenido.` : "Falta producto foco.",
        requiredProof: "margen 45%+, shipping aceptable, bajo riesgo legal/calidad",
      },
      {
        agent: "Marketing CMO",
        vote: socialPostsReady > 0 ? "go" : "hold",
        reason: socialPostsReady > 0 ? "Hay activos o drafts para medir." : "Falta batch de contenido.",
        requiredProof: "hooks por plataforma, calendario, metricas de views/clicks/orders",
      },
      {
        agent: "Profit Guard",
        vote: canRiskNowUsd > 0 ? "go" : "hold",
        reason: canRiskNowUsd > 0 ? `Puede proponer ${money.format(canRiskNowUsd)}.` : "No hay cash libre para ads.",
        requiredProof: "cash cobrado > gasto, approval queue cero, budget activo respetado",
      },
      {
        agent: "Legal + Security",
        vote: product?.legalRisk === "high" ? "block" : "go",
        reason: product?.legalRisk === "high" ? "Claims/riesgo legal alto." : "Mantener copy honesto y politicas claras.",
        requiredProof: "sin marcas ajenas, claims medibles, shipping/returns visibles",
      },
      {
        agent: "Order Ops",
        vote: orderRecords.some((order) => order.status === "approval_required") ? "hold" : "go",
        reason: orderRecords.some((order) => order.status === "approval_required") ? "Hay fulfillment pendiente." : "No hay fulfillment bloqueando.",
        requiredProof: "supplier, tracking, customer promise y backup antes de escalar",
      },
    ],
    thirtyDayPlan: [
      {
        week: 1,
        objective: "Producto foco + launch pack organico",
        owner: "Dropshipping CEO",
        output: "1 producto aprobado, draft Shopify y 6-10 posts",
        budgetUsd: 0,
        approvalGate: "publish_product/create_shopify_draft/publish_social",
      },
      {
        week: 2,
        objective: "Validacion de demanda",
        owner: "Marketing CMO",
        output: "medir hooks, clicks, add-to-carts, preguntas y primeras ventas",
        budgetUsd: 0,
        approvalGate: "publish_social",
      },
      {
        week: 3,
        objective: "Micro paid test si hay cash",
        owner: "Ads Strategist",
        output: "primer tramo con kill-switch y reporte diario",
        budgetUsd: canRiskNowUsd,
        approvalGate: "dropshipping.spend",
      },
      {
        week: 4,
        objective: "Decision de escala",
        owner: "Board CEO",
        output: "matar, iterar o preparar campaign envelope mayor",
        budgetUsd: largeCampaignReady ? input.ceoOperatingPlan.largeCampaignReadiness.maxRecommendedBudgetUsd : 0,
        approvalGate: "human approval + Profit Guard",
      },
    ],
    nextOperatingOrders: [
      {
        owner: "Product Scout",
        order: product ? "Defender el producto foco contra 2 alternativas." : "Crear shortlist de 4 candidatos sin gastar.",
        due: "today",
        externalActionAllowed: false,
      },
      {
        owner: "Marketing CMO",
        order: input.latestCampaign ? "Convertir el hook activo en 6 variaciones por canal." : "Crear campana organica base para el producto foco.",
        due: "today",
        externalActionAllowed: false,
      },
      {
        owner: "Profit Guard",
        order: "Actualizar canRiskNow, protected reserve y kill-switch antes de cualquier ad.",
        due: "daily close",
        externalActionAllowed: false,
      },
      {
        owner: "Learning Analyst",
        order: input.latestSocialAnalysis ? "Usar el analisis mas reciente para decidir iterate/scale." : "Esperar metricas reales y generar primer scorecard.",
        due: "after metrics",
        externalActionAllowed: false,
      },
    ],
    blockedUntil,
    approvalRequests,
  };
}

function approvalQueueCount(
  productList: DropshippingProduct[],
  planList: DropshippingLaunchPlan[],
  campaignList: DropshippingMarketingCampaign[] = [],
  socialPostList: DropshippingSocialPost[] = [],
  orderList: DropshippingOrder[] = [],
  fulfillmentList: DropshippingFulfillmentAction[] = [],
) {
  return productList.filter((product) => product.status === "approval_required" || product.status === "sample_recommended").length +
    planList.filter((plan) => plan.status === "approval_required").length +
    campaignList.filter((campaign) => campaign.status === "approval_required").length +
    socialPostList.filter((post) => post.status === "approval_required").length +
    orderList.filter((order) => order.status === "approval_required").length +
    fulfillmentList.filter((action) => action.status === "approval_required").length;
}

export function buildDropshippingCapitalPlan(input: Partial<DropshippingCapitalPlanInput> = {}) {
  loadAll();
  const parsed = dropshippingCapitalPlanSchema.parse(input);
  const approvalQueue = approvalQueueCount(products, launchPlans, marketingCampaigns, socialPosts, orderRecords, fulfillmentActions);
  const profitGuard = buildProfitGuard(ledger, approvalQueue, socialMetrics);
  const campaign = marketingCampaigns.find((item) => item.id === parsed.campaignId) || marketingCampaigns[0] || null;
  const product = campaign?.product || pickBestDropshippingProduct();
  const totals = summarizeLedger(ledger);
  const orderSignal = profitGuard.budgetPolicy.orderSignal;
  const largeStageReady = profitGuard.budgetPolicy.stage === "growth_500" || profitGuard.budgetPolicy.stage === "scale_1000";
  const requestedCampaignEnvelopeUsd = Number(Math.min(parsed.requestedBudgetUsd, 10000).toFixed(2));
  const exceedsActiveBudget = requestedCampaignEnvelopeUsd > profitGuard.monthlyBudgetUsd;
  const missingSignals = [
    !product && "producto foco calificado",
    approvalQueue > 0 && "approval queue limpia",
    profitGuard.canSpendUsd <= 0 && "cash libre por encima del gasto actual",
    exceedsActiveBudget && `requested budget dentro del budget activo ${money.format(profitGuard.monthlyBudgetUsd)}`,
    parsed.objective === "scale_winner" && !largeStageReady && "stage growth_500 o scale_1000 antes de campana grande",
  ].filter(Boolean) as string[];
  const hardBlocked = !product || profitGuard.status === "pause_spend" || exceedsActiveBudget;
  const stageGate = {
    status: hardBlocked ? "blocked" as const : missingSignals.length ? "locked" as const : "pass" as const,
    reason: hardBlocked
      ? "Capital bloqueado: falta producto valido, budget activo o Profit Guard pauso gasto."
      : missingSignals.length
        ? `Capital locked: falta ${missingSignals.join(", ")}.`
        : "Capital listo para proponer primer tramo con approval humano.",
    requiredSignals: missingSignals.length ? missingSignals : [
      "mantener cash cobrado mayor que gasto",
      "medir ROAS/profit diario",
      "cerrar fulfillment y soporte antes de subir presupuesto",
    ],
  };
  const status =
    stageGate.status === "blocked"
      ? "blocked" as const
      : stageGate.status === "locked"
        ? "locked_until_signal" as const
        : parsed.approvalToPrepareLargeCampaign
          ? "ready_after_approval" as const
          : "draft" as const;
  const approvedInitialBudgetUsd = status === "ready_after_approval"
    ? Number(Math.min(requestedCampaignEnvelopeUsd, profitGuard.canSpendUsd, profitGuard.budgetPolicy.maxSingleTestUsd).toFixed(2))
    : 0;
  const retargetBudgetUsd = approvedInitialBudgetUsd > 40 ? Number(Math.min(25, approvedInitialBudgetUsd * 0.2).toFixed(2)) : 0;
  const scaleBudgetUsd = largeStageReady && parsed.objective === "scale_winner"
    ? Number(Math.max(0, approvedInitialBudgetUsd - retargetBudgetUsd - Math.min(approvedInitialBudgetUsd * 0.55, profitGuard.budgetPolicy.maxSingleTestUsd)).toFixed(2))
    : 0;
  const testBudgetUsd = Number(Math.max(0, approvedInitialBudgetUsd - retargetBudgetUsd - scaleBudgetUsd).toFixed(2));
  const allocation: DropshippingCapitalPlan["allocation"] = [
    {
      channel: "Organic content",
      purpose: "Seguir generando demanda sin gastar mientras se valida hook/oferta.",
      budgetUsd: 0,
      stage: "organic",
      approvalRequired: false,
      killSwitch: "Pausar angulo si 3 posts seguidos no generan clicks ni add-to-carts.",
    },
    {
      channel: largeStageReady ? "Meta/TikTok test" : "TikTok/Instagram micro test",
      purpose: "Comprar senal pequena del hook ganador sin romper el budget.",
      budgetUsd: testBudgetUsd,
      stage: "test",
      approvalRequired: true,
      killSwitch: "Pausar si no hay add-to-cart o venta despues de gastar 50% del tramo inicial.",
    },
    {
      channel: "Retargeting trust pack",
      purpose: "Recuperar visitantes con shipping, returns, prueba social y precio claro.",
      budgetUsd: retargetBudgetUsd,
      stage: "retarget",
      approvalRequired: true,
      killSwitch: "Pausar si CPC sube y no mejora conversion de checkout.",
    },
    {
      channel: "Winner scale reserve",
      purpose: "Reservar solo para el ganador probado; no se ejecuta sin nueva decision del CEO.",
      budgetUsd: scaleBudgetUsd,
      stage: "scale",
      approvalRequired: true,
      killSwitch: "No liberar si profit diario, refunds, soporte o fulfillment se deterioran.",
    },
  ];
  const approvalsRequired = [
    approvedInitialBudgetUsd > 0 && `aprobar primer tramo de ${money.format(approvedInitialBudgetUsd)}`,
    requestedCampaignEnvelopeUsd > STARTING_MONTHLY_BUDGET_USD && `aprobar envelope de campana ${money.format(requestedCampaignEnvelopeUsd)}`,
    "confirmar producto, supplier, shipping/returns y copy antes de activar ads",
  ].filter(Boolean) as string[];
  const nextActions =
    status === "ready_after_approval"
      ? [
          "crear/adaptar campana ganadora con este split",
          "preparar pending approval de spend antes de activar ads",
          "medir metricas cada dia y matar rapido si no hay senal",
        ]
      : status === "draft"
        ? ["enviar plan a Robert para approval", "mantener gasto en cero hasta approval", "seguir contenido organico"]
        : ["resolver senales faltantes", "mantener budget protegido", "no activar campanas pagas"];
  const plan: DropshippingCapitalPlan = {
    ...parsed,
    id: `drop-capital-${Date.now()}-${capitalPlans.length + 1}`,
    createdAt: new Date().toISOString(),
    status,
    campaign,
    product,
    activeStage: profitGuard.budgetPolicy.stage,
    requestedCampaignEnvelopeUsd,
    approvedInitialBudgetUsd,
    maxSingleTestUsd: profitGuard.budgetPolicy.maxSingleTestUsd,
    canSpendUsd: profitGuard.canSpendUsd,
    stageGate,
    allocation,
    metricsSnapshot: {
      revenueUsd: totals.totalRevenueUsd,
      cashCollectedUsd: totals.cashCollectedUsd,
      spendUsd: totals.totalSpendUsd,
      profitUsd: totals.profitUsd,
      orders: orderSignal,
      approvalQueue,
    },
    approvalsRequired,
    nextActions,
    boardMemo: `Envelope ${money.format(requestedCampaignEnvelopeUsd)} en stage ${profitGuard.budgetPolicy.stage}; primer tramo ${money.format(approvedInitialBudgetUsd)}. ${stageGate.reason}`,
  };

  capitalPlans.unshift(plan);
  persistCapitalPlans();
  return { capitalPlan: plan, snapshot: getDropshippingCeoSnapshot() };
}

export function getDropshippingCeoSnapshot() {
  loadAll();
  const approvalQueue = approvalQueueCount(products, launchPlans, marketingCampaigns, socialPosts, orderRecords, fulfillmentActions);
  const profitGuard = buildProfitGuard(ledger, approvalQueue, socialMetrics);
  const qualifiedProducts = products.filter((product) => product.status !== "blocked");
  const scoutReadyCandidates = productScoutCandidates.filter((candidate) => candidate.status === "ready_for_research" || candidate.status === "needs_tiktok_validation").length;
  const launchReadyProducts = products.filter((product) => product.status === "launch_ready" || product.status === "approval_required").length;
  const latestLearning = learningReviews[0];
  const latestCycle = ceoCycles[0];
  const latestCampaign = marketingCampaigns[0];
  const latestCapitalPlan = capitalPlans[0];
  const latestGrowthSprint = growthSprints[0];
  const latestLaunchPack = launchPacks[0];
  const latestAutopilotProductHunterRun = autopilotProductHunterRuns[0];
  const latestSocialAnalysis = socialAnalyses[0];
  const shopifyConfig = getShopifyConfig();
  const socialPublisherConfig = getSocialPublisherConfig();
  const liveSignalReadiness = getDropshippingLiveSignalReadiness();
  const shopifyReady = Boolean(shopifyConfig.shopDomain && shopifyConfig.accessToken);
  const socialPublisherReady = socialPublisherConfig.mode !== "manual";
  const executionSetup = buildDropshippingExecutionSetupCenter();
  const socialRevenueUsd = Number(socialMetrics.reduce((sum, metric) => sum + metric.revenueUsd, 0).toFixed(2));
  const socialSpendUsd = Number(socialMetrics.reduce((sum, metric) => sum + metric.spendUsd, 0).toFixed(2));
  const socialOrders = socialMetrics.reduce((sum, metric) => sum + metric.orders, 0);
  const socialViews = socialMetrics.reduce((sum, metric) => sum + metric.views, 0);
  const paidOrders = orderRecords.filter((order) => order.paymentStatus === "paid");
  const orderRevenueUsd = Number(orderRecords.reduce((sum, order) => sum + order.grossRevenueUsd, 0).toFixed(2));
  const orderProfitUsd = Number(orderRecords.reduce((sum, order) => sum + order.estimatedProfitUsd, 0).toFixed(2));
  const unfulfilledOrders = orderRecords.filter((order) => order.status === "approval_required" || order.status === "ready_for_fulfillment").length;
  const localApprovalOutbox = approvalOutbox.filter((item) => item.status === "pending_local").length;
  const launchReadiness = buildDropshippingLaunchReadinessCenter({
    profitGuard,
    executionSetup,
    localApprovalOutbox,
    unfulfilledOrders,
  });
  const status =
    profitGuard.status === "pause_spend"
      ? "blocked" as const
      : qualifiedProducts.length === 0
        ? "research" as const
        : approvalQueue > 0
          ? "needs_approval" as const
          : "ready" as const;
  const nextCommand = latestCycle?.commands[0] ||
    (status === "research"
      ? "Investigar 3 productos virales con proveedor, margen, shipping y riesgo legal."
      : status === "needs_approval"
        ? "Revisar approval queue antes de publicar, gastar o pedir sample."
        : profitGuard.status === "scale_carefully"
          ? "Preparar contenido organico y mantener gasto dentro de lo cobrado."
          : profitGuard.reason);
  const ceoOperatingPlan = buildDropshippingCeoOperatingPlan({
    profitGuard,
    qualifiedProducts,
    approvalQueue,
    socialOrders,
    socialRevenueUsd,
    latestCampaign,
    latestSocialAnalysis,
  });
  const marketingDepartment = buildDropshippingMarketingDepartment({
    profitGuard,
    ceoOperatingPlan,
    qualifiedProducts,
    latestCampaign,
    latestSocialAnalysis,
    socialRevenueUsd,
    socialSpendUsd,
    socialOrders,
  });
  const growthBoard = buildDropshippingCeoGrowthBoard({
    profitGuard,
    ceoOperatingPlan,
    qualifiedProducts,
    latestCampaign,
    latestSocialAnalysis,
    socialRevenueUsd,
    socialSpendUsd,
    socialOrders,
    approvalQueue,
  });

  return {
    generatedAt: new Date().toISOString(),
    strategy: {
      model: "dropshipping_sin_inventario",
      storeChannel: "Shopify + social organico primero",
      firstNiche: "productos virales",
      startingBudgetUsd: STARTING_MONTHLY_BUDGET_USD,
      targetMonthlyRevenueUsd: TARGET_MONTHLY_REVENUE_USD,
      inventoryPolicy: "No comprar stock. Solo sample de 1 unidad si Robert aprueba y el producto pasa Profit Guard.",
    },
    metrics: {
      productsResearched: products.length,
      productScoutCandidates: productScoutCandidates.length,
      scoutReadyCandidates,
      qualifiedProducts: qualifiedProducts.length,
      launchReadyProducts,
      suppliersReviewed: suppliers.length,
      marketingCampaigns: marketingCampaigns.length,
      ceoCycles: ceoCycles.length,
      shopifyDrafts: shopifyDrafts.length,
      socialPosts: socialPosts.length,
      queuedSocialPosts: socialPosts.filter((post) => post.status === "queued").length,
      publishedSocialPosts: socialPosts.filter((post) => post.status === "published").length,
      socialRevenueUsd,
      socialSpendUsd,
      socialOrders,
      socialConversionRatePercent: socialViews > 0 ? Number(((socialOrders / socialViews) * 100).toFixed(2)) : 0,
      orders: orderRecords.length,
      paidOrders: paidOrders.length,
      unfulfilledOrders,
      fulfillmentActions: fulfillmentActions.length,
      capitalPlans: capitalPlans.length,
      growthSprints: growthSprints.length,
      launchPacks: launchPacks.length,
      autopilotProductHunterRuns: autopilotProductHunterRuns.length,
      localApprovalOutbox,
      orderRevenueUsd,
      orderProfitUsd,
      totalRevenueUsd: profitGuard.totalRevenueUsd,
      cashCollectedUsd: profitGuard.cashCollectedUsd,
      totalSpendUsd: profitGuard.totalSpendUsd,
      profitUsd: profitGuard.profitUsd,
      approvalQueue,
      progressToTargetPercent: Math.min(100, Math.round((profitGuard.totalRevenueUsd / TARGET_MONTHLY_REVENUE_USD) * 100)),
    },
    executiveSummary: {
      status,
      headline:
        status === "blocked"
          ? "Dropshipping CEO en modo proteccion: no gastar hasta corregir presupuesto/cash."
          : status === "research"
            ? "Listo para investigar productos virales sin comprar inventario."
            : status === "needs_approval"
              ? "Hay productos o lanzamientos esperando aprobacion de Robert."
              : "Sistema listo para siguiente batch controlado.",
      nextCommand,
    },
    profitGuard,
    budgetPolicy: profitGuard.budgetPolicy,
    ceoOperatingPlan,
    growthBoard,
    marketingDepartment,
    executionSetup,
    liveSignalReadiness,
    launchReadiness,
    operatingContract: {
      ceoAgent: "Dropshipping CEO",
      canRunAutonomously: [
        "investigar productos y tendencias",
        "comparar proveedores",
        "calcular margen",
        "crear drafts de tienda/contenido",
        "preparar reportes",
        "actualizar aprendizajes",
      ],
      requiresRobertApproval: [
        "gastar dinero",
        "ordenar sample",
        "publicar producto",
        "publicar contenido",
        "contactar proveedor/cliente",
        "fulfill de una orden real",
        "activar ads",
      ],
      blockedAlways: ["comprar inventario al por mayor", "prometer tiempos de envio no verificados", "usar marcas/copyright sin permiso"],
    },
    readiness: [
      {
        id: "shopify_connection",
        label: "Shopify preparado",
        status: shopifyReady ? "ready" as const : "needs_setup" as const,
        detail: shopifyReady ? `Draft API listo para ${shopifyConfig.shopDomain}.` : "Configura SHOPIFY_SHOP_DOMAIN y SHOPIFY_ADMIN_ACCESS_TOKEN para crear drafts.",
      },
      {
        id: "telegram_reports",
        label: "Reportes Telegram",
        status: TELEGRAM_BOT_TOKEN ? "ready" as const : "needs_setup" as const,
        detail: TELEGRAM_BOT_TOKEN ? "Bot token detectado; falta validar chat por usuario." : "Configura TELEGRAM_BOT_TOKEN y chat para envio real.",
      },
      {
        id: "ai_chat",
        label: "Chat AI actual",
        status: process.env.AI_INTEGRATIONS_GEMINI_API_KEY ? "ready" as const : "needs_setup" as const,
        detail: process.env.AI_INTEGRATIONS_GEMINI_API_KEY ? "Gemini configurado." : "Sin Gemini local; motor deterministico sigue funcionando.",
      },
      {
        id: "social_publisher",
        label: "Publisher social",
        status: socialPublisherReady ? "ready" as const : "needs_setup" as const,
        detail: socialPublisherReady
          ? socialPublisherConfig.mode === "metricool_mcp"
            ? "Metricool MCP listo para cola social aprobada."
            : "Webhook social configurado para posts aprobados."
          : "Sin webhook social/Metricool; usar cola/manual hasta conectar redes.",
      },
      {
        id: "live_product_signals",
        label: "Live product signals",
        status: liveSignalReadiness.status === "connected" ? "ready" as const : liveSignalReadiness.status === "partial" ? "needs_setup" as const : "needs_setup" as const,
        detail: liveSignalReadiness.configured
          ? `${liveSignalReadiness.verifiedSignals}/${liveSignalReadiness.totalSignals} senales verificadas desde ${liveSignalReadiness.sources.join(", ")}.`
          : "Conecta DROPSHIPPING_LIVE_PRODUCT_SIGNALS_JSON o DROPSHIPPING_LIVE_PRODUCT_SIGNALS_PATH para usar TikTok/AliExpress/Trends reales.",
      },
      {
        id: "budget_guard",
        label: `Budget ${money.format(profitGuard.monthlyBudgetUsd)}`,
        status: profitGuard.totalSpendUsd <= profitGuard.monthlyBudgetUsd ? "ready" as const : "blocked" as const,
        detail: `${money.format(profitGuard.totalSpendUsd)} gastado de ${money.format(profitGuard.monthlyBudgetUsd)}. Nivel ${profitGuard.budgetPolicy.stage}.`,
      },
      {
        id: "no_inventory",
        label: "Sin inventario",
        status: "ready" as const,
        detail: "El modelo bloquea compras de stock; solo permite sample con aprobacion.",
      },
      {
        id: "order_ops",
        label: "Order Ops",
        status: unfulfilledOrders > 0 ? "needs_setup" as const : "ready" as const,
        detail: unfulfilledOrders > 0 ? `${unfulfilledOrders} orden(es) requieren fulfillment/approval.` : "Ordenes pagadas se registran sin stock y fulfillment queda gated.",
      },
    ],
    agents: [
      { id: "dropshipping-ceo", name: "Dropshipping CEO", role: "Dirige producto, margen, tienda, redes y aprendizaje", status: "active" },
      { id: "product-scout", name: "Product Scout", role: "Busca tendencias virales y demanda", status: "active" },
      { id: "supplier-analyst", name: "Supplier Analyst", role: "Evalua AliExpress/DSers/CJ/Zendrop/Spocket", status: "active" },
      { id: "profit-guard", name: "Profit Guard", role: "Bloquea gasto si no hay margen o cash", status: "active" },
      { id: "store-builder", name: "Store Builder", role: "Prepara drafts de Shopify", status: "draft_only" },
      { id: "social-manager", name: "Social Media Manager", role: "Crea posts, cola publicaciones y analiza resultados", status: "active" },
      { id: "marketing-cmo", name: "Marketing Director / CMO", role: "Dirige subagentes de contenido, ads, analytics y safety", status: "active" },
      { id: "order-ops", name: "Order Ops", role: "Registra ventas y prepara fulfillment sin inventario", status: "active" },
      { id: "legal-security", name: "Legal + Security", role: "Bloquea claims, copyright, politicas y riesgos", status: "active" },
      { id: "learning-analyst", name: "Learning Analyst", role: "Mejora playbook con datos diarios", status: "active" },
    ],
    recentProducts: products.slice(0, 8),
    recentProductScoutCandidates: productScoutCandidates.slice(0, 8),
    recentSuppliers: suppliers.slice(0, 8),
    recentLaunchPlans: launchPlans.slice(0, 5),
    recentLedger: ledger.slice(0, 8),
    recentApprovals: approvals.slice(0, 8),
    recentLearningReviews: learningReviews.slice(0, 5),
    recentMarketingCampaigns: marketingCampaigns.slice(0, 8),
    recentCeoCycles: ceoCycles.slice(0, 8),
    recentShopifyDrafts: shopifyDrafts.slice(0, 8),
    recentSocialPosts: socialPosts.slice(0, 12),
    recentSocialMetrics: socialMetrics.slice(0, 12),
    recentSocialAnalyses: socialAnalyses.slice(0, 5),
    recentOrders: orderRecords.slice(0, 10),
    recentFulfillmentActions: fulfillmentActions.slice(0, 10),
    recentCapitalPlans: capitalPlans.slice(0, 8),
    recentGrowthSprints: growthSprints.slice(0, 6),
    recentLaunchPacks: launchPacks.slice(0, 6),
    recentAutopilotProductHunterRuns: autopilotProductHunterRuns.slice(0, 5),
    recentApprovalOutbox: approvalOutbox.slice(0, 8),
    latestCampaign,
    latestCapitalPlan,
    latestGrowthSprint,
    latestLaunchPack,
    latestAutopilotProductHunterRun,
    latestCycle,
    latestLearning,
    latestSocialAnalysis,
    growthLoop: {
      stage:
        qualifiedProducts.length === 0
          ? "research"
          : approvalQueue > 0
            ? "approval"
            : latestLearning?.decisionStatus === "scale_content"
              ? "scale"
              : "validation",
      dailyOperatingRhythm: [
        "AM: elegir producto foco y crear drafts organicos",
        "Midday: revisar approvals y comentarios",
        "PM: registrar metricas, ventas, refunds y aprendizaje",
      ],
      scalingRule: profitGuard.budgetPolicy.scalingRule,
      currentExperiment: latestSocialAnalysis?.summary || latestCampaign?.campaignName || "sin campana activa",
    },
  };
}

export function getDropshippingExecutionSetup() {
  loadAll();
  return {
    executionSetup: buildDropshippingExecutionSetupCenter(),
    snapshot: getDropshippingCeoSnapshot(),
  };
}

export function getDropshippingLaunchReadiness() {
  loadAll();
  const snapshot = getDropshippingCeoSnapshot();
  return {
    launchReadiness: snapshot.launchReadiness,
    snapshot,
  };
}

export function buildDropshippingDailyReport(cadence: "morning" | "evening" = "morning") {
  const snapshot = getDropshippingCeoSnapshot();
  const topProducts = snapshot.recentProducts.slice(0, 3);
  const approvalsText = snapshot.metrics.approvalQueue > 0
    ? `Aprobaciones: ${snapshot.metrics.approvalQueue} pendientes antes de publicar/gastar.`
    : "Aprobaciones: ninguna pendiente.";
  const productsText = topProducts.length
    ? topProducts.map((product) => `- ${product.productName}: ${product.status}, margen ${product.economics.grossMarginPercent}%, score ${product.scorecard.grade}`).join("\n")
    : "- Sin productos investigados todavia.";
  const scoutText = snapshot.recentProductScoutCandidates.length
    ? snapshot.recentProductScoutCandidates.slice(0, 4).map((candidate) => `- ${candidate.candidateName}: ${candidate.status}, score ${candidate.scorecard.grade}${candidate.scorecard.total}, margen ${candidate.economics.grossMarginPercent}%.`).join("\n")
    : "- Sin candidatos del Product Scout todavia.";
  const campaignsText = snapshot.recentMarketingCampaigns.length
    ? snapshot.recentMarketingCampaigns.slice(0, 2).map((campaign) => `- ${campaign.campaignName}: ${campaign.status}, gasto pedido ${money.format(campaign.budgetPlan.requestedSpendUsd)}`).join("\n")
    : "- Sin campanas generadas todavia.";
  const postsText = snapshot.recentSocialPosts.length
    ? snapshot.recentSocialPosts.slice(0, 4).map((post) => `- ${platformLabel(post.platform)}: ${post.status}, ${post.hook}`).join("\n")
    : "- Sin posts generados todavia.";
  const socialLearningText = snapshot.recentSocialAnalyses.length
    ? snapshot.recentSocialAnalyses.slice(0, 2).map((analysis) => `- ${analysis.periodLabel}: ${analysis.status}, ${analysis.summary}`).join("\n")
    : "- Sin analisis social todavia.";
  const portfolioText = snapshot.ceoOperatingPlan.campaignPortfolio
    .slice(0, 3)
    .map((campaign) => `- ${campaign.name}: ${campaign.status}, cap ${money.format(campaign.spendCapUsd)}.`)
    .join("\n");
  const ordersText = snapshot.recentOrders.length
    ? snapshot.recentOrders.slice(0, 3).map((order) => `- ${order.productName}: ${order.status}, revenue ${money.format(order.grossRevenueUsd)}, profit est. ${money.format(order.estimatedProfitUsd)}`).join("\n")
    : "- Sin ordenes registradas todavia.";
  const fulfillmentText = snapshot.recentFulfillmentActions.length
    ? snapshot.recentFulfillmentActions.slice(0, 3).map((action) => `- ${action.order?.productName || action.orderId}: ${action.status}, ${action.guardrail.reason}`).join("\n")
    : "- Sin fulfillment actions todavia.";
  const capitalText = snapshot.recentCapitalPlans.length
    ? snapshot.recentCapitalPlans.slice(0, 2).map((plan) => `- ${plan.objective}: ${plan.status}, envelope ${money.format(plan.requestedCampaignEnvelopeUsd)}, tramo ${money.format(plan.approvedInitialBudgetUsd)}.`).join("\n")
    : "- Sin plan de capital todavia.";
  const sprintText = snapshot.recentGrowthSprints.length
    ? snapshot.recentGrowthSprints.slice(0, 2).map((sprint) => `- ${sprint.focus}: ${sprint.status}, ${sprint.days} dias, riesgo ${money.format(sprint.budgetEnvelope.approvedToRiskUsd)}, readiness ${sprint.sprintScoreboard.readinessPercent}%.`).join("\n")
    : "- Sin sprint CEO todavia.";
  const launchPackText = snapshot.recentLaunchPacks.length
    ? snapshot.recentLaunchPacks.slice(0, 2).map((pack) => `- ${pack.mode}: ${pack.status}, posts ${pack.socialPosts.length}, Shopify ${pack.shopifyPreflight?.status || "none"}, gasto ${money.format(pack.safety.spentUsd)}.`).join("\n")
    : "- Sin launch pack todavia.";
  const approvalOutboxText = snapshot.recentApprovalOutbox.length
    ? snapshot.recentApprovalOutbox.slice(0, 4).map((item) => `- ${item.actionType}: ${item.status}, ${item.title}`).join("\n")
    : "- Sin approvals locales pendientes.";
  const shopifyText = snapshot.recentShopifyDrafts.length
    ? snapshot.recentShopifyDrafts.slice(0, 2).map((draft) => `- ${draft.product?.productName || draft.productId}: ${draft.status}, ${draft.guardrail.reason}`).join("\n")
    : "- Sin drafts Shopify todavia.";

  return [
    cadence === "morning" ? "Dropshipping CEO - Reporte AM" : "Dropshipping CEO - Cierre PM",
    "",
    snapshot.executiveSummary.headline,
    `Meta: ${money.format(snapshot.metrics.totalRevenueUsd)} / ${money.format(TARGET_MONTHLY_REVENUE_USD)} (${snapshot.metrics.progressToTargetPercent}%).`,
    `Cash: ${money.format(snapshot.metrics.cashCollectedUsd)} | Gasto: ${money.format(snapshot.metrics.totalSpendUsd)} | Profit: ${money.format(snapshot.metrics.profitUsd)}.`,
    `Ordenes: ${snapshot.metrics.orders} registradas, ${snapshot.metrics.paidOrders} pagadas, ${snapshot.metrics.unfulfilledOrders} por fulfillment.`,
    `Marketing: ${snapshot.metrics.socialPosts} posts, ${snapshot.metrics.publishedSocialPosts} publicados, revenue social ${money.format(snapshot.metrics.socialRevenueUsd)}.`,
    `Approval outbox local: ${snapshot.metrics.localApprovalOutbox} pendiente(s) si Trust Center/DB esta apagado.`,
    `Launch readiness: ${snapshot.launchReadiness.status}. ${snapshot.launchReadiness.summary}`,
    `Budget ladder: ${snapshot.budgetPolicy.stage}, budget activo ${money.format(snapshot.budgetPolicy.activeMonthlyBudgetUsd)}, max test ${money.format(snapshot.budgetPolicy.maxSingleTestUsd)}.`,
    `Plan CEO: ${snapshot.ceoOperatingPlan.stage}, faltan ${money.format(snapshot.ceoOperatingPlan.revenueGapUsd)} y ~${snapshot.ceoOperatingPlan.estimatedOrdersNeeded} ordenes. Decision: ${snapshot.ceoOperatingPlan.nextExecutiveDecision}`,
    `Growth Board: ${snapshot.growthBoard.status}. ${snapshot.growthBoard.decision}`,
    `Profit Guard: ${snapshot.profitGuard.status} - ${snapshot.profitGuard.reason}`,
    approvalsText,
    "",
    "Product Scout:",
    scoutText,
    "",
    "Productos:",
    productsText,
    "",
    "Campanas:",
    campaignsText,
    "",
    "Posts:",
    postsText,
    "",
    "Marketing learnings:",
    socialLearningText,
    "",
    "Portfolio CEO:",
    portfolioText,
    "",
    "Ordenes:",
    ordersText,
    "",
    "Fulfillment:",
    fulfillmentText,
    "",
    "Capital plan:",
    capitalText,
    "",
    "CEO growth sprint:",
    sprintText,
    "",
    "Launch pack:",
    launchPackText,
    "",
    "Approval outbox local:",
    approvalOutboxText,
    "",
    "Shopify drafts:",
    shopifyText,
    "",
    `Siguiente comando: ${snapshot.executiveSummary.nextCommand}`,
  ].join("\n");
}

export async function sendDropshippingDailyReport(userId: string, cadence: "morning" | "evening" = "morning") {
  const telegramConfig = await storage.getTelegramConfig(userId);
  const message = buildDropshippingDailyReport(cadence);

  if (!TELEGRAM_BOT_TOKEN || !telegramConfig?.enabled || !telegramConfig.chatId) {
    return {
      sent: false,
      message,
      reason: "Telegram no esta configurado para este usuario.",
      snapshot: getDropshippingCeoSnapshot(),
    };
  }

  const sent = await sendTelegramPlainMessage(TELEGRAM_BOT_TOKEN, telegramConfig.chatId, message);
  return {
    sent,
    message,
    reason: sent ? "Reporte enviado por Telegram." : "Telegram rechazo el envio.",
    snapshot: getDropshippingCeoSnapshot(),
  };
}

export function setDropshippingProductsPathForTests(value: string | null) {
  productsPathOverride = value;
}

export function setDropshippingProductScoutCandidatesPathForTests(value: string | null) {
  productScoutCandidatesPathOverride = value;
}

export function setDropshippingSuppliersPathForTests(value: string | null) {
  suppliersPathOverride = value;
}

export function setDropshippingLaunchPlansPathForTests(value: string | null) {
  launchPlansPathOverride = value;
}

export function setDropshippingLedgerPathForTests(value: string | null) {
  ledgerPathOverride = value;
}

export function setDropshippingApprovalsPathForTests(value: string | null) {
  approvalsPathOverride = value;
}

export function setDropshippingLearningPathForTests(value: string | null) {
  learningPathOverride = value;
}

export function setDropshippingMarketingCampaignsPathForTests(value: string | null) {
  marketingCampaignsPathOverride = value;
}

export function setDropshippingCeoCyclesPathForTests(value: string | null) {
  ceoCyclesPathOverride = value;
}

export function setDropshippingShopifyDraftsPathForTests(value: string | null) {
  shopifyDraftsPathOverride = value;
}

export function setDropshippingSocialPostsPathForTests(value: string | null) {
  socialPostsPathOverride = value;
}

export function setDropshippingSocialMetricsPathForTests(value: string | null) {
  socialMetricsPathOverride = value;
}

export function setDropshippingSocialAnalysesPathForTests(value: string | null) {
  socialAnalysesPathOverride = value;
}

export function setDropshippingOrdersPathForTests(value: string | null) {
  ordersPathOverride = value;
}

export function setDropshippingFulfillmentActionsPathForTests(value: string | null) {
  fulfillmentActionsPathOverride = value;
}

export function setDropshippingCapitalPlansPathForTests(value: string | null) {
  capitalPlansPathOverride = value;
}

export function setDropshippingGrowthSprintsPathForTests(value: string | null) {
  growthSprintsPathOverride = value;
}

export function setDropshippingLaunchPacksPathForTests(value: string | null) {
  launchPacksPathOverride = value;
}

export function setDropshippingAutopilotProductHunterRunsPathForTests(value: string | null) {
  autopilotProductHunterRunsPathOverride = value;
}

export function setDropshippingApprovalOutboxPathForTests(value: string | null) {
  approvalOutboxPathOverride = value;
}

export function resetDropshippingEngineForTests() {
  products.splice(0, products.length);
  productScoutCandidates.splice(0, productScoutCandidates.length);
  suppliers.splice(0, suppliers.length);
  launchPlans.splice(0, launchPlans.length);
  ledger.splice(0, ledger.length);
  approvals.splice(0, approvals.length);
  learningReviews.splice(0, learningReviews.length);
  marketingCampaigns.splice(0, marketingCampaigns.length);
  ceoCycles.splice(0, ceoCycles.length);
  shopifyDrafts.splice(0, shopifyDrafts.length);
  socialPosts.splice(0, socialPosts.length);
  socialMetrics.splice(0, socialMetrics.length);
  socialAnalyses.splice(0, socialAnalyses.length);
  orderRecords.splice(0, orderRecords.length);
  fulfillmentActions.splice(0, fulfillmentActions.length);
  capitalPlans.splice(0, capitalPlans.length);
  growthSprints.splice(0, growthSprints.length);
  launchPacks.splice(0, launchPacks.length);
  autopilotProductHunterRuns.splice(0, autopilotProductHunterRuns.length);
  approvalOutbox.splice(0, approvalOutbox.length);
  productsLoaded = true;
  productScoutCandidatesLoaded = true;
  suppliersLoaded = true;
  launchPlansLoaded = true;
  ledgerLoaded = true;
  approvalsLoaded = true;
  learningLoaded = true;
  marketingCampaignsLoaded = true;
  ceoCyclesLoaded = true;
  shopifyDraftsLoaded = true;
  socialPostsLoaded = true;
  socialMetricsLoaded = true;
  socialAnalysesLoaded = true;
  ordersLoaded = true;
  fulfillmentActionsLoaded = true;
  capitalPlansLoaded = true;
  growthSprintsLoaded = true;
  launchPacksLoaded = true;
  autopilotProductHunterRunsLoaded = true;
  approvalOutboxLoaded = true;
  for (const filePath of [
    getProductsPath(),
    getProductScoutCandidatesPath(),
    getSuppliersPath(),
    getLaunchPlansPath(),
    getLedgerPath(),
    getApprovalsPath(),
    getLearningPath(),
    getMarketingCampaignsPath(),
    getCeoCyclesPath(),
    getShopifyDraftsPath(),
    getSocialPostsPath(),
    getSocialMetricsPath(),
    getSocialAnalysesPath(),
    getOrdersPath(),
    getFulfillmentActionsPath(),
    getCapitalPlansPath(),
    getGrowthSprintsPath(),
    getLaunchPacksPath(),
    getAutopilotProductHunterRunsPath(),
    getApprovalOutboxPath(),
  ]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}
