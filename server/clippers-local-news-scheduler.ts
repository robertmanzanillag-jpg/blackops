import {
  bootstrapClipperLocalNews,
  runClipperLocalNewsCycle,
} from "./clippers-local-news-agent";
import { deliverClipperLocalNewsToMetricool } from "./clippers-local-news-metricool";

const DEFAULT_INTERVAL_MINUTES = 5;
const MIN_INTERVAL_MINUTES = 2;
const MAX_INTERVAL_MINUTES = 5;
const DEFAULT_TIMEOUT_MS = 240_000;

type ClipperLocalNewsCyclePhase = "bootstrap" | "ingest" | "delivery";

type TimerHandle = ReturnType<typeof setInterval>;

export interface ClipperLocalNewsSchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  timeoutMs: number;
}

export interface ClipperLocalNewsSchedulerStatus extends ClipperLocalNewsSchedulerConfig {
  started: boolean;
  running: boolean;
  runCount: number;
  completedCount: number;
  skippedCount: number;
  timeoutCount: number;
  currentPhase: ClipperLocalNewsCyclePhase | null;
  lastTimeoutPhase: ClipperLocalNewsCyclePhase | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

export interface ClipperLocalNewsSchedulerDeps {
  env?: NodeJS.ProcessEnv;
  bootstrap?: typeof bootstrapClipperLocalNews;
  runCycle?: typeof runClipperLocalNewsCycle;
  deliver?: typeof deliverClipperLocalNewsToMetricool;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  setInterval?: (callback: () => void, delayMs: number) => TimerHandle;
  clearInterval?: (timer: TimerHandle) => void;
  setTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout?: (timer: TimerHandle) => void;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export interface ClipperLocalNewsScheduler {
  start(): ClipperLocalNewsSchedulerStatus;
  stop(): ClipperLocalNewsSchedulerStatus;
  runNow(): Promise<"completed" | "failed" | "skipped" | "timed_out">;
  status(): ClipperLocalNewsSchedulerStatus;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value || "", 10);
  const candidate = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(maximum, Math.max(minimum, candidate));
}

export function getClipperLocalNewsSchedulerConfig(env: NodeJS.ProcessEnv = process.env): ClipperLocalNewsSchedulerConfig {
  const intervalMinutes = boundedInteger(
    env.CLIPPERS_LOCAL_NEWS_INTERVAL_MINUTES,
    DEFAULT_INTERVAL_MINUTES,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES,
  );
  const intervalMs = intervalMinutes * 60_000;
  const timeoutMs = boundedInteger(
    env.CLIPPERS_LOCAL_NEWS_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    1_000,
    Math.max(1_000, intervalMs - 1_000),
  );
  return {
    enabled: env.CLIPPERS_LOCAL_NEWS_SCHEDULER_ENABLED !== "false",
    intervalMs,
    timeoutMs,
  };
}

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  const message = error.message
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/(api[-_ ]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 240);
  return `${error.name}: ${message || "operation_failed"}`;
}

function memoryRssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

