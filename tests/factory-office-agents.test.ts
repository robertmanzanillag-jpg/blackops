import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AGENT_NAMES, createAgentCouncil, CouncilStateConflict } from "../server/agent-council";
import { registerAgentCouncilRoutes } from "../server/agent-council-routes";
import { createFactoryCareerSweep } from "../server/software-factory-office-careers";
import { reserveAcademyReview } from "../server/office-academy-runner";
import { emptyCouncilState, parseCouncilState } from "../shared/agent-council";
import { isKongCompanyAgent, separateLegacyKongCompany, emptyCompanyState } from "../shared/agent-company";
import {
  FACTORY_AGENTS, FACTORY_AGENT_IDS, FACTORY_DEPARTMENT, applyFactoryStageOutcomes, classifyFactoryStageOutcome, emptyFactoryCareerLedger,
  factoryAgentStatus, factoryAgentsView, factoryStageEvidenceId, parseFactoryCareerLedger, type FactoryJobRow,
} from "../shared/factory-office-agents";

const OWNER = "owner";
const KEY = createHash("sha256").update(OWNER).digest("hex");
const T0 = Date.parse("2026-11-10T00:00:00Z");
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
function job(kind: string, status: string, at: number, result: Record<string, unknown> = {}, extra: Partial<FactoryJobRow> = {}): FactoryJobRow {
  seq++;
  return { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, kind, status, ownerKey: KEY, createdAt: iso(at - 60_000),
    ...(["completed", "failed", "blocked"].includes(status) ? { completedAt: iso(at) } : {}), payload: { repairAttempts: 0 },
    result: ["completed", "failed", "blocked"].includes(status) ? { status, costCents: 3, ...result } : undefined, ...extra };
}
function hired(now = T0) {
  return applyFactoryStageOutcomes({ company: emptyCompanyState(), ledger: emptyFactoryCareerLedger(), jobs: [], ownerKey: KEY, now });
}

test("factory engineers are main-company careers in the office roster, never KONG", () => {
  assert.deepEqual(FACTORY_AGENT_IDS, ["factory-scout", "factory-builder", "factory-qa", "factory-reviewer"]);
  assert.deepEqual(FACTORY_AGENTS.map(a => a.stage), ["discover", "build", "simulate", "review"]);
  assert.equal(FACTORY_DEPARTMENT, "Ingeniería / Fábrica");
  for (const id of FACTORY_AGENT_IDS) { assert.equal(isKongCompanyAgent(id), false); assert.ok(AGENT_NAMES[id]); }
  const { company } = hired();
  for (const id of FACTORY_AGENT_IDS) {
    const career = company.careers[id];
    assert.equal(career.battery, 80); assert.equal(career.generation, 1); assert.equal(career.points, 0); assert.equal(career.hiredAt, iso(T0));
  }
  // KONG separation keeps them in the main company, untouched.
  const separated = separateLegacyKongCompany(company, emptyCompanyState());
  assert.deepEqual(Object.keys(separated.company.careers).sort(), [...FACTORY_AGENT_IDS].sort());
  assert.deepEqual(separated.archived.careers, {});
  // A parsed council keeps them in company (never kongCompany).
  const state = parseCouncilState(JSON.stringify({ ...emptyCouncilState(), company }));
  assert.deepEqual(Object.keys(state.kongCompany.careers), []);
  assert.equal(Object.keys(state.company.careers).length, 4);
});

