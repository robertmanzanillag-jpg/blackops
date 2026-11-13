import { canRepair, evaluateLearning, projectReadiness, proposalReadiness, proposalEvidenceGate, releaseGate, rehearsalGate, type FactoryCandidate, type FactoryEvidence, type FactoryProject, type LearningCase } from "./software-factory";
import { createHash } from "node:crypto";
import type { FactorySimulationInput, runFactorySimulation } from "./software-factory-simulator";
import type { AppQaFinding } from "./app-qa-agent";
import type { FactoryJob, FactoryJobInput } from "./software-factory-store";
import type { FactoryAdapter, FactoryAdapterResult, FactoryWorkerOptions } from "./software-factory-worker";

export interface FactoryPipelineState {
  version: 1; projectId: string; rootJobId: string; target: "staging" | "production";
  /** sourcePaths is the per-order file selection persisted at discovery; every
   * later build, repair, recovery and review reuses it and never re-selects. */
  finding: { id: string; kind: "bug" | "improvement"; regressionScenarioId?: string; request: string; baseSha: string; artifactIds: string[]; sourcePaths?: string[] };
  candidate?: FactoryCandidate; evidence: FactoryEvidence[]; repairAttempts: number;
  verification?: { healthy: boolean; headSha: string };
  rollback?: { healthy: boolean; restoredSha: string };
  deployment?: { id: string; headSha: string; target: "staging" | "production" };
}
interface StageContext { signal: AbortSignal; maxCostCents: number; source?: Readonly<Record<string, unknown>> }
interface Costed { costCents: number }
/** All callbacks are trusted control-plane functions, never loaded from app code or request data. */
export interface FactoryPipelineDependencies {
  executionMode?: "review-only";
  project(ownerKey: string, projectId: string): Promise<FactoryProject | undefined>;
  previous(ownerKey: string, jobId: string): Promise<FactoryJob | undefined>;
  recoveryPrevious?: (ownerKey: string, failedJobId: string, recoveryJobId: string) => Promise<FactoryJob | undefined>;
  isCurrentDeployment?: (ownerKey: string, projectId: string, deployJobId: string) => Promise<boolean>;
  claimFinding(ownerKey: string, projectId: string, key: string, jobId: string): Promise<boolean>;
  reservations: Record<FactoryJob["kind"], number>;
  /** status "blocked": terminal, known-cost stop (e.g. an invalid automatic file selection). */
  discover?: (project: FactoryProject, context: StageContext) => Promise<Costed & { status?: "blocked"; reason?: string; finding?: FactoryPipelineState["finding"]; findings?: FactoryPipelineState["finding"][] }>;
  build?: (project: FactoryProject, state: FactoryPipelineState, context: StageContext) => Promise<(Costed & { candidate: FactoryCandidate; tests: FactoryEvidence }) | { status: "blocked" | "failed" | "unknown"; costCents: number; reason?: string; deferUntil?: string }>;
  simulate?: (project: FactoryProject, state: FactoryPipelineState, context: StageContext) => Promise<Costed & { evidence: FactoryEvidence }>;
  review?: (project: FactoryProject, state: FactoryPipelineState, context: StageContext) => Promise<Costed & { evidence: FactoryEvidence }>;
  deploy?: (project: FactoryProject, state: FactoryPipelineState, context: StageContext) => Promise<Costed & { deployment: NonNullable<FactoryPipelineState["deployment"]> }>;
  verify?: (project: FactoryProject, state: FactoryPipelineState, context: StageContext) => Promise<Costed & { verification: NonNullable<FactoryPipelineState["verification"]> }>;
  rollback?: (project: FactoryProject, state: FactoryPipelineState, context: StageContext) => Promise<Costed & { rollback: NonNullable<FactoryPipelineState["rollback"]> }>;
  evaluate?: (project: FactoryProject, state: FactoryPipelineState, context: StageContext) => Promise<Costed & { cases: LearningCase[]; changesPolicy: boolean; proposedVersion?: string }>;
  promoteLearning?: (project: FactoryProject, version: string, context: StageContext) => Promise<void>;
  recordValidation?: (ownerKey: string, projectId: string, rollbackJobId: string) => Promise<void>;
  now?: () => Date;
}
const predecessors: Record<FactoryJob["kind"], FactoryJob["kind"][]> = { discover: [], build: ["discover", "simulate", "review"], simulate: ["build"], review: ["simulate"], deploy: ["review"], verify: ["deploy"], rollback: ["verify"], evaluate: ["verify", "rollback"] };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const validSha = (value: string) => /^[a-f0-9]{40,64}$/.test(value);
export function createFactoryPipeline(deps: FactoryPipelineDependencies): Pick<FactoryWorkerOptions, "adapters" | "releaseContext"> & { readiness(): { ready: boolean; missing: string[] } } {
  const now = deps.now || (() => new Date());
  const proposalOnly=deps.executionMode==="review-only";
  const enabledStages:FactoryJob["kind"][]=proposalOnly?["discover","build","simulate","review"]:Object.keys(predecessors) as FactoryJob["kind"][];
  const readiness = () => {
    const missing = enabledStages.filter(key => !deps[key]).map(String);
    if(!proposalOnly && !deps.recordValidation)missing.push("recordValidation");
    for (const kind of enabledStages) if (!Number.isSafeInteger(deps.reservations[kind]) || deps.reservations[kind] < 1 || deps.reservations[kind] > 10000) missing.push(`reservation:${kind}`);
    return { ready: !missing.length, missing };
  };
  const load = async (job: FactoryJob): Promise<{ state: FactoryPipelineState; previous: FactoryJob }> => {
    const id = job.payload.previousJobId;
    if (typeof id !== "string") throw new Error("FACTORY_PREDECESSOR_REQUIRED");
    if (proposalOnly && job.kind === "build" && job.key === `${id}.repair` && deps.recoveryPrevious) {
      const previous = await deps.recoveryPrevious(job.ownerKey,id,job.id);
      if (!previous || previous.status!=="failed" || previous.kind!=="build" || previous.ownerKey!==job.ownerKey || previous.projectId!==job.projectId) throw Error("FACTORY_RECOVERY_UNTRUSTED");
      const {recoverableFailedBuild}=await import('./software-factory-build-recovery');
      const state=recoverableFailedBuild(previous), marker=job.payload.recovery as any;
      if(job.payload.repairAttempts!==state.repairAttempts+1 || marker?.rebase?.originalBaseSha!==state.finding.baseSha || !/^[a-f0-9]{40}$/.test(marker?.rebase?.targetBaseSha||'')) throw Error("FACTORY_RECOVERY_UNTRUSTED");
      if(Array.isArray(state.finding.sourcePaths) && !state.finding.sourcePaths.every(p=>Array.isArray(marker.rebase.files) && marker.rebase.files.some((f:unknown)=>Array.isArray(f) && f[0]===p))) throw Error("FACTORY_RECOVERY_UNTRUSTED");
      state.finding.baseSha=marker.rebase.targetBaseSha;
      return {state,previous};
    }
    const previous = await deps.previous(job.ownerKey, id);
    if (!previous || previous.ownerKey !== job.ownerKey || previous.projectId !== job.projectId || previous.status !== "completed" || !predecessors[job.kind].includes(previous.kind)) throw new Error("FACTORY_CHAIN_UNTRUSTED");
    const recurring = job.key !== `${previous.id}.next`;
    if (recurring) {
      const prefix = `${previous.id}.health:`;
      const hour = job.key.startsWith(prefix) ? job.key.slice(prefix.length) : "";
      const timestamp = Date.parse(`${hour}:00:00Z`);
      if (job.kind !== "verify" || previous.kind !== "deploy" || !/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(hour) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 13) !== hour || typeof deps.isCurrentDeployment !== "function") throw new Error("FACTORY_CHAIN_UNTRUSTED");
    }
    const outcome = previous.result as FactoryAdapterResult | undefined;
    const state = clone((outcome?.evidence as { pipelineState?: FactoryPipelineState } | undefined)?.pipelineState);
    if (!state || state.version !== 1 || state.projectId !== job.projectId || !["staging", "production"].includes(state.target)) throw new Error("FACTORY_CONTEXT_MISSING");
    if (job.kind !== "build" && (!state.candidate || state.candidate.headSha !== job.headSha)) throw new Error("FACTORY_CONTEXT_VERSION_MISMATCH");
    if (recurring && (state.target !== "production" || !state.candidate || state.candidate.projectId !== job.projectId || !validSha(state.candidate.baseSha) || !validSha(state.candidate.headSha) || previous.headSha !== state.candidate.headSha || state.deployment?.target !== "production" || state.deployment.headSha !== state.candidate.headSha || !state.deployment.id || job.reservedCents < deps.reservations.verify + deps.reservations.rollback || job.recoveryCents < deps.reservations.rollback || !(await deps.isCurrentDeployment!(job.ownerKey, job.projectId, previous.id)))) throw new Error("FACTORY_HEALTH_DEPLOYMENT_UNVERIFIED");
    return { state, previous };
  };
  const next = (job: FactoryJob, kind: FactoryJob["kind"], state: FactoryPipelineState): FactoryJobInput => ({ key: `${job.id}.next`, projectId: job.projectId, kind, ...(kind !== "build" ? { headSha: state.candidate?.headSha } : {}), reservedCents: deps.reservations[kind] + (kind === "deploy" ? deps.reservations.verify + deps.reservations.rollback : kind === "verify" ? deps.reservations.rollback : 0), recoveryCents: kind === "deploy" ? deps.reservations.verify + deps.reservations.rollback : kind === "verify" ? deps.reservations.rollback : 0, payload: { previousJobId: job.id, repairAttempts: state.repairAttempts } });
  const result = (state: FactoryPipelineState, costCents: number, extra: Partial<FactoryAdapterResult> = {}): FactoryAdapterResult => ({ status: "completed", costCents, evidence: { pipelineState: state }, ...extra });
  const evidenceMatches = (state: FactoryPipelineState, evidence: FactoryEvidence, kind: FactoryEvidence["kind"]) => !!state.candidate && evidence.kind === kind && evidence.projectId === state.projectId && evidence.headSha === state.candidate.headSha && evidence.baseSha === state.candidate.baseSha;
  const adapters: Partial<Record<FactoryJob["kind"], FactoryAdapter>> = {};
  for (const kind of enabledStages) adapters[kind] = { async execute(job, context) {
    context.signal.throwIfAborted();
    if (job.kind !== kind) return { status: "blocked", costCents: 0, reason: "FACTORY_STAGE_MISMATCH" };
    const missing = readiness().missing;
    if (missing.length) return { status: "blocked", costCents: 0, reason: `FACTORY_PIPELINE_UNAVAILABLE:${missing.join(",")}` };
    const project = await deps.project(job.ownerKey, job.projectId);
    if (!project) return { status: "blocked", costCents: 0, reason: "FACTORY_PROJECT_UNREGISTERED" };
    const projectGate=(proposalOnly?proposalReadiness:projectReadiness)(project);
    if (!projectGate.allowed) return { status: "blocked", costCents: 0, reason: projectGate.reasons.join(",") };
    const checkCost = (cost: number) => { if (!Number.isSafeInteger(cost) || cost < 0 || cost > context.maxCostCents) throw new Error("FACTORY_STAGE_BILLING_UNCONFIRMED"); };
    if (kind === "discover") {
      const found = await deps.discover!(clone(project), { ...context, source: clone(job.payload) }); checkCost(found.costCents);
      if (found.status === "blocked") return { status: "blocked", costCents: found.costCents, reason: typeof found.reason === "string" && found.reason ? found.reason : "FACTORY_DISCOVERY_BLOCKED" };
      if (found.status !== undefined) throw new Error("FACTORY_DISCOVERY_RESULT_INVALID");
      const findings = found.findings ?? (found.finding ? [found.finding] : []);
      if (!findings.length) return { status: "completed", costCents: found.costCents, reason: "FACTORY_NO_ACTIONABLE_FINDING" };
      let selected: FactoryPipelineState["finding"] | undefined;
      for (const finding of findings) {
        if (!validSha(finding.baseSha) || !finding.id || !finding.request.trim() || !finding.artifactIds.length) throw new Error("FACTORY_FINDING_UNVERIFIED");
        if (!["bug", "improvement"].includes(finding.kind) || (finding.kind === "bug" && !finding.regressionScenarioId?.trim())) throw new Error("FACTORY_REPRODUCTION_REQUIRED");
        if (finding.sourcePaths !== undefined && (!Array.isArray(finding.sourcePaths) || !finding.sourcePaths.length || finding.sourcePaths.length > 64 || finding.sourcePaths.some(p => typeof p !== "string" || !p))) throw new Error("FACTORY_FINDING_PATHS_INVALID");
        const findingKey = createHash("sha256").update(JSON.stringify([project.id, finding.baseSha, finding.id])).digest("hex");
        if (await deps.claimFinding(job.ownerKey, project.id, findingKey, job.id)) { selected = finding; break; }
      }
      if (!selected) return { status: "completed", costCents: found.costCents, reason: "FACTORY_FINDING_ALREADY_TRACKED" };
      const state: FactoryPipelineState = { version: 1, projectId: project.id, rootJobId: job.id, target: project.automaticRelease ? "production" : "staging", finding: selected, evidence: [], repairAttempts: 0 };
      return result(state, found.costCents, { next: next(job, "build", state) });
    }
    const { state, previous } = await load(job);
    if (kind === "build") {
      if (previous.kind !== "discover") { if (!canRepair(state.repairAttempts)) return result(state, 0, { status: "blocked", reason: "FACTORY_REPAIR_LIMIT" }); state.repairAttempts++; }
      const built = await deps.build!(clone(project), clone(state), context); checkCost(built.costCents);
      if ("status" in built) return result(state, built.costCents, { status: built.status, reason: built.reason, ...(built.status === "blocked" && built.costCents === 0 && typeof built.deferUntil === "string" ? { deferUntil: built.deferUntil } : {}) });
      if (built.candidate.projectId !== project.id || built.candidate.baseSha !== state.finding.baseSha || !validSha(built.candidate.headSha)) throw new Error("FACTORY_BUILD_IDENTITY_INVALID");
      state.candidate = { ...built.candidate, repairAttempts: state.repairAttempts }; state.evidence = [built.tests];
      if (!evidenceMatches(state, built.tests, "tests") || !built.tests.passed || built.tests.warnings.length) return result(state, built.costCents, { status: "blocked", reason: "FACTORY_BUILD_CHECKS_FAILED" });
      if ((state.finding.kind === "bug" || state.finding.regressionScenarioId) && (!built.tests.journeyIds?.includes(state.finding.regressionScenarioId!) || !built.candidate.changedFiles.some(p => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(p)))) return result(state, built.costCents, { status: "blocked", reason: "FACTORY_PERMANENT_REGRESSION_TEST_REQUIRED" });
      return result(state, built.costCents, { next: next(job, "simulate", state) });
    }
    if (kind === "simulate" || kind === "review") {
      const checked = await (kind === "simulate" ? deps.simulate! : deps.review!)(clone(project), clone(state), context); checkCost(checked.costCents);
      if (!evidenceMatches(state, checked.evidence, kind === "simulate" ? "simulation" : "review")) throw new Error("FACTORY_EVIDENCE_IDENTITY_MISMATCH");
      state.evidence.push(checked.evidence);
      if (!checked.evidence.passed || checked.evidence.warnings.length) return result(state, checked.costCents, canRepair(state.repairAttempts) ? { next: next(job, "build", state), reason: "FACTORY_REPAIR_REQUESTED" } : { status: "blocked", reason: "FACTORY_REPAIR_LIMIT" });
      if(proposalOnly && kind==="review"){
        const gate=proposalEvidenceGate(project,state.candidate!,state.evidence,now().getTime());
        return result(state,checked.costCents,gate.allowed?{reason:"FACTORY_PR_REVIEWED_NOT_DEPLOYED"}:{status:"blocked",reason:gate.reasons.join(",")});
      }
      return result(state, checked.costCents, { next: next(job, kind === "simulate" ? "review" : "deploy", state) });
    }
    if (kind === "deploy") {
      const gate = (state.target === "production" ? releaseGate : rehearsalGate)(project, state.candidate!, state.evidence, now().getTime());
      if (!gate.allowed) return result(state, 0, { status: "blocked", reason: gate.reasons.join(",") });
      const deployed = await deps.deploy!(clone(project), clone(state), context); checkCost(deployed.costCents);
      if (deployed.deployment.headSha !== state.candidate!.headSha || deployed.deployment.target !== state.target || !deployed.deployment.id) throw new Error("FACTORY_DEPLOYMENT_UNCONFIRMED");
      state.deployment = deployed.deployment;
      return result(state, deployed.costCents, { next: next(job, "verify", state) });
    }
    if (kind === "verify") {
      const verified = await deps.verify!(clone(project), clone(state), context); checkCost(verified.costCents);
      state.verification = verified.verification;
      const healthy = verified.verification.healthy && verified.verification.headSha === state.candidate!.headSha;
      if (healthy && job.key !== `${previous.id}.next`) return result(state, verified.costCents);
      return result(state, verified.costCents, { next: next(job, !healthy || state.target === "staging" ? "rollback" : "evaluate", state), ...(!healthy ? { reason: "FACTORY_REGRESSION_RECOVERY" } : {}) });
    }
    if (kind === "rollback") {
      const restored = await deps.rollback!(clone(project), clone(state), context); checkCost(restored.costCents); state.rollback = restored.rollback;
      if (!restored.rollback.healthy || restored.rollback.restoredSha !== state.candidate!.baseSha) return result(state, restored.costCents, { status: "blocked", reason: "FACTORY_RECOVERY_UNVERIFIED" });
      if (state.target === "production" && previous.kind === "verify" && typeof previous.payload.previousJobId === "string" && previous.key.startsWith(`${previous.payload.previousJobId}.health:`)) return result(state, restored.costCents);
      return result(state, restored.costCents, { next: next(job, "evaluate", state) });
    }
    if (state.target === "staging" && state.verification?.healthy && state.verification.headSha === state.candidate!.headSha && state.rollback?.healthy && state.rollback.restoredSha === state.candidate!.baseSha) await deps.recordValidation!(job.ownerKey, project.id, previous.id);
    const evaluated = await deps.evaluate!(clone(project), clone(state), context); checkCost(evaluated.costCents);
    const assessment = evaluateLearning(evaluated.cases, evaluated.changesPolicy, evaluated.costCents, context.maxCostCents);
    if (assessment.allowed && evaluated.proposedVersion) {
      if (!deps.promoteLearning) return result(state, evaluated.costCents, { reason: "FACTORY_LEARNING_PROMOTION_UNAVAILABLE" });
      await deps.promoteLearning(clone(project), evaluated.proposedVersion, context);
    }
    return { ...result(state, evaluated.costCents), evidence: { pipelineState: state, learning: assessment }, ...(!assessment.allowed ? { reason: assessment.reasons.join(",") } : {}) };
  } };
  return { adapters, readiness, async releaseContext(job) { const { state } = await load(job); const project = await deps.project(job.ownerKey, job.projectId); if (!project || !state.candidate) throw new Error("FACTORY_RELEASE_CONTEXT_UNAVAILABLE"); return { project, candidate: state.candidate, evidence: state.evidence, target: state.target, recoveryBudget: { verifyCents: deps.reservations.verify, rollbackCents: deps.reservations.rollback } }; } };
}

