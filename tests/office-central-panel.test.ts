import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGlobalRanking, buildPanelRows, buildReportsFeed, filterPanelRows, panelCounters, panelStatusKind, readPanelParams, sectionForDepartment,
  officeDeepLinkStep, selectReplaceable, selectReplaced, type PanelAgentInput,
} from "../client/src/lib/office-central-panel";
import { PANEL_BOTTOM_RESERVE, availablePanelHeight, clampPanelPosition, parseStoredPanelPosition, visiblePanelArea } from "../client/src/components/agents-world-office/use-draggable-panel";
import type { AgentCareer, CompanyState, LeaderboardRow } from "../shared/agent-company";
import { effectiveIntegrations, isMainCompanyUnscored } from "../shared/agent-integrations";
import { EXEMPT_IDS } from "../server/agent-council";

const now = Date.parse("2026-11-13T12:00:00Z");
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const HOUR = 3_600_000;

function career(agentId: string, patch: Partial<AgentCareer> = {}): AgentCareer {
  return { agentId, generation: 1, nickname: `N-${agentId}`, points: 0, battery: 80, lastState: null, cyclesWorking: 0, cyclesTotal: 0, ordersDone: 0, firedCount: 0, hiredAt: iso(-72 * HOUR), memory: [], ...patch };
}
const row = (agentId: string, points: number, battery: number, rank = 1): LeaderboardRow => ({ agentId, nickname: `N-${agentId}`, points, battery, level: "x", rank, title: "t", reliability: 50 });

test("sections follow the office rooms of each company", () => {
  assert.equal(sectionForDepartment({ id: "direccion" }, "main"), "blackops");
  assert.equal(sectionForDepartment({ id: "kong" }, "main"), "blackops");
  assert.equal(sectionForDepartment({ id: "blackroom" }, "main"), "blackroom");
  assert.equal(sectionForDepartment({ id: "fabrica" }, "main"), "factory");
  assert.equal(sectionForDepartment({ id: "academia" }, "main"), "academy");
  assert.equal(sectionForDepartment({ id: "kong-academia", officeRing: 1 }, "kong"), "academy");
  assert.equal(sectionForDepartment({ id: "kong-media", officeRing: 1 }, "kong"), "kong");
  assert.equal(sectionForDepartment({ id: "kong-city:miami", officeRing: 2 }, "kong"), "kong-cities");
  assert.equal(sectionForDepartment({ id: "kong-city:rome", officeRing: 3 }, "kong"), "kong-cities");
});

test("status kinds never upgrade: only a live lease is working, on duty needs the flag", () => {
  assert.equal(panelStatusKind({ state: "working", label: "x" }), "working");
  assert.equal(panelStatusKind({ state: "available", label: "x", onDuty: { lastWorkAt: iso(-HOUR) } }), "on-duty");
  assert.equal(panelStatusKind({ state: "available", label: "x" }), "idle");
  assert.equal(panelStatusKind({ state: "error", label: "x" }), "blocked");
  assert.equal(panelStatusKind({ state: "needs-setup", label: "x" }), "attention");
  assert.equal(panelStatusKind({ state: "offline", label: "x", problems: ["meta diaria sin cumplir"] }), "attention");
  assert.equal(panelStatusKind(undefined), "checking");
});

