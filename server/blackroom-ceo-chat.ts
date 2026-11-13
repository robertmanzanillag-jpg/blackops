// Chat with the "CEO Black Room" (agent id blackroom-ceo) for Robert (owner) and his partner (socio).
//
// The CEO reads a message, routes it deterministically to the Black Room team (same routing words
// as the office CEO channel, shared/agent-company.ts routeOrder), records one company order per
// task (so it shows in the office), and EXECUTES the task by calling the agent modules directly.
//
// Safety:
// - At most MAX_EXECUTIONS agent calls per message, each with a timeout; no loops, no retries.
// - Nothing outward-facing happens here: the publisher only receives a pending draft ("add"), and
//   the CEO never approves anything. Approve/reject is a separate explicit click (decideApproval).
// - Cheap-first: deterministic routing and replies; the cheap AI helper is only used to classify
//   ambiguous text and to word a one-line intro (compact prompts). The result lines are always
//   the agents' own summaries, so the reply cannot claim work that did not happen.
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { routeOrder } from "@shared/agent-company";
import {
  BLACKROOM_TEAM_BY_ID,
  type BlackRoomLegacyMemberId,
  type BlackRoomTeamActor,
  type BlackRoomTeamAgentId,
  type BlackRoomTeamApproval,
  type BlackRoomTeamRunResult,
  type BlackRoomTeamStatus,
} from "@shared/blackroom-team";
import type { BlackRoomTeamAuditEntry } from "./blackroom-team/audit";
import {
  BLACKROOM_TEAM_MODULES,
  createBlackRoomTeamContext,
  getBlackRoomTeamStatus,
  type BlackRoomTeamContextOptions,
  type BlackRoomTeamModules,
} from "./blackroom-team";
import { BLACKROOM_TEAM_DATA_DIR, readBlackRoomTeamState, writeBlackRoomTeamState } from "./blackroom-team/state";

export const CEO_CHAT_MAX_EXECUTIONS = 3;
export const CEO_CHAT_MAX_MESSAGE_CHARS = 1_000;
export const CEO_CHAT_MAX_STORED_MESSAGES = 200;
export const CEO_CHAT_VIEW_MESSAGES = 60;
export const CEO_CHAT_EXECUTION_TIMEOUT_MS = 45_000;
const ORDER_TIMEOUT_MS = 10_000;
const AI_TIMEOUT_MS = 12_000;
/** Default local time for a post when the message names a day but no hour. */
export const CEO_CHAT_DEFAULT_POST_TIME = "19:00:00";
const BLACKROOM_TIMEZONE = "America/New_York";
const CEO_ID = "blackroom-ceo" as const;
const LEGACY_NAMES: Record<BlackRoomLegacyMemberId, string> = { "blackroom-videos": "Videos Black Room", radio: "Radio" };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CeoChatAuthor = { userId: string; role: "owner" | "partner" | "ceo"; name: string };

export type CeoChatApprovalView = {
  agentId: BlackRoomTeamAgentId;
  id: string;
  title: string;
  summary: string;
  status: BlackRoomTeamApproval["status"];
  createdAt: string;
  publicationDateTime?: string | null;
  networks?: string[];
  dryRun: boolean;
};

export type CeoChatResultCard = {
  agentId: BlackRoomTeamAgentId | BlackRoomLegacyMemberId;
  agentName: string;
  operation: string;
  label: string;
  ok: boolean;
  summary: string;
  details: string[];
  /** The agent could not do it: missing credential/data or an error. */
  blocked: boolean;
  needs: string[];
  timedOut?: boolean;
  approvals: CeoChatApprovalView[];
  orderId?: string | null;
  orderClosed?: boolean;
};

export type CeoChatMessage = {
  id: string;
  at: string;
  author: CeoChatAuthor;
  text: string;
  results?: CeoChatResultCard[];
  orderIds?: string[];
  /** How the CEO understood the message. */
  routedBy?: "reglas" | "ia" | "ninguno" | "conversacion";
};

export type CeoChatState = { version: 1; messages: CeoChatMessage[] };

export type CeoChatIntentKey = "analytics" | "competition" | "scripts" | "website" | "publisher" | "pending" | "status" | "videos" | "radio";

export type CeoChatIntent = {
  key: CeoChatIntentKey;
  agentId: BlackRoomTeamAgentId | BlackRoomLegacyMemberId;
  /** "run", an action name, or "status" for a read of a legacy member. */
  operation: string;
  input: Record<string, unknown>;
  label: string;
  /** Read-only checks are not recorded as company orders. */
  readOnly: boolean;
  /** Set when the CEO cannot call the agent yet (e.g. a post without a video link). */
  missing?: string[];
};

export type CeoChatPlan = {
  intents: CeoChatIntent[];
  /** Extra tasks the message asked for beyond the per-message bound. */
  dropped: CeoChatIntent[];
  /** The message asked the CEO to approve/reject: never done from text. */
  approvalRequested: boolean;
  routedBy: "reglas" | "ia" | "ninguno";
};

/** Cheap AI helper: returns plain text or null (unavailable, disabled, timeout, error). */
export type CeoChatAi = (prompt: string, purpose: "classify" | "reply", userId: string) => Promise<string | null>;

export type CeoChatOrders = {
  /** Records a Black Room company order; returns its id or null when the company store is unavailable. */
  place(text: string, placedBy: BlackRoomTeamActor, assignees?: string[]): Promise<string | null>;
  /** Closes an order by hand (record only; points need verified evidence). */
  finish(orderId: string): Promise<void>;
  /**
   * Owner only: records a request that is not Black Room work as a task for the main office
   * (same as the classic CEO channel). Returns the order id and the names of the assignees.
   */
  placeGeneral?(text: string, placedBy: BlackRoomTeamActor): Promise<{ orderId: string | null; assignees: string[] } | null>;
};

export type CeoChatDeps = {
  dataDir?: string;
  modules?: BlackRoomTeamModules;
  context?: Omit<BlackRoomTeamContextOptions, "modules" | "userId" | "actor" | "dataDir">;
  now?: () => Date;
  ai?: CeoChatAi | null;
  orders?: CeoChatOrders | null;
  audit?: (entry: BlackRoomTeamAuditEntry) => Promise<void>;
  /** Agents currently running (shared with the team routes so the same agent never runs twice at once). */
  running?: Set<string>;
  executionTimeoutMs?: number;
};

