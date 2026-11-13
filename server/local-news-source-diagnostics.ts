import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { SourceDiagnostics, SourceError, SourceObservation } from "../shared/local-news-source-diagnostics";

const FILE = "source-diagnostics.json";
const MAX_BYTES = 4 * 1024 * 1024;
const DAY = 86_400_000;
const codes = ["http_error", "missing_api_key", "public_transit_key_not_found", "invalid_response",
  "fetch_failed", "AbortError", "TimeoutError", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET",
  "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"] as const;
type ErrorCode = typeof codes[number];
const errorSchema = z.object({ code: z.enum(codes), httpStatus: z.number().int().min(100).max(599).optional() }).strict();
const observationSchema = z.object({
  attemptId: z.string().uuid(),
  sourceId: z.string().regex(/^[a-z0-9-]{1,80}$/),
  lane: z.enum(["miami-news", "ny-news"]),
  checkedAt: z.string().datetime(),
  outcome: z.enum(["recent_news", "candidates_only", "empty", "no_recent_news", "undated", "error"]),
  receivedCount: z.number().int().nonnegative().nullable(),
  acceptedCount: z.number().int().nonnegative(),
  recentCandidateCount: z.number().int().nonnegative(),
  recentCount: z.number().int().nonnegative(),
  ingestionComplete: z.boolean(),
  undatedCount: z.number().int().nonnegative(),
  newestOriginalPublishedAt: z.string().datetime().nullable(),
  error: errorSchema.nullable(),
}).strict();
const stateSchema = z.object({
  version: z.literal(1),
  sources: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{1,80}$/),
    lastFetchSuccessAt: z.string().datetime().nullable(),
    lastNewsSuccessAt: z.string().datetime().nullable(),
    history: z.array(observationSchema).max(100),
  }).strict()).max(64),
}).strict();
type State = z.infer<typeof stateSchema>;
type Catalog = Array<{ id: string; name?: string; lane: "miami-news" | "ny-news"; configured: boolean }>;

function describeError(code: ErrorCode, httpStatus?: number): SourceError {
  if (code === "http_error") return {
    code, httpStatus,
    category: httpStatus === 408 || httpStatus === 429 || (httpStatus ?? 0) >= 500
      ? "potentially_transient" : "configuration_or_access",
    message: `HTTP ${httpStatus ?? "desconocido"}`,
  };
  if (code === "missing_api_key" || code === "public_transit_key_not_found")
    return { code, category: "configuration_or_access", message: code };
  if (code === "invalid_response")
    return { code, category: "invalid_response", message: "Respuesta con formato no reconocido." };
  if (code === "fetch_failed")
    return { code, category: "unknown", message: "Fallo no clasificado; detalle omitido por seguridad." };
  return { code, category: "potentially_transient", message: code };
}

/** Allowlist, not regex redaction of arbitrary upstream text. Never retain URLs,
 * headers, exception messages, response bodies, credentials or article content. */
export function sanitizeSourceError(error: unknown): SourceError {
  const e = error as { message?: unknown; name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const message = typeof e?.message === "string" ? e.message : "";
  const http = /^HTTP ([1-5]\d\d)\b/.exec(message);
  if (http) return describeError("http_error", Number(http[1]));
  if (message === "missing_api_key" || message === "public_transit_key_not_found")
    return describeError(message);
  if (e?.name === "SyntaxError" || message === "invalid_response") return describeError("invalid_response");
  for (const value of [e?.cause?.code, e?.code, e?.name]) {
    if (typeof value === "string" && codes.includes(value as ErrorCode)
      && !["http_error", "missing_api_key", "public_transit_key_not_found"].includes(value))
      return describeError(value as ErrorCode);
  }
  return describeError("fetch_failed");
}

export function sourceObservation(
  source: { id: string; lane: "miami-news" | "ny-news" }, checkedAt: string,
  receivedCount: number | null,
  items: Array<{ sourceEventId?: unknown; sourceUrl?: unknown; originalPublishedAt?: unknown; effective?: unknown }>,
  error?: unknown,
): SourceObservation {
  const at = Date.parse(checkedAt);
  let recentCount = 0, undatedCount = 0, newestOriginalPublishedAt: string | null = null;
  const seen = new Set<string>();
  for (const item of items) {
    const key = String(item.sourceEventId ?? item.sourceUrl ?? seen.size);
    if (seen.has(key)) continue;
    seen.add(key);
    // Effective dates and ingestion time are NOT original publication dates.
    const value = item.originalPublishedAt;
    const date = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(date)) { undatedCount++; continue; }
    if (!newestOriginalPublishedAt || date > Date.parse(newestOriginalPublishedAt))
      newestOriginalPublishedAt = new Date(date).toISOString();
    if (date <= at && at - date <= 72 * 3_600_000) recentCount++;
  }
  return {
    attemptId: randomUUID(), sourceId: source.id, lane: source.lane, checkedAt, receivedCount,
    acceptedCount: seen.size, recentCandidateCount: recentCount, recentCount: 0, ingestionComplete: false,
    undatedCount, newestOriginalPublishedAt,
    outcome: error !== undefined ? "error" : recentCount > 0 ? "candidates_only"
      : undatedCount > 0 ? "undated" : receivedCount === 0 ? "empty" : "no_recent_news",
    error: error !== undefined ? sanitizeSourceError(error) : null,
  };
}

