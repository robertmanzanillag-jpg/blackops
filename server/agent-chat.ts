// Per-agent chat service (owner only). Deterministic first, $0 by default:
// - every agent the office shows can be opened (shared/agent-chat-directory.ts): BlackOps
//   departments, Black Room, KONG central desks, KONG city desks, factory engineers, trainees;
// - questions are answered ONLY from that agent's recorded data (council state, KONG readings,
//   factory ledger, academy record). A topic another agent owns is not answered: the reply says
//   "no tengo ese dato", names the owner and carries a structured `handoff` the UI turns into a
//   "Hablar con X" button;
// - tasks become normal agent-company orders (same record as POST /api/agent-company/orders),
//   handed off to the right department when it is not this agent's job (shared/agent-chat-routing.ts);
//   KONG workers and trainees get no orders from here (honest pointer instead);
// - only an open question about the agent's own work may use the model, through the office's existing
//   token budget; an answer with a number that is not in the injected data is discarded.
// Nothing here publishes, deploys, contacts anyone or runs a worker: orders are records.

import type { CouncilState } from "@shared/agent-council";
import { isKongCompanyAgent, type CompanyOrder } from "@shared/agent-company";
import { agentChatName, handoffLog, routeAgentMessage, scoreAgents, type AgentChatRoute } from "@shared/agent-chat-routing";
import { AGENT_CHAT_GROUP_LABELS, buildAgentChatDirectory, directoryCityNames, findAgentChatEntry, isAgentChatIdShape, type AgentChatEntry } from "@shared/agent-chat-directory";
import { effectiveIntegrations, integrationFor, parseIntegrationOverrides } from "@shared/agent-integrations";
import { factoryAgentsView, isFactoryAgentId } from "@shared/factory-office-agents";
import { OFFICE_KONG_CITY_TASKS } from "@shared/office-kong-supervisor";

export type AgentChatRole = "user" | "agent" | "handoff" | "peer";
export type AgentChatMessage = { id: string; threadId: string; role: AgentChatRole; agentId: string; fromAgentId?: string; text: string; at: string; requestId?: string; handoffTo?: string };
export type AgentThread = { id: string; agentId: string; title: string; createdAt: string; inbox: boolean; requestId?: string };
/** Who owns what Robert asked, so the UI can open that agent's chat. */
export type AgentChatHandoff = { agentId: string; name: string; reason: string };

export interface AgentThreadStore {
  listThreads(agentId: string): Promise<AgentThread[]>;
  createThread(agentId: string, title: string, requestId?: string): Promise<AgentThread>;
  /** The single inbox thread where other agents' hand-offs to this agent land. */
  inboxThread(agentId: string): Promise<AgentThread>;
  getThread(threadId: string): Promise<AgentThread | null>;
  listMessages(threadId: string): Promise<AgentChatMessage[]>;
  append(threadId: string, message: { role: AgentChatRole; agentId: string; fromAgentId?: string; text: string; requestId?: string; handoffTo?: string }): Promise<AgentChatMessage>;
}

export class AgentChatInputError extends Error {}
export class AgentChatNotFound extends Error {}
export class AgentChatModelError extends Error {
  constructor(public readonly code: "disabled" | "budget_exhausted" | "unavailable") { super(code); }
}
export type AgentChatModel = { ask(prompt: string, requestId: string): Promise<string> };

type Council = {
  load(): Promise<CouncilState>;
  placeChatOrder(input: { text: string; fromAgentId: string; toAgentId: string; reason: string; approvalRequired: boolean; requestId?: string }): Promise<CompanyOrder>;
};

const MAX_TEXT = 2000;
const INBOX_TITLE = "Derivaciones recibidas";
export const NO_DATA = "No tengo ese dato registrado.";

export function validateAgentChatInput(agentId: unknown, body: unknown) {
  const v = (body || {}) as { text?: unknown; requestId?: unknown; threadId?: unknown };
  if (!isAgentChatIdShape(agentId)) throw new AgentChatInputError("Agente no válido.");
  if (typeof v.text !== "string" || !v.text.trim() || v.text.trim().length > MAX_TEXT) throw new AgentChatInputError(`Escribe entre 1 y ${MAX_TEXT} caracteres.`);
  if (typeof v.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(v.requestId)) throw new AgentChatInputError("La solicitud necesita un identificador válido.");
  if (v.threadId !== undefined && v.threadId !== null && (typeof v.threadId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(v.threadId))) throw new AgentChatInputError("Conversación no válida.");
  return { agentId, text: v.text.trim(), requestId: v.requestId, threadId: (v.threadId as string | null | undefined) || undefined };
}

