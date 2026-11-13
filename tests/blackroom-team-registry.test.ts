import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BLACKROOM_DEPARTMENT_ORDER,
  BLACKROOM_TEAM,
  BLACKROOM_TEAM_IDS,
  blackRoomTeamToLiveStatus,
  isBlackRoomTeamActionName,
  isBlackRoomTeamAgentId,
  parseBlackRoomTeamStatus,
  type BlackRoomTeamAgentModule,
} from "../shared/blackroom-team";
import { agentProbes, presentProbeStatus, summarizeProbe } from "../shared/agent-live-status";
import { routeOrder } from "../shared/agent-company";
import { AGENT_NAMES } from "../server/agent-council";
import { BLACKROOM_TEAM_MODULES, createBlackRoomTeamContext, getBlackRoomTeamStatus } from "../server/blackroom-team";
import { readBlackRoomTeamState, writeBlackRoomTeamState } from "../server/blackroom-team/state";
import { registerBlackRoomTeamRoutes } from "../server/blackroom-team-routes";

const NOW = Date.parse("2026-11-12T12:00:00Z");

test("registry lists the six Black Room agents with Spanish names and the CEO first", () => {
  assert.deepEqual([...BLACKROOM_TEAM_IDS], ["blackroom-ceo", "blackroom-analytics", "blackroom-competition", "blackroom-publisher", "blackroom-scripts", "blackroom-website"]);
  assert.deepEqual(BLACKROOM_TEAM.map((agent) => agent.id), [...BLACKROOM_TEAM_IDS]);
  assert.deepEqual([...BLACKROOM_DEPARTMENT_ORDER], [...BLACKROOM_TEAM_IDS, "blackroom-videos", "radio"]);
  assert.equal(BLACKROOM_TEAM[0].name, "CEO Black Room");
  for (const agent of BLACKROOM_TEAM) {
    assert.match(agent.color, /^#[0-9a-f]{6}$/);
    assert.ok(agent.name && agent.role && agent.description && agent.sourceName);
    assert.equal(AGENT_NAMES[agent.id], agent.name, `${agent.id} is named in the council`);
    assert.equal(BLACKROOM_TEAM_MODULES[agent.id].id, agent.id, `${agent.id} has a module`);
    const probe = agentProbes[agent.id];
    assert.equal(probe.kind, "blackroom-team");
    assert.equal(probe.url, `/api/blackroom-team/${agent.id}/status`);
  }
});

test("id and action validation rejects anything outside the registry", () => {
  assert.ok(isBlackRoomTeamAgentId("blackroom-ceo"));
  for (const bad of ["blackroom-videos", "radio", "BLACKROOM-CEO", "../etc", "", null, 3]) assert.equal(isBlackRoomTeamAgentId(bad), false);
  assert.ok(isBlackRoomTeamActionName("approve"));
  for (const bad of ["__proto__", "constructor ", "../x", "A", ""]) assert.equal(isBlackRoomTeamActionName(bad), false);
});

test("status parsing maps the contract to the office honestly", () => {
  const base = { id: "blackroom-analytics", label: "x", summary: "s", needs: [], lastRunAt: null };
  assert.equal(parseBlackRoomTeamStatus({ ...base, state: "running" }), null);
  assert.equal(parseBlackRoomTeamStatus({ ...base, id: "otro", state: "idle" }), null);
  assert.equal(parseBlackRoomTeamStatus([]), null);
  const blocked = blackRoomTeamToLiveStatus({ ...base, state: "blocked", label: "Falta METRICOOL_USER_TOKEN", needs: ["METRICOOL_USER_TOKEN"] }, NOW);
  assert.equal(blocked.state, "needs-setup");
  assert.equal(blocked.lifePenaltyExempt, true);
  assert.match(blocked.detail || "", /METRICOOL_USER_TOKEN/);
  assert.equal(blackRoomTeamToLiveStatus({ ...base, state: "idle" }, NOW).state, "offline");
  assert.equal(blackRoomTeamToLiveStatus({ ...base, state: "available" }, NOW).state, "available");
  // "working" needs a recent, non-future lastRunAt.
  assert.equal(blackRoomTeamToLiveStatus({ ...base, state: "working" }, NOW).state, "available");
  assert.equal(blackRoomTeamToLiveStatus({ ...base, state: "working", lastRunAt: "2026-11-10T00:00:00Z" }, NOW).state, "available");
  assert.equal(blackRoomTeamToLiveStatus({ ...base, state: "working", lastRunAt: "2026-11-12T13:00:00Z" }, NOW).state, "available");
  const working = blackRoomTeamToLiveStatus({ ...base, state: "working", lastRunAt: "2026-11-12T11:00:00Z" }, NOW);
  assert.equal(working.state, "working");
  assert.equal(working.evidenceId, "blackroom-team:blackroom-analytics:2026-11-12T11:00:00Z");
  // Through the probe pipeline and the office presenter.
  const probe = agentProbes["blackroom-analytics"];
  const summarized = summarizeProbe(probe, { ok: true, status: 200, body: { ...base, state: "blocked", needs: ["Token"] } }, NOW);
  assert.equal(summarized.state, "needs-setup");
  assert.deepEqual(summarized.problems, ["Token"]);
  assert.equal(presentProbeStatus(probe, summarizeProbe(probe, { ok: true, status: 200, body: { ...base, state: "working", lastRunAt: "2026-11-12T11:00:00Z" } }, NOW)).state, "available");
});

test("each module answers with its own id and a valid state, offline and without credentials", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "br-team-"));
  const offline = (async () => { throw new Error("sin red en tests"); }) as unknown as typeof fetch;
  try {
    for (const id of BLACKROOM_TEAM_IDS) {
      const status = await getBlackRoomTeamStatus(id, { dataDir, env: {}, fetch: offline, now: () => new Date(NOW), readLegacyMember: async () => null });
      assert.equal(status.id, id);
      assert.ok(["blocked", "idle", "available", "working"].includes(status.state));
      if (status.label === "En construccion") assert.equal(status.state, "blocked");
      assert.notEqual(status.state, "working", `${id} cannot be working without credentials or network`);
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a module that throws or returns junk is reported blocked", async () => {
  const broken: BlackRoomTeamAgentModule = { id: "blackroom-website", getStatus: async () => { throw new Error("boom"); }, run: async () => ({ ok: false, summary: "" }) };
  const junk: BlackRoomTeamAgentModule = { ...broken, id: "blackroom-ceo", getStatus: async () => ({ state: "working" }) as never };
  const modules = { ...BLACKROOM_TEAM_MODULES, "blackroom-website": broken, "blackroom-ceo": junk };
  assert.deepEqual([(await getBlackRoomTeamStatus("blackroom-website", { modules })).state, (await getBlackRoomTeamStatus("blackroom-website", { modules })).label], ["blocked", "Con error"]);
  assert.equal((await getBlackRoomTeamStatus("blackroom-ceo", { modules })).label, "Estado invalido");
});

