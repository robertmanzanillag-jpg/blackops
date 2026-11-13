// Publicador Black Room: single approval queue for new manual / AI-drafted Black Room posts.
//
// Safety model (fail closed):
// - Every draft enters as a BlackRoomTeamApproval with status "pending" and dryRun true.
// - Only items Robert approves are ever dispatched, and only through the existing
//   scheduleBlackRoomMetricoolPost (server/blackroom-metricool-bridge.ts), which enforces the
//   publication-guard vetoes (blackRoomPublicationFlagVeto + blackRoomPublicationControlVeto).
// - Real scheduling needs BLACKROOM_PUBLISHER_LIVE=true on top of the bridge flags; otherwise a
//   dispatch only records a dry-run preview and sends nothing.
// - Idempotent: a persisted receipt means the item is never sent again. An item whose outcome is
//   uncertain (crash mid-call, Metricool timeout) is never retried automatically: it can only be
//   reconciled with the read-only "verify" action.
// - No loop of its own: nothing is dispatched unless run() or the "schedule" action is called.
//   The existing blackroom-videos publisher keeps its own device queue untouched.
// - Meta Graph API is a secondary channel: it is reported (configured or not) but never posts
//   directly; drafts for Meta stay as dry-run previews.
import { createHash } from "node:crypto";
import path from "node:path";
import {
  BLACKROOM_METRICOOL_NETWORKS,
  BLACKROOM_TIMEZONE,
  BlackRoomMetricoolUncertainError,
  blackRoomMetricoolNetworks,
  buildBlackRoomFacebookCaption,
  buildBlackRoomYouTubeCaption,
  formatMetricoolMcpDate,
  scheduleBlackRoomMetricoolPost,
  type BlackRoomMetricoolNetwork,
  type BlackRoomMetricoolReceipt,
  type BlackRoomMetricoolScheduleInput,
} from "../blackroom-metricool-bridge";
import { BlackRoomPublicationBlockedError, blackRoomPublicationFlagVeto, type BlackRoomPublicationControl } from "../blackroom-publication-guard";
import {
  BLACKROOM_TEAM_WORKING_FRESH_MS,
  type BlackRoomTeamActionHandler,
  type BlackRoomTeamAgentModule,
  type BlackRoomTeamApproval,
  type BlackRoomTeamContext,
  type BlackRoomTeamEnv,
  type BlackRoomTeamRunResult,
  type BlackRoomTeamStatus,
} from "@shared/blackroom-team";

const ID = "blackroom-publisher" as const;

export const BLACKROOM_PUBLISHER_LIVE_FLAG = "BLACKROOM_PUBLISHER_LIVE";
export const BLACKROOM_PUBLISHER_META_TOKEN_ENV = "BLACKROOM_META_ACCESS_TOKEN";
export const BLACKROOM_PUBLISHER_META_PAGE_ENV = "BLACKROOM_META_PAGE_ID";
/** A post must be scheduled at least this far ahead of now. */
export const BLACKROOM_PUBLISHER_MIN_LEAD_MS = 10 * 60_000;
const MAX_ITEMS = 200;

export type BlackRoomPublisherChannel = "metricool" | "meta";

export type BlackRoomPostDraft = {
  channel: BlackRoomPublisherChannel;
  caption: string;
  mediaUrl: string;
  /** YouTube id of the full set the clip comes from (the bridge links it in the captions); "" when there is no set. */
  sourceVideoId: string;
  durationSeconds: number;
  videoFormat: "vertical" | "horizontal";
  language: "en" | "es";
  networks: BlackRoomMetricoolNetwork[];
  /** Local wall clock in `timezone`, "YYYY-MM-DDTHH:MM:SS". */
  publicationDateTime: string;
  timezone: string;
  source: string;
  notes: string;
};

export type BlackRoomPublisherDispatchState = "none" | "dry-run" | "blocked" | "dispatching" | "scheduled" | "uncertain";

export type BlackRoomPublisherDispatch = {
  state: BlackRoomPublisherDispatchState;
  attempts: number;
  updatedAt: string | null;
  lastError: string | null;
  receipt: BlackRoomMetricoolReceipt | null;
  partialReceipts: Partial<Record<BlackRoomMetricoolNetwork, string>>;
  dryRunPreview: { at: string; networks: BlackRoomMetricoolNetwork[]; captions: Partial<Record<BlackRoomMetricoolNetwork, string>> } | null;
};

