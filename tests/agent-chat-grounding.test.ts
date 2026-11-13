// Escenarios en español: cada agente responde solo con sus datos registrados, dice "no tengo ese dato"
// cuando no los tiene y manda a Robert al agente correcto (handoff estructurado). Sin llamadas reales a OpenAI.
import test from "node:test";
import assert from "node:assert/strict";
import { routeAgentMessage } from "../shared/agent-chat-routing";
import { buildAgentChatDirectory, directoryCityNames, findAgentChatEntry } from "../shared/agent-chat-directory";
import { emptyCouncilState } from "../server/agent-council";
import { NO_DATA, createAgentChatService, createChatStorageThreadStore, unsupportedNumbers, type AgentChatModel } from "../server/agent-chat";
import { registerAgentChatRoutes } from "../server/agent-chat-routes";

const NOW = Date.parse("2026-11-13T10:05:00Z");

function memoryChatStorage() {
  const conversations: Array<{ id: number; title: string; createdAt: Date }> = [];
  const messages: Array<{ id: number; conversationId: number; role: string; content: string; createdAt: Date }> = [];
  const scoped = (title: string, userId?: string) => userId ? `[owner:${userId}] ${title}` : title;
  let seq = 0;
  return {
    async getConversation(id: number, userId?: string) { const c = conversations.find(x => x.id === id); return c && (!userId || c.title.startsWith(scoped("", userId))) ? c : undefined; },
    async getConversationByTitle(title: string, userId?: string) { return conversations.find(x => x.title === scoped(title, userId)); },
    async getAllConversations(userId?: string) { return conversations.filter(c => !userId || c.title.startsWith(scoped("", userId))); },
    async createConversation(title: string, userId?: string) { const c = { id: ++seq, title: scoped(title, userId), createdAt: new Date(NOW + seq) }; conversations.push(c); return c; },
    async getMessagesByConversation(id: number) { return messages.filter(m => m.conversationId === id); },
    async createMessage(conversationId: number, role: string, content: string) { const m = { id: ++seq, conversationId, role, content, createdAt: new Date(NOW) }; messages.push(m); return m; },
  };
}

function seededState() {
  const s = emptyCouncilState();
  s.lastCycleAt = "2026-11-13T10:00:00Z";
  s.kongObservedAt = "2026-11-13T10:01:00Z";
  s.lastStatuses = {
    legal: { state: "working", label: "Revisando términos de privacidad" },
    revenue: { state: "available", label: "Pipeline actualizado" },
  };
  s.kongLastStatuses = {
    "kong-city:miami:clubs": { state: "offline", label: "Ronda completada; esperando próximo turno" },
    "kong-city:miami:events": { state: "working", label: "Consultando calendarios oficiales" },
    "kong:Venues": { state: "offline", label: "Resultado confirmado; esperando próximo turno" },
  };
  const career = (agentId: string, points: number, battery: number, memory: Array<{ at: string; text: string }> = []) =>
    ({ agentId, generation: 1, nickname: agentId, points, battery, lastState: null, cyclesWorking: 0, cyclesTotal: 0, ordersDone: 3, firedCount: 0, hiredAt: "2026-11-01T00:00:00Z", memory });
  s.company = { ...s.company, careers: { legal: career("legal", 42, 80) },
    trainees: [{ id: "legal#2", forAgentId: "legal", role: "Legal / Compliance", nickname: "Lexi", startedAt: "2026-11-10T00:00:00Z", modulesDone: ["m1", "m2"], knowledge: [], learned: [{ id: "m1", title: "Privacidad de datos" }] }] };
  s.kongCompany = { ...s.kongCompany, careers: {
    "kong-city:miami:clubs": career("kong-city:miami:clubs", 12, 74, [{ at: "2026-11-01T00:00:00Z", text: "Contratado como Miami · clubs." }]),
    "kong-city:buenos-aires:events": career("kong-city:buenos-aires:events", 5, 60, [{ at: "2026-11-01T00:00:00Z", text: "Contratado como Buenos Aires · events." }]),
  } };
  return s;
}

function fakeCouncil(state = seededState()) {
  const placed: Array<{ toAgentId: string; text: string }> = [];
  return {
    placed,
    load: async () => state,
    placeChatOrder: async (input: { text: string; toAgentId: string }) => {
      placed.push(input);
      return { id: `ord-${placed.length}`, text: input.text, createdAt: new Date(NOW).toISOString(), assignees: [{ agentId: input.toAgentId, status: "en_curso" as const, note: "Anotada." }] };
    },
  };
}
const countingModel = (answer: string) => {
  const calls: string[] = [];
  const model: AgentChatModel = { ask: async prompt => { calls.push(prompt); return answer; } };
  return { model, calls };
};
const service = (council = fakeCouncil(), model?: AgentChatModel, storage = memoryChatStorage()) =>
  createAgentChatService({ store: createChatStorageThreadStore(storage, "owner"), council, model, now: () => NOW });