const when = (iso?: string | null) => iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "sin fecha";
const STATUS_FRESH_MS = 45 * 60_000;
const fallbackEntry = (id: string): AgentChatEntry => ({ id, name: agentChatName(id), job: "", aliases: [], group: "blackops", orderable: false });

/** Group-specific recorded data: KONG readings, factory ledger, academy record. Never invented. */
function groupFacts(state: CouncilState, profile: AgentChatEntry, now: number): string[] {
  const lines: string[] = [];
  if (profile.group === "kong-city" && profile.category) {
    lines.push(`Ciudad: ${profile.cityName}. Tarea del puesto: ${OFFICE_KONG_CITY_TASKS[profile.category as keyof typeof OFFICE_KONG_CITY_TASKS] || "sin tarea registrada"}.`);
    lines.push("Los listados concretos (nombres, fechas, precios o cantidades de clubs/eventos/mesas) viven en KONG y no están en mi registro de la oficina.");
  }
  if (profile.group === "kong-desk") {
    const record = state.kongSupervision?.records?.find(item => item.agentId === profile.id);
    lines.push(record ? `Última revisión del supervisor KONG (${when(record.checkedAt)}): ${record.result} — ${record.reason}` : "El supervisor KONG no tiene una revisión registrada de este puesto.");
  }
  if (profile.group === "factory" && isFactoryAgentId(profile.id)) {
    let view;
    try { view = factoryAgentsView({ ledger: state.officeExecution?.factoryCareers, now }).find(item => item.agentId === profile.id); } catch { view = undefined; }
    lines.push(view?.lastWorkedAt ? `Último trabajo registrado por la fábrica: ${when(view.lastWorkedAt)}${view.lastJobStatus ? ` (estado ${view.lastJobStatus})` : ""}${view.lastOutcome ? `, resultado ${view.lastOutcome}` : ""}.` : "La fábrica no tiene un trabajo registrado para esta etapa.");
  }
  if (profile.group === "academy") {
    const id = profile.id.slice("trainee:".length);
    const trainee = [...state.company.trainees, ...state.kongCompany.trainees].find(item => item.id === id);
    if (trainee) {
      lines.push(`Aprendiz para ${trainee.role} (puesto ${agentChatName(trainee.forAgentId)}), en la academia desde ${when(trainee.startedAt)}. Módulos completados: ${trainee.modulesDone.length}.`);
      const learned = (trainee.learned || []).slice(0, 5).map(item => item.title);
      if (learned.length) lines.push(`Aprendido sobre su puesto: ${learned.join("; ")}.`);
      if (trainee.awaitingEvidence) lines.push("Lectura terminada; faltan pruebas verificables. No ejecuta trabajo real todavía.");
      if (trainee.executionBlocker) lines.push(`Bloqueo registrado: ${trainee.executionBlocker.slice(0, 160)}`);
    }
  }
  return lines;
}

/** Everything the chat may say about an agent comes from here: recorded data only. */
export function agentFacts(state: CouncilState, agentId: string, now: number, env: NodeJS.ProcessEnv = process.env, entries: readonly AgentChatEntry[] = buildAgentChatDirectory(state)) {
  const profile = findAgentChatEntry(entries, agentId) || fallbackEntry(agentId);
  const integration = integrationFor(agentId, effectiveIntegrations(parseIntegrationOverrides(env.AGENT_INTEGRATION_OVERRIDES)));
  const kong = isKongCompanyAgent(agentId);
  // KONG desks and city desks are read from KONG by the council; their clock is the KONG reading.
  const native = profile.group === "kong-city" || agentId.startsWith("kong:");
  const statusAt = native ? state.kongObservedAt : state.lastCycleAt;
  const fresh = !!statusAt && now - Date.parse(statusAt) < STATUS_FRESH_MS && (native || !state.lastCycleError);
  const status = state.lastStatuses[agentId] || (kong ? state.kongLastStatuses?.[agentId] : undefined);
  const company = kong ? state.kongCompany : state.company;
  const career = company.careers[agentId];
  const openOrders = company.orders.filter(o => !o.doneAt && o.assignees.some(a => a.agentId === agentId)).slice(0, 5);
  const jobs = (state.officeExecution?.roleWork?.jobs || []).filter(job => job.role === agentId);
  const lastJob = jobs[jobs.length - 1];
  const handoffs = handoffLog(state.company).filter(h => h.fromAgentId === agentId || h.toAgentIds.includes(agentId)).slice(0, 5);
  return { profile, integration, fresh, status, career, openOrders, lastJob, handoffs, lastCycleAt: statusAt, source: native ? "la lectura de KONG" : "el consejo", extra: groupFacts(state, profile, now) };
}
type Facts = ReturnType<typeof agentFacts>;

