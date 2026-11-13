// Guiones y Edicion Black Room (id "blackroom-scripts").
//
// Two flows:
// 1. Ideas + guiones: deterministic templates (hook, beats, on-screen text, shot list, caption, CTA)
//    for 15/30/60 s, grounded on the analytics and competition teammates' last reports (read-only)
//    and on Robert's style guide (docs/blackroom-video-style.md, injected when it is marked "listo").
//    No LLM call: each script carries a compact prompt Robert can paste into his subscription.
// 2. Video grabado -> video editado: Robert sends a Google Drive file (or a file already in the
//    local inbox). An edit job is persisted and rendered by the EXISTING radio pipeline
//    (processDriveRadioVideoFile / processRadioVideo in server/radio-video-edit-agent.ts), one job
//    per run, only when BLACKROOM_SCRIPTS_RENDER_ENABLED=true (otherwise only the plan is built).
//    Finished vertical clips go to the Publicador's approval queue as pending dry-run drafts.
//
// Safety: this agent never publishes, posts or contacts anyone. Its only outward step is adding a
// draft to the Publicador queue, where Robert still has to approve it.
import path from "node:path";
import {
  BLACKROOM_TEAM_WORKING_FRESH_MS,
  type BlackRoomTeamActionHandler,
  type BlackRoomTeamAgentId,
  type BlackRoomTeamAgentModule,
  type BlackRoomTeamApproval,
  type BlackRoomTeamContext,
  type BlackRoomTeamRunResult,
  type BlackRoomTeamStatus,
} from "@shared/blackroom-team";
import { BLACKROOM_DURATION_VARIANTS, BLACKROOM_SOURCE_DIRECTORY } from "../blackroom-content-agent";
import { BLACKROOM_TIMEZONE } from "../blackroom-metricool-bridge";
import { extractGoogleDriveFileIdFromUrl } from "../google-drive-file-url";
import type { RadioVideoProcessResult } from "../radio-video-edit-agent";
import { createBlackRoomTeamStateStore, readBlackRoomTeamState } from "./state";
import { classifyBlackRoomRenderFailure, type BlackRoomEditJobFailureKind } from "./edit-job-failure";
import publisherAgent, { isViewerPageMediaUrl } from "./blackroom-publisher";
import {
  BLACKROOM_SCRIPT_DURATIONS,
  EMPTY_GROUNDING,
  buildBlackRoomScriptHandoffPrompt,
  buildBlackRoomVideoScripts,
  type BlackRoomScriptDuration,
  type BlackRoomScriptGrounding,
  type BlackRoomVideoScript,
} from "./blackroom-scripts/ideas";
import {
  defaultBlackRoomStyleGuideReader,
  loadBlackRoomVideoStyleGuide,
  type BlackRoomStyleGuideReader,
  type BlackRoomVideoStyleGuide,
} from "./blackroom-scripts/style-guide";

const ID = "blackroom-scripts" as const;

export const BLACKROOM_SCRIPTS_RENDER_FLAG = "BLACKROOM_SCRIPTS_RENDER_ENABLED";
/** Local inboxes a raw video may come from (relative to the workspace root). */
export const BLACKROOM_SCRIPTS_LOCAL_INBOXES = ["radio_video_edits/01_originales", BLACKROOM_SOURCE_DIRECTORY] as const;
export const BLACKROOM_SCRIPTS_OUTPUT_DIR = "clippers_workspace/blackroom/rendered/scripts-agent";
export const BLACKROOM_SCRIPTS_DRIVE_OUTPUT_PATH = ["Videos de Black Room", "Editados por agente"] as const;
/** A job left in "rendering" this long (server restart mid-render) is marked failed, never auto-retried. */
export const BLACKROOM_SCRIPTS_STALE_RENDER_MS = 3 * 60 * 60_000;
const MAX_IDEAS = 30;
const MAX_OPEN_JOBS = 20;
const MAX_JOBS = 60;
const MAX_DRAFTS = 60;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

// The scripts flow uses the content agent's short-form variants (15/30/60 s).
const SHORT_DURATIONS = BLACKROOM_DURATION_VARIANTS.filter((d): d is BlackRoomScriptDuration => (BLACKROOM_SCRIPT_DURATIONS as readonly number[]).includes(d));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type BlackRoomEditJobStatus = "queued" | "rendering" | "needs_dj_name" | "completed" | "failed" | "cancelled";

export type BlackRoomEditJobSource =
  | { kind: "drive"; fileId: string; url: string | null }
  | { kind: "local"; path: string };

export type BlackRoomEditClip = {
  kind: string;
  path: string;
  durationSeconds: number;
  width: number;
  height: number;
  driveWebViewLink: string | null;
};

export type BlackRoomEditPlanPreview = {
  dryRun: boolean;
  pipeline: string;
  outputs: string[];
  durations: number[];
  driveOutputPath: string[] | null;
  outputDir: string;
  steps: string[];
};

export type { BlackRoomEditJobFailureKind } from "./edit-job-failure";

export type BlackRoomEditJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: BlackRoomEditJobSource;
  djName: string | null;
  ideaId: string | null;
  sourceVideoId: string | null;
  publicationDateTime: string | null;
  caption: string | null;
  language: "es" | "en";
  notes: string;
  status: BlackRoomEditJobStatus;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** Set when status is "failed"; older jobs may not have it (inferred from the error). */
  failureKind?: BlackRoomEditJobFailureKind | null;
  pendingActionId: string | null;
  plan: BlackRoomEditPlanPreview | null;
  clips: BlackRoomEditClip[];
  /** Publicador queue item ids this job's clips were handed to. */
  publisherItemIds: string[];
};

