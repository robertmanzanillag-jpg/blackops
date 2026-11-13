import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeDollarSign,
  Bot,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Eye,
  ExternalLink,
  FileCheck2,
  Gauge,
  GitPullRequest,
  Loader2,
  MessageSquareText,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wand2,
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
import { buildDeliveryWorkspaceQaPayload } from "@/lib/revenue-engine-delivery-qa";
import { buildCopyableTrustedDeliverRequest, isTrustedDeliveryRequestReady } from "@/lib/revenue-engine-delivery-requests";
import { buildPublicScoutConnectorIntakeRequest } from "@/lib/revenue-engine-public-scout-connector";

type RevenueDailyScoutSprintSnapshot = {
  id: string;
  createdAt: string;
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
  offerFocus: "websites" | "automations" | "both";
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

const DAILY_MONEY_SAFE_RUN_ENDPOINTS = new Set([
  "/api/revenue-engine/scout-dispatch",
  "/api/revenue-engine/money-sprint/public-candidates",
  "/api/revenue-engine/website-opportunities",
  "/api/revenue-engine/website-delivery-workspace",
  "/api/revenue-engine/delivery-workspaces/github-handoff",
]);

function parseDailyMoneyRunRequest(value: string | undefined) {
  if (!value?.trim()) {
    return { ok: false as const, reason: "No hay request listo.", payload: null };
  }

  try {
    return { ok: true as const, reason: "", payload: JSON.parse(value) as Record<string, unknown> };
  } catch {
    return { ok: false as const, reason: "El request no es JSON valido.", payload: null };
  }
}

function hasDailyMoneyRunPlaceholders(value: string | undefined) {
  return /\bREPLACE_|"owner\/repo"|codex\/client-website-build/.test(value || "");
}

type RevenueSnapshot = {
  metrics: {
    appsSold: number;
    automationsSold: number;
    revenueUsd: number;
    cashCollectedUsd: number;
    monthlySpendCapUsd: number;
    estimatedSpendUsd: number;
    profitUsd: number;
    approvalQueue: number;
  };
  executiveSummary: {
    status: "blocked" | "collect_first" | "needs_approval" | "ready";
    headline: string;
    appsSold: number;
    automationsSold: number;
    totalProductsSold: number;
    revenueUsd: number;
    cashCollectedUsd: number;
    estimatedSpendUsd: number;
    profitUsd: number;
    collectionRatePercent: number;
    profitMarginPercent: number;
    approvalQueue: number;
    nextFocus: string;
  };
  operatorConsole: {
    moneyLine: string;
    nextCommand: string;
    canSpendNow: boolean;
    spendPermission: string;
    allowedNow: string[];
    waitingOnRobert: string[];
    blockedNow: string[];
    scoreboard: {
      appsSold: number;
      automationsSold: number;
      revenueUsd: number;
      cashCollectedUsd: number;
      estimatedSpendUsd: number;
      profitUsd: number;
      approvalQueue: number;
    };
  };
  dailyMoneyCommand: {
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
  moneyActivationPlan: {
    status: "ready_for_money_mode" | "ready_for_first_sprint" | "dry_run_research_only" | "blocked";
    headline: string;
    canStartToday: boolean;
    canContactBusinesses: boolean;
    canCollectMoney: boolean;
    canBuildWebsites: boolean;
    allowedToday: string[];
    missingBeforeRealMoney: Array<{
      id: string;
      label: string;
      reason: string;
      nextStep: string;
    }>;
    blockedUntilApproved: string[];
    evidenceGate: {
      status: "ready" | "needs_review" | "empty";
      readyCandidates: number;
      blockedCandidates: number;
      requiredFields: string[];
      nextAction: string;
      blockedActions: string[];
    };
    productionLaunchChecklist: {
      status: "ready" | "blocked";
      requiredEvidence: Array<{
        id: string;
        label: string;
        status: "ready" | "blocked";
        evidence: string;
        nextStep: string;
      }>;
      verificationCommands: string[];
      blockedActions: string[];
      deploymentApprovalPacket: {
        status: "waiting_for_external_evidence" | "approved";
        requiredSummaryFields: string[];
        rollbackPlan: string;
        deployApprovalAsk: string;
        blockedUntil: string[];
      };
      productionSetupPacket: {
        status: "ready" | "blocked";
        title: string;
        requiredEnv: Array<{
          key: string;
          status: "ready" | "blocked";
          evidence: string;
          nextStep: string;
          verifyCommand: string;
        }>;
        operatorSteps: string[];
        guardrails: string[];
        copyableSetupPacket: string;
      };
      copyableChecklist: string;
    };
    firstSprintPlan: {
      title: string;
      area: string;
      niche: string;
      offerFocus: "websites" | "automations" | "both";
      targetRows: number;
      nextApiAction: string;
      copyableDispatchRequest: string;
      revenuePath: Array<{
        id: string;
        label: string;
        input: string;
        output: string;
        gate: string;
        apiAction: string;
      }>;
      steps: Array<{
        id: string;
        label: string;
        action: string;
        apiAction: string;
        approvalRequired: boolean;
      }>;
      blockedActions: string[];
      copyableBrief: string;
    };
    nextRobertAction: string;
    copyableBrief: string;
  };
  systemReadiness: {
    score: number;
    ready: number;
    blocked: number;
    needsApproval: number;
    needsData: number;
    summary: string;
    items: Array<{
      id: string;
      label: string;
      status: "ready" | "blocked" | "needs_approval" | "needs_data";
      evidence: string;
      nextStep: string;
    }>;
  };
  launchReadiness: {
    status: "ready_to_start" | "blocked";
    summary: string;
    launchScore: number;
    ready: number;
    pendingAllowed: number;
    blocked: number;
    market: {
      area: string;
      niche: string;
      firstSprintDays: number;
      goal: string;
    };
    items: Array<{
      id: string;
      label: string;
      status: "ready" | "pending_allowed" | "blocked";
      evidence: string;
      nextStep: string;
    }>;
    manualStartPlan: string[];
    todayExecutionPack: {
      status: "ready" | "blocked";
      ownerAgent: string;
      mission: string;
      copyableAgentCommand: string;
      runLimits: {
        researchTarget: number;
        maxQualifiedRowsToImport: number;
        maxMockups: number;
        maxManualContacts: number;
        maxPaidSpendUsd: number;
      };
      sourcePriority: string[];
      requiredEvidenceFields: string[];
      copyableBatchHeader: string;
      nextApiAction: string;
      approvalRequiredBefore: string[];
    };
    contactScripts: {
      contactForm: string;
      phonePermission: string;
      followUp: string;
    };
    doNotDoYet: string[];
    emailPending: {
      isPending: boolean;
      providerConfigured: boolean;
      missing: string[];
      allowedWhilePending: string[];
    };
  };
  agentOperatingContract: {
    mode: "correction_only" | "draft_only" | "approval_queue" | "controlled_autopilot";
    mainAgent: string;
    canRunAutonomously: string[];
    requiresHumanApproval: string[];
    blockedActions: string[];
    currentInstruction: string;
  };
  businessScoutQueue: {
    status: "ready" | "needs_context";
    source: "latest_scouting_mission" | "default_market";
    area: string;
    niche: string;
    offerFocus: "websites" | "automations" | "both";
    dailyResearchTarget: number;
    tasks: Array<{
      id: string;
      source: string;
      query: string;
      url: string;
      ownerAgent: string;
      allowedAction: string;
      evidenceToCapture: string[];
      blockedActions: string[];
    }>;
    workPack: {
      targetRows: number;
      batchHeader: string;
      copyableBatchTemplate: string;
      subagentBrief: string;
      searchPlaybook: {
        prioritizedSources: Array<{
          source: string;
          query: string;
          evidenceGoal: string;
        }>;
        opportunitySignals: string[];
        dailyOperatingCadence: string[];
        copyableBrief: string;
      };
      importInstructions: string[];
      qualityGate: string[];
      safety: {
        allowedAction: string;
        blockedActions: string[];
        paidDataSpendUsd: number;
        sendsOutreach: boolean;
        writesPreviewFiles: boolean;
      };
    };
    nextAction: string;
    safety: {
      researchesPublicSources: true;
      persistsCandidates: false;
      sendsOutreach: false;
      spendsMoney: false;
      blockedActions: string[];
    };
  };
  latestDailyScoutSprint: RevenueDailyScoutSprintSnapshot | null;
  recentDailyScoutSprints: RevenueDailyScoutSprintSnapshot[];
  websiteSalesPacketQueue: {
    status: "ready" | "needs_context" | "empty";
    readyCount: number;
    blockedCount: number;
    items: Array<{
      leadId: string;
      outreachDraftId: string;
      businessName: string;
      area: string;
      niche: string;
      websiteStatus: "no_website" | "weak_website" | "has_website" | "unknown";
      leadStatus: "research" | "qualified" | "mockup_ready" | "outreach_ready" | "contacted" | "proposal_sent" | "closed" | "disqualified";
      grade: string;
      score: number;
      sourceUrl: string;
      mockupUrl: string;
      contactChannel: "email" | "phone" | "instagram" | "contact_form" | "unknown";
      contactValue: string;
      draftStatus: "draft" | "approved" | "blocked";
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
  manualOutreachQueue: {
    status: "ready" | "needs_approval" | "empty";
    dailyContactLimit: number;
    readyCount: number;
    blockedCount: number;
    overflowCount: number;
    items: Array<{
      draftId: string;
      businessName: string;
      channel: "email" | "gmail" | "mailto" | "instagram" | "contact_form";
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
      status: "draft" | "approved" | "blocked";
      reason: string;
    }>;
    nextAction: string;
    safety: {
      sendsOutreach: false;
      requiresHumanApproval: true;
      blockedActions: string[];
    };
  };
  websiteClosureQueue: {
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
      status: "quoted" | "scope_approved" | "sold" | "blocked";
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
  publicLeadImportQueue: {
    status: "ready" | "needs_review" | "empty";
    readyCount: number;
    blockedCount: number;
    copyableMoneySprintRequest: string;
    items: Array<{
      candidateId: string;
      businessName: string;
      area: string;
      niche: string;
      websiteStatus: "no_website" | "weak_website" | "has_website" | "unknown";
      contactChannel: "email" | "phone" | "instagram" | "contact_form" | "unknown";
      sourceUrl: string;
      recipientEmail: string;
      estimatedOfferUsd: number;
      grade: string;
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
  websiteDeliveryHandoffQueue: {
    status: "ready" | "needs_context" | "empty";
    readyCount: number;
    blockedCount: number;
    items: Array<{
      opportunityId: string;
      leadId: string;
      outreachDraftId: string;
      businessName: string;
      leadStatus: "research" | "qualified" | "mockup_ready" | "outreach_ready" | "contacted" | "proposal_sent" | "closed" | "disqualified";
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
  websiteBuildHandoffQueue: {
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
  profitGuard: {
    status: "pause_spend" | "collect_first" | "review_queue" | "scale_carefully";
    monthlyCapUsd: number;
    estimatedSpendUsd: number;
    remainingCapUsd: number;
    cashCollectedUsd: number;
    cashCoverageUsd: number;
    profitUsd: number;
    canSpendUsd: number;
    reason: string;
    requiredActions: string[];
  };
  nextBatchPlan: {
    status: "pause" | "collect_first" | "iterate_small_batch" | "scale_carefully";
    maxLeads: number;
    maxSpendUsd: number;
    reason: string;
    requiredBeforeNextAction: string[];
    allowedActions: string[];
    latestReviewId: string;
  };
  approvalQueueItems: Array<{
    id: string;
    source: "profit_guard" | "outbox" | "agent_run" | "automation_opportunity" | "website_opportunity" | "delivery_workspace";
    title: string;
    status: string;
    priority: "high" | "medium";
    action: string;
  }>;
  costPolicy: {
    monthlyCapUsd: number;
    stopRule: string;
    defaultMode: string;
    allowedWithoutApproval: string[];
    requiresApproval: string[];
  };
  emailProvider: {
    provider: "resend";
    configured: boolean;
    mode: "api" | "manual";
    fromEmail: string;
    missing: string[];
    monthlyCostUsd: number;
    sendPolicy: string;
  };
  improvementDefaults: {
    reviewCadence: string;
    minimumGrossMarginPercent: number;
    maxMonthlySpendBeforeRevenueUsd: number;
    stopRule: string;
    learningMode: string;
  };
  agents: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
    approvalGate: string;
  }>;
  pipelineStages: Array<{ id: string; name: string; count: number; valueUsd: number }>;
  recentLedger: Array<{
    id: string;
    createdAt: string;
    kind: "website_sale" | "automation_sale" | "bundle_sale" | "retainer" | "expense";
    clientName: string;
    amountUsd: number;
    cashCollectedUsd: number;
    estimatedInternalCostUsd: number;
    notes: string;
  }>;
  recentLeads: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    businessName: string;
    area: string;
    niche: string;
    websiteStatus: "no_website" | "weak_website" | "has_website" | "unknown";
    contactChannel: "email" | "phone" | "instagram" | "contact_form" | "unknown";
    contactValue: string;
    evidence: string;
    painPoint: string;
    estimatedOfferUsd: number;
    status: "research" | "qualified" | "mockup_ready" | "outreach_ready" | "contacted" | "proposal_sent" | "closed" | "disqualified";
  }>;
  recentPublicLeadCandidates: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    businessName: string;
    area: string;
    niche: string;
    websiteStatus: "no_website" | "weak_website" | "has_website" | "unknown";
    contactChannel: "email" | "phone" | "instagram" | "contact_form" | "unknown";
    contactValue: string;
    sourceUrl: string;
    recipientEmail: string;
    evidence: string;
    painPoint: string;
    estimatedOfferUsd: number;
    status: "research" | "qualified" | "mockup_ready" | "outreach_ready" | "contacted" | "proposal_sent" | "closed" | "disqualified";
    verificationStatus: "needs_review" | "verified_public" | "blocked";
    publicEvidenceVerified: boolean;
    approvalToImport: boolean;
    importReady: boolean;
    blockedReasons: string[];
    batchRow: string;
    qualification: RevenueLeadResult["qualification"];
    safety: {
      allowedAction: string;
      blockedActions: string[];
      persistsLead: boolean;
      sendsOutreach: boolean;
      writesPreviewFiles: boolean;
    };
  }>;
  recentOutreach: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    leadId: string;
    channel: "email" | "gmail" | "mailto" | "instagram" | "contact_form";
    approvalStatus: "draft" | "approved";
    mockupUrl?: string;
    recipientEmail: string;
    contactName: string;
    businessName: string;
    sourceUrl?: string;
    businessSummary: string;
    websitePriceUsd: number;
    automationPriceUsd: number;
    monthlyRetainerUsd: number;
    estimatedInternalMonthlyCostUsd: number;
    notes: string;
    status: "draft" | "approved" | "blocked";
    subject: string;
    body: string;
    pricing: ProposalEmail["pricing"];
    delivery: ProposalEmail["delivery"] & {
      provider?: string;
      externalMessageId?: string;
      sentAt?: string;
      lastAttemptAt?: string;
      outcome?: RevenueOutreachOutcome;
      outcomeAt?: string;
      outcomeNotes?: string;
      outcomeCashCollectedUsd?: number;
    };
    links: ProposalEmail["links"];
    qaGates: Array<{ gate: string; passed: boolean; fix: string }>;
    nextAction: string;
  }>;
  recentAgentRuns: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    businessName: string;
    area: string;
    niche: string;
    request: string;
    stage: "lead_research" | "mockup" | "outreach" | "proposal" | "production" | "delivery" | "improvement";
    projectType: "website" | "automation" | "bundle";
    estimatedOfferUsd: number;
    estimatedInternalCostUsd: number;
    monthlyBudgetUsd: number;
    cashCollectedUsd: number;
    approvalToContact: boolean;
    approvalToSpend: boolean;
    approvalToBuild: boolean;
    status: "ready" | "approval_required" | "blocked";
    clarificationGate: ClarificationGate;
    mainAgent: { agent: string; decision: string; reason: string };
    budgetGate: { monthlyCapUsd: number; insideCap: boolean; cashProtected: boolean; allowedSpendUsd: number };
    workOrder: Array<{ step: string; ownerAgent: string; output: string; approvalRequired: boolean }>;
    subagentReviews: Array<{ agent: string; verdict: "pass" | "fix" | "block"; correction: string }>;
    requiredApprovals: string[];
    nextActions: string[];
    learningUpdate: string;
  }>;
  recentAutomationOpportunities: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    sourceLeadId: string;
    businessName: string;
    industry: string;
    request: string;
    currentTools: string;
    monthlyBudgetUsd: number;
    urgency: "this_week" | "this_month" | "flexible";
    status: "intake" | "quoted" | "approved" | "sold" | "in_delivery" | "delivered" | "blocked";
    clientApprovedScope: boolean;
    depositPaid: boolean;
    paymentConfirmation: string;
    quote: AutomationQuote;
    qaGates: Array<{ gate: string; passed: boolean; fix: string }>;
    nextAction: string;
  }>;
  recentWebsiteOpportunities: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    leadId: string;
    outreachDraftId: string;
    projectType: "website" | "bundle";
    notes: string;
    status: "quoted" | "scope_approved" | "sold" | "blocked";
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
  }>;
  recentImprovementReviews: Array<ImprovementReview & {
    id: string;
    createdAt: string;
    updatedAt: string;
    playbookVersion: number;
    decisionStatus: "pause_and_fix" | "scale_carefully" | "iterate_small_batch";
    learningSummary: string;
  }>;
  recentScoutingMissions: Array<RevenueScoutingMission & {
    id: string;
    createdAt: string;
    updatedAt: string;
    status: "planned" | "in_research" | "ready_for_leads" | "blocked";
    learningNote: string;
  }>;
  recentDeliveryWorkspaces: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    input: {
      workspaceName: string;
      clientName: string;
      projectType: "website" | "automation" | "bundle";
      packageName: string;
      setupUsd: number;
      monthlyRetainerUsd: number;
      estimatedInternalCostUsd: number;
      depositPaid: boolean;
      scopeApproved: boolean;
      publicDataVerified: boolean;
      includesAutomation: boolean;
      launchTargetDays: number;
      clientRequest: string;
      sourceUrl: string;
      repoFullName: string;
      branchName: string;
      githubIssueUrl: string;
      prUrl: string;
      secondReviewStatus: "pending" | "pass" | "blocked";
      secondReviewEvidenceUrl: string;
      appQaStatus: "pending" | "pass" | "blocked";
      appQaEvidenceUrl: string;
      deploymentApprovalStatus: "not_requested" | "requested" | "approved" | "blocked";
      deploymentApprovalUrl: string;
      releaseGateHeadSha: string;
      visualQaPassed: boolean;
      technicalQaPassed: boolean;
      automationQaPassed: boolean;
      clientHandoffReady: boolean;
    };
    status: "ready_to_deliver" | "needs_corrections" | "blocked";
    projectPlan: RevenueProjectPlan;
    deliveryReview: DeliveryReview;
    correctionQueue: Array<{ agent: string; priority: "high" | "medium"; action: string; blocksDelivery: boolean }>;
    runbook: Array<{ phase: string; ownerAgent: string; checklist: string[] }>;
    approvalSummary: { canShowClientPreview: boolean; canLaunch: boolean; requiredBeforeClient: string[] };
    codexBuildHandoff: {
      status: "not_required" | "needs_pr" | "ready_for_qa";
      repoFullName: string;
      branchName: string;
      githubIssueUrl: string;
      prUrl: string;
      secondReviewStatus: "pending" | "pass" | "blocked";
      secondReviewEvidenceUrl: string;
      appQaStatus: "pending" | "pass" | "blocked";
      appQaEvidenceUrl: string;
      deploymentApprovalStatus: "not_requested" | "requested" | "approved" | "blocked";
      deploymentApprovalUrl: string;
      releaseGateHeadSha: string;
      title: string;
      codexBrief: string;
      publicBuildBrief: string;
      githubIssueTitle: string;
      copyableGithubIssueBody: string;
      buildPack: {
        sections: string[];
        assets: string[];
        qaCommands: string[];
        publicOnly: boolean;
        copyableBuildPack: string;
      };
      acceptanceCriteria: string[];
      blockedActions: string[];
      missing: string[];
      nextAction: string;
    };
    learningNote: string;
  }>;
  recentApprovalDecisions: Array<{
    id: string;
    createdAt: string;
    targetId: string;
    targetType: "profit_guard" | "outbox" | "agent_run" | "automation_opportunity" | "delivery_workspace" | "manual";
    decision: "approved" | "rejected" | "needs_changes";
    approvedAction: string;
    maxSpendUsd: number;
    notes: string;
    guardrail: { status: "recorded" | "blocked"; reason: string };
  }>;
  recentAutomationIntakes: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    businessName: string;
    industry: string;
    request: string;
    currentTools: string;
    monthlyBudgetUsd: number;
    urgency: "this_week" | "this_month" | "flexible";
    contactName: string;
    contactEmail: string;
    knownAnswers: string;
    source: "manual" | "lead" | "website_form" | "call" | "email";
    status: "needs_answers" | "ready_for_quote";
    missingAnswers: string[];
    nextQuestions: string[];
    answerTemplate: string;
    blockedUntilAnswered: string[];
    nextAction: string;
  }>;
  packages: Array<{
    id: string;
    name: string;
    priceUsd: number;
    recurringUsd: number;
    marginTarget: string;
    delivery: string;
    includes: string[];
  }>;
};

type ClarificationGate = {
  status: "clear" | "needs_clarification";
  missing: string[];
  questions: string[];
  minimumAnswer: string;
  blocks: string[];
};

type RevenuePlan = {
  input: {
    area: string;
    niche: string;
    offerFocus: "websites" | "automations" | "both";
    monthlyBudgetUsd: number;
    leadCount: number;
  };
  budget: {
    monthlyCapUsd: number;
    estimatedFirstBatchUsd: number;
    remainingBudgetUsd: number;
    isInsideCap: boolean;
    mode: string;
  };
  target: {
    area: string;
    niche: string;
    offer: string;
    batchSize: number;
    qualification: string[];
  };
  searchQueries: string[];
  leadSlots: Array<{
    id: string;
    name: string;
    area: string;
    status: string;
    evidenceNeeded: string[];
    nextAgent: string;
  }>;
  mockupBrief: {
    style: string;
    sections: string[];
    demoAngles: string[];
    qaChecks: string[];
  };
  outreachDraft: {
    channelPriority: string[];
    firstMessage: string;
    followUps: string[];
    approvalStatus: string;
  };
  deliverySystem: {
    checkpoints: string[];
    improvementLoop: string[];
  };
};

type RevenueScoutingMission = {
  mission: {
    name: string;
    area: string;
    niche: string;
    offerFocus: "websites" | "automations" | "both";
    targetLeadCount: number;
    leadBatchSize: number;
    mode: "free_public_research" | "paid_data_requires_approval";
  };
  budgetGate: {
    monthlyCapUsd: number;
    requestedPaidDataSpendUsd: number;
    approvedPaidDataSpendUsd: number;
    requiresApprovalToSpend: boolean;
    allowedBeforeApproval: string[];
    blockedBeforeApproval: string[];
  };
  searchQueries: string[];
  leadEvidenceChecklist: string[];
  qualificationScorecard: Array<{
    item: string;
    maxPoints: number;
    signals: string[];
  }>;
  subagentReviews: Array<{
    agent: string;
    check: string;
  }>;
  nextActions: string[];
};

type RevenueScoutingMissionResult = {
  mission: RevenueSnapshot["recentScoutingMissions"][number];
  snapshot: RevenueSnapshot;
};

type RevenueDailyScoutSprintResult = {
  status: "started";
  sprint: RevenueDailyScoutSprintSnapshot;
  safety: RevenueDailyScoutSprintSnapshot["safety"];
  nextAction: string;
  snapshot: RevenueSnapshot;
};

type RevenueScoutDispatchResult = {
  status: "dispatch_ready";
  reason: string;
  sprint: RevenueDailyScoutSprintSnapshot;
  dispatch: {
    mode: "manual_subagent_dispatch";
    executionMode: "manual_evidence_required";
    blockedUntil: string;
    requiredExecutionBridge: string;
    readyToAssign: boolean;
    agentCount: number;
    taskCount: number;
    slotCount: number;
    agentAssignments: Array<{
      ownerAgent: string;
      taskIds: string[];
      taskCount: number;
      slotCount: number;
      searchUrls: string[];
      copyableBrief: string;
    }>;
    connectorIntake: {
      endpoint: string;
      executionMode: "verified_connector_review_only";
      maxResults: number;
      approvalLocked: boolean;
      copyablePayloadTemplate: string;
      copyableBrief: string;
      copyableWorkOrders: string;
      copyableSubagentCommands: string;
      workOrders: Array<{
        taskId: string;
        ownerAgent: string;
        sourceAgent: string;
        source: string;
        query: string;
        sourceQuery: string;
        searchUrl: string;
        targetRows: number;
        resultSlotIds: string[];
        endpoint: string;
        payload: Record<string, unknown>;
        copyableSubagentCommand: string;
        copyableWorkOrder: string;
      }>;
    };
    copyableDispatchBrief: string;
    safety: RevenueDailyScoutSprintSnapshot["safety"];
  };
  safety: RevenueDailyScoutSprintSnapshot["safety"];
  nextAction: string;
  snapshot: RevenueSnapshot;
};

type AutomationQuote = {
  input: {
    businessName: string;
    industry: string;
    request: string;
    currentTools: string;
    monthlyBudgetUsd: number;
    urgency: "this_week" | "this_month" | "flexible";
  };
  decision: {
    status: "needs_clarification" | "ready_to_pitch";
    approvalMode: string;
    reason: string;
  };
  clarificationGate: ClarificationGate;
  pricing: {
    setupPriceUsd: number;
    requiredDepositUsd: number;
    monthlyRetainerUsd: number;
    estimatedInternalMonthlyCostUsd: number;
    grossMarginUsd: number;
    grossMarginPercent: number;
    insideCostCap: boolean;
    clientBudgetFit: "fits" | "upsell_or_reduce_scope";
  };
  scope: {
    packageName: string;
    detectedNeeds: string[];
    integrations: string[];
    deliverables: string[];
    outOfScopeUntilApproved: string[];
  };
  agents: Array<{
    id: string;
    check: string;
    result: string;
  }>;
  clientProposalDraft: {
    headline: string;
    summary: string;
    close: string;
  };
  deliveryPlan: string[];
  improvementLoop: string[];
  clarifyingQuestions: string[];
};

type DeliveryReview = {
  input: {
    projectName: string;
    projectType: "website" | "automation" | "bundle";
    setupPriceUsd: number;
    monthlyRetainerUsd: number;
    estimatedInternalMonthlyCostUsd: number;
    clientApprovedScope: boolean;
    depositPaid: boolean;
    publicDataVerified: boolean;
    responsiveChecked: boolean;
    linksChecked: boolean;
    automationTested: boolean;
    rollbackPlanReady: boolean;
    clientHandoffReady: boolean;
    notes: string;
  };
  status: "ready_to_deliver" | "needs_fix" | "blocked";
  summary: {
    passed: number;
    total: number;
    failed: number;
    blocking: number;
    setupPriceUsd: number;
    monthlyRetainerUsd: number;
    estimatedInternalMonthlyCostUsd: number;
    grossMarginUsd: number;
    grossMarginPercent: number;
    insideCostCap: boolean;
  };
  gates: Array<{
    id: string;
    agent: string;
    label: string;
    passed: boolean;
    fix: string;
  }>;
  requiredFixes: Array<{
    gateId: string;
    ownerAgent: string;
    action: string;
  }>;
  deliveryDecision: string;
  nextReview: {
    cadence: string;
    improvementMetrics: string[];
  };
};

type ProposalEmail = {
  input: {
    recipientEmail: string;
    contactName: string;
    businessName: string;
    sourceUrl?: string;
    businessSummary: string;
    websitePriceUsd: number;
    automationPriceUsd: number;
    monthlyRetainerUsd: number;
    estimatedInternalMonthlyCostUsd: number;
    notes: string;
  };
  subject: string;
  body: string;
  pricing: {
    totalSetupUsd: number;
    depositUsd: number;
    monthlyRetainerUsd: number;
    estimatedInternalMonthlyCostUsd: number;
    grossMarginUsd: number;
    grossMarginPercent: number;
    insideCostCap: boolean;
  };
  delivery: {
    mode: string;
    sendStatus: string;
    reason: string;
    requiresApproval: boolean;
    provider?: string;
    externalMessageId?: string;
    sentAt?: string;
    lastAttemptAt?: string;
  };
  links: {
    mailto: string;
    gmailCompose: string;
  };
};

type OutreachDraftResult = {
  draft: RevenueSnapshot["recentOutreach"][number];
  syncedLead: RevenueSnapshot["recentLeads"][number] | null;
  snapshot: RevenueSnapshot;
};

type OutreachApproveResult = {
  status: "approved" | "blocked";
  reason: string;
  gates: Array<{ gate: string; passed: boolean; fix: string }>;
  draft: RevenueSnapshot["recentOutreach"][number] | null;
  snapshot: RevenueSnapshot;
  safety?: {
    sendsOutreach: boolean;
    spendsMoney: boolean;
    writesPreviewFiles: boolean;
    createsLedger: boolean;
    createsDelivery: boolean;
  };
};

type OutreachSendResult = {
  status: "sent" | "blocked" | "failed";
  provider: RevenueSnapshot["emailProvider"];
  gates: Array<{ gate: string; passed: boolean; fix: string }>;
  reason?: string;
  sendResult?: { id: string };
  draft: RevenueSnapshot["recentOutreach"][number] | null;
  snapshot: RevenueSnapshot;
};

type RevenueOutreachOutcome = "contacted" | "reply" | "call_booked" | "deposit_collected" | "lost";

type OutreachOutcomeResult = {
  status: "recorded" | "blocked";
  reason: string;
  gates: Array<{ gate: string; passed: boolean; fix: string }>;
  draft: RevenueSnapshot["recentOutreach"][number] | null;
  lead: RevenueSnapshot["recentLeads"][number] | null;
  websiteOpportunity?: RevenueSnapshot["recentWebsiteOpportunities"][number] | null;
  snapshot: RevenueSnapshot;
};

type RevenueAgentRunResult = {
  run: RevenueSnapshot["recentAgentRuns"][number];
  snapshot: RevenueSnapshot;
};

type RevenueSalesAutopilotResult = {
  status: "ready" | "approval_required" | "blocked";
  guardrail: string;
  lead: RevenueSnapshot["recentLeads"][number];
  leadQualification: RevenueLeadResult["qualification"];
  clarificationGate: ClarificationGate;
  mockup: RevenueMockup;
  agentRun: RevenueSnapshot["recentAgentRuns"][number];
  deliveryReview: DeliveryReview;
  outreachDraft: RevenueSnapshot["recentOutreach"][number] | null;
  requiredBeforeExternalAction: string[];
  nextActions: string[];
  snapshot: RevenueSnapshot;
};

type RevenueLeadRadar = {
  status: "always_on_ready" | "needs_spend_approval";
  operatingMode: {
    name: string;
    researchRunsAllDay: boolean;
    contactMode: "draft_only" | "approved_queue_only";
    spendMode: "approval_required" | "free_public_research";
    mockupOwner: string;
    nextHumanDecision: string;
  };
  dailyLimits: {
    runHoursPerDay: number;
    researchTarget: number;
    researchPerHour: number;
    qualifiedLeadLimit: number;
    qualifiedPerHour: number;
    mockupLimit: number;
    mockupCadenceHours: number;
    contactLimit: number;
    contactCadenceHours: number;
    monthlySpendCapUsd: number;
    approvedPaidDataSpendUsd: number;
  };
  lanes: Array<{ lane: string; ownerAgent: string; runs: string; output: string; blockedActions: string[] }>;
  channelMix: Array<{ channel: string; priority: number; reason: string; costUsd: number }>;
  searchRotations: string[];
  qualificationRules: string[];
  mockupPolicy: {
    whoCreatesMockups: string;
    requiredBeforeMockup: string[];
    maxPerDay: number;
    qualityBar: string;
  };
  recommendation: string;
  nextActions: string[];
};

type RevenueMoneySprint = {
  status: "ready_to_start" | "needs_spend_approval" | "needs_lead_evidence";
  mode: string;
  scoutQueue: Array<{
    id: string;
    source: string;
    query: string;
    url: string;
    ownerAgent: string;
    allowedAction: string;
    evidenceToCapture: string[];
    blockedActions: string[];
  }>;
  scoutWorkPack: {
    targetRows: number;
    batchHeader: string;
    copyableBatchTemplate: string;
    subagentBrief: string;
    searchPlaybook: {
      prioritizedSources: Array<{
        source: string;
        query: string;
        evidenceGoal: string;
      }>;
      opportunitySignals: string[];
      dailyOperatingCadence: string[];
      copyableBrief: string;
    };
    importInstructions: string[];
    qualityGate: string[];
    safety: {
      allowedAction: string;
      blockedActions: string[];
      paidDataSpendUsd: number;
      sendsOutreach: boolean;
      writesPreviewFiles: boolean;
    };
  };
  recordedLeads: Array<{
    lead: RevenueSnapshot["recentLeads"][number];
    qualification: RevenueLeadResult["qualification"];
    deduped: boolean;
  }>;
  previews: Array<{
    status: "mockup_ready" | "needs_evidence";
    slug: string;
    previewUrl: string;
    fileWritten: boolean;
    htmlBytes: number;
    nextAction: string;
  }>;
  outreachDrafts: RevenueSnapshot["recentOutreach"];
  blockedSeeds: Array<{ businessName: string; reason: string }>;
  operatingLimits: {
    maxQualifiedLeadsToday: number;
    maxMockupsToday: number;
    maxContactsToday: number;
    maxPaidDataSpendUsd: number;
    externalContactMode: string;
  };
  approvalGates: string[];
  nextActions: string[];
  snapshot: RevenueSnapshot;
};

type RevenueMoneySprintPreview = {
  status: "ready_to_import" | "needs_spend_approval" | "needs_lead_evidence" | "empty";
  acceptedSeeds: Array<{
    rowNumber: number;
    businessName: string;
    area: string;
    niche: string;
    websiteStatus: "no_website" | "weak_website" | "has_website" | "unknown";
    contactChannel: "email" | "phone" | "instagram" | "contact_form" | "unknown";
    contactValue: string;
    sourceUrl: string;
    recipientEmail: string;
    estimatedOfferUsd: number;
    qualification: RevenueLeadResult["qualification"];
    mockupReady: boolean;
    draftReady: boolean;
    missingForDraft: string[];
  }>;
  blockedSeeds: Array<{ businessName: string; reason: string }>;
  totals: {
    accepted: number;
    blocked: number;
    mockupReady: number;
    draftReady: number;
    maxImportable: number;
  };
  safety: {
    persistsData: boolean;
    writesPreviewFiles: boolean;
    sendsOutreach: boolean;
    nextAction: string;
  };
};

type RevenuePublicLeadCandidateResult = {
  status: "ready_for_preview" | "needs_review";
  candidate: RevenueSnapshot["recentPublicLeadCandidates"][number];
  importBatchText: string;
  importableCount: number;
  nextAction: string;
  snapshot: RevenueSnapshot;
};

type RevenuePublicLeadCandidateApproveResult = {
  status: "approved" | "needs_review" | "not_found";
  reason: string;
  candidate: RevenueSnapshot["recentPublicLeadCandidates"][number] | null;
  importableCount: number;
  importBatchText?: string;
  safety: {
    persistsCandidates: boolean;
    persistsLeads: boolean;
    sendsOutreach: boolean;
    spendsMoney: boolean;
    writesPreviewFiles: boolean;
  };
  snapshot: RevenueSnapshot;
};

type RevenuePublicLeadCandidateBatchResult = {
  status: "ready_for_preview" | "needs_review" | "empty";
  recordedCount: number;
  importableCount: number;
  blockedCount: number;
  recorded: Array<{
    status: "ready_for_preview" | "needs_review";
    candidate: RevenueSnapshot["recentPublicLeadCandidates"][number];
    nextAction: string;
  }>;
  blockedSeeds: Array<{ businessName: string; reason: string }>;
  safety: {
    persistsCandidates: boolean;
    persistsLeads: boolean;
    sendsOutreach: boolean;
    spendsMoney: boolean;
    writesPreviewFiles: boolean;
    requiresPublicEvidence: boolean;
    blockedActions: string[];
  };
  nextAction: string;
  snapshot: RevenueSnapshot;
};

type RevenueScoutSprintProgress = {
  sprintId: string;
  taskId: string;
  status: "open" | "completed" | "blocked";
  filledSlots: number;
  newlyFilledSlots: number;
  rejectedSlots: number;
  openSlots: number;
  targetRows: number;
  nextAction: string;
};

type RevenuePublicScoutEvidenceResult = RevenuePublicLeadCandidateBatchResult & {
  normalizedBatchText: string;
  parsedCount: number;
  sprintProgress?: RevenueScoutSprintProgress | null;
};

type RevenueDailyScoutSprintSubmitResult = {
  status: "submitted" | "needs_review" | "not_found" | "blocked";
  reason: string;
  evidenceResult: RevenuePublicScoutEvidenceResult | null;
  sprintProgress: RevenueScoutSprintProgress | null;
  snapshot: RevenueSnapshot;
};

type RevenuePublicCandidateSprintResult = {
  status: "started" | "blocked" | "needs_spend_approval";
  reason: string;
  importedCandidateIds: string[];
  blockedCandidates: Array<{ candidateId: string; businessName: string; reason: string }>;
  sprint: RevenueMoneySprint | null;
  safety: {
    persistsData: boolean;
    writesPreviewFiles: boolean;
    sendsOutreach: boolean;
    spendsMoney: boolean;
  };
  snapshot: RevenueSnapshot;
};

type RevenuePublicScoutAgentCommandResult = {
  status: "candidates_ready" | "needs_review" | "blocked" | "sprint_started";
  reason: string;
  evidenceResult: RevenuePublicScoutEvidenceResult;
  sprintResult: RevenuePublicCandidateSprintResult | null;
  readyCandidateIds: string[];
  safety: {
    persistsCandidates: boolean;
    persistsLeads: boolean;
    writesPreviewFiles: boolean;
    sendsOutreach: boolean;
    spendsMoney: boolean;
    deploys: boolean;
    requiresApprovalToContact: boolean;
    blockedActions: string[];
  };
  nextAction: string;
  snapshot: RevenueSnapshot;
};

type RevenueVerifiedScoutConnectorIntakeResult = {
  status: "needs_review" | "ready_for_preview" | "empty";
  reason: string;
  connector: {
    name: string;
    runId: string;
    resultCount: number;
    executionMode: "verified_connector_review_only";
    approvalLocked: boolean;
  };
  evidenceResult: RevenuePublicScoutEvidenceResult;
  normalizedBatchText: string;
  recordedCount: number;
  importableCount: number;
  blockedCount: number;
  safety: {
    persistsCandidates: boolean;
    persistsLeads: boolean;
    sendsOutreach: boolean;
    spendsMoney: boolean;
    writesPreviewFiles: boolean;
    requiresRobertReview: boolean;
    blockedActions: string[];
  };
  nextAction: string;
  snapshot: RevenueSnapshot;
};

type RevenueMockupTemplatePack = {
  status: "ready" | "needs_spend_approval";
  pack: {
    name: string;
    niche: string;
    area: string;
    templateCount: number;
    targetPositioning: string;
  };
  costModel: {
    hostingCostUsd: number;
    paidAssetCostUsd: number;
    estimatedAiCostPerMockupUsd: number;
    dailyAiCostUsd: number;
    monthlyAiCostUsd: number;
    targetCostPerMockupUsd: number;
    monthlyCostCapUsd: number;
    insideZeroCostMode: boolean;
    insideMonthlyCap: boolean;
    spendPolicy: string;
  };
  productionTargets: {
    dailyMockupTarget: number;
    maxCustomMinutesPerMockup: number;
    productionMinutesPerDay: number;
    estimatedMockupsPerMonth: number;
    recommendedContactLimitPerDay: number;
  };
  templates: Array<{
    id: string;
    name: string;
    bestFor: string;
    blocks: string[];
    swapFields: string[];
    animationHooks: string[];
    assetPolicy: string;
    automationUpsell: string;
    qualityGate: string;
  }>;
  productionLine: Array<{ step: string; ownerAgent: string; output: string }>;
  pricingRecommendation: {
    entryMockupWebsiteUsd: number;
    proWebsiteUsd: number;
    automationBundleUsd: number;
    monthlyRetainerUsd: number;
    note: string;
  };
  guardrails: string[];
  nextActions: string[];
};

type AutomationOpportunityResult = {
  opportunity: RevenueSnapshot["recentAutomationOpportunities"][number];
  snapshot: RevenueSnapshot;
};

type AutomationIntakeConvertResult = {
  status: "converted" | "blocked" | "not_found";
  reason: string;
  intake: RevenueSnapshot["recentAutomationIntakes"][number] | null;
  opportunity: RevenueSnapshot["recentAutomationOpportunities"][number] | null;
  snapshot: RevenueSnapshot;
};

type AutomationAgentCommandResult = {
  status:
    | "needs_answers"
    | "quoted"
    | "opportunity_created"
    | "sale_blocked"
    | "sale_recorded"
    | "delivery_workspace_created"
    | "delivery_blocked";
  reason: string;
  intake: RevenueSnapshot["recentAutomationIntakes"][number];
  quote: AutomationQuote;
  opportunity: RevenueSnapshot["recentAutomationOpportunities"][number] | null;
  closeResult: {
    status: "recorded" | "blocked" | "not_found" | "already_recorded";
    reason: string;
    opportunity: RevenueSnapshot["recentAutomationOpportunities"][number] | null;
    entry: RevenueSnapshot["recentLedger"][number] | null;
    snapshot: RevenueSnapshot;
  } | null;
  workspaceResult: AutomationOpportunityDeliveryResult | null;
  blockedUntilAnswered: string[];
  nextActions: string[];
  snapshot: RevenueSnapshot;
};

type AutomationOpportunityDeliveryResult = {
  status: "created" | "blocked" | "not_found";
  reason: string;
  opportunity: RevenueSnapshot["recentAutomationOpportunities"][number] | null;
  workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number] | null;
  snapshot: RevenueSnapshot;
};

type WebsiteDeliveryHandoffResult = {
  status: "created" | "already_created" | "blocked" | "not_found";
  reason: string;
  lead: RevenueSnapshot["recentLeads"][number] | null;
  outreachDraft: RevenueSnapshot["recentOutreach"][number] | null;
  workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number] | null;
  snapshot: RevenueSnapshot;
};

type WebsiteOpportunityResult = {
  status: "quoted" | "already_sold" | "blocked";
  reason: string;
  opportunity: RevenueSnapshot["recentWebsiteOpportunities"][number] | null;
  gates: Array<{ gate: string; passed: boolean; fix: string }>;
  snapshot: RevenueSnapshot;
};

type WebsiteOpportunityCloseResult = {
  status: "sold" | "blocked";
  reason: string;
  opportunity: RevenueSnapshot["recentWebsiteOpportunities"][number] | null;
  lead: RevenueSnapshot["recentLeads"][number] | null;
  draft: RevenueSnapshot["recentOutreach"][number] | null;
  entry: RevenueLedgerResult["entry"] | null;
  snapshot: RevenueSnapshot;
};

type DeliveryWorkspaceQaUpdateResult = {
  status: "ready" | "needs_corrections" | "not_found";
  reason: string;
  workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number] | null;
  snapshot: RevenueSnapshot;
};

type DeliveryWorkspaceGithubHandoffResult = {
  status: "created" | "already_created" | "needs_repo" | "not_required" | "not_found" | "repo_mismatch" | "github_unavailable" | "invalid_request";
  reason?: string;
  developerHandoff?: {
    status: string;
    issueUrl?: string;
    repoFullName?: string;
    message: string;
  };
  workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number] | null;
  snapshot: RevenueSnapshot;
};

type DeliveryWorkspaceReleaseGateInput = {
  prUrl?: string;
  secondReviewEvidenceUrl?: string;
  appQaEvidenceUrl?: string;
  deploymentApprovalUrl?: string;
  secondReviewPassed?: boolean;
  appQaPassed?: boolean;
  robertApprovedDeploy?: boolean;
};

type DeliveryWorkspacePrStatusResult = {
  status: "ready" | "blocked" | "needs_pr" | "not_found" | "repo_mismatch" | "github_unavailable" | "invalid_request";
  reason?: string;
  prStatus?: {
    pr: {
      number: number;
      title: string;
      htmlUrl: string;
      state: string;
      draft: boolean;
      merged: boolean;
      baseRef: string;
      headRef: string;
      headSha: string;
      author: string;
      updatedAt: string | null;
    };
    checks: { total: number; passed: number; pending: number; failed: number };
    statuses: { total: number; passed: number; pending: number; failed: number; state: string };
    approvedReviews: Array<{ reviewer: string; htmlUrl: string; submittedAt: string | null }>;
    changesRequestedReviews: Array<{ reviewer: string; htmlUrl: string; submittedAt: string | null }>;
    secondReviewEvidenceUrl: string;
    appQaEvidenceUrl: string;
    blockers: string[];
    warnings: string[];
    readyForReleaseEvidence: boolean;
  };
  workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number] | null;
  snapshot: RevenueSnapshot;
};

type DeliveryWorkspaceAppQaGateResult = {
  status: "pass" | "blocked" | "not_found" | "repo_mismatch" | "branch_mismatch" | "github_unavailable" | "invalid_request";
  reason?: string;
  scan?: {
    summary: string;
    failCount: number;
    warnCount: number;
    subAgents: Array<{ name: string; status: string; summary: string }>;
  };
  gate?: {
    status: "pass" | "blocked";
    reasons: string[];
  };
  prStatus?: DeliveryWorkspacePrStatusResult["prStatus"];
  appQaEvidenceUrl?: string;
  appQaPrCommentBody?: string;
  safety?: {
    persistsReleaseGate: boolean;
    approvesDeployment: boolean;
    requiresPrCommentEvidence: boolean;
    requiresRobertApproval: boolean;
  };
  workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number] | null;
  snapshot: RevenueSnapshot;
};

type DeliveryWorkspaceDeliverResult = {
  status: "delivered" | "blocked" | "not_found";
  reason: string;
  workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number] | null;
  opportunity: RevenueSnapshot["recentAutomationOpportunities"][number] | null;
  handoff: {
    clientName: string;
    packageName: string;
    deliveredAt: string;
    supportPlan: string;
    requiredFollowUpMetrics: string[];
    notes: string;
  } | null;
  snapshot: RevenueSnapshot;
};

type DeliveryWorkspaceImprovementReviewResult = {
  status: "recorded" | "blocked" | "not_found";
  reason: string;
  workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number] | null;
  review: RevenueSnapshot["recentImprovementReviews"][number] | null;
  snapshot: RevenueSnapshot;
};

type AutomationOpportunityCloseResult = {
  status: "recorded" | "blocked" | "already_recorded" | "not_found";
  reason: string;
  opportunity: RevenueSnapshot["recentAutomationOpportunities"][number] | null;
  entry: RevenueLedgerResult["entry"] | null;
  snapshot: RevenueSnapshot;
};

type ImprovementReview = {
  input: {
    campaignName: string;
    periodLabel: string;
    leadsContacted: number;
    replies: number;
    callsBooked: number;
    dealsClosed: number;
    revenueCollectedUsd: number;
    spendUsd: number;
    estimatedInternalMonthlyCostUsd: number;
    hoursSaved: number;
    defectsFound: number;
    clientComplaints: number;
    bestOffer: string;
    biggestObjection: string;
    notes: string;
  };
  decision: {
    status: "pause_and_fix" | "scale_carefully" | "iterate_small_batch";
    reason: string;
    approvalMode: string;
  };
  metrics: {
    replyRate: number;
    bookingRate: number;
    closeRate: number;
    profitUsd: number;
    roiPercent: number;
    grossMarginPercent: number;
    costPerReplyUsd: number;
    costPerBookedCallUsd: number;
    insideSpendCap: boolean;
    profitable: boolean;
  };
  experiments: string[];
  playbookUpdates: string[];
  agentScorecard: Array<{
    agent: string;
    score: string;
    lesson: string;
  }>;
  nextBatch: {
    maxLeads: number;
    maxSpendUsd: number;
    requiredBeforeNextSend: string[];
  };
};

type ImprovementReviewResult = {
  review: RevenueSnapshot["recentImprovementReviews"][number];
  snapshot: RevenueSnapshot;
};

type RevenueLedgerResult = {
  entry: {
    id: string;
    createdAt: string;
    kind: "website_sale" | "automation_sale" | "bundle_sale" | "retainer" | "expense";
    clientName: string;
    amountUsd: number;
    cashCollectedUsd: number;
    estimatedInternalCostUsd: number;
    notes: string;
  } | null;
  snapshot: RevenueSnapshot;
  guardrail: {
    status: "ok" | "approval_required" | "blocked";
    reason: string;
  };
};

type RevenueExpensePreflightResult = {
  status: "approved" | "blocked";
  concept: string;
  amountUsd: number;
  estimatedInternalCostUsd: number;
  projected: {
    spendUsd: number;
    profitUsd: number;
    remainingCapUsd: number;
    cashCoverageUsd: number;
  };
  blockers: string[];
  nextAction: string;
  snapshot: RevenueSnapshot;
};

type RevenueLeadResult = {
  lead: RevenueSnapshot["recentLeads"][number];
  qualification: {
    score: number;
    grade: string;
    recommendedStatus: string;
    missing: string[];
    nextAgent: string;
    guardrail: string;
    outreachDraft: string;
  };
  snapshot: RevenueSnapshot;
};

type RevenueMockup = {
  input: {
    businessName: string;
    area: string;
    niche: string;
    websiteStatus: "no_website" | "weak_website" | "has_website" | "unknown";
    evidence: string;
    painPoint: string;
    primaryOffer: string;
    estimatedOfferUsd: number;
    includeAutomation: boolean;
  };
  decision: {
    status: "mockup_ready" | "needs_evidence";
    guardrail: string;
    nextAgent: string;
  };
  visualSystem: {
    accent: string;
    layout: string;
    motion: string;
    threeDSceneBrief: string[];
  };
  copy: {
    eyebrow: string;
    headline: string;
    subheadline: string;
    primaryCta: string;
    secondaryCta: string;
  };
  sections: Array<{
    id: string;
    title: string;
    goal: string;
    blocks: string[];
  }>;
  automations: string[];
  offer: {
    packageName: string;
    setupUsd: number;
    automationUsd: number;
    totalUsd: number;
    depositUsd: number;
    estimatedInternalCostUsd: number;
    insideCostCap: boolean;
  };
  qa: Array<{
    agent: string;
    check: string;
    result: string;
  }>;
  salesAngle: {
    problem: string;
    pitch: string;
    comparison: string;
  };
};

type RevenueProjectPlan = {
  input: {
    clientName: string;
    projectType: "website" | "automation" | "bundle";
    packageName: string;
    setupUsd: number;
    monthlyRetainerUsd: number;
    estimatedInternalCostUsd: number;
    depositPaid: boolean;
    scopeApproved: boolean;
    publicDataVerified: boolean;
    includesAutomation: boolean;
    launchTargetDays: number;
    clientRequest: string;
  };
  decision: {
    status: "ready_to_build" | "needs_scope" | "blocked";
    missing: string[];
    mode: string;
    reason: string;
  };
  budget: {
    setupUsd: number;
    requiredDepositUsd: number;
    monthlyRetainerUsd: number;
    estimatedInternalCostUsd: number;
    grossMarginUsd: number;
    grossMarginPercent: number;
    insideCostCap: boolean;
  };
  phases: Array<{
    id: string;
    name: string;
    ownerAgent: string;
    days: number;
    tasks: string[];
  }>;
  subagentCorrections: Array<{
    agent: string;
    corrects: string;
  }>;
  deliveryGates: Array<{
    gate: string;
    passed: boolean;
    fix: string;
  }>;
  doneDefinition: string[];
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function slugifyClientBranchValue(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "client";
}

function isGithubRepoFullName(value: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.trim());
}

function isCodexBranchName(value: string) {
  return /^codex\/[A-Za-z0-9._/-]+$/.test(value.trim());
}

function buildCopyableGithubHandoffRequest(workspaceId: string, repoFullName: string, branchName: string) {
  const trimmedRepoFullName = repoFullName.trim();
  const trimmedBranchName = branchName.trim();
  return JSON.stringify({
    workspaceId,
    ...(isGithubRepoFullName(trimmedRepoFullName) ? { repoFullName: trimmedRepoFullName } : {}),
    ...(isCodexBranchName(trimmedBranchName) ? { branchName: trimmedBranchName } : {}),
  }, null, 2);
}

function buildCopyableReleaseGateRequest(
  workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number],
  releaseGateInput: Required<DeliveryWorkspaceReleaseGateInput>,
) {
  const branchName = workspace.input.branchName || workspace.codexBuildHandoff.branchName;
  return JSON.stringify({
    workspaceId: workspace.id,
    repoFullName: workspace.input.repoFullName || workspace.codexBuildHandoff.repoFullName,
    branchName,
    githubIssueUrl: workspace.input.githubIssueUrl || workspace.codexBuildHandoff.githubIssueUrl,
    prUrl: releaseGateInput.prUrl,
    secondReviewStatus: releaseGateInput.secondReviewPassed ? "pass" : workspace.input.secondReviewStatus,
    secondReviewEvidenceUrl: releaseGateInput.secondReviewEvidenceUrl,
    appQaStatus: releaseGateInput.appQaPassed ? "pass" : workspace.input.appQaStatus,
    appQaEvidenceUrl: releaseGateInput.appQaEvidenceUrl,
    deploymentApprovalStatus: releaseGateInput.robertApprovedDeploy ? "approved" : workspace.input.deploymentApprovalStatus,
    deploymentApprovalUrl: releaseGateInput.deploymentApprovalUrl,
    releaseGateHeadSha: workspace.input.releaseGateHeadSha || workspace.codexBuildHandoff.releaseGateHeadSha,
    notes: `Robert release gate from Revenue Engine for workspace ${workspace.id}, branch ${branchName}, client ${workspace.input.clientName}. second review=${releaseGateInput.secondReviewPassed ? "pass" : "pending"} app qa=${releaseGateInput.appQaPassed ? "pass" : "pending"} Robert approval=${releaseGateInput.robertApprovedDeploy ? "approved" : "pending"}.`,
  }, null, 2);
}

const genericPaymentEvidence = new Set([
  "paid",
  "cash",
  "deposit",
  "payment",
  "received",
  "collected",
  "paid cash",
  "cash paid",
  "deposit paid",
  "payment received",
  "robert confirmed deposit",
]);

function normalizePaymentEvidence(value: string) {
  return value
    .toLowerCase()
    .replace(/[$,]/g, "")
    .replace(/[^\p{L}\p{N}_\- ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasVerifiablePaymentEvidence(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 8) return false;

  const normalized = normalizePaymentEvidence(trimmed);
  if (genericPaymentEvidence.has(normalized)) return false;
  if (/^(paid|cash|deposit|payment|received|collected)\s+\$?\d+(\.\d{1,2})?$/.test(normalized)) return false;
  if (/\b(?:pi|ch)_[a-z0-9]{6,}\b/i.test(trimmed)) return true;

  const lower = trimmed.toLowerCase();
  const hasPaymentProvider = /\b(zelle|venmo|cashapp|cash app|paypal|stripe|square|clover|ach|wire|bank transfer)\b/.test(lower);
  const hasReferenceLabel = /\b(ref|reference|receipt|invoice|txn|transaction|confirmation|confirmacion|comprobante|payment id|charge id)\b/.test(lower);
  const normalizedTokens = normalized.split(" ");
  const hasSpecificToken = /\b\d{3,}\b/.test(normalized)
    || normalizedTokens.some((token) => token.length >= 6 && /[a-z]/.test(token) && /\d/.test(token))
    || /\b[a-z]{2,}[-_][a-z0-9][a-z0-9_-]{2,}\b/i.test(trimmed);

  return hasSpecificToken && (hasPaymentProvider || hasReferenceLabel);
}

function statusTone(status: string) {
  if (status === "pass") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "ready") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (["contact", "collect", "build", "sell", "sprint"].includes(status)) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "search") return "border-sky-500/40 bg-sky-500/10 text-sky-200";
  if (status === "waiting") return "border-zinc-500/40 bg-zinc-500/10 text-zinc-200";
  if (status === "ready_to_deliver") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "needs_fix") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "block") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (status === "blocked") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (status === "pause_and_fix") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (status === "pause") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (status === "collect_first") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "scale_carefully") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "ready_to_start") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "ready_for_money_mode") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "ready_for_first_sprint") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "dry_run_research_only") return "border-cyan-500/40 bg-cyan-500/10 text-cyan-200";
  if (status === "ready_to_import") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "ready_for_preview") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "ready_for_qa") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "needs_pr") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "not_required") return "border-zinc-700 bg-zinc-900 text-zinc-300";
  if (status === "needs_spend_approval") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "needs_review") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "needs_lead_evidence") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "empty") return "border-zinc-500/40 bg-zinc-500/10 text-zinc-200";
  if (status === "pending_allowed") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "iterate_small_batch") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "sent") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "failed") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (status === "provider_missing") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "draft") return "border-zinc-500/40 bg-zinc-500/10 text-zinc-200";
  if (status === "review") return "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200";
  if (status === "active") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "approval_required") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  return "border-sky-500/40 bg-sky-500/10 text-sky-200";
}

function StatCard({
  label,
  value,
  icon: Icon,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof BadgeDollarSign;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-950/80">
      <CardContent className="flex min-h-[112px] items-center gap-4 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black">
          <Icon className="h-5 w-5 text-zinc-200" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-zinc-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
          <p className="mt-1 text-xs text-zinc-500">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RevenueEnginePage() {
  const [area, setArea] = useState("Miami");
  const [niche, setNiche] = useState("restaurants");
  const [offerFocus, setOfferFocus] = useState<"websites" | "automations" | "both">("both");
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState(100);
  const [leadCount, setLeadCount] = useState(20);
  const [scoutingArea, setScoutingArea] = useState("Miami");
  const [scoutingNiche, setScoutingNiche] = useState("med spas");
  const [scoutingOfferFocus, setScoutingOfferFocus] = useState<"websites" | "automations" | "both">("both");
  const [scoutingTargetLeadCount, setScoutingTargetLeadCount] = useState(25);
  const [scoutingPaidSpendUsd, setScoutingPaidSpendUsd] = useState(0);
  const [scoutingRequireNoWebsite, setScoutingRequireNoWebsite] = useState(true);
  const [scoutingIncludeWeakWebsite, setScoutingIncludeWeakWebsite] = useState(true);
  const [leadRadarDailyResearchTarget, setLeadRadarDailyResearchTarget] = useState(120);
  const [leadRadarMockupLimit, setLeadRadarMockupLimit] = useState(8);
  const [leadRadarContactLimit, setLeadRadarContactLimit] = useState(10);
  const [includeLeadInMoneySprint, setIncludeLeadInMoneySprint] = useState(false);
  const [seedLeadBatchText, setSeedLeadBatchText] = useState("");
  const [publicScoutEvidenceText, setPublicScoutEvidenceText] = useState("");
  const [publicScoutConnectorName, setPublicScoutConnectorName] = useState("browser-public-scout");
  const [publicScoutConnectorRunId, setPublicScoutConnectorRunId] = useState("daily-run-001");
  const [publicScoutConnectorResultsJson, setPublicScoutConnectorResultsJson] = useState(
    JSON.stringify(
      [
        {
          businessName: "No Site Cafe",
          area: "Miami",
          niche: "coffee shop",
          websiteStatus: "no_website",
          contactName: "Owner",
          recipientEmail: "owner@example.com",
          sourceUrl: "https://instagram.com/nositecafe",
          evidence: "Instagram activo, no website en bio, menu solo en posts publicos.",
          painPoint: "Necesita menu online, captura de catering y follow-up.",
        },
      ],
      null,
      2,
    ),
  );
  const [selectedDailyScoutTaskId, setSelectedDailyScoutTaskId] = useState("");
  const [candidatePublicEvidenceVerified, setCandidatePublicEvidenceVerified] = useState(false);
  const [candidateApprovalToImport, setCandidateApprovalToImport] = useState(false);
  const [candidateRobertApprovedImport, setCandidateRobertApprovedImport] = useState(false);
  const [approvalAction, setApprovalAction] = useState("Aprobar siguiente draft interno sin gasto externo");
  const [approvalNotes, setApprovalNotes] = useState("Decision manual de Robert para memoria del agente.");
  const [selectedApprovalTargetId, setSelectedApprovalTargetId] = useState("");
  const [approvalDecisionValue, setApprovalDecisionValue] = useState<"approved" | "rejected" | "needs_changes">("approved");
  const [approvalMaxSpendUsd, setApprovalMaxSpendUsd] = useState(0);
  const [automationBusinessName, setAutomationBusinessName] = useState("Prospect Restaurant");
  const [automationIndustry, setAutomationIndustry] = useState("restaurant");
  const [automationRequest, setAutomationRequest] = useState("Quiero automatizar seguimiento de leads, reservas y mensajes para que nadie se pierda.");
  const [automationTools, setAutomationTools] = useState("Google Sheets, Instagram DM, email");
  const [automationMonthlyBudgetUsd, setAutomationMonthlyBudgetUsd] = useState(500);
  const [automationUrgency, setAutomationUrgency] = useState<"this_week" | "this_month" | "flexible">("this_month");
  const [automationOpportunityStatus, setAutomationOpportunityStatus] = useState<"intake" | "quoted" | "approved" | "sold" | "in_delivery" | "delivered" | "blocked">("intake");
  const [automationScopeApproved, setAutomationScopeApproved] = useState(false);
  const [automationDepositPaid, setAutomationDepositPaid] = useState(false);
  const [automationLifecycleTarget, setAutomationLifecycleTarget] = useState<"quote" | "opportunity" | "sale" | "delivery">("opportunity");
  const [automationCashCollectedUsd, setAutomationCashCollectedUsd] = useState(0);
  const [automationPaymentConfirmation, setAutomationPaymentConfirmation] = useState("");
  const [automationIntakeAnswers, setAutomationIntakeAnswers] = useState("Trigger, accion, herramienta actual y resultado esperado del cliente.");
  const [reviewProjectName, setReviewProjectName] = useState("Prospect Restaurant launch");
  const [reviewProjectType, setReviewProjectType] = useState<"website" | "automation" | "bundle">("bundle");
  const [reviewSetupPriceUsd, setReviewSetupPriceUsd] = useState(3500);
  const [reviewRetainerUsd, setReviewRetainerUsd] = useState(500);
  const [reviewCostUsd, setReviewCostUsd] = useState(54);
  const [reviewChecks, setReviewChecks] = useState({
    clientApprovedScope: false,
    depositPaid: false,
    publicDataVerified: false,
    responsiveChecked: false,
    linksChecked: false,
    automationTested: false,
    rollbackPlanReady: false,
    clientHandoffReady: false,
  });
  const [websiteOpportunityScopeApprovals, setWebsiteOpportunityScopeApprovals] = useState<Record<string, boolean>>({});
  const [websiteOpportunityCloseInputs, setWebsiteOpportunityCloseInputs] = useState<Record<string, {
    cashCollectedUsd?: string;
    paymentConfirmation?: string;
    notes?: string;
  }>>({});
  const [websiteDeliveryRepoInputs, setWebsiteDeliveryRepoInputs] = useState<Record<string, {
    repoFullName?: string;
    branchName?: string;
  }>>({});
  const requestDepositPaymentConfirmation = (businessName: string, amountUsd: number) => {
    const value = window.prompt(
      `Referencia verificable de pago para ${businessName} (${money.format(amountUsd)}): Stripe payment id, Zelle/bank ref, invoice/receipt id.`,
    )?.trim() || "";
    return hasVerifiablePaymentEvidence(value) ? value : null;
  };
  const automationHasPaymentConfirmation = hasVerifiablePaymentEvidence(automationPaymentConfirmation);
  const automationCloseRequiresPaymentEvidence = automationCashCollectedUsd > 0 || automationLifecycleTarget === "sale" || automationLifecycleTarget === "delivery";
  const automationOpportunityRequiresPaymentEvidence = automationDepositPaid || ["sold", "in_delivery", "delivered"].includes(automationOpportunityStatus);
  const automationAgentPaymentBlocked = automationCloseRequiresPaymentEvidence && !automationHasPaymentConfirmation;
  const automationOpportunityPaymentBlocked = automationOpportunityRequiresPaymentEvidence && !automationHasPaymentConfirmation;
  const [reviewRepoFullName, setReviewRepoFullName] = useState("");
  const [releaseGateInputsByWorkspace, setReleaseGateInputsByWorkspace] = useState<Record<string, DeliveryWorkspaceReleaseGateInput>>({});
  const [reviewNotes, setReviewNotes] = useState("Pre-launch review before sending client preview or turning automations on.");
  const [proposalRecipientEmail, setProposalRecipientEmail] = useState("");
  const [proposalContactName, setProposalContactName] = useState("Robert");
  const [proposalBusinessName, setProposalBusinessName] = useState("Black Room");
  const [proposalSourceUrl, setProposalSourceUrl] = useState("https://blackroomus.com");
  const [proposalSummary, setProposalSummary] = useState(
    [
      "BLACK ROOM | Miami Techno",
      "Miami Techno Community",
      "Sections: Events, Videos, Shop, Calendar, Residents, Academy",
      "Highlights: Upcoming, Black Room Radio, Live From Events, Shop",
      "Positioning: Worldwide Techno Movement",
      "Proof: 200+ artists, 7 countries, 10 cities",
      "Current offer: techno events in Miami, videos/radio, merch, newsletter, cart/checkout and social links",
    ].join("\n"),
  );
  const [proposalWebsitePriceUsd, setProposalWebsitePriceUsd] = useState(3500);
  const [proposalAutomationPriceUsd, setProposalAutomationPriceUsd] = useState(2500);
  const [proposalRetainerUsd, setProposalRetainerUsd] = useState(750);
  const [proposalInternalCostUsd, setProposalInternalCostUsd] = useState(54);
  const [proposalNotes, setProposalNotes] = useState("Nota: blackrooomus.com no resolvio DNS; se uso blackroomus.com como variante valida.");
  const [proposalCopied, setProposalCopied] = useState(false);
  const [outreachChannel, setOutreachChannel] = useState<"email" | "gmail" | "mailto" | "instagram" | "contact_form">("gmail");
  const [outreachApproved, setOutreachApproved] = useState(false);
  const [outreachMockupUrl, setOutreachMockupUrl] = useState("");
  const [improvementCampaignName, setImprovementCampaignName] = useState("Black Room test offer");
  const [improvementPeriodLabel, setImprovementPeriodLabel] = useState("semana 1");
  const [improvementLeadsContacted, setImprovementLeadsContacted] = useState(20);
  const [improvementReplies, setImprovementReplies] = useState(2);
  const [improvementCallsBooked, setImprovementCallsBooked] = useState(1);
  const [improvementDealsClosed, setImprovementDealsClosed] = useState(0);
  const [improvementRevenueCollectedUsd, setImprovementRevenueCollectedUsd] = useState(0);
  const [improvementSpendUsd, setImprovementSpendUsd] = useState(8);
  const [improvementInternalCostUsd, setImprovementInternalCostUsd] = useState(54);
  const [improvementHoursSaved, setImprovementHoursSaved] = useState(0);
  const [improvementDefectsFound, setImprovementDefectsFound] = useState(1);
  const [improvementClientComplaints, setImprovementClientComplaints] = useState(0);
  const [improvementBestOffer, setImprovementBestOffer] = useState("Website 3D Premium + Automation Sprint");
  const [improvementBiggestObjection, setImprovementBiggestObjection] = useState("Quieren ver un mockup antes de pagar deposito.");
  const [improvementNotes, setImprovementNotes] = useState("Primer batch pequeno para validar oferta antes de gastar mas.");
  const [ledgerKind, setLedgerKind] = useState<"website_sale" | "automation_sale" | "bundle_sale" | "retainer" | "expense">("bundle_sale");
  const [ledgerClientName, setLedgerClientName] = useState("Black Room");
  const [ledgerAmountUsd, setLedgerAmountUsd] = useState(6000);
  const [ledgerCashCollectedUsd, setLedgerCashCollectedUsd] = useState(3000);
  const [ledgerInternalCostUsd, setLedgerInternalCostUsd] = useState(64);
  const [ledgerNotes, setLedgerNotes] = useState("Website 3D Premium + Automation Sprint");
  const [leadBusinessName, setLeadBusinessName] = useState("No Site Cafe");
  const [leadArea, setLeadArea] = useState("Miami");
  const [leadNiche, setLeadNiche] = useState("coffee shop");
  const [leadWebsiteStatus, setLeadWebsiteStatus] = useState<"no_website" | "weak_website" | "has_website" | "unknown">("no_website");
  const [leadContactChannel, setLeadContactChannel] = useState<"email" | "phone" | "instagram" | "contact_form" | "unknown">("instagram");
  const [leadContactValue, setLeadContactValue] = useState("@nositecafe");
  const [leadEvidence, setLeadEvidence] = useState("Instagram activo, no website en bio, menu solo en posts.");
  const [leadPainPoint, setLeadPainPoint] = useState("Necesita menu online, captura de catering y follow-up.");
  const [leadEstimatedOfferUsd, setLeadEstimatedOfferUsd] = useState(2500);
  const [leadSourceUrl, setLeadSourceUrl] = useState("https://instagram.com/nositecafe");
  const [leadRecipientEmail, setLeadRecipientEmail] = useState("");
  const [leadContactName, setLeadContactName] = useState("Owner");
  const [leadBusinessSummary, setLeadBusinessSummary] = useState("Cafe activo en Miami con social profile, menu en posts y sin website dedicado.");
  const [mockupBusinessName, setMockupBusinessName] = useState("No Site Cafe");
  const [mockupArea, setMockupArea] = useState("Miami");
  const [mockupNiche, setMockupNiche] = useState("coffee shop");
  const [mockupWebsiteStatus, setMockupWebsiteStatus] = useState<"no_website" | "weak_website" | "has_website" | "unknown">("no_website");
  const [mockupEvidence, setMockupEvidence] = useState("Instagram activo, no website en bio, menu solo en posts.");
  const [mockupPainPoint, setMockupPainPoint] = useState("Necesita menu online, captura de catering y follow-up.");
  const [mockupPrimaryOffer, setMockupPrimaryOffer] = useState("Website 3D Premium + Automation Sprint");
  const [mockupEstimatedOfferUsd, setMockupEstimatedOfferUsd] = useState(3500);
  const [mockupIncludeAutomation, setMockupIncludeAutomation] = useState(true);
  const [templatePackNiche, setTemplatePackNiche] = useState("med spas");
  const [templatePackArea, setTemplatePackArea] = useState("Miami");
  const [templatePackDailyMockups, setTemplatePackDailyMockups] = useState(8);
  const [templatePackMinutes, setTemplatePackMinutes] = useState(18);
  const [templatePackAiCostUsd, setTemplatePackAiCostUsd] = useState(0);
  const [projectClientName, setProjectClientName] = useState("No Site Cafe");
  const [projectType, setProjectType] = useState<"website" | "automation" | "bundle">("bundle");
  const [projectPackageName, setProjectPackageName] = useState("Website 3D Premium + Automation Sprint");
  const [projectSetupUsd, setProjectSetupUsd] = useState(4725);
  const [projectRetainerUsd, setProjectRetainerUsd] = useState(750);
  const [projectInternalCostUsd, setProjectInternalCostUsd] = useState(54);
  const [projectDepositPaid, setProjectDepositPaid] = useState(false);
  const [projectScopeApproved, setProjectScopeApproved] = useState(false);
  const [projectDataVerified, setProjectDataVerified] = useState(false);
  const [projectIncludesAutomation, setProjectIncludesAutomation] = useState(true);
  const [projectLaunchTargetDays, setProjectLaunchTargetDays] = useState(7);
  const [projectClientRequest, setProjectClientRequest] = useState("Website premium con captura de leads y follow-up automatico.");
  const [agentBusinessName, setAgentBusinessName] = useState("Black Room");
  const [agentArea, setAgentArea] = useState("Miami");
  const [agentNiche, setAgentNiche] = useState("techno events");
  const [agentRequest, setAgentRequest] = useState("Crear website 3D, funnel de eventos, captura de leads y automatizacion de follow-up para sponsors, merch y compradores.");
  const [agentStage, setAgentStage] = useState<"lead_research" | "mockup" | "outreach" | "proposal" | "production" | "delivery" | "improvement">("production");
  const [agentProjectType, setAgentProjectType] = useState<"website" | "automation" | "bundle">("bundle");
  const [agentEstimatedOfferUsd, setAgentEstimatedOfferUsd] = useState(6700);
  const [agentInternalCostUsd, setAgentInternalCostUsd] = useState(54);
  const [agentMonthlyBudgetUsd, setAgentMonthlyBudgetUsd] = useState(100);
  const [agentCashCollectedUsd, setAgentCashCollectedUsd] = useState(0);
  const [agentApprovalToContact, setAgentApprovalToContact] = useState(false);
  const [agentApprovalToSpend, setAgentApprovalToSpend] = useState(false);
  const [agentApprovalToBuild, setAgentApprovalToBuild] = useState(false);

  const buildReleaseGateInput = (workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number]): Required<DeliveryWorkspaceReleaseGateInput> => {
    const stored = releaseGateInputsByWorkspace[workspace.id] || {};
    return {
      prUrl: stored.prUrl ?? (workspace.input.prUrl || workspace.codexBuildHandoff.prUrl || ""),
      secondReviewEvidenceUrl: stored.secondReviewEvidenceUrl ?? (workspace.input.secondReviewEvidenceUrl || workspace.codexBuildHandoff.secondReviewEvidenceUrl || ""),
      appQaEvidenceUrl: stored.appQaEvidenceUrl ?? (workspace.input.appQaEvidenceUrl || workspace.codexBuildHandoff.appQaEvidenceUrl || ""),
      deploymentApprovalUrl: stored.deploymentApprovalUrl ?? (workspace.input.deploymentApprovalUrl || workspace.codexBuildHandoff.deploymentApprovalUrl || ""),
      secondReviewPassed: stored.secondReviewPassed ?? (workspace.input.secondReviewStatus === "pass" || workspace.codexBuildHandoff.secondReviewStatus === "pass"),
      appQaPassed: stored.appQaPassed ?? (workspace.input.appQaStatus === "pass" || workspace.codexBuildHandoff.appQaStatus === "pass"),
      robertApprovedDeploy: stored.robertApprovedDeploy ?? (workspace.input.deploymentApprovalStatus === "approved" || workspace.codexBuildHandoff.deploymentApprovalStatus === "approved"),
    };
  };

  const updateReleaseGateInput = (workspaceId: string, patch: DeliveryWorkspaceReleaseGateInput) => {
    setReleaseGateInputsByWorkspace((current) => ({
      ...current,
      [workspaceId]: {
        ...current[workspaceId],
        ...patch,
      },
    }));
  };

  const { data: snapshot, isLoading, isError, refetch: refetchSnapshot } = useQuery<RevenueSnapshot>({
    queryKey: ["revenue-engine"],
    queryFn: async () => {
      const response = await fetch("/api/revenue-engine");
      if (!response.ok) throw new Error("No se pudo cargar Revenue Engine");
      return response.json();
    },
  });
  const approvalQueue = snapshot?.approvalQueueItems || [];
  const selectedApprovalQueueItem = approvalQueue.find((item) => item.id === selectedApprovalTargetId) || null;
  const approvalActionForSubmit = selectedApprovalQueueItem?.action || approvalAction;
  const activeScoutArea = snapshot?.latestDailyScoutSprint?.area || snapshot?.businessScoutQueue.area || scoutingArea;
  const activeScoutNiche = snapshot?.latestDailyScoutSprint?.niche || snapshot?.businessScoutQueue.niche || scoutingNiche;
  const activeScoutOfferFocus = snapshot?.latestDailyScoutSprint?.offerFocus || snapshot?.businessScoutQueue.offerFocus || scoutingOfferFocus;
  const activeScoutTarget = snapshot?.latestDailyScoutSprint?.targetRows || snapshot?.businessScoutQueue.dailyResearchTarget || scoutingTargetLeadCount;
  const dispatchScoutArea = snapshot?.businessScoutQueue.area || scoutingArea;
  const dispatchScoutNiche = snapshot?.businessScoutQueue.niche || scoutingNiche;
  const dispatchScoutOfferFocus = snapshot?.businessScoutQueue.offerFocus || scoutingOfferFocus;
  const dispatchScoutTarget = snapshot?.businessScoutQueue.dailyResearchTarget || scoutingTargetLeadCount;
  const selectedDailyScoutTask = snapshot?.latestDailyScoutSprint?.tasks.find((task) => task.taskId === selectedDailyScoutTaskId) || null;
  const selectedDailyScoutTaskHasOpenSlots = Boolean(selectedDailyScoutTask?.resultSlots.some((slot) => slot.status === "open"));
  const firstOpenDailyScoutTask = snapshot?.latestDailyScoutSprint?.tasks.find((task) => task.resultSlots.some((slot) => slot.status === "open")) || null;
  const activeScoutTask = selectedDailyScoutTaskHasOpenSlots
    ? selectedDailyScoutTask
    : firstOpenDailyScoutTask || snapshot?.latestDailyScoutSprint?.tasks[0] || null;
  const activeScoutSourceTaskId = activeScoutTask?.taskId || snapshot?.latestDailyScoutSprint?.id || "ui-scout-evidence";
  const latestDailyScoutSlotText = useMemo(() => (
    (activeScoutTask ? [activeScoutTask] : snapshot?.latestDailyScoutSprint?.tasks || [])
      .flatMap((task) => task.resultSlots.filter((slot) => slot.status === "open").map((slot) => slot.copyableEvidenceBlock))
      .join("\n\n") || ""
  ), [activeScoutTask, snapshot?.latestDailyScoutSprint]);
  const dailyMoneyRunPacket = snapshot?.dailyMoneyCommand.runPacket;
  const dailyMoneyRunRequest = useMemo(
    () => parseDailyMoneyRunRequest(dailyMoneyRunPacket?.copyableApiRequest),
    [dailyMoneyRunPacket?.copyableApiRequest],
  );
  const dailyMoneyRunIsSafeEndpoint = DAILY_MONEY_SAFE_RUN_ENDPOINTS.has(dailyMoneyRunPacket?.apiAction || "");
  const dailyMoneyRunHasPlaceholders = hasDailyMoneyRunPlaceholders(dailyMoneyRunPacket?.copyableApiRequest);
  const dailyMoneyRunBlockedReason = !dailyMoneyRunPacket
    ? "Cargando run packet."
    : snapshot?.dailyMoneyCommand.status === "blocked"
      ? "Daily Money Command esta bloqueado por guardrails."
      : !dailyMoneyRunIsSafeEndpoint
        ? "Este paso requiere aprobacion/evidencia manual; copia el request y completalo fuera del boton seguro."
        : dailyMoneyRunHasPlaceholders
          ? "El request todavia tiene placeholders."
          : !dailyMoneyRunRequest.ok
            ? dailyMoneyRunRequest.reason
            : "";
  const canRunDailyMoneyNextAction = Boolean(dailyMoneyRunPacket && dailyMoneyRunIsSafeEndpoint && !dailyMoneyRunHasPlaceholders && dailyMoneyRunRequest.ok && snapshot?.dailyMoneyCommand.status !== "blocked");

  useEffect(() => {
    if (approvalQueue.length === 0) {
      if (selectedApprovalTargetId) setSelectedApprovalTargetId("");
      return;
    }
    if (!selectedApprovalQueueItem) {
      const nextItem = approvalQueue[0];
      setSelectedApprovalTargetId(nextItem.id);
      setApprovalAction(nextItem.action);
    }
  }, [approvalQueue, selectedApprovalQueueItem, selectedApprovalTargetId]);

  const planMutation = useMutation<RevenuePlan>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, niche, offerFocus, monthlyBudgetUsd, leadCount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear el plan");
      return data;
    },
  });

  const scoutingMissionMutation = useMutation<RevenueScoutingMissionResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/scouting-mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: scoutingArea,
          niche: scoutingNiche,
          offerFocus: scoutingOfferFocus,
          targetLeadCount: scoutingTargetLeadCount,
          maxPaidDataSpendUsd: scoutingPaidSpendUsd,
          requireNoWebsiteSignal: scoutingRequireNoWebsite,
          includeWeakWebsiteLeads: scoutingIncludeWeakWebsite,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear la mision de scouting");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const dailyScoutSprintMutation = useMutation<RevenueDailyScoutSprintResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/daily-scout-sprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: dispatchScoutArea,
          niche: dispatchScoutNiche,
          offerFocus: dispatchScoutOfferFocus,
          targetLeadCount: dispatchScoutTarget,
          maxTasks: 5,
          resultSlotsPerTask: 2,
          maxPaidDataSpendUsd: 0,
          requireRobertApprovalToContact: true,
          notes: "Started from Revenue Engine UI.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo iniciar daily scout sprint");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const scoutDispatchMutation = useMutation<RevenueScoutDispatchResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/scout-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: dispatchScoutArea,
          niche: dispatchScoutNiche,
          offerFocus: dispatchScoutOfferFocus,
          targetLeadCount: dispatchScoutTarget,
          maxTasks: 5,
          resultSlotsPerTask: 2,
          maxPaidDataSpendUsd: 0,
          requireRobertApprovalToContact: true,
          notes: "Scout dispatch created from Revenue Engine UI.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo despachar scout agents");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const dailyMoneyRunMutation = useMutation<Record<string, unknown>, Error>({
    mutationFn: async () => {
      const apiAction = snapshot?.dailyMoneyCommand.runPacket.apiAction || "";
      const request = parseDailyMoneyRunRequest(snapshot?.dailyMoneyCommand.runPacket.copyableApiRequest);
      if (!DAILY_MONEY_SAFE_RUN_ENDPOINTS.has(apiAction)) {
        throw new Error("Este endpoint no esta habilitado para ejecucion segura desde Daily Money Command.");
      }
      if (hasDailyMoneyRunPlaceholders(snapshot?.dailyMoneyCommand.runPacket.copyableApiRequest)) {
        throw new Error("El request todavia tiene placeholders.");
      }
      if (!request.ok) {
        throw new Error(request.reason);
      }

      const response = await fetch(apiAction, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reason || data.error || "No se pudo correr la siguiente accion segura");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const leadRadarMutation = useMutation<RevenueLeadRadar>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/lead-radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: scoutingArea,
          niches: scoutingNiche,
          offerFocus: scoutingOfferFocus,
          runHoursPerDay: 24,
          dailyResearchTarget: leadRadarDailyResearchTarget,
          dailyQualifiedLeadLimit: scoutingTargetLeadCount,
          dailyMockupLimit: leadRadarMockupLimit,
          dailyContactLimit: leadRadarContactLimit,
          maxPaidDataSpendUsd: scoutingPaidSpendUsd,
          requireRobertApprovalToContact: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear el radar de leads");
      return data;
    },
  });

  const buildMoneySprintPayload = () => {
    const seedLeadReady = Boolean(
      includeLeadInMoneySprint
      && leadBusinessName.trim()
      && leadArea.trim()
      && leadNiche.trim()
      && leadEvidence.trim().length >= 12
      && leadPainPoint.trim()
      && leadContactChannel !== "unknown"
      && leadContactValue.trim()
    );
    const seedLeads = seedLeadReady
      ? [{
        businessName: leadBusinessName,
        area: leadArea,
        niche: leadNiche,
        websiteStatus: leadWebsiteStatus,
        contactChannel: leadContactChannel,
        contactValue: leadContactValue,
        evidence: leadEvidence,
        painPoint: leadPainPoint,
        estimatedOfferUsd: leadEstimatedOfferUsd,
        status: "research",
        sourceUrl: leadSourceUrl,
        recipientEmail: leadRecipientEmail,
        contactName: leadContactName,
        businessSummary: leadBusinessSummary,
      }]
      : [];

    return {
      area: activeScoutArea,
      niche: activeScoutNiche,
      offerFocus: activeScoutOfferFocus,
      dailyResearchTarget: Math.max(leadRadarDailyResearchTarget, activeScoutTarget),
      dailyQualifiedLeadLimit: activeScoutTarget,
      dailyMockupLimit: leadRadarMockupLimit,
      dailyContactLimit: leadRadarContactLimit,
      maxPaidDataSpendUsd: scoutingPaidSpendUsd,
      requireRobertApprovalToContact: true,
      writePreviewFiles: true,
      seedLeads,
      seedLeadBatchText,
    };
  };

  const moneySprintPreviewMutation = useMutation<RevenueMoneySprintPreview>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/money-sprint-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMoneySprintPayload()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo previsualizar money sprint");
      return data;
    },
  });

  const moneySprintMutation = useMutation<RevenueMoneySprint>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/money-sprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMoneySprintPayload()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo correr money sprint");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const publicCandidateSprintMutation = useMutation<RevenuePublicCandidateSprintResult>({
    mutationFn: async () => {
      const candidateIds = (snapshot?.publicLeadImportQueue.items || []).map((item) => item.candidateId);
      const readyCandidateCount = snapshot?.publicLeadImportQueue.readyCount || 0;
      const visibleCandidateIdsCoverReadyQueue = candidateIds.length >= readyCandidateCount;
      const response = await fetch("/api/revenue-engine/money-sprint/public-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: activeScoutArea,
          niche: activeScoutNiche,
          offerFocus: activeScoutOfferFocus,
          dailyResearchTarget: Math.max(leadRadarDailyResearchTarget, activeScoutTarget),
          dailyQualifiedLeadLimit: activeScoutTarget,
          dailyMockupLimit: leadRadarMockupLimit,
          dailyContactLimit: leadRadarContactLimit,
          maxPaidDataSpendUsd: scoutingPaidSpendUsd,
          requireRobertApprovalToContact: true,
          writePreviewFiles: true,
          candidateIds: visibleCandidateIdsCoverReadyQueue ? candidateIds : [],
          maxCandidates: Math.min(Math.max(readyCandidateCount, candidateIds.length, 1), 25),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo correr sprint con candidatos publicos");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const automationQuoteMutation = useMutation<AutomationQuote>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/automation-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: automationBusinessName,
          industry: automationIndustry,
          request: automationRequest,
          currentTools: automationTools,
          monthlyBudgetUsd: automationMonthlyBudgetUsd,
          urgency: automationUrgency,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cotizar la automatizacion");
      return data;
    },
  });

  const automationIntakeMutation = useMutation<{ intake: RevenueSnapshot["recentAutomationIntakes"][number]; snapshot: RevenueSnapshot }>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/automation-intakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: automationBusinessName,
          industry: automationIndustry,
          request: automationRequest,
          currentTools: automationTools,
          monthlyBudgetUsd: automationMonthlyBudgetUsd,
          urgency: automationUrgency,
          contactName: "",
          contactEmail: "",
          knownAnswers: "",
          source: "manual",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el intake de automatizacion");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const automationIntakeAnswerMutation = useMutation<{ status: "updated" | "not_found"; intake: RevenueSnapshot["recentAutomationIntakes"][number] | null; snapshot: RevenueSnapshot }, Error, string | undefined>({
    mutationFn: async (intakeId) => {
      const intake = intakeId
        ? snapshot?.recentAutomationIntakes?.find((item) => item.id === intakeId)
        : snapshot?.recentAutomationIntakes?.find((item) => item.status === "needs_answers") || snapshot?.recentAutomationIntakes?.[0];
      const response = await fetch("/api/revenue-engine/automation-intakes/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intakeId: intake?.id || "",
          answers: automationIntakeAnswers,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo responder el intake");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const automationAgentCommandMutation = useMutation<AutomationAgentCommandResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/automation-agent-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: automationBusinessName,
          industry: automationIndustry,
          request: automationRequest,
          currentTools: automationTools,
          monthlyBudgetUsd: automationMonthlyBudgetUsd,
          urgency: automationUrgency,
          contactName: "",
          contactEmail: "",
          knownAnswers: automationIntakeAnswers,
          source: "manual",
          createOpportunityIfClear: true,
          lifecycleTarget: automationLifecycleTarget,
          clientApprovedScope: automationScopeApproved,
          depositPaid: automationDepositPaid,
          cashCollectedUsd: automationCashCollectedUsd > 0 ? automationCashCollectedUsd : undefined,
          paymentConfirmation: automationPaymentConfirmation,
          createDeliveryWorkspaceIfSold: automationLifecycleTarget === "delivery",
          workspaceName: `${automationBusinessName} automation delivery`,
          publicDataVerified: reviewChecks.publicDataVerified,
          visualQaPassed: reviewChecks.responsiveChecked,
          technicalQaPassed: reviewChecks.linksChecked,
          automationQaPassed: reviewChecks.automationTested,
          clientHandoffReady: reviewChecks.clientHandoffReady,
          launchTargetDays: projectLaunchTargetDays,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo correr el agente de automatizacion");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const automationOpportunityMutation = useMutation<AutomationOpportunityResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/automation-opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: automationBusinessName,
          industry: automationIndustry,
          request: automationRequest,
          currentTools: automationTools,
          monthlyBudgetUsd: automationMonthlyBudgetUsd,
          urgency: automationUrgency,
          status: automationOpportunityStatus,
          clientApprovedScope: automationScopeApproved,
          depositPaid: automationDepositPaid,
          paymentConfirmation: automationPaymentConfirmation,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la oportunidad de automatizacion");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const automationIntakeConvertMutation = useMutation<AutomationIntakeConvertResult, Error, string>({
    mutationFn: async (intakeId) => {
      const response = await fetch("/api/revenue-engine/automation-intakes/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intakeId,
          status: automationOpportunityStatus,
          clientApprovedScope: automationScopeApproved,
          depositPaid: automationDepositPaid,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo convertir el intake");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const deliveryReviewMutation = useMutation<DeliveryReview>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/delivery-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: reviewProjectName,
          projectType: reviewProjectType,
          setupPriceUsd: reviewSetupPriceUsd,
          monthlyRetainerUsd: reviewRetainerUsd,
          estimatedInternalMonthlyCostUsd: reviewCostUsd,
          ...reviewChecks,
          notes: reviewNotes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo correr el QA de entrega");
      return data;
    },
  });

  const deliveryWorkspaceMutation = useMutation<{ workspace: RevenueSnapshot["recentDeliveryWorkspaces"][number]; snapshot: RevenueSnapshot }>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/delivery-workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceName: reviewProjectName,
          clientName: reviewProjectName.replace(/\s+(launch|delivery|entrega)$/i, "") || reviewProjectName,
          projectType: reviewProjectType,
          packageName: reviewProjectType === "automation" ? "Automation Sprint" : "Website 3D Premium + Automation Sprint",
          setupUsd: reviewSetupPriceUsd,
          monthlyRetainerUsd: reviewRetainerUsd,
          estimatedInternalCostUsd: reviewCostUsd,
          depositPaid: reviewChecks.depositPaid,
          scopeApproved: reviewChecks.clientApprovedScope,
          publicDataVerified: reviewChecks.publicDataVerified,
          includesAutomation: reviewProjectType !== "website",
          launchTargetDays: 7,
          clientRequest: reviewNotes,
          repoFullName: reviewRepoFullName,
          visualQaPassed: reviewChecks.responsiveChecked,
          technicalQaPassed: reviewChecks.linksChecked,
          automationQaPassed: reviewChecks.automationTested && reviewChecks.rollbackPlanReady,
          clientHandoffReady: reviewChecks.clientHandoffReady,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el delivery workspace");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const automationOpportunityDeliveryMutation = useMutation<AutomationOpportunityDeliveryResult, Error, string>({
    mutationFn: async (opportunityId) => {
      const response = await fetch("/api/revenue-engine/automation-opportunities/delivery-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId,
          workspaceName: "Delivery workspace",
          publicDataVerified: reviewChecks.publicDataVerified,
          visualQaPassed: reviewChecks.responsiveChecked,
          technicalQaPassed: reviewChecks.linksChecked,
          automationQaPassed: reviewChecks.automationTested && reviewChecks.rollbackPlanReady,
          clientHandoffReady: false,
          launchTargetDays: 7,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear workspace desde oportunidad");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const websiteDeliveryHandoffMutation = useMutation<WebsiteDeliveryHandoffResult, Error, RevenueSnapshot["websiteDeliveryHandoffQueue"]["items"][number]>({
    mutationFn: async (item) => {
      const repoInput = websiteDeliveryRepoInputs[item.opportunityId] || {};
      const repoFullName = (repoInput.repoFullName || "").trim();
      const branchName = (repoInput.branchName || item.suggestedBranchName || `codex/client-${slugifyClientBranchValue(item.businessName)}-website`).trim();
      const response = await fetch("/api/revenue-engine/website-delivery-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: item.leadId,
          outreachDraftId: item.outreachDraftId,
          websiteOpportunityId: item.opportunityId,
          mockupUrl: item.mockupUrl,
          repoFullName,
          branchName,
          projectType: item.projectType,
          depositPaid: item.cashCollectedUsd >= item.requiredDepositUsd,
          scopeApproved: true,
          cashCollectedUsd: item.cashCollectedUsd,
          publicDataVerified: reviewChecks.publicDataVerified,
          visualQaPassed: reviewChecks.responsiveChecked,
          technicalQaPassed: reviewChecks.linksChecked,
          automationQaPassed: reviewChecks.automationTested && reviewChecks.rollbackPlanReady,
          clientHandoffReady: false,
          launchTargetDays: projectLaunchTargetDays,
          notes: "Created from Revenue Engine website handoff queue.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear workspace desde lead");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const websiteOpportunityMutation = useMutation<WebsiteOpportunityResult, Error, RevenueSnapshot["websiteSalesPacketQueue"]["items"][number]>({
    mutationFn: async (item) => {
      const response = await fetch("/api/revenue-engine/website-opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: item.leadId,
          outreachDraftId: item.outreachDraftId,
          projectType: item.primaryOffer.includes("Automation") ? "bundle" : "website",
          notes: "Quoted from Revenue Engine website sales packet.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear oportunidad website");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const websiteOpportunityCloseMutation = useMutation<
    WebsiteOpportunityCloseResult,
    Error,
    {
      opportunity: RevenueSnapshot["websiteClosureQueue"]["items"][number];
      scopeApproved: boolean;
      cashCollectedUsd: number;
      paymentConfirmation: string;
      notes: string;
      recordDepositOutcome: boolean;
    }
  >({
    mutationFn: async ({ opportunity, scopeApproved, cashCollectedUsd, paymentConfirmation, notes, recordDepositOutcome }) => {
      if (recordDepositOutcome) {
        const outcomeResponse = await fetch("/api/revenue-engine/outreach-outcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftId: opportunity.sourceOutreachDraftId,
            outcome: "deposit_collected",
            outcomeRecordedByRobert: true,
            cashCollectedUsd,
            paymentConfirmation,
            notes: paymentConfirmation || notes || "Manual deposit recorded from website opportunity close.",
          }),
        });
        const outcomeData = await outcomeResponse.json();
        if (!outcomeResponse.ok || outcomeData.status === "blocked") {
          throw new Error(outcomeData.error || outcomeData.reason || "No se pudo registrar deposito manual");
        }
      }
      const response = await fetch("/api/revenue-engine/website-opportunities/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: opportunity.id,
          depositPaid: cashCollectedUsd > 0,
          scopeApproved,
          cashCollectedUsd,
          paymentConfirmation,
          notes: notes || "Closed from Revenue Engine website opportunity UI.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cerrar oportunidad website");
      return data;
    },
    onSuccess: (data) => {
      if (data.opportunity?.id) {
        setWebsiteOpportunityScopeApprovals((current) => {
          const next = { ...current };
          delete next[data.opportunity!.id];
          return next;
        });
        if (data.status === "sold") {
          setWebsiteOpportunityCloseInputs((current) => {
            const next = { ...current };
            delete next[data.opportunity!.id];
            return next;
          });
        }
      }
      refetchSnapshot();
    },
  });

  const automationOpportunityCloseMutation = useMutation<AutomationOpportunityCloseResult, Error, { opportunityId: string; cashCollectedUsd: number; paymentConfirmation: string }>({
    mutationFn: async ({ opportunityId, cashCollectedUsd, paymentConfirmation }) => {
      const response = await fetch("/api/revenue-engine/automation-opportunities/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId,
          cashCollectedUsd,
          paymentConfirmation,
          markScopeApproved: true,
          notes: "Registrado desde Revenue Engine opportunities.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar la venta");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const deliveryWorkspaceQaMutation = useMutation<DeliveryWorkspaceQaUpdateResult, Error, RevenueSnapshot["recentDeliveryWorkspaces"][number]>({
    mutationFn: async (workspace) => {
      const response = await fetch("/api/revenue-engine/delivery-workspaces/qa", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildDeliveryWorkspaceQaPayload(workspace, reviewChecks),
          repoFullName: reviewRepoFullName || workspace.input.repoFullName,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo revalidar el workspace");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const deliveryWorkspaceReleaseGateMutation = useMutation<DeliveryWorkspaceQaUpdateResult, Error, RevenueSnapshot["recentDeliveryWorkspaces"][number]>({
    mutationFn: async (workspace) => {
      const releaseGateInput = buildReleaseGateInput(workspace);
      const response = await fetch("/api/revenue-engine/delivery-workspaces/release-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildDeliveryWorkspaceQaPayload(workspace, reviewChecks),
          repoFullName: reviewRepoFullName || workspace.input.repoFullName,
          branchName: workspace.input.branchName || workspace.codexBuildHandoff.branchName,
          githubIssueUrl: workspace.input.githubIssueUrl,
          prUrl: releaseGateInput.prUrl,
          secondReviewStatus: releaseGateInput.secondReviewPassed ? "pass" : workspace.input.secondReviewStatus,
          secondReviewEvidenceUrl: releaseGateInput.secondReviewEvidenceUrl,
          appQaStatus: releaseGateInput.appQaPassed ? "pass" : workspace.input.appQaStatus,
          appQaEvidenceUrl: releaseGateInput.appQaEvidenceUrl,
          deploymentApprovalStatus: releaseGateInput.robertApprovedDeploy ? "approved" : workspace.input.deploymentApprovalStatus,
          deploymentApprovalUrl: releaseGateInput.deploymentApprovalUrl,
          notes: `Robert release gate from Revenue Engine for workspace ${workspace.id}, branch ${workspace.input.branchName || workspace.codexBuildHandoff.branchName}, client ${workspace.input.clientName}. second review=${releaseGateInput.secondReviewPassed ? "pass" : "pending"} app qa=${releaseGateInput.appQaPassed ? "pass" : "pending"} Robert approval=${releaseGateInput.robertApprovedDeploy ? "approved" : "pending"}.`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar release gate");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const deliveryWorkspacePrStatusMutation = useMutation<DeliveryWorkspacePrStatusResult, Error, RevenueSnapshot["recentDeliveryWorkspaces"][number]>({
    mutationFn: async (workspace) => {
      const releaseGateInput = buildReleaseGateInput(workspace);
      const response = await fetch("/api/revenue-engine/delivery-workspaces/pr-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          prUrl: releaseGateInput.prUrl,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reason || data.error || "No se pudo revisar el PR");
      return data;
    },
    onSuccess: (data) => {
      const workspaceId = data.workspace?.id;
      if (!workspaceId) return;
      const patch: DeliveryWorkspaceReleaseGateInput = {};
      if (data.prStatus?.pr.htmlUrl) patch.prUrl = data.prStatus.pr.htmlUrl;
      if (data.prStatus?.secondReviewEvidenceUrl) {
        patch.secondReviewEvidenceUrl = data.prStatus.secondReviewEvidenceUrl;
        patch.secondReviewPassed = true;
      }
      if (data.prStatus?.appQaEvidenceUrl) {
        patch.appQaEvidenceUrl = data.prStatus.appQaEvidenceUrl;
        patch.appQaPassed = true;
      }
      updateReleaseGateInput(workspaceId, patch);
    },
  });

  const deliveryWorkspaceAppQaGateMutation = useMutation<DeliveryWorkspaceAppQaGateResult, Error, RevenueSnapshot["recentDeliveryWorkspaces"][number]>({
    mutationFn: async (workspace) => {
      const releaseGateInput = buildReleaseGateInput(workspace);
      const response = await fetch("/api/revenue-engine/delivery-workspaces/app-qa-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          prUrl: releaseGateInput.prUrl,
          notify: false,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reason || data.error || "No se pudo correr App QA");
      return data;
    },
    onSuccess: (data) => {
      const workspaceId = data.workspace?.id;
      if (!workspaceId) return;
      const patch: DeliveryWorkspaceReleaseGateInput = {};
      if (data.prStatus?.pr.htmlUrl) patch.prUrl = data.prStatus.pr.htmlUrl;
      if (data.status === "pass" && data.appQaEvidenceUrl) {
        patch.appQaEvidenceUrl = data.appQaEvidenceUrl;
        patch.appQaPassed = true;
      }
      updateReleaseGateInput(workspaceId, patch);
    },
  });

  const deliveryWorkspaceGithubHandoffMutation = useMutation<DeliveryWorkspaceGithubHandoffResult, Error, RevenueSnapshot["recentDeliveryWorkspaces"][number]>({
    mutationFn: async (workspace) => {
      const response = await fetch("/api/revenue-engine/delivery-workspaces/github-handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          repoFullName: workspace.input.repoFullName,
          branchName: workspace.input.branchName || workspace.codexBuildHandoff.branchName,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reason || data.error || "No se pudo crear el handoff GitHub");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const deliveryWorkspaceDeliverMutation = useMutation<DeliveryWorkspaceDeliverResult, Error, RevenueSnapshot["recentDeliveryWorkspaces"][number]>({
    mutationFn: async (workspace) => {
      const response = await fetch("/api/revenue-engine/delivery-workspaces/trusted-deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildCopyableTrustedDeliverRequest(workspace),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo marcar entrega");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const deliveryWorkspaceImprovementMutation = useMutation<DeliveryWorkspaceImprovementReviewResult, Error, string>({
    mutationFn: async (workspaceId) => {
      const response = await fetch("/api/revenue-engine/delivery-workspaces/improvement-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          periodLabel: "post-delivery week 1",
          leadsContacted: 0,
          replies: 0,
          callsBooked: 0,
          dealsClosed: 0,
          hoursSaved: 1,
          defectsFound: 0,
          clientComplaints: 0,
          notes: "Review creada desde delivery workspace para alimentar el playbook antes del siguiente batch.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear la review de mejora");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const approvalDecisionMutation = useMutation<
    { decision: RevenueSnapshot["recentApprovalDecisions"][number]; snapshot: RevenueSnapshot },
    Error,
    RevenueSnapshot["approvalQueueItems"][number] | null
  >({
    mutationFn: async (queueItem) => {
      if (approvalQueue.length > 0 && !queueItem) {
        throw new Error("Selecciona un item de approval queue antes de registrar la decision");
      }
      const response = await fetch("/api/revenue-engine/approval-decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: queueItem?.id || "manual",
          targetType: queueItem?.source || "manual",
          decision: approvalDecisionValue,
          approvedAction: queueItem?.action || approvalAction,
          maxSpendUsd: approvalMaxSpendUsd,
          notes: approvalNotes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar la aprobacion");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const proposalEmailMutation = useMutation<ProposalEmail>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/proposal-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail: proposalRecipientEmail,
          contactName: proposalContactName,
          businessName: proposalBusinessName,
          sourceUrl: proposalSourceUrl || undefined,
          businessSummary: proposalSummary,
          websitePriceUsd: proposalWebsitePriceUsd,
          automationPriceUsd: proposalAutomationPriceUsd,
          monthlyRetainerUsd: proposalRetainerUsd,
          estimatedInternalMonthlyCostUsd: proposalInternalCostUsd,
          notes: proposalNotes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo generar la cotizacion");
      return data;
    },
    onSuccess: () => setProposalCopied(false),
  });

  const improvementReviewMutation = useMutation<ImprovementReviewResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/improvement-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignName: improvementCampaignName,
          periodLabel: improvementPeriodLabel,
          leadsContacted: improvementLeadsContacted,
          replies: improvementReplies,
          callsBooked: improvementCallsBooked,
          dealsClosed: improvementDealsClosed,
          revenueCollectedUsd: improvementRevenueCollectedUsd,
          spendUsd: improvementSpendUsd,
          estimatedInternalMonthlyCostUsd: improvementInternalCostUsd,
          hoursSaved: improvementHoursSaved,
          defectsFound: improvementDefectsFound,
          clientComplaints: improvementClientComplaints,
          bestOffer: improvementBestOffer,
          biggestObjection: improvementBiggestObjection,
          notes: improvementNotes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo revisar la mejora");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const outreachDraftMutation = useMutation<OutreachDraftResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/outreach-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: outreachChannel,
          approvalStatus: outreachApproved ? "approved" : "draft",
          mockupUrl: outreachMockupUrl || undefined,
          recipientEmail: proposalRecipientEmail,
          contactName: proposalContactName,
          businessName: proposalBusinessName,
          sourceUrl: proposalSourceUrl || undefined,
          businessSummary: proposalSummary,
          websitePriceUsd: proposalWebsitePriceUsd,
          automationPriceUsd: proposalAutomationPriceUsd,
          monthlyRetainerUsd: proposalRetainerUsd,
          estimatedInternalMonthlyCostUsd: proposalInternalCostUsd,
          notes: proposalNotes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el outreach");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const outreachApproveMutation = useMutation<OutreachApproveResult, Error, string>({
    mutationFn: async (draftId) => {
      const response = await fetch("/api/revenue-engine/outreach-drafts/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          approvedByRobert: true,
          notes: "Robert aprobo este draft para cola manual; no enviar automaticamente.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo aprobar el draft");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const outreachSendMutation = useMutation<OutreachSendResult, Error, string>({
    mutationFn: async (draftId) => {
      const response = await fetch("/api/revenue-engine/outreach-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          approvalToSend: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo enviar el outreach");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const outreachOutcomeMutation = useMutation<
    OutreachOutcomeResult,
    Error,
    { draftId: string; outcome: RevenueOutreachOutcome; cashCollectedUsd?: number; paymentConfirmation?: string; notes?: string }
  >({
    mutationFn: async ({ draftId, outcome, cashCollectedUsd = 0, paymentConfirmation = "", notes = "" }) => {
      const response = await fetch("/api/revenue-engine/outreach-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          outcome,
          outcomeRecordedByRobert: true,
          cashCollectedUsd,
          paymentConfirmation,
          notes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar el outcome");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const ledgerMutation = useMutation<RevenueLedgerResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: ledgerKind,
          clientName: ledgerClientName,
          amountUsd: ledgerAmountUsd,
          cashCollectedUsd: ledgerKind === "expense" ? 0 : ledgerCashCollectedUsd,
          estimatedInternalCostUsd: ledgerInternalCostUsd,
          notes: ledgerNotes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar la entrada");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const expensePreflightMutation = useMutation<RevenueExpensePreflightResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/expense-preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept: ledgerClientName,
          amountUsd: ledgerKind === "expense" ? ledgerAmountUsd : 0,
          estimatedInternalCostUsd: ledgerInternalCostUsd,
          notes: ledgerNotes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo revisar el gasto");
      return data;
    },
  });

  const leadMutation = useMutation<RevenueLeadResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: leadBusinessName,
          area: leadArea,
          niche: leadNiche,
          websiteStatus: leadWebsiteStatus,
          contactChannel: leadContactChannel,
          contactValue: leadContactValue,
          evidence: leadEvidence,
          painPoint: leadPainPoint,
          estimatedOfferUsd: leadEstimatedOfferUsd,
          status: "research",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar el lead");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const publicLeadCandidateMutation = useMutation<RevenuePublicLeadCandidateResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/public-lead-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: leadBusinessName,
          area: leadArea,
          niche: leadNiche,
          websiteStatus: leadWebsiteStatus,
          contactChannel: leadContactChannel,
          contactValue: leadContactValue,
          evidence: leadEvidence,
          painPoint: leadPainPoint,
          estimatedOfferUsd: leadEstimatedOfferUsd,
          status: "research",
          sourceUrl: leadSourceUrl,
          recipientEmail: leadRecipientEmail,
          contactName: leadContactName,
          businessSummary: leadBusinessSummary,
          verificationStatus: candidatePublicEvidenceVerified ? "verified_public" : "needs_review",
          publicEvidenceVerified: candidatePublicEvidenceVerified,
          approvalToImport: candidateApprovalToImport,
          approvedByRobert: candidateRobertApprovedImport,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar candidato publico");
      return data;
    },
    onSuccess: (data) => {
      setSeedLeadBatchText(data.importBatchText);
      setCandidateRobertApprovedImport(false);
      refetchSnapshot();
    },
  });

  const publicLeadCandidateApproveMutation = useMutation<RevenuePublicLeadCandidateApproveResult, Error, string>({
    mutationFn: async (candidateId) => {
      const response = await fetch("/api/revenue-engine/public-lead-candidates/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          approvedByRobert: true,
          publicEvidenceVerified: true,
          approvalToImport: true,
          notes: "Approved from Revenue Engine public candidate queue.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.reason || "No se pudo aprobar candidato publico");
      return data;
    },
    onSuccess: (data) => {
      if (data.importBatchText) setSeedLeadBatchText(data.importBatchText);
      refetchSnapshot();
    },
  });

  const publicLeadCandidateBatchMutation = useMutation<RevenuePublicLeadCandidateBatchResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/public-lead-candidates/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: activeScoutArea,
          niche: activeScoutNiche,
          batchText: seedLeadBatchText,
          sourceTaskId: activeScoutSourceTaskId,
          verificationStatus: candidatePublicEvidenceVerified ? "verified_public" : "needs_review",
          publicEvidenceVerified: candidatePublicEvidenceVerified,
          approvalToImport: candidateApprovalToImport,
          approvedByRobert: candidateRobertApprovedImport,
          notes: "Recorded from Revenue Engine batch candidates UI.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar batch publico");
      return data;
    },
    onSuccess: () => {
      setCandidateRobertApprovedImport(false);
      refetchSnapshot();
    },
  });

  const publicScoutEvidenceMutation = useMutation<RevenuePublicScoutEvidenceResult | RevenueDailyScoutSprintSubmitResult>({
    mutationFn: async () => {
      const hasActiveSprint = Boolean(snapshot?.latestDailyScoutSprint?.id);
      const response = await fetch(hasActiveSprint ? "/api/revenue-engine/daily-scout-sprint/submit" : "/api/revenue-engine/public-scout-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(hasActiveSprint ? { sprintId: snapshot?.latestDailyScoutSprint?.id, taskId: activeScoutSourceTaskId } : {}),
          area: activeScoutArea,
          niche: activeScoutNiche,
          evidenceText: publicScoutEvidenceText,
          missionId: snapshot?.latestDailyScoutSprint?.id || "",
          sourceTaskId: activeScoutSourceTaskId,
          verificationStatus: candidatePublicEvidenceVerified ? "verified_public" : "needs_review",
          publicEvidenceVerified: candidatePublicEvidenceVerified,
          approvalToImport: candidateApprovalToImport,
          approvedByRobert: candidateRobertApprovedImport,
          defaultOfferUsd: leadEstimatedOfferUsd,
          maxCandidates: Math.min(activeScoutTarget, 50),
          notes: "Normalized from Revenue Engine public scout evidence UI.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.reason || "No se pudo normalizar evidencia publica");
      return data;
    },
    onSuccess: (data) => {
      const evidenceResult = "evidenceResult" in data ? data.evidenceResult : data;
      setSeedLeadBatchText(evidenceResult?.normalizedBatchText || "");
      setCandidateRobertApprovedImport(false);
      refetchSnapshot();
    },
  });

  const publicScoutConnectorIntakeMutation = useMutation<RevenueVerifiedScoutConnectorIntakeResult>({
    mutationFn: async () => {
      const request = buildPublicScoutConnectorIntakeRequest(publicScoutConnectorResultsJson, {
        activeScoutArea,
        activeScoutNiche,
        missionId: snapshot?.latestDailyScoutSprint?.id || "",
        sourceTaskId: activeScoutSourceTaskId,
        connectorName: publicScoutConnectorName,
        connectorRunId: publicScoutConnectorRunId,
      });

      const response = await fetch(request.endpoint, request.init);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.reason || "No se pudo guardar connector intake");
      return data;
    },
    onSuccess: (data) => {
      refetchSnapshot();
    },
  });

  const publicScoutAgentCommandMutation = useMutation<RevenuePublicScoutAgentCommandResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/public-scout-agent-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: activeScoutArea,
          niche: activeScoutNiche,
          offerFocus: activeScoutOfferFocus,
          evidenceText: publicScoutEvidenceText,
          missionId: snapshot?.latestDailyScoutSprint?.id || "",
          sourceTaskId: activeScoutSourceTaskId,
          verificationStatus: candidatePublicEvidenceVerified ? "verified_public" : "needs_review",
          publicEvidenceVerified: candidatePublicEvidenceVerified,
          approvalToImport: candidateApprovalToImport,
          approvedByRobert: candidateRobertApprovedImport,
          defaultOfferUsd: leadEstimatedOfferUsd,
          maxCandidates: Math.min(activeScoutTarget, 50),
          dailyResearchTarget: Math.max(leadRadarDailyResearchTarget, activeScoutTarget),
          dailyQualifiedLeadLimit: activeScoutTarget,
          dailyMockupLimit: leadRadarMockupLimit,
          dailyContactLimit: leadRadarContactLimit,
          maxPaidDataSpendUsd: 0,
          requireRobertApprovalToContact: true,
          writePreviewFiles: true,
          runMoneySprintIfReady: true,
          maxSprintCandidates: Math.min(activeScoutTarget, 25),
          notes: "Executed from Revenue Engine public scout agent command UI.",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo correr scout agent command");
      return data;
    },
    onSuccess: (data) => {
      setSeedLeadBatchText(data.evidenceResult.normalizedBatchText);
      setCandidateRobertApprovedImport(false);
      refetchSnapshot();
    },
  });

  const mockupMutation = useMutation<RevenueMockup>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/mockup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: mockupBusinessName,
          area: mockupArea,
          niche: mockupNiche,
          websiteStatus: mockupWebsiteStatus,
          evidence: mockupEvidence,
          painPoint: mockupPainPoint,
          primaryOffer: mockupPrimaryOffer,
          estimatedOfferUsd: mockupEstimatedOfferUsd,
          includeAutomation: mockupIncludeAutomation,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear el mockup");
      return data;
    },
  });

  const mockupTemplatePackMutation = useMutation<RevenueMockupTemplatePack>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/mockup-template-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: templatePackNiche,
          area: templatePackArea,
          dailyMockupTarget: templatePackDailyMockups,
          maxCustomMinutesPerMockup: templatePackMinutes,
          estimatedAiCostPerMockupUsd: templatePackAiCostUsd,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear el template pack");
      return data;
    },
  });

  const projectPlanMutation = useMutation<RevenueProjectPlan>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/project-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: projectClientName,
          projectType,
          packageName: projectPackageName,
          setupUsd: projectSetupUsd,
          monthlyRetainerUsd: projectRetainerUsd,
          estimatedInternalCostUsd: projectInternalCostUsd,
          depositPaid: projectDepositPaid,
          scopeApproved: projectScopeApproved,
          publicDataVerified: projectDataVerified,
          includesAutomation: projectIncludesAutomation,
          launchTargetDays: projectLaunchTargetDays,
          clientRequest: projectClientRequest,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear el plan de produccion");
      return data;
    },
  });

  const agentRunMutation = useMutation<RevenueAgentRunResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/agent-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: agentBusinessName,
          area: agentArea,
          niche: agentNiche,
          request: agentRequest,
          stage: agentStage,
          projectType: agentProjectType,
          estimatedOfferUsd: agentEstimatedOfferUsd,
          estimatedInternalCostUsd: agentInternalCostUsd,
          monthlyBudgetUsd: agentMonthlyBudgetUsd,
          cashCollectedUsd: agentCashCollectedUsd,
          approvalToContact: agentApprovalToContact,
          approvalToSpend: agentApprovalToSpend,
          approvalToBuild: agentApprovalToBuild,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo correr el agente");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const salesAutopilotMutation = useMutation<RevenueSalesAutopilotResult>({
    mutationFn: async () => {
      const response = await fetch("/api/revenue-engine/sales-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: agentBusinessName,
          area: agentArea,
          niche: agentNiche,
          websiteStatus: leadWebsiteStatus,
          contactChannel: leadContactChannel,
          contactValue: leadContactValue,
          evidence: leadEvidence,
          painPoint: leadPainPoint,
          request: agentRequest,
          projectType: agentProjectType,
          estimatedOfferUsd: agentEstimatedOfferUsd,
          estimatedInternalCostUsd: agentInternalCostUsd,
          monthlyBudgetUsd: agentMonthlyBudgetUsd,
          cashCollectedUsd: agentCashCollectedUsd,
          recipientEmail: proposalRecipientEmail,
          contactName: proposalContactName,
          sourceUrl: proposalSourceUrl || "",
          businessSummary: proposalSummary,
          monthlyRetainerUsd: proposalRetainerUsd,
          approvalToContact: agentApprovalToContact,
          approvalToSpend: agentApprovalToSpend,
          approvalToBuild: agentApprovalToBuild,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo correr sales autopilot");
      return data;
    },
    onSuccess: () => {
      refetchSnapshot();
    },
  });

  const spendPercent = useMemo(() => {
    if (!snapshot?.metrics.monthlySpendCapUsd) return 0;
    return Math.min(100, Math.round((snapshot.metrics.estimatedSpendUsd / snapshot.metrics.monthlySpendCapUsd) * 100));
  }, [snapshot]);

  const plan = planMutation.data;
  const scoutingMission = scoutingMissionMutation.data?.mission;
  const automationQuote = automationQuoteMutation.data;
  const automationOpportunity = automationOpportunityMutation.data;
  const deliveryReview = deliveryReviewMutation.data;
  const proposalEmail = proposalEmailMutation.data;
  const outreachDraft = outreachDraftMutation.data;
  const improvementReview = improvementReviewMutation.data?.review;
  const agentRun = agentRunMutation.data;
  const salesAutopilot = salesAutopilotMutation.data;
  const activeAgentRun: RevenueAgentRunResult | undefined = agentRun || (
    salesAutopilot
      ? { run: salesAutopilot.agentRun, snapshot: salesAutopilot.snapshot }
      : undefined
  );
  const publicScoutEvidenceResult = publicScoutEvidenceMutation.data
    ? "evidenceResult" in publicScoutEvidenceMutation.data
      ? publicScoutEvidenceMutation.data.evidenceResult
      : publicScoutEvidenceMutation.data
    : null;
  const publicScoutEvidenceSummary = publicScoutEvidenceMutation.data
    ? "evidenceResult" in publicScoutEvidenceMutation.data
      ? publicScoutEvidenceMutation.data.reason
      : publicScoutEvidenceMutation.data.nextAction
    : "";
  const publicScoutEvidenceStatus = publicScoutEvidenceMutation.data?.status || "review";

  function toggleReviewCheck(key: keyof typeof reviewChecks) {
    setReviewChecks((current) => ({ ...current, [key]: !current[key] }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    planMutation.mutate();
  }

  async function copyProposalEmail() {
    if (!proposalEmail) return;
    await navigator.clipboard.writeText(`Subject: ${proposalEmail.subject}\n\n${proposalEmail.body}`);
    setProposalCopied(true);
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/tools">
              <Button variant="ghost" size="icon" data-testid="button-back-tools">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-black">
              <Rocket className="h-5 w-5 text-emerald-200" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-white">Revenue Engine</h1>
              <p className="text-sm text-zinc-500">Websites, automatizaciones, outreach y QA con control de margen.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
              Cap inicial {money.format(snapshot?.costPolicy.monthlyCapUsd || 100)}/mes
            </Badge>
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-200">
              Draft only
            </Badge>
          </div>
        </header>

        {isError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            No pude cargar el modulo. Revisa el servidor local.
          </div>
        )}

        <Card className="mb-6 border-sky-500/20 bg-zinc-950/90">
          <CardContent className="grid gap-4 p-4 xl:grid-cols-[1.2fr_0.8fr_0.8fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Gauge className="h-4 w-4 text-sky-200" />
                <p className="text-sm font-medium text-white">Consola Robert</p>
                <Badge variant="outline" className={cn(snapshot?.operatorConsole.canSpendNow ? statusTone("pass") : statusTone("approval_required"), "shrink-0")}>
                  {snapshot?.operatorConsole.canSpendNow ? "spend permitido" : "spend bloqueado"}
                </Badge>
              </div>
              <p className="mt-3 text-xl font-semibold leading-7 text-white">
                {snapshot?.operatorConsole.moneyLine || "Cargando ventas, cash y profit."}
              </p>
              <p className="mt-2 rounded-lg border border-sky-500/15 bg-sky-500/5 px-3 py-2 text-sm leading-6 text-sky-100">
                {snapshot?.operatorConsole.nextCommand || "Calculando la proxima accion rentable."}
              </p>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                {snapshot?.operatorConsole.spendPermission || "No gastar hasta que Profit Guard termine de cargar."}
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Puede hacer ahora</p>
              <div className="space-y-2">
                {(snapshot?.operatorConsole.allowedNow || ["research publico gratis"]).map((action) => (
                  <div key={action} className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                    {action}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Espera de Robert</p>
              <div className="space-y-2">
                {(snapshot?.operatorConsole.waitingOnRobert || ["aprobar mensaje antes de enviar"]).map((action) => (
                  <div key={action} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-100">
                    {action}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-cyan-500/20 bg-zinc-950/90">
          <CardContent className="grid gap-4 p-4 xl:grid-cols-[1fr_1fr_1fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Rocket className="h-4 w-4 text-cyan-200" />
                <p className="text-sm font-medium text-white">Activacion de dinero</p>
                <Badge variant="outline" className={cn(statusTone(snapshot?.moneyActivationPlan.status || "review"), "shrink-0")}>
                  {snapshot?.moneyActivationPlan.status || "loading"}
                </Badge>
              </div>
              <p className="mt-3 text-lg font-semibold leading-7 text-white">
                {snapshot?.moneyActivationPlan.headline || "Calculando modo de arranque."}
              </p>
              <p className="mt-2 rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-3 py-2 text-sm leading-6 text-cyan-100">
                {snapshot?.moneyActivationPlan.nextRobertAction || "Preparar research publico sin contacto externo."}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3 border-cyan-500/30 bg-black text-cyan-100 hover:bg-cyan-500/10"
                onClick={() => navigator.clipboard.writeText(snapshot?.moneyActivationPlan.copyableBrief || "")}
                data-testid="button-copy-money-activation-brief"
              >
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copiar brief
              </Button>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className={cn("rounded-md border px-3 py-2", snapshot?.moneyActivationPlan.canStartToday ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-100" : "border-red-500/20 bg-red-500/5 text-red-100")}>
                  Start {snapshot?.moneyActivationPlan.canStartToday ? "yes" : "no"}
                </div>
                <div className={cn("rounded-md border px-3 py-2", snapshot?.moneyActivationPlan.canContactBusinesses ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-100" : "border-amber-500/20 bg-amber-500/5 text-amber-100")}>
                  Contact {snapshot?.moneyActivationPlan.canContactBusinesses ? "yes" : "approval"}
                </div>
                <div className={cn("rounded-md border px-3 py-2", snapshot?.moneyActivationPlan.canCollectMoney ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-100" : "border-amber-500/20 bg-amber-500/5 text-amber-100")}>
                  Collect {snapshot?.moneyActivationPlan.canCollectMoney ? "approval" : "wait"}
                </div>
                <div className={cn("rounded-md border px-3 py-2", snapshot?.moneyActivationPlan.canBuildWebsites ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-100" : "border-zinc-800 bg-black text-zinc-300")}>
                  Build {snapshot?.moneyActivationPlan.canBuildWebsites ? "ready" : "wait"}
                </div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Puede hacer hoy</p>
              <div className="space-y-2">
                {(snapshot?.moneyActivationPlan.allowedToday || ["buscar negocios publicos"]).slice(0, 5).map((action) => (
                  <div key={action} className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                    {action}
                  </div>
                ))}
              </div>
              <p className="mt-3 mb-2 text-xs uppercase tracking-wide text-zinc-500">Primer sprint</p>
              <div className="rounded-lg border border-zinc-800 bg-black p-3">
                <p className="text-sm font-medium text-white">
                  {snapshot?.moneyActivationPlan.firstSprintPlan.title || "First revenue sprint"}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {snapshot?.moneyActivationPlan.firstSprintPlan.targetRows ?? 0} filas · {snapshot?.moneyActivationPlan.firstSprintPlan.nextApiAction || "/api/revenue-engine/scout-dispatch"}
                </p>
                <div className="mt-3 rounded-md border border-cyan-500/15 bg-cyan-500/5 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-cyan-100">Gate de evidencia</p>
                    <Badge variant="outline" className={cn(statusTone(snapshot?.moneyActivationPlan.evidenceGate.status || "review"), "shrink-0")}>
                      {snapshot?.moneyActivationPlan.evidenceGate.readyCandidates ?? 0} listos
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-cyan-100/80">
                    {snapshot?.moneyActivationPlan.evidenceGate.blockedCandidates ?? 0} bloqueados · {snapshot?.moneyActivationPlan.evidenceGate.nextAction || "Guardar candidatos con evidencia publica verificable."}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    Campos: {(snapshot?.moneyActivationPlan.evidenceGate.requiredFields || []).slice(0, 6).join(", ") || "business, sourceUrl, evidence"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3 border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-900"
                  onClick={() => navigator.clipboard.writeText(snapshot?.moneyActivationPlan.firstSprintPlan.copyableBrief || "")}
                  data-testid="button-copy-first-sprint-brief"
                >
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copiar sprint
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3 ml-2 border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                  onClick={() => navigator.clipboard.writeText(snapshot?.moneyActivationPlan.firstSprintPlan.copyableDispatchRequest || "")}
                  data-testid="button-copy-first-sprint-dispatch-request"
                >
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copiar dispatch
                </Button>
                <div className="mt-3 space-y-2">
                  {(snapshot?.moneyActivationPlan.firstSprintPlan.steps || []).map((step) => (
                    <div key={step.id} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-zinc-100">{step.label}</p>
                        {step.approvalRequired && (
                          <Badge variant="outline" className={cn(statusTone("approval_required"), "shrink-0")}>
                            approval
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{step.action}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3" data-testid="panel-revenue-path-to-paid-build">
                  <p className="text-xs font-medium uppercase tracking-wide text-emerald-100">Ruta a website cobrado</p>
                  <div className="mt-2 space-y-2">
                    {(snapshot?.moneyActivationPlan.firstSprintPlan.revenuePath || []).map((stage) => (
                      <div key={stage.id} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium text-white">{stage.label}</p>
                          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-100">
                            {stage.apiAction}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-zinc-400">{stage.output}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{stage.gate}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Checklist produccion</p>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3" data-testid="panel-production-launch-checklist">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline" className={cn(statusTone(snapshot?.moneyActivationPlan.productionLaunchChecklist.status || "blocked"), "shrink-0")}>
                    {snapshot?.moneyActivationPlan.productionLaunchChecklist.status || "blocked"}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 border-amber-500/30 bg-black text-xs text-amber-100 hover:bg-amber-500/10"
                    onClick={() => navigator.clipboard.writeText(snapshot?.moneyActivationPlan.productionLaunchChecklist.copyableChecklist || "")}
                    data-testid="button-copy-production-launch-checklist"
                  >
                    <Copy className="mr-1.5 h-3 w-3" />
                    Copy
                  </Button>
                </div>
                <div className="mt-3 space-y-2">
                  {(snapshot?.moneyActivationPlan.productionLaunchChecklist.requiredEvidence || []).slice(0, 4).map((item) => (
                    <div key={item.id} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-amber-100">{item.label}</p>
                        <Badge variant="outline" className={cn(statusTone(item.status), "shrink-0 text-[10px]")}>
                          {item.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-md border border-zinc-800 bg-black px-3 py-2" data-testid="panel-deployment-approval-packet">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-amber-100">Deploy approval packet</p>
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-100">
                      {snapshot?.moneyActivationPlan.productionLaunchChecklist.deploymentApprovalPacket.status || "waiting"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-400">
                    {snapshot?.moneyActivationPlan.productionLaunchChecklist.deploymentApprovalPacket.deployApprovalAsk || "Esperando evidencia PR/QA/rollback."}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    Rollback: {snapshot?.moneyActivationPlan.productionLaunchChecklist.deploymentApprovalPacket.rollbackPlan || "Pendiente"}
                  </p>
                </div>
                <div className="mt-3 rounded-md border border-cyan-500/20 bg-cyan-500/5 px-3 py-2" data-testid="panel-production-setup-packet">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-cyan-100">
                      {snapshot?.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.title || "Production setup packet"}
                    </p>
                    <Badge variant="outline" className={cn(statusTone(snapshot?.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.status || "blocked"), "shrink-0 text-[10px]")}>
                      {snapshot?.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.status || "blocked"}
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-2">
                    {(snapshot?.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.requiredEnv || []).slice(0, 2).map((item) => (
                      <div key={item.key} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium text-white">{item.key}</p>
                          <Badge variant="outline" className={cn(statusTone(item.status), "shrink-0 text-[10px]")}>
                            {item.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">{item.nextStep}</p>
                        <p className="mt-1 font-mono text-[11px] leading-5 text-cyan-100/80">{item.verifyCommand}</p>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3 h-7 border-cyan-500/30 bg-black text-xs text-cyan-100 hover:bg-cyan-500/10"
                    onClick={() => navigator.clipboard.writeText(snapshot?.moneyActivationPlan.productionLaunchChecklist.productionSetupPacket.copyableSetupPacket || "")}
                    data-testid="button-copy-production-setup-packet"
                  >
                    <Copy className="mr-1.5 h-3 w-3" />
                    Copy setup
                  </Button>
                </div>
              </div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Falta para money mode real</p>
              <div className="space-y-2">
                {(snapshot?.moneyActivationPlan.missingBeforeRealMoney || []).slice(0, 4).map((item) => (
                  <div key={item.id} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                    <p className="text-sm font-medium text-amber-100">{item.label}</p>
                    <p className="mt-1 text-xs leading-5 text-amber-100/80">{item.nextStep}</p>
                  </div>
                ))}
                {snapshot?.moneyActivationPlan.missingBeforeRealMoney.length === 0 && (
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                    Sin bloqueos de activacion.
                  </div>
                )}
              </div>
              <p className="mt-3 mb-2 text-xs uppercase tracking-wide text-zinc-500">Bloqueado hasta aprobar</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(snapshot?.moneyActivationPlan.blockedUntilApproved || []).slice(0, 6).map((item) => (
                  <div key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs leading-5 text-zinc-300">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-emerald-500/20 bg-zinc-950/90">
          <CardContent className="grid gap-4 p-4 xl:grid-cols-[260px_1fr_360px]">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-200" />
                <p className="text-sm font-medium text-white">Launch readiness</p>
              </div>
              <p className="mt-3 text-4xl font-semibold text-white">{snapshot?.launchReadiness.launchScore ?? 0}%</p>
              <Badge variant="outline" className={cn("mt-3", statusTone(snapshot?.launchReadiness.status || "review"))}>
                {snapshot?.launchReadiness.status || "loading"}
              </Badge>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                {snapshot?.launchReadiness.summary || "Calculando si podemos empezar a vender."}
              </p>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                {snapshot?.launchReadiness.market.niche || "Nicho"} · {snapshot?.launchReadiness.market.area || "Area"} · sprint {snapshot?.launchReadiness.market.firstSprintDays || 7} dias
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Plan para arrancar</p>
              <div className="grid gap-2 md:grid-cols-2">
                {(snapshot?.launchReadiness.manualStartPlan || []).map((step) => (
                  <div key={step} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm leading-6 text-zinc-300">
                    {step}
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-emerald-100">Paquete ejecutable de hoy</p>
                    <p className="mt-1 text-xs leading-5 text-emerald-100/80">
                      {snapshot?.launchReadiness.todayExecutionPack?.mission || "Buscar negocios publicos con evidencia verificable."}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn(statusTone(snapshot?.launchReadiness.todayExecutionPack?.status || "review"), "shrink-0")}>
                    {snapshot?.launchReadiness.todayExecutionPack?.status || "review"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Owner {snapshot?.launchReadiness.todayExecutionPack?.ownerAgent || "lead-scout"}
                </p>
                <p className="mt-3 rounded-md border border-black/30 bg-black/40 px-3 py-2 text-xs leading-5 text-zinc-300">
                  {snapshot?.launchReadiness.todayExecutionPack?.copyableAgentCommand || "Find public no-website leads. Do not contact or spend."}
                </p>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-md border border-zinc-800 bg-black px-2 py-2 text-zinc-300">
                    Research {snapshot?.launchReadiness.todayExecutionPack?.runLimits.researchTarget ?? 0}
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-black px-2 py-2 text-zinc-300">
                    Import {snapshot?.launchReadiness.todayExecutionPack?.runLimits.maxQualifiedRowsToImport ?? 0}
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-black px-2 py-2 text-zinc-300">
                    Mockups {snapshot?.launchReadiness.todayExecutionPack?.runLimits.maxMockups ?? 0}
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-black px-2 py-2 text-zinc-300">
                    Spend ${snapshot?.launchReadiness.todayExecutionPack?.runLimits.maxPaidSpendUsd ?? 0}
                  </div>
                </div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Pendiente permitido</p>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-amber-100">Correo de negocio/API</p>
                  <Badge variant="outline" className={cn(statusTone(snapshot?.launchReadiness.emailPending.isPending ? "pending_allowed" : "pass"), "shrink-0")}>
                    {snapshot?.launchReadiness.emailPending.isPending ? "pending" : "ready"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-amber-100/80">
                  Mientras tanto quedan activos: {(snapshot?.launchReadiness.emailPending.allowedWhilePending || ["research", "mockups", "drafts", "manual contact"]).join(", ")}.
                </p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-emerald-100">
                  Ready {snapshot?.launchReadiness.ready ?? 0}
                </div>
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100">
                  Pending {snapshot?.launchReadiness.pendingAllowed ?? 0}
                </div>
                <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-red-100">
                  Blocked {snapshot?.launchReadiness.blocked ?? 0}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-zinc-800 bg-zinc-950/80">
          <CardContent className="grid gap-4 p-4 xl:grid-cols-[220px_1fr]">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
                <p className="text-sm font-medium text-white">Readiness</p>
              </div>
              <p className="mt-3 text-4xl font-semibold text-white">{snapshot?.systemReadiness.score ?? 0}%</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{snapshot?.systemReadiness.summary || "Calculando cobertura del sistema."}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-emerald-100">
                  Ready {snapshot?.systemReadiness.ready ?? 0}
                </div>
                <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-red-100">
                  Blocked {snapshot?.systemReadiness.blocked ?? 0}
                </div>
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100">
                  Approval {snapshot?.systemReadiness.needsApproval ?? 0}
                </div>
                <div className="rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-sky-100">
                  Data {snapshot?.systemReadiness.needsData ?? 0}
                </div>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {(snapshot?.systemReadiness.items || []).map((item) => (
                <div key={item.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-white">{item.label}</p>
                    <Badge variant="outline" className={cn(statusTone(item.status), "shrink-0")}>
                      {item.status}
                    </Badge>
                  </div>
                  <p className="text-xs leading-5 text-zinc-500">{item.evidence}</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-300">{item.nextStep}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-emerald-500/20 bg-zinc-950/90">
          <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <BadgeDollarSign className="h-4 w-4 text-emerald-200" />
                <p className="text-sm font-medium text-white">Resumen ejecutivo</p>
                <Badge variant="outline" className={cn(statusTone(snapshot?.executiveSummary.status || "review"), "shrink-0")}>
                  {snapshot?.executiveSummary.status || "loading"}
                </Badge>
              </div>
              <p className="mt-3 text-xl font-semibold leading-7 text-white">
                {snapshot?.executiveSummary.headline || "Cargando ventas, cash y profit."}
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {snapshot?.executiveSummary.nextFocus || "Esperando datos del Revenue Engine."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                <p className="text-xs text-zinc-500">Cash</p>
                <p className="mt-1 text-lg font-semibold text-white">{money.format(snapshot?.executiveSummary.cashCollectedUsd ?? 0)}</p>
              </div>
              <div className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                <p className="text-xs text-zinc-500">Profit</p>
                <p className={cn("mt-1 text-lg font-semibold", (snapshot?.executiveSummary.profitUsd ?? 0) >= 0 ? "text-emerald-200" : "text-red-200")}>
                  {money.format(snapshot?.executiveSummary.profitUsd ?? 0)}
                </p>
              </div>
              <div className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                <p className="text-xs text-zinc-500">Cobro</p>
                <p className="mt-1 text-lg font-semibold text-white">{snapshot?.executiveSummary.collectionRatePercent ?? 0}%</p>
              </div>
              <div className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                <p className="text-xs text-zinc-500">Pendientes</p>
                <p className="mt-1 text-lg font-semibold text-white">{snapshot?.executiveSummary.approvalQueue ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-zinc-800 bg-zinc-950/80">
          <CardContent className="grid gap-4 p-4 xl:grid-cols-[240px_1fr_320px_320px]">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-sky-200" />
                <p className="text-sm font-medium text-white">Contrato del agente</p>
              </div>
              <Badge variant="outline" className={cn("mt-3", statusTone(snapshot?.agentOperatingContract.mode || "review"))}>
                {snapshot?.agentOperatingContract.mode || "loading"}
              </Badge>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                {snapshot?.agentOperatingContract.currentInstruction || "Cargando permisos operativos."}
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Puede hacer solo</p>
              <div className="flex flex-wrap gap-2">
                {(snapshot?.agentOperatingContract.canRunAutonomously || ["research publico gratis"]).map((action) => (
                  <Badge key={action} variant="outline" className="border-emerald-500/30 text-emerald-100">
                    {action}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Siempre pide aprobacion</p>
              <div className="max-h-[120px] space-y-2 overflow-auto pr-1">
                {(snapshot?.agentOperatingContract.requiresHumanApproval || ["contactar negocio externo"]).slice(0, 5).map((action) => (
                  <div key={action} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                    {action}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Decision manual</p>
              <div className="space-y-2">
                <select
                  value={selectedApprovalTargetId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    const nextItem = approvalQueue.find((item) => item.id === nextId) || null;
                    setSelectedApprovalTargetId(nextId);
                    if (nextItem) setApprovalAction(nextItem.action);
                  }}
                  className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white"
                  data-testid="select-approval-target"
                >
                  {approvalQueue.length === 0 ? (
                    <option value="">Manual</option>
                  ) : (
                    approvalQueue.map((item) => (
                      <option key={`${item.source}-${item.id}`} value={item.id}>
                        {item.source}: {item.title} - {item.status}
                      </option>
                    ))
                  )}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={approvalDecisionValue}
                    onChange={(event) => setApprovalDecisionValue(event.target.value as typeof approvalDecisionValue)}
                    className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white"
                    data-testid="select-approval-decision"
                  >
                    <option value="approved">Aprobar</option>
                    <option value="needs_changes">Cambios</option>
                    <option value="rejected">Rechazar</option>
                  </select>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={approvalMaxSpendUsd}
                    onChange={(event) => setApprovalMaxSpendUsd(Number(event.target.value))}
                    className="border-zinc-800 bg-black"
                    data-testid="input-approval-max-spend"
                  />
                </div>
                {selectedApprovalQueueItem && (
                  <div className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium text-white">{selectedApprovalQueueItem.title}</p>
                      <Badge variant="outline" className={cn(statusTone(selectedApprovalQueueItem.priority === "high" ? "blocked" : "draft"), "shrink-0")}>
                        {selectedApprovalQueueItem.source}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{selectedApprovalQueueItem.action}</p>
                  </div>
                )}
                <Input
                  value={approvalActionForSubmit}
                  onChange={(event) => setApprovalAction(event.target.value)}
                  className="border-zinc-800 bg-black"
                  data-testid="input-approval-action"
                />
                <Textarea
                  value={approvalNotes}
                  onChange={(event) => setApprovalNotes(event.target.value)}
                  className="min-h-[64px] border-zinc-800 bg-black"
                  data-testid="textarea-approval-notes"
                />
                <Button
                  type="button"
                  disabled={approvalDecisionMutation.isPending || (approvalQueue.length > 0 && !selectedApprovalQueueItem)}
                  onClick={() => approvalDecisionMutation.mutate(selectedApprovalQueueItem)}
                  className="w-full bg-sky-600 text-white hover:bg-sky-500"
                  data-testid="button-record-approval-decision"
                >
                  {approvalDecisionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Registrar decision
                </Button>
              </div>
              <div className="mt-3 max-h-[116px] space-y-2 overflow-auto pr-1">
                {(snapshot?.recentApprovalDecisions || []).slice(0, 3).map((decision) => (
                  <div key={decision.id} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium text-white">{decision.approvedAction}</p>
                      <Badge variant="outline" className={cn(statusTone(decision.guardrail.status === "blocked" ? "blocked" : "pass"), "shrink-0")}>
                        {decision.decision}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{decision.guardrail.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-emerald-500/20 bg-zinc-950/90">
          <CardContent className="grid gap-4 p-4 xl:grid-cols-[240px_1fr_320px]">
            <div>
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-emerald-200" />
                <p className="text-sm font-medium text-white">Outreach manual hoy</p>
              </div>
              <Badge variant="outline" className={cn("mt-3", statusTone(snapshot?.manualOutreachQueue.status || "review"))}>
                {snapshot?.manualOutreachQueue.status || "loading"}
              </Badge>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-emerald-100">
                  Listos {snapshot?.manualOutreachQueue.readyCount ?? 0}/{snapshot?.manualOutreachQueue.dailyContactLimit ?? 10}
                </div>
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-100">
                  Bloqueados {snapshot?.manualOutreachQueue.blockedCount ?? 0}
                </div>
                <div className="rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-sky-100">
                  Overflow {snapshot?.manualOutreachQueue.overflowCount ?? 0}
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                {snapshot?.manualOutreachQueue.nextAction || "Cargando cola de contacto manual."}
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Contactar</p>
              <div className="grid max-h-[260px] gap-2 overflow-auto pr-1 md:grid-cols-2">
                {(snapshot?.manualOutreachQueue.items || []).length === 0 ? (
                  <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-400">
                    Sin drafts aprobados para contacto manual.
                  </div>
                ) : (
                  (snapshot?.manualOutreachQueue.items || []).map((item) => (
                    <div key={item.draftId} className="rounded-lg border border-zinc-800 bg-black p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{item.businessName}</p>
                          <p className="mt-1 truncate text-xs text-zinc-500">{item.subject}</p>
                        </div>
                        <Badge variant="outline" className={cn(item.priority === "high" ? statusTone("ready_to_start") : statusTone("draft"), "shrink-0")}>
                          {item.channel}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-400">{item.manualAction}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a href={item.contactUrl} target="_blank" rel="noreferrer">
                          <Button type="button" size="sm" className="h-8 bg-emerald-600 text-white hover:bg-emerald-500">
                            <ExternalLink className="mr-2 h-3.5 w-3.5" />
                            Abrir
                          </Button>
                        </a>
                        {item.fallbackUrl && (
                          <a href={item.fallbackUrl}>
                            <Button type="button" size="sm" variant="outline" className="h-8 border-zinc-700">
                              <Send className="mr-2 h-3.5 w-3.5" />
                              Mailto
                            </Button>
                          </a>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-zinc-700"
                          onClick={() => navigator.clipboard.writeText(item.copyableContactPacket)}
                          data-testid={`button-copy-manual-outreach-packet-${item.draftId}`}
                        >
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Copy message
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-emerald-700 text-emerald-100"
                          onClick={() => navigator.clipboard.writeText(item.copyableCloseEvidencePacket)}
                          data-testid={`button-copy-manual-close-evidence-${item.draftId}`}
                        >
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Copy close
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-sky-700 text-sky-100"
                          onClick={() => navigator.clipboard.writeText(item.copyableOutcomeRequests.contacted)}
                          data-testid={`button-copy-manual-outreach-contacted-request-${item.draftId}`}
                        >
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Copy contacted
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-emerald-700 text-emerald-100"
                          onClick={() => navigator.clipboard.writeText(item.copyableOutcomeRequests.depositCollected)}
                          data-testid={`button-copy-manual-outreach-deposit-request-${item.draftId}`}
                        >
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Copy deposit
                        </Button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-300">
                          Setup {money.format(item.estimatedSetupUsd)}
                        </div>
                        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5 text-emerald-100">
                          Deposito {money.format(item.depositUsd)}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-zinc-700"
                          disabled={outreachOutcomeMutation.isPending}
                          onClick={() => outreachOutcomeMutation.mutate({
                            draftId: item.draftId,
                            outcome: "contacted",
                            notes: "Robert registro contacto manual desde la cola diaria.",
                          })}
                          data-testid={`button-record-manual-outreach-contacted-${item.draftId}`}
                        >
                          Contacted
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-sky-700 text-sky-100"
                          disabled={outreachOutcomeMutation.isPending}
                          onClick={() => outreachOutcomeMutation.mutate({
                            draftId: item.draftId,
                            outcome: "reply",
                            notes: "Robert registro reply manual desde la cola diaria.",
                          })}
                          data-testid={`button-record-manual-outreach-reply-${item.draftId}`}
                        >
                          Reply
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-violet-700 text-violet-100"
                          disabled={outreachOutcomeMutation.isPending}
                          onClick={() => outreachOutcomeMutation.mutate({
                            draftId: item.draftId,
                            outcome: "call_booked",
                            notes: "Robert registro llamada agendada desde la cola diaria.",
                          })}
                          data-testid={`button-record-manual-outreach-call-${item.draftId}`}
                        >
                          Call
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-emerald-700 text-emerald-100"
                          disabled={outreachOutcomeMutation.isPending || item.depositUsd <= 0}
                          onClick={() => {
                            const paymentConfirmation = requestDepositPaymentConfirmation(item.businessName, item.depositUsd);
                            if (!paymentConfirmation) return;
                            outreachOutcomeMutation.mutate({
                              draftId: item.draftId,
                              outcome: "deposit_collected",
                              cashCollectedUsd: item.depositUsd,
                              paymentConfirmation,
                              notes: "Robert confirmo deposito manual desde la cola diaria; cerrar oportunidad website con scope antes de delivery.",
                            });
                          }}
                          data-testid={`button-record-manual-outreach-deposit-${item.draftId}`}
                        >
                          Deposit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-red-900 text-red-100"
                          disabled={outreachOutcomeMutation.isPending}
                          onClick={() => outreachOutcomeMutation.mutate({
                            draftId: item.draftId,
                            outcome: "lost",
                            notes: "Robert marco el lead como perdido desde la cola diaria.",
                          })}
                          data-testid={`button-record-manual-outreach-lost-${item.draftId}`}
                        >
                          Lost
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">No tocar todavia</p>
              <div className="max-h-[260px] space-y-2 overflow-auto pr-1">
                {(snapshot?.manualOutreachQueue.blocked || []).length === 0 ? (
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                    Sin drafts bloqueados.
                  </div>
                ) : (
                  (snapshot?.manualOutreachQueue.blocked || []).map((item) => (
                    <div key={item.draftId} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-white">{item.businessName}</p>
                        <Badge variant="outline" className={cn(statusTone(item.status), "shrink-0")}>
                          {item.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{item.reason}</p>
                      {item.status === "draft" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={outreachApproveMutation.isPending}
                          onClick={() => outreachApproveMutation.mutate(item.draftId)}
                          className="mt-2 h-8 border-sky-700 text-sky-100"
                          data-testid={`button-approve-manual-outreach-draft-${item.draftId}`}
                        >
                          {outreachApproveMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-2 h-3.5 w-3.5" />}
                          Aprobar draft
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mb-6 grid gap-3 md:grid-cols-4">
          <StatCard
            label="Apps vendidas"
            value={String(snapshot?.metrics.appsSold ?? 0)}
            detail="Websites cerrados"
            icon={Building2}
          />
          <StatCard
            label="Automations"
            value={String(snapshot?.metrics.automationsSold ?? 0)}
            detail="Sprints o retainers"
            icon={Bot}
          />
          <StatCard
            label="Revenue"
            value={money.format(snapshot?.metrics.revenueUsd ?? 0)}
            detail={`Profit ${money.format(snapshot?.metrics.profitUsd ?? 0)}`}
            icon={CircleDollarSign}
          />
          <Card className="border-zinc-800 bg-zinc-950/80">
            <CardContent className="min-h-[112px] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-zinc-500">Gasto mensual</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{spendPercent}%</p>
                </div>
                <Gauge className="h-5 w-5 text-zinc-300" />
              </div>
              <Progress value={spendPercent} className="bg-zinc-800 [&>div]:bg-emerald-400" />
              <p className="mt-2 text-xs text-zinc-500">
                {money.format(snapshot?.metrics.estimatedSpendUsd ?? 0)} usado de {money.format(snapshot?.metrics.monthlySpendCapUsd ?? 100)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6 border-zinc-800 bg-zinc-950/80">
          <CardContent className="grid gap-4 p-4 xl:grid-cols-[240px_1fr_260px_320px]">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
                <p className="text-sm font-medium text-white">Profit Guard</p>
              </div>
              <Badge variant="outline" className={cn("mt-3", statusTone(snapshot?.profitGuard.status || "review_queue"))}>
                {snapshot?.profitGuard.status || "loading"}
              </Badge>
              <p className="mt-3 text-2xl font-semibold text-white">{money.format(snapshot?.profitGuard.canSpendUsd ?? 0)}</p>
              <p className="mt-1 text-xs text-zinc-500">gasto permitido ahora</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-black p-3">
              <p className="text-sm leading-6 text-zinc-300">{snapshot?.profitGuard.reason || "Cargando guardrail de rentabilidad."}</p>
              <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
                <p>Cash {money.format(snapshot?.profitGuard.cashCollectedUsd ?? 0)}</p>
                <p>Spend {money.format(snapshot?.profitGuard.estimatedSpendUsd ?? 0)}</p>
                <p>Cap libre {money.format(snapshot?.profitGuard.remainingCapUsd ?? 100)}</p>
              </div>
            </div>
            <div className="space-y-2">
              {(snapshot?.profitGuard.requiredActions || ["mantener research gratis"]).map((action) => (
                <div key={action} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                  {action}
                </div>
              ))}
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Approval queue</p>
              <div className="max-h-[188px] space-y-2 overflow-auto pr-1">
                {(snapshot?.approvalQueueItems || []).length === 0 ? (
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                    Sin bloqueos operativos.
                  </div>
                ) : (
                  (snapshot?.approvalQueueItems || []).slice(0, 5).map((item) => (
                    <div key={`${item.source}-${item.id}`} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-white">{item.title}</p>
                        <Badge variant="outline" className={cn(item.priority === "high" ? statusTone("blocked") : statusTone("approval_required"), "shrink-0")}>
                          {item.source}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{item.action}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6 border-zinc-800 bg-zinc-950/80">
          <CardContent className="grid gap-4 p-4 lg:grid-cols-[220px_1fr_280px]">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-sky-200" />
                <p className="text-sm font-medium text-white">Next batch</p>
              </div>
              <Badge variant="outline" className={cn("mt-3", statusTone(snapshot?.nextBatchPlan.status || "review"))}>
                {snapshot?.nextBatchPlan.status || "loading"}
              </Badge>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                  <p className="text-xs text-zinc-500">Leads</p>
                  <p className="mt-1 text-lg font-semibold text-white">{snapshot?.nextBatchPlan.maxLeads ?? 0}</p>
                </div>
                <div className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                  <p className="text-xs text-zinc-500">Gasto</p>
                  <p className="mt-1 text-lg font-semibold text-white">{money.format(snapshot?.nextBatchPlan.maxSpendUsd ?? 0)}</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-black p-3">
              <p className="text-sm leading-6 text-zinc-300">{snapshot?.nextBatchPlan.reason || "Calculando siguiente batch rentable."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(snapshot?.nextBatchPlan.allowedActions || ["research publico gratis"]).map((action) => (
                  <Badge key={action} variant="outline" className="border-sky-500/30 text-sky-100">
                    {action}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {(snapshot?.nextBatchPlan.requiredBeforeNextAction || ["aprobar mensaje antes de enviar"]).map((action) => (
                <div key={action} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                  {action}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card className="border-zinc-800 bg-zinc-950/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4 text-sky-200" />
                Nueva zona
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="revenue-area">
                    Area
                  </label>
                  <Input
                    id="revenue-area"
                    value={area}
                    onChange={(event) => setArea(event.target.value)}
                    className="border-zinc-800 bg-black"
                    data-testid="input-revenue-area"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="revenue-niche">
                    Nicho
                  </label>
                  <Input
                    id="revenue-niche"
                    value={niche}
                    onChange={(event) => setNiche(event.target.value)}
                    className="border-zinc-800 bg-black"
                    data-testid="input-revenue-niche"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="revenue-budget">
                      Budget
                    </label>
                    <Input
                      id="revenue-budget"
                      type="number"
                      min={0}
                      max={100}
                      value={monthlyBudgetUsd}
                      onChange={(event) => setMonthlyBudgetUsd(Number(event.target.value))}
                      className="border-zinc-800 bg-black"
                      data-testid="input-revenue-budget"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="revenue-leads">
                      Leads
                    </label>
                    <Input
                      id="revenue-leads"
                      type="number"
                      min={5}
                      max={50}
                      value={leadCount}
                      onChange={(event) => setLeadCount(Number(event.target.value))}
                      className="border-zinc-800 bg-black"
                      data-testid="input-revenue-leads"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="revenue-offer">
                    Oferta
                  </label>
                  <select
                    id="revenue-offer"
                    value={offerFocus}
                    onChange={(event) => setOfferFocus(event.target.value as "websites" | "automations" | "both")}
                    className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                    data-testid="select-revenue-offer"
                  >
                    <option value="both">Websites + automatizaciones</option>
                    <option value="websites">Websites</option>
                    <option value="automations">Automatizaciones</option>
                  </select>
                </div>
                <Button
                  type="submit"
                  disabled={planMutation.isPending || isLoading}
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                  data-testid="button-create-revenue-plan"
                >
                  {planMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                  Crear plan
                </Button>
              </form>

              <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
                  <ShieldCheck className="h-4 w-4" />
                  Aprobacion humana
                </div>
                <p className="mt-2 text-sm text-zinc-400">{snapshot?.costPolicy.stopRule}</p>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="pipeline" className="min-w-0">
            <TabsList className="mb-4 border border-zinc-800 bg-zinc-900">
              <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
              <TabsTrigger value="leads">Leads</TabsTrigger>
              <TabsTrigger value="mockup">Mockup</TabsTrigger>
              <TabsTrigger value="plan">Plan</TabsTrigger>
              <TabsTrigger value="automation">Automatizacion</TabsTrigger>
              <TabsTrigger value="production">Produccion</TabsTrigger>
              <TabsTrigger value="qa">QA entrega</TabsTrigger>
              <TabsTrigger value="proposal">Propuesta</TabsTrigger>
              <TabsTrigger value="outbox">Outbox</TabsTrigger>
              <TabsTrigger value="improvement">Mejoras</TabsTrigger>
              <TabsTrigger value="ledger">Ledger</TabsTrigger>
              <TabsTrigger value="offers">Ofertas</TabsTrigger>
              <TabsTrigger value="orchestrator">Orquestador</TabsTrigger>
              <TabsTrigger value="agents">Agentes</TabsTrigger>
            </TabsList>

            <TabsContent value="pipeline" className="mt-0">
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                {(snapshot?.pipelineStages || []).map((stage) => (
                  <Card key={stage.id} className="border-zinc-800 bg-zinc-950/80">
                    <CardContent className="p-4">
                      <p className="text-sm font-medium text-white">{stage.name}</p>
                      <p className="mt-3 text-3xl font-semibold">{stage.count}</p>
                      <p className="mt-1 text-xs text-zinc-500">{money.format(stage.valueUsd)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileCheck2 className="h-4 w-4 text-emerald-200" />
                      Sin aprobacion
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(snapshot?.costPolicy.allowedWithoutApproval || []).map((item) => (
                      <div key={item} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                        {item}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MessageSquareText className="h-4 w-4 text-amber-200" />
                      Bloqueado hasta aprobar
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(snapshot?.costPolicy.requiresApproval || []).map((item) => (
                      <div key={item} className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-zinc-300">
                        <ShieldCheck className="h-4 w-4 text-amber-200" />
                        {item}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="leads" className="mt-0">
              <div className="mb-4 grid gap-4 xl:grid-cols-[390px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Search className="h-4 w-4 text-sky-200" />
                      Scouting por area
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        scoutingMissionMutation.mutate();
                      }}
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="scouting-area">
                            Area
                          </label>
                          <Input
                            id="scouting-area"
                            value={scoutingArea}
                            onChange={(event) => setScoutingArea(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-scouting-area"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="scouting-niche">
                            Nicho
                          </label>
                          <Input
                            id="scouting-niche"
                            value={scoutingNiche}
                            onChange={(event) => setScoutingNiche(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-scouting-niche"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="scouting-focus">
                            Oferta
                          </label>
                          <select
                            id="scouting-focus"
                            value={scoutingOfferFocus}
                            onChange={(event) => setScoutingOfferFocus(event.target.value as typeof scoutingOfferFocus)}
                            className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                            data-testid="select-scouting-focus"
                          >
                            <option value="both">Website + automation</option>
                            <option value="websites">Websites</option>
                            <option value="automations">Automations</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="scouting-leads">
                            Leads
                          </label>
                          <Input
                            id="scouting-leads"
                            type="number"
                            min={5}
                            max={100}
                            value={scoutingTargetLeadCount}
                            onChange={(event) => setScoutingTargetLeadCount(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-scouting-leads"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="scouting-spend">
                          Paid data spend
                        </label>
                        <Input
                          id="scouting-spend"
                          type="number"
                          min={0}
                          value={scoutingPaidSpendUsd}
                          onChange={(event) => setScoutingPaidSpendUsd(Number(event.target.value))}
                          className="border-zinc-800 bg-black"
                          data-testid="input-scouting-spend"
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-radar-research">
                            Research/dia
                          </label>
                          <Input
                            id="lead-radar-research"
                            type="number"
                            min={10}
                            max={500}
                            value={leadRadarDailyResearchTarget}
                            onChange={(event) => setLeadRadarDailyResearchTarget(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-lead-radar-research"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-radar-mockups">
                            Mockups/dia
                          </label>
                          <Input
                            id="lead-radar-mockups"
                            type="number"
                            min={1}
                            max={25}
                            value={leadRadarMockupLimit}
                            onChange={(event) => setLeadRadarMockupLimit(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-lead-radar-mockups"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-radar-contact">
                            Contactos/dia
                          </label>
                          <Input
                            id="lead-radar-contact"
                            type="number"
                            min={0}
                            max={50}
                            value={leadRadarContactLimit}
                            onChange={(event) => setLeadRadarContactLimit(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-lead-radar-contact"
                          />
                        </div>
                      </div>
                      <div className="grid gap-2 text-sm text-zinc-300">
                        <label className="flex items-center gap-2 rounded-md border border-zinc-800 bg-black px-3 py-2">
                          <input
                            type="checkbox"
                            checked={scoutingRequireNoWebsite}
                            onChange={(event) => setScoutingRequireNoWebsite(event.target.checked)}
                            className="h-4 w-4"
                            data-testid="checkbox-scouting-no-website"
                          />
                          Exigir senal de no website
                        </label>
                        <label className="flex items-center gap-2 rounded-md border border-zinc-800 bg-black px-3 py-2">
                          <input
                            type="checkbox"
                            checked={scoutingIncludeWeakWebsite}
                            onChange={(event) => setScoutingIncludeWeakWebsite(event.target.checked)}
                            className="h-4 w-4"
                            data-testid="checkbox-scouting-weak-website"
                          />
                          Incluir websites debiles
                        </label>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="seed-lead-batch">
                          Batch leads
                        </label>
                        <Textarea
                          id="seed-lead-batch"
                          value={seedLeadBatchText}
                          onChange={(event) => setSeedLeadBatchText(event.target.value)}
                          className="min-h-[110px] border-zinc-800 bg-black"
                          placeholder="Business | Area | Niche | no_website | email | owner@site.com | https://source-url | owner@site.com | public evidence | pain point | 3500"
                          data-testid="textarea-seed-lead-batch"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="public-scout-evidence">
                          Evidencia publica scout
                        </label>
                        <Textarea
                          id="public-scout-evidence"
                          value={publicScoutEvidenceText}
                          onChange={(event) => setPublicScoutEvidenceText(event.target.value)}
                          className="min-h-[150px] border-zinc-800 bg-black"
                          placeholder={"Business: No Site Cafe\nArea: Miami\nNiche: coffee shop\nWebsite: no website\nContact: @nositecafe\nEmail: owner@example.com\nSource: https://instagram.com/nositecafe\nEvidence: Instagram activo, no website en bio, menu solo en posts publicos.\nPain: Necesita menu online, captura de catering y follow-up."}
                          data-testid="textarea-public-scout-evidence"
                        />
                        <div className="grid gap-2 rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300 md:grid-cols-3">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={candidatePublicEvidenceVerified}
                              onChange={(event) => setCandidatePublicEvidenceVerified(event.target.checked)}
                              className="h-4 w-4"
                              data-testid="checkbox-public-scout-evidence-verified"
                            />
                            Evidencia publica verificada
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={candidateApprovalToImport}
                              onChange={(event) => setCandidateApprovalToImport(event.target.checked)}
                              className="h-4 w-4"
                              data-testid="checkbox-public-scout-approval-import"
                            />
                            Aprobar import a Money Sprint
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={candidateRobertApprovedImport}
                              onChange={(event) => setCandidateRobertApprovedImport(event.target.checked)}
                              className="h-4 w-4"
                              data-testid="checkbox-public-scout-robert-approved-import"
                            />
                            Robert aprobó import
                          </label>
                        </div>
                        <Button
                          type="button"
                          disabled={publicScoutEvidenceMutation.isPending || publicScoutEvidenceText.trim().length < 10}
                          onClick={() => publicScoutEvidenceMutation.mutate()}
                          className="w-full bg-cyan-700 text-white hover:bg-cyan-600"
                          data-testid="button-normalize-public-scout-evidence"
                        >
                          {publicScoutEvidenceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
                          {snapshot?.latestDailyScoutSprint ? "Submitir slot del sprint" : "Normalizar evidencia publica"}
                        </Button>
                        <Button
                          type="button"
                          disabled={!latestDailyScoutSlotText}
                          onClick={() => {
                            setSelectedDailyScoutTaskId(activeScoutSourceTaskId);
                            setPublicScoutEvidenceText(latestDailyScoutSlotText);
                          }}
                          className="w-full bg-zinc-800 text-white hover:bg-zinc-700"
                          data-testid="button-load-daily-scout-slots"
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Cargar slots del sprint
                        </Button>
                        <Button
                          type="button"
                          disabled={publicScoutAgentCommandMutation.isPending || publicScoutEvidenceText.trim().length < 10}
                          onClick={() => publicScoutAgentCommandMutation.mutate()}
                          className="w-full bg-emerald-700 text-white hover:bg-emerald-600"
                          data-testid="button-run-public-scout-agent-command"
                        >
                          {publicScoutAgentCommandMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                          Scout a Money Sprint
                        </Button>
                      </div>
                      <div className="space-y-3 rounded-md border border-zinc-800 bg-black p-3">
                        <div className="grid gap-2 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="public-scout-connector-name">
                              Connector
                            </label>
                            <Input
                              id="public-scout-connector-name"
                              value={publicScoutConnectorName}
                              onChange={(event) => setPublicScoutConnectorName(event.target.value)}
                              className="border-zinc-800 bg-black"
                              data-testid="input-public-scout-connector-name"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="public-scout-connector-run">
                              Run id
                            </label>
                            <Input
                              id="public-scout-connector-run"
                              value={publicScoutConnectorRunId}
                              onChange={(event) => setPublicScoutConnectorRunId(event.target.value)}
                              className="border-zinc-800 bg-black"
                              data-testid="input-public-scout-connector-run"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="public-scout-connector-results">
                            Connector payload or results JSON
                          </label>
                          <Textarea
                            id="public-scout-connector-results"
                            value={publicScoutConnectorResultsJson}
                            onChange={(event) => setPublicScoutConnectorResultsJson(event.target.value)}
                            className="min-h-[150px] border-zinc-800 bg-black font-mono text-xs"
                            data-testid="textarea-public-scout-connector-results"
                          />
                        </div>
                        <Button
                          type="button"
                          disabled={publicScoutConnectorIntakeMutation.isPending || publicScoutConnectorResultsJson.trim().length < 5}
                          onClick={() => publicScoutConnectorIntakeMutation.mutate()}
                          className="w-full bg-zinc-800 text-white hover:bg-zinc-700"
                          data-testid="button-record-public-scout-connector-intake"
                        >
                          {publicScoutConnectorIntakeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                          Guardar connector review-only
                        </Button>
                        <p className="text-xs leading-5 text-zinc-500">
                          Connector intake guarda candidatos para revision; no importa leads, no manda outreach, no gasta y no publica websites.
                        </p>
                      </div>
                      <Button
                        type="submit"
                        disabled={scoutingMissionMutation.isPending}
                        className="w-full bg-sky-600 text-white hover:bg-sky-500"
                        data-testid="button-build-scouting-mission"
                      >
                        {scoutingMissionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                        Crear mision
                      </Button>
                      <Button
                        type="button"
                        disabled={leadRadarMutation.isPending}
                        onClick={() => leadRadarMutation.mutate()}
                        className="w-full bg-fuchsia-600 text-white hover:bg-fuchsia-500"
                        data-testid="button-build-lead-radar"
                      >
                        {leadRadarMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                        Radar 24/7
                      </Button>
                      <Button
                        type="button"
                        disabled={moneySprintPreviewMutation.isPending}
                        onClick={() => moneySprintPreviewMutation.mutate()}
                        className="w-full bg-zinc-800 text-white hover:bg-zinc-700"
                        data-testid="button-preview-money-sprint"
                      >
                        {moneySprintPreviewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                        Preview batch
                      </Button>
                      <Button
                        type="button"
                        disabled={publicLeadCandidateBatchMutation.isPending || seedLeadBatchText.trim().length === 0}
                        onClick={() => publicLeadCandidateBatchMutation.mutate()}
                        className="w-full bg-zinc-800 text-white hover:bg-zinc-700"
                        data-testid="button-save-public-candidate-batch"
                      >
                        {publicLeadCandidateBatchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
                        Guardar batch publico
                      </Button>
                      <p className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs leading-5 text-zinc-500">
                        Usa los checks de evidencia/aprobacion para todas las filas del batch pegado; guarda candidatos, no leads reales ni mensajes.
                      </p>
                      <Button
                        type="button"
                        disabled={moneySprintMutation.isPending}
                        onClick={() => moneySprintMutation.mutate()}
                        className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                        data-testid="button-run-money-sprint"
                      >
                        {moneySprintMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeDollarSign className="mr-2 h-4 w-4" />}
                        Money sprint
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="text-base">{scoutingMission?.mission.name || "Mision de busqueda"}</CardTitle>
                        <p className="mt-1 text-sm text-zinc-500">
                          {scoutingMission ? `${scoutingMission.mission.leadBatchSize} leads por batch · ${scoutingMission.mission.mode}` : "Define area, nicho y foco para generar busqueda auditada."}
                        </p>
                      </div>
                      {scoutingMission && (
                        <Badge variant="outline" className={cn(scoutingMission.budgetGate.requiresApprovalToSpend ? statusTone("approval_required") : statusTone("active"), "shrink-0")}>
                          {scoutingMission.budgetGate.requiresApprovalToSpend ? "Aprobar gasto" : "Research gratis"}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {!scoutingMission ? (
                      <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-black/40 p-6 text-center text-sm text-zinc-500">
                        La mision va a devolver queries, checklist, scorecard y subagentes antes de guardar o contactar leads.
                      </div>
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
                        <div className="space-y-4">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Queries</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              {scoutingMission.searchQueries.map((query) => (
                                <div key={query} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                                  {query}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Scorecard</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              {scoutingMission.qualificationScorecard.map((item) => (
                                <div key={item.item} className="rounded-lg border border-zinc-800 bg-black p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm font-medium text-white">{item.item}</p>
                                    <Badge variant="outline" className="border-zinc-700 text-zinc-300">{item.maxPoints} pts</Badge>
                                  </div>
                                  <p className="mt-2 text-xs leading-5 text-zinc-500">{item.signals.join(" · ")}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Misiones recientes</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              {(snapshot?.recentScoutingMissions || []).slice(0, 4).map((mission) => (
                                <div key={mission.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-medium text-white">{mission.mission.name}</p>
                                      <p className="mt-1 text-xs text-zinc-500">{mission.mission.leadBatchSize} leads · {money.format(mission.budgetGate.approvedPaidDataSpendUsd)} aprobado</p>
                                    </div>
                                    <Badge variant="outline" className={cn(statusTone(mission.status), "shrink-0")}>{mission.status}</Badge>
                                  </div>
                                  <p className="mt-2 text-xs leading-5 text-zinc-500">{mission.learningNote}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                            <p className="text-xs uppercase tracking-wide text-amber-200">Budget gate</p>
                            <p className="mt-2 text-sm text-zinc-300">
                              Cap {money.format(scoutingMission.budgetGate.monthlyCapUsd)} · aprobado {money.format(scoutingMission.budgetGate.approvedPaidDataSpendUsd)}
                            </p>
                            <div className="mt-3 space-y-2">
                              {scoutingMission.budgetGate.blockedBeforeApproval.map((item) => (
                                <div key={item} className="rounded-md border border-amber-500/20 bg-black px-3 py-2 text-xs text-amber-100">
                                  {item}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Checklist</p>
                            <div className="mt-2 space-y-2">
                              {scoutingMission.leadEvidenceChecklist.map((item) => (
                                <div key={item} className="flex gap-2 text-sm leading-5 text-zinc-300">
                                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                                  {item}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Subagentes</p>
                            <div className="mt-2 space-y-2">
                              {scoutingMission.subagentReviews.map((review) => (
                                <div key={review.agent} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                                  <p className="text-sm font-medium text-white">{review.agent}</p>
                                  <p className="mt-1 text-xs text-zinc-500">{review.check}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
              </Card>
              </div>

              <Card className="mb-4 border-sky-500/20 bg-zinc-950/80">
                <CardHeader>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base">{snapshot?.dailyMoneyCommand.headline || "Comando diario de dinero"}</CardTitle>
                      <p className="mt-1 text-sm text-zinc-500">
                        {snapshot?.dailyMoneyCommand.primaryAction || "Cargando siguiente accion."}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn(statusTone(snapshot?.dailyMoneyCommand.status || "review"), "shrink-0")}>
                      {snapshot?.dailyMoneyCommand.status || "loading"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 xl:grid-cols-[1fr_320px]">
                  <div className="space-y-3">
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                      <p className="text-xs uppercase tracking-wide text-sky-200">Target</p>
                      <p className="mt-2 text-lg font-semibold text-white">{snapshot?.dailyMoneyCommand.target || "Preparando target."}</p>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {(snapshot?.dailyMoneyCommand.steps || []).map((step) => (
                        <div key={step.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">{step.label}</p>
                              <p className="mt-1 text-xs text-zinc-500">{step.metric}</p>
                            </div>
                            <Badge variant="outline" className={cn(statusTone(step.status), "shrink-0")}>{step.status}</Badge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-zinc-400">{step.nextAction}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-black p-3">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Funnel hoy</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <p className="text-xs text-zinc-500">Research</p>
                        <p className="mt-1 text-sm font-semibold text-white">{snapshot?.dailyMoneyCommand.funnel.researchTarget ?? 0}</p>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <p className="text-xs text-zinc-500">Candidatos</p>
                        <p className="mt-1 text-sm font-semibold text-white">{snapshot?.dailyMoneyCommand.funnel.candidatesReady ?? 0}</p>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <p className="text-xs text-zinc-500">Paquetes</p>
                        <p className="mt-1 text-sm font-semibold text-white">{snapshot?.dailyMoneyCommand.funnel.salesPacketsReady ?? 0}</p>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <p className="text-xs text-zinc-500">Contactos</p>
                        <p className="mt-1 text-sm font-semibold text-white">{snapshot?.dailyMoneyCommand.funnel.manualContactsReady ?? 0}</p>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <p className="text-xs text-zinc-500">Scope</p>
                        <p className="mt-1 text-sm font-semibold text-white">{snapshot?.dailyMoneyCommand.funnel.websiteClosuresPending ?? 0}</p>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <p className="text-xs text-zinc-500">Build PR</p>
                        <p className="mt-1 text-sm font-semibold text-white">{snapshot?.dailyMoneyCommand.funnel.buildHandoffsOpen ?? 0}</p>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                        <p className="text-xs text-zinc-500">Cash</p>
                        <p className="mt-1 text-sm font-semibold text-white">{money.format(snapshot?.dailyMoneyCommand.funnel.cashCollectedUsd ?? 0)}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full border-zinc-700 bg-zinc-950"
                      onClick={() => navigator.clipboard.writeText(snapshot?.dailyMoneyCommand.copyableOperatorBrief || "")}
                      data-testid="button-copy-daily-money-command"
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy daily command
                    </Button>
                    <div className="mt-3 rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2" data-testid="panel-daily-run-packet">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-sky-100">Next run packet</p>
                        <Badge variant="outline" className={cn(statusTone(snapshot?.dailyMoneyCommand.runPacket.status || "review"), "shrink-0")}>
                          {snapshot?.dailyMoneyCommand.runPacket.status || "loading"}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-400">
                        {snapshot?.dailyMoneyCommand.runPacket.apiAction || "/api/revenue-engine/scout-dispatch"}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {snapshot?.dailyMoneyCommand.runPacket.gate || "Esperando guardrails."}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full border-sky-500/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                      onClick={() => navigator.clipboard.writeText(snapshot?.dailyMoneyCommand.runPacket.copyableRunPacket || "")}
                      data-testid="button-copy-daily-run-packet"
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy next run
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full border-zinc-700 bg-zinc-950"
                      onClick={() => navigator.clipboard.writeText(snapshot?.dailyMoneyCommand.runPacket.copyableApiRequest || "")}
                      data-testid="button-copy-daily-run-api-request"
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy API request
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!canRunDailyMoneyNextAction || dailyMoneyRunMutation.isPending}
                      className="mt-2 w-full bg-emerald-700 text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                      onClick={() => dailyMoneyRunMutation.mutate()}
                      data-testid="button-run-daily-money-safe-action"
                    >
                      {dailyMoneyRunMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-2 h-3.5 w-3.5" />}
                      Run next safe action
                    </Button>
                    <p className="mt-2 text-xs leading-5 text-zinc-500" data-testid="text-daily-money-safe-action-gate">
                      {canRunDailyMoneyNextAction
                        ? `Safe direct run: ${dailyMoneyRunPacket?.apiAction}`
                        : dailyMoneyRunBlockedReason}
                    </p>
                    {dailyMoneyRunMutation.data && (
                      <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2" data-testid="panel-daily-money-safe-action-result">
                        <p className="text-xs font-medium text-emerald-100">
                          Resultado: {String(dailyMoneyRunMutation.data.status || "ok")}
                        </p>
                        {"reason" in dailyMoneyRunMutation.data && (
                          <p className="mt-1 text-xs leading-5 text-emerald-100/80">
                            {String(dailyMoneyRunMutation.data.reason || "")}
                          </p>
                        )}
                      </div>
                    )}
                    {dailyMoneyRunMutation.error && (
                      <p className="mt-2 text-xs leading-5 text-red-300" data-testid="text-daily-money-safe-action-error">
                        {dailyMoneyRunMutation.error.message}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {(snapshot?.websiteBuildHandoffQueue.openCount ?? 0) > 0 && (
                <Card className="mb-4 border-sky-500/20 bg-zinc-950/80" data-testid="panel-website-build-handoff-queue">
                  <CardHeader>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="text-base">Builds website PR-first</CardTitle>
                        <p className="mt-1 text-sm text-zinc-500">
                          {snapshot?.websiteBuildHandoffQueue.nextAction}
                        </p>
                      </div>
                      <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-100">
                        {snapshot?.websiteBuildHandoffQueue.openCount ?? 0} abiertos
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3 xl:grid-cols-2">
                    {(snapshot?.websiteBuildHandoffQueue.items || []).map((item) => (
                      <div key={item.workspaceId} className="rounded-lg border border-zinc-800 bg-black p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{item.clientName}</p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {item.projectType} · {money.format(item.setupUsd)} · {item.workspaceId}
                            </p>
                          </div>
                          <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-100">needs PR</Badge>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-zinc-400">{item.nextAction}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="outline" className="border-zinc-700 text-zinc-300">{item.branchName}</Badge>
                          {item.repoFullName && (
                            <Badge variant="outline" className="border-zinc-700 text-zinc-300">{item.repoFullName}</Badge>
                          )}
                        </div>
                        {item.missing.length > 0 && (
                          <div className="mt-3 space-y-1">
                            {item.missing.slice(0, 4).map((missing) => (
                              <p key={`${item.workspaceId}-${missing}`} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-xs text-amber-100">
                                {missing}
                              </p>
                            ))}
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-zinc-700"
                            onClick={() => navigator.clipboard.writeText(item.publicBuildBrief)}
                            data-testid={`button-copy-website-build-brief-${item.workspaceId}`}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Copy public brief
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-sky-500/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                            onClick={() => navigator.clipboard.writeText(item.buildPack.copyableBuildPack)}
                            data-testid={`button-copy-website-build-pack-${item.workspaceId}`}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Copy build pack
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-zinc-700"
                            onClick={() => navigator.clipboard.writeText(item.copyableGithubHandoffRequest)}
                            data-testid={`button-copy-website-github-handoff-request-${item.workspaceId}`}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Copy handoff JSON
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-indigo-500/30 text-indigo-100"
                            onClick={() => navigator.clipboard.writeText(item.copyableReleaseGateRequest)}
                            data-testid={`button-copy-website-release-gate-request-${item.workspaceId}`}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Copy release JSON
                          </Button>
                          {item.githubIssueUrl && (
                            <a href={item.githubIssueUrl} target="_blank" rel="noreferrer">
                              <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Issue
                              </Button>
                            </a>
                          )}
                          {item.prUrl && (
                            <a href={item.prUrl} target="_blank" rel="noreferrer">
                              <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                <ExternalLink className="mr-2 h-4 w-4" />
                                PR
                              </Button>
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <Card className="mb-4 border-emerald-500/20 bg-zinc-950/80">
                <CardHeader>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base">Cola de busqueda publica</CardTitle>
                      <p className="mt-1 text-sm text-zinc-500">
                        {snapshot?.businessScoutQueue.nextAction || "Cargando cola de busqueda."}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn(statusTone(snapshot?.businessScoutQueue.status || "review"), "shrink-0")}>
                      {snapshot?.businessScoutQueue.source === "latest_scouting_mission" ? "mision activa" : "default"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 xl:grid-cols-[1fr_360px]">
                  <div className="space-y-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      {(snapshot?.businessScoutQueue.tasks || []).slice(0, 6).map((task) => (
                        <a
                          key={task.id}
                          href={task.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-zinc-800 bg-black p-3 transition hover:border-emerald-500/40"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">{task.query}</p>
                              <p className="mt-1 text-xs text-zinc-500">{task.ownerAgent} · {task.source}</p>
                            </div>
                            <ExternalLink className="h-4 w-4 shrink-0 text-zinc-500" />
                          </div>
                          <p className="mt-2 text-xs leading-5 text-zinc-500">{task.evidenceToCapture.join(" · ")}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-black p-3">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">Work pack</p>
                    <p className="mt-2 text-sm text-zinc-300">
                      {snapshot?.businessScoutQueue.area || "Miami"} · {snapshot?.businessScoutQueue.niche || "restaurants"} · {snapshot?.businessScoutQueue.workPack.targetRows ?? 0} filas
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="bg-emerald-400 text-black hover:bg-emerald-300"
                        onClick={() => dailyScoutSprintMutation.mutate()}
                        disabled={dailyScoutSprintMutation.isPending}
                        data-testid="button-start-daily-scout-sprint"
                      >
                        {dailyScoutSprintMutation.isPending ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Search className="mr-2 h-3.5 w-3.5" />
                        )}
                        Start scout sprint
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="bg-cyan-600 text-white hover:bg-cyan-500"
                        onClick={() => scoutDispatchMutation.mutate()}
                        disabled={scoutDispatchMutation.isPending}
                        data-testid="button-dispatch-scout-agents"
                      >
                        {scoutDispatchMutation.isPending ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Bot className="mr-2 h-3.5 w-3.5" />
                        )}
                        Dispatch scouts
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-zinc-700 bg-zinc-950"
                        onClick={() => navigator.clipboard.writeText(snapshot?.businessScoutQueue.workPack.copyableBatchTemplate || "")}
                        data-testid="button-copy-live-scout-batch-template"
                      >
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        Copy rows
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-zinc-700 bg-zinc-950"
                        onClick={() => navigator.clipboard.writeText(snapshot?.businessScoutQueue.workPack.subagentBrief || "")}
                        data-testid="button-copy-live-scout-brief"
                      >
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        Copy brief
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-emerald-500/30 bg-zinc-950 text-emerald-100 hover:bg-emerald-500/10"
                        onClick={() => navigator.clipboard.writeText(snapshot?.businessScoutQueue.workPack.searchPlaybook.copyableBrief || "")}
                        data-testid="button-copy-business-search-playbook"
                      >
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        Copy playbook
                      </Button>
                    </div>
                    <div className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-3" data-testid="panel-business-search-playbook">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-wide text-emerald-200">Playbook de busqueda</p>
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-100">
                          {(snapshot?.businessScoutQueue.workPack.searchPlaybook.prioritizedSources || []).length} fuentes
                        </Badge>
                      </div>
                      <div className="mt-3 space-y-2">
                        {(snapshot?.businessScoutQueue.workPack.searchPlaybook.prioritizedSources || []).slice(0, 3).map((item) => (
                          <div key={`${item.source}-${item.query}`} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                            <p className="text-xs font-medium text-white">{item.source}</p>
                            <p className="mt-1 text-xs text-zinc-500">{item.query}</p>
                            <p className="mt-1 text-xs leading-5 text-emerald-100/80">{item.evidenceGoal}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {(snapshot?.businessScoutQueue.workPack.searchPlaybook.opportunitySignals || []).slice(0, 4).map((signal) => (
                          <div key={signal} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-300">
                            {signal}
                          </div>
                        ))}
                      </div>
                    </div>
                    {dailyScoutSprintMutation.error && (
                      <p className="mt-2 text-xs text-red-300">{dailyScoutSprintMutation.error.message}</p>
                    )}
                    {scoutDispatchMutation.error && (
                      <p className="mt-2 text-xs text-red-300">{scoutDispatchMutation.error.message}</p>
                    )}
                    {scoutDispatchMutation.data && (
                      <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3" data-testid="panel-scout-dispatch">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-cyan-200">Scout dispatch</p>
                            <p className="mt-1 text-sm font-semibold text-white">
                              {scoutDispatchMutation.data.dispatch.agentCount} agentes · {scoutDispatchMutation.data.dispatch.taskCount} tareas · {scoutDispatchMutation.data.dispatch.slotCount} slots
                            </p>
                          </div>
                          <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-100">
                            listo
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-cyan-100/80">{scoutDispatchMutation.data.nextAction}</p>
                        <div className="mt-3 rounded-md border border-cyan-500/20 bg-black px-3 py-2" data-testid="panel-scout-connector-intake-contract">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-medium text-cyan-100">Connector intake</p>
                            <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-100">
                              {scoutDispatchMutation.data.dispatch.connectorIntake.executionMode}
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-zinc-400">
                            POST {scoutDispatchMutation.data.dispatch.connectorIntake.endpoint} · max {scoutDispatchMutation.data.dispatch.connectorIntake.maxResults} resultados · import {scoutDispatchMutation.data.dispatch.connectorIntake.approvalLocked ? "bloqueado" : "activo"}
                          </p>
                          <p className="mt-1 text-xs text-cyan-100/80">
                            {scoutDispatchMutation.data.dispatch.connectorIntake.workOrders.length} work orders task-bound
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-cyan-500/30 bg-black"
                            onClick={() => navigator.clipboard.writeText(scoutDispatchMutation.data?.dispatch.copyableDispatchBrief || "")}
                            data-testid="button-copy-scout-dispatch"
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy dispatch
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-cyan-500/30 bg-black"
                            onClick={() => navigator.clipboard.writeText(scoutDispatchMutation.data?.dispatch.agentAssignments.map((agent) => agent.copyableBrief).join("\n\n") || "")}
                            data-testid="button-copy-scout-dispatch-agents"
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy agent briefs
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-cyan-500/30 bg-black"
                            onClick={() => navigator.clipboard.writeText(scoutDispatchMutation.data?.dispatch.connectorIntake.copyablePayloadTemplate || "")}
                            data-testid="button-copy-scout-connector-intake"
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy payload template
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-cyan-500/30 bg-black"
                            onClick={() => navigator.clipboard.writeText(scoutDispatchMutation.data?.dispatch.connectorIntake.copyableWorkOrders || "")}
                            data-testid="button-copy-scout-connector-work-orders"
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy work orders
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-cyan-500/30 bg-black"
                            onClick={() => navigator.clipboard.writeText(scoutDispatchMutation.data?.dispatch.connectorIntake.copyableSubagentCommands || "")}
                            data-testid="button-copy-scout-subagent-commands"
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy subagent commands
                          </Button>
                        </div>
                      </div>
                    )}
                    {snapshot?.latestDailyScoutSprint && (
                      <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3" data-testid="panel-latest-daily-scout-sprint">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-emerald-200">Daily scout sprint</p>
                            <p className="mt-1 text-sm font-semibold text-white">
                              {snapshot.latestDailyScoutSprint.area} · {snapshot.latestDailyScoutSprint.niche} · {snapshot.latestDailyScoutSprint.targetRows} slots
                            </p>
                            {snapshot.latestDailyScoutSprint.dispatchMode && (
                              <p className="mt-1 text-xs text-emerald-100/80">
                                Dispatch: {snapshot.latestDailyScoutSprint.dispatchSummary || snapshot.latestDailyScoutSprint.dispatchMode}
                              </p>
                            )}
                            {snapshot.latestDailyScoutSprint.executionMode && (
                              <p className="mt-1 text-xs text-amber-100/90">
                                Execution: {snapshot.latestDailyScoutSprint.executionMode}. Blocked until {snapshot.latestDailyScoutSprint.blockedUntil || "public evidence is verified"}.
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className={cn(statusTone(snapshot.latestDailyScoutSprint.status), "shrink-0")}>
                            {snapshot.latestDailyScoutSprint.status}
                          </Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-emerald-500/30 bg-black"
                            onClick={() => navigator.clipboard.writeText(snapshot.latestDailyScoutSprint?.copyableOperatorBrief || "")}
                            data-testid="button-copy-daily-scout-sprint-brief"
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy sprint
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-emerald-500/30 bg-black"
                            onClick={() => navigator.clipboard.writeText(snapshot.latestDailyScoutSprint?.agentBriefs.map((brief) => brief.copyableBrief).join("\n\n") || "")}
                            data-testid="button-copy-daily-scout-agent-briefs"
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy agents
                          </Button>
                        </div>
                        <div className="mt-3 space-y-2">
                          {snapshot.latestDailyScoutSprint.tasks.map((task) => {
                            const openSlotText = task.resultSlots
                              .filter((slot) => slot.status === "open")
                              .map((slot) => slot.copyableEvidenceBlock)
                              .join("\n\n");
                            return (
                              <div key={task.taskId} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs font-medium text-white">{task.taskId} · {task.ownerAgent}</p>
                                  <span className="text-xs text-zinc-500">
                                    {task.resultSlots.filter((slot) => slot.status === "filled").length} filled · {task.resultSlots.filter((slot) => slot.status === "open").length} open
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-zinc-500">{task.query}</p>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {task.resultSlots.map((slot) => (
                                    <Badge key={slot.slotId} variant="outline" className={cn("text-[10px]", statusTone(slot.status === "filled" ? "ready" : slot.status === "rejected" ? "blocked" : "review"))}>
                                      {slot.status}
                                    </Badge>
                                  ))}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Button
                                    asChild
                                    size="sm"
                                    variant="outline"
                                    className="h-7 border-zinc-700 bg-zinc-950 text-xs"
                                  >
                                    <a href={task.url} target="_blank" rel="noreferrer" data-testid={`link-open-daily-scout-task-${task.taskId}`}>
                                      <ExternalLink className="mr-1.5 h-3 w-3" />
                                      Open search
                                    </a>
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 border-zinc-700 bg-zinc-950 text-xs"
                                    disabled={!openSlotText}
                                    onClick={() => {
                                      setSelectedDailyScoutTaskId(task.taskId);
                                      setPublicScoutEvidenceText(openSlotText);
                                    }}
                                    data-testid={`button-load-daily-scout-task-slots-${task.taskId}`}
                                  >
                                    <FileCheck2 className="mr-1.5 h-3 w-3" />
                                    Load open slots
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 border-zinc-700 bg-zinc-950 text-xs"
                                    onClick={() => navigator.clipboard.writeText(task.resultSlots.map((slot) => slot.copyableEvidenceBlock).join("\n\n"))}
                                    data-testid={`button-copy-daily-scout-slots-${task.taskId}`}
                                  >
                                    <Copy className="mr-1.5 h-3 w-3" />
                                    Copy slots
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 space-y-2">
                      {(snapshot?.businessScoutQueue.workPack.importInstructions || []).map((item) => (
                        <div key={item} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {leadRadarMutation.data && (
                <Card className="mb-4 border-fuchsia-500/20 bg-zinc-950/80">
                  <CardHeader>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="text-base">Lead Radar 24/7</CardTitle>
                        <p className="mt-1 text-sm text-zinc-500">{leadRadarMutation.data.recommendation}</p>
                      </div>
                      <Badge variant="outline" className={cn(statusTone(leadRadarMutation.data.status), "shrink-0")}>
                        {leadRadarMutation.data.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4 lg:grid-cols-[1fr_360px]">
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="rounded-lg border border-zinc-800 bg-black p-3">
                          <p className="text-xs text-zinc-500">Research</p>
                          <p className="mt-1 text-xl font-semibold text-white">{leadRadarMutation.data.dailyLimits.researchTarget}/dia</p>
                          <p className="mt-1 text-xs text-zinc-500">{leadRadarMutation.data.dailyLimits.researchPerHour}/hora</p>
                        </div>
                        <div className="rounded-lg border border-zinc-800 bg-black p-3">
                          <p className="text-xs text-zinc-500">Calificados</p>
                          <p className="mt-1 text-xl font-semibold text-white">{leadRadarMutation.data.dailyLimits.qualifiedLeadLimit}/dia</p>
                          <p className="mt-1 text-xs text-zinc-500">{leadRadarMutation.data.dailyLimits.qualifiedPerHour}/hora</p>
                        </div>
                        <div className="rounded-lg border border-zinc-800 bg-black p-3">
                          <p className="text-xs text-zinc-500">Mockups</p>
                          <p className="mt-1 text-xl font-semibold text-white">{leadRadarMutation.data.dailyLimits.mockupLimit}/dia</p>
                          <p className="mt-1 text-xs text-zinc-500">cada {leadRadarMutation.data.dailyLimits.mockupCadenceHours}h</p>
                        </div>
                        <div className="rounded-lg border border-zinc-800 bg-black p-3">
                          <p className="text-xs text-zinc-500">Contactos</p>
                          <p className="mt-1 text-xl font-semibold text-white">{leadRadarMutation.data.dailyLimits.contactLimit}/dia</p>
                          <p className="mt-1 text-xs text-zinc-500">{leadRadarMutation.data.operatingMode.contactMode}</p>
                        </div>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {leadRadarMutation.data.lanes.map((lane) => (
                          <div key={lane.lane} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-white">{lane.lane}</p>
                              <Badge variant="outline" className="border-zinc-700 text-zinc-300">{lane.runs}</Badge>
                            </div>
                            <p className="mt-1 text-xs text-zinc-500">{lane.ownerAgent}</p>
                            <p className="mt-2 text-sm leading-5 text-zinc-300">{lane.output}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="rounded-lg border border-zinc-800 bg-black p-3">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Canales</p>
                        <div className="mt-2 space-y-2">
                          {leadRadarMutation.data.channelMix.map((channel) => (
                            <div key={channel.channel} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                              <p className="text-sm font-medium text-white">{channel.priority}. {channel.channel}</p>
                              <p className="mt-1 text-xs leading-5 text-zinc-500">{channel.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-black p-3">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Yo creo los mockups cuando</p>
                        <div className="mt-2 space-y-2">
                          {leadRadarMutation.data.mockupPolicy.requiredBeforeMockup.map((item) => (
                            <div key={item} className="flex gap-2 text-sm text-zinc-300">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-200" />
                              {item}
                            </div>
                          ))}
                        </div>
                        <p className="mt-3 text-xs leading-5 text-zinc-500">{leadRadarMutation.data.mockupPolicy.qualityBar}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {moneySprintPreviewMutation.data && (
                <Card className="mb-4 border-zinc-700 bg-zinc-950/80">
                  <CardHeader>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Eye className="h-4 w-4 text-zinc-200" />
                          Batch preview
                        </CardTitle>
                        <p className="mt-1 text-sm text-zinc-500">{moneySprintPreviewMutation.data.safety.nextAction}</p>
                      </div>
                      <Badge variant="outline" className={cn(statusTone(moneySprintPreviewMutation.data.status), "shrink-0")}>
                        {moneySprintPreviewMutation.data.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4 xl:grid-cols-[1fr_320px]">
                    <div className="space-y-3">
                      {moneySprintPreviewMutation.data.acceptedSeeds.slice(0, 8).map((seed) => (
                        <div key={`${seed.rowNumber}-${seed.businessName}`} className="rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="text-sm font-medium text-white">{seed.businessName}</p>
                              <p className="mt-1 text-xs text-zinc-500">{seed.area} · {seed.niche} · {seed.contactChannel}</p>
                            </div>
                            <Badge variant="outline" className="border-emerald-500/30 text-emerald-100">
                              Grade {seed.qualification.grade} · {seed.qualification.score}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className={cn("rounded border px-2 py-1", seed.mockupReady ? "border-emerald-500/30 text-emerald-100" : "border-zinc-700 text-zinc-400")}>
                              mockup {seed.mockupReady ? "ready" : "blocked"}
                            </span>
                            <span className={cn("rounded border px-2 py-1", seed.draftReady ? "border-sky-500/30 text-sky-100" : "border-zinc-700 text-zinc-400")}>
                              draft {seed.draftReady ? "ready" : "blocked"}
                            </span>
                          </div>
                          {seed.missingForDraft.length > 0 && (
                            <p className="mt-2 text-xs leading-5 text-amber-100">{seed.missingForDraft.join(" · ")}</p>
                          )}
                        </div>
                      ))}
                      {moneySprintPreviewMutation.data.blockedSeeds.length > 0 && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                          <p className="text-xs uppercase tracking-wide text-amber-200">Blocked rows</p>
                          <div className="mt-2 space-y-2">
                            {moneySprintPreviewMutation.data.blockedSeeds.slice(0, 8).map((seed) => (
                              <p key={`${seed.businessName}-${seed.reason}`} className="text-sm leading-5 text-zinc-300">
                                {seed.businessName}: {seed.reason}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-3">
                      <div className="rounded-lg border border-zinc-800 bg-black p-3">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Totals</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-zinc-300">
                          <p>Accepted: {moneySprintPreviewMutation.data.totals.accepted}</p>
                          <p>Blocked: {moneySprintPreviewMutation.data.totals.blocked}</p>
                          <p>Mockups: {moneySprintPreviewMutation.data.totals.mockupReady}</p>
                          <p>Drafts: {moneySprintPreviewMutation.data.totals.draftReady}</p>
                        </div>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-black p-3">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Safety</p>
                        <div className="mt-2 space-y-2 text-sm text-zinc-300">
                          <p>Persist: {moneySprintPreviewMutation.data.safety.persistsData ? "yes" : "no"}</p>
                          <p>Preview files: {moneySprintPreviewMutation.data.safety.writesPreviewFiles ? "yes" : "no"}</p>
                          <p>Outreach send: {moneySprintPreviewMutation.data.safety.sendsOutreach ? "yes" : "no"}</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {moneySprintMutation.data && (
                <Card className="mb-4 border-emerald-500/20 bg-zinc-950/80">
                  <CardHeader>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <BadgeDollarSign className="h-4 w-4 text-emerald-200" />
                          Money sprint
                        </CardTitle>
                        <p className="mt-1 text-sm text-zinc-500">
                          {moneySprintMutation.data.operatingLimits.maxQualifiedLeadsToday} leads · {moneySprintMutation.data.operatingLimits.maxMockupsToday} previews · {moneySprintMutation.data.operatingLimits.externalContactMode}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn(statusTone(moneySprintMutation.data.status), "shrink-0")}>
                        {moneySprintMutation.data.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4 xl:grid-cols-[1fr_360px]">
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Scout queue</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {moneySprintMutation.data.scoutQueue.slice(0, 8).map((task) => (
                            <a
                              key={task.id}
                              href={task.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg border border-zinc-800 bg-black p-3 transition hover:border-emerald-500/40"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-white">{task.query}</p>
                                  <p className="mt-1 text-xs text-zinc-500">{task.ownerAgent} · {task.source}</p>
                                </div>
                                <ExternalLink className="h-4 w-4 shrink-0 text-zinc-500" />
                              </div>
                              <p className="mt-2 text-xs leading-5 text-zinc-500">{task.evidenceToCapture.join(" · ")}</p>
                            </a>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-black p-3">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Scout work pack</p>
                            <p className="mt-1 text-sm text-zinc-300">
                              {moneySprintMutation.data.scoutWorkPack.targetRows} filas · {moneySprintMutation.data.scoutWorkPack.safety.allowedAction}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="border-zinc-700 bg-zinc-950"
                              onClick={() => navigator.clipboard.writeText(moneySprintMutation.data.scoutWorkPack.copyableBatchTemplate)}
                              data-testid="button-copy-scout-batch-template"
                            >
                              <Copy className="mr-2 h-3.5 w-3.5" />
                              Copy rows
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="border-zinc-700 bg-zinc-950"
                              onClick={() => navigator.clipboard.writeText(moneySprintMutation.data.scoutWorkPack.subagentBrief)}
                              data-testid="button-copy-scout-brief"
                            >
                              <Copy className="mr-2 h-3.5 w-3.5" />
                              Copy brief
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {moneySprintMutation.data.scoutWorkPack.importInstructions.map((item) => (
                            <div key={item} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                      {moneySprintMutation.data.previews.length > 0 && (
                        <div>
                          <p className="text-xs uppercase tracking-wide text-zinc-500">Previews</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            {moneySprintMutation.data.previews.map((preview) => (
                              <a
                                key={preview.slug}
                                href={preview.previewUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 transition hover:border-emerald-400/50"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-medium text-white">{preview.slug}</p>
                                  <ExternalLink className="h-4 w-4 shrink-0 text-emerald-200" />
                                </div>
                                <p className="mt-2 text-xs leading-5 text-zinc-400">{preview.nextAction}</p>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-3">
                      <div className="rounded-lg border border-zinc-800 bg-black p-3">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Approval gates</p>
                        <div className="mt-2 space-y-2">
                          {moneySprintMutation.data.approvalGates.map((gate) => (
                            <div key={gate} className="flex gap-2 text-sm leading-5 text-zinc-300">
                              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                              {gate}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-black p-3">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Next actions</p>
                        <div className="mt-2 space-y-2">
                          {moneySprintMutation.data.nextActions.map((action) => (
                            <div key={action} className="flex gap-2 text-sm leading-5 text-zinc-300">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                              {action}
                            </div>
                          ))}
                        </div>
                      </div>
                      {(moneySprintMutation.data.recordedLeads.length > 0 || moneySprintMutation.data.outreachDrafts.length > 0) && (
                        <div className="rounded-lg border border-zinc-800 bg-black p-3">
                          <p className="text-xs uppercase tracking-wide text-zinc-500">Created</p>
                          <p className="mt-2 text-sm text-zinc-300">
                            {moneySprintMutation.data.recordedLeads.length} leads · {moneySprintMutation.data.outreachDrafts.length} drafts
                          </p>
                        </div>
                      )}
                      {moneySprintMutation.data.blockedSeeds.length > 0 && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                          <p className="text-xs uppercase tracking-wide text-amber-200">Seed blocked</p>
                          <div className="mt-2 space-y-2">
                            {moneySprintMutation.data.blockedSeeds.map((seed) => (
                              <p key={`${seed.businessName}-${seed.reason}`} className="text-sm leading-5 text-zinc-300">
                                {seed.businessName}: {seed.reason}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="mb-4 border-zinc-800 bg-zinc-950/80">
                <CardHeader>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base">Candidatos verificados</CardTitle>
                      <p className="mt-1 text-sm text-zinc-500">
                        {snapshot?.publicLeadImportQueue.nextAction || "Cargando candidatos publicos."}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn(statusTone(snapshot?.publicLeadImportQueue.status || "review"), "shrink-0")}>
                      {snapshot?.publicLeadImportQueue.readyCount ?? 0} listos
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {publicScoutEvidenceResult && (
                    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <p className="text-sm font-medium text-cyan-100">{publicScoutEvidenceSummary}</p>
                        <Badge variant="outline" className={cn(statusTone(publicScoutEvidenceStatus), "shrink-0")}>
                          {publicScoutEvidenceStatus}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-300">
                        {publicScoutEvidenceResult.parsedCount} detectados · {publicScoutEvidenceResult.recordedCount} guardados · {publicScoutEvidenceResult.importableCount} listos · {publicScoutEvidenceResult.blockedCount} bloqueados
                      </p>
                      {publicScoutEvidenceResult.blockedSeeds.length > 0 && (
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {publicScoutEvidenceResult.blockedSeeds.slice(0, 4).map((seed) => (
                            <div key={`${seed.businessName}-${seed.reason}`} className="rounded-md border border-amber-500/20 bg-black px-3 py-2 text-xs text-amber-100">
                              {seed.businessName}: {seed.reason}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {publicScoutAgentCommandMutation.data && (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <p className="text-sm font-medium text-emerald-100">{publicScoutAgentCommandMutation.data.reason}</p>
                        <Badge variant="outline" className={cn(statusTone(publicScoutAgentCommandMutation.data.status), "shrink-0")}>
                          {publicScoutAgentCommandMutation.data.status}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-300">
                        {publicScoutAgentCommandMutation.data.evidenceResult.recordedCount} candidatos · {publicScoutAgentCommandMutation.data.readyCandidateIds.length} listos · {publicScoutAgentCommandMutation.data.sprintResult?.importedCandidateIds.length ?? 0} sprint
                      </p>
                      <div className="mt-2 grid gap-2 md:grid-cols-3">
                        <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">
                          Outreach {publicScoutAgentCommandMutation.data.safety.sendsOutreach ? "activo" : "bloqueado"}
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">
                          Spend {publicScoutAgentCommandMutation.data.safety.spendsMoney ? "activo" : "cero"}
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">
                          Deploy {publicScoutAgentCommandMutation.data.safety.deploys ? "activo" : "bloqueado"}
                        </div>
                      </div>
                    </div>
                  )}
                  {publicScoutConnectorIntakeMutation.data && (
                    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <p className="text-sm font-medium text-cyan-100">{publicScoutConnectorIntakeMutation.data.reason}</p>
                        <Badge variant="outline" className={cn(statusTone(publicScoutConnectorIntakeMutation.data.status), "shrink-0")}>
                          {publicScoutConnectorIntakeMutation.data.status}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-300">
                        {publicScoutConnectorIntakeMutation.data.connector.name} · {publicScoutConnectorIntakeMutation.data.connector.resultCount} enviados · {publicScoutConnectorIntakeMutation.data.recordedCount} guardados · {publicScoutConnectorIntakeMutation.data.importableCount} importables · {publicScoutConnectorIntakeMutation.data.blockedCount} bloqueados
                      </p>
                      <div className="mt-2 grid gap-2 md:grid-cols-3">
                        <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">
                          Review {publicScoutConnectorIntakeMutation.data.safety.requiresRobertReview ? "requerido" : "libre"}
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">
                          Import {publicScoutConnectorIntakeMutation.data.connector.approvalLocked ? "bloqueado" : "activo"}
                        </div>
                        <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">
                          Outreach {publicScoutConnectorIntakeMutation.data.safety.sendsOutreach ? "activo" : "bloqueado"}
                        </div>
                      </div>
                    </div>
                  )}
                  {publicLeadCandidateBatchMutation.data && (
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <p className="text-sm font-medium text-sky-100">{publicLeadCandidateBatchMutation.data.nextAction}</p>
                        <Badge variant="outline" className={cn(statusTone(publicLeadCandidateBatchMutation.data.status), "shrink-0")}>
                          {publicLeadCandidateBatchMutation.data.status}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-300">
                        {publicLeadCandidateBatchMutation.data.recordedCount} guardados · {publicLeadCandidateBatchMutation.data.importableCount} listos · {publicLeadCandidateBatchMutation.data.blockedCount} bloqueados
                      </p>
                      {publicLeadCandidateBatchMutation.data.blockedSeeds.length > 0 && (
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {publicLeadCandidateBatchMutation.data.blockedSeeds.slice(0, 4).map((seed) => (
                            <div key={`${seed.businessName}-${seed.reason}`} className="rounded-md border border-amber-500/20 bg-black px-3 py-2 text-xs text-amber-100">
                              {seed.businessName}: {seed.reason}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {(snapshot?.publicLeadImportQueue.items || []).length === 0 ? (
                    <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-500">
                      Sin candidatos aprobados para Money Sprint.
                    </div>
                  ) : (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {(snapshot?.publicLeadImportQueue.items || []).map((item) => (
                        <div key={item.candidateId} className="rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">{item.businessName}</p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {item.niche} · {item.area} · Grade {item.grade}/{item.score}
                              </p>
                            </div>
                            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-100">
                              verificado
                            </Badge>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-zinc-400">{item.nextAction}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.sourceUrl && (
                              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                                <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Fuente
                                </Button>
                              </a>
                            )}
                            <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                              {money.format(item.estimatedOfferUsd)}
                            </Badge>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => navigator.clipboard.writeText(item.copyableApprovalRequest)}
                              className="border-zinc-700"
                              data-testid={`button-copy-public-candidate-approval-${item.candidateId}`}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Copy approval JSON
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(snapshot?.publicLeadImportQueue.blocked || []).length > 0 && (
                    <div className="grid gap-2 md:grid-cols-2">
                      {(snapshot?.publicLeadImportQueue.blocked || []).slice(0, 4).map((item) => (
                        <div key={item.candidateId} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                          <p className="text-sm font-medium text-amber-100">{item.businessName}</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-300">{item.reason}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => navigator.clipboard.writeText(item.copyableRepairPacket)}
                              className="h-7 border-zinc-700 bg-black text-xs text-zinc-100 hover:bg-zinc-900"
                              data-testid={`button-copy-public-candidate-repair-${item.candidateId}`}
                            >
                              <Copy className="mr-1.5 h-3 w-3" />
                              Copy repair
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => navigator.clipboard.writeText(item.copyableApprovalRequest)}
                              className="h-7 border-zinc-700 bg-black text-xs text-zinc-100 hover:bg-zinc-900"
                              data-testid={`button-copy-public-candidate-approval-${item.candidateId}`}
                            >
                              <Copy className="mr-1.5 h-3 w-3" />
                              Copy approval JSON
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={publicLeadCandidateApproveMutation.isPending}
                              onClick={() => publicLeadCandidateApproveMutation.mutate(item.candidateId)}
                              className="h-7 border-amber-500/30 bg-black text-xs text-amber-100 hover:bg-amber-500/10"
                              data-testid={`button-approve-public-candidate-${item.candidateId}`}
                            >
                              {publicLeadCandidateApproveMutation.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3 w-3" />}
                              Robert approve import
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {publicLeadCandidateApproveMutation.data && (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <p className="text-sm font-medium text-emerald-100">{publicLeadCandidateApproveMutation.data.reason}</p>
                        <Badge variant="outline" className={cn(statusTone(publicLeadCandidateApproveMutation.data.status), "shrink-0")}>
                          {publicLeadCandidateApproveMutation.data.status}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-300">
                        Leads {publicLeadCandidateApproveMutation.data.safety.persistsLeads ? "creados" : "no creados"} · Outreach {publicLeadCandidateApproveMutation.data.safety.sendsOutreach ? "activo" : "bloqueado"} · Spend {publicLeadCandidateApproveMutation.data.safety.spendsMoney ? "activo" : "cero"}
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={publicCandidateSprintMutation.isPending || (snapshot?.publicLeadImportQueue.readyCount || 0) === 0}
                      onClick={() => publicCandidateSprintMutation.mutate()}
                      className="bg-emerald-600 text-white hover:bg-emerald-500"
                      data-testid="button-run-money-sprint-public-candidates"
                    >
                      {publicCandidateSprintMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeDollarSign className="mr-2 h-4 w-4" />}
                      Money sprint con candidatos
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={(snapshot?.publicLeadImportQueue.readyCount || 0) === 0}
                      onClick={() => navigator.clipboard.writeText(snapshot?.publicLeadImportQueue.copyableMoneySprintRequest || "")}
                      className="border-zinc-700"
                      data-testid="button-copy-public-candidate-money-sprint-request"
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy sprint JSON
                    </Button>
                    {publicCandidateSprintMutation.data && (
                      <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                        {publicCandidateSprintMutation.data.reason} {publicCandidateSprintMutation.data.importedCandidateIds.length} importados.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="mb-4 border-sky-500/20 bg-zinc-950/80">
                <CardHeader>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base">Paquetes listos para vender website</CardTitle>
                      <p className="mt-1 text-sm text-zinc-500">
                        {snapshot?.websiteSalesPacketQueue.nextAction || "Cargando paquetes de venta."}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn(statusTone(snapshot?.websiteSalesPacketQueue.status || "review"), "shrink-0")}>
                      {snapshot?.websiteSalesPacketQueue.readyCount ?? 0} listos
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(snapshot?.websiteSalesPacketQueue.items || []).length === 0 ? (
                    <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-500">
                      Sin paquetes con mockup + oferta listos todavia.
                    </div>
                  ) : (
                    <div className="grid gap-3 xl:grid-cols-2">
                      {(snapshot?.websiteSalesPacketQueue.items || []).map((item) => (
                        <div key={item.leadId} className="rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">{item.businessName}</p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {item.niche} · {item.area} · {item.primaryOffer}
                              </p>
                            </div>
                            <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-100">
                              {item.grade}/{item.score}
                            </Badge>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                              <p className="text-xs text-zinc-500">Setup</p>
                              <p className="mt-1 text-sm font-semibold text-white">{money.format(item.estimatedSetupUsd)}</p>
                            </div>
                            <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                              <p className="text-xs text-zinc-500">Deposito</p>
                              <p className="mt-1 text-sm font-semibold text-white">{money.format(item.depositUsd)}</p>
                            </div>
                            <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                              <p className="text-xs text-zinc-500">Retainer</p>
                              <p className="mt-1 text-sm font-semibold text-white">{money.format(item.monthlyRetainerUsd)}</p>
                            </div>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-zinc-400">{item.nextAction}</p>
                          <div className="mt-3 rounded-md border border-emerald-500/15 bg-emerald-500/5 px-3 py-2" data-testid={`panel-website-close-plan-${item.leadId}`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium text-emerald-100">Plan de cierre</p>
                              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-100">
                                {money.format(item.closePlan.requiredDepositUsd)} deposito
                              </Badge>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-emerald-100/80">{item.closePlan.nextCloseAction}</p>
                            <p className="mt-2 text-xs leading-5 text-zinc-500">
                              Evidencia: {(item.closePlan.paymentEvidenceRequired || []).slice(0, 2).join(" · ")}
                            </p>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="border-zinc-700"
                              onClick={() => navigator.clipboard.writeText(item.copyableSalesPacket)}
                              data-testid={`button-copy-website-sales-packet-${item.leadId}`}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Copy packet
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="border-emerald-700 text-emerald-100"
                              disabled={item.draftStatus !== "approved"}
                              onClick={() => navigator.clipboard.writeText(item.closePlan.copyableClosePacket)}
                              data-testid={`button-copy-website-close-plan-${item.leadId}`}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Copy close
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="border-zinc-700"
                              onClick={() => navigator.clipboard.writeText(item.copyableOpportunityRequest)}
                              data-testid={`button-copy-website-opportunity-request-${item.leadId}`}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Copy opp JSON
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="border-emerald-700 text-emerald-100"
                              onClick={() => navigator.clipboard.writeText(item.closePlan.copyableCloseRequest)}
                              data-testid={`button-copy-website-close-request-${item.leadId}`}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Copy close JSON
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={outreachApproveMutation.isPending || item.draftStatus === "approved"}
                              onClick={() => outreachApproveMutation.mutate(item.outreachDraftId)}
                              className="border-sky-700 text-sky-100"
                              data-testid={`button-approve-website-sales-draft-${item.outreachDraftId}`}
                            >
                              {outreachApproveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                              {item.draftStatus === "approved" ? "Draft aprobado" : "Aprobar draft"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={websiteOpportunityMutation.isPending || item.draftStatus !== "approved"}
                              onClick={() => websiteOpportunityMutation.mutate(item)}
                              className="bg-sky-600 text-white hover:bg-sky-500"
                              data-testid={`button-create-website-opportunity-${item.leadId}`}
                            >
                              {websiteOpportunityMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CircleDollarSign className="mr-2 h-4 w-4" />}
                              Crear oportunidad
                            </Button>
                            {item.mockupUrl && (
                              <a href={item.mockupUrl} target="_blank" rel="noreferrer">
                                <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Mockup
                                </Button>
                              </a>
                            )}
                            {item.sourceUrl && (
                              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                                <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Fuente
                                </Button>
                              </a>
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.readiness.map((ready) => (
                              <Badge key={ready} variant="outline" className="border-zinc-700 text-zinc-300">
                                {ready}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(snapshot?.websiteSalesPacketQueue.blocked || []).length > 0 && (
                    <div className="grid gap-2 md:grid-cols-2">
                      {(snapshot?.websiteSalesPacketQueue.blocked || []).slice(0, 4).map((item) => (
                        <div key={item.leadId} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                          <p className="text-sm font-medium text-amber-100">{item.businessName}</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-300">{item.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="mb-4 border-emerald-500/20 bg-zinc-950/80">
                <CardHeader>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base">Oportunidades website</CardTitle>
                      <p className="mt-1 text-sm text-zinc-500">
                        Cotizadas hasta que deposito y scope las convierten en delivery.
                      </p>
                    </div>
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-100">
                      {snapshot?.websiteClosureQueue.readyCount ?? 0} por cerrar
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(snapshot?.websiteClosureQueue.items || []).length === 0 ? (
                    <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-500">
                      Sin oportunidades website pendientes de scope/deposito.
                    </div>
                  ) : (
                    <div className="grid gap-3 xl:grid-cols-2">
                      {(snapshot?.websiteClosureQueue.items || []).map((opportunity) => {
                        const scopeApprovedForClose = opportunity.scopeApproved || Boolean(websiteOpportunityScopeApprovals[opportunity.id]);
                        const closeInput = websiteOpportunityCloseInputs[opportunity.id] || {};
                        const closeCashValue = closeInput.cashCollectedUsd ?? String(opportunity.cashCollectedUsd || opportunity.requiredDepositUsd || 0);
                        const closeCashCollectedUsd = Number(closeCashValue) || 0;
                        const closePaymentConfirmation = closeInput.paymentConfirmation ?? opportunity.paymentConfirmation;
                        const closeNotes = closeInput.notes ?? "";
                        const closeHasPaymentConfirmation = hasVerifiablePaymentEvidence(closePaymentConfirmation);
                        const closeHasCash = closeCashCollectedUsd > 0;
                        const closeDepositCoversRequired = closeCashCollectedUsd >= opportunity.requiredDepositUsd;
                        const shouldRecordDepositOutcome = closeDepositCoversRequired && (
                          !opportunity.depositPaid
                          || closeCashCollectedUsd !== opportunity.cashCollectedUsd
                          || !opportunity.paymentConfirmation
                        );
                        return (
                          <div key={opportunity.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-white">{opportunity.businessName}</p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  {opportunity.projectType} · deposito {money.format(opportunity.requiredDepositUsd)} · cash {money.format(opportunity.cashCollectedUsd)}
                                </p>
                              </div>
                              <Badge variant="outline" className={cn(statusTone(opportunity.status), "shrink-0")}>{opportunity.status}</Badge>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-zinc-400">{opportunity.nextAction}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Badge variant="outline" className={cn(opportunity.depositPaid ? statusTone("ready") : statusTone("blocked"))}>
                                {opportunity.depositPaid ? "deposito registrado" : "falta deposito"}
                              </Badge>
                              <Badge variant="outline" className={cn(closeDepositCoversRequired ? statusTone("ready") : statusTone("blocked"))}>
                                {closeDepositCoversRequired ? "monto suficiente" : "monto parcial"}
                              </Badge>
                              <Badge variant="outline" className={cn(opportunity.priority === "high" ? statusTone("ready_to_start") : statusTone("draft"))}>
                                {opportunity.closureStage}
                              </Badge>
                              <label className="flex h-8 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300">
                                <input
                                  type="checkbox"
                                  checked={scopeApprovedForClose}
                                  disabled={opportunity.status === "sold"}
                                  onChange={() => {
                                    setWebsiteOpportunityScopeApprovals((current) => ({
                                      ...current,
                                      [opportunity.id]: !scopeApprovedForClose,
                                    }));
                                  }}
                                  data-testid={`checkbox-website-opportunity-scope-${opportunity.id}`}
                                />
                                Scope aprobado
                              </label>
                            </div>
                            {opportunity.status !== "sold" && (
                              <div className="mt-3 grid gap-2 md:grid-cols-2">
                                <div className="space-y-1">
                                  <label className="text-[11px] uppercase tracking-wide text-zinc-500" htmlFor={`website-opportunity-cash-${opportunity.id}`}>
                                    Deposito cobrado
                                  </label>
                                  <Input
                                    id={`website-opportunity-cash-${opportunity.id}`}
                                    type="number"
                                    min={0}
                                    value={closeCashValue}
                                    onChange={(event) => {
                                      setWebsiteOpportunityCloseInputs((current) => ({
                                        ...current,
                                        [opportunity.id]: {
                                          ...current[opportunity.id],
                                          cashCollectedUsd: event.target.value,
                                        },
                                      }));
                                    }}
                                    className="h-9 border-zinc-800 bg-zinc-950 text-sm"
                                    data-testid={`input-website-opportunity-cash-${opportunity.id}`}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] uppercase tracking-wide text-zinc-500" htmlFor={`website-opportunity-payment-${opportunity.id}`}>
                                    Confirmacion
                                  </label>
                                  <Input
                                    id={`website-opportunity-payment-${opportunity.id}`}
                                    value={closePaymentConfirmation}
                                    onChange={(event) => {
                                      setWebsiteOpportunityCloseInputs((current) => ({
                                        ...current,
                                        [opportunity.id]: {
                                          ...current[opportunity.id],
                                          paymentConfirmation: event.target.value,
                                        },
                                      }));
                                    }}
                                    className="h-9 border-zinc-800 bg-zinc-950 text-sm"
                                    placeholder="Stripe pi_..., Zelle ref 123456, invoice INV-123"
                                    data-testid={`input-website-opportunity-payment-${opportunity.id}`}
                                  />
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                  <label className="text-[11px] uppercase tracking-wide text-zinc-500" htmlFor={`website-opportunity-notes-${opportunity.id}`}>
                                    Nota de cierre
                                  </label>
                                  <Input
                                    id={`website-opportunity-notes-${opportunity.id}`}
                                    value={closeNotes}
                                    onChange={(event) => {
                                      setWebsiteOpportunityCloseInputs((current) => ({
                                        ...current,
                                        [opportunity.id]: {
                                          ...current[opportunity.id],
                                          notes: event.target.value,
                                        },
                                      }));
                                    }}
                                    className="h-9 border-zinc-800 bg-zinc-950 text-sm"
                                    placeholder="Scope y deposito aprobados por Robert"
                                    data-testid={`input-website-opportunity-close-notes-${opportunity.id}`}
                                  />
                                </div>
                              </div>
                            )}
                            {opportunity.status !== "sold" && (
                              <div className="mt-3 grid gap-1 text-xs text-zinc-500">
                                {!scopeApprovedForClose && <p>Falta aprobar scope.</p>}
                                {!closeHasCash && <p>Falta monto de deposito.</p>}
                                {closeHasCash && !closeDepositCoversRequired && <p>El monto capturado no cubre el deposito requerido.</p>}
                                {!closeHasPaymentConfirmation && <p>Falta referencia verificable: Stripe/Zelle/bank ref, invoice, receipt o confirmation id.</p>}
                                {shouldRecordDepositOutcome && <p>El cierre registrara primero el deposito manual en el outreach.</p>}
                              </div>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border-zinc-700"
                                onClick={() => navigator.clipboard.writeText(opportunity.copyableClosurePacket)}
                                data-testid={`button-copy-website-closure-packet-${opportunity.id}`}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy close
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border-emerald-700 text-emerald-100"
                                onClick={() => navigator.clipboard.writeText(opportunity.copyableCloseRequest)}
                                data-testid={`button-copy-website-closure-request-${opportunity.id}`}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy request
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={
                                  websiteOpportunityCloseMutation.isPending
                                  || opportunity.status === "sold"
                                  || !scopeApprovedForClose
                                  || !closeHasCash
                                  || !closeDepositCoversRequired
                                  || !closeHasPaymentConfirmation
                                }
                                onClick={() => websiteOpportunityCloseMutation.mutate({
                                  opportunity,
                                  scopeApproved: scopeApprovedForClose,
                                  cashCollectedUsd: closeCashCollectedUsd,
                                  paymentConfirmation: closePaymentConfirmation,
                                  notes: closeNotes,
                                  recordDepositOutcome: shouldRecordDepositOutcome,
                                })}
                                className="bg-emerald-600 text-white hover:bg-emerald-500"
                                data-testid={`button-close-website-opportunity-${opportunity.id}`}
                              >
                                {websiteOpportunityCloseMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                {closeDepositCoversRequired && scopeApprovedForClose ? "Registrar deposito y vender" : "Deposito completo + scope"}
                              </Button>
                              {opportunity.mockupUrl && (
                                <a href={opportunity.mockupUrl} target="_blank" rel="noreferrer">
                                  <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    Mockup
                                  </Button>
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {websiteOpportunityMutation.data && (
                    <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                      {websiteOpportunityMutation.data.reason}
                    </div>
                  )}
                  {websiteOpportunityCloseMutation.data && (
                    <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                      {websiteOpportunityCloseMutation.data.reason}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Search className="h-4 w-4 text-emerald-200" />
                      Registrar lead
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        leadMutation.mutate();
                      }}
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-business">
                            Negocio
                          </label>
                          <Input
                            id="lead-business"
                            value={leadBusinessName}
                            onChange={(event) => setLeadBusinessName(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-lead-business"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-area">
                            Area
                          </label>
                          <Input
                            id="lead-area"
                            value={leadArea}
                            onChange={(event) => setLeadArea(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-lead-area"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-niche">
                          Nicho
                        </label>
                        <Input
                          id="lead-niche"
                          value={leadNiche}
                          onChange={(event) => setLeadNiche(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-lead-niche"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-website-status">
                            Website
                          </label>
                          <select
                            id="lead-website-status"
                            value={leadWebsiteStatus}
                            onChange={(event) => setLeadWebsiteStatus(event.target.value as typeof leadWebsiteStatus)}
                            className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                            data-testid="select-lead-website-status"
                          >
                            <option value="no_website">No website</option>
                            <option value="weak_website">Website debil</option>
                            <option value="has_website">Tiene website</option>
                            <option value="unknown">No confirmado</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-offer">
                            Oferta estimada
                          </label>
                          <Input
                            id="lead-offer"
                            type="number"
                            min={0}
                            value={leadEstimatedOfferUsd}
                            onChange={(event) => setLeadEstimatedOfferUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-lead-offer"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-contact-channel">
                            Canal
                          </label>
                          <select
                            id="lead-contact-channel"
                            value={leadContactChannel}
                            onChange={(event) => setLeadContactChannel(event.target.value as typeof leadContactChannel)}
                            className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                            data-testid="select-lead-contact-channel"
                          >
                            <option value="email">Email</option>
                            <option value="phone">Telefono</option>
                            <option value="instagram">Instagram</option>
                            <option value="contact_form">Contact form</option>
                            <option value="unknown">No confirmado</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-contact">
                            Contacto
                          </label>
                          <Input
                            id="lead-contact"
                            value={leadContactValue}
                            onChange={(event) => setLeadContactValue(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-lead-contact"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-source-url">
                          Fuente publica
                        </label>
                        <Input
                          id="lead-source-url"
                          value={leadSourceUrl}
                          onChange={(event) => setLeadSourceUrl(event.target.value)}
                          className="border-zinc-800 bg-black"
                          placeholder="https://..."
                          data-testid="input-lead-source-url"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-recipient-email">
                            Email para draft
                          </label>
                          <Input
                            id="lead-recipient-email"
                            type="email"
                            value={leadRecipientEmail}
                            onChange={(event) => setLeadRecipientEmail(event.target.value)}
                            className="border-zinc-800 bg-black"
                            placeholder="owner@business.com"
                            data-testid="input-lead-recipient-email"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-contact-name">
                            Nombre
                          </label>
                          <Input
                            id="lead-contact-name"
                            value={leadContactName}
                            onChange={(event) => setLeadContactName(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-lead-contact-name"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-evidence">
                          Evidencia publica
                        </label>
                        <Textarea
                          id="lead-evidence"
                          value={leadEvidence}
                          onChange={(event) => setLeadEvidence(event.target.value)}
                          className="min-h-[92px] border-zinc-800 bg-black"
                          data-testid="textarea-lead-evidence"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-pain">
                          Dolor / oportunidad
                        </label>
                        <Textarea
                          id="lead-pain"
                          value={leadPainPoint}
                          onChange={(event) => setLeadPainPoint(event.target.value)}
                          className="min-h-[80px] border-zinc-800 bg-black"
                          data-testid="textarea-lead-pain"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="lead-summary">
                          Resumen para outreach
                        </label>
                        <Textarea
                          id="lead-summary"
                          value={leadBusinessSummary}
                          onChange={(event) => setLeadBusinessSummary(event.target.value)}
                          className="min-h-[76px] border-zinc-800 bg-black"
                          data-testid="textarea-lead-summary"
                        />
                      </div>
                      <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300" htmlFor="include-lead-money-sprint">
                        <input
                          id="include-lead-money-sprint"
                          type="checkbox"
                          checked={includeLeadInMoneySprint}
                          onChange={(event) => setIncludeLeadInMoneySprint(event.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-zinc-700 bg-black text-emerald-500"
                          data-testid="checkbox-include-lead-money-sprint"
                        />
                        <span>
                          Incluir este lead en Money sprint para crear preview y outreach draft si pasa los gates.
                        </span>
                      </label>
                      <div className="grid gap-2 text-sm text-zinc-300">
                        <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-black p-3" htmlFor="candidate-public-verified">
                          <input
                            id="candidate-public-verified"
                            type="checkbox"
                            checked={candidatePublicEvidenceVerified}
                            onChange={(event) => setCandidatePublicEvidenceVerified(event.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-zinc-700 bg-black text-emerald-500"
                            data-testid="checkbox-candidate-public-verified"
                          />
                          <span>Verifique que la fuente/contacto/evidencia del lead o batch pegado son publicos y reales.</span>
                        </label>
                        <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-black p-3" htmlFor="candidate-approval-import">
                          <input
                            id="candidate-approval-import"
                            type="checkbox"
                            checked={candidateApprovalToImport}
                            onChange={(event) => setCandidateApprovalToImport(event.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-zinc-700 bg-black text-emerald-500"
                            data-testid="checkbox-candidate-approval-import"
                          />
                          <span>Aprobar el lead o todas las filas del batch pegado para la cola de candidatos. No contacta, no scrapea, no gasta.</span>
                        </label>
                        <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-black p-3" htmlFor="candidate-robert-approved-import">
                          <input
                            id="candidate-robert-approved-import"
                            type="checkbox"
                            checked={candidateRobertApprovedImport}
                            onChange={(event) => setCandidateRobertApprovedImport(event.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-zinc-700 bg-black text-emerald-500"
                            data-testid="checkbox-candidate-robert-approved-import"
                          />
                          <span>Robert aprobó explícitamente importar estos candidatos al Money Sprint. Sin esto quedan en revisión.</span>
                        </label>
                      </div>
                      <Button
                        type="submit"
                        disabled={leadMutation.isPending}
                        className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                        data-testid="button-record-lead"
                      >
                        {leadMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                        Calificar lead
                      </Button>
                      <Button
                        type="button"
                        disabled={publicLeadCandidateMutation.isPending}
                        onClick={() => publicLeadCandidateMutation.mutate()}
                        className="w-full bg-zinc-800 text-white hover:bg-zinc-700"
                        data-testid="button-record-public-candidate"
                      >
                        {publicLeadCandidateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
                        Guardar candidato publico
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  {publicLeadCandidateMutation.data && (
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <CardTitle className="text-base">{publicLeadCandidateMutation.data.candidate.businessName}</CardTitle>
                            <p className="mt-1 text-sm text-zinc-500">{publicLeadCandidateMutation.data.nextAction}</p>
                          </div>
                          <Badge variant="outline" className={cn(statusTone(publicLeadCandidateMutation.data.status), "shrink-0")}>
                            {publicLeadCandidateMutation.data.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="grid gap-3 md:grid-cols-[1fr_220px]">
                        <div className="rounded-lg border border-zinc-800 bg-black p-3">
                          <p className="text-xs uppercase tracking-wide text-zinc-500">Batch row</p>
                          <p className="mt-2 break-all text-xs leading-5 text-zinc-300">{publicLeadCandidateMutation.data.candidate.batchRow}</p>
                        </div>
                        <div className="rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                          <p>{publicLeadCandidateMutation.data.importableCount} listos para preview</p>
                          <p className="mt-2 text-xs text-zinc-500">
                            Lead real: {publicLeadCandidateMutation.data.candidate.safety.persistsLead ? "yes" : "no"} · Outreach: {publicLeadCandidateMutation.data.candidate.safety.sendsOutreach ? "yes" : "no"}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {leadMutation.data && (
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <CardTitle className="text-base">{leadMutation.data.lead.businessName}</CardTitle>
                            <p className="mt-1 text-sm text-zinc-500">{leadMutation.data.qualification.guardrail}</p>
                          </div>
                          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                            Grade {leadMutation.data.qualification.grade} · {leadMutation.data.qualification.score}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="grid gap-4 lg:grid-cols-[1fr_320px]">
                        <div className="space-y-3">
                          <p className="rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-6 text-zinc-300">
                            {leadMutation.data.qualification.outreachDraft}
                          </p>
                          <div className="grid gap-2 md:grid-cols-2">
                            <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                              Next agent: {leadMutation.data.qualification.nextAgent}
                            </div>
                            <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                              Status: {leadMutation.data.lead.status}
                            </div>
                          </div>
                        </div>
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                          <p className="text-xs uppercase tracking-wide text-amber-200">Falta antes de contactar</p>
                          <div className="mt-2 space-y-2">
                            {leadMutation.data.qualification.missing.length === 0 ? (
                              <p className="text-sm text-emerald-100">Nada critico. Mantener en draft hasta aprobar envio.</p>
                            ) : (
                              leadMutation.data.qualification.missing.map((item) => (
                                <p key={item} className="text-sm text-zinc-300">{item}</p>
                              ))
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardHeader>
                      <CardTitle className="text-base">Intakes recientes</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(snapshot?.recentAutomationIntakes || []).length === 0 ? (
                        <div className="rounded-lg border border-dashed border-zinc-800 bg-black p-5 text-center text-sm text-zinc-500">
                          Todavia no hay pedidos de automatizacion guardados.
                        </div>
                      ) : (
                        snapshot?.recentAutomationIntakes.slice(0, 4).map((intake) => (
                          <div key={intake.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-white">{intake.businessName}</p>
                                <p className="mt-1 text-sm text-zinc-500">{intake.nextAction}</p>
                              </div>
                              <Badge variant="outline" className={cn(statusTone(intake.status === "needs_answers" ? "approval_required" : "pass"), "shrink-0")}>
                                {intake.status}
                              </Badge>
                            </div>
                            {intake.nextQuestions.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {intake.nextQuestions.slice(0, 4).map((question) => (
                                  <div key={question} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                                    {question}
                                  </div>
                                ))}
                              </div>
                            )}
                            {intake.blockedUntilAnswered.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1">
                                {intake.blockedUntilAnswered.map((block) => (
                                  <Badge key={`${intake.id}-${block}`} variant="outline" className="border-red-500/30 text-red-100">
                                    bloquea {block}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {intake.status === "needs_answers" && (
                              <div className="mt-3 rounded-md border border-sky-500/20 bg-sky-500/5 p-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-sky-100">Plantilla minima</p>
                                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs leading-5 text-zinc-300">{intake.answerTemplate}</pre>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setAutomationIntakeAnswers(intake.answerTemplate)}
                                    className="border-sky-500/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                                    data-testid={`button-use-intake-template-${intake.id}`}
                                  >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Usar plantilla
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={automationIntakeAnswerMutation.isPending}
                                    onClick={() => automationIntakeAnswerMutation.mutate(intake.id)}
                                    className="bg-sky-600 text-white hover:bg-sky-500"
                                    data-testid={`button-answer-specific-intake-${intake.id}`}
                                  >
                                    {automationIntakeAnswerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                    Guardar respuesta
                                  </Button>
                                </div>
                              </div>
                            )}
                            {intake.status === "ready_for_quote" && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={automationIntakeConvertMutation.isPending}
                                onClick={() => automationIntakeConvertMutation.mutate(intake.id)}
                                className="mt-3 w-full border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                                data-testid={`button-convert-automation-intake-${intake.id}`}
                              >
                                {automationIntakeConvertMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Crear oportunidad/cotizacion
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                      {automationIntakeConvertMutation.data && automationIntakeConvertMutation.data.status !== "converted" && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                          {automationIntakeConvertMutation.data.reason}
                        </div>
                      )}
                      <div className="rounded-lg border border-zinc-800 bg-black p-3">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Responder intake</p>
                        <Textarea
                          value={automationIntakeAnswers}
                          onChange={(event) => setAutomationIntakeAnswers(event.target.value)}
                          className="mt-2 min-h-[76px] border-zinc-800 bg-zinc-950"
                          data-testid="textarea-automation-intake-answers"
                        />
                        <Button
                          type="button"
                          disabled={automationIntakeAnswerMutation.isPending || (snapshot?.recentAutomationIntakes || []).length === 0}
                          onClick={() => automationIntakeAnswerMutation.mutate(undefined)}
                          className="mt-2 w-full bg-sky-600 text-white hover:bg-sky-500"
                          data-testid="button-answer-automation-intake"
                        >
                          {automationIntakeAnswerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                          Guardar respuestas
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardHeader>
                      <CardTitle className="text-base">Leads recientes</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {(snapshot?.recentLeads || []).length === 0 ? (
                        <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-500">
                          Todavia no hay leads guardados.
                        </div>
                      ) : (
                        (snapshot?.recentLeads || []).map((lead) => (
                          <div key={lead.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="text-sm font-medium text-white">{lead.businessName}</p>
                                <p className="mt-1 text-xs text-zinc-500">{lead.niche} · {lead.area} · {lead.websiteStatus}</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline" className={cn(statusTone(lead.status), "shrink-0")}>
                                  {lead.status}
                                </Badge>
                                <Badge variant="outline" className="border-zinc-700 text-zinc-300">
                                  {money.format(lead.estimatedOfferUsd)}
                                </Badge>
                              </div>
                            </div>
                            <p className="mt-3 text-sm text-zinc-400">{lead.painPoint || lead.evidence}</p>
                          </div>
                        ))
                      )}
                  </CardContent>
                </Card>
              </div>
            </div>
            </TabsContent>

            <TabsContent value="mockup" className="mt-0">
              <div className="space-y-4">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Sparkles className="h-4 w-4 text-amber-200" />
                          Template factory
                        </CardTitle>
                        <p className="mt-1 text-sm text-zinc-500">
                          Cinco bases premium por nicho para sacar mockups rapidos con costo casi cero.
                        </p>
                      </div>
                      <Badge variant="outline" className="w-fit border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                        $0 hosting / $0 assets pagos
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="grid gap-3 md:grid-cols-5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        mockupTemplatePackMutation.mutate();
                      }}
                    >
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="template-pack-niche">
                          Nicho
                        </label>
                        <Input
                          id="template-pack-niche"
                          value={templatePackNiche}
                          onChange={(event) => setTemplatePackNiche(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-template-pack-niche"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="template-pack-area">
                          Area
                        </label>
                        <Input
                          id="template-pack-area"
                          value={templatePackArea}
                          onChange={(event) => setTemplatePackArea(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-template-pack-area"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="template-pack-daily">
                          Mockups / dia
                        </label>
                        <Input
                          id="template-pack-daily"
                          type="number"
                          min={1}
                          max={50}
                          value={templatePackDailyMockups}
                          onChange={(event) => setTemplatePackDailyMockups(Number(event.target.value))}
                          className="border-zinc-800 bg-black"
                          data-testid="input-template-pack-daily"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="template-pack-minutes">
                          Min / mockup
                        </label>
                        <Input
                          id="template-pack-minutes"
                          type="number"
                          min={5}
                          max={120}
                          value={templatePackMinutes}
                          onChange={(event) => setTemplatePackMinutes(Number(event.target.value))}
                          className="border-zinc-800 bg-black"
                          data-testid="input-template-pack-minutes"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="template-pack-ai-cost">
                          AI $ / mockup
                        </label>
                        <div className="flex gap-2">
                          <Input
                            id="template-pack-ai-cost"
                            type="number"
                            min={0}
                            step="0.01"
                            value={templatePackAiCostUsd}
                            onChange={(event) => setTemplatePackAiCostUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-template-pack-ai-cost"
                          />
                          <Button
                            type="submit"
                            disabled={mockupTemplatePackMutation.isPending}
                            className="shrink-0 bg-amber-500 text-black hover:bg-amber-400"
                            data-testid="button-template-pack"
                          >
                            {mockupTemplatePackMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    </form>

                    {mockupTemplatePackMutation.data && (
                      <div className="mt-5 space-y-4">
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="rounded-md border border-zinc-800 bg-black p-4">
                            <p className="text-xs text-zinc-500">Costo / dia</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{money.format(mockupTemplatePackMutation.data.costModel.dailyAiCostUsd)}</p>
                          </div>
                          <div className="rounded-md border border-zinc-800 bg-black p-4">
                            <p className="text-xs text-zinc-500">Costo / mes</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{money.format(mockupTemplatePackMutation.data.costModel.monthlyAiCostUsd)}</p>
                          </div>
                          <div className="rounded-md border border-zinc-800 bg-black p-4">
                            <p className="text-xs text-zinc-500">Mockups / mes</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{mockupTemplatePackMutation.data.productionTargets.estimatedMockupsPerMonth}</p>
                          </div>
                          <div className="rounded-md border border-zinc-800 bg-black p-4">
                            <p className="text-xs text-zinc-500">Contactos / dia</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{mockupTemplatePackMutation.data.productionTargets.recommendedContactLimitPerDay}</p>
                          </div>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-5">
                          {mockupTemplatePackMutation.data.templates.map((template) => (
                            <div key={template.id} className="rounded-md border border-zinc-800 bg-black p-4">
                              <p className="text-sm font-semibold text-white">{template.name}</p>
                              <p className="mt-2 min-h-[60px] text-xs leading-5 text-zinc-400">{template.bestFor}</p>
                              <div className="mt-3 flex flex-wrap gap-1">
                                {template.animationHooks.slice(0, 3).map((hook) => (
                                  <Badge key={hook} variant="outline" className="border-zinc-700 text-[10px] text-zinc-300">
                                    {hook}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
                          <div className="rounded-md border border-zinc-800 bg-black p-4">
                            <p className="text-sm font-semibold text-white">Linea de produccion</p>
                            <div className="mt-3 grid gap-2 md:grid-cols-5">
                              {mockupTemplatePackMutation.data.productionLine.map((item) => (
                                <div key={item.step} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                                  <p className="text-xs font-medium text-amber-200">{item.ownerAgent}</p>
                                  <p className="mt-1 text-sm text-white">{item.step}</p>
                                  <p className="mt-2 text-xs leading-5 text-zinc-500">{item.output}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-md border border-zinc-800 bg-black p-4">
                            <p className="text-sm font-semibold text-white">Precio recomendado</p>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                              <span className="text-zinc-500">Entry</span>
                              <span className="text-right text-white">{money.format(mockupTemplatePackMutation.data.pricingRecommendation.entryMockupWebsiteUsd)}</span>
                              <span className="text-zinc-500">Pro site</span>
                              <span className="text-right text-white">{money.format(mockupTemplatePackMutation.data.pricingRecommendation.proWebsiteUsd)}</span>
                              <span className="text-zinc-500">Bundle</span>
                              <span className="text-right text-white">{money.format(mockupTemplatePackMutation.data.pricingRecommendation.automationBundleUsd)}</span>
                              <span className="text-zinc-500">Retainer</span>
                              <span className="text-right text-white">{money.format(mockupTemplatePackMutation.data.pricingRecommendation.monthlyRetainerUsd)}/mo</span>
                            </div>
                            <p className="mt-3 text-xs leading-5 text-zinc-500">{mockupTemplatePackMutation.data.costModel.spendPolicy}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Sparkles className="h-4 w-4 text-fuchsia-200" />
                      Mockup builder
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        mockupMutation.mutate();
                      }}
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="mockup-business">
                            Negocio
                          </label>
                          <Input
                            id="mockup-business"
                            value={mockupBusinessName}
                            onChange={(event) => setMockupBusinessName(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-mockup-business"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="mockup-area">
                            Area
                          </label>
                          <Input
                            id="mockup-area"
                            value={mockupArea}
                            onChange={(event) => setMockupArea(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-mockup-area"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="mockup-niche">
                          Nicho
                        </label>
                        <Input
                          id="mockup-niche"
                          value={mockupNiche}
                          onChange={(event) => setMockupNiche(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-mockup-niche"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="mockup-website-status">
                            Website
                          </label>
                          <select
                            id="mockup-website-status"
                            value={mockupWebsiteStatus}
                            onChange={(event) => setMockupWebsiteStatus(event.target.value as typeof mockupWebsiteStatus)}
                            className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                            data-testid="select-mockup-website-status"
                          >
                            <option value="no_website">No website</option>
                            <option value="weak_website">Website debil</option>
                            <option value="has_website">Tiene website</option>
                            <option value="unknown">No confirmado</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="mockup-offer-usd">
                            Setup base
                          </label>
                          <Input
                            id="mockup-offer-usd"
                            type="number"
                            min={0}
                            value={mockupEstimatedOfferUsd}
                            onChange={(event) => setMockupEstimatedOfferUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-mockup-offer-usd"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="mockup-primary-offer">
                          Paquete
                        </label>
                        <Input
                          id="mockup-primary-offer"
                          value={mockupPrimaryOffer}
                          onChange={(event) => setMockupPrimaryOffer(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-mockup-primary-offer"
                        />
                      </div>
                      <label className="flex min-h-10 items-center gap-3 rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                        <input
                          type="checkbox"
                          checked={mockupIncludeAutomation}
                          onChange={() => setMockupIncludeAutomation((current) => !current)}
                          className="h-4 w-4 rounded border-zinc-700 bg-black"
                          data-testid="checkbox-mockup-automation"
                        />
                        Incluir automation sprint
                      </label>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="mockup-evidence">
                          Evidencia
                        </label>
                        <Textarea
                          id="mockup-evidence"
                          value={mockupEvidence}
                          onChange={(event) => setMockupEvidence(event.target.value)}
                          className="min-h-[88px] border-zinc-800 bg-black"
                          data-testid="textarea-mockup-evidence"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="mockup-pain">
                          Dolor / oportunidad
                        </label>
                        <Textarea
                          id="mockup-pain"
                          value={mockupPainPoint}
                          onChange={(event) => setMockupPainPoint(event.target.value)}
                          className="min-h-[80px] border-zinc-800 bg-black"
                          data-testid="textarea-mockup-pain"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={mockupMutation.isPending}
                        className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                        data-testid="button-build-mockup"
                      >
                        {mockupMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        Crear mockup
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {!mockupMutation.data ? (
                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardContent className="flex min-h-[520px] items-center justify-center p-6 text-center text-sm text-zinc-500">
                      Genera un mockup interno para vender website + automatizaciones. Nada se publica ni se envia sin QA.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <Card className="overflow-hidden border-zinc-800 bg-black">
                      <CardContent className="p-0">
                        <div className="grid min-h-[380px] gap-0 lg:grid-cols-[1fr_420px]">
                          <div className="flex flex-col justify-between p-6 md:p-8">
                            <div>
                              <Badge variant="outline" className="mb-4 border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                                {mockupMutation.data.copy.eyebrow}
                              </Badge>
                              <h2 className="max-w-3xl text-3xl font-semibold leading-tight text-white md:text-5xl">
                                {mockupMutation.data.copy.headline}
                              </h2>
                              <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300">
                                {mockupMutation.data.copy.subheadline}
                              </p>
                            </div>
                            <div className="mt-8 flex flex-wrap gap-3">
                              <Button type="button" className="bg-white text-black hover:bg-zinc-200">
                                {mockupMutation.data.copy.primaryCta}
                              </Button>
                              <Button type="button" variant="outline" className="border-zinc-700">
                                {mockupMutation.data.copy.secondaryCta}
                              </Button>
                            </div>
                          </div>
                          <div className="relative min-h-[320px] border-t border-zinc-800 bg-zinc-950 p-6 lg:border-l lg:border-t-0">
                            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0,transparent_45%),linear-gradient(45deg,rgba(16,185,129,0.12)_0,transparent_40%)]" />
                            <div className="relative flex h-full items-center justify-center [perspective:900px]">
                              <div className="grid w-full max-w-[320px] gap-3 [transform:rotateX(58deg)_rotateZ(-28deg)]">
                                {mockupMutation.data.sections.slice(0, 5).map((section, index) => (
                                  <div
                                    key={section.id}
                                    className="min-h-[58px] rounded-md border border-white/10 bg-zinc-900/95 p-3 shadow-2xl"
                                    style={{ transform: `translateZ(${index * 16}px)` }}
                                  >
                                    <p className="text-xs uppercase tracking-wide text-emerald-200">{section.id}</p>
                                    <p className="mt-1 text-sm font-medium text-white">{section.title}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="grid gap-3 md:grid-cols-4">
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Setup</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{money.format(mockupMutation.data.offer.setupUsd)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Automation</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{money.format(mockupMutation.data.offer.automationUsd)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Deposito</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{money.format(mockupMutation.data.offer.depositUsd)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Costo interno</p>
                          <p className={cn("mt-1 text-2xl font-semibold", mockupMutation.data.offer.insideCostCap ? "text-emerald-200" : "text-red-200")}>
                            {money.format(mockupMutation.data.offer.estimatedInternalCostUsd)}
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardHeader>
                          <CardTitle className="text-base">Secciones</CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-2 md:grid-cols-2">
                          {mockupMutation.data.sections.map((section) => (
                            <div key={section.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                              <p className="text-sm font-medium text-white">{section.title}</p>
                              <p className="mt-2 text-sm leading-6 text-zinc-500">{section.goal}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {section.blocks.map((block) => (
                                  <Badge key={block} variant="outline" className="border-zinc-700 text-zinc-300">
                                    {block}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>

                      <div className="space-y-4">
                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">3D brief</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {mockupMutation.data.visualSystem.threeDSceneBrief.map((line) => (
                              <div key={line} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                                {line}
                              </div>
                            ))}
                          </CardContent>
                        </Card>

                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Subagentes QA</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {mockupMutation.data.qa.map((check) => (
                              <div key={`${check.agent}-${check.check}`} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium text-white">{check.agent}</p>
                                  <Badge variant="outline" className={cn(statusTone(check.result), "shrink-0")}>
                                    {check.result}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-sm text-zinc-500">{check.check}</p>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="plan" className="mt-0">
              {!plan ? (
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardContent className="flex min-h-[320px] items-center justify-center p-6 text-center text-sm text-zinc-500">
                    Crea un plan para ver leads, queries, mockup, outreach y entrega.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
                  <div className="space-y-4">
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <CardTitle className="text-base">
                          {plan.target.niche} en {plan.target.area}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Batch</p>
                            <p className="mt-1 text-lg font-semibold text-white">{plan.target.batchSize} leads</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Costo inicial</p>
                            <p className="mt-1 text-lg font-semibold text-white">{money.format(plan.budget.estimatedFirstBatchUsd)}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Restante</p>
                            <p className="mt-1 text-lg font-semibold text-white">{money.format(plan.budget.remainingBudgetUsd)}</p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2 md:grid-cols-2">
                          {plan.target.qualification.map((item) => (
                            <div key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                              {item}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <CardTitle className="text-base">Lead slots</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-2 md:grid-cols-2">
                        {plan.leadSlots.map((lead) => (
                          <div key={lead.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-white">{lead.name}</p>
                                <p className="text-xs text-zinc-500">{lead.area}</p>
                              </div>
                              <Badge variant="outline" className="border-sky-500/30 text-sky-200">
                                {lead.status}
                              </Badge>
                            </div>
                            <p className="mt-3 text-xs text-zinc-500">Next: {lead.nextAgent}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-4">
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Sparkles className="h-4 w-4 text-fuchsia-200" />
                          Mockup
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm text-zinc-300">
                        <p>{plan.mockupBrief.style}</p>
                        <div className="flex flex-wrap gap-2">
                          {plan.mockupBrief.sections.map((section) => (
                            <Badge key={section} variant="outline" className="border-zinc-700 text-zinc-300">
                              {section}
                            </Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <CardTitle className="text-base">Outreach draft</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-6 text-zinc-300">
                          {plan.outreachDraft.firstMessage}
                        </p>
                        <Badge variant="outline" className="mt-3 border-amber-500/30 text-amber-200">
                          {plan.outreachDraft.approvalStatus}
                        </Badge>
                      </CardContent>
                    </Card>

                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <CardTitle className="text-base">Queries</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {plan.searchQueries.map((query) => (
                          <code key={query} className="block rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-300">
                            {query}
                          </code>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="automation" className="mt-0">
              <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Bot className="h-4 w-4 text-emerald-200" />
                      Pedido del cliente
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        automationQuoteMutation.mutate();
                      }}
                    >
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="automation-business">
                          Negocio
                        </label>
                        <Input
                          id="automation-business"
                          value={automationBusinessName}
                          onChange={(event) => setAutomationBusinessName(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-automation-business"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="automation-industry">
                          Industria
                        </label>
                        <Input
                          id="automation-industry"
                          value={automationIndustry}
                          onChange={(event) => setAutomationIndustry(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-automation-industry"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="automation-request">
                          Que quiere automatizar
                        </label>
                        <Textarea
                          id="automation-request"
                          value={automationRequest}
                          onChange={(event) => setAutomationRequest(event.target.value)}
                          className="min-h-[112px] border-zinc-800 bg-black"
                          data-testid="textarea-automation-request"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="automation-tools">
                          Herramientas actuales
                        </label>
                        <Input
                          id="automation-tools"
                          value={automationTools}
                          onChange={(event) => setAutomationTools(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-automation-tools"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="automation-budget">
                            Budget cliente
                          </label>
                          <Input
                            id="automation-budget"
                            type="number"
                            min={0}
                            value={automationMonthlyBudgetUsd}
                            onChange={(event) => setAutomationMonthlyBudgetUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-automation-budget"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="automation-urgency">
                            Urgencia
                          </label>
                          <select
                            id="automation-urgency"
                            value={automationUrgency}
                            onChange={(event) => setAutomationUrgency(event.target.value as "this_week" | "this_month" | "flexible")}
                            className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                            data-testid="select-automation-urgency"
                          >
                            <option value="this_week">Esta semana</option>
                            <option value="this_month">Este mes</option>
                            <option value="flexible">Flexible</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="automation-opportunity-status">
                          Estado pipeline
                        </label>
                        <select
                          id="automation-opportunity-status"
                          value={automationOpportunityStatus}
                          onChange={(event) => setAutomationOpportunityStatus(event.target.value as typeof automationOpportunityStatus)}
                          className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                          data-testid="select-automation-opportunity-status"
                        >
                          <option value="intake">Intake</option>
                          <option value="quoted">Cotizada</option>
                          <option value="approved">Scope aprobado</option>
                          <option value="sold">Vendida</option>
                          <option value="in_delivery">En entrega</option>
                          <option value="delivered">Entregada</option>
                          <option value="blocked">Bloqueada</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="automation-lifecycle-target">
                            Ciclo agente
                          </label>
                          <select
                            id="automation-lifecycle-target"
                            value={automationLifecycleTarget}
                            onChange={(event) => setAutomationLifecycleTarget(event.target.value as typeof automationLifecycleTarget)}
                            className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                            data-testid="select-automation-lifecycle-target"
                          >
                            <option value="quote">Solo cotizar</option>
                            <option value="opportunity">Crear oportunidad</option>
                            <option value="sale">Cerrar venta</option>
                            <option value="delivery">Venta + delivery</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="automation-cash-collected">
                            Cash cobrado
                          </label>
                          <Input
                            id="automation-cash-collected"
                            type="number"
                            min={0}
                            value={automationCashCollectedUsd}
                            onChange={(event) => setAutomationCashCollectedUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-automation-cash-collected"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="automation-payment-confirmation">
                          Referencia de pago
                        </label>
                        <Input
                          id="automation-payment-confirmation"
                          value={automationPaymentConfirmation}
                          onChange={(event) => setAutomationPaymentConfirmation(event.target.value)}
                          className="border-zinc-800 bg-black"
                          placeholder="Stripe pi_..., Zelle ref..., recibo..."
                          data-testid="input-automation-payment-confirmation"
                        />
                        {(automationAgentPaymentBlocked || automationOpportunityPaymentBlocked) && (
                          <p className="text-xs text-amber-300">
                            Falta referencia verificable para cerrar venta o marcar deposito pagado.
                          </p>
                        )}
                      </div>
                      <div className="grid gap-2">
                        {[
                          ["automation-scope-approved", "Scope aprobado", automationScopeApproved, setAutomationScopeApproved],
                          ["automation-deposit-paid", "Deposito pagado", automationDepositPaid, setAutomationDepositPaid],
                        ].map(([id, label, checked, setter]) => (
                          <label key={id as string} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                            <input
                              type="checkbox"
                              checked={checked as boolean}
                              onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)}
                              className="h-4 w-4 accent-emerald-500"
                              data-testid={`checkbox-${id}`}
                            />
                            {label as string}
                          </label>
                        ))}
                      </div>
                      <Button
                        type="button"
                        disabled={automationAgentCommandMutation.isPending || automationAgentPaymentBlocked}
                        onClick={() => automationAgentCommandMutation.mutate()}
                        className="w-full bg-fuchsia-600 text-white hover:bg-fuchsia-500"
                        data-testid="button-run-automation-agent-command"
                      >
                        {automationAgentCommandMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                        Agente completo
                      </Button>
                      <div className="grid gap-2 md:grid-cols-3">
                        <Button
                          type="button"
                          disabled={automationIntakeMutation.isPending}
                          variant="outline"
                          className="border-sky-500/40 text-sky-100"
                          onClick={() => automationIntakeMutation.mutate()}
                          data-testid="button-save-automation-intake"
                        >
                          {automationIntakeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquareText className="mr-2 h-4 w-4" />}
                          Intake
                        </Button>
                        <Button
                          type="submit"
                          disabled={automationQuoteMutation.isPending}
                          className="bg-emerald-600 text-white hover:bg-emerald-500"
                          data-testid="button-create-automation-quote"
                        >
                          {automationQuoteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeDollarSign className="mr-2 h-4 w-4" />}
                          Cotizar
                        </Button>
                        <Button
                          type="button"
                          disabled={automationOpportunityMutation.isPending || automationOpportunityPaymentBlocked}
                          variant="outline"
                          className="border-zinc-700"
                          onClick={() => automationOpportunityMutation.mutate()}
                          data-testid="button-save-automation-opportunity"
                        >
                          {automationOpportunityMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
                          Guardar
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>

                {automationAgentCommandMutation.data && (
                  <Card className="border-fuchsia-500/20 bg-zinc-950/80 xl:col-span-2">
                    <CardHeader>
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Bot className="h-4 w-4 text-fuchsia-200" />
                          Agente de automatizacion
                        </CardTitle>
                        <Badge variant="outline" className={cn(statusTone(automationAgentCommandMutation.data.status), "shrink-0")}>
                          {automationAgentCommandMutation.data.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-4 lg:grid-cols-[1fr_320px]">
                      <div>
                        <p className="rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-6 text-zinc-300">
                          {automationAgentCommandMutation.data.reason}
                        </p>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {automationAgentCommandMutation.data.nextActions.map((action) => (
                            <div key={action} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                              {action}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {automationAgentCommandMutation.data.blockedUntilAnswered.length > 0 ? (
                          automationAgentCommandMutation.data.blockedUntilAnswered.map((block) => (
                            <div key={block} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-100">
                              Bloquea {block}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                            Pedido claro; oportunidad en draft si el agente la creo.
                          </div>
                        )}
                        {automationAgentCommandMutation.data.opportunity && (
                          <div className="rounded-md border border-fuchsia-500/20 bg-fuchsia-500/5 px-3 py-2 text-sm text-fuchsia-100">
                            Oportunidad: {automationAgentCommandMutation.data.opportunity.id}
                          </div>
                        )}
                        {automationAgentCommandMutation.data.closeResult && (
                          <div className={cn("rounded-md border px-3 py-2 text-sm", automationAgentCommandMutation.data.closeResult.status === "recorded" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-100" : "border-amber-500/20 bg-amber-500/5 text-amber-100")}>
                            Venta: {automationAgentCommandMutation.data.closeResult.status}
                            {automationAgentCommandMutation.data.closeResult.entry ? ` · ${money.format(automationAgentCommandMutation.data.closeResult.entry.cashCollectedUsd)} cash` : ""}
                          </div>
                        )}
                        {automationAgentCommandMutation.data.workspaceResult && (
                          <div className={cn("rounded-md border px-3 py-2 text-sm", automationAgentCommandMutation.data.workspaceResult.status === "created" ? "border-sky-500/20 bg-sky-500/5 text-sky-100" : "border-amber-500/20 bg-amber-500/5 text-amber-100")}>
                            Workspace: {automationAgentCommandMutation.data.workspaceResult.status}
                            {automationAgentCommandMutation.data.workspaceResult.workspace ? ` · ${automationAgentCommandMutation.data.workspaceResult.workspace.status}` : ""}
                          </div>
                        )}
                        {automationLifecycleTarget === "delivery" && (
                          <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs leading-5 text-zinc-400">
                            Delivery usa los checks del panel QA: data publica, responsive, links, automation test y rollback/handoff.
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {!automationQuote ? (
                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardContent className="flex min-h-[420px] items-center justify-center p-6 text-center text-sm text-zinc-500">
                      Escribe lo que el cliente pide y el sistema arma precio, margen, QA, preguntas y propuesta.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Setup</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{money.format(automationQuote.pricing.setupPriceUsd)}</p>
                          <p className="mt-1 text-xs text-zinc-500">Deposito {money.format(automationQuote.pricing.requiredDepositUsd)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Retainer</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{money.format(automationQuote.pricing.monthlyRetainerUsd)}</p>
                          <p className="mt-1 text-xs text-zinc-500">Mensual</p>
                        </CardContent>
                      </Card>
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Costo interno</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{money.format(automationQuote.pricing.estimatedInternalMonthlyCostUsd)}</p>
                          <p className={cn("mt-1 text-xs", automationQuote.pricing.insideCostCap ? "text-emerald-300" : "text-red-300")}>
                            {automationQuote.pricing.insideCostCap ? "Dentro del cap" : "Bloqueado"}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Margen</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{automationQuote.pricing.grossMarginPercent}%</p>
                          <p className="mt-1 text-xs text-zinc-500">{money.format(automationQuote.pricing.grossMarginUsd)}/mes</p>
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <CardTitle className="text-base">{automationQuote.clientProposalDraft.headline}</CardTitle>
                          <Badge
                            variant="outline"
                            className={cn(
                              automationQuote.decision.status === "ready_to_pitch"
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                                : "border-amber-500/40 bg-amber-500/10 text-amber-200",
                            )}
                          >
                            {automationQuote.decision.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="grid gap-4 lg:grid-cols-[1fr_320px]">
                        <div className="space-y-3">
                          <p className="rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-6 text-zinc-300">
                            {automationQuote.clientProposalDraft.summary}
                          </p>
                          <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm leading-6 text-emerald-100">
                            {automationQuote.clientProposalDraft.close}
                          </p>
                          <div className="grid gap-2 md:grid-cols-2">
                            {automationQuote.scope.deliverables.map((item) => (
                              <div key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                                {item}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Needs</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {automationQuote.scope.detectedNeeds.map((need) => (
                                <Badge key={need} variant="outline" className="border-sky-500/30 text-sky-200">
                                  {need}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Integraciones</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {automationQuote.scope.integrations.map((integration) => (
                                <Badge key={integration} variant="outline" className="border-zinc-700 text-zinc-300">
                                  {integration}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                            <p className="text-xs uppercase tracking-wide text-amber-200">Preguntas</p>
                            <div className="mt-2 space-y-2">
                              {automationQuote.clarifyingQuestions.map((question) => (
                                <p key={question} className="text-sm text-zinc-300">{question}</p>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardHeader>
                          <CardTitle className="text-base">Subagentes QA</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {automationQuote.agents.map((agent) => (
                            <div key={agent.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-sm font-medium text-white">{agent.id}</p>
                                <Badge variant="outline" className={cn(statusTone(agent.result), "shrink-0")}>
                                  {agent.result}
                                </Badge>
                              </div>
                              <p className="mt-2 text-sm text-zinc-500">{agent.check}</p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>

                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardHeader>
                          <CardTitle className="text-base">Entrega y mejora</CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-2 md:grid-cols-2">
                          {[...automationQuote.deliveryPlan, ...automationQuote.improvementLoop].map((item) => (
                            <div key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                              {item}
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="production" className="mt-0">
              <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Rocket className="h-4 w-4 text-emerald-200" />
                      Plan de produccion
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        projectPlanMutation.mutate();
                      }}
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="project-client">
                            Cliente
                          </label>
                          <Input
                            id="project-client"
                            value={projectClientName}
                            onChange={(event) => setProjectClientName(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-project-client"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="project-type">
                            Tipo
                          </label>
                          <select
                            id="project-type"
                            value={projectType}
                            onChange={(event) => setProjectType(event.target.value as typeof projectType)}
                            className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                            data-testid="select-project-type"
                          >
                            <option value="bundle">Website + automation</option>
                            <option value="website">Website</option>
                            <option value="automation">Automation</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="project-package">
                          Paquete
                        </label>
                        <Input
                          id="project-package"
                          value={projectPackageName}
                          onChange={(event) => setProjectPackageName(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-project-package"
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="project-setup">
                            Setup
                          </label>
                          <Input
                            id="project-setup"
                            type="number"
                            min={0}
                            value={projectSetupUsd}
                            onChange={(event) => setProjectSetupUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-project-setup"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="project-retainer">
                            Retainer
                          </label>
                          <Input
                            id="project-retainer"
                            type="number"
                            min={0}
                            value={projectRetainerUsd}
                            onChange={(event) => setProjectRetainerUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-project-retainer"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="project-cost">
                            Costo int.
                          </label>
                          <Input
                            id="project-cost"
                            type="number"
                            min={0}
                            value={projectInternalCostUsd}
                            onChange={(event) => setProjectInternalCostUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-project-cost"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="project-days">
                          Dias target
                        </label>
                        <Input
                          id="project-days"
                          type="number"
                          min={1}
                          max={60}
                          value={projectLaunchTargetDays}
                          onChange={(event) => setProjectLaunchTargetDays(Number(event.target.value))}
                          className="border-zinc-800 bg-black"
                          data-testid="input-project-days"
                        />
                      </div>
                      <div className="space-y-2">
                        {[
                          ["projectDepositPaid", "Deposito pagado", projectDepositPaid, setProjectDepositPaid],
                          ["projectScopeApproved", "Scope aprobado", projectScopeApproved, setProjectScopeApproved],
                          ["projectDataVerified", "Data verificada", projectDataVerified, setProjectDataVerified],
                          ["projectIncludesAutomation", "Incluye automation", projectIncludesAutomation, setProjectIncludesAutomation],
                        ].map(([id, label, checked, setter]) => (
                          <label key={id as string} className="flex min-h-10 items-center gap-3 rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                            <input
                              type="checkbox"
                              checked={checked as boolean}
                              onChange={() => (setter as (value: boolean | ((current: boolean) => boolean)) => void)((current: boolean) => !current)}
                              className="h-4 w-4 rounded border-zinc-700 bg-black"
                              data-testid={`checkbox-${id}`}
                            />
                            {label as string}
                          </label>
                        ))}
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="project-request">
                          Pedido cliente
                        </label>
                        <Textarea
                          id="project-request"
                          value={projectClientRequest}
                          onChange={(event) => setProjectClientRequest(event.target.value)}
                          className="min-h-[88px] border-zinc-800 bg-black"
                          data-testid="textarea-project-request"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={projectPlanMutation.isPending}
                        className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                        data-testid="button-build-project-plan"
                      >
                        {projectPlanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                        Crear produccion
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {!projectPlanMutation.data ? (
                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardContent className="flex min-h-[520px] items-center justify-center p-6 text-center text-sm text-zinc-500">
                      Crea el plan interno cuando el cliente este cerca de comprar. El sistema bloquea build/launch si falta deposito, scope, data, costo o margen.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <CardTitle className="text-base">{projectPlanMutation.data.input.clientName}</CardTitle>
                            <p className="mt-1 text-sm text-zinc-500">{projectPlanMutation.data.decision.reason}</p>
                          </div>
                          <Badge variant="outline" className={cn(statusTone(projectPlanMutation.data.decision.status), "shrink-0")}>
                            {projectPlanMutation.data.decision.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Deposito req.</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{money.format(projectPlanMutation.data.budget.requiredDepositUsd)}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Retainer</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{money.format(projectPlanMutation.data.budget.monthlyRetainerUsd)}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Costo</p>
                            <p className={cn("mt-1 text-2xl font-semibold", projectPlanMutation.data.budget.insideCostCap ? "text-emerald-200" : "text-red-200")}>
                              {money.format(projectPlanMutation.data.budget.estimatedInternalCostUsd)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Margen</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{projectPlanMutation.data.budget.grossMarginPercent}%</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardHeader>
                          <CardTitle className="text-base">Fases</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {projectPlanMutation.data.phases.map((phase) => (
                            <div key={phase.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                <div>
                                  <p className="text-sm font-medium text-white">{phase.name}</p>
                                  <p className="mt-1 text-xs text-zinc-500">{phase.ownerAgent} · {phase.days} dia(s)</p>
                                </div>
                              </div>
                              <div className="mt-3 grid gap-2 md:grid-cols-2">
                                {phase.tasks.map((task) => (
                                  <div key={task} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
                                    {task}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>

                      <div className="space-y-4">
                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Gates</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {projectPlanMutation.data.deliveryGates.map((gate) => (
                              <div key={gate.gate} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium text-white">{gate.gate}</p>
                                  <Badge variant="outline" className={cn(gate.passed ? statusTone("pass") : statusTone("blocked"), "shrink-0")}>
                                    {gate.passed ? "pass" : "fix"}
                                  </Badge>
                                </div>
                                {!gate.passed && <p className="mt-1 text-sm text-zinc-500">{gate.fix}</p>}
                              </div>
                            ))}
                          </CardContent>
                        </Card>

                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Subagentes correctores</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {projectPlanMutation.data.subagentCorrections.map((item) => (
                              <div key={item.agent} className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                                <p className="text-sm font-medium text-white">{item.agent}</p>
                                <p className="mt-1 text-sm text-zinc-500">{item.corrects}</p>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="qa" className="mt-0">
              <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileCheck2 className="h-4 w-4 text-emerald-200" />
                      Review de entrega
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        deliveryReviewMutation.mutate();
                      }}
                    >
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="review-project">
                          Proyecto
                        </label>
                        <Input
                          id="review-project"
                          value={reviewProjectName}
                          onChange={(event) => setReviewProjectName(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-review-project"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="review-type">
                          Tipo
                        </label>
                        <select
                          id="review-type"
                          value={reviewProjectType}
                          onChange={(event) => setReviewProjectType(event.target.value as "website" | "automation" | "bundle")}
                          className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                          data-testid="select-review-type"
                        >
                          <option value="bundle">Website + automation</option>
                          <option value="website">Website</option>
                          <option value="automation">Automation</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="review-setup">
                            Setup
                          </label>
                          <Input
                            id="review-setup"
                            type="number"
                            min={0}
                            value={reviewSetupPriceUsd}
                            onChange={(event) => setReviewSetupPriceUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-review-setup"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="review-retainer">
                            Retainer
                          </label>
                          <Input
                            id="review-retainer"
                            type="number"
                            min={0}
                            value={reviewRetainerUsd}
                            onChange={(event) => setReviewRetainerUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-review-retainer"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="review-cost">
                            Costo
                          </label>
                          <Input
                            id="review-cost"
                            type="number"
                            min={0}
                            value={reviewCostUsd}
                            onChange={(event) => setReviewCostUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-review-cost"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        {[
                          ["clientApprovedScope", "Scope aprobado"],
                          ["depositPaid", "Deposito pagado"],
                          ["publicDataVerified", "Data verificada"],
                          ["responsiveChecked", "Responsive revisado"],
                          ["linksChecked", "Links/formularios OK"],
                          ["automationTested", "Automation probada"],
                          ["rollbackPlanReady", "Rollback listo"],
                          ["clientHandoffReady", "Handoff cliente listo"],
                        ].map(([key, label]) => (
                          <label
                            key={key}
                            className="flex min-h-10 items-center gap-3 rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300"
                          >
                            <input
                              type="checkbox"
                              checked={reviewChecks[key as keyof typeof reviewChecks]}
                              onChange={() => toggleReviewCheck(key as keyof typeof reviewChecks)}
                              className="h-4 w-4 rounded border-zinc-700 bg-black"
                              data-testid={`checkbox-review-${key}`}
                            />
                            {label}
                          </label>
                        ))}
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="review-repo">
                          Repo
                        </label>
                        <Input
                          id="review-repo"
                          value={reviewRepoFullName}
                          onChange={(event) => setReviewRepoFullName(event.target.value)}
                          placeholder="owner/repo"
                          className="border-zinc-800 bg-black"
                          data-testid="input-review-repo"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="review-notes">
                          Notas
                        </label>
                        <Textarea
                          id="review-notes"
                          value={reviewNotes}
                          onChange={(event) => setReviewNotes(event.target.value)}
                          className="min-h-[88px] border-zinc-800 bg-black"
                          data-testid="textarea-review-notes"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={deliveryReviewMutation.isPending}
                        className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                        data-testid="button-run-delivery-review"
                      >
                        {deliveryReviewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                        Correr QA
                      </Button>
                      <Button
                        type="button"
                        disabled={deliveryWorkspaceMutation.isPending || reviewProjectType !== "automation"}
                        onClick={() => deliveryWorkspaceMutation.mutate()}
                        className="w-full bg-sky-600 text-white hover:bg-sky-500"
                        data-testid="button-save-delivery-workspace"
                      >
                        {deliveryWorkspaceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
                        {reviewProjectType === "automation" ? "Guardar workspace" : "Usar website handoff"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {!deliveryReview ? (
                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardContent className="flex min-h-[420px] items-center justify-center p-6 text-center text-sm text-zinc-500">
                      Corre el QA antes de publicar mockup, contactar cliente, activar automatizacion o entregar.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <CardTitle className="text-base">{deliveryReview.input.projectName}</CardTitle>
                          <Badge variant="outline" className={cn(statusTone(deliveryReview.status), "shrink-0")}>
                            {deliveryReview.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Gates</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{deliveryReview.summary.passed}/{deliveryReview.summary.total}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Bloqueos</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{deliveryReview.summary.blocking}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Costo mensual</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{money.format(deliveryReview.summary.estimatedInternalMonthlyCostUsd)}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Margen</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{deliveryReview.summary.grossMarginPercent}%</p>
                          </div>
                        </div>
                        <p className="mt-4 rounded-lg border border-white/10 bg-black p-3 text-sm leading-6 text-zinc-300">
                          {deliveryReview.deliveryDecision}
                        </p>
                      </CardContent>
                    </Card>

                    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardHeader>
                          <CardTitle className="text-base">Subagentes</CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-2 md:grid-cols-2">
                          {deliveryReview.gates.map((gate) => (
                            <div key={gate.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-white">{gate.label}</p>
                                  <p className="mt-1 text-xs text-zinc-500">{gate.agent}</p>
                                </div>
                                <Badge
                                  variant="outline"
                                  className={cn(gate.passed ? statusTone("pass") : statusTone("blocked"), "shrink-0")}
                                >
                                  {gate.passed ? "pass" : "fix"}
                                </Badge>
                              </div>
                              {!gate.passed && <p className="mt-3 text-sm text-zinc-400">{gate.fix}</p>}
                            </div>
                          ))}
                        </CardContent>
                      </Card>

                      <div className="space-y-4">
                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Fixes requeridos</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {deliveryReview.requiredFixes.length === 0 ? (
                              <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                                Sin fixes pendientes.
                              </div>
                            ) : (
                              deliveryReview.requiredFixes.map((fix) => (
                                <div key={fix.gateId} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                                  <p className="text-sm font-medium text-amber-100">{fix.ownerAgent}</p>
                                  <p className="mt-1 text-sm text-zinc-300">{fix.action}</p>
                                </div>
                              ))
                            )}
                          </CardContent>
                        </Card>

                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Mejora continua</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-zinc-500">{deliveryReview.nextReview.cadence}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {deliveryReview.nextReview.improvementMetrics.map((metric) => (
                                <Badge key={metric} variant="outline" className="border-zinc-700 text-zinc-300">
                                  {metric}
                                </Badge>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </div>

                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <CardTitle className="text-base">Handoff website</CardTitle>
                          <Badge variant="outline" className={cn(statusTone(snapshot?.websiteDeliveryHandoffQueue.status || "review"), "shrink-0")}>
                            {snapshot?.websiteDeliveryHandoffQueue.readyCount ?? 0} listos
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-sm leading-6 text-zinc-500">
                          {snapshot?.websiteDeliveryHandoffQueue.nextAction || "Cargando handoffs de website."}
                        </p>
                        {(snapshot?.websiteDeliveryHandoffQueue.items || []).length === 0 ? (
                          <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-500">
                            Sin oportunidades website vendidas listas para workspace.
                          </div>
                        ) : (
                          snapshot?.websiteDeliveryHandoffQueue.items.map((item) => {
                            const depositCoversHandoff = item.cashCollectedUsd >= item.requiredDepositUsd;
                            const repoInput = websiteDeliveryRepoInputs[item.opportunityId] || {};
                            const repoFullName = repoInput.repoFullName || "";
                            const branchName = repoInput.branchName || item.suggestedBranchName || `codex/client-${slugifyClientBranchValue(item.businessName)}-website`;
                            const repoReady = isGithubRepoFullName(repoFullName);
                            const branchReady = isCodexBranchName(branchName);
                            return (
                              <div key={item.leadId} className="rounded-lg border border-zinc-800 bg-black p-3">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-white">{item.businessName}</p>
                                    <p className="mt-1 text-xs text-zinc-500">
                                      {item.projectType} · {item.leadStatus} · cash {money.format(item.cashCollectedUsd)} / deposito {money.format(item.requiredDepositUsd)}
                                    </p>
                                  </div>
                                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-100">
                                    vendida
                                  </Badge>
                                </div>
                                <p className="mt-3 text-sm leading-6 text-zinc-400">{item.nextAction}</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Badge variant="outline" className={cn(depositCoversHandoff ? statusTone("ready") : statusTone("blocked"))}>
                                    {depositCoversHandoff ? "deposito cubierto" : "deposito incompleto"}
                                  </Badge>
                                  <Badge variant="outline" className={cn(statusTone("ready"))}>
                                    scope vendido
                                  </Badge>
                                  <Badge variant="outline" className={cn(repoReady ? statusTone("ready") : statusTone("blocked"))}>
                                    {repoReady ? "repo listo" : "repo requerido"}
                                  </Badge>
                                  <Badge variant="outline" className={cn(branchReady ? statusTone("ready") : statusTone("blocked"))}>
                                    {branchReady ? "branch codex listo" : "branch codex requerido"}
                                  </Badge>
                                </div>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                  <Input
                                    value={repoFullName}
                                    onChange={(event) =>
                                      setWebsiteDeliveryRepoInputs((current) => ({
                                        ...current,
                                        [item.opportunityId]: {
                                          ...current[item.opportunityId],
                                          repoFullName: event.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="owner/repo"
                                    className="border-zinc-800 bg-zinc-950"
                                    data-testid={`input-website-handoff-repo-${item.opportunityId}`}
                                  />
                                  <Input
                                    value={branchName}
                                    onChange={(event) =>
                                      setWebsiteDeliveryRepoInputs((current) => ({
                                        ...current,
                                        [item.opportunityId]: {
                                          ...current[item.opportunityId],
                                          branchName: event.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="codex/client-business-website"
                                    className="border-zinc-800 bg-zinc-950"
                                    data-testid={`input-website-handoff-branch-${item.opportunityId}`}
                                  />
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-emerald-500/30 text-emerald-100"
                                    onClick={() => navigator.clipboard.writeText(item.copyableWorkspaceSetupPacket)}
                                    data-testid={`button-copy-website-workspace-setup-${item.opportunityId}`}
                                  >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy repo setup
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-sky-500/30 text-sky-100"
                                    onClick={() => navigator.clipboard.writeText(item.copyableWorkspaceRequest)}
                                    data-testid={`button-copy-website-workspace-request-${item.opportunityId}`}
                                  >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy workspace JSON
                                  </Button>
                                  <a href={item.mockupUrl} target="_blank" rel="noreferrer">
                                    <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                      <ExternalLink className="mr-2 h-4 w-4" />
                                      Mockup
                                    </Button>
                                  </a>
                                  {item.sourceUrl && (
                                    <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                                      <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                        <ExternalLink className="mr-2 h-4 w-4" />
                                        Fuente
                                      </Button>
                                    </a>
                                  )}
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={websiteDeliveryHandoffMutation.isPending || !depositCoversHandoff || !repoReady || !branchReady}
                                    onClick={() => websiteDeliveryHandoffMutation.mutate(item)}
                                    className="bg-sky-600 text-white hover:bg-sky-500"
                                    data-testid={`button-create-website-workspace-${item.leadId}`}
                                  >
                                    {websiteDeliveryHandoffMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
                                    {depositCoversHandoff ? repoReady ? branchReady ? "Crear workspace" : "Branch codex requerido" : "Repo requerido" : "Deposito incompleto"}
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                        )}
                        {(snapshot?.websiteDeliveryHandoffQueue.blocked || []).length > 0 && (
                          <div className="space-y-2">
                            {(snapshot?.websiteDeliveryHandoffQueue.blocked || []).slice(0, 3).map((item) => (
                              <div key={item.leadId} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                                <p className="text-sm font-medium text-amber-100">{item.businessName}</p>
                                <p className="mt-1 text-xs leading-5 text-zinc-300">{item.reason} {item.nextAction}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {websiteDeliveryHandoffMutation.data && !["created", "already_created"].includes(websiteDeliveryHandoffMutation.data.status) && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                            {websiteDeliveryHandoffMutation.data.reason}
                          </div>
                        )}
                        {websiteDeliveryHandoffMutation.data?.status === "created" && websiteDeliveryHandoffMutation.data.workspace && (
                          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-sky-100">
                            Workspace creado: {websiteDeliveryHandoffMutation.data.workspace.input.clientName}
                          </div>
                        )}
                        {websiteDeliveryHandoffMutation.data?.status === "already_created" && websiteDeliveryHandoffMutation.data.workspace && (
                          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100">
                            Workspace reutilizado: {websiteDeliveryHandoffMutation.data.workspace.input.clientName}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <CardTitle className="text-base">Workspaces recientes</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {(snapshot?.recentDeliveryWorkspaces || []).length === 0 ? (
                          <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-500">
                            Sin workspaces guardados todavia.
                          </div>
                        ) : (
                          snapshot?.recentDeliveryWorkspaces.slice(0, 4).map((workspace) => {
                            const releaseGateInput = buildReleaseGateInput(workspace);
                            const buildHandoffBranchReady = !workspace.codexBuildHandoff.missing.includes("branch codex/... para PR-first");
                            const trustedDeliveryReady = isTrustedDeliveryRequestReady(workspace);
                            return (
                            <div key={workspace.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-white">{workspace.input.clientName}</p>
                                  <p className="mt-1 text-xs text-zinc-500">{workspace.learningNote}</p>
                                </div>
                                <Badge variant="outline" className={cn(statusTone(workspace.status), "shrink-0")}>
                                  {workspace.status}
                                </Badge>
                              </div>
                              <div className="mt-3 grid gap-2 md:grid-cols-3">
                                <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                                  <p className="text-xs text-zinc-500">Correcciones</p>
                                  <p className="mt-1 text-sm font-semibold text-white">{workspace.correctionQueue.length}</p>
                                </div>
                                <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                                  <p className="text-xs text-zinc-500">Preview</p>
                                  <p className="mt-1 text-sm font-semibold text-white">{workspace.approvalSummary.canShowClientPreview ? "ok" : "bloqueado"}</p>
                                </div>
                                <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                                  <p className="text-xs text-zinc-500">Launch</p>
                                  <p className="mt-1 text-sm font-semibold text-white">{workspace.approvalSummary.canLaunch ? "ok" : "bloqueado"}</p>
                                </div>
                              </div>
                              {workspace.correctionQueue.length > 0 && (
                                <div className="mt-3 space-y-2">
                                  {workspace.correctionQueue.slice(0, 3).map((item) => (
                                    <div key={`${workspace.id}-${item.agent}-${item.action}`} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                                      <p className="text-xs font-medium text-amber-100">{item.agent}</p>
                                      <p className="mt-1 text-xs text-zinc-300">{item.action}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                  <div>
                                    <p className="text-xs uppercase tracking-wide text-sky-200">Codex PR-first</p>
                                    <p className="mt-1 text-sm leading-5 text-zinc-300">{workspace.codexBuildHandoff.nextAction}</p>
                                  </div>
                                  <Badge variant="outline" className={cn(statusTone(workspace.codexBuildHandoff.status), "shrink-0")}>
                                    {workspace.codexBuildHandoff.status}
                                  </Badge>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {workspace.codexBuildHandoff.repoFullName && (
                                    <Badge variant="outline" className="border-zinc-700 text-zinc-300">{workspace.codexBuildHandoff.repoFullName}</Badge>
                                  )}
                                  {workspace.codexBuildHandoff.prUrl && (
                                    <a href={workspace.codexBuildHandoff.prUrl} target="_blank" rel="noreferrer">
                                      <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                        <ExternalLink className="mr-2 h-4 w-4" />
                                        PR
                                      </Button>
                                    </a>
                                  )}
                                  {workspace.codexBuildHandoff.githubIssueUrl && (
                                    <a href={workspace.codexBuildHandoff.githubIssueUrl} target="_blank" rel="noreferrer">
                                      <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                        <ExternalLink className="mr-2 h-4 w-4" />
                                        Issue
                                      </Button>
                                    </a>
                                  )}
                                  {workspace.codexBuildHandoff.deploymentApprovalUrl && (
                                    <a href={workspace.codexBuildHandoff.deploymentApprovalUrl} target="_blank" rel="noreferrer">
                                      <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                        <ExternalLink className="mr-2 h-4 w-4" />
                                        Approval
                                      </Button>
                                    </a>
                                  )}
                                  {workspace.codexBuildHandoff.releaseGateHeadSha && (
                                    <Badge variant="outline" className="border-sky-500/30 bg-black font-mono text-[10px] text-sky-100">
                                      head {workspace.codexBuildHandoff.releaseGateHeadSha.slice(0, 12)}
                                    </Badge>
                                  )}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-zinc-700"
                                    onClick={() => navigator.clipboard.writeText(workspace.codexBuildHandoff.publicBuildBrief)}
                                    data-testid={`button-copy-codex-build-handoff-${workspace.id}`}
                                  >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy public brief
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-zinc-700"
                                    onClick={() => navigator.clipboard.writeText(workspace.codexBuildHandoff.copyableGithubIssueBody)}
                                    data-testid={`button-copy-codex-issue-body-${workspace.id}`}
                                  >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy issue body
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-sky-500/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                                    onClick={() => navigator.clipboard.writeText(workspace.codexBuildHandoff.buildPack.copyableBuildPack)}
                                    data-testid={`button-copy-codex-build-pack-${workspace.id}`}
                                  >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy build pack
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-zinc-700"
                                    onClick={() => navigator.clipboard.writeText(buildCopyableGithubHandoffRequest(
                                      workspace.id,
                                      workspace.input.repoFullName,
                                      workspace.input.branchName || workspace.codexBuildHandoff.branchName,
                                    ))}
                                    data-testid={`button-copy-github-handoff-request-${workspace.id}`}
                                  >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy handoff JSON
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-indigo-500/30 text-indigo-100"
                                    onClick={() => navigator.clipboard.writeText(buildCopyableReleaseGateRequest(workspace, releaseGateInput))}
                                    data-testid={`button-copy-release-gate-request-${workspace.id}`}
                                  >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy release JSON
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      deliveryWorkspaceGithubHandoffMutation.isPending
                                      || workspace.codexBuildHandoff.status === "not_required"
                                      || Boolean(workspace.input.githubIssueUrl)
                                      || !workspace.input.repoFullName
                                      || !workspace.input.publicDataVerified
                                      || !buildHandoffBranchReady
                                      || workspace.projectPlan.decision.status !== "ready_to_build"
                                    }
                                    className="border-sky-500/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                                    onClick={() => deliveryWorkspaceGithubHandoffMutation.mutate(workspace)}
                                    data-testid={`button-create-github-handoff-${workspace.id}`}
                                  >
                                    {deliveryWorkspaceGithubHandoffMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitPullRequest className="mr-2 h-4 w-4" />}
                                    Create issue
                                  </Button>
                                </div>
                                {workspace.codexBuildHandoff.missing.length > 0 && (
                                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                                    {workspace.codexBuildHandoff.missing.slice(0, 4).map((item) => (
                                      <div key={`${workspace.id}-${item}`} className="rounded-md border border-amber-500/20 bg-black px-3 py-2 text-xs text-amber-100">
                                        {item}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={deliveryWorkspaceQaMutation.isPending}
                                onClick={() => deliveryWorkspaceQaMutation.mutate(workspace)}
                                className="mt-3 w-full border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                                data-testid={`button-revalidate-delivery-workspace-${workspace.id}`}
                              >
                                {deliveryWorkspaceQaMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Revalidar con checks marcados
                              </Button>
                              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3" data-testid={`panel-release-gate-inputs-${workspace.id}`}>
                                <p className="text-xs uppercase tracking-wide text-zinc-500">Release gate de este workspace</p>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                  <Input
                                    value={releaseGateInput.prUrl}
                                    onChange={(event) => updateReleaseGateInput(workspace.id, { prUrl: event.target.value })}
                                    placeholder="https://github.com/owner/repo/pull/1"
                                    className="border-zinc-800 bg-black"
                                    data-testid={`input-release-pr-url-${workspace.id}`}
                                  />
                                  <Input
                                    value={releaseGateInput.deploymentApprovalUrl}
                                    onChange={(event) => updateReleaseGateInput(workspace.id, { deploymentApprovalUrl: event.target.value })}
                                    placeholder="Robert approval comment URL"
                                    className="border-zinc-800 bg-black"
                                    data-testid={`input-release-approval-url-${workspace.id}`}
                                  />
                                  <Input
                                    value={releaseGateInput.secondReviewEvidenceUrl}
                                    onChange={(event) => updateReleaseGateInput(workspace.id, { secondReviewEvidenceUrl: event.target.value })}
                                    placeholder="Second review URL"
                                    className="border-zinc-800 bg-black"
                                    data-testid={`input-release-second-review-url-${workspace.id}`}
                                  />
                                  <Input
                                    value={releaseGateInput.appQaEvidenceUrl}
                                    onChange={(event) => updateReleaseGateInput(workspace.id, { appQaEvidenceUrl: event.target.value })}
                                    placeholder="App QA pass URL"
                                    className="border-zinc-800 bg-black"
                                    data-testid={`input-release-app-qa-url-${workspace.id}`}
                                  />
                                </div>
                                <div className="mt-3 grid gap-2 md:grid-cols-3">
                                  {[
                                    ["second-review", "Second review pass", releaseGateInput.secondReviewPassed, () => updateReleaseGateInput(workspace.id, { secondReviewPassed: !releaseGateInput.secondReviewPassed })],
                                    ["app-qa", "App QA pass", releaseGateInput.appQaPassed, () => updateReleaseGateInput(workspace.id, { appQaPassed: !releaseGateInput.appQaPassed })],
                                    ["robert-approval", "Robert approved", releaseGateInput.robertApprovedDeploy, () => updateReleaseGateInput(workspace.id, { robertApprovedDeploy: !releaseGateInput.robertApprovedDeploy })],
                                  ].map(([key, label, checked, toggle]) => (
                                    <label
                                      key={String(key)}
                                      className="flex min-h-10 items-center gap-3 rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={Boolean(checked)}
                                        onChange={() => (toggle as () => void)()}
                                        className="h-4 w-4 rounded border-zinc-700 bg-black"
                                        data-testid={`checkbox-release-${key}-${workspace.id}`}
                                      />
                                      {String(label)}
                                    </label>
                                  ))}
                                </div>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={
                                  deliveryWorkspacePrStatusMutation.isPending
                                  || workspace.codexBuildHandoff.status === "not_required"
                                  || !releaseGateInput.prUrl
                                }
                                onClick={() => deliveryWorkspacePrStatusMutation.mutate(workspace)}
                                className="mt-2 w-full border-indigo-500/30 bg-indigo-500/10 text-indigo-100 hover:bg-indigo-500/20"
                                data-testid={`button-check-pr-status-${workspace.id}`}
                              >
                                {deliveryWorkspacePrStatusMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitPullRequest className="mr-2 h-4 w-4" />}
                                Check PR status
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={
                                  deliveryWorkspaceAppQaGateMutation.isPending
                                  || workspace.codexBuildHandoff.status === "not_required"
                                  || !releaseGateInput.prUrl
                                }
                                onClick={() => deliveryWorkspaceAppQaGateMutation.mutate(workspace)}
                                className="mt-2 w-full border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                                data-testid={`button-run-workspace-app-qa-${workspace.id}`}
                              >
                                {deliveryWorkspaceAppQaGateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                Run App QA
                              </Button>
                              {deliveryWorkspaceAppQaGateMutation.data?.workspace?.id === workspace.id && (
                                <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3" data-testid="panel-workspace-app-qa-gate">
                                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                    <p className="text-sm font-medium text-emerald-100">{deliveryWorkspaceAppQaGateMutation.data.reason}</p>
                                    <Badge variant="outline" className={cn(statusTone(deliveryWorkspaceAppQaGateMutation.data.status), "shrink-0")}>
                                      {deliveryWorkspaceAppQaGateMutation.data.status}
                                    </Badge>
                                  </div>
                                  {deliveryWorkspaceAppQaGateMutation.data.scan && (
                                    <p className="mt-2 text-xs leading-5 text-zinc-300">
                                      {deliveryWorkspaceAppQaGateMutation.data.scan.summary} · fails {deliveryWorkspaceAppQaGateMutation.data.scan.failCount} · warnings {deliveryWorkspaceAppQaGateMutation.data.scan.warnCount}
                                    </p>
                                  )}
                                  {deliveryWorkspaceAppQaGateMutation.data.appQaPrCommentBody && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="mt-3 border-emerald-500/30 text-emerald-100"
                                      onClick={() => navigator.clipboard.writeText(deliveryWorkspaceAppQaGateMutation.data?.appQaPrCommentBody || "")}
                                      data-testid={`button-copy-app-qa-pr-comment-${workspace.id}`}
                                    >
                                      <Copy className="mr-2 h-4 w-4" />
                                      Copy App QA PR comment
                                    </Button>
                                  )}
                                </div>
                              )}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={
                                  deliveryWorkspaceReleaseGateMutation.isPending
                                  || workspace.codexBuildHandoff.status === "not_required"
                                  || !releaseGateInput.prUrl
                                  || !releaseGateInput.secondReviewEvidenceUrl
                                  || !releaseGateInput.appQaEvidenceUrl
                                  || !releaseGateInput.deploymentApprovalUrl
                                  || !releaseGateInput.secondReviewPassed
                                  || !releaseGateInput.appQaPassed
                                  || !releaseGateInput.robertApprovedDeploy
                                }
                                onClick={() => deliveryWorkspaceReleaseGateMutation.mutate(workspace)}
                                className="mt-2 w-full border-sky-500/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                                data-testid={`button-record-release-gate-${workspace.id}`}
                              >
                                {deliveryWorkspaceReleaseGateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                Registrar release gate
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => navigator.clipboard.writeText(buildCopyableTrustedDeliverRequest(workspace))}
                                className="mt-2 w-full border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                                data-testid={`button-copy-trusted-deliver-request-${workspace.id}`}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy delivery JSON
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={
                                  deliveryWorkspaceDeliverMutation.isPending
                                  || !trustedDeliveryReady
                                }
                                onClick={() => deliveryWorkspaceDeliverMutation.mutate(workspace)}
                                className="mt-2 w-full border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                                data-testid={`button-deliver-workspace-${workspace.id}`}
                              >
                                {deliveryWorkspaceDeliverMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                Entregar aprobado
                              </Button>
                              {!trustedDeliveryReady && (
                                <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100" data-testid={`panel-delivery-blocked-reason-${workspace.id}`}>
                                  {workspace.codexBuildHandoff.missing[0]
                                    || workspace.approvalSummary.requiredBeforeClient[0]
                                    || (workspace.status !== "ready_to_deliver"
                                      ? `workspace no esta listo: ${workspace.status}`
                                      : "release gate, App QA, rollback y aprobacion Robert requeridos antes de entregar")}
                                </div>
                              )}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={deliveryWorkspaceImprovementMutation.isPending}
                                onClick={() => deliveryWorkspaceImprovementMutation.mutate(workspace.id)}
                                className="mt-2 w-full border-violet-500/30 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
                                data-testid={`button-delivery-improvement-review-${workspace.id}`}
                              >
                                {deliveryWorkspaceImprovementMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TrendingUp className="mr-2 h-4 w-4" />}
                                Guardar review de mejora
                              </Button>
                            </div>
                          );
                          })
                        )}
                        {deliveryWorkspaceQaMutation.data && deliveryWorkspaceQaMutation.data.status !== "ready" && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                            {deliveryWorkspaceQaMutation.data.reason}
                          </div>
                        )}
                        {deliveryWorkspaceReleaseGateMutation.data && deliveryWorkspaceReleaseGateMutation.data.status !== "ready" && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                            {deliveryWorkspaceReleaseGateMutation.data.reason}
                          </div>
                        )}
                        {deliveryWorkspacePrStatusMutation.data?.prStatus && (
                          <div
                            className={cn(
                              "rounded-lg border px-3 py-2 text-xs",
                              deliveryWorkspacePrStatusMutation.data.prStatus.readyForReleaseEvidence
                                ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-100"
                                : "border-amber-500/20 bg-amber-500/5 text-amber-100",
                            )}
                            data-testid="panel-pr-status"
                          >
                            <p className="font-medium">
                              PR #{deliveryWorkspacePrStatusMutation.data.prStatus.pr.number}: {deliveryWorkspacePrStatusMutation.data.reason}
                            </p>
                            <p className="mt-1 text-zinc-400">
                              Checks {deliveryWorkspacePrStatusMutation.data.prStatus.checks.passed}/{deliveryWorkspacePrStatusMutation.data.prStatus.checks.total}
                              {" "}Status {deliveryWorkspacePrStatusMutation.data.prStatus.statuses.state}
                              {" "}Reviews {deliveryWorkspacePrStatusMutation.data.prStatus.approvedReviews.length}
                            </p>
                            {deliveryWorkspacePrStatusMutation.data.prStatus.blockers.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {deliveryWorkspacePrStatusMutation.data.prStatus.blockers.slice(0, 4).map((blocker) => (
                                  <p key={blocker}>- {blocker}</p>
                                ))}
                              </div>
                            )}
                            {deliveryWorkspacePrStatusMutation.data.prStatus.warnings.length > 0 && (
                              <div className="mt-2 space-y-1 text-zinc-400">
                                {deliveryWorkspacePrStatusMutation.data.prStatus.warnings.slice(0, 3).map((warning) => (
                                  <p key={warning}>- {warning}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {deliveryWorkspacePrStatusMutation.error && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                            {deliveryWorkspacePrStatusMutation.error.message}
                          </div>
                        )}
                        {deliveryWorkspaceReleaseGateMutation.data?.status === "ready" && (
                          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100">
                            Release gate registrado: PR, review, App QA y aprobacion listos para entrega controlada.
                          </div>
                        )}
                        {deliveryWorkspaceGithubHandoffMutation.data?.status === "created" && deliveryWorkspaceGithubHandoffMutation.data.developerHandoff && (
                          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-sky-100" data-testid="panel-github-handoff-next-action">
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div className="min-w-0">
                                {deliveryWorkspaceGithubHandoffMutation.data.developerHandoff.issueUrl && (
                                  <p className="break-words">
                                    GitHub issue creado: {deliveryWorkspaceGithubHandoffMutation.data.developerHandoff.issueUrl}
                                  </p>
                                )}
                                <p className="mt-1 text-sky-100">
                                  {deliveryWorkspaceGithubHandoffMutation.data.developerHandoff.message}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="shrink-0 border-sky-500/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                                onClick={() => navigator.clipboard.writeText([
                                  deliveryWorkspaceGithubHandoffMutation.data?.developerHandoff?.message,
                                  deliveryWorkspaceGithubHandoffMutation.data?.workspace?.codexBuildHandoff.publicBuildBrief,
                                ].filter(Boolean).join("\n\n"))}
                                data-testid="button-copy-github-handoff-next-action"
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy next action
                              </Button>
                            </div>
                          </div>
                        )}
                        {deliveryWorkspaceGithubHandoffMutation.data && deliveryWorkspaceGithubHandoffMutation.data.status !== "created" && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                            {deliveryWorkspaceGithubHandoffMutation.data.reason || deliveryWorkspaceGithubHandoffMutation.data.developerHandoff?.message || "No se pudo crear el handoff GitHub."}
                          </div>
                        )}
                        {deliveryWorkspaceGithubHandoffMutation.error && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                            {deliveryWorkspaceGithubHandoffMutation.error.message}
                          </div>
                        )}
                        {deliveryWorkspaceDeliverMutation.data && deliveryWorkspaceDeliverMutation.data.status !== "delivered" && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                            {deliveryWorkspaceDeliverMutation.data.reason}
                          </div>
                        )}
                        {deliveryWorkspaceImprovementMutation.data && deliveryWorkspaceImprovementMutation.data.status !== "recorded" && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                            {deliveryWorkspaceImprovementMutation.data.reason}
                          </div>
                        )}
                        {deliveryWorkspaceImprovementMutation.data?.status === "recorded" && deliveryWorkspaceImprovementMutation.data.review && (
                          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-violet-100">
                            Review guardada: {deliveryWorkspaceImprovementMutation.data.review.learningSummary}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="proposal" className="mt-0">
              <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MessageSquareText className="h-4 w-4 text-emerald-200" />
                      Email de cotizacion
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        proposalEmailMutation.mutate();
                      }}
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="proposal-contact">
                            Contacto
                          </label>
                          <Input
                            id="proposal-contact"
                            value={proposalContactName}
                            onChange={(event) => setProposalContactName(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-proposal-contact"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="proposal-business">
                            Negocio
                          </label>
                          <Input
                            id="proposal-business"
                            value={proposalBusinessName}
                            onChange={(event) => setProposalBusinessName(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-proposal-business"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="proposal-email">
                          Email destino
                        </label>
                        <Input
                          id="proposal-email"
                          type="email"
                          value={proposalRecipientEmail}
                          onChange={(event) => setProposalRecipientEmail(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-proposal-email"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="proposal-source">
                          Fuente
                        </label>
                        <Input
                          id="proposal-source"
                          value={proposalSourceUrl}
                          onChange={(event) => setProposalSourceUrl(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-proposal-source"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="proposal-summary">
                          Resumen del negocio
                        </label>
                        <Textarea
                          id="proposal-summary"
                          value={proposalSummary}
                          onChange={(event) => setProposalSummary(event.target.value)}
                          className="min-h-[150px] border-zinc-800 bg-black"
                          data-testid="textarea-proposal-summary"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="proposal-website-price">
                            Website
                          </label>
                          <Input
                            id="proposal-website-price"
                            type="number"
                            min={0}
                            value={proposalWebsitePriceUsd}
                            onChange={(event) => setProposalWebsitePriceUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-proposal-website-price"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="proposal-automation-price">
                            Automation
                          </label>
                          <Input
                            id="proposal-automation-price"
                            type="number"
                            min={0}
                            value={proposalAutomationPriceUsd}
                            onChange={(event) => setProposalAutomationPriceUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-proposal-automation-price"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="proposal-retainer">
                            Retainer
                          </label>
                          <Input
                            id="proposal-retainer"
                            type="number"
                            min={0}
                            value={proposalRetainerUsd}
                            onChange={(event) => setProposalRetainerUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-proposal-retainer"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="proposal-internal-cost">
                            Costo interno
                          </label>
                          <Input
                            id="proposal-internal-cost"
                            type="number"
                            min={0}
                            value={proposalInternalCostUsd}
                            onChange={(event) => setProposalInternalCostUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-proposal-internal-cost"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="proposal-notes">
                          Notas
                        </label>
                        <Textarea
                          id="proposal-notes"
                          value={proposalNotes}
                          onChange={(event) => setProposalNotes(event.target.value)}
                          className="min-h-[80px] border-zinc-800 bg-black"
                          data-testid="textarea-proposal-notes"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={proposalEmailMutation.isPending}
                        className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                        data-testid="button-generate-proposal-email"
                      >
                        {proposalEmailMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                        Generar draft
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {!proposalEmail ? (
                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardContent className="flex min-h-[520px] items-center justify-center p-6 text-center text-sm text-zinc-500">
                      Genera una cotizacion para revisar, copiar o abrir en Gmail. El sistema no envia nada sin cuenta conectada y aprobacion.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Setup total</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{money.format(proposalEmail.pricing.totalSetupUsd)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Deposito</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{money.format(proposalEmail.pricing.depositUsd)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Costo interno</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{money.format(proposalEmail.pricing.estimatedInternalMonthlyCostUsd)}</p>
                          <p className={cn("mt-1 text-xs", proposalEmail.pricing.insideCostCap ? "text-emerald-300" : "text-red-300")}>
                            {proposalEmail.pricing.insideCostCap ? "Dentro del cap" : "Fuera del cap"}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardContent className="p-4">
                          <p className="text-xs text-zinc-500">Margen</p>
                          <p className="mt-1 text-2xl font-semibold text-white">{proposalEmail.pricing.grossMarginPercent}%</p>
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <CardTitle className="text-base">{proposalEmail.subject}</CardTitle>
                            <p className="mt-1 text-sm text-zinc-500">{proposalEmail.delivery.reason}</p>
                          </div>
                          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-200">
                            {proposalEmail.delivery.mode}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="mb-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="border-zinc-700"
                            onClick={copyProposalEmail}
                            data-testid="button-copy-proposal-email"
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            {proposalCopied ? "Copiado" : "Copiar"}
                          </Button>
                          <a href={proposalEmail.links.gmailCompose} target="_blank" rel="noreferrer">
                            <Button type="button" variant="outline" className="border-zinc-700" data-testid="button-open-gmail-proposal">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Gmail
                            </Button>
                          </a>
                          <a href={proposalEmail.links.mailto}>
                            <Button type="button" variant="outline" className="border-zinc-700" data-testid="button-open-mailto-proposal">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Mail app
                            </Button>
                          </a>
                        </div>
                        <pre className="max-h-[620px] overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-black p-4 text-sm leading-6 text-zinc-300">
                          {proposalEmail.body}
                        </pre>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="outbox" className="mt-0">
              <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileCheck2 className="h-4 w-4 text-emerald-200" />
                      Cola de contacto
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        outreachDraftMutation.mutate();
                      }}
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="outreach-channel">
                            Canal
                          </label>
                          <select
                            id="outreach-channel"
                            value={outreachChannel}
                            onChange={(event) => setOutreachChannel(event.target.value as typeof outreachChannel)}
                            className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-zinc-100"
                            data-testid="select-outreach-channel"
                          >
                            <option value="gmail">Gmail</option>
                            <option value="email">Email</option>
                            <option value="mailto">Mail app</option>
                            <option value="instagram">Instagram</option>
                            <option value="contact_form">Contact form</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="outreach-mockup-url">
                            Mockup URL
                          </label>
                          <Input
                            id="outreach-mockup-url"
                            value={outreachMockupUrl}
                            onChange={(event) => setOutreachMockupUrl(event.target.value)}
                            className="border-zinc-800 bg-black"
                            placeholder="https://..."
                            data-testid="input-outreach-mockup-url"
                          />
                        </div>
                      </div>

                      <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-black p-3">
                        <input
                          type="checkbox"
                          checked={outreachApproved}
                          onChange={(event) => setOutreachApproved(event.target.checked)}
                          className="mt-1 h-4 w-4 accent-emerald-500"
                          data-testid="checkbox-outreach-approved"
                        />
                        <span>
                          <span className="block text-sm font-medium text-white">Aprobado por Robert</span>
                          <span className="mt-1 block text-xs leading-5 text-zinc-500">
                            Si no esta aprobado, queda como draft. Incluso aprobado, no se envia solo hasta conectar proveedor.
                          </span>
                        </span>
                      </label>

                      <Button
                        type="submit"
                        disabled={outreachDraftMutation.isPending}
                        className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                        data-testid="button-save-outreach-draft"
                      >
                        {outreachDraftMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquareText className="mr-2 h-4 w-4" />}
                        Guardar contacto
                      </Button>
                    </form>

                    <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-zinc-400">
                      Usa los datos actuales de la pestaña Propuesta. El agente guarda evidencia, precio, margen, links Gmail/mailto y gates de QA.
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  {outreachDraft && (
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <CardTitle className="text-base">{outreachDraft.draft.subject}</CardTitle>
                            <p className="mt-1 text-sm text-zinc-500">{outreachDraft.draft.nextAction}</p>
                          </div>
                          <Badge variant="outline" className={cn(statusTone(outreachDraft.draft.status), "shrink-0")}>
                            {outreachDraft.draft.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Setup</p>
                            <p className="mt-1 text-lg font-semibold text-white">{money.format(outreachDraft.draft.pricing.totalSetupUsd)}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Deposito</p>
                            <p className="mt-1 text-lg font-semibold text-white">{money.format(outreachDraft.draft.pricing.depositUsd)}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Retainer</p>
                            <p className="mt-1 text-lg font-semibold text-white">{money.format(outreachDraft.draft.pricing.monthlyRetainerUsd)}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Margen</p>
                            <p className="mt-1 text-lg font-semibold text-white">{outreachDraft.draft.pricing.grossMarginPercent}%</p>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-2 md:grid-cols-2">
                          {outreachDraft.draft.qaGates.map((gate) => (
                            <div key={gate.gate} className="rounded-lg border border-zinc-800 bg-black p-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-medium text-white">{gate.gate}</p>
                                <Badge variant="outline" className={cn(gate.passed ? statusTone("pass") : statusTone("blocked"), "shrink-0")}>
                                  {gate.passed ? "pass" : "fix"}
                                </Badge>
                              </div>
                              {!gate.passed && <p className="mt-2 text-xs leading-5 text-zinc-500">{gate.fix}</p>}
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="border-emerald-700 text-emerald-100"
                            disabled={outreachSendMutation.isPending || outreachDraft.draft.delivery.sendStatus === "sent" || !["email", "gmail", "mailto"].includes(outreachDraft.draft.channel)}
                            onClick={() => outreachSendMutation.mutate(outreachDraft.draft.id)}
                            data-testid="button-send-approved-outreach"
                          >
                            {outreachSendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Enviar aprobado
                          </Button>
                          {["email", "gmail", "mailto"].includes(outreachDraft.draft.channel) ? (
                            <>
                              <a href={outreachDraft.draft.links.gmailCompose} target="_blank" rel="noreferrer">
                                <Button type="button" variant="outline" className="border-zinc-700" data-testid="button-outreach-gmail">
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Gmail
                                </Button>
                              </a>
                              <a href={outreachDraft.draft.links.mailto}>
                                <Button type="button" variant="outline" className="border-zinc-700" data-testid="button-outreach-mailto">
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Mail app
                                </Button>
                              </a>
                            </>
                          ) : outreachDraft.draft.sourceUrl ? (
                            <a href={outreachDraft.draft.sourceUrl} target="_blank" rel="noreferrer">
                              <Button type="button" variant="outline" className="border-zinc-700">
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Abrir canal
                              </Button>
                            </a>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardHeader>
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <CardTitle className="text-base">Proveedor de envio</CardTitle>
                          <p className="mt-1 text-sm text-zinc-500">{snapshot?.emailProvider?.sendPolicy || "Cargando estado del proveedor..."}</p>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(snapshot?.emailProvider?.configured ? statusTone("pass") : statusTone("draft"), "shrink-0")}
                        >
                          {snapshot?.emailProvider?.configured ? "listo" : "manual"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-lg border border-zinc-800 bg-black p-3">
                          <p className="text-xs text-zinc-500">Provider</p>
                          <p className="mt-1 text-sm font-medium text-white">{snapshot?.emailProvider?.provider || "resend"}</p>
                        </div>
                        <div className="rounded-lg border border-zinc-800 bg-black p-3">
                          <p className="text-xs text-zinc-500">From</p>
                          <p className="mt-1 break-words text-sm font-medium text-white">{snapshot?.emailProvider?.fromEmail || "sin configurar"}</p>
                        </div>
                        <div className="rounded-lg border border-zinc-800 bg-black p-3">
                          <p className="text-xs text-zinc-500">Costo mensual</p>
                          <p className="mt-1 text-sm font-medium text-white">{money.format(snapshot?.emailProvider?.monthlyCostUsd || 0)}</p>
                        </div>
                      </div>
                      {!snapshot?.emailProvider?.configured && (
                        <p className="mt-3 text-sm leading-6 text-zinc-500">
                          Falta {snapshot?.emailProvider?.missing.join(" y ") || "configuracion de email"}. Mientras tanto, usa Gmail/mailto y el sistema no marca envios como completados.
                        </p>
                      )}
                      {outreachSendMutation.data && (
                        <div className="mt-3 rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-white">Ultimo intento</p>
                            <Badge variant="outline" className={cn(statusTone(outreachSendMutation.data.status), "shrink-0")}>
                              {outreachSendMutation.data.status}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-zinc-500">
                            {outreachSendMutation.data.sendResult?.id || outreachSendMutation.data.reason || outreachSendMutation.data.draft?.delivery.reason}
                          </p>
                        </div>
                      )}
                      {outreachOutcomeMutation.data && (
                        <div className="mt-3 rounded-lg border border-zinc-800 bg-black p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-white">Ultimo outcome</p>
                            <Badge variant="outline" className={cn(statusTone(outreachOutcomeMutation.data.status), "shrink-0")}>
                              {outreachOutcomeMutation.data.status}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-zinc-500">{outreachOutcomeMutation.data.reason}</p>
                        </div>
                      )}
                      {outreachApproveMutation.data && (
                        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-emerald-100">Aprobacion de draft</p>
                            <Badge variant="outline" className={cn(statusTone(outreachApproveMutation.data.status), "shrink-0")}>
                              {outreachApproveMutation.data.status}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-zinc-500">{outreachApproveMutation.data.reason}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardHeader>
                      <CardTitle className="text-base">Ultimos drafts guardados</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(snapshot?.recentOutreach || []).length === 0 ? (
                        <div className="rounded-lg border border-dashed border-zinc-800 bg-black p-5 text-center text-sm text-zinc-500">
                          Todavia no hay contactos guardados.
                        </div>
                      ) : (
                        snapshot?.recentOutreach.map((draft) => (
                          <div key={draft.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="font-medium text-white">{draft.businessName}</p>
                                <p className="mt-1 text-sm text-zinc-500">{draft.subject}</p>
                              </div>
                              <Badge variant="outline" className={cn(statusTone(draft.status), "shrink-0")}>
                                {draft.status}
                              </Badge>
                            </div>
                            <div className="mt-3 grid gap-2 text-sm text-zinc-400 md:grid-cols-3">
                              <p>{draft.channel}</p>
                              <p>{money.format(draft.pricing.totalSetupUsd)}</p>
                              <p>{draft.delivery.outcome || draft.delivery.sendStatus}</p>
                            </div>
                            {draft.delivery.outcomeNotes && (
                              <p className="mt-2 text-xs leading-5 text-zinc-500">
                                {draft.delivery.outcomeNotes}
                                {draft.delivery.outcomeCashCollectedUsd ? ` · ${money.format(draft.delivery.outcomeCashCollectedUsd)} cash` : ""}
                              </p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border-sky-700 text-sky-100"
                                disabled={outreachApproveMutation.isPending || draft.status === "approved" || draft.delivery.sendStatus === "sent"}
                                onClick={() => outreachApproveMutation.mutate(draft.id)}
                                data-testid={`button-approve-draft-${draft.id}`}
                              >
                                {outreachApproveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Aprobar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border-emerald-700 text-emerald-100"
                                disabled={outreachSendMutation.isPending || draft.status !== "approved" || draft.delivery.sendStatus === "sent" || !["email", "gmail", "mailto"].includes(draft.channel)}
                                onClick={() => outreachSendMutation.mutate(draft.id)}
                                data-testid={`button-send-draft-${draft.id}`}
                              >
                                {outreachSendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                Enviar
                              </Button>
                              {["email", "gmail", "mailto"].includes(draft.channel) ? (
                                <a href={draft.links.gmailCompose} target="_blank" rel="noreferrer">
                                  <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    Gmail
                                  </Button>
                                </a>
                              ) : draft.sourceUrl ? (
                                <a href={draft.sourceUrl} target="_blank" rel="noreferrer">
                                  <Button type="button" size="sm" variant="outline" className="border-zinc-700">
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    Canal
                                  </Button>
                                </a>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border-sky-700 text-sky-100"
                                disabled={outreachOutcomeMutation.isPending || draft.status !== "approved"}
                                onClick={() => outreachOutcomeMutation.mutate({
                                  draftId: draft.id,
                                  outcome: "reply",
                                  notes: "Robert registro reply manual del negocio.",
                                })}
                                data-testid="button-record-outreach-reply"
                              >
                                Reply
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border-violet-700 text-violet-100"
                                disabled={outreachOutcomeMutation.isPending || draft.status !== "approved"}
                                onClick={() => outreachOutcomeMutation.mutate({
                                  draftId: draft.id,
                                  outcome: "call_booked",
                                  notes: "Robert registro llamada agendada.",
                                })}
                                data-testid="button-record-outreach-call"
                              >
                                Call
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border-emerald-700 text-emerald-100"
                                disabled={outreachOutcomeMutation.isPending || draft.status !== "approved" || draft.pricing.depositUsd <= 0}
                                onClick={() => {
                                  const paymentConfirmation = requestDepositPaymentConfirmation(draft.businessName, draft.pricing.depositUsd);
                                  if (!paymentConfirmation) return;
                                  outreachOutcomeMutation.mutate({
                                    draftId: draft.id,
                                    outcome: "deposit_collected",
                                    cashCollectedUsd: draft.pricing.depositUsd,
                                    paymentConfirmation,
                                    notes: "Robert confirmo deposito manual; crear delivery workspace para contabilizar venta.",
                                  });
                                }}
                                data-testid="button-record-outreach-deposit"
                              >
                                Deposit
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border-red-900 text-red-100"
                                disabled={outreachOutcomeMutation.isPending || draft.status !== "approved"}
                                onClick={() => outreachOutcomeMutation.mutate({
                                  draftId: draft.id,
                                  outcome: "lost",
                                  notes: "Robert marco el lead como perdido.",
                                })}
                                data-testid="button-record-outreach-lost"
                              >
                                Lost
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="improvement" className="mt-0">
              <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TrendingUp className="h-4 w-4 text-emerald-200" />
                      Review de mejora
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        improvementReviewMutation.mutate();
                      }}
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-campaign">
                            Campana
                          </label>
                          <Input
                            id="improvement-campaign"
                            value={improvementCampaignName}
                            onChange={(event) => setImprovementCampaignName(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-campaign"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-period">
                            Periodo
                          </label>
                          <Input
                            id="improvement-period"
                            value={improvementPeriodLabel}
                            onChange={(event) => setImprovementPeriodLabel(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-period"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-leads">
                            Leads
                          </label>
                          <Input
                            id="improvement-leads"
                            type="number"
                            min={0}
                            value={improvementLeadsContacted}
                            onChange={(event) => setImprovementLeadsContacted(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-leads"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-replies">
                            Replies
                          </label>
                          <Input
                            id="improvement-replies"
                            type="number"
                            min={0}
                            value={improvementReplies}
                            onChange={(event) => setImprovementReplies(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-replies"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-calls">
                            Calls
                          </label>
                          <Input
                            id="improvement-calls"
                            type="number"
                            min={0}
                            value={improvementCallsBooked}
                            onChange={(event) => setImprovementCallsBooked(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-calls"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-closed">
                            Cerrados
                          </label>
                          <Input
                            id="improvement-closed"
                            type="number"
                            min={0}
                            value={improvementDealsClosed}
                            onChange={(event) => setImprovementDealsClosed(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-closed"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-revenue">
                            Cobrado
                          </label>
                          <Input
                            id="improvement-revenue"
                            type="number"
                            min={0}
                            value={improvementRevenueCollectedUsd}
                            onChange={(event) => setImprovementRevenueCollectedUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-revenue"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-spend">
                            Gasto
                          </label>
                          <Input
                            id="improvement-spend"
                            type="number"
                            min={0}
                            value={improvementSpendUsd}
                            onChange={(event) => setImprovementSpendUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-spend"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-cost">
                            Costo int.
                          </label>
                          <Input
                            id="improvement-cost"
                            type="number"
                            min={0}
                            value={improvementInternalCostUsd}
                            onChange={(event) => setImprovementInternalCostUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-cost"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-hours">
                            Horas
                          </label>
                          <Input
                            id="improvement-hours"
                            type="number"
                            min={0}
                            value={improvementHoursSaved}
                            onChange={(event) => setImprovementHoursSaved(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-hours"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-defects">
                            Defectos
                          </label>
                          <Input
                            id="improvement-defects"
                            type="number"
                            min={0}
                            value={improvementDefectsFound}
                            onChange={(event) => setImprovementDefectsFound(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-improvement-defects"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-complaints">
                          Quejas cliente
                        </label>
                        <Input
                          id="improvement-complaints"
                          type="number"
                          min={0}
                          value={improvementClientComplaints}
                          onChange={(event) => setImprovementClientComplaints(Number(event.target.value))}
                          className="border-zinc-800 bg-black"
                          data-testid="input-improvement-complaints"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-offer">
                          Oferta ganadora
                        </label>
                        <Input
                          id="improvement-offer"
                          value={improvementBestOffer}
                          onChange={(event) => setImprovementBestOffer(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-improvement-offer"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-objection">
                          Objecion principal
                        </label>
                        <Textarea
                          id="improvement-objection"
                          value={improvementBiggestObjection}
                          onChange={(event) => setImprovementBiggestObjection(event.target.value)}
                          className="min-h-[72px] border-zinc-800 bg-black"
                          data-testid="textarea-improvement-objection"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="improvement-notes">
                          Notas
                        </label>
                        <Textarea
                          id="improvement-notes"
                          value={improvementNotes}
                          onChange={(event) => setImprovementNotes(event.target.value)}
                          className="min-h-[80px] border-zinc-800 bg-black"
                          data-testid="textarea-improvement-notes"
                        />
                      </div>

                      <Button
                        type="submit"
                        disabled={improvementReviewMutation.isPending}
                        className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                        data-testid="button-run-improvement-review"
                      >
                        {improvementReviewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TrendingUp className="mr-2 h-4 w-4" />}
                        Revisar mejora
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {!improvementReview ? (
                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardContent className="flex min-h-[520px] items-center justify-center p-6 text-center text-sm text-zinc-500">
                      Corre un review semanal para decidir si pausamos, iteramos o escalamos sin pasar el cap de gasto.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <CardTitle className="text-base">{improvementReview.input.campaignName}</CardTitle>
                            <p className="mt-1 text-sm text-zinc-500">
                              {improvementReview.learningSummary || improvementReview.decision.reason}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            {"playbookVersion" in improvementReview && (
                              <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-200">
                                v{improvementReview.playbookVersion}
                              </Badge>
                            )}
                            <Badge variant="outline" className={cn(statusTone(improvementReview.decision.status), "shrink-0")}>
                              {improvementReview.decision.status}
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Reply rate</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{improvementReview.metrics.replyRate}%</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Close rate</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{improvementReview.metrics.closeRate}%</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Profit</p>
                            <p className={cn("mt-1 text-2xl font-semibold", improvementReview.metrics.profitUsd >= 0 ? "text-emerald-200" : "text-red-200")}>
                              {money.format(improvementReview.metrics.profitUsd)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">ROI</p>
                            <p className="mt-1 text-2xl font-semibold text-white">{improvementReview.metrics.roiPercent}%</p>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Costo/reply</p>
                            <p className="mt-1 text-lg font-semibold text-white">{money.format(improvementReview.metrics.costPerReplyUsd)}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Costo/call</p>
                            <p className="mt-1 text-lg font-semibold text-white">{money.format(improvementReview.metrics.costPerBookedCallUsd)}</p>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-black p-3">
                            <p className="text-xs text-zinc-500">Proximo batch</p>
                            <p className="mt-1 text-lg font-semibold text-white">
                              {improvementReview.nextBatch.maxLeads} leads / {money.format(improvementReview.nextBatch.maxSpendUsd)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                      <div className="space-y-4">
                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Experimentos</CardTitle>
                          </CardHeader>
                          <CardContent className="grid gap-2 md:grid-cols-2">
                            {improvementReview.experiments.map((experiment) => (
                              <div key={experiment} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                                {experiment}
                              </div>
                            ))}
                          </CardContent>
                        </Card>

                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Scorecard de agentes</CardTitle>
                          </CardHeader>
                          <CardContent className="grid gap-2 md:grid-cols-2">
                            {improvementReview.agentScorecard.map((agent) => (
                              <div key={agent.agent} className="rounded-lg border border-zinc-800 bg-black p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium text-white">{agent.agent}</p>
                                  <Badge variant="outline" className={cn(statusTone(agent.score), "shrink-0")}>
                                    {agent.score}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-sm text-zinc-500">{agent.lesson}</p>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </div>

                      <div className="space-y-4">
                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Playbook</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {improvementReview.playbookUpdates.map((update) => (
                              <div key={update} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                                {update}
                              </div>
                            ))}
                          </CardContent>
                        </Card>

                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Antes de enviar</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {improvementReview.nextBatch.requiredBeforeNextSend.map((item) => (
                              <div key={item} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-100">
                                {item}
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </div>
                    </div>

                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <CardTitle className="text-base">Memoria de aprendizaje</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {(snapshot?.recentImprovementReviews || []).length === 0 ? (
                          <div className="rounded-lg border border-dashed border-zinc-800 bg-black p-4 text-center text-sm text-zinc-500">
                            Todavia no hay aprendizajes guardados.
                          </div>
                        ) : (
                          snapshot?.recentImprovementReviews.map((review) => (
                            <div key={review.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-white">{review.input.campaignName}</p>
                                  <p className="mt-1 text-xs text-zinc-500">{review.input.periodLabel}</p>
                                </div>
                                <Badge variant="outline" className={cn(statusTone(review.decisionStatus), "shrink-0")}>
                                  v{review.playbookVersion}
                                </Badge>
                              </div>
                              <p className="mt-3 text-sm leading-5 text-zinc-400">{review.learningSummary}</p>
                              <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
                                <p>Reply {review.metrics.replyRate}%</p>
                                <p>Close {review.metrics.closeRate}%</p>
                                <p>{money.format(review.metrics.profitUsd)} profit</p>
                              </div>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="ledger" className="mt-0">
              <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CircleDollarSign className="h-4 w-4 text-emerald-200" />
                      Registrar movimiento
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        ledgerMutation.mutate();
                      }}
                    >
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="ledger-kind">
                          Tipo
                        </label>
                        <select
                          id="ledger-kind"
                          value={ledgerKind}
                          onChange={(event) => setLedgerKind(event.target.value as typeof ledgerKind)}
                          className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none"
                          data-testid="select-ledger-kind"
                        >
                          <option value="bundle_sale">Website + automation</option>
                          <option value="website_sale">Website</option>
                          <option value="automation_sale">Automation</option>
                          <option value="retainer">Retainer</option>
                          <option value="expense">Gasto</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="ledger-client">
                          Cliente / concepto
                        </label>
                        <Input
                          id="ledger-client"
                          value={ledgerClientName}
                          onChange={(event) => setLedgerClientName(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-ledger-client"
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="ledger-amount">
                            Monto
                          </label>
                          <Input
                            id="ledger-amount"
                            type="number"
                            min={0}
                            value={ledgerAmountUsd}
                            onChange={(event) => setLedgerAmountUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-ledger-amount"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="ledger-cash">
                            Cobrado
                          </label>
                          <Input
                            id="ledger-cash"
                            type="number"
                            min={0}
                            disabled={ledgerKind === "expense"}
                            value={ledgerKind === "expense" ? 0 : ledgerCashCollectedUsd}
                            onChange={(event) => setLedgerCashCollectedUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black disabled:opacity-50"
                            data-testid="input-ledger-cash"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="ledger-cost">
                            Costo
                          </label>
                          <Input
                            id="ledger-cost"
                            type="number"
                            min={0}
                            value={ledgerInternalCostUsd}
                            onChange={(event) => setLedgerInternalCostUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-ledger-cost"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="ledger-notes">
                          Notas
                        </label>
                        <Textarea
                          id="ledger-notes"
                          value={ledgerNotes}
                          onChange={(event) => setLedgerNotes(event.target.value)}
                          className="min-h-[88px] border-zinc-800 bg-black"
                          data-testid="textarea-ledger-notes"
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button
                          type="button"
                          disabled={expensePreflightMutation.isPending || ledgerKind !== "expense"}
                          variant="outline"
                          onClick={() => expensePreflightMutation.mutate()}
                          className="border-sky-500/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20 disabled:opacity-50"
                          data-testid="button-preflight-expense"
                        >
                          {expensePreflightMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                          Preflight gasto
                        </Button>
                        <Button
                          type="submit"
                          disabled={ledgerMutation.isPending}
                          className="bg-emerald-600 text-white hover:bg-emerald-500"
                          data-testid="button-record-ledger"
                        >
                          {ledgerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CircleDollarSign className="mr-2 h-4 w-4" />}
                          Registrar
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  {expensePreflightMutation.data && (
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <CardTitle className="text-base">Preflight gasto</CardTitle>
                          <Badge variant="outline" className={cn(statusTone(expensePreflightMutation.data.status), "shrink-0")}>
                            {expensePreflightMutation.data.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                            <p className="text-xs text-zinc-500">Spend proyectado</p>
                            <p className="mt-1 text-sm font-semibold text-white">{money.format(expensePreflightMutation.data.projected.spendUsd)}</p>
                          </div>
                          <div className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                            <p className="text-xs text-zinc-500">Profit proyectado</p>
                            <p className={cn("mt-1 text-sm font-semibold", expensePreflightMutation.data.projected.profitUsd >= 0 ? "text-emerald-100" : "text-red-100")}>
                              {money.format(expensePreflightMutation.data.projected.profitUsd)}
                            </p>
                          </div>
                          <div className="rounded-md border border-zinc-800 bg-black px-3 py-2">
                            <p className="text-xs text-zinc-500">Cap libre</p>
                            <p className="mt-1 text-sm font-semibold text-white">{money.format(expensePreflightMutation.data.projected.remainingCapUsd)}</p>
                          </div>
                        </div>
                        <p className="rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-6 text-zinc-300">
                          {expensePreflightMutation.data.nextAction}
                        </p>
                        {expensePreflightMutation.data.blockers.length > 0 && (
                          <div className="space-y-2">
                            {expensePreflightMutation.data.blockers.map((blocker) => (
                              <div key={blocker} className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-100">
                                {blocker}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                  {ledgerMutation.data && (
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardHeader>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <CardTitle className="text-base">Guardrail</CardTitle>
                          <Badge variant="outline" className={cn(statusTone(ledgerMutation.data.guardrail.status), "shrink-0")}>
                            {ledgerMutation.data.guardrail.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-6 text-zinc-300">
                          {ledgerMutation.data.guardrail.reason}
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  <div className="grid gap-3 md:grid-cols-4">
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardContent className="p-4">
                        <p className="text-xs text-zinc-500">Cash</p>
                        <p className="mt-1 text-2xl font-semibold text-white">{money.format(snapshot?.metrics.cashCollectedUsd ?? 0)}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardContent className="p-4">
                        <p className="text-xs text-zinc-500">Revenue</p>
                        <p className="mt-1 text-2xl font-semibold text-white">{money.format(snapshot?.metrics.revenueUsd ?? 0)}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardContent className="p-4">
                        <p className="text-xs text-zinc-500">Gasto</p>
                        <p className="mt-1 text-2xl font-semibold text-white">{money.format(snapshot?.metrics.estimatedSpendUsd ?? 0)}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardContent className="p-4">
                        <p className="text-xs text-zinc-500">Profit</p>
                        <p className={cn("mt-1 text-2xl font-semibold", (snapshot?.metrics.profitUsd ?? 0) >= 0 ? "text-emerald-200" : "text-red-200")}>
                          {money.format(snapshot?.metrics.profitUsd ?? 0)}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardHeader>
                      <CardTitle className="text-base">Movimientos recientes</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {(snapshot?.recentLedger || []).length === 0 ? (
                        <div className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-500">
                          Todavia no hay ventas ni gastos registrados en esta sesion.
                        </div>
                      ) : (
                        (snapshot?.recentLedger || []).map((entry) => (
                          <div key={entry.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="text-sm font-medium text-white">{entry.clientName}</p>
                                <p className="mt-1 text-xs text-zinc-500">{entry.kind} · {new Date(entry.createdAt).toLocaleString()}</p>
                              </div>
                              <div className="text-left md:text-right">
                                <p className="text-sm font-semibold text-white">{money.format(entry.amountUsd)}</p>
                                <p className="text-xs text-zinc-500">cash {money.format(entry.cashCollectedUsd)} · costo {money.format(entry.estimatedInternalCostUsd)}</p>
                              </div>
                            </div>
                            {entry.notes && <p className="mt-3 text-sm text-zinc-400">{entry.notes}</p>}
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="offers" className="mt-0">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {(snapshot?.packages || []).map((offer) => (
                  <Card key={offer.id} className="border-zinc-800 bg-zinc-950/80">
                    <CardHeader>
                      <CardTitle className="text-base">{offer.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-semibold text-white">{money.format(offer.priceUsd)}</p>
                      <p className="mt-1 text-sm text-zinc-500">+ {money.format(offer.recurringUsd)}/mes</p>
                      <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
                        <span>{offer.delivery}</span>
                        <span>{offer.marginTarget}</span>
                      </div>
                      <div className="mt-4 space-y-2">
                        {offer.includes.map((item) => (
                          <div key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                            {item}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="orchestrator" className="mt-0">
              <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
                <Card className="border-zinc-800 bg-zinc-950/80">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Bot className="h-4 w-4 text-emerald-200" />
                      Agente principal
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        agentRunMutation.mutate();
                      }}
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="agent-business">
                            Negocio
                          </label>
                          <Input
                            id="agent-business"
                            value={agentBusinessName}
                            onChange={(event) => setAgentBusinessName(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-agent-business"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="agent-area">
                            Area
                          </label>
                          <Input
                            id="agent-area"
                            value={agentArea}
                            onChange={(event) => setAgentArea(event.target.value)}
                            className="border-zinc-800 bg-black"
                            data-testid="input-agent-area"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="agent-niche">
                          Nicho
                        </label>
                        <Input
                          id="agent-niche"
                          value={agentNiche}
                          onChange={(event) => setAgentNiche(event.target.value)}
                          className="border-zinc-800 bg-black"
                          data-testid="input-agent-niche"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="agent-stage">
                            Etapa
                          </label>
                          <select
                            id="agent-stage"
                            value={agentStage}
                            onChange={(event) => setAgentStage(event.target.value as typeof agentStage)}
                            className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-zinc-100"
                            data-testid="select-agent-stage"
                          >
                            <option value="lead_research">Research</option>
                            <option value="mockup">Mockup</option>
                            <option value="outreach">Outreach</option>
                            <option value="proposal">Propuesta</option>
                            <option value="production">Produccion</option>
                            <option value="delivery">Entrega</option>
                            <option value="improvement">Mejora</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="agent-type">
                            Tipo
                          </label>
                          <select
                            id="agent-type"
                            value={agentProjectType}
                            onChange={(event) => setAgentProjectType(event.target.value as typeof agentProjectType)}
                            className="h-10 w-full rounded-md border border-zinc-800 bg-black px-3 text-sm text-zinc-100"
                            data-testid="select-agent-type"
                          >
                            <option value="bundle">Website + automation</option>
                            <option value="website">Website</option>
                            <option value="automation">Automation</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="agent-request">
                          Pedido
                        </label>
                        <Textarea
                          id="agent-request"
                          value={agentRequest}
                          onChange={(event) => setAgentRequest(event.target.value)}
                          className="min-h-[130px] border-zinc-800 bg-black"
                          data-testid="textarea-agent-request"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="agent-offer">
                            Oferta
                          </label>
                          <Input
                            id="agent-offer"
                            type="number"
                            min={0}
                            value={agentEstimatedOfferUsd}
                            onChange={(event) => setAgentEstimatedOfferUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-agent-offer"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="agent-cost">
                            Costo interno
                          </label>
                          <Input
                            id="agent-cost"
                            type="number"
                            min={0}
                            value={agentInternalCostUsd}
                            onChange={(event) => setAgentInternalCostUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-agent-cost"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="agent-budget">
                            Budget mensual
                          </label>
                          <Input
                            id="agent-budget"
                            type="number"
                            min={0}
                            max={100}
                            value={agentMonthlyBudgetUsd}
                            onChange={(event) => setAgentMonthlyBudgetUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-agent-budget"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500" htmlFor="agent-cash">
                            Cash cobrado
                          </label>
                          <Input
                            id="agent-cash"
                            type="number"
                            min={0}
                            value={agentCashCollectedUsd}
                            onChange={(event) => setAgentCashCollectedUsd(Number(event.target.value))}
                            className="border-zinc-800 bg-black"
                            data-testid="input-agent-cash"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        {[
                          ["contact", "Contacto aprobado", agentApprovalToContact, setAgentApprovalToContact],
                          ["spend", "Gasto aprobado", agentApprovalToSpend, setAgentApprovalToSpend],
                          ["build", "Build aprobado", agentApprovalToBuild, setAgentApprovalToBuild],
                        ].map(([id, label, checked, setter]) => (
                          <label key={id as string} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
                            <input
                              type="checkbox"
                              checked={checked as boolean}
                              onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)}
                              className="h-4 w-4 accent-emerald-500"
                              data-testid={`checkbox-agent-${id}`}
                            />
                            {label as string}
                          </label>
                        ))}
                      </div>
                      <Button
                        type="submit"
                        disabled={agentRunMutation.isPending}
                        className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
                        data-testid="button-run-agent"
                      >
                        {agentRunMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                        Correr agente
                      </Button>
                      <Button
                        type="button"
                        disabled={salesAutopilotMutation.isPending}
                        onClick={() => salesAutopilotMutation.mutate()}
                        className="w-full bg-sky-600 text-white hover:bg-sky-500"
                        data-testid="button-run-sales-autopilot"
                      >
                        {salesAutopilotMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                        Sales autopilot
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  {salesAutopilot && (
                    <Card className="border-sky-500/30 bg-sky-950/20">
                      <CardHeader>
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <CardTitle className="text-base">Sales autopilot: {salesAutopilot.lead.businessName}</CardTitle>
                            <p className="mt-1 text-sm text-sky-100/80">{salesAutopilot.guardrail}</p>
                          </div>
                          <Badge variant="outline" className={cn(statusTone(salesAutopilot.status), "shrink-0")}>
                            {salesAutopilot.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="rounded-lg border border-sky-500/20 bg-black p-3">
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Lead</p>
                            <p className="mt-1 text-lg font-semibold text-white">{salesAutopilot.leadQualification.grade} · {salesAutopilot.lead.status}</p>
                          </div>
                          <div className="rounded-lg border border-sky-500/20 bg-black p-3">
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Mockup</p>
                            <p className="mt-1 text-lg font-semibold text-white">{salesAutopilot.mockup.decision.status}</p>
                          </div>
                          <div className="rounded-lg border border-sky-500/20 bg-black p-3">
                            <p className="text-xs uppercase tracking-wide text-zinc-500">QA</p>
                            <p className="mt-1 text-lg font-semibold text-white">{salesAutopilot.deliveryReview.status}</p>
                          </div>
                          <div className="rounded-lg border border-sky-500/20 bg-black p-3">
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Outbox</p>
                            <p className="mt-1 text-lg font-semibold text-white">{salesAutopilot.outreachDraft?.status || "no draft"}</p>
                          </div>
                        </div>
                        {salesAutopilot.clarificationGate.status === "needs_clarification" && (
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                            <p className="text-sm font-medium text-amber-100">Preguntar antes de vender o construir</p>
                            <p className="mt-1 text-xs text-amber-100/70">{salesAutopilot.clarificationGate.minimumAnswer}</p>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              {salesAutopilot.clarificationGate.questions.map((question) => (
                                <div key={question} className="rounded-md border border-amber-500/20 bg-black px-3 py-2 text-sm text-amber-100">
                                  {question}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Bloqueos antes de accion externa</p>
                            <div className="mt-2 space-y-2">
                              {salesAutopilot.requiredBeforeExternalAction.length === 0 ? (
                                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                                  Sin bloqueos criticos. Revisar outbox antes de enviar.
                                </div>
                              ) : (
                                salesAutopilot.requiredBeforeExternalAction.map((item) => (
                                  <div key={item} className="rounded-md border border-amber-500/20 bg-black px-3 py-2 text-sm text-amber-100">
                                    {item}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-zinc-500">Siguientes acciones</p>
                            <div className="mt-2 space-y-2">
                              {salesAutopilot.nextActions.map((item) => (
                                <div key={item} className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                                  {item}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {!activeAgentRun ? (
                    <Card className="border-zinc-800 bg-zinc-950/80">
                      <CardContent className="flex min-h-[420px] items-center justify-center p-6 text-center text-sm text-zinc-500">
                        Corre el agente principal para coordinar research, mockup, automatizacion, cierre, QA y rentabilidad.
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardHeader>
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <CardTitle className="text-base">{activeAgentRun.run.businessName}</CardTitle>
                              <p className="mt-1 text-sm text-zinc-500">{activeAgentRun.run.mainAgent.reason}</p>
                            </div>
                            <Badge variant="outline" className={cn(statusTone(activeAgentRun.run.status), "shrink-0")}>
                              {activeAgentRun.run.status}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-3 md:grid-cols-4">
                            <div className="rounded-lg border border-zinc-800 bg-black p-3">
                              <p className="text-xs text-zinc-500">Oferta</p>
                              <p className="mt-1 text-lg font-semibold text-white">{money.format(activeAgentRun.run.estimatedOfferUsd)}</p>
                            </div>
                            <div className="rounded-lg border border-zinc-800 bg-black p-3">
                              <p className="text-xs text-zinc-500">Costo</p>
                              <p className="mt-1 text-lg font-semibold text-white">{money.format(activeAgentRun.run.estimatedInternalCostUsd)}</p>
                            </div>
                            <div className="rounded-lg border border-zinc-800 bg-black p-3">
                              <p className="text-xs text-zinc-500">Permitido gastar</p>
                              <p className="mt-1 text-lg font-semibold text-white">{money.format(activeAgentRun.run.budgetGate.allowedSpendUsd)}</p>
                            </div>
                            <div className="rounded-lg border border-zinc-800 bg-black p-3">
                              <p className="text-xs text-zinc-500">Cap</p>
                              <p className={cn("mt-1 text-lg font-semibold", activeAgentRun.run.budgetGate.insideCap ? "text-emerald-200" : "text-red-200")}>
                                {activeAgentRun.run.budgetGate.insideCap ? "ok" : "block"}
                              </p>
                            </div>
                          </div>

                          {activeAgentRun.run.requiredApprovals.length > 0 && (
                            <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                              <p className="text-sm font-medium text-amber-100">Aprobaciones requeridas</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {activeAgentRun.run.requiredApprovals.map((approval) => (
                                  <Badge key={approval} variant="outline" className="border-amber-500/40 text-amber-200">
                                    {approval}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {activeAgentRun.run.clarificationGate.status === "needs_clarification" && (
                            <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                              <p className="text-sm font-medium text-amber-100">Preguntas de aclaracion</p>
                              <p className="mt-1 text-xs text-amber-100/70">{activeAgentRun.run.clarificationGate.minimumAnswer}</p>
                              <div className="mt-2 grid gap-2 md:grid-cols-2">
                                {activeAgentRun.run.clarificationGate.questions.map((question) => (
                                  <div key={question} className="rounded-md border border-amber-500/20 bg-black px-3 py-2 text-sm text-amber-100">
                                    {question}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Work order</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {activeAgentRun.run.workOrder.map((step) => (
                              <div key={`${step.ownerAgent}-${step.step}`} className="rounded-lg border border-zinc-800 bg-black p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-medium text-white">{step.step}</p>
                                    <p className="mt-1 text-xs text-zinc-500">{step.ownerAgent}</p>
                                  </div>
                                  {step.approvalRequired && (
                                    <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                                      approval
                                    </Badge>
                                  )}
                                </div>
                                <p className="mt-2 text-sm leading-5 text-zinc-400">{step.output}</p>
                              </div>
                            ))}
                          </CardContent>
                        </Card>

                        <Card className="border-zinc-800 bg-zinc-950/80">
                          <CardHeader>
                            <CardTitle className="text-base">Subagentes corrigiendo</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {activeAgentRun.run.subagentReviews.map((review) => (
                              <div key={review.agent} className="rounded-lg border border-zinc-800 bg-black p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium text-white">{review.agent}</p>
                                  <Badge variant="outline" className={cn(statusTone(review.verdict), "shrink-0")}>
                                    {review.verdict}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-sm leading-5 text-zinc-400">{review.correction}</p>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </div>

                      <Card className="border-zinc-800 bg-zinc-950/80">
                        <CardHeader>
                          <CardTitle className="text-base">Siguientes acciones y aprendizaje</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-2 md:grid-cols-3">
                            {activeAgentRun.run.nextActions.map((action) => (
                              <div key={action} className="rounded-lg border border-zinc-800 bg-black p-3 text-sm leading-5 text-zinc-300">
                                {action}
                              </div>
                            ))}
                          </div>
                          <p className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm leading-6 text-emerald-100">
                            {activeAgentRun.run.learningUpdate}
                          </p>
                        </CardContent>
                      </Card>
                    </>
                  )}

                  <Card className="border-zinc-800 bg-zinc-950/80">
                    <CardHeader>
                      <CardTitle className="text-base">Corridas recientes</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(snapshot?.recentAgentRuns || []).length === 0 ? (
                        <div className="rounded-lg border border-dashed border-zinc-800 bg-black p-5 text-center text-sm text-zinc-500">
                          Todavia no hay corridas guardadas.
                        </div>
                      ) : (
                        snapshot?.recentAgentRuns.map((run) => (
                          <div key={run.id} className="rounded-lg border border-zinc-800 bg-black p-3">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="font-medium text-white">{run.businessName}</p>
                                <p className="mt-1 text-sm text-zinc-500">{run.stage} / {run.projectType}</p>
                              </div>
                              <Badge variant="outline" className={cn(statusTone(run.status), "shrink-0")}>
                                {run.status}
                              </Badge>
                            </div>
                            <p className="mt-3 text-sm leading-5 text-zinc-400">{run.mainAgent.reason}</p>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="agents" className="mt-0">
              <div className="grid gap-3 md:grid-cols-2">
                {(snapshot?.agents || []).map((agent) => (
                  <Card key={agent.id} className="border-zinc-800 bg-zinc-950/80">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{agent.name}</p>
                          <p className="mt-1 text-sm text-zinc-500">{agent.role}</p>
                        </div>
                        <Badge variant="outline" className={cn(statusTone(agent.status), "shrink-0")}>
                          {agent.status}
                        </Badge>
                      </div>
                      <div className="mt-4 rounded-lg border border-white/10 bg-black p-3 text-sm text-zinc-400">
                        {agent.approvalGate}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
