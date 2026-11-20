// KONG agents follow the same vida / Academia / automejora rules as the main company, driven only by
// KONG's own verified snapshot (server/kong-company.ts + shared/agent-vitality.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { advanceCompany, emptyCompanyState, type CompanyState } from "../shared/agent-company";
import { KONG_UNREAD_HOLD, applyVitality, vitalityView } from "../shared/agent-vitality";
import { deriveSelfImprovementProposals, KONG_BLOCKER_DAYS } from "../shared/agent-self-improvement";
import { emptyCouncilState, parseCouncilState, withKongMirror } from "../shared/agent-council";
import { redactCouncilViewForPartner } from "../shared/workspace-access";
import { advanceKongCareers, kongAgentHold } from "../server/kong-company";
import { createAgentCouncil } from "../server/agent-council";
import type { OfficeKongAuditResult } from "../server/office-kong";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const at = (minutes: number, base = NOW) => new Date(base + minutes * 60000).toISOString();
type Agent = OfficeKongAuditResult["evidence"]["agents"][number];
function snapshot(agents: Partial<Agent>[], base = NOW): OfficeKongAuditResult["evidence"] {
  return { generatedAt: at(0, base), citySnapshotCheckedAt: at(0, base), cityAgentsEnabled: true, cityCoverageComplete: false,
    agents: agents.map(agent => ({ id: "scrapers", name: "Scrapers", kind: "system", owner: "CEO", responsibility: "Datos", state: "healthy", operationMode: "scheduled",
      lastRunAt: at(-5, base), nextRunAt: at(55, base), blocker: null, nextAction: "Esperar", issues: [], ...agent }) as Agent),
    cities: [{ id: "miami", name: "Miami", countryCode: "US", timeZone: "America/New_York", currency: "USD", status: "healthy", categories: [] }] };
}
const kongTick = (company: CompanyState, observation: ReturnType<typeof advanceKongCareers>, now = NOW) =>
  applyVitality(observation.company, { now, kong: observation.vitality, names: observation.names }).state;

test("a KONG agent with a verified completed run earns +6 vida once per result", () => {
  const first = advanceKongCareers({ company: emptyCompanyState(), evidenceAt: {}, evidence: snapshot([{}]), now: NOW });
  const before = first.company.careers["kong:scrapers"].battery;
  const later = NOW + 60 * 60000;
  const next = advanceKongCareers({ company: first.company, evidenceAt: first.evidenceAt, evidence: snapshot([{ lastRunAt: at(-1, later), nextRunAt: at(59, later) }], later), now: later });
  assert.equal(next.company.careers["kong:scrapers"].battery, before + 6);
  const repeated = advanceKongCareers({ company: next.company, evidenceAt: next.evidenceAt, evidence: snapshot([{ lastRunAt: at(-1, later), nextRunAt: at(59, later) }], later), now: later + 60000 });
  assert.equal(repeated.company.careers["kong:scrapers"].battery, before + 6, "the same result never recovers twice");
  const ticked = kongTick(next.company, next, later);
  assert.equal(vitalityView(ticked, { now: later, names: {} }).find(row => row.agentId === "kong:scrapers")?.state, "trabajando");
});

test("a scheduled KONG agent that misses its turn loses 3 once per turn", () => {
  const missed = snapshot([{ state: "stale", lastRunAt: at(-400), nextRunAt: at(-200) }]);
  const first = advanceKongCareers({ company: emptyCompanyState(), evidenceAt: {}, evidence: missed, now: NOW });
  assert.equal(first.company.careers["kong:scrapers"].battery, 77);
  assert.equal(first.company.careers["kong:scrapers"].points, 0);
  const again = advanceKongCareers({ company: first.company, evidenceAt: first.evidenceAt, evidence: missed, now: NOW + 60000 });
  assert.equal(again.company.careers["kong:scrapers"].battery, 77, "the same missed nextRunAt is charged once");
  const ticked = kongTick(again.company, again);
  assert.equal(ticked.careers["kong:scrapers"].battery, 77, "the vida tick adds no cadence decay on top");
  assert.equal(ticked.careers["kong:scrapers"].vitality?.holdReason, undefined, "measured, not en espera");
  // Inside the grace window nothing is charged.
  const onTime = advanceKongCareers({ company: emptyCompanyState(), evidenceAt: {}, evidence: snapshot([{ state: "stale", lastRunAt: at(-400), nextRunAt: at(-60) }]), now: NOW });
  assert.equal(onTime.company.careers["kong:scrapers"], undefined);
});