test("rows carry careers from their own ledger, last/next work and the blocking reason", () => {
  const agents = new Map<string, PanelAgentInput>([
    ["code", { id: "code", name: "Code", role: "Dev", status: { state: "available", label: "Activo · al día", onDuty: { lastWorkAt: iso(-HOUR), nextWorkAt: iso(HOUR) } } }],
    ["kong:legal_audit", { id: "kong:legal_audit", name: "Legal KONG", role: "KONG", status: { state: "error", label: "Fallo", detail: "Token vencido", problems: ["Token vencido"] }, kongEvidence: { lastRunAt: iso(-2 * HOUR), nextRunAt: null } }],
    ["kong-city:miami:events", { id: "kong-city:miami:events", name: "Eventos", role: "Eventos", status: { state: "needs-setup", label: "Fuente limitada", detail: "429 en la fuente" }, city: { lastWorkAt: iso(-3 * HOUR), nextWorkAt: iso(2 * HOUR), blocker: "429 en la fuente", snapshotAt: iso(-60_000) } }],
  ]);
  const rows = buildPanelRows({
    departments: [
      { department: { id: "ingenieria", name: "Ingenieria", color: "#fff", agentIds: ["code", "missing"] }, company: "main" },
      { department: { id: "kong-legal", name: "Legal", color: "#fff", agentIds: ["kong:legal_audit"], officeRing: 1 }, company: "kong" },
      { department: { id: "kong-city:miami", name: "Miami", color: "#fff", agentIds: ["kong-city:miami:events"], officeRing: 2 }, company: "kong" },
    ],
    agents,
    careers: { main: { code: career("code", { points: 40, battery: 70, generation: 2 }) }, kong: { "kong:legal_audit": career("kong:legal_audit", { battery: 10 }), code: career("code", { points: 999 }) } },
    leaderboards: { main: [row("code", 40, 70)], kong: [] },
  });
  assert.deepEqual(rows.map(item => [item.id, item.section, item.kind]), [["code", "blackops", "on-duty"], ["kong:legal_audit", "kong", "blocked"], ["kong-city:miami:events", "kong-cities", "attention"]]);
  assert.equal(rows[0].career?.points, 40, "main desk never reads the KONG ledger");
  assert.equal(rows[0].lastWorkAt, iso(-HOUR));
  assert.equal(rows[0].nextWorkAt, iso(HOUR));
  assert.equal(rows[1].reason, "Token vencido");
  assert.equal(rows[1].lastWorkAt, iso(-2 * HOUR));
  assert.equal(rows[2].nextWorkAt, iso(2 * HOUR));
  assert.deepEqual(panelCounters(rows), { total: 3, working: 0, onDuty: 1, active: 1, blocked: 1, attention: 1 });
  assert.deepEqual(filterPanelRows(rows, "kong-cities", "").map(item => item.id), ["kong-city:miami:events"]);
  assert.deepEqual(filterPanelRows(rows, "all", "token").map(item => item.id), ["kong:legal_audit"]);
  assert.deepEqual(filterPanelRows(rows, "all", "ingenieria").map(item => item.id), ["code"]);

  const reports = buildReportsFeed({ rows, agents, roleWork: [{ agentId: "code", status: "blocked", startedAt: iso(-30 * 60_000), expiresAt: iso(HOUR) }], events: [{ company: "main", at: iso(-10 * HOUR), text: "El CEO asignó una orden." }] });
  assert.deepEqual(reports.map(item => [item.agentId, item.source, item.severity]), [
    ["kong-city:miami:events", "Auditoría autenticada KONG", "warning"],
    ["code", "Ejecutor de la oficina", "problem"],
    ["kong:legal_audit", "Lectura autenticada KONG", "problem"],
    [null, "Eventos de la empresa", "info"],
  ]);
});

test("global ranking merges both ledgers, keeps only real points and orders like leaderboard()", () => {
  const ranking = buildGlobalRanking({ main: [row("code", 50, 60), row("ceo-zero", 0, 100)], kong: [row("kong:venues", 50, 90), row("kong:ai", 70, 10)] }, id => id.toUpperCase());
  assert.deepEqual(ranking.map(item => [item.agentId, item.company]), [["kong:ai", "kong"], ["kong:venues", "kong"], ["code", "main"]]);
  assert.equal(ranking[0].name, "KONG:AI");
});

test("replaceable uses the existing rotation rule: red battery or failing now, never frozen, training or exempt careers", () => {
  const careers = {
    main: {
      low: career("low", { battery: 20 }),
      failing: career("failing", { battery: 70 }),
      exemptError: career("exemptError", { battery: 70 }),
      noEvidence: career("noEvidence", { battery: 70 }),
      healthy: career("healthy", { battery: 90 }),
      zeroNew: career("zeroNew", { battery: 0, hiredAt: iso(-2 * HOUR) }),
      training: career("training", { battery: 5, inTrainingUntilGeneration: 2 }),
      frozen: career("frozen", { battery: 0, scoreReconciliation: { version: 1, status: "needs_scope_qualification", recordId: "r", originalCareerDigest: "d" } }),
      ceo: career("ceo", { battery: 0 }),
    },
    kong: { "kong:venues": career("kong:venues", { battery: 25 }) },
  };
  const rows = selectReplaceable({
    careers,
    statuses: new Map([
      ["failing", { state: "error" as const, label: "x", evidenceId: "run-1" }],
      // The council never charges battery for these: a life-penalty exempt error or one without evidence.
      ["exemptError", { state: "error" as const, label: "Servidor sin respuesta", evidenceId: "run-2", lifePenaltyExempt: true }],
      ["noEvidence", { state: "error" as const, label: "x", evidenceId: "  " }],
    ]),
    isExempt: (id, company) => company === "main" && id === "ceo",
    nameOf: id => id,
    now,
  });
  assert.deepEqual(rows.map(item => [item.agentId, item.failuresLeft, item.failingNow]), [["zeroNew", 0, false], ["low", 2, false], ["kong:venues", 3, false], ["failing", 7, true]]);
  assert.equal(rows[0].protectedUntil, iso(22 * HOUR), "a new hire keeps 24 h before it can be replaced");
  assert.equal(rows[1].protectedUntil, null);
  assert.ok(!rows.some(item => item.agentId === "exemptError" || item.agentId === "noEvidence"), "an exempt or evidence-less error is not a failure that costs battery");
});

