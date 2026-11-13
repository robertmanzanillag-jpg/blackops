import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import test from "node:test";
import express from "express";
import {
  answerRevenueAutomationIntake,
  approveRevenuePublicLeadCandidate,
  buildAutomationQuote,
  buildDeliveryReview,
  buildProposalEmail,
  buildRevenueUserDataPaths,
  buildRevenueDurableOwnerId,
  buildImprovementReview,
  buildRevenueEnginePlan,
  buildRevenueLaunchReadiness,
  buildRevenueLeadRadar,
  buildRevenueMockup,
  buildRevenueMockupPreview,
  buildRevenueMockupTemplatePack,
  buildRevenueProjectPlan,
  buildRevenueScoutingMission,
  closeRevenueAutomationOpportunity,
  closeRevenueWebsiteOpportunity,
  convertRevenueAutomationIntakeToOpportunity,
  createDeliveryWorkspaceFromAutomationOpportunity,
  createWebsiteDeliveryWorkspaceFromLead,
  deliverRevenueDeliveryWorkspace,
  enableRevenueEngineDurablePersistenceForTests,
  getRevenueDeliveryWorkspaceById,
  getRevenueEngineDurablePersistenceStatus,
  getRevenueEngineSnapshot,
  getRevenueMockupPreviewPath,
  getRevenueWebsiteWorkspaceSaleGate,
  flushRevenueEnginePersistence,
  prepareRevenueEngineState,
  preflightRevenueExpense,
  previewRevenueMoneySprintSeeds,
  recordRevenueAgentRun,
  recordRevenueApprovalDecision,
  recordRevenueAutomationIntake,
  recordRevenueAutomationOpportunity,
  recordRevenueDeliveryWorkspace,
  recordRevenueDeliveryReleaseGate,
  recordRevenueDeliveryWorkspaceImprovementReview,
  recordRevenueImprovementReview,
  recordRevenueLead,
  recordRevenueLedgerEntry,
  recordRevenueOutreachDraft,
  recordRevenueOutreachOutcome,
  recordRevenuePublicLeadCandidate,
  recordRevenuePublicLeadCandidateBatch,
  recordRevenuePublicScoutEvidence,
  recordRevenueVerifiedScoutConnectorResults,
  recordRevenueSalesAutopilot,
  recordRevenueScoutingMission,
  recordRevenueWebsiteOpportunity,
  revenueMoneySprintFromPublicCandidatesSchema,
  revenueOutreachOutcomeSchema,
  revenuePublicLeadCandidateApproveSchema,
  revenueWebsiteOpportunityCloseSchema,
  revenueDeliveryWorkspaceDeliverSchema,
  revenueDeliveryWorkspaceGithubHandoffSchema,
  revenueDeliveryWorkspaceUpdateSchema,
  approveRevenueOutreachDraft,
  deliverRevenueDeliveryWorkspaceFromTrustedApproval,
  runRevenueDailyScoutSprint,
  runRevenueScoutDispatch,
  runRevenuePublicScoutAgentCommand,
  runRevenueMoneySprintFromPublicCandidates,
  runRevenueAutomationAgentCommand,
  runRevenueMoneySprint,
  submitRevenueDailyScoutSprintEvidence,
  resetRevenueAgentRunsForTests,
  resetRevenueApprovalDecisionsForTests,
  resetRevenueAutomationIntakesForTests,
  resetRevenueAutomationOpportunitiesForTests,
  resetRevenueWebsiteOpportunitiesForTests,
  resetRevenueDailyScoutSprintsForTests,
  resetRevenueDeliveryWorkspacesForTests,
  resetRevenueImprovementReviewsForTests,
  resetRevenueLeadsForTests,
  resetRevenueLedgerForTests,
  resetRevenueOutreachForTests,
  resetRevenuePublicLeadCandidatesForTests,
  resetRevenueScoutingMissionsForTests,
  setRevenueAgentRunsPathForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenueAutomationIntakesPathForTests,
  setRevenueAutomationOpportunitiesPathForTests,
  setRevenueWebsiteOpportunitiesPathForTests,
  setRevenueDailyScoutSprintsPathForTests,
  setRevenueDeliveryWorkspacesPathForTests,
  setRevenueImprovementReviewsPathForTests,
  setRevenueLeadsPathForTests,
  setRevenueLedgerPathForTests,
  setRevenueOutreachPathForTests,
  setRevenuePublicLeadCandidatesPathForTests,
  setRevenueScoutingMissionsPathForTests,
  setRevenueOutreachSenderForTests,
  setRevenueEngineStateStoreForTests,
  sendRevenueOutreachDraft,
  setRevenueUserDataScope,
  updateRevenueDeliveryWorkspaceQa,
  extractRevenueMockupContentSecurityPolicy,
} from "../server/revenue-engine";
import { createRevenueEngineStateStore, type RevenueEngineStateAdapter, type RevenueEngineStateCollection } from "../server/revenue-engine-state-store";
import { updateRevenueOutreachDraft } from "../server/revenue-engine";
import { registerRoutes } from "../server/routes";

const testLedgerPath = path.join("/tmp", "revenue-engine-ledger-test.json");
const testLeadsPath = path.join("/tmp", "revenue-engine-leads-test.json");
const testOutreachPath = path.join("/tmp", "revenue-engine-outreach-test.json");
const testAgentRunsPath = path.join("/tmp", "revenue-engine-agent-runs-test.json");
const testApprovalDecisionsPath = path.join("/tmp", "revenue-engine-approval-decisions-test.json");
const testAutomationIntakesPath = path.join("/tmp", "revenue-engine-automation-intakes-test.json");
const testAutomationOpportunitiesPath = path.join("/tmp", "revenue-engine-automation-opportunities-test.json");
const testWebsiteOpportunitiesPath = path.join("/tmp", "revenue-engine-website-opportunities-test.json");
const testImprovementReviewsPath = path.join("/tmp", "revenue-engine-improvement-reviews-test.json");
const testScoutingMissionsPath = path.join("/tmp", "revenue-engine-scouting-missions-test.json");
const testDailyScoutSprintsPath = path.join("/tmp", "revenue-engine-daily-scout-sprints-test.json");
const testPublicLeadCandidatesPath = path.join("/tmp", "revenue-engine-public-lead-candidates-test.json");
const testDeliveryWorkspacesPath = path.join("/tmp", "revenue-engine-delivery-workspaces-test.json");
const testMockupsDir = path.join("/tmp", "revenue-engine-mockups-test");
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalRevenueEngineFromEmail = process.env.REVENUE_ENGINE_FROM_EMAIL;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
const originalRevenueMockupsDir = process.env.REVENUE_MOCKUPS_DIR;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalSessionSecret = process.env.SESSION_SECRET;
const testDatabaseUrl = "postgres://ceo_user:real-pass@db.internal:5432/blackops";

function createRevenueMemoryStateAdapter(beforeUpsert?: (input: { ownerUserId: string; kind: string; expectedRevision?: number }) => Promise<void>) {
  const rows = new Map<string, RevenueEngineStateCollection>();
  const adapter: RevenueEngineStateAdapter = {
    async initialize() {},
    async loadCollections(ownerUserId) {
      return [...rows.values()].filter((row) => row.ownerUserId === ownerUserId);
    },
    async upsertCollection(input) {
      await beforeUpsert?.(input);
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
  return { rows, adapter };
}

test.beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.NODE_ENV;
  delete process.env.SESSION_SECRET;
  delete process.env.RESEND_API_KEY;
  delete process.env.REVENUE_ENGINE_FROM_EMAIL;
  delete process.env.RESEND_FROM_EMAIL;
  process.env.REVENUE_MOCKUPS_DIR = testMockupsDir;
  setRevenueLedgerPathForTests(testLedgerPath);
  setRevenueLeadsPathForTests(testLeadsPath);
  setRevenueOutreachPathForTests(testOutreachPath);
  setRevenueAgentRunsPathForTests(testAgentRunsPath);
  setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);
  setRevenueAutomationIntakesPathForTests(testAutomationIntakesPath);
  setRevenueAutomationOpportunitiesPathForTests(testAutomationOpportunitiesPath);
  setRevenueWebsiteOpportunitiesPathForTests(testWebsiteOpportunitiesPath);
  setRevenueImprovementReviewsPathForTests(testImprovementReviewsPath);
  setRevenueScoutingMissionsPathForTests(testScoutingMissionsPath);
  setRevenueDailyScoutSprintsPathForTests(testDailyScoutSprintsPath);
  setRevenuePublicLeadCandidatesPathForTests(testPublicLeadCandidatesPath);
  setRevenueDeliveryWorkspacesPathForTests(testDeliveryWorkspacesPath);
  setRevenueOutreachSenderForTests(null);
  resetRevenueLedgerForTests();
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
  resetRevenueAgentRunsForTests();
  resetRevenueApprovalDecisionsForTests();
  resetRevenueAutomationIntakesForTests();
  resetRevenueAutomationOpportunitiesForTests();
  resetRevenueWebsiteOpportunitiesForTests();
  resetRevenueImprovementReviewsForTests();
  resetRevenueScoutingMissionsForTests();
  resetRevenueDailyScoutSprintsForTests();
  resetRevenuePublicLeadCandidatesForTests();
  resetRevenueDeliveryWorkspacesForTests();
});

test("scopes Revenue Engine JSON paths by authenticated user", () => {
  const portablePath = (value: string) => value.replace(/\\/g, "/");
  const paths = buildRevenueUserDataPaths("user@example.com/with spaces");

  assert.match(portablePath(paths.baseDir), /revenue_engine_data\/users\/user_example_com_with_spaces-[a-f0-9]{12}$/);
  assert.match(portablePath(paths.ledgerPath), /revenue_engine_data\/users\/user_example_com_with_spaces-[a-f0-9]{12}\/ledger\.json$/);

  setRevenueUserDataScope("owner-a");
  const scopedSnapshot = getRevenueEngineSnapshot();
  assert.match(portablePath(scopedSnapshot.persistence.path), /revenue_engine_data\/users\/owner-a-[a-f0-9]{12}\/ledger\.json$/);
  assert.match(portablePath(scopedSnapshot.persistence.leadsPath), /revenue_engine_data\/users\/owner-a-[a-f0-9]{12}\/leads\.json$/);
  assert.match(portablePath(scopedSnapshot.persistence.outreachPath), /revenue_engine_data\/users\/owner-a-[a-f0-9]{12}\/outreach\.json$/);
  assert.match(portablePath(scopedSnapshot.persistence.publicLeadCandidatesPath), /revenue_engine_data\/users\/owner-a-[a-f0-9]{12}\/public_lead_candidates\.json$/);
  assert.notEqual(buildRevenueDurableOwnerId("a/b"), buildRevenueDurableOwnerId("a_b"));
  assert.notEqual(
    buildRevenueDurableOwnerId(`${"same-prefix".repeat(20)}-a`),
    buildRevenueDurableOwnerId(`${"same-prefix".repeat(20)}-b`),
  );
});

test("hydrates and flushes Revenue Engine collections through durable storage", async () => {
  const memory = createRevenueMemoryStateAdapter();
  setRevenueEngineStateStoreForTests(createRevenueEngineStateStore(memory.adapter));
  process.env.DATABASE_URL = testDatabaseUrl;

  await prepareRevenueEngineState("durable-owner");
  const readySnapshot = getRevenueEngineSnapshot();
  assert.equal(readySnapshot.persistence.mode, "postgres");
  assert.equal(readySnapshot.persistence.durableStatus, "ready");
  assert.equal(readySnapshot.systemReadiness.items.find((item) => item.id === "production_persistence")?.status, "ready");

  recordRevenueLead({
    businessName: "Durable Lead",
    area: "Miami",
    niche: "med spa",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "owner@durable.example",
    evidence: "Public website has a broken booking path and a verified owner email.",
    painPoint: "Needs a reliable booking funnel and lead follow-up.",
    estimatedOfferUsd: 3500,
    status: "research",
  });
  await flushRevenueEnginePersistence();

  const storedLeads = memory.rows.get(`${buildRevenueDurableOwnerId("durable-owner")}:leads`)?.data as Array<{ businessName: string }>;
  assert.equal(storedLeads.some((lead) => lead.businessName === "Durable Lead"), true);
});

test("Revenue Engine API waits for durable flush before returning success", async () => {
  let releaseWrite!: () => void;
  let markWriteStarted!: () => void;
  const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
  const writeBarrier = new Promise<void>((resolve) => { releaseWrite = resolve; });
  let memory: ReturnType<typeof createRevenueMemoryStateAdapter>;
  memory = createRevenueMemoryStateAdapter(async (input) => {
    const key = `${input.ownerUserId}:${input.kind}`;
    if (input.kind === "leads" && memory.rows.has(key)) {
      markWriteStarted();
      await writeBarrier;
    }
  });
  setRevenueEngineStateStoreForTests(createRevenueEngineStateStore(memory.adapter));
  process.env.DATABASE_URL = testDatabaseUrl;

  const app = express();
  app.use(express.json());
  const server = createHttpServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    let responseSettled = false;
    const responsePromise = fetch(`http://127.0.0.1:${address.port}/api/revenue-engine/leads`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "flush-owner" },
      body: JSON.stringify({
        businessName: "Flush Protected Lead",
        area: "Miami",
        niche: "med spa",
        websiteStatus: "weak_website",
        contactChannel: "email",
        contactValue: "owner@flush.example",
        evidence: "Public site has a broken booking flow and a verified contact email.",
        painPoint: "Needs a reliable booking funnel.",
        estimatedOfferUsd: 3500,
        status: "research",
      }),
    }).then((response) => {
      responseSettled = true;
      return response;
    });

    await writeStarted;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(responseSettled, false);
    releaseWrite();
    const response = await responsePromise;
    assert.equal(response.status, 200);
    const body = await response.json() as { lead?: { businessName?: string } };
    assert.equal(body.lead?.businessName, "Flush Protected Lead");
  } finally {
    releaseWrite();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Revenue Engine API does not return success when durable flush fails", async () => {
  let memory: ReturnType<typeof createRevenueMemoryStateAdapter>;
  memory = createRevenueMemoryStateAdapter(async (input) => {
    const key = `${input.ownerUserId}:${input.kind}`;
    if (input.kind === "leads" && memory.rows.has(key)) {
      throw new Error("durable database unavailable");
    }
  });
  setRevenueEngineStateStoreForTests(createRevenueEngineStateStore(memory.adapter));
  process.env.DATABASE_URL = testDatabaseUrl;

  const app = express();
  app.use(express.json());
  const server = createHttpServer(app);
  await registerRoutes(server, app);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(503).json({ error: error.message });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/revenue-engine/leads`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "flush-failure-owner" },
      body: JSON.stringify({
        businessName: "Rejected Durable Lead",
        area: "Miami",
        niche: "med spa",
        websiteStatus: "weak_website",
        contactChannel: "email",
        contactValue: "owner@rejected.example",
        evidence: "Public site has a broken booking flow and a verified contact email.",
        painPoint: "Needs a reliable booking funnel.",
        estimatedOfferUsd: 3500,
        status: "research",
      }),
    });
    assert.equal(response.status, 503);
    const body = await response.json() as { error?: string; lead?: unknown };
    assert.match(body.error || "", /durable write failed/);
    assert.equal(body.lead, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("durable bootstrap refuses to seed Postgres from invalid local state", async () => {
  const memory = createRevenueMemoryStateAdapter();
  setRevenueEngineStateStoreForTests(createRevenueEngineStateStore(memory.adapter));
  process.env.DATABASE_URL = testDatabaseUrl;
  const userId = `invalid-local-owner-${Date.now()}`;
  const paths = buildRevenueUserDataPaths(userId);
  mkdirSync(paths.baseDir, { recursive: true });
  writeFileSync(paths.leadsPath, "{not-valid-json", "utf8");

  try {
    await assert.rejects(prepareRevenueEngineState(userId), /local migration blocked/);
    const durable = getRevenueEngineDurablePersistenceStatus();
    assert.equal(durable.status, "error");
    assert.match(durable.error || "", /Expected property name|Unexpected token/);
    assert.equal(memory.rows.has(`${buildRevenueDurableOwnerId(userId)}:leads`), false);
  } finally {
    rmSync(paths.baseDir, { recursive: true, force: true });
  }
});

test.afterEach(() => {
  setRevenueEngineStateStoreForTests(null);
  if (originalResendApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalResendApiKey;
  if (originalRevenueEngineFromEmail === undefined) delete process.env.REVENUE_ENGINE_FROM_EMAIL;
  else process.env.REVENUE_ENGINE_FROM_EMAIL = originalRevenueEngineFromEmail;
  if (originalResendFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = originalResendFromEmail;
  if (originalRevenueMockupsDir === undefined) delete process.env.REVENUE_MOCKUPS_DIR;
  else process.env.REVENUE_MOCKUPS_DIR = originalRevenueMockupsDir;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});

function sellWebsiteOpportunityForTest(input: {
  leadId: string;
  outreachDraftId: string;
  projectType?: "website" | "bundle";
  cashCollectedUsd?: number;
}) {
  const opportunityResult = recordRevenueWebsiteOpportunity({
    leadId: input.leadId,
    outreachDraftId: input.outreachDraftId,
    projectType: input.projectType || "bundle",
  });
  assert.equal(opportunityResult.status, "quoted");
  assert.ok(opportunityResult.opportunity);

  const cashCollectedUsd = input.cashCollectedUsd ?? opportunityResult.opportunity.requiredDepositUsd;
  const depositOutcome = recordRevenueOutreachOutcome({
    draftId: input.outreachDraftId,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd,
    paymentConfirmation: "Stripe pi_test_sale_123",
    notes: "Robert confirmed deposit for test sale.",
  });
  assert.equal(depositOutcome.status, "recorded");

  const closeResult = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd,
    paymentConfirmation: "Stripe pi_test_sale_123",
  });
  assert.equal(closeResult.status, "sold");
  assert.ok(closeResult.opportunity);
  return closeResult.opportunity;
}

function createApprovedWebsiteDraftForTest(input: {
  businessName: string;
  contactEmail: string;
  sourceUrl: string;
  mockupSlug: string;
  estimatedInternalMonthlyCostUsd?: number;
}) {
  const leadResult = recordRevenueLead({
    businessName: input.businessName,
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: input.contactEmail,
    evidence: "Public listing has no website, recent menu photos and a verified owner email.",
    painPoint: "Needs a dedicated menu website and simple inquiry capture.",
    estimatedOfferUsd: 1800,
    status: "qualified",
  });
  const draftResult = recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: input.contactEmail,
    contactName: "Owner",
    businessName: input.businessName,
    sourceUrl: input.sourceUrl,
    mockupUrl: `/api/revenue-engine/mockup-previews/${input.mockupSlug}`,
    businessSummary: `${input.businessName} has public no-website evidence and needs a dedicated menu website.`,
    websitePriceUsd: 1500,
    automationPriceUsd: 0,
    monthlyRetainerUsd: 300,
    estimatedInternalMonthlyCostUsd: input.estimatedInternalMonthlyCostUsd ?? 40,
    notes: "Draft only; no outreach sent.",
  });

  assert.equal(draftResult.draft.status, "approved");
  return { lead: leadResult.lead, draft: draftResult.draft };
}

function createSoldWebsiteWorkspaceForTest(input: {
  businessName: string;
  contactEmail: string;
  sourceUrl: string;
  mockupSlug: string;
  projectType?: "website" | "bundle";
  cashCollectedUsd?: number;
}) {
  const { lead, draft } = createApprovedWebsiteDraftForTest(input);
  const opportunity = sellWebsiteOpportunityForTest({
    leadId: lead.id,
    outreachDraftId: draft.id,
    projectType: input.projectType || "website",
    cashCollectedUsd: input.cashCollectedUsd,
  });
  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.id,
    outreachDraftId: draft.id,
    websiteOpportunityId: opportunity.id,
    projectType: input.projectType || "website",
    repoFullName: `robert/${input.mockupSlug}`,
    branchName: `codex/client-${input.mockupSlug}-website`,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: input.cashCollectedUsd ?? opportunity.requiredDepositUsd,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  assert.equal(handoff.status, "created");
  assert.ok(handoff.workspace);
  return { lead, draft, opportunity, workspace: handoff.workspace };
}

test("caps lead plan spend at the starting monthly budget", () => {
  const plan = buildRevenueEnginePlan({
    area: "Miami",
    niche: "restaurants",
    offerFocus: "both",
    monthlyBudgetUsd: 250,
    leadCount: 50,
  });

  assert.equal(plan.budget.monthlyCapUsd, 100);
  assert.equal(plan.budget.isInsideCap, true);
});

test("keeps a zero-budget lead plan entirely free", () => {
  const plan = buildRevenueEnginePlan({
    area: "Miami",
    niche: "med spas",
    offerFocus: "both",
    monthlyBudgetUsd: 0,
    leadCount: 10,
  });

  assert.equal(plan.budget.monthlyCapUsd, 0);
  assert.equal(plan.budget.estimatedFirstBatchUsd, 0);
  assert.equal(plan.budget.remainingBudgetUsd, 0);
  assert.equal(plan.budget.isInsideCap, true);
  assert.equal(plan.budget.mode, "free_public_research");
});

test("builds a no-website scouting mission with approval gates", () => {
  const mission = buildRevenueScoutingMission({
    area: "Miami",
    niche: "med spas",
    offerFocus: "both",
    targetLeadCount: 40,
    maxPaidDataSpendUsd: 0,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });

  assert.equal(mission.mission.mode, "free_public_research");
  assert.equal(mission.mission.leadBatchSize, 25);
  assert.equal(mission.budgetGate.monthlyCapUsd, 100);
  assert.equal(mission.budgetGate.requiresApprovalToSpend, false);
  assert.equal(mission.budgetGate.blockedBeforeApproval.includes("send email"), true);
  assert.equal(mission.searchQueries.some((query) => query.includes("Miami")), true);
  assert.equal(mission.qualificationScorecard.some((item) => item.item === "No website or weak website signal"), true);
  assert.equal(mission.subagentReviews.some((review) => review.agent === "qa-council"), true);
});

test("caps paid scouting spend and requires approval", () => {
  const mission = buildRevenueScoutingMission({
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    targetLeadCount: 80,
    maxPaidDataSpendUsd: 140,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: false,
  });

  assert.equal(mission.budgetGate.approvedPaidDataSpendUsd, 100);
  assert.equal(mission.budgetGate.requiresApprovalToSpend, true);
  assert.equal(mission.mission.mode, "paid_data_requires_approval");
  assert.equal(mission.mission.leadBatchSize, 50);
  assert.equal(mission.nextActions.some((action) => action.includes("80")), false);
});

test("records and persists scouting missions as batch memory", () => {
  const result = recordRevenueScoutingMission({
    area: "Miami",
    niche: "med spas",
    offerFocus: "both",
    targetLeadCount: 25,
    maxPaidDataSpendUsd: 0,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });

  assert.equal(result.mission.status, "ready_for_leads");
  assert.equal(result.mission.learningNote.includes("research publico gratis"), true);
  assert.equal(result.snapshot.recentScoutingMissions[0].mission.area, "Miami");
  assert.equal(result.snapshot.persistence.scoutingMissionsStatus, "ok");

  setRevenueScoutingMissionsPathForTests(testScoutingMissionsPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentScoutingMissions.length, 1);
  assert.equal(snapshot.recentScoutingMissions[0].mission.niche, "med spas");
});

test("snapshot exposes a public business scout queue before money sprint runs", () => {
  const initial = getRevenueEngineSnapshot();

  assert.equal(initial.businessScoutQueue.status, "ready");
  assert.equal(initial.businessScoutQueue.source, "default_market");
  assert.equal(initial.businessScoutQueue.tasks.length > 0, true);
  assert.equal(initial.businessScoutQueue.safety.sendsOutreach, false);
  assert.equal(initial.businessScoutQueue.safety.persistsCandidates, false);
  assert.match(initial.businessScoutQueue.workPack.copyableBatchTemplate, /business\|area\|niche/);
  assert.equal(initial.businessScoutQueue.workPack.searchPlaybook.prioritizedSources.length, 3);
  assert.equal(initial.businessScoutQueue.workPack.searchPlaybook.opportunitySignals.some((signal) => signal.includes("no website")), true);
  assert.equal(initial.businessScoutQueue.workPack.searchPlaybook.dailyOperatingCadence.some((step) => step.includes("Money Sprint preview")), true);
  assert.match(initial.businessScoutQueue.workPack.searchPlaybook.copyableBrief, /public business search playbook/);
  assert.match(initial.businessScoutQueue.workPack.searchPlaybook.copyableBrief, /Do not contact businesses before Robert approval/);
  assert.equal(initial.dailyMoneyCommand.status, "search");
  assert.match(initial.dailyMoneyCommand.primaryAction, /Buscar negocios publicos/);
  assert.equal(initial.dailyMoneyCommand.funnel.researchTarget, initial.businessScoutQueue.dailyResearchTarget);
  assert.equal(initial.dailyMoneyCommand.runPacket.status, "search");
  assert.equal(initial.dailyMoneyCommand.runPacket.apiAction, "/api/revenue-engine/scout-dispatch");
  assert.match(initial.dailyMoneyCommand.runPacket.output, /connector intake JSON/);
  assert.match(initial.dailyMoneyCommand.runPacket.gate, /needs_review/);
  const initialSearchRequest = JSON.parse(initial.dailyMoneyCommand.runPacket.copyableApiRequest);
  assert.equal(initialSearchRequest.area, initial.businessScoutQueue.area);
  assert.equal(initialSearchRequest.niche, initial.businessScoutQueue.niche);
  assert.equal(initialSearchRequest.maxPaidDataSpendUsd, 0);
  assert.equal(initialSearchRequest.requireRobertApprovalToContact, true);
  assert.match(initial.dailyMoneyCommand.runPacket.copyableRunPacket, /Revenue Engine next run packet/);
  assert.match(initial.dailyMoneyCommand.runPacket.copyableRunPacket, /Copyable API request/);
  assert.match(initial.dailyMoneyCommand.runPacket.copyableRunPacket, /scout dispatch: public research only/);
  assert.match(initial.dailyMoneyCommand.runPacket.copyableRunPacket, /Do not auto-send outreach/);
  assert.equal(initial.dailyMoneyCommand.safety.sendsOutreach, false);
  assert.equal(initial.dailyMoneyCommand.safety.spendsMoney, false);
  assert.equal(initial.dailyMoneyCommand.safety.deploys, false);

  recordRevenueScoutingMission({
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    targetLeadCount: 18,
    maxPaidDataSpendUsd: 0,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });
  const updated = getRevenueEngineSnapshot();

  assert.equal(updated.businessScoutQueue.source, "latest_scouting_mission");
  assert.equal(updated.businessScoutQueue.area, "Orlando");
  assert.equal(updated.businessScoutQueue.niche, "roofers");
  assert.equal(updated.businessScoutQueue.offerFocus, "websites");
  assert.equal(updated.businessScoutQueue.tasks.some((task) => task.query.includes("roofers")), true);
  assert.equal(updated.businessScoutQueue.workPack.searchPlaybook.prioritizedSources.some((source) => source.query.includes("roofers Orlando")), true);
  assert.match(updated.businessScoutQueue.workPack.searchPlaybook.copyableBrief, /Market: Orlando/);
  assert.match(updated.dailyMoneyCommand.copyableOperatorBrief, /Revenue Engine daily money command/);
  assert.match(updated.dailyMoneyCommand.copyableOperatorBrief, /Next run packet/);
});

test("business scout queue handles minimum-size scouting missions without snapshot crash", () => {
  recordRevenueScoutingMission({
    area: "Tampa",
    niche: "med spas",
    offerFocus: "both",
    targetLeadCount: 5,
    maxPaidDataSpendUsd: 0,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.businessScoutQueue.area, "Tampa");
  assert.equal(snapshot.businessScoutQueue.dailyResearchTarget, 10);
  assert.equal(snapshot.businessScoutQueue.tasks.length >= 3, true);
  assert.equal(snapshot.businessScoutQueue.safety.persistsCandidates, false);
  assert.match(snapshot.businessScoutQueue.nextAction, /Start daily scout sprint/);
});

test("starts and persists a daily scout sprint without creating candidates, leads or outreach", () => {
  recordRevenueScoutingMission({
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    targetLeadCount: 10,
    maxPaidDataSpendUsd: 0,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });

  const result = runRevenueDailyScoutSprint({
    maxTasks: 5,
    resultSlotsPerTask: 2,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "started");
  assert.equal(result.sprint.source, "latest_scouting_mission");
  assert.equal(result.sprint.area, "Orlando");
  assert.equal(result.sprint.niche, "roofers");
  assert.equal(result.sprint.status, "open");
  assert.equal(result.sprint.tasks.length, 3);
  assert.equal(result.sprint.targetRows, 6);
  assert.equal(result.sprint.tasks.every((task) => task.resultSlots.length === 2), true);
  assert.match(result.sprint.tasks[0].resultSlots[0].copyableEvidenceBlock, /Business:/);
  assert.match(result.sprint.agentBriefs[0].copyableBrief, /Do not contact businesses/);
  assert.equal(result.safety.persistsScoutRun, true);
  assert.equal(result.safety.persistsCandidates, false);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.spendsMoney, false);
  assert.equal(result.safety.deploys, false);
  assert.equal(snapshot.latestDailyScoutSprint?.id, result.sprint.id);
  assert.equal(snapshot.recentDailyScoutSprints.length, 1);
  assert.equal(snapshot.recentPublicLeadCandidates.length, 0);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
  assert.equal(existsSync(testDailyScoutSprintsPath), true);
});

test("dispatches scout agents without creating candidates leads outreach or spend", () => {
  const result = runRevenueScoutDispatch({
    area: "Tampa",
    niche: "dentists",
    offerFocus: "websites",
    targetLeadCount: 8,
    maxTasks: 4,
    resultSlotsPerTask: 2,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "dispatch_ready");
  assert.equal(result.dispatch.mode, "manual_subagent_dispatch");
  assert.equal(result.dispatch.executionMode, "manual_evidence_required");
  assert.match(result.dispatch.blockedUntil, /public evidence is pasted and verified/);
  assert.match(result.dispatch.requiredExecutionBridge, /public-search\/browser scout/);
  assert.equal(result.dispatch.readyToAssign, true);
  assert.equal(result.sprint.dispatchMode, "manual_subagent_dispatch");
  assert.equal(result.sprint.executionMode, "manual_evidence_required");
  assert.match(result.sprint.blockedUntil || "", /verified public-search scout connector/);
  assert.match(result.sprint.requiredExecutionBridge || "", /stores candidates as needs_review/);
  assert.match(result.sprint.dispatchSummary || "", /agents/);
  assert.equal(result.dispatch.taskCount, result.sprint.tasks.length);
  assert.equal(result.dispatch.slotCount, result.sprint.tasks.reduce((total, task) => total + task.resultSlots.length, 0));
  assert.equal(result.dispatch.agentAssignments.length, result.dispatch.agentCount);
  assert.match(result.dispatch.copyableDispatchBrief, /Revenue Engine scout dispatch/);
  assert.match(result.dispatch.copyableDispatchBrief, /does not autonomously browse or prove businesses/);
  assert.match(result.dispatch.copyableDispatchBrief, /Required bridge/);
  assert.match(result.dispatch.copyableDispatchBrief, /Preferred structured return path/);
  assert.match(result.dispatch.copyableDispatchBrief, /\/api\/revenue-engine\/public-scout-connector-intake/);
  assert.match(result.dispatch.copyableDispatchBrief, /Do not contact businesses/);
  assert.equal(result.dispatch.connectorIntake.endpoint, "/api/revenue-engine/public-scout-connector-intake");
  assert.equal(result.dispatch.connectorIntake.executionMode, "verified_connector_review_only");
  assert.equal(result.dispatch.connectorIntake.maxResults, 20);
  assert.equal(result.dispatch.connectorIntake.approvalLocked, true);
  assert.match(result.dispatch.connectorIntake.copyablePayloadTemplate, /"connectorRunId"/);
  assert.match(result.dispatch.connectorIntake.copyablePayloadTemplate, /"results"/);
  assert.match(result.dispatch.connectorIntake.copyableBrief, /\/api\/revenue-engine\/public-scout-connector-intake/);
  assert.match(result.dispatch.connectorIntake.copyableBrief, /needs_review/);
  assert.match(result.dispatch.connectorIntake.copyableBrief, /Do not contact/);
  assert.match(result.dispatch.connectorIntake.copyableBrief, /Do not set publicEvidenceVerified, approvalToImport or approvedByRobert/);
  assert.equal(result.dispatch.connectorIntake.workOrders.length, result.sprint.tasks.length);
  assert.match(result.dispatch.connectorIntake.copyableWorkOrders, /Revenue scout connector work order/);
  assert.match(result.dispatch.connectorIntake.copyableWorkOrders, /Source agent:/);
  assert.match(result.dispatch.connectorIntake.copyableWorkOrders, /Source query:/);
  assert.match(result.dispatch.connectorIntake.copyableWorkOrders, /Copyable subagent command:/);
  assert.match(result.dispatch.connectorIntake.copyableWorkOrders, /Do not contact businesses, buy data, scrape at scale/);
  assert.match(result.dispatch.connectorIntake.copyableSubagentCommands, /Revenue Engine public business scout subagent command/);
  assert.match(result.dispatch.connectorIntake.copyableSubagentCommands, /Return format:/);
  assert.match(result.dispatch.connectorIntake.copyableSubagentCommands, /ready for POST \/api\/revenue-engine\/public-scout-connector-intake/);
  assert.match(result.dispatch.connectorIntake.copyableSubagentCommands, /Do not:\n- Contact businesses/);
  assert.match(result.dispatch.connectorIntake.copyableSubagentCommands, /Invent or fabricate businesses, sources, contact paths, evidence, screenshots, claims or URLs/);
  assert.match(result.dispatch.connectorIntake.copyableSubagentCommands, /publicEvidenceVerified, approvalToImport or approvedByRobert/);
  assert.equal(result.dispatch.connectorIntake.workOrders[0].endpoint, "/api/revenue-engine/public-scout-connector-intake");
  assert.equal(result.dispatch.connectorIntake.workOrders[0].taskId, result.sprint.tasks[0].taskId);
  assert.equal(result.dispatch.connectorIntake.workOrders[0].sourceAgent, result.sprint.tasks[0].ownerAgent);
  assert.equal(result.dispatch.connectorIntake.workOrders[0].sourceQuery, result.sprint.tasks[0].query);
  assert.match(result.dispatch.connectorIntake.workOrders[0].copyableSubagentCommand, new RegExp(result.sprint.tasks[0].taskId));
  assert.match(result.dispatch.connectorIntake.workOrders[0].copyableSubagentCommand, /No placeholders remain in completed result rows/);
  assert.equal(result.dispatch.connectorIntake.workOrders[0].payload.sourceTaskId, result.sprint.tasks[0].taskId);
  assert.equal(result.dispatch.connectorIntake.workOrders[0].payload.publicEvidenceVerified, undefined);
  assert.equal(result.dispatch.connectorIntake.workOrders[0].payload.approvalToImport, undefined);
  assert.equal(result.dispatch.connectorIntake.workOrders[0].payload.approvedByRobert, undefined);
  assert.equal(result.dispatch.connectorIntake.workOrders[0].payload.results.length, result.sprint.tasks[0].resultSlots.length);
  assert.equal(result.dispatch.connectorIntake.workOrders[0].resultSlotIds.length, result.sprint.tasks[0].resultSlots.length);
  assert.equal(result.safety.persistsScoutRun, true);
  assert.equal(result.safety.persistsCandidates, false);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.spendsMoney, false);
  assert.equal(result.safety.deploys, false);
  assert.equal(snapshot.latestDailyScoutSprint?.id, result.sprint.id);
  assert.equal(snapshot.latestDailyScoutSprint?.dispatchMode, "manual_subagent_dispatch");
  assert.equal(snapshot.latestDailyScoutSprint?.executionMode, "manual_evidence_required");
  assert.match(snapshot.latestDailyScoutSprint?.blockedUntil || "", /public evidence is pasted/);
  assert.match(snapshot.latestDailyScoutSprint?.dispatchSummary || "", /public evidence slots/);
  assert.equal(result.snapshot.latestDailyScoutSprint?.id, result.sprint.id);
  assert.equal(result.snapshot.latestDailyScoutSprint?.dispatchMode, "manual_subagent_dispatch");
  assert.equal(result.snapshot.latestDailyScoutSprint?.executionMode, "manual_evidence_required");
  assert.match(result.snapshot.latestDailyScoutSprint?.requiredExecutionBridge || "", /bounded public-search/);
  assert.match(result.snapshot.latestDailyScoutSprint?.dispatchSummary || "", /public evidence slots/);
  assert.equal(snapshot.recentPublicLeadCandidates.length, 0);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("daily scout sprint rejects paid spend and string false contact approval", () => {
  assert.throws(
    () => runRevenueDailyScoutSprint({
      maxPaidDataSpendUsd: 1,
      requireRobertApprovalToContact: true,
    }),
    /Number must be less than or equal to 0/,
  );
  assert.throws(
    () => runRevenueDailyScoutSprint({
      maxPaidDataSpendUsd: 0,
      requireRobertApprovalToContact: "false",
    } as Parameters<typeof runRevenueDailyScoutSprint>[0]),
    /Invalid literal value/,
  );
  assert.equal(getRevenueEngineSnapshot().recentDailyScoutSprints.length, 0);
});

test("public scout intake blocks unfilled daily scout placeholders", () => {
  const sprint = runRevenueDailyScoutSprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    targetLeadCount: 10,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
  });

  const result = recordRevenuePublicScoutEvidence({
    area: sprint.sprint.area,
    niche: sprint.sprint.niche,
    evidenceText: sprint.sprint.tasks[0].resultSlots[0].copyableEvidenceBlock,
    sourceTaskId: sprint.sprint.id,
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    defaultOfferUsd: 3500,
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.recordedCount, 0);
  assert.equal(result.importableCount, 0);
  assert.equal(result.blockedCount, 1);
  assert.match(result.blockedSeeds[0].reason, /placeholder fields/);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(result.snapshot.recentPublicLeadCandidates.length, 0);
  assert.equal(result.snapshot.recentLeads.length, 0);
});

test("public scout intake accepts valid Spanish evidence containing todo", () => {
  const result = recordRevenuePublicScoutEvidence({
    area: "Miami",
    niche: "coffee shop",
    evidenceText: [
      "Business: Cafecito Coral",
      "Area: Miami",
      "Niche: coffee shop",
      "Website: no website",
      "Contact: @cafecitocoral",
      "Email: owner@cafecitocoral.example",
      "Source: https://instagram.com/cafecitocoral",
      "Evidence: Todo el menu esta en posts publicos de Instagram, la bio no muestra website dedicado y hay actividad reciente.",
      "Pain: Necesita menu online, reservas de catering y seguimiento.",
    ].join("\n"),
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    defaultOfferUsd: 3500,
  });

  assert.equal(result.status, "ready_for_preview");
  assert.equal(result.importableCount, 1);
  assert.equal(result.blockedCount, 0);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 1);
});

test("public scout intake cannot import without explicit Robert approval", () => {
  const result = recordRevenuePublicScoutEvidence({
    area: "Miami",
    niche: "coffee shop",
    evidenceText: [
      "Business: Approval Gate Cafe",
      "Area: Miami",
      "Niche: coffee shop",
      "Website: no website",
      "Contact: @approvalgatecafe",
      "Email: owner@approvalgate.example",
      "Source: https://instagram.com/approvalgatecafe",
      "Evidence: Public Instagram profile has recent menu posts, no dedicated website link and a visible contact path.",
      "Pain: Needs online menu, catering inquiries and follow-up.",
    ].join("\n"),
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    defaultOfferUsd: 3500,
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.importableCount, 0);
  assert.equal(result.recorded[0].candidate.importReady, false);
  assert.equal(result.recorded[0].candidate.blockedReasons.includes("approvedByRobert false"), true);
  assert.match(result.normalizedBatchText, /public_candidate_review_gate=needs_review/);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 0);
});

test("daily scout sprint submit records candidates and updates slot progress", () => {
  const sprint = runRevenueDailyScoutSprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    targetLeadCount: 6,
    maxTasks: 3,
    resultSlotsPerTask: 1,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
  });
  const taskId = sprint.sprint.tasks[0].taskId;

  const result = submitRevenueDailyScoutSprintEvidence({
    sprintId: sprint.sprint.id,
    taskId,
    area: "Miami",
    niche: "coffee shop",
    evidenceText: [
      "Business: Sprint Slot Cafe",
      "Area: Miami",
      "Niche: coffee shop",
      "Website: no website",
      "Contact: @sprintslotcafe",
      "Email: owner@sprintslotcafe.example",
      "Source: https://instagram.com/sprintslotcafe",
      "Evidence: Public Instagram profile has active menu posts, no dedicated website link and a visible contact path.",
      "Pain: Needs online menu, catering capture and follow-up.",
    ].join("\n"),
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    defaultOfferUsd: 3500,
    maxCandidates: 1,
  });

  const updatedSprint = result.snapshot.latestDailyScoutSprint;

  assert.equal(result.status, "submitted");
  assert.equal(result.evidenceResult?.importableCount, 1);
  assert.equal(result.sprintProgress?.sprintId, sprint.sprint.id);
  assert.equal(result.sprintProgress?.taskId, taskId);
  assert.equal(result.sprintProgress?.filledSlots, 1);
  assert.equal(result.sprintProgress?.newlyFilledSlots, 1);
  assert.equal(updatedSprint?.tasks[0].status, "submitted");
  assert.equal(updatedSprint?.tasks[0].resultSlots[0].status, "filled");
  assert.equal(updatedSprint?.status, "open");
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 1);
  assert.equal(result.snapshot.recentLeads.length, 0);
  assert.equal(result.snapshot.recentOutreach.length, 0);

  const duplicateSubmit = submitRevenueDailyScoutSprintEvidence({
    sprintId: sprint.sprint.id,
    taskId,
    area: "Miami",
    niche: "coffee shop",
    evidenceText: [
      "Business: Duplicate Slot Cafe",
      "Area: Miami",
      "Niche: coffee shop",
      "Website: no website",
      "Contact: @duplicateslotcafe",
      "Email: owner@duplicateslotcafe.example",
      "Source: https://instagram.com/duplicateslotcafe",
      "Evidence: Public Instagram profile has active menu posts, no dedicated website link and a visible contact path.",
      "Pain: Needs online menu, catering capture and follow-up.",
    ].join("\n"),
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    defaultOfferUsd: 3500,
    maxCandidates: 1,
  });

  assert.equal(duplicateSubmit.status, "blocked");
  assert.match(duplicateSubmit.reason, /no tiene slots abiertos/);
  assert.equal(duplicateSubmit.snapshot.publicLeadImportQueue.readyCount, 1);

  const duplicateDifferentTask = submitRevenueDailyScoutSprintEvidence({
    sprintId: sprint.sprint.id,
    taskId: sprint.sprint.tasks[1].taskId,
    area: "Miami",
    niche: "coffee shop",
    evidenceText: [
      "Business: Sprint Slot Cafe",
      "Area: Miami",
      "Niche: coffee shop",
      "Website: no website",
      "Contact: @sprintslotcafe",
      "Email: owner@sprintslotcafe.example",
      "Source: https://instagram.com/sprintslotcafe",
      "Evidence: Public Instagram profile has active menu posts, no dedicated website link and a visible contact path.",
      "Pain: Needs online menu, catering capture and follow-up.",
    ].join("\n"),
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    defaultOfferUsd: 3500,
    maxCandidates: 1,
  });

  assert.equal(duplicateDifferentTask.status, "needs_review");
  assert.match(duplicateDifferentTask.reason, /ya estaba registrado/);
  assert.equal(duplicateDifferentTask.sprintProgress?.filledSlots, 1);
  assert.equal(duplicateDifferentTask.sprintProgress?.newlyFilledSlots, 0);
  assert.equal(duplicateDifferentTask.snapshot.latestDailyScoutSprint?.tasks[1].resultSlots[0].status, "open");
  assert.equal(duplicateDifferentTask.snapshot.publicLeadImportQueue.readyCount, 1);
});

test("money sprint preview blocks unfilled scout batch templates", () => {
  const snapshot = getRevenueEngineSnapshot();
  const result = previewRevenueMoneySprintSeeds({
    area: snapshot.businessScoutQueue.area,
    niche: snapshot.businessScoutQueue.niche,
    offerFocus: snapshot.businessScoutQueue.offerFocus,
    dailyResearchTarget: 25,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 5,
    dailyContactLimit: 10,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeadBatchText: snapshot.businessScoutQueue.workPack.copyableBatchTemplate,
  });

  assert.equal(result.status, "empty");
  assert.equal(result.totals.accepted, 0);
  assert.equal(result.blockedSeeds.length > 0, true);
  assert.match(result.blockedSeeds[0].reason, /placeholder fields/);
  assert.equal(getRevenueEngineSnapshot().recentLeads.length, 0);
  assert.equal(getRevenueEngineSnapshot().recentOutreach.length, 0);
});

test("daily money command prioritizes verified public candidates before more searching", () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  recordRevenuePublicLeadCandidateBatch({
    source: "google_maps",
    area: "Miami",
    niche: "restaurants",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    batchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      "Daily Command Cafe|Miami|restaurants|no_website|email|owner@dailycommand.example|https://example.com/daily-command-cafe|owner@dailycommand.example|Public listing has no website and recent owner-managed menu updates.|Needs mobile menu and catering lead capture.|4200|Owner|Owner-operated and visible demand.",
    ].join("\n"),
    candidates: [{
      businessName: "Daily Command Cafe",
      websiteStatus: "no_website",
      contactChannel: "email",
      contactValue: "owner@dailycommand.example",
      sourceUrl: "https://example.com/daily-command-cafe",
      publicEvidence: "Public listing has no website and recent owner-managed menu updates.",
      painPoint: "Needs mobile menu and catering lead capture.",
      estimatedOfferUsd: 4200,
      qualificationNotes: "Owner-operated and visible demand.",
    }],
  });

  const snapshot = getRevenueEngineSnapshot();
  assert.equal(snapshot.publicLeadImportQueue.readyCount, 1);
  assert.equal(snapshot.dailyMoneyCommand.status, "sprint");
  assert.match(snapshot.dailyMoneyCommand.primaryAction, /Money Sprint/);
  assert.equal(snapshot.dailyMoneyCommand.funnel.candidatesReady, 1);
  assert.equal(snapshot.dailyMoneyCommand.steps.find((step) => step.id === "import")?.status, "ready");
  const sprintRequest = revenueMoneySprintFromPublicCandidatesSchema.parse(JSON.parse(snapshot.dailyMoneyCommand.runPacket.copyableApiRequest));
  assert.deepEqual(sprintRequest.candidateIds, [snapshot.publicLeadImportQueue.items[0].candidateId]);
  assert.equal(sprintRequest.area, "Miami");
  assert.equal(sprintRequest.niche, "restaurants");
  assert.doesNotMatch(snapshot.dailyMoneyCommand.runPacket.copyableApiRequest, /REPLACE_WITH_VERIFIED_PUBLIC_CANDIDATE_IDS/);
});

test("builds an always-on lead radar with contact and mockup limits", () => {
  const radar = buildRevenueLeadRadar({
    area: "Miami",
    niches: "med spas, gyms, restaurants",
    offerFocus: "both",
    runHoursPerDay: 24,
    dailyResearchTarget: 120,
    dailyQualifiedLeadLimit: 36,
    dailyMockupLimit: 8,
    dailyContactLimit: 10,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
  });

  assert.equal(radar.status, "always_on_ready");
  assert.equal(radar.operatingMode.researchRunsAllDay, true);
  assert.equal(radar.operatingMode.contactMode, "draft_only");
  assert.equal(radar.dailyLimits.researchPerHour, 5);
  assert.equal(radar.dailyLimits.qualifiedPerHour, 2);
  assert.equal(radar.dailyLimits.mockupLimit, 8);
  assert.equal(radar.dailyLimits.contactLimit, 10);
  assert.equal(radar.dailyLimits.monthlySpendCapUsd, 100);
  assert.equal(radar.channelMix[0].channel.includes("Google Maps"), true);
  assert.equal(radar.mockupPolicy.whoCreatesMockups.includes("Codex"), true);
  assert.equal(radar.recommendation.includes("Buscar leads puede correr 24/7"), true);
});

test("records verified public lead candidates as previewable batch rows without outreach", () => {
  recordRevenuePublicLeadCandidate({
    businessName: "Older Orlando Roof",
    area: "Orlando",
    niche: "roofers",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@olderroof.example",
    sourceUrl: "https://example.com/older-roof",
    recipientEmail: "owner@olderroof.example",
    evidence: "Public listing has no website, recent roofing photos and verified contact path.",
    painPoint: "Needs storm repair lead capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "research",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });
  const result = recordRevenuePublicLeadCandidate({
    businessName: "Public Scout Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@publicscout.example",
    sourceUrl: "https://example.com/public-scout-cafe",
    recipientEmail: "owner@publicscout.example",
    evidence: "Google listing has no website, public social profile has menu photos and verified contact path.",
    painPoint: "Needs online menu capture, catering inquiries and follow-up.",
    estimatedOfferUsd: 3600,
    status: "research",
    contactName: "Owner",
    businessSummary: "Public Scout Cafe is a verified no-website coffee shop candidate with a visible public contact path.",
    sourceTaskId: "scout-task-01",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "ready_for_preview");
  assert.equal(result.candidate.importReady, true);
  assert.equal(result.importableCount, 1);
  assert.match(result.importBatchText, /Public Scout Cafe/);
  assert.doesNotMatch(result.importBatchText, /Older Orlando Roof/);
  assert.equal(result.importBatchText.split("\n").length, 2);
  assert.equal(result.candidate.safety.persistsLead, false);
  assert.equal(result.candidate.safety.sendsOutreach, false);
  assert.equal(snapshot.recentPublicLeadCandidates[0].businessName, "Public Scout Cafe");
  assert.equal(snapshot.publicLeadImportQueue.readyCount, 2);
  assert.equal(snapshot.publicLeadImportQueue.items.some((item) => item.candidateId === result.candidate.id), true);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("records verified Instagram public lead candidate without requiring email", () => {
  const result = recordRevenuePublicLeadCandidate({
    businessName: "Insta Ready Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "instagram",
    contactValue: "@instareadycafe",
    sourceUrl: "https://instagram.com/instareadycafe",
    recipientEmail: "",
    evidence: "Public Instagram profile has no website link, active menu posts and a visible DM contact path.",
    painPoint: "Needs online menu, catering inquiry capture and follow-up.",
    estimatedOfferUsd: 3600,
    status: "research",
    contactName: "Owner",
    businessSummary: "Insta Ready Cafe has verified public Instagram evidence and no dedicated website.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "ready_for_preview");
  assert.equal(result.candidate.importReady, true);
  assert.equal(result.candidate.recipientEmail, "");
  assert.equal(result.importableCount, 1);
  assert.doesNotMatch(result.candidate.blockedReasons.join("; "), /recipientEmail/);
  assert.equal(snapshot.publicLeadImportQueue.readyCount, 1);
  assert.equal(snapshot.publicLeadImportQueue.items[0].contactChannel, "instagram");
  const moneySprintRequest = JSON.parse(snapshot.publicLeadImportQueue.copyableMoneySprintRequest);
  assert.deepEqual(revenueMoneySprintFromPublicCandidatesSchema.parse(moneySprintRequest).candidateIds, [result.candidate.id]);
  assert.equal(moneySprintRequest.area, "Miami");
  assert.equal(moneySprintRequest.niche, "coffee shop");
  assert.equal(moneySprintRequest.maxPaidDataSpendUsd, 0);
  assert.equal(moneySprintRequest.requireRobertApprovalToContact, true);
  const approvalRequest = JSON.parse(snapshot.publicLeadImportQueue.items[0].copyableApprovalRequest);
  assert.deepEqual(revenuePublicLeadCandidateApproveSchema.parse(approvalRequest), {
    candidateId: result.candidate.id,
    approvedByRobert: true,
    publicEvidenceVerified: true,
    approvalToImport: true,
    notes: "Robert verified public evidence and approved Insta Ready Cafe for Money Sprint import. No outreach, lead creation or website build yet.",
  });
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("blocks public lead candidates from import until evidence is verified", () => {
  const result = recordRevenuePublicLeadCandidate({
    businessName: "Unverified Salon",
    area: "Miami",
    niche: "salon",
    websiteStatus: "unknown",
    contactChannel: "unknown",
    contactValue: "",
    sourceUrl: "https://example.com/unverified-salon",
    recipientEmail: "",
    evidence: "short",
    painPoint: "Needs review.",
    estimatedOfferUsd: 1000,
    status: "research",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.candidate.importReady, false);
  assert.equal(result.importableCount, 0);
  assert.equal(result.importBatchText.split("\n").length, 1);
  assert.match(result.nextAction, /public evidence not verified/);
  assert.equal(getRevenueEngineSnapshot().recentLeads.length, 0);
  assert.equal(getRevenueEngineSnapshot().publicLeadImportQueue.readyCount, 0);
  assert.equal(getRevenueEngineSnapshot().publicLeadImportQueue.blockedCount, 1);
});

test("approves reviewed public lead candidate without creating leads or outreach", () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "Review Ready Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@reviewready.example",
    sourceUrl: "https://example.com/review-ready-cafe",
    recipientEmail: "owner@reviewready.example",
    evidence: "Public listing shows no website, current menu photos and verified owner email.",
    painPoint: "Needs menu website, catering inquiry capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Review Ready Cafe has public no-website evidence and a clear website opportunity.",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
  });

  assert.equal(candidate.status, "needs_review");
  assert.equal(candidate.candidate.importReady, false);
  assert.equal(candidate.snapshot.publicLeadImportQueue.blockedCount, 1);

  const approved = approveRevenuePublicLeadCandidate({
    candidateId: candidate.candidate.id,
    approvedByRobert: true,
    publicEvidenceVerified: true,
    approvalToImport: true,
    notes: "Robert verified public source and approved import.",
  });

  assert.equal(approved.status, "approved");
  assert.equal(approved.candidate?.id, candidate.candidate.id);
  assert.equal(approved.candidate?.importReady, true);
  assert.equal(approved.importableCount, 1);
  assert.equal(approved.safety.persistsLeads, false);
  assert.equal(approved.safety.sendsOutreach, false);
  assert.equal(approved.snapshot.publicLeadImportQueue.readyCount, 1);
  assert.equal(approved.snapshot.publicLeadImportQueue.blockedCount, 0);
  assert.equal(approved.snapshot.recentLeads.length, 0);
  assert.equal(approved.snapshot.recentOutreach.length, 0);
});

test("public candidate approval requires explicit Robert approval", () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "Needs Robert Approval Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@needsrobert.example",
    sourceUrl: "https://example.com/needs-robert-approval-cafe",
    recipientEmail: "owner@needsrobert.example",
    evidence: "Public listing has no website and a verified owner email.",
    painPoint: "Needs online ordering and inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
  });

  assert.throws(
    () => revenuePublicLeadCandidateApproveSchema.parse({
      candidateId: candidate.candidate.id,
      publicEvidenceVerified: true,
      approvalToImport: true,
    }),
    /approvedByRobert/,
  );
  assert.equal(getRevenueEngineSnapshot().publicLeadImportQueue.readyCount, 0);
});

test("public candidate approval route rejects missing Robert approval without mutating queue", async () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "HTTP Robert Gate Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@httprobert.example",
    sourceUrl: "https://example.com/http-robert-gate-cafe",
    recipientEmail: "owner@httprobert.example",
    evidence: "Public listing has no website and a verified owner email.",
    painPoint: "Needs menu and catering inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
  });
  const app = express();
  app.use(express.json());
  const server = createHttpServer(app);
  await registerRoutes(server, app);
  const routeLayer = (app as any)._router.stack.find((layer: any) =>
    layer.route?.path === "/api/revenue-engine/public-lead-candidates/approve" && layer.route.methods.post
  );
  assert.ok(routeLayer, "public candidate approval route should be registered");
  const handler = routeLayer.route.stack[0].handle;
  const result = { statusCode: 200, body: null as unknown };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      result.body = payload;
      return res;
    },
  };

  await handler({
    body: {
      candidateId: candidate.candidate.id,
      publicEvidenceVerified: true,
      approvalToImport: true,
    },
  }, res);

  assert.equal(result.statusCode, 400);
  assert.equal(getRevenueEngineSnapshot().publicLeadImportQueue.readyCount, 0);
  assert.equal(getRevenueEngineSnapshot().publicLeadImportQueue.blockedCount, 1);
});

test("public candidate approval keeps incomplete candidates blocked", () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "Still Missing Contact Spa",
    area: "Miami",
    niche: "spa",
    websiteStatus: "unknown",
    contactChannel: "unknown",
    contactValue: "",
    sourceUrl: "https://example.com/still-missing-contact-spa",
    recipientEmail: "",
    evidence: "Public listing exists but does not show enough contact or website evidence.",
    painPoint: "Needs review before a website offer.",
    estimatedOfferUsd: 2500,
    status: "research",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
  });

  const approved = approveRevenuePublicLeadCandidate({
    candidateId: candidate.candidate.id,
    approvedByRobert: true,
    publicEvidenceVerified: true,
    approvalToImport: true,
    notes: "Operator tried to approve before contact was fixed.",
  });

  assert.equal(approved.status, "needs_review");
  assert.match(approved.reason, /recipientEmail|contact/);
  assert.equal(approved.candidate?.importReady, false);
  assert.equal(approved.snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(approved.snapshot.publicLeadImportQueue.blockedCount, 1);
  assert.equal(approved.snapshot.recentLeads.length, 0);
});

test("blocked public candidates expose a repair packet without creating leads", () => {
  recordRevenuePublicLeadCandidate({
    businessName: "Repair Needed Spa",
    area: "Miami",
    niche: "spa",
    websiteStatus: "unknown",
    contactChannel: "unknown",
    contactValue: "",
    sourceUrl: "",
    recipientEmail: "",
    evidence: "short",
    painPoint: "Needs review.",
    estimatedOfferUsd: 2500,
    status: "research",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
  });

  const snapshot = getRevenueEngineSnapshot();
  const blocked = snapshot.publicLeadImportQueue.blocked[0];

  assert.equal(snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(snapshot.publicLeadImportQueue.blockedCount, 1);
  assert.equal(blocked.businessName, "Repair Needed Spa");
  assert.match(blocked.copyableRepairPacket, /Public candidate repair packet: Repair Needed Spa/);
  assert.match(blocked.copyableRepairPacket, /business\|area\|niche\|website\|channel\|contact\|sourceUrl/);
  assert.match(blocked.copyableRepairPacket, /REPLACE_PUBLIC_CONTACT_PATH/);
  assert.match(blocked.copyableRepairPacket, /REPLACE_PUBLIC_SOURCE_URL/);
  assert.match(blocked.copyableRepairPacket, /publicEvidenceVerified=true/);
  assert.match(blocked.repairBatchRow, /Repair Needed Spa\|Miami\|spa/);
  const blockedApprovalRequest = JSON.parse(blocked.copyableApprovalRequest);
  assert.deepEqual(revenuePublicLeadCandidateApproveSchema.parse(blockedApprovalRequest), {
    candidateId: blocked.candidateId,
    approvedByRobert: true,
    publicEvidenceVerified: true,
    approvalToImport: true,
    notes: "Robert verified public evidence and approved Repair Needed Spa for Money Sprint import. No outreach, lead creation or website build yet.",
  });
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("public lead candidates require source urls tied to business or contact evidence", () => {
  const unrelated = recordRevenuePublicLeadCandidate({
    businessName: "Generic Source Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@genericsource.example",
    sourceUrl: "https://example.com",
    recipientEmail: "owner@genericsource.example",
    evidence: "Public listing has no website, current menu posts and a visible owner email.",
    painPoint: "Needs online menu and catering inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Generic Source Cafe appears to be a no-website coffee shop lead.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });

  assert.equal(unrelated.candidate.importReady, false);
  assert.equal(unrelated.candidate.blockedReasons.includes("sourceUrl must match business/contact evidence"), true);
  assert.equal(unrelated.snapshot.publicLeadImportQueue.readyCount, 0);

  const related = recordRevenuePublicLeadCandidate({
    businessName: "Related Source Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@relatedsource.example",
    sourceUrl: "https://example.com/related-source-cafe",
    recipientEmail: "owner@relatedsource.example",
    evidence: "Public listing has no website, current menu posts and a visible owner email.",
    painPoint: "Needs online menu and catering inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Related Source Cafe appears to be a no-website coffee shop lead.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });

  assert.equal(related.candidate.importReady, true);
  assert.equal(related.snapshot.publicLeadImportQueue.readyCount, 1);
});

test("public lead source matching rejects spoofed platforms and generic category pages", () => {
  const spoofedPlatform = recordRevenuePublicLeadCandidate({
    businessName: "Spoofed Platform Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "instagram",
    contactValue: "@spoofedplatformcafe",
    sourceUrl: "https://notinstagram.com/spoofedplatformcafe",
    recipientEmail: "",
    evidence: "Public profile claims no website and visible DM contact path.",
    painPoint: "Needs online menu and inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Spoofed Platform Cafe should not trust a spoofed platform host.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });
  const genericCategory = recordRevenuePublicLeadCandidate({
    businessName: "Single Token Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@singletoken.example",
    sourceUrl: "https://example.com/best-cafes-miami",
    recipientEmail: "owner@singletoken.example",
    evidence: "Public list mentions cafes but does not tie this exact business to a contact path.",
    painPoint: "Needs online menu and inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Single Token Cafe should not import from a generic category page.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });
  const genericGoogleSearch = recordRevenuePublicLeadCandidate({
    businessName: "Generic Google Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@genericgoogle.example",
    sourceUrl: "https://www.google.com/search?q=coffee+shops+miami",
    recipientEmail: "owner@genericgoogle.example",
    evidence: "Generic Google search results are not direct business evidence.",
    painPoint: "Needs online menu and inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Generic Google Cafe should not import from a generic Google search URL.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });

  assert.equal(spoofedPlatform.candidate.importReady, false);
  assert.equal(genericCategory.candidate.importReady, false);
  assert.equal(genericGoogleSearch.candidate.importReady, false);
  assert.equal(genericGoogleSearch.snapshot.publicLeadImportQueue.readyCount, 0);
});

test("public lead source matching rejects generic public platform URLs", () => {
  const genericInstagram = recordRevenuePublicLeadCandidate({
    businessName: "Generic Instagram Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "instagram",
    contactValue: "@genericinstagramcafe",
    sourceUrl: "https://instagram.com/explore/tags/coffee",
    recipientEmail: "",
    evidence: "Instagram hashtag page mentions coffee but does not prove this specific business profile.",
    painPoint: "Needs online menu and inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Generic Instagram Cafe should not import from a hashtag page.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });
  const genericYelp = recordRevenuePublicLeadCandidate({
    businessName: "Generic Yelp Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "contact_form",
    contactValue: "https://genericyelpcafe.example/contact",
    sourceUrl: "https://www.yelp.com/search?find_desc=coffee&find_loc=Miami",
    recipientEmail: "owner@genericyelp.example",
    evidence: "Yelp search page is public but not tied to this specific business.",
    painPoint: "Needs online menu and inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Generic Yelp Cafe should not import from a category search.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });
  const tokenMatchingYelpSearch = recordRevenuePublicLeadCandidate({
    businessName: "Token Match Yelp Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "contact_form",
    contactValue: "https://tokenmatchyelpcafe.example/contact",
    sourceUrl: "https://www.yelp.com/search?find_desc=Token+Match+Yelp+Cafe&find_loc=Miami",
    recipientEmail: "owner@tokenmatchyelp.example",
    evidence: "Yelp search query includes the business name but is still not a direct business listing.",
    painPoint: "Needs online menu and inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Token Match Yelp Cafe should not import from a token-matching search URL.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });
  const tokenMatchingInstagramExplore = recordRevenuePublicLeadCandidate({
    businessName: "Token Match Instagram Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "instagram",
    contactValue: "@tokenmatchinstagramcafe",
    sourceUrl: "https://instagram.com/explore/tags/tokenmatchinstagramcafe",
    recipientEmail: "",
    evidence: "Instagram tag URL includes the business handle but is still a generic tag page.",
    painPoint: "Needs online menu and inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Token Match Instagram Cafe should not import from a token-matching tag URL.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });
  const sprint = runRevenueMoneySprintFromPublicCandidates({
    candidateIds: [
      genericInstagram.candidate.id,
      genericYelp.candidate.id,
      tokenMatchingYelpSearch.candidate.id,
      tokenMatchingInstagramExplore.candidate.id,
    ],
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
  });

  assert.equal(genericInstagram.candidate.importReady, false);
  assert.equal(genericYelp.candidate.importReady, false);
  assert.equal(tokenMatchingYelpSearch.candidate.importReady, false);
  assert.equal(tokenMatchingInstagramExplore.candidate.importReady, false);
  assert.equal(genericInstagram.candidate.blockedReasons.includes("sourceUrl must match business/contact evidence"), true);
  assert.equal(genericYelp.candidate.blockedReasons.includes("sourceUrl must match business/contact evidence"), true);
  assert.equal(tokenMatchingYelpSearch.candidate.blockedReasons.includes("sourceUrl must match business/contact evidence"), true);
  assert.equal(tokenMatchingInstagramExplore.candidate.blockedReasons.includes("sourceUrl must match business/contact evidence"), true);
  assert.equal(sprint.status, "blocked");
  assert.equal(sprint.blockedCandidates.length, 4);
  assert.equal(sprint.importedCandidateIds.length, 0);
  assert.equal(sprint.snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(sprint.snapshot.recentLeads.length, 0);
  assert.equal(sprint.snapshot.recentOutreach.length, 0);
});

test("public lead source matching accepts specific public platform business URLs", () => {
  const result = recordRevenuePublicLeadCandidate({
    businessName: "Maps Ready Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "contact_form",
    contactValue: "Google Maps public listing contact path",
    sourceUrl: "https://maps.google.com/?q=Maps+Ready+Cafe+Miami",
    recipientEmail: "",
    evidence: "Google Maps listing has no website field, recent menu photos and a visible public contact path.",
    painPoint: "Needs online menu and catering inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Maps Ready Cafe has verified public no-website evidence from Google Maps.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });

  assert.equal(result.candidate.importReady, true);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 1);
});

test("records verified public lead candidate batch without creating leads or outreach", () => {
  const result = recordRevenuePublicLeadCandidateBatch({
    area: "Miami",
    niche: "coffee shop",
    batchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      "Batch Ready Cafe|Miami|coffee shop|no_website|email|owner@batchready.example|https://example.com/batch-ready|owner@batchready.example|Google listing has no website and current menu photos with public owner email.|Needs online menu and catering inquiry capture.|4200|Owner|Batch Ready Cafe has verified public no-website evidence and clear lead capture needs.",
      "Batch Ready Salon|Miami|salon|weak_website|email|owner@batchsalon.example|https://example.com/batch-salon|owner@batchsalon.example|Public profile links to a broken website and recent salon service photos with visible owner email.|Needs booking conversion and follow-up.|3600|Owner|Batch Ready Salon has verified public weak-website evidence and a booking conversion gap.",
    ].join("\n"),
    sourceTaskId: "scout-batch",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    notes: "Batch verified from public sources.",
  });

  assert.equal(result.status, "ready_for_preview");
  assert.equal(result.recordedCount, 2);
  assert.equal(result.importableCount, 2);
  assert.equal(result.safety.persistsCandidates, true);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.snapshot.recentPublicLeadCandidates.length, 2);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 2);
  assert.equal(result.snapshot.recentLeads.length, 0);
  assert.equal(result.snapshot.recentOutreach.length, 0);
});

test("keeps public lead candidate batch blocked until batch evidence is approved", () => {
  const result = recordRevenuePublicLeadCandidateBatch({
    area: "Miami",
    niche: "coffee shop",
    batchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      "Batch Review Cafe|Miami|coffee shop|no_website|email|owner@batchreview.example|https://example.com/batch-review|owner@batchreview.example|Google listing has no website and current menu photos with public owner email.|Needs online menu and catering inquiry capture.|4200|Owner|Batch Review Cafe has public evidence but has not been approved for import.",
    ].join("\n"),
    sourceTaskId: "scout-batch-review",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.recordedCount, 1);
  assert.equal(result.importableCount, 0);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.blockedSeeds[0].reason.includes("public evidence not verified"), true);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(result.snapshot.publicLeadImportQueue.blockedCount, 1);
  assert.equal(result.snapshot.recentLeads.length, 0);
});

test("rejects string false values for public lead candidate batch approval gates", () => {
  assert.throws(
    () => recordRevenuePublicLeadCandidateBatch({
      area: "Miami",
      niche: "coffee shop",
      batchText: [
        "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
        "String False Cafe|Miami|coffee shop|no_website|email|owner@stringfalse.example|https://example.com/string-false|owner@stringfalse.example|Google listing has no website and current menu photos with public owner email.|Needs online menu.|4200|Owner|String False Cafe should not import when approval values are strings.",
      ].join("\n"),
      sourceTaskId: "scout-string-false",
      verificationStatus: "verified_public",
      publicEvidenceVerified: "false",
      approvalToImport: "false",
    } as Parameters<typeof recordRevenuePublicLeadCandidateBatch>[0]),
    /Expected boolean/,
  );

  assert.equal(getRevenueEngineSnapshot().recentPublicLeadCandidates.length, 0);
  assert.equal(getRevenueEngineSnapshot().publicLeadImportQueue.readyCount, 0);
});

test("normalizes public scout evidence into candidates without creating leads", () => {
  const result = recordRevenuePublicScoutEvidence({
    area: "Miami",
    niche: "coffee shop",
    evidenceText: [
      "Business: Evidence Intake Cafe",
      "Area: Miami",
      "Niche: coffee shop",
      "Website: no website",
      "Contact: @evidenceintakecafe",
      "Email: owner@evidenceintake.example",
      "Source: https://instagram.com/evidenceintakecafe",
      "Evidence: Public Instagram bio has no dedicated website and menu only appears in posts.",
      "Pain: Needs online menu, catering inquiries and automated follow-up.",
      "",
      "Business: Evidence Intake Cafe",
      "Area: Miami",
      "Niche: coffee shop",
      "Website: no website",
      "Contact: @newhandle",
      "Email: owner@evidenceintake.example",
      "Source: https://instagram.com/evidenceintakecafe",
      "Evidence: Same public source was checked again with a normalized contact value.",
      "Pain: Needs online menu, catering inquiries and automated follow-up.",
    ].join("\n"),
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    defaultOfferUsd: 4200,
    maxCandidates: 10,
  });

  assert.equal(result.status, "ready_for_preview");
  assert.equal(result.parsedCount, 2);
  assert.equal(result.recordedCount, 1);
  assert.equal(result.importableCount, 1);
  assert.match(result.normalizedBatchText, /Evidence Intake Cafe/);
  assert.equal(result.safety.persistsCandidates, true);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.snapshot.recentLeads.length, 0);
  assert.equal(result.snapshot.recentOutreach.length, 0);
  assert.equal(result.snapshot.recentPublicLeadCandidates.length, 1);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 1);
});

test("verified scout connector intake records review-only candidates without importing", () => {
  const result = recordRevenueVerifiedScoutConnectorResults({
    area: "Miami",
    niche: "coffee shop",
    connectorName: "Local browser scout",
    connectorRunId: "connector-run-001",
    sourceTaskId: "scout-task-connector",
    results: [
      {
        businessName: "Connector Intake Cafe",
        websiteStatus: "no_website",
        contactChannel: "instagram",
        contactValue: "@connectorintakecafe",
        recipientEmail: "owner@connectorintake.example",
        sourceUrl: "https://instagram.com/connectorintakecafe",
        evidence: "Public Instagram profile has recent menu posts, no dedicated website link and visible owner email.",
        painPoint: "Needs an online menu, catering lead capture and follow-up.",
        estimatedOfferUsd: 4200,
        contactName: "Owner",
        businessSummary: "Connector Intake Cafe has public evidence of missing website and active demand.",
      },
      {
        businessName: "Browser Scout Bakery",
        websiteStatus: "weak_website",
        contactChannel: "instagram",
        contactValue: "@browserscoutbakery",
        recipientEmail: "orders@browserscout.example",
        sourceUrl: "https://instagram.com/browserscoutbakery",
        evidence: "Public Instagram profile shows current catering posts and a weak link-in-bio instead of a conversion website.",
        painPoint: "Needs a catering quote page and automated inquiry follow-up.",
        estimatedOfferUsd: 3800,
        contactName: "Owner",
        businessSummary: "Browser Scout Bakery has public evidence of a weak website funnel.",
      },
    ],
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.connector.executionMode, "verified_connector_review_only");
  assert.equal(result.connector.approvalLocked, true);
  assert.equal(result.recordedCount, 2);
  assert.equal(result.importableCount, 0);
  assert.equal(result.blockedCount, 2);
  assert.equal(result.evidenceResult.recorded.every((item) => item.status === "needs_review"), true);
  assert.equal(
    result.evidenceResult.recorded.every((item) => item.candidate.verificationStatus === "needs_review"),
    true,
  );
  assert.equal(
    result.evidenceResult.recorded.every((item) => item.candidate.publicEvidenceVerified === false && item.candidate.approvalToImport === false),
    true,
  );
  assert.equal(result.safety.persistsCandidates, true);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.spendsMoney, false);
  assert.equal(result.safety.writesPreviewFiles, false);
  assert.equal(result.safety.requiresRobertReview, true);
  assert.equal(result.safety.blockedActions.includes("run Money Sprint before Robert approval"), true);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(result.snapshot.publicLeadImportQueue.blockedCount, 2);
  assert.equal(result.snapshot.recentPublicLeadCandidates.length, 2);
  assert.equal(result.snapshot.recentLeads.length, 0);
  assert.equal(result.snapshot.recentOutreach.length, 0);
  assert.equal(result.snapshot.recentLedger.length, 0);
});

test("verified scout connector normalized rows cannot bypass review through Money Sprint", () => {
  const connectorResult = recordRevenueVerifiedScoutConnectorResults({
    area: "Miami",
    niche: "coffee shop",
    connectorName: "Local browser scout",
    connectorRunId: "connector-review-gate-run",
    sourceTaskId: "connector-review-gate",
    results: [
      {
        businessName: "Review Gate Cafe",
        websiteStatus: "no_website",
        contactChannel: "instagram",
        contactValue: "@reviewgatecafe",
        recipientEmail: "owner@reviewgate.example",
        sourceUrl: "https://instagram.com/reviewgatecafe",
        evidence: "Public Instagram profile has no dedicated website and current catering posts with visible owner email.",
        painPoint: "Needs online menu, catering quote capture and follow-up.",
        estimatedOfferUsd: 4200,
      },
    ],
  });

  assert.equal(connectorResult.status, "needs_review");
  assert.match(connectorResult.normalizedBatchText, /public_candidate_review_gate=needs_review/);

  const sprint = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeadBatchText: connectorResult.normalizedBatchText,
  });

  assert.equal(sprint.status, "needs_lead_evidence");
  assert.equal(sprint.recordedLeads.length, 0);
  assert.equal(sprint.previews.length, 0);
  assert.equal(sprint.outreachDrafts.length, 0);
  assert.equal(sprint.blockedSeeds.some((seed) => seed.reason.includes("public candidate review required")), true);
  assert.equal(sprint.snapshot.recentLeads.length, 0);
  assert.equal(sprint.snapshot.recentOutreach.length, 0);
  assert.equal(sprint.snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(sprint.snapshot.publicLeadImportQueue.blockedCount, 1);
});

test("verified scout connector rejects invalid rows before persisting partial candidates", () => {
  assert.throws(
    () => recordRevenueVerifiedScoutConnectorResults({
      area: "Miami",
      niche: "coffee shop",
      connectorName: "Local browser scout",
      connectorRunId: "connector-run-invalid",
      results: [
        {
          businessName: "Valid First Connector Cafe",
          websiteStatus: "no_website",
          contactChannel: "instagram",
          contactValue: "@validfirstconnector",
          recipientEmail: "owner@validfirst.example",
          sourceUrl: "https://instagram.com/validfirstconnector",
          evidence: "Public Instagram profile has no dedicated website and current menu posts.",
          painPoint: "Needs an online menu and follow-up.",
        },
        {
          businessName: "Invalid Connector Cafe",
          websiteStatus: "no_website",
          contactChannel: "instagram",
          contactValue: "@invalidconnector",
          recipientEmail: "not-an-email",
          sourceUrl: "https://instagram.com/invalidconnector",
          evidence: "Public Instagram profile has no dedicated website and current menu posts.",
          painPoint: "Needs an online menu and follow-up.",
        },
      ],
    }),
    /Invalid email/,
  );

  const snapshot = getRevenueEngineSnapshot();
  assert.equal(snapshot.recentPublicLeadCandidates.length, 0);
  assert.equal(snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(snapshot.publicLeadImportQueue.blockedCount, 0);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("verified scout connector bounds long source task identifiers", () => {
  const longSourceTaskId = `connector-${"source-".repeat(21)}`;
  const longRunId = `run-${"token-".repeat(21)}`;
  const result = recordRevenueVerifiedScoutConnectorResults({
    area: "Miami",
    niche: "coffee shop",
    connectorName: "Local browser scout",
    connectorRunId: longRunId,
    sourceTaskId: longSourceTaskId,
    results: [
      {
        businessName: "Bounded Connector Cafe",
        websiteStatus: "no_website",
        contactChannel: "instagram",
        contactValue: "@boundedconnector",
        recipientEmail: "owner@boundedconnector.example",
        sourceUrl: "https://instagram.com/boundedconnector",
        evidence: "Public Instagram profile has no dedicated website and a visible business email.",
        painPoint: "Needs a conversion website and inquiry follow-up.",
      },
    ],
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.recordedCount, 1);
  assert.equal(result.evidenceResult.recorded[0].candidate.sourceTaskId.length <= 160, true);
  assert.match(result.evidenceResult.recorded[0].candidate.sourceTaskId, /^connector-source-/);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 0);
});

test("verified scout connector bounds composed evidence and notes before downstream intake", () => {
  const longNotes = "n".repeat(1000);
  const longEvidence = "Public Instagram profile shows no dedicated website, current menu posts, visible contact info and active customer demand. ".repeat(8);
  const result = recordRevenueVerifiedScoutConnectorResults({
    area: "Miami",
    niche: "coffee shop",
    connectorName: "Local browser scout",
    connectorRunId: "connector-run-large",
    notes: longNotes,
    results: Array.from({ length: 20 }, (_, index) => ({
      businessName: `Large Connector Cafe ${index + 1}`,
      websiteStatus: "no_website" as const,
      contactChannel: "instagram" as const,
      contactValue: `@largeconnectorcafe${index + 1}`,
      recipientEmail: `owner${index + 1}@largeconnector.example`,
      sourceUrl: `https://instagram.com/largeconnectorcafe${index + 1}`,
      evidence: longEvidence,
      painPoint: "Needs an online menu, catering lead capture and follow-up.",
      businessSummary: `Large Connector Cafe ${index + 1} has public evidence of missing website and active demand.`,
    })),
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.recordedCount, 20);
  assert.equal(result.importableCount, 0);
  assert.equal(result.normalizedBatchText.includes("Large Connector Cafe 20"), true);
  assert.equal(result.evidenceResult.recorded.every((item) => item.candidate.notes.length <= 1000), true);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(result.snapshot.publicLeadImportQueue.blockedCount, 20);
  assert.equal(result.snapshot.recentLeads.length, 0);
  assert.equal(result.snapshot.recentOutreach.length, 0);
});

test("blocks public scout evidence from private or local source urls", () => {
  const privateSources = [
    "http://localhost:5173/internal-source-cafe",
    "http://[::1]/internal-source-cafe",
    "http://169.254.169.254/latest/meta-data",
    "http://[fd00::1]/internal-source-cafe",
    "http://[fe80::1]/internal-source-cafe",
    "http://intranet/internal-source-cafe",
  ];

  for (const [index, sourceUrl] of privateSources.entries()) {
    const result = recordRevenuePublicScoutEvidence({
      area: "Miami",
      niche: "coffee shop",
      evidenceText: [
        `Business: Internal Source Cafe ${index + 1}`,
        "Website: no website",
        `Contact: owner${index + 1}@internalsource.example`,
        `Source: ${sourceUrl}`,
        "Evidence: Public-looking note pasted from an internal development URL.",
        "Pain: Needs online menu and lead capture.",
      ].join("\n"),
      verificationStatus: "verified_public",
      publicEvidenceVerified: true,
      approvalToImport: true,
      approvedByRobert: true,
      defaultOfferUsd: 4200,
    });

    assert.equal(result.status, "needs_review");
    assert.equal(result.importableCount, 0);
    assert.equal(result.blockedCount, 1);
    assert.match(result.blockedSeeds[0].reason, /sourceUrl must be public/);
    assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 0);
    assert.equal(result.snapshot.publicLeadImportQueue.blockedCount, index + 1);
    assert.equal(result.snapshot.recentLeads.length, 0);
  }
});

test("public scout agent command normalizes import-ready candidates without running sprint by default", () => {
  const result = runRevenuePublicScoutAgentCommand({
    area: "Miami",
    niche: "coffee shop",
    evidenceText: [
      "Business: Agent Command Cafe",
      "Website: no website",
      "Contact: owner@agentcommand.example",
      "Source: https://example.com/agent-command-cafe",
      "Evidence: Public listing has no website, current menu photos and visible owner email.",
      "Pain: Needs online menu, catering inquiry capture and follow-up.",
    ].join("\n"),
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });

  assert.equal(result.status, "candidates_ready");
  assert.equal(result.sprintResult, null);
  assert.equal(result.readyCandidateIds.length, 1);
  assert.equal(result.safety.persistsCandidates, true);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.spendsMoney, false);
  assert.equal(result.safety.deploys, false);
  assert.equal(result.snapshot.recentPublicLeadCandidates.length, 1);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 1);
  assert.equal(result.snapshot.recentLeads.length, 0);
  assert.equal(result.snapshot.recentOutreach.length, 0);
  assert.equal(result.snapshot.recentLedger.length, 0);
  assert.equal(result.snapshot.recentDeliveryWorkspaces.length, 0);
});

test("public scout agent command runs sprint only with import-ready candidates and keeps external actions blocked", () => {
  const result = runRevenuePublicScoutAgentCommand({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    evidenceText: [
      "Business: Agent Sprint Cafe",
      "Website: no website",
      "Contact: owner@agentsprint.example",
      "Source: https://example.com/agent-sprint-cafe",
      "Evidence: Public listing has no website, recent menu posts and verified owner email.",
      "Pain: Needs online menu, catering inquiry capture and follow-up.",
    ].join("\n"),
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    runMoneySprintIfReady: true,
    maxPaidDataSpendUsd: 0,
  });

  assert.equal(result.status, "sprint_started");
  assert.equal(result.readyCandidateIds.length, 1);
  assert.equal(result.sprintResult?.sprint?.recordedLeads.length, 1);
  assert.equal(result.sprintResult?.sprint?.outreachDrafts.length, 1);
  assert.equal(result.sprintResult?.sprint?.outreachDrafts[0].status, "draft");
  assert.equal(result.sprintResult?.sprint?.outreachDrafts[0].delivery.sendStatus, "not_sent");
  assert.equal(result.sprintResult?.sprint?.operatingLimits.externalContactMode, "draft_until_robert_approves");
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.spendsMoney, false);
  assert.equal(result.safety.deploys, false);
  assert.equal(result.snapshot.recentLedger.length, 0);
  assert.equal(result.snapshot.recentDeliveryWorkspaces.length, 0);
});

test("public scout agent command does not run sprint for unapproved or unverified evidence", () => {
  const result = runRevenuePublicScoutAgentCommand({
    area: "Miami",
    niche: "coffee shop",
    evidenceText: [
      "Business: Agent Review Cafe",
      "Website: no website",
      "Contact: owner@agentreview.example",
      "Source: https://example.com/agent-review-cafe",
      "Evidence: Public listing has no website and visible owner email.",
      "Pain: Needs online menu and follow-up.",
    ].join("\n"),
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
    runMoneySprintIfReady: true,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.sprintResult, null);
  assert.equal(result.readyCandidateIds.length, 0);
  assert.equal(result.snapshot.recentLeads.length, 0);
  assert.equal(result.snapshot.recentOutreach.length, 0);
  assert.equal(result.snapshot.recentLedger.length, 0);
  assert.equal(result.snapshot.recentDeliveryWorkspaces.length, 0);
});

test("public scout agent command rejects string false safety flags", () => {
  assert.throws(
    () => runRevenuePublicScoutAgentCommand({
      area: "Miami",
      niche: "coffee shop",
      evidenceText: [
        "Business: String False Agent Cafe",
        "Website: no website",
        "Contact: owner@stringfalseagent.example",
        "Source: https://example.com/string-false-agent",
        "Evidence: Public listing has no website and visible owner email.",
        "Pain: Needs online menu and follow-up.",
      ].join("\n"),
      verificationStatus: "verified_public",
      publicEvidenceVerified: true,
      approvalToImport: true,
      approvedByRobert: true,
      runMoneySprintIfReady: "false",
      writePreviewFiles: "false",
    } as Parameters<typeof runRevenuePublicScoutAgentCommand>[0]),
    /Expected boolean/,
  );

  assert.equal(getRevenueEngineSnapshot().recentLeads.length, 0);
  assert.equal(getRevenueEngineSnapshot().recentPublicLeadCandidates.length, 0);
});

test("public scout agent command cannot loosen contact approval or paid spend", () => {
  const baseInput = {
    area: "Miami",
    niche: "coffee shop",
    evidenceText: [
      "Business: Approval Locked Agent Cafe",
      "Website: no website",
      "Contact: owner@approvallocked.example",
      "Source: https://example.com/approval-locked-agent",
      "Evidence: Public listing has no website and visible owner email.",
      "Pain: Needs online menu and follow-up.",
    ].join("\n"),
    verificationStatus: "verified_public" as const,
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    runMoneySprintIfReady: true,
  };

  assert.throws(
    () => runRevenuePublicScoutAgentCommand({
      ...baseInput,
      requireRobertApprovalToContact: false,
    }),
    /Invalid literal value/,
  );
  assert.throws(
    () => runRevenuePublicScoutAgentCommand({
      ...baseInput,
      maxPaidDataSpendUsd: 1,
    }),
    /Number must be less than or equal to 0/,
  );
  assert.throws(
    () => runRevenuePublicScoutAgentCommand({
      ...baseInput,
      maxPaidDataSpendUsd: -1,
    }),
    /Number must be greater than or equal to 0/,
  );
});

test("money sprint without lead evidence reports needs_lead_evidence instead of ready", () => {
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 10,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeads: [],
    seedLeadBatchText: "",
  });

  assert.equal(result.status, "needs_lead_evidence");
  assert.equal(result.recordedLeads.length, 0);
  assert.equal(result.previews.length, 0);
  assert.equal(result.outreachDrafts.length, 0);
  assert.match(result.nextActions[0], /Open scoutQueue tasks/);
  assert.equal(getRevenueEngineSnapshot().recentLeads.length, 0);
  assert.equal(getRevenueEngineSnapshot().recentOutreach.length, 0);
});

test("runs money sprint from verified public candidates without copy paste or outreach send", () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "Verified Sprint Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@verifiedsprint.example",
    sourceUrl: "https://example.com/verified-sprint-cafe",
    recipientEmail: "owner@verifiedsprint.example",
    evidence: "Google listing has no website, recent menu photos and verified owner email.",
    painPoint: "Needs online menu, catering inquiry capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Verified Sprint Cafe has public evidence of no website and a clear need for menu capture.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });

  const result = runRevenueMoneySprintFromPublicCandidates({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    candidateIds: [candidate.candidate.id],
    maxCandidates: 5,
  });

  assert.equal(result.status, "started");
  assert.deepEqual(result.importedCandidateIds, [candidate.candidate.id]);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.sprint?.recordedLeads.length, 1);
  assert.equal(result.sprint?.previews.length, 1);
  assert.equal(result.sprint?.outreachDrafts.length, 1);
  assert.equal(result.sprint?.outreachDrafts[0].delivery.sendStatus, "not_sent");
  assert.equal(result.snapshot.recentLeads[0].businessName, "Verified Sprint Cafe");
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(result.snapshot.manualOutreachQueue.readyCount, 0);
});

test("public candidate money sprint can use ready candidates beyond the visible queue slice", () => {
  const candidateIds: string[] = [];

  for (let index = 0; index < 12; index += 1) {
    const result = recordRevenuePublicLeadCandidate({
      businessName: `Batch Ready Cafe ${String(index + 1).padStart(2, "0")}`,
      area: "Miami",
      niche: "coffee shop",
      websiteStatus: "no_website",
      contactChannel: "email",
      contactValue: `owner${index + 1}@batchready.example`,
      sourceUrl: `https://example.com/batch-ready-cafe-${index + 1}`,
      recipientEmail: `owner${index + 1}@batchready.example`,
      evidence: "Google listing has no website, current menu photos, public contact path and a clear catering inquiry gap.",
      painPoint: "Needs online menu, catering inquiry capture and follow-up.",
      estimatedOfferUsd: 4200,
      status: "research",
      contactName: "Owner",
      businessSummary: "Batch Ready Cafe has public no-website evidence and a clear menu capture opportunity.",
      verificationStatus: "verified_public",
      publicEvidenceVerified: true,
      approvalToImport: true,
      approvedByRobert: true,
    });
    candidateIds.push(result.candidate.id);
  }

  const beforeSprint = getRevenueEngineSnapshot();

  assert.equal(beforeSprint.publicLeadImportQueue.readyCount, 12);
  assert.equal(beforeSprint.publicLeadImportQueue.items.length, 10);

  const result = runRevenueMoneySprintFromPublicCandidates({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 12,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidateIds: [],
    maxCandidates: 12,
  });

  assert.equal(result.status, "started");
  assert.equal(result.importedCandidateIds.length, 12);
  assert.equal(new Set(result.importedCandidateIds).size, 12);
  assert.equal(candidateIds.every((candidateId) => result.importedCandidateIds.includes(candidateId)), true);
  assert.equal(result.sprint?.recordedLeads.length, 12);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 0);
});

test("runs money sprint from Instagram public candidate into manual draft without email", () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "Verified Insta Sprint Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "instagram",
    contactValue: "@verifiedinstasprint",
    sourceUrl: "https://instagram.com/verifiedinstasprint",
    recipientEmail: "",
    evidence: "Public Instagram profile has no website link, recent menu photos and a visible DM contact path.",
    painPoint: "Needs online menu, catering inquiry capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Verified Insta Sprint Cafe has public Instagram evidence of no website and a clear menu capture opportunity.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });

  const result = runRevenueMoneySprintFromPublicCandidates({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidateIds: [candidate.candidate.id],
    maxCandidates: 5,
  });

  assert.equal(result.status, "started");
  assert.deepEqual(result.importedCandidateIds, [candidate.candidate.id]);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.sprint?.recordedLeads.length, 1);
  assert.equal(result.sprint?.previews.length, 1);
  assert.equal(result.sprint?.outreachDrafts.length, 1);
  assert.equal(result.sprint?.outreachDrafts[0].channel, "instagram");
  assert.equal(result.sprint?.outreachDrafts[0].recipientEmail, "");
  assert.equal(result.sprint?.outreachDrafts[0].links.mailto, "");
  assert.equal(result.sprint?.outreachDrafts[0].delivery.sendStatus, "not_sent");
  assert.equal(result.snapshot.manualOutreachQueue.readyCount, 0);
  assert.equal(result.snapshot.recentOutreach[0].status, "draft");
});

test("blocks money sprint from public candidates until candidate is verified and approved", () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "Unapproved Sprint Salon",
    area: "Miami",
    niche: "salon",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@unapprovedsprint.example",
    sourceUrl: "https://example.com/unapproved-sprint-salon",
    recipientEmail: "owner@unapprovedsprint.example",
    evidence: "Public listing has no website and recent salon photos.",
    painPoint: "Needs booking lead capture.",
    estimatedOfferUsd: 3200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Unapproved Sprint Salon has public evidence but still needs Robert import approval.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: false,
  });

  const result = runRevenueMoneySprintFromPublicCandidates({
    area: "Miami",
    niche: "salon",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    candidateIds: [candidate.candidate.id],
    maxCandidates: 5,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.sprint, null);
  assert.equal(result.blockedCandidates[0].reason.includes("approvalToImport false"), true);
  assert.equal(result.snapshot.recentLeads.length, 0);
});

test("blocks public candidate money sprint when paid data spend is requested", () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "Paid Spend Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@paidspendcafe.example",
    sourceUrl: "https://example.com/paid-spend-cafe",
    recipientEmail: "owner@paidspendcafe.example",
    evidence: "Public listing has no website, recent menu photos and verified owner email.",
    painPoint: "Needs online menu.",
    estimatedOfferUsd: 3600,
    status: "research",
    contactName: "Owner",
    businessSummary: "Paid Spend Cafe is verified but the sprint request asks for paid data spend.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });

  const result = runRevenueMoneySprintFromPublicCandidates({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 25,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    candidateIds: [candidate.candidate.id],
    maxCandidates: 5,
  });

  assert.equal(result.status, "needs_spend_approval");
  assert.equal(result.sprint, null);
  assert.equal(result.safety.persistsData, false);
  assert.equal(result.snapshot.recentLeads.length, 0);
});

test("lead radar caps paid data spend and requires approval", () => {
  const radar = buildRevenueLeadRadar({
    area: "Orlando",
    niches: "roofers",
    offerFocus: "websites",
    runHoursPerDay: 12,
    dailyResearchTarget: 240,
    dailyQualifiedLeadLimit: 40,
    dailyMockupLimit: 6,
    dailyContactLimit: 12,
    maxPaidDataSpendUsd: 350,
    requireRobertApprovalToContact: true,
  });

  assert.equal(radar.status, "needs_spend_approval");
  assert.equal(radar.operatingMode.spendMode, "approval_required");
  assert.equal(radar.dailyLimits.approvedPaidDataSpendUsd, 100);
  assert.equal(radar.nextActions.some((action) => action.includes("Contactar max 12/dia")), true);
});

test("builds a zero-cost premium mockup template pack", () => {
  const pack = buildRevenueMockupTemplatePack({
    niche: "med spas",
    area: "Miami",
    dailyMockupTarget: 8,
    maxCustomMinutesPerMockup: 18,
    estimatedAiCostPerMockupUsd: 0,
  });

  assert.equal(pack.status, "ready");
  assert.equal(pack.pack.templateCount, 5);
  assert.equal(pack.costModel.hostingCostUsd, 0);
  assert.equal(pack.costModel.paidAssetCostUsd, 0);
  assert.equal(pack.costModel.monthlyAiCostUsd, 0);
  assert.equal(pack.costModel.insideZeroCostMode, true);
  assert.equal(pack.templates.some((template) => template.id === "shock_hero_booking"), true);
  assert.equal(pack.productionLine.some((step) => step.ownerAgent === "visual-qa"), true);
  assert.equal(pack.guardrails.some((guardrail) => guardrail.includes("No pagar hosting")), true);
});

test("mockup template pack makes AI cost visible and caps monthly spend", () => {
  const pack = buildRevenueMockupTemplatePack({
    niche: "gyms",
    area: "Orlando",
    dailyMockupTarget: 20,
    maxCustomMinutesPerMockup: 12,
    estimatedAiCostPerMockupUsd: 0.03,
  });

  assert.equal(pack.status, "ready");
  assert.equal(pack.costModel.dailyAiCostUsd, 0.6);
  assert.equal(pack.costModel.monthlyAiCostUsd, 18);
  assert.equal(pack.costModel.insideZeroCostMode, false);
  assert.equal(pack.costModel.insideMonthlyCap, true);
  assert.equal(pack.productionTargets.estimatedMockupsPerMonth, 600);
  assert.equal(pack.productionTargets.recommendedContactLimitPerDay, 15);
});

test("launch readiness is ready to start with only email pending", () => {
  const readiness = buildRevenueLaunchReadiness({
    area: "Miami",
    niche: "med spas / aesthetics",
    dailyResearchTarget: 120,
    dailyMockupTarget: 5,
    dailyContactTarget: 10,
    emailPending: true,
  });

  assert.equal(readiness.status, "ready_to_start");
  assert.equal(readiness.blocked, 0);
  assert.equal(readiness.pendingAllowed, 1);
  assert.equal(readiness.items.find((item) => item.id === "email_sender")?.status, "pending_allowed");
  assert.equal(readiness.emailPending.isPending, true);
  assert.equal(readiness.emailPending.allowedWhilePending.includes("contact forms"), true);
  assert.equal(readiness.manualStartPlan.some((step) => step.includes("5 mockups")), true);
  assert.equal(readiness.todayExecutionPack.status, "ready");
  assert.equal(readiness.todayExecutionPack.ownerAgent, "lead-scout");
  assert.equal(readiness.todayExecutionPack.runLimits.maxPaidSpendUsd, 0);
  assert.equal(readiness.todayExecutionPack.runLimits.maxMockups, 5);
  assert.equal(readiness.todayExecutionPack.runLimits.maxManualContacts, 10);
  assert.equal(readiness.todayExecutionPack.copyableBatchHeader.includes("business|area|niche"), true);
  assert.equal(readiness.todayExecutionPack.nextApiAction, "/api/revenue-engine/money-sprint-preview");
  assert.equal(readiness.todayExecutionPack.approvalRequiredBefore.includes("outreach send"), true);
  assert.match(readiness.todayExecutionPack.copyableAgentCommand, /Do not contact businesses/);
  assert.match(readiness.todayExecutionPack.copyableAgentCommand, /spend money/);
  assert.equal(readiness.summary.includes("solo falta configurar el correo"), true);
});

test("snapshot exposes launch readiness without blocking on email provider", () => {
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.launchReadiness.status, "blocked");
  assert.equal(snapshot.launchReadiness.blocked, 1);
  assert.equal(snapshot.launchReadiness.items.find((item) => item.id === "production_persistence")?.status, "blocked");
  assert.equal(snapshot.launchReadiness.emailPending.isPending, true);
  assert.equal(snapshot.launchReadiness.todayExecutionPack.status, "blocked");
  assert.equal(snapshot.launchReadiness.todayExecutionPack.approvalRequiredBefore.includes("production DATABASE_URL"), true);
  assert.equal(snapshot.launchReadiness.todayExecutionPack.runLimits.maxPaidSpendUsd, 0);
  assert.equal(snapshot.launchReadiness.todayExecutionPack.approvalRequiredBefore.includes("deployment"), true);
  assert.equal(snapshot.dailyMoneyCommand.status, "search");
  assert.match(snapshot.dailyMoneyCommand.primaryAction, /Buscar negocios publicos/);
  assert.equal(snapshot.moneyActivationPlan.status, "dry_run_research_only");
  assert.equal(snapshot.moneyActivationPlan.canStartToday, true);
  assert.equal(snapshot.moneyActivationPlan.canContactBusinesses, false);
  assert.equal(snapshot.moneyActivationPlan.canCollectMoney, false);
  assert.equal(snapshot.moneyActivationPlan.missingBeforeRealMoney.some((item) => item.id === "production_database"), true);
  assert.equal(snapshot.moneyActivationPlan.allowedToday.includes("buscar negocios publicos"), true);
  assert.equal(snapshot.moneyActivationPlan.blockedUntilApproved.includes("production DATABASE_URL"), true);
  assert.equal(snapshot.moneyActivationPlan.blockedUntilApproved.includes("client charge/deposit confirmation"), true);
  assert.equal(snapshot.moneyActivationPlan.firstSprintPlan.nextApiAction, "/api/revenue-engine/scout-dispatch");
  assert.equal(snapshot.moneyActivationPlan.firstSprintPlan.steps[0].id, "dispatch_public_research");
  assert.equal(snapshot.moneyActivationPlan.firstSprintPlan.steps[0].apiAction, "/api/revenue-engine/scout-dispatch");
  const firstSprintDispatchRequest = JSON.parse(snapshot.moneyActivationPlan.firstSprintPlan.copyableDispatchRequest);
  assert.equal(firstSprintDispatchRequest.area, snapshot.businessScoutQueue.area);
  assert.equal(firstSprintDispatchRequest.niche, snapshot.businessScoutQueue.niche);
  assert.equal(firstSprintDispatchRequest.maxPaidDataSpendUsd, 0);
  assert.equal(firstSprintDispatchRequest.requireRobertApprovalToContact, true);
  assert.equal(snapshot.moneyActivationPlan.firstSprintPlan.steps.some((step) => step.id === "approve_contact_or_collect" && step.approvalRequired), true);
  assert.deepEqual(
    snapshot.moneyActivationPlan.firstSprintPlan.revenuePath.map((stage) => stage.id),
    [
      "find_public_businesses",
      "package_website_offer",
      "close_deposit_scope",
      "create_qa_delivery_workspace",
      "open_pr_first_build",
    ],
  );
  assert.equal(
    snapshot.moneyActivationPlan.firstSprintPlan.revenuePath.find((stage) => stage.id === "close_deposit_scope")?.apiAction,
    "/api/revenue-engine/website-opportunities/close",
  );
  assert.match(
    snapshot.moneyActivationPlan.firstSprintPlan.revenuePath.find((stage) => stage.id === "open_pr_first_build")?.gate || "",
    /No direct main commit/,
  );
  assert.equal(snapshot.moneyActivationPlan.firstSprintPlan.blockedActions.includes("charge client"), true);
  assert.equal(snapshot.moneyActivationPlan.evidenceGate.status, "empty");
  assert.equal(snapshot.moneyActivationPlan.evidenceGate.readyCandidates, 0);
  assert.equal(snapshot.moneyActivationPlan.evidenceGate.requiredFields.includes("sourceUrl"), true);
  assert.equal(snapshot.moneyActivationPlan.evidenceGate.blockedActions.includes("run Money Sprint from placeholders"), true);
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.status, "blocked");
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.requiredEvidence.some((item) => item.id === "production_database" && item.status === "blocked"), true);
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.requiredEvidence.some((item) => item.id === "app_qa_release_gate"), true);
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.deploymentApprovalPacket.requiredSummaryFields.includes("rollback note"), true);
  assert.match(snapshot.moneyActivationPlan.productionLaunchChecklist.deploymentApprovalPacket.rollbackPlan, /Revertir el PR/);
  assert.match(snapshot.moneyActivationPlan.productionLaunchChecklist.deploymentApprovalPacket.deployApprovalAsk, /apruebas explicitamente el deploy/);
  assert.match(snapshot.moneyActivationPlan.productionLaunchChecklist.copyableChecklist, /Revenue Engine production launch checklist/);
  assert.match(snapshot.moneyActivationPlan.productionLaunchChecklist.copyableChecklist, /npm run build/);
  assert.match(snapshot.moneyActivationPlan.productionLaunchChecklist.copyableChecklist, /Deployment approval packet/);
  assert.match(snapshot.moneyActivationPlan.productionLaunchChecklist.copyableChecklist, /explicit Robert deploy approval/);
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.status, "blocked");
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.requiredEnv.some((item) => item.key === "DATABASE_URL" && item.status === "blocked"), true);
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.requiredEnv.some((item) => item.key === "SESSION_SECRET" && item.status === "blocked"), true);
  assert.match(snapshot.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.copyableSetupPacket, /npm run ceo:db-check -- --json/);
  assert.match(snapshot.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.copyableSetupPacket, /No pegar DATABASE_URL/);
  assert.match(snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief, /Revenue Engine first sprint plan/);
  assert.match(snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief, /Copyable dispatch request/);
  assert.match(snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief, /Evidence gate/);
  assert.match(snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief, /Required fields: .*sourceUrl/);
  assert.match(snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief, /Revenue path to paid website build/);
  assert.match(snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief, /\/api\/revenue-engine\/website-delivery-workspace/);
  assert.match(snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief, /\/api\/revenue-engine\/delivery-workspaces\/github-handoff/);
  assert.match(snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief, /Blocked until Robert approval/);
  assert.match(snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief, /\/api\/revenue-engine\/scout-dispatch/);
  assert.match(snapshot.moneyActivationPlan.copyableBrief, /First sprint steps/);
  assert.match(snapshot.moneyActivationPlan.copyableBrief, /Evidence gate before import\/contact/);
  assert.match(snapshot.moneyActivationPlan.copyableBrief, /Deploy approval ask/);
  assert.equal(snapshot.emailProvider.configured, false);
});

test("snapshot launch readiness stays blocked while revenue state uses local files", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.systemReadiness.items.find((item) => item.id === "production_persistence")?.status, "needs_data");
  assert.equal(snapshot.launchReadiness.status, "blocked");
  assert.equal(snapshot.launchReadiness.blocked > 0, true);
  assert.equal(snapshot.launchReadiness.items.some((item) => item.id === "production_persistence"), true);
  assert.equal(snapshot.launchReadiness.todayExecutionPack.status, "blocked");
  assert.equal(snapshot.moneyActivationPlan.status, "dry_run_research_only");
  assert.equal(snapshot.moneyActivationPlan.missingBeforeRealMoney.some((item) => item.id === "production_database"), true);
  assert.equal(snapshot.moneyActivationPlan.missingBeforeRealMoney.some((item) => item.id === "controlled_autonomy"), true);
  assert.equal(snapshot.moneyActivationPlan.blockedUntilApproved.includes("outreach send"), true);
  assert.equal(snapshot.moneyActivationPlan.blockedUntilApproved.includes("cobrar cliente"), true);
  assert.equal(snapshot.moneyActivationPlan.canCollectMoney, false);
  assert.equal(snapshot.moneyActivationPlan.firstSprintPlan.area, "Miami");
  assert.equal(snapshot.moneyActivationPlan.firstSprintPlan.targetRows <= 10, true);
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.status, "blocked");
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.requiredEvidence.some((item) => item.id === "production_database" && item.status === "blocked"), true);
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.requiredEvidence.some((item) => item.id === "robert_deploy_approval" && item.status === "blocked"), true);
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.status, "blocked");
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.requiredEnv.some((item) => item.key === "DATABASE_URL" && item.status === "blocked"), true);
  assert.equal(snapshot.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.requiredEnv.some((item) => item.key === "SESSION_SECRET" && item.status === "blocked"), true);
  assert.match(snapshot.moneyActivationPlan.copyableBrief, /Can contact businesses: no/);
  assert.match(snapshot.moneyActivationPlan.copyableBrief, /Can collect money: no/);
});

test("production setup packet stays blocked until durable hydration succeeds", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.SESSION_SECRET = "revenue-engine-production-session-secret";

  const packet = getRevenueEngineSnapshot().moneyActivationPlan.productionLaunchChecklist.productionSetupPacket;

  assert.equal(packet.status, "blocked");
  assert.equal(packet.requiredEnv.some((item) => item.key === "DATABASE_URL" && item.status === "blocked"), true);
  assert.equal(packet.requiredEnv.some((item) => item.key === "SESSION_SECRET" && item.status === "ready"), true);
  assert.match(packet.copyableSetupPacket, /Revenue Engine production setup packet/);
  assert.match(packet.copyableSetupPacket, /npm run ceo:doctor -- --json/);
  assert.match(packet.copyableSetupPacket, /No operar leads\/cobros\/entregas reales con local_file persistence/);
});

test("production setup packet blocks weak session secret", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.SESSION_SECRET = "short";

  const packet = getRevenueEngineSnapshot().moneyActivationPlan.productionLaunchChecklist.productionSetupPacket;

  assert.equal(packet.status, "blocked");
  assert.equal(packet.requiredEnv.some((item) => item.key === "DATABASE_URL" && item.status === "blocked"), true);
  assert.equal(packet.requiredEnv.some((item) => item.key === "SESSION_SECRET" && item.status === "blocked"), true);
  assert.match(packet.copyableSetupPacket, /SESSION_SECRET no detectado como secret real/);
  assert.match(packet.copyableSetupPacket, /npm run ceo:doctor -- --json/);
});

test("money activation evidence gate mirrors public lead import readiness", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";

  recordRevenuePublicLeadCandidate({
    businessName: "Gate Ready Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@gateready.example",
    sourceUrl: "https://example.com/gate-ready-cafe",
    recipientEmail: "owner@gateready.example",
    evidence: "Public listing shows no dedicated website, current menu photos and a verified owner email.",
    painPoint: "Needs online menu, catering inquiry capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Gate Ready Cafe has public evidence of no dedicated website and a clear website opportunity.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
  });
  recordRevenuePublicLeadCandidate({
    businessName: "Gate Blocked Spa",
    area: "Miami",
    niche: "spa",
    websiteStatus: "unknown",
    contactChannel: "unknown",
    contactValue: "",
    sourceUrl: "https://example.com/gate-blocked-spa",
    recipientEmail: "",
    evidence: "Short note needs more public verification.",
    painPoint: "Needs review before import.",
    estimatedOfferUsd: 1000,
    status: "research",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
  });

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.publicLeadImportQueue.status, "ready");
  assert.equal(snapshot.publicLeadImportQueue.readyCount, 1);
  assert.equal(snapshot.publicLeadImportQueue.blockedCount, 1);
  assert.equal(snapshot.moneyActivationPlan.evidenceGate.status, "ready");
  assert.equal(snapshot.moneyActivationPlan.evidenceGate.readyCandidates, snapshot.publicLeadImportQueue.readyCount);
  assert.equal(snapshot.moneyActivationPlan.evidenceGate.blockedCandidates, snapshot.publicLeadImportQueue.blockedCount);
  assert.match(snapshot.moneyActivationPlan.evidenceGate.nextAction, /Money Sprint/);
  assert.match(snapshot.moneyActivationPlan.copyableBrief, /Ready candidates: 1/);
  assert.match(snapshot.moneyActivationPlan.firstSprintPlan.copyableBrief, /Blocked candidates: 1/);
});

test("records sold apps and automations into revenue metrics", () => {
  const result = recordRevenueLedgerEntry({
    kind: "bundle_sale",
    clientName: "Black Room",
    amountUsd: 6000,
    cashCollectedUsd: 3000,
    estimatedInternalCostUsd: 64,
    notes: "Website 3D Premium + Automation Sprint | Stripe pi_blackroom_3000",
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.guardrail.status, "ok");
  assert.equal(snapshot.metrics.appsSold, 1);
  assert.equal(snapshot.metrics.automationsSold, 1);
  assert.equal(snapshot.metrics.revenueUsd, 6000);
  assert.equal(snapshot.metrics.cashCollectedUsd, 3000);
  assert.equal(snapshot.metrics.estimatedSpendUsd, 64);
  assert.equal(snapshot.metrics.profitUsd, 2936);
  assert.equal(snapshot.executiveSummary.appsSold, 1);
  assert.equal(snapshot.executiveSummary.automationsSold, 1);
  assert.equal(snapshot.executiveSummary.cashCollectedUsd, 3000);
  assert.equal(snapshot.executiveSummary.status, "ready");
  assert.equal(snapshot.pipelineStages.some((stage) => stage.id === "closed" && stage.count === 1 && stage.valueUsd === 6000), true);
});

test("blocks ledger income cash without verifiable payment evidence", () => {
  const result = recordRevenueLedgerEntry({
    kind: "bundle_sale",
    clientName: "Weak Cash Claim",
    amountUsd: 6000,
    cashCollectedUsd: 3000,
    estimatedInternalCostUsd: 64,
    notes: "Deposit collected",
  });

  assert.equal(result.entry, null);
  assert.equal(result.guardrail.status, "blocked");
  assert.match(result.guardrail.reason, /comprobante verificable/);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 0);
  assert.equal(result.snapshot.metrics.revenueUsd, 0);
  assert.equal(result.snapshot.profitGuard.status, "collect_first");

  const bareStripePrefix = recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Bare Prefix Claim",
    amountUsd: 2500,
    cashCollectedUsd: 1250,
    estimatedInternalCostUsd: 35,
    notes: "No Stripe pi_ yet",
  });

  assert.equal(bareStripePrefix.entry, null);
  assert.equal(bareStripePrefix.guardrail.status, "blocked");
  assert.equal(bareStripePrefix.snapshot.metrics.cashCollectedUsd, 0);
});

test("blocks zero-cash income rows from being counted as sold revenue", () => {
  const result = recordRevenueLedgerEntry({
    kind: "website_sale",
    clientName: "Unpaid Client",
    amountUsd: 3500,
    cashCollectedUsd: 0,
    estimatedInternalCostUsd: 25,
    notes: "Proposal accepted but no payment received",
  });

  assert.equal(result.entry, null);
  assert.equal(result.guardrail.status, "blocked");
  assert.match(result.guardrail.reason, /cashCollectedUsd mayor que 0/);
  assert.equal(result.snapshot.metrics.appsSold, 0);
  assert.equal(result.snapshot.metrics.revenueUsd, 0);
});

test("allows ledger income when a real payment reference appears in notes", () => {
  const result = recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Late Reference Client",
    amountUsd: 2500,
    cashCollectedUsd: 1250,
    estimatedInternalCostUsd: 35,
    notes: "Automation Sprint deposit collected after invoice review | notes ok | Stripe payment id pi_lateRef1250",
  });

  assert.equal(result.entry?.kind, "automation_sale");
  assert.equal(result.guardrail.status, "ok");
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 1250);
});

test("blocks ledger expense when spend is higher than collected cash", () => {
  const result = recordRevenueLedgerEntry({
    kind: "expense",
    clientName: "Lead tools",
    amountUsd: 25,
    cashCollectedUsd: 0,
    estimatedInternalCostUsd: 0,
    notes: "Paid outreach test",
  });

  assert.equal(result.entry, null);
  assert.equal(result.guardrail.status, "blocked");
  assert.equal(result.guardrail.reason.includes("cash cobrado"), true);
  assert.equal(result.snapshot.metrics.estimatedSpendUsd, 0);
  assert.equal(result.snapshot.metrics.profitUsd, 0);
  assert.equal(result.snapshot.profitGuard.status, "collect_first");
  assert.equal(result.snapshot.profitGuard.canSpendUsd, 0);
});

test("expense preflight blocks spend before cash or cap allow it", () => {
  const result = preflightRevenueExpense({
    concept: "Paid lead data",
    amountUsd: 25,
    estimatedInternalCostUsd: 0,
    notes: "Proposed spend before collecting deposit.",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.blockers.some((blocker) => blocker.includes("cash")), true);
  assert.equal(result.snapshot.metrics.estimatedSpendUsd, 0);
  assert.equal(result.nextAction.includes("No gastar"), true);
});

test("profit guard collects first before any external spend", () => {
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.profitGuard.status, "collect_first");
  assert.equal(snapshot.profitGuard.canSpendUsd, 0);
  assert.equal(snapshot.profitGuard.requiredActions.includes("cobrar deposito"), true);
  assert.equal(snapshot.nextBatchPlan.status, "collect_first");
  assert.equal(snapshot.nextBatchPlan.maxSpendUsd, 0);
  assert.equal(snapshot.agentOperatingContract.mode, "draft_only");
  assert.equal(snapshot.agentOperatingContract.requiresHumanApproval.includes("gastar dinero"), true);
  assert.equal(snapshot.operatorConsole.canSpendNow, false);
  assert.equal(snapshot.operatorConsole.nextCommand.includes("cobrar deposito"), true);
  assert.equal(snapshot.operatorConsole.moneyLine.includes("0 apps/websites"), true);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "separate_area" && item.status === "ready"), true);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "ask_when_unclear" && item.status === "ready"), true);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "production_persistence" && item.status === "needs_data"), true);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "continuous_improvement" && item.status === "needs_data"), true);
});

test("system readiness blocks production money mode without real database url", () => {
  process.env.NODE_ENV = "production";
  delete process.env.DATABASE_URL;

  const snapshot = getRevenueEngineSnapshot();
  const persistenceItem = snapshot.systemReadiness.items.find((item) => item.id === "production_persistence");

  assert.equal(persistenceItem?.status, "blocked");
  assert.match(persistenceItem?.evidence || "", /DATABASE_URL is required in production/);
  assert.equal(snapshot.systemReadiness.blocked > 0, true);
  assert.equal(snapshot.launchReadiness.status, "blocked");
  assert.equal(snapshot.dailyMoneyCommand.status, "blocked");
  assert.equal(snapshot.dailyMoneyCommand.runPacket.status, "blocked");
  assert.equal(snapshot.dailyMoneyCommand.runPacket.apiAction, "/api/revenue-engine/expense-preflight");
  assert.match(snapshot.dailyMoneyCommand.runPacket.input, /concept, amountUsd=0/);
  assert.match(snapshot.dailyMoneyCommand.runPacket.gate, /DATABASE_URL/);
  assert.doesNotMatch(snapshot.dailyMoneyCommand.runPacket.apiAction, /scout-dispatch/);
  assert.match(snapshot.dailyMoneyCommand.copyableOperatorBrief, /Next run packet/);
  assert.match(snapshot.dailyMoneyCommand.copyableOperatorBrief, /production DATABASE_URL missing/);
});

test("system readiness rejects a database url until durable state is hydrated", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";

  const snapshot = getRevenueEngineSnapshot();
  const persistenceItem = snapshot.systemReadiness.items.find((item) => item.id === "production_persistence");

  assert.equal(persistenceItem?.status, "needs_data");
  assert.match(persistenceItem?.evidence || "", /falta hidratar y verificar Postgres durable/);
});

test("profit guard allows small scale only when cash covers spend", () => {
  recordRevenueLedgerEntry({
    kind: "bundle_sale",
    clientName: "Cash Client",
    amountUsd: 5000,
    cashCollectedUsd: 2500,
    estimatedInternalCostUsd: 40,
    notes: "Zelle ref cash-client-2500",
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.profitGuard.status, "scale_carefully");
  assert.equal(snapshot.profitGuard.canSpendUsd, 60);
  assert.equal(snapshot.profitGuard.remainingCapUsd, 60);
  assert.equal(snapshot.agentOperatingContract.mode, "controlled_autopilot");
  assert.equal(snapshot.agentOperatingContract.blockedActions.length, 0);
  assert.equal(snapshot.operatorConsole.canSpendNow, true);
  assert.equal(snapshot.operatorConsole.spendPermission.includes("60 USD"), true);
  assert.equal(snapshot.operatorConsole.scoreboard.cashCollectedUsd, 2500);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "dont_spend_more_than_cash" && item.status === "ready"), true);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "controlled_autonomy" && item.status === "ready"), true);
});

test("expense preflight approves only within cash and monthly cap", () => {
  recordRevenueLedgerEntry({
    kind: "bundle_sale",
    clientName: "Preflight Cash Client",
    amountUsd: 3000,
    cashCollectedUsd: 1500,
    estimatedInternalCostUsd: 25,
    notes: "Stripe pi_preflight_1500",
  });

  const result = preflightRevenueExpense({
    concept: "Small approved data check",
    amountUsd: 15,
    estimatedInternalCostUsd: 0,
    notes: "Preflight only.",
  });

  assert.equal(result.status, "approved");
  assert.equal(result.projected.spendUsd, 40);
  assert.equal(result.projected.cashCoverageUsd, 1460);
  assert.equal(result.snapshot.metrics.estimatedSpendUsd, 25);
});

test("records ledger expense only after cash covers spend and cap remains safe", () => {
  recordRevenueLedgerEntry({
    kind: "bundle_sale",
    clientName: "Expense Safe Client",
    amountUsd: 3000,
    cashCollectedUsd: 1500,
    estimatedInternalCostUsd: 25,
    notes: "Stripe pi_expense_safe_1500",
  });

  const result = recordRevenueLedgerEntry({
    kind: "expense",
    clientName: "Approved lead check",
    amountUsd: 15,
    cashCollectedUsd: 0,
    estimatedInternalCostUsd: 0,
    notes: "Small approved spend.",
  });

  assert.equal(result.entry?.kind, "expense");
  assert.equal(result.guardrail.status, "ok");
  assert.equal(result.snapshot.metrics.estimatedSpendUsd, 40);
  assert.equal(result.snapshot.metrics.profitUsd, 1460);
});

test("records approval decisions without bypassing spend guardrails", () => {
  const result = recordRevenueApprovalDecision({
    targetId: "manual",
    targetType: "manual",
    decision: "approved",
    approvedAction: "Aprobar research y mockup interno",
    maxSpendUsd: 0,
    notes: "No external spend.",
  });

  assert.equal(result.decision.guardrail.status, "recorded");
  assert.equal(result.snapshot.recentApprovalDecisions[0].approvedAction, "Aprobar research y mockup interno");
});

test("records non-approval decisions against explicit queue targets", () => {
  const result = recordRevenueApprovalDecision({
    targetId: "outreach-draft-1",
    targetType: "outbox",
    decision: "needs_changes",
    approvedAction: "Reescribir propuesta antes de contacto externo",
    maxSpendUsd: 0,
    notes: "El target exacto de la cola necesita cambios.",
  });

  assert.equal(result.decision.targetId, "outreach-draft-1");
  assert.equal(result.decision.targetType, "outbox");
  assert.equal(result.decision.decision, "needs_changes");
  assert.equal(result.decision.guardrail.status, "recorded");
  assert.equal(result.snapshot.recentApprovalDecisions[0].decision, "needs_changes");
});

test("blocks approval decisions that try to spend before profit guard allows it", () => {
  const result = recordRevenueApprovalDecision({
    targetId: "paid-data",
    targetType: "manual",
    decision: "approved",
    approvedAction: "Comprar data de leads",
    maxSpendUsd: 25,
    notes: "Trying paid data before cash.",
  });

  assert.equal(result.decision.guardrail.status, "blocked");
  assert.equal(result.decision.guardrail.reason.includes("No se puede aprobar gasto"), true);
  assert.equal(result.snapshot.recentApprovalDecisions[0].guardrail.status, "blocked");
});

test("persists approval decisions across module state reloads", () => {
  recordRevenueApprovalDecision({
    targetId: "manual",
    targetType: "manual",
    decision: "needs_changes",
    approvedAction: "Revisar copy antes de enviar",
    maxSpendUsd: 0,
    notes: "Needs tighter proof.",
  });

  setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentApprovalDecisions[0].decision, "needs_changes");
  assert.equal(snapshot.recentApprovalDecisions[0].approvedAction, "Revisar copy antes de enviar");
}
);

test("qualifies no-website leads for mockup when evidence and contact exist", () => {
  const result = recordRevenueLead({
    businessName: "No Site Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "instagram",
    contactValue: "@nositecafe",
    evidence: "Instagram active weekly, no website in bio, menu only in posts.",
    painPoint: "Needs online menu, events capture and catering leads.",
    estimatedOfferUsd: 2500,
    status: "research",
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.qualification.grade, "A");
  assert.equal(result.lead.status, "mockup_ready");
  assert.equal(snapshot.pipelineStages.some((stage) => stage.id === "mockup" && stage.count === 1 && stage.valueUsd === 2500), true);
});

test("deduplicates repeated revenue leads by business area and contact", () => {
  const first = recordRevenueLead({
    businessName: "No Site Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "instagram",
    contactValue: "@nositecafe",
    evidence: "Instagram active weekly, no website in bio, menu only in posts.",
    painPoint: "Needs online menu and catering leads.",
    estimatedOfferUsd: 2500,
    status: "research",
  });
  const second = recordRevenueLead({
    businessName: "No Site Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "weak_website",
    contactChannel: "instagram",
    contactValue: "@nositecafe",
    evidence: "Updated public evidence confirms no booking CTA and only Instagram ordering.",
    painPoint: "Needs booking, catering capture and follow-up.",
    estimatedOfferUsd: 3500,
    status: "research",
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.lead.id, second.lead.id);
  assert.equal(second.lead.estimatedOfferUsd, 3500);
  assert.equal(snapshot.recentLeads.length, 1);
  assert.equal(snapshot.pipelineStages.some((stage) => stage.id === "mockup" && stage.count === 1 && stage.valueUsd === 3500), true);
});

test("deduplicated revenue leads do not regress advanced pipeline status", () => {
  const leadResult = recordRevenueLead({
    businessName: "Advanced Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@advanced.example",
    evidence: "Google listing has no website and Instagram bio only points to posts.",
    painPoint: "Needs online menu, catering capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "research",
  });

  recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "owner@advanced.example",
    contactName: "Owner",
    businessName: "Advanced Cafe",
    sourceUrl: "https://example.com/advanced-cafe",
    businessSummary: "Advanced Cafe has public evidence of weak/no website and needs online menu, catering capture and follow-up.",
    websitePriceUsd: 2700,
    automationPriceUsd: 1500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "Draft created first.",
  });

  const duplicate = recordRevenueLead({
    businessName: "Advanced Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "unknown",
    contactChannel: "email",
    contactValue: "owner@advanced.example",
    evidence: "",
    painPoint: "",
    estimatedOfferUsd: 1500,
    status: "research",
  });

  assert.equal(duplicate.deduped, true);
  assert.equal(duplicate.lead.status, "outreach_ready");
  assert.equal(duplicate.lead.estimatedOfferUsd, 4200);
});

test("deduplicated disqualified update cannot remove proposal leads from pipeline", () => {
  recordRevenueLead({
    businessName: "Proposal Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@proposal.example",
    evidence: "Google listing has no website and catering menu only appears in Instagram posts.",
    painPoint: "Needs online menu, catering capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "proposal_sent",
  });

  const duplicate = recordRevenueLead({
    businessName: "Proposal Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "unknown",
    contactChannel: "email",
    contactValue: "owner@proposal.example",
    evidence: "",
    painPoint: "",
    estimatedOfferUsd: 1500,
    status: "disqualified",
  });

  assert.equal(duplicate.deduped, true);
  assert.equal(duplicate.lead.status, "proposal_sent");
});

test("persists leads across module state reloads", () => {
  recordRevenueLead({
    businessName: "Persisted Lead",
    area: "Miami",
    niche: "salon",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "hello@example.com",
    evidence: "Website loads slowly and has no booking CTA.",
    painPoint: "Needs booking follow-up.",
    estimatedOfferUsd: 3500,
    status: "research",
  });

  setRevenueLeadsPathForTests(testLeadsPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentLeads[0].businessName, "Persisted Lead");
  assert.equal(snapshot.pipelineStages.some((stage) => stage.id === "mockup" && stage.count === 1), true);
});

test("builds a sellable mockup with 3D brief and automation guardrails", () => {
  const mockup = buildRevenueMockup({
    businessName: "No Site Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    evidence: "Instagram active weekly, no website in bio, menu only in posts.",
    painPoint: "Needs online menu, events capture and catering leads.",
    primaryOffer: "Website 3D Premium + Automation Sprint",
    estimatedOfferUsd: 3500,
    includeAutomation: true,
  });

  assert.equal(mockup.decision.status, "mockup_ready");
  assert.equal(mockup.offer.insideCostCap, true);
  assert.equal(mockup.visualSystem.threeDSceneBrief.length > 0, true);
  assert.equal(mockup.sections.some((section) => section.id === "automation"), true);
  assert.equal(mockup.qa.some((check) => check.agent === "closer" && check.result === "approval_required"), true);
});

test("writes a local revenue mockup preview without publishing externally", () => {
  const preview = buildRevenueMockupPreview({
    businessName: "No Site Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    evidence: "Instagram active weekly, no website in bio, menu only in posts.",
    painPoint: "Needs online menu, events capture and catering leads.",
    primaryOffer: "Website 3D Premium + Automation Sprint",
    estimatedOfferUsd: 3500,
    includeAutomation: true,
  });

  assert.equal(preview.status, "mockup_ready");
  assert.equal(preview.fileWritten, true);
  assert.match(preview.previewUrl, /^\/api\/revenue-engine\/mockup-previews\//);
  assert.equal("previewPath" in preview, false);
  const previewPath = getRevenueMockupPreviewPath(preview.slug);
  assert.equal(existsSync(previewPath), true);
  const html = readFileSync(previewPath, "utf8");
  assert.match(html, /No Site Cafe/);
  assert.match(html, /QA gates before contact/);
  assert.match(html, /data-three-scene="revenue-preview"/);
  assert.match(html, /import \* as THREE from '\/api\/revenue-engine\/assets\/three\.module\.js'/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self' 'sha256-/);
  const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(moduleScript);
  const moduleHash = createHash("sha256").update(moduleScript).digest("base64");
  assert.match(html, new RegExp(`script-src 'self' 'sha256-${moduleHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /scene-fallback/);
  assert.match(html, /A clearer guest journey/);
  assert.doesNotMatch(html, /patient journey|Premium care|next appointment/);
  assert.equal((html.match(/<section\b/g) || []).length, (html.match(/<\/section>/g) || []).length);
  assert.equal(preview.guardrails.some((item) => item.includes("No requiere hosting pagado")), true);
});

test("escapes dynamic lead content in the revenue mockup preview", () => {
  const preview = buildRevenueMockupPreview({
    businessName: '<script>alert("name")</script>',
    area: '<img src=x onerror=alert("area")>',
    niche: "local services",
    websiteStatus: "weak_website",
    evidence: "Public source has enough verified evidence.",
    painPoint: '<script>alert("pain")</script>',
    primaryOffer: '<img src=x onerror=alert("offer")>',
    estimatedOfferUsd: 2400,
    includeAutomation: true,
  });

  const html = readFileSync(getRevenueMockupPreviewPath(preview.slug), "utf8");
  assert.doesNotMatch(html, /<script>alert\("name"\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\("area"\)>/);
  assert.doesNotMatch(html, /<script>alert\("pain"\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;name&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(&quot;area&quot;\)&gt;/);
});

test("serves revenue mockup previews over the generated route", async () => {
  await prepareRevenueEngineState("preview-owner");
  const preview = buildRevenueMockupPreview({
    businessName: "Route Ready Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    evidence: "Instagram active weekly, no website in bio, and catering requests are handled in comments.",
    painPoint: "Needs a previewable menu and inquiry funnel.",
    primaryOffer: "Website 3D Premium + Automation Sprint",
    estimatedOfferUsd: 3500,
    includeAutomation: true,
  });
  const app = express();
  app.use(express.json());
  // Explicit test-only authenticated session. A caller-controlled x-user-id
  // header is deliberately not authentication.
  app.use((req, _res, next) => {
    if (req.header("x-fixture-session") === "authenticated-preview-owner") {
      (req as any).user = { id: "preview-owner" };
    }
    next();
  });
  const server = createHttpServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/api/revenue-engine/mockup-previews`;

    const unauthenticated = await fetch(`${baseUrl}/${preview.slug}`);
    assert.equal(unauthenticated.status, 401);
    const spoofed = await fetch(`${baseUrl}/${preview.slug}`, { headers: { "x-user-id": "preview-owner" } });
    assert.equal(spoofed.status, 401);

    const response = await fetch(`${baseUrl}/${preview.slug}`, { headers: { "x-fixture-session": "authenticated-preview-owner" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    const responseBody = await response.text();
    assert.match(responseBody, /Route Ready Cafe/);
    assert.match(responseBody, /QA gates before contact/);
    assert.match(response.headers.get("content-security-policy") || "", /script-src 'self' 'sha256-/);
    assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'self'/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");

    const invalid = await fetch(`${baseUrl}/%2E%2E%2Fbad`, { headers: { "x-fixture-session": "authenticated-preview-owner" } });
    assert.equal(invalid.status, 400);

    const missing = await fetch(`${baseUrl}/missing-preview`, { headers: { "x-fixture-session": "authenticated-preview-owner" } });
    assert.equal(missing.status, 404);

    const previewPath = getRevenueMockupPreviewPath(preview.slug);
    const validHtml = readFileSync(previewPath, "utf8");
    writeFileSync(previewPath, validHtml.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i, ""), "utf8");
    try {
      const insecure = await fetch(`${baseUrl}/${preview.slug}`, { headers: { "x-fixture-session": "authenticated-preview-owner" } });
      assert.equal(insecure.status, 500);
      assert.deepEqual(await insecure.json(), { error: "Mockup preview security policy missing" });
    } finally {
      writeFileSync(previewPath, validHtml, "utf8");
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("extracts a revenue preview CSP independent of meta attribute order", () => {
  const policy = "default-src 'none'; frame-ancestors 'self'";
  const html = `<meta content="${policy}" data-preview="secure" http-equiv="Content-Security-Policy">`;
  assert.equal(extractRevenueMockupContentSecurityPolicy(html), policy);
  assert.equal(extractRevenueMockupContentSecurityPolicy('<meta charset="utf-8">'), null);
});

test("builds production plan only when commercial and cost gates pass", () => {
  const plan = buildRevenueProjectPlan({
    clientName: "No Site Cafe",
    projectType: "bundle",
    packageName: "Website 3D Premium + Automation Sprint",
    setupUsd: 4725,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Website and lead follow-up",
  });

  assert.equal(plan.decision.status, "ready_to_build");
  assert.equal(plan.budget.insideCostCap, true);
  assert.equal(plan.phases.some((phase) => phase.ownerAgent === "qa-council"), true);
  assert.equal(plan.subagentCorrections.some((item) => item.agent === "cost-controller"), true);
});

test("builds concise client-facing outreach without exposing internal economics", () => {
  const proposal = buildProposalEmail({
    recipientEmail: "owner@example.com",
    contactName: "Owner",
    businessName: "Route Ready Cafe",
    sourceUrl: "https://example.com/private-research-source",
    businessSummary: "INTERNAL ONLY margin 93%. Source https://private.example/research. Estimated internal cost $54/month. The public booking journey is difficult to follow.",
    websitePriceUsd: 1992,
    automationPriceUsd: 933,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "INTERNAL ONLY: keep this out of client copy.",
  });

  assert.match(proposal.subject, /Route Ready Cafe/);
  assert.match(proposal.body, /Robert Websites/);
  assert.match(proposal.body, /\$2,925/);
  assert.match(proposal.body, /\$1,463/);
  assert.match(proposal.body, /15-minute call/);
  assert.doesNotMatch(proposal.body, /Costo interno|Margen mensual|Cap interno|INTERNAL ONLY|private-research-source|private\.example|93%|\$54|Revenue Engine/i);
  assert.equal(proposal.body.length < 1800, true);
});

test("defaults new website proposals to the accessible mid-tier price", () => {
  const proposal = buildProposalEmail({
    recipientEmail: "owner@example.com",
    contactName: "Owner",
    businessName: "Accessible Price Co",
    businessSummary: "Public website opportunity with a verified contact path.",
    automationPriceUsd: 0,
    monthlyRetainerUsd: 0,
    estimatedInternalMonthlyCostUsd: 0,
  });

  assert.equal(proposal.pricing.totalSetupUsd, 1500);
  assert.equal(proposal.pricing.depositUsd, 750);
  assert.match(proposal.body, /Initial project: \$1,500/);
});

test("does not convert an automation-only draft into a 700 dollar website opportunity", () => {
  const lead = recordRevenueLead({
    businessName: "Automation Only Co",
    area: "Miami",
    niche: "professional services",
    websiteStatus: "has_website",
    contactChannel: "email",
    contactValue: "owner@automation-only.example",
    evidence: "Public company profile and owner email are verified.",
    painPoint: "Needs a lead follow-up workflow.",
    estimatedOfferUsd: 1500,
    status: "qualified",
  }).lead;
  const draft = recordRevenueOutreachDraft({
    leadId: lead.id,
    channel: "email",
    approvalStatus: "draft",
    recipientEmail: "owner@automation-only.example",
    contactName: "Owner",
    businessName: lead.businessName,
    sourceUrl: "https://example.com/automation-only",
    mockupUrl: "/api/revenue-engine/mockup-previews/automation-only",
    businessSummary: "Verified automation opportunity with no website scope.",
    websitePriceUsd: 0,
    automationPriceUsd: 1500,
    monthlyRetainerUsd: 0,
    estimatedInternalMonthlyCostUsd: 0,
  }).draft;
  approveRevenueOutreachDraft({ draftId: draft.id, approvedByRobert: true });

  const result = recordRevenueWebsiteOpportunity({ leadId: lead.id, outreachDraftId: draft.id, projectType: "website" });

  assert.equal(result.status, "blocked");
  assert.equal(result.opportunity, null);
  assert.equal(result.gates.some((gate) => gate.gate === "website_scope" && !gate.passed), true);
  const snapshot = getRevenueEngineSnapshot();
  assert.equal(snapshot.websiteSalesPacketQueue.items.some((item) => item.leadId === lead.id), false);
  assert.equal(snapshot.websiteSalesPacketQueue.blocked.some((item) => item.leadId === lead.id && item.reason.includes("precio de website")), true);
});

test("records outreach draft without sending and moves matching lead to outreach", () => {
  const leadResult = recordRevenueLead({
    businessName: "Black Room",
    area: "Miami",
    niche: "techno events",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "info@blackroom.miami",
    evidence: "Website has events, videos, shop and community content.",
    painPoint: "Needs stronger conversion tracking and follow-up.",
    estimatedOfferUsd: 6700,
    status: "research",
  });

  const result = recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "owner@example.com",
    contactName: "Robert",
    businessName: "Black Room",
    sourceUrl: "https://blackroomus.com",
    businessSummary: "Black Room is a Miami Techno community with events, videos, shop, residents, academy and newsletter.",
    websitePriceUsd: 4500,
    automationPriceUsd: 2200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "Test quote",
  });

  assert.equal(result.draft.status, "draft");
  assert.equal(result.draft.delivery.sendStatus, "not_sent");
  assert.equal(result.draft.qaGates.some((gate) => gate.gate === "approval" && gate.passed === false), true);
  assert.equal(result.syncedLead?.status, "outreach_ready");
  assert.equal(result.snapshot.recentOutreach[0].businessName, "Black Room");
  assert.equal(result.snapshot.metrics.approvalQueue, 1);
  assert.equal(result.snapshot.approvalQueueItems.some((item) => item.source === "outbox" && item.title === "Black Room"), true);
});

test("approves outreach draft for manual queue without sending or side effects", () => {
  const leadResult = recordRevenueLead({
    businessName: "Approve Draft Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@approvedraft.example",
    evidence: "Public listing has no website, current menu photos and a visible owner email.",
    painPoint: "Needs online menu and catering inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const draftResult = recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "owner@approvedraft.example",
    contactName: "Owner",
    businessName: "Approve Draft Cafe",
    sourceUrl: "https://example.com/approve-draft-cafe",
    businessSummary: "Approve Draft Cafe has public evidence of no website, recent menu photos and a verified owner contact path.",
    websitePriceUsd: 3200,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });
  const statusBeforeApproval = getRevenueEngineSnapshot().recentLeads[0].status;

  const result = approveRevenueOutreachDraft({
    draftId: draftResult.draft.id,
    approvedByRobert: true,
    notes: "Robert approved manual outreach.",
  });

  assert.equal(result.status, "approved");
  assert.equal(result.draft?.status, "approved");
  assert.equal(result.draft?.qaGates.find((gate) => gate.gate === "approval")?.passed, true);
  assert.equal(result.draft?.delivery.sendStatus, "not_sent");
  assert.equal(result.draft?.delivery.sentAt, undefined);
  assert.equal(result.draft?.delivery.externalMessageId, undefined);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.spendsMoney, false);
  assert.equal(result.safety.createsLedger, false);
  assert.equal(result.safety.createsDelivery, false);
  assert.equal(result.snapshot.manualOutreachQueue.readyCount, 1);
  assert.equal(result.snapshot.recentLeads[0].status, statusBeforeApproval);
  assert.equal(result.snapshot.recentLedger.length, 0);
  assert.equal(result.snapshot.recentDeliveryWorkspaces.length, 0);
});

test("editing an outreach draft saves copy and requires Robert to approve it again", () => {
  const leadResult = recordRevenueLead({
    businessName: "Editable Spa",
    area: "Miami",
    niche: "med spa",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "owner@editablespa.example",
    evidence: "Public business page lists an owner email and current services but has no clear booking path.",
    painPoint: "Needs a clearer offer and booking conversion path.",
    estimatedOfferUsd: 1500,
    status: "qualified",
  });
  const draftResult = recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@editablespa.example",
    contactName: "Owner",
    businessName: "Editable Spa",
    sourceUrl: "https://example.com/editable-spa",
    businessSummary: "Editable Spa has a verified public email and a clear website conversion opportunity.",
    websitePriceUsd: 1500,
    automationPriceUsd: 0,
    monthlyRetainerUsd: 0,
    estimatedInternalMonthlyCostUsd: 0,
  });

  const result = updateRevenueOutreachDraft({
    draftId: draftResult.draft.id,
    subject: "Una idea sencilla para llenar más citas",
    body: "Hola, revisé su presencia digital y preparé una propuesta concreta para convertir más visitas en citas verificables.",
  });

  assert.equal(result.status, "updated");
  assert.equal(result.draft?.subject, "Una idea sencilla para llenar más citas");
  assert.equal(result.draft?.status, "draft");
  assert.equal(result.draft?.approvalStatus, "draft");
  assert.equal(result.draft?.qaGates.find((gate) => gate.gate === "approval")?.passed, false);
  assert.equal(result.safety.sendsOutreach, false);
});

test("daily money command blocks real contact queue until production persistence is ready", () => {
  const leadResult = recordRevenueLead({
    businessName: "Local Persistence Contact Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@localcontact.example",
    evidence: "Public listing has no website, current menu photos and a visible owner email.",
    painPoint: "Needs online menu and catering inquiry capture.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const draftResult = recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "owner@localcontact.example",
    contactName: "Owner",
    businessName: "Local Persistence Contact Cafe",
    sourceUrl: "https://example.com/local-persistence-contact-cafe",
    businessSummary: "Local Persistence Contact Cafe has public evidence of no website and a verified contact path.",
    websitePriceUsd: 3200,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const approved = approveRevenueOutreachDraft({
    draftId: draftResult.draft.id,
    approvedByRobert: true,
    notes: "Robert approved manual outreach, but persistence is still local_file.",
  });

  assert.equal(approved.snapshot.manualOutreachQueue.readyCount, 1);
  assert.equal(approved.snapshot.systemReadiness.items.some((item) => item.id === "production_persistence" && item.status === "needs_data"), true);
  assert.equal(approved.snapshot.dailyMoneyCommand.status, "blocked");
  assert.equal(approved.snapshot.dailyMoneyCommand.runPacket.status, "blocked");
  assert.equal(approved.snapshot.dailyMoneyCommand.runPacket.apiAction, "/api/revenue-engine/expense-preflight");
  assert.doesNotMatch(approved.snapshot.dailyMoneyCommand.runPacket.apiAction, /outreach-outcome|outreach-send|website-opportunities|delivery-workspace/);
  assert.match(approved.snapshot.dailyMoneyCommand.copyableOperatorBrief, /production DATABASE_URL missing/);
});

test("blocks outreach draft approval when non-approval QA gates fail", () => {
  const draftResult = recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "",
    contactName: "Owner",
    businessName: "Blocked Approval Cafe",
    businessSummary: "Too short",
    websitePriceUsd: 3200,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const result = approveRevenueOutreachDraft({
    draftId: draftResult.draft.id,
    approvedByRobert: true,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /recipient\/evidence\/cost/);
  assert.equal(result.draft?.status, "blocked");
  assert.equal(result.draft?.qaGates.find((gate) => gate.gate === "approval")?.passed, false);
  assert.equal(result.draft?.delivery.sendStatus, "not_sent");
  assert.equal(result.snapshot.manualOutreachQueue.readyCount, 0);
  assert.equal(result.snapshot.recentLeads.length, 0);
  assert.equal(result.snapshot.recentLedger.length, 0);
});

test("blocks outreach draft approval without explicit Robert approval", () => {
  const draftResult = recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "owner@noapproval.example",
    contactName: "Owner",
    businessName: "No Approval Cafe",
    sourceUrl: "https://example.com/no-approval-cafe",
    businessSummary: "No Approval Cafe has public evidence of no website, current menu photos and a verified contact path.",
    websitePriceUsd: 3200,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const result = approveRevenueOutreachDraft({
    draftId: draftResult.draft.id,
    approvedByRobert: false,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /Robert/);
  assert.equal(result.draft?.status, "draft");
  assert.equal(result.snapshot.manualOutreachQueue.readyCount, 0);
});

test("blocks outreach draft approval after the draft was already sent", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  let sendCount = 0;
  setRevenueOutreachSenderForTests(async () => {
    sendCount += 1;
    return { id: "email_already_sent" };
  });
  const draftResult = recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@already-sent.example",
    contactName: "Owner",
    businessName: "Already Sent Cafe",
    sourceUrl: "https://example.com/already-sent-cafe",
    businessSummary: "Already Sent Cafe has public evidence of no website, current menu photos and a verified contact path.",
    websitePriceUsd: 3200,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });
  const sendResult = await sendRevenueOutreachDraft({
    draftId: draftResult.draft.id,
    approvalToSend: true,
  });

  const result = approveRevenueOutreachDraft({
    draftId: draftResult.draft.id,
    approvedByRobert: true,
  });

  assert.equal(sendResult.status, "sent");
  assert.equal(sendCount, 1);
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /ya fue enviado/);
  assert.equal(result.draft?.delivery.sendStatus, "sent");
  assert.equal(result.draft?.delivery.externalMessageId, "email_already_sent");
  assert.equal(sendCount, 1);
});

test("snapshot builds a capped manual outreach queue from approved drafts", () => {
  for (let index = 1; index <= 12; index += 1) {
    recordRevenueOutreachDraft({
      channel: "gmail",
      approvalStatus: "approved",
      recipientEmail: `owner${index}@queuecafe.example`,
      contactName: "Owner",
      businessName: `Queue Cafe ${index}`,
      sourceUrl: `https://example.com/queue-cafe-${index}`,
      businessSummary: `Queue Cafe ${index} has public evidence of no dedicated website, recent menu/service activity, and a verified contact path for a premium website pitch.`,
      websitePriceUsd: 2500 + index * 100,
      automationPriceUsd: 1000,
      monthlyRetainerUsd: 750,
      estimatedInternalMonthlyCostUsd: 54,
    });
  }
  recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "owner@needsapproval.example",
    contactName: "Owner",
    businessName: "Needs Approval Cafe",
    sourceUrl: "https://example.com/needs-approval",
    businessSummary: "Needs Approval Cafe has public evidence of no dedicated website, recent menu activity, and a verified contact path.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const queue = getRevenueEngineSnapshot().manualOutreachQueue;

  assert.equal(queue.status, "ready");
  assert.equal(queue.dailyContactLimit, 10);
  assert.equal(queue.readyCount, 10);
  assert.equal(queue.overflowCount, 2);
  assert.equal(queue.blockedCount, 3);
  assert.equal(queue.safety.sendsOutreach, false);
  assert.equal(queue.safety.requiresHumanApproval, true);
  assert.equal(queue.items.every((item) => item.contactUrl.includes("mail.google.com")), true);
  assert.equal(queue.items.every((item) => item.depositUsd > 0), true);
  assert.equal(queue.items.every((item) => item.nextAction.includes("registrar contacted/reply/call/deposito")), true);
  assert.equal(queue.items.every((item) => item.copyableContactPacket.includes("Manual outreach packet")), true);
  assert.equal(queue.items.every((item) => item.copyableContactPacket.includes("Do not auto-send")), true);
  assert.equal(queue.items.every((item) => item.paymentEvidenceRequired.length >= 4), true);
  assert.equal(queue.items.every((item) => item.copyableCloseEvidencePacket.includes("Manual close evidence packet")), true);
  assert.equal(queue.items.every((item) => item.copyableCloseEvidencePacket.includes("Scope approval must be explicit")), true);
  assert.equal(queue.items.every((item) => item.copyableCloseEvidencePacket.includes("Do not create delivery workspace")), true);
  const contactedRequest = revenueOutreachOutcomeSchema.parse(JSON.parse(queue.items[0].copyableOutcomeRequests.contacted));
  assert.equal(contactedRequest.draftId, queue.items[0].draftId);
  assert.equal(contactedRequest.outcome, "contacted");
  assert.equal(contactedRequest.outcomeRecordedByRobert, true);
  const depositRequest = revenueOutreachOutcomeSchema.parse(JSON.parse(queue.items[0].copyableOutcomeRequests.depositCollected));
  assert.equal(depositRequest.outcome, "deposit_collected");
  assert.equal(depositRequest.cashCollectedUsd, queue.items[0].depositUsd);
  assert.equal(depositRequest.paymentConfirmation, "");
  assert.equal(queue.blocked.some((item) => item.businessName === "Needs Approval Cafe" && item.reason.includes("Robert")), true);
  assert.equal(queue.blocked.filter((item) => item.reason.includes("Daily contact limit reached")).length, 2);
});

test("manual outreach queue uses public source URLs for non-email channels and caps blocked details", () => {
  recordRevenueOutreachDraft({
    channel: "instagram",
    approvalStatus: "approved",
    recipientEmail: "",
    contactName: "Owner",
    businessName: "Insta Queue Studio",
    sourceUrl: "https://instagram.com/instaqueuestudio",
    businessSummary: "Insta Queue Studio has public evidence of no dedicated website, recent service content, and Instagram as its visible contact path.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });
  recordRevenueOutreachDraft({
    channel: "contact_form",
    approvalStatus: "approved",
    recipientEmail: "",
    contactName: "Owner",
    businessName: "Form Queue Studio",
    sourceUrl: "https://example.com/form-queue/contact",
    businessSummary: "Form Queue Studio has public evidence of a weak website, visible contact form, and a clear booking follow-up opportunity.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });
  for (let index = 1; index <= 12; index += 1) {
    recordRevenueOutreachDraft({
      channel: "gmail",
      approvalStatus: "draft",
      recipientEmail: `owner${index}@blockedqueue.example`,
      contactName: "Owner",
      businessName: `Blocked Queue ${index}`,
      sourceUrl: `https://example.com/blocked-queue-${index}`,
      businessSummary: `Blocked Queue ${index} has public evidence but still needs Robert approval before any manual contact.`,
      websitePriceUsd: 3000,
      automationPriceUsd: 1000,
      monthlyRetainerUsd: 750,
      estimatedInternalMonthlyCostUsd: 54,
    });
  }
  recordRevenueOutreachDraft({
    channel: "contact_form",
    approvalStatus: "approved",
    recipientEmail: "owner@mockuponly.example",
    contactName: "Owner",
    businessName: "Mockup Only Form",
    mockupUrl: "https://example.com/mockup-only-preview",
    businessSummary: "Mockup Only Form has a preview but still needs the public contact form URL before manual contact.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const queue = getRevenueEngineSnapshot().manualOutreachQueue;
  const instagramItem = queue.items.find((item) => item.businessName === "Insta Queue Studio")!;
  const contactFormItem = queue.items.find((item) => item.businessName === "Form Queue Studio")!;

  assert.equal(instagramItem.contactUrl, "https://instagram.com/instaqueuestudio");
  assert.equal(instagramItem.fallbackUrl, "");
  assert.match(instagramItem.copyableContactPacket, /Open: https:\/\/instagram\.com\/instaqueuestudio/);
  assert.match(instagramItem.copyableContactPacket, /Fallback: none/);
  assert.match(instagramItem.copyableContactPacket, /Subject:/);
  assert.match(instagramItem.copyableCloseEvidencePacket, /Contact URL: https:\/\/instagram\.com\/instaqueuestudio/);
  assert.match(instagramItem.copyableCloseEvidencePacket, /Keep sensitive payment artifacts out of public issues/);
  assert.equal(contactFormItem.contactUrl, "https://example.com/form-queue/contact");
  assert.equal(contactFormItem.fallbackUrl, "");
  assert.match(contactFormItem.copyableContactPacket, /Open: https:\/\/example\.com\/form-queue\/contact/);
  assert.match(contactFormItem.copyableCloseEvidencePacket, /Contact URL: https:\/\/example\.com\/form-queue\/contact/);
  assert.equal(queue.items.some((item) => item.businessName === "Mockup Only Form"), false);
  assert.equal(queue.blockedCount, 13);
  assert.equal(queue.blocked.length, 10);
  assert.equal(queue.blocked.some((item) => item.businessName === "Mockup Only Form" && item.reason.includes("sourceUrl")), true);
});

test("sales autopilot prepares lead mockup agent QA and draft without sending", () => {
  const result = recordRevenueSalesAutopilot({
    businessName: "Autopilot Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@example.com",
    evidence: "Google listing has no website, Instagram bio has no link, menu only appears in posts.",
    painPoint: "Needs online menu, catering lead capture and follow-up.",
    request: "Create a 3D website with lead capture, catering inquiry follow-up and weekly owner dashboard.",
    projectType: "bundle",
    estimatedOfferUsd: 4200,
    estimatedInternalCostUsd: 54,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 0,
    recipientEmail: "owner@example.com",
    contactName: "Owner",
    sourceUrl: "https://example.com/autopilot-cafe",
    businessSummary: "Autopilot Cafe has public evidence of no website and needs a stronger online menu, catering capture and follow-up system.",
    monthlyRetainerUsd: 750,
    approvalToContact: false,
    approvalToSpend: false,
    approvalToBuild: false,
  });

  assert.equal(result.status, "approval_required");
  assert.equal(result.lead.status, "outreach_ready");
  assert.equal(result.mockup.decision.status, "mockup_ready");
  assert.equal(result.agentRun.status, "approval_required");
  assert.equal(result.deliveryReview.status, "blocked");
  assert.equal(result.outreachDraft?.status, "draft");
  assert.equal(result.requiredBeforeExternalAction.includes("aprobar contacto externo"), true);
  assert.equal(result.snapshot.recentOutreach[0].delivery.sendStatus, "not_sent");
  assert.equal(result.snapshot.approvalQueueItems.some((item) => item.source === "agent_run" && item.title === "Autopilot Cafe"), true);
  assert.equal(result.snapshot.approvalQueueItems.some((item) => item.source === "outbox" && item.title === "Autopilot Cafe"), true);
});

test("sales autopilot blocks generic source urls before creating lead or outreach", () => {
  const result = recordRevenueSalesAutopilot({
    businessName: "Generic Autopilot Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@genericautopilot.example",
    evidence: "Generic directory page claims many coffee shops need websites but does not tie this business to the contact path.",
    painPoint: "Needs online menu, catering lead capture and follow-up.",
    request: "Create a 3D website with lead capture, catering inquiry follow-up and weekly owner dashboard.",
    projectType: "bundle",
    estimatedOfferUsd: 4200,
    estimatedInternalCostUsd: 54,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 0,
    recipientEmail: "owner@genericautopilot.example",
    contactName: "Owner",
    sourceUrl: "https://example.com",
    businessSummary: "Generic Autopilot Cafe should not create a sales packet from a generic homepage.",
    monthlyRetainerUsd: 750,
    approvalToContact: true,
    approvalToSpend: false,
    approvalToBuild: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.requiredBeforeExternalAction.includes("sourceUrl must match business/contact evidence"), true);
  assert.equal(result.lead, null);
  assert.equal(result.mockup, null);
  assert.equal(result.agentRun, null);
  assert.equal(result.deliveryReview, null);
  assert.equal(result.outreachDraft, null);
  assert.equal(result.snapshot.recentLeads.length, 0);
  assert.equal(result.snapshot.recentOutreach.length, 0);
  assert.equal(result.snapshot.recentAgentRuns.length, 0);
});

test("money sprint creates scout queue previews leads and draft-only outreach", () => {
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeads: [
      {
        businessName: "Sprint Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@sprintcafe.example",
        evidence: "Google listing has no website, Instagram bio has no link, menu only appears in posts.",
        painPoint: "Needs online menu, catering inquiry capture and follow-up.",
        estimatedOfferUsd: 4200,
        status: "research",
        sourceUrl: "https://example.com/sprint-cafe-listing",
        recipientEmail: "owner@sprintcafe.example",
        contactName: "Owner",
        businessSummary: "Sprint Cafe has public evidence of no website and needs a stronger online menu, catering capture and follow-up system.",
      },
    ],
  });

  assert.equal(result.status, "ready_to_start");
  assert.equal(result.scoutQueue.length > 0, true);
  assert.equal(result.scoutWorkPack.searchPlaybook.prioritizedSources.some((source) => source.query.includes("coffee shop Miami")), true);
  assert.match(result.scoutWorkPack.searchPlaybook.copyableBrief, /Do not contact businesses before Robert approval/);
  assert.equal(result.operatingLimits.maxPaidDataSpendUsd, 0);
  assert.equal(result.recordedLeads.length, 1);
  assert.equal(result.recordedLeads[0].qualification.grade, "A");
  assert.equal(result.previews.length, 1);
  assert.equal("previewPath" in result.previews[0], false);
  assert.equal(existsSync(getRevenueMockupPreviewPath(result.previews[0].slug)), true);
  assert.equal(result.outreachDrafts.length, 1);
  assert.equal(result.outreachDrafts[0].status, "draft");
  assert.equal(result.outreachDrafts[0].mockupUrl, result.previews[0].previewUrl);
  assert.equal(result.outreachDrafts[0].delivery.sendStatus, "not_sent");
  assert.equal(result.approvalGates.some((gate) => gate.includes("No outbound email")), true);
  assert.equal(result.snapshot.recentLeads[0].businessName, "Sprint Cafe");
  assert.equal(result.snapshot.websiteSalesPacketQueue.readyCount, 1);
  assert.equal(result.snapshot.websiteSalesPacketQueue.items[0].draftStatus, "draft");
  assert.match(result.snapshot.websiteSalesPacketQueue.items[0].closePlan.copyableClosePacket, /internal_only_pending_robert_approval/);
  assert.match(result.snapshot.websiteSalesPacketQueue.items[0].closePlan.copyableClosePacket, /do not send this close ask/);
  assert.equal(result.snapshot.websiteDeliveryHandoffQueue.readyCount, 0);
  assert.equal(result.snapshot.recentWebsiteOpportunities.length, 0);

  const approval = approveRevenueOutreachDraft({
    draftId: result.outreachDrafts[0].id,
    approvedByRobert: true,
    notes: "Robert approved Sprint Cafe for manual contact.",
  });
  assert.equal(approval.status, "approved");
  assert.equal(approval.snapshot.websiteSalesPacketQueue.items[0].draftStatus, "approved");
  assert.match(approval.snapshot.websiteSalesPacketQueue.items[0].closePlan.copyableClosePacket, /approved_for_manual_contact/);
  assert.equal(approval.snapshot.manualOutreachQueue.readyCount, 1);
  assert.equal(approval.snapshot.recentOutreach[0].delivery.sendStatus, "not_sent");
});

test("website delivery handoff queue requires a sold website opportunity", async () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  const readyLead = recordRevenueLead({
    businessName: "Older Ready Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@olderready.example",
    evidence: "Public listing has no website, recent menu photos and verified owner email.",
    painPoint: "Needs menu capture and catering inquiry follow-up.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const readyDraft = recordRevenueOutreachDraft({
    leadId: readyLead.lead.id,
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "owner@olderready.example",
    contactName: "Owner",
    businessName: "Older Ready Cafe",
    sourceUrl: "https://example.com/older-ready-cafe",
    mockupUrl: "/api/revenue-engine/mockup-previews/older-ready-cafe",
    businessSummary: "Older Ready Cafe has public evidence of no website and a clear need for menu capture.",
    websitePriceUsd: 3200,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "Draft only; no outreach sent.",
  });

  await new Promise((resolve) => setTimeout(resolve, 2));

  for (let index = 0; index < 9; index += 1) {
    recordRevenueLead({
      businessName: `Newer Blocked Cafe ${index + 1}`,
      area: "Miami",
      niche: "coffee shop",
      websiteStatus: "no_website",
      contactChannel: "email",
      contactValue: `owner${index + 1}@blocked.example`,
      evidence: "Public listing has no website, recent menu photos and verified owner contact.",
      painPoint: "Needs online menu.",
      estimatedOfferUsd: 3000,
      status: "qualified",
    });
  }

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.websiteSalesPacketQueue.readyCount, 1);
  assert.equal(snapshot.dailyMoneyCommand.status, "contact");
  const contactRequest = revenueOutreachOutcomeSchema.parse(JSON.parse(snapshot.dailyMoneyCommand.runPacket.copyableApiRequest));
  assert.equal(contactRequest.draftId, readyDraft.draft.id);
  assert.equal(contactRequest.outcome, "reply");
  assert.doesNotMatch(snapshot.dailyMoneyCommand.runPacket.copyableApiRequest, /REPLACE_WITH_MANUAL_CONTACT_DRAFT_ID/);
  assert.equal(snapshot.websiteDeliveryHandoffQueue.readyCount, 0);
  assert.equal(snapshot.websiteDeliveryHandoffQueue.blockedCount, 0);

  const opportunityResult = recordRevenueWebsiteOpportunity({
    leadId: readyLead.lead.id,
    outreachDraftId: readyDraft.draft.id,
    projectType: "bundle",
  });
  assert.equal(opportunityResult.status, "quoted");
  assert.equal(opportunityResult.opportunity?.depositPaid, false);
  assert.equal(opportunityResult.snapshot.websiteDeliveryHandoffQueue.readyCount, 0);
  assert.equal(opportunityResult.snapshot.websiteDeliveryHandoffQueue.blockedCount, 1);

  const scopedOnlyResult = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity!.id,
    depositPaid: false,
    scopeApproved: true,
    cashCollectedUsd: 0,
    notes: "Scope approved by Robert; deposit still pending.",
  });

  assert.equal(scopedOnlyResult.status, "blocked");
  assert.equal(scopedOnlyResult.opportunity?.status, "scope_approved");
  assert.equal(scopedOnlyResult.opportunity?.scopeApproved, true);
  assert.equal(scopedOnlyResult.snapshot.websiteDeliveryHandoffQueue.readyCount, 0);
  assert.equal(scopedOnlyResult.snapshot.websiteClosureQueue.readyCount, 1);
  assert.equal(scopedOnlyResult.snapshot.websiteClosureQueue.items[0].opportunityId, opportunityResult.opportunity?.id);
  assert.equal(scopedOnlyResult.snapshot.websiteClosureQueue.items[0].closureStage, "collect_deposit");
  const closeRequest = revenueWebsiteOpportunityCloseSchema.parse(
    JSON.parse(scopedOnlyResult.snapshot.websiteClosureQueue.items[0].copyableCloseRequest)
  );
  assert.equal(closeRequest.opportunityId, opportunityResult.opportunity?.id);
  assert.equal(closeRequest.depositPaid, false);
  assert.equal(closeRequest.scopeApproved, true);
  assert.equal(closeRequest.cashCollectedUsd, 0);
  assert.equal(closeRequest.paymentConfirmation, "");
  assert.equal(scopedOnlyResult.snapshot.websiteClosureQueue.safety.sendsOutreach, false);
  assert.equal(scopedOnlyResult.snapshot.websiteClosureQueue.safety.collectsPaymentAutomatically, false);
  assert.equal(scopedOnlyResult.snapshot.dailyMoneyCommand.status, "collect");
  assert.equal(scopedOnlyResult.snapshot.dailyMoneyCommand.runPacket.status, "collect");
  assert.equal(scopedOnlyResult.snapshot.dailyMoneyCommand.runPacket.apiAction, "/api/revenue-engine/website-opportunities/close");
  assert.match(scopedOnlyResult.snapshot.dailyMoneyCommand.runPacket.input, /opportunityId=/);
  assert.match(scopedOnlyResult.snapshot.dailyMoneyCommand.runPacket.gate, /No delivery workspace/);
  const dailyCloseRequest = revenueWebsiteOpportunityCloseSchema.parse(JSON.parse(scopedOnlyResult.snapshot.dailyMoneyCommand.runPacket.copyableApiRequest));
  assert.equal(dailyCloseRequest.opportunityId, opportunityResult.opportunity!.id);
  assert.equal(dailyCloseRequest.depositPaid, false);
  assert.equal(dailyCloseRequest.scopeApproved, true);
  assert.equal(dailyCloseRequest.cashCollectedUsd, 0);
  assert.doesNotMatch(scopedOnlyResult.snapshot.dailyMoneyCommand.runPacket.copyableApiRequest, /REPLACE_WITH_WEBSITE_OPPORTUNITY_ID/);

  const preservedOpportunity = recordRevenueWebsiteOpportunity({
    leadId: readyLead.lead.id,
    outreachDraftId: readyDraft.draft.id,
    projectType: "bundle",
  });
  assert.equal(preservedOpportunity.opportunity?.status, "scope_approved");

  const depositOutcome = recordRevenueOutreachOutcome({
    draftId: readyDraft.draft.id,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd: opportunityResult.opportunity!.requiredDepositUsd,
    paymentConfirmation: "Zelle ref scoped-deposit-123",
    notes: "Robert confirmed deposit after scope.",
  });
  assert.equal(depositOutcome.status, "recorded");

  const closeResult = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity!.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: opportunityResult.opportunity!.requiredDepositUsd,
    paymentConfirmation: "Zelle ref scoped-deposit-123",
  });

  assert.equal(closeResult.status, "sold");
  assert.equal(closeResult.opportunity?.status, "sold");
  assert.equal(closeResult.snapshot.websiteClosureQueue.readyCount, 0);
  assert.equal(closeResult.snapshot.websiteDeliveryHandoffQueue.readyCount, 1);
  assert.equal(closeResult.snapshot.websiteDeliveryHandoffQueue.items[0].opportunityId, opportunityResult.opportunity?.id);
  assert.equal(closeResult.snapshot.websiteDeliveryHandoffQueue.items[0].leadId, readyLead.lead.id);
  assert.equal(closeResult.snapshot.websiteDeliveryHandoffQueue.items[0].outreachDraftId, readyDraft.draft.id);
  assert.equal(closeResult.snapshot.dailyMoneyCommand.status, "collect");
  assert.equal(closeResult.snapshot.dailyMoneyCommand.runPacket.apiAction, "/api/revenue-engine/website-delivery-workspace");
  const dailyWorkspaceRequest = JSON.parse(closeResult.snapshot.dailyMoneyCommand.runPacket.copyableApiRequest);
  assert.equal(dailyWorkspaceRequest.leadId, readyLead.lead.id);
  assert.equal(dailyWorkspaceRequest.outreachDraftId, readyDraft.draft.id);
  assert.equal(dailyWorkspaceRequest.websiteOpportunityId, opportunityResult.opportunity!.id);
  assert.equal(dailyWorkspaceRequest.branchName, "codex/client-older-ready-cafe-website");
  assert.equal(dailyWorkspaceRequest.repoFullName, "REPLACE_WITH_APPROVED_OWNER_REPO");
  assert.doesNotMatch(closeResult.snapshot.dailyMoneyCommand.runPacket.copyableApiRequest, /REPLACE_WITH_SOLD_LEAD_ID/);
  assert.equal(closeResult.snapshot.metrics.appsSold, 1);
});

test("website opportunity close requires recorded manual deposit outcome", () => {
  const { lead, draft } = createApprovedWebsiteDraftForTest({
    businessName: "No Manual Deposit Cafe",
    contactEmail: "owner@nomanualdeposit.example",
    sourceUrl: "https://example.com/no-manual-deposit-cafe",
    mockupSlug: "no-manual-deposit-cafe",
  });
  const opportunityResult = recordRevenueWebsiteOpportunity({
    leadId: lead.id,
    outreachDraftId: draft.id,
    projectType: "website",
  });
  assert.equal(opportunityResult.status, "quoted");

  const fakeClose = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity!.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: opportunityResult.opportunity!.requiredDepositUsd,
    paymentConfirmation: "Robert confirmed deposit.",
  });

  assert.equal(fakeClose.status, "blocked");
  assert.match(fakeClose.reason, /deposito manual no registrado/);
  assert.equal(fakeClose.opportunity?.depositPaid, false);
  assert.equal(fakeClose.opportunity?.cashCollectedUsd, 0);
  assert.equal(fakeClose.snapshot.metrics.cashCollectedUsd, 0);
  assert.equal(fakeClose.snapshot.recentLedger.length, 0);
  assert.equal(fakeClose.snapshot.websiteDeliveryHandoffQueue.readyCount, 0);
});

test("website closure request packet does not auto-approve missing scope", () => {
  const { lead, draft } = createApprovedWebsiteDraftForTest({
    businessName: "Scope Pending Cafe",
    contactEmail: "owner@scopepending.example",
    sourceUrl: "https://example.com/scope-pending-cafe",
    mockupSlug: "scope-pending-cafe",
  });
  const opportunityResult = recordRevenueWebsiteOpportunity({
    leadId: lead.id,
    outreachDraftId: draft.id,
    projectType: "website",
  });
  const depositOutcome = recordRevenueOutreachOutcome({
    draftId: draft.id,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd: opportunityResult.opportunity!.requiredDepositUsd,
    paymentConfirmation: "Stripe pi_scope_pending_123",
    notes: "Robert verified deposit, but scope is still pending.",
  });
  assert.equal(depositOutcome.status, "recorded");

  const closureItem = depositOutcome.snapshot.websiteClosureQueue.items.find((item) =>
    item.opportunityId === opportunityResult.opportunity!.id
  )!;
  assert.equal(closureItem.closureStage, "approve_scope");
  const closeRequest = revenueWebsiteOpportunityCloseSchema.parse(JSON.parse(closureItem.copyableCloseRequest));
  assert.equal(closeRequest.depositPaid, true);
  assert.equal(closeRequest.scopeApproved, false);
  assert.equal(closeRequest.cashCollectedUsd, opportunityResult.opportunity!.requiredDepositUsd);
  assert.equal(closeRequest.paymentConfirmation, "Stripe pi_scope_pending_123");

  const pastedClose = closeRevenueWebsiteOpportunity(closeRequest);
  assert.equal(pastedClose.status, "blocked");
  assert.match(pastedClose.reason, /scope no aprobado/);
  assert.equal(pastedClose.opportunity?.status, "quoted");
  assert.equal(pastedClose.snapshot.websiteDeliveryHandoffQueue.readyCount, 0);
  assert.equal(pastedClose.snapshot.recentLedger.length, 0);
});

test("website closure queue keeps older money-ready opportunities visible", () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  const oldReady = createApprovedWebsiteDraftForTest({
    businessName: "Older Closure Cafe",
    contactEmail: "owner@olderclosure.example",
    sourceUrl: "https://example.com/older-closure-cafe",
    mockupSlug: "older-closure-cafe",
  });
  const oldOpportunity = recordRevenueWebsiteOpportunity({
    leadId: oldReady.lead.id,
    outreachDraftId: oldReady.draft.id,
    projectType: "website",
  });
  assert.equal(oldOpportunity.status, "quoted");

  const scopedOnly = closeRevenueWebsiteOpportunity({
    opportunityId: oldOpportunity.opportunity!.id,
    depositPaid: false,
    scopeApproved: true,
    cashCollectedUsd: 0,
    notes: "Scope approved but deposit still pending.",
  });
  assert.equal(scopedOnly.status, "blocked");
  assert.equal(scopedOnly.opportunity?.status, "scope_approved");

  for (let index = 1; index <= 29; index += 1) {
    const newer = createApprovedWebsiteDraftForTest({
      businessName: `Newer Closure Cafe ${index}`,
      contactEmail: `owner${index}@newerclosure.example`,
      sourceUrl: `https://example.com/newer-closure-cafe-${index}`,
      mockupSlug: `newer-closure-cafe-${index}`,
    });
    const newerOpportunity = recordRevenueWebsiteOpportunity({
      leadId: newer.lead.id,
      outreachDraftId: newer.draft.id,
      projectType: "website",
    });
    assert.equal(newerOpportunity.status, "quoted");
  }

  const snapshot = getRevenueEngineSnapshot();
  assert.equal(snapshot.recentWebsiteOpportunities.some((item) => item.id === oldOpportunity.opportunity!.id), false);
  assert.equal(snapshot.websiteClosureQueue.readyCount, 30);
  assert.equal(snapshot.websiteClosureQueue.items.length, 30);
  assert.equal(snapshot.websiteClosureQueue.items.some((item) => item.opportunityId === oldOpportunity.opportunity!.id), true);
  const olderClosure = snapshot.websiteClosureQueue.items.find((item) => item.opportunityId === oldOpportunity.opportunity!.id)!;
  assert.equal(olderClosure.closureStage, "collect_deposit");
  assert.match(olderClosure.copyableClosurePacket, /Deposit required/);
  assert.equal(snapshot.dailyMoneyCommand.status, "collect");
  assert.equal(snapshot.dailyMoneyCommand.funnel.websiteClosuresPending, 30);
});

test("sold website opportunity keeps original paid draft identity when a newer draft exists", () => {
  const { lead, draft: originalDraft } = createApprovedWebsiteDraftForTest({
    businessName: "Stable Sold Draft Cafe",
    contactEmail: "owner@stablesolddraft.example",
    sourceUrl: "https://example.com/stable-sold-draft-cafe-original",
    mockupSlug: "stable-sold-draft-original",
  });
  const soldOpportunity = sellWebsiteOpportunityForTest({
    leadId: lead.id,
    outreachDraftId: originalDraft.id,
    projectType: "website",
  });

  const newerDraft = recordRevenueOutreachDraft({
    leadId: lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@stablesolddraft.example",
    contactName: "Owner",
    businessName: "Stable Sold Draft Cafe",
    sourceUrl: "https://example.com/stable-sold-draft-cafe-newer",
    mockupUrl: "/api/revenue-engine/mockup-previews/stable-sold-draft-newer",
    businessSummary: "Stable Sold Draft Cafe has a revised package after the original sale.",
    websitePriceUsd: 2200,
    automationPriceUsd: 0,
    monthlyRetainerUsd: 400,
    estimatedInternalMonthlyCostUsd: 40,
    notes: "Later revised draft should not replace the paid sale chain.",
  });
  assert.equal(newerDraft.draft.status, "approved");

  const reboundAttempt = recordRevenueWebsiteOpportunity({
    leadId: lead.id,
    outreachDraftId: newerDraft.draft.id,
    projectType: "website",
  });
  const snapshot = reboundAttempt.snapshot;
  const handoffItem = snapshot.websiteDeliveryHandoffQueue.items.find((item) => item.opportunityId === soldOpportunity.id);

  assert.equal(reboundAttempt.status, "already_sold");
  assert.equal(reboundAttempt.opportunity?.id, soldOpportunity.id);
  assert.equal(reboundAttempt.opportunity?.sourceOutreachDraftId, originalDraft.id);
  assert.equal(reboundAttempt.opportunity?.outreachDraftId, originalDraft.id);
  assert.equal(reboundAttempt.opportunity?.mockupUrl, originalDraft.mockupUrl);
  assert.equal(reboundAttempt.opportunity?.sourceUrl, originalDraft.sourceUrl);
  assert.notEqual(reboundAttempt.opportunity?.sourceOutreachDraftId, newerDraft.draft.id);
  assert.ok(handoffItem);
  assert.equal(handoffItem.outreachDraftId, originalDraft.id);
  assert.equal(handoffItem.mockupUrl, originalDraft.mockupUrl);
});

test("website delivery handoff uses sold opportunity draft when outreach draft id is omitted", () => {
  const { lead, draft: originalDraft } = createApprovedWebsiteDraftForTest({
    businessName: "Implicit Sold Draft Cafe",
    contactEmail: "owner@implicitsolddraft.example",
    sourceUrl: "https://example.com/implicit-sold-draft-cafe-original",
    mockupSlug: "implicit-sold-draft-original",
  });
  const soldOpportunity = sellWebsiteOpportunityForTest({
    leadId: lead.id,
    outreachDraftId: originalDraft.id,
    projectType: "website",
  });

  const newerDraft = recordRevenueOutreachDraft({
    leadId: lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@implicitsolddraft.example",
    contactName: "Owner",
    businessName: "Implicit Sold Draft Cafe",
    sourceUrl: "https://example.com/implicit-sold-draft-cafe-newer",
    mockupUrl: "/api/revenue-engine/mockup-previews/implicit-sold-draft-newer",
    businessSummary: "Implicit Sold Draft Cafe has a later revised package after the original sale.",
    websitePriceUsd: 2200,
    automationPriceUsd: 0,
    monthlyRetainerUsd: 400,
    estimatedInternalMonthlyCostUsd: 40,
    notes: "Later revised draft should not become the delivery chain.",
  });
  assert.equal(newerDraft.draft.status, "approved");

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.id,
    websiteOpportunityId: soldOpportunity.id,
    projectType: "website",
    repoFullName: "robert/implicit-sold-draft-cafe",
    branchName: "codex/client-implicit-sold-draft-cafe-website",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: soldOpportunity.requiredDepositUsd,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  assert.equal(handoff.status, "created");
  assert.equal(handoff.outreachDraft?.id, originalDraft.id);
  assert.notEqual(handoff.outreachDraft?.id, newerDraft.draft.id);
  assert.equal(handoff.workspace?.input.outreachDraftId, undefined);
  assert.equal(handoff.workspace?.input.sourceOpportunityId, soldOpportunity.id);
  assert.equal(handoff.workspace?.input.mockupUrl, originalDraft.mockupUrl);
});

test("website sales packet queue keeps older ready packages visible", () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  const older = createApprovedWebsiteDraftForTest({
    businessName: "Older Sales Packet Cafe",
    contactEmail: "owner@oldersalespacket.example",
    sourceUrl: "https://example.com/older-sales-packet-cafe",
    mockupSlug: "older-sales-packet-cafe",
  });

  for (let index = 1; index <= 101; index += 1) {
    createApprovedWebsiteDraftForTest({
      businessName: `Newer Sales Packet Cafe ${index}`,
      contactEmail: `owner${index}@salespacket.example`,
      sourceUrl: `https://example.com/newer-sales-packet-cafe-${index}`,
      mockupSlug: `newer-sales-packet-cafe-${index}`,
    });
  }

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentLeads.some((item) => item.id === older.lead.id), false);
  assert.equal(snapshot.websiteSalesPacketQueue.readyCount, 102);
  assert.equal(snapshot.websiteSalesPacketQueue.items.length, 102);
  assert.equal(snapshot.websiteSalesPacketQueue.items.some((item) => item.leadId === older.lead.id), true);
  const olderPacket = snapshot.websiteSalesPacketQueue.items.find((item) => item.leadId === older.lead.id)!;
  assert.equal(olderPacket.outreachDraftId, older.draft.id);
  assert.match(olderPacket.copyableSalesPacket, /Older Sales Packet Cafe/);
  assert.equal(snapshot.dailyMoneyCommand.status, "contact");
  assert.equal(snapshot.dailyMoneyCommand.funnel.salesPacketsReady, 102);
});

test("public scout evidence reaches PR-first website delivery handoff", () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  const publicEvidence = recordRevenuePublicScoutEvidence({
    area: "Miami",
    niche: "coffee shop",
    evidenceText: [
      "Business: Public Path Cafe",
      "Area: Miami",
      "Niche: coffee shop",
      "Website: no website",
      "Contact: owner@publicpath.example",
      "Email: owner@publicpath.example",
      "Source: https://example.com/public-path-cafe",
      "Evidence: Public listing has no dedicated website, recent menu photos and a verified owner email contact path.",
      "Pain: Needs online menu, catering inquiry capture and automated follow-up.",
    ].join("\n"),
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
    approvedByRobert: true,
    defaultOfferUsd: 4200,
    maxCandidates: 1,
  });
  const candidate = publicEvidence.recorded[0]?.candidate;
  assert.equal(publicEvidence.status, "ready_for_preview");
  assert.ok(candidate);

  const publicSprint = runRevenueMoneySprintFromPublicCandidates({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    candidateIds: [candidate.id],
    maxCandidates: 1,
  });
  assert.equal(publicSprint.status, "started");
  assert.deepEqual(publicSprint.importedCandidateIds, [candidate.id]);
  assert.equal(publicSprint.safety.sendsOutreach, false);

  const publicLead = publicSprint.sprint?.recordedLeads[0]?.lead;
  const publicDraft = publicSprint.sprint?.outreachDrafts[0];
  const publicPreview = publicSprint.sprint?.previews[0];
  assert.ok(publicLead);
  assert.ok(publicDraft);
  assert.ok(publicPreview);
  assert.equal(publicDraft.delivery.sendStatus, "not_sent");

  const publicApproval = approveRevenueOutreachDraft({
    draftId: publicDraft.id,
    approvedByRobert: true,
    notes: "Robert approved manual follow-up after public scout review.",
  });
  assert.equal(publicApproval.status, "approved");

  const publicOpportunity = sellWebsiteOpportunityForTest({
    leadId: publicLead.id,
    outreachDraftId: publicDraft.id,
    projectType: "website",
    cashCollectedUsd: publicDraft.pricing.depositUsd,
  });
  assert.equal(publicOpportunity.status, "sold");

  const publicHandoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: publicLead.id,
    outreachDraftId: publicDraft.id,
    websiteOpportunityId: publicOpportunity.id,
    mockupUrl: publicPreview.previewUrl,
    projectType: "website",
    repoFullName: "robert/public-path-cafe",
    branchName: "codex/client-public-path-cafe-website",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: publicDraft.pricing.depositUsd,
    publicDataVerified: true,
    visualQaPassed: false,
    technicalQaPassed: false,
    automationQaPassed: true,
    clientHandoffReady: false,
    notes: "Public scout path created a sold website workspace for PR-first build.",
  });

  assert.equal(publicHandoff.status, "created");
  assert.equal(publicHandoff.workspace?.input.sourceLeadId, publicLead.id);
  assert.equal(publicHandoff.workspace?.input.sourceOpportunityId, publicOpportunity.id);
  assert.equal(publicHandoff.workspace?.input.repoFullName, "robert/public-path-cafe");
  assert.equal(publicHandoff.workspace?.input.branchName, "codex/client-public-path-cafe-website");
  assert.equal(publicHandoff.workspace?.input.sourceUrl, "https://example.com/public-path-cafe");
  assert.equal(publicHandoff.workspace?.input.mockupUrl, publicPreview.previewUrl);
  assert.equal(publicHandoff.workspace?.codexBuildHandoff.status, "needs_pr");
  assert.match(publicHandoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /PR-first client build handoff/);
  assert.match(publicHandoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Target branch: codex\/client-public-path-cafe-website/);
  assert.match(publicHandoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Public source: https:\/\/example\.com\/public-path-cafe/);
  assert.equal(publicHandoff.snapshot.websiteBuildHandoffQueue.openCount, 1);
  const publicSurfaces = [
    publicHandoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "",
    publicHandoff.workspace?.codexBuildHandoff.publicBuildBrief || "",
    publicHandoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack || "",
    publicHandoff.snapshot.websiteBuildHandoffQueue.items[0]?.publicBuildBrief || "",
    publicHandoff.snapshot.websiteBuildHandoffQueue.items[0]?.buildPack.copyableBuildPack || "",
  ];
  for (const surface of publicSurfaces) {
    assert.match(surface, /Public Path Cafe/);
    assert.match(surface, /codex\/client-public-path-cafe-website/);
    assert.doesNotMatch(surface, /Deposit paid:|Setup: \$|Retainer:|Cash collected|Stripe|pi_test/i);
  }
  assert.equal(publicHandoff.snapshot.dailyMoneyCommand.status, "build");
  assert.equal(publicHandoff.snapshot.dailyMoneyCommand.runPacket.apiAction, "/api/revenue-engine/delivery-workspaces/github-handoff");
  assert.equal(publicHandoff.snapshot.recentLedger.some((entry) => entry.kind === "website_sale" && entry.clientName === "Public Path Cafe"), true);
  assert.equal(publicHandoff.snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(publicHandoff.snapshot.recentOutreach.some((draft) => draft.id === publicDraft.id && draft.delivery.outcome === "deposit_collected"), true);
});

test("creates website delivery workspace from money sprint lead mockup and outreach context", () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  const sprint = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeads: [
      {
        businessName: "Handoff Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@handoffcafe.example",
        evidence: "Google listing has no website, public social profile has menu photos and a verified owner email.",
        painPoint: "Needs online menu, catering inquiry capture and follow-up.",
        estimatedOfferUsd: 4200,
        status: "research",
        sourceUrl: "https://example.com/handoff-cafe-listing",
        recipientEmail: "owner@handoffcafe.example",
        contactName: "Owner",
        businessSummary: "Handoff Cafe has no dedicated website and needs a stronger online menu, catering capture and follow-up system.",
      },
    ],
  });
  const lead = sprint.recordedLeads[0].lead;
  const draft = sprint.outreachDrafts[0];
  const preview = sprint.previews[0];
  const approval = approveRevenueOutreachDraft({
    draftId: draft.id,
    approvedByRobert: true,
    notes: "Robert approved website opportunity follow-up.",
  });
  assert.equal(approval.status, "approved");
  const preHandoffSnapshot = getRevenueEngineSnapshot();

  assert.equal(preHandoffSnapshot.websiteSalesPacketQueue.readyCount, 1);
  assert.equal(preHandoffSnapshot.websiteSalesPacketQueue.items[0].leadId, lead.id);
  assert.equal(preHandoffSnapshot.websiteSalesPacketQueue.items[0].mockupUrl, preview.previewUrl);
  assert.match(preHandoffSnapshot.websiteSalesPacketQueue.items[0].copyableSalesPacket, /Handoff Cafe/);
  assert.match(preHandoffSnapshot.websiteSalesPacketQueue.items[0].copyableSalesPacket, /Deposito:/);
  assert.match(preHandoffSnapshot.websiteSalesPacketQueue.items[0].copyableSalesPacket, /Close next action:/);
  assert.match(preHandoffSnapshot.websiteSalesPacketQueue.items[0].copyableSalesPacket, /Copyable opportunity request/);
  const opportunityRequest = JSON.parse(preHandoffSnapshot.websiteSalesPacketQueue.items[0].copyableOpportunityRequest);
  assert.equal(opportunityRequest.leadId, lead.id);
  assert.equal(opportunityRequest.outreachDraftId, draft.id);
  assert.equal(opportunityRequest.projectType, "bundle");
  assert.equal(preHandoffSnapshot.websiteSalesPacketQueue.items[0].closePlan.requiredDepositUsd, draft.pricing.depositUsd);
  assert.equal(preHandoffSnapshot.websiteSalesPacketQueue.items[0].closePlan.scopeApprovalRequired, true);
  assert.equal(preHandoffSnapshot.websiteSalesPacketQueue.items[0].closePlan.paymentEvidenceRequired.some((item) => item.includes("Stripe payment id")), true);
  assert.match(preHandoffSnapshot.websiteSalesPacketQueue.items[0].closePlan.copyableClosePacket, /Website close packet: Handoff Cafe/);
  assert.match(preHandoffSnapshot.websiteSalesPacketQueue.items[0].closePlan.copyableClosePacket, /approved_for_manual_contact/);
  assert.match(preHandoffSnapshot.websiteSalesPacketQueue.items[0].closePlan.copyableClosePacket, /Do not mark sold without deposit payment evidence/);
  assert.match(preHandoffSnapshot.websiteSalesPacketQueue.items[0].closePlan.copyableClosePacket, /Copyable close request/);
  const closeRequest = JSON.parse(preHandoffSnapshot.websiteSalesPacketQueue.items[0].closePlan.copyableCloseRequest);
  assert.equal(closeRequest.depositPaid, true);
  assert.equal(closeRequest.scopeApproved, true);
  assert.match(closeRequest.paymentConfirmation, /REPLACE_WITH/);
  const placeholderOpportunity = recordRevenueWebsiteOpportunity(opportunityRequest);
  assert.equal(placeholderOpportunity.status, "quoted");
  const placeholderClose = closeRevenueWebsiteOpportunity({
    ...closeRequest,
    opportunityId: placeholderOpportunity.opportunity!.id,
    cashCollectedUsd: draft.pricing.depositUsd,
  });
  assert.equal(placeholderClose.status, "blocked");
  assert.equal(placeholderClose.snapshot.websiteDeliveryHandoffQueue.readyCount, 0);
  assert.match(placeholderClose.reason, /payment evidence|referencia de pago|deposit/i);
  assert.equal(preHandoffSnapshot.websiteSalesPacketQueue.safety.sendsOutreach, false);

  const opportunity = sellWebsiteOpportunityForTest({
    leadId: lead.id,
    outreachDraftId: draft.id,
    projectType: "bundle",
    cashCollectedUsd: 2100,
  });
  const postSaleSnapshot = getRevenueEngineSnapshot();
  const soldHandoffItem = postSaleSnapshot.websiteDeliveryHandoffQueue.items.find((item) => item.opportunityId === opportunity.id);
  assert.ok(soldHandoffItem);
  assert.equal(soldHandoffItem.repoRequired, true);
  assert.equal(soldHandoffItem.repoFullNamePattern, "owner/repo");
  assert.equal(soldHandoffItem.suggestedBranchName, "codex/client-handoff-cafe-website");
  assert.match(soldHandoffItem.copyableWorkspaceSetupPacket, /Website delivery workspace setup: Handoff Cafe/);
  assert.match(soldHandoffItem.copyableWorkspaceSetupPacket, /Repo required: owner\/repo/);
  assert.match(soldHandoffItem.copyableWorkspaceSetupPacket, /Copyable workspace request/);
  assert.match(soldHandoffItem.copyableWorkspaceSetupPacket, /Do not merge to main directly/);
  const workspaceRequest = JSON.parse(soldHandoffItem.copyableWorkspaceRequest);
  assert.equal(workspaceRequest.leadId, lead.id);
  assert.equal(workspaceRequest.outreachDraftId, draft.id);
  assert.equal(workspaceRequest.websiteOpportunityId, opportunity.id);
  assert.equal(workspaceRequest.branchName, "codex/client-handoff-cafe-website");
  assert.equal(workspaceRequest.depositPaid, true);
  assert.equal(workspaceRequest.scopeApproved, true);
  assert.equal(workspaceRequest.publicDataVerified, true);
  assert.equal(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(workspaceRequest.repoFullName), false);
  assert.throws(
    () => createWebsiteDeliveryWorkspaceFromLead(workspaceRequest),
    /repoFullName must be owner\/repo/,
  );
  assert.equal(getRevenueEngineSnapshot().recentDeliveryWorkspaces.length, 0);
  assert.match(soldHandoffItem.nextAction, /repo GitHub owner\/repo/);
  const leadStatusBeforeRepoBlock = postSaleSnapshot.recentLeads.find((item) => item.id === lead.id)?.status;
  const missingRepoHandoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.id,
    outreachDraftId: draft.id,
    websiteOpportunityId: opportunity.id,
    mockupUrl: preview.previewUrl,
    projectType: "bundle",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 2100,
    publicDataVerified: true,
  });

  assert.equal(missingRepoHandoff.status, "blocked");
  assert.match(missingRepoHandoff.reason, /Repo GitHub/);
  assert.equal(missingRepoHandoff.workspace, null);
  assert.equal(missingRepoHandoff.snapshot.recentDeliveryWorkspaces.length, 0);
  assert.equal(missingRepoHandoff.snapshot.recentLedger.length, postSaleSnapshot.recentLedger.length);
  assert.equal(missingRepoHandoff.snapshot.recentLeads.find((item) => item.id === lead.id)?.status, leadStatusBeforeRepoBlock);

  const mainBranchHandoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.id,
    outreachDraftId: draft.id,
    websiteOpportunityId: opportunity.id,
    mockupUrl: preview.previewUrl,
    projectType: "bundle",
    repoFullName: "robert/handoff-cafe",
    branchName: "main",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 2100,
    publicDataVerified: true,
  });

  assert.equal(mainBranchHandoff.status, "blocked");
  assert.match(mainBranchHandoff.reason, /Branch codex/);
  assert.equal(mainBranchHandoff.workspace, null);
  assert.equal(mainBranchHandoff.snapshot.recentDeliveryWorkspaces.length, 0);
  assert.equal(mainBranchHandoff.snapshot.recentLedger.length, postSaleSnapshot.recentLedger.length);

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    ...workspaceRequest,
    repoFullName: "robert/handoff-cafe",
    visualQaPassed: false,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    notes: "Client said yes to a controlled build after seeing the mockup.",
  });

  assert.equal(handoff.status, "created");
  assert.equal(handoff.workspace?.input.sourceLeadId, lead.id);
  assert.equal(handoff.workspace?.input.sourceOutreachDraftId, draft.id);
  assert.equal(handoff.workspace?.input.sourceOpportunityId, opportunity.id);
  assert.equal(handoff.workspace?.input.sourceUrl, "https://example.com/handoff-cafe-listing");
  assert.equal(handoff.workspace?.input.mockupUrl, preview.previewUrl);
  assert.equal(handoff.workspace?.input.repoFullName, "robert/handoff-cafe");
  assert.equal(handoff.workspace?.input.branchName, "codex/client-handoff-cafe-website");
  assert.equal(handoff.workspace?.codexBuildHandoff.repoFullName, "robert/handoff-cafe");
  assert.equal(handoff.workspace?.codexBuildHandoff.branchName, "codex/client-handoff-cafe-website");
  assert.equal(handoff.workspace?.input.clientRequest.includes("Mockup preview:"), true);
  assert.equal(handoff.workspace?.input.clientRequest.includes("Codex build rule"), true);
  assert.equal(handoff.workspace?.projectPlan.decision.status, "ready_to_build");
  assert.equal(handoff.workspace?.correctionQueue.some((item) => item.agent === "automation-qa"), true);
  assert.equal(handoff.workspace?.codexBuildHandoff.status, "needs_pr");
  assert.equal(handoff.workspace?.codexBuildHandoff.codexBrief.includes("PR-First Rules"), true);
  assert.equal(handoff.workspace?.codexBuildHandoff.publicBuildBrief.includes("PR-First Rules"), true);
  assert.match(handoff.workspace?.codexBuildHandoff.githubIssueTitle || "", /Handoff Cafe/);
  assert.match(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /PR-first client build handoff/);
  assert.match(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Target branch: codex\/client-handoff-cafe-website/);
  assert.match(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Public source: https:\/\/example\.com\/handoff-cafe-listing/);
  assert.match(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Mockup preview:/);
  assert.match(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /First viewport/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Commercial Context/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Setup: \$/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Retainer:/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Deposit paid:/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Cash collected for deposit/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Operator notes/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Client said yes/);
  assert.equal(handoff.workspace?.codexBuildHandoff.buildPack.publicOnly, true);
  assert.equal(handoff.workspace?.codexBuildHandoff.buildPack.sections.some((section) => section.includes("First viewport")), true);
  assert.equal(handoff.workspace?.codexBuildHandoff.buildPack.assets.some((asset) => asset.includes(preview.previewUrl)), true);
  assert.equal(handoff.workspace?.codexBuildHandoff.buildPack.qaCommands.includes("npm run check"), true);
  assert.equal(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack.includes("Copy"), false);
  assert.equal(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack.includes("Handoff Cafe"), true);
  assert.match(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack || "", /Do not deploy/);
  assert.match(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack || "", /second review, App QA and explicit Robert deploy approval/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.publicBuildBrief || "", /Commercial Context/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.publicBuildBrief || "", /Setup: \$/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.publicBuildBrief || "", /Retainer:/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.publicBuildBrief || "", /Deposit paid:/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.publicBuildBrief || "", /Cash collected for deposit/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.publicBuildBrief || "", /Operator notes/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.publicBuildBrief || "", /Client said yes/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack || "", /Commercial Context/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack || "", /Setup: \$/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack || "", /Retainer:/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack || "", /Deposit paid:/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack || "", /Cash collected for deposit/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack || "", /Operator notes/);
  assert.doesNotMatch(handoff.workspace?.codexBuildHandoff.buildPack.copyableBuildPack || "", /Client said yes/);
  assert.equal(handoff.snapshot.dailyMoneyCommand.status, "build");
  assert.equal(handoff.snapshot.dailyMoneyCommand.runPacket.status, "build");
  assert.equal(handoff.snapshot.dailyMoneyCommand.runPacket.apiAction, "/api/revenue-engine/delivery-workspaces/github-handoff");
  assert.match(handoff.snapshot.dailyMoneyCommand.runPacket.input, new RegExp(`workspaceId=${handoff.workspace?.id}`));
  assert.match(handoff.snapshot.dailyMoneyCommand.copyableOperatorBrief, new RegExp(`workspaceId=${handoff.workspace?.id}`));
  assert.match(handoff.snapshot.dailyMoneyCommand.runPacket.gate, /No merge\/deploy\/client preview/);
  assert.match(handoff.snapshot.dailyMoneyCommand.runPacket.copyableRunPacket, /explicit Robert approval/);
  const dailyGithubHandoffRequest = revenueDeliveryWorkspaceGithubHandoffSchema.parse(JSON.parse(handoff.snapshot.dailyMoneyCommand.runPacket.copyableApiRequest));
  assert.equal(dailyGithubHandoffRequest.workspaceId, handoff.workspace?.id);
  assert.equal(dailyGithubHandoffRequest.repoFullName, "robert/handoff-cafe");
  assert.equal(dailyGithubHandoffRequest.branchName, "codex/client-handoff-cafe-website");
  assert.doesNotMatch(handoff.snapshot.dailyMoneyCommand.runPacket.copyableApiRequest, /REPLACE_WITH_DELIVERY_WORKSPACE_ID/);
  assert.equal(handoff.snapshot.websiteBuildHandoffQueue.openCount, 1);
  assert.equal(handoff.snapshot.websiteBuildHandoffQueue.items[0].workspaceId, handoff.workspace?.id);
  assert.equal(handoff.snapshot.websiteBuildHandoffQueue.items[0].codexBrief.includes("PR-First Rules"), true);
  const githubHandoffRequest = JSON.parse(handoff.snapshot.websiteBuildHandoffQueue.items[0].copyableGithubHandoffRequest);
  assert.equal(githubHandoffRequest.workspaceId, handoff.workspace?.id);
  assert.equal(githubHandoffRequest.repoFullName, "robert/handoff-cafe");
  assert.equal(githubHandoffRequest.branchName, "codex/client-handoff-cafe-website");
  const releaseGateRequest = revenueDeliveryWorkspaceUpdateSchema.parse(
    JSON.parse(handoff.snapshot.websiteBuildHandoffQueue.items[0].copyableReleaseGateRequest)
  );
  assert.equal(releaseGateRequest.workspaceId, handoff.workspace?.id);
  assert.equal(releaseGateRequest.repoFullName, "robert/handoff-cafe");
  assert.equal(releaseGateRequest.branchName, "codex/client-handoff-cafe-website");
  assert.equal(releaseGateRequest.prUrl, "");
  assert.equal(releaseGateRequest.secondReviewStatus, "pending");
  assert.equal(releaseGateRequest.appQaStatus, "pending");
  assert.equal(releaseGateRequest.deploymentApprovalStatus, "not_requested");
  assert.equal(releaseGateRequest.releaseGateHeadSha, "");
  assert.doesNotMatch(handoff.snapshot.websiteBuildHandoffQueue.items[0].copyableReleaseGateRequest, /Deposit paid:|Retainer:|Setup: \$|Cash collected for deposit|paymentConfirmation|Operator notes|Client said yes/);
  assert.equal(handoff.snapshot.websiteBuildHandoffQueue.items[0].buildPack.copyableBuildPack.includes("Implementation rules"), true);
  assert.doesNotMatch(handoff.snapshot.websiteBuildHandoffQueue.items[0].publicBuildBrief, /Deposit paid:|Retainer:|Setup: \$|Cash collected for deposit|Operator notes|Client said yes/);
  assert.doesNotMatch(handoff.snapshot.websiteBuildHandoffQueue.items[0].buildPack.copyableBuildPack, /Deposit paid:|Retainer:|Setup: \$|Cash collected for deposit|Operator notes|Client said yes/);
  assert.equal(handoff.snapshot.dailyMoneyCommand.copyableOperatorBrief.includes(handoff.workspace?.id || ""), true);
  assert.doesNotMatch(handoff.snapshot.dailyMoneyCommand.copyableOperatorBrief, /Deposit paid:|Retainer:|Setup: \$|Cash collected|Operator notes|Client said yes/);
  assert.equal(handoff.snapshot.dailyMoneyCommand.steps.find((step) => step.id === "collect")?.nextAction.includes(handoff.workspace?.id || ""), true);
  assert.equal(handoff.workspace?.approvalSummary.requiredBeforeClient.includes("pull request de build"), true);
  assert.equal(handoff.outreachDraft?.delivery.sendStatus, "sent");
  assert.equal(handoff.outreachDraft?.delivery.outcome, "deposit_collected");
  assert.equal(handoff.snapshot.recentLeads[0].status, "closed");
  assert.equal(handoff.snapshot.recentDeliveryWorkspaces[0].input.sourceLeadId, lead.id);
  assert.equal(handoff.snapshot.websiteDeliveryHandoffQueue.items.some((item) => item.leadId === lead.id), false);
  assert.equal(handoff.snapshot.metrics.appsSold, 1);
  assert.equal(handoff.snapshot.metrics.cashCollectedUsd, 2100);
  assert.equal(handoff.snapshot.recentLedger[0].kind, "bundle_sale");
  assert.equal(handoff.snapshot.recentLedger[0].notes.includes(`website-lead:${lead.id}`), true);

  const duplicateHandoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.id,
    outreachDraftId: draft.id,
    websiteOpportunityId: opportunity.id,
    mockupUrl: preview.previewUrl,
    projectType: "bundle",
    repoFullName: "robert/handoff-cafe",
    branchName: "codex/client-handoff-cafe-website",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 2100,
    publicDataVerified: true,
  });

  assert.equal(duplicateHandoff.status, "already_created");
  assert.equal(duplicateHandoff.workspace?.id, handoff.workspace?.id);
  assert.equal(duplicateHandoff.snapshot.recentDeliveryWorkspaces.length, 1);
  assert.equal(duplicateHandoff.snapshot.metrics.appsSold, 1);
  assert.equal(duplicateHandoff.snapshot.metrics.cashCollectedUsd, 2100);

  const blockedDelivery = deliverRevenueDeliveryWorkspace({
    workspaceId: handoff.workspace?.id || "",
    approvedByRobert: true,
  });
  assert.equal(blockedDelivery.status, "blocked");
  assert.match(blockedDelivery.reason, /pull request de build/);

  const qaReady = updateRevenueDeliveryWorkspaceQa({
    workspaceId: handoff.workspace?.id || "",
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
    repoFullName: "robert/handoff-cafe",
    githubIssueUrl: "https://github.com/robert/handoff-cafe/issues/1",
    prUrl: "https://github.com/robert/handoff-cafe/pull/2",
    secondReviewStatus: "pass",
    appQaStatus: "pass",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/handoff-cafe/pull/2#issuecomment-approval",
    releaseGateHeadSha: "abc987def6543210",
    notes: "PR, second review, App QA and Robert deploy approval verified.",
  }, {
    allowGithubIssueEvidence: true,
    allowReleaseGateEvidence: true,
  });

  assert.equal(qaReady.status, "ready");
  assert.equal(qaReady.workspace?.codexBuildHandoff.status, "ready_for_qa");
  assert.equal(qaReady.workspace?.approvalSummary.canLaunch, true);
});

test("copyable GitHub issue body redacts public handoff sale wording", () => {
  const workspaceResult = recordRevenueDeliveryWorkspace({
    workspaceName: "Hostile issue body workspace",
    clientName: "Hostile $4,200 Paid Cafe bank reference ABC123 Stripe pi_12345 ACH-777 Venmo refs VMO999",
    projectType: "website",
    packageName: "Website $4,200 deposit paid retainer setup transfer ref XYZ789 Venmo VMO123 wire ref WIRE555 wire refs WIRE999",
    setupUsd: 4200,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 35,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: false,
    launchTargetDays: 7,
    clientRequest: "Build a public website from approved facts.",
    sourceUrl: "https://example.com/hostile-cafe",
    mockupUrl: "/api/revenue-engine/mockup-previews/hostile-cafe",
    repoFullName: "robert/hostile-cafe",
    branchName: "codex/client-hostile-cafe-website",
  });
  const publicSurfaces = [
    workspaceResult.workspace.codexBuildHandoff.copyableGithubIssueBody,
    workspaceResult.workspace.codexBuildHandoff.publicBuildBrief,
    workspaceResult.workspace.codexBuildHandoff.buildPack.copyableBuildPack,
  ];

  for (const surface of publicSurfaces) {
    assert.match(surface, /Target branch: codex\/client-hostile-cafe-website|Branch: codex\/client-hostile-cafe-website/);
    assert.match(surface, /Public source: https:\/\/example\.com\/hostile-cafe/);
    assert.match(surface, /Mockup preview: \/api\/revenue-engine\/mockup-previews\/hostile-cafe|Approved mockup: \/api\/revenue-engine\/mockup-previews\/hostile-cafe/);
    assert.match(surface, /amount-redacted|private-sale-detail-redacted|private-sale-reference-redacted/);
    assert.doesNotMatch(surface, /\$4,200/);
    assert.doesNotMatch(surface, /deposit paid/i);
    assert.doesNotMatch(surface, /\bretainer\b/i);
    assert.doesNotMatch(surface, /\bsetup\b/i);
    assert.doesNotMatch(surface, /ABC123/);
    assert.doesNotMatch(surface, /XYZ789/);
    assert.doesNotMatch(surface, /pi_12345/);
    assert.doesNotMatch(surface, /ACH-777/);
    assert.doesNotMatch(surface, /VMO123/);
    assert.doesNotMatch(surface, /WIRE555/);
    assert.doesNotMatch(surface, /VMO999/);
    assert.doesNotMatch(surface, /WIRE999/);
  }
});

test("copyable GitHub issue body follows updated PR-first branch", () => {
  const workspaceResult = recordRevenueDeliveryWorkspace({
    workspaceName: "Branch sync workspace",
    clientName: "Branch Sync Cafe",
    projectType: "website",
    packageName: "Website 3D Premium",
    setupUsd: 4200,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 35,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: false,
    launchTargetDays: 7,
    clientRequest: "Build a public website from approved facts.",
    sourceUrl: "https://example.com/branch-sync-cafe",
    mockupUrl: "/api/revenue-engine/mockup-previews/branch-sync-cafe",
    repoFullName: "robert/branch-sync-cafe",
    branchName: "codex/client-branch-sync-cafe-website",
  });

  const updated = updateRevenueDeliveryWorkspaceQa({
    workspaceId: workspaceResult.workspace.id,
    repoFullName: "robert/branch-sync-cafe",
    branchName: "codex/custom-branch-sync-cafe-website",
  });

  assert.equal(updated.workspace?.codexBuildHandoff.branchName, "codex/custom-branch-sync-cafe-website");
  assert.match(updated.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Target branch: codex\/custom-branch-sync-cafe-website/);
  assert.doesNotMatch(updated.workspace?.codexBuildHandoff.copyableGithubIssueBody || "", /Target branch: codex\/client-branch-sync-cafe-website/);
});

test("website build queue excludes workspaces without verified public data", () => {
  const { lead, draft } = createApprovedWebsiteDraftForTest({
    businessName: "Unverified Source Cafe",
    contactEmail: "owner@unverifiedsource.example",
    sourceUrl: "https://example.com/unverified-source-cafe",
    mockupSlug: "unverified-source-cafe",
  });
  const opportunity = sellWebsiteOpportunityForTest({
    leadId: lead.id,
    outreachDraftId: draft.id,
    projectType: "website",
    cashCollectedUsd: 1000,
  });
  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.id,
    outreachDraftId: draft.id,
    websiteOpportunityId: opportunity.id,
    mockupUrl: draft.mockupUrl || "",
    projectType: "website",
    repoFullName: "robert/unverified-source-cafe",
    branchName: "codex/client-unverified-source-cafe-website",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 1000,
    publicDataVerified: false,
    notes: "Operator has not verified public sources yet.",
  });

  assert.equal(handoff.status, "created");
  assert.equal(handoff.workspace?.projectPlan.decision.status, "blocked");
  assert.equal(handoff.workspace?.codexBuildHandoff.status, "needs_pr");
  assert.equal(handoff.workspace?.codexBuildHandoff.missing.includes("data publica verificada"), true);
  assert.equal(handoff.snapshot.websiteBuildHandoffQueue.openCount, 0);
  assert.equal(handoff.snapshot.dailyMoneyCommand.status === "build", false);
  assert.equal(handoff.workspace?.approvalSummary.canShowClientPreview, false);

  const repoSaved = updateRevenueDeliveryWorkspaceQa({
    workspaceId: handoff.workspace?.id || "",
    repoFullName: "robert/unverified-source-cafe",
    branchName: "codex/client-unverified-source-cafe-website",
    notes: "Repo saved before public data was verified.",
  });

  assert.equal(repoSaved.workspace?.input.repoFullName, "robert/unverified-source-cafe");
  assert.equal(repoSaved.workspace?.projectPlan.decision.status, "blocked");
  assert.equal(repoSaved.snapshot.websiteBuildHandoffQueue.openCount, 0);
  assert.equal(repoSaved.snapshot.dailyMoneyCommand.status === "build", false);
});

test("website build queue excludes direct workspaces without sold opportunity chain", () => {
  const directWorkspace = recordRevenueDeliveryWorkspace({
    workspaceName: "Direct Fake Website",
    clientName: "Direct Fake Cafe",
    projectType: "website",
    packageName: "Website 3D Premium",
    setupUsd: 3000,
    monthlyRetainerUsd: 500,
    estimatedInternalCostUsd: 40,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: false,
    launchTargetDays: 7,
    clientRequest: "Direct workspace should not be actionable without sold opportunity chain.",
    repoFullName: "robert/direct-fake-cafe",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });
  const saleGate = getRevenueWebsiteWorkspaceSaleGate(directWorkspace.workspace.id);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(directWorkspace.workspace.projectPlan.decision.status, "ready_to_build");
  assert.equal(directWorkspace.workspace.codexBuildHandoff.status, "needs_pr");
  assert.equal(saleGate.status, "blocked");
  assert.equal(saleGate.blockers.includes("sourceOpportunityId vendido requerido"), true);
  assert.equal(snapshot.websiteBuildHandoffQueue.openCount, 0);
  assert.equal(snapshot.dailyMoneyCommand.funnel.buildHandoffsOpen, 0);
});

test("daily money command prioritizes open PR-first website builds before more delivery collection", () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  const { lead: buildLead, draft: buildDraft } = createApprovedWebsiteDraftForTest({
    businessName: "Build Queue Cafe",
    contactEmail: "owner@buildqueue.example",
    sourceUrl: "https://example.com/build-queue-cafe",
    mockupSlug: "build-queue-cafe",
  });
  const { lead: collectLead, draft: collectDraft } = createApprovedWebsiteDraftForTest({
    businessName: "Collect Queue Cafe",
    contactEmail: "owner@collectqueue.example",
    sourceUrl: "https://example.com/collect-queue-cafe",
    mockupSlug: "collect-queue-cafe",
  });
  const buildOpportunity = sellWebsiteOpportunityForTest({
    leadId: buildLead.id,
    outreachDraftId: buildDraft.id,
    projectType: "website",
    cashCollectedUsd: 1000,
  });
  const buildHandoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: buildLead.id,
    outreachDraftId: buildDraft.id,
    websiteOpportunityId: buildOpportunity.id,
    mockupUrl: buildDraft.mockupUrl || "",
    projectType: "website",
    repoFullName: "robert/build-queue-cafe",
    branchName: "codex/client-build-queue-cafe-website",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 1000,
    publicDataVerified: true,
    notes: "First sold client is ready for PR-first build.",
  });
  assert.equal(buildHandoff.status, "created");

  const collectOpportunity = sellWebsiteOpportunityForTest({
    leadId: collectLead.id,
    outreachDraftId: collectDraft.id,
    projectType: "website",
    cashCollectedUsd: 1000,
  });
  assert.equal(collectOpportunity.status, "sold");

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.websiteBuildHandoffQueue.openCount, 1);
  assert.equal(snapshot.websiteBuildHandoffQueue.items[0].workspaceId, buildHandoff.workspace?.id);
  assert.equal(snapshot.websiteDeliveryHandoffQueue.readyCount, 1);
  assert.equal(snapshot.websiteDeliveryHandoffQueue.items[0].leadId, collectLead.id);
  assert.equal(snapshot.dailyMoneyCommand.status, "build");
  assert.equal(snapshot.dailyMoneyCommand.funnel.buildHandoffsOpen, 1);
  assert.equal(snapshot.dailyMoneyCommand.funnel.deliveryHandoffsReady, 1);
  assert.match(snapshot.dailyMoneyCommand.target, /1 builds esperando PR-first/);
  assert.match(snapshot.dailyMoneyCommand.steps.find((step) => step.id === "collect")?.metric || "", /1 delivery \/ 1 PR/);
  assert.equal(
    snapshot.dailyMoneyCommand.runPacket.apiAction,
    "/api/revenue-engine/delivery-workspaces/github-handoff",
  );
  assert.match(snapshot.dailyMoneyCommand.runPacket.gate, /No merge\/deploy\/client preview/);
  assert.equal(snapshot.dailyMoneyCommand.copyableOperatorBrief.includes(`- Website builds needing PR-first handoff: 1`), true);
  assert.equal(snapshot.dailyMoneyCommand.copyableOperatorBrief.includes(buildHandoff.workspace?.id || ""), true);
});

test("website delivery handoff blocks incomplete deposits before closing or ledger", () => {
  const lead = recordRevenueLead({
    businessName: "Partial Deposit Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@partialdeposit.example",
    evidence: "Public listing has no website, recent menu photos and verified owner contact.",
    painPoint: "Needs online ordering and catering capture.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const draft = recordRevenueOutreachDraft({
    leadId: lead.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@partialdeposit.example",
    contactName: "Owner",
    businessName: "Partial Deposit Cafe",
    sourceUrl: "https://example.com/partial-deposit-cafe",
    mockupUrl: "/api/revenue-engine/mockup-previews/partial-deposit-cafe",
    businessSummary: "Partial Deposit Cafe has public evidence of no dedicated website and needs online ordering.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });
  const opportunityResult = recordRevenueWebsiteOpportunity({
    leadId: lead.lead.id,
    outreachDraftId: draft.draft.id,
    projectType: "bundle",
  });
  assert.equal(opportunityResult.status, "quoted");
  assert.ok(opportunityResult.opportunity);

  const incompleteClose = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 1,
    paymentConfirmation: "Robert confirmed partial deposit.",
  });
  assert.equal(incompleteClose.status, "blocked");
  assert.match(incompleteClose.reason, /deposito incompleto/);

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.lead.id,
    outreachDraftId: draft.draft.id,
    websiteOpportunityId: opportunityResult.opportunity.id,
    projectType: "bundle",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 1,
    publicDataVerified: true,
  });
  assert.equal(handoff.status, "blocked");
  assert.match(handoff.reason, /oportunidad website debe estar vendida/);
  assert.equal(handoff.workspace, null);
  assert.equal(handoff.snapshot.recentLeads.find((item) => item.id === lead.lead.id)?.status, "outreach_ready");
  assert.equal(handoff.snapshot.metrics.appsSold, 0);
  assert.equal(handoff.snapshot.metrics.cashCollectedUsd, 0);
  assert.equal(handoff.snapshot.recentLedger.length, 0);
});

test("website delivery handoff blocks workspace creation before deposit and scope approval", () => {
  const lead = recordRevenueLead({
    businessName: "No Deposit Scope Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@nodepositscope.example",
    evidence: "Public listing has no website, recent menu photos and verified owner contact.",
    painPoint: "Needs online menu and catering capture.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const draft = recordRevenueOutreachDraft({
    leadId: lead.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@nodepositscope.example",
    contactName: "Owner",
    businessName: "No Deposit Scope Cafe",
    sourceUrl: "https://example.com/no-deposit-scope-cafe",
    mockupUrl: "/api/revenue-engine/mockup-previews/no-deposit-scope-cafe",
    businessSummary: "No Deposit Scope Cafe has public evidence of no dedicated website and needs online menu capture.",
    websitePriceUsd: 3200,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.lead.id,
    outreachDraftId: draft.draft.id,
    projectType: "bundle",
    depositPaid: false,
    scopeApproved: false,
    cashCollectedUsd: 0,
    publicDataVerified: true,
  });

  assert.equal(handoff.status, "blocked");
  assert.match(handoff.reason, /oportunidad website vendida/);
  assert.equal(handoff.workspace, null);
  assert.equal(handoff.snapshot.recentLeads.find((item) => item.id === lead.lead.id)?.status, "outreach_ready");
  assert.equal(handoff.snapshot.recentDeliveryWorkspaces.length, 0);
  assert.equal(handoff.snapshot.recentLedger.length, 0);
});

test("website delivery ledger notes stay bounded before closing state", () => {
  const lead = recordRevenueLead({
    businessName: "Long Notes Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@longnotes.example",
    evidence: "Public listing has no website, recent menu photos and verified owner contact.",
    painPoint: "Needs online menu and event inquiry capture.",
    estimatedOfferUsd: 3600,
    status: "qualified",
  });
  const draft = recordRevenueOutreachDraft({
    leadId: lead.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@longnotes.example",
    contactName: "Owner",
    businessName: "Long Notes Cafe",
    sourceUrl: "https://example.com/long-notes-cafe",
    mockupUrl: "/api/revenue-engine/mockup-previews/long-notes-cafe",
    businessSummary: "Long Notes Cafe has public evidence of no dedicated website and needs menu capture.",
    websitePriceUsd: 3600,
    automationPriceUsd: 0,
    monthlyRetainerUsd: 500,
    estimatedInternalMonthlyCostUsd: 44,
  });
  const opportunityResult = recordRevenueWebsiteOpportunity({
    leadId: lead.lead.id,
    outreachDraftId: draft.draft.id,
    projectType: "website",
  });
  assert.equal(opportunityResult.status, "quoted");
  assert.ok(opportunityResult.opportunity);
  const depositOutcome = recordRevenueOutreachOutcome({
    draftId: draft.draft.id,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd: 1800,
    paymentConfirmation: "Stripe pi_long_notes_123",
    notes: "Robert confirmed deposit before long-notes close.",
  });
  assert.equal(depositOutcome.status, "recorded");
  const closeResult = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 1800,
    paymentConfirmation: "Stripe pi_long_notes_123",
    notes: "x".repeat(1000),
  });
  assert.equal(closeResult.status, "sold");

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.lead.id,
    outreachDraftId: draft.draft.id,
    websiteOpportunityId: opportunityResult.opportunity.id,
    projectType: "website",
    repoFullName: "robert/long-notes-cafe",
    branchName: "codex/client-long-notes-cafe-website",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 1800,
    publicDataVerified: true,
    notes: "x".repeat(1200),
  });

  assert.equal(handoff.status, "created");
  assert.equal(handoff.snapshot.recentLeads.find((item) => item.id === lead.lead.id)?.status, "closed");
  assert.equal(handoff.snapshot.recentLedger[0].notes.length <= 1000, true);
  assert.equal(handoff.snapshot.recentLedger[0].notes.includes(`website-lead:${lead.lead.id}`), true);
  assert.equal(handoff.snapshot.metrics.cashCollectedUsd, 1800);
});

test("website-only handoff uses website deposit when draft also has automation upsell", () => {
  const lead = recordRevenueLead({
    businessName: "Website Only Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@websiteonly.example",
    evidence: "Public listing has no website, recent menu photos and verified owner contact.",
    painPoint: "Needs a premium website before automation.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const draft = recordRevenueOutreachDraft({
    leadId: lead.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@websiteonly.example",
    contactName: "Owner",
    businessName: "Website Only Cafe",
    sourceUrl: "https://example.com/website-only-cafe",
    mockupUrl: "/api/revenue-engine/mockup-previews/website-only-cafe",
    businessSummary: "Website Only Cafe has public evidence of no dedicated website and needs a website before automation.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 500,
    estimatedInternalMonthlyCostUsd: 44,
  });
  const opportunity = sellWebsiteOpportunityForTest({
    leadId: lead.lead.id,
    outreachDraftId: draft.draft.id,
    projectType: "website",
    cashCollectedUsd: 1500,
  });

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.lead.id,
    outreachDraftId: draft.draft.id,
    websiteOpportunityId: opportunity.id,
    projectType: "website",
    repoFullName: "robert/website-only-cafe",
    branchName: "codex/client-website-only-cafe-website",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 1500,
    publicDataVerified: true,
  });

  assert.equal(handoff.status, "created");
  assert.equal(handoff.workspace?.input.projectType, "website");
  assert.equal(handoff.snapshot.metrics.appsSold, 1);
  assert.equal(handoff.snapshot.metrics.cashCollectedUsd, 1500);
  assert.equal(handoff.snapshot.recentLedger[0].kind, "website_sale");
  assert.equal(handoff.snapshot.recentLedger[0].amountUsd, 2500);
});

test("website delivery ledger dedupe uses exact lead token not id prefix", () => {
  const originalDateNow = Date.now;
  Date.now = () => 1234567890000;
  try {
    const leads = Array.from({ length: 10 }, (_, index) => recordRevenueLead({
      businessName: `Prefix Cafe ${index + 1}`,
      area: "Miami",
      niche: "coffee shop",
      websiteStatus: "no_website",
      contactChannel: "email",
      contactValue: `owner${index + 1}@prefix.example`,
      evidence: "Public listing has no website, recent menu photos and verified owner contact.",
      painPoint: "Needs a conversion website.",
      estimatedOfferUsd: 3600,
      status: "qualified",
    }));
    const leadOne = leads[0].lead;
    const leadTen = leads[9].lead;
    const draftOne = recordRevenueOutreachDraft({
      leadId: leadOne.id,
      channel: "email",
      approvalStatus: "approved",
      recipientEmail: "owner1@prefix.example",
      contactName: "Owner",
      businessName: leadOne.businessName,
      sourceUrl: "https://example.com/prefix-cafe-1",
      mockupUrl: "/api/revenue-engine/mockup-previews/prefix-cafe-1",
      businessSummary: "Prefix Cafe 1 has public evidence of no dedicated website and needs a conversion website.",
      websitePriceUsd: 3600,
      automationPriceUsd: 0,
      monthlyRetainerUsd: 500,
      estimatedInternalMonthlyCostUsd: 44,
    });
    const draftTen = recordRevenueOutreachDraft({
      leadId: leadTen.id,
      channel: "email",
      approvalStatus: "approved",
      recipientEmail: "owner10@prefix.example",
      contactName: "Owner",
      businessName: leadTen.businessName,
      sourceUrl: "https://example.com/prefix-cafe-10",
      mockupUrl: "/api/revenue-engine/mockup-previews/prefix-cafe-10",
      businessSummary: "Prefix Cafe 10 has public evidence of no dedicated website and needs a conversion website.",
      websitePriceUsd: 3600,
      automationPriceUsd: 0,
      monthlyRetainerUsd: 500,
      estimatedInternalMonthlyCostUsd: 44,
    });
    const opportunityTen = sellWebsiteOpportunityForTest({
      leadId: leadTen.id,
      outreachDraftId: draftTen.draft.id,
      projectType: "website",
      cashCollectedUsd: 1800,
    });
    const opportunityOne = sellWebsiteOpportunityForTest({
      leadId: leadOne.id,
      outreachDraftId: draftOne.draft.id,
      projectType: "website",
      cashCollectedUsd: 1800,
    });

    createWebsiteDeliveryWorkspaceFromLead({
      leadId: leadTen.id,
      outreachDraftId: draftTen.draft.id,
      websiteOpportunityId: opportunityTen.id,
      projectType: "website",
      repoFullName: "robert/ledger-token-ten",
      branchName: "codex/client-ledger-token-ten-website",
      depositPaid: true,
      scopeApproved: true,
      cashCollectedUsd: 1800,
      publicDataVerified: true,
    });
    const secondHandoff = createWebsiteDeliveryWorkspaceFromLead({
      leadId: leadOne.id,
      outreachDraftId: draftOne.draft.id,
      websiteOpportunityId: opportunityOne.id,
      projectType: "website",
      repoFullName: "robert/ledger-token-one",
      branchName: "codex/client-ledger-token-one-website",
      depositPaid: true,
      scopeApproved: true,
      cashCollectedUsd: 1800,
      publicDataVerified: true,
    });

    assert.equal(leadTen.id.endsWith("-10"), true);
    assert.equal(leadOne.id.endsWith("-1"), true);
    assert.equal(secondHandoff.snapshot.metrics.appsSold, 2);
    assert.equal(secondHandoff.snapshot.metrics.cashCollectedUsd, 3600);
    assert.equal(secondHandoff.snapshot.recentLedger.length, 2);
  } finally {
    Date.now = originalDateNow;
  }
});

test("blocks website delivery handoff when outreach draft belongs to another lead", () => {
  const leadA = recordRevenueLead({
    businessName: "Lead A Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@leada.example",
    evidence: "Public listing has no website, active menu photos and verified owner contact.",
    painPoint: "Needs menu capture.",
    estimatedOfferUsd: 3600,
    status: "qualified",
  });
  const leadB = recordRevenueLead({
    businessName: "Lead B Salon",
    area: "Miami",
    niche: "salon",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "owner@leadb.example",
    evidence: "Public website has no booking flow, weak service pages and verified owner contact.",
    painPoint: "Needs booking capture.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const draftB = recordRevenueOutreachDraft({
    leadId: leadB.lead.id,
    channel: "email",
    approvalStatus: "draft",
    recipientEmail: "owner@leadb.example",
    contactName: "Owner",
    businessName: "Lead B Salon",
    sourceUrl: "https://example.com/lead-b",
    businessSummary: "Lead B Salon has public evidence of a weak website and needs booking capture plus follow-up.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: leadA.lead.id,
    outreachDraftId: draftB.draft.id,
    projectType: "bundle",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 2100,
    publicDataVerified: true,
  });

  assert.equal(handoff.status, "blocked");
  assert.equal(handoff.reason.includes("no pertenece"), true);
  assert.equal(handoff.workspace, null);
  assert.equal(handoff.snapshot.recentLeads.find((lead) => lead.id === leadA.lead.id)?.status, "qualified");
});

test("website delivery handoff keeps data gate explicit before build readiness", () => {
  const lead = recordRevenueLead({
    businessName: "Explicit Data Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@explicitdata.example",
    evidence: "Public listing has no website, active menu photos and verified owner contact.",
    painPoint: "Needs online menu capture.",
    estimatedOfferUsd: 3800,
    status: "qualified",
  });
  const draft = recordRevenueOutreachDraft({
    leadId: lead.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@explicitdata.example",
    contactName: "Owner",
    businessName: "Explicit Data Cafe",
    sourceUrl: "https://example.com/explicit-data-cafe",
    mockupUrl: "/api/revenue-engine/mockup-previews/explicit-data-cafe",
    businessSummary: "Explicit Data Cafe has public evidence of no dedicated website and needs online menu capture.",
    websitePriceUsd: 3800,
    automationPriceUsd: 0,
    monthlyRetainerUsd: 500,
    estimatedInternalMonthlyCostUsd: 44,
  });
  const opportunity = sellWebsiteOpportunityForTest({
    leadId: lead.lead.id,
    outreachDraftId: draft.draft.id,
    projectType: "website",
    cashCollectedUsd: 1900,
  });

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.lead.id,
    outreachDraftId: draft.draft.id,
    websiteOpportunityId: opportunity.id,
    projectType: "website",
    repoFullName: "robert/explicit-data-cafe",
    branchName: "codex/client-explicit-data-cafe-website",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 1900,
    publicDataVerified: false,
  });

  assert.equal(handoff.status, "created");
  assert.equal(handoff.workspace?.projectPlan.decision.status, "blocked");
  assert.equal(handoff.workspace?.projectPlan.decision.missing.includes("data publica verificada"), true);
  assert.equal(handoff.workspace?.input.publicDataVerified, false);
});

test("delivery workspace records GitHub handoff issue without bypassing PR-first gates", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Handoff Cafe delivery",
    clientName: "Handoff Cafe",
    projectType: "website",
    packageName: "Website 3D Premium",
    setupUsd: 4200,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: false,
    launchTargetDays: 7,
    clientRequest: "Build the approved public website mockup.",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });
  const workspaceId = created.workspace.id;

  const parsed = revenueDeliveryWorkspaceGithubHandoffSchema.parse({
    workspaceId,
    repoFullName: "robert/handoff-cafe",
    branchName: "codex/client-handoff-cafe-website",
  });
  assert.equal(parsed.repoFullName, "robert/handoff-cafe");
  assert.throws(() => revenueDeliveryWorkspaceGithubHandoffSchema.parse({
    workspaceId,
    repoFullName: "robert/handoff-cafe",
    branchName: "main",
  }), /branchName must start with codex/);

  const lookup = getRevenueDeliveryWorkspaceById(workspaceId);
  assert.equal(lookup.status, "found");
  assert.equal(lookup.workspace?.codexBuildHandoff.status, "needs_pr");

  const updated = updateRevenueDeliveryWorkspaceQa({
    workspaceId,
    repoFullName: parsed.repoFullName,
    branchName: parsed.branchName,
    githubIssueUrl: "https://github.com/robert/handoff-cafe/issues/41",
    notes: "GitHub handoff issue creado desde Revenue Engine.",
  }, {
    allowGithubIssueEvidence: true,
  });

  assert.equal(updated.workspace?.input.githubIssueUrl, "https://github.com/robert/handoff-cafe/issues/41");
  assert.equal(updated.workspace?.codexBuildHandoff.githubIssueUrl, "https://github.com/robert/handoff-cafe/issues/41");
  assert.equal(updated.workspace?.codexBuildHandoff.branchName, "codex/client-handoff-cafe-website");
  assert.equal(updated.workspace?.codexBuildHandoff.status, "needs_pr");
  assert.equal(updated.workspace?.approvalSummary.canLaunch, false);
  assert.equal(updated.workspace?.approvalSummary.requiredBeforeClient.includes("pull request de build"), true);
});

test("public delivery workspace QA update cannot assert PR release gates", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Untrusted release gate",
    clientName: "Untrusted Gate Cafe",
    projectType: "website",
    packageName: "Website 3D Premium",
    setupUsd: 4200,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: false,
    launchTargetDays: 7,
    clientRequest: "Build approved public website.",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  const untrusted = updateRevenueDeliveryWorkspaceQa({
    workspaceId: created.workspace.id,
    githubIssueUrl: "https://github.com/robert/untrusted-gate/issues/1",
    prUrl: "https://github.com/robert/untrusted-gate/pull/2",
    secondReviewStatus: "pass",
    appQaStatus: "pass",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/untrusted-gate/pull/2#issuecomment-approval",
    releaseGateHeadSha: "bad123bad456bad7",
    notes: "Browser tried to assert release gates.",
  });

  assert.equal(untrusted.workspace?.input.githubIssueUrl || "", "");
  assert.equal(untrusted.workspace?.input.prUrl || "", "");
  assert.equal(untrusted.workspace?.input.secondReviewStatus || "pending", "pending");
  assert.equal(untrusted.workspace?.input.appQaStatus || "pending", "pending");
  assert.equal(untrusted.workspace?.input.deploymentApprovalStatus || "not_requested", "not_requested");
  assert.equal(untrusted.workspace?.input.releaseGateHeadSha || "", "");
  assert.equal(untrusted.workspace?.approvalSummary.canLaunch, false);
  assert.equal(untrusted.workspace?.codexBuildHandoff.missing.includes("GitHub handoff issue PR-first"), true);
  assert.equal(untrusted.workspace?.codexBuildHandoff.missing.includes("pull request de build"), true);
});

test("trusted release gate persists PR App QA review and deploy approval for website delivery", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  const created = createSoldWebsiteWorkspaceForTest({
    businessName: "Trusted Release Cafe",
    contactEmail: "owner@trustedrelease.example",
    sourceUrl: "https://example.com/trusted-release-cafe",
    mockupSlug: "trusted-release-cafe",
    projectType: "website",
  });

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    repoFullName: "robert/trusted-release-cafe",
    branchName: "codex/client-trusted-release-cafe-website",
    githubIssueUrl: "https://github.com/robert/trusted-release-cafe/issues/1",
    prUrl: "https://github.com/robert/trusted-release-cafe/pull/2",
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: "https://github.com/robert/trusted-release-cafe/pull/2#pullrequestreview-1",
    appQaStatus: "pass",
    appQaEvidenceUrl: "https://github.com/robert/trusted-release-cafe/pull/2#issuecomment-app-qa",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/trusted-release-cafe/pull/2#issuecomment-approval",
    notes: `PR, second review, App QA pass, App QA target revenue_delivery_workspace and Robert deploy approval verified for workspace ${created.workspace.id}, branch codex/client-trusted-release-cafe-website, client Trusted Release Cafe.`,
  }, {
    verifiedPrStatusReady: true,
    verifiedPrHeadSha: "abc123def4567890",
  });

  assert.equal(releaseGate.status, "ready");
  assert.equal(releaseGate.workspace?.input.prUrl, "https://github.com/robert/trusted-release-cafe/pull/2");
  assert.equal(releaseGate.workspace?.input.secondReviewStatus, "pass");
  assert.equal(releaseGate.workspace?.input.secondReviewEvidenceUrl, "https://github.com/robert/trusted-release-cafe/pull/2#pullrequestreview-1");
  assert.equal(releaseGate.workspace?.input.appQaStatus, "pass");
  assert.equal(releaseGate.workspace?.input.appQaEvidenceUrl, "https://github.com/robert/trusted-release-cafe/pull/2#issuecomment-app-qa");
  assert.equal(releaseGate.workspace?.input.deploymentApprovalStatus, "approved");
  assert.equal(releaseGate.workspace?.input.releaseGateHeadSha, "abc123def4567890");
  assert.equal(releaseGate.workspace?.codexBuildHandoff.releaseGateHeadSha, "abc123def4567890");
  assert.equal(releaseGate.workspace?.codexBuildHandoff.missing.length, 0);
  assert.equal(releaseGate.workspace?.approvalSummary.canLaunch, true);
  assert.equal(releaseGate.snapshot.recentDeliveryWorkspaces[0].status, "ready_to_deliver");
  assert.equal(releaseGate.snapshot.moneyActivationPlan.productionLaunchChecklist.status, "ready");
  assert.equal(releaseGate.snapshot.moneyActivationPlan.productionLaunchChecklist.deploymentApprovalPacket.status, "approved");
  assert.deepEqual(
    releaseGate.snapshot.moneyActivationPlan.productionLaunchChecklist.requiredEvidence.map((item) => [item.id, item.status]),
    [
      ["production_database", "ready"],
      ["pr_review", "ready"],
      ["app_qa_release_gate", "ready"],
      ["robert_deploy_approval", "ready"],
    ],
  );
  assert.match(releaseGate.snapshot.moneyActivationPlan.productionLaunchChecklist.copyableChecklist, /Trusted Release Cafe/);
  assert.match(releaseGate.snapshot.moneyActivationPlan.productionLaunchChecklist.copyableChecklist, /Status: ready/);
  assert.match(releaseGate.snapshot.moneyActivationPlan.productionLaunchChecklist.copyableChecklist, /Blocked until:\n  - none/);
});

test("trusted release gate requires verified PR head sha evidence", () => {
  const created = createSoldWebsiteWorkspaceForTest({
    businessName: "Head Sha Required Cafe",
    contactEmail: "owner@headsharequired.example",
    sourceUrl: "https://example.com/head-sha-required-cafe",
    mockupSlug: "head-sha-required-cafe",
    projectType: "website",
  });

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    repoFullName: "robert/head-sha-required-cafe",
    branchName: "codex/client-head-sha-required-cafe-website",
    githubIssueUrl: "https://github.com/robert/head-sha-required-cafe/issues/1",
    prUrl: "https://github.com/robert/head-sha-required-cafe/pull/2",
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: "https://github.com/robert/head-sha-required-cafe/pull/2#pullrequestreview-1",
    appQaStatus: "pass",
    appQaEvidenceUrl: "https://github.com/robert/head-sha-required-cafe/pull/2#issuecomment-app-qa",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/head-sha-required-cafe/pull/2#issuecomment-approval",
    notes: `PR, second review, App QA pass, App QA target revenue_delivery_workspace and Robert deploy approval verified for workspace ${created.workspace.id}, branch codex/client-head-sha-required-cafe-website, client Head Sha Required Cafe.`,
  }, {
    verifiedPrStatusReady: true,
  });

  assert.equal(releaseGate.status, "blocked");
  assert.match(releaseGate.reason, /head SHA/);
  assert.equal(releaseGate.workspace?.input.releaseGateHeadSha || "", "");
  assert.equal(releaseGate.snapshot.moneyActivationPlan.productionLaunchChecklist.status, "blocked");
});

test("trusted release gate requires App QA target workspace notes", () => {
  const created = createSoldWebsiteWorkspaceForTest({
    businessName: "Target Notes Cafe",
    contactEmail: "owner@targetnotes.example",
    sourceUrl: "https://example.com/target-notes-cafe",
    mockupSlug: "target-notes-cafe",
    projectType: "website",
  });

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    repoFullName: "robert/target-notes-cafe",
    branchName: "codex/client-target-notes-cafe-website",
    githubIssueUrl: "https://github.com/robert/target-notes-cafe/issues/1",
    prUrl: "https://github.com/robert/target-notes-cafe/pull/2",
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: "https://github.com/robert/target-notes-cafe/pull/2#pullrequestreview-1",
    appQaStatus: "pass",
    appQaEvidenceUrl: "https://github.com/robert/target-notes-cafe/pull/2#issuecomment-app-qa",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/target-notes-cafe/pull/2#issuecomment-approval",
    notes: `PR, second review, App QA pass and Robert deploy approval verified for workspace ${created.workspace.id}, branch codex/client-target-notes-cafe-website, client Target Notes Cafe.`,
  }, {
    verifiedPrStatusReady: true,
    verifiedPrHeadSha: "abc123def4567890",
  });

  assert.equal(releaseGate.status, "blocked");
  assert.match(releaseGate.reason, /App QA target/);
  assert.equal(releaseGate.workspace?.input.appQaEvidenceUrl || "", "");
  assert.equal(releaseGate.snapshot.moneyActivationPlan.productionLaunchChecklist.status, "blocked");
});

test("production launch checklist requires one coherent release-gated sold workspace", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  const reviewed = createSoldWebsiteWorkspaceForTest({
    businessName: "Reviewed Only Cafe",
    contactEmail: "owner@reviewedonly.example",
    sourceUrl: "https://example.com/reviewed-only-cafe",
    mockupSlug: "reviewed-only-cafe",
    projectType: "website",
  });
  const appQa = createSoldWebsiteWorkspaceForTest({
    businessName: "App QA Only Cafe",
    contactEmail: "owner@appqaonly.example",
    sourceUrl: "https://example.com/app-qa-only-cafe",
    mockupSlug: "app-qa-only-cafe",
    projectType: "website",
  });
  const approved = createSoldWebsiteWorkspaceForTest({
    businessName: "Approved Only Cafe",
    contactEmail: "owner@approvedonly.example",
    sourceUrl: "https://example.com/approved-only-cafe",
    mockupSlug: "approved-only-cafe",
    projectType: "website",
  });

  updateRevenueDeliveryWorkspaceQa({
    workspaceId: reviewed.workspace.id,
    repoFullName: "robert/reviewed-only-cafe",
    branchName: "codex/client-reviewed-only-cafe-website",
    githubIssueUrl: "https://github.com/robert/reviewed-only-cafe/issues/1",
    prUrl: "https://github.com/robert/reviewed-only-cafe/pull/2",
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: "https://github.com/robert/reviewed-only-cafe/pull/2#pullrequestreview-1",
  }, { allowGithubIssueEvidence: true, allowReleaseGateEvidence: true });
  updateRevenueDeliveryWorkspaceQa({
    workspaceId: appQa.workspace.id,
    repoFullName: "robert/app-qa-only-cafe",
    branchName: "codex/client-app-qa-only-cafe-website",
    githubIssueUrl: "https://github.com/robert/app-qa-only-cafe/issues/1",
    prUrl: "https://github.com/robert/app-qa-only-cafe/pull/2",
    appQaStatus: "pass",
    appQaEvidenceUrl: "https://github.com/robert/app-qa-only-cafe/pull/2#issuecomment-app-qa",
  }, { allowGithubIssueEvidence: true, allowReleaseGateEvidence: true });
  updateRevenueDeliveryWorkspaceQa({
    workspaceId: approved.workspace.id,
    repoFullName: "robert/approved-only-cafe",
    branchName: "codex/client-approved-only-cafe-website",
    githubIssueUrl: "https://github.com/robert/approved-only-cafe/issues/1",
    prUrl: "https://github.com/robert/approved-only-cafe/pull/2",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/approved-only-cafe/pull/2#issuecomment-approval",
  }, { allowGithubIssueEvidence: true, allowReleaseGateEvidence: true });

  const checklist = getRevenueEngineSnapshot().moneyActivationPlan.productionLaunchChecklist;

  assert.equal(checklist.status, "blocked");
  assert.equal(checklist.deploymentApprovalPacket.status, "waiting_for_external_evidence");
  assert.deepEqual(
    checklist.requiredEvidence.map((item) => [item.id, item.status]),
    [
      ["production_database", "ready"],
      ["pr_review", "blocked"],
      ["app_qa_release_gate", "blocked"],
      ["robert_deploy_approval", "blocked"],
    ],
  );
  assert.match(checklist.copyableChecklist, /same-workspace release packet/);
});

test("trusted release gate blocks anchored evidence without fresh PR status check", () => {
  const created = createSoldWebsiteWorkspaceForTest({
    businessName: "Anchored Evidence Cafe",
    contactEmail: "owner@anchoredevidence.example",
    sourceUrl: "https://example.com/anchored-evidence-cafe",
    mockupSlug: "anchored-evidence-cafe",
    projectType: "website",
  });

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    repoFullName: "robert/anchored-evidence-cafe",
    branchName: "codex/client-anchored-evidence-cafe-website",
    githubIssueUrl: "https://github.com/robert/anchored-evidence-cafe/issues/1",
    prUrl: "https://github.com/robert/anchored-evidence-cafe/pull/2",
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: "https://github.com/robert/anchored-evidence-cafe/pull/2#pullrequestreview-1",
    appQaStatus: "pass",
    appQaEvidenceUrl: "https://github.com/robert/anchored-evidence-cafe/pull/2#issuecomment-app-qa",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/anchored-evidence-cafe/pull/2#issuecomment-approval",
    notes: "Anchored URLs alone should not release without a fresh PR status check.",
  });

  assert.equal(releaseGate.status, "blocked");
  assert.match(releaseGate.reason, /fresh GitHub PR status check/);
  assert.equal(releaseGate.workspace?.input.prUrl || "", "");
  assert.equal(releaseGate.workspace?.approvalSummary.canLaunch, false);
});

test("trusted release gate blocks direct website workspace without sold opportunity chain", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Direct release website",
    clientName: "Direct Release Cafe",
    projectType: "website",
    packageName: "Website 3D Premium",
    setupUsd: 4200,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: false,
    launchTargetDays: 7,
    clientRequest: "Build approved public website.",
    repoFullName: "robert/direct-release-cafe",
    branchName: "codex/client-direct-release-cafe-website",
    githubIssueUrl: "https://github.com/robert/direct-release-cafe/issues/1",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    prUrl: "https://github.com/robert/direct-release-cafe/pull/2",
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: "https://github.com/robert/direct-release-cafe/pull/2#pullrequestreview-1",
    appQaStatus: "pass",
    appQaEvidenceUrl: "https://github.com/robert/direct-release-cafe/pull/2#issuecomment-app-qa",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/direct-release-cafe/pull/2#issuecomment-approval",
    notes: `PR, second review, App QA pass, App QA target revenue_delivery_workspace and Robert deploy approval verified for workspace ${created.workspace.id}, branch codex/client-direct-release-cafe-website, client Direct Release Cafe.`,
  });

  assert.equal(releaseGate.status, "blocked");
  assert.match(releaseGate.reason, /sourceOpportunityId vendido requerido/);
  assert.equal(releaseGate.workspace?.input.prUrl || "", "");
  assert.equal(releaseGate.workspace?.approvalSummary.canLaunch, false);
});

test("production launch checklist ignores direct workspace release fields without sold opportunity chain", () => {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  recordRevenueDeliveryWorkspace({
    workspaceName: "Injected release website",
    clientName: "Injected Release Cafe",
    projectType: "website",
    packageName: "Website 3D Premium",
    setupUsd: 4200,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: false,
    launchTargetDays: 7,
    clientRequest: "Attempt to seed release evidence directly.",
    repoFullName: "robert/injected-release-cafe",
    branchName: "codex/client-injected-release-cafe-website",
    githubIssueUrl: "https://github.com/robert/injected-release-cafe/issues/1",
    prUrl: "https://github.com/robert/injected-release-cafe/pull/2",
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: "https://github.com/robert/injected-release-cafe/pull/2#pullrequestreview-1",
    appQaStatus: "pass",
    appQaEvidenceUrl: "https://github.com/robert/injected-release-cafe/pull/2#issuecomment-app-qa",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/injected-release-cafe/pull/2#issuecomment-approval",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  const checklist = getRevenueEngineSnapshot().moneyActivationPlan.productionLaunchChecklist;

  assert.equal(checklist.status, "blocked");
  assert.equal(checklist.requiredEvidence.some((item) => item.id === "production_database" && item.status === "ready"), true);
  assert.equal(checklist.requiredEvidence.some((item) => item.id === "pr_review" && item.status === "blocked"), true);
  assert.equal(checklist.requiredEvidence.some((item) => item.id === "app_qa_release_gate" && item.status === "blocked"), true);
  assert.equal(checklist.requiredEvidence.some((item) => item.id === "robert_deploy_approval" && item.status === "blocked"), true);
});

test("trusted release gate blocks forged or incomplete release evidence", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Forged release website",
    clientName: "Forged Release Cafe",
    projectType: "website",
    packageName: "Website 3D Premium",
    setupUsd: 4200,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: false,
    launchTargetDays: 7,
    clientRequest: "Build approved public website.",
    repoFullName: "robert/forged-release-cafe",
    branchName: "codex/client-forged-release-cafe-website",
    githubIssueUrl: "https://github.com/robert/forged-release-cafe/issues/1",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    prUrl: "https://github.com/attacker/other-repo/pull/2",
    secondReviewStatus: "pass",
    appQaStatus: "pass",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/attacker/other-repo/pull/2#issuecomment-approval",
    notes: "claimed pass",
  });

  assert.equal(releaseGate.status, "blocked");
  assert.match(releaseGate.reason, /repo del workspace/);
  assert.equal(releaseGate.workspace?.input.prUrl || "", "");
  assert.equal(releaseGate.workspace?.input.secondReviewStatus || "pending", "pending");
  assert.equal(releaseGate.workspace?.approvalSummary.canLaunch, false);
});

test("trusted release gate rejects plain PR URL as review QA or approval evidence", () => {
  const created = createSoldWebsiteWorkspaceForTest({
    businessName: "Plain Evidence Cafe",
    contactEmail: "owner@plainevidence.example",
    sourceUrl: "https://example.com/plain-evidence-cafe",
    mockupSlug: "plain-evidence-cafe",
    projectType: "website",
  });
  const plainPrUrl = "https://github.com/robert/plain-evidence-cafe/pull/2";

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    repoFullName: "robert/plain-evidence-cafe",
    branchName: "codex/client-plain-evidence-cafe-website",
    githubIssueUrl: "https://github.com/robert/plain-evidence-cafe/issues/1",
    prUrl: plainPrUrl,
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: plainPrUrl,
    appQaStatus: "pass",
    appQaEvidenceUrl: plainPrUrl,
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: plainPrUrl,
    notes: `PR, second review, App QA pass, App QA target revenue_delivery_workspace and Robert deploy approval verified for workspace ${created.workspace.id}, branch codex/client-plain-evidence-cafe-website, client Plain Evidence Cafe.`,
  });

  assert.equal(releaseGate.status, "blocked");
  assert.match(releaseGate.reason, /secondReviewEvidenceUrl/);
  assert.match(releaseGate.reason, /appQaEvidenceUrl/);
  assert.match(releaseGate.reason, /deploymentApprovalUrl/);
  assert.equal(releaseGate.workspace?.input.prUrl || "", "");
  assert.equal(releaseGate.workspace?.input.secondReviewStatus || "pending", "pending");
  assert.equal(releaseGate.workspace?.input.appQaStatus || "pending", "pending");
  assert.equal(releaseGate.workspace?.input.deploymentApprovalStatus || "not_requested", "not_requested");
  assert.equal(releaseGate.workspace?.approvalSummary.canLaunch, false);
});

test("trusted release gate rejects PR query URLs without review or comment anchors", () => {
  const created = createSoldWebsiteWorkspaceForTest({
    businessName: "Query Evidence Cafe",
    contactEmail: "owner@queryevidence.example",
    sourceUrl: "https://example.com/query-evidence-cafe",
    mockupSlug: "query-evidence-cafe",
    projectType: "website",
  });
  const prUrl = "https://github.com/robert/query-evidence-cafe/pull/2";
  const queryPrUrl = `${prUrl}?claimed=review`;

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    repoFullName: "robert/query-evidence-cafe",
    branchName: "codex/client-query-evidence-cafe-website",
    githubIssueUrl: "https://github.com/robert/query-evidence-cafe/issues/1",
    prUrl,
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: queryPrUrl,
    appQaStatus: "pass",
    appQaEvidenceUrl: queryPrUrl,
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: queryPrUrl,
    notes: `PR, second review, App QA pass, App QA target revenue_delivery_workspace and Robert deploy approval verified for workspace ${created.workspace.id}, branch codex/client-query-evidence-cafe-website, client Query Evidence Cafe.`,
  });

  assert.equal(releaseGate.status, "blocked");
  assert.match(releaseGate.reason, /secondReviewEvidenceUrl/);
  assert.match(releaseGate.reason, /appQaEvidenceUrl/);
  assert.match(releaseGate.reason, /deploymentApprovalUrl/);
  assert.equal(releaseGate.workspace?.approvalSummary.canLaunch, false);
});

test("trusted release gate rejects PR tab URLs without review or comment anchors", () => {
  const created = createSoldWebsiteWorkspaceForTest({
    businessName: "Tab Evidence Cafe",
    contactEmail: "owner@tabevidence.example",
    sourceUrl: "https://example.com/tab-evidence-cafe",
    mockupSlug: "tab-evidence-cafe",
    projectType: "website",
  });
  const prUrl = "https://github.com/robert/tab-evidence-cafe/pull/2";
  const prTabUrl = `${prUrl}/files`;

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    repoFullName: "robert/tab-evidence-cafe",
    branchName: "codex/client-tab-evidence-cafe-website",
    githubIssueUrl: "https://github.com/robert/tab-evidence-cafe/issues/1",
    prUrl,
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: prTabUrl,
    appQaStatus: "pass",
    appQaEvidenceUrl: prTabUrl,
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: prTabUrl,
    notes: `PR, second review, App QA pass, App QA target revenue_delivery_workspace and Robert deploy approval verified for workspace ${created.workspace.id}, branch codex/client-tab-evidence-cafe-website, client Tab Evidence Cafe.`,
  });

  assert.equal(releaseGate.status, "blocked");
  assert.match(releaseGate.reason, /secondReviewEvidenceUrl/);
  assert.match(releaseGate.reason, /appQaEvidenceUrl/);
  assert.match(releaseGate.reason, /deploymentApprovalUrl/);
  assert.equal(releaseGate.workspace?.approvalSummary.canLaunch, false);
});

test("trusted release gate rejects wrong evidence anchor types", () => {
  const created = createSoldWebsiteWorkspaceForTest({
    businessName: "Wrong Anchor Cafe",
    contactEmail: "owner@wronganchor.example",
    sourceUrl: "https://example.com/wrong-anchor-cafe",
    mockupSlug: "wrong-anchor-cafe",
    projectType: "website",
  });
  const prUrl = "https://github.com/robert/wrong-anchor-cafe/pull/2";

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    repoFullName: "robert/wrong-anchor-cafe",
    branchName: "codex/client-wrong-anchor-cafe-website",
    githubIssueUrl: "https://github.com/robert/wrong-anchor-cafe/issues/1",
    prUrl,
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: `${prUrl}#issuecomment-second-review`,
    appQaStatus: "pass",
    appQaEvidenceUrl: `${prUrl}#pullrequestreview-app-qa`,
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: `${prUrl}#pullrequestreview-approval`,
    notes: `PR, second review, App QA pass, App QA target revenue_delivery_workspace and Robert deploy approval verified for workspace ${created.workspace.id}, branch codex/client-wrong-anchor-cafe-website, client Wrong Anchor Cafe.`,
  }, {
    verifiedPrStatusReady: true,
    verifiedPrHeadSha: "def456abc1237890",
  });

  assert.equal(releaseGate.status, "blocked");
  assert.match(releaseGate.reason, /secondReviewEvidenceUrl/);
  assert.match(releaseGate.reason, /appQaEvidenceUrl/);
  assert.match(releaseGate.reason, /deploymentApprovalUrl/);
  assert.equal(releaseGate.workspace?.input.prUrl || "", "");
  assert.equal(releaseGate.workspace?.approvalSummary.canLaunch, false);
});

test("trusted release gate rejects PR subpath evidence even with valid anchors", () => {
  const created = createSoldWebsiteWorkspaceForTest({
    businessName: "Subpath Evidence Cafe",
    contactEmail: "owner@subpathevidence.example",
    sourceUrl: "https://example.com/subpath-evidence-cafe",
    mockupSlug: "subpath-evidence-cafe",
    projectType: "website",
  });
  const prUrl = "https://github.com/robert/subpath-evidence-cafe/pull/2";

  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    repoFullName: "robert/subpath-evidence-cafe",
    branchName: "codex/client-subpath-evidence-cafe-website",
    githubIssueUrl: "https://github.com/robert/subpath-evidence-cafe/issues/1",
    prUrl,
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: `${prUrl}/files#pullrequestreview-1`,
    appQaStatus: "pass",
    appQaEvidenceUrl: `${prUrl}/files#issuecomment-app-qa`,
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: `${prUrl}/commits/abc#issuecomment-approval`,
    notes: `PR, second review, App QA pass, App QA target revenue_delivery_workspace and Robert deploy approval verified for workspace ${created.workspace.id}, branch codex/client-subpath-evidence-cafe-website, client Subpath Evidence Cafe.`,
  }, {
    verifiedPrStatusReady: true,
    verifiedPrHeadSha: "fed654cba3217890",
  });

  assert.equal(releaseGate.status, "blocked");
  assert.match(releaseGate.reason, /secondReviewEvidenceUrl/);
  assert.match(releaseGate.reason, /appQaEvidenceUrl/);
  assert.match(releaseGate.reason, /deploymentApprovalUrl/);
  assert.equal(releaseGate.workspace?.input.prUrl || "", "");
  assert.equal(releaseGate.workspace?.approvalSummary.canLaunch, false);
});

test("trusted delivery endpoint helper delivers only after trusted release gate approval", () => {
  const created = createSoldWebsiteWorkspaceForTest({
    businessName: "Trusted Delivered Cafe",
    contactEmail: "owner@trusteddelivered.example",
    sourceUrl: "https://example.com/trusted-delivered-cafe",
    mockupSlug: "trusted-delivered-cafe",
    projectType: "website",
  });
  const releaseGate = recordRevenueDeliveryReleaseGate({
    workspaceId: created.workspace.id,
    repoFullName: "robert/trusted-delivered-cafe",
    branchName: "codex/client-trusted-delivered-cafe-website",
    githubIssueUrl: "https://github.com/robert/trusted-delivered-cafe/issues/1",
    prUrl: "https://github.com/robert/trusted-delivered-cafe/pull/2",
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: "https://github.com/robert/trusted-delivered-cafe/pull/2#pullrequestreview-1",
    appQaStatus: "pass",
    appQaEvidenceUrl: "https://github.com/robert/trusted-delivered-cafe/pull/2#issuecomment-app-qa",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/trusted-delivered-cafe/pull/2#issuecomment-approval",
    notes: `PR, second review, App QA pass, App QA target revenue_delivery_workspace and Robert deploy approval verified for workspace ${created.workspace.id}, branch codex/client-trusted-delivered-cafe-website, client Trusted Delivered Cafe.`,
  }, {
    verifiedPrStatusReady: true,
    verifiedPrHeadSha: "123abc456def7890",
  });

  const untrustedDelivery = deliverRevenueDeliveryWorkspace({
    workspaceId: created.workspace.id,
    approvedByRobert: true,
  });
  const trustedDelivery = deliverRevenueDeliveryWorkspaceFromTrustedApproval({
    workspaceId: created.workspace.id,
    approvedByRobert: true,
    notes: "Robert approved final delivery after PR, second review and App QA.",
  });

  assert.equal(releaseGate.status, "ready");
  assert.equal(untrustedDelivery.status, "blocked");
  assert.match(untrustedDelivery.reason, /gate confiable/);
  assert.equal(trustedDelivery.status, "delivered");
  assert.equal(trustedDelivery.handoff?.clientName, "Trusted Delivered Cafe");
  assert.equal(trustedDelivery.opportunity?.id, created.opportunity.id);
  assert.equal(trustedDelivery.opportunity?.status, "delivered");
  assert.equal(trustedDelivery.workspace?.learningNote.includes("entregado con QA aprobado"), true);
  assert.equal(
    trustedDelivery.snapshot.recentWebsiteOpportunities.find((item) => item.id === created.opportunity.id)?.status,
    "delivered",
  );
  assert.equal(
    trustedDelivery.snapshot.websiteDeliveryHandoffQueue.items.some((item) => item.opportunityId === created.opportunity.id),
    false,
  );

  setRevenueWebsiteOpportunitiesPathForTests(testWebsiteOpportunitiesPath);
  const reloadedSnapshot = getRevenueEngineSnapshot();
  assert.equal(
    reloadedSnapshot.recentWebsiteOpportunities.find((item) => item.id === created.opportunity.id)?.status,
    "delivered",
  );
  assert.equal(
    reloadedSnapshot.websiteDeliveryHandoffQueue.items.some((item) => item.opportunityId === created.opportunity.id),
    false,
  );

  const retriedDelivery = deliverRevenueDeliveryWorkspaceFromTrustedApproval({
    workspaceId: created.workspace.id,
    approvedByRobert: true,
    notes: "Retry after persisted delivery state.",
  });

  assert.equal(retriedDelivery.status, "delivered");
  assert.equal(retriedDelivery.opportunity?.status, "delivered");
  assert.doesNotMatch(retriedDelivery.reason, /oportunidad website no vendida/);
});

test("trusted delivery blocks direct ready website workspace without sold opportunity chain", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Direct delivered website",
    clientName: "Direct Delivered Cafe",
    projectType: "website",
    packageName: "Website 3D Premium",
    setupUsd: 4200,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: false,
    launchTargetDays: 7,
    clientRequest: "Build approved public website.",
    repoFullName: "robert/direct-delivered-cafe",
    branchName: "codex/client-direct-delivered-cafe-website",
    githubIssueUrl: "https://github.com/robert/direct-delivered-cafe/issues/1",
    prUrl: "https://github.com/robert/direct-delivered-cafe/pull/2",
    secondReviewStatus: "pass",
    secondReviewEvidenceUrl: "https://github.com/robert/direct-delivered-cafe/pull/2#pullrequestreview-1",
    appQaStatus: "pass",
    appQaEvidenceUrl: "https://github.com/robert/direct-delivered-cafe/pull/2#issuecomment-app-qa",
    deploymentApprovalStatus: "approved",
    deploymentApprovalUrl: "https://github.com/robert/direct-delivered-cafe/pull/2#issuecomment-approval",
    releaseGateHeadSha: "cafe123456789abc",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  assert.equal(created.workspace.status, "ready_to_deliver");

  const trustedDelivery = deliverRevenueDeliveryWorkspaceFromTrustedApproval({
    workspaceId: created.workspace.id,
    approvedByRobert: true,
    notes: "Robert approved final delivery after PR, second review and App QA.",
  });

  assert.equal(trustedDelivery.status, "blocked");
  assert.match(trustedDelivery.reason, /sourceOpportunityId vendido requerido/);
});

test("trusted delivery rejects string false Robert approval", () => {
  assert.throws(
    () => revenueDeliveryWorkspaceDeliverSchema.parse({
      workspaceId: "delivery-workspace-1",
      approvedByRobert: "false",
    }),
    /Expected boolean/,
  );
});

test("money sprint parses pasted lead batches with partial failures", () => {
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "restaurant",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      "Batch Bistro|Miami|restaurant|no_website|email|owner@batchbistro.example|https://example.com/batch-bistro|owner@batchbistro.example|Google listing has no website and recent menu photos are only on public social profiles.|Needs menu, catering inquiry capture and follow-up.|3500|Owner|Batch Bistro has no dedicated website and a clear catering/menu opportunity.",
      "Bad Row|Miami|restaurant|no_website|email|owner@badrow.example|notaurl|owner@badrow.example|short|Needs website.|2500|Owner|",
    ].join("\n"),
  });

  assert.equal(result.status, "ready_to_start");
  assert.equal(result.recordedLeads.length, 1);
  assert.equal(result.recordedLeads[0].lead.businessName, "Batch Bistro");
  assert.equal(result.previews.length, 1);
  assert.equal(result.previews[0].fileWritten, false);
  assert.equal(existsSync(getRevenueMockupPreviewPath(result.previews[0].slug)), false);
  assert.equal(result.outreachDrafts.length, 1);
  assert.equal(result.outreachDrafts[0].status, "draft");
  assert.equal(result.outreachDrafts[0].delivery.sendStatus, "not_sent");
  assert.equal(result.blockedSeeds.length, 1);
  assert.equal(result.blockedSeeds[0].businessName, "Bad Row");
});

test("money sprint parses quoted CSV batches with pipes inside evidence", () => {
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "salon",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeadBatchText: [
      "business,area,niche,website,channel,contact,sourceUrl,recipientEmail,evidence,painPoint,offer",
      "\"CSV Salon\",\"Miami\",\"salon\",\"no_website\",\"email\",\"owner@csvsalon.example\",\"https://example.com/csv-salon-csvsalon\",\"owner@csvsalon.example\",\"Google listing has no website | Instagram profile has recent service photos and contact path.\",\"Needs booking capture and follow-up.\",\"3200\"",
    ].join("\n"),
  });

  assert.equal(result.recordedLeads.length, 1);
  assert.equal(result.recordedLeads[0].lead.businessName, "CSV Salon");
  assert.equal(result.recordedLeads[0].lead.evidence.includes("| Instagram"), true);
  assert.equal(result.outreachDrafts.length, 1);
  assert.equal(result.blockedSeeds.length, 0);
});

test("money sprint preview parses batch without persisting leads drafts or previews", () => {
  const result = previewRevenueMoneySprintSeeds({
    area: "Miami",
    niche: "salon",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeadBatchText: [
      "business,area,niche,website,channel,contact,sourceUrl,recipientEmail,evidence,painPoint,offer",
      "\"Preview Salon\",\"Miami\",\"salon\",\"no_website\",\"email\",\"owner@previewsalon.example\",\"https://example.com/preview-salon\",\"owner@previewsalon.example\",\"Public profile has no website, recent service photos and a verified contact path.\",\"Needs online booking capture and follow-up.\",\"3200\"",
      "\"Weak Row\",\"Miami\",\"salon\",\"unknown\",\"unknown\",\"\",\"\",\"\",\"short\",\"Needs review.\",\"1000\"",
    ].join("\n"),
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "ready_to_import");
  assert.equal(result.totals.accepted, 1);
  assert.equal(result.totals.blocked, 1);
  assert.equal(result.totals.mockupReady, 1);
  assert.equal(result.totals.draftReady, 1);
  assert.equal(result.acceptedSeeds[0].businessName, "Preview Salon");
  assert.equal(result.acceptedSeeds[0].draftReady, true);
  assert.equal(result.blockedSeeds[0].businessName, "Weak Row");
  assert.match(result.blockedSeeds[0].reason, /sourceUrl publico/);
  assert.equal(result.safety.persistsData, false);
  assert.equal(result.safety.writesPreviewFiles, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("money sprint preview treats manual-channel leads as draft-ready without email", () => {
  const result = previewRevenueMoneySprintSeeds({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      "Manual Preview Cafe|Miami|coffee shop|no_website|instagram|@manualpreviewcafe|https://instagram.com/manualpreviewcafe||Public Instagram profile has no website link, recent menu photos and a visible DM contact path.|Needs online menu, catering inquiry capture and follow-up.|3600|Owner|Manual Preview Cafe has public Instagram evidence and no dedicated website.",
    ].join("\n"),
  });

  assert.equal(result.status, "ready_to_import");
  assert.equal(result.totals.accepted, 1);
  assert.equal(result.totals.draftReady, 1);
  assert.equal(result.acceptedSeeds[0].draftReady, true);
  assert.deepEqual(result.acceptedSeeds[0].missingForDraft, []);
  assert.equal(result.acceptedSeeds[0].recipientEmail, "");
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(getRevenueEngineSnapshot().recentOutreach.length, 0);
});

test("money sprint blocks generic or unrelated source urls before persisting leads", () => {
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      "Generic Search Cafe|Miami|coffee shop|no_website|email|owner@genericsearch.example|https://www.google.com/search?q=coffee+shops+miami|owner@genericsearch.example|Google search result mentions coffee shops but does not prove this specific business contact path.|Needs online menu.|3500|Owner|Generic row should not persist from a search results page.",
      "Unrelated Source Cafe|Miami|coffee shop|no_website|email|owner@unrelatedsource.example|https://example.com/best-cafes-miami|owner@unrelatedsource.example|Directory article is generic and does not tie the URL to this business contact path.|Needs online menu.|3500|Owner|Unrelated row should not persist from a generic article.",
    ].join("\n"),
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "needs_lead_evidence");
  assert.equal(result.recordedLeads.length, 0);
  assert.equal(result.previews.length, 0);
  assert.equal(result.outreachDrafts.length, 0);
  assert.equal(result.blockedSeeds.length, 2);
  assert.equal(result.blockedSeeds.every((seed) => seed.reason.includes("sourceUrl must match")), true);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("money sprint blocks generic platform urls before persisting leads", () => {
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      "Generic Instagram Cafe|Miami|coffee shop|no_website|instagram|https://instagram.com/genericinstagramcafe|https://instagram.com/explore/tags/coffee|owner@genericinstagram.example|Instagram hashtag page mentions coffee but not this business profile.|Needs online menu.|3500|Owner|Generic platform URL should not persist.",
      "Generic Yelp Cafe|Miami|coffee shop|no_website|contact_form|https://genericyelpcafe.example/contact|https://www.yelp.com/search?find_desc=coffee&find_loc=Miami|owner@genericyelp.example|Yelp category search is public but not tied to this specific business.|Needs online menu.|3500|Owner|Generic platform URL should not persist.",
    ].join("\n"),
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "needs_lead_evidence");
  assert.equal(result.recordedLeads.length, 0);
  assert.equal(result.blockedSeeds.length, 2);
  assert.equal(result.blockedSeeds.every((seed) => seed.reason.includes("sourceUrl must match")), true);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("money sprint preview respects daily mockup limit", () => {
  const row = (index: number) => [
    `Limit Cafe ${index}`,
    "Miami",
    "coffee shop",
    "no_website",
    "email",
    `owner${index}@limitcafe.example`,
    `https://example.com/limit-cafe-${index}`,
    `owner${index}@limitcafe.example`,
    "Google listing has no website, public social profile has products and verified contact path.",
    "Needs online menu capture and follow-up.",
    "3200",
  ].join("|");
  const result = previewRevenueMoneySprintSeeds({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 1,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer",
      row(1),
      row(2),
      row(3),
    ].join("\n"),
  });

  assert.equal(result.totals.accepted, 3);
  assert.equal(result.totals.mockupReady, 1);
  assert.deepEqual(result.acceptedSeeds.map((seed) => seed.mockupReady), [true, false, false]);
});

test("money sprint preview requires approval before paid data spend", () => {
  const result = previewRevenueMoneySprintSeeds({
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 250,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer",
      [
        "Approval Roof Co",
        "Orlando",
        "roofers",
        "no_website",
        "email",
        "owner@approvalroof.example",
        "https://example.com/approval-roof",
        "owner@approvalroof.example",
        "Google listing has no website, public profile has verified service photos and contact path.",
        "Needs storm repair lead capture and follow-up.",
        "4200",
      ].join("|"),
    ].join("\n"),
  });

  assert.equal(result.status, "needs_spend_approval");
  assert.equal(result.totals.mockupReady, 1);
  assert.equal(result.safety.persistsData, false);
  assert.equal(result.safety.writesPreviewFiles, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.match(result.safety.nextAction, /approval/i);
});

test("money sprint caps pasted lead batch at remaining seed lead slots", () => {
  const row = (index: number) => [
    `Batch Cafe ${index}`,
    "Miami",
    "coffee shop",
    "no_website",
    "email",
    `owner${index}@batchcafe.example`,
    `https://example.com/batch-cafe-${index}`,
    `owner${index}@batchcafe.example`,
    "Google listing has no website, public profile has recent products and contact path.",
    "Needs online ordering inquiry capture and follow-up.",
    "3000",
  ].join("|");
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 25,
    dailyMockupLimit: 25,
    dailyContactLimit: 10,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer",
      ...Array.from({ length: 27 }, (_, index) => row(index + 1)),
    ].join("\n"),
  });

  assert.equal(result.recordedLeads.length, 25);
  assert.equal(result.blockedSeeds.filter((seed) => seed.reason === "batch limit 25").length, 2);
  assert.equal(result.outreachDrafts.every((draft) => draft.status === "draft" && draft.delivery.sendStatus === "not_sent"), true);
});

test("money sprint surfaces paid data approval amount without spending automatically", () => {
  const result = runRevenueMoneySprint({
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 250,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeads: [],
  });

  assert.equal(result.status, "needs_spend_approval");
  assert.equal(result.operatingLimits.maxPaidDataSpendUsd, 100);
  assert.equal(result.mission.budgetGate.requiresApprovalToSpend, true);
  assert.equal(result.previews.length, 0);
  assert.equal(result.outreachDrafts.length, 0);
});

test("sales autopilot blocks when internal cost breaks the starting cap", () => {
  const result = recordRevenueSalesAutopilot({
    businessName: "Expensive Automation",
    area: "Miami",
    niche: "clinic",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "owner@example.com",
    evidence: "Public website is slow and has no booking workflow or lead follow-up.",
    painPoint: "Needs booking, reminders and reporting.",
    request: "Build automation with many paid tools and live messaging before deposit.",
    projectType: "automation",
    estimatedOfferUsd: 2500,
    estimatedInternalCostUsd: 180,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 0,
    recipientEmail: "owner@example.com",
    sourceUrl: "https://example.com/expensive-automation",
    businessSummary: "Expensive Automation has a weak website and needs booking automation.",
    approvalToContact: true,
    approvalToSpend: false,
    approvalToBuild: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.outreachDraft, null);
  assert.equal(result.requiredBeforeExternalAction.includes("reducir costo interno bajo $100/mes"), true);
  assert.equal(result.agentRun.status, "blocked");
});

test("sales autopilot rejects string false approval flags", () => {
  assert.throws(
    () => recordRevenueSalesAutopilot({
      businessName: "String False Sales Cafe",
      area: "Miami",
      niche: "coffee shop",
      websiteStatus: "no_website",
      contactChannel: "email",
      contactValue: "owner@stringfalsesales.example",
      evidence: "Public listing has no website and verified owner email.",
      painPoint: "Needs online menu and catering capture.",
      request: "Prepare website mockup and outreach draft for a conversion-focused menu site.",
      projectType: "website",
      estimatedOfferUsd: 3200,
      estimatedInternalCostUsd: 54,
      monthlyBudgetUsd: 100,
      cashCollectedUsd: 0,
      recipientEmail: "owner@stringfalsesales.example",
      businessSummary: "String False Sales Cafe has a verified public listing and no website.",
      approvalToContact: "false",
      approvalToSpend: "false",
      approvalToBuild: "false",
    } as Parameters<typeof recordRevenueSalesAutopilot>[0]),
    /Expected boolean/,
  );

  assert.equal(getRevenueEngineSnapshot().recentOutreach.length, 0);
});

test("blocks outreach draft when evidence or cost cap fails", () => {
  const result = recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "lead@example.com",
    contactName: "Lead",
    businessName: "Risky Outreach",
    businessSummary: "Too vague.",
    websitePriceUsd: 1500,
    automationPriceUsd: 1500,
    monthlyRetainerUsd: 150,
    estimatedInternalMonthlyCostUsd: 125,
    notes: "",
  });

  assert.equal(result.draft.status, "blocked");
  assert.equal(result.draft.pricing.insideCostCap, false);
  assert.equal(result.draft.qaGates.some((gate) => gate.gate === "evidence" && gate.passed === false), true);
  assert.equal(result.draft.qaGates.some((gate) => gate.gate === "cost" && gate.passed === false), true);
});

test("persists outreach drafts across module state reloads", () => {
  recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "client@example.com",
    contactName: "Client",
    businessName: "Persisted Outreach",
    sourceUrl: "https://example.com",
    businessSummary: "Persisted Outreach has a public site and needs better lead capture, follow-up and quote tracking.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  setRevenueOutreachPathForTests(testOutreachPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentOutreach[0].businessName, "Persisted Outreach");
  assert.equal(snapshot.recentOutreach[0].status, "approved");
});

test("blocks outreach send when email provider is missing", async () => {
  const result = recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "client@example.com",
    contactName: "Client",
    businessName: "Provider Missing Outreach",
    sourceUrl: "https://example.com",
    businessSummary: "Provider Missing Outreach has public data and a clear need for website conversion and follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: result.draft.id,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "blocked");
  assert.equal(sendResult.provider.configured, false);
  assert.equal(sendResult.draft?.delivery.sendStatus, "provider_missing");
  assert.equal(sendResult.gates.some((gate) => gate.gate === "provider_configured" && gate.passed === false), true);
});

test("outreach send rejects string false approval without sending", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  let sendCount = 0;
  setRevenueOutreachSenderForTests(async () => {
    sendCount += 1;
    return { id: "should_not_send" };
  });
  const result = recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "owner@string-false-send.example",
    contactName: "Owner",
    businessName: "String False Send Cafe",
    sourceUrl: "https://example.com/string-false-send-cafe",
    businessSummary: "String False Send Cafe has public no-website evidence and a verified owner email path.",
    websitePriceUsd: 3200,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  await assert.rejects(
    () => sendRevenueOutreachDraft({
      draftId: result.draft.id,
      approvalToSend: "false",
    } as Parameters<typeof sendRevenueOutreachDraft>[0]),
    /Expected boolean/,
  );

  assert.equal(sendCount, 0);
  assert.equal(getRevenueEngineSnapshot().recentOutreach[0].delivery.sendStatus, "not_sent");
});

test("blocks outreach send when email provider values are placeholders", async () => {
  process.env.RESEND_API_KEY = "replace-with-resend-api-key";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "your-email@example.com";
  const result = recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "client@example.com",
    contactName: "Client",
    businessName: "Placeholder Provider Outreach",
    sourceUrl: "https://example.com",
    businessSummary: "Placeholder Provider Outreach has public data and a clear need for website conversion.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: result.draft.id,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "blocked");
  assert.equal(sendResult.provider.configured, false);
  assert.equal(sendResult.provider.missing.includes("RESEND_API_KEY"), true);
  assert.equal(sendResult.provider.missing.includes("REVENUE_ENGINE_FROM_EMAIL"), true);
  assert.equal(sendResult.draft?.delivery.sendStatus, "provider_missing");
});

test("blocks outreach send when approved draft is outside the daily manual queue", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  for (let index = 1; index <= 11; index += 1) {
    recordRevenueOutreachDraft({
      channel: "email",
      approvalStatus: "approved",
      recipientEmail: `client${index}@dailycap.example`,
      contactName: "Client",
      businessName: `Daily Cap Outreach ${index}`,
      sourceUrl: `https://example.com/daily-cap-${index}`,
      businessSummary: `Daily Cap Outreach ${index} has public evidence and a clear need for website conversion and follow-up.`,
      websitePriceUsd: 3500,
      automationPriceUsd: 2500,
      monthlyRetainerUsd: 750,
      estimatedInternalMonthlyCostUsd: 54,
      notes: "",
    });
  }
  const overflowDraft = getRevenueEngineSnapshot().manualOutreachQueue.blocked.find((item) =>
    item.reason.includes("Daily contact limit reached")
  );
  assert.ok(overflowDraft);
  setRevenueOutreachSenderForTests(async () => {
    throw new Error("sender should not run for overflow draft");
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: overflowDraft.draftId,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "blocked");
  assert.equal(sendResult.gates.some((gate) => gate.gate === "daily_contact_cap" && gate.passed === false), true);
  assert.equal(sendResult.reason?.includes("limite diario"), true);
  assert.equal(sendResult.draft?.delivery.sendStatus, "blocked");
});

test("enforces daily outreach cap after sequential provider sends", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  for (let index = 1; index <= 11; index += 1) {
    recordRevenueOutreachDraft({
      channel: "email",
      approvalStatus: "approved",
      recipientEmail: `client${index}@sequentialcap.example`,
      contactName: "Client",
      businessName: `Sequential Cap Outreach ${index}`,
      sourceUrl: `https://example.com/sequential-cap-${index}`,
      businessSummary: `Sequential Cap Outreach ${index} has public evidence and a clear need for website conversion and follow-up.`,
      websitePriceUsd: 3500,
      automationPriceUsd: 2500,
      monthlyRetainerUsd: 750,
      estimatedInternalMonthlyCostUsd: 54,
      notes: "",
    });
  }

  let sendCount = 0;
  setRevenueOutreachSenderForTests(async () => {
    sendCount += 1;
    return { id: `email_sequential_${sendCount}` };
  });

  for (let index = 0; index < 10; index += 1) {
    const nextDraft = getRevenueEngineSnapshot().manualOutreachQueue.items[0];
    assert.ok(nextDraft);
    const sendResult = await sendRevenueOutreachDraft({
      draftId: nextDraft.draftId,
      approvalToSend: true,
    });
    assert.equal(sendResult.status, "sent");
  }

  const cappedQueue = getRevenueEngineSnapshot().manualOutreachQueue;
  assert.equal(sendCount, 10);
  assert.equal(cappedQueue.readyCount, 0);
  assert.equal(cappedQueue.blocked.some((item) => item.reason.includes("Daily contact limit already used")), true);
  const cappedDraft = cappedQueue.blocked.find((item) => item.reason.includes("Daily contact limit already used"));
  assert.ok(cappedDraft);

  const blockedSend = await sendRevenueOutreachDraft({
    draftId: cappedDraft.draftId,
    approvalToSend: true,
  });

  assert.equal(blockedSend.status, "blocked");
  assert.equal(blockedSend.gates.some((gate) => gate.gate === "daily_contact_cap" && gate.passed === false), true);
  assert.equal(sendCount, 10);
});

test("blocks provider send for manual-only outreach channels", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  let sendAttempts = 0;
  setRevenueOutreachSenderForTests(async () => {
    sendAttempts += 1;
    return { id: "must_not_send" };
  });

  for (const channel of ["gmail", "mailto", "instagram", "contact_form"] as const) {
    const result = recordRevenueOutreachDraft({
      channel,
      approvalStatus: "approved",
      recipientEmail: `owner-${channel}@manualchannel.example`,
      contactName: "Owner",
      businessName: `Manual Channel Outreach ${channel}`,
      sourceUrl: `https://example.com/manual-channel/${channel}`,
      businessSummary: `Manual Channel Outreach ${channel} has public evidence and needs a website conversion follow-up.`,
      websitePriceUsd: 3500,
      automationPriceUsd: 2500,
      monthlyRetainerUsd: 750,
      estimatedInternalMonthlyCostUsd: 54,
      notes: "",
    });

    const sendResult = await sendRevenueOutreachDraft({
      draftId: result.draft.id,
      approvalToSend: true,
    });

    assert.equal(sendResult.status, "blocked");
    assert.equal(sendResult.gates.some((gate) => gate.gate === "email_channel" && gate.passed === false), true);
    assert.equal(sendResult.reason?.includes("Solo drafts con channel=email"), true);
    assert.equal(sendResult.draft?.delivery.sendStatus, "blocked");
  }

  assert.equal(sendAttempts, 0);
});

test("uses fallback Resend from email when Revenue Engine from email is a placeholder", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "your-email@example.com";
  process.env.RESEND_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  const result = recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "client@example.com",
    contactName: "Client",
    businessName: "Fallback Sender Outreach",
    sourceUrl: "https://example.com",
    businessSummary: "Fallback Sender Outreach has public data and a clear need for website conversion.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  setRevenueOutreachSenderForTests(async (payload) => {
    assert.equal(payload.from, "Revenue Engine <sales@example.com>");
    return { id: "email_fallback_sender" };
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: result.draft.id,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "sent");
  assert.equal(sendResult.provider.configured, true);
  assert.equal(sendResult.provider.fromEmail, "Revenue Engine <sales@example.com>");
});

test("sends approved outreach with configured provider and updates matching lead", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  let capturedTo = "";
  setRevenueOutreachSenderForTests(async (payload) => {
    capturedTo = payload.to;
    assert.equal(payload.from, "Revenue Engine <sales@example.com>");
    assert.equal(payload.subject.includes("Ready Outreach"), true);
    assert.equal(payload.idempotencyKey.startsWith("outreach-"), true);
    return { id: "email_123" };
  });
  const leadResult = recordRevenueLead({
    businessName: "Ready Outreach",
    area: "Miami",
    niche: "fitness",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "client@example.com",
    evidence: "Public website has services but weak capture.",
    painPoint: "Needs automation follow-up.",
    estimatedOfferUsd: 6000,
    status: "qualified",
  });
  const result = recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "client@example.com",
    contactName: "Client",
    businessName: "Ready Outreach",
    sourceUrl: "https://example.com",
    businessSummary: "Ready Outreach has a weak website and needs better lead capture, service conversion and automated follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: result.draft.id,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "sent");
  assert.equal(capturedTo, "client@example.com");
  assert.equal(sendResult.draft.delivery.sendStatus, "sent");
  assert.equal(sendResult.draft.delivery.externalMessageId, "email_123");
  assert.equal(sendResult.snapshot.recentLeads[0].status, "proposal_sent");
});

test("blocks outreach outcome until Robert confirms the manual result", () => {
  const draftResult = recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "owner@manualoutcome.example",
    contactName: "Owner",
    businessName: "Manual Outcome Cafe",
    sourceUrl: "https://example.com/manual-outcome-cafe",
    businessSummary: "Manual Outcome Cafe has public evidence of no dedicated website and a visible owner contact.",
    websitePriceUsd: 3200,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const outcome = recordRevenueOutreachOutcome({
    draftId: draftResult.draft.id,
    outcome: "reply",
    outcomeRecordedByRobert: false,
  });

  assert.equal(outcome.status, "blocked");
  assert.match(outcome.reason, /Robert/);
  assert.equal(outcome.gates.some((gate) => gate.gate === "human_recorded" && gate.passed === false), true);
  assert.equal(outcome.snapshot.recentOutreach[0].delivery.outcome, undefined);
});

test("records reply and call outcomes on approved outreach drafts", () => {
  const leadResult = recordRevenueLead({
    businessName: "Booked Reply Studio",
    area: "Miami",
    niche: "fitness",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "owner@bookedreply.example",
    evidence: "Public site has weak conversion and visible email.",
    painPoint: "Needs stronger lead capture.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const draftResult = recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "owner@bookedreply.example",
    contactName: "Owner",
    businessName: "Booked Reply Studio",
    sourceUrl: "https://example.com/booked-reply",
    businessSummary: "Booked Reply Studio has public evidence of a weak website and needs lead capture.",
    websitePriceUsd: 3200,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const reply = recordRevenueOutreachOutcome({
    draftId: draftResult.draft.id,
    outcome: "reply",
    outcomeRecordedByRobert: true,
    notes: "Owner replied asking for examples.",
  });

  assert.equal(reply.status, "recorded");
  assert.equal(reply.draft?.delivery.sendStatus, "sent");
  assert.equal(reply.draft?.delivery.outcome, "reply");
  assert.equal(reply.draft?.delivery.outcomeNotes, "Owner replied asking for examples.");
  assert.equal(reply.lead?.status, "contacted");

  const call = recordRevenueOutreachOutcome({
    draftId: draftResult.draft.id,
    outcome: "call_booked",
    outcomeRecordedByRobert: true,
  });

  assert.equal(call.status, "recorded");
  assert.equal(call.draft?.delivery.outcome, "call_booked");
  assert.equal(call.lead?.status, "proposal_sent");
});

test("records deposit outreach outcome without double-counting ledger cash", () => {
  process.env.DATABASE_URL = testDatabaseUrl;
  enableRevenueEngineDurablePersistenceForTests();

  const leadResult = recordRevenueLead({
    businessName: "Deposit Ready Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@depositready.example",
    evidence: "Public listing has no website, active menu posts and visible owner email.",
    painPoint: "Needs online menu and catering capture.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const draftResult = recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "owner@depositready.example",
    contactName: "Owner",
    businessName: "Deposit Ready Cafe",
    sourceUrl: "https://example.com/deposit-ready-cafe",
    mockupUrl: "/api/revenue-engine/mockup-previews/deposit-ready-cafe",
    businessSummary: "Deposit Ready Cafe has no dedicated website and needs online menu, catering capture and follow-up.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const blocked = recordRevenueOutreachOutcome({
    draftId: draftResult.draft.id,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd: 0,
  });
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.reason, /cashCollectedUsd/);

  const missingPaymentEvidence = recordRevenueOutreachOutcome({
    draftId: draftResult.draft.id,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd: draftResult.draft.pricing.depositUsd,
  });
  assert.equal(missingPaymentEvidence.status, "blocked");
  assert.match(missingPaymentEvidence.reason, /referencia|comprobante/);
  assert.equal(missingPaymentEvidence.gates.some((gate) => gate.gate === "deposit_payment_evidence" && gate.passed === false), true);

  const weakPaymentEvidence = recordRevenueOutreachOutcome({
    draftId: draftResult.draft.id,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd: draftResult.draft.pricing.depositUsd,
    paymentConfirmation: "paid",
  });
  assert.equal(weakPaymentEvidence.status, "blocked");
  assert.match(weakPaymentEvidence.reason, /verificable/);
  assert.equal(weakPaymentEvidence.gates.some((gate) => gate.gate === "deposit_payment_evidence" && gate.passed === false), true);
  assert.equal(weakPaymentEvidence.snapshot.metrics.cashCollectedUsd, 0);
  assert.equal(weakPaymentEvidence.snapshot.recentWebsiteOpportunities.length, 0);

  for (const paymentConfirmation of ["Robert confirmed deposit.", "paid on 6/30", "deposit 2100 received", "payment confirmation 6/30", "invoice 1"]) {
    const weakNarrativeEvidence = recordRevenueOutreachOutcome({
      draftId: draftResult.draft.id,
      outcome: "deposit_collected",
      outcomeRecordedByRobert: true,
      cashCollectedUsd: draftResult.draft.pricing.depositUsd,
      paymentConfirmation,
    });
    assert.equal(weakNarrativeEvidence.status, "blocked");
    assert.match(weakNarrativeEvidence.reason, /verificable/);
    assert.equal(weakNarrativeEvidence.snapshot.metrics.cashCollectedUsd, 0);
    assert.equal(weakNarrativeEvidence.snapshot.recentWebsiteOpportunities.length, 0);
  }

  const outcome = recordRevenueOutreachOutcome({
    draftId: draftResult.draft.id,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd: draftResult.draft.pricing.depositUsd,
    paymentConfirmation: "Stripe pi_deposit_ready_123",
    notes: "Deposit received by Robert outside the app.",
  });

  assert.equal(outcome.status, "recorded");
  assert.equal(outcome.lead?.status, "closed");
  assert.equal(outcome.draft?.delivery.outcome, "deposit_collected");
  assert.equal(outcome.draft?.delivery.outcomeCashCollectedUsd, draftResult.draft.pricing.depositUsd);
  assert.equal(outcome.websiteOpportunity?.depositPaid, true);
  assert.equal(outcome.websiteOpportunity?.scopeApproved, false);
  assert.equal(outcome.websiteOpportunity?.cashCollectedUsd, draftResult.draft.pricing.depositUsd);
  assert.equal(outcome.snapshot.metrics.cashCollectedUsd, 0);
  assert.equal(outcome.snapshot.recentLedger.length, 0);
  assert.equal(outcome.snapshot.websiteDeliveryHandoffQueue.readyCount, 0);
  assert.equal(outcome.snapshot.recentWebsiteOpportunities[0].depositPaid, true);
  assert.equal(outcome.snapshot.recentWebsiteOpportunities[0].paymentConfirmation, "Stripe pi_deposit_ready_123");
  assert.equal(outcome.snapshot.dailyMoneyCommand.status, "collect");
  assert.equal(outcome.snapshot.dailyMoneyCommand.funnel.websiteClosuresPending, 1);

  const opportunityResult = recordRevenueWebsiteOpportunity({
    leadId: leadResult.lead.id,
    outreachDraftId: draftResult.draft.id,
    projectType: "bundle",
  });

  const closeWithoutExplicitPaymentConfirmation = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity!.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: draftResult.draft.pricing.depositUsd,
    notes: "Deposit was already recorded in outreach outcome.",
  });
  assert.equal(closeWithoutExplicitPaymentConfirmation.status, "blocked");
  assert.match(closeWithoutExplicitPaymentConfirmation.reason, /referencia|confirmacion/);
  assert.equal(closeWithoutExplicitPaymentConfirmation.snapshot.recentLedger.length, 0);

  const closeWithWeakPaymentConfirmation = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity!.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: draftResult.draft.pricing.depositUsd,
    paymentConfirmation: "paid",
  });
  assert.equal(closeWithWeakPaymentConfirmation.status, "blocked");
  assert.match(closeWithWeakPaymentConfirmation.reason, /verificable/);
  assert.equal(closeWithWeakPaymentConfirmation.snapshot.metrics.cashCollectedUsd, 0);
  assert.equal(closeWithWeakPaymentConfirmation.snapshot.recentLedger.length, 0);
  assert.equal(closeWithWeakPaymentConfirmation.snapshot.websiteDeliveryHandoffQueue.readyCount, 0);

  const closeWithWeakNarrativePayment = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity!.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: draftResult.draft.pricing.depositUsd,
    paymentConfirmation: "Robert confirmed deposit.",
  });
  assert.equal(closeWithWeakNarrativePayment.status, "blocked");
  assert.match(closeWithWeakNarrativePayment.reason, /verificable/);
  assert.equal(closeWithWeakNarrativePayment.snapshot.metrics.cashCollectedUsd, 0);
  assert.equal(closeWithWeakNarrativePayment.snapshot.recentLedger.length, 0);

  const closeResult = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity!.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: draftResult.draft.pricing.depositUsd,
    paymentConfirmation: "Stripe pi_deposit_ready_123",
  });

  assert.equal(closeResult.status, "sold");
  assert.equal(closeResult.snapshot.metrics.cashCollectedUsd, opportunityResult.opportunity!.requiredDepositUsd);
  assert.equal(closeResult.snapshot.recentLedger.length, 1);
  assert.equal(closeResult.snapshot.websiteDeliveryHandoffQueue.readyCount, 1);
  assert.equal(closeResult.snapshot.websiteDeliveryHandoffQueue.items[0].leadId, leadResult.lead.id);
});

test("persists manual deposit payment confirmation across reload before website close", () => {
  const { lead, draft } = createApprovedWebsiteDraftForTest({
    businessName: "Reload Deposit Cafe",
    contactEmail: "owner@reloaddeposit.example",
    sourceUrl: "https://example.com/reload-deposit-cafe",
    mockupSlug: "reload-deposit-cafe",
  });
  const opportunityResult = recordRevenueWebsiteOpportunity({
    leadId: lead.id,
    outreachDraftId: draft.id,
    projectType: "website",
  });
  assert.equal(opportunityResult.status, "quoted");

  const depositOutcome = recordRevenueOutreachOutcome({
    draftId: draft.id,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd: opportunityResult.opportunity!.requiredDepositUsd,
    paymentConfirmation: "Zelle ref reload-deposit-123",
  });
  assert.equal(depositOutcome.status, "recorded");

  setRevenueLeadsPathForTests(testLeadsPath);
  setRevenueOutreachPathForTests(testOutreachPath);
  setRevenueWebsiteOpportunitiesPathForTests(testWebsiteOpportunitiesPath);

  const closeResult = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity!.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: opportunityResult.opportunity!.requiredDepositUsd,
    paymentConfirmation: "Zelle ref reload-deposit-123",
  });

  assert.equal(closeResult.status, "sold");
  assert.equal(closeResult.snapshot.websiteDeliveryHandoffQueue.readyCount, 1);
  assert.equal(closeResult.snapshot.recentLedger.length, 1);
});

test("website delivery blocks persisted weak payment evidence before workspace and ledger", () => {
  const { lead, draft } = createApprovedWebsiteDraftForTest({
    businessName: "Legacy Weak Paid Cafe",
    contactEmail: "owner@legacyweakpaid.example",
    sourceUrl: "https://example.com/legacy-weak-paid-cafe",
    mockupSlug: "legacy-weak-paid-cafe",
  });
  const opportunityResult = recordRevenueWebsiteOpportunity({
    leadId: lead.id,
    outreachDraftId: draft.id,
    projectType: "bundle",
  });
  assert.equal(opportunityResult.status, "quoted");

  const depositOutcome = recordRevenueOutreachOutcome({
    draftId: draft.id,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd: opportunityResult.opportunity!.requiredDepositUsd,
    paymentConfirmation: "Stripe pi_legacy_valid_123",
  });
  assert.equal(depositOutcome.status, "recorded");

  const opportunities = JSON.parse(readFileSync(testWebsiteOpportunitiesPath, "utf8")) as Array<{
    id: string;
    status: string;
    depositPaid: boolean;
    scopeApproved: boolean;
    cashCollectedUsd: number;
    paymentConfirmation: string;
  }>;
  const persistedOpportunity = opportunities.find((item) => item.id === opportunityResult.opportunity!.id);
  assert.ok(persistedOpportunity);
  persistedOpportunity.status = "sold";
  persistedOpportunity.depositPaid = true;
  persistedOpportunity.scopeApproved = true;
  persistedOpportunity.cashCollectedUsd = opportunityResult.opportunity!.requiredDepositUsd;
  persistedOpportunity.paymentConfirmation = "paid";
  writeFileSync(testWebsiteOpportunitiesPath, `${JSON.stringify(opportunities, null, 2)}\n`, "utf8");

  const drafts = JSON.parse(readFileSync(testOutreachPath, "utf8")) as Array<{
    id: string;
    delivery: {
      outcomePaymentConfirmation?: string;
    };
  }>;
  const persistedDraft = drafts.find((item) => item.id === draft.id);
  assert.ok(persistedDraft);
  persistedDraft.delivery.outcomePaymentConfirmation = "paid";
  writeFileSync(testOutreachPath, `${JSON.stringify(drafts, null, 2)}\n`, "utf8");

  setRevenueLeadsPathForTests(testLeadsPath);
  setRevenueOutreachPathForTests(testOutreachPath);
  setRevenueWebsiteOpportunitiesPathForTests(testWebsiteOpportunitiesPath);
  setRevenueLedgerPathForTests(testLedgerPath);

  const snapshot = getRevenueEngineSnapshot();
  assert.equal(snapshot.websiteDeliveryHandoffQueue.readyCount, 0);
  assert.equal(snapshot.websiteDeliveryHandoffQueue.blockedCount, 1);
  assert.match(snapshot.websiteDeliveryHandoffQueue.blocked[0].reason, /verificable/);

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.id,
    outreachDraftId: draft.id,
    websiteOpportunityId: opportunityResult.opportunity!.id,
    projectType: "bundle",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: opportunityResult.opportunity!.requiredDepositUsd,
    publicDataVerified: true,
    repoFullName: "robertmanzanilla/legacy-weak-paid-cafe",
  });

  assert.equal(handoff.status, "blocked");
  assert.match(handoff.reason, /verificable/);
  assert.equal(handoff.workspace, null);
  assert.equal(handoff.snapshot.recentLedger.length, 0);
});

test("runs main revenue agent with subagent reviews and approvals", () => {
  const result = recordRevenueAgentRun({
    businessName: "Black Room",
    area: "Miami",
    niche: "techno events",
    request: "Create a 3D website, event funnel, lead capture and automated follow-up for sponsors and merch buyers.",
    stage: "production",
    projectType: "bundle",
    estimatedOfferUsd: 6700,
    estimatedInternalCostUsd: 54,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 3350,
    approvalToContact: true,
    approvalToSpend: true,
    approvalToBuild: true,
  });

  assert.equal(result.run.status, "ready");
  assert.equal(result.run.budgetGate.insideCap, true);
  assert.equal(result.run.subagentReviews.some((review) => review.agent === "qa-council" && review.verdict === "pass"), true);
  assert.equal(result.run.workOrder.some((step) => step.ownerAgent === "automation-architect"), true);
  assert.equal(result.snapshot.recentAgentRuns[0].businessName, "Black Room");
});

test("blocks revenue agent run when cost cap is broken", () => {
  const result = recordRevenueAgentRun({
    businessName: "Risky Automation",
    area: "Miami",
    niche: "clinic",
    request: "Build a complex AI automation with many tools and no deposit yet.",
    stage: "production",
    projectType: "automation",
    estimatedOfferUsd: 2500,
    estimatedInternalCostUsd: 140,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 0,
    approvalToContact: false,
    approvalToSpend: false,
    approvalToBuild: false,
  });

  assert.equal(result.run.status, "blocked");
  assert.equal(result.run.requiredApprovals.includes("reducir costo mensual a menos de $100"), true);
  assert.equal(result.run.subagentReviews.some((review) => review.agent === "cost-controller" && review.verdict === "block"), true);
  assert.equal(result.snapshot.metrics.approvalQueue, 1);
});

test("revenue agent run rejects string false approval flags", () => {
  assert.throws(
    () => recordRevenueAgentRun({
      businessName: "String False Agent Cafe",
      area: "Miami",
      niche: "coffee shop",
      request: "Prepare a website mockup, proposal and outreach draft for a real public lead.",
      stage: "proposal",
      projectType: "website",
      estimatedOfferUsd: 3200,
      estimatedInternalCostUsd: 54,
      monthlyBudgetUsd: 100,
      cashCollectedUsd: 0,
      approvalToContact: "false",
      approvalToSpend: "false",
      approvalToBuild: "false",
    } as Parameters<typeof recordRevenueAgentRun>[0]),
    /Expected boolean/,
  );

  assert.equal(getRevenueEngineSnapshot().recentAgentRuns.length, 0);
});

test("main revenue agent asks questions when the client request is unclear", () => {
  const result = recordRevenueAgentRun({
    businessName: "Unclear Salon",
    area: "Miami",
    niche: "salon",
    request: "Make automation",
    stage: "proposal",
    projectType: "automation",
    estimatedOfferUsd: 2500,
    estimatedInternalCostUsd: 40,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 0,
    approvalToContact: true,
    approvalToSpend: true,
    approvalToBuild: false,
  });

  assert.equal(result.run.status, "approval_required");
  assert.equal(result.run.clarificationGate.status, "needs_clarification");
  assert.equal(result.run.requiredApprovals.includes("responder preguntas de aclaracion"), true);
  assert.equal(result.run.workOrder[0].ownerAgent, "growth-director");
  assert.equal(result.run.nextActions.some((action) => action.includes("preguntas de aclaracion")), true);
});

test("persists revenue agent runs across module state reloads", () => {
  recordRevenueAgentRun({
    businessName: "Persisted Agent Run",
    area: "Orlando",
    niche: "salon",
    request: "Prepare website mockup and booking follow-up automation.",
    stage: "mockup",
    projectType: "bundle",
    estimatedOfferUsd: 4200,
    estimatedInternalCostUsd: 44,
    monthlyBudgetUsd: 75,
    cashCollectedUsd: 0,
    approvalToContact: false,
    approvalToSpend: false,
    approvalToBuild: false,
  });

  setRevenueAgentRunsPathForTests(testAgentRunsPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentAgentRuns[0].businessName, "Persisted Agent Run");
  assert.equal(snapshot.recentAgentRuns[0].status, "approval_required");
});

test("records sellable automation opportunity with quote and QA gates", () => {
  const result = recordRevenueAutomationOpportunity({
    businessName: "Booked Solid Salon",
    industry: "salon",
    request: "Automate new lead intake from Instagram and forms, booking follow-up, missed-call text messages, owner notifications and weekly reporting dashboard.",
    currentTools: "Google Sheets, Gmail, Instagram DM",
    monthlyBudgetUsd: 750,
    urgency: "this_month",
    sourceLeadId: "",
    status: "intake",
    clientApprovedScope: false,
    depositPaid: false,
  });

  assert.equal(result.opportunity.status, "quoted");
  assert.equal(result.opportunity.quote.decision.status, "ready_to_pitch");
  assert.equal(result.opportunity.quote.pricing.insideCostCap, true);
  assert.equal(result.opportunity.qaGates.some((gate) => gate.gate === "cost" && gate.passed), true);
  assert.equal(result.snapshot.recentAutomationOpportunities[0].businessName, "Booked Solid Salon");
});

test("blocks automation opportunity when request is unclear", () => {
  const result = recordRevenueAutomationOpportunity({
    businessName: "Vague Client",
    industry: "services",
    request: "Automate stuff",
    currentTools: "",
    monthlyBudgetUsd: 100,
    urgency: "flexible",
    sourceLeadId: "",
    status: "intake",
    clientApprovedScope: false,
    depositPaid: false,
  });

  assert.equal(result.opportunity.status, "blocked");
  assert.equal(result.opportunity.quote.decision.status, "needs_clarification");
  assert.equal(result.opportunity.quote.clarificationGate.status, "needs_clarification");
  assert.equal(result.opportunity.qaGates.some((gate) => gate.gate === "clarity" && gate.passed === false), true);
  assert.equal(result.snapshot.metrics.approvalQueue, 1);
});

test("automation opportunity rejects string false sale gates", () => {
  assert.throws(
    () => recordRevenueAutomationOpportunity({
      businessName: "String False Automation",
      industry: "gym",
      request: "Automate new website lead intake into Google Sheets, notify the owner, send approved follow-up, and report booked trials weekly.",
      currentTools: "Google Sheets, Gmail",
      monthlyBudgetUsd: 700,
      urgency: "this_week",
      sourceLeadId: "",
      status: "sold",
      clientApprovedScope: "false",
      depositPaid: "false",
    } as Parameters<typeof recordRevenueAutomationOpportunity>[0]),
    /Expected boolean/,
  );

  assert.equal(getRevenueEngineSnapshot().recentAutomationOpportunities.length, 0);
});

test("asks clarifying questions before quoting vague automation requests", () => {
  const quote = buildAutomationQuote({
    businessName: "Vague Clinic",
    industry: "clinic",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 500,
    urgency: "this_month",
  });

  assert.equal(quote.decision.status, "needs_clarification");
  assert.equal(quote.clarificationGate.status, "needs_clarification");
  assert.equal(quote.clarificationGate.blocks.includes("build completo"), true);
  assert.equal(quote.clarifyingQuestions.length >= 3, true);
});

test("records automation intake and asks questions before quote is ready", () => {
  const result = recordRevenueAutomationIntake({
    businessName: "Vague Spa",
    industry: "spa",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 500,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "",
    source: "manual",
  });

  assert.equal(result.intake.status, "needs_answers");
  assert.equal(result.intake.nextQuestions.length >= 3, true);
  assert.equal(result.intake.answerTemplate.includes("Respuesta minima"), true);
  assert.equal(result.intake.blockedUntilAnswered.includes("build completo"), true);
  assert.equal(result.snapshot.recentAutomationIntakes[0].businessName, "Vague Spa");
});

test("answers automation intake and reruns clarification gate", () => {
  const created = recordRevenueAutomationIntake({
    businessName: "Answered Spa",
    industry: "spa",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 500,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "",
    source: "manual",
  });

  const answered = answerRevenueAutomationIntake({
    intakeId: created.intake.id,
    answers: "Trigger is a new website form lead. The system should save it to Google Sheets, notify the owner, and send an approved booking follow-up. Goal is more booked appointments.",
  });

  assert.equal(answered.status, "updated");
  assert.equal(answered.intake?.status, "ready_for_quote");
  assert.equal(answered.intake?.nextQuestions.length, 0);
  assert.equal(answered.intake?.blockedUntilAnswered.length, 0);
  assert.equal(answered.intake?.answerTemplate.includes("Respuesta minima"), true);
  assert.equal(answered.snapshot.recentAutomationIntakes[0].status, "ready_for_quote");
});

test("automation agent command asks questions instead of creating vague opportunities", () => {
  const result = runRevenueAutomationAgentCommand({
    businessName: "Vague Command Spa",
    industry: "spa",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 500,
    urgency: "this_month",
    contactName: "",
    contactEmail: "",
    knownAnswers: "",
    source: "manual",
    createOpportunityIfClear: true,
  });

  assert.equal(result.status, "needs_answers");
  assert.equal(result.opportunity, null);
  assert.equal(result.intake.status, "needs_answers");
  assert.equal(result.blockedUntilAnswered.includes("build completo"), true);
  assert.equal(result.snapshot.recentAutomationOpportunities.length, 0);
});

test("automation agent command creates quoted opportunity when request is clear", () => {
  const result = runRevenueAutomationAgentCommand({
    businessName: "Clear Command Gym",
    industry: "gym",
    request: "Automate new website trial signup into Google Sheets, notify the owner, send an approved trial follow-up email, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 800,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "Trigger is new website trial signup. Data goes to Google Sheets. Goal is booked trials. Follow-up is approved email only.",
    source: "manual",
    createOpportunityIfClear: true,
  });

  assert.equal(result.status, "opportunity_created");
  assert.equal(result.opportunity?.businessName, "Clear Command Gym");
  assert.equal(result.opportunity?.status, "quoted");
  assert.equal(result.snapshot.recentAutomationOpportunities[0].businessName, "Clear Command Gym");
  assert.equal(result.snapshot.recentAutomationIntakes[0].nextAction.includes("Agente creo oportunidad"), true);
});

test("automation agent command blocks sale lifecycle without scope and deposit", () => {
  const result = runRevenueAutomationAgentCommand({
    businessName: "Lifecycle Blocked Spa",
    industry: "spa",
    request: "Automate website booking requests into Google Sheets, notify the owner, send approved appointment follow-up, and report booked appointments weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 800,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "Trigger is website booking request. Data goes to Google Sheets. Goal is booked appointments. Follow-up is approved email only.",
    source: "manual",
    lifecycleTarget: "sale",
    clientApprovedScope: false,
    depositPaid: false,
  });

  assert.equal(result.status, "sale_blocked");
  assert.equal(result.closeResult, null);
  assert.equal(result.workspaceResult, null);
  assert.equal(result.reason.includes("falta aprobacion escrita"), true);
  assert.equal(result.reason.includes("falta deposito"), true);
  assert.equal(result.snapshot.metrics.automationsSold, 0);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 0);
});

test("automation agent command records sale and creates delivery workspace when lifecycle gates pass", () => {
  const commandInput = {
    businessName: "Lifecycle Gym",
    industry: "gym",
    request: "Automate new website trial signup into Google Sheets, notify the owner, send an approved trial follow-up email, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "Trigger is new website trial signup. Data goes to Google Sheets. Goal is booked trials. Follow-up is approved email only.",
    source: "manual",
    lifecycleTarget: "delivery",
    clientApprovedScope: true,
    depositPaid: true,
    cashCollectedUsd: 2500,
    paymentConfirmation: "Stripe pi_lifecycle_2500",
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    launchTargetDays: 7,
  } as const;
  const result = runRevenueAutomationAgentCommand(commandInput);

  assert.equal(result.status, "delivery_workspace_created");
  assert.equal(result.closeResult?.status, "recorded");
  assert.equal(result.closeResult?.entry?.kind, "automation_sale");
  assert.equal(result.workspaceResult?.status, "created");
  assert.equal(result.workspaceResult?.workspace?.input.clientName, "Lifecycle Gym");
  assert.equal(result.workspaceResult?.workspace?.status, "blocked");
  assert.equal(result.workspaceResult?.workspace?.correctionQueue.some((item) => item.agent === "automation-qa"), true);
  assert.equal(result.snapshot.metrics.automationsSold, 1);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 2500);

  const retry = runRevenueAutomationAgentCommand(commandInput);
  assert.equal(retry.status, "already_recorded");
  assert.equal(retry.closeResult?.status, "already_recorded");
  assert.equal(retry.snapshot.metrics.automationsSold, 1);
  assert.equal(retry.snapshot.metrics.cashCollectedUsd, 2500);
  assert.equal(retry.snapshot.recentLedger.filter((entry) => entry.kind === "automation_sale").length, 1);
});

test("automation agent command blocks sale lifecycle without payment evidence", () => {
  const result = runRevenueAutomationAgentCommand({
    businessName: "Lifecycle Weak Payment Spa",
    industry: "spa",
    request: "Automate website booking requests into Google Sheets, notify the owner, send approved appointment follow-up, and report booked appointments weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 800,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "Trigger is website booking request. Data goes to Google Sheets. Goal is booked appointments. Follow-up is approved email only.",
    source: "manual",
    lifecycleTarget: "delivery",
    clientApprovedScope: true,
    depositPaid: true,
    cashCollectedUsd: 2500,
    paymentConfirmation: "paid",
    createDeliveryWorkspaceIfSold: true,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  assert.equal(result.status, "sale_blocked");
  assert.equal(result.closeResult, null);
  assert.equal(result.workspaceResult, null);
  assert.equal(result.reason.includes("comprobante"), true);
  assert.equal(result.snapshot.metrics.automationsSold, 0);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 0);
  assert.equal(result.snapshot.recentDeliveryWorkspaces.length, 0);
});

test("blocks automation intake conversion until clarification is complete", () => {
  const created = recordRevenueAutomationIntake({
    businessName: "Blocked Intake Cafe",
    industry: "coffee",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 350,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "",
    source: "manual",
  });

  const converted = convertRevenueAutomationIntakeToOpportunity({
    intakeId: created.intake.id,
    status: "intake",
    clientApprovedScope: false,
    depositPaid: false,
  });

  assert.equal(converted.status, "blocked");
  assert.equal(converted.opportunity, null);
  assert.equal(converted.snapshot.recentAutomationOpportunities.length, 0);
});

test("converts ready automation intake into a tracked opportunity", () => {
  const created = recordRevenueAutomationIntake({
    businessName: "Ready Intake Gym",
    industry: "gym",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 700,
    urgency: "this_month",
    contactName: "Manager",
    contactEmail: "",
    knownAnswers: "",
    source: "call",
  });

  answerRevenueAutomationIntake({
    intakeId: created.intake.id,
    answers: "Trigger is a new trial signup form. Action is saving to Google Sheets, texting the owner, emailing an approved trial class follow-up, and reporting booked trials weekly.",
  });

  const converted = convertRevenueAutomationIntakeToOpportunity({
    intakeId: created.intake.id,
    status: "intake",
    clientApprovedScope: false,
    depositPaid: false,
  });

  assert.equal(converted.status, "converted");
  assert.equal(converted.opportunity?.businessName, "Ready Intake Gym");
  assert.equal(converted.opportunity?.quote.decision.status, "ready_to_pitch");
  assert.equal(converted.snapshot.recentAutomationOpportunities[0].businessName, "Ready Intake Gym");
  assert.equal(converted.snapshot.recentAutomationIntakes[0].nextAction.includes("Oportunidad creada"), true);
});

test("persists automation intakes across module state reloads", () => {
  recordRevenueAutomationIntake({
    businessName: "Answered Gym",
    industry: "gym",
    request: "Automate new lead intake from website form into Google Sheets, notify owner, and send approved follow-up for booking trial classes.",
    currentTools: "Google Sheets, website form, Gmail",
    monthlyBudgetUsd: 600,
    urgency: "this_month",
    contactName: "Manager",
    contactEmail: "manager@example.com",
    knownAnswers: "Trigger is a website lead form. Action is owner notification and approved follow-up. Goal is more booked trial classes.",
    source: "call",
  });

  setRevenueAutomationIntakesPathForTests(testAutomationIntakesPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentAutomationIntakes[0].businessName, "Answered Gym");
  assert.equal(snapshot.recentAutomationIntakes[0].status, "ready_for_quote");
});

test("persists automation opportunities across module state reloads", () => {
  recordRevenueAutomationOpportunity({
    businessName: "Persisted Automation",
    industry: "restaurant",
    request: "Automate catering lead intake from forms and Instagram, email follow-up, reminders, invoice handoff, owner alerts and weekly reporting.",
    currentTools: "Google Sheets, email",
    monthlyBudgetUsd: 650,
    urgency: "this_month",
    sourceLeadId: "",
    status: "approved",
    clientApprovedScope: true,
    depositPaid: false,
  });

  setRevenueAutomationOpportunitiesPathForTests(testAutomationOpportunitiesPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentAutomationOpportunities[0].businessName, "Persisted Automation");
  assert.equal(snapshot.recentAutomationOpportunities[0].status, "approved");
});

test("closes automation opportunity into ledger and updates money metrics", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Ledger Automation Gym",
    industry: "gym",
    request: "Automate trial signup form into Google Sheets, notify owner, send approved follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "quoted",
    clientApprovedScope: false,
    depositPaid: false,
  });

  const result = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    paymentConfirmation: "Stripe pi_automation_2500",
    markScopeApproved: true,
    notes: "Deposit paid by client.",
  });

  assert.equal(result.status, "recorded");
  assert.equal(result.opportunity?.status, "sold");
  assert.equal(result.opportunity?.depositPaid, true);
  assert.equal(result.opportunity?.paymentConfirmation, "Stripe pi_automation_2500");
  assert.equal(result.entry?.kind, "automation_sale");
  assert.equal(result.entry?.notes.includes("Stripe pi_automation_2500"), true);
  assert.equal(result.entry?.cashCollectedUsd, opportunity.opportunity.quote.pricing.requiredDepositUsd);
  assert.equal(result.snapshot.metrics.automationsSold, 1);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, opportunity.opportunity.quote.pricing.requiredDepositUsd);
  assert.equal(result.snapshot.profitGuard.status, "scale_carefully");
});

test("blocks automation opportunity close without verifiable payment evidence", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Weak Evidence Automation",
    industry: "gym",
    request: "Automate trial signup form into Google Sheets, notify owner, send approved follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "quoted",
    clientApprovedScope: false,
    depositPaid: false,
  });

  const missingEvidence = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    markScopeApproved: true,
  });
  const weakNarrativeEvidence = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    paymentConfirmation: "Robert confirmed the client paid.",
    markScopeApproved: true,
  });

  assert.equal(missingEvidence.status, "blocked");
  assert.equal(missingEvidence.reason.includes("comprobante"), true);
  assert.equal(weakNarrativeEvidence.status, "blocked");
  assert.equal(weakNarrativeEvidence.reason.includes("comprobante"), true);
  assert.equal(weakNarrativeEvidence.entry, null);
  assert.equal(weakNarrativeEvidence.opportunity?.status, "quoted");
  assert.equal(weakNarrativeEvidence.opportunity?.depositPaid, false);
  assert.equal(weakNarrativeEvidence.snapshot.metrics.automationsSold, 0);
  assert.equal(weakNarrativeEvidence.snapshot.metrics.cashCollectedUsd, 0);
});

test("blocks automation opportunity close without explicit scope approval", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Scope Approval Automation",
    industry: "gym",
    request: "Automate trial signup form into Google Sheets, notify owner, send approved follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "quoted",
    clientApprovedScope: false,
    depositPaid: false,
  });

  const result = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    paymentConfirmation: "Stripe pi_scope_2500",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason.includes("scope"), true);
  assert.equal(result.entry, null);
  assert.equal(result.opportunity?.status, "quoted");
  assert.equal(result.opportunity?.depositPaid, false);
  assert.equal(result.snapshot.metrics.automationsSold, 0);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 0);
});

test("closes automation opportunity with existing scope approval and omitted approval flag", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Existing Scope Automation",
    industry: "gym",
    request: "Automate trial signup form into Google Sheets, notify owner, send approved follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "quoted",
    clientApprovedScope: true,
    depositPaid: false,
  });

  const result = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    paymentConfirmation: "Stripe pi_existing_scope_2500",
  });

  assert.equal(result.status, "recorded");
  assert.equal(result.opportunity?.status, "sold");
  assert.equal(result.opportunity?.clientApprovedScope, true);
  assert.equal(result.entry?.kind, "automation_sale");
  assert.equal(result.snapshot.metrics.automationsSold, 1);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, opportunity.opportunity.quote.pricing.requiredDepositUsd);
});

test("blocks automation opportunity close when deposit is incomplete", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Partial Deposit Automation",
    industry: "gym",
    request: "Automate trial signup form into Google Sheets, text the owner, send approved class follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "quoted",
    clientApprovedScope: false,
    depositPaid: false,
  });

  const partialDeposit = Math.max(1, opportunity.opportunity.quote.pricing.requiredDepositUsd - 100);
  const result = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: partialDeposit,
    markScopeApproved: true,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.entry, null);
  assert.equal(result.opportunity?.status, "quoted");
  assert.equal(result.opportunity?.depositPaid, false);
  assert.equal(result.reason.includes("deposito incompleto"), true);
  assert.equal(result.snapshot.metrics.automationsSold, 0);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 0);
});

test("does not double count automation opportunity already recorded in ledger", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Duplicate Ledger Automation",
    industry: "gym",
    request: "Automate new trial signup form into Google Sheets, text the owner, send approved class follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "sold",
    clientApprovedScope: true,
    depositPaid: true,
  });

  const first = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    paymentConfirmation: "Zelle ref duplicate-ledger-2500",
    markScopeApproved: true,
  });
  const second = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    paymentConfirmation: "Zelle ref duplicate-ledger-2500",
    markScopeApproved: true,
  });

  assert.equal(first.status, "recorded");
  assert.equal(second.status, "already_recorded");
  assert.equal(second.snapshot.metrics.automationsSold, 1);
});

test("automation close blocks unverified ledger token to avoid double counting", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Repair Ledger Automation",
    industry: "clinic",
    request: "Automate consultation forms into Google Sheets, notify staff, send approved booking follow-up, and report booked consultations weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "sold",
    clientApprovedScope: true,
    depositPaid: true,
    paymentConfirmation: "Stripe pi_repair_auto_2500",
  });
  const requiredDepositUsd = opportunity.opportunity.quote.pricing.requiredDepositUsd;
  const invalidLedger = recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Repair Ledger Automation",
    amountUsd: opportunity.opportunity.quote.pricing.setupPriceUsd,
    cashCollectedUsd: Math.max(1, requiredDepositUsd - 100),
    estimatedInternalCostUsd: opportunity.opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    notes: `Automation opportunity:${opportunity.opportunity.id} | Payment confirmation:${opportunity.opportunity.paymentConfirmation}`,
  });
  assert.ok(invalidLedger.entry);

  const blockedClose = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: requiredDepositUsd,
    paymentConfirmation: opportunity.opportunity.paymentConfirmation,
    markScopeApproved: true,
  });

  assert.equal(blockedClose.status, "blocked");
  assert.equal(blockedClose.entry, null);
  assert.match(blockedClose.reason, /limpiar ledger/);
  assert.equal(blockedClose.snapshot.metrics.automationsSold, 1);
  assert.equal(blockedClose.snapshot.metrics.cashCollectedUsd, invalidLedger.entry?.cashCollectedUsd);

  const delivery = createDeliveryWorkspaceFromAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    launchTargetDays: 7,
  });

  assert.equal(delivery.status, "blocked");
  assert.equal(delivery.workspace, null);
});

test("blocks delivery workspace creation from automation opportunity before deposit and scope", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "No Deposit Automation",
    industry: "clinic",
    request: "Automate website lead intake into Google Sheets, notify staff, send approved booking follow-up, and report booked consultations weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 800,
    urgency: "this_month",
    sourceLeadId: "",
    status: "quoted",
    clientApprovedScope: false,
    depositPaid: false,
  });

  const result = createDeliveryWorkspaceFromAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    publicDataVerified: true,
    visualQaPassed: false,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    launchTargetDays: 7,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.workspace, null);
  assert.equal(result.reason.includes("falta aprobacion escrita de scope"), true);
  assert.equal(result.reason.includes("falta deposito pagado"), true);
});

test("creates delivery workspace from sold automation opportunity with QA corrections", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Sold Automation Gym",
    industry: "gym",
    request: "Automate new trial signup form into Google Sheets, text the owner, send approved class follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, email",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "sold",
    clientApprovedScope: true,
    depositPaid: true,
  });
  const closeResult = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    paymentConfirmation: "Stripe pi_sold_delivery_2500",
    markScopeApproved: true,
  });
  assert.equal(closeResult.status, "recorded");

  const result = createDeliveryWorkspaceFromAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    launchTargetDays: 7,
  });

  assert.equal(result.status, "created");
  assert.equal(result.workspace?.input.sourceOpportunityId, opportunity.opportunity.id);
  assert.equal(result.workspace?.input.clientName, "Sold Automation Gym");
  assert.equal(result.workspace?.status, "blocked");
  assert.equal(result.workspace?.correctionQueue.some((item) => item.agent === "automation-qa"), true);
  assert.equal(result.opportunity?.status, "in_delivery");
  assert.equal(result.snapshot.recentDeliveryWorkspaces[0].input.sourceOpportunityId, opportunity.opportunity.id);
});

test("blocks automation delivery workspace when sold state was not ledger-recorded", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Direct Sold Automation",
    industry: "clinic",
    request: "Automate website consultation forms into Google Sheets, notify staff, send approved booking follow-up, and report booked consultations weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "sold",
    clientApprovedScope: true,
    depositPaid: true,
    paymentConfirmation: "Stripe pi_direct_sold_2500",
  });

  const result = createDeliveryWorkspaceFromAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    launchTargetDays: 7,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.workspace, null);
  assert.match(result.reason, /ledger/);
  assert.equal(result.snapshot.recentDeliveryWorkspaces.length, 0);
});

test("blocks automation delivery workspace when ledger token is not a verified paid sale", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Spoofed Ledger Automation",
    industry: "clinic",
    request: "Automate consultation forms into Google Sheets, notify staff, send approved booking follow-up, and report booked consultations weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "sold",
    clientApprovedScope: true,
    depositPaid: true,
    paymentConfirmation: "Stripe pi_verified_auto_2500",
  });
  const requiredDepositUsd = opportunity.opportunity.quote.pricing.requiredDepositUsd;
  const attemptDelivery = () => createDeliveryWorkspaceFromAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    launchTargetDays: 7,
  });

  const wrongKind = recordRevenueLedgerEntry({
    kind: "website_sale",
    clientName: "Spoofed Ledger Automation",
    amountUsd: opportunity.opportunity.quote.pricing.setupPriceUsd,
    cashCollectedUsd: requiredDepositUsd,
    estimatedInternalCostUsd: opportunity.opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    notes: `Automation opportunity:${opportunity.opportunity.id} | Payment confirmation:${opportunity.opportunity.paymentConfirmation}`,
  });
  assert.ok(wrongKind.entry);
  assert.equal(attemptDelivery().status, "blocked");

  const insufficientCash = recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Spoofed Ledger Automation",
    amountUsd: opportunity.opportunity.quote.pricing.setupPriceUsd,
    cashCollectedUsd: Math.max(1, requiredDepositUsd - 100),
    estimatedInternalCostUsd: opportunity.opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    notes: `Automation opportunity:${opportunity.opportunity.id} | Payment confirmation:${opportunity.opportunity.paymentConfirmation}`,
  });
  assert.ok(insufficientCash.entry);
  assert.equal(attemptDelivery().status, "blocked");

  const mismatchedPayment = recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Spoofed Ledger Automation",
    amountUsd: opportunity.opportunity.quote.pricing.setupPriceUsd,
    cashCollectedUsd: requiredDepositUsd,
    estimatedInternalCostUsd: opportunity.opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    notes: `Automation opportunity:${opportunity.opportunity.id} | Payment confirmation:Stripe pi_other_auto_2500`,
  });
  assert.ok(mismatchedPayment.entry);
  const blocked = attemptDelivery();
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.workspace, null);
  assert.match(blocked.reason, /cash y referencia verificable/);
  assert.equal(blocked.snapshot.recentDeliveryWorkspaces.length, 0);
});

test("blocks automation close and delivery when mixed ledger rows include a dirty token", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Mixed Ledger Automation",
    industry: "clinic",
    request: "Automate consultation forms into Google Sheets, notify staff, send approved booking follow-up, and report booked consultations weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "sold",
    clientApprovedScope: true,
    depositPaid: true,
    paymentConfirmation: "Stripe pi_mixed_auto_2500",
  });
  const requiredDepositUsd = opportunity.opportunity.quote.pricing.requiredDepositUsd;
  const token = `Automation opportunity:${opportunity.opportunity.id}`;
  const dirtyRow = recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Mixed Ledger Automation",
    amountUsd: opportunity.opportunity.quote.pricing.setupPriceUsd,
    cashCollectedUsd: Math.max(1, requiredDepositUsd - 100),
    estimatedInternalCostUsd: opportunity.opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    notes: `${token} | Payment confirmation:${opportunity.opportunity.paymentConfirmation}`,
  });
  const validRow = recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Mixed Ledger Automation",
    amountUsd: opportunity.opportunity.quote.pricing.setupPriceUsd,
    cashCollectedUsd: requiredDepositUsd,
    estimatedInternalCostUsd: opportunity.opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    notes: `${token} | Payment confirmation:${opportunity.opportunity.paymentConfirmation}`,
  });
  assert.ok(dirtyRow.entry);
  assert.ok(validRow.entry);

  const close = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: requiredDepositUsd,
    paymentConfirmation: opportunity.opportunity.paymentConfirmation,
    markScopeApproved: true,
  });
  assert.equal(close.status, "blocked");
  assert.equal(close.entry, null);

  const delivery = createDeliveryWorkspaceFromAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    launchTargetDays: 7,
  });
  assert.equal(delivery.status, "blocked");
  assert.equal(delivery.workspace, null);
  assert.match(delivery.reason, /cash y referencia verificable/);
});

test("blocks production plan when deposit or cost cap fails", () => {
  const plan = buildRevenueProjectPlan({
    clientName: "Risky Client",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 2500,
    monthlyRetainerUsd: 200,
    estimatedInternalCostUsd: 140,
    depositPaid: false,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Complex AI automation",
  });

  assert.equal(plan.decision.status, "blocked");
  assert.equal(plan.decision.missing.includes("deposito pagado"), true);
  assert.equal(plan.decision.missing.includes("costo interno bajo $100/mes"), true);
  assert.equal(plan.deliveryGates.some((gate) => gate.gate === "cost" && gate.passed === false), true);
});

test("project plan rejects string false readiness gates", () => {
  assert.throws(
    () => buildRevenueProjectPlan({
      clientName: "String False Plan",
      projectType: "bundle",
      packageName: "Website 3D Premium + Automation Sprint",
      setupUsd: 5000,
      monthlyRetainerUsd: 750,
      estimatedInternalCostUsd: 54,
      depositPaid: "false",
      scopeApproved: "false",
      publicDataVerified: "false",
      includesAutomation: "false",
      launchTargetDays: 7,
      clientRequest: "Website plus booking follow-up automation.",
    } as Parameters<typeof buildRevenueProjectPlan>[0]),
    /Expected boolean/,
  );
});

test("delivery review rejects string false QA gates", () => {
  assert.throws(
    () => buildDeliveryReview({
      projectName: "String False Review",
      projectType: "bundle",
      setupPriceUsd: 5000,
      monthlyRetainerUsd: 750,
      estimatedInternalMonthlyCostUsd: 54,
      clientApprovedScope: "false",
      depositPaid: "false",
      publicDataVerified: "false",
      responsiveChecked: "false",
      linksChecked: "false",
      automationTested: "false",
      rollbackPlanReady: "false",
    } as Parameters<typeof buildDeliveryReview>[0]),
    /Expected boolean/,
  );
});

test("creates delivery workspace with subagent corrections before client handoff", () => {
  const result = recordRevenueDeliveryWorkspace({
    workspaceName: "Booked Solid delivery",
    sourceOpportunityId: "opp_1",
    clientName: "Booked Solid Salon",
    projectType: "bundle",
    packageName: "Website 3D Premium + Automation Sprint",
    setupUsd: 5000,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: false,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Website plus booking follow-up automation.",
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
  });

  assert.equal(result.workspace.status, "blocked");
  assert.equal(result.workspace.correctionQueue.some((item) => item.agent === "automation-qa" && item.blocksDelivery), true);
  assert.equal(result.workspace.approvalSummary.canLaunch, false);
  assert.equal(result.workspace.runbook.some((step) => step.ownerAgent === "qa-council"), true);
  assert.equal(result.snapshot.recentDeliveryWorkspaces[0].input.clientName, "Booked Solid Salon");
  assert.equal(result.snapshot.approvalQueueItems.some((item) => item.source === "delivery_workspace"), true);
});

test("delivery workspace rejects string false readiness gates", () => {
  assert.throws(
    () => recordRevenueDeliveryWorkspace({
      workspaceName: "String False delivery",
      sourceOpportunityId: "opp_string_false",
      clientName: "String False Client",
      projectType: "bundle",
      packageName: "Website 3D Premium + Automation Sprint",
      setupUsd: 5000,
      monthlyRetainerUsd: 750,
      estimatedInternalCostUsd: 54,
      depositPaid: "false",
      scopeApproved: "false",
      publicDataVerified: "false",
      includesAutomation: "false",
      launchTargetDays: 7,
      clientRequest: "Website plus booking follow-up automation.",
      visualQaPassed: "false",
      technicalQaPassed: "false",
      automationQaPassed: "false",
      clientHandoffReady: "false",
    } as Parameters<typeof recordRevenueDeliveryWorkspace>[0]),
    /Expected boolean/,
  );

  assert.equal(getRevenueEngineSnapshot().recentDeliveryWorkspaces.length, 0);
});

test("revalidates delivery workspace after subagents resolve QA corrections", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "QA blocked delivery",
    sourceOpportunityId: "opp_qa",
    clientName: "QA Gym",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 3200,
    monthlyRetainerUsd: 650,
    estimatedInternalCostUsd: 45,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate lead intake, owner alert, approved follow-up and weekly reporting.",
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
  });

  assert.equal(created.workspace.status, "blocked");

  const updated = updateRevenueDeliveryWorkspaceQa({
    workspaceId: created.workspace.id,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
    notes: "Technical QA, automation QA, rollback and handoff completed.",
  });

  assert.equal(updated.status, "ready");
  assert.equal(updated.workspace?.status, "ready_to_deliver");
  assert.equal(updated.workspace?.correctionQueue.length, 0);
  assert.equal(updated.workspace?.approvalSummary.canLaunch, true);
  assert.equal(updated.snapshot.recentDeliveryWorkspaces[0].status, "ready_to_deliver");
});

test("blocks delivery handoff when workspace still has QA corrections", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Blocked handoff",
    sourceOpportunityId: "",
    clientName: "Blocked Client",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 3200,
    monthlyRetainerUsd: 650,
    estimatedInternalCostUsd: 45,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate lead intake and approved follow-up.",
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
  });

  const delivered = deliverRevenueDeliveryWorkspace({
    workspaceId: created.workspace.id,
    approvedByRobert: true,
  }, {
    allowRobertApprovalEvidence: true,
  });

  assert.equal(delivered.status, "blocked");
  assert.equal(delivered.handoff, null);
  assert.equal(delivered.reason.includes("workspace no esta listo"), true);
});

test("delivers ready workspace and marks linked automation opportunity delivered", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Delivered Automation Gym",
    industry: "gym",
    request: "Automate new trial signup form into Google Sheets, text the owner, send approved class follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "sold",
    clientApprovedScope: true,
    depositPaid: true,
  });
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Delivered workspace",
    sourceOpportunityId: opportunity.opportunity.id,
    clientName: "Delivered Automation Gym",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: opportunity.opportunity.quote.pricing.setupPriceUsd,
    monthlyRetainerUsd: opportunity.opportunity.quote.pricing.monthlyRetainerUsd,
    estimatedInternalCostUsd: opportunity.opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: opportunity.opportunity.request,
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  const delivered = deliverRevenueDeliveryWorkspace({
    workspaceId: created.workspace.id,
    approvedByRobert: true,
    notes: "Client handoff complete.",
  }, {
    allowRobertApprovalEvidence: true,
  });

  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.handoff?.clientName, "Delivered Automation Gym");
  assert.equal(delivered.opportunity?.status, "delivered");
  assert.equal(delivered.workspace?.learningNote.includes("entregado con QA aprobado"), true);
  assert.equal(delivered.snapshot.recentAutomationOpportunities[0].status, "delivered");
});

test("blocks ready delivery when approval is only client-asserted", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Client asserted delivery",
    clientName: "Client Asserted Gym",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 3200,
    monthlyRetainerUsd: 650,
    estimatedInternalCostUsd: 45,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate lead intake and owner follow-up.",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  const delivered = deliverRevenueDeliveryWorkspace({
    workspaceId: created.workspace.id,
    approvedByRobert: true,
  });

  assert.equal(delivered.status, "blocked");
  assert.match(delivered.reason, /gate confiable/);
  assert.equal(delivered.workspace?.learningNote.includes("entregado con QA aprobado"), false);
});

test("blocks delivery improvement review until workspace is ready", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Blocked review workspace",
    sourceOpportunityId: "",
    clientName: "Blocked Review Client",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 2500,
    monthlyRetainerUsd: 500,
    estimatedInternalCostUsd: 35,
    depositPaid: false,
    scopeApproved: false,
    publicDataVerified: false,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate intake and weekly reporting.",
    visualQaPassed: false,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
  });

  const result = recordRevenueDeliveryWorkspaceImprovementReview({
    workspaceId: created.workspace.id,
    periodLabel: "post-delivery week 1",
    notes: "Should not record before QA.",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.review, null);
  assert.equal(result.reason.includes("workspace no esta listo"), true);
  assert.equal(result.snapshot.recentImprovementReviews.length, 0);
});

test("records delivery improvement review as playbook memory for next batch", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Learning delivery workspace",
    sourceOpportunityId: "",
    clientName: "Learning Delivery Client",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 3000,
    monthlyRetainerUsd: 650,
    estimatedInternalCostUsd: 45,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate new lead capture, owner notification and weekly report.",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  const result = recordRevenueDeliveryWorkspaceImprovementReview({
    workspaceId: created.workspace.id,
    periodLabel: "post-delivery week 1",
    leadsContacted: 0,
    replies: 0,
    callsBooked: 0,
    dealsClosed: 1,
    hoursSaved: 3,
    defectsFound: 0,
    clientComplaints: 0,
    notes: "Delivery worked and can inform the next automation batch.",
  });

  assert.equal(result.status, "recorded");
  assert.equal(result.review?.input.campaignName, "Learning Delivery Client");
  assert.equal(result.review?.input.bestOffer, "Automation Sprint");
  assert.equal(result.review?.metrics.insideSpendCap, true);
  assert.equal(result.snapshot.recentImprovementReviews[0].input.campaignName, "Learning Delivery Client");
  assert.equal(result.snapshot.recentDeliveryWorkspaces[0].learningNote.includes(result.review?.id || ""), true);
  assert.equal(result.snapshot.nextBatchPlan.latestReviewId, result.review?.id);
});

test("persists ready delivery workspaces across module state reloads", () => {
  recordRevenueDeliveryWorkspace({
    workspaceName: "Ready delivery",
    sourceOpportunityId: "",
    clientName: "Ready Client",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 2500,
    monthlyRetainerUsd: 500,
    estimatedInternalCostUsd: 35,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate lead intake from forms, notify owner, save to Google Sheets and send approved follow-up.",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  setRevenueDeliveryWorkspacesPathForTests(testDeliveryWorkspacesPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentDeliveryWorkspaces[0].input.clientName, "Ready Client");
  assert.equal(snapshot.recentDeliveryWorkspaces[0].status, "ready_to_deliver");
  assert.equal(snapshot.recentDeliveryWorkspaces[0].approvalSummary.canLaunch, true);
});

test("legacy website delivery workspaces reload into PR-first blocked state", () => {
  const legacyWorkspace = {
    id: "legacy-website-workspace",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    input: {
      workspaceName: "Legacy website delivery",
      sourceOpportunityId: "",
      sourceLeadId: "lead-legacy",
      sourceOutreachDraftId: "outreach-legacy",
      mockupUrl: "/api/revenue-engine/mockup-previews/legacy-cafe",
      repoFullName: "",
      branchName: "",
      githubIssueUrl: "",
      prUrl: "",
      secondReviewStatus: "pending",
      appQaStatus: "pending",
      deploymentApprovalStatus: "not_requested",
      deploymentApprovalUrl: "",
      clientName: "Legacy Cafe",
      projectType: "bundle",
      packageName: "Website 3D Premium + Automation Sprint",
      setupUsd: 4200,
      monthlyRetainerUsd: 750,
      estimatedInternalCostUsd: 54,
      depositPaid: true,
      scopeApproved: true,
      publicDataVerified: true,
      includesAutomation: true,
      launchTargetDays: 7,
      clientRequest: "Legacy persisted workspace before PR-first handoff gate.",
      visualQaPassed: true,
      technicalQaPassed: true,
      automationQaPassed: true,
      clientHandoffReady: true,
    },
    status: "ready_to_deliver",
    projectPlan: {},
    deliveryReview: {},
    correctionQueue: [],
    runbook: [],
    approvalSummary: {
      canShowClientPreview: true,
      canLaunch: true,
      requiredBeforeClient: [],
    },
    learningNote: "Legacy workspace incorrectly looked ready.",
  };
  writeFileSync(testDeliveryWorkspacesPath, JSON.stringify([legacyWorkspace], null, 2));
  setRevenueDeliveryWorkspacesPathForTests(testDeliveryWorkspacesPath);

  const snapshot = getRevenueEngineSnapshot();
  const workspace = snapshot.recentDeliveryWorkspaces[0];

  assert.equal(workspace.status, "needs_corrections");
  assert.equal(workspace.approvalSummary.canLaunch, false);
  assert.equal(workspace.codexBuildHandoff.status, "needs_pr");
  assert.equal(workspace.approvalSummary.requiredBeforeClient.includes("pull request de build"), true);

  const delivered = deliverRevenueDeliveryWorkspace({
    workspaceId: "legacy-website-workspace",
    approvedByRobert: true,
  }, {
    allowRobertApprovalEvidence: true,
  });

  assert.equal(delivered.status, "blocked");
  assert.match(delivered.reason, /pull request de build/);
});

test("website build handoff request omits invalid optional repo and branch fields", () => {
  const { lead, draft } = createApprovedWebsiteDraftForTest({
    businessName: "Missing Repo Cafe",
    contactEmail: "owner@missing-repo.test",
    sourceUrl: "https://example.com/missing-repo-cafe",
    mockupSlug: "missing-repo-cafe",
  });
  const opportunity = sellWebsiteOpportunityForTest({
    leadId: lead.id,
    outreachDraftId: draft.id,
    projectType: "bundle",
    cashCollectedUsd: 2100,
  });
  const workspaceResult = recordRevenueDeliveryWorkspace({
    workspaceName: "Missing Repo Cafe website delivery",
    sourceOpportunityId: opportunity.id,
    sourceLeadId: lead.id,
    sourceOutreachDraftId: draft.id,
    mockupUrl: "/api/revenue-engine/mockup-previews/missing-repo-cafe",
    sourceUrl: "https://example.com/missing-repo-cafe",
    repoFullName: "",
    branchName: "main",
    clientName: "Missing Repo Cafe",
    projectType: "bundle",
    packageName: "Website 3D Premium + Automation Sprint",
    setupUsd: 4200,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Sold website workspace waiting for PR-first GitHub handoff details.",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });
  const snapshot = getRevenueEngineSnapshot();
  const queued = snapshot.websiteBuildHandoffQueue.items.find((item) => item.workspaceId === workspaceResult.workspace.id);

  assert.ok(queued);
  const handoffRequest = JSON.parse(queued.copyableGithubHandoffRequest);
  assert.deepEqual(revenueDeliveryWorkspaceGithubHandoffSchema.parse(handoffRequest), {
    workspaceId: workspaceResult.workspace.id,
  });
  assert.equal("repoFullName" in handoffRequest, false);
  assert.equal("branchName" in handoffRequest, false);
});

test("persists ledger entries across module state reloads", () => {
  recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Persisted Client",
    amountUsd: 2500,
    cashCollectedUsd: 1250,
    estimatedInternalCostUsd: 35,
    notes: "Automation Sprint deposit | Stripe pi_persisted_1250",
  });

  setRevenueLedgerPathForTests(testLedgerPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.metrics.automationsSold, 1);
  assert.equal(snapshot.metrics.cashCollectedUsd, 1250);
  assert.equal(snapshot.recentLedger[0].clientName, "Persisted Client");
});

test("pauses improvement loop when spend reaches cap without collected revenue", () => {
  const review = buildImprovementReview({
    campaignName: "No revenue batch",
    periodLabel: "week 1",
    leadsContacted: 40,
    replies: 1,
    callsBooked: 0,
    dealsClosed: 0,
    revenueCollectedUsd: 0,
    spendUsd: 100,
    estimatedInternalMonthlyCostUsd: 40,
    hoursSaved: 0,
    defectsFound: 0,
    clientComplaints: 0,
    bestOffer: "",
    biggestObjection: "Too expensive",
    notes: "",
  });

  assert.equal(review.decision.status, "pause_and_fix");
  assert.equal(review.metrics.insideSpendCap, true);
  assert.equal(review.nextBatch.maxSpendUsd, 10);
  assert.equal(review.agentScorecard.some((agent) => agent.agent === "cost-controller" && agent.score === "block"), true);
});

test("next batch plan pauses after a blocked improvement review", () => {
  recordRevenueImprovementReview({
    campaignName: "Blocked quality batch",
    periodLabel: "week 1",
    leadsContacted: 30,
    replies: 2,
    callsBooked: 0,
    dealsClosed: 0,
    revenueCollectedUsd: 0,
    spendUsd: 100,
    estimatedInternalMonthlyCostUsd: 40,
    hoursSaved: 0,
    defectsFound: 4,
    clientComplaints: 1,
    bestOffer: "",
    biggestObjection: "Confusing offer",
    notes: "Quality issues before scale.",
  });

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.nextBatchPlan.status, "pause");
  assert.equal(snapshot.nextBatchPlan.maxLeads, 0);
  assert.equal(snapshot.nextBatchPlan.maxSpendUsd, 0);
  assert.equal(snapshot.nextBatchPlan.requiredBeforeNextAction.includes("resolver bloqueos QA/costo antes de contactar"), true);
});

test("scales carefully when collected revenue proves profitable demand", () => {
  const review = buildImprovementReview({
    campaignName: "Winning automation offer",
    periodLabel: "week 2",
    leadsContacted: 25,
    replies: 4,
    callsBooked: 2,
    dealsClosed: 1,
    revenueCollectedUsd: 3000,
    spendUsd: 25,
    estimatedInternalMonthlyCostUsd: 50,
    hoursSaved: 5,
    defectsFound: 0,
    clientComplaints: 0,
    bestOffer: "Automation Sprint",
    biggestObjection: "Need proof",
    notes: "Closed after showing dashboard demo.",
  });

  assert.equal(review.decision.status, "scale_carefully");
  assert.equal(review.metrics.profitable, true);
  assert.equal(review.nextBatch.maxLeads, 25);
  assert.equal(review.nextBatch.maxSpendUsd <= 100, true);
});

test("next batch plan scales only when cash and latest review prove demand", () => {
  recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Winning Client",
    amountUsd: 3000,
    cashCollectedUsd: 3000,
    estimatedInternalCostUsd: 40,
    notes: "Automation Sprint paid | Zelle ref winning-3000",
  });
  recordRevenueImprovementReview({
    campaignName: "Winning automation offer",
    periodLabel: "week 2",
    leadsContacted: 25,
    replies: 4,
    callsBooked: 2,
    dealsClosed: 1,
    revenueCollectedUsd: 3000,
    spendUsd: 25,
    estimatedInternalMonthlyCostUsd: 40,
    hoursSaved: 5,
    defectsFound: 0,
    clientComplaints: 0,
    bestOffer: "Automation Sprint",
    biggestObjection: "Need proof",
    notes: "Closed after showing dashboard demo.",
  });

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.nextBatchPlan.status, "scale_carefully");
  assert.equal(snapshot.nextBatchPlan.maxLeads, 25);
  assert.equal(snapshot.nextBatchPlan.maxSpendUsd <= snapshot.profitGuard.canSpendUsd, true);
  assert.equal(snapshot.nextBatchPlan.allowedActions.includes("contactar batch aprobado"), true);
});

test("records and persists improvement reviews as revenue playbook memory", () => {
  const first = recordRevenueImprovementReview({
    campaignName: "Learning batch",
    periodLabel: "week 1",
    leadsContacted: 10,
    replies: 1,
    callsBooked: 0,
    dealsClosed: 0,
    revenueCollectedUsd: 0,
    spendUsd: 10,
    estimatedInternalMonthlyCostUsd: 40,
    hoursSaved: 0,
    defectsFound: 0,
    clientComplaints: 0,
    bestOffer: "Website 3D Premium",
    biggestObjection: "Need mockup",
    notes: "Keep batch small.",
  });
  const second = recordRevenueImprovementReview({
    campaignName: "Learning batch",
    periodLabel: "week 2",
    leadsContacted: 20,
    replies: 4,
    callsBooked: 2,
    dealsClosed: 1,
    revenueCollectedUsd: 3000,
    spendUsd: 20,
    estimatedInternalMonthlyCostUsd: 50,
    hoursSaved: 3,
    defectsFound: 0,
    clientComplaints: 0,
    bestOffer: "Automation Sprint",
    biggestObjection: "Need proof",
    notes: "Dashboard demo helped close.",
  });

  assert.equal(first.review.playbookVersion, 1);
  assert.equal(second.review.playbookVersion, 2);
  assert.equal(second.review.decisionStatus, "scale_carefully");
  assert.equal(second.snapshot.recentImprovementReviews[0].playbookVersion, 2);

  setRevenueImprovementReviewsPathForTests(testImprovementReviewsPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentImprovementReviews.length, 2);
  assert.equal(snapshot.recentImprovementReviews[0].learningSummary.includes("Playbook v2"), true);
});
