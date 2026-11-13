import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlackRoomRemoteCommand } from "./blackroom-chat";
import { buildBlackRoomLearningSlots, type BlackRoomCeoAnalytics } from "./blackroom-growth-ceo";

export const BLACKROOM_QUEUE_VERSION = 4;
export const BLACKROOM_QUEUE_PATH = "clippers_workspace/blackroom/agent/queue.json";
export const BLACKROOM_DEFAULT_BUFFER_DAYS = 14;
// Five is the deliberate learning baseline.  A higher volume can make a
// temporary distribution drop look like a creative failure, and it can also
// exhaust the audience before Metricool has enough comparable results.
export const BLACKROOM_DEFAULT_POSTS_PER_DAY = 5;
export const BLACKROOM_DEFAULT_INTERVAL_MINUTES = 90;
export const BLACKROOM_MIN_POSTS_PER_DAY = 5;
// Five is the dependable baseline.  The CEO may run controlled seven-post
// experiments after enough comparable results arrive; ten remains a hard
// safety ceiling, never the default.
export const BLACKROOM_MAX_POSTS_PER_DAY = 10;
export const BLACKROOM_DURATION_VARIANTS = [15, 30, 60, 120, 300, 600] as const;
export type BlackRoomExperimentDuration = (typeof BLACKROOM_DURATION_VARIANTS)[number];
export type BlackRoomTargetNetwork = "tiktok" | "facebook" | "youtube";

export type BlackRoomDailyJobStatus = "queued" | "processing" | "retry" | "scheduled" | "completed" | "cancelled";

export interface BlackRoomDailyJob {
  id: string;
  kind: "daily_tiktok_batch";
  targetDate: string;
  originalTargetDate: string;
  status: BlackRoomDailyJobStatus;
  attempts: number;
  notBefore: string;
  manualRunRequestedAt: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastError: string | null;
  strategyVersion: number;
  strategyReplannedAt: string | null;
  slots: Array<{ localTime: string; timezone: string; networks?: BlackRoomTargetNetwork[] }>;
  requirements: {
    posts: number;
    djs: number;
    postsPerDj: number;
    languages: string[];
    formats: string[];
    durationsSeconds: number[];
    minimumClipsPerDuration: number;
    neverRepeatSourceVideo: boolean;
    allowDistinctNonOverlappingSegments: boolean;
    neverReuseOverlappingSegment: boolean;
    optimizeDurationFromPerformance: boolean;
    differentMomentsAcrossFormats: boolean;
    dropNearBeginning: boolean;
    deleteOnlyAfterMetricoolConfirmation: boolean;
  };
}

export interface BlackRoomSourceUsage {
  videoId: string;
  jobId: string;
  dj: string;
  format: "vertical" | "horizontal";
  language: "en" | "es";
  durationSeconds: BlackRoomExperimentDuration;
  segmentStartSeconds: number;
  segmentEndSeconds: number;
  recordedAt: string;
}

/**
 * Sources that failed before a render was produced. These are deliberately
 * separate from sourceHistory: a failed download must not masquerade as a
 * published clip, but it also must not be selected again on every retry.
 */
export interface BlackRoomFailedSource {
  videoId: string;
  failedAt: string;
  reason: string;
}

export interface BlackRoomQueueState {
  version: number;
  enabled: boolean;
  pausedAt: string | null;
  timezone: string;
  bufferDays: number;
  postsPerDay: number;
  intervalMinutes: number;
  updatedAt: string;
  jobs: BlackRoomDailyJob[];
  sourceHistory: BlackRoomSourceUsage[];
  failedSourceVideos: BlackRoomFailedSource[];
  appliedCommandIds: string[];
  prioritySources: Array<{ id: string; url: string; videoId: string | null; status: "pending" | "used"; createdAt: string }>;
  extraPostsByDate: Record<string, number>;
  adHocExtraDates: string[];
  analytics: BlackRoomCeoAnalytics;
}

