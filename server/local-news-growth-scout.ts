import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 360;
const DEFAULT_LIMIT_PER_SOURCE = 25;
const MAX_SIGNALS = 120;
const MAX_RECOMMENDATIONS = 12;
const MAX_SOURCE_RESPONSE_BYTES = 1_000_000;

export type GrowthScoutSourceKind = "reddit" | "rss";
export type GrowthScoutPattern = "breaking_alert" | "outcome" | "explainer" | "question" | "community_update" | "other";

export interface GrowthScoutSource {
  id: string;
  kind: GrowthScoutSourceKind;
  label: string;
  url: string;
  lane: "miami-news" | "ny-news" | "cross-platform";
}

export interface GrowthScoutSignal {
  id: string;
  sourceId: string;
  sourceKind: GrowthScoutSourceKind;
  lane: GrowthScoutSource["lane"];
  title: string;
  sourceUrl: string;
  publishedAt: string | null;
  collectedAt: string;
  score: number | null;
  comments: number | null;
  pattern: GrowthScoutPattern;
  engagementRate: number | null;
  recencyHours: number | null;
}

export interface GrowthScoutRecommendation {
  id: string;
  pattern: GrowthScoutPattern;
  lane: GrowthScoutSource["lane"];
  confidence: number;
  evidenceCount: number;
  medianComments: number;
  medianScore: number;
  action: string;
  guardrail: string;
}

export interface LocalNewsGrowthScoutSnapshot {
  generatedAt: string;
  sources: GrowthScoutSource[];
  signals: GrowthScoutSignal[];
  recommendations: GrowthScoutRecommendation[];
  sourceErrors: Array<{ sourceId: string; error: string }>;
  policy: {
    metadataOnly: true;
    noContentReposting: true;
    noAutomatedCommunityPosting: true;
    rightsReviewBeforeUsingMedia: true;
  };
}

export interface LocalNewsGrowthScoutStatus {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  snapshot: LocalNewsGrowthScoutSnapshot | null;
  artifactPath: string;
}

interface RedditListingChild {
  data?: {
    id?: unknown;
    title?: unknown;
    permalink?: unknown;
    url?: unknown;
    created_utc?: unknown;
    score?: unknown;
    num_comments?: unknown;
    selftext?: unknown;
  };
}

interface ScoutDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

interface SchedulerDeps extends ScoutDeps {
  setInterval?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void;
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}

interface LocalNewsGrowthScoutScheduler {
  start(): LocalNewsGrowthScoutStatus;
  stop(): LocalNewsGrowthScoutStatus;
  runNow(): Promise<"completed" | "failed" | "skipped">;
  status(): LocalNewsGrowthScoutStatus;
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function scoutWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.resolve(env.CLIPPERS_LOCAL_NEWS_WORKSPACE || path.join(process.cwd(), "clippers_workspace", "local-news")), "growth-scout");
}

function artifactPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(scoutWorkspace(env), "growth-scout-latest.json");
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24);
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function redactedSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "https://invalid.local/";
  }
}

function cleanTitle(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 240) : "";
}

function isoFromUnix(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1_000).toISOString();
}

function patternFor(title: string): GrowthScoutPattern {
  const text = title.normalize("NFKD").toLocaleLowerCase("en-US");
  if (/\b(update|breaking|alert|evacu|warning|active shooter|missing|fire|crash)\b/.test(text)) return "breaking_alert";
  if (/\b(arrest|charged|sentenced|pleads?|guilty|rescued|found|dies|killed|wins?)\b/.test(text)) return "outcome";
  if (/\b(how|why|what to know|explained|guide|tips?|here.s what)\b/.test(text)) return "explainer";
  if (/[?¿]/.test(title) || /^is\b|^does\b|^what\b/i.test(text)) return "question";
  if (/\b(community|neighbor|neighbour|local|resident|street|school|business)\b/.test(text)) return "community_update";
  return "other";
}

