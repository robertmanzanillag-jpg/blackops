// Per-agent chat: deterministic intent + routing rules ($0, no AI, no IO).
//
// Every message Robert writes to one agent is classified here first. A task that belongs to
// another department is handed off (recorded as a normal agent-company order with a `chat`
// annotation, so the council shows who passed what to whom). Questions about the agent's own
// state are answered from recorded data by the server. Only an open question that no rule can
// answer may reach the model, and only when the shared office token budget allows it.
//
// Nothing here executes work: an order is a record. External actions (publish, deploy, merge,
// pay, contact people, spend) are flagged as approval-required and are never dispatched.

import { ROUTES, createOrder, type CompanyState } from "./agent-company";

export type AgentChatProfile = { id: string; name: string; job: string; aliases: string[] };

// Main-company agents Robert can chat with. KONG workers keep their own owner-only supervisor chat.
export const AGENT_CHAT_PROFILES: AgentChatProfile[] = [
  { id: "ceo", name: "CEO", job: "Recibe órdenes generales y las reparte al departamento correcto.", aliases: ["ceo", "jefe"] },
  { id: "assistant", name: "Asistente", job: "Agenda, recordatorios, reuniones y tareas personales.", aliases: ["asistente", "assistant"] },
  { id: "code", name: "Code", job: "Cambios de código PR-first en los repos registrados.", aliases: ["code", "codigo", "programador"] },
  { id: "github", name: "GitHub", job: "Repos, PRs, issues y revisión de estado en GitHub.", aliases: ["github", "git"] },
  { id: "claude-reviewer", name: "Claude Reviewer", job: "Revisión independiente de PRs antes de App QA.", aliases: ["claude reviewer", "reviewer", "revisor"] },
  { id: "app-qa", name: "App QA", job: "Gate de calidad: rutas, clicks, APIs y errores de las apps.", aliases: ["app qa", "app-qa", "qa"] },
  { id: "mechanic", name: "Mecanico", job: "Revisa a los demás agentes en el consejo y detecta los caídos.", aliases: ["mecanico", "mechanic"] },
  { id: "agent-factory", name: "Fabrica de agentes", job: "Propone y prepara agentes nuevos.", aliases: ["fabrica de agentes", "agent factory", "agent-factory"] },
  { id: "cybersecurity", name: "Cybersecurity", job: "Seguridad, accesos y amenazas.", aliases: ["cybersecurity", "ciberseguridad", "seguridad", "security"] },
  { id: "legal", name: "Legal / Compliance", job: "Contratos, términos, privacidad y copyright.", aliases: ["legal", "compliance", "abogado", "lawyer"] },
  { id: "control", name: "Control / Permisos", job: "Permisos, aprobaciones y acciones pendientes.", aliases: ["control", "permisos", "permissions"] },
  { id: "revenue", name: "Revenue", job: "Ventas, clientes, cobros y pipeline.", aliases: ["revenue", "ventas", "sales"] },
  { id: "marketing-cmo", name: "Marketing CMO", job: "Campañas, anuncios, redes y Metricool.", aliases: ["marketing", "cmo", "marketing cmo"] },
  { id: "dropshipping", name: "Dropshipping CEO", job: "Tienda, productos y Shopify.", aliases: ["dropshipping", "tienda", "shopify", "store"] },
  { id: "portfolio", name: "Portfolio", job: "Inversiones, acciones y crypto (solo lectura).", aliases: ["portfolio", "portafolio", "inversiones"] },
  { id: "automations", name: "Autos", job: "Automatizaciones programadas y sus ejecuciones.", aliases: ["autos", "automations", "automatizaciones"] },
  { id: "clippers", name: "Clippers", job: "Clips y reels a partir de videos largos.", aliases: ["clippers", "clipper", "clips"] },
  { id: "blackroom-videos", name: "Videos Black Room", job: "Supervisa los videos de Black Room.", aliases: ["videos black room", "blackroom videos", "black room videos"] },
  { id: "kong-videos", name: "Videos Kong", job: "Videos de Kong (publicador externo en Codex).", aliases: ["videos kong", "kong videos"] },
  { id: "radio", name: "Radio", job: "Horarios de radio y sets de DJ.", aliases: ["radio"] },
  { id: "news", name: "Noticias", job: "Noticias y artículos del sitio.", aliases: ["noticias", "news"] },
  { id: "news:miami-news", name: "Noticias Miami", job: "Noticias locales de Miami.", aliases: ["noticias miami", "miami news"] },
  { id: "news:ny-news", name: "Noticias Nueva York", job: "Noticias locales de Nueva York.", aliases: ["noticias nueva york", "noticias ny", "ny news", "new york news"] },
  { id: "skills-scout", name: "Skills Scout", job: "Vigila releases y propone mejoras de skills.", aliases: ["skills scout", "scout"] },
];
export const AGENT_CHAT_IDS = AGENT_CHAT_PROFILES.map(profile => profile.id);
export const isAgentChatId = (id: unknown): id is string => typeof id === "string" && AGENT_CHAT_IDS.includes(id);
export const agentChatName = (id: string) => AGENT_CHAT_PROFILES.find(profile => profile.id === id)?.name || id;