function iso(now: Date): string {
  return now.toISOString();
}

function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addCalendarDays(date: string, days: number): string {
  const noonUtc = new Date(`${date}T12:00:00.000Z`);
  noonUtc.setUTCDate(noonUtc.getUTCDate() + days);
  return noonUtc.toISOString().slice(0, 10);
}

function minutesToTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function buildRotatingSlots(input: {
  dayIndex: number;
  posts?: number;
  intervalMinutes?: number;
  timezone?: string;
}): Array<{ localTime: string; timezone: string }> {
  const posts = Math.max(1, Math.min(16, Math.floor(input.posts || BLACKROOM_DEFAULT_POSTS_PER_DAY)));
  const timezone = input.timezone || "America/New_York";
  return buildBlackRoomLearningSlots({ dayIndex: input.dayIndex, posts })
    .map((localTime) => ({ localTime, timezone }));
}

export function createBlackRoomQueueState(now = new Date()): BlackRoomQueueState {
  return {
    version: BLACKROOM_QUEUE_VERSION,
    enabled: false,
    pausedAt: iso(now),
    timezone: "America/New_York",
    bufferDays: BLACKROOM_DEFAULT_BUFFER_DAYS,
    postsPerDay: BLACKROOM_DEFAULT_POSTS_PER_DAY,
    intervalMinutes: BLACKROOM_DEFAULT_INTERVAL_MINUTES,
    updatedAt: iso(now),
    jobs: [],
    sourceHistory: [],
    failedSourceVideos: [],
    appliedCommandIds: [],
    prioritySources: [],
    extraPostsByDate: {},
    adHocExtraDates: [],
    analytics: {
      sampleCount: 0,
      comparableSampleCount: 0,
      lastCheckedAt: "",
      nextCheckAt: iso(now),
      confidence: "collecting",
      networkSamples: { tiktok: 0, facebook: 0, youtube: 0 },
      historyStartDate: "",
      historyCompleteByNetwork: { tiktok: false, facebook: false, youtube: false },
      historyRequestsByNetwork: { tiktok: 0, facebook: 0, youtube: 0 },
      recommendedTimes: [],
      recommendedTimesByNetwork: { tiktok: [], facebook: [], youtube: [] },
      networkMedianViews: { tiktok: 0, facebook: 0, youtube: 0 },
      networkLowViewRate: { tiktok: 0, facebook: 0, youtube: 0 },
      networkDailyTargets: { tiktok: 5, facebook: 5, youtube: 5 },
      tiktokMedianViews: 0,
      tiktokLowViewRate: 0,
      creativeStrategy: "drop_first",
      creativeStrategyVersion: 0,
      creativeStrategySampleBaseline: 0,
      creativeStrategyPostIdsBaseline: [],
      creativeChangedAt: "",
      creativeReason: "Recolectando señal creativa de TikTok (0/5).",
      reason: "Recolectando resultados comparables (0/21); los horarios siguen explorando las 24 horas.",
    },
  };
}

function adaptiveReleaseTime(targetDate: string, now: Date, existingNotBefore?: string): string {
  // Keep the full campaign planned, but release each job only three days
  // before publication so fresh analytics can still change the strategy.
  const releaseAt = new Date(`${targetDate}T00:00:00.000Z`).getTime() - 3 * 86_400_000;
  const existing = existingNotBefore ? new Date(existingNotBefore).getTime() : 0;
  return new Date(Math.max(now.getTime(), releaseAt, Number.isFinite(existing) ? existing : 0)).toISOString();
}