export class CeoChatBusyError extends Error {}
export class CeoChatInputError extends Error {}

// ---------------------------------------------------------------------------
// Deterministic routing
// ---------------------------------------------------------------------------

export function normalizeCeoText(text: string): string {
  return ` ${String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim()} `;
}

const SPECIALISTS = ["blackroom-analytics", "blackroom-competition", "blackroom-publisher", "blackroom-scripts", "blackroom-website"] as const;
/** Extra words the office routing does not list but chat requests use ("prepara un post"). */
const EXTRA_WORDS: Array<{ agent: (typeof SPECIALISTS)[number]; words: string[] }> = [
  { agent: "blackroom-publisher", words: [" post ", " post,", " post.", " posts ", "publicacion", "caption", "programalo", "programa un post"] },
  { agent: "blackroom-analytics", words: ["como estuvo", "numeros", " vistas", "rendimiento", "como nos fue"] },
  { agent: "blackroom-competition", words: ["competidores", "otros clubes", "otros eventos"] },
];
const ANALYTICS_STRONG = ["analitica", "analytics", "metrica", "estadistica", "insight", "alcance", "como estuvo", "numeros", " vistas", "rendimiento", "como nos fue", "redes"];
const PENDING_WORDS = ["por aprobar", "pendiente", "aprobacion", "que falta aprobar", "cola de posteos", "cola del publicador"];
const STATUS_WORDS = ["como va el equipo", "como esta el equipo", "estado del equipo", "resumen del equipo", "brief", "que hace el equipo", "como vamos"];
const CREATE_POST = /\b(prepara|preparame|preparar|crea|creame|crear|arma|armame|armar|hazme|haz un|haz el|programa|programalo|programar|agenda|agendalo|sube|subelo|subir|publica|publicalo|publicar|postea|postealo|postear|redacta|redactame|escribe un|escribeme|nuevo post|nueva publicacion)\b/;
const PERFORMANCE_QUESTION = /\b(como (?:le |les |nos |me )?(?:ha|han|fue|fueron|va|van|esta|estan|anda|andan|salio|salieron|funciono|funcionaron|rindio|rindieron)|como estuvieron|que tal (?:les |le |nos )?(?:fue|va|van|funciono|funcionaron)|resultados?|rendimiento|desempeno|performance|cuantas vistas|cuantos likes|engagement|funcionaron|funciono|les ha ido|le ha ido|nos ha ido)\b/;
const CONTENT_TOPIC = /\b(posts?|posteos?|publicacion(?:es)?|videos?|reels?|clips?|tiktok|instagram|facebook|youtube|redes|contenido|stories|historias)\b/;
const APPROVE_WORDS = /\b(aprueba|apruebalo|apruebala|aprobar|approve|rechaza|rechazalo|rechazar)\b/;

const NUMBER_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };

function ideaCount(normalized: string): number {
  const digit = normalized.match(/\b([1-9])\s*(?:ideas?|guion(?:es)?|scripts?|videos?)\b/);
  if (digit) return Math.min(5, Number(digit[1]));
  const word = normalized.match(/\b(un|una|uno|dos|tres|cuatro|cinco)\s+(?:ideas?|guion(?:es)?|scripts?|videos?)\b/);
  return word ? NUMBER_WORDS[word[1]] : 3;
}

function ideaTopic(original: string): string | null {
  const match = original.match(/\bsobre\s+(.{3,80})$/i) || original.match(/\bpara\s+(.{3,80})$/i);
  if (!match) return null;
  return match[1].replace(/[.?!¿¡]+$/g, "").trim().slice(0, 80) || null;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

function localParts(now: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now).map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday };
}

/** Local publication time (America/New_York) from Spanish words: "hoy", "manana", "el viernes a las 8pm". */
export function parsePostDateTime(normalized: string, now: Date): { value: string | null; defaultedTime: boolean } {
  const today = localParts(now, BLACKROOM_TIMEZONE);
  let offset: number | null = null;
  if (/\bpasado manana\b/.test(normalized)) offset = 2;
  else if (/\bmanana\b/.test(normalized.replace(/\bde la manana\b/g, " "))) offset = 1;
  else if (/\bhoy\b|\besta noche\b/.test(normalized)) offset = 0;
  if (offset === null) {
    const named = WEEKDAYS.findIndex((day) => new RegExp(`\\b${day}\\b`).test(normalized));
    if (named >= 0) offset = (named - today.weekday + 7) % 7;
  }
  const iso = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  let date: string | null = null;
  if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (offset !== null) {
    const target = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    date = target.toISOString().slice(0, 10);
  }
  if (!date) return { value: null, defaultedTime: false };
  let hour: number | null = null;
  let minute = 0;
  const clock = normalized.match(/\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/);
  const loose = normalized.match(/\ba las (\d{1,2})(?:\s*(am|pm|de la noche|de la tarde|de la manana))?\b/) || normalized.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (clock) { hour = Number(clock[1]); minute = Number(clock[2]); if (/p/.test(clock[3] || "") && hour < 12) hour += 12; if (/a/.test(clock[3] || "") && hour === 12) hour = 0; }
  else if (loose) {
    hour = Number(loose[1]);
    const suffix = loose[2] || "";
    if ((suffix === "pm" || suffix === "de la noche" || suffix === "de la tarde") && hour < 12) hour += 12;
    else if (!suffix && hour >= 1 && hour <= 11) hour += 12; // "a las 8" for a club post means the evening.
    if (suffix === "am" && hour === 12) hour = 0;
  }
  if (hour === null) return { value: `${date}T${CEO_CHAT_DEFAULT_POST_TIME}`, defaultedTime: true };
  if (hour > 23 || minute > 59) return { value: null, defaultedTime: false };
  return { value: `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`, defaultedTime: false };
}

