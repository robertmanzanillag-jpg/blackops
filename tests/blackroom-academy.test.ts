import test from "node:test";
import assert from "node:assert/strict";
import { advanceAcademy, emptyCompanyState, type AgentCareer, type CompanyState, type Trainee } from "../shared/agent-company";
import { BLACKROOM_ACADEMY_MAX_ACTIVE, advanceBlackRoomAcademy, blackRoomAcademySummary, scheduleBlackRoomAcademy } from "../shared/blackroom-academy";
import type { BlackRoomTeamLessonRule } from "../shared/blackroom-team";
import {
  BLACKROOM_CURRICULUM_ROLES,
  blackRoomCurriculumModules,
  blackRoomRoleFixtures,
  buildBlackRoomRolePrompt,
  gradeBlackRoomRoleResponse,
} from "../server/office-role-blackroom-curricula";
import { createBlackRoomAcademyRunner } from "../server/office-academy-blackroom";
import { OFFICE_CURRICULUM_ROLES } from "../server/office-role-curricula";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ROLES: Record<string, string> = Object.fromEntries(BLACKROOM_CURRICULUM_ROLES.map((id) => [id, `Rol ${id}`]));

function career(agentId: string, extra: Partial<AgentCareer> = {}): AgentCareer {
  return { agentId, generation: 1, nickname: `N-${agentId}`, points: 10, battery: 60, lastState: null, cyclesWorking: 0, cyclesTotal: 0, ordersDone: 0, firedCount: 0, hiredAt: iso(NOW - 5 * 24 * HOUR), memory: [], ...extra };
}
const rule = (agentId: string, kind: BlackRoomTeamLessonRule["kind"], text: string): BlackRoomTeamLessonRule => ({ id: `${kind}:${text}`, agentId: agentId as never, kind, text, support: 2, evidence: ["o1", "o2"], updatedAt: iso(NOW - HOUR) });

test("every Black Room role has three grounded base cases; real lessons add training cases", () => {
  assert.deepEqual([...BLACKROOM_CURRICULUM_ROLES].sort(), ["blackroom-analytics", "blackroom-ceo", "blackroom-competition", "blackroom-publisher", "blackroom-scripts", "blackroom-website", "radio"]);
  assert.ok(!(OFFICE_CURRICULUM_ROLES as readonly string[]).some((role) => role.startsWith("blackroom-") && role !== "blackroom-videos"), "the general journal is untouched");
  for (const role of BLACKROOM_CURRICULUM_ROLES) {
    const fixtures = blackRoomRoleFixtures(role);
    assert.equal(fixtures.length, 3);
    assert.equal(new Set(fixtures.map((fixture) => fixture.expected.classification)).size, 3);
    for (const fixture of fixtures) {
      const prompt = buildBlackRoomRolePrompt(fixtures, fixture.id, ["nota"]);
      const parsed = JSON.parse(prompt);
      assert.equal(parsed.expected, undefined, "no answers in the prompt");
      assert.match(parsed.rules, /aprobacion de Robert o del socio/);
      const good = JSON.stringify({ version: 1, role, fixtureId: fixture.id, ...fixture.expected });
      assert.equal(gradeBlackRoomRoleResponse(fixture, good).passed, true);
      const wrong = JSON.stringify({ version: 1, role, fixtureId: fixture.id, ...fixtures.find((other) => other.id !== fixture.id)!.expected });
      assert.equal(gradeBlackRoomRoleResponse(fixture, wrong).passed, false);
      assert.equal(gradeBlackRoomRoleResponse(fixture, JSON.stringify({ ...JSON.parse(good), score: 100 })).passed, false);
    }
  }
  const lessons = [rule("blackroom-publisher", "evitar", "Evitar idioma en: 3 posteos rechazados"), rule("blackroom-publisher", "evitar", "otra"), rule("blackroom-publisher", "corregir", "Corregir lo que pidio el socio: horario"), rule("blackroom-scripts", "repetir", "no es mio")];
  const fixtures = blackRoomRoleFixtures("blackroom-publisher", lessons);
  const lessonCases = fixtures.filter((fixture) => fixture.origin === "leccion");
  assert.equal(lessonCases.length, 2, "one case per lesson kind, bounded");
  assert.deepEqual(lessonCases.map((fixture) => fixture.expected.decision).sort(), ["apply_feedback_before_approval", "revise_before_approval"]);
  assert.match(String(lessonCases[0].source.facts.leccion), /Evitar idioma en/);
  const modules = blackRoomCurriculumModules("blackroom-scripts", [rule("blackroom-scripts", "evitar", "Antes de editar, revisar: archivo ilegible")]);
  assert.ok(modules.some((module) => /blackroom-video-style\.md/.test(module.summary)));
  assert.ok(modules.some((module) => module.id.startsWith("leccion:blackroom:blackroom-scripts:")));
  assert.ok(!JSON.stringify(modules).includes("fix_input_before_retry"), "curriculum never leaks answers");
  assert.deepEqual(blackRoomCurriculumModules("code"), []);
});

