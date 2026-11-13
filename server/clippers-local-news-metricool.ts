import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  ClipperLocalNewsLane,
  ClipperLocalNewsPlatform,
  ClipperLocalNewsStatus,
} from "./clippers-local-news-agent";
import { hashLocalNewsQueueReview, hashLocalNewsReviewValue } from "./clippers-local-news-review-committee";
import { destinationIdentityVerified, destinationNetworkVerified, newsArticleIdentity, newsSourceMatchesCity, readLocalNewsDeliveryPolicy, type NewsPolicyReader } from "./local-news-delivery-safety";
import { readNewsDeliveryAttempts, saveNewsDeliveryAttempts, type NewsDeliveryAttempt } from "./local-news-delivery-attempts";

const METRICOOL_API = "https://app.metricool.com";
const TIME_ZONE = "America/New_York";
const DEFAULT_MAX_PER_RUN = 4;
const MAX_PER_RUN = 50;
const MIN_SPACING_MS = 2 * 60_000;
const DEFAULT_BREAKING_SPACING_MINUTES = 15;
const MAX_BREAKING_SPACING_MINUTES = 120;
const DEFAULT_SCHEDULE_HORIZON_HOURS = 36;
const MAX_SCHEDULE_HORIZON_HOURS = 36;
const DEFAULT_MAX_ITEM_AGE_HOURS = {
  routine: 24,
  developing: 36,
  breaking: 12,
} as const;
const MAX_ITEM_AGE_HOURS = 72;
const STANDARD_SPACING_MS = 75 * 60_000;
const DAILY_MINIMUM_PER_ACCOUNT = 10;
const DAILY_MAXIMUM_PER_ACCOUNT = 14;
const BREAKING_DAILY_BURST = 2;
const STALE_LOCK_MS = 10 * 60_000;
const MEDIA_NORMALIZATION_ATTEMPTS = 3;
const MEDIA_NORMALIZATION_RETRY_MS = 250;
const MAX_METRICOOL_JSON_BYTES = 1024 * 1024;
const DEFAULT_METRICOOL_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_METRICOOL_RESPONSE_TIMEOUT_MS = 5_000;

const committeeVerdictSchema = z.object({
  role: z.enum(["source_verifier", "safety_editor", "monetization_editor"]),
  verdict: z.enum(["approve", "quarantine", "reject"]),
  reasons: z.array(z.string()).max(100),
  evidence: z.array(z.string()).max(100),
  checkedAt: z.string().datetime(),
}).passthrough();