/** Builds the publisher draft from a chat message; lists what is missing instead of guessing. */
export function draftFromMessage(original: string, now: Date): { draft: Record<string, unknown>; missing: string[]; defaultedTime: boolean } {
  const normalized = normalizeCeoText(original);
  const missing: string[] = [];
  const url = original.match(/https:\/\/[^\s"'<>“”]+/i)?.[0]?.replace(/[),.]+$/, "") || "";
  if (!url) missing.push("el enlace https de descarga directa del video");
  const quoted = original.match(/["“«]([^"”»]{3,2000})["”»]/)?.[1] || original.match(/\b(?:caption|texto|copy)\s*:\s*(.{3,2000})$/i)?.[1] || "";
  const caption = quoted.replace(/https:\/\/\S+/g, "").trim();
  if (!caption) missing.push("el texto del posteo entre comillas (\"...\")");
  const duration = normalized.match(/\b(\d{1,4})\s*(?:s|seg|segundos)\b/);
  const durationSeconds = duration ? Number(duration[1]) : null;
  if (!durationSeconds) missing.push("la duracion del video en segundos (ej: 30 segundos)");
  const when = parsePostDateTime(normalized, now);
  if (!when.value) missing.push("el dia y la hora (ej: el viernes a las 8pm)");
  const draft: Record<string, unknown> = {
    channel: /\bmeta\b/.test(normalized) && !/metricool/.test(normalized) ? "meta" : "metricool",
    caption,
    mediaUrl: url,
    durationSeconds: durationSeconds ?? undefined,
    videoFormat: /\bhorizontal\b/.test(normalized) ? "horizontal" : "vertical",
    language: /\ben ingles\b|\bin english\b/.test(normalized) ? "en" : "es",
    publicationDateTime: when.value ?? "",
    timezone: BLACKROOM_TIMEZONE,
    source: "ceo-chat",
    notes: "Preparado desde el chat con el CEO Black Room. Espera aprobacion.",
  };
  return { draft, missing, defaultedTime: when.defaultedTime };
}

function intentFor(key: CeoChatIntentKey, original: string, normalized: string, now: Date): CeoChatIntent {
  switch (key) {
    case "analytics": {
      const monthly = /\b(mes|mensual|30 dias)\b/.test(normalized);
      const daily = !monthly && /\b(hoy|ayer|diario|del dia|de hoy)\b/.test(normalized) && !/\bsemana|semanal\b/.test(normalized);
      const operation = monthly ? "monthly-report" : daily ? "daily-report" : "weekly-report";
      // refresh: read Metricool live when the token exists (read-only); otherwise the stored imports.
      return { key, agentId: "blackroom-analytics", operation, input: { refresh: true }, label: monthly ? "Reporte del mes" : daily ? "Reporte del dia" : "Reporte de la semana", readOnly: false };
    }
    case "competition":
      return { key, agentId: "blackroom-competition", operation: "run", input: {}, label: "Revisar a la competencia", readOnly: false };
    case "scripts": {
      const topic = ideaTopic(original);
      const input: Record<string, unknown> = { count: ideaCount(normalized) };
      if (topic) input.topic = topic;
      if (/\ben ingles\b|\bin english\b/.test(normalized)) input.language = "en";
      return { key, agentId: "blackroom-scripts", operation: "ideas", input, label: `${input.count} idea(s) de video con guion`, readOnly: false };
    }
    case "website":
      return { key, agentId: "blackroom-website", operation: "check", input: {}, label: "Revisar el sitio web", readOnly: false };
    case "publisher": {
      const { draft, missing, defaultedTime } = draftFromMessage(original, now);
      return { key, agentId: "blackroom-publisher", operation: "add", input: { draft, ...(defaultedTime ? { _defaultedTime: true } : {}) }, label: "Preparar un posteo (queda pendiente de aprobacion)", readOnly: false, ...(missing.length ? { missing } : {}) };
    }
    case "pending":
      return { key, agentId: "blackroom-publisher", operation: "list", input: { status: "pending" }, label: "Ver lo que espera aprobacion", readOnly: true };
    case "status":
      return { key, agentId: CEO_ID, operation: "brief", input: { telegram: false }, label: "Resumen del equipo", readOnly: true };
    case "videos":
      return { key, agentId: "blackroom-videos", operation: "status", input: {}, label: "Estado de Videos Black Room", readOnly: true };
    case "radio":
      return { key, agentId: "radio", operation: "status", input: {}, label: "Estado de Radio", readOnly: true };
  }
}

const KEY_BY_AGENT: Record<string, CeoChatIntentKey> = {
  "blackroom-analytics": "analytics",
  "blackroom-competition": "competition",
  "blackroom-publisher": "publisher",
  "blackroom-scripts": "scripts",
  "blackroom-website": "website",
  "blackroom-videos": "videos",
  radio: "radio",
};

/** Deterministic: which team tasks the message asks for, in the order the team works them. */
export function routeCeoChatMessage(text: string, now: Date = new Date()): CeoChatPlan {
  const original = String(text || "").trim().slice(0, CEO_CHAT_MAX_MESSAGE_CHARS);
  const normalized = normalizeCeoText(original);
  const approvalRequested = APPROVE_WORDS.test(normalized);
  const keys: CeoChatIntentKey[] = [];
  const add = (key: CeoChatIntentKey) => { if (!keys.includes(key)) keys.push(key); };

  if (STATUS_WORDS.some((word) => normalized.includes(word))) add("status");
  if (PENDING_WORDS.some((word) => normalized.includes(word)) || approvalRequested) add("pending");

  // Same routing words as the office CEO channel. The chat is already Black Room context, so the
  // specialists' "requires Black Room" words apply; "assistant" is only the no-match sentinel.
  const specialists = routeOrder(` black room ${normalized}`, [...SPECIALISTS, "assistant"]).filter((id) => id !== "assistant");
  for (const extra of EXTRA_WORDS) if (extra.words.some((word) => normalized.includes(word)) && !specialists.includes(extra.agent)) specialists.push(extra.agent);
  // The chat is already Black Room: "black room" alone must not pull in the videos/radio agents.
  const withoutBrand = normalized.replace(/\bblack ?room\b|\bbr\b/g, " ").replace(/\s+/g, " ").trim();
  const legacy = withoutBrand ? routeOrder(withoutBrand, ["blackroom-videos", "radio", "assistant"]).filter((id) => id !== "assistant") : [];

  let picked = [...specialists];
  // "reporte de la competencia" is a competition task, not the social media report.
  if (picked.includes("blackroom-competition") && picked.includes("blackroom-analytics") && /\breportes? de (?:la )?competencia\b/.test(normalized) && !ANALYTICS_STRONG.some((word) => normalized.includes(word))) {
    picked = picked.filter((id) => id !== "blackroom-analytics");
  }
  // Asking what is pending/approving is a read of the queue, not a new post.
  if (keys.includes("pending") && !CREATE_POST.test(normalized)) {
    picked = picked.filter((id) => id !== "blackroom-publisher");
  }
  // "como le han ido a los posts", "que tal funcionaron los videos": a question about results is
  // analytics, never a new post. The Publicador only runs when a post is asked to be made.
  if (PERFORMANCE_QUESTION.test(normalized) && CONTENT_TOPIC.test(normalized) && !CREATE_POST.test(normalized)) {
    picked = picked.filter((id) => id !== "blackroom-publisher");
    if (!picked.includes("blackroom-analytics") && !picked.includes("blackroom-competition")) picked.unshift("blackroom-analytics");
  } else if (picked.includes("blackroom-publisher") && !CREATE_POST.test(normalized)) {
    // Mentioning "post" without asking to make one is a question about posts: answer with analytics.
    picked = picked.filter((id) => id !== "blackroom-publisher");
    if (!picked.length) picked.push("blackroom-analytics");
  }
  // "ideas de video" or "postea el video" are scripts/publisher work, not a status read of the videos agent.
  const legacyPicked = legacy.filter((id) => !(id === "blackroom-videos" && (picked.includes("blackroom-scripts") || picked.includes("blackroom-publisher"))));
  for (const id of [...picked, ...legacyPicked]) add(KEY_BY_AGENT[id]);

  const all = keys.map((key) => intentFor(key, original, normalized, now));
  return {
    intents: all.slice(0, CEO_CHAT_MAX_EXECUTIONS),
    dropped: all.slice(CEO_CHAT_MAX_EXECUTIONS),
    approvalRequested,
    routedBy: all.length ? "reglas" : "ninguno",
  };
}

const AI_KEYS: readonly CeoChatIntentKey[] = ["analytics", "competition", "scripts", "website", "publisher", "pending", "status"];

export function buildCeoClassifyPrompt(text: string): string {
  return [
    "Clasifica el pedido para el equipo de Black Room (club/eventos). Responde SOLO una palabra:",
    "analytics (metricas de redes), competition (competencia), scripts (ideas/guiones de video), website (sitio web),",
    "publisher (preparar un posteo), pending (que espera aprobacion), status (como va el equipo), none (otra cosa).",
    `Pedido: ${text.replace(/\s+/g, " ").slice(0, 300)}`,
  ].join("\n");
}

/** Parses the classifier answer strictly; anything else is "none". */
export function parseCeoClassification(raw: string | null): CeoChatIntentKey | null {
  const word = String(raw || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return (AI_KEYS as readonly string[]).includes(word) ? word as CeoChatIntentKey : null;
}

// ---------------------------------------------------------------------------
// Persistence (per workspace, in the Black Room team data dir, via the team state helper)
// ---------------------------------------------------------------------------

function workspaceDir(dataDir: string, ownerUserId: string): string {
  const key = createHash("sha256").update(ownerUserId).digest("hex").slice(0, 24);
  return path.join(dataDir, "ceo-chat", key);
}

function emptyState(): CeoChatState {
  return { version: 1, messages: [] };
}

function normalizeChatState(raw: unknown): CeoChatState {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const messages = Array.isArray(body.messages) ? body.messages.filter((message): message is CeoChatMessage =>
    Boolean(message && typeof message === "object" && typeof (message as CeoChatMessage).id === "string" && typeof (message as CeoChatMessage).text === "string" && (message as CeoChatMessage).author && typeof (message as CeoChatMessage).author.name === "string")) : [];
  return { version: 1, messages: messages.slice(-CEO_CHAT_MAX_STORED_MESSAGES) };
}

const writeQueues = new Map<string, Promise<unknown>>();

export function readCeoChatState(dataDir: string, ownerUserId: string): Promise<CeoChatState> {
  return readBlackRoomTeamState<unknown>(workspaceDir(dataDir, ownerUserId), CEO_ID, emptyState()).then(normalizeChatState);
}

/** Serialized read-modify-write of the workspace thread (atomic file writes from the team state helper). */
export function mutateCeoChatState(dataDir: string, ownerUserId: string, change: (state: CeoChatState) => CeoChatState): Promise<CeoChatState> {
  const dir = workspaceDir(dataDir, ownerUserId);
  const work = async () => {
    const current = await readCeoChatState(dataDir, ownerUserId);
    const next = change(current);
    next.messages = next.messages.slice(-CEO_CHAT_MAX_STORED_MESSAGES);
    await writeBlackRoomTeamState(dir, CEO_ID, next);
    return next;
  };
  const previous = writeQueues.get(dir) ?? Promise.resolve();
  const next = previous.then(work, work);
  writeQueues.set(dir, next.catch(() => undefined));
  return next;
}

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------

class TimeoutError extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError("sin respuesta a tiempo")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function approvalView(item: unknown): CeoChatApprovalView | null {
  const entry = obj(item);
  if (!entry || typeof entry.id !== "string" || typeof entry.agentId !== "string") return null;
  const payload = obj(entry.payload);
  const status = entry.status === "approved" || entry.status === "rejected" ? entry.status : "pending";
  return {
    agentId: entry.agentId as BlackRoomTeamAgentId,
    id: entry.id.slice(0, 120),
    title: clip(entry.title, 160) || "Posteo",
    summary: clip(entry.summary, 240),
    status,
    createdAt: clip(entry.createdAt, 40),
    publicationDateTime: payload && typeof payload.publicationDateTime === "string" ? payload.publicationDateTime : null,
    networks: payload && Array.isArray(payload.networks) ? payload.networks.filter((n): n is string => typeof n === "string").slice(0, 6) : [],
    dryRun: entry.dryRun !== false,
  };
}

/** Short detail lines from an agent's report (never the whole report). */
function detailsFor(intent: CeoChatIntent, result: BlackRoomTeamRunResult): string[] {
  const report = obj(result.report);
  if (intent.key === "scripts" && report && Array.isArray(report.ideas)) {
    return report.ideas.slice(0, 5).map((idea) => {
      const entry = obj(idea);
      return [clip(entry?.title, 90), clip(entry?.hook, 120)].filter(Boolean).join(" — ");
    }).filter(Boolean);
  }
  if (intent.key === "analytics" && report && typeof report.text === "string") {
    // Network breakdown, best/worst posts, best hours and recommendations (the header line is the summary).
    return report.text.split(/\n+/).slice(1).map((line) => line.trim()).filter((line) => line && !/^Recomendaciones:?$/.test(line)).slice(0, 14).map((line) => line.slice(0, 220));
  }
  const lines = String(result.summary || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(1, 6).map((line) => line.slice(0, 200));
}

function firstLine(text: string): string {
  return String(text || "").split(/\n+/)[0].trim().slice(0, 300);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const GREETING_WORDS = /^(hola|holi|hey|buenas|buenos dias|buenas tardes|buenas noches|que tal|que onda|saludos|hello|hi)\b/;
const THANKS_WORDS = /^(gracias|muchas gracias|thanks|thank you|ok gracias|perfecto|genial|excelente|dale|listo|ok|okay|vale)\W*$/;
const HELP_WORDS = /\b(que puedes hacer|que sabes hacer|ayuda|ayudame|como funciona|que haces|menu|opciones)\b/;

export const CEO_CHAT_MENU = [
  "• \"Dame el reporte de la semana\" (o \"de hoy\") — cómo nos fue en redes",
  "• \"¿Qué está haciendo la competencia?\"",
  "• \"Hazme 3 ideas de video para el viernes\" — con guion",
  "• \"Revisa la web\" — links rotos, eventos viejos, si está caída",
  "• \"Prepara un post para el viernes a las 8pm con <link>: \"texto\"\" — queda pendiente de tu aprobación",
  "• \"¿Qué hay por aprobar?\" o \"¿Cómo va el equipo?\"",
].join("\n");

/** Greeting / thanks / help messages get a direct friendly answer without running any agent. */
export function smalltalkReply(text: string, name: string): string | null {
  const normalized = normalizeCeoText(text).replace(/[!?.,¡¿]+/g, " ").replace(/\s+/g, " ").trim();
  const first = name.split(/\s+/)[0] || "";
  if (THANKS_WORDS.test(normalized)) return `¡Con gusto${first ? `, ${first}` : ""}! Aquí estoy si necesitas algo más.`;
  const greeting = GREETING_WORDS.test(normalized);
  const help = HELP_WORDS.test(normalized);
  if (!greeting && !help) return null;
  // "hola, dame el reporte" is a real request: only answer smalltalk when nothing else is asked.
  if (greeting && !help && normalized.split(" ").length > 4) return null;
  return [
    `${greeting ? `¡Hola${first ? ` ${first}` : ""}! ` : ""}Soy el CEO de Black Room. Dime qué necesitas y lo pongo a trabajar con el equipo. Por ejemplo:`,
    CEO_CHAT_MENU,
    "Si me pides algo que no es de Black Room, lo dejo anotado como tarea para el resto de la oficina.",
  ].join("\n");
}

export function createCeoChat(deps: CeoChatDeps = {}) {
  const dataDir = deps.dataDir ?? path.resolve(process.cwd(), BLACKROOM_TEAM_DATA_DIR);
  const modules = deps.modules ?? BLACKROOM_TEAM_MODULES;
  const now = deps.now ?? (() => new Date());
  const ai = deps.ai === undefined ? defaultCeoChatAi : deps.ai;
  const orders = deps.orders === undefined ? defaultCeoChatOrders : deps.orders;
  const running = deps.running ?? new Set<string>();
  const executionTimeoutMs = deps.executionTimeoutMs ?? CEO_CHAT_EXECUTION_TIMEOUT_MS;
  const busyWorkspaces = new Set<string>();
  const audit = deps.audit ?? (async () => undefined);

  const contextOptions = (contextUserId: string, actor: BlackRoomTeamActor | null): BlackRoomTeamContextOptions => ({
    ...deps.context, now, dataDir, modules, userId: contextUserId, actor,
  });

  async function pendingApprovals(contextUserId: string): Promise<CeoChatApprovalView[]> {
    const list = modules["blackroom-publisher"].actions?.list;
    if (!list) return [];
    try {
      const result = await withTimeout(list(createBlackRoomTeamContext("blackroom-publisher", contextOptions(contextUserId, null)), { status: "pending" }), 10_000);
      const items = obj(result.report)?.items;
      return (Array.isArray(items) ? items : []).map(approvalView).filter((item): item is CeoChatApprovalView => Boolean(item && item.status === "pending")).slice(0, 20);
    } catch {
      return [];
    }
  }

  async function view(contextUserId: string) {
    const [state, approvals] = await Promise.all([readCeoChatState(dataDir, contextUserId), pendingApprovals(contextUserId)]);
    return { messages: state.messages.slice(-CEO_CHAT_VIEW_MESSAGES), pendingApprovals: approvals, maxExecutions: CEO_CHAT_MAX_EXECUTIONS };
  }

  async function statusNeeds(agentId: BlackRoomTeamAgentId, contextUserId: string): Promise<BlackRoomTeamStatus | null> {
    try {
      return await withTimeout(getBlackRoomTeamStatus(agentId, contextOptions(contextUserId, null)), 10_000);
    } catch {
      return null;
    }
  }

  async function execute(intent: CeoChatIntent, contextUserId: string, actor: BlackRoomTeamActor): Promise<CeoChatResultCard> {
    const agentName = intent.agentId === "blackroom-videos" || intent.agentId === "radio" ? LEGACY_NAMES[intent.agentId] : BLACKROOM_TEAM_BY_ID[intent.agentId].name;
    const card: CeoChatResultCard = { agentId: intent.agentId, agentName, operation: intent.operation, label: intent.label, ok: false, summary: "", details: [], blocked: false, needs: [], approvals: [] };

    if (intent.missing?.length) {
      return { ...card, blocked: true, needs: intent.missing, summary: `Para preparar el posteo me falta: ${intent.missing.join("; ")}. No envie nada al Publicador.` };
    }

    // Legacy members (videos, radio): read their status only; they keep their own controls.
    if (intent.agentId === "blackroom-videos" || intent.agentId === "radio") {
      const legacyId = intent.agentId;
      try {
        const status = await withTimeout(createBlackRoomTeamContext(CEO_ID, contextOptions(contextUserId, actor)).readTeammateStatus(legacyId), executionTimeoutMs);
        if (!status) return { ...card, blocked: true, summary: "No pude leer su estado ahora." };
        const blocked = status.state === "blocked";
        return { ...card, ok: !blocked, blocked, needs: status.needs.slice(0, 5), summary: `${status.label}${status.summary ? `: ${status.summary}` : ""}`.slice(0, 300) };
      } catch (error) {
        return { ...card, blocked: true, timedOut: error instanceof TimeoutError, summary: error instanceof TimeoutError ? "No respondio a tiempo." : "No pude leer su estado ahora." };
      }
    }

    const agentId = intent.agentId;
    const module = modules[agentId];
    const handler = intent.operation === "run"
      ? (ctx: Parameters<typeof module.run>[0], input: Record<string, unknown>) => module.run(ctx, input)
      : module.actions && Object.prototype.hasOwnProperty.call(module.actions, intent.operation) ? module.actions[intent.operation] : undefined;
    if (!handler) return { ...card, blocked: true, summary: "Este agente todavia no sabe hacer eso." };
    if (running.has(agentId)) return { ...card, blocked: true, summary: "Este agente ya esta trabajando en otra tarea; pidelo de nuevo en un momento." };

    running.add(agentId);
    let result: BlackRoomTeamRunResult;
    let timedOut = false;
    const input = { ...intent.input };
    delete input._defaultedTime;
    let work: Promise<BlackRoomTeamRunResult>;
    try {
      work = Promise.resolve(handler(createBlackRoomTeamContext(agentId, contextOptions(contextUserId, actor)), input));
    } catch (error) {
      work = Promise.reject(error);
    }
    // The agent stays marked busy until its call really settles, even after the chat stops waiting.
    work.then(() => running.delete(agentId), () => running.delete(agentId));
    try {
      result = await withTimeout(work, executionTimeoutMs);
    } catch (error) {
      timedOut = error instanceof TimeoutError;
      result = { ok: false, summary: timedOut ? "No termino a tiempo; puede seguir trabajando y lo veras en su estado." : "La ejecucion fallo.", error: error instanceof Error ? error.message.slice(0, 200) : "sin detalle" };
    }
    await audit({ at: now().toISOString(), agentId, operation: `ceo-chat:${intent.operation}`, actor, ok: Boolean(result?.ok), summary: result?.summary || "" })
      .catch((error) => console.warn("[blackroom-ceo-chat] audit write failed:", error instanceof Error ? error.message : error));

    const approvals = (result.needsApproval || []).map(approvalView).filter((item): item is CeoChatApprovalView => Boolean(item && item.status === "pending"));
    const summary = firstLine(result.summary) || (result.ok ? "Listo." : "No se pudo completar.");
    let needs: string[] = [];
    let blocked = !result.ok;
    if (!result.ok && !timedOut) {
      const reportErrors = obj(result.report)?.errors;
      if (Array.isArray(reportErrors)) needs = reportErrors.filter((e): e is string => typeof e === "string").slice(0, 5);
      const status = await statusNeeds(agentId, contextUserId);
      if (status?.state === "blocked") needs = [...needs, ...status.needs].slice(0, 5);
    }
    if (intent.key === "pending") {
      const items = obj(result.report)?.items;
      const pending = (Array.isArray(items) ? items : []).map(approvalView).filter((item): item is CeoChatApprovalView => Boolean(item && item.status === "pending"));
      return { ...card, ok: result.ok, blocked: !result.ok, summary: pending.length ? `${pending.length} posteo(s) esperan aprobacion.` : "No hay posteos esperando aprobacion.", approvals: pending.slice(0, 10) };
    }
    const details = detailsFor(intent, result);
    if (intent.key === "publisher" && result.ok && intent.input._defaultedTime) details.unshift(`Sin hora en el mensaje: lo deje a las ${CEO_CHAT_DEFAULT_POST_TIME.slice(0, 5)} (hora de Nueva York). Editalo antes de aprobar si prefieres otra.`);
    if (intent.key === "website" && approvals.length) details.push(`${approvals.length} tarea(s) de la web quedan como borrador para Robert.`);
    return { ...card, ok: result.ok, blocked, timedOut, needs, summary, details: details.slice(0, 6), approvals: intent.key === "publisher" ? approvals : [] };
  }

  async function placeOrder(intent: CeoChatIntent, message: string, actor: BlackRoomTeamActor): Promise<string | null> {
    if (!orders || intent.readOnly) return null;
    const agentName = intent.agentId === "blackroom-videos" || intent.agentId === "radio" ? LEGACY_NAMES[intent.agentId] : BLACKROOM_TEAM_BY_ID[intent.agentId].name;
    const text = `${agentName}: ${intent.label} — pedido en el chat del CEO: "${message.replace(/\s+/g, " ").slice(0, 300)}"`.slice(0, 500);
    try {
      // The agent that does the work owns the order; the text (agent names, the quoted message) is not routed.
      return await withTimeout(orders.place(text, actor, [intent.agentId]), ORDER_TIMEOUT_MS);
    } catch (error) {
      console.warn("[blackroom-ceo-chat] order not recorded:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  async function aiIntro(contextUserId: string, message: string, cards: CeoChatResultCard[]): Promise<string | null> {
    if (!ai || !cards.length) return null;
    const lines = cards.map((card) => `- ${card.agentName}: ${card.ok ? "hecho" : card.blocked ? "bloqueado" : "fallo"}${card.approvals.length ? `, ${card.approvals.length} por aprobar` : ""}`).join("\n");
    const prompt = [
      "Eres el CEO de Black Room. Escribe UNA frase corta (max 25 palabras), en espanol, cercana y directa, para abrir tu respuesta.",
      "No inventes datos, no digas que algo se publico ni que se aprobo. Solo resume el estado.",
      `Pedido: ${message.replace(/\s+/g, " ").slice(0, 200)}`,
      `Resultado:\n${lines}`,
    ].join("\n");
    try {
      const text = await withTimeout(ai(prompt, "reply", contextUserId), AI_TIMEOUT_MS);
      const line = clip(text, 220);
      // The intro never talks about publishing/approving/sending: those facts come only from the agents' lines.
      if (!line || /(publi|aprob|program|subi|envi|en linea|postea|\d)/.test(normalizeCeoText(line))) return null;
      return line;
    } catch {
      return null;
    }
  }

  function composeReply(plan: CeoChatPlan, cards: CeoChatResultCard[], intro: string | null): string {
    const parts: string[] = [];
    if (!cards.length) {
      if (plan.approvalRequested) {
        parts.push("Las aprobaciones las haces tú con los botones Aprobar / Rechazar de arriba; yo nunca apruebo solo.");
        return parts.join("\n");
      }
      parts.push("Mmm, no estoy seguro de qué quieres que haga. Puedo ayudarte con esto:");
      parts.push(CEO_CHAT_MENU);
      return parts.join("\n");
    }
    parts.push(intro || (cards.length === 1 ? "¡Listo! Esto es lo que encontré:" : `¡Listo! Puse a trabajar a ${cards.length} agentes. Esto es lo que encontraron:`));
    for (const card of cards) {
      const mark = card.ok ? "✔" : card.blocked ? "⛔" : "✖";
      parts.push(`${mark} ${card.agentName} · ${card.label}: ${card.summary}`);
      if (!card.ok && card.needs.length) parts.push(`   Necesita: ${card.needs.join("; ")}`);
    }
    const waiting = cards.reduce((sum, card) => sum + card.approvals.length, 0);
    if (waiting) parts.push(`Te dejé ${waiting} posteo(s) esperando tu aprobación arriba. Nada se publica sin que lo apruebes.`);
    if (plan.approvalRequested) parts.push("No apruebo ni rechazo desde el chat: usa los botones Aprobar / Rechazar.");
    if (plan.dropped.length) parts.push(`Solo hago ${CEO_CHAT_MAX_EXECUTIONS} tareas por mensaje. Pideme despues: ${plan.dropped.map((intent) => intent.label.toLowerCase()).join(", ")}.`);
    return parts.join("\n");
  }

  async function sendMessage(input: { text: unknown; actor: BlackRoomTeamActor; authorName: string; contextUserId: string }) {
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) throw new CeoChatInputError("Escribe un mensaje para el CEO.");
    if (text.length > CEO_CHAT_MAX_MESSAGE_CHARS) throw new CeoChatInputError(`El mensaje es muy largo (maximo ${CEO_CHAT_MAX_MESSAGE_CHARS} caracteres).`);
    const workspace = input.contextUserId;
    if (busyWorkspaces.has(workspace)) throw new CeoChatBusyError("El CEO todavia esta trabajando en el mensaje anterior. Espera a que responda.");
    busyWorkspaces.add(workspace);
    try {
      const userMessage: CeoChatMessage = {
        id: `msg-${randomUUID()}`,
        at: now().toISOString(),
        author: { userId: input.actor.userId, role: input.actor.role, name: input.authorName.slice(0, 60) || (input.actor.role === "owner" ? "Robert" : "Socio") },
        text,
      };
      await mutateCeoChatState(dataDir, workspace, (state) => ({ ...state, messages: [...state.messages, userMessage] }));

      const small = smalltalkReply(text, userMessage.author.name);
      if (small) {
        const reply: CeoChatMessage = {
          id: `msg-${randomUUID()}`,
          at: now().toISOString(),
          author: { userId: CEO_ID, role: "ceo", name: BLACKROOM_TEAM_BY_ID[CEO_ID].name },
          text: small,
          results: [],
          orderIds: [],
          routedBy: "conversacion",
        };
        await mutateCeoChatState(dataDir, workspace, (state) => ({ ...state, messages: [...state.messages, reply] }));
        return { message: userMessage, reply, pendingApprovals: await pendingApprovals(workspace) };
      }

      let plan = routeCeoChatMessage(text, now());
      if (!plan.intents.length && ai) {
        try {
          const key = parseCeoClassification(await withTimeout(ai(buildCeoClassifyPrompt(text), "classify", workspace), AI_TIMEOUT_MS));
          if (key) plan = { ...plan, intents: [intentFor(key, text, normalizeCeoText(text), now())], routedBy: "ia" };
        } catch { /* stays unrouted */ }
      }

      const cards: CeoChatResultCard[] = [];
      const orderIds: string[] = [];
      for (const intent of plan.intents.slice(0, CEO_CHAT_MAX_EXECUTIONS)) {
        const orderId = await placeOrder(intent, text, input.actor);
        if (orderId) orderIds.push(orderId);
        const card = await execute(intent, workspace, input.actor);
        card.orderId = orderId;
        // Done work closes its order (record only). Blocked work or drafts waiting for approval stay open.
        if (orderId && orders && card.ok && !card.approvals.length) {
          try {
            await withTimeout(orders.finish(orderId), ORDER_TIMEOUT_MS);
            card.orderClosed = true;
          } catch { card.orderClosed = false; }
        }
        cards.push(card);
      }

      // Not Black Room work: the owner's request becomes a task for the rest of the office (classic CEO channel).
      let generalNote: string | null = null;
      if (!cards.length && !plan.approvalRequested && input.actor.role === "owner" && orders?.placeGeneral) {
        try {
          const placed = await withTimeout(orders.placeGeneral(text, input.actor), ORDER_TIMEOUT_MS);
          if (placed?.orderId) {
            orderIds.push(placed.orderId);
            const who = placed.assignees.length ? placed.assignees.join(", ") : "el equipo";
            generalNote = `Eso no es de Black Room, así que lo anoté como tarea para ${who} en la oficina. Esos agentes todavía no lo ejecutan solos: lo ves en la pestaña Tareas.`;
          }
        } catch (error) {
          console.warn("[blackroom-ceo-chat] general order not recorded:", error instanceof Error ? error.message : error);
        }
      }

      const intro = await aiIntro(workspace, text, cards);
      const reply: CeoChatMessage = {
        id: `msg-${randomUUID()}`,
        at: now().toISOString(),
        author: { userId: CEO_ID, role: "ceo", name: BLACKROOM_TEAM_BY_ID[CEO_ID].name },
        text: generalNote ?? composeReply(plan, cards, intro),
        results: cards,
        orderIds,
        routedBy: plan.routedBy,
      };
      await mutateCeoChatState(dataDir, workspace, (state) => ({ ...state, messages: [...state.messages, reply] }));
      return { message: userMessage, reply, pendingApprovals: await pendingApprovals(workspace) };
    } finally {
      busyWorkspaces.delete(workspace);
    }
  }

  /** Explicit human decision on a publisher item (button click). The CEO never calls this by itself. */
  async function decideApproval(input: { id: unknown; decision: unknown; actor: BlackRoomTeamActor; authorName: string; contextUserId: string }) {
    const id = typeof input.id === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(input.id) ? input.id : null;
    if (!id) throw new CeoChatInputError("Posteo no valido.");
    if (input.decision !== "approve" && input.decision !== "reject") throw new CeoChatInputError("Decision no valida: usa aprobar o rechazar.");
    const decision = input.decision;
    const handler = modules["blackroom-publisher"].actions?.[decision];
    if (!handler) throw new CeoChatInputError("El Publicador no permite esa decision.");
    let result: BlackRoomTeamRunResult;
    try {
      result = await withTimeout(handler(createBlackRoomTeamContext("blackroom-publisher", contextOptions(input.contextUserId, input.actor)), { id }), 20_000);
    } catch (error) {
      result = { ok: false, summary: "No se pudo registrar la decision.", error: error instanceof Error ? error.message.slice(0, 200) : "sin detalle" };
    }
    await audit({ at: now().toISOString(), agentId: "blackroom-publisher", operation: `ceo-chat:${decision}`, actor: input.actor, ok: result.ok, targetId: id, summary: result.summary })
      .catch((error) => console.warn("[blackroom-ceo-chat] audit write failed:", error instanceof Error ? error.message : error));
    const who = input.authorName.slice(0, 60) || (input.actor.role === "owner" ? "Robert" : "Socio");
    const note: CeoChatMessage = {
      id: `msg-${randomUUID()}`,
      at: now().toISOString(),
      author: { userId: CEO_ID, role: "ceo", name: BLACKROOM_TEAM_BY_ID[CEO_ID].name },
      text: result.ok
        ? `${who} (${input.actor.role === "owner" ? "owner" : "socio"}) ${decision === "approve" ? "aprobo" : "rechazo"} el posteo ${id}. ${firstLine(result.summary)}`
        : `No se pudo ${decision === "approve" ? "aprobar" : "rechazar"} el posteo ${id}: ${firstLine(result.summary)}`,
    };
    await mutateCeoChatState(dataDir, input.contextUserId, (state) => ({ ...state, messages: [...state.messages, note] }));
    return { result, message: note, pendingApprovals: await pendingApprovals(input.contextUserId) };
  }

  return { view, sendMessage, decideApproval, pendingApprovals };
}

export type CeoChat = ReturnType<typeof createCeoChat>;

// ---------------------------------------------------------------------------
// Defaults: company orders (office council) and the cheap AI helper
// ---------------------------------------------------------------------------

export const defaultCeoChatOrders: CeoChatOrders = {
  async place(text, placedBy, assignees) {
    const { getAgentCouncil } = await import("./agent-council");
    const state = await getAgentCouncil().placeOrder(text, "blackroom", placedBy, { assignees });
    return state.company.orders[0]?.id ?? null;
  },
  async finish(orderId) {
    const { getAgentCouncil } = await import("./agent-council");
    await getAgentCouncil().finishOrder(orderId);
  },
  async placeGeneral(text, placedBy) {
    if (placedBy.role !== "owner") return null;
    const { getAgentCouncil, AGENT_NAMES } = await import("./agent-council");
    const state = await getAgentCouncil().placeOrder(text, "main", placedBy);
    const order = state.company.orders[0];
    if (!order) return null;
    return { orderId: order.id, assignees: order.assignees.map((assignee) => AGENT_NAMES[assignee.agentId] || assignee.agentId) };
  },
};

/**
 * Cheap scout (Gemini flash-lite, the same client and model the web chat uses). Off when
 * BLACKROOM_CEO_CHAT_AI=false or without the Gemini key. Compact prompts, small output.
 */
export const defaultCeoChatAi: CeoChatAi = async (prompt, purpose, userId) => {
  if (process.env.BLACKROOM_CEO_CHAT_AI?.trim().toLowerCase() === "false") return null;
  const { hasRealValue } = await import("./ceo-doctor-cli");
  if (!hasRealValue(process.env.AI_INTEGRATIONS_GEMINI_API_KEY)) return null;
  try {
    const [{ getGeminiClient, getGeminiChatModel }, { estimateTokenApiCostUsd, recordAiApiCostEvent }] = await Promise.all([import("./gemini-client"), import("./ai-cost-notifications")]);
    const model = getGeminiChatModel({ hasImage: false });
    const client = await getGeminiClient();
    const result = await client.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: prompt }] }], config: { maxOutputTokens: purpose === "classify" ? 8 : 80 } });
    const text = result.text || "";
    const usage = (result as { usageMetadata?: Record<string, number> }).usageMetadata || {};
    const inputTokens = Number(usage.promptTokenCount) || Math.ceil(prompt.length / 4);
    const outputTokens = Number(usage.candidatesTokenCount) || Math.ceil(text.length / 4);
    await recordAiApiCostEvent({
      userId,
      provider: "gemini",
      model,
      operation: purpose === "classify" ? "CEO Black Room: clasificar pedido" : "CEO Black Room: redactar respuesta",
      estimatedCostUsd: estimateTokenApiCostUsd({ provider: "gemini", model, inputTokens, outputTokens }),
      metadata: { inputTokens, outputTokens },
    }).catch(() => null);
    return text.trim() || null;
  } catch {
    return null;
  }
};
