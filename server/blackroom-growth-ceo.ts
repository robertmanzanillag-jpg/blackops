import {
  callMetricoolMcpTool,
  listMetricoolMcpTools,
  BLACKROOM_METRICOOL_BLOG_ID,
  BLACKROOM_METRICOOL_NETWORKS,
  BLACKROOM_TIMEZONE,
  formatMetricoolMcpDate,
} from "./blackroom-metricool-bridge";
import type { BlackRoomAnalyticsNetwork, BlackRoomImportedAnalyticsSample } from "./blackroom-remote-control";
import type { LearningSnapshot, LearningNetwork } from "./blackroom-learning-observations";
import { evaluateBlackRoomLearning, evaluateDurationLearning, type DurationDecision, type VerifiedLearningDecision } from "./blackroom-verified-learning";

export const BLACKROOM_CEO_MIN_SAMPLES = 21;
export const BLACKROOM_CEO_DAILY_POSTS = 5;
export const BLACKROOM_CEO_EXPERIMENTAL_POSTS = 7;
export const BLACKROOM_CEO_MAX_DAILY_POSTS = 10;
// Shared baseline for the deterministic editor. The campaign planner may
// selectively raise a day to seven only after its separate evidence gate.
export const BLACKROOM_CEO_DEFAULT_NETWORK_TARGETS: Record<string, number> = {
  tiktok: 5,
  facebook: 5,
  youtube: 5,
};
export const BLACKROOM_CEO_MIN_SPACING_MINUTES = 90;
export const BLACKROOM_CEO_REFRESH_MS = 6 * 60 * 60_000;
// Keep a recent window constant for endpoints that only expose rolling
// analytics, but ask Metricool for the complete possible social-media
// history whenever the discovered tool supports dates or pagination.
export const BLACKROOM_CEO_ANALYTICS_LOOKBACK_DAYS = 30;
export const BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE = "2005-01-01";
export const BLACKROOM_CEO_ANALYTICS_PAGE_SIZE = 100;
export const BLACKROOM_CEO_ANALYTICS_MAX_PAGES = 250;
export const BLACKROOM_CEO_CREATIVE_MIN_SAMPLES = 5;
export const BLACKROOM_CEO_CREATIVE_NEW_SAMPLES = 3;
export const BLACKROOM_CEO_LOW_VIEW_THRESHOLD = 10;
export const BLACKROOM_CREATIVE_STRATEGIES = [
  "drop_first",
  "instant_drop",
  "build_then_drop",
  "crowd_reaction_first",
  "context_open_loop",
] as const;
export type BlackRoomCreativeStrategy = (typeof BLACKROOM_CREATIVE_STRATEGIES)[number];

export interface BlackRoomPublicationExperiment {
  metricoolId: string;
  platformPostId?: string;
  platformPostIdSource?: "receipt" | "reference";
  learningDecisionIds?: string;
  allocationMode?: "exploit" | "explore";
  learningTestId?: string;
  learningReference?: string;
  reservationId: string;
  network: string;
  creativeStrategy: BlackRoomCreativeStrategy;
  durationSeconds: number;
  format: "vertical" | "horizontal";
  language: "en" | "es";
  slot: string;
  publishedAt: string;
  dj?: string;
  sourceVideoId?: string;
  sourceVideoTitle?: string;
  segmentStartSeconds?: number;
  segmentEndSeconds?: number;
  dropOffsetSeconds?: number;
  hookFamily?: string;
  captionVariant?: string;
  creativeArmId?: string;
}

export interface BlackRoomMetricSnapshotCoverage {
  available24h: number;
  available72h: number;
  missingPublishedAt: number;
  tooYoung24h: number;
  tooYoung72h: number;
  limitation: string;
}

export interface BlackRoomCreativeCohort {
  strategy: BlackRoomCreativeStrategy;
  samples: number;
  medianViews: number;
  totalViews: number;
  lowViewRate: number;
}

export interface BlackRoomDurationCohort {
  durationSeconds: number;
  samples: number;
  medianViews: number;
  totalViews: number;
}

export interface BlackRoomValueCohort {
  value: string;
  samples: number;
  medianViews: number;
  totalViews: number;
}

export interface BlackRoomAttributionStats {
  /** Raw metric identities returned by Metricool/CSV. */
  totalRecords: number;
  /** Unique publication experiments with at least one linked metric identity. */
  matchedRecords: number;
  /** Unique experiments resolved by receipt/platform identifier. */
  exactMatches: number;
  /** Unique experiments resolved only by an unambiguous time/duration slot. */
  fallbackMatches: number;
  /** Raw metric identities that could not be linked to any experiment. */
  unmatchedRecords: number;
  /** Share of raw metric identities that were linked, before experiment dedupe. */
  matchRate: number;
}

export interface BlackRoomCeoAnalytics {
  manualExploration?: import("./blackroom-manual-exploration").ManualExplorations;
  durationLearning?: Record<LearningNetwork, DurationDecision>;
  verifiedLearning?: Record<LearningNetwork, VerifiedLearningDecision>;
  /** Total imported posts across all connected networks, for visibility. */
  sampleCount: number;
  /** Smallest usable cohort across the networks, used for cadence/time changes. */
  comparableSampleCount: number;
  lastCheckedAt: string;
  nextCheckAt: string;
  confidence: "collecting" | "learning";
  networkSamples: Record<string, number>;
  /** Samples safely linked to a publication experiment. Only these may drive
   * cadence, creative, duration or winner decisions. */
  attributedSamplesByNetwork?: Record<string, number>;
  networkConfidence?: Record<string, "collecting" | "learning">;
  networkEngagementRate?: Record<string, number>;
  networkCompletionRate?: Record<string, number>;
  networkAverageWatchSeconds?: Record<string, number>;
  /** Per-network read failures. A failed network must not hide the data from
   * the other connected networks. */
  networkErrors?: Record<string, string>;
  /** Earliest date requested from Metricool. Availability still depends on
   * the connected network and the Metricool plan's retention. */
  historyStartDate?: string;
  /** True means the discovered tool was exhausted for the requested range.
   * False means Metricool did not expose pagination/date controls or hit a
   * defensive request limit. */
  historyCompleteByNetwork?: Record<string, boolean>;
  /** Number of Metricool tool calls used to assemble each deduplicated
   * historical cohort. */
  historyRequestsByNetwork?: Record<string, number>;
  /** Samples supplied by deterministic Metricool CSV exports on the Mac. */
  importedSamplesByNetwork?: Record<string, number>;
  recommendedTimes: string[];
  recommendedTimesByNetwork?: Record<string, string[]>;
  networkMedianViews?: Record<string, number>;
  networkLowViewRate?: Record<string, number>;
  networkDailyTargets?: Record<string, number>;
  tiktokMedianViews: number;
  tiktokLowViewRate: number;
  creativeStrategy: BlackRoomCreativeStrategy;
  creativeStrategyVersion: number;
  creativeStrategySampleBaseline: number;
  creativeStrategyPostIdsBaseline: string[];
  creativeChangedAt: string;
  creativeReason: string;
  creativePerformance?: BlackRoomCreativeCohort[];
  durationPerformance?: BlackRoomDurationCohort[];
  preferredDurations?: number[];
  preferredDjs?: string[];
  preferredSourceVideoIds?: string[];
  preferredFormats?: string[];
  preferredLanguages?: string[];
  formatPerformance?: BlackRoomValueCohort[];
  languagePerformance?: BlackRoomValueCohort[];
  slotPerformance?: BlackRoomValueCohort[];
  attributionByNetwork?: Record<string, BlackRoomAttributionStats>;
  snapshotCoverageByNetwork?: Record<string, BlackRoomMetricSnapshotCoverage>;
  networkCreativePerformance?: Record<string, BlackRoomCreativeCohort[]>;
  networkDurationPerformance?: Record<string, BlackRoomDurationCohort[]>;
  experimentAllocation?: { exploitShare: 0.8; exploreShare: 0.2; minimumWinnerSamples: 5 };
  reason: string;
}

export function summarizeBlackRoomSnapshotCoverage(
  samples: Array<Pick<BlackRoomImportedAnalyticsSample, "publishedAt">>,
  observedAt = new Date(),
): BlackRoomMetricSnapshotCoverage {
  let available24h = 0, available72h = 0, missingPublishedAt = 0, tooYoung24h = 0, tooYoung72h = 0;
  for (const sample of samples) {
    const published = sample.publishedAt ? new Date(sample.publishedAt).getTime() : Number.NaN;
    if (!Number.isFinite(published)) { missingPublishedAt += 1; continue; }
    const age = observedAt.getTime() - published;
    if (age >= 24 * 60 * 60_000) available24h += 1; else tooYoung24h += 1;
    if (age >= 72 * 60 * 60_000) available72h += 1; else tooYoung72h += 1;
  }
  return {
    available24h, available72h, missingPublishedAt, tooYoung24h, tooYoung72h,
    limitation: "Metricool/CSV exposes the latest cumulative value, not a guaranteed historical point-in-time value; 24h/72h labels describe observation eligibility only.",
  };
}

/** Stable 80/20 arm assignment: four of every five slots exploit a proven
 * winner; the fifth explores. Without five comparable samples, all arms stay
 * in deterministic exploration so a noisy first result cannot become a winner. */