export type BlackRoomPublisherItem = BlackRoomTeamApproval & { payload: BlackRoomPostDraft; dispatch: BlackRoomPublisherDispatch };

export type BlackRoomPublisherState = {
  version: 1;
  items: BlackRoomPublisherItem[];
  lastRunAt: string | null;
  lastRunSummary: string | null;
};

export type BlackRoomPublisherScheduler = typeof scheduleBlackRoomMetricoolPost;
export type BlackRoomPublisherDeps = { schedule?: BlackRoomPublisherScheduler };

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function configured(env: BlackRoomTeamEnv, name: string): boolean {
  const value = String(env[name] || "").trim();
  return Boolean(value) && !/replace|example|your[-_ ]?token/i.test(value);
}

export function metricoolNeeds(env: BlackRoomTeamEnv): string[] {
  const needs: string[] = [];
  if (!configured(env, "METRICOOL_USER_TOKEN")) needs.push("Configurar METRICOOL_USER_TOKEN (token de Metricool)");
  if (!configured(env, "METRICOOL_USER_ID")) needs.push("Configurar METRICOOL_USER_ID (usuario de Metricool)");
  return needs;
}

export function metaNeeds(env: BlackRoomTeamEnv): string[] {
  const needs: string[] = [];
  if (!configured(env, BLACKROOM_PUBLISHER_META_TOKEN_ENV)) needs.push(`Configurar ${BLACKROOM_PUBLISHER_META_TOKEN_ENV} (token de Meta Graph API)`);
  if (!configured(env, BLACKROOM_PUBLISHER_META_PAGE_ENV)) needs.push(`Configurar ${BLACKROOM_PUBLISHER_META_PAGE_ENV} (pagina de Facebook de Black Room)`);
  return needs;
}

/** Every flag real scheduling needs; empty means live mode is fully enabled. */
export function liveModeNeeds(env: BlackRoomTeamEnv): string[] {
  const needs: string[] = [];
  if (env[BLACKROOM_PUBLISHER_LIVE_FLAG] !== "true") needs.push(`${BLACKROOM_PUBLISHER_LIVE_FLAG}=true (activar programacion real del publicador)`);
  const veto = blackRoomPublicationFlagVeto(env);
  if (veto === "bridge_not_authorized") needs.push("BLACKROOM_METRICOOL_BRIDGE_PUBLISH_AUTHORIZED=true (autorizar el puente de Metricool)");
  if (veto === "bridge_not_authorized" || veto === "approval_required") {
    if (env.METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH !== "false") needs.push("METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH=false (la aprobacion la da Robert en esta cola)");
  }
  return needs;
}

function isLive(env: BlackRoomTeamEnv): boolean {
  return env[BLACKROOM_PUBLISHER_LIVE_FLAG] === "true";
}

// ---------------------------------------------------------------------------
// Draft validation (deterministic, no IO)
// ---------------------------------------------------------------------------

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Google Drive / Docs viewer pages (".../file/d/<id>/view", "/open?id=", "/document/d/...") return
 * HTML, not the video: Metricool cannot download them.
 */
export function isViewerPageMediaUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  const host = url.hostname.toLowerCase();
  if (host !== "drive.google.com" && host !== "docs.google.com") return false;
  const pathname = url.pathname;
  if (/^\/(?:a\/[^/]+\/)?file\/d\/[^/]+(?:\/(?:view|edit|preview)?)?\/?$/i.test(pathname)) return true;
  if (/^\/(?:open|drive\/folders\/[^/]+|drive\/u\/\d+\/folders\/[^/]+)\/?$/i.test(pathname)) return true;
  if (/^\/(?:document|presentation|spreadsheets)\/d\//i.test(pathname)) return true;
  return false;
}

export type DraftValidation = { ok: true; draft: BlackRoomPostDraft } | { ok: false; errors: string[] };