function statusLine(f: Facts) {
  const mode = f.integration.mode !== "activa" ? ` Modo: ${f.integration.mode} — ${f.integration.reason}` : "";
  if (!f.status) return `Sin estado registrado por ${f.source} (última lectura: ${when(f.lastCycleAt)}).${mode}`;
  return `Último estado registrado por ${f.source} (${when(f.lastCycleAt)}${f.fresh ? "" : ", no reciente"}): **${f.status.state}** — ${f.status.label}.${mode}`;
}
function ordersBlock(f: Facts) {
  if (!f.openOrders.length) return "No tengo órdenes abiertas.";
  return `Órdenes abiertas (${f.openOrders.length}):\n${f.openOrders.map(o => `- \`${o.id}\` ${o.text.slice(0, 80)} — ${o.assignees.find(a => a.agentId === f.profile.id)?.status}${o.chat?.approvalRequired ? " · requiere aprobación" : ""}`).join("\n")}`;
}
function careerLine(f: Facts) {
  return f.career ? `Carrera: ${f.career.points} puntos, batería ${f.career.battery}%, ${f.career.ordersDone} órdenes cerradas.` : "";
}
function lastWorkBlock(f: Facts) {
  const lines: string[] = [];
  if (f.lastJob) lines.push(`Último trabajo de rol en la oficina cloud: **${f.lastJob.status}** (inicio ${when(f.lastJob.startedAt)}${f.lastJob.completedAt ? `, fin ${when(f.lastJob.completedAt)}` : ""})${f.lastJob.reason ? ` — ${f.lastJob.reason.slice(0, 160)}` : ""}.`);
  else if (!f.extra.length) lines.push("La oficina cloud no tiene un trabajo de rol registrado para mí.");
  lines.push(...f.extra);
  const memory = f.career?.memory?.slice(0, 3) || [];
  if (memory.length) lines.push(`Mi memoria reciente:\n${memory.map(m => `- ${when(m.at)}: ${m.text}`).join("\n")}`);
  return lines.join("\n");
}
function handoffBlock(f: Facts) {
  if (!f.handoffs.length) return "No hay derivaciones registradas entre otros agentes y yo.";
  return `Derivaciones recientes:\n${f.handoffs.map(h => `- ${when(h.at)} ${agentChatName(h.fromAgentId)} → ${h.toAgentIds.map(agentChatName).join(", ")}: "${h.text.slice(0, 60)}" (\`${h.orderId}\`, ${h.status})`).join("\n")}`;
}
/** The whole verified context of one agent: the deterministic replies and the model prompt both use it. */
export function factsText(f: Facts) {
  return [`Agente: ${f.profile.name} (${AGENT_CHAT_GROUP_LABELS[f.profile.group]}). Función: ${f.profile.job}`, statusLine(f), careerLine(f), ordersBlock(f), lastWorkBlock(f), handoffBlock(f)].filter(Boolean).join("\n");
}

export function deterministicAnswer(route: AgentChatRoute, f: Facts) {
  switch (route.intent) {
    case "help": return `Soy **${f.profile.name}**. ${f.profile.job}\n\nPuedes pedirme: \`estado\`, \`órdenes\`, \`último trabajo\`, \`derivaciones\`, o preguntarme por mi trabajo. Respondo solo con mis datos registrados; si algo es de otro agente, te digo cuál y te paso a su chat. No publico, despliego ni contacto a nadie sin tu aprobación.`;
    case "status": return [statusLine(f), f.extra[0], ordersBlock(f)].filter(Boolean).join("\n\n");
    case "orders": return ordersBlock(f);
    case "last_work": return lastWorkBlock(f);
    case "handoffs": return handoffBlock(f);
    default: return `${statusLine(f)}\n\n${ordersBlock(f)}`;
  }
}