export type BlackRoomVideoDraftPayload = {
  jobId: string;
  clipPath: string;
  clipKind: string;
  durationSeconds: number;
  videoFormat: "vertical" | "horizontal";
  language: "es" | "en";
  caption: string;
  mediaUrl: string | null;
  sourceVideoId: string | null;
  publicationDateTime: string | null;
  missing: string[];
  publisherItemId: string | null;
  publisherError: string | null;
};

export type BlackRoomVideoDraft = BlackRoomTeamApproval & { payload: BlackRoomVideoDraftPayload };

export type BlackRoomScriptsState = {
  version: 1;
  lastRunAt: string | null;
  lastRunSummary: string | null;
  ideas: BlackRoomVideoScript[];
  ideasGeneratedAt: string | null;
  jobs: BlackRoomEditJob[];
  /** Finished clips that still need data from Robert before entering the Publicador queue. */
  drafts: BlackRoomVideoDraft[];
};

export const EMPTY_SCRIPTS_STATE: BlackRoomScriptsState = { version: 1, lastRunAt: null, lastRunSummary: null, ideas: [], ideasGeneratedAt: null, jobs: [], drafts: [] };

// ---------------------------------------------------------------------------
// Dependencies (all injectable for offline tests)
// ---------------------------------------------------------------------------

export type BlackRoomRenderOutcome = {
  status: "completed" | "needs_dj_name" | "failed" | "queued";
  clips?: BlackRoomEditClip[];
  error?: string;
  pendingActionId?: string;
};

export type BlackRoomEditRenderer = (job: BlackRoomEditJob, options: { userId: string; workspaceRoot: string }) => Promise<BlackRoomRenderOutcome>;

export type BlackRoomScriptsDeps = {
  readStyleGuide?: BlackRoomStyleGuideReader;
  /** Read-only access to a teammate's persisted state (analytics / competition reports). */
  readTeammateState?: (ctx: BlackRoomTeamContext, id: BlackRoomTeamAgentId) => Promise<unknown>;
  render?: BlackRoomEditRenderer;
  publisher?: BlackRoomTeamAgentModule;
  publisherContext?: (ctx: BlackRoomTeamContext) => BlackRoomTeamContext;
  workspaceRoot?: string;
};

function toClips(result: Pick<RadioVideoProcessResult, "clips">): BlackRoomEditClip[] {
  return (result.clips || []).map((clip) => ({
    kind: clip.kind,
    path: clip.path,
    durationSeconds: clip.durationSeconds,
    width: clip.width,
    height: clip.height,
    driveWebViewLink: clip.driveWebViewLink || null,
  }));
}

/** Reuses the existing radio edit pipeline (drop detection, OCR DJ name, ffmpeg render, Drive upload). */
export const defaultBlackRoomEditRenderer: BlackRoomEditRenderer = async (job, { userId, workspaceRoot }) => {
  const radio = await import("../radio-video-edit-agent");
  const outputDir = path.resolve(workspaceRoot, BLACKROOM_SCRIPTS_OUTPUT_DIR, job.id);
  if (job.source.kind === "drive") {
    const result = await radio.processDriveRadioVideoFile({
      userId,
      sourceDriveFileId: job.source.fileId,
      sourceDriveUrl: job.source.url || undefined,
      driveFolderPath: [...BLACKROOM_SCRIPTS_DRIVE_OUTPUT_PATH],
      // Output folder lives in Robert's own Drive; creating it is internal (nothing is shared).
      createFolderIfMissing: true,
      outputDir,
      djName: job.djName || undefined,
      instagramClipCount: 1,
      tiktokClipCount: 1,
      // Only the downloaded local copy is removed; the original stays in Robert's Drive.
      deleteSourceAfterSuccess: true,
    });
    return { status: result.status === "completed" ? "completed" : result.status === "needs_dj_name" ? "needs_dj_name" : result.status === "queued" ? "queued" : "failed", clips: toClips(result), error: result.error, pendingActionId: result.pendingActionId };
  }
  const result = await radio.processRadioVideo({
    userId,
    videoPath: path.resolve(workspaceRoot, job.source.path),
    outputDir,
    djName: job.djName || undefined,
    instagramClipCount: 1,
    tiktokClipCount: 1,
    deleteSourceAfterSuccess: false,
  });
  return { status: result.status === "completed" ? "completed" : result.status === "needs_dj_name" ? "needs_dj_name" : "failed", clips: toClips(result), error: result.error, pendingActionId: result.pendingActionId };
};

function defaultPublisherContext(ctx: BlackRoomTeamContext): BlackRoomTeamContext {
  return { ...ctx, agentId: "blackroom-publisher", state: createBlackRoomTeamStateStore(ctx.dataDir, "blackroom-publisher"), readTeammateStatus: async () => null };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(summary: string, error: string, report?: unknown): BlackRoomTeamRunResult {
  return { ok: false, summary, error, ...(report !== undefined ? { report } : {}) };
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

function isRenderEnabled(ctx: BlackRoomTeamContext): boolean {
  return String(ctx.env[BLACKROOM_SCRIPTS_RENDER_FLAG] || "").trim().toLowerCase() === "true";
}

function isFresh(iso: string | null, now: number): boolean {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) && at <= now && now - at <= BLACKROOM_TEAM_WORKING_FRESH_MS;
}

function newId(prefix: string, now: Date, salt: string): string {
  let h = 0;
  for (const char of `${now.toISOString()}|${salt}`) h = ((h * 31) + char.charCodeAt(0)) >>> 0;
  return `${prefix}-${now.getTime().toString(36)}-${h.toString(36)}`;
}

function normalizeState(raw: unknown): BlackRoomScriptsState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return structuredClone(EMPTY_SCRIPTS_STATE);
  const body = raw as Partial<BlackRoomScriptsState>;
  return {
    version: 1,
    lastRunAt: typeof body.lastRunAt === "string" ? body.lastRunAt : null,
    lastRunSummary: typeof body.lastRunSummary === "string" ? body.lastRunSummary : null,
    ideas: Array.isArray(body.ideas) ? body.ideas.slice(-MAX_IDEAS) : [],
    ideasGeneratedAt: typeof body.ideasGeneratedAt === "string" ? body.ideasGeneratedAt : null,
    jobs: Array.isArray(body.jobs) ? body.jobs : [],
    drafts: Array.isArray(body.drafts) ? body.drafts : [],
  };
}

