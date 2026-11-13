import { createHash } from "node:crypto";
import { recordAcademyAssessment, type AcademyAssessment, type CompanyState } from "../shared/agent-company.ts";
import type { OfficeCloudRun } from "./office-cloud-store";

/** Server-only protocol. Assignments, manifests and usage records come from trusted
 * storage, never a browser/model response. The evaluator does not execute work or
 * grant permissions. A live health snapshot is not a candidate benchmark. */
export interface AcademyBenchmarkAssignment {
  runId: string;
  subjectId: string;
  generation: number;
  benchmarkId: string;
  curriculumVersion: string;
  fixtureDigest: string;
  resultDigest: string;
}
export interface AcademyUsageRecord {
  runId: string;
  ledgerId: string;
  costUsd: number;
}
export type AcademyBenchmarkManifest = {
  id: string;
  curriculumVersion: string;
  fixtureDigest: string;
} & ({
  kind: "claude_review";
  prUrl: string;
  headSha: string;
  diffSha256: string;
  expectedVerdict: "pass" | "block";
  expectedFindings: string[];
} | {
  kind: "kong_audit";
  expectedEvidenceDigest: string;
});
export interface AcademyBenchmarkExecution {
  assignment: AcademyBenchmarkAssignment;
  run: OfficeCloudRun;
  usage?: AcademyUsageRecord;
}
export type AcademyBenchmarkEvaluation =
  | { status: "blocked"; reason: string }
  | { status: "evaluated"; assessment: AcademyAssessment };

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
export function academyArtifactDigest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
const digest = (value: string) => /^[a-f0-9]{64}$/.test(value);
const nonempty = (value: string) => typeof value === "string" && value.trim().length > 0;

/** Scores fixture accuracy only, not general intelligence or future productivity.
 * All output metrics are computed from structured recorded results and ledger data. */