function createDailyJob(state: BlackRoomQueueState, targetDate: string, dayIndex: number, now: Date): BlackRoomDailyJob {
  const timestamp = iso(now);
  const notBefore = adaptiveReleaseTime(targetDate, now);
  return {
    id: `blackroom-tiktok-${targetDate}`,
    kind: "daily_tiktok_batch",
    targetDate,
    originalTargetDate: targetDate,
    status: "queued",
    attempts: 0,
    notBefore,
    manualRunRequestedAt: null,
    leaseExpiresAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    lastError: null,
    strategyVersion: Math.max(0, Number(state.analytics?.creativeStrategyVersion || 0)),
    strategyReplannedAt: null,
    slots: buildRotatingSlots({
      dayIndex,
      posts: state.postsPerDay,
      intervalMinutes: state.intervalMinutes,
      timezone: state.timezone,
    }),
    requirements: {
      posts: state.postsPerDay,
      djs: 5,
      postsPerDj: 2,
      languages: ["en", "es"],
      formats: ["vertical", "horizontal"],
      durationsSeconds: [...BLACKROOM_DURATION_VARIANTS],
      minimumClipsPerDuration: 1,
      neverRepeatSourceVideo: false,
      allowDistinctNonOverlappingSegments: true,
      neverReuseOverlappingSegment: true,
      optimizeDurationFromPerformance: true,
      differentMomentsAcrossFormats: true,
      dropNearBeginning: true,
      deleteOnlyAfterMetricoolConfirmation: true,
    },
  };
}

function youtubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.split("/").filter(Boolean)[0] || null;
    if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2] || null;
    return parsed.searchParams.get("v");
  } catch { return null; }
}

function restoreExplicitNetworkTargets(
  slots: BlackRoomDailyJob["slots"],
  previousSlots: BlackRoomDailyJob["slots"],
): BlackRoomDailyJob["slots"] {
  const explicit = previousSlots.flatMap((slot) => slot.networks?.length ? [[...slot.networks]] : []);
  const offset = Math.max(0, slots.length - explicit.length);
  return slots.map((slot, index) => index >= offset && explicit[index - offset]?.length
    ? { ...slot, networks: explicit[index - offset] }
    : slot);
}

function resizeJob(state: BlackRoomQueueState, job: BlackRoomDailyJob, posts: number): void {
  const count = Math.max(1, Math.min(BLACKROOM_MAX_POSTS_PER_DAY, Math.floor(posts)));
  const dayIndex = Math.floor(new Date(`${job.targetDate}T12:00:00.000Z`).getTime() / 86400_000);
  const rebuilt = buildRotatingSlots({ dayIndex, posts: count, intervalMinutes: state.intervalMinutes, timezone: state.timezone });
  job.slots = restoreExplicitNetworkTargets(rebuilt, job.slots);
  job.requirements.posts = count;
  job.requirements.djs = Math.min(5, count);
  job.requirements.postsPerDj = Math.ceil(count / job.requirements.djs);
  job.updatedAt = state.updatedAt;
}

function buildFutureSameDaySlots(now: Date, posts: number, intervalMinutes: number, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const first = Math.ceil((currentMinutes + 15) / 15) * 15;
  const slots = Array.from({ length: posts }, (_, index) => first + index * intervalMinutes);
  if (slots.some((minutes) => minutes >= 1440)) throw new Error(`No caben ${posts} publicaciones adicionales hoy con ${intervalMinutes} minutos de separación`);
  return slots.map((minutes) => ({ localTime: minutesToTime(minutes), timezone }));
}

function appendFutureSameDaySlots(
  now: Date,
  existing: Array<{ localTime: string; timezone: string }>,
  posts: number,
  intervalMinutes: number,
  timezone: string,
) {
  const seed = buildFutureSameDaySlots(now, 1, intervalMinutes, timezone)[0].localTime;
  const [seedHour, seedMinute] = seed.split(":").map(Number);
  const lastExisting = existing.reduce((latest, slot) => {
    const [hours, minutes] = slot.localTime.split(":").map(Number);
    return Math.max(latest, hours * 60 + minutes);
  }, -intervalMinutes);
  const first = Math.max(seedHour * 60 + seedMinute, lastExisting + intervalMinutes);
  const minutes = Array.from({ length: posts }, (_, index) => first + index * intervalMinutes);
  if (minutes.some((value) => value >= 1440)) throw new Error(`No caben ${posts} publicaciones adicionales hoy con ${intervalMinutes} minutos de separación`);
  return minutes.map((value) => ({ localTime: minutesToTime(value), timezone }));
}

