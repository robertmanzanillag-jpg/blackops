import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { localNewsArticleSlug } from "./clippers-local-news-growth";
import {
  hasCompleteLocalNewsCommitteeApproval,
  matchesClipperLocalNewsDeliveryJurisdiction,
} from "./clippers-local-news-metricool";
import { detectLocalNewsSensitiveContent, hashLocalNewsCanonicalEventIdentity, hashLocalNewsReviewValue } from "./clippers-local-news-review-committee";

export type PublicLocalNewsCity = "miami" | "new-york";
export type PublicLocalNewsLanguage = "es" | "en";

const publicEventSchema = z.object({
  id: z.string().min(1),
  lane: z.enum(["miami-news", "ny-news"]),
  title: z.string(),
  description: z.string().default(""),
  instruction: z.string().default(""),
  location: z.string(),
  eventType: z.string(),
  source: z.string(),
  sourceUrl: z.string().url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }, "sourceUrl must use HTTP or HTTPS"),
  severity: z.string().default("Unknown"),
  urgency: z.string().default("Unknown"),
  certainty: z.string().default("Unknown"),
  risk: z.enum(["low", "medium", "high", "critical"]),
  lifecycle: z.enum(["active", "resolved"]),
  effective: z.string().nullable().optional(),
  expires: z.string().nullable().optional(),
  firstSeenAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().optional(),
  revision: z.number().int().positive(),
}).passthrough();

const publicQueueItemSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  eventRevision: z.number().int().positive(),
  lane: z.enum(["miami-news", "ny-news"]),
  platform: z.enum(["x", "facebook"]),
  copy: z.string(),
  sourceUrl: z.string().url().optional(),
  evidence: z.array(z.string()).optional(),
  canonicalEventIdentity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  claimIdentityHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  risk: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["approval_required", "auto_eligible", "quarantined", "rejected"]),
  approvalRequired: z.boolean(),
  autoEligible: z.boolean(),
  organicGrowth: z.object({
    zeroCost: z.literal(true),
    experiment: z.literal("deterministic_observed_metrics"),
    variantId: z.enum(["utility", "impact"]),
    headline: z.object({ es: z.string(), en: z.string() }),
    headlineVariants: z.object({
      utility: z.object({ es: z.string(), en: z.string() }),
      impact: z.object({ es: z.string(), en: z.string() }),
    }),
    ownedArticleUrl: z.string().url().nullable(),
    hashtags: z.array(z.string()).max(5),
    shortForm: z.object({
      ready: z.literal(true), format: z.literal("9:16"), durationSeconds: z.number().int().positive(),
      soundRequired: z.literal(true), renderMode: z.literal("local_template"),
      scenes: z.array(z.object({ startSecond: z.number().nonnegative(), endSecond: z.number().positive(), text: z.string() })).max(10),
    }),
  }).optional(),
}).passthrough();

const publicStateSchema = z.object({
  updatedAt: z.string().datetime(),
  events: z.array(publicEventSchema),
  queue: z.array(publicQueueItemSchema),
}).passthrough();

const publicLedgerSchema = z.object({
  entries: z.array(z.object({
    queueItemId: z.string().min(1),
    eventId: z.string().min(1).optional(),
    eventRevision: z.number().int().positive().optional(),
    canonicalEventIdentity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    reviewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    copyHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    reviewedCopyHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    lane: z.enum(["miami-news", "ny-news"]).optional(),
    platform: z.enum(["x", "facebook"]),
    scheduledFor: z.string().datetime(),
    scheduledAt: z.string().datetime(),
  }).passthrough()),
}).passthrough();

type StateEvent = z.infer<typeof publicEventSchema>;
type StateQueueItem = z.infer<typeof publicQueueItemSchema>;
type LedgerEntry = z.infer<typeof publicLedgerSchema>["entries"][number];
type PublicState = z.infer<typeof publicStateSchema>;
type PublicLedger = z.infer<typeof publicLedgerSchema>;

interface PublicWorkspaceSnapshot {
  fingerprint: string;
  state: PublicState | null;
  ledger: PublicLedger | null;
}

