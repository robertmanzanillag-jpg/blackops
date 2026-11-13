import test from "node:test";
import assert from "node:assert/strict";
import { emptyCompanyState } from "../shared/agent-company";
import { advanceKongCompany } from "../server/kong-company";
import { createAgentCouncil } from "../server/agent-council";
import { emptyCouncilState, parseCouncilState } from "../shared/agent-council";
import type { OfficeKongAuditResult } from "../server/office-kong";
const NOW = Date.parse("2026-11-05T12:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60000).toISOString();
function evidence(): OfficeKongAuditResult["evidence"] {
  return { generatedAt: at(0), citySnapshotCheckedAt: at(0), cityAgentsEnabled: true, cityCoverageComplete: false,
    agents: [{ id: "venues", name: "Venues", kind: "department", owner: "CEO", responsibility: "Fichas", state: "healthy", lastRunAt: at(-1), nextRunAt: at(10), blocker: null, nextAction: "Esperar", issues: [] }],
    cities: [{ id: "miami", name: "Miami", countryCode: "US", timeZone: "America/New_York", currency: "USD", status: "healthy", categories: [{ category: "clubs", state: "healthy", lastRunAt: at(-1), lastSuccessAt: at(-1), lastStartedAt: at(-2), nextRunAt: at(10), intervalMs: 3600000, issues: [], evidence: "persisted", recordedFailure: false }] }] };
}
const start = () => ({ company: emptyCompanyState(), evidenceAt: {}, evidence: evidence(), now: NOW });
test("KONG credits only new completed results, not repeated snapshots", () => {
  const first = advanceKongCompany(start());
  assert.equal(first.company.careers["kong:venues"].points, 10);
  assert.equal(first.company.careers["kong-city:miami:clubs"].points, 10);
  const repeated = advanceKongCompany({ ...start(), company: first.company, evidenceAt: first.evidenceAt });
  assert.deepEqual(repeated.company, first.company);
  const newer = evidence(); newer.cities[0].categories[0].lastRunAt = at(0); newer.cities[0].categories[0].lastSuccessAt = at(0);
  const next = advanceKongCompany({ ...start(), company: first.company, evidenceAt: first.evidenceAt, evidence: newer });
  assert.equal(next.company.careers["kong-city:miami:clubs"].points, 20);
  assert.equal(next.company.careers["kong:venues"].points, 10);
});
test("stale or unavailable observations cannot earn points or penalize agents", () => {
  const first = advanceKongCompany(start());
  for (const input of [{ evidence: undefined, now: NOW }, { evidence: evidence(), now: NOW + 6 * 60000 }]) {
    const result = advanceKongCompany({ company: first.company, evidenceAt: first.evidenceAt, ...input });
    assert.deepEqual(result.company, first.company);
    assert.deepEqual(result.statuses, {});
    assert.equal(result.collaboration.verified, false);
  }
});
test("running leases have live activity but earn no completion credit", () => {
  const snapshot = evidence();
  snapshot.agents[0].state = "running";
  snapshot.cities[0].categories[0] = { ...snapshot.cities[0].categories[0], state: "running", lastStartedAt: at(0), leaseUntil: at(2) };
  const result = advanceKongCompany({ ...start(), evidence: snapshot });
  assert.equal(result.statuses["kong-city:miami:clubs"].state, "working");
  assert.equal(result.company.careers["kong-city:miami:clubs"].points, 0);
  assert.equal(result.statuses["kong:venues"].state, "offline");
  assert.equal(result.company.careers["kong:venues"], undefined);
});
test("failure discussions are evidence-backed and a repeated failure is scored once", () => {
  const snapshot = evidence();
  snapshot.cities[0].categories[0] = { ...snapshot.cities[0].categories[0], state: "attention", recordedFailure: true, lastSuccessAt: at(-60), attemptsSinceSuccess: 2 };
  const first = advanceKongCompany({ ...start(), evidence: snapshot });
  assert.equal(first.collaboration.totalFindings, 1);
  assert.equal(first.collaboration.exchanges[0].proposal.action, "review_reassignment");
  const again = advanceKongCompany({ ...start(), evidence: snapshot, company: first.company, evidenceAt: first.evidenceAt });
  assert.deepEqual(again.company, first.company);
  assert.deepEqual(again.collaboration, first.collaboration);
});
test("council persists KONG isolation and scoped orders survive restart", async () => {
  let raw: string | null = null;
  let now = NOW;
  const deps = { now: () => now, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; }, collect: async () => ({}), collectKongEvidence: async () => evidence(), submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} };
  const council = createAgentCouncil(deps);
  await council.runCycle();
  let view = await council.view();
  assert.equal(view.company.careers["kong:venues"], undefined);
  assert.equal(view.kongCompany.careers["kong:venues"].points, 10);
  await council.placeOrder("Revisar clubs Miami", "kong");
  view = await createAgentCouncil(deps).view();
  assert.equal(view.company.orders.length, 0);
  assert.equal(view.kongCompany.orders.length, 1);
  assert.equal(view.kongCompany.orders[0].assignees[0].status, "bloqueada");
  await assert.rejects(council.finishOrder(view.kongCompany.orders[0].id, "unrelated-run", "owner", "kong"), /genérica/);
  now += 6 * 60000;
  assert.deepEqual((await council.view()).kongLastStatuses, {});
  assert.equal((await council.view()).kongCollaboration.verified, false);
});
test("old state loads empty isolated KONG company", () => {
  const old = emptyCouncilState() as any; delete old.kongCompany; delete old.kongEvidenceAt; delete old.kongCollaboration;
  const parsed = parseCouncilState(JSON.stringify(old));
  assert.deepEqual(parsed.kongCompany, emptyCompanyState());
  assert.deepEqual(parsed.kongEvidenceAt, {});
  assert.equal(parsed.kongCollaboration.verified, false);
});