export function applyBlackRoomRemoteCommands(state: BlackRoomQueueState, commands: BlackRoomRemoteCommand[], now = new Date()): number {
  const applied = new Set(state.appliedCommandIds);
  let changes = 0;
  for (const command of commands) {
    if (!command?.id || applied.has(command.id)) continue;
    if (command.type === "daily_target") {
      state.postsPerDay = Math.max(BLACKROOM_MIN_POSTS_PER_DAY, Math.min(BLACKROOM_MAX_POSTS_PER_DAY, Math.floor(command.posts)));
      for (const job of state.jobs.filter((item) => ["queued", "retry"].includes(item.status))) {
        const target = state.adHocExtraDates.includes(job.targetDate)
          ? Number(state.extraPostsByDate[job.targetDate] || job.requirements.posts)
          : state.postsPerDay + Number(state.extraPostsByDate[job.targetDate] || 0);
        resizeJob(state, job, target);
      }
    } else if (command.type === "extra_posts") {
      const sameDateJobs = state.jobs.filter((item) => item.targetDate === command.targetDate);
      let job = sameDateJobs.find((item) => ["queued", "retry", "processing"].includes(item.status));
      const createdAdHoc = !job;
      if (!job) {
        job = createDailyJob(state, command.targetDate, 0, now);
        if (sameDateJobs.length) {
          const commandSuffix = command.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
          job.id = `${job.id}-extra-${commandSuffix}`;
        }
        state.jobs.push(job);
        if (!state.adHocExtraDates.includes(command.targetDate)) state.adHocExtraDates.push(command.targetDate);
        if (sameDateJobs.length) state.extraPostsByDate[command.targetDate] = 0;
      }
      const existingPosts = createdAdHoc ? 0 : job.requirements.posts;
      const remainingCapacity = Math.max(0, BLACKROOM_MAX_POSTS_PER_DAY - existingPosts);
      const added = Math.min(remainingCapacity, Math.max(0, Math.floor(command.posts)));
      if (!added) {
        applied.add(command.id);
        continue;
      }
      state.extraPostsByDate[command.targetDate] = Number(state.extraPostsByDate[command.targetDate] || 0) + added;
      if (createdAdHoc) {
        resizeJob(state, job, state.extraPostsByDate[command.targetDate]);
        job.slots = buildFutureSameDaySlots(now, job.requirements.posts, state.intervalMinutes, state.timezone)
          .map((slot) => command.networks?.length ? { ...slot, networks: [...command.networks] } : slot);
      } else if (state.adHocExtraDates.includes(command.targetDate)) {
        const extraSlots = appendFutureSameDaySlots(now, job.slots, added, state.intervalMinutes, state.timezone)
          .map((slot) => command.networks?.length ? { ...slot, networks: [...command.networks] } : slot);
        job.slots.push(...extraSlots);
        job.requirements.posts = job.slots.length;
        job.requirements.djs = Math.min(5, job.requirements.posts);
        job.requirements.postsPerDj = Math.ceil(job.requirements.posts / job.requirements.djs);
      } else {
        if (command.targetDate === localDate(now, state.timezone)) {
          const extraSlots = appendFutureSameDaySlots(now, job.slots, added, state.intervalMinutes, state.timezone)
            .map((slot) => command.networks?.length ? { ...slot, networks: [...command.networks] } : slot);
          job.slots.push(...extraSlots);
          job.requirements.posts = job.slots.length;
          job.requirements.djs = Math.min(5, job.requirements.posts);
          job.requirements.postsPerDj = Math.ceil(job.requirements.posts / job.requirements.djs);
        } else {
          resizeJob(state, job, state.postsPerDay + state.extraPostsByDate[command.targetDate]);
          if (command.networks?.length) {
            job.slots.slice(-added).forEach((slot) => { slot.networks = [...command.networks!]; });
          }
        }
      }
    } else if (command.type === "priority_source") {
      state.prioritySources.push({ id: command.id, url: command.url, videoId: youtubeVideoId(command.url), status: "pending", createdAt: command.createdAt });
      state.prioritySources = state.prioritySources.slice(-50);
    } else if (command.type === "work_now") {
      const next = state.jobs
        .filter((item) => ["queued", "retry"].includes(item.status))
        .sort((left, right) => left.targetDate.localeCompare(right.targetDate) || left.notBefore.localeCompare(right.notBefore))[0];
      if (next) {
        next.notBefore = iso(now);
        next.manualRunRequestedAt = iso(now);
        next.updatedAt = iso(now);
      }
    } else if (command.type === "ceo_schedule") {
      const incomingStrategyVersion = Math.max(0, Number(command.analytics?.creativeStrategyVersion || 0));
      state.analytics = command.analytics;
      for (const job of state.jobs.filter((item) => ["queued", "retry"].includes(item.status))) {
        if (Number(job.strategyVersion || 0) !== incomingStrategyVersion) {
          // Only not-yet-completed queue work is replanned. Scheduled/completed
          // jobs and their Metricool receipts are immutable.
          job.strategyVersion = incomingStrategyVersion;
          job.strategyReplannedAt = iso(now);
          job.lastError = null;
        }
        const plannedPosts = command.postsByDate?.[job.targetDate];
        if (Number.isFinite(plannedPosts)) resizeJob(state, job, Number(plannedPosts));
        const learnedSlots = command.slotsByDate[job.targetDate];
        if (!learnedSlots?.length) continue;
        const count = job.requirements.posts;
        const learned = learnedSlots.slice(0, count).map((localTime) => ({ localTime, timezone: state.timezone }));
        job.slots = restoreExplicitNetworkTargets(learned, job.slots);
        if (job.slots.length < count) resizeJob(state, job, count);
        job.updatedAt = iso(now);
      }
    }
    applied.add(command.id);
    changes += 1;
  }
  state.appliedCommandIds = [...applied].slice(-200);
  if (changes) {
    state.jobs.sort((left, right) => left.targetDate.localeCompare(right.targetDate) || left.createdAt.localeCompare(right.createdAt));
    state.updatedAt = iso(now);
  }
  return changes;
}