test("live presence: working only while a stage lease is live; otherwise last worked at", () => {
  const now = T0 + 10 * H;
  const rows = [
    job("build", "running", now, {}, { leaseExpiresAt: iso(now + 5 * 60_000) }),
    job("simulate", "running", now, {}, { leaseExpiresAt: iso(now - 1) }), // expired lease is never "working"
    job("discover", "completed", now - H),
    job("review", "completed", now - 2 * H, {}, { ownerKey: "f".repeat(64) }), // foreign owner ignored
  ];
  const view = factoryAgentsView({ liveJobs: rows, ownerKey: KEY, now });
  const by = Object.fromEntries(view.map(v => [v.agentId, v]));
  assert.equal(by["factory-builder"].state, "working");
  assert.equal(by["factory-qa"].state, "idle");
  assert.equal(by["factory-scout"].lastWorkedAt, iso(now - H));
  assert.equal(by["factory-reviewer"].source, "none");
  assert.equal(factoryAgentStatus(by["factory-builder"], "ready").state, "working");
  // Completed within the last day, no failure: on duty ("Activo · al día"), still not "working".
  const scout = factoryAgentStatus(by["factory-scout"], "ready", now);
  assert.equal(scout.state, "available");
  assert.equal(scout.label, "Activo · al día");
  assert.equal(scout.onDuty?.lastWorkAt, iso(now - H));
  assert.match(scout.detail || "", /^Último trabajo \d{2}:\d{2}/);
  // A day later the same completion is only "last worked at".
  const later = factoryAgentStatus(by["factory-scout"], "ready", now + 25 * H);
  assert.equal(later.onDuty, undefined);
  assert.match(later.label, /Ultimo trabajo/);
  // An attributable failure is never shown as on duty.
  assert.equal(factoryAgentStatus({ ...by["factory-scout"], lastOutcome: "attributable_failure" }, "ready", now).onDuty, undefined);
  // Web asleep / store unreadable: persisted observation only, never optimistic.
  const persisted = applyFactoryStageOutcomes({ ...hired(now - 3 * H), jobs: [rows[0], rows[2]], ownerKey: KEY, now: now - 60_000 }).ledger;
  const offline = factoryAgentsView({ ledger: persisted, liveJobs: "unavailable", ownerKey: KEY, now: now + H });
  const b = offline.find(v => v.agentId === "factory-builder")!;
  assert.equal(b.state, "idle"); assert.equal(b.lastJobStatus, "observed_running"); assert.equal(b.live, "unavailable");
  assert.equal(offline.find(v => v.agentId === "factory-scout")!.lastWorkedAt, iso(now - H));
  assert.equal(factoryAgentStatus(undefined, "loading").state, "checking");
});

test("scoring: +6 per verified stage, -10 per attributable failure, exemptions like other roles", () => {
  const start = hired();
  const at = (h: number) => T0 + h * H;
  const scored = [
    job("discover", "completed", at(1)),
    job("build", "completed", at(1)),
    job("simulate", "completed", at(1), { reason: "FACTORY_REPAIR_REQUESTED" }), // a negative QA verdict is QA's work done
    job("review", "completed", at(1), { reason: "FACTORY_PR_REVIEWED_NOT_DEPLOYED" }),
    job("build", "failed", at(2), { reason: "FACTORY_REMOTE_BUILD_FAILED:MALFORMED_JSON" }),
    job("build", "blocked", at(3), { reason: "FACTORY_BUILD_CHECKS_FAILED" }),
    job("discover", "blocked", at(2), { reason: "FACTORY_AUTO_SELECTION_PATH_NOT_FOUND" }),
  ];
  const exempt = [
    job("build", "failed", at(4), { reason: "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_OUTPUT_LIMIT" }), // provider result
    job("build", "failed", at(4), { reason: "FACTORY_REMOTE_BUILD_FAILED:SOURCE" }), // source/transport
    job("build", "blocked", at(4), { reason: "FACTORY_DAILY_DRAFT_PR_LIMIT", costCents: 0 }), // daily cap
    job("discover", "blocked", at(4), { reason: "FACTORY_AUTO_SELECTION_CREDIT_UNAVAILABLE", costCents: 0 }), // credit
    job("discover", "blocked", at(4), { reason: "FACTORY_AUTO_SELECTION_TEST_PATH_REQUIRED", costCents: 0 }), // repository has no test path: no model answer
    job("discover", "completed", at(4), { reason: "FACTORY_NO_ACTIONABLE_FINDING" }), // legitimately empty
    job("review", "blocked", at(4), { reason: "FACTORY_PROPOSAL_EVIDENCE_STALE" }),
    job("simulate", "failed", at(4), { reason: "FACTORY_RECONCILED_BY_OPERATOR" }),
  ];
  const ignored = [
    job("build", "unknown", at(5), {}, { result: {} }), // unconfirmed provider outcome
    job("build", "pending", at(5), {}, { result: { deferred: { reason: "FACTORY_DAILY_DRAFT_PR_LIMIT", notBefore: iso(at(30)) } } }),
    job("build", "running", at(5), {}, { leaseExpiresAt: iso(at(5)) }),
    job("deploy", "completed", at(5)), // not a career stage
  ];
  for (const row of exempt) assert.equal(classifyFactoryStageOutcome(row)!.outcome, "exempt", String((row.result as any).reason));
  for (const row of ignored) assert.equal(classifyFactoryStageOutcome(row), undefined);
  const r = applyFactoryStageOutcomes({ ...start, jobs: [...scored, ...exempt, ...ignored], ownerKey: KEY, now: at(6) });
  const c = r.company.careers;
  assert.equal(c["factory-scout"].battery, 80 + 6 - 10);
  assert.equal(c["factory-builder"].battery, 80 + 6 - 10 - 10);
  assert.equal(c["factory-qa"].battery, 86);
  assert.equal(c["factory-reviewer"].battery, 86);
  assert.equal(r.scored.length, scored.length);
  assert.ok(c["factory-builder"].evaluatedEvidenceIds!.includes(factoryStageEvidenceId(scored[1])));
  assert.match(factoryStageEvidenceId(scored[1]), /^factory:[0-9a-f-]{36}:build:0$/);
  assert.equal(r.ledger.processed.filter(e => e.outcome === "exempt").length, exempt.length);
  // Life never exceeds 100.
  const many = Array.from({ length: 10 }, (_, i) => job("simulate", "completed", at(7 + i)));
  assert.equal(applyFactoryStageOutcomes({ ...r, jobs: many, ownerKey: KEY, now: at(20) }).company.careers["factory-qa"].battery, 100);
});