const queueItemSchema = z.object({
  id: z.string().min(1).max(500),
  eventId: z.string().min(1).max(500),
  eventRevision: z.number().int().positive().optional(),
  canonicalEventIdentity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  claimIdentityHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  lane: z.enum(["miami-news", "ny-news"]),
  platform: z.enum(["x", "facebook"]),
  copy: z.string().min(1).max(20_000),
  risk: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["approval_required", "auto_eligible", "quarantined", "rejected"]),
  approvalRequired: z.boolean(),
  autoEligible: z.boolean(),
  published: z.literal(false),
  createdAt: z.string().datetime(),
  originalPublishedAt: z.string().datetime().nullable().optional(),
  expires: z.string().datetime().nullable().optional(),
  source: z.string().max(500).optional(),
  sourceUrl: z.string().url().max(2_000).optional(),
  section: z.enum(["traffic", "weather", "breaking", "public_safety", "local"]).optional(),
  topicTag: z.enum(["violent_crime", "kidnapping", "immigration"]).nullable().optional(),
  editorialUrgency: z.enum(["routine", "developing", "breaking"]).optional(),
  editorialPriority: z.number().finite().min(0).max(100).optional(),
  qualityScore: z.number().finite().min(0).max(100).optional(),
  mediaUrl: z.string().url().max(2_000).nullable().optional(),
  mediaType: z.enum(["image", "video"]).nullable().optional(),
  notBefore: z.string().datetime().nullable().optional(),
  verdicts: z.array(committeeVerdictSchema).max(3).optional(),
  evidence: z.array(z.string()).max(500).optional(),
  consensus: z.enum(["unanimous_approve", "not_unanimous"]).optional(),
  publishDecision: z.enum(["auto_publish", "quarantine", "reject"]).optional(),
  checkedAt: z.string().datetime().optional(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  organicGrowth: z.object({
    ceoDecision: z.object({
      dailyMinimumPosts: z.literal(10),
      dailyTargetPosts: z.union([z.literal(10), z.literal(12), z.literal(14)]),
      performanceMode: z.enum(["baseline", "growing", "breakout"]),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

const queueFileSchema = z.object({
  items: z.array(queueItemSchema).max(10_000),
}).passthrough();

const ledgerEntrySchema = z.object({
  queueItemId: z.string().min(1).max(500),
  eventId: z.string().min(1).max(500).optional(),
  eventRevision: z.number().int().positive().optional(),
  canonicalEventIdentity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  copyHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceUrlHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reviewedCopyHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  lane: z.enum(["miami-news", "ny-news"]),
  platform: z.enum(["x", "facebook"]),
  blogId: z.string().min(1).max(100),
  scheduledFor: z.string().datetime(),
  scheduledAt: z.string().datetime(),
  metricoolPostId: z.string().max(500).nullable(),
}).passthrough();

const ledgerSchema = z.object({
  version: z.literal(1),
  entries: z.array(ledgerEntrySchema).max(100_000),
}).passthrough();

type QueueItem = z.infer<typeof queueItemSchema>;
type Ledger = z.infer<typeof ledgerSchema>;

const COMMITTEE_ROLES = ["source_verifier", "safety_editor", "monetization_editor"] as const;

function hasCompleteCommitteeApproval(item: QueueItem): boolean {
  if (!item.eventRevision || !item.canonicalEventIdentity || !item.claimIdentityHash) return false;
  if (item.publishDecision !== "auto_publish" || item.consensus !== "unanimous_approve" || !item.reviewHash || !item.checkedAt) return false;
  if (!item.verdicts || item.verdicts.length !== COMMITTEE_ROLES.length || !item.evidence) return false;
  const roles = new Set(item.verdicts.map((verdict) => verdict.role));
  if (!COMMITTEE_ROLES.every((role) => roles.has(role)) || item.verdicts.some((verdict) => verdict.verdict !== "approve")) return false;
  const expectedCopyHash = `copyHash=${hashLocalNewsReviewValue(item.copy)}`;
  if (!item.evidence.includes(expectedCopyHash)) return false;
  const expectedReviewHash = hashLocalNewsQueueReview({ queueItemId: item.id, eventId: item.eventId, eventRevision: item.eventRevision, lane: item.lane, copy: item.copy, platform: item.platform, risk: item.risk, canonicalEventIdentity: item.canonicalEventIdentity, claimIdentityHash: item.claimIdentityHash, verdicts: item.verdicts, evidence: item.evidence, consensus: item.consensus, publishDecision: item.publishDecision, checkedAt: item.checkedAt, originalPublishedAt: item.originalPublishedAt, expires: item.expires });
  if (item.reviewHash !== expectedReviewHash) return false;
  if (item.risk === "high" || item.risk === "critical") {
    const connectorEvidence = item.evidence.find((entry) => entry.startsWith("connector="));
    const claimHashEvidence = item.evidence.find((entry) => entry.startsWith("claimHash="));
    if (!connectorEvidence || connectorEvidence === "connector=none" || !claimHashEvidence || claimHashEvidence === "claimHash=none") return false;
  }
  return true;
}

/** Fail-closed validator shared with the public feed for sensitive stories. */
export function hasCompleteLocalNewsCommitteeApproval(value: unknown): boolean {
  const parsed = queueItemSchema.safeParse(value);
  return parsed.success && hasCompleteCommitteeApproval(parsed.data);
}

function isRoutineTransitNoise(item: QueueItem): boolean {
  if (item.editorialUrgency === "breaking" || item.risk === "high" || item.risk === "critical") return false;
  const text = `${item.source || ""} ${item.copy}`.normalize("NFKC").toLocaleLowerCase("en-US");
  return /\b(?:mta|subway|metrobus|miami[- ]dade transit)\b/.test(text);
}

function isHighImpactTraffic(item: QueueItem): boolean {
  if (item.section !== "traffic") return false;
  if (item.editorialUrgency === "breaking" || item.risk === "high" || item.risk === "critical") return true;
  if (item.editorialUrgency !== "developing") return false;
  const text = `${item.copy} ${item.source || ""}`.normalize("NFKC").toLocaleLowerCase("en-US");
  return /\b(?:accident|crash|collision|fatal|injur|closure|closed|shutdown|evacuat|police activity|major delay|cierre|accidente|choque|colisi[oó]n|fatal|herid|evacuaci[oó]n|carril(?:es)? cerrado|carretera cerrada)\b/.test(text);
}
function trafficPublishingEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC === "true";
}

const CONNECTOR_LANES: Record<string, ClipperLocalNewsLane> = {
  "nws-miami": "miami-news",
  "nws-nyc": "ny-news",
  "notify-nyc": "ny-news",
  "fbi-miami": "miami-news",
  "fbi-ny": "ny-news",
  "doj-sdfl": "miami-news",
  "doj-sdny": "ny-news",
  "miami-dade-news": "miami-news",
  "mia-airport-news": "miami-news",
  ny511: "ny-news",
  fl511: "miami-news",
  "miami-generic": "miami-news",
  "ny-generic": "ny-news",
};

function evidenceValue(item: Pick<QueueItem, "evidence">, key: string): string | null {
  const prefix = `${key}=`;
  const entry = item.evidence?.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length).trim() : null;
}

/**
 * Revalidates jurisdiction at the final delivery boundary. This protects
 * Metricool from legacy queue rows created before connector-level filtering
 * was introduced, without trying to infer a city from editorial prose.
 */
export function matchesClipperLocalNewsDeliveryJurisdiction(
  item: Pick<QueueItem, "lane" | "sourceUrl" | "evidence">,
): boolean {
  const connector = evidenceValue(item, "connector");
  if (connector?.startsWith("google-news-")) return false;
  const connectorLane = connector?.startsWith("fhp-miami-")
    ? "miami-news"
    : connector ? CONNECTOR_LANES[connector] : undefined;
  if (connectorLane && connectorLane !== item.lane) return false;

  if (!item.sourceUrl) return true;
  try {
    const source = new URL(item.sourceUrl);
    const hostname = source.hostname.toLocaleLowerCase("en-US");
    if (hostname === "justice.gov" || hostname === "www.justice.gov") {
      if (source.pathname.startsWith("/usao-sdfl/")) return item.lane === "miami-news";
      if (source.pathname.startsWith("/usao-sdny/")) return item.lane === "ny-news";
      // A national DOJ path is not city evidence, including legacy rows that
      // predate connector evidence or carry connector=none.
      return false;
    }
    if (hostname === "fbi.gov" || hostname === "www.fbi.gov") {
      if (source.pathname.startsWith("/contact-us/field-offices/miami/")) return item.lane === "miami-news";
      if (source.pathname.startsWith("/contact-us/field-offices/newyork/")) return item.lane === "ny-news";
      // The configured FBI feeds are field-office feeds; a national URL does
      // not prove local jurisdiction at the delivery boundary.
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

function breakingSpacingMs(env: NodeJS.ProcessEnv): number {
  const configured = Number.parseInt(env.CLIPPERS_LOCAL_NEWS_BREAKING_SPACING_MINUTES || "", 10);
  const minutes = Number.isFinite(configured)
    ? Math.max(Math.ceil(MIN_SPACING_MS / 60_000), Math.min(MAX_BREAKING_SPACING_MINUTES, configured))
    : DEFAULT_BREAKING_SPACING_MINUTES;
  return minutes * 60_000;
}

function nextBreakingSlot(nowMs: number, occupied: number[], spacingMs: number): number {
  let candidate = nowMs;
  for (const scheduled of [...occupied].filter(Number.isFinite).sort((left, right) => left - right)) {
    if (scheduled < candidate - spacingMs) continue;
    if (scheduled >= candidate + spacingMs) break;
    candidate = scheduled + spacingMs;
  }
  return candidate;
}

function boundedHours(value: string | undefined, fallback: number, maximum: number): number {
  const configured = Number.parseInt(value || "", 10);
  return Number.isFinite(configured) ? Math.max(1, Math.min(maximum, configured)) : fallback;
}

/**
 * Routine and developing posts are useful only while they are current. Their
 * default window ends at the earlier of 36 hours from now or the end of the
 * next New York calendar day. Operators may shorten this window, but cannot
 * expand it far enough to turn a news queue into a week-long backlog.
 */
function scheduleHorizonEndMs(now: Date, env: NodeJS.ProcessEnv): number {
  const hours = boundedHours(
    env.CLIPPERS_LOCAL_NEWS_SCHEDULE_HORIZON_HOURS,
    DEFAULT_SCHEDULE_HORIZON_HOURS,
    MAX_SCHEDULE_HORIZON_HOURS,
  );
  const nextEasternDayEnd = easternDayEndMs(new Date(easternDayEndMs(now) + 12 * 60 * 60_000));
  return Math.min(now.getTime() + hours * 60 * 60_000, nextEasternDayEnd);
}

function queueItemIsFresh(item: QueueItem, nowMs: number, env: NodeJS.ProcessEnv): boolean {
  const urgency = item.editorialUrgency || "routine";
  const envKey = urgency === "breaking"
    ? "CLIPPERS_LOCAL_NEWS_BREAKING_MAX_AGE_HOURS"
    : urgency === "developing"
      ? "CLIPPERS_LOCAL_NEWS_DEVELOPING_MAX_AGE_HOURS"
      : "CLIPPERS_LOCAL_NEWS_ROUTINE_MAX_AGE_HOURS";
  const maxAgeHours = boundedHours(env[envKey], DEFAULT_MAX_ITEM_AGE_HOURS[urgency], MAX_ITEM_AGE_HOURS);
  const createdAt = new Date(item.createdAt).getTime();
  const original = item.originalPublishedAt ? Date.parse(item.originalPublishedAt) : NaN;
  const expires = item.expires ? Date.parse(item.expires) : Infinity;
  return Number.isFinite(createdAt) && Number.isFinite(original)
    && original <= nowMs && nowMs - original <= maxAgeHours * 60 * 60_000
    && nowMs < expires;
}

export type ClipperLocalNewsMetricoolResultStatus = "completed" | "partial" | "blocked" | "paused";

export interface ClipperLocalNewsMetricoolResult {
  status: ClipperLocalNewsMetricoolResultStatus;
  reason: string | null;
  scanned: number;
  eligible: number;
  scheduled: number;
  alreadyScheduled: number;
  filtered: number;
  deferred: number;
  failed: number;
  mediaAttached: number;
  mediaFallback: number;
  blockedLanes: ClipperLocalNewsLane[];
  ledgerPath: string;
  publicationConfirmed: number;
  pendingReconciliation: number;
  duplicatesSuppressed: number;
}

export interface ClipperLocalNewsMetricoolOptions {
  status?: ClipperLocalNewsStatus;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  workspaceDir?: string;
  maxPerRun?: number;
  requestTimeoutMs?: number;
  responseTimeoutMs?: number;
  /** Internal dependency only. Public handlers never forward request options. */
  readPolicy?: NewsPolicyReader;
}

export interface ClipperLocalNewsMetricoolReadiness {
  status: "ready" | "partial" | "blocked";
  configured: boolean;
  connected: boolean;
  blocker: string | null;
  requiredConnections: number;
  connectedConnections: number;
  platforms: {
    facebook: { required: number; connected: number; ready: boolean };
    x: { required: number; connected: number; ready: boolean };
  };
  targets: Array<{
    lane: ClipperLocalNewsLane;
    platform: ClipperLocalNewsPlatform;
    ready: boolean;
  }>;
}

interface ProfileCandidate {
  label: string;
  blogId: string;
  connectedNetworks: Set<string> | null;
  publishAllowed: boolean;
  networkAccountIds: { facebook: string | null; x: string | null };
}

function hasRealValue(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  return !/^<.*>$|^(?:change|replace|your)[-_ ]/i.test(value.trim());
}

function cappedInteger(value: number | string | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_PER_RUN, Math.trunc(parsed))) : fallback;
}

function easternDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function accountKey(item: Pick<QueueItem, "lane" | "platform">): string {
  return `${item.lane}|${item.platform}`;
}

function accountDailyTargets(items: QueueItem[]): Map<string, number> {
  const targets = new Map<string, number>();
  for (const item of items) {
    const requested = item.organicGrowth?.ceoDecision?.dailyTargetPosts || DAILY_MINIMUM_PER_ACCOUNT;
    const target = Math.max(DAILY_MINIMUM_PER_ACCOUNT, Math.min(DAILY_MAXIMUM_PER_ACCOUNT, requested));
    targets.set(accountKey(item), Math.max(targets.get(accountKey(item)) || DAILY_MINIMUM_PER_ACCOUNT, target));
  }
  return targets;
}

function easternOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second) - date.getTime();
}

function easternDayEndMs(value: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const date = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const utcGuess = Date.UTC(date.year, date.month - 1, date.day + 1, 0, 0, 0);
  return utcGuess - easternOffsetMs(new Date(utcGuess));
}

function deficitAwareAccountOrder(items: QueueItem[], scheduledByAccountDay: Map<string, number>, targets: Map<string, number>, day: string): QueueItem[] {
  const groups = new Map<string, QueueItem[]>();
  for (const item of items) {
    const key = accountKey(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  const simulated = new Map<string, number>();
  for (const key of groups.keys()) simulated.set(key, scheduledByAccountDay.get(`${key}|${day}`) || 0);
  const keys = [...groups.keys()];
  const ordered: QueueItem[] = [];
  let tieCursor = 0;
  while (keys.some((key) => (groups.get(key)?.length || 0) > 0)) {
    let selected = "";
    let greatestDeficit = Number.NEGATIVE_INFINITY;
    for (let offset = 0; offset < keys.length; offset += 1) {
      const key = keys[(tieCursor + offset) % keys.length];
      if (!(groups.get(key)?.length)) continue;
      const deficit = (targets.get(key) || DAILY_MINIMUM_PER_ACCOUNT) - (simulated.get(key) || 0);
      if (deficit > greatestDeficit) { selected = key; greatestDeficit = deficit; }
    }
    const item = groups.get(selected)?.shift();
    if (!item) break;
    ordered.push(item);
    simulated.set(selected, (simulated.get(selected) || 0) + 1);
    tieCursor = (keys.indexOf(selected) + 1) % Math.max(1, keys.length);
  }
  return ordered;
}

function metricoolContentHash(copy: string): string {
  const normalized = copy.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-US");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function metricoolContentKey(item: Pick<QueueItem, "copy" | "lane" | "platform">): string {
  return `${item.lane}|${item.platform}|${metricoolContentHash(item.copy)}`;
}

function metricoolSourceUrlHash(sourceUrl: string): string {
  const identity = newsArticleIdentity(sourceUrl);
  if (!identity) throw new Error("invalid_source_article");
  return identity;
}

function metricoolLedgerContentKey(entry: Ledger["entries"][number]): string | null {
  if (!entry.copyHash) return null;
  return `${entry.lane}|${entry.platform}|${entry.copyHash}`;
}

function metricoolSourceWasScheduled(item: QueueItem, entries: Ledger["entries"], history: QueueItem[] = []): boolean {
  if (!item.sourceUrl) return false;
  let sourceUrlHash: string;
  try {
    sourceUrlHash = metricoolSourceUrlHash(item.sourceUrl);
  } catch {
    return false;
  }
  return entries.some((entry) => {
    if (entry.lane !== item.lane || entry.platform !== item.platform) return false;
    const historicalItem = history.find(previous => previous.id === entry.queueItemId);
    const sameSourceUrl = entry.sourceUrlHash === sourceUrlHash
      || (historicalItem?.sourceUrl && newsArticleIdentity(historicalItem.sourceUrl) === sourceUrlHash);
    const sameLegacyIdentity = (!entry.sourceUrlHash || !historicalItem?.sourceUrl) && Boolean(
      (entry.eventId && entry.eventId === item.eventId)
      || (entry.canonicalEventIdentity && entry.canonicalEventIdentity === item.canonicalEventIdentity),
    );
    return sameSourceUrl || sameLegacyIdentity;
  });
}

function defaultWorkspace(env: NodeJS.ProcessEnv): string {
  return path.resolve(env.CLIPPERS_LOCAL_NEWS_WORKSPACE || path.join(process.cwd(), "clippers_workspace", "local-news"));
}

function resolvePaths(options: ClipperLocalNewsMetricoolOptions, env: NodeJS.ProcessEnv) {
  const queuePath = options.status?.artifacts.queue
    ? path.resolve(options.status.artifacts.queue)
    : path.join(path.resolve(options.workspaceDir || defaultWorkspace(env)), "metricool-queue.json");
  return {
    queuePath,
    ledgerPath: path.join(path.dirname(queuePath), "metricool-delivery-ledger.json"),
    attemptsPath: path.join(path.dirname(queuePath), "metricool-delivery-attempts.json"),
  };
}

async function readLedger(ledgerPath: string): Promise<Ledger> {
  try {
    return ledgerSchema.parse(JSON.parse(await readFile(ledgerPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: [] };
    throw error;
  }
}

async function atomicWriteLedger(ledgerPath: string, ledger: Ledger): Promise<void> {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  const temporary = `${ledgerPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, ledgerPath);
}

async function acquireDeliveryLock(lockPath: string): Promise<(() => Promise<void>) | null> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      const ownerId = randomUUID();
      try {
        await handle.writeFile(`${JSON.stringify({ ownerId, pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
      } catch (error) {
        try { await handle.close(); } catch { /* best effort */ }
        try { await unlink(lockPath); } catch { /* best effort */ }
        throw error;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try { await handle.close(); } catch { /* already closed */ }
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8")) as { ownerId?: unknown };
          if (current.ownerId === ownerId) await unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt > 0) return null;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs <= STALE_LOCK_MS) return null;
        await unlink(lockPath);
      } catch (staleError) {
        if ((staleError as NodeJS.ErrnoException).code !== "ENOENT") return null;
      }
    }
  }
  return null;
}

function normalizeId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value.toLowerCase()];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      if (child === true) return [key.toLowerCase()];
      if (/^(twitter|x|facebook)$/i.test(key) && child !== null && child !== false
        && !(typeof child === "string" && !child.trim())
        && !(typeof child === "object" && child && (
          (child as Record<string, unknown>).connected === false
          || (child as Record<string, unknown>).enabled === false
        ))) return [key.toLowerCase()];
      if (/network|provider|social/i.test(key)) return stringValues(child);
      return [];
    });
  }
  return [];
}