export function recordBlackRoomSourceUsage(
  state: BlackRoomQueueState,
  usage: Omit<BlackRoomSourceUsage, "recordedAt">,
  now = new Date(),
): BlackRoomSourceUsage {
  const videoId = String(usage.videoId || "").trim();
  if (!videoId) throw new Error("videoId is required");
  if (state.sourceHistory.some((item) => item.videoId === videoId
    && usage.segmentStartSeconds < item.segmentEndSeconds && item.segmentStartSeconds < usage.segmentEndSeconds)) {
    throw new Error(`BlackRoom source segment overlaps a previous clip: ${videoId}`);
  }
  if (!BLACKROOM_DURATION_VARIANTS.includes(usage.durationSeconds)) {
    throw new Error("durationSeconds must be 15, 30, 60, 120, 300, or 600");
  }
  const recorded: BlackRoomSourceUsage = { ...usage, videoId, recordedAt: iso(now) };
  state.sourceHistory.push(recorded);
  for (const source of state.prioritySources) {
    if (source.status === "pending" && source.videoId === videoId) source.status = "used";
  }
  state.updatedAt = iso(now);
  return recorded;
}

export function recordBlackRoomFailedSource(
  state: BlackRoomQueueState,
  videoId: string,
  reason: string,
  now = new Date(),
): BlackRoomFailedSource {
  const normalizedVideoId = String(videoId || "").trim();
  if (!normalizedVideoId) throw new Error("videoId is required");
  const recorded: BlackRoomFailedSource = {
    videoId: normalizedVideoId,
    failedAt: iso(now),
    reason: String(reason || "download failed").slice(0, 500),
  };
  state.failedSourceVideos = [
    ...state.failedSourceVideos.filter((item) => item.videoId !== normalizedVideoId),
    recorded,
  ].slice(-100);
  state.updatedAt = recorded.failedAt;
  return recorded;
}

