import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyQualitySignals, emptyCompanyState, type AgentCareer, type CompanyState, type QualitySignal } from "../shared/agent-company";
import { blackRoomTeamToLiveStatus } from "../shared/blackroom-team";
import { createAgentCouncil, type CouncilDeps } from "../server/agent-council";
import {
  blackRoomQualitySignals,
  deriveBlackRoomLessonRules,
  getBlackRoomLessons,
  harvestBlackRoomOutcomes,
  recordBlackRoomLessonOutcome,
  syncBlackRoomLessons,
} from "../server/blackroom-team/lessons";
import { createBlackRoomTeamContext } from "../server/blackroom-team";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function career(agentId: string, extra: Partial<AgentCareer> = {}): AgentCareer {
  return { agentId, generation: 1, nickname: "Vale", points: 10, battery: 50, lastState: null, cyclesWorking: 0, cyclesTotal: 0, ordersDone: 0, firedCount: 0, hiredAt: iso(NOW - 5 * 24 * HOUR), memory: [], ...extra };
}
function company(careers: AgentCareer[]): CompanyState {
  return { ...emptyCompanyState(), careers: Object.fromEntries(careers.map((item) => [item.agentId, item])) };
}
const signal = (id: string, points: number, battery: number, at = NOW - HOUR, agentId = "blackroom-publisher"): QualitySignal => ({ id, agentId, at: iso(at), points, battery, text: id });

test("quality signals: approvals earn, rejections cost, each outcome counts once", () => {
  const start = company([career("blackroom-publisher")]);
  const first = applyQualitySignals(start, [signal("a", 3, 2), signal("r", -3, -3)], { now: NOW, roles: {} });
  assert.deepEqual(first.applied, ["a", "r"]);
  assert.equal(first.state.careers["blackroom-publisher"].points, 10);
  assert.equal(first.state.careers["blackroom-publisher"].battery, 49);
  const again = applyQualitySignals(first.state, [signal("a", 3, 2), signal("r", -3, -3)], { now: NOW, roles: {} });
  assert.deepEqual(again.applied, []);
  assert.equal(again.state, first.state, "nothing changes when every outcome was already scored");
});

test("quality signals never reach trainees, exempt agents, old outcomes or the previous generation", () => {
  const start = company([
    career("blackroom-publisher", { hiredAt: iso(NOW - 2 * HOUR) }),
    career("blackroom-scripts", { inTrainingUntilGeneration: 2, generation: 2 }),
    career("radio"),
  ]);
  const result = applyQualitySignals(start, [
    signal("before-hire", -3, -3, NOW - 3 * HOUR),
    signal("too-old", -3, -3, NOW - 8 * 24 * HOUR),
    signal("future", 3, 3, NOW + HOUR),
    signal("trainee", -2, -4, NOW - HOUR, "blackroom-scripts"),
    signal("exempt", -2, -4, NOW - HOUR, "radio"),
    signal("unknown-agent", 5, 5, NOW - HOUR, "blackroom-website"),
  ], { now: NOW, roles: {}, exempt: ["radio"] });
  assert.deepEqual(result.applied, []);
});

test("repeated rejections can empty the battery and the CEO replaces the agent through the academy", () => {
  const start = company([career("blackroom-publisher", { battery: 5 })]);
  const result = applyQualitySignals(start, [signal("r1", -3, -3, NOW - 2 * HOUR), signal("r2", -3, -3, NOW - HOUR)], { now: NOW, roles: { "blackroom-publisher": "Publicador Black Room" } });
  assert.equal(result.fired.length, 1);
  const replaced = result.state.careers["blackroom-publisher"];
  assert.equal(replaced.generation, 2);
  assert.equal(replaced.inTrainingUntilGeneration, 2);
  assert.ok(result.state.trainees.some((trainee) => trainee.id === "blackroom-publisher#2" && trainee.forAgentId === "blackroom-publisher"));
  assert.match(result.state.events[0].text, /despidio/);
});

