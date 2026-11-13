import test from "node:test";
import assert from "node:assert/strict";
import { advanceCompany, emptyCompanyState, enrollTrainee } from "../shared/agent-company.ts";
import {
  activateCandidatePolicy, completeRoleExecution, emptyRoleLifecycleState, expireRoleExecutions,
  reconcileRoleLifecycles, recordProductionPolicyAssessment, registerCandidatePolicy, reserveRoleExecution, parseRoleLifecycleState,
  type OfficeRoleLifecycleState, type ProductionPolicyAssessment, type RolePolicy,
} from "../shared/office-role-lifecycle.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const ROLE = "claude-reviewer";
function setup() {
  let company = advanceCompany(emptyCompanyState(), { now: NOW - 86400000, statuses: { [ROLE]: { state: "working", label: "Working" }, code: { state: "working", label: "Working" } }, roles: { [ROLE]: "Reviewer", code: "Code" } }).state;
  company = enrollTrainee(company, { id: "candidate", forAgentId: ROLE, role: "Reviewer", now: NOW - 10000 });
  company.orders.push({ id: "stable-order", text: "Review the existing PR", createdAt: new Date(NOW - 10000).toISOString(), assignees: [{ agentId: ROLE, status: "en_curso", note: "Existing assignment" }] });
  const policy: RolePolicy = { version: "candidate-v1", candidateId: "candidate", generation: 1, curriculumVersion: "course-v1", guidance: ["Check authorization and data isolation"], createdAt: new Date(NOW - 10000).toISOString() };
  const state = registerCandidatePolicy(reconcileRoleLifecycles(emptyRoleLifecycleState(), company, NOW), ROLE, policy, NOW);
  return { state, company, policy };
}
function evidence(state: OfficeRoleLifecycleState, i: number, patch: Partial<ProductionPolicyAssessment> = {}): ProductionPolicyAssessment {
  return { scope: "production", runId: `run-${i}`, taskId: `task-${i}`, artifactId: `artifact-${i}`, candidatePolicyVersion: "candidate-v1",
    incumbentPolicyVersion: state.roles[ROLE].activePolicy!.version, generation: state.roles[ROLE].generation,
    completedAt: new Date(NOW - 1000 + i).toISOString(), passed: true, quality: 100, incumbentQuality: 75, errors: 0, incumbentErrors: 1,
    durationMs: 100, incumbentDurationMs: 120, cost: 0, incumbentCost: 0, ...patch };
}
function qualify(state: OfficeRoleLifecycleState) {
  for (let i = 0; i < 3; i++) state = recordProductionPolicyAssessment(state, ROLE, evidence(state, i), NOW);
  return state;
}