export function recoverInterruptedBlackRoomJobs(state: BlackRoomQueueState, now = new Date()): number {
  let recovered = 0;
  for (const job of state.jobs) {
    if (job.status !== "processing") continue;
    if (job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() > now.getTime()) continue;
    job.status = "retry";
    job.leaseExpiresAt = null;
    job.notBefore = iso(now);
    job.updatedAt = iso(now);
    job.lastError ||= "Trabajo interrumpido por apagado o cierre; recuperado automáticamente.";
    recovered += 1;
  }
  return recovered;
}

/**
 * A missed day must never be treated as a backlog to dump on the next day.
 * Preserve the audit record, but remove it from eligibility for publication.
 */
export function cancelStaleBlackRoomJobs(state: BlackRoomQueueState, now = new Date()): number {
  const today = localDate(now, state.timezone);
  let cancelled = 0;
  for (const job of state.jobs) {
    if (!['queued', 'retry'].includes(job.status) || job.targetDate >= today) continue;
    job.status = 'cancelled';
    job.leaseExpiresAt = null;
    job.completedAt = null;
    job.updatedAt = iso(now);
    job.lastError = 'Lote vencido cancelado: no se publica contenido atrasado en bloque.';
    cancelled += 1;
  }
  if (cancelled) state.updatedAt = iso(now);
  return cancelled;
}

export function ensureBlackRoomScheduleBuffer(state: BlackRoomQueueState, now = new Date()): number {
  const today = localDate(now, state.timezone);
  cancelStaleBlackRoomJobs(state, now);
  const existing = new Set(state.jobs.map((job) => job.targetDate));
  let created = 0;
  for (let dayIndex = 1; dayIndex <= state.bufferDays; dayIndex += 1) {
    const targetDate = addCalendarDays(today, dayIndex);
    if (existing.has(targetDate)) continue;
    state.jobs.push(createDailyJob(state, targetDate, dayIndex - 1, now));
    existing.add(targetDate);
    created += 1;
  }
  state.jobs.sort((left, right) => left.targetDate.localeCompare(right.targetDate) || left.createdAt.localeCompare(right.createdAt));
  state.updatedAt = iso(now);
  return created;
}

/**
 * Keeps an enabled campaign actionable as calendar days pass.  The local
 * control process calls this during its normal health poll, so a full
 * two-week buffer does not silently run out after the original jobs have
 * been completed.  This only creates future queue work; it never republishes
 * a missed day or changes a Metricool-confirmed reservation.
 */
export function reconcileBlackRoomSchedule(state: BlackRoomQueueState, now = new Date()): {
  recovered: number;
  created: number;
} {
  const recovered = recoverInterruptedBlackRoomJobs(state, now);
  const created = state.enabled ? ensureBlackRoomScheduleBuffer(state, now) : 0;
  return { recovered, created };
}

export function startBlackRoomAgent(state: BlackRoomQueueState, weeks = 2, now = new Date()): number {
  const normalizedWeeks = Number.isFinite(weeks) ? Math.floor(weeks) : 2;
  state.enabled = true;
  state.pausedAt = null;
  state.bufferDays = Math.max(BLACKROOM_DEFAULT_BUFFER_DAYS, Math.min(28, normalizedWeeks * 7));
  state.updatedAt = iso(now);
  return ensureBlackRoomScheduleBuffer(state, now);
}