test("panel exemption is the council's: mechanic, kong:* guides and non-active integrations only", () => {
  const integrations = effectiveIntegrations({ radio: "pausada" });
  const exempt = (id: string) => isMainCompanyUnscored(id, integrations);
  assert.deepEqual(["mechanic", "kong:Venues", "kong:anything", "kong-videos", "radio"].filter(exempt), ["mechanic", "kong:Venues", "kong:anything", "kong-videos", "radio"]);
  assert.deepEqual(["ceo", "skills-scout", "agent-factory", "code", "blackroom-videos"].filter(exempt), [], "the council rotates these, so the panel must list them");
  // Server parity: the council's always-unscored list is derived from the same predicate.
  // The placeholder KONG roles were retired (their real agents are scored from the KONG snapshot).
  assert.deepEqual([...EXEMPT_IDS].sort(), ["mechanic"]);
  const careers = { main: { ceo: career("ceo", { battery: 0 }), mechanic: career("mechanic", { battery: 0 }), radio: career("radio", { battery: 0 }) }, kong: {} };
  const rows = selectReplaceable({ careers, statuses: new Map(), isExempt: (id, company) => company === "main" && exempt(id), nameOf: id => id, now });
  assert.deepEqual(rows.map(item => item.agentId), ["ceo"]);
});

test("replaced history comes from retired careers (lineage) and the CEO's firing event", () => {
  const company: CompanyState = {
    version: 1,
    careers: { radio: career("radio", { generation: 3, nickname: "Teo", hiredAt: iso(-HOUR) }) },
    retiredCareers: [career("radio", { generation: 1, nickname: "Luna", hiredAt: iso(-100 * HOUR) }), career("radio", { generation: 2, nickname: "Mia", points: 30, hiredAt: iso(-50 * HOUR) })],
    trainees: [], orders: [],
    events: [{ at: iso(-HOUR), text: "El CEO despidio a Mia (Radio). Bateria en cero (Fallo). Entra un reemplazo a la academia." }],
  };
  const rows = selectReplaced({ companies: { main: company, kong: undefined }, nameOf: () => "Radio" });
  assert.deepEqual(rows.map(item => [item.nickname, item.generation, item.successor?.nickname, item.replacedAt]), [["Mia", 2, "Teo", iso(-HOUR)], ["Luna", 1, "Mia", iso(-50 * HOUR)]]);
  assert.equal(rows[0].reason, "Bateria en cero (Fallo).");
  assert.equal(rows[1].reason, null);
});

test("deep-link params accept only known sections and bounded agent ids", () => {
  assert.deepEqual(readPanelParams("?section=kong&agent=kong%3Alegal_audit"), { section: "kong", agent: "kong:legal_audit" });
  assert.deepEqual(readPanelParams("section=kong-cities&agent=kong-city:miami:events"), { section: "kong-cities", agent: "kong-city:miami:events" });
  assert.deepEqual(readPanelParams("?section=nope"), { section: "all", agent: null });
  assert.equal(readPanelParams(`?agent=${"x".repeat(201)}`).agent, null);
});

