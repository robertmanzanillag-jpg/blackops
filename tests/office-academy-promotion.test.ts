import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createAgentCouncil, CouncilStateConflict } from "../server/agent-council";
import { createAcademyReviewRunner } from "../server/office-academy-runner";
import { createOfficeExecution } from "../server/office-execution";
import { emptyCouncilState } from "../shared/agent-council";
import { advanceCompany, advanceAcademy, enrollTrainee } from "../shared/agent-company";
const ROLE = "claude-reviewer", DAY = 86400000, START = Date.parse("2026-11-06T12:00:00Z");
const answers = [
  [{ caseId: "r01", category: "authorization" }, { caseId: "r02", category: "authorization" }, { caseId: "r02", category: "secret_disclosure" }],
  [{ caseId: "r04", category: "sql_injection" }, { caseId: "r05", category: "command_injection" }],
  [{ caseId: "r07", category: "path_traversal" }, { caseId: "r08", category: "secret_disclosure" }],
];

for (const { retired, equal, delayed } of [{ retired: false, equal: false, delayed: false }, { retired: true, equal: false, delayed: false }, { retired: false, equal: true, delayed: false }, { retired: true, equal: false, delayed: true }]) test(`durable academy retired=${retired} equal=${equal} delayedActivation=${delayed}`, async () => {
  const old = process.env.OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED;
  process.env.OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED = delayed ? "false" : "true";
  try {
    let clock = START, calls = 0;
    const initial = emptyCouncilState();
    initial.company = advanceCompany(initial.company, { now: START - 2 * DAY, roles: { [ROLE]: "Reviewer" }, statuses: { [ROLE]: { state: "working", label: "Result" } } }).state;
    initial.company.orders.push({ id: "retained-work", text: "Review queued PR", createdAt: new Date(START - DAY).toISOString(), assignees: [{ agentId: ROLE, status: "en_curso", note: "Existing task" }] });
    if (retired) {
      initial.company.careers[ROLE].battery = 10;
      initial.company = advanceCompany(initial.company, { now: clock, roles: { [ROLE]: "Reviewer" }, statuses: { [ROLE]: { state: "error", label: "Invalid verified output", evidenceId: "failed-pr" } } }).state;
      assert.equal(initial.company.careers[ROLE].generation, 2);
    } else initial.company = enrollTrainee(initial.company, { id: "incumbent-refresh", forAgentId: ROLE, role: "Reviewer", now: clock });
    const modules = [{ id: "security", title: "Security review", summary: "Check ownership, input boundaries and secret handling." }];
    initial.company = advanceAcademy(initial.company, () => modules, clock);
    let raw = JSON.stringify(initial), revision = 0;
    const runner = createAcademyReviewRunner({ now: () => clock, run: async prompt => {
      const incumbent = ++calls % 2 === 1; clock += 10;
      const index = prompt.includes('"id":"r01"') ? 0 : prompt.includes('"id":"r04"') ? 1 : 2;
      return { text: JSON.stringify({ findings: incumbent && !equal ? [] : answers[index] }), sessionId: `resp_benchmark_${calls}`, completedAt: new Date(clock).toISOString(), provider: "openai", model: "test-model", usage: { totalTokens: incumbent ? 200 : 100 } };
    } });
    const make = () => createAgentCouncil({ now: () => clock, userId: () => "owner", readState: async () => raw, writeState: async () => {},
      versioned: { read: async () => ({ raw, revision }), write: async (next, expected) => { if (revision !== expected) throw new CouncilStateConflict(); raw = next; return ++revision; } },
      collect: async () => ({}), submitProposal: async () => "", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {}, loadCurriculum: async () => modules, academyReview: runner,
    });
    for (let i = 0; i < 3; i++) { clock = START + i * DAY + i * 1000; await make().runAcademyCycle(); }
    if (equal) {
      const rejected = await make().load();
      assert.equal(rejected.officeExecution!.roles.roles[ROLE].status, "active");
      assert.ok(rejected.company.trainees[0].evaluationClosedAt);
      assert.equal(rejected.company.trainees[0].graduatedAt, undefined);
      assert.equal(rejected.officeExecution!.roles.roles[ROLE].activePolicy!.candidateId, "baseline");
      return;
    }
    if (delayed) {
      assert.equal((await make().load()).officeExecution!.roles.roles[ROLE].status, "vacant");
      process.env.OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED = "true";
      await make().runAcademyCycle();
      assert.equal(calls, 6, "activating already verified qualification never repeats provider calls");
    }
    const trained = await make().load();
    const role = trained.officeExecution!.roles.roles[ROLE];
    assert.equal(role.status, "probation");
    assert.equal(role.activePolicy!.qualificationScope, "benchmark");
    assert.equal(trained.company.careers[ROLE].inTrainingUntilGeneration, undefined);
    assert.ok(trained.company.careers[ROLE].reviewGuidance!.some(x => x.includes("ownership")));
    assert.deepEqual(role.pendingOrderIds, ["retained-work"]);
    assert.equal(calls, 6);
    const diff = "+const safe = true;";
    const execution = createOfficeExecution(make(), { OFFICE_REVIEW_PROVIDER: "openai", OFFICE_OPENAI_MODEL: "test-model", OPENAI_API_KEY: "test-only", OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT: "100000" }, () => clock, {
      loadPr: async prUrl => ({ prUrl, diff, headSha: "a".repeat(40), diffSha256: createHash("sha256").update(diff).digest("hex") }),
      fetch: (async () => new Response(JSON.stringify({ id: "resp_actual_pr", model: "test-model", status: "completed", usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"verdict":"pass","summary":"Reviewed","findings":[]}' }] }] }))) as typeof fetch,
    });
    const task = { id: randomUUID(), key: randomUUID(), kind: "claude_review" as const, status: "running" as const, prUrl: "https://github.com/a/b/pull/1", createdAt: new Date(clock).toISOString(), fence: randomUUID(), leaseExpiresAt: new Date(clock + 180000).toISOString() };
    assert.equal(await execution.admission.begin(task), true);
    const output = await execution.execute(task);
    await execution.admission.finish(task, { ...output, status: "completed" });
    const final = await make().load();
    assert.equal(final.officeExecution!.roles.roles[ROLE].status, "active");
    assert.equal(final.officeExecution!.roles.roles[ROLE].activePolicy!.qualificationScope, "benchmark", "a valid PR execution does not prove verdict truth or universal superiority");
    assert.deepEqual(final.company.orders, initial.company.orders);
    assert.equal(final.company.retiredCareers!.length, retired ? 1 : 0);
  } finally { if (old === undefined) delete process.env.OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED; else process.env.OFFICE_REVIEW_BENCHMARK_PROMOTION_ENABLED = old; }
});
