import type { CompanyState } from "./agent-company";

// This registry describes actual adapters, not the avatars displayed by the office.
export const OFFICE_EXECUTABLE_ROLES = { "claude-reviewer": { readOnly: true }, ceo: {readOnly:true}, assistant: {readOnly:true}, radio:{readOnly:true} } as const;
export type RolePolicy = {
  version: string;
  guidance: string[];
  candidateId: string;
  generation: number;
  curriculumVersion: string;
  createdAt: string;
  qualificationScope?: "production" | "benchmark";
};
export type ProductionPolicyAssessment = {
  scope: "production" | "benchmark";
  profileId?: string;
  profileVersion?: string;
  runId: string;
  taskId: string;
  artifactId: string;
  candidatePolicyVersion: string;
  incumbentPolicyVersion: string;
  generation: number;
  completedAt: string;
  passed: boolean;
  quality: number;
  incumbentQuality: number;
  errors: number;
  incumbentErrors: number;
  durationMs: number;
  incumbentDurationMs: number;
  cost: number;
  incumbentCost: number;
};
export type RoleExecutionLease = {
  executionId: string;
  fence: string;
  policyVersion: string;
  generation: number;
  startedAt: string;
  expiresAt: string;
  status: "running" | "completed" | "failed" | "unknown";
  artifactId?: string;
  completedAt?: string;
};
export type OfficeRoleLifecycle = {
  roleId: string;
  generation: number;
  status: "active" | "vacant" | "probation" | "unsupported";
  activePolicy?: RolePolicy;
  candidatePolicies: RolePolicy[];
  eligibleCandidateIds: string[];
  assessments: ProductionPolicyAssessment[];
  leases: RoleExecutionLease[];
  pendingOrderIds: string[];
  context: { memory: Array<{ at: string; text: string }>; skillIds: string[] };
  policyHistory: RolePolicy[];
  history: Array<{ at: string; event: string; policyVersion?: string; evidenceIds?: string[] }>;
};
export type OfficeRoleLifecycleState = { version: 1; roles: Record<string, OfficeRoleLifecycle> };
const text = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;
const time = (s: string) => Date.parse(s);
const iso = (now: number) => new Date(now).toISOString();
const supported = (id: string) => Object.prototype.hasOwnProperty.call(OFFICE_EXECUTABLE_ROLES, id);
const replace = (state: OfficeRoleLifecycleState, role: OfficeRoleLifecycle): OfficeRoleLifecycleState => ({ ...state, roles: { ...state.roles, [role.roleId]: role } });
const blockedLease = (role: OfficeRoleLifecycle) => role.leases.some(l => l.status === "running" || l.status === "unknown");

export function emptyRoleLifecycleState(): OfficeRoleLifecycleState { return { version: 1, roles: {} }; }

function validPolicy(value: unknown): value is RolePolicy {
  if (!value || typeof value !== "object") return false;
  const p = value as RolePolicy;
  return [p.version,p.candidateId,p.curriculumVersion].every(text) && Number.isSafeInteger(p.generation) && p.generation > 0 &&
    Number.isFinite(time(p.createdAt)) && Array.isArray(p.guidance) && p.guidance.length <= 30 && p.guidance.every(g => text(g) && g.length <= 16000);
}