test("inventario: el directorio incluye BlackOps, Black Room, KONG central, ciudades KONG, fábrica y academia", () => {
  const entries = buildAgentChatDirectory(seededState());
  const groups = new Set(entries.map(e => e.group));
  for (const group of ["blackops", "blackroom", "kong-desk", "kong-city", "factory", "academy"]) assert.ok(groups.has(group as never), group);
  for (const id of ["ceo", "blackroom-analytics", "kong:KONG AI", "kong:Promoters + Mesas", "kong:Venues", "kong:Kong Legal", "kong-videos", "kong-metrics",
    "kong-city:miami:clubs", "kong-city:miami:events", "factory-builder", "trainee:legal#2"]) assert.ok(findAgentChatEntry(entries, id), id);
  assert.equal(findAgentChatEntry(entries, "kong-city:buenos-aires:events")?.name, "Buenos Aires · Eventos");
  // Ids del popup KONG de la oficina resuelven al mismo agente.
  assert.equal(findAgentChatEntry(entries, "Kong-Venues")?.id, "kong:Venues");
});

test("datos propios: Legal responde su estado registrado, sin orden ni modelo", async () => {
  const { model, calls } = countingModel("no debería usarse");
  const council = fakeCouncil();
  const result = await service(council, model).send("legal", { text: "¿Qué estás haciendo?", requestId: "es-own-status" });
  assert.match(result.messages[1].text, /Revisando términos de privacidad/);
  assert.equal(result.handoff, null);
  assert.equal(calls.length, 0);
  assert.equal(council.placed.length, 0);
});

test("datos propios con modelo: el prompt inyecta los datos reales del agente y prohíbe inventar", async () => {
  const { model, calls } = countingModel("Tengo 42 puntos y batería 80%.");
  const result = await service(fakeCouncil(), model).send("legal", { text: "¿cómo va tu carrera en la oficina?", requestId: "es-own-model" });
  assert.equal(result.model, "used");
  assert.match(result.messages[1].text, /42 puntos/);
  assert.match(calls[0], /Revisando términos de privacidad/);
  assert.match(calls[0], /42 puntos, batería 80%/);
  assert.match(calls[0], /No tengo ese dato registrado/);
  assert.match(calls[0], /cada número de tu respuesta debe aparecer en los datos/);
});

test("sin el dato: la fábrica no inventa ventas, dice 'no tengo' y manda a Revenue (sin gastar modelo)", async () => {
  const { model, calls } = countingModel("Vendimos 9999 dólares");
  const result = await service(fakeCouncil(), model).send("factory-builder", { text: "¿cuántas ventas tuvimos este mes?", requestId: "es-nodata-1" });
  assert.ok(result.messages[1].text.startsWith(NO_DATA));
  assert.deepEqual(result.handoff && [result.handoff.agentId, result.handoff.name], ["revenue", "Revenue"]);
  assert.doesNotMatch(result.messages[1].text, /9999/);
  assert.equal(calls.length, 0, "una pregunta de otra área no llama al modelo");
});

test("sin el dato propio: modelo apagado → 'no tengo ese dato' + lo registrado, y apunta a quien sí lo tiene", async () => {
  const result = await service().send("kong-city:miami:events", { text: "¿qué eventos hay este fin de semana en Miami?", requestId: "es-nodata-2" });
  assert.ok(result.messages[1].text.startsWith(NO_DATA));
  assert.match(result.messages[1].text, /Consultando calendarios oficiales/);
  assert.equal(result.handoff, null, "el puesto dueño no se deriva a sí mismo");
  const status = await service().send("kong-city:miami:events", { text: "último trabajo", requestId: "es-nodata-3" });
  assert.match(status.messages[1].text, /listados concretos .* viven en KONG/);
});