test("legacy KONG careers and academy are quarantined, never replayed or advanced in BlackOps", async () => {
  const { advanceCompany } = await import("../shared/agent-company");
  const old = emptyCouncilState();
  // Preserve a verified local career while quarantining the unproven KONG history.
  old.company = advanceCompany(old.company, { now: NOW, statuses: { "kong-city:miami:clubs": { state: "working", label: "legacy" }, radio: { state: "working", label: "radio", evidenceId: "fixture:radio:verified-completed-run" } }, roles: {} }).state;
  old.company.careers["kong-city:miami:clubs"].points = 1234;
  old.company.trainees.push({ id: "old-kong-helper", forAgentId: "kong-city:miami:clubs", role: "Clubs", nickname: "Old helper", startedAt: at(-60), modulesDone: ["old-module"], knowledge: ["Old knowledge"] });
  old.proposals.push({ key: "new_agent:helper-kong-city:miami:clubs", kind: "new_agent", owner: "agent-factory", title: "Contratar helper", description: "legacy", evidence: [], handoffBrief: "legacy", createdAt: at(-60), status: "applied" });
  let raw = JSON.stringify(old);
  const parsed = parseCouncilState(raw);
  assert.equal(parsed.company.careers["kong-city:miami:clubs"], undefined);
  assert.equal(parsed.company.trainees.length, 0);
  assert.equal(parsed.company.careers.radio.points, 10);
  assert.equal(parsed.kongLegacyCompany.careers["kong-city:miami:clubs"].points, 1234);
  assert.deepEqual(parsed.kongCompany, emptyCompanyState());
  assert.deepEqual(parseCouncilState(JSON.stringify(parsed)), parsed, "migration is idempotent");
  const council = createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async value => { raw = value; }, collect: async () => ({}), collectKongEvidence: async () => evidence(), submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  await council.runCycle();
  const state = await council.load();
  assert.equal(state.company.trainees.length, 0, "old applied helper cannot enroll again");
  assert.deepEqual(state.kongLegacyCompany.trainees[0].modulesDone, ["old-module"], "archive never advances");
  assert.equal(state.kongCompany.careers["kong-city:miami:clubs"].points, 10, "only new verified result earns points");
  assert.equal("kongLegacyCompany" in await council.view(), false, "historical private state is not exposed");
});

