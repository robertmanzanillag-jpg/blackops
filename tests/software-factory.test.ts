import test from "node:test";
import assert from "node:assert/strict";
import { releaseGate, reserveBudget, settleBudget, canRepair, evaluateLearning, FACTORY_POLICY, type FactoryProject, type FactoryCandidate, type FactoryEvidence } from "../server/software-factory";
const now = Date.parse("2026-11-06T12:00:00Z");
const project: FactoryProject = { id: "office", repo: "owner/office", testCommand: "npm test", buildCommand: "npm run build", stagingUrl: "https://test.example.com", productionUrl: "https://example.com", healthUrl: "https://example.com/health", rollbackCommand: "restore", journeys: ["navigation", "form"], automaticRelease: true, providerSupportsRelease: true, providerSupportsRollback: true, rehearsalRunIds: ["1", "2", "3"], rollbackVerifiedAt: new Date(now).toISOString() };
const candidate: FactoryCandidate = { projectId: "office", headSha: "a".repeat(40), baseSha: "b".repeat(40), prUrl: "https://github.com/owner/office/pull/1", builderId: "builder", risk: "low", reversible: true, changedFiles: ["client/src/components/button.tsx"], affectsContracts: false, affectsData: false, repairAttempts: 0 };
const evidence: FactoryEvidence[] = ["tests", "simulation", "review"].map(kind => ({ projectId: "office", headSha: candidate.headSha, baseSha: candidate.baseSha, kind: kind as FactoryEvidence["kind"], passed: true, warnings: [], createdAt: new Date(now).toISOString(), actorId: "checker", artifactIds: ["artifact"], journeyIds: project.journeys, baselineJourneyIds: project.journeys, viewports: ["mobile", "desktop"], syntheticData: true, externalServicesMocked: true }));
test("verified reversible change passes only after rehearsal and recovery", () => {
  assert.equal(releaseGate(project, candidate, evidence, now).allowed, true);
  for (const changes of [{ rehearsalRunIds: ["1", "1", "2"] }, { rollbackVerifiedAt: undefined }, { providerSupportsRollback: false }, { stagingUrl: project.productionUrl }]) assert.equal(releaseGate({ ...project, ...changes }, candidate, evidence, now).allowed, false);
});
test("missing, stale, wrong-version, failed and self-reviewed evidence blocks", () => {
  assert.equal(releaseGate(project, candidate, [], now).allowed, false);
  for (const changes of [{ headSha: "c".repeat(40) }, { baseSha: "c".repeat(40) }, { passed: false }, { warnings: ["warning"] }, { actorId: "builder" }, { createdAt: "2020-01-01T00:00:00Z" }, { artifactIds: [] }]) assert.equal(releaseGate(project, candidate, evidence.map(e => ({ ...e, ...changes })), now).allowed, false);
});
test("fresh failed rerun overrides previous pass", () => {
  assert.equal(releaseGate(project, candidate, [...evidence, { ...evidence[0], passed: false, createdAt: new Date(now + 1).toISOString() }], now + 1).allowed, false);
});
test("unknown risk and protected files cannot auto-release", () => {
  for (const file of ["server/auth.ts", "package.json", "server/software-factory.ts", "AGENTS.md", ".env", "migrations/001.sql", "../escape"]) assert.equal(releaseGate(project, { ...candidate, changedFiles: [file] }, evidence, now).allowed, false);
  assert.equal(releaseGate(project, { ...candidate, risk: "unknown" }, evidence, now).allowed, false);
  assert.equal(releaseGate(project, { ...candidate, prUrl: "https://github.com/attacker/repo/pull/1" }, evidence, now).allowed, false);
});
test("simulation requires both versions, both devices and synthetic integrations", () => {
  for (const changes of [{ baselineJourneyIds: [] }, { viewports: ["desktop"] }, { externalServicesMocked: false }, { syntheticData: false }]) assert.equal(releaseGate(project, candidate, evidence.map(e => e.kind === "simulation" ? { ...e, ...changes } : e), now).allowed, false);
});
test("budget includes fixed costs and reservations; settlement preserves overrun truth", () => {
  const original = { month: "2026-11", fixedCents: 2000, spentCents: 7000, reservedCents: 500 };
  const full = reserveBudget(original, 500);
  assert.equal(full.reservedCents, 1000);
  assert.equal(original.reservedCents, 500);
  assert.throws(() => reserveBudget(full, 1), /EXHAUSTED/);
  assert.throws(() => reserveBudget(original, NaN), /INVALID/);
  assert.throws(() => reserveBudget({ ...original, fixedCents: -1 }, 1), /INVALID/);
  const overrun = settleBudget(full, 1000, 2000);
  assert.equal(overrun.spentCents, 9000);
  assert.throws(() => reserveBudget(overrun, 1), /EXHAUSTED/);
  assert.equal(Object.isFrozen(FACTORY_POLICY), true);
});
test("repairs are bounded; learning must improve heldout and historical cases", () => {
  assert.deepEqual([-1, 0, 1, 2, 3].map(canRepair), [false, true, true, false, false]);
  const cases = (["historical", "heldout"] as const).map(partition => ({ id: partition, partition, baselineScore: .5, candidateScore: .7, baselineSafetyFailures: 0, candidateSafetyFailures: 0 }));
  assert.equal(evaluateLearning(cases, false, 10, 100).allowed, true);
  assert.equal(evaluateLearning(cases.slice(0, 1), false, 10, 100).allowed, false);
  assert.equal(evaluateLearning(cases.map(c => ({ ...c, candidateSafetyFailures: 1 })), false, 10, 100).allowed, false);
  assert.equal(evaluateLearning(cases.map(c => ({ ...c, candidateScore: .4 })), false, 10, 100).allowed, false);
  assert.equal(evaluateLearning(cases, true, 10, 100).allowed, false);
  assert.equal(evaluateLearning(cases, false, 101, 100).allowed, false);
});