/** Corrupt persisted execution state must never reset to an apparently idle worker. */
export function parseRoleLifecycleState(value: unknown): OfficeRoleLifecycleState {
  if (value === undefined) return emptyRoleLifecycleState();
  const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  const fail = (): never => { throw new Error("Invalid persisted office role lifecycle; recovery is required."); };
  if (!object(value) || value.version !== 1 || !object(value.roles)) return fail();
  for (const [id, raw] of Object.entries(value.roles)) {
    if (!object(raw)) return fail();
    const role = raw as unknown as OfficeRoleLifecycle;
    if (role.roleId !== id || !Number.isSafeInteger(role.generation) || role.generation < 1 ||
        !["active","vacant","probation","unsupported"].includes(role.status) ||
        (["active","probation"].includes(role.status) && (!role.activePolicy || role.activePolicy.generation !== role.generation)) ||
        (role.activePolicy !== undefined && !validPolicy(role.activePolicy)) ||
        !Array.isArray(role.candidatePolicies) || !role.candidatePolicies.every(validPolicy) ||
        !Array.isArray(role.policyHistory) || !role.policyHistory.every(validPolicy) ||
        !Array.isArray(role.eligibleCandidateIds) || !role.eligibleCandidateIds.every(text) ||
        !Array.isArray(role.pendingOrderIds) || !role.pendingOrderIds.every(text) ||
        !Array.isArray(role.assessments) || !role.assessments.every(validAssessment) ||
        !object(role.context) || !Array.isArray(role.context.memory) || !role.context.memory.every(m => object(m) && typeof m.at === "string" && Number.isFinite(time(m.at)) && typeof m.text === "string") ||
        !Array.isArray(role.context.skillIds) || !role.context.skillIds.every(text) ||
        !Array.isArray(role.history) || !role.history.every(h => object(h) && typeof h.at === "string" && Number.isFinite(time(h.at)) && text(h.event) &&
          (h.policyVersion === undefined || text(h.policyVersion)) && (h.evidenceIds === undefined || Array.isArray(h.evidenceIds) && h.evidenceIds.every(text))) ||
        !Array.isArray(role.leases) || !role.leases.every(l => object(l) && [l.executionId,l.fence,l.policyVersion].every(text) &&
          Number.isSafeInteger(l.generation) && Number(l.generation) > 0 && typeof l.startedAt === "string" && typeof l.expiresAt === "string" &&
          Number.isFinite(time(l.startedAt)) && time(l.expiresAt) > time(l.startedAt) && ["running","completed","failed","unknown"].includes(String(l.status)) &&
          (l.artifactId === undefined || text(l.artifactId)) && (l.completedAt === undefined || typeof l.completedAt === "string" && Number.isFinite(time(l.completedAt))))) return fail();
    if (new Set(role.leases.map(l => l.executionId)).size !== role.leases.length || new Set(role.leases.map(l => l.fence)).size !== role.leases.length ||
        new Set(role.candidatePolicies.map(p => p.version)).size !== role.candidatePolicies.length) return fail();
  }
  return JSON.parse(JSON.stringify(value)) as OfficeRoleLifecycleState;
}

/** Call under the same owner transaction as career updates. No schedules or permissions
 * are copied or changed. Pending work keeps its original role and order IDs. */
export function reconcileRoleLifecycles(state: OfficeRoleLifecycleState, company: CompanyState, now: number): OfficeRoleLifecycleState {
  let next = expireRoleExecutions(state, now);
  for (const role of Object.values(next.roles)) {
    if (company.careers[role.roleId] || !["active","probation"].includes(role.status)) continue;
    next = replace(next, { ...role, status: supported(role.roleId) ? "vacant" : "unsupported",
      history: [...role.history, { at: iso(now), event: "holder_missing", policyVersion: role.activePolicy?.version }] });
  }
  for (const career of Object.values(company.careers)) {
    if (!Number.isSafeInteger(career.generation) || career.generation < 1) continue;
    const previous = next.roles[career.agentId];
    const executable = supported(career.agentId);
    const baseline: RolePolicy = {
      version: `baseline:${career.agentId}:${career.generation}`,
      guidance: [...(career.reviewGuidance || [])], candidateId: "baseline",
      generation: career.generation, curriculumVersion: "baseline", createdAt: career.hiredAt,
    };
    let role: OfficeRoleLifecycle = previous || {
      roleId: career.agentId, generation: career.generation,
      status: !executable ? "unsupported" : career.inTrainingUntilGeneration ? "vacant" : "active",
      ...(executable ? { activePolicy: baseline } : {}),
      candidatePolicies: [], eligibleCandidateIds: [], assessments: [], leases: [], pendingOrderIds: [],
      context: { memory: [], skillIds: [] }, policyHistory: [], history: [],
    };
    if(previous?.status === "unsupported" && executable && !previous.activePolicy && !career.inTrainingUntilGeneration && previous.generation === career.generation) {
      role={...role,status:"active",activePolicy:baseline};
    }
    if (previous && previous.generation !== career.generation) {
      role = { ...role, generation: career.generation, status: executable ? "vacant" : "unsupported",
        history: [...role.history, { at: iso(now), event: "holder_retired", policyVersion: role.activePolicy?.version }] };
    } else if (career.inTrainingUntilGeneration && role.activePolicy?.candidateId === "baseline") {
      role = { ...role, status: executable ? "vacant" : "unsupported" };
    }
    const retired = (company.retiredCareers || []).filter(c => c.agentId === career.agentId && c.generation === (previous?.generation ?? career.generation - 1));
    const memory = [...role.context.memory, ...retired.flatMap(c => c.memory), ...career.memory];
    role = { ...role,
      eligibleCandidateIds: company.trainees.filter(t => t.forAgentId === career.agentId && !t.graduatedAt && !t.evaluationClosedAt &&
        (t.generation === undefined || t.generation === career.generation)).map(t => t.id),
      pendingOrderIds: company.orders.filter(o => !o.doneAt && o.assignees.some(a => a.agentId === career.agentId && a.status !== "hecha")).map(o => o.id),
      context: { memory: memory.filter((m,i) => memory.findIndex(other => other.at === m.at && other.text === m.text) === i).map(m => ({ ...m })),
        skillIds: [...new Set([...role.context.skillIds, ...retired.flatMap(c => (c.skills || []).map(s => s.id)), ...(career.skills || []).map(s => s.id)])] },
    };
    next = replace(next, role);
  }
  return next;
}