test("missing and disabled city jobs do not acquire invented life or careers", () => {
  for (const disabled of [false, true]) {
    const snapshot = evidence();
    if (disabled) snapshot.cityAgentsEnabled = false;
    else snapshot.cities[0].categories = [];
    const result = advanceKongCompany({ ...start(), evidence: snapshot });
    assert.deepEqual(Object.keys(result.company.careers).filter(id => id.startsWith("kong-city:")), []);
  }
});

test("declared central roles without a verified result stay unscored", () => {
  for (const state of ["unknown", "disabled", "running"] as const) {
    const snapshot = evidence();
    snapshot.agents[0] = { ...snapshot.agents[0], state, lastRunAt: null };
    const result = advanceKongCompany({ ...start(), evidence: snapshot });
    assert.equal(result.company.careers["kong:venues"], undefined);
  }
});

// Production shape since 2026-11-06: every round closes with a coverage incident, so KONG reports "attention".
function warned(overrides: Record<string, unknown> = {}) {
  const snapshot = evidence();
  snapshot.cities[0].categories[0] = { ...snapshot.cities[0].categories[0], state: "attention", issues: ["Incidencia registrada. Revisa el detalle en KONG."], recordedFailure: false, attemptsSinceSuccess: 0, ...overrides };
  return snapshot;
}
const CLUBS = "kong-city:miami:clubs";

test("a completed round flagged as attention for coverage incidents is credited once", () => {
  const first = advanceKongCompany({ ...start(), evidence: warned() });
  assert.equal(first.company.careers[CLUBS].points, 10);
  assert.equal(first.evidenceAt[CLUBS], at(-1));
  const again = advanceKongCompany({ ...start(), evidence: warned(), company: first.company, evidenceAt: first.evidenceAt });
  assert.deepEqual(again.company, first.company);
  // Even when the success stamp is written a few ms after the completion stamp (same round).
  const next = advanceKongCompany({ ...start(), evidence: warned({ lastRunAt: at(0), lastSuccessAt: new Date(NOW + 5).toISOString(), lastStartedAt: at(-0.5) }), company: first.company, evidenceAt: first.evidenceAt, now: NOW + 10 });
  assert.equal(next.company.careers[CLUBS].points, 20);
});

test("a partial round limited by HTTP 429 is credited when it completed, and a stamped error on the same round does not drain", () => {
  const limited = advanceKongCompany({ ...start(), evidence: warned({ issues: ["Incidencia registrada. Revisa el detalle en KONG.", "La fuente limitó las consultas (HTTP 429)."] }) });
  assert.equal(limited.company.careers[CLUBS].points, 10);
  const stamped = advanceKongCompany({ ...start(), evidence: warned({ recordedFailure: true }) });
  assert.equal(stamped.company.careers[CLUBS].points, 10);
  assert.equal(stamped.company.careers[CLUBS].battery, 86);
});