// English (and a few extra Spanish) words for the same departments as the CEO channel's ROUTES.
export const EXTRA_ROUTES: Array<{ words: string[]; agents: string[] }> = [
  { words: ["contract", "privacy", "terms", "lawyer", "compliance", "gdpr"], agents: ["legal"] },
  { words: ["security", "password", "breach", "vulnerab", "phishing"], agents: ["cybersecurity"] },
  { words: ["campaign", "ad ", "ads", "marketing", "social media", "post idea"], agents: ["marketing-cmo"] },
  { words: ["sale", "customer", "payment", "invoice", "revenue", "factura", "pipeline", "pagale", "pagarle", "pagar", "paga ", "pay ", "refund", "reembols"], agents: ["revenue"] },
  { words: ["store", "product", "shopify"], agents: ["dropshipping"] },
  { words: ["stock", "invest", "portfolio", "crypto"], agents: ["portfolio"] },
  { words: ["calendar", "meeting", "reminder", "appointment"], agents: ["assistant"] },
  { words: ["automate", "automation", "every day", "daily", "cron"], agents: ["automations"] },
  { words: ["code", "refactor", "pull request", "merge", "commit", "branch"], agents: ["code", "github"] },
  { words: ["issue"], agents: ["github"] },
  // Clear engineering intent outranks business words ("fix the pay button style" stays with Code).
  { words: ["fix", "button", "boton", "style", "estilo", "css", "refactor", "screen", "layout", "validation", "validacion", "endpoint", "api "], agents: ["code", "app-qa"] },
  { words: ["broken", "not working", "is down", "crash"], agents: ["mechanic", "app-qa"] },
  { words: ["qa", "test"], agents: ["app-qa"] },
  { words: ["new agent", "hire"], agents: ["agent-factory"] },
  { words: ["miami"], agents: ["news:miami-news"] },
  { words: ["nueva york", "new york", "nyc"], agents: ["news:ny-news"] },
  { words: ["revisa el pr", "review the pr", "review pr"], agents: ["claude-reviewer", "github"] },
  // KONG central desks (only routable when the caller passes them as available: the chat directory does).
  { words: ["promoter", "promoters", "promotor", "promotores", "reserva de mesa", "reservas de mesa"], agents: ["kong:Promoters + Mesas"] },
  { words: ["venue", "venues", "importar eventos"], agents: ["kong:Venues"] },
  { words: ["kong ai", "chat de kong", "chat central de kong"], agents: ["kong:KONG AI"] },
  { words: ["kong legal", "legal de kong"], agents: ["kong:Kong Legal"] },
  { words: ["metricas de kong", "metricas kong", "kong metrics", "metricool de kong"], agents: ["kong-metrics"] },
];

/** KONG city desks: `kong-city:<cityId>:<category>`. A city named together with one of these words routes there. */
export const KONG_CITY_CATEGORY_WORDS: Record<string, string[]> = {
  clubs: ["club", "clubs", "clubes", "discoteca", "discotecas", "antro", "antros", "boliche", "nightclub", "nightlife", "vida nocturna"],
  vip: ["vip", "mesa vip", "mesas vip", "botella", "botellas", "bottle service"],
  restaurants: ["restaurante", "restaurantes", "restaurant", "restaurants", "cena", "brunch", "donde comer"],
  events: ["evento", "eventos", "event", "events", "fiesta", "fiestas", "concierto", "conciertos", "party", "parties"],
  sports: ["deporte", "deportes", "partido", "partidos", "sports", "nba", "nfl", "mlb", "futbol", "soccer"],
  experiences: ["experiencia", "experiencias", "experience", "experiences", "tour", "tours", "yate", "yacht"],
  media: ["foto", "fotos", "flyer", "flyers", "imagen", "imagenes", "photo", "photos"],
};
const CITY_AGENT = /^kong-city:([^:]+):([a-z]+)$/;
export function parseKongCityAgentId(id: string): { cityId: string; category: string } | null {
  const match = CITY_AGENT.exec(id);
  return match && Object.hasOwn(KONG_CITY_CATEGORY_WORDS, match[2]) ? { cityId: match[1], category: match[2] } : null;
}
const cityPhrase = (cityId: string) => normalizeChatText(cityId.replace(/[-_]+/g, " "));