function normalizedSources(env: NodeJS.ProcessEnv = process.env): GrowthScoutSource[] {
  const configured = env.LOCAL_NEWS_GROWTH_SCOUT_SOURCES?.trim();
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as unknown;
      if (Array.isArray(parsed)) {
        const custom = parsed.flatMap((item, index) => {
          if (!item || typeof item !== "object") return [];
          const value = item as Record<string, unknown>;
          const url = safeUrl(value.url);
          const kind = value.kind === "rss" ? "rss" : value.kind === "reddit" ? "reddit" : null;
          const lane = value.lane === "miami-news" || value.lane === "ny-news" || value.lane === "cross-platform" ? value.lane : "cross-platform";
          if (!url || !kind) return [];
          return [{ id: cleanTitle(value.id) || `custom-${index + 1}`, kind, label: cleanTitle(value.label) || `Custom source ${index + 1}`, url, lane } satisfies GrowthScoutSource];
        });
        if (custom.length) return custom.slice(0, 20);
      }
    } catch {
      // Fall back to the safe public defaults.
    }
  }
  return [
    { id: "reddit-miami", kind: "reddit", label: "Reddit Miami", url: "https://www.reddit.com/r/Miami/hot.json?limit=25&raw_json=1", lane: "miami-news" },
    { id: "reddit-nyc", kind: "reddit", label: "Reddit NYC", url: "https://www.reddit.com/r/nyc/hot.json?limit=25&raw_json=1", lane: "ny-news" },
    { id: "reddit-news", kind: "reddit", label: "Reddit News", url: "https://www.reddit.com/r/news/hot.json?limit=25&raw_json=1", lane: "cross-platform" },
    { id: "reddit-facebook", kind: "reddit", label: "Reddit Facebook", url: "https://www.reddit.com/r/facebook/hot.json?limit=25&raw_json=1", lane: "cross-platform" },
    { id: "reddit-social-media", kind: "reddit", label: "Reddit Social Media", url: "https://www.reddit.com/r/socialmedia/hot.json?limit=25&raw_json=1", lane: "cross-platform" },
    { id: "google-news-miami", kind: "rss", label: "Google News Miami", url: "https://news.google.com/rss/search?q=Miami%20public%20safety%20OR%20breaking%20news&hl=en-US&gl=US&ceid=US:en", lane: "miami-news" },
    { id: "google-news-nyc", kind: "rss", label: "Google News New York", url: "https://news.google.com/rss/search?q=New%20York%20public%20safety%20OR%20breaking%20news&hl=en-US&gl=US&ceid=US:en", lane: "ny-news" },
  ];
}

function parseXmlItems(xml: string): Array<{ title: string; link: string; publishedAt: string | null }> {
  return [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].flatMap((match) => {
    const item = match[0];
    const value = (tag: string) => item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() || "";
    const title = cleanTitle(value("title"));
    const link = safeUrl(value("link"));
    if (!title || !link) return [];
    const published = value("pubDate") || value("published") || value("updated");
    const date = published ? new Date(published) : null;
    return [{ title, link, publishedAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null }];
  }).slice(0, DEFAULT_LIMIT_PER_SOURCE);
}