export function registerCandidatePolicy(state: OfficeRoleLifecycleState, roleId: string, policy: RolePolicy, now: number): OfficeRoleLifecycleState {
  const role = state.roles[roleId];
  if (!role || !supported(roleId) || !text(policy.version) || !text(policy.candidateId) || !text(policy.curriculumVersion) ||
      policy.generation !== role.generation || !Number.isFinite(time(policy.createdAt)) || time(policy.createdAt) > now ||
      !Array.isArray(policy.guidance) || policy.guidance.length > 30 || policy.guidance.some(g => !text(g) || g.length > 16000) ||
      !role.eligibleCandidateIds.includes(policy.candidateId) || role.activePolicy?.version === policy.version ||
      role.policyHistory.some(p => p.version === policy.version) || role.candidatePolicies.some(p => p.version === policy.version)) return state;
  return replace(state, { ...role, candidatePolicies: [...role.candidatePolicies, { ...policy, guidance: [...policy.guidance] }] });
}

function validAssessment(a: ProductionPolicyAssessment): boolean {
  return (a?.scope === "production" || (a?.scope === "benchmark" && a.profileId === "reviewer-heldout" && a.profileVersion === "1")) && [a.runId,a.taskId,a.artifactId,a.candidatePolicyVersion,a.incumbentPolicyVersion].every(text) &&
    typeof a.passed === "boolean" && Number.isFinite(time(a.completedAt)) && Number.isSafeInteger(a.generation) && a.generation > 0 &&
    [a.quality,a.incumbentQuality,a.errors,a.incumbentErrors,a.durationMs,a.incumbentDurationMs,a.cost,a.incumbentCost]
      .every(n => Number.isFinite(n) && n >= 0) && a.quality <= 100 && a.incumbentQuality <= 100;
}

/** Trusted evaluator only. The server must bind this record to stored assignments and
 * artifacts; accepting browser/model-supplied grades would violate this boundary. */
export function recordProductionPolicyAssessment(state: OfficeRoleLifecycleState, roleId: string, assessment: ProductionPolicyAssessment, now: number): OfficeRoleLifecycleState {
  const role = state.roles[roleId];
  const candidate = role?.candidatePolicies.find(p => p.version === assessment?.candidatePolicyVersion);
  if (!role || !candidate || !validAssessment(assessment) || assessment.generation !== role.generation || candidate.generation !== role.generation ||
      assessment.incumbentPolicyVersion !== role.activePolicy?.version || time(assessment.completedAt) < time(candidate.createdAt) ||
      time(assessment.completedAt) > now || role.assessments.some(a => a.runId === assessment.runId)) return state;
  return replace(state, { ...role, assessments: [...role.assessments, { ...assessment }] });
}

export function activateCandidatePolicy(state: OfficeRoleLifecycleState, roleId: string, version: string, now: number): { state: OfficeRoleLifecycleState; activated: boolean; reason?: string } {
  const next = expireRoleExecutions(state, now);
  const role = next.roles[roleId];
  const deny = (reason: string) => ({ state: next, activated: false, reason });
  if (!role || !supported(roleId)) return deny("UNSUPPORTED_ROLE");
  if (role.activePolicy?.version === version || role.policyHistory.some(p => p.version === version)) return deny("POLICY_ALREADY_ACTIVATED");
  if (blockedLease(role)) return deny("EXECUTION_IN_FLIGHT_OR_UNCERTAIN");
  const candidate = role.candidatePolicies.find(p => p.version === version && p.generation === role.generation);
  if (!candidate || !role.eligibleCandidateIds.includes(candidate.candidateId)) return deny("CANDIDATE_UNAVAILABLE");
  if (role.status === "probation") return deny("CURRENT_REPLACEMENT_NOT_VERIFIED");
  const evidence = role.assessments.filter(a => validAssessment(a) && a.candidatePolicyVersion === version &&
    a.incumbentPolicyVersion === role.activePolicy?.version && a.generation === role.generation &&
    time(a.completedAt) >= time(candidate.createdAt) && time(a.completedAt) <= now && now - time(a.completedAt) <= 7 * 86400000)
    .sort((a,b) => time(a.completedAt) - time(b.completedAt)).slice(-3);
  if (evidence.length !== 3 || new Set(evidence.map(a => a.runId)).size !== 3 || new Set(evidence.map(a => a.taskId)).size !== 3 ||
      new Set(evidence.map(a => a.scope)).size !== 1 ||
      (evidence[0]?.scope === "benchmark" && !["reviewer-heldout-v1:access", "reviewer-heldout-v1:data", "reviewer-heldout-v1:boundaries"].every(id => evidence.some(a => a.taskId === id))) ||
      new Set(evidence.map(a => a.artifactId)).size !== 3 || evidence.some(a => !a.passed || a.quality < 80 || a.errors !== 0 ||
      a.quality <= a.incumbentQuality || a.errors > a.incumbentErrors || a.cost > a.incumbentCost || a.durationMs > a.incumbentDurationMs)) return deny("INSUFFICIENT_COMPARABLE_PRODUCTION_EVIDENCE");
  return { activated: true, state: replace(next, { ...role, status: "probation", activePolicy: { ...candidate, guidance: [...candidate.guidance], qualificationScope: evidence[0].scope },
    policyHistory: [...role.policyHistory, ...(role.activePolicy ? [{ ...role.activePolicy, guidance: [...role.activePolicy.guidance] }] : [])],
    history: [...role.history, { at: iso(now), event: "policy_activated_pending_first_result", policyVersion: version, evidenceIds: evidence.map(a => a.runId) }],
  }) };
}