function modelPrompt(f: Facts, facts: string, question: string, history: AgentChatMessage[]) {
  const recent = history.slice(-6).map(m => `${m.role === "user" ? "Robert" : f.profile.name}: ${m.text.slice(0, 300)}`).join("\n");
  return `Eres ${f.profile.name}, un agente de la oficina BlackOps de Robert. Responde en el idioma de Robert, en markdown, máximo 120 palabras.
Usa SOLO los datos registrados de abajo. Si la respuesta no está en los datos, responde exactamente "${NO_DATA}" y nada más.
No inventes actividad, resultados, fechas, nombres ni cifras: cada número de tu respuesta debe aparecer en los datos.
No prometas publicar, desplegar, pagar ni contactar a nadie: eso requiere aprobación de Robert.

DATOS REGISTRADOS:
${facts}

CONVERSACIÓN RECIENTE:
${recent}

PREGUNTA: ${question.slice(0, 800)}`;
}

const NUMBER_WORDS: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90, cien: 100, ciento: 100, cientos: 100, mil: 1000, miles: 1000, millon: 1_000_000, millones: 1_000_000,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, hundreds: 100, thousand: 1000, thousands: 1000, million: 1_000_000, millions: 1_000_000,
};
const plainWords = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z]+/).filter(Boolean);

/**
 * Figures in a model answer that the agent's verified facts do not contain: digit runs (dates count by
 * their parts) and Spanish/English number words ("dos".."cien", "two".."hundred", "mil", "million").
 * `facts` must be the agent's data only — never the prompt template, the question or the history, or an
 * echoed figure from Robert's own question would pass as verified. List markers ("1. ") are not figures.
 * Limit: "uno/una/one" are not checked (they are articles too); compound words beyond the list are not parsed.
 */
export function unsupportedNumbers(answer: string, facts: string) {
  const body = answer.replace(/^\s*\d+[.)]\s+/gm, "");
  const known = new Set(facts.match(/\d+/g) || []);
  const factWords = new Set(plainWords(facts));
  const digits = [...new Set(body.match(/\d+/g) || [])].filter(n => !known.has(n) && !known.has(String(Number(n))));
  const words = [...new Set(plainWords(body).filter(word => Object.hasOwn(NUMBER_WORDS, word)))]
    .filter(word => !factWords.has(word) && !known.has(String(NUMBER_WORDS[word])));
  return [...digits, ...words];
}

