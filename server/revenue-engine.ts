import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { hasRealValue, hasStrongSecret } from "./ceo-doctor-cli";
import { resolveDatabaseConnectionString } from "./database-url";
import { createRevenueEngineStateStore, type RevenueEngineStateAdapter, type RevenueEngineStateCollection, type RevenueEngineStateStore } from "./revenue-engine-state-store";

const REVENUE_WEBSITE_MIN_USD = 700;
const REVENUE_WEBSITE_MAX_USD = 2500;
const REVENUE_WEBSITE_DEFAULT_USD = 1500;

function clampRevenueWebsitePrice(value: number) {
  if (value <= 0) return 0;
  return Math.min(REVENUE_WEBSITE_MAX_USD, Math.max(REVENUE_WEBSITE_MIN_USD, Math.round(value)));
}

function revenueWebsitePackageName(priceUsd: number) {
  if (priceUsd >= REVENUE_WEBSITE_MAX_USD) return "Website Premium 3D";
  if (priceUsd > REVENUE_WEBSITE_MIN_USD) return "Website Growth";
  return "Website Starter";
}

function revenueWebsiteOfferName(websitePriceUsd: number, includesAutomation: boolean) {
  const websiteName = revenueWebsitePackageName(websitePriceUsd);
  return includesAutomation ? `${websiteName} + Automation Sprint` : websiteName;
}

const REVENUE_MONTHLY_COST_CAP_USD = 100;

export const revenueEnginePlanSchema = z.object({
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  offerFocus: z.enum(["websites", "automations", "both"]).default("both"),
  monthlyBudgetUsd: z.coerce.number().min(0).max(100).default(100),
  leadCount: z.coerce.number().int().min(5).max(50).default(20),
});

export type RevenueEnginePlanInput = z.infer<typeof revenueEnginePlanSchema>;

export const revenueScoutingMissionSchema = z.object({
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  offerFocus: z.enum(["websites", "automations", "both"]).default("both"),
  targetLeadCount: z.coerce.number().int().min(5).max(100).default(25),
  maxPaidDataSpendUsd: z.coerce.number().min(0).max(5000).default(0),
  requireNoWebsiteSignal: z.boolean().default(true),
  includeWeakWebsiteLeads: z.boolean().default(true),
});

export type RevenueScoutingMissionInput = z.infer<typeof revenueScoutingMissionSchema>;

export const revenueDailyScoutSprintSchema = z.object({
  area: z.string().trim().min(2).max(120).optional(),
  niche: z.string().trim().min(2).max(120).optional(),
  offerFocus: z.enum(["websites", "automations", "both"]).optional(),
  targetLeadCount: z.coerce.number().int().min(5).max(100).optional(),
  maxTasks: z.coerce.number().int().min(3).max(30).default(9),
  resultSlotsPerTask: z.coerce.number().int().min(1).max(5).default(2),
  maxPaidDataSpendUsd: z.coerce.number().min(0).max(0).default(0),
  requireRobertApprovalToContact: z.literal(true).default(true),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueDailyScoutSprintInput = z.infer<typeof revenueDailyScoutSprintSchema>;

export const revenueLeadRadarSchema = z.object({
  area: z.string().trim().min(2).max(120),
  niches: z.string().trim().min(2).max(500).default("med spas, gyms, restaurants"),
  offerFocus: z.enum(["websites", "automations", "both"]).default("both"),
  runHoursPerDay: z.coerce.number().int().min(1).max(24).default(24),
  dailyResearchTarget: z.coerce.number().int().min(10).max(500).default(120),
  dailyQualifiedLeadLimit: z.coerce.number().int().min(5).max(100).default(35),
  dailyMockupLimit: z.coerce.number().int().min(1).max(25).default(8),
  dailyContactLimit: z.coerce.number().int().min(0).max(50).default(10),
  maxPaidDataSpendUsd: z.coerce.number().min(0).max(5000).default(0),
  requireRobertApprovalToContact: z.boolean().default(true),
});

export type RevenueLeadRadarInput = z.infer<typeof revenueLeadRadarSchema>;

export const automationQuoteSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  industry: z.string().trim().min(2).max(120),
  request: z.string().trim().min(8).max(1200),
  currentTools: z.string().trim().max(300).optional().default(""),
  monthlyBudgetUsd: z.coerce.number().min(0).max(5000).default(500),
  urgency: z.enum(["this_week", "this_month", "flexible"]).default("this_month"),
});

export type AutomationQuoteInput = z.infer<typeof automationQuoteSchema>;

export const revenueAutomationOpportunitySchema = automationQuoteSchema.extend({
  sourceLeadId: z.string().trim().max(120).optional().default(""),
  status: z.enum(["intake", "quoted", "approved", "sold", "in_delivery", "delivered", "blocked"]).default("intake"),
  clientApprovedScope: z.boolean().default(false),
  depositPaid: z.boolean().default(false),
  paymentConfirmation: z.string().trim().max(500).optional().default(""),
});

export type RevenueAutomationOpportunityInput = z.infer<typeof revenueAutomationOpportunitySchema>;

export const deliveryReviewSchema = z.object({
  projectName: z.string().trim().min(2).max(160),
  projectType: z.enum(["website", "automation", "bundle"]).default("bundle"),
  setupPriceUsd: z.coerce.number().min(0).max(100000).default(2500),
  monthlyRetainerUsd: z.coerce.number().min(0).max(25000).default(300),
  estimatedInternalMonthlyCostUsd: z.coerce.number().min(0).max(5000).default(50),
  clientApprovedScope: z.boolean().default(false),
  depositPaid: z.boolean().default(false),
  publicDataVerified: z.boolean().default(false),
  responsiveChecked: z.boolean().default(false),
  linksChecked: z.boolean().default(false),
  automationTested: z.boolean().default(false),
  rollbackPlanReady: z.boolean().default(false),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type DeliveryReviewInput = z.infer<typeof deliveryReviewSchema>;

export const proposalEmailSchema = z.object({
  recipientEmail: z.union([z.string().trim().email().max(240), z.literal("")]).optional().default(""),
  contactName: z.string().trim().min(1).max(120).default("Robert"),
  businessName: z.string().trim().min(2).max(160),
  sourceUrl: z.string().trim().url().max(300).optional(),
  businessSummary: z.string().trim().min(10).max(2000),
  websitePriceUsd: z.coerce.number().min(0).max(100000).default(REVENUE_WEBSITE_DEFAULT_USD),
  automationPriceUsd: z.coerce.number().min(0).max(100000).default(2500),
  monthlyRetainerUsd: z.coerce.number().min(0).max(25000).default(750),
  estimatedInternalMonthlyCostUsd: z.coerce.number().min(0).max(5000).default(54),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type ProposalEmailInput = z.infer<typeof proposalEmailSchema>;

const revenueMockupUrlSchema = z.union([
  z.string().trim().url().max(300),
  z.string().trim().regex(/^\/api\/revenue-engine\/mockup-previews\/[a-z0-9-]{1,120}$/).max(300),
  z.literal(""),
]);

export const revenueOutreachDraftSchema = proposalEmailSchema.extend({
  leadId: z.string().trim().max(120).optional().default(""),
  channel: z.enum(["email", "gmail", "mailto", "instagram", "contact_form"]).default("gmail"),
  approvalStatus: z.enum(["draft", "approved"]).default("draft"),
  mockupUrl: revenueMockupUrlSchema.optional(),
});

export type RevenueOutreachDraftInput = z.infer<typeof revenueOutreachDraftSchema>;

export const revenueOutreachSendSchema = z.object({
  draftId: z.string().trim().min(1).max(160),
  approvalToSend: z.boolean().default(false),
});

export type RevenueOutreachSendInput = z.infer<typeof revenueOutreachSendSchema>;

export const revenueOutreachApproveSchema = z.object({
  draftId: z.string().trim().min(1).max(160),
  approvedByRobert: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueOutreachApproveInput = z.infer<typeof revenueOutreachApproveSchema>;

export const revenueOutreachUpdateSchema = z.object({
  draftId: z.string().trim().min(1).max(160),
  subject: z.string().trim().min(3).max(240),
  body: z.string().trim().min(20).max(12000),
});

export type RevenueOutreachUpdateInput = z.infer<typeof revenueOutreachUpdateSchema>;

export const revenueOutreachOutcomeSchema = z.object({
  draftId: z.string().trim().min(1).max(160),
  outcome: z.enum(["contacted", "reply", "call_booked", "deposit_collected", "lost"]),
  outcomeRecordedByRobert: z.boolean().default(false),
  cashCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  paymentConfirmation: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueOutreachOutcomeInput = z.infer<typeof revenueOutreachOutcomeSchema>;

export const revenueWebsiteOpportunitySchema = z.object({
  leadId: z.string().trim().min(1).max(160),
  outreachDraftId: z.string().trim().max(160).optional().default(""),
  projectType: z.enum(["website", "bundle"]).default("bundle"),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueWebsiteOpportunityInput = z.infer<typeof revenueWebsiteOpportunitySchema>;

export const revenueWebsiteOpportunityCloseSchema = z.object({
  opportunityId: z.string().trim().min(1).max(160),
  depositPaid: z.boolean().default(false),
  scopeApproved: z.boolean().default(false),
  cashCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  paymentConfirmation: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueWebsiteOpportunityCloseInput = z.infer<typeof revenueWebsiteOpportunityCloseSchema>;

export const improvementReviewSchema = z.object({
  campaignName: z.string().trim().min(2).max(160),
  periodLabel: z.string().trim().min(2).max(80).default("esta semana"),
  leadsContacted: z.coerce.number().int().min(0).max(10000).default(0),
  replies: z.coerce.number().int().min(0).max(10000).default(0),
  callsBooked: z.coerce.number().int().min(0).max(10000).default(0),
  dealsClosed: z.coerce.number().int().min(0).max(10000).default(0),
  revenueCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  spendUsd: z.coerce.number().min(0).max(50000).default(0),
  estimatedInternalMonthlyCostUsd: z.coerce.number().min(0).max(5000).default(50),
  hoursSaved: z.coerce.number().min(0).max(10000).default(0),
  defectsFound: z.coerce.number().int().min(0).max(10000).default(0),
  clientComplaints: z.coerce.number().int().min(0).max(10000).default(0),
  bestOffer: z.string().trim().max(200).optional().default(""),
  biggestObjection: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type ImprovementReviewInput = z.infer<typeof improvementReviewSchema>;

export const revenueLedgerEntrySchema = z.object({
  kind: z.enum(["website_sale", "automation_sale", "bundle_sale", "retainer", "expense"]),
  clientName: z.string().trim().min(2).max(160),
  amountUsd: z.coerce.number().min(0).max(1000000),
  cashCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(100000).default(0),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueLedgerEntryInput = z.infer<typeof revenueLedgerEntrySchema>;

export const revenueExpensePreflightSchema = z.object({
  concept: z.string().trim().min(2).max(160),
  amountUsd: z.coerce.number().min(0).max(1000000),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(100000).default(0),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueExpensePreflightInput = z.infer<typeof revenueExpensePreflightSchema>;

export const revenueLeadSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  websiteStatus: z.enum(["no_website", "weak_website", "has_website", "unknown"]).default("unknown"),
  contactChannel: z.enum(["email", "phone", "instagram", "contact_form", "unknown"]).default("unknown"),
  contactValue: z.string().trim().max(240).optional().default(""),
  evidence: z.string().trim().max(1200).optional().default(""),
  painPoint: z.string().trim().max(500).optional().default(""),
  estimatedOfferUsd: z.coerce.number().min(0).max(100000).default(REVENUE_WEBSITE_DEFAULT_USD),
  status: z.enum(["research", "qualified", "mockup_ready", "outreach_ready", "contacted", "proposal_sent", "closed", "disqualified"]).default("research"),
});

export type RevenueLeadInput = z.infer<typeof revenueLeadSchema>;

export const revenueMockupSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  websiteStatus: z.enum(["no_website", "weak_website", "has_website", "unknown"]).default("unknown"),
  evidence: z.string().trim().max(1200).optional().default(""),
  painPoint: z.string().trim().max(500).optional().default(""),
  primaryOffer: z.string().trim().max(200).optional().default("Business Website"),
  estimatedOfferUsd: z.coerce.number().min(0).max(100000).default(REVENUE_WEBSITE_DEFAULT_USD),
  includeAutomation: z.boolean().default(true),
});

export type RevenueMockupInput = z.infer<typeof revenueMockupSchema>;

export const revenueMockupTemplatePackSchema = z.object({
  niche: z.string().trim().min(2).max(120).default("med spas"),
  area: z.string().trim().min(2).max(120).default("Miami"),
  dailyMockupTarget: z.coerce.number().int().min(1).max(50).default(8),
  maxCustomMinutesPerMockup: z.coerce.number().int().min(5).max(120).default(18),
  estimatedAiCostPerMockupUsd: z.coerce.number().min(0).max(10).default(0),
});

export type RevenueMockupTemplatePackInput = z.infer<typeof revenueMockupTemplatePackSchema>;

export const revenueLaunchReadinessSchema = z.object({
  area: z.string().trim().min(2).max(120).default("Miami"),
  niche: z.string().trim().min(2).max(120).default("med spas / aesthetics"),
  dailyResearchTarget: z.coerce.number().int().min(10).max(500).default(120),
  dailyMockupTarget: z.coerce.number().int().min(1).max(25).default(5),
  dailyContactTarget: z.coerce.number().int().min(1).max(50).default(10),
  emailPending: z.boolean().default(true),
});

export type RevenueLaunchReadinessInput = z.infer<typeof revenueLaunchReadinessSchema>;

export const revenueProjectPlanSchema = z.object({
  clientName: z.string().trim().min(2).max(160),
  projectType: z.enum(["website", "automation", "bundle"]).default("bundle"),
  packageName: z.string().trim().min(2).max(200).default("Business Website"),
  setupUsd: z.coerce.number().min(0).max(100000).default(REVENUE_WEBSITE_DEFAULT_USD),
  monthlyRetainerUsd: z.coerce.number().min(0).max(25000).default(750),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(5000).default(54),
  depositPaid: z.boolean().default(false),
  scopeApproved: z.boolean().default(false),
  publicDataVerified: z.boolean().default(false),
  includesAutomation: z.boolean().default(true),
  launchTargetDays: z.coerce.number().int().min(1).max(60).default(7),
  clientRequest: z.string().trim().max(1200).optional().default(""),
});

export type RevenueProjectPlanInput = z.infer<typeof revenueProjectPlanSchema>;

export const revenueDeliveryWorkspaceSchema = revenueProjectPlanSchema.extend({
  workspaceName: z.string().trim().min(2).max(180).optional().default("Delivery workspace"),
  sourceOpportunityId: z.string().trim().max(160).optional().default(""),
  sourceLeadId: z.string().trim().max(160).optional().default(""),
  sourceOutreachDraftId: z.string().trim().max(160).optional().default(""),
  sourceUrl: z.string().trim().url().max(300).optional().or(z.literal("")).default(""),
  mockupUrl: revenueMockupUrlSchema.optional().default(""),
  repoFullName: z.string().trim().max(200).optional().default(""),
  branchName: z.string().trim().max(200).optional().default(""),
  githubIssueUrl: z.string().trim().url().max(500).optional().or(z.literal("")).default(""),
  prUrl: z.string().trim().url().max(500).optional().or(z.literal("")).default(""),
  secondReviewStatus: z.enum(["pending", "pass", "blocked"]).default("pending"),
  secondReviewEvidenceUrl: z.string().trim().url().max(500).optional().or(z.literal("")).default(""),
  appQaStatus: z.enum(["pending", "pass", "blocked"]).default("pending"),
  appQaEvidenceUrl: z.string().trim().url().max(500).optional().or(z.literal("")).default(""),
  deploymentApprovalStatus: z.enum(["not_requested", "requested", "approved", "blocked"]).default("not_requested"),
  deploymentApprovalUrl: z.string().trim().url().max(500).optional().or(z.literal("")).default(""),
  releaseGateHeadSha: z.string().trim().regex(/^[a-f0-9]{7,64}$/i, "releaseGateHeadSha must be a git sha").max(64).optional().or(z.literal("")).default(""),
  visualQaPassed: z.boolean().default(false),
  technicalQaPassed: z.boolean().default(false),
  automationQaPassed: z.boolean().default(false),
  clientHandoffReady: z.boolean().default(false),
});

export type RevenueDeliveryWorkspaceInput = z.infer<typeof revenueDeliveryWorkspaceSchema>;

export const revenueWebsiteDeliveryWorkspaceSchema = z.object({
  leadId: z.string().trim().min(1).max(200),
  outreachDraftId: z.string().trim().max(200).optional().default(""),
  websiteOpportunityId: z.string().trim().max(200).optional().default(""),
  mockupUrl: revenueMockupUrlSchema.optional().default(""),
  workspaceName: z.string().trim().min(2).max(180).optional().default("Website delivery workspace"),
  repoFullName: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "repoFullName must be owner/repo").max(200).optional(),
  branchName: z.string().trim().max(200).optional().default(""),
  projectType: z.enum(["website", "bundle"]).default("bundle"),
  depositPaid: z.boolean().default(false),
  scopeApproved: z.boolean().default(false),
  cashCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  publicDataVerified: z.boolean().default(false),
  visualQaPassed: z.boolean().default(false),
  technicalQaPassed: z.boolean().default(false),
  automationQaPassed: z.boolean().default(false),
  clientHandoffReady: z.boolean().default(false),
  launchTargetDays: z.coerce.number().int().min(1).max(60).default(7),
  monthlyRetainerUsd: z.coerce.number().min(0).max(25000).default(750),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(5000).default(54),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type RevenueWebsiteDeliveryWorkspaceInput = z.infer<typeof revenueWebsiteDeliveryWorkspaceSchema>;

export const revenueDeliveryWorkspaceUpdateSchema = z.object({
  workspaceId: z.string().trim().min(1).max(200),
  publicDataVerified: z.boolean().optional(),
  visualQaPassed: z.boolean().optional(),
  technicalQaPassed: z.boolean().optional(),
  automationQaPassed: z.boolean().optional(),
  clientHandoffReady: z.boolean().optional(),
  repoFullName: z.string().trim().max(200).optional(),
  branchName: z.string().trim().max(200).optional(),
  githubIssueUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  prUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  secondReviewStatus: z.enum(["pending", "pass", "blocked"]).optional(),
  appQaStatus: z.enum(["pending", "pass", "blocked"]).optional(),
  deploymentApprovalStatus: z.enum(["not_requested", "requested", "approved", "blocked"]).optional(),
  deploymentApprovalUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  secondReviewEvidenceUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  appQaEvidenceUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
  releaseGateHeadSha: z.string().trim().regex(/^[a-f0-9]{7,64}$/i, "releaseGateHeadSha must be a git sha").max(64).optional().or(z.literal("")),
  notes: z.string().trim().max(1200).optional(),
});

export type RevenueDeliveryWorkspaceUpdateInput = z.infer<typeof revenueDeliveryWorkspaceUpdateSchema>;

type RevenueDeliveryWorkspaceUpdateOptions = {
  allowGithubIssueEvidence?: boolean;
  allowReleaseGateEvidence?: boolean;
};

type RevenueDeliveryReleaseGateOptions = {
  verifiedPrStatusReady?: boolean;
  verifiedPrHeadSha?: string;
};

export const revenueDeliveryWorkspaceGithubHandoffSchema = z.object({
  workspaceId: z.string().trim().min(1).max(200),
  repoFullName: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "repoFullName must be owner/repo").max(200).optional(),
  branchName: z.string().trim().regex(/^codex\/[A-Za-z0-9._/-]+$/, "branchName must start with codex/").max(200).optional(),
});

export type RevenueDeliveryWorkspaceGithubHandoffInput = z.infer<typeof revenueDeliveryWorkspaceGithubHandoffSchema>;

export const revenueDeliveryWorkspaceDeliverSchema = z.object({
  workspaceId: z.string().trim().min(1).max(200),
  approvedByRobert: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueDeliveryWorkspaceDeliverInput = z.infer<typeof revenueDeliveryWorkspaceDeliverSchema>;

type RevenueDeliveryWorkspaceDeliverOptions = {
  allowRobertApprovalEvidence?: boolean;
};

export const revenueDeliveryWorkspaceImprovementReviewSchema = z.object({
  workspaceId: z.string().trim().min(1).max(200),
  periodLabel: z.string().trim().min(2).max(80).default("post-delivery week 1"),
  leadsContacted: z.coerce.number().int().min(0).max(10000).default(0),
  replies: z.coerce.number().int().min(0).max(10000).default(0),
  callsBooked: z.coerce.number().int().min(0).max(10000).default(0),
  dealsClosed: z.coerce.number().int().min(0).max(10000).default(0),
  revenueCollectedUsd: z.coerce.number().min(0).max(1000000).optional(),
  spendUsd: z.coerce.number().min(0).max(50000).optional(),
  hoursSaved: z.coerce.number().min(0).max(10000).default(0),
  defectsFound: z.coerce.number().int().min(0).max(10000).default(0),
  clientComplaints: z.coerce.number().int().min(0).max(10000).default(0),
  notes: z.string().trim().max(1200).optional().default(""),
});

export type RevenueDeliveryWorkspaceImprovementReviewInput = z.infer<typeof revenueDeliveryWorkspaceImprovementReviewSchema>;

export const revenueAgentRunSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  request: z.string().trim().min(8).max(1600),
  stage: z.enum(["lead_research", "mockup", "outreach", "proposal", "production", "delivery", "improvement"]).default("lead_research"),
  projectType: z.enum(["website", "automation", "bundle"]).default("bundle"),
  estimatedOfferUsd: z.coerce.number().min(0).max(100000).default(REVENUE_WEBSITE_DEFAULT_USD),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(5000).default(54),
  monthlyBudgetUsd: z.coerce.number().min(0).max(100).default(100),
  cashCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  approvalToContact: z.boolean().default(false),
  approvalToSpend: z.boolean().default(false),
  approvalToBuild: z.boolean().default(false),
});

export type RevenueAgentRunInput = z.infer<typeof revenueAgentRunSchema>;

export const revenueSalesAutopilotSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  area: z.string().trim().min(2).max(120),
  niche: z.string().trim().min(2).max(120),
  websiteStatus: z.enum(["no_website", "weak_website", "has_website", "unknown"]).default("unknown"),
  contactChannel: z.enum(["email", "phone", "instagram", "contact_form", "unknown"]).default("unknown"),
  contactValue: z.string().trim().max(240).optional().default(""),
  evidence: z.string().trim().max(1200).optional().default(""),
  painPoint: z.string().trim().max(500).optional().default(""),
  request: z.string().trim().min(8).max(1600),
  projectType: z.enum(["website", "automation", "bundle"]).default("bundle"),
  estimatedOfferUsd: z.coerce.number().min(0).max(100000).default(REVENUE_WEBSITE_DEFAULT_USD),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(5000).default(54),
  monthlyBudgetUsd: z.coerce.number().min(0).max(100).default(100),
  cashCollectedUsd: z.coerce.number().min(0).max(1000000).default(0),
  recipientEmail: z.union([z.string().trim().email().max(240), z.literal("")]).optional().default(""),
  contactName: z.string().trim().max(120).optional().default("Owner"),
  sourceUrl: z.union([z.string().trim().url().max(300), z.literal("")]).optional().default(""),
  businessSummary: z.string().trim().max(2000).optional().default(""),
  monthlyRetainerUsd: z.coerce.number().min(0).max(25000).default(750),
  approvalToContact: z.boolean().default(false),
  approvalToSpend: z.boolean().default(false),
  approvalToBuild: z.boolean().default(false),
});

export type RevenueSalesAutopilotInput = z.infer<typeof revenueSalesAutopilotSchema>;

export const revenueMoneySprintSeedLeadSchema = revenueLeadSchema.extend({
  sourceUrl: z.union([z.string().trim().url().max(300), z.literal("")]).optional().default(""),
  recipientEmail: z.union([z.string().trim().email().max(240), z.literal("")]).optional().default(""),
  contactName: z.string().trim().max(120).optional().default("Owner"),
  businessSummary: z.string().trim().max(2000).optional().default(""),
});

export type RevenueMoneySprintSeedLeadInput = z.infer<typeof revenueMoneySprintSeedLeadSchema>;

export const revenueMoneySprintSchema = z.object({
  area: z.string().trim().min(2).max(120).default("Miami"),
  niche: z.string().trim().min(2).max(120).default("med spas"),
  offerFocus: z.enum(["websites", "automations", "both"]).default("both"),
  dailyResearchTarget: z.coerce.number().int().min(10).max(500).default(120),
  dailyQualifiedLeadLimit: z.coerce.number().int().min(5).max(100).default(25),
  dailyMockupLimit: z.coerce.number().int().min(1).max(25).default(5),
  dailyContactLimit: z.coerce.number().int().min(0).max(50).default(10),
  maxPaidDataSpendUsd: z.coerce.number().min(0).max(5000).default(0),
  requireRobertApprovalToContact: z.boolean().default(true),
  writePreviewFiles: z.boolean().default(true),
  seedLeads: z.array(revenueMoneySprintSeedLeadSchema).max(25).optional().default([]),
  seedLeadBatchText: z.string().trim().max(20000).optional().default(""),
});

export type RevenueMoneySprintInput = z.infer<typeof revenueMoneySprintSchema>;

export const revenueMoneySprintFromPublicCandidatesSchema = revenueMoneySprintSchema.omit({
  seedLeads: true,
  seedLeadBatchText: true,
}).extend({
  candidateIds: z.array(z.string().trim().min(1).max(200)).max(25).optional().default([]),
  maxCandidates: z.coerce.number().int().min(1).max(25).default(10),
});

export type RevenueMoneySprintFromPublicCandidatesInput = z.infer<typeof revenueMoneySprintFromPublicCandidatesSchema>;

export const revenuePublicLeadCandidateSchema = revenueMoneySprintSeedLeadSchema.extend({
  missionId: z.string().trim().max(160).optional().default(""),
  sourceTaskId: z.string().trim().max(160).optional().default(""),
  verificationStatus: z.enum(["needs_review", "verified_public", "blocked"]).default("needs_review"),
  publicEvidenceVerified: z.boolean().default(false),
  approvalToImport: z.boolean().default(false),
  approvedByRobert: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenuePublicLeadCandidateInput = z.infer<typeof revenuePublicLeadCandidateSchema>;

export const revenuePublicLeadCandidateBatchSchema = z.object({
  area: z.string().trim().min(2).max(120).default("Miami"),
  niche: z.string().trim().min(2).max(120).default("med spas"),
  batchText: z.string().trim().min(1).max(20000),
  missionId: z.string().trim().max(160).optional().default(""),
  sourceTaskId: z.string().trim().max(160).optional().default("batch-import"),
  verificationStatus: z.enum(["needs_review", "verified_public"]).default("needs_review"),
  publicEvidenceVerified: z.boolean().default(false),
  approvalToImport: z.boolean().default(false),
  approvedByRobert: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenuePublicLeadCandidateBatchInput = z.infer<typeof revenuePublicLeadCandidateBatchSchema>;

export const revenuePublicLeadCandidateApproveSchema = z.object({
  candidateId: z.string().trim().min(1).max(160),
  approvedByRobert: z.literal(true),
  publicEvidenceVerified: z.literal(true),
  approvalToImport: z.literal(true),
  notes: z.string().trim().max(1000).optional().default("Approved from public candidate review queue."),
});

export type RevenuePublicLeadCandidateApproveInput = z.infer<typeof revenuePublicLeadCandidateApproveSchema>;

export const revenuePublicScoutEvidenceSchema = z.object({
  area: z.string().trim().min(2).max(120).default("Miami"),
  niche: z.string().trim().min(2).max(120).default("med spas"),
  evidenceText: z.string().trim().min(10).max(30000),
  missionId: z.string().trim().max(160).optional().default(""),
  sourceTaskId: z.string().trim().max(160).optional().default("scout-evidence"),
  verificationStatus: z.enum(["needs_review", "verified_public"]).default("needs_review"),
  publicEvidenceVerified: z.boolean().default(false),
  approvalToImport: z.boolean().default(false),
  approvedByRobert: z.boolean().default(false),
  defaultOfferUsd: z.coerce.number().min(REVENUE_WEBSITE_MIN_USD).max(100000).default(REVENUE_WEBSITE_DEFAULT_USD),
  maxCandidates: z.coerce.number().int().min(1).max(50).default(25),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenuePublicScoutEvidenceInput = z.infer<typeof revenuePublicScoutEvidenceSchema>;

const revenueVerifiedScoutConnectorResultSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  area: z.string().trim().min(2).max(120).optional(),
  niche: z.string().trim().min(2).max(120).optional(),
  websiteStatus: z.enum(["no_website", "weak_website", "has_website", "unknown"]).default("unknown"),
  contactChannel: z.enum(["email", "phone", "instagram", "contact_form", "unknown"]).default("unknown"),
  contactValue: z.string().trim().max(240).default(""),
  recipientEmail: z.union([z.string().email(), z.literal("")]).optional().default(""),
  sourceUrl: z.string().trim().url().max(300),
  evidence: z.string().trim().min(12).max(1200),
  painPoint: z.string().trim().min(8).max(500).default("Needs a stronger website, lead capture and follow-up."),
  estimatedOfferUsd: z.coerce.number().min(REVENUE_WEBSITE_MIN_USD).max(100000).default(REVENUE_WEBSITE_DEFAULT_USD),
  contactName: z.string().trim().max(120).optional().default("Owner"),
  businessSummary: z.string().trim().max(800).optional().default(""),
});

export const revenueVerifiedScoutConnectorSchema = z.object({
  area: z.string().trim().min(2).max(120).default("Miami"),
  niche: z.string().trim().min(2).max(120).default("med spas"),
  connectorName: z.string().trim().min(2).max(120),
  connectorRunId: z.string().trim().min(2).max(160),
  missionId: z.string().trim().max(160).optional().default(""),
  sourceTaskId: z.string().trim().max(160).optional().default("verified-scout-connector"),
  results: z.array(revenueVerifiedScoutConnectorResultSchema).min(1).max(20),
  publicEvidenceVerified: z.literal(false).default(false),
  approvalToImport: z.literal(false).default(false),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueVerifiedScoutConnectorInput = z.infer<typeof revenueVerifiedScoutConnectorSchema>;

export const revenueDailyScoutSprintSubmitSchema = revenuePublicScoutEvidenceSchema.extend({
  sprintId: z.string().trim().min(1).max(160),
  taskId: z.string().trim().max(160).optional().default(""),
});

export type RevenueDailyScoutSprintSubmitInput = z.infer<typeof revenueDailyScoutSprintSubmitSchema>;

export const revenuePublicScoutAgentCommandSchema = revenuePublicScoutEvidenceSchema.extend({
  offerFocus: z.enum(["websites", "automations", "both"]).default("both"),
  dailyResearchTarget: z.coerce.number().int().min(10).max(500).default(120),
  dailyQualifiedLeadLimit: z.coerce.number().int().min(5).max(100).default(25),
  dailyMockupLimit: z.coerce.number().int().min(1).max(25).default(5),
  dailyContactLimit: z.coerce.number().int().min(0).max(50).default(10),
  requireRobertApprovalToContact: z.literal(true).default(true),
  writePreviewFiles: z.boolean().default(true),
  runMoneySprintIfReady: z.boolean().default(false),
  maxSprintCandidates: z.coerce.number().int().min(1).max(25).default(10),
  maxPaidDataSpendUsd: z.coerce.number().min(0).max(0).default(0),
});

export type RevenuePublicScoutAgentCommandInput = z.infer<typeof revenuePublicScoutAgentCommandSchema>;

export const revenueApprovalDecisionSchema = z.object({
  targetId: z.string().trim().min(1).max(200),
  targetType: z.enum(["profit_guard", "outbox", "agent_run", "automation_opportunity", "delivery_workspace", "manual"]),
  decision: z.enum(["approved", "rejected", "needs_changes"]),
  approvedAction: z.string().trim().min(2).max(500),
  maxSpendUsd: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type RevenueApprovalDecisionInput = z.infer<typeof revenueApprovalDecisionSchema>;

export const revenueAutomationIntakeSchema = automationQuoteSchema.extend({
  contactName: z.string().trim().max(120).optional().default(""),
  contactEmail: z.union([z.string().trim().email().max(240), z.literal("")]).optional().default(""),
  knownAnswers: z.string().trim().max(2000).optional().default(""),
  source: z.enum(["manual", "lead", "website_form", "call", "email"]).default("manual"),
});

export type RevenueAutomationIntakeInput = z.infer<typeof revenueAutomationIntakeSchema>;

export const revenueAutomationIntakeAnswerSchema = z.object({
  intakeId: z.string().trim().min(1).max(200),
  answers: z.string().trim().min(10).max(2000),
});

export type RevenueAutomationIntakeAnswerInput = z.infer<typeof revenueAutomationIntakeAnswerSchema>;

export const revenueAutomationIntakeConvertSchema = z.object({
  intakeId: z.string().trim().min(1).max(200),
  status: z.enum(["intake", "quoted", "approved", "sold", "in_delivery", "delivered", "blocked"]).default("intake"),
  clientApprovedScope: z.boolean().default(false),
  depositPaid: z.boolean().default(false),
});

export type RevenueAutomationIntakeConvertInput = z.infer<typeof revenueAutomationIntakeConvertSchema>;

export const revenueAutomationAgentCommandSchema = revenueAutomationIntakeSchema.extend({
  createOpportunityIfClear: z.boolean().default(true),
  lifecycleTarget: z.enum(["quote", "opportunity", "sale", "delivery"]).default("opportunity"),
  clientApprovedScope: z.boolean().default(false),
  depositPaid: z.boolean().default(false),
  cashCollectedUsd: z.coerce.number().min(1).max(1000000).optional(),
  paymentConfirmation: z.string().trim().max(500).optional().default(""),
  createDeliveryWorkspaceIfSold: z.boolean().default(false),
  workspaceName: z.string().trim().min(2).max(180).optional().default("Delivery workspace"),
  publicDataVerified: z.boolean().default(false),
  visualQaPassed: z.boolean().default(false),
  technicalQaPassed: z.boolean().default(false),
  automationQaPassed: z.boolean().default(false),
  clientHandoffReady: z.boolean().default(false),
  launchTargetDays: z.coerce.number().int().min(1).max(60).default(7),
});

export type RevenueAutomationAgentCommandInput = z.infer<typeof revenueAutomationAgentCommandSchema>;

export const revenueAutomationOpportunityDeliverySchema = z.object({
  opportunityId: z.string().trim().min(1).max(200),
  workspaceName: z.string().trim().min(2).max(180).optional().default("Delivery workspace"),
  publicDataVerified: z.boolean().default(false),
  visualQaPassed: z.boolean().default(false),
  technicalQaPassed: z.boolean().default(false),
  automationQaPassed: z.boolean().default(false),
  clientHandoffReady: z.boolean().default(false),
  launchTargetDays: z.coerce.number().int().min(1).max(60).default(7),
});

export type RevenueAutomationOpportunityDeliveryInput = z.infer<typeof revenueAutomationOpportunityDeliverySchema>;

export const revenueAutomationOpportunityCloseSchema = z.object({
  opportunityId: z.string().trim().min(1).max(200),
  cashCollectedUsd: z.coerce.number().min(1).max(1000000).optional(),
  paymentConfirmation: z.string().trim().max(500).optional().default(""),
  markScopeApproved: z.boolean().default(false),
  notes: z.string().trim().max(800).optional().default(""),
});

export type RevenueAutomationOpportunityCloseInput = z.infer<typeof revenueAutomationOpportunityCloseSchema>;

type RevenueLedgerEntry = RevenueLedgerEntryInput & {
  id: string;
  createdAt: string;
};

type RevenueLead = RevenueLeadInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

type RevenueOutreachDraft = RevenueOutreachDraftInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "approved" | "blocked";
  subject: string;
  body: string;
  pricing: ReturnType<typeof buildProposalEmail>["pricing"];
  delivery: ReturnType<typeof buildProposalEmail>["delivery"] & {
    provider?: string;
    externalMessageId?: string;
    sentAt?: string;
    lastAttemptAt?: string;
    outcome?: RevenueOutreachOutcomeInput["outcome"];
    outcomeAt?: string;
    outcomeNotes?: string;
    outcomeCashCollectedUsd?: number;
    outcomePaymentConfirmation?: string;
  };
  links: ReturnType<typeof buildProposalEmail>["links"];
  qaGates: Array<{ gate: string; passed: boolean; fix: string }>;
  nextAction: string;
};

type RevenueManualOutreachQueue = {
  status: "ready" | "needs_approval" | "empty";
  dailyContactLimit: number;
  readyCount: number;
  blockedCount: number;
  overflowCount: number;
  items: Array<{
    draftId: string;
    businessName: string;
    channel: RevenueOutreachDraft["channel"];
    subject: string;
    manualAction: string;
    priority: "high" | "medium";
    contactUrl: string;
    fallbackUrl: string;
    estimatedSetupUsd: number;
    depositUsd: number;
    monthlyRetainerUsd: number;
    paymentEvidenceRequired: string[];
    copyableContactPacket: string;
    copyableCloseEvidencePacket: string;
    copyableOutcomeRequests: {
      contacted: string;
      reply: string;
      callBooked: string;
      depositCollected: string;
      lost: string;
    };
    nextAction: string;
  }>;
  blocked: Array<{
    draftId: string;
    businessName: string;
    status: RevenueOutreachDraft["status"];
    reason: string;
  }>;
  nextAction: string;
  safety: {
    sendsOutreach: false;
    requiresHumanApproval: true;
    blockedActions: string[];
  };
};

type RevenueBusinessScoutQueue = {
  status: "ready" | "needs_context";
  source: "latest_scouting_mission" | "default_market";
  area: string;
  niche: string;
  offerFocus: RevenueMoneySprintInput["offerFocus"];
  dailyResearchTarget: number;
  tasks: ReturnType<typeof buildRevenueScoutQueue>;
  workPack: ReturnType<typeof buildRevenueScoutWorkPack>;
  nextAction: string;
  safety: {
    researchesPublicSources: true;
    persistsCandidates: false;
    sendsOutreach: false;
    spendsMoney: false;
    blockedActions: string[];
  };
};

type RevenueDailyScoutSprint = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "open" | "completed" | "blocked";
  dispatchMode?: "manual_subagent_dispatch";
  executionMode?: "manual_evidence_required";
  blockedUntil?: string;
  requiredExecutionBridge?: string;
  dispatchedAt?: string;
  dispatchSummary?: string;
  source: "latest_scouting_mission" | "manual_override" | "default_market";
  area: string;
  niche: string;
  offerFocus: RevenueMoneySprintInput["offerFocus"];
  targetRows: number;
  tasks: Array<{
    taskId: string;
    ownerAgent: string;
    source: string;
    query: string;
    url: string;
    targetRows: number;
    status: "open" | "submitted" | "blocked";
    resultSlots: Array<{
      slotId: string;
      status: "open" | "filled" | "rejected";
      evidenceTemplate: string;
      copyableEvidenceBlock: string;
      acceptanceCriteria: string[];
    }>;
    allowedAction: string;
    blockedActions: string[];
  }>;
  agentBriefs: Array<{
    ownerAgent: string;
    taskIds: string[];
    copyableBrief: string;
  }>;
  copyableBatchTemplate: string;
  copyableOperatorBrief: string;
  qualityGate: string[];
  nextAction: string;
  safety: {
    researchesPublicSources: true;
    persistsScoutRun: true;
    persistsCandidates: false;
    persistsLeads: false;
    sendsOutreach: false;
    spendsMoney: false;
    deploys: false;
    requiresRobertApprovalToContact: true;
    blockedActions: string[];
  };
};

type RevenueWebsiteSalesPacketQueue = {
  status: "ready" | "needs_context" | "empty";
  readyCount: number;
  blockedCount: number;
  items: Array<{
    leadId: string;
    outreachDraftId: string;
    businessName: string;
    area: string;
    niche: string;
    websiteStatus: RevenueLead["websiteStatus"];
    leadStatus: RevenueLead["status"];
    grade: string;
    score: number;
    sourceUrl: string;
    mockupUrl: string;
    contactChannel: RevenueLead["contactChannel"];
    contactValue: string;
    draftStatus: RevenueOutreachDraft["status"];
    estimatedSetupUsd: number;
    depositUsd: number;
    monthlyRetainerUsd: number;
    primaryOffer: string;
    copyableSalesPacket: string;
    copyableOpportunityRequest: string;
    closePlan: {
      requiredDepositUsd: number;
      paymentEvidenceRequired: string[];
      scopeApprovalRequired: true;
      nextCloseAction: string;
      copyableClosePacket: string;
      copyableCloseRequest: string;
      blockedActions: string[];
    };
    readiness: string[];
    nextAction: string;
  }>;
  blocked: Array<{
    leadId: string;
    businessName: string;
    reason: string;
    nextAction: string;
  }>;
  safety: {
    sendsOutreach: false;
    publishesWebsite: false;
    requiresHumanApprovalToContact: true;
    requiresDepositBeforeBuild: true;
    blockedActions: string[];
  };
  nextAction: string;
};

type RevenueWebsiteClosureQueue = {
  status: "ready" | "empty";
  readyCount: number;
  items: Array<{
    id: string;
    opportunityId: string;
    leadId: string;
    outreachDraftId: string;
    sourceLeadId: string;
    sourceOutreachDraftId: string;
    businessName: string;
    projectType: "website" | "bundle";
    status: RevenueWebsiteOpportunity["status"];
    sourceUrl: string;
    mockupUrl: string;
    setupUsd: number;
    requiredDepositUsd: number;
    cashCollectedUsd: number;
    monthlyRetainerUsd: number;
    depositPaid: boolean;
    scopeApproved: boolean;
    paymentConfirmation: string;
    closureStage: "collect_deposit" | "approve_scope" | "collect_deposit_and_scope";
    priority: "high" | "medium";
    readiness: string[];
    copyableClosurePacket: string;
    copyableCloseRequest: string;
    nextAction: string;
  }>;
  safety: {
    sendsOutreach: false;
    collectsPaymentAutomatically: false;
    createsWorkspace: false;
    requiresPaymentEvidence: true;
    requiresScopeApproval: true;
    blockedActions: string[];
  };
  nextAction: string;
};

type RevenueWebsiteOpportunity = RevenueWebsiteOpportunityInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "quoted" | "scope_approved" | "sold" | "delivered" | "blocked";
  businessName: string;
  sourceLeadId: string;
  sourceOutreachDraftId: string;
  mockupUrl: string;
  sourceUrl: string;
  setupUsd: number;
  requiredDepositUsd: number;
  cashCollectedUsd: number;
  monthlyRetainerUsd: number;
  estimatedInternalCostUsd: number;
  depositPaid: boolean;
  scopeApproved: boolean;
  paymentConfirmation: string;
  qaGates: Array<{ gate: string; passed: boolean; fix: string }>;
  nextAction: string;
  safety: {
    sendsOutreach: false;
    createsWorkspace: false;
    requiresDepositAndScopeForDelivery: true;
    blockedActions: string[];
  };
};

type RevenueWebsiteDeliveryHandoffQueue = {
  status: "ready" | "needs_context" | "empty";
  readyCount: number;
  blockedCount: number;
  items: Array<{
    opportunityId: string;
    leadId: string;
    outreachDraftId: string;
    businessName: string;
    leadStatus: RevenueLead["status"];
    projectType: "website" | "bundle";
    estimatedSetupUsd: number;
    requiredDepositUsd: number;
    cashCollectedUsd: number;
    monthlyRetainerUsd: number;
    mockupUrl: string;
    sourceUrl: string;
    repoRequired: true;
    repoFullNamePattern: string;
    suggestedBranchName: string;
    copyableWorkspaceSetupPacket: string;
    copyableWorkspaceRequest: string;
    nextAction: string;
  }>;
  blocked: Array<{
    leadId: string;
    businessName: string;
    reason: string;
    nextAction: string;
  }>;
  safety: {
    createsWorkspaceOnly: true;
    doesNotDeploy: true;
    requiresDepositAndScopeForBuild: true;
    blockedActions: string[];
  };
  nextAction: string;
};

type RevenueWebsiteBuildHandoffQueue = {
  status: "ready" | "empty";
  openCount: number;
  items: Array<{
    workspaceId: string;
    clientName: string;
    projectType: "website" | "bundle";
    packageName: string;
    setupUsd: number;
    repoFullName: string;
    branchName: string;
    githubIssueUrl: string;
    prUrl: string;
    codexBrief: string;
    publicBuildBrief: string;
    copyableGithubHandoffRequest: string;
    copyableReleaseGateRequest: string;
    buildPack: {
      sections: string[];
      assets: string[];
      qaCommands: string[];
      publicOnly: boolean;
      copyableBuildPack: string;
    };
    missing: string[];
    blockedActions: string[];
    nextAction: string;
  }>;
  safety: {
    createsPrOnly: true;
    deploys: false;
    requiresSecondReviewAndAppQa: true;
    blockedActions: string[];
  };
  nextAction: string;
};

type RevenueDailyMoneyCommand = {
  status: "search" | "sprint" | "sell" | "contact" | "collect" | "build" | "blocked";
  headline: string;
  primaryAction: string;
  target: string;
  funnel: {
    researchTarget: number;
    candidatesReady: number;
    salesPacketsReady: number;
    manualContactsReady: number;
    websiteClosuresPending: number;
    deliveryHandoffsReady: number;
    buildHandoffsOpen: number;
    cashCollectedUsd: number;
  };
  steps: Array<{
    id: string;
    label: string;
    metric: string;
    nextAction: string;
    status: "ready" | "waiting" | "blocked";
  }>;
  runPacket: {
    status: "search" | "sprint" | "sell" | "contact" | "collect" | "build" | "blocked";
    apiAction: string;
    input: string;
    output: string;
    gate: string;
    copyableApiRequest: string;
    copyableRunPacket: string;
  };
  copyableOperatorBrief: string;
  safety: {
    sendsOutreach: false;
    spendsMoney: false;
    deploys: false;
    requiresHumanApproval: string[];
    blockedActions: string[];
  };
};

type RevenueEmailProviderStatus = {
  provider: "resend";
  configured: boolean;
  mode: "api" | "manual";
  fromEmail: string;
  missing: string[];
  monthlyCostUsd: number;
  sendPolicy: string;
};

type RevenueOutreachSendPayload = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

type RevenueOutreachSendResponse = {
  id: string;
};

type RevenueAgentRun = RevenueAgentRunInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "ready" | "approval_required" | "blocked";
  clarificationGate: {
    status: "clear" | "needs_clarification";
    missing: string[];
    questions: string[];
    minimumAnswer: string;
    blocks: string[];
  };
  mainAgent: {
    agent: string;
    decision: string;
    reason: string;
  };
  budgetGate: {
    monthlyCapUsd: number;
    insideCap: boolean;
    cashProtected: boolean;
    allowedSpendUsd: number;
  };
  workOrder: Array<{
    step: string;
    ownerAgent: string;
    output: string;
    approvalRequired: boolean;
  }>;
  subagentReviews: Array<{
    agent: string;
    verdict: "pass" | "fix" | "block";
    correction: string;
  }>;
  requiredApprovals: string[];
  nextActions: string[];
  learningUpdate: string;
};

type RevenueAutomationOpportunity = RevenueAutomationOpportunityInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  quote: ReturnType<typeof buildAutomationQuote>;
  qaGates: Array<{ gate: string; passed: boolean; fix: string }>;
  nextAction: string;
};

type RevenueImprovementReview = ReturnType<typeof buildImprovementReview> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  playbookVersion: number;
  decisionStatus: ReturnType<typeof buildImprovementReview>["decision"]["status"];
  learningSummary: string;
};

type RevenueScoutingMission = ReturnType<typeof buildRevenueScoutingMission> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "planned" | "in_research" | "ready_for_leads" | "blocked";
  learningNote: string;
};

type RevenuePublicLeadCandidate = RevenuePublicLeadCandidateInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  qualification: ReturnType<typeof qualifyRevenueLead>;
  importReady: boolean;
  blockedReasons: string[];
  batchRow: string;
  safety: {
    allowedAction: string;
    blockedActions: string[];
    persistsLead: boolean;
    sendsOutreach: boolean;
    writesPreviewFiles: boolean;
  };
};

type RevenuePublicLeadImportQueue = {
  status: "ready" | "needs_review" | "empty";
  readyCount: number;
  blockedCount: number;
  copyableMoneySprintRequest: string;
  items: Array<{
    candidateId: string;
    businessName: string;
    area: string;
    niche: string;
    websiteStatus: RevenueLeadInput["websiteStatus"];
    contactChannel: RevenueLeadInput["contactChannel"];
    sourceUrl: string;
    recipientEmail: string;
    estimatedOfferUsd: number;
    grade: ReturnType<typeof qualifyRevenueLead>["grade"];
    score: number;
    batchRow: string;
    copyableApprovalRequest: string;
    nextAction: string;
  }>;
  blocked: Array<{
    candidateId: string;
    businessName: string;
    reason: string;
    repairBatchRow: string;
    copyableRepairPacket: string;
    copyableApprovalRequest: string;
    nextAction: string;
  }>;
  safety: {
    persistsLeadOnlyAfterSprint: true;
    sendsOutreach: false;
    spendsMoney: false;
    requiresPublicEvidence: true;
    blockedActions: string[];
  };
  nextAction: string;
};

export type RevenueDeliveryWorkspace = {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: RevenueDeliveryWorkspaceInput;
  status: "ready_to_deliver" | "needs_corrections" | "blocked";
  projectPlan: ReturnType<typeof buildRevenueProjectPlan>;
  deliveryReview: ReturnType<typeof buildDeliveryReview>;
  correctionQueue: Array<{
    agent: string;
    priority: "high" | "medium";
    action: string;
    blocksDelivery: boolean;
  }>;
  runbook: Array<{
    phase: string;
    ownerAgent: string;
    checklist: string[];
  }>;
  approvalSummary: {
    canShowClientPreview: boolean;
    canLaunch: boolean;
    requiredBeforeClient: string[];
  };
  learningNote: string;
  codexBuildHandoff: ReturnType<typeof buildRevenueCodexBuildHandoff>;
};

type RevenueApprovalDecision = RevenueApprovalDecisionInput & {
  id: string;
  createdAt: string;
  guardrail: {
    status: "recorded" | "blocked";
    reason: string;
  };
};

type RevenueAutomationIntake = RevenueAutomationIntakeInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "needs_answers" | "ready_for_quote";
  quote: ReturnType<typeof buildAutomationQuote>;
  missingAnswers: string[];
  nextQuestions: string[];
  answerTemplate: string;
  blockedUntilAnswered: string[];
  nextAction: string;
};

const revenueLedger: RevenueLedgerEntry[] = [];
const revenueLeads: RevenueLead[] = [];
const revenueOutreachDrafts: RevenueOutreachDraft[] = [];
const revenueAgentRuns: RevenueAgentRun[] = [];
const revenueAutomationOpportunities: RevenueAutomationOpportunity[] = [];
const revenueWebsiteOpportunities: RevenueWebsiteOpportunity[] = [];
const revenueImprovementReviews: RevenueImprovementReview[] = [];
const revenueScoutingMissions: RevenueScoutingMission[] = [];
const revenueDailyScoutSprints: RevenueDailyScoutSprint[] = [];
const revenuePublicLeadCandidates: RevenuePublicLeadCandidate[] = [];
const revenueDeliveryWorkspaces: RevenueDeliveryWorkspace[] = [];
const revenueApprovalDecisions: RevenueApprovalDecision[] = [];
const revenueAutomationIntakes: RevenueAutomationIntake[] = [];
const persistedRevenueLedgerEntrySchema = revenueLedgerEntrySchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
});
const persistedRevenueLeadSchema = revenueLeadSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
});
const persistedRevenueOutreachDraftSchema = revenueOutreachDraftSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  status: z.enum(["draft", "approved", "blocked"]),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
  pricing: z.object({
    totalSetupUsd: z.number(),
    depositUsd: z.number(),
    monthlyRetainerUsd: z.number(),
    estimatedInternalMonthlyCostUsd: z.number(),
    grossMarginUsd: z.number(),
    grossMarginPercent: z.number(),
    insideCostCap: z.boolean(),
  }),
  delivery: z.object({
    mode: z.string(),
    sendStatus: z.string(),
    reason: z.string(),
    requiresApproval: z.boolean(),
    provider: z.string().optional(),
    externalMessageId: z.string().optional(),
    sentAt: z.string().optional(),
    lastAttemptAt: z.string().optional(),
    outcome: z.enum(["contacted", "reply", "call_booked", "deposit_collected", "lost"]).optional(),
    outcomeAt: z.string().optional(),
    outcomeNotes: z.string().optional(),
    outcomeCashCollectedUsd: z.number().optional(),
    outcomePaymentConfirmation: z.string().optional(),
  }),
  links: z.object({
    mailto: z.string(),
    gmailCompose: z.string(),
  }),
  qaGates: z.array(z.object({ gate: z.string(), passed: z.boolean(), fix: z.string() })),
  nextAction: z.string(),
});
const persistedRevenueAgentRunSchema = revenueAgentRunSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  status: z.enum(["ready", "approval_required", "blocked"]),
  mainAgent: z.object({
    agent: z.string(),
    decision: z.string(),
    reason: z.string(),
  }),
  budgetGate: z.object({
    monthlyCapUsd: z.number(),
    insideCap: z.boolean(),
    cashProtected: z.boolean(),
    allowedSpendUsd: z.number(),
  }),
  clarificationGate: z.object({
    status: z.enum(["clear", "needs_clarification"]),
    missing: z.array(z.string()),
    questions: z.array(z.string()),
    minimumAnswer: z.string(),
    blocks: z.array(z.string()),
  }).optional().default({
    status: "clear",
    missing: [],
    questions: [],
    minimumAnswer: "Pedido anterior cargado antes del gate de claridad.",
    blocks: [],
  }),
  workOrder: z.array(z.object({
    step: z.string(),
    ownerAgent: z.string(),
    output: z.string(),
    approvalRequired: z.boolean(),
  })),
  subagentReviews: z.array(z.object({
    agent: z.string(),
    verdict: z.enum(["pass", "fix", "block"]),
    correction: z.string(),
  })),
  requiredApprovals: z.array(z.string()),
  nextActions: z.array(z.string()),
  learningUpdate: z.string(),
});
const persistedRevenueAutomationOpportunitySchema = revenueAutomationOpportunitySchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  quote: z.unknown(),
  qaGates: z.array(z.object({ gate: z.string(), passed: z.boolean(), fix: z.string() })),
  nextAction: z.string(),
});
const persistedRevenueWebsiteOpportunitySchema = revenueWebsiteOpportunitySchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  status: z.enum(["quoted", "scope_approved", "sold", "delivered", "blocked"]),
  businessName: z.string().trim().min(1),
  sourceLeadId: z.string().trim().min(1),
  sourceOutreachDraftId: z.string().trim().min(1),
  mockupUrl: z.string(),
  sourceUrl: z.string(),
  setupUsd: z.number(),
  requiredDepositUsd: z.number(),
  cashCollectedUsd: z.number(),
  monthlyRetainerUsd: z.number(),
  estimatedInternalCostUsd: z.number(),
  depositPaid: z.boolean(),
  scopeApproved: z.boolean(),
  paymentConfirmation: z.string(),
  qaGates: z.array(z.object({ gate: z.string(), passed: z.boolean(), fix: z.string() })),
  nextAction: z.string(),
  safety: z.object({
    sendsOutreach: z.literal(false),
    createsWorkspace: z.literal(false),
    requiresDepositAndScopeForDelivery: z.literal(true),
    blockedActions: z.array(z.string()),
  }),
});
const persistedRevenueImprovementReviewSchema = z.object({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  playbookVersion: z.number(),
  decisionStatus: z.enum(["pause_and_fix", "scale_carefully", "iterate_small_batch"]),
  learningSummary: z.string(),
  input: improvementReviewSchema,
  decision: z.object({
    status: z.enum(["pause_and_fix", "scale_carefully", "iterate_small_batch"]),
    reason: z.string(),
    approvalMode: z.string(),
  }),
  metrics: z.object({
    replyRate: z.number(),
    bookingRate: z.number(),
    closeRate: z.number(),
    profitUsd: z.number(),
    roiPercent: z.number(),
    grossMarginPercent: z.number(),
    costPerReplyUsd: z.number(),
    costPerBookedCallUsd: z.number(),
    insideSpendCap: z.boolean(),
    profitable: z.boolean(),
  }),
  experiments: z.array(z.string()),
  playbookUpdates: z.array(z.string()),
  agentScorecard: z.array(z.object({
    agent: z.string(),
    score: z.string(),
    lesson: z.string(),
  })),
  nextBatch: z.object({
    maxLeads: z.number(),
    maxSpendUsd: z.number(),
    requiredBeforeNextSend: z.array(z.string()),
  }),
});
const persistedRevenueScoutingMissionSchema = z.object({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  status: z.enum(["planned", "in_research", "ready_for_leads", "blocked"]),
  learningNote: z.string(),
  mission: z.object({
    name: z.string(),
    area: z.string(),
    niche: z.string(),
    offerFocus: z.enum(["websites", "automations", "both"]),
    targetLeadCount: z.number(),
    leadBatchSize: z.number(),
    mode: z.enum(["free_public_research", "paid_data_requires_approval"]),
  }),
  budgetGate: z.object({
    monthlyCapUsd: z.number(),
    requestedPaidDataSpendUsd: z.number(),
    approvedPaidDataSpendUsd: z.number(),
    requiresApprovalToSpend: z.boolean(),
    allowedBeforeApproval: z.array(z.string()),
    blockedBeforeApproval: z.array(z.string()),
  }),
  searchQueries: z.array(z.string()),
  leadEvidenceChecklist: z.array(z.string()),
  qualificationScorecard: z.array(z.object({
    item: z.string(),
    maxPoints: z.number(),
    signals: z.array(z.string()),
  })),
  subagentReviews: z.array(z.object({
    agent: z.string(),
    check: z.string(),
  })),
  nextActions: z.array(z.string()),
});
const persistedRevenuePublicLeadCandidateSchema = revenuePublicLeadCandidateSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  qualification: z.object({
    grade: z.enum(["A", "B", "C", "D"]),
    score: z.number(),
    recommendedStatus: z.enum(["research", "qualified", "mockup_ready", "outreach_ready", "contacted", "proposal_sent", "closed", "disqualified"]),
    nextAgent: z.string(),
    guardrail: z.string(),
    outreachDraft: z.string(),
    missing: z.array(z.string()),
  }),
  importReady: z.boolean(),
  blockedReasons: z.array(z.string()),
  batchRow: z.string(),
  safety: z.object({
    allowedAction: z.string(),
    blockedActions: z.array(z.string()),
    persistsLead: z.boolean(),
    sendsOutreach: z.boolean(),
    writesPreviewFiles: z.boolean(),
  }),
});
const persistedRevenueDailyScoutSprintSchema: z.ZodType<RevenueDailyScoutSprint> = z.object({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  status: z.enum(["open", "completed", "blocked"]),
  dispatchMode: z.enum(["manual_subagent_dispatch"]).optional(),
  executionMode: z.enum(["manual_evidence_required"]).optional(),
  blockedUntil: z.string().optional(),
  requiredExecutionBridge: z.string().optional(),
  dispatchedAt: z.string().optional(),
  dispatchSummary: z.string().optional(),
  source: z.enum(["latest_scouting_mission", "manual_override", "default_market"]),
  area: z.string().trim().min(1),
  niche: z.string().trim().min(1),
  offerFocus: z.enum(["websites", "automations", "both"]),
  targetRows: z.number(),
  tasks: z.array(z.object({
    taskId: z.string(),
    ownerAgent: z.string(),
    source: z.string(),
    query: z.string(),
    url: z.string(),
    targetRows: z.number(),
    status: z.enum(["open", "submitted", "blocked"]),
    resultSlots: z.array(z.object({
      slotId: z.string(),
      status: z.enum(["open", "filled", "rejected"]),
      evidenceTemplate: z.string(),
      copyableEvidenceBlock: z.string(),
      acceptanceCriteria: z.array(z.string()),
    })),
    allowedAction: z.string(),
    blockedActions: z.array(z.string()),
  })),
  agentBriefs: z.array(z.object({
    ownerAgent: z.string(),
    taskIds: z.array(z.string()),
    copyableBrief: z.string(),
  })),
  copyableBatchTemplate: z.string(),
  copyableOperatorBrief: z.string(),
  qualityGate: z.array(z.string()),
  nextAction: z.string(),
  safety: z.object({
    researchesPublicSources: z.literal(true),
    persistsScoutRun: z.literal(true),
    persistsCandidates: z.literal(false),
    persistsLeads: z.literal(false),
    sendsOutreach: z.literal(false),
    spendsMoney: z.literal(false),
    deploys: z.literal(false),
    requiresRobertApprovalToContact: z.literal(true),
    blockedActions: z.array(z.string()),
  }),
});
const persistedRevenueDeliveryWorkspaceSchema = z.object({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  input: revenueDeliveryWorkspaceSchema,
  status: z.enum(["ready_to_deliver", "needs_corrections", "blocked"]),
  projectPlan: z.unknown(),
  deliveryReview: z.unknown(),
  correctionQueue: z.array(z.object({
    agent: z.string(),
    priority: z.enum(["high", "medium"]),
    action: z.string(),
    blocksDelivery: z.boolean(),
  })),
  runbook: z.array(z.object({
    phase: z.string(),
    ownerAgent: z.string(),
    checklist: z.array(z.string()),
  })),
  approvalSummary: z.object({
    canShowClientPreview: z.boolean(),
    canLaunch: z.boolean(),
    requiredBeforeClient: z.array(z.string()),
  }),
  codexBuildHandoff: z.unknown().optional(),
  learningNote: z.string(),
});
const persistedRevenueApprovalDecisionSchema = revenueApprovalDecisionSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  guardrail: z.object({
    status: z.enum(["recorded", "blocked"]),
    reason: z.string(),
  }),
});
const persistedRevenueAutomationIntakeSchema = revenueAutomationIntakeSchema.extend({
  id: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  status: z.enum(["needs_answers", "ready_for_quote"]),
  quote: z.unknown(),
  missingAnswers: z.array(z.string()),
  nextQuestions: z.array(z.string()),
  answerTemplate: z.string().optional().default(""),
  blockedUntilAnswered: z.array(z.string()).optional().default([]),
  nextAction: z.string(),
});
let revenueLedgerLoaded = false;
let revenueLedgerPersistenceError: string | null = null;
let revenueLedgerPathOverride: string | null = null;
let revenueLeadsLoaded = false;
let revenueLeadsPersistenceError: string | null = null;
let revenueLeadsPathOverride: string | null = null;
let revenueOutreachLoaded = false;
let revenueOutreachPersistenceError: string | null = null;
let revenueOutreachPathOverride: string | null = null;
let revenueOutreachSenderOverride: ((payload: RevenueOutreachSendPayload) => Promise<RevenueOutreachSendResponse>) | null = null;
let revenueAgentRunsLoaded = false;
let revenueAgentRunsPersistenceError: string | null = null;
let revenueAgentRunsPathOverride: string | null = null;
let revenueAutomationOpportunitiesLoaded = false;
let revenueAutomationOpportunitiesPersistenceError: string | null = null;
let revenueAutomationOpportunitiesPathOverride: string | null = null;
let revenueWebsiteOpportunitiesLoaded = false;
let revenueWebsiteOpportunitiesPersistenceError: string | null = null;
let revenueWebsiteOpportunitiesPathOverride: string | null = null;
let revenueImprovementReviewsLoaded = false;
let revenueImprovementReviewsPersistenceError: string | null = null;
let revenueImprovementReviewsPathOverride: string | null = null;
let revenueScoutingMissionsLoaded = false;
let revenueScoutingMissionsPersistenceError: string | null = null;
let revenueScoutingMissionsPathOverride: string | null = null;
let revenueDailyScoutSprintsLoaded = false;
let revenueDailyScoutSprintsPersistenceError: string | null = null;
let revenueDailyScoutSprintsPathOverride: string | null = null;
let revenuePublicLeadCandidatesLoaded = false;
let revenuePublicLeadCandidatesPersistenceError: string | null = null;
let revenuePublicLeadCandidatesPathOverride: string | null = null;
let revenueDeliveryWorkspacesLoaded = false;
let revenueDeliveryWorkspacesPersistenceError: string | null = null;
let revenueDeliveryWorkspacesPathOverride: string | null = null;
let revenueApprovalDecisionsLoaded = false;
let revenueApprovalDecisionsPersistenceError: string | null = null;
let revenueApprovalDecisionsPathOverride: string | null = null;
let revenueAutomationIntakesLoaded = false;
let revenueAutomationIntakesPersistenceError: string | null = null;
let revenueAutomationIntakesPathOverride: string | null = null;
let revenueUserDataScope: string | null = null;
let revenueUserIdScope: string | null = null;
let revenueDurableScope: string | null = null;
let revenueDurablePersistenceStatus: "disabled" | "initializing" | "ready" | "error" = "disabled";
let revenueDurablePersistenceError: string | null = null;
let revenueEngineStateStore = createRevenueEngineStateStore();

export function setRevenueEngineStateStoreForTests(store: RevenueEngineStateStore | null) {
  revenueEngineStateStore = store || createRevenueEngineStateStore();
  revenueDurableScope = null;
  revenueDurablePersistenceStatus = "disabled";
  revenueDurablePersistenceError = null;
}

export function enableRevenueEngineDurablePersistenceForTests(userId = "owner-a") {
  const rows = new Map<string, RevenueEngineStateCollection>();
  const adapter: RevenueEngineStateAdapter = {
    async initialize() {},
    async loadCollections(ownerUserId) {
      return [...rows.values()].filter((row) => row.ownerUserId === ownerUserId);
    },
    async upsertCollection(input) {
      const key = `${input.ownerUserId}:${input.kind}`;
      const current = rows.get(key);
      if ((!current && input.expectedRevision !== undefined)
        || (current && input.expectedRevision !== current.revision)) {
        throw new Error(`state conflict for ${key}`);
      }
      const row: RevenueEngineStateCollection = {
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        data: input.data,
        revision: (current?.revision || 0) + 1,
        updatedAt: input.updatedAt,
      };
      rows.set(key, row);
      return row;
    },
  };
  revenueEngineStateStore = createRevenueEngineStateStore(adapter);
  revenueUserIdScope = buildRevenueDurableOwnerId(userId);
  revenueDurableScope = revenueUserIdScope;
  revenueDurablePersistenceStatus = "ready";
  revenueDurablePersistenceError = null;
  return rows;
}

const REVENUE_ENGINE_DATA_FILES = {
  ledger: "ledger.json",
  leads: "leads.json",
  outreach: "outreach.json",
  agentRuns: "agent_runs.json",
  automationOpportunities: "automation_opportunities.json",
  websiteOpportunities: "website_opportunities.json",
  improvementReviews: "improvement_reviews.json",
  scoutingMissions: "scouting_missions.json",
  dailyScoutSprints: "daily_scout_sprints.json",
  publicLeadCandidates: "public_lead_candidates.json",
  deliveryWorkspaces: "delivery_workspaces.json",
  approvalDecisions: "approval_decisions.json",
  automationIntakes: "automation_intakes.json",
} as const;

function safeRevenueUserId(userId: string) {
  const canonical = userId.trim();
  const readable = canonical.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "unknown-user";
  const suffix = createHash("sha256").update(canonical || "unknown-user").digest("hex").slice(0, 12);
  return `${readable}-${suffix}`;
}

function legacyRevenueUserId(userId: string) {
  const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
  return safe || "unknown-user";
}

export function buildRevenueDurableOwnerId(userId: string) {
  const canonical = userId.trim();
  if (!canonical) throw new Error("Revenue Engine owner user id is required");
  return `rev_${createHash("sha256").update(canonical).digest("hex")}`;
}

export function buildRevenueUserDataPaths(userId: string) {
  const baseDir = path.join(process.cwd(), "revenue_engine_data", "users", safeRevenueUserId(userId));
  return {
    baseDir,
    ledgerPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.ledger),
    leadsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.leads),
    outreachPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.outreach),
    agentRunsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.agentRuns),
    automationOpportunitiesPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.automationOpportunities),
    websiteOpportunitiesPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.websiteOpportunities),
    improvementReviewsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.improvementReviews),
    scoutingMissionsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.scoutingMissions),
    dailyScoutSprintsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.dailyScoutSprints),
    publicLeadCandidatesPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.publicLeadCandidates),
    deliveryWorkspacesPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.deliveryWorkspaces),
    approvalDecisionsPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.approvalDecisions),
    automationIntakesPath: path.join(baseDir, REVENUE_ENGINE_DATA_FILES.automationIntakes),
  };
}

function migrateLegacyRevenueUserData(userId: string, targetBaseDir: string) {
  const legacyBaseDir = path.join(process.cwd(), "revenue_engine_data", "users", legacyRevenueUserId(userId));
  if (legacyBaseDir === targetBaseDir || fs.existsSync(targetBaseDir) || !fs.existsSync(legacyBaseDir)) return;
  fs.mkdirSync(path.dirname(targetBaseDir), { recursive: true });
  fs.cpSync(legacyBaseDir, targetBaseDir, { recursive: true, errorOnExist: false });
}

function clearRevenueEngineMemory() {
  revenueLedger.splice(0, revenueLedger.length);
  revenueLeads.splice(0, revenueLeads.length);
  revenueOutreachDrafts.splice(0, revenueOutreachDrafts.length);
  revenueAgentRuns.splice(0, revenueAgentRuns.length);
  revenueAutomationOpportunities.splice(0, revenueAutomationOpportunities.length);
  revenueWebsiteOpportunities.splice(0, revenueWebsiteOpportunities.length);
  revenueImprovementReviews.splice(0, revenueImprovementReviews.length);
  revenueScoutingMissions.splice(0, revenueScoutingMissions.length);
  revenueDailyScoutSprints.splice(0, revenueDailyScoutSprints.length);
  revenuePublicLeadCandidates.splice(0, revenuePublicLeadCandidates.length);
  revenueDeliveryWorkspaces.splice(0, revenueDeliveryWorkspaces.length);
  revenueApprovalDecisions.splice(0, revenueApprovalDecisions.length);
  revenueAutomationIntakes.splice(0, revenueAutomationIntakes.length);
}

function markRevenueEngineDataUnloaded() {
  revenueLedgerLoaded = false;
  revenueLeadsLoaded = false;
  revenueOutreachLoaded = false;
  revenueAgentRunsLoaded = false;
  revenueAutomationOpportunitiesLoaded = false;
  revenueWebsiteOpportunitiesLoaded = false;
  revenueImprovementReviewsLoaded = false;
  revenueScoutingMissionsLoaded = false;
  revenueDailyScoutSprintsLoaded = false;
  revenuePublicLeadCandidatesLoaded = false;
  revenueDeliveryWorkspacesLoaded = false;
  revenueApprovalDecisionsLoaded = false;
  revenueAutomationIntakesLoaded = false;
}

function clearRevenueEnginePersistenceErrors() {
  revenueLedgerPersistenceError = null;
  revenueLeadsPersistenceError = null;
  revenueOutreachPersistenceError = null;
  revenueAgentRunsPersistenceError = null;
  revenueAutomationOpportunitiesPersistenceError = null;
  revenueWebsiteOpportunitiesPersistenceError = null;
  revenueImprovementReviewsPersistenceError = null;
  revenueScoutingMissionsPersistenceError = null;
  revenueDailyScoutSprintsPersistenceError = null;
  revenuePublicLeadCandidatesPersistenceError = null;
  revenueDeliveryWorkspacesPersistenceError = null;
  revenueApprovalDecisionsPersistenceError = null;
  revenueAutomationIntakesPersistenceError = null;
}

function revenueEnginePersistenceErrors() {
  return [
    revenueLedgerPersistenceError,
    revenueLeadsPersistenceError,
    revenueOutreachPersistenceError,
    revenueAgentRunsPersistenceError,
    revenueAutomationOpportunitiesPersistenceError,
    revenueWebsiteOpportunitiesPersistenceError,
    revenueImprovementReviewsPersistenceError,
    revenueScoutingMissionsPersistenceError,
    revenueDailyScoutSprintsPersistenceError,
    revenuePublicLeadCandidatesPersistenceError,
    revenueDeliveryWorkspacesPersistenceError,
    revenueApprovalDecisionsPersistenceError,
    revenueAutomationIntakesPersistenceError,
  ].filter((error): error is string => Boolean(error));
}

export function setRevenueUserDataScope(userId: string) {
  const paths = buildRevenueUserDataPaths(userId);
  if (revenueUserDataScope === paths.baseDir) return paths;
  migrateLegacyRevenueUserData(userId, paths.baseDir);
  revenueUserDataScope = paths.baseDir;
  revenueUserIdScope = buildRevenueDurableOwnerId(userId);
  revenueDurableScope = null;
  revenueLedgerPathOverride = paths.ledgerPath;
  revenueLeadsPathOverride = paths.leadsPath;
  revenueOutreachPathOverride = paths.outreachPath;
  revenueAgentRunsPathOverride = paths.agentRunsPath;
  revenueAutomationOpportunitiesPathOverride = paths.automationOpportunitiesPath;
  revenueWebsiteOpportunitiesPathOverride = paths.websiteOpportunitiesPath;
  revenueImprovementReviewsPathOverride = paths.improvementReviewsPath;
  revenueScoutingMissionsPathOverride = paths.scoutingMissionsPath;
  revenueDailyScoutSprintsPathOverride = paths.dailyScoutSprintsPath;
  revenuePublicLeadCandidatesPathOverride = paths.publicLeadCandidatesPath;
  revenueDeliveryWorkspacesPathOverride = paths.deliveryWorkspacesPath;
  revenueApprovalDecisionsPathOverride = paths.approvalDecisionsPath;
  revenueAutomationIntakesPathOverride = paths.automationIntakesPath;
  clearRevenueEngineMemory();
  clearRevenueEnginePersistenceErrors();
  markRevenueEngineDataUnloaded();
  return paths;
}

function getRevenueLedgerPath() {
  return revenueLedgerPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_LEDGER_PATH", "ledger.json");
}

function getRevenueLeadsPath() {
  return revenueLeadsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_LEADS_PATH", "leads.json");
}

function getRevenueOutreachPath() {
  return revenueOutreachPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_OUTREACH_PATH", "outreach.json");
}

function getRevenueMockupsDir() {
  const configuredPath = process.env.REVENUE_MOCKUPS_DIR;
  const rootDir = configuredPath !== undefined && hasRealValue(configuredPath)
    ? configuredPath
    : path.join(process.cwd(), "revenue_mockups");
  const scopeName = revenueUserDataScope ? path.basename(revenueUserDataScope) : "default";
  return path.join(rootDir, safeRevenueUserId(scopeName), "previews");
}

function getRevenueEnginePathEnv(envName: string, defaultFileName: string): string {
  const configuredPath = process.env[envName];
  if (configuredPath !== undefined && hasRealValue(configuredPath)) return configuredPath;
  if (defaultFileName.includes(path.sep) || defaultFileName.includes("/")) return path.join(process.cwd(), defaultFileName);
  return path.join(process.cwd(), "revenue_engine_data", defaultFileName);
}

function slugifyRevenueValue(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "preview";
}

export function isRevenueCodexBranchName(value: string) {
  return /^codex\/[A-Za-z0-9._/-]+$/.test(value.trim());
}

function isRevenueGithubRepoFullName(value: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.trim());
}

function buildRevenueGithubHandoffRequest(workspace: RevenueDeliveryWorkspace) {
  const repoFullName = workspace.codexBuildHandoff.repoFullName.trim();
  const branchName = workspace.codexBuildHandoff.branchName.trim();
  return JSON.stringify({
    workspaceId: workspace.id,
    ...(isRevenueGithubRepoFullName(repoFullName) ? { repoFullName } : {}),
    ...(isRevenueCodexBranchName(branchName) ? { branchName } : {}),
  }, null, 2);
}

function buildRevenueReleaseGateRequest(workspace: RevenueDeliveryWorkspace) {
  const handoff = workspace.codexBuildHandoff;
  return JSON.stringify({
    workspaceId: workspace.id,
    repoFullName: handoff.repoFullName,
    branchName: handoff.branchName,
    githubIssueUrl: handoff.githubIssueUrl,
    prUrl: handoff.prUrl,
    secondReviewStatus: handoff.secondReviewStatus,
    secondReviewEvidenceUrl: handoff.secondReviewEvidenceUrl,
    appQaStatus: handoff.appQaStatus,
    appQaEvidenceUrl: handoff.appQaEvidenceUrl,
    deploymentApprovalStatus: handoff.deploymentApprovalStatus,
    deploymentApprovalUrl: handoff.deploymentApprovalUrl,
    releaseGateHeadSha: handoff.releaseGateHeadSha,
    notes: [
      `Robert release gate from Revenue Engine for workspace ${workspace.id}.`,
      `Client ${workspace.input.clientName}.`,
      `Branch ${handoff.branchName}.`,
      `second review=${handoff.secondReviewStatus}.`,
      `app qa=${handoff.appQaStatus}.`,
      `Robert approval=${handoff.deploymentApprovalStatus}.`,
    ].join(" "),
  }, null, 2);
}

const GENERIC_REVENUE_PAYMENT_EVIDENCE = new Set([
  "approved",
  "cash",
  "collected",
  "confirmed",
  "deposit",
  "done",
  "ok",
  "paid",
  "payment",
  "received",
  "sent",
  "yes",
]);

function normalizeRevenuePaymentEvidence(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasRevenuePaymentEvidence(value: string) {
  const trimmed = value.trim();
  if (!hasRealValue(trimmed) || trimmed.length < 8) return false;

  const normalized = normalizeRevenuePaymentEvidence(trimmed);
  if (GENERIC_REVENUE_PAYMENT_EVIDENCE.has(normalized)) return false;
  if (/^(paid|cash|deposit|payment|received|collected)\s+\$?\d+(\.\d{1,2})?$/.test(normalized)) return false;

  const lower = trimmed.toLowerCase();
  if (/\b(?:pi|ch)_[a-z0-9]{6,}\b/i.test(trimmed)) return true;

  const hasPaymentProvider = /\b(zelle|venmo|cashapp|cash app|paypal|stripe|square|clover|ach|wire|bank transfer)\b/.test(lower);
  const hasReferenceLabel = /\b(ref|reference|receipt|invoice|txn|transaction|confirmation|confirmacion|comprobante|payment id|charge id)\b/.test(lower);
  const normalizedTokens = normalized.split(" ");
  const hasSpecificToken = /\b\d{3,}\b/.test(normalized)
    || normalizedTokens.some((token) => token.length >= 6 && /[a-z]/.test(token) && /\d/.test(token))
    || /\b[a-z]{2,}[-_][a-z0-9][a-z0-9_-]{2,}\b/i.test(trimmed);

  return hasSpecificToken && (hasPaymentProvider || hasReferenceLabel);
}

function isRevenueIncomeEntry(kind: RevenueLedgerEntryInput["kind"]) {
  return kind !== "expense";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getRevenueEmailProviderStatus(): RevenueEmailProviderStatus {
  const fromEmail = [process.env.REVENUE_ENGINE_FROM_EMAIL, process.env.RESEND_FROM_EMAIL].find(hasRealValue) || "";
  const missing = [
    !hasRealValue(process.env.RESEND_API_KEY) && "RESEND_API_KEY",
    !hasRealValue(fromEmail) && "REVENUE_ENGINE_FROM_EMAIL",
  ].filter((item): item is string => Boolean(item));

  return {
    provider: "resend",
    configured: missing.length === 0,
    mode: missing.length === 0 ? "api" : "manual",
    fromEmail,
    missing,
    monthlyCostUsd: 0,
    sendPolicy: "Solo envia drafts approved con approvalToSend=true; si falta provider queda en Gmail/mailto manual.",
  };
}

function textToHtml(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim().length > 0 ? line : "&nbsp;")
    .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("");
}

async function sendWithResend(payload: RevenueOutreachSendPayload): Promise<RevenueOutreachSendResponse> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": payload.idempotencyKey,
    },
    body: JSON.stringify({
      from: payload.from,
      to: [payload.to],
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      tags: [
        { name: "system", value: "revenue_engine" },
        { name: "draft_id", value: payload.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 256) },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : `Resend API failed with ${response.status}`;
    throw new Error(message);
  }
  if (typeof data?.id !== "string" || data.id.trim().length === 0) {
    throw new Error("Resend API did not return a message id");
  }
  return { id: data.id };
}

async function sendRevenueOutreachPayload(payload: RevenueOutreachSendPayload) {
  if (revenueOutreachSenderOverride) return revenueOutreachSenderOverride(payload);
  return sendWithResend(payload);
}

function getRevenueAgentRunsPath() {
  return revenueAgentRunsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_AGENT_RUNS_PATH", "agent_runs.json");
}

function getRevenueAutomationOpportunitiesPath() {
  return revenueAutomationOpportunitiesPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_AUTOMATION_OPPORTUNITIES_PATH", "automation_opportunities.json");
}

function getRevenueWebsiteOpportunitiesPath() {
  return revenueWebsiteOpportunitiesPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_WEBSITE_OPPORTUNITIES_PATH", "website_opportunities.json");
}

function getRevenueImprovementReviewsPath() {
  return revenueImprovementReviewsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_IMPROVEMENT_REVIEWS_PATH", "improvement_reviews.json");
}

function getRevenueScoutingMissionsPath() {
  return revenueScoutingMissionsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_SCOUTING_MISSIONS_PATH", "scouting_missions.json");
}

function getRevenueDailyScoutSprintsPath() {
  return revenueDailyScoutSprintsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_DAILY_SCOUT_SPRINTS_PATH", "daily_scout_sprints.json");
}

function getRevenuePublicLeadCandidatesPath() {
  return revenuePublicLeadCandidatesPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH", "public_lead_candidates.json");
}

function getRevenueDeliveryWorkspacesPath() {
  return revenueDeliveryWorkspacesPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_DELIVERY_WORKSPACES_PATH", "delivery_workspaces.json");
}

function getRevenueApprovalDecisionsPath() {
  return revenueApprovalDecisionsPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_APPROVAL_DECISIONS_PATH", "approval_decisions.json");
}

function getRevenueAutomationIntakesPath() {
  return revenueAutomationIntakesPathOverride || getRevenueEnginePathEnv("REVENUE_ENGINE_AUTOMATION_INTAKES_PATH", "automation_intakes.json");
}

function loadRevenueLedger() {
  if (revenueLedgerLoaded) return;
  revenueLedgerLoaded = true;
  const ledgerPath = getRevenueLedgerPath();

  if (!fs.existsSync(ledgerPath)) return;

  try {
    const raw = fs.readFileSync(ledgerPath, "utf8");
    const parsed = z.array(persistedRevenueLedgerEntrySchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueLedgerPersistenceError = "Ledger local invalido; no se cargo para evitar metricas incorrectas.";
      return;
    }
    revenueLedger.splice(0, revenueLedger.length, ...parsed.data);
    revenueLedgerPersistenceError = null;
  } catch (error) {
    revenueLedgerPersistenceError = error instanceof Error ? error.message : "No se pudo leer el ledger local.";
  }
}

function loadRevenueLeads() {
  if (revenueLeadsLoaded) return;
  revenueLeadsLoaded = true;
  const leadsPath = getRevenueLeadsPath();

  if (!fs.existsSync(leadsPath)) return;

  try {
    const raw = fs.readFileSync(leadsPath, "utf8");
    const parsed = z.array(persistedRevenueLeadSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueLeadsPersistenceError = "Leads locales invalidos; no se cargaron para evitar pipeline incorrecto.";
      return;
    }
    revenueLeads.splice(0, revenueLeads.length, ...parsed.data);
    revenueLeadsPersistenceError = null;
  } catch (error) {
    revenueLeadsPersistenceError = error instanceof Error ? error.message : "No se pudo leer el archivo local de leads.";
  }
}

function loadRevenueOutreach() {
  if (revenueOutreachLoaded) return;
  revenueOutreachLoaded = true;
  const outreachPath = getRevenueOutreachPath();

  if (!fs.existsSync(outreachPath)) return;

  try {
    const raw = fs.readFileSync(outreachPath, "utf8");
    const parsed = z.array(persistedRevenueOutreachDraftSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueOutreachPersistenceError = "Outreach local invalido; no se cargo para evitar contactos incorrectos.";
      return;
    }
    revenueOutreachDrafts.splice(0, revenueOutreachDrafts.length, ...parsed.data);
    revenueOutreachPersistenceError = null;
  } catch (error) {
    revenueOutreachPersistenceError = error instanceof Error ? error.message : "No se pudo leer el outbox local.";
  }
}

function loadRevenueAgentRuns() {
  if (revenueAgentRunsLoaded) return;
  revenueAgentRunsLoaded = true;
  const agentRunsPath = getRevenueAgentRunsPath();

  if (!fs.existsSync(agentRunsPath)) return;

  try {
    const raw = fs.readFileSync(agentRunsPath, "utf8");
    const parsed = z.array(persistedRevenueAgentRunSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueAgentRunsPersistenceError = "Corridas de agente invalidas; no se cargaron para evitar decisiones incorrectas.";
      return;
    }
    revenueAgentRuns.splice(0, revenueAgentRuns.length, ...parsed.data);
    revenueAgentRunsPersistenceError = null;
  } catch (error) {
    revenueAgentRunsPersistenceError = error instanceof Error ? error.message : "No se pudo leer el archivo local de corridas.";
  }
}

function loadRevenueAutomationOpportunities() {
  if (revenueAutomationOpportunitiesLoaded) return;
  revenueAutomationOpportunitiesLoaded = true;
  const opportunitiesPath = getRevenueAutomationOpportunitiesPath();

  if (!fs.existsSync(opportunitiesPath)) return;

  try {
    const raw = fs.readFileSync(opportunitiesPath, "utf8");
    const parsed = z.array(persistedRevenueAutomationOpportunitySchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueAutomationOpportunitiesPersistenceError = "Oportunidades de automatizacion invalidas; no se cargaron.";
      return;
    }
    revenueAutomationOpportunities.splice(0, revenueAutomationOpportunities.length, ...(parsed.data as RevenueAutomationOpportunity[]));
    revenueAutomationOpportunitiesPersistenceError = null;
  } catch (error) {
    revenueAutomationOpportunitiesPersistenceError = error instanceof Error ? error.message : "No se pudo leer oportunidades de automatizacion.";
  }
}

function loadRevenueWebsiteOpportunities() {
  if (revenueWebsiteOpportunitiesLoaded) return;
  revenueWebsiteOpportunitiesLoaded = true;
  const opportunitiesPath = getRevenueWebsiteOpportunitiesPath();

  if (!fs.existsSync(opportunitiesPath)) return;

  try {
    const raw = fs.readFileSync(opportunitiesPath, "utf8");
    const parsed = z.array(persistedRevenueWebsiteOpportunitySchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueWebsiteOpportunitiesPersistenceError = "Website opportunities invalidas; no se cargaron.";
      return;
    }
    revenueWebsiteOpportunities.splice(0, revenueWebsiteOpportunities.length, ...(parsed.data as RevenueWebsiteOpportunity[]));
    revenueWebsiteOpportunitiesPersistenceError = null;
  } catch (error) {
    revenueWebsiteOpportunitiesPersistenceError = error instanceof Error ? error.message : "No se pudo leer website opportunities.";
  }
}

function loadRevenueImprovementReviews() {
  if (revenueImprovementReviewsLoaded) return;
  revenueImprovementReviewsLoaded = true;
  const reviewsPath = getRevenueImprovementReviewsPath();

  if (!fs.existsSync(reviewsPath)) return;

  try {
    const raw = fs.readFileSync(reviewsPath, "utf8");
    const parsed = z.array(persistedRevenueImprovementReviewSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueImprovementReviewsPersistenceError = "Reviews de mejora invalidos; no se cargaron para evitar aprendizajes incorrectos.";
      return;
    }
    revenueImprovementReviews.splice(0, revenueImprovementReviews.length, ...(parsed.data as RevenueImprovementReview[]));
    revenueImprovementReviewsPersistenceError = null;
  } catch (error) {
    revenueImprovementReviewsPersistenceError = error instanceof Error ? error.message : "No se pudo leer reviews de mejora.";
  }
}

function loadRevenueScoutingMissions() {
  if (revenueScoutingMissionsLoaded) return;
  revenueScoutingMissionsLoaded = true;
  const missionsPath = getRevenueScoutingMissionsPath();

  if (!fs.existsSync(missionsPath)) return;

  try {
    const raw = fs.readFileSync(missionsPath, "utf8");
    const parsed = z.array(persistedRevenueScoutingMissionSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueScoutingMissionsPersistenceError = "Misiones de scouting invalidas; no se cargaron.";
      return;
    }
    revenueScoutingMissions.splice(0, revenueScoutingMissions.length, ...(parsed.data as RevenueScoutingMission[]));
    revenueScoutingMissionsPersistenceError = null;
  } catch (error) {
    revenueScoutingMissionsPersistenceError = error instanceof Error ? error.message : "No se pudo leer misiones de scouting.";
  }
}

function loadRevenueDailyScoutSprints() {
  if (revenueDailyScoutSprintsLoaded) return;
  revenueDailyScoutSprintsLoaded = true;
  const sprintsPath = getRevenueDailyScoutSprintsPath();

  if (!fs.existsSync(sprintsPath)) return;

  try {
    const raw = fs.readFileSync(sprintsPath, "utf8");
    const parsed = z.array(persistedRevenueDailyScoutSprintSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueDailyScoutSprintsPersistenceError = "Daily scout sprints invalidos; no se cargaron.";
      return;
    }
    revenueDailyScoutSprints.splice(0, revenueDailyScoutSprints.length, ...parsed.data);
    revenueDailyScoutSprintsPersistenceError = null;
  } catch (error) {
    revenueDailyScoutSprintsPersistenceError = error instanceof Error ? error.message : "No se pudo leer daily scout sprints.";
  }
}

function loadRevenuePublicLeadCandidates() {
  if (revenuePublicLeadCandidatesLoaded) return;
  revenuePublicLeadCandidatesLoaded = true;
  const candidatesPath = getRevenuePublicLeadCandidatesPath();

  if (!fs.existsSync(candidatesPath)) return;

  try {
    const raw = fs.readFileSync(candidatesPath, "utf8");
    const parsed = z.array(persistedRevenuePublicLeadCandidateSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenuePublicLeadCandidatesPersistenceError = "Candidatos publicos invalidos; no se cargaron.";
      return;
    }
    revenuePublicLeadCandidates.splice(0, revenuePublicLeadCandidates.length, ...(parsed.data as RevenuePublicLeadCandidate[]));
    revenuePublicLeadCandidatesPersistenceError = null;
  } catch (error) {
    revenuePublicLeadCandidatesPersistenceError = error instanceof Error ? error.message : "No se pudo leer candidatos publicos.";
  }
}

function loadRevenueDeliveryWorkspaces() {
  if (revenueDeliveryWorkspacesLoaded) return;
  revenueDeliveryWorkspacesLoaded = true;
  const workspacesPath = getRevenueDeliveryWorkspacesPath();

  if (!fs.existsSync(workspacesPath)) return;

  try {
    const raw = fs.readFileSync(workspacesPath, "utf8");
    const parsed = z.array(persistedRevenueDeliveryWorkspaceSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueDeliveryWorkspacesPersistenceError = "Delivery workspaces invalidos; no se cargaron para evitar entregas incorrectas.";
      return;
    }
    const workspaces = (parsed.data as RevenueDeliveryWorkspace[]).map((workspace) => ({
      ...buildRevenueDeliveryWorkspace(workspace.input),
      id: workspace.id,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }));
    revenueDeliveryWorkspaces.splice(0, revenueDeliveryWorkspaces.length, ...workspaces);
    revenueDeliveryWorkspacesPersistenceError = null;
  } catch (error) {
    revenueDeliveryWorkspacesPersistenceError = error instanceof Error ? error.message : "No se pudo leer delivery workspaces.";
  }
}

function loadRevenueApprovalDecisions() {
  if (revenueApprovalDecisionsLoaded) return;
  revenueApprovalDecisionsLoaded = true;
  const decisionsPath = getRevenueApprovalDecisionsPath();

  if (!fs.existsSync(decisionsPath)) return;

  try {
    const raw = fs.readFileSync(decisionsPath, "utf8");
    const parsed = z.array(persistedRevenueApprovalDecisionSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueApprovalDecisionsPersistenceError = "Approval decisions invalidas; no se cargaron.";
      return;
    }
    revenueApprovalDecisions.splice(0, revenueApprovalDecisions.length, ...parsed.data);
    revenueApprovalDecisionsPersistenceError = null;
  } catch (error) {
    revenueApprovalDecisionsPersistenceError = error instanceof Error ? error.message : "No se pudo leer approval decisions.";
  }
}

function loadRevenueAutomationIntakes() {
  if (revenueAutomationIntakesLoaded) return;
  revenueAutomationIntakesLoaded = true;
  const intakesPath = getRevenueAutomationIntakesPath();

  if (!fs.existsSync(intakesPath)) return;

  try {
    const raw = fs.readFileSync(intakesPath, "utf8");
    const parsed = z.array(persistedRevenueAutomationIntakeSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) {
      revenueAutomationIntakesPersistenceError = "Automation intakes invalidos; no se cargaron.";
      return;
    }
    revenueAutomationIntakes.splice(0, revenueAutomationIntakes.length, ...(parsed.data as RevenueAutomationIntake[]));
    revenueAutomationIntakesPersistenceError = null;
  } catch (error) {
    revenueAutomationIntakesPersistenceError = error instanceof Error ? error.message : "No se pudo leer automation intakes.";
  }
}

function persistRevenueLedger() {
  const ledgerPath = getRevenueLedgerPath();
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, `${JSON.stringify(revenueLedger, null, 2)}\n`, "utf8");
    revenueLedgerPersistenceError = null;
    queueRevenueDurableCollection("ledger", revenueLedger);
  } catch (error) {
    revenueLedgerPersistenceError = error instanceof Error ? error.message : "No se pudo guardar el ledger local.";
    throw error;
  }
}

function persistRevenueLeads() {
  const leadsPath = getRevenueLeadsPath();
  try {
    fs.mkdirSync(path.dirname(leadsPath), { recursive: true });
    fs.writeFileSync(leadsPath, `${JSON.stringify(revenueLeads, null, 2)}\n`, "utf8");
    revenueLeadsPersistenceError = null;
    queueRevenueDurableCollection("leads", revenueLeads);
  } catch (error) {
    revenueLeadsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar el archivo local de leads.";
    throw error;
  }
}

function persistRevenueOutreach() {
  const outreachPath = getRevenueOutreachPath();
  try {
    fs.mkdirSync(path.dirname(outreachPath), { recursive: true });
    fs.writeFileSync(outreachPath, `${JSON.stringify(revenueOutreachDrafts, null, 2)}\n`, "utf8");
    revenueOutreachPersistenceError = null;
    queueRevenueDurableCollection("outreach", revenueOutreachDrafts);
  } catch (error) {
    revenueOutreachPersistenceError = error instanceof Error ? error.message : "No se pudo guardar el outbox local.";
    throw error;
  }
}

function persistRevenueAgentRuns() {
  const agentRunsPath = getRevenueAgentRunsPath();
  try {
    fs.mkdirSync(path.dirname(agentRunsPath), { recursive: true });
    fs.writeFileSync(agentRunsPath, `${JSON.stringify(revenueAgentRuns, null, 2)}\n`, "utf8");
    revenueAgentRunsPersistenceError = null;
    queueRevenueDurableCollection("agentRuns", revenueAgentRuns);
  } catch (error) {
    revenueAgentRunsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar la corrida de agente.";
    throw error;
  }
}

function persistRevenueAutomationOpportunities() {
  const opportunitiesPath = getRevenueAutomationOpportunitiesPath();
  try {
    fs.mkdirSync(path.dirname(opportunitiesPath), { recursive: true });
    fs.writeFileSync(opportunitiesPath, `${JSON.stringify(revenueAutomationOpportunities, null, 2)}\n`, "utf8");
    revenueAutomationOpportunitiesPersistenceError = null;
    queueRevenueDurableCollection("automationOpportunities", revenueAutomationOpportunities);
  } catch (error) {
    revenueAutomationOpportunitiesPersistenceError = error instanceof Error ? error.message : "No se pudo guardar oportunidad de automatizacion.";
    throw error;
  }
}

function persistRevenueWebsiteOpportunities() {
  const opportunitiesPath = getRevenueWebsiteOpportunitiesPath();
  try {
    fs.mkdirSync(path.dirname(opportunitiesPath), { recursive: true });
    fs.writeFileSync(opportunitiesPath, `${JSON.stringify(revenueWebsiteOpportunities, null, 2)}\n`, "utf8");
    revenueWebsiteOpportunitiesPersistenceError = null;
    queueRevenueDurableCollection("websiteOpportunities", revenueWebsiteOpportunities);
  } catch (error) {
    revenueWebsiteOpportunitiesPersistenceError = error instanceof Error ? error.message : "No se pudo guardar website opportunity.";
    throw error;
  }
}

function persistRevenueImprovementReviews() {
  const reviewsPath = getRevenueImprovementReviewsPath();
  try {
    fs.mkdirSync(path.dirname(reviewsPath), { recursive: true });
    fs.writeFileSync(reviewsPath, `${JSON.stringify(revenueImprovementReviews, null, 2)}\n`, "utf8");
    revenueImprovementReviewsPersistenceError = null;
    queueRevenueDurableCollection("improvementReviews", revenueImprovementReviews);
  } catch (error) {
    revenueImprovementReviewsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar review de mejora.";
    throw error;
  }
}

function persistRevenueScoutingMissions() {
  const missionsPath = getRevenueScoutingMissionsPath();
  try {
    fs.mkdirSync(path.dirname(missionsPath), { recursive: true });
    fs.writeFileSync(missionsPath, `${JSON.stringify(revenueScoutingMissions, null, 2)}\n`, "utf8");
    revenueScoutingMissionsPersistenceError = null;
    queueRevenueDurableCollection("scoutingMissions", revenueScoutingMissions);
  } catch (error) {
    revenueScoutingMissionsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar mision de scouting.";
    throw error;
  }
}

function persistRevenueDailyScoutSprints() {
  const sprintsPath = getRevenueDailyScoutSprintsPath();
  try {
    fs.mkdirSync(path.dirname(sprintsPath), { recursive: true });
    fs.writeFileSync(sprintsPath, `${JSON.stringify(revenueDailyScoutSprints, null, 2)}\n`, "utf8");
    revenueDailyScoutSprintsPersistenceError = null;
    queueRevenueDurableCollection("dailyScoutSprints", revenueDailyScoutSprints);
  } catch (error) {
    revenueDailyScoutSprintsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar daily scout sprint.";
    throw error;
  }
}

function persistRevenuePublicLeadCandidates() {
  const candidatesPath = getRevenuePublicLeadCandidatesPath();
  try {
    fs.mkdirSync(path.dirname(candidatesPath), { recursive: true });
    fs.writeFileSync(candidatesPath, `${JSON.stringify(revenuePublicLeadCandidates, null, 2)}\n`, "utf8");
    revenuePublicLeadCandidatesPersistenceError = null;
    queueRevenueDurableCollection("publicLeadCandidates", revenuePublicLeadCandidates);
  } catch (error) {
    revenuePublicLeadCandidatesPersistenceError = error instanceof Error ? error.message : "No se pudo guardar candidatos publicos.";
    throw error;
  }
}

function persistRevenueDeliveryWorkspaces() {
  const workspacesPath = getRevenueDeliveryWorkspacesPath();
  try {
    fs.mkdirSync(path.dirname(workspacesPath), { recursive: true });
    fs.writeFileSync(workspacesPath, `${JSON.stringify(revenueDeliveryWorkspaces, null, 2)}\n`, "utf8");
    revenueDeliveryWorkspacesPersistenceError = null;
    queueRevenueDurableCollection("deliveryWorkspaces", revenueDeliveryWorkspaces);
  } catch (error) {
    revenueDeliveryWorkspacesPersistenceError = error instanceof Error ? error.message : "No se pudo guardar delivery workspace.";
    throw error;
  }
}

function persistRevenueApprovalDecisions() {
  const decisionsPath = getRevenueApprovalDecisionsPath();
  try {
    fs.mkdirSync(path.dirname(decisionsPath), { recursive: true });
    fs.writeFileSync(decisionsPath, `${JSON.stringify(revenueApprovalDecisions, null, 2)}\n`, "utf8");
    revenueApprovalDecisionsPersistenceError = null;
    queueRevenueDurableCollection("approvalDecisions", revenueApprovalDecisions);
  } catch (error) {
    revenueApprovalDecisionsPersistenceError = error instanceof Error ? error.message : "No se pudo guardar approval decision.";
    throw error;
  }
}

function persistRevenueAutomationIntakes() {
  const intakesPath = getRevenueAutomationIntakesPath();
  try {
    fs.mkdirSync(path.dirname(intakesPath), { recursive: true });
    fs.writeFileSync(intakesPath, `${JSON.stringify(revenueAutomationIntakes, null, 2)}\n`, "utf8");
    revenueAutomationIntakesPersistenceError = null;
    queueRevenueDurableCollection("automationIntakes", revenueAutomationIntakes);
  } catch (error) {
    revenueAutomationIntakesPersistenceError = error instanceof Error ? error.message : "No se pudo guardar automation intake.";
    throw error;
  }
}

const revenueDurableCollectionKinds = [
  "ledger",
  "leads",
  "outreach",
  "agentRuns",
  "automationOpportunities",
  "websiteOpportunities",
  "improvementReviews",
  "scoutingMissions",
  "dailyScoutSprints",
  "publicLeadCandidates",
  "deliveryWorkspaces",
  "approvalDecisions",
  "automationIntakes",
] as const;

type RevenueDurableCollectionKind = typeof revenueDurableCollectionKinds[number];

function revenueDurableCollectionData(kind: RevenueDurableCollectionKind): unknown[] {
  switch (kind) {
    case "ledger": return revenueLedger;
    case "leads": return revenueLeads;
    case "outreach": return revenueOutreachDrafts;
    case "agentRuns": return revenueAgentRuns;
    case "automationOpportunities": return revenueAutomationOpportunities;
    case "websiteOpportunities": return revenueWebsiteOpportunities;
    case "improvementReviews": return revenueImprovementReviews;
    case "scoutingMissions": return revenueScoutingMissions;
    case "dailyScoutSprints": return revenueDailyScoutSprints;
    case "publicLeadCandidates": return revenuePublicLeadCandidates;
    case "deliveryWorkspaces": return revenueDeliveryWorkspaces;
    case "approvalDecisions": return revenueApprovalDecisions;
    case "automationIntakes": return revenueAutomationIntakes;
  }
}

function cloneRevenueDurableData(data: unknown[]): unknown[] {
  return JSON.parse(JSON.stringify(data)) as unknown[];
}

function queueRevenueDurableCollection(kind: RevenueDurableCollectionKind, data: unknown[]) {
  if (revenueDurablePersistenceStatus !== "ready" || !revenueUserIdScope || revenueDurableScope !== revenueUserIdScope) return;
  void revenueEngineStateStore.upsertCollection({
    ownerUserId: revenueUserIdScope,
    kind,
    data: cloneRevenueDurableData(data),
  }).catch((error: unknown) => {
    revenueDurablePersistenceStatus = "error";
    revenueDurablePersistenceError = error instanceof Error ? error.message : String(error);
  });
}

function loadAllRevenueEngineCollections() {
  loadRevenueLedger();
  loadRevenueLeads();
  loadRevenueOutreach();
  loadRevenueAgentRuns();
  loadRevenueAutomationOpportunities();
  loadRevenueWebsiteOpportunities();
  loadRevenueImprovementReviews();
  loadRevenueScoutingMissions();
  loadRevenueDailyScoutSprints();
  loadRevenuePublicLeadCandidates();
  loadRevenueDeliveryWorkspaces();
  loadRevenueApprovalDecisions();
  loadRevenueAutomationIntakes();
}

function applyRevenueDurableCollection(kind: RevenueDurableCollectionKind, data: unknown) {
  switch (kind) {
    case "ledger": {
      const parsed = z.array(persistedRevenueLedgerEntrySchema).parse(data);
      revenueLedger.splice(0, revenueLedger.length, ...parsed);
      revenueLedgerLoaded = true;
      return;
    }
    case "leads": {
      const parsed = z.array(persistedRevenueLeadSchema).parse(data);
      revenueLeads.splice(0, revenueLeads.length, ...parsed);
      revenueLeadsLoaded = true;
      return;
    }
    case "outreach": {
      const parsed = z.array(persistedRevenueOutreachDraftSchema).parse(data) as RevenueOutreachDraft[];
      revenueOutreachDrafts.splice(0, revenueOutreachDrafts.length, ...parsed);
      revenueOutreachLoaded = true;
      return;
    }
    case "agentRuns": {
      const parsed = z.array(persistedRevenueAgentRunSchema).parse(data) as RevenueAgentRun[];
      revenueAgentRuns.splice(0, revenueAgentRuns.length, ...parsed);
      revenueAgentRunsLoaded = true;
      return;
    }
    case "automationOpportunities": {
      const parsed = z.array(persistedRevenueAutomationOpportunitySchema).parse(data) as RevenueAutomationOpportunity[];
      revenueAutomationOpportunities.splice(0, revenueAutomationOpportunities.length, ...parsed);
      revenueAutomationOpportunitiesLoaded = true;
      return;
    }
    case "websiteOpportunities": {
      const parsed = z.array(persistedRevenueWebsiteOpportunitySchema).parse(data) as RevenueWebsiteOpportunity[];
      revenueWebsiteOpportunities.splice(0, revenueWebsiteOpportunities.length, ...parsed);
      revenueWebsiteOpportunitiesLoaded = true;
      return;
    }
    case "improvementReviews": {
      const parsed = z.array(persistedRevenueImprovementReviewSchema).parse(data) as RevenueImprovementReview[];
      revenueImprovementReviews.splice(0, revenueImprovementReviews.length, ...parsed);
      revenueImprovementReviewsLoaded = true;
      return;
    }
    case "scoutingMissions": {
      const parsed = z.array(persistedRevenueScoutingMissionSchema).parse(data) as RevenueScoutingMission[];
      revenueScoutingMissions.splice(0, revenueScoutingMissions.length, ...parsed);
      revenueScoutingMissionsLoaded = true;
      return;
    }
    case "dailyScoutSprints": {
      const parsed = z.array(persistedRevenueDailyScoutSprintSchema).parse(data);
      revenueDailyScoutSprints.splice(0, revenueDailyScoutSprints.length, ...parsed);
      revenueDailyScoutSprintsLoaded = true;
      return;
    }
    case "publicLeadCandidates": {
      const parsed = z.array(persistedRevenuePublicLeadCandidateSchema).parse(data) as RevenuePublicLeadCandidate[];
      revenuePublicLeadCandidates.splice(0, revenuePublicLeadCandidates.length, ...parsed);
      revenuePublicLeadCandidatesLoaded = true;
      return;
    }
    case "deliveryWorkspaces": {
      const parsed = z.array(persistedRevenueDeliveryWorkspaceSchema).parse(data) as RevenueDeliveryWorkspace[];
      const workspaces = parsed.map((workspace) => ({
        ...buildRevenueDeliveryWorkspace(workspace.input),
        id: workspace.id,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      }));
      revenueDeliveryWorkspaces.splice(0, revenueDeliveryWorkspaces.length, ...workspaces);
      revenueDeliveryWorkspacesLoaded = true;
      return;
    }
    case "approvalDecisions": {
      const parsed = z.array(persistedRevenueApprovalDecisionSchema).parse(data);
      revenueApprovalDecisions.splice(0, revenueApprovalDecisions.length, ...parsed);
      revenueApprovalDecisionsLoaded = true;
      return;
    }
    case "automationIntakes": {
      const parsed = z.array(persistedRevenueAutomationIntakeSchema).parse(data) as RevenueAutomationIntake[];
      revenueAutomationIntakes.splice(0, revenueAutomationIntakes.length, ...parsed);
      revenueAutomationIntakesLoaded = true;
    }
  }
}

export async function initializeRevenueEnginePersistence() {
  const databaseUrl = resolveDatabaseConnectionString();
  if (!databaseUrl) {
    revenueDurablePersistenceStatus = "disabled";
    revenueDurablePersistenceError = null;
    return { status: "disabled" as const };
  }

  revenueDurablePersistenceStatus = "initializing";
  try {
    await revenueEngineStateStore.initialize();
    revenueDurablePersistenceError = null;
    return { status: "initialized" as const };
  } catch (error) {
    revenueDurablePersistenceStatus = "error";
    revenueDurablePersistenceError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export async function prepareRevenueEngineState(userId: string) {
  setRevenueUserDataScope(userId);
  const databaseUrl = resolveDatabaseConnectionString();
  if (!databaseUrl) {
    revenueDurablePersistenceStatus = "disabled";
    revenueDurablePersistenceError = null;
    loadAllRevenueEngineCollections();
    return { status: "local_file" as const };
  }
  if (revenueDurablePersistenceStatus === "ready" && revenueDurableScope === revenueUserIdScope) {
    return { status: "ready" as const, ownerUserId: revenueUserIdScope };
  }

  revenueDurablePersistenceStatus = "initializing";
  revenueDurablePersistenceError = null;
  try {
    const ownerUserId = revenueUserIdScope || buildRevenueDurableOwnerId(userId);
    const rows = await revenueEngineStateStore.loadCollections(ownerUserId);
    const rowsByKind = new Map(rows.map((row) => [row.kind, row.data]));
    const missingKinds = revenueDurableCollectionKinds.filter((kind) => !rowsByKind.has(kind));
    if (missingKinds.length > 0) {
      loadAllRevenueEngineCollections();
      const localErrors = revenueEnginePersistenceErrors();
      if (localErrors.length > 0) {
        throw new Error(`Revenue Engine local migration blocked: ${localErrors.join("; ")}`);
      }
    }

    for (const kind of revenueDurableCollectionKinds) {
      if (rowsByKind.has(kind)) {
        applyRevenueDurableCollection(kind, rowsByKind.get(kind));
      } else {
        await revenueEngineStateStore.upsertCollection({
          ownerUserId,
          kind,
          data: cloneRevenueDurableData(revenueDurableCollectionData(kind)),
        });
      }
    }
    await revenueEngineStateStore.flush();
    revenueDurableScope = ownerUserId;
    revenueDurablePersistenceStatus = "ready";
    return { status: "ready" as const, ownerUserId };
  } catch (error) {
    revenueDurablePersistenceStatus = "error";
    revenueDurableScope = null;
    revenueDurablePersistenceError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export async function flushRevenueEnginePersistence() {
  if (revenueDurablePersistenceStatus === "disabled") return;
  try {
    await revenueEngineStateStore.flush();
  } catch (error) {
    revenueDurablePersistenceStatus = "error";
    revenueDurableScope = null;
    revenueDurablePersistenceError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export function getRevenueEngineDurablePersistenceStatus() {
  return {
    status: revenueDurablePersistenceStatus,
    ownerUserId: revenueDurableScope,
    error: revenueDurablePersistenceError,
  };
}

const agentRoster = [
  {
    id: "growth-director",
    name: "Growth Director",
    role: "Decide nicho, oferta, precios y margen",
    status: "active",
    approvalGate: "Cambia estrategia o precio solo con aprobacion",
  },
  {
    id: "lead-scout",
    name: "Lead Scout",
    role: "Encuentra negocios con senales de no tener website",
    status: "approval_required",
    approvalGate: "No guarda contactos sin evidencia revisable",
  },
  {
    id: "business-researcher",
    name: "Business Researcher",
    role: "Resume negocio, servicios, fotos, reviews y datos publicos",
    status: "ready",
    approvalGate: "Marca datos inciertos antes de usarlos",
  },
  {
    id: "mockup-builder",
    name: "Mockup Builder",
    role: "Arma website dinamico, 3D y comparables por industria",
    status: "ready",
    approvalGate: "No publica ni envia preview sin QA",
  },
  {
    id: "automation-architect",
    name: "Automation Architect",
    role: "Convierte pedidos del cliente en automatizaciones vendibles",
    status: "ready",
    approvalGate: "Estima costo mensual antes de prometer entregas",
  },
  {
    id: "closer",
    name: "Closer",
    role: "Prepara mensajes, seguimiento, propuesta y cierre",
    status: "approval_required",
    approvalGate: "Todo contacto externo queda en draft hasta aprobar",
  },
  {
    id: "qa-council",
    name: "QA Council",
    role: "Revisa copy, links, evidencia, margen, legalidad y entrega",
    status: "active",
    approvalGate: "Bloquea envios con datos flojos o gasto fuera de cap",
  },
];

function isSaleEntry(entry: RevenueLedgerEntry) {
  return entry.kind === "website_sale" || entry.kind === "automation_sale" || entry.kind === "bundle_sale" || entry.kind === "retainer";
}

function buildPipelineStages(entries: RevenueLedgerEntry[], leads: RevenueLead[]) {
  const sales = entries.filter(isSaleEntry);
  const closedValueUsd = sales.reduce((total, entry) => total + entry.amountUsd, 0);
  const valueFor = (statuses: RevenueLead["status"][]) =>
    leads.filter((lead) => statuses.includes(lead.status)).reduce((total, lead) => total + lead.estimatedOfferUsd, 0);
  const countFor = (statuses: RevenueLead["status"][]) => leads.filter((lead) => statuses.includes(lead.status)).length;

  return [
    { id: "lead_research", name: "Research", count: countFor(["research"]), valueUsd: valueFor(["research"]) },
    { id: "qualified", name: "Calificados", count: countFor(["qualified"]), valueUsd: valueFor(["qualified"]) },
    { id: "mockup", name: "Mockup", count: countFor(["mockup_ready"]), valueUsd: valueFor(["mockup_ready"]) },
    { id: "outreach", name: "Outreach", count: countFor(["outreach_ready", "contacted"]), valueUsd: valueFor(["outreach_ready", "contacted"]) },
    { id: "proposal", name: "Propuesta", count: countFor(["proposal_sent"]), valueUsd: valueFor(["proposal_sent"]) },
    { id: "closed", name: "Cerrados", count: sales.length, valueUsd: closedValueUsd },
  ];
}

const packages = [
  {
    id: "website-starter",
    name: "Website Starter",
    priceUsd: 700,
    recurringUsd: 0,
    marginTarget: "80%+",
    delivery: "3-5 days",
    includes: ["One-page website", "Mobile responsive", "Contact form", "Launch handoff"],
  },
  {
    id: "website-growth",
    name: "Website Growth",
    priceUsd: 1500,
    recurringUsd: 79,
    marginTarget: "80%+",
    delivery: "5-7 days",
    includes: ["Up to five sections", "Conversion-focused copy", "Contact or booking flow", "Basic local SEO"],
  },
  {
    id: "website-3d",
    name: "Website Premium 3D",
    priceUsd: 2500,
    recurringUsd: 149,
    marginTarget: "75%+",
    delivery: "7-10 days",
    includes: ["Custom 3D hero", "Dynamic gallery", "Local SEO", "Analytics"],
  },
  {
    id: "automation-sprint",
    name: "Automation Sprint",
    priceUsd: 2500,
    recurringUsd: 300,
    marginTarget: "70%+",
    delivery: "7 dias",
    includes: ["Intake", "CRM/simple ops", "Mensajes", "Dashboard"],
  },
  {
    id: "growth-retainer",
    name: "Growth Retainer",
    priceUsd: 1000,
    recurringUsd: 1000,
    marginTarget: "65%+",
    delivery: "mensual",
    includes: ["Mejoras", "A/B tests", "Reportes", "Automations ligeras"],
  },
];

function buildRevenueProfitGuard({
  cashCollectedUsd,
  estimatedSpendUsd,
  profitUsd,
  approvalQueue,
}: {
  cashCollectedUsd: number;
  estimatedSpendUsd: number;
  profitUsd: number;
  approvalQueue: number;
}) {
  const remainingCapUsd = Math.max(0, 100 - estimatedSpendUsd);
  const cashCoverageUsd = cashCollectedUsd - estimatedSpendUsd;
  const status =
    estimatedSpendUsd >= 100 || estimatedSpendUsd > cashCollectedUsd
      ? "pause_spend"
      : cashCollectedUsd <= 0
        ? "collect_first"
        : approvalQueue > 0
          ? "review_queue"
          : "scale_carefully";

  return {
    status,
    monthlyCapUsd: 100,
    estimatedSpendUsd,
    remainingCapUsd,
    cashCollectedUsd,
    cashCoverageUsd,
    profitUsd,
    canSpendUsd: status === "scale_carefully" ? Math.min(remainingCapUsd, Math.max(0, cashCoverageUsd)) : 0,
    reason:
      status === "pause_spend"
        ? "Pausar gasto: el spend llego al cap o supera el cash cobrado."
        : status === "collect_first"
          ? "Cobrar primero: todavia no hay cash cobrado para financiar gasto externo."
          : status === "review_queue"
            ? "Hay aprobaciones pendientes antes de escalar gasto/contacto."
            : "Puede escalar con batch pequeno, sin pasar el cap y manteniendo aprobacion humana.",
    requiredActions:
      status === "pause_spend"
        ? ["pausar gasto pagado", "cobrar deposito o retainer", "reducir herramientas/costo mensual"]
        : status === "collect_first"
          ? ["vender en draft/manual", "cobrar deposito", "mantener research gratis"]
          : status === "review_queue"
            ? ["resolver aprobaciones pendientes", "revisar outbox/QA", "confirmar evidencia y margen"]
            : ["mantener batch pequeno", "registrar cash/costo en ledger", "revisar aprendizaje semanal"],
  };
}

function buildRevenueNextBatchPlan(input: {
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
  latestReview?: RevenueImprovementReview;
  approvalQueue: number;
}) {
  const latestReview = input.latestReview;
  const hasRevenueProof = input.profitGuard.cashCollectedUsd > 0 && input.profitGuard.profitUsd >= 0;
  const qualityBlocked = Boolean(latestReview && (latestReview.input.defectsFound >= 3 || latestReview.input.clientComplaints > 0));
  const reviewPaused = latestReview?.decisionStatus === "pause_and_fix";
  const canSpendUsd = Math.max(0, Math.min(100, input.profitGuard.canSpendUsd));
  const maxSpendUsd =
    qualityBlocked || reviewPaused || input.profitGuard.status === "pause_spend"
      ? 0
      : input.profitGuard.status === "collect_first"
        ? 0
        : latestReview?.decisionStatus === "scale_carefully"
          ? Math.min(canSpendUsd, latestReview.nextBatch.maxSpendUsd)
          : Math.min(canSpendUsd, 10);
  const status =
    qualityBlocked || reviewPaused || input.profitGuard.status === "pause_spend"
      ? "pause" as const
      : input.profitGuard.status === "collect_first"
        ? "collect_first" as const
        : latestReview?.decisionStatus === "scale_carefully" && hasRevenueProof
          ? "scale_carefully" as const
          : "iterate_small_batch" as const;
  const maxLeads =
    status === "scale_carefully"
      ? Math.min(25, latestReview?.nextBatch.maxLeads || 25)
      : status === "iterate_small_batch"
        ? 10
        : 0;

  return {
    status,
    maxLeads,
    maxSpendUsd,
    reason:
      status === "pause"
        ? "Pausar siguiente batch hasta resolver QA, costo, quejas o gasto bloqueado."
        : status === "collect_first"
          ? "Cobrar deposito/cash primero; solo research gratis y drafts internos."
          : status === "scale_carefully"
            ? "Hay prueba de cash/profit; escalar en batch pequeno sin pasar cap ni aprobaciones."
            : "Iterar con batch pequeno porque todavia falta prueba fuerte de ROI.",
    requiredBeforeNextAction: [
      status === "collect_first" && "cobrar deposito antes de gastar",
      status === "pause" && "resolver bloqueos QA/costo antes de contactar",
      input.approvalQueue > 0 && "limpiar approval queue",
      "aprobar mensaje antes de enviar",
      "guardar resultado y objecion despues del batch",
    ].filter(Boolean) as string[],
    allowedActions:
      status === "collect_first"
        ? ["research publico gratis", "mockup/draft interno", "pedir deposito"]
        : status === "pause"
          ? ["corregir QA", "bajar costo", "revisar oferta"]
          : ["contactar batch aprobado", "guardar metricas", "crear review semanal"],
    latestReviewId: latestReview?.id || "",
  };
}

function buildRevenueExecutiveSummary(input: {
  appsSold: number;
  automationsSold: number;
  revenueUsd: number;
  cashCollectedUsd: number;
  estimatedSpendUsd: number;
  profitUsd: number;
  approvalQueue: number;
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
  nextBatchPlan: ReturnType<typeof buildRevenueNextBatchPlan>;
}) {
  const totalProductsSold = input.appsSold + input.automationsSold;
  const collectionRatePercent = input.revenueUsd > 0 ? Math.round((input.cashCollectedUsd / input.revenueUsd) * 100) : 0;
  const profitMarginPercent = input.cashCollectedUsd > 0 ? Math.round((input.profitUsd / input.cashCollectedUsd) * 100) : 0;
  const status =
    input.profitGuard.status === "pause_spend" || input.nextBatchPlan.status === "pause"
      ? "blocked" as const
      : input.profitGuard.status === "collect_first"
        ? "collect_first" as const
        : input.approvalQueue > 0
          ? "needs_approval" as const
          : "ready" as const;

  return {
    status,
    headline:
      totalProductsSold === 0
        ? "Todavia no hay ventas registradas; operar en modo draft y cobrar deposito primero."
        : `${input.appsSold} apps/websites y ${input.automationsSold} automatizaciones vendidas; cash cobrado ${input.cashCollectedUsd.toLocaleString("en-US")} USD.`,
    appsSold: input.appsSold,
    automationsSold: input.automationsSold,
    totalProductsSold,
    revenueUsd: input.revenueUsd,
    cashCollectedUsd: input.cashCollectedUsd,
    estimatedSpendUsd: input.estimatedSpendUsd,
    profitUsd: input.profitUsd,
    collectionRatePercent,
    profitMarginPercent,
    approvalQueue: input.approvalQueue,
    nextFocus:
      status === "blocked"
        ? "Resolver bloqueos antes de gastar, contactar o entregar."
        : status === "collect_first"
          ? "Cerrar deposito/cash antes de cualquier gasto externo."
          : status === "needs_approval"
            ? "Limpiar approval queue y aprobar solo acciones rentables."
            : "Ejecutar el siguiente batch pequeno dentro del cap.",
  };
}

function buildRevenueAgentOperatingContract(input: {
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
  nextBatchPlan: ReturnType<typeof buildRevenueNextBatchPlan>;
  approvalQueue: number;
}) {
  const mode =
    input.profitGuard.status === "pause_spend" || input.nextBatchPlan.status === "pause"
      ? "correction_only" as const
      : input.profitGuard.status === "collect_first"
        ? "draft_only" as const
        : input.approvalQueue > 0
          ? "approval_queue" as const
          : "controlled_autopilot" as const;

  return {
    mode,
    mainAgent: "growth-director",
    canRunAutonomously:
      mode === "correction_only"
        ? ["corregir QA", "reducir costo", "preparar drafts internos"]
        : mode === "draft_only"
          ? ["research publico gratis", "mockup interno", "cotizacion en draft", "pedir deposito"]
          : mode === "approval_queue"
            ? ["organizar approvals", "preparar correcciones", "actualizar resumen ejecutivo"]
            : ["research publico", "batch aprobado", "drafts", "QA", "review semanal"],
    requiresHumanApproval: [
      "contactar negocio externo",
      "enviar email/DM/formulario",
      "gastar dinero",
      "comprar data",
      "publicar mockup",
      "activar automatizacion",
      "cobrar cliente",
    ],
    blockedActions:
      mode === "controlled_autopilot"
        ? []
        : ["contacto externo", "gasto externo", "launch", "automatizacion en vivo"],
    currentInstruction:
      mode === "correction_only"
        ? "Solo corregir bloqueos; no vender, gastar, contactar ni lanzar."
        : mode === "draft_only"
          ? "Preparar venta en draft y cobrar deposito antes de gastar."
          : mode === "approval_queue"
            ? "Resolver approvals antes de avanzar el siguiente batch."
      : "Ejecutar batch pequeno aprobado y registrar resultados.",
  };
}

function buildRevenueOperatorConsole(input: {
  appsSold: number;
  automationsSold: number;
  revenueUsd: number;
  cashCollectedUsd: number;
  estimatedSpendUsd: number;
  profitUsd: number;
  approvalQueue: number;
  executiveSummary: ReturnType<typeof buildRevenueExecutiveSummary>;
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
  nextBatchPlan: ReturnType<typeof buildRevenueNextBatchPlan>;
  agentOperatingContract: ReturnType<typeof buildRevenueAgentOperatingContract>;
}) {
  const canSpendNow = input.profitGuard.canSpendUsd > 0 && input.agentOperatingContract.mode === "controlled_autopilot";
  const nextCommand =
    input.executiveSummary.status === "blocked"
      ? "Resolver bloqueos de QA/costo antes de contactar, gastar o entregar."
      : input.executiveSummary.status === "collect_first"
        ? "Vender en draft y cobrar deposito antes de cualquier gasto externo."
        : input.executiveSummary.status === "needs_approval"
          ? "Revisar approval queue y aprobar solo el siguiente paso rentable."
          : input.nextBatchPlan.status === "scale_carefully"
            ? `Contactar hasta ${input.nextBatchPlan.maxLeads} leads aprobados con gasto maximo ${input.nextBatchPlan.maxSpendUsd} USD.`
            : "Iterar con batch pequeno, guardar metricas y no pasar el cap.";

  return {
    moneyLine: `${input.appsSold} apps/websites, ${input.automationsSold} automatizaciones, ${input.cashCollectedUsd.toLocaleString("en-US")} USD cash, ${input.profitUsd.toLocaleString("en-US")} USD profit.`,
    nextCommand,
    canSpendNow,
    spendPermission: canSpendNow
      ? `Puede gastar hasta ${input.profitGuard.canSpendUsd} USD dentro del cap y con batch aprobado.`
      : "No gastar ahora: requiere cash, aprobacion limpia o resolver bloqueos.",
    allowedNow: input.agentOperatingContract.canRunAutonomously.slice(0, 4),
    waitingOnRobert:
      input.approvalQueue > 0
        ? ["revisar approval queue", ...input.nextBatchPlan.requiredBeforeNextAction].slice(0, 4)
        : input.agentOperatingContract.requiresHumanApproval.slice(0, 3),
    blockedNow: input.agentOperatingContract.blockedActions,
    scoreboard: {
      appsSold: input.appsSold,
      automationsSold: input.automationsSold,
      revenueUsd: input.revenueUsd,
      cashCollectedUsd: input.cashCollectedUsd,
      estimatedSpendUsd: input.estimatedSpendUsd,
      profitUsd: input.profitUsd,
      approvalQueue: input.approvalQueue,
    },
  };
}

function buildRevenueSystemReadiness(input: {
  appsSold: number;
  automationsSold: number;
  cashCollectedUsd: number;
  estimatedSpendUsd: number;
  approvalQueue: number;
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
  nextBatchPlan: ReturnType<typeof buildRevenueNextBatchPlan>;
  agentOperatingContract: ReturnType<typeof buildRevenueAgentOperatingContract>;
}) {
  const productionPersistence = (() => {
    try {
      const databaseUrl = resolveDatabaseConnectionString();
      if (databaseUrl) {
        const durableStatus = getRevenueEngineDurablePersistenceStatus();
        if (durableStatus.status === "ready" && durableStatus.ownerUserId) {
          return {
            status: "ready" as const,
            evidence: `Postgres durable activo para ${durableStatus.ownerUserId}; todas las colecciones de Revenue Engine se hidratan y confirman antes de responder.`,
            nextStep: "Mantener backups, monitorear errores de flush y no exponer credenciales.",
          };
        }
        return {
          status: "needs_data" as const,
          evidence: durableStatus.error
            ? `DATABASE_URL configurado, pero Postgres durable fallo: ${durableStatus.error}`
            : "DATABASE_URL configurado; falta hidratar y verificar Postgres durable para el usuario actual.",
          nextStep: "Completar la hidratacion Postgres y un flush exitoso antes de ventas reales o deploy de produccion.",
        };
      }
      return {
        status: "needs_data" as const,
        evidence: "Modo local_file activo para desarrollo; falta DATABASE_URL real antes de operar produccion con dinero.",
        nextStep: "Configurar Postgres/DATABASE_URL real en Replit antes de deploy o ventas reales.",
      };
    } catch (error: any) {
      return {
        status: "blocked" as const,
        evidence: error?.message || "DATABASE_URL invalido o faltante.",
        nextStep: "Corregir DATABASE_URL real antes de arrancar produccion o desplegar.",
      };
    }
  })();
  const items = [
    {
      id: "separate_area",
      label: "Area aparte en el app",
      status: "ready" as const,
      evidence: "Ruta /revenue-engine con UI propia, tabs, snapshot y consola Robert.",
      nextStep: "Mantenerla separada de Tools/Agents Office salvo accesos directos.",
    },
    {
      id: "ask_when_unclear",
      label: "Pregunta si no entiende",
      status: "ready" as const,
      evidence: "Automation intakes guardan missingAnswers, nextQuestions, answerTemplate y bloqueos.",
      nextStep: "Usar la plantilla antes de cotizar o construir pedidos vagos.",
    },
    {
      id: "sell_automations",
      label: "Vender automatizaciones",
      status: "ready" as const,
      evidence: "Automation quote, intake, opportunity, close-to-ledger y delivery workspace conectados.",
      nextStep: "Convertir intakes listos en oportunidades y cobrar deposito.",
    },
    {
      id: "main_agent_subagents",
      label: "Agente principal + subagentes",
      status: "ready" as const,
      evidence: "Growth Director coordina work order; QA Council, Cost Controller, Closer y Automation Architect corrigen/bloquean.",
      nextStep: "Revisar subagentReviews antes de cualquier contacto externo.",
    },
    {
      id: "delivery_quality",
      label: "Checks para entregar perfecto",
      status: "ready" as const,
      evidence: "Delivery workspaces bloquean por deposito, scope, QA visual/tecnica/automation, rollback, costo y margen.",
      nextStep: "Entregar solo cuando canLaunch=true y Robert apruebe.",
    },
    {
      id: "production_persistence",
      label: "Persistencia production-ready",
      status: productionPersistence.status,
      evidence: productionPersistence.evidence,
      nextStep: productionPersistence.nextStep,
    },
    {
      id: "continuous_improvement",
      label: "Mejorar cada vez",
      status: input.nextBatchPlan.latestReviewId ? "ready" as const : "needs_data" as const,
      evidence: input.nextBatchPlan.latestReviewId
        ? `Ultima review: ${input.nextBatchPlan.latestReviewId}.`
        : "Improvement reviews existen, pero falta una review real para alimentar el siguiente batch.",
      nextStep: "Crear review semanal o post-delivery con metricas reales.",
    },
    {
      id: "under_100_monthly",
      label: "Menos de $100/mes al empezar",
      status: input.estimatedSpendUsd <= 100 ? "ready" as const : "blocked" as const,
      evidence: `Gasto estimado actual: ${input.estimatedSpendUsd} USD de 100 USD.`,
      nextStep: input.estimatedSpendUsd <= 100 ? "Seguir usando Profit Guard antes de gastar." : "Bajar herramientas/costos antes de avanzar.",
    },
    {
      id: "dont_spend_more_than_cash",
      label: "No gastar mas de lo cobrado",
      status: input.estimatedSpendUsd <= input.cashCollectedUsd ? "ready" as const : "blocked" as const,
      evidence: `Cash cobrado ${input.cashCollectedUsd} USD vs gasto ${input.estimatedSpendUsd} USD.`,
      nextStep: input.estimatedSpendUsd <= input.cashCollectedUsd ? "Registrar cada venta/gasto en ledger." : "Cobrar deposito o pausar gasto externo.",
    },
    {
      id: "robert_money_visibility",
      label: "Robert ve apps y dinero",
      status: "ready" as const,
      evidence: `${input.appsSold} apps/websites, ${input.automationsSold} automatizaciones, cash ${input.cashCollectedUsd} USD.`,
      nextStep: "Usar Consola Robert y Ledger como vista ejecutiva.",
    },
    {
      id: "controlled_autonomy",
      label: "Autonomia controlada",
      status: input.agentOperatingContract.mode === "controlled_autopilot" ? "ready" as const : input.approvalQueue > 0 ? "needs_approval" as const : "needs_data" as const,
      evidence: `Modo actual: ${input.agentOperatingContract.mode}. Profit Guard: ${input.profitGuard.status}.`,
      nextStep: input.agentOperatingContract.currentInstruction,
    },
  ];
  const ready = items.filter((item) => item.status === "ready").length;
  const blocked = items.filter((item) => item.status === "blocked").length;
  const needsApproval = items.filter((item) => item.status === "needs_approval").length;
  const needsData = items.filter((item) => item.status === "needs_data").length;

  return {
    score: Math.round((ready / items.length) * 100),
    ready,
    blocked,
    needsApproval,
    needsData,
    summary:
      blocked > 0
        ? "Hay bloqueos de costo/cash antes de operar."
        : needsApproval > 0
          ? "El sistema esta armado, pero espera aprobaciones para avanzar."
          : needsData > 0
            ? "La arquitectura esta lista; falta data real para mejorar/escala."
            : "Sistema operativo listo para batch controlado.",
    items,
  };
}

export function buildRevenueScoutingMission(input: RevenueScoutingMissionInput) {
  const parsed = revenueScoutingMissionSchema.parse(input);
  const paidSpendUsd = Math.min(parsed.maxPaidDataSpendUsd, 100);
  const isFreeMode = paidSpendUsd === 0;
  const leadBatchSize = Math.min(parsed.targetLeadCount, paidSpendUsd > 0 ? 50 : 25);
  const websiteSignals = [
    parsed.requireNoWebsiteSignal && "no website listed on Google/Instagram/Facebook profile",
    parsed.requireNoWebsiteSignal && "\"website\" field empty or pointing only to social profile",
    parsed.includeWeakWebsiteLeads && "website is broken, outdated, non-mobile or missing clear CTA",
    parsed.includeWeakWebsiteLeads && "menu/services/pricing only shown in posts or images",
  ].filter((item): item is string => Boolean(item));
  const offerSignals =
    parsed.offerFocus === "automations"
      ? ["manual booking/intake", "missed calls or DMs", "repeated follow-up", "spreadsheet/DM workflow"]
      : parsed.offerFocus === "websites"
        ? ["no booking/contact funnel", "poor mobile presence", "no landing page for high-ticket service", "weak local SEO"]
        : ["weak web presence plus repeatable lead/customer workflow", "no follow-up system after inquiry", "no dashboard for owner"];

  return {
    mission: {
      name: `${parsed.area} ${parsed.niche} scouting`,
      area: parsed.area,
      niche: parsed.niche,
      offerFocus: parsed.offerFocus,
      targetLeadCount: parsed.targetLeadCount,
      leadBatchSize,
      mode: isFreeMode ? "free_public_research" : "paid_data_requires_approval",
    },
    budgetGate: {
      monthlyCapUsd: 100,
      requestedPaidDataSpendUsd: parsed.maxPaidDataSpendUsd,
      approvedPaidDataSpendUsd: paidSpendUsd,
      requiresApprovalToSpend: paidSpendUsd > 0,
      allowedBeforeApproval: ["Google search", "Google Maps manual review", "Instagram profile review", "public website/social evidence"],
      blockedBeforeApproval: ["buy data", "send email", "send DM", "submit contact form", "publish mockup"],
    },
    searchQueries: [
      `${parsed.niche} in ${parsed.area} no website`,
      `${parsed.niche} ${parsed.area} instagram`,
      `${parsed.niche} ${parsed.area} facebook`,
      `"${parsed.niche}" "${parsed.area}" "contact"`,
      `"${parsed.niche}" "${parsed.area}" "booking"`,
      `${parsed.niche} near ${parsed.area} site:instagram.com`,
    ],
    leadEvidenceChecklist: [
      "Business name, area and niche captured exactly from public source.",
      "Website status marked no_website, weak_website, has_website or unknown with evidence.",
      "At least one contact path exists, but no contact happens before approval.",
      "Pain point is tied to public evidence, not guessed.",
      "Offer value is at least $1,500 setup or has recurring automation potential.",
    ],
    qualificationScorecard: [
      { item: "No website or weak website signal", maxPoints: 35, signals: websiteSignals },
      { item: "Verifiable contact path", maxPoints: 25, signals: ["email", "contact form", "Instagram", "phone"] },
      { item: "Public evidence quality", maxPoints: 20, signals: ["profile", "reviews", "posts", "listing", "existing site"] },
      { item: "Pain/revenue opportunity", maxPoints: 10, signals: offerSignals },
      { item: "Minimum profitable offer", maxPoints: 10, signals: ["website >= $1,500", "automation >= $1,500", "retainer >= $300/mo"] },
    ],
    subagentReviews: [
      { agent: "lead-scout", check: "Finds candidates and records public evidence only." },
      { agent: "business-researcher", check: "Verifies business info and marks uncertain data." },
      { agent: "mockup-builder", check: "Creates mockup brief only after evidence passes." },
      { agent: "automation-architect", check: "Identifies workflow automation upsell and internal monthly cost." },
      { agent: "qa-council", check: "Blocks outreach if evidence/contact/cost approval is missing." },
    ],
    nextActions: [
      `Research ${leadBatchSize} ${parsed.niche} leads in ${parsed.area}.`,
      "Record only leads with evidence into /api/revenue-engine/leads.",
      "Generate mockup for A/B leads before outreach.",
      "Create outreach draft, keep it draft until Robert approves.",
      "Review batch results in improvement memory before scaling.",
    ],
  };
}

export function buildRevenueLeadRadar(input: RevenueLeadRadarInput) {
  const parsed = revenueLeadRadarSchema.parse(input);
  const niches = parsed.niches
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  const safeNiches = niches.length ? niches : ["med spas"];
  const paidSpendUsd = Math.min(parsed.maxPaidDataSpendUsd, 100);
  const researchPerHour = Math.max(1, Math.ceil(parsed.dailyResearchTarget / parsed.runHoursPerDay));
  const qualifiedPerHour = Math.max(1, Math.ceil(parsed.dailyQualifiedLeadLimit / parsed.runHoursPerDay));
  const mockupCadenceHours = Math.max(1, Math.ceil(parsed.runHoursPerDay / parsed.dailyMockupLimit));
  const contactCadenceHours = parsed.dailyContactLimit > 0 ? Math.max(1, Math.ceil(parsed.runHoursPerDay / parsed.dailyContactLimit)) : 24;
  const contactMode = parsed.requireRobertApprovalToContact || parsed.dailyContactLimit === 0 ? "draft_only" as const : "approved_queue_only" as const;
  const status = paidSpendUsd > 0 ? "needs_spend_approval" as const : "always_on_ready" as const;
  const channelMix = [
    {
      channel: "Google Maps manual/public search",
      priority: 1,
      reason: "Mejor senal local para negocios sin website, telefono/listing y reviews.",
      costUsd: 0,
    },
    {
      channel: "Instagram bio + recent posts",
      priority: 2,
      reason: "Detecta negocios activos con solo social profile y dolores visuales claros.",
      costUsd: 0,
    },
    {
      channel: "Industry directories/Yelp/Facebook public pages",
      priority: 3,
      reason: "Completa telefono, categoria, fotos, reviews y website status.",
      costUsd: 0,
    },
    {
      channel: "Paid lead/data tools",
      priority: 4,
      reason: "Usar solo cuando el cash cobrado y Robert aprueben; no al inicio.",
      costUsd: paidSpendUsd,
    },
  ];
  const searchRotations = safeNiches.flatMap((niche) => [
    `${niche} ${parsed.area} no website`,
    `${niche} ${parsed.area} instagram booking`,
    `${niche} ${parsed.area} google maps`,
    `"${niche}" "${parsed.area}" "book now"`,
    `${niche} near ${parsed.area} site:instagram.com`,
  ]).slice(0, 30);

  return {
    input: parsed,
    status,
    operatingMode: {
      name: "24/7 lead radar",
      researchRunsAllDay: true,
      contactMode,
      spendMode: paidSpendUsd > 0 ? "approval_required" : "free_public_research",
      mockupOwner: "Codex/mockup-builder",
      nextHumanDecision: contactMode === "draft_only" ? "Robert aprueba contacto y envio." : "Robert revisa cola aprobada antes de envio masivo.",
    },
    dailyLimits: {
      runHoursPerDay: parsed.runHoursPerDay,
      researchTarget: parsed.dailyResearchTarget,
      researchPerHour,
      qualifiedLeadLimit: parsed.dailyQualifiedLeadLimit,
      qualifiedPerHour,
      mockupLimit: parsed.dailyMockupLimit,
      mockupCadenceHours,
      contactLimit: parsed.dailyContactLimit,
      contactCadenceHours,
      monthlySpendCapUsd: 100,
      approvedPaidDataSpendUsd: paidSpendUsd,
    },
    lanes: [
      {
        lane: "discover",
        ownerAgent: "lead-scout",
        runs: "24/7",
        output: "candidatos con nombre, fuente publica, website status y contacto posible",
        blockedActions: ["contactar", "comprar data", "prometer precio"],
      },
      {
        lane: "qualify",
        ownerAgent: "business-researcher",
        runs: "cada hora",
        output: "A/B/C score con evidencia, pain point y oferta minima",
        blockedActions: ["inventar claims", "usar datos no verificados"],
      },
      {
        lane: "mockup",
        ownerAgent: "mockup-builder",
        runs: `cada ${mockupCadenceHours}h o cuando haya lead A`,
        output: "brief de mockup website/automation listo para construir por Codex",
        blockedActions: ["publicar preview", "enviar al cliente sin aprobacion"],
      },
      {
        lane: "outreach",
        ownerAgent: "closer",
        runs: `max ${parsed.dailyContactLimit}/dia`,
        output: "draft personalizado con mockup/comparables",
        blockedActions: ["email/DM sin aprobacion", "contactar mas del limite diario"],
      },
      {
        lane: "learn",
        ownerAgent: "growth-director",
        runs: "diario + semanal",
        output: "objeciones, replies, calls, deals, costo y mejoras del playbook",
        blockedActions: ["escalar gasto si no hay cash cobrado"],
      },
    ],
    channelMix,
    searchRotations,
    qualificationRules: [
      "Prioridad A: no website o website roto + contacto verificable + evidencia publica + oferta >= $1,500.",
      "Prioridad B: website debil + proceso manual visible + automatizacion clara.",
      "Descartar: negocios sin contacto verificable, evidencia pobre o ticket demasiado bajo.",
      "No contacto externo hasta draft aprobado; research y mockup interno si pueden correr 24/7.",
    ],
    mockupPolicy: {
      whoCreatesMockups: "Codex crea mockups/briefs cuando el lead tenga evidencia A/B.",
      requiredBeforeMockup: ["businessName", "area", "niche", "websiteStatus", "public evidence", "painPoint"],
      maxPerDay: parsed.dailyMockupLimit,
      qualityBar: "Cada mockup debe tener oferta, CTA, prueba publica, automatizacion vendible y costo interno <= $100/mes.",
    },
    recommendation:
      "Buscar leads puede correr 24/7. Lo que debe tener limite es contacto externo, mockups finales y gasto: ahi esta la calidad, reputacion y rentabilidad.",
    nextActions: [
      `Correr radar gratis para ${safeNiches.join(", ")} en ${parsed.area}.`,
      `Guardar hasta ${parsed.dailyQualifiedLeadLimit} leads calificados/dia.`,
      `Crear max ${parsed.dailyMockupLimit} mockups/dia con evidencia fuerte.`,
      `Contactar max ${parsed.dailyContactLimit}/dia solo con aprobacion.`,
      "Revisar resultados semanalmente antes de subir limites.",
    ],
  };
}

export function recordRevenueScoutingMission(input: RevenueScoutingMissionInput) {
  loadRevenueScoutingMissions();
  const mission = buildRevenueScoutingMission(input);
  const now = new Date().toISOString();
  const persisted: RevenueScoutingMission = {
    ...mission,
    id: `scouting-${Date.now()}-${revenueScoutingMissions.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status: mission.budgetGate.requiresApprovalToSpend ? "planned" : "ready_for_leads",
    learningNote:
      mission.budgetGate.requiresApprovalToSpend
        ? `Pedir aprobacion antes de gastar ${mission.budgetGate.approvedPaidDataSpendUsd} en data para ${mission.mission.niche} en ${mission.mission.area}.`
        : `Usar research publico gratis para ${mission.mission.leadBatchSize} leads de ${mission.mission.niche} en ${mission.mission.area}.`,
  };

  revenueScoutingMissions.push(persisted);
  persistRevenueScoutingMissions();

  return {
    mission: persisted,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function recordRevenueApprovalDecision(input: RevenueApprovalDecisionInput) {
  loadRevenueApprovalDecisions();
  const parsed = revenueApprovalDecisionSchema.parse(input);
  const snapshot = getRevenueEngineSnapshot();
  const spendBlocked = parsed.maxSpendUsd > 100 || (parsed.maxSpendUsd > 0 && snapshot.profitGuard.status !== "scale_carefully");
  const guardrail = {
    status: spendBlocked ? "blocked" as const : "recorded" as const,
    reason: spendBlocked
      ? "No se puede aprobar gasto: supera $100 o Profit Guard no permite spend ahora."
      : "Decision humana registrada; el agente puede usarla como memoria operativa sin saltarse QA.",
  };
  const decision: RevenueApprovalDecision = {
    ...parsed,
    id: `approval-${Date.now()}-${revenueApprovalDecisions.length + 1}`,
    createdAt: new Date().toISOString(),
    guardrail,
  };

  revenueApprovalDecisions.push(decision);
  persistRevenueApprovalDecisions();

  return {
    decision,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function buildAutomationIntakeAnswerTemplate(questions: string[], missingAnswers: string[]) {
  const base = questions.length
    ? questions
    : [
        "Que evento inicia el flujo: nuevo lead, formulario, DM, llamada, pago, reserva u otra cosa?",
        "Donde vive hoy la informacion: Google Sheets, CRM, email, Instagram, WhatsApp, POS u otra herramienta?",
        "Que resultado quieres venderle al cliente: mas reservas, mas leads respondidos, menos trabajo manual, reportes o cobros?",
      ];

  return [
    "Respuesta minima para poder cotizar/construir:",
    ...base.slice(0, 5).map((question, index) => `${index + 1}. ${question} Respuesta: ____`),
    missingAnswers.length ? `Falta aclarar: ${missingAnswers.join(", ")}.` : "Si algo no aplica, escribir 'no aplica' y explicar por que.",
  ].join("\n");
}

export function recordRevenueAutomationIntake(input: RevenueAutomationIntakeInput) {
  loadRevenueAutomationIntakes();
  const parsed = revenueAutomationIntakeSchema.parse(input);
  const quote = buildAutomationQuote(parsed);
  const hasEnoughAnswers = parsed.knownAnswers.trim().length >= 40;
  const status: RevenueAutomationIntake["status"] =
    quote.clarificationGate.status === "clear" || hasEnoughAnswers ? "ready_for_quote" : "needs_answers";
  const missingAnswers = status === "ready_for_quote" ? [] : quote.clarificationGate.missing;
  const nextQuestions = status === "ready_for_quote" ? [] : quote.clarifyingQuestions;
  const now = new Date().toISOString();
  const intake: RevenueAutomationIntake = {
    ...parsed,
    id: `automation-intake-${Date.now()}-${revenueAutomationIntakes.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status,
    quote,
    missingAnswers,
    nextQuestions,
    answerTemplate: buildAutomationIntakeAnswerTemplate(nextQuestions, missingAnswers),
    blockedUntilAnswered: status === "ready_for_quote" ? [] : quote.clarificationGate.blocks,
    nextAction:
      status === "ready_for_quote"
        ? "Crear oportunidad/cotizacion y pedir aprobacion de scope/deposito."
        : "Hacer preguntas de aclaracion antes de prometer precio, build o delivery.",
  };

  revenueAutomationIntakes.push(intake);
  persistRevenueAutomationIntakes();

  return {
    intake,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function answerRevenueAutomationIntake(input: RevenueAutomationIntakeAnswerInput) {
  loadRevenueAutomationIntakes();
  const parsed = revenueAutomationIntakeAnswerSchema.parse(input);
  const intake = revenueAutomationIntakes.find((item) => item.id === parsed.intakeId);

  if (!intake) {
    return {
      status: "not_found" as const,
      reason: "Intake no encontrado.",
      intake: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  intake.knownAnswers = [intake.knownAnswers, parsed.answers].filter((item) => item.trim().length > 0).join("\n\n");
  const enrichedRequest = `${intake.request}\n\nRespuestas del cliente:\n${intake.knownAnswers}`;
  const quote = buildAutomationQuote({
    businessName: intake.businessName,
    industry: intake.industry,
    request: enrichedRequest,
    currentTools: intake.currentTools,
    monthlyBudgetUsd: intake.monthlyBudgetUsd,
    urgency: intake.urgency,
  });
  const ready = quote.clarificationGate.status === "clear" || intake.knownAnswers.trim().length >= 40;
  const missingAnswers = ready ? [] : quote.clarificationGate.missing;
  const nextQuestions = ready ? [] : quote.clarifyingQuestions;

  intake.request = enrichedRequest.slice(0, 1200);
  intake.quote = quote;
  intake.status = ready ? "ready_for_quote" : "needs_answers";
  intake.missingAnswers = missingAnswers;
  intake.nextQuestions = nextQuestions;
  intake.answerTemplate = buildAutomationIntakeAnswerTemplate(nextQuestions, missingAnswers);
  intake.blockedUntilAnswered = ready ? [] : quote.clarificationGate.blocks;
  intake.nextAction = ready
    ? "Crear oportunidad/cotizacion y pedir aprobacion de scope/deposito."
    : "Aun faltan respuestas; no prometer precio, build o delivery.";
  intake.updatedAt = new Date().toISOString();
  persistRevenueAutomationIntakes();

  return {
    status: "updated" as const,
    intake,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function convertRevenueAutomationIntakeToOpportunity(input: RevenueAutomationIntakeConvertInput) {
  loadRevenueAutomationIntakes();
  const parsed = revenueAutomationIntakeConvertSchema.parse(input);
  const intake = revenueAutomationIntakes.find((item) => item.id === parsed.intakeId);

  if (!intake) {
    return {
      status: "not_found" as const,
      reason: "Intake no encontrado.",
      intake: null,
      opportunity: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  if (intake.status !== "ready_for_quote") {
    return {
      status: "blocked" as const,
      reason: "Responder preguntas de aclaracion antes de crear oportunidad/cotizacion.",
      intake,
      opportunity: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const result = recordRevenueAutomationOpportunity({
    businessName: intake.businessName,
    industry: intake.industry,
    request: intake.request,
    currentTools: intake.currentTools,
    monthlyBudgetUsd: intake.monthlyBudgetUsd,
    urgency: intake.urgency,
    sourceLeadId: "",
    status: parsed.status,
    clientApprovedScope: parsed.clientApprovedScope,
    depositPaid: parsed.depositPaid,
    paymentConfirmation: "",
  });

  intake.nextAction = `Oportunidad creada: ${result.opportunity.id}. Pedir aprobacion de scope y deposito antes de construir.`;
  intake.updatedAt = new Date().toISOString();
  persistRevenueAutomationIntakes();

  return {
    status: "converted" as const,
    reason: "Intake convertido en oportunidad de automatizacion con QA y aprobaciones pendientes.",
    intake,
    opportunity: result.opportunity,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function runRevenueAutomationAgentCommand(input: RevenueAutomationAgentCommandInput) {
  const parsed = revenueAutomationAgentCommandSchema.parse(input);
  const intakeResult = recordRevenueAutomationIntake({
    businessName: parsed.businessName,
    industry: parsed.industry,
    request: parsed.request,
    currentTools: parsed.currentTools,
    monthlyBudgetUsd: parsed.monthlyBudgetUsd,
    urgency: parsed.urgency,
    contactName: parsed.contactName,
    contactEmail: parsed.contactEmail,
    knownAnswers: parsed.knownAnswers,
    source: parsed.source,
  });
  const intake = intakeResult.intake;
  const effectiveRequest = parsed.knownAnswers.trim().length > 0
    ? `${intake.request}\n\nRespuestas del cliente:\n${parsed.knownAnswers}`
    : intake.request;
  const effectiveQuote = buildAutomationQuote({
    businessName: intake.businessName,
    industry: intake.industry,
    request: effectiveRequest,
    currentTools: intake.currentTools,
    monthlyBudgetUsd: intake.monthlyBudgetUsd,
    urgency: intake.urgency,
  });
  const quoteIsClear = effectiveQuote.clarificationGate.status === "clear" || intake.status === "ready_for_quote";
  if (effectiveQuote.clarificationGate.status === "clear" && intake.quote.clarificationGate.status !== "clear") {
    intake.request = effectiveRequest.slice(0, 1200);
    intake.quote = effectiveQuote;
    intake.status = "ready_for_quote";
    intake.missingAnswers = [];
    intake.nextQuestions = [];
    intake.blockedUntilAnswered = [];
    intake.nextAction = "Crear oportunidad/cotizacion y pedir aprobacion de scope/deposito.";
    intake.updatedAt = new Date().toISOString();
    persistRevenueAutomationIntakes();
  }

  if (!quoteIsClear) {
    return {
      status: "needs_answers" as const,
      reason: "El agente no entiende suficiente el pedido; pregunta antes de cotizar final o crear oportunidad.",
      intake,
      quote: effectiveQuote,
      opportunity: null,
      blockedUntilAnswered: intake.blockedUntilAnswered,
      nextActions: [
        "Enviar/leer las preguntas de aclaracion.",
        "Guardar respuestas en el intake.",
        "Volver a correr el agente antes de crear oportunidad.",
      ],
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  if (!parsed.createOpportunityIfClear || parsed.lifecycleTarget === "quote") {
    return {
      status: "quoted" as const,
      reason: "Pedido claro; cotizacion lista en modo draft sin crear oportunidad.",
      intake,
      quote: effectiveQuote,
      opportunity: null,
      blockedUntilAnswered: [],
      nextActions: ["Revisar precio y alcance.", "Pedir aprobacion de scope/deposito.", "Crear oportunidad cuando Robert apruebe."],
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const automationSaleFingerprint = buildAutomationSaleFingerprint(parsed);
  if ((parsed.lifecycleTarget === "sale" || parsed.lifecycleTarget === "delivery") && parsed.clientApprovedScope && (parsed.depositPaid || (parsed.cashCollectedUsd || 0) > 0)) {
    loadRevenueLedger();
    const existingSale = findRevenueLedgerEntryByExactNoteToken(automationSaleFingerprint);
    if (existingSale) {
      return {
        status: "already_recorded" as const,
        reason: "Esta venta de automatizacion ya fue registrada en ledger; no se vuelve a contar cash.",
        intake,
        quote: effectiveQuote,
        opportunity: null,
        closeResult: {
          status: "already_recorded" as const,
          reason: "Venta deduplicada por huella estable del automation agent command.",
          opportunity: null,
          entry: existingSale,
          snapshot: getRevenueEngineSnapshot(),
        },
        workspaceResult: null,
        blockedUntilAnswered: [],
        nextActions: ["Usar la venta/workspace existente.", "No registrar otro cobro para el mismo comando.", "Continuar con QA o delivery desde el workspace existente."],
        snapshot: getRevenueEngineSnapshot(),
      };
    }
  }

  const opportunityResult = recordRevenueAutomationOpportunity({
    businessName: intake.businessName,
    industry: intake.industry,
    request: effectiveRequest,
    currentTools: intake.currentTools,
    monthlyBudgetUsd: intake.monthlyBudgetUsd,
    urgency: intake.urgency,
    sourceLeadId: "",
    status: parsed.lifecycleTarget === "sale" || parsed.lifecycleTarget === "delivery" ? "approved" : "quoted",
    clientApprovedScope: parsed.clientApprovedScope,
    depositPaid: parsed.depositPaid,
    paymentConfirmation: parsed.paymentConfirmation,
  });

  intake.nextAction = `Agente creo oportunidad: ${opportunityResult.opportunity.id}. Pedir aprobacion de scope y deposito antes de construir.`;
  intake.updatedAt = new Date().toISOString();
  persistRevenueAutomationIntakes();

  if (parsed.lifecycleTarget === "opportunity") {
    return {
      status: "opportunity_created" as const,
      reason: "Pedido claro; el agente preparo cotizacion y oportunidad en draft con QA.",
      intake,
      quote: effectiveQuote,
      opportunity: opportunityResult.opportunity,
      closeResult: null,
      workspaceResult: null,
      blockedUntilAnswered: [],
      nextActions: [
        "Pedir aprobacion de scope al cliente.",
        "Cobrar deposito antes de build.",
        "Crear delivery workspace solo despues de venta registrada.",
      ],
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const saleBlockers = [
    !parsed.clientApprovedScope && "falta aprobacion escrita del scope",
    !parsed.depositPaid && !parsed.cashCollectedUsd && "falta deposito/cash cobrado",
    (parsed.depositPaid || parsed.cashCollectedUsd) && !hasRevenuePaymentEvidence(parsed.paymentConfirmation) && "falta comprobante/referencia verificable de pago",
  ].filter(Boolean) as string[];

  if (saleBlockers.length > 0) {
    opportunityResult.opportunity.nextAction = `No cerrar venta todavia: ${saleBlockers.join("; ")}.`;
    opportunityResult.opportunity.updatedAt = new Date().toISOString();
    persistRevenueAutomationOpportunities();

    return {
      status: "sale_blocked" as const,
      reason: opportunityResult.opportunity.nextAction,
      intake,
      quote: effectiveQuote,
      opportunity: opportunityResult.opportunity,
      closeResult: null,
      workspaceResult: null,
      blockedUntilAnswered: [],
      nextActions: [
        "Conseguir aprobacion escrita del scope.",
        "Cobrar deposito y guardar referencia de Stripe/Zelle/recibo antes de registrar venta o construir.",
        "Volver a correr el agente con depositPaid/cashCollectedUsd/paymentConfirmation.",
      ],
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const closeResult = closeRevenueAutomationOpportunity({
    opportunityId: opportunityResult.opportunity.id,
    cashCollectedUsd: parsed.cashCollectedUsd,
    paymentConfirmation: parsed.paymentConfirmation,
    markScopeApproved: parsed.clientApprovedScope,
    notes: `${automationSaleFingerprint} | Cierre ejecutado por automation agent command con guardrails.`,
  });

  if (closeResult.status !== "recorded") {
    return {
      status: "sale_blocked" as const,
      reason: closeResult.reason,
      intake,
      quote: effectiveQuote,
      opportunity: closeResult.opportunity || opportunityResult.opportunity,
      closeResult,
      workspaceResult: null,
      blockedUntilAnswered: [],
      nextActions: ["Resolver bloqueo de venta.", "No crear delivery hasta que ledger registre cash.", "Revisar Profit Guard antes de gastar."],
      snapshot: closeResult.snapshot,
    };
  }

  if (parsed.lifecycleTarget !== "delivery" && !parsed.createDeliveryWorkspaceIfSold) {
    return {
      status: "sale_recorded" as const,
      reason: "Venta registrada; cash, margen y Profit Guard actualizados antes de delivery.",
      intake,
      quote: effectiveQuote,
      opportunity: closeResult.opportunity,
      closeResult,
      workspaceResult: null,
      blockedUntilAnswered: [],
      nextActions: ["Crear delivery workspace.", "Resolver QA de subagentes.", "No entregar hasta aprobacion final de Robert."],
      snapshot: closeResult.snapshot,
    };
  }

  const workspaceResult = createDeliveryWorkspaceFromAutomationOpportunity({
    opportunityId: opportunityResult.opportunity.id,
    workspaceName: parsed.workspaceName,
    publicDataVerified: parsed.publicDataVerified,
    visualQaPassed: parsed.visualQaPassed,
    technicalQaPassed: parsed.technicalQaPassed,
    automationQaPassed: parsed.automationQaPassed,
    clientHandoffReady: parsed.clientHandoffReady,
    launchTargetDays: parsed.launchTargetDays,
  });

  return {
    status: workspaceResult.status === "created" ? "delivery_workspace_created" as const : "delivery_blocked" as const,
    reason: workspaceResult.reason,
    intake,
    quote: effectiveQuote,
    opportunity: workspaceResult.opportunity || closeResult.opportunity,
    closeResult,
    workspaceResult,
    blockedUntilAnswered: [],
    nextActions: [
      workspaceResult.status === "created" ? "Resolver correctionQueue de QA." : "Resolver bloqueo antes de crear delivery.",
      "Mantener entrega bloqueada hasta que subagentes pasen QA.",
      "Registrar aprendizaje despues del handoff.",
    ],
    snapshot: workspaceResult.snapshot,
  };
}

export function createDeliveryWorkspaceFromAutomationOpportunity(input: RevenueAutomationOpportunityDeliveryInput) {
  loadRevenueAutomationOpportunities();
  loadRevenueLedger();
  loadRevenueDeliveryWorkspaces();
  const parsed = revenueAutomationOpportunityDeliverySchema.parse(input);
  const opportunity = revenueAutomationOpportunities.find((item) => item.id === parsed.opportunityId);

  if (!opportunity) {
    return {
      status: "not_found" as const,
      reason: "Oportunidad no encontrada.",
      opportunity: null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const blockingReasons = [
    opportunity.status === "blocked" && "la oportunidad esta bloqueada",
    opportunity.quote.clarificationGate.status !== "clear" && "faltan respuestas antes de producir",
    !opportunity.clientApprovedScope && "falta aprobacion escrita de scope",
    !opportunity.depositPaid && "falta deposito pagado",
    !hasRevenuePaymentEvidence(opportunity.paymentConfirmation) && "falta comprobante/referencia verificable de pago",
    !findVerifiedAutomationSaleLedgerEntry(opportunity) && "venta de automatizacion no registrada en ledger con cash y referencia verificable",
    opportunity.quote.pricing.estimatedInternalMonthlyCostUsd > 100 && "costo interno supera $100/mes",
    opportunity.quote.pricing.grossMarginPercent < 65 && "margen mensual menor a 65%",
  ].filter(Boolean) as string[];

  if (blockingReasons.length > 0) {
    opportunity.nextAction = `No crear delivery todavia: ${blockingReasons.join("; ")}.`;
    opportunity.updatedAt = new Date().toISOString();
    persistRevenueAutomationOpportunities();

    return {
      status: "blocked" as const,
      reason: opportunity.nextAction,
      opportunity,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const workspaceResult = recordRevenueDeliveryWorkspace({
    workspaceName: parsed.workspaceName === "Delivery workspace" ? `${opportunity.businessName} delivery` : parsed.workspaceName,
    sourceOpportunityId: opportunity.id,
    sourceLeadId: "",
    sourceOutreachDraftId: "",
    sourceUrl: "",
    mockupUrl: "",
    repoFullName: "",
    branchName: "",
    githubIssueUrl: "",
    prUrl: "",
    secondReviewStatus: "pending",
    secondReviewEvidenceUrl: "",
    appQaStatus: "pending",
    appQaEvidenceUrl: "",
    deploymentApprovalStatus: "not_requested",
    deploymentApprovalUrl: "",
    releaseGateHeadSha: "",
    clientName: opportunity.businessName,
    projectType: "automation",
    packageName: opportunity.quote.scope.packageName,
    setupUsd: opportunity.quote.pricing.setupPriceUsd,
    monthlyRetainerUsd: opportunity.quote.pricing.monthlyRetainerUsd,
    estimatedInternalCostUsd: opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    depositPaid: opportunity.depositPaid,
    scopeApproved: opportunity.clientApprovedScope,
    publicDataVerified: parsed.publicDataVerified,
    includesAutomation: true,
    launchTargetDays: parsed.launchTargetDays,
    clientRequest: opportunity.request,
    visualQaPassed: parsed.visualQaPassed,
    technicalQaPassed: parsed.technicalQaPassed,
    automationQaPassed: parsed.automationQaPassed,
    clientHandoffReady: parsed.clientHandoffReady,
  });

  opportunity.status = "in_delivery";
  opportunity.nextAction = `Delivery workspace creado: ${workspaceResult.workspace.id}. Resolver QA antes de mostrar o lanzar.`;
  opportunity.updatedAt = new Date().toISOString();
  persistRevenueAutomationOpportunities();

  return {
    status: "created" as const,
    reason: "Workspace de delivery creado con subagentes QA y guardrails de rentabilidad.",
    opportunity,
    workspace: workspaceResult.workspace,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function revenueWebsitePaymentEvidenceBlocker(opportunity: RevenueWebsiteOpportunity | null, draft: RevenueOutreachDraft | null) {
  if (!opportunity) return "oportunidad website no encontrada";
  if (!hasRevenuePaymentEvidence(opportunity.paymentConfirmation)) {
    return "oportunidad vendida sin referencia/comprobante verificable de pago";
  }
  if (!draft) return "draft de venta no encontrado";
  const recordedDepositPaymentConfirmation = draft.delivery.outcome === "deposit_collected"
    ? draft.delivery.outcomePaymentConfirmation || ""
    : "";
  if (!hasRevenuePaymentEvidence(recordedDepositPaymentConfirmation)) {
    return "deposito manual sin referencia/comprobante verificable en draft";
  }
  return "";
}

export function createWebsiteDeliveryWorkspaceFromLead(input: RevenueWebsiteDeliveryWorkspaceInput) {
  loadRevenueLeads();
  loadRevenueOutreach();
  loadRevenueLedger();
  loadRevenueWebsiteOpportunities();
  loadRevenueDeliveryWorkspaces();
  const parsed = revenueWebsiteDeliveryWorkspaceSchema.parse(input);
  const lead = revenueLeads.find((item) => item.id === parsed.leadId);

  if (!lead) {
    return {
      status: "not_found" as const,
      reason: "Lead no encontrado.",
      lead: null,
      outreachDraft: null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const selectedWebsiteOpportunity = parsed.websiteOpportunityId
    ? revenueWebsiteOpportunities.find((item) => item.id === parsed.websiteOpportunityId) || null
    : null;
  const effectiveOutreachDraftId = parsed.outreachDraftId || selectedWebsiteOpportunity?.sourceOutreachDraftId || "";
  const outreachDraft = effectiveOutreachDraftId
    ? revenueOutreachDrafts.find((draft) => draft.id === effectiveOutreachDraftId)
    : revenueOutreachDrafts
      .slice()
      .reverse()
      .find((draft) => draft.leadId === lead.id || draft.businessName.toLowerCase() === lead.businessName.toLowerCase());

  if (effectiveOutreachDraftId && !outreachDraft) {
    return {
      status: "blocked" as const,
      reason: "Outreach draft no encontrado para este handoff.",
      lead,
      outreachDraft: null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }
  const draftMatchesLead = !outreachDraft
    || outreachDraft.leadId === lead.id
    || (!outreachDraft.leadId && outreachDraft.businessName.toLowerCase() === lead.businessName.toLowerCase());
  if (!draftMatchesLead) {
    return {
      status: "blocked" as const,
      reason: "Outreach draft no pertenece al lead seleccionado.",
      lead,
      outreachDraft,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const websiteOpportunity = parsed.websiteOpportunityId
    ? selectedWebsiteOpportunity
    : findRevenueWebsiteOpportunityByLeadOrDraft(lead.id, outreachDraft?.id || "");
  const opportunityMatches = websiteOpportunity
    && websiteOpportunity.sourceLeadId === lead.id
    && (!outreachDraft || websiteOpportunity.sourceOutreachDraftId === outreachDraft.id);
  if (!opportunityMatches) {
    return {
      status: "blocked" as const,
      reason: "Crear y cerrar una oportunidad website vendida para este lead/draft antes de delivery.",
      lead,
      outreachDraft: outreachDraft || null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }
  if (websiteOpportunity.status !== "sold" || !websiteOpportunity.depositPaid || !websiteOpportunity.scopeApproved) {
    return {
      status: "blocked" as const,
      reason: "La oportunidad website debe estar vendida con deposito y scope aprobados antes de crear delivery.",
      lead,
      outreachDraft: outreachDraft || null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }
  const paymentEvidenceBlocker = revenueWebsitePaymentEvidenceBlocker(websiteOpportunity, outreachDraft || null);
  if (paymentEvidenceBlocker) {
    return {
      status: "blocked" as const,
      reason: paymentEvidenceBlocker,
      lead,
      outreachDraft: outreachDraft || null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const qualification = qualifyRevenueLead(lead);
  const effectiveMockupUrl = parsed.mockupUrl || outreachDraft?.mockupUrl || "";
  const setupUsd = websiteOpportunity.setupUsd;
  const monthlyRetainerUsd = websiteOpportunity.monthlyRetainerUsd || outreachDraft?.monthlyRetainerUsd || parsed.monthlyRetainerUsd;
  const estimatedInternalCostUsd = websiteOpportunity.estimatedInternalCostUsd || outreachDraft?.estimatedInternalMonthlyCostUsd || parsed.estimatedInternalCostUsd;
  const projectType = websiteOpportunity.projectType;
  const includesAutomation = projectType === "bundle";
  const depositPaid = websiteOpportunity.depositPaid;
  const publicDataVerified = parsed.publicDataVerified;
  const sourceUrl = websiteOpportunity.sourceUrl || outreachDraft?.sourceUrl || "";
  const requiredDepositUsd = websiteOpportunity.requiredDepositUsd;
  const cashCollectedUsd = websiteOpportunity.cashCollectedUsd;
  const ledgerTag = `website-lead:${lead.id}`;
  const legacyLedgerTag = `[${ledgerTag}]`;
  const cashCollectedCoversDeposit = cashCollectedUsd >= requiredDepositUsd;
  const contextLines = [
    `Lead: ${lead.businessName} (${lead.niche}, ${lead.area})`,
    `Website status: ${lead.websiteStatus}`,
    `Qualification: ${qualification.grade} - ${qualification.guardrail}`,
    lead.evidence && `Public evidence: ${lead.evidence}`,
    lead.painPoint && `Pain point: ${lead.painPoint}`,
    sourceUrl && `Source URL: ${sourceUrl}`,
    effectiveMockupUrl && `Mockup preview: ${effectiveMockupUrl}`,
    outreachDraft && `Outreach draft: ${outreachDraft.subject} (${outreachDraft.status}, ${outreachDraft.delivery.sendStatus})`,
    cashCollectedUsd > 0 && `Cash collected for deposit: $${cashCollectedUsd.toLocaleString("en-US")}`,
    parsed.notes && `Operator notes: ${parsed.notes}`,
    "Codex build rule: create a separate branch and PR; do not deploy without Robert approval and App QA.",
  ].filter(Boolean).join("\n");

  const existingWorkspace = revenueDeliveryWorkspaces.find((workspace) =>
    workspace.input.sourceOpportunityId === websiteOpportunity.id
    || (workspace.input.sourceLeadId === lead.id && ["website", "bundle"].includes(workspace.input.projectType))
  );
  if (existingWorkspace) {
    return {
      status: "already_created" as const,
      reason: `Delivery workspace ya existe para esta venta: ${existingWorkspace.id}.`,
      lead,
      outreachDraft: outreachDraft || null,
      workspace: existingWorkspace,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  if (!depositPaid || !websiteOpportunity.scopeApproved) {
    return {
      status: "blocked" as const,
      reason: "Confirmar deposito y scope aprobado antes de crear delivery workspace de website.",
      lead,
      outreachDraft: outreachDraft || null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  if (depositPaid && websiteOpportunity.scopeApproved && !cashCollectedCoversDeposit) {
    return {
      status: "blocked" as const,
      reason: `Deposito incompleto: falta cobrar $${(requiredDepositUsd - cashCollectedUsd).toLocaleString("en-US")} antes de cerrar venta o crear delivery.`,
      lead,
      outreachDraft: outreachDraft || null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  if (!parsed.repoFullName) {
    return {
      status: "blocked" as const,
      reason: "Repo GitHub owner/repo requerido antes de crear delivery workspace PR-first.",
      lead,
      outreachDraft: outreachDraft || null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }
  const deliveryBranchName = (parsed.branchName || `codex/client-${slugifyRevenueValue(lead.businessName)}-website`).trim();
  if (!isRevenueCodexBranchName(deliveryBranchName)) {
    return {
      status: "blocked" as const,
      reason: "Branch codex/... requerido antes de crear delivery workspace PR-first.",
      lead,
      outreachDraft: outreachDraft || null,
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  if (depositPaid && websiteOpportunity.scopeApproved && lead.status !== "closed") {
    lead.status = strongerRevenueLeadStatus(lead.status, "closed");
    lead.updatedAt = new Date().toISOString();
    persistRevenueLeads();
  }

  const existingLedgerEntry = revenueLedger.find((entry) =>
    entry.notes.split("|").map((part) => part.trim()).some((part) => part === ledgerTag || part === legacyLedgerTag)
  );
  if (depositPaid && websiteOpportunity.scopeApproved && cashCollectedUsd > 0 && !existingLedgerEntry) {
    const ledgerNotes = [
      ledgerTag,
      outreachDraft && `outreach:${outreachDraft.id}`,
      effectiveMockupUrl && `mockup:${effectiveMockupUrl}`,
      sourceUrl && `source:${sourceUrl}`,
      websiteOpportunity.paymentConfirmation && `Payment confirmation:${websiteOpportunity.paymentConfirmation}`,
      outreachDraft?.delivery.outcomePaymentConfirmation && `Outreach payment confirmation:${outreachDraft.delivery.outcomePaymentConfirmation}`,
      parsed.notes,
    ].filter((item): item is string => Boolean(item && item.trim().length > 0)).join(" | ").slice(0, 1000);

    recordRevenueLedgerEntry({
      kind: includesAutomation ? "bundle_sale" : "website_sale",
      clientName: lead.businessName,
      amountUsd: setupUsd,
      cashCollectedUsd,
      estimatedInternalCostUsd,
      notes: ledgerNotes,
    });
  }

  const workspaceResult = recordRevenueDeliveryWorkspace({
    workspaceName: parsed.workspaceName === "Website delivery workspace" ? `${lead.businessName} website delivery` : parsed.workspaceName,
    sourceOpportunityId: websiteOpportunity.id,
    sourceLeadId: lead.id,
    sourceOutreachDraftId: outreachDraft?.id || "",
    sourceUrl,
    mockupUrl: effectiveMockupUrl,
    repoFullName: parsed.repoFullName || "",
    branchName: deliveryBranchName,
    githubIssueUrl: "",
    prUrl: "",
    secondReviewStatus: "pending",
    secondReviewEvidenceUrl: "",
    appQaStatus: "pending",
    appQaEvidenceUrl: "",
    deploymentApprovalStatus: "not_requested",
    deploymentApprovalUrl: "",
    releaseGateHeadSha: "",
    clientName: lead.businessName,
    projectType,
    packageName: revenueWebsiteOfferName(outreachDraft?.websitePriceUsd || setupUsd, projectType === "bundle"),
    setupUsd,
    monthlyRetainerUsd,
    estimatedInternalCostUsd,
    depositPaid,
    scopeApproved: websiteOpportunity.scopeApproved,
    publicDataVerified,
    includesAutomation,
    launchTargetDays: parsed.launchTargetDays,
    clientRequest: contextLines.slice(0, 1200),
    visualQaPassed: parsed.visualQaPassed,
    technicalQaPassed: parsed.technicalQaPassed,
    automationQaPassed: parsed.automationQaPassed,
    clientHandoffReady: parsed.clientHandoffReady,
  });

  return {
    status: "created" as const,
    reason:
      workspaceResult.workspace.status === "ready_to_deliver"
        ? "Website delivery workspace listo para entrega controlada despues de QA final."
        : "Website delivery workspace creado; resolver correctionQueue antes de construir, mostrar o lanzar.",
    lead,
    outreachDraft: outreachDraft || null,
    workspace: workspaceResult.workspace,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function closeRevenueAutomationOpportunity(input: RevenueAutomationOpportunityCloseInput) {
  loadRevenueAutomationOpportunities();
  loadRevenueLedger();
  const parsed = revenueAutomationOpportunityCloseSchema.parse(input);
  const opportunity = revenueAutomationOpportunities.find((item) => item.id === parsed.opportunityId);

  if (!opportunity) {
    return {
      status: "not_found" as const,
      reason: "Oportunidad no encontrada.",
      opportunity: null,
      entry: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const unverifiedExistingEntry = findUnverifiedAutomationSaleLedgerEntry(opportunity);
  if (unverifiedExistingEntry) {
    opportunity.nextAction = "No registrar venta todavia: existe una fila ledger para esta oportunidad sin cash/referencia verificable; corregir o limpiar ledger antes de cerrar.";
    opportunity.updatedAt = new Date().toISOString();
    persistRevenueAutomationOpportunities();

    return {
      status: "blocked" as const,
      reason: opportunity.nextAction,
      opportunity,
      entry: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }
  const verifiedExistingEntry = findVerifiedAutomationSaleLedgerEntry(opportunity);
  if (verifiedExistingEntry) {
    return {
      status: "already_recorded" as const,
      reason: "Esta oportunidad ya tiene una venta registrada en ledger.",
      opportunity,
      entry: verifiedExistingEntry,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const cashCollectedUsd = parsed.cashCollectedUsd ?? opportunity.quote.pricing.requiredDepositUsd;
  const requiredDepositUsd = opportunity.quote.pricing.requiredDepositUsd;
  const blockingReasons = [
    opportunity.status === "blocked" && "la oportunidad esta bloqueada",
    opportunity.quote.clarificationGate.status !== "clear" && "faltan respuestas antes de cerrar",
    !(parsed.markScopeApproved || opportunity.clientApprovedScope) && "falta aprobacion escrita de scope",
    cashCollectedUsd <= 0 && "falta cash/deposito cobrado",
    cashCollectedUsd > 0 && cashCollectedUsd < requiredDepositUsd && `deposito incompleto: falta cobrar $${(requiredDepositUsd - cashCollectedUsd).toLocaleString("en-US")}`,
    !hasRevenuePaymentEvidence(parsed.paymentConfirmation || opportunity.paymentConfirmation) && "falta comprobante/referencia verificable de pago",
    opportunity.quote.pricing.estimatedInternalMonthlyCostUsd > 100 && "costo interno supera $100/mes",
    opportunity.quote.pricing.grossMarginPercent < 65 && "margen mensual menor a 65%",
  ].filter(Boolean) as string[];

  if (blockingReasons.length > 0) {
    opportunity.nextAction = `No registrar venta todavia: ${blockingReasons.join("; ")}.`;
    opportunity.updatedAt = new Date().toISOString();
    persistRevenueAutomationOpportunities();

    return {
      status: "blocked" as const,
      reason: opportunity.nextAction,
      opportunity,
      entry: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  opportunity.status = "sold";
  opportunity.clientApprovedScope = parsed.markScopeApproved || opportunity.clientApprovedScope;
  opportunity.depositPaid = true;
  opportunity.paymentConfirmation = parsed.paymentConfirmation || opportunity.paymentConfirmation;
  opportunity.nextAction = "Venta registrada en ledger. Crear delivery workspace y mantener QA antes de entregar.";
  opportunity.updatedAt = new Date().toISOString();
  persistRevenueAutomationOpportunities();

  const ledgerResult = recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: opportunity.businessName,
    amountUsd: opportunity.quote.pricing.setupPriceUsd,
    cashCollectedUsd,
    estimatedInternalCostUsd: opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    notes: [
      `Automation opportunity:${opportunity.id}`,
      opportunity.quote.scope.packageName,
      opportunity.paymentConfirmation && `Payment confirmation:${opportunity.paymentConfirmation}`,
      parsed.notes,
    ].filter((item) => item.trim().length > 0).join(" | "),
  });

  return {
    status: "recorded" as const,
    reason: "Venta de automatizacion registrada; métricas, cash y Profit Guard actualizados.",
    opportunity,
    entry: ledgerResult.entry,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function manualActionForRevenueDraft(draft: RevenueOutreachDraft) {
  if (draft.channel === "instagram") return "Abrir Instagram y enviar manualmente solo despues de revisar el draft.";
  if (draft.channel === "contact_form") return "Abrir el formulario publico del negocio y pegar el mensaje aprobado.";
  if (draft.channel === "mailto") return "Abrir mailto y enviar manualmente desde la cuenta aprobada.";
  return "Abrir Gmail compose y enviar manualmente desde la cuenta aprobada.";
}

function contactUrlForRevenueDraft(draft: RevenueOutreachDraft) {
  if (draft.channel === "mailto") return draft.links.mailto;
  if (draft.channel === "instagram" || draft.channel === "contact_form") return draft.sourceUrl || draft.links.mailto;
  return draft.links.gmailCompose;
}

function buildRevenueManualCloseEvidencePacket(draft: RevenueOutreachDraft, contactUrl: string) {
  const setupUsd = draft.pricing.totalSetupUsd.toLocaleString("en-US");
  const depositUsd = draft.pricing.depositUsd.toLocaleString("en-US");
  const retainerUsd = draft.pricing.monthlyRetainerUsd.toLocaleString("en-US");
  const mockupUrl = draft.mockupUrl || "pending; attach approved preview before delivery handoff";
  const sourceUrl = draft.sourceUrl || "pending; attach public source before delivery handoff";
  const paymentEvidenceRequired = [
    "Payment reference: Stripe invoice/payment id, bank/Zelle/CashApp reference, receipt URL, or provider confirmation code.",
    `Cash collected must be at least the required deposit: $${depositUsd}.`,
    "Scope approval must be explicit before any delivery workspace is started.",
    "Record who approved, what package was accepted, and any promised launch deadline.",
  ];

  return {
    paymentEvidenceRequired,
    copyableCloseEvidencePacket: [
      `Manual close evidence packet: ${draft.businessName}`,
      `Draft: ${draft.id}`,
      draft.leadId ? `Lead: ${draft.leadId}` : "Lead: not linked; connect lead before delivery.",
      `Channel: ${draft.channel}`,
      `Contact URL: ${contactUrl}`,
      `Public source: ${sourceUrl}`,
      `Mockup/preview: ${mockupUrl}`,
      "",
      "Accepted offer to confirm:",
      `- Setup: $${setupUsd}`,
      `- Deposit due before build: $${depositUsd}`,
      `- Monthly retainer: $${retainerUsd}/mo`,
      "",
      "Required close evidence:",
      ...paymentEvidenceRequired.map((item) => `- ${item}`),
      "",
      "Record outcome:",
      "- Use Deposit only after Robert has verified the payment evidence.",
      "- Notes should include the scope approval, payment reference, and next delivery promise.",
      "- Do not create delivery workspace until deposit and scope evidence are recorded.",
      "",
      "Guardrails:",
      "- Do not auto-charge, auto-send, submit forms automatically, or publish previews from this packet.",
      "- Keep sensitive payment artifacts out of public issues and PR text.",
    ].join("\n"),
  };
}

function buildRevenueManualOutcomeRequests(draft: RevenueOutreachDraft) {
  const request = (
    outcome: RevenueOutreachOutcomeInput["outcome"],
    notes: string,
    cashCollectedUsd = 0,
    paymentConfirmation = ""
  ) => JSON.stringify({
    draftId: draft.id,
    outcome,
    outcomeRecordedByRobert: true,
    cashCollectedUsd,
    paymentConfirmation,
    notes,
  }, null, 2);

  return {
    contacted: request("contacted", "Robert confirmed this business was contacted manually from the daily queue."),
    reply: request("reply", "Robert confirmed the business replied; continue manually toward call, scope and deposit."),
    callBooked: request("call_booked", "Robert confirmed a call was booked; prepare scope, deposit ask and delivery gates."),
    depositCollected: request(
      "deposit_collected",
      "Robert verified the payment evidence and scope path; close the website opportunity only after scope is explicit.",
      draft.pricing.depositUsd,
      ""
    ),
    lost: request("lost", "Robert marked this lead lost; capture learning before contacting similar leads."),
  };
}

function manualOutreachBlockedReason(draft: RevenueOutreachDraft) {
  const failedGate = draft.qaGates.find((gate) => !gate.passed);
  if (failedGate) return failedGate.fix;
  if ((draft.channel === "instagram" || draft.channel === "contact_form") && !draft.sourceUrl) {
    return "Agregar sourceUrl del perfil/formulario publico antes de contacto manual.";
  }
  return draft.nextAction;
}

function buildRevenueManualOutreachQueue(dailyContactLimit = 10): RevenueManualOutreachQueue {
  const safeLimit = Math.max(0, Math.min(50, Math.floor(dailyContactLimit)));
  const todayKey = new Date().toISOString().slice(0, 10);
  const sentTodayCount = revenueOutreachDrafts.filter((draft) => draft.delivery.sentAt?.startsWith(todayKey)).length;
  const remainingContactSlots = Math.max(0, safeLimit - sentTodayCount);
  const unsentDrafts = revenueOutreachDrafts
    .filter((draft) => draft.delivery.sendStatus !== "sent")
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const readyDrafts = unsentDrafts.filter((draft) =>
    draft.status === "approved"
    && draft.qaGates.every((gate) => gate.passed)
    && !((draft.channel === "instagram" || draft.channel === "contact_form") && !draft.sourceUrl)
  );
  const readyToday = readyDrafts.slice(0, remainingContactSlots);
  const overflow = readyDrafts.slice(remainingContactSlots);
  const blockedAll = [
    ...unsentDrafts
      .filter((draft) =>
        draft.status !== "approved"
        || draft.qaGates.some((gate) => !gate.passed)
        || ((draft.channel === "instagram" || draft.channel === "contact_form") && !draft.sourceUrl)
      )
      .map((draft) => ({
        draftId: draft.id,
        businessName: draft.businessName,
        status: draft.status,
        reason: manualOutreachBlockedReason(draft),
      })),
    ...overflow.map((draft) => ({
      draftId: draft.id,
      businessName: draft.businessName,
      status: draft.status,
      reason: sentTodayCount >= safeLimit
        ? `Daily contact limit already used (${sentTodayCount}/${safeLimit}); keep for the next batch.`
        : `Daily contact limit reached (${safeLimit}); keep for the next batch.`,
    })),
  ];
  const blockedSample = blockedAll.slice(0, 10);

  return {
    status: readyToday.length > 0 ? "ready" : blockedAll.length > 0 ? "needs_approval" : "empty",
    dailyContactLimit: safeLimit,
    readyCount: readyToday.length,
    blockedCount: blockedAll.length,
    overflowCount: overflow.length,
    items: readyToday.map((draft) => {
      const contactUrl = contactUrlForRevenueDraft(draft);
      const manualAction = manualActionForRevenueDraft(draft);
      const closeEvidence = buildRevenueManualCloseEvidencePacket(draft, contactUrl);
      const copyableOutcomeRequests = buildRevenueManualOutcomeRequests(draft);
      return {
        draftId: draft.id,
        businessName: draft.businessName,
        channel: draft.channel,
        subject: draft.subject,
        manualAction,
        priority: draft.pricing.totalSetupUsd >= 3500 ? "high" as const : "medium" as const,
        contactUrl,
        fallbackUrl: draft.links.mailto,
        estimatedSetupUsd: draft.pricing.totalSetupUsd,
        depositUsd: draft.pricing.depositUsd,
        monthlyRetainerUsd: draft.pricing.monthlyRetainerUsd,
        paymentEvidenceRequired: closeEvidence.paymentEvidenceRequired,
        copyableContactPacket: [
          `Manual outreach packet: ${draft.businessName}`,
          `Channel: ${draft.channel}`,
          `Open: ${contactUrl}`,
          draft.links.mailto ? `Fallback: ${draft.links.mailto}` : "Fallback: none; use approved copy only in the public manual channel.",
          `Subject: ${draft.subject}`,
          "",
          draft.body,
          "",
          `Offer: setup $${draft.pricing.totalSetupUsd.toLocaleString("en-US")} + retainer $${draft.pricing.monthlyRetainerUsd.toLocaleString("en-US")}/mo`,
          `Deposit to collect before build: $${draft.pricing.depositUsd.toLocaleString("en-US")}`,
          "",
          "After manual action:",
          "- Record Contacted/Reply/Call/Deposit/Lost in Revenue Engine.",
          "- Do not auto-send, bulk DM, submit forms automatically, or publish previews from this packet.",
          `Next action: ${manualAction}`,
        ].join("\n"),
        copyableCloseEvidencePacket: closeEvidence.copyableCloseEvidencePacket,
        copyableOutcomeRequests,
        nextAction: "Revisar evidencia, abrir enlace manual y registrar contacted/reply/call/deposito desde esta cola.",
      };
    }),
    blocked: blockedSample,
    nextAction:
      readyToday.length > 0
        ? `Contactar manualmente max ${readyToday.length}/${safeLimit} leads aprobados hoy; ya enviados ${sentTodayCount}.`
        : blockedAll.length > 0
          ? "Aprobar o corregir drafts antes de contactar negocios."
          : "Crear y aprobar drafts desde Money sprint antes de contactar negocios.",
    safety: {
      sendsOutreach: false,
      requiresHumanApproval: true,
      blockedActions: ["auto-send email", "auto-submit contact form", "bulk DM", "paid data", "publish mockup"],
    },
  };
}

function findLatestRevenueOutreachDraftForLead(lead: RevenueLead) {
  return revenueOutreachDrafts
    .slice()
    .reverse()
    .find((draft) =>
      draft.leadId === lead.id
      || (!draft.leadId && draft.businessName.toLowerCase() === lead.businessName.toLowerCase())
    ) || null;
}

function findRevenueWebsiteOpportunityByLeadOrDraft(leadId: string, draftId: string) {
  return revenueWebsiteOpportunities.find((opportunity) =>
    opportunity.sourceLeadId === leadId
    || (draftId.trim().length > 0 && opportunity.sourceOutreachDraftId === draftId)
  ) || null;
}

function isClosedRevenueWebsiteOpportunity(
  opportunity: RevenueWebsiteOpportunity | null | undefined,
): opportunity is RevenueWebsiteOpportunity & { status: "sold" | "delivered" } {
  return opportunity?.status === "sold" || opportunity?.status === "delivered";
}

function syncRevenueWebsiteOpportunityFromDepositOutcome(
  lead: RevenueLead | null,
  draft: RevenueOutreachDraft,
  cashCollectedUsd: number,
  paymentConfirmation: string,
  notes: string,
) {
  if (!lead || cashCollectedUsd <= 0) return null;
  loadRevenueWebsiteOpportunities();
  const failedBlockingGate = draft.qaGates.find((gate) => !gate.passed && gate.gate !== "approval");
  const gates = [
    { gate: "lead_found", passed: true, fix: "Seleccionar un lead existente." },
    { gate: "draft_found", passed: true, fix: "Crear propuesta/draft conectado al lead." },
    { gate: "draft_approved", passed: draft.status === "approved", fix: "Aprobar el draft antes de crear oportunidad website." },
    { gate: "website_scope", passed: draft.websitePriceUsd > 0, fix: "Agregar alcance y precio de website antes de crear una oportunidad website." },
    { gate: "mockup", passed: Boolean(draft.mockupUrl), fix: "Generar o adjuntar mockup preview." },
    { gate: "public_source", passed: Boolean(draft.sourceUrl), fix: "Adjuntar sourceUrl publico del negocio." },
    { gate: "draft_qa", passed: !failedBlockingGate, fix: failedBlockingGate?.fix || "Corregir QA del draft." },
  ];
  if (gates.some((gate) => !gate.passed)) return null;

  const existing = findRevenueWebsiteOpportunityByLeadOrDraft(lead.id, draft.id);
  const now = new Date().toISOString();
  const preserveClosedChain = isClosedRevenueWebsiteOpportunity(existing);
  const projectType = existing?.projectType || (draft.automationPriceUsd > 0 ? "bundle" as const : "website" as const);
  const setupUsd = existing?.setupUsd || (projectType === "website" ? clampRevenueWebsitePrice(draft.websitePriceUsd) : draft.pricing.totalSetupUsd);
  const requiredDepositUsd = existing?.requiredDepositUsd || Math.round(setupUsd * 0.5);
  const status = existing?.status === "delivered"
    ? "delivered" as const
    : existing?.status === "sold"
      ? "sold" as const
    : existing?.scopeApproved
      ? "scope_approved" as const
      : "quoted" as const;
  const opportunity: RevenueWebsiteOpportunity = {
    leadId: preserveClosedChain ? existing.leadId : lead.id,
    outreachDraftId: preserveClosedChain ? existing.outreachDraftId : draft.id,
    projectType,
    notes: notes || "Manual deposit outcome recorded from outreach.",
    id: existing?.id || `website-opportunity-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    status,
    businessName: lead.businessName,
    sourceLeadId: preserveClosedChain ? existing.sourceLeadId : lead.id,
    sourceOutreachDraftId: preserveClosedChain ? existing.sourceOutreachDraftId : draft.id,
    mockupUrl: preserveClosedChain ? existing.mockupUrl : draft.mockupUrl || "",
    sourceUrl: preserveClosedChain ? existing.sourceUrl : draft.sourceUrl || "",
    setupUsd,
    requiredDepositUsd,
    cashCollectedUsd: Math.max(existing?.cashCollectedUsd || 0, cashCollectedUsd),
    monthlyRetainerUsd: existing?.monthlyRetainerUsd || draft.pricing.monthlyRetainerUsd,
    estimatedInternalCostUsd: existing?.estimatedInternalCostUsd || draft.pricing.estimatedInternalMonthlyCostUsd,
    depositPaid: true,
    scopeApproved: existing?.scopeApproved || false,
    paymentConfirmation,
    qaGates: preserveClosedChain ? existing.qaGates : gates,
    nextAction: status === "delivered"
      ? "Website entregado; medir resultados y correr review semanal."
      : status === "sold"
        ? "Oportunidad vendida; usar handoff de delivery para crear workspace QA-gated."
      : existing?.scopeApproved
        ? "Deposito y scope registrados; cerrar oportunidad para habilitar delivery."
        : "Deposito registrado; falta aprobar scope antes de convertir a delivery.",
    safety: {
      sendsOutreach: false,
      createsWorkspace: false,
      requiresDepositAndScopeForDelivery: true,
      blockedActions: ["send outreach", "create delivery workspace before sold", "deploy website", "record sale without deposit/scope"],
    },
  };

  if (existing) {
    revenueWebsiteOpportunities.splice(revenueWebsiteOpportunities.indexOf(existing), 1, opportunity);
  } else {
    revenueWebsiteOpportunities.push(opportunity);
  }
  persistRevenueWebsiteOpportunities();
  return opportunity;
}

export function recordRevenueWebsiteOpportunity(input: RevenueWebsiteOpportunityInput) {
  loadRevenueLeads();
  loadRevenueOutreach();
  loadRevenueWebsiteOpportunities();
  const parsed = revenueWebsiteOpportunitySchema.parse(input);
  const lead = revenueLeads.find((item) => item.id === parsed.leadId) || null;
  const draft = parsed.outreachDraftId
    ? revenueOutreachDrafts.find((item) => item.id === parsed.outreachDraftId) || null
    : lead ? findLatestRevenueOutreachDraftForLead(lead) : null;
  const failedBlockingGate = draft?.qaGates.find((gate) => !gate.passed && gate.gate !== "approval");
  const gates = [
    { gate: "lead_found", passed: Boolean(lead), fix: "Seleccionar un lead existente." },
    { gate: "draft_found", passed: Boolean(draft), fix: "Crear propuesta/draft conectado al lead." },
    { gate: "draft_approved", passed: draft?.status === "approved", fix: "Aprobar el draft antes de crear oportunidad website." },
    { gate: "website_scope", passed: Boolean(draft && draft.websitePriceUsd > 0), fix: "Agregar alcance y precio de website antes de crear una oportunidad website." },
    { gate: "mockup", passed: Boolean(draft?.mockupUrl), fix: "Generar o adjuntar mockup preview." },
    { gate: "public_source", passed: Boolean(draft?.sourceUrl), fix: "Adjuntar sourceUrl publico del negocio." },
    { gate: "draft_qa", passed: !failedBlockingGate, fix: failedBlockingGate?.fix || "Corregir QA del draft." },
  ];
  const failedGate = gates.find((gate) => !gate.passed);

  if (!lead || !draft || failedGate) {
    return {
      status: "blocked" as const,
      reason: failedGate?.fix || "No se pudo crear oportunidad website.",
      opportunity: null,
      gates,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const existing = findRevenueWebsiteOpportunityByLeadOrDraft(lead.id, draft.id);
  const now = new Date().toISOString();
  const preserveSoldChain = isClosedRevenueWebsiteOpportunity(existing);
  const projectType = isClosedRevenueWebsiteOpportunity(existing)
    ? existing.projectType
    : parsed.projectType === "website" || draft.automationPriceUsd <= 0 ? "website" as const : "bundle" as const;
  const existingStatus = isClosedRevenueWebsiteOpportunity(existing) || existing?.status === "scope_approved" ? existing.status : "quoted";
  const quotedSetupUsd = projectType === "website" ? clampRevenueWebsitePrice(draft.websitePriceUsd) : draft.pricing.totalSetupUsd;
  const setupUsd = isClosedRevenueWebsiteOpportunity(existing) ? existing.setupUsd : quotedSetupUsd;
  const requiredDepositUsd = isClosedRevenueWebsiteOpportunity(existing) ? existing.requiredDepositUsd : Math.round(setupUsd * 0.5);
  const opportunity: RevenueWebsiteOpportunity = {
    ...parsed,
    leadId: preserveSoldChain ? existing.leadId : lead.id,
    outreachDraftId: preserveSoldChain ? existing.outreachDraftId : draft.id,
    projectType,
    id: existing?.id || `website-opportunity-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    status: existingStatus,
    businessName: lead.businessName,
    sourceLeadId: preserveSoldChain ? existing.sourceLeadId : lead.id,
    sourceOutreachDraftId: preserveSoldChain ? existing.sourceOutreachDraftId : draft.id,
    mockupUrl: preserveSoldChain ? existing.mockupUrl : draft.mockupUrl || "",
    sourceUrl: preserveSoldChain ? existing.sourceUrl : draft.sourceUrl || "",
    setupUsd,
    requiredDepositUsd,
    cashCollectedUsd: existing?.cashCollectedUsd || 0,
    monthlyRetainerUsd: isClosedRevenueWebsiteOpportunity(existing) ? existing.monthlyRetainerUsd : draft.pricing.monthlyRetainerUsd,
    estimatedInternalCostUsd: isClosedRevenueWebsiteOpportunity(existing) ? existing.estimatedInternalCostUsd : draft.pricing.estimatedInternalMonthlyCostUsd,
    depositPaid: existing?.depositPaid || false,
    scopeApproved: existing?.scopeApproved || false,
    paymentConfirmation: existing?.paymentConfirmation || "",
    qaGates: preserveSoldChain ? existing.qaGates : gates,
    nextAction: existingStatus === "delivered"
      ? "Website entregado; medir resultados y correr review semanal."
      : existingStatus === "sold"
        ? "Oportunidad vendida; usar handoff de delivery para crear workspace QA-gated."
      : existingStatus === "scope_approved"
        ? "Scope aprobado; falta confirmar deposito/pago antes de delivery."
        : "Cerrar solo cuando deposito, scope y confirmacion de pago esten registrados.",
    safety: {
      sendsOutreach: false,
      createsWorkspace: false,
      requiresDepositAndScopeForDelivery: true,
      blockedActions: ["send outreach", "create delivery workspace before sold", "deploy website", "record sale without deposit/scope"],
    },
  };

  if (existing) {
    revenueWebsiteOpportunities.splice(revenueWebsiteOpportunities.indexOf(existing), 1, opportunity);
  } else {
    revenueWebsiteOpportunities.push(opportunity);
  }
  persistRevenueWebsiteOpportunities();

  return {
    status: isClosedRevenueWebsiteOpportunity(opportunity) ? "already_sold" as const : "quoted" as const,
    reason: opportunity.nextAction,
    opportunity,
    gates,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function closeRevenueWebsiteOpportunity(input: RevenueWebsiteOpportunityCloseInput) {
  loadRevenueLeads();
  loadRevenueOutreach();
  loadRevenueLedger();
  loadRevenueWebsiteOpportunities();
  const parsed = revenueWebsiteOpportunityCloseSchema.parse(input);
  const opportunity = revenueWebsiteOpportunities.find((item) => item.id === parsed.opportunityId) || null;
  const lead = opportunity ? revenueLeads.find((item) => item.id === opportunity.sourceLeadId) || null : null;
  const draft = opportunity ? revenueOutreachDrafts.find((item) => item.id === opportunity.sourceOutreachDraftId) || null : null;
  const requiredDepositUsd = opportunity?.requiredDepositUsd || 0;
  const recordedDepositCashUsd = draft?.delivery.outcome === "deposit_collected" ? draft.delivery.outcomeCashCollectedUsd || 0 : 0;
  const recordedDepositPaymentConfirmation = draft?.delivery.outcome === "deposit_collected" ? draft.delivery.outcomePaymentConfirmation || "" : "";
  const depositOutcomeCoversRequired = recordedDepositCashUsd >= requiredDepositUsd && requiredDepositUsd > 0;
  const recordedDepositPaymentConfirmed = hasRevenuePaymentEvidence(recordedDepositPaymentConfirmation);
  const paymentConfirmed = hasRevenuePaymentEvidence(parsed.paymentConfirmation);
  const blockers = [
    !opportunity && "oportunidad no encontrada",
    opportunity?.status === "blocked" && "oportunidad bloqueada",
    opportunity?.status === "delivered" && "oportunidad ya entregada",
    !lead && "lead no encontrado",
    !draft && "draft no encontrado",
    draft && draft.delivery.outcome !== "deposit_collected" && "deposito manual no registrado en outreach outcome",
    draft && draft.delivery.outcome === "deposit_collected" && !depositOutcomeCoversRequired && `deposito manual insuficiente: falta cobrar $${Math.max(0, requiredDepositUsd - recordedDepositCashUsd).toLocaleString("en-US")}`,
    depositOutcomeCoversRequired && !recordedDepositPaymentConfirmed && "deposito manual sin referencia/comprobante de pago verificable",
    !parsed.scopeApproved && "scope no aprobado",
    !parsed.depositPaid && "deposito no marcado",
    parsed.cashCollectedUsd < requiredDepositUsd && `deposito incompleto: falta cobrar $${Math.max(0, requiredDepositUsd - parsed.cashCollectedUsd).toLocaleString("en-US")}`,
    depositOutcomeCoversRequired && parsed.cashCollectedUsd !== recordedDepositCashUsd && `cashCollectedUsd debe coincidir con el deposito manual registrado: $${recordedDepositCashUsd.toLocaleString("en-US")}`,
    !paymentConfirmed && "falta referencia/comprobante verificable de pago/deposito",
  ].filter(Boolean) as string[];

  if (!opportunity || blockers.length > 0) {
    if (opportunity && opportunity.status !== "delivered") {
      const nextScopeApproved = opportunity.scopeApproved || parsed.scopeApproved;
      const nextDepositPaid = opportunity.depositPaid || depositOutcomeCoversRequired;
      opportunity.status = nextScopeApproved ? "scope_approved" : "quoted";
      opportunity.cashCollectedUsd = Math.max(opportunity.cashCollectedUsd, recordedDepositCashUsd);
      opportunity.depositPaid = nextDepositPaid;
      opportunity.scopeApproved = nextScopeApproved;
      opportunity.paymentConfirmation = depositOutcomeCoversRequired && paymentConfirmed
        ? parsed.paymentConfirmation || opportunity.paymentConfirmation
        : opportunity.paymentConfirmation;
      opportunity.nextAction = `No convertir a delivery todavia: ${blockers.join("; ")}.`;
      opportunity.updatedAt = new Date().toISOString();
      persistRevenueWebsiteOpportunities();
    }
    return {
      status: "blocked" as const,
      reason: blockers.join("; ") || "No se pudo cerrar oportunidad.",
      opportunity,
      lead,
      draft,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const now = new Date().toISOString();
  opportunity.status = "sold";
  opportunity.cashCollectedUsd = recordedDepositCashUsd;
  opportunity.depositPaid = true;
  opportunity.scopeApproved = true;
  opportunity.paymentConfirmation = parsed.paymentConfirmation;
  opportunity.nextAction = "Oportunidad vendida. Crear delivery workspace desde Website handoff queue; no desplegar sin PR/App QA/aprobacion.";
  opportunity.updatedAt = now;
  persistRevenueWebsiteOpportunities();

  if (lead && lead.status !== "closed") {
    lead.status = "closed";
    lead.updatedAt = now;
    persistRevenueLeads();
  }

  const ledgerTag = `website-lead:${opportunity.sourceLeadId}`;
  const legacyLedgerTag = `[${ledgerTag}]`;
  const existingEntry = revenueLedger.find((entry) =>
    entry.notes.split("|").map((part) => part.trim()).some((part) => part === ledgerTag || part === legacyLedgerTag)
  );
  const entry = existingEntry || recordRevenueLedgerEntry({
    kind: opportunity.projectType === "bundle" ? "bundle_sale" : "website_sale",
    clientName: opportunity.businessName,
    amountUsd: opportunity.setupUsd,
    cashCollectedUsd: recordedDepositCashUsd,
    estimatedInternalCostUsd: opportunity.estimatedInternalCostUsd,
    notes: [
      ledgerTag,
      `website-opportunity:${opportunity.id}`,
      `outreach:${opportunity.sourceOutreachDraftId}`,
      opportunity.mockupUrl && `mockup:${opportunity.mockupUrl}`,
      opportunity.paymentConfirmation && `Payment confirmation:${opportunity.paymentConfirmation}`,
      parsed.notes,
    ].filter((item): item is string => Boolean(item && item.trim().length > 0)).join(" | ").slice(0, 1000),
  }).entry;

  return {
    status: "sold" as const,
    reason: "Website opportunity vendida con deposito/scope; delivery handoff queda habilitado.",
    opportunity,
    lead,
    draft,
    entry,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function buildRevenueWebsiteClosureQueue(): RevenueWebsiteClosureQueue {
  const closureOpportunities = revenueWebsiteOpportunities
    .filter((opportunity) =>
      opportunity.status !== "sold"
      && opportunity.status !== "delivered"
      && (!opportunity.depositPaid || !opportunity.scopeApproved)
    )
    .slice()
    .sort((a, b) => {
      const priorityScore = (item: RevenueWebsiteOpportunity) =>
        (item.depositPaid && !item.scopeApproved ? 3 : 0)
        + (item.scopeApproved && !item.depositPaid ? 2 : 0)
        + (!item.depositPaid && !item.scopeApproved ? 1 : 0);
      const scoreDelta = priorityScore(b) - priorityScore(a);
      return scoreDelta !== 0 ? scoreDelta : b.updatedAt.localeCompare(a.updatedAt);
    });

  const items = closureOpportunities.map((opportunity) => {
    const closureDraft = revenueOutreachDrafts.find((draft) => draft.id === opportunity.sourceOutreachDraftId);
    const needsDeposit = !opportunity.depositPaid;
    const needsScope = !opportunity.scopeApproved;
    const closureStage: RevenueWebsiteClosureQueue["items"][number]["closureStage"] =
      needsDeposit && needsScope
        ? "collect_deposit_and_scope"
        : needsDeposit
          ? "collect_deposit"
          : "approve_scope";
    const readiness = [
      needsDeposit ? "falta deposito" : "deposito registrado",
      needsScope ? "falta scope aprobado" : "scope aprobado",
      opportunity.paymentConfirmation ? "referencia de pago guardada" : "sin referencia de pago final",
      opportunity.mockupUrl ? "mockup listo" : "mockup pendiente",
      opportunity.sourceUrl ? "fuente publica enlazada" : "fuente publica pendiente",
    ];
    const nextAction = closureStage === "collect_deposit"
      ? "Cobrar deposito con referencia de pago; luego cerrar oportunidad para habilitar delivery."
      : closureStage === "approve_scope"
        ? "Confirmar scope aprobado por Robert/cliente; luego cerrar oportunidad para habilitar delivery."
        : "Confirmar scope y cobrar deposito con referencia antes de cerrar oportunidad.";
    const copyableCloseRequest = JSON.stringify({
      opportunityId: opportunity.id,
      depositPaid: opportunity.depositPaid,
      scopeApproved: opportunity.scopeApproved,
      cashCollectedUsd: opportunity.cashCollectedUsd,
      paymentConfirmation: opportunity.paymentConfirmation || "",
      notes: opportunity.scopeApproved
        ? "Robert confirmed scope and verified payment evidence before closing this website opportunity."
        : "Scope is still pending; Robert must explicitly approve scope before this request can close the website opportunity.",
    }, null, 2);

    return {
      id: opportunity.id,
      opportunityId: opportunity.id,
      leadId: opportunity.sourceLeadId,
      outreachDraftId: opportunity.sourceOutreachDraftId,
      sourceLeadId: opportunity.sourceLeadId,
      sourceOutreachDraftId: opportunity.sourceOutreachDraftId,
      businessName: opportunity.businessName,
      projectType: opportunity.projectType,
      status: opportunity.status,
      sourceUrl: opportunity.sourceUrl,
      mockupUrl: opportunity.mockupUrl,
      setupUsd: opportunity.setupUsd,
      requiredDepositUsd: opportunity.requiredDepositUsd,
      cashCollectedUsd: opportunity.cashCollectedUsd,
      monthlyRetainerUsd: opportunity.monthlyRetainerUsd,
      depositPaid: opportunity.depositPaid,
      scopeApproved: opportunity.scopeApproved,
      paymentConfirmation: opportunity.paymentConfirmation,
      closureStage,
      priority: opportunity.depositPaid || opportunity.scopeApproved ? "high" as const : "medium" as const,
      readiness,
      copyableClosurePacket: [
        `Website closure packet: ${opportunity.businessName}`,
        `Status: ${opportunity.status}`,
        `Package: ${revenueWebsiteOfferName(closureDraft?.websitePriceUsd || opportunity.setupUsd, opportunity.projectType === "bundle")}`,
        `Setup: $${opportunity.setupUsd.toLocaleString("en-US")}`,
        `Deposit required: $${opportunity.requiredDepositUsd.toLocaleString("en-US")}`,
        `Cash recorded: $${opportunity.cashCollectedUsd.toLocaleString("en-US")}`,
        `Retainer: $${opportunity.monthlyRetainerUsd.toLocaleString("en-US")}/mo`,
        `Mockup: ${opportunity.mockupUrl || "pending"}`,
        `Source: ${opportunity.sourceUrl || "pending"}`,
        "",
        "Close only after:",
        "- Scope is approved.",
        "- Deposit is actually collected.",
        "- Payment reference is recorded in Revenue Engine.",
        "",
        "Suggested close note:",
        `To start ${opportunity.businessName}, approve this scope and send the $${opportunity.requiredDepositUsd.toLocaleString("en-US")} deposit. I will not start delivery until payment is confirmed and the QA-gated delivery workspace is created.`,
        "",
        "Guardrail: no build, deploy, publish, or ledger sale until deposit evidence and scope are confirmed.",
      ].join("\n"),
      copyableCloseRequest,
      nextAction,
    };
  });

  return {
    status: items.length > 0 ? "ready" : "empty",
    readyCount: closureOpportunities.length,
    items,
    safety: {
      sendsOutreach: false,
      collectsPaymentAutomatically: false,
      createsWorkspace: false,
      requiresPaymentEvidence: true,
      requiresScopeApproval: true,
      blockedActions: ["auto-send outreach", "auto-charge client", "create delivery workspace", "deploy website", "record ledger sale without close"],
    },
    nextAction: closureOpportunities.length > 0
      ? "Cerrar scope/deposito de oportunidades website antes de delivery; usar evidencia de pago real."
      : "Crear oportunidades desde paquetes de venta y registrar replies/calls/depositos.",
  };
}

function buildRevenueWebsiteSalesPacketQueue(): RevenueWebsiteSalesPacketQueue {
  const packetStatuses: RevenueLead["status"][] = ["qualified", "mockup_ready", "outreach_ready", "proposal_sent"];
  const candidates = revenueLeads
    .filter((lead) => packetStatuses.includes(lead.status))
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const items: RevenueWebsiteSalesPacketQueue["items"] = [];
  const blocked: RevenueWebsiteSalesPacketQueue["blocked"] = [];

  for (const lead of candidates) {
    const qualification = qualifyRevenueLead(lead);
    const draft = findLatestRevenueOutreachDraftForLead(lead);
    const failedBlockingGate = draft?.qaGates.find((gate) => !gate.passed && gate.gate !== "approval");
    const sourceUrl = draft?.sourceUrl || "";
    const mockupUrl = draft?.mockupUrl || "";
    const blockedReasons = [
      ...qualification.missing,
      !draft && "falta propuesta/draft conectado",
      draft && draft.websitePriceUsd <= 0 && "falta alcance y precio de website",
      draft && !mockupUrl && "falta mockup preview",
      draft && !sourceUrl && "falta sourceUrl publico",
      draft && failedBlockingGate && failedBlockingGate.fix,
    ].filter((item): item is string => Boolean(item));

    if (!draft || blockedReasons.length > 0) {
      blocked.push({
        leadId: lead.id,
        businessName: lead.businessName,
        reason: blockedReasons.join("; ") || "Completar evidencia antes de vender.",
        nextAction: !draft
          ? "Correr Money Sprint o crear propuesta con mockup antes de preparar venta."
          : "Corregir el paquete, luego aprobar manualmente antes de contacto.",
      });
      continue;
    }

    const primaryOffer = revenueWebsiteOfferName(draft.websitePriceUsd, draft.automationPriceUsd > 0);
    const opportunityRequest = {
      leadId: lead.id,
      outreachDraftId: draft.id,
      projectType: primaryOffer.includes("Automation") ? "bundle" as const : "website" as const,
      notes: `Quoted from Revenue Engine website sales packet for ${lead.businessName}; do not close or build until deposit and scope evidence are recorded.`,
    };
    const readiness = [
      `Grade ${qualification.grade}/${qualification.score}`,
      "mockup preview listo",
      draft.status === "approved" ? "draft aprobado para contacto manual" : "draft necesita aprobacion humana antes de contacto",
      sourceUrl ? "fuente publica enlazada" : "fuente publica pendiente",
      draft.delivery.sendStatus === "sent" ? "contacto ya enviado" : "contacto no enviado",
    ];
    const closePlan = {
      requiredDepositUsd: draft.pricing.depositUsd,
      paymentEvidenceRequired: [
        "Stripe payment id, invoice id, Zelle/CashApp/bank reference, or receipt URL",
        "cashCollectedUsd must be at least the required deposit",
        "scopeApproved must be true before delivery workspace",
      ],
      scopeApprovalRequired: true as const,
      nextCloseAction: draft.status === "approved"
        ? `Contactar manualmente, pedir aprobacion de scope y cobrar deposito de $${draft.pricing.depositUsd.toLocaleString("en-US")} antes de delivery.`
        : "Aprobar draft con Robert antes de contacto; luego pedir scope y deposito.",
      copyableCloseRequest: JSON.stringify({
        opportunityId: "REPLACE_WITH_CREATED_WEBSITE_OPPORTUNITY_ID",
        depositPaid: true,
        scopeApproved: true,
        cashCollectedUsd: "REPLACE_WITH_VERIFIED_CASH_AMOUNT_AT_LEAST_DEPOSIT",
        paymentConfirmation: "REPLACE_WITH_STRIPE_INVOICE_BANK_OR_RECEIPT_REFERENCE",
        notes: `Close ${lead.businessName} only after manual deposit and scope approval are verified.`,
      }, null, 2),
      blockedActions: [
        "auto-send outreach",
        "mark sold without deposit payment evidence",
        "create delivery workspace before scope and deposit",
        "start build before verified payment",
        "deploy website before PR/App QA/Robert approval",
      ],
      copyableClosePacket: [
        `Website close packet: ${lead.businessName}`,
        `Status: ${draft.status === "approved" ? "approved_for_manual_contact" : "internal_only_pending_robert_approval"}`,
        draft.status === "approved"
          ? "Manual contact may proceed only through the approved queue."
          : "Internal only: do not send this close ask, request deposit, or contact the business until Robert approves the draft.",
        "",
        `Offer: ${primaryOffer}`,
        `Setup: $${draft.pricing.totalSetupUsd.toLocaleString("en-US")}`,
        `Required deposit: $${draft.pricing.depositUsd.toLocaleString("en-US")}`,
        `Monthly retainer: $${draft.pricing.monthlyRetainerUsd.toLocaleString("en-US")}/mo`,
        `Mockup: ${mockupUrl}`,
        `Public source: ${sourceUrl}`,
        "",
        "Close ask:",
        `To start ${lead.businessName}, approve this scope and send the $${draft.pricing.depositUsd.toLocaleString("en-US")} deposit. I will not start delivery until payment is confirmed and the QA-gated delivery workspace is created.`,
        "",
        "Payment evidence required:",
        "- Stripe payment id, invoice id, Zelle/CashApp/bank reference, or receipt URL",
        "- cashCollectedUsd must be at least the required deposit",
        "- scopeApproved must be true before delivery workspace",
        "",
        "Copyable close request:",
        JSON.stringify({
          opportunityId: "REPLACE_WITH_CREATED_WEBSITE_OPPORTUNITY_ID",
          depositPaid: true,
          scopeApproved: true,
          cashCollectedUsd: "REPLACE_WITH_VERIFIED_CASH_AMOUNT_AT_LEAST_DEPOSIT",
          paymentConfirmation: "REPLACE_WITH_STRIPE_INVOICE_BANK_OR_RECEIPT_REFERENCE",
          notes: `Close ${lead.businessName} only after manual deposit and scope approval are verified.`,
        }, null, 2),
        "",
        "Guardrails:",
        "- Do not mark sold without deposit payment evidence.",
        "- Do not create delivery workspace before scope and deposit.",
        "- Do not build, deploy, or publish before PR/App QA/Robert approval.",
      ].join("\n"),
    };
    const copyableSalesPacket = [
      `Negocio: ${lead.businessName}`,
      `Area/nicho: ${lead.area} / ${lead.niche}`,
      `Senal website: ${lead.websiteStatus}`,
      `Evidencia publica: ${lead.evidence}`,
      `Dolor: ${lead.painPoint}`,
      `Fuente: ${sourceUrl}`,
      `Mockup: ${mockupUrl}`,
      `Oferta: ${primaryOffer}`,
      `Setup: $${draft.pricing.totalSetupUsd.toLocaleString("en-US")} | Deposito: $${draft.pricing.depositUsd.toLocaleString("en-US")} | Retainer: $${draft.pricing.monthlyRetainerUsd.toLocaleString("en-US")}/mo`,
      `Close next action: ${closePlan.nextCloseAction}`,
      `Subject: ${draft.subject}`,
      "",
      "Copyable opportunity request:",
      JSON.stringify(opportunityRequest, null, 2),
      "",
      draft.body,
      "",
      "Guardrail: no enviar, publicar ni construir hasta que Robert apruebe contacto y haya deposito/scope para delivery.",
    ].join("\n");

    items.push({
      leadId: lead.id,
      outreachDraftId: draft.id,
      businessName: lead.businessName,
      area: lead.area,
      niche: lead.niche,
      websiteStatus: lead.websiteStatus,
      leadStatus: lead.status,
      grade: qualification.grade,
      score: qualification.score,
      sourceUrl,
      mockupUrl,
      contactChannel: lead.contactChannel,
      contactValue: lead.contactValue,
      draftStatus: draft.status,
      estimatedSetupUsd: draft.pricing.totalSetupUsd,
      depositUsd: draft.pricing.depositUsd,
      monthlyRetainerUsd: draft.pricing.monthlyRetainerUsd,
      primaryOffer,
      copyableSalesPacket,
      copyableOpportunityRequest: JSON.stringify(opportunityRequest, null, 2),
      closePlan,
      readiness,
      nextAction:
        draft.status === "approved"
          ? "Revisar paquete, abrir mockup/fuente y contactar manualmente desde la cola aprobada."
          : "Revisar paquete y aprobar el draft antes de cualquier contacto externo.",
    });
  }

  return {
    status: items.length > 0 ? "ready" : blocked.length > 0 ? "needs_context" : "empty",
    readyCount: items.length,
    blockedCount: blocked.length,
    items,
    blocked,
    safety: {
      sendsOutreach: false,
      publishesWebsite: false,
      requiresHumanApprovalToContact: true,
      requiresDepositBeforeBuild: true,
      blockedActions: ["auto-send outreach", "publish mockup", "deploy website", "start client build before deposit", "buy paid data"],
    },
    nextAction:
      items.length > 0
        ? "Usar paquetes listos para vender websites con mockup y oferta; contacto sigue manual/aprobado."
        : blocked.length > 0
          ? "Completar mockup, fuente publica o draft antes de vender websites."
          : "Importar candidatos publicos y correr Money Sprint para generar paquetes de venta.",
  };
}

function buildRevenueWebsiteDeliveryHandoffQueue(limit = 8): RevenueWebsiteDeliveryHandoffQueue {
  const existingWorkspaceLeadIds = new Set(
    revenueDeliveryWorkspaces
      .map((workspace) => workspace.input.sourceLeadId || "")
      .filter((sourceLeadId) => sourceLeadId.trim().length > 0),
  );
  const opportunities = revenueWebsiteOpportunities
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const items: RevenueWebsiteDeliveryHandoffQueue["items"] = [];
  const blocked: RevenueWebsiteDeliveryHandoffQueue["blocked"] = [];

  for (const opportunity of opportunities) {
    const lead = revenueLeads.find((item) => item.id === opportunity.sourceLeadId) || null;
    const draft = revenueOutreachDrafts.find((item) => item.id === opportunity.sourceOutreachDraftId) || null;
    if (opportunity.status === "delivered") continue;
    if (opportunity.status !== "sold" || !opportunity.depositPaid || !opportunity.scopeApproved) {
      blocked.push({
        leadId: opportunity.sourceLeadId,
        businessName: opportunity.businessName,
        reason: opportunity.status === "sold"
          ? "Falta confirmar deposito/scope en oportunidad vendida."
          : "Oportunidad website aun no esta vendida.",
        nextAction: "Cerrar oportunidad con deposito, scope y confirmacion de pago antes de delivery.",
      });
      continue;
    }
    if (existingWorkspaceLeadIds.has(opportunity.sourceLeadId)) continue;
    if (!lead || !draft) {
      blocked.push({
        leadId: opportunity.sourceLeadId,
        businessName: opportunity.businessName,
        reason: "Falta lead o draft conectado a la oportunidad vendida.",
        nextAction: "Revisar integridad antes de crear workspace de delivery.",
      });
      continue;
    }
    const paymentEvidenceBlocker = revenueWebsitePaymentEvidenceBlocker(opportunity, draft);
    if (paymentEvidenceBlocker) {
      blocked.push({
        leadId: opportunity.sourceLeadId,
        businessName: opportunity.businessName,
        reason: paymentEvidenceBlocker,
        nextAction: "Registrar referencia de pago verificable antes de crear delivery.",
      });
      continue;
    }
    const suggestedBranchName = `codex/client-${slugifyRevenueValue(opportunity.businessName)}-website`;
    const repoFullNamePattern = "owner/repo";
    const workspaceRequest = {
      leadId: opportunity.sourceLeadId,
      outreachDraftId: opportunity.sourceOutreachDraftId,
      websiteOpportunityId: opportunity.id,
      mockupUrl: opportunity.mockupUrl,
      repoFullName: "REPLACE_WITH_APPROVED_OWNER_REPO",
      branchName: suggestedBranchName,
      projectType: opportunity.projectType,
      depositPaid: true,
      scopeApproved: true,
      cashCollectedUsd: opportunity.cashCollectedUsd,
      publicDataVerified: true,
      visualQaPassed: false,
      technicalQaPassed: false,
      automationQaPassed: false,
      clientHandoffReady: false,
      launchTargetDays: 7,
      notes: `Create PR-first website delivery workspace for ${opportunity.businessName}; replace repoFullName with the approved GitHub owner/repo before submitting.`,
    };
    const copyableWorkspaceSetupPacket = [
      `Website delivery workspace setup: ${opportunity.businessName}`,
      `Opportunity: ${opportunity.id}`,
      `Lead: ${opportunity.sourceLeadId}`,
      `Outreach draft: ${opportunity.sourceOutreachDraftId}`,
      `Project type: ${opportunity.projectType}`,
      `Repo required: ${repoFullNamePattern}`,
      `Suggested branch: ${suggestedBranchName}`,
      `Mockup: ${opportunity.mockupUrl}`,
      `Public source: ${opportunity.sourceUrl}`,
      "",
      "Before creating workspace:",
      "- Enter a real GitHub owner/repo from the app inventory or the exact client repo Robert approved.",
      "- Keep the suggested branch or replace it with another codex/ branch.",
      "- Confirm deposit evidence and scope are already recorded on the sold opportunity.",
      "",
      "Copyable workspace request:",
      JSON.stringify(workspaceRequest, null, 2),
      "",
      "PR-first delivery rules:",
      "- Create a separate branch and pull request.",
      "- Do not merge to main directly.",
      "- Do not deploy or publish until second review, App QA, rollback note, and explicit Robert deploy approval are recorded.",
      "- Keep payment evidence and commercial details out of public PR text.",
    ].join("\n");
    items.push({
      opportunityId: opportunity.id,
      leadId: opportunity.sourceLeadId,
      outreachDraftId: opportunity.sourceOutreachDraftId,
      businessName: opportunity.businessName,
      leadStatus: lead.status,
      projectType: opportunity.projectType,
      estimatedSetupUsd: opportunity.setupUsd,
      requiredDepositUsd: opportunity.requiredDepositUsd,
      cashCollectedUsd: opportunity.cashCollectedUsd,
      monthlyRetainerUsd: opportunity.monthlyRetainerUsd,
      mockupUrl: opportunity.mockupUrl,
      sourceUrl: opportunity.sourceUrl,
      repoRequired: true,
      repoFullNamePattern,
      suggestedBranchName,
      copyableWorkspaceSetupPacket,
      copyableWorkspaceRequest: JSON.stringify(workspaceRequest, null, 2),
      nextAction: "Ingresar repo GitHub owner/repo y crear delivery workspace QA-gated; no desplegar sin PR, second review, App QA y aprobacion de Robert.",
    });
  }

  const visibleLimit = Math.max(0, Math.min(25, limit));
  const visibleItems = items.slice(0, visibleLimit);
  const visibleBlocked = blocked.slice(0, visibleLimit);

  return {
    status: items.length > 0 ? "ready" : blocked.length > 0 ? "needs_context" : "empty",
    readyCount: items.length,
    blockedCount: blocked.length,
    items: visibleItems,
    blocked: visibleBlocked,
    safety: {
      createsWorkspaceOnly: true,
      doesNotDeploy: true,
      requiresDepositAndScopeForBuild: true,
      blockedActions: ["deploy", "publish client preview", "send outreach", "charge card", "merge without PR"],
    },
    nextAction:
      items.length > 0
        ? "Convertir solo oportunidades website vendidas en delivery workspace QA-gated."
        : blocked.length > 0
          ? "Cerrar oportunidad con deposito/scope antes de crear delivery."
          : "Crear y cerrar oportunidades website desde paquetes de venta antes de delivery.",
  };
}

function revenueWebsiteWorkspaceSaleGate(workspace: RevenueDeliveryWorkspace) {
  if (workspace.input.projectType === "automation") {
    return { passed: true, blockers: [] as string[] };
  }
  const opportunity = workspace.input.sourceOpportunityId
    ? revenueWebsiteOpportunities.find((item) => item.id === workspace.input.sourceOpportunityId) || null
    : null;
  const draft = opportunity
    ? revenueOutreachDrafts.find((item) => item.id === opportunity.sourceOutreachDraftId) || null
    : null;
  const recordedDepositCashUsd = draft?.delivery.outcome === "deposit_collected" ? draft.delivery.outcomeCashCollectedUsd || 0 : 0;
  const paymentEvidenceBlocker = revenueWebsitePaymentEvidenceBlocker(opportunity, draft);
  const blockers = [
    !opportunity && "sourceOpportunityId vendido requerido",
    opportunity && !isClosedRevenueWebsiteOpportunity(opportunity) && "oportunidad website no vendida",
    opportunity && !opportunity.depositPaid && "deposito no marcado en oportunidad vendida",
    opportunity && !opportunity.scopeApproved && "scope no aprobado en oportunidad vendida",
    opportunity && workspace.input.sourceLeadId !== opportunity.sourceLeadId && "sourceLeadId no coincide con oportunidad vendida",
    opportunity && workspace.input.sourceOutreachDraftId !== opportunity.sourceOutreachDraftId && "sourceOutreachDraftId no coincide con oportunidad vendida",
    !draft && "draft de venta no encontrado",
    draft && draft.delivery.outcome !== "deposit_collected" && "deposito manual no registrado en draft",
    draft && recordedDepositCashUsd < (opportunity?.requiredDepositUsd || 0) && "deposito manual insuficiente",
    opportunity && recordedDepositCashUsd !== opportunity.cashCollectedUsd && "cash de oportunidad no coincide con deposito manual",
    paymentEvidenceBlocker,
  ].filter(Boolean) as string[];
  return { passed: blockers.length === 0, blockers };
}

export function getRevenueWebsiteWorkspaceSaleGate(workspaceId: string) {
  loadRevenueDeliveryWorkspaces();
  loadRevenueWebsiteOpportunities();
  loadRevenueOutreach();
  const workspace = revenueDeliveryWorkspaces.find((item) => item.id === workspaceId) || null;
  if (!workspace) {
    return {
      status: "not_found" as const,
      passed: false,
      blockers: ["workspace no encontrado"],
      reason: "Workspace no encontrado.",
    };
  }
  const gate = revenueWebsiteWorkspaceSaleGate(workspace);
  return {
    status: gate.passed ? "pass" as const : "blocked" as const,
    passed: gate.passed,
    blockers: gate.blockers,
    reason: gate.passed
      ? "Workspace respaldado por oportunidad vendida y deposito manual."
      : `Workspace website requiere oportunidad vendida y deposito manual: ${gate.blockers.join("; ")}.`,
  };
}

function buildRevenueWebsiteBuildHandoffQueue(limit = 5): RevenueWebsiteBuildHandoffQueue {
  const visibleLimit = Math.max(0, Math.min(25, limit));
  const openWorkspaces = revenueDeliveryWorkspaces
    .filter((workspace) =>
      (workspace.input.projectType === "website" || workspace.input.projectType === "bundle")
      && revenueWebsiteWorkspaceSaleGate(workspace).passed
      && workspace.input.publicDataVerified
      && workspace.projectPlan.decision.status === "ready_to_build"
      && workspace.codexBuildHandoff.status === "needs_pr"
    )
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const items: RevenueWebsiteBuildHandoffQueue["items"] = openWorkspaces.slice(0, visibleLimit).map((workspace) => {
    const copyableGithubHandoffRequest = buildRevenueGithubHandoffRequest(workspace);
    const copyableReleaseGateRequest = buildRevenueReleaseGateRequest(workspace);
    return {
      workspaceId: workspace.id,
      clientName: workspace.input.clientName,
      projectType: workspace.input.projectType === "bundle" ? "bundle" : "website",
      packageName: workspace.input.packageName,
      setupUsd: workspace.input.setupUsd,
      repoFullName: workspace.codexBuildHandoff.repoFullName,
      branchName: workspace.codexBuildHandoff.branchName,
      githubIssueUrl: workspace.codexBuildHandoff.githubIssueUrl,
      prUrl: workspace.codexBuildHandoff.prUrl,
      codexBrief: workspace.codexBuildHandoff.codexBrief,
      publicBuildBrief: workspace.codexBuildHandoff.publicBuildBrief,
      copyableGithubHandoffRequest,
      copyableReleaseGateRequest,
      buildPack: workspace.codexBuildHandoff.buildPack,
      missing: workspace.codexBuildHandoff.missing,
      blockedActions: workspace.codexBuildHandoff.blockedActions,
      nextAction: workspace.codexBuildHandoff.nextAction,
    };
  });

  return {
    status: openWorkspaces.length > 0 ? "ready" : "empty",
    openCount: openWorkspaces.length,
    items,
    safety: {
      createsPrOnly: true,
      deploys: false,
      requiresSecondReviewAndAppQa: true,
      blockedActions: ["direct main commit", "merge without PR", "deploy without Robert approval", "skip App QA", "publish unapproved client preview"],
    },
    nextAction: items.length > 0
      ? `Abrir PR-first build para ${items[0].clientName} desde workspace ${items[0].workspaceId}.`
      : "Sin builds pagados esperando PR-first; seguir buscando, vendiendo o cobrando.",
  };
}

function buildRevenueBusinessScoutQueue(): RevenueBusinessScoutQueue {
  const latestMission = revenueScoutingMissions.at(-1);
  const area = latestMission?.mission.area || "Miami";
  const niche = latestMission?.mission.niche || "restaurants";
  const offerFocus = latestMission?.mission.offerFocus || "both";
  const requestedResearchTarget = latestMission?.mission.targetLeadCount || 25;
  const dailyResearchTarget = Math.min(Math.max(requestedResearchTarget, 10), 500);
  const input: RevenueMoneySprintInput = {
    area,
    niche,
    offerFocus,
    dailyResearchTarget,
    dailyQualifiedLeadLimit: Math.min(Math.max(dailyResearchTarget, 5), 100),
    dailyMockupLimit: 5,
    dailyContactLimit: 10,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeads: [],
    seedLeadBatchText: "",
  };
  const tasks = buildRevenueScoutQueue(input);
  const workPack = buildRevenueScoutWorkPack(input, tasks);

  return {
    status: tasks.length > 0 ? "ready" : "needs_context",
    source: latestMission ? "latest_scouting_mission" : "default_market",
    area,
    niche,
    offerFocus,
    dailyResearchTarget,
    tasks,
    workPack,
    nextAction: "Start daily scout sprint para crear slots por subagente; despues pegar evidencia publica y guardar candidatos verificados.",
    safety: {
      researchesPublicSources: true,
      persistsCandidates: false,
      sendsOutreach: false,
      spendsMoney: false,
      blockedActions: workPack.safety.blockedActions,
    },
  };
}

function buildRevenueScoutSlotTemplate(input: {
  slotId: string;
  area: string;
  niche: string;
  sourceTaskId: string;
  ownerAgent: string;
  sourceUrl: string;
}) {
  return [
    `Business: REPLACE_REAL_BUSINESS_NAME_${input.slotId}`,
    `Area: ${input.area}`,
    `Niche: ${input.niche}`,
    "Website: no website | weak website | unknown",
    "Contact: REPLACE_PUBLIC_CONTACT_PATH",
    "Email: owner@example.com",
    `Source: ${input.sourceUrl}`,
    "Evidence: Public listing/profile reviewed by "
      + `${input.ownerAgent}; replace with specific no/weak website signal, recent activity and contact path.`,
    "Pain: Needs conversion-focused website, inquiry capture and follow-up.",
    "Offer: 3500",
    "Contact name: Owner",
    `Summary: REPLACE_REAL_BUSINESS_NAME_${input.slotId} is a real public lead from ${input.sourceTaskId}.`,
  ].join("\n");
}

export function runRevenueDailyScoutSprint(input: z.input<typeof revenueDailyScoutSprintSchema> = {}) {
  loadRevenueScoutingMissions();
  loadRevenueDailyScoutSprints();
  const parsed = revenueDailyScoutSprintSchema.parse(input);
  const latestMission = revenueScoutingMissions.at(-1);
  const hasManualOverride = Boolean(parsed.area || parsed.niche || parsed.offerFocus || parsed.targetLeadCount);
  const area = parsed.area || latestMission?.mission.area || "Miami";
  const niche = parsed.niche || latestMission?.mission.niche || "restaurants";
  const offerFocus = parsed.offerFocus || latestMission?.mission.offerFocus || "both";
  const requestedTarget = parsed.targetLeadCount || latestMission?.mission.targetLeadCount || 10;
  const preliminaryInput: RevenueMoneySprintInput = {
    area,
    niche,
    offerFocus,
    dailyResearchTarget: Math.max(requestedTarget, 10),
    dailyQualifiedLeadLimit: Math.min(Math.max(requestedTarget, 5), 10),
    dailyMockupLimit: 5,
    dailyContactLimit: 10,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeads: [],
    seedLeadBatchText: "",
  };
  const scoutQueue = buildRevenueScoutQueue(preliminaryInput).slice(0, parsed.maxTasks);
  const targetRows = Math.min(Math.max(requestedTarget, 5), scoutQueue.length * parsed.resultSlotsPerTask, 10);
  const moneySprintInput: RevenueMoneySprintInput = {
    area,
    niche,
    offerFocus,
    dailyResearchTarget: Math.max(targetRows, 10),
    dailyQualifiedLeadLimit: Math.max(targetRows, 5),
    dailyMockupLimit: 5,
    dailyContactLimit: 10,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeads: [],
    seedLeadBatchText: "",
  };
  const workPack = buildRevenueScoutWorkPack(moneySprintInput, scoutQueue);
  const qualityGate = [
    ...workPack.qualityGate,
    "Cada slot debe corresponder a un negocio real; no usar placeholders como evidencia final.",
    "No se registra candidato importable hasta que publicEvidenceVerified, approvalToImport y approvedByRobert sean true.",
  ];
  const tasks = scoutQueue.map((task) => {
    const resultSlots = Array.from({ length: parsed.resultSlotsPerTask }, (_, slotIndex) => {
      const slotId = `${task.id}-slot-${String(slotIndex + 1).padStart(2, "0")}`;
      const evidenceTemplate = buildRevenueScoutSlotTemplate({
        slotId,
        area,
        niche,
        sourceTaskId: task.id,
        ownerAgent: task.ownerAgent,
        sourceUrl: task.url,
      });
      return {
        slotId,
        status: "open" as const,
        evidenceTemplate,
        copyableEvidenceBlock: evidenceTemplate,
        acceptanceCriteria: qualityGate,
      };
    });

    return {
      taskId: task.id,
      ownerAgent: task.ownerAgent,
      source: task.source,
      query: task.query,
      url: task.url,
      targetRows: resultSlots.length,
      status: "open" as const,
      resultSlots,
      allowedAction: task.allowedAction,
      blockedActions: task.blockedActions,
    };
  });
  const agentBriefs = Array.from(new Set(tasks.map((task) => task.ownerAgent))).map((ownerAgent) => {
    const ownedTasks = tasks.filter((task) => task.ownerAgent === ownerAgent);
    return {
      ownerAgent,
      taskIds: ownedTasks.map((task) => task.taskId),
      copyableBrief: [
        `Daily scout sprint for ${ownerAgent}`,
        `Area: ${area}`,
        `Niche: ${niche}`,
        `Offer focus: ${offerFocus}`,
        "",
        "Open only these public research tasks:",
        ...ownedTasks.map((task) => `- ${task.taskId}: ${task.query} (${task.url})`),
        "",
        "Fill each slot with real public evidence using the template fields.",
        "Do not contact businesses, buy data, scrape at scale, publish previews or invent evidence.",
      ].join("\n"),
    };
  });
  const now = new Date().toISOString();
  const safetyBlockedActions = Array.from(new Set([
    ...tasks.flatMap((task) => task.blockedActions),
    "send outreach",
    "persist lead before verified public evidence",
    "run paid data",
    "deploy website",
  ]));
  const sprint: RevenueDailyScoutSprint = {
    id: `daily-scout-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    status: "open",
    source: hasManualOverride ? "manual_override" : latestMission ? "latest_scouting_mission" : "default_market",
    area,
    niche,
    offerFocus,
    targetRows,
    tasks,
    agentBriefs,
    copyableBatchTemplate: workPack.copyableBatchTemplate,
    copyableOperatorBrief: [
      "Revenue Engine daily scout sprint",
      "",
      `Sprint: ${now.slice(0, 10)} ${area} ${niche}`,
      `Target rows: ${targetRows}`,
      `Tasks: ${tasks.length}`,
      "",
      "Subagent handoff:",
      ...agentBriefs.map((brief) => `- ${brief.ownerAgent}: ${brief.taskIds.join(", ")}`),
      "",
      "After research:",
      "1. Paste completed evidence blocks into Public scout evidence.",
      "2. Mark public evidence verified only after checking URLs.",
      "3. Approve import, then run Money Sprint from verified candidates.",
    ].join("\n"),
    qualityGate,
    nextAction: "Asignar briefs a subagentes, llenar slots con evidencia publica real y pegar los bloques completos en Public scout evidence.",
    safety: {
      researchesPublicSources: true,
      persistsScoutRun: true,
      persistsCandidates: false,
      persistsLeads: false,
      sendsOutreach: false,
      spendsMoney: false,
      deploys: false,
      requiresRobertApprovalToContact: true,
      blockedActions: safetyBlockedActions,
    },
  };

  revenueDailyScoutSprints.push(sprint);
  persistRevenueDailyScoutSprints();

  return {
    status: "started" as const,
    sprint,
    safety: sprint.safety,
    nextAction: sprint.nextAction,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function buildRevenueScoutDispatchSummary(sprint: RevenueDailyScoutSprint) {
  const executionMode = "manual_evidence_required" as const;
  const blockedUntil = "public evidence is pasted and verified, or a verified public-search scout connector is added";
  const requiredExecutionBridge = "bounded public-search/browser scout that opens generated URLs, extracts candidate fields, records source evidence, and stores candidates as needs_review before Robert approval";
  const connectorIntakeEndpoint = "/api/revenue-engine/public-scout-connector-intake";
  const connectorRunId = `${sprint.id}-connector-run`;
  const agentAssignments = sprint.agentBriefs.map((brief) => {
    const tasks = sprint.tasks.filter((task) => brief.taskIds.includes(task.taskId));
    return {
      ownerAgent: brief.ownerAgent,
      taskIds: brief.taskIds,
      taskCount: tasks.length,
      slotCount: tasks.reduce((total, task) => total + task.resultSlots.length, 0),
      searchUrls: tasks.map((task) => task.url),
      copyableBrief: brief.copyableBrief,
    };
  });
  const connectorIntakePayloadTemplate = {
    area: sprint.area,
    niche: sprint.niche,
    missionId: sprint.id,
    sourceTaskId: sprint.tasks[0]?.taskId || "daily-scout-task",
    connectorName: "browser-public-scout",
    connectorRunId,
    results: [
      {
        businessName: "REPLACE business name",
        area: sprint.area,
        niche: sprint.niche,
        websiteStatus: "no_website",
        contactChannel: "instagram",
        contactValue: "@REPLACE_PUBLIC_HANDLE_OR_CONTACT",
        recipientEmail: "",
        sourceUrl: "https://REPLACE_PUBLIC_SOURCE_URL",
        evidence: "REPLACE with 12+ words from public listing/profile showing no or weak website, recent activity and a contact path.",
        painPoint: "REPLACE with specific website, lead capture, booking, menu or follow-up problem.",
        estimatedOfferUsd: 3500,
        contactName: "Owner",
        businessSummary: "REPLACE one sentence public business summary.",
      },
    ],
    notes: "Verified public-search scout connector intake; Robert review required before import.",
  };
  const connectorWorkOrders = sprint.tasks.map((task) => {
    const payload = {
      ...connectorIntakePayloadTemplate,
      sourceTaskId: task.taskId,
      connectorRunId: `${connectorRunId}-${task.taskId}`,
      results: task.resultSlots.map((slot) => ({
        businessName: "REPLACE business name",
        area: sprint.area,
        niche: sprint.niche,
        websiteStatus: "no_website" as const,
        contactChannel: "instagram" as const,
        contactValue: "@REPLACE_PUBLIC_HANDLE_OR_CONTACT",
        recipientEmail: "",
        sourceUrl: "https://REPLACE_PUBLIC_SOURCE_URL",
        evidence: `REPLACE with 12+ words from public source for ${slot.slotId}; include no/weak website signal, recent activity and contact path.`,
        painPoint: "REPLACE with specific website, lead capture, booking, menu or follow-up problem.",
        estimatedOfferUsd: 3500,
        contactName: "Owner",
        businessSummary: "REPLACE one sentence public business summary.",
      })),
      notes: `Verified public-search scout connector intake for ${task.taskId}; Robert review required before import.`,
    };
    const copyableSubagentCommand = [
      "Revenue Engine public business scout subagent command",
      "",
      `Task id: ${task.taskId}`,
      `Owner agent: ${task.ownerAgent}`,
      `Market: ${sprint.area} / ${sprint.niche}`,
      `Offer focus: ${sprint.offerFocus}`,
      `Search query: ${task.query}`,
      `Search URL: ${task.url}`,
      `Target rows: ${task.targetRows}`,
      "",
      "Your job:",
      "- Open the search URL and inspect public business/listing/profile pages only.",
      "- Find real local businesses that appear to have no website or a weak website.",
      "- Capture evidence for each result slot using the JSON payload below.",
      "- Prefer public source pages with recent activity and a clear public contact path.",
      "",
      "Do not:",
      "- Contact businesses.",
      "- Buy data, use paid enrichment, scrape at scale, create accounts, send forms or messages.",
      "- Invent or fabricate businesses, sources, contact paths, evidence, screenshots, claims or URLs.",
      "- Mark publicEvidenceVerified, approvalToImport or approvedByRobert.",
      "- Create leads, create outreach, build websites, open PRs, publish previews or deploy.",
      "",
      "Return format:",
      "1. A short note listing which public pages you inspected.",
      "2. The completed JSON payload only, ready for POST /api/revenue-engine/public-scout-connector-intake.",
      "3. If evidence is weak, leave that result with REPLACE placeholders and explain why in notes.",
      "",
      "Acceptance criteria:",
      "- Every completed result has businessName, sourceUrl, 12+ word evidence, painPoint and contact path.",
      "- Every completed sourceUrl is public and tied to the named business.",
      "- No placeholders remain in completed result rows.",
      "- Results are review-only and must still be verified by Robert before import.",
      "",
      "Payload:",
      JSON.stringify(payload, null, 2),
    ].join("\n");
    return {
      taskId: task.taskId,
      ownerAgent: task.ownerAgent,
      sourceAgent: task.ownerAgent,
      source: task.source,
      query: task.query,
      sourceQuery: task.query,
      searchUrl: task.url,
      targetRows: task.targetRows,
      resultSlotIds: task.resultSlots.map((slot) => slot.slotId),
      endpoint: connectorIntakeEndpoint,
      payload,
      copyableSubagentCommand,
      copyableWorkOrder: [
        `Revenue scout connector work order: ${task.taskId}`,
        `Owner agent: ${task.ownerAgent}`,
        `Source agent: ${task.ownerAgent}`,
        `Source query: ${task.query}`,
        `Search URL: ${task.url}`,
        `Target rows: ${task.targetRows}`,
        "",
        "Open the search URL, inspect public business/listing/profile pages, and return only real public evidence.",
        "Do not contact businesses, buy data, scrape at scale, create leads, mark approvals, publish previews or deploy websites.",
        `POST endpoint: ${connectorIntakeEndpoint}`,
        "",
        "Copyable subagent command:",
        copyableSubagentCommand,
        "",
        "Payload:",
        JSON.stringify(payload, null, 2),
      ].join("\n"),
    };
  });
  const copyableConnectorIntakeBrief = [
    "Revenue Engine verified scout connector intake",
    "",
    `Endpoint: POST ${connectorIntakeEndpoint}`,
    `Execution mode: verified_connector_review_only`,
    `Sprint: ${sprint.id}`,
    "",
    "Required result fields:",
    "- businessName, sourceUrl, evidence, painPoint",
    "- websiteStatus: no_website | weak_website | has_website | unknown",
    "- contactChannel: email | phone | instagram | contact_form | unknown",
    "- recipientEmail can be empty for manual channels.",
    "",
    "Safety:",
    "- Results are recorded as needs_review only.",
    "- Do not set publicEvidenceVerified, approvalToImport or approvedByRobert.",
    "- Do not contact businesses, buy data, create leads, publish previews or deploy websites.",
    "- Use connector work orders when available so each returned batch is tied to one generated scout task.",
    "",
    "JSON payload template:",
    JSON.stringify(connectorIntakePayloadTemplate, null, 2),
  ].join("\n");
  const copyableDispatchBrief = [
    "Revenue Engine scout dispatch",
    "",
    `Sprint: ${sprint.id}`,
    `Market: ${sprint.area} / ${sprint.niche}`,
    `Offer focus: ${sprint.offerFocus}`,
    `Target public evidence rows: ${sprint.targetRows}`,
    "",
    "Assignments:",
    ...agentAssignments.map((agent) => `- ${agent.ownerAgent}: ${agent.taskCount} tasks / ${agent.slotCount} evidence slots`),
    "",
    "Rules:",
    `- Execution mode: ${executionMode}. This dispatch does not autonomously browse or prove businesses by itself.`,
    `- Blocked until: ${blockedUntil}.`,
    `- Required bridge: ${requiredExecutionBridge}.`,
    "- Connector work orders are task-bound payloads for subagents/browser connectors; they still record results as needs_review only.",
    "- Use only public search/profile/listing pages.",
    "- Return real evidence blocks; do not invent businesses.",
    `- Preferred structured return path: POST ${connectorIntakeEndpoint} with the connector intake JSON template below.`,
    "- Do not contact businesses, buy data, scrape at scale, send outreach, publish previews or deploy websites.",
    "- Paste completed blocks into Public scout evidence and import only after Robert verifies public evidence.",
    "",
    copyableConnectorIntakeBrief,
  ].join("\n");

  return {
    mode: "manual_subagent_dispatch" as const,
    executionMode,
    blockedUntil,
    requiredExecutionBridge,
    readyToAssign: agentAssignments.length > 0,
    agentCount: agentAssignments.length,
    taskCount: sprint.tasks.length,
    slotCount: sprint.tasks.reduce((total, task) => total + task.resultSlots.length, 0),
    agentAssignments,
    connectorIntake: {
      endpoint: connectorIntakeEndpoint,
      executionMode: "verified_connector_review_only" as const,
      maxResults: 20,
      approvalLocked: true,
      copyablePayloadTemplate: JSON.stringify(connectorIntakePayloadTemplate, null, 2),
      copyableBrief: copyableConnectorIntakeBrief,
      workOrders: connectorWorkOrders,
      copyableWorkOrders: connectorWorkOrders.map((order) => order.copyableWorkOrder).join("\n\n---\n\n"),
      copyableSubagentCommands: connectorWorkOrders.map((order) => order.copyableSubagentCommand).join("\n\n---\n\n"),
    },
    copyableDispatchBrief,
    safety: sprint.safety,
  };
}

export function runRevenueScoutDispatch(input: z.input<typeof revenueDailyScoutSprintSchema> = {}) {
  const result = runRevenueDailyScoutSprint({
    ...input,
    notes: input.notes || "Scout dispatch created from Revenue Engine UI.",
  });
  const dispatch = buildRevenueScoutDispatchSummary(result.sprint);
  const dispatchedAt = new Date().toISOString();
  result.sprint.dispatchMode = dispatch.mode;
  result.sprint.executionMode = dispatch.executionMode;
  result.sprint.blockedUntil = dispatch.blockedUntil;
  result.sprint.requiredExecutionBridge = dispatch.requiredExecutionBridge;
  result.sprint.dispatchedAt = dispatchedAt;
  result.sprint.dispatchSummary = `${dispatch.agentCount} agents / ${dispatch.taskCount} tasks / ${dispatch.slotCount} public evidence slots`;
  result.sprint.updatedAt = dispatchedAt;
  const sprintIndex = revenueDailyScoutSprints.findIndex((sprint) => sprint.id === result.sprint.id);
  if (sprintIndex >= 0) {
    revenueDailyScoutSprints.splice(sprintIndex, 1, result.sprint);
    persistRevenueDailyScoutSprints();
  }

  return {
    status: "dispatch_ready" as const,
    reason: "Scout dispatch listo: asigna briefs a subagentes y pega evidencia publica verificada antes de crear candidatos.",
    sprint: result.sprint,
    dispatch,
    safety: result.safety,
    nextAction: "Copiar dispatch/briefs, completar slots con evidencia publica real y luego importar candidatos verificados.",
    snapshot: getRevenueEngineSnapshot(),
  };
}

function recordRevenueDailyScoutSprintEvidenceProgress(input: {
  missionId?: string;
  sourceTaskId?: string;
  candidateIds?: string[];
  area?: string;
  niche?: string;
  filledCount: number;
  rejectedCount: number;
}) {
  loadRevenueDailyScoutSprints();
  const sourceTaskId = (input.sourceTaskId || "").trim();
  const missionId = (input.missionId || "").trim();
  const matchingSprint = revenueDailyScoutSprints
    .slice()
    .reverse()
    .find((sprint) =>
      (missionId && sprint.id === missionId)
      || (sourceTaskId && sprint.id === sourceTaskId)
      || (
        sourceTaskId
        && sprint.tasks.some((task) => task.taskId === sourceTaskId)
        && (!input.area || sprint.area.toLowerCase() === input.area.toLowerCase())
        && (!input.niche || sprint.niche.toLowerCase() === input.niche.toLowerCase())
      )
    ) || null;

  if (!matchingSprint) return null;

  const targetTask = matchingSprint.tasks.find((task) => task.taskId === sourceTaskId)
    || matchingSprint.tasks.find((task) => task.resultSlots.some((slot) => slot.status === "open"))
    || matchingSprint.tasks[0]
    || null;
  if (!targetTask) return null;

  const existingFilledSlotKeys = new Set(
    matchingSprint.tasks
      .flatMap((task) => task.resultSlots)
      .filter((slot) => slot.status === "filled")
      .map((slot) => {
        const match = slot.copyableEvidenceBlock.match(/Candidate:\s*([^\n]+)/i);
        return match?.[1]?.trim() || "";
      })
      .filter(Boolean),
  );
  const newCandidateIds = (input.candidateIds || []).filter((candidateId) => !existingFilledSlotKeys.has(candidateId));
  const filledSlotsBefore = matchingSprint.tasks.flatMap((task) => task.resultSlots).filter((slot) => slot.status === "filled").length;
  let remainingFilled = Math.max(0, input.candidateIds ? newCandidateIds.length : input.filledCount);
  let remainingRejected = Math.max(0, input.rejectedCount);
  for (const slot of targetTask.resultSlots) {
    if (slot.status !== "open") continue;
    if (remainingFilled > 0) {
      const candidateId = newCandidateIds.shift() || "";
      slot.status = "filled";
      if (candidateId) {
        slot.copyableEvidenceBlock = `${slot.copyableEvidenceBlock}\nCandidate: ${candidateId}`;
      }
      remainingFilled -= 1;
      continue;
    }
    if (remainingRejected > 0) {
      slot.status = "rejected";
      remainingRejected -= 1;
    }
  }

  const taskFilled = targetTask.resultSlots.filter((slot) => slot.status === "filled").length;
  const taskOpen = targetTask.resultSlots.some((slot) => slot.status === "open");
  targetTask.status = taskFilled > 0 ? "submitted" : taskOpen ? "open" : "blocked";

  const filledSlots = matchingSprint.tasks.flatMap((task) => task.resultSlots).filter((slot) => slot.status === "filled").length;
  const rejectedSlots = matchingSprint.tasks.flatMap((task) => task.resultSlots).filter((slot) => slot.status === "rejected").length;
  const openSlots = matchingSprint.tasks.flatMap((task) => task.resultSlots).filter((slot) => slot.status === "open").length;
  matchingSprint.status = filledSlots >= matchingSprint.targetRows
    ? "completed"
    : openSlots === 0 && filledSlots === 0
      ? "blocked"
      : "open";
  matchingSprint.updatedAt = new Date().toISOString();
  matchingSprint.nextAction = matchingSprint.status === "completed"
    ? "Sprint completo: correr Money Sprint con candidatos verificados y revisar paquetes de venta."
    : filledSlots > 0
      ? `Sprint en progreso: ${filledSlots}/${matchingSprint.targetRows} slots verificados; seguir llenando evidencia publica.`
      : rejectedSlots > 0
        ? "Sprint necesita mas evidencia publica real; reemplazar slots rechazados antes de Money Sprint."
        : matchingSprint.nextAction;

  persistRevenueDailyScoutSprints();

  return {
    sprintId: matchingSprint.id,
    taskId: targetTask.taskId,
    status: matchingSprint.status,
    filledSlots,
    newlyFilledSlots: filledSlots - filledSlotsBefore,
    rejectedSlots,
    openSlots,
    targetRows: matchingSprint.targetRows,
    nextAction: matchingSprint.nextAction,
  };
}

function buildRevenueDailyMoneyCommand(input: {
  businessScoutQueue: RevenueBusinessScoutQueue;
  publicLeadImportQueue: RevenuePublicLeadImportQueue;
  websiteSalesPacketQueue: RevenueWebsiteSalesPacketQueue;
  manualOutreachQueue: RevenueManualOutreachQueue;
  websiteDeliveryHandoffQueue: RevenueWebsiteDeliveryHandoffQueue;
  websiteBuildHandoffQueue: RevenueWebsiteBuildHandoffQueue;
  websiteClosureQueue: RevenueWebsiteClosureQueue;
  cashCollectedUsd: number;
  profitGuard: ReturnType<typeof buildRevenueProfitGuard>;
}): RevenueDailyMoneyCommand {
  const buildHandoffsOpen = input.websiteBuildHandoffQueue.openCount;
  const funnel = {
    researchTarget: input.businessScoutQueue.dailyResearchTarget,
    candidatesReady: input.publicLeadImportQueue.readyCount,
    salesPacketsReady: input.websiteSalesPacketQueue.readyCount,
    manualContactsReady: input.manualOutreachQueue.readyCount,
    websiteClosuresPending: input.websiteClosureQueue.readyCount,
    deliveryHandoffsReady: input.websiteDeliveryHandoffQueue.readyCount,
    buildHandoffsOpen,
    cashCollectedUsd: input.cashCollectedUsd,
  };
  const status: RevenueDailyMoneyCommand["status"] =
    input.profitGuard.status === "pause_spend"
      ? "blocked"
      : buildHandoffsOpen > 0
        ? "build"
        : input.websiteDeliveryHandoffQueue.readyCount > 0 || input.websiteClosureQueue.readyCount > 0
          ? "collect"
          : input.manualOutreachQueue.readyCount > 0
            ? "contact"
            : input.websiteSalesPacketQueue.readyCount > 0
              ? "sell"
              : input.publicLeadImportQueue.readyCount > 0
                ? "sprint"
                : "search";
  const primaryActionByStatus: Record<RevenueDailyMoneyCommand["status"], string> = {
    blocked: "Pausar gasto y resolver Profit Guard antes de avanzar.",
    collect: "Cerrar deposits/scope y convertir leads vendidos en delivery workspace solo con gates confirmados.",
    build: "Crear o completar handoff GitHub PR-first para los websites vendidos.",
    contact: "Contactar manualmente los drafts aprobados y registrar replies/calls/depositos.",
    sell: "Revisar paquetes de venta con mockup y aprobar contacto manual.",
    sprint: "Correr Money Sprint con candidatos publicos verificados para crear mockups y drafts.",
    search: "Buscar negocios publicos hoy y guardar candidatos verificados.",
  };
  const target = status === "search"
    ? `${funnel.researchTarget} negocios publicos investigados`
    : status === "sprint"
      ? `${funnel.candidatesReady} candidatos listos para Money Sprint`
      : status === "sell"
        ? `${funnel.salesPacketsReady} paquetes listos para vender`
        : status === "contact"
          ? `${funnel.manualContactsReady} contactos manuales aprobados`
          : status === "collect"
            ? `${funnel.websiteClosuresPending} scope/depositos y ${funnel.deliveryHandoffsReady} handoffs listos`
            : status === "build"
              ? `${funnel.buildHandoffsOpen} builds esperando PR-first`
              : "0 gasto hasta resolver bloqueo";
  const baseSteps: RevenueDailyMoneyCommand["steps"] = [
    {
      id: "search",
      label: "Buscar negocios",
      metric: `${funnel.researchTarget}/dia target`,
      nextAction: input.businessScoutQueue.nextAction,
      status: status === "search" ? "ready" : "waiting",
    },
    {
      id: "import",
      label: "Importar candidatos",
      metric: `${funnel.candidatesReady} verificados`,
      nextAction: input.publicLeadImportQueue.nextAction,
      status: funnel.candidatesReady > 0 ? "ready" : "waiting",
    },
    {
      id: "sell",
      label: "Vender paquetes",
      metric: `${funnel.salesPacketsReady} paquetes`,
      nextAction: input.websiteSalesPacketQueue.nextAction,
      status: funnel.salesPacketsReady > 0 || funnel.manualContactsReady > 0 ? "ready" : "waiting",
    },
    {
      id: "collect",
      label: "Cobrar y construir",
      metric: `${funnel.websiteClosuresPending} scope / ${funnel.deliveryHandoffsReady} delivery / ${funnel.buildHandoffsOpen} PR`,
      nextAction: funnel.deliveryHandoffsReady > 0
        ? input.websiteDeliveryHandoffQueue.nextAction
        : funnel.websiteClosuresPending > 0
          ? input.websiteClosureQueue.nextAction
          : input.websiteBuildHandoffQueue.nextAction,
      status: funnel.websiteClosuresPending > 0 || funnel.deliveryHandoffsReady > 0 || funnel.buildHandoffsOpen > 0 ? "ready" : "waiting",
    },
  ];
  const steps: RevenueDailyMoneyCommand["steps"] = status === "blocked"
    ? baseSteps.map((step) => ({ ...step, status: "blocked" as const }))
    : baseSteps;
  const searchDispatchRequest = {
    area: input.businessScoutQueue.area,
    niche: input.businessScoutQueue.niche,
    offerFocus: input.businessScoutQueue.offerFocus,
    targetLeadCount: input.businessScoutQueue.dailyResearchTarget,
    maxTasks: Math.min(Math.max(input.businessScoutQueue.tasks.length, 1), 5),
    resultSlotsPerTask: 2,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    notes: "Daily money command scout dispatch: public research only; connector results stay needs_review until Robert verifies and approves import.",
  };
  const topPublicLeadImportItem = input.publicLeadImportQueue.items[0] || null;
  const topWebsiteSalesPacket = input.websiteSalesPacketQueue.items[0] || null;
  const topManualOutreach = input.manualOutreachQueue.items[0] || null;
  const topWebsiteClosure = input.websiteClosureQueue.items[0] || null;
  const topDeliveryHandoff = input.websiteDeliveryHandoffQueue.items[0] || null;
  const topBuildHandoff = input.websiteBuildHandoffQueue.items[0] || null;
  const runPacketByStatus: Record<RevenueDailyMoneyCommand["status"], Omit<RevenueDailyMoneyCommand["runPacket"], "status" | "copyableRunPacket">> = {
    search: {
      apiAction: "/api/revenue-engine/scout-dispatch",
      input: "area, niche, offerFocus, targetLeadCount, maxTasks, resultSlotsPerTask, maxPaidDataSpendUsd=0",
      output: "Subagent briefs plus connector intake JSON for real public businesses.",
      gate: "Only public sources; connector rows stay needs_review until Robert verifies evidence.",
      copyableApiRequest: JSON.stringify(searchDispatchRequest, null, 2),
    },
    sprint: {
      apiAction: "/api/revenue-engine/money-sprint/public-candidates",
      input: topPublicLeadImportItem
        ? `candidateIds from verified publicLeadImportQueue, next=${topPublicLeadImportItem.businessName}`
        : "candidateIds from verified publicLeadImportQueue, writePreviewFiles=true, requireRobertApprovalToContact=true",
      output: "Mockups, website sales packets and draft-only outreach for approved candidates.",
      gate: "No outreach send, paid data spend or placeholder candidates.",
      copyableApiRequest: input.publicLeadImportQueue.copyableMoneySprintRequest,
    },
    sell: {
      apiAction: topWebsiteSalesPacket?.draftStatus === "approved"
        ? "/api/revenue-engine/website-opportunities"
        : "/api/revenue-engine/outreach-drafts/approve",
      input: topWebsiteSalesPacket?.draftStatus === "approved"
        ? "leadId, outreachDraftId, projectType from top reviewed sales packet"
        : "draftId, approvedByRobert=true, notes with manual approval context",
      output: topWebsiteSalesPacket?.draftStatus === "approved"
        ? "Quoted website opportunity ready for manual scope/deposit close gate."
        : "Approved manual contact queue entry and close packet.",
      gate: topWebsiteSalesPacket?.draftStatus === "approved"
        ? "Do not close or build until deposit and scope evidence are recorded."
        : "Robert approval required before any business contact.",
      copyableApiRequest: topWebsiteSalesPacket?.draftStatus === "approved"
        ? topWebsiteSalesPacket.copyableOpportunityRequest
        : JSON.stringify({
            draftId: topWebsiteSalesPacket?.outreachDraftId || "REPLACE_WITH_REVIEWED_DRAFT_ID",
            approvedByRobert: true,
            notes: topWebsiteSalesPacket
              ? `Robert approved manual contact for ${topWebsiteSalesPacket.businessName} after reviewing public evidence, mockup, pricing and channel.`
              : "Robert approved manual contact after reviewing public evidence, mockup, pricing and channel.",
          }, null, 2),
    },
    contact: {
      apiAction: "/api/revenue-engine/outreach-outcome",
      input: topManualOutreach
        ? `draftId=${topManualOutreach.draftId}, manual outcome for ${topManualOutreach.businessName}`
        : "draftId, manual outcome, notes, optional cash/payment reference only when verified",
      output: "Reply/call/deposit outcome captured without auto-send.",
      gate: "Manual-only channels stay manual; deposit requires verifiable payment evidence.",
      copyableApiRequest: topManualOutreach?.copyableOutcomeRequests.reply || JSON.stringify({
        draftId: "REPLACE_WITH_MANUAL_CONTACT_DRAFT_ID",
        outcome: "reply",
        notes: "REPLACE with manual outreach outcome. Do not include secrets or private customer data.",
      }, null, 2),
    },
    collect: {
      apiAction: "/api/revenue-engine/website-delivery-workspace",
      input: topDeliveryHandoff
        ? `sold opportunity=${topDeliveryHandoff.opportunityId}, lead=${topDeliveryHandoff.leadId}, branch=${topDeliveryHandoff.suggestedBranchName}`
        : "leadId, outreachDraftId, websiteOpportunityId, repoFullName, branchName=codex/..., depositPaid=true, scopeApproved=true, publicDataVerified=true",
      output: "QA-gated delivery workspace plus GitHub PR-first build handoff.",
      gate: "No workspace/build until deposit, scope and payment evidence pass.",
      copyableApiRequest: topDeliveryHandoff?.copyableWorkspaceRequest || JSON.stringify({
        leadId: "REPLACE_WITH_SOLD_LEAD_ID",
        outreachDraftId: "REPLACE_WITH_APPROVED_DRAFT_ID",
        websiteOpportunityId: "REPLACE_WITH_SOLD_WEBSITE_OPPORTUNITY_ID",
        repoFullName: "owner/repo",
        branchName: "codex/client-website-build",
        depositPaid: true,
        scopeApproved: true,
        publicDataVerified: true,
        notes: "Deposit, scope and public data verified before creating PR-first workspace.",
      }, null, 2),
    },
    build: {
      apiAction: "/api/revenue-engine/delivery-workspaces/github-handoff",
      input: topBuildHandoff
        ? `workspaceId=${topBuildHandoff.workspaceId}, repo=${topBuildHandoff.repoFullName}, branch=${topBuildHandoff.branchName}`
        : "workspaceId, repoFullName, branchName and public build pack",
      output: "GitHub handoff issue/PR-first brief for second-agent review and App QA.",
      gate: "No merge/deploy/client preview until PR, review, App QA and Robert deploy approval.",
      copyableApiRequest: topBuildHandoff?.copyableGithubHandoffRequest || JSON.stringify({
        workspaceId: "REPLACE_WITH_DELIVERY_WORKSPACE_ID",
        repoFullName: "owner/repo",
        branchName: "codex/client-website-build",
        notes: "Create PR-first GitHub handoff. No deploy without PR review, App QA and Robert approval.",
      }, null, 2),
    },
    blocked: {
      apiAction: "/api/revenue-engine/expense-preflight",
      input: "concept, amountUsd=0, estimatedInternalCostUsd=0, notes describing the blocked guardrail",
      output: "Blocked reason and safe next action.",
      gate: "Resolve Profit Guard or production persistence before operating with real money.",
      copyableApiRequest: JSON.stringify({
        concept: "blocked-money-command-preflight",
        amountUsd: 0,
        estimatedInternalCostUsd: 0,
        notes: "Resolve guardrail before real revenue operation.",
      }, null, 2),
    },
  };
  const runPacketCore = status === "collect" && input.websiteDeliveryHandoffQueue.readyCount === 0 && input.websiteClosureQueue.readyCount > 0
    ? {
        apiAction: "/api/revenue-engine/website-opportunities/close",
        input: topWebsiteClosure
          ? `opportunityId=${topWebsiteClosure.opportunityId}, closureStage=${topWebsiteClosure.closureStage}`
          : "opportunityId, depositPaid, scopeApproved, cashCollectedUsd, paymentConfirmation, notes",
        output: "Sold website opportunity once deposit and scope evidence are complete.",
        gate: "No delivery workspace, ledger sale or build until deposit evidence and scope approval are both recorded.",
        copyableApiRequest: topWebsiteClosure?.copyableCloseRequest || JSON.stringify({
          opportunityId: "REPLACE_WITH_WEBSITE_OPPORTUNITY_ID",
          depositPaid: true,
          scopeApproved: true,
          cashCollectedUsd: "REPLACE_WITH_VERIFIED_CASH_AMOUNT",
          paymentConfirmation: "REPLACE_WITH_STRIPE_OR_BANK_REFERENCE",
          notes: "Verified manual deposit and scope approval before closing sale.",
        }, null, 2),
      }
    : runPacketByStatus[status];
  const copyableRunPacket = [
    "Revenue Engine next run packet",
    "",
    `Status: ${status}`,
    `Primary action: ${primaryActionByStatus[status]}`,
    `API: ${runPacketCore.apiAction}`,
    `Input: ${runPacketCore.input}`,
    `Output: ${runPacketCore.output}`,
    `Gate: ${runPacketCore.gate}`,
    "",
    "Copyable API request:",
    runPacketCore.copyableApiRequest,
    "",
    "Safety:",
    "- Do not auto-send outreach.",
    "- Do not spend money without Robert approval.",
    "- Do not deploy, publish previews or merge without PR review, App QA and explicit Robert approval.",
  ].join("\n");
  const runPacket: RevenueDailyMoneyCommand["runPacket"] = {
    status,
    ...runPacketCore,
    copyableRunPacket,
  };
  const copyableOperatorBrief = [
    "Revenue Engine daily money command",
    "",
    `Status: ${status}`,
    `Primary action: ${primaryActionByStatus[status]}`,
    `Target: ${target}`,
    "",
    "Funnel:",
    `- Research target: ${funnel.researchTarget}`,
    `- Verified candidates ready: ${funnel.candidatesReady}`,
    `- Sales packets ready: ${funnel.salesPacketsReady}`,
    `- Manual contacts ready: ${funnel.manualContactsReady}`,
    `- Website scope/deposit closures pending: ${funnel.websiteClosuresPending}`,
    `- Delivery handoffs ready: ${funnel.deliveryHandoffsReady}`,
    `- Website builds needing PR-first handoff: ${funnel.buildHandoffsOpen}`,
    "- Payment totals: tracked internally; do not paste amounts into public PR/client handoff text.",
    "",
    "Next run packet:",
    copyableRunPacket,
    input.websiteBuildHandoffQueue.items[0] ? "" : null,
    input.websiteBuildHandoffQueue.items[0] ? "Top build handoff:" : null,
    input.websiteBuildHandoffQueue.items[0] ? `- Workspace: ${input.websiteBuildHandoffQueue.items[0].workspaceId}` : null,
    input.websiteBuildHandoffQueue.items[0] ? `- Client: ${input.websiteBuildHandoffQueue.items[0].clientName}` : null,
    input.websiteBuildHandoffQueue.items[0] ? `- Branch: ${input.websiteBuildHandoffQueue.items[0].branchName}` : null,
    input.websiteBuildHandoffQueue.items[0] ? `- Missing: ${input.websiteBuildHandoffQueue.items[0].missing.join("; ") || "none"}` : null,
    input.websiteBuildHandoffQueue.items[0] ? "" : null,
    input.websiteBuildHandoffQueue.items[0] ? input.websiteBuildHandoffQueue.items[0].publicBuildBrief : null,
    "",
    "Rules:",
    "- Use public research only.",
    "- Do not auto-send outreach.",
    "- Do not spend money without Robert approval.",
    "- Do not deploy or publish client previews until PR, review, App QA, and Robert approval are recorded.",
  ].filter((line): line is string => line !== null).join("\n");

  return {
    status,
    headline: status === "blocked" ? "Dinero pausado por guardrail" : "Siguiente accion para generar dinero",
    primaryAction: primaryActionByStatus[status],
    target,
    funnel,
    steps,
    runPacket,
    copyableOperatorBrief,
    safety: {
      sendsOutreach: false,
      spendsMoney: false,
      deploys: false,
      requiresHumanApproval: ["contact business", "paid data", "client charge/deposit confirmation", "deploy/publish"],
      blockedActions: ["auto-send outreach", "buy paid data", "start client build before deposit/scope", "merge without PR", "deploy without Robert approval"],
    },
  };
}

function applyRevenueProductionPersistenceGate(input: {
  launchReadiness: ReturnType<typeof buildRevenueLaunchReadiness>;
  dailyMoneyCommand: RevenueDailyMoneyCommand;
  systemReadiness: ReturnType<typeof buildRevenueSystemReadiness>;
}) {
  const persistenceItem = input.systemReadiness.items.find((item) => item.id === "production_persistence");
  if (!persistenceItem || persistenceItem.status === "ready") {
    return {
      launchReadiness: input.launchReadiness,
      dailyMoneyCommand: input.dailyMoneyCommand,
    };
  }

  const blockedLaunchItem = {
    id: "production_persistence",
    label: "Persistencia de produccion",
    status: "blocked" as const,
    evidence: persistenceItem.evidence,
    nextStep: persistenceItem.nextStep,
  };
  const launchItems = [
    ...input.launchReadiness.items.filter((item) => item.id !== blockedLaunchItem.id),
    blockedLaunchItem,
  ];
  const ready = launchItems.filter((item) => item.status === "ready").length;
  const pendingAllowed = launchItems.filter((item) => item.status === "pending_allowed").length;
  const blocked = launchItems.filter((item) => item.status === "blocked").length;
  const persistenceBlockedRunPacket: RevenueDailyMoneyCommand["runPacket"] = {
    status: "blocked",
    apiAction: "/api/revenue-engine/expense-preflight",
    input: "concept, amountUsd=0, estimatedInternalCostUsd=0, notes=production DATABASE_URL missing",
    output: "Blocked reason and safe next action.",
    gate: "Configure real DATABASE_URL before operating with real leads, payments or delivery.",
    copyableApiRequest: JSON.stringify({
      concept: "production-persistence-required",
      amountUsd: 0,
      estimatedInternalCostUsd: 0,
      notes: "Configure real DATABASE_URL and strong SESSION_SECRET before operating with real leads, payments or delivery.",
    }, null, 2),
    copyableRunPacket: [
      "Revenue Engine next run packet",
      "",
      "Status: blocked",
      "Primary action: Configure real DATABASE_URL before operating with real leads, payments or delivery.",
      "API: /api/revenue-engine/expense-preflight",
      "Input: concept, amountUsd=0, estimatedInternalCostUsd=0, notes=production DATABASE_URL missing",
      "Output: Blocked reason and safe next action.",
      "Gate: Configure real DATABASE_URL before operating with real leads, payments or delivery.",
      "",
      "Copyable API request:",
      JSON.stringify({
        concept: "production-persistence-required",
        amountUsd: 0,
        estimatedInternalCostUsd: 0,
        notes: "Configure real DATABASE_URL and strong SESSION_SECRET before operating with real leads, payments or delivery.",
      }, null, 2),
      "",
      "Safety:",
      "- Do not run public lead workflows with real money state until production persistence is configured.",
      "- Do not auto-send outreach.",
      "- Do not spend money without Robert approval.",
      "- Do not deploy, publish previews or merge without PR review, App QA and explicit Robert approval.",
    ].join("\n"),
  };
  const shouldBlockDailyMoneyCommand = persistenceItem.status === "blocked"
    || (persistenceItem.status === "needs_data" && input.dailyMoneyCommand.status !== "search");
  const dailyMoneyCommand: RevenueDailyMoneyCommand = shouldBlockDailyMoneyCommand
    ? {
        ...input.dailyMoneyCommand,
        status: "blocked",
        headline: "Dinero pausado hasta configurar persistencia",
        primaryAction: "Configurar DATABASE_URL real antes de operar con leads, cobros o entregas reales.",
        target: "Persistencia real antes de money mode",
        steps: input.dailyMoneyCommand.steps.map((step) => ({
          ...step,
          status: "blocked" as const,
          nextAction: step.id === "search"
            ? "Configurar DATABASE_URL real; solo hacer dry-run local sin contacto ni cobros."
            : step.nextAction,
        })),
        runPacket: persistenceBlockedRunPacket,
        copyableOperatorBrief: [
          "Revenue Engine daily money command",
          "",
          "Status: blocked",
          "Primary action: Configure real DATABASE_URL before operating with real leads, payments or delivery.",
          `Persistence evidence: ${persistenceItem.evidence}`,
          "",
          "Next run packet:",
          persistenceBlockedRunPacket.copyableRunPacket,
          "",
          input.dailyMoneyCommand.copyableOperatorBrief,
        ].join("\n"),
        safety: {
          ...input.dailyMoneyCommand.safety,
          blockedActions: Array.from(new Set([
            "real-money operation before production persistence",
            "contact business before production persistence",
            "record deposit before production persistence",
            ...input.dailyMoneyCommand.safety.blockedActions,
          ])),
        },
      }
    : input.dailyMoneyCommand;

  return {
    launchReadiness: {
      ...input.launchReadiness,
      status: "blocked" as const,
      summary: "No arrancar money mode real hasta configurar DATABASE_URL/persistencia de produccion.",
      launchScore: Math.round((ready / launchItems.length) * 100),
      ready,
      pendingAllowed,
      blocked,
      items: launchItems,
      todayExecutionPack: {
        ...input.launchReadiness.todayExecutionPack,
        status: "blocked" as const,
        mission: "Configurar persistencia real antes de buscar/contactar/cobrar negocios reales.",
        copyableAgentCommand: "Do not run real-money lead, outreach, payment or delivery workflows until production DATABASE_URL is configured. Dry-run local research only.",
        nextApiAction: "/api/revenue-engine",
        approvalRequiredBefore: Array.from(new Set([
          "production DATABASE_URL",
          ...input.launchReadiness.todayExecutionPack.approvalRequiredBefore,
        ])),
      },
    },
    dailyMoneyCommand,
  };
}

function buildRevenueProductionReleaseEvidence(workspaces: RevenueDeliveryWorkspace[]) {
  const releaseReadyWorkspace = workspaces.find((workspace) =>
    workspace.input.prUrl
    && workspace.input.secondReviewStatus === "pass"
    && workspace.input.secondReviewEvidenceUrl
    && workspace.input.appQaStatus === "pass"
    && workspace.input.appQaEvidenceUrl
    && workspace.input.deploymentApprovalStatus === "approved"
    && workspace.input.deploymentApprovalUrl
    && workspace.input.releaseGateHeadSha
    && revenueWebsiteWorkspaceSaleGate(workspace).blockers.length === 0
  );
  const partialPrReviewWorkspace = workspaces.find((workspace) =>
    workspace.input.prUrl
    && workspace.input.secondReviewStatus === "pass"
    && workspace.input.secondReviewEvidenceUrl
  );
  const partialAppQaWorkspace = workspaces.find((workspace) =>
    workspace.input.prUrl
    && workspace.input.appQaStatus === "pass"
    && workspace.input.appQaEvidenceUrl
  );
  const partialDeploymentApprovalWorkspace = workspaces.find((workspace) =>
    workspace.input.prUrl
    && workspace.input.deploymentApprovalStatus === "approved"
    && workspace.input.deploymentApprovalUrl
  );

  return {
    prReview: releaseReadyWorkspace
      ? {
          status: "ready" as const,
          workspaceId: releaseReadyWorkspace.id,
          evidenceUrl: releaseReadyWorkspace.input.secondReviewEvidenceUrl,
          evidence: `${releaseReadyWorkspace.input.clientName} workspace ${releaseReadyWorkspace.id} has approved second-agent review evidence on ${releaseReadyWorkspace.input.prUrl} at head ${releaseReadyWorkspace.input.releaseGateHeadSha}.`,
          nextStep: "Mantener evidencia del review en el PR antes de merge/deploy.",
        }
      : {
          status: "blocked" as const,
          workspaceId: "",
          evidenceUrl: "",
          evidence: partialPrReviewWorkspace
            ? `${partialPrReviewWorkspace.input.clientName} has PR review evidence, but not a complete same-workspace release packet.`
            : "No delivery workspace has persisted PR review evidence.",
          nextStep: "Registrar PR review, App QA y aprobacion de deploy en el mismo release gate del workspace.",
        },
    appQa: releaseReadyWorkspace
      ? {
          status: "ready" as const,
          workspaceId: releaseReadyWorkspace.id,
          evidenceUrl: releaseReadyWorkspace.input.appQaEvidenceUrl,
          evidence: `${releaseReadyWorkspace.input.clientName} workspace ${releaseReadyWorkspace.id} has App QA evidence on ${releaseReadyWorkspace.input.prUrl} at head ${releaseReadyWorkspace.input.releaseGateHeadSha}.`,
          nextStep: "Mantener App QA sin warnings/failures antes de deploy.",
        }
      : {
          status: "blocked" as const,
          workspaceId: "",
          evidenceUrl: "",
          evidence: partialAppQaWorkspace
            ? `${partialAppQaWorkspace.input.clientName} has App QA evidence, but not a complete same-workspace release packet.`
            : "No delivery workspace has persisted App QA release-gate evidence.",
          nextStep: "Registrar PR review, App QA y aprobacion de deploy en el mismo release gate del workspace.",
        },
    deploymentApproval: releaseReadyWorkspace
      ? {
          status: "ready" as const,
          workspaceId: releaseReadyWorkspace.id,
          evidenceUrl: releaseReadyWorkspace.input.deploymentApprovalUrl,
          evidence: `${releaseReadyWorkspace.input.clientName} workspace ${releaseReadyWorkspace.id} has explicit Robert deploy approval evidence at head ${releaseReadyWorkspace.input.releaseGateHeadSha}.`,
          nextStep: "Usar la aprobacion registrada solo para el deploy descrito por ese PR/workspace.",
        }
      : {
          status: "blocked" as const,
          workspaceId: "",
          evidenceUrl: "",
          evidence: partialDeploymentApprovalWorkspace
            ? `${partialDeploymentApprovalWorkspace.input.clientName} has Robert deploy approval evidence, but not a complete same-workspace release packet.`
            : "No delivery workspace has explicit Robert deploy approval evidence.",
          nextStep: "Registrar PR review, App QA y aprobacion de deploy en el mismo release gate del workspace.",
        },
  };
}

function buildRevenueMoneyActivationPlan(input: {
  launchReadiness: ReturnType<typeof applyRevenueProductionPersistenceGate>["launchReadiness"];
  dailyMoneyCommand: RevenueDailyMoneyCommand;
  businessScoutQueue: RevenueBusinessScoutQueue;
  publicLeadImportQueue: RevenuePublicLeadImportQueue;
  systemReadiness: ReturnType<typeof buildRevenueSystemReadiness>;
  agentOperatingContract: ReturnType<typeof buildRevenueAgentOperatingContract>;
  releaseEvidence: ReturnType<typeof buildRevenueProductionReleaseEvidence>;
}) {
  const productionPersistence = input.systemReadiness.items.find((item) => item.id === "production_persistence");
  const hardMissing = [
    productionPersistence && productionPersistence.status !== "ready" && {
      id: "production_database",
      label: "Configurar DATABASE_URL real",
      reason: productionPersistence.evidence,
      nextStep: productionPersistence.nextStep,
    },
    ...input.systemReadiness.items
      .filter((item) => item.id !== "production_persistence" && item.status === "blocked")
      .map((item) => ({
        id: item.id,
        label: item.label,
        reason: item.evidence,
        nextStep: item.nextStep,
      })),
  ].filter(Boolean) as Array<{ id: string; label: string; reason: string; nextStep: string }>;
  const softMissing = input.systemReadiness.items
    .filter((item) => item.id !== "production_persistence" && (item.status === "needs_data" || item.status === "needs_approval"))
    .map((item) => ({
      id: item.id,
      label: item.label,
      reason: item.evidence,
      nextStep: item.nextStep,
    }));
  const dedupedMissing = Array.from(new Map([...hardMissing, ...softMissing].map((item) => [item.id, item])).values());
  const canResearchNow = input.dailyMoneyCommand.safety.sendsOutreach === false
    && input.dailyMoneyCommand.safety.spendsMoney === false
    && input.dailyMoneyCommand.safety.deploys === false;
  const canCollectMoney = input.launchReadiness.status === "ready_to_start"
    && !hardMissing.some((item) => item.id === "production_database")
    && input.dailyMoneyCommand.safety.requiresHumanApproval.includes("client charge/deposit confirmation");
  const approvals = Array.from(new Set([
    ...input.launchReadiness.todayExecutionPack.approvalRequiredBefore,
    ...input.dailyMoneyCommand.safety.requiresHumanApproval,
    ...input.dailyMoneyCommand.safety.blockedActions,
    ...input.agentOperatingContract.requiresHumanApproval,
  ]));
  const evidenceGate = {
    status: input.publicLeadImportQueue.status,
    readyCandidates: input.publicLeadImportQueue.readyCount,
    blockedCandidates: input.publicLeadImportQueue.blockedCount,
    requiredFields: input.launchReadiness.todayExecutionPack.requiredEvidenceFields,
    nextAction: input.publicLeadImportQueue.nextAction,
    blockedActions: Array.from(new Set([
      "import unverified public evidence",
      "run Money Sprint from placeholders",
      "contact business before Robert approval",
      ...input.publicLeadImportQueue.safety.blockedActions,
    ])),
  };
  const productionDatabaseReady = !hardMissing.some((item) => item.id === "production_database");
  const sessionSecretReady = hasStrongSecret(process.env.SESSION_SECRET);
  const productionSetupPacket = {
    status: productionDatabaseReady && sessionSecretReady ? "ready" as const : "blocked" as const,
    title: "Production persistence setup packet",
    requiredEnv: [
      {
        key: "DATABASE_URL",
        status: productionDatabaseReady ? "ready" as const : "blocked" as const,
        evidence: productionPersistence?.evidence || "Production persistence status unavailable.",
        nextStep: productionDatabaseReady
          ? "Correr npm run ceo:db-check -- --json antes del merge/deploy final."
          : "Crear Postgres en Replit o proveedor gestionado y guardar DATABASE_URL como deployment secret, no en git.",
        verifyCommand: "npm run ceo:db-check -- --json",
      },
      {
        key: "SESSION_SECRET",
        status: sessionSecretReady ? "ready" as const : "blocked" as const,
        evidence: sessionSecretReady
          ? "SESSION_SECRET detectado sin exponer su valor."
          : "SESSION_SECRET no detectado como secret real.",
        nextStep: sessionSecretReady
          ? "Mantener SESSION_SECRET solo como deployment secret."
          : "Configurar SESSION_SECRET largo como deployment secret antes de produccion.",
        verifyCommand: "npm run ceo:doctor -- --json",
      },
    ],
    operatorSteps: [
      "Crear/confirmar Postgres persistente del entorno final.",
      "Guardar DATABASE_URL y SESSION_SECRET solo como secrets del deploy.",
      "Ejecutar npm run ceo:db-check -- --json y confirmar databaseUrlConfigured=true.",
      "Ejecutar npm run check, npm run build y npm run test:revenue-engine antes de quitar draft al PR.",
      "Repetir App QA contra la URL objetivo y pedir aprobacion explicita de Robert antes de Replit deploy.",
    ],
    guardrails: [
      "No pegar DATABASE_URL en issues, PRs, logs publicos o chat.",
      "No operar leads/cobros/entregas reales con local_file persistence.",
      "No desplegar si App QA tiene warning/failure.",
      "No desplegar Replit sin aprobacion humana explicita.",
    ],
  };
  const copyableProductionSetupPacket = [
    "Revenue Engine production setup packet",
    "",
    `Status: ${productionSetupPacket.status}`,
    "",
    "Required env:",
    ...productionSetupPacket.requiredEnv.map((item) => [
      `- ${item.key}: ${item.status}`,
      `  Evidence: ${item.evidence}`,
      `  Next: ${item.nextStep}`,
      `  Verify: ${item.verifyCommand}`,
    ].join("\n")),
    "",
    "Operator steps:",
    ...productionSetupPacket.operatorSteps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Guardrails:",
    ...productionSetupPacket.guardrails.map((guardrail) => `- ${guardrail}`),
  ].join("\n");
  const requiredLaunchEvidence = [
      {
        id: "production_database",
        label: "DATABASE_URL real",
        status: hardMissing.some((item) => item.id === "production_database") ? "blocked" as const : "ready" as const,
        evidence: productionPersistence?.evidence || "No production persistence item found.",
        nextStep: productionPersistence?.nextStep || "Confirmar persistencia antes de money mode.",
      },
      {
        id: "pr_review",
        label: "PR review independiente",
        status: input.releaseEvidence.prReview.status,
        evidence: input.releaseEvidence.prReview.evidence,
        nextStep: input.releaseEvidence.prReview.nextStep,
      },
      {
        id: "app_qa_release_gate",
        label: "App QA release gate",
        status: input.releaseEvidence.appQa.status,
        evidence: input.releaseEvidence.appQa.evidence,
        nextStep: input.releaseEvidence.appQa.nextStep,
      },
      {
        id: "robert_deploy_approval",
        label: "Aprobacion explicita de deploy",
        status: input.releaseEvidence.deploymentApproval.status,
        evidence: input.releaseEvidence.deploymentApproval.evidence,
        nextStep: input.releaseEvidence.deploymentApproval.nextStep,
      },
    ];
  const blockedLaunchEvidence = requiredLaunchEvidence.filter((item) => item.status !== "ready");
  const productionLaunchChecklist = {
    status: blockedLaunchEvidence.length === 0 ? "ready" as const : "blocked" as const,
    requiredEvidence: requiredLaunchEvidence,
    verificationCommands: [
      "npm run revenue:money-readiness -- --mode=first-sprint --json",
      "npm run revenue:money-readiness -- --mode=production-launch --json",
      "npm run test:revenue-engine",
      "npm run test:revenue-public-scout-connector",
      "npm run test:revenue-money-readiness-cli",
      "npm run test:developer-autopilot",
      "npm run check",
      "npm run build",
    ],
    blockedActions: [
      "real-money operation before production DATABASE_URL",
      "merge before PR review",
      "deploy before App QA",
      "Replit deploy before Robert approval",
    ],
    deploymentApprovalPacket: {
      status: blockedLaunchEvidence.length === 0 ? "approved" as const : "waiting_for_external_evidence" as const,
      requiredSummaryFields: [
        "PR URL",
        "files changed",
        "tests/build checks run",
        "second-agent review result",
        "App QA route/link/API/error/improvement summary",
        "known risks",
        "rollback note",
        "explicit Robert deploy approval",
      ],
      rollbackPlan: "Revertir el PR o volver al deployment anterior; no hacer Replit deploy si App QA tiene warning/failure.",
      deployApprovalAsk: "Robert, apruebas explicitamente el deploy de Replit despues de revisar PR, tests, App QA, riesgos y rollback?",
      blockedUntil: blockedLaunchEvidence.length > 0
        ? blockedLaunchEvidence.map((item) => `${item.label}: ${item.nextStep}`)
        : ["none"],
    },
  };
  const copyableProductionLaunchChecklist = [
    "Revenue Engine production launch checklist",
    "",
    `Status: ${productionLaunchChecklist.status}`,
    "",
    "Required evidence:",
    ...productionLaunchChecklist.requiredEvidence.map((item) => [
      `- ${item.label}: ${item.status}`,
      `  Evidence: ${item.evidence}`,
      `  Next: ${item.nextStep}`,
    ].join("\n")),
    "",
    "Verification commands:",
    ...productionLaunchChecklist.verificationCommands.map((command) => `- ${command}`),
    "",
    "Blocked actions:",
    ...productionLaunchChecklist.blockedActions.map((action) => `- ${action}`),
    "",
    "Deployment approval packet:",
    `- Status: ${productionLaunchChecklist.deploymentApprovalPacket.status}`,
    "- Required summary fields:",
    ...productionLaunchChecklist.deploymentApprovalPacket.requiredSummaryFields.map((field) => `  - ${field}`),
    `- Rollback: ${productionLaunchChecklist.deploymentApprovalPacket.rollbackPlan}`,
    `- Deploy approval ask: ${productionLaunchChecklist.deploymentApprovalPacket.deployApprovalAsk}`,
    "- Blocked until:",
    ...productionLaunchChecklist.deploymentApprovalPacket.blockedUntil.map((item) => `  - ${item}`),
  ].join("\n");
  const firstSprintPlan = {
    title: `${input.businessScoutQueue.area} ${input.businessScoutQueue.niche} first revenue sprint`,
    area: input.businessScoutQueue.area,
    niche: input.businessScoutQueue.niche,
    offerFocus: input.businessScoutQueue.offerFocus,
    targetRows: Math.min(input.businessScoutQueue.dailyResearchTarget, 10),
    nextApiAction: "/api/revenue-engine/scout-dispatch",
    copyableDispatchRequest: JSON.stringify({
      area: input.businessScoutQueue.area,
      niche: input.businessScoutQueue.niche,
      offerFocus: input.businessScoutQueue.offerFocus,
      targetLeadCount: Math.min(input.businessScoutQueue.dailyResearchTarget, 10),
      maxTasks: Math.min(Math.max(input.businessScoutQueue.tasks.length, 1), 5),
      resultSlotsPerTask: 2,
      maxPaidDataSpendUsd: 0,
      requireRobertApprovalToContact: true,
      notes: "First revenue sprint scout dispatch: public research only; return connector work orders and review-only candidates.",
    }, null, 2),
    revenuePath: [
      {
        id: "find_public_businesses",
        label: "Find real public businesses",
        input: "Public search/listing/profile URLs assigned to scout subagents.",
        output: "Verified public evidence blocks with sourceUrl, contact path, pain point and offer estimate.",
        gate: "No placeholders; publicEvidenceVerified, approvalToImport and approvedByRobert must be true.",
        apiAction: "/api/revenue-engine/daily-scout-sprint/submit",
      },
      {
        id: "package_website_offer",
        label: "Package website offer",
        input: "Imported candidates with real public evidence.",
        output: "Internal mockup, outreach draft, website sales packet and close packet.",
        gate: "Draft remains internal until Robert approves contact.",
        apiAction: "/api/revenue-engine/money-sprint-preview",
      },
      {
        id: "close_deposit_scope",
        label: "Close deposit and scope",
        input: "Approved sales packet and manual business conversation.",
        output: "Website opportunity with depositPaid, scopeApproved, cashCollectedUsd and paymentConfirmation.",
        gate: "Deposit evidence must cover required deposit; no auto-charge or auto-send.",
        apiAction: "/api/revenue-engine/website-opportunities/close",
      },
      {
        id: "create_qa_delivery_workspace",
        label: "Create QA-gated delivery workspace",
        input: "Sold website opportunity with verified payment and approved scope.",
        output: "Delivery workspace with plan, QA gates, GitHub handoff and PR-first build brief.",
        gate: "No build, publish, deploy or ledger sale without workspace sale gate passing.",
        apiAction: "/api/revenue-engine/website-delivery-workspace",
      },
      {
        id: "open_pr_first_build",
        label: "Open PR-first website build",
        input: "Ready delivery workspace and Codex build handoff.",
        output: "GitHub handoff/PR ready for second-agent review and App QA.",
        gate: "No direct main commit; no merge/deploy without PR review, App QA and Robert approval.",
        apiAction: "/api/revenue-engine/delivery-workspaces/github-handoff",
      },
    ],
    steps: [
      {
        id: "dispatch_public_research",
        label: "Dispatch scouts",
        action: "Crear slots y work orders por subagente; solo abrir fuentes publicas y llenar evidencia real.",
        apiAction: "/api/revenue-engine/scout-dispatch",
        approvalRequired: false,
      },
      {
        id: "submit_public_evidence",
        label: "Submit public evidence",
        action: "Pegar bloques completos, verificar URL publica y aprobar import solo si la evidencia es real.",
        apiAction: "/api/revenue-engine/daily-scout-sprint/submit",
        approvalRequired: false,
      },
      {
        id: "preview_money_sprint",
        label: "Preview Money Sprint",
        action: "Crear mockups y outreach drafts desde candidatos verificados sin enviar contacto externo.",
        apiAction: "/api/revenue-engine/money-sprint-preview",
        approvalRequired: false,
      },
      {
        id: "approve_contact_or_collect",
        label: "Robert approval gate",
        action: "Aprobar manualmente contacto/cobro/deposito antes de enviar, cobrar o construir.",
        apiAction: "/api/revenue-engine/approval-decisions",
        approvalRequired: true,
      },
    ],
    blockedActions: ["contact business", "send email/DM/form", "buy paid data", "charge client", "start build", "deploy"],
  };
  const firstSprintCopyableBrief = [
    "Revenue Engine first sprint plan",
    "",
    `Market: ${firstSprintPlan.area} ${firstSprintPlan.niche}`,
    `Offer focus: ${firstSprintPlan.offerFocus}`,
    `Target rows: ${firstSprintPlan.targetRows}`,
    `Next API action: ${firstSprintPlan.nextApiAction}`,
    "",
    "Copyable dispatch request:",
    firstSprintPlan.copyableDispatchRequest,
    "",
    "Steps:",
    ...firstSprintPlan.steps.map((step, index) => [
      `${index + 1}. ${step.label}`,
      `   Action: ${step.action}`,
      `   API: ${step.apiAction}`,
      `   Approval required: ${step.approvalRequired ? "yes" : "no"}`,
    ].join("\n")),
    "",
    "Evidence gate:",
    `- Status: ${evidenceGate.status}`,
    `- Ready candidates: ${evidenceGate.readyCandidates}`,
    `- Blocked candidates: ${evidenceGate.blockedCandidates}`,
    `- Required fields: ${evidenceGate.requiredFields.join(", ")}`,
    `- Next action: ${evidenceGate.nextAction}`,
    "",
    "Revenue path to paid website build:",
    ...firstSprintPlan.revenuePath.map((stage, index) => [
      `${index + 1}. ${stage.label}`,
      `   Input: ${stage.input}`,
      `   Output: ${stage.output}`,
      `   Gate: ${stage.gate}`,
      `   API: ${stage.apiAction}`,
    ].join("\n")),
    "",
    "Blocked until Robert approval:",
    ...firstSprintPlan.blockedActions.map((action) => `- ${action}`),
  ].join("\n");
  const status =
    input.launchReadiness.status === "ready_to_start"
    && hardMissing.length === 0
    && softMissing.length === 0
    && input.agentOperatingContract.mode === "controlled_autopilot"
      ? "ready_for_money_mode" as const
      : input.launchReadiness.status === "ready_to_start" && hardMissing.length === 0
        ? "ready_for_first_sprint" as const
      : canResearchNow
        ? "dry_run_research_only" as const
        : "blocked" as const;

  return {
    status,
    headline: status === "ready_for_money_mode"
      ? "Listo para operar el primer sprint de dinero con aprobaciones."
      : status === "ready_for_first_sprint"
        ? "Listo para preparar el primer sprint; contacto, cobro y deploy siguen con aprobacion."
      : status === "dry_run_research_only"
        ? "Puede buscar negocios en modo dry-run; falta activar money mode real."
        : "Pausado hasta resolver bloqueos de seguridad.",
    canStartToday: canResearchNow,
    canContactBusinesses: input.launchReadiness.todayExecutionPack.status === "ready"
      && input.agentOperatingContract.mode === "controlled_autopilot"
      && !input.dailyMoneyCommand.safety.blockedActions.some((action) => action.includes("contact")),
    canCollectMoney,
    canBuildWebsites: input.dailyMoneyCommand.funnel.deliveryHandoffsReady > 0
      || input.dailyMoneyCommand.funnel.buildHandoffsOpen > 0,
    allowedToday: Array.from(new Set([
      "buscar negocios publicos",
      "guardar candidatos con evidencia verificable",
      "crear mockups internos",
      "preparar outreach/propuesta en draft",
      ...input.agentOperatingContract.canRunAutonomously,
    ])).slice(0, 8),
    missingBeforeRealMoney: dedupedMissing,
    blockedUntilApproved: approvals,
    evidenceGate,
    productionLaunchChecklist: {
      ...productionLaunchChecklist,
      productionSetupPacket: {
        ...productionSetupPacket,
        copyableSetupPacket: copyableProductionSetupPacket,
      },
      copyableChecklist: copyableProductionLaunchChecklist,
    },
    firstSprintPlan: {
      ...firstSprintPlan,
      copyableBrief: firstSprintCopyableBrief,
    },
    nextRobertAction: dedupedMissing[0]?.nextStep
      || input.dailyMoneyCommand.primaryAction
      || "Aprobar el siguiente batch controlado.",
    copyableBrief: [
      "Revenue Engine activation brief",
      "",
      `Status: ${status}`,
      `Can start today: ${canResearchNow ? "yes, dry-run/public research only" : "no"}`,
      `Can contact businesses: ${input.launchReadiness.todayExecutionPack.status === "ready" ? "only with Robert approval" : "no"}`,
      `Can collect money: ${canCollectMoney ? "only after Robert confirms payment/deposit evidence" : "no"}`,
      `Can build websites: ${input.dailyMoneyCommand.funnel.deliveryHandoffsReady + input.dailyMoneyCommand.funnel.buildHandoffsOpen > 0 ? "yes, PR-first after deposit/scope/QA" : "not until a paid opportunity is ready"}`,
      "",
      "Allowed today:",
      ...Array.from(new Set([
        "buscar negocios publicos",
        "guardar candidatos con evidencia verificable",
        "crear mockups internos",
        "preparar outreach/propuesta en draft",
      ])).map((item) => `- ${item}`),
      "",
      "First sprint steps:",
      ...firstSprintPlan.steps.map((step, index) => `${index + 1}. ${step.label}: ${step.action}`),
      "",
      "Evidence gate before import/contact:",
      `- Status: ${evidenceGate.status}`,
      `- Ready candidates: ${evidenceGate.readyCandidates}`,
      `- Blocked candidates: ${evidenceGate.blockedCandidates}`,
      `- Required fields: ${evidenceGate.requiredFields.join(", ")}`,
      `- Next action: ${evidenceGate.nextAction}`,
      ...evidenceGate.blockedActions.map((action) => `- Blocked: ${action}`),
      "",
      "Production launch checklist:",
      `- Status: ${productionLaunchChecklist.status}`,
      ...productionLaunchChecklist.requiredEvidence.map((item) => `- ${item.label}: ${item.status} -- ${item.nextStep}`),
      `- Rollback: ${productionLaunchChecklist.deploymentApprovalPacket.rollbackPlan}`,
      `- Deploy approval ask: ${productionLaunchChecklist.deploymentApprovalPacket.deployApprovalAsk}`,
      "",
      "Missing before real money mode:",
      ...(dedupedMissing.length > 0 ? dedupedMissing.map((item) => `- ${item.label}: ${item.nextStep}`) : ["- none"]),
      "",
      "Blocked until approval:",
      ...(approvals.length > 0 ? approvals.map((item) => `- ${item}`) : ["- none"]),
    ].join("\n"),
  };
}

export function getRevenueEngineSnapshot() {
  loadRevenueLedger();
  loadRevenueLeads();
  loadRevenueOutreach();
  loadRevenueAgentRuns();
  loadRevenueAutomationOpportunities();
  loadRevenueWebsiteOpportunities();
  loadRevenueImprovementReviews();
  loadRevenueScoutingMissions();
  loadRevenueDailyScoutSprints();
  loadRevenuePublicLeadCandidates();
  loadRevenueDeliveryWorkspaces();
  loadRevenueApprovalDecisions();
  loadRevenueAutomationIntakes();
  const sales = revenueLedger.filter(isSaleEntry);
  const expenses = revenueLedger.filter((entry) => entry.kind === "expense");
  const appsSold = revenueLedger.filter((entry) => entry.kind === "website_sale" || entry.kind === "bundle_sale").length;
  const automationsSold = revenueLedger.filter((entry) => entry.kind === "automation_sale" || entry.kind === "bundle_sale").length;
  const revenueUsd = sales.reduce((total, entry) => total + entry.amountUsd, 0);
  const cashCollectedUsd = sales.reduce((total, entry) => total + entry.cashCollectedUsd, 0);
  const directSpendUsd = expenses.reduce((total, entry) => total + entry.amountUsd, 0);
  const internalCostUsd = revenueLedger.reduce((total, entry) => total + entry.estimatedInternalCostUsd, 0);
  const estimatedSpendUsd = directSpendUsd + internalCostUsd;
  const profitUsd = cashCollectedUsd - estimatedSpendUsd;
  const pendingOutreachApprovals = revenueOutreachDrafts.filter((draft) => draft.status === "draft" || draft.status === "blocked").length;
  const pendingAgentApprovals = revenueAgentRuns.filter((run) => run.status === "approval_required" || run.status === "blocked").length;
  const pendingAutomationApprovals = revenueAutomationOpportunities.filter((opportunity) =>
    opportunity.status === "blocked" || opportunity.qaGates.some((gate) => !gate.passed),
  ).length;
  const pendingWebsiteOpportunityApprovals = revenueWebsiteOpportunities.filter((opportunity) =>
    opportunity.status === "blocked"
    || (opportunity.status !== "sold" && opportunity.status !== "delivered" && (!opportunity.depositPaid || !opportunity.scopeApproved)),
  ).length;
  const pendingDeliveryApprovals = revenueDeliveryWorkspaces.filter((workspace) => workspace.status === "blocked" || workspace.status === "needs_corrections").length;
  const approvalQueue = (estimatedSpendUsd > 100 || estimatedSpendUsd > cashCollectedUsd ? 1 : 0) + pendingOutreachApprovals + pendingAgentApprovals + pendingAutomationApprovals + pendingWebsiteOpportunityApprovals + pendingDeliveryApprovals;
  const profitGuard = buildRevenueProfitGuard({ cashCollectedUsd, estimatedSpendUsd, profitUsd, approvalQueue });
  const latestImprovementReview = revenueImprovementReviews.at(-1);
  const nextBatchPlan = buildRevenueNextBatchPlan({ profitGuard, latestReview: latestImprovementReview, approvalQueue });
  const executiveSummary = buildRevenueExecutiveSummary({
    appsSold,
    automationsSold,
    revenueUsd,
    cashCollectedUsd,
    estimatedSpendUsd,
    profitUsd,
    approvalQueue,
    profitGuard,
    nextBatchPlan,
  });
  const agentOperatingContract = buildRevenueAgentOperatingContract({ profitGuard, nextBatchPlan, approvalQueue });
  const operatorConsole = buildRevenueOperatorConsole({
    appsSold,
    automationsSold,
    revenueUsd,
    cashCollectedUsd,
    estimatedSpendUsd,
    profitUsd,
    approvalQueue,
    executiveSummary,
    profitGuard,
    nextBatchPlan,
    agentOperatingContract,
  });
  const systemReadiness = buildRevenueSystemReadiness({
    appsSold,
    automationsSold,
    cashCollectedUsd,
    estimatedSpendUsd,
    approvalQueue,
    profitGuard,
    nextBatchPlan,
    agentOperatingContract,
  });
  const baseLaunchReadiness = buildRevenueLaunchReadiness({
    area: "Miami",
    niche: "med spas / aesthetics",
    dailyResearchTarget: 120,
    dailyMockupTarget: 5,
    dailyContactTarget: 10,
    emailPending: false,
  });
  const approvalQueueItems = [
    (estimatedSpendUsd > 100 || estimatedSpendUsd > cashCollectedUsd) && {
      id: "profit-guard",
      source: "profit_guard",
      title: "Profit Guard",
      status: profitGuard.status,
      priority: "high",
      action: profitGuard.requiredActions[0] || "revisar rentabilidad",
    },
    ...revenueOutreachDrafts
      .filter((draft) => draft.status === "draft" || draft.status === "blocked")
      .slice(-5)
      .map((draft) => ({
        id: draft.id,
        source: "outbox",
        title: draft.businessName,
        status: draft.status,
        priority: draft.status === "blocked" ? "high" : "medium",
        action: draft.qaGates.find((gate) => !gate.passed)?.fix || "aprobar outreach antes de enviar",
      })),
    ...revenueAgentRuns
      .filter((run) => run.status === "approval_required" || run.status === "blocked")
      .slice(-5)
      .map((run) => ({
        id: run.id,
        source: "agent_run",
        title: run.businessName,
        status: run.status,
        priority: run.status === "blocked" ? "high" : "medium",
        action: run.requiredApprovals[0] || run.nextActions[0] || "resolver aprobacion del agente",
      })),
    ...revenueAutomationOpportunities
      .filter((opportunity) => opportunity.status === "blocked" || opportunity.qaGates.some((gate) => !gate.passed))
      .slice(-5)
      .map((opportunity) => ({
        id: opportunity.id,
        source: "automation_opportunity",
        title: opportunity.businessName,
        status: opportunity.status,
        priority: opportunity.status === "blocked" ? "high" : "medium",
        action: opportunity.qaGates.find((gate) => !gate.passed)?.fix || opportunity.nextAction,
      })),
    ...revenueWebsiteOpportunities
      .filter((opportunity) =>
        opportunity.status === "blocked"
        || (opportunity.status !== "sold" && opportunity.status !== "delivered" && (!opportunity.depositPaid || !opportunity.scopeApproved))
      )
      .slice(-5)
      .map((opportunity) => ({
        id: opportunity.id,
        source: "website_opportunity",
        title: opportunity.businessName,
        status: opportunity.status,
        priority: opportunity.status === "blocked" ? "high" : "medium",
        action: opportunity.nextAction,
      })),
    ...revenueDeliveryWorkspaces
      .filter((workspace) => workspace.status === "blocked" || workspace.status === "needs_corrections")
      .slice(-5)
      .map((workspace) => ({
        id: workspace.id,
        source: "delivery_workspace",
        title: workspace.input.clientName,
        status: workspace.status,
        priority: workspace.status === "blocked" ? "high" : "medium",
        action: workspace.correctionQueue.find((item) => item.blocksDelivery)?.action || workspace.approvalSummary.requiredBeforeClient[0] || "corregir delivery antes de entregar",
      })),
  ].filter(Boolean);
  const businessScoutQueue = buildRevenueBusinessScoutQueue();
  const websiteSalesPacketQueue = buildRevenueWebsiteSalesPacketQueue();
  const manualOutreachQueue = buildRevenueManualOutreachQueue(10);
  const publicLeadImportQueue = buildRevenuePublicLeadImportQueue(10);
  const websiteClosureQueue = buildRevenueWebsiteClosureQueue();
  const websiteDeliveryHandoffQueue = buildRevenueWebsiteDeliveryHandoffQueue(8);
  const websiteBuildHandoffQueue = buildRevenueWebsiteBuildHandoffQueue(5);
  const baseDailyMoneyCommand = buildRevenueDailyMoneyCommand({
    businessScoutQueue,
    publicLeadImportQueue,
    websiteSalesPacketQueue,
    manualOutreachQueue,
    websiteDeliveryHandoffQueue,
    websiteBuildHandoffQueue,
    websiteClosureQueue,
    cashCollectedUsd,
    profitGuard,
  });
  const { launchReadiness, dailyMoneyCommand } = applyRevenueProductionPersistenceGate({
    launchReadiness: baseLaunchReadiness,
    dailyMoneyCommand: baseDailyMoneyCommand,
    systemReadiness,
  });
  const moneyActivationPlan = buildRevenueMoneyActivationPlan({
    launchReadiness,
    dailyMoneyCommand,
    businessScoutQueue,
    publicLeadImportQueue,
    systemReadiness,
    agentOperatingContract,
    releaseEvidence: buildRevenueProductionReleaseEvidence(revenueDeliveryWorkspaces),
  });

  return {
    metrics: {
      appsSold,
      automationsSold,
      revenueUsd,
      cashCollectedUsd,
      monthlySpendCapUsd: 100,
      estimatedSpendUsd,
      profitUsd,
      approvalQueue,
    },
    executiveSummary,
    operatorConsole,
    dailyMoneyCommand,
    moneyActivationPlan,
    systemReadiness,
    launchReadiness,
    agentOperatingContract,
    businessScoutQueue,
    latestDailyScoutSprint: revenueDailyScoutSprints.at(-1) || null,
    recentDailyScoutSprints: revenueDailyScoutSprints.slice(-5).reverse(),
    websiteSalesPacketQueue,
    manualOutreachQueue,
    publicLeadImportQueue,
    websiteClosureQueue,
    websiteDeliveryHandoffQueue,
    websiteBuildHandoffQueue,
    profitGuard,
    nextBatchPlan,
    approvalQueueItems,
    costPolicy: {
      monthlyCapUsd: 100,
      stopRule: "Pausar outreach pagado si gasto mensual > ingresos cobrados o si llega a $100.",
      defaultMode: "draft_only",
      allowedWithoutApproval: ["research_plan", "mockup_brief", "qa_checklist", "proposal_draft"],
      requiresApproval: ["contact_business", "buy_data", "send_email", "send_sms", "publish_mockup", "charge_client"],
    },
    emailProvider: getRevenueEmailProviderStatus(),
    agents: agentRoster,
    pipelineStages: buildPipelineStages(revenueLedger, revenueLeads),
    packages,
    recentLedger: revenueLedger.slice(-8).reverse(),
    recentLeads: revenueLeads.slice(-100).reverse(),
    recentOutreach: revenueOutreachDrafts.slice(-10).reverse(),
    recentAgentRuns: revenueAgentRuns.slice(-10).reverse(),
    recentAutomationOpportunities: revenueAutomationOpportunities.slice(-10).reverse(),
    recentWebsiteOpportunities: revenueWebsiteOpportunities.slice(-10).reverse(),
    recentImprovementReviews: revenueImprovementReviews.slice(-10).reverse(),
    recentScoutingMissions: revenueScoutingMissions.slice(-10).reverse(),
    recentPublicLeadCandidates: revenuePublicLeadCandidates.slice(-10).reverse(),
    recentDeliveryWorkspaces: revenueDeliveryWorkspaces.slice(-10).reverse(),
    recentApprovalDecisions: revenueApprovalDecisions.slice(-10).reverse(),
    recentAutomationIntakes: revenueAutomationIntakes.slice(-10).reverse(),
    persistence: {
      mode: revenueDurablePersistenceStatus === "ready" ? "postgres" : "local_file",
      durableStatus: revenueDurablePersistenceStatus,
      durableOwnerUserId: revenueDurableScope,
      path: getRevenueLedgerPath(),
      leadsPath: getRevenueLeadsPath(),
      outreachPath: getRevenueOutreachPath(),
      agentRunsPath: getRevenueAgentRunsPath(),
      automationOpportunitiesPath: getRevenueAutomationOpportunitiesPath(),
      websiteOpportunitiesPath: getRevenueWebsiteOpportunitiesPath(),
      improvementReviewsPath: getRevenueImprovementReviewsPath(),
      scoutingMissionsPath: getRevenueScoutingMissionsPath(),
      dailyScoutSprintsPath: getRevenueDailyScoutSprintsPath(),
      publicLeadCandidatesPath: getRevenuePublicLeadCandidatesPath(),
      deliveryWorkspacesPath: getRevenueDeliveryWorkspacesPath(),
      approvalDecisionsPath: getRevenueApprovalDecisionsPath(),
      automationIntakesPath: getRevenueAutomationIntakesPath(),
      status: revenueLedgerPersistenceError || revenueDurablePersistenceStatus === "error" ? "warning" : "ok",
      leadsStatus: revenueLeadsPersistenceError ? "warning" : "ok",
      outreachStatus: revenueOutreachPersistenceError ? "warning" : "ok",
      agentRunsStatus: revenueAgentRunsPersistenceError ? "warning" : "ok",
      automationOpportunitiesStatus: revenueAutomationOpportunitiesPersistenceError ? "warning" : "ok",
      websiteOpportunitiesStatus: revenueWebsiteOpportunitiesPersistenceError ? "warning" : "ok",
      improvementReviewsStatus: revenueImprovementReviewsPersistenceError ? "warning" : "ok",
      scoutingMissionsStatus: revenueScoutingMissionsPersistenceError ? "warning" : "ok",
      dailyScoutSprintsStatus: revenueDailyScoutSprintsPersistenceError ? "warning" : "ok",
      publicLeadCandidatesStatus: revenuePublicLeadCandidatesPersistenceError ? "warning" : "ok",
      deliveryWorkspacesStatus: revenueDeliveryWorkspacesPersistenceError ? "warning" : "ok",
      approvalDecisionsStatus: revenueApprovalDecisionsPersistenceError ? "warning" : "ok",
      automationIntakesStatus: revenueAutomationIntakesPersistenceError ? "warning" : "ok",
      error:
        revenueLedgerPersistenceError ||
        revenueLeadsPersistenceError ||
        revenueOutreachPersistenceError ||
        revenueAgentRunsPersistenceError ||
        revenueAutomationOpportunitiesPersistenceError ||
        revenueWebsiteOpportunitiesPersistenceError ||
        revenueImprovementReviewsPersistenceError ||
        revenueScoutingMissionsPersistenceError ||
        revenueDailyScoutSprintsPersistenceError ||
        revenuePublicLeadCandidatesPersistenceError ||
        revenueDeliveryWorkspacesPersistenceError ||
        revenueApprovalDecisionsPersistenceError ||
        revenueAutomationIntakesPersistenceError ||
        revenueDurablePersistenceError,
    },
    automationQuoteDefaults: {
      minimumSetupUsd: 1500,
      minimumRetainerUsd: 300,
      maxInternalMonthlyCostUsd: 100,
      requiredDepositPercent: 50,
      defaultApprovalMode: "draft_until_signed_and_deposit_paid",
    },
    improvementDefaults: {
      reviewCadence: "weekly",
      minimumGrossMarginPercent: 65,
      maxMonthlySpendBeforeRevenueUsd: 100,
      stopRule: "Pausar campana si el gasto llega a $100 sin ingresos cobrados o si defectos/quejas bloquean entrega.",
      learningMode: "update_playbook_after_each_batch",
    },
  };
}

function qualifyRevenueLead(lead: RevenueLeadInput) {
  const hasEvidence = lead.evidence.trim().length >= 12;
  const hasContact = lead.contactChannel !== "unknown" && lead.contactValue.trim().length >= 3;
  const websiteScore = lead.websiteStatus === "no_website" ? 35 : lead.websiteStatus === "weak_website" ? 25 : lead.websiteStatus === "unknown" ? 10 : 0;
  const contactScore = hasContact ? 25 : 0;
  const evidenceScore = hasEvidence ? 20 : 0;
  const painScore = lead.painPoint.trim().length >= 8 ? 10 : 0;
  const ticketScore = lead.estimatedOfferUsd >= 1500 ? 10 : 0;
  const score = websiteScore + contactScore + evidenceScore + painScore + ticketScore;
  const missing = [
    !hasEvidence && "evidencia publica revisable",
    !hasContact && "contacto verificable",
    lead.websiteStatus === "unknown" && "confirmar si tiene website",
    lead.estimatedOfferUsd < 1500 && "oferta minima rentable",
  ].filter(Boolean) as string[];
  const recommendedStatus: RevenueLead["status"] =
    missing.length > 0
      ? "research"
      : score >= 80
        ? "mockup_ready"
        : score >= 65
          ? "qualified"
          : "research";

  return {
    score,
    grade: score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : "D",
    recommendedStatus,
    missing,
    nextAgent:
      recommendedStatus === "mockup_ready"
        ? "mockup-builder"
        : recommendedStatus === "qualified"
          ? "business-researcher"
          : "lead-scout",
    guardrail:
      missing.length > 0
        ? "No contactar todavia. Completar evidencia/contacto primero."
        : "Puede avanzar a mockup o propuesta en draft, sin envio externo hasta aprobacion.",
    outreachDraft:
      `Vi que ${lead.businessName} en ${lead.area} podria convertir mas clientes con una presencia web y automatizaciones mas fuertes. Puedo preparar un mockup rapido basado en informacion publica y mostrarte una version premium sin compromiso.`,
  };
}

function revenueBatchCell(value: unknown) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "/")
    .trim();
}

function revenueCandidateBatchRow(candidate: RevenuePublicLeadCandidateInput) {
  return [
    candidate.businessName,
    candidate.area,
    candidate.niche,
    candidate.websiteStatus,
    candidate.contactChannel,
    candidate.contactValue,
    candidate.sourceUrl,
    candidate.recipientEmail,
    candidate.evidence,
    candidate.painPoint,
    candidate.estimatedOfferUsd,
    candidate.contactName,
    candidate.businessSummary,
  ].map(revenueBatchCell).join("|");
}

function isRevenuePublicSourceUrl(sourceUrl: string) {
  if (!sourceUrl.trim()) return false;
  try {
    const parsed = new URL(sourceUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (!hostname.includes(".") && !hostname.includes(":")) return false;
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
    if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    if (/^169\.254\./.test(hostname)) return false;
    if (hostname === "0.0.0.0" || hostname === "::1") return false;
    if (/^(fc|fd)[0-9a-f]{2}:/i.test(hostname) || /^fe[89ab][0-9a-f]?:/i.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function revenueEvidenceTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && ![
      "owner",
      "email",
      "public",
      "business",
      "contact",
      "website",
      "example",
      "gmail",
      "yahoo",
      "outlook",
    ].includes(token));
}

function revenueHostMatches(hostname: string, rootHost: string) {
  return hostname === rootHost || hostname.endsWith(`.${rootHost}`);
}

function isRevenueGenericPublicPlatformUrl(hostname: string, pathname: string) {
  const normalizedPath = pathname.toLowerCase();
  if (revenueHostMatches(hostname, "instagram.com")) {
    return /^\/(explore|reels?|p|stories|tags|directory|accounts)\b/.test(normalizedPath)
      || normalizedPath.includes("/explore/");
  }
  if (revenueHostMatches(hostname, "yelp.com")) {
    return /^\/(search|c|biz_photos|collections|events|topic)\b/.test(normalizedPath);
  }
  if (revenueHostMatches(hostname, "linkedin.com")) {
    return /^\/(search|feed|pulse|jobs|learning|groups)\b/.test(normalizedPath);
  }
  if (revenueHostMatches(hostname, "facebook.com")) {
    return /^\/(search|marketplace|groups|events|watch|hashtag)\b/.test(normalizedPath);
  }
  if (revenueHostMatches(hostname, "tripadvisor.com")) {
    return /^\/(Search|Attractions|Restaurants|Hotels)\b/i.test(pathname);
  }
  return false;
}

function revenueSourceUrlMatchesCandidate(input: Pick<RevenuePublicLeadCandidateInput, "businessName" | "contactValue" | "recipientEmail" | "sourceUrl">) {
  if (!isRevenuePublicSourceUrl(input.sourceUrl)) return false;
  const parsed = new URL(input.sourceUrl);
  const hostname = parsed.hostname.toLowerCase();
  const publicPlatformHosts = [
    "instagram.com",
    "facebook.com",
    "maps.google.com",
    "yelp.com",
    "linkedin.com",
    "tripadvisor.com",
    "doordash.com",
    "ubereats.com",
    "square.site",
    "toasttab.com",
    "opentable.com",
    "resy.com",
    "mindbodyonline.com",
  ];
  const isPublicPlatformHost = publicPlatformHosts.some((host) => revenueHostMatches(hostname, host));
  if (!isPublicPlatformHost && publicPlatformHosts.some((host) => hostname.includes(host.replace(".com", "")))) return false;
  if (isPublicPlatformHost && isRevenueGenericPublicPlatformUrl(hostname, parsed.pathname)) return false;

  const sourceText = `${hostname} ${parsed.pathname} ${parsed.search}`.toLowerCase();
  const businessTokens = revenueEvidenceTokens(input.businessName);
  const contactTokens = revenueEvidenceTokens(`${input.contactValue} ${input.recipientEmail}`);
  const matchingBusinessTokens = businessTokens.filter((token) => sourceText.includes(token));
  const contactLocalParts = `${input.contactValue} ${input.recipientEmail}`
    .toLowerCase()
    .match(/[a-z0-9._%+-]+(?=@)/g) || [];
  const contactHandleTokens = contactTokens.filter((token) => token.length >= 6 && sourceText.includes(token));
  return matchingBusinessTokens.length >= 2 || contactLocalParts.some((token) => token.length >= 6 && sourceText.includes(token)) || contactHandleTokens.length > 0;
}

function revenueSourceUrlStrictlyMatchesCandidate(input: Pick<RevenuePublicLeadCandidateInput, "businessName" | "contactValue" | "recipientEmail" | "sourceUrl">) {
  if (!isRevenuePublicSourceUrl(input.sourceUrl)) return false;
  const parsed = new URL(input.sourceUrl);
  const sourceText = `${parsed.hostname} ${parsed.pathname} ${parsed.search}`.toLowerCase();
  const businessTokens = revenueEvidenceTokens(input.businessName);
  const contactTokens = revenueEvidenceTokens(`${input.contactValue} ${input.recipientEmail}`);
  const matchingBusinessTokens = businessTokens.filter((token) => sourceText.includes(token));
  const contactLocalParts = `${input.contactValue} ${input.recipientEmail}`
    .toLowerCase()
    .match(/[a-z0-9._%+-]+(?=@)/g) || [];
  const contactHandleTokens = contactTokens.filter((token) => token.length >= 6 && sourceText.includes(token));
  return matchingBusinessTokens.length >= 2 || contactLocalParts.some((token) => token.length >= 6 && sourceText.includes(token)) || contactHandleTokens.length > 0;
}

function revenueSeedLeadSourceBlocker(input: Pick<RevenueMoneySprintSeedLeadInput, "businessName" | "contactValue" | "recipientEmail" | "sourceUrl">) {
  if (input.sourceUrl.trim().length === 0) return "sourceUrl publico";
  if (!isRevenuePublicSourceUrl(input.sourceUrl)) return "sourceUrl must be public";
  if (!revenueSourceUrlStrictlyMatchesCandidate(input)) return "sourceUrl must match business/contact evidence";
  return "";
}

function isRevenueManualContactChannel(channel: RevenueLeadInput["contactChannel"] | RevenueOutreachDraftInput["channel"]) {
  return channel === "instagram" || channel === "contact_form";
}

function revenueEmailRecipientFromLead(input: Pick<RevenueMoneySprintSeedLeadInput, "contactChannel" | "contactValue" | "recipientEmail">) {
  if (input.recipientEmail.trim().length > 0) return input.recipientEmail;
  return input.contactChannel === "email" && z.string().email().safeParse(input.contactValue.trim()).success
    ? input.contactValue.trim()
    : "";
}

function revenueLeadHasManualContactPath(input: Pick<RevenueMoneySprintSeedLeadInput, "contactChannel" | "contactValue" | "sourceUrl">) {
  return isRevenueManualContactChannel(input.contactChannel)
    && input.contactValue.trim().length >= 3
    && input.sourceUrl.trim().length > 0
    && isRevenuePublicSourceUrl(input.sourceUrl);
}

function revenueLeadHasDraftContactPath(input: Pick<RevenueMoneySprintSeedLeadInput, "contactChannel" | "contactValue" | "sourceUrl" | "recipientEmail">) {
  return revenueEmailRecipientFromLead(input).length > 0 || revenueLeadHasManualContactPath(input);
}

function revenueOutreachDraftHasRecipientPath(input: Pick<RevenueOutreachDraftInput, "channel" | "recipientEmail" | "sourceUrl">) {
  const hasEmail = input.recipientEmail.trim().length > 0;
  const hasManualUrl = isRevenueManualContactChannel(input.channel)
    && Boolean(input.sourceUrl)
    && isRevenuePublicSourceUrl(input.sourceUrl || "");
  return hasEmail || hasManualUrl;
}

function splitRevenuePublicScoutEvidenceBlocks(evidenceText: string) {
  const normalized = evidenceText
    .replace(/\r/g, "")
    .replace(/\n-{3,}\n/g, "\n\n");
  const blocks = normalized
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length > 1) return blocks;

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const grouped: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^(business|business name|negocio|name|nombre)\s*[:=-]/i.test(line) && current.length > 0) {
      grouped.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) grouped.push(current.join("\n"));
  return grouped.length > 0 ? grouped : [evidenceText.trim()];
}

function findRevenueScoutField(block: string, aliases: string[]) {
  const aliasPattern = aliases.map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = block.match(new RegExp(`^(?:${aliasPattern})\\s*[:=-]\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || "";
}

function findRevenueScoutUrl(block: string) {
  const explicit = findRevenueScoutField(block, ["source", "source url", "sourceUrl", "fuente", "url", "link"]);
  const source = explicit || block.match(/https?:\/\/[^\s)]+/i)?.[0] || "";
  return source.replace(/[.,;]+$/g, "");
}

function findRevenueScoutEmail(block: string) {
  return block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

function normalizeRevenueScoutWebsiteStatus(value: string, block: string): RevenueLeadInput["websiteStatus"] {
  const text = `${value} ${block}`.toLowerCase();
  if (/\b(no website|without website|sin website|no dedicated website|no site|no_website)\b/.test(text)) return "no_website";
  if (/\b(weak website|bad website|broken website|outdated website|slow website|website debil|weak_website)\b/.test(text)) return "weak_website";
  if (/\b(has website|existing website|tiene website|has_website)\b/.test(text)) return "has_website";
  return "unknown";
}

function normalizeRevenueScoutContactChannel(value: string, block: string): RevenueLeadInput["contactChannel"] {
  const text = `${value} ${block}`.toLowerCase();
  if (findRevenueScoutEmail(text)) return "email";
  if (/\b(instagram|ig)\b|@[a-z0-9_.]{2,}/i.test(value || block)) return "instagram";
  if (/\b(contact form|formulario)\b/.test(text)) return "contact_form";
  if (/\b(phone|telefono|teléfono)\b|\+?\d[\d\s().-]{7,}/.test(text)) return "phone";
  return "unknown";
}

function normalizeRevenueScoutContactValue(channel: RevenueLeadInput["contactChannel"], value: string, block: string) {
  if (channel === "email") return findRevenueScoutEmail(value) || findRevenueScoutEmail(block);
  if (channel === "instagram") return value.match(/@[A-Za-z0-9_.]{2,}/)?.[0] || block.match(/@[A-Za-z0-9_.]{2,}/)?.[0] || value;
  if (channel === "phone") return value.match(/\+?\d[\d\s().-]{7,}/)?.[0]?.trim() || block.match(/\+?\d[\d\s().-]{7,}/)?.[0]?.trim() || value;
  return value;
}

function normalizeRevenueScoutMoney(value: string, fallback: number) {
  const match = value.match(/\d[\d,]*/);
  if (!match) return fallback;
  const amount = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(amount) && amount >= 1500 ? amount : fallback;
}

function revenuePlaceholderFieldNames(input: Pick<
  RevenuePublicLeadCandidateInput,
  "businessName" | "contactValue" | "sourceUrl" | "recipientEmail" | "evidence" | "painPoint" | "contactName" | "businessSummary"
>) {
  const fields = [
    ["businessName", input.businessName],
    ["contactValue", input.contactValue],
    ["sourceUrl", input.sourceUrl],
    ["recipientEmail", input.recipientEmail],
    ["evidence", input.evidence],
    ["painPoint", input.painPoint],
    ["contactName", input.contactName],
    ["businessSummary", input.businessSummary],
  ] as const;
  const replacementPlaceholderPattern = /\b(?:REPLACE|PLACEHOLDER)[A-Z0-9_\s:-]*\b|replace with specific/i;
  const uppercaseTodoPlaceholderPattern = /\b(?:TODO|TBD)(?:[:\s_-]|$)/;
  return fields
    .filter(([field, value]) => {
      const normalized = value.trim().toLowerCase();
      return replacementPlaceholderPattern.test(value)
        || uppercaseTodoPlaceholderPattern.test(value)
        || (field === "recipientEmail" && normalized === "owner@example.com")
        || (field === "sourceUrl" && /^https?:\/\/replace/i.test(value));
    })
    .map(([field]) => field);
}

function parseRevenuePublicScoutEvidence(input: RevenuePublicScoutEvidenceInput) {
  const parsed = revenuePublicScoutEvidenceSchema.parse(input);
  const blocks = splitRevenuePublicScoutEvidenceBlocks(parsed.evidenceText).slice(0, parsed.maxCandidates);
  const candidates: RevenuePublicLeadCandidateInput[] = [];
  const blockedSeeds: Array<{ businessName: string; reason: string }> = [];

  for (const [index, block] of blocks.entries()) {
    const businessName = findRevenueScoutField(block, ["business", "business name", "negocio", "name", "nombre"]);
    const sourceUrl = findRevenueScoutUrl(block);
    const explicitContact = findRevenueScoutField(block, ["contact", "contact value", "contacto", "email", "instagram", "phone", "telefono", "teléfono"]);
    const contactChannel = normalizeRevenueScoutContactChannel(explicitContact, block);
    const contactValue = normalizeRevenueScoutContactValue(contactChannel, explicitContact, block);
    const recipientEmail = findRevenueScoutField(block, ["recipientEmail", "recipient email", "email", "owner email"]) || findRevenueScoutEmail(block);
    const websiteStatus = normalizeRevenueScoutWebsiteStatus(findRevenueScoutField(block, ["website", "website status", "site", "status"]), block);
    const evidence = findRevenueScoutField(block, ["evidence", "public evidence", "evidencia", "proof"]) || block.split("\n").slice(0, 4).join(" ");
    const painPoint = findRevenueScoutField(block, ["pain", "pain point", "painPoint", "need", "needs", "necesidad"]) || (
      websiteStatus === "no_website" || websiteStatus === "weak_website"
        ? "Needs a stronger website, lead capture and follow-up."
        : "Needs review before a website offer."
    );
    const area = findRevenueScoutField(block, ["area", "city", "ciudad"]) || parsed.area;
    const niche = findRevenueScoutField(block, ["niche", "industry", "industria", "vertical"]) || parsed.niche;
    const contactName = findRevenueScoutField(block, ["contact name", "contactName", "owner", "owner name", "nombre contacto"]) || "Owner";
    const businessSummary = findRevenueScoutField(block, ["summary", "business summary", "resumen"]) || `${businessName || "Candidate"} has public scouting evidence for a website offer.`;
    const estimatedOfferUsd = normalizeRevenueScoutMoney(findRevenueScoutField(block, ["offer", "estimated offer", "price", "precio"]), parsed.defaultOfferUsd);
    const missing = [
      !businessName && "business name",
      !sourceUrl && "sourceUrl publico",
      evidence.trim().length < 12 && "evidencia publica revisable",
      contactChannel === "unknown" && "contacto verificable",
      contactValue.trim().length < 3 && "contact value",
    ].filter(Boolean) as string[];

    if (missing.length > 0) {
      blockedSeeds.push({
        businessName: businessName || `scout-block-${index + 1}`,
        reason: missing.join("; "),
      });
      continue;
    }

    const candidate = {
      businessName,
      area,
      niche,
      websiteStatus,
      contactChannel,
      contactValue,
      sourceUrl,
      recipientEmail,
      evidence,
      painPoint,
      estimatedOfferUsd,
      status: "research" as const,
      contactName,
      businessSummary,
      missionId: parsed.missionId,
      sourceTaskId: `${parsed.sourceTaskId || "scout-evidence"}-${index + 1}`,
      verificationStatus: parsed.verificationStatus,
      publicEvidenceVerified: parsed.publicEvidenceVerified,
      approvalToImport: parsed.approvalToImport,
      approvedByRobert: parsed.approvedByRobert,
      notes: parsed.notes || "Normalized from public scouting evidence intake.",
    };
    const placeholderFields = revenuePlaceholderFieldNames(candidate);
    if (placeholderFields.length > 0) {
      blockedSeeds.push({
        businessName: businessName || `scout-block-${index + 1}`,
        reason: `placeholder fields: ${placeholderFields.join(", ")}`,
      });
      continue;
    }

    candidates.push(candidate);
  }

  return { parsed, candidates, blockedSeeds };
}

export function recordRevenuePublicLeadCandidate(input: RevenuePublicLeadCandidateInput) {
  loadRevenuePublicLeadCandidates();
  const parsed = revenuePublicLeadCandidateSchema.parse(input);
  const qualification = qualifyRevenueLead(parsed);
  const hasDraftContactPath = revenueLeadHasDraftContactPath(parsed);
  const blockedReasons = [
    parsed.verificationStatus === "blocked" && "candidate blocked by scout",
    !parsed.publicEvidenceVerified && "public evidence not verified",
    !parsed.approvalToImport && "approvalToImport false",
    parsed.approvalToImport && !parsed.approvedByRobert && "approvedByRobert false",
    parsed.sourceUrl.trim().length === 0 && "sourceUrl publico",
    parsed.sourceUrl.trim().length > 0 && !isRevenuePublicSourceUrl(parsed.sourceUrl) && "sourceUrl must be public",
    parsed.sourceUrl.trim().length > 0 && isRevenuePublicSourceUrl(parsed.sourceUrl) && !revenueSourceUrlMatchesCandidate(parsed) && "sourceUrl must match business/contact evidence",
    !hasDraftContactPath && "recipientEmail or manual contact URL",
    ...revenuePlaceholderFieldNames(parsed).map((field) => `placeholder ${field}`),
    ...qualification.missing,
  ].filter((item): item is string => Boolean(item));
  const importReady = parsed.verificationStatus === "verified_public" && blockedReasons.length === 0;
  const now = new Date().toISOString();
  const existingIndex = revenuePublicLeadCandidates.findIndex((candidate) =>
    candidate.businessName.toLowerCase() === parsed.businessName.toLowerCase()
    && candidate.area.toLowerCase() === parsed.area.toLowerCase()
    && (
      candidate.contactValue.toLowerCase() === parsed.contactValue.toLowerCase()
      || (candidate.sourceUrl.trim().length > 0 && candidate.sourceUrl.toLowerCase() === parsed.sourceUrl.toLowerCase())
    ),
  );
  const candidate: RevenuePublicLeadCandidate = {
    ...parsed,
    id: existingIndex >= 0 ? revenuePublicLeadCandidates[existingIndex].id : `candidate-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: existingIndex >= 0 ? revenuePublicLeadCandidates[existingIndex].createdAt : now,
    updatedAt: now,
    qualification,
    importReady,
    blockedReasons,
    batchRow: revenueCandidateBatchRow(parsed),
    safety: {
      allowedAction: "record_public_candidate_for_preview",
      blockedActions: ["automated scraping", "contact business", "buy data", "send outreach", "publish preview"],
      persistsLead: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
    },
  };

  if (existingIndex >= 0) {
    revenuePublicLeadCandidates.splice(existingIndex, 1, candidate);
  } else {
    revenuePublicLeadCandidates.push(candidate);
  }
  persistRevenuePublicLeadCandidates();

  return {
    status: candidate.importReady ? "ready_for_preview" as const : "needs_review" as const,
    candidate,
    importBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      ...(candidate.importReady ? [candidate.batchRow] : []),
    ].join("\n"),
    importableCount: candidate.importReady ? 1 : 0,
    nextAction: candidate.importReady
      ? "Paste this candidate row into Batch leads and run Preview batch before Money sprint."
      : `Fix before import: ${blockedReasons.join("; ") || "review candidate"}.`,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function recordRevenuePublicLeadCandidateBatch(input: RevenuePublicLeadCandidateBatchInput) {
  const parsed = revenuePublicLeadCandidateBatchSchema.parse(input);
  const parsedBatch = parseRevenueMoneySprintSeedLeadBatch(parsed.batchText, { area: parsed.area, niche: parsed.niche });
  const recorded: Array<ReturnType<typeof recordRevenuePublicLeadCandidate>> = [];

  for (const [index, seed] of parsedBatch.seedLeads.entries()) {
    recorded.push(recordRevenuePublicLeadCandidate({
      ...seed,
      missionId: parsed.missionId,
      sourceTaskId: parsed.sourceTaskId ? `${parsed.sourceTaskId}-${index + 1}` : `batch-import-${index + 1}`,
      verificationStatus: parsed.verificationStatus,
      publicEvidenceVerified: parsed.publicEvidenceVerified,
      approvalToImport: parsed.approvalToImport,
      approvedByRobert: parsed.approvedByRobert,
      notes: parsed.notes || "Recorded from public candidate batch.",
    }));
  }

  return {
    status: recorded.some((item) => item.status === "ready_for_preview")
      ? "ready_for_preview" as const
      : parsedBatch.blockedSeeds.length > 0 || recorded.length > 0
        ? "needs_review" as const
        : "empty" as const,
    recordedCount: recorded.length,
    importableCount: recorded.filter((item) => item.candidate.importReady).length,
    blockedCount: parsedBatch.blockedSeeds.length + recorded.filter((item) => !item.candidate.importReady).length,
    recorded: recorded.map((item) => ({
      status: item.status,
      candidate: item.candidate,
      nextAction: item.nextAction,
    })),
    blockedSeeds: [
      ...parsedBatch.blockedSeeds,
      ...recorded
        .filter((item) => !item.candidate.importReady)
        .map((item) => ({
          businessName: item.candidate.businessName,
          reason: item.candidate.blockedReasons.join("; ") || "candidate needs review",
        })),
    ],
    safety: {
      persistsCandidates: recorded.length > 0,
      persistsLeads: false,
      sendsOutreach: false,
      spendsMoney: false,
      writesPreviewFiles: false,
      requiresPublicEvidence: true,
      blockedActions: ["automated scraping", "send outreach", "buy data", "publish preview", "deploy website"],
    },
    nextAction: recorded.some((item) => item.candidate.importReady)
      ? "Review publicLeadImportQueue, then run Money Sprint with verified candidates."
      : "Fix blocked rows or approve verified public evidence before Money Sprint.",
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function approveRevenuePublicLeadCandidate(input: RevenuePublicLeadCandidateApproveInput) {
  loadRevenuePublicLeadCandidates();
  const parsed = revenuePublicLeadCandidateApproveSchema.parse(input);
  const candidate = revenuePublicLeadCandidates.find((item) => item.id === parsed.candidateId) || null;

  if (!candidate) {
    return {
      status: "not_found" as const,
      reason: "Candidato publico no encontrado.",
      candidate: null,
      importableCount: 0,
      safety: {
        persistsCandidates: false,
        persistsLeads: false,
        sendsOutreach: false,
        spendsMoney: false,
        writesPreviewFiles: false,
      },
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const result = recordRevenuePublicLeadCandidate({
    businessName: candidate.businessName,
    area: candidate.area,
    niche: candidate.niche,
    websiteStatus: candidate.websiteStatus,
    contactChannel: candidate.contactChannel,
    contactValue: candidate.contactValue,
    sourceUrl: candidate.sourceUrl,
    recipientEmail: candidate.recipientEmail,
    evidence: candidate.evidence,
    painPoint: candidate.painPoint,
    estimatedOfferUsd: candidate.estimatedOfferUsd,
    status: candidate.status,
    contactName: candidate.contactName,
    businessSummary: candidate.businessSummary,
    missionId: candidate.missionId,
    sourceTaskId: candidate.sourceTaskId,
    verificationStatus: "verified_public",
    publicEvidenceVerified: parsed.publicEvidenceVerified,
    approvalToImport: parsed.approvalToImport,
    approvedByRobert: parsed.approvedByRobert,
    notes: parsed.notes,
  });

  return {
    status: result.status === "ready_for_preview" ? "approved" as const : "needs_review" as const,
    reason: result.status === "ready_for_preview"
      ? "Candidato aprobado para Money Sprint; no se creo lead ni outreach."
      : result.nextAction,
    candidate: result.candidate,
    importableCount: result.importableCount,
    importBatchText: result.importBatchText,
    safety: {
      persistsCandidates: true,
      persistsLeads: false,
      sendsOutreach: false,
      spendsMoney: false,
      writesPreviewFiles: false,
    },
    snapshot: result.snapshot,
  };
}

export function recordRevenuePublicScoutEvidence(input: RevenuePublicScoutEvidenceInput) {
  const { parsed, candidates, blockedSeeds } = parseRevenuePublicScoutEvidence(input);
  const recorded = candidates.map((candidate) => recordRevenuePublicLeadCandidate(candidate));
  const uniqueRecorded = Array.from(new Map(recorded.map((item) => [item.candidate.id, item])).values());
  const importReadyCount = uniqueRecorded.filter((item) => item.candidate.importReady).length;
  const blockedCount = blockedSeeds.length + uniqueRecorded.filter((item) => !item.candidate.importReady).length;
  const sprintProgress = recordRevenueDailyScoutSprintEvidenceProgress({
    missionId: parsed.missionId,
    sourceTaskId: parsed.sourceTaskId,
    candidateIds: uniqueRecorded.filter((item) => item.candidate.importReady).map((item) => item.candidate.id),
    area: parsed.area,
    niche: parsed.niche,
    filledCount: importReadyCount,
    rejectedCount: parsed.publicEvidenceVerified && parsed.approvalToImport && parsed.approvedByRobert ? blockedCount : 0,
  });

  return {
    status: importReadyCount > 0
      ? "ready_for_preview" as const
      : blockedSeeds.length > 0 || uniqueRecorded.length > 0
        ? "needs_review" as const
        : "empty" as const,
    normalizedBatchText: [
      parsed.publicEvidenceVerified && parsed.approvalToImport && parsed.approvedByRobert
        ? "# public_candidate_review_gate=approved"
        : "# public_candidate_review_gate=needs_review",
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      ...candidates.map((candidate) => revenueCandidateBatchRow(candidate)),
    ].join("\n"),
    parsedCount: candidates.length + blockedSeeds.length,
    recordedCount: uniqueRecorded.length,
    importableCount: importReadyCount,
    blockedCount,
    sprintProgress,
    recorded: uniqueRecorded.map((item) => ({
      status: item.status,
      candidate: item.candidate,
      nextAction: item.nextAction,
    })),
    blockedSeeds: [
      ...blockedSeeds,
      ...uniqueRecorded
        .filter((item) => !item.candidate.importReady)
        .map((item) => ({
          businessName: item.candidate.businessName,
          reason: item.candidate.blockedReasons.join("; ") || "candidate needs review",
        })),
    ],
    safety: {
      persistsCandidates: uniqueRecorded.length > 0,
      persistsLeads: false,
      sendsOutreach: false,
      spendsMoney: false,
      writesPreviewFiles: false,
      requiresPublicEvidence: true,
      requiresRobertApprovalToImport: true,
      source: "operator_or_subagent_public_evidence",
      blockedActions: ["automated scraping", "send outreach", "buy data", "publish preview", "deploy website"],
    },
    nextAction: uniqueRecorded.some((item) => item.candidate.importReady)
      ? "Run Money Sprint with verified public candidates; do not contact until outreach approval."
      : parsed.publicEvidenceVerified && parsed.approvalToImport && parsed.approvedByRobert
        ? "Fix blocked evidence fields before Money Sprint."
        : "Review normalized candidates, verify public evidence, then Robert must explicitly approve import.",
    snapshot: getRevenueEngineSnapshot(),
  };
}

function revenueVerifiedScoutConnectorEvidenceText(input: RevenueVerifiedScoutConnectorInput) {
  return input.results.map((result, index) => [
    `Business: ${result.businessName}`,
    `Area: ${result.area || input.area}`,
    `Niche: ${result.niche || input.niche}`,
    `Website: ${result.websiteStatus}`,
    `Contact: ${result.contactValue}`,
    result.recipientEmail ? `Email: ${result.recipientEmail}` : null,
    `Source: ${result.sourceUrl}`,
    `Evidence: ${result.evidence}`,
    `Pain: ${result.painPoint}`,
    `Offer: ${result.estimatedOfferUsd}`,
    `Contact name: ${result.contactName || "Owner"}`,
    `Summary: ${result.businessSummary || `${result.businessName} was returned by ${input.connectorName} as public scout result ${index + 1}.`}`,
  ].filter((line): line is string => Boolean(line)).join("\n")).join("\n\n").slice(0, 30000);
}

function revenueVerifiedScoutConnectorSourceTaskId(input: RevenueVerifiedScoutConnectorInput) {
  const base = slugifyRevenueValue(input.sourceTaskId || "verified-scout-connector").slice(0, 80) || "verified-scout-connector";
  const run = slugifyRevenueValue(input.connectorRunId).slice(0, 48) || "run";
  return `${base}-${run}`.slice(0, 150);
}

export function recordRevenueVerifiedScoutConnectorResults(input: RevenueVerifiedScoutConnectorInput) {
  const parsed = revenueVerifiedScoutConnectorSchema.parse(input);
  const evidenceText = revenueVerifiedScoutConnectorEvidenceText(parsed);
  const notes = [
    `Connector: ${parsed.connectorName}`,
    `Run: ${parsed.connectorRunId}`,
    parsed.notes || "Verified scout connector intake; Robert review required before import.",
  ].join(" | ").slice(0, 1000);
  const evidenceResult = recordRevenuePublicScoutEvidence({
    area: parsed.area,
    niche: parsed.niche,
    evidenceText,
    missionId: parsed.missionId,
    sourceTaskId: revenueVerifiedScoutConnectorSourceTaskId(parsed),
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
    approvedByRobert: false,
    defaultOfferUsd: REVENUE_WEBSITE_DEFAULT_USD,
    maxCandidates: parsed.results.length,
    notes,
  });

  return {
    status: evidenceResult.recordedCount > 0 ? "needs_review" as const : evidenceResult.status,
    reason: "Connector results recorded as review-only public candidates; Robert must verify evidence and approve import before Money Sprint.",
    connector: {
      name: parsed.connectorName,
      runId: parsed.connectorRunId,
      resultCount: parsed.results.length,
      executionMode: "verified_connector_review_only" as const,
      approvalLocked: true,
    },
    evidenceResult,
    normalizedBatchText: evidenceResult.normalizedBatchText,
    recordedCount: evidenceResult.recordedCount,
    importableCount: evidenceResult.importableCount,
    blockedCount: evidenceResult.blockedCount,
    safety: {
      persistsCandidates: evidenceResult.safety.persistsCandidates,
      persistsLeads: false,
      sendsOutreach: false,
      spendsMoney: false,
      writesPreviewFiles: false,
      requiresRobertReview: true,
      blockedActions: [
        "mark connector results import-ready",
        "send outreach",
        "buy data",
        "run Money Sprint before Robert approval",
        "publish preview",
        "deploy website",
      ],
    },
    nextAction: "Review connector candidates, verify each public source, then approve import from the public lead review queue.",
    snapshot: evidenceResult.snapshot,
  };
}

export function submitRevenueDailyScoutSprintEvidence(input: RevenueDailyScoutSprintSubmitInput) {
  loadRevenueDailyScoutSprints();
  const parsed = revenueDailyScoutSprintSubmitSchema.parse(input);
  const sprint = revenueDailyScoutSprints.find((item) => item.id === parsed.sprintId) || null;

  if (!sprint) {
    return {
      status: "not_found" as const,
      reason: "Daily scout sprint no encontrado.",
      evidenceResult: null,
      sprintProgress: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const taskId = parsed.taskId || parsed.sourceTaskId || sprint.tasks.find((task) => task.resultSlots.some((slot) => slot.status === "open"))?.taskId || "";
  const task = taskId ? sprint.tasks.find((item) => item.taskId === taskId) || null : null;
  if (!task) {
    return {
      status: "blocked" as const,
      reason: "Task del daily scout sprint no encontrado.",
      evidenceResult: null,
      sprintProgress: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }
  const openSlotCount = task.resultSlots.filter((slot) => slot.status === "open").length;
  if (openSlotCount === 0) {
    return {
      status: "blocked" as const,
      reason: "Task del daily scout sprint no tiene slots abiertos.",
      evidenceResult: null,
      sprintProgress: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const evidenceResult = recordRevenuePublicScoutEvidence({
    ...parsed,
    missionId: parsed.sprintId,
    sourceTaskId: task.taskId,
    maxCandidates: Math.min(parsed.maxCandidates, openSlotCount),
  });

  return {
    status: (evidenceResult.sprintProgress?.newlyFilledSlots || 0) > 0 ? "submitted" as const : "needs_review" as const,
    reason: (evidenceResult.sprintProgress?.newlyFilledSlots || 0) > 0
      ? "Evidencia publica aceptada; slot del sprint marcado como lleno y candidato listo para Money Sprint."
      : evidenceResult.importableCount > 0
        ? "Candidato ya estaba registrado; el sprint no avanzo para evitar duplicar slots."
        : "Evidencia registrada, pero el slot no queda completo hasta tener candidato verificado e importable.",
    evidenceResult,
    sprintProgress: evidenceResult.sprintProgress,
    snapshot: evidenceResult.snapshot,
  };
}

export function runRevenuePublicScoutAgentCommand(input: RevenuePublicScoutAgentCommandInput) {
  const parsed = revenuePublicScoutAgentCommandSchema.parse(input);
  const evidenceResult = recordRevenuePublicScoutEvidence(parsed);
  const readyCandidateIds = evidenceResult.recorded
    .filter((item) => item.candidate.importReady)
    .map((item) => item.candidate.id)
    .slice(0, parsed.maxSprintCandidates);

  if (!parsed.runMoneySprintIfReady) {
    return {
      status: evidenceResult.importableCount > 0 ? "candidates_ready" as const : "needs_review" as const,
      reason: evidenceResult.importableCount > 0
        ? "Public scout evidence normalized into import-ready candidates. Money Sprint was not requested."
        : "Public scout evidence recorded, but candidates need review before Money Sprint.",
      evidenceResult,
      sprintResult: null,
      readyCandidateIds,
      safety: {
        persistsCandidates: evidenceResult.safety.persistsCandidates,
        persistsLeads: false,
        writesPreviewFiles: false,
        sendsOutreach: false,
        spendsMoney: false,
        deploys: false,
        requiresApprovalToContact: true,
        blockedActions: ["automated scraping", "send outreach", "buy data", "publish preview", "deploy website"],
      },
      nextAction: readyCandidateIds.length > 0
        ? "Run Money Sprint from these verified candidates when ready."
        : evidenceResult.nextAction,
      snapshot: evidenceResult.snapshot,
    };
  }

  if (readyCandidateIds.length === 0) {
    return {
      status: "blocked" as const,
      reason: "No import-ready public candidates were created from this evidence.",
      evidenceResult,
      sprintResult: null,
      readyCandidateIds,
      safety: {
        persistsCandidates: evidenceResult.safety.persistsCandidates,
        persistsLeads: false,
        writesPreviewFiles: false,
        sendsOutreach: false,
        spendsMoney: false,
        deploys: false,
        requiresApprovalToContact: true,
        blockedActions: ["automated scraping", "send outreach", "buy data", "publish preview", "deploy website"],
      },
      nextAction: "Fix blocked evidence fields or approve public evidence before running Money Sprint.",
      snapshot: evidenceResult.snapshot,
    };
  }

  const sprintResult = runRevenueMoneySprintFromPublicCandidates({
    area: parsed.area,
    niche: parsed.niche,
    offerFocus: parsed.offerFocus,
    dailyResearchTarget: parsed.dailyResearchTarget,
    dailyQualifiedLeadLimit: parsed.dailyQualifiedLeadLimit,
    dailyMockupLimit: parsed.dailyMockupLimit,
    dailyContactLimit: parsed.dailyContactLimit,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: parsed.requireRobertApprovalToContact,
    writePreviewFiles: parsed.writePreviewFiles,
    candidateIds: readyCandidateIds,
    maxCandidates: parsed.maxSprintCandidates,
  });

  return {
    status: sprintResult.status === "started" ? "sprint_started" as const : "blocked" as const,
    reason: sprintResult.status === "started"
      ? "Public scout evidence became candidates, leads, mockups and draft-only outreach with zero paid spend."
      : sprintResult.reason,
    evidenceResult,
    sprintResult,
    readyCandidateIds,
    safety: {
      persistsCandidates: evidenceResult.safety.persistsCandidates,
      persistsLeads: sprintResult.status === "started",
      writesPreviewFiles: sprintResult.safety.writesPreviewFiles,
      sendsOutreach: false,
      spendsMoney: false,
      deploys: false,
      requiresApprovalToContact: true,
      blockedActions: ["automated scraping", "send outreach", "buy data", "publish preview", "deploy website"],
    },
    nextAction: sprintResult.status === "started"
      ? "Review generated mockups and draft outreach; contact remains manual and approval-gated."
      : "Resolve blocked candidates before rerunning the scout command.",
    snapshot: sprintResult.snapshot,
  };
}

function revenueSeedLeadFromPublicCandidate(candidate: RevenuePublicLeadCandidate): RevenueMoneySprintSeedLeadInput {
  return {
    businessName: candidate.businessName,
    area: candidate.area,
    niche: candidate.niche,
    websiteStatus: candidate.websiteStatus,
    contactChannel: candidate.contactChannel,
    contactValue: candidate.contactValue,
    evidence: candidate.evidence,
    painPoint: candidate.painPoint,
    estimatedOfferUsd: candidate.estimatedOfferUsd,
    status: candidate.status,
    sourceUrl: candidate.sourceUrl,
    recipientEmail: candidate.recipientEmail,
    contactName: candidate.contactName,
    businessSummary: candidate.businessSummary,
  };
}

function buildRevenuePublicCandidateRepairPacket(candidate: RevenuePublicLeadCandidate) {
  const safeCandidate: RevenuePublicLeadCandidateInput = {
    businessName: candidate.businessName,
    area: candidate.area,
    niche: candidate.niche,
    websiteStatus: candidate.websiteStatus === "unknown" ? "weak_website" : candidate.websiteStatus,
    contactChannel: candidate.contactChannel === "unknown" ? "email" : candidate.contactChannel,
    contactValue: candidate.contactValue || "REPLACE_PUBLIC_CONTACT_PATH",
    sourceUrl: candidate.sourceUrl || "https://REPLACE_PUBLIC_SOURCE_URL",
    recipientEmail: candidate.recipientEmail || (candidate.contactChannel === "email" ? candidate.contactValue : ""),
    evidence: candidate.evidence && candidate.evidence.length >= 20
      ? candidate.evidence
      : "REPLACE with public listing/profile evidence: no/weak website signal, recent activity and visible contact path.",
    painPoint: candidate.painPoint && candidate.painPoint.length >= 12
      ? candidate.painPoint
      : "REPLACE with specific website or lead-capture problem.",
    estimatedOfferUsd: candidate.estimatedOfferUsd || 3500,
    status: candidate.status,
    contactName: candidate.contactName || "Owner",
    businessSummary: candidate.businessSummary || `REPLACE with one-sentence public summary for ${candidate.businessName}.`,
    missionId: candidate.missionId,
    sourceTaskId: candidate.sourceTaskId,
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    notes: "Repair blocked candidate after Robert verifies public evidence.",
  };
  const repairBatchRow = revenueCandidateBatchRow(safeCandidate);
  const copyableRepairPacket = [
    `Public candidate repair packet: ${candidate.businessName}`,
    `Candidate: ${candidate.id}`,
    `Blocked reason: ${candidate.blockedReasons.join("; ") || "candidate needs review"}`,
    "",
    "Repair row:",
    "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
    repairBatchRow,
    "",
    "Before import:",
    "- Replace every REPLACE value with real public evidence.",
    "- Verify sourceUrl is public and tied to the business/contact.",
    "- Set publicEvidenceVerified=true and approvalToImport=true only after Robert review.",
    "- Do not contact, buy data, publish preview or create leads until the candidate is importReady.",
  ].join("\n");

  return {
    repairBatchRow,
    copyableRepairPacket,
  };
}

function buildRevenuePublicCandidateApprovalRequest(candidate: RevenuePublicLeadCandidate) {
  return JSON.stringify({
    candidateId: candidate.id,
    approvedByRobert: true,
    publicEvidenceVerified: true,
    approvalToImport: true,
    notes: `Robert verified public evidence and approved ${candidate.businessName} for Money Sprint import. No outreach, lead creation or website build yet.`,
  }, null, 2);
}

function buildRevenuePublicLeadImportQueue(limit = 10): RevenuePublicLeadImportQueue {
  loadRevenuePublicLeadCandidates();
  loadRevenueLeads();

  const existingLeadKeys = new Set(revenueLeads.map((lead) => normalizeRevenueLeadKey(lead)));
  const visibleLimit = Math.max(0, Math.min(25, limit));
  const items: RevenuePublicLeadImportQueue["items"] = [];
  const blocked: RevenuePublicLeadImportQueue["blocked"] = [];

  for (const candidate of revenuePublicLeadCandidates.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const alreadyImported = existingLeadKeys.has(normalizeRevenueLeadKey(candidate));
    if (candidate.importReady && !alreadyImported) {
      items.push({
        candidateId: candidate.id,
        businessName: candidate.businessName,
        area: candidate.area,
        niche: candidate.niche,
        websiteStatus: candidate.websiteStatus,
        contactChannel: candidate.contactChannel,
        sourceUrl: candidate.sourceUrl,
        recipientEmail: candidate.recipientEmail,
        estimatedOfferUsd: candidate.estimatedOfferUsd,
        grade: candidate.qualification.grade,
        score: candidate.qualification.score,
        batchRow: candidate.batchRow,
        copyableApprovalRequest: buildRevenuePublicCandidateApprovalRequest(candidate),
        nextAction: "Correr Money Sprint desde candidatos verificados para crear lead, mockup y draft sin contactar.",
      });
      continue;
    }

    if (!candidate.importReady) {
      const repair = buildRevenuePublicCandidateRepairPacket(candidate);
      blocked.push({
        candidateId: candidate.id,
        businessName: candidate.businessName,
        reason: candidate.blockedReasons.join("; ") || "candidate needs review",
        repairBatchRow: repair.repairBatchRow,
        copyableRepairPacket: repair.copyableRepairPacket,
        copyableApprovalRequest: buildRevenuePublicCandidateApprovalRequest(candidate),
        nextAction: "Verificar fuente publica, contacto y aprobacion antes de importar.",
      });
    }
  }

  const visibleItems = items.slice(0, visibleLimit);
  const visibleBlocked = blocked.slice(0, visibleLimit);
  const readyCandidateIds = visibleItems.map((item) => item.candidateId);
  const firstReadyItem = visibleItems[0];
  const copyableMoneySprintRequest = JSON.stringify({
    area: firstReadyItem?.area || "Miami",
    niche: firstReadyItem?.niche || "restaurants",
    offerFocus: "websites",
    dailyResearchTarget: Math.max(10, readyCandidateIds.length),
    dailyQualifiedLeadLimit: Math.min(Math.max(readyCandidateIds.length, 5), 25),
    dailyMockupLimit: Math.min(Math.max(readyCandidateIds.length, 1), 5),
    dailyContactLimit: 10,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    candidateIds: readyCandidateIds,
    maxCandidates: Math.min(Math.max(readyCandidateIds.length, 1), 25),
  }, null, 2);

  return {
    status: items.length > 0 ? "ready" : blocked.length > 0 ? "needs_review" : "empty",
    readyCount: items.length,
    blockedCount: blocked.length,
    copyableMoneySprintRequest,
    items: visibleItems,
    blocked: visibleBlocked,
    safety: {
      persistsLeadOnlyAfterSprint: true,
      sendsOutreach: false,
      spendsMoney: false,
      requiresPublicEvidence: true,
      blockedActions: ["automated scraping", "send outreach", "buy data", "publish preview", "deploy website"],
    },
    nextAction:
      items.length > 0
        ? "Usar candidatos verificados en Money Sprint para crear mockups y drafts; no envia outreach."
        : blocked.length > 0
          ? "Completar verificacion publica y approvalToImport en candidatos bloqueados."
          : "Guardar candidatos publicos verificados desde el formulario de leads.",
  };
}

export function runRevenueMoneySprintFromPublicCandidates(input: RevenueMoneySprintFromPublicCandidatesInput) {
  loadRevenuePublicLeadCandidates();
  loadRevenueLeads();

  const parsed = revenueMoneySprintFromPublicCandidatesSchema.parse(input);
  if (parsed.maxPaidDataSpendUsd > 0) {
    return {
      status: "needs_spend_approval" as const,
      reason: "Public candidate Money Sprint does not run when paid data spend is requested.",
      importedCandidateIds: [],
      blockedCandidates: [],
      sprint: null,
      safety: {
        persistsData: false,
        writesPreviewFiles: false,
        sendsOutreach: false,
        spendsMoney: false,
      },
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const existingLeadKeys = new Set(revenueLeads.map((lead) => normalizeRevenueLeadKey(lead)));
  const candidateIdFilter = new Set(parsed.candidateIds);
  const candidates = revenuePublicLeadCandidates
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((candidate) => parsed.candidateIds.length === 0 || candidateIdFilter.has(candidate.id));
  const blockedCandidates: Array<{ candidateId: string; businessName: string; reason: string }> = [];
  const selectedSeeds: RevenueMoneySprintSeedLeadInput[] = [];
  const importedCandidateIds: string[] = [];

  for (const candidate of candidates) {
    if (selectedSeeds.length >= parsed.maxCandidates) {
      blockedCandidates.push({ candidateId: candidate.id, businessName: candidate.businessName, reason: "candidate import limit reached" });
      continue;
    }
    if (!candidate.importReady) {
      blockedCandidates.push({
        candidateId: candidate.id,
        businessName: candidate.businessName,
        reason: candidate.blockedReasons.join("; ") || "candidate needs review",
      });
      continue;
    }
    const candidateKey = normalizeRevenueLeadKey(candidate);
    if (existingLeadKeys.has(candidateKey)) {
      blockedCandidates.push({ candidateId: candidate.id, businessName: candidate.businessName, reason: "lead already imported" });
      continue;
    }
    selectedSeeds.push(revenueSeedLeadFromPublicCandidate(candidate));
    importedCandidateIds.push(candidate.id);
    existingLeadKeys.add(candidateKey);
  }

  if (selectedSeeds.length === 0) {
    return {
      status: "blocked" as const,
      reason: blockedCandidates.length > 0 ? "No verified public candidates are ready for Money Sprint." : "No public lead candidates selected.",
      importedCandidateIds,
      blockedCandidates,
      sprint: null,
      safety: {
        persistsData: false,
        writesPreviewFiles: false,
        sendsOutreach: false,
        spendsMoney: false,
      },
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const sprint = runRevenueMoneySprint({
    area: parsed.area,
    niche: parsed.niche,
    offerFocus: parsed.offerFocus,
    dailyResearchTarget: parsed.dailyResearchTarget,
    dailyQualifiedLeadLimit: parsed.dailyQualifiedLeadLimit,
    dailyMockupLimit: parsed.dailyMockupLimit,
    dailyContactLimit: parsed.dailyContactLimit,
    maxPaidDataSpendUsd: parsed.maxPaidDataSpendUsd,
    requireRobertApprovalToContact: parsed.requireRobertApprovalToContact,
    writePreviewFiles: parsed.writePreviewFiles,
    seedLeads: selectedSeeds,
    seedLeadBatchText: "",
  });

  return {
    status: sprint.status === "needs_spend_approval" ? "needs_spend_approval" as const : "started" as const,
    reason: "Money Sprint created leads, mockups and draft-only outreach from verified public candidates.",
    importedCandidateIds,
    blockedCandidates,
    sprint,
    safety: {
      persistsData: true,
      writesPreviewFiles: parsed.writePreviewFiles,
      sendsOutreach: false,
      spendsMoney: parsed.maxPaidDataSpendUsd > 0,
    },
    snapshot: sprint.snapshot,
  };
}

export function buildRevenueMockup(input: RevenueMockupInput) {
  const niche = input.niche.toLowerCase();
  const isFood = includesAny(niche, ["restaurant", "cafe", "coffee", "bar", "bakery", "food"]);
  const isBeauty = includesAny(niche, ["salon", "spa", "beauty", "barber", "nail"]);
  const isFitness = includesAny(niche, ["gym", "fitness", "trainer", "yoga", "pilates"]);
  const isEvents = includesAny(niche, ["event", "club", "music", "venue", "techno"]);
  const accent = isFood ? "emerald" : isBeauty ? "rose" : isFitness ? "sky" : isEvents ? "fuchsia" : "amber";
  const marketPromise = isFood
    ? "convertir visitas en reservas, pedidos y catering"
    : isBeauty
      ? "convertir visitantes en citas y clientes recurrentes"
      : isFitness
        ? "convertir interes en trials, membresias y seguimiento"
        : isEvents
          ? "convertir audiencia en tickets, comunidad y drops"
          : "convertir atencion local en leads, llamadas y ventas";
  const pain = input.painPoint || (input.websiteStatus === "no_website" ? "No hay presencia web clara para convertir clientes." : "La experiencia actual no captura suficiente demanda.");
  const setupUsd = Math.max(1500, input.estimatedOfferUsd);
  const automationUsd = input.includeAutomation ? Math.max(750, Math.round(setupUsd * 0.35)) : 0;
  const totalUsd = setupUsd + automationUsd;
  const estimatedInternalCostUsd = Math.min(100, 18 + (input.includeAutomation ? 36 : 12));

  return {
    input,
    decision: {
      status: input.evidence.trim().length >= 12 ? "mockup_ready" : "needs_evidence",
      guardrail: "Preview interno. No publicar ni enviar al cliente sin QA y aprobacion humana.",
      nextAgent: input.evidence.trim().length >= 12 ? "qa-council" : "business-researcher",
    },
    visualSystem: {
      accent,
      layout: "full-bleed premium operational website",
      motion: "CSS/Three-style depth, floating product/service panels, animated conversion path",
      threeDSceneBrief: [
        `Escena 3D de ${input.businessName} como experiencia premium en ${input.area}.`,
        "Capas: marca al frente, oferta principal al centro, prueba social y CTA con profundidad.",
        "Movimiento lento y elegante; debe sentirse comercial, no decorativo.",
      ],
    },
    copy: {
      eyebrow: `${input.area} ${input.niche}`,
      headline: `${input.businessName} deserves a website that sells while the team works`,
      subheadline: `Una presencia premium para ${marketPromise}, con automatizaciones controladas y costo interno bajo.`,
      primaryCta: isFood ? "Reservar / Ordenar" : isBeauty ? "Agendar cita" : isFitness ? "Book a trial" : isEvents ? "Ver proximos eventos" : "Solicitar quote",
      secondaryCta: "Ver mockup completo",
    },
    sections: [
      {
        id: "hero",
        title: "Hero 3D de conversion",
        goal: "Mostrar marca, oferta y CTA en los primeros segundos.",
        blocks: ["headline", "CTA principal", "panel 3D con oferta", "trust strip"],
      },
      {
        id: "offers",
        title: isFood ? "Menu / ofertas" : isEvents ? "Eventos / drops" : "Servicios principales",
        goal: "Hacer que el cliente entienda que puede comprar, reservar o pedir informacion rapido.",
        blocks: ["cards filtrables", "precio/beneficio", "CTA por item", "tracking de clicks"],
      },
      {
        id: "proof",
        title: "Prueba y autoridad",
        goal: "Usar evidencia publica sin inventar claims.",
        blocks: ["reviews/fotos verificadas", "antes/despues", "ubicacion", "social proof"],
      },
      {
        id: "capture",
        title: "Captura de leads",
        goal: "No perder personas que no compran hoy.",
        blocks: ["form corto", "newsletter/updates", "lead source", "consentimiento opt-in"],
      },
      {
        id: "automation",
        title: "Automatizaciones vendibles",
        goal: "Reducir trabajo manual y mejorar seguimiento.",
        blocks: ["follow-up", "dashboard", "aprobacion humana", "reporte semanal"],
      },
    ],
    automations: input.includeAutomation
      ? [
          "Follow-up automatico a leads nuevos con aprobacion previa.",
          "Reporte semanal: leads, clicks, reservas/interes y costo.",
          "Pipeline simple para contacto, propuesta y cierre.",
          "Alertas cuando un formulario, CTA o checkout falla.",
        ]
      : ["Automation upsell preparado para fase 2."],
    offer: {
      packageName: input.primaryOffer || "Business Website + Automation Sprint",
      setupUsd,
      automationUsd,
      totalUsd,
      depositUsd: Math.round(totalUsd * 0.5),
      estimatedInternalCostUsd,
      insideCostCap: estimatedInternalCostUsd <= 100,
    },
    qa: [
      { agent: "business-researcher", check: "Evidencia publica marcada y sin claims inventados", result: input.evidence.trim().length >= 12 ? "pass" : "review" },
      { agent: "mockup-builder", check: "Hero, secciones, CTA y oferta estan listos para preview", result: "pass" },
      { agent: "automation-architect", check: "Automatizaciones tienen aprobacion humana y bajo costo", result: input.includeAutomation ? "pass" : "review" },
      { agent: "cost-controller", check: "Costo interno estimado bajo $100/mes", result: estimatedInternalCostUsd <= 100 ? "pass" : "block" },
      { agent: "closer", check: "No enviar hasta que Robert apruebe", result: "approval_required" },
    ],
    salesAngle: {
      problem: pain,
      pitch: `Preparamos una version premium de ${input.businessName} para mostrar como podria ${marketPromise}.`,
      comparison: input.websiteStatus === "no_website" ? "Antes: sin website claro. Despues: presencia premium con captura y seguimiento." : "Antes: website debil o poco accionable. Despues: experiencia con CTA, tracking y automatizacion.",
    },
  };
}

function renderRevenueMockupPreviewHtml(mockup: ReturnType<typeof buildRevenueMockup>, standalone = false) {
  const accentMap: Record<string, string> = {
    emerald: "#10b981",
    rose: "#fb7185",
    sky: "#38bdf8",
    fuchsia: "#d946ef",
    amber: "#f59e0b",
  };
  const accent = accentMap[mockup.visualSystem.accent] || accentMap.amber;
  const sections = mockup.sections.slice(0, 3).map((section, index) => `
    <article class="service">
      <span>0${index + 1}</span>
      <h3>${escapeHtml(section.title)}</h3>
      <p>${escapeHtml(section.goal)}</p>
    </article>
  `).join("");
  const qa = mockup.qa.map((check) => `
    <li>
      <strong>${escapeHtml(check.agent)}</strong>
      <span>${escapeHtml(check.result)}</span>
      <small>${escapeHtml(check.check)}</small>
    </li>
  `).join("");
  const automations = mockup.automations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const niche = mockup.input.niche.toLowerCase();
  const isMedical = includesAny(niche, ["medical", "med spa", "clinic", "health", "dental", "aesthetic"]);
  const isFood = includesAny(niche, ["restaurant", "cafe", "coffee", "bar", "bakery", "food"]);
  const experienceCopy = isMedical
    ? {
        kicker: "A clearer patient journey",
        headline: "From first impression to the next appointment.",
        story: "Premium care deserves a calm digital experience.",
        action: "Book",
        actionDetail: "A direct, measurable appointment path.",
        conversion: "Ready for a more confident booking journey?",
      }
    : isFood
      ? {
          kicker: "A clearer guest journey",
          headline: "From first impression to the next order or reservation.",
          story: "A memorable venue deserves a focused digital experience.",
          action: "Order",
          actionDetail: "A direct path to reservations, orders, or inquiries.",
          conversion: "Ready for a more confident guest journey?",
        }
      : {
          kicker: "A clearer customer journey",
          headline: "From first impression to the next inquiry.",
          story: "A strong local business deserves a focused digital experience.",
          action: "Connect",
          actionDetail: "A direct, measurable inquiry path.",
          conversion: "Ready for a more confident customer journey?",
        };
  const threeModuleUrl = "/api/revenue-engine/assets/three.module.js";
  const threeScript = [
    `import * as THREE from '${threeModuleUrl}';`,
    "const canvas=document.querySelector('[data-three-scene=\"revenue-preview\"]');",
    "const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;",
    "try{",
    "const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});",
    "renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;",
    "const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(36,1,.1,100);camera.position.set(0,0,8.4);",
    "const group=new THREE.Group();scene.add(group);",
    `const accent=new THREE.Color('${accent}');const mint=new THREE.Color('#2dd4bf');`,
    "const core=new THREE.Mesh(new THREE.TorusKnotGeometry(1.48,.38,180,28),new THREE.MeshPhysicalMaterial({color:accent,metalness:.2,roughness:.2,clearcoat:1,clearcoatRoughness:.12,transmission:.08}));group.add(core);",
    "const halo=new THREE.Mesh(new THREE.TorusGeometry(2.28,.035,16,180),new THREE.MeshBasicMaterial({color:mint,transparent:true,opacity:.8}));halo.rotation.x=1.08;group.add(halo);",
    "const haloTwo=new THREE.Mesh(new THREE.TorusGeometry(1.94,.018,12,160),new THREE.MeshBasicMaterial({color:0xf3f0e9,transparent:true,opacity:.42}));haloTwo.rotation.set(.28,.8,.3);group.add(haloTwo);",
    "const panelGeometry=new THREE.BoxGeometry(.74,1.62,.08);[-1,0,1].forEach((n)=>{const panel=new THREE.Mesh(panelGeometry,new THREE.MeshPhysicalMaterial({color:n===0?mint:0xf3f0e9,transparent:true,opacity:n===0?.8:.44,roughness:.25,metalness:.05}));panel.position.set(2.55+n*.78,n*.42,-.6+Math.abs(n)*.3);panel.rotation.set(.1+n*.08,-.45+n*.12,n*.08);group.add(panel);});",
    "const points=[];for(let i=0;i<120;i+=1){const a=i*.618;const r=2.8+(i%7)*.08;points.push(Math.cos(a)*r,Math.sin(a*1.7)*1.9,Math.sin(a)*r*.5)}const particles=new THREE.BufferGeometry();particles.setAttribute('position',new THREE.Float32BufferAttribute(points,3));group.add(new THREE.Points(particles,new THREE.PointsMaterial({color:0xf3f0e9,size:.025,transparent:true,opacity:.55})));",
    "scene.add(new THREE.HemisphereLight(0xf3f0e9,0x0b1118,2.4));const key=new THREE.DirectionalLight(accent,5);key.position.set(4,5,6);scene.add(key);const rim=new THREE.PointLight(mint,45,18);rim.position.set(-4,-1,4);scene.add(rim);",
    "const pointer={x:0,y:0};if(!reduceMotion){window.addEventListener('pointermove',(event)=>{pointer.x=(event.clientX/window.innerWidth-.5)*.5;pointer.y=(event.clientY/window.innerHeight-.5)*.35},{passive:true})}",
    "function resize(){const ratio=Math.min(window.devicePixelRatio||1,1.75);const width=Math.max(1,Math.floor(canvas.clientWidth*ratio));const height=Math.max(1,Math.floor(canvas.clientHeight*ratio));if(canvas.width!==width||canvas.height!==height){renderer.setSize(width,height,false);camera.aspect=canvas.clientWidth/canvas.clientHeight;camera.updateProjectionMatrix()}}",
    "function frame(time=0){resize();const t=time*.001;group.position.x=window.innerWidth<860?1.15:2.45;group.position.y=window.innerWidth<860?-.65:.05;group.rotation.x+=(pointer.y-group.rotation.x)*.035;group.rotation.y+=(pointer.x+t*.035-group.rotation.y)*.035;core.rotation.z=t*.11;halo.rotation.z=-t*.07;haloTwo.rotation.z=t*.05;renderer.render(scene,camera);if(!reduceMotion)requestAnimationFrame(frame)}",
    "document.body.classList.add('three-ready');frame();",
    "}catch(error){console.warn('3D preview fallback active',error)}",
  ].join("\n");
  const scriptHash = createHash("sha256").update(threeScript).digest("base64");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="theme-color" content="#090d12" />',
    standalone ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'" />` : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" />`,
    `<title>${escapeHtml(mockup.input.businessName)} Revenue Mockup</title>`,
    "<style>",
    ":root{color-scheme:dark;--accent:" + accent + ";--mint:#2dd4bf;--ink:#090d12;--paper:#f3f0e9;--muted:#aab4bf;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
    "*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--ink);color:#f8fafc}button,a{font:inherit}main{min-height:100vh;overflow:hidden}",
    ".hero{position:relative;isolation:isolate;min-height:92vh;display:flex;align-items:center;padding:clamp(88px,10vw,148px) clamp(20px,7vw,112px) 76px;background:#090d12}",
    ".scene{position:absolute;inset:0;z-index:-2;width:100%;height:100%;opacity:0;transition:opacity .8s ease}.three-ready .scene{opacity:1}.scene-fallback{position:absolute;inset:0;z-index:-3;overflow:hidden;background:linear-gradient(115deg,#090d12 0 45%,#16212a 100%)}.scene-fallback:before,.scene-fallback:after{content:'';position:absolute;right:8%;top:16%;width:min(42vw,520px);aspect-ratio:1;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);transform:rotate(24deg);border-radius:36% 64% 58% 42%}.scene-fallback:after{right:15%;top:26%;width:min(29vw,360px);border-color:color-mix(in srgb,var(--mint) 52%,transparent);transform:rotate(-18deg)}.three-ready .scene-fallback{opacity:0}",
    ".hero-copy{width:min(680px,62vw);position:relative;z-index:2}.eyebrow{display:flex;align-items:center;gap:10px;color:var(--mint);font-size:12px;font-weight:800;text-transform:uppercase}.eyebrow:before{content:'';width:34px;height:1px;background:var(--mint)}.hero h1{font-family:Georgia,'Times New Roman',serif;font-size:clamp(48px,7.5vw,112px);font-weight:500;line-height:.91;margin:18px 0 24px;letter-spacing:0}.hero h1 em{display:block;color:var(--accent);font-style:italic}.lede{max-width:590px;color:#cbd5df;font-size:clamp(17px,2vw,22px);line-height:1.55}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:32px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;border:1px solid #53606d;border-radius:6px;padding:0 19px;color:#f8fafc;text-decoration:none;font-weight:800}.btn.primary{background:var(--accent);border-color:var(--accent);color:#080c10}.trust{position:absolute;left:clamp(20px,7vw,112px);right:clamp(20px,7vw,112px);bottom:24px;display:flex;gap:26px;justify-content:space-between;border-top:1px solid #34404a;padding-top:16px;color:#9da9b4;font-size:12px;text-transform:uppercase}.trust strong{color:#fff;font-weight:800}",
    ".services{background:var(--paper);color:#111827;padding:80px clamp(20px,7vw,112px)}.section-kicker{color:#b4235a;font-size:12px;font-weight:900;text-transform:uppercase}.services h2,.story h2{font-family:Georgia,'Times New Roman',serif;font-size:clamp(38px,5vw,68px);font-weight:500;line-height:1.02;max-width:820px;margin:12px 0 44px}.service-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid #b8bec3}.service{padding:28px 28px 28px 0;border-bottom:1px solid #b8bec3}.service+ .service{padding-left:28px;border-left:1px solid #b8bec3}.service span{color:#b4235a;font-weight:900}.service h3{font-size:22px;margin:22px 0 10px}.service p{color:#52606d;line-height:1.65;margin:0}",
    ".story{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.75fr);gap:8vw;align-items:center;padding:96px clamp(20px,7vw,112px);background:#13202a}.story p{color:#bac5cf;line-height:1.8}.signal{border-left:3px solid var(--mint);padding:8px 0 8px 22px;font-size:18px}.path{display:grid;gap:1px;background:#34404a}.path div{background:#0d151c;padding:24px}.path strong{display:block;color:var(--mint);margin-bottom:7px}.path span{color:#b8c2cc}",
    ".conversion{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:center;padding:68px clamp(20px,7vw,112px);background:var(--accent);color:#090d12}.conversion h2{font-family:Georgia,'Times New Roman',serif;font-size:clamp(34px,5vw,64px);font-weight:500;line-height:1;margin:0}.conversion .btn{border-color:#090d12;color:#090d12}.internal{padding:60px clamp(20px,7vw,112px);background:#090d12}.internal-head{display:flex;justify-content:space-between;gap:20px;align-items:end}.price{font-size:36px;font-weight:900;color:var(--accent)}.note{color:#94a3b8;font-size:13px;line-height:1.5}.qa{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#2a3540;padding:1px;list-style:none;margin-top:24px}.qa li{background:#101820;padding:17px}.qa strong,.qa span,.qa small{display:block}.qa span{color:var(--mint);font-weight:900}.qa small{color:#a9b4be;margin-top:6px;line-height:1.45}.automation-list{columns:2;column-gap:34px;color:#bac5cf;line-height:1.65}",
    "@media(max-width:860px){.hero{min-height:88vh;padding-top:100px;align-items:flex-start}.hero-copy{width:100%}.hero h1{font-size:clamp(46px,15vw,72px);max-width:12ch}.trust{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}.service-grid,.story,.conversion{grid-template-columns:1fr}.service+ .service{padding-left:0;border-left:0}.story{gap:42px}.qa{grid-template-columns:1fr}.automation-list{columns:1}.scene{transform:translateX(22%)}.conversion .btn{width:100%}}",
    "@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.scene{transition:none}.btn{transition:none}}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    '<section class="hero">',
    '<canvas class="scene" data-three-scene="revenue-preview" aria-hidden="true"></canvas>',
    '<div class="scene-fallback" aria-hidden="true"></div>',
    '<div class="hero-copy">',
    `<div class="eyebrow">${escapeHtml(mockup.copy.eyebrow)}</div>`,
    `<h1>${escapeHtml(mockup.input.businessName)}<em>reimagined.</em></h1>`,
    `<p class="lede">${escapeHtml(mockup.copy.subheadline)}</p>`,
    '<div class="actions">',
    `<a class="btn primary" href="#services">${escapeHtml(mockup.copy.primaryCta)}</a>`,
    '<a class="btn" href="#story">Explore the experience</a>',
    "</div>",
    "</div>",
    '<div class="trust">',
    '<span><strong>01</strong> Clear discovery</span>',
    '<span><strong>02</strong> Confident booking</span>',
    '<span><strong>03</strong> Human follow-up</span>',
    '<span><strong>04</strong> Measurable demand</span>',
    "</div>",
    "</section>",
    '<section class="services" id="services">',
    `<p class="section-kicker">${experienceCopy.kicker}</p>`,
    `<h2>${experienceCopy.headline}</h2>`,
    `<div class="service-grid">${sections}</div>`,
    '</section>',
    '<section class="story" id="story">',
    '<div>',
    '<p class="section-kicker">Concept direction</p>',
    `<h2>${experienceCopy.story}</h2>`,
    `<p class="signal">${escapeHtml(mockup.salesAngle.problem)}</p>`,
    `<p>${escapeHtml(mockup.salesAngle.pitch)} This concept uses only public evidence and avoids unverified performance or medical claims.</p>`,
    "</div>",
    '<div class="path">',
    '<div><strong>Discover</strong><span>Focused services and clear next steps.</span></div>',
    '<div><strong>Decide</strong><span>Useful context without unnecessary friction.</span></div>',
    `<div><strong>${experienceCopy.action}</strong><span>${experienceCopy.actionDetail}</span></div>`,
    "</div>",
    "</section>",
    '<section class="conversion">',
    `<h2>${experienceCopy.conversion}</h2>`,
    `<a class="btn" href="#internal">${escapeHtml(mockup.copy.primaryCta)}</a>`,
    "</section>",
    '<section class="internal" id="internal">',
    '<div class="internal-head"><div><p class="section-kicker">Private owner review</p><h2>Commercial package and QA</h2></div>',
    `<div class="price">$${mockup.offer.totalUsd.toLocaleString("en-US")}</div></div>`,
    `<p class="note">${escapeHtml(mockup.decision.guardrail)}</p>`,
    `<ul class="automation-list">${automations}</ul>`,
    '<h3>QA gates before contact</h3>',
    standalone ? `<p class="note">Concepto interno generado. Revision visual y validacion comercial pendientes; no acredita aprobacion, resultados ni publicacion.</p>` : `<ul class="qa">${qa}</ul>`,
    "</section>",
    "</main>",
    standalone ? "" : `<script type="module">${threeScript}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

export function buildRevenueMockupPreview(input: RevenueMockupInput, options: { writeFile?: boolean; standalone?: boolean } = {}) {
  const parsed = revenueMockupSchema.parse(input);
  const mockup = buildRevenueMockup(parsed);
  const slug = `${slugifyRevenueValue(parsed.businessName)}-${slugifyRevenueValue(parsed.area)}-${Date.now()}`;
  const previewDir = path.join(getRevenueMockupsDir(), slug);
  const previewPath = path.join(previewDir, "index.html");
  const html = renderRevenueMockupPreviewHtml(mockup, options.standalone === true);
  const shouldWrite = options.writeFile !== false;

  if (shouldWrite) {
    fs.mkdirSync(previewDir, { recursive: true });
    fs.writeFileSync(previewPath, html, "utf8");
  }

  return {
    status: mockup.decision.status,
    slug,
    previewUrl: `/api/revenue-engine/mockup-previews/${slug}`,
    fileWritten: shouldWrite,
    ...(options.standalone ? { html } : {}),
    htmlBytes: Buffer.byteLength(html, "utf8"),
    mockup,
    guardrails: [
      "Preview local solamente; no publicar ni enviar sin aprobacion humana.",
      "No usa claims privados ni datos inventados.",
      "No requiere hosting pagado antes de deposito.",
    ],
    nextAction:
      mockup.decision.status === "mockup_ready"
        ? "Revisar preview, crear outreach draft y pedir aprobacion antes de contactar."
        : "Completar evidencia publica antes de usar el preview en ventas.",
  };
}

export function extractRevenueMockupContentSecurityPolicy(html: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const attributes = new Map<string, string>();
    const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    for (const match of tag.matchAll(attributePattern)) {
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    }
    if (attributes.get("http-equiv")?.toLowerCase() === "content-security-policy") {
      return attributes.get("content") || null;
    }
  }
  return null;
}

export function getRevenueMockupPreviewPath(slug: string) {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    throw new Error("Invalid mockup preview slug.");
  }
  const root = path.resolve(getRevenueMockupsDir());
  const previewPath = path.resolve(root, slug, "index.html");
  if (!previewPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid mockup preview path.");
  }
  return previewPath;
}

export function buildRevenueMockupTemplatePack(input: RevenueMockupTemplatePackInput) {
  const monthlyCostCapUsd = 100;
  const dailyAiCostUsd = roundMoney(input.dailyMockupTarget * input.estimatedAiCostPerMockupUsd);
  const monthlyAiCostUsd = roundMoney(dailyAiCostUsd * 30);
  const productionMinutesPerDay = input.dailyMockupTarget * input.maxCustomMinutesPerMockup;
  const isZeroCostMode = input.estimatedAiCostPerMockupUsd === 0;
  const isInsideMonthlyCap = monthlyAiCostUsd <= monthlyCostCapUsd;
  const nicheLabel = input.niche.toLowerCase();
  const isBeauty = includesAny(nicheLabel, ["spa", "salon", "beauty", "nail", "aesthetic"]);
  const isFitness = includesAny(nicheLabel, ["gym", "fitness", "trainer", "pilates", "yoga"]);
  const isFood = includesAny(nicheLabel, ["restaurant", "cafe", "coffee", "bar", "bakery", "food"]);
  const isEvents = includesAny(nicheLabel, ["event", "club", "venue", "music", "nightlife"]);
  const primaryCta = isBeauty
    ? "Book my consult"
    : isFitness
      ? "Claim a trial"
      : isFood
        ? "Reserve / order"
        : isEvents
          ? "Get tickets"
          : "Request quote";

  const sharedSwapFields = [
    "businessName",
    "area",
    "primaryOffer",
    "public photos or free image placeholders",
    "reviews/social proof",
    "contact CTA",
  ];

  const templates = [
    {
      id: "shock_hero_booking",
      name: "Shock Hero + Booking",
      bestFor: "Leads sin website o con presencia muy vieja que necesitan impacto inmediato.",
      blocks: ["full-bleed cinematic hero", "sticky booking CTA", "floating service cards", "trust strip", "fast quote form"],
      swapFields: sharedSwapFields,
      animationHooks: ["mouse spotlight", "floating 3D device", "scroll reveal", "CTA shine"],
      assetPolicy: "Usar fotos publicas verificables del negocio si existen; si no, placeholders gratuitos sin claims falsos.",
      automationUpsell: "Booking follow-up + owner alert + weekly lead report.",
      qualityGate: "Debe verse premium en mobile primero y tener CTA visible sin scroll.",
    },
    {
      id: "before_after_revenue",
      name: "Before / After Revenue Story",
      bestFor: "Negocios con website debil donde conviene mostrar transformacion clara.",
      blocks: ["before/after split", "lost revenue callouts", "upgrade path", "proof panel", "proposal CTA"],
      swapFields: [...sharedSwapFields, "current website weakness", "new conversion promise"],
      animationHooks: ["before/after slider", "metric counters", "depth cards", "section parallax"],
      assetPolicy: "Capturas del website actual solo como referencia interna; no publicar comparativas agresivas sin aprobacion.",
      automationUpsell: "Lead source tracking + abandoned inquiry follow-up.",
      qualityGate: "Debe explicar el dinero perdido sin sonar ofensivo para el owner.",
    },
    {
      id: "owner_dashboard",
      name: "Owner Dashboard Demo",
      bestFor: "Owners que compran cuando ven control, reportes y automatizacion.",
      blocks: ["premium site preview", "lead pipeline", "weekly report", "approval queue", "ROI panel"],
      swapFields: [...sharedSwapFields, "lead sources", "sales stages", "weekly KPI names"],
      animationHooks: ["live dashboard pulse", "pipeline movement", "approval queue highlight", "chart counters"],
      assetPolicy: "Datos demo claramente marcados como estimados; no inventar volumen real.",
      automationUpsell: "Dashboard mensual + CRM ligero + follow-up aprobado por humano.",
      qualityGate: "Debe vender el retainer mensual, no solo el website.",
    },
    {
      id: "premium_offer_stack",
      name: "Premium Offer Stack",
      bestFor: "Servicios con paquetes, tratamientos, membresias, menus o tickets.",
      blocks: ["offer grid", "best-seller highlight", "bundles", "FAQ objections", "checkout/contact CTA"],
      swapFields: [...sharedSwapFields, "service list", "price anchors", "bundle names"],
      animationHooks: ["card tilt", "offer hover states", "sticky compare bar", "limited slot ticker"],
      assetPolicy: "Precios como placeholders si no estan publicados; marcar como editable.",
      automationUpsell: "Quote intake + package recommendation + reminder sequence.",
      qualityGate: "Debe hacer facil elegir una opcion en menos de 20 segundos.",
    },
    {
      id: "social_proof_local",
      name: "Local Proof + Community",
      bestFor: "Negocios que viven de reviews, Instagram, eventos, referrals o barrio.",
      blocks: ["review wall", "location strip", "Instagram-style gallery", "map CTA", "referral capture"],
      swapFields: [...sharedSwapFields, "review snippets", "neighborhood", "social links"],
      animationHooks: ["review marquee", "gallery drift", "map pulse", "social proof reveal"],
      assetPolicy: "Solo usar reviews o fotos publicas verificables; si falta data, usar estructura sin nombres reales.",
      automationUpsell: "Review request automation + referral capture + local campaign report.",
      qualityGate: "Debe sentirse local y confiable, no como template generico.",
    },
  ];

  return {
    status: isInsideMonthlyCap ? "ready" : "needs_spend_approval",
    pack: {
      name: `${input.area} ${input.niche} Premium Mockup Pack`,
      niche: input.niche,
      area: input.area,
      templateCount: templates.length,
      targetPositioning: "websites que parecen de alto ticket, producidos con templates reutilizables y costo casi cero",
    },
    costModel: {
      hostingCostUsd: 0,
      paidAssetCostUsd: 0,
      estimatedAiCostPerMockupUsd: input.estimatedAiCostPerMockupUsd,
      dailyAiCostUsd,
      monthlyAiCostUsd,
      targetCostPerMockupUsd: input.estimatedAiCostPerMockupUsd,
      monthlyCostCapUsd,
      insideZeroCostMode: isZeroCostMode,
      insideMonthlyCap: isInsideMonthlyCap,
      spendPolicy: isZeroCostMode
        ? "Modo $0: HTML/CSS/JS, assets gratuitos/publicos y aprobacion humana antes de contactar."
        : "Costo AI visible. No subir volumen si el mes supera el cap o si Robert no aprueba.",
    },
    productionTargets: {
      dailyMockupTarget: input.dailyMockupTarget,
      maxCustomMinutesPerMockup: input.maxCustomMinutesPerMockup,
      productionMinutesPerDay,
      estimatedMockupsPerMonth: input.dailyMockupTarget * 30,
      recommendedContactLimitPerDay: Math.max(3, Math.min(15, Math.floor(input.dailyMockupTarget * 1.25))),
    },
    templates,
    productionLine: [
      { step: "lead-evidence", ownerAgent: "business-researcher", output: "fotos, servicios, reviews, contacto y dolor real" },
      { step: "template-match", ownerAgent: "mockup-builder", output: "elegir 1 de 5 templates segun el negocio" },
      { step: "swap-and-polish", ownerAgent: "mockup-builder", output: "copiar data publica, CTA, fotos y oferta" },
      { step: "premium-motion-pass", ownerAgent: "visual-qa", output: "animaciones, mobile, hero shock y contraste" },
      { step: "sales-draft", ownerAgent: "closer", output: `mensaje con ${primaryCta}, comparacion y aprobacion antes de enviar` },
    ],
    pricingRecommendation: {
      entryMockupWebsiteUsd: 500,
      proWebsiteUsd: 1500,
      automationBundleUsd: 2500,
      monthlyRetainerUsd: 300,
      note: "Vender el entry barato para cerrar rapido; subir con automatizacion, reportes y mantenimiento.",
    },
    guardrails: [
      "No pagar hosting para previews: usar archivo local/static o free tier hasta que paguen.",
      "No comprar assets para demos frios.",
      "No enviar outreach externo sin aprobacion de Robert.",
      "No inventar reviews, resultados, precios reales o certificaciones.",
      "Si monthlyAiCostUsd supera el cap, pausar o pedir aprobacion.",
    ],
    nextActions: [
      `Crear ${templates.length} HTML bases por nicho y reusar para ${input.area}.`,
      `Producir ${input.dailyMockupTarget} mockups/dia maximo con QA visual.`,
      "Contactar solo los mejores leads con mockup listo y mensaje personalizado.",
      "Medir replies, calls booked y cierres para que el sistema mejore el template ganador.",
    ],
  };
}

export function buildRevenueLaunchReadiness(input: RevenueLaunchReadinessInput) {
  const parsed = revenueLaunchReadinessSchema.parse(input);
  const emailProvider = getRevenueEmailProviderStatus();
  const manualContactChannels = ["contact_form", "phone_permission", "gmail_or_mailto_manual"] as const;
  const launchItems: Array<{
    id: string;
    label: string;
    status: "ready" | "pending_allowed" | "blocked";
    evidence: string;
    nextStep: string;
  }> = [
    {
      id: "market",
      label: "Primer mercado decidido",
      status: "ready" as const,
      evidence: `${parsed.niche} en ${parsed.area}.`,
      nextStep: "Mantener el primer sprint enfocado; no abrir mas nichos hasta tener replies.",
    },
    {
      id: "lead_radar",
      label: "Radar de leads 24/7",
      status: "ready" as const,
      evidence: `${parsed.dailyResearchTarget} candidatos/dia, research publico gratis, gasto $0.`,
      nextStep: "Buscar en Google Maps/listings/websites publicos y guardar evidencia.",
    },
    {
      id: "qualification",
      label: "Scoring y pipeline",
      status: "ready" as const,
      evidence: "recordRevenueLead califica no_website/weak_website, contacto, evidencia, dolor y ticket.",
      nextStep: "Registrar solo leads con contacto verificable y oportunidad clara.",
    },
    {
      id: "mockup_factory",
      label: "Fabrica de mockups premium",
      status: "ready" as const,
      evidence: "Template factory tiene 5 rutas premium reutilizables con $0 hosting y $0 assets pagos.",
      nextStep: `Crear ${parsed.dailyMockupTarget} mockups/dia para leads A/B.`,
    },
    {
      id: "manual_outreach",
      label: "Contacto manual aprobado",
      status: "ready" as const,
      evidence: `Canales activos sin email API: ${manualContactChannels.join(", ")}.`,
      nextStep: `Contactar max ${parsed.dailyContactTarget}/dia por contact form, llamada corta o Gmail/mailto manual.`,
    },
    {
      id: "email_sender",
      label: "Correo de negocio/API",
      status: emailProvider.configured && !parsed.emailPending ? "ready" as const : "pending_allowed" as const,
      evidence: emailProvider.configured
        ? `${emailProvider.provider} configurado con ${emailProvider.fromEmail}.`
        : `Pendiente permitido: ${emailProvider.missing.join(" + ") || "sender DNS/proveedor"}.`,
      nextStep: "Dejarlo pendiente por ahora; no bloquea contacto manual ni drafts.",
    },
    {
      id: "sales_offer",
      label: "Oferta y precio",
      status: "ready" as const,
      evidence: "Entry $500, website pro $1,500+, bundle automation $2,500+, retainer $300+/mes.",
      nextStep: "Abrir barato para cerrar rapido y subir con automation/reporting.",
    },
    {
      id: "money_guard",
      label: "Profit Guard",
      status: "ready" as const,
      evidence: "Cap $100/mes, gasto externo bloqueado hasta cash/aprobacion.",
      nextStep: "No pagar data/tools/ads antes de deposito o cash cobrado.",
    },
    {
      id: "delivery",
      label: "Entrega y QA",
      status: "ready" as const,
      evidence: "Delivery workspace bloquea entrega hasta scope, deposito, QA visual/tecnica/automation y rollback.",
      nextStep: "Cuando cierre un deal, crear workspace y entregar solo con QA verde.",
    },
  ];
  const pending = launchItems.filter((item) => item.status === "pending_allowed");
  const blocked = launchItems.filter((item) => item.status === "blocked");
  const ready = launchItems.filter((item) => item.status === "ready").length;

  return {
    status: blocked.length > 0 ? "blocked" as const : "ready_to_start" as const,
    summary: blocked.length > 0
      ? "Hay bloqueos antes de empezar."
      : pending.length === 1 && pending[0].id === "email_sender"
        ? "Listo para empezar a vender; solo falta configurar el correo de negocio/API."
        : "Listo para empezar a vender con contacto manual aprobado.",
    market: {
      area: parsed.area,
      niche: parsed.niche,
      firstSprintDays: 7,
      goal: "conseguir replies, llamadas o primer deposito con costo $0",
    },
    launchScore: Math.round((ready / launchItems.length) * 100),
    ready,
    pendingAllowed: pending.length,
    blocked: blocked.length,
    items: launchItems,
    manualStartPlan: [
      `Dia 1: buscar ${parsed.dailyResearchTarget} candidatos publicos y guardar 20-30 con evidencia.`,
      `Dia 1: seleccionar 10 leads A/B; crear ${parsed.dailyMockupTarget} mockups premium.`,
      `Dia 1-2: preparar ${parsed.dailyContactTarget} drafts personalizados, sin envio automatico.`,
      "Dia 2: contactar por contact form/Gmail manual y llamar solo los mejores para pedir permiso de enviar mockup.",
      "Dia 3-7: registrar replies, objeciones, calls booked y cualquier cash en ledger/improvement review.",
    ],
    todayExecutionPack: {
      status: "ready" as const,
      ownerAgent: "lead-scout",
      mission: `Buscar negocios reales de ${parsed.niche} en ${parsed.area} con senal no_website/weak_website y contacto publico verificable.`,
      copyableAgentCommand: [
        `Find ${Math.min(parsed.dailyResearchTarget, 30)} public ${parsed.niche} leads in ${parsed.area}.`,
        "Use only public sources: Google Maps, public listings, official/social profiles and visible contact pages.",
        `Return the best ${Math.min(parsed.dailyContactTarget, 10)} rows only after checking evidence, contact path and website weakness.`,
        "Do not contact businesses, buy data, scrape at scale, create accounts, spend money or publish previews.",
      ].join(" "),
      runLimits: {
        researchTarget: parsed.dailyResearchTarget,
        maxQualifiedRowsToImport: Math.min(parsed.dailyContactTarget, 10),
        maxMockups: parsed.dailyMockupTarget,
        maxManualContacts: parsed.dailyContactTarget,
        maxPaidSpendUsd: 0,
      },
      sourcePriority: [
        "Google Maps business listing",
        "Official website field or missing website evidence",
        "Public Instagram/Facebook profile with recent activity",
        "Public contact page, email, phone, DM handle or contact form",
      ],
      requiredEvidenceFields: [
        "business",
        "area",
        "niche",
        "website",
        "channel",
        "contact",
        "sourceUrl",
        "recipientEmail",
        "evidence",
        "painPoint",
        "offer",
        "contactName",
        "summary",
      ],
      copyableBatchHeader: "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      nextApiAction: "/api/revenue-engine/money-sprint-preview",
      approvalRequiredBefore: ["outreach send", "paid data", "build start", "deployment"],
    },
    contactScripts: {
      contactForm:
        "Hola, vi que su negocio tiene buena presencia/reviews, pero hay una oportunidad clara de convertir mas citas con una pagina premium y follow-up. Prepare una idea visual rapida. Si te parece, te la puedo mandar para revisarla.",
      phonePermission:
        "Hola, soy Robert. Vi algo puntual que podria mejorar su website/booking y prepare una idea visual corta. No es una llamada de venta larga; solo queria preguntar a que correo o contacto se la puedo mandar.",
      followUp:
        "Te mande una idea visual basada en informacion publica del negocio. Si quieres, puedo dejar una version inicial lista esta semana desde $500 y luego sumarle booking/follow-up.",
    },
    doNotDoYet: [
      "No enviar volumen masivo.",
      "No comprar data, ads, domains extra o herramientas.",
      "No prometer resultados garantizados.",
      "No usar reviews/fotos privadas ni claims inventados.",
      "No entregar nada sin deposito/scope/QA.",
    ],
    emailPending: {
      isPending: !emailProvider.configured || parsed.emailPending,
      providerConfigured: emailProvider.configured,
      missing: emailProvider.missing,
      allowedWhilePending: ["research", "lead scoring", "mockups", "outreach drafts", "contact forms", "manual Gmail/mailto", "phone permission calls"],
    },
  };
}

export function buildRevenueProjectPlan(input: RevenueProjectPlanInput) {
  const parsed = revenueProjectPlanSchema.parse(input);
  const grossMarginUsd = parsed.monthlyRetainerUsd - parsed.estimatedInternalCostUsd;
  const grossMarginPercent = parsed.monthlyRetainerUsd > 0 ? Math.round((grossMarginUsd / parsed.monthlyRetainerUsd) * 100) : 0;
  const missing = [
    !parsed.scopeApproved && "scope aprobado",
    !parsed.depositPaid && "deposito pagado",
    !parsed.publicDataVerified && "data publica verificada",
    parsed.estimatedInternalCostUsd > 100 && "costo interno bajo $100/mes",
    grossMarginPercent < 65 && "margen mensual >= 65%",
  ].filter(Boolean) as string[];
  const status = missing.some((item) => ["deposito pagado", "data publica verificada", "costo interno bajo $100/mes", "margen mensual >= 65%"].includes(item))
    ? "blocked"
    : missing.length > 0
      ? "needs_scope"
      : "ready_to_build";
  const phases = [
    {
      id: "intake",
      name: "Intake y evidencia",
      ownerAgent: "business-researcher",
      days: 1,
      tasks: [
        "Confirmar alcance, precio, timeline y decision maker.",
        "Guardar fuentes publicas usadas para copy, fotos, servicios y claims.",
        "Marcar datos inciertos para aprobacion del cliente.",
      ],
    },
    {
      id: "build",
      name: parsed.projectType === "automation" ? "Build automation" : "Build website",
      ownerAgent: parsed.projectType === "automation" ? "automation-architect" : "mockup-builder",
      days: Math.max(2, Math.min(4, parsed.launchTargetDays - 3)),
      tasks: parsed.projectType === "automation"
        ? [
            "Mapear trigger, datos, aprobaciones y rollback.",
            "Crear flujo minimo rentable con logs y datos de ejemplo.",
            "Preparar dashboard simple para resultados.",
          ]
        : [
            "Construir hero premium, secciones, CTAs y captura de leads.",
            "Crear estructura responsive mobile/desktop.",
            "Conectar tracking basico y formularios en modo prueba.",
          ],
    },
    {
      id: "automation",
      name: "Automation sprint",
      ownerAgent: "automation-architect",
      days: parsed.includesAutomation ? 2 : 0,
      tasks: parsed.includesAutomation
        ? [
            "Configurar follow-up con aprobacion humana antes de mensajes sensibles.",
            "Crear reporte semanal de leads, clicks, reservas/interes y costo.",
            "Definir fallback manual si una integracion falla.",
          ]
        : ["Mantener automation como upsell fase 2."],
    },
    {
      id: "qa",
      name: "QA council",
      ownerAgent: "qa-council",
      days: 1,
      tasks: [
        "Probar mobile, desktop, copy largo, CTAs, links y forms.",
        "Correr pruebas de automatizacion con datos falsos.",
        "Confirmar costo, margen, rollback y aprobacion final de Robert.",
      ],
    },
    {
      id: "handoff",
      name: "Entrega y mejora",
      ownerAgent: "growth-director",
      days: 1,
      tasks: [
        "Entregar demo controlado, checklist y siguientes mejoras.",
        "Registrar venta/gasto en ledger.",
        "Programar review semanal de resultados y objeciones.",
      ],
    },
  ];

  return {
    input: parsed,
    decision: {
      status,
      missing,
      mode: "human_approval_required_for_launch",
      reason:
        status === "ready_to_build"
          ? "Listo para construir con subagentes y QA antes de entregar."
          : status === "needs_scope"
            ? "Puede prepararse internamente, pero falta evidencia/aprobacion antes de build completo."
            : "Bloqueado: no construir, lanzar ni enviar hasta resolver gates criticos.",
    },
    budget: {
      setupUsd: parsed.setupUsd,
      requiredDepositUsd: Math.round(parsed.setupUsd * 0.5),
      monthlyRetainerUsd: parsed.monthlyRetainerUsd,
      estimatedInternalCostUsd: parsed.estimatedInternalCostUsd,
      grossMarginUsd,
      grossMarginPercent,
      insideCostCap: parsed.estimatedInternalCostUsd <= 100,
    },
    phases,
    subagentCorrections: [
      { agent: "business-researcher", corrects: "claims inventados, datos sin fuente, negocio mal entendido" },
      { agent: "mockup-builder", corrects: "CTA flojo, hero generico, layout no vendible, mobile roto" },
      { agent: "automation-architect", corrects: "flujo sin rollback, mensajes sin aprobacion, costo oculto" },
      { agent: "cost-controller", corrects: "gasto sobre $100/mes, margen bajo, tools innecesarias" },
      { agent: "qa-council", corrects: "links/forms rotos, responsive, entrega sin checklist" },
      { agent: "closer", corrects: "propuesta confusa, precio sin deposito, promesas no aprobadas" },
    ],
    deliveryGates: [
      { gate: "scope", passed: parsed.scopeApproved, fix: "Conseguir aprobacion escrita del scope." },
      { gate: "deposit", passed: parsed.depositPaid, fix: "Cobrar deposito antes de construir/lanzar." },
      { gate: "data", passed: parsed.publicDataVerified, fix: "Verificar fuentes publicas y quitar claims dudosos." },
      { gate: "cost", passed: parsed.estimatedInternalCostUsd <= 100, fix: "Reducir herramientas o subir retainer." },
      { gate: "margin", passed: grossMarginPercent >= 65, fix: "Subir precio mensual o recortar alcance." },
    ],
    doneDefinition: [
      "Cliente aprueba scope y deposito.",
      "Website/mockup responsive probado.",
      "Automatizaciones probadas con datos de ejemplo y aprobacion humana.",
      "Rollback/manual fallback documentado.",
      "Ledger actualizado con ingreso, cash y costo.",
      "Review semanal creado para mejorar el sistema.",
    ],
  };
}

function buildAgentWorkOrder(input: RevenueAgentRunInput) {
  const request = input.request.toLowerCase();
  const clarificationGate = buildRevenueClarificationGate({
    request: input.request,
    projectType: input.projectType,
  });
  const wantsAutomation = input.projectType !== "website" || includesAny(request, ["automat", "automation", "follow", "crm", "mensaje", "email", "whatsapp", "lead"]);
  const wantsWebsite = input.projectType !== "automation" || includesAny(request, ["web", "site", "landing", "3d", "seo", "pagina"]);
  const needsContactApproval = ["outreach", "proposal"].includes(input.stage) && !input.approvalToContact;
  const needsBuildApproval = ["production", "delivery"].includes(input.stage) && !input.approvalToBuild;
  const needsSpendApproval = input.estimatedInternalCostUsd > 0 && input.cashCollectedUsd <= 0 && !input.approvalToSpend;
  const insideCap = input.estimatedInternalCostUsd <= 100 && input.monthlyBudgetUsd <= 100;
  const cashProtected = input.estimatedInternalCostUsd <= input.cashCollectedUsd || input.cashCollectedUsd === 0;
  const requiredApprovals = [
    clarificationGate.status === "needs_clarification" && "responder preguntas de aclaracion",
    needsContactApproval && "aprobar contacto externo",
    needsBuildApproval && "aprobar build/entrega",
    needsSpendApproval && "aprobar gasto antes de tener cash cobrado",
    !insideCap && "reducir costo mensual a menos de $100",
  ].filter(Boolean) as string[];
  const status: RevenueAgentRun["status"] = !insideCap ? "blocked" : requiredApprovals.length > 0 ? "approval_required" : "ready";
  const workOrder: RevenueAgentRun["workOrder"] = [
    clarificationGate.status === "needs_clarification" && {
      step: "Preguntas de aclaracion",
      ownerAgent: "growth-director",
      output: `${clarificationGate.minimumAnswer} Preguntas: ${clarificationGate.questions.join(" ")}`,
      approvalRequired: true,
    },
    {
      step: "Research y evidencia",
      ownerAgent: "business-researcher",
      output: `Verificar datos publicos de ${input.businessName}, oferta, canales, pruebas y claims inciertos.`,
      approvalRequired: false,
    },
    wantsWebsite && {
      step: "Mockup website dinamico",
      ownerAgent: "mockup-builder",
      output: "Crear propuesta visual vendible con hero 3D, secciones de conversion, CTA y comparables.",
      approvalRequired: input.stage === "mockup" || input.stage === "outreach",
    },
    wantsAutomation && {
      step: "Arquitectura de automatizacion",
      ownerAgent: "automation-architect",
      output: "Convertir el pedido en flujo, triggers, datos, costos, fallback manual y retainer recomendado.",
      approvalRequired: input.stage === "production" || input.stage === "delivery",
    },
    {
      step: "Oferta y cierre",
      ownerAgent: "closer",
      output: `Preparar precio base de $${input.estimatedOfferUsd.toLocaleString("en-US")}, deposito y mensaje en draft.`,
      approvalRequired: true,
    },
    {
      step: "QA council",
      ownerAgent: "qa-council",
      output: "Revisar evidencia, costo, margen, links, mobile, copy y reglas de no gastar/no enviar sin aprobacion.",
      approvalRequired: false,
    },
  ].filter(Boolean) as RevenueAgentRun["workOrder"];
  const subagentReviews: RevenueAgentRun["subagentReviews"] = [
    {
      agent: "business-researcher",
      verdict: clarificationGate.status === "clear" ? "pass" : "fix",
      correction: clarificationGate.status === "clear" ? "Pedido suficientemente claro para armar plan inicial." : `Pedir contexto: ${clarificationGate.missing.join(", ")}.`,
    },
    {
      agent: "mockup-builder",
      verdict: wantsWebsite ? "pass" : "fix",
      correction: wantsWebsite ? "Debe entregar preview visual y responsive antes de vender build completo." : "No crear website si el pedido es solo automatizacion.",
    },
    {
      agent: "automation-architect",
      verdict: wantsAutomation ? "pass" : "fix",
      correction: wantsAutomation ? "Debe estimar costo mensual y fallback manual antes de activar." : "No prometer automatizacion si el cliente solo pidio website.",
    },
    {
      agent: "cost-controller",
      verdict: insideCap ? "pass" : "block",
      correction: insideCap ? "Costo interno dentro del cap inicial." : "Bloquear: costo mensual o presupuesto supera $100.",
    },
    {
      agent: "closer",
      verdict: input.approvalToContact ? "pass" : "fix",
      correction: input.approvalToContact ? "Puede preparar canal manual aprobado." : "Mantener mensaje en draft hasta aprobacion humana.",
    },
    {
      agent: "qa-council",
      verdict: status === "blocked" ? "block" : requiredApprovals.length > 0 ? "fix" : "pass",
      correction: status === "blocked" ? "No avanzar hasta resolver cap/costo." : requiredApprovals.length > 0 ? "Avanzar solo en tareas internas; no contactar/gastar/construir." : "Listo para ejecutar con gates registrados.",
    },
  ];

  return {
    status,
    clarificationGate,
    budgetGate: {
      monthlyCapUsd: 100,
      insideCap,
      cashProtected,
      allowedSpendUsd: input.cashCollectedUsd > 0 ? Math.min(100, input.cashCollectedUsd, input.monthlyBudgetUsd) : 0,
    },
    workOrder,
    subagentReviews,
    requiredApprovals,
    nextActions:
      status === "blocked"
        ? ["Reducir costo interno/presupuesto a menos de $100.", "Recalcular oferta o subir retainer antes de prometer entrega."]
        : clarificationGate.status === "needs_clarification"
          ? ["Hacer las preguntas de aclaracion al cliente/prospecto.", "No cotizar final ni construir hasta responder el gate.", "Luego rerun del agente con el pedido completo."]
        : requiredApprovals.length > 0
          ? ["Trabajar research/mockup interno.", "Pedir aprobacion humana antes de contacto, gasto o build.", "Guardar draft en Outbox si se va a contactar."]
          : ["Crear mockup/propuesta.", "Registrar contacto aprobado en Outbox.", "Actualizar ledger cuando cobre deposito."],
    mainAgent: {
      agent: "growth-director",
      decision: status,
      reason:
        status === "blocked"
          ? "El costo o presupuesto rompe la regla inicial de menos de $100/mes."
          : clarificationGate.status === "needs_clarification"
            ? "No entiendo suficiente el pedido para prometer alcance, precio final o delivery."
          : requiredApprovals.length > 0
            ? "Puede avanzar internamente, pero requiere aprobaciones antes de acciones externas."
            : "Puede ejecutar la siguiente accion rentable dentro del cap.",
    },
    learningUpdate:
      status === "ready"
        ? `Playbook: ${input.niche} en ${input.area} puede avanzar con ${input.projectType} si mantiene costo <= $100 y cobra deposito.`
        : clarificationGate.status === "needs_clarification"
          ? `Playbook: preguntar primero cuando ${input.niche} en ${input.area} no tenga trigger, accion, datos o resultado claro.`
        : `Playbook: bloquear o pedir aprobacion cuando ${input.niche} en ${input.area} no tenga cash/aprobaciones/costo bajo control.`,
  };
}

export function recordRevenueAgentRun(input: RevenueAgentRunInput) {
  loadRevenueAgentRuns();
  const parsed = revenueAgentRunSchema.parse(input);
  const built = buildAgentWorkOrder(parsed);
  const now = new Date().toISOString();
  const run: RevenueAgentRun = {
    ...parsed,
    id: `agent-run-${Date.now()}-${revenueAgentRuns.length + 1}`,
    createdAt: now,
    updatedAt: now,
    ...built,
  };

  revenueAgentRuns.push(run);
  persistRevenueAgentRuns();

  return {
    run,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function normalizeRevenueLeadKey(input: Pick<RevenueLeadInput, "businessName" | "area" | "contactValue">) {
  return [input.businessName, input.area, input.contactValue || ""]
    .map((item) => item.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

const revenueLeadStatusRank: Record<RevenueLead["status"], number> = {
  research: 1,
  qualified: 2,
  mockup_ready: 3,
  outreach_ready: 4,
  contacted: 5,
  proposal_sent: 6,
  closed: 7,
  disqualified: 0,
};

function strongerRevenueLeadStatus(current: RevenueLead["status"], next: RevenueLead["status"]) {
  if (next === "disqualified") {
    return revenueLeadStatusRank[current] <= revenueLeadStatusRank.mockup_ready ? next : current;
  }
  return revenueLeadStatusRank[next] > revenueLeadStatusRank[current] ? next : current;
}

export function recordRevenueLead(input: RevenueLeadInput) {
  loadRevenueLeads();
  const qualification = qualifyRevenueLead(input);
  const incomingKey = normalizeRevenueLeadKey(input);
  const existing = revenueLeads.find((lead) => normalizeRevenueLeadKey(lead) === incomingKey);

  if (existing) {
    const nextStatus = input.status === "research" ? qualification.recommendedStatus : input.status;
    existing.websiteStatus = input.websiteStatus;
    existing.contactChannel = input.contactChannel;
    existing.contactValue = input.contactValue;
    existing.evidence = input.evidence || existing.evidence;
    existing.painPoint = input.painPoint || existing.painPoint;
    existing.estimatedOfferUsd = Math.max(existing.estimatedOfferUsd, input.estimatedOfferUsd);
    existing.status = strongerRevenueLeadStatus(existing.status, nextStatus);
    existing.updatedAt = new Date().toISOString();
    persistRevenueLeads();

    return {
      lead: existing,
      qualification,
      deduped: true,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const now = new Date().toISOString();
  const lead: RevenueLead = {
    ...input,
    status: input.status === "research" ? qualification.recommendedStatus : input.status,
    id: `lead-${Date.now()}-${revenueLeads.length + 1}`,
    createdAt: now,
    updatedAt: now,
  };

  revenueLeads.push(lead);
  persistRevenueLeads();

  return {
    lead,
    qualification,
    deduped: false,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function syncLeadAfterOutreachDraft(draft: RevenueOutreachDraft) {
  loadRevenueLeads();
  const lead = draft.leadId
    ? revenueLeads.find((item) => item.id === draft.leadId)
    : revenueLeads.find((item) => item.businessName.toLowerCase() === draft.businessName.toLowerCase());

  if (!lead || lead.status === "closed" || lead.status === "proposal_sent") return null;

  lead.status = "outreach_ready";
  lead.updatedAt = new Date().toISOString();
  persistRevenueLeads();
  return lead;
}

export function recordRevenueOutreachDraft(input: RevenueOutreachDraftInput) {
  loadRevenueOutreach();
  const proposal = buildProposalEmail(input);
  const hasRecipient = revenueOutreachDraftHasRecipientPath(input);
  const hasSummary = input.businessSummary.trim().length >= 40;
  const hasSource = Boolean(input.sourceUrl || input.mockupUrl);
  const approved = input.approvalStatus === "approved";
  const qaGates = [
    { gate: "recipient", passed: hasRecipient, fix: "Agregar email valido o sourceUrl publico para Instagram/contact form antes de contactar." },
    { gate: "evidence", passed: hasSummary && hasSource, fix: "Agregar fuente publica o mockup URL y resumen especifico del negocio." },
    { gate: "cost", passed: proposal.pricing.insideCostCap, fix: "Bajar herramientas/costo mensual o subir retainer." },
    { gate: "approval", passed: approved, fix: "Robert debe aprobar el mensaje antes de enviarlo por email, DM o formulario." },
  ];
  const status: RevenueOutreachDraft["status"] = qaGates.some((gate) => !gate.passed && gate.gate !== "approval")
    ? "blocked"
    : approved
      ? "approved"
      : "draft";
  const now = new Date().toISOString();
  const draft: RevenueOutreachDraft = {
    ...input,
    id: `outreach-${Date.now()}-${revenueOutreachDrafts.length + 1}`,
    createdAt: now,
    updatedAt: now,
    status,
    subject: proposal.subject,
    body: proposal.body,
    pricing: proposal.pricing,
    delivery: {
      ...proposal.delivery,
      sendStatus: "not_sent",
      reason:
        status === "approved"
          ? "Aprobado para envio manual. No hay proveedor conectado, usa Gmail/mailto o copia el texto."
          : status === "blocked"
            ? "Bloqueado por QA. Corrige los gates antes de contactar."
            : "Draft guardado. Falta aprobacion humana antes de contactar.",
    },
    links: proposal.links,
    qaGates,
    nextAction:
      status === "approved"
        ? "Abrir Gmail/mailto, revisar una ultima vez y enviar manualmente."
        : status === "blocked"
          ? "Corregir los gates fallidos y volver a guardar el draft."
          : "Revisar copy, confirmar evidencia y aprobar antes de enviar.",
  };

  revenueOutreachDrafts.push(draft);
  persistRevenueOutreach();
  const syncedLead = syncLeadAfterOutreachDraft(draft);

  return {
    draft,
    syncedLead,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function recordRevenueSalesAutopilot(input: RevenueSalesAutopilotInput) {
  const parsed = revenueSalesAutopilotSchema.parse(input);
  const clarificationGate = buildRevenueClarificationGate({
    request: parsed.request,
    projectType: parsed.projectType,
  });
  const sourceBlocker = revenueSeedLeadSourceBlocker(parsed);
  if (sourceBlocker) {
    return {
      status: "blocked" as const,
      guardrail: "Bloqueado por evidencia publica insuficiente; no crear lead, mockup, agent run ni outreach desde una fuente generica.",
      lead: null,
      leadQualification: null,
      clarificationGate,
      mockup: null,
      agentRun: null,
      deliveryReview: null,
      outreachDraft: null,
      requiredBeforeExternalAction: [sourceBlocker],
      nextActions: ["Reemplazar sourceUrl con una fuente publica que coincida con el negocio/contacto.", "Volver a correr Sales Autopilot solo con evidencia verificable."],
      snapshot: getRevenueEngineSnapshot(),
    };
  }
  const leadResult = recordRevenueLead({
    businessName: parsed.businessName,
    area: parsed.area,
    niche: parsed.niche,
    websiteStatus: parsed.websiteStatus,
    contactChannel: parsed.contactChannel,
    contactValue: parsed.contactValue,
    evidence: parsed.evidence,
    painPoint: parsed.painPoint,
    estimatedOfferUsd: parsed.estimatedOfferUsd,
    status: "research",
  });
  const includeAutomation = parsed.projectType !== "website";
  const mockup = buildRevenueMockup({
    businessName: parsed.businessName,
    area: parsed.area,
    niche: parsed.niche,
    websiteStatus: parsed.websiteStatus,
    evidence: parsed.evidence,
    painPoint: parsed.painPoint,
    primaryOffer: revenueWebsiteOfferName(clampRevenueWebsitePrice(parsed.estimatedOfferUsd), includeAutomation),
    estimatedOfferUsd: parsed.estimatedOfferUsd,
    includeAutomation,
  });
  const agentRunResult = recordRevenueAgentRun({
    businessName: parsed.businessName,
    area: parsed.area,
    niche: parsed.niche,
    request: parsed.request,
    stage: "proposal",
    projectType: parsed.projectType,
    estimatedOfferUsd: parsed.estimatedOfferUsd,
    estimatedInternalCostUsd: parsed.estimatedInternalCostUsd,
    monthlyBudgetUsd: parsed.monthlyBudgetUsd,
    cashCollectedUsd: parsed.cashCollectedUsd,
    approvalToContact: parsed.approvalToContact,
    approvalToSpend: parsed.approvalToSpend,
    approvalToBuild: parsed.approvalToBuild,
  });
  const deliveryReview = buildDeliveryReview({
    projectName: `${parsed.businessName} autopilot sale`,
    projectType: parsed.projectType,
    setupPriceUsd: parsed.estimatedOfferUsd,
    monthlyRetainerUsd: parsed.monthlyRetainerUsd,
    estimatedInternalMonthlyCostUsd: parsed.estimatedInternalCostUsd,
    clientApprovedScope: false,
    depositPaid: parsed.cashCollectedUsd > 0,
    publicDataVerified: parsed.evidence.trim().length >= 12,
    responsiveChecked: false,
    linksChecked: false,
    automationTested: !includeAutomation,
    rollbackPlanReady: false,
    notes: "Autopilot prepara venta; QA bloquea entrega hasta scope, deposito, pruebas y aprobacion.",
  });
  const hasDraftContactPath = revenueLeadHasDraftContactPath(parsed);
  const canDraftOutreach = hasDraftContactPath && leadResult.qualification.missing.length === 0 && parsed.estimatedInternalCostUsd <= 100;
  const outreachResult = canDraftOutreach
    ? recordRevenueOutreachDraft({
        leadId: leadResult.lead.id,
        channel: revenueOutreachChannelFromLead(parsed.contactChannel),
        approvalStatus: parsed.approvalToContact ? "approved" : "draft",
        recipientEmail: revenueEmailRecipientFromLead(parsed),
        contactName: parsed.contactName || "Owner",
        businessName: parsed.businessName,
        sourceUrl: parsed.sourceUrl || undefined,
        businessSummary: parsed.businessSummary || `${parsed.businessName} en ${parsed.area}: ${parsed.evidence || parsed.painPoint}`,
        websitePriceUsd: clampRevenueWebsitePrice(includeAutomation ? parsed.estimatedOfferUsd * 0.65 : parsed.estimatedOfferUsd),
        automationPriceUsd: includeAutomation ? Math.round(parsed.estimatedOfferUsd * 0.35) : 0,
        monthlyRetainerUsd: parsed.monthlyRetainerUsd,
        estimatedInternalMonthlyCostUsd: parsed.estimatedInternalCostUsd,
        notes: "Autopilot draft. No enviar hasta aprobacion humana final.",
      })
    : null;
  const requiredBeforeExternalAction = [
    !hasDraftContactPath && "contacto/email verificable",
    leadResult.qualification.missing.length > 0 && `resolver lead: ${leadResult.qualification.missing.join(", ")}`,
    clarificationGate.status === "needs_clarification" && "responder preguntas de aclaracion",
    !parsed.approvalToContact && "aprobar contacto externo",
    parsed.estimatedInternalCostUsd > 100 && "reducir costo interno bajo $100/mes",
    parsed.estimatedInternalCostUsd > parsed.cashCollectedUsd && parsed.cashCollectedUsd === 0 && !parsed.approvalToSpend && "aprobar gasto antes de cash cobrado",
  ].filter(Boolean) as string[];
  const status =
    parsed.estimatedInternalCostUsd > 100
      ? "blocked"
      : requiredBeforeExternalAction.length > 0
        ? "approval_required"
        : "ready";

  return {
    status,
    guardrail:
      status === "ready"
        ? "Autopilot preparo el paquete; aun asi el envio real usa outbox y aprobacion humana."
        : status === "blocked"
          ? "Bloqueado por costo o gates criticos; no gastar, construir ni contactar."
          : "Autopilot preparo trabajo interno; falta aprobacion/evidencia antes de accion externa.",
    lead: leadResult.lead,
    leadQualification: leadResult.qualification,
    clarificationGate,
    mockup,
    agentRun: agentRunResult.run,
    deliveryReview,
    outreachDraft: outreachResult?.draft || null,
    requiredBeforeExternalAction,
    nextActions:
      status === "blocked"
        ? ["Reducir costo interno a menos de $100.", "Recalcular oferta/retainer antes de prometer entrega."]
        : requiredBeforeExternalAction.length > 0
          ? ["Completar evidencia/contacto/aprobacion.", "Mantener outreach en draft.", "Usar QA antes de enviar preview."]
          : ["Revisar draft en Outbox.", "Aprobar envio manual/API.", "Registrar deposito en ledger si cierra."],
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function approveRevenueOutreachDraft(input: RevenueOutreachApproveInput) {
  loadRevenueOutreach();
  const parsed = revenueOutreachApproveSchema.parse(input);
  const draft = revenueOutreachDrafts.find((item) => item.id === parsed.draftId) || null;
  const gates = [
    { gate: "draft_found", passed: Boolean(draft), fix: "Seleccionar un draft existente del outbox." },
    { gate: "human_approval", passed: parsed.approvedByRobert, fix: "Robert debe aprobar explicitamente este contacto." },
    { gate: "not_sent", passed: draft?.delivery.sendStatus !== "sent", fix: "Este draft ya fue enviado; no se puede reaprobar como nuevo contacto." },
    { gate: "qa_clear", passed: Boolean(draft && draft.qaGates.filter((gate) => gate.gate !== "approval").every((gate) => gate.passed)), fix: "Resolver recipient/evidence/cost antes de aprobar contacto." },
  ];
  const failedGate = gates.find((gate) => !gate.passed);

  if (!draft || failedGate) {
    return {
      status: "blocked" as const,
      reason: failedGate?.fix || "No se pudo aprobar el draft.",
      gates,
      draft,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const now = new Date().toISOString();
  draft.status = "approved";
  draft.qaGates = draft.qaGates.map((gate) =>
    gate.gate === "approval"
      ? { ...gate, passed: true, fix: "Aprobado por Robert; contacto sigue manual o provider-gated." }
      : gate
  );
  draft.updatedAt = now;
  persistRevenueOutreach();

  return {
    status: "approved" as const,
    reason: "Draft aprobado para cola manual; no se envio outreach ni se marco contacto externo.",
    gates,
    draft,
    snapshot: getRevenueEngineSnapshot(),
    safety: {
      sendsOutreach: false,
      spendsMoney: false,
      writesPreviewFiles: false,
      createsLedger: false,
      createsDelivery: false,
    },
  };
}

export function updateRevenueOutreachDraft(input: RevenueOutreachUpdateInput) {
  loadRevenueOutreach();
  const parsed = revenueOutreachUpdateSchema.parse(input);
  const draft = revenueOutreachDrafts.find((item) => item.id === parsed.draftId) || null;
  const gates = [
    { gate: "draft_found", passed: Boolean(draft), fix: "Seleccionar un draft existente del outbox." },
    { gate: "not_sent", passed: draft?.delivery.sendStatus !== "sent", fix: "Un correo enviado no puede editarse; crea un follow-up nuevo." },
  ];
  const failedGate = gates.find((gate) => !gate.passed);

  if (!draft || failedGate) {
    return {
      status: "blocked" as const,
      reason: failedGate?.fix || "No se pudo actualizar el draft.",
      gates,
      draft,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  draft.subject = parsed.subject;
  draft.body = parsed.body;
  draft.status = "draft";
  draft.approvalStatus = "draft";
  draft.qaGates = draft.qaGates.map((gate) => gate.gate === "approval"
    ? { ...gate, passed: false, fix: "Robert debe volver a aprobar el mensaje después de cualquier corrección." }
    : gate);
  draft.updatedAt = new Date().toISOString();
  draft.nextAction = "Revisar el mensaje corregido y aprobarlo antes de enviar.";
  persistRevenueOutreach();

  return {
    status: "updated" as const,
    reason: "Corrección guardada. El correo volvió a draft y necesita una nueva aprobación.",
    gates,
    draft,
    snapshot: getRevenueEngineSnapshot(),
    safety: {
      sendsOutreach: false,
      spendsMoney: false,
      createsLedger: false,
      createsDelivery: false,
    },
  };
}

export async function sendRevenueOutreachDraft(input: RevenueOutreachSendInput) {
  loadRevenueOutreach();
  const parsed = revenueOutreachSendSchema.parse(input);
  const draft = revenueOutreachDrafts.find((item) => item.id === parsed.draftId);
  const provider = getRevenueEmailProviderStatus();
  const now = new Date().toISOString();
  const manualQueue = buildRevenueManualOutreachQueue(10);
  const insideDailyQueue = Boolean(draft && manualQueue.items.some((item) => item.draftId === draft.id));
  const canUseEmailProvider = draft?.channel === "email";
  const gates = [
    { gate: "draft_found", passed: Boolean(draft), fix: "Seleccionar un draft existente del outbox." },
    { gate: "draft_approved", passed: draft?.status === "approved", fix: "Aprobar el draft antes de enviar." },
    { gate: "human_approval", passed: parsed.approvalToSend, fix: "Marcar approvalToSend=true para contacto externo." },
    { gate: "daily_contact_cap", passed: insideDailyQueue, fix: "Este draft no esta en la cola manual de hoy o excede el limite diario de contacto." },
    { gate: "email_channel", passed: canUseEmailProvider, fix: "Solo drafts con channel=email pueden enviarse por Resend; Gmail, mailto, Instagram y formularios son manuales." },
    { gate: "provider_configured", passed: provider.configured, fix: `Configurar ${provider.missing.join(" y ") || "proveedor de email"}.` },
    { gate: "not_duplicate", passed: draft?.delivery.sendStatus !== "sent", fix: "Este draft ya fue enviado; crear uno nuevo para reenviar." },
    { gate: "qa_clear", passed: Boolean(draft && draft.qaGates.every((gate) => gate.passed)), fix: "Resolver gates de QA antes de contactar." },
  ];
  const failedGate = gates.find((gate) => !gate.passed);

  if (!draft) {
    return {
      status: "blocked" as const,
      provider,
      gates,
      reason: failedGate?.fix || "Draft no encontrado.",
      draft: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  draft.delivery.lastAttemptAt = now;

  if (failedGate) {
    draft.delivery.sendStatus = provider.configured ? "blocked" : "provider_missing";
    draft.delivery.reason = failedGate.fix;
    draft.updatedAt = now;
    persistRevenueOutreach();
    return {
      status: "blocked" as const,
      provider,
      gates,
      reason: failedGate.fix,
      draft,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  try {
    const sendResult = await sendRevenueOutreachPayload({
      from: provider.fromEmail,
      to: draft.recipientEmail,
      subject: draft.subject,
      text: draft.body,
      html: textToHtml(draft.body),
      idempotencyKey: draft.id,
    });
    draft.delivery.mode = "provider_api";
    draft.delivery.sendStatus = "sent";
    draft.delivery.reason = "Enviado por Resend API despues de aprobacion humana y QA.";
    draft.delivery.provider = provider.provider;
    draft.delivery.externalMessageId = sendResult.id;
    draft.delivery.sentAt = now;
    draft.updatedAt = now;

    if (draft.leadId) {
      loadRevenueLeads();
      const lead = revenueLeads.find((item) => item.id === draft.leadId);
      if (lead && lead.status !== "closed") {
        lead.status = "proposal_sent";
        lead.updatedAt = now;
        persistRevenueLeads();
      }
    }

    persistRevenueOutreach();
    return {
      status: "sent" as const,
      provider,
      gates,
      sendResult,
      draft,
      snapshot: getRevenueEngineSnapshot(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email provider failed";
    draft.delivery.mode = "provider_api";
    draft.delivery.sendStatus = "failed";
    draft.delivery.reason = message;
    draft.delivery.provider = provider.provider;
    draft.updatedAt = now;
    persistRevenueOutreach();
    return {
      status: "failed" as const,
      provider,
      gates,
      reason: message,
      draft,
      snapshot: getRevenueEngineSnapshot(),
    };
  }
}

export function recordRevenueOutreachOutcome(input: RevenueOutreachOutcomeInput) {
  loadRevenueOutreach();
  loadRevenueLeads();
  loadRevenueWebsiteOpportunities();

  const parsed = revenueOutreachOutcomeSchema.parse(input);
  const now = new Date().toISOString();
  const draft = revenueOutreachDrafts.find((item) => item.id === parsed.draftId) || null;
  const gates = [
    { gate: "draft_found", passed: Boolean(draft), fix: "Seleccionar un draft existente del outbox." },
    { gate: "draft_approved", passed: draft?.status === "approved", fix: "Aprobar el draft antes de registrar contacto externo." },
    { gate: "human_recorded", passed: parsed.outcomeRecordedByRobert, fix: "Robert debe confirmar que este resultado ocurrio fuera del sistema." },
    { gate: "deposit_amount", passed: parsed.outcome !== "deposit_collected" || parsed.cashCollectedUsd > 0, fix: "Registrar cashCollectedUsd mayor a 0 para deposito cobrado." },
    { gate: "deposit_payment_evidence", passed: parsed.outcome !== "deposit_collected" || hasRevenuePaymentEvidence(parsed.paymentConfirmation), fix: "Agregar referencia/comprobante verificable de pago antes de marcar deposito cobrado." },
  ];
  const failedGate = gates.find((gate) => !gate.passed);

  if (!draft || failedGate) {
    return {
      status: "blocked" as const,
      reason: failedGate?.fix || "No se pudo registrar outcome.",
      gates,
      draft,
      lead: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const nextStatusByOutcome: Record<RevenueOutreachOutcomeInput["outcome"], RevenueLead["status"]> = {
    contacted: "contacted",
    reply: "contacted",
    call_booked: "proposal_sent",
    deposit_collected: "closed",
    lost: "disqualified",
  };
  const nextActionByOutcome: Record<RevenueOutreachOutcomeInput["outcome"], string> = {
    contacted: "Esperar reply o registrar follow-up; no marcar venta hasta deposito.",
    reply: "Responder manualmente, buscar llamada y registrar outcome si agenda.",
    call_booked: "Preparar llamada, confirmar scope/deposito y registrar deposito si cierra.",
    deposit_collected: "Crear delivery workspace desde Website handoff queue con deposito/scope verificados; ledger se registra alli para evitar doble conteo.",
    lost: "Marcar aprendizaje en improvement review antes de contactar mas leads similares.",
  };

  draft.delivery.mode = "manual";
  draft.delivery.sendStatus = "sent";
  draft.delivery.reason = `Resultado manual registrado: ${parsed.outcome}.`;
  draft.delivery.sentAt = draft.delivery.sentAt || now;
  draft.delivery.lastAttemptAt = now;
  draft.delivery.outcome = parsed.outcome;
  draft.delivery.outcomeAt = now;
  draft.delivery.outcomeNotes = parsed.notes || nextActionByOutcome[parsed.outcome];
  draft.delivery.outcomeCashCollectedUsd = parsed.cashCollectedUsd;
  draft.delivery.outcomePaymentConfirmation = parsed.paymentConfirmation || undefined;
  draft.nextAction = nextActionByOutcome[parsed.outcome];
  draft.updatedAt = now;

  let lead: RevenueLead | null = draft.leadId
    ? revenueLeads.find((item) => item.id === draft.leadId) || null
    : null;
  if (!lead) {
    lead = revenueLeads.find((item) => item.businessName.toLowerCase() === draft.businessName.toLowerCase()) || null;
  }
  if (lead) {
    lead.status = parsed.outcome === "lost"
      ? "disqualified"
      : strongerRevenueLeadStatus(lead.status, nextStatusByOutcome[parsed.outcome]);
    lead.updatedAt = now;
    persistRevenueLeads();
  }

  persistRevenueOutreach();
  const websiteOpportunity = parsed.outcome === "deposit_collected"
    ? syncRevenueWebsiteOpportunityFromDepositOutcome(lead, draft, parsed.cashCollectedUsd, parsed.paymentConfirmation, parsed.notes)
    : null;

  return {
    status: "recorded" as const,
    reason: parsed.outcome === "deposit_collected"
      ? "Deposito registrado como outcome manual; aprobar scope y cerrar oportunidad website para contabilizar venta sin doble conteo."
      : "Outcome manual registrado en draft y lead.",
    gates,
    draft,
    lead,
    websiteOpportunity,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function recordRevenueLedgerEntry(input: RevenueLedgerEntryInput) {
  loadRevenueLedger();
  const parsed = revenueLedgerEntrySchema.parse(input);
  if (isRevenueIncomeEntry(parsed.kind) && parsed.amountUsd > 0 && parsed.cashCollectedUsd <= 0) {
    const snapshotBefore = getRevenueEngineSnapshot();
    return {
      entry: null,
      snapshot: snapshotBefore,
      guardrail: {
        status: "blocked" as const,
        reason: "Ingreso bloqueado: una venta requiere cashCollectedUsd mayor que 0 y referencia/comprobante verificable de pago en notes.",
      },
    };
  }
  if (isRevenueIncomeEntry(parsed.kind) && parsed.cashCollectedUsd > 0 && !hasRevenuePaymentEvidence(parsed.notes)) {
    const snapshotBefore = getRevenueEngineSnapshot();
    return {
      entry: null,
      snapshot: snapshotBefore,
      guardrail: {
        status: "blocked" as const,
        reason: "Ingreso bloqueado: cashCollectedUsd requiere referencia/comprobante verificable de pago en notes.",
      },
    };
  }
  if (parsed.kind === "expense") {
    const snapshotBefore = getRevenueEngineSnapshot();
    const projectedSpendUsd = snapshotBefore.metrics.estimatedSpendUsd + parsed.amountUsd + parsed.estimatedInternalCostUsd;
    const blockers = [
      projectedSpendUsd > 100 && "Gasto mensual estimado supera el cap inicial de $100.",
      projectedSpendUsd > snapshotBefore.metrics.cashCollectedUsd && "El gasto supera el cash cobrado; cobrar deposito antes de gastar.",
      snapshotBefore.approvalQueueItems.length > 0 && "Hay aprobaciones pendientes; limpiar approval queue antes de gastar.",
    ].filter(Boolean) as string[];

    if (blockers.length > 0) {
      return {
        entry: null,
        snapshot: snapshotBefore,
        guardrail: {
          status: "blocked" as const,
          reason: blockers.join(" "),
        },
      };
    }
  }

  const entry: RevenueLedgerEntry = {
    ...parsed,
    id: `rev-${Date.now()}-${revenueLedger.length + 1}`,
    createdAt: new Date().toISOString(),
  };

  revenueLedger.push(entry);
  persistRevenueLedger();
  const snapshot = getRevenueEngineSnapshot();

  return {
    entry,
    snapshot,
    guardrail: {
      status:
        entry.kind === "expense" && snapshot.metrics.estimatedSpendUsd > 100
          ? "blocked"
          : snapshot.metrics.estimatedSpendUsd > snapshot.metrics.cashCollectedUsd
            ? "approval_required"
            : "ok",
      reason:
        entry.kind === "expense" && snapshot.metrics.estimatedSpendUsd > 100
          ? "Gasto mensual estimado supera el cap inicial de $100."
          : snapshot.metrics.estimatedSpendUsd > snapshot.metrics.cashCollectedUsd
            ? "El gasto supera el cash cobrado; requiere aprobacion antes de gastar o enviar mas."
            : "Ledger actualizado dentro de las reglas de rentabilidad.",
    },
  };
}

export function preflightRevenueExpense(input: RevenueExpensePreflightInput) {
  const parsed = revenueExpensePreflightSchema.parse(input);
  const snapshot = getRevenueEngineSnapshot();
  const projectedSpendUsd = snapshot.metrics.estimatedSpendUsd + parsed.amountUsd + parsed.estimatedInternalCostUsd;
  const projectedProfitUsd = snapshot.metrics.cashCollectedUsd - projectedSpendUsd;
  const blockers = [
    parsed.amountUsd + parsed.estimatedInternalCostUsd <= 0 && "monto/costo debe ser mayor a 0",
    projectedSpendUsd > 100 && `pasaria el cap inicial de $100/mes: ${projectedSpendUsd} USD`,
    projectedSpendUsd > snapshot.metrics.cashCollectedUsd && `gastaria mas que el cash cobrado: cash ${snapshot.metrics.cashCollectedUsd} USD vs spend ${projectedSpendUsd} USD`,
    snapshot.approvalQueueItems.length > 0 && "hay approval queue pendiente",
  ].filter(Boolean) as string[];
  const status = blockers.length > 0 ? "blocked" as const : "approved" as const;

  return {
    status,
    concept: parsed.concept,
    amountUsd: parsed.amountUsd,
    estimatedInternalCostUsd: parsed.estimatedInternalCostUsd,
    projected: {
      spendUsd: projectedSpendUsd,
      profitUsd: projectedProfitUsd,
      remainingCapUsd: Math.max(0, 100 - projectedSpendUsd),
      cashCoverageUsd: snapshot.metrics.cashCollectedUsd - projectedSpendUsd,
    },
    blockers,
    nextAction:
      status === "approved"
        ? "Gasto pre-aprobado por Profit Guard; registrar en ledger solo si Robert confirma."
        : "No gastar ni registrar como ejecutado; cobrar deposito, bajar costo o limpiar approvals primero.",
    snapshot,
  };
}

export function setRevenueLedgerPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueLedgerPathOverride = filePath;
  revenueLedgerLoaded = false;
  revenueLedgerPersistenceError = null;
  revenueLedger.splice(0, revenueLedger.length);
}

export function setRevenueLeadsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueLeadsPathOverride = filePath;
  revenueLeadsLoaded = false;
  revenueLeadsPersistenceError = null;
  revenueLeads.splice(0, revenueLeads.length);
}

export function setRevenueOutreachPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueOutreachPathOverride = filePath;
  revenueOutreachLoaded = false;
  revenueOutreachPersistenceError = null;
  revenueOutreachDrafts.splice(0, revenueOutreachDrafts.length);
}

export function setRevenueOutreachSenderForTests(sender: ((payload: RevenueOutreachSendPayload) => Promise<RevenueOutreachSendResponse>) | null) {
  revenueOutreachSenderOverride = sender;
}

export function setRevenueAgentRunsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueAgentRunsPathOverride = filePath;
  revenueAgentRunsLoaded = false;
  revenueAgentRunsPersistenceError = null;
  revenueAgentRuns.splice(0, revenueAgentRuns.length);
}

export function setRevenueAutomationOpportunitiesPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueAutomationOpportunitiesPathOverride = filePath;
  revenueAutomationOpportunitiesLoaded = false;
  revenueAutomationOpportunitiesPersistenceError = null;
  revenueAutomationOpportunities.splice(0, revenueAutomationOpportunities.length);
}

export function setRevenueWebsiteOpportunitiesPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueWebsiteOpportunitiesPathOverride = filePath;
  revenueWebsiteOpportunitiesLoaded = false;
  revenueWebsiteOpportunitiesPersistenceError = null;
  revenueWebsiteOpportunities.splice(0, revenueWebsiteOpportunities.length);
}

export function setRevenueImprovementReviewsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueImprovementReviewsPathOverride = filePath;
  revenueImprovementReviewsLoaded = false;
  revenueImprovementReviewsPersistenceError = null;
  revenueImprovementReviews.splice(0, revenueImprovementReviews.length);
}

export function setRevenueScoutingMissionsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueScoutingMissionsPathOverride = filePath;
  revenueScoutingMissionsLoaded = false;
  revenueScoutingMissionsPersistenceError = null;
  revenueScoutingMissions.splice(0, revenueScoutingMissions.length);
}

export function setRevenueDailyScoutSprintsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueDailyScoutSprintsPathOverride = filePath;
  revenueDailyScoutSprintsLoaded = false;
  revenueDailyScoutSprintsPersistenceError = null;
  revenueDailyScoutSprints.splice(0, revenueDailyScoutSprints.length);
}

export function setRevenuePublicLeadCandidatesPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenuePublicLeadCandidatesPathOverride = filePath;
  revenuePublicLeadCandidatesLoaded = false;
  revenuePublicLeadCandidatesPersistenceError = null;
  revenuePublicLeadCandidates.splice(0, revenuePublicLeadCandidates.length);
}

export function setRevenueDeliveryWorkspacesPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueDeliveryWorkspacesPathOverride = filePath;
  revenueDeliveryWorkspacesLoaded = false;
  revenueDeliveryWorkspacesPersistenceError = null;
  revenueDeliveryWorkspaces.splice(0, revenueDeliveryWorkspaces.length);
}

export function setRevenueApprovalDecisionsPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueApprovalDecisionsPathOverride = filePath;
  revenueApprovalDecisionsLoaded = false;
  revenueApprovalDecisionsPersistenceError = null;
  revenueApprovalDecisions.splice(0, revenueApprovalDecisions.length);
}

export function setRevenueAutomationIntakesPathForTests(filePath: string) {
  revenueUserDataScope = null;
  revenueAutomationIntakesPathOverride = filePath;
  revenueAutomationIntakesLoaded = false;
  revenueAutomationIntakesPersistenceError = null;
  revenueAutomationIntakes.splice(0, revenueAutomationIntakes.length);
}

export function resetRevenueLedgerForTests() {
  revenueLedger.splice(0, revenueLedger.length);
  revenueLedgerLoaded = true;
  revenueLedgerPersistenceError = null;
  const ledgerPath = getRevenueLedgerPath();
  if (fs.existsSync(ledgerPath)) {
    fs.unlinkSync(ledgerPath);
  }
}

export function resetRevenueLeadsForTests() {
  revenueLeads.splice(0, revenueLeads.length);
  revenueLeadsLoaded = true;
  revenueLeadsPersistenceError = null;
  const leadsPath = getRevenueLeadsPath();
  if (fs.existsSync(leadsPath)) {
    fs.unlinkSync(leadsPath);
  }
}

export function resetRevenueOutreachForTests() {
  revenueOutreachDrafts.splice(0, revenueOutreachDrafts.length);
  revenueOutreachLoaded = true;
  revenueOutreachPersistenceError = null;
  revenueOutreachSenderOverride = null;
  const outreachPath = getRevenueOutreachPath();
  if (fs.existsSync(outreachPath)) {
    fs.unlinkSync(outreachPath);
  }
}

export function resetRevenueAgentRunsForTests() {
  revenueAgentRuns.splice(0, revenueAgentRuns.length);
  revenueAgentRunsLoaded = true;
  revenueAgentRunsPersistenceError = null;
  const agentRunsPath = getRevenueAgentRunsPath();
  if (fs.existsSync(agentRunsPath)) {
    fs.unlinkSync(agentRunsPath);
  }
}

export function resetRevenueAutomationOpportunitiesForTests() {
  revenueAutomationOpportunities.splice(0, revenueAutomationOpportunities.length);
  revenueAutomationOpportunitiesLoaded = true;
  revenueAutomationOpportunitiesPersistenceError = null;
  const opportunitiesPath = getRevenueAutomationOpportunitiesPath();
  if (fs.existsSync(opportunitiesPath)) {
    fs.unlinkSync(opportunitiesPath);
  }
}

export function resetRevenueWebsiteOpportunitiesForTests() {
  revenueWebsiteOpportunities.splice(0, revenueWebsiteOpportunities.length);
  revenueWebsiteOpportunitiesLoaded = true;
  revenueWebsiteOpportunitiesPersistenceError = null;
  const opportunitiesPath = getRevenueWebsiteOpportunitiesPath();
  if (fs.existsSync(opportunitiesPath)) {
    fs.unlinkSync(opportunitiesPath);
  }
}

export function resetRevenueImprovementReviewsForTests() {
  revenueImprovementReviews.splice(0, revenueImprovementReviews.length);
  revenueImprovementReviewsLoaded = true;
  revenueImprovementReviewsPersistenceError = null;
  const reviewsPath = getRevenueImprovementReviewsPath();
  if (fs.existsSync(reviewsPath)) {
    fs.unlinkSync(reviewsPath);
  }
}

export function resetRevenueScoutingMissionsForTests() {
  revenueScoutingMissions.splice(0, revenueScoutingMissions.length);
  revenueScoutingMissionsLoaded = true;
  revenueScoutingMissionsPersistenceError = null;
  const missionsPath = getRevenueScoutingMissionsPath();
  if (fs.existsSync(missionsPath)) {
    fs.unlinkSync(missionsPath);
  }
}

export function resetRevenueDailyScoutSprintsForTests() {
  revenueDailyScoutSprints.splice(0, revenueDailyScoutSprints.length);
  revenueDailyScoutSprintsLoaded = true;
  revenueDailyScoutSprintsPersistenceError = null;
  const sprintsPath = getRevenueDailyScoutSprintsPath();
  if (fs.existsSync(sprintsPath)) {
    fs.unlinkSync(sprintsPath);
  }
}

export function resetRevenuePublicLeadCandidatesForTests() {
  revenuePublicLeadCandidates.splice(0, revenuePublicLeadCandidates.length);
  revenuePublicLeadCandidatesLoaded = true;
  revenuePublicLeadCandidatesPersistenceError = null;
  const candidatesPath = getRevenuePublicLeadCandidatesPath();
  if (fs.existsSync(candidatesPath)) {
    fs.unlinkSync(candidatesPath);
  }
}

export function resetRevenueDeliveryWorkspacesForTests() {
  revenueDeliveryWorkspaces.splice(0, revenueDeliveryWorkspaces.length);
  revenueDeliveryWorkspacesLoaded = true;
  revenueDeliveryWorkspacesPersistenceError = null;
  const workspacesPath = getRevenueDeliveryWorkspacesPath();
  if (fs.existsSync(workspacesPath)) {
    fs.unlinkSync(workspacesPath);
  }
}

export function resetRevenueApprovalDecisionsForTests() {
  revenueApprovalDecisions.splice(0, revenueApprovalDecisions.length);
  revenueApprovalDecisionsLoaded = true;
  revenueApprovalDecisionsPersistenceError = null;
  const decisionsPath = getRevenueApprovalDecisionsPath();
  if (fs.existsSync(decisionsPath)) {
    fs.unlinkSync(decisionsPath);
  }
}

export function resetRevenueAutomationIntakesForTests() {
  revenueAutomationIntakes.splice(0, revenueAutomationIntakes.length);
  revenueAutomationIntakesLoaded = true;
  revenueAutomationIntakesPersistenceError = null;
  const intakesPath = getRevenueAutomationIntakesPath();
  if (fs.existsSync(intakesPath)) {
    fs.unlinkSync(intakesPath);
  }
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeRevenueFingerprintPart(value: string | number | boolean | undefined | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function sanitizeRevenuePublicHandoffField(value: string | undefined | null, fallback: string) {
  const sanitized = String(value ?? "")
    .replace(/\b((?:bank|transfer|payment|wire|venmo|zelle|cashapp|cash app)\s+(?:references?|refs?))(?:\s*[:#-]\s*|\s+)[A-Za-z0-9_.-]+/gi, "private-sale-reference-redacted")
    .replace(/\b(bank references?|bank refs?|transfer references?|transfer refs?|payment references?|payment refs?|wire references?|wire refs?|venmo references?|venmo refs?|invoice id|receipt url|stripe payment id|zelle references?|zelle refs?|cashapp references?|cashapp refs?)(?:\s*[:#-]\s*|\s+)[A-Za-z0-9_.-]+/gi, "private-sale-reference-redacted")
    .replace(/\b(stripe|venmo|zelle|cashapp|cash app|ach|wire|bank|invoice|receipt|payment|transfer)\s+(?:id|refs?|references?|token|code|number)?\s*[:#-]?\s*[A-Za-z0-9_.-]+/gi, "private-sale-reference-redacted")
    .replace(/\b(?:pi|in|ch|cs|txn|tx|ach|wire|venmo|zelle|cashapp)_[A-Za-z0-9_.-]+/gi, "private-sale-reference-redacted")
    .replace(/\b(?:ACH|WIRE|VENMO|ZELLE|CASHAPP)[-_\s]?[A-Za-z0-9_.-]{3,}\b/g, "private-sale-reference-redacted")
    .replace(/\$[\d,]+(?:\.\d{2})?/g, "amount-redacted")
    .replace(/\b(setup|retainer|deposit|payment|paid|cash collected|invoice|stripe|zelle|cashapp|bank reference|transfer|receipt)\b/gi, "private-sale-detail-redacted")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return sanitized || fallback;
}

function buildAutomationSaleFingerprint(input: Pick<
  RevenueAutomationAgentCommandInput,
  "businessName" | "industry" | "request" | "currentTools" | "monthlyBudgetUsd" | "urgency" | "knownAnswers"
>) {
  const source = [
    "automation-sale",
    normalizeRevenueFingerprintPart(input.businessName),
    normalizeRevenueFingerprintPart(input.industry),
    normalizeRevenueFingerprintPart(input.request),
    normalizeRevenueFingerprintPart(input.currentTools),
    normalizeRevenueFingerprintPart(input.monthlyBudgetUsd),
    normalizeRevenueFingerprintPart(input.urgency),
    normalizeRevenueFingerprintPart(input.knownAnswers),
  ].join("|").slice(0, 900);
  return `[automation-agent-sale:${createHash("sha256").update(source).digest("hex").slice(0, 20)}]`;
}

function findRevenueLedgerEntryByExactNoteToken(token: string) {
  return revenueLedger.find((entry) =>
    entry.notes.split("|").map((part) => part.trim()).includes(token)
  );
}

function getRevenueLedgerEntriesByExactNoteToken(token: string) {
  return revenueLedger.filter((entry) =>
    entry.notes.split("|").map((part) => part.trim()).includes(token)
  );
}

function isVerifiedAutomationSaleLedgerEntry(entry: RevenueLedgerEntry, opportunity: RevenueAutomationOpportunity) {
  const paymentConfirmation = opportunity.paymentConfirmation.trim();
  const requiredDepositUsd = opportunity.quote.pricing.requiredDepositUsd;
  return entry.kind === "automation_sale"
    && entry.cashCollectedUsd >= requiredDepositUsd
    && paymentConfirmation.length > 0
    && entry.notes.includes(paymentConfirmation);
}

function findUnverifiedAutomationSaleLedgerEntry(opportunity: RevenueAutomationOpportunity) {
  const token = `Automation opportunity:${opportunity.id}`;
  return getRevenueLedgerEntriesByExactNoteToken(token)
    .find((entry) => !isVerifiedAutomationSaleLedgerEntry(entry, opportunity));
}

function findVerifiedAutomationSaleLedgerEntry(opportunity: RevenueAutomationOpportunity) {
  const token = `Automation opportunity:${opportunity.id}`;
  if (findUnverifiedAutomationSaleLedgerEntry(opportunity)) return undefined;
  return getRevenueLedgerEntriesByExactNoteToken(token)
    .find((entry) => isVerifiedAutomationSaleLedgerEntry(entry, opportunity));
}

function buildRevenueCodexBuildHandoff(input: RevenueDeliveryWorkspaceInput) {
  const isWebsiteBuild = input.projectType === "website" || input.projectType === "bundle";
  const repoFullName = (input.repoFullName || "").trim();
  const branchName = (input.branchName || `codex/client-${slugifyRevenueValue(input.clientName)}-website`).trim();
  const githubIssueUrl = (input.githubIssueUrl || "").trim();
  const prUrl = (input.prUrl || "").trim();
  const secondReviewStatus = input.secondReviewStatus || "pending";
  const secondReviewEvidenceUrl = (input.secondReviewEvidenceUrl || "").trim();
  const appQaStatus = input.appQaStatus || "pending";
  const appQaEvidenceUrl = (input.appQaEvidenceUrl || "").trim();
  const deploymentApprovalStatus = input.deploymentApprovalStatus || "not_requested";
  const deploymentApprovalUrl = (input.deploymentApprovalUrl || "").trim();
  const releaseGateHeadSha = (input.releaseGateHeadSha || "").trim();
  const publicClientName = sanitizeRevenuePublicHandoffField(input.clientName, "Revenue client");
  const publicPackageName = sanitizeRevenuePublicHandoffField(input.packageName, "Approved website package");
  const missing = [
    isWebsiteBuild && !input.publicDataVerified && "data publica verificada",
    isWebsiteBuild && !repoFullName && "repo GitHub del website",
    isWebsiteBuild && !isRevenueCodexBranchName(branchName) && "branch codex/... para PR-first",
    isWebsiteBuild && !githubIssueUrl && "GitHub handoff issue PR-first",
    isWebsiteBuild && !prUrl && "pull request de build",
    isWebsiteBuild && secondReviewStatus !== "pass" && "segundo review independiente",
    isWebsiteBuild && appQaStatus !== "pass" && "App QA gate aprobado",
    isWebsiteBuild && deploymentApprovalStatus !== "approved" && "aprobacion humana de deploy",
    isWebsiteBuild && deploymentApprovalStatus === "approved" && !deploymentApprovalUrl && "URL/evidencia de aprobacion de deploy",
    isWebsiteBuild && deploymentApprovalStatus === "approved" && !releaseGateHeadSha && "PR head SHA verificado para release",
  ].filter(Boolean) as string[];
  const title = `[Revenue Website Build] ${input.clientName} - ${input.packageName}`;
  const buildPackSections = [
    "First viewport with business name, offer, credibility signal and primary CTA.",
    "Services/menu/offer section grounded only in public business facts and approved scope.",
    "Contact or booking section with approved contact path, no automatic sending until Robert/client approval.",
    "Trust section using public evidence, mockup direction and clear next step.",
    "Footer with source-safe business identity and no private payment or operator details.",
  ];
  const buildPackAssets = [
    input.mockupUrl ? `Approved mockup: ${input.mockupUrl}` : "Approved mockup: pending in Revenue Engine workspace",
    input.sourceUrl ? `Public source: ${input.sourceUrl}` : "Public source: use Revenue Engine workspace source URL",
    `Repo: ${repoFullName || "pending"}`,
    `Branch: ${branchName}`,
  ];
  const buildPackQaCommands = [
    "npm run check",
    "npm run build",
    "Run relevant route/API tests for the touched app.",
    "Capture desktop and mobile verification notes before PR handoff.",
  ];
  const copyableBuildPack = [
    `[Revenue Website Build] ${publicClientName} - ${publicPackageName} build pack`,
    "",
    "Build target:",
    `- Client: ${publicClientName}`,
    `- Package: ${publicPackageName}`,
    `- Project type: ${input.projectType}`,
    `- Repo: ${repoFullName || "pending"}`,
    `- Branch: ${branchName}`,
    "",
    "Page sections:",
    ...buildPackSections.map((section) => `- ${section}`),
    "",
    "Public assets/context:",
    ...buildPackAssets.map((asset) => `- ${asset}`),
    "",
    "Implementation rules:",
    "- Build on a codex/ branch and open a PR before merge.",
    "- Use only public facts, approved mockup direction, and workspace-approved scope.",
    "- Keep prices, deposits, payment references, operator notes, credentials and private client details out of public GitHub text.",
    "- Do not deploy, publish previews, send forms/messages, or merge without second review, App QA and explicit Robert deploy approval.",
    "",
    "QA commands/evidence:",
    ...buildPackQaCommands.map((command) => `- ${command}`),
  ].join("\n");
  const codexBrief = [
    title,
    "",
    "Goal",
    `Build the sold ${input.projectType} delivery for ${input.clientName} using the approved scope, mockup, public evidence, and Revenue Engine workspace.`,
    "",
    "Commercial Context",
    `- Setup: $${input.setupUsd.toLocaleString("en-US")}`,
    `- Retainer: $${input.monthlyRetainerUsd.toLocaleString("en-US")}/mo`,
    `- Deposit paid: ${input.depositPaid ? "yes" : "no"}`,
    `- Scope approved: ${input.scopeApproved ? "yes" : "no"}`,
    `- Public data verified: ${input.publicDataVerified ? "yes" : "no"}`,
    input.mockupUrl && `- Mockup preview: ${input.mockupUrl}`,
    "",
    "Client Request / Evidence",
    input.clientRequest || "Use Revenue Engine workspace context.",
    "",
    "PR-First Rules",
    "- Create or work only on a separate Codex branch.",
    "- Open a pull request before merge.",
    "- Do not commit directly to main.",
    "- Do not deploy to Replit or custom production without explicit Robert approval.",
    "- Do not expose secrets, credentials, private customer data, or non-public security details.",
    "- Run App QA after implementation and include rollback notes.",
    "",
    "Acceptance Criteria",
    "- Website experience matches the approved offer and public business facts.",
    "- Mobile and desktop layouts are checked.",
    "- CTA/contact paths work or are clearly stubbed for Robert/client approval.",
    "- Any automation in scope has test data, failure behavior, and manual fallback.",
    "- PR includes tests/checks run, QA summary, risks, and rollback.",
  ].filter(Boolean).join("\n");
  const publicBuildBrief = [
    `[Revenue Website Build] ${publicClientName} - ${publicPackageName}`,
    "",
    "Goal",
    `Build the approved ${input.projectType} delivery for ${publicClientName} using public business facts, the approved mockup, and the Revenue Engine workspace.`,
    "",
    "Public Build Context",
    `- Repo: ${repoFullName || "pending"}`,
    `- Branch: ${branchName}`,
    `- Public data verified: ${input.publicDataVerified ? "yes" : "no"}`,
    input.sourceUrl && `- Public source: ${input.sourceUrl}`,
    input.mockupUrl && `- Mockup preview: ${input.mockupUrl}`,
    "",
    "Client Request / Evidence",
    "Use the public source URL, approved mockup, package name, and Revenue Engine workspace context. Keep payment status, amounts, operator notes, and private client details out of public GitHub text.",
    "",
    "PR-First Rules",
    "- Create or work only on a separate Codex branch.",
    "- Open a pull request before merge.",
    "- Do not commit directly to main.",
    "- Do not deploy to Replit or custom production without explicit Robert approval.",
    "- Do not include prices, payment references, deposit status, private notes, credentials, or customer-sensitive data in public GitHub text.",
    "- Run App QA after implementation and include rollback notes.",
    "",
    "Acceptance Criteria",
    "- Website experience matches the approved offer and public business facts.",
    "- Mobile and desktop layouts are checked.",
    "- CTA/contact paths work or are clearly stubbed for Robert/client approval.",
    "- Any automation in scope has test data, failure behavior, and manual fallback.",
    "- PR includes tests/checks run, QA summary, risks, and rollback.",
  ].filter(Boolean).join("\n");
  const githubIssueTitle = `[Revenue Client Build] ${publicClientName}`;
  const copyableGithubIssueBody = [
    "PR-first client build handoff from Revenue Engine.",
    "",
    `Revenue workspace client: ${publicClientName}`,
    `Project type: ${input.projectType}`,
    `Package: ${publicPackageName}`,
    `Target branch: ${branchName}`,
    input.sourceUrl ? `Public source: ${input.sourceUrl}` : null,
    input.mockupUrl ? `Mockup preview: ${input.mockupUrl}` : null,
    "",
    "Build pack:",
    ...buildPackSections.map((section) => `- ${section}`),
    "",
    "Public assets:",
    ...buildPackAssets.map((asset) => `- ${asset}`),
    "",
    "Required gates before delivery:",
    "- Open a pull request before merge.",
    "- Second-agent review must pass.",
    "- App QA gate must pass.",
    "- Replit/custom deploy requires explicit Robert approval.",
    "- Include tests/checks run, QA summary, risks, and rollback notes in the PR.",
    "",
    "Public issue privacy rules:",
    "- Do not include sale amounts, collection status, transfer IDs, or proof-of-funds details.",
    "- Do not include private client data or non-public evidence.",
    "- Use only public source/mockup context and the sanitized scope above.",
  ].filter((line): line is string => line !== null).join("\n");

  return {
    status: !isWebsiteBuild ? "not_required" as const : missing.length > 0 ? "needs_pr" as const : "ready_for_qa" as const,
    repoFullName,
    branchName,
    githubIssueUrl,
    prUrl,
    secondReviewStatus,
    secondReviewEvidenceUrl,
    appQaStatus,
    appQaEvidenceUrl,
    deploymentApprovalStatus,
    deploymentApprovalUrl,
    releaseGateHeadSha,
    title,
    codexBrief,
    publicBuildBrief,
    githubIssueTitle,
    copyableGithubIssueBody,
    buildPack: {
      sections: buildPackSections,
      assets: buildPackAssets,
      qaCommands: buildPackQaCommands,
      publicOnly: true,
      copyableBuildPack,
    },
    acceptanceCriteria: [
      "PR exists before merge.",
      "Second-agent review passes.",
      "App QA passes against the target environment.",
      "Rollback note is included.",
      "Deployment waits for explicit Robert approval.",
    ],
    blockedActions: ["merge without PR", "direct main commit", "deploy without Robert approval", "skip App QA", "publish unapproved client preview"],
    missing,
    nextAction:
      !isWebsiteBuild
        ? "Automation-only workspace no requiere build handoff de website."
        : missing.length > 0
          ? "Crear/actualizar GitHub issue PR-first, abrir PR de build, correr review independiente y App QA antes de entregar."
          : "PR-first build listo para QA/deploy approval; no desplegar hasta aprobacion humana.",
  };
}

function buildRevenueClarificationGate(input: {
  request: string;
  projectType?: "website" | "automation" | "bundle";
  currentTools?: string;
}) {
  const request = input.request.trim();
  const lowerRequest = request.toLowerCase();
  const lowerTools = (input.currentTools || "").toLowerCase();
  const wantsAutomation = input.projectType === "automation" || input.projectType === "bundle" || includesAny(lowerRequest, ["automat", "follow", "crm", "mensaje", "email", "whatsapp", "lead"]);
  const wantsWebsite = input.projectType === "website" || input.projectType === "bundle" || includesAny(lowerRequest, ["web", "site", "landing", "3d", "seo", "pagina"]);
  const wordCount = request.split(/\s+/).filter(Boolean).length;
  const hasTrigger = includesAny(lowerRequest, ["cuando", "when", "nuevo", "entra", "recibe", "form", "lead", "pedido", "booking", "reserva", "cita", "trigger"]);
  const hasAction = includesAny(lowerRequest, ["automat", "enviar", "send", "crear", "actualizar", "avisar", "notificar", "notify", "notification", "guardar", "follow", "seguimiento", "responder", "report"]);
  const hasOutcome = includesAny(lowerRequest, ["para", "so that", "cerrar", "ahorrar", "agendar", "convertir", "vender", "capture", "capturar", "follow-up", "reporting", "report", "dashboard", "booked", "trial", "appointment", "owner", "buyer", "cliente", "nadie se pierda", "menos errores"]);
  const hasDataSource = includesAny(`${lowerRequest} ${lowerTools}`, ["lead", "cliente", "sponsor", "buyer", "sheet", "crm", "email", "gmail", "instagram", "whatsapp", "form", "calendar", "stripe", "pos", "database", "base", "excel"]);
  const hasWebsiteGoal = !wantsWebsite || includesAny(lowerRequest, ["cta", "booking", "reserva", "menu", "servicio", "galeria", "portfolio", "seo", "contacto", "lead", "signup", "trial"]);
  const missing = [
    wordCount < 14 && "pedido demasiado corto",
    wantsAutomation && !hasTrigger && "trigger inicial de la automatizacion",
    wantsAutomation && !hasAction && "accion exacta que debe ejecutar el sistema",
    wantsAutomation && !hasDataSource && "herramienta o fuente de datos actual",
    !hasOutcome && "resultado de negocio esperado",
    wantsWebsite && !hasWebsiteGoal && "objetivo principal del website/mockup",
  ].filter(Boolean) as string[];
  const questions = [
    missing.includes("trigger inicial de la automatizacion") && "Que evento inicia el flujo: nuevo lead, formulario, DM, llamada, pago, reserva u otra cosa?",
    missing.includes("accion exacta que debe ejecutar el sistema") && "Que debe hacer el sistema automaticamente despues de ese evento?",
    missing.includes("herramienta o fuente de datos actual") && "Donde vive hoy la informacion: Google Sheets, CRM, email, Instagram, WhatsApp, POS u otra herramienta?",
    missing.includes("resultado de negocio esperado") && "Que resultado quieres venderle al cliente: mas reservas, mas leads respondidos, menos trabajo manual, reportes o cobros?",
    missing.includes("objetivo principal del website/mockup") && "Cual es el objetivo numero uno del website: llamadas, reservas, ventas, lista de emails o confianza visual?",
    missing.includes("pedido demasiado corto") && "Dame 2-3 frases sobre el proceso actual, quien lo usa y que duele ahora.",
  ].filter(Boolean) as string[];

  return {
    status: missing.length > 0 ? "needs_clarification" as const : "clear" as const,
    missing,
    questions: questions.slice(0, 5),
    minimumAnswer: "Responder estas preguntas antes de cotizar final, contactar al prospecto, construir o activar automatizaciones.",
    blocks: missing.length > 0 ? ["precio final", "contacto externo", "build completo", "launch/activacion"] : [],
  };
}

export function buildAutomationQuote(input: AutomationQuoteInput) {
  const request = input.request.toLowerCase();
  const toolText = input.currentTools.toLowerCase();
  const clarificationGate = buildRevenueClarificationGate({
    request: input.request,
    projectType: "automation",
    currentTools: input.currentTools,
  });
  const detectedNeeds = [
    includesAny(request, ["lead", "cliente", "customer", "prospect", "crm", "seguimiento", "signup", "trial"]) && "lead follow-up",
    includesAny(request, ["cita", "booking", "appointment", "calendar", "reserva"]) && "booking",
    includesAny(request, ["email", "sms", "whatsapp", "mensaje", "dm", "notify", "notification"]) && "messaging",
    includesAny(request, ["invoice", "factura", "pago", "payment", "stripe"]) && "payments",
    includesAny(request, ["reporte", "report", "dashboard", "metric", "analytics", "weekly"]) && "reporting",
    includesAny(request, ["inventory", "inventario", "stock", "orden", "order"]) && "operations",
    includesAny(request, ["ai", "ia", "chatbot", "assistant", "asistente"]) && "ai assistant",
  ].filter(Boolean) as string[];

  const integrations = [
    includesAny(toolText + request, ["google", "calendar", "gmail", "sheets"]) && "Google Workspace",
    includesAny(toolText + request, ["stripe", "payment", "pago"]) && "Stripe",
    includesAny(toolText + request, ["zapier", "make", "n8n"]) && "automation platform",
    includesAny(toolText + request, ["square", "toast", "clover", "pos"]) && "POS",
    includesAny(toolText + request, ["shopify", "woocommerce"]) && "ecommerce",
    includesAny(toolText + request, ["instagram", "facebook", "meta", "dm"]) && "social inbox",
    includesAny(toolText + request, ["whatsapp", "sms", "twilio"]) && "messaging provider",
  ].filter(Boolean) as string[];

  const needCount = Math.max(1, detectedNeeds.length);
  const integrationCount = integrations.length;
  const complexityScore = Math.min(10, 2 + needCount + integrationCount + (input.urgency === "this_week" ? 2 : 0));
  const setupPriceUsd = Math.max(1500, 1000 + complexityScore * 550);
  const retainerUsd = Math.max(300, 150 + complexityScore * 75);
  const estimatedInternalMonthlyCostUsd = Math.min(100, Number((8 + needCount * 7 + integrationCount * 9 + (detectedNeeds.includes("ai assistant") ? 25 : 0)).toFixed(0)));
  const grossMarginUsd = retainerUsd - estimatedInternalMonthlyCostUsd;
  const grossMarginPercent = Math.round((grossMarginUsd / retainerUsd) * 100);
  const needsClarification = clarificationGate.status === "needs_clarification" || detectedNeeds.length === 0;

  const clarifyingQuestions = [
    ...clarificationGate.questions,
    "Que paso exacto quieres automatizar primero?",
    "Donde viven hoy los leads/clientes: telefono, email, Instagram, Google Sheet, CRM u otro?",
    "Que debe pasar cuando entra un nuevo lead o pedido?",
    "Quien aprueba errores, pagos o mensajes sensibles antes de enviarlos?",
  ].filter((question, index, all) => all.indexOf(question) === index).slice(0, needsClarification ? 5 : 2);

  return {
    input,
    clarificationGate,
    decision: {
      status: needsClarification ? "needs_clarification" : "ready_to_pitch",
      approvalMode: "draft_only",
      reason: needsClarification
        ? "El pedido todavia necesita respuestas antes de prometer entrega o precio final."
        : "Hay suficiente informacion para preparar una propuesta de venta con QA y deposito.",
    },
    pricing: {
      setupPriceUsd,
      requiredDepositUsd: Math.round(setupPriceUsd * 0.5),
      monthlyRetainerUsd: retainerUsd,
      estimatedInternalMonthlyCostUsd,
      grossMarginUsd,
      grossMarginPercent,
      insideCostCap: estimatedInternalMonthlyCostUsd <= 100,
      clientBudgetFit: input.monthlyBudgetUsd >= retainerUsd ? "fits" : "upsell_or_reduce_scope",
    },
    scope: {
      packageName: complexityScore >= 7 ? "Automation Sprint Plus" : "Automation Sprint",
      detectedNeeds: detectedNeeds.length ? detectedNeeds : ["manual workflow discovery"],
      integrations: integrations.length ? integrations : ["no external integration confirmed"],
      deliverables: [
        "Mapa del proceso actual y nuevo flujo automatizado",
        "Intake/formulario o trigger inicial",
        "Base simple de clientes/leads o conexion con herramienta actual",
        "Notificaciones y seguimiento",
        "Dashboard basico de estado y resultados",
        "Manual corto de uso y handoff",
      ],
      outOfScopeUntilApproved: [
        "Mensajes masivos sin opt-in verificable",
        "Comprar data de leads",
        "Cobrar clientes finales",
        "Integraciones con credenciales del cliente sin acceso seguro",
      ],
    },
    agents: [
      {
        id: "automation-architect",
        check: "Define flujo, herramientas y entregables",
        result: complexityScore <= 7 ? "pass" : "review",
      },
      {
        id: "cost-controller",
        check: "Mantiene costo interno por debajo de $100/mes al inicio",
        result: estimatedInternalMonthlyCostUsd <= 100 ? "pass" : "block",
      },
      {
        id: "qa-council",
        check: "Exige pruebas, logs, rollback y aprobacion de acciones sensibles",
        result: "pass",
      },
      {
        id: "closer",
        check: "No envia propuesta final hasta que Robert apruebe precio y alcance",
        result: "approval_required",
      },
    ],
    clientProposalDraft: {
      headline: `${input.businessName}: automatizacion para ahorrar tiempo y cerrar mas clientes`,
      summary:
        `Podemos automatizar el flujo principal de ${input.industry} empezando por ${detectedNeeds[0] || "el proceso manual mas repetitivo"}. La entrega incluye setup, QA, dashboard y soporte mensual para que el sistema siga mejorando sin subir costos innecesarios.`,
      close:
        `Para empezar: deposito de $${Math.round(setupPriceUsd * 0.5).toLocaleString("en-US")} y kickoff de 30 minutos. No enviamos ni activamos nada sensible sin aprobacion.`,
    },
    deliveryPlan: [
      "Dia 1: discovery, accesos y mapa del flujo",
      "Dia 2-3: build del flujo minimo rentable",
      "Dia 4: QA de subagentes y pruebas con datos de ejemplo",
      "Dia 5: demo, ajustes y aprobacion",
      "Dia 6-7: launch controlado y primer reporte",
    ],
    improvementLoop: [
      "Medir tiempo ahorrado y errores evitados",
      "Guardar objeciones y pedidos nuevos",
      "Reducir pasos manuales cada semana",
      "Subir retainer solo cuando el ROI este probado",
    ],
    clarifyingQuestions,
  };
}

export function recordRevenueAutomationOpportunity(input: RevenueAutomationOpportunityInput) {
  loadRevenueAutomationOpportunities();
  const parsed = revenueAutomationOpportunitySchema.parse(input);
  const quote = buildAutomationQuote(parsed);
  const qaGates = [
    {
      gate: "clarity",
      passed: quote.decision.status === "ready_to_pitch",
      fix: "Responder preguntas clave antes de prometer alcance final.",
    },
    {
      gate: "scope",
      passed: parsed.clientApprovedScope || parsed.status === "intake" || parsed.status === "quoted",
      fix: "Conseguir aprobacion escrita del alcance antes de delivery.",
    },
    {
      gate: "deposit",
      passed: parsed.depositPaid || parsed.status === "intake" || parsed.status === "quoted",
      fix: `Cobrar deposito de $${quote.pricing.requiredDepositUsd.toLocaleString("en-US")} antes de construir.`,
    },
    {
      gate: "cost",
      passed: quote.pricing.insideCostCap,
      fix: "Reducir herramientas o subir retainer para mantener costo interno bajo $100/mes.",
    },
    {
      gate: "margin",
      passed: quote.pricing.grossMarginPercent >= 65,
      fix: "Subir retainer o recortar alcance hasta margen bruto minimo de 65%.",
    },
  ];
  const hasBlockingGate = qaGates.some((gate) => !gate.passed && ["clarity", "cost", "margin"].includes(gate.gate));
  const status: RevenueAutomationOpportunity["status"] =
    hasBlockingGate ? "blocked" : parsed.status === "intake" && quote.decision.status === "ready_to_pitch" ? "quoted" : parsed.status;
  const now = new Date().toISOString();
  const opportunity: RevenueAutomationOpportunity = {
    ...parsed,
    status,
    id: `automation-opportunity-${Date.now()}-${revenueAutomationOpportunities.length + 1}`,
    createdAt: now,
    updatedAt: now,
    quote,
    qaGates,
    nextAction:
      status === "blocked"
        ? "Corregir gates bloqueantes antes de vender o construir."
        : status === "quoted"
          ? "Enviar propuesta en draft, pedir aprobacion de scope y cobrar deposito."
          : status === "approved"
            ? "Crear plan de produccion y no activar acciones sensibles sin QA."
            : status === "sold"
              ? "Registrar venta en ledger y pasar a produccion."
              : "Actualizar estado y correr QA antes de avanzar.",
  };

  revenueAutomationOpportunities.push(opportunity);
  persistRevenueAutomationOpportunities();

  return {
    opportunity,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildDeliveryReview(input: DeliveryReviewInput) {
  const parsed = deliveryReviewSchema.parse(input);
  const grossMarginUsd = parsed.monthlyRetainerUsd - parsed.estimatedInternalMonthlyCostUsd;
  const grossMarginPercent = parsed.monthlyRetainerUsd > 0 ? Math.round((grossMarginUsd / parsed.monthlyRetainerUsd) * 100) : 0;
  const isAutomation = parsed.projectType === "automation" || parsed.projectType === "bundle";
  const isWebsite = parsed.projectType === "website" || parsed.projectType === "bundle";

  const gates = [
    {
      id: "commercial-approval",
      agent: "closer",
      label: "Scope aprobado por cliente",
      passed: parsed.clientApprovedScope,
      fix: "Conseguir aprobacion escrita del alcance, precio, timeline y limites.",
    },
    {
      id: "deposit",
      agent: "finance-controller",
      label: "Deposito recibido",
      passed: parsed.depositPaid,
      fix: "No construir ni lanzar trabajo sensible sin deposito.",
    },
    {
      id: "data-verification",
      agent: "business-researcher",
      label: "Data publica verificada",
      passed: parsed.publicDataVerified,
      fix: "Marcar fuentes, quitar claims dudosos y confirmar datos del negocio.",
    },
    {
      id: "responsive",
      agent: "visual-qa",
      label: "Mobile/desktop revisado",
      passed: !isWebsite || parsed.responsiveChecked,
      fix: "Revisar mobile, desktop, textos largos, formularios y hero visual.",
    },
    {
      id: "links",
      agent: "technical-qa",
      label: "Links y formularios probados",
      passed: parsed.linksChecked,
      fix: "Probar CTA, formulario, email, telefono, tracking y paginas clave.",
    },
    {
      id: "automation-test",
      agent: "automation-qa",
      label: "Automatizacion probada con datos de ejemplo",
      passed: !isAutomation || parsed.automationTested,
      fix: "Correr pruebas con datos falsos, errores comunes y aprobaciones sensibles.",
    },
    {
      id: "rollback",
      agent: "ops-qa",
      label: "Rollback/manual fallback listo",
      passed: !isAutomation || parsed.rollbackPlanReady,
      fix: "Definir como pausar el flujo y operar manualmente si algo falla.",
    },
    {
      id: "cost-cap",
      agent: "cost-controller",
      label: "Costo interno bajo $100/mes",
      passed: parsed.estimatedInternalMonthlyCostUsd <= 100,
      fix: "Reducir herramientas pagadas, limitar volumen o subir retainer antes de lanzar.",
    },
    {
      id: "margin",
      agent: "growth-director",
      label: "Margen mensual rentable",
      passed: grossMarginPercent >= 65 && grossMarginUsd > 0,
      fix: "Subir precio mensual, bajar costo o recortar alcance.",
    },
  ];

  const failedGates = gates.filter((gate) => !gate.passed);
  const blockingGates = failedGates.filter((gate) => ["deposit", "cost-cap", "margin", "automation-test", "rollback"].includes(gate.id));
  const status = blockingGates.length > 0 ? "blocked" : failedGates.length > 0 ? "needs_fix" : "ready_to_deliver";

  return {
    input: parsed,
    status,
    summary: {
      passed: gates.length - failedGates.length,
      total: gates.length,
      failed: failedGates.length,
      blocking: blockingGates.length,
      setupPriceUsd: parsed.setupPriceUsd,
      monthlyRetainerUsd: parsed.monthlyRetainerUsd,
      estimatedInternalMonthlyCostUsd: parsed.estimatedInternalMonthlyCostUsd,
      grossMarginUsd,
      grossMarginPercent,
      insideCostCap: parsed.estimatedInternalMonthlyCostUsd <= 100,
    },
    gates,
    requiredFixes: failedGates.map((gate) => ({
      gateId: gate.id,
      ownerAgent: gate.agent,
      action: gate.fix,
    })),
    deliveryDecision:
      status === "ready_to_deliver"
        ? "Puede entregarse despues de aprobacion final de Robert."
        : status === "needs_fix"
          ? "No entregar todavia. Corregir detalles no bloqueantes y volver a revisar."
          : "Bloqueado. No entregar, lanzar ni contactar hasta resolver los gates criticos.",
    nextReview: {
      cadence: status === "ready_to_deliver" ? "post-launch weekly improvement" : "rerun after fixes",
      improvementMetrics: [
        "tiempo ahorrado",
        "leads/reservas generadas",
        "errores detectados",
        "costo mensual real",
        "margen mensual real",
      ],
    },
  };
}

export function buildRevenueDeliveryWorkspace(input: RevenueDeliveryWorkspaceInput) {
  const projectPlan = buildRevenueProjectPlan(input);
  const codexBuildHandoff = buildRevenueCodexBuildHandoff(input);
  const deliveryReview = buildDeliveryReview({
    projectName: input.workspaceName || input.clientName,
    projectType: input.projectType,
    setupPriceUsd: input.setupUsd,
    monthlyRetainerUsd: input.monthlyRetainerUsd,
    estimatedInternalMonthlyCostUsd: input.estimatedInternalCostUsd,
    clientApprovedScope: input.scopeApproved,
    depositPaid: input.depositPaid,
    publicDataVerified: input.publicDataVerified,
    responsiveChecked: input.projectType === "automation" || input.visualQaPassed,
    linksChecked: input.technicalQaPassed,
    automationTested: !input.includesAutomation || input.automationQaPassed,
    rollbackPlanReady: !input.includesAutomation || input.automationQaPassed,
    notes: input.clientRequest || "Delivery workspace generado por Revenue Engine.",
  });
  const correctionQueue = deliveryReview.requiredFixes.map((fix) => ({
    agent: fix.ownerAgent,
    priority: ["deposit", "automation-test", "rollback", "cost-cap", "margin"].includes(fix.gateId) ? "high" as const : "medium" as const,
    action: fix.action,
    blocksDelivery: ["deposit", "automation-test", "rollback", "cost-cap", "margin"].includes(fix.gateId),
  }));
  const handoffCorrection = !input.clientHandoffReady
    ? [{
        agent: "growth-director",
        priority: "medium" as const,
        action: "Preparar handoff del cliente: demo, instrucciones, limites, soporte y siguiente review semanal.",
        blocksDelivery: false,
      }]
    : [];
  const allCorrections = [...correctionQueue, ...handoffCorrection];
  const status: RevenueDeliveryWorkspace["status"] =
    deliveryReview.status === "blocked" || projectPlan.decision.status === "blocked"
      ? "blocked"
      : allCorrections.length > 0 || projectPlan.decision.status !== "ready_to_build" || codexBuildHandoff.status === "needs_pr"
        ? "needs_corrections"
        : "ready_to_deliver";
  const requiredBeforeClient = [
    ...projectPlan.decision.missing,
    ...allCorrections.filter((item) => item.blocksDelivery).map((item) => item.action),
    ...codexBuildHandoff.missing,
    !input.clientHandoffReady && "handoff del cliente listo",
  ].filter(Boolean) as string[];

  return {
    input,
    status,
    projectPlan,
    deliveryReview,
    correctionQueue: allCorrections,
    runbook: projectPlan.phases.map((phase) => ({
      phase: phase.name,
      ownerAgent: phase.ownerAgent,
      checklist: phase.tasks,
    })),
    approvalSummary: {
      canShowClientPreview: projectPlan.decision.status !== "blocked" && deliveryReview.summary.blocking === 0 && codexBuildHandoff.status !== "needs_pr",
      canLaunch: status === "ready_to_deliver" && input.clientHandoffReady && codexBuildHandoff.status !== "needs_pr",
      requiredBeforeClient,
    },
    codexBuildHandoff,
    learningNote:
      status === "ready_to_deliver"
        ? `${input.clientName}: entrega lista con QA, costo <= $100/mes y handoff preparado.`
        : `${input.clientName}: no entregar todavia; subagentes tienen ${allCorrections.length} correcciones antes de cliente.`,
  };
}

export function recordRevenueDeliveryWorkspace(input: RevenueDeliveryWorkspaceInput) {
  loadRevenueDeliveryWorkspaces();
  const parsed = revenueDeliveryWorkspaceSchema.parse(input);
  const workspace = buildRevenueDeliveryWorkspace(parsed);
  const now = new Date().toISOString();
  const persisted: RevenueDeliveryWorkspace = {
    ...workspace,
    id: `delivery-workspace-${Date.now()}-${revenueDeliveryWorkspaces.length + 1}`,
    createdAt: now,
    updatedAt: now,
  };

  revenueDeliveryWorkspaces.push(persisted);
  persistRevenueDeliveryWorkspaces();

  return {
    workspace: persisted,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function updateRevenueDeliveryWorkspaceQa(
  input: RevenueDeliveryWorkspaceUpdateInput,
  options: RevenueDeliveryWorkspaceUpdateOptions = {},
) {
  loadRevenueDeliveryWorkspaces();
  const parsed = revenueDeliveryWorkspaceUpdateSchema.parse(input);
  const workspaceIndex = revenueDeliveryWorkspaces.findIndex((item) => item.id === parsed.workspaceId);

  if (workspaceIndex === -1) {
    return {
      status: "not_found" as const,
      reason: "Workspace no encontrado.",
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const existing = revenueDeliveryWorkspaces[workspaceIndex];
  const allowGithubIssueEvidence = Boolean(options.allowGithubIssueEvidence);
  const allowReleaseGateEvidence = Boolean(options.allowReleaseGateEvidence);
  const nextInput: RevenueDeliveryWorkspaceInput = {
    ...existing.input,
    publicDataVerified: parsed.publicDataVerified ?? existing.input.publicDataVerified,
    visualQaPassed: parsed.visualQaPassed ?? existing.input.visualQaPassed,
    technicalQaPassed: parsed.technicalQaPassed ?? existing.input.technicalQaPassed,
    automationQaPassed: parsed.automationQaPassed ?? existing.input.automationQaPassed,
    clientHandoffReady: parsed.clientHandoffReady ?? existing.input.clientHandoffReady,
    repoFullName: parsed.repoFullName ?? existing.input.repoFullName,
    branchName: parsed.branchName ?? existing.input.branchName,
    githubIssueUrl: allowGithubIssueEvidence ? parsed.githubIssueUrl ?? existing.input.githubIssueUrl : existing.input.githubIssueUrl,
    prUrl: allowReleaseGateEvidence ? parsed.prUrl ?? existing.input.prUrl : existing.input.prUrl,
    secondReviewStatus: allowReleaseGateEvidence ? parsed.secondReviewStatus ?? existing.input.secondReviewStatus : existing.input.secondReviewStatus,
    secondReviewEvidenceUrl: allowReleaseGateEvidence ? parsed.secondReviewEvidenceUrl ?? existing.input.secondReviewEvidenceUrl : existing.input.secondReviewEvidenceUrl,
    appQaStatus: allowReleaseGateEvidence ? parsed.appQaStatus ?? existing.input.appQaStatus : existing.input.appQaStatus,
    appQaEvidenceUrl: allowReleaseGateEvidence ? parsed.appQaEvidenceUrl ?? existing.input.appQaEvidenceUrl : existing.input.appQaEvidenceUrl,
    deploymentApprovalStatus: allowReleaseGateEvidence ? parsed.deploymentApprovalStatus ?? existing.input.deploymentApprovalStatus : existing.input.deploymentApprovalStatus,
    deploymentApprovalUrl: allowReleaseGateEvidence ? parsed.deploymentApprovalUrl ?? existing.input.deploymentApprovalUrl : existing.input.deploymentApprovalUrl,
    releaseGateHeadSha: allowReleaseGateEvidence ? parsed.releaseGateHeadSha ?? existing.input.releaseGateHeadSha : existing.input.releaseGateHeadSha,
    clientRequest: parsed.notes
      ? `${existing.input.clientRequest}\n\nQA update: ${parsed.notes}`.slice(0, 1200)
      : existing.input.clientRequest,
  };
  const rebuilt = buildRevenueDeliveryWorkspace(nextInput);
  const updated: RevenueDeliveryWorkspace = {
    ...rebuilt,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  revenueDeliveryWorkspaces[workspaceIndex] = updated;
  persistRevenueDeliveryWorkspaces();

  return {
    status: updated.status === "ready_to_deliver" ? "ready" as const : "needs_corrections" as const,
    reason:
      updated.status === "ready_to_deliver"
        ? "Workspace listo para entrega: QA, handoff, deposito, scope, costo y margen verificados."
        : "Workspace revalidado; aun quedan correcciones antes de mostrar, lanzar o entregar.",
    workspace: updated,
    snapshot: getRevenueEngineSnapshot(),
  };
}

function parseGithubRepoUrl(value: string) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname !== "github.com" || parts.length < 3) return null;
    return {
      owner: parts[0],
      repo: parts[1],
      kind: parts[2],
      number: parts[3] || "",
      normalizedRepo: `${parts[0]}/${parts[1]}`.toLowerCase(),
      normalizedPrefix: `/${parts[0]}/${parts[1]}/${parts[2]}/${parts[3] || ""}`.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function isGithubEvidenceForPr(value: string | undefined, prPrefix: string, expectedAnchor: "review" | "comment") {
  if (!value) return false;
  const parsed = parseGithubRepoUrl(value);
  if (!parsed || parsed.normalizedPrefix !== prPrefix) return false;
  try {
    const url = new URL(value);
    if (url.pathname.toLowerCase() !== prPrefix) return false;
    const hash = url.hash.trim().toLowerCase();
    if (expectedAnchor === "review") return /^#pullrequestreview-\w+/.test(hash);
    return /^#issuecomment-\w+/.test(hash);
  } catch {
    return false;
  }
}

function validateRevenueReleaseGateEvidence(
  workspace: RevenueDeliveryWorkspace,
  parsed: RevenueDeliveryWorkspaceUpdateInput,
) {
  const repoFullName = (parsed.repoFullName || workspace.input.repoFullName || "").trim();
  const branchName = (parsed.branchName || workspace.input.branchName || workspace.codexBuildHandoff.branchName || "").trim();
  const githubIssueUrl = (parsed.githubIssueUrl || workspace.input.githubIssueUrl || "").trim();
  const prUrl = (parsed.prUrl || workspace.input.prUrl || "").trim();
  const secondReviewStatus = parsed.secondReviewStatus || workspace.input.secondReviewStatus;
  const appQaStatus = parsed.appQaStatus || workspace.input.appQaStatus;
  const deploymentApprovalStatus = parsed.deploymentApprovalStatus || workspace.input.deploymentApprovalStatus;
  const deploymentApprovalUrl = (parsed.deploymentApprovalUrl || workspace.input.deploymentApprovalUrl || "").trim();
  const releaseGateHeadSha = (parsed.releaseGateHeadSha || workspace.input.releaseGateHeadSha || "").trim();
  const notes = (parsed.notes || "").toLowerCase();
  const pr = parseGithubRepoUrl(prUrl);
  const issue = parseGithubRepoUrl(githubIssueUrl);
  const blockers = [
    !repoFullName && "repo GitHub requerido",
    (!pr || pr.kind !== "pull" || !pr.number) && "prUrl debe ser un pull request de GitHub",
    pr && repoFullName && pr.normalizedRepo !== repoFullName.toLowerCase() && "prUrl debe pertenecer al repo del workspace",
    (!issue || issue.kind !== "issues" || !issue.number) && "githubIssueUrl debe ser un issue GitHub PR-first",
    issue && repoFullName && issue.normalizedRepo !== repoFullName.toLowerCase() && "githubIssueUrl debe pertenecer al repo del workspace",
    !branchName && "branchName requerido para ligar evidencia al build",
    workspace.input.branchName && branchName !== workspace.input.branchName && "branchName debe coincidir con el workspace",
    secondReviewStatus !== "pass" && "secondReviewStatus debe ser pass",
    appQaStatus !== "pass" && "appQaStatus debe ser pass",
    deploymentApprovalStatus !== "approved" && "deploymentApprovalStatus debe ser approved",
    deploymentApprovalStatus === "approved" && !releaseGateHeadSha && "releaseGateHeadSha debe venir del PR status check fresco",
    !pr || !isGithubEvidenceForPr(parsed.secondReviewEvidenceUrl, pr.normalizedPrefix, "review") && "secondReviewEvidenceUrl debe apuntar al PR review aprobado del PR",
    !pr || !isGithubEvidenceForPr(parsed.appQaEvidenceUrl, pr.normalizedPrefix, "comment") && "appQaEvidenceUrl debe apuntar al PR o comentario de App QA del PR",
    !pr || !isGithubEvidenceForPr(deploymentApprovalUrl, pr.normalizedPrefix, "comment") && "deploymentApprovalUrl debe apuntar al PR o comentario de aprobacion del PR",
    !notes.includes("second review") && "notes debe mencionar evidencia de second review",
    !notes.includes("app qa") && "notes debe mencionar evidencia de App QA",
    !notes.includes("app qa target") && "notes debe mencionar el App QA target del workspace",
    !notes.includes("robert") && "notes debe mencionar aprobacion de Robert",
    !notes.includes(workspace.id.toLowerCase()) && "notes debe incluir el workspace id auditado",
    branchName && !notes.includes(branchName.toLowerCase()) && "notes debe incluir el branch auditado",
    !notes.includes(workspace.input.clientName.toLowerCase()) && "notes debe incluir el cliente auditado",
  ].filter(Boolean) as string[];

  return Array.from(new Set(blockers));
}

export function recordRevenueDeliveryReleaseGate(
  input: RevenueDeliveryWorkspaceUpdateInput,
  options: RevenueDeliveryReleaseGateOptions = {},
) {
  loadRevenueDeliveryWorkspaces();
  loadRevenueWebsiteOpportunities();
  loadRevenueOutreach();
  const parsed = revenueDeliveryWorkspaceUpdateSchema.parse(input);
  const workspace = revenueDeliveryWorkspaces.find((item) => item.id === parsed.workspaceId) || null;

  if (!workspace) {
    return {
      status: "not_found" as const,
      reason: "Workspace no encontrado.",
      workspace: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const saleGate = revenueWebsiteWorkspaceSaleGate(workspace);
  const releaseGateHeadSha = (options.verifiedPrHeadSha || "").trim();
  const blockers = [
    ...validateRevenueReleaseGateEvidence(workspace, {
      ...parsed,
      releaseGateHeadSha,
    }),
    !options.verifiedPrStatusReady && "fresh GitHub PR status check must pass before release gate",
    !releaseGateHeadSha && "fresh GitHub PR status check must provide current head SHA before release gate",
    ...saleGate.blockers,
  ].filter(Boolean) as string[];
  if (blockers.length > 0) {
    return {
      status: "blocked" as const,
      reason: `Release gate bloqueado: ${blockers.join("; ")}.`,
      workspace,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  return updateRevenueDeliveryWorkspaceQa({
    ...input,
    releaseGateHeadSha,
  }, {
    allowGithubIssueEvidence: true,
    allowReleaseGateEvidence: true,
  });
}

export function getRevenueDeliveryWorkspaceById(workspaceId: string) {
  loadRevenueDeliveryWorkspaces();
  const workspace = revenueDeliveryWorkspaces.find((item) => item.id === workspaceId.trim()) || null;

  return {
    status: workspace ? "found" as const : "not_found" as const,
    workspace,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function deliverRevenueDeliveryWorkspaceFromTrustedApproval(input: RevenueDeliveryWorkspaceDeliverInput) {
  return deliverRevenueDeliveryWorkspace(input, {
    allowRobertApprovalEvidence: true,
  });
}

export function deliverRevenueDeliveryWorkspace(
  input: RevenueDeliveryWorkspaceDeliverInput,
  options: RevenueDeliveryWorkspaceDeliverOptions = {},
) {
  loadRevenueDeliveryWorkspaces();
  loadRevenueAutomationOpportunities();
  loadRevenueWebsiteOpportunities();
  loadRevenueOutreach();
  const parsed = revenueDeliveryWorkspaceDeliverSchema.parse(input);
  const workspaceIndex = revenueDeliveryWorkspaces.findIndex((item) => item.id === parsed.workspaceId);

  if (workspaceIndex === -1) {
    return {
      status: "not_found" as const,
      reason: "Workspace no encontrado.",
      workspace: null,
      opportunity: null,
      handoff: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const workspace = revenueDeliveryWorkspaces[workspaceIndex];
  const saleGate = revenueWebsiteWorkspaceSaleGate(workspace);
  const approvedByTrustedGate = Boolean(options.allowRobertApprovalEvidence && parsed.approvedByRobert);
  const missing = [
    !approvedByTrustedGate && "aprobacion final de Robert desde gate confiable",
    workspace.status !== "ready_to_deliver" && `workspace no esta listo: ${workspace.status}`,
    !workspace.approvalSummary.canLaunch && "launch/handoff bloqueado",
    ...saleGate.blockers,
    ...workspace.approvalSummary.requiredBeforeClient,
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    return {
      status: "blocked" as const,
      reason: `No entregar todavia: ${Array.from(new Set(missing)).join("; ")}.`,
      workspace,
      opportunity: null,
      handoff: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const deliveredAt = new Date().toISOString();
  const automationOpportunity = workspace.input.projectType === "automation" && workspace.input.sourceOpportunityId
    ? revenueAutomationOpportunities.find((item) => item.id === workspace.input.sourceOpportunityId) || null
    : null;
  const websiteOpportunity = workspace.input.projectType !== "automation" && workspace.input.sourceOpportunityId
    ? revenueWebsiteOpportunities.find((item) => item.id === workspace.input.sourceOpportunityId) || null
    : null;
  const opportunity = automationOpportunity || websiteOpportunity;
  if (automationOpportunity) {
    automationOpportunity.status = "delivered";
    automationOpportunity.nextAction = "Entrega marcada como completada. Medir resultados y correr review semanal.";
    automationOpportunity.updatedAt = deliveredAt;
    persistRevenueAutomationOpportunities();
  }
  if (websiteOpportunity) {
    websiteOpportunity.status = "delivered";
    websiteOpportunity.nextAction = "Website entregado; medir resultados y correr review semanal.";
    websiteOpportunity.updatedAt = deliveredAt;
    persistRevenueWebsiteOpportunities();
  }

  const updatedWorkspace: RevenueDeliveryWorkspace = {
    ...workspace,
    updatedAt: deliveredAt,
    learningNote: `${workspace.input.clientName}: entregado con QA aprobado; medir resultados en review semanal.`,
  };
  revenueDeliveryWorkspaces[workspaceIndex] = updatedWorkspace;
  persistRevenueDeliveryWorkspaces();

  return {
    status: "delivered" as const,
    reason: "Entrega aprobada: QA, handoff, costo, margen, deposito y rollback verificados.",
    workspace: updatedWorkspace,
    opportunity,
    handoff: {
      clientName: updatedWorkspace.input.clientName,
      packageName: updatedWorkspace.input.packageName,
      deliveredAt: updatedWorkspace.updatedAt,
      supportPlan: "Revisar resultados semanalmente y guardar aprendizajes en Improvement Review.",
      requiredFollowUpMetrics: updatedWorkspace.deliveryReview.nextReview.improvementMetrics,
      notes: parsed.notes,
    },
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function recordRevenueDeliveryWorkspaceImprovementReview(input: RevenueDeliveryWorkspaceImprovementReviewInput) {
  loadRevenueDeliveryWorkspaces();
  const parsed = revenueDeliveryWorkspaceImprovementReviewSchema.parse(input);
  const workspaceIndex = revenueDeliveryWorkspaces.findIndex((item) => item.id === parsed.workspaceId);

  if (workspaceIndex === -1) {
    return {
      status: "not_found" as const,
      reason: "Workspace no encontrado.",
      workspace: null,
      review: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const workspace = revenueDeliveryWorkspaces[workspaceIndex];
  const missing = [
    workspace.status !== "ready_to_deliver" && `workspace no esta listo: ${workspace.status}`,
    !workspace.approvalSummary.canLaunch && "launch/handoff bloqueado",
    ...workspace.approvalSummary.requiredBeforeClient,
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    return {
      status: "blocked" as const,
      reason: `No guardar review de mejora todavia: ${Array.from(new Set(missing)).join("; ")}.`,
      workspace,
      review: null,
      snapshot: getRevenueEngineSnapshot(),
    };
  }

  const notes = [
    parsed.notes,
    workspace.learningNote,
    `Delivery gates: ${workspace.deliveryReview.summary.passed}/${workspace.deliveryReview.summary.total}; correcciones abiertas ${workspace.correctionQueue.length}.`,
  ].filter(Boolean).join("\n\n").slice(0, 1200);
  const recorded = recordRevenueImprovementReview({
    campaignName: workspace.input.clientName,
    periodLabel: parsed.periodLabel,
    leadsContacted: parsed.leadsContacted,
    replies: parsed.replies,
    callsBooked: parsed.callsBooked,
    dealsClosed: parsed.dealsClosed,
    revenueCollectedUsd: parsed.revenueCollectedUsd ?? workspace.input.setupUsd,
    spendUsd: parsed.spendUsd ?? 0,
    estimatedInternalMonthlyCostUsd: workspace.input.estimatedInternalCostUsd,
    hoursSaved: parsed.hoursSaved,
    defectsFound: parsed.defectsFound,
    clientComplaints: parsed.clientComplaints,
    bestOffer: workspace.input.packageName,
    biggestObjection: workspace.correctionQueue[0]?.action || "Medir resultados post-entrega antes de escalar.",
    notes,
  });

  const updatedWorkspace: RevenueDeliveryWorkspace = {
    ...workspace,
    updatedAt: new Date().toISOString(),
    learningNote: `${workspace.input.clientName}: improvement review ${recorded.review.id} guardado; usar aprendizaje para el proximo batch.`,
  };
  revenueDeliveryWorkspaces[workspaceIndex] = updatedWorkspace;
  persistRevenueDeliveryWorkspaces();

  return {
    status: "recorded" as const,
    reason: "Improvement Review creada desde delivery workspace; playbook y next batch actualizados.",
    workspace: updatedWorkspace,
    review: recorded.review,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildProposalEmail(input: ProposalEmailInput) {
  const websitePriceUsd = Number.isFinite(input.websitePriceUsd) ? input.websitePriceUsd : REVENUE_WEBSITE_DEFAULT_USD;
  const totalSetupUsd = websitePriceUsd + input.automationPriceUsd;
  const depositUsd = Math.round(totalSetupUsd * 0.5);
  const grossMarginUsd = input.monthlyRetainerUsd - input.estimatedInternalMonthlyCostUsd;
  const grossMarginPercent = input.monthlyRetainerUsd > 0 ? Math.round((grossMarginUsd / input.monthlyRetainerUsd) * 100) : 0;
  const genericContact = /^(owner|propietario|equipo|robert)$/i.test(input.contactName);
  const greeting = genericContact ? "Hello," : `Hello ${input.contactName},`;
  const scope = [
    websitePriceUsd > 0
      ? "- A premium, fast, responsive website with a clear path to inquiries or bookings."
      : null,
    websitePriceUsd > 0
      ? "- A polished visual concept aligned with the brand and measurable calls to action."
      : null,
    input.automationPriceUsd > 0
      ? "- A practical lead follow-up workflow with human approval before any message is sent."
      : null,
    "- Mobile, form, link, and rollback QA before launch.",
  ].filter((line): line is string => Boolean(line));
  const subject = `A website concept for ${input.businessName}`;
  const body = [
    greeting,
    "",
    `I'm Robert, founder of Robert Websites. I reviewed ${input.businessName}'s public online presence and identified an opportunity to make it easier for prospective clients to understand your services and take the next step.`,
    "",
    "I'd like to show you a tailored website direction focused on clearer service positioning, stronger trust signals, mobile-first performance, and a streamlined path to inquiries or appointments.",
    "",
    "The initial scope includes:",
    ...scope,
    "",
    "Estimated investment:",
    `- Initial project: $${totalSetupUsd.toLocaleString("en-US")}`,
    `- 50% deposit to begin: $${depositUsd.toLocaleString("en-US")}`,
    input.monthlyRetainerUsd > 0
      ? `- Optional monthly support and optimization: $${input.monthlyRetainerUsd.toLocaleString("en-US")}/month`
      : null,
    "",
    "Before any work begins, we would confirm the final scope, content, priorities, and timeline. Any design direction would remain private until you approve it.",
    "",
    "Would you be open to a brief 15-minute call this week to discuss the direction and see whether it fits your goals?",
    "",
    "Best regards,",
    "Robert Manzanilla",
    "Founder, Robert Websites",
  ].filter((line): line is string => line !== null).join("\n");

  const hasRecipientEmail = input.recipientEmail.trim().length > 0;
  const encodedTo = encodeURIComponent(input.recipientEmail);
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);

  return {
    input,
    subject,
    body,
    pricing: {
      totalSetupUsd,
      depositUsd,
      monthlyRetainerUsd: input.monthlyRetainerUsd,
      estimatedInternalMonthlyCostUsd: input.estimatedInternalMonthlyCostUsd,
      grossMarginUsd,
      grossMarginPercent,
      insideCostCap: input.estimatedInternalMonthlyCostUsd <= 100,
    },
    delivery: {
      mode: "draft_only",
      sendStatus: "not_sent",
      reason: "No email provider is connected. Open Gmail/mailto or copy the draft after review.",
      requiresApproval: true,
    },
    links: {
      mailto: hasRecipientEmail ? `mailto:${encodedTo}?subject=${encodedSubject}&body=${encodedBody}` : "",
      gmailCompose: hasRecipientEmail ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSubject}&body=${encodedBody}` : "",
    },
  };
}

function buildRevenueScoutQueue(input: RevenueMoneySprintInput) {
  const parsed = revenueMoneySprintSchema.parse(input);
  const niches = parsed.niche
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  const safeNiches = niches.length ? niches : [parsed.niche];
  const tasks = safeNiches.flatMap((niche) => [
    {
      source: "google_search",
      query: `${niche} ${parsed.area} no website`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${niche} ${parsed.area} no website`)}`,
      evidenceToCapture: ["business name", "listing/profile URL", "website status", "contact path"],
    },
    {
      source: "google_maps_manual",
      query: `${niche} ${parsed.area} Google Maps`,
      url: `https://www.google.com/maps/search/${encodeURIComponent(`${niche} ${parsed.area}`)}`,
      evidenceToCapture: ["website field", "phone", "reviews recency", "photos/services"],
    },
    {
      source: "instagram_public",
      query: `${niche} ${parsed.area} Instagram`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${niche} ${parsed.area} site:instagram.com`)}`,
      evidenceToCapture: ["bio link", "recent posts", "booking/contact signal", "no website signal"],
    },
  ]);

  return tasks.slice(0, Math.max(3, Math.min(parsed.dailyResearchTarget, 30))).map((task, index) => ({
    id: `scout-task-${String(index + 1).padStart(2, "0")}`,
    ...task,
    ownerAgent: index % 3 === 0 ? "lead-scout" : index % 3 === 1 ? "business-researcher" : "qa-council",
    allowedAction: "research_public_evidence_only",
    blockedActions: ["automated scraping", "contact business", "buy data", "publish preview"],
  }));
}

function buildRevenueScoutWorkPack(input: RevenueMoneySprintInput, scoutQueue: ReturnType<typeof buildRevenueScoutQueue>) {
  const parsed = revenueMoneySprintSchema.parse(input);
  const columns = [
    "business",
    "area",
    "niche",
    "website",
    "channel",
    "contact",
    "sourceUrl",
    "recipientEmail",
    "evidence",
    "painPoint",
    "offer",
    "contactName",
    "summary",
  ];
  const targetRows = Math.min(parsed.dailyQualifiedLeadLimit, 10);
  const safeNiche = parsed.niche.split(",").map((item) => item.trim()).filter(Boolean)[0] || parsed.niche;
  const prioritizedSources = [
    {
      source: "Google Maps",
      query: `${safeNiche} ${parsed.area}`,
      evidenceGoal: "Confirmar campo website vacio/debil, reviews recientes, telefono/contacto y fotos/servicios activos.",
    },
    {
      source: "Google Search",
      query: `${safeNiche} ${parsed.area} no website`,
      evidenceGoal: "Encontrar directorios/listings publicos donde el negocio aparece sin website dedicado o con presencia incompleta.",
    },
    {
      source: "Instagram public",
      query: `${safeNiche} ${parsed.area} site:instagram.com`,
      evidenceGoal: "Validar actividad reciente, bio/contacto publico y ausencia de link a website fuerte.",
    },
  ];
  const opportunitySignals = [
    "no website field on Google Maps or public listing",
    "weak/mobile-poor website with no booking, menu, quote or lead form",
    "recent reviews/posts/photos proving the business is active",
    "public email, phone, contact form or DM handle visible without private data",
    "clear paid website use case: menu, booking, quote request, gallery, lead capture or follow-up",
  ];
  const dailyOperatingCadence = [
    `Morning: assign ${Math.min(scoutQueue.length, 6)} scout tasks across subagents and fill public evidence slots only.`,
    `Midday: approve only rows with ${columns.join(", ")} complete and sourceUrl tied to the business.`,
    "Afternoon: run Money Sprint preview from verified candidates; keep outreach as drafts until Robert approves contact.",
    "End of day: record replies/deposits only from manual outcomes with payment evidence; do not deploy without PR/App QA/Robert approval.",
  ];
  const placeholderRow = [
    "REPLACE_BUSINESS_NAME",
    parsed.area,
    safeNiche,
    "no_website",
    "email",
    "REPLACE_PUBLIC_CONTACT",
    "https://REPLACE_PUBLIC_SOURCE_URL",
    "owner@example.com",
    "Public listing/profile shows no dedicated website, recent service/product activity and a verifiable contact path.",
    "Needs a conversion-focused website, inquiry capture and follow-up.",
    "3500",
    "Owner",
    `REPLACE_BUSINESS_NAME in ${parsed.area} has public evidence of a missing or weak website and a clear ${parsed.offerFocus} opportunity.`,
  ].join("|");
  const copyableSearchPlaybook = [
    "Revenue Engine public business search playbook",
    "",
    `Market: ${parsed.area}`,
    `Niche: ${safeNiche}`,
    `Offer focus: ${parsed.offerFocus}`,
    `Target verified rows today: ${targetRows}`,
    "",
    "Prioritized sources:",
    ...prioritizedSources.map((item, index) => `${index + 1}. ${item.source}: ${item.query} -- ${item.evidenceGoal}`),
    "",
    "Opportunity signals:",
    ...opportunitySignals.map((signal) => `- ${signal}`),
    "",
    "Daily cadence:",
    ...dailyOperatingCadence.map((step) => `- ${step}`),
    "",
    "Safety:",
    "- Use public research only.",
    "- Do not contact businesses before Robert approval.",
    "- Do not buy data, scrape at scale, publish previews or deploy.",
    "- Do not import placeholders; every row needs public evidence, approvalToImport and explicit Robert approval.",
  ].join("\n");

  return {
    targetRows,
    batchHeader: columns.join("|"),
    copyableBatchTemplate: [
      columns.join("|"),
      ...Array.from({ length: Math.min(targetRows, 5) }, () => placeholderRow),
    ].join("\n"),
    subagentBrief: [
      `Find ${targetRows} real ${safeNiche} businesses in ${parsed.area} using only public sources.`,
      "Prioritize no-website or weak-website businesses with a visible contact path and recent activity.",
      "Do not contact businesses, buy data, scrape at scale, publish previews, or invent evidence.",
      "Return rows using the exact pipe-delimited batch header so Revenue Engine can preview, qualify and create draft-only outreach.",
    ].join(" "),
    searchPlaybook: {
      prioritizedSources,
      opportunitySignals,
      dailyOperatingCadence,
      copyableBrief: copyableSearchPlaybook,
    },
    importInstructions: [
      "Open the scout links.",
      "Capture real public evidence for each business.",
      "Paste completed rows into Batch leads.",
      "Run Preview batch before Money sprint.",
    ],
    qualityGate: [
      "Business name is real and area/niche match the mission.",
      "sourceUrl is a public listing, profile or business page used as evidence.",
      "website status is no_website or weak_website unless the opportunity is unusually strong.",
      "contact value and recipientEmail are public or business-provided.",
      "evidence is specific enough to justify a mockup and draft.",
    ],
    safety: {
      allowedAction: "public_research_only",
      blockedActions: scoutQueue.flatMap((task) => task.blockedActions).filter((action, index, actions) => actions.indexOf(action) === index),
      paidDataSpendUsd: 0,
      sendsOutreach: false,
      writesPreviewFiles: false,
    },
  };
}

function summarizeSeedLead(seed: RevenueMoneySprintSeedLeadInput) {
  if (seed.businessSummary.trim().length >= 40) return seed.businessSummary;
  return [
    `${seed.businessName} in ${seed.area} is a ${seed.niche} lead.`,
    seed.evidence || "Public evidence still needs review.",
    seed.painPoint || "Revenue opportunity needs confirmation.",
  ].join(" ");
}

function detectRevenueSeedBatchDelimiter(line: string): string {
  let quoted = false;
  const counts = { "|": 0, "\t": 0, ",": 0 };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === "|" || char === "\t" || char === ",")) {
      counts[char] += 1;
    }
  }

  if (counts["|"] > 0) return "|";
  if (counts["\t"] > 0) return "\t";
  return ",";
}

function splitRevenueSeedBatchLine(line: string): string[] {
  const delimiter = detectRevenueSeedBatchDelimiter(line);
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeSeedBatchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRevenueSeedBatchHeader(fields: string[]): boolean {
  const keys = fields.map(normalizeSeedBatchKey);
  return keys.some((key) => ["business", "businessname", "negocio", "name"].includes(key))
    && keys.some((key) => ["evidence", "evidencia"].includes(key));
}

function revenueSeedBatchValue(fields: string[], header: string[] | null, aliases: string[], fallbackIndex: number): string {
  if (header) {
    const index = header.findIndex((key) => aliases.includes(key));
    if (index >= 0) return fields[index] || "";
  }
  return fields[fallbackIndex] || "";
}

function normalizeRevenueSeedWebsiteStatus(value: string): RevenueLeadInput["websiteStatus"] {
  const normalized = normalizeSeedBatchKey(value);
  if (["nowebsite", "none", "missing", "sinwebsite", "no"].includes(normalized)) return "no_website";
  if (["weakwebsite", "weak", "old", "broken", "debil"].includes(normalized)) return "weak_website";
  if (["haswebsite", "has", "yes", "tienewebsite"].includes(normalized)) return "has_website";
  return "unknown";
}

function normalizeRevenueSeedContactChannel(value: string): RevenueLeadInput["contactChannel"] {
  const normalized = normalizeSeedBatchKey(value);
  if (normalized.includes("email") || normalized.includes("mail")) return "email";
  if (normalized.includes("phone") || normalized.includes("telefono") || normalized.includes("whatsapp")) return "phone";
  if (normalized.includes("instagram") || normalized.includes("ig")) return "instagram";
  if (normalized.includes("form")) return "contact_form";
  return "unknown";
}

function parseRevenueSeedOfferUsd(value: string): number {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2500;
}

export function parseRevenueMoneySprintSeedLeadBatch(
  batchText: string,
  defaults: Pick<RevenueMoneySprintInput, "area" | "niche">,
): { seedLeads: RevenueMoneySprintSeedLeadInput[]; blockedSeeds: Array<{ businessName: string; reason: string }> } {
  if (/#\s*public_candidate_review_gate\s*=\s*needs_review\b/i.test(batchText)) {
    return {
      seedLeads: [],
      blockedSeeds: [{
        businessName: "public candidate batch",
        reason: "public candidate review required before Money Sprint",
      }],
    };
  }

  const lines = batchText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(0, 50);
  if (!lines.length) return { seedLeads: [], blockedSeeds: [] };

  let rows = lines.map(splitRevenueSeedBatchLine);
  let header: string[] | null = null;
  if (rows.length > 0 && isRevenueSeedBatchHeader(rows[0])) {
    header = rows[0].map(normalizeSeedBatchKey);
    rows = rows.slice(1);
  }

  const seedLeads: RevenueMoneySprintSeedLeadInput[] = [];
  const blockedSeeds: Array<{ businessName: string; reason: string }> = [];

  for (const fields of rows) {
    if (seedLeads.length >= 25) {
      blockedSeeds.push({ businessName: fields[0] || "batch row", reason: "batch limit 25" });
      continue;
    }

    const candidate = {
      businessName: revenueSeedBatchValue(fields, header, ["business", "businessname", "negocio", "name"], 0),
      area: revenueSeedBatchValue(fields, header, ["area", "city", "ciudad"], 1) || defaults.area,
      niche: revenueSeedBatchValue(fields, header, ["niche", "nicho", "industry", "categoria"], 2) || defaults.niche,
      websiteStatus: normalizeRevenueSeedWebsiteStatus(revenueSeedBatchValue(fields, header, ["website", "websitestatus", "site"], 3)),
      contactChannel: normalizeRevenueSeedContactChannel(revenueSeedBatchValue(fields, header, ["contactchannel", "channel", "canal"], 4)),
      contactValue: revenueSeedBatchValue(fields, header, ["contactvalue", "contact", "contacto"], 5),
      sourceUrl: revenueSeedBatchValue(fields, header, ["sourceurl", "source", "url", "fuente"], 6),
      recipientEmail: revenueSeedBatchValue(fields, header, ["recipientemail", "email", "to"], 7),
      evidence: revenueSeedBatchValue(fields, header, ["evidence", "evidencia"], 8),
      painPoint: revenueSeedBatchValue(fields, header, ["painpoint", "pain", "dolor", "opportunity"], 9),
      estimatedOfferUsd: parseRevenueSeedOfferUsd(revenueSeedBatchValue(fields, header, ["estimatedofferusd", "offer", "price", "oferta"], 10)),
      contactName: revenueSeedBatchValue(fields, header, ["contactname", "nombre"], 11) || "Owner",
      businessSummary: revenueSeedBatchValue(fields, header, ["businesssummary", "summary", "resumen"], 12),
      status: "research",
    };
    const parsed = revenueMoneySprintSeedLeadSchema.safeParse(candidate);
    if (parsed.success) {
      const placeholderFields = revenuePlaceholderFieldNames(parsed.data);
      if (placeholderFields.length > 0) {
        blockedSeeds.push({
          businessName: parsed.data.businessName || "batch row",
          reason: `placeholder fields: ${placeholderFields.join(", ")}`,
        });
        continue;
      }
      const sourceBlocker = revenueSeedLeadSourceBlocker(parsed.data);
      if (sourceBlocker) {
        blockedSeeds.push({
          businessName: parsed.data.businessName || "batch row",
          reason: sourceBlocker,
        });
        continue;
      }
      seedLeads.push(parsed.data);
      continue;
    }
    blockedSeeds.push({
      businessName: candidate.businessName || "batch row",
      reason: parsed.error.issues.map((issue) => issue.message).join("; "),
    });
  }

  return { seedLeads, blockedSeeds };
}

export function previewRevenueMoneySprintSeeds(input: RevenueMoneySprintInput) {
  const parsed = revenueMoneySprintSchema.parse(input);
  const parsedBatch = parseRevenueMoneySprintSeedLeadBatch(parsed.seedLeadBatchText, { area: parsed.area, niche: parsed.niche });
  const availableBatchSlots = Math.max(0, 25 - parsed.seedLeads.length);
  const sprintSeedLeads = [
    ...parsed.seedLeads,
    ...parsedBatch.seedLeads.slice(0, availableBatchSlots),
  ];
  const blockedSeeds = [
    ...parsedBatch.blockedSeeds,
    ...parsedBatch.seedLeads.slice(availableBatchSlots).map((seed) => ({
      businessName: seed.businessName,
      reason: "batch limit 25",
    })),
  ];
  let previewMockupCount = 0;
  const acceptedSeeds = sprintSeedLeads.flatMap((seed, index) => {
    const sourceBlocker = revenueSeedLeadSourceBlocker(seed);
    if (sourceBlocker) {
      blockedSeeds.push({
        businessName: seed.businessName,
        reason: sourceBlocker,
      });
      return [];
    }
    const qualification = qualifyRevenueLead(seed);
    const hasSource = seed.sourceUrl.trim().length > 0;
    const hasDraftContactPath = revenueLeadHasDraftContactPath(seed);
    const mockupEligible = ["A", "B"].includes(qualification.grade);
    const mockupReady = mockupEligible && previewMockupCount < parsed.dailyMockupLimit;
    if (mockupReady) previewMockupCount += 1;
    const draftReady = hasSource && hasDraftContactPath && qualification.missing.length === 0;
    return [{
      rowNumber: index + 1,
      businessName: seed.businessName,
      area: seed.area,
      niche: seed.niche,
      websiteStatus: seed.websiteStatus,
      contactChannel: seed.contactChannel,
      contactValue: seed.contactValue,
      sourceUrl: seed.sourceUrl,
      recipientEmail: seed.recipientEmail,
      estimatedOfferUsd: seed.estimatedOfferUsd,
      qualification,
      mockupReady,
      draftReady,
      missingForDraft: [
        !hasSource && "sourceUrl publico",
        !hasDraftContactPath && "recipientEmail or manual contact URL",
        ...qualification.missing,
      ].filter((item): item is string => Boolean(item)),
    }];
  });
  const paidSpendBlocked = parsed.maxPaidDataSpendUsd > 0;

  return {
    status: paidSpendBlocked ? "needs_spend_approval" as const : acceptedSeeds.some((seed) => seed.mockupReady) ? "ready_to_import" as const : acceptedSeeds.length > 0 ? "needs_lead_evidence" as const : "empty" as const,
    acceptedSeeds,
    blockedSeeds,
    totals: {
      accepted: acceptedSeeds.length,
      blocked: blockedSeeds.length,
      mockupReady: acceptedSeeds.filter((seed) => seed.mockupReady).length,
      draftReady: acceptedSeeds.filter((seed) => seed.draftReady).length,
      maxImportable: 25,
    },
    safety: {
      persistsData: false,
      writesPreviewFiles: false,
      sendsOutreach: false,
      nextAction: paidSpendBlocked ? "Get Robert approval before running any paid data step; preview did not spend or persist." : acceptedSeeds.length > 0 ? "Review rows, then run Money sprint to persist selected batch and create draft-only outreach." : "Paste researched public leads before running preview.",
    },
  };
}

function revenueOutreachChannelFromLead(channel: RevenueLeadInput["contactChannel"]): RevenueOutreachDraftInput["channel"] {
  if (channel === "email") return "email";
  if (channel === "instagram") return "instagram";
  if (channel === "contact_form") return "contact_form";
  return "gmail";
}

export function runRevenueMoneySprint(input: RevenueMoneySprintInput) {
  const parsed = revenueMoneySprintSchema.parse(input);
  const mission = recordRevenueScoutingMission({
    area: parsed.area,
    niche: parsed.niche,
    offerFocus: parsed.offerFocus,
    targetLeadCount: parsed.dailyQualifiedLeadLimit,
    maxPaidDataSpendUsd: parsed.maxPaidDataSpendUsd,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });
  const radar = buildRevenueLeadRadar({
    area: parsed.area,
    niches: parsed.niche,
    offerFocus: parsed.offerFocus,
    runHoursPerDay: 24,
    dailyResearchTarget: parsed.dailyResearchTarget,
    dailyQualifiedLeadLimit: parsed.dailyQualifiedLeadLimit,
    dailyMockupLimit: parsed.dailyMockupLimit,
    dailyContactLimit: parsed.dailyContactLimit,
    maxPaidDataSpendUsd: parsed.maxPaidDataSpendUsd,
    requireRobertApprovalToContact: parsed.requireRobertApprovalToContact,
  });
  const templatePack = buildRevenueMockupTemplatePack({
    niche: parsed.niche,
    area: parsed.area,
    dailyMockupTarget: parsed.dailyMockupLimit,
    maxCustomMinutesPerMockup: 18,
    estimatedAiCostPerMockupUsd: 0,
  });
  const scoutQueue = buildRevenueScoutQueue(parsed);
  const scoutWorkPack = buildRevenueScoutWorkPack(parsed, scoutQueue);
  const recordedLeads: Array<ReturnType<typeof recordRevenueLead>> = [];
  const previews: Array<ReturnType<typeof buildRevenueMockupPreview>> = [];
  const outreachDrafts: Array<ReturnType<typeof recordRevenueOutreachDraft>> = [];
  const parsedBatch = parseRevenueMoneySprintSeedLeadBatch(parsed.seedLeadBatchText, { area: parsed.area, niche: parsed.niche });
  const availableBatchSlots = Math.max(0, 25 - parsed.seedLeads.length);
  const sprintSeedLeads = [
    ...parsed.seedLeads,
    ...parsedBatch.seedLeads.slice(0, availableBatchSlots),
  ];
  const blockedSeeds: Array<{ businessName: string; reason: string }> = [
    ...parsedBatch.blockedSeeds,
    ...parsedBatch.seedLeads.slice(availableBatchSlots).map((seed) => ({
      businessName: seed.businessName,
      reason: "batch limit 25",
    })),
  ];

  for (const seed of sprintSeedLeads) {
    const sourceBlocker = revenueSeedLeadSourceBlocker(seed);
    if (sourceBlocker) {
      blockedSeeds.push({
        businessName: seed.businessName,
        reason: sourceBlocker,
      });
      continue;
    }

    const leadResult = recordRevenueLead({
      businessName: seed.businessName,
      area: seed.area,
      niche: seed.niche,
      websiteStatus: seed.websiteStatus,
      contactChannel: seed.contactChannel,
      contactValue: seed.contactValue,
      evidence: seed.evidence,
      painPoint: seed.painPoint,
      estimatedOfferUsd: seed.estimatedOfferUsd,
      status: seed.status,
    });
    recordedLeads.push(leadResult);

    const hasSource = seed.sourceUrl.trim().length > 0;
    const isMockupCandidate = ["A", "B"].includes(leadResult.qualification.grade) && previews.length < parsed.dailyMockupLimit;
    let preview: ReturnType<typeof buildRevenueMockupPreview> | null = null;
    if (isMockupCandidate) {
      preview = buildRevenueMockupPreview({
        businessName: seed.businessName,
        area: seed.area,
        niche: seed.niche,
        websiteStatus: seed.websiteStatus,
        evidence: seed.evidence,
        painPoint: seed.painPoint,
        primaryOffer: parsed.offerFocus === "automations" ? "Automation Sprint + Revenue Dashboard" : "Business Website + Automation Sprint",
        estimatedOfferUsd: seed.estimatedOfferUsd,
        includeAutomation: parsed.offerFocus !== "websites",
      }, { writeFile: parsed.writePreviewFiles });
      previews.push(preview);
    }

    const hasDraftContactPath = revenueLeadHasDraftContactPath(seed);
    if (hasDraftContactPath && hasSource && leadResult.qualification.missing.length === 0) {
      outreachDrafts.push(recordRevenueOutreachDraft({
        leadId: leadResult.lead.id,
        channel: revenueOutreachChannelFromLead(seed.contactChannel),
        approvalStatus: "draft",
        recipientEmail: revenueEmailRecipientFromLead(seed),
        contactName: seed.contactName || "Owner",
        businessName: seed.businessName,
        sourceUrl: seed.sourceUrl,
        mockupUrl: preview?.previewUrl,
        businessSummary: summarizeSeedLead(seed),
        websitePriceUsd: parsed.offerFocus === "automations" ? 0 : clampRevenueWebsitePrice(parsed.offerFocus === "websites" ? seed.estimatedOfferUsd : seed.estimatedOfferUsd * 0.65),
        automationPriceUsd: parsed.offerFocus === "websites" ? 0 : Math.max(750, Math.round(seed.estimatedOfferUsd * 0.35)),
        monthlyRetainerUsd: 750,
        estimatedInternalMonthlyCostUsd: 54,
        notes: "Money sprint draft. No enviar sin aprobacion humana final.",
      }));
    } else if (hasDraftContactPath || hasSource || leadResult.qualification.missing.length > 0) {
      blockedSeeds.push({
        businessName: seed.businessName,
        reason: [
          !hasDraftContactPath && "falta recipientEmail o URL manual verificable",
          !hasSource && "falta sourceUrl publico",
          leadResult.qualification.missing.length > 0 && `resolver lead: ${leadResult.qualification.missing.join(", ")}`,
        ].filter(Boolean).join("; "),
      });
    }
  }

  const paidSpendBlocked = parsed.maxPaidDataSpendUsd > 0;
  const canStartSelling = !paidSpendBlocked && sprintSeedLeads.length > 0 && recordedLeads.some((result) => ["A", "B"].includes(result.qualification.grade));

  return {
    status: paidSpendBlocked ? "needs_spend_approval" as const : canStartSelling ? "ready_to_start" as const : "needs_lead_evidence" as const,
    mode: "free_public_research_first" as const,
    mission: mission.mission,
    radar,
    templatePack,
    scoutQueue,
    scoutWorkPack,
    recordedLeads: recordedLeads.map((result) => ({
      lead: result.lead,
      qualification: result.qualification,
      deduped: result.deduped,
    })),
    previews,
    outreachDrafts: outreachDrafts.map((result) => result.draft),
    blockedSeeds,
    operatingLimits: {
      maxQualifiedLeadsToday: parsed.dailyQualifiedLeadLimit,
      maxMockupsToday: parsed.dailyMockupLimit,
      maxContactsToday: parsed.dailyContactLimit,
      maxPaidDataSpendUsd: Math.min(parsed.maxPaidDataSpendUsd, REVENUE_MONTHLY_COST_CAP_USD),
      externalContactMode: parsed.requireRobertApprovalToContact ? "draft_until_robert_approves" : "approved_queue_only",
    },
    approvalGates: [
      "No automated scraping or paid data in the starting sprint.",
      "No outbound email, DM or contact form submission without Robert approval.",
      "No client delivery before scope, deposit, QA and rollback are clear.",
      "No paid hosting/tools before cash collected or explicit approval.",
    ],
    nextActions:
      recordedLeads.length === 0
        ? ["Open scoutQueue tasks, capture public evidence, then rerun with seedLeads.", "Start with 10 leads, create 3-5 previews, contact only approved drafts."]
        : ["Review generated previews.", "Approve only the best outreach drafts.", "Record replies/calls/deposits in ledger and improvement review."],
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildImprovementReview(input: ImprovementReviewInput) {
  const replyRate = input.leadsContacted > 0 ? Math.round((input.replies / input.leadsContacted) * 100) : 0;
  const bookingRate = input.replies > 0 ? Math.round((input.callsBooked / input.replies) * 100) : 0;
  const closeRate = input.callsBooked > 0 ? Math.round((input.dealsClosed / input.callsBooked) * 100) : 0;
  const profitUsd = input.revenueCollectedUsd - input.spendUsd - input.estimatedInternalMonthlyCostUsd;
  const roiPercent =
    input.spendUsd + input.estimatedInternalMonthlyCostUsd > 0
      ? Math.round((profitUsd / (input.spendUsd + input.estimatedInternalMonthlyCostUsd)) * 100)
      : input.revenueCollectedUsd > 0
        ? 100
        : 0;
  const grossMarginPercent =
    input.revenueCollectedUsd > 0
      ? Math.round(((input.revenueCollectedUsd - input.spendUsd - input.estimatedInternalMonthlyCostUsd) / input.revenueCollectedUsd) * 100)
      : 0;
  const costPerReplyUsd = input.replies > 0 ? Number((input.spendUsd / input.replies).toFixed(2)) : 0;
  const costPerBookedCallUsd = input.callsBooked > 0 ? Number((input.spendUsd / input.callsBooked).toFixed(2)) : 0;
  const insideSpendCap = input.spendUsd <= 100 && input.estimatedInternalMonthlyCostUsd <= 100;
  const profitable = profitUsd > 0 && grossMarginPercent >= 65;
  const qualityBlocked = input.clientComplaints > 0 || input.defectsFound >= 3;
  const cashBlocked = input.spendUsd >= 100 && input.revenueCollectedUsd === 0;
  const decision = qualityBlocked || cashBlocked || !insideSpendCap ? "pause_and_fix" : profitable ? "scale_carefully" : "iterate_small_batch";

  const experiments = [
    replyRate < 5 && "Cambiar el primer mensaje: abrir con evidencia especifica del negocio y una captura/mockup.",
    bookingRate < 25 && "Agregar CTA mas simple: llamada de 15 minutos o video de 90 segundos, no propuesta larga.",
    closeRate < 30 && "Probar oferta con deposito mas claro, garantia de QA y entrega por fases.",
    input.dealsClosed > 0 && "Duplicar el nicho/oferta que cerro, manteniendo el gasto semanal limitado.",
    input.hoursSaved > 0 && "Convertir horas ahorradas en prueba comercial para vender retainer.",
    input.defectsFound > 0 && "Agregar defectos encontrados al checklist antes del proximo envio.",
    input.clientComplaints > 0 && "Bloquear envio externo hasta revisar copy, promesas y aprobaciones.",
  ].filter(Boolean) as string[];

  const agentScorecard = [
    {
      agent: "lead-scout",
      score: replyRate >= 8 ? "pass" : "review",
      lesson: replyRate >= 8 ? "El targeting genero respuestas." : "Refinar nicho, evidencia y contacto antes de escalar.",
    },
    {
      agent: "closer",
      score: bookingRate >= 25 && closeRate >= 30 ? "pass" : "review",
      lesson: bookingRate >= 25 && closeRate >= 30 ? "El pitch convierte." : "Mejorar CTA, precio, prueba visual u objeciones.",
    },
    {
      agent: "automation-architect",
      score: input.hoursSaved > 0 || input.dealsClosed > 0 ? "pass" : "review",
      lesson: input.hoursSaved > 0 ? "Hay ROI operativo para vender retainer." : "Necesita prueba de ahorro, lead lift o venta.",
    },
    {
      agent: "qa-council",
      score: qualityBlocked ? "block" : "pass",
      lesson: qualityBlocked ? "Subir controles antes de contacto/entrega." : "Calidad lista para repetir con supervision.",
    },
    {
      agent: "cost-controller",
      score: !insideSpendCap || cashBlocked ? "block" : profitUsd >= 0 ? "pass" : "review",
      lesson:
        !insideSpendCap || cashBlocked
          ? "Reducir herramientas/outreach pagado o cerrar cash antes de gastar."
          : profitUsd >= 0
            ? "Gasto dentro del cap inicial y con retorno positivo."
            : "Gasto dentro del cap, pero falta cobrar antes de escalar.",
    },
  ];

  return {
    input,
    decision: {
      status: decision,
      reason:
        decision === "pause_and_fix"
          ? "No escalar: hay riesgo de calidad, costo o gasto sin ingresos cobrados."
          : decision === "scale_carefully"
            ? "La campana es rentable; repetir en batches pequenos y mantener aprobacion humana."
            : "Todavia no hay suficiente prueba de ROI; iterar con bajo gasto antes de escalar.",
      approvalMode: "human_approval_before_spend_or_send",
    },
    metrics: {
      replyRate,
      bookingRate,
      closeRate,
      profitUsd,
      roiPercent,
      grossMarginPercent,
      costPerReplyUsd,
      costPerBookedCallUsd,
      insideSpendCap,
      profitable,
    },
    experiments: experiments.length
      ? experiments
      : ["Mantener oferta actual, registrar objeciones nuevas y repetir solo con batch pequeno."],
    playbookUpdates: [
      input.bestOffer ? `Oferta que mejor performo: ${input.bestOffer}` : "Registrar oferta ganadora antes de escalar.",
      input.biggestObjection ? `Objecion principal: ${input.biggestObjection}` : "Recolectar objecion principal en cada llamada.",
      input.notes ? `Nota operativa: ${input.notes}` : "Guardar evidencia, capturas y metricas despues de cada batch.",
    ],
    agentScorecard,
    nextBatch: {
      maxLeads: decision === "scale_carefully" ? 25 : 10,
      maxSpendUsd: decision === "scale_carefully" ? Math.min(100, Math.max(20, input.revenueCollectedUsd * 0.05)) : 10,
      requiredBeforeNextSend:
        decision === "pause_and_fix"
          ? ["resolver bloqueos QA/costo", "aprobar nuevo mensaje", "confirmar cap menor a $100"]
          : ["aprobar mensaje", "usar evidencia publica", "guardar resultado y objecion"],
    },
  };
}

export function recordRevenueImprovementReview(input: ImprovementReviewInput) {
  loadRevenueImprovementReviews();
  const review = buildImprovementReview(input);
  const now = new Date().toISOString();
  const previousVersion = revenueImprovementReviews.reduce((max, item) => Math.max(max, item.playbookVersion), 0);
  const persisted: RevenueImprovementReview = {
    ...review,
    id: `improvement-${Date.now()}-${revenueImprovementReviews.length + 1}`,
    createdAt: now,
    updatedAt: now,
    playbookVersion: previousVersion + 1,
    decisionStatus: review.decision.status,
    learningSummary:
      review.decision.status === "scale_carefully"
        ? `Playbook v${previousVersion + 1}: escalar ${input.bestOffer || input.campaignName} con batch pequeno, cap ${review.nextBatch.maxSpendUsd} y aprobacion humana.`
        : review.decision.status === "pause_and_fix"
          ? `Playbook v${previousVersion + 1}: pausar ${input.campaignName}; resolver QA/costo antes de gastar o contactar.`
          : `Playbook v${previousVersion + 1}: iterar ${input.campaignName} con bajo gasto y guardar objeciones antes de escalar.`,
  };

  revenueImprovementReviews.push(persisted);
  persistRevenueImprovementReviews();

  return {
    review: persisted,
    snapshot: getRevenueEngineSnapshot(),
  };
}

export function buildRevenueEnginePlan(input: RevenueEnginePlanInput) {
  const budgetUsd = Math.min(input.monthlyBudgetUsd, 100);
  const freePublicResearch = budgetUsd === 0;
  const researchCostUsd = freePublicResearch ? 0 : Number((input.leadCount * 0.03).toFixed(2));
  const mockupSlots = Math.min(5, Math.max(1, Math.floor(input.leadCount / 5)));
  const mockupCostUsd = freePublicResearch ? 0 : Number((mockupSlots * 0.4).toFixed(2));
  const totalCostUsd = Number((researchCostUsd + mockupCostUsd).toFixed(2));
  const remainingBudgetUsd = Number((budgetUsd - totalCostUsd).toFixed(2));
  const offerLabel =
    input.offerFocus === "both"
      ? "websites premium y automatizaciones"
      : input.offerFocus === "websites"
        ? "websites premium"
        : "automatizaciones";

  return {
    input: { ...input, monthlyBudgetUsd: budgetUsd },
    budget: {
      monthlyCapUsd: budgetUsd,
      estimatedFirstBatchUsd: totalCostUsd,
      remainingBudgetUsd,
      isInsideCap: totalCostUsd <= budgetUsd,
      mode: freePublicResearch ? "free_public_research" : "low_cost_first",
    },
    target: {
      area: input.area,
      niche: input.niche,
      offer: offerLabel,
      batchSize: input.leadCount,
      qualification: [
        "No website visible en Google/Maps/social bio",
        "Negocio activo con fotos o posts recientes",
        "Tiene telefono, email, DM publico o formulario verificable",
        "Servicio con ticket suficiente para pagar $1.5k+",
        "Dolor claro: reservas, leads, menu, portfolio, pagos o seguimiento",
      ],
    },
    searchQueries: [
      `"${input.niche}" "${input.area}" "Facebook"`,
      `"${input.niche}" "${input.area}" "Instagram" "call"`,
      `"${input.niche}" "${input.area}" "Google Maps"`,
      `"${input.niche}" "${input.area}" "near me"`,
      `"${input.niche}" "${input.area}" "menu" OR "booking" OR "appointments"`,
    ],
    leadSlots: Array.from({ length: Math.min(input.leadCount, 10) }, (_, index) => ({
      id: `lead-slot-${String(index + 1).padStart(2, "0")}`,
      name: `${input.niche} prospect ${index + 1}`,
      area: input.area,
      status: index < 3 ? "research_ready" : "queued",
      evidenceNeeded: ["website check", "contact source", "recent activity", "offer fit"],
      nextAgent: index < 3 ? "business-researcher" : "lead-scout",
    })),
    mockupBrief: {
      style: "premium local brand, fast, mobile-first, optional 3D hero",
      sections: ["hero", "services", "proof", "gallery", "booking/contact", "automation upsell"],
      demoAngles: [
        "Antes/despues: sin website vs presencia premium",
        "Comparacion con 2-3 demos internas",
        "Automatizacion sugerida segun dolor del negocio",
      ],
      qaChecks: ["datos marcados como publicos", "no claims inventados", "links funcionando", "mobile", "margen positivo"],
    },
    outreachDraft: {
      channelPriority: ["email", "contact form", "Instagram DM", "phone follow-up manual"],
      firstMessage:
        `Vi que ${input.niche} en ${input.area} puede ganar mas leads con una presencia web mas fuerte. Prepare un mockup rapido para mostrar como se veria una version premium con ${offerLabel}. Si quieres, te lo mando para revisarlo sin compromiso.`,
      followUps: [
        "Enviar preview comparando website actual/no website contra mockup",
        "Preguntar si quieren leads, reservas, pagos o automatizar seguimiento",
        "Cerrar llamada de 15 minutos con una oferta simple y deposito",
      ],
      approvalStatus: "draft_only",
    },
    deliverySystem: {
      checkpoints: [
        "Discovery y data publica",
        "Mockup website",
        "Subagente QA visual",
        "Subagente QA negocio/margen",
        "Propuesta",
        "Deposito",
        "Build",
        "QA final",
        "Entrega y upsell automatizacion",
      ],
      improvementLoop: [
        "Guardar objeciones",
        "Medir tasa de respuesta",
        "Medir cierres por nicho",
        "Duplicar el nicho con mejor margen",
        "Pausar lo que gasta sin cobrar",
      ],
    },
  };
}
