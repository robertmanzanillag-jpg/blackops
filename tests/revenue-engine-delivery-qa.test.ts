import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveryWorkspaceQaPayload } from "../client/src/lib/revenue-engine-delivery-qa";

const blockedWorkspace = {
  id: "workspace-1",
  input: {
    publicDataVerified: false,
    visualQaPassed: false,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    depositPaid: false,
  },
};

test("delivery QA payload does not mark handoff ready without deposit and rollback evidence", () => {
  const payload = buildDeliveryWorkspaceQaPayload(blockedWorkspace, {
    depositPaid: false,
    publicDataVerified: true,
    responsiveChecked: true,
    linksChecked: true,
    automationTested: true,
    rollbackPlanReady: false,
    clientHandoffReady: false,
  });

  assert.equal(payload.workspaceId, "workspace-1");
  assert.equal(payload.publicDataVerified, true);
  assert.equal(payload.visualQaPassed, true);
  assert.equal(payload.technicalQaPassed, true);
  assert.equal(payload.automationQaPassed, false);
  assert.equal(payload.clientHandoffReady, false);
  assert.match(payload.notes, /automation=pending/);
  assert.match(payload.notes, /handoff=pending/);
});

test("delivery QA payload keeps handoff blocked when only rollback is verified", () => {
  const payload = buildDeliveryWorkspaceQaPayload(blockedWorkspace, {
    depositPaid: false,
    publicDataVerified: true,
    responsiveChecked: true,
    linksChecked: true,
    automationTested: true,
    rollbackPlanReady: true,
    clientHandoffReady: false,
  });

  assert.equal(payload.automationQaPassed, true);
  assert.equal(payload.clientHandoffReady, false);
  assert.match(payload.notes, /automation=ok/);
  assert.match(payload.notes, /handoff=pending/);
});

test("delivery QA payload keeps handoff blocked when deposit and rollback are verified without handoff evidence", () => {
  const payload = buildDeliveryWorkspaceQaPayload(blockedWorkspace, {
    depositPaid: true,
    publicDataVerified: true,
    responsiveChecked: true,
    linksChecked: true,
    automationTested: false,
    rollbackPlanReady: true,
    clientHandoffReady: false,
  });

  assert.equal(payload.automationQaPassed, false);
  assert.equal(payload.clientHandoffReady, false);
  assert.match(payload.notes, /automation=pending/);
  assert.match(payload.notes, /handoff=pending/);
});

test("delivery QA payload requires marked evidence before promoting all gates", () => {
  const payload = buildDeliveryWorkspaceQaPayload(blockedWorkspace, {
    depositPaid: true,
    publicDataVerified: true,
    responsiveChecked: true,
    linksChecked: true,
    automationTested: true,
    rollbackPlanReady: true,
    clientHandoffReady: true,
  });

  assert.deepEqual(payload, {
    workspaceId: "workspace-1",
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
    notes: "Revalidacion con evidencia marcada en el panel QA. data=ok responsive=ok technical=ok automation=ok handoff=ok",
  });
});

test("delivery QA payload does not use existing handoff as rollback evidence", () => {
  const payload = buildDeliveryWorkspaceQaPayload(
    {
      ...blockedWorkspace,
      input: {
        ...blockedWorkspace.input,
        publicDataVerified: true,
        visualQaPassed: true,
        clientHandoffReady: true,
      },
    },
    {
      depositPaid: false,
      publicDataVerified: false,
      responsiveChecked: false,
      linksChecked: false,
      automationTested: true,
      rollbackPlanReady: false,
      clientHandoffReady: false,
    },
  );

  assert.equal(payload.publicDataVerified, true);
  assert.equal(payload.visualQaPassed, true);
  assert.equal(payload.technicalQaPassed, false);
  assert.equal(payload.automationQaPassed, false);
  assert.equal(payload.clientHandoffReady, true);
});

test("delivery QA payload preserves existing automation QA gate", () => {
  const payload = buildDeliveryWorkspaceQaPayload(
    {
      ...blockedWorkspace,
      input: {
        ...blockedWorkspace.input,
        automationQaPassed: true,
        clientHandoffReady: true,
      },
    },
    {
      depositPaid: false,
      publicDataVerified: false,
      responsiveChecked: false,
      linksChecked: false,
      automationTested: false,
      rollbackPlanReady: false,
      clientHandoffReady: false,
    },
  );

  assert.equal(payload.automationQaPassed, true);
  assert.equal(payload.clientHandoffReady, true);
});