export function createClipperLocalNewsScheduler(deps: ClipperLocalNewsSchedulerDeps = {}): ClipperLocalNewsScheduler {
  const env = deps.env || process.env;
  const config = getClipperLocalNewsSchedulerConfig(env);
  const bootstrap = deps.bootstrap || bootstrapClipperLocalNews;
  const runCycle = deps.runCycle || runClipperLocalNewsCycle;
  const deliver = deps.deliver || deliverClipperLocalNewsToMetricool;
  const fetcher = deps.fetch || globalThis.fetch;
  const now = deps.now || (() => new Date());
  const scheduleInterval = deps.setInterval || globalThis.setInterval;
  const cancelInterval = deps.clearInterval || globalThis.clearInterval;
  const scheduleTimeout = deps.setTimeout || globalThis.setTimeout;
  const cancelTimeout = deps.clearTimeout || globalThis.clearTimeout;
  const log = deps.log || ((message) => console.log(message));
  const logError = deps.logError || ((message) => console.error(message));

  let interval: TimerHandle | null = null;
  let inFlight: Promise<void> | null = null;
  let started = false;
  let runCount = 0;
  let completedCount = 0;
  let skippedCount = 0;
  let timeoutCount = 0;
  let currentPhase: ClipperLocalNewsCyclePhase | null = null;
  let lastTimeoutPhase: ClipperLocalNewsCyclePhase | null = null;
  let lastStartedAt: string | null = null;
  let lastFinishedAt: string | null = null;
  let lastError: string | null = null;

  const status = (): ClipperLocalNewsSchedulerStatus => ({
    ...config,
    started,
    running: inFlight !== null,
    runCount,
    completedCount,
    skippedCount,
    timeoutCount,
    currentPhase,
    lastTimeoutPhase,
    lastStartedAt,
    lastFinishedAt,
    lastError,
  });

  async function runNow(): Promise<"completed" | "failed" | "skipped" | "timed_out"> {
    if (!config.enabled || inFlight) {
      skippedCount += 1;
      return "skipped";
    }

    runCount += 1;
    lastStartedAt = now().toISOString();
    lastError = null;
    let timedOut = false;
    let timeout: TimerHandle | null = null;
    const controller = new AbortController();
    const boundedFetch: typeof globalThis.fetch = (input, init) => fetcher(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal,
    });

    const work = (async () => {
      log(`[Clipper local news] cycle phase=start rssMb=${memoryRssMb()}`);
      currentPhase = "bootstrap";
      await bootstrap({ env });
      log(`[Clipper local news] cycle phase=bootstrapped rssMb=${memoryRssMb()}`);
      currentPhase = "ingest";
      const cycle = await runCycle({ env, fetch: boundedFetch });
      for (const observation of cycle.sourceObservations ?? [])
        log(`[Clipper local news source] ${JSON.stringify(observation)}`);
      for (const error of cycle.diagnosticWriteErrors ?? [])
        logError(`[Clipper local news diagnostics storage] ${JSON.stringify(error)}`);
      log(`[Clipper local news] cycle phase=ingested rssMb=${memoryRssMb()}`);
      if (controller.signal.aborted) throw new Error("cycle_aborted_after_timeout");
      currentPhase = "delivery";
      const delivery = await deliver({ env, status: cycle.status, fetch: boundedFetch });
      log(`[Clipper local news] cycle phase=delivered rssMb=${memoryRssMb()}`);
      log(`[Clipper local news] cycle completed (sources=${cycle.fetchedSources || 0}; sourceFailures=${cycle.failedSources?.length || 0}; created=${cycle.created || 0}; queued=${cycle.queued || 0}; delivery=${delivery.status}; scheduled=${delivery.scheduled}; alreadyScheduled=${delivery.alreadyScheduled}; rssMb=${memoryRssMb()})`);
    })();
    inFlight = work.finally(() => {
      inFlight = null;
      currentPhase = null;
      if (timeout) cancelTimeout(timeout);
    });

    const deadline = new Promise<"timed_out">((resolve) => {
      timeout = scheduleTimeout(() => {
        timedOut = true;
        controller.abort();
        timeoutCount += 1;
        lastTimeoutPhase = currentPhase;
        lastError = currentPhase ? `timeout:${currentPhase}` : "timeout";
        logError(`[Clipper local news] cycle timed out during ${currentPhase || "unknown"}; overlap lock remains active until bounded work settles`);
        resolve("timed_out");
      }, config.timeoutMs);
      timeout.unref?.();
    });

    try {
      const result = await Promise.race([
        inFlight.then(() => "completed" as const),
        deadline,
      ]);
      if (result === "completed") {
        completedCount += 1;
        lastFinishedAt = now().toISOString();
      }
      return result;
    } catch (error) {
      lastError = safeError(error);
      lastFinishedAt = now().toISOString();
      logError("[Clipper local news] cycle failed; it will retry on the next interval");
      return "failed";
    } finally {
      if (!timedOut && timeout) cancelTimeout(timeout);
    }
  }

  function start(): ClipperLocalNewsSchedulerStatus {
    if (started || !config.enabled) return status();
    started = true;
    interval = scheduleInterval(() => { void runNow(); }, config.intervalMs);
    interval.unref?.();
    log(`[Clipper local news] scheduler started (${config.intervalMs / 60_000} min; Metricool delivery enabled when configured)`);
    void runNow();
    return status();
  }

  function stop(): ClipperLocalNewsSchedulerStatus {
    if (interval) cancelInterval(interval);
    interval = null;
    started = false;
    return status();
  }

  return { start, stop, runNow, status };
}

let defaultScheduler: ClipperLocalNewsScheduler | null = null;

export function startClipperLocalNewsScheduler(): ClipperLocalNewsSchedulerStatus {
  defaultScheduler ||= createClipperLocalNewsScheduler();
  return defaultScheduler.start();
}

export function stopClipperLocalNewsScheduler(): ClipperLocalNewsSchedulerStatus {
  defaultScheduler ||= createClipperLocalNewsScheduler();
  return defaultScheduler.stop();
}

export function getClipperLocalNewsSchedulerStatus(): ClipperLocalNewsSchedulerStatus {
  defaultScheduler ||= createClipperLocalNewsScheduler();
  return defaultScheduler.status();
}