// Actions that leave the office. They are recorded, flagged, and wait for Robert's approval.
// Recipients that make "email / call / pay / llamar" an outreach action rather than a technical noun.
const WHO = "(the |a |an |our |my |el |la |al |a la |a los |a las )?(venue|owner|duen[oa]|client|cliente|customer|promoter|promotor|dj|artist|artista|supplier|proveedor|vendor|lawyer|abogado|bank|banco|manager|gerente|team|equipo|investor|inversionista|staff|him|her|them|\\$|\\d)";
const APPROVAL_PATTERNS = [
  /\bpublic(a|ar|alo|ala|ad)\b/, /\bpublish/, /\bpost(ea|ear)\b/, /\bdeploy/, /\bdespl(ie|e)g/, /\bmerge(a|ar)?\b/,
  /\bproduccion\b/, /\bproduction\b/, /\benvi(a|ar)\w* (un |el |un )?(email|correo|mensaje|dm)/, /\bsend (an |the )?(email|message|dm)/,
  /\bcontact(a|ar|e)?\b/, new RegExp(`\\bpay ${WHO}`), /\btransfer/, /\bcompr(a|ar)\b/, /\bbuy\b/, /\bgast(a|ar)\b/, /\bspend\b/,
  /\blanz(a|ar) (la |una )?(campana|anuncio)/, /\blaunch\b/, /\bborr(a|ar)\b/, /\bdelete\b/, /\belimin(a|ar)\b/,
  /\b(manda|envia)\w* (un |una |el |la )?(email|correo|mensaje|dm|whatsapp|sms)/, /\bsub(e|ir|elo|ela|irlo)\b.*\b(tiktok|instagram|youtube|reel|facebook)/,
  /\b(upload|post)\b.*\b(tiktok|instagram|youtube|facebook)/, new RegExp(`\\bemail ${WHO}`), /\bwhatsapp\b/, /\bpag(a|ar|ale|arle|ales|arles|ue)\b/,
  /\b(reembols|refund)/, /\bescr[ií]bele\b/, /\bescribe(le|les)? (a|al)\b/, /(?<!se )\bllam(a|ar)\s+(a|al)\b/, /\bllam(ale|arle|ales|arles)\b/, new RegExp(`\\bcall ${WHO}`), /\btext (him|her|them)\b/,
];

export type AgentChatIntent = "help" | "status" | "orders" | "last_work" | "handoffs" | "task" | "question";
export type AgentChatRoute = {
  intent: AgentChatIntent;
  /** keep: the receiving agent owns it. handoff: another agent does. answer: reply from recorded state. */
  decision: "answer" | "keep" | "handoff";
  targetAgentId: string;
  explicit: boolean;
  matchedWords: string[];
  approvalRequired: boolean;
  reason: string;
};

export function normalizeChatText(text: string) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿¡]/g, "").replace(/\s+/g, " ").trim();
}