function profileFromRecord(record: Record<string, unknown>): ProfileCandidate | null {
  const label = [record.label, record.name, record.blogName, record.brandName]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
  const blogId = normalizeId(record.blogId ?? record.id ?? record.blog_id);
  if (!label || !blogId) return null;
  const explicitTopLevelNetworks = ["twitter", "x", "facebook"].filter((network) => network in record);
  const networkField = record.networks
    ?? record.providers
    ?? record.connectedNetworks
    ?? record.socialNetworks
    ?? (explicitTopLevelNetworks.length ? Object.fromEntries(explicitTopLevelNetworks.map((network) => [network, record[network]])) : undefined);
  const values = networkField === undefined ? null : new Set(stringValues(networkField));
  for (const network of explicitTopLevelNetworks) {
    if (record[network] === null || record[network] === false || record[network] === "") values?.delete(network);
  }
  return { label, blogId, connectedNetworks: values, publishAllowed: record.canPublish === true,
    networkAccountIds: { facebook: normalizeId(record.facebookPageId), x: normalizeId(record.twitterId) },
  };
}

function collectProfiles(value: unknown, depth = 0): ProfileCandidate[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectProfiles(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  const record = z.record(z.string(), z.unknown()).parse(value);
  const direct = profileFromRecord(record);
  const nested = Object.values(record).flatMap((item) => collectProfiles(item, depth + 1));
  return direct ? [direct, ...nested] : nested;
}

function providerFor(platform: ClipperLocalNewsPlatform): "twitter" | "facebook" {
  return platform === "x" ? "twitter" : "facebook";
}

function supportsProvider(profile: ProfileCandidate, platform: ClipperLocalNewsPlatform): boolean {
  if (!profile.connectedNetworks) return false;
  const provider = providerFor(platform);
  return profile.connectedNetworks.has(provider)
    || (provider === "twitter" && profile.connectedNetworks.has("x"));
}

function localDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

function responsePostId(value: unknown): string | null {
  const scalar = normalizeId(value);
  if (scalar) return scalar;
  if (!value || typeof value !== "object") return null;
  const record = z.record(z.string(), z.unknown()).parse(value);
  const direct = normalizeId(record.id ?? record.uuid ?? record.mediaId ?? record.media_id ?? record.postId ?? record.post_id);
  if (direct) return direct;
  for (const key of ["data", "post", "result"]) {
    const nested = responsePostId(record[key]);
    if (nested) return nested;
  }
  return null;
}

function publicBrandMediaUrl(env: NodeJS.ProcessEnv, lane: ClipperLocalNewsLane): string | null {
  const value = env.PUBLIC_BASE_URL;
  if (!value?.trim()) return null;
  try {
    const base = new URL(value.trim());
    if (base.protocol !== "https:" && base.protocol !== "http:") return null;
    const filename = lane === "miami-news" ? "miami-news-profile.png" : "ny-news-profile.png";
    return new URL(`/local-news/${filename}`, `${base.protocol}//${base.host}`).toString();
  } catch {
    return null;
  }
}

async function normalizeMetricoolMedia(
  fetcher: typeof globalThis.fetch,
  token: string,
  mediaUrl: string,
  requestTimeoutMs: number,
  responseTimeoutMs: number,
): Promise<string | null> {
  // Metricool's public API uses this image normalization route for both image
  // and video URLs before they are attached to scheduler/posts.
  const url = new URL("/api/actions/normalize/image/url", METRICOOL_API);
  url.searchParams.set("url", mediaUrl);
  for (let attempt = 1; attempt <= MEDIA_NORMALIZATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchMetricool(fetcher, url, { headers: { Accept: "application/json", "X-Mc-Auth": token } }, requestTimeoutMs);
      if (response.ok) return responsePostId(await safeJson(response, responseTimeoutMs));
      // Give transient Metricool/media-fetch failures a chance to recover
      // before the scheduler falls back to the verified text. Retry rate
      // limits and server-side failures, but fail fast on a bad URL or an
      // authorization error so the next delivery cycle can repair it.
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MEDIA_NORMALIZATION_ATTEMPTS) return null;
    } catch {
      if (attempt === MEDIA_NORMALIZATION_ATTEMPTS) return null;
    }
    await new Promise((resolve) => setTimeout(resolve, MEDIA_NORMALIZATION_RETRY_MS * attempt));
  }
  return null;
}