export function pauseBlackRoomAgent(state: BlackRoomQueueState, now = new Date()): void {
  state.enabled = false;
  state.pausedAt = iso(now);
  state.updatedAt = iso(now);
}

export function claimNextBlackRoomJob(state: BlackRoomQueueState, now = new Date(), leaseMinutes = 180): BlackRoomDailyJob | null {
  recoverInterruptedBlackRoomJobs(state, now);
  if (!state.enabled) return null;
  const job = state.jobs.find((candidate) =>
    ["queued", "retry"].includes(candidate.status)
    && new Date(candidate.notBefore).getTime() <= now.getTime());
  if (!job) return null;
  job.status = "processing";
  job.manualRunRequestedAt = null;
  job.attempts += 1;
  job.updatedAt = iso(now);
  job.leaseExpiresAt = new Date(now.getTime() + Math.max(5, leaseMinutes) * 60_000).toISOString();
  job.lastError = null;
  state.updatedAt = iso(now);
  return job;
}

export function completeBlackRoomJob(state: BlackRoomQueueState, jobId: string, now = new Date()): BlackRoomDailyJob {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error(`BlackRoom queue job not found: ${jobId}`);
  job.status = "completed";
  job.completedAt = iso(now);
  job.updatedAt = iso(now);
  job.leaseExpiresAt = null;
  job.lastError = null;
  state.updatedAt = iso(now);
  return job;
}

export function retryBlackRoomJob(state: BlackRoomQueueState, jobId: string, error: string, now = new Date()): BlackRoomDailyJob {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error(`BlackRoom queue job not found: ${jobId}`);
  const delayMinutes = Math.min(6 * 60, Math.max(10, 10 * 2 ** Math.max(0, job.attempts - 1)));
  job.status = "retry";
  job.updatedAt = iso(now);
  job.notBefore = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
  job.leaseExpiresAt = null;
  job.lastError = String(error || "Error desconocido").slice(0, 1000);
  state.updatedAt = iso(now);
  return job;
}

export function summarizeBlackRoomQueue(state: BlackRoomQueueState, now = new Date()) {
  const totals: Record<BlackRoomDailyJobStatus, number> = { queued: 0, processing: 0, retry: 0, scheduled: 0, completed: 0, cancelled: 0 };
  for (const job of state.jobs) totals[job.status] += 1;
  const pendingJobs = state.jobs.filter((job) => ["queued", "processing", "retry"].includes(job.status));
  const remainingPosts = pendingJobs.reduce((sum, job) => sum + Math.max(0, Number(job.requirements?.posts) || 0), 0);
  const remainingTargetDates = new Set(pendingJobs.map((job) => job.targetDate).filter(Boolean));
  const lastPendingJob = [...pendingJobs].sort((left, right) => left.targetDate.localeCompare(right.targetDate)).at(-1) || null;
  const today = localDate(now, state.timezone);
  const remainingCalendarDays = lastPendingJob
    ? Math.max(1, Math.ceil((new Date(`${lastPendingJob.targetDate}T12:00:00.000Z`).getTime() - new Date(`${today}T12:00:00.000Z`).getTime()) / 86_400_000) + 1)
    : 0;
  return {
    enabled: state.enabled,
    pausedAt: state.pausedAt,
    updatedAt: state.updatedAt,
    timezone: state.timezone,
    bufferDays: state.bufferDays,
    bufferWeeks: Math.ceil(state.bufferDays / 7),
    postsPerDay: state.postsPerDay,
    pendingPrioritySources: state.prioritySources.filter((source) => source.status === "pending").length,
    usedSourceVideos: new Set(state.sourceHistory.map((item) => item.videoId)).size,
    durationSamples: {
      ...Object.fromEntries(BLACKROOM_DURATION_VARIANTS.map((duration) => [
        duration,
        state.sourceHistory.filter((item) => item.durationSeconds === duration).length,
      ])),
    },
    analytics: state.analytics,
    totals,
    progress: {
      remainingPosts,
      remainingBatches: pendingJobs.length,
      remainingDays: remainingTargetDates.size,
      remainingCalendarDays,
      estimatedFinishDate: lastPendingJob?.targetDate || null,
    },
    nextJob: state.jobs.find((job) => ["queued", "retry", "processing"].includes(job.status)) || null,
  };
}