const wordMatches = (normalized: string, word: string) => {
  if (word.endsWith(" ")) return ` ${normalized} `.includes(word);
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}`).test(normalized);
};

/** Agents whose job matches the text, best first (number of matched route words, then table order). */
export function scoreAgents(text: string, available: readonly string[] = AGENT_CHAT_IDS, cityNames: Record<string, string> = {}) {
  const normalized = normalizeChatText(text);
  const scores = new Map<string, { score: number; order: number; words: string[] }>();
  let order = 0;
  for (const route of [...ROUTES, ...EXTRA_ROUTES]) {
    // Context-gated routes (e.g. Black Room specialists) only fire when the text names that context.
    const requires = (route as { requires?: string[] }).requires;
    if (requires && !requires.some(word => normalized.includes(word))) continue;
    const words = route.words.filter(word => wordMatches(normalized, word));
    if (!words.length) continue;
    route.agents.forEach((agent, index) => {
      if (!available.includes(agent)) return;
      const current = scores.get(agent) || { score: 0, order: order + index / 10, words: [] };
      // The first agent of a route is its owner; later agents are helpers.
      // Longer, more specific words ("contrato") count more than short ambiguous ones ("dj", "app").
      current.score += words.reduce((sum, word) => sum + (word.trim().length >= 5 ? 2 : 1), 0) * (index === 0 ? 2 : 1);
      current.words = [...new Set([...current.words, ...words.map(w => w.trim())])];
      scores.set(agent, current);
    });
    order++;
  }
  // A KONG city desk owns "<category> en <city>" ("eventos en Miami" -> kong-city:miami:events): it outranks
  // the generic city news desk and any department that only matched a single word.
  const padded = ` ${normalized.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
  for (const agentId of available) {
    const city = parseKongCityAgentId(agentId);
    if (!city) continue;
    const names = [cityPhrase(city.cityId), ...(cityNames[city.cityId] ? [normalizeChatText(cityNames[city.cityId]).replace(/[^a-z0-9 ]/g, " ")] : [])];
    if (!names.some(name => name && padded.includes(` ${name} `))) continue;
    const words = KONG_CITY_CATEGORY_WORDS[city.category].filter(word => padded.includes(` ${word} `));
    if (!words.length) continue;
    scores.set(agentId, { score: 20 + words.length, order: -1, words: [...names.slice(0, 1), ...words] });
  }
  // A city news desk outranks the generic news desk when its city is named.
  for (const city of ["news:miami-news", "news:ny-news"]) if (scores.has(city) && scores.has("news")) scores.get(city)!.score += 3;
  return [...scores.entries()].sort((a, b) => b[1].score - a[1].score || a[1].order - b[1].order).map(([agentId, value]) => ({ agentId, ...value }));
}

/** "@legal ...", "pásaselo a GitHub", "hand this off to revenue", "pregúntale a Code". */
export function explicitTarget(text: string, profiles: readonly AgentChatProfile[] = AGENT_CHAT_PROFILES): string | null {
  const normalized = normalizeChatText(text);
  const mention = /(?:^|\s)@([a-z0-9:_-]+)/.exec(normalized);
  const verb = /(?:pasa(?:selo|sela|le|lo|la)?|deriva(?:lo|la|le)?|envia(?:selo|sela|le)?|manda(?:selo|sela|le)?|pregunta(?:le)?|dile|hand(?: this| it)? off|forward(?: this| it)?|send(?: this| it)?|ask|tell|pide(?:le)?|delegate(?: this| it)?)\s+(?:esto\s+|this\s+|it\s+)?(?:(?:a|al|to|with)\s+)?(?:la\s+|el\s+|the\s+)?(.+)$/.exec(normalized);
  const candidate = mention?.[1] || verb?.[1];
  if (!candidate) return null;
  const byId = profiles.find(profile => normalizeChatText(profile.id) === candidate);
  if (byId) return byId.id;
  // Longest alias first so "videos kong" wins over "kong".
  const aliases = profiles.flatMap(profile => [profile.name.toLowerCase(), ...profile.aliases].map(alias => ({ id: profile.id, alias: normalizeChatText(alias) })))
    .sort((a, b) => b.alias.length - a.alias.length);
  return aliases.find(({ alias }) => candidate === alias || candidate.startsWith(`${alias} `) || candidate.startsWith(`${alias},`) || candidate.startsWith(`${alias}:`))?.id || null;
}

/** An agent named anywhere in the text (longest alias wins), other than the one being talked to. */
export function mentionedAgent(text: string, except?: string, profiles: readonly AgentChatProfile[] = AGENT_CHAT_PROFILES): string | null {
  const normalized = ` ${normalizeChatText(text).replace(/[^a-z0-9: ]/g, " ")} `;
  const aliases = profiles.filter(p => p.id !== except).flatMap(profile => [profile.name, ...profile.aliases].map(alias => ({ id: profile.id, alias: normalizeChatText(alias).replace(/[^a-z0-9: ]/g, " ") })))
    .sort((a, b) => b.alias.length - a.alias.length);
  return aliases.find(({ alias }) => alias.length > 2 && normalized.includes(` ${alias} `))?.id || null;
}