function metricoolPostTitle(copy: string): string {
  return copy
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "Metro Current local news";
}

async function scheduleMetricoolPost(
  fetcher: typeof globalThis.fetch,
  url: URL,
  token: string,
  payload: Record<string, unknown>,
  requestTimeoutMs: number,
): Promise<Response> {
  // Never retry a write automatically: timeout/5xx can mean it was accepted.
  return fetchMetricool(fetcher, url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Mc-Auth": token },
    body: JSON.stringify(payload),
  }, requestTimeoutMs);
}

async function fetchMetricool(
  fetcher: typeof globalThis.fetch,
  input: Parameters<typeof globalThis.fetch>[0],
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new Error("metricool_request_aborted")));
    // Keep the deadline referenced: it is the only handle that guarantees this
    // promise settles when a transport ignores abort and exposes no active I/O.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve().then(() => fetcher(input, { ...init, signal })).then(
      (response) => finish(() => resolve(response)),
      (error) => finish(() => reject(error)),
    );
  });
}

async function safeJson(response: Response, timeoutMs = DEFAULT_METRICOOL_RESPONSE_TIMEOUT_MS): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_METRICOOL_JSON_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const readBody = async (): Promise<unknown> => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_METRICOOL_JSON_BYTES) {
          void reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(value);
      }
      const body = Buffer.concat(chunks, total).toString("utf8");
      return body ? JSON.parse(body) : null;
    };
    return await new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      // A stalled stream may not keep Node 20 alive by itself, so this bounded
      // deadline must remain referenced until the body settles or is cancelled.
      const timer = setTimeout(() => {
        void reader.cancel().catch(() => undefined);
        finish(null);
      }, timeoutMs);
      void readBody().then(finish, () => finish(null));
    });
  } catch {
    return null;
  }
}