test("continuous, bounded enrollment for Black Room roles", () => {
  const state: CompanyState = { ...emptyCompanyState(), careers: Object.fromEntries(BLACKROOM_CURRICULUM_ROLES.map((id) => [id, career(id)])) };
  const scheduled = scheduleBlackRoomAcademy(state, ROLES, NOW);
  const active = scheduled.trainees.filter((trainee) => !trainee.graduatedAt);
  assert.equal(active.length, BLACKROOM_ACADEMY_MAX_ACTIVE);
  assert.ok(active.every((trainee) => trainee.purpose === "incumbent" && trainee.id.startsWith("academy:blackroom:")));
  assert.equal(scheduleBlackRoomAcademy(scheduled, ROLES, NOW + HOUR), scheduled, "idempotent within the week");
});

/** A trainee that already studied its Black Room curriculum (modules done). */
function studied(role: string, extra: Partial<Trainee> = {}, rules: BlackRoomTeamLessonRule[] = []) {
  const course = blackRoomCurriculumModules(role, rules);
  return { id: `academy:blackroom:${role}:1:1`, forAgentId: role, role: `Rol ${role}`, nickname: "Alumno", startedAt: iso(NOW - 2 * HOUR), modulesDone: course.map((m) => m.id), knowledge: ["Black Room · reglas"], curriculumSnapshot: course, generation: 1, purpose: "incumbent" as const, ...extra };
}

function harness(initial: CompanyState) {
  let company = structuredClone(initial);
  let time = NOW;
  let busy = false;
  const calls: Array<{ executionId: string; prompt: any }> = [];
  let answer: "right" | "wrong" | "throw-budget" | "throw" = "right";
  const council = { updateBlackRoomAcademy: async (change: (c: CompanyState, b: boolean) => CompanyState) => { company = change(structuredClone(company), busy); return structuredClone(company); } };
  const run = async (prompt: string, call: { executionId: string }) => {
    const parsed = JSON.parse(prompt);
    calls.push({ executionId: call.executionId, prompt: parsed });
    time += 1000;
    if (answer === "throw-budget") throw Object.assign(new Error("budget"), { code: "token_budget_exhausted" });
    if (answer === "throw") throw new Error("network unknown");
    const fixture = blackRoomRoleFixtures(parsed.role).find((item) => item.id === parsed.fixtureId);
    const expected = fixture?.expected || { evidenceIds: [parsed.source.evidenceId], classification: parsed.classificationChoices.at(-1), decision: parsed.decisionChoices.at(-1) };
    const body = answer === "right" ? expected : { ...expected, decision: "publish_now" };
    return { text: JSON.stringify({ version: 1, role: parsed.role, fixtureId: parsed.fixtureId, ...body }), provider: "openai" as const, model: "cheap", sessionId: `resp_${calls.length}`, completedAt: iso(time), usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
  };
  return { council, run, calls, now: () => time, setTime: (ms: number) => { time = ms; }, setAnswer: (value: typeof answer) => { answer = value; }, setBusy: (value: boolean) => { busy = value; }, company: () => company };
}

test("runner: paired evaluation, bounded per day, never in parallel with other tracks", async () => {
  const h = harness({ ...emptyCompanyState(), careers: { "blackroom-website": career("blackroom-website") }, trainees: [studied("blackroom-website")] });
  const runner = createBlackRoomAcademyRunner({ council: h.council, run: h.run, now: h.now, dailyPairs: 2 });
  h.setBusy(true);
  await runner.tick();
  assert.equal(h.calls.length, 0, "waits while another academy track runs");
  h.setBusy(false);
  await runner.tick();
  assert.deepEqual(h.calls.map((call) => call.executionId.split(":").at(-1)), ["incumbent", "candidate"]);
  assert.deepEqual(h.calls[0].prompt.trainingLessons, [], "the holder answers without study notes");
  assert.ok(h.calls[1].prompt.trainingLessons.length > 0);
  await runner.tick();
  await runner.tick();
  assert.equal(h.calls.length, 4, "daily pairs bound the spend");
  const trainee = h.company().trainees[0];
  assert.equal(trainee.assessments!.length, 2);
  assert.ok(trainee.assessments!.every((assessment) => assessment.scope === "benchmark" && assessment.passed && assessment.costBasis === "measured_tokens_not_usd"));
  assert.ok(h.company().blackroomAcademyJobs!.every((job) => job.status === "completed"));
  assert.throws(() => createBlackRoomAcademyRunner({ council: h.council, run: h.run, dailyPairs: 0 }), /DAILY_LIMIT/);
});

test("runner: replacements run only the candidate, lesson cases come first, budget refusals block, unknown waits", async () => {
  const lessons = { "blackroom-publisher": [rule("blackroom-publisher", "evitar", "Evitar duracion largo: 3 rechazados")] };
  const fired = career("blackroom-publisher", { generation: 2, inTrainingUntilGeneration: 2 });
  const replacement = studied("blackroom-publisher", { id: "blackroom-publisher#2", generation: 2, purpose: "candidate" }, lessons["blackroom-publisher"]);
  const h = harness({ ...emptyCompanyState(), careers: { "blackroom-publisher": fired }, trainees: [replacement] });
  const runner = createBlackRoomAcademyRunner({ council: h.council, run: h.run, now: h.now, dailyPairs: 5, loadLessons: async () => lessons });
  await runner.tick();
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].executionId, /candidate$/);
  assert.match(h.calls[0].prompt.fixtureId, /:leccion-v1:/, "real mistakes are practiced first");
  assert.ok(h.calls[0].prompt.trainingLessons.some((text: string) => /Evitar duracion largo/.test(text)));
  h.setAnswer("throw-budget");
  await runner.tick();
  assert.equal(h.company().blackroomAcademyJobs!.at(-1)!.status, "blocked");
  await runner.tick();
  assert.equal(h.calls.length, 2, "a budget refusal is not retried the same day");
  h.setTime(NOW + 25 * HOUR);
  h.setAnswer("throw");
  await runner.tick();
  assert.equal(h.company().blackroomAcademyJobs!.at(-1)!.status, "unknown");
  h.setTime(NOW + 50 * HOUR);
  h.setAnswer("right");
  const before = h.calls.length;
  await runner.tick();
  assert.equal(h.calls.length, before, "an uncertain call waits for reconciliation");
});

