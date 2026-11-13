import { createHash, randomUUID } from "node:crypto";
import { runOfficeClaude, type OfficeClaudeResult } from "./office-claude";
import { recordAcademyAssessment, type AcademyJob, type AcademyAssessment, type CompanyState, type CurriculumModule } from "../shared/agent-company";

import { REVIEW_BENCHMARK_TASKS, OFFICE_REVIEW_BENCHMARK_PROFILE_ID, OFFICE_REVIEW_BENCHMARK_PROFILE_VERSION, buildReviewBenchmarkPrompt, gradeReviewBenchmark } from "./office-review-benchmarks";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const academyCurriculumVersion = (modules: CurriculumModule[]) => JSON.stringify(modules.map(m => [m.id, m.title, m.summary]));

/** A real, read-only paired review. The scheduler persists reservation before calling this.
 * Fixtures prove only this narrow review capability, never production completion or general intelligence.
 */
export function createAcademyReviewRunner(options: { run?: (prompt: string, executionId?: string) => ReturnType<typeof runOfficeClaude>; now?: () => number } = {}) {
  const run = options.run || runOfficeClaude;
  const now = options.now || Date.now;
  return async (state: CompanyState, job: AcademyJob) => {
    if (job.status !== "running" || Date.parse(job.expiresAt) <= now()) throw new Error("ACADEMY_LEASE_EXPIRED");
    const trainee = state.trainees.find(t => t.id === job.traineeId);
    const career = trainee && state.careers[trainee.forAgentId];
    const fixture = REVIEW_BENCHMARK_TASKS.find(f => f.id === job.benchmarkId);
    if (!trainee || !career || career.generation !== job.generation || !fixture) throw new Error("ACADEMY_ASSIGNMENT_CHANGED");
    const startIncumbent = now();
    const incumbent = await run(buildReviewBenchmarkPrompt(fixture, career.reviewGuidance || []), `academy:${job.id}:incumbent`);
    const incumbentDurationMs = Math.max(1, now() - startIncumbent);
    if (Date.parse(job.expiresAt) <= now()) throw new Error("ACADEMY_LEASE_EXPIRED");
    const startCandidate = now();
    const candidate = await run(buildReviewBenchmarkPrompt(fixture, trainee.knowledge), `academy:${job.id}:candidate`);
    const durationMs = Math.max(1, now() - startCandidate);
    if (incumbent.sessionId === candidate.sessionId || !candidate.sessionId || !incumbent.sessionId) throw new Error("ACADEMY_UNVERIFIED_SESSIONS");
    if (incumbent.text.length > 16000 || candidate.text.length > 16000) throw new Error("ACADEMY_ARTIFACT_TOO_LARGE");
    const incumbentGrade = gradeReviewBenchmark(incumbent.text, fixture);
    const candidateGrade = gradeReviewBenchmark(candidate.text, fixture);
    const metadata = (result: OfficeClaudeResult) => result as OfficeClaudeResult & { provider?: string; model?: string; usage?: { totalTokens: number } };
    const usage = (result: OfficeClaudeResult) => metadata(result).usage;
    const api = !!usage(incumbent) || !!usage(candidate) || !!metadata(incumbent).provider || !!metadata(candidate).provider;
    if (api && ([incumbent, candidate].some(result => metadata(result).provider !== "openai" || !metadata(result).model?.trim() ||
        !usage(result) || !Number.isSafeInteger(usage(result)!.totalTokens) || usage(result)!.totalTokens < 0) || metadata(incumbent).model !== metadata(candidate).model)) throw new Error("ACADEMY_INCOMPARABLE_COST_BASIS");
    const cost = usage(candidate)?.totalTokens ?? 0;
    const incumbentCost = usage(incumbent)?.totalTokens ?? 0;
    const costBasis = api ? "measured_tokens_not_usd" as const : "subscription_no_incremental_api_charge" as const;
    const artifacts = { assignmentId: job.id, curriculumVersion: job.curriculumVersion, fixtureId: fixture.id,
      fixtureCode: JSON.stringify(fixture.cases), incumbentText: incumbent.text, candidateText: candidate.text,
      incumbentSessionId: incumbent.sessionId, candidateSessionId: candidate.sessionId,
      profileId: OFFICE_REVIEW_BENCHMARK_PROFILE_ID, profileVersion: OFFICE_REVIEW_BENCHMARK_PROFILE_VERSION,
      incumbentPolicyVersion: job.incumbentPolicyVersion, candidatePolicyVersion: job.candidatePolicyVersion,
      candidateMeasuredCost: cost, incumbentMeasuredCost: incumbentCost, candidateDurationMs: durationMs,
      incumbentDurationMs, costBasis, provider: api ? "openai" : "claude_subscription",
      incumbentModel: metadata(incumbent).model, candidateModel: metadata(candidate).model };
    return {
      scope: "benchmark" as const, profileId: OFFICE_REVIEW_BENCHMARK_PROFILE_ID, profileVersion: OFFICE_REVIEW_BENCHMARK_PROFILE_VERSION, runId: job.id, benchmarkId: fixture.id, curriculumVersion: job.curriculumVersion,
      completedAt: new Date(now()).toISOString(), artifactId: digest(JSON.stringify(artifacts)),
      passed: candidateGrade.errors === 0, quality: candidateGrade.quality, incumbentQuality: incumbentGrade.quality,
      errors: candidateGrade.errors, incumbentErrors: incumbentGrade.errors, durationMs, incumbentDurationMs,
      // API values are measured tokens, explicitly not dollar estimates.
      cost, incumbentCost, costBasis,
      artifacts,
    };
  };
}

