import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getSystemUserId } from "./user-context";
import { getExistingAutomations, recordScheduledAutomationRun } from "./automation-registry";
import { activeMetricoolAnalyticsDefinition } from "./automation-definition-reads";
import type { AutomationDefinition } from "@shared/schema";
import { recordClipperLocalNewsMetrics, type ClipperLocalNewsLane, type ClipperLocalNewsMetricInput } from "./clippers-local-news-agent";
import { callMetricoolMcpTool } from "./blackroom-metricool-bridge";

const METRICOOL_API = "https://app.metricool.com";
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_HOUR = 6;
const DEFAULT_MINUTE = 45;
const DEFAULT_TIMEOUT_MS = 30_000;
const SYNC_FILE = "metricool-analytics-sync.json";
const TIME_ZONE = "America/New_York";
const FACEBOOK_POST_METRIC_FIELDS = [
  "FBPO02", // publication date with time
  "FBPO03", // post content
  "FBPO04", // post id
  "FBPO08", // comments
  "FBPO09", // link clicks
  "FBPO11", // impressions
  "FBPO12", // reach
  "FBPO13", // reactions
  "FBPO14", // shares
  "FBPO16", // video views
  "FBPO23", // clicks
] as const;

type Fetcher = typeof globalThis.fetch;

export interface MetricoolAnalyticsSyncConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  lookbackDays: number;
  timeoutMs: number;
}

export interface MetricoolAnalyticsSyncStatus {
  enabled: boolean;
  configured: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  brands: Array<{ lane: ClipperLocalNewsLane; blogId: string; label: string; connected: boolean }>;
  postsSeen: number;
  metricsRecorded: number;
  duplicatesSkipped: number;
  unmatchedSkipped: number;
  lookbackDays: number;
  source: "metricool" | "none";
}

export interface MetricoolAnalyticsSyncResult extends MetricoolAnalyticsSyncStatus {
  status: "completed" | "partial" | "blocked";
}

interface MetricoolAnalyticsSyncDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: Fetcher;
  now?: () => Date;
  workspaceDir?: string;
}

interface SchedulerTimer {
  unref?: () => void;
}

