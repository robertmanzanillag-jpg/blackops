import { z } from "zod";
import { whatsappReaderEvidenceSchema, whatsappOfficeView, withWhatsAppOfficeAgent, type WhatsAppReaderEvidence } from "../shared/whatsapp-office-agent";
import { OFFICE_KONG_SUPERVISED_CATEGORIES, isOfficeKongSupervisedCategory, officeKongDiscoveryCountsSchema, officeKongEventLoadSchema, type OfficeKongDiscoveryCounts } from "../shared/office-kong-supervisor";

// This is the existing authenticated KONG read contract, not a dispatch route.
const OPERATIONS_URL = "https://kongnightlife.com/api/admin/ceo/operations";
const CITY_AGENTS_URL = "https://kongnightlife.com/api/admin/city-agents";
const CITY_DIRECTORY_URL = "https://kongnightlife.com/api/cities";
const MAX_BODY_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_SNAPSHOT_AGE_MS = 5 * 60_000;
const MAX_FUTURE_SKEW_MS = 30_000;
const timestamp = z.string().datetime({ offset: true });
const text = z.string().max(20_000);
const nullableTimestamp = timestamp.nullable();
const agentSchema = z.object({
  id: z.string().min(1).max(200),
  name: text,
  kind: z.enum(["coordinator", "department", "city", "system"]),
  owner: text,
  responsibility: text,
  // "idle" = on-demand service with no recent request (KONG #306). Any future
  // state degrades to "unknown" for that agent instead of failing the snapshot.
  state: z.enum(["healthy", "running", "attention", "stale", "unknown", "disabled", "idle"]).catch("unknown"),
  operationMode: z.enum(["on_demand", "scheduled", "event_driven"]).optional(),
  evidencePending: z.boolean().optional(),
  // Aggregate receipt history is not proof of a live reader or completed group read.
  verifiedActivity: z.object({
    windowDays: z.number().int().positive(),
    receivedCount: z.number().int().nonnegative(),
    appliedCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    lastReceivedAt: nullableTimestamp,
    lastAppliedAt: nullableTimestamp,
  }).strict().optional(),
  lastRunAt: nullableTimestamp,
  nextRunAt: nullableTimestamp,
  blocker: text.nullable(),
  nextAction: text,
  issues: z.array(text).max(500),
  // City agents only: data coverage is informational and never decides execution state.
  coverage: z.object({
    percent: z.number().min(0).max(100).nullable(),
    categoriesComplete: z.number().int().nonnegative(),
    categoriesTotal: z.number().int().nonnegative(),
    pendingItems: z.number().int().nonnegative(),
    configurationNotices: z.array(text).max(100),
  }).strict().optional().catch(undefined),
  // City agents only (KONG "Descubrimiento / Novedades"): counts are informational, never the agent state.
  discovery: z.object({
    mode: z.enum(["disabled", "deterministic", "deterministic_with_ai", "not_run"]),
    lastRunAt: nullableTimestamp,
    found: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    queuedForReview: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    alreadyInKong: z.number().int().nonnegative(),
    reviewPending: z.number().int().nonnegative(),
    aiSpentUsd: z.number().nonnegative(),
    aiCapUsd: z.number().nonnegative(),
  }).strict().optional().catch(undefined),
}).strict();
const briefSchema = z.object({
  id: text,
  completedAt: timestamp,
  summary: text,
  priorities: z.array(text).max(100),
}).strict();
const count = z.number().int().nonnegative().nullable();
const operationsSchema = z.object({
  whatsappReader: whatsappReaderEvidenceSchema.optional().catch(undefined),
  generatedAt: timestamp,
  agents: z.array(agentSchema).min(1).max(500),
  objectives: z.array(z.object({
    id: text,
    objective: text,
    kpi: text,
    baseline: text.nullable(),
    target: text,
    unit: text.nullable(),
    owner: text,
    dueAt: nullableTimestamp,
  }).strict()).max(500),
  briefs: z.object({ daily: briefSchema.nullable(), weekly: briefSchema.nullable() }).strict(),
  metrics: z.object({
    completedLast7Days: count,
    completedPrevious7Days: count,
    open: count,
    blocked: count,
  }).strict(),
  issues: z.array(text).max(500),
  bugs: z.array(z.object({
    errorId: text,
    severity: z.enum(["low", "medium", "high", "unknown"]),
    occurrences: z.number().int().nonnegative(),
    affectedUsers: z.number().int().nonnegative(),
    status: z.enum(["pending", "notified"]),
    owner: z.literal("product_reliability"),
    summary: text,
    lastSeenAt: nullableTimestamp,
  }).strict()).max(100).optional(),
// Read-only responses can gain metadata independently of this client. Keep the
// known evidence contract validated and discard all unrecognized root fields.
}).strip();

