import { z } from "zod";
import type { AgentLiveStatus } from "./agent-live-status";
import { isOnDutyWindow, onDutyMaxAge, onDutyStatus, ON_DUTY_COLOR } from "@shared/office-on-duty";
import { OFFICE_KONG_CITY_TASKS, OFFICE_KONG_SUPERVISED_CATEGORIES, isOfficeKongSupervisedCategory, officeKongDiscoveryCountsSchema, officeKongDiscoverySummary, officeKongEventLoadSchema, scoreOfficeKongSnapshot } from "@shared/office-kong-supervisor";

export const OFFICE_CITY_CATEGORIES = [
  { id: "clubs", name: "Clubs" }, { id: "vip", name: "Mesas VIP" },
  { id: "restaurants", name: "Restaurantes" }, { id: "events", name: "Eventos" },
  { id: "sports", name: "Deportes" }, { id: "experiences", name: "Experiencias" },
  { id: "media", name: "Fotos y media" }, { id: "discovery", name: "Descubrimiento" },
] as const;
const timestamp = z.string().datetime({ offset: true }).nullable();
const directoryCitySchema = z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), countryCode: z.string().regex(/^[A-Z]{2}$/), timeZone: z.string().min(1).max(100), currency: z.string().regex(/^[A-Z]{3}$/) });
const categorySchema = z.object({ category: z.enum(OFFICE_KONG_SUPERVISED_CATEGORIES), state: z.enum(["healthy", "running", "attention", "stale", "unknown", "disabled"]), evidence: z.enum(["persisted", "missing"]), lastRunAt: timestamp, lastSuccessAt: timestamp, lastStartedAt: timestamp, nextRunAt: timestamp, leaseUntil: timestamp.optional(), issues: z.array(z.string().max(20000)).max(500), intervalMs: z.number().int().positive().nullable().optional(), recordedFailure: z.boolean().optional(), discovery: officeKongDiscoveryCountsSchema.optional().catch(undefined) });
// Unknown (future) categories in a stored audit are dropped one by one; the known ones stay strict.
const categoriesSchema = z.array(z.unknown()).max(64)
  .transform(items => items.filter(item => Boolean(item) && typeof item === "object" && isOfficeKongSupervisedCategory((item as { category?: unknown }).category)))
  .pipe(z.array(categorySchema).max(OFFICE_KONG_SUPERVISED_CATEGORIES.length));
const cityEvidenceSchema = directoryCitySchema.extend({ categories: categoriesSchema, eventLoad: officeKongEventLoadSchema.optional().catch(undefined) });
const evidenceSchema = z.object({ generatedAt: z.string().datetime({ offset: true }), citySnapshotCheckedAt: z.string().datetime({ offset: true }).optional(), cityAgentsEnabled: z.boolean(), cities: z.array(cityEvidenceSchema).max(200) });
export type OfficeCityDirectoryEntry = z.infer<typeof directoryCitySchema>;
export interface OfficeCityAgent {
  id: string; name: string; role: string; cityId: string; cityName: string; category: keyof typeof OFFICE_KONG_CITY_TASKS;
  status: AgentLiveStatus; color: string; lastWorkAt: string | null; lastStartedAt: string | null;
  nextWorkAt: string | null; blocker: string; snapshotAt: string | null;
  hasDurableEvidence: boolean;
  intervalMs?: number | null;
  recordedFailure?: boolean;
  leaseUntil?: string | null;
  /** Discovery agent only: per-run counts (found/added/review/rejected) from the latest audit. */
  discoverySummary?: string | null;
}
export interface OfficeCityRoom { id: string; name: string; city: OfficeCityDirectoryEntry; agents: OfficeCityAgent[]; upcomingEvents: number | null }
export interface OfficeCityCountry { code: string; name: string; cityCount: number }
export function officeCityCountries(directory: OfficeCityDirectoryEntry[]): OfficeCityCountry[] {
  const counts = new Map<string, number>();
  for (const city of directory) counts.set(city.countryCode, (counts.get(city.countryCode) || 0) + 1);
  let names: Intl.DisplayNames | undefined;
  try { names = new Intl.DisplayNames(["es"], { type: "region", fallback: "code" }); } catch { /* browser may not support DisplayNames */ }
  return [...counts].map(([code, cityCount]) => ({ code, name: names?.of(code) || code, cityCount })).sort((a, b) => a.name.localeCompare(b.name, "es"));
}
export function parseOfficeCityDirectory(value: unknown): OfficeCityDirectoryEntry[] {
  const parsed = z.array(directoryCitySchema).max(200).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map(city => city.id)).size !== parsed.data.length) return [];
  return parsed.data;
}
const MAX_AGE_MS = 5 * 60_000;
const fresh = (value: string, now: number) => { const age = now - Date.parse(value); return Number.isFinite(age) && age >= -30000 && age <= MAX_AGE_MS; };
type OfficeAuditIdentity = { id: string; kind: string; status: string; createdAt: string };
export function selectLatestOfficeKongAudit<T extends OfficeAuditIdentity>(runs: readonly T[] | undefined): T | undefined {
  let latest: T | undefined;
  let latestTime = -Infinity;
  for (const run of runs || []) {
    if (run.kind !== "kong_audit" || !["completed", "blocked", "failed", "unknown"].includes(run.status)) continue;
    const time = Date.parse(run.createdAt);
    if (!Number.isFinite(time) || !run.id) continue;
    if (time > latestTime || (time === latestTime && latest && run.id > latest.id)) { latest = run; latestTime = time; }
  }
  return latest;
}

