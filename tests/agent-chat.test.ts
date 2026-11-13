import test from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, createChatOrder, explicitTarget, handoffLog, routeAgentMessage } from "../shared/agent-chat-routing";
import { emptyCompanyState } from "../shared/agent-company";
import { createAgentCouncil, emptyCouncilState } from "../server/agent-council";
import { AgentChatModelError, createAgentChatService, createChatStorageThreadStore } from "../server/agent-chat";
import { createAgentChatModel } from "../server/agent-chat-model";
import { registerAgentChatRoutes } from "../server/agent-chat-routes";

// ---------- Routing (Spanish / English) ----------
const cases: Array<[string, string, "keep" | "handoff" | "answer", string]> = [
  ["legal", "revisa el contrato con el venue de Miami", "keep", "legal"],
  ["code", "redacta el contrato del DJ para el sábado", "handoff", "legal"],
  ["news", "fix the login bug in the app", "handoff", "app-qa"],
  ["code", "fix the login bug in the app", "keep", "code"],
  ["revenue", "prepara una campaña de Instagram para Black Room", "handoff", "marketing-cmo"],
  ["marketing-cmo", "prepara una campaña de Instagram para Black Room", "keep", "marketing-cmo"],
  ["github", "check the security of our passwords", "handoff", "cybersecurity"],
  ["legal", "@github revisa el PR 400", "handoff", "github"],
  ["code", "pásaselo a Revenue: cobrar a los promoters", "handoff", "revenue"],
  ["portfolio", "hand this off to legal: review the new privacy terms", "handoff", "legal"],
  ["ceo", "sube un reel de Kong", "handoff", "kong-videos"],
  ["ceo", "organiza mi semana", "handoff", "assistant"],
  ["assistant", "agenda una reunión con el venue el viernes", "keep", "assistant"],
  ["revenue", "schedule a meeting with the promoter tomorrow", "handoff", "assistant"],
  ["code", "estado", "answer", "code"],
  ["legal", "what are you doing?", "answer", "legal"],
];
for (const [agent, text, decision, target] of cases) {
  test(`route ${agent}: "${text}" -> ${decision} ${target}`, () => {
    const route = routeAgentMessage(agent, text);
    assert.equal(route.decision, decision);
    assert.equal(route.targetAgentId, target);
  });
}

test("intents and external-action approval flags", () => {
  assert.equal(classifyIntent("¿Qué estás haciendo?"), "status");
  assert.equal(classifyIntent("mis órdenes"), "orders");
  assert.equal(classifyIntent("last report"), "last_work");
  assert.equal(classifyIntent("ayuda"), "help");
  assert.equal(classifyIntent("¿por qué bajaron las ventas?"), "question");
  assert.equal(explicitTarget("send it to Videos Kong"), "kong-videos");
  assert.equal(routeAgentMessage("code", "publica el video en TikTok").approvalRequired, true);
  assert.equal(routeAgentMessage("code", "deploy the new version to production").approvalRequired, true);
  assert.equal(routeAgentMessage("legal", "revisa el contrato").approvalRequired, false);
});

test("createChatOrder records the hand-off on the order, the company events and the sender's memory", () => {
  let company = emptyCompanyState();
  company = { ...company, careers: { code: { agentId: "code", memory: [] } as never } };
  const { order, state } = createChatOrder(company, { text: "redacta el contrato", now: Date.parse("2026-11-12T10:00:00Z"), fromAgentId: "code", toAgentId: "legal",
    reason: "No es mi trabajo", approvalRequired: false, statuses: { legal: { state: "working", label: "ok" } }, names: { code: "Code", legal: "Legal / Compliance" } });
  assert.deepEqual(order.assignees.map(a => a.agentId), ["legal"]);
  assert.equal(order.chat?.handoff, true);
  assert.match(state.events[0].text, /Code derivó a Legal \/ Compliance/);
  assert.match(state.careers.code.memory[0].text, /Derivé "redacta el contrato" a Legal/);
  assert.deepEqual(handoffLog(state).map(h => [h.fromAgentId, h.toAgentIds[0]]), [["code", "legal"]]);
});