/** Marks renders interrupted by a restart as failed (no automatic retry: Robert decides). */
function recoverStaleJobs(state: BlackRoomScriptsState, now: Date): number {
  let recovered = 0;
  for (const job of state.jobs) {
    if (job.status !== "rendering") continue;
    const started = job.startedAt ? Date.parse(job.startedAt) : Number.NaN;
    if (Number.isFinite(started) && now.getTime() - started < BLACKROOM_SCRIPTS_STALE_RENDER_MS) continue;
    job.status = "failed";
    job.failureKind = "interrupted";
    job.error = "El render se interrumpio (posible reinicio del servidor). Usa retry-edit-job para intentarlo de nuevo.";
    job.finishedAt = now.toISOString();
    job.updatedAt = now.toISOString();
    recovered += 1;
  }
  return recovered;
}

function trimJobs(state: BlackRoomScriptsState): void {
  while (state.jobs.length > MAX_JOBS) {
    const index = state.jobs.findIndex((job) => job.status === "completed" || job.status === "cancelled" || job.status === "failed");
    if (index < 0) break;
    state.jobs.splice(index, 1);
  }
  while (state.drafts.length > MAX_DRAFTS) {
    const index = state.drafts.findIndex((draft) => draft.status !== "pending");
    if (index < 0) break;
    state.drafts.splice(index, 1);
  }
}

function counts(state: BlackRoomScriptsState) {
  const by = (status: BlackRoomEditJobStatus) => state.jobs.filter((job) => job.status === status).length;
  return {
    ideas: state.ideas.length,
    enCola: by("queued"),
    renderizando: by("rendering"),
    faltaDj: by("needs_dj_name"),
    listos: by("completed"),
    fallidos: by("failed"),
    borradoresPendientes: state.drafts.filter((draft) => draft.status === "pending").length,
  };
}