export function classifyIntent(text: string, profiles: readonly AgentChatProfile[] = AGENT_CHAT_PROFILES): AgentChatIntent {
  const t = normalizeChatText(text).replace(/[.!?]+$/g, "").trim();
  if (/^(ayuda|help|hola|hi|hello|hey|buenas|que puedes hacer|what can you do|capacidades)$/.test(t)) return "help";
  if (/^(estado|status|tu estado|your status|como estas|how are you|que estas haciendo|que haces|what are you doing|en que (estas )?trabaj\w*|estas trabajando|are you working|what are you working on)$/.test(t)) return "status";
  if (/^(tell me|dime|cuentame)\b/.test(t) || /\b(que|what) (esta|is) \S+( \S+)? (haciendo|doing)\b|\bwhat is \S+( \S+)? (doing|working on)\b|\b(estado|status) (de|of)\b|\bque (esta|estan) haciendo \S+/.test(t)) return "status";
  if (/^(mis |tus |your |my )?(ordenes|tareas|pendientes|orders|tasks|backlog)( pendientes| abiertas| open)?$/.test(t) || /^que (ordenes|tareas) tienes/.test(t)) return "orders";
  if (/^(ultimo|ultima|last)\b|que hiciste|what did you (do|finish)|ultimo (trabajo|reporte|resultado)|last (run|report|work)|^(reporte|report|resultado)$/.test(t)) return "last_work";
  if (/^(derivaciones|handoffs|hand-offs|mensajes de (otros )?agentes|quien te (escribio|derivo)|who (sent|handed))/.test(t)) return "handoffs";
  const question = /\?$/.test(normalizeChatText(text)) || /^(que|como|por que|porque|cual|cuales|cuando|donde|quien|why|what|how|when|where|who|which|is|are|do|does|can you explain|explica)\b/.test(t);
  const imperative = /^(haz|hazme|crea|crear|revisa|revisar|arregla|repara|prepara|redacta|escribe|sube|publica|analiza|busca|investiga|programa|agenda|manda|envia|pasa|deriva|lanza|actualiza|genera|necesito|quiero|please|pls|fix|create|make|review|check|prepare|draft|write|build|analy[sz]e|find|research|schedule|send|update|generate|i need|i want|can you|could you|puedes|podrias)\b/.test(t);
  if (imperative || explicitTarget(text, profiles)) return "task";
  return question ? "question" : "task";
}

export type AgentRoutingDirectory = { profiles?: readonly AgentChatProfile[]; cityNames?: Record<string, string> };

export function routeAgentMessage(agentId: string, text: string, available: readonly string[] = AGENT_CHAT_IDS, directory: AgentRoutingDirectory = {}): AgentChatRoute {
  const profiles = directory.profiles || AGENT_CHAT_PROFILES;
  const name = (id: string) => profiles.find(profile => profile.id === id)?.name || agentChatName(id);
  const intent = classifyIntent(text, profiles);
  const normalized = normalizeChatText(text);
  const approvalRequired = APPROVAL_PATTERNS.some(pattern => pattern.test(normalized));
  const base = { intent, explicit: false, matchedWords: [] as string[], approvalRequired };
  if (intent !== "task" && intent !== "question") {
    // "dime qué está haciendo Legal" / "tell me what Legal is doing": answered from Legal's recorded state, no order.
    const other = intent === "status" ? mentionedAgent(text, agentId, profiles) : null;
    return { ...base, approvalRequired: false, decision: "answer", targetAgentId: other && available.includes(other) ? other : agentId, reason: "Consulta sobre el estado registrado." };
  }
  const explicit = explicitTarget(text, profiles);
  if (explicit && explicit !== agentId && available.includes(explicit)) {
    return { ...base, intent: "task", decision: "handoff", targetAgentId: explicit, explicit: true, reason: `Pediste pasárselo a ${name(explicit)}.` };
  }
  const ranked = scoreAgents(text, available, directory.cityNames);
  const mine = ranked.find(entry => entry.agentId === agentId);
  // Another agent clearly owns the topic: this one does not, or shares it far less.
  const owner = ranked[0] && ranked[0].agentId !== agentId && (!mine || mine.score * 2 < ranked[0].score) ? ranked[0] : undefined;
  if (intent === "question") {
    // Questions are answered only from this agent's own data; a foreign topic is pointed to its owner.
    return { ...base, decision: "answer", targetAgentId: owner ? owner.agentId : agentId, matchedWords: (owner || mine)?.words || [],
      reason: owner ? `Ese dato no es de mi área; ${name(owner.agentId)} se encarga de esto (${owner.words.join(", ")}).` : "Pregunta abierta." };
  }
  // The CEO only delegates: any matched department takes the work.
  // An agent keeps work its department shares (e.g. Code on an app bug) unless another owner clearly dominates.
  if (mine && agentId !== "ceo" && mine.score * 2 >= ranked[0].score) {
    return { ...base, decision: "keep", targetAgentId: agentId, matchedWords: mine.words, reason: `Es mi trabajo (${mine.words.join(", ")}).` };
  }
  if (ranked[0] && ranked[0].agentId !== agentId) {
    return { ...base, decision: "handoff", targetAgentId: ranked[0].agentId, matchedWords: ranked[0].words,
      reason: `No es mi trabajo; ${name(ranked[0].agentId)} se encarga de esto (${ranked[0].words.join(", ")}).` };
  }
  if (agentId === "ceo") {
    const fallback = available.includes("assistant") ? "assistant" : agentId;
    return { ...base, decision: fallback === agentId ? "keep" : "handoff", targetAgentId: fallback, reason: "Sin departamento claro; el CEO se lo pasa al Asistente." };
  }
  return { ...base, decision: "keep", targetAgentId: agentId, reason: "Ningún otro departamento coincide; queda anotada conmigo." };
}