// ---------- Service + persistence ----------
function memoryChatStorage() {
  const conversations: Array<{ id: number; title: string; createdAt: Date }> = [];
  const messages: Array<{ id: number; conversationId: number; role: string; content: string; createdAt: Date }> = [];
  const scoped = (title: string, userId?: string) => userId ? `[owner:${Buffer.from(userId).toString("base64url")}] ${title}` : title;
  let seq = 0;
  return {
    conversations, messages,
    async getConversation(id: number, userId?: string) { const c = conversations.find(x => x.id === id); return c && (!userId || c.title.startsWith(scoped("", userId))) ? c : undefined; },
    async getConversationByTitle(title: string, userId?: string) { return conversations.find(x => x.title === scoped(title, userId)); },
    async getAllConversations(userId?: string) { return conversations.filter(c => !userId || c.title.startsWith(scoped("", userId))); },
    async createConversation(title: string, userId?: string) { const c = { id: ++seq, title: scoped(title, userId), createdAt: new Date(Date.parse("2026-11-12T10:00:00Z") + seq) }; conversations.push(c); return c; },
    async getMessagesByConversation(id: number) { return messages.filter(m => m.conversationId === id); },
    async createMessage(conversationId: number, role: string, content: string) { const m = { id: ++seq, conversationId, role, content, createdAt: new Date() }; messages.push(m); return m; },
  };
}
function council(initial = emptyCouncilState()) {
  let raw: string | null = JSON.stringify(initial);
  const c = createAgentCouncil({ now: () => Date.parse("2026-11-12T10:05:00Z"), userId: () => "owner", readState: async () => raw, writeState: async next => { raw = next; },
    collect: async () => ({}), submitProposal: async () => "x", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  return c;
}
const stateWithStatuses = () => {
  const s = emptyCouncilState();
  s.lastCycleAt = "2026-11-12T10:00:00Z";
  s.lastStatuses = { code: { state: "working", label: "Revisando PRs de blackops" }, legal: { state: "working", label: "Revisando términos" } };
  return s;
};

test("hand-off: Code passes a legal task to Legal; order, A2A inbox and history persist across service instances", async () => {
  const storage = memoryChatStorage();
  const officeCouncil = council(stateWithStatuses());
  const service = createAgentChatService({ store: createChatStorageThreadStore(storage, "owner"), council: officeCouncil, now: () => Date.parse("2026-11-12T10:05:00Z") });
  const result = await service.send("code", { text: "redacta el contrato del DJ para el sábado", requestId: "req-handoff-1" });
  assert.equal(result.route.decision, "handoff");
  assert.equal(result.messages[1].role, "handoff");
  assert.match(result.messages[1].text, /Legal \/ Compliance/);
  const orders = (await officeCouncil.load()).company.orders;
  assert.equal(orders.length, 1);
  assert.deepEqual(orders[0].assignees.map(a => [a.agentId, a.status]), [["legal", "en_curso"]]);
  assert.equal(orders[0].chat?.fromAgentId, "code");
  assert.match((await officeCouncil.load()).company.events[0].text, /derivó a Legal/);
  // Same requestId: no duplicate order or messages.
  await service.send("code", { text: "redacta el contrato del DJ para el sábado", requestId: "req-handoff-1" });
  assert.equal((await officeCouncil.load()).company.orders.length, 1);

  // Fresh service over the same storage (= restart): threads and the A2A inbox are still there.
  const again = createAgentChatService({ store: createChatStorageThreadStore(storage, "owner"), council: officeCouncil });
  const codeThreads = await again.threads("code");
  assert.equal(codeThreads.length, 1);
  assert.equal((await again.thread("code", codeThreads[0].id)).messages.length, 2);
  const legalThreads = await again.threads("legal");
  assert.equal(legalThreads[0].inbox, true);
  const inbox = (await again.thread("legal", legalThreads[0].id)).messages;
  assert.deepEqual(inbox.map(m => [m.role, m.fromAgentId]), [["peer", "code"], ["agent", undefined]]);
  assert.match(inbox[1].text, /Recibida de Code/);
  assert.match(inbox[1].text, /Revisando términos/);
  assert.deepEqual((await again.handoffs()).map(h => [h.fromAgentId, h.toAgentIds[0]]), [["code", "legal"]]);
  // Another owner sees nothing; another agent's thread id is rejected.
  assert.equal((await createChatStorageThreadStore(storage, "intruder").listThreads("code")).length, 0);
  await assert.rejects(again.thread("legal", codeThreads[0].id), /no encontrada/);
});

test("status replies are grounded in recorded state and create no order", async () => {
  const officeCouncil = council(stateWithStatuses());
  const service = createAgentChatService({ store: createChatStorageThreadStore(memoryChatStorage(), "owner"), council: officeCouncil, now: () => Date.parse("2026-11-12T10:05:00Z") });
  const result = await service.send("code", { text: "¿qué estás haciendo?", requestId: "req-status-1" });
  assert.match(result.messages[1].text, /Revisando PRs de blackops/);
  assert.match(result.messages[1].text, /No tengo órdenes abiertas/);
  const none = await service.send("portfolio", { text: "estado", requestId: "req-status-2" });
  assert.match(none.messages[1].text, /Sin estado registrado/);
  assert.equal((await officeCouncil.load()).company.orders.length, 0);
});

test("external actions are recorded with an approval flag, never executed", async () => {
  const officeCouncil = council(stateWithStatuses());
  const service = createAgentChatService({ store: createChatStorageThreadStore(memoryChatStorage(), "owner"), council: officeCouncil });
  const result = await service.send("code", { text: "deploy the new version to production", requestId: "req-approval-1" });
  assert.equal(result.route.decision, "keep");
  assert.match(result.messages[1].text, /Requiere tu aprobación/);
  assert.equal((await officeCouncil.load()).company.orders[0].chat?.approvalRequired, true);
});

test("budget fallback: model off, model budget exhausted, and the pre-check never calls the provider", async () => {
  const store = () => createChatStorageThreadStore(memoryChatStorage(), "owner");
  const off = await createAgentChatService({ store: store(), council: council() }).send("revenue", { text: "¿por qué bajaron las ventas?", requestId: "req-model-1" });
  assert.equal(off.model, "off");
  assert.match(off.messages[1].text, /apagado/);
  const exhausted = await createAgentChatService({ store: store(), council: council(), model: { ask: async () => { throw new AgentChatModelError("budget_exhausted"); } } })
    .send("revenue", { text: "¿por qué bajaron las ventas?", requestId: "req-model-2" });
  assert.equal(exhausted.model, "budget_exhausted");
  assert.match(exhausted.messages[1].text, /presupuesto mensual de tokens/);

  const full = emptyCouncilState();
  full.officeExecution = { roles: { version: 1, roles: {} } as never, tokens: { reservations: [{ id: "r1", month: "2026-11", model: "m", reservedTokens: 9_990, createdAt: "2026-11-01T00:00:00Z", status: "reserved" }] } };
  const fullCouncil = council(full);
  let calls = 0;
  const model = createAgentChatModel(fullCouncil as never, { AGENT_CHAT_MODEL_ENABLED: "true", OFFICE_REVIEW_PROVIDER: "openai", OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT: "10000" },
    { run: async () => { calls++; return { text: "never" }; } })!;
  await assert.rejects(model.ask("hola", "req-model-3"), (e: unknown) => e instanceof AgentChatModelError && e.code === "budget_exhausted");
  assert.equal(calls, 0);
  assert.equal(createAgentChatModel(fullCouncil as never, { OFFICE_REVIEW_PROVIDER: "openai" }), undefined, "off unless AGENT_CHAT_MODEL_ENABLED=true");

  const used = await createAgentChatService({ store: store(), council: council(stateWithStatuses()), model: { ask: async prompt => { assert.match(prompt, /Usa SOLO los datos registrados/); return "Respuesta con datos."; } } })
    .send("code", { text: "¿por qué está lento el deploy?", requestId: "req-model-4" });
  assert.equal(used.model, "used");
});

// ---------- Routes / auth ----------
function fakeApp() {
  const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
  return {
    handlers,
    get: (path: string, h: never) => { handlers.set(`GET ${path}`, h); },
    post: (path: string, h: never) => { handlers.set(`POST ${path}`, h); },
  };
}
async function call(app: ReturnType<typeof fakeApp>, key: string, req: Record<string, unknown>) {
  let status = 200, body: unknown;
  const res = { status(code: number) { status = code; return res; }, json(value: unknown) { body = value; return res; }, set() { return res; } };
  await app.handlers.get(key)!({ params: {}, body: {}, ...req }, res);
  return { status, body: body as Record<string, any> };
}

test("routes: 401 without session, 403 for non-owner, 400 bad input, 200 owner", async () => {
  const app = fakeApp();
  const service = createAgentChatService({ store: createChatStorageThreadStore(memoryChatStorage(), "owner"), council: council() });
  registerAgentChatRoutes(app as never, { service: () => service, ownerUserId: () => "owner", requestUserId: (req: any) => req.user ?? null });
  assert.equal((await call(app, "GET /api/agent-chat/agents", {})).status, 401);
  assert.equal((await call(app, "GET /api/agent-chat/agents", { user: "someone" })).status, 403);
  assert.equal((await call(app, "POST /api/agent-chat/:agentId/messages", { user: "someone", params: { agentId: "code" }, body: { text: "hola", requestId: "req-auth-1" } })).status, 403);
  assert.equal((await call(app, "POST /api/agent-chat/:agentId/messages", { user: "owner", params: { agentId: "nope" }, body: { text: "hola", requestId: "req-auth-2" } })).status, 400);
  assert.equal((await call(app, "POST /api/agent-chat/:agentId/messages", { user: "owner", params: { agentId: "code" }, body: { text: "", requestId: "req-auth-3" } })).status, 400);
  const ok = await call(app, "GET /api/agent-chat/agents", { user: "owner" });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.agents.some((a: { id: string }) => a.id === "news:ny-news"));
  const sent = await call(app, "POST /api/agent-chat/:agentId/messages", { user: "owner", params: { agentId: "code" }, body: { text: "ayuda", requestId: "req-auth-4" } });
  assert.equal(sent.status, 200);
  assert.equal((await call(app, "GET /api/agent-chat/:agentId/threads/:threadId", { user: "owner", params: { agentId: "legal", threadId: sent.body.thread.id } })).status, 404);
});

// ---------- QA regressions (PR #402 review) ----------
test("concurrent sends with the same requestId create one order and one hand-off", async () => {
  const storage = memoryChatStorage();
  const officeCouncil = council(stateWithStatuses());
  const service = createAgentChatService({ store: createChatStorageThreadStore(storage, "owner"), council: officeCouncil });
  const body = { text: "redacta el contrato del DJ", requestId: "req-concurrent-1" };
  await Promise.all([service.send("code", body), service.send("code", body), service.send("code", body)]);
  assert.equal((await officeCouncil.load()).company.orders.length, 1);
  const legal = await service.threads("legal");
  assert.equal(legal.filter(t => t.inbox).length, 1);
  assert.equal((await service.thread("legal", legal[0].id)).messages.filter(m => m.role === "peer").length, 1);
});

test("retry after a partial failure (order placed, inbox append failed) reuses the order", async () => {
  const storage = memoryChatStorage();
  const officeCouncil = council(stateWithStatuses());
  const real = createChatStorageThreadStore(storage, "owner");
  let failInbox = true;
  const flaky = { ...real, inboxThread: async (id: string) => { if (failInbox) throw new Error("db down"); return real.inboxThread(id); } };
  const service = createAgentChatService({ store: flaky, council: officeCouncil });
  const body = { text: "redacta el contrato del DJ", requestId: "req-partial-1" };
  await assert.rejects(service.send("code", body));
  failInbox = false;
  const retry = await service.send("code", body);
  const orders = (await officeCouncil.load()).company.orders;
  assert.equal(orders.length, 1);
  assert.equal(retry.order?.id, orders[0].id);
  // A fresh process (no in-memory cache) retrying again still does not duplicate the order or the hand-off.
  await createAgentChatService({ store: real, council: officeCouncil }).send("code", body);
  assert.equal((await officeCouncil.load()).company.orders.length, 1);
  const inbox = await real.inboxThread("legal");
  assert.equal((await real.listMessages(inbox.id)).filter(m => m.role === "peer").length, 1);
});

test("concurrent inbox creation yields one inbox thread", async () => {
  const store = createChatStorageThreadStore(memoryChatStorage(), "owner");
  const threads = await Promise.all([store.inboxThread("legal"), store.inboxThread("legal"), store.inboxThread("legal")]);
  assert.equal(new Set(threads.map(t => t.id)).size, 1);
});

test("council view for non-owners hides chat orders, hand-off events and hand-off memory", async () => {
  const { redactChatActivity } = await import("../shared/agent-chat-routing");
  const seeded = council(stateWithStatuses());
  await seeded.placeChatOrder({ text: "redacta el contrato secreto", fromAgentId: "code", toAgentId: "legal", reason: "x", approvalRequired: false, requestId: "r1" });
  await seeded.placeChatOrder({ text: "revisa el PR privado", fromAgentId: "code", toAgentId: "code", reason: "x", approvalRequired: false, requestId: "r2" });
  await seeded.placeOrder("orden del CEO visible");
  const company = (await seeded.load()).company;
  const red = redactChatActivity(company);
  assert.deepEqual(red.orders.map(o => o.text), ["orden del CEO visible"]);
  assert.ok(red.events.every(e => !/secreto|privado/.test(e.text)));
  for (const career of Object.values(red.careers)) assert.ok(career.memory.every(m => !/secreto|privado/.test(m.text)), JSON.stringify(career.memory));
  const crafted = redactChatActivity({ ...company, careers: { code: { agentId: "code", memory: [{ at: "x", text: "Orden normal" }, { at: "y", text: 'Derivé "redacta el contrato secreto" a Legal.' }] } as never } });
  assert.deepEqual(crafted.careers.code.memory.map(m => m.text), ["Orden normal"]);

  const { registerAgentCouncilRoutes } = await import("../server/agent-council-routes");
  const app = fakeApp();
  registerAgentCouncilRoutes(app as never, { council: seeded as never, requestUserId: ((req: any) => req.user) as never, ownerUserId: () => "owner", readFactoryJobs: async () => [] });
  const other = await call(app, "GET /api/agent-council/state", { user: "someone" });
  assert.equal(other.status, 200);
  assert.doesNotMatch(JSON.stringify(other.body.company), /secreto|privado/);
  const owner = await call(app, "GET /api/agent-council/state", { user: "owner" });
  assert.match(JSON.stringify(owner.body.company), /secreto/);
});

test("approval flags and routing fixes from QA", () => {
  for (const text of ["manda un correo al venue", "sube el video a TikTok", "email the venue owner", "pagarle al DJ", "escríbele por WhatsApp al promotor", "reembolsa la entrada", "págale al DJ"]) {
    assert.equal(routeAgentMessage("ceo", text).approvalRequired, true, text);
  }
  assert.equal(routeAgentMessage("ceo", "págale al DJ").targetAgentId, "revenue");
  assert.equal(explicitTarget("ask GitHub to review the open PRs"), "github");
  assert.equal(explicitTarget("dile a Legal que revise esto"), "legal");
  assert.equal(routeAgentMessage("code", "ask GitHub to review the open PRs").targetAgentId, "github");
  assert.equal(routeAgentMessage("legal", "revisa el contrato").approvalRequired, false);
  assert.equal(routeAgentMessage("code", "estado").approvalRequired, false);
});

// ---------- Final polish (re-QA) ----------
test("technical nouns are not outreach; outreach toward a person still needs approval", () => {
  for (const text of ["fix the email validation bug", "refactor the API call", "la función se llama getUser", "fix the pay button style"]) {
    assert.equal(routeAgentMessage("code", text).approvalRequired, false, text);
  }
  for (const text of ["email the venue owner", "call the venue", "llámale al promotor", "llama al DJ mañana", "send an email to the promoter", "pay the supplier $200"]) {
    assert.equal(routeAgentMessage("ceo", text).approvalRequired, true, text);
  }
  assert.deepEqual([routeAgentMessage("code", "fix the pay button style").decision, routeAgentMessage("code", "fix the pay button style").targetAgentId], ["keep", "code"]);
});

test("asking about another agent's status is answered from its data, with no order", async () => {
  for (const text of ["tell me what Legal is doing", "¿qué está haciendo Legal?", "dime el estado de Legal"]) {
    const route = routeAgentMessage("ceo", text);
    assert.deepEqual([route.intent, route.decision, route.targetAgentId], ["status", "answer", "legal"], text);
  }
  const officeCouncil = council(stateWithStatuses());
  const service = createAgentChatService({ store: createChatStorageThreadStore(memoryChatStorage(), "owner"), council: officeCouncil, now: () => Date.parse("2026-11-12T10:05:00Z") });
  const result = await service.send("ceo", { text: "tell me what Legal is doing", requestId: "req-other-status" });
  assert.match(result.messages[1].text, /Según el registro de \*\*Legal/);
  assert.match(result.messages[1].text, /Revisando términos/);
  assert.equal((await officeCouncil.load()).company.orders.length, 0);
});

test("retry after failure reuses the thread and the user message (requestId-idempotent)", async () => {
  const storage = memoryChatStorage();
  const officeCouncil = council(stateWithStatuses());
  let failLoad = true;
  const flakyCouncil = { load: async () => { if (failLoad) throw new Error("db down"); return officeCouncil.load(); }, placeChatOrder: officeCouncil.placeChatOrder };
  const body = { text: "revisa el contrato del venue", requestId: "req-retry-thread" };
  await assert.rejects(createAgentChatService({ store: createChatStorageThreadStore(storage, "owner"), council: flakyCouncil }).send("legal", body));
  failLoad = false;
  // New process, same requestId, no threadId (first message of a conversation).
  const service = createAgentChatService({ store: createChatStorageThreadStore(storage, "owner"), council: flakyCouncil });
  const result = await service.send("legal", body);
  const threads = await service.threads("legal");
  assert.equal(threads.length, 1);
  const messages = (await service.thread("legal", threads[0].id)).messages;
  assert.deepEqual(messages.map(m => m.role), ["user", "agent"]);
  assert.equal(result.messages[0].id, messages[0].id);
  // A third retry after success (fresh process) writes nothing new and returns the same order.
  const again = await createAgentChatService({ store: createChatStorageThreadStore(storage, "owner"), council: officeCouncil }).send("legal", body);
  assert.equal((await service.thread("legal", threads[0].id)).messages.length, 2);
  assert.equal(again.order?.id, result.order?.id);
  assert.equal((await officeCouncil.load()).company.orders.length, 1);
});