const publisherItem = (id: string, status: "approved" | "rejected" | "pending", extra: Record<string, unknown> = {}) => ({
  id, agentId: "blackroom-publisher", kind: "post", title: id, summary: "", createdAt: iso(NOW - 10 * HOUR), status, dryRun: true,
  decidedAt: status === "pending" ? null : iso(NOW - 2 * HOUR), decidedBy: status === "pending" ? null : { userId: "p1", role: "partner" },
  payload: { channel: "metricool", caption: "c", mediaUrl: "https://example.org/a.mp4", sourceVideoId: "", durationSeconds: 75, videoFormat: "vertical", language: "en", networks: ["tiktok"], publicationDateTime: "2026-11-13T21:00:00", timezone: "America/New_York", source: "manual", notes: "" },
  dispatch: { state: "none", attempts: 0, updatedAt: null, lastError: null, receipt: null, partialReceipts: {}, dryRunPreview: null },
  ...extra,
});

test("harvest: real Publicador decisions, failed edit jobs and attributed posts vs the team median", () => {
  const receipt = (metricoolId: string) => ({ state: "scheduled", attempts: 1, updatedAt: iso(NOW - 5 * HOUR), lastError: null, receipt: { metricoolId, publicationDateTime: "2026-11-10T21:00:00", caption: "c", verified: true, platformReceipts: { tiktok: `tt-${metricoolId}` } }, partialReceipts: {}, dryRunPreview: null });
  const { outcomes, patterns } = harvestBlackRoomOutcomes({
    publisher: { version: 1, lastRunAt: null, lastRunSummary: null, items: [
      publisherItem("i1", "rejected"), publisherItem("i2", "rejected"), publisherItem("i3", "approved"), publisherItem("i4", "pending"),
      publisherItem("i5", "approved", { dispatch: receipt("m5") }), publisherItem("i6", "approved", { dispatch: receipt("m6") }),
    ] } as never,
    scripts: { version: 1, lastRunAt: null, lastRunSummary: null, ideas: [], ideasGeneratedAt: null, drafts: [], jobs: [
      { id: "j1", status: "failed", error: "archivo de video ilegible 123", attempts: 1, finishedAt: iso(NOW - 3 * HOUR), updatedAt: iso(NOW - 3 * HOUR), createdAt: iso(NOW - 4 * HOUR), publisherItemIds: [] },
      { id: "j2", status: "completed", error: null, attempts: 1, finishedAt: iso(NOW - 3 * HOUR), updatedAt: iso(NOW - 3 * HOUR), createdAt: iso(NOW - 4 * HOUR), publisherItemIds: ["i5"] },
    ] } as never,
    analytics: { version: 1, lastRunAt: iso(NOW - HOUR), lastOkAt: null, lastError: null, lastNeeds: [], history: [], lastReport: {
      generatedAt: iso(NOW - HOUR),
      networks: { tiktok: { status: "ok", label: "TikTok", topPosts: [{ id: "tt-m5", views: 900 }, { id: "x1", views: 400 }], bottomPosts: [{ id: "tt-m6", views: 50 }, { id: "x2", views: 100 }], bestHours: [{ label: "21-23 h", samples: 3, medianViews: 500 }], bestDurations: [] } },
    } } as never,
  });
  const ids = outcomes.map((outcome) => outcome.id);
  assert.equal(outcomes.filter((outcome) => outcome.agentId === "blackroom-publisher" && outcome.kind === "rejected").length, 2);
  assert.ok(!ids.some((id) => id.includes(":i4:")), "a pending item is not an outcome");
  assert.ok(outcomes.some((outcome) => outcome.kind === "job_failed" && outcome.agentId === "blackroom-scripts"));
  assert.ok(outcomes.some((outcome) => outcome.kind === "approved" && outcome.agentId === "blackroom-scripts" && outcome.refId === "i5"), "the edit job that produced the clip shares the decision");
  const above = outcomes.filter((outcome) => outcome.kind === "above_median");
  assert.deepEqual(above.map((outcome) => outcome.refId).sort(), ["tt-m5", "tt-m5"]);
  assert.ok(outcomes.some((outcome) => outcome.kind === "below_median" && outcome.refId === "tt-m6"));
  assert.ok(!outcomes.some((outcome) => outcome.refId === "x1"), "unattributed posts never score");
  assert.equal(patterns.length, 1);

  const signals = blackRoomQualitySignals(outcomes);
  assert.ok(signals.some((item) => item.points === -3 && /socio/.test(item.text)));
  assert.ok(signals.some((item) => item.points === 4));
  assert.ok(!signals.some((item) => /mediana/.test(item.text) && item.points < 0), "below median teaches but costs nothing");

  const rules = deriveBlackRoomLessonRules("blackroom-publisher", outcomes, patterns);
  // Same traits were approved 3 times and rejected twice: not enough to teach "avoid".
  assert.ok(!rules.some((rule) => rule.kind === "evitar"));
  assert.ok(rules.some((rule) => rule.id.startsWith("repetir:analytics:tiktok:hora")), "the best hour from analytics becomes a rule");
  const scriptsRules = deriveBlackRoomLessonRules("blackroom-scripts", outcomes, patterns);
  assert.ok(scriptsRules.some((rule) => rule.kind === "evitar" && /ilegible/.test(rule.text)));
  assert.deepEqual(deriveBlackRoomLessonRules("blackroom-scripts", outcomes, patterns), scriptsRules, "deterministic");
});