test("teammate reads are one level deep and skip self", async () => {
  let legacyCalls = 0;
  const ctx = createBlackRoomTeamContext("blackroom-ceo", { readLegacyMember: async (id) => { legacyCalls++; return { id, state: "idle", label: "Cola vacia", summary: "", needs: [], lastRunAt: null }; } });
  assert.equal(await ctx.readTeammateStatus("blackroom-ceo"), null);
  assert.equal((await ctx.readTeammateStatus("radio"))?.label, "Cola vacia");
  assert.equal(legacyCalls, 1);
  const nested = createBlackRoomTeamContext("blackroom-analytics", {}, 1);
  assert.equal(await nested.readTeammateStatus("blackroom-ceo"), null);
});

test("state helper writes atomically and reads fallbacks", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "br-team-"));
  try {
    assert.deepEqual(await readBlackRoomTeamState(dataDir, "blackroom-publisher", { approvals: [] }), { approvals: [] });
    await writeBlackRoomTeamState(dataDir, "blackroom-publisher", { approvals: [1] });
    assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, "blackroom-publisher.json"), "utf8")), { approvals: [1] });
    assert.deepEqual(await readdir(dataDir), ["blackroom-publisher.json"]);
    const ctx = createBlackRoomTeamContext("blackroom-publisher", { dataDir });
    assert.deepEqual(await ctx.state.load({}), { approvals: [1] });
    await assert.rejects(writeBlackRoomTeamState(dataDir, "../x" as never, {}));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Black Room orders route to the CEO first and specialists only with Black Room context", () => {
  const all = ["assistant", ...BLACKROOM_TEAM_IDS, "blackroom-videos", "radio", "marketing-cmo", "clippers", "kong-videos"];
  assert.deepEqual(routeOrder("Como va Black Room?", all), ["blackroom-ceo", "blackroom-videos", "radio"]);
  assert.equal(routeOrder("Dame el reporte de metricas de Black Room", all)[0], "blackroom-analytics");
  assert.equal(routeOrder("Que hace la competencia de Black Room", all)[0], "blackroom-competition");
  assert.equal(routeOrder("Postear en metricool lo de Black Room", all)[0], "blackroom-publisher");
  assert.equal(routeOrder("Necesito un guion para Black Room", all)[0], "blackroom-scripts");
  assert.equal(routeOrder("Revisa la pagina web de Black Room", all)[0], "blackroom-website");
  assert.ok(!routeOrder("Reporte de marketing en metricool", all).some((id) => id.startsWith("blackroom-")));
});