function readCityEvidence(runs: unknown) {
  const candidates = Array.isArray(runs) ? runs.filter((run): run is OfficeAuditIdentity & Record<string, unknown> => Boolean(run) && typeof run === "object" && typeof run.id === "string" && typeof run.kind === "string" && typeof run.status === "string" && typeof run.createdAt === "string") : [];
  const latest = selectLatestOfficeKongAudit(candidates);
  const parsed = latest?.status === "completed" ? evidenceSchema.safeParse(latest.evidence) : undefined;
  return parsed?.success ? parsed.data : undefined;
}

export function officeCityEvidenceExpiresAt(runs: unknown, now = Date.now()): number | undefined {
  return officeCitySnapshotExpiresAt(readCityEvidence(runs), now);
}

export function officeCitySnapshotExpiresAt(snapshot: unknown, now = Date.now()): number | undefined {
  const parsed = evidenceSchema.safeParse(snapshot);
  const evidence = parsed.success ? parsed.data : undefined;
  if (!evidence) return undefined;
  const snapshotExpiry = Math.min(Date.parse(evidence.generatedAt), Date.parse(evidence.citySnapshotCheckedAt || evidence.generatedAt)) + MAX_AGE_MS;
  let nextExpiry = snapshotExpiry;
  if (evidence.cityAgentsEnabled) for (const city of evidence.cities) for (const job of city.categories) {
    if (job.state !== "running" || job.evidence !== "persisted" || !job.leaseUntil || !job.lastStartedAt) continue;
    const leaseExpiry = Date.parse(job.leaseUntil);
    if (leaseExpiry > now && leaseExpiry > Date.parse(job.lastStartedAt)) nextExpiry = Math.min(nextExpiry, leaseExpiry);
  }
  return nextExpiry;
}

export function buildOfficeCityRooms(directory: OfficeCityDirectoryEntry[], runs: unknown, now = Date.now()): OfficeCityRoom[] {
  return buildOfficeCityRoomsFromSnapshot(directory, readCityEvidence(runs), now);
}

const onDuty = (job: { lastRunAt: string | null; nextRunAt: string | null; intervalMs?: number | null; recordedFailure?: boolean }, now = Date.now()) =>
  job.recordedFailure !== true && isOnDutyWindow({ lastWorkAt: job.lastRunAt, nextWorkAt: job.nextRunAt, maxAgeMs: onDutyMaxAge(job.intervalMs), now });