test("lessons store: recorded feedback, persistence and the agent context", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "br-lessons-"));
  const now = () => new Date(NOW);
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "blackroom-publisher.json"), JSON.stringify({ version: 1, lastRunAt: null, lastRunSummary: null, items: [publisherItem("i1", "rejected"), publisherItem("i2", "rejected")] }));
  await recordBlackRoomLessonOutcome({ agentId: "blackroom-publisher", kind: "feedback", refId: "i1", reason: "Los captions en ingles no sirven para Miami", actorRole: "owner", sentiment: "negative" }, { dataDir, now });
  const lessons = await getBlackRoomLessons("blackroom-publisher", { dataDir, now });
  assert.ok(lessons.rules.some((rule) => rule.kind === "corregir" && /ingles/.test(rule.text)));
  assert.ok(lessons.rules.some((rule) => rule.kind === "evitar" && /2 posteos rechazados/.test(rule.text)));
  const synced = await syncBlackRoomLessons({ dataDir, now });
  assert.equal(synced.outcomes.length, 3);
  const stored = JSON.parse(await readFile(path.join(dataDir, "lessons.json"), "utf8"));
  assert.equal(stored.outcomes.length, 3);
  // The queue forgets the items; the lessons do not.
  await writeFile(path.join(dataDir, "blackroom-publisher.json"), JSON.stringify({ version: 1, lastRunAt: null, lastRunSummary: null, items: [] }));
  const ctx = createBlackRoomTeamContext("blackroom-publisher", { dataDir, now, env: {} });
  const rules = await ctx.readLessons!();
  assert.ok(rules.some((rule) => /2 posteos rechazados/.test(rule.text)));
  await assert.rejects(recordBlackRoomLessonOutcome({ agentId: "kong" as never, kind: "feedback", refId: "x" }, { dataDir, now }));
});

