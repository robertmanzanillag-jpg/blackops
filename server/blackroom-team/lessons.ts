// "Lecciones" of the Black Room team: a deterministic store of REAL outcomes per agent and the
// rules derived from them. $0: no AI, no network. The agents read their rules through the shared
// context (ctx.readLessons), the council turns outcomes into life/points (quality signals) and
// the academy turns rules into training cases, so new trainees practice on real mistakes.
//
// Outcomes come from two places:
// - harvested from the agents' own state files (Publicador decisions, failed edit jobs, posts in
//   the analytics report that can be matched to a Publicador receipt); never invented;
// - recorded explicitly (owner/partner feedback, a rejection reason) with recordBlackRoomLessonOutcome.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BLACKROOM_DEPARTMENT_ORDER,
  type BlackRoomTeamLessonRule,
  type BlackRoomTeamMemberId,
} from "@shared/blackroom-team";
import type { QualitySignal } from "@shared/agent-company";
import { BLACKROOM_TEAM_DATA_DIR, readBlackRoomTeamState } from "./state";
import type { BlackRoomPublisherItem, BlackRoomPublisherState } from "./blackroom-publisher";
import type { BlackRoomScriptsState } from "./blackroom-scripts";
import { editJobFailureKind } from "./edit-job-failure";
import type { BlackRoomAnalyticsAgentState } from "./blackroom-analytics";

/** "job_blocked": an edit job stopped by a restart, a pending confirmation or missing setup (lesson only, never scored). */
export type BlackRoomLessonOutcomeKind = "approved" | "rejected" | "above_median" | "below_median" | "job_failed" | "job_blocked" | "feedback";

export type BlackRoomLessonOutcome = {
  /** Stable id: the same real event always gets the same id (dedupe, scored once). */
  id: string;
  agentId: BlackRoomTeamMemberId;
  kind: BlackRoomLessonOutcomeKind;
  at: string;
  /** What it is about: a Publicador item, an edit job, a post id. */
  refId: string;
  reason?: string;
  actorRole?: "owner" | "partner" | null;
  sentiment?: "positive" | "negative";
  /** Comparable traits of the post/job (language, format, duration, hour, networks). */
  features?: Record<string, string>;
  views?: number;
  median?: number;
  source: "harvest" | "recorded";
};

export type BlackRoomLessonStore = { version: 1; outcomes: BlackRoomLessonOutcome[]; updatedAt: string | null };

export type BlackRoomLessonOptions = { dataDir?: string; now?: () => Date };

export type BlackRoomLessons = {
  agentId: BlackRoomTeamMemberId;
  rules: BlackRoomTeamLessonRule[];
  outcomes: BlackRoomLessonOutcome[];
};

const MAX_OUTCOMES = 400;
const MAX_RULES_PER_AGENT = 8;
const KINDS: readonly BlackRoomLessonOutcomeKind[] = ["approved", "rejected", "above_median", "below_median", "job_failed", "job_blocked", "feedback"];
const MEMBERS = new Set<string>(BLACKROOM_DEPARTMENT_ORDER);
const EMPTY: BlackRoomLessonStore = { version: 1, outcomes: [], updatedAt: null };

export function blackRoomLessonsPath(dataDir: string): string {
  return path.join(dataDir, "lessons.json");
}

function resolveDir(options: BlackRoomLessonOptions): string {
  return options.dataDir ?? path.resolve(process.cwd(), BLACKROOM_TEAM_DATA_DIR);
}