test("otra área: le pregunto a Legal por los clubs de Miami → lo manda al puesto de clubs de Miami", async () => {
  const council = fakeCouncil();
  const storage = memoryChatStorage();
  const result = await service(council, undefined, storage).send("legal", { text: "¿qué clubs hay abiertos en Miami?", requestId: "es-cross-1" });
  assert.ok(result.messages[1].text.startsWith(NO_DATA));
  assert.deepEqual(result.handoff && [result.handoff.agentId, result.handoff.name], ["kong-city:miami:clubs", "Miami · Clubs"]);
  assert.match(result.messages[1].text, /Habla con \*\*Miami · Clubs\*\*/);
  // El botón "Hablar con X" sobrevive a recargar: el destino queda guardado en el mensaje.
  const again = service(council, undefined, storage);
  const thread = (await again.threads("legal"))[0];
  const stored = (await again.thread("legal", thread.id)).messages;
  assert.equal(stored[1].handoffTo, "kong-city:miami:clubs");
  // Y el chat del destino se abre: responde con su propio registro.
  const target = await again.send("kong-city:miami:clubs", { text: "estado", requestId: "es-cross-2" });
  assert.match(target.messages[1].text, /Ronda completada; esperando próximo turno/);
  assert.equal(council.placed.length, 0);
});

test("otra área (tarea): Code deriva un contrato a Legal con orden y handoff estructurado", async () => {
  const council = fakeCouncil();
  const result = await service(council).send("code", { text: "redacta el contrato del DJ para el sábado", requestId: "es-cross-task" });
  assert.equal(result.route.decision, "handoff");
  assert.deepEqual(result.handoff && result.handoff.agentId, "legal");
  assert.equal(result.messages[1].handoffTo, "legal");
  assert.deepEqual(council.placed.map(p => p.toAgentId), ["legal"]);
});

test("ruteo de ciudades KONG: 'eventos en Miami' → kong-city:miami:events; 'noticias de Miami' sigue en Noticias Miami", () => {
  const entries = buildAgentChatDirectory(seededState());
  const ids = entries.map(e => e.id);
  const directory = { profiles: entries, cityNames: directoryCityNames(entries) };
  const route = (agent: string, text: string) => routeAgentMessage(agent, text, ids, directory);
  assert.deepEqual([route("ceo", "busca eventos en Miami").decision, route("ceo", "busca eventos en Miami").targetAgentId], ["handoff", "kong-city:miami:events"]);
  assert.equal(route("legal", "¿qué clubs hay en Miami?").targetAgentId, "kong-city:miami:clubs");
  assert.equal(route("ceo", "revisa los eventos en Buenos Aires").targetAgentId, "kong-city:buenos-aires:events");
  assert.equal(route("ceo", "prepara las noticias de Miami").targetAgentId, "news:miami-news");
  assert.equal(route("ceo", "confirma los promotores de este viernes").targetAgentId, "kong:Promoters + Mesas");
  assert.equal(route("ceo", "pásaselo a Venues").targetAgentId, "kong:Venues");
});

test("tarea para un puesto KONG: no se inventa una orden, se manda a su chat (y Videos Kong ya no falla)", async () => {
  const council = fakeCouncil();
  const events = await service(council).send("ceo", { text: "busca eventos en Miami", requestId: "es-kong-task" });
  assert.equal(events.handoff?.agentId, "kong-city:miami:events");
  assert.match(events.messages[1].text, /puesto de KONG/);
  const reel = await service(council).send("ceo", { text: "sube un reel de Kong", requestId: "es-kong-reel" });
  assert.equal(reel.handoff?.agentId, "kong-videos");
  assert.equal(council.placed.length, 0);
});

test("sin cifras inventadas: un número que no está en los datos inyectados se descarta", async () => {
  assert.deepEqual(unsupportedNumbers("Hay 37 eventos y 42 puntos", "Carrera: 42 puntos"), ["37"]);
  const { model } = countingModel("Esta semana cerré 37 revisiones legales.");
  const result = await service(fakeCouncil(), model).send("legal", { text: "¿cuántas revisiones cerraste esta semana?", requestId: "es-numbers" });
  assert.equal(result.model, "unverified");
  assert.ok(result.messages[1].text.startsWith(NO_DATA));
  assert.doesNotMatch(result.messages[1].text, /37/);
});

test("academia: el aprendiz responde con su registro y no recibe órdenes", async () => {
  const council = fakeCouncil();
  const s = service(council);
  const status = await s.send("trainee:legal#2", { text: "último trabajo", requestId: "es-trainee-1" });
  assert.match(status.messages[1].text, /Módulos completados: 2/);
  assert.match(status.messages[1].text, /Privacidad de datos/);
  const task = await s.send("trainee:legal#2", { text: "estudia el siguiente módulo", requestId: "es-trainee-2" });
  assert.match(task.messages[1].text, /aprendiz/);
  assert.equal(council.placed.length, 0);
});