test("only the complete approved held-out profile permits benchmark-scoped probation", () => {
  let { state } = setup();
  const tasks = ["reviewer-heldout-v1:access", "reviewer-heldout-v1:data", "reviewer-heldout-v1:boundaries"];
  for (let i = 0; i < 3; i++) state = recordProductionPolicyAssessment(state, ROLE, evidence(state, i, {
    scope: "benchmark", profileId: "reviewer-heldout", profileVersion: "1", taskId: tasks[i],
  }), NOW);
  const approved = activateCandidatePolicy(state, ROLE, "candidate-v1", NOW);
  assert.equal(approved.activated, true);
  assert.equal(approved.state.roles[ROLE].status, "probation");
  assert.equal(approved.state.roles[ROLE].activePolicy!.qualificationScope, "benchmark");
  const changed = structuredClone(state); changed.roles[ROLE].assessments[0].taskId = "easy-sample";
  assert.equal(activateCandidatePolicy(changed, ROLE, "candidate-v1", NOW).activated, false);
  const mixed = structuredClone(state); mixed.roles[ROLE].assessments[0].scope = "production";
  assert.equal(activateCandidatePolicy(mixed, ROLE, "candidate-v1", NOW).activated, false);
});
test("registry keeps unsupported roles explicit and initializes reviewer only", () => {
  const { state } = setup();
  assert.equal(state.roles.code.status, "unsupported");
  assert.equal(state.roles.code.activePolicy, undefined);
  assert.equal(state.roles[ROLE].status, "active");
  assert.equal(reserveRoleExecution(state, { roleId: "code", policyVersion: "x", executionId: "e", fence: "f", now: NOW, ttlMs: 1000 }).lease, undefined);
});
test("policy registration is immutable and requires current eligible candidate", () => {
  const { state, policy } = setup();
  assert.equal(registerCandidatePolicy(state, ROLE, { ...policy, guidance: ["changed"] }, NOW), state);
  assert.equal(registerCandidatePolicy(state, ROLE, { ...policy, version: "v2", generation: 2 }, NOW), state);
  assert.equal(registerCandidatePolicy(state, ROLE, { ...policy, version: "v2", candidateId: "unknown" }, NOW), state);
});
test("three production comparisons activate probation while preserving work and context", () => {
  const { state } = setup();
  const result = activateCandidatePolicy(qualify(state), ROLE, "candidate-v1", NOW);
  assert.equal(result.activated, true);
  assert.equal(result.state.roles[ROLE].status, "probation");
  assert.deepEqual(result.state.roles[ROLE].pendingOrderIds, ["stable-order"]);
  assert.deepEqual(result.state.roles[ROLE].context, state.roles[ROLE].context);
  assert.equal(result.state.roles[ROLE].policyHistory[0].version, state.roles[ROLE].activePolicy!.version);
  assert.equal(activateCandidatePolicy(result.state, ROLE, "candidate-v1", NOW).activated, false);
});
test("fixtures, duplicate evidence, equal quality, higher costs or slower runs never activate", () => {
  for (const patch of [
    { scope: "fixture" }, { taskId: "same" }, { artifactId: "same" }, { incumbentQuality: 100 }, { cost: 1 }, { durationMs: 500 },
    { completedAt: new Date(NOW - 8 * 86400000).toISOString() }, { completedAt: new Date(NOW + 100).toISOString() },
    { incumbentPolicyVersion: "wrong" }, { generation: 2 },
  ]) {
    let { state } = setup();
    for (let i = 0; i < 3; i++) state = recordProductionPolicyAssessment(state, ROLE, evidence(state, i, patch as Partial<ProductionPolicyAssessment>), NOW);
    assert.equal(activateCandidatePolicy(state, ROLE, "candidate-v1", NOW).activated, false, JSON.stringify(patch));
  }
});
test("activation blocks while execution is running and preserves incumbent", () => {
  const state = qualify(setup().state);
  const reserved = reserveRoleExecution(state, { roleId: ROLE, policyVersion: state.roles[ROLE].activePolicy!.version, executionId: "live-1", fence: "fence-1", now: NOW, ttlMs: 1000 });
  assert.ok(reserved.lease);
  assert.equal(activateCandidatePolicy(reserved.state, ROLE, "candidate-v1", NOW).reason, "EXECUTION_IN_FLIGHT_OR_UNCERTAIN");
});
test("first verified result confirms replacement and a failed first result leaves vacancy", () => {
  for (const success of [true, false]) {
    const active = activateCandidatePolicy(qualify(setup().state), ROLE, "candidate-v1", NOW).state;
    const reserved = reserveRoleExecution(active, { roleId: ROLE, policyVersion: "candidate-v1", executionId: "first", fence: "fence-1", now: NOW, ttlMs: 1000 });
    const result = completeRoleExecution(reserved.state, { roleId: ROLE, policyVersion: "candidate-v1", executionId: "first", fence: "fence-1", now: NOW + 10, artifactId: "real-review-result", success });
    assert.equal(result.accepted, true);
    assert.equal(result.state.roles[ROLE].status, success ? "active" : "vacant");
    assert.equal(result.state.roles[ROLE].leases[0].artifactId, "real-review-result");
  }
});
test("restart preserves leases, duplicate reservations and stale fences cannot execute twice", () => {
  const state = setup().state;
  const request = { roleId: ROLE, policyVersion: state.roles[ROLE].activePolicy!.version, executionId: "live-1", fence: "fence-1", now: NOW, ttlMs: 1000 };
  const reserved = reserveRoleExecution(state, request);
  const restored = parseRoleLifecycleState(JSON.parse(JSON.stringify(reserved.state)));
  assert.equal(reserveRoleExecution(restored, request).reason, "EXECUTION_ALREADY_RESERVED");
  assert.equal(reserveRoleExecution(restored, { ...request, executionId: "live-2", fence: "fence-2" }).reason, "EXECUTION_IN_FLIGHT_OR_UNCERTAIN");
  assert.equal(completeRoleExecution(restored, { ...request, fence: "wrong", artifactId: "a", success: true, now: NOW + 10 }).accepted, false);
});
test("expired execution is unknown, never silently retried or accepted late", () => {
  const state = setup().state;
  const request = { roleId: ROLE, policyVersion: state.roles[ROLE].activePolicy!.version, executionId: "live-1", fence: "fence-1", now: NOW, ttlMs: 1000 };
  const reserved = reserveRoleExecution(state, request);
  const expired = expireRoleExecutions(reserved.state, NOW + 1000);
  assert.equal(expired.roles[ROLE].leases[0].status, "unknown");
  assert.equal(reserveRoleExecution(expired, { ...request, executionId: "live-2", fence: "fence-2", now: NOW + 1001 }).lease, undefined);
  assert.equal(completeRoleExecution(expired, { ...request, artifactId: "late", success: true, now: NOW + 1001 }).accepted, false);
});
test("failure life retirement makes role vacant; missing candidate never claims replacement", () => {
  let { company, state } = setup();
  company.careers[ROLE].battery = 0;
  company = advanceCompany(company, { now: NOW + 1, statuses: { [ROLE]: { state: "error", label: "Real failed work", evidenceId: "failure-1" } }, roles: { [ROLE]: "Reviewer" } }).state;
  state = reconcileRoleLifecycles(state, company, NOW + 1);
  assert.equal(state.roles[ROLE].generation, 2);
  assert.equal(state.roles[ROLE].status, "vacant");
  assert.equal(activateCandidatePolicy(state, ROLE, "candidate-v1", NOW + 1).activated, false);
  assert.equal(state.roles[ROLE].pendingOrderIds[0], "stable-order");
  assert.ok(company.retiredCareers?.length);
  assert.equal(state.roles[ROLE].history.at(-1)?.event, "holder_retired");
});
test("old generation completion cannot change retired role", () => {
  let { company, state } = setup();
  const request = { roleId: ROLE, policyVersion: state.roles[ROLE].activePolicy!.version, executionId: "old", fence: "fence-old", now: NOW, ttlMs: 1000 };
  state = reserveRoleExecution(state, request).state;
  company.careers[ROLE].generation = 2; company.careers[ROLE].inTrainingUntilGeneration = 2;
  state = reconcileRoleLifecycles(state, company, NOW + 1);
  assert.equal(completeRoleExecution(state, { ...request, artifactId: "old-artifact", success: true, now: NOW + 10 }).accepted, false);
});
test("persisted corruption never resets active or uncertain execution state", () => {
  assert.deepEqual(parseRoleLifecycleState(undefined), emptyRoleLifecycleState());
  for (const bad of [null, {}, { version: 9, roles: {} }, { version: 1, roles: { bad: {} } }]) assert.throws(() => parseRoleLifecycleState(bad), /recovery/);
  const { state } = setup();
  const damaged = JSON.parse(JSON.stringify(state)); damaged.roles[ROLE].leases = [{ status: "running" }];
  assert.throws(() => parseRoleLifecycleState(damaged), /recovery/);
});
test("retirement preserves prior context and old baseline can never reserve under new generation", () => {
  let { company, state } = setup();
  const old = { ...company.careers[ROLE], memory: [{ at: new Date(NOW - 100).toISOString(), text: "Do not lose the prior task context" }] };
  company.retiredCareers = [old]; company.careers[ROLE] = { ...old, generation: 2, inTrainingUntilGeneration: 2, memory: [] };
  state = reconcileRoleLifecycles(state, company, NOW);
  assert.ok(state.roles[ROLE].context.memory.some(m => m.text === "Do not lose the prior task context"));
  state.roles[ROLE].status = "active";
  assert.equal(reserveRoleExecution(state, { roleId: ROLE, policyVersion: state.roles[ROLE].activePolicy!.version, executionId: "bad", fence: "bad", now: NOW, ttlMs: 1000 }).reason, "INVALID_EXECUTION_ASSIGNMENT");
});
test("verified active candidate policy cannot be activated again", () => {
  let state = activateCandidatePolicy(qualify(setup().state), ROLE, "candidate-v1", NOW).state;
  state = reserveRoleExecution(state, { roleId: ROLE, policyVersion: "candidate-v1", executionId: "first", fence: "f", now: NOW, ttlMs: 1000 }).state;
  state = completeRoleExecution(state, { roleId: ROLE, policyVersion: "candidate-v1", executionId: "first", fence: "f", now: NOW + 10, artifactId: "a", success: true }).state;
  assert.equal(activateCandidatePolicy(state, ROLE, "candidate-v1", NOW + 11).reason, "POLICY_ALREADY_ACTIVATED");
});
test("a removed holder cannot remain executable after reconciliation", () => {
  const { state, company } = setup();
  delete company.careers[ROLE];
  const next = reconcileRoleLifecycles(state, company, NOW);
  assert.equal(next.roles[ROLE].status, "vacant");
  assert.equal(reserveRoleExecution(next, { roleId: ROLE, policyVersion: next.roles[ROLE].activePolicy!.version, executionId: "missing", fence: "missing", now: NOW, ttlMs: 1000 }).lease, undefined);
});
