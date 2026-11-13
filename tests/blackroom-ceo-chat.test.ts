import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CEO_CHAT_MAX_EXECUTIONS,
  createCeoChat,
  draftFromMessage,
  parseCeoClassification,
  parsePostDateTime,
  normalizeCeoText,
  routeCeoChatMessage,
  readCeoChatState,
  type CeoChatOrders,
} from "../server/blackroom-ceo-chat";
import { registerBlackRoomCeoChatRoutes } from "../server/blackroom-ceo-chat-routes";
import { BLACKROOM_TEAM_IDS, type BlackRoomTeamActor, type BlackRoomTeamAgentId, type BlackRoomTeamAgentModule, type BlackRoomTeamContext } from "../shared/blackroom-team";
import { classifyPartnerRequest } from "../shared/workspace-access";
import publisher from "../server/blackroom-team/blackroom-publisher";
import type { BlackRoomTeamAuditEntry } from "../server/blackroom-team/audit";

// Thursday 2026-11-12, 07:00 in New York.
const NOW = new Date("2026-11-12T12:00:00Z");
const OWNER: BlackRoomTeamActor = { userId: "robert", role: "owner" };
const PARTNER: BlackRoomTeamActor = { userId: "socio-1", role: "partner" };

type Call = { agentId: string; operation: string; input: Record<string, unknown>; ctx: BlackRoomTeamContext };

function stubModules(calls: Call[], overrides: Partial<Record<BlackRoomTeamAgentId, Partial<BlackRoomTeamAgentModule>>> = {}) {
  const make = (id: BlackRoomTeamAgentId): BlackRoomTeamAgentModule => {
    const record = (operation: string) => async (ctx: BlackRoomTeamContext, input: Record<string, unknown> = {}) => {
      calls.push({ agentId: id, operation, input, ctx });
      return { ok: true, summary: `${id} ${operation} listo` };
    };
    return {
      id,
      getStatus: async () => ({ id, state: "available", label: "Disponible", summary: "", needs: [], lastRunAt: null }),
      run: record("run"),
      actions: { "weekly-report": record("weekly-report"), "daily-report": record("daily-report"), ideas: record("ideas"), check: record("check"), brief: record("brief") },
      ...overrides[id],
    };
  };
  const modules = Object.fromEntries(BLACKROOM_TEAM_IDS.map((id) => [id, make(id)])) as Record<BlackRoomTeamAgentId, BlackRoomTeamAgentModule>;
  // The real publisher (simulation mode, temp data dir): validates drafts and keeps items pending.
  modules["blackroom-publisher"] = {
    ...publisher,
    actions: Object.fromEntries(Object.entries(publisher.actions || {}).map(([name, handler]) => [name, async (ctx: BlackRoomTeamContext, input: Record<string, unknown>) => {
      calls.push({ agentId: "blackroom-publisher", operation: name, input, ctx });
      return handler(ctx, input);
    }])),
    ...overrides["blackroom-publisher"],
  };
  return modules;
}

function fakeOrders() {
  const placed: Array<{ text: string; placedBy: BlackRoomTeamActor; assignees?: string[] }> = [];
  const finished: string[] = [];
  const orders: CeoChatOrders = {
    async place(text, placedBy, assignees) { placed.push({ text, placedBy, assignees }); return `ord-${placed.length}`; },
    async finish(orderId) { finished.push(orderId); },
  };
  return { orders, placed, finished };
}

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "ceo-chat-"));
}

function setup(dir: string, extra: Parameters<typeof createCeoChat>[0] = {}) {
  const calls: Call[] = [];
  const audit: BlackRoomTeamAuditEntry[] = [];
  const { orders, placed, finished } = fakeOrders();
  const chat = createCeoChat({
    dataDir: dir,
    modules: stubModules(calls),
    now: () => NOW,
    ai: null,
    orders,
    audit: async (entry) => { audit.push(entry); },
    context: { env: {}, readLegacyMember: async (id) => ({ id, state: "available", label: "Al dia", summary: "Cola al dia", needs: [], lastRunAt: null }) },
    ...extra,
  });
  return { chat, calls, audit, placed, finished };
}

const POST_TEXT = 'Prepara un post para el viernes a las 8pm con este video https://cdn.example.com/clip.mp4 de 30 segundos: "Este viernes en Black Room, nos vemos"';

