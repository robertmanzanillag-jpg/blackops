// Black Room team schedule: the agents work on their own, without anyone opening the chat.
//
// Only safe, bounded work runs here (no LLM, no posting):
// - Analiticas: social media report (read-only Metricool refresh when the token exists).
// - Competencia: public competitor scan (its own 6 h cache and rate limits apply).
// - Website: site check (GET/HEAD only).
// - Publicador: processes items Robert or the partner already APPROVED. It stays in dry-run unless
//   the explicit live flags are set; it never approves anything by itself.
// - CEO: daily team brief after the others ran (Telegram only with BLACKROOM_CEO_TELEGRAM=true).
// - Guiones y Edicion: only when BLACKROOM_SCRIPTS_RENDER_ENABLED=true (processes queued edit jobs).
//
// One job at a time, each with a timeout, sharing the busy set with the routes and the CEO chat.
// Last runs are persisted so a restart does not rerun everything at once.
// Disable with BLACKROOM_TEAM_SCHEDULER_ENABLED=false.
import path from "node:path";
import { BLACKROOM_TEAM_DATA_DIR, readBlackRoomTeamStateFile, writeBlackRoomTeamStateFile } from "./state";
import { BLACKROOM_TEAM_MODULES, createBlackRoomTeamContext, type BlackRoomTeamContextOptions } from "./index";
import type { BlackRoomTeamAgentId, BlackRoomTeamEnv } from "@shared/blackroom-team";

const HOUR = 60 * 60_000;
export const BLACKROOM_SCHEDULER_TICK_MS = 5 * 60_000;
export const BLACKROOM_SCHEDULER_JOB_TIMEOUT_MS = 3 * 60_000;
export const BLACKROOM_SCHEDULER_STATE_FILE = "scheduler.json";

export type BlackRoomScheduledJob = {
  id: string;
  agentId: BlackRoomTeamAgentId;
  /** Action name, or "run". */
  operation: string;
  input: Record<string, unknown>;
  everyMs: number;
  enabled: (env: BlackRoomTeamEnv) => boolean;
  label: string;
};

const always = () => true;
const flag = (name: string) => (env: BlackRoomTeamEnv) => String(env[name] || "").trim().toLowerCase() === "true";

/** Order matters: the CEO brief runs after the specialists so it reads fresh statuses. */
export const BLACKROOM_SCHEDULED_JOBS: readonly BlackRoomScheduledJob[] = [
  { id: "analytics-daily", agentId: "blackroom-analytics", operation: "daily-report", input: { refresh: true }, everyMs: 6 * HOUR, enabled: always, label: "Reporte de redes" },
  { id: "website-check", agentId: "blackroom-website", operation: "run", input: {}, everyMs: 6 * HOUR, enabled: always, label: "Revision del website" },
  { id: "competition-scan", agentId: "blackroom-competition", operation: "run", input: {}, everyMs: 12 * HOUR, enabled: always, label: "Revision de la competencia" },
  { id: "publisher-approved", agentId: "blackroom-publisher", operation: "run", input: {}, everyMs: 15 * 60_000, enabled: always, label: "Programar posteos aprobados" },
  { id: "scripts-edits", agentId: "blackroom-scripts", operation: "run", input: {}, everyMs: 2 * HOUR, enabled: flag("BLACKROOM_SCRIPTS_RENDER_ENABLED"), label: "Ideas y videos en cola" },
  { id: "ceo-brief", agentId: "blackroom-ceo", operation: "run", input: {}, everyMs: 24 * HOUR, enabled: always, label: "Brief diario del CEO" },
];

export type BlackRoomSchedulerJobState = { lastRunAt: string | null; lastOk: boolean | null; lastSummary: string };
export type BlackRoomSchedulerState = { version: 1; jobs: Record<string, BlackRoomSchedulerJobState> };

export function blackRoomSchedulerEnabled(env: BlackRoomTeamEnv): boolean {
  return String(env.BLACKROOM_TEAM_SCHEDULER_ENABLED ?? "").trim().toLowerCase() !== "false";
}

/** Jobs due now, in schedule order. A job never run before is due. */
export function dueBlackRoomJobs(state: BlackRoomSchedulerState, now: Date, env: BlackRoomTeamEnv, jobs: readonly BlackRoomScheduledJob[] = BLACKROOM_SCHEDULED_JOBS): BlackRoomScheduledJob[] {
  return jobs.filter((job) => {
    if (!job.enabled(env)) return false;
    const last = state.jobs[job.id]?.lastRunAt ? Date.parse(state.jobs[job.id].lastRunAt as string) : Number.NaN;
    return !Number.isFinite(last) || last > now.getTime() || now.getTime() - last >= job.everyMs;
  });
}