export const OFFICE_KONG_CITY_CATEGORIES = OFFICE_KONG_SUPERVISED_CATEGORIES;
const categorySchema = z.enum(OFFICE_KONG_CITY_CATEGORIES);
const jobSchema = z.object({
  city_id: z.string().min(1).max(200),
  category: categorySchema,
  interval_ms: z.union([z.number(), z.string().regex(/^[0-9]+$/)]).transform(Number).refine(value => Number.isSafeInteger(value) && value > 0),
  next_run_at: timestamp,
  lease_until: nullableTimestamp,
  last_started_at: nullableTimestamp,
  last_completed_at: nullableTimestamp,
  last_success_at: nullableTimestamp,
  attempts: z.number().int().nonnegative(),
  last_error: text.nullable(),
  report: z.object({ status: z.enum(["healthy", "needs_attention"]).optional(), issues: z.array(text).max(500).optional(),
    discovery: officeKongDiscoveryCountsSchema.optional().catch(undefined) }),
});
// A category KONG adds before the office knows it is dropped on its own; it must
// never invalidate the other categories or the whole city read. Known categories
// stay strictly validated.
const jobsSchema = z.array(z.unknown()).max(64)
  .transform(jobs => jobs.filter(job => Boolean(job) && typeof job === "object" && isOfficeKongSupervisedCategory((job as { category?: unknown }).category)))
  .pipe(z.array(jobSchema).max(OFFICE_KONG_CITY_CATEGORIES.length));
const citySchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  timeZone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
  currency: z.string().regex(/^[A-Z]{3}$/),
  // Newer KONG reports the execution verdict as "active"; it is recomputed from jobs below.
  status: z.enum(["healthy", "active", "needs_attention"]).catch("needs_attention"),
  jobs: jobsSchema,
  eventLoad: officeKongEventLoadSchema.optional().catch(undefined),
});
const citiesSchema = z.object({
  enabled: z.boolean(),
  coordinator: z.literal("global"),
  maxConcurrent: z.number().int().positive().max(100),
  referenceCity: z.string().min(1).max(200),
  cities: z.array(citySchema).min(1).max(200),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(200),
  needsAttention: z.array(z.string().min(1).max(200)).max(200),
});
const directorySchema = z.array(citySchema.omit({ status: true, jobs: true, eventLoad: true })).min(1).max(200);
export type OfficeKongCityDirectoryEntry = z.infer<typeof directorySchema>[number];

export type OfficeKongAgent = z.infer<typeof agentSchema>;
export interface OfficeKongCityCategory {
  category: typeof OFFICE_KONG_CITY_CATEGORIES[number];
  state: Exclude<OfficeKongAgent["state"], "idle">;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStartedAt: string | null;
  nextRunAt: string | null;
  intervalMs: number | null;
  issues: string[];
  evidence: "persisted" | "missing";
  recordedFailure?: boolean;
  attemptsSinceSuccess?: number;
  leaseUntil?: string | null;
  discovery?: OfficeKongDiscoveryCounts;
}
export interface OfficeKongCity {
  eventLoad?: z.infer<typeof officeKongEventLoadSchema>;
  id: string;
  name: string;
  countryCode: string;
  timeZone: string;
  currency: string;
  status: "healthy" | "needs_attention";
  categories: OfficeKongCityCategory[];
}
export interface OfficeKongProbe {
  status: "ready" | "blocked";
  reason: string;
  checkedAt: string;
  agents?: OfficeKongAgent[];
}
export interface OfficeKongAuditResult {
  text: string;
  completedAt: string;
  evidence: {
    whatsappReader?: WhatsAppReaderEvidence;
    generatedAt: string;
    agents: OfficeKongAgent[];
    cities: OfficeKongCity[];
    citySnapshotCheckedAt: string;
    cityAgentsEnabled: boolean;
    cityCoverageComplete: boolean;
  };
}
export class OfficeKongError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "OfficeKongError";
  }
}