test("socio (no propietario): los chats de agentes siguen bloqueados, también KONG y ciudades", async () => {
  const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
  const app = { get: (p: string, h: never) => { handlers.set(`GET ${p}`, h); }, post: (p: string, h: never) => { handlers.set(`POST ${p}`, h); } };
  registerAgentChatRoutes(app as never, { service: () => service(), ownerUserId: () => "owner", requestUserId: (req: any) => req.user ?? null });
  const call = async (key: string, req: Record<string, unknown>) => {
    let status = 200, body: any;
    const res = { status(code: number) { status = code; return res; }, json(value: unknown) { body = value; return res; }, set() { return res; } };
    await handlers.get(key)!({ params: {}, body: {}, ...req }, res);
    return { status, body };
  };
  for (const agentId of ["kong-city:miami:clubs", "kong:Venues", "legal"]) {
    const res = await call("POST /api/agent-chat/:agentId/messages", { user: "partner", params: { agentId }, body: { text: "estado", requestId: "es-partner-1" } });
    assert.equal(res.status, 403, agentId);
  }
  assert.equal((await call("GET /api/agent-chat/agents", { user: "partner" })).status, 403);
  const owner = await call("GET /api/agent-chat/agents", { user: "owner" });
  assert.ok(owner.body.agents.some((a: { id: string; group: string }) => a.id === "kong-city:miami:clubs" && a.group === "kong-city"));
  assert.equal((await call("POST /api/agent-chat/:agentId/messages", { user: "owner", params: { agentId: "kong-city:nowhere:clubs" }, body: { text: "hola", requestId: "es-partner-2" } })).status, 400);
});

test("revisión: el guard compara solo con los datos del agente, no con la pregunta ni la plantilla", async () => {
  // Robert pone 37 en la pregunta y el modelo lo repite como dato propio: no está en los datos → descartado.
  const { model } = countingModel("Sí, cerré 37 revisiones.");
  const echoed = await service(fakeCouncil(), model).send("legal", { text: "¿cerraste 37 revisiones esta semana?", requestId: "es-review-echo" });
  assert.equal(echoed.model, "unverified");
  assert.doesNotMatch(echoed.messages[1].text, /37/);
  // "máximo 120 palabras" de la plantilla tampoco vale como dato.
  assert.deepEqual(unsupportedNumbers("Te respondo en 120 palabras", "Carrera: 42 puntos"), ["120"]);
});

test("revisión: los marcadores de lista numerada no cuentan como cifras", async () => {
  assert.deepEqual(unsupportedNumbers("1. Tengo 42 puntos\n2) Batería 80%\n3. Sin órdenes", "Carrera: 42 puntos, batería 80%"), []);
  const { model } = countingModel("1. Puntos: 42\n2. Batería: 80%\n3. Órdenes cerradas: 3");
  const listed = await service(fakeCouncil(), model).send("legal", { text: "¿cómo va tu carrera en la oficina?", requestId: "es-review-list" });
  assert.equal(listed.model, "used");
  assert.match(listed.messages[1].text, /Batería: 80%/);
});

test("revisión: números escritos en palabras que no están en los datos se descartan", async () => {
  assert.deepEqual(unsupportedNumbers("Hay treinta eventos y two venues", "Carrera: 42 puntos"), ["treinta", "two"]);
  assert.deepEqual(unsupportedNumbers("Cerré tres órdenes", "Carrera: 3 órdenes cerradas"), []);
  const { model } = countingModel("Esta semana revisé cincuenta contratos.");
  const result = await service(fakeCouncil(), model).send("legal", { text: "¿cuántos contratos revisaste esta semana?", requestId: "es-review-words" });
  assert.equal(result.model, "unverified");
  assert.doesNotMatch(result.messages[1].text, /cincuenta/);
});

test("revisión: datos KONG raros no rompen el directorio ni inventan categorías", () => {
  const s = seededState();
  s.kongLastStatuses = { ...s.kongLastStatuses, "kong-city:x|y:clubs": { state: "offline", label: "x" }, "kong-city:miami:constructor": { state: "offline", label: "x" },
    "kong-city:miami:toString": { state: "offline", label: "x" } } as never;
  s.kongCompany = { ...s.kongCompany, careers: { ...s.kongCompany.careers, "kong-city:roma:clubs": { agentId: "kong-city:roma:clubs", memory: "corrupto" } as never },
    trainees: [null, { id: 7 }, { id: "ok#1", nickname: "Kiko", role: "Venues", forAgentId: "kong:Venues", startedAt: "2026-11-10T00:00:00Z", modulesDone: [], knowledge: [] }] as never };
  const entries = buildAgentChatDirectory(s);
  const ids = entries.map(e => e.id);
  assert.ok(!ids.some(id => id.includes("|") || id.endsWith(":constructor") || id.endsWith(":toString")));
  assert.ok(ids.includes("kong-city:roma:clubs"));
  assert.ok(ids.includes("trainee:ok#1"));
});