export function reserveAcademyReview(state: CompanyState, modules: CurriculumModule[], now: number, id: string = randomUUID()): { state: CompanyState; job?: AcademyJob } {
  const jobs = (state.academyJobs || []).map(j => j.status === "running" && Date.parse(j.expiresAt) <= now ? { ...j, status: "unknown" as const, reason: "Execution lease expired; no automatic retry." } : j);
  let next = { ...state, academyJobs: jobs };
  if (!id.trim() || jobs.some(j => j.id === id)) return { state: next };
  if (jobs.some(j => j.reason === "INVALID_PERSISTED_ACADEMY_JOB")) return { state: next };
  if (!modules.length || jobs.some(j => j.status === "running") || jobs.some(j => now - Date.parse(j.startedAt) < 86400000)) return { state: next };

  for (const trainee of state.trainees.filter(t => !t.graduatedAt && !t.evaluationClosedAt)) {
    if (trainee.forAgentId !== "claude-reviewer") {
      next = { ...next, trainees: next.trainees.map(t => t.id === trainee.id ? { ...t, executionBlocker: "No verified training adapter is installed for this role." } : t) };
      continue;
    }
    const course = trainee.curriculumSnapshot || modules;
    const version = academyCurriculumVersion(course);
    const career = state.careers[trainee.forAgentId];
    if (!career || (trainee.generation !== undefined && career.generation !== trainee.generation) || course.some(m => !trainee.modulesDone.includes(m.id))) continue;
    if (jobs.some(j => j.traineeId === trainee.id && ["unknown", "blocked"].includes(j.status))) continue;
    const fixture = REVIEW_BENCHMARK_TASKS.find(f => !jobs.some(j => j.traineeId === trainee.id && j.curriculumVersion === version && j.benchmarkId === f.id));
    if (!fixture) continue;
    const job: AcademyJob = { id, traineeId: trainee.id, generation: career.generation, curriculumVersion: version, benchmarkId: fixture.id,
      startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 5 * 60000).toISOString(), status: "running" };
    return { state: { ...next, academyJobs: [...jobs, job] }, job };
  }
  return { state: next };
}