function emptyResult(ledgerPath: string): ClipperLocalNewsMetricoolResult {
  return {
    status: "blocked",
    reason: null,
    scanned: 0,
    eligible: 0,
    scheduled: 0,
    alreadyScheduled: 0,
    filtered: 0,
    deferred: 0,
    failed: 0,
    mediaAttached: 0,
    mediaFallback: 0,
    blockedLanes: [],
    ledgerPath,
    publicationConfirmed: 0,
    pendingReconciliation: 0,
    duplicatesSuppressed: 0,
  };
}

async function discoverProfiles(
  fetcher: typeof globalThis.fetch,
  token: string,
  userId: string,
  requestTimeoutMs = DEFAULT_METRICOOL_REQUEST_TIMEOUT_MS,
  responseTimeoutMs = DEFAULT_METRICOOL_RESPONSE_TIMEOUT_MS,
): Promise<ProfileCandidate[] | null> {
  const url = new URL("/api/admin/simpleProfiles", METRICOOL_API);
  url.searchParams.set("userId", userId);
  try {
    const response = await fetchMetricool(fetcher, url, { headers: { Accept: "application/json", "X-Mc-Auth": token } }, requestTimeoutMs);
    if (!response.ok) return null;
    return collectProfiles(await safeJson(response, responseTimeoutMs));
  } catch {
    return null;
  }
}

const NEWS_LANE_CONFIG: Record<ClipperLocalNewsLane, { label: string; aliases: string[]; overrideKey: "METRICOOL_MIAMI_NEWS_BLOG_ID" | "METRICOOL_NY_NEWS_BLOG_ID" }> = {
  "miami-news": {
    label: "Miami News",
    aliases: ["Miami News", "ynb4b6r6"],
    overrideKey: "METRICOOL_MIAMI_NEWS_BLOG_ID",
  },
  "ny-news": {
    label: "NY News",
    aliases: ["NY News", "New York News"],
    overrideKey: "METRICOOL_NY_NEWS_BLOG_ID",
  },
};

export async function getClipperLocalNewsMetricoolReadiness(
  options: Pick<ClipperLocalNewsMetricoolOptions, "env" | "fetch" | "readPolicy"> = {},
): Promise<ClipperLocalNewsMetricoolReadiness> {
  const env = options.env || process.env;
  const token = env.METRICOOL_USER_TOKEN;
  const userId = env.METRICOOL_USER_ID;
  const blocked = (blocker: string): ClipperLocalNewsMetricoolReadiness => ({
    status: "blocked",
    configured: false,
    connected: false,
    blocker,
    requiredConnections: 2,
    connectedConnections: 0,
    platforms: {
      facebook: { required: 2, connected: 0, ready: false },
      x: { required: 2, connected: 0, ready: false },
    },
    targets: (Object.keys(NEWS_LANE_CONFIG) as ClipperLocalNewsLane[]).flatMap((lane) => ([
      { lane, platform: "facebook" as const, ready: false },
      { lane, platform: "x" as const, ready: false },
    ])),
  });
  if (!hasRealValue(token) || !hasRealValue(userId)) return blocked("configurar credenciales de Metricool");
  const policy = await (options.readPolicy || readLocalNewsDeliveryPolicy)();
  if (policy.paused) return blocked("entregas de noticias pausadas");

  const profiles = await discoverProfiles(options.fetch || globalThis.fetch, token, userId);
  if (profiles === null) return blocked("no se pudo verificar Metricool");

  const targets = (Object.keys(NEWS_LANE_CONFIG) as ClipperLocalNewsLane[]).flatMap((lane) => {
    const config = NEWS_LANE_CONFIG[lane];
    const override = env[config.overrideKey];
    const profile = hasRealValue(override)
      ? profiles.find((candidate) => candidate.blogId === override.trim() && config.aliases.includes(candidate.label))
      : profiles.find((candidate) => config.aliases.includes(candidate.label));
    return (["facebook", "x"] as ClipperLocalNewsPlatform[]).map((platform) => ({
      lane,
      platform,
      ready: Boolean(profile && supportsProvider(profile, platform) && profile.publishAllowed
        && destinationNetworkVerified(policy, lane, platform, profile.networkAccountIds[platform])
        && destinationIdentityVerified(policy, lane, profile.blogId, new Date())),
    }));
  });
  const connectedFor = (platform: ClipperLocalNewsPlatform) => targets.filter((target) => target.platform === platform && target.ready).length;
  const facebookConnected = connectedFor("facebook");
  const xConnected = connectedFor("x");
  const facebookReady = facebookConnected === 2;
  const xReady = xConnected === 2;
  return {
    status: facebookReady && xReady ? "ready" : facebookReady || xConnected > 0 ? "partial" : "blocked",
    configured: true,
    connected: facebookReady,
    blocker: facebookReady ? null : "conectar Facebook para Miami News y New York News en Metricool",
    requiredConnections: 2,
    connectedConnections: facebookConnected,
    platforms: {
      facebook: { required: 2, connected: facebookConnected, ready: facebookReady },
      x: { required: 2, connected: xConnected, ready: xReady },
    },
    targets,
  };
}