/** Connects the browser runner to fixtures created and attested by the trusted
 * deployment controller. Browser inputs never choose origins or source SHAs. */
export function createPipelineSimulator(options: {
  launch: (project: FactoryProject, state: FactoryPipelineState, context: StageContext) => Promise<{
    input: FactorySimulationInput;
    attestation: { baseSha: string; headSha: string; isolated: boolean; productionSecretsAbsent: boolean; outboundNetworkBlocked: boolean };
    close(): Promise<void>;
  }>;
  run: typeof runFactorySimulation;
  artifactRoot: string;
  executablePath?: string;
}): NonNullable<FactoryPipelineDependencies["simulate"]> {
  return async (project, state, context) => {
    const fixture = await options.launch(project, state, context);
    try {
      const a = fixture.attestation, candidate = state.candidate;
      if (!candidate || !a.isolated || !a.productionSecretsAbsent || !a.outboundNetworkBlocked || a.baseSha !== candidate.baseSha || a.headSha !== candidate.headSha || fixture.input.projectId !== project.id || fixture.input.baseline.headSha !== a.baseSha || fixture.input.candidate.headSha !== a.headSha) throw new Error("FACTORY_FIXTURE_ATTESTATION_REQUIRED");
      const report = await options.run(fixture.input, { artifactRoot: options.artifactRoot, executablePath: options.executablePath, signal: context.signal });
      if (report.projectId !== project.id || report.baseline.headSha !== a.baseSha || report.candidate.headSha !== a.headSha) throw new Error("FACTORY_SIMULATION_VERSION_MISMATCH");
      return { costCents: 0, evidence: { kind: "simulation", projectId: project.id, headSha: a.headSha, baseSha: a.baseSha, actorId: "isolated-browser-simulator", passed: report.passed, warnings: report.regressions, createdAt: report.createdAt, artifactIds: [report.evidenceSha256, ...report.candidate.cases.map(c => c.screenshotSha256)], journeyIds: report.candidate.cases.map(c => c.scenarioId), baselineJourneyIds: report.baseline.cases.map(c => c.scenarioId), viewports: [...new Set(report.candidate.cases.map(c => c.viewport))], syntheticData: true, externalServicesMocked: true } };
    } finally { await fixture.close(); }
  };
}