export function commitAcademyReview(state: CompanyState, job: AcademyJob, result: AcademyAssessment | undefined, now: number, reason?: string): CompanyState {
  const stored = state.academyJobs?.find(j => j.id === job.id);
  const trainee = state.trainees.find(t => t.id === job.traineeId);
  if (!stored || stored.status !== "running" || stored.incumbentPolicyVersion !== job.incumbentPolicyVersion || stored.candidatePolicyVersion !== job.candidatePolicyVersion || stored.curriculumVersion !== job.curriculumVersion || stored.traineeId !== job.traineeId || stored.generation !== job.generation || stored.benchmarkId !== job.benchmarkId || stored.startedAt !== job.startedAt || stored.expiresAt !== job.expiresAt || !trainee || state.careers[trainee.forAgentId]?.generation !== job.generation) return state;
  if (trainee.curriculumSnapshot && academyCurriculumVersion(trainee.curriculumSnapshot) !== job.curriculumVersion) return { ...state, academyJobs: state.academyJobs!.map(j => j.id === job.id ? { ...j, status: "blocked", reason: "Curriculum changed during execution." } : j) };
  if (Date.parse(stored.expiresAt) <= now) return { ...state, academyJobs: state.academyJobs!.map(j => j.id === job.id ? { ...j, status: "unknown", reason: "Execution exceeded its lease." } : j) };
  let next = state;
  const task = REVIEW_BENCHMARK_TASKS.find(t => t.id === job.benchmarkId);
  const artifacts = result?.artifacts;
  if (task && result && artifacts && result.scope === "benchmark" &&
      Number.isFinite(Date.parse(result.completedAt)) && Date.parse(result.completedAt) >= Date.parse(job.startedAt) && Date.parse(result.completedAt) <= now &&
      result.profileId === OFFICE_REVIEW_BENCHMARK_PROFILE_ID && result.profileVersion === OFFICE_REVIEW_BENCHMARK_PROFILE_VERSION &&
      artifacts.profileId === result.profileId && artifacts.profileVersion === result.profileVersion &&
      artifacts.assignmentId === job.id && artifacts.curriculumVersion === job.curriculumVersion && artifacts.fixtureId === job.benchmarkId &&
      artifacts.fixtureCode === JSON.stringify(task.cases) && artifacts.incumbentPolicyVersion === job.incumbentPolicyVersion && artifacts.candidatePolicyVersion === job.candidatePolicyVersion &&
      artifacts.candidateSessionId && artifacts.incumbentSessionId && artifacts.candidateSessionId !== artifacts.incumbentSessionId &&
      digest(JSON.stringify(artifacts)) === result.artifactId && result.runId === job.id && result.benchmarkId === job.benchmarkId && result.curriculumVersion === job.curriculumVersion &&
      artifacts.candidateMeasuredCost === result.cost && artifacts.incumbentMeasuredCost === result.incumbentCost &&
      artifacts.candidateDurationMs === result.durationMs && artifacts.incumbentDurationMs === result.incumbentDurationMs && artifacts.costBasis === result.costBasis &&
      (result.costBasis === "measured_tokens_not_usd" ? artifacts.provider === "openai" && Boolean(artifacts.candidateModel?.trim()) && artifacts.candidateModel === artifacts.incumbentModel :
        result.costBasis === "subscription_no_incremental_api_charge" && artifacts.provider === "claude_subscription" && result.cost === 0 && result.incumbentCost === 0)) {
    const candidateGrade = gradeReviewBenchmark(artifacts.candidateText, task);
    const incumbentGrade = gradeReviewBenchmark(artifacts.incumbentText, task);
    if (result.passed === candidateGrade.passed && result.quality === candidateGrade.quality && result.errors === candidateGrade.errors &&
        result.incumbentQuality === incumbentGrade.quality && result.incumbentErrors === incumbentGrade.errors) next = recordAcademyAssessment(next, job.traineeId, result);
  }
  const recorded = next.trainees.find(t => t.id === job.traineeId)?.assessments?.some(a => a.runId === job.id);
  return { ...next, academyJobs: next.academyJobs!.map(j => j.id === job.id ? { ...j, status: recorded ? "completed" : "blocked", ...(recorded ? {} : { reason: reason || "No verified result." }) } : j) };
}