test("a missed KONG turn that reaches vida 0 is flagged, never fired", () => {
  const first = advanceKongCareers({ company: emptyCompanyState(), evidenceAt: {}, evidence: snapshot([{ state: "stale", lastRunAt: at(-400), nextRunAt: at(-200) }]), now: NOW });
  const low: CompanyState = { ...first.company, careers: { "kong:scrapers": { ...first.company.careers["kong:scrapers"], battery: 2, hiredAt: at(-5 * 24 * 60) } } };
  const later = NOW + 24 * 60 * 60000;
  const next = advanceKongCareers({ company: low, evidenceAt: first.evidenceAt, evidence: snapshot([{ state: "stale", lastRunAt: at(-400), nextRunAt: at(-200, later) }], later), now: later });
  const career = next.company.careers["kong:scrapers"];
  assert.equal(career.battery, 0);
  assert.equal(career.generation, 1, "no automatic replacement for an inactivity zero");
  const ticked = applyVitality(next.company, { now: later, kong: next.vitality, names: next.names });
  assert.ok(ticked.flagged.includes("kong:scrapers"));
});

test("stale, missing or unreadable KONG snapshots never cost vida: every KONG career is en espera", () => {
  const first = advanceKongCareers({ company: emptyCompanyState(), evidenceAt: {}, evidence: snapshot([{ state: "stale", lastRunAt: at(-400), nextRunAt: at(-200) }]), now: NOW });
  for (const evidence of [undefined, snapshot([{ state: "stale", lastRunAt: at(-400), nextRunAt: at(-300) }], NOW - 30 * 60000)]) {
    const later = NOW + 48 * 60 * 60000;
    const unread = advanceKongCareers({ company: first.company, evidenceAt: first.evidenceAt, evidence, now: later });
    assert.equal(unread.observedAt, null);
    assert.deepEqual(unread.company, first.company);
    const ticked = applyVitality(unread.company, { now: later, kong: unread.vitality });
    assert.equal(ticked.state.careers["kong:scrapers"].battery, first.company.careers["kong:scrapers"].battery);
    assert.equal(ticked.state.careers["kong:scrapers"].vitality?.holdReason, KONG_UNREAD_HOLD.slice(0, 120));
    assert.equal(vitalityView(ticked.state, { now: later, names: {} }).find(row => row.agentId === "kong:scrapers")?.state, "en_espera");
  }
});

test("disabled, idle, on-demand, event-driven and evidence-pending KONG agents are en espera without loss", () => {
  const cases: Partial<Agent>[] = [
    { state: "disabled" }, { state: "idle", operationMode: "on_demand" }, { operationMode: "on_demand", state: "stale" },
    { operationMode: "event_driven", state: "stale" }, { evidencePending: true, state: "stale" }, { operationMode: undefined, state: "stale" },
  ];
  for (const agent of cases) {
    const raw = { lastRunAt: at(-400), nextRunAt: at(-200), ...agent };
    assert.ok(kongAgentHold({ state: "stale", nextRunAt: raw.nextRunAt!, ...raw } as any), JSON.stringify(agent));
    const seeded = advanceCompany(emptyCompanyState(), { now: NOW - 60000, statuses: { "kong:scrapers": { state: "checking", label: "seed" } }, roles: {} }).state;
    const result = advanceKongCareers({ company: seeded, evidenceAt: {}, evidence: snapshot([raw]), now: NOW });
    assert.equal(result.company.careers["kong:scrapers"].battery, 80, JSON.stringify(agent));
    const ticked = kongTick(result.company, result);
    assert.equal(ticked.careers["kong:scrapers"].battery, 80);
    assert.ok(ticked.careers["kong:scrapers"].vitality?.holdReason, "en espera");
  }
});

test("old kongCompany careers migrate into the main company with XP, vida, generation and history, idempotently", () => {
  const kong = advanceKongCareers({ company: emptyCompanyState(), evidenceAt: {}, evidence: snapshot([{}]), now: NOW }).company;
  kong.careers["kong:scrapers"] = { ...kong.careers["kong:scrapers"], points: 420, battery: 37, generation: 3, memory: [{ at: at(-60), text: "Historia retenida" }] };
  kong.orders.push({ id: "kong-order", text: "Revisar scrapers", createdAt: at(-30), assignees: [] });
  const old = emptyCouncilState() as any;
  delete old.company.kongCareersMerged;
  old.company = advanceCompany(old.company, { now: NOW, statuses: { radio: { state: "working", label: "radio", evidenceId: "radio:1" } }, roles: {} }).state;
  old.kongCompany = kong;
  const parsed = parseCouncilState(JSON.stringify(old));
  const career = parsed.company.careers["kong:scrapers"];
  assert.equal(career.points, 420);
  assert.equal(career.battery, 37);
  assert.equal(career.generation, 3);
  assert.equal(career.memory[0].text, "Historia retenida");
  assert.equal(parsed.company.careers.radio.points, 10);
  assert.equal(parsed.company.orders.find(order => order.id === "kong-order")?.scope, "kong");
  assert.equal(Object.keys(parsed.company.careers).filter(id => id === "kong:scrapers").length, 1);
  const written = JSON.stringify(withKongMirror(parsed));
  assert.deepEqual(parseCouncilState(written), parseCouncilState(JSON.stringify(withKongMirror(parseCouncilState(written)))), "idempotent");
  assert.deepEqual(parseCouncilState(written).company.careers["kong:scrapers"], career);
  // An older, not yet republished writer drops the marker and moves the main-company copy to its archive,
  // but keeps the mirror as its ledger: the next new-code read migrates the same careers again.
  const olderWriter = JSON.parse(written);
  delete olderWriter.company.kongCareersMerged;
  delete olderWriter.company.careers["kong:scrapers"];
  olderWriter.kongCompany.careers["kong:scrapers"].points = 430;
  olderWriter.kongCompany.careers["kong:scrapers"].cyclesTotal += 1;
  const recovered = parseCouncilState(JSON.stringify(olderWriter));
  assert.equal(recovered.company.careers["kong:scrapers"].points, 430);
  assert.equal(recovered.company.careers["kong:scrapers"].generation, 3);
});