export function allocateBlackRoomCreativeArm(input: {
  seed: string;
  cohorts?: BlackRoomCreativeCohort[];
  fallback?: BlackRoomCreativeStrategy;
}): { strategy: BlackRoomCreativeStrategy; mode: "exploit" | "explore" } {
  const cohorts = input.cohorts || [];
  const proven = cohorts.filter((item) => item.samples >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES)
    .sort((a, b) => b.medianViews - a.medianViews || b.totalViews - a.totalViews || a.strategy.localeCompare(b.strategy));
  const hash = [...input.seed].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  const explore = hash % 5 === 0 || !proven.length;
  if (!explore) return { strategy: proven[0].strategy, mode: "exploit" };
  const winner = proven[0]?.strategy;
  const pool = BLACKROOM_CREATIVE_STRATEGIES.filter((strategy) => strategy !== winner);
  return { strategy: pool[hash % pool.length] || input.fallback || "drop_first", mode: "explore" };
}

export function recommendBlackRoomTimesFromImportedSamples(
  samples: BlackRoomImportedAnalyticsSample[],
): string[] {
  const buckets = new Map<string, number[]>();
  for (const sample of samples) {
    const raw = String(sample.publishedAt || "");
    const localMatch = /T(\d{2}):(\d{2})/.exec(raw);
    if (!localMatch) continue;
    const hour = Number(localMatch[1]);
    const minute = Number(localMatch[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) continue;
    const roundedMinutes = Math.round(minute / 30) * 30;
    const bucketHour = (hour + Math.floor(roundedMinutes / 60)) % 24;
    const time = `${String(bucketHour).padStart(2, "0")}:${String(roundedMinutes % 60).padStart(2, "0")}`;
    const values = buckets.get(time) || [];
    values.push(sample.views);
    buckets.set(time, values);
  }
  return [...buckets]
    .map(([time, views]) => ({
      time,
      count: views.length,
      median: median(views),
    }))
    .sort((left, right) => right.median - left.median || right.count - left.count || left.time.localeCompare(right.time))
    .slice(0, 4)
    .map((bucket) => bucket.time);
}

function records(value: unknown): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, any>;
    found.push(record);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return found;
}

