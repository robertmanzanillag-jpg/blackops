import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCopyableTrustedDeliverRequest } from "../client/src/lib/revenue-engine-delivery-requests";

test("Telegram routes developer bug requests before generic work routing", () => {
  const source = readFileSync("server/telegram-chat.ts", "utf8");
  const autopilotIndex = source.indexOf('createDeveloperAutopilotHandoff(userId, message, "telegram")');
  const genericIndex = source.indexOf("const actionIds = routeTelegramWorkRequest(message)");

  assert.ok(autopilotIndex > 0, "Telegram should call Developer Autopilot");
  assert.ok(genericIndex > 0, "Telegram should keep generic work routing");
  assert.ok(autopilotIndex < genericIndex, "Developer Autopilot should run before generic routing");
});

test("Web assistant routes developer bug requests before the model fallback", () => {
  const source = readFileSync("server/assistant.ts", "utf8");
  const autopilotIndex = source.indexOf('createDeveloperAutopilotHandoff(userId, message, "web_chat")');
  const modelFallbackIndex = source.indexOf("const openAiMessages: ChatCompletionMessageParam[]");

  assert.ok(autopilotIndex > 0, "Web assistant should call Developer Autopilot");
  assert.ok(modelFallbackIndex > 0, "Web assistant should still have model fallback");
  assert.ok(autopilotIndex < modelFallbackIndex, "Developer Autopilot should run before model fallback");
});

test("Developer Autopilot routes are exposed near App QA gates", () => {
  const source = readFileSync("server/routes.ts", "utf8");

  assert.match(source, /\/api\/developer-autopilot\/handoff/);
  assert.match(source, /result\.status === "codex_dispatched"/);
  assert.match(source, /result\.status === "subscription_brief"/);
  assert.match(source, /\/api\/developer-autopilot\/qa-gate/);
  assert.match(source, /runAppQaScan\(userId, Boolean\(req\.body\?\.notify\), true, false\)/);
  assert.match(source, /const prUrl = typeof req\.body\?\.prUrl === "string"/);
  assert.match(source, /evaluateDeveloperReleaseGate\(scan, \{ prUrl, prHeadSha: packet\?\.headSha, prDiffSha256: packet\?\.diffSha256, claudeReview \}\)/);
});

