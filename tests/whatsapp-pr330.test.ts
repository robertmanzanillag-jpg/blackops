import test from "node:test";
import assert from "node:assert/strict";
import { WHATSAPP_CAREER_ID as ID, whatsappOfficeView, withWhatsAppOfficeAgent, type WhatsAppReaderEvidence } from "../shared/whatsapp-office-agent";
import { advanceKongCompany } from "../server/kong-company";
import { emptyCompanyState } from "../shared/agent-company";
import { emptyRoleLifecycleState, reconcileRoleLifecycles, activateCandidatePolicy } from "../shared/office-role-lifecycle";
import { buildKongOfficeWing } from "../client/src/lib/kong-office-wing";
import { kongOfficeSnapshotKey, readOwnerKongSnapshot } from "../client/src/lib/whatsapp-office-query";
import type { OfficeKongAuditResult } from "../server/office-kong";
import { importOfficeCouncilHistory } from "../server/office-council-migration";
import { emptyCouncilState } from "../shared/agent-council";
const NOW = Date.parse("2026-11-06T12:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60000).toISOString();
const reader = (patch: Partial<WhatsAppReaderEvidence> = {}): WhatsAppReaderEvidence => ({ version: 1, scopeId: "kong-venues-four-groups", ownerId: "11111111-1111-4111-8111-111111111111",
  observedAt: at(0), scheduler: "active", intervalMinutes: 30, reader: "idle", session: "connected", lastAttemptAt: at(-1), lastSuccessAt: at(-1), lastReviewAt: at(0), groupsRead: 4, lastSuccessGroupCount: 4, blocker: "none", checkpointsRetained: true, ...patch });
const evidence = (value?: WhatsAppReaderEvidence): OfficeKongAuditResult["evidence"] => ({ generatedAt: at(0), agents: withWhatsAppOfficeAgent([], value, NOW), cities: [{id:"fixture-city",name:"Fixture City",countryCode:"US",timeZone:"America/New_York",currency:"USD",status:"healthy",categories:[]}], citySnapshotCheckedAt: at(0), cityAgentsEnabled: true, cityCoverageComplete: false, ...(value ? { whatsappReader: value } : {}) });

test("one desk survives absent/blocked/unknown/stale/reading/recent/error inputs without inventing work", () => {
  const cases: [WhatsAppReaderEvidence | undefined, string, string][] = [
    [undefined, "unverified", "offline"], [reader({reader:"blocked",blocker:"missing-reference",session:"unknown"}),"blocked","needs-setup"],
    [reader({session:"unknown"}),"unverified","offline"], [reader({observedAt:at(-61),lastReviewAt:at(-61),lastAttemptAt:at(-62),lastSuccessAt:at(-62)}),"stale","offline"],
    [reader({reader:"reading"}),"reading","working"], [reader(),"recent","available"],
    [reader({reader:"blocked",blocker:"interaction-failed"}),"blocked","needs-setup"],
  ];
  for (const [value, expected, activity] of cases) {
    const input = evidence(value); input.agents.push(...input.agents);
    const desks = buildKongOfficeWing(input, [], {}, NOW).agents.filter(a => a.id === ID);
    assert.equal(desks.length, 1); assert.equal(desks[0].whatsappEvidence?.status, expected); assert.equal(desks[0].status.state, activity);
  }
});

test("disconnect and expiry retain prior timestamps but never animate cached reading", () => {
  const value = reader({reader:"reading"});
  for (const [now, transport] of [[NOW, false], [NOW + 360001, true]] as const) {
    const desk = buildKongOfficeWing(evidence(value), [], {}, now, undefined, transport).agents.find(a => a.id === ID)!;
    assert.equal(desk.whatsappEvidence?.status, "stale"); assert.notEqual(desk.status.state, "working");
    assert.equal(desk.whatsappEvidence?.evidence?.lastSuccessAt, value.lastSuccessAt);
  }
});

test("idle observations follow the scheduled cadence without claiming a live reader", () => {
  const value = reader({observedAt:at(-30),lastReviewAt:at(-30),lastAttemptAt:at(-30),lastSuccessAt:at(-30)});
  assert.equal(whatsappOfficeView(value,NOW).status,"recent");
  assert.equal(whatsappOfficeView(value,NOW+30*60000).status,"recent");
  assert.equal(whatsappOfficeView(value,NOW+30*60000+1).status,"stale");
  assert.equal(whatsappOfficeView(value,NOW,false).status,"stale");
  for (const patch of [{reader:"reading"},{reader:"blocked",blocker:"interaction-failed"},{session:"disconnected"},{scheduler:"paused"},{lastSuccessGroupCount:3},{intervalMinutes:10}]) {
    assert.notEqual(whatsappOfficeView({...value,...patch},NOW).status,"recent");
  }
  const short = reader({intervalMinutes:10,observedAt:at(-20),lastReviewAt:at(-20),lastAttemptAt:at(-20),lastSuccessAt:at(-20)});
  assert.equal(whatsappOfficeView(short,NOW).status,"recent");
  assert.equal(whatsappOfficeView(short,NOW+1).status,"stale");
});

test("empty, private, future, invalid scope/count and inconsistent success never qualify", () => {
  for (const value of [{}, {...reader(),scopeId:"all-chats"}, {...reader(),groupsRead:5}, {...reader(),ownerId:"name"}, {...reader(),observedAt:at(1)}, {...reader(),lastSuccessAt:at(1)}, {...reader(),lastAttemptAt:null}, {...reader(),chat:"private"}]) {
    assert.equal(whatsappOfficeView(value, NOW).status, "unverified");
    assert.equal(whatsappOfficeView(value, NOW).evidence, null);
  }
});

test("PR330 ledger credits each completed read once; heartbeat/replay/setup/failure preserve life/history", () => {
  const first = advanceKongCompany({ company: emptyCompanyState(), evidenceAt: {}, evidence: evidence(reader()), now: NOW });
  assert.equal(first.company.careers[ID].points, 10);
  const original = first.company.careers[ID];
  for (const value of [reader(), reader({observedAt:at(1),lastReviewAt:at(1)}), reader({reader:"reading"}),
    reader({reader:"blocked",blocker:"permission-required"}), reader({reader:"blocked",blocker:"interaction-failed"}),
    reader({session:"disconnected"}), undefined]) {
    const next = advanceKongCompany({ company: first.company, evidenceAt: first.evidenceAt, evidence: evidence(value), now: NOW + 60000 });
    assert.deepEqual(next.company.careers[ID], original); assert.deepEqual(next.evidenceAt, first.evidenceAt);
  }
  const newResult = advanceKongCompany({ company: first.company, evidenceAt: first.evidenceAt, evidence: evidence(reader({lastSuccessAt:at(0),lastAttemptAt:at(0)})), now: NOW });
  assert.equal(newResult.company.careers[ID].points, 20); assert.equal(newResult.company.careers[ID].generation, original.generation);
  const historical = { ...newResult.company, careers: { ...newResult.company.careers, [ID]: { ...newResult.company.careers[ID], memory: [{at:at(-1),text:"Synthetic learned history"}], firedCount:2, generation:3 } } };
  const noRead = advanceKongCompany({company: historical,evidenceAt:newResult.evidenceAt,evidence:undefined,now:NOW});
  assert.deepEqual(noRead.company, historical);
  const lifecycle = reconcileRoleLifecycles(emptyRoleLifecycleState(), historical, NOW);
  assert.equal(lifecycle.roles[ID].status, "unsupported");
  assert.equal(lifecycle.roles[ID].generation, 3);
  assert.deepEqual(lifecycle.roles[ID].context.memory, historical.careers[ID].memory);
  assert.equal(activateCandidatePolicy(lifecycle, ID, "synthetic-policy", NOW).reason, "UNSUPPORTED_ROLE");
});

test("no career/penalty is fabricated before any complete read, and generic agent claims cannot award points", () => {
  for (const value of [undefined,reader({reader:"reading"}),reader({reader:"blocked",blocker:"missing-reference"})]) {
    const snapshot = evidence(value); snapshot.agents[0] = {...snapshot.agents[0],state:"healthy",lastRunAt:at(0),blocker:null};
    const next = advanceKongCompany({company:emptyCompanyState(),evidenceAt:{},evidence:snapshot,now:NOW});
    assert.equal(next.company.careers[ID], undefined);
  }
});

test("snapshot cache and in-flight responses are isolated by authenticated account", async () => {
  assert.notDeepEqual(kongOfficeSnapshotKey("owner-a"), kongOfficeSnapshotKey("owner-b"));
  const previous = globalThis.fetch;
  let owner: string | undefined = "owner-a"; let calls = 0;
  globalThis.fetch = async () => { calls++; owner = "owner-b"; return new Response(JSON.stringify({private:"account-a"}),{status:200}); };
  try {
    await assert.rejects(readOwnerKongSnapshot("owner-a",()=>owner), /sesión cambió/);
    await assert.rejects(readOwnerKongSnapshot(undefined,()=>owner), /Sesión sin verificar/);
    assert.equal(calls,1);
  } finally { globalThis.fetch = previous; }
});

test("protocol-v2 mock migration retains WhatsApp career/history and deduplicated credit ledger verbatim", async () => {
  const observed = advanceKongCompany({company:emptyCompanyState(),evidenceAt:{},evidence:evidence(reader()),now:NOW});
  const source = { ...emptyCouncilState(), kongCompany: observed.company, kongEvidenceAt: observed.evidenceAt,
    kongLastStatuses: observed.statuses, kongObservedAt: observed.observedAt };
  source.kongCompany.careers[ID].memory.push({at:at(-1),text:"Synthetic retained reader history"});
  let copied: typeof source | undefined;
  const client = (exists = false) => ({ release() {}, async query(sql: string, args: unknown[] = []) {
    if (sql.startsWith("SELECT data")) return {rows:[{data:source,revision:7}]};
    if (sql.startsWith("SELECT owner_key")) return {rows:exists?[{owner_key:"occupied"}]:[]};
    if (sql.startsWith("INSERT INTO")) copied=JSON.parse(args[1] as string);
    if (sql.startsWith("SELECT state =")) return {rows:[{identical:JSON.stringify(copied)===JSON.stringify(source)}]};
    return {rows:[]};
  } });
  await importOfficeCouncilHistory(client(), "fixture-owner", 7);
  assert.deepEqual(copied, source);
  const replay=advanceKongCompany({company:copied!.kongCompany,evidenceAt:copied!.kongEvidenceAt,evidence:evidence(reader()),now:NOW});
  assert.deepEqual(replay.company.careers[ID],source.kongCompany.careers[ID]);
  assert.deepEqual(replay.evidenceAt,source.kongEvidenceAt);
  copied=undefined;
  await assert.rejects(importOfficeCouncilHistory(client(true),"fixture-owner",7));
  assert.equal(copied,undefined,"an existing destination cannot be overwritten");
});
