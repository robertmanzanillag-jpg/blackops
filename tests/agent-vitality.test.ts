import test from "node:test";
import assert from "node:assert/strict";
import { advanceCompany, applyQualitySignals, emptyCompanyState, inactivityProtected, learnLessons, type CompanyState } from "../shared/agent-company";
import { applyVitality, closeStaleVitalityFlags, deriveVitalityFlagProposals, vitalityCadenceMs, vitalityLiveStatus, vitalityView, HOUR_MS, VITALITY_MISS, VITALITY_RECOVERY } from "../shared/agent-vitality";
import { clippersAcademyLessons, deriveSelfImprovementProposals, learnClippersLessons, pipelineHolds, roleWorkVitalityEvidence, stampSelfImprovementCooldowns, streamerVitalityEvidence, MAX_OPEN_SELF_IMPROVEMENT } from "../shared/agent-self-improvement";
import { applyApprovedProposal, emptyCouncilState, parseCouncilState, type CouncilProposal } from "../shared/agent-council";
import { createAgentCouncil, type CouncilDeps } from "../server/agent-council";
import { CLIPPERS_AGENT_IDS } from "../shared/clippers-office-agents";
import { FACTORY_AGENT_IDS } from "../shared/factory-office-agents";

const T0 = Date.parse("2026-11-19T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const hire = (ids: string[], now = T0): CompanyState =>
  advanceCompany(emptyCompanyState(), { now, roles: Object.fromEntries(ids.map(id => [id, id])), statuses: Object.fromEntries(ids.map(id => [id, { state: "available" as const, label: "registrado" }])) }).state;

const STEP = 15 * 60_000;
/** Runs one vitality tick per council round (15 min) from `from` to `to`. */
function tick(company: CompanyState, from: number, to: number, input: Omit<Parameters<typeof applyVitality>[1], "now"> = {}) {
  let state = company; const decayed: string[] = []; const flagged: string[] = [];
  for (let t = from; t <= to; t += STEP) { const r = applyVitality(state, { ...input, now: t }); state = r.state; decayed.push(...r.decayed); flagged.push(...r.flagged); }
  return { state, decayed, flagged };
}

test("cadence only for agents with a verified evidence source", () => {
  assert.equal(vitalityCadenceMs("code"), 26 * HOUR_MS);
  assert.equal(vitalityCadenceMs("radio"), 26 * HOUR_MS);
  assert.equal(vitalityCadenceMs("clippers-streamers"), 48 * HOUR_MS);
  assert.equal(vitalityCadenceMs("clippers-learning"), 7 * 24 * HOUR_MS);
  for (const id of FACTORY_AGENT_IDS) assert.equal(vitalityCadenceMs(id), 7 * 24 * HOUR_MS);
  assert.equal(vitalityCadenceMs("blackroom-publisher"), 72 * HOUR_MS);
  for (const id of ["blackroom-ceo", "clippers-supervisor", "clippers-health", "clippers-trends", "ceo", "agent-factory", "cybersecurity", "app-qa", "kong:Venues"]) assert.equal(vitalityCadenceMs(id), null, id);
});

test("no verified output: first sight is free, one window per tick, each window costs once", () => {
  let company = hire(["code"]);
  const r = tick(company, T0, T0 + 3 * 26 * HOUR_MS + STEP);
  assert.equal(r.state.careers.code.battery, 80 - 3 * VITALITY_MISS.battery);
  assert.equal(r.decayed.length, 3);
  assert.equal(r.state.careers.code.vitality?.decayDebt, 9);
  assert.equal(r.state.careers.code.generation, 1);
  assert.match(r.state.careers.code.memory[0].text, /Sin entregable verificado/);
});

test("office downtime (no rounds for longer than one cadence) is never charged", () => {
  const first = applyVitality(hire(["code"]), { now: T0 }).state;
  const after = applyVitality(first, { now: T0 + 5 * 26 * HOUR_MS });
  assert.deepEqual(after.decayed, []);
  assert.equal(after.state.careers.code.battery, 80);
  assert.equal(after.state.careers.code.vitality?.anchorAt, iso(T0 + 5 * 26 * HOUR_MS));
});

test("an error already scored in the window is not also a missed turn", () => {
  let company = applyVitality(hire(["code"]), { now: T0 }).state;
  company = tick(company, T0, T0 + 20 * HOUR_MS).state;
  company = advanceCompany(company, { now: T0 + 20 * HOUR_MS, roles: {}, statuses: { code: { state: "error", label: "fallo", evidenceId: "run-1" } } }).state;
  assert.equal(company.careers.code.battery, 70);
  const r = tick(company, T0 + 20 * HOUR_MS + STEP, T0 + 40 * HOUR_MS);
  assert.deepEqual(r.decayed, [], "clock restarted at the evaluated error");
});

test("vida 0 from inactivity never fires on a later error or negative signal; verified work restores the normal rule", () => {
  let company = hire(["code"]);
  company = tick(company, T0, T0 + 28 * 26 * HOUR_MS).state;
  assert.equal(company.careers.code.battery, 0);
  assert.ok(company.careers.code.vitality?.flaggedAt);
  assert.equal(inactivityProtected(company.careers.code), true);
  const t = T0 + 28 * 26 * HOUR_MS + STEP;
  const errored = advanceCompany(company, { now: t, roles: { code: "Code" }, statuses: { code: { state: "error", label: "fallo", evidenceId: "run-x" } } });
  assert.deepEqual(errored.fired, []);
  assert.equal(errored.state.careers.code.generation, 1);
  const signaled = applyQualitySignals(errored.state, [{ id: "q-1", agentId: "code", at: iso(t), points: -5, battery: -10, text: "rechazado" }], { now: t + 1, roles: {} });
  assert.deepEqual(signaled.fired, []);
  // Verified work clears the protection: a later 0 from errors is the agent's own record again.
  const worked = applyVitality(signaled.state, { now: t + STEP, evidence: [{ id: "rolework:w", agentId: "code", at: iso(t + 2), label: "trabajo" }] }).state;
  assert.equal(inactivityProtected(worked.careers.code), false);
  // Errors alone (no inactivity debt) keep the existing replacement rule.
  const errorsOnly = { ...hire(["github"]), careers: { github: { ...hire(["github"]).careers.github, battery: 10 } } };
  const fired = advanceCompany(errorsOnly, { now: T0 + 2 * 24 * HOUR_MS, roles: {}, statuses: { github: { state: "error", label: "fallo", evidenceId: "e1" } } });
  assert.equal(fired.fired.length, 1);
  assert.equal(fired.state.careers.github.vitality, undefined, "a successor starts with a fresh vida clock");
});

test("verified output recovers vida once per receipt; work that landed between rounds still counts", () => {
  let company = tick(hire(["code"]), T0, T0 + 2 * 26 * HOUR_MS + STEP).state;
  const low = company.careers.code.battery;
  const at = T0 + 2 * 26 * HOUR_MS + 10 * 60_000;
  const evidence = roleWorkVitalityEvidence([{ id: "j1", role: "code", status: "completed", completedAt: iso(at), artifactId: "a".repeat(64) }, { id: "j2", role: "code", status: "blocked", completedAt: iso(at) }]);
  assert.equal(evidence.length, 1, "blocked work is never output");
  const r1 = applyVitality(company, { now: at + STEP, evidence });
  assert.equal(r1.state.careers.code.battery, low + VITALITY_RECOVERY);
  assert.equal(r1.state.careers.code.vitality?.decayDebt, 0);
  const r2 = applyVitality(r1.state, { now: at + 2 * STEP, evidence });
  assert.equal(r2.state.careers.code.battery, low + VITALITY_RECOVERY, "the same receipt never recovers twice");
  // Work and then an error between two rounds: lastState is "error" but cyclesWorking grew.
  let factory = applyVitality(hire(["factory-builder"]), { now: T0 }).state;
  const w = T0 + 3 * HOUR_MS;
  factory = advanceCompany(factory, { now: w, roles: {}, statuses: { "factory-builder": { state: "working", label: "etapa", evidenceId: "stage-1" } } }).state;
  factory = advanceCompany(factory, { now: w + 60_000, roles: {}, statuses: { "factory-builder": { state: "error", label: "fallo", evidenceId: "stage-2" } } }).state;
  const seen = applyVitality(factory, { now: w + STEP }).state;
  assert.equal(seen.careers["factory-builder"].vitality?.lastVerifiedWorkAt, iso(w + 60_000));
});

test("pipeline holds: role work off, vacant seat, idle factory, missing Clippers state; holds never lose vida", () => {
  const now = T0 + 10 * 24 * HOUR_MS;
  const holds = pipelineHolds({ now, roleWorkJobs: [{ role: "code", status: "completed", startedAt: iso(now - HOUR_MS) }, { role: "control", status: "blocked", startedAt: iso(now - HOUR_MS) }],
    seats: { github: { status: "vacant" } }, factoryLedger: { processed: [] }, streamerState: null, streamerRead: true, scoutLastRunAt: null });
  assert.equal(holds.code, undefined, "a role with a recent job is measured");
  assert.match(holds.control, /fuente/);
  assert.match(holds.github, /vacante/);
  assert.match(holds.legal, /apagado/);
  assert.match(holds["factory-builder"], /fábrica/);
  assert.ok(holds["clippers-streamers"] && holds["clippers-publisher"]);
  assert.match(holds["skills-scout"], /releases/);
  assert.ok(pipelineHolds({ now, streamerRead: false })["clippers-editor"].includes("no disponible"));
  let company = applyVitality(hire(["legal", "mechanic", "revenue"]), { now: T0 }).state;
  company = { ...company, careers: { ...company.careers, revenue: { ...company.careers.revenue, inTrainingUntilGeneration: 2 } } };
  const r = tick(company, T0, T0 + 3 * 26 * HOUR_MS, { holds: { legal: holds.legal }, exempt: ["mechanic"] });
  assert.deepEqual(r.decayed, []);
  const rows = vitalityView(r.state, { now: T0 + 3 * 26 * HOUR_MS, names: { legal: "Legal", mechanic: "Mecanico", revenue: "Revenue" }, exempt: ["mechanic"] });
  assert.deepEqual(Object.fromEntries(rows.map(x => [x.agentId, x.state])), { legal: "en_espera", mechanic: "sin_puntuar", revenue: "en_academia" });
});

test("vida 0 review: one proposal per agent, shares the Mechanic cap, cooldown on the career, closed when stale", () => {
  const company = tick(hire(["clippers-editor", "code"]), T0, T0 + 28 * 26 * HOUR_MS).state;
  assert.equal(company.careers.code.battery, 0);
  const now = T0 + 28 * 26 * HOUR_MS;
  const first = deriveVitalityFlagProposals(company, [], now, { code: "Code" });
  assert.deepEqual(first.proposals.map(p => p.key), [`repair:code#vida-cero-g1-${iso(now).slice(0, 10)}`], "clippers-editor (48 h) is not at 0 yet");
  assert.equal(first.proposals[0].kind, "repair");
  assert.match(first.proposals[0].description, /No se borra/);
  assert.ok(first.company.careers.code.vitality?.flagProposedAt);
  assert.equal(deriveVitalityFlagProposals(first.company, [], now + HOUR_MS).proposals.length, 0, "cooldown survives pruned history");
  const mechanic = { key: "repair:code#2026-11-19", kind: "repair" as const, owner: "mechanic", title: "", description: "", evidence: [], handoffBrief: "", createdAt: iso(now), status: "pending_submit" as const };
  assert.equal(deriveVitalityFlagProposals(company, [mechanic], now).proposals.length, 0, "no duplicate of the Mechanic's repair");
  assert.equal(deriveVitalityFlagProposals(company, [], now, {}, [], 0).proposals.length, 0, "shared open-repair cap");
  const recovered = { ...first.company, careers: { ...first.company.careers, code: { ...first.company.careers.code, battery: 6 } } };
  const closed = closeStaleVitalityFlags(first.proposals, recovered, now + HOUR_MS);
  assert.equal(closed[0].status, "withdrawn", "neutral close: neither approved nor rejected by Robert");
  assert.match(closed[0].note || "", /Ya no aplica/);
  assert.equal(closeStaleVitalityFlags(first.proposals, first.company, now)[0].status, "pending_submit");
  const view = vitalityView(company, { now, names: { code: "Code" } });
  assert.equal(view.find(r => r.agentId === "code")?.state, "vida_cero");
  assert.equal(vitalityLiveStatus(view.find(r => r.agentId === "code"), now).problems?.[0], "Vida en cero: no entrega trabajo verificado");
});

const streamerState = (at: number) => ({
  lastRun: { at: iso(at), status: "completed", counts: { candidates: 12 } },
  cloudPublish: {
    version: 1, clips: {},
    lastRun: { at: iso(at), status: "completed", dryRun: false, counts: { rendered: 2, scheduled: 3, blocked: 1 } },
    posts: [
      { id: "stc-1", status: "scheduled", metricoolId: "m1", attemptedAt: iso(at - 1000), observation: { views: 900, observedAt: iso(at - 500) } },
      { id: "stc-2", status: "pending_write", metricoolId: null },
    ],
    learning: {
      evaluatedAt: iso(at), samples: 14,
      experiments: [
        { experimentId: "streamer-hook:tiktok:kong", winner: "teaser", lift: 0.35, reason: "winner_supported", variants: [{ variant: "teaser", samples: 7 }, { variant: "title", samples: 7 }] },
        { experimentId: "streamer-hook:youtube:kong", winner: null, lift: null, reason: "insufficient_samples", variants: [{ variant: "title", samples: 2 }] },
      ],
      hookPreference: { "tiktok:kong": "teaser" },
      creatorBoost: { "twitch:alpha": 0.8, "twitch:beta": -0.6, "twitch:gamma": 0.1 },
    },
  },
});

test("cloud streamer lane receipts become Clippers vida evidence; missing secrets are holds", () => {
  const { evidence, holds } = streamerVitalityEvidence(streamerState(T0), T0);
  const by = Object.fromEntries(evidence.map(e => [e.agentId, e.id]));
  assert.deepEqual(Object.keys(by).sort(), ["clippers-analytics", "clippers-checker", "clippers-editor", "clippers-learning", "clippers-publisher", "clippers-streamers"]);
  assert.equal(by["clippers-publisher"], "streamer-post:stc-1", "only Metricool-confirmed schedules count");
  assert.deepEqual(holds, {});
  const held = streamerVitalityEvidence({ lastRun: { at: iso(T0), status: "skipped_missing_secrets" }, cloudPublish: { version: 1, posts: [], lastRun: { at: iso(T0), status: "held_missing_secrets", counts: {} } } }, T0);
  assert.deepEqual(held.evidence, []);
  assert.ok(held.holds["clippers-streamers"] && held.holds["clippers-publisher"]);
  const dry = streamerVitalityEvidence({ cloudPublish: { version: 1, posts: [], lastRun: { at: iso(T0), status: "completed", dryRun: true, counts: { rendered: 5 } } } }, T0);
  assert.deepEqual(dry.evidence, [], "dry runs are not output");
  assert.deepEqual(streamerVitalityEvidence("garbage", T0), { evidence: [], holds: {} });
});

test("Clippers academy: Metricool lessons (hooks, creators) become academia skills once", () => {
  const lessons = clippersAcademyLessons(streamerState(T0));
  const ids = lessons.map(l => l.id);
  assert.ok(ids.includes("clippers-hook:tiktok:kong:teaser"));
  assert.ok(ids.includes("clippers-hook:youtube:kong:pending"));
  assert.ok(ids.includes("clippers-creator:twitch:alpha:up"));
  assert.ok(ids.includes("clippers-creator:twitch:beta:down"));
  assert.ok(!ids.some(id => id.includes("gamma")), "weak creator signal is not a lesson");
  assert.equal(lessons.find(l => l.id.endsWith(":pending"))?.supported, false);
  let company = hire(CLIPPERS_AGENT_IDS);
  company = learnClippersLessons(company, lessons, T0);
  const editor = company.careers["clippers-editor"].skills || [];
  assert.ok(editor.some(s => s.id === "academia:clippers-hook:tiktok:kong:teaser" && s.source === "academia"));
  assert.ok((company.careers["clippers-streamers"].skills || []).some(s => s.id === "academia:clippers-creator:twitch:alpha:up"));
  assert.ok(!(company.careers["clippers-learning"].skills || []).some(s => s.id.endsWith(":pending")), "unsupported tests are not learned");
  assert.equal(learnClippersLessons(company, lessons, T0 + 1), company, "idempotent");
});

test("automejora: proposals need owner approval, are bounded, deduped, and approval records the improvement", () => {
  const lessons = clippersAcademyLessons(streamerState(T0));
  const jobs = ["2026-11-16", "2026-11-17", "2026-11-18"].map((slot, i) => ({ id: `j${i}`, role: "code", slot, status: "completed", startedAt: `${slot}T10:00:00.000Z`, audit: { diagnostics: ["PR_STALE"] } }));
  const created = deriveSelfImprovementProposals({ proposals: [], lessons: [], roleWorkJobs: jobs, clippersLessons: lessons, now: T0, names: { code: "Code", "clippers-editor": "Editor", "clippers-streamers": "Streamers" } });
  assert.equal(created.length, MAX_OPEN_SELF_IMPROVEMENT, "at most 3 open");
  assert.ok(created.every(p => p.kind === "lesson" && p.status === "pending_submit" && p.key.startsWith("automejora:")));
  const all = deriveSelfImprovementProposals({ proposals: [], lessons: [], roleWorkJobs: jobs, clippersLessons: [], now: T0, names: { code: "Code" } });
  assert.equal(all.length, 1);
  assert.equal(all[0].key, "automejora:code:PR_STALE");
  assert.match(all[0].handoffBrief, /PR-first/);
  assert.equal(deriveSelfImprovementProposals({ proposals: all, lessons: [], roleWorkJobs: jobs, now: T0, names: {} }).length, 0, "one per key");
  assert.equal(deriveSelfImprovementProposals({ proposals: [], lessons: [], roleWorkJobs: jobs.slice(0, 2), now: T0, names: { code: "Code" } }).length, 0, "needs 3 distinct days");
  // Cooldown stamped on the career survives pruned proposal history.
  const stampedCompany = stampSelfImprovementCooldowns(applyVitality(hire(["code"]), { now: T0 }).state, all, T0);
  assert.equal(deriveSelfImprovementProposals({ proposals: [], lessons: [], roleWorkJobs: jobs, now: T0 + 24 * HOUR_MS, names: { code: "Code" }, company: stampedCompany }).length, 0);
  // Approval through the existing flow: lesson -> skill "Mejora aprobada".
  let council = { ...emptyCouncilState(), proposals: all as CouncilProposal[] };
  council = applyApprovedProposal(council, "automejora:code:PR_STALE", T0);
  const company = learnLessons(hire(["code"]), council.lessons, T0);
  assert.ok((company.careers.code.skills || []).some(s => s.title.startsWith("Mejora aprobada:")));
});

test("council round: every agent gets a vida row, cloud Clippers work recovers it, academy and automejora are recorded", async () => {
  let stored: string | null = null;
  let clock = T0;
  const submitted: CouncilProposal[] = [];
  const deps: CouncilDeps = {
    now: () => clock, userId: () => "owner",
    readState: async () => stored, writeState: async raw => { stored = raw; },
    collect: async () => ({}),
    submitProposal: async (_u, p) => { submitted.push(p); return `pa-${submitted.length}`; },
    getPendingActionStatus: async () => "pending",
    fetchLatestRelease: async () => null, log: () => undefined,
    collectVitality: async () => ({ streamerState: streamerState(clock - 60_000) }),
  };
  const council = createAgentCouncil(deps);
  await council.runCycle();
  // Receipts older than the hire never count; the lane's next run (after registration) does.
  clock += 20 * 60_000;
  await council.runCycle();
  const view = await council.view() as unknown as { vitality: Array<{ agentId: string; state: string; vida: number | null }>; clippersAcademy: { lessons: unknown[] } };
  const ids = new Set(view.vitality.map(r => r.agentId));
  for (const id of [...CLIPPERS_AGENT_IDS, ...FACTORY_AGENT_IDS, "code", "news", "legal"]) assert.ok(ids.has(id), `${id} listed`);
  assert.ok(![...ids].some(id => id.startsWith("kong:") || id === "kong-videos"), "KONG keeps its own company");
  const streamers = view.vitality.find(r => r.agentId === "clippers-streamers")!;
  assert.equal(streamers.state, "trabajando");
  assert.equal(streamers.vida, 80 + VITALITY_RECOVERY);
  assert.equal(view.vitality.find(r => r.agentId === "clippers-supervisor")!.state, "sin_entregable");
  assert.ok(view.clippersAcademy.lessons.length >= 3);
  const publicCompany = (await council.view() as any).company;
  assert.equal(publicCompany.careers["clippers-streamers"].vitality.creditedIds, undefined, "receipt ledger is not served");
  const state = parseCouncilState(stored);
  assert.ok((state.company.careers["clippers-editor"].skills || []).some(s => s.source === "academia"));
  assert.ok(submitted.some(p => p.key.startsWith("automejora:clippers-hook:")), "automejora goes to the Trust Center");
});

test("clock-only evidence (already scored elsewhere) restarts the clock without extra vida", () => {
  let company = applyVitality(hire(["br-editor"]), { now: T0 }).state;
  const at = T0 + 70 * HOUR_MS;
  const r = applyVitality(company, { now: at + 1000, evidence: [{ id: "blackroom:q1", agentId: "br-editor", at: iso(at), label: "aprobado", clockOnly: true }] });
  assert.equal(r.state.careers["br-editor"].battery, 80);
  assert.deepEqual(tick(r.state, at + STEP, at + 71 * HOUR_MS).decayed, [], "clock restarted at the approval");
});

test("one missed window, then errors to 0: the existing replacement rule still applies", () => {
  let company = tick(hire(["code"]), T0, T0 + 26 * HOUR_MS + STEP).state;
  assert.equal(company.careers.code.battery, 77);
  assert.equal(company.careers.code.vitality?.zeroByDecay, undefined);
  let fired = 0;
  for (let i = 1; i <= 8 && !fired; i++) {
    const r = advanceCompany(company, { now: T0 + 26 * HOUR_MS + i * 24 * HOUR_MS, roles: { code: "Code" }, statuses: { code: { state: "error", label: "fallo", evidenceId: `err-${i}` } } });
    fired = r.fired.length; company = r.state;
  }
  assert.equal(fired, 1, "inactivity does not shield an agent whose own errors emptied its vida");
  assert.equal(company.careers.code.generation, 2);
});

test("Black Room quiet periods and scout network failures are holds", () => {
  const now = T0;
  const quiet = pipelineHolds({ now, blackroomSignals: [], scoutLastRunAt: iso(now - HOUR_MS), scoutError: "fetch failed" });
  assert.match(quiet["blackroom-publisher"], /Black Room/);
  assert.doesNotMatch(quiet["blackroom-videos"] || "", /Black Room/, "videos follow their own daily role work");
  assert.match(quiet["skills-scout"], /red/);
  const active = pipelineHolds({ now, blackroomSignals: [{ at: iso(now - HOUR_MS) }], scoutLastRunAt: iso(now - HOUR_MS), scoutError: null });
  assert.equal(active["blackroom-publisher"], undefined);
  assert.equal(active["skills-scout"], undefined);
  const lessons = clippersAcademyLessons(streamerState(T0));
  assert.equal(lessons.find(l => l.id === "clippers-creator:twitch:alpha:up")?.samples, 0, "samples come from observed posts, never a constant");
});

test("withdrawn proposals cancel their still-pending Trust Center row once", async () => {
  const withdrawn: string[] = [];
  const proposal = { key: "repair:code#vida-cero-g1-2026-11-01", kind: "repair", owner: "ceo", title: "t", description: "d", evidence: [], handoffBrief: "b", createdAt: iso(T0 - 9 * 24 * HOUR_MS), status: "withdrawn", closedAt: iso(T0 - HOUR_MS), pendingActionId: "pa-9", note: "Ya no aplica" };
  let stored: string | null = JSON.stringify({ ...emptyCouncilState(), proposals: [proposal] });
  let clock = T0;
  const council = createAgentCouncil({
    now: () => clock, userId: () => "owner", readState: async () => stored, writeState: async raw => { stored = raw; },
    collect: async () => ({}), submitProposal: async () => "pa-x", getPendingActionStatus: async () => "pending",
    fetchLatestRelease: async () => null, log: () => undefined,
    withdrawProposal: async (_u, id) => { withdrawn.push(id); },
  });
  await council.runCycle();
  clock += 20 * 60_000;
  await council.runCycle();
  assert.deepEqual(withdrawn, ["pa-9"]);
  assert.ok(parseCouncilState(stored).proposals.find(p => p.key === proposal.key)?.pendingActionClosedAt);
});