test("Revenue Engine exposes GitHub handoff route for sold website workspaces", () => {
  const routeSource = readFileSync("server/routes.ts", "utf8");
  const uiSource = readFileSync("client/src/pages/revenue-engine.tsx", "utf8");
  const engineSource = readFileSync("server/revenue-engine.ts", "utf8");
  const deliveryRequestSource = readFileSync("client/src/lib/revenue-engine-delivery-requests.ts", "utf8");
  const mutationStart = uiSource.indexOf("const deliveryWorkspaceGithubHandoffMutation");
  const mutationEnd = uiSource.indexOf("const deliveryWorkspaceDeliverMutation");
  const handoffMutation = uiSource.slice(mutationStart, mutationEnd);
  const deliverMutationStart = uiSource.indexOf("const deliveryWorkspaceDeliverMutation");
  const deliverMutationEnd = uiSource.indexOf("const deliveryWorkspaceImprovementMutation");
  const deliverMutation = uiSource.slice(deliverMutationStart, deliverMutationEnd);
  const websiteOpportunityCloseStart = uiSource.indexOf("const websiteOpportunityCloseMutation");
  const websiteOpportunityCloseEnd = uiSource.indexOf("const automationOpportunityCloseMutation");
  const websiteOpportunityCloseMutation = uiSource.slice(websiteOpportunityCloseStart, websiteOpportunityCloseEnd);
  const githubHandoffRouteStart = routeSource.indexOf('app.post("/api/revenue-engine/delivery-workspaces/github-handoff"');
  const githubHandoffRouteEnd = routeSource.indexOf('app.post("/api/revenue-engine/delivery-workspaces/pr-status"');
  const githubHandoffRoute = routeSource.slice(githubHandoffRouteStart, githubHandoffRouteEnd);
  const appQaGateRouteStart = routeSource.indexOf('app.post("/api/revenue-engine/delivery-workspaces/app-qa-gate"');
  const appQaGateRouteEnd = routeSource.indexOf('app.post("/api/revenue-engine/delivery-workspaces/release-gate"');
  const appQaGateRoute = routeSource.slice(appQaGateRouteStart, appQaGateRouteEnd);

  assert.match(engineSource, /RevenueWebsiteOpportunity/);
  assert.match(engineSource, /recordRevenueWebsiteOpportunity/);
  assert.match(engineSource, /closeRevenueWebsiteOpportunity/);
  assert.match(engineSource, /buildRevenueWebsiteBuildHandoffQueue/);
  assert.match(engineSource, /websiteBuildHandoffQueue/);
  assert.match(engineSource, /Top build handoff/);
  assert.match(engineSource, /copyableBuildPack/);
  assert.match(engineSource, /Implementation rules/);
  assert.match(engineSource, /Do not deploy, publish previews, send forms\/messages/);
  assert.match(engineSource, /status === "sold"/);
  assert.match(engineSource, /depositPaid/);
  assert.match(engineSource, /scopeApproved/);
  assert.match(routeSource, /\/api\/revenue-engine\/website-opportunities/);
  assert.match(routeSource, /\/api\/revenue-engine\/website-opportunities\/close/);
  assert.match(routeSource, /\/api\/revenue-engine\/mockup-previews\/:slug/);
  assert.match(routeSource, /getRevenueMockupPreviewPath\(String\(req\.params\.slug \|\| ""\)\)/);
  assert.match(routeSource, /res\.type\("html"\)\.send\(html\)/);
  assert.match(routeSource, /revenueWebsiteOpportunitySchema\.parse/);
  assert.match(routeSource, /revenueWebsiteOpportunityCloseSchema\.parse/);
  assert.match(routeSource, /\/api\/revenue-engine\/delivery-workspaces\/github-handoff/);
  assert.match(routeSource, /\/api\/revenue-engine\/delivery-workspaces\/pr-status/);
  assert.match(routeSource, /\/api\/revenue-engine\/delivery-workspaces\/app-qa-gate/);
  assert.match(routeSource, /parseGitHubPullRequestUrl\(prUrl\)/);
  assert.match(routeSource, /getGitHubPullRequestReleaseStatus\(\{/);
  assert.match(routeSource, /Robert deployment approval sigue siendo manual/);
  assert.match(routeSource, /const appQaTargetContext = \{/);
  assert.match(routeSource, /kind: "revenue_delivery_workspace" as const/);
  assert.match(routeSource, /workspaceId: workspace\.id/);
  assert.match(routeSource, /clientName: workspace\.input\.clientName/);
  assert.match(routeSource, /repoFullName: parsedPr\.repoFullName/);
  assert.match(routeSource, /prHeadSha: prStatus\.pr\.headSha/);
  assert.match(routeSource, /expectedControls: \["Run App QA", "Registrar release gate", "Entregar aprobado"\]/);
  assert.match(routeSource, /runAppQaScan\(userId, input\.notify, true, false, appQaTargetContext\)/);
  assert.match(routeSource, /requiredTargetContext: appQaTargetContext/);
  assert.match(routeSource, /persistsReleaseGate: false/);
  assert.match(routeSource, /approvesDeployment: false/);
  assert.match(routeSource, /appQaEvidenceUrl: gate\.status === "pass" \? prStatus\.appQaEvidenceUrl \|\| "" : ""/);
  assert.match(routeSource, /App QA passed for \$\{prStatus\.pr\.headSha\}/);
  assert.match(appQaGateRoute, /runAppQaScan\(userId, input\.notify, true, false, appQaTargetContext\)/);
  assert.match(appQaGateRoute, /requiredTargetContext: appQaTargetContext/);
  assert.match(appQaGateRoute, /App QA target: revenue_delivery_workspace/);
  assert.match(appQaGateRoute, /Client target: \$\{workspace\.input\.clientName\}/);
  assert.match(appQaGateRoute, /PR head target: \$\{prStatus\.pr\.headSha\}/);
  assert.match(appQaGateRoute, /appQaEvidenceUrl: gate\.status === "pass" \? prStatus\.appQaEvidenceUrl \|\| "" : ""/);
  assert.match(appQaGateRoute, /requiresWorkspaceTargetEvidence: true/);
  assert.match(appQaGateRoute, /requiresRobertApproval: true/);
  assert.doesNotMatch(appQaGateRoute, /recordRevenueDeliveryReleaseGate/);
  assert.doesNotMatch(appQaGateRoute, /deploymentApprovalStatus/);
  assert.doesNotMatch(appQaGateRoute, /paymentConfirmation/);
  assert.doesNotMatch(appQaGateRoute, /cashCollectedUsd/);
  assert.doesNotMatch(appQaGateRoute, /requiredDepositUsd/);
  assert.match(routeSource, /\/api\/revenue-engine\/delivery-workspaces\/release-gate/);
  assert.match(routeSource, /Release gate requiere PR URL y PR status check/);
  assert.match(routeSource, /recordRevenueDeliveryReleaseGate\(input, \{/);
  assert.match(routeSource, /verifiedPrStatusReady: true/);
  assert.match(routeSource, /verifiedPrHeadSha: prStatus\.pr\.headSha/);
  assert.match(routeSource, /\/api\/revenue-engine\/delivery-workspaces\/trusted-deliver/);
  assert.match(routeSource, /deliverRevenueDeliveryWorkspaceFromTrustedApproval\(input\)/);
  assert.match(routeSource, /input\.projectType !== "automation"/);
  assert.match(routeSource, /website-delivery-workspace/);
  assert.match(routeSource, /getCurrentUserId\(req\)/);
  assert.match(routeSource, /createDeveloperAutopilotHandoffFromRequest/);
  assert.match(routeSource, /getRevenueWebsiteWorkspaceSaleGate/);
  assert.match(routeSource, /isRevenueCodexBranchName/);
  assert.match(routeSource, /kind: "client_build"/);
  assert.match(routeSource, /repo_mismatch/);
  assert.match(githubHandoffRoute, /workspace\.input\.publicDataVerified/);
  assert.match(githubHandoffRoute, /workspace\.projectPlan\.decision\.status !== "ready_to_build"/);
  assert.match(githubHandoffRoute, /!isRevenueCodexBranchName\(branchName\)/);
  assert.match(githubHandoffRoute, /Branch codex\/\.\.\. requerido antes de crear GitHub handoff PR-first/);
  assert.match(githubHandoffRoute, /Verifica data publica/);
  assert.doesNotMatch(githubHandoffRoute, /sanitizedBuildBrief/);
  assert.doesNotMatch(githubHandoffRoute, /Sanitized build context/);
  assert.doesNotMatch(githubHandoffRoute, /workspace\.input\.clientRequest/);
  assert.match(githubHandoffRoute, /workspace\.codexBuildHandoff\.copyableGithubIssueBody/);
  assert.match(githubHandoffRoute, /workspace\.codexBuildHandoff\.githubIssueTitle/);
  assert.doesNotMatch(githubHandoffRoute, /workspace\.input\.packageName/);
  assert.doesNotMatch(githubHandoffRoute, /workspace\.input\.setupUsd/);
  assert.doesNotMatch(githubHandoffRoute, /workspace\.input\.requiredDepositUsd/);
  assert.doesNotMatch(githubHandoffRoute, /workspace\.input\.paymentConfirmation/);
  assert.match(routeSource, /githubIssueUrl: ""/);
  assert.match(routeSource, /prUrl: ""/);
  assert.match(routeSource, /secondReviewStatus: "pending"/);
  assert.match(routeSource, /approvedByRobert: false/);
  assert.match(githubHandoffRoute, /updateRevenueDeliveryWorkspaceQa\(\{/);
  assert.doesNotMatch(githubHandoffRoute, /workspace\.codexBuildHandoff\.codexBrief/);
  assert.match(uiSource, /button-create-github-handoff/);
  assert.match(uiSource, /panel-github-handoff-next-action/);
  assert.match(uiSource, /button-copy-github-handoff-next-action/);
  assert.match(uiSource, /developerHandoff\?\.message/);
  assert.match(uiSource, /workspace\.codexBuildHandoff\.publicBuildBrief/);
  assert.match(uiSource, /workspace\.codexBuildHandoff\.copyableGithubIssueBody/);
  assert.match(uiSource, /button-copy-codex-issue-body/);
  assert.match(uiSource, /workspace\?\.codexBuildHandoff\.publicBuildBrief/);
  assert.doesNotMatch(uiSource, /workspace\.codexBuildHandoff\.publicBuildBrief \|\| workspace\.codexBuildHandoff\.codexBrief/);
  assert.match(uiSource, /item\.publicBuildBrief/);
  assert.doesNotMatch(uiSource, /item\.publicBuildBrief \|\| item\.codexBrief/);
  assert.match(uiSource, /Copy public brief/);
  assert.match(uiSource, /Copy issue body/);
  assert.match(uiSource, /workspace\.input\.publicDataVerified/);
  assert.match(uiSource, /const buildHandoffBranchReady = !workspace\.codexBuildHandoff\.missing\.includes\("branch codex\/\.\.\. para PR-first"\)/);
  assert.match(uiSource, /\|\| !buildHandoffBranchReady/);
  assert.match(uiSource, /workspace\.projectPlan\.decision\.status !== "ready_to_build"/);
  assert.match(uiSource, /reviewProjectType !== "automation"/);
  assert.match(uiSource, /Usar website handoff/);
  assert.match(uiSource, /deliveryWorkspaceReleaseGateMutation/);
  assert.match(uiSource, /deliveryWorkspacePrStatusMutation/);
  assert.match(uiSource, /\/api\/revenue-engine\/delivery-workspaces\/pr-status/);
  assert.match(uiSource, /\/api\/revenue-engine\/delivery-workspaces\/app-qa-gate/);
  assert.match(uiSource, /button-check-pr-status-/);
  assert.match(uiSource, /button-run-workspace-app-qa-/);
  assert.match(uiSource, /button-copy-app-qa-pr-comment-/);
  assert.match(uiSource, /data\.status === "pass" && data\.appQaEvidenceUrl/);
  assert.match(uiSource, /panel-pr-status/);
  assert.match(uiSource, /panel-workspace-app-qa-gate/);
  assert.match(uiSource, /button-record-release-gate-/);
  assert.match(uiSource, /releaseGateInputsByWorkspace/);
  assert.match(uiSource, /panel-release-gate-inputs-/);
  assert.match(uiSource, /input-release-pr-url-\$\{workspace\.id\}/);
  assert.match(uiSource, /input-release-second-review-url-\$\{workspace\.id\}/);
  assert.match(uiSource, /input-release-app-qa-url-\$\{workspace\.id\}/);
  assert.match(uiSource, /releaseGateInput\.robertApprovedDeploy/);
  assert.doesNotMatch(uiSource, /const \[releasePrUrl, setReleasePrUrl\]/);
  assert.match(uiSource, /\/api\/revenue-engine\/delivery-workspaces\/trusted-deliver/);
  assert.match(uiSource, /buildCopyableTrustedDeliverRequest/);
  assert.match(uiSource, /isTrustedDeliveryRequestReady/);
  assert.match(uiSource, /button-copy-trusted-deliver-request-/);
  assert.match(uiSource, /const trustedDeliveryReady = isTrustedDeliveryRequestReady\(workspace\)/);
  assert.match(uiSource, /deliveryWorkspaceDeliverMutation\.mutate\(workspace\)/);
  assert.match(deliverMutation, /body: buildCopyableTrustedDeliverRequest\(workspace\)/);
  assert.doesNotMatch(deliverMutation, /approvedByRobert: true/);
  assert.match(deliveryRequestSource, /approvedByRobert: readyForTrustedDelivery/);
  assert.match(deliveryRequestSource, /isTrustedDeliveryRequestReady/);
  assert.match(deliveryRequestSource, /workspace\.input\.projectType === "website" \|\| workspace\.input\.projectType === "bundle"/);
  assert.match(deliveryRequestSource, /workspace\.input\.releaseGateHeadSha/);
  assert.match(deliveryRequestSource, /workspace\.approvalSummary\.requiredBeforeClient\.length === 0/);
  assert.match(uiSource, /workspace\.status !== "ready_to_deliver"/);
  assert.match(uiSource, /panel-delivery-blocked-reason-/);
  assert.match(uiSource, /deliveryWorkspaceGithubHandoffMutation/);
  assert.match(uiSource, /button-copy-website-build-pack-/);
  assert.match(uiSource, /button-copy-codex-build-pack-/);
  assert.match(uiSource, /buildPack\.copyableBuildPack/);
  assert.match(uiSource, /clientHandoffReady: reviewChecks\.clientHandoffReady/);
  assert.doesNotMatch(uiSource, /clientHandoffReady: reviewChecks\.rollbackPlanReady/);
  assert.doesNotMatch(uiSource, /clientHandoffReady: deliveryReviewMutation\.data\?\.requiredFixes\.length === 0 && reviewChecks\.depositPaid/);
  assert.match(uiSource, /"clientHandoffReady", "Handoff cliente listo"/);
  assert.match(uiSource, /recentWebsiteOpportunities/);
  assert.match(uiSource, /websiteOpportunityMutation/);
  assert.match(uiSource, /websiteOpportunityCloseMutation/);
  assert.match(uiSource, /panel-website-build-handoff-queue/);
  assert.match(uiSource, /button-copy-website-build-brief-/);
  assert.match(uiSource, /button-copy-website-github-handoff-request-/);
  assert.match(uiSource, /button-copy-website-release-gate-request-/);
  assert.match(uiSource, /button-copy-github-handoff-request-/);
  assert.match(uiSource, /button-copy-release-gate-request-/);
  assert.match(uiSource, /button-copy-website-workspace-setup-/);
  assert.match(uiSource, /button-copy-website-workspace-request-/);
  assert.match(uiSource, /copyableGithubHandoffRequest/);
  assert.match(uiSource, /copyableReleaseGateRequest/);
  assert.match(uiSource, /buildCopyableReleaseGateRequest/);
  assert.match(uiSource, /copyableWorkspaceSetupPacket/);
  assert.match(uiSource, /copyableWorkspaceRequest/);
  assert.match(uiSource, /item\.suggestedBranchName/);
  assert.match(uiSource, /repoInput\.branchName \|\| item\.suggestedBranchName/);
  assert.match(engineSource, /repoFullNamePattern/);
  assert.match(engineSource, /Website delivery workspace setup/);
  assert.match(uiSource, /button-copy-manual-outreach-packet-/);
  assert.match(uiSource, /button-copy-manual-close-evidence-/);
  assert.match(uiSource, /button-copy-manual-outreach-contacted-request-/);
  assert.match(uiSource, /button-copy-manual-outreach-deposit-request-/);
  assert.match(uiSource, /copyableContactPacket/);
  assert.match(uiSource, /copyableCloseEvidencePacket/);
  assert.match(uiSource, /copyableOutcomeRequests/);
  assert.match(engineSource, /paymentEvidenceRequired/);
  assert.match(engineSource, /Manual close evidence packet/);
  assert.match(engineSource, /buildRevenueManualOutcomeRequests/);
  assert.match(uiSource, /button-create-website-opportunity-/);
  assert.match(uiSource, /panel-website-close-plan-/);
  assert.match(uiSource, /button-copy-website-close-plan-/);
  assert.match(uiSource, /button-copy-website-opportunity-request-/);
  assert.match(uiSource, /button-copy-website-close-request-/);
  assert.match(uiSource, /button-copy-website-closure-request-/);
  assert.match(uiSource, /copyableOpportunityRequest/);
  assert.match(uiSource, /copyableCloseRequest/);
  assert.match(uiSource, /closePlan\.copyableClosePacket/);
  assert.match(uiSource, /closePlan\.copyableCloseRequest/);
  assert.match(uiSource, /closePlan\.paymentEvidenceRequired/);
  assert.match(uiSource, /disabled=\{item\.draftStatus !== "approved"\}/);
  assert.match(uiSource, /button-approve-website-sales-draft-/);
  assert.match(uiSource, /item\.draftStatus !== "approved"/);
  assert.match(uiSource, /checkbox-website-opportunity-scope-/);
  assert.match(uiSource, /const \[websiteOpportunityScopeApprovals, setWebsiteOpportunityScopeApprovals\] = useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(uiSource, /Boolean\(websiteOpportunityScopeApprovals\[opportunity\.id\]\)/);
  assert.match(uiSource, /\[opportunity\.id\]: !scopeApprovedForClose/);
  assert.match(uiSource, /scopeApproved: scopeApprovedForClose/);
  assert.match(uiSource, /websiteOpportunityCloseInputs/);
  assert.match(uiSource, /input-website-opportunity-cash-/);
  assert.match(uiSource, /input-website-opportunity-payment-/);
  assert.match(uiSource, /input-website-opportunity-close-notes-/);
  assert.match(uiSource, /function hasVerifiablePaymentEvidence/);
  assert.match(uiSource, /genericPaymentEvidence/);
  assert.match(uiSource, /return hasVerifiablePaymentEvidence\(value\) \? value : null/);
  assert.match(uiSource, /const automationHasPaymentConfirmation = hasVerifiablePaymentEvidence\(automationPaymentConfirmation\)/);
  assert.match(uiSource, /const automationAgentPaymentBlocked = automationCloseRequiresPaymentEvidence && !automationHasPaymentConfirmation/);
  assert.match(uiSource, /const automationOpportunityRequiresPaymentEvidence = automationDepositPaid \|\| \["sold", "in_delivery", "delivered"\]\.includes\(automationOpportunityStatus\)/);
  assert.match(uiSource, /const automationOpportunityPaymentBlocked = automationOpportunityRequiresPaymentEvidence && !automationHasPaymentConfirmation/);
  assert.match(uiSource, /disabled=\{automationAgentCommandMutation\.isPending \|\| automationAgentPaymentBlocked\}/);
  assert.match(uiSource, /disabled=\{automationOpportunityMutation\.isPending \|\| automationOpportunityPaymentBlocked\}/);
  assert.match(uiSource, /const closeHasPaymentConfirmation = hasVerifiablePaymentEvidence\(closePaymentConfirmation\)/);
  assert.match(uiSource, /Falta referencia verificable/);
  assert.match(websiteOpportunityCloseMutation, /\/api\/revenue-engine\/outreach-outcome/);
  assert.match(websiteOpportunityCloseMutation, /outcome: "deposit_collected"/);
  assert.match(websiteOpportunityCloseMutation, /outcomeRecordedByRobert: true/);
  assert.match(websiteOpportunityCloseMutation, /outcomeData\.status === "blocked"/);
  assert.match(uiSource, /button-close-website-opportunity-/);
  assert.doesNotMatch(uiSource, /const closeHasPaymentConfirmation = closePaymentConfirmation\.trim\(\)\.length >= 4/);
  assert.doesNotMatch(websiteOpportunityCloseMutation, /reviewChecks\.clientApprovedScope/);
  assert.match(uiSource, /const shouldRecordDepositOutcome = closeDepositCoversRequired &&/);
  assert.match(uiSource, /\|\| !closeDepositCoversRequired/);
  assert.match(uiSource, /depositPaid: item\.cashCollectedUsd >= item\.requiredDepositUsd/);
  assert.match(uiSource, /scopeApproved: true/);
  assert.match(engineSource, /repoFullName: z\.string\(\)\.trim\(\)\.regex/);
  assert.match(engineSource, /repoFullName: parsed\.repoFullName \|\| ""/);
  assert.match(uiSource, /const \[websiteDeliveryRepoInputs, setWebsiteDeliveryRepoInputs\] = useState<Record<string, \{/);
  assert.match(uiSource, /input-website-handoff-repo-/);
  assert.match(uiSource, /input-website-handoff-branch-/);
  assert.match(uiSource, /function isGithubRepoFullName/);
  assert.match(uiSource, /function isCodexBranchName/);
  assert.match(uiSource, /function buildCopyableGithubHandoffRequest/);
  assert.match(uiSource, /const branchReady = isCodexBranchName\(branchName\)/);
  assert.match(uiSource, /!repoReady \|\| !branchReady/);
  assert.match(uiSource, /Branch codex requerido/);
  assert.match(engineSource, /function isRevenueCodexBranchName/);
  assert.match(engineSource, /branchName must start with codex\//);
  assert.match(engineSource, /Branch codex\/\.\.\. requerido antes de crear delivery workspace PR-first/);
  assert.match(engineSource, /branch codex\/\.\.\. para PR-first/);
  assert.match(engineSource, /markScopeApproved: z\.boolean\(\)\.default\(false\)/);
  assert.match(engineSource, /falta aprobacion escrita de scope/);
  assert.match(uiSource, /repoFullName,/);
  assert.match(uiSource, /branchName,/);
  assert.match(uiSource, /disabled=\{websiteDeliveryHandoffMutation\.isPending \|\| !depositCoversHandoff \|\| !repoReady \|\| !branchReady\}/);
  assert.match(handoffMutation, /repoFullName: workspace\.input\.repoFullName/);
  assert.doesNotMatch(handoffMutation, /repoFullName: reviewRepoFullName \|\| workspace\.input\.repoFullName/);
});

test("Revenue Engine trusted delivery copy request stays website release-gated", () => {
  const baseWorkspace = {
    id: "delivery-workspace-test",
    status: "ready_to_deliver",
    input: {
      projectType: "website",
      prUrl: "https://github.com/robert/site/pull/1",
      secondReviewStatus: "pass",
      secondReviewEvidenceUrl: "https://github.com/robert/site/pull/1#pullrequestreview-1",
      appQaStatus: "pass",
      appQaEvidenceUrl: "https://github.com/robert/site/pull/1#issuecomment-app-qa",
      deploymentApprovalStatus: "approved",
      deploymentApprovalUrl: "https://github.com/robert/site/pull/1#issuecomment-approval",
      releaseGateHeadSha: "abc1234",
    },
    approvalSummary: {
      canLaunch: true,
      requiredBeforeClient: [],
    },
    codexBuildHandoff: {
      missing: [],
    },
  };

  const websiteRequest = JSON.parse(buildCopyableTrustedDeliverRequest(baseWorkspace));
  assert.equal(websiteRequest.approvedByRobert, true);

  const automationRequest = JSON.parse(buildCopyableTrustedDeliverRequest({
    ...baseWorkspace,
    id: "delivery-workspace-automation",
    input: {
      ...baseWorkspace.input,
      projectType: "automation",
      prUrl: "",
      secondReviewStatus: "pending",
      secondReviewEvidenceUrl: "",
      appQaStatus: "pending",
      appQaEvidenceUrl: "",
      deploymentApprovalStatus: "not_requested",
      deploymentApprovalUrl: "",
      releaseGateHeadSha: "",
    },
  }));
  assert.equal(automationRequest.approvedByRobert, false);

  const websiteMissingReleaseRequest = JSON.parse(buildCopyableTrustedDeliverRequest({
    ...baseWorkspace,
    id: "delivery-workspace-missing-release",
    input: {
      ...baseWorkspace.input,
      releaseGateHeadSha: "",
    },
  }));
  assert.equal(websiteMissingReleaseRequest.approvedByRobert, false);
});

test("Revenue Engine exposes the daily money command panel", () => {
  const routeSource = readFileSync("server/routes.ts", "utf8");
  const uiSource = readFileSync("client/src/pages/revenue-engine.tsx", "utf8");
  const serverSource = readFileSync("server/revenue-engine.ts", "utf8");
  const scoutDispatchStart = uiSource.indexOf("const scoutDispatchMutation");
  const scoutDispatchEnd = uiSource.indexOf("const leadRadarMutation");
  const scoutDispatchMutation = uiSource.slice(scoutDispatchStart, scoutDispatchEnd);
  const safeRunStart = uiSource.indexOf("const DAILY_MONEY_SAFE_RUN_ENDPOINTS");
  const safeRunEnd = uiSource.indexOf("function parseDailyMoneyRunRequest");
  const safeRunEndpoints = uiSource.slice(safeRunStart, safeRunEnd);

  assert.match(serverSource, /buildRevenueDailyMoneyCommand/);
  assert.match(serverSource, /dailyMoneyCommand/);
  assert.match(serverSource, /copyableApiRequest/);
  assert.match(uiSource, /DAILY_MONEY_SAFE_RUN_ENDPOINTS/);
  assert.match(safeRunEndpoints, /\/api\/revenue-engine\/scout-dispatch/);
  assert.match(safeRunEndpoints, /\/api\/revenue-engine\/money-sprint\/public-candidates/);
  assert.match(safeRunEndpoints, /\/api\/revenue-engine\/website-opportunities/);
  assert.match(safeRunEndpoints, /\/api\/revenue-engine\/website-delivery-workspace/);
  assert.match(safeRunEndpoints, /\/api\/revenue-engine\/delivery-workspaces\/github-handoff/);
  assert.match(uiSource, /hasDailyMoneyRunPlaceholders/);
  assert.match(uiSource, /REPLACE_/);
  assert.match(uiSource, /"owner\\\/repo"/);
  assert.match(uiSource, /codex\\\/client-website-build/);
  assert.match(uiSource, /dailyMoneyRunMutation/);
  assert.match(uiSource, /button-copy-daily-money-command/);
  assert.match(uiSource, /button-copy-daily-run-api-request/);
  assert.match(uiSource, /button-run-daily-money-safe-action/);
  assert.match(uiSource, /text-daily-money-safe-action-gate/);
  assert.match(uiSource, /panel-daily-money-safe-action-result/);
  assert.match(uiSource, /dailyMoneyRunIsSafeEndpoint/);
  assert.match(uiSource, /canRunDailyMoneyNextAction/);
  assert.doesNotMatch(safeRunEndpoints, /\/api\/revenue-engine\/outreach-outcome/);
  assert.doesNotMatch(safeRunEndpoints, /\/api\/revenue-engine\/website-opportunities\/close/);
  assert.doesNotMatch(safeRunEndpoints, /\/api\/revenue-engine\/outreach-drafts\/approve/);
  assert.match(routeSource, /\/api\/revenue-engine\/daily-scout-sprint/);
  assert.match(routeSource, /\/api\/revenue-engine\/scout-dispatch/);
  assert.match(routeSource, /revenueDailyScoutSprintSchema\.parse/);
  assert.match(routeSource, /runRevenueScoutDispatch\(input\)/);
  assert.match(serverSource, /runRevenueScoutDispatch/);
  assert.match(serverSource, /manual_subagent_dispatch/);
  assert.match(serverSource, /connectorIntake/);
  assert.match(serverSource, /workOrders: connectorWorkOrders/);
  assert.match(serverSource, /copyableWorkOrders/);
  assert.match(serverSource, /copyableSubagentCommands/);
  assert.match(serverSource, /Revenue Engine public business scout subagent command/);
  assert.match(serverSource, /approvalLocked: true/);
  assert.match(serverSource, /dispatchSummary/);
  assert.match(serverSource, /searchPlaybook/);
  assert.match(serverSource, /public business search playbook/);
  assert.match(serverSource, /\/api\/revenue-engine\/public-scout-connector-intake/);
  assert.match(uiSource, /dailyScoutSprintMutation/);
  assert.match(uiSource, /scoutDispatchMutation/);
  assert.match(uiSource, /const dispatchScoutArea = snapshot\?\.businessScoutQueue\.area \|\| scoutingArea/);
  assert.match(scoutDispatchMutation, /area: dispatchScoutArea/);
  assert.match(scoutDispatchMutation, /niche: dispatchScoutNiche/);
  assert.match(scoutDispatchMutation, /offerFocus: dispatchScoutOfferFocus/);
  assert.match(scoutDispatchMutation, /targetLeadCount: dispatchScoutTarget/);
  assert.doesNotMatch(scoutDispatchMutation, /area: activeScoutArea/);
  assert.match(uiSource, /button-start-daily-scout-sprint/);
  assert.match(uiSource, /button-dispatch-scout-agents/);
  assert.match(uiSource, /panel-scout-dispatch/);
  assert.match(uiSource, /button-copy-scout-dispatch/);
  assert.match(uiSource, /button-copy-scout-dispatch-agents/);
  assert.match(uiSource, /panel-scout-connector-intake-contract/);
  assert.match(uiSource, /button-copy-scout-connector-intake/);
  assert.match(uiSource, /button-copy-scout-connector-work-orders/);
  assert.match(uiSource, /button-copy-scout-subagent-commands/);
  assert.match(uiSource, /connectorIntake\.copyableWorkOrders/);
  assert.match(uiSource, /connectorIntake\.copyableSubagentCommands/);
  assert.match(uiSource, /panel-business-search-playbook/);
  assert.match(uiSource, /button-copy-business-search-playbook/);
  assert.match(uiSource, /businessScoutQueue\.workPack\.searchPlaybook\.prioritizedSources/);
  assert.match(uiSource, /businessScoutQueue\.workPack\.searchPlaybook\.opportunitySignals/);
  assert.match(uiSource, /latestDailyScoutSprint\.dispatchSummary/);
  assert.match(uiSource, /panel-latest-daily-scout-sprint/);
  assert.match(uiSource, /const activeScoutArea = snapshot\?\.latestDailyScoutSprint\?\.area \|\| snapshot\?\.businessScoutQueue\.area \|\| scoutingArea/);
  assert.match(uiSource, /const activeScoutNiche = snapshot\?\.latestDailyScoutSprint\?\.niche \|\| snapshot\?\.businessScoutQueue\.niche \|\| scoutingNiche/);
  assert.match(uiSource, /targetLeadCount: dispatchScoutTarget/);
  assert.match(uiSource, /const \[selectedDailyScoutTaskId, setSelectedDailyScoutTaskId\] = useState\(""\)/);
  assert.match(uiSource, /const selectedDailyScoutTask = snapshot\?\.latestDailyScoutSprint\?\.tasks\.find\(\(task\) => task\.taskId === selectedDailyScoutTaskId\)/);
  assert.match(uiSource, /const selectedDailyScoutTaskHasOpenSlots = Boolean\(selectedDailyScoutTask\?\.resultSlots\.some/);
  assert.match(uiSource, /const firstOpenDailyScoutTask = snapshot\?\.latestDailyScoutSprint\?\.tasks\.find/);
  assert.match(uiSource, /const activeScoutTask = selectedDailyScoutTaskHasOpenSlots/);
  assert.match(uiSource, /sourceTaskId: activeScoutSourceTaskId/);
  assert.match(uiSource, /button-load-daily-scout-slots/);
  assert.match(uiSource, /snapshot\.latestDailyScoutSprint\.tasks\.map/);
  assert.match(uiSource, /const openSlotText = task\.resultSlots/);
  assert.match(uiSource, /setSelectedDailyScoutTaskId\(task\.taskId\)/);
  assert.match(uiSource, /setSelectedDailyScoutTaskId\(activeScoutSourceTaskId\)/);
  assert.match(uiSource, /setPublicScoutEvidenceText\(openSlotText\)/);
  assert.match(uiSource, /<Button\s+asChild/);
  assert.match(uiSource, /link-open-daily-scout-task-/);
  assert.match(uiSource, /button-load-daily-scout-task-slots-/);
  assert.match(uiSource, /dailyMoneyCommand\.primaryAction/);
  assert.match(uiSource, /dailyMoneyCommand\.funnel\.salesPacketsReady/);
  assert.match(serverSource, /Revenue Engine next run packet/);
  assert.match(serverSource, /\/api\/revenue-engine\/scout-dispatch/);
  assert.match(serverSource, /\/api\/revenue-engine\/website-opportunities\/close/);
  assert.match(serverSource, /\/api\/revenue-engine\/delivery-workspaces\/github-handoff/);
  assert.match(serverSource, /leadId, outreachDraftId, websiteOpportunityId/);
  assert.match(serverSource, /concept, amountUsd=0, estimatedInternalCostUsd=0/);
  assert.match(uiSource, /panel-daily-run-packet/);
  assert.match(uiSource, /button-copy-daily-run-packet/);
  assert.match(uiSource, /dailyMoneyCommand\.runPacket\.copyableRunPacket/);
  assert.match(uiSource, /const readyCandidateCount = snapshot\?\.publicLeadImportQueue\.readyCount \|\| 0/);
  assert.match(uiSource, /candidateIds: visibleCandidateIdsCoverReadyQueue \? candidateIds : \[\]/);
  assert.match(uiSource, /statusTone\(snapshot\?\.launchReadiness\.todayExecutionPack\?\.status \|\| "review"\)/);
  assert.doesNotMatch(uiSource, /statusTone\("pass"\), "shrink-0"\}>\s*\{snapshot\?\.launchReadiness\.todayExecutionPack\?\.ownerAgent/);
});

test("Revenue Engine exposes money activation plan for first revenue sprint", () => {
  const uiSource = readFileSync("client/src/pages/revenue-engine.tsx", "utf8");
  const serverSource = readFileSync("server/revenue-engine.ts", "utf8");

  assert.match(serverSource, /buildRevenueMoneyActivationPlan/);
  assert.match(serverSource, /ready_for_first_sprint/);
  assert.match(serverSource, /ready_for_money_mode/);
  assert.match(serverSource, /missingBeforeRealMoney/);
  assert.match(serverSource, /blockedUntilApproved/);
  assert.match(serverSource, /evidenceGate/);
  assert.match(serverSource, /run Money Sprint from placeholders/);
  assert.match(serverSource, /productionLaunchChecklist/);
  assert.match(serverSource, /Revenue Engine production launch checklist/);
  assert.match(serverSource, /productionSetupPacket/);
  assert.match(serverSource, /Revenue Engine production setup packet/);
  assert.match(serverSource, /hasStrongSecret\(process\.env\.SESSION_SECRET\)/);
  assert.match(serverSource, /firstSprintPlan/);
  assert.match(serverSource, /\/api\/revenue-engine\/daily-scout-sprint/);
  assert.match(serverSource, /approve_contact_or_collect/);
  assert.match(serverSource, /Can collect money/);
  assert.match(uiSource, /Activacion de dinero/);
  assert.match(uiSource, /Primer sprint/);
  assert.match(uiSource, /moneyActivationPlan\.canStartToday/);
  assert.match(uiSource, /moneyActivationPlan\.canContactBusinesses/);
  assert.match(uiSource, /moneyActivationPlan\.canCollectMoney/);
  assert.match(uiSource, /moneyActivationPlan\.canBuildWebsites/);
  assert.match(uiSource, /moneyActivationPlan\.missingBeforeRealMoney/);
  assert.match(uiSource, /moneyActivationPlan\.blockedUntilApproved/);
  assert.match(uiSource, /Gate de evidencia/);
  assert.match(uiSource, /moneyActivationPlan\.evidenceGate\.readyCandidates/);
  assert.match(uiSource, /moneyActivationPlan\.evidenceGate\.blockedCandidates/);
  assert.match(uiSource, /moneyActivationPlan\.evidenceGate\.requiredFields/);
  assert.match(uiSource, /panel-production-launch-checklist/);
  assert.match(uiSource, /button-copy-production-launch-checklist/);
  assert.match(uiSource, /moneyActivationPlan\.productionLaunchChecklist\.requiredEvidence/);
  assert.match(uiSource, /moneyActivationPlan\.productionLaunchChecklist\.deploymentApprovalPacket/);
  assert.match(uiSource, /panel-deployment-approval-packet/);
  assert.match(uiSource, /panel-production-setup-packet/);
  assert.match(uiSource, /button-copy-production-setup-packet/);
  assert.match(uiSource, /moneyActivationPlan\.productionLaunchChecklist\.productionSetupPacket\.copyableSetupPacket/);
  assert.match(uiSource, /moneyActivationPlan\.firstSprintPlan/);
  assert.doesNotMatch(uiSource, /moneyActivationPlan\.firstSprintPlan\.steps \|\| \[\]\)\.slice\(0, 3\)/);
  assert.match(uiSource, /moneyActivationPlan\.firstSprintPlan\.revenuePath/);
  assert.match(uiSource, /panel-revenue-path-to-paid-build/);
  assert.match(uiSource, /moneyActivationPlan\.firstSprintPlan\.copyableBrief/);
  assert.match(uiSource, /moneyActivationPlan\.firstSprintPlan\.copyableDispatchRequest/);
  assert.match(uiSource, /button-copy-first-sprint-brief/);
  assert.match(uiSource, /button-copy-first-sprint-dispatch-request/);
  assert.match(uiSource, /moneyActivationPlan\.copyableBrief/);
  assert.match(uiSource, /button-copy-money-activation-brief/);
});

test("Revenue Engine exposes public scout evidence intake", () => {
  const routeSource = readFileSync("server/routes.ts", "utf8");
  const uiSource = readFileSync("client/src/pages/revenue-engine.tsx", "utf8");
  const engineSource = readFileSync("server/revenue-engine.ts", "utf8");

  assert.match(engineSource, /recordRevenuePublicScoutEvidence/);
  assert.match(engineSource, /recordRevenueVerifiedScoutConnectorResults/);
  assert.match(engineSource, /submitRevenueDailyScoutSprintEvidence/);
  assert.match(engineSource, /approveRevenuePublicLeadCandidate/);
  assert.match(engineSource, /recordRevenueDailyScoutSprintEvidenceProgress/);
  assert.match(engineSource, /runRevenuePublicScoutAgentCommand/);
  assert.match(engineSource, /requireRobertApprovalToContact: z\.literal\(true\)/);
  assert.match(engineSource, /maxPaidDataSpendUsd: z\.coerce\.number\(\)\.min\(0\)\.max\(0\)/);
  assert.match(engineSource, /verificationStatus: "needs_review"/);
  assert.match(engineSource, /approvalLocked: true/);
  assert.match(engineSource, /sourceUrl must be public/);
  assert.match(routeSource, /\/api\/revenue-engine\/daily-scout-sprint\/submit/);
  assert.match(routeSource, /\/api\/revenue-engine\/public-lead-candidates\/approve/);
  assert.match(routeSource, /\/api\/revenue-engine\/public-scout-evidence/);
  assert.match(routeSource, /\/api\/revenue-engine\/public-scout-connector-intake/);
  assert.match(routeSource, /\/api\/revenue-engine\/public-scout-agent-command/);
  assert.match(routeSource, /revenueDailyScoutSprintSubmitSchema\.parse/);
  assert.match(routeSource, /revenuePublicLeadCandidateApproveSchema\.parse/);
  assert.match(routeSource, /revenuePublicScoutEvidenceSchema\.parse/);
  assert.match(routeSource, /revenueVerifiedScoutConnectorSchema\.parse/);
  assert.match(routeSource, /recordRevenueVerifiedScoutConnectorResults\(input\)/);
  assert.match(routeSource, /revenuePublicScoutAgentCommandSchema\.parse/);
  assert.match(uiSource, /publicScoutEvidenceMutation/);
  assert.match(uiSource, /publicScoutConnectorIntakeMutation/);
  assert.match(uiSource, /publicScoutAgentCommandMutation/);
  assert.match(uiSource, /candidateRobertApprovedImport/);
  assert.match(uiSource, /checkbox-public-scout-robert-approved-import/);
  assert.match(uiSource, /checkbox-candidate-robert-approved-import/);
  assert.match(uiSource, /approvedByRobert: candidateRobertApprovedImport/);
  assert.match(uiSource, /setCandidateRobertApprovedImport\(false\)/);
  assert.match(uiSource, /Robert approve import/);
  assert.doesNotMatch(uiSource, /approvedByRobert: candidatePublicEvidenceVerified && candidateApprovalToImport/);
  assert.match(uiSource, /buildPublicScoutConnectorIntakeRequest/);
  assert.match(uiSource, /textarea-public-scout-evidence/);
  assert.match(uiSource, /textarea-public-scout-connector-results/);
  assert.match(uiSource, /Connector payload or results JSON/);
  assert.match(uiSource, /button-normalize-public-scout-evidence/);
  assert.match(uiSource, /button-record-public-scout-connector-intake/);
  assert.match(uiSource, /button-copy-scout-connector-intake/);
  assert.match(uiSource, /connectorIntake\.copyablePayloadTemplate/);
  assert.match(uiSource, /Submitir slot del sprint/);
  assert.match(uiSource, /checkbox-public-scout-evidence-verified/);
  assert.match(uiSource, /checkbox-public-scout-approval-import/);
  assert.match(uiSource, /button-approve-public-candidate/);
  assert.match(uiSource, /approvedByRobert:\s*true/);
  assert.match(uiSource, /button-copy-public-candidate-repair/);
  assert.match(uiSource, /button-copy-public-candidate-approval-/);
  assert.match(uiSource, /button-copy-public-candidate-money-sprint-request/);
  assert.match(uiSource, /copyableApprovalRequest/);
  assert.match(uiSource, /copyableMoneySprintRequest/);
  assert.match(uiSource, /copyableRepairPacket/);
  assert.match(engineSource, /buildRevenuePublicCandidateApprovalRequest/);
  assert.match(engineSource, /buildRevenuePublicCandidateRepairPacket/);
  assert.match(uiSource, /button-run-public-scout-agent-command/);
  assert.match(uiSource, /const \[publicScoutEvidenceText, setPublicScoutEvidenceText\] = useState\(""\)/);
  assert.doesNotMatch(uiSource, /useState\(\[\s*"Business: No Site Cafe"/);
  const connectorMutationSource = uiSource.split("const publicScoutAgentCommandMutation")[0].split("const publicScoutConnectorIntakeMutation")[1] || "";
  assert.doesNotMatch(connectorMutationSource, /approvalToImport:\s*true/);
  assert.doesNotMatch(connectorMutationSource, /publicEvidenceVerified:\s*true/);
  assert.doesNotMatch(connectorMutationSource, /setSeedLeadBatchText/);
  assert.match(engineSource, /public_candidate_review_gate=needs_review/);
});

test("Revenue Engine exposes manual outreach outcome recording", () => {
  const routeSource = readFileSync("server/routes.ts", "utf8");
  const uiSource = readFileSync("client/src/pages/revenue-engine.tsx", "utf8");
  const engineSource = readFileSync("server/revenue-engine.ts", "utf8");

  assert.match(engineSource, /approveRevenueOutreachDraft/);
  assert.match(engineSource, /recordRevenueOutreachOutcome/);
  assert.match(engineSource, /draftStatus: draft\.status/);
  assert.match(routeSource, /\/api\/revenue-engine\/outreach-drafts\/approve/);
  assert.match(routeSource, /revenueOutreachApproveSchema\.parse/);
  assert.match(routeSource, /\/api\/revenue-engine\/outreach-outcome/);
  assert.match(routeSource, /revenueOutreachOutcomeSchema\.parse/);
  assert.match(uiSource, /outreachApproveMutation/);
  assert.match(uiSource, /button-approve-draft-/);
  assert.match(uiSource, /button-approve-website-sales-draft-/);
  assert.match(uiSource, /button-approve-manual-outreach-draft-/);
  assert.match(uiSource, /item\.draftStatus !== "approved"/);
  assert.match(uiSource, /outreachOutcomeMutation/);
  assert.match(uiSource, /button-record-outreach-reply/);
  assert.match(uiSource, /button-record-outreach-call/);
  assert.match(uiSource, /button-record-outreach-deposit/);
  assert.match(uiSource, /button-record-manual-outreach-contacted-/);
  assert.match(uiSource, /button-record-manual-outreach-reply-/);
  assert.match(uiSource, /button-record-manual-outreach-call-/);
  assert.match(uiSource, /button-record-manual-outreach-deposit-/);
  assert.match(uiSource, /draftId: item\.draftId/);
  assert.match(uiSource, /cashCollectedUsd: item\.depositUsd/);
  assert.match(uiSource, /button-record-manual-outreach-lost-/);
});

test("simplified Revenue Engine preserves approval, outcome, and advanced-console paths", () => {
  const appSource = readFileSync("client/src/App.tsx", "utf8");
  const uiSource = readFileSync("client/src/pages/revenue-engine-simple.tsx", "utf8");

  assert.match(appSource, /path="\/revenue-engine\/advanced"/);
  assert.match(appSource, /@\/pages\/revenue-engine-simple/);
  assert.match(appSource, /@\/pages\/revenue-engine/);
  assert.match(uiSource, /\/api\/revenue-engine\/outreach-drafts\/approve/);
  assert.match(uiSource, /\/api\/revenue-engine\/outreach-drafts\/update/);
  assert.match(uiSource, /\/api\/revenue-engine\/outreach-send/);
  assert.match(uiSource, /outcomeMutation\.mutate\("reply"\)/);
  assert.match(uiSource, /outcomeMutation\.mutate\("call_booked"\)/);
  assert.match(uiSource, /outcomeMutation\.mutate\("deposit_collected"\)/);
  assert.match(uiSource, /outcomeMutation\.mutate\("lost"\)/);
  assert.match(uiSource, /paymentConfirmation/);
});

test("Revenue Engine approval decisions require explicit queue target selection", () => {
  const uiSource = readFileSync("client/src/pages/revenue-engine.tsx", "utf8");

  assert.match(uiSource, /select-approval-target/);
  assert.match(uiSource, /select-approval-decision/);
  assert.match(uiSource, /input-approval-max-spend/);
  assert.match(uiSource, /approvalDecisionMutation\.mutate\(selectedApprovalQueueItem\)/);
  assert.match(uiSource, /approvalQueue\.length > 0 && !queueItem/);
  assert.match(uiSource, /approvalQueue\.length > 0 && !selectedApprovalQueueItem/);
  assert.match(uiSource, /setApprovalAction\(nextItem\.action\)/);
  assert.match(uiSource, /approvedAction: queueItem\?\.action \|\| approvalAction/);
  assert.doesNotMatch(uiSource, /approvalQueueItems\?\.\[0\]/);
});

test("Dashboard chat exposes a subscription handoff prompt", () => {
  const source = readFileSync("client/src/components/dashboard-assistant-chat.tsx", "utf8");

  assert.match(source, /membresia Pro/);
  assert.match(source, /campana fuerte/);
});

test("Agents Office shows Claude as an independent PR reviewer", () => {
  const source = readFileSync("client/src/pages/agents-office.tsx", "utf8");

  assert.match(source, /id: "claude-reviewer"/);
  assert.match(source, /name: "Claude Reviewer"/);
  assert.match(source, /Segundo chequeo/);
  assert.match(source, /from: "claude-reviewer", to: "github"/);
  assert.match(source, /from: "app-qa", to: "claude-reviewer"/);
  assert.match(source, /Codex trabaja PR-first y Claude revisa antes de App QA/);
});
