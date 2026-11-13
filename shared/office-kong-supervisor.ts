import { z } from "zod";

export const officeKongEventLoadSchema = z.object({
  upcomingEvents: z.number().int().nonnegative().nullable(),
  windowDays: z.literal(30),
  checkedAt: z.string().datetime({ offset: true }).nullable(),
}).refine(value => (value.upcomingEvents === null) === (value.checkedAt === null));

// "discovery" = KONG's per-city "Descubrimiento / Novedades" agent. Categories KONG adds
// later and the office does not know yet are dropped per category, never the whole city read.
export const OFFICE_KONG_SUPERVISED_CATEGORIES = ["clubs", "vip", "restaurants", "events", "sports", "experiences", "media", "discovery"] as const;
export type OfficeKongSupervisedCategory = typeof OFFICE_KONG_SUPERVISED_CATEGORIES[number];
export function isOfficeKongSupervisedCategory(value: unknown): value is OfficeKongSupervisedCategory {
  return typeof value === "string" && (OFFICE_KONG_SUPERVISED_CATEGORIES as readonly string[]).includes(value);
}
/** Per-run counts from the discovery agent (counts only; never titles, URLs or raw errors). */
export const officeKongDiscoveryCountsSchema = z.object({
  mode: z.enum(["disabled", "deterministic", "deterministic_with_ai"]).optional().catch(undefined),
  found: z.number().int().nonnegative().max(1_000_000).optional(),
  added: z.number().int().nonnegative().max(1_000_000).optional(),
  queuedForReview: z.number().int().nonnegative().max(1_000_000).optional(),
  rejected: z.number().int().nonnegative().max(1_000_000).optional(),
  alreadyInKong: z.number().int().nonnegative().max(1_000_000).optional(),
  pagesChecked: z.number().int().nonnegative().max(1_000_000).optional(),
  reviewPendingTotal: z.number().int().nonnegative().max(1_000_000).optional(),
}).strip();
export type OfficeKongDiscoveryCounts = z.infer<typeof officeKongDiscoveryCountsSchema>;
export function officeKongDiscoverySummary(counts: OfficeKongDiscoveryCounts | undefined): string | null {
  if (!counts) return null;
  if (counts.mode === "disabled") return "Descubrimiento desactivado en KONG.";
  if (counts.found === undefined) return null;
  return `Novedades del último turno: ${counts.found} encontradas · ${counts.added ?? 0} añadidas · ${counts.queuedForReview ?? 0} a revisión · ${counts.rejected ?? 0} rechazadas${counts.reviewPendingTotal !== undefined ? ` · ${counts.reviewPendingTotal} pendientes de revisar` : ""}.`;
}
export const OFFICE_KONG_CITY_TASKS: Record<typeof OFFICE_KONG_SUPERVISED_CATEGORIES[number], string> = {
  clubs: "Comprueba fuentes y fichas de clubes",
  vip: "Verifica canales oficiales para reservas VIP",
  restaurants: "Comprueba fuentes y fichas de restaurantes",
  events: "Consulta calendarios oficiales y actualiza eventos verificables",
  sports: "Consulta calendarios de equipos y partidos locales",
  experiences: "Busca y comprueba fichas de experiencias locales",
  media: "Audita imágenes y flyers contra la fuente del evento",
  discovery: "Busca novedades: eventos próximos, experiencias y aperturas; lo dudoso va a revisión",
};
export const OFFICE_KONG_SCORE_DEDUCTIONS = { failed: 25, stale: 20, missed: 15, completed_with_warnings: 5 } as const;
const MAX_SNAPSHOT_AGE_MS = 5 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const MISSED_GRACE_MS = 15 * 60_000;

type Category = typeof OFFICE_KONG_SUPERVISED_CATEGORIES[number];
export type OfficeKongSupervisorState = "completed" | "completed_with_warnings" | "scheduled" | "running" | "missed" | "stale" | "failed" | "unverified" | "disabled";
interface CategoryEvidence {
  category: Category;
  state: "healthy" | "running" | "attention" | "stale" | "unknown" | "disabled";
  evidence: "persisted" | "missing";
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStartedAt: string | null;
  nextRunAt: string | null;
  intervalMs?: number | null;
  recordedFailure?: boolean;
  leaseUntil?: string | null;
}
export interface OfficeKongSupervisorSnapshot {
  generatedAt: string;
  citySnapshotCheckedAt?: string;
  cityAgentsEnabled: boolean;
  cities: readonly { id: string; name: string; countryCode: string; categories: readonly CategoryEvidence[] }[];
}
export interface OfficeKongCategoryScore {
  category: Category;
  state: OfficeKongSupervisorState;
  points: number | null;
  deduction: number;
  reason: string;
}
interface ScoreAggregate { points: number | null; scoredCategories: number; totalCategories: number }
export interface OfficeKongCityScore extends ScoreAggregate {
  id: string;
  name: string;
  countryCode: string;
  categories: OfficeKongCategoryScore[];
}
export interface OfficeKongCountryScore extends ScoreAggregate { countryCode: string; cityCount: number }
export interface OfficeKongSupervision {
  snapshotAt: string | null;
  verified: boolean;
  cities: OfficeKongCityScore[];
  countries: OfficeKongCountryScore[];
}

function aggregate(categories: readonly OfficeKongCategoryScore[]): ScoreAggregate {
  const points = categories.flatMap(category => category.points === null ? [] : [category.points]);
  return { points: points.length ? Math.round(points.reduce((sum, value) => sum + value, 0) / points.length) : null,
    scoredCategories: points.length, totalCategories: categories.length };
}

