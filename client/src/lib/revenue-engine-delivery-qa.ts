export type RevenueDeliveryQaWorkspace = {
  id: string;
  input: {
    publicDataVerified: boolean;
    visualQaPassed: boolean;
    technicalQaPassed: boolean;
    automationQaPassed: boolean;
    clientHandoffReady: boolean;
    depositPaid: boolean;
  };
};

export type RevenueDeliveryQaReviewChecks = {
  depositPaid: boolean;
  publicDataVerified: boolean;
  responsiveChecked: boolean;
  linksChecked: boolean;
  automationTested: boolean;
  rollbackPlanReady: boolean;
  clientHandoffReady: boolean;
};

export function buildDeliveryWorkspaceQaPayload(
  workspace: RevenueDeliveryQaWorkspace,
  reviewChecks: RevenueDeliveryQaReviewChecks,
) {
  const depositVerified = workspace.input.depositPaid || reviewChecks.depositPaid;
  const rollbackVerified = reviewChecks.rollbackPlanReady;
  const automationQaPassed = workspace.input.automationQaPassed || (reviewChecks.automationTested && rollbackVerified);
  const clientHandoffReady = workspace.input.clientHandoffReady || reviewChecks.clientHandoffReady;
  const publicDataVerified = workspace.input.publicDataVerified || reviewChecks.publicDataVerified;
  const visualQaPassed = workspace.input.visualQaPassed || reviewChecks.responsiveChecked;
  const technicalQaPassed = workspace.input.technicalQaPassed || reviewChecks.linksChecked;

  return {
    workspaceId: workspace.id,
    publicDataVerified,
    visualQaPassed,
    technicalQaPassed,
    automationQaPassed,
    clientHandoffReady,
    notes: [
      "Revalidacion con evidencia marcada en el panel QA.",
      `data=${publicDataVerified ? "ok" : "pending"}`,
      `responsive=${visualQaPassed ? "ok" : "pending"}`,
      `technical=${technicalQaPassed ? "ok" : "pending"}`,
      `automation=${automationQaPassed ? "ok" : "pending"}`,
      `handoff=${clientHandoffReady ? "ok" : "pending"}`,
    ].join(" "),
  };
}