function clean(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

function validOutcome(raw: unknown): raw is BlackRoomLessonOutcome {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as BlackRoomLessonOutcome;
  return typeof o.id === "string" && o.id.length > 0 && o.id.length <= 300 && MEMBERS.has(o.agentId) && KINDS.includes(o.kind) &&
    typeof o.refId === "string" && Number.isFinite(Date.parse(o.at)) && (o.source === "harvest" || o.source === "recorded");
}

export function parseBlackRoomLessonStore(raw: unknown): BlackRoomLessonStore {
  if (!raw || typeof raw !== "object" || (raw as BlackRoomLessonStore).version !== 1) return { ...EMPTY, outcomes: [] };
  const value = raw as BlackRoomLessonStore;
  const outcomes = Array.isArray(value.outcomes) ? value.outcomes.filter(validOutcome) : [];
  return { version: 1, outcomes: mergeOutcomes([], outcomes), updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null };
}

export async function loadBlackRoomLessonStore(options: BlackRoomLessonOptions = {}): Promise<BlackRoomLessonStore> {
  try {
    return parseBlackRoomLessonStore(JSON.parse(await readFile(blackRoomLessonsPath(resolveDir(options)), "utf8")));
  } catch (error: any) {
    if (error?.code === "ENOENT") return { ...EMPTY, outcomes: [] };
    // A corrupt file is not evidence of anything: start empty rather than inventing outcomes.
    if (error instanceof SyntaxError) return { ...EMPTY, outcomes: [] };
    throw error;
  }
}

async function saveStore(dataDir: string, store: BlackRoomLessonStore): Promise<void> {
  const filePath = blackRoomLessonsPath(dataDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** Newest version of each id wins; newest outcomes kept first up to the cap. */
export function mergeOutcomes(existing: BlackRoomLessonOutcome[], incoming: BlackRoomLessonOutcome[]): BlackRoomLessonOutcome[] {
  const byId = new Map<string, BlackRoomLessonOutcome>();
  for (const outcome of [...existing, ...incoming]) {
    const previous = byId.get(outcome.id);
    // A recorded reason (feedback from Robert/partner) is never overwritten by a harvested copy.
    if (previous && previous.source === "recorded" && outcome.source === "harvest") continue;
    byId.set(outcome.id, outcome);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)).slice(0, MAX_OUTCOMES);
}

// ---------------------------------------------------------------------------
// Features (comparable traits) and harvesting from the agents' own state
// ---------------------------------------------------------------------------

const FEATURE_LABELS: Record<string, string> = {
  idioma: "idioma",
  formato: "formato",
  duracion: "duracion",
  horario: "horario",
  redes: "redes",
  canal: "canal",
};

function durationBucket(seconds: number): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  if (seconds <= 30) return "corto (hasta 30 s)";
  if (seconds <= 60) return "medio (31-60 s)";
  return "largo (mas de 60 s)";
}

function hourBucket(localDateTime: string): string | undefined {
  const match = /T(\d{2}):/.exec(localDateTime || "");
  if (!match) return undefined;
  const hour = Number(match[1]);
  if (hour < 6) return "madrugada (0-5 h)";
  if (hour < 12) return "manana (6-11 h)";
  if (hour < 18) return "tarde (12-17 h)";
  return "noche (18-23 h)";
}

export function publisherItemFeatures(item: Pick<BlackRoomPublisherItem, "payload">): Record<string, string> {
  const draft = item.payload || ({} as BlackRoomPublisherItem["payload"]);
  const features: Record<string, string> = {};
  if (draft.language === "es" || draft.language === "en") features.idioma = draft.language;
  if (draft.videoFormat) features.formato = draft.videoFormat;
  const duration = durationBucket(Number(draft.durationSeconds));
  if (duration) features.duracion = duration;
  const hour = hourBucket(draft.publicationDateTime);
  if (hour) features.horario = hour;
  if (Array.isArray(draft.networks) && draft.networks.length) features.redes = [...draft.networks].sort().join("+");
  if (draft.channel) features.canal = draft.channel;
  return features;
}

function decidedRole(item: BlackRoomPublisherItem): "owner" | "partner" | null {
  const role = item.decidedBy?.role;
  return role === "owner" || role === "partner" ? role : null;
}

function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type BlackRoomHarvestInput = {
  publisher?: BlackRoomPublisherState | null;
  scripts?: BlackRoomScriptsState | null;
  analytics?: BlackRoomAnalyticsAgentState | null;
};

export type BlackRoomPattern = { agentIds: BlackRoomTeamMemberId[]; id: string; text: string; support: number; at: string };

/** Pure: outcomes and analytics patterns from the agents' state. Only real records produce output. */
export function harvestBlackRoomOutcomes(input: BlackRoomHarvestInput): { outcomes: BlackRoomLessonOutcome[]; patterns: BlackRoomPattern[] } {
  const outcomes: BlackRoomLessonOutcome[] = [];
  const items = Array.isArray(input.publisher?.items) ? input.publisher!.items : [];
  const jobs = Array.isArray(input.scripts?.jobs) ? input.scripts!.jobs : [];
  // Which edit job produced which Publicador item (the scripts agent hands its clips over).
  const scriptsByItem = new Map<string, string>();
  for (const job of jobs) for (const itemId of Array.isArray(job?.publisherItemIds) ? job.publisherItemIds : []) scriptsByItem.set(itemId, job.id);

  for (const item of items) {
    if (!item || typeof item.id !== "string" || (item.status !== "approved" && item.status !== "rejected")) continue;
    const at = item.decidedAt && Number.isFinite(Date.parse(item.decidedAt)) ? item.decidedAt : null;
    if (!at) continue;
    const features = publisherItemFeatures(item);
    const base = { kind: item.status, at, refId: item.id, actorRole: decidedRole(item), features, source: "harvest" as const };
    outcomes.push({ ...base, id: `publisher:${item.id}:${item.status}:${at}`, agentId: "blackroom-publisher" });
    const jobId = scriptsByItem.get(item.id);
    if (jobId) outcomes.push({ ...base, id: `scripts:${item.id}:${item.status}:${at}`, agentId: "blackroom-scripts" });
  }

  for (const job of jobs) {
    if (!job || job.status !== "failed" || typeof job.id !== "string") continue;
    const at = [job.finishedAt, job.updatedAt, job.createdAt].find((value) => value && Number.isFinite(Date.parse(value)));
    if (!at) continue;
    // Restarts, confirmations waiting for Robert and missing setup are not the agent's fault:
    // they stay as lessons but never score (idle / setup / shared infrastructure never deduct life).
    const scored = editJobFailureKind(job) === "render";
    outcomes.push({
      id: `scripts-job:${job.id}:${scored ? "failed" : "blocked"}:${job.attempts ?? 0}`,
      agentId: "blackroom-scripts",
      kind: scored ? "job_failed" : "job_blocked",
      at,
      refId: job.id,
      reason: clean(job.error, 160) || "sin detalle",
      source: "harvest",
    });
  }

  const patterns: BlackRoomPattern[] = [];
  const report = input.analytics?.lastReport;
  if (report && report.networks && typeof report.networks === "object") {
    const posts = new Map<string, { id: string; views: number; network: string }>();
    for (const [network, entry] of Object.entries(report.networks)) {
      if (!entry || entry.status !== "ok") continue;
      for (const post of [...(entry.topPosts || []), ...(entry.bottomPosts || [])]) {
        if (post && typeof post.id === "string" && Number.isFinite(post.views)) posts.set(`${network}:${post.id}`, { id: post.id, views: post.views, network });
      }
      const at = report.generatedAt;
      const bestHour = (entry.bestHours || [])[0];
      if (bestHour && bestHour.samples >= 2) patterns.push({ agentIds: ["blackroom-publisher", "blackroom-scripts"], id: `analytics:${network}:hora:${bestHour.label}`, text: `En ${entry.label}, el mejor horario reciente es ${bestHour.label} (mediana ${Math.round(bestHour.medianViews)} vistas en ${bestHour.samples} posteos).`, support: bestHour.samples, at });
      const bestDuration = (entry.bestDurations || [])[0];
      if (bestDuration && bestDuration.samples >= 2) patterns.push({ agentIds: ["blackroom-scripts"], id: `analytics:${network}:duracion:${bestDuration.label}`, text: `En ${entry.label}, la duracion que mejor rinde es ${bestDuration.label} (mediana ${Math.round(bestDuration.medianViews)} vistas en ${bestDuration.samples} posteos).`, support: bestDuration.samples, at });
    }
    const teamMedian = median([...posts.values()].map((post) => post.views));
    // A post scores only when it can be matched to a Publicador receipt: no attribution, no points.
    const itemByPost = new Map<string, BlackRoomPublisherItem>();
    for (const item of items) {
      const receipt = item?.dispatch?.receipt;
      if (!receipt) continue;
      if (receipt.metricoolId) itemByPost.set(String(receipt.metricoolId), item);
      for (const value of Object.values(receipt.platformReceipts || {})) if (value) itemByPost.set(String(value), item);
      for (const value of Object.values(item.dispatch?.partialReceipts || {})) if (value) itemByPost.set(String(value), item);
    }
    if (teamMedian !== null && posts.size >= 3) {
      for (const post of posts.values()) {
        const item = itemByPost.get(post.id);
        if (!item || post.views === teamMedian) continue;
        const kind: BlackRoomLessonOutcomeKind = post.views > teamMedian ? "above_median" : "below_median";
        const base = { kind, at: report.generatedAt, refId: post.id, views: post.views, median: teamMedian, features: publisherItemFeatures(item), source: "harvest" as const };
        outcomes.push({ ...base, id: `post:${post.network}:${post.id}:${kind}`, agentId: "blackroom-publisher" });
        if (scriptsByItem.has(item.id)) outcomes.push({ ...base, id: `post-scripts:${post.network}:${post.id}:${kind}`, agentId: "blackroom-scripts" });
      }
    }
  }
  return { outcomes: outcomes.filter(validOutcome), patterns: patterns.filter((pattern) => Number.isFinite(Date.parse(pattern.at))) };
}

async function readAgentStates(dataDir: string): Promise<BlackRoomHarvestInput> {
  const safe = async <T>(work: Promise<T>): Promise<T | null> => work.catch(() => null);
  const [publisher, scripts, analytics] = await Promise.all([
    safe(readBlackRoomTeamState<BlackRoomPublisherState | null>(dataDir, "blackroom-publisher", null)),
    safe(readBlackRoomTeamState<BlackRoomScriptsState | null>(dataDir, "blackroom-scripts", null)),
    safe(readBlackRoomTeamState<BlackRoomAnalyticsAgentState | null>(dataDir, "blackroom-analytics", null)),
  ]);
  return { publisher, scripts, analytics };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function roleWord(role: "owner" | "partner" | null | undefined): string {
  return role === "partner" ? "el socio" : "Robert";
}

/** Pure, deterministic: same outcomes -> same rules (sorted by support, newest first on ties). */
export function deriveBlackRoomLessonRules(agentId: BlackRoomTeamMemberId, outcomes: BlackRoomLessonOutcome[], patterns: BlackRoomPattern[] = []): BlackRoomTeamLessonRule[] {
  const mine = outcomes.filter((outcome) => outcome.agentId === agentId);
  const rules: BlackRoomTeamLessonRule[] = [];
  const latest = (items: BlackRoomLessonOutcome[]) => items.map((item) => item.at).sort().at(-1) || new Date(0).toISOString();

  // Traits that Robert/partner keep rejecting (or approving).
  const decisions = mine.filter((outcome) => outcome.kind === "approved" || outcome.kind === "rejected");
  const byFeature = new Map<string, { approved: BlackRoomLessonOutcome[]; rejected: BlackRoomLessonOutcome[] }>();
  for (const outcome of decisions) {
    for (const [key, value] of Object.entries(outcome.features || {})) {
      const bucket = byFeature.get(`${key}=${value}`) || { approved: [], rejected: [] };
      bucket[outcome.kind as "approved" | "rejected"].push(outcome);
      byFeature.set(`${key}=${value}`, bucket);
    }
  }
  for (const [feature, bucket] of byFeature) {
    const [key, value] = feature.split("=");
    const label = `${FEATURE_LABELS[key] || key} ${value}`;
    if (bucket.rejected.length >= 2 && bucket.rejected.length > bucket.approved.length) {
      rules.push({ id: `evitar:${feature}`, agentId, kind: "evitar", text: `Evitar ${label}: ${bucket.rejected.length} posteos rechazados y ${bucket.approved.length} aprobados.`, support: bucket.rejected.length, evidence: bucket.rejected.map((item) => item.id).slice(0, 5), updatedAt: latest(bucket.rejected) });
    } else if (bucket.approved.length >= 2 && bucket.approved.length >= 2 * bucket.rejected.length) {
      rules.push({ id: `repetir:${feature}`, agentId, kind: "repetir", text: `Repetir ${label}: ${bucket.approved.length} posteos aprobados y ${bucket.rejected.length} rechazados.`, support: bucket.approved.length, evidence: bucket.approved.map((item) => item.id).slice(0, 5), updatedAt: latest(bucket.approved) });
    }
  }

  // Explicit reasons (a rejection reason or feedback from Robert/partner).
  for (const outcome of mine.filter((item) => item.reason && (item.kind === "rejected" || item.kind === "feedback")).slice(0, 3)) {
    const positive = outcome.kind === "feedback" && outcome.sentiment === "positive";
    rules.push({ id: `${positive ? "repetir" : "corregir"}:${outcome.id}`, agentId, kind: positive ? "repetir" : "corregir", text: `${positive ? "Le gusto a" : "Corregir lo que pidio"} ${roleWord(outcome.actorRole)}: ${outcome.reason}`, support: 1, evidence: [outcome.id], updatedAt: outcome.at });
  }

  // Failed edit jobs, grouped by the error (digits removed so retries of the same cause group).
  const failures = new Map<string, BlackRoomLessonOutcome[]>();
  for (const outcome of mine.filter((item) => item.kind === "job_failed")) {
    const key = (outcome.reason || "sin detalle").toLowerCase().replace(/\d+/g, "#").slice(0, 80);
    failures.set(key, [...(failures.get(key) || []), outcome]);
  }
  for (const [key, items] of failures) {
    rules.push({ id: `evitar:fallo:${key}`, agentId, kind: "evitar", text: `Antes de editar, revisar la causa de ${items.length} ${items.length === 1 ? "trabajo fallido" : "trabajos fallidos"}: ${items[0].reason}`, support: items.length, evidence: items.map((item) => item.id).slice(0, 5), updatedAt: latest(items) });
  }

  // Published posts above the team median, by trait.
  const above = mine.filter((item) => item.kind === "above_median");
  const aboveByFeature = new Map<string, BlackRoomLessonOutcome[]>();
  for (const outcome of above) for (const [key, value] of Object.entries(outcome.features || {})) aboveByFeature.set(`${key}=${value}`, [...(aboveByFeature.get(`${key}=${value}`) || []), outcome]);
  for (const [feature, items] of aboveByFeature) {
    if (items.length < 2) continue;
    const [key, value] = feature.split("=");
    rules.push({ id: `repetir:mediana:${feature}`, agentId, kind: "repetir", text: `Los posteos con ${FEATURE_LABELS[key] || key} ${value} rinden arriba de la mediana del equipo (${items.length} posteos).`, support: items.length, evidence: items.map((item) => item.id).slice(0, 5), updatedAt: latest(items) });
  }

  for (const pattern of patterns.filter((item) => item.agentIds.includes(agentId))) {
    rules.push({ id: `repetir:${pattern.id}`, agentId, kind: "repetir", text: pattern.text, support: pattern.support, evidence: [pattern.id], updatedAt: pattern.at });
  }

  const unique = new Map<string, BlackRoomTeamLessonRule>();
  for (const rule of rules) if (!unique.has(rule.id)) unique.set(rule.id, rule);
  return [...unique.values()]
    .sort((a, b) => b.support - a.support || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, MAX_RULES_PER_AGENT);
}

// ---------------------------------------------------------------------------
// Quality signals for the council (life/points)
// ---------------------------------------------------------------------------

/** Pure: outcomes -> scored signals. Below-median posts teach a lesson but cost nothing. */
export function blackRoomQualitySignals(outcomes: BlackRoomLessonOutcome[]): QualitySignal[] {
  const signals: QualitySignal[] = [];
  for (const outcome of outcomes) {
    const who = roleWord(outcome.actorRole);
    const signal = (points: number, battery: number, text: string) => signals.push({ id: `blackroom:${outcome.id}`, agentId: outcome.agentId, at: outcome.at, points, battery, text });
    switch (outcome.kind) {
      case "approved": signal(3, 2, `Posteo aprobado por ${who}`); break;
      case "rejected": signal(-3, -3, `Posteo rechazado por ${who}${outcome.reason ? `: ${outcome.reason}` : ""}`); break;
      case "above_median": signal(4, 2, `Posteo arriba de la mediana del equipo (${outcome.views} vs ${outcome.median} vistas)`); break;
      case "job_failed": signal(-2, -4, `Trabajo de edicion fallido: ${outcome.reason || "sin detalle"}`); break;
      case "feedback": if (outcome.sentiment === "positive") signal(1, 1, `Comentario positivo de ${who}`); else if (outcome.sentiment === "negative") signal(-1, -1, `Correccion de ${who}${outcome.reason ? `: ${outcome.reason}` : ""}`); break;
      default: break;
    }
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Records one outcome (e.g. feedback from Robert or the partner). Same id twice is one outcome. */
export async function recordBlackRoomLessonOutcome(
  input: { agentId: BlackRoomTeamMemberId; kind: BlackRoomLessonOutcomeKind; refId: string; reason?: string; actorRole?: "owner" | "partner" | null; sentiment?: "positive" | "negative"; at?: string; id?: string },
  options: BlackRoomLessonOptions = {},
): Promise<BlackRoomLessonOutcome> {
  const now = options.now ? options.now() : new Date();
  const at = input.at && Number.isFinite(Date.parse(input.at)) ? input.at : now.toISOString();
  const outcome: BlackRoomLessonOutcome = {
    id: clean(input.id, 300) || `recorded:${input.agentId}:${input.kind}:${clean(input.refId, 120) || "general"}:${at}`,
    agentId: input.agentId,
    kind: input.kind,
    at,
    refId: clean(input.refId, 120) || "general",
    ...(clean(input.reason, 300) ? { reason: clean(input.reason, 300) } : {}),
    actorRole: input.actorRole ?? null,
    ...(input.sentiment ? { sentiment: input.sentiment } : {}),
    source: "recorded",
  };
  if (!validOutcome(outcome)) throw new Error("Leccion invalida: agente o tipo desconocido.");
  const dataDir = resolveDir(options);
  const store = await loadBlackRoomLessonStore({ dataDir });
  await saveStore(dataDir, { version: 1, outcomes: mergeOutcomes(store.outcomes, [outcome]), updatedAt: now.toISOString() });
  return outcome;
}

async function collect(options: BlackRoomLessonOptions) {
  const dataDir = resolveDir(options);
  const [store, states] = await Promise.all([loadBlackRoomLessonStore({ dataDir }), readAgentStates(dataDir)]);
  const harvested = harvestBlackRoomOutcomes(states);
  return { dataDir, store, outcomes: mergeOutcomes(store.outcomes, harvested.outcomes), patterns: harvested.patterns };
}

/** Rules for one agent, read fresh (store + harvest in memory; nothing is written). */
export async function getBlackRoomLessons(agentId: BlackRoomTeamMemberId, options: BlackRoomLessonOptions = {}): Promise<BlackRoomLessons> {
  const { outcomes, patterns } = await collect(options);
  return { agentId, rules: deriveBlackRoomLessonRules(agentId, outcomes, patterns), outcomes: outcomes.filter((outcome) => outcome.agentId === agentId).slice(0, 20) };
}

/** Council read: persists harvested outcomes (so they survive the agents pruning their queues). */
export async function syncBlackRoomLessons(options: BlackRoomLessonOptions = {}): Promise<{
  outcomes: BlackRoomLessonOutcome[];
  rules: Record<string, BlackRoomTeamLessonRule[]>;
  signals: QualitySignal[];
}> {
  const { dataDir, store, outcomes, patterns } = await collect(options);
  const changed = outcomes.length !== store.outcomes.length || outcomes.some((outcome, index) => store.outcomes[index]?.id !== outcome.id);
  if (changed) await saveStore(dataDir, { version: 1, outcomes, updatedAt: (options.now ? options.now() : new Date()).toISOString() }).catch(() => undefined);
  const rules = Object.fromEntries(BLACKROOM_DEPARTMENT_ORDER.map((id) => [id, deriveBlackRoomLessonRules(id, outcomes, patterns)]));
  return { outcomes, rules, signals: blackRoomQualitySignals(outcomes) };
}