function parseRedditListing(payload: unknown): Array<{ title: string; link: string; publishedAt: string | null; score: number; comments: number }> {
  if (!payload || typeof payload !== "object") return [];
  const children = ((payload as { data?: { children?: RedditListingChild[] } }).data?.children || []);
  return children.flatMap((child) => {
    const data = child?.data;
    if (!data) return [];
    const title = cleanTitle(data.title);
    // Prefer the public Reddit permalink so a media URL is never treated as a
    // reusable source asset. The external URL is only a metadata fallback.
    const permalink = typeof data.permalink === "string" ? safeUrl(`https://www.reddit.com${data.permalink}`) : null;
    const link = permalink || safeUrl(data.url);
    if (!title || !link) return [];
    return [{ title, link, publishedAt: isoFromUnix(data.created_utc), score: Math.max(0, Number(data.score) || 0), comments: Math.max(0, Number(data.num_comments) || 0) }];
  }).slice(0, DEFAULT_LIMIT_PER_SOURCE);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function recommendations(signals: GrowthScoutSignal[]): GrowthScoutRecommendation[] {
  const groups = new Map<string, GrowthScoutSignal[]>();
  for (const signal of signals) {
    const key = `${signal.lane}|${signal.pattern}`;
    groups.set(key, [...(groups.get(key) || []), signal]);
  }
  return [...groups.entries()].map(([key, items]) => {
    const [lane, pattern] = key.split("|") as [GrowthScoutSource["lane"], GrowthScoutPattern];
    const scores = items.map((item) => item.score || 0);
    const comments = items.map((item) => item.comments || 0);
    const confidence = Math.min(0.95, Math.round((0.35 + Math.min(items.length, 8) * 0.07 + (median(comments) >= 5 ? 0.08 : 0)) * 100) / 100);
    const action = pattern === "breaking_alert"
      ? "Priorizar un titular de alerta con hora, ciudad y enlace oficial; usar video/voz propia solo cuando aporte contexto."
      : pattern === "outcome"
        ? "Probar un formato de resultado verificable: qué ocurrió, qué resolvió la autoridad y qué debe saber el lector."
        : pattern === "explainer"
          ? "Convertir la historia en una explicación breve bilingüe con una pregunta frecuente respondida en los primeros segundos."
          : pattern === "question"
            ? "Usar una pregunta del público como gancho y responderla con fuente primaria, sin fabricar debate."
            : pattern === "community_update"
              ? "Añadir contexto de barrio y utilidad práctica; pedir una respuesta concreta, no comentarios vacíos."
              : "Mantener el patrón solo como experimento; no copiar titulares ni contenido de terceros.";
    return {
      id: hash(`${key}|${items.map((item) => item.id).sort().join(",")}`),
      pattern,
      lane,
      confidence,
      evidenceCount: items.length,
      medianComments: median(comments),
      medianScore: median(scores),
      action,
      guardrail: "Señal direccional (score/comentarios no equivale a views): usarla para formato/horario; no reutilizar el post, video, audio ni comentarios originales.",
    } satisfies GrowthScoutRecommendation;
  }).sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount).slice(0, MAX_RECOMMENDATIONS);
}

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  return error.message.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 240) || "request_failed";
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_RESPONSE_BYTES) throw new Error("source_response_too_large");
  if (!response.body) {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_SOURCE_RESPONSE_BYTES) throw new Error("source_response_too_large");
    return body;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > MAX_SOURCE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("source_response_too_large");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function fetchSource(source: GrowthScoutSource, fetcher: typeof globalThis.fetch, now: Date): Promise<GrowthScoutSignal[]> {
  const response = await fetcher(source.url, {
    headers: { Accept: source.kind === "rss" ? "application/rss+xml, application/xml, text/xml" : "application/json", "User-Agent": "robert-local-news-growth-scout/1.0 (metadata-only)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await readBoundedResponseText(response);
  const raw = source.kind === "rss" ? body : JSON.parse(body);
  const rows = source.kind === "rss"
    ? parseXmlItems(raw as string).map((item) => ({ ...item, score: null, comments: null }))
    : parseRedditListing(raw);
  return rows.map((item) => {
    const publishedMs = item.publishedAt ? new Date(item.publishedAt).getTime() : Number.NaN;
    const recencyHours = Number.isFinite(publishedMs) ? Math.max(0, Math.round((now.getTime() - publishedMs) / 3_600_000 * 10) / 10) : null;
    const comments = item.comments ?? null;
    const score = item.score ?? null;
    return {
      id: hash(`${source.id}|${item.link}`),
      sourceId: source.id,
      sourceKind: source.kind,
      lane: source.lane,
      title: item.title,
      sourceUrl: item.link,
      publishedAt: item.publishedAt,
      collectedAt: now.toISOString(),
      score,
      comments,
      pattern: patternFor(item.title),
      engagementRate: score !== null && comments !== null ? Math.round((comments / Math.max(score, 1)) * 10_000) / 10_000 : null,
      recencyHours,
    } satisfies GrowthScoutSignal;
  });
}

export async function runLocalNewsGrowthScout(options: ScoutDeps = {}): Promise<LocalNewsGrowthScoutSnapshot> {
  const env = options.env || process.env;
  const now = options.now || (() => new Date());
  const fetcher = options.fetch || globalThis.fetch;
  const sources = normalizedSources(env);
  const signals: GrowthScoutSignal[] = [];
  const sourceErrors: LocalNewsGrowthScoutSnapshot["sourceErrors"] = [];
  for (const source of sources) {
    try {
      signals.push(...await fetchSource(source, fetcher, now()));
    } catch (error) {
      sourceErrors.push({ sourceId: source.id, error: safeError(error) });
    }
  }
  const deduped = [...new Map(signals.map((signal) => [signal.id, signal])).values()]
    .sort((a, b) => (b.recencyHours === null ? -1 : a.recencyHours === null ? 1 : a.recencyHours - b.recencyHours) || (b.comments || 0) - (a.comments || 0))
    .slice(0, MAX_SIGNALS);
  const snapshot: LocalNewsGrowthScoutSnapshot = {
    generatedAt: now().toISOString(),
    sources: sources.map((source) => ({ ...source, url: redactedSourceUrl(source.url) })),
    signals: deduped,
    recommendations: recommendations(deduped),
    sourceErrors,
    policy: { metadataOnly: true, noContentReposting: true, noAutomatedCommunityPosting: true, rightsReviewBeforeUsingMedia: true },
  };
  const target = artifactPath(env);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(target), 0o700);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  return snapshot;
}

let defaultStatusReader: (() => LocalNewsGrowthScoutStatus) | null = null;
let defaultSnapshot: LocalNewsGrowthScoutSnapshot | null = null;

function schedulerConfig(env: NodeJS.ProcessEnv = process.env) {
  return { enabled: env.LOCAL_NEWS_GROWTH_SCOUT_ENABLED !== "false", intervalMinutes: integer(env.LOCAL_NEWS_GROWTH_SCOUT_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES) };
}

async function loadSnapshot(env: NodeJS.ProcessEnv = process.env): Promise<LocalNewsGrowthScoutSnapshot | null> {
  try {
    return JSON.parse(await readFile(artifactPath(env), "utf8")) as LocalNewsGrowthScoutSnapshot;
  } catch {
    return null;
  }
}

export function getLocalNewsGrowthScoutStatus(env: NodeJS.ProcessEnv = process.env): LocalNewsGrowthScoutStatus {
  const config = schedulerConfig(env);
  return defaultStatusReader?.() || { ...config, running: false, lastStartedAt: null, lastFinishedAt: null, lastError: null, snapshot: defaultSnapshot, artifactPath: artifactPath(env) };
}

export async function readLocalNewsGrowthScoutStatus(env: NodeJS.ProcessEnv = process.env): Promise<LocalNewsGrowthScoutStatus> {
  const current = getLocalNewsGrowthScoutStatus(env);
  if (!current.snapshot) {
    current.snapshot = await loadSnapshot(env);
    if (current.snapshot) defaultSnapshot = current.snapshot;
  }
  return current;
}

export function createLocalNewsGrowthScoutScheduler(deps: SchedulerDeps = {}): LocalNewsGrowthScoutScheduler {
  const env = deps.env || process.env;
  const config = schedulerConfig(env);
  const now = deps.now || (() => new Date());
  const log = deps.log || ((message) => console.log(message));
  const logError = deps.logError || ((message) => console.error(message));
  const setIntervalFn = deps.setInterval || globalThis.setInterval;
  const clearIntervalFn = deps.clearInterval || globalThis.clearInterval;
  const setTimeoutFn = deps.setTimeout || globalThis.setTimeout;
  const clearTimeoutFn = deps.clearTimeout || globalThis.clearTimeout;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let started = false;
  let lastStartedAt: string | null = null;
  let lastFinishedAt: string | null = null;
  let lastError: string | null = null;

  const status = (): LocalNewsGrowthScoutStatus => ({ enabled: config.enabled, running: inFlight !== null, intervalMinutes: config.intervalMinutes, lastStartedAt, lastFinishedAt, lastError, snapshot: defaultSnapshot, artifactPath: artifactPath(env) });

  async function runNow(): Promise<"completed" | "failed" | "skipped"> {
    if (!config.enabled || inFlight) return "skipped";
    lastStartedAt = now().toISOString();
    lastError = null;
    const work = (async () => {
      defaultSnapshot = await runLocalNewsGrowthScout({ ...deps, env });
    })();
    inFlight = work.finally(() => { inFlight = null; });
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<"timeout">((resolve) => {
      timeout = setTimeoutFn(() => resolve("timeout"), 30_000);
      timeout.unref?.();
    });
    try {
      const result = await Promise.race([inFlight.then(() => "completed" as const), deadline]);
      if (result === "completed") lastFinishedAt = now().toISOString();
      else { lastError = "timeout"; return "failed"; }
      return result;
    } catch (error) {
      lastError = safeError(error);
      lastFinishedAt = now().toISOString();
      logError(`[Local news growth scout] cycle failed: ${lastError}`);
      return "failed";
    } finally {
      if (timeout) clearTimeoutFn(timeout);
    }
  }

  function start(): LocalNewsGrowthScoutStatus {
    if (started || !config.enabled) return status();
    started = true;
    timer = setIntervalFn(() => { void runNow(); }, config.intervalMinutes * 60_000);
    timer.unref?.();
    log(`[Local news growth scout] started (${config.intervalMinutes} min; metadata-only community learning)`);
    void runNow();
    return status();
  }

  function stop(): LocalNewsGrowthScoutStatus {
    if (timer) clearIntervalFn(timer);
    timer = null;
    started = false;
    return status();
  }

  defaultStatusReader = status;
  return { start, stop, runNow, status };
}

let defaultScheduler: LocalNewsGrowthScoutScheduler | null = null;

export function startLocalNewsGrowthScoutScheduler(): LocalNewsGrowthScoutStatus {
  defaultScheduler ||= createLocalNewsGrowthScoutScheduler();
  return defaultScheduler.start();
}

export function getLocalNewsGrowthScoutSchedulerStatus(): LocalNewsGrowthScoutStatus {
  defaultScheduler ||= createLocalNewsGrowthScoutScheduler();
  return defaultScheduler.status();
}

export function getLocalNewsGrowthScoutPattern(lane: "miami-news" | "ny-news"): GrowthScoutPattern | null {
  const snapshot = defaultSnapshot;
  if (!snapshot) return null;
  return snapshot.recommendations.find((item) => item.lane === lane || item.lane === "cross-platform")?.pattern || null;
}

export async function runLocalNewsGrowthScoutNow(): Promise<LocalNewsGrowthScoutSnapshot> {
  defaultScheduler ||= createLocalNewsGrowthScoutScheduler();
  const result = await defaultScheduler.runNow();
  if (result !== "completed" || !defaultSnapshot) throw new Error(getLocalNewsGrowthScoutStatus().lastError || "growth_scout_failed");
  return defaultSnapshot;
}

export const __localNewsGrowthScoutInternals = { normalizedSources, parseRedditListing, parseXmlItems, patternFor, recommendations, scoutWorkspace, artifactPath };
