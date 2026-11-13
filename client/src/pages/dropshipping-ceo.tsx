import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeDollarSign,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleX,
  ClipboardList,
  DollarSign,
  FileCheck2,
  Gauge,
  Loader2,
  Megaphone,
  PackageSearch,
  PlayCircle,
  Rocket,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  TrendingUp,
  Truck,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";

type DropshippingSnapshot = {
  generatedAt: string;
  strategy: {
    model: string;
    storeChannel: string;
    firstNiche: string;
    startingBudgetUsd: number;
    targetMonthlyRevenueUsd: number;
    inventoryPolicy: string;
  };
  metrics: {
    productsResearched: number;
    productScoutCandidates: number;
    scoutReadyCandidates: number;
    qualifiedProducts: number;
    launchReadyProducts: number;
    suppliersReviewed: number;
    marketingCampaigns: number;
    ceoCycles: number;
    shopifyDrafts: number;
    socialPosts: number;
    queuedSocialPosts: number;
    publishedSocialPosts: number;
    socialRevenueUsd: number;
    socialSpendUsd: number;
    socialOrders: number;
    socialConversionRatePercent: number;
    orders: number;
    paidOrders: number;
    unfulfilledOrders: number;
    fulfillmentActions: number;
    capitalPlans: number;
    growthSprints: number;
    launchPacks: number;
    autopilotProductHunterRuns: number;
    localApprovalOutbox: number;
    orderRevenueUsd: number;
    orderProfitUsd: number;
    totalRevenueUsd: number;
    cashCollectedUsd: number;
    totalSpendUsd: number;
    profitUsd: number;
    approvalQueue: number;
    progressToTargetPercent: number;
  };
  executiveSummary: {
    status: "blocked" | "research" | "needs_approval" | "ready";
    headline: string;
    nextCommand: string;
  };
  profitGuard: {
    status: "pause_spend" | "collect_first" | "review_queue" | "scale_carefully";
    monthlyBudgetUsd: number;
    targetMonthlyRevenueUsd: number;
    totalRevenueUsd: number;
    cashCollectedUsd: number;
    totalSpendUsd: number;
    refundsUsd: number;
    profitUsd: number;
    remainingBudgetUsd: number;
    canSpendUsd: number;
    reason: string;
  };
  budgetPolicy: {
    stage: "starter_100" | "validation_250" | "growth_500" | "scale_1000";
    activeMonthlyBudgetUsd: number;
    startingMonthlyBudgetUsd: number;
    targetMonthlyRevenueUsd: number;
    dailySpendCapUsd: number;
    nextStage: string;
    nextBudgetUsd: number;
    maxSingleTestUsd: number;
    orderSignal: number;
    requiresApprovalForExternalActions: boolean;
    requiresSampleBeforeScale: boolean;
    reasons: string[];
    scalingRule: string;
  };
  ceoOperatingPlan: {
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
  growthBoard: {
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
  executionSetup: DropshippingExecutionSetup;
  launchReadiness: DropshippingLaunchReadiness;
  operatingContract: {
    ceoAgent: string;
    canRunAutonomously: string[];
    requiresRobertApproval: string[];
    blockedAlways: string[];
  };
  readiness: Array<{ id: string; label: string; status: "ready" | "needs_setup" | "blocked"; detail: string }>;
  agents: Array<{ id: string; name: string; role: string; status: string }>;
  recentProducts: DropshippingProduct[];
  recentProductScoutCandidates: DropshippingProductScoutCandidate[];
  recentSuppliers: DropshippingSupplier[];
  recentLaunchPlans: DropshippingLaunchPlan[];
  recentLedger: DropshippingLedgerEntry[];
  recentApprovals: DropshippingApprovalDecision[];
  recentLearningReviews: DropshippingLearningReview[];
  recentMarketingCampaigns: DropshippingMarketingCampaign[];
  recentCeoCycles: DropshippingCeoCycle[];
  recentShopifyDrafts: DropshippingShopifyDraft[];
  recentSocialPosts: DropshippingSocialPost[];
  recentSocialMetrics: DropshippingSocialMetric[];
  recentSocialAnalyses: DropshippingSocialAnalysis[];
  recentOrders: DropshippingOrder[];
  recentFulfillmentActions: DropshippingFulfillmentAction[];
  recentCapitalPlans: DropshippingCapitalPlan[];
  recentGrowthSprints: DropshippingGrowthSprint[];
  recentLaunchPacks: DropshippingLaunchPack[];
  recentAutopilotProductHunterRuns: DropshippingAutopilotProductHunterRun[];
  recentApprovalOutbox: DropshippingApprovalOutboxItem[];
  latestCampaign?: DropshippingMarketingCampaign;
  latestCapitalPlan?: DropshippingCapitalPlan;
  latestGrowthSprint?: DropshippingGrowthSprint;
  latestLaunchPack?: DropshippingLaunchPack;
  latestAutopilotProductHunterRun?: DropshippingAutopilotProductHunterRun;
  latestCycle?: DropshippingCeoCycle;
  latestSocialAnalysis?: DropshippingSocialAnalysis;
  growthLoop: {
    stage: "research" | "approval" | "scale" | "validation";
    dailyOperatingRhythm: string[];
    scalingRule: string;
    currentExperiment: string;
  };
};

type DropshippingApprovalOutboxItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "pending_local" | "queued_in_trust_center" | "cancelled";
  source: "launch_pack_approval_queue" | "manual";
  failureReason: string;
  queuedExternally: boolean;
  trustCenterPendingActionId: string;
  actionType: "dropshipping.spend" | "dropshipping.publish_product" | "dropshipping.create_shopify_draft" | "dropshipping.publish_social" | "dropshipping.contact_supplier" | "dropshipping.fulfill_order" | "dropshipping.order_sample";
  resourceType: string;
  resourceId: string;
  title: string;
  description: string;
};

type DropshippingExecutionSetup = {
  generatedAt: string;
  status: "ready_for_dry_run" | "needs_setup" | "blocked";
  summary: string;
  connectors: Array<{
    id: "shopify" | "social_publisher" | "telegram" | "supplier_ops" | "approvals" | "payments_tax";
    label: string;
    status: "ready" | "needs_setup" | "blocked";
    mode: "api" | "webhook" | "manual" | "dry_run";
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

type DropshippingProduct = {
  id: string;
  productName: string;
  niche: string;
  trendSource: string;
  supplierPlatform: string;
  targetSellPriceUsd: number;
  evidence: string;
  legalRisk: "low" | "medium" | "high";
  qualityRisk: "low" | "medium" | "high";
  status: "research" | "qualified" | "approval_required" | "sample_recommended" | "launch_ready" | "blocked";
  economics: {
    landedCostUsd: number;
    grossProfitUsd: number;
    grossMarginPercent: number;
    ordersNeededForTargetRevenue: number;
  };
  scorecard: { total: number; grade: string; pass: boolean };
  subagentReviews: Array<{ agent: string; verdict: "pass" | "fix" | "block"; note: string }>;
  requiredApprovals: string[];
  nextActions: string[];
};

type DropshippingProductScoutCandidate = {
  id: string;
  candidateName: string;
  niche: string;
  trendSource: "shopify_2026" | "tiktok" | "instagram" | "amazon" | "google_trends" | "aliexpress" | "manual";
  supplierPlatform: "aliexpress" | "cj_dropshipping" | "dsers" | "zendrop" | "spocket" | "manual";
  sourceUrl: string;
  sourceLabel: string;
  demandSignal: "weak" | "medium" | "strong" | "breakout";
  problemSolved: string;
  contentAngle: string;
  targetAudience: string;
  estimatedProductCostUsd: number;
  estimatedShippingCostUsd: number;
  targetSellPriceUsd: number;
  competitorPriceUsd: number;
  estimatedMonthlyDemand: number;
  supplierRating: number;
  reviewCount: number;
  shippingDaysMin: number;
  shippingDaysMax: number;
  legalRisk: "low" | "medium" | "high";
  qualityRisk: "low" | "medium" | "high";
  requiresSample: boolean;
  notes: string;
  status: "seed_candidate" | "needs_tiktok_validation" | "needs_supplier" | "ready_for_research" | "shortlisted" | "promoted" | "rejected";
  validation: {
    status: "seed_only" | "needs_external_validation" | "externally_validated";
    confidence: "low" | "medium" | "high";
    evidenceScore: number;
    evidence: Array<{
      source: "tiktok_creative_center" | "tiktok_search" | "aliexpress_search" | "google_trends" | "shopify_trends" | "manual";
      label: string;
      url: string;
      status: "seed_reference" | "needs_review" | "verified";
      signal: string;
    }>;
    missingProof: string[];
  };
  scorecard: {
    total: number;
    grade: "A" | "B" | "C" | "D";
    components: Record<string, number>;
    pass: boolean;
  };
  economics: {
    landedCostUsd: number;
    grossProfitUsd: number;
    grossMarginPercent: number;
    breakEvenOrdersAtBudget: number | null;
    ordersNeededForTargetRevenue: number;
  };
  nextActions: string[];
  promotedProductId: string;
  createdAt: string;
  updatedAt: string;
};

type DropshippingAutopilotProductHunterRun = {
  id: string;
  createdAt: string;
  status: "prepared_for_robert_review" | "blocked_no_candidate";
  focusNiche: string;
  maxCandidates: number;
  requestedBudgetUsd: number;
  dailyOrganicPosts: number;
  postsPerPlatform: number;
  notes: string;
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

type DropshippingSupplier = {
  id: string;
  supplierName: string;
  platform: string;
  productName: string;
  status: "approved_candidate" | "needs_backup_supplier" | "blocked";
  score: number;
  riskFlags: string[];
  nextActions: string[];
};

type DropshippingLaunchPlan = {
  id: string;
  status: "draft_only" | "approval_required" | "ready_after_approval" | "blocked";
  productId: string;
  storeChannel: string;
  dailyOrganicPosts: number;
  paidAdTestBudgetUsd: number;
  product: DropshippingProduct | null;
  contentCalendar: Array<{ day: string; channel: string; hook: string; status: "draft" | "needs_approval" }>;
  gatedActions: string[];
  nextActions: string[];
};

type DropshippingLedgerEntry = {
  id: string;
  kind: "sale" | "expense" | "refund" | "sample_order";
  label: string;
  amountUsd: number;
  cashCollectedUsd: number;
  notes: string;
  createdAt: string;
};

type DropshippingApprovalDecision = {
  id: string;
  targetType: string;
  decision: "approved" | "rejected" | "needs_changes";
  approvedAction: string;
  maxSpendUsd: number;
  guardrail: { status: "recorded" | "blocked"; reason: string };
  createdAt: string;
};

type DropshippingLearningReview = {
  id: string;
  periodLabel: string;
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

type DropshippingMarketingCampaign = {
  id: string;
  productId: string;
  campaignName: string;
  channel: string;
  objective: string;
  status: "draft_only" | "approval_required" | "ready_after_approval" | "blocked";
  targetAudience: string;
  primaryHook: string;
  offer: string;
  dailyOrganicPosts: number;
  paidTestBudgetUsd: number;
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
  createdAt: string;
};

type DropshippingCeoCycle = {
  id: string;
  mode: "daily" | "product_validation" | "scale_winner";
  forcePaidTest: boolean;
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
  createdAt: string;
};

type DropshippingSocialPlatform = "tiktok" | "instagram" | "facebook" | "youtube_shorts" | "pinterest" | "email" | "manual";

type DropshippingSocialPost = {
  id: string;
  campaignId: string;
  productId: string;
  platform: DropshippingSocialPlatform;
  format: string;
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
  publishResult: { mode: "none" | "dry_run" | "manual" | "webhook"; externalPostUrl: string; responseStatus: number | null; message: string; publishedAt: string };
  metricsSummary: { views: number; clicks: number; orders: number; revenueUsd: number; spendUsd: number; profitUsd: number; conversionRatePercent: number };
  nextActions: string[];
  createdAt: string;
};

type DropshippingSocialMetric = {
  id: string;
  postId: string;
  platform: DropshippingSocialPlatform;
  views: number;
  clicks: number;
  orders: number;
  revenueUsd: number;
  spendUsd: number;
  notes: string;
  calculated: { engagementRatePercent: number; clickRatePercent: number; conversionRatePercent: number; profitUsd: number; roas: number };
  createdAt: string;
};

type DropshippingSocialAnalysis = {
  id: string;
  periodLabel: string;
  campaignId: string;
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
  createdAt: string;
};

type DropshippingOrderSource = "shopify" | "manual" | "tiktok_shop" | "social_dm" | "other";

type DropshippingOrder = {
  id: string;
  source: DropshippingOrderSource;
  externalOrderId: string;
  productId: string;
  productName: string;
  customerAlias: string;
  quantity: number;
  saleSubtotalUsd: number;
  shippingChargedUsd: number;
  taxCollectedUsd: number;
  productCostUsd: number;
  supplierShippingUsd: number;
  paymentStatus: "paid" | "pending" | "refunded" | "chargeback";
  notes: string;
  status: "pending_payment" | "approval_required" | "ready_for_fulfillment" | "fulfilled" | "blocked" | "refunded";
  product: DropshippingProduct | null;
  grossRevenueUsd: number;
  estimatedCostUsd: number;
  estimatedProfitUsd: number;
  grossMarginPercent: number;
  ledgerEntryId: string;
  requiredApprovals: string[];
  nextActions: string[];
  createdAt: string;
  updatedAt: string;
};

type DropshippingFulfillmentAction = {
  id: string;
  orderId: string;
  supplierName: string;
  supplierPlatform: "aliexpress" | "cj_dropshipping" | "dsers" | "zendrop" | "spocket" | "manual";
  supplierOrderId: string;
  trackingNumber: string;
  trackingUrl: string;
  approvalToFulfill: boolean;
  dryRun: boolean;
  notes: string;
  status: "preflight" | "approval_required" | "manual_fulfillment_recorded" | "blocked" | "failed";
  order: DropshippingOrder | null;
  guardrail: { status: "ready" | "blocked"; reason: string; missing: string[] };
  costImpactUsd: number;
  nextActions: string[];
  createdAt: string;
};

type DropshippingCapitalPlan = {
  id: string;
  campaignId: string;
  objective: "protect_cash" | "validate_winner" | "scale_winner" | "retarget_customers";
  requestedBudgetUsd: number;
  approvalToPrepareLargeCampaign: boolean;
  notes: string;
  createdAt: string;
  status: "draft" | "locked_until_signal" | "ready_after_approval" | "blocked";
  campaign: DropshippingMarketingCampaign | null;
  product: DropshippingProduct | null;
  activeStage: "starter_100" | "validation_250" | "growth_500" | "scale_1000";
  requestedCampaignEnvelopeUsd: number;
  approvedInitialBudgetUsd: number;
  maxSingleTestUsd: number;
  canSpendUsd: number;
  stageGate: { status: "pass" | "locked" | "blocked"; reason: string; requiredSignals: string[] };
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

type DropshippingGrowthSprint = {
  id: string;
  focus: "first_100_validation" | "validate_winner" | "scale_winner" | "prepare_large_campaign";
  days: number;
  requestedBudgetUsd: number;
  approvalToPrepareSpend: boolean;
  notes: string;
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

type DropshippingLaunchPack = {
  id: string;
  productId: string;
  mode: "starter_validation" | "organic_launch" | "scale_candidate";
  dailyOrganicPosts: number;
  platforms: DropshippingSocialPlatform[];
  postsPerPlatform: number;
  requestedBudgetUsd: number;
  approvalToPrepareDraft: boolean;
  approvalToPublish: boolean;
  approvalToSpend: boolean;
  notes: string;
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

type DropshippingShopifyDraft = {
  id: string;
  productId: string;
  campaignId: string;
  vendor: string;
  productType: string;
  dryRun: boolean;
  approvalToCreateDraft: boolean;
  status: "preflight" | "draft_created" | "blocked" | "failed";
  product: DropshippingProduct | null;
  campaign: DropshippingMarketingCampaign | null;
  shopifyProductId: string;
  shopifyHandle: string;
  guardrail: { status: "ready" | "blocked"; reason: string; missing: string[] };
  userErrors: Array<{ field: string[]; message: string }>;
  nextActions: string[];
  createdAt: string;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

function statusTone(status: string) {
  if (["ready", "ready_for_dry_run", "ready_for_test_order", "scale_carefully", "approved_candidate", "pass", "recorded", "ready_after_approval", "launch_ready", "queued", "queued_in_trust_center", "published", "scale_content", "active_now", "scale", "fulfilled", "manual_fulfillment_recorded", "micro_test_ready", "ready_for_research", "promoted", "draft_ready", "scale_ready", "on_track", "active", "go", "validation_ready", "telegram", "prepared_for_robert_review", "externally_validated", "high"].includes(status)) {
    return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
  }
  if (["needs_approval", "review_queue", "sample_recommended", "needs_setup", "needs_backup_supplier", "needs_database", "needs_migration", "needs_accounts", "needs_supplier_validation", "ready_for_sample", "pre_account_ready", "preview_only", "fix", "approval_required", "draft", "iterate_hooks", "needs_data", "locked_until_signal", "locked", "research", "validation", "traction", "pending_payment", "ready_for_fulfillment", "preflight", "needs_product", "scale_locked", "organic_only", "scale_plan_only", "shortlisted", "seed_candidate", "needs_tiktok_validation", "needs_external_validation", "medium", "needs_supplier", "research_board", "validation_board", "approval_locked", "cash_locked", "watch", "hold"].includes(status)) {
    return "border-amber-400/40 bg-amber-400/10 text-amber-100";
  }
  if (["blocked", "blocked_no_candidate", "blocked_needs_accounts", "blocked_safety", "pause_spend", "block", "rejected", "pause_and_fix", "critical", "seed_only", "low"].includes(status)) {
    return "border-red-400/40 bg-red-400/10 text-red-100";
  }
  return "border-zinc-600 bg-zinc-900 text-zinc-300";
}

function FieldLabel({ children }: { children: string }) {
  return <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">{children}</label>;
}

const socialPlatformOptions: Array<{ value: DropshippingSocialPlatform; label: string }> = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube_shorts", label: "YouTube Shorts" },
  { value: "pinterest", label: "Pinterest" },
  { value: "email", label: "Email" },
];

export default function DropshippingCeoPage() {
  const { data: snapshot, isLoading } = useQuery<DropshippingSnapshot>({
    queryKey: ["dropshipping-ceo"],
    queryFn: async () => {
      const response = await fetch("/api/dropshipping-ceo");
      if (!response.ok) throw new Error("Failed to load dropshipping CEO");
      return response.json();
    },
  });

  const [productForm, setProductForm] = useState({
    productName: "Producto viral nuevo",
    niche: "productos virales",
    trendSource: "tiktok",
    supplierPlatform: "aliexpress",
    productCostUsd: 5,
    shippingCostUsd: 2,
    targetSellPriceUsd: 24.99,
    estimatedMonthlyDemand: 300,
    competitorPriceUsd: 29.99,
    supplierRating: 4.5,
    reviewCount: 300,
    shippingDaysMin: 7,
    shippingDaysMax: 18,
    returnPolicy: "Supplier accepts damaged item returns.",
    evidence: "Video viral con problema visible, uso simple y buen potencial para contenido organico.",
    legalRisk: "medium",
    qualityRisk: "medium",
    requiresSample: false,
  });
  const [scoutBatchForm, setScoutBatchForm] = useState({
    focusNiche: "mixed",
    maxCandidates: 4,
    budgetUsd: 100,
    notes: "",
  });
  const [autopilotHunterForm, setAutopilotHunterForm] = useState({
    focusNiche: "mixed",
    maxCandidates: 5,
    requestedBudgetUsd: 0,
    dailyOrganicPosts: 3,
    postsPerPlatform: 1,
    notes: "",
  });
  const [autopilotHunterResult, setAutopilotHunterResult] = useState<string>("");
  const [autopilotDecisionResult, setAutopilotDecisionResult] = useState<string>("");
  const [supplierForm, setSupplierForm] = useState({
    supplierName: "AliExpress supplier",
    platform: "aliexpress",
    productName: "Producto viral nuevo",
    rating: 4.5,
    reviewCount: 300,
    ordersCount: 500,
    shipsFrom: "China",
    estimatedShippingDays: 18,
    hasTracking: true,
    hasReturns: false,
    hasMultipleSuppliers: false,
    notes: "",
  });
  const [launchForm, setLaunchForm] = useState({
    productId: "",
    storeChannel: "shopify_social",
    dailyOrganicPosts: 3,
    paidAdTestBudgetUsd: 0,
    approvalToPublish: false,
    approvalToSpend: false,
    approvalToOrderSample: false,
  });
  const [launchPackForm, setLaunchPackForm] = useState({
    productId: "",
    mode: "starter_validation",
    dailyOrganicPosts: 3,
    platforms: ["tiktok", "instagram"] as DropshippingSocialPlatform[],
    postsPerPlatform: 1,
    requestedBudgetUsd: 0,
    approvalToPrepareDraft: false,
    approvalToPublish: false,
    approvalToSpend: false,
    notes: "",
  });
  const [ledgerForm, setLedgerForm] = useState({
    kind: "sale",
    label: "Venta Shopify",
    productId: "",
    amountUsd: 0,
    cashCollectedUsd: 0,
    notes: "",
  });
  const [learningForm, setLearningForm] = useState({
    periodLabel: "hoy",
    productId: "",
    postsPublished: 0,
    visitors: 0,
    addToCarts: 0,
    orders: 0,
    revenueUsd: 0,
    spendUsd: 0,
    refundsUsd: 0,
    bestHook: "",
    biggestProblem: "",
    notes: "",
  });
  const [approvalForm, setApprovalForm] = useState({
    actionType: "dropshipping.order_sample",
    resourceType: "dropshipping",
    resourceId: "",
    title: "Aprobar accion Dropshipping",
    description: "El CEO recomienda aprobar esta accion despues de revisar margen, proveedor y riesgo.",
  });
  const [campaignForm, setCampaignForm] = useState({
    productId: "",
    campaignName: "Validation campaign",
    channel: "tiktok",
    objective: "validate_product",
    targetAudience: "personas que compran soluciones simples vistas en redes sociales",
    primaryHook: "Producto viral que resuelve un problema visible sin ocupar espacio.",
    offer: "Oferta de prueba con checkout claro y sin inventario propio.",
    dailyOrganicPosts: 3,
    paidTestBudgetUsd: 0,
    approvalToPublish: false,
    approvalToSpend: false,
  });
  const [cycleForm, setCycleForm] = useState({
    mode: "daily",
    forcePaidTest: false,
  });
  const [shopifyForm, setShopifyForm] = useState({
    productId: "",
    campaignId: "",
    vendor: "Dropshipping CEO",
    productType: "Dropshipping validation",
    approvalToCreateDraft: false,
    dryRun: true,
  });
  const [socialBatchForm, setSocialBatchForm] = useState({
    campaignId: "",
    platforms: ["tiktok", "instagram"] as DropshippingSocialPlatform[],
    postsPerPlatform: 1,
    approvalToPublish: false,
    scheduledDate: "",
  });
  const [socialPublishForm, setSocialPublishForm] = useState({
    postId: "",
    approvalToPublish: false,
    dryRun: true,
    externalPostUrl: "",
  });
  const [socialMetricsForm, setSocialMetricsForm] = useState({
    postId: "",
    impressions: 0,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    clicks: 0,
    addToCarts: 0,
    orders: 0,
    revenueUsd: 0,
    spendUsd: 0,
    notes: "",
  });
  const [socialAnalysisForm, setSocialAnalysisForm] = useState({
    periodLabel: "hoy",
    campaignId: "",
  });
  const [orderForm, setOrderForm] = useState({
    source: "manual" as DropshippingOrderSource,
    externalOrderId: "",
    productId: "",
    productName: "Orden manual",
    customerAlias: "",
    quantity: 1,
    saleSubtotalUsd: 0,
    shippingChargedUsd: 0,
    taxCollectedUsd: 0,
    productCostUsd: 0,
    supplierShippingUsd: 0,
    paymentStatus: "paid",
    notes: "",
  });
  const [fulfillmentForm, setFulfillmentForm] = useState({
    orderId: "",
    supplierName: "AliExpress supplier",
    supplierPlatform: "aliexpress",
    supplierOrderId: "",
    trackingNumber: "",
    trackingUrl: "",
    approvalToFulfill: false,
    dryRun: true,
    notes: "",
  });
  const [capitalForm, setCapitalForm] = useState({
    campaignId: "",
    objective: "validate_winner",
    requestedBudgetUsd: 100,
    approvalToPrepareLargeCampaign: false,
    notes: "",
  });
  const [growthSprintForm, setGrowthSprintForm] = useState({
    focus: "first_100_validation",
    days: 7,
    requestedBudgetUsd: 100,
    approvalToPrepareSpend: false,
    notes: "",
  });
  const [reportCadence, setReportCadence] = useState<"morning" | "evening">("morning");
  const [lastReport, setLastReport] = useState<string>("");
  const [approvalQueueResult, setApprovalQueueResult] = useState<string>("");
  const [outboxMigrationResult, setOutboxMigrationResult] = useState<string>("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["dropshipping-ceo"] });

  const productMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/product-research", productForm),
    onSuccess: refresh,
  });
  const scoutBatchMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/product-scout-batch", scoutBatchForm),
    onSuccess: refresh,
  });
  const scoutPromoteMutation = useMutation({
    mutationFn: (candidateId: string) => postJson("/api/dropshipping-ceo/product-scout-promote", { candidateId, approvalToPromote: true }),
    onSuccess: refresh,
  });
  const autopilotHunterMutation = useMutation({
    mutationFn: () => postJson<{
      run: DropshippingAutopilotProductHunterRun;
      product: DropshippingProduct | null;
      launchPack: DropshippingLaunchPack | null;
    }>("/api/dropshipping-ceo/autopilot-product-hunter", autopilotHunterForm),
    onSuccess: (data) => {
      setAutopilotHunterResult(data.product
        ? `Autopilot recomienda ${data.product.productName}. Launch pack ${data.launchPack?.status || "preparado"}; nada publicado/gastado.`
        : data.run.summary);
      refresh();
    },
    onError: (error) => {
      setAutopilotHunterResult(error instanceof Error ? error.message : "No se pudo correr Autopilot Product Hunter.");
    },
  });
  const autopilotDecisionMutation = useMutation({
    mutationFn: async (decision: "approved" | "rejected" | "needs_changes") => {
      const run = snapshot?.latestAutopilotProductHunterRun;
      const winner = run?.rankedCandidates[0]?.candidateName || "producto ganador";
      if (!run?.winnerProductId) throw new Error("No hay producto ganador listo para decidir.");
      const approvalDecision = await postJson<{ decision: DropshippingApprovalDecision }>("/api/dropshipping-ceo/approval-decisions", {
        targetId: run.winnerProductId,
        targetType: "product",
        decision,
        approvedAction:
          decision === "approved"
            ? `Approve Autopilot winner: ${winner}`
            : decision === "rejected"
              ? `Reject Autopilot winner: ${winner}`
              : `Request changes for Autopilot winner: ${winner}`,
        maxSpendUsd: 0,
        notes: "Decision tomada desde Autopilot Product Hunter. No publica, no compra y no gasta.",
      });
      let launchApprovals: { queuedCount: number; duplicateCount: number; fallback: boolean; skipped: string[] } | null = null;
      if (decision === "approved" && run.launchPackId) {
        const queued = await postJson<{
          pendingActions: unknown[];
          prepared: { skipped: string[] };
          fallback?: boolean;
          localOutbox?: { queued: unknown[]; duplicates: unknown[] };
        }>("/api/dropshipping-ceo/launch-pack-approvals", {
          launchPackId: run.launchPackId,
          includeSpendApproval: false,
          includeSampleApproval: false,
        });
        launchApprovals = {
          queuedCount: queued.fallback ? queued.localOutbox?.queued.length || 0 : queued.pendingActions.length,
          duplicateCount: queued.localOutbox?.duplicates.length || 0,
          fallback: Boolean(queued.fallback),
          skipped: queued.prepared.skipped,
        };
      }
      return { ...approvalDecision, launchApprovals };
    },
    onSuccess: (data) => {
      setAutopilotDecisionResult(data.decision.decision === "approved"
        ? `Producto aprobado para launch prep. ${data.launchApprovals ? `${data.launchApprovals.queuedCount} approval(s) de launch en cola${data.launchApprovals.duplicateCount ? `, ${data.launchApprovals.duplicateCount} duplicados` : ""}. ` : ""}Spend y sample siguen bloqueados.`
        : data.decision.decision === "rejected"
          ? "Producto rechazado. Queda bloqueado y debes correr Autopilot otra vez para buscar otro ganador."
          : "Cambios pedidos. El producto queda en approval_required hasta ajustar evidencia/proveedor/oferta.");
      refresh();
    },
    onError: (error) => {
      setAutopilotDecisionResult(error instanceof Error ? error.message : "No se pudo registrar la decision del ganador.");
    },
  });
  const supplierMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/supplier-review", supplierForm),
    onSuccess: refresh,
  });
  const launchMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/launch-plan", { ...launchForm, productId: launchForm.productId || snapshot?.recentProducts[0]?.id || "" }),
    onSuccess: refresh,
  });
  const launchPackMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/launch-pack", { ...launchPackForm, productId: launchPackForm.productId || snapshot?.recentProducts[0]?.id || "" }),
    onSuccess: refresh,
  });
  const launchPackApprovalsMutation = useMutation({
    mutationFn: (launchPackId: string) => postJson<{
      pendingActions: unknown[];
      prepared: { skipped: string[] };
      fallback?: boolean;
      localOutbox?: { queued: unknown[]; duplicates: unknown[] };
    }>("/api/dropshipping-ceo/launch-pack-approvals", {
      launchPackId,
      includeSpendApproval: false,
      includeSampleApproval: false,
    }),
    onSuccess: (data) => {
      if (data.fallback) {
        const queued = data.localOutbox?.queued.length || 0;
        const duplicates = data.localOutbox?.duplicates.length || 0;
        setApprovalQueueResult(`Trust Center DB offline: saved ${queued} approval(s) to local outbox, ${duplicates} already existed. ${data.prepared.skipped.join(" ")}`);
      } else {
        setApprovalQueueResult(`Queued ${data.pendingActions.length} approval(s) in Trust Center. ${data.prepared.skipped.join(" ")}`);
      }
      refresh();
    },
  });
  const ledgerMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/ledger", ledgerForm),
    onSuccess: refresh,
  });
  const learningMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/learning-review", learningForm),
    onSuccess: refresh,
  });
  const approvalMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/pending-approval", approvalForm),
    onSuccess: refresh,
  });
  const outboxMigrationMutation = useMutation({
    mutationFn: (dryRun: boolean) => postJson<{
      dryRun: boolean;
      prepared: { selectedCount: number; pendingLocalCount: number; skippedCount: number };
      migrated: Array<{ id: string; title: string; actionType: string }>;
      failed: Array<{ id: string; title: string; actionType: string; error: string }>;
      marked: { pendingLocalCount: number } | null;
    }>("/api/dropshipping-ceo/approval-outbox-migration", { dryRun, limit: 25 }),
    onSuccess: (data) => {
      if (data.dryRun) {
        setOutboxMigrationResult(`Dry run: ${data.prepared.selectedCount} approval(s) listos para Trust Center; ${data.prepared.pendingLocalCount} pending local total.`);
      } else if (data.failed.length) {
        setOutboxMigrationResult(`Trust Center/Postgres aun no esta listo: ${data.failed.length} fallo(s), ${data.migrated.length} migrado(s).`);
      } else {
        setOutboxMigrationResult(`Migrados ${data.migrated.length} approval(s) a Trust Center. Pending local: ${data.marked?.pendingLocalCount ?? 0}.`);
      }
      refresh();
    },
    onError: (error) => {
      setOutboxMigrationResult(error instanceof Error ? error.message : "No se pudo migrar el outbox.");
    },
  });
  const campaignMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/marketing-campaign", { ...campaignForm, productId: campaignForm.productId || snapshot?.recentProducts[0]?.id || "" }),
    onSuccess: refresh,
  });
  const socialBatchMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/social-post-batch", { ...socialBatchForm, campaignId: socialBatchForm.campaignId || snapshot?.recentMarketingCampaigns[0]?.id || "" }),
    onSuccess: refresh,
  });
  const socialPublishMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/social-publish", { ...socialPublishForm, postId: socialPublishForm.postId || snapshot?.recentSocialPosts[0]?.id || "" }),
    onSuccess: refresh,
  });
  const socialMetricsMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/social-metrics", { ...socialMetricsForm, postId: socialMetricsForm.postId || snapshot?.recentSocialPosts[0]?.id || "" }),
    onSuccess: refresh,
  });
  const socialAnalysisMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/social-analysis", socialAnalysisForm),
    onSuccess: refresh,
  });
  const orderMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/order", { ...orderForm, productId: orderForm.productId || bestProduct?.id || "" }),
    onSuccess: refresh,
  });
  const fulfillmentMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/fulfillment", { ...fulfillmentForm, orderId: fulfillmentForm.orderId || snapshot?.recentOrders[0]?.id || "" }),
    onSuccess: refresh,
  });
  const capitalMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/capital-plan", { ...capitalForm, campaignId: capitalForm.campaignId || snapshot?.recentMarketingCampaigns[0]?.id || "" }),
    onSuccess: refresh,
  });
  const growthSprintMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/growth-sprint", growthSprintForm),
    onSuccess: refresh,
  });
  const cycleMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/run-cycle", cycleForm),
    onSuccess: refresh,
  });
  const operatingCycleMutation = useMutation({
    mutationFn: () => postJson<{ reportPreview: string }>("/api/dropshipping-ceo/operating-cycle", cycleForm),
    onSuccess: (data) => {
      setLastReport(data.reportPreview);
      refresh();
    },
  });
  const shopifyPreflightMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/shopify-preflight", { ...shopifyForm, productId: shopifyForm.productId || snapshot?.recentProducts[0]?.id || "" }),
    onSuccess: refresh,
  });
  const shopifyDraftMutation = useMutation({
    mutationFn: () => postJson("/api/dropshipping-ceo/shopify-draft", { ...shopifyForm, productId: shopifyForm.productId || snapshot?.recentProducts[0]?.id || "" }),
    onSuccess: refresh,
  });
  const reportMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/dropshipping-ceo/report-preview?cadence=${reportCadence}`);
      if (!response.ok) throw new Error("Failed to preview report");
      return response.json() as Promise<{ message: string }>;
    },
    onSuccess: (data) => setLastReport(data.message),
  });

  const selectedProductOptions = snapshot?.recentProducts || [];
  const bestProduct = useMemo(() => {
    return selectedProductOptions.find((product) => product.status !== "blocked") || selectedProductOptions[0];
  }, [selectedProductOptions]);
  const selectedCampaignOptions = snapshot?.recentMarketingCampaigns || [];
  const selectedPostOptions = snapshot?.recentSocialPosts || [];
  const selectedOrderOptions = snapshot?.recentOrders || [];

  const toggleSocialPlatform = (platform: DropshippingSocialPlatform) => {
    setSocialBatchForm((current) => {
      const exists = current.platforms.includes(platform);
      const platforms = exists ? current.platforms.filter((item) => item !== platform) : [...current.platforms, platform];
      return { ...current, platforms: platforms.length ? platforms : current.platforms };
    });
  };

  if (isLoading || !snapshot) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-zinc-400">Cargando Dropshipping CEO...</div>;
  }

  const submit = (event: FormEvent, action: () => void) => {
    event.preventDefault();
    action();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <Link href="/agents-office">
              <Button variant="ghost" className="mb-3 h-9 px-0 text-zinc-400 hover:bg-transparent hover:text-white">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Agents Office
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-400 text-zinc-950">
                <Store className="h-6 w-6" />
              </span>
              <div>
                <h1 className="text-2xl font-semibold tracking-normal">Dropshipping CEO</h1>
                <p className="mt-1 text-sm text-zinc-400">{snapshot.executiveSummary.headline}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-50">
            <p className="font-medium">Sin inventario propio</p>
            <p className="mt-1 text-emerald-50/75">{snapshot.strategy.inventoryPolicy}</p>
          </div>
        </div>

        <section className="mb-6 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          {[
            { label: "Meta mensual", value: `${money.format(snapshot.metrics.totalRevenueUsd)} / ${money.format(snapshot.strategy.targetMonthlyRevenueUsd)}`, icon: TrendingUp },
            { label: "Cash cobrado", value: money.format(snapshot.metrics.cashCollectedUsd), icon: DollarSign },
            { label: "Gasto", value: `${money.format(snapshot.metrics.totalSpendUsd)} / ${money.format(snapshot.budgetPolicy.activeMonthlyBudgetUsd)}`, icon: Gauge },
            { label: "Ordenes", value: `${snapshot.metrics.paidOrders}/${snapshot.metrics.orders} pagadas`, icon: ShoppingBag },
            { label: "Capital", value: `${snapshot.metrics.capitalPlans} plans`, icon: BadgeDollarSign },
            { label: "Shopify", value: `${snapshot.metrics.shopifyDrafts} drafts`, icon: Store },
            { label: "Social", value: `${snapshot.metrics.socialPosts} posts / ${snapshot.metrics.publishedSocialPosts} live`, icon: BarChart3 },
          ].map((item) => {
            const Icon = item.icon;
            return (
            <Card key={item.label} className="border-zinc-800 bg-zinc-900/80">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{item.label}</p>
                  <Icon className="h-4 w-4 text-emerald-200" />
                </div>
                <p className="mt-2 text-xl font-semibold text-white">{item.value}</p>
              </CardContent>
            </Card>
            );
          })}
        </section>

        <Card className="mb-6 border-zinc-800 bg-zinc-900/80">
          <CardContent className="p-4">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-white">Profit Guard</p>
                <p className="mt-1 text-sm text-zinc-400">{snapshot.profitGuard.reason}</p>
              </div>
              <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.profitGuard.status))}>
                {snapshot.profitGuard.status}
              </Badge>
            </div>
            <Progress value={snapshot.metrics.progressToTargetPercent} className="h-2 bg-zinc-800" />
            <div className="mt-3 grid gap-2 text-xs text-zinc-400 md:grid-cols-4">
              <span>Restante budget: {money.format(snapshot.profitGuard.remainingBudgetUsd)}</span>
              <span>Permitido gastar ahora: {money.format(snapshot.profitGuard.canSpendUsd)}</span>
              <span>Nivel: {snapshot.budgetPolicy.stage} / approvals {snapshot.metrics.approvalQueue}</span>
              <span>Outbox local: {snapshot.metrics.localApprovalOutbox}</span>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="console" className="space-y-4">
          <TabsList className="grid h-auto grid-cols-2 gap-1 bg-zinc-900 p-1 md:grid-cols-[repeat(14,minmax(0,1fr))]">
            <TabsTrigger value="console">CEO</TabsTrigger>
            <TabsTrigger value="products">Productos</TabsTrigger>
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            <TabsTrigger value="launch">Launch</TabsTrigger>
            <TabsTrigger value="campaigns">Campanas</TabsTrigger>
            <TabsTrigger value="social">Social</TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="capital">Capital</TabsTrigger>
            <TabsTrigger value="execution">Execution</TabsTrigger>
            <TabsTrigger value="shopify">Shopify</TabsTrigger>
            <TabsTrigger value="cycles">Ciclos</TabsTrigger>
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="learning">Learning</TabsTrigger>
            <TabsTrigger value="approvals">Approvals</TabsTrigger>
          </TabsList>

          <TabsContent value="console" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-4">
                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader>
                    <CardTitle className="text-base">Comando actual</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="rounded-lg border border-emerald-400/20 bg-black p-4 text-sm leading-6 text-emerald-50">
                      {snapshot.executiveSummary.nextCommand}
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_190px]">
                      <div className="rounded-lg border border-zinc-800 bg-black p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-white">Growth loop</p>
                          <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.growthLoop.stage))}>{snapshot.growthLoop.stage}</Badge>
                        </div>
                        <p className="text-xs leading-5 text-zinc-500">{snapshot.growthLoop.scalingRule}</p>
                        <p className="mt-2 text-xs text-zinc-400">Experimento: {snapshot.growthLoop.currentExperiment}</p>
                      </div>
                      <Button onClick={() => cycleMutation.mutate()} disabled={cycleMutation.isPending} className="h-full min-h-20 bg-emerald-600 text-white hover:bg-emerald-500">
                        {cycleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                        Run CEO cycle
                      </Button>
                      <Button onClick={() => operatingCycleMutation.mutate()} disabled={operatingCycleMutation.isPending} className="h-full min-h-20 bg-emerald-600 text-white hover:bg-emerald-500">
                        {operatingCycleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                        Run operating day
                      </Button>
                    </div>
                    <div className="mt-4 rounded-lg border border-zinc-800 bg-black p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">Budget ladder</p>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.budgetPolicy.stage))}>{snapshot.budgetPolicy.stage}</Badge>
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        <Metric label="Budget activo" value={money.format(snapshot.budgetPolicy.activeMonthlyBudgetUsd)} />
                        <Metric label="Max test" value={money.format(snapshot.budgetPolicy.maxSingleTestUsd)} />
                        <Metric label="Ordenes senal" value={String(snapshot.budgetPolicy.orderSignal)} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {snapshot.budgetPolicy.reasons.map((reason) => <p key={reason} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-500">{reason}</p>)}
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg border border-zinc-800 bg-black p-3">
                      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-medium text-white">CEO operating plan</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">{snapshot.ceoOperatingPlan.mission}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.ceoOperatingPlan.stage))}>{snapshot.ceoOperatingPlan.stage}</Badge>
                      </div>
                      <div className="grid gap-2 md:grid-cols-4">
                        <Metric label="Gap a meta" value={money.format(snapshot.ceoOperatingPlan.revenueGapUsd)} />
                        <Metric label="Ordenes necesarias" value={String(snapshot.ceoOperatingPlan.estimatedOrdersNeeded)} />
                        <Metric label="AOV estimado" value={money.format(snapshot.ceoOperatingPlan.averageOrderValueUsd)} />
                        <Metric label="Campana grande" value={money.format(snapshot.ceoOperatingPlan.largeCampaignReadiness.maxRecommendedBudgetUsd)} />
                      </div>
                      <p className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-5 text-zinc-300">{snapshot.ceoOperatingPlan.nextExecutiveDecision}</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Stage gate</p>
                            <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.ceoOperatingPlan.largeCampaignReadiness.status))}>{snapshot.ceoOperatingPlan.largeCampaignReadiness.status}</Badge>
                          </div>
                          <p className="text-xs leading-5 text-zinc-400">{snapshot.ceoOperatingPlan.currentStageGate}</p>
                          <p className="mt-2 text-xs leading-5 text-zinc-500">{snapshot.ceoOperatingPlan.largeCampaignReadiness.reason}</p>
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Riesgos board</p>
                          <div className="space-y-1">
                            {snapshot.ceoOperatingPlan.boardRisks.slice(0, 3).map((risk) => <p key={risk} className="text-xs leading-5 text-zinc-400">{risk}</p>)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {snapshot.ceoOperatingPlan.campaignPortfolio.slice(0, 4).map((campaign) => (
                          <div key={campaign.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-white">{campaign.name}</p>
                                <p className="mt-1 text-xs text-zinc-500">{money.format(campaign.spendCapUsd)} cap</p>
                              </div>
                              <Badge variant="outline" className={cn("shrink-0", statusTone(campaign.status))}>{campaign.status}</Badge>
                            </div>
                            <p className="text-xs leading-5 text-zinc-400">{campaign.objective}</p>
                            <p className="mt-2 text-xs leading-5 text-zinc-500">{campaign.approvalGate}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg border border-zinc-800 bg-black p-3">
                      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-medium text-white">Growth Board CEO</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">{snapshot.growthBoard.headline}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.growthBoard.status))}>{snapshot.growthBoard.status}</Badge>
                      </div>
                      <p className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm leading-5 text-emerald-50">{snapshot.growthBoard.decision}</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <Metric label="Budget activo" value={money.format(snapshot.growthBoard.capitalDoctrine.activeMonthlyBudgetUsd)} />
                        <Metric label="Riesgo ahora" value={money.format(snapshot.growthBoard.capitalDoctrine.canRiskNowUsd)} />
                        <Metric label="Reserva protegida" value={money.format(snapshot.growthBoard.capitalDoctrine.protectedReserveUsd)} />
                        <Metric label="Requests" value={String(snapshot.growthBoard.approvalRequests.length)} />
                      </div>
                      <div className="mt-3 grid gap-2 lg:grid-cols-3">
                        {snapshot.growthBoard.kpiScorecard.slice(0, 6).map((kpi) => (
                          <div key={kpi.id} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{kpi.label}</p>
                                <p className="mt-1 text-sm font-medium text-white">{kpi.current}</p>
                              </div>
                              <Badge variant="outline" className={cn("shrink-0", statusTone(kpi.status))}>{kpi.status}</Badge>
                            </div>
                            <p className="text-xs leading-5 text-zinc-500">{kpi.target}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Scale ladder</p>
                          <div className="space-y-2">
                            {snapshot.growthBoard.campaignScaleLadder.map((step) => (
                              <div key={step.stage} className="rounded border border-zinc-800 bg-black p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-medium text-white">{step.name}</p>
                                  <Badge variant="outline" className={cn("shrink-0", statusTone(step.status))}>{step.status}</Badge>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-zinc-500">{money.format(step.budgetUsd)} / {step.approvalGate}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Board votes</p>
                          <div className="space-y-2">
                            {snapshot.growthBoard.boardVotes.map((vote) => (
                              <div key={vote.agent} className="rounded border border-zinc-800 bg-black p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-medium text-white">{vote.agent}</p>
                                  <Badge variant="outline" className={cn("shrink-0", statusTone(vote.vote))}>{vote.vote}</Badge>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-zinc-500">{vote.reason}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">30 day plan</p>
                          <div className="space-y-2">
                            {snapshot.growthBoard.thirtyDayPlan.map((week) => (
                              <div key={week.week} className="rounded border border-zinc-800 bg-black p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-medium text-white">Week {week.week}: {week.objective}</p>
                                  <span className="text-xs text-zinc-500">{money.format(week.budgetUsd)}</span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-zinc-500">{week.output}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">CEO orders</p>
                          <div className="space-y-2">
                            {snapshot.growthBoard.nextOperatingOrders.map((order) => (
                              <div key={`${order.owner}-${order.due}`} className="rounded border border-zinc-800 bg-black p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-medium text-white">{order.owner}</p>
                                  <span className="text-xs text-zinc-500">{order.due}</span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-zinc-500">{order.order}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Market intelligence</p>
                        <div className="grid gap-2 md:grid-cols-2">
                          {snapshot.growthBoard.sourceIntelligence.map((source) => (
                            <a key={source.source} href={source.url} target="_blank" rel="noreferrer" className="rounded border border-zinc-800 bg-black p-2 hover:border-emerald-400/40">
                              <p className="text-xs font-medium text-white">{source.source}</p>
                              <p className="mt-1 text-xs leading-5 text-zinc-500">{source.ceoAction}</p>
                            </a>
                          ))}
                        </div>
                      </div>
                      {snapshot.growthBoard.blockedUntil.length > 0 && (
                        <div className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/10 p-3">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-100">Blocked until</p>
                          <div className="flex flex-wrap gap-2">
                            {snapshot.growthBoard.blockedUntil.map((item) => <Badge key={item} variant="outline" className="border-amber-400/30 text-amber-100">{item}</Badge>)}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-4 rounded-lg border border-zinc-800 bg-black p-3">
                      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-medium text-white">CEO growth sprint</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">
                            Orden ejecutiva de 7 dias: subagentes, KPIs, budget protegido y reglas para matar, iterar o escalar.
                          </p>
                        </div>
                        {snapshot.latestGrowthSprint && (
                          <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.latestGrowthSprint.status))}>{snapshot.latestGrowthSprint.status}</Badge>
                        )}
                      </div>
                      <form className="grid gap-3 md:grid-cols-[1fr_120px_130px_180px] md:items-end" onSubmit={(event) => submit(event, () => growthSprintMutation.mutate())}>
                        <select value={growthSprintForm.focus} onChange={(event) => setGrowthSprintForm({ ...growthSprintForm, focus: event.target.value })} className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm">
                          <option value="first_100_validation">First $100 validation</option>
                          <option value="validate_winner">Validate winner</option>
                          <option value="scale_winner">Scale winner</option>
                          <option value="prepare_large_campaign">Prepare large campaign</option>
                        </select>
                        <Input type="number" min={3} max={14} value={growthSprintForm.days} onChange={(event) => setGrowthSprintForm({ ...growthSprintForm, days: Number(event.target.value) })} className="border-zinc-800 bg-zinc-950" />
                        <Input type="number" min={0} value={growthSprintForm.requestedBudgetUsd} onChange={(event) => setGrowthSprintForm({ ...growthSprintForm, requestedBudgetUsd: Number(event.target.value) })} className="border-zinc-800 bg-zinc-950" />
                        <Button type="submit" disabled={growthSprintMutation.isPending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                          {growthSprintMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                          Build CEO sprint
                        </Button>
                        <label className="flex items-center gap-2 text-xs text-zinc-400 md:col-span-2">
                          <input type="checkbox" checked={growthSprintForm.approvalToPrepareSpend} onChange={(event) => setGrowthSprintForm({ ...growthSprintForm, approvalToPrepareSpend: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                          Permitir preparar primer tramo de gasto si Profit Guard deja
                        </label>
                        <Input value={growthSprintForm.notes} onChange={(event) => setGrowthSprintForm({ ...growthSprintForm, notes: event.target.value })} placeholder="Nota del CEO para este sprint" className="border-zinc-800 bg-zinc-950 md:col-span-2" />
                      </form>
                      {snapshot.latestGrowthSprint ? (
                        <div className="mt-4 space-y-3">
                          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                            <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="text-sm font-medium text-white">{snapshot.latestGrowthSprint.ceoDirective.headline}</p>
                                <p className="mt-1 text-xs leading-5 text-zinc-400">{snapshot.latestGrowthSprint.ceoDirective.targetOutcome}</p>
                              </div>
                              <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.latestGrowthSprint.budgetEnvelope.spendMode))}>{snapshot.latestGrowthSprint.budgetEnvelope.spendMode}</Badge>
                            </div>
                            <div className="grid gap-2 md:grid-cols-5">
                              <Metric label="Readiness" value={`${snapshot.latestGrowthSprint.sprintScoreboard.readinessPercent}%`} />
                              <Metric label="Sprint target" value={money.format(snapshot.latestGrowthSprint.unitEconomics.sprintRevenueTargetUsd)} />
                              <Metric label="Ordenes sprint" value={String(snapshot.latestGrowthSprint.unitEconomics.ordersNeededForSprintTarget)} />
                              <Metric label="Riesgo aprobado" value={money.format(snapshot.latestGrowthSprint.budgetEnvelope.approvedToRiskUsd)} />
                              <Metric label="Stage" value={snapshot.latestGrowthSprint.budgetEnvelope.stage} />
                            </div>
                            <p className="mt-3 rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs leading-5 text-zinc-400">{snapshot.latestGrowthSprint.boardMemo}</p>
                          </div>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Subagentes</p>
                              <div className="space-y-2">
                                {snapshot.latestGrowthSprint.subagentOrders.slice(0, 5).map((order) => (
                                  <div key={`${snapshot.latestGrowthSprint?.id}-${order.owner}`} className="rounded border border-zinc-800 bg-black p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-xs font-medium text-white">{order.owner}</p>
                                      <Badge variant="outline" className="shrink-0 border-zinc-700 text-zinc-300">{order.deadline}</Badge>
                                    </div>
                                    <p className="mt-1 text-xs leading-5 text-zinc-500">{order.mission}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Calendario</p>
                              <div className="space-y-2">
                                {snapshot.latestGrowthSprint.campaignCalendar.slice(0, 5).map((day) => (
                                  <div key={`${snapshot.latestGrowthSprint?.id}-day-${day.day}`} className="rounded border border-zinc-800 bg-black p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-xs font-medium text-white">Dia {day.day} / {day.owner}</p>
                                      <span className="text-xs text-zinc-500">{money.format(day.budgetUsd)}</span>
                                    </div>
                                    <p className="mt-1 text-xs leading-5 text-zinc-500">{day.task}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-500">
                          Crea el primer sprint para que el CEO deje tareas, KPIs, gates y budget por escrito.
                        </p>
                      )}
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {snapshot.readiness.map((item) => (
                        <div key={item.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-white">{item.label}</p>
                            <Badge variant="outline" className={cn("shrink-0", statusTone(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="text-xs leading-5 text-zinc-500">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader>
                    <CardTitle className="text-base">Reportes Telegram</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                      <select
                        value={reportCadence}
                        onChange={(event) => setReportCadence(event.target.value as "morning" | "evening")}
                        className="h-10 rounded-md border border-zinc-800 bg-black px-3 text-sm"
                      >
                        <option value="morning">7:30 AM</option>
                        <option value="evening">9:00 PM</option>
                      </select>
                      <Button onClick={() => reportMutation.mutate()} disabled={reportMutation.isPending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                        {reportMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Preview reporte
                      </Button>
                    </div>
                    {lastReport && (
                      <pre className="mt-4 max-h-80 overflow-auto rounded-lg border border-zinc-800 bg-black p-4 text-xs leading-5 text-zinc-300 whitespace-pre-wrap">
                        {lastReport}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader>
                    <CardTitle className="text-base">Subagentes</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {snapshot.agents.map((agent) => (
                      <div key={agent.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{agent.name}</p>
                            <p className="mt-1 text-xs leading-4 text-zinc-500">{agent.role}</p>
                          </div>
                          <Badge variant="outline" className={cn("shrink-0", statusTone(agent.status))}>{agent.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader>
                    <CardTitle className="text-base">Contrato operativo</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Autonomo</p>
                      <div className="space-y-1">
                        {snapshot.operatingContract.canRunAutonomously.map((item) => <p key={item} className="text-sm text-zinc-300">{item}</p>)}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Robert aprueba</p>
                      <div className="space-y-1">
                        {snapshot.operatingContract.requiresRobertApproval.map((item) => <p key={item} className="text-sm text-amber-100">{item}</p>)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="products" className="mt-0">
            <Card className="mb-4 border-emerald-400/30 bg-emerald-400/10">
              <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" /> Autopilot Product Hunter</CardTitle>
                    <p className="mt-2 text-sm leading-5 text-emerald-50/80">
                      Encuentra el mejor candidato, lo promueve a producto, valida supplier, arma launch pack y deja approvals listos. No publica, no compra y no gasta.
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.latestAutopilotProductHunterRun?.status || "needs_external_validation"))}>
                    {snapshot.latestAutopilotProductHunterRun?.status || "not_run"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <form className="grid gap-3 md:grid-cols-[1fr_110px_120px_120px_120px] md:items-end" onSubmit={(event) => submit(event, () => autopilotHunterMutation.mutate())}>
                  <div className="space-y-1">
                    <FieldLabel>Nicho</FieldLabel>
                    <select value={autopilotHunterForm.focusNiche} onChange={(event) => setAutopilotHunterForm({ ...autopilotHunterForm, focusNiche: event.target.value })} className="h-10 w-full rounded-md border border-emerald-400/20 bg-black px-3 text-sm">
                      <option value="mixed">Mixed</option>
                      <option value="home_problem_solvers">Home problem solvers</option>
                      <option value="kitchen_organization">Kitchen organization</option>
                      <option value="car_accessories">Car accessories</option>
                      <option value="pet_supplies">Pet supplies</option>
                      <option value="beauty_low_claims">Beauty low-claims</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Candidatos</FieldLabel>
                    <Input type="number" min={3} max={8} value={autopilotHunterForm.maxCandidates} onChange={(event) => setAutopilotHunterForm({ ...autopilotHunterForm, maxCandidates: Number(event.target.value) })} className="border-emerald-400/20 bg-black" />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Budget</FieldLabel>
                    <Input type="number" min={0} max={100} value={autopilotHunterForm.requestedBudgetUsd} onChange={(event) => setAutopilotHunterForm({ ...autopilotHunterForm, requestedBudgetUsd: Number(event.target.value) })} className="border-emerald-400/20 bg-black" />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel>Posts/dia</FieldLabel>
                    <Input type="number" min={1} max={10} value={autopilotHunterForm.dailyOrganicPosts} onChange={(event) => setAutopilotHunterForm({ ...autopilotHunterForm, dailyOrganicPosts: Number(event.target.value) })} className="border-emerald-400/20 bg-black" />
                  </div>
                  <Button type="submit" disabled={autopilotHunterMutation.isPending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                    {autopilotHunterMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Find best
                  </Button>
                </form>
                {autopilotHunterResult && (
                  <p className="rounded-md border border-emerald-400/20 bg-black px-3 py-2 text-sm leading-5 text-emerald-50">{autopilotHunterResult}</p>
                )}
                {snapshot.latestAutopilotProductHunterRun && (
                  <div className="grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
                    <div className="rounded-lg border border-emerald-400/20 bg-black p-3">
                      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-medium text-white">Producto recomendado</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-400">{snapshot.latestAutopilotProductHunterRun.summary}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.latestAutopilotProductHunterRun.confidence))}>
                          {snapshot.latestAutopilotProductHunterRun.confidence}
                        </Badge>
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        <Metric label="Gasto" value={money.format(snapshot.latestAutopilotProductHunterRun.safety.spentUsd)} />
                        <Metric label="Budget pedido" value={money.format(snapshot.latestAutopilotProductHunterRun.requestedBudgetUsd)} />
                        <Metric label="Approvals" value={String(snapshot.latestAutopilotProductHunterRun.approvalRequired.length)} />
                      </div>
                      <p className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-400">
                        {snapshot.latestAutopilotProductHunterRun.safety.message}
                      </p>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        <Button
                          type="button"
                          size="sm"
                          disabled={autopilotDecisionMutation.isPending || !snapshot.latestAutopilotProductHunterRun.winnerProductId}
                          onClick={() => autopilotDecisionMutation.mutate("approved")}
                          className="bg-emerald-600 text-white hover:bg-emerald-500"
                        >
                          {autopilotDecisionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                          Aprobar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={autopilotDecisionMutation.isPending || !snapshot.latestAutopilotProductHunterRun.winnerProductId}
                          onClick={() => autopilotDecisionMutation.mutate("needs_changes")}
                          variant="outline"
                          className="border-amber-400/40 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20"
                        >
                          <ClipboardList className="mr-2 h-4 w-4" />
                          Cambios
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={autopilotDecisionMutation.isPending || !snapshot.latestAutopilotProductHunterRun.winnerProductId}
                          onClick={() => autopilotDecisionMutation.mutate("rejected")}
                          variant="outline"
                          className="border-red-400/40 bg-red-400/10 text-red-100 hover:bg-red-400/20"
                        >
                          <CircleX className="mr-2 h-4 w-4" />
                          Rechazar
                        </Button>
                      </div>
                      {autopilotDecisionResult && (
                        <p className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-300">{autopilotDecisionResult}</p>
                      )}
                    </div>
                    <div className="rounded-lg border border-emerald-400/20 bg-black p-3">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Ranking y approvals</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        {snapshot.latestAutopilotProductHunterRun.rankedCandidates.slice(0, 4).map((candidate) => (
                          <div key={candidate.candidateId} className="rounded-md border border-zinc-800 bg-zinc-950 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-white">#{candidate.rank} {candidate.candidateName}</p>
                              <Badge variant="outline" className={cn("shrink-0", statusTone(candidate.confidence))}>{candidate.confidence}</Badge>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">{candidate.reason}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {snapshot.latestAutopilotProductHunterRun.approvalRequired.map((approval) => (
                          <Badge key={`${snapshot.latestAutopilotProductHunterRun?.id}-${approval.actionType}`} variant="outline" className="border-amber-400/40 bg-amber-400/10 text-amber-100">
                            {approval.actionType.replace("dropshipping.", "")} {approval.maxSpendUsd ? money.format(approval.maxSpendUsd) : ""}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><PackageSearch className="h-4 w-4" /> Product Scout</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="mb-4 space-y-3 rounded-lg border border-zinc-800 bg-black p-3" onSubmit={(event) => submit(event, () => scoutBatchMutation.mutate())}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">Auto scout</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">Crea candidatos iniciales sin gastar ni publicar.</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 border-zinc-700 text-zinc-300">{snapshot.metrics.productScoutCandidates} candidatos</Badge>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <select value={scoutBatchForm.focusNiche} onChange={(event) => setScoutBatchForm({ ...scoutBatchForm, focusNiche: event.target.value })} className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm">
                        <option value="mixed">Mixed</option>
                        <option value="home_problem_solvers">Home problem solvers</option>
                        <option value="kitchen_organization">Kitchen organization</option>
                        <option value="car_accessories">Car accessories</option>
                        <option value="pet_supplies">Pet supplies</option>
                        <option value="beauty_low_claims">Beauty low-claims</option>
                      </select>
                      <Input type="number" min={1} max={8} value={scoutBatchForm.maxCandidates} onChange={(event) => setScoutBatchForm({ ...scoutBatchForm, maxCandidates: Number(event.target.value) })} className="border-zinc-800 bg-zinc-950" />
                      <Input type="number" min={0} value={scoutBatchForm.budgetUsd} onChange={(event) => setScoutBatchForm({ ...scoutBatchForm, budgetUsd: Number(event.target.value) })} className="border-zinc-800 bg-zinc-950" />
                      <Button type="submit" disabled={scoutBatchMutation.isPending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                        {scoutBatchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageSearch className="mr-2 h-4 w-4" />}
                        Run Product Scout
                      </Button>
                    </div>
                  </form>
                  <form className="space-y-3" onSubmit={(event) => submit(event, () => productMutation.mutate())}>
                    <div className="space-y-1">
                      <FieldLabel>Producto</FieldLabel>
                      <Input value={productForm.productName} onChange={(event) => setProductForm({ ...productForm, productName: event.target.value })} className="border-zinc-800 bg-black" />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <FieldLabel>Costo</FieldLabel>
                        <Input type="number" min={0} value={productForm.productCostUsd} onChange={(event) => setProductForm({ ...productForm, productCostUsd: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      </div>
                      <div className="space-y-1">
                        <FieldLabel>Shipping</FieldLabel>
                        <Input type="number" min={0} value={productForm.shippingCostUsd} onChange={(event) => setProductForm({ ...productForm, shippingCostUsd: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      </div>
                      <div className="space-y-1">
                        <FieldLabel>Precio venta</FieldLabel>
                        <Input type="number" min={1} value={productForm.targetSellPriceUsd} onChange={(event) => setProductForm({ ...productForm, targetSellPriceUsd: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      </div>
                      <div className="space-y-1">
                        <FieldLabel>Shipping max dias</FieldLabel>
                        <Input type="number" min={1} value={productForm.shippingDaysMax} onChange={(event) => setProductForm({ ...productForm, shippingDaysMax: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <FieldLabel>Riesgo legal</FieldLabel>
                        <select value={productForm.legalRisk} onChange={(event) => setProductForm({ ...productForm, legalRisk: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <FieldLabel>Riesgo calidad</FieldLabel>
                        <select value={productForm.qualityRisk} onChange={(event) => setProductForm({ ...productForm, qualityRisk: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                      </div>
                    </div>
                    <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                      <input type="checkbox" checked={productForm.requiresSample} onChange={(event) => setProductForm({ ...productForm, requiresSample: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                      Requiere sample antes de escalar
                    </label>
                    <div className="space-y-1">
                      <FieldLabel>Evidencia</FieldLabel>
                      <Textarea value={productForm.evidence} onChange={(event) => setProductForm({ ...productForm, evidence: event.target.value })} className="min-h-24 border-zinc-800 bg-black" />
                    </div>
                    <Button type="submit" disabled={productMutation.isPending} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                      {productMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      Investigar producto
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {snapshot.recentProductScoutCandidates.length > 0 && (
                  <Card className="border-zinc-800 bg-zinc-900/80">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base"><PackageSearch className="h-4 w-4" /> Shortlist Product Scout</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {snapshot.recentProductScoutCandidates.map((candidate) => (
                        <div key={candidate.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="font-medium text-white">{candidate.candidateName}</p>
                              <p className="mt-1 text-xs leading-5 text-zinc-500">{candidate.problemSolved}</p>
                              <p className="mt-1 text-xs leading-5 text-zinc-400">{candidate.contentAngle}</p>
                            </div>
                            <Badge variant="outline" className={cn("shrink-0", statusTone(candidate.status))}>{candidate.status}</Badge>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-4">
                            <Metric label="Score" value={`${candidate.scorecard.grade} ${candidate.scorecard.total}`} />
                            <Metric label="Margen" value={`${candidate.economics.grossMarginPercent}%`} />
                            <Metric label="Profit/unidad" value={money.format(candidate.economics.grossProfitUsd)} />
                            <Metric label="Demand" value={candidate.demandSignal} />
                          </div>
                          <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
                            <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Validacion externa</p>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline" className={cn("shrink-0", statusTone(candidate.validation.status))}>{candidate.validation.status}</Badge>
                                <Badge variant="outline" className={cn("shrink-0", statusTone(candidate.validation.confidence))}>{candidate.validation.confidence}</Badge>
                              </div>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                              {candidate.validation.evidence.slice(0, 4).map((evidence) => (
                                <a key={`${candidate.id}-${evidence.source}`} href={evidence.url} target="_blank" rel="noreferrer" className="rounded border border-zinc-800 bg-black p-2 text-xs leading-5 text-zinc-400 hover:border-emerald-400/40 hover:text-emerald-100">
                                  <span className="block font-medium text-zinc-200">{evidence.label}</span>
                                  {evidence.signal}
                                </a>
                              ))}
                            </div>
                          </div>
                          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <p className="text-xs leading-5 text-zinc-500">{candidate.sourceLabel || candidate.sourceUrl || "manual source"}</p>
                            <Button
                              type="button"
                              size="sm"
                              disabled={candidate.status === "rejected" || candidate.status === "promoted" || scoutPromoteMutation.isPending}
                              onClick={() => scoutPromoteMutation.mutate(candidate.id)}
                              className="bg-emerald-600 text-white hover:bg-emerald-500"
                            >
                              {scoutPromoteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                              Promover
                            </Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
                {snapshot.recentProducts.length === 0 ? (
                  <Card className="border-dashed border-zinc-800 bg-zinc-900/60">
                    <CardContent className="flex min-h-64 items-center justify-center p-6 text-center text-sm text-zinc-500">
                      Dropshipping CEO esta listo para investigar el primer producto viral.
                    </CardContent>
                  </Card>
                ) : snapshot.recentProducts.map((product) => (
                  <Card key={product.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-medium text-white">{product.productName}</p>
                          <p className="mt-1 text-sm text-zinc-500">{product.evidence}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(product.status))}>{product.status}</Badge>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <Metric label="Margen" value={`${product.economics.grossMarginPercent}%`} />
                        <Metric label="Profit/unidad" value={money.format(product.economics.grossProfitUsd)} />
                        <Metric label="Score" value={`${product.scorecard.grade} ${product.scorecard.total}`} />
                        <Metric label="Ordenes meta" value={String(product.economics.ordersNeededForTargetRevenue)} />
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-2">
                        {product.subagentReviews.map((review) => (
                          <div key={`${product.id}-${review.agent}`} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-white">{review.agent}</p>
                              <Badge variant="outline" className={cn("shrink-0", statusTone(review.verdict))}>{review.verdict}</Badge>
                            </div>
                            <p className="text-xs leading-5 text-zinc-500">{review.note}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="suppliers" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4" /> Supplier Analyst</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => submit(event, () => supplierMutation.mutate())}>
                    <Input value={supplierForm.supplierName} onChange={(event) => setSupplierForm({ ...supplierForm, supplierName: event.target.value })} className="border-zinc-800 bg-black" />
                    <Input value={supplierForm.productName} onChange={(event) => setSupplierForm({ ...supplierForm, productName: event.target.value })} className="border-zinc-800 bg-black" />
                    <div className="grid gap-3 md:grid-cols-3">
                      <Input type="number" min={0} max={5} value={supplierForm.rating} onChange={(event) => setSupplierForm({ ...supplierForm, rating: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      <Input type="number" min={0} value={supplierForm.reviewCount} onChange={(event) => setSupplierForm({ ...supplierForm, reviewCount: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      <Input type="number" min={1} value={supplierForm.estimatedShippingDays} onChange={(event) => setSupplierForm({ ...supplierForm, estimatedShippingDays: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                    </div>
                    <div className="grid gap-2">
                      {[
                        ["hasTracking", "Tiene tracking"],
                        ["hasReturns", "Tiene returns"],
                        ["hasMultipleSuppliers", "Hay proveedor backup"],
                      ].map(([key, label]) => (
                        <label key={key} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                          <input
                            type="checkbox"
                            checked={Boolean(supplierForm[key as keyof typeof supplierForm])}
                            onChange={(event) => setSupplierForm({ ...supplierForm, [key]: event.target.checked })}
                            className="h-4 w-4 accent-emerald-500"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <Button type="submit" disabled={supplierMutation.isPending} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                      {supplierMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                      Revisar supplier
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {snapshot.recentSuppliers.map((supplier) => (
                  <Card key={supplier.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{supplier.supplierName}</p>
                          <p className="mt-1 text-sm text-zinc-500">{supplier.productName} / {supplier.platform}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(supplier.status))}>{supplier.status}</Badge>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <Metric label="Score" value={String(supplier.score)} />
                        <Metric label="Riesgos" value={supplier.riskFlags.length ? supplier.riskFlags.join(", ") : "sin flags"} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="launch" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Rocket className="h-4 w-4" /> Launch draft</CardTitle></CardHeader>
                <CardContent>
                  <form className="mb-4 space-y-3 rounded-lg border border-zinc-800 bg-black p-3" onSubmit={(event) => submit(event, () => launchPackMutation.mutate())}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">CEO launch pack</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">Prepara launch, campana, posts, Shopify preflight y capital plan sin gastar.</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 border-zinc-700 text-zinc-300">{snapshot.metrics.launchPacks} packs</Badge>
                    </div>
                    <select value={launchPackForm.productId || bestProduct?.id || ""} onChange={(event) => setLaunchPackForm({ ...launchPackForm, productId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm">
                      <option value="">Mejor producto disponible</option>
                      {snapshot.recentProducts.map((product) => <option key={product.id} value={product.id}>{product.productName}</option>)}
                    </select>
                    <div className="grid gap-3 md:grid-cols-3">
                      <select value={launchPackForm.mode} onChange={(event) => setLaunchPackForm({ ...launchPackForm, mode: event.target.value })} className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm">
                        <option value="starter_validation">Starter validation</option>
                        <option value="organic_launch">Organic launch</option>
                        <option value="scale_candidate">Scale candidate</option>
                      </select>
                      <Input type="number" min={1} value={launchPackForm.dailyOrganicPosts} onChange={(event) => setLaunchPackForm({ ...launchPackForm, dailyOrganicPosts: Number(event.target.value) })} className="border-zinc-800 bg-zinc-950" />
                      <Input type="number" min={0} value={launchPackForm.requestedBudgetUsd} onChange={(event) => setLaunchPackForm({ ...launchPackForm, requestedBudgetUsd: Number(event.target.value) })} className="border-zinc-800 bg-zinc-950" />
                    </div>
                    <div className="grid gap-2">
                      {[
                        ["approvalToPrepareDraft", "Preparar Shopify draft si hay credenciales"],
                        ["approvalToPublish", "Robert aprobo publicar posts"],
                        ["approvalToSpend", "Robert aprobo preparar gasto"],
                      ].map(([key, label]) => (
                        <label key={key} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300">
                          <input
                            type="checkbox"
                            checked={Boolean(launchPackForm[key as keyof typeof launchPackForm])}
                            onChange={(event) => setLaunchPackForm({ ...launchPackForm, [key]: event.target.checked })}
                            className="h-4 w-4 accent-emerald-500"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <Button type="submit" disabled={launchPackMutation.isPending || snapshot.recentProducts.length === 0} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                      {launchPackMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                      Build launch pack
                    </Button>
                  </form>
                  <form className="space-y-3" onSubmit={(event) => submit(event, () => launchMutation.mutate())}>
                    <select value={launchForm.productId || bestProduct?.id || ""} onChange={(event) => setLaunchForm({ ...launchForm, productId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                      <option value="">Seleccionar producto</option>
                      {snapshot.recentProducts.map((product) => <option key={product.id} value={product.id}>{product.productName}</option>)}
                    </select>
                    <Input type="number" min={0} value={launchForm.dailyOrganicPosts} onChange={(event) => setLaunchForm({ ...launchForm, dailyOrganicPosts: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                    <Input type="number" min={0} value={launchForm.paidAdTestBudgetUsd} onChange={(event) => setLaunchForm({ ...launchForm, paidAdTestBudgetUsd: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                    {[
                      ["approvalToPublish", "Robert aprobo publicar"],
                      ["approvalToSpend", "Robert aprobo gastar"],
                      ["approvalToOrderSample", "Robert aprobo sample"],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                        <input
                          type="checkbox"
                          checked={Boolean(launchForm[key as keyof typeof launchForm])}
                          onChange={(event) => setLaunchForm({ ...launchForm, [key]: event.target.checked })}
                          className="h-4 w-4 accent-emerald-500"
                        />
                        {label}
                      </label>
                    ))}
                    <Button type="submit" disabled={launchMutation.isPending || snapshot.recentProducts.length === 0} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                      {launchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                      Crear launch plan
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {snapshot.recentLaunchPacks.length > 0 && (
                  <Card className="border-zinc-800 bg-zinc-900/80">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base"><Rocket className="h-4 w-4" /> Launch packs</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {snapshot.recentLaunchPacks.slice(0, 3).map((pack) => (
                        <div key={pack.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="font-medium text-white">{pack.product?.productName || "sin producto"} / {pack.mode}</p>
                              <p className="mt-1 text-xs leading-5 text-zinc-500">{pack.boardMemo}</p>
                            </div>
                            <Badge variant="outline" className={cn("shrink-0", statusTone(pack.status))}>{pack.status}</Badge>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-4">
                            <Metric label="Posts" value={String(pack.socialPosts.length)} />
                            <Metric label="Shopify" value={pack.shopifyPreflight?.status || "none"} />
                            <Metric label="Capital" value={pack.capitalPlan?.status || "none"} />
                            <Metric label="Gasto" value={money.format(pack.safety.spentUsd)} />
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {pack.launchChecklist.slice(0, 4).map((item) => (
                              <div key={`${pack.id}-${item.owner}-${item.item}`} className="rounded-md border border-zinc-800 bg-zinc-950 p-2">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <p className="text-xs font-medium text-white">{item.owner}</p>
                                  <Badge variant="outline" className={cn("shrink-0", statusTone(item.status))}>{item.status}</Badge>
                                </div>
                                <p className="text-xs leading-5 text-zinc-500">{item.item}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <p className="text-xs leading-5 text-zinc-500">Crea pending approvals auditados. Spend y sample quedan fuera por defecto.</p>
                            <Button
                              type="button"
                              size="sm"
                              disabled={launchPackApprovalsMutation.isPending || pack.approvalsRequired.length === 0}
                              onClick={() => launchPackApprovalsMutation.mutate(pack.id)}
                              className="bg-emerald-600 text-white hover:bg-emerald-500"
                            >
                              {launchPackApprovalsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                              Queue approvals
                            </Button>
                          </div>
                          {approvalQueueResult && (
                            <p className="mt-2 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs leading-5 text-emerald-100">{approvalQueueResult}</p>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
                {snapshot.recentLaunchPlans.map((plan) => (
                  <Card key={plan.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{plan.product?.productName || plan.productId}</p>
                          <p className="mt-1 text-sm text-zinc-500">{plan.storeChannel} / {plan.dailyOrganicPosts} posts organicos diarios</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(plan.status))}>{plan.status}</Badge>
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-2">
                        {plan.contentCalendar.map((item) => (
                          <div key={`${plan.id}-${item.day}`} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-sm font-medium text-white">{item.day} / {item.channel}</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">{item.hook}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="campaigns" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Megaphone className="h-4 w-4" /> Marketing lab</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => submit(event, () => campaignMutation.mutate())}>
                    <select value={campaignForm.productId || bestProduct?.id || ""} onChange={(event) => setCampaignForm({ ...campaignForm, productId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                      <option value="">Seleccionar producto</option>
                      {snapshot.recentProducts.map((product) => <option key={product.id} value={product.id}>{product.productName}</option>)}
                    </select>
                    <Input value={campaignForm.campaignName} onChange={(event) => setCampaignForm({ ...campaignForm, campaignName: event.target.value })} className="border-zinc-800 bg-black" />
                    <div className="grid gap-3 md:grid-cols-2">
                      <select value={campaignForm.channel} onChange={(event) => setCampaignForm({ ...campaignForm, channel: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                        <option value="tiktok">TikTok</option>
                        <option value="instagram">Instagram</option>
                        <option value="facebook_ads">Facebook Ads</option>
                        <option value="google_shopping">Google Shopping</option>
                        <option value="email">Email</option>
                        <option value="shopify_seo">Shopify SEO</option>
                        <option value="manual">Manual</option>
                      </select>
                      <select value={campaignForm.objective} onChange={(event) => setCampaignForm({ ...campaignForm, objective: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                        <option value="validate_product">Validar producto</option>
                        <option value="organic_reach">Organic reach</option>
                        <option value="collect_sales">Collect sales</option>
                        <option value="retarget">Retarget</option>
                        <option value="scale_winner">Scale winner</option>
                      </select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input type="number" min={0} value={campaignForm.dailyOrganicPosts} onChange={(event) => setCampaignForm({ ...campaignForm, dailyOrganicPosts: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      <Input type="number" min={0} value={campaignForm.paidTestBudgetUsd} onChange={(event) => setCampaignForm({ ...campaignForm, paidTestBudgetUsd: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                    </div>
                    <Textarea value={campaignForm.targetAudience} onChange={(event) => setCampaignForm({ ...campaignForm, targetAudience: event.target.value })} className="min-h-20 border-zinc-800 bg-black" />
                    <Textarea value={campaignForm.primaryHook} onChange={(event) => setCampaignForm({ ...campaignForm, primaryHook: event.target.value })} className="min-h-20 border-zinc-800 bg-black" />
                    <Input value={campaignForm.offer} onChange={(event) => setCampaignForm({ ...campaignForm, offer: event.target.value })} className="border-zinc-800 bg-black" />
                    {[
                      ["approvalToPublish", "Robert aprobo publicar"],
                      ["approvalToSpend", "Robert aprobo gastar"],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                        <input
                          type="checkbox"
                          checked={Boolean(campaignForm[key as keyof typeof campaignForm])}
                          onChange={(event) => setCampaignForm({ ...campaignForm, [key]: event.target.checked })}
                          className="h-4 w-4 accent-emerald-500"
                        />
                        {label}
                      </label>
                    ))}
                    <Button type="submit" disabled={campaignMutation.isPending || snapshot.recentProducts.length === 0} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                      {campaignMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Megaphone className="mr-2 h-4 w-4" />}
                      Crear campana
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {snapshot.recentMarketingCampaigns.map((campaign) => (
                  <Card key={campaign.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-medium text-white">{campaign.campaignName}</p>
                          <p className="mt-1 text-sm text-zinc-500">{campaign.channel} / {campaign.objective} / {campaign.targetAudience}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(campaign.status))}>{campaign.status}</Badge>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <Metric label="Gasto pedido" value={money.format(campaign.budgetPlan.requestedSpendUsd)} />
                        <Metric label="Break-even" value={campaign.budgetPlan.breakEvenOrders === null ? "organic" : `${campaign.budgetPlan.breakEvenOrders} ordenes`} />
                        <Metric label="Posts/dia" value={String(campaign.dailyOrganicPosts)} />
                      </div>
                      <div className="mt-4 rounded-lg border border-zinc-800 bg-black p-3">
                        <p className="text-sm font-medium text-white">{campaign.creativeBrief.productPromise}</p>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {campaign.socialDrafts.slice(0, 4).map((draft) => (
                            <div key={`${campaign.id}-${draft.day}-${draft.channel}`} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{draft.day} / {draft.channel}</p>
                              <p className="mt-1 text-sm text-zinc-200">{draft.hook}</p>
                              <p className="mt-2 text-xs leading-5 text-zinc-500">{draft.caption}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {campaign.requiredApprovals.map((approval) => <Badge key={approval} variant="outline" className="border-amber-400/40 bg-amber-400/10 text-amber-100">{approval}</Badge>)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="social" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <div className="space-y-4">
                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" /> Social Marketing Manager</CardTitle></CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={(event) => submit(event, () => socialBatchMutation.mutate())}>
                      <FieldLabel>Campana</FieldLabel>
                      <select value={socialBatchForm.campaignId || selectedCampaignOptions[0]?.id || ""} onChange={(event) => setSocialBatchForm({ ...socialBatchForm, campaignId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                        <option value="">Seleccionar campana</option>
                        {selectedCampaignOptions.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>)}
                      </select>
                      <div className="grid gap-2 md:grid-cols-2">
                        {socialPlatformOptions.map((platform) => (
                          <label key={platform.value} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                            <input type="checkbox" checked={socialBatchForm.platforms.includes(platform.value)} onChange={() => toggleSocialPlatform(platform.value)} className="h-4 w-4 accent-emerald-500" />
                            {platform.label}
                          </label>
                        ))}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <FieldLabel>Posts/canal</FieldLabel>
                          <Input type="number" min={1} value={socialBatchForm.postsPerPlatform} onChange={(event) => setSocialBatchForm({ ...socialBatchForm, postsPerPlatform: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                        </div>
                        <div className="space-y-1">
                          <FieldLabel>Fecha</FieldLabel>
                          <Input value={socialBatchForm.scheduledDate} onChange={(event) => setSocialBatchForm({ ...socialBatchForm, scheduledDate: event.target.value })} placeholder="opcional" className="border-zinc-800 bg-black" />
                        </div>
                      </div>
                      <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                        <input type="checkbox" checked={socialBatchForm.approvalToPublish} onChange={(event) => setSocialBatchForm({ ...socialBatchForm, approvalToPublish: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                        Robert aprobo poner estos posts en cola de publicacion
                      </label>
                      <Button type="submit" disabled={socialBatchMutation.isPending || selectedCampaignOptions.length === 0} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                        {socialBatchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Megaphone className="mr-2 h-4 w-4" />}
                        Crear posts
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4" /> Publicacion segura</CardTitle></CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={(event) => submit(event, () => socialPublishMutation.mutate())}>
                      <select value={socialPublishForm.postId || selectedPostOptions[0]?.id || ""} onChange={(event) => setSocialPublishForm({ ...socialPublishForm, postId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                        <option value="">Seleccionar post</option>
                        {selectedPostOptions.map((post) => <option key={post.id} value={post.id}>{post.platform} / {post.hook.slice(0, 60)}</option>)}
                      </select>
                      <Input value={socialPublishForm.externalPostUrl} onChange={(event) => setSocialPublishForm({ ...socialPublishForm, externalPostUrl: event.target.value })} placeholder="URL manual si ya fue publicado" className="border-zinc-800 bg-black" />
                      <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                        <input type="checkbox" checked={socialPublishForm.approvalToPublish} onChange={(event) => setSocialPublishForm({ ...socialPublishForm, approvalToPublish: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                        Robert aprobo publicar este post
                      </label>
                      <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                        <input type="checkbox" checked={socialPublishForm.dryRun} onChange={(event) => setSocialPublishForm({ ...socialPublishForm, dryRun: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                        Dry run / solo cola
                      </label>
                      <Button type="submit" disabled={socialPublishMutation.isPending || selectedPostOptions.length === 0} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                        {socialPublishMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Preparar publicacion
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" /> Metricas y analisis</CardTitle></CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={(event) => submit(event, () => socialMetricsMutation.mutate())}>
                      <select value={socialMetricsForm.postId || selectedPostOptions[0]?.id || ""} onChange={(event) => setSocialMetricsForm({ ...socialMetricsForm, postId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                        <option value="">Seleccionar post</option>
                        {selectedPostOptions.map((post) => <option key={post.id} value={post.id}>{post.platform} / {post.hook.slice(0, 60)}</option>)}
                      </select>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Input type="number" min={0} value={socialMetricsForm.views} onChange={(event) => setSocialMetricsForm({ ...socialMetricsForm, views: Number(event.target.value) })} placeholder="views" className="border-zinc-800 bg-black" />
                        <Input type="number" min={0} value={socialMetricsForm.clicks} onChange={(event) => setSocialMetricsForm({ ...socialMetricsForm, clicks: Number(event.target.value) })} placeholder="clicks" className="border-zinc-800 bg-black" />
                        <Input type="number" min={0} value={socialMetricsForm.addToCarts} onChange={(event) => setSocialMetricsForm({ ...socialMetricsForm, addToCarts: Number(event.target.value) })} placeholder="add to carts" className="border-zinc-800 bg-black" />
                        <Input type="number" min={0} value={socialMetricsForm.orders} onChange={(event) => setSocialMetricsForm({ ...socialMetricsForm, orders: Number(event.target.value) })} placeholder="orders" className="border-zinc-800 bg-black" />
                        <Input type="number" min={0} value={socialMetricsForm.revenueUsd} onChange={(event) => setSocialMetricsForm({ ...socialMetricsForm, revenueUsd: Number(event.target.value) })} placeholder="revenue" className="border-zinc-800 bg-black" />
                        <Input type="number" min={0} value={socialMetricsForm.spendUsd} onChange={(event) => setSocialMetricsForm({ ...socialMetricsForm, spendUsd: Number(event.target.value) })} placeholder="spend" className="border-zinc-800 bg-black" />
                      </div>
                      <Textarea value={socialMetricsForm.notes} onChange={(event) => setSocialMetricsForm({ ...socialMetricsForm, notes: event.target.value })} placeholder="Notas de performance" className="min-h-20 border-zinc-800 bg-black" />
                      <div className="grid gap-3 md:grid-cols-2">
                        <Input value={socialAnalysisForm.periodLabel} onChange={(event) => setSocialAnalysisForm({ ...socialAnalysisForm, periodLabel: event.target.value })} className="border-zinc-800 bg-black" />
                        <select value={socialAnalysisForm.campaignId} onChange={(event) => setSocialAnalysisForm({ ...socialAnalysisForm, campaignId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                          <option value="">Analizar todo</option>
                          {selectedCampaignOptions.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>)}
                        </select>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <Button type="submit" disabled={socialMetricsMutation.isPending || selectedPostOptions.length === 0} className="bg-zinc-800 text-white hover:bg-zinc-700">
                          {socialMetricsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
                          Guardar metricas
                        </Button>
                        <Button type="button" onClick={() => socialAnalysisMutation.mutate()} disabled={socialAnalysisMutation.isPending} className="bg-emerald-600 text-white hover:bg-emerald-500">
                          {socialAnalysisMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                          Analizar
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-3">
                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardContent className="p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="font-medium text-white">Performance social</p>
                      <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.latestSocialAnalysis?.status || "needs_data"))}>{snapshot.latestSocialAnalysis?.status || "needs_data"}</Badge>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <Metric label="Posts" value={String(snapshot.metrics.socialPosts)} />
                      <Metric label="Publicados" value={String(snapshot.metrics.publishedSocialPosts)} />
                      <Metric label="Ordenes" value={String(snapshot.metrics.socialOrders)} />
                      <Metric label="Revenue" value={money.format(snapshot.metrics.socialRevenueUsd)} />
                    </div>
                    {snapshot.latestSocialAnalysis && (
                      <p className="mt-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-5 text-zinc-300">{snapshot.latestSocialAnalysis.summary}</p>
                    )}
                  </CardContent>
                </Card>

                {snapshot.recentSocialPosts.map((post) => (
                  <Card key={post.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-medium text-white">{post.platform} / {post.format}</p>
                          <p className="mt-1 text-sm text-zinc-500">{post.hook}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(post.status))}>{post.status}</Badge>
                      </div>
                      <p className="mt-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-5 text-zinc-300">{post.caption}</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-4">
                        <Metric label="Views" value={String(post.metricsSummary.views)} />
                        <Metric label="Clicks" value={String(post.metricsSummary.clicks)} />
                        <Metric label="Orders" value={String(post.metricsSummary.orders)} />
                        <Metric label="Profit" value={money.format(post.metricsSummary.profitUsd)} />
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-500">{post.guardrail.reason}</p>
                    </CardContent>
                  </Card>
                ))}

                {snapshot.recentSocialAnalyses.map((analysis) => (
                  <Card key={analysis.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{analysis.periodLabel}</p>
                          <p className="mt-1 text-sm text-zinc-500">{analysis.summary}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(analysis.status))}>{analysis.status}</Badge>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {analysis.nextPostRules.map((rule) => <p key={`${analysis.id}-${rule}`} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm leading-5 text-zinc-300">{rule}</p>)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="orders" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <div className="space-y-4">
                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShoppingBag className="h-4 w-4" /> Order Ops</CardTitle></CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={(event) => submit(event, () => orderMutation.mutate())}>
                      <div className="grid gap-3 md:grid-cols-2">
                        <select value={orderForm.source} onChange={(event) => setOrderForm({ ...orderForm, source: event.target.value as DropshippingOrderSource })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                          <option value="manual">Manual</option>
                          <option value="shopify">Shopify</option>
                          <option value="tiktok_shop">TikTok Shop</option>
                          <option value="social_dm">Social DM</option>
                          <option value="other">Other</option>
                        </select>
                        <Input value={orderForm.externalOrderId} onChange={(event) => setOrderForm({ ...orderForm, externalOrderId: event.target.value })} placeholder="Order ID externo" className="border-zinc-800 bg-black" />
                      </div>
                      <select
                        value={orderForm.productId || bestProduct?.id || ""}
                        onChange={(event) => {
                          const product = snapshot.recentProducts.find((item) => item.id === event.target.value);
                          setOrderForm({
                            ...orderForm,
                            productId: event.target.value,
                            productName: product?.productName || orderForm.productName,
                            productCostUsd: product?.economics.landedCostUsd || orderForm.productCostUsd,
                          });
                        }}
                        className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm"
                      >
                        <option value="">Orden manual sin producto</option>
                        {snapshot.recentProducts.map((product) => <option key={product.id} value={product.id}>{product.productName}</option>)}
                      </select>
                      <Input value={orderForm.productName} onChange={(event) => setOrderForm({ ...orderForm, productName: event.target.value })} className="border-zinc-800 bg-black" />
                      <div className="grid gap-3 md:grid-cols-2">
                        <Input value={orderForm.customerAlias} onChange={(event) => setOrderForm({ ...orderForm, customerAlias: event.target.value })} placeholder="Cliente / alias" className="border-zinc-800 bg-black" />
                        <select value={orderForm.paymentStatus} onChange={(event) => setOrderForm({ ...orderForm, paymentStatus: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                          <option value="paid">paid</option>
                          <option value="pending">pending</option>
                          <option value="refunded">refunded</option>
                          <option value="chargeback">chargeback</option>
                        </select>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Input type="number" min={1} value={orderForm.quantity} onChange={(event) => setOrderForm({ ...orderForm, quantity: Number(event.target.value) })} placeholder="qty" className="border-zinc-800 bg-black" />
                        <Input type="number" min={0} value={orderForm.saleSubtotalUsd} onChange={(event) => setOrderForm({ ...orderForm, saleSubtotalUsd: Number(event.target.value) })} placeholder="subtotal venta" className="border-zinc-800 bg-black" />
                        <Input type="number" min={0} value={orderForm.shippingChargedUsd} onChange={(event) => setOrderForm({ ...orderForm, shippingChargedUsd: Number(event.target.value) })} placeholder="shipping cobrado" className="border-zinc-800 bg-black" />
                        <Input type="number" min={0} value={orderForm.taxCollectedUsd} onChange={(event) => setOrderForm({ ...orderForm, taxCollectedUsd: Number(event.target.value) })} placeholder="tax cobrado" className="border-zinc-800 bg-black" />
                        <Input type="number" min={0} value={orderForm.productCostUsd} onChange={(event) => setOrderForm({ ...orderForm, productCostUsd: Number(event.target.value) })} placeholder="costo producto" className="border-zinc-800 bg-black" />
                        <Input type="number" min={0} value={orderForm.supplierShippingUsd} onChange={(event) => setOrderForm({ ...orderForm, supplierShippingUsd: Number(event.target.value) })} placeholder="shipping supplier" className="border-zinc-800 bg-black" />
                      </div>
                      <Textarea value={orderForm.notes} onChange={(event) => setOrderForm({ ...orderForm, notes: event.target.value })} placeholder="Notas internas" className="min-h-20 border-zinc-800 bg-black" />
                      <Button type="submit" disabled={orderMutation.isPending} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                        {orderMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShoppingBag className="mr-2 h-4 w-4" />}
                        Registrar orden
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4" /> Fulfillment</CardTitle></CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={(event) => submit(event, () => fulfillmentMutation.mutate())}>
                      <select value={fulfillmentForm.orderId || selectedOrderOptions[0]?.id || ""} onChange={(event) => setFulfillmentForm({ ...fulfillmentForm, orderId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                        <option value="">Seleccionar orden</option>
                        {selectedOrderOptions.map((order) => <option key={order.id} value={order.id}>{order.productName} / {money.format(order.grossRevenueUsd)}</option>)}
                      </select>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Input value={fulfillmentForm.supplierName} onChange={(event) => setFulfillmentForm({ ...fulfillmentForm, supplierName: event.target.value })} className="border-zinc-800 bg-black" />
                        <select value={fulfillmentForm.supplierPlatform} onChange={(event) => setFulfillmentForm({ ...fulfillmentForm, supplierPlatform: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                          <option value="aliexpress">AliExpress</option>
                          <option value="cj_dropshipping">CJ Dropshipping</option>
                          <option value="dsers">DSers</option>
                          <option value="zendrop">Zendrop</option>
                          <option value="spocket">Spocket</option>
                          <option value="manual">Manual</option>
                        </select>
                        <Input value={fulfillmentForm.supplierOrderId} onChange={(event) => setFulfillmentForm({ ...fulfillmentForm, supplierOrderId: event.target.value })} placeholder="Supplier order ID" className="border-zinc-800 bg-black" />
                        <Input value={fulfillmentForm.trackingNumber} onChange={(event) => setFulfillmentForm({ ...fulfillmentForm, trackingNumber: event.target.value })} placeholder="Tracking" className="border-zinc-800 bg-black" />
                      </div>
                      <Input value={fulfillmentForm.trackingUrl} onChange={(event) => setFulfillmentForm({ ...fulfillmentForm, trackingUrl: event.target.value })} placeholder="Tracking URL" className="border-zinc-800 bg-black" />
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                          <input type="checkbox" checked={fulfillmentForm.approvalToFulfill} onChange={(event) => setFulfillmentForm({ ...fulfillmentForm, approvalToFulfill: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                          Robert aprobo fulfillment
                        </label>
                        <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                          <input type="checkbox" checked={fulfillmentForm.dryRun} onChange={(event) => setFulfillmentForm({ ...fulfillmentForm, dryRun: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                          Dry run
                        </label>
                      </div>
                      <Textarea value={fulfillmentForm.notes} onChange={(event) => setFulfillmentForm({ ...fulfillmentForm, notes: event.target.value })} placeholder="Notas fulfillment" className="min-h-20 border-zinc-800 bg-black" />
                      <Button type="submit" disabled={fulfillmentMutation.isPending || selectedOrderOptions.length === 0} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                        {fulfillmentMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
                        Preparar fulfillment
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-3">
                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardContent className="p-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <Metric label="Ordenes" value={String(snapshot.metrics.orders)} />
                      <Metric label="Pagadas" value={String(snapshot.metrics.paidOrders)} />
                      <Metric label="Pendientes" value={String(snapshot.metrics.unfulfilledOrders)} />
                      <Metric label="Profit est." value={money.format(snapshot.metrics.orderProfitUsd)} />
                    </div>
                  </CardContent>
                </Card>

                {snapshot.recentOrders.map((order) => (
                  <Card key={order.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-medium text-white">{order.productName}</p>
                          <p className="mt-1 text-sm text-zinc-500">{order.source} / {order.externalOrderId || order.id}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(order.status))}>{order.status}</Badge>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <Metric label="Revenue" value={money.format(order.grossRevenueUsd)} />
                        <Metric label="Costo est." value={money.format(order.estimatedCostUsd)} />
                        <Metric label="Profit est." value={money.format(order.estimatedProfitUsd)} />
                        <Metric label="Margen" value={`${order.grossMarginPercent}%`} />
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {order.nextActions.map((action) => <p key={`${order.id}-${action}`} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm leading-5 text-zinc-300">{action}</p>)}
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {snapshot.recentFulfillmentActions.map((action) => (
                  <Card key={action.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-medium text-white">{action.order?.productName || action.orderId}</p>
                          <p className="mt-1 text-sm text-zinc-500">{action.supplierName} / {action.supplierPlatform}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(action.status))}>{action.status}</Badge>
                      </div>
                      <p className="mt-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-5 text-zinc-300">{action.guardrail.reason}</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <Metric label="Dry run" value={action.dryRun ? "si" : "no"} />
                        <Metric label="Approval" value={action.approvalToFulfill ? "si" : "no"} />
                        <Metric label="Costo" value={money.format(action.costImpactUsd)} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="capital" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BadgeDollarSign className="h-4 w-4" /> Capital allocator</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => submit(event, () => capitalMutation.mutate())}>
                    <select value={capitalForm.campaignId || selectedCampaignOptions[0]?.id || ""} onChange={(event) => setCapitalForm({ ...capitalForm, campaignId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                      <option value="">Usar campana foco</option>
                      {selectedCampaignOptions.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>)}
                    </select>
                    <div className="grid gap-3 md:grid-cols-2">
                      <select value={capitalForm.objective} onChange={(event) => setCapitalForm({ ...capitalForm, objective: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                        <option value="protect_cash">Proteger cash</option>
                        <option value="validate_winner">Validar ganador</option>
                        <option value="scale_winner">Escalar ganador</option>
                        <option value="retarget_customers">Retargeting</option>
                      </select>
                      <select value={capitalForm.requestedBudgetUsd} onChange={(event) => setCapitalForm({ ...capitalForm, requestedBudgetUsd: Number(event.target.value) })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                        <option value={100}>$100 starter</option>
                        <option value={250}>$250 validation</option>
                        <option value={500}>$500 growth</option>
                        <option value={1000}>$1,000 scale</option>
                      </select>
                    </div>
                    <Input type="number" min={0} value={capitalForm.requestedBudgetUsd} onChange={(event) => setCapitalForm({ ...capitalForm, requestedBudgetUsd: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                    <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                      <input type="checkbox" checked={capitalForm.approvalToPrepareLargeCampaign} onChange={(event) => setCapitalForm({ ...capitalForm, approvalToPrepareLargeCampaign: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                      Robert aprobo preparar el envelope de campana
                    </label>
                    <Textarea value={capitalForm.notes} onChange={(event) => setCapitalForm({ ...capitalForm, notes: event.target.value })} placeholder="Notas del CEO / condicion de escala" className="min-h-20 border-zinc-800 bg-black" />
                    <Button type="submit" disabled={capitalMutation.isPending} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                      {capitalMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeDollarSign className="mr-2 h-4 w-4" />}
                      Generar plan de capital
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <div className="space-y-3">
                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardContent className="p-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <Metric label="Stage" value={snapshot.budgetPolicy.stage} />
                      <Metric label="Budget activo" value={money.format(snapshot.budgetPolicy.activeMonthlyBudgetUsd)} />
                      <Metric label="Max test" value={money.format(snapshot.budgetPolicy.maxSingleTestUsd)} />
                      <Metric label="Can spend" value={money.format(snapshot.profitGuard.canSpendUsd)} />
                    </div>
                  </CardContent>
                </Card>

                {snapshot.recentCapitalPlans.map((plan) => (
                  <Card key={plan.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-medium text-white">{plan.objective} / {plan.activeStage}</p>
                          <p className="mt-1 text-sm text-zinc-500">{plan.product?.productName || plan.campaign?.campaignName || "sin producto foco"}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(plan.status))}>{plan.status}</Badge>
                      </div>
                      <p className="mt-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-5 text-zinc-300">{plan.boardMemo}</p>
                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <Metric label="Envelope" value={money.format(plan.requestedCampaignEnvelopeUsd)} />
                        <Metric label="Tramo inicial" value={money.format(plan.approvedInitialBudgetUsd)} />
                        <Metric label="Cash libre" value={money.format(plan.canSpendUsd)} />
                        <Metric label="Approvals" value={String(plan.metricsSnapshot.approvalQueue)} />
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-2">
                        {plan.allocation.map((item) => (
                          <div key={`${plan.id}-${item.channel}`} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-white">{item.channel}</p>
                                <p className="mt-1 text-xs text-zinc-500">{item.stage} / {money.format(item.budgetUsd)}</p>
                              </div>
                              <Badge variant="outline" className={cn("shrink-0", item.approvalRequired ? statusTone("approval_required") : statusTone("ready"))}>
                                {item.approvalRequired ? "approval" : "auto"}
                              </Badge>
                            </div>
                            <p className="text-xs leading-5 text-zinc-300">{item.purpose}</p>
                            <p className="mt-2 text-xs leading-5 text-zinc-500">{item.killSwitch}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {plan.nextActions.map((action) => <p key={`${plan.id}-${action}`} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-400">{action}</p>)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="execution" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
              <div className="space-y-4">
                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-3 text-base">
                      <span className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Launch readiness</span>
                      <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.launchReadiness.status))}>{snapshot.launchReadiness.status}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-5 text-zinc-300">{snapshot.launchReadiness.summary}</p>
                    <div className="mt-4 grid gap-2 md:grid-cols-4">
                      <Metric label="Budget inicial" value={money.format(snapshot.launchReadiness.budgetLimits.startingMonthlyBudgetUsd)} />
                      <Metric label="Cap diario" value={money.format(snapshot.launchReadiness.budgetLimits.dailySpendCapUsd)} />
                      <Metric label="Max test" value={money.format(snapshot.launchReadiness.budgetLimits.maxSingleTestUsd)} />
                      <Metric label="Puede gastar" value={money.format(snapshot.launchReadiness.budgetLimits.canSpendUsd)} />
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {[
                        { label: "Postgres / Trust Center", status: snapshot.launchReadiness.postgresTrustCenter.status, detail: snapshot.launchReadiness.postgresTrustCenter.nextAction },
                        { label: "Checkout real", status: snapshot.launchReadiness.checkout.status, detail: snapshot.launchReadiness.checkout.nextAction },
                        { label: "Producto / supplier", status: snapshot.launchReadiness.productSupplier.status, detail: snapshot.launchReadiness.productSupplier.nextAction },
                        { label: "Automatizacion", status: snapshot.launchReadiness.automation.status, detail: snapshot.launchReadiness.automation.nextAction },
                      ].map((item) => (
                        <div key={item.label} className="rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-white">{item.label}</p>
                            <Badge variant="outline" className={cn("shrink-0", statusTone(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="text-xs leading-5 text-zinc-500">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                    {snapshot.launchReadiness.hardBlocks.length > 0 && (
                      <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-100">Bloqueos antes de vender real</p>
                        <div className="grid gap-2 md:grid-cols-2">
                          {snapshot.launchReadiness.hardBlocks.map((item) => <p key={item} className="text-xs leading-5 text-amber-50">{item}</p>)}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-3 text-base">
                      <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Execution setup</span>
                      <Badge variant="outline" className={cn("shrink-0", statusTone(snapshot.executionSetup.status))}>{snapshot.executionSetup.status}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-5 text-zinc-300">{snapshot.executionSetup.summary}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {snapshot.executionSetup.connectors.map((connector) => (
                        <div key={connector.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-white">{connector.label}</p>
                              <p className="mt-1 text-xs text-zinc-500">{connector.ownerAgent} / {connector.mode}</p>
                            </div>
                            <Badge variant="outline" className={cn("shrink-0", statusTone(connector.status))}>{connector.status}</Badge>
                          </div>
                          <p className="text-xs leading-5 text-zinc-300">{connector.nextAction}</p>
                          <p className="mt-2 text-xs leading-5 text-zinc-500">{connector.approvalGate}</p>
                          {connector.missingEnv.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {connector.missingEnv.map((item) => <Badge key={`${connector.id}-${item}`} variant="outline" className="border-amber-400/40 bg-amber-400/10 text-amber-100">{item}</Badge>)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Rocket className="h-4 w-4" /> Launch sequence</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {snapshot.executionSetup.launchSequence.map((step) => (
                      <div key={step.step} className="rounded-lg border border-zinc-800 bg-black p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-white">{step.step}. {step.owner}</p>
                          <Badge variant="outline" className={cn("shrink-0", statusTone(step.blockedUntil.length ? "needs_setup" : "ready"))}>{step.mode}</Badge>
                        </div>
                        <p className="text-xs leading-5 text-zinc-300">{step.action}</p>
                        {step.blockedUntil.length > 0 && <p className="mt-2 text-xs text-amber-100">Falta: {step.blockedUntil.join(", ")}</p>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> Cuenta pendiente</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Se puede hacer sin cuentas</p>
                      <div className="space-y-2">
                        {snapshot.launchReadiness.canDoNow.slice(0, 4).map((item) => (
                          <p key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs leading-5 text-zinc-400">{item}</p>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Conectar para go-live</p>
                      <div className="space-y-2">
                        {snapshot.launchReadiness.requiresConnectedAccounts.slice(0, 5).map((item) => (
                          <p key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs leading-5 text-zinc-400">{item}</p>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="text-base">Checklist de activacion</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {snapshot.launchReadiness.tomorrowChecklist.map((item, index) => (
                      <div key={item} className="flex gap-3 rounded-md border border-zinc-800 bg-black px-3 py-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 text-xs text-zinc-300">{index + 1}</span>
                        <p className="text-xs leading-5 text-zinc-400">{item}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4" /> Supplier ops</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Metric label="Modo" value={snapshot.executionSetup.supplierOps.preferredMode} />
                      <Metric label="Fulfillment" value="por orden" />
                    </div>
                    <p className="mt-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-5 text-zinc-300">{snapshot.executionSetup.supplierOps.fulfillmentPolicy}</p>
                    <div className="mt-3 space-y-2">
                      {snapshot.executionSetup.supplierOps.requiredBeforeFirstOrder.map((item) => (
                        <p key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs leading-5 text-zinc-400">{item}</p>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileCheck2 className="h-4 w-4" /> Next approval</CardTitle></CardHeader>
                  <CardContent>
                    <p className="font-medium text-white">{snapshot.executionSetup.nextApprovalRequest.title}</p>
                    <p className="mt-2 text-sm leading-5 text-zinc-400">{snapshot.executionSetup.nextApprovalRequest.description}</p>
                    <Badge variant="outline" className="mt-3 border-amber-400/40 bg-amber-400/10 text-amber-100">{snapshot.executionSetup.nextApprovalRequest.actionType}</Badge>
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="text-base">Safe defaults</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {snapshot.executionSetup.safeDefaults.map((item) => (
                      <p key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs leading-5 text-zinc-400">{item}</p>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="shopify" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Store className="h-4 w-4" /> Shopify draft-only</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => submit(event, () => shopifyPreflightMutation.mutate())}>
                    <select value={shopifyForm.productId || bestProduct?.id || ""} onChange={(event) => setShopifyForm({ ...shopifyForm, productId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                      <option value="">Seleccionar producto</option>
                      {snapshot.recentProducts.map((product) => <option key={product.id} value={product.id}>{product.productName}</option>)}
                    </select>
                    <select value={shopifyForm.campaignId} onChange={(event) => setShopifyForm({ ...shopifyForm, campaignId: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                      <option value="">Sin campana asociada</option>
                      {snapshot.recentMarketingCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>)}
                    </select>
                    <Input value={shopifyForm.vendor} onChange={(event) => setShopifyForm({ ...shopifyForm, vendor: event.target.value })} className="border-zinc-800 bg-black" />
                    <Input value={shopifyForm.productType} onChange={(event) => setShopifyForm({ ...shopifyForm, productType: event.target.value })} className="border-zinc-800 bg-black" />
                    <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                      <input type="checkbox" checked={shopifyForm.approvalToCreateDraft} onChange={(event) => setShopifyForm({ ...shopifyForm, approvalToCreateDraft: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                      Robert aprobo crear draft externo en Shopify
                    </label>
                    <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                      <input type="checkbox" checked={shopifyForm.dryRun} onChange={(event) => setShopifyForm({ ...shopifyForm, dryRun: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                      Dry run sin tocar Shopify
                    </label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Button type="submit" disabled={shopifyPreflightMutation.isPending || snapshot.recentProducts.length === 0} className="bg-zinc-800 text-white hover:bg-zinc-700">
                        {shopifyPreflightMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                        Preflight
                      </Button>
                      <Button type="button" onClick={() => shopifyDraftMutation.mutate()} disabled={shopifyDraftMutation.isPending || snapshot.recentProducts.length === 0} className="bg-emerald-600 text-white hover:bg-emerald-500">
                        {shopifyDraftMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Store className="mr-2 h-4 w-4" />}
                        Crear draft
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {snapshot.recentShopifyDrafts.map((draft) => (
                  <Card key={draft.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-medium text-white">{draft.product?.productName || draft.productId}</p>
                          <p className="mt-1 text-sm text-zinc-500">{draft.shopifyProductId || "sin producto Shopify"} {draft.shopifyHandle ? `/ ${draft.shopifyHandle}` : ""}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(draft.status))}>{draft.status}</Badge>
                      </div>
                      <p className="mt-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-5 text-zinc-300">{draft.guardrail.reason}</p>
                      {draft.userErrors.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {draft.userErrors.map((error) => <p key={`${draft.id}-${error.message}`} className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-100">{error.message}</p>)}
                        </div>
                      )}
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        <Metric label="Dry run" value={draft.dryRun ? "si" : "no"} />
                        <Metric label="Approval" value={draft.approvalToCreateDraft ? "si" : "no"} />
                        <Metric label="Guardrail" value={draft.guardrail.status} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="cycles" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><PlayCircle className="h-4 w-4" /> CEO cycle</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => submit(event, () => cycleMutation.mutate())}>
                    <select value={cycleForm.mode} onChange={(event) => setCycleForm({ ...cycleForm, mode: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                      <option value="daily">Daily</option>
                      <option value="product_validation">Product validation</option>
                      <option value="scale_winner">Scale winner</option>
                    </select>
                    <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                      <input type="checkbox" checked={cycleForm.forcePaidTest} onChange={(event) => setCycleForm({ ...cycleForm, forcePaidTest: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                      Sugerir paid test si Profit Guard lo permite
                    </label>
                    <Button type="submit" disabled={cycleMutation.isPending} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                      {cycleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                      Ejecutar ciclo
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {snapshot.recentCeoCycles.map((cycle) => (
                  <Card key={cycle.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-medium text-white">{cycle.focus}</p>
                          <p className="mt-1 text-sm text-zinc-500">{cycle.summary}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(cycle.status))}>{cycle.status}</Badge>
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-3">
                        {cycle.commands.map((command) => (
                          <p key={`${cycle.id}-${command}`} className="rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-5 text-zinc-300">{command}</p>
                        ))}
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <Metric label="Approvals" value={String(cycle.metricsSnapshot.approvalQueue)} />
                        <Metric label="Can spend" value={money.format(cycle.metricsSnapshot.canSpendUsd)} />
                        <Metric label="Profit" value={money.format(cycle.metricsSnapshot.profitUsd)} />
                        <Metric label="Campanas" value={String(cycle.generatedCampaignIds.length)} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="ledger" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BadgeDollarSign className="h-4 w-4" /> Ledger</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => submit(event, () => ledgerMutation.mutate())}>
                    <select value={ledgerForm.kind} onChange={(event) => setLedgerForm({ ...ledgerForm, kind: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                      <option value="sale">sale</option>
                      <option value="expense">expense</option>
                      <option value="refund">refund</option>
                      <option value="sample_order">sample_order</option>
                    </select>
                    <Input value={ledgerForm.label} onChange={(event) => setLedgerForm({ ...ledgerForm, label: event.target.value })} className="border-zinc-800 bg-black" />
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input type="number" min={0} value={ledgerForm.amountUsd} onChange={(event) => setLedgerForm({ ...ledgerForm, amountUsd: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      <Input type="number" min={0} value={ledgerForm.cashCollectedUsd} onChange={(event) => setLedgerForm({ ...ledgerForm, cashCollectedUsd: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                    </div>
                    <Textarea value={ledgerForm.notes} onChange={(event) => setLedgerForm({ ...ledgerForm, notes: event.target.value })} className="min-h-20 border-zinc-800 bg-black" />
                    <Button type="submit" disabled={ledgerMutation.isPending} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                      {ledgerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="mr-2 h-4 w-4" />}
                      Guardar movimiento
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardContent className="space-y-3 p-4">
                  {snapshot.recentLedger.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{entry.label}</p>
                          <p className="mt-1 text-sm text-zinc-500">{entry.kind}</p>
                        </div>
                        <p className="text-sm font-semibold text-white">{money.format(entry.amountUsd)}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="learning" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" /> Learning Analyst</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(event) => submit(event, () => learningMutation.mutate())}>
                    <Input value={learningForm.periodLabel} onChange={(event) => setLearningForm({ ...learningForm, periodLabel: event.target.value })} className="border-zinc-800 bg-black" />
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input type="number" min={0} value={learningForm.postsPublished} onChange={(event) => setLearningForm({ ...learningForm, postsPublished: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      <Input type="number" min={0} value={learningForm.visitors} onChange={(event) => setLearningForm({ ...learningForm, visitors: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      <Input type="number" min={0} value={learningForm.addToCarts} onChange={(event) => setLearningForm({ ...learningForm, addToCarts: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      <Input type="number" min={0} value={learningForm.orders} onChange={(event) => setLearningForm({ ...learningForm, orders: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      <Input type="number" min={0} value={learningForm.revenueUsd} onChange={(event) => setLearningForm({ ...learningForm, revenueUsd: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                      <Input type="number" min={0} value={learningForm.spendUsd} onChange={(event) => setLearningForm({ ...learningForm, spendUsd: Number(event.target.value) })} className="border-zinc-800 bg-black" />
                    </div>
                    <Input value={learningForm.bestHook} onChange={(event) => setLearningForm({ ...learningForm, bestHook: event.target.value })} className="border-zinc-800 bg-black" />
                    <Textarea value={learningForm.notes} onChange={(event) => setLearningForm({ ...learningForm, notes: event.target.value })} className="min-h-20 border-zinc-800 bg-black" />
                    <Button type="submit" disabled={learningMutation.isPending} className="w-full bg-emerald-600 text-white hover:bg-emerald-500">
                      {learningMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      Guardar learning review
                    </Button>
                  </form>
                </CardContent>
              </Card>
              <div className="space-y-3">
                {snapshot.recentLearningReviews.map((review) => (
                  <Card key={review.id} className="border-zinc-800 bg-zinc-900/80">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{review.periodLabel}</p>
                          <p className="mt-1 text-sm text-zinc-500">Profit {money.format(review.metrics.profitUsd)} / ROI {review.metrics.roiPercent}%</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(review.decisionStatus))}>{review.decisionStatus}</Badge>
                      </div>
                      <div className="mt-3 space-y-2">
                        {review.playbookUpdates.map((item) => <p key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">{item}</p>)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="approvals" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
              <div className="space-y-4">
                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileCheck2 className="h-4 w-4" /> Crear approval</CardTitle></CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={(event) => submit(event, () => approvalMutation.mutate())}>
                      <select value={approvalForm.actionType} onChange={(event) => setApprovalForm({ ...approvalForm, actionType: event.target.value })} className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm">
                        <option value="dropshipping.order_sample">ordenar sample</option>
                        <option value="dropshipping.spend">gastar dinero</option>
                        <option value="dropshipping.create_shopify_draft">crear draft Shopify</option>
                        <option value="dropshipping.publish_product">publicar producto</option>
                        <option value="dropshipping.publish_social">publicar social</option>
                        <option value="dropshipping.contact_supplier">contactar supplier</option>
                        <option value="dropshipping.fulfill_order">fulfill orden</option>
                      </select>
                      <Input value={approvalForm.resourceId} onChange={(event) => setApprovalForm({ ...approvalForm, resourceId: event.target.value })} className="border-zinc-800 bg-black" />
                      <Input value={approvalForm.title} onChange={(event) => setApprovalForm({ ...approvalForm, title: event.target.value })} className="border-zinc-800 bg-black" />
                      <Textarea value={approvalForm.description} onChange={(event) => setApprovalForm({ ...approvalForm, description: event.target.value })} className="min-h-24 border-zinc-800 bg-black" />
                      <Button type="submit" disabled={approvalMutation.isPending} className="w-full bg-amber-600 text-white hover:bg-amber-500">
                        {approvalMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
                        Enviar a approvals
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-900/80">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Migrar outbox local</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Metric label="Pending local" value={String(snapshot.metrics.localApprovalOutbox)} />
                      <Metric label="Trust Center" value={snapshot.executionSetup.connectors.find((connector) => connector.id === "approvals")?.status || "ready"} />
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Button type="button" onClick={() => outboxMigrationMutation.mutate(true)} disabled={outboxMigrationMutation.isPending || snapshot.metrics.localApprovalOutbox === 0} className="bg-zinc-800 text-white hover:bg-zinc-700">
                        {outboxMigrationMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardList className="mr-2 h-4 w-4" />}
                        Revisar
                      </Button>
                      <Button type="button" onClick={() => outboxMigrationMutation.mutate(false)} disabled={outboxMigrationMutation.isPending || snapshot.metrics.localApprovalOutbox === 0} className="bg-emerald-600 text-white hover:bg-emerald-500">
                        {outboxMigrationMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                        Migrar
                      </Button>
                    </div>
                    {outboxMigrationResult && (
                      <p className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs leading-5 text-emerald-100">{outboxMigrationResult}</p>
                    )}
                    <div className="space-y-2">
                      {snapshot.recentApprovalOutbox.map((item) => (
                        <div key={item.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-white">{item.title}</p>
                            <Badge variant="outline" className={cn("shrink-0", statusTone(item.status))}>{item.status}</Badge>
                          </div>
                          <p className="text-xs leading-5 text-zinc-500">{item.actionType}</p>
                          {item.trustCenterPendingActionId && <p className="mt-1 text-xs text-emerald-100">Trust Center: {item.trustCenterPendingActionId}</p>}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
              <Card className="border-zinc-800 bg-zinc-900/80">
                <CardContent className="space-y-3 p-4">
                  {snapshot.recentApprovals.map((approval) => (
                    <div key={approval.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{approval.approvedAction}</p>
                          <p className="mt-1 text-sm text-zinc-500">{approval.targetType} / max {money.format(approval.maxSpendUsd)}</p>
                        </div>
                        <Badge variant="outline" className={cn("shrink-0", statusTone(approval.guardrail.status))}>{approval.guardrail.status}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{approval.guardrail.reason}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-black p-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
