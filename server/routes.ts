import type { Express } from "express";
import { createServer, type Server } from "http";
import { readFile as readNodeFile } from "fs/promises";
import { spawn } from "child_process";
import { storage } from "./storage";
import { insertTaskSchema, insertWeeklySummarySchema, insertMonthlyGoalSchema, insertYearlyGoalSchema, insertWeeklyTaskSchema, insertPushSubscriptionSchema } from "@shared/schema";
import { z } from "zod";
import { getCalendarEvents, isGoogleCalendarConnected } from "./google-calendar";
import { syncZohoCalendar, checkZohoConnection, getZohoAuthUrl, exchangeZohoCode } from "./zoho-calendar";
import { getVapidPublicKey, sendPushNotification } from "./push-notifications";
import { testMorningReminder, testEveningReminder, testWeeklyReminder, testProactiveInsights, testNewsDigest } from "./reminder-scheduler";
import { registerAssistantRoutes } from "./assistant";
import { getPrice, getMarketOverview, searchSymbol, getBatchCryptoPrices, getHistoricalData, getPortfolioNews, getMarketNews, getCompanyNews } from "./finance";
import { insertInvestmentSchema, insertTransactionSchema, insertWatchlistSchema, insertPriceAlertSchema, insertMonitoredProjectSchema, insertAppProjectSchema, insertAutomationDefinitionSchema } from "@shared/schema";
import { checkSingleProject } from "./health-check";
import { withUptimeHealth } from "@shared/app-health-uptime";
import { sendDailyMarketUpdateForUser, calculatePortfolioSummary } from "./market-news";
import { insertPortfolioHistorySchema, insertDjContactSchema } from "@shared/schema";
import { analyzeRadioEvents, sendRadioSlotsSummary, getRadioSlotsForMonth, importDjsFromRadioHistory, generateDjMessage } from "./radio-agent";
import { generateRadioTemplatesForDate } from "./radio-template-agent";
import { getPortfolioSummary, analyzeRebalancing, checkPriceOpportunities, generateWeeklyReport, sendWeeklyPortfolioReport, getGainsByPeriod } from "./portfolio-agent";
import { listAllActions, executeAction, executeMultipleActions, getActionsByCategory } from "./agent-actions";
import { readFile, writeFile, listFiles, getChangeHistory, undoLastChange, getTableSchema, executeQuery, getProjectStructure, addColumnToTable, createTable, getTableInfo } from "./code-agent";
import { generateCode, generateFromTemplate, MODULE_TEMPLATES } from "./code-generator";
import { listRepositories, getRepoContents, getFileContent, updateFile, deleteFile, getAuthenticatedUser, isGitHubConnected, getRepositoryOverview, getGitHubPullRequestReleaseStatus, parseGitHubPullRequestUrl } from "./github-client";
import { getCurrentUserId, getSystemUserId, isPublicApiRequest } from "./user-context";
import { syncGoogleCalendarToTasks } from "./calendar-sync";
import { executeApprovedPendingAction } from "./trust-executor";
import { createPendingActionForApproval, writeAuditLog } from "./trust-policy";
import { getExistingAutomations, recordManualAutomationRun } from "./automation-registry";
import { getMetricoolAnalyticsSyncStatus, getMetricoolAnalyticsSchedulerStatus, syncMetricoolAnalytics } from "./metricool-analytics-sync";
import { getMeetingPrepById, getUpcomingMeetingPreps } from "./meeting-intelligence";
import { buildCeoOperationalHealth } from "./ceo-operational-health";
import { registerTelegramRoutes } from "./telegram-routes";
import { registerRevenueStripeRoutes } from "./revenue-stripe-routes";
import { registerAgentCouncilRoutes } from "./agent-council-routes";
import { registerAgentChatRoutes } from "./agent-chat-routes";
import { registerKongOperationsRoutes } from "./kong-operations-routes";
import { registerBlackRoomTeamRoutes } from "./blackroom-team-routes";
import { registerBlackRoomCeoChatRoutes } from "./blackroom-ceo-chat-routes";
import { getKongOperations } from "./kong-operations";
import { createCanvaAuthorizationUrl, exchangeCanvaAuthorizationCode, getCanvaOAuthStatus } from "./canva-oauth";
import { createGoogleDriveAuthorizationUrl, exchangeGoogleDriveAuthorizationCode, getGoogleDriveOAuthStatus } from "./google-drive-oauth";
import { ensureAppDriveStructure } from "./google-drive";
import { deletePromoOutputVideo, getPromoVideoStatus, importPromoVideosFromSource, normalizePromoVideoOptions, runPromoVideoAutoDaily, runPromoVideoEdit, setPromoVideoSourceDir } from "./promo-video-agent";
import { extractRevenueMockupContentSecurityPolicy } from "./revenue-engine";
import { revenueOutreachUpdateSchema, updateRevenueOutreachDraft } from "./revenue-engine";
import { bootstrapClipperAccounts, bootstrapClipperWorkspace, getClipperConnectAction, getClipperStatus, importClipperCredentialDropFiles, importClipperLaunchEvidenceDropFiles, importClipperMetricoolApprovalEvidence, importClipperSourceDropFiles, ingestClipperMetrics, ingestClipperTrends, prepareClipper100ClipsExecutionSprint, prepareClipperAccountCreationPack, prepareClipperAccountEvidenceVault, prepareClipperAccountIdentityKit, prepareClipperAccountLaunchKit, prepareClipperAccountSetupSession, prepareClipperAnalyticsReportingPack, prepareClipperAppReviewDemoPack, prepareClipperAppReviewSubmissionPack, prepareClipperAutomationSchedule, prepareClipperBlockerResolutionPack, prepareClipperCredentialDoctor, prepareClipperCredentialDropStarter, prepareClipperCredentialSetupCenter, prepareClipperDeveloperAppEvidenceVault, prepareClipperDeveloperApplicationDrafts, prepareClipperDraftSpecs, prepareClipperDriveWorkspace, prepareClipperDropzoneReadyPack, prepareClipperExternalAccountPermissionSprint, prepareClipperExternalConnectSprint, prepareClipperExternalExecutionHandoff, prepareClipperExternalExecutionSession, prepareClipperExternalLaunchDossier, prepareClipperExternalSetupQueue, prepareClipperGoLiveAutopilotBrief, prepareClipperGoLiveCompletionAudit, prepareClipperGoLiveOperatorBrief, prepareClipperGoLiveEvidenceBundle, prepareClipperGoLiveExecutionPack, prepareClipperHttpsTunnelPlan, prepareClipperIntakeKit, prepareClipperLaunchCommandCenter, prepareClipperLaunchEvidenceFixPack, prepareClipperLaunchLaneMatrix, prepareClipperLegalPolicyPack, prepareClipperManualPostingPack, prepareClipperMetricoolApprovalReport, prepareClipperMetricoolApprovalSession, prepareClipperMetricoolExecutionQueue, prepareClipperMetricoolMvpLaunchPack, prepareClipperMetricoolPublishingPlan, prepareClipperOAuthConnectionPack, prepareClipperOAuthGoLivePreflight, prepareClipperOfficialPermissionMatrix, prepareClipperOfficialPermissionSourceAudit, prepareClipperOwnerConnectPack, prepareClipperPermissionPack, prepareClipperPermissionRequestPack, prepareClipperPermissionSubmissionDossier, prepareClipperPermissionTracker, prepareClipperPlatformPortalChecklist, prepareClipperPlatformReadinessMatrix, prepareClipperProductionQueue, prepareClipperProductionUrlSetup, prepareClipperPublisherConnectors, prepareClipperPublisherExecutionQueue, prepareClipperPublishingPackage, prepareClipperRightsEvidenceLedger, prepareClipperRightsOutreachPack, prepareClipperRobertNextActions, prepareClipperSourceAcquisitionPlan, prepareClipperSourceDiscoveryHandoff, prepareClipperSourceHuntSheet, prepareClipperSourceIngestionSprint, prepareClipperSourceScout, prepareClipperSourceScoutDailySprint, prepareClipperSourceScoutExactUrlKit, prepareClipperSourceScoutPermissionPack, prepareClipperSourceScoutSourceFileKit, prepareClipperSourceScoutWorkQueue, prepareClipperSourceSupplyDropKit, prepareClipperTrendRightsOutreachPack, prepareClipperViralDiscoveryPack, prepareClipperWeeklyProductionFunnel, previewClipperCredentialSecretsBatch, previewClipperLaunchEvidenceBatch, readClipperReport, recordClipperAccountEvidence, recordClipperCredentialSecret, recordClipperCredentialSecretsBatch, recordClipperDeveloperAppEvidence, recordClipperLaunchEvidenceBatch, recordClipperMetricoolAccountEvidence, recordClipperOAuthCallback, recordClipperOwnerConnectProgress, recordClipperPermissionStatus, recordClipperProductionPublicUrl, recordClipperSourceIntakeBatch, recordClipperSourceRights, recordClipperSourceScoutIntake, recordClipperTrendCandidatesBatch, reloadClipperCredentials, renderClipperAppReviewDemoHtml, renderClipperDraftVideos, renderClipperPrivacyPolicyHtml, renderClipperTermsOfServiceHtml, runClipperAutomationCycle, runClipperDailyPlan, runClipperExternalCloseoutPack, runClipperExternalConnectAutopilot, runClipperGoLiveAutopilot, runClipperGoLivePrepSweep, runClipperIntakeRefreshSweep, runClipperLocalDropSync, runClipperPostConnectActivationSweep, verifyClipperProductionLocalPreflight, verifyClipperProductionUrl } from "./clippers-agent";
import { bootstrapClipperLocalNews, getClipperLocalNewsStatus, ingestClipperLocalNewsEvents, recordClipperLocalNewsMetrics, runClipperLocalNewsCycle } from "./clippers-local-news-agent";
import { deliverClipperLocalNewsToMetricool, getClipperLocalNewsMetricoolReadiness } from "./clippers-local-news-metricool";
import { readLocalNewsDeliveryPolicy } from "./local-news-delivery-safety";
import { getClipperLocalNewsSchedulerStatus } from "./clippers-local-news-scheduler";
import { getLocalNewsGrowthScoutStatus, readLocalNewsGrowthScoutStatus, runLocalNewsGrowthScoutNow } from "./local-news-growth-scout";
import { getPublicLocalNewsBySlug, listPublicLocalNews, publicLocalNewsEtag, renderPublicLocalNewsShareHtml } from "./public-local-news";
import { answerRevenueAutomationIntake, approveRevenueOutreachDraft, approveRevenuePublicLeadCandidate, automationQuoteSchema, buildAutomationQuote, buildDeliveryReview, buildProposalEmail, buildRevenueEnginePlan, buildRevenueLaunchReadiness, buildRevenueLeadRadar, buildRevenueMockup, buildRevenueMockupTemplatePack, buildRevenueProjectPlan, closeRevenueAutomationOpportunity, closeRevenueWebsiteOpportunity, convertRevenueAutomationIntakeToOpportunity, createDeliveryWorkspaceFromAutomationOpportunity, createWebsiteDeliveryWorkspaceFromLead, deliverRevenueDeliveryWorkspace, deliverRevenueDeliveryWorkspaceFromTrustedApproval, deliveryReviewSchema, flushRevenueEnginePersistence, getRevenueDeliveryWorkspaceById, getRevenueEngineSnapshot, getRevenueMockupPreviewPath, getRevenueWebsiteWorkspaceSaleGate, improvementReviewSchema, isRevenueCodexBranchName, preflightRevenueExpense, prepareRevenueEngineState, previewRevenueMoneySprintSeeds, proposalEmailSchema, recordRevenueAgentRun, recordRevenueApprovalDecision, recordRevenueAutomationIntake, recordRevenueAutomationOpportunity, recordRevenueDeliveryReleaseGate, recordRevenueDeliveryWorkspace, recordRevenueDeliveryWorkspaceImprovementReview, recordRevenueImprovementReview, recordRevenueLead, recordRevenueLedgerEntry, recordRevenueOutreachDraft, recordRevenueOutreachOutcome, recordRevenuePublicLeadCandidate, recordRevenuePublicLeadCandidateBatch, recordRevenuePublicScoutEvidence, recordRevenueSalesAutopilot, recordRevenueScoutingMission, recordRevenueVerifiedScoutConnectorResults, recordRevenueWebsiteOpportunity, revenueAgentRunSchema, revenueApprovalDecisionSchema, revenueAutomationAgentCommandSchema, revenueAutomationIntakeAnswerSchema, revenueAutomationIntakeConvertSchema, revenueAutomationIntakeSchema, revenueAutomationOpportunityCloseSchema, revenueAutomationOpportunityDeliverySchema, revenueAutomationOpportunitySchema, revenueDailyScoutSprintSchema, revenueDailyScoutSprintSubmitSchema, revenueDeliveryWorkspaceDeliverSchema, revenueDeliveryWorkspaceGithubHandoffSchema, revenueDeliveryWorkspaceImprovementReviewSchema, revenueDeliveryWorkspaceSchema, revenueDeliveryWorkspaceUpdateSchema, revenueEnginePlanSchema, revenueExpensePreflightSchema, revenueLaunchReadinessSchema, revenueLeadRadarSchema, revenueLeadSchema, revenueLedgerEntrySchema, revenueMockupSchema, revenueMockupTemplatePackSchema, revenueMoneySprintFromPublicCandidatesSchema, revenueMoneySprintSchema, revenueOutreachApproveSchema, revenueOutreachDraftSchema, revenueOutreachOutcomeSchema, revenueOutreachSendSchema, revenueProjectPlanSchema, revenuePublicLeadCandidateApproveSchema, revenuePublicLeadCandidateBatchSchema, revenuePublicLeadCandidateSchema, revenuePublicScoutAgentCommandSchema, revenuePublicScoutEvidenceSchema, revenueSalesAutopilotSchema, revenueScoutingMissionSchema, revenueVerifiedScoutConnectorSchema, revenueWebsiteDeliveryWorkspaceSchema, revenueWebsiteOpportunityCloseSchema, revenueWebsiteOpportunitySchema, runRevenueAutomationAgentCommand, runRevenueDailyScoutSprint, runRevenueMoneySprint, runRevenueMoneySprintFromPublicCandidates, runRevenuePublicScoutAgentCommand, runRevenueScoutDispatch, sendRevenueOutreachDraft, submitRevenueDailyScoutSprintEvidence, updateRevenueDeliveryWorkspaceQa } from "./revenue-engine";
import { analyzeDropshippingSocialPerformance, buildDropshippingCapitalPlan, buildDropshippingDailyReport, buildDropshippingGrowthSprint, buildDropshippingLaunchPack, buildDropshippingLaunchPlan, buildDropshippingMarketingCampaign, createDropshippingProductScoutCandidate, createDropshippingShopifyDraft, createDropshippingSocialPostBatch, dropshippingApprovalDecisionSchema, dropshippingApprovalOutboxMigrationSchema, dropshippingAutopilotProductHunterSchema, dropshippingCapitalPlanSchema, dropshippingCeoCycleSchema, dropshippingFulfillmentSchema, dropshippingGrowthSprintSchema, dropshippingLaunchPackApprovalQueueSchema, dropshippingLaunchPackSchema, dropshippingLaunchPlanSchema, dropshippingLedgerEntrySchema, dropshippingLearningReviewSchema, dropshippingMarketingCampaignSchema, dropshippingOrderSchema, dropshippingProductResearchSchema, dropshippingProductScoutBatchSchema, dropshippingProductScoutCandidateSchema, dropshippingProductScoutPromotionSchema, dropshippingShopifyDraftSchema, dropshippingSocialAnalysisSchema, dropshippingSocialMetricsSchema, dropshippingSocialPostBatchSchema, dropshippingSocialPublishSchema, dropshippingSupplierReviewSchema, getDropshippingCeoSnapshot, getDropshippingExecutionSetup, getDropshippingLaunchReadiness, getDropshippingLiveSignalReadiness, markDropshippingApprovalOutboxQueued, prepareDropshippingApprovalOutboxMigration, prepareDropshippingFulfillment, prepareDropshippingLaunchPackApprovalQueue, preflightDropshippingShopifyDraft, promoteDropshippingScoutCandidate, publishDropshippingSocialPost, recordDropshippingApprovalDecision, recordDropshippingApprovalOutboxRequests, recordDropshippingLedgerEntry, recordDropshippingLearningReview, recordDropshippingOrder, recordDropshippingSocialMetrics, researchDropshippingProduct, reviewDropshippingSupplier, runDropshippingAutopilotProductHunter, runDropshippingCeoCycle, runDropshippingDailyOperatingCycle, runDropshippingProductScoutBatch, sendDropshippingDailyReport } from "./dropshipping-ceo";
import {registerMarketingLearningRoutes} from "./marketing-learning-routes";
import { importMissingGithubApps, runCybersecurityScan } from "./cybersecurity-agent";
import { runLegalComplianceReports } from "./legal-compliance-agent";
import { runAppQaScan } from "./app-qa-agent";
import { createDeveloperAutopilotHandoff, createDeveloperAutopilotHandoffFromRequest, evaluateDeveloperReleaseGate } from "./developer-autopilot";
import { buildMonthlyAiSpendReport } from "./ai-cost-policy";
import { getClipperWorkerRuntimeStatus } from "./clippers-runtime-status";
import { registerOfficeRoutes } from "./office-routes";
import { registerOfficeBusinessRoutes } from "./office-business-routes";
import { registerSoftwareFactoryRoutes } from "./software-factory-routes";
import { getFactoryOfficeAdmission } from "./software-factory-office-connection";
import { getAuthenticatedCurrentUserId } from "./user-context";
import { officeRuntime } from "./office-runtime";
import { loadOfficePullRequest } from "./office-github";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildClipperExternalCloseoutNextActionCopyPacket(nextAction: any): string {
  if (!nextAction) return "";
  const missingFields = Array.isArray(nextAction.missingCsvFields) ? nextAction.missingCsvFields.join(", ") : "none";
  const blockers = Array.isArray(nextAction.blockers) ? nextAction.blockers : [];
  return [
    `Next external action: ${nextAction.id}`,
    `Lane: ${nextAction.lane || "unknown"}`,
    `Platform: ${nextAction.platform || "unknown"}`,
    `Action: ${nextAction.operatorAction || "Complete the external closeout action."}`,
    `Portal: ${nextAction.portalUrl || "n/a"}`,
    nextAction.docsUrl ? `Docs: ${nextAction.docsUrl}` : null,
    nextAction.redirectUri ? `Redirect URI / callback to register: ${nextAction.redirectUri}` : null,
    `Proof file to fill: ${nextAction.proofPath || "n/a"}`,
    `Required CSV status: ${nextAction.requiredCsvStatus || "n/a"}`,
    `Missing CSV fields: ${missingFields}`,
    `CSV hint: ${nextAction.csvEditHint || "Fill only real non-secret evidence after the portal action is done."}`,
    "",
    "Proof file template:",
    `# External closeout proof - ${nextAction.id}`,
    "",
    `- Platform: ${nextAction.platform || ""}`,
    `- Lane: ${nextAction.lane || ""}`,
    `- Required status: ${nextAction.requiredCsvStatus || ""}`,
    `- Public app/account identifier: <paste public id only, never client secret>`,
    `- Proof URL or ticket ID: <paste non-secret review URL/ticket/public portal URL>`,
    `- Local proof path, if used: ${nextAction.proofPath || "<local proof markdown path>"}`,
    `- Registered redirect URI: ${nextAction.redirectUri || "n/a"}`,
    "- Notes: <20+ characters explaining what was submitted/created and when>",
    "",
    "Evidence CSV row guide:",
    `kind=${nextAction.lane || ""}`,
    `account_id=${nextAction.accountId || ""}`,
    `platform=${nextAction.platform || ""}`,
    `status=${nextAction.requiredCsvStatus || ""}`,
    `scope=${nextAction.scope || ""}`,
    "app_identifier=<public app id if this is a developer app>",
    "proof=<proof URL, ticket ID or local proof file path>",
    "notes=<real operator note; no placeholders>",
    "",
    "Safety guardrails:",
    "- Do not paste passwords, cookies, client secrets, OAuth tokens, refresh tokens, recovery codes, signed URLs or private screenshots.",
    "- Do not mark this done until the portal action is real and the proof file has non-placeholder evidence.",
    "- Metricool stays approval_required; this packet does not enable automatic publishing.",
    "",
    blockers.length ? "Current blockers:" : "Current blockers: none",
    ...blockers.map((blocker: unknown) => `- ${String(blocker)}`),
  ].filter((line): line is string => line !== null).join("\n");
}

export function enrichClipperExternalCloseoutOperatorRows(rows: unknown): any[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row: any) => ({
    ...row,
    copyPacket: buildClipperExternalCloseoutNextActionCopyPacket(row),
  }));
}

function clipperCsvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function publicBaseUrlFromRedirectUri(redirectUri: unknown): string {
  try {
    const parsed = new URL(String(redirectUri || ""));
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isPrivateHost = host === "localhost"
      || host.endsWith(".localhost")
      || host === "0.0.0.0"
      || /^127\./.test(host)
      || host === "::1"
      || /^10\./.test(host)
      || /^169\.254\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      || /^f[cd][0-9a-f]{2}:/i.test(host)
      || /^fe80:/i.test(host);
    if (parsed.protocol !== "https:" || isPrivateHost) return "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function clipperUniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

export function buildClipperExternalCloseoutEvidenceCsvTemplate(rows: unknown): string {
  const enrichedRows = enrichClipperExternalCloseoutOperatorRows(rows);
  if (!enrichedRows.length) return "";
  const header = "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes";
  const body = enrichedRows.map((row: any) => {
    const lane = String(row.lane || "");
    const isDeveloperApp = lane === "developer_app";
    const isPermission = lane === "permission";
    const appIdentifier = isDeveloperApp ? `<public ${row.platform || "platform"} app id>` : "";
    const notes = `<replace with 20+ char real operator note for ${row.id || "closeout item"}>`;
    return [
      lane === "account" ? "account" : isDeveloperApp ? "developer_app" : "permission",
      lane === "account" ? row.accountId || "" : "",
      row.platform || "",
      row.requiredCsvStatus || "",
      isPermission ? row.scope || "" : "",
      appIdentifier,
      isDeveloperApp ? publicBaseUrlFromRedirectUri(row.redirectUri) : "",
      row.redirectUri || "",
      row.portalUrl || "",
      row.docsUrl || "",
      row.proofPath || "",
      notes,
    ].map(clipperCsvCell).join(",");
  });
  return `${header}\n${body.join("\n")}\n`;
}

export function buildClipperExternalCloseoutSprintSummary(rows: unknown) {
  const enrichedRows = enrichClipperExternalCloseoutOperatorRows(rows);
  const byLane = enrichedRows.reduce<Record<string, number>>((sum, row: any) => {
    const lane = String(row.lane || "unknown");
    sum[lane] = (sum[lane] || 0) + 1;
    return sum;
  }, {});
  const byPriority = enrichedRows.reduce<Record<string, number>>((sum, row: any) => {
    const priority = String(row.priority || "unknown");
    sum[priority] = (sum[priority] || 0) + 1;
    return sum;
  }, {});
  const firstCritical = enrichedRows.find((row: any) => row.priority === "critical") || enrichedRows[0] || null;
  const criticalDeveloperApps = enrichedRows.filter((row: any) => row.priority === "critical" && row.lane === "developer_app").length;
  const criticalPermissions = enrichedRows.filter((row: any) => row.priority === "critical" && row.lane === "permission").length;
  const accountProofs = enrichedRows.filter((row: any) => row.lane === "account").length;
  const platformRows = Object.values(enrichedRows.reduce<Record<string, any>>((groups, row: any) => {
    const platform = String(row.platform || "unknown");
    const group = groups[platform] || {
      platform,
      totalActions: 0,
      criticalActions: 0,
      highActions: 0,
      accountProofs: 0,
      developerApps: 0,
      permissions: 0,
      firstActionId: null,
      firstActionLane: null,
      firstActionPriority: null,
      portalUrls: [] as string[],
      docsUrls: [] as string[],
      proofPaths: [] as string[],
      missingCsvFields: [] as string[],
      nextStep: "",
    };
    group.totalActions += 1;
    if (row.priority === "critical") group.criticalActions += 1;
    if (row.priority === "high") group.highActions += 1;
    if (row.lane === "account") group.accountProofs += 1;
    if (row.lane === "developer_app") group.developerApps += 1;
    if (row.lane === "permission") group.permissions += 1;
    if (!group.firstActionId) {
      group.firstActionId = row.id || null;
      group.firstActionLane = row.lane || null;
      group.firstActionPriority = row.priority || null;
      group.nextStep = row.operatorAction
        ? `Open ${platform} portal and complete ${row.id}: ${row.operatorAction}`
        : `Open ${platform} portal and complete ${row.id || "the first external action"}.`;
    }
    group.portalUrls = clipperUniqueStrings([...group.portalUrls, row.portalUrl]);
    group.docsUrls = clipperUniqueStrings([...group.docsUrls, row.docsUrl]);
    group.proofPaths = clipperUniqueStrings([...group.proofPaths, row.proofPath]);
    group.missingCsvFields = clipperUniqueStrings([...group.missingCsvFields, ...(Array.isArray(row.missingCsvFields) ? row.missingCsvFields : [])]);
    groups[platform] = group;
    return groups;
  }, {})).sort((left: any, right: any) =>
    right.criticalActions - left.criticalActions
    || right.developerApps - left.developerApps
    || right.permissions - left.permissions
    || right.totalActions - left.totalActions
    || String(left.platform).localeCompare(String(right.platform))
  );
  const nextStep = firstCritical
    ? `Start with ${firstCritical.id}: ${firstCritical.operatorAction || "complete the first real portal action and capture proof."}`
    : "No external closeout actions remain.";
  return {
    totalActions: enrichedRows.length,
    criticalActions: byPriority.critical || 0,
    highActions: byPriority.high || 0,
    accountProofs,
    developerApps: byLane.developer_app || 0,
    permissions: byLane.permission || 0,
    criticalDeveloperApps,
    criticalPermissions,
    firstActionId: firstCritical?.id || null,
    firstActionLane: firstCritical?.lane || null,
    firstActionPlatform: firstCritical?.platform || null,
    platformRows,
    nextStep,
    safety: [
      "Do not paste passwords, cookies, client secrets, OAuth tokens, refresh tokens, recovery codes or signed/private screenshots.",
      "Only import rows after proof files contain real non-placeholder evidence.",
      "Metricool remains approval_required; this sprint summary does not enable automatic publishing.",
    ],
  };
}

export function buildClipperExternalCloseoutBatchCopyPacket(rows: unknown): string {
  const enrichedRows = enrichClipperExternalCloseoutOperatorRows(rows);
  if (!enrichedRows.length) return "";
  return [
    "Clippers External Closeout Batch Packet",
    "",
    `Actions: ${enrichedRows.length}`,
    "Use this for one portal-work session. Complete only actions that are real in the external portal, then fill proof files and import the evidence CSV.",
    "",
    "Safety guardrails:",
    "- Do not paste passwords, cookies, client secrets, OAuth tokens, refresh tokens, recovery codes, signed URLs or private screenshots.",
    "- Do not mark any item done until the matching proof file has real non-placeholder evidence.",
    "- Metricool stays approval_required; this packet does not enable automatic publishing.",
    "- Evidence CSV template rows include placeholders; replace them before preview/apply.",
    "",
    ...enrichedRows.flatMap((row: any, index: number) => [
      `--- Action ${index + 1}: ${row.id} ---`,
      row.copyPacket,
      "",
    ]),
  ].join("\n");
}

let revenueEngineRouteQueue = Promise.resolve();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerOfficeRoutes(app);
  registerOfficeBusinessRoutes(app);
  registerSoftwareFactoryRoutes(app, {resolveCompanyAdmission:getFactoryOfficeAdmission});
  const CLIPPER_ROUTE_SCRIPT_TIMEOUT_MS = 120_000;
  const killClipperRouteScriptProcess = (child: ReturnType<typeof spawn>) => {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
        return;
      } catch {
        // Fall back to killing only the direct child when process groups are unavailable.
      }
    }
    child.kill("SIGKILL");
  };
  const runClipperNodeJson = (args: string[], label: string, timeoutMs = CLIPPER_ROUTE_SCRIPT_TIMEOUT_MS) => new Promise<any>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killClipperRouteScriptProcess(child);
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(`${label} failed with code ${code}${stderr ? `\n${stderr}` : ""}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (error: any) {
          reject(new Error(`${label} returned invalid JSON: ${error.message}`));
        }
      });
    });
  });
  const runClipperJsonScript = (scriptPath: string, label: string) => runClipperNodeJson([scriptPath], label);
  const runClipperAccountPermissionReadiness = () => runClipperJsonScript("script/clippers-account-permission-readiness.mjs", "Account permission readiness");
  const runClipperOperationalReadiness = () => runClipperJsonScript("script/clippers-operational-readiness.mjs", "Operational readiness");
  const runClipperExternalCloseoutEvidenceImport = (apply: boolean, applyReady = false) => {
    const args = ["--import", "tsx", "script/clippers-import-external-closeout-evidence.ts"];
    if (apply) args.push("--apply");
    if (applyReady) args.push("--apply-ready");
    return runClipperNodeJson(args, "External closeout evidence import");
  };
  const readClipperAccountPermissionReadiness = async () => {
    const raw = await readNodeFile("clippers_workspace/account-permission-readiness.json", "utf8");
    return JSON.parse(raw);
  };
  const readClipperOperationalReadiness = async () => {
    const raw = await readNodeFile("clippers_workspace/reports/clippers-operational-readiness.json", "utf8");
    return JSON.parse(raw);
  };
  const readClipperExternalCloseoutPack = async () => {
    const raw = await readNodeFile("clippers_workspace/reports/clippers-external-closeout-pack.json", "utf8");
    const parsed = JSON.parse(raw);
    const operatorQueue = enrichClipperExternalCloseoutOperatorRows(parsed.operatorQueue);
    return {
      ...parsed,
      operatorQueue,
      sprintSummary: buildClipperExternalCloseoutSprintSummary(operatorQueue),
      batchCopyPacket: buildClipperExternalCloseoutBatchCopyPacket(operatorQueue),
      evidenceCsvTemplate: buildClipperExternalCloseoutEvidenceCsvTemplate(operatorQueue),
    };
  };
  const readClipperExternalCloseoutProofTodo = async () => {
    const raw = await readNodeFile("clippers_workspace/reports/clippers-external-closeout-proof-todo.json", "utf8");
    const parsed = JSON.parse(raw);
    const operatorQueue = enrichClipperExternalCloseoutOperatorRows(parsed.operatorQueue);
    return {
      ...parsed,
      operatorQueue,
      sprintSummary: buildClipperExternalCloseoutSprintSummary(operatorQueue),
      batchCopyPacket: buildClipperExternalCloseoutBatchCopyPacket(operatorQueue),
      evidenceCsvTemplate: buildClipperExternalCloseoutEvidenceCsvTemplate(operatorQueue),
    };
  };
  const readClipperExternalCloseoutOperatorQueue = async () => {
    const raw = await readNodeFile("clippers_workspace/reports/clippers-external-closeout-operator-queue.json", "utf8");
    const parsed = JSON.parse(raw);
    const rows = enrichClipperExternalCloseoutOperatorRows(parsed.rows);
    return {
      ...parsed,
      rows,
      sprintSummary: buildClipperExternalCloseoutSprintSummary(rows),
      batchCopyPacket: buildClipperExternalCloseoutBatchCopyPacket(rows),
      evidenceCsvTemplate: buildClipperExternalCloseoutEvidenceCsvTemplate(rows),
    };
  };
  const readClipperExternalCloseoutNextAction = async () => {
    const operatorQueue = await readClipperExternalCloseoutOperatorQueue();
    const nextAction = operatorQueue.rows?.[0] || null;
    const copyPacket = buildClipperExternalCloseoutNextActionCopyPacket(nextAction);
    return {
      generatedAt: operatorQueue.generatedAt,
      status: nextAction ? "needs_operator" : "complete",
      paths: operatorQueue.paths,
      totals: operatorQueue.totals,
      nextAction,
      copyPacket,
      nextStep: nextAction?.operatorAction || operatorQueue.nextStep || "No external closeout operator actions remain.",
    };
  };
  const readClipperExternalCloseoutNextWorkRun = async () => {
    const raw = await readNodeFile("clippers_workspace/reports/clippers-external-next-work-run.json", "utf8");
    return JSON.parse(raw);
  };
  const readClipperExternalCloseoutEvidenceImport = async () => {
    const raw = await readNodeFile("clippers_workspace/reports/clippers-external-closeout-evidence-import-report.json", "utf8");
    return JSON.parse(raw);
  };
  const readClipperExternalCloseoutRepairWorkPacket = async () => {
    const raw = await readNodeFile("clippers_workspace/reports/clippers-external-closeout-repair-work-packet.json", "utf8");
    return JSON.parse(raw);
  };
  const readTextWithTimeout = async (filePath: string, timeoutMs: number) => Promise.race([
    readNodeFile(filePath, "utf8"),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  const minimalExternalPortalLauncherHtml = () => ensureExternalCloseoutGateInLauncherHtml(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers External Portal Launcher</title>
  <style>
    :root { color-scheme: dark; --bg: #080a0f; --panel: #111521; --line: #273044; --text: #f8fafc; --muted: #a1a1aa; --cyan: #67e8f9; --amber: #fcd34d; --green: #86efac; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    main { width: min(1100px, calc(100vw - 32px)); margin: 0 auto; padding: 28px 0 40px; }
    h1 { margin: 0; font-size: 26px; letter-spacing: 0; }
    h2 { margin: 0 0 8px; font-size: 18px; letter-spacing: 0; }
    p { color: var(--muted); line-height: 1.55; }
    a { color: var(--cyan); font-weight: 700; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { border: 1px solid var(--line); border-radius: 4px; background: #05070b; padding: 1px 4px; color: #e5e7eb; }
    .notice, .gate { border: 1px solid rgba(252, 211, 77, 0.35); background: rgba(252, 211, 77, 0.08); border-radius: 8px; padding: 12px; margin: 14px 0; }
    .gate { border-color: rgba(103, 232, 249, 0.24); background: #0d1724; }
    .gate-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .copy-btn { border: 1px solid rgba(103, 232, 249, 0.28); border-radius: 6px; background: rgba(103, 232, 249, 0.08); color: #cffafe; cursor: pointer; font-weight: 700; padding: 7px 10px; }
    .copy-btn:disabled { opacity: 0.42; cursor: not-allowed; }
    .platform-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin-top: 12px; }
    .portal-card { border: 1px solid rgba(103, 232, 249, 0.16); border-radius: 8px; background: rgba(0, 0, 0, 0.18); padding: 10px; }
    .portal-card h3 { margin: 0; font-size: 14px; text-transform: capitalize; }
    .portal-card p { margin: 6px 0 0; font-size: 12px; }
    .badge { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 3px 8px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .badge.do_now { border-color: rgba(134, 239, 172, 0.35); color: var(--green); background: rgba(134, 239, 172, 0.08); }
    .badge.blocked { border-color: rgba(253, 164, 175, 0.35); color: #fda4af; background: rgba(253, 164, 175, 0.08); }
    .badge.waiting { border-color: rgba(252, 211, 77, 0.35); color: var(--amber); background: rgba(252, 211, 77, 0.08); }
    .permission-section { margin: 18px 0; }
  </style>
</head>
<body>
  <main>
    <h1>Clippers External Portal Launcher</h1>
    <p class="notice">Fast fallback launcher. The full cached launcher was not available quickly, but the external closeout import gate and official portal links are available.</p>
    <section class="permission-section" aria-label="Next focus run">
      <h2>Official Portals</h2>
      <p><a href="https://app.metricool.com/" target="_blank" rel="noreferrer">Metricool</a> · <a href="https://developers.tiktok.com/" target="_blank" rel="noreferrer">TikTok Developers</a> · <a href="https://developers.facebook.com/" target="_blank" rel="noreferrer">Meta Developers</a> · <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">Google Cloud YouTube API</a></p>
    </section>
  </main>
  <script></script>
</body>
</html>`);
  const ensureExternalCloseoutGateInLauncherHtml = (html: string) => {
    const gateHtml = `
    <section class="gate" aria-label="External closeout evidence import gate">
      <div class="gate-head">
        <div>
          <h2>External Closeout Evidence Import Gate</h2>
          <p>Fill the closeout CSV with real proof, validate it, then apply clean imports only when the gate reports <code>ready_to_apply</code>. If only some rows are valid, use <code>Apply ready rows</code> to import just those rows while the rest stay blocked.</p>
          <p><strong>CSV:</strong> <code>clippers_workspace/evidence-drop/external-closeout-evidence-import.csv</code></p>
          <p><strong>Report:</strong> <code>clippers_workspace/reports/clippers-external-closeout-evidence-import-report.md</code></p>
        </div>
        <span id="external-closeout-import-badge" class="badge waiting">not checked</span>
      </div>
      <div class="toolbar">
        <button type="button" class="copy-btn" data-closeout-action="validate">Validate CSV</button>
        <button type="button" class="copy-btn" data-closeout-action="apply" disabled>Apply clean import</button>
        <button type="button" class="copy-btn" data-closeout-action="apply-ready" disabled>Apply ready rows</button>
        <a href="/api/clippers/external-closeout-evidence-import" target="_blank" rel="noreferrer">Open JSON report</a>
      </div>
      <pre id="external-closeout-import-result" style="margin-top:12px;border:1px solid var(--line);border-radius:8px;background:#05070b;padding:10px;min-height:76px;white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d4d4d8;overflow-x:auto;">Use Validate after replacing placeholders. Apply remains disabled until the CSV is clean.</pre>
    </section>`;
    const platformSprintHtml = `
    <section class="gate" aria-label="External platform sprint order">
      <div class="gate-head">
        <div>
          <h2>External Platform Sprint Order</h2>
          <p>Load the platform order before opening external portals. It groups developer apps, permissions and account proofs by Instagram, TikTok and YouTube, then shows the first safe copy packet for each platform.</p>
        </div>
        <span id="external-platform-sprint-badge" class="badge waiting">not loaded</span>
      </div>
      <div class="toolbar">
        <button type="button" class="copy-btn" data-platform-sprint-action="load">Load platform order</button>
        <button type="button" class="copy-btn" data-platform-sprint-action="copy" disabled>Copy first packet</button>
        <a href="/api/clippers/external-closeout-operator-queue" target="_blank" rel="noreferrer">Open operator queue</a>
      </div>
      <div id="external-platform-sprint-cards" class="platform-grid"></div>
      <pre id="external-platform-sprint-result" style="margin-top:12px;border:1px solid var(--line);border-radius:8px;background:#05070b;padding:10px;min-height:96px;white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d4d4d8;overflow-x:auto;">Load the platform order before portal work. Do not paste secrets into proof files or CSV rows.</pre>
    </section>`;
    const proofTodoHtml = `
    <section class="gate" aria-label="External closeout proof todo">
      <div class="gate-head">
        <div>
          <h2>External Closeout Proof Todo</h2>
          <p>Use this checklist while you are inside Metricool, TikTok, Meta and Google portals. It lists the exact proof file to fill and the exact CSV status to use after the external action is real.</p>
          <p><strong>Proof todo:</strong> <code>clippers_workspace/reports/clippers-external-closeout-proof-todo.md</code></p>
          <p><strong>Operator queue:</strong> <code>clippers_workspace/reports/clippers-external-closeout-operator-queue.md</code></p>
          <p><strong>Proof dir:</strong> <code>clippers_workspace/evidence-drop/external-closeout-proofs</code></p>
        </div>
        <span id="external-closeout-proof-todo-badge" class="badge waiting">not loaded</span>
      </div>
      <div class="toolbar">
        <button type="button" class="copy-btn" data-proof-todo-action="load">Load proof todo</button>
        <a href="/api/clippers/external-closeout-proof-todo" target="_blank" rel="noreferrer">Open JSON todo</a>
        <a href="/api/clippers/external-closeout-operator-queue" target="_blank" rel="noreferrer">Open operator queue</a>
      </div>
      <pre id="external-closeout-proof-todo-result" style="margin-top:12px;border:1px solid var(--line);border-radius:8px;background:#05070b;padding:10px;min-height:76px;white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d4d4d8;overflow-x:auto;">Load the proof todo before editing the CSV. Do not paste tokens, passwords, cookies, client secrets, recovery codes or private screenshots.</pre>
    </section>`;
    const goLiveAuditHtml = `
    <section class="gate" aria-label="External go-live audit repair queue">
      <div class="gate-head">
        <div>
          <h2>External Go-Live Audit + Repair Queue</h2>
          <p>Load this before portal work to see the current work blocks and the rejected evidence rows mapped back to proof files. This never enables automatic publishing.</p>
          <p><strong>Audit:</strong> <code>clippers_workspace/reports/clippers-external-go-live-audit.md</code></p>
        </div>
        <span id="external-go-live-audit-badge" class="badge waiting">not loaded</span>
      </div>
      <div class="toolbar">
        <button type="button" class="copy-btn" data-go-live-audit-action="load">Load audit</button>
        <a href="/api/clippers/external-closeout-pack" target="_blank" rel="noreferrer">Open closeout JSON</a>
        <a href="/api/clippers/external-closeout-next-action" target="_blank" rel="noreferrer">Open next action</a>
      </div>
      <pre id="external-go-live-audit-result" style="margin-top:12px;border:1px solid var(--line);border-radius:8px;background:#05070b;padding:10px;min-height:96px;white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d4d4d8;overflow-x:auto;">Load the audit to see work blocks and repair queue.</pre>
    </section>`;
    const gateScript = `
    function escapeExternalLauncherHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
    async function runCloseoutImportGate(mode) {
      const result = document.getElementById("external-closeout-import-result");
      const badge = document.getElementById("external-closeout-import-badge");
      const applyButton = document.querySelector("[data-closeout-action='apply']");
      const applyReadyButton = document.querySelector("[data-closeout-action='apply-ready']");
      const endpoint = mode === "apply"
        ? "/api/clippers/apply-external-closeout-evidence-import"
        : mode === "apply-ready"
          ? "/api/clippers/apply-ready-external-closeout-evidence-import"
          : "/api/clippers/preview-external-closeout-evidence-import";
      result.textContent = mode === "apply" ? "Applying clean import..." : mode === "apply-ready" ? "Applying ready rows..." : "Validating CSV...";
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: mode === "apply"
            ? { "x-clippers-operator-confirm": "apply-external-closeout-evidence" }
            : mode === "apply-ready"
              ? { "x-clippers-operator-confirm": "apply-ready-external-closeout-evidence" }
              : undefined
        });
        const payload = await response.json();
        const report = payload.externalCloseoutEvidenceImport || {};
        const totals = report.totals || {};
        const repairQueue = report.repairQueue || [];
        badge.textContent = report.status || (response.ok ? "ok" : "blocked");
        badge.className = "badge " + (report.status === "import_applied" || report.status === "partial_import_applied" || report.status === "ready_to_apply" || report.status === "partial_ready_to_apply" ? "do_now" : "blocked");
        if (applyButton) applyButton.disabled = report.status !== "ready_to_apply";
        if (applyReadyButton) applyReadyButton.disabled = (totals.accepted || 0) <= 0;
        result.textContent = [
          "HTTP: " + response.status,
          "Status: " + (report.status || payload.error || "unknown"),
          "Mode: " + (report.mode || mode),
          "Rows: " + (totals.rowsScanned ?? 0),
          "Accepted: " + (totals.accepted ?? 0),
          "Rejected: " + (totals.rejected ?? 0),
          "Applied: " + (totals.applied ?? 0),
          "",
          report.nextStep || payload.error || "",
          "",
          "Repair queue:",
          repairQueue.slice(0, 8).map((row) => [
            "- CSV row " + (row.csvRow || "?") + ": " + (row.closeoutId || row.lane || "unknown"),
            "  reason=" + (row.reason || "rejected"),
            "  proof=" + (row.proofPath || "missing"),
            "  next=" + (row.nextStep || "replace placeholders and preview again")
          ].join("\\n")).join("\\n") || "- none",
          "",
          "Rejected:",
          (report.rejected || []).slice(0, 6).map((row) => "Row " + (row.index || "?") + ": " + (row.kind || "unknown") + " - " + (row.reason || "rejected")).join("\\n") || "- none"
        ].join("\\n");
      } catch (error) {
        badge.textContent = "error";
        badge.className = "badge blocked";
        if (applyButton) applyButton.disabled = true;
        if (applyReadyButton) applyReadyButton.disabled = true;
        result.textContent = error && error.message ? error.message : String(error);
      }
    }
    async function loadExternalCloseoutProofTodo() {
      const result = document.getElementById("external-closeout-proof-todo-result");
      const badge = document.getElementById("external-closeout-proof-todo-badge");
      result.textContent = "Loading proof todo...";
      try {
        const response = await fetch("/api/clippers/external-closeout-proof-todo");
        const payload = await response.json();
        const todo = payload.externalCloseoutProofTodo || {};
        const totals = todo.totals || {};
        const rows = todo.rows || [];
        const operatorQueue = todo.operatorQueue || [];
        badge.textContent = (operatorQueue.length || totals.proofFilesNeedRealEvidence || rows.length) + " pending";
        badge.className = "badge " + ((totals.proofFilesNeedRealEvidence || 0) > 0 ? "waiting" : "do_now");
        result.textContent = [
          "HTTP: " + response.status,
          "Rows: " + rows.length,
          "Operator queue: " + operatorQueue.length,
          "Proofs needing real evidence: " + (totals.proofFilesNeedRealEvidence ?? 0),
          "Proofs filled: " + (totals.proofFilesFilled ?? 0),
          "",
          (operatorQueue.length ? operatorQueue : rows).slice(0, 8).map((row) => [
            (row.rank ? "#" + row.rank + " " : "") + (row.id || "unknown"),
            "status=" + (row.requiredCsvStatus || "unknown"),
            "missing=" + ((row.missingCsvFields || []).join(", ") || "proof/evidence"),
            row.operatorAction || row.csvEditHint || "",
            "proof=" + (row.proofPath || "missing")
          ].join("\\n  ")).join("\\n\\n")
        ].join("\\n");
      } catch (error) {
        badge.textContent = "error";
        badge.className = "badge blocked";
        result.textContent = error && error.message ? error.message : String(error);
      }
    }
    async function loadExternalPlatformSprint() {
      const result = document.getElementById("external-platform-sprint-result");
      const badge = document.getElementById("external-platform-sprint-badge");
      const cards = document.getElementById("external-platform-sprint-cards");
      const copyButton = document.querySelector("[data-platform-sprint-action='copy']");
      result.textContent = "Loading platform order...";
      if (cards) cards.innerHTML = "";
      if (copyButton) {
        copyButton.disabled = true;
        copyButton.removeAttribute("data-copy-packet");
      }
      try {
        const response = await fetch("/api/clippers/external-closeout-operator-queue");
        const payload = await response.json();
        const queue = payload.externalCloseoutOperatorQueue || {};
        const rows = queue.rows || [];
        const sprint = queue.sprintSummary || {};
        const platformRows = sprint.platformRows || [];
        badge.textContent = platformRows.length + " platforms";
        badge.className = "badge " + (platformRows.length ? "waiting" : "blocked");
        const rowById = new Map(rows.map((row) => [row.id, row]));
        if (cards) {
          cards.innerHTML = platformRows.map((platform) => {
            const nextRow = rowById.get(platform.firstActionId) || {};
            const portalUrl = (platform.portalUrls || [])[0] || nextRow.portalUrl || "#";
            const safePortalUrl = /^https:\\/\\//.test(String(portalUrl || "")) ? String(portalUrl) : "";
            const proofPath = (platform.proofPaths || [])[0] || nextRow.proofPath || "pending";
            return [
              '<article class="portal-card">',
              '<h3>' + escapeExternalLauncherHtml(String(platform.platform || "unknown")) + '</h3>',
              '<p><strong>' + Number(platform.totalActions || 0) + '</strong> actions · ' + Number(platform.criticalActions || 0) + ' critical</p>',
              '<p>Apps ' + Number(platform.developerApps || 0) + ' · Perms ' + Number(platform.permissions || 0) + ' · Accounts ' + Number(platform.accountProofs || 0) + '</p>',
              '<p>First: <code>' + escapeExternalLauncherHtml(String(platform.firstActionId || "none")) + '</code></p>',
              '<p>Proof: <code>' + escapeExternalLauncherHtml(String(proofPath)) + '</code></p>',
              safePortalUrl ? '<p><a href="' + escapeExternalLauncherHtml(safePortalUrl) + '" target="_blank" rel="noreferrer">Open portal</a></p>' : '',
              '</article>'
            ].join("");
          }).join("");
        }
        const firstPlatform = platformRows[0] || null;
        const firstRow = firstPlatform ? rowById.get(firstPlatform.firstActionId) : null;
        if (copyButton && firstRow && firstRow.copyPacket) {
          copyButton.disabled = false;
          copyButton.setAttribute("data-copy-packet", firstRow.copyPacket);
        }
        result.textContent = [
          "HTTP: " + response.status,
          "Sprint: " + (sprint.nextStep || "No platform sprint is available."),
          "Metricool: approval_required; automatic publishing remains off.",
          "",
          platformRows.map((platform) => [
            String(platform.platform || "unknown").toUpperCase(),
            "actions=" + (platform.totalActions || 0),
            "critical=" + (platform.criticalActions || 0),
            "apps=" + (platform.developerApps || 0),
            "permissions=" + (platform.permissions || 0),
            "accounts=" + (platform.accountProofs || 0),
            "first=" + (platform.firstActionId || "none"),
            "proof=" + (((platform.proofPaths || [])[0]) || "pending"),
            "missing=" + (((platform.missingCsvFields || []).join(", ")) || "none")
          ].join("\\n  ")).join("\\n\\n"),
          "",
          firstRow && firstRow.copyPacket ? "First copy packet:\\n" + firstRow.copyPacket : "First copy packet: none"
        ].join("\\n");
      } catch (error) {
        badge.textContent = "error";
        badge.className = "badge blocked";
        result.textContent = error && error.message ? error.message : String(error);
      }
    }
    async function loadExternalGoLiveAudit() {
      const result = document.getElementById("external-go-live-audit-result");
      const badge = document.getElementById("external-go-live-audit-badge");
      result.textContent = "Loading go-live audit...";
      try {
        const response = await fetch("/api/clippers/external-closeout-pack");
        const payload = await response.json();
        const pack = payload.externalCloseoutPack || {};
        const audit = pack.goLiveAudit || {};
        const totals = audit.totals || {};
        const workBlocks = audit.workBlocks || [];
        const repairs = audit.evidenceRepairQueue || [];
        badge.textContent = audit.status || pack.status || "unknown";
        badge.className = "badge " + (audit.status === "ready_for_final_review" ? "do_now" : "waiting");
        result.textContent = [
          "HTTP: " + response.status,
          "Status: " + (audit.status || pack.status || "unknown"),
          "Next action: " + (audit.nextAction && audit.nextAction.id ? audit.nextAction.id : "none"),
          "Blocks: " + (totals.workBlocks ?? workBlocks.length),
          "Repair rows: " + (totals.evidenceRepairRows ?? repairs.length),
          "Auto-send: " + (totals.metricoolReadyToSend ?? 0),
          "",
          "Work blocks:",
          workBlocks.slice(0, 5).map((block) => "- " + block.label + ": " + block.actions + " actions, " + block.estimatedMinutes + " min, first=" + block.firstActionId).join("\\n") || "- none",
          "",
          "Repair queue:",
          repairs.slice(0, 8).map((row) => [
            "- CSV row " + (row.csvRow || "?") + ": " + row.id,
            "  reason=" + row.reason,
            "  proof=" + (row.proofPath || "missing"),
            "  missing=" + ((row.missingCsvFields || []).join(", ") || "none")
          ].join("\\n")).join("\\n") || "- none",
          "",
          "First repair copy packet:",
          repairs[0] && repairs[0].copyPacket ? repairs[0].copyPacket : "none"
        ].join("\\n");
      } catch (error) {
        badge.textContent = "error";
        badge.className = "badge blocked";
        result.textContent = error && error.message ? error.message : String(error);
      }
    }
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-closeout-action]");
      if (!button) return;
      runCloseoutImportGate(button.getAttribute("data-closeout-action"));
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-proof-todo-action='load']");
      if (!button) return;
      loadExternalCloseoutProofTodo();
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-platform-sprint-action]");
      if (!button) return;
      const action = button.getAttribute("data-platform-sprint-action");
      if (action === "load") {
        loadExternalPlatformSprint();
        return;
      }
      if (action === "copy") {
        const packet = button.getAttribute("data-copy-packet") || "";
        if (!packet) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(packet).catch(() => undefined);
        }
      }
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-go-live-audit-action='load']");
      if (!button) return;
      loadExternalGoLiveAudit();
    });`;
    let withSections = html;
    if (!withSections.includes("External Closeout Evidence Import Gate")) {
      withSections = withSections.replace('<section class="permission-section" aria-label="Next focus run">', `${gateHtml}\n    <section class="permission-section" aria-label="Next focus run">`);
    }
    if (!withSections.includes("External Platform Sprint Order")) {
      withSections = withSections.replace('<section class="permission-section" aria-label="Next focus run">', `${platformSprintHtml}\n    <section class="permission-section" aria-label="Next focus run">`);
    }
    if (!withSections.includes("External Closeout Proof Todo")) {
      withSections = withSections.replace('<section class="permission-section" aria-label="Next focus run">', `${proofTodoHtml}\n    <section class="permission-section" aria-label="Next focus run">`);
    }
    if (!withSections.includes("External Go-Live Audit + Repair Queue")) {
      withSections = withSections.replace('<section class="permission-section" aria-label="Next focus run">', `${goLiveAuditHtml}\n    <section class="permission-section" aria-label="Next focus run">`);
    }
    return withSections.includes("loadExternalCloseoutProofTodo") && withSections.includes("loadExternalGoLiveAudit") && withSections.includes("loadExternalPlatformSprint")
      ? withSections
      : withSections.replace("</script>", `${gateScript}\n  </script>`);
  };

  app.get("/clippers/legal/privacy", (_req, res) => {
    res.type("html").send(renderClipperPrivacyPolicyHtml());
  });

  app.get("/clippers/legal/terms", (_req, res) => {
    res.type("html").send(renderClipperTermsOfServiceHtml());
  });

  app.get("/clippers/review-demo", (_req, res) => {
    res.type("html").send(renderClipperAppReviewDemoHtml());
  });

  app.get("/clippers/external-portal-launcher", async (req, res) => {
    try {
      const cached = await readTextWithTimeout("clippers_workspace/external-portal-launcher.html", 1500).catch(() => null);
      if (cached) {
        res.type("html").send(ensureExternalCloseoutGateInLauncherHtml(cached));
        return;
      }
      res.type("html").send(minimalExternalPortalLauncherHtml());
      void prepareClipperRobertNextActions(getCurrentUserId(req)).catch(() => undefined);
    } catch (error: any) {
      res.status(500).type("text").send(error.message || "Failed to render Clippers external portal launcher");
    }
  });

  registerTelegramRoutes(app);
  registerRevenueStripeRoutes(app);
  registerAgentCouncilRoutes(app);
  // Per-agent chat: threads, deterministic routing and hand-offs recorded as company orders. Owner-only.
  registerAgentChatRoutes(app);
  // Black Room team (CEO, analiticas, competencia, publicador, guiones, website). Owner-only; approvals before anything outward.
  registerBlackRoomTeamRoutes(app);
  // Chat with the CEO Black Room (owner + partners): routes requests to the team and runs them; approvals stay explicit.
  registerBlackRoomCeoChatRoutes(app);
  // KONG operations (cards -> Videos KONG, single publisher lease, UUID ledger, metrics). Owner-only.
  registerKongOperationsRoutes(app, getKongOperations(), {
    requestUserId: (req) => {
      try {
        return getCurrentUserId(req);
      } catch {
        return null;
      }
    },
    ownerUserId: () => getSystemUserId(),
  });

  // GET all tasks
  app.get("/api/tasks", async (req, res) => {
    try {
      const tasks = await storage.getTasks(getCurrentUserId(req));
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  // GET single task
  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const task = await storage.getTask(req.params.id);
      if (!task || task.userId !== userId) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch task" });
    }
  });

  // POST create task
  app.post("/api/tasks", async (req, res) => {
    try {
      // Convert date string to Date object if needed
      const body = {
        ...req.body,
        date: typeof req.body.date === "string" ? new Date(req.body.date) : req.body.date,
      };
      const validated = insertTaskSchema.parse(body);
      const task = await storage.createTask(getCurrentUserId(req), validated);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  // PATCH update task
  app.patch("/api/tasks/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getTask(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Task not found" });
      }

      // Convert date strings to Date objects if needed
      const body = {
        ...req.body,
        date: req.body.date ? (typeof req.body.date === "string" ? new Date(req.body.date) : req.body.date) : undefined,
        originalDate: req.body.originalDate ? (typeof req.body.originalDate === "string" ? new Date(req.body.originalDate) : req.body.originalDate) : undefined,
      };
      const task = await storage.updateTask(req.params.id, body);
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  // DELETE task
  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getTask(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Task not found" });
      }

      await storage.deleteTask(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // POST deduplicate main tasks (one-time cleanup)
  app.post("/api/tasks/deduplicate", async (req, res) => {
    try {
      const removed = await storage.deduplicateMainTasks(getCurrentUserId(req));
      res.json({ removed });
    } catch (error) {
      res.status(500).json({ error: "Failed to deduplicate tasks" });
    }
  });

  // DELETE tasks by title (for recurring events)
  app.delete("/api/tasks/by-title/:title", async (req, res) => {
    try {
      const title = decodeURIComponent(req.params.title);
      const deleted = await storage.deleteTasksByTitle(getCurrentUserId(req), title);
      res.json({ deleted });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete tasks" });
    }
  });

  app.use(["/api/calendar", "/api/google-drive"], (req, res, next) => {
    if (isPublicApiRequest(req)) return next();
    const userId = getCurrentUserId(req);
    const googleOwnerUserId = getSystemUserId();
    if (userId !== googleOwnerUserId) {
      return res.status(403).json({
        error: "Google Calendar and Drive tools are limited to the configured single-user owner while shared Google integrations are connected.",
      });
    }
    return next();
  });

  // GET Calendar connection status (Google + Zoho)
  app.get("/api/calendar/status", async (req, res) => {
    try {
      const googleConnected = await isGoogleCalendarConnected();
      const zohoStatus = await checkZohoConnection();
      res.json({ google: googleConnected, zoho: zohoStatus.connected });
    } catch (error) {
      res.json({ google: false, zoho: false });
    }
  });

  // GET Canva OAuth status
  app.get("/api/canva/status", async (req, res) => {
    try {
      const status = await getCanvaOAuthStatus(getCurrentUserId(req));
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch Canva status" });
    }
  });

  // GET Google Drive OAuth status
  app.get("/api/google-drive/status", async (req, res) => {
    try {
      const status = await getGoogleDriveOAuthStatus(getCurrentUserId(req));
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch Google Drive status" });
    }
  });

  app.post("/api/google-drive/organize", async (req, res) => {
    try {
      const result = await ensureAppDriveStructure(getCurrentUserId(req));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to organize Google Drive folders" });
    }
  });

  // GET Google Drive OAuth authorization URL - redirects to Google login/approval
  app.get("/api/google-drive/auth", (req, res) => {
    try {
      res.redirect(createGoogleDriveAuthorizationUrl(getCurrentUserId(req), req));
    } catch (error: any) {
      res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Google Drive no está configurado</h1>
          <p>${escapeHtml(error.message || "Agrega GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en los secrets.")}</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }
  });

  // GET Google Drive OAuth callback - stores access/refresh tokens without displaying them
  app.get("/api/google-drive/oauth/callback", async (req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error conectando Google Drive</h1>
          <p>${escapeHtml(errorDescription || error)}</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }

    if (!code || typeof code !== "string" || !state || typeof state !== "string") {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error conectando Google Drive</h1>
          <p>No se recibió el authorization code/state de Google.</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }

    try {
      const result = await exchangeGoogleDriveAuthorizationCode({ code, state });
      res.send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1 style="color:#22c55e;">Google Drive conectado</h1>
          <p>La conexión de Drive quedó guardada para preparar carpetas y fuentes de Clippers.</p>
          <p style="color:#94a3b8;">Scopes: ${escapeHtml(result.scope || "guardados")}</p>
          <a href="/clippers" style="color:#3b82f6;">Ir a Clippers</a>
        </body></html>
      `);
    } catch (callbackError: any) {
      res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error conectando Google Drive</h1>
          <p>${escapeHtml(callbackError.message || "No se pudo guardar la conexión de Google Drive.")}</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }
  });

  // GET Canva OAuth authorization URL - redirects to Canva login/approval
  app.get("/api/canva/auth", (req, res) => {
    try {
      res.redirect(createCanvaAuthorizationUrl(getCurrentUserId(req), req));
    } catch (error: any) {
      res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Canva no está configurado</h1>
          <p>${escapeHtml(error.message || "Agrega CANVA_CLIENT_ID y CANVA_CLIENT_SECRET en los secrets.")}</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }
  });

  // GET Canva OAuth callback - stores access/refresh tokens without displaying them
  app.get("/api/canva/oauth/callback", async (req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error conectando Canva</h1>
          <p>${escapeHtml(errorDescription || error)}</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }

    if (!code || typeof code !== "string" || !state || typeof state !== "string") {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error conectando Canva</h1>
          <p>No se recibió el authorization code/state de Canva.</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }

    try {
      const result = await exchangeCanvaAuthorizationCode({ code, state });
      res.send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1 style="color:#22c55e;">Canva conectado</h1>
          <p>La conexión de Canva quedó guardada para este usuario.</p>
          <p style="color:#94a3b8;">Scopes: ${escapeHtml(result.scope || "guardados")}</p>
          <a href="/radio" style="color:#3b82f6;">Ir a Radio</a>
        </body></html>
      `);
    } catch (callbackError: any) {
      res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error conectando Canva</h1>
          <p>${escapeHtml(callbackError.message || "No se pudo guardar la conexión de Canva.")}</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }
  });

  // POST Zoho Calendar sync
  app.post("/api/calendar/zoho/sync", async (req, res) => {
    try {
      const result = await syncZohoCalendar(getCurrentUserId(req));
      res.json({ success: true, synced: result.synced, errors: result.errors });
    } catch (error: any) {
      console.error('Zoho sync error:', error);
      res.status(500).json({ error: error.message || "Failed to sync Zoho calendar" });
    }
  });

  // GET Zoho OAuth authorization URL - redirects to Zoho login
  app.get("/api/zoho/auth", (req, res) => {
    const host = req.get('host') || 'localhost:5000';
    const protocol = host.includes('replit') ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${host}/api/zoho/callback`;
    const authUrl = getZohoAuthUrl(redirectUri);
    
    if (!authUrl) {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error</h1>
          <p>Zoho Client ID no configurado. Agrega ZOHO_CLIENT_ID en los secrets.</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }
    
    // Redirect directly to Zoho OAuth
    res.redirect(authUrl);
  });

  // GET Zoho OAuth callback - exchanges code for refresh token
  app.get("/api/zoho/callback", async (req, res) => {
    const { code } = req.query;
    
    if (!code || typeof code !== 'string') {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error</h1>
          <p>No authorization code received from Zoho.</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }

    const host = req.get('host') || 'localhost:5000';
    const protocol = host.includes('replit') ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${host}/api/zoho/callback`;
    
    const result = await exchangeZohoCode(code, redirectUri);
    
    if (result.error) {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error</h1>
          <p>${escapeHtml(result.error)}</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }

    res.send(`
      <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
        <h1 style="color:#22c55e;">Zoho Calendar Conectado</h1>
        <p>Zoho devolvió un refresh token válido. No se muestra en pantalla por seguridad.</p>
        <p style="color:#fbbf24;">Guarda el token en tu gestor de secretos como ZOHO_REFRESH_TOKEN desde un flujo seguro.</p>
        <a href="/" style="color:#3b82f6;">Volver al inicio</a>
      </body></html>
    `);
  });

  // GET Google Calendar events and sync to local tasks
  app.post("/api/calendar/sync", async (req, res) => {
    try {
      const result = await syncGoogleCalendarToTasks(getCurrentUserId(req));
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('Calendar sync error:', error);
      res.status(500).json({ error: error.message || "Failed to sync calendar" });
    }
  });

  // GET calendar events without syncing (just for display)
  app.get("/api/calendar/events", async (req, res) => {
    try {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      weekStart.setHours(0, 0, 0, 0);

      const twelveMonthsAhead = new Date();
      twelveMonthsAhead.setMonth(twelveMonthsAhead.getMonth() + 12);
      
      const events = await getCalendarEvents(weekStart, twelveMonthsAhead);
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch calendar events" });
    }
  });

  // ==================== WEEKLY SUMMARIES ====================

  // GET all weekly summaries
  app.get("/api/weekly-summaries", async (req, res) => {
    try {
      const summaries = await storage.getWeeklySummaries(getCurrentUserId(req));
      res.json(summaries);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch weekly summaries" });
    }
  });

  // GET single weekly summary by week start date
  app.get("/api/weekly-summaries/:weekStart", async (req, res) => {
    try {
      const weekStart = new Date(req.params.weekStart);
      const summary = await storage.getWeeklySummary(getCurrentUserId(req), weekStart);
      if (!summary) {
        return res.status(404).json({ error: "Weekly summary not found" });
      }
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch weekly summary" });
    }
  });

  // POST create weekly summary
  app.post("/api/weekly-summaries", async (req, res) => {
    try {
      const body = {
        ...req.body,
        weekStart: typeof req.body.weekStart === "string" ? new Date(req.body.weekStart) : req.body.weekStart,
      };
      const validated = insertWeeklySummarySchema.parse(body);
      
      // Check if summary already exists for this week
      const existing = await storage.getWeeklySummary(getCurrentUserId(req), validated.weekStart);
      if (existing) {
        // Update instead of create
        const updated = await storage.updateWeeklySummary(existing.id, validated);
        return res.json(updated);
      }
      
      const summary = await storage.createWeeklySummary(getCurrentUserId(req), validated);
      res.status(201).json(summary);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create weekly summary" });
    }
  });

  // PATCH update weekly summary
  app.patch("/api/weekly-summaries/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getWeeklySummaryById(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Weekly summary not found" });
      }

      const body = {
        ...req.body,
        weekStart: req.body.weekStart ? (typeof req.body.weekStart === "string" ? new Date(req.body.weekStart) : req.body.weekStart) : undefined,
      };
      const summary = await storage.updateWeeklySummary(req.params.id, body);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to update weekly summary" });
    }
  });

  // ==================== MONTHLY GOALS ====================

  // GET all monthly goals across all months (for history view)
  app.get("/api/monthly-goals/all", async (req, res) => {
    try {
      const goals = await storage.getAllMonthlyGoals(getCurrentUserId(req));
      res.json(goals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch all monthly goals" });
    }
  });

  // GET monthly goals for a specific month
  app.get("/api/monthly-goals", async (req, res) => {
    try {
      const monthParam = req.query.month as string;
      const month = monthParam ? new Date(monthParam) : new Date();
      const goals = await storage.getMonthlyGoals(getCurrentUserId(req), month);
      res.json(goals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch monthly goals" });
    }
  });

  // POST create monthly goal
  app.post("/api/monthly-goals", async (req, res) => {
    try {
      const body = {
        ...req.body,
        month: typeof req.body.month === "string" ? new Date(req.body.month) : req.body.month,
      };
      const validated = insertMonthlyGoalSchema.parse(body);
      const goal = await storage.createMonthlyGoal(getCurrentUserId(req), validated);
      res.status(201).json(goal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create monthly goal" });
    }
  });

  // PATCH update monthly goal
  app.patch("/api/monthly-goals/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getMonthlyGoal(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Monthly goal not found" });
      }

      const goal = await storage.updateMonthlyGoal(req.params.id, req.body);
      res.json(goal);
    } catch (error) {
      res.status(500).json({ error: "Failed to update monthly goal" });
    }
  });

  // DELETE monthly goal
  app.delete("/api/monthly-goals/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getMonthlyGoal(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Monthly goal not found" });
      }

      await storage.deleteMonthlyGoal(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete monthly goal" });
    }
  });

  // ==================== YEARLY GOALS ====================

  // GET yearly goals for a specific year
  app.get("/api/yearly-goals", async (req, res) => {
    try {
      const year = (req.query.year as string) || new Date().getFullYear().toString();
      const goals = await storage.getYearlyGoals(getCurrentUserId(req), year);
      res.json(goals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch yearly goals" });
    }
  });

  // POST create yearly goal
  app.post("/api/yearly-goals", async (req, res) => {
    try {
      const validated = insertYearlyGoalSchema.parse(req.body);
      const goal = await storage.createYearlyGoal(getCurrentUserId(req), validated);
      res.status(201).json(goal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create yearly goal" });
    }
  });

  // PATCH update yearly goal
  app.patch("/api/yearly-goals/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getYearlyGoal(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Yearly goal not found" });
      }

      const goal = await storage.updateYearlyGoal(req.params.id, req.body);
      res.json(goal);
    } catch (error) {
      res.status(500).json({ error: "Failed to update yearly goal" });
    }
  });

  // DELETE yearly goal
  app.delete("/api/yearly-goals/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getYearlyGoal(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Yearly goal not found" });
      }

      await storage.deleteYearlyGoal(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete yearly goal" });
    }
  });

  // ==================== WEEKLY TASKS ====================

  let hasDeduplicatedRecurringTasks = false;
  
  // GET weekly tasks for current week
  // Recurring tasks are shown alongside the current week's tasks without duplication.
  // Incomplete non-recurring tasks from the previous week are carried over automatically.
  app.get("/api/weekly-tasks", async (req, res) => {
    try {
      // One-time deduplication of recurring tasks on first request
      if (!hasDeduplicatedRecurringTasks) {
        const removed = await storage.deduplicateRecurringTasks(getCurrentUserId(req));
        if (removed > 0) {
          console.log(`[weekly-tasks] Cleaned up ${removed} duplicate recurring tasks`);
        }
        hasDeduplicatedRecurringTasks = true;
      }
      
      const weekStartParam = req.query.weekStart as string;
      const weekStart = weekStartParam ? new Date(weekStartParam) : getWeekStart(new Date());
      
      // Get existing tasks for this week
      let tasks = await storage.getWeeklyTasks(getCurrentUserId(req), weekStart);
      
      // Get all recurring tasks (displayed globally, not duplicated per week)
      const recurringTasks = await storage.getRecurringTasks(getCurrentUserId(req));
      
      // Merge recurring tasks that aren't already in this week's list
      const existingTitles = new Set(tasks.map(t => t.title));
      const existingIds = new Set(tasks.map(t => t.id));
      
      // For recurring tasks, show them but DON'T create copies.
      // If the recurring task's weekStart doesn't match the current week,
      // it means it was completed in a previous week — reset completed to false.
      const seenRecurringTitles = new Set<string>();
      for (const rt of recurringTasks) {
        if (!seenRecurringTitles.has(rt.title) && !existingIds.has(rt.id)) {
          if (!existingTitles.has(rt.title)) {
            const rtWeekStart = getWeekStart(rt.weekStart);
            const isSameWeek = rtWeekStart.getTime() === weekStart.getTime();
            tasks.push({ ...rt, completed: isSameWeek ? rt.completed : false, carriedOver: false });
            existingTitles.add(rt.title);
          }
          seenRecurringTitles.add(rt.title);
        }
      }
      
      // Carry over incomplete NON-recurring tasks from the previous week
      const prevIncompleteTasks = await storage.getPreviousWeekIncompleteTasks(getCurrentUserId(req), weekStart);
      for (const pt of prevIncompleteTasks) {
        if (!existingTitles.has(pt.title)) {
          const carriedTask = await storage.createWeeklyTask(getCurrentUserId(req), {
            title: pt.title,
            weekStart: weekStart,
            completed: false,
            isRecurring: false,
            carriedOver: true,
          });
          tasks.push(carriedTask);
          existingTitles.add(pt.title);
        }
      }
      
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch weekly tasks" });
    }
  });

  // POST create weekly task
  app.post("/api/weekly-tasks", async (req, res) => {
    try {
      const body = {
        ...req.body,
        weekStart: typeof req.body.weekStart === "string" ? new Date(req.body.weekStart) : req.body.weekStart,
      };
      const validated = insertWeeklyTaskSchema.parse(body);
      const task = await storage.createWeeklyTask(getCurrentUserId(req), validated);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create weekly task" });
    }
  });

  // PATCH update weekly task
  app.patch("/api/weekly-tasks/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getWeeklyTaskById(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Weekly task not found" });
      }

      let updates = { ...req.body };
      
      // When toggling completion on a recurring task, also stamp the current weekStart
      // so that next week the task appears fresh (not completed).
      if (existing?.isRecurring && "completed" in updates) {
        updates.weekStart = getWeekStart(new Date());
      }
      
      const task = await storage.updateWeeklyTask(req.params.id, updates);
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: "Failed to update weekly task" });
    }
  });

  // DELETE weekly task
  app.delete("/api/weekly-tasks/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getWeeklyTaskById(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Weekly task not found" });
      }

      await storage.deleteWeeklyTask(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete weekly task" });
    }
  });

  // ==================== PUSH NOTIFICATIONS ====================

  // GET VAPID public key
  app.get("/api/push/vapid-key", (req, res) => {
    res.json({ publicKey: getVapidPublicKey() });
  });

  // POST subscribe to push notifications
  app.post("/api/push/subscribe", async (req, res) => {
    try {
      const { endpoint, keys } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: "Invalid subscription" });
      }
      
      // Check if already subscribed
      const existing = await storage.getPushSubscriptions(getCurrentUserId(req));
      const alreadyExists = existing.some(s => s.endpoint === endpoint);
      
      if (!alreadyExists) {
        await storage.createPushSubscription(getCurrentUserId(req), {
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        });
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to subscribe" });
    }
  });

  // POST unsubscribe from push notifications
  app.post("/api/push/unsubscribe", async (req, res) => {
    try {
      const { endpoint } = req.body;
      if (endpoint) {
        await storage.deletePushSubscription(endpoint);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to unsubscribe" });
    }
  });

  // POST test notification (for debugging)
  app.post("/api/push/test", async (req, res) => {
    try {
      const result = await sendPushNotification(getCurrentUserId(req), {
        title: "BlackOps en tu telefono",
        body: "Listo, Robert. Este dispositivo recibira alertas de tus proyectos.",
        url: "/projects",
        tag: "blackops-phone-test",
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send test notification" });
    }
  });

  // POST test morning reminder
  app.post("/api/push/test-morning", async (req, res) => {
    try {
      const result = await testMorningReminder(getCurrentUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send morning reminder" });
    }
  });

  // POST test evening reminder
  app.post("/api/push/test-evening", async (req, res) => {
    try {
      const result = await testEveningReminder(getCurrentUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send evening reminder" });
    }
  });

  // POST test weekly reminder
  app.post("/api/push/test-weekly", async (req, res) => {
    try {
      const result = await testWeeklyReminder(getCurrentUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send weekly reminder" });
    }
  });

  // POST test proactive insights
  app.post("/api/push/test-insights", async (req, res) => {
    try {
      const result = await testProactiveInsights(getCurrentUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send proactive insights" });
    }
  });

  // POST test news digest
  app.post("/api/push/test-news", async (req, res) => {
    try {
      const result = await testNewsDigest(getCurrentUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send news digest" });
    }
  });

  // ==================== FINANCE ENDPOINTS ====================

  // GET market overview
  app.get("/api/finance/market", async (req, res) => {
    try {
      const overview = await getMarketOverview();
      res.json(overview);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch market overview" });
    }
  });

  // GET price for symbol
  app.get("/api/finance/price/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const type = (req.query.type as string) || "stock";
      const price = await getPrice(symbol, type as any);
      if (!price) {
        return res.status(404).json({ error: "Symbol not found" });
      }
      res.json(price);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price" });
    }
  });

  // GET search symbols
  app.get("/api/finance/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: "Query required" });
      }
      const results = await searchSymbol(query);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to search symbols" });
    }
  });

  // GET historical price data
  app.get("/api/finance/history/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const type = (req.query.type as string) || "stock";
      const period = (req.query.period as string) || "1M";
      const data = await getHistoricalData(symbol, type as any, period);
      if (!data) {
        return res.status(404).json({ error: "Historical data not found" });
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch historical data" });
    }
  });

  // GET portfolio news (news for all user investments)
  app.get("/api/finance/news", async (req, res) => {
    try {
      const investments = await storage.getInvestments(getCurrentUserId(req));
      const symbols = investments.map(inv => inv.symbol);
      const news = await getPortfolioNews(symbols);
      res.json(news);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch portfolio news" });
    }
  });

  // GET market news (general financial news)
  app.get("/api/finance/news/market", async (req, res) => {
    try {
      const news = await getMarketNews();
      res.json(news);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch market news" });
    }
  });

  // GET company news for specific symbol
  app.get("/api/finance/news/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const days = parseInt(req.query.days as string) || 7;
      const news = await getCompanyNews(symbol, days);
      res.json(news);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch company news" });
    }
  });

  // GET user investments
  app.get("/api/investments", async (req, res) => {
    try {
      const investments = await storage.getInvestments(getCurrentUserId(req));
      res.json(investments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch investments" });
    }
  });

  // POST create investment
  app.post("/api/investments", async (req, res) => {
    try {
      const validated = insertInvestmentSchema.parse(req.body);
      const investment = await storage.createInvestment(getCurrentUserId(req), validated);
      res.status(201).json(investment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create investment" });
    }
  });

  // PATCH update investment
  app.patch("/api/investments/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getInvestment(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Investment not found" });
      }

      const investment = await storage.updateInvestment(req.params.id, req.body);
      res.json(investment);
    } catch (error) {
      res.status(500).json({ error: "Failed to update investment" });
    }
  });

  // DELETE investment
  app.delete("/api/investments/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getInvestment(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Investment not found" });
      }

      await storage.deleteInvestment(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete investment" });
    }
  });

  // GET portfolio history
  app.get("/api/portfolio/history", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const history = await storage.getPortfolioHistory(getCurrentUserId(req), days);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch portfolio history" });
    }
  });

  // POST test market update notification
  app.post("/api/portfolio/test-notification", async (req, res) => {
    try {
      await sendDailyMarketUpdateForUser(getCurrentUserId(req));
      res.json({ success: true, message: "Market update sent" });
    } catch (error) {
      res.status(500).json({ error: "Failed to send market update" });
    }
  });

  // GET transactions
  app.get("/api/transactions", async (req, res) => {
    try {
      const transactions = await storage.getTransactions(getCurrentUserId(req));
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  // POST create transaction
  app.post("/api/transactions", async (req, res) => {
    try {
      const body = {
        ...req.body,
        date: typeof req.body.date === "string" ? new Date(req.body.date) : req.body.date,
      };
      const validated = insertTransactionSchema.parse(body);
      const transaction = await storage.createTransaction(getCurrentUserId(req), validated);
      res.status(201).json(transaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create transaction" });
    }
  });

  // GET watchlist
  app.get("/api/watchlist", async (req, res) => {
    try {
      const watchlist = await storage.getWatchlist(getCurrentUserId(req));
      res.json(watchlist);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch watchlist" });
    }
  });

  // POST add to watchlist
  app.post("/api/watchlist", async (req, res) => {
    try {
      const validated = insertWatchlistSchema.parse(req.body);
      const item = await storage.addToWatchlist(getCurrentUserId(req), validated);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to add to watchlist" });
    }
  });

  // DELETE from watchlist
  app.delete("/api/watchlist/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getWatchlistItem(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Watchlist item not found" });
      }

      await storage.removeFromWatchlist(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove from watchlist" });
    }
  });

  // GET price alerts
  app.get("/api/price-alerts", async (req, res) => {
    try {
      const alerts = await storage.getPriceAlerts(getCurrentUserId(req));
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  // POST create price alert
  app.post("/api/price-alerts", async (req, res) => {
    try {
      const validated = insertPriceAlertSchema.parse(req.body);
      const alert = await storage.createPriceAlert(getCurrentUserId(req), validated);
      res.status(201).json(alert);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create alert" });
    }
  });

  // PATCH update price alert
  app.patch("/api/price-alerts/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getPriceAlert(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Price alert not found" });
      }

      const alert = await storage.updatePriceAlert(req.params.id, req.body);
      res.json(alert);
    } catch (error) {
      res.status(500).json({ error: "Failed to update alert" });
    }
  });

  // DELETE price alert
  app.delete("/api/price-alerts/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getPriceAlert(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Price alert not found" });
      }

      await storage.deletePriceAlert(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete alert" });
    }
  });

  // ==================== RADIO AGENT ====================

  // GET radio slots analysis
  app.get("/api/radio/slots", async (req, res) => {
    try {
      const slots = await getRadioSlotsForMonth(getCurrentUserId(req));
      res.json(slots);
    } catch (error) {
      res.status(500).json({ error: "Failed to analyze radio slots" });
    }
  });

  // GET radio analysis summary
  app.get("/api/radio/analysis", async (req, res) => {
    try {
      const analysis = await analyzeRadioEvents(getCurrentUserId(req));
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ error: "Failed to analyze radio events" });
    }
  });

  // POST send radio slots summary to Telegram
  app.post("/api/radio/notify-slots", async (req, res) => {
    try {
      const result = await sendRadioSlotsSummary();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send radio summary" });
    }
  });

  // POST import DJs from radio history
  app.post("/api/radio/import-djs", async (req, res) => {
    try {
      const result = await importDjsFromRadioHistory(getCurrentUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to import DJs" });
    }
  });

  // GET generated radio template assets
  app.get("/api/radio/templates/assets", async (req, res) => {
    try {
      const eventId = typeof req.query.eventId === "string" ? req.query.eventId : undefined;
      const assets = await storage.getRadioTemplateAssets(getCurrentUserId(req), eventId);
      res.json(assets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch radio template assets" });
    }
  });

  // POST generate today's downloadable Radio templates in Google Drive
  app.post("/api/radio/templates/generate-today", async (req, res) => {
    try {
      const result = await generateRadioTemplatesForDate(getCurrentUserId(req));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate radio templates" });
    }
  });

  // ==================== PROMO VIDEO AGENT ====================

  app.get("/api/promo-video/status", async (req, res) => {
    try {
      const status = await getPromoVideoStatus(getCurrentUserId(req));
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to inspect promo video folders" });
    }
  });

  app.post("/api/promo-video/preview-options", async (req, res) => {
    try {
      res.json(normalizePromoVideoOptions(req.body || {}));
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Invalid promo video options" });
    }
  });

  app.post("/api/promo-video/source", async (req, res) => {
    try {
      const status = await setPromoVideoSourceDir(req.body?.sourceDir, getCurrentUserId(req));
      res.json(status);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to set promo video source folder" });
    }
  });

  app.post("/api/promo-video/import-source", async (req, res) => {
    try {
      const result = await importPromoVideosFromSource(req.body || {}, getCurrentUserId(req));
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to import promo videos" });
    }
  });

  app.post("/api/promo-video/auto-daily", async (req, res) => {
    try {
      const result = await runPromoVideoAutoDaily({ ...(req.body || {}), userId: getCurrentUserId(req) });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to run promo video auto daily" });
    }
  });

  app.delete("/api/promo-video/output/:filename", async (req, res) => {
    try {
      const status = await deletePromoOutputVideo(req.params.filename, getCurrentUserId(req));
      res.json(status);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to delete promo output video" });
    }
  });

  app.post("/api/promo-video/generate", async (req, res) => {
    try {
      const result = await runPromoVideoEdit({ ...(req.body || {}), userId: getCurrentUserId(req) });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate promo videos" });
    }
  });

  // ==================== CLIPPERS COMMAND CENTER ====================

  const publicLocalNewsQuerySchema = z.object({
    city: z.enum(["miami", "new-york"]).optional(),
    lang: z.enum(["es", "en"]).default("es"),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  });
  const publicLocalNewsDetailQuerySchema = z.object({
    lang: z.enum(["es", "en"]).default("es"),
  });
  const publicLocalNewsSlugSchema = z.string().min(1).max(160).regex(/^[a-z0-9-]+$/);
  const sendPublicLocalNews = (req: any, res: any, body: unknown) => {
    const etag = publicLocalNewsEtag(body);
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.set("ETag", etag);
    if (req.header("if-none-match") === etag) return res.status(304).end();
    return res.json(body);
  };

  app.get("/api/public/local-news", async (req, res) => {
    try {
      const query = publicLocalNewsQuerySchema.parse(req.query);
      const feed = await listPublicLocalNews(query);
      return sendPublicLocalNews(req, res, feed);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid public local news query", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to read public local news" });
    }
  });

  app.get("/api/public/local-news/:slug", async (req, res) => {
    try {
      const slug = publicLocalNewsSlugSchema.parse(req.params.slug);
      const query = publicLocalNewsDetailQuerySchema.parse(req.query);
      const article = await getPublicLocalNewsBySlug(slug, query);
      if (!article) return res.status(404).json({ error: "Local news article not found" });
      return sendPublicLocalNews(req, res, article);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid public local news request", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to read public local news article" });
    }
  });

  app.get("/news/article/:slug", async (req, res) => {
    try {
      const slug = publicLocalNewsSlugSchema.parse(req.params.slug);
      const query = publicLocalNewsDetailQuerySchema.parse(req.query);
      const article = await getPublicLocalNewsBySlug(slug, query);
      if (!article) {
        return res.status(404).type("html").send("<!doctype html><html><head><meta charset=\"utf-8\"><title>Article not found</title></head><body><main><h1>Article not found</h1></main></body></html>");
      }
      const configuredBase = (() => {
        try {
          const parsed = new URL(process.env.PUBLIC_BASE_URL || "");
          if (parsed.protocol === "https:" || parsed.protocol === "http:") return `${parsed.protocol}//${parsed.host}`;
        } catch { /* use the request origin */ }
        return `${req.protocol}://${req.get("host")}`;
      })();
      const canonicalUrl = `${configuredBase}/news/article/${encodeURIComponent(article.slug)}?lang=${article.lang}`;
      const imageName = article.city === "miami" ? "miami-news-profile.png" : "ny-news-profile.png";
      const imageUrl = `${configuredBase}/local-news/${imageName}`;
      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.status(200).type("html").send(renderPublicLocalNewsShareHtml(article, canonicalUrl, imageUrl));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).type("html").send("<!doctype html><html><head><meta charset=\"utf-8\"><title>Invalid article request</title></head><body><main><h1>Invalid article request</h1></main></body></html>");
      }
      return res.status(500).type("html").send("<!doctype html><html><head><meta charset=\"utf-8\"><title>Article unavailable</title></head><body><main><h1>Article unavailable</h1></main></body></html>");
    }
  });

  app.use("/api/clippers", (req, res, next) => {
    const userId = getCurrentUserId(req);
    const clipperOwnerUserId = getSystemUserId();
    if (userId !== clipperOwnerUserId) {
      return res.status(403).json({
        error: "Clippers tools are limited to the configured single-user owner while local workspace, token vault, and launch artifacts are shared.",
      });
    }
    return next();
  });

  app.get("/api/clippers/status", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const status = await getClipperStatus(getCurrentUserId(req));
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to inspect clippers status" });
    }
  });

  app.get("/api/clippers/runtime-status", async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await getClipperWorkerRuntimeStatus());
    } catch {
      res.status(500).json({ error: "Failed to inspect Clippers worker runtime" });
    }
  });

  app.get("/api/clippers/local-news/status", async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const [status, metricool, growthScout] = await Promise.all([
        getClipperLocalNewsStatus(),
        getClipperLocalNewsMetricoolReadiness(),
        readLocalNewsGrowthScoutStatus(),
      ]);
      res.json({ ...status, deliveryPolicy: await readLocalNewsDeliveryPolicy(), scheduler: getClipperLocalNewsSchedulerStatus(), metricool, growthScout, metricoolAnalytics: { sync: await getMetricoolAnalyticsSyncStatus(), scheduler: getMetricoolAnalyticsSchedulerStatus() } });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to inspect clippers local news status" });
    }
  });

  app.get("/api/clippers/local-news/growth-scout", async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await readLocalNewsGrowthScoutStatus());
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to inspect local news growth scout" });
    }
  });

  app.post("/api/clippers/local-news/growth-scout/run", async (_req, res) => {
    try {
      res.json({ snapshot: await runLocalNewsGrowthScoutNow(), status: getLocalNewsGrowthScoutStatus() });
    } catch (error: any) {
      res.status(502).json({ error: error.message || "Failed to run local news growth scout" });
    }
  });

  app.post("/api/clippers/local-news/bootstrap", async (_req, res) => {
    try {
      res.json(await bootstrapClipperLocalNews());
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to bootstrap clippers local news" });
    }
  });

  app.post("/api/clippers/local-news/run-cycle", async (req, res) => {
    try {
      // Keep scheduler/test-only options out of the public HTTP boundary.
      const input = {
        ...(req.body?.events !== undefined ? { events: req.body.events } : {}),
        ...(req.body?.resolveMissing !== undefined ? { resolveMissing: req.body.resolveMissing } : {}),
      };
      const cycle = await runClipperLocalNewsCycle(input);
      const metricoolDelivery = await deliverClipperLocalNewsToMetricool({ status: cycle.status });
      res.json({
        ...cycle, cycleExecution: "completed", metricoolDelivery,
        status: { ...cycle.status, deliveryPolicy: await readLocalNewsDeliveryPolicy(), deliverySummary: {
          status: metricoolDelivery.status, scheduled: metricoolDelivery.scheduled,
          publicationConfirmed: metricoolDelivery.publicationConfirmed, pendingReconciliation: metricoolDelivery.pendingReconciliation,
        } },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid clippers local news cycle payload", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to run clippers local news cycle" });
    }
  });

  app.post("/api/clippers/local-news/ingest-events", async (req, res) => {
    try {
      // Allow only public ingestion controls; never forward internal options.
      const input = {
        events: req.body?.events,
        ...(req.body?.resolveMissing !== undefined ? { resolveMissing: req.body.resolveMissing } : {}),
        ...(req.body?.snapshotLanes !== undefined ? { snapshotLanes: req.body.snapshotLanes } : {}),
      };
      res.json(await ingestClipperLocalNewsEvents(input));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid clippers local news events payload", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to ingest clippers local news events" });
    }
  });

  app.post("/api/clippers/local-news/record-metrics", async (req, res) => {
    try {
      // Metrics is the sole public field for this endpoint.
      res.json(await recordClipperLocalNewsMetrics({ metrics: req.body?.metrics }));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid clippers local news metrics payload", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to record clippers local news metrics" });
    }
  });

  app.post("/api/clippers/local-news/sync-metricool-analytics", async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await syncMetricoolAnalytics());
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to sync Metricool analytics" });
    }
  });

  app.post("/api/clippers/run-daily-plan", async (req, res) => {
    try {
      const result = await runClipperDailyPlan(req.body || {}, getCurrentUserId(req));
      res.json({ report: result.report });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate clippers daily plan" });
    }
  });

  app.post("/api/clippers/bootstrap-accounts", async (req, res) => {
    try {
      const status = await bootstrapClipperAccounts(getCurrentUserId(req));
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers accounts" });
    }
  });

  app.post("/api/clippers/bootstrap-workspace", async (req, res) => {
    try {
      const status = await bootstrapClipperWorkspace(getCurrentUserId(req));
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers workspace" });
    }
  });

  app.post("/api/clippers/prepare-account-identity-kit", async (req, res) => {
    try {
      const result = await prepareClipperAccountIdentityKit(getCurrentUserId(req));
      res.json({ accountIdentityKit: result.accountIdentityKit });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers account identity kit" });
    }
  });

  app.post("/api/clippers/prepare-account-launch-kit", async (req, res) => {
    try {
      const result = await prepareClipperAccountLaunchKit(getCurrentUserId(req));
      res.json({ accountLaunchKit: result.accountLaunchKit });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers account launch kit" });
    }
  });

  app.post("/api/clippers/prepare-account-creation-pack", async (req, res) => {
    try {
      const result = await prepareClipperAccountCreationPack(getCurrentUserId(req));
      res.json({ accountCreationPack: result.accountCreationPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers account creation pack" });
    }
  });

  app.post("/api/clippers/prepare-account-setup-session", async (req, res) => {
    try {
      const result = await prepareClipperAccountSetupSession(getCurrentUserId(req));
      res.json({ accountSetupSession: result.accountSetupSession });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers account setup session" });
    }
  });

  app.post("/api/clippers/prepare-manual-posting-pack", async (req, res) => {
    try {
      const result = await prepareClipperManualPostingPack(getCurrentUserId(req));
      res.json({ manualPostingPack: result.manualPostingPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers manual posting pack" });
    }
  });

  app.post("/api/clippers/prepare-account-evidence-vault", async (req, res) => {
    try {
      const result = await prepareClipperAccountEvidenceVault(getCurrentUserId(req));
      res.json({ accountEvidence: result.accountEvidence });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers account evidence vault" });
    }
  });

  app.get("/api/clippers/account-permission-readiness", async (_req, res) => {
    try {
      res.json({ accountPermissionReadiness: await readClipperAccountPermissionReadiness() });
    } catch (error: any) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      res.status(status).json({ error: error.message || (status === 404 ? "Account permission readiness has not been prepared" : "Account permission readiness could not be read") });
    }
  });

  app.post("/api/clippers/prepare-account-permission-readiness", async (_req, res) => {
    try {
      await runClipperAccountPermissionReadiness();
      res.json({ accountPermissionReadiness: await readClipperAccountPermissionReadiness() });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers account permission readiness" });
    }
  });

  app.get("/api/clippers/operational-readiness", async (_req, res) => {
    try {
      res.json({ operationalReadiness: await readClipperOperationalReadiness() });
    } catch (error: any) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      res.status(status).json({ error: error.message || (status === 404 ? "Operational readiness has not been prepared" : "Operational readiness could not be read") });
    }
  });

  app.post("/api/clippers/prepare-operational-readiness", async (_req, res) => {
    try {
      await runClipperOperationalReadiness();
      res.json({ operationalReadiness: await readClipperOperationalReadiness() });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers operational readiness" });
    }
  });

  app.get("/api/clippers/external-closeout-pack", async (_req, res) => {
    try {
      res.json({ externalCloseoutPack: await readClipperExternalCloseoutPack() });
    } catch (error: any) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      res.status(status).json({ error: error.message || (status === 404 ? "External closeout pack has not been prepared" : "External closeout pack could not be read") });
    }
  });

  app.post("/api/clippers/prepare-external-closeout-pack", async (_req, res) => {
    try {
      await runClipperExternalCloseoutPack();
      res.json({
        externalCloseoutPack: await readClipperExternalCloseoutPack(),
        externalCloseoutProofTodo: await readClipperExternalCloseoutProofTodo(),
        externalCloseoutOperatorQueue: await readClipperExternalCloseoutOperatorQueue(),
        externalCloseoutNextAction: await readClipperExternalCloseoutNextAction(),
        externalCloseoutNextWorkRun: await readClipperExternalCloseoutNextWorkRun(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers external closeout pack" });
    }
  });

  app.get("/api/clippers/external-closeout-proof-todo", async (_req, res) => {
    try {
      res.json({ externalCloseoutProofTodo: await readClipperExternalCloseoutProofTodo() });
    } catch (error: any) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      res.status(status).json({ error: error.message || (status === 404 ? "External closeout proof todo has not been prepared" : "External closeout proof todo could not be read") });
    }
  });

  app.get("/api/clippers/external-closeout-operator-queue", async (_req, res) => {
    try {
      res.json({ externalCloseoutOperatorQueue: await readClipperExternalCloseoutOperatorQueue() });
    } catch (error: any) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      res.status(status).json({ error: error.message || (status === 404 ? "External closeout operator queue has not been prepared" : "External closeout operator queue could not be read") });
    }
  });

  app.get("/api/clippers/external-closeout-next-action", async (_req, res) => {
    try {
      res.json({ externalCloseoutNextAction: await readClipperExternalCloseoutNextAction() });
    } catch (error: any) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      res.status(status).json({ error: error.message || (status === 404 ? "External closeout next action has not been prepared" : "External closeout next action could not be read") });
    }
  });

  app.get("/api/clippers/external-next-work-run", async (_req, res) => {
    try {
      res.json({ externalCloseoutNextWorkRun: await readClipperExternalCloseoutNextWorkRun() });
    } catch (error: any) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      res.status(status).json({ error: error.message || (status === 404 ? "External next work run has not been prepared" : "External next work run could not be read") });
    }
  });

  app.post("/api/clippers/prepare-external-next-work-run", async (_req, res) => {
    try {
      await runClipperExternalCloseoutPack();
      res.json({
        externalCloseoutNextWorkRun: await readClipperExternalCloseoutNextWorkRun(),
        externalCloseoutNextAction: await readClipperExternalCloseoutNextAction(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers external next work run" });
    }
  });

  app.get("/api/clippers/external-closeout-evidence-import", async (_req, res) => {
    try {
      res.json({ externalCloseoutEvidenceImport: await readClipperExternalCloseoutEvidenceImport() });
    } catch (error: any) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      res.status(status).json({ error: error.message || (status === 404 ? "External closeout evidence import has not been previewed" : "External closeout evidence import could not be read") });
    }
  });

  app.get("/api/clippers/external-closeout-repair-work-packet", async (_req, res) => {
    try {
      res.json({ externalCloseoutRepairWorkPacket: await readClipperExternalCloseoutRepairWorkPacket() });
    } catch (error: any) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      res.status(status).json({ error: error.message || (status === 404 ? "External closeout repair work packet has not been prepared" : "External closeout repair work packet could not be read") });
    }
  });

  app.post("/api/clippers/preview-external-closeout-evidence-import", async (_req, res) => {
    try {
      await runClipperExternalCloseoutEvidenceImport(false);
      await runClipperExternalCloseoutPack();
      res.json({
        externalCloseoutEvidenceImport: await readClipperExternalCloseoutEvidenceImport(),
        externalCloseoutPack: await readClipperExternalCloseoutPack(),
        externalCloseoutProofTodo: await readClipperExternalCloseoutProofTodo(),
        externalCloseoutOperatorQueue: await readClipperExternalCloseoutOperatorQueue(),
        externalCloseoutNextAction: await readClipperExternalCloseoutNextAction(),
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to preview clippers external closeout evidence import" });
    }
  });

  app.post("/api/clippers/apply-external-closeout-evidence-import", async (_req, res) => {
    try {
      if (_req.get("x-clippers-operator-confirm") !== "apply-external-closeout-evidence") {
        res.status(403).json({ error: "Operator confirmation header required for external closeout evidence apply." });
        return;
      }
      await runClipperExternalCloseoutEvidenceImport(true);
      const externalCloseoutEvidenceImport = await readClipperExternalCloseoutEvidenceImport();
      if (externalCloseoutEvidenceImport.status !== "import_applied") {
        await runClipperExternalCloseoutPack();
        res.status(400).json({
          error: "External closeout evidence import is not clean enough to apply. Run preview and fix rejected rows first.",
          externalCloseoutEvidenceImport,
          externalCloseoutPack: await readClipperExternalCloseoutPack(),
          externalCloseoutProofTodo: await readClipperExternalCloseoutProofTodo(),
          externalCloseoutOperatorQueue: await readClipperExternalCloseoutOperatorQueue(),
          externalCloseoutNextAction: await readClipperExternalCloseoutNextAction(),
        });
        return;
      }
      await runClipperAccountPermissionReadiness();
      await runClipperOperationalReadiness();
      await runClipperExternalCloseoutPack();
      res.json({
        externalCloseoutEvidenceImport,
        accountPermissionReadiness: await readClipperAccountPermissionReadiness(),
        operationalReadiness: await readClipperOperationalReadiness(),
        externalCloseoutPack: await readClipperExternalCloseoutPack(),
        externalCloseoutProofTodo: await readClipperExternalCloseoutProofTodo(),
        externalCloseoutOperatorQueue: await readClipperExternalCloseoutOperatorQueue(),
        externalCloseoutNextAction: await readClipperExternalCloseoutNextAction(),
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to apply clippers external closeout evidence import" });
    }
  });

  app.post("/api/clippers/apply-ready-external-closeout-evidence-import", async (_req, res) => {
    try {
      if (_req.get("x-clippers-operator-confirm") !== "apply-ready-external-closeout-evidence") {
        res.status(403).json({ error: "Operator confirmation header required for partial external closeout evidence apply." });
        return;
      }
      await runClipperExternalCloseoutEvidenceImport(false, true);
      const externalCloseoutEvidenceImport = await readClipperExternalCloseoutEvidenceImport();
      if (externalCloseoutEvidenceImport.status !== "partial_import_applied" && externalCloseoutEvidenceImport.status !== "import_applied") {
        await runClipperExternalCloseoutPack();
        res.status(400).json({
          error: "No validated external closeout evidence rows were ready to apply.",
          externalCloseoutEvidenceImport,
          externalCloseoutPack: await readClipperExternalCloseoutPack(),
          externalCloseoutProofTodo: await readClipperExternalCloseoutProofTodo(),
          externalCloseoutOperatorQueue: await readClipperExternalCloseoutOperatorQueue(),
          externalCloseoutNextAction: await readClipperExternalCloseoutNextAction(),
        });
        return;
      }
      await runClipperAccountPermissionReadiness();
      await runClipperOperationalReadiness();
      await runClipperExternalCloseoutPack();
      res.json({
        externalCloseoutEvidenceImport,
        accountPermissionReadiness: await readClipperAccountPermissionReadiness(),
        operationalReadiness: await readClipperOperationalReadiness(),
        externalCloseoutPack: await readClipperExternalCloseoutPack(),
        externalCloseoutProofTodo: await readClipperExternalCloseoutProofTodo(),
        externalCloseoutOperatorQueue: await readClipperExternalCloseoutOperatorQueue(),
        externalCloseoutNextAction: await readClipperExternalCloseoutNextAction(),
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to apply ready clippers external closeout evidence rows" });
    }
  });

  app.post("/api/clippers/record-account-evidence", async (req, res) => {
    try {
      const result = await recordClipperAccountEvidence(req.body || {}, getCurrentUserId(req));
      res.json({ accountEvidence: result.accountEvidence });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to record clippers account evidence" });
    }
  });

  app.post("/api/clippers/prepare-developer-app-evidence-vault", async (req, res) => {
    try {
      const result = await prepareClipperDeveloperAppEvidenceVault(getCurrentUserId(req));
      res.json({ developerAppEvidence: result.developerAppEvidence });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers developer app evidence vault" });
    }
  });

  app.post("/api/clippers/record-developer-app-evidence", async (req, res) => {
    try {
      const result = await recordClipperDeveloperAppEvidence(req.body || {}, getCurrentUserId(req));
      res.json({ developerAppEvidence: result.developerAppEvidence });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to record clippers developer app evidence" });
    }
  });

  app.post("/api/clippers/preview-launch-evidence-batch", async (req, res) => {
    try {
      const result = await previewClipperLaunchEvidenceBatch(req.body || {}, getCurrentUserId(req));
      res.json({ launchEvidenceBatchPreview: result.launchEvidenceBatchPreview });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to preview clippers launch evidence batch" });
    }
  });

  app.post("/api/clippers/record-launch-evidence-batch", async (req, res) => {
    try {
      const result = await recordClipperLaunchEvidenceBatch(req.body || {}, getCurrentUserId(req));
      res.json({ launchEvidenceBatch: result.launchEvidenceBatch });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to record clippers launch evidence batch" });
    }
  });

  app.post("/api/clippers/import-launch-evidence-drop-files", async (req, res) => {
    try {
      const result = await importClipperLaunchEvidenceDropFiles(getCurrentUserId(req), req.body || {});
      res.json({ launchEvidenceDropImport: result.launchEvidenceDropImport });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to import clippers launch evidence drop files" });
    }
  });

  app.post("/api/clippers/prepare-go-live-evidence-bundle", async (req, res) => {
    try {
      const result = await prepareClipperGoLiveEvidenceBundle(getCurrentUserId(req));
      res.json({ goLiveEvidenceBundle: result.goLiveEvidenceBundle });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers go-live evidence bundle" });
    }
  });

  app.post("/api/clippers/prepare-credential-setup", async (req, res) => {
    try {
      const result = await prepareClipperCredentialSetupCenter(getCurrentUserId(req));
      res.json({ credentialSetup: result.credentialSetup });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers credential setup center" });
    }
  });

  app.post("/api/clippers/prepare-credential-drop-starter", async (req, res) => {
    try {
      const result = await prepareClipperCredentialDropStarter(getCurrentUserId(req));
      res.json({ credentialDropStarter: result.credentialDropStarter });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers credential drop starter" });
    }
  });

  app.post("/api/clippers/prepare-credential-doctor", async (req, res) => {
    try {
      const result = await prepareClipperCredentialDoctor(getCurrentUserId(req));
      res.json({ credentialDoctor: result.credentialDoctor });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers credential doctor" });
    }
  });

  app.post("/api/clippers/record-credential-secret", async (req, res) => {
    try {
      const result = await recordClipperCredentialSecret(req.body || {}, getCurrentUserId(req));
      res.json({ credentialSecret: result.credentialSecret });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to record clippers credential secret" });
    }
  });

  app.post("/api/clippers/preview-credential-secrets-batch", async (req, res) => {
    try {
      const result = await previewClipperCredentialSecretsBatch(req.body || {}, getCurrentUserId(req));
      res.json({ credentialSecretsBatchPreview: result.credentialSecretsBatchPreview });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to preview clippers credential secrets batch" });
    }
  });

  app.post("/api/clippers/record-credential-secrets-batch", async (req, res) => {
    try {
      const result = await recordClipperCredentialSecretsBatch(req.body || {}, getCurrentUserId(req));
      res.json({ credentialSecretsBatch: result.credentialSecretsBatch });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to record clippers credential secrets batch" });
    }
  });

  app.post("/api/clippers/import-credential-drop-files", async (req, res) => {
    try {
      const result = await importClipperCredentialDropFiles(getCurrentUserId(req));
      res.json({ credentialDropImport: result.credentialDropImport });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to import clippers credential drop files" });
    }
  });

  app.post("/api/clippers/record-production-public-url", async (req, res) => {
    try {
      const result = await recordClipperProductionPublicUrl(req.body || {}, getCurrentUserId(req));
      res.json({ productionPublicUrl: result.productionPublicUrl });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to record clippers production public URL" });
    }
  });

  app.post("/api/clippers/prepare-platform-readiness", async (req, res) => {
    try {
      const result = await prepareClipperPlatformReadinessMatrix(getCurrentUserId(req));
      res.json({ platformReadiness: result.platformReadiness });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers platform readiness matrix" });
    }
  });

  app.post("/api/clippers/prepare-external-setup-queue", async (req, res) => {
    try {
      const result = await prepareClipperExternalSetupQueue(getCurrentUserId(req));
      res.json({ externalSetupQueue: result.externalSetupQueue });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers external setup queue" });
    }
  });

  app.post("/api/clippers/prepare-external-execution-handoff", async (req, res) => {
    try {
      const result = await prepareClipperExternalExecutionHandoff(getCurrentUserId(req));
      res.json({ externalExecutionHandoff: result.externalExecutionHandoff });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers external execution handoff" });
    }
  });

  app.post("/api/clippers/prepare-external-execution-session", async (req, res) => {
    try {
      const result = await prepareClipperExternalExecutionSession(getCurrentUserId(req));
      res.json({ externalExecutionSession: result.externalExecutionSession });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers external execution session" });
    }
  });

  app.post("/api/clippers/prepare-external-launch-dossier", async (req, res) => {
    try {
      const result = await prepareClipperExternalLaunchDossier(getCurrentUserId(req));
      res.json({ externalLaunchDossier: result.externalLaunchDossier });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers external launch dossier" });
    }
  });

  app.post("/api/clippers/prepare-platform-portal-checklist", async (req, res) => {
    try {
      const result = await prepareClipperPlatformPortalChecklist(getCurrentUserId(req));
      res.json({ platformPortalChecklist: result.platformPortalChecklist });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers platform portal checklist" });
    }
  });

  app.post("/api/clippers/prepare-official-permission-matrix", async (req, res) => {
    try {
      const result = await prepareClipperOfficialPermissionMatrix(getCurrentUserId(req));
      res.json({ officialPermissionMatrix: result.officialPermissionMatrix });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers official permission matrix" });
    }
  });

  app.post("/api/clippers/prepare-official-permission-source-audit", async (req, res) => {
    try {
      const result = await prepareClipperOfficialPermissionSourceAudit(getCurrentUserId(req));
      res.json({
        officialPermissionSourceAudit: result.officialPermissionSourceAudit,
        officialPermissionMatrix: {
          status: result.officialPermissionMatrix.status,
          generatedAt: result.officialPermissionMatrix.generatedAt,
          manifestPath: result.officialPermissionMatrix.manifestPath,
          markdownPath: result.officialPermissionMatrix.markdownPath,
          csvPath: result.officialPermissionMatrix.csvPath,
          verifiedAt: result.officialPermissionMatrix.verifiedAt,
          totals: result.officialPermissionMatrix.totals,
          nextStep: result.officialPermissionMatrix.nextStep,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers official permission source audit" });
    }
  });

  app.post("/api/clippers/prepare-app-review-submission-pack", async (req, res) => {
    try {
      const result = await prepareClipperAppReviewSubmissionPack(getCurrentUserId(req));
      res.json({ appReviewSubmissionPack: result.appReviewSubmissionPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers app review submission pack" });
    }
  });

  app.post("/api/clippers/prepare-app-review-demo-pack", async (req, res) => {
    try {
      const result = await prepareClipperAppReviewDemoPack(getCurrentUserId(req));
      res.json({ appReviewDemoPack: result.appReviewDemoPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers app review demo pack" });
    }
  });

  app.post("/api/clippers/prepare-developer-application-drafts", async (req, res) => {
    try {
      const result = await prepareClipperDeveloperApplicationDrafts(getCurrentUserId(req));
      res.json({ developerApplicationDrafts: result.developerApplicationDrafts });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers developer application drafts" });
    }
  });

  app.post("/api/clippers/prepare-go-live-execution-pack", async (req, res) => {
    try {
      const result = await prepareClipperGoLiveExecutionPack(getCurrentUserId(req));
      res.json({ goLiveExecutionPack: result.goLiveExecutionPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers go-live execution pack" });
    }
  });

  app.post("/api/clippers/prepare-go-live-completion-audit", async (req, res) => {
    try {
      const result = await prepareClipperGoLiveCompletionAudit(getCurrentUserId(req));
      res.json({ goLiveCompletionAudit: result.goLiveCompletionAudit });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers go-live completion audit" });
    }
  });

  app.post("/api/clippers/prepare-go-live-operator-brief", async (req, res) => {
    try {
      const result = await prepareClipperGoLiveOperatorBrief(getCurrentUserId(req));
      res.json({ goLiveOperatorBrief: result.goLiveOperatorBrief });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers go-live operator brief" });
    }
  });

  app.post("/api/clippers/prepare-publisher-connectors", async (req, res) => {
    try {
      const result = await prepareClipperPublisherConnectors(getCurrentUserId(req));
      res.json({ publisherConnectors: result.publisherConnectors });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers publisher connectors" });
    }
  });

  app.post("/api/clippers/prepare-metricool-publishing-plan", async (req, res) => {
    try {
      const result = await prepareClipperMetricoolPublishingPlan(getCurrentUserId(req));
      res.json({ metricoolPublishing: result.metricoolPublishing });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers Metricool publishing plan" });
    }
  });

  app.post("/api/clippers/prepare-metricool-execution-queue", async (req, res) => {
    try {
      const result = await prepareClipperMetricoolExecutionQueue(getCurrentUserId(req));
      res.json({ metricoolExecutionQueue: result.metricoolExecutionQueue });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers Metricool execution queue" });
    }
  });

  app.post("/api/clippers/prepare-metricool-mvp-launch-pack", async (req, res) => {
    try {
      const result = await prepareClipperMetricoolMvpLaunchPack(getCurrentUserId(req));
      res.json({ metricoolMvpLaunchPack: result.metricoolMvpLaunchPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers Metricool MVP launch pack" });
    }
  });

  app.post("/api/clippers/prepare-metricool-approval-session", async (req, res) => {
    try {
      const result = await prepareClipperMetricoolApprovalSession(getCurrentUserId(req));
      res.json({ metricoolApprovalSession: result.metricoolApprovalSession, status: result.status });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers Metricool approval session" });
    }
  });

  app.post("/api/clippers/prepare-metricool-approval-report", async (req, res) => {
    try {
      const result = await prepareClipperMetricoolApprovalReport(getCurrentUserId(req));
      res.json({ metricoolApprovalReport: result.metricoolApprovalReport, status: result.status });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers Metricool approval report" });
    }
  });

  app.post("/api/clippers/import-metricool-approval-evidence", async (req, res) => {
    try {
      const result = await importClipperMetricoolApprovalEvidence(getCurrentUserId(req));
      res.json({ metricoolApprovalEvidenceImport: result.metricoolApprovalEvidenceImport, metrics: result.metrics, status: result.status });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to import Clippers Metricool approval evidence" });
    }
  });

  app.post("/api/clippers/record-metricool-account-evidence", async (req, res) => {
    try {
      const result = await recordClipperMetricoolAccountEvidence(getCurrentUserId(req));
      res.json({ metricoolAccountEvidence: result.metricoolAccountEvidence, status: result.status });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to record Clippers Metricool account evidence" });
    }
  });

  app.post("/api/clippers/prepare-publisher-execution-queue", async (req, res) => {
    try {
      const result = await prepareClipperPublisherExecutionQueue(getCurrentUserId(req));
      res.json({ publisherExecutionQueue: result.publisherExecutionQueue });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers publisher execution queue" });
    }
  });

  app.post("/api/clippers/prepare-production-url-setup", async (req, res) => {
    try {
      const result = await prepareClipperProductionUrlSetup(getCurrentUserId(req));
      res.json({ productionUrlSetup: result.productionUrlSetup });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers production URL setup" });
    }
  });

  app.post("/api/clippers/verify-production-url", async (req, res) => {
    try {
      const result = await verifyClipperProductionUrl(getCurrentUserId(req));
      res.json({ productionUrlVerification: result.productionUrlVerification });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to verify clippers production URL" });
    }
  });

  app.post("/api/clippers/verify-production-local-preflight", async (req, res) => {
    try {
      const result = await verifyClipperProductionLocalPreflight(getCurrentUserId(req));
      res.json({ productionLocalPreflight: result.productionLocalPreflight, status: result.status });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to verify clippers local production preflight" });
    }
  });

  app.post("/api/clippers/prepare-https-tunnel-plan", async (req, res) => {
    try {
      const result = await prepareClipperHttpsTunnelPlan(getCurrentUserId(req));
      res.json({ httpsTunnelPlan: result.httpsTunnelPlan });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers HTTPS tunnel plan" });
    }
  });

  app.post("/api/clippers/prepare-legal-policy-pack", async (req, res) => {
    try {
      const result = await prepareClipperLegalPolicyPack(getCurrentUserId(req));
      res.json({ legalPolicyPack: result.legalPolicyPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers legal policy pack" });
    }
  });

  app.post("/api/clippers/prepare-oauth-go-live", async (req, res) => {
    try {
      const result = await prepareClipperOAuthGoLivePreflight(getCurrentUserId(req));
      res.json({ oauthGoLive: result.oauthGoLive });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers OAuth go-live preflight" });
    }
  });

  app.post("/api/clippers/prepare-oauth-connection-pack", async (req, res) => {
    try {
      const result = await prepareClipperOAuthConnectionPack(getCurrentUserId(req));
      res.json({ oauthConnectionPack: result.oauthConnectionPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers OAuth connection pack" });
    }
  });

  app.post("/api/clippers/reload-credentials", async (req, res) => {
    try {
      const result = await reloadClipperCredentials(getCurrentUserId(req));
      res.json({ credentialReload: result.credentialReload });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to reload clippers credentials" });
    }
  });

  app.post("/api/clippers/prepare-command-center", async (req, res) => {
    try {
      const result = await prepareClipperLaunchCommandCenter(getCurrentUserId(req), req.body || {});
      res.json({ commandCenter: result.commandCenter });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers launch command center" });
    }
  });

  app.post("/api/clippers/prepare-blocker-resolution-pack", async (req, res) => {
    try {
      const result = await prepareClipperBlockerResolutionPack(getCurrentUserId(req));
      res.json({ blockerResolutionPack: result.blockerResolutionPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers blocker resolution pack" });
    }
  });

  app.post("/api/clippers/prepare-go-live-autopilot-brief", async (req, res) => {
    try {
      const result = await prepareClipperGoLiveAutopilotBrief(getCurrentUserId(req));
      res.json({ goLiveAutopilotBrief: result.goLiveAutopilotBrief });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers go-live autopilot brief" });
    }
  });

  app.post("/api/clippers/run-go-live-autopilot", async (req, res) => {
    try {
      const result = await runClipperGoLiveAutopilot(req.body || {}, getCurrentUserId(req));
      res.json({
        goLiveAutopilotRun: result.goLiveAutopilotRun,
        goLiveAutopilotBrief: result.goLiveAutopilotBrief,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to run clippers go-live autopilot" });
    }
  });

  app.post("/api/clippers/run-go-live-prep-sweep", async (req, res) => {
    try {
      const result = await runClipperGoLivePrepSweep(getCurrentUserId(req));
      res.json({
        goLivePrepSweep: result.goLivePrepSweep,
        localDropSync: result.localDropSync,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to run clippers go-live prep sweep" });
    }
  });

  app.post("/api/clippers/run-post-connect-activation-sweep", async (req, res) => {
    try {
      const result = await runClipperPostConnectActivationSweep(getCurrentUserId(req));
      res.json({
        postConnectActivationSweep: result.postConnectActivationSweep,
        goLivePrepSweep: result.goLivePrepSweep,
        localDropSync: result.localDropSync,
        robertNextActions: result.robertNextActions,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to run clippers post-connect activation sweep" });
    }
  });

  app.post("/api/clippers/run-intake-refresh-sweep", async (req, res) => {
    try {
      const result = await runClipperIntakeRefreshSweep(getCurrentUserId(req), { mode: "cached" });
      const intakeRefreshSweep = result.intakeRefreshSweep;
      res.json({
        intakeRefreshSweep: {
          ...intakeRefreshSweep,
          intakeConsole: {
            ...intakeRefreshSweep.intakeConsole,
            lanes: [],
          },
          completedSteps: intakeRefreshSweep.completedSteps.map((_, index) => `completed-${index + 1}`),
          skippedOrBlockedSteps: intakeRefreshSweep.skippedOrBlockedSteps.map((_, index) => `blocked-${index + 1}`),
          blockers: intakeRefreshSweep.blockers.map((_, index) => `blocker-${index + 1}`),
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to run clippers intake refresh sweep" });
    }
  });

  app.post("/api/clippers/prepare-100-clips-execution-sprint", async (req, res) => {
    try {
      const result = await prepareClipper100ClipsExecutionSprint(getCurrentUserId(req));
      res.json({
        hundredClipsExecutionSprint: result.hundredClipsExecutionSprint,
        externalAccountPermissionSprint: result.externalAccountPermissionSprint,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers 100 clips execution sprint" });
    }
  });

  app.post("/api/clippers/prepare-external-account-permission-sprint", async (req, res) => {
    try {
      const result = await prepareClipperExternalAccountPermissionSprint(getCurrentUserId(req));
      res.json({
        hundredClipsExecutionSprint: result.hundredClipsExecutionSprint,
        externalAccountPermissionSprint: result.externalAccountPermissionSprint,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers external account permission sprint" });
    }
  });

  app.post("/api/clippers/prepare-external-connect-sprint", async (req, res) => {
    try {
      const result = await prepareClipperExternalConnectSprint(getCurrentUserId(req));
      const externalConnectSprint = result.externalConnectSprint;
      res.json({
        externalConnectSprint: {
          ...externalConnectSprint,
          items: externalConnectSprint.items.slice(0, 12).map((item) => ({
            ...item,
            evidenceRows: item.evidenceRows.slice(0, 3),
            blockers: item.blockers.slice(0, 4),
            doneCriteria: item.doneCriteria.slice(0, 3),
            unlocks: item.unlocks.slice(0, 4),
          })),
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers external connect sprint" });
    }
  });

  app.post("/api/clippers/run-external-connect-autopilot", async (req, res) => {
    try {
      const result = await runClipperExternalConnectAutopilot(getCurrentUserId(req));
      const externalConnectAutopilot = result.externalConnectAutopilot;
      res.json({
        externalConnectAutopilot: {
          ...externalConnectAutopilot,
          steps: externalConnectAutopilot.steps.slice(0, 18),
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to run clippers external connect autopilot" });
    }
  });

  app.post("/api/clippers/prepare-owner-connect-pack", async (req, res) => {
    try {
      const result = await prepareClipperOwnerConnectPack(getCurrentUserId(req));
      res.json({ ownerConnectPack: result.ownerConnectPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers owner connect pack" });
    }
  });

  app.post("/api/clippers/prepare-dropzone-ready-pack", async (req, res) => {
    try {
      const result = await prepareClipperDropzoneReadyPack(getCurrentUserId(req));
      res.json({ dropzoneReadyPack: result.dropzoneReadyPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers dropzone ready pack" });
    }
  });

  app.post("/api/clippers/prepare-robert-next-actions", async (req, res) => {
    try {
      const result = await prepareClipperRobertNextActions(getCurrentUserId(req));
      res.json({ robertNextActions: result.robertNextActions });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers Robert next actions" });
    }
  });

  app.post("/api/clippers/prepare-launch-lane-matrix", async (req, res) => {
    try {
      const result = await prepareClipperLaunchLaneMatrix(getCurrentUserId(req));
      res.json({ launchLaneMatrix: result.launchLaneMatrix });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers launch lane matrix" });
    }
  });

  app.post("/api/clippers/prepare-launch-evidence-fix-pack", async (req, res) => {
    try {
      const result = await prepareClipperLaunchEvidenceFixPack(getCurrentUserId(req));
      res.json({ launchEvidenceFixPack: result.launchEvidenceFixPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers launch evidence fix pack" });
    }
  });

  app.post("/api/clippers/record-owner-connect-progress", async (req, res) => {
    try {
      const result = await recordClipperOwnerConnectProgress(req.body || {}, getCurrentUserId(req));
      res.json({ ownerConnectPack: result.ownerConnectPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to record clippers owner connect progress" });
    }
  });

  app.post("/api/clippers/run-local-drop-sync", async (req, res) => {
    try {
      const result = await runClipperLocalDropSync(getCurrentUserId(req));
      res.json({ localDropSync: result.localDropSync });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to run clippers local drop sync" });
    }
  });

  app.post("/api/clippers/prepare-permissions", async (req, res) => {
    try {
      const result = await prepareClipperPermissionPack(getCurrentUserId(req));
      res.json({ pack: result.pack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers permission pack" });
    }
  });

  app.post("/api/clippers/prepare-permission-tracker", async (req, res) => {
    try {
      const result = await prepareClipperPermissionTracker(getCurrentUserId(req));
      res.json({ permissionTracker: result.permissionTracker });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers permission tracker" });
    }
  });

  app.post("/api/clippers/prepare-permission-request-pack", async (req, res) => {
    try {
      const result = await prepareClipperPermissionRequestPack(getCurrentUserId(req));
      res.json({ permissionRequestPack: result.permissionRequestPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers permission request pack" });
    }
  });

  app.post("/api/clippers/prepare-permission-submission-dossier", async (req, res) => {
    try {
      const result = await prepareClipperPermissionSubmissionDossier(getCurrentUserId(req));
      res.json({ permissionSubmissionDossier: result.permissionSubmissionDossier });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers permission submission dossier" });
    }
  });

  app.post("/api/clippers/record-permission-status", async (req, res) => {
    try {
      const result = await recordClipperPermissionStatus(req.body || {}, getCurrentUserId(req));
      res.json({ permissionTracker: result.permissionTracker });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to record clippers permission status" });
    }
  });

  app.post("/api/clippers/prepare-drive-workspace", async (req, res) => {
    try {
      const result = await prepareClipperDriveWorkspace(getCurrentUserId(req));
      res.json({ driveWorkspace: result.driveWorkspace });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers Google Drive workspace" });
    }
  });

  app.post("/api/clippers/prepare-production-queue", async (req, res) => {
    try {
      const result = await prepareClipperProductionQueue(getCurrentUserId(req));
      res.json({ queue: result.queue });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers production queue" });
    }
  });

  app.post("/api/clippers/import-source-drop-files", async (req, res) => {
    try {
      const result = await importClipperSourceDropFiles(getCurrentUserId(req));
      res.json({ sourceDropImport: result.sourceDropImport });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to import clippers source drop files" });
    }
  });

  app.post("/api/clippers/prepare-source-acquisition", async (req, res) => {
    try {
      const result = await prepareClipperSourceAcquisitionPlan(getCurrentUserId(req));
      res.json({ sourceAcquisition: result.sourceAcquisition });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source acquisition plan" });
    }
  });

  app.post("/api/clippers/prepare-source-supply-drop-kit", async (req, res) => {
    try {
      const result = await prepareClipperSourceSupplyDropKit(getCurrentUserId(req));
      res.json({ sourceSupplyDropKit: result.sourceSupplyDropKit });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source supply drop kit" });
    }
  });

  app.post("/api/clippers/prepare-source-discovery-handoff", async (req, res) => {
    try {
      const result = await prepareClipperSourceDiscoveryHandoff(getCurrentUserId(req));
      res.json({ sourceDiscoveryHandoff: result.sourceDiscoveryHandoff, status: result.status });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source discovery handoff" });
    }
  });

  app.post("/api/clippers/prepare-source-scout", async (req, res) => {
    try {
      const result = await prepareClipperSourceScout(getCurrentUserId(req));
      res.json({
        sourceScout: result.sourceScout,
        trendCandidatesBatch: result.trendCandidatesBatch,
        metricoolExecutionQueue: result.metricoolExecutionQueue,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source scout" });
    }
  });

  app.post("/api/clippers/record-source-scout-intake", async (req, res) => {
    try {
      const result = await recordClipperSourceScoutIntake(req.body || {}, getCurrentUserId(req));
      res.json({
        sourceScoutIntake: result.sourceScoutIntake,
        trendCandidatesBatch: result.trendCandidatesBatch,
        sourceDropImport: result.sourceDropImport,
        metricoolExecutionQueue: result.metricoolExecutionQueue,
        status: result.status,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to record clippers source scout intake" });
    }
  });

  app.post("/api/clippers/prepare-source-scout-permission-pack", async (req, res) => {
    try {
      const result = await prepareClipperSourceScoutPermissionPack(getCurrentUserId(req));
      res.json({
        sourceScoutPermissionPack: result.sourceScoutPermissionPack,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source scout permission pack" });
    }
  });

  app.post("/api/clippers/prepare-source-scout-work-queue", async (req, res) => {
    try {
      const result = await prepareClipperSourceScoutWorkQueue(getCurrentUserId(req));
      res.json({
        sourceScoutWorkQueue: result.sourceScoutWorkQueue,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source scout work queue" });
    }
  });

  app.post("/api/clippers/prepare-source-scout-exact-url-kit", async (req, res) => {
    try {
      const result = await prepareClipperSourceScoutExactUrlKit(getCurrentUserId(req));
      res.json({
        sourceScoutExactUrlKit: result.sourceScoutExactUrlKit,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source scout exact URL kit" });
    }
  });

  app.post("/api/clippers/prepare-source-scout-daily-sprint", async (req, res) => {
    try {
      const result = await prepareClipperSourceScoutDailySprint(getCurrentUserId(req));
      res.json({
        sourceScoutDailySprint: result.sourceScoutDailySprint,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source scout daily sprint" });
    }
  });

  app.post("/api/clippers/prepare-source-scout-source-file-kit", async (req, res) => {
    try {
      const result = await prepareClipperSourceScoutSourceFileKit(getCurrentUserId(req));
      res.json({
        sourceScoutSourceFileKit: result.sourceScoutSourceFileKit,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source scout source file kit" });
    }
  });

  app.post("/api/clippers/prepare-rights-evidence-ledger", async (req, res) => {
    try {
      const result = await prepareClipperRightsEvidenceLedger(getCurrentUserId(req));
      res.json({
        rightsEvidenceLedger: result.rightsEvidenceLedger,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers rights evidence ledger" });
    }
  });

  app.post("/api/clippers/prepare-weekly-production-funnel", async (req, res) => {
    try {
      const result = await prepareClipperWeeklyProductionFunnel(getCurrentUserId(req));
      res.json({
        weeklyProductionFunnel: result.weeklyProductionFunnel,
        status: result.status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers weekly production funnel" });
    }
  });

  app.post("/api/clippers/prepare-source-ingestion-sprint", async (req, res) => {
    try {
      const result = await prepareClipperSourceIngestionSprint(getCurrentUserId(req));
      const sourceIngestionSprint = result.sourceIngestionSprint;
      res.json({
        sourceIngestionSprint: {
          ...sourceIngestionSprint,
          items: sourceIngestionSprint.items.slice(0, 6).map((item) => ({
            id: item.id,
            rank: item.rank,
            status: item.status,
            category: item.category,
            label: item.label,
            priority: item.priority,
            targetFileName: item.targetFileName,
            sourceDropPath: item.sourceDropPath,
            sourceDropManifestPath: item.sourceDropManifestPath,
            sourceDropReadmePath: item.sourceDropReadmePath,
            suggestedTitle: item.suggestedTitle,
            viralSearchQuery: item.viralSearchQuery,
            viralSearchUrl: item.viralSearchUrl,
            recencyWindow: item.recencyWindow,
            proofNeeded: item.proofNeeded.slice(0, 3),
            intakeBatchRow: "",
            rightsEvidenceBatchRow: "",
            blockers: item.blockers.slice(0, 3),
            doneCriteria: [],
            nextStep: item.nextStep,
          })),
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source ingestion sprint" });
    }
  });

  app.post("/api/clippers/prepare-source-hunt", async (req, res) => {
    try {
      const result = await prepareClipperSourceHuntSheet(req.body || {}, getCurrentUserId(req));
      res.json({ sourceHunt: result.sourceHunt });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers source hunt sheet" });
    }
  });

  app.post("/api/clippers/record-source-intake-batch", async (req, res) => {
    try {
      const result = await recordClipperSourceIntakeBatch(req.body || {}, getCurrentUserId(req));
      res.json({ sourceIntakeBatch: result.sourceIntakeBatch });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to record clippers source intake batch" });
    }
  });

  app.post("/api/clippers/prepare-viral-discovery", async (req, res) => {
    try {
      const result = await prepareClipperViralDiscoveryPack(req.body || {}, getCurrentUserId(req));
      res.json({ viralDiscovery: result.viralDiscovery });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers viral discovery pack" });
    }
  });

  app.post("/api/clippers/prepare-rights-outreach", async (req, res) => {
    try {
      const result = await prepareClipperRightsOutreachPack(getCurrentUserId(req));
      res.json({ rightsOutreach: result.rightsOutreach });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers rights outreach pack" });
    }
  });

  app.post("/api/clippers/record-source-rights", async (req, res) => {
    try {
      const result = await recordClipperSourceRights(req.body || {}, getCurrentUserId(req));
      res.json({ sourceRights: result.sourceRights, queue: result.queue });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to record clippers source rights" });
    }
  });

  app.post("/api/clippers/prepare-draft-specs", async (req, res) => {
    try {
      const result = await prepareClipperDraftSpecs(getCurrentUserId(req));
      res.json({ draftSpecs: result.draftSpecs });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers draft specs" });
    }
  });

  app.post("/api/clippers/render-draft-videos", async (req, res) => {
    try {
      const result = await renderClipperDraftVideos(req.body || {}, getCurrentUserId(req));
      res.json({ renderedClips: result.renderedClips });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to render clippers draft videos" });
    }
  });

  app.post("/api/clippers/prepare-publishing-package", async (req, res) => {
    try {
      const result = await prepareClipperPublishingPackage(getCurrentUserId(req));
      res.json({ publishingPackage: result.publishingPackage });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers publishing package" });
    }
  });

  app.post("/api/clippers/prepare-intake-kit", async (req, res) => {
    try {
      const result = await prepareClipperIntakeKit(getCurrentUserId(req));
      res.json({ intakeKit: result.intakeKit });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers intake kit" });
    }
  });

  app.post("/api/clippers/ingest-metrics", async (req, res) => {
    try {
      const result = await ingestClipperMetrics(getCurrentUserId(req));
      res.json({ metrics: result.metrics });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to ingest clippers metrics" });
    }
  });

  app.post("/api/clippers/prepare-analytics-reporting-pack", async (req, res) => {
    try {
      const result = await prepareClipperAnalyticsReportingPack(getCurrentUserId(req));
      res.json({ analyticsReportingPack: result.analyticsReportingPack });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers analytics reporting pack" });
    }
  });

  app.post("/api/clippers/ingest-trends", async (req, res) => {
    try {
      const result = await ingestClipperTrends(getCurrentUserId(req));
      res.json({ trendRadar: result.trendRadar, status: result.status });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to ingest clippers trends" });
    }
  });

  app.post("/api/clippers/record-trend-candidates-batch", async (req, res) => {
    try {
      const result = await recordClipperTrendCandidatesBatch(req.body || {}, getCurrentUserId(req));
      res.json({ trendCandidatesBatch: result.trendCandidatesBatch, status: result.status });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to record clippers trend candidates batch" });
    }
  });

  app.post("/api/clippers/prepare-trend-rights-outreach", async (req, res) => {
    try {
      const result = await prepareClipperTrendRightsOutreachPack(getCurrentUserId(req));
      res.json({ trendRightsOutreach: result.trendRightsOutreach });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers trend rights outreach pack" });
    }
  });

  app.post("/api/clippers/prepare-automation-schedule", async (req, res) => {
    try {
      const result = await prepareClipperAutomationSchedule(req.body || {}, getCurrentUserId(req));
      res.json({ automationSchedule: result.automationSchedule });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to prepare clippers automation schedule" });
    }
  });

  app.post("/api/clippers/run-automation-cycle", async (req, res) => {
    try {
      const result = await runClipperAutomationCycle(req.body || {}, getCurrentUserId(req));
      res.json({ automation: result.automation });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to run clippers automation cycle" });
    }
  });

  app.get("/api/clippers/oauth/:platform/start", async (req, res) => {
    try {
      const action = getClipperConnectAction(req.params.platform, req.query.accountId);
      if (!action.authUrl) {
        return res.status(400).json({
          error: "OAuth not ready",
          missingEnvVars: action.missingEnvVars,
          nextStep: action.nextStep,
        });
      }
      res.redirect(action.authUrl);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to start clippers OAuth" });
    }
  });

  app.get("/api/clippers/oauth/:platform/callback", async (req, res) => {
    try {
      if (req.query.preflight === "1") {
        if (req.params.platform !== "tiktok" && req.params.platform !== "instagram" && req.params.platform !== "youtube") {
          return res.status(400).send(`
            <html>
              <body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
                <h1>OAuth preflight no conectado</h1>
                <p>Plataforma no soportada.</p>
                <a href="/clippers" style="color:#67e8f9;">Volver a Clippers</a>
              </body>
            </html>
          `);
        }
        return res.status(200).send(`
          <html>
            <body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
              <h1>OAuth preflight listo</h1>
              <p>Callback reachable sin guardar OAuth state ni tokens.</p>
              <p style="color:#94a3b8;">Plataforma: ${escapeHtml(req.params.platform)}</p>
              <a href="/clippers" style="color:#67e8f9;">Volver a Clippers</a>
            </body>
          </html>
        `);
      }
      const connection = await recordClipperOAuthCallback({
        platform: req.params.platform,
        code: req.query.code,
        state: req.query.state,
        error: req.query.error,
      }, getCurrentUserId(req));
      const isError = connection.status === "error";
      res.status(isError ? 400 : 200).send(`
        <html>
          <body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
            <h1>${isError ? "OAuth no conectado" : "OAuth registrado"}</h1>
            <p>${escapeHtml(connection.note)}</p>
            ${connection.tokenNote ? `<p style="color:#fbbf24;">${escapeHtml(connection.tokenNote)}</p>` : ""}
            <p style="color:#94a3b8;">Plataforma: ${escapeHtml(connection.platform)}</p>
            <p style="color:#94a3b8;">Estado: ${escapeHtml(connection.status)}</p>
            ${connection.tokenStatus ? `<p style="color:#94a3b8;">Token: ${escapeHtml(connection.tokenStatus)}</p>` : ""}
            <a href="/clippers" style="color:#67e8f9;">Volver a Clippers</a>
          </body>
        </html>
      `);
    } catch (error: any) {
      res.status(400).send(`
        <html>
          <body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
            <h1>OAuth no conectado</h1>
            <p>${escapeHtml(error.message || "No se pudo registrar OAuth.")}</p>
            <a href="/clippers" style="color:#67e8f9;">Volver a Clippers</a>
          </body>
        </html>
      `);
    }
  });

  app.get("/api/clippers/reports/:id", async (req, res) => {
    try {
      const report = await readClipperReport(req.params.id, getCurrentUserId(req));
      if (!report) return res.status(404).json({ error: "Report not found" });
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to read clippers report" });
    }
  });

  // GET all DJ contacts
  app.get("/api/djs", async (req, res) => {
    try {
      const djs = await storage.getDjContacts(getCurrentUserId(req));
      res.json(djs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch DJs" });
    }
  });

  // POST create DJ contact
  app.post("/api/djs", async (req, res) => {
    try {
      const parsed = insertDjContactSchema.parse(req.body);
      const dj = await storage.createDjContact(getCurrentUserId(req), parsed);
      res.json(dj);
    } catch (error) {
      res.status(500).json({ error: "Failed to create DJ contact" });
    }
  });

  // PATCH update DJ contact
  app.patch("/api/djs/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getDjContact(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "DJ not found" });
      }
      const dj = await storage.updateDjContact(req.params.id, req.body);
      res.json(dj);
    } catch (error) {
      res.status(500).json({ error: "Failed to update DJ contact" });
    }
  });

  // DELETE DJ contact
  app.delete("/api/djs/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getDjContact(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "DJ not found" });
      }
      await storage.deleteDjContact(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete DJ contact" });
    }
  });

  // POST generate message for DJ
  app.post("/api/djs/:id/message", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const { eventDate, slot } = req.body;
      const dj = await storage.getDjContact(req.params.id);
      if (!dj || dj.userId !== userId) {
        return res.status(404).json({ error: "DJ not found" });
      }
      const message = await generateDjMessage(dj, eventDate, slot);
      res.json({ message });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate message" });
    }
  });

  // ==================== PORTFOLIO AGENT ====================

  // GET portfolio summary with real-time prices
  app.get("/api/portfolio/summary", async (req, res) => {
    try {
      const summary = await getPortfolioSummary(getCurrentUserId(req));
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to get portfolio summary" });
    }
  });

  // GET gains by period (week, month, year)
  app.get("/api/portfolio/gains/:period", async (req, res) => {
    try {
      const { period } = req.params;
      const gains = await getGainsByPeriod(period, getCurrentUserId(req));
      res.json(gains);
    } catch (error) {
      console.error("Error getting gains by period:", error);
      res.status(500).json({ error: "Failed to get gains by period" });
    }
  });

  // GET portfolio margin config
  app.get("/api/portfolio/margin", async (req, res) => {
    try {
      const config = await storage.getPortfolioConfig(getCurrentUserId(req));
      res.json(config || { marginUsed: "0", marginTotal: "0" });
    } catch (error) {
      res.status(500).json({ error: "Failed to get margin config" });
    }
  });

  // PUT update portfolio margin
  app.put("/api/portfolio/margin", async (req, res) => {
    try {
      const { marginUsed, marginTotal } = req.body;
      await storage.updatePortfolioConfig(
        getCurrentUserId(req),
        String(marginUsed || "0"),
        String(marginTotal || "0")
      );
      res.json({ success: true, marginUsed, marginTotal });
    } catch (error) {
      res.status(500).json({ error: "Failed to update margin config" });
    }
  });

  // GET rebalancing recommendations
  app.get("/api/portfolio/rebalance", async (req, res) => {
    try {
      const recommendations = await analyzeRebalancing(getCurrentUserId(req));
      res.json(recommendations);
    } catch (error) {
      res.status(500).json({ error: "Failed to analyze rebalancing" });
    }
  });

  // GET price opportunities from watchlist and alerts
  app.get("/api/portfolio/opportunities", async (req, res) => {
    try {
      const opportunities = await checkPriceOpportunities(getCurrentUserId(req));
      res.json(opportunities);
    } catch (error) {
      res.status(500).json({ error: "Failed to check opportunities" });
    }
  });

  // GET weekly portfolio report (preview)
  app.get("/api/portfolio/weekly-report", async (req, res) => {
    try {
      const report = await generateWeeklyReport(getCurrentUserId(req));
      res.json({ report });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // POST send weekly portfolio report via Telegram
  app.post("/api/portfolio/send-report", async (req, res) => {
    try {
      const result = await sendWeeklyPortfolioReport(getCurrentUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send report" });
    }
  });

  // ==================== TRUST & CONTROL ====================

  app.get("/api/audit-logs", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getAuditLogs(getCurrentUserId(req), limit);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  app.get("/api/pending-actions", async (req, res) => {
    try {
      const actions = await storage.getPendingActions(getCurrentUserId(req));
      res.json(actions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pending actions" });
    }
  });

  app.get("/api/pending-actions/:id", async (req, res) => {
    try {
      const action = await storage.getPendingAction(req.params.id);
      if (!action || action.userId !== getCurrentUserId(req)) {
        return res.status(404).json({ error: "Pending action not found" });
      }
      res.json(action);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pending action" });
    }
  });

  app.get("/api/pending-actions/:id/events", async (req, res) => {
    try {
      const action = await storage.getPendingAction(req.params.id);
      if (!action || action.userId !== getCurrentUserId(req)) {
        return res.status(404).json({ error: "Pending action not found" });
      }
      const events = await storage.getPendingActionEvents(action.id);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch pending action history" });
    }
  });

  app.get("/api/approval-history", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const history = await storage.getApprovalHistory(getCurrentUserId(req), limit);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch approval history" });
    }
  });

  app.patch("/api/pending-actions/:id/edit", async (req, res) => {
    try {
      const action = await storage.getPendingAction(req.params.id);
      const userId = getCurrentUserId(req);
      if (!action || action.userId !== userId) {
        return res.status(404).json({ error: "Pending action not found" });
      }
      const canEditRadioDjName = action.actionType === "radio_edit.resolve_dj_name" && action.status === "failed";
      if (!["pending", "edited", "snoozed"].includes(action.status) && !canEditRadioDjName) {
        return res.status(400).json({ error: "Only pending actions can be edited" });
      }
      const updated = await storage.updatePendingAction(action.id, {
        status: "edited",
        editedInput: req.body.editedInput,
      });
      await storage.createPendingActionEvent({
        pendingActionId: action.id,
        userId,
        actorType: "user",
        actorId: userId,
        eventType: "edited",
        previousStatus: action.status,
        nextStatus: "edited",
        note: req.body.note || null,
        metadata: { editedInput: req.body.editedInput },
      });
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "pending_action.edit",
        resourceType: "pending_action",
        resourceId: action.id,
        pendingActionId: action.id,
        metadata: { editedInput: req.body.editedInput },
        status: "succeeded",
        executionMode: "user_requested",
      });
      if (action.actionType === "radio_edit.resolve_dj_name" && req.body.editedInput?.djName) {
        const approved = await storage.updatePendingAction(action.id, {
          status: "approved",
          approvedBy: userId,
          approvedAt: new Date(),
          approvalReason: "Nombre del DJ recibido en la app",
        });
        await storage.createPendingActionEvent({
          pendingActionId: action.id,
          userId,
          actorType: "user",
          actorId: userId,
          eventType: "approved",
          previousStatus: "edited",
          nextStatus: "approved",
          note: "Nombre del DJ recibido en la app",
          metadata: { editedInput: req.body.editedInput },
        });
        const result = await executeApprovedPendingAction(approved, userId);
        return res.json({ ...approved, executionResult: result });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to edit pending action" });
    }
  });

  app.post("/api/pending-actions/:id/approve", async (req, res) => {
    try {
      const action = await storage.getPendingAction(req.params.id);
      const userId = getCurrentUserId(req);
      if (!action || action.userId !== userId) {
        return res.status(404).json({ error: "Pending action not found" });
      }
      if (!["pending", "edited", "snoozed"].includes(action.status)) {
        return res.status(400).json({ error: "Only pending actions can be approved" });
      }
      const updated = await storage.updatePendingAction(action.id, {
        status: "approved",
        approvedBy: userId,
        approvedAt: new Date(),
        approvalReason: req.body.reason || null,
      });
      await storage.createPendingActionEvent({
        pendingActionId: action.id,
        userId,
        actorType: "user",
        actorId: userId,
        eventType: "approved",
        previousStatus: action.status,
        nextStatus: "approved",
        note: req.body.reason || null,
        metadata: null,
      });
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "pending_action.approve",
        resourceType: "pending_action",
        resourceId: action.id,
        pendingActionId: action.id,
        metadata: { reason: req.body.reason || null },
        status: "succeeded",
        executionMode: "user_requested",
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to approve pending action" });
    }
  });

  app.post("/api/pending-actions/:id/reject", async (req, res) => {
    try {
      const action = await storage.getPendingAction(req.params.id);
      const userId = getCurrentUserId(req);
      if (!action || action.userId !== userId) {
        return res.status(404).json({ error: "Pending action not found" });
      }
      const updated = await storage.updatePendingAction(action.id, {
        status: "rejected",
        rejectionReason: req.body.reason || null,
      });
      await storage.createPendingActionEvent({
        pendingActionId: action.id,
        userId,
        actorType: "user",
        actorId: userId,
        eventType: "rejected",
        previousStatus: action.status,
        nextStatus: "rejected",
        note: req.body.reason || null,
        metadata: null,
      });
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "pending_action.reject",
        resourceType: "pending_action",
        resourceId: action.id,
        pendingActionId: action.id,
        metadata: { reason: req.body.reason || null },
        status: "succeeded",
        executionMode: "user_requested",
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to reject pending action" });
    }
  });

  app.post("/api/pending-actions/:id/snooze", async (req, res) => {
    try {
      const action = await storage.getPendingAction(req.params.id);
      const userId = getCurrentUserId(req);
      if (!action || action.userId !== userId) {
        return res.status(404).json({ error: "Pending action not found" });
      }
      const snoozedUntil = req.body.snoozedUntil ? new Date(req.body.snoozedUntil) : new Date(Date.now() + 60 * 60 * 1000);
      const updated = await storage.updatePendingAction(action.id, {
        status: "snoozed",
        snoozedUntil,
      });
      await storage.createPendingActionEvent({
        pendingActionId: action.id,
        userId,
        actorType: "user",
        actorId: userId,
        eventType: "snoozed",
        previousStatus: action.status,
        nextStatus: "snoozed",
        note: req.body.reason || null,
        metadata: { snoozedUntil },
      });
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "pending_action.snooze",
        resourceType: "pending_action",
        resourceId: action.id,
        pendingActionId: action.id,
        metadata: { snoozedUntil },
        status: "succeeded",
        executionMode: "user_requested",
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to snooze pending action" });
    }
  });

  app.post("/api/pending-actions/:id/cancel", async (req, res) => {
    try {
      const action = await storage.getPendingAction(req.params.id);
      const userId = getCurrentUserId(req);
      if (!action || action.userId !== userId) {
        return res.status(404).json({ error: "Pending action not found" });
      }
      if (["executing", "executed", "completed", "failed", "cancelled"].includes(action.status)) {
        return res.status(400).json({ error: "This action can no longer be cancelled" });
      }
      const updated = await storage.updatePendingAction(action.id, {
        status: "cancelled",
        rejectionReason: req.body.reason || null,
      });
      await storage.createPendingActionEvent({
        pendingActionId: action.id,
        userId,
        actorType: "user",
        actorId: userId,
        eventType: "cancelled",
        previousStatus: action.status,
        nextStatus: "cancelled",
        note: req.body.reason || null,
        metadata: null,
      });
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "pending_action.cancel",
        resourceType: "pending_action",
        resourceId: action.id,
        pendingActionId: action.id,
        metadata: { reason: req.body.reason || null },
        status: "succeeded",
        executionMode: "user_requested",
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to cancel pending action" });
    }
  });

  app.post("/api/pending-actions/:id/execute", async (req, res) => {
    try {
      const action = await storage.getPendingAction(req.params.id);
      const userId = getCurrentUserId(req);
      if (!action || action.userId !== userId) {
        return res.status(404).json({ error: "Pending action not found" });
      }
      const result = await executeApprovedPendingAction(action, userId);
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to execute pending action" });
    }
  });

  app.get("/api/assistant/permissions", async (req, res) => {
    try {
      const permissions = await storage.getAssistantPermissions(getCurrentUserId(req));
      res.json(permissions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch assistant permissions" });
    }
  });

  app.patch("/api/assistant/permissions/:scope", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const permission = await storage.upsertAssistantPermission(userId, {
        scope: req.params.scope,
        permissionLevel: req.body.permissionLevel,
        riskLimit: req.body.riskLimit || "medium",
        enabled: req.body.enabled ?? true,
      });
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "permission.update",
        resourceType: "assistant_permission",
        resourceId: permission.id,
        metadata: permission,
        status: "succeeded",
        executionMode: "user_requested",
      });
      res.json(permission);
    } catch (error) {
      res.status(500).json({ error: "Failed to update assistant permission" });
    }
  });

  // ==================== AUTOMATION MANAGER ====================

  app.get("/api/automations", async (req, res) => {
    try {
      const automations = await getExistingAutomations(getCurrentUserId(req));
      res.json(automations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch automations" });
    }
  });

  app.get("/api/automations/:id", async (req, res) => {
    try {
      const automation = await storage.getAutomationDefinition(req.params.id);
      if (!automation || automation.ownerUserId !== getCurrentUserId(req)) {
        return res.status(404).json({ error: "Automation not found" });
      }
      res.json(automation);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch automation" });
    }
  });

  app.post("/api/automations", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const validated = insertAutomationDefinitionSchema.parse(req.body);
      const automation = await storage.createAutomationDefinition(userId, validated);
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "automation.create",
        resourceType: "automation",
        resourceId: automation.id,
        metadata: automation,
        status: "succeeded",
        executionMode: "user_requested",
      });
      res.status(201).json(automation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create automation" });
    }
  });

  app.patch("/api/automations/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const automation = await storage.getAutomationDefinition(req.params.id);
      if (!automation || automation.ownerUserId !== userId) {
        return res.status(404).json({ error: "Automation not found" });
      }
      const updated = await storage.updateAutomationDefinition(automation.id, req.body);
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "automation.update",
        resourceType: "automation",
        resourceId: automation.id,
        metadata: { before: automation, after: updated },
        status: "succeeded",
        executionMode: "user_requested",
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update automation" });
    }
  });

  app.post("/api/automations/:id/pause", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const automation = await storage.getAutomationDefinition(req.params.id);
      if (!automation || automation.ownerUserId !== userId) {
        return res.status(404).json({ error: "Automation not found" });
      }
      const updated = await storage.updateAutomationDefinition(automation.id, { status: "paused" });
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "automation.pause",
        resourceType: "automation",
        resourceId: automation.id,
        metadata: { previousStatus: automation.status },
        status: "succeeded",
        executionMode: "user_requested",
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to pause automation" });
    }
  });

  app.post("/api/automations/:id/resume", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const automation = await storage.getAutomationDefinition(req.params.id);
      if (!automation || automation.ownerUserId !== userId) {
        return res.status(404).json({ error: "Automation not found" });
      }
      const updated = await storage.updateAutomationDefinition(automation.id, { status: "active" });
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "automation.resume",
        resourceType: "automation",
        resourceId: automation.id,
        metadata: { previousStatus: automation.status },
        status: "succeeded",
        executionMode: "user_requested",
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to resume automation" });
    }
  });

  app.post("/api/automations/:id/run", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const automation = await storage.getAutomationDefinition(req.params.id);
      if (!automation || automation.ownerUserId !== userId) {
        return res.status(404).json({ error: "Automation not found" });
      }
      const run = await recordManualAutomationRun(automation, userId);
      res.status(201).json(run);
    } catch (error) {
      res.status(500).json({ error: "Failed to trigger automation" });
    }
  });

  app.get("/api/automations/:id/runs", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const automation = await storage.getAutomationDefinition(req.params.id);
      if (!automation || automation.ownerUserId !== userId) {
        return res.status(404).json({ error: "Automation not found" });
      }
      const limit = parseInt(req.query.limit as string) || 50;
      const runs = await storage.getAutomationRuns(userId, automation.id, limit);
      res.json(runs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch automation runs" });
    }
  });

  app.get("/api/automation-runs", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const runs = await storage.getAutomationRuns(getCurrentUserId(req), undefined, limit);
      res.json(runs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch automation runs" });
    }
  });

  app.get("/api/automation-manager/summary", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const automations = await getExistingAutomations(userId);
      const runs = await storage.getAutomationRuns(userId, undefined, 25);
      const active = automations.filter((automation) => automation.status === "active");
      const paused = automations.filter((automation) => automation.status === "paused");
      const failed = automations.filter((automation) => automation.status === "failed");
      const pendingApproval = runs.filter((run) => run.status === "pending_approval");
      res.json({
        totals: automations.length,
        active: active.length,
        paused: paused.length,
        failed: failed.length,
        pendingApproval: pendingApproval.length,
        estimatedDailyCost: automations.reduce((sum, automation) => sum + (Number(automation.costEstimate) || 0), 0),
        recentRuns: runs.slice(0, 10),
        failureAlerts: [
          ...failed.map((automation) => ({ type: "definition", automation })),
          ...runs.filter((run) => run.status === "failed").slice(0, 5).map((run) => ({ type: "run", run })),
        ],
        nextRuns: automations
          .filter((automation) => automation.nextRunAt)
          .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())
          .slice(0, 10),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch automation summary" });
    }
  });

  // ==================== MARKETING COMMAND CENTER ====================

  registerMarketingLearningRoutes(app);

  // ==================== DROPSHIPPING CEO ====================

  app.get("/api/dropshipping-ceo", async (_req, res) => {
    try {
      res.json(getDropshippingCeoSnapshot());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dropshipping CEO snapshot" });
    }
  });

  app.get("/api/dropshipping-ceo/live-signal-readiness", async (_req, res) => {
    try {
      res.json(getDropshippingLiveSignalReadiness());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dropshipping live signal readiness" });
    }
  });

  app.post("/api/dropshipping-ceo/product-research", async (req, res) => {
    try {
      const input = dropshippingProductResearchSchema.parse(req.body);
      res.json(researchDropshippingProduct(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to research dropshipping product" });
    }
  });

  app.post("/api/dropshipping-ceo/product-scout-candidate", async (req, res) => {
    try {
      const input = dropshippingProductScoutCandidateSchema.parse(req.body);
      res.json(createDropshippingProductScoutCandidate(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create dropshipping product scout candidate" });
    }
  });

  app.post("/api/dropshipping-ceo/product-scout-batch", async (req, res) => {
    try {
      const input = dropshippingProductScoutBatchSchema.parse(req.body || {});
      res.json(runDropshippingProductScoutBatch(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to run dropshipping product scout batch" });
    }
  });

  app.post("/api/dropshipping-ceo/product-scout-promote", async (req, res) => {
    try {
      const input = dropshippingProductScoutPromotionSchema.parse(req.body || {});
      res.json(promoteDropshippingScoutCandidate(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to promote dropshipping product scout candidate" });
    }
  });

  app.post("/api/dropshipping-ceo/autopilot-product-hunter", async (req, res) => {
    try {
      const input = dropshippingAutopilotProductHunterSchema.parse(req.body || {});
      res.json(runDropshippingAutopilotProductHunter(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to run dropshipping autopilot product hunter" });
    }
  });

  app.post("/api/dropshipping-ceo/supplier-review", async (req, res) => {
    try {
      const input = dropshippingSupplierReviewSchema.parse(req.body);
      res.json(reviewDropshippingSupplier(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to review dropshipping supplier" });
    }
  });

  app.post("/api/dropshipping-ceo/launch-plan", async (req, res) => {
    try {
      const input = dropshippingLaunchPlanSchema.parse(req.body);
      res.json(buildDropshippingLaunchPlan(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build dropshipping launch plan" });
    }
  });

  app.post("/api/dropshipping-ceo/launch-pack", async (req, res) => {
    try {
      const input = dropshippingLaunchPackSchema.parse(req.body || {});
      res.json(buildDropshippingLaunchPack(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build dropshipping launch pack" });
    }
  });

  app.post("/api/dropshipping-ceo/launch-pack-approval-preview", async (req, res) => {
    try {
      const input = dropshippingLaunchPackApprovalQueueSchema.parse(req.body || {});
      res.json(prepareDropshippingLaunchPackApprovalQueue(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to preview dropshipping launch pack approvals" });
    }
  });

  app.post("/api/dropshipping-ceo/launch-pack-approvals", async (req, res) => {
    try {
      const input = dropshippingLaunchPackApprovalQueueSchema.parse(req.body || {});
      const prepared = prepareDropshippingLaunchPackApprovalQueue(input);
      try {
        const pendingActions = await Promise.all(prepared.requests.map((request) => createPendingActionForApproval({
          userId: getCurrentUserId(req),
          actorType: "assistant",
          actorId: "dropshipping-ceo",
          origin: "web",
          executionMode: "user_requested",
          actionType: request.actionType,
          resourceType: request.resourceType,
          resourceId: request.resourceId,
          title: request.title,
          description: request.description,
          input: request.input,
          proposedChanges: request.proposedChanges,
          metadata: { source: "dropshipping-ceo", launchPackId: request.resourceId },
          scope: "ecommerce",
        })));
        res.status(201).json({ prepared, pendingActions, fallback: false, snapshot: getDropshippingCeoSnapshot() });
      } catch (approvalError) {
        const localOutbox = recordDropshippingApprovalOutboxRequests(
          prepared.requests,
          approvalError instanceof Error ? approvalError.message : "Trust Center approval queue unavailable.",
        );
        res.status(202).json({
          prepared,
          pendingActions: [],
          fallback: true,
          localOutbox,
          snapshot: getDropshippingCeoSnapshot(),
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to queue dropshipping launch pack approvals" });
    }
  });

  app.post("/api/dropshipping-ceo/approval-outbox-migration", async (req, res) => {
    try {
      const input = dropshippingApprovalOutboxMigrationSchema.parse(req.body || {});
      const prepared = prepareDropshippingApprovalOutboxMigration(input);

      if (input.dryRun || prepared.items.length === 0) {
        return res.json({
          dryRun: true,
          prepared,
          migrated: [],
          failed: [],
          marked: null,
          snapshot: getDropshippingCeoSnapshot(),
        });
      }

      const migrated: Array<{ id: string; pendingActionId: string; title: string; actionType: string }> = [];
      const failed: Array<{ id: string; title: string; actionType: string; error: string }> = [];

      for (const item of prepared.items) {
        try {
          const pendingAction = await createPendingActionForApproval({
            userId: getCurrentUserId(req),
            actorType: "assistant",
            actorId: "dropshipping-ceo",
            origin: "web",
            executionMode: "user_requested",
            actionType: item.actionType,
            resourceType: item.resourceType,
            resourceId: item.resourceId,
            title: item.title,
            description: item.description,
            input: item.input,
            proposedChanges: item.proposedChanges,
            metadata: {
              source: "dropshipping-ceo-local-outbox",
              approvalOutboxId: item.id,
              originalSource: item.source,
            },
            scope: "ecommerce",
          });
          migrated.push({ id: item.id, pendingActionId: String(pendingAction.id), title: item.title, actionType: item.actionType });
        } catch (migrationError) {
          const nestedErrors = Array.isArray((migrationError as { errors?: unknown[] })?.errors)
            ? ((migrationError as { errors: Array<Error & { code?: string }> }).errors)
              .map((error) => error.message || error.code || "")
              .filter(Boolean)
              .join("; ")
            : "";
          const errorMessage = migrationError instanceof Error
            ? migrationError.message || nestedErrors || (migrationError as Error & { code?: string; cause?: { message?: string } }).cause?.message || (migrationError as Error & { code?: string }).code || "Failed to create Trust Center pending action."
            : String(migrationError || "Failed to create Trust Center pending action.");
          failed.push({
            id: item.id,
            title: item.title,
            actionType: item.actionType,
            error: errorMessage,
          });
        }
      }

      const marked = migrated.length
        ? markDropshippingApprovalOutboxQueued(migrated.map((item) => ({ id: item.id, pendingActionId: item.pendingActionId })))
        : null;

      res.status(failed.length ? 207 : 200).json({
        dryRun: false,
        prepared,
        migrated,
        failed,
        marked,
        snapshot: getDropshippingCeoSnapshot(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to migrate dropshipping approval outbox" });
    }
  });

  app.post("/api/dropshipping-ceo/ledger", async (req, res) => {
    try {
      const input = dropshippingLedgerEntrySchema.parse(req.body);
      res.json(recordDropshippingLedgerEntry(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record dropshipping ledger entry" });
    }
  });

  app.post("/api/dropshipping-ceo/approval-decisions", async (req, res) => {
    try {
      const input = dropshippingApprovalDecisionSchema.parse(req.body);
      res.json(recordDropshippingApprovalDecision(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record dropshipping approval decision" });
    }
  });

  app.post("/api/dropshipping-ceo/learning-review", async (req, res) => {
    try {
      const input = dropshippingLearningReviewSchema.parse(req.body);
      res.json(recordDropshippingLearningReview(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record dropshipping learning review" });
    }
  });

  app.post("/api/dropshipping-ceo/marketing-campaign", async (req, res) => {
    try {
      const input = dropshippingMarketingCampaignSchema.parse(req.body);
      res.json(buildDropshippingMarketingCampaign(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build dropshipping marketing campaign" });
    }
  });

  app.post("/api/dropshipping-ceo/social-post-batch", async (req, res) => {
    try {
      const input = dropshippingSocialPostBatchSchema.parse(req.body);
      res.json(createDropshippingSocialPostBatch(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create dropshipping social posts" });
    }
  });

  app.post("/api/dropshipping-ceo/social-publish", async (req, res) => {
    try {
      const input = dropshippingSocialPublishSchema.parse(req.body);
      res.json(await publishDropshippingSocialPost(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to publish dropshipping social post" });
    }
  });

  app.post("/api/dropshipping-ceo/social-metrics", async (req, res) => {
    try {
      const input = dropshippingSocialMetricsSchema.parse(req.body);
      res.json(recordDropshippingSocialMetrics(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record dropshipping social metrics" });
    }
  });

  app.post("/api/dropshipping-ceo/social-analysis", async (req, res) => {
    try {
      const input = dropshippingSocialAnalysisSchema.parse(req.body || {});
      res.json(analyzeDropshippingSocialPerformance(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to analyze dropshipping social performance" });
    }
  });

  app.post("/api/dropshipping-ceo/order", async (req, res) => {
    try {
      const input = dropshippingOrderSchema.parse(req.body);
      res.json(recordDropshippingOrder(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record dropshipping order" });
    }
  });

  app.post("/api/dropshipping-ceo/fulfillment", async (req, res) => {
    try {
      const input = dropshippingFulfillmentSchema.parse(req.body);
      res.json(prepareDropshippingFulfillment(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to prepare dropshipping fulfillment" });
    }
  });

  app.post("/api/dropshipping-ceo/capital-plan", async (req, res) => {
    try {
      const input = dropshippingCapitalPlanSchema.parse(req.body || {});
      res.json(buildDropshippingCapitalPlan(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build dropshipping capital plan" });
    }
  });

  app.post("/api/dropshipping-ceo/growth-sprint", async (req, res) => {
    try {
      const input = dropshippingGrowthSprintSchema.parse(req.body || {});
      res.json(buildDropshippingGrowthSprint(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build dropshipping growth sprint" });
    }
  });

  app.get("/api/dropshipping-ceo/execution-setup", async (_req, res) => {
    try {
      res.json(getDropshippingExecutionSetup());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dropshipping execution setup" });
    }
  });

  app.get("/api/dropshipping-ceo/launch-readiness", async (_req, res) => {
    try {
      res.json(getDropshippingLaunchReadiness());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dropshipping launch readiness" });
    }
  });

  app.post("/api/dropshipping-ceo/run-cycle", async (req, res) => {
    try {
      const input = dropshippingCeoCycleSchema.parse(req.body || {});
      res.json(runDropshippingCeoCycle(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to run dropshipping CEO cycle" });
    }
  });

  app.post("/api/dropshipping-ceo/operating-cycle", async (req, res) => {
    try {
      const input = dropshippingCeoCycleSchema.partial().parse(req.body || {});
      res.json(runDropshippingDailyOperatingCycle(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to run dropshipping CEO operating cycle" });
    }
  });

  app.post("/api/dropshipping-ceo/shopify-preflight", async (req, res) => {
    try {
      const input = dropshippingShopifyDraftSchema.parse(req.body);
      res.json(preflightDropshippingShopifyDraft(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to preflight Shopify draft" });
    }
  });

  app.post("/api/dropshipping-ceo/shopify-draft", async (req, res) => {
    try {
      const input = dropshippingShopifyDraftSchema.parse(req.body);
      res.json(await createDropshippingShopifyDraft(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create Shopify draft" });
    }
  });

  app.get("/api/dropshipping-ceo/report-preview", async (req, res) => {
    try {
      const cadence = req.query.cadence === "evening" ? "evening" : "morning";
      res.json({ cadence, message: buildDropshippingDailyReport(cadence), snapshot: getDropshippingCeoSnapshot() });
    } catch (error) {
      res.status(500).json({ error: "Failed to build dropshipping report preview" });
    }
  });

  app.post("/api/dropshipping-ceo/send-report", async (req, res) => {
    try {
      const cadence = req.body?.cadence === "evening" ? "evening" : "morning";
      res.json(await sendDropshippingDailyReport(getCurrentUserId(req), cadence));
    } catch (error) {
      res.status(500).json({ error: "Failed to send dropshipping report" });
    }
  });

  const dropshippingPendingApprovalSchema = z.object({
    actionType: z.enum([
      "dropshipping.spend",
      "dropshipping.publish_product",
      "dropshipping.create_shopify_draft",
      "dropshipping.publish_social",
      "dropshipping.contact_supplier",
      "dropshipping.fulfill_order",
      "dropshipping.order_sample",
    ]),
    resourceType: z.string().trim().min(2).max(120).default("dropshipping"),
    resourceId: z.string().trim().max(200).optional(),
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().min(2).max(1200),
    input: z.unknown().optional(),
    proposedChanges: z.unknown().optional(),
  });

  app.post("/api/dropshipping-ceo/pending-approval", async (req, res) => {
    try {
      const input = dropshippingPendingApprovalSchema.parse(req.body);
      const pendingAction = await createPendingActionForApproval({
        userId: getCurrentUserId(req),
        actorType: "assistant",
        actorId: "dropshipping-ceo",
        origin: "web",
        executionMode: "user_requested",
        actionType: input.actionType,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        title: input.title,
        description: input.description,
        input: input.input,
        proposedChanges: input.proposedChanges,
        metadata: { source: "dropshipping-ceo" },
        scope: "ecommerce",
      });
      res.status(201).json({ pendingAction, snapshot: getDropshippingCeoSnapshot() });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create dropshipping pending approval" });
    }
  });

  // ==================== REVENUE ENGINE ====================

  app.use("/api/revenue-engine", (req, res, next) => {
    let releaseRoute: () => void = () => {};
    const previousRoute = revenueEngineRouteQueue;
    revenueEngineRouteQueue = new Promise<void>((resolve) => {
      releaseRoute = resolve;
    });
    previousRoute.then(async () => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releaseRoute();
      };
      res.once("finish", release);
      res.once("close", release);
      await prepareRevenueEngineState(getCurrentUserId(req));
      if (res.destroyed) {
        release();
        return;
      }
      const originalJson = res.json.bind(res);
      let responseQueued = false;
      res.json = ((body: unknown) => {
        if (responseQueued) return res;
        responseQueued = true;
        void flushRevenueEnginePersistence()
          .then(() => originalJson(body))
          .catch((error) => {
            res.json = originalJson as typeof res.json;
            next(error);
          });
        return res;
      }) as typeof res.json;
      return next();
    }).catch(next);
  });

  app.get("/api/revenue-engine", async (_req, res) => {
    try {
      res.json(getRevenueEngineSnapshot());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch revenue engine snapshot" });
    }
  });

  app.post("/api/revenue-engine/plan", async (req, res) => {
    try {
      const input = revenueEnginePlanSchema.parse(req.body);
      res.json(buildRevenueEnginePlan(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build revenue engine plan" });
    }
  });

  app.post("/api/revenue-engine/scouting-mission", async (req, res) => {
    try {
      const input = revenueScoutingMissionSchema.parse(req.body);
      res.json(recordRevenueScoutingMission(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build revenue scouting mission" });
    }
  });

  app.post("/api/revenue-engine/daily-scout-sprint", async (req, res) => {
    try {
      const input = revenueDailyScoutSprintSchema.parse(req.body);
      res.json(runRevenueDailyScoutSprint(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to start revenue daily scout sprint" });
    }
  });

  app.post("/api/revenue-engine/scout-dispatch", async (req, res) => {
    try {
      const input = revenueDailyScoutSprintSchema.parse(req.body);
      res.json(runRevenueScoutDispatch(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to dispatch revenue scout sprint" });
    }
  });

  app.post("/api/revenue-engine/daily-scout-sprint/submit", async (req, res) => {
    try {
      const input = revenueDailyScoutSprintSubmitSchema.parse(req.body);
      const result = submitRevenueDailyScoutSprintEvidence(input);
      if (result.status === "not_found") return res.status(404).json(result);
      if (result.status === "blocked") return res.status(422).json(result);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to submit revenue daily scout sprint evidence" });
    }
  });

  app.post("/api/revenue-engine/lead-radar", async (req, res) => {
    try {
      const input = revenueLeadRadarSchema.parse(req.body);
      res.json(buildRevenueLeadRadar(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build revenue lead radar" });
    }
  });

  app.post("/api/revenue-engine/money-sprint", async (req, res) => {
    try {
      const input = revenueMoneySprintSchema.parse(req.body);
      res.json(runRevenueMoneySprint(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to run revenue money sprint" });
    }
  });

  app.post("/api/revenue-engine/money-sprint-preview", async (req, res) => {
    try {
      const input = revenueMoneySprintSchema.parse(req.body);
      res.json(previewRevenueMoneySprintSeeds(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to preview revenue money sprint" });
    }
  });

  app.post("/api/revenue-engine/money-sprint/public-candidates", async (req, res) => {
    try {
      const input = revenueMoneySprintFromPublicCandidatesSchema.parse(req.body);
      res.json(runRevenueMoneySprintFromPublicCandidates(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to run revenue money sprint from public candidates" });
    }
  });

  app.post("/api/revenue-engine/public-lead-candidates", async (req, res) => {
    try {
      const input = revenuePublicLeadCandidateSchema.parse(req.body);
      res.json(recordRevenuePublicLeadCandidate(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record revenue public lead candidate" });
    }
  });

  app.post("/api/revenue-engine/public-lead-candidates/approve", async (req, res) => {
    try {
      const input = revenuePublicLeadCandidateApproveSchema.parse(req.body);
      const result = approveRevenuePublicLeadCandidate(input);
      if (result.status === "not_found") return res.status(404).json(result);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to approve revenue public lead candidate" });
    }
  });

  app.post("/api/revenue-engine/public-lead-candidates/batch", async (req, res) => {
    try {
      const input = revenuePublicLeadCandidateBatchSchema.parse(req.body);
      res.json(recordRevenuePublicLeadCandidateBatch(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record revenue public lead candidate batch" });
    }
  });

  app.post("/api/revenue-engine/public-scout-evidence", async (req, res) => {
    try {
      const input = revenuePublicScoutEvidenceSchema.parse(req.body);
      res.json(recordRevenuePublicScoutEvidence(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to normalize revenue public scout evidence" });
    }
  });

  app.post("/api/revenue-engine/public-scout-connector-intake", async (req, res) => {
    try {
      const input = revenueVerifiedScoutConnectorSchema.parse(req.body);
      res.json(recordRevenueVerifiedScoutConnectorResults(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record revenue public scout connector intake" });
    }
  });

  app.post("/api/revenue-engine/public-scout-agent-command", async (req, res) => {
    try {
      const input = revenuePublicScoutAgentCommandSchema.parse(req.body);
      res.json(runRevenuePublicScoutAgentCommand(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to run revenue public scout agent command" });
    }
  });

  app.post("/api/revenue-engine/launch-readiness", async (req, res) => {
    try {
      const input = revenueLaunchReadinessSchema.parse(req.body);
      res.json(buildRevenueLaunchReadiness(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build revenue launch readiness" });
    }
  });

  app.post("/api/revenue-engine/automation-quote", async (req, res) => {
    try {
      const input = automationQuoteSchema.parse(req.body);
      res.json(buildAutomationQuote(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build automation quote" });
    }
  });

  app.post("/api/revenue-engine/automation-intakes", async (req, res) => {
    try {
      const input = revenueAutomationIntakeSchema.parse(req.body);
      res.json(recordRevenueAutomationIntake(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record automation intake" });
    }
  });

  app.post("/api/revenue-engine/automation-intakes/answer", async (req, res) => {
    try {
      const input = revenueAutomationIntakeAnswerSchema.parse(req.body);
      res.json(answerRevenueAutomationIntake(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to answer automation intake" });
    }
  });

  app.post("/api/revenue-engine/automation-intakes/convert", async (req, res) => {
    try {
      const input = revenueAutomationIntakeConvertSchema.parse(req.body);
      res.json(convertRevenueAutomationIntakeToOpportunity(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to convert automation intake" });
    }
  });

  app.post("/api/revenue-engine/automation-agent-command", async (req, res) => {
    try {
      const input = revenueAutomationAgentCommandSchema.parse(req.body);
      res.json(runRevenueAutomationAgentCommand(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to run revenue automation agent command" });
    }
  });

  app.post("/api/revenue-engine/automation-opportunities", async (req, res) => {
    try {
      const input = revenueAutomationOpportunitySchema.parse(req.body);
      res.json(recordRevenueAutomationOpportunity(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record automation opportunity" });
    }
  });

  app.post("/api/revenue-engine/automation-opportunities/delivery-workspace", async (req, res) => {
    try {
      const input = revenueAutomationOpportunityDeliverySchema.parse(req.body);
      res.json(createDeliveryWorkspaceFromAutomationOpportunity(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create delivery workspace from automation opportunity" });
    }
  });

  app.post("/api/revenue-engine/automation-opportunities/close", async (req, res) => {
    try {
      const input = revenueAutomationOpportunityCloseSchema.parse(req.body);
      res.json(closeRevenueAutomationOpportunity(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to close automation opportunity" });
    }
  });

  app.post("/api/revenue-engine/delivery-review", async (req, res) => {
    try {
      const input = deliveryReviewSchema.parse(req.body);
      res.json(buildDeliveryReview(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build delivery review" });
    }
  });

  app.post("/api/revenue-engine/delivery-workspaces", async (req, res) => {
    try {
      const input = revenueDeliveryWorkspaceSchema.parse(req.body);
      if (input.projectType !== "automation") {
        return res.status(422).json({
          status: "blocked",
          reason: "Website/bundle delivery debe crearse desde /api/revenue-engine/website-delivery-workspace con oportunidad vendida y deposito manual registrado.",
        });
      }
      res.json(recordRevenueDeliveryWorkspace({
        ...input,
        githubIssueUrl: "",
        prUrl: "",
        secondReviewStatus: "pending",
        appQaStatus: "pending",
        deploymentApprovalStatus: "not_requested",
        deploymentApprovalUrl: "",
      }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record delivery workspace" });
    }
  });

  app.post("/api/revenue-engine/website-delivery-workspace", async (req, res) => {
    try {
      const input = revenueWebsiteDeliveryWorkspaceSchema.parse(req.body);
      res.json(createWebsiteDeliveryWorkspaceFromLead(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create website delivery workspace" });
    }
  });

  app.post("/api/revenue-engine/website-opportunities", async (req, res) => {
    try {
      const input = revenueWebsiteOpportunitySchema.parse(req.body);
      res.json(recordRevenueWebsiteOpportunity(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record website opportunity" });
    }
  });

  app.post("/api/revenue-engine/website-opportunities/close", async (req, res) => {
    try {
      const input = revenueWebsiteOpportunityCloseSchema.parse(req.body);
      res.json(closeRevenueWebsiteOpportunity(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to close website opportunity" });
    }
  });

  app.post("/api/revenue-engine/delivery-workspaces/github-handoff", async (req, res) => {
    const userId = getCurrentUserId(req);
    if (userId !== getSystemUserId()) {
      return res.status(403).json({
        error: "Revenue Engine GitHub handoffs are limited to the configured single-user owner while GitHub connectors are shared.",
      });
    }

    try {
      const input = revenueDeliveryWorkspaceGithubHandoffSchema.parse(req.body);
      const lookup = getRevenueDeliveryWorkspaceById(input.workspaceId);
      if (!lookup.workspace) {
        return res.status(404).json(lookup);
      }

      let workspace = lookup.workspace;
      if (workspace.input.projectType === "automation") {
        return res.status(422).json({
          status: "not_required",
          reason: "Automation-only workspace no requiere handoff GitHub de website.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      if (input.repoFullName && workspace.input.repoFullName && input.repoFullName !== workspace.input.repoFullName) {
        return res.status(409).json({
          status: "repo_mismatch",
          reason: "El repo enviado no coincide con el repo guardado en este workspace. Guarda el repo correcto en el workspace antes de crear el issue.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const repoFullName = workspace.input.repoFullName || workspace.codexBuildHandoff.repoFullName;
      if (!repoFullName) {
        return res.status(422).json({
          status: "needs_repo",
          reason: "Guarda el repo GitHub owner/repo en este workspace antes de crear el handoff.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      if (!workspace.input.publicDataVerified || workspace.projectPlan.decision.status !== "ready_to_build") {
        return res.status(422).json({
          status: "blocked",
          reason: "Verifica data publica y deja el project plan ready_to_build antes de crear el handoff GitHub.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const saleGate = getRevenueWebsiteWorkspaceSaleGate(workspace.id);
      if (!saleGate.passed) {
        return res.status(422).json({
          status: "blocked",
          reason: saleGate.reason,
          blockers: saleGate.blockers,
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      if (workspace.input.githubIssueUrl) {
        return res.json({
          status: "already_created",
          reason: "Este workspace ya tiene GitHub handoff issue registrado.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const branchName = input.branchName || workspace.input.branchName || workspace.codexBuildHandoff.branchName;
      if (!isRevenueCodexBranchName(branchName)) {
        return res.status(422).json({
          status: "blocked",
          reason: "Branch codex/... requerido antes de crear GitHub handoff PR-first.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }
      if (branchName !== workspace.codexBuildHandoff.branchName || branchName !== workspace.input.branchName) {
        const refreshed = updateRevenueDeliveryWorkspaceQa({
          workspaceId: workspace.id,
          repoFullName,
          branchName,
        });
        if (!refreshed.workspace) return res.status(404).json(refreshed);
        workspace = refreshed.workspace;
      }
      const developerHandoff = await createDeveloperAutopilotHandoffFromRequest(userId, {
        source: "manual",
        repoFullName,
        appName: "Revenue client build",
        kind: "client_build",
        title: workspace.codexBuildHandoff.githubIssueTitle,
        description: workspace.codexBuildHandoff.copyableGithubIssueBody,
        severity: "medium",
        evidence: [
          `Revenue workspace: ${workspace.id}`,
          workspace.input.sourceUrl ? `Public source: ${workspace.input.sourceUrl}` : "",
          workspace.input.mockupUrl ? `Mockup preview: ${workspace.input.mockupUrl}` : "",
          "Sensitive sale details and private client data intentionally withheld from GitHub issue.",
        ].filter(Boolean),
      });

      if ((developerHandoff.status === "created" || developerHandoff.status === "codex_dispatched") && developerHandoff.issueUrl) {
        const updated = updateRevenueDeliveryWorkspaceQa({
          workspaceId: workspace.id,
          repoFullName: developerHandoff.repoFullName || repoFullName,
          branchName,
          githubIssueUrl: developerHandoff.issueUrl,
          notes: `GitHub handoff issue creado desde Revenue Engine: ${developerHandoff.issueUrl}`,
        }, {
          allowGithubIssueEvidence: true,
        });

        return res.status(201).json({
          status: "created",
          developerHandoff,
          reason: updated.reason,
          workspace: updated.workspace,
          snapshot: updated.snapshot,
        });
      }

      return res
        .status(developerHandoff.status === "needs_repo" ? 422 : developerHandoff.status === "github_unavailable" ? 503 : 400)
        .json({
          status: developerHandoff.status,
          reason: developerHandoff.message,
          developerHandoff,
          workspace,
          snapshot: lookup.snapshot,
        });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create revenue GitHub handoff" });
    }
  });

  app.patch("/api/revenue-engine/delivery-workspaces/qa", async (req, res) => {
    try {
      const input = revenueDeliveryWorkspaceUpdateSchema.parse(req.body);
      res.json(updateRevenueDeliveryWorkspaceQa(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update delivery workspace QA" });
    }
  });

  app.post("/api/revenue-engine/delivery-workspaces/pr-status", async (req, res) => {
    const userId = getCurrentUserId(req);
    if (userId !== getSystemUserId()) {
      return res.status(403).json({
        error: "Revenue Engine PR status checks require the configured owner account.",
      });
    }

    const prStatusSchema = z.object({
      workspaceId: z.string().trim().min(1).max(200),
      prUrl: z.string().trim().url().max(500).or(z.literal("")).optional(),
    });

    try {
      const input = prStatusSchema.parse(req.body);
      const lookup = getRevenueDeliveryWorkspaceById(input.workspaceId);
      if (!lookup.workspace) {
        return res.status(404).json(lookup);
      }

      const workspace = lookup.workspace;
      const prUrl = input.prUrl || workspace.input.prUrl || workspace.codexBuildHandoff.prUrl;
      if (!prUrl) {
        return res.status(422).json({
          status: "needs_pr",
          reason: "Guarda el PR URL antes de revisar estado GitHub.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const parsedPr = parseGitHubPullRequestUrl(prUrl);
      if (!parsedPr) {
        return res.status(400).json({
          status: "invalid_request",
          reason: "PR URL debe ser https://github.com/owner/repo/pull/123.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const repoFullName = workspace.input.repoFullName || workspace.codexBuildHandoff.repoFullName;
      if (repoFullName && parsedPr.repoFullName !== repoFullName) {
        return res.status(409).json({
          status: "repo_mismatch",
          reason: "El PR URL no pertenece al repo guardado en este workspace.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const prStatus = await getGitHubPullRequestReleaseStatus({
        repoFullName: parsedPr.repoFullName,
        pullNumber: parsedPr.pullNumber,
        expectedBranch: workspace.input.branchName || workspace.codexBuildHandoff.branchName,
        appQaTargetEvidence: {
          workspaceId: workspace.id,
          clientName: workspace.input.clientName,
          repoFullName: parsedPr.repoFullName,
          branchName: workspace.input.branchName || workspace.codexBuildHandoff.branchName,
          routePath: "/revenue-engine",
        },
      });

      return res.json({
        status: prStatus.readyForReleaseEvidence ? "ready" : "blocked",
        reason: prStatus.readyForReleaseEvidence
          ? "PR listo como evidencia tecnica; Robert deployment approval sigue siendo manual."
          : prStatus.blockers[0] || "PR todavia tiene blockers.",
        prStatus,
        workspace,
        snapshot: lookup.snapshot,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      if (error?.status === 404 || error?.statusCode === 404) {
        return res.status(404).json({ status: "not_found", reason: "PR no encontrado en GitHub." });
      }
      if (/GitHub no conectado|token no disponible/i.test(String(error?.message || ""))) {
        return res.status(503).json({ status: "github_unavailable", reason: error.message });
      }
      res.status(500).json({ error: "Failed to check revenue delivery PR status" });
    }
  });

  app.post("/api/revenue-engine/delivery-workspaces/app-qa-gate", async (req, res) => {
    const userId = getAuthenticatedCurrentUserId(req);
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    if (userId !== getSystemUserId()) {
      return res.status(403).json({
        error: "Revenue Engine App QA gates require the configured owner account.",
      });
    }

    const appQaGateSchema = z.object({
      workspaceId: z.string().trim().min(1).max(200),
      prUrl: z.string().trim().url().max(500),
      notify: z.boolean().optional().default(false),
    });

    try {
      const input = appQaGateSchema.parse(req.body);
      const lookup = getRevenueDeliveryWorkspaceById(input.workspaceId);
      if (!lookup.workspace) {
        return res.status(404).json(lookup);
      }

      const workspace = lookup.workspace;
      const parsedPr = parseGitHubPullRequestUrl(input.prUrl);
      if (!parsedPr) {
        return res.status(400).json({
          status: "invalid_request",
          reason: "PR URL debe ser https://github.com/owner/repo/pull/123.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const repoFullName = workspace.input.repoFullName || workspace.codexBuildHandoff.repoFullName;
      if (repoFullName && parsedPr.repoFullName !== repoFullName) {
        return res.status(409).json({
          status: "repo_mismatch",
          reason: "El PR URL no pertenece al repo guardado en este workspace.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const expectedBranch = workspace.input.branchName || workspace.codexBuildHandoff.branchName;
      const prStatus = await getGitHubPullRequestReleaseStatus({
        repoFullName: parsedPr.repoFullName,
        pullNumber: parsedPr.pullNumber,
        expectedBranch,
        appQaTargetEvidence: {
          workspaceId: workspace.id,
          clientName: workspace.input.clientName,
          repoFullName: parsedPr.repoFullName,
          branchName: expectedBranch,
          routePath: "/revenue-engine",
        },
      });
      const branchMismatch = prStatus.blockers.find((blocker) => /Branch del PR/i.test(blocker));
      if (branchMismatch) {
        return res.status(409).json({
          status: "branch_mismatch",
          reason: branchMismatch,
          prStatus,
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const appQaTargetContext = {
        kind: "revenue_delivery_workspace" as const,
        workspaceId: workspace.id,
        clientName: workspace.input.clientName,
        projectType: workspace.input.projectType,
        repoFullName: parsedPr.repoFullName,
        prUrl: prStatus.pr.htmlUrl,
        prHeadSha: prStatus.pr.headSha,
        branchName: prStatus.pr.headRef,
        routePath: "/revenue-engine",
        expectedControls: ["Run App QA", "Registrar release gate", "Entregar aprobado"],
      };
      const scan = await runAppQaScan(userId, input.notify, true, false, appQaTargetContext);
      const reviewPacket = await loadOfficePullRequest(prStatus.pr.htmlUrl);
      const claudeReview = reviewPacket.headSha === prStatus.pr.headSha
        ? await officeRuntime.getReview(userId, reviewPacket.prUrl, reviewPacket.headSha, reviewPacket.diffSha256) : undefined;
      const gate = evaluateDeveloperReleaseGate(scan, {
        prUrl: prStatus.pr.htmlUrl,
        prHeadSha: prStatus.pr.headSha,
        prDiffSha256: reviewPacket.diffSha256,
        claudeReview,
        requiredTargetContext: appQaTargetContext,
      });
      const appQaPrCommentBody = gate.status === "pass"
        ? [
          `App QA passed for ${prStatus.pr.headSha}. no blockers.`,
          "",
          "App QA target: revenue_delivery_workspace",
          `Revenue workspace: ${workspace.id}`,
          `Client target: ${workspace.input.clientName}`,
          `Repo target: ${parsedPr.repoFullName}`,
          `PR: ${prStatus.pr.htmlUrl}`,
          `Branch target: ${prStatus.pr.headRef}`,
          `PR head target: ${prStatus.pr.headSha}`,
          "Route target: /revenue-engine",
          `Summary: ${scan.summary}`,
          "",
          "Subagents:",
          ...scan.subAgents.map((agent) => `- ${agent.name}: ${agent.status}`),
          "",
          "No deployment approval is granted by this comment. Robert approval and the Revenue Engine release gate are still required.",
        ].join("\n")
        : "";

      return res.json({
        status: gate.status === "pass" ? "pass" : "blocked",
        reason: gate.status === "pass"
          ? "App QA paso. Pega el comentario sugerido en el PR y vuelve a correr Check PR status para anclar evidencia al head."
          : gate.reasons[0] || "App QA bloqueo el release.",
        scan,
        gate,
        prStatus,
        appQaEvidenceUrl: gate.status === "pass" ? prStatus.appQaEvidenceUrl || "" : "",
        appQaPrCommentBody,
        safety: {
          persistsReleaseGate: false,
          approvesDeployment: false,
          requiresPrCommentEvidence: true,
          requiresWorkspaceTargetEvidence: true,
          requiresRobertApproval: true,
        },
        workspace,
        snapshot: lookup.snapshot,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      if (error?.status === 404 || error?.statusCode === 404) {
        return res.status(404).json({ status: "not_found", reason: "PR no encontrado en GitHub." });
      }
      if (/GitHub no conectado|token no disponible/i.test(String(error?.message || ""))) {
        return res.status(503).json({ status: "github_unavailable", reason: error.message });
      }
      res.status(500).json({ error: "Failed to run revenue delivery App QA gate" });
    }
  });

  app.post("/api/revenue-engine/delivery-workspaces/release-gate", async (req, res) => {
    const userId = getCurrentUserId(req);
    if (userId !== getSystemUserId()) {
      return res.status(403).json({
        error: "Revenue Engine release gates require the configured owner account.",
      });
    }

    try {
      const input = revenueDeliveryWorkspaceUpdateSchema.parse(req.body);
      const lookup = getRevenueDeliveryWorkspaceById(input.workspaceId);
      if (!lookup.workspace) {
        return res.status(404).json(lookup);
      }

      const workspace = lookup.workspace;
      const prUrl = input.prUrl || workspace.input.prUrl || workspace.codexBuildHandoff.prUrl;
      if (!prUrl) {
        return res.status(422).json({
          status: "needs_pr",
          reason: "Release gate requiere PR URL y PR status check antes de persistir evidencia.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const parsedPr = parseGitHubPullRequestUrl(prUrl);
      if (!parsedPr) {
        return res.status(400).json({
          status: "invalid_request",
          reason: "PR URL debe ser https://github.com/owner/repo/pull/123.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const repoFullName = input.repoFullName || workspace.input.repoFullName || workspace.codexBuildHandoff.repoFullName;
      if (repoFullName && parsedPr.repoFullName !== repoFullName) {
        return res.status(409).json({
          status: "repo_mismatch",
          reason: "El PR URL no pertenece al repo guardado en este workspace.",
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      const prStatus = await getGitHubPullRequestReleaseStatus({
        repoFullName: parsedPr.repoFullName,
        pullNumber: parsedPr.pullNumber,
        expectedBranch: input.branchName || workspace.input.branchName || workspace.codexBuildHandoff.branchName,
        appQaTargetEvidence: {
          workspaceId: workspace.id,
          clientName: workspace.input.clientName,
          repoFullName: parsedPr.repoFullName,
          branchName: input.branchName || workspace.input.branchName || workspace.codexBuildHandoff.branchName,
          routePath: "/revenue-engine",
        },
      });
      if (!prStatus.readyForReleaseEvidence) {
        return res.status(409).json({
          status: "blocked",
          reason: prStatus.blockers[0] || "PR status check no esta listo para release.",
          prStatus,
          workspace,
          snapshot: lookup.snapshot,
        });
      }

      res.json(recordRevenueDeliveryReleaseGate(input, {
        verifiedPrStatusReady: true,
        verifiedPrHeadSha: prStatus.pr.headSha,
      }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      if ((error as any)?.status === 404 || (error as any)?.statusCode === 404) {
        return res.status(404).json({ status: "not_found", reason: "PR no encontrado en GitHub." });
      }
      if (/GitHub no conectado|token no disponible/i.test(String((error as any)?.message || ""))) {
        return res.status(503).json({ status: "github_unavailable", reason: (error as any).message });
      }
      res.status(500).json({ error: "Failed to record delivery workspace release gate" });
    }
  });

  app.post("/api/revenue-engine/delivery-workspaces/deliver", async (req, res) => {
    try {
      const input = revenueDeliveryWorkspaceDeliverSchema.parse(req.body);
      res.json(deliverRevenueDeliveryWorkspace({
        ...input,
        approvedByRobert: false,
      }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to deliver revenue workspace" });
    }
  });

  app.post("/api/revenue-engine/delivery-workspaces/trusted-deliver", async (req, res) => {
    const userId = getCurrentUserId(req);
    if (userId !== getSystemUserId()) {
      return res.status(403).json({
        error: "Revenue Engine delivery approval requires the configured owner account.",
      });
    }

    try {
      const input = revenueDeliveryWorkspaceDeliverSchema.parse(req.body);
      res.json(deliverRevenueDeliveryWorkspaceFromTrustedApproval(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to deliver revenue workspace from trusted approval" });
    }
  });

  app.post("/api/revenue-engine/delivery-workspaces/improvement-review", async (req, res) => {
    try {
      const input = revenueDeliveryWorkspaceImprovementReviewSchema.parse(req.body);
      res.json(recordRevenueDeliveryWorkspaceImprovementReview(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create delivery improvement review" });
    }
  });

  app.post("/api/revenue-engine/approval-decisions", async (req, res) => {
    try {
      const input = revenueApprovalDecisionSchema.parse(req.body);
      res.json(recordRevenueApprovalDecision(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record approval decision" });
    }
  });

  app.post("/api/revenue-engine/proposal-email", async (req, res) => {
    try {
      const input = proposalEmailSchema.parse(req.body);
      res.json(buildProposalEmail(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build proposal email" });
    }
  });

  app.post("/api/revenue-engine/outreach-drafts", async (req, res) => {
    try {
      const input = revenueOutreachDraftSchema.parse(req.body);
      res.json(recordRevenueOutreachDraft(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record outreach draft" });
    }
  });

  app.post("/api/revenue-engine/outreach-drafts/approve", async (req, res) => {
    try {
      const input = revenueOutreachApproveSchema.parse(req.body);
      res.json(approveRevenueOutreachDraft(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to approve outreach draft" });
    }
  });

  app.post("/api/revenue-engine/outreach-drafts/update", async (req, res) => {
    try {
      const input = revenueOutreachUpdateSchema.parse(req.body);
      res.json(updateRevenueOutreachDraft(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update outreach draft" });
    }
  });

  app.post("/api/revenue-engine/outreach-send", async (req, res) => {
    try {
      const input = revenueOutreachSendSchema.parse(req.body);
      res.json(await sendRevenueOutreachDraft(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to send outreach draft" });
    }
  });

  app.post("/api/revenue-engine/outreach-outcome", async (req, res) => {
    try {
      const input = revenueOutreachOutcomeSchema.parse(req.body);
      res.json(recordRevenueOutreachOutcome(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record outreach outcome" });
    }
  });

  app.post("/api/revenue-engine/agent-runs", async (req, res) => {
    try {
      const input = revenueAgentRunSchema.parse(req.body);
      res.json(recordRevenueAgentRun(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to run revenue agent" });
    }
  });

  app.post("/api/revenue-engine/sales-autopilot", async (req, res) => {
    try {
      const input = revenueSalesAutopilotSchema.parse(req.body);
      res.json(recordRevenueSalesAutopilot(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to run revenue sales autopilot" });
    }
  });

  app.post("/api/revenue-engine/improvement-review", async (req, res) => {
    try {
      const input = improvementReviewSchema.parse(req.body);
      res.json(recordRevenueImprovementReview(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build improvement review" });
    }
  });

  app.post("/api/revenue-engine/ledger", async (req, res) => {
    try {
      const input = revenueLedgerEntrySchema.parse(req.body);
      res.json(recordRevenueLedgerEntry(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record revenue ledger entry" });
    }
  });

  app.post("/api/revenue-engine/expense-preflight", async (req, res) => {
    try {
      const input = revenueExpensePreflightSchema.parse(req.body);
      res.json(preflightRevenueExpense(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to preflight revenue expense" });
    }
  });

  app.post("/api/revenue-engine/leads", async (req, res) => {
    try {
      const input = revenueLeadSchema.parse(req.body);
      res.json(recordRevenueLead(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to record revenue lead" });
    }
  });

  app.post("/api/revenue-engine/mockup", async (req, res) => {
    try {
      const input = revenueMockupSchema.parse(req.body);
      res.json(buildRevenueMockup(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build revenue mockup" });
    }
  });

  app.get("/api/revenue-engine/mockup-previews/:slug", async (req, res) => {
    let previewPath: string;
    try {
      previewPath = getRevenueMockupPreviewPath(String(req.params.slug || ""));
    } catch {
      return res.status(400).json({ error: "Invalid mockup preview slug" });
    }

    try {
      const html = await readNodeFile(previewPath, "utf8");
      const contentSecurityPolicy = extractRevenueMockupContentSecurityPolicy(html);
      if (!contentSecurityPolicy) {
        return res.status(500).json({ error: "Mockup preview security policy missing" });
      }
      res.setHeader("Content-Security-Policy", contentSecurityPolicy);
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type("html").send(html);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return res.status(404).json({ error: "Mockup preview not found" });
      }
      res.status(500).json({ error: "Failed to read mockup preview" });
    }
  });

  app.get("/api/revenue-engine/assets/three.module.js", async (_req, res) => {
    try {
      const modulePath = `${process.cwd()}/node_modules/three/build/three.module.js`;
      const source = await readNodeFile(modulePath, "utf8");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type("text/javascript").send(source);
    } catch {
      res.status(503).json({ error: "3D preview asset unavailable" });
    }
  });

  app.post("/api/revenue-engine/mockup-template-pack", async (req, res) => {
    try {
      const input = revenueMockupTemplatePackSchema.parse(req.body);
      res.json(buildRevenueMockupTemplatePack(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build revenue mockup template pack" });
    }
  });

  app.post("/api/revenue-engine/project-plan", async (req, res) => {
    try {
      const input = revenueProjectPlanSchema.parse(req.body);
      res.json(buildRevenueProjectPlan(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to build revenue project plan" });
    }
  });

  const createFollowUpSchema = z.object({
    person: z.string().trim().min(1),
    topic: z.string().trim().min(1),
    dueAt: z.string().trim().optional(),
    channel: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    priority: z.enum(["low", "normal", "medium", "high"]).default("normal"),
  });

  const createDecisionSchema = z.object({
    title: z.string().trim().min(1),
    decision: z.string().trim().min(1),
    context: z.string().trim().optional(),
  });

  const createPersonSchema = z.object({
    name: z.string().trim().min(1),
    role: z.string().trim().optional(),
    company: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  });

  const createCommitmentSchema = z.object({
    owner: z.string().trim().min(1),
    commitment: z.string().trim().min(1),
    dueAt: z.string().trim().optional(),
    context: z.string().trim().optional(),
  });

  const createCommunicationDraftSchema = z.object({
    recipient: z.string().trim().min(1),
    channel: z.string().trim().min(1),
    subject: z.string().trim().optional(),
    message: z.string().trim().min(1),
    context: z.string().trim().optional(),
  });

  app.get("/api/ceo/decisions", async (req, res) => {
    try {
      const decisions = await storage.getUserProfileDataByCategory(getCurrentUserId(req), "decision");
      res.json(decisions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch decisions" });
    }
  });

  app.post("/api/ceo/decisions", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const validated = createDecisionSchema.parse(req.body);
      const value = validated.context ? `${validated.decision}\nContext: ${validated.context}` : validated.decision;
      const decision = await storage.saveUserProfileData(userId, {
        userId,
        category: "decision",
        key: validated.title,
        value,
        confidence: "confirmed",
        source: "ceo-dashboard",
      });

      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "decision.save",
        resourceType: "user_profile_data",
        resourceId: decision.id,
        metadata: validated,
        status: "succeeded",
        executionMode: "user_requested",
      });

      res.status(201).json(decision);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to save decision" });
    }
  });

  async function deleteCeoMemoryItem(req: any, res: any, category: "decision" | "person" | "commitment") {
    const userId = getCurrentUserId(req);
    const items = await storage.getUserProfileDataByCategory(userId, category);
    const item = items.find((entry) => entry.id === req.params.id);
    if (!item) {
      return res.status(404).json({ error: "Memory item not found" });
    }

    await storage.deleteUserProfileData(item.id);
    await writeAuditLog({
      userId,
      actorType: "user",
      actorId: userId,
      origin: "web",
      actionType: `${category}.delete`,
      resourceType: "user_profile_data",
      resourceId: item.id,
      metadata: { key: item.key, category },
      status: "succeeded",
      executionMode: "user_requested",
    });

    return res.json({ success: true });
  }

  const updateMemorySchema = z.object({
    title: z.string().trim().min(1).optional(),
    key: z.string().trim().min(1).optional(),
    value: z.string().trim().min(1),
  });

  async function updateCeoMemoryItem(req: any, res: any, category: "decision" | "person" | "commitment") {
    const userId = getCurrentUserId(req);
    const items = await storage.getUserProfileDataByCategory(userId, category);
    const item = items.find((entry) => entry.id === req.params.id);
    if (!item) {
      return res.status(404).json({ error: "Memory item not found" });
    }

    const validated = updateMemorySchema.parse(req.body);
    const updated = await storage.updateUserProfileData(item.id, {
      category,
      key: validated.key || validated.title || item.key,
      value: validated.value,
      confidence: item.confidence || "confirmed",
      source: item.source || "ceo-dashboard",
    });

    await writeAuditLog({
      userId,
      actorType: "user",
      actorId: userId,
      origin: "web",
      actionType: `${category}.edit`,
      resourceType: "user_profile_data",
      resourceId: item.id,
      metadata: { before: { key: item.key, value: item.value }, after: validated },
      status: "succeeded",
      executionMode: "user_requested",
    });

    return res.json(updated);
  }

  app.patch("/api/ceo/decisions/:id", async (req, res) => {
    try {
      await updateCeoMemoryItem(req, res, "decision");
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to edit decision" });
    }
  });

  app.delete("/api/ceo/decisions/:id", async (req, res) => {
    try {
      await deleteCeoMemoryItem(req, res, "decision");
    } catch (error) {
      res.status(500).json({ error: "Failed to delete decision" });
    }
  });

  app.get("/api/ceo/people", async (req, res) => {
    try {
      const people = await storage.getUserProfileDataByCategory(getCurrentUserId(req), "person");
      res.json(people);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch people" });
    }
  });

  app.post("/api/ceo/people", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const validated = createPersonSchema.parse(req.body);
      const value = [
        validated.role ? `Role: ${validated.role}` : null,
        validated.company ? `Company: ${validated.company}` : null,
        validated.notes ? `Notes: ${validated.notes}` : null,
      ].filter(Boolean).join("\n") || "Key person";

      const person = await storage.saveUserProfileData(userId, {
        userId,
        category: "person",
        key: validated.name,
        value,
        confidence: "confirmed",
        source: "ceo-dashboard",
      });

      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "person.save",
        resourceType: "user_profile_data",
        resourceId: person.id,
        metadata: validated,
        status: "succeeded",
        executionMode: "user_requested",
      });

      res.status(201).json(person);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to save person" });
    }
  });

  app.delete("/api/ceo/people/:id", async (req, res) => {
    try {
      await deleteCeoMemoryItem(req, res, "person");
    } catch (error) {
      res.status(500).json({ error: "Failed to delete person" });
    }
  });

  app.patch("/api/ceo/people/:id", async (req, res) => {
    try {
      await updateCeoMemoryItem(req, res, "person");
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to edit person" });
    }
  });

  app.get("/api/ceo/commitments", async (req, res) => {
    try {
      const commitments = await storage.getUserProfileDataByCategory(getCurrentUserId(req), "commitment");
      res.json(commitments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch commitments" });
    }
  });

  app.post("/api/ceo/commitments", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const validated = createCommitmentSchema.parse(req.body);
      const value = [
        validated.commitment,
        validated.dueAt ? `Due: ${validated.dueAt}` : null,
        validated.context ? `Context: ${validated.context}` : null,
      ].filter(Boolean).join("\n");

      const commitment = await storage.saveUserProfileData(userId, {
        userId,
        category: "commitment",
        key: validated.owner,
        value,
        confidence: "confirmed",
        source: "ceo-dashboard",
      });

      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "commitment.save",
        resourceType: "user_profile_data",
        resourceId: commitment.id,
        metadata: validated,
        status: "succeeded",
        executionMode: "user_requested",
      });

      res.status(201).json(commitment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to save commitment" });
    }
  });

  app.post("/api/ceo/communication-drafts", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const validated = createCommunicationDraftSchema.parse(req.body);
      const pendingAction = await createPendingActionForApproval({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        executionMode: "user_requested",
        actionType: "communications.send",
        resourceType: "communication_draft",
        title: `Borrador para ${validated.recipient}`,
        description: `Enviar por ${validated.channel}${validated.subject ? `: ${validated.subject}` : ""}`,
        input: validated,
        proposedChanges: {
          recipient: validated.recipient,
          channel: validated.channel,
          subject: validated.subject,
          message: validated.message,
        },
      });

      res.status(201).json(pendingAction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create communication draft" });
    }
  });

  app.delete("/api/ceo/commitments/:id", async (req, res) => {
    try {
      await deleteCeoMemoryItem(req, res, "commitment");
    } catch (error) {
      res.status(500).json({ error: "Failed to delete commitment" });
    }
  });

  app.patch("/api/ceo/commitments/:id", async (req, res) => {
    try {
      await updateCeoMemoryItem(req, res, "commitment");
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to edit commitment" });
    }
  });

  app.post("/api/ceo/follow-ups", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const validated = createFollowUpSchema.parse(req.body);
      const dueAt = validated.dueAt ? new Date(validated.dueAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const description = [
        `Owner: ${validated.person}`,
        validated.channel ? `Channel: ${validated.channel}` : null,
        validated.notes ? `Notes: ${validated.notes}` : null,
      ].filter(Boolean).join("\n");

      const task = await storage.createTask(userId, {
        title: `Follow-up: ${validated.person} - ${validated.topic}`,
        description,
        date: dueAt,
        priority: validated.priority,
        completed: false,
        type: "follow_up",
      });

      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "follow_up.create",
        resourceType: "task",
        resourceId: task.id,
        metadata: validated,
        status: "succeeded",
        executionMode: "user_requested",
      });

      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create follow-up" });
    }
  });

  app.post("/api/ceo/follow-ups/:id/complete", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const task = await storage.getTask(req.params.id);
      if (!task || task.userId !== userId || task.type !== "follow_up") {
        return res.status(404).json({ error: "Follow-up not found" });
      }

      const updated = await storage.updateTask(task.id, { completed: true });
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "follow_up.complete",
        resourceType: "task",
        resourceId: task.id,
        metadata: { title: task.title },
        status: "succeeded",
        executionMode: "user_requested",
      });

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to complete follow-up" });
    }
  });

  app.get("/api/ceo/meetings/prep", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const preps = await getUpcomingMeetingPreps(userId, 8);
      res.json(preps);
    } catch (error) {
      res.status(500).json({ error: "Failed to build meeting prep" });
    }
  });

  app.get("/api/ceo/meetings/:id/prep", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const prep = await getMeetingPrepById(userId, req.params.id);
      if (!prep) {
        return res.status(404).json({ error: "Meeting prep not found" });
      }
      res.json(prep);
    } catch (error) {
      res.status(500).json({ error: "Failed to build meeting prep" });
    }
  });

  app.get("/api/ai-spend/monthly", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const [runs, automations] = await Promise.all([
        storage.getAutomationRuns(userId, undefined, 500),
        storage.getAutomationDefinitions(userId),
      ]);
      res.json({ ...buildMonthlyAiSpendReport(runs), automations });
    } catch (error) {
      res.status(500).json({ error: "Failed to build AI spend report" });
    }
  });

  app.get("/api/ceo-dashboard", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      const safe = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => {
        try {
          return await promise;
        } catch (error) {
          console.warn("[ceo-dashboard] partial data unavailable:", error);
          return fallback;
        }
      };

      const [
        tasks,
        pendingActions,
        projects,
        priceAlerts,
        auditLogs,
        permissions,
        agentActions,
        scheduledReminders,
        djContacts,
        automations,
        automationRuns,
        meetingPreps,
        decisions,
        people,
        commitments,
      ] = await Promise.all([
        safe(storage.getTasks(userId), []),
        safe(storage.getPendingActions(userId), []),
        safe(storage.getMonitoredProjects(userId), []),
        safe(storage.getPriceAlerts(userId), []),
        safe(storage.getAuditLogs(userId, 25), []),
        safe(storage.getAssistantPermissions(userId), []),
        safe(storage.getAgentActions(userId), []),
        safe(storage.getScheduledReminders(userId), []),
        safe(storage.getDjContacts(userId), []),
        safe(getExistingAutomations(userId), []),
        safe(storage.getAutomationRuns(userId, undefined, 25), []),
        safe(getUpcomingMeetingPreps(userId, 5), []),
        safe(storage.getUserProfileDataByCategory(userId, "decision"), []),
        safe(storage.getUserProfileDataByCategory(userId, "person"), []),
        safe(storage.getUserProfileDataByCategory(userId, "commitment"), []),
      ]);

      const todaysTasks = tasks
        .filter((task) => {
          const date = new Date(task.date);
          return date >= todayStart && date <= todayEnd && !task.completed;
        })
        .sort((a, b) => {
          if (a.priority === "high" && b.priority !== "high") return -1;
          if (b.priority === "high" && a.priority !== "high") return 1;
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        });

      const overdueTasks = tasks.filter((task) => new Date(task.date) < todayStart && !task.completed);
      const activeApprovals = pendingActions.filter((action) => ["pending", "edited", "snoozed", "approved"].includes(action.status));
      const offlineProjects = projects.filter((project) => project.status === "offline" || project.status === "degraded");
      const failedAudit = auditLogs.filter((log) => log.status === "failed").slice(0, 5);
      const failedAgentActions = agentActions.filter((action) => action.status === "failed").slice(0, 5);
      const failedAutomations = automations.filter((automation) => automation.status === "failed");
      const failedAutomationRuns = automationRuns.filter((run) => run.status === "failed");
      const pendingAutomationRuns = automationRuns.filter((run) => run.status === "pending_approval");
      const operationalHealth = buildCeoOperationalHealth({ automations, runs: automationRuns, now });
      const triggeredFinanceAlerts = priceAlerts.filter((alert) => alert.enabled && alert.triggered);
      const radioTasks = tasks
        .filter((task) => {
          const text = `${task.title} ${task.description || ""}`.toLowerCase();
          return text.includes("radio") || text.includes("black room");
        })
        .filter((task) => new Date(task.date) >= todayStart)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 5);
      const marketingTasks = tasks
        .filter((task) => {
          const text = `${task.title} ${task.description || ""}`.toLowerCase();
          return text.includes("marketing") || text.includes("content") || text.includes("contenido") || text.includes("post");
        })
        .filter((task) => !task.completed)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 5);
      const followUpsDue = tasks
        .filter((task) => {
          const text = `${task.title} ${task.description || ""}`.toLowerCase();
          const isFollowUp = text.includes("follow") || text.includes("llamar") || text.includes("mensaje") || text.includes("responder") || text.includes("contactar");
          return (task.type === "follow_up" || isFollowUp) && !task.completed && new Date(task.date) <= todayEnd;
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 8);
      const kongDropkitProjects = projects.filter((project) => {
        const text = `${project.name} ${project.description || ""} ${project.githubRepo || ""}`.toLowerCase();
        return text.includes("kong") || text.includes("dropkit");
      });

      const googleConnected = await isGoogleCalendarConnected().catch(() => false);
      const githubConnected = await isGitHubConnected().catch(() => false);

      const agenda = todaysTasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        type: task.type,
        priority: task.priority,
        startsAt: task.date,
        endsAt: task.endDate,
        source: task.externalSource || "blackops",
      }));
      const todayPriorities = [
        ...todaysTasks.slice(0, 6).map((task) => ({
          id: task.id,
          type: "task",
          title: task.title,
          priority: task.priority,
          dueAt: task.date,
        })),
        ...activeApprovals.slice(0, 3).map((action) => ({
          id: action.id,
          type: "approval",
          title: action.title,
          priority: action.riskLevel,
          dueAt: action.expiresAt || action.createdAt,
        })),
      ];
      const criticalRisks = [
        ...offlineProjects.map((project) => ({
          type: "project_health",
          severity: project.status === "offline" ? "critical" : "medium",
          title: `${project.name} esta ${project.status}`,
          resourceId: project.id,
        })),
        ...overdueTasks.slice(0, 5).map((task) => ({
          type: "overdue_task",
          severity: task.priority === "high" ? "high" : "medium",
          title: task.title,
          resourceId: task.id,
        })),
        ...failedAudit.map((log) => ({
          type: "failed_action",
          severity: "high",
          title: log.actionType,
          resourceId: log.id,
          error: log.errorMessage,
        })),
      ];

      res.json({
        agenda,
        topPriorities: todayPriorities.slice(0, 3),
        todayPriorities,
        pendingApprovals: activeApprovals,
        criticalRisks,
        appHealth: {
          projects: {
            total: projects.length,
            online: projects.filter((project) => project.status === "online").length,
            offline: projects.filter((project) => project.status === "offline").length,
            degraded: projects.filter((project) => project.status === "degraded").length,
            items: projects.slice(0, 8),
          },
          integrations: {
            googleCalendar: googleConnected,
            github: githubConnected,
          },
          trust: {
            pendingApprovals: activeApprovals.length,
            permissionsConfigured: permissions.length,
            recentFailures: failedAudit.length,
          },
          automations: {
            total: automations.length,
            active: automations.filter((automation) => automation.status === "active").length,
            paused: automations.filter((automation) => automation.status === "paused").length,
            failed: failedAutomations.length,
            pendingApproval: pendingAutomationRuns.length,
          },
        },
        operationalHealth,
        financeAlerts: triggeredFinanceAlerts.map((alert) => ({
          id: alert.id,
          symbol: alert.symbol,
          condition: alert.condition,
          targetPrice: alert.targetPrice,
          triggeredAt: alert.triggeredAt,
        })),
        marketingContentStatus: {
          openItems: marketingTasks,
          needsDataModel: true,
        },
        marketingContentAlerts: marketingTasks,
        blackRoomEvents: {
          upcoming: radioTasks,
          djContacts: djContacts.length,
        },
        kongDropkitStatus: {
          projects: kongDropkitProjects,
          connectedToGithub: githubConnected,
          needsBusinessUnitModel: kongDropkitProjects.length === 0,
        },
        automationFailures: [
          ...failedAutomations.map((automation) => ({
            id: automation.id,
            source: "automation",
            title: automation.name,
            error: automation.description,
            createdAt: automation.updatedAt,
          })),
          ...failedAutomationRuns.map((run) => ({
            id: run.id,
            source: "automation_run",
            title: run.resultSummary || "Automation run failed",
            error: run.errorMessage,
            createdAt: run.createdAt,
          })),
          ...failedAudit.map((log) => ({
            id: log.id,
            source: "audit",
            title: log.actionType,
            error: log.errorMessage,
            createdAt: log.createdAt,
          })),
          ...failedAgentActions.map((action) => ({
            id: action.id,
            source: "agent",
            title: action.description,
            error: null,
            createdAt: action.createdAt,
          })),
        ],
        followUpsDue,
        reminders: scheduledReminders
          .filter((reminder) => reminder.isActive)
          .slice(0, 8),
        meetingPreps,
        decisions: decisions.slice(0, 6).map((decision) => ({
          id: decision.id,
          title: decision.key,
          description: decision.value,
          createdAt: decision.createdAt,
          type: "decision",
        })),
        people: people.slice(0, 6).map((person) => ({
          id: person.id,
          title: person.key,
          description: person.value,
          createdAt: person.createdAt,
          type: "person",
        })),
        commitments: commitments.slice(0, 8).map((commitment) => ({
          id: commitment.id,
          title: commitment.key,
          description: commitment.value,
          createdAt: commitment.createdAt,
          type: "commitment",
        })),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to build CEO dashboard" });
    }
  });

  // ==================== DEVELOPER HEALTH CENTER ====================

  app.get("/api/developer-health/apps", async (req, res) => {
    try {
      const apps = await storage.getAppProjects(getCurrentUserId(req));
      res.json(apps);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch app projects" });
    }
  });

  app.post("/api/developer-health/apps", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const body = {
        ...req.body,
        slug: req.body.slug || String(req.body.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      };
      const validated = insertAppProjectSchema.parse(body);
      const appProject = await storage.createAppProject(userId, validated);
      await writeAuditLog({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        actionType: "developer_health.app_project.create",
        resourceType: "app_project",
        resourceId: appProject.id,
        metadata: { name: appProject.name, slug: appProject.slug },
        status: "succeeded",
        executionMode: "user_requested",
      });
      res.status(201).json(appProject);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create app project" });
    }
  });

  app.get("/api/developer-health/dashboard", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const storedApps = await storage.getAppProjects(userId);
      // Apps never scanned show the uptime monitor's fresh result for the same host/repo (read-only).
      const monitors = storedApps.length ? await storage.getMonitoredProjects(userId).catch(() => []) : [];
      const apps = withUptimeHealth(storedApps, monitors);
      const incidents = await storage.getAppIncidents(userId);
      const openIncidents = incidents.filter((incident) => ["open", "investigating", "pending_action"].includes(incident.status));

      const appCards = await Promise.all(apps.map(async (appProject) => {
        const [checks, errors, reports] = await Promise.all([
          storage.getAppHealthChecks(appProject.id, 10),
          storage.getAppErrorEvents(appProject.id, 10),
          storage.getAppDailyReports(appProject.id, 1),
        ]);
        return {
          ...appProject,
          recentChecks: checks,
          recentErrors: errors,
          latestReport: reports[0] || null,
          openIncidents: openIncidents.filter((incident) => incident.appProjectId === appProject.id),
        };
      }));

      res.json({
        apps: appCards,
        summary: {
          totalApps: apps.length,
          healthy: apps.filter((appProject) => appProject.status === "healthy").length,
          degraded: apps.filter((appProject) => appProject.status === "degraded").length,
          down: apps.filter((appProject) => appProject.status === "down").length,
          unknown: apps.filter((appProject) => appProject.status === "unknown").length,
          openIncidents: openIncidents.length,
          criticalIncidents: openIncidents.filter((incident) => incident.severity === "critical").length,
        },
        openIncidents,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch developer health dashboard" });
    }
  });

  app.get("/api/cybersecurity-agent/status", async (req, res) => {
    try {
      const result = await runCybersecurityScan(getCurrentUserId(req), false);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to scan cybersecurity status" });
    }
  });

  app.post("/api/cybersecurity-agent/scan", async (req, res) => {
    try {
      const notify = Boolean(req.body?.notify);
      const result = await runCybersecurityScan(getCurrentUserId(req), notify);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to run cybersecurity scan" });
    }
  });

  app.post("/api/cybersecurity-agent/import-missing-apps", async (req, res) => {
    try {
      if (!(await isGitHubConnected())) {
        return res.status(400).json({ error: "GitHub is not connected" });
      }
      const result = await importMissingGithubApps(getCurrentUserId(req));
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to import GitHub apps" });
    }
  });

  app.get("/api/app-qa-agent/status", async (req, res) => {
    try {
      const result = await runAppQaScan(getCurrentUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to run app QA scan" });
    }
  });

  app.post("/api/app-qa-agent/scan", async (req, res) => {
    try {
      const notify = Boolean(req.body?.notify);
      const result = await runAppQaScan(getCurrentUserId(req), notify, true, false);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to run app QA scan" });
    }
  });

  app.post("/api/developer-autopilot/handoff", async (req, res) => {
    const userId = getCurrentUserId(req);
    if (userId !== getSystemUserId()) {
      return res.status(403).json({
        error: "Developer Autopilot GitHub handoffs are limited to the configured single-user owner while GitHub connectors are shared.",
      });
    }

    try {
      const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      if (!message) {
        return res.status(400).json({ error: "message is required" });
      }
      const result = await createDeveloperAutopilotHandoff(userId, message, "web_chat");
      res.status(result.status === "created" || result.status === "codex_dispatched" ? 201 : result.status === "subscription_brief" ? 200 : result.status === "needs_repo" ? 422 : 400).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create Developer Autopilot handoff" });
    }
  });

  app.post("/api/developer-autopilot/qa-gate", async (req, res) => {
    try {
      const userId = getAuthenticatedCurrentUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      if (userId !== getSystemUserId()) return res.status(403).json({ error: "Owner required" });
      const scan = await runAppQaScan(userId, Boolean(req.body?.notify), true, false);
      const prUrl = typeof req.body?.prUrl === "string" ? req.body.prUrl.trim() : null;
      const packet = prUrl ? await loadOfficePullRequest(prUrl) : null;
      const claudeReview = packet ? await officeRuntime.getReview(userId, packet.prUrl, packet.headSha, packet.diffSha256) : undefined;
      const gate = evaluateDeveloperReleaseGate(scan, { prUrl, prHeadSha: packet?.headSha, prDiffSha256: packet?.diffSha256, claudeReview });
      res.json({
        scan,
        gate,
        replitDeploymentRequiresApproval: true,
        message: gate.status === "pass"
          ? "QA paso. Puedes revisar el PR, pero Replit sigue esperando aprobacion explicita."
          : "QA bloqueo el release. No se debe montar en Replit hasta corregir estos hallazgos.",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to evaluate Developer Autopilot QA gate" });
    }
  });

  app.get("/api/app-qa-agent/history", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const automations = await getExistingAutomations(userId);
      const qaAutomation = automations.find((automation) => (automation.metadata as any)?.key === "app-qa-council");
      if (!qaAutomation) return res.json([]);
      const limit = Math.min(Number(req.query.limit || 20), 100);
      const runs = await storage.getAutomationRuns(userId, qaAutomation.id, limit);
      res.json(runs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch app QA history" });
    }
  });

  app.get("/api/legal-compliance/reports", async (req, res) => {
    try {
      const result = await runLegalComplianceReports(getCurrentUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate legal compliance reports" });
    }
  });

  app.get("/api/developer-health/apps/:id/overview", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const appProject = await storage.getAppProject(req.params.id);
      if (!appProject || appProject.userId !== userId) {
        return res.status(404).json({ error: "App project not found" });
      }
      const [checks, incidents, errors, reports] = await Promise.all([
        storage.getAppHealthChecks(appProject.id, 50),
        storage.getAppIncidentsForProject(appProject.id),
        storage.getAppErrorEvents(appProject.id, 50),
        storage.getAppDailyReports(appProject.id, 7),
      ]);
      res.json({ app: appProject, checks, incidents, errors, reports });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch app overview" });
    }
  });

  app.get("/api/developer-health/apps/:id/timeline", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const appProject = await storage.getAppProject(req.params.id);
      if (!appProject || appProject.userId !== userId) {
        return res.status(404).json({ error: "App project not found" });
      }
      const [checks, incidents, errors] = await Promise.all([
        storage.getAppHealthChecks(appProject.id, 100),
        storage.getAppIncidentsForProject(appProject.id),
        storage.getAppErrorEvents(appProject.id, 100),
      ]);
      const timeline = [
        ...checks.map((check) => ({ type: "check", at: check.checkedAt, item: check })),
        ...incidents.map((incident) => ({ type: "incident", at: incident.lastSeenAt, item: incident })),
        ...errors.map((errorEvent) => ({ type: "error", at: errorEvent.lastSeenAt, item: errorEvent })),
      ].sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
      res.json(timeline);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch app timeline" });
    }
  });

  app.get("/api/developer-health/incidents", async (req, res) => {
    try {
      const incidents = await storage.getAppIncidents(getCurrentUserId(req), req.query.status as string | undefined);
      res.json(incidents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch developer incidents" });
    }
  });

  app.get("/api/developer-health/incidents/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const incident = await storage.getAppIncident(req.params.id);
      if (!incident) {
        return res.status(404).json({ error: "Incident not found" });
      }
      const appProject = await storage.getAppProject(incident.appProjectId);
      if (!appProject || appProject.userId !== userId) {
        return res.status(404).json({ error: "Incident not found" });
      }
      const errors = await storage.getAppErrorEventsForIncident(incident.id);
      res.json({ incident, app: appProject, errors });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch developer incident" });
    }
  });

  app.post("/api/developer-health/incidents/:id/investigate", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const incident = await storage.getAppIncident(req.params.id);
      if (!incident) {
        return res.status(404).json({ error: "Incident not found" });
      }
      const appProject = await storage.getAppProject(incident.appProjectId);
      if (!appProject || appProject.userId !== userId) {
        return res.status(404).json({ error: "Incident not found" });
      }
      const pendingAction = await createPendingActionForApproval({
        userId,
        actorType: "user",
        actorId: userId,
        origin: "web",
        executionMode: "user_requested",
        actionType: "developer_agent.investigate_incident",
        resourceType: "app_incident",
        resourceId: incident.id,
        title: `Investigate ${appProject.name}: ${incident.title}`,
        description: "Developer Agent may inspect only incident-related files, logs, stack traces, linked PRs, and deployment metadata before proposing a fix.",
        input: {
          incidentId: incident.id,
          appProjectId: appProject.id,
          githubRepo: appProject.githubRepo,
          fingerprint: incident.fingerprint,
          source: incident.source,
          severity: incident.severity,
        },
        proposedChanges: {
          mode: "investigation_only",
          allowedScope: "related_files_only",
        },
        metadata: { appName: appProject.name, incidentTitle: incident.title },
        scope: "code",
      });
      await storage.updateAppIncident(incident.id, {
        status: "pending_action",
        relatedPendingActionId: pendingAction.id,
      });
      res.status(201).json({ pendingAction });
    } catch (error) {
      res.status(500).json({ error: "Failed to create investigation pending action" });
    }
  });

  // ==================== AGENT ACTIONS ====================

  // GET list all available actions
  app.get("/api/agent/actions", async (req, res) => {
    try {
      const actions = listAllActions();
      res.json(actions);
    } catch (error) {
      res.status(500).json({ error: "Failed to list actions" });
    }
  });

  // GET actions by category
  app.get("/api/agent/actions/:category", async (req, res) => {
    try {
      const actions = getActionsByCategory(req.params.category);
      res.json(actions.map(a => ({ id: a.id, name: a.name, description: a.description })));
    } catch (error) {
      res.status(500).json({ error: "Failed to get category actions" });
    }
  });

  // POST execute a single action
  app.post("/api/agent/execute/:actionId", async (req, res) => {
    try {
      const result = await executeAction(req.params.actionId, getCurrentUserId(req));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to execute action" });
    }
  });

  // POST execute multiple actions
  app.post("/api/agent/execute-batch", async (req, res) => {
    try {
      const { actionIds } = req.body;
      if (!Array.isArray(actionIds)) {
        return res.status(400).json({ error: "actionIds must be an array" });
      }
      const results = await executeMultipleActions(actionIds, getCurrentUserId(req));
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to execute actions" });
    }
  });

  // GET agent action history
  app.get("/api/agent/history", async (req, res) => {
    try {
      const actions = await storage.getAgentActions(getCurrentUserId(req));
      res.json(actions);
    } catch (error) {
      res.status(500).json({ error: "Failed to get action history" });
    }
  });

  // ==================== MONITORED PROJECTS ====================

  app.use(["/api/projects/github-overview", "/api/projects/import-github"], (req, res, next) => {
    const userId = getCurrentUserId(req);
    const githubProjectOwnerUserId = getSystemUserId();
    if (userId !== githubProjectOwnerUserId) {
      return res.status(403).json({
        error: "GitHub project discovery is limited to the configured single-user owner while the GitHub connector is shared.",
      });
    }
    return next();
  });

  // GET all monitored projects
  app.get("/api/projects", async (req, res) => {
    try {
      const projects = await storage.getMonitoredProjects(getCurrentUserId(req));
      res.json(projects);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/github-overview", async (req, res) => {
    try {
      const projects = await storage.getMonitoredProjects(getCurrentUserId(req));
      const repos = Array.from(new Set(projects.map((project) => project.githubRepo).filter(Boolean))) as string[];
      const entries = await Promise.all(
        repos.map(async (fullName) => {
          const [owner, repo] = fullName.split("/");
          if (!owner || !repo) return [fullName, { error: "Repo invalido" }];
          try {
            return [fullName, await getRepositoryOverview(owner, repo)];
          } catch (error: any) {
            return [fullName, { error: error.message || "No se pudo leer GitHub" }];
          }
        })
      );
      res.json(Object.fromEntries(entries));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch GitHub project overview" });
    }
  });

  app.post("/api/projects/import-github", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const [repos, existingProjects] = await Promise.all([
        listRepositories(),
        storage.getMonitoredProjects(userId),
      ]);
      const existingRepos = new Set(existingProjects.map((project) => project.githubRepo).filter(Boolean));
      let imported = 0;
      let skipped = 0;
      const projects = [];

      for (const repo of repos) {
        if (existingRepos.has(repo.full_name)) {
          skipped++;
          continue;
        }

        const project = await storage.createMonitoredProject(userId, {
          name: repo.name,
          url: repo.homepage?.trim() || repo.html_url,
          description: repo.description || `Repositorio GitHub: ${repo.full_name}`,
          githubRepo: repo.full_name,
          notifyOnDown: true,
        });
        imported++;
        projects.push(project);
      }

      res.status(201).json({ imported, skipped, total: repos.length, projects });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to import GitHub projects" });
    }
  });

  // GET single monitored project
  app.get("/api/projects/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const project = await storage.getMonitoredProject(req.params.id);
      if (!project || project.userId !== userId) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  // POST create monitored project
  app.post("/api/projects", async (req, res) => {
    try {
      const validated = insertMonitoredProjectSchema.parse(req.body);
      const project = await storage.createMonitoredProject(getCurrentUserId(req), validated);
      res.status(201).json(project);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  // PATCH update monitored project
  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getMonitoredProject(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Project not found" });
      }
      const project = await storage.updateMonitoredProject(req.params.id, req.body);
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  // DELETE monitored project
  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const existing = await storage.getMonitoredProject(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Project not found" });
      }
      await storage.deleteMonitoredProject(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // POST check project health manually
  app.post("/api/projects/:id/check", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const project = await storage.getMonitoredProject(req.params.id);
      if (!project || project.userId !== userId) {
        return res.status(404).json({ error: "Project not found" });
      }
      const result = await checkSingleProject(req.params.id);
      if (!result) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to check project" });
    }
  });

  // GET project health check logs
  app.get("/api/projects/:id/logs", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const project = await storage.getMonitoredProject(req.params.id);
      if (!project || project.userId !== userId) {
        return res.status(404).json({ error: "Project not found" });
      }
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getHealthCheckLogs(req.params.id, limit);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  // GET project incidents
  app.get("/api/projects/:id/incidents", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const project = await storage.getMonitoredProject(req.params.id);
      if (!project || project.userId !== userId) {
        return res.status(404).json({ error: "Project not found" });
      }
      const incidents = await storage.getIncidents(req.params.id);
      res.json(incidents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch incidents" });
    }
  });

  // Register AI assistant routes
  registerAssistantRoutes(app);

  // ==================== CODE AGENT ROUTES ====================

  app.use(["/api/code", "/api/github"], (req, res, next) => {
    const userId = getCurrentUserId(req);
    const toolOwnerUserId = getSystemUserId();
    if (userId !== toolOwnerUserId) {
      return res.status(403).json({
        error: "Developer tools are limited to the configured single-user owner until per-user repo and filesystem permissions are implemented.",
      });
    }
    return next();
  });
  
  // Read file content
  app.get("/api/code/read", async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        return res.status(400).json({ error: "Se requiere el parámetro 'path'" });
      }
      const result = await readFile(filePath);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error leyendo archivo" });
    }
  });
  
  // Write file content
  app.post("/api/code/write", async (req, res) => {
    try {
      const { path: filePath, content, description } = req.body;
      if (!filePath || content === undefined) {
        return res.status(400).json({ error: "Se requieren 'path' y 'content'" });
      }
      const result = await writeFile(filePath, content, description);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error escribiendo archivo" });
    }
  });
  
  // List files in directory
  app.get("/api/code/files", async (req, res) => {
    try {
      const directory = (req.query.dir as string) || "client/src";
      const result = await listFiles(directory);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error listando archivos" });
    }
  });
  
  // Get project structure
  app.get("/api/code/structure", async (req, res) => {
    try {
      const structure = await getProjectStructure();
      res.json({ success: true, structure });
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo estructura" });
    }
  });
  
  // Get change history
  app.get("/api/code/history", async (req, res) => {
    try {
      const history = await getChangeHistory();
      res.json({ success: true, history });
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo historial" });
    }
  });
  
  // Undo last change
  app.post("/api/code/undo", async (req, res) => {
    try {
      const result = await undoLastChange();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error deshaciendo cambio" });
    }
  });
  
  // Get database schema
  app.get("/api/code/schema", async (req, res) => {
    try {
      const result = await getTableSchema();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo esquema" });
    }
  });
  
  // Execute SELECT query
  app.post("/api/code/query", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) {
        return res.status(400).json({ error: "Se requiere 'query'" });
      }
      const result = await executeQuery(query);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error ejecutando consulta" });
    }
  });
  
  // Get table info
  app.get("/api/code/table/:name", async (req, res) => {
    try {
      const result = await getTableInfo(req.params.name);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo info de tabla" });
    }
  });
  
  // Create new table
  app.post("/api/code/table", async (req, res) => {
    try {
      const { name, columns } = req.body;
      if (!name || !columns) {
        return res.status(400).json({ error: "Se requieren 'name' y 'columns'" });
      }
      const result = await createTable({ name, columns });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error creando tabla" });
    }
  });
  
  // Add column to table
  app.post("/api/code/table/:name/column", async (req, res) => {
    try {
      const { name, type, nullable, defaultValue } = req.body;
      if (!name || !type) {
        return res.status(400).json({ error: "Se requieren 'name' y 'type'" });
      }
      const result = await addColumnToTable(req.params.name, { name, type, nullable, defaultValue });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error agregando columna" });
    }
  });
  
  // ==================== CODE GENERATOR ROUTES ====================
  
  // Generate code from natural language
  app.post("/api/code/generate", async (req, res) => {
    try {
      const { prompt, context, preview } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Se requiere 'prompt'" });
      }
      const result = await generateCode({ prompt, context, preview: preview ?? true });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error generando código" });
    }
  });
  
  // Apply generated code
  app.post("/api/code/apply", async (req, res) => {
    try {
      const { prompt, context } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Se requiere 'prompt'" });
      }
      const result = await generateCode({ prompt, context, preview: false });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error aplicando código" });
    }
  });
  
  // Get available templates
  app.get("/api/code/templates", async (req, res) => {
    try {
      const templates = Object.entries(MODULE_TEMPLATES).map(([key, val]) => ({
        id: key,
        name: val.name,
        description: val.description
      }));
      res.json({ success: true, templates });
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo templates" });
    }
  });
  
  // Generate from template
  app.post("/api/code/template/:id", async (req, res) => {
    try {
      const templateKey = req.params.id as keyof typeof MODULE_TEMPLATES;
      const result = await generateFromTemplate(templateKey, req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error generando desde template" });
    }
  });

  // ===== GitHub Integration Routes =====
  
  // Check if GitHub is connected
  app.get("/api/github/status", async (req, res) => {
    try {
      const connected = await isGitHubConnected();
      if (connected) {
        const user = await getAuthenticatedUser();
        res.json({ connected: true, user });
      } else {
        res.json({ connected: false });
      }
    } catch (error) {
      res.json({ connected: false });
    }
  });

  // List user's repositories
  app.get("/api/github/repos", async (req, res) => {
    try {
      const repos = await listRepositories();
      res.json(repos);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Error al listar repositorios" });
    }
  });

  // Get repository contents (files/folders at path)
  app.get("/api/github/repos/:owner/:repo/contents", async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const path = (req.query.path as string) || '';
      const contents = await getRepoContents(owner, repo, path);
      res.json(contents);
    } catch (error: any) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message || "Error al obtener contenido" });
    }
  });

  // Get file content
  app.get("/api/github/repos/:owner/:repo/file", async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const path = req.query.path as string;
      if (!path) {
        return res.status(400).json({ error: "Se requiere el parámetro path" });
      }
      const file = await getFileContent(owner, repo, path);
      res.json(file);
    } catch (error: any) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message || "Error al leer archivo" });
    }
  });

  // Update or create file
  app.post("/api/github/repos/:owner/:repo/file", async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const { path, content, message, sha } = req.body;
      if (!path || content === undefined || !message) {
        return res.status(400).json({ error: "Se requieren path, content y message" });
      }
      const result = await updateFile(owner, repo, path, content, message, sha);
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message || "Error al guardar archivo" });
    }
  });

  // Delete file
  app.delete("/api/github/repos/:owner/:repo/file", async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const { path, message, sha } = req.body;
      if (!path || !message || !sha) {
        return res.status(400).json({ error: "Se requieren path, message y sha" });
      }
      const result = await deleteFile(owner, repo, path, message, sha);
      res.json(result);
    } catch (error: any) {
      res.status(error.statusCode || error.status || 500).json({ error: error.message || "Error al eliminar archivo" });
    }
  });

  return httpServer;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