export interface MetricoolAnalyticsSchedulerDeps {
  env?: NodeJS.ProcessEnv;
  sync?: () => Promise<MetricoolAnalyticsSyncResult>;
  now?: () => Date;
  setInterval?: (callback: () => void, delayMs: number) => SchedulerTimer;
  clearInterval?: (timer: SchedulerTimer) => void;
  setTimeout?: (callback: () => void, delayMs: number) => SchedulerTimer;
  clearTimeout?: (timer: SchedulerTimer) => void;
  getUserIds?: () => Promise<string[]>;
  getAutomations?: (userId: string) => Promise<AutomationDefinition[]>;
  recordRun?: typeof recordScheduledAutomationRun;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export interface MetricoolAnalyticsSchedulerStatus {
  enabled: boolean;
  started: boolean;
  running: boolean;
  runCount: number;
  completedCount: number;
  skippedCount: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

export interface MetricoolAnalyticsScheduler {
  start(): MetricoolAnalyticsSchedulerStatus;
  stop(): MetricoolAnalyticsSchedulerStatus;
  runNow(): Promise<"completed" | "partial" | "blocked" | "failed" | "skipped">;
  status(): MetricoolAnalyticsSchedulerStatus;
}

interface StoredSyncState extends MetricoolAnalyticsSyncStatus {
  seen: string[];
}

interface LedgerEntry {
  queueItemId?: unknown;
  eventId?: unknown;
  lane?: unknown;
  platform?: unknown;
  metricoolPostId?: unknown;
  blogId?: unknown;
  copyHash?: unknown;
  reviewedCopyHash?: unknown;
  scheduledFor?: unknown;
}

const LANE_CONFIG: Record<ClipperLocalNewsLane, { label: string; aliases: string[]; envKey: string }> = {
  "miami-news": { label: "Miami News", aliases: ["Miami News", "ynb4b6r6"], envKey: "METRICOOL_MIAMI_NEWS_BLOG_ID" },
  "ny-news": { label: "NY News", aliases: ["NY News", "New York News"], envKey: "METRICOOL_NY_NEWS_BLOG_ID" },
};

function workspaceDir(input: MetricoolAnalyticsSyncDeps): string {
  return path.resolve(input.workspaceDir || input.env?.CLIPPERS_LOCAL_NEWS_WORKSPACE || process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE || path.join(process.cwd(), "clippers_workspace", "local-news"));
}

function hasValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/^(replace|paste|your-|<)/i.test(value.trim());
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function getMetricoolAnalyticsSyncConfig(env: NodeJS.ProcessEnv = process.env): MetricoolAnalyticsSyncConfig {
  return {
    enabled: env.METRICOOL_ANALYTICS_SYNC_ENABLED !== "false",
    hour: boundedInt(env.METRICOOL_ANALYTICS_SYNC_HOUR, DEFAULT_HOUR, 0, 23),
    minute: boundedInt(env.METRICOOL_ANALYTICS_SYNC_MINUTE, DEFAULT_MINUTE, 0, 59),
    lookbackDays: boundedInt(env.METRICOOL_ANALYTICS_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS, 1, 90),
    timeoutMs: boundedInt(env.METRICOOL_ANALYTICS_SYNC_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5_000, 120_000),
  };
}

function emptyStatus(env: NodeJS.ProcessEnv, config = getMetricoolAnalyticsSyncConfig(env)): MetricoolAnalyticsSyncStatus {
  return {
    enabled: config.enabled,
    configured: hasValue(env.METRICOOL_USER_TOKEN) && hasValue(env.METRICOOL_USER_ID),
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    brands: [],
  postsSeen: 0,
  metricsRecorded: 0,
  duplicatesSkipped: 0,
    unmatchedSkipped: 0,
    lookbackDays: config.lookbackDays,
    source: "none",
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function normalizeId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function contentHash(value: string): string {
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-US");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "analytics_sync_failed";
  return message
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/(api[-_ ]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function recordObjects(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => recordObjects(item, depth + 1));
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const hasPostSignal = keys.some((key) => /(^|_)(post|publication|views?|reach|impressions?|engagement|reactions?|comments?|shares?|clicks?)/i.test(key));
  const nested = Object.values(record).flatMap((item) => recordObjects(item, depth + 1));
  return hasPostSignal ? [record, ...nested] : nested;
}

function numberFrom(record: Record<string, unknown>, patterns: RegExp[]): number {
  for (const [key, value] of Object.entries(record)) {
    if (!patterns.some((pattern) => pattern.test(key))) continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  return 0;
}

function textFrom(record: Record<string, unknown>, patterns: RegExp[]): string | null {
  for (const [key, value] of Object.entries(record)) {
    if (patterns.some((pattern) => pattern.test(key))) {
      const normalized = normalizeId(value);
      if (normalized) return normalized;
    }
  }
  return null;
}

function flattenRecord(value: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 5) return {};
  const flattened: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object" && !Array.isArray(child)) Object.assign(flattened, flattenRecord(child as Record<string, unknown>, depth + 1));
    else flattened[key] = child;
  }
  return flattened;
}

export function parseMetricoolPostMetrics(value: unknown): Array<{
  postId: string | null;
  queueItemId: string | null;
  contentHash: string | null;
  observedAt: string | null;
  impressions: number;
  reach: number;
  videoViews: number;
  engagements: number;
  clicks: number;
  shares: number;
}> {
  const seen = new Set<string>();
  const output: Array<{ postId: string | null; queueItemId: string | null; contentHash: string | null; observedAt: string | null; impressions: number; reach: number; videoViews: number; engagements: number; clicks: number; shares: number }> = [];
  for (const rawRecord of recordObjects(value)) {
    const record = flattenRecord(rawRecord);
    const postId = textFrom(record, [/^id$/i, /post.?id/i, /publication.?id/i, /uuid/i]);
    const queueItemId = textFrom(record, [/job.?id/i, /queue.?item/i]);
    const content = textFrom(record, [/^text$/i, /^message$/i, /^caption$/i, /^content$/i, /copy/i]);
    const postContentHash = content ? contentHash(content) : null;
    const observedAt = textFrom(record, [/published.?at/i, /publication.?date/i, /date.?time/i, /timestamp/i, /^date$/i, /created(?:.?at)?$/i]);
    const reactions = numberFrom(record, [/reaction/i, /like/i]);
    const comments = numberFrom(record, [/comment/i]);
    const shares = numberFrom(record, [/share/i]);
    const clicks = numberFrom(record, [/link.?click/i, /click/i]);
    const engagements = numberFrom(record, [/^engagements?$/i, /^interactions?$/i]) || reactions + comments + shares + clicks;
    const impressions = numberFrom(record, [/^impressions?$/i, /^views?$/i]);
    const reach = numberFrom(record, [/^reach$/i, /impressionsUnique/i]);
    const videoViews = numberFrom(record, [/video.?views?/i]);
    if (!postId && !queueItemId && !observedAt) continue;
    if (!postId && !queueItemId && output.some((existing) => existing.observedAt === observedAt && existing.impressions === impressions && existing.engagements === engagements && existing.clicks === clicks && existing.shares === shares && Boolean(existing.postId || existing.queueItemId))) continue;
    const key = [postId || "", queueItemId || "", postContentHash || "", observedAt || "", impressions, reach, videoViews, engagements, clicks, shares].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ postId, queueItemId, contentHash: postContentHash, observedAt, impressions, reach, videoViews, engagements, clicks, shares });
  }
  return output;
}

function metricoolMcpJson(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return value;
  for (const item of content) {
    if (!item || typeof item !== "object" || typeof (item as { text?: unknown }).text !== "string") continue;
    try { return JSON.parse((item as { text: string }).text); } catch { continue; }
  }
  return value;
}

function metricoolMcpRows(value: unknown): Record<string, unknown>[] {
  const parsed = metricoolMcpJson(value);
  if (Array.isArray(parsed)) return parsed.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  if (!parsed || typeof parsed !== "object") return [];
  const rows = (parsed as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
}

function mcpCell(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) return (value as { value: unknown }).value;
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** Converts the official Metricool MCP Data Studio fields into the stable local metric shape. */
export function parseMetricoolMcpPostMetrics(value: unknown): ReturnType<typeof parseMetricoolPostMetrics> {
  const normalized = metricoolMcpRows(value).map((row) => ({
    postId: mcpCell(row, "FBPO04", "postId", "id"),
    publicationDate: mcpCell(row, "FBPO02", "created", "publicationDate", "date"),
    text: mcpCell(row, "FBPO03", "text", "content", "caption"),
    comments: mcpCell(row, "FBPO08", "comments"),
    linkClicks: mcpCell(row, "FBPO09", "linkclicks", "linkClicks"),
    impressions: mcpCell(row, "FBPO11", "impressions"),
    reach: mcpCell(row, "FBPO12", "impressionsUnique", "reach"),
    reactions: mcpCell(row, "FBPO13", "reactions"),
    shares: mcpCell(row, "FBPO14", "shares"),
    videoViews: mcpCell(row, "FBPO16", "videoViews"),
    clicks: mcpCell(row, "FBPO23", "clicks"),
  }));
  return parseMetricoolPostMetrics({ rows: normalized });
}

function isoDateTime(value: string | null, fallback: Date): string {
  if (!value) return fallback.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

async function readStoredState(file: string, env: NodeJS.ProcessEnv): Promise<StoredSyncState> {
  const fallback = { ...emptyStatus(env), seen: [] };
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<StoredSyncState>;
    return { ...fallback, ...parsed, seen: Array.isArray(parsed.seen) ? parsed.seen.filter((item): item is string => typeof item === "string").slice(-20_000) : [] };
  } catch { return fallback; }
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

async function discoverBrands(fetcher: Fetcher, token: string, userId: string, signal?: AbortSignal): Promise<Array<{ blogId: string; label: string }>> {
  const url = new URL("/api/admin/simpleProfiles", METRICOOL_API);
  url.searchParams.set("userId", userId);
  const response = await fetcher(url, { headers: { Accept: "application/json", "X-Mc-Auth": token }, signal });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "metricool_api_access_denied_or_plan_required" : `brand_discovery_http_${response.status}`);
  const raw = await safeJson(response);
  const collect = (value: unknown, depth = 0): Array<{ blogId: string; label: string }> => {
    if (depth > 5 || value === null || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap((item) => collect(item, depth + 1));
    const record = value as Record<string, unknown>;
    const blogId = normalizeId(record.blogId ?? record.blog_id ?? record.id);
    const label = String(record.label ?? record.name ?? record.blogName ?? record.brandName ?? "").trim();
    const direct = blogId && label ? [{ blogId, label }] : [];
    return [...direct, ...Object.values(record).flatMap((item) => collect(item, depth + 1))];
  };
  return collect(raw).filter((brand, index, all) => all.findIndex((item) => item.blogId === brand.blogId) === index);
}

async function readLedger(dir: string): Promise<LedgerEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, "metricool-delivery-ledger.json"), "utf8")) as { entries?: unknown };
    return Array.isArray(parsed.entries) ? parsed.entries.filter((entry): entry is LedgerEntry => Boolean(entry && typeof entry === "object")) : [];
  } catch { return []; }
}