function safeError(code: string, message: string): never {
  throw new OfficeKongError(code, message);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json" && !/^application\/[a-z0-9.+-]+\+json$/.test(contentType ?? "")) {
    return safeError("INVALID_RESPONSE", "KONG no devolvio una respuesta JSON verificable.");
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return safeError("RESPONSE_TOO_LARGE", "La respuesta de KONG supera el limite permitido.");
  }
  if (!response.body) return safeError("INVALID_RESPONSE", "KONG devolvio una respuesta vacia.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return safeError("RESPONSE_TOO_LARGE", "La respuesta de KONG supera el limite permitido.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    return safeError("INVALID_RESPONSE", "KONG devolvio JSON invalido.");
  }
}

function redactStrings<T>(value: T, token: string): T {
  if (typeof value === "string") return value.split(token).join("[redacted]").replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]") as T;
  if (Array.isArray(value)) return value.map(item => redactStrings(item, token)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStrings(item, token)])) as T;
  }
  return value;
}

function cityEvidence(snapshot: z.infer<typeof citiesSchema>, at: Date): OfficeKongCity[] {
  const ids = new Set(snapshot.cities.map(city => city.id));
  if (ids.size !== snapshot.cities.length || !ids.has(snapshot.referenceCity)
    || snapshot.needsAttention.some(id => !ids.has(id))) {
    return safeError("INVALID_RESPONSE", "El registro de ciudades de KONG contiene identidades inconsistentes.");
  }
  return snapshot.cities.map(city => {
    if (new Set(city.jobs.map(job => job.category)).size !== city.jobs.length || city.jobs.some(job => job.city_id !== city.id)) {
      return safeError("INVALID_RESPONSE", "Los trabajos de KONG no coinciden con su ciudad y categoria.");
    }
    const categories = OFFICE_KONG_CITY_CATEGORIES.map((category): OfficeKongCityCategory => {
      const job = city.jobs.find(value => value.category === category);
      if (!job) return { category, state: "unknown", lastRunAt: null, lastSuccessAt: null, lastStartedAt: null, nextRunAt: null, intervalMs: null,
        issues: ["No existe evidencia durable de un trabajo para esta categoria."], evidence: "missing" };
      const issues = [...(job.report.issues ?? [])];
      // Raw provider/SQL error strings can contain credentials; retain only its presence.
      if (job.last_error) issues.push("El ultimo intento registro un error; revisar la evidencia en KONG.");
      const lastSuccess = job.last_success_at ? Date.parse(job.last_success_at) : null;
      const futureEvidence = [job.last_success_at, job.last_completed_at, job.last_started_at]
        .some(value => value && Date.parse(value) > at.getTime() + MAX_FUTURE_SKEW_MS);
      const liveLease = job.lease_until && Date.parse(job.lease_until) > at.getTime();
      let state: OfficeKongCityCategory["state"];
      if (!snapshot.enabled) state = "disabled";
      else if (futureEvidence) { state = "unknown"; issues.push("Las fechas de ejecucion estan en el futuro y no se pueden verificar."); }
      else if (liveLease && job.last_started_at) state = "running";
      else if (job.last_error || job.report.status === "needs_attention" || issues.length) state = "attention";
      else if (lastSuccess === null || !job.last_completed_at || job.report.status !== "healthy") state = "unknown";
      else state = at.getTime() - lastSuccess > job.interval_ms * 2 ? "stale" : "healthy";
      return { category, state, lastRunAt: job.last_completed_at, lastSuccessAt: job.last_success_at, lastStartedAt: job.last_started_at,
        nextRunAt: job.next_run_at, intervalMs: job.interval_ms, issues, evidence: "persisted", recordedFailure: Boolean(job.last_error),
        attemptsSinceSuccess: job.attempts,
        leaseUntil: state === "running" ? job.lease_until : null,
        ...(category === "discovery" && job.report.discovery ? { discovery: job.report.discovery } : {}) };
    });
    return { id: city.id, name: city.name, countryCode: city.countryCode, timeZone: city.timeZone, currency: city.currency,
      ...(city.eventLoad ? { eventLoad: city.eventLoad } : {}),
      status: city.status !== "needs_attention" && categories.every(category => category.state === "healthy") ? "healthy" : "needs_attention", categories };
  });
}