test("the council round scores KONG careers in the main company, and an unread KONG round costs nothing", async () => {
  let raw: string | null = null;
  let now = NOW;
  let evidence: OfficeKongAuditResult["evidence"] | null = snapshot([{ id: "legal_audit", name: "Legal", state: "stale", lastRunAt: at(-400), nextRunAt: at(-200) }]);
  const deps = { now: () => now, userId: () => "owner", readState: async () => raw, writeState: async (value: string) => { raw = value; }, collect: async () => ({}),
    collectKongEvidence: async () => { if (!evidence) throw new Error("KONG down"); return evidence; },
    submitProposal: async () => "proposal", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {}, scheduleKongCatchUp: () => {} };
  const council = createAgentCouncil(deps);
  await council.runCycle();
  let state = await council.load();
  assert.equal(state.company.careers["kong:legal_audit"].battery, 77);
  assert.equal(state.kongCompany.careers["kong:legal_audit"].battery, 77, "compatibility mirror follows the main company");
  assert.equal((await council.view()).kongCompany.careers["kong:legal_audit"].battery, 77);
  assert.equal((await council.view()).company.careers["kong:legal_audit"], undefined, "main wing stays BlackOps-only");
  evidence = null;
  now += 20 * 60000;
  await council.runCycle();
  state = await council.load();
  assert.equal(state.company.careers["kong:legal_audit"].battery, 77);
  assert.equal(state.company.careers["kong:legal_audit"].vitality?.holdReason, KONG_UNREAD_HOLD.slice(0, 120));
});

test("a KONG blocker repeated for 3+ days becomes one approval-gated lesson proposal; nothing changes KONG", () => {
  const blocked = snapshot([{ state: "attention", blocker: "Falta la llave de Google Places", lastRunAt: at(-60) }]);
  let obs = advanceKongCareers({ company: advanceCompany(emptyCompanyState(), { now: NOW, statuses: { "kong:scrapers": { state: "checking", label: "seed" } }, roles: {} }).state, evidenceAt: {}, evidence: blocked, now: NOW });
  let company = kongTick(obs.company, obs);
  const since = company.careers["kong:scrapers"].vitality?.kongBlocker?.since;
  assert.equal(since, at(0));
  const names = { "kong:scrapers": "Scrapers" };
  assert.deepEqual(deriveSelfImprovementProposals({ proposals: [], lessons: [], now: NOW, names, company }), []);
  const later = NOW + KONG_BLOCKER_DAYS * 24 * 60 * 60000;
  obs = advanceKongCareers({ company, evidenceAt: obs.evidenceAt, evidence: snapshot([{ state: "attention", blocker: "Falta la llave de Google Places", lastRunAt: at(-60, later) }], later), now: later });
  company = applyVitality(obs.company, { now: later, kong: obs.vitality }).state;
  assert.equal(company.careers["kong:scrapers"].vitality?.kongBlocker?.since, since, "same blocker keeps its first day");
  const proposals = deriveSelfImprovementProposals({ proposals: [], lessons: [], now: later, names, company });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "lesson");
  assert.equal(proposals[0].status, "pending_submit");
  assert.equal(proposals[0].owner, "kong:scrapers");
  assert.match(proposals[0].handoffBrief, /no cambia KONG/i);
  assert.deepEqual(deriveSelfImprovementProposals({ proposals, lessons: [], now: later, names, company }), [], "one per key");
});

test("partners never see KONG vida rows, careers or automejora proposals", () => {
  const view = {
    company: { version: 1, careers: {}, trainees: [], orders: [], events: [] },
    vitality: [{ agentId: "kong:scrapers", group: "KONG" }, { agentId: "br-editor", group: "Black Room" }],
    proposals: [{ key: "automejora:kong:kong:scrapers:x", owner: "kong:scrapers" }],
    lessons: [{ subject: "kong:scrapers" }],
  };
  const out = redactCouncilViewForPartner(view as Record<string, unknown>) as any;
  assert.equal(out.vitality.some((row: { agentId: string }) => row.agentId.startsWith("kong")), false);
  assert.deepEqual(out.proposals, []);
  assert.deepEqual(out.lessons, []);
});