function resolveLocalSource(workspaceRoot: string, raw: string): { ok: true; path: string } | { ok: false; error: string } {
  const candidate = path.resolve(workspaceRoot, raw);
  if (!VIDEO_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return { ok: false, error: "El video debe ser .mp4, .mov o .m4v" };
  for (const inbox of BLACKROOM_SCRIPTS_LOCAL_INBOXES) {
    const root = path.resolve(workspaceRoot, inbox);
    if (candidate.startsWith(`${root}${path.sep}`)) return { ok: true, path: path.relative(workspaceRoot, candidate) };
  }
  return { ok: false, error: `El video local debe estar dentro de ${BLACKROOM_SCRIPTS_LOCAL_INBOXES.join(" o ")}` };
}

function buildPlan(job: BlackRoomEditJob, renderEnabled: boolean): BlackRoomEditPlanPreview {
  return {
    dryRun: !renderEnabled,
    pipeline: "radio-video-edit-agent (deteccion del drop, nombre del DJ por OCR, render ffmpeg)",
    outputs: ["Vertical 9:16 1080x1920 de 30s (TikTok/Reels/Shorts)", "Horizontal 60s (Instagram)"],
    durations: SHORT_DURATIONS,
    driveOutputPath: job.source.kind === "drive" ? [...BLACKROOM_SCRIPTS_DRIVE_OUTPUT_PATH] : null,
    outputDir: `${BLACKROOM_SCRIPTS_OUTPUT_DIR}/${job.id}`,
    steps: [
      job.source.kind === "drive" ? "Descargar el video de Google Drive (el original no se toca)" : `Leer ${job.source.path}`,
      "Detectar el mejor drop por energia del audio",
      job.djName ? `Usar el nombre del DJ: ${job.djName}` : "Detectar el nombre del DJ por OCR (si no aparece, pedirlo a Robert)",
      "Renderizar los clips vertical y horizontal",
      job.source.kind === "drive" ? `Subir los clips a Drive: ${BLACKROOM_SCRIPTS_DRIVE_OUTPUT_PATH.join("/")}` : "Guardar los clips en la carpeta local de salida",
      "Pasar los clips verticales al Publicador como borrador pendiente (no se publica nada)",
    ],
  };
}

function draftMissing(payload: Pick<BlackRoomVideoDraftPayload, "mediaUrl" | "sourceVideoId" | "publicationDateTime">): string[] {
  const missing: string[] = [];
  if (!payload.mediaUrl || !/^https:\/\//i.test(payload.mediaUrl) || isViewerPageMediaUrl(payload.mediaUrl)) missing.push("mediaUrl: enlace https de descarga directa al clip editado (el enlace de vista de Drive no sirve)");
  // Optional: clips recorded without a YouTube set go out without the "set completo" link.
  if (payload.sourceVideoId && !/^[A-Za-z0-9_-]{11}$/.test(payload.sourceVideoId)) missing.push("sourceVideoId: id de YouTube (11 caracteres) del set completo, o dejalo vacio si no hay set");
  if (!payload.publicationDateTime || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(payload.publicationDateTime)) missing.push("publicationDateTime: fecha y hora local AAAA-MM-DDTHH:MM:SS");
  return missing;
}

function defaultCaption(job: BlackRoomEditJob, ideas: BlackRoomVideoScript[]): string {
  if (job.caption) return job.caption;
  const idea = job.ideaId ? ideas.find((candidate) => candidate.id === job.ideaId) : undefined;
  if (idea) return `${idea.caption} ${idea.hashtags.join(" ")}`.trim();
  return `${job.djName ? `${job.djName} en ` : ""}Black Room. #BlackRoom`;
}

// ---------------------------------------------------------------------------
// Grounding (read-only teammates)
// ---------------------------------------------------------------------------

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const DURATION_BUCKETS: Record<string, BlackRoomScriptDuration> = { "hasta 15s": 15, "16-30s": 30, "31-60s": 60 };

/** Defensive read of the analytics/competition reports (their schemas are owned by those agents). */
export function groundingFromTeammates(analyticsState: unknown, competitionState: unknown): BlackRoomScriptGrounding {
  const grounding: BlackRoomScriptGrounding = structuredClone(EMPTY_GROUNDING);
  const analyticsReport = obj(obj(analyticsState)?.lastReport);
  const networks = obj(analyticsReport?.networks);
  if (networks) {
    let bestDuration: { d: BlackRoomScriptDuration; views: number } | null = null;
    let bestHour: { label: string; views: number } | null = null;
    for (const network of Object.values(networks)) {
      const report = obj(network);
      for (const bucket of Array.isArray(report?.bestDurations) ? report!.bestDurations as unknown[] : []) {
        const b = obj(bucket);
        const d = DURATION_BUCKETS[String(b?.label || "")];
        const views = Number(b?.medianViews);
        if (d && Number.isFinite(views) && (!bestDuration || views > bestDuration.views)) bestDuration = { d, views };
      }
      const hour = obj(Array.isArray(report?.bestHours) ? (report!.bestHours as unknown[])[0] : null);
      const views = Number(hour?.medianViews);
      if (typeof hour?.label === "string" && /^\d{2}:00$/.test(hour.label) && Number.isFinite(views) && (!bestHour || views > bestHour.views)) bestHour = { label: hour.label, views };
    }
    if (bestDuration) grounding.bestDuration = bestDuration.d;
    if (bestHour) grounding.bestHour = bestHour.label;
    const recommendations = Array.isArray(analyticsReport?.recommendations) ? (analyticsReport!.recommendations as unknown[]).filter((r): r is string => typeof r === "string") : [];
    if (recommendations[0]) grounding.analyticsNote = `Analiticas: ${recommendations[0].slice(0, 200)}`;
    grounding.sources.push(`Analiticas (${typeof analyticsReport?.generatedAt === "string" ? analyticsReport.generatedAt.slice(0, 10) : "sin fecha"})`);
  }
  const competitionReport = obj(obj(competitionState)?.lastReport);
  if (competitionReport) {
    const best = Array.isArray(competitionReport.bestContent) ? competitionReport.bestContent as unknown[] : [];
    grounding.competitorWinners = best.map(obj).filter((b): b is Record<string, unknown> => Boolean(b && typeof b.title === "string" && typeof b.competitor === "string"))
      .map((b) => ({ competitor: String(b.competitor).slice(0, 60), title: String(b.title).slice(0, 120), views: Number(b.views) || 0 })).slice(0, 5);
    grounding.competitionTakeaways = (Array.isArray(competitionReport.takeaways) ? competitionReport.takeaways as unknown[] : []).filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 200)).slice(0, 5);
    const events = Array.isArray(obj(competitionReport.blackroom)?.upcomingEvents) ? obj(competitionReport.blackroom)!.upcomingEvents as unknown[] : [];
    grounding.upcomingEvents = events.map(obj).filter((e): e is Record<string, unknown> => Boolean(e && typeof e.name === "string" && typeof e.startDate === "string"))
      .map((e) => ({ name: String(e.name).slice(0, 80), startDate: String(e.startDate), location: typeof e.location === "string" ? e.location : null })).slice(0, 3);
    grounding.sources.push(`Competencia (${typeof competitionReport.generatedAt === "string" ? competitionReport.generatedAt.slice(0, 10) : "sin fecha"})`);
  }
  return grounding;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export function createBlackRoomScriptsAgent(deps: BlackRoomScriptsDeps = {}): BlackRoomTeamAgentModule {
  const workspaceRoot = deps.workspaceRoot ?? process.cwd();
  const readStyleGuide = deps.readStyleGuide ?? defaultBlackRoomStyleGuideReader(workspaceRoot);
  const readTeammateState = deps.readTeammateState ?? ((ctx: BlackRoomTeamContext, id: BlackRoomTeamAgentId) => readBlackRoomTeamState<unknown>(ctx.dataDir, id, null));
  const render = deps.render ?? defaultBlackRoomEditRenderer;
  const publisher = deps.publisher ?? publisherAgent;
  const publisherContext = deps.publisherContext ?? defaultPublisherContext;

  async function loadState(ctx: BlackRoomTeamContext): Promise<BlackRoomScriptsState> {
    return normalizeState(await ctx.state.load<unknown>(null));
  }

  async function grounding(ctx: BlackRoomTeamContext): Promise<{ grounding: BlackRoomScriptGrounding; teammates: string[] }> {
    const safeRead = async (id: BlackRoomTeamAgentId) => { try { return await readTeammateState(ctx, id); } catch { return null; } };
    const [analytics, competition, analyticsStatus, competitionStatus] = await Promise.all([
      safeRead("blackroom-analytics"),
      safeRead("blackroom-competition"),
      ctx.readTeammateStatus("blackroom-analytics").catch(() => null),
      ctx.readTeammateStatus("blackroom-competition").catch(() => null),
    ]);
    const teammates = [
      analyticsStatus ? `Analiticas: ${analyticsStatus.state} (${analyticsStatus.label})` : "Analiticas: sin estado",
      competitionStatus ? `Competencia: ${competitionStatus.state} (${competitionStatus.label})` : "Competencia: sin estado",
    ];
    return { grounding: groundingFromTeammates(analytics, competition), teammates };
  }

  async function generateIdeas(ctx: BlackRoomTeamContext, input: Record<string, unknown>) {
    const [guide, ground] = await Promise.all([loadBlackRoomVideoStyleGuide(readStyleGuide), grounding(ctx)]);
    const durations = Array.isArray(input.durations) ? input.durations.map(Number).filter((d): d is BlackRoomScriptDuration => (SHORT_DURATIONS as number[]).includes(d)) : [];
    const single = Number(input.durationSeconds);
    const now = ctx.now();
    const scripts = buildBlackRoomVideoScripts({
      count: Number(input.count) || 3,
      durations: (SHORT_DURATIONS as number[]).includes(single) ? [single as BlackRoomScriptDuration] : durations,
      topic: str(input.topic, 120) || null,
      djName: str(input.djName, 60) || null,
      eventName: str(input.eventName, 80) || null,
      language: input.language === "en" ? "en" : input.language === "es" ? "es" : null,
      seed: str(input.seed, 60) || now.toISOString().slice(0, 10),
    }, ground.grounding, guide);
    return { scripts, guide, ground };
  }

  function guideSummary(guide: BlackRoomVideoStyleGuide): string {
    return guide.present ? "Guia de estilo de Robert aplicada." : `Sin guia de estilo de Robert: uso plantillas base. ${guide.reason}`;
  }

  /** Renders at most one job (the given id or the oldest queued). Never runs two at once per state file. */
  async function processOneJob(ctx: BlackRoomTeamContext, jobId: string | null): Promise<{ job: BlackRoomEditJob | null; message: string; ok: boolean }> {
    const state = await loadState(ctx);
    recoverStaleJobs(state, ctx.now());
    if (state.jobs.some((job) => job.status === "rendering")) {
      await ctx.state.save(state);
      return { job: null, ok: false, message: "Ya hay un video renderizandose; espero a que termine." };
    }
    const job = jobId ? state.jobs.find((candidate) => candidate.id === jobId) : state.jobs.find((candidate) => candidate.status === "queued");
    if (!job) { await ctx.state.save(state); return { job: null, ok: true, message: jobId ? "No encontre ese trabajo de edicion." : "No hay videos en cola." }; }
    if (job.status !== "queued") { await ctx.state.save(state); return { job, ok: false, message: `El trabajo ${job.id} esta en estado ${job.status}; no se renderiza.` }; }
    const enabled = isRenderEnabled(ctx);
    job.plan = buildPlan(job, enabled);
    job.updatedAt = ctx.now().toISOString();
    if (!enabled) {
      await ctx.state.save(state);
      return { job, ok: true, message: `Plan de edicion listo para ${job.id} (simulacion: falta ${BLACKROOM_SCRIPTS_RENDER_FLAG}=true para renderizar).` };
    }
    if (!ctx.userId) {
      await ctx.state.save(state);
      return { job, ok: false, message: "Falta la sesion del dueno (userId) para usar Google Drive y el pipeline de edicion." };
    }
    job.status = "rendering";
    job.attempts += 1;
    job.startedAt = ctx.now().toISOString();
    job.error = null;
    await ctx.state.save(state);

    let outcome: BlackRoomRenderOutcome;
    let thrown = false;
    try {
      outcome = await render(job, { userId: ctx.userId, workspaceRoot });
    } catch (error) {
      thrown = true;
      outcome = { status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "Error desconocido en el render" };
    }

    // Reload: other actions (cancel, ideas) may have written while rendering.
    const after = await loadState(ctx);
    const current = after.jobs.find((candidate) => candidate.id === job.id);
    if (!current) return { job: null, ok: false, message: "El trabajo desaparecio mientras se renderizaba." };
    const at = ctx.now().toISOString();
    current.updatedAt = at;
    current.pendingActionId = outcome.pendingActionId || null;
    current.clips = outcome.clips || [];
    if (outcome.status === "completed" && current.clips.length) {
      current.status = "completed";
      current.finishedAt = at;
      const handoffs = await handOffClips(ctx, after, current);
      await ctx.state.save(after);
      return { job: current, ok: true, message: `Video ${current.id} editado: ${current.clips.length} clip(s). ${handoffs}` };
    }
    if (outcome.status === "needs_dj_name") {
      current.status = "needs_dj_name";
      current.error = "No pude leer el nombre del DJ en el video. Usa retry-edit-job con djName (si respondes por Telegram, los clips quedan en Drive y no pasan por aqui).";
    } else if (outcome.status === "queued") {
      // The pipeline left its own confirmation; approving it there renders outside this job, so no loop here.
      current.status = "failed";
      current.failureKind = "awaiting_confirmation";
      current.finishedAt = at;
      current.error = `El pipeline dejo una confirmacion pendiente${outcome.pendingActionId ? ` (${outcome.pendingActionId})` : ""}. Si la apruebas, los clips quedan en Drive fuera de este trabajo.`;
    } else {
      current.status = "failed";
      current.finishedAt = at;
      current.error = outcome.error || (outcome.status === "completed" ? "El render termino sin clips." : "El render fallo sin detalle.");
      // An exception before any output is usually missing Drive/pipeline setup; the classifier decides.
      current.failureKind = thrown || outcome.status === "failed" ? classifyBlackRoomRenderFailure(current.error) : "render";
    }
    await ctx.state.save(after);
    return { job: current, ok: false, message: `Video ${current.id}: ${current.error}` };
  }

  /** Vertical clips -> Publicador queue (pending, dry run). Clips missing data stay as local drafts. */
  async function handOffClips(ctx: BlackRoomTeamContext, state: BlackRoomScriptsState, job: BlackRoomEditJob): Promise<string> {
    const vertical = job.clips.filter((clip) => clip.height > clip.width || /vertical/.test(clip.kind));
    const clips = vertical.length ? vertical : job.clips;
    let handed = 0;
    let waiting = 0;
    for (const clip of clips) {
      const payload: BlackRoomVideoDraftPayload = {
        jobId: job.id,
        clipPath: clip.path,
        clipKind: clip.kind,
        durationSeconds: clip.durationSeconds,
        videoFormat: clip.height > clip.width ? "vertical" : "horizontal",
        language: job.language,
        caption: defaultCaption(job, state.ideas),
        // A Drive view link is an HTML page, not the video: keep it as a local draft until Robert
        // pastes a direct download link.
        mediaUrl: clip.driveWebViewLink && /^https:\/\//i.test(clip.driveWebViewLink) && !isViewerPageMediaUrl(clip.driveWebViewLink) ? clip.driveWebViewLink : null,
        sourceVideoId: job.sourceVideoId,
        publicationDateTime: job.publicationDateTime,
        missing: [],
        publisherItemId: null,
        publisherError: null,
      };
      payload.missing = draftMissing(payload);
      if (!payload.missing.length) {
        const sent = await sendToPublisher(ctx, payload);
        if (sent.ok) { job.publisherItemIds.push(sent.itemId); handed += 1; continue; }
        payload.publisherError = sent.error;
      }
      state.drafts.push({
        id: newId("draft", ctx.now(), `${job.id}:${clip.path}`),
        agentId: ID,
        kind: "video-draft",
        title: `Clip ${payload.durationSeconds}s ${payload.videoFormat} de ${job.djName || job.id}`,
        summary: payload.missing.length ? `Falta: ${payload.missing.map((m) => m.split(":")[0]).join(", ")}` : `El Publicador lo rechazo: ${payload.publisherError}`,
        payload,
        createdAt: ctx.now().toISOString(),
        status: "pending",
        decidedAt: null,
        dryRun: true,
      });
      waiting += 1;
    }
    trimJobs(state);
    return [handed ? `${handed} enviado(s) al Publicador como borrador pendiente.` : "", waiting ? `${waiting} borrador(es) esperan datos de Robert.` : ""].filter(Boolean).join(" ");
  }

  async function sendToPublisher(ctx: BlackRoomTeamContext, payload: BlackRoomVideoDraftPayload): Promise<{ ok: true; itemId: string } | { ok: false; error: string }> {
    const add = publisher.actions?.add;
    if (!add) return { ok: false, error: "El Publicador no tiene la accion add." };
    try {
      const result = await add(publisherContext(ctx), {
        draft: {
          channel: "metricool",
          caption: payload.caption,
          mediaUrl: payload.mediaUrl,
          sourceVideoId: payload.sourceVideoId,
          durationSeconds: payload.durationSeconds,
          videoFormat: payload.videoFormat,
          language: payload.language,
          publicationDateTime: payload.publicationDateTime,
          timezone: BLACKROOM_TIMEZONE,
          source: "blackroom-scripts",
          notes: `Clip editado por Guiones y Edicion (trabajo ${payload.jobId}).${payload.sourceVideoId ? "" : " Sin set completo en YouTube: los captions no llevan ese enlace."}`,
        },
      });
      const item = obj(obj(result.report)?.item);
      if (!result.ok || typeof item?.id !== "string") return { ok: false, error: result.summary.slice(0, 300) };
      return { ok: true, itemId: item.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "Error desconocido del Publicador" };
    }
  }

  async function getStatus(ctx: BlackRoomTeamContext): Promise<BlackRoomTeamStatus> {
    const state = await loadState(ctx);
    const now = ctx.now();
    recoverStaleJobs(state, now); // view only; persisted on the next write
    const guide = await loadBlackRoomVideoStyleGuide(readStyleGuide);
    const c = counts(state);
    const enabled = isRenderEnabled(ctx);
    const metrics: Record<string, number | string> = {
      ...c,
      guiaDeEstilo: guide.present ? "lista" : "pendiente",
      render: enabled ? "activado" : "simulacion",
    };
    const base = { id: ID, lastRunAt: state.lastRunAt, metrics, pendingApprovals: c.borradoresPendientes };
    const needs: string[] = [];
    if (c.enCola && !enabled) needs.push(`${BLACKROOM_SCRIPTS_RENDER_FLAG}=true para renderizar los ${c.enCola} video(s) en cola (hoy solo armo el plan)`);
    for (const job of state.jobs.filter((candidate) => candidate.status === "needs_dj_name").slice(0, 3)) needs.push(`Nombre del DJ para el video ${job.id} (accion retry-edit-job con djName)`);
    const guideText = guide.present ? "Guia de estilo aplicada." : "Sin guia de estilo de Robert (uso plantillas base).";
    const queueText = `${c.ideas} idea(s), ${c.enCola} video(s) en cola, ${c.listos} listo(s), ${c.borradoresPendientes} borrador(es) esperando datos.`;
    if (needs.length) {
      return { ...base, state: "blocked", label: c.faltaDj ? "Falta el nombre del DJ" : "Videos en cola sin render activado", summary: `${queueText} ${guideText}`, needs };
    }
    if (c.renderizando || isFresh(state.lastRunAt, now.getTime())) {
      return { ...base, state: "working", label: c.renderizando ? "Editando un video" : "Ideas y edicion al dia", summary: `${state.lastRunSummary || ""} ${queueText}`.trim(), needs: [] };
    }
    return {
      ...base,
      state: "available",
      label: guide.present ? "Listo para ideas y edicion" : "Listo (falta la guia de estilo)",
      summary: `${queueText} ${guideText} Mandame un video de Drive con create-edit-job.`,
      needs: [],
    };
  }

  async function run(ctx: BlackRoomTeamContext, input: Record<string, unknown> = {}): Promise<BlackRoomTeamRunResult> {
    const { scripts, guide, ground } = await generateIdeas(ctx, input);
    const state = await loadState(ctx);
    recoverStaleJobs(state, ctx.now());
    state.ideas = [...state.ideas.filter((idea) => !scripts.some((s) => s.id === idea.id)), ...scripts].slice(-MAX_IDEAS);
    state.ideasGeneratedAt = ctx.now().toISOString();
    await ctx.state.save(state);
    const processed = await processOneJob(ctx, null);
    const after = await loadState(ctx);
    const summary = [
      `${scripts.length} idea(s) con guion (${scripts.map((s) => `${s.durationSeconds}s`).join(", ")}).`,
      processed.message,
      guideSummary(guide),
    ].join(" ");
    after.lastRunAt = ctx.now().toISOString();
    after.lastRunSummary = summary.slice(0, 400);
    await ctx.state.save(after);
    return {
      ok: processed.ok,
      summary,
      report: {
        ideas: scripts.map((script) => ({ ...script, handoffPrompt: buildBlackRoomScriptHandoffPrompt(script, guide) })),
        grounding: { ...ground.grounding, teammates: ground.teammates },
        styleGuide: { present: guide.present, reason: guide.reason },
        editJob: processed.job,
        counts: counts(after),
      },
      needsApproval: after.drafts.filter((draft) => draft.status === "pending"),
    };
  }

  const actions: Record<string, BlackRoomTeamActionHandler> = {
    async ideas(ctx, input) {
      const { scripts, guide, ground } = await generateIdeas(ctx, input);
      const state = await loadState(ctx);
      state.ideas = [...state.ideas.filter((idea) => !scripts.some((s) => s.id === idea.id)), ...scripts].slice(-MAX_IDEAS);
      state.ideasGeneratedAt = ctx.now().toISOString();
      await ctx.state.save(state);
      return {
        ok: true,
        summary: `${scripts.length} idea(s) con guion. ${guideSummary(guide)}`,
        report: { ideas: scripts.map((script) => ({ ...script, handoffPrompt: buildBlackRoomScriptHandoffPrompt(script, guide) })), grounding: { ...ground.grounding, teammates: ground.teammates } },
      };
    },

    async list(ctx) {
      const state = await loadState(ctx);
      recoverStaleJobs(state, ctx.now());
      return { ok: true, summary: `${state.ideas.length} idea(s), ${state.jobs.length} trabajo(s) de edicion, ${state.drafts.filter((d) => d.status === "pending").length} borrador(es) pendientes.`, report: { ideas: state.ideas, jobs: state.jobs, drafts: state.drafts, counts: counts(state) } };
    },

    async "style-guide"() {
      const guide = await loadBlackRoomVideoStyleGuide(readStyleGuide);
      return { ok: true, summary: guide.present ? "Guia de estilo cargada." : guide.reason, report: guide };
    },

    async "create-edit-job"(ctx, input) {
      const driveRaw = str(input.driveUrl, 2_000) || str(input.driveFileId, 200);
      const localRaw = str(input.localPath, 1_000);
      if (Boolean(driveRaw) === Boolean(localRaw)) return fail("Indica un video: driveUrl (o driveFileId) o localPath, solo uno.", "invalid_source");
      let source: BlackRoomEditJobSource;
      if (driveRaw) {
        const fileId = /^https?:\/\//i.test(driveRaw) ? extractGoogleDriveFileIdFromUrl(driveRaw) : (/^[a-zA-Z0-9_-]{10,}$/.test(driveRaw) ? driveRaw : null);
        if (!fileId) return fail("No reconozco ese enlace de Google Drive. Usa el enlace de un archivo de video (no de una carpeta).", "invalid_drive_link");
        source = { kind: "drive", fileId, url: /^https?:\/\//i.test(driveRaw) ? driveRaw : null };
      } else {
        const resolved = resolveLocalSource(workspaceRoot, localRaw);
        if (!resolved.ok) return fail(resolved.error, "invalid_local_path");
        source = { kind: "local", path: resolved.path };
      }
      const sourceVideoId = str(input.sourceVideoId, 20);
      if (sourceVideoId && !/^[A-Za-z0-9_-]{11}$/.test(sourceVideoId)) return fail("sourceVideoId debe ser el id de YouTube de 11 caracteres.", "invalid_source_video_id");
      const publicationDateTime = str(input.publicationDateTime, 32);
      if (publicationDateTime && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(publicationDateTime)) return fail("publicationDateTime debe tener el formato AAAA-MM-DDTHH:MM:SS.", "invalid_date");
      const state = await loadState(ctx);
      const sameSource = state.jobs.find((job) => ["queued", "rendering", "needs_dj_name"].includes(job.status) && JSON.stringify(job.source) === JSON.stringify(source));
      if (sameSource) return { ok: true, summary: `Ese video ya esta en cola (${sameSource.id}).`, report: { job: sameSource } };
      if (state.jobs.filter((job) => ["queued", "rendering", "needs_dj_name"].includes(job.status)).length >= MAX_OPEN_JOBS) return fail("Hay demasiados videos en cola; espera a que terminen.", "queue_full");
      const now = ctx.now();
      const job: BlackRoomEditJob = {
        id: newId("edit", now, JSON.stringify(source)),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        source,
        djName: str(input.djName, 60) || null,
        ideaId: str(input.ideaId, 40) || null,
        sourceVideoId: sourceVideoId || null,
        publicationDateTime: publicationDateTime || null,
        caption: str(input.caption, 2_000) || null,
        language: input.language === "en" ? "en" : "es",
        notes: str(input.notes, 500),
        status: "queued",
        attempts: 0,
        startedAt: null,
        finishedAt: null,
        error: null,
        pendingActionId: null,
        plan: null,
        clips: [],
        publisherItemIds: [],
      };
      job.plan = buildPlan(job, isRenderEnabled(ctx));
      state.jobs.push(job);
      trimJobs(state);
      await ctx.state.save(state);
      return { ok: true, summary: `Video en cola (${job.id}). ${isRenderEnabled(ctx) ? "Se edita en la proxima corrida o con process-edit-job." : `Solo plan: activa ${BLACKROOM_SCRIPTS_RENDER_FLAG}=true para renderizar.`}`, report: { job } };
    },

    async "process-edit-job"(ctx, input) {
      const id = str(input.id, 80);
      if (!id) return fail("Falta el id del trabajo de edicion.", "missing_id");
      const result = await processOneJob(ctx, id);
      const state = await loadState(ctx);
      return { ok: result.ok, summary: result.message, report: { job: result.job }, needsApproval: state.drafts.filter((d) => d.status === "pending") };
    },

    async "retry-edit-job"(ctx, input) {
      const state = await loadState(ctx);
      recoverStaleJobs(state, ctx.now());
      const job = state.jobs.find((candidate) => candidate.id === str(input.id, 80));
      if (!job) return fail("No encontre ese trabajo de edicion.", "not_found");
      if (!["failed", "needs_dj_name", "cancelled"].includes(job.status)) return fail(`El trabajo esta en estado ${job.status}; no hace falta reintentarlo.`, "invalid_state");
      const djName = str(input.djName, 60);
      if (djName) job.djName = djName;
      job.status = "queued";
      job.error = null;
      job.failureKind = null;
      job.finishedAt = null;
      job.pendingActionId = null;
      job.updatedAt = ctx.now().toISOString();
      await ctx.state.save(state);
      return { ok: true, summary: `Trabajo ${job.id} de nuevo en cola.`, report: { job } };
    },

    async "cancel-edit-job"(ctx, input) {
      const state = await loadState(ctx);
      const job = state.jobs.find((candidate) => candidate.id === str(input.id, 80));
      if (!job) return fail("No encontre ese trabajo de edicion.", "not_found");
      if (job.status === "rendering") return fail("No puedo cancelar un video que se esta renderizando.", "rendering");
      if (job.status === "completed") return fail("Ese video ya esta editado.", "completed");
      job.status = "cancelled";
      job.updatedAt = ctx.now().toISOString();
      await ctx.state.save(state);
      return { ok: true, summary: `Trabajo ${job.id} cancelado.`, report: { job } };
    },

    /** Robert completes a local draft (date, YouTube id, link) and sends it to the Publicador queue. */
    async "send-to-publisher"(ctx, input) {
      const state = await loadState(ctx);
      const draft = state.drafts.find((candidate) => candidate.id === str(input.id, 80));
      if (!draft) return fail("No encontre ese borrador.", "not_found");
      if (draft.status !== "pending") return fail("Ese borrador ya se decidio.", "already_decided");
      const payload = { ...draft.payload };
      const caption = str(input.caption, 2_000);
      if (caption) payload.caption = caption;
      const mediaUrl = str(input.mediaUrl, 2_000);
      if (mediaUrl) payload.mediaUrl = mediaUrl;
      const sourceVideoId = str(input.sourceVideoId, 20);
      if (sourceVideoId) payload.sourceVideoId = sourceVideoId;
      const publicationDateTime = str(input.publicationDateTime, 32);
      if (publicationDateTime) payload.publicationDateTime = publicationDateTime;
      payload.missing = draftMissing(payload);
      draft.payload = payload;
      if (payload.missing.length) {
        draft.summary = `Falta: ${payload.missing.map((m) => m.split(":")[0]).join(", ")}`;
        await ctx.state.save(state);
        return fail(`Faltan datos: ${payload.missing.join("; ")}`, "missing_fields", { draft });
      }
      const sent = await sendToPublisher(ctx, payload);
      if (!sent.ok) {
        payload.publisherError = sent.error;
        draft.summary = `El Publicador lo rechazo: ${sent.error}`;
        await ctx.state.save(state);
        return fail(`El Publicador no acepto el borrador: ${sent.error}`, "publisher_rejected", { draft });
      }
      payload.publisherItemId = sent.itemId;
      payload.publisherError = null;
      draft.status = "approved";
      draft.decidedAt = ctx.now().toISOString();
      draft.summary = `En la cola del Publicador (${sent.itemId}); falta la aprobacion final de Robert alli.`;
      const job = state.jobs.find((candidate) => candidate.id === payload.jobId);
      if (job && !job.publisherItemIds.includes(sent.itemId)) job.publisherItemIds.push(sent.itemId);
      await ctx.state.save(state);
      return { ok: true, summary: `Borrador enviado al Publicador (${sent.itemId}). Nada se publica hasta que lo apruebes alli.`, report: { draft } };
    },

    async reject(ctx, input) {
      const state = await loadState(ctx);
      const draft = state.drafts.find((candidate) => candidate.id === str(input.id, 80));
      if (!draft) return fail("No encontre ese borrador.", "not_found");
      if (draft.status !== "pending") return fail("Ese borrador ya se decidio.", "already_decided");
      draft.status = "rejected";
      draft.decidedAt = ctx.now().toISOString();
      await ctx.state.save(state);
      return { ok: true, summary: "Borrador descartado.", report: { draft } };
    },
  };

  return { id: ID, getStatus, run, actions };
}

const agent = createBlackRoomScriptsAgent();
export default agent;