export function evaluateAcademyBenchmark(input: {
  manifest: AcademyBenchmarkManifest;
  traineeId: string;
  agentId: string;
  generation: number;
  enrolledAt: string;
  now: number;
  incumbent: AcademyBenchmarkExecution;
  candidate: AcademyBenchmarkExecution;
}): AcademyBenchmarkEvaluation {
  const { manifest, incumbent, candidate } = input;
  const blocked = (reason: string): AcademyBenchmarkEvaluation => ({ status: "blocked", reason });
  if (!nonempty(manifest.id) || !nonempty(manifest.curriculumVersion) || !digest(manifest.fixtureDigest) ||
      !nonempty(input.traineeId) || !nonempty(input.agentId) || !Number.isSafeInteger(input.generation) || input.generation < 1 ||
      !Number.isFinite(input.now) || !Number.isFinite(Date.parse(input.enrolledAt))) return blocked("INVALID_BENCHMARK_CONTEXT");
  if (incumbent.run.id === candidate.run.id) return blocked("SAME_RUN_CANNOT_COMPARE_SUBJECTS");
  if (manifest.kind === "claude_review" && (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*$/.test(manifest.prUrl) ||
      !/^[a-f0-9]{40,64}$/.test(manifest.headSha) || !digest(manifest.diffSha256) ||
      !["pass", "block"].includes(manifest.expectedVerdict) || !Array.isArray(manifest.expectedFindings) ||
      !manifest.expectedFindings.every(nonempty) || new Set(manifest.expectedFindings).size !== manifest.expectedFindings.length)) return blocked("INVALID_REVIEW_RUBRIC");
  if (manifest.kind === "kong_audit" && !digest(manifest.expectedEvidenceDigest)) return blocked("INVALID_KONG_RUBRIC");
  if (!["claude_review", "kong_audit"].includes(manifest.kind)) return blocked("UNSUPPORTED_BENCHMARK_KIND");

  const scores: Array<{ quality: number; errors: number; durationMs: number; cost: number }> = [];
  for (const [execution, subject] of [[incumbent, `${input.agentId}#${input.generation}`], [candidate, input.traineeId]] as const) {
    const { assignment, run, usage } = execution;
    if (assignment.subjectId !== subject || assignment.generation !== input.generation || assignment.runId !== run.id ||
        assignment.benchmarkId !== manifest.id || assignment.curriculumVersion !== manifest.curriculumVersion ||
        assignment.fixtureDigest !== manifest.fixtureDigest) return blocked("ASSIGNMENT_MISMATCH");
    if (run.kind !== manifest.kind || run.status !== "completed" || run.result?.status !== "completed" ||
        !run.result.text?.trim() || run.result.error) return blocked("RUN_NOT_VERIFIABLY_COMPLETED");
    if (!digest(assignment.resultDigest) || assignment.resultDigest !== academyArtifactDigest(run.result)) return blocked("RESULT_DIGEST_MISMATCH");
    const start = Date.parse(run.startedAt || "");
    const end = Date.parse(run.completedAt || "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < Date.parse(input.enrolledAt) || end < start || end > input.now ||
        input.now - end > 7 * 86400000) return blocked("INVALID_OR_STALE_EXECUTION_TIME");
    if (!usage || usage.runId !== run.id || !nonempty(usage.ledgerId) || !Number.isFinite(usage.costUsd) || usage.costUsd < 0) return blocked("MEASURED_COST_UNAVAILABLE");
    let errors: number;
    let checks: number;
    if (manifest.kind === "claude_review") {
      const review = run.result.review;
      if (!review || run.prUrl !== manifest.prUrl || review.prUrl !== manifest.prUrl || review.headSha !== manifest.headSha ||
          review.diffSha256 !== manifest.diffSha256 || !Array.isArray(review.findings) || !review.findings.every(nonempty)) return blocked("REVIEW_CONTEXT_MISMATCH");
      const actual = new Set(review.findings);
      const expected = new Set(manifest.expectedFindings);
      errors = Number(review.verdict !== manifest.expectedVerdict) + review.findings.length - actual.size +
        [...expected].filter(f => !actual.has(f)).length + [...actual].filter(f => !expected.has(f)).length;
      checks = 1 + expected.size;
    } else {
      if (!run.result.evidence || typeof run.result.evidence !== "object") return blocked("KONG_ARTIFACT_UNAVAILABLE");
      errors = Number(academyArtifactDigest(run.result.evidence) !== manifest.expectedEvidenceDigest);
      checks = 1;
    }
    scores.push({ quality: Math.max(0, Math.round(100 * (checks - errors) / checks)), errors, durationMs: end - start, cost: usage.costUsd });
  }
  const [baseline, challenger] = scores;
  return { status: "evaluated", assessment: {
    runId: candidate.run.id,
    benchmarkId: manifest.id,
    curriculumVersion: manifest.curriculumVersion,
    completedAt: candidate.run.completedAt!,
    artifactId: `sha256:${candidate.assignment.resultDigest}`,
    passed: challenger.errors === 0,
    quality: challenger.quality,
    incumbentQuality: baseline.quality,
    errors: challenger.errors,
    incumbentErrors: baseline.errors,
    durationMs: challenger.durationMs,
    incumbentDurationMs: baseline.durationMs,
    cost: challenger.cost,
    incumbentCost: baseline.cost,
  } };
}

export interface RecordedAcademyBenchmark {
  traineeId: string;
  manifest: AcademyBenchmarkManifest;
  incumbent: AcademyBenchmarkExecution;
  candidate: AcademyBenchmarkExecution;
}

/** Called inside the council's owner-scoped persistence transaction after loading
 * immutable assignments, runtime artifacts and usage from server storage. There is
 * intentionally no HTTP endpoint accepting supplied grades or benchmark packets. */
export function reconcileRecordedAcademyBenchmarks(state: CompanyState, packets: RecordedAcademyBenchmark[], now: number) {
  let next = state;
  const results: Array<{ traineeId: string; status: "blocked" | "recorded" | "duplicate"; reason?: string }> = [];
  for (const packet of packets.slice(0, 100)) {
    const trainee = next.trainees.find(t => t.id === packet.traineeId && !t.graduatedAt);
    const career = trainee && next.careers[trainee.forAgentId];
    if (!trainee || !career || (trainee.generation !== undefined && trainee.generation !== career.generation)) {
      results.push({ traineeId: packet.traineeId, status: "blocked", reason: "TRAINEE_GENERATION_UNAVAILABLE" });
      continue;
    }
    const evaluation = evaluateAcademyBenchmark({ ...packet, agentId: trainee.forAgentId, generation: career.generation,
      enrolledAt: trainee.startedAt, now });
    if (evaluation.status === "blocked") {
      results.push({ traineeId: packet.traineeId, status: "blocked", reason: evaluation.reason });
      continue;
    }
    const updated = recordAcademyAssessment(next, trainee.id, evaluation.assessment);
    results.push({ traineeId: trainee.id, status: updated === next ? "duplicate" : "recorded" });
    next = updated;
  }
  return { state: next, results };
}