const publicWorkspaceSnapshotLoads = new Map<string, Promise<PublicWorkspaceSnapshot>>();
const PUBLIC_FEED_CACHE_LIMIT = 24;
const MAX_LEGACY_STATE_BYTES = 5 * 1024 * 1024;

export interface PublicLocalNewsTranslation {
  title: string;
  summary: string;
  body: string;
}

export interface PublicLocalNewsArticle {
  slug: string;
  city: PublicLocalNewsCity;
  lane: "miami-news" | "ny-news";
  lang: PublicLocalNewsLanguage;
  title: string;
  summary: string;
  body: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  category: "weather" | "traffic" | "public-safety" | "local";
  location: string;
  lifecycle: "active" | "resolved";
  translations: Record<PublicLocalNewsLanguage, PublicLocalNewsTranslation>;
  timestamps: {
    effectiveAt: string | null;
    expiresAt: string | null;
    firstSeenAt: string;
    updatedAt: string;
    resolvedAt: string | null;
    scheduledFor: string;
    scheduledAt: string;
  };
  publicationEvidence: {
    kind: "metricool_scheduled";
    platforms: Array<"x" | "facebook">;
  };
  organicGrowth: {
    zeroCost: true;
    variantId: "utility" | "impact";
    headlineVariants: Record<"utility" | "impact", Record<PublicLocalNewsLanguage, string>>;
    hashtags: string[];
    shortFormReady: boolean;
  } | null;
}

export interface PublicLocalNewsFeed {
  updatedAt: string | null;
  lang: PublicLocalNewsLanguage;
  city: PublicLocalNewsCity | null;
  articles: PublicLocalNewsArticle[];
}

interface PublicFeedCacheEntry {
  fingerprint: string;
  cachedAt: number;
  feed: PublicLocalNewsFeed;
}

const publicFeedCache = new Map<string, PublicFeedCacheEntry>();
const publicFeedLoads = new Map<string, Promise<PublicLocalNewsFeed>>();

export interface PublicLocalNewsOptions {
  workspaceDir?: string;
  city?: PublicLocalNewsCity;
  lang?: PublicLocalNewsLanguage;
  limit?: number;
  now?: Date | string;
}

const CATEGORY_TERMS = {
  weather: { en: "weather", es: "meteorológica" },
  traffic: { en: "traffic", es: "de tránsito" },
  "public-safety": { en: "public safety", es: "de seguridad pública" },
  local: { en: "local", es: "local" },
} as const;

function resolveWorkspace(workspaceDir?: string): string {
  return path.resolve(
    workspaceDir
      || process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE
      || path.join(process.cwd(), "clippers_workspace", "local-news"),
  );
}