function toolPayload(value: any): unknown {
  const texts = Array.isArray(value?.content)
    ? value.content.map((item: any) => item?.text).filter((item: any) => typeof item === "string")
    : [];
  if (!texts.length) return value?.structuredContent ?? value;
  const parsed = texts.map((text: string) => {
    try { return JSON.parse(text); } catch { return text; }
  });
  return parsed.length === 1 ? parsed[0] : parsed;
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function metricValue(record: Record<string, any>, names: string[]): number | null {
  const accepted = new Set(names.map(normalizedName));
  for (const [key, raw] of Object.entries(record)) {
    if (!accepted.has(normalizedName(key))) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function metricRecordId(record: Record<string, any>): string | null {
  const id = record.id
    ?? record.postId
    ?? record.post_id
    ?? record.postUuid
    ?? record.uuid
    ?? record.videoId
    ?? record.video_id
    ?? record.socialNetworkId
    ?? record.social_network_id
    ?? record.networkId
    ?? record.network_id
    ?? record.publicationId
    ?? record.publication_id
    ?? record.url
    ?? record.permalink
    ?? record.postUrl
    ?? record.post_url;
  return id == null || String(id).trim() === "" ? null : String(id);
}

function metricIdAliases(value: string): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const aliases = new Set([raw, raw.toLowerCase()]);
  try {
    const url = new URL(raw);
    aliases.add(`${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`);
    const segments = url.pathname.split("/").filter(Boolean);
    const finalSegment = segments.at(-1);
    if (finalSegment && finalSegment.length >= 6) aliases.add(finalSegment.toLowerCase());
    for (const key of ["id", "postId", "video", "v"]) {
      const found = url.searchParams.get(key);
      if (found) aliases.add(found.toLowerCase());
    }
  } catch { /* Metricool IDs are commonly opaque, not URLs. */ }
  return [...aliases];
}

export function extractBlackRoomMetricSamples(value: unknown): number {
  return extractBlackRoomMetricSampleIds(value).length;
}

export function extractBlackRoomMetricSampleIds(value: unknown): string[] {
  const ids = new Set<string>();
  for (const record of records(value)) {
    const views = metricValue(record, ["views", "impressions", "reach", "videoViews", "video_views", "viewCount", "view_count", "totalViews", "plays", "playCount", "blue_reels_play_count"]);
    const id = metricRecordId(record);
    if (views !== null && id != null) ids.add(String(id));
  }
  return [...ids];
}

export function extractBlackRoomViewRecords(value: unknown): Array<{ id: string; views: number }> {
  const samples = new Map<string, number>();
  for (const record of records(value)) {
    const views = metricValue(record, ["views", "videoViews", "video_views", "viewCount", "view_count", "totalViews", "plays", "playCount", "blue_reels_play_count"]);
    const id = metricRecordId(record);
    if (views !== null && id != null) samples.set(String(id), views);
  }
  return [...samples].map(([id, views]) => ({ id, views }));
}

export function extractBlackRoomViewSamples(value: unknown): number[] {
  return extractBlackRoomViewRecords(value).map((sample) => sample.views);
}

export function extractBlackRoomExperimentCohorts(
  viewRecords: Array<{ id: string; views: number; publishedAt?: string; durationSeconds?: number }>,
  experiments: BlackRoomPublicationExperiment[],
  network: string,
): {
  viewsByStrategy: Partial<Record<BlackRoomCreativeStrategy, number[]>>;
  viewsByDuration: Record<string, number[]>;
  viewsByDj: Record<string, number[]>;
  viewsBySourceVideo: Record<string, number[]>;
  viewsByFormat: Record<string, number[]>;
  viewsByLanguage: Record<string, number[]>;
  viewsBySlot: Record<string, number[]>;
  attribution: BlackRoomAttributionStats;
} {
  const networkExperiments = experiments.filter((experiment) => experiment.network === network);
  const experimentsById = new Map<string, BlackRoomPublicationExperiment>();
  for (const experiment of networkExperiments) {
    for (const alias of metricIdAliases(experiment.metricoolId)) experimentsById.set(alias, experiment);
  }
  const viewsByStrategy: Partial<Record<BlackRoomCreativeStrategy, number[]>> = {};
  const viewsByDuration: Record<string, number[]> = {};
  const viewsByDj: Record<string, number[]> = {};
  const viewsBySourceVideo: Record<string, number[]> = {};
  const viewsByFormat: Record<string, number[]> = {};
  const viewsByLanguage: Record<string, number[]> = {};
  const viewsBySlot: Record<string, number[]> = {};
  const matchedExperiments = new Map<string, { experiment: BlackRoomPublicationExperiment; views: number; exact: boolean }>();
  let associatedRecords = 0;
  let exactMatches = 0;
  let fallbackMatches = 0;
  for (const record of viewRecords) {
    let experiment = metricIdAliases(String(record.id)).map((alias) => experimentsById.get(alias)).find(Boolean);
    const exact = Boolean(experiment);
    if (!experiment && record.publishedAt) {
      const minute = String(record.publishedAt).slice(0, 16);
      const candidates = networkExperiments.filter((candidate) => candidate.network === network
        && candidate.publishedAt.slice(0, 16) === minute
        && (!record.durationSeconds || candidate.durationSeconds === record.durationSeconds));
      if (candidates.length === 1) experiment = candidates[0];
    }
    if (!experiment) continue;
    associatedRecords += 1;
    const key = `${experiment.network}:${experiment.metricoolId}:${experiment.reservationId}`;
    const previous = matchedExperiments.get(key);
    if (!previous || (exact && !previous.exact)) matchedExperiments.set(key, { experiment, views: record.views, exact });
  }
  for (const { experiment, views } of matchedExperiments.values()) {
    (viewsByStrategy[experiment.creativeStrategy] ||= []).push(views);
    (viewsByDuration[String(experiment.durationSeconds)] ||= []).push(views);
    if (experiment.dj && experiment.dj !== "unknown") (viewsByDj[experiment.dj] ||= []).push(views);
    if (experiment.sourceVideoId) (viewsBySourceVideo[experiment.sourceVideoId] ||= []).push(views);
    (viewsByFormat[experiment.format] ||= []).push(views);
    (viewsByLanguage[experiment.language] ||= []).push(views);
    (viewsBySlot[experiment.slot] ||= []).push(views);
  }
  const matchedRecords = matchedExperiments.size;
  exactMatches = [...matchedExperiments.values()].filter((item) => item.exact).length;
  fallbackMatches = matchedRecords - exactMatches;
  return {
    viewsByStrategy, viewsByDuration, viewsByDj, viewsBySourceVideo, viewsByFormat, viewsByLanguage, viewsBySlot,
    attribution: {
      totalRecords: viewRecords.length,
      matchedRecords,
      exactMatches,
      fallbackMatches,
      unmatchedRecords: Math.max(0, viewRecords.length - associatedRecords),
      matchRate: viewRecords.length ? associatedRecords / viewRecords.length : 0,
    },
  };
}

function rankProvenExperimentValues(groups: Record<string, number[]>): string[] {
  return Object.entries(groups)
    .map(([value, views]) => ({ value, views: views.filter((item) => Number.isFinite(item) && item >= 0) }))
    .filter((group) => group.views.length >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES)
    .sort((left, right) => median(right.views) - median(left.views) || right.views.length - left.views.length)
    .slice(0, 3)
    .map((group) => group.value);
}

function summarizeValueCohorts(groups: Record<string, number[]>): BlackRoomValueCohort[] {
  return Object.entries(groups).map(([value, rawViews]) => {
    const views = rawViews.map(Number).filter((item) => Number.isFinite(item) && item >= 0);
    return { value, samples: views.length, medianViews: median(views), totalViews: views.reduce((sum, item) => sum + item, 0) };
  }).sort((left, right) => Number(right.samples >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES) - Number(left.samples >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES)
    || right.medianViews - left.medianViews || right.samples - left.samples || left.value.localeCompare(right.value));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function planBlackRoomNetworkLearning(input: {
  viewsByNetwork: Record<string, number[]>;
}): {
  networkMedianViews: Record<string, number>;
  networkLowViewRate: Record<string, number>;
  networkDailyTargets: Record<string, number>;
} {
  const networkMedianViews: Record<string, number> = {};
  const networkLowViewRate: Record<string, number> = {};
  const networkDailyTargets: Record<string, number> = {};
  for (const network of BLACKROOM_METRICOOL_NETWORKS) {
    const views = (input.viewsByNetwork[network] || [])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 0);
    const sampleCount = views.length;
    const networkMedian = median(views);
    const lowRate = sampleCount
      ? views.filter((value) => value <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD).length / sampleCount
      : 0;
    let target = 5;
    if (sampleCount >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES && (networkMedian <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD || lowRate >= 0.7)) {
      target = 5;
    } else if (sampleCount >= BLACKROOM_CEO_MIN_SAMPLES && networkMedian >= 50 && lowRate <= 0.4) {
      target = BLACKROOM_CEO_EXPERIMENTAL_POSTS;
    }
    networkMedianViews[network] = networkMedian;
    networkLowViewRate[network] = lowRate;
    networkDailyTargets[network] = target;
  }
  return { networkMedianViews, networkLowViewRate, networkDailyTargets };
}

export function planBlackRoomDurationLearning(input: {
  viewsByDuration: Record<string, number[]>;
}): { durationPerformance: BlackRoomDurationCohort[]; preferredDurations: number[] } {
  const durationPerformance = [15, 30, 60, 120, 300, 600].map((durationSeconds): BlackRoomDurationCohort => {
    const views = (input.viewsByDuration[String(durationSeconds)] || [])
      .map(Number).filter((value) => Number.isFinite(value) && value >= 0);
    return { durationSeconds, samples: views.length, medianViews: median(views), totalViews: views.reduce((sum, value) => sum + value, 0) };
  });
  const preferredDurations = [...durationPerformance]
    .sort((left, right) => Number(right.samples >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES) - Number(left.samples >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES)
      || right.medianViews - left.medianViews || right.totalViews - left.totalViews || left.durationSeconds - right.durationSeconds)
    .map((cohort) => cohort.durationSeconds);
  return { durationPerformance, preferredDurations };
}

/**
 * Protect the baseline while still buying a small amount of learning.
 * A seven-post day is permitted only after all three networks have a
 * comparable sample and at least two show healthy distribution.  We use two
 * spaced experiment days per fortnight, so a weak TikTok result cannot be
 * mistaken for audience fatigue caused by a sudden daily flood.
 */
export function planBlackRoomCampaignPosts(input: {
  dayIndex: number;
  analytics: Pick<BlackRoomCeoAnalytics, "sampleCount" | "networkMedianViews" | "networkLowViewRate"> & Partial<Pick<BlackRoomCeoAnalytics, "comparableSampleCount">>;
}): number {
  const sampleCount = Math.max(0, Number(input.analytics.comparableSampleCount ?? input.analytics.sampleCount ?? 0));
  if (sampleCount < BLACKROOM_CEO_MIN_SAMPLES) return BLACKROOM_CEO_DAILY_POSTS;
  const healthyNetworks = BLACKROOM_METRICOOL_NETWORKS.filter((network) =>
    Number(input.analytics.networkMedianViews?.[network] || 0) >= 50
    && Number(input.analytics.networkLowViewRate?.[network] ?? 1) <= 0.4,
  ).length;
  // Days 3 and 10 of the rolling fourteen-day plan are the controlled volume
  // experiments. All other days remain comparable five-post baselines.
  return healthyNetworks >= 2 && [2, 9].includes(input.dayIndex % 14)
    ? BLACKROOM_CEO_EXPERIMENTAL_POSTS
    : BLACKROOM_CEO_DAILY_POSTS;
}

export function planBlackRoomCreativeLearning(input: {
  views: number[];
  postIds?: string[];
  viewsByStrategy?: Partial<Record<BlackRoomCreativeStrategy, number[]>>;
  previous?: Partial<BlackRoomCeoAnalytics> | null;
  now?: Date;
}): Pick<BlackRoomCeoAnalytics,
  "tiktokMedianViews" | "tiktokLowViewRate" | "creativeStrategy" | "creativeStrategyVersion"
  | "creativeStrategySampleBaseline" | "creativeStrategyPostIdsBaseline" | "creativeChangedAt" | "creativeReason"
  | "creativePerformance"> {
  const now = input.now || new Date();
  const samples = input.views
    .map((views, index) => ({ views, id: input.postIds?.[index] == null ? "" : String(input.postIds[index]) }))
    .filter((sample) => Number.isFinite(sample.views) && sample.views >= 0);
  const views = samples.map((sample) => sample.views);
  const previousStrategy = BLACKROOM_CREATIVE_STRATEGIES.includes(input.previous?.creativeStrategy as BlackRoomCreativeStrategy)
    ? input.previous!.creativeStrategy as BlackRoomCreativeStrategy
    : "drop_first";
  const previousVersion = Math.max(0, Number(input.previous?.creativeStrategyVersion || 0));
  const previousBaseline = Math.max(0, Number(input.previous?.creativeStrategySampleBaseline || 0));
  const postIds = samples.map((sample) => sample.id).filter(Boolean);
  const previousPostIds = Array.isArray(input.previous?.creativeStrategyPostIdsBaseline)
    ? input.previous!.creativeStrategyPostIdsBaseline.map(String)
    : [];
  const newViews = postIds.length && previousPostIds.length
    ? views.filter((_value, index) => !previousPostIds.includes(postIds[index]))
    : views;
  const evaluationViews = previousVersion > 0 && previousPostIds.length ? newViews : views;
  const requiredEvidence = previousVersion > 0 ? BLACKROOM_CEO_CREATIVE_NEW_SAMPLES : BLACKROOM_CEO_CREATIVE_MIN_SAMPLES;
  const tiktokMedianViews = median(evaluationViews);
  const tiktokLowViewRate = evaluationViews.length
    ? evaluationViews.filter((value) => value <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD).length / evaluationViews.length
    : 0;
  const lowPerformance = evaluationViews.length >= requiredEvidence
    && (tiktokMedianViews <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD || tiktokLowViewRate >= 0.7);
  const newPostCount = postIds.length
    ? postIds.filter((id) => !previousPostIds.includes(id)).length
    : views.length - previousBaseline;
  const enoughNewEvidence = newPostCount >= BLACKROOM_CEO_CREATIVE_NEW_SAMPLES;
  const shouldRotate = lowPerformance && enoughNewEvidence;
  const strategyIndex = BLACKROOM_CREATIVE_STRATEGIES.indexOf(previousStrategy);
  const creativePerformance = BLACKROOM_CREATIVE_STRATEGIES.map((strategy): BlackRoomCreativeCohort => {
    const cohortViews = (input.viewsByStrategy?.[strategy] || []).map(Number).filter((value) => Number.isFinite(value) && value >= 0);
    return {
      strategy,
      samples: cohortViews.length,
      medianViews: median(cohortViews),
      totalViews: cohortViews.reduce((sum, value) => sum + value, 0),
      lowViewRate: cohortViews.length ? cohortViews.filter((value) => value <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD).length / cohortViews.length : 0,
    };
  });
  const provenCohorts = creativePerformance.filter((cohort) => cohort.samples >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES);
  const provenWinner = provenCohorts.length >= 2
    ? provenCohorts.sort((left, right) => right.medianViews - left.medianViews || right.totalViews - left.totalViews)[0]?.strategy
    : undefined;
  const fallbackStrategy = shouldRotate
    ? BLACKROOM_CREATIVE_STRATEGIES[(strategyIndex + 1) % BLACKROOM_CREATIVE_STRATEGIES.length]
    : previousStrategy;
  const creativeStrategy = provenWinner || fallbackStrategy;
  const changed = creativeStrategy !== previousStrategy;
  return {
    tiktokMedianViews,
    tiktokLowViewRate,
    creativeStrategy,
    creativeStrategyVersion: previousVersion + (changed ? 1 : 0),
    creativeStrategySampleBaseline: changed ? views.length : previousBaseline,
    creativeStrategyPostIdsBaseline: changed ? postIds.slice(-200) : previousPostIds,
    creativeChangedAt: changed ? now.toISOString() : String(input.previous?.creativeChangedAt || ""),
    creativePerformance,
    creativeReason: provenWinner && provenWinner !== previousStrategy
      ? `El CEO comparó cohortes con evidencia y eligió ${creativeStrategy}.`
      : shouldRotate
      ? `TikTok sigue bajo (${tiktokMedianViews.toFixed(1)} vistas de mediana; ${(tiktokLowViewRate * 100).toFixed(0)}% en 10 o menos). El CEO cambió a ${creativeStrategy}.`
      : evaluationViews.length < requiredEvidence
        ? `Recolectando señal creativa de TikTok (${evaluationViews.length}/${requiredEvidence}).`
        : lowPerformance
          ? `Rendimiento bajo confirmado, esperando ${BLACKROOM_CEO_CREATIVE_NEW_SAMPLES} resultados nuevos antes de otro cambio.`
          : `La técnica ${creativeStrategy} se mantiene porque la distribución de TikTok mejoró.`,
  };
}

function timeToMinutes(value: string): number | null {
  const match = /(?:^|T)(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 1440 ? minutes : null;
}

export function extractBlackRoomBestTimes(value: unknown): string[] {
  const ranked = records(value).flatMap((record) => {
    const raw = record.time ?? record.hour ?? record.localTime ?? record.dateTime ?? record.datetime;
    const minutes = timeToMinutes(String(raw ?? ""));
    if (minutes == null && Number.isInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 23) {
      return [{ minutes: Number(raw) * 60, score: metricValue(record, ["score", "value", "engagement", "weight"]) || 0 }];
    }
    return minutes == null ? [] : [{ minutes, score: metricValue(record, ["score", "value", "engagement", "weight"]) || 0 }];
  }).sort((left, right) => right.score - left.score || left.minutes - right.minutes);
  return [...new Set(ranked.map((item) => `${String(Math.floor(item.minutes / 60)).padStart(2, "0")}:${String(item.minutes % 60).padStart(2, "0")}`))];
}

function circularDistance(left: number, right: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, 1440 - direct);
}

export function buildBlackRoomLearningSlots(input: {
  dayIndex: number;
  recommendedTimes?: string[];
  sampleCount?: number;
  posts?: number;
}): string[] {
  const posts = Math.max(1, Math.min(16, Math.floor(input.posts || BLACKROOM_CEO_DAILY_POSTS)));
  const baseline = Array.from({ length: posts }, (_, index) => (30 + input.dayIndex * 90 + Math.round(index * 1440 / posts)) % 1440);
  if (Number(input.sampleCount || 0) >= BLACKROOM_CEO_MIN_SAMPLES) {
    const recommended = (input.recommendedTimes || []).map(timeToMinutes).filter((value): value is number => value != null);
    let replaced = 0;
    for (const candidate of recommended) {
      if (replaced >= 2) break;
      const replaceIndex = baseline.reduce((best, value, index) =>
        circularDistance(value, candidate) < circularDistance(baseline[best], candidate) ? index : best, 0);
      if (baseline.some((value, index) => index !== replaceIndex && circularDistance(value, candidate) < BLACKROOM_CEO_MIN_SPACING_MINUTES)) continue;
      baseline[replaceIndex] = candidate;
      replaced += 1;
    }
  }
  return baseline.sort((left, right) => left - right).map((minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
}

type BlackRoomMetricoolArgumentWindow = {
  start?: string;
  end?: string;
  page?: number;
  connector?: string;
  metrics?: string[];
};

function normalizedSchemaKeys(schema: Record<string, any> | undefined): Array<{ key: string; normalized: string }> {
  return Object.keys(schema?.properties || {}).map((key) => ({
    key,
    normalized: normalizedName(key),
  }));
}

function schemaValue(schema: Record<string, any> | undefined, key: string, value: string | number): string | number {
  const type = schema?.properties?.[key]?.type;
  if (type === "integer" || type === "number") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  return String(value);
}

function schemaDateValue(
  schema: Record<string, any> | undefined,
  key: string,
  date: string,
  endOfDay: boolean,
): string {
  const property = schema?.properties?.[key] || {};
  const description = String(property.description || property.title || "");
  const expectsDateTime = /iso\s*8601|date.?time|yyyy-mm-ddt|hh:mm/i.test(description)
    || ["fromdate", "todate"].includes(normalizedName(key));
  if (!expectsDateTime) return date;
  const wallClock = `${date}T${endOfDay ? "23:59:59" : "00:00:00"}`;
  return formatMetricoolMcpDate(wallClock, BLACKROOM_TIMEZONE);
}

function buildToolArguments(
  schema: Record<string, any> | undefined,
  network: string,
  now: Date,
  env: NodeJS.ProcessEnv,
  window: BlackRoomMetricoolArgumentWindow = {},
) {
  const properties = schema?.properties || {};
  const args: Record<string, unknown> = {};
  const start = window.start || new Date(now.getTime() - BLACKROOM_CEO_ANALYTICS_LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10);
  const end = window.end || now.toISOString().slice(0, 10);
  const page = Math.max(1, Math.floor(window.page || 1));
  for (const key of Object.keys(properties)) {
    const normalized = normalizedName(key);
    if (normalized === "blogid" || normalized === "brandid") args[key] = schemaValue(
      schema,
      key,
      env.BLACKROOM_METRICOOL_BLOG_ID || BLACKROOM_METRICOOL_BLOG_ID,
    );
    else if (normalized === "userid") args[key] = schemaValue(schema, key, env.METRICOOL_USER_ID || "");
    else if (["network", "platform", "socialnetwork", "provider"].includes(normalized)) args[key] = network;
    else if (["start", "startdate", "initdate", "initialdate", "from", "fromdate", "datefrom", "sincedate"].includes(normalized)) {
      args[key] = schemaDateValue(schema, key, start, false);
    } else if (["end", "enddate", "to", "todate", "dateto", "untildate"].includes(normalized)) {
      args[key] = schemaDateValue(schema, key, end, true);
    }
    else if (normalized === "timezone") args[key] = BLACKROOM_TIMEZONE;
    else if (normalized === "connector" && window.connector) args[key] = window.connector;
    else if (["metrics", "metricids", "metricfields"].includes(normalized) && window.metrics?.length) args[key] = window.metrics;
    else if (["limit", "pagesize", "perpage", "maxresults", "count"].includes(normalized)) args[key] = BLACKROOM_CEO_ANALYTICS_PAGE_SIZE;
    else if (["page", "pagenumber", "pageindex"].includes(normalized)) args[key] = page;
    else if (["offset", "skip"].includes(normalized)) args[key] = (page - 1) * BLACKROOM_CEO_ANALYTICS_PAGE_SIZE;
  }
  return args;
}

function payloadHasMore(value: unknown, returned: number): boolean {
  for (const record of records(value)) {
    for (const [key, raw] of Object.entries(record)) {
      const normalized = key.toLowerCase().replace(/_/g, "");
      if (["hasmore", "hasnext", "hasnextpage"].includes(normalized) && raw === true) return true;
      if (["nextpage", "nextcursor", "cursor"].includes(normalized) && raw != null && raw !== "" && raw !== false) return true;
      if (["total", "totalcount", "totalresults", "count"].includes(normalized)) {
        const total = Number(raw);
        if (Number.isFinite(total) && total > returned) return true;
      }
    }
  }
  return false;
}

function dateRangeSupported(schema: Record<string, any> | undefined): boolean {
  const normalized = normalizedSchemaKeys(schema).map((entry) => entry.normalized);
  return normalized.some((key) => ["start", "startdate", "initdate", "initialdate", "from", "fromdate", "datefrom", "sincedate"].includes(key))
    && normalized.some((key) => ["end", "enddate", "to", "todate", "dateto", "untildate"].includes(key));
}

function paginationSupported(schema: Record<string, any> | undefined): boolean {
  return normalizedSchemaKeys(schema).some(({ normalized }) =>
    ["page", "pagenumber", "pageindex", "offset", "skip"].includes(normalized));
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function splitDateRange(start: string, end: string): [string, string, string, string] | null {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return null;
  const middle = new Date(startMs + Math.floor((endMs - startMs) / 2)).toISOString().slice(0, 10);
  return [start, middle, nextDate(middle), end];
}

function configuredHistoryStartDate(env: NodeJS.ProcessEnv): string {
  const configured = String(env.BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(configured)
    ? configured
    : BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE;
}

type BlackRoomMetricoolMetricDefinition = {
  id: string;
  label: string;
};

function extractMetricoolMetricDefinitions(value: unknown): BlackRoomMetricoolMetricDefinition[] {
  const definitions = new Map<string, string>();
  const metricCode = /^[A-Z]{2,}[A-Z0-9_.-]*\d+[A-Z0-9_.-]*$/i;
  const visitStrings = (candidate: unknown) => {
    if (Array.isArray(candidate)) return candidate.forEach(visitStrings);
    if (typeof candidate === "string" && metricCode.test(candidate.trim())) {
      definitions.set(candidate.trim(), candidate.trim());
    }
  };
  visitStrings(value);
  for (const record of records(value)) {
    const id = record.fieldId
      ?? record.field_id
      ?? record.field
      ?? record.metricId
      ?? record.metric_id
      ?? record.metricCode
      ?? record.metric_code
      ?? record.code
      ?? record.id;
    const label = record.displayName
      ?? record.display_name
      ?? record.metricName
      ?? record.metric_name
      ?? record.fieldName
      ?? record.field_name
      ?? record.label
      ?? record.name
      ?? record.title
      ?? record.description
      ?? record.metric;
    if (typeof id === "string" && id.trim() && typeof label === "string" && label.trim()) {
      definitions.set(id.trim(), label.trim());
    }
    for (const [key, raw] of Object.entries(record)) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      if (metricCode.test(key)) definitions.set(key, raw.trim());
    }
  }
  return [...definitions].map(([id, label]) => ({ id, label }));
}

function preferredMetricDefinitions(
  definitions: BlackRoomMetricoolMetricDefinition[],
): BlackRoomMetricoolMetricDefinition[] {
  const score = (definition: BlackRoomMetricoolMetricDefinition): number => {
    const value = `${definition.id} ${definition.label}`.toLowerCase();
    if (/\bviews?\b|video.?views?|view.?count/.test(value)) return 0;
    if (/play/.test(value)) return 1;
    if (/impression/.test(value)) return 2;
    if (/reach/.test(value)) return 3;
    if (/engagement|interaction/.test(value)) return 4;
    if (/video|post|count/.test(value)) return 5;
    if (/share|like/.test(value)) return 6;
    return 10;
  };
  return [...definitions].sort((left, right) =>
    score(left) - score(right) || left.id.localeCompare(right.id)).slice(0, 1);
}

function identityMetricDefinitions(
  definitions: BlackRoomMetricoolMetricDefinition[],
): BlackRoomMetricoolMetricDefinition[] {
  const score = (definition: BlackRoomMetricoolMetricDefinition): number => {
    const value = `${definition.id} ${definition.label}`.toLowerCase();
    if (/video.?id|post.?id|publication.?id|network.?id/.test(value)) return 0;
    if (/video.?url|post.?url|permalink|post.?link|share.?url/.test(value)) return 1;
    return 10;
  };
  return [...definitions]
    .filter((definition) => score(definition) < 10)
    .sort((left, right) => score(left) - score(right) || left.id.localeCompare(right.id))
    .slice(0, 1);
}

function codedMetricRecordId(
  record: Record<string, any>,
  metricId: string,
  identityDefinitions: BlackRoomMetricoolMetricDefinition[],
): string | null {
  const direct = metricRecordId(record);
  if (direct && direct !== metricId) return direct;
  for (const definition of identityDefinitions) {
    const entry = Object.entries(record).find(([key]) => normalizedName(key) === normalizedName(definition.id));
    const value = entry?.[1];
    if (value != null && String(value).trim() && String(value) !== metricId) return String(value);
  }
  // Analytics/evolution rows can also contain dates and metric values, but
  // they are aggregates rather than individual posts. Never count those rows
  // as published-post samples because doing so would give the CEO false
  // confidence and teach it from days/buckets instead of content.
  return null;
}

function extractCodedViewRecords(
  value: unknown,
  definitions: BlackRoomMetricoolMetricDefinition[],
): Array<{ id: string; views: number }> {
  const performanceDefinitions = preferredMetricDefinitions(definitions);
  const identityDefinitions = identityMetricDefinitions(definitions);
  const definitionById = new Map(definitions.map((definition) => [normalizedName(definition.id), definition]));
  const performanceIds = new Set(performanceDefinitions.map((definition) => normalizedName(definition.id)));
  const identityIds = new Set(identityDefinitions.map((definition) => normalizedName(definition.id)));
  const samples = new Map<string, number>();
  type MetricPoint = { coordinate: string | null; value: unknown };
  const series = new Map<string, MetricPoint[]>();
  const pointCoordinate = (record: Record<string, any>): string | null => {
    const value = record.dateTime
      ?? record.datetime
      ?? record.date_time
      ?? record.timestamp
      ?? record.publicationDate
      ?? record.publishedAt
      ?? record.createdAt;
    if (value == null || !String(value).trim()) return null;
    const coordinate = String(value).trim();
    // A date-only bucket represents a daily aggregate, not an individual
    // publication. It must never become a post identity join key.
    if (/^\d{4}-\d{2}-\d{2}$/.test(coordinate)) return null;
    return coordinate;
  };
  const addPoint = (definition: BlackRoomMetricoolMetricDefinition, record: Record<string, any>, raw: unknown) => {
    const key = normalizedName(definition.id);
    if (!performanceIds.has(key) && !identityIds.has(key)) return;
    const points = series.get(key) || [];
    points.push({ coordinate: pointCoordinate(record), value: raw });
    series.set(key, points);
  };
  const visit = (candidate: unknown, activeMetricId = "", path = "root") => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, activeMetricId, `${path}.${index}`));
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, any>;
    const rowMetricId = String(
      record.metricId
      ?? record.metric_id
      ?? record.fieldId
      ?? record.field_id
      ?? record.field
      ?? record.metric
      ?? record.code
      ?? activeMetricId
      ?? "",
    );
    const definition = definitionById.get(normalizedName(rowMetricId));
    if (definition) {
      const raw = record.value ?? record.metricValue ?? record.metric_value;
      if (raw !== undefined) {
        addPoint(definition, record, raw);
        if (performanceIds.has(normalizedName(definition.id))) {
          const views = Number(raw);
          const id = codedMetricRecordId(record, definition.id, identityDefinitions);
          if (id && Number.isFinite(views) && views >= 0) samples.set(id, views);
        }
      }
    }
    for (const [key, raw] of Object.entries(record)) {
      const keyedDefinition = definitionById.get(normalizedName(key));
      if (keyedDefinition && (raw == null || typeof raw !== "object")) {
        addPoint(keyedDefinition, record, raw);
        if (performanceIds.has(normalizedName(keyedDefinition.id))
          && Number.isFinite(Number(raw))
          && Number(raw) >= 0) {
          const id = codedMetricRecordId(record, keyedDefinition.id, identityDefinitions);
          if (id) samples.set(id, Number(raw));
        }
      } else {
        visit(raw, keyedDefinition?.id || activeMetricId, `${path}.${key}`);
      }
    }
  };
  visit(value);

  // Metricool's Data Studio analytics response can return each requested
  // field as an independent timeline. Join the views timeline to the
  // post-ID/permalink timeline by publication timestamp. Without this join,
  // all three networks can report a successful request while yielding zero
  // post samples because views and identity never appear in the same object.
  const identityPoints = identityDefinitions.flatMap((definition) =>
    series.get(normalizedName(definition.id)) || []);
  const identityByCoordinate = new Map<string, string[]>();
  for (const point of identityPoints) {
    if (!point.coordinate || point.value == null || !String(point.value).trim()) continue;
    const values = identityByCoordinate.get(point.coordinate) || [];
    values.push(String(point.value));
    identityByCoordinate.set(point.coordinate, values);
  }
  const coordinateOffsets = new Map<string, number>();
  const performancePoints = performanceDefinitions.flatMap((definition) =>
    series.get(normalizedName(definition.id)) || []);
  performancePoints.forEach((point) => {
    const views = Number(point.value);
    if (!Number.isFinite(views) || views < 0) return;
    let id: string | null = null;
    if (point.coordinate) {
      const candidates = identityByCoordinate.get(point.coordinate) || [];
      const offset = coordinateOffsets.get(point.coordinate) || 0;
      id = candidates[offset] || null;
      coordinateOffsets.set(point.coordinate, offset + 1);
    }
    if (id) samples.set(id, views);
  });
  return [...samples].map(([id, views]) => ({ id, views }));
}

type BlackRoomMetricoolHistory = {
  metricIds: Set<string>;
  viewRecords: Map<string, number>;
  requests: number;
  complete: boolean;
};

function emptyMetricoolHistory(complete = true): BlackRoomMetricoolHistory {
  return { metricIds: new Set(), viewRecords: new Map(), requests: 0, complete };
}

function mergeMetricoolHistory(target: BlackRoomMetricoolHistory, source: BlackRoomMetricoolHistory): void {
  for (const id of source.metricIds) target.metricIds.add(id);
  for (const [id, views] of source.viewRecords) target.viewRecords.set(id, views);
  target.requests += source.requests;
  target.complete = target.complete && source.complete;
}

function addMetricoolPayload(
  target: BlackRoomMetricoolHistory,
  payload: unknown,
  definitions: BlackRoomMetricoolMetricDefinition[] = [],
): number {
  const codedRecords = definitions.length ? extractCodedViewRecords(payload, definitions) : [];
  const viewRecords = [...extractBlackRoomViewRecords(payload), ...codedRecords];
  const ids = new Set([...extractBlackRoomMetricSampleIds(payload), ...viewRecords.map((record) => record.id)]);
  for (const id of ids) target.metricIds.add(id);
  for (const record of viewRecords) target.viewRecords.set(record.id, record.views);
  return ids.size;
}

async function collectMetricoolToolHistory(input: {
  fetcher: typeof fetch;
  token: string;
  tool: { name: string; inputSchema?: Record<string, any> };
  network: string;
  now: Date;
  env: NodeJS.ProcessEnv;
  connector?: string;
  metrics?: string[];
  metricDefinitions?: BlackRoomMetricoolMetricDefinition[];
}): Promise<BlackRoomMetricoolHistory> {
  const supportsDates = dateRangeSupported(input.tool.inputSchema);
  const supportsPages = paginationSupported(input.tool.inputSchema);
  let totalRequests = 0;
  const fullStart = supportsDates ? configuredHistoryStartDate(input.env) : undefined;
  const fullEnd = supportsDates ? input.now.toISOString().slice(0, 10) : undefined;

  const collectRange = async (start?: string, end?: string): Promise<BlackRoomMetricoolHistory> => {
    const output = emptyMetricoolHistory(supportsPages || supportsDates);
    if (supportsPages) {
      let previousSize = 0;
      for (let page = 1; page <= BLACKROOM_CEO_ANALYTICS_MAX_PAGES; page += 1) {
        if (totalRequests >= BLACKROOM_CEO_ANALYTICS_MAX_PAGES) {
          output.complete = false;
          return output;
        }
        const result = await callMetricoolMcpTool(
          input.fetcher,
          input.token,
          input.tool.name,
          buildToolArguments(input.tool.inputSchema, input.network, input.now, input.env, {
            start,
            end,
            page,
            connector: input.connector,
            metrics: input.metrics,
          }),
        );
        totalRequests += 1;
        output.requests += 1;
        const payload = toolPayload(result);
        const returned = addMetricoolPayload(output, payload, input.metricDefinitions);
        const newIds = output.metricIds.size - previousSize;
        previousSize = output.metricIds.size;
        const hasMore = payloadHasMore(payload, returned);
        if (newIds === 0) {
          // A repeated full page while Metricool still advertises more data
          // means this tool did not honor our page argument (or needs a
          // cursor the discovered schema did not expose). Never present that
          // truncated cohort as a complete historical import.
          if (hasMore || returned >= BLACKROOM_CEO_ANALYTICS_PAGE_SIZE) output.complete = false;
          return output;
        }
        if (!hasMore && returned < BLACKROOM_CEO_ANALYTICS_PAGE_SIZE) return output;
      }
      output.complete = false;
      return output;
    }

    if (totalRequests >= BLACKROOM_CEO_ANALYTICS_MAX_PAGES) return emptyMetricoolHistory(false);
    const result = await callMetricoolMcpTool(
      input.fetcher,
      input.token,
      input.tool.name,
      buildToolArguments(input.tool.inputSchema, input.network, input.now, input.env, {
        start,
        end,
        connector: input.connector,
        metrics: input.metrics,
      }),
    );
    totalRequests += 1;
    output.requests += 1;
    const payload = toolPayload(result);
    const returned = addMetricoolPayload(output, payload, input.metricDefinitions);
    const mayBeTruncated = payloadHasMore(payload, returned) || returned >= BLACKROOM_CEO_ANALYTICS_PAGE_SIZE;
    const split = start && end && mayBeTruncated ? splitDateRange(start, end) : null;
    if (split) {
      const divided = emptyMetricoolHistory(true);
      const [leftStart, leftEnd, rightStart, rightEnd] = split;
      mergeMetricoolHistory(divided, await collectRange(leftStart, leftEnd));
      mergeMetricoolHistory(divided, await collectRange(rightStart, rightEnd));
      divided.requests += output.requests;
      return divided;
    }
    if (mayBeTruncated) output.complete = false;
    return output;
  };

  try {
    return await collectRange(fullStart, fullEnd);
  } catch (error) {
    if (!supportsDates || !fullStart || !fullEnd) throw error;
    // Some Metricool plans intentionally reject ranges older than their
    // retention window. Fall back to the recent rolling window so the CEO
    // still learns from current posts instead of staying permanently at 0.
    const recentStart = new Date(
      input.now.getTime() - BLACKROOM_CEO_ANALYTICS_LOOKBACK_DAYS * 86400_000,
    ).toISOString().slice(0, 10);
    const recent = await collectRange(recentStart, fullEnd);
    recent.complete = false;
    return recent;
  }
}

type BlackRoomMetricoolTool = {
  name: string;
  inputSchema?: Record<string, any>;
};

function findMetricoolTool(
  tools: BlackRoomMetricoolTool[],
  names: string[],
): BlackRoomMetricoolTool | undefined {
  const accepted = new Set(names.map(normalizedName));
  return tools.find((tool) => accepted.has(normalizedName(tool.name)));
}

function directMetricoolToolsForNetwork(
  tools: BlackRoomMetricoolTool[],
  network: string,
): BlackRoomMetricoolTool[] {
  const canonicalNames: Record<string, string[]> = {
    tiktok: ["get_tiktok_videos", "get_tiktok_posts"],
    facebook: ["get_facebook_posts", "get_facebook_reels"],
    youtube: ["get_youtube_videos"],
  };
  const canonical = (canonicalNames[network] || [])
    .map((name) => findMetricoolTool(tools, [name]))
    .filter((tool): tool is BlackRoomMetricoolTool => Boolean(tool));
  if (canonical.length) return canonical;
  const legacyNames: Record<string, string[]> = {
    tiktok: ["get_tiktoks"],
    facebook: ["get_posts", "get_reels"],
    youtube: ["get_videos"],
  };
  const legacy = (legacyNames[network] || [])
    .map((name) => findMetricoolTool(tools, [name]))
    .filter((tool): tool is BlackRoomMetricoolTool => Boolean(tool));
  return legacy.slice(0, 1);
}

function analyticsConnectorsForNetwork(network: string): string[] {
  if (network === "tiktok") return ["posts"];
  if (network === "facebook") return ["posts", "reels"];
  return ["videos"];
}

async function metricDefinitionsForConnector(input: {
  fetcher: typeof fetch;
  token: string;
  tool?: BlackRoomMetricoolTool;
  network: string;
  connector: string;
  now: Date;
  env: NodeJS.ProcessEnv;
}): Promise<BlackRoomMetricoolMetricDefinition[]> {
  if (!input.tool) return [];
  const result = await callMetricoolMcpTool(
    input.fetcher,
    input.token,
    input.tool.name,
    buildToolArguments(input.tool.inputSchema, input.network, input.now, input.env, {
      connector: input.connector,
    }),
  );
  const definitions = extractMetricoolMetricDefinitions(toolPayload(result));
  const performance = preferredMetricDefinitions(definitions);
  const identities = identityMetricDefinitions(definitions);
  return [...new Map([...performance, ...identities].map((definition) => [definition.id, definition])).values()];
}

export async function collectBlackRoomMetricoolAnalytics(options: {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: Date;
  previous?: Partial<BlackRoomCeoAnalytics> | null;
  importedSamplesByNetwork?: Partial<Record<BlackRoomAnalyticsNetwork, BlackRoomImportedAnalyticsSample[]>>;
  publicationExperiments?: BlackRoomPublicationExperiment[];
  learningSnapshots?: LearningSnapshot[];
} = {}): Promise<BlackRoomCeoAnalytics> {
  const env = options.env || process.env;
  const fetcher = options.fetch || fetch;
  const now = options.now || new Date();
  const importedSamplesByNetwork = Object.fromEntries(BLACKROOM_METRICOOL_NETWORKS.map((network) => [
    network,
    (options.importedSamplesByNetwork?.[network as BlackRoomAnalyticsNetwork] || []).slice(-10_000),
  ])) as Record<BlackRoomAnalyticsNetwork, BlackRoomImportedAnalyticsSample[]>;
  const importedTotal = Object.values(importedSamplesByNetwork).reduce((total, samples) => total + samples.length, 0);
  let tools: Awaited<ReturnType<typeof listMetricoolMcpTools>> = [];
  let catalogError = "";
  try {
    tools = await listMetricoolMcpTools({ env, fetch: fetcher });
  } catch (error) {
    if (!importedTotal) throw error;
    catalogError = error instanceof Error ? error.message.slice(0, 240) : "Metricool MCP no disponible";
  }
  // Metricool currently exposes getAnalyticsDataByMetrics plus
  // getAnalyticsAvailableMetrics. Older installations expose one direct
  // post/video tool per network. Support both contracts, but never treat
  // get_metrics/getAnalyticsAvailableMetrics as post data: those tools only
  // describe which metric IDs can be requested.
  const analyticsDataTool = findMetricoolTool(tools, [
    "getAnalyticsDataByMetrics",
    "getPostsDataByMetrics",
    "getDataToPostsByNetwork",
    "getAnalytics",
  ]);
  const availableMetricsTool = findMetricoolTool(tools, [
    "getAnalyticsAvailableMetrics",
    "getAvailableMetrics",
    "get_metrics",
  ]);
  const bestTimesTool = tools.find((tool) => /best.*time|time.*post/i.test(tool.name));
  const hasDirectDataTool = BLACKROOM_METRICOOL_NETWORKS.some((network) =>
    directMetricoolToolsForNetwork(tools, network).length > 0);
  if (!analyticsDataTool && !hasDirectDataTool && !importedTotal) {
    throw new Error("Metricool MCP does not expose a compatible metrics tool");
  }
  const networkSamples: Record<string, number> = {};
  const times: string[] = [];
  const recommendedTimesByNetwork: Record<string, string[]> = {};
  const viewsByNetwork: Record<string, number[]> = {};
  const attributedViewsByNetwork: Record<string, number[]> = {};
  const attributedPostIdsByNetwork: Record<string, string[]> = {};
  const networkViewsByStrategy: Record<string, Partial<Record<BlackRoomCreativeStrategy, number[]>>> = {};
  const engagementByNetwork: Record<string, number[]> = {};
  const completionByNetwork: Record<string, number[]> = {};
  const watchByNetwork: Record<string, number[]> = {};
  const viewsByDuration: Record<string, number[]> = {};
  const viewsByDj: Record<string, number[]> = {};
  const viewsBySourceVideo: Record<string, number[]> = {};
  const viewsByFormat: Record<string, number[]> = {};
  const viewsByLanguage: Record<string, number[]> = {};
  const viewsBySlot: Record<string, number[]> = {};
  const attributionByNetwork: Record<string, BlackRoomAttributionStats> = {};
  const networkCreativePerformance: Record<string, BlackRoomCreativeCohort[]> = {};
  const networkDurationPerformance: Record<string, BlackRoomDurationCohort[]> = {};
  const snapshotCoverageByNetwork: Record<string, BlackRoomMetricSnapshotCoverage> = {};
  const networkErrors: Record<string, string> = {};
  const historyCompleteByNetwork: Record<string, boolean> = {};
  const historyRequestsByNetwork: Record<string, number> = {};
  const importedCounts: Record<string, number> = {};
  const networkMetricFailures = new Set<string>();
  for (const network of BLACKROOM_METRICOOL_NETWORKS) {
    const directTools = directMetricoolToolsForNetwork(tools, network);
    const networkHistory = emptyMetricoolHistory(true);
    const connectorErrors: string[] = [];
    const importedSamples = importedSamplesByNetwork[network as BlackRoomAnalyticsNetwork] || [];
    snapshotCoverageByNetwork[network] = summarizeBlackRoomSnapshotCoverage(importedSamples, now);
    engagementByNetwork[network] = importedSamples.map((sample) => sample.engagementRate).filter((value): value is number => Number.isFinite(value));
    completionByNetwork[network] = importedSamples.map((sample) => sample.completionRate).filter((value): value is number => Number.isFinite(value));
    watchByNetwork[network] = importedSamples.map((sample) => sample.averageWatchSeconds).filter((value): value is number => Number.isFinite(value));
    importedCounts[network] = importedSamples.length;
    for (const sample of importedSamples) {
      networkHistory.metricIds.add(sample.id);
      networkHistory.viewRecords.set(sample.id, sample.views);
    }
    try {
      if (directTools.length) {
        for (const tool of directTools) {
          try {
            mergeMetricoolHistory(networkHistory, await collectMetricoolToolHistory({
              fetcher,
              token: String(env.METRICOOL_USER_TOKEN || ""),
              tool,
              network,
              now,
              env,
            }));
          } catch (error) {
            connectorErrors.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else if (analyticsDataTool) {
        for (const connector of analyticsConnectorsForNetwork(network)) {
          try {
            let definitions: BlackRoomMetricoolMetricDefinition[] = [];
            try {
              definitions = await metricDefinitionsForConnector({
                fetcher,
                token: String(env.METRICOOL_USER_TOKEN || ""),
                tool: availableMetricsTool,
                network,
                connector,
                now,
                env,
              });
            } catch (error) {
              connectorErrors.push(`${connector} metrics: ${error instanceof Error ? error.message : String(error)}`);
            }
            mergeMetricoolHistory(networkHistory, await collectMetricoolToolHistory({
              fetcher,
              token: String(env.METRICOOL_USER_TOKEN || ""),
              tool: analyticsDataTool,
              network,
              connector,
              metrics: definitions.map((definition) => definition.id),
              metricDefinitions: definitions,
              now,
              env,
            }));
          } catch (error) {
            connectorErrors.push(`${connector}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      if (!networkHistory.requests && !importedSamples.length) {
        throw new Error(connectorErrors.join(" | ") || catalogError || "Metricool no devolvió datos");
      }
      networkSamples[network] = networkHistory.metricIds.size;
      const viewRecords = [...networkHistory.viewRecords].map(([id, views]) => ({ id, views }));
      viewsByNetwork[network] = viewRecords.map((record) => record.views);
      const importedById = new Map(importedSamples.map((sample) => [sample.id, sample]));
      const cohorts = extractBlackRoomExperimentCohorts(viewRecords.map((record) => ({
        ...record,
        publishedAt: importedById.get(record.id)?.publishedAt,
        durationSeconds: importedById.get(record.id)?.durationSeconds,
      })), options.publicationExperiments || [], network);
      for (const [duration, views] of Object.entries(cohorts.viewsByDuration)) {
        (viewsByDuration[duration] ||= []).push(...views);
      }
      for (const [dj, views] of Object.entries(cohorts.viewsByDj)) (viewsByDj[dj] ||= []).push(...views);
      for (const [videoId, views] of Object.entries(cohorts.viewsBySourceVideo)) (viewsBySourceVideo[videoId] ||= []).push(...views);
      for (const [format, views] of Object.entries(cohorts.viewsByFormat)) (viewsByFormat[format] ||= []).push(...views);
      for (const [language, views] of Object.entries(cohorts.viewsByLanguage)) (viewsByLanguage[language] ||= []).push(...views);
      for (const [slot, views] of Object.entries(cohorts.viewsBySlot)) (viewsBySlot[slot] ||= []).push(...views);
      attributionByNetwork[network] = cohorts.attribution;
      attributedViewsByNetwork[network] = Object.values(cohorts.viewsByStrategy).flat();
      attributedPostIdsByNetwork[network] = attributedViewsByNetwork[network]
        .map((views, index) => `${network}:attributed:${index}:${views}`);
      networkViewsByStrategy[network] = cohorts.viewsByStrategy;
      networkCreativePerformance[network] = BLACKROOM_CREATIVE_STRATEGIES.map((strategy) => {
        const values = cohorts.viewsByStrategy[strategy] || [];
        return { strategy, samples: values.length, medianViews: median(values), totalViews: values.reduce((sum, value) => sum + value, 0), lowViewRate: values.length ? values.filter((value) => value <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD).length / values.length : 0 };
      });
      networkDurationPerformance[network] = planBlackRoomDurationLearning({ viewsByDuration: cohorts.viewsByDuration }).durationPerformance;
      historyCompleteByNetwork[network] = networkHistory.requests > 0
        && networkHistory.complete
        && connectorErrors.length === 0;
      historyRequestsByNetwork[network] = networkHistory.requests;
      if (connectorErrors.length || (catalogError && importedSamples.length)) {
        networkErrors[network] = [...connectorErrors, catalogError].filter(Boolean).join(" | ").slice(0, 240);
      }
    } catch (error) {
      networkSamples[network] = networkHistory.metricIds.size;
      const viewRecords = [...networkHistory.viewRecords].map(([id, views]) => ({ id, views }));
      viewsByNetwork[network] = viewRecords.map((record) => record.views);
      const importedById = new Map(importedSamples.map((sample) => [sample.id, sample]));
      const cohorts = extractBlackRoomExperimentCohorts(viewRecords.map((record) => ({
        ...record,
        publishedAt: importedById.get(record.id)?.publishedAt,
        durationSeconds: importedById.get(record.id)?.durationSeconds,
      })), options.publicationExperiments || [], network);
      for (const [duration, views] of Object.entries(cohorts.viewsByDuration)) {
        (viewsByDuration[duration] ||= []).push(...views);
      }
      for (const [dj, views] of Object.entries(cohorts.viewsByDj)) (viewsByDj[dj] ||= []).push(...views);
      for (const [videoId, views] of Object.entries(cohorts.viewsBySourceVideo)) (viewsBySourceVideo[videoId] ||= []).push(...views);
      for (const [format, views] of Object.entries(cohorts.viewsByFormat)) (viewsByFormat[format] ||= []).push(...views);
      for (const [language, views] of Object.entries(cohorts.viewsByLanguage)) (viewsByLanguage[language] ||= []).push(...views);
      for (const [slot, views] of Object.entries(cohorts.viewsBySlot)) (viewsBySlot[slot] ||= []).push(...views);
      attributionByNetwork[network] = cohorts.attribution;
      attributedViewsByNetwork[network] = Object.values(cohorts.viewsByStrategy).flat();
      attributedPostIdsByNetwork[network] = attributedViewsByNetwork[network]
        .map((views, index) => `${network}:attributed:${index}:${views}`);
      networkViewsByStrategy[network] = cohorts.viewsByStrategy;
      networkCreativePerformance[network] = BLACKROOM_CREATIVE_STRATEGIES.map((strategy) => {
        const values = cohorts.viewsByStrategy[strategy] || [];
        return { strategy, samples: values.length, medianViews: median(values), totalViews: values.reduce((sum, value) => sum + value, 0), lowViewRate: values.length ? values.filter((value) => value <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD).length / values.length : 0 };
      });
      networkDurationPerformance[network] = planBlackRoomDurationLearning({ viewsByDuration: cohorts.viewsByDuration }).durationPerformance;
      historyCompleteByNetwork[network] = false;
      historyRequestsByNetwork[network] = networkHistory.requests;
      if (!importedSamples.length) networkMetricFailures.add(network);
      networkErrors[network] = error instanceof Error ? error.message.slice(0, 240) : "Metricool no devolvió métricas";
    }
    if (bestTimesTool) {
      try {
        const bestTimesStart = new Date(now.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
        const best = await callMetricoolMcpTool(
          fetcher,
          String(env.METRICOOL_USER_TOKEN || ""),
          bestTimesTool.name,
          buildToolArguments(bestTimesTool.inputSchema, network, now, env, {
            start: bestTimesStart,
            end: now.toISOString().slice(0, 10),
          }),
        );
        const networkTimes = extractBlackRoomBestTimes(toolPayload(best));
        recommendedTimesByNetwork[network] = networkTimes;
        times.push(...networkTimes);
      } catch (error) {
        recommendedTimesByNetwork[network] = [];
        networkErrors[network] = [networkErrors[network], error instanceof Error ? error.message.slice(0, 240) : "Metricool no devolvió horarios"].filter(Boolean).join(" · ");
      }
    }
    const importedTimes = recommendBlackRoomTimesFromImportedSamples(importedSamples);
    if (importedTimes.length) {
      recommendedTimesByNetwork[network] = [...new Set([
        ...importedTimes,
        ...(recommendedTimesByNetwork[network] || []),
      ])].slice(0, 4);
      times.push(...importedTimes);
    }
  }
  if (BLACKROOM_METRICOOL_NETWORKS.every((network) => networkMetricFailures.has(network))) {
    throw new Error(`Metricool no devolvió analíticas: ${Object.entries(networkErrors).map(([network, message]) => `${network}: ${message}`).join(" | ")}`);
  }
  // Count the real samples already available across every connected network.
  // The previous minimum made the entire CEO show zero whenever just one
  // network had a temporary empty response, even when Facebook/YouTube data
  // was available and visible in Metricool.
  const sampleCount = BLACKROOM_METRICOOL_NETWORKS.reduce((total, network) => total + (networkSamples[network] || 0), 0);
  const attributedSamplesByNetwork = Object.fromEntries(BLACKROOM_METRICOOL_NETWORKS.map((network) => [
    network, attributionByNetwork[network]?.matchedRecords || 0,
  ]));
  const comparableSampleCount = Math.min(...BLACKROOM_METRICOOL_NETWORKS.map((network) => attributedSamplesByNetwork[network] || 0));
  const networkConfidence = Object.fromEntries(BLACKROOM_METRICOOL_NETWORKS.map((network) => [
    network, (attributedSamplesByNetwork[network] || 0) >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES ? "learning" : "collecting",
  ])) as Record<string, "collecting" | "learning">;
  const learningNetworkCount = Object.values(networkConfidence).filter((value) => value === "learning").length;
  const recommendedTimes = [...new Set(times)].slice(0, 12);
  // Raw Metricool data remains visible in networkSamples, but cannot change
  // strategy until it is safely linked to our own publication experiment.
  const networkLearning = planBlackRoomNetworkLearning({ viewsByNetwork: attributedViewsByNetwork });
  const creative = planBlackRoomCreativeLearning({
    views: attributedViewsByNetwork.tiktok || [],
    postIds: attributedPostIdsByNetwork.tiktok || [],
    viewsByStrategy: networkViewsByStrategy.tiktok || {},
    previous: options.previous,
    now,
  });
  const durationLearning = planBlackRoomDurationLearning({ viewsByDuration });
  const attributedRecords = Object.values(attributionByNetwork).reduce((total, item) => total + item.matchedRecords, 0);
  const unmatchedRecords = Object.values(attributionByNetwork).reduce((total, item) => total + item.unmatchedRecords, 0);
  const measuredRecords = Object.values(attributionByNetwork).reduce((total, item) => total + item.totalRecords, 0);
  const attributionReason = measuredRecords
    ? `Atribución segura: ${attributedRecords} publicaciones únicas vinculadas; ${unmatchedRecords} filas métricas sin vínculo.`
    : "Todavía no hay resultados atribuibles a publicaciones del agente.";
  const targets = BLACKROOM_METRICOOL_NETWORKS.map((network) => `${network} ${networkLearning.networkDailyTargets[network]}/día`).join(", ");
  const completeNetworks = BLACKROOM_METRICOOL_NETWORKS.filter((network) => historyCompleteByNetwork[network]).length;
  const historyReason = completeNetworks === BLACKROOM_METRICOOL_NETWORKS.length
    ? "Historial disponible importado y deduplicado en las tres redes."
    : `Historial importado parcialmente (${completeNetworks}/${BLACKROOM_METRICOOL_NETWORKS.length} redes completas); Metricool limitó las demás.`;
  const csvReason = importedTotal
    ? `El puente CSV local aportó ${importedTotal} resultados sin usar IA ni API pagada.`
    : "Aún no hay resultados del puente CSV local.";
  const result: BlackRoomCeoAnalytics = {
    sampleCount,
    lastCheckedAt: now.toISOString(),
    nextCheckAt: new Date(now.getTime() + BLACKROOM_CEO_REFRESH_MS).toISOString(),
    confidence: learningNetworkCount > 0 ? "learning" : "collecting",
    networkSamples,
    attributedSamplesByNetwork,
    networkConfidence,
    networkEngagementRate: Object.fromEntries(BLACKROOM_METRICOOL_NETWORKS.map((network) => [network, median(engagementByNetwork[network] || [])])),
    networkCompletionRate: Object.fromEntries(BLACKROOM_METRICOOL_NETWORKS.map((network) => [network, median(completionByNetwork[network] || [])])),
    networkAverageWatchSeconds: Object.fromEntries(BLACKROOM_METRICOOL_NETWORKS.map((network) => [network, median(watchByNetwork[network] || [])])),
    comparableSampleCount,
    networkErrors: Object.keys(networkErrors).length ? networkErrors : undefined,
    historyStartDate: configuredHistoryStartDate(env),
    historyCompleteByNetwork,
    historyRequestsByNetwork,
    importedSamplesByNetwork: importedCounts,
    recommendedTimes,
    recommendedTimesByNetwork,
    ...networkLearning,
    ...creative,
    ...durationLearning,
    preferredDjs: rankProvenExperimentValues(viewsByDj),
    preferredSourceVideoIds: rankProvenExperimentValues(viewsBySourceVideo),
    preferredFormats: rankProvenExperimentValues(viewsByFormat),
    preferredLanguages: rankProvenExperimentValues(viewsByLanguage),
    formatPerformance: summarizeValueCohorts(viewsByFormat),
    languagePerformance: summarizeValueCohorts(viewsByLanguage),
    slotPerformance: summarizeValueCohorts(viewsBySlot),
    attributionByNetwork,
    snapshotCoverageByNetwork,
    networkCreativePerformance,
    networkDurationPerformance,
    experimentAllocation: { exploitShare: 0.8, exploreShare: 0.2, minimumWinnerSamples: BLACKROOM_CEO_CREATIVE_MIN_SAMPLES },
    reason: learningNetworkCount > 0
      ? `${csvReason} ${historyReason} ${attributionReason} El CEO aprende por red (${learningNetworkCount}/3 con evidencia suficiente): ${targets}. ${creative.creativeReason}`
      : `${csvReason} ${historyReason} ${attributionReason} Importó ${sampleCount} resultados reales; cada red necesita ${BLACKROOM_CEO_MIN_SAMPLES} muestras antes de optimizarse. ${creative.creativeReason}`,
  };
  // Historical aggregates remain visible but cannot masquerade as a current
  // learning loop. Only real age snapshots and exact published identities can
  // drive the next experiment. Running this planner never refreshes source time.
  const sourceObservedAt = Object.fromEntries(BLACKROOM_METRICOOL_NETWORKS.map((network) => [network,
    importedSamplesByNetwork[network as LearningNetwork].map((sample) => sample.observedAt)
      .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!)) && Date.parse(value!) <= now.getTime())
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null,
  ]));
  result.verifiedLearning = evaluateBlackRoomLearning({ snapshots: options.learningSnapshots || [],
    experiments: options.publicationExperiments || [], sourceObservedAt, now });
  result.durationLearning = evaluateDurationLearning({ snapshots: options.learningSnapshots || [],
    experiments: options.publicationExperiments || [], sourceObservedAt, now });
  result.networkConfidence = Object.fromEntries(Object.entries(result.verifiedLearning).map(([network, decision]) => [
    network, decision.status === "testing" ? "learning" : "collecting",
  ]));
  result.confidence = Object.values(result.verifiedLearning).some((decision) => decision.status === "testing") ? "learning" : "collecting";
  result.networkDailyTargets = { ...BLACKROOM_CEO_DEFAULT_NETWORK_TARGETS };
  // Volume, scheduling, language, DJ and length are controls during the hook
  // test, not additional simultaneous treatment variables.
  result.comparableSampleCount = 0;
  result.recommendedTimes = [];
  result.recommendedTimesByNetwork = {};
  result.preferredDurations = [];
  result.preferredDjs = [];
  result.preferredSourceVideoIds = [];
  result.preferredFormats = [];
  result.preferredLanguages = [];
  result.networkCreativePerformance = {};
  result.creativeStrategy = "drop_first";
  result.creativeReason = "Prueba controlada de inicio; no se promueven acumulados históricos como ganadores.";
  result.reason = `${csvReason} ${historyReason} ` + Object.entries(result.verifiedLearning).map(([network, decision]) => `${network}: ${decision.reason}`).join(" · ");
  return result;
}