type Handler = (req: any, res: any) => Promise<unknown>;
function fakeApp() {
  const routes = new Map<string, Handler>();
  const app = { get: (p: string, h: Handler) => routes.set(`GET ${p}`, h), post: (p: string, h: Handler) => routes.set(`POST ${p}`, h) };
  const call = async (key: string, req: { params?: Record<string, string>; body?: unknown }) => {
    const res: any = { statusCode: 200, body: undefined, set() { return res; }, status(code: number) { res.statusCode = code; return res; }, json(body: unknown) { res.body = body; return res; } };
    await routes.get(key)!({ params: {}, ...req }, res);
    return res as { statusCode: number; body: any };
  };
  return { app, routes, call };
}

test("routes are owner-only and validate the agent id and action", async () => {
  let user: string | null = null;
  let ran = 0;
  // Fakes only: the real modules may read credentials or the network once builders replace the stubs.
  const stub = (id: (typeof BLACKROOM_TEAM_IDS)[number]): BlackRoomTeamAgentModule => ({ id, getStatus: async () => ({ id, state: "blocked", label: "En construccion", summary: "", needs: [], lastRunAt: null }), run: async () => ({ ok: false, summary: "no" }) });
  const modules = {
    ...Object.fromEntries(BLACKROOM_TEAM_IDS.map((id) => [id, stub(id)])) as Record<(typeof BLACKROOM_TEAM_IDS)[number], BlackRoomTeamAgentModule>,
    "blackroom-publisher": { ...stub("blackroom-publisher"), run: async () => { ran++; return { ok: true, summary: "listo" }; }, actions: { approve: async () => ({ ok: true, summary: "aprobado" }) } },
  };
  const { app, routes, call } = fakeApp();
  registerBlackRoomTeamRoutes(app as never, { requestUserId: () => user, isOwner: async (id) => id === "robert", modules, context: { readLegacyMember: async () => null } });
  assert.deepEqual([...routes.keys()].sort(), ["GET /api/blackroom-team", "GET /api/blackroom-team/:id/status", "POST /api/blackroom-team/:id/action/:action", "POST /api/blackroom-team/:id/run"]);
  assert.equal((await call("GET /api/blackroom-team", {})).statusCode, 401);
  assert.equal((await call("POST /api/blackroom-team/:id/run", { params: { id: "blackroom-publisher" } })).statusCode, 401);
  user = "intruso";
  assert.equal((await call("POST /api/blackroom-team/:id/run", { params: { id: "blackroom-publisher" } })).statusCode, 403);
  assert.equal(ran, 0);
  user = "robert";
  assert.equal((await call("GET /api/blackroom-team/:id/status", { params: { id: "blackroom-videos" } })).statusCode, 404);
  assert.equal((await call("POST /api/blackroom-team/:id/run", { params: { id: "nope" } })).statusCode, 404);
  const all = await call("GET /api/blackroom-team", {});
  assert.deepEqual(all.body.agents.map((agent: { id: string }) => agent.id), [...BLACKROOM_TEAM_IDS]);
  assert.equal((await call("GET /api/blackroom-team/:id/status", { params: { id: "blackroom-website" } })).body.label, "En construccion");
  assert.equal((await call("POST /api/blackroom-team/:id/run", { params: { id: "blackroom-publisher" }, body: [] })).statusCode, 400);
  assert.equal((await call("POST /api/blackroom-team/:id/run", { params: { id: "blackroom-publisher" }, body: {} })).body.ok, true);
  assert.equal(ran, 1);
  assert.equal((await call("POST /api/blackroom-team/:id/action/:action", { params: { id: "blackroom-publisher", action: "approve" } })).body.summary, "aprobado");
  for (const action of ["reject", "constructor", "__proto__"]) {
    assert.equal((await call("POST /api/blackroom-team/:id/action/:action", { params: { id: "blackroom-publisher", action } })).statusCode, 404, action);
  }
  assert.equal((await call("POST /api/blackroom-team/:id/run", { params: { id: "blackroom-website" } })).body.ok, false);
});