async function readJsonIfPresent<S extends z.ZodTypeAny>(filePath: string, schema: S): Promise<z.output<S> | null> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function fileFingerprint(filePath: string): Promise<string> {
  try {
    const info = await stat(filePath, { bigint: true });
    return `${info.size}:${info.mtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function fileSize(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publicWorkspaceFingerprint(workspaceDir: string): Promise<string> {
  const snapshotPath = path.join(workspaceDir, "public-news-snapshot.json");
  const snapshotFingerprint = await fileFingerprint(snapshotPath);
  const sourceFingerprint = snapshotFingerprint === "missing"
    ? await fileFingerprint(path.join(workspaceDir, "state.json"))
    : snapshotFingerprint;
  return `${sourceFingerprint}|${await fileFingerprint(path.join(workspaceDir, "metricool-delivery-ledger.json"))}`;
}

function rememberPublicFeed(cacheKey: string, entry: PublicFeedCacheEntry): void {
  publicFeedCache.delete(cacheKey);
  publicFeedCache.set(cacheKey, entry);
  while (publicFeedCache.size > PUBLIC_FEED_CACHE_LIMIT) {
    const oldest = publicFeedCache.keys().next().value;
    if (oldest === undefined) break;
    publicFeedCache.delete(oldest);
  }
}

async function loadPublicWorkspaceSnapshot(workspaceDir: string): Promise<PublicWorkspaceSnapshot> {
  const statePath = path.join(workspaceDir, "state.json");
  const publicSnapshotPath = path.join(workspaceDir, "public-news-snapshot.json");
  const ledgerPath = path.join(workspaceDir, "metricool-delivery-ledger.json");

  const activeLoad = publicWorkspaceSnapshotLoads.get(workspaceDir);
  if (activeLoad) return activeLoad;

  const load = (async () => {
    const retryDelays = [0, 50, 150, 400, 800];
    let lastError: unknown;
    for (const delay of retryDelays) {
      if (delay) await pause(delay);
      const publicSnapshotFingerprint = await fileFingerprint(publicSnapshotPath);
      const sourcePath = publicSnapshotFingerprint === "missing" ? statePath : publicSnapshotPath;
      const sourceFingerprint = publicSnapshotFingerprint === "missing"
        ? await fileFingerprint(statePath)
        : publicSnapshotFingerprint;
      const before = `${sourceFingerprint}|${await fileFingerprint(ledgerPath)}`;
      try {
        const sourceSize = await fileSize(sourcePath);
        // A legacy workspace may not have the compact artifact until its next
        // scheduler cycle. Never parse a giant operational state in a public
        // request: return an empty edition and let the scheduler materialize it.
        if (sourcePath === statePath && sourceSize !== null && sourceSize > MAX_LEGACY_STATE_BYTES) {
          const ledger = await readJsonIfPresent(ledgerPath, publicLedgerSchema);
          return { fingerprint: before, state: null, ledger };
        }
        const [state, ledger] = await Promise.all([
          readJsonIfPresent(sourcePath, publicStateSchema),
          readJsonIfPresent(ledgerPath, publicLedgerSchema),
        ]);
        const after = `${await fileFingerprint(sourcePath)}|${await fileFingerprint(ledgerPath)}`;
        if (before !== after) {
          lastError = new Error("Public local news files changed while being read");
          continue;
        }
        return { fingerprint: after, state, ledger };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  })().finally(() => {
    publicWorkspaceSnapshotLoads.delete(workspaceDir);
  });
  publicWorkspaceSnapshotLoads.set(workspaceDir, load);
  return load;
}

function cityForLane(lane: StateEvent["lane"]): PublicLocalNewsCity {
  return lane === "miami-news" ? "miami" : "new-york";
}

function categoryFor(event: StateEvent): PublicLocalNewsArticle["category"] {
  const text = `${event.source} ${event.eventType} ${event.title} ${event.description}`.toLowerCase();
  if (/police|fire|emergency|evacuat|public safety|bombero|polic[ií]a|emergencia|evacua|federal bureau of investigation|\bfbi\b|department of justice|u\.s\. attorney|arrest|custody|charged|indict|criminal complaint|defendant|homicid|murder|asesinat|robbery|assault|kidnap|secuestr/.test(text)) return "public-safety";
  if (/traffic|road|route|highway|crash|collision|closure|closed|lane|congestion|tr[aá]nsito|carretera|cierre/.test(text)) return "traffic";
  if (/weather|storm|rain|flood|wind|snow|heat|cold|tornado|hurricane|clima|tormenta|lluvia|inundaci|hurac[aá]n/.test(text)) return "weather";
  return "local";
}

function isAccusationStory(event: StateEvent): boolean {
  return detectLocalNewsSensitiveContent({ title: event.title, description: event.description, instruction: event.instruction, location: event.location, eventType: event.eventType }).accusation;
}

function matchesReviewedEventIdentity(item: StateQueueItem, event: StateEvent): boolean {
  if (!item.canonicalEventIdentity || !item.claimIdentityHash || item.lane !== event.lane || item.risk !== event.risk) return false;
  return item.canonicalEventIdentity === hashLocalNewsCanonicalEventIdentity({
    eventId: event.id, eventRevision: event.revision, lane: event.lane, title: event.title, description: event.description, instruction: event.instruction,
    location: event.location, eventType: event.eventType, source: event.source, sourceUrl: event.sourceUrl, risk: event.risk, lifecycle: event.lifecycle,
    effective: event.effective || null, expires: event.expires || null, claimIdentityHash: item.claimIdentityHash,
  });
}

function localizedContent(event: StateEvent, category: PublicLocalNewsArticle["category"], queueItems: StateQueueItem[]): Record<PublicLocalNewsLanguage, PublicLocalNewsTranslation> {
  const englishStatus = event.lifecycle === "resolved" ? "resolved" : "active";
  const spanishStatus = event.lifecycle === "resolved" ? "resuelta" : "activa";
  const categoryTerm = CATEGORY_TERMS[category];
  const growth = queueItems.find((item) => item.organicGrowth)?.organicGrowth;
  const accusation = isAccusationStory(event);
  const legalEn = accusation ? " An arrest, accusation, or charge is not a finding of guilt; every person is presumed innocent unless proven guilty in court." : "";
  const legalEs = accusation ? " Una detención, acusación o cargo no equivale a culpabilidad; toda persona se presume inocente hasta que un tribunal determine lo contrario." : "";
  return {
    en: {
      title: growth?.headline.en || `${categoryTerm.en[0].toUpperCase()}${categoryTerm.en.slice(1)} update for ${event.location}`,
      summary: `${event.title}. An official ${categoryTerm.en} update for ${event.location} is ${englishStatus}. Check the attributed source for the latest details.${legalEn}`,
      body: `Source headline: ${event.title}. Location: ${event.location}. Status: ${englishStatus}. Severity: ${event.severity}. This structured summary preserves the source attribution and does not claim to be a complete translation of the original notice.${legalEn}`,
    },
    es: {
      title: growth?.headline.es || `Actualización ${categoryTerm.es} para ${event.location}`,
      summary: `${event.title}. Hay una actualización oficial ${categoryTerm.es} para ${event.location}. La situación está ${spanishStatus}. Consulte la fuente atribuida para conocer los detalles más recientes.${legalEs}`,
      body: `Titular de la fuente: ${event.title}. Ubicación: ${event.location}. Estado: ${spanishStatus}. Severidad indicada por la fuente: ${event.severity}. Este es un resumen estructurado y no pretende ser una traducción completa del aviso original.${legalEs}`,
    },
  };
}

function articleSlug(event: StateEvent): string { return localNewsArticleSlug(event.id, event.lane); }

function buildArticle(
  event: StateEvent,
  queueItems: StateQueueItem[],
  evidence: LedgerEntry[],
  lang: PublicLocalNewsLanguage,
): PublicLocalNewsArticle {
  const category = categoryFor(event);
  const translations = localizedContent(event, category, queueItems);
  const orderedEvidence = [...evidence].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const earliest = orderedEvidence[0];
  const latestScheduledAt = [...orderedEvidence].sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0].scheduledAt;
  const platforms = Array.from(new Set(queueItems.map((item) => item.platform))).sort() as Array<"x" | "facebook">;
  const growth = queueItems.find((item) => item.organicGrowth)?.organicGrowth;
  return {
    slug: articleSlug(event),
    city: cityForLane(event.lane),
    lane: event.lane,
    lang,
    ...translations[lang],
    source: event.source,
    sourceUrl: event.sourceUrl,
    publishedAt: earliest.scheduledFor,
    category,
    location: event.location,
    lifecycle: event.lifecycle,
    translations,
    timestamps: {
      effectiveAt: event.effective || null,
      expiresAt: event.expires || null,
      firstSeenAt: event.firstSeenAt,
      updatedAt: event.updatedAt,
      resolvedAt: event.resolvedAt || null,
      scheduledFor: earliest.scheduledFor,
      scheduledAt: latestScheduledAt,
    },
    publicationEvidence: { kind: "metricool_scheduled", platforms },
    organicGrowth: growth ? {
      zeroCost: true,
      variantId: growth.variantId,
      headlineVariants: growth.headlineVariants,
      hashtags: growth.hashtags,
      shortFormReady: growth.shortForm.ready,
    } : null,
  };
}

export async function listPublicLocalNews(options: PublicLocalNewsOptions = {}): Promise<PublicLocalNewsFeed> {
  const workspaceDir = resolveWorkspace(options.workspaceDir);
  const lang = options.lang || "es";
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit || 30)));
  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : options.now
      ? Date.parse(options.now)
      : Date.now();
  const cacheKey = JSON.stringify([workspaceDir, options.city || null, lang, limit, options.now ? new Date(nowMs).toISOString() : "live"]);
  const currentFingerprint = await publicWorkspaceFingerprint(workspaceDir);
  const cached = publicFeedCache.get(cacheKey);
  if (cached?.fingerprint === currentFingerprint && Date.now() - cached.cachedAt <= 30_000) return cached.feed;
  const activeLoad = publicFeedLoads.get(cacheKey);
  if (activeLoad) return activeLoad;

  const load = (async () => {
    try {
      const { fingerprint, state, ledger } = await loadPublicWorkspaceSnapshot(workspaceDir);
      if (!state || !ledger) {
        const empty = { updatedAt: state?.updatedAt || null, lang, city: options.city || null, articles: [] };
        rememberPublicFeed(cacheKey, { fingerprint, cachedAt: Date.now(), feed: empty });
        return empty;
      }

      const ledgerByQueueId = new Map<string, LedgerEntry[]>();
      for (const entry of ledger.entries) {
        const entries = ledgerByQueueId.get(entry.queueItemId) || [];
        entries.push(entry);
        ledgerByQueueId.set(entry.queueItemId, entries);
      }
      const eventById = new Map(state.events.map((event) => [event.id, event]));
      const publishedByEvent = new Map<string, { event: StateEvent; queueItems: StateQueueItem[]; evidence: LedgerEntry[] }>();
      for (const item of state.queue) {
        if (!item.autoEligible || item.approvalRequired || item.status !== "auto_eligible") continue;
        const event = eventById.get(item.eventId);
        // Only expose the exact current revision after its scheduled publication time.
        // This prevents stale safe evidence from publishing a later high-risk snapshot.
        if (!event || event.revision !== item.eventRevision) continue;
        if (!matchesClipperLocalNewsDeliveryJurisdiction({
          lane: item.lane,
          sourceUrl: item.sourceUrl || event.sourceUrl,
          evidence: item.evidence,
        })) continue;
        const sensitive = item.risk === "high" || item.risk === "critical" || event.risk === "high" || event.risk === "critical";
        if (sensitive && (!hasCompleteLocalNewsCommitteeApproval(item) || !matchesReviewedEventIdentity(item, event))) continue;
        const evidence = ledgerByQueueId.get(item.id)?.filter((entry) => (
          entry.platform === item.platform
          && Date.parse(entry.scheduledFor) <= nowMs
          && (!sensitive || (
            entry.eventId === item.eventId
            && entry.eventRevision === item.eventRevision
            && entry.lane === item.lane
            && entry.reviewedCopyHash === hashLocalNewsReviewValue(item.copy)
            && entry.canonicalEventIdentity === item.canonicalEventIdentity
            && entry.reviewHash === item.reviewHash
          ))
        ));
        if (!evidence?.length) continue;
        const existing = publishedByEvent.get(event.id) || {
          event,
          queueItems: [] as StateQueueItem[],
          evidence: [] as LedgerEntry[],
        };
        existing.queueItems.push(item);
        existing.evidence.push(...evidence);
        publishedByEvent.set(event.id, existing);
      }

      const articles = [...publishedByEvent.values()]
        .filter(({ event }) => !options.city || cityForLane(event.lane) === options.city)
        .map(({ event, queueItems, evidence }) => buildArticle(event, queueItems, evidence, lang))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug))
        .slice(0, limit);
      const feed = { updatedAt: state.updatedAt, lang, city: options.city || null, articles };
      rememberPublicFeed(cacheKey, { fingerprint, cachedAt: Date.now(), feed });
      return feed;
    } catch (error) {
      // Keep the public edition online during a transient read or memory spike,
      // but cache only the small, already-sanitized response — never the 26 MB state.
      if (cached) return cached.feed;
      throw error;
    }
  })().finally(() => {
    publicFeedLoads.delete(cacheKey);
  });
  publicFeedLoads.set(cacheKey, load);
  return load;
}

export async function getPublicLocalNewsBySlug(slug: string, options: Omit<PublicLocalNewsOptions, "limit"> = {}): Promise<PublicLocalNewsArticle | null> {
  const feed = await listPublicLocalNews({ ...options, limit: 100 });
  return feed.articles.find((article) => article.slug === slug) || null;
}

export function publicLocalNewsEtag(value: unknown): string {
  return `\"${createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 32)}\"`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Safe metadata/body helper for a canonical, server-rendered Facebook share page. */
export function renderPublicLocalNewsShareHtml(article: PublicLocalNewsArticle, canonicalUrl: string, imageUrl?: string): string {
  const title = escapeHtml(article.title);
  const summary = escapeHtml(article.summary);
  const canonical = escapeHtml(canonicalUrl);
  const imageMeta = imageUrl ? [
    `<meta property="og:image" content="${escapeHtml(imageUrl)}">`,
    `<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="1254">`,
    `<meta property="og:image:height" content="1254">`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtml(article.city === "miami" ? "Miami News" : "New York News")}">`,
  ].join("\n  ") : "";
  const city = article.city === "miami" ? "Miami" : article.lang === "es" ? "Nueva York" : "New York";
  const backLabel = article.lang === "es" ? `Volver a ${city}` : `Back to ${city}`;
  const sourceLabel = article.lang === "es" ? "Fuente original" : "Original source";
  const shareLabel = article.lang === "es" ? "Compartir actualización" : "Share update";
  const copiedLabel = article.lang === "es" ? "Enlace copiado" : "Link copied";
  const shareFailedLabel = article.lang === "es" ? "No se pudo compartir" : "Unable to share";
  const disclaimer = article.lang === "es"
    ? "Metro Current es una publicación independiente y no está afiliada con ninguna ciudad, policía, agencia de tránsito, servicio 511 u oficina gubernamental. Sigue la fuente enlazada para instrucciones oficiales."
    : "Metro Current is an independent publication and is not affiliated with any city, police department, transit agency, 511 service, or government office. Follow the linked source for official instructions.";
  const alternateLanguage = article.lang === "es" ? "en" : "es";
  const alternateLabel = alternateLanguage.toUpperCase();
  const alternateUrl = new URL(canonicalUrl);
  alternateUrl.searchParams.set("lang", alternateLanguage);
  const spanishUrl = new URL(canonicalUrl);
  spanishUrl.searchParams.set("lang", "es");
  const englishUrl = new URL(canonicalUrl);
  englishUrl.searchParams.set("lang", "en");
  const editionUrl = `/news/${article.city}?lang=${article.lang}`;
  const displayDate = new Intl.DateTimeFormat(article.lang === "es" ? "es-US" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(article.publishedAt));
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.summary,
    datePublished: article.publishedAt,
    dateModified: article.timestamps.updatedAt,
    inLanguage: article.lang,
    mainEntityOfPage: canonicalUrl,
    articleSection: article.category,
    contentLocation: { "@type": "Place", name: article.location },
    publisher: { "@type": "Organization", name: "Metro Current" },
    isBasedOn: article.sourceUrl,
    ...(imageUrl ? { image: [imageUrl] } : {}),
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${article.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} | Metro Current</title>
  <meta name="description" content="${summary}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Metro Current">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${summary}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:locale" content="${article.lang === "es" ? "es_US" : "en_US"}">
  <meta property="og:locale:alternate" content="${article.lang === "es" ? "en_US" : "es_US"}">
  <meta property="article:published_time" content="${escapeHtml(article.publishedAt)}">
  <meta property="article:modified_time" content="${escapeHtml(article.timestamps.updatedAt)}">
  ${imageMeta}
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="es" href="${escapeHtml(spanishUrl.toString())}">
  <link rel="alternate" hreflang="en" href="${escapeHtml(englishUrl.toString())}">
  <link rel="alternate" hreflang="x-default" href="${escapeHtml(spanishUrl.toString())}">
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#fbfaf6;color:#102a43;font-family:Inter,Arial,sans-serif}a{color:inherit}.top{background:#17395c;color:#fff;padding:10px 20px;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}.mast{border-bottom:1px solid #bcc6cf;padding:24px 20px;text-align:center}.mast a{text-decoration:none}.brand{font-family:Georgia,serif;font-size:clamp(34px,7vw,58px);font-weight:900;letter-spacing:-.05em}.cities{color:#c84631;font-size:10px;font-weight:800;letter-spacing:.3em;text-transform:uppercase}.tools{margin-top:16px}.tools a{border:1px solid #17395c;border-radius:999px;padding:7px 11px;text-decoration:none;font-size:11px;font-weight:800}.wrap{max-width:880px;margin:0 auto;padding:44px 20px 72px}.back{color:#c84631;font-size:11px;font-weight:900;letter-spacing:.13em;text-decoration:none;text-transform:uppercase}.desk{display:flex;align-items:center;gap:12px;margin-top:32px}.desk img{width:52px;height:52px;border-radius:50%;object-fit:cover}.desk span{font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}h1{font-family:Georgia,serif;font-size:clamp(42px,8vw,72px);letter-spacing:-.045em;line-height:1.02;margin:28px 0 0}.summary{border-left:4px solid #e35d44;color:#455462;font-family:Georgia,serif;font-size:clamp(20px,3vw,26px);line-height:1.45;margin:28px 0;padding-left:20px}.meta{border-bottom:1px solid #c6ced5;border-top:1px solid #c6ced5;color:#65717c;font-size:13px;padding:16px 0}.share{align-items:center;background:transparent;border:1px solid #17395c;border-radius:999px;color:#17395c;cursor:pointer;display:inline-flex;font-size:11px;font-weight:900;letter-spacing:.1em;margin-top:16px;padding:10px 15px;text-transform:uppercase}.share:hover,.share:focus-visible{background:#17395c;color:#fff;outline:2px solid #e35d44;outline-offset:2px}.share-status{color:#566471;font-size:12px;margin-left:10px}.body{font-family:Georgia,serif;font-size:20px;line-height:1.75;margin:38px auto 0;max-width:760px}.source{background:#fff;border-left:4px solid #17395c;box-shadow:0 10px 28px rgba(16,42,67,.07);margin:42px auto 0;max-width:760px;padding:22px}.source small{color:#68737d;display:block;font-size:10px;font-weight:900;letter-spacing:.17em;text-transform:uppercase}.source a{display:inline-block;font-weight:800;margin-top:9px;text-decoration-color:#e35d44;text-decoration-thickness:2px;text-underline-offset:4px}.notice{background:#e9edf0;border-top:4px solid #17395c;color:#566471;font-size:12px;line-height:1.6;padding:26px 20px;text-align:center}@media(max-width:520px){.wrap{padding-top:32px}h1{font-size:42px}.body{font-size:18px}.summary{font-size:20px}}
  </style>
</head>
<body>
  <div class="top">${article.lang === "es" ? "Mesa local independiente" : "Independent local news desk"}</div>
  <header class="mast"><a href="/news?lang=${article.lang}"><div class="brand">Metro Current</div><div class="cities">Miami · New York</div></a><div class="tools"><a href="${escapeHtml(alternateUrl.toString())}">${alternateLabel}</a></div></header>
  <main class="wrap"><article>
    <a class="back" href="${editionUrl}">← ${escapeHtml(backLabel)}</a>
    <div class="desk">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(city)} News">` : ""}<span>${escapeHtml(city)}</span></div>
    <h1>${title}</h1>
    <p class="summary">${summary}</p>
    <p class="meta">${escapeHtml(displayDate)} · ${escapeHtml(article.location)} · ${escapeHtml(article.category)}</p>
    <button class="share" id="share-update" type="button">${escapeHtml(shareLabel)}</button><span class="share-status" id="share-status" role="status" aria-live="polite"></span>
    <div class="body"><p>${escapeHtml(article.body)}</p></div>
    <aside class="source"><small>${sourceLabel}</small><a href="${escapeHtml(article.sourceUrl)}" rel="noopener noreferrer">${escapeHtml(article.source)} ↗</a></aside>
  </article></main>
  <footer class="notice">${escapeHtml(disclaimer)}</footer>
  <script>
    (() => {
      const button = document.getElementById("share-update");
      const status = document.getElementById("share-status");
      if (!button || !status) return;
      button.addEventListener("click", async () => {
        try {
          if (navigator.share) await navigator.share({ title: ${JSON.stringify(article.title).replace(/</g, "\\u003c")}, text: ${JSON.stringify(article.summary).replace(/</g, "\\u003c")}, url: window.location.href });
          else {
            await navigator.clipboard.writeText(window.location.href);
            status.textContent = ${JSON.stringify(copiedLabel)};
          }
        } catch (error) {
          if (error && error.name === "AbortError") return;
          status.textContent = ${JSON.stringify(shareFailedLabel)};
        }
      });
    })();
  </script>
</body>
</html>`;
}