test("idempotent per job stage attempt across replays, restarts and the durable council sweep", async () => {
  const at = T0 + 30 * H;
  const rows = [job("build", "completed", at - H), job("build", "failed", at - H / 2, { reason: "FACTORY_ACTIONS_CHECK_FAILED" })];
  const first = applyFactoryStageOutcomes({ ...hired(T0), jobs: rows, ownerKey: KEY, now: at });
  const again = applyFactoryStageOutcomes({ ...first, jobs: [...rows, ...rows], ownerKey: KEY, now: at + H });
  assert.equal(again.company.careers["factory-builder"].battery, 76);
  assert.equal(again.scored.length, 0);
  // A repair attempt is a separate job and evidence id.
  assert.notEqual(factoryStageEvidenceId({ id: "j", kind: "build", payload: { repairAttempts: 1 } }), factoryStageEvidenceId({ id: "j", kind: "build", payload: { repairAttempts: 0 } }));

  // Durable path: shared versioned council state with a CAS conflict replay.
  let raw = JSON.stringify(emptyCouncilState()), revision = 0, writes = 0, conflictOnce = true;
  const council = () => createAgentCouncil({ now: () => at, userId: () => OWNER, readState: async () => raw, writeState: async () => {},
    versioned: { read: async () => ({ raw, revision }), write: async (next, expected) => {
      if (conflictOnce) { conflictOnce = false; revision++; throw new CouncilStateConflict("concurrent"); }
      if (expected !== revision) throw new CouncilStateConflict(); writes++; raw = next; return ++revision; } },
    collect: async () => ({}), submitProposal: async () => "", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  const live = [job("review", "completed", at - 60_000)];
  const sweep = createFactoryCareerSweep({ owner: OWNER, council: council(), readJobs: async () => live, now: () => at });
  const [a, b] = await Promise.all([sweep(), sweep()]);
  assert.deepEqual(a, b); // concurrent calls share one sweep
  await createFactoryCareerSweep({ owner: OWNER, council: council(), readJobs: async () => live, now: () => at })(); // restart
  const loaded = await council().load();
  // Hired at the first sweep: the job completed before hire is history, never scored.
  assert.equal(loaded.company.careers["factory-reviewer"].battery, 80);
  assert.equal(parseFactoryCareerLedger(loaded.officeExecution!.factoryCareers).processed[0].outcome, "before_hire");
  live.push(job("review", "completed", at + 1));
  const later = createFactoryCareerSweep({ owner: OWNER, council: council(), readJobs: async () => live, now: () => at + 2 });
  assert.equal((await later()).scored, 1); assert.equal((await later()).scored, 0);
  assert.equal((await council().load()).company.careers["factory-reviewer"].battery, 86);
  assert.ok(writes >= 3);
  assert.equal("officeExecution" in await council().view(), false);
  assert.throws(() => parseFactoryCareerLedger({ version: 1, processed: [{ evidenceId: "x" }], presence: {} }), /FACTORY_CAREER_LEDGER_INVALID/);
});

test("retirement at zero life after 24 h tenure brings a successor generation through the academy", () => {
  let state = hired(T0);
  const fail = (h: number) => job("build", "failed", T0 + h * H, { reason: "FACTORY_REMOTE_BUILD_FAILED:EMPTY_PATCH" });
  // Eight attributable failures inside the first day: life 0 but tenure protects the holder.
  state = applyFactoryStageOutcomes({ ...state, jobs: Array.from({ length: 8 }, (_, i) => fail(1 + i)), ownerKey: KEY, now: T0 + 10 * H });
  assert.equal(state.company.careers["factory-builder"].battery, 0);
  assert.equal(state.company.careers["factory-builder"].generation, 1);
  // The next attributable failure after 24 h tenure retires it.
  state = applyFactoryStageOutcomes({ ...state, jobs: [fail(25)], ownerKey: KEY, now: T0 + 26 * H });
  const career = state.company.careers["factory-builder"];
  assert.equal(career.generation, 2); assert.equal(career.battery, 60); assert.equal(career.firedCount, 1);
  assert.equal(career.inTrainingUntilGeneration, 2);
  assert.equal(state.company.retiredCareers!.at(-1)!.generation, 1);
  const trainee = state.company.trainees.find(t => t.id === "factory-builder#2")!;
  assert.equal(trainee.purpose, "candidate"); assert.equal(trainee.forAgentId, "factory-builder");
  // While the successor is in training its stage results are recorded but never scored.
  const after = applyFactoryStageOutcomes({ ...state, jobs: [job("build", "completed", T0 + 27 * H)], ownerKey: KEY, now: T0 + 28 * H });
  assert.equal(after.company.careers["factory-builder"].battery, 60);
  assert.equal(after.ledger.processed.at(-1)!.outcome, "in_training");
  // No factory academy adapter exists: the existing academy says so and never fakes qualification.
  const academy = reserveAcademyReview(after.company, [{ id: "m", title: "m", summary: "s" }], T0 + 28 * H, "job-1");
  assert.equal(academy.job, undefined);
  assert.match(academy.state.trainees.find(t => t.id === "factory-builder#2")!.executionBlocker!, /No verified training adapter/);
  assert.equal(academy.state.trainees.find(t => t.id === "factory-builder#2")!.graduatedAt, undefined);
});

test("browser reads never write: state route overlays a read-only live lease read", async () => {
  const at = T0 + 40 * H;
  let raw = JSON.stringify(emptyCouncilState()), revision = 0, writes = 0, factoryReads = 0;
  const council = createAgentCouncil({ now: () => at, userId: () => OWNER, readState: async () => raw, writeState: async () => { writes++; },
    versioned: { read: async () => ({ raw, revision }), write: async next => { writes++; raw = next; return ++revision; } },
    collect: async () => ({}), submitProposal: async () => "", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  const handlers = new Map<string, any>();
  const app = { get: (path: string, handler: any) => handlers.set(path, handler), post: () => {} };
  const store = { list: async (owner: string) => { factoryReads++; assert.equal(owner, OWNER);
    return [job("build", "running", at, {}, { leaseExpiresAt: iso(at + 60_000), payload: { secret: "PAYLOAD_MUST_NOT_LEAK" } })]; } };
  registerAgentCouncilRoutes(app as any, { council, requestUserId: (req: any) => req.user, ownerUserId: () => OWNER, readFactoryJobs: owner => store.list(owner), now: () => at });
  const response = () => ({ code: 200, body: undefined as any, headers: {} as any, set(k: string, v: string) { this.headers[k] = v; return this; }, status(c: number) { this.code = c; return this; }, json(v: any) { this.body = v; return this; } });
  const owner = response();
  await handlers.get("/api/agent-council/state")({ user: OWNER }, owner);
  assert.equal(owner.code, 200);
  const builder = owner.body.factoryAgents.find((a: any) => a.agentId === "factory-builder");
  assert.equal(builder.state, "working"); assert.equal(builder.source, "live");
  assert.doesNotMatch(JSON.stringify(owner.body), /PAYLOAD_MUST_NOT_LEAK/);
  const other = response();
  await handlers.get("/api/agent-council/state")({ user: "someone-else" }, other);
  assert.ok(other.body.factoryAgents.every((a: any) => a.state === "idle" && a.live === "not_read"));
  // Cached for 30 s, and nothing was written by either browser request.
  await handlers.get("/api/agent-council/state")({ user: OWNER }, response());
  assert.equal(factoryReads, 1);
  assert.equal(writes, 0);
  assert.equal(Object.keys((await council.load()).company.careers).length, 0); // no hire from a browser read
});