function fingerprint(lane: string, blogId: string, metric: ReturnType<typeof parseMetricoolPostMetrics>[number]): string {
  return createHash("sha256").update(JSON.stringify([lane, blogId, metric])).digest("hex");
}

function legacyFingerprint(lane: string, blogId: string, metric: ReturnType<typeof parseMetricoolPostMetrics>[number]): string {
  const { reach: _reach, videoViews: _videoViews, ...legacyMetric } = metric;
  return createHash("sha256").update(JSON.stringify([lane, blogId, legacyMetric])).digest("hex");
}

async function fetchFacebookPostAnalytics(
  fetcher: Fetcher,
  token: string,
  userId: string,
  blogId: string,
  lane: ClipperLocalNewsLane,
  from: string,
  to: string,
  signal: AbortSignal,
): Promise<ReturnType<typeof parseMetricoolPostMetrics>> {
  let directError: unknown = null;
  try {
    const url = new URL("/api/v2/analytics/posts/facebook", METRICOOL_API);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("blogId", blogId);
    url.searchParams.set("userId", userId);
    url.searchParams.set("integrationSource", "MCP");
    const response = await fetcher(url, { headers: { Accept: "application/json", "X-Mc-Auth": token }, signal });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "metricool_api_access_denied_or_plan_required" : `analytics_http_${lane}_${response.status}`);
    const posts = parseMetricoolPostMetrics(await safeJson(response));
    if (posts.length) return posts;
  } catch (error) {
    directError = error;
  }

  try {
    const boundedFetcher: Fetcher = (request, init) => fetcher(request, { ...init, signal });
    const fetchWindow = async (windowFrom: string, windowTo: string, depth = 0): Promise<ReturnType<typeof parseMetricoolPostMetrics>> => {
      try {
        const result = await callMetricoolMcpTool(boundedFetcher, token, "getAnalyticsDataByMetrics", {
          brandId: blogId,
          metrics: [...FACEBOOK_POST_METRIC_FIELDS],
          from: windowFrom.replace(/Z$/, "+00:00"),
          to: windowTo.replace(/Z$/, "+00:00"),
        });
        return parseMetricoolMcpPostMetrics(result);
      } catch (error) {
        const message = safeErrorMessage(error);
        const startMs = new Date(windowFrom).getTime();
        const endMs = new Date(windowTo).getTime();
        const canSplit = /exceeds maximum allowed size|narrow (?:the )?query|response.{0,20}(?:too large|size)|result.{0,20}too large/i.test(message)
          && Number.isFinite(startMs)
          && Number.isFinite(endMs)
          && endMs - startMs > 86_400_000
          && depth < 8;
        if (!canSplit) throw error;

        const midpoint = new Date(startMs + Math.floor((endMs - startMs) / 2)).toISOString();
        const left = await fetchWindow(windowFrom, midpoint, depth + 1);
        const right = await fetchWindow(midpoint, windowTo, depth + 1);
        const unique = new Map<string, ReturnType<typeof parseMetricoolPostMetrics>[number]>();
        for (const metric of [...left, ...right]) {
          unique.set(JSON.stringify(metric), metric);
        }
        return Array.from(unique.values());
      }
    };
    return await fetchWindow(from, to);
  } catch (mcpError) {
    if (directError) throw new Error(`${safeErrorMessage(directError)}; mcp=${safeErrorMessage(mcpError)}`);
    throw mcpError;
  }
}