export function validateBlackRoomPostDraft(raw: Record<string, unknown>, now: Date): DraftValidation {
  const errors: string[] = [];
  const channel: BlackRoomPublisherChannel = raw.channel === "meta" ? "meta" : "metricool";
  if (raw.channel !== undefined && raw.channel !== "metricool" && raw.channel !== "meta") errors.push("channel debe ser metricool o meta");
  const caption = typeof raw.caption === "string" ? raw.caption.trim() : "";
  if (!caption) errors.push("Falta el texto del posteo (caption)");
  else if (caption.length > 2_000) errors.push("El caption supera 2000 caracteres");
  const mediaUrl = str(raw.mediaUrl, 2_000);
  let mediaOk = false;
  try { mediaOk = Boolean(mediaUrl) && new URL(mediaUrl).protocol === "https:"; } catch { mediaOk = false; }
  if (!mediaOk) errors.push("mediaUrl debe ser un enlace https al video");
  else if (isViewerPageMediaUrl(mediaUrl)) errors.push("mediaUrl debe ser un enlace de descarga directa (el enlace de vista de Drive no sirve)");
  // Optional: recorded clips may have no full set on YouTube. When present it must be a valid id.
  const sourceVideoId = str(raw.sourceVideoId, 20);
  if (sourceVideoId && !/^[A-Za-z0-9_-]{11}$/.test(sourceVideoId)) errors.push("sourceVideoId debe ser el id de YouTube (11 caracteres) del set completo, o vacio si no hay set");
  const durationSeconds = typeof raw.durationSeconds === "number" ? raw.durationSeconds : Number(raw.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3_600) errors.push("durationSeconds debe ser un numero entre 1 y 3600");
  const videoFormat = raw.videoFormat === "horizontal" ? "horizontal" : "vertical";
  if (raw.videoFormat !== undefined && raw.videoFormat !== "vertical" && raw.videoFormat !== "horizontal") errors.push("videoFormat debe ser vertical u horizontal");
  const language = raw.language === "en" ? "en" : "es";
  const timezone = str(raw.timezone, 64) || BLACKROOM_TIMEZONE;
  const publicationDateTime = str(raw.publicationDateTime, 32);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(publicationDateTime)) errors.push("publicationDateTime debe tener el formato AAAA-MM-DDTHH:MM:SS (hora local)");
  else {
    try {
      const at = Date.parse(formatMetricoolMcpDate(publicationDateTime, timezone));
      if (!(at >= now.getTime() + BLACKROOM_PUBLISHER_MIN_LEAD_MS)) errors.push("La fecha de publicacion debe ser al menos 10 minutos en el futuro");
    } catch {
      errors.push("La fecha de publicacion no existe en esa zona horaria");
    }
  }
  const base: BlackRoomMetricoolScheduleInput = { caption: caption || "x", publicationDateTime, mediaUrl, sourceVideoId, durationSeconds, videoFormat, language, timezone };
  const eligible = blackRoomMetricoolNetworks(base);
  let networks: BlackRoomMetricoolNetwork[] = eligible;
  if (raw.networks !== undefined) {
    const list = Array.isArray(raw.networks) ? raw.networks : [];
    const picked = Array.from(new Set(list.filter((n): n is BlackRoomMetricoolNetwork => (BLACKROOM_METRICOOL_NETWORKS as readonly unknown[]).includes(n))));
    if (!picked.length || picked.length !== list.length) errors.push(`networks debe ser una lista de: ${BLACKROOM_METRICOOL_NETWORKS.join(", ")}`);
    else if (picked.some((n) => !eligible.includes(n))) errors.push("YouTube solo acepta Shorts verticales de 3 a 178 segundos");
    else networks = picked;
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      channel, caption, mediaUrl, sourceVideoId, durationSeconds, videoFormat, language, networks, publicationDateTime, timezone,
      source: str(raw.source, 60) || "manual",
      notes: str(raw.notes, 500),
    },
  };
}