/** Reuses App QA's findings, with a trusted per-project snapshot and reproducible
 * scenarios; no new scouting agent and no outbound notification side effects. */
export function createAppQaFactoryDiscovery(options: {
  snapshot(project: FactoryProject, context: StageContext): Promise<{ projectId: string; baseSha: string; artifactId: string; costCents: number; findings: AppQaFinding[] }>;
  reproduction(project: FactoryProject, finding: AppQaFinding): Promise<string | undefined>;
}): NonNullable<FactoryPipelineDependencies["discover"]> {
  return async (project, context) => {
    const snapshot = await options.snapshot(project, context);
    if (snapshot.projectId !== project.id || !validSha(snapshot.baseSha) || !snapshot.artifactId) throw new Error("FACTORY_QA_SNAPSHOT_UNVERIFIED");
    const priority = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const findings: FactoryPipelineState["finding"][] = [];
    for (const finding of [...snapshot.findings].sort((a, b) => priority[a.severity] - priority[b.severity] || a.id.localeCompare(b.id))) {
      const kind = finding.sourceAgent === "improvement-scout" ? "improvement" : "bug";
      const regressionScenarioId = await options.reproduction(project, finding);
      if (kind === "bug" && !regressionScenarioId) continue;
      findings.push({ id: finding.id, kind, regressionScenarioId, baseSha: snapshot.baseSha, artifactIds: [snapshot.artifactId], request: `${finding.title}\n${finding.detail}\n${finding.recommendation}` });
    }
    return { costCents: snapshot.costCents, finding: findings[0], findings };
  };
}