test("draggable panels stay inside the viewport and ignore corrupt stored positions", () => {
  assert.deepEqual(clampPanelPosition({ x: -50, y: -10 }, { width: 300, height: 200 }, { width: 390, height: 844 }), { x: 8, y: 8 });
  assert.deepEqual(clampPanelPosition({ x: 900, y: 2000 }, { width: 300, height: 200 }, { width: 390, height: 844 }), { x: 82, y: 636 });
  assert.deepEqual(clampPanelPosition({ x: 10, y: 500 }, { width: 500, height: 2000 }, { width: 390, height: 844 }), { x: 8, y: 8 });
  assert.deepEqual(parseStoredPanelPosition('{"x":12,"y":40}'), { x: 12, y: 40 });
  assert.equal(parseStoredPanelPosition("not json"), null);
  assert.equal(parseStoredPanelPosition('{"x":"a"}'), null);
  assert.equal(parseStoredPanelPosition(null), null);
});

test("draggable panels are placed inside their container's visible part, also after scrolling", () => {
  // Container 1000x800 scrolled 300 px above a 390x844 screen: only y 300..800 and x 0..390 are visible.
  const area = visiblePanelArea({ left: 0, top: -300 }, { width: 1000, height: 800 }, { width: 390, height: 844 });
  assert.deepEqual(area, { left: 0, top: 300, width: 390, height: 500 });
  assert.deepEqual(clampPanelPosition({ x: 50, y: 0 }, { width: 300, height: 200 }, area), { x: 50, y: 308 }, "never placed above the visible part");
  assert.deepEqual(clampPanelPosition({ x: 500, y: 900 }, { width: 300, height: 200 }, area), { x: 82, y: 592 });
  // Container entirely off screen: fall back to the container itself.
  assert.deepEqual(visiblePanelArea({ left: 0, top: -2000 }, { width: 1000, height: 800 }, { width: 390, height: 844 }), { left: 0, top: 0, width: 1000, height: 800 });
});

test("floating panels never reach the bottom band with the factory button and chat launcher", () => {
  const phone = { left: 0, top: 0, width: 390, height: 844 };
  // Dragged all the way down: the top stays high enough for a 120 px panel above the 72 px band.
  const low = clampPanelPosition({ x: 0, y: 5000 }, { width: 300, height: 600 }, phone, PANEL_BOTTOM_RESERVE);
  assert.deepEqual(low, { x: 8, y: 844 - 72 - 120 - 8 });
  // Its height is capped so the bottom edge ends above the band, whatever the content.
  assert.equal(low.y + availablePanelHeight(low.y, phone), 844 - PANEL_BOTTOM_RESERVE);
  // Untouched panels (top 220 px on a phone, 96 px on a 768 px laptop) get the same cap.
  assert.equal(availablePanelHeight(220, phone), 844 - 72 - 220);
  assert.equal(availablePanelHeight(96, { left: 0, top: 0, width: 1366, height: 768 }), 768 - 72 - 96);
  // Small panels keep their whole height when dragged low.
  assert.deepEqual(clampPanelPosition({ x: 0, y: 5000 }, { width: 300, height: 80 }, phone, PANEL_BOTTOM_RESERVE), { x: 8, y: 844 - 72 - 80 - 8 });
});

test("office deep link switches to KONG once, never traps the user and gives up once data settled", () => {
  const base = { agentId: "kong-city:miami:events", wing: "main" as const, wingSwitched: false, settled: false };
  assert.deepEqual(officeDeepLinkStep(base), { action: "switch-wing" });
  assert.deepEqual(officeDeepLinkStep({ ...base, wing: "kong", wingSwitched: true }), { action: "wait" });
  assert.deepEqual(officeDeepLinkStep({ ...base, wing: "kong", wingSwitched: true, kongRoomId: "kong-city:miami" }), { action: "focus", roomId: "kong-city:miami" });
  // The user went back to the main wing before the room appeared: never pulled back to KONG.
  assert.deepEqual(officeDeepLinkStep({ ...base, wing: "main", wingSwitched: true }), { action: "give-up" });
  // Snapshot/directory settled (or failed) without the room: stop trying.
  assert.deepEqual(officeDeepLinkStep({ ...base, wing: "kong", wingSwitched: true, settled: true }), { action: "give-up" });
  // Main-office agents stay in the main wing.
  assert.deepEqual(officeDeepLinkStep({ agentId: "code", wing: "main", wingSwitched: false, settled: false }), { action: "wait" });
  assert.deepEqual(officeDeepLinkStep({ agentId: "code", mainRoomId: "ingenieria", wing: "main", wingSwitched: false, settled: false }), { action: "focus", roomId: "ingenieria" });
  assert.deepEqual(officeDeepLinkStep({ agentId: "nope", wing: "main", wingSwitched: false, settled: true }), { action: "give-up" });
});