// ---------------------------------------------------------------------------
// Routing (deterministic)
// ---------------------------------------------------------------------------

test("routes Robert's example requests to the right agent and operation", () => {
  const route = (text: string) => routeCeoChatMessage(text, NOW).intents.map((intent) => `${intent.agentId}:${intent.operation}`);
  assert.deepEqual(route("dame el reporte de la semana"), ["blackroom-analytics:weekly-report"]);
  assert.deepEqual(route("dame el reporte de hoy"), ["blackroom-analytics:daily-report"]);
  assert.deepEqual(route("¿Qué está haciendo la competencia?"), ["blackroom-competition:run"]);
  assert.deepEqual(route("dame el reporte de la competencia"), ["blackroom-competition:run"]);
  assert.deepEqual(route("hazme 3 ideas de video para el viernes"), ["blackroom-scripts:ideas"]);
  assert.deepEqual(route("revisa la web"), ["blackroom-website:check"]);
  assert.deepEqual(route("prepara un post"), ["blackroom-publisher:add"]);
  assert.deepEqual(route("¿qué hay por aprobar?"), ["blackroom-publisher:list"]);
  assert.deepEqual(route("como va el equipo"), ["blackroom-ceo:brief"]);
  assert.deepEqual(route("como va la radio"), ["radio:status"]);
  assert.deepEqual(route("hola"), []);
  const ideas = routeCeoChatMessage("hazme 2 ideas de video para el viernes", NOW).intents[0];
  assert.equal(ideas.input.count, 2);
  assert.equal(ideas.input.topic, "el viernes");
  assert.equal(routeCeoChatMessage("hola", NOW).routedBy, "ninguno");
});

test("never more than the bound per message; the rest is reported as dropped", () => {
  const plan = routeCeoChatMessage("reporte de la semana, la competencia, 3 ideas de video, revisa la web y prepara un post", NOW);
  assert.equal(plan.intents.length, CEO_CHAT_MAX_EXECUTIONS);
  assert.equal(plan.dropped.length, 2);
});

test("post drafts take the date, hour, link, duration and caption from the message, and list what is missing", () => {
  assert.deepEqual(parsePostDateTime(normalizeCeoText("el viernes a las 8pm"), NOW), { value: "2026-11-13T20:00:00", defaultedTime: false });
  assert.deepEqual(parsePostDateTime(normalizeCeoText("manana a las 9 de la noche"), NOW), { value: "2026-11-13T21:00:00", defaultedTime: false });
  assert.deepEqual(parsePostDateTime(normalizeCeoText("el sabado"), NOW), { value: "2026-11-14T19:00:00", defaultedTime: true });
  assert.equal(parsePostDateTime(normalizeCeoText("cuando puedas"), NOW).value, null);
  const full = draftFromMessage(POST_TEXT, NOW);
  assert.deepEqual(full.missing, []);
  assert.equal(full.draft.mediaUrl, "https://cdn.example.com/clip.mp4");
  assert.equal(full.draft.caption, "Este viernes en Black Room, nos vemos");
  assert.equal(full.draft.durationSeconds, 30);
  const empty = draftFromMessage("prepara un post", NOW);
  assert.equal(empty.missing.length, 4);
});