test("council: Black Room agents gain only with real evidence, setup blocks never drain, quality signals score once", async (t) => {
  // Black Room academy enrollment is opt-in; this test exercises it.
  const previousAcademy = process.env.OFFICE_BLACKROOM_ACADEMY_ENABLED;
  process.env.OFFICE_BLACKROOM_ACADEMY_ENABLED = "true";
  t.after(() => { if (previousAcademy === undefined) delete process.env.OFFICE_BLACKROOM_ACADEMY_ENABLED; else process.env.OFFICE_BLACKROOM_ACADEMY_ENABLED = previousAcademy; });
  let stored: string | null = null;
  let clock = NOW;
  let signals: QualitySignal[] = [];
  const team = (lastRunAt: string | null, state: "working" | "blocked") => ({ id: "blackroom-analytics", state, label: state === "working" ? "Reporte listo" : "Falta METRICOOL_USER_TOKEN", summary: "", needs: state === "blocked" ? ["METRICOOL_USER_TOKEN"] : [], lastRunAt });
  let analytics = team(null, "blocked");
  const deps: CouncilDeps = {
    now: () => clock,
    userId: () => "owner",
    readState: async () => stored,
    writeState: async (raw) => { stored = raw; },
    collect: async () => ({}),
    submitProposal: async () => "pa-1",
    getPendingActionStatus: async () => "pending",
    fetchLatestRelease: async () => null,
    log: () => undefined,
    integrations: () => ({}),
    collectStatuses: async () => ({
      "blackroom-analytics": blackRoomTeamToLiveStatus(analytics, clock),
      "blackroom-publisher": blackRoomTeamToLiveStatus({ id: "blackroom-publisher", state: "available", label: "Cola al dia", summary: "", needs: [], lastRunAt: null }, clock),
    }),
    collectBlackRoomLife: async () => ({ signals, rules: {} }),
  };
  const council = createAgentCouncil(deps);
  let state = await council.runCycle({ force: true });
  const analyticsStart = state.company.careers["blackroom-analytics"];
  assert.ok(analyticsStart, "the Black Room agent has a career");
  assert.equal(analyticsStart.points, 0);
  // Blocked by setup for many rounds: no life lost.
  for (let round = 0; round < 3; round++) { clock += 20 * 60_000; state = await council.runCycle({ force: true }); }
  assert.ok(state.company.careers["blackroom-analytics"].battery >= analyticsStart.battery);
  assert.equal(state.company.careers["blackroom-analytics"].points, 0);
  // A real, recent run is evidence: points once per distinct run.
  analytics = team(iso(clock - 5 * 60_000), "working");
  clock += 20 * 60_000; state = await council.runCycle({ force: true });
  assert.equal(state.company.careers["blackroom-analytics"].points, 10);
  clock += 20 * 60_000; state = await council.runCycle({ force: true });
  assert.equal(state.company.careers["blackroom-analytics"].points, 10, "the same run never scores twice");
  // A partner rejection of a post costs the Publicador, once.
  const before = state.company.careers["blackroom-publisher"];
  signals = [{ id: "blackroom:publisher:i1:rejected", agentId: "blackroom-publisher", at: iso(clock - 60_000), points: -3, battery: -3, text: "Posteo rechazado por el socio" }];
  clock += 20 * 60_000; state = await council.runCycle({ force: true });
  assert.equal(state.company.careers["blackroom-publisher"].battery, before.battery - 3);
  clock += 20 * 60_000; state = await council.runCycle({ force: true });
  assert.equal(state.company.careers["blackroom-publisher"].battery, before.battery - 3);
  // The Black Room academy keeps the roles in training (bounded) with their own curriculum.
  const trainees = state.company.trainees.filter((trainee) => trainee.id.startsWith("academy:blackroom:"));
  assert.ok(trainees.length >= 1 && trainees.length <= 4);
  assert.ok(trainees[0].modulesDone.some((id) => id.includes(":blackroom-")), "studies the Black Room curriculum first");
});

test("harvest: restarts, pending confirmations and missing setup teach a lesson but never cost life", async () => {
  const job = (id: string, error: string, failureKind?: string) => ({ id, status: "failed", error, ...(failureKind ? { failureKind } : {}), attempts: 1, finishedAt: iso(NOW - 2 * HOUR), updatedAt: iso(NOW - 2 * HOUR), createdAt: iso(NOW - 3 * HOUR), publisherItemIds: [] });
  const { outcomes } = harvestBlackRoomOutcomes({
    publisher: null,
    scripts: { version: 1, lastRunAt: null, lastRunSummary: null, ideas: [], ideasGeneratedAt: null, drafts: [], jobs: [
      job("restart", "El render se interrumpio (posible reinicio del servidor). Usa retry-edit-job para intentarlo de nuevo.", "interrupted"),
      job("confirm", "El pipeline dejo una confirmacion pendiente (pa-1). Si la apruebas, los clips quedan en Drive fuera de este trabajo.", "awaiting_confirmation"),
      job("setup", "Google Drive no esta conectado para este usuario", "setup"),
      // Older jobs without failureKind: inferred from the stored error.
      job("legacy-restart", "El render se interrumpio (posible reinicio del servidor). Usa retry-edit-job para intentarlo de nuevo."),
      job("legacy-setup", "OAuth token missing for Drive"),
      job("real", "ffmpeg salio con codigo 1: stream corrupto", "render"),
    ] } as never,
    analytics: null,
  } as never);
  const byRef = new Map(outcomes.map((outcome) => [outcome.refId, outcome.kind]));
  for (const id of ["restart", "confirm", "setup", "legacy-restart", "legacy-setup"]) assert.equal(byRef.get(id), "job_blocked", id);
  assert.equal(byRef.get("real"), "job_failed");
  const signals = blackRoomQualitySignals(outcomes);
  assert.equal(signals.length, 1, "only the real render failure is scored");
  assert.equal(signals[0].id, "blackroom:scripts-job:real:failed:1");
  assert.equal(signals[0].points, -2);

  const { classifyBlackRoomRenderFailure } = await import("../server/blackroom-team/edit-job-failure");
  assert.equal(classifyBlackRoomRenderFailure("archivo de video ilegible 123"), "render");
  assert.equal(classifyBlackRoomRenderFailure("Falta conectar Google Drive"), "setup");
});