function parseState(raw: unknown): BlackRoomSchedulerState {
  const jobs: Record<string, BlackRoomSchedulerJobState> = {};
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { jobs?: unknown }).jobs : null;
  if (source && typeof source === "object") {
    for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
      const entry = value && typeof value === "object" ? value as Record<string, unknown> : {};
      jobs[id] = {
        lastRunAt: typeof entry.lastRunAt === "string" ? entry.lastRunAt : null,
        lastOk: typeof entry.lastOk === "boolean" ? entry.lastOk : null,
        lastSummary: typeof entry.lastSummary === "string" ? entry.lastSummary.slice(0, 300) : "",
      };
    }
  }
  return { version: 1, jobs };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("sin respuesta a tiempo")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export type BlackRoomSchedulerDeps = {
  env?: BlackRoomTeamEnv;
  now?: () => Date;
  dataDir?: string;
  /** Owner whose Black Room data the agents use. */
  ownerUserId?: () => string | null;
  context?: Omit<BlackRoomTeamContextOptions, "env" | "now" | "dataDir" | "userId" | "actor">;
  running?: Set<string>;
  jobs?: readonly BlackRoomScheduledJob[];
  jobTimeoutMs?: number;
  log?: (message: string) => void;
};

export function createBlackRoomTeamScheduler(deps: BlackRoomSchedulerDeps = {}) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const dataDir = deps.dataDir ?? path.resolve(process.cwd(), BLACKROOM_TEAM_DATA_DIR);
  const running = deps.running ?? new Set<string>();
  const jobs = deps.jobs ?? BLACKROOM_SCHEDULED_JOBS;
  const jobTimeoutMs = deps.jobTimeoutMs ?? BLACKROOM_SCHEDULER_JOB_TIMEOUT_MS;
  const log = deps.log ?? ((message: string) => console.log(`[blackroom-team-scheduler] ${message}`));
  const modules = deps.context?.modules ?? BLACKROOM_TEAM_MODULES;
  let ticking = false;

  async function load(): Promise<BlackRoomSchedulerState> {
    return parseState(await readBlackRoomTeamStateFile(dataDir, BLACKROOM_SCHEDULER_STATE_FILE, null).catch(() => null));
  }

  /** Runs every due job once, one at a time. Returns the ids that ran. */
  async function tick(): Promise<string[]> {
    if (ticking || !blackRoomSchedulerEnabled(env)) return [];
    ticking = true;
    const ran: string[] = [];
    try {
      const state = await load();
      for (const job of dueBlackRoomJobs(state, now(), env, jobs)) {
        if (running.has(job.agentId)) continue;
        const module = modules[job.agentId];
        const handler = job.operation === "run" ? module.run.bind(module) : module.actions?.[job.operation];
        if (!handler) continue;
        running.add(job.agentId);
        let ok = false;
        let summary = "";
        try {
          const ctx = createBlackRoomTeamContext(job.agentId, { ...deps.context, env, now, dataDir, userId: deps.ownerUserId?.() ?? null, actor: null });
          const result = await withTimeout(handler(ctx, { ...job.input }), jobTimeoutMs);
          ok = Boolean(result.ok);
          summary = String(result.summary || "").slice(0, 300);
        } catch (error) {
          summary = `Fallo: ${error instanceof Error ? error.message.slice(0, 200) : "sin detalle"}`;
        } finally {
          running.delete(job.agentId);
        }
        state.jobs[job.id] = { lastRunAt: now().toISOString(), lastOk: ok, lastSummary: summary };
        await writeBlackRoomTeamStateFile(dataDir, BLACKROOM_SCHEDULER_STATE_FILE, state).catch((error) => log(`no pude guardar el horario: ${error instanceof Error ? error.message : error}`));
        log(`${job.label}: ${ok ? "ok" : "sin exito"} — ${summary.slice(0, 160)}`);
        ran.push(job.id);
      }
    } finally {
      ticking = false;
    }
    return ran;
  }

  return { tick, load };
}

let started: NodeJS.Timeout | null = null;

export function startBlackRoomTeamScheduler(deps: BlackRoomSchedulerDeps = {}): boolean {
  const env = deps.env ?? process.env;
  if (started || !blackRoomSchedulerEnabled(env)) return false;
  const scheduler = createBlackRoomTeamScheduler(deps);
  const run = () => { void scheduler.tick().catch((error) => console.warn("[blackroom-team-scheduler]", error instanceof Error ? error.message : error)); };
  // First pass a minute after boot so the server is fully up.
  setTimeout(run, 60_000).unref?.();
  started = setInterval(run, BLACKROOM_SCHEDULER_TICK_MS);
  started.unref?.();
  return true;
}