test("a real failure without a new success drains battery once", () => {
  const base = advanceKongCompany({ ...start(), evidence: warned() });
  for (const failure of [{ recordedFailure: true }, { recordedFailure: false, attemptsSinceSuccess: 1 }]) {
    const failed = warned({ ...failure, lastStartedAt: at(-0.5), lastRunAt: at(0), lastSuccessAt: at(-1 - 60) });
    const first = advanceKongCompany({ ...start(), evidence: failed, company: base.company, evidenceAt: { [CLUBS]: at(-61) } });
    assert.equal(first.company.careers[CLUBS].battery, base.company.careers[CLUBS].battery - 10);
    assert.equal(first.company.careers[CLUBS].points, 5);
    const again = advanceKongCompany({ ...start(), evidence: failed, company: first.company, evidenceAt: first.evidenceAt });
    assert.deepEqual(again.company, first.company);
  }
  // A closed attempt with no success, no error and no pending attempts proves nothing either way.
  const unclear = advanceKongCompany({ ...start(), evidence: warned({ lastRunAt: at(0), lastSuccessAt: at(-61), lastStartedAt: at(-0.5) }), company: base.company, evidenceAt: { [CLUBS]: at(-61) } });
  assert.deepEqual(unclear.company, base.company);
});

test("a missed turn is penalized once per nextRunAt, and a later real run still earns credit", () => {
  const base = advanceKongCompany({ ...start(), evidence: warned() });
  const missed = warned({ lastStartedAt: at(-300), lastRunAt: at(-299), lastSuccessAt: at(-299), nextRunAt: at(-239) });
  const ledger = { [CLUBS]: at(-299) };
  const first = advanceKongCompany({ ...start(), evidence: missed, company: base.company, evidenceAt: ledger });
  assert.equal(first.company.careers[CLUBS].points, 8);
  assert.equal(first.company.careers[CLUBS].battery, base.company.careers[CLUBS].battery - 3);
  assert.equal(first.evidenceAt[CLUBS], at(-239));
  const again = advanceKongCompany({ ...start(), evidence: missed, company: first.company, evidenceAt: first.evidenceAt });
  assert.deepEqual(again.company, first.company);
  // Late by less than three hours is not a missed turn.
  const late = advanceKongCompany({ ...start(), evidence: warned({ lastStartedAt: at(-200), lastRunAt: at(-199), lastSuccessAt: at(-199), nextRunAt: at(-139) }), company: base.company, evidenceAt: { [CLUBS]: at(-199) } });
  assert.deepEqual(late.company, base.company);
  const recovered = advanceKongCompany({ ...start(), evidence: warned({ lastStartedAt: at(-1), lastRunAt: at(-0.5), lastSuccessAt: at(-0.5), nextRunAt: at(59) }), company: first.company, evidenceAt: first.evidenceAt });
  assert.equal(recovered.company.careers[CLUBS].points, 18);
});

test("a stale snapshot credits and penalizes nothing, including warned, failed or missed jobs", () => {
  const base = advanceKongCompany({ ...start(), evidence: warned() });
  for (const snapshot of [warned({ lastRunAt: at(0), lastSuccessAt: at(0) }), warned({ recordedFailure: true, lastRunAt: at(0), lastSuccessAt: at(-61) }), warned({ nextRunAt: at(-239), lastRunAt: at(-299), lastSuccessAt: at(-299), lastStartedAt: at(-300) })]) {
    const result = advanceKongCompany({ company: base.company, evidenceAt: base.evidenceAt, evidence: snapshot, now: NOW + 6 * 60000 });
    assert.deepEqual(result.company, base.company);
    assert.deepEqual(result.evidenceAt, base.evidenceAt);
  }
});

test("central departments reporting healthy with report notes are credited; blockers and attention are not", () => {
  const notes = evidence(); notes.agents[0].issues = ["Cobertura parcial"];
  assert.equal(advanceKongCompany({ ...start(), evidence: notes }).company.careers["kong:venues"].points, 10);
  const blocked = evidence(); blocked.agents[0].blocker = "Falta credencial";
  assert.equal(advanceKongCompany({ ...start(), evidence: blocked }).company.careers["kong:venues"], undefined);
  const attention = evidence(); attention.agents[0].state = "attention";
  assert.equal(advanceKongCompany({ ...start(), evidence: attention }).company.careers["kong:venues"], undefined);
});