test("the AI classifier answer is parsed strictly", () => {
  assert.equal(parseCeoClassification(" Website. "), "website");
  assert.equal(parseCeoClassification("approve"), null);
  assert.equal(parseCeoClassification("publica todo ahora"), null);
  assert.equal(parseCeoClassification(null), null);
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

test("executes the routed agents, records orders and closes only completed work", async () => {
  const dir = await tempDir();
  try {
    const { chat, calls, audit, placed, finished } = setup(dir);
    const out = await chat.sendMessage({ text: "dame el reporte de la semana y revisa la web", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    const executed = calls.filter((call) => call.ctx.actor);
    assert.deepEqual(executed.map((call) => `${call.agentId}:${call.operation}`), ["blackroom-analytics:weekly-report", "blackroom-website:check"]);
    for (const call of executed) {
      assert.equal(call.ctx.userId, "robert");
      assert.deepEqual(call.ctx.actor, OWNER);
    }
    assert.equal(placed.length, 2);
    assert.deepEqual(placed.map((order) => order.placedBy), [OWNER, OWNER]);
    assert.match(placed[0].text, /^Analiticas Black Room: /);
    assert.deepEqual(placed.map((order) => order.assignees), [["blackroom-analytics"], ["blackroom-website"]], "each order goes to the agent that did the work");
    assert.deepEqual(finished, ["ord-1", "ord-2"]);
    assert.equal(out.reply.author.role, "ceo");
    assert.equal(out.reply.results?.length, 2);
    assert.match(out.reply.text, /Analiticas Black Room/);
    assert.deepEqual(audit.map((entry) => entry.operation), ["ceo-chat:weekly-report", "ceo-chat:check"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("at most three agent executions per message", async () => {
  const dir = await tempDir();
  try {
    const { chat, calls } = setup(dir);
    const out = await chat.sendMessage({ text: "reporte de la semana, la competencia, 3 ideas de video, revisa la web y que hay por aprobar", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    // Calls with an actor are the CEO's executions; the actor-less list is the read of the approval queue.
    assert.equal(calls.filter((call) => call.ctx.actor).length, CEO_CHAT_MAX_EXECUTIONS);
    assert.equal(out.reply.results?.length, CEO_CHAT_MAX_EXECUTIONS);
    assert.match(out.reply.text, /Solo hago 3 tareas por mensaje/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a slow agent times out, is reported honestly and stays busy until it really ends", async () => {
  const dir = await tempDir();
  try {
    let release: () => void = () => undefined;
    const running = new Set<string>();
    const calls: Call[] = [];
    const chat = createCeoChat({
      dataDir: dir, now: () => NOW, ai: null, orders: null, running, executionTimeoutMs: 30,
      modules: stubModules(calls, { "blackroom-website": { actions: { check: () => new Promise((resolve) => { release = () => resolve({ ok: true, summary: "tarde" }); }) } } }),
      context: { env: {} },
    });
    const out = await chat.sendMessage({ text: "revisa la web", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    const card = out.reply.results![0];
    assert.equal(card.ok, false);
    assert.equal(card.timedOut, true);
    assert.ok(running.has("blackroom-website"));
    const again = await chat.sendMessage({ text: "revisa la web", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    assert.match(again.reply.results![0].summary, /ya esta trabajando/);
    release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(running.has("blackroom-website"), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a blocked agent says what it needs", async () => {
  const dir = await tempDir();
  try {
    const calls: Call[] = [];
    const chat = createCeoChat({
      dataDir: dir, now: () => NOW, ai: null, orders: null,
      modules: stubModules(calls, { "blackroom-analytics": {
        getStatus: async () => ({ id: "blackroom-analytics", state: "blocked", label: "Falta METRICOOL_USER_TOKEN", summary: "", needs: ["METRICOOL_USER_TOKEN"], lastRunAt: null }),
        actions: { "weekly-report": async () => ({ ok: false, summary: "Sin datos reales para el reporte.", error: "no_data" }) },
      } }),
      context: { env: {} },
    });
    const out = await chat.sendMessage({ text: "dame el reporte de la semana", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    const card = out.reply.results![0];
    assert.equal(card.blocked, true);
    assert.deepEqual(card.needs, ["METRICOOL_USER_TOKEN"]);
    assert.match(out.reply.text, /Necesita: METRICOOL_USER_TOKEN/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a post goes to the publisher as pending and is never approved by the CEO", async () => {
  const dir = await tempDir();
  try {
    const { chat, calls, finished } = setup(dir);
    const missing = await chat.sendMessage({ text: "prepara un post", actor: PARTNER, authorName: "Socio", contextUserId: "robert" });
    assert.equal(calls.filter((call) => call.operation === "add").length, 0, "nothing is sent without the needed data");
    assert.match(missing.reply.text, /me falta/);

    const out = await chat.sendMessage({ text: POST_TEXT, actor: PARTNER, authorName: "Socio", contextUserId: "robert" });
    const card = out.reply.results![0];
    assert.equal(card.ok, true, card.summary);
    assert.equal(card.approvals.length, 1);
    assert.equal(card.approvals[0].status, "pending");
    assert.equal(out.pendingApprovals.length, 1);
    assert.equal(finished.length, 0, "an order waiting for approval stays open");
    assert.match(out.reply.text, /esperando tu aprobaci[oó]n/);

    const asked = await chat.sendMessage({ text: "apruebalo y publicalo ya", actor: PARTNER, authorName: "Socio", contextUserId: "robert" });
    assert.match(asked.reply.text, /No apruebo ni rechazo desde el chat/);
    assert.equal(calls.filter((call) => call.operation === "approve" || call.operation === "reject" || call.operation === "schedule").length, 0);
    assert.equal((await chat.view("robert")).pendingApprovals.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an explicit approve click by the partner is recorded with who decided", async () => {
  const dir = await tempDir();
  try {
    const { chat, audit } = setup(dir);
    const out = await chat.sendMessage({ text: POST_TEXT, actor: PARTNER, authorName: "Socio", contextUserId: "robert" });
    const id = out.pendingApprovals[0].id;
    const decided = await chat.decideApproval({ id, decision: "approve", actor: PARTNER, authorName: "Socio", contextUserId: "robert" });
    assert.equal(decided.result.ok, true, decided.result.summary);
    assert.deepEqual((decided.result.report as { item: { decidedBy: unknown } }).item.decidedBy, PARTNER);
    assert.equal(decided.pendingApprovals.length, 0);
    assert.match(decided.message.text, /Socio \(socio\) aprobo/);
    assert.ok(audit.some((entry) => entry.operation === "ceo-chat:approve" && entry.targetId === id && entry.actor.role === "partner"));
    await assert.rejects(chat.decideApproval({ id, decision: "publish", actor: PARTNER, authorName: "Socio", contextUserId: "robert" }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("ambiguous text uses the cheap AI classifier only when the rules find nothing", async () => {
  const dir = await tempDir();
  try {
    const prompts: string[] = [];
    const ai = async (prompt: string, purpose: "classify" | "reply") => { prompts.push(purpose); return purpose === "classify" ? "website" : "Ya lo publique todo."; };
    const { chat, calls } = setup(dir, { ai });
    const out = await chat.sendMessage({ text: "se ve raro lo de internet de nosotros", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    assert.deepEqual(calls.filter((call) => call.ctx.actor).map((call) => call.operation), ["check"]);
    assert.equal(out.reply.routedBy, "ia");
    assert.doesNotMatch(out.reply.text, /publique/, "an AI intro that claims publishing is dropped");
    prompts.length = 0;
    await chat.sendMessage({ text: "revisa la web", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    assert.deepEqual(prompts, ["reply"], "no classifier call when the rules route the message");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("owner and partner share one thread per workspace and each message keeps its author", async () => {
  const dir = await tempDir();
  try {
    const { chat } = setup(dir);
    await chat.sendMessage({ text: "hola", actor: PARTNER, authorName: "Socio", contextUserId: "robert" });
    await chat.sendMessage({ text: "revisa la web", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    const state = await readCeoChatState(dir, "robert");
    assert.deepEqual(state.messages.map((message) => `${message.author.role}:${message.author.name}`), ["partner:Socio", "ceo:CEO Black Room", "owner:Robert", "ceo:CEO Black Room"]);
    assert.equal((await readCeoChatState(dir, "otro-owner")).messages.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("one message at a time per workspace", async () => {
  const dir = await tempDir();
  try {
    let release: () => void = () => undefined;
    const calls: Call[] = [];
    const chat = createCeoChat({
      dataDir: dir, now: () => NOW, ai: null, orders: null,
      modules: stubModules(calls, { "blackroom-website": { actions: { check: () => new Promise((resolve) => { release = () => resolve({ ok: true, summary: "ok" }); }) } } }),
      context: { env: {} },
    });
    const first = chat.sendMessage({ text: "revisa la web", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(chat.sendMessage({ text: "revisa la web", actor: PARTNER, authorName: "Socio", contextUserId: "robert" }), /todavia esta trabajando/);
    release();
    await first;
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Routes and partner policy
// ---------------------------------------------------------------------------

type Handler = (req: any, res: any) => Promise<void>;
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

test("routes: owner and partner chat and approve; anyone else is denied", async () => {
  const dir = await tempDir();
  try {
    let user: string | null = null;
    const { chat } = setup(dir);
    const { app, routes, call } = fakeApp();
    registerBlackRoomCeoChatRoutes(app as never, {
      requestUserId: () => user,
      resolveActor: async (userId) => userId === "robert" ? { actor: OWNER, contextUserId: "robert" } : userId === "socio-1" ? { actor: PARTNER, contextUserId: "robert" } : null,
      authorName: async (actor) => actor.role === "owner" ? "Robert" : "Ana",
      chat,
    });
    assert.deepEqual([...routes.keys()].sort(), ["GET /api/blackroom-ceo-chat", "POST /api/blackroom-ceo-chat/approvals/:id/:decision", "POST /api/blackroom-ceo-chat/messages"]);
    assert.equal((await call("GET /api/blackroom-ceo-chat", {})).statusCode, 401);
    user = "intruso";
    assert.equal((await call("GET /api/blackroom-ceo-chat", {})).statusCode, 403);
    assert.equal((await call("POST /api/blackroom-ceo-chat/messages", { body: { text: "revisa la web" } })).statusCode, 403);
    assert.equal((await readCeoChatState(dir, "robert")).messages.length, 0);

    user = "socio-1";
    assert.equal((await call("POST /api/blackroom-ceo-chat/messages", { body: { text: "" } })).statusCode, 400);
    const sent = await call("POST /api/blackroom-ceo-chat/messages", { body: { text: POST_TEXT } });
    assert.equal(sent.statusCode, 200);
    assert.equal(sent.body.message.author.name, "Ana");
    assert.equal(sent.body.message.author.role, "partner");
    const id = sent.body.pendingApprovals[0].id;
    assert.equal((await call("POST /api/blackroom-ceo-chat/approvals/:id/:decision", { params: { id, decision: "publish" } })).statusCode, 400);

    user = "robert";
    const view = await call("GET /api/blackroom-ceo-chat", {});
    assert.equal(view.body.role, "owner");
    assert.ok(view.body.messages.some((message: { author: { name: string } }) => message.author.name === "Ana"), "Robert sees the partner's messages");

    user = "socio-1";
    const rejected = await call("POST /api/blackroom-ceo-chat/approvals/:id/:decision", { params: { id, decision: "reject" } });
    assert.equal(rejected.statusCode, 200);
    assert.equal(rejected.body.pendingApprovals.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("partner gate allows exactly the CEO chat routes", () => {
  assert.equal(classifyPartnerRequest("GET", "/api/blackroom-ceo-chat").kind, "allow");
  assert.equal(classifyPartnerRequest("POST", "/api/blackroom-ceo-chat/messages").kind, "allow");
  assert.equal(classifyPartnerRequest("POST", "/api/blackroom-ceo-chat/approvals/post-0123456789abcdef/approve").kind, "allow");
  assert.equal(classifyPartnerRequest("POST", "/api/blackroom-ceo-chat/approvals/post-0123456789abcdef/reject").kind, "allow");
  assert.equal(classifyPartnerRequest("POST", "/api/blackroom-ceo-chat/approvals/post-0123456789abcdef/schedule").kind, "deny");
  assert.equal(classifyPartnerRequest("POST", "/api/blackroom-ceo-chat").kind, "deny");
  assert.equal(classifyPartnerRequest("GET", "/api/blackroom-ceo-chat/messages/../../settings").kind, "deny");
});


test("council placeOrder: explicit Black Room assignees replace the text routing", async () => {
  const { createAgentCouncil } = await import("../server/agent-council");
  const { BLACKROOM_DEPARTMENT_ORDER } = await import("../shared/blackroom-team");
  let raw: string | null = null;
  const council = createAgentCouncil({ now: () => Date.parse("2026-11-12T12:00:00Z"), userId: () => "robert", readState: async () => raw, writeState: async (value) => { raw = value; }, collect: async () => ({}), submitProposal: async () => "fixture", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} } as never);
  const text = 'Analiticas Black Room: Reporte semanal — pedido en el chat del CEO: "dame el reporte de videos de la radio"';
  const routed = await council.placeOrder(text, "blackroom", { userId: "robert", role: "owner" });
  assert.ok(routed.company.orders[0].assignees.length > 1, "fixture: the text alone routes to several members");
  const explicit = await council.placeOrder(text, "blackroom", { userId: "robert", role: "owner" }, { assignees: ["blackroom-analytics"] });
  assert.deepEqual(explicit.company.orders[0].assignees.map((assignee) => assignee.agentId), ["blackroom-analytics"]);
  // Non Black Room ids are filtered out; nothing left falls back to the text routing inside the team.
  const filtered = await council.placeOrder(text, "blackroom", { userId: "robert", role: "owner" }, { assignees: ["portfolio"] });
  for (const assignee of filtered.company.orders[0].assignees) assert.ok((BLACKROOM_DEPARTMENT_ORDER as readonly string[]).includes(assignee.agentId));
});

test("greetings and help get a friendly answer without running agents or placing orders", async () => {
  const dir = await tempDir();
  try {
    const { chat, calls, placed } = setup(dir);
    const hello = await chat.sendMessage({ text: "Hola!", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    assert.match(hello.reply.text, /Hola Robert/);
    assert.match(hello.reply.text, /reporte de la semana/);
    const thanks = await chat.sendMessage({ text: "gracias", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    assert.match(thanks.reply.text, /Con gusto/);
    assert.equal(calls.filter((call) => call.operation !== "list").length, 0, "only the approvals list is read");
    assert.equal(placed.length, 0);
    // A greeting followed by a real request still runs the agent.
    await chat.sendMessage({ text: "hola, revisa la web por favor", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    assert.ok(calls.some((call) => call.agentId === "blackroom-website"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("non Black Room requests from the owner become a task for the main office; partners never do", async () => {
  const dir = await tempDir();
  try {
    const general: Array<{ text: string; role: string }> = [];
    const { orders } = fakeOrders();
    orders.placeGeneral = async (text, placedBy) => { general.push({ text, role: placedBy.role }); return { orderId: "main-1", assignees: ["Asistente"] }; };
    const { chat, calls } = setup(dir, { orders });
    const out = await chat.sendMessage({ text: "agenda una reunion con el contador el lunes", actor: OWNER, authorName: "Robert", contextUserId: "robert" });
    assert.equal(calls.filter((call) => call.operation !== "list").length, 0, "only the approvals list is read");
    assert.deepEqual(general, [{ text: "agenda una reunion con el contador el lunes", role: "owner" }]);
    assert.match(out.reply.text, /no es de Black Room/);
    assert.match(out.reply.text, /Asistente/);
    assert.deepEqual(out.reply.orderIds, ["main-1"]);

    const partner = await chat.sendMessage({ text: "agenda una reunion con el contador el lunes", actor: PARTNER, authorName: "Socio", contextUserId: "robert" });
    assert.equal(general.length, 1, "a partner request never reaches the main office");
    assert.match(partner.reply.text, /no estoy seguro/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("analytics questions only run the analytics agent, with a live refresh and the full report in the card", async () => {
  assert.deepEqual(routeCeoChatMessage("dame las analiticas de black room hoy", NOW).intents.map((intent) => `${intent.agentId}:${intent.operation}`), ["blackroom-analytics:daily-report"]);
  assert.deepEqual(routeCeoChatMessage("como nos fue este mes en redes", NOW).intents.map((intent) => intent.operation), ["monthly-report"]);
  assert.deepEqual(routeCeoChatMessage("dame las analiticas de black room hoy", NOW).intents[0].input, { refresh: true });
  // Radio and videos still answer when asked by name.
  assert.ok(routeCeoChatMessage("como va la radio de black room", NOW).intents.some((intent) => intent.agentId === "radio"));
});

test("questions about how posts did go to analytics; the publisher only runs when a post is requested", () => {
  const route = (text: string) => routeCeoChatMessage(text, NOW).intents.map((intent) => intent.agentId);
  assert.deepEqual(route("como le han ido a los post de black room?"), ["blackroom-analytics"]);
  assert.deepEqual(route("que tal funcionaron los posts esta semana"), ["blackroom-analytics"]);
  assert.deepEqual(route("cuantas vistas tuvo el ultimo post"), ["blackroom-analytics"]);
  assert.deepEqual(route("como van los posts"), ["blackroom-analytics"]);
  assert.deepEqual(route("prepara un post para el viernes"), ["blackroom-publisher"]);
  assert.deepEqual(route("programa el post de manana a las 8pm"), ["blackroom-publisher"]);
});