function scoreCategory(category: Category, job: CategoryEvidence | undefined, verified: boolean, enabled: boolean, snapshotTime: number, nowMs: number): OfficeKongCategoryScore {
  const score = (state: OfficeKongSupervisorState, reason: string): OfficeKongCategoryScore => {
    const deduction = state === "failed" || state === "stale" || state === "missed" || state === "completed_with_warnings"
      ? OFFICE_KONG_SCORE_DEDUCTIONS[state] : 0;
    return { category, state, reason, deduction, points: state === "unverified" || state === "disabled" ? null : 100 - deduction };
  };
  if (!verified) return score("unverified", "Falta una auditoría reciente verificable.");
  if (!job || job.evidence !== "persisted") return score("unverified", "Falta el registro de este trabajo.");
  if (!enabled || job.state === "disabled") return score("disabled", "El trabajo está deshabilitado en KONG.");

  const parse = (value: string | null) => value === null ? null : Date.parse(value);
  const started = parse(job.lastStartedAt);
  const completed = parse(job.lastRunAt);
  const success = parse(job.lastSuccessAt);
  const due = parse(job.nextRunAt);
  if ([started, completed, success, due].some(time => time !== null && !Number.isFinite(time)) ||
    [started, completed, success].some(time => time !== null && time > snapshotTime + MAX_CLOCK_SKEW_MS)) {
    return score("unverified", "Las fechas del trabajo no se pueden verificar.");
  }
  if (job.state === "running") {
    const lease = parse(job.leaseUntil ?? null);
    if (started === null || lease === null || !Number.isFinite(lease) || lease <= Math.max(snapshotTime, nowMs) || lease <= started) {
      return score("unverified", "Falta un plazo vigente para confirmar que la ejecución sigue en curso.");
    }
    return score("running", "KONG registra una ejecución en curso con plazo vigente.");
  }
  if ((started !== null && (completed === null || started > completed)) ||
    (success !== null && (completed === null || success > completed))) {
    return score("unverified", "El último intento no tiene un cierre verificable.");
  }
  if (job.recordedFailure === true && completed !== null && (success === null || completed >= success)) {
    return score("failed", "KONG registra una falla en el último intento.");
  }
  const interval = typeof job.intervalMs === "number" && Number.isSafeInteger(job.intervalMs) && job.intervalMs > 0 ? job.intervalMs : null;
  if (success !== null && interval !== null && snapshotTime - success > 2 * interval) {
    return score("stale", "El último resultado superó dos intervalos de ejecución.");
  }
  if (interval !== null && due !== null && snapshotTime - due > MISSED_GRACE_MS &&
    (started === null || started < due) && (completed === null || completed < due)) {
    return score("missed", "Pasaron 15 minutos desde el turno programado sin registro de inicio o finalización.");
  }
  if (job.state === "attention" && job.recordedFailure === false && interval !== null && completed !== null && success !== null &&
    (started === null ? completed === success : success >= started)) {
    return score("completed_with_warnings", "KONG registró una ejecución exitosa con avisos en el informe.");
  }
  if (job.state === "healthy" && completed !== null && success !== null) {
    return due !== null && due > snapshotTime
      ? score("scheduled", "Resultado confirmado y próximo turno programado.")
      : score("completed", "KONG registra un resultado completado.");
  }
  if (job.state === "unknown") return score("unverified", "KONG no confirma el estado del trabajo.");
  return score("unverified", "El estado informado no confirma una ejecución ni una falla.");
}

/** Scores are derived from one authenticated audit. Re-reading it never accumulates deductions. */
export function scoreOfficeKongSnapshot(snapshot: OfficeKongSupervisorSnapshot | undefined, nowMs = Date.now()): OfficeKongSupervision {
  if (!snapshot) return { snapshotAt: null, verified: false, cities: [], countries: [] };
  const snapshotAt = snapshot.citySnapshotCheckedAt ?? snapshot.generatedAt;
  const snapshotTime = Date.parse(snapshotAt);
  const isFresh = (time: number) => Number.isFinite(nowMs - time) && nowMs - time >= -MAX_CLOCK_SKEW_MS && nowMs - time <= MAX_SNAPSHOT_AGE_MS;
  const verified = snapshot.cities.length > 0 && isFresh(snapshotTime) && isFresh(Date.parse(snapshot.generatedAt)) &&
    new Set(snapshot.cities.map(city => city.id)).size === snapshot.cities.length;
  const cities = snapshot.cities.map(city => {
    const categories = OFFICE_KONG_SUPERVISED_CATEGORIES.map(category => {
      const matches = city.categories.filter(job => job.category === category);
      return scoreCategory(category, matches.length === 1 ? matches[0] : undefined, verified, snapshot.cityAgentsEnabled, snapshotTime, nowMs);
    });
    return { id: city.id, name: city.name, countryCode: city.countryCode, categories, ...aggregate(categories) };
  });
  const groups = new Map<string, OfficeKongCityScore[]>();
  for (const city of cities) {
    const group = groups.get(city.countryCode);
    if (group) group.push(city);
    else groups.set(city.countryCode, [city]);
  }
  const countries = [...groups].map(([countryCode, group]) => ({ countryCode, cityCount: group.length,
    ...aggregate(group.flatMap(city => city.categories)) }));
  return { snapshotAt: Number.isFinite(snapshotTime) ? snapshotAt : null, verified, cities, countries };
}
