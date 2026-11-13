import test from "node:test";
import assert from "node:assert/strict";
import { academyArtifactDigest, evaluateAcademyBenchmark, reconcileRecordedAcademyBenchmarks, type AcademyBenchmarkExecution, type AcademyBenchmarkManifest } from "../server/office-academy-benchmarks.ts";
import { emptyCompanyState, advanceCompany, enrollTrainee, parseCompanyState } from "../shared/agent-company.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const prUrl = "https://github.com/example/app/pull/12";
const manifest: AcademyBenchmarkManifest = {
  id: "review-fixture-1", curriculumVersion: "rules-v1", fixtureDigest: "a".repeat(64), kind: "claude_review",
  prUrl, headSha: "b".repeat(40), diffSha256: "c".repeat(64), expectedVerdict: "block", expectedFindings: ["Missing ownership check"],
};
function execution(subjectId: string, id: string, correct: boolean): AcademyBenchmarkExecution {
  const result = { status: "completed" as const, text: "Recorded fixture review", review: {
    prUrl, headSha: "b".repeat(40), diffSha256: "c".repeat(64), verdict: correct ? "block" as const : "pass" as const,
    summary: "Fixture review", findings: correct ? ["Missing ownership check"] : [],
  } };
  return {
    assignment: { runId: id, subjectId, generation: 1, benchmarkId: manifest.id, curriculumVersion: manifest.curriculumVersion,
      fixtureDigest: manifest.fixtureDigest, resultDigest: academyArtifactDigest(result) },
    run: { id, key: id, kind: "claude_review", status: "completed", prUrl, createdAt: new Date(NOW - 2000).toISOString(),
      startedAt: new Date(NOW - 1000).toISOString(), completedAt: new Date(NOW).toISOString(), result },
    usage: { runId: id, ledgerId: `ledger-${id}`, costUsd: 0 },
  };
}
function input() {
  return { manifest: manifest as AcademyBenchmarkManifest, traineeId: "candidate-1", agentId: "reviewer", generation: 1,
    enrolledAt: new Date(NOW - 3000).toISOString(), now: NOW,
    incumbent: execution("reviewer#1", "incumbent-run", false), candidate: execution("candidate-1", "candidate-run", true) };
}
test("computes fixture accuracy from structured findings and measured usage", () => {
  const result = evaluateAcademyBenchmark(input());
  assert.equal(result.status, "evaluated");
  if (result.status !== "evaluated") return;
  assert.equal(result.assessment.quality, 100);
  assert.equal(result.assessment.incumbentQuality, 0);
  assert.equal(result.assessment.errors, 0);
  assert.equal(result.assessment.durationMs, 1000);
  assert.equal(result.assessment.cost, 0);
});
test("missing cost cannot be inferred from subscription or run text", () => {
  const value = input(); delete value.candidate.usage;
  assert.deepEqual(evaluateAcademyBenchmark(value), { status: "blocked", reason: "MEASURED_COST_UNAVAILABLE" });
});
test("rejects wrong candidate identity, generation, rubric, fixture and same run", () => {
  for (const change of [
    (x: ReturnType<typeof input>) => { x.candidate.assignment.subjectId = "other"; },
    (x: ReturnType<typeof input>) => { x.candidate.assignment.generation = 2; },
    (x: ReturnType<typeof input>) => { x.candidate.assignment.curriculumVersion = "old"; },
    (x: ReturnType<typeof input>) => { x.candidate.assignment.fixtureDigest = "d".repeat(64); },
    (x: ReturnType<typeof input>) => { x.candidate.run.id = x.incumbent.run.id; },
  ]) { const value = input(); change(value); assert.equal(evaluateAcademyBenchmark(value).status, "blocked"); }
});
test("rejects modified results even when status still says completed", () => {
  const value = input(); value.candidate.run.result!.text = "Modified after recording";
  assert.deepEqual(evaluateAcademyBenchmark(value), { status: "blocked", reason: "RESULT_DIGEST_MISMATCH" });
});
test("rejects stale, future, pre-enrollment and reversed execution timestamps", () => {
  for (const [start, end] of [[NOW - 4000, NOW], [NOW - 1000, NOW + 1], [NOW, NOW - 1], [NOW - 8*86400000, NOW - 8*86400000 + 1]]) {
    const value = input(); value.candidate.run.startedAt = new Date(start).toISOString(); value.candidate.run.completedAt = new Date(end).toISOString();
    assert.equal(evaluateAcademyBenchmark(value).status, "blocked");
  }
});
test("head changes are blocked and wrong findings produce failed assessment", () => {
  const value = input(); value.candidate.run.result!.review!.headSha = "f".repeat(40);
  value.candidate.assignment.resultDigest = academyArtifactDigest(value.candidate.run.result);
  assert.deepEqual(evaluateAcademyBenchmark(value), { status: "blocked", reason: "REVIEW_CONTEXT_MISMATCH" });
  const incorrect = input(); incorrect.candidate = execution("candidate-1", "candidate-run", false);
  const result = evaluateAcademyBenchmark(incorrect);
  assert.equal(result.status, "evaluated");
  if (result.status === "evaluated") assert.equal(result.assessment.passed, false);
});
test("canonical digest is independent of object property insertion order", () => {
  assert.equal(academyArtifactDigest({ a: 1, b: { c: 2, d: 3 } }), academyArtifactDigest({ b: { d: 3, c: 2 }, a: 1 }));
});
test("KONG evaluates immutable fixtures, not availability or prose", () => {
  const value = input();
  const evidence = { cities: ["miami"], errors: [] };
  value.manifest = { id: manifest.id, curriculumVersion: manifest.curriculumVersion, fixtureDigest: manifest.fixtureDigest,
    kind: "kong_audit", expectedEvidenceDigest: academyArtifactDigest(evidence) };
  for (const item of [value.incumbent, value.candidate]) {
    item.run.kind = "kong_audit";
    item.run.result = { status: "completed", text: "Fixture audit", evidence: item === value.candidate ? evidence : { cities: [], errors: [] } };
    item.assignment.resultDigest = academyArtifactDigest(item.run.result);
  }
  const result = evaluateAcademyBenchmark(value);
  assert.equal(result.status, "evaluated");
  if (result.status === "evaluated") { assert.equal(result.assessment.quality, 100); assert.equal(result.assessment.incumbentQuality, 0); }
});
test("reconciles trusted packets into company state once and rejects stale generations", () => {
  let state = advanceCompany(emptyCompanyState(), { now: NOW - 5000, statuses: { reviewer: { state: "working", label: "working" } }, roles: { reviewer: "Reviewer" } }).state;
  state = enrollTrainee(state, { id: "candidate-1", forAgentId: "reviewer", role: "Reviewer", now: NOW - 3000 });
  const packet = input();
  const first = reconcileRecordedAcademyBenchmarks(state, [packet], NOW);
  assert.equal(first.results[0].status, "recorded");
  state = parseCompanyState(JSON.parse(JSON.stringify(first.state)));
  assert.equal(reconcileRecordedAcademyBenchmarks(state, [packet], NOW).results[0].status, "duplicate");
  assert.equal(state.trainees[0].assessments?.length, 1);
  state.careers.reviewer.generation = 2;
  assert.equal(reconcileRecordedAcademyBenchmarks(state, [packet], NOW).results[0].status, "blocked");
});