export async function deliverClipperLocalNewsToMetricool(
  options: ClipperLocalNewsMetricoolOptions = {},
): Promise<ClipperLocalNewsMetricoolResult> {
  const env = options.env || process.env;
  const { queuePath, ledgerPath, attemptsPath } = resolvePaths(options, env);
  const result = emptyResult(ledgerPath);
  const readPolicy = options.readPolicy || readLocalNewsDeliveryPolicy;
  const policy = await readPolicy();
  if (policy.paused) {
    result.status = "paused";
    result.reason = policy.reason;
    return result;
  }
  const token = env.METRICOOL_USER_TOKEN;
  const userId = env.METRICOOL_USER_ID;
  if (!hasRealValue(token) || !hasRealValue(userId)) {
    result.reason = "missing_metricool_credentials";
    return result;
  }

  const lockPath = `${ledgerPath}.lock`;
  let releaseLock: (() => Promise<void>) | null;
  try {
    releaseLock = await acquireDeliveryLock(lockPath);
  } catch {
    result.reason = "metricool_delivery_lock_unavailable";
    return result;
  }
  if (!releaseLock) {
    result.reason = "metricool_delivery_in_progress";
    return result;
  }

  try {
    let queue: QueueItem[];
    let ledger: Ledger;
    let deliveryAttempts: NewsDeliveryAttempt[];
    try {
      queue = queueFileSchema.parse(JSON.parse(await readFile(queuePath, "utf8"))).items;
      ledger = await readLedger(ledgerPath);
      deliveryAttempts = await readNewsDeliveryAttempts(attemptsPath);
    } catch {
      result.reason = "invalid_or_missing_queue_artifact";
      return result;
    }
    result.scanned = queue.length;

    const already = new Set(ledger.entries.map((entry) => entry.queueItemId));
    const scheduledContentKeys = new Set(ledger.entries.map(metricoolLedgerContentKey).filter((key): key is string => Boolean(key)));
    const now = options.now || (() => new Date());
    const fetchedNow = now();
    const requestTimeoutMs = Math.max(100, Math.min(20_000, options.requestTimeoutMs ?? DEFAULT_METRICOOL_REQUEST_TIMEOUT_MS));
    const responseTimeoutMs = Math.max(100, Math.min(20_000, options.responseTimeoutMs ?? DEFAULT_METRICOOL_RESPONSE_TIMEOUT_MS));
    let safeItems = queue.filter((item) => {
      const platformEnabled = item.platform !== "x" || env.CLIPPERS_LOCAL_NEWS_ENABLE_X === "true";
      if (!newsSourceMatchesCity(item) || !matchesClipperLocalNewsDeliveryJurisdiction(item)) {
        result.filtered += 1;
        return false;
      }
      const highImpactTraffic = isHighImpactTraffic(item);
      if (item.section === "traffic" && !trafficPublishingEnabled(env) && !highImpactTraffic) {
        result.filtered += 1;
        return false;
      }
      if (isRoutineTransitNoise(item)) {
        result.filtered += 1;
        return false;
      }
      if (!queueItemIsFresh(item, fetchedNow.getTime(), env)) {
        result.filtered += 1;
        return false;
      }
      const baseEligible = item.status === "auto_eligible"
        && item.autoEligible
        && !item.approvalRequired
        && platformEnabled;
      const committeeEligible = hasCompleteCommitteeApproval(item);
      const eligible = baseEligible && committeeEligible;
      if (!eligible) result.filtered += 1;
      else result.eligible += 1;
      const notBefore = item.notBefore ? new Date(item.notBefore).getTime() : Number.NEGATIVE_INFINITY;
      const deferred = eligible && Number.isFinite(notBefore) && notBefore > fetchedNow.getTime();
      if (deferred) result.deferred += 1;
      if (!eligible || deferred) return false;

      const duplicate = already.has(item.id)
        || scheduledContentKeys.has(metricoolContentKey(item))
        || metricoolSourceWasScheduled(item, ledger.entries, queue)
        || deliveryAttempts.some(attempt => attempt.articleIdentity === newsArticleIdentity(item.sourceUrl || "")
          && attempt.lane === item.lane && attempt.platform === item.platform);
      if (duplicate) {
        const previousAttempts = deliveryAttempts.filter(attempt => attempt.articleIdentity === newsArticleIdentity(item.sourceUrl || "")
          && attempt.lane === item.lane && attempt.platform === item.platform);
        if (previousAttempts.length && !previousAttempts.some(attempt => attempt.state === "scheduling_accepted")) {
          result.duplicatesSuppressed += 1;
        } else result.alreadyScheduled += 1;
        if (deliveryAttempts.some(attempt => attempt.articleIdentity === newsArticleIdentity(item.sourceUrl || "")
          && attempt.lane === item.lane && attempt.platform === item.platform && attempt.state === "pending_reconciliation")) {
          result.pendingReconciliation += 1;
        }
        return false;
      }
      return true;
    }).sort((left, right) => (
      (right.editorialPriority || 0) - (left.editorialPriority || 0)
      || (right.qualityScore || 0) - (left.qualityScore || 0)
      || right.createdAt.localeCompare(left.createdAt)
    ));
    const dailyTargetByAccount = accountDailyTargets(safeItems);

    const laneConfig = {} as Record<ClipperLocalNewsLane, { label: string; aliases: string[]; override?: string }>;
    for (const [lane, config] of Object.entries(NEWS_LANE_CONFIG) as Array<[ClipperLocalNewsLane, typeof NEWS_LANE_CONFIG[ClipperLocalNewsLane]]>) {
      laneConfig[lane] = { ...config, override: env[config.overrideKey] };
    }
    const needsDiscovery = safeItems.length > 0;
    const profiles = needsDiscovery
      ? await discoverProfiles(options.fetch || globalThis.fetch, token, userId, requestTimeoutMs, responseTimeoutMs)
      : [];
    if (needsDiscovery && profiles === null) {
      result.reason = "metricool_profile_discovery_failed";
      return result;
    }

    const laneProfiles = new Map<ClipperLocalNewsLane, ProfileCandidate>();
    for (const lane of Object.keys(laneConfig) as ClipperLocalNewsLane[]) {
      const config = laneConfig[lane];
      if (hasRealValue(config.override)) {
        const match = profiles?.find(profile => profile.blogId === config.override!.trim()
          && config.aliases.includes(profile.label));
        if (match) laneProfiles.set(lane, match);
        else if (safeItems.some(item => item.lane === lane)) result.blockedLanes.push(lane);
        continue;
      }
      const match = profiles?.find((profile) => config.aliases.includes(profile.label));
      if (match) laneProfiles.set(lane, match);
      else if (safeItems.some((item) => item.lane === lane)) result.blockedLanes.push(lane);
    }

    if (result.blockedLanes.length && laneProfiles.size === 0) {
      result.reason = "metricool_news_brands_not_connected";
      return result;
    }

    const maxPerRun = cappedInteger(options.maxPerRun ?? env.CLIPPERS_LOCAL_NEWS_METRICOOL_MAX_PER_RUN, DEFAULT_MAX_PER_RUN);
    const minimumStart = fetchedNow.getTime() + MIN_SPACING_MS;
    const routineHorizonEnd = scheduleHorizonEndMs(fetchedNow, env);
    const breakingSpacing = breakingSpacingMs(env);
    const cursors = new Map<string, number>();
    const occupiedByAccount = new Map<string, number[]>();
    const scheduledByAccountDay = new Map<string, number>();
    for (const entry of ledger.entries) {
      const key = `${entry.lane}|${entry.platform}`;
      const scheduled = new Date(entry.scheduledFor).getTime();
      if (Number.isFinite(scheduled)) {
        // A legacy future backlog remains in the durable ledger for dedupe and
        // cleanup, but must not drag new, current reporting behind it.
        if (scheduled <= routineHorizonEnd) {
          cursors.set(key, Math.max(cursors.get(key) || 0, scheduled));
          const occupied = occupiedByAccount.get(key) || [];
          occupied.push(scheduled);
          occupiedByAccount.set(key, occupied);
        }
        const dayKey = `${key}|${easternDateKey(entry.scheduledFor)}`;
        scheduledByAccountDay.set(dayKey, (scheduledByAccountDay.get(dayKey) || 0) + 1);
      }
    }

    safeItems = deficitAwareAccountOrder(safeItems, scheduledByAccountDay, dailyTargetByAccount, easternDateKey(fetchedNow));

    const fetcher = options.fetch || globalThis.fetch;
    const mediaIds = new Map<string, string | null>();
    let attempts = 0;
    for (const item of safeItems) {
      const contentKey = metricoolContentKey(item);
      if (scheduledContentKeys.has(contentKey) || metricoolSourceWasScheduled(item, ledger.entries, queue)
        || deliveryAttempts.some(attempt => attempt.articleIdentity === newsArticleIdentity(item.sourceUrl || "")
          && attempt.lane === item.lane && attempt.platform === item.platform)) {
        result.alreadyScheduled += 1;
        continue;
      }
      const profile = laneProfiles.get(item.lane);
      if (!profile || !supportsProvider(profile, item.platform) || !profile.publishAllowed
        || !destinationNetworkVerified(policy, item.lane, item.platform, profile.networkAccountIds[item.platform])
        || !destinationIdentityVerified(policy, item.lane, profile.blogId, fetchedNow)) {
        if (!result.blockedLanes.includes(item.lane)) result.blockedLanes.push(item.lane);
        continue;
      }
      if (attempts >= maxPerRun) break;
      attempts += 1;
      const cursorKey = accountKey(item);
      const breaking = item.editorialUrgency === "breaking";
      const target = dailyTargetByAccount.get(cursorKey) || DAILY_MINIMUM_PER_ACCOUNT;
      const todayAccountKey = `${cursorKey}|${easternDateKey(fetchedNow)}`;
      if (breaking && (scheduledByAccountDay.get(todayAccountKey) || 0) >= target + BREAKING_DAILY_BURST) {
        result.deferred += 1;
        continue;
      }
      // Breaking items bypass the routine day-fill cursor, but still reserve a
      // safe per-account slot so a burst cannot hit Facebook at one timestamp.
      // Routine slots compress late in the day so an underfilled account can still reach its
      // account-wide target, while never violating the two-minute safety floor.
      let scheduledMs: number | null = breaking
        ? nextBreakingSlot(fetchedNow.getTime(), occupiedByAccount.get(cursorKey) || [], breakingSpacing)
        : minimumStart;
      if (!breaking) {
        for (let dayAttempt = 0; dayAttempt < 8; dayAttempt += 1) {
          if (scheduledMs > routineHorizonEnd) {
            scheduledMs = null;
            break;
          }
          const day = easternDateKey(new Date(scheduledMs));
          const accountDayKey = `${cursorKey}|${day}`;
          const count = scheduledByAccountDay.get(accountDayKey) || 0;
          if (count >= target) {
            scheduledMs = easternDayEndMs(new Date(scheduledMs)) + MIN_SPACING_MS;
            continue;
          }
          const cursor = cursors.get(cursorKey) || 0;
          const earliest = Math.max(scheduledMs, cursor + MIN_SPACING_MS);
          if (earliest > routineHorizonEnd) {
            scheduledMs = null;
            break;
          }
          if (easternDateKey(new Date(earliest)) !== day) {
            scheduledMs = earliest;
            continue;
          }
          const remainingAfterThis = Math.max(0, target - count - 1);
          const availableAfterEarliest = Math.max(0, easternDayEndMs(new Date(earliest)) - MIN_SPACING_MS - earliest);
          const catchUpSpacing = remainingAfterThis > 0 ? Math.floor(availableAfterEarliest / remainingAfterThis) : MIN_SPACING_MS;
          const spacingMs = Math.max(MIN_SPACING_MS, Math.min(STANDARD_SPACING_MS, catchUpSpacing));
          scheduledMs = cursor > 0 ? Math.max(earliest, cursor + spacingMs) : earliest;
          if (scheduledMs > routineHorizonEnd) scheduledMs = null;
          break;
        }
      }
      if (breaking && scheduledMs !== null && scheduledMs > routineHorizonEnd) scheduledMs = null;
      if (scheduledMs === null) {
        result.deferred += 1;
        continue;
      }
      const scheduledDate = new Date(scheduledMs);
      if (!queueItemIsFresh(item, scheduledMs, env)
        || !destinationIdentityVerified(policy, item.lane, profile.blogId, scheduledDate)) {
        result.filtered += 1;
        continue;
      }
      const mediaUrl = item.mediaUrl || publicBrandMediaUrl(env, item.lane);
      const mediaKey = mediaUrl ? `${item.mediaType || "image"}|${mediaUrl}` : `${item.lane}|none`;
      if (!mediaIds.has(mediaKey)) {
        mediaIds.set(mediaKey, mediaUrl
          ? await normalizeMetricoolMedia(fetcher, token, mediaUrl, requestTimeoutMs, responseTimeoutMs)
          : null);
      }
      const mediaId = mediaIds.get(mediaKey) || null;
      const url = new URL("/api/v2/scheduler/posts", METRICOOL_API);
      url.searchParams.set("userId", userId);
      url.searchParams.set("blogId", profile.blogId);
      url.searchParams.set("jobId", item.id);
      const payload = {
        text: item.copy,
        providers: [{ network: providerFor(item.platform) }],
        publicationDate: { dateTime: localDateTime(scheduledDate), timezone: TIME_ZONE },
        // Keep Metricool from treating the article URL as an implicit smart
        // link. The attached, normalized media is the canonical preview and
        // prevents Facebook's "Cannot extract image from link" failure.
        descendants: [],
        firstCommentText: "",
        hasNotReadNotes: false,
        mediaAltText: [],
        shortener: false,
        smartLinkData: { ids: [] },
        ...(mediaId ? { media: { mediaId } } : {}),
        ...(item.platform === "facebook" ? {
          facebookData: { type: "POST", title: metricoolPostTitle(item.copy) },
        } : {}),
        autoPublish: true,
        draft: false,
      };
      const finalPolicy = await readPolicy();
      if (finalPolicy.paused) {
        result.status = "paused";
        result.reason = "delivery_paused_before_dispatch";
        return result;
      }
      if (!destinationIdentityVerified(finalPolicy, item.lane, profile.blogId, new Date(Math.max(now().getTime(), scheduledMs)))
        || !destinationNetworkVerified(finalPolicy, item.lane, item.platform, profile.networkAccountIds[item.platform])
        || !queueItemIsFresh(item, Math.max(now().getTime(), scheduledMs), env)) {
        result.filtered += 1;
        continue;
      }
      try {
        const attempt: NewsDeliveryAttempt = {
          attemptId: randomUUID(), articleIdentity: newsArticleIdentity(item.sourceUrl!)!,
          lane: item.lane, platform: item.platform, queueItemId: item.id,
          startedAt: (options.now || (() => new Date()))().toISOString(), state: "pending_reconciliation",
        };
        deliveryAttempts.push(attempt);
        // Durable uncertainty BEFORE the write: a crash cannot authorize resend.
        await saveNewsDeliveryAttempts(attemptsPath, deliveryAttempts);
        if ((await readPolicy()).paused) {
          result.status = "paused";
          result.reason = "delivery_paused_before_dispatch";
          return result;
        }
        const response = await scheduleMetricoolPost(fetcher, url, token, payload, requestTimeoutMs);
        attempt.httpStatus = response.status;
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500) attempt.state = "rejected";
          else result.pendingReconciliation += 1;
          await saveNewsDeliveryAttempts(attemptsPath, deliveryAttempts);
          result.failed += 1;
          if (response.status === 400 || response.status === 403 || response.status === 404) {
            if (!result.blockedLanes.includes(item.lane)) result.blockedLanes.push(item.lane);
          }
          continue;
        }
        const responseBody = await safeJson(response, responseTimeoutMs);
        const postId = responsePostId(responseBody);
        if (!postId) {
          result.pendingReconciliation += 1;
          result.failed += 1;
          await saveNewsDeliveryAttempts(attemptsPath, deliveryAttempts);
          continue;
        }
        attempt.state = "scheduling_accepted";
        attempt.metricoolPostId = postId;
        await saveNewsDeliveryAttempts(attemptsPath, deliveryAttempts);
        const ledgerEntry: Ledger["entries"][number] = {
          queueItemId: item.id,
          eventId: item.eventId,
          eventRevision: item.eventRevision,
          canonicalEventIdentity: item.canonicalEventIdentity,
          reviewHash: item.reviewHash,
          copyHash: metricoolContentHash(item.copy),
          ...(item.sourceUrl ? { sourceUrlHash: metricoolSourceUrlHash(item.sourceUrl) } : {}),
          reviewedCopyHash: hashLocalNewsReviewValue(item.copy),
          lane: item.lane,
          platform: item.platform,
          blogId: profile.blogId,
          scheduledFor: scheduledDate.toISOString(),
          scheduledAt: fetchedNow.toISOString(),
          metricoolPostId: responsePostId(responseBody),
        };
        ledger.entries.push(ledgerEntry);
        await atomicWriteLedger(ledgerPath, ledger);
        scheduledContentKeys.add(contentKey);
        cursors.set(cursorKey, Math.max(cursors.get(cursorKey) || 0, scheduledMs));
        const occupied = occupiedByAccount.get(cursorKey) || [];
        occupied.push(scheduledMs);
        occupiedByAccount.set(cursorKey, occupied);
        const accountDayKey = `${cursorKey}|${easternDateKey(scheduledDate)}`;
        scheduledByAccountDay.set(accountDayKey, (scheduledByAccountDay.get(accountDayKey) || 0) + 1);
        result.scheduled += 1;
        if (mediaId) result.mediaAttached += 1;
        else if (publicBrandMediaUrl(env, item.lane)) result.mediaFallback += 1;
      } catch {
        result.failed += 1;
        result.pendingReconciliation += 1;
      }
    }

    if (result.pendingReconciliation > 0) {
      result.status = result.scheduled ? "partial" : "blocked";
      result.reason = "metricool_reconciliation_required";
    } else if (result.scheduled === 0 && (result.blockedLanes.length || result.failed > 0)) {
      result.status = "blocked";
      result.reason = result.blockedLanes.length ? "metricool_profile_or_provider_not_connected" : "metricool_schedule_failed";
    } else if (result.blockedLanes.length || result.failed > 0) {
      result.status = "partial";
      result.reason = result.blockedLanes.length ? "some_metricool_profiles_not_connected" : "some_metricool_requests_failed";
    } else {
      result.status = "completed";
      result.reason = null;
    }
    return result;
  } finally {
    await releaseLock();
  }
}

export const __clipperLocalNewsMetricoolInternals = {
  collectProfiles,
  acquireDeliveryLock,
  localDateTime,
  providerFor,
  responsePostId,
  publicBrandMediaUrl,
  normalizeMetricoolMedia,
  metricoolContentHash,
  metricoolSourceUrlHash,
  matchesDeliveryJurisdiction: matchesClipperLocalNewsDeliveryJurisdiction,
  breakingSpacingMs,
  nextBreakingSlot,
  scheduleHorizonEndMs,
  queueItemIsFresh,
  safeJson,
  fetchMetricool,
};