export function expireRoleExecutions(state: OfficeRoleLifecycleState, now: number): OfficeRoleLifecycleState {
  let next = state;
  for (const role of Object.values(state.roles)) {
    if (!role.leases.some(l => l.status === "running" && time(l.expiresAt) <= now)) continue;
    next = replace(next, { ...role, leases: role.leases.map(l => l.status === "running" && time(l.expiresAt) <= now ? { ...l, status: "unknown" } : l),
      history: [...role.history, { at: iso(now), event: "execution_uncertain_no_automatic_retry" }] });
  }
  return next;
}

export function reserveRoleExecution(state: OfficeRoleLifecycleState, input: {
  roleId: string; policyVersion: string; executionId: string; fence: string; now: number; ttlMs: number;
}): { state: OfficeRoleLifecycleState; lease?: RoleExecutionLease; reason?: string } {
  const next = expireRoleExecutions(state, input.now);
  const role = next.roles[input.roleId];
  const deny = (reason: string) => ({ state: next, reason });
  if (!role || !supported(input.roleId) || !["active", "probation"].includes(role.status)) return deny("ROLE_NOT_EXECUTABLE");
  if (!text(input.executionId) || !text(input.fence) || !Number.isFinite(input.now) || !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1 || input.ttlMs > 300000 ||
      role.activePolicy?.version !== input.policyVersion || role.activePolicy.generation !== role.generation) return deny("INVALID_EXECUTION_ASSIGNMENT");
  if (role.leases.some(l => l.executionId === input.executionId || l.fence === input.fence)) return deny("EXECUTION_ALREADY_RESERVED");
  if (blockedLease(role)) return deny("EXECUTION_IN_FLIGHT_OR_UNCERTAIN");
  const lease: RoleExecutionLease = { executionId: input.executionId, fence: input.fence, policyVersion: input.policyVersion,
    generation: role.generation, startedAt: iso(input.now), expiresAt: iso(input.now + input.ttlMs), status: "running" };
  return { state: replace(next, { ...role, leases: [...role.leases, lease] }), lease };
}

export function completeRoleExecution(state: OfficeRoleLifecycleState, input: {
  roleId: string; executionId: string; fence: string; policyVersion: string; now: number; artifactId: string; success: boolean;
}): { state: OfficeRoleLifecycleState; accepted: boolean; reason?: string } {
  const next = expireRoleExecutions(state, input.now);
  const role = next.roles[input.roleId];
  const lease = role?.leases.find(l => l.executionId === input.executionId);
  if (!role || !lease || lease.status !== "running" || lease.fence !== input.fence || lease.policyVersion !== input.policyVersion ||
      role.activePolicy?.version !== input.policyVersion || role.activePolicy.generation !== role.generation || lease.generation !== role.generation || !text(input.artifactId) ||
      !Number.isFinite(input.now) || input.now < time(lease.startedAt) || typeof input.success !== "boolean") return { state: next, accepted: false, reason: "COMPLETION_NOT_FENCED" };
  return { accepted: true, state: replace(next, { ...role,
    status: role.status === "probation" ? input.success ? "active" : "vacant" : role.status,
    leases: role.leases.map(l => l.executionId === input.executionId ? { ...l, status: input.success ? "completed" : "failed", artifactId: input.artifactId, completedAt: iso(input.now) } : l),
    history: [...role.history, { at: iso(input.now), event: input.success ? "verified_execution" : "execution_failed", policyVersion: input.policyVersion, evidenceIds: [input.artifactId] }],
  }) };
}