/** A company order assigned to exactly one agent, annotated with where it came from. Pure. */
export function createChatOrder(company: CompanyState, input: {
  text: string; now: number; fromAgentId: string; toAgentId: string; reason: string; approvalRequired: boolean; requestId?: string;
  statuses: Record<string, { state: "working" | "available" | "idle" | "error" | "offline" | string; label: string }>;
  names: Record<string, string>;
}) {
  const handoff = input.fromAgentId !== input.toAgentId;
  const { state, order } = createOrder(company, { text: input.text, now: input.now, statuses: input.statuses as never, available: [input.toAgentId], names: input.names });
  const name = (id: string) => input.names[id] || agentChatName(id);
  const iso = new Date(input.now).toISOString();
  const annotated = { ...order, chat: { fromAgentId: input.fromAgentId, handoff, reason: input.reason.slice(0, 200), approvalRequired: input.approvalRequired, ...(input.requestId ? { requestId: input.requestId } : {}) },
    assignees: order.assignees.map(a => input.approvalRequired ? { ...a, note: `${a.note} Acción externa: requiere tu aprobación; la oficina no publica ni despliega.` } : a) };
  const event = handoff
    ? `${name(input.fromAgentId)} derivó a ${name(input.toAgentId)}: "${input.text.slice(0, 60)}" (${annotated.id}).`
    : `Robert le asignó a ${name(input.toAgentId)} desde su chat: "${input.text.slice(0, 60)}" (${annotated.id}).`;
  const careers = { ...state.careers };
  const from = careers[input.fromAgentId];
  if (handoff && from) careers[input.fromAgentId] = { ...from, memory: [{ at: iso, text: `Derivé "${input.text.slice(0, 60)}" a ${name(input.toAgentId)}.` }, ...from.memory].slice(0, 12) };
  return {
    order: annotated,
    state: { ...state, careers, orders: state.orders.map(o => o.id === order.id ? annotated : o), events: [{ at: iso, text: event }, ...state.events.slice(1)] },
  };
}

/** Agent-to-agent log: chat orders that one agent passed to another, newest first. */
export function handoffLog(company: CompanyState, limit = 40) {
  return company.orders.filter(order => order.chat?.handoff).slice(0, limit).map(order => ({
    orderId: order.id, at: order.createdAt, fromAgentId: order.chat!.fromAgentId,
    toAgentIds: order.assignees.map(a => a.agentId), text: order.text, reason: order.chat!.reason,
    approvalRequired: order.chat!.approvalRequired, status: order.doneAt ? "hecha" : order.assignees[0]?.status || "bloqueada",
  }));
}

const CHAT_EVENT = /derivó a |desde su chat|^Derivé "/;
/** Non-owner council view: drop everything the owner-only per-agent chat wrote into the company. */
export function redactChatActivity(company: CompanyState): CompanyState {
  const chatTexts = company.orders.filter(order => order.chat).map(order => order.text.slice(0, 60));
  const fromChat = (text: string) => CHAT_EVENT.test(text) || chatTexts.some(t => t && text.includes(`"${t}`));
  return {
    ...company,
    orders: company.orders.filter(order => !order.chat),
    events: company.events.filter(event => !fromChat(event.text)),
    careers: Object.fromEntries(Object.entries(company.careers).map(([id, career]) => [id, { ...career, memory: (career.memory || []).filter(m => !fromChat(m.text)) }])),
  };
}