export function draftId(draft: BlackRoomPostDraft): string {
  const key = [draft.channel, draft.caption, draft.mediaUrl, draft.publicationDateTime, draft.timezone, [...draft.networks].sort().join(",")].join("\n");
  return `post-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

function scheduleInput(item: BlackRoomPublisherItem): BlackRoomMetricoolScheduleInput {
  const d = item.payload;
  return {
    caption: d.caption, publicationDateTime: d.publicationDateTime, mediaUrl: d.mediaUrl, sourceVideoId: d.sourceVideoId,
    durationSeconds: d.durationSeconds, videoFormat: d.videoFormat, language: d.language, timezone: d.timezone, jobId: item.id,
  };
}

function previewCaptions(item: BlackRoomPublisherItem): Partial<Record<BlackRoomMetricoolNetwork, string>> {
  const input = scheduleInput(item);
  const captions: Partial<Record<BlackRoomMetricoolNetwork, string>> = {};
  for (const network of item.payload.networks) {
    captions[network] = network === "facebook" ? buildBlackRoomFacebookCaption(input.caption, input.sourceVideoId, input.language)
      : network === "youtube" ? buildBlackRoomYouTubeCaption(input) : input.caption;
  }
  return captions;
}

function publicationTime(item: BlackRoomPublisherItem): number {
  try { return Date.parse(formatMetricoolMcpDate(item.payload.publicationDateTime, item.payload.timezone)); } catch { return Number.NaN; }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Every read-modify-write of blackroom-publisher.json goes through this per-data-dir mutex, so a
// concurrent add (e.g. from the Scripts agent) can never overwrite a newer dispatch receipt or a
// rejection with a stale copy. The network call to Metricool runs outside the lock (so Robert can
// still reject mid-flight); its result is merged into the latest state under the lock.
const publisherLocks = new Map<string, Promise<unknown>>();

export function withPublisherLock<T>(ctx: Pick<BlackRoomTeamContext, "dataDir">, work: () => Promise<T>): Promise<T> {
  const key = path.resolve(ctx.dataDir);
  const previous = publisherLocks.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  const tail = next.catch(() => undefined);
  publisherLocks.set(key, tail);
  void tail.then(() => { if (publisherLocks.get(key) === tail) publisherLocks.delete(key); });
  return next;
}

async function loadState(ctx: BlackRoomTeamContext): Promise<BlackRoomPublisherState> {
  const raw = await ctx.state.load<BlackRoomPublisherState | null>(null);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return { version: 1, items: [], lastRunAt: null, lastRunSummary: null };
  return { version: 1, items: raw.items, lastRunAt: raw.lastRunAt ?? null, lastRunSummary: raw.lastRunSummary ?? null };
}

function freshDispatch(): BlackRoomPublisherDispatch {
  return { state: "none", attempts: 0, updatedAt: null, lastError: null, receipt: null, partialReceipts: {}, dryRunPreview: null };
}

/** Dispatched (or possibly dispatched) items are frozen: they can never be edited, removed or sent again. */
function isFrozen(item: BlackRoomPublisherItem): boolean {
  return item.dispatch.state === "scheduled" || item.dispatch.state === "uncertain" || item.dispatch.state === "dispatching";
}

function fail(summary: string, error: string): BlackRoomTeamRunResult {
  return { ok: false, summary, error };
}

function findItem(state: BlackRoomPublisherState, input: Record<string, unknown>): BlackRoomPublisherItem | null {
  const id = typeof input.id === "string" ? input.id : "";
  return state.items.find((item) => item.id === id) || null;
}

// ---------------------------------------------------------------------------
// Dispatch (the only code path that can reach Metricool)
// ---------------------------------------------------------------------------

type DispatchOutcome = { ok: boolean; message: string; item: BlackRoomPublisherItem; sent: boolean };

async function dispatchItem(
  ctx: BlackRoomTeamContext,
  id: string,
  schedule: BlackRoomPublisherScheduler,
  mode: "schedule" | "verify",
): Promise<DispatchOutcome | null> {
  const prepared = await withPublisherLock(ctx, () => prepareDispatch(ctx, id, mode));
  if (!prepared || "outcome" in prepared) return prepared ? prepared.outcome : null;
  const { item } = prepared;
  return sendPrepared(ctx, id, item, schedule, mode);
}

/** Pre-IO checks and the persisted "dispatching" intent; runs under the publisher lock. */
async function prepareDispatch(
  ctx: BlackRoomTeamContext,
  id: string,
  mode: "schedule" | "verify",
): Promise<{ outcome: DispatchOutcome } | { item: BlackRoomPublisherItem } | null> {
  const wrap = (outcome: DispatchOutcome) => ({ outcome });
  const state = await loadState(ctx);
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return null;
  const now = ctx.now();
  const stamp = now.toISOString();
  const save = async () => { item.dispatch.updatedAt = stamp; await ctx.state.save(state); };

  if (item.status !== "approved") return wrap({ ok: false, message: "Solo se programan posteos aprobados por Robert.", item, sent: false });
  if (item.dispatch.state === "scheduled" && item.dispatch.receipt) return wrap({ ok: true, message: "Ya estaba programado; no se vuelve a enviar.", item, sent: false });
  if (mode === "schedule" && (item.dispatch.state === "uncertain" || item.dispatch.state === "dispatching")) {
    return wrap({ ok: false, message: "Resultado incierto en un envio anterior: usa la accion verify antes de reintentar.", item, sent: false });
  }
  if (mode === "verify" && item.dispatch.state !== "uncertain" && item.dispatch.state !== "dispatching") {
    return wrap({ ok: false, message: "Este posteo no tiene un envio pendiente de verificar.", item, sent: false });
  }
  if (item.payload.channel === "meta") {
    item.dispatch.state = "dry-run";
    item.dispatch.dryRunPreview = { at: stamp, networks: item.payload.networks, captions: previewCaptions(item) };
    item.dispatch.lastError = metaNeeds(ctx.env).length
      ? `Meta no configurado: ${metaNeeds(ctx.env).join("; ")}`
      : "La programacion directa en Meta no esta habilitada; usa el canal metricool.";
    await save();
    return wrap({ ok: false, message: item.dispatch.lastError, item, sent: false });
  }
  if (mode === "schedule" && !(publicationTime(item) >= now.getTime() + BLACKROOM_PUBLISHER_MIN_LEAD_MS)) {
    item.dispatch.lastError = "La fecha de publicacion ya paso o esta muy cerca; cambia la fecha.";
    await save();
    return wrap({ ok: false, message: item.dispatch.lastError, item, sent: false });
  }
  if (!isLive(ctx.env)) {
    if (mode === "verify") return wrap({ ok: false, message: `Modo simulacion: verificar requiere ${BLACKROOM_PUBLISHER_LIVE_FLAG}=true.`, item, sent: false });
    item.dispatch.state = "dry-run";
    item.dispatch.dryRunPreview = { at: stamp, networks: item.payload.networks, captions: previewCaptions(item) };
    item.dispatch.lastError = null;
    await save();
    return wrap({ ok: true, message: "Simulacion: no se envio nada a Metricool.", item, sent: false });
  }
  const flagVeto = blackRoomPublicationFlagVeto(ctx.env);
  const missing = metricoolNeeds(ctx.env);
  if (flagVeto || missing.length) {
    if (mode === "schedule") item.dispatch.state = "blocked";
    item.dispatch.lastError = flagVeto ? `Bloqueado por el guardia de publicacion: ${flagVeto}` : missing.join("; ");
    await save();
    return wrap({ ok: false, message: item.dispatch.lastError, item, sent: false });
  }

  // Persist intent before any IO: a crash from here on leaves the item "dispatching", which is
  // never retried automatically (only verified).
  if (mode === "schedule") item.dispatch.state = "dispatching";
  item.dispatch.attempts += 1;
  item.dispatch.lastError = null;
  await save();
  return { item };
}

async function sendPrepared(
  ctx: BlackRoomTeamContext,
  id: string,
  item: BlackRoomPublisherItem,
  schedule: BlackRoomPublisherScheduler,
  mode: "schedule" | "verify",
): Promise<DispatchOutcome> {

  // Authoritative control re-read before each IO step inside the bridge: if Robert rejects the
  // item or the live flag is turned off mid-flight, the bridge stops.
  const readPublicationControl = async (): Promise<BlackRoomPublicationControl> => {
    const current = (await loadState(ctx)).items.find((entry) => entry.id === id);
    const eligible = current?.status === "approved" && (current.dispatch.state === "dispatching" || current.dispatch.state === "uncertain");
    return {
      desiredEnabled: isLive(ctx.env),
      queue: { enabled: true, jobs: eligible ? [{ id, status: "processing" }] : [] },
    };
  };

  const finish = (mutate: (target: BlackRoomPublisherItem) => void) => withPublisherLock(ctx, async () => {
    const latest = await loadState(ctx);
    const target = latest.items.find((entry) => entry.id === id) || item;
    if (!latest.items.includes(target)) latest.items.push(target);
    mutate(target);
    target.dispatch.updatedAt = ctx.now().toISOString();
    await ctx.state.save(latest);
    return target;
  });

  try {
    const receipt = await schedule(scheduleInput(item), {
      env: ctx.env as NodeJS.ProcessEnv,
      fetch: ctx.fetch,
      now: ctx.now,
      networks: item.payload.networks,
      verifyOnly: mode === "verify",
      readPublicationControl,
    });
    const target = await finish((entry) => {
      entry.dispatch.state = "scheduled";
      entry.dispatch.receipt = receipt;
      entry.dispatch.partialReceipts = { ...receipt.platformReceipts };
      entry.dryRun = false;
    });
    return { ok: true, message: `Programado en Metricool (${item.payload.networks.join(", ")}).`, item: target, sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
    if (error instanceof BlackRoomPublicationBlockedError) {
      // Definitely not submitted: safe to retry later.
      const target = await finish((entry) => {
        entry.dispatch.state = mode === "verify" ? entry.dispatch.state : "blocked";
        entry.dispatch.lastError = `Bloqueado antes de enviar: ${error.reason}`;
      });
      return { ok: false, message: target.dispatch.lastError!, item: target, sent: false };
    }
    const partial = error instanceof BlackRoomMetricoolUncertainError ? error.platformReceipts : {};
    const target = await finish((entry) => {
      entry.dispatch.state = "uncertain";
      entry.dispatch.partialReceipts = { ...entry.dispatch.partialReceipts, ...partial };
      entry.dispatch.lastError = `Resultado incierto, revisar en Metricool: ${message}`;
    });
    return { ok: false, message: target.dispatch.lastError!, item: target, sent: true };
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

function counts(items: BlackRoomPublisherItem[]) {
  return {
    pendientes: items.filter((i) => i.status === "pending").length,
    aprobados: items.filter((i) => i.status === "approved" && !isFrozen(i)).length,
    programados: items.filter((i) => i.dispatch.state === "scheduled").length,
    inciertos: items.filter((i) => i.dispatch.state === "uncertain" || i.dispatch.state === "dispatching").length,
    rechazados: items.filter((i) => i.status === "rejected").length,
  };
}

export function createBlackRoomPublisherAgent(deps: BlackRoomPublisherDeps = {}): BlackRoomTeamAgentModule {
  const schedule = deps.schedule ?? scheduleBlackRoomMetricoolPost;

  async function getStatus(ctx: BlackRoomTeamContext): Promise<BlackRoomTeamStatus> {
    const state = await loadState(ctx);
    const c = counts(state.items);
    const live = isLive(ctx.env);
    const metricoolMissing = metricoolNeeds(ctx.env);
    const metaMissing = metaNeeds(ctx.env);
    const metrics: Record<string, number | string> = {
      modo: live && !liveModeNeeds(ctx.env).length ? "real" : "simulacion",
      metricool: metricoolMissing.length ? "sin configurar" : "configurado",
      meta: metaMissing.length ? "sin configurar" : "configurado (solo vista previa)",
      ...c,
    };
    const base = { id: ID, lastRunAt: state.lastRunAt, metrics, pendingApprovals: c.pendientes };
    const queueText = `${c.pendientes} por aprobar, ${c.aprobados} aprobados, ${c.programados} programados`;

    if (metricoolMissing.length) {
      return { ...base, state: "blocked", label: "Falta conectar Metricool", summary: `No puedo programar sin Metricool. Cola: ${queueText}.`, needs: [...metricoolMissing, ...(metaMissing.length ? [`Opcional (Meta): ${metaMissing.join("; ")}`] : [])] };
    }
    if (c.inciertos) {
      return { ...base, state: "blocked", label: "Posteo con resultado incierto", summary: `${c.inciertos} posteo(s) pudieron haberse enviado: hay que verificarlos en Metricool. Cola: ${queueText}.`, needs: [`Verificar ${c.inciertos} posteo(s) con la accion verify o revisarlos en Metricool`] };
    }
    const liveMissing = liveModeNeeds(ctx.env);
    if (c.aprobados && liveMissing.length) {
      return { ...base, state: "blocked", label: "Aprobados esperando modo real", summary: `${c.aprobados} posteo(s) aprobados solo se simulan hasta activar la publicacion real. Cola: ${queueText}.`, needs: liveMissing };
    }
    const runAt = state.lastRunAt ? Date.parse(state.lastRunAt) : Number.NaN;
    const now = ctx.now().getTime();
    const fresh = Number.isFinite(runAt) && runAt <= now && now - runAt <= BLACKROOM_TEAM_WORKING_FRESH_MS;
    const modeText = liveMissing.length ? "Modo simulacion (nada se publica)." : "Modo real: solo programa lo aprobado.";
    if (fresh) return { ...base, state: "working", label: "Cola revisada", summary: `${state.lastRunSummary || "Cola revisada."} ${modeText}`.trim(), needs: [] };
    return { ...base, state: "available", label: c.pendientes ? `${c.pendientes} posteo(s) por aprobar` : "Listo para recibir posteos", summary: `${modeText} Cola: ${queueText}.`, needs: [] };
  }

  async function run(ctx: BlackRoomTeamContext, input: Record<string, unknown> = {}): Promise<BlackRoomTeamRunResult> {
    void input;
    const initial = await loadState(ctx);
    const now = ctx.now();
    const results: Array<{ id: string; ok: boolean; message: string }> = [];
    const candidates = initial.items.filter((item) => item.status === "approved" && item.payload.channel === "metricool" && !isFrozen(item));
    for (const item of candidates) {
      const outcome = await dispatchItem(ctx, item.id, schedule, "schedule");
      if (outcome) results.push({ id: item.id, ok: outcome.ok, message: outcome.message });
    }
    return withPublisherLock(ctx, async () => {
    const state = await loadState(ctx);
    const c = counts(state.items);
    const overdue = state.items.filter((item) => item.status === "pending" && !(publicationTime(item) >= now.getTime())).length;
    const summary = [
      `Cola revisada: ${c.pendientes} por aprobar, ${c.programados} programados.`,
      candidates.length ? `${results.filter((r) => r.ok).length}/${candidates.length} aprobados procesados${isLive(ctx.env) ? "" : " en simulacion"}.` : "",
      overdue ? `${overdue} pendiente(s) con fecha vencida: cambia la fecha o rechazalos.` : "",
      c.inciertos ? `${c.inciertos} con resultado incierto por verificar.` : "",
    ].filter(Boolean).join(" ");
    state.lastRunAt = ctx.now().toISOString();
    state.lastRunSummary = summary;
    await ctx.state.save(state);
    return {
      ok: results.every((r) => r.ok),
      summary,
      report: { counts: c, overdue, dispatched: results, mode: isLive(ctx.env) ? "real" : "simulacion" },
      needsApproval: state.items.filter((item) => item.status === "pending"),
    };
    });
  }

  const actions: Record<string, BlackRoomTeamActionHandler> = {
    async list(ctx, input) {
      const state = await loadState(ctx);
      const filter = typeof input.status === "string" ? input.status : null;
      const items = state.items.filter((item) => !filter || item.status === filter || item.dispatch.state === filter);
      return { ok: true, summary: `${items.length} posteo(s) en la cola.`, report: { items, counts: counts(state.items) } };
    },

    async add(ctx, input) {
      const raw = input.draft && typeof input.draft === "object" && !Array.isArray(input.draft) ? input.draft as Record<string, unknown> : input;
      const validation = validateBlackRoomPostDraft(raw, ctx.now());
      if (!validation.ok) return { ok: false, summary: `Borrador invalido: ${validation.errors.join("; ")}`, error: "invalid_draft", report: { errors: validation.errors } };
      const draft = validation.draft;
      const state = await loadState(ctx);
      const id = draftId(draft);
      const existing = state.items.find((item) => item.id === id);
      if (existing) return { ok: true, summary: "Ese posteo ya estaba en la cola; no se duplico.", report: { item: existing }, needsApproval: existing.status === "pending" ? [existing] : [] };
      if (state.items.filter((item) => item.status === "pending").length >= MAX_ITEMS) return fail("La cola tiene demasiados posteos pendientes.", "queue_full");
      const item: BlackRoomPublisherItem = {
        id,
        agentId: ID,
        kind: draft.channel === "meta" ? "meta-post" : "metricool-post",
        title: `Posteo ${draft.networks.join("/")} ${draft.publicationDateTime.replace("T", " ").slice(0, 16)}`,
        summary: draft.caption.replace(/\s+/g, " ").slice(0, 160),
        payload: draft,
        createdAt: ctx.now().toISOString(),
        status: "pending",
        decidedAt: null,
        dryRun: true,
        dispatch: freshDispatch(),
      };
      state.items.push(item);
      // Keep the file bounded: drop the oldest finished items first, never pending/approved/uncertain ones.
      while (state.items.length > MAX_ITEMS) {
        const index = state.items.findIndex((entry) => entry.status === "rejected" || entry.dispatch.state === "scheduled");
        if (index < 0) break;
        state.items.splice(index, 1);
      }
      await ctx.state.save(state);
      return { ok: true, summary: "Posteo agregado a la cola; espera la aprobacion de Robert.", report: { item }, needsApproval: [item] };
    },

    async update(ctx, input) {
      const state = await loadState(ctx);
      const item = findItem(state, input);
      if (!item) return fail("No encontre ese posteo.", "not_found");
      if (isFrozen(item)) return fail("Ese posteo ya se envio (o pudo enviarse); no se puede editar.", "frozen");
      const validation = validateBlackRoomPostDraft({ ...item.payload, ...(input.changes && typeof input.changes === "object" ? input.changes as Record<string, unknown> : {}) }, ctx.now());
      if (!validation.ok) return { ok: false, summary: `Cambios invalidos: ${validation.errors.join("; ")}`, error: "invalid_draft", report: { errors: validation.errors } };
      item.payload = validation.draft;
      item.summary = validation.draft.caption.replace(/\s+/g, " ").slice(0, 160);
      item.title = `Posteo ${validation.draft.networks.join("/")} ${validation.draft.publicationDateTime.replace("T", " ").slice(0, 16)}`;
      // Any edit requires a fresh approval.
      item.status = "pending";
      item.decidedAt = null;
      item.decidedBy = null;
      item.dryRun = true;
      item.dispatch = freshDispatch();
      await ctx.state.save(state);
      return { ok: true, summary: "Posteo actualizado; vuelve a esperar aprobacion.", report: { item }, needsApproval: [item] };
    },

    async approve(ctx, input) {
      const state = await loadState(ctx);
      const item = findItem(state, input);
      if (!item) return fail("No encontre ese posteo.", "not_found");
      if (item.status === "approved") return { ok: true, summary: "Ya estaba aprobado.", report: { item } };
      if (item.status !== "pending") return fail("Solo se aprueban posteos pendientes.", "not_pending");
      if (!(publicationTime(item) >= ctx.now().getTime() + BLACKROOM_PUBLISHER_MIN_LEAD_MS)) return fail("La fecha de publicacion ya paso o esta muy cerca; edita la fecha antes de aprobar.", "past_due");
      item.status = "approved";
      item.decidedAt = ctx.now().toISOString();
      item.decidedBy = ctx.actor ?? null;
      await ctx.state.save(state);
      const live = isLive(ctx.env) && !liveModeNeeds(ctx.env).length;
      return { ok: true, summary: live ? "Aprobado. Se programara en la proxima revision de la cola." : "Aprobado. En modo simulacion: no se publicara hasta activar la publicacion real.", report: { item } };
    },

    async reject(ctx, input) {
      const state = await loadState(ctx);
      const item = findItem(state, input);
      if (!item) return fail("No encontre ese posteo.", "not_found");
      if (isFrozen(item)) return fail("Ese posteo ya se envio (o pudo enviarse) a Metricool; cancelalo alli.", "frozen");
      item.status = "rejected";
      item.decidedAt = ctx.now().toISOString();
      item.decidedBy = ctx.actor ?? null;
      item.dryRun = true;
      await ctx.state.save(state);
      return { ok: true, summary: "Posteo rechazado; no se publicara.", report: { item } };
    },

    async remove(ctx, input) {
      const state = await loadState(ctx);
      const item = findItem(state, input);
      if (!item) return fail("No encontre ese posteo.", "not_found");
      if (isFrozen(item) || item.status === "approved") return fail("Solo se eliminan posteos pendientes o rechazados que no se enviaron.", "not_removable");
      state.items = state.items.filter((entry) => entry !== item);
      await ctx.state.save(state);
      return { ok: true, summary: "Posteo eliminado de la cola." };
    },

    async schedule(ctx, input) {
      const outcome = await dispatchItem(ctx, typeof input.id === "string" ? input.id : "", schedule, "schedule");
      if (!outcome) return fail("No encontre ese posteo.", "not_found");
      return { ok: outcome.ok, summary: outcome.message, report: { item: outcome.item }, ...(outcome.ok ? {} : { error: outcome.item.dispatch.state }) };
    },

    async verify(ctx, input) {
      const outcome = await dispatchItem(ctx, typeof input.id === "string" ? input.id : "", schedule, "verify");
      if (!outcome) return fail("No encontre ese posteo.", "not_found");
      return { ok: outcome.ok, summary: outcome.message, report: { item: outcome.item }, ...(outcome.ok ? {} : { error: outcome.item.dispatch.state }) };
    },
  };

  // Queue mutations are serialized with dispatches and run() (see withPublisherLock).
  for (const name of ["add", "update", "approve", "reject", "remove"] as const) {
    const handler = actions[name];
    actions[name] = (ctx, input) => withPublisherLock(ctx, () => handler(ctx, input));
  }

  return { id: ID, getStatus, run, actions };
}

const agent = createBlackRoomPublisherAgent();
export default agent;