export async function readBlackRoomQueue(filePath = BLACKROOM_QUEUE_PATH, now = new Date()): Promise<BlackRoomQueueState> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs.map((job: BlackRoomDailyJob) => ({
      ...job,
      strategyVersion: Math.max(0, Number(job.strategyVersion ?? parsed.analytics?.creativeStrategyVersion ?? 0)),
      strategyReplannedAt: job.strategyReplannedAt || null,
      // Migrate old persisted queues that were created with every future job
      // immediately actionable. Never delay an active processing job.
      notBefore: ["queued", "retry"].includes(job.status)
        ? job.manualRunRequestedAt
          ? String(job.manualRunRequestedAt)
          : adaptiveReleaseTime(job.targetDate, now, job.status === "retry" ? job.notBefore : undefined)
        : job.notBefore,
      manualRunRequestedAt: job.manualRunRequestedAt || null,
      requirements: ["queued", "retry"].includes(job.status)
        ? {
          ...job.requirements,
          durationsSeconds: [...BLACKROOM_DURATION_VARIANTS],
          minimumClipsPerDuration: 1,
          neverRepeatSourceVideo: false,
          allowDistinctNonOverlappingSegments: true,
          neverReuseOverlappingSegment: true,
        }
        : job.requirements,
    })) : [];
    return {
      ...createBlackRoomQueueState(now),
      ...parsed,
      version: BLACKROOM_QUEUE_VERSION,
      bufferDays: Math.max(BLACKROOM_DEFAULT_BUFFER_DAYS, Number(parsed.bufferDays || 0)),
      jobs,
      sourceHistory: Array.isArray(parsed.sourceHistory) ? parsed.sourceHistory : [],
      failedSourceVideos: Array.isArray(parsed.failedSourceVideos) ? parsed.failedSourceVideos : [],
      appliedCommandIds: Array.isArray(parsed.appliedCommandIds) ? parsed.appliedCommandIds : [],
      prioritySources: Array.isArray(parsed.prioritySources) ? parsed.prioritySources : [],
      extraPostsByDate: parsed.extraPostsByDate && typeof parsed.extraPostsByDate === "object" ? parsed.extraPostsByDate : {},
      adHocExtraDates: Array.isArray(parsed.adHocExtraDates) ? parsed.adHocExtraDates : [],
      analytics: parsed.analytics && typeof parsed.analytics === "object"
        ? { ...createBlackRoomQueueState(now).analytics, ...parsed.analytics }
        : createBlackRoomQueueState(now).analytics,
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return createBlackRoomQueueState(now);
    throw error;
  }
}

export async function writeBlackRoomQueue(state: BlackRoomQueueState, filePath = BLACKROOM_QUEUE_PATH): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export async function withBlackRoomQueueLock<T>(
  filePath: string,
  operation: () => Promise<T>,
  timeoutMs = 10_000,
): Promise<T> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + timeoutMs;
  let lock;
  while (!lock) {
    try {
      lock = await open(lockPath, "wx");
      await lock.write(String(process.pid));
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const existingPid = Number((await readFile(lockPath, "utf8").catch(() => "0")).trim());
      let alive = false;
      if (Number.isInteger(existingPid) && existingPid > 0) {
        try { process.kill(existingPid, 0); alive = true; } catch { alive = false; }
      } else {
        const lockStat = await stat(lockPath).catch(() => null);
        alive = Boolean(lockStat && Date.now() - lockStat.mtimeMs < 30_000);
      }
      if (!alive) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for BlackRoom queue lock");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try { return await operation(); }
  finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}