export function buildOfficeCityRoomsFromSnapshot(directory: OfficeCityDirectoryEntry[], snapshot: unknown, now = Date.now()): OfficeCityRoom[] {
  const parsed = evidenceSchema.safeParse(snapshot);
  const evidence = parsed.success ? parsed.data : undefined;
  const usable = Boolean(evidence && fresh(evidence.generatedAt, now) && (!evidence.citySnapshotCheckedAt || fresh(evidence.citySnapshotCheckedAt, now)));
  const snapshotAt = evidence?.citySnapshotCheckedAt || evidence?.generatedAt || null;
  const scores = new Map(scoreOfficeKongSnapshot(evidence, now).cities.map(city => [city.id, city.categories]));
  return directory.map(city => {
    const matches = evidence?.cities.filter(candidate => candidate.id === city.id) || [];
    const record = matches.length === 1 && matches[0].name === city.name && matches[0].countryCode === city.countryCode && matches[0].timeZone === city.timeZone && matches[0].currency === city.currency ? matches[0] : undefined;
    const agents = OFFICE_CITY_CATEGORIES.map(category => {
      const matches = record?.categories.filter(candidate => candidate.category === category.id) || [];
      const job = matches.length === 1 ? matches[0] : undefined;
      let status: AgentLiveStatus = { state: "offline", label: "Sin evidencia", detail: "Falta una auditoria autenticada reciente de este trabajo." };
      if (evidence && !usable) status = { state: "offline", label: "Evidencia caducada", detail: "La ultima auditoria tiene mas de cinco minutos o una fecha no verificable." };
      else if (usable && !evidence!.cityAgentsEnabled) status = { state: "needs-setup", label: "Coordinador apagado", detail: "Los trabajos de ciudad estan deshabilitados en KONG." };
      else if (usable && job?.evidence === "persisted") {
        const future = [job.lastRunAt, job.lastSuccessAt, job.lastStartedAt].some(value => value && Date.parse(value) > now + 30000);
        if (future) status = { state: "offline", label: "Fechas sin verificar", detail: "El trabajo contiene fechas futuras no verificables." };
        else if (job.state === "running" && job.lastStartedAt && job.leaseUntil && Date.parse(job.leaseUntil) > Math.max(now, Date.parse(job.lastStartedAt))) status = { state: "working", label: "Ejecutando · verificado", detail: OFFICE_KONG_CITY_TASKS[category.id] };
        else if (job.state === "running") status = { state: "offline", label: "Ejecucion sin vigencia", detail: "La auditoria registro actividad, pero no hay una reserva de ejecucion vigente." };
        else if (job.state === "healthy" && job.lastRunAt && job.lastSuccessAt) {
          const score = scores.get(city.id)?.find(item => item.category === category.id);
          // Completed (or scheduled) on time with no failure: on duty, never "working".
          status = (score?.state === "completed" || score?.state === "scheduled") && onDuty(job, now)
            ? onDutyStatus({ lastWorkAt: job.lastRunAt, nextWorkAt: job.nextRunAt, now })
            : { state: "offline", label: "Completado · no ejecutando", detail: "Hay un resultado confirmado; no equivale a estar trabajando ahora." };
        }
        else if (job.state === "attention") {
          const score = scores.get(city.id)?.find(item => item.category === category.id);
          const coverage = job.issues.join(" · ") || score?.reason;
          status = score?.state === "completed_with_warnings"
            // Ran on schedule without a recorded error: coverage findings are informational (KONG #306).
            ? (job.lastRunAt && onDuty(job, now)
              ? onDutyStatus({ lastWorkAt: job.lastRunAt, nextWorkAt: job.nextRunAt, now, extra: `Cobertura con pendientes: ${coverage}` })
              : { state: "available", label: "Activo · cobertura con pendientes", detail: coverage })
            : { state: "error", label: score?.state === "failed" ? "Falló la última ejecución" : "Requiere atención", detail: job.issues.join(" · ") || score?.reason || "KONG registra un bloqueo en este trabajo." };
        }
        else if (job.state === "disabled") status = { state: "needs-setup", label: "Deshabilitado", detail: "Este trabajo esta deshabilitado." };
        else if (job.state === "stale") status = { state: "offline", label: "Trabajo desactualizado", detail: "El ultimo resultado ya no tiene vigencia." };
        else status = { state: "offline", label: "Estado sin verificar", detail: job.issues.join(" · ") || "No hay una ejecucion actual verificable." };
      }
      const confirmed = usable && job?.evidence === "persisted";
      return { id: `kong-city:${city.id}:${category.id}`, name: `${city.name} · ${category.name}`, role: category.name, cityId: city.id, cityName: city.name, category: category.id,
        status, color: status.state === "working" ? "#34d399" : status.onDuty ? ON_DUTY_COLOR : status.state === "error" ? "#fb7185" : status.state === "needs-setup" ? "#fbbf24" : "#94a3b8",
        lastWorkAt: confirmed ? job!.lastRunAt : null, lastStartedAt: confirmed ? job!.lastStartedAt : null,
        nextWorkAt: confirmed ? job!.nextRunAt : null, blocker: status.detail || "", snapshotAt, hasDurableEvidence: Boolean(confirmed),
        intervalMs: confirmed ? job!.intervalMs : undefined, recordedFailure: confirmed ? job!.recordedFailure : undefined, leaseUntil: confirmed ? job!.leaseUntil : undefined,
        ...(category.id === "discovery" && confirmed ? { discoverySummary: officeKongDiscoverySummary(job!.discovery) } : {}) };
    });
    const load = record?.eventLoad;
    const loadAge = load?.checkedAt ? now - Date.parse(load.checkedAt) : Infinity;
    const upcomingEvents = usable && load && loadAge >= -30_000 && loadAge <= 10 * 60_000 ? load.upcomingEvents : null;
    return { id: `kong-city:${city.id}`, name: city.name, city, agents, upcomingEvents };
  }).sort((a, b) => (b.upcomingEvents ?? -1) - (a.upcomingEvents ?? -1));
}