export function createAgentChatService(deps: {
  store: AgentThreadStore; council: Council; now?: () => number; model?: AgentChatModel; env?: NodeJS.ProcessEnv;
}) {
  const now = deps.now || Date.now;
  const done = new Map<string, unknown>();
  const inflight = new Map<string, Promise<unknown>>();
  const remember = (key: string, value: unknown) => { done.set(key, value); if (done.size > 500) done.delete(done.keys().next().value!); };

  async function answerOwnQuestion(f: Facts, text: string, history: AgentChatMessage[], requestId: string) {
    const recorded = `Lo que sí está registrado:\n\n${statusLine(f)}${f.extra.length ? `\n\n${f.extra.join("\n")}` : ""}\n\n${ordersBlock(f)}`;
    if (!deps.model) return { text: `${NO_DATA} No tengo una regla para responder eso y el modelo de IA está apagado para este chat (costo $0). ${recorded}`, model: "off" as const, noData: true };
    try {
      // The verified facts are computed once: the prompt injects them and the guard checks against them only.
      const facts = factsText(f).slice(0, 3000);
      const prompt = modelPrompt(f, facts, text, history);
      const answer = (await deps.model.ask(prompt, requestId)).trim();
      if (!answer) throw new AgentChatModelError("unavailable");
      // Grounding guard: a figure the injected data does not contain is a fabrication, never shown.
      const invented = unsupportedNumbers(answer, facts);
      if (invented.length) return { text: `${NO_DATA} La respuesta del modelo traía cifras que no están en mis datos, así que la descarté. ${recorded}`, model: "unverified" as const, noData: true };
      return { text: answer.slice(0, 4000), model: "used" as const, noData: /no tengo (ese|este|el) dato|no est[aá] en (mis|los) datos/i.test(answer) };
    } catch (error) {
      const code = error instanceof AgentChatModelError ? error.code : "unavailable";
      const why = code === "budget_exhausted" ? "el presupuesto mensual de tokens de la oficina está agotado"
        : code === "disabled" ? "el modelo de IA está apagado para este chat (costo $0)" : "el modelo no respondió de forma verificable";
      return { text: `${NO_DATA} No uso IA para esto: ${why}. ${recorded}`, model: code, noData: true };
    }
  }

  async function notifyTarget(order: CompanyOrder, fromAgentId: string, toAgentId: string, reason: string, state: CouncilState, entries: readonly AgentChatEntry[]) {
    const inbox = await deps.store.inboxThread(toAgentId);
    // A retried send reuses its order; never deliver the same hand-off twice.
    if ((await deps.store.listMessages(inbox.id)).some(m => m.role === "peer" && m.text.includes(`\`${order.id}\``))) return [];
    const name = (id: string) => findAgentChatEntry(entries, id)?.name || agentChatName(id);
    const peer = await deps.store.append(inbox.id, { role: "peer", agentId: toAgentId, fromAgentId,
      text: `**${name(fromAgentId)}** me pasó: "${order.text}"\n\nMotivo: ${reason}\nOrden: \`${order.id}\`${order.chat?.approvalRequired ? "\n\n⚠ Acción externa: requiere aprobación de Robert." : ""}` });
    const f = agentFacts(state, toAgentId, now(), deps.env, entries);
    const assignee = order.assignees.find(a => a.agentId === toAgentId);
    const ack = await deps.store.append(inbox.id, { role: "agent", agentId: toAgentId,
      text: `Recibida de ${name(fromAgentId)}. ${assignee?.status === "en_curso" ? "La tengo en curso" : "Queda bloqueada"}: ${assignee?.note || ""}\n\n${statusLine(f)}` });
    return [peer, ack];
  }

  async function send(agentIdRaw: unknown, body: unknown) {
    const input = validateAgentChatInput(agentIdRaw, body);
    const key = `${input.agentId}:${input.requestId}`;
    if (done.has(key)) return done.get(key) as Awaited<ReturnType<typeof sendOnce>>;
    // Registered before the first await: a concurrent duplicate joins the same work.
    const running = inflight.get(key);
    if (running) return running as ReturnType<typeof sendOnce>;
    const work = sendOnce(input);
    inflight.set(key, work);
    try {
      const result = await work;
      remember(key, result);
      return result;
    } finally { inflight.delete(key); }
  }

  async function sendOnce(raw: ReturnType<typeof validateAgentChatInput>) {
    const state = await deps.council.load();
    const entries = buildAgentChatDirectory(state);
    const self = findAgentChatEntry(entries, raw.agentId);
    if (!self) throw new AgentChatInputError("Agente no válido.");
    const input = { ...raw, agentId: self.id };
    const entryName = (id: string) => findAgentChatEntry(entries, id)?.name || agentChatName(id);
    const handoffTo = (agentId: string, reason: string): AgentChatHandoff => ({ agentId, name: entryName(agentId), reason: reason.slice(0, 200) });
    let thread = input.threadId ? await deps.store.getThread(input.threadId) : null;
    if (input.threadId && (!thread || thread.agentId !== input.agentId)) throw new AgentChatNotFound("Conversación no encontrada.");
    // A retry of a first message reuses the thread it already opened.
    if (!thread) thread = (await deps.store.listThreads(input.agentId)).find(t => t.requestId === input.requestId)
      || await deps.store.createThread(input.agentId, input.text.replace(/\s+/g, " ").slice(0, 60), input.requestId);
    const all = await deps.store.listMessages(thread.id);
    const prior = all.filter(m => m.requestId === input.requestId);
    const available = entries.map(entry => entry.id);
    const cityNames = directoryCityNames(entries);
    const route = routeAgentMessage(input.agentId, input.text, available, { profiles: entries, cityNames });
    if (prior.some(m => m.role !== "user")) {
      // Already answered (e.g. by another process): return the stored result, write nothing.
      const existing = state.company.orders.find(o => o.chat?.requestId === `${input.agentId}:${input.requestId}`);
      const stored = prior.find(m => m.handoffTo);
      return { thread, messages: prior, peerMessages: [] as AgentChatMessage[], route, order: existing ? { id: existing.id, assignees: existing.assignees, chat: existing.chat } : null, model: "none",
        handoff: stored?.handoffTo ? handoffTo(stored.handoffTo, route.reason) : null };
    }
    const history = all.filter(m => m.requestId !== input.requestId);
    const user = prior.find(m => m.role === "user") || await deps.store.append(thread.id, { role: "user", agentId: input.agentId, text: input.text, requestId: input.requestId });
    const facts = agentFacts(state, input.agentId, now(), deps.env, entries);
    const out: AgentChatMessage[] = [user];
    const peers: AgentChatMessage[] = [];
    let order: CompanyOrder | undefined;
    let model: string = "none";
    let handoff: AgentChatHandoff | null = null;
    const reply = async (role: "agent" | "handoff", text: string) => {
      out.push(await deps.store.append(thread!.id, { role, agentId: input.agentId, ...(role === "handoff" ? { fromAgentId: input.agentId } : {}), text, requestId: input.requestId, ...(handoff ? { handoffTo: handoff.agentId } : {}) }));
    };
    const other = route.targetAgentId !== input.agentId;
    if (route.decision === "answer") {
      if (route.intent === "question" && other) {
        // Another agent owns this topic: no model call, no guess. Point to the owner.
        handoff = handoffTo(route.targetAgentId, route.reason);
        await reply("agent", `${NO_DATA} ${route.reason}\n\nHabla con **${handoff.name}**: responde con sus propios datos.`);
      } else if (route.intent === "question") {
        const answer = await answerOwnQuestion(facts, input.text, history, input.requestId);
        model = answer.model;
        // Only when this agent does not own the topic at all: its own missing data is not someone else's.
        const ranked = answer.noData ? scoreAgents(input.text, available, cityNames) : [];
        const alternative = ranked.some(entry => entry.agentId === input.agentId) ? undefined : ranked[0];
        if (alternative) handoff = handoffTo(alternative.agentId, `Puede tenerlo ${entryName(alternative.agentId)} (${alternative.words.join(", ")}).`);
        await reply("agent", `${answer.text}${handoff ? `\n\n${handoff.reason}` : ""}`);
      } else if (other) {
        // Status of another agent ("dime qué está haciendo Legal"): that agent's recorded state, no order.
        handoff = handoffTo(route.targetAgentId, "Para hablar con él directamente.");
        await reply("agent", `Según el registro de **${handoff.name}**:\n\n${deterministicAnswer(route, agentFacts(state, route.targetAgentId, now(), deps.env, entries))}`);
      } else {
        await reply("agent", deterministicAnswer(route, facts));
      }
    } else {
      const target = findAgentChatEntry(entries, route.targetAgentId) || self;
      const approval = route.approvalRequired ? "\n\n⚠ **Requiere tu aprobación**: es una acción externa (publicar, desplegar, pagar, contactar o gastar). La oficina es solo de revisión y no la ejecuta." : "";
      if (!target.orderable) {
        // KONG workers and trainees run outside this office: no order is recorded for them here.
        const why = target.group === "academy" ? "es un aprendiz de la academia; todavía no recibe trabajo real" : "es un puesto de KONG que trabaja fuera de esta oficina; desde aquí no se le registran órdenes";
        if (route.decision === "handoff") {
          handoff = handoffTo(target.id, route.reason);
          await reply("handoff", `${route.reason}\n\n**${target.name}** ${why}. Abre su chat para ver su registro.${approval}`);
        } else {
          await reply("agent", `No registro esto como orden: ${why}. Lo que sí está registrado:\n\n${statusLine(facts)}${facts.extra.length ? `\n\n${facts.extra.join("\n")}` : ""}${approval}`);
        }
      } else {
        order = await deps.council.placeChatOrder({ text: input.text, fromAgentId: input.agentId, toAgentId: target.id, reason: route.reason, approvalRequired: route.approvalRequired, requestId: `${input.agentId}:${input.requestId}` });
        if (route.decision === "handoff") {
          handoff = handoffTo(target.id, route.reason);
          // Deliver to the target first: the sender's reply is the "done" marker a retry checks for.
          peers.push(...await notifyTarget(order, input.agentId, target.id, route.reason, state, entries));
          await reply("handoff", `${route.reason}\n\nDerivé la tarea a **${target.name}** → orden \`${order.id}\`. Puedes seguirla en su chat (Derivaciones recibidas) o en el consejo.${approval}`);
        } else {
          const assignee = order.assignees.find(a => a.agentId === input.agentId);
          await reply("agent", `${route.reason} Anotada como orden \`${order.id}\` (${assignee?.status === "en_curso" ? "en curso" : "bloqueada"}).\n\n${assignee?.note || ""}${approval}`);
        }
      }
    }
    return { thread, messages: out, peerMessages: peers, route, order: order ? { id: order.id, assignees: order.assignees, chat: order.chat } : null, model, handoff };
  }

  async function agents() {
    const state = await deps.council.load();
    const entries = buildAgentChatDirectory(state);
    return entries.map(entry => {
      const f = agentFacts(state, entry.id, now(), deps.env, entries);
      return { id: entry.id, name: entry.name, job: entry.job, group: entry.group, groupLabel: AGENT_CHAT_GROUP_LABELS[entry.group], legacyIds: entry.legacyIds || [],
        status: f.status || null, fresh: f.fresh, mode: f.integration.mode, openOrders: f.openOrders.length };
    });
  }

  async function knownAgent(agentId: unknown) {
    if (!isAgentChatIdShape(agentId)) throw new AgentChatInputError("Agente no válido.");
    const entry = findAgentChatEntry(buildAgentChatDirectory(await deps.council.load()), agentId);
    if (!entry) throw new AgentChatInputError("Agente no válido.");
    return entry.id;
  }
  async function threads(agentId: unknown) {
    return deps.store.listThreads(await knownAgent(agentId));
  }
  async function createThread(agentId: unknown, title?: unknown) {
    const id = await knownAgent(agentId);
    const clean = typeof title === "string" && title.trim() ? title.trim().slice(0, 60) : "Nueva conversación";
    return deps.store.createThread(id, clean);
  }
  async function thread(agentId: unknown, threadId: unknown) {
    if (!isAgentChatIdShape(agentId) || typeof threadId !== "string") throw new AgentChatInputError("Conversación no válida.");
    const found = await deps.store.getThread(threadId);
    if (!found || found.agentId !== agentId) throw new AgentChatNotFound("Conversación no encontrada.");
    return { thread: found, messages: await deps.store.listMessages(found.id) };
  }
  async function handoffs() { return handoffLog((await deps.council.load()).company); }

  return { send, agents, threads, createThread, thread, handoffs, inboxTitle: INBOX_TITLE };
}

