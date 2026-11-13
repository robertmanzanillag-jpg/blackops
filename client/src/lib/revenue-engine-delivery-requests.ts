type TrustedDeliverWorkspaceRequestSource = {
  id: string;
  status: string;
  input: {
    projectType: string;
    prUrl: string;
    secondReviewStatus: string;
    secondReviewEvidenceUrl: string;
    appQaStatus: string;
    appQaEvidenceUrl: string;
    deploymentApprovalStatus: string;
    deploymentApprovalUrl: string;
    releaseGateHeadSha: string;
  };
  approvalSummary: {
    canLaunch: boolean;
    requiredBeforeClient: string[];
  };
  codexBuildHandoff: {
    missing: string[];
  };
};

export function isTrustedDeliveryRequestReady(workspace: TrustedDeliverWorkspaceRequestSource) {
  const isWebsiteDelivery = workspace.input.projectType === "website" || workspace.input.projectType === "bundle";
  const persistedReleaseGateReady = Boolean(
    workspace.input.prUrl
    && workspace.input.secondReviewStatus === "pass"
    && workspace.input.secondReviewEvidenceUrl
    && workspace.input.appQaStatus === "pass"
    && workspace.input.appQaEvidenceUrl
    && workspace.input.deploymentApprovalStatus === "approved"
    && workspace.input.deploymentApprovalUrl
    && workspace.input.releaseGateHeadSha
  );
  return isWebsiteDelivery
    && persistedReleaseGateReady
    && workspace.status === "ready_to_deliver"
    && workspace.approvalSummary.canLaunch
    && workspace.codexBuildHandoff.missing.length === 0
    && workspace.approvalSummary.requiredBeforeClient.length === 0;
}

export function buildCopyableTrustedDeliverRequest(workspace: TrustedDeliverWorkspaceRequestSource) {
  const readyForTrustedDelivery = isTrustedDeliveryRequestReady(workspace);
  return JSON.stringify({
    workspaceId: workspace.id,
    approvedByRobert: readyForTrustedDelivery,
    notes: readyForTrustedDelivery
      ? "Robert approved final delivery from Revenue Engine after PR, second review, App QA, release gate and rollback evidence passed."
      : "Do not deliver yet; complete PR, second review, App QA, release gate, rollback and Robert approval gates first.",
  }, null, 2);
}