export function createOfficeKongConnector(dependencies: {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  token?: () => string | undefined;
} = {}) {
  const now = dependencies.now ?? (() => new Date());
  const tokenSource = dependencies.token ?? (() => process.env.KONG_OFFICE_READ_TOKEN || process.env.KONG_OFFICE_ADMIN_TOKEN);

  async function readEndpoint<Schema extends z.ZodTypeAny>(url: typeof OPERATIONS_URL | typeof CITY_AGENTS_URL | typeof CITY_DIRECTORY_URL, schema: Schema, authenticated = true): Promise<z.infer<Schema>> {
    const token = authenticated ? tokenSource()?.trim() : undefined;
    if (authenticated && !token) return safeError("NOT_CONFIGURED", "Falta configurar el acceso privado de lectura de KONG en el servidor.");
    if (token && /[\x00-\x20\x7f]/.test(token)) return safeError("INVALID_CONFIGURATION", "La conexion de KONG tiene una configuracion invalida.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await (dependencies.fetchImpl ?? fetch)(url, {
        method: "GET",
        redirect: "error",
        headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.status === 401) return safeError("UNAUTHENTICATED", "La sesion administradora de KONG no esta autorizada o ha caducado.");
      if (response.status === 403) return safeError("FORBIDDEN", "La cuenta de KONG no tiene permiso para consultar las operaciones del CEO.");
      if (response.status >= 300 && response.status < 400) return safeError("REDIRECT_REJECTED", "KONG intento redirigir la consulta; la conexion no esta verificada.");
      if (!response.ok) return safeError("UNAVAILABLE", "KONG no pudo entregar la evidencia de sus agentes.");
      const parsed = schema.safeParse(await readBoundedJson(response));
      if (!parsed.success) return safeError("INVALID_RESPONSE", "La evidencia de KONG no coincide con el contrato de operaciones.");
      return token ? redactStrings(parsed.data, token) : parsed.data;
    } catch (error) {
      if (error instanceof OfficeKongError) throw error;
      // Never retain fetch errors, bodies or headers: they may contain credentials.
      return safeError(controller.signal.aborted ? "TIMEOUT" : "CONNECTION_FAILED", controller.signal.aborted
        ? "KONG no respondio dentro del tiempo permitido."
        : "No se pudo verificar la conexion con KONG.");
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadOfficeKongDirectory(): Promise<OfficeKongCityDirectoryEntry[]> {
    // Public registry only. It defines visible roles, never execution evidence.
    const cities = await readEndpoint(CITY_DIRECTORY_URL, directorySchema, false);
    if (new Set(cities.map(city => city.id)).size !== cities.length) return safeError("INVALID_RESPONSE", "El directorio de ciudades contiene identificadores repetidos.");
    return cities;
  }

  async function readOperations() {
    const snapshot = await readEndpoint(OPERATIONS_URL, operationsSchema);
    const age = now().getTime() - Date.parse(snapshot.generatedAt);
    if (age > MAX_SNAPSHOT_AGE_MS || age < -MAX_FUTURE_SKEW_MS) {
      return safeError("STALE_SNAPSHOT", "La evidencia de KONG esta caducada o tiene una fecha futura no verificable.");
    }
    const whatsappReader = whatsappOfficeView(snapshot.whatsappReader, now().getTime()).evidence ?? undefined;
    return { ...snapshot, whatsappReader, agents: withWhatsAppOfficeAgent(snapshot.agents, whatsappReader, now().getTime()) };
  }

  async function probeOfficeKong(): Promise<OfficeKongProbe> {
    try {
      const snapshot = await readOperations();
      return {
        status: "ready",
        reason: "Consulta autenticada verificada. El estado de cada agente depende de su evidencia; conexion disponible no significa que todos esten trabajando.",
        checkedAt: now().toISOString(),
        agents: snapshot.agents,
      };
    } catch (error) {
      return {
        status: "blocked",
        reason: error instanceof OfficeKongError ? error.message : "No se pudo verificar la conexion con KONG.",
        checkedAt: now().toISOString(),
      };
    }
  }

  async function runOfficeKongReadOnly(): Promise<OfficeKongAuditResult> {
    const snapshot = await readOperations();
    const citySnapshot = await readEndpoint(CITY_AGENTS_URL, citiesSchema);
    const checkedAt = now();
    const cities = cityEvidence(citySnapshot, checkedAt);
    const operationsCityIds = snapshot.agents.filter(agent => agent.kind === "city").map(agent => agent.id.startsWith("city:") ? agent.id.slice(5) : agent.id);
    const registeredIds = new Set(cities.map(city => city.id));
    if (new Set(operationsCityIds).size !== operationsCityIds.length || operationsCityIds.length !== cities.length || operationsCityIds.some(id => !registeredIds.has(id))) {
      return safeError("CITY_REGISTRY_MISMATCH", "Las dos consultas de KONG no cubren el mismo registro de ciudades; la auditoria completa queda pendiente.");
    }
    const cityCoverageComplete = cities.every(city => city.categories.every(category => category.evidence === "persisted"));
    const categoryCount = cities.reduce((sum, city) => sum + city.categories.filter(category => category.evidence === "persisted").length, 0);
    const counts = new Map<OfficeKongAgent["state"], number>();
    for (const agent of snapshot.agents) counts.set(agent.state, (counts.get(agent.state) ?? 0) + 1);
    return {
      text: `Auditoria de operaciones KONG completada con evidencia del ${snapshot.generatedAt}. ${snapshot.agents.length} agentes: ${counts.get("healthy") ?? 0} con evidencia vigente, ${counts.get("running") ?? 0} en ejecucion, ${counts.get("attention") ?? 0} requieren atencion, ${counts.get("stale") ?? 0} con evidencia antigua, ${counts.get("unknown") ?? 0} sin evidencia verificable y ${counts.get("disabled") ?? 0} deshabilitados.${counts.get("idle") ? ` ${counts.get("idle")} bajo demanda sin solicitudes recientes (no es un fallo).` : ""} Registro consultado: ${cities.length} ciudades, ${categoryCount}/${cities.length * OFFICE_KONG_CITY_CATEGORIES.length} trabajos con evidencia durable.${cityCoverageComplete ? "" : " Faltan trabajos: las categorias sin registro aparecen como desconocidas."} Esta consulta no inicia agentes, no lee WhatsApp y no modifica eventos ni precios.`,
      completedAt: now().toISOString(),
      evidence: { generatedAt: snapshot.generatedAt, agents: snapshot.agents, cities, citySnapshotCheckedAt: checkedAt.toISOString(), cityAgentsEnabled: citySnapshot.enabled, cityCoverageComplete, ...(snapshot.whatsappReader ? { whatsappReader: snapshot.whatsappReader } : {}) },
    };
  }

  return { probeOfficeKong, runOfficeKongReadOnly, loadOfficeKongDirectory };
}

export const { probeOfficeKong, runOfficeKongReadOnly, loadOfficeKongDirectory } = createOfficeKongConnector();