/** Count novel/updated, deduplicated news accepted by the existing committee.
 * Extraction alone never advances lastNewsSuccessAt. */
export function finalizeSourceObservation(observation: SourceObservation, contributionCount: number): SourceObservation {
  if (!Number.isInteger(contributionCount) || contributionCount < 0 || contributionCount > observation.recentCandidateCount)
    throw new Error("source_diagnostics_invalid_contribution_count");
  return { ...observation, ingestionComplete: true, recentCount: contributionCount,
    outcome: !observation.error && contributionCount > 0 ? "recent_news" : observation.outcome };
}

async function load(dir: string): Promise<{ state: State; error: "missing" | "invalid" | null }> {
  try {
    const raw = await readFile(path.join(dir, FILE));
    if (raw.byteLength > MAX_BYTES) throw new Error("oversize");
    return { state: stateSchema.parse(JSON.parse(raw.toString("utf8"))), error: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { state: { version: 1, sources: [] }, error: "missing" };
    return { state: { version: 1, sources: [] }, error: "invalid" };
  }
}

const locks = new Map<string, Promise<void>>();
const writeFailures = new Map<string, true>();
/** Atomic rename + serialization within this process, not an Autoscale-wide lock. */
export async function recordSourceObservation(dir: string, observation: SourceObservation, replace = false): Promise<void> {
  const file = path.resolve(dir, FILE);
  const previous = locks.get(file) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const loaded = await load(dir);
    if (loaded.error === "invalid") throw new Error("source_diagnostics_invalid");
    const safe = observationSchema.parse({
      ...observation,
      error: observation.error ? { code: observation.error.code, ...(observation.error.httpStatus
        ? { httpStatus: observation.error.httpStatus } : {}) } : null,
    });
    const state = loaded.state;
    let source = state.sources.find(s => s.id === safe.sourceId);
    if (!source) {
      if (state.sources.length >= 64) throw new Error("source_diagnostics_catalog_limit");
      source = { id: safe.sourceId, history: [], lastFetchSuccessAt: null, lastNewsSuccessAt: null };
      state.sources.push(source);
    }
    const index = replace ? source.history.findIndex(o => o.attemptId === safe.attemptId) : -1;
    if (index >= 0) source.history[index] = safe;
    else source.history.push(safe);
    const newer = (old: string | null) => !old || Date.parse(safe.checkedAt) > Date.parse(old);
    if (!safe.error && newer(source.lastFetchSuccessAt)) source.lastFetchSuccessAt = safe.checkedAt;
    if (safe.recentCount > 0 && !safe.error && newer(source.lastNewsSuccessAt)) source.lastNewsSuccessAt = safe.checkedAt;
    const cutoff = Date.parse(safe.checkedAt) - 7 * DAY;
    for (const entry of state.sources)
      entry.history = entry.history.filter(o => Date.parse(o.checkedAt) >= cutoff)
        .sort((a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt)).slice(-100);
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(state), "utf8");
    await rename(tmp, file);
  });
  locks.set(file, next);
  try {
    await next;
    writeFailures.delete(file);
  } catch (error) {
    writeFailures.set(file, true);
    if (writeFailures.size > 64) writeFailures.delete(writeFailures.keys().next().value!);
    throw error;
  } finally { if (locks.get(file) === next) locks.delete(file); }
}

export async function readSourceDiagnostics(dir: string, catalog: Catalog, at = new Date().toISOString(), maxAgeMinutes = 30): Promise<SourceDiagnostics> {
  const { state, error } = await load(dir);
  const storageError = error ?? (writeFailures.has(path.resolve(dir, FILE)) ? "write_failed" : null);
  return {
    available: storageError === null, storageError, scope: "local_instance",
    recentWindowHours: 72, retentionDays: 7, maxHistoryPerSource: 100,
    observationMaxAgeMinutes: maxAgeMinutes,
    sources: catalog.map(c => {
      const stored = state.sources.find(s => s.id === c.id);
      const history: SourceObservation[] = (stored?.history ?? [])
        .filter(o => o.lane === c.lane && Date.parse(o.checkedAt) >= Date.parse(at) - 7 * DAY)
        .map(o => ({ ...o, error: o.error ? describeError(o.error.code, o.error.httpStatus) : null })).reverse();
      const latest = history[0] ?? null;
      const age = latest ? Date.parse(at) - Date.parse(latest.checkedAt) : 0;
      return {
        id: c.id, name: c.name ?? c.id, city: c.lane === "miami-news" ? "Miami" : "New York", configured: c.configured,
        status: !c.configured ? "disabled" : !latest ? "not_observed"
          : age > maxAgeMinutes * 60_000 || age < -5 * 60_000 ? "stale" : latest.outcome,
        lastAttemptAt: latest?.checkedAt ?? null,
        lastFetchSuccessAt: stored?.lastFetchSuccessAt ?? null,
        lastNewsSuccessAt: stored?.lastNewsSuccessAt ?? null,
        latest, history,
      };
    }),
  };
}
