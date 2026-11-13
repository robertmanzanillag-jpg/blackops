/** Policy is code-owned: neither model output nor project settings can override it. */
export const FACTORY_POLICY = Object.freeze({ monthlyLimitCents: 10_000, maxRepairs: 2, maxConcurrentBuilds: 1, minimumRehearsals: 3, evidenceMaxAgeMs: 86_400_000 });
export type FactoryStage = "discover" | "build" | "simulate" | "review" | "release" | "verify" | "learn";
export interface FactoryProject {
  id: string; repo: string; testCommand: string; buildCommand: string; stagingUrl: string;
  productionUrl: string; healthUrl: string; rollbackCommand: string; journeys: string[];
  automaticRelease: boolean; providerSupportsRelease: boolean; providerSupportsRollback: boolean;
  rehearsalRunIds: string[]; rollbackVerifiedAt?: string;
}
export interface FactoryBudget { month: string; fixedCents: number; spentCents: number; reservedCents: number }
export interface FactoryCandidate {
  projectId: string; headSha: string; baseSha: string; prUrl: string; builderId: string;
  risk: "low" | "high" | "unknown"; reversible: boolean; changedFiles: string[];
  affectsContracts: boolean; affectsData: boolean; repairAttempts: number;
}
export interface FactoryEvidence {
  projectId: string; headSha: string; baseSha: string; kind: "tests" | "simulation" | "review";
  passed: boolean; warnings: string[]; createdAt: string; actorId: string;
  artifactIds: string[]; journeyIds?: string[]; baselineJourneyIds?: string[];
  viewports?: string[]; syntheticData?: boolean; externalServicesMocked?: boolean;
}
export interface FactoryGate { allowed: boolean; reasons: string[] }
const gate = (reasons: string[]): FactoryGate => ({ allowed: reasons.length === 0, reasons });
const validUrl = (value: string) => { try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; } };
const sha = (value: string) => /^[a-f0-9]{40,64}$/i.test(value);
const recent = (value: string | undefined, now: number) => { const age = now - Date.parse(value || ""); return Number.isFinite(age) && age >= 0 && age <= FACTORY_POLICY.evidenceMaxAgeMs; };
export function projectReadiness(project: FactoryProject): FactoryGate {
  const reasons: string[] = [];
  if (!project.id || !/^[\w.-]+\/[\w.-]+$/.test(project.repo)) reasons.push("project_repository_missing");
  if (![project.testCommand, project.buildCommand, project.rollbackCommand].every(x => typeof x === "string" && x.trim())) reasons.push("project_commands_missing");
  if (![project.stagingUrl, project.productionUrl, project.healthUrl].every(validUrl) || project.stagingUrl === project.productionUrl) reasons.push("isolated_environment_missing");
  if (!project.journeys.length || project.journeys.some(x => !x.trim()) || new Set(project.journeys).size !== project.journeys.length) reasons.push("journeys_missing_or_duplicate");
  if (!project.providerSupportsRelease || !project.providerSupportsRollback) reasons.push("provider_release_or_recovery_unavailable");
  return gate(reasons);
}
/** PR-only execution requires no deployment provider, rollback, or staging host. */
export function proposalReadiness(project: FactoryProject): FactoryGate {
  const reasons:string[]=[];
  if(!project.id || !/^[\w.-]+\/[\w.-]+$/.test(project.repo))reasons.push("project_repository_missing");
  if(![project.testCommand,project.buildCommand].every(value=>typeof value==="string" && value.trim()))reasons.push("project_commands_missing");
  if(!Array.isArray(project.journeys) || !project.journeys.length || project.journeys.some(value=>!value.trim()) || new Set(project.journeys).size!==project.journeys.length)reasons.push("journeys_missing_or_duplicate");
  return gate(reasons);
}
const protectedPath = /(^|\/)(\.env(?:\..*)?|credentials|secrets|\.git|node_modules|migrations)(\/|$)|(^|\/)(AGENTS\.md|CLAUDE\.md|package(?:-lock)?\.json|.*lock.*|.*(?:auth|permission|payment|stripe|security|trust-policy|software-factory|deploy|infra|schema).*)$/i;
export function proposalEvidenceGate(project:FactoryProject,candidate:FactoryCandidate,evidence:FactoryEvidence[],now=Date.now()):FactoryGate{
  const reasons=[...proposalReadiness(project).reasons];
  let validPr=false;
  try{const url=new URL(candidate.prUrl);validPr=url.origin==="https://github.com" && !url.username && !url.password && !url.search && !url.hash && url.pathname.startsWith(`/${project.repo}/pull/`) && /^[1-9][0-9]*$/.test(url.pathname.slice(`/${project.repo}/pull/`.length));}catch{}
  if(candidate.projectId!==project.id || !sha(candidate.headSha) || !sha(candidate.baseSha) || candidate.headSha===candidate.baseSha || !candidate.builderId.trim() || !validPr)reasons.push("candidate_identity_invalid");
  for(const kind of ["tests","simulation","review"] as const){
    const latest=evidence.filter(e=>e.kind===kind && e.projectId===project.id && e.headSha===candidate.headSha && e.baseSha===candidate.baseSha).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];
    if(!latest || !latest.passed || latest.warnings.length || !recent(latest.createdAt,now) || !latest.artifactIds.length || latest.artifactIds.some(id=>!id.trim())){reasons.push(`${kind}_evidence_missing_or_failed`);continue;}
    if(kind==="review" && (!latest.actorId.trim() || latest.actorId===candidate.builderId))reasons.push("independent_review_required");
    if(kind==="simulation" && (latest.syntheticData!==true || latest.externalServicesMocked!==true || !["mobile","desktop"].every(v=>latest.viewports?.includes(v)) || !project.journeys.every(j=>latest.journeyIds?.includes(j) && latest.baselineJourneyIds?.includes(j))))reasons.push("simulation_coverage_incomplete");
  }
  return gate(reasons);
}
export function releaseGate(project: FactoryProject, candidate: FactoryCandidate, evidence: FactoryEvidence[], now = Date.now()): FactoryGate {
  const reasons = [...projectReadiness(project).reasons];
  if (!project.automaticRelease) reasons.push("automatic_release_disabled");
  if (candidate.projectId !== project.id || !sha(candidate.headSha) || !sha(candidate.baseSha) || candidate.headSha === candidate.baseSha || !candidate.builderId.trim() || !new RegExp(`^https://github\\.com/${project.repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pull/[1-9][0-9]*$`).test(candidate.prUrl)) reasons.push("candidate_identity_invalid");
  if (candidate.risk !== "low" || !candidate.reversible || candidate.affectsContracts !== false || candidate.affectsData !== false || !candidate.changedFiles.length || candidate.changedFiles.some(p => p.includes("..") || protectedPath.test(p))) reasons.push("human_risk_decision_required");
  if (new Set(project.rehearsalRunIds.filter(Boolean)).size < FACTORY_POLICY.minimumRehearsals) reasons.push("three_rehearsals_required");
  if (!recent(project.rollbackVerifiedAt, now)) reasons.push("recovery_proof_missing_or_stale");
  for (const kind of ["tests", "simulation", "review"] as const) {
    const records = evidence.filter(e => e.kind === kind && e.projectId === project.id && e.headSha === candidate.headSha && e.baseSha === candidate.baseSha);
    const latest = records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (!latest || !latest.passed || latest.warnings.length || !recent(latest.createdAt, now) || !latest.artifactIds.length) { reasons.push(`${kind}_evidence_missing_or_failed`); continue; }
    if (kind === "review" && (!latest.actorId.trim() || latest.actorId === candidate.builderId)) reasons.push("independent_review_required");
    if (kind === "simulation" && (latest.syntheticData !== true || latest.externalServicesMocked !== true || !["mobile", "desktop"].every(v => latest.viewports?.includes(v)) || !project.journeys.every(j => latest.journeyIds?.includes(j) && latest.baselineJourneyIds?.includes(j)))) reasons.push("simulation_coverage_incomplete");
  }
  return gate(reasons);
}
/** Same evidence and risk requirements; isolated rehearsal cannot grant production authority. */
export function rehearsalGate(project: FactoryProject, candidate: FactoryCandidate, evidence: FactoryEvidence[], now = Date.now()): FactoryGate {
  return gate(releaseGate(project, candidate, evidence, now).reasons.filter(reason => !["automatic_release_disabled", "three_rehearsals_required", "recovery_proof_missing_or_stale"].includes(reason)));
}
function validateBudget(budget: FactoryBudget) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(budget.month) || ![budget.fixedCents, budget.spentCents, budget.reservedCents].every(x => Number.isSafeInteger(x) && x >= 0)) throw new Error("INVALID_FACTORY_BUDGET");
}
/** Must be applied under the same database transaction as task admission. */
export function reserveBudget(budget: FactoryBudget, amountCents: number): FactoryBudget {
  validateBudget(budget);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("INVALID_FACTORY_RESERVATION");
  if (budget.fixedCents + budget.spentCents + budget.reservedCents + amountCents > FACTORY_POLICY.monthlyLimitCents) throw new Error("FACTORY_BUDGET_EXHAUSTED");
  return { ...budget, reservedCents: budget.reservedCents + amountCents };
}
/** Unknown outcomes retain their reservation until actual usage is reconciled. */
export function settleBudget(budget: FactoryBudget, reservationCents: number, actualCents: number): FactoryBudget {
  validateBudget(budget);
  if (![reservationCents, actualCents].every(x => Number.isSafeInteger(x) && x >= 0) || reservationCents > budget.reservedCents) throw new Error("INVALID_FACTORY_SETTLEMENT");
  return { ...budget, reservedCents: budget.reservedCents - reservationCents, spentCents: budget.spentCents + actualCents };
}
export function canRepair(attempts: number) { return Number.isInteger(attempts) && attempts >= 0 && attempts < FACTORY_POLICY.maxRepairs; }
export interface LearningCase { id: string; partition: "historical" | "heldout"; baselineScore: number; candidateScore: number; baselineSafetyFailures: number; candidateSafetyFailures: number }
export function evaluateLearning(cases: LearningCase[], changesPolicy: boolean, costCents: number, availableCents: number): FactoryGate {
  const reasons: string[] = [];
  if (changesPolicy) reasons.push("immutable_policy_change");
  if (![costCents, availableCents].every(x => Number.isSafeInteger(x) && x >= 0) || costCents > availableCents) reasons.push("learning_budget_exceeded");
  if (!cases.length || new Set(cases.map(c => c.id)).size !== cases.length || cases.some(c => !c.id || ![c.baselineScore, c.candidateScore].every(x => Number.isFinite(x) && x >= 0 && x <= 1) || ![c.baselineSafetyFailures, c.candidateSafetyFailures].every(x => Number.isSafeInteger(x) && x >= 0))) reasons.push("invalid_learning_cases");
  for (const partition of ["historical", "heldout"] as const) {
    const group = cases.filter(c => c.partition === partition);
    if (!group.length || group.some(c => c.candidateScore < c.baselineScore || c.candidateSafetyFailures > c.baselineSafetyFailures) || !group.some(c => c.candidateScore > c.baselineScore)) reasons.push(`${partition}_improvement_unproven`);
  }
  return gate(reasons);
}