test("a transient KONG read failure is retried within the round instead of freezing KONG careers", async () => {
  let raw: string | null = null;
  let reads = 0;
  const logs: string[] = [];
  const council = createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; }, collect: async () => ({}),
    collectKongEvidence: async () => { reads++; if (reads === 1) throw Object.assign(new Error("KONG no respondio dentro del tiempo permitido."), { code: "TIMEOUT" }); return evidence(); },
    submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: (line: string) => { logs.push(line); } });
  await council.runCycle();
  const view = await council.view();
  assert.equal(reads, 2, "one retry");
  assert.equal(view.kongCompany.careers["kong:venues"].points, 10, "the retried read still credits the round");
  assert.ok(logs.some(line => /KONG evidence read failed \(attempt 1\/2\): TIMEOUT/.test(line)), "the reason code is logged, not swallowed");
  assert.deepEqual({ ok: view.kongRead?.ok, code: view.kongRead?.code }, { ok: true, code: null });
});

test("a round without verified KONG records the reason and catches KONG up between rounds", async () => {
  let raw: string | null = null;
  let now = NOW;
  let failing = true;
  const scheduled: Array<{ run: () => void; ms: number }> = [];
  const council = createAgentCouncil({ now: () => now, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; }, collect: async () => ({}),
    collectKongEvidence: async () => { if (failing) throw Object.assign(new Error("x"), { code: "CONNECTION_FAILED" }); return evidence(); },
    scheduleKongCatchUp: (run: () => void, ms: number) => { scheduled.push({ run, ms }); },
    submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  await council.runCycle();
  let view = await council.view();
  assert.deepEqual({ ok: view.kongRead?.ok, code: view.kongRead?.code }, { ok: false, code: "CONNECTION_FAILED" }, "the reason is visible in the state");
  assert.equal(view.kongCompany.careers["kong:venues"], undefined);
  assert.equal(scheduled.length, 1, "a KONG-only catch-up is scheduled");
  assert.equal(scheduled[0].ms, 2 * 60_000);
  // KONG recovers before the next 15-minute round.
  failing = false;
  now += 2 * 60_000;
  await council.runKongCatchUp(1);
  view = await council.view();
  assert.equal(view.kongCompany.careers["kong:venues"].points, 10, "careers advance without waiting for the next round");
  assert.equal(view.kongRead?.ok, true);
  assert.ok(view.kongObservedAt);
  assert.equal(scheduled.length, 1, "no further retries after success");
});

test("KONG catch-up stops after three failed attempts", async () => {
  let raw: string | null = null;
  const scheduled: Array<() => void> = [];
  const council = createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; }, collect: async () => ({}),
    collectKongEvidence: async () => { throw Object.assign(new Error("x"), { code: "UNAUTHENTICATED" }); },
    scheduleKongCatchUp: (run: () => void) => { scheduled.push(run); },
    submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  await council.runCycle();
  await council.runKongCatchUp(1);
  await council.runKongCatchUp(2);
  await council.runKongCatchUp(3);
  assert.equal(scheduled.length, 3, "round + attempts 1 and 2 schedule; attempt 3 is the last");
  assert.equal((await council.view()).kongRead?.code, "UNAUTHENTICATED");
});