test("graduation needs three passed cases AND a real verified run; the replacement then takes the job", () => {
  const role = "blackroom-analytics";
  const course = blackRoomCurriculumModules(role);
  const pass = (n: number) => ({ scope: "benchmark" as const, runId: `run-${n}`, benchmarkId: `${role}:blackroom-v1:${n}`, curriculumVersion: "v", completedAt: iso(NOW - HOUR + n), artifactId: `a-${n}`, passed: true, quality: 100, incumbentQuality: 0, errors: 0, incumbentErrors: 0, durationMs: 1, incumbentDurationMs: 0, cost: 15, incumbentCost: 0 });
  const trainee: Trainee = { ...studied(role, { id: `${role}#2`, generation: 2, purpose: "candidate" }), curriculumSnapshot: course, assessments: [pass(1), pass(2)] };
  let state: CompanyState = { ...emptyCompanyState(), careers: { [role]: career(role, { generation: 2, inTrainingUntilGeneration: 2 }) }, trainees: [trainee] };
  const working = { [role]: { state: "working", evidenceId: `blackroom-team:${role}:${iso(NOW - 10 * 60_000)}` } };
  state = advanceBlackRoomAcademy(state, working, NOW);
  assert.equal(state.trainees[0].graduatedAt, undefined, "two passes are not enough");
  state = { ...state, trainees: [{ ...state.trainees[0], assessments: [pass(1), pass(2), pass(3)] }] };
  state = advanceBlackRoomAcademy(state, { [role]: { state: "available" } }, NOW);
  assert.equal(state.trainees[0].graduatedAt, undefined, "no real run yet");
  assert.equal(state.trainees[0].awaitingEvidence, true);
  assert.equal(blackRoomAcademySummary(state, NOW).rows[0].status, "espera ejecucion real");
  // An old run (before the passes) is not evidence for this trainee.
  state = advanceBlackRoomAcademy(state, { [role]: { state: "working", evidenceId: `blackroom-team:${role}:${iso(NOW - 3 * HOUR)}` } }, NOW);
  assert.equal(state.trainees[0].graduatedAt, undefined);
  state = advanceBlackRoomAcademy(state, working, NOW);
  assert.ok(state.trainees[0].graduatedAt);
  assert.equal(state.careers[role].inTrainingUntilGeneration, undefined, "the replacement starts working");
  assert.ok((state.careers[role].skills || []).length === 0 || state.careers[role].skills!.every((skill) => skill.source === "academia"));
  assert.match(state.events[0].text, /academia Black Room/);
  // The general academy never graduates Black Room trainees on fixtures alone.
  const general = advanceAcademy({ ...emptyCompanyState(), careers: { [role]: career(role) }, trainees: [{ ...trainee, id: "x", purpose: "incumbent", generation: 1, assessments: [pass(1), pass(2), pass(3)] }] }, () => course, NOW);
  assert.equal(general.trainees[0].graduatedAt, undefined);
  const summary = blackRoomAcademySummary(state, NOW);
  assert.equal(summary.graduated, 1);
  assert.equal(summary.rows[0].casesPassed, 3);
  assert.equal(summary.rows[0].realRuns, 1);
  assert.equal(summary.rows[0].purpose, "reemplazo");
});