async function performMetricoolAnalyticsSync(input: MetricoolAnalyticsSyncDeps = {}): Promise<MetricoolAnalyticsSyncResult> {
  const env = input.env || process.env;
  const config = getMetricoolAnalyticsSyncConfig(env);
  const dir = workspaceDir(input);
  const stateFile = path.join(dir, SYNC_FILE);
  const prior = await readStoredState(stateFile, env);
  const now = input.now || (() => new Date());
  const startedAt = now();
  const result: MetricoolAnalyticsSyncResult = { ...prior, enabled: config.enabled, lookbackDays: config.lookbackDays, lastRunAt: startedAt.toISOString(), status: "blocked" };
  if (!config.enabled) { result.lastError = "disabled_by_configuration"; await atomicWrite(stateFile, { ...result, seen: prior.seen }); return result; }
  const token = env.METRICOOL_USER_TOKEN;
  const userId = env.METRICOOL_USER_ID;
  if (!hasValue(token) || !hasValue(userId)) { result.lastError = "missing_metricool_credentials"; await atomicWrite(stateFile, { ...result, seen: prior.seen }); return result; }

  const fetcher = input.fetch || globalThis.fetch;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), config.timeoutMs);
  abortTimer.unref?.();
  try {
    const discovered = await discoverBrands(fetcher, token, userId, controller.signal);
    const targets = (Object.entries(LANE_CONFIG) as Array<[ClipperLocalNewsLane, typeof LANE_CONFIG[ClipperLocalNewsLane]]>).map(([lane, configForLane]) => {
      const override = env[configForLane.envKey];
      const match = hasValue(override) ? discovered.find((brand) => brand.blogId === override.trim()) : discovered.find((brand) => configForLane.aliases.includes(brand.label));
      return { lane, blogId: match?.blogId || (hasValue(override) ? override.trim() : ""), label: match?.label || configForLane.label, connected: Boolean(match) };
    });
    result.brands = targets;
    const ledger = await readLedger(dir);
    const seen = new Set(prior.seen);
    const metrics: ClipperLocalNewsMetricInput[] = [];
    let postsSeen = 0;
    let duplicatesSkipped = 0;
    let unmatchedSkipped = 0;
    let successfulBrandFetches = 0;
    const brandErrors: string[] = [];
    const from = new Date(startedAt.getTime() - config.lookbackDays * 86_400_000).toISOString();
    const to = startedAt.toISOString();
    for (const target of targets) {
      if (!target.blogId || !target.connected) continue;
      try {
        const posts = await fetchFacebookPostAnalytics(fetcher, token, userId, target.blogId, target.lane, from, to, controller.signal);
        const expectedRecentPublication = ledger.some((entry) => {
          const scheduledFor = new Date(String(entry.scheduledFor || "")).getTime();
          return normalizeId(entry.lane) === target.lane
            && normalizeId(entry.platform) === "facebook"
            && normalizeId(entry.blogId) === target.blogId
            && Number.isFinite(scheduledFor)
            && scheduledFor >= new Date(from).getTime()
            && scheduledFor <= startedAt.getTime();
        });
        if (!posts.length && expectedRecentPublication) {
          brandErrors.push(`metricool_analytics_empty_with_recent_publication_receipts_${target.lane}`);
        } else {
          successfulBrandFetches += 1;
        }
        postsSeen += posts.length;
        for (const post of posts) {
          const ledgerEntry = ledger.find((entry) => (
            (normalizeId(entry.metricoolPostId) && normalizeId(entry.metricoolPostId) === post.postId)
            || (normalizeId(entry.queueItemId) && normalizeId(entry.queueItemId) === post.queueItemId)
            || (post.contentHash && [normalizeId(entry.copyHash), normalizeId(entry.reviewedCopyHash)].includes(post.contentHash))
          ) && normalizeId(entry.lane) === target.lane && normalizeId(entry.platform) === "facebook" && normalizeId(entry.blogId) === target.blogId);
          if (!ledgerEntry) { unmatchedSkipped += 1; continue; }
          const keys = [fingerprint(target.lane, target.blogId, post), legacyFingerprint(target.lane, target.blogId, post)];
          if (keys.some((key) => seen.has(key))) { duplicatesSkipped += 1; continue; }
          for (const key of keys) seen.add(key);
          metrics.push({
            queueItemId: normalizeId(ledgerEntry.queueItemId) || post.queueItemId || undefined,
            eventId: normalizeId(ledgerEntry.eventId) || undefined,
            lane: target.lane,
            platform: "facebook",
            impressions: post.impressions,
            reach: post.reach,
            videoViews: post.videoViews,
            engagements: post.engagements,
            clicks: post.clicks,
            shares: post.shares,
            observedAt: isoDateTime(post.observedAt, startedAt),
          });
        }
      } catch (error) {
        brandErrors.push(safeErrorMessage(error));
      }
    }
    if (metrics.length) await recordClipperLocalNewsMetrics({ workspaceDir: dir, env, now: startedAt, metrics });
    const connectedCount = targets.filter((target) => target.connected).length;
    result.status = connectedCount === 0 ? "blocked" : brandErrors.length || connectedCount < targets.length ? "partial" : "completed";
    result.source = "metricool";
    result.lastSuccessAt = successfulBrandFetches > 0 ? startedAt.toISOString() : result.lastSuccessAt;
    result.lastError = connectedCount === 0 ? "metricool_news_brands_not_connected" : brandErrors.length ? brandErrors.join("; ").slice(0, 240) : null;
    result.postsSeen = postsSeen;
    result.metricsRecorded = metrics.length;
    result.duplicatesSkipped = duplicatesSkipped;
    result.unmatchedSkipped = unmatchedSkipped;
    await atomicWrite(stateFile, { ...result, seen: Array.from(seen).slice(-20_000) });
    return result;
  } catch (error) {
    result.status = "partial";
    result.lastError = safeErrorMessage(error);
    await atomicWrite(stateFile, { ...result, seen: prior.seen });
    return result;
  } finally {
    clearTimeout(abortTimer);
  }
}