// ---- Persistence over the existing chat tables (conversations/messages), owner-scoped titles. ----
type ChatStorageLike = {
  getConversation(id: number, userId?: string): Promise<{ id: number; title: string; createdAt: Date | string } | undefined>;
  getConversationByTitle(title: string, userId?: string): Promise<{ id: number; title: string; createdAt: Date | string } | undefined>;
  getAllConversations(userId?: string): Promise<Array<{ id: number; title: string; createdAt: Date | string }>>;
  createConversation(title: string, userId?: string): Promise<{ id: number; title: string; createdAt: Date | string }>;
  getMessagesByConversation(conversationId: number): Promise<Array<{ id: number; conversationId: number; role: string; content: string; createdAt: Date | string }>>;
  createMessage(conversationId: number, role: string, content: string): Promise<{ id: number; conversationId: number; role: string; content: string; createdAt: Date | string }>;
};
const PREFIX = "agent-chat|";
const OWNER_PREFIX = /^\[owner:[^\]]+\]\s*/;

/** Threads are rows of the existing `conversations` table titled "agent-chat|<agentId>|<title>", scoped to the owner. */
export function createChatStorageThreadStore(storage: ChatStorageLike, userId: string): AgentThreadStore {
  if (!userId) throw new Error("Owner required");
  const toThread = (row: { id: number; title: string; createdAt: Date | string }): AgentThread | null => {
    const title = row.title.replace(OWNER_PREFIX, "");
    if (!title.startsWith(PREFIX)) return null;
    const [agentId, ...rest] = title.slice(PREFIX.length).split("|");
    if (!isAgentChatIdShape(agentId)) return null;
    const requestId = rest.length > 1 && rest[rest.length - 1].startsWith("rid:") ? rest.pop()!.slice(4) : undefined;
    const name = rest.join("|");
    return { id: String(row.id), agentId, title: name, createdAt: new Date(row.createdAt).toISOString(), inbox: name === INBOX_TITLE, ...(requestId ? { requestId } : {}) };
  };
  // Role column: "user", "assistant", "peer:<from>", "handoff:<from>", optionally ">"<target> (the agent the reply
  // points Robert to) and "#<requestId>" for idempotent retries. Agent ids are URI-encoded (they may hold ":", "+", "#").
  const encodeRole = (m: { role: AgentChatRole; fromAgentId?: string; requestId?: string; handoffTo?: string }) =>
    `${m.role === "peer" || m.role === "handoff" ? `${m.role}:${encodeURIComponent(m.fromAgentId || "")}` : m.role === "agent" ? "assistant" : "user"}${m.handoffTo ? `>${encodeURIComponent(m.handoffTo)}` : ""}${m.requestId && /^[a-zA-Z0-9_-]{8,80}$/.test(m.requestId) ? `#${m.requestId}` : ""}`;
  const decodeId = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
  const decode = (threadId: string, agentId: string, row: { id: number; role: string; content: string; createdAt: Date | string }): AgentChatMessage => {
    const hash = row.role.indexOf("#");
    const [withTarget, requestId] = hash < 0 ? [row.role, undefined] : [row.role.slice(0, hash), row.role.slice(hash + 1)];
    const [head, target] = withTarget.split(">");
    const colon = head.indexOf(":");
    const kind = colon < 0 ? head : head.slice(0, colon);
    const from = colon < 0 ? "" : decodeId(head.slice(colon + 1));
    const role: AgentChatRole = kind === "assistant" ? "agent" : kind === "peer" || kind === "handoff" ? kind : "user";
    return { id: String(row.id), threadId, role, agentId, ...(from ? { fromAgentId: from } : {}), text: row.content, at: new Date(row.createdAt).toISOString(), ...(requestId ? { requestId } : {}), ...(target ? { handoffTo: decodeId(target) } : {}) };
  };
  const inboxLocks = new Map<string, Promise<AgentThread>>();
  const get = async (threadId: string) => {
    if (!/^\d{1,12}$/.test(threadId)) return null;
    const row = await storage.getConversation(Number(threadId), userId);
    return row ? toThread(row) : null;
  };
  return {
    async listThreads(agentId) {
      const rows = await storage.getAllConversations(userId);
      return rows.map(toThread).filter((t): t is AgentThread => !!t && t.agentId === agentId)
        .sort((a, b) => Number(b.inbox) - Number(a.inbox) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
    async createThread(agentId, title, requestId) {
      const clean = title.replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, 60) || "Nueva conversación";
      const rid = requestId && /^[a-zA-Z0-9_-]{8,80}$/.test(requestId) ? `|rid:${requestId}` : "";
      return toThread(await storage.createConversation(`${PREFIX}${agentId}|${clean === INBOX_TITLE ? `${clean} (chat)` : clean}${rid}`, userId))!;
    },
    inboxThread(agentId) {
      // Serialized per agent so concurrent hand-offs never create two inbox threads.
      const previous = inboxLocks.get(agentId) || Promise.resolve(null as unknown as AgentThread);
      const next = previous.catch(() => null).then(async () => {
        const title = `${PREFIX}${agentId}|${INBOX_TITLE}`;
        const row = await storage.getConversationByTitle(title, userId) || await storage.createConversation(title, userId);
        return toThread(row)!;
      });
      inboxLocks.set(agentId, next);
      return next;
    },
    getThread: get,
    async listMessages(threadId) {
      const thread = await get(threadId);
      if (!thread) return [];
      return (await storage.getMessagesByConversation(Number(threadId))).map(row => decode(threadId, thread.agentId, row));
    },
    async append(threadId, message) {
      const thread = await get(threadId);
      if (!thread) throw new AgentChatNotFound("Conversación no encontrada.");
      return decode(threadId, thread.agentId, await storage.createMessage(Number(threadId), encodeRole(message), message.text.slice(0, 8000)));
    },
  };
}