test("a KONG snapshot read before slow collectors is re-read before scoring instead of expiring", async () => {
  let raw: string | null = null;
  let now = NOW;
  let reads = 0;
  const council = createAgentCouncil({ now: () => now, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; },
    // A cold start: the other collectors take 5.5 minutes, longer than KONG's 5-minute freshness window.
    collect: async () => { await new Promise(resolve => setTimeout(resolve, 5)); now += 5.5 * 60_000; return {}; },
    collectKongEvidence: async () => {
      reads++;
      const snapshot = evidence();
      const shift = (value: string | null) => value && new Date(Date.parse(value) + (now - NOW)).toISOString();
      snapshot.generatedAt = shift(snapshot.generatedAt)!; snapshot.citySnapshotCheckedAt = shift(snapshot.citySnapshotCheckedAt)!;
      return snapshot;
    },
    scheduleKongCatchUp: () => { throw new Error("no catch-up needed"); },
    submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  await council.runCycle();
  const view = await council.view();
  assert.equal(reads, 2, "re-read once right before scoring");
  assert.equal(view.kongRead?.ok, true);
  assert.equal(view.kongCompany.careers["kong:venues"].points, 10);
});

test("when another process ran the round without KONG, this instance still catches KONG up", async () => {
  // An older office worker wrote a recent round but has no working KONG reader.
  const other = emptyCouncilState();
  other.lastCycleAt = new Date(NOW - 60_000).toISOString();
  other.cycles = 7;
  let raw: string | null = JSON.stringify(other);
  let reads = 0;
  const council = createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; },
    collect: async () => { throw new Error("the round must be skipped"); },
    collectKongEvidence: async () => { reads++; return evidence(); },
    scheduleKongCatchUp: () => {},
    submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  await council.runCycle();
  const view = await council.view();
  assert.equal(reads, 1);
  assert.equal(view.cycles, 7, "the other process's round is not repeated");
  assert.equal(view.kongCompany.careers["kong:venues"].points, 10, "KONG is credited anyway");
  assert.equal(view.kongRead?.ok, true);
  // Fresh KONG: the next skipped round does not read KONG again.
  await council.runCycle();
  assert.equal(reads, 1);
});

test("a round 10-15 min after another process's round still advances stale KONG (durable storage)", async () => {
  const other = emptyCouncilState();
  other.lastCycleAt = new Date(NOW - 13 * 60_000).toISOString();
  other.cycles = 9;
  let raw: string | null = JSON.stringify(other);
  const council = createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; },
    transactState: async (update: (current: string | null) => Promise<string>) => { raw = await update(raw); return raw; },
    collect: async () => ({}),
    collectKongEvidence: async () => evidence(),
    scheduleKongCatchUp: () => {},
    submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  await council.runCycle();
  const view = await council.view();
  assert.equal(view.cycles, 9, "the other process's round is not repeated");
  assert.equal(view.kongCompany.careers["kong:venues"].points, 10, "KONG still advances");
  assert.equal(view.kongRead?.ok, true);
});

test("KONG-only upkeep refreshes stale KONG without running a council round", async () => {
  const other = emptyCouncilState();
  other.lastCycleAt = new Date(NOW - 3 * 60_000).toISOString();
  other.cycles = 4;
  let raw: string | null = JSON.stringify(other);
  let reads = 0;
  const council = createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; },
    collect: async () => { throw new Error("upkeep must not run a round"); },
    collectKongEvidence: async () => { reads++; return evidence(); },
    scheduleKongCatchUp: () => { throw new Error("upkeep never chains retries"); },
    submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  await council.catchUpKongIfStale();
  let view = await council.view();
  assert.equal(view.cycles, 4);
  assert.equal(view.kongCompany.careers["kong:venues"].points, 10);
  assert.equal(view.kongRead?.ok, true);
  await council.catchUpKongIfStale();
  assert.equal(reads, 1, "fresh KONG is not re-read");
});

test("KONG-only upkeep never creates the council row in an empty store", async () => {
  let raw: string | null = null;
  let writes = 0;
  const council = createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { writes++; raw = value; },
    // Like the real Postgres store: every transaction upserts the row, even when nothing changed.
    transactState: async (update: (current: string | null) => Promise<string>) => { const next = await update(raw); writes++; raw = next; return next; },
    collect: async () => ({}), collectKongEvidence: async () => evidence(), scheduleKongCatchUp: () => {},
    submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  await council.catchUpKongIfStale();
  await council.runKongCatchUp(3);
  assert.equal(raw, null, "no row is initialized");
  assert.equal(writes, 0);
});