let syncInFlight: Promise<MetricoolAnalyticsSyncResult> | null = null;
export function syncMetricoolAnalytics(input: MetricoolAnalyticsSyncDeps = {}): Promise<MetricoolAnalyticsSyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = performMetricoolAnalyticsSync(input).finally(() => { syncInFlight = null; });
  return syncInFlight;
}

export async function getMetricoolAnalyticsSyncStatus(input: Pick<MetricoolAnalyticsSyncDeps, "env" | "workspaceDir"> = {}): Promise<MetricoolAnalyticsSyncStatus> {
  const env = input.env || process.env;
  const stored = await readStoredState(path.join(workspaceDir(input), SYNC_FILE), env);
  const { seen: _seen, ...publicStatus } = stored;
  const current = emptyStatus(env);
  return { ...current, ...publicStatus, enabled: current.enabled, configured: current.configured, lookbackDays: current.lookbackDays };
}

function zonedClock(date: Date): { dateKey: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return { dateKey: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")), minute: Number(value("minute")) };
}

export function createMetricoolAnalyticsScheduler(deps: MetricoolAnalyticsSchedulerDeps = {}): MetricoolAnalyticsScheduler {
  const env = deps.env || process.env;
  const config = getMetricoolAnalyticsSyncConfig(env);
  const runSync = deps.sync || (() => syncMetricoolAnalytics({ env }));
  const now = deps.now || (() => new Date());
  const schedule = deps.setInterval || globalThis.setInterval;
  const cancel = deps.clearInterval || ((timerToClear: SchedulerTimer) => globalThis.clearInterval(timerToClear as ReturnType<typeof setInterval>));
  const deadlineTimer = deps.setTimeout || globalThis.setTimeout;
  const cancelDeadline = deps.clearTimeout || ((handle: SchedulerTimer) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const log = deps.log || ((message) => console.log(message));
  const logError = deps.logError || ((message) => console.error(message));
  let timer: SchedulerTimer | null = null;
  let inFlight: Promise<void> | null = null;
  let started = false;
  let lastRunDate: string | null = null;
  let runCount = 0;
  let completedCount = 0;
  let skippedCount = 0;
  let lastStartedAt: string | null = null;
  let lastFinishedAt: string | null = null;
  let lastError: string | null = null;

  const status = (): MetricoolAnalyticsSchedulerStatus => ({ enabled: config.enabled, started, running: inFlight !== null, runCount, completedCount, skippedCount, lastStartedAt, lastFinishedAt, lastError });
  const execute = async (): Promise<"completed" | "partial" | "blocked" | "failed" | "skipped"> => {
    if (!config.enabled || inFlight) { skippedCount += 1; return "skipped"; }
    const startedAt = now();
    const work = (async () => {
      const users = deps.getUserIds ? await deps.getUserIds() : [getSystemUserId()];
      const readDefinitions = deps.getAutomations || getExistingAutomations;
      const activeUsers: string[] = [];
      for (const userId of users) {
        if (activeMetricoolAnalyticsDefinition(await readDefinitions(userId))) activeUsers.push(userId);
      }
      if (!activeUsers.length) {
        skippedCount += 1;
        return "skipped" as const;
      }
      runCount += 1; lastStartedAt = startedAt.toISOString(); lastError = null;
      let timeout: SchedulerTimer | null = null;
      const deadline = new Promise<never>((_, reject) => {
        timeout = deadlineTimer(() => reject(new Error("analytics_sync_timeout")), config.timeoutMs);
        timeout.unref?.();
      });
      const result = await Promise.race([runSync(), deadline]).finally(() => { if (timeout) cancelDeadline(timeout); });
      const recorder = deps.recordRun || recordScheduledAutomationRun;
      await Promise.all(activeUsers.map((userId) => recorder(userId, "metricool-daily-analytics-sync", startedAt, {
        status: result.status === "completed" ? "success" : result.status === "blocked" ? "skipped" : "failed",
        resultSummary: `Metricool analytics sync ${result.status}: ${result.metricsRecorded} metric(s) recorded.`,
        errorMessage: result.lastError,
        metadata: { postsSeen: result.postsSeen, metricsRecorded: result.metricsRecorded, duplicatesSkipped: result.duplicatesSkipped, unmatchedSkipped: result.unmatchedSkipped, source: result.source },
      })));
      if (result.status === "completed") completedCount += 1;
      lastFinishedAt = now().toISOString();
      return result.status;
    })();
    // This bookkeeping promise is not awaited by the scheduler. Record failures
    // without rethrowing here; execute() still returns "failed" for rejected work.
    inFlight = work.then(() => undefined).catch((error) => {
      lastError = error instanceof Error ? error.message : "analytics_scheduler_failed";
      lastFinishedAt = now().toISOString();
      logError(`[Metricool analytics] ${lastError}`);
    }).finally(() => { inFlight = null; });
    try { return await work; } catch { return "failed"; }
  };
  const tick = () => {
    const clock = zonedClock(now());
    // Replit deployments and autoscale restarts are not guaranteed to be alive
    // during the exact configured minute. Run once after the daily deadline as
    // a catch-up instead of silently losing the entire analytics day.
    const dailyDeadlineReached = clock.hour > config.hour
      || (clock.hour === config.hour && clock.minute >= config.minute);
    if (!dailyDeadlineReached || lastRunDate === clock.dateKey) return;
    lastRunDate = clock.dateKey;
    void execute();
  };
  return {
    start() { if (started || !config.enabled) return status(); started = true; timer = schedule(tick, 60_000); timer.unref?.(); log(`[Metricool analytics] daily sync scheduled at ${String(config.hour).padStart(2, "0")}:${String(config.minute).padStart(2, "0")} ${TIME_ZONE}`); tick(); return status(); },
    stop() { if (timer) cancel(timer); timer = null; started = false; return status(); },
    runNow: execute,
    status,
  };
}

let defaultScheduler: MetricoolAnalyticsScheduler | null = null;
export function startMetricoolAnalyticsScheduler(): MetricoolAnalyticsSchedulerStatus { defaultScheduler ||= createMetricoolAnalyticsScheduler(); return defaultScheduler.start(); }
export function stopMetricoolAnalyticsScheduler(): MetricoolAnalyticsSchedulerStatus { defaultScheduler ||= createMetricoolAnalyticsScheduler(); return defaultScheduler.stop(); }
export function getMetricoolAnalyticsSchedulerStatus(): MetricoolAnalyticsSchedulerStatus { defaultScheduler ||= createMetricoolAnalyticsScheduler(); return defaultScheduler.status(); }

export const __metricoolAnalyticsInternals = { recordObjects, flattenRecord, numberFrom, textFrom, zonedClock, LANE_CONFIG };
