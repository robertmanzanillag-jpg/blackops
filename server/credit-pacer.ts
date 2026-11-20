import { z } from "zod";

/**
 * Daily credit pacer (pure). Spreads ONE prepaid credit grant evenly over the
 * days it has left, so the API budget is used, but lasts until it expires:
 *
 *   allowance(day) = remaining grant at the start of that UTC day / days left (min 1)
 *
 * Overspending one day automatically shrinks every following day's allowance,
 * because less grant remains for the same number of days. Modes:
 *   - normal: today's spend is within the allowance and yesterday was not over.
 *   - soft:   today reached the allowance or yesterday overspent. Deferrable
 *             work (capability training, academy pairs, reviewer academy) waits
 *             and office output limits are lowered; essential work continues.
 *   - hard:   the grant is exhausted or expired. The ledger itself refuses.
 *
 * Provider agnostic: it only reads a {@link PacerSnapshot}, so the shared
 * OpenAI ledger and any other prepaid ledger (for example a separate Anthropic
 * ledger) can be governed by the same rules under their own ledgerId.
 * No IO, no clock reads, no paid calls; every function is replay safe.
 */

export const PACER_DAY_MS = 86_400_000;
export type PacerPriority = "essential" | "standard" | "deferrable";
export type PacerMode = "normal" | "soft" | "hard";
export const PACER_TASK_TYPES = ["office_review", "academy_pair", "blackroom_pair", "capability_training", "reviewer_academy", "self_heal_order",
  "factory_admission", "factory_select", "factory_build", "factory_review", "office_other", "other"] as const;
export type PacerTaskType = typeof PACER_TASK_TYPES[number];

export interface PacerRow { createdAt: string; consumer: string; kind?: string; status: "reserved" | "unknown" | "settled"; reservedMicroUsd: number; actualMicroUsd?: number }
export interface PacerSnapshot { ledgerId: string; grantMicroUsd: number; observedAt: string; expiresAt: string; rows: PacerRow[] }
export interface PacerDay { day: string; allowanceMicroUsd: number; spentMicroUsd: number; over: boolean }
export interface PaceState {
  ledgerId: string; day: string; mode: PacerMode;
  allowanceMicroUsd: number; spentTodayMicroUsd: number; remainingMicroUsd: number; grantMicroUsd: number; usedMicroUsd: number;
  daysLeft: number; yesterdayOver: boolean; streak: number; streakStart: string | null; expired: boolean;
  /** Spend at the recent daily pace until expiry (can exceed the grant; the pacer keeps the real spend inside it). */
  projectedTotalMicroUsd: number;
}
export interface PacerSettings { deferrableShare: number; softOutputFactor: number; alertDays: number; thresholds: readonly number[] }
export const DEFAULT_PACER_SETTINGS: PacerSettings = { deferrableShare: 0.7, softOutputFactor: 0.75, alertDays: 3, thresholds: [50, 80, 95] };

/** OFFICE_CREDIT_OVERSPEND_ALERT_DAYS (2..14, default 3). Everything else is fixed in code. */
export function pacerSettings(env: Record<string, string | undefined>): PacerSettings {
  const raw = env.OFFICE_CREDIT_OVERSPEND_ALERT_DAYS?.trim();
  if (!raw) return DEFAULT_PACER_SETTINGS;
  const days = Number(raw);
  if (!/^[0-9]+$/.test(raw) || days < 2 || days > 14) throw Error("OFFICE_CREDIT_OVERSPEND_ALERT_DAYS must be an integer from 2 to 14.");
  return { ...DEFAULT_PACER_SETTINGS, alertDays: days };
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const startOf = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const cost = (row: PacerRow) => row.status === "settled" ? row.actualMicroUsd ?? 0 : row.reservedMicroUsd;
const MAX_DAYS = 400;

/** Per-day allowance vs spend, from the grant's first day through `now`'s day. */
export function pacerDays(snapshot: PacerSnapshot, now: number): PacerDay[] {
  const first = startOf(dayOf(Date.parse(snapshot.observedAt))), last = startOf(dayOf(now)), expires = Date.parse(snapshot.expiresAt);
  if (![first, last, expires, snapshot.grantMicroUsd].every(Number.isFinite)) throw Error("PACER_SNAPSHOT_INVALID");
  const rows = snapshot.rows.map(row => ({ at: Date.parse(row.createdAt), cost: cost(row) })).filter(row => Number.isFinite(row.at)).sort((a, b) => a.at - b.at);
  const days: PacerDay[] = [];
  let index = 0, spentBefore = 0;
  for (let start = first; start <= last && days.length < MAX_DAYS; start += PACER_DAY_MS) {
    while (index < rows.length && rows[index].at < start) spentBefore += rows[index++].cost;
    let spent = 0, cursor = index;
    while (cursor < rows.length && rows[cursor].at < start + PACER_DAY_MS) spent += rows[cursor++].cost;
    const daysLeft = Math.max(1, Math.ceil((expires - start) / PACER_DAY_MS));
    const allowance = Math.floor(Math.max(0, snapshot.grantMicroUsd - spentBefore) / daysLeft);
    days.push({ day: dayOf(start), allowanceMicroUsd: allowance, spentMicroUsd: spent, over: spent > allowance });
  }
  return days;
}

export function computePace(snapshot: PacerSnapshot, now: number): PaceState {
  const days = pacerDays(snapshot, now), today = days.at(-1)!, yesterday = days.at(-2);
  const used = snapshot.rows.reduce((n, row) => n + cost(row), 0), expires = Date.parse(snapshot.expiresAt);
  const remaining = Math.max(0, snapshot.grantMicroUsd - used), expired = now >= expires;
  const daysLeft = Math.max(1, Math.ceil((expires - startOf(today.day)) / PACER_DAY_MS));
  // Overspend streak: consecutive over days ending today (if over) or yesterday.
  let streak = 0, streakStart: string | null = null;
  for (let i = today.over ? days.length - 1 : days.length - 2; i >= 0 && days[i].over; i--) { streak++; streakStart = days[i].day; }
  const complete = days.slice(0, -1).slice(-7);
  const recent = complete.length ? complete.reduce((n, d) => n + d.spentMicroUsd, 0) / complete.length : today.spentMicroUsd;
  const projected = Math.round(used - today.spentMicroUsd + Math.max(today.spentMicroUsd, recent) + recent * Math.max(0, daysLeft - 1));
  const mode: PacerMode = expired || remaining <= 0 ? "hard" : today.spentMicroUsd >= today.allowanceMicroUsd || !!yesterday?.over ? "soft" : "normal";
  return { ledgerId: snapshot.ledgerId, day: today.day, mode, allowanceMicroUsd: today.allowanceMicroUsd, spentTodayMicroUsd: today.spentMicroUsd,
    remainingMicroUsd: remaining, grantMicroUsd: snapshot.grantMicroUsd, usedMicroUsd: used, daysLeft, yesterdayOver: !!yesterday?.over,
    streak, streakStart, expired, projectedTotalMicroUsd: projected };
}

export interface PaceDecision { allowed: boolean; reason: "ALLOWED" | "GRANT_EXHAUSTED" | "SOFT_MODE_DEFERRED" | "DAILY_ALLOWANCE_REACHED" | "DAILY_ALLOWANCE_RESERVED_FOR_PRIORITY" }

/** Essential work is never paced (only the ledger's grant limit applies). Standard
 * work runs while today's allowance has room; deferrable work only in normal mode
 * and only inside a share of the allowance, leaving room for standard work. */
export function decidePace(pace: PaceState, request: { priority: PacerPriority; estimateMicroUsd: number }, settings: PacerSettings = DEFAULT_PACER_SETTINGS): PaceDecision {
  const estimate = Math.max(0, Math.ceil(request.estimateMicroUsd || 0));
  if (pace.mode === "hard") return { allowed: false, reason: "GRANT_EXHAUSTED" };
  if (request.priority === "essential") return { allowed: true, reason: "ALLOWED" };
  if (request.priority === "deferrable") {
    if (pace.mode === "soft") return { allowed: false, reason: "SOFT_MODE_DEFERRED" };
    return pace.spentTodayMicroUsd + estimate <= Math.floor(pace.allowanceMicroUsd * settings.deferrableShare)
      ? { allowed: true, reason: "ALLOWED" } : { allowed: false, reason: "DAILY_ALLOWANCE_RESERVED_FOR_PRIORITY" };
  }
  return pace.spentTodayMicroUsd + estimate <= pace.allowanceMicroUsd ? { allowed: true, reason: "ALLOWED" } : { allowed: false, reason: "DAILY_ALLOWANCE_REACHED" };
}

/** How many standard-priority units of `estimateMicroUsd` today's allowance can still fund. */
export function fundableUnits(pace: PaceState, estimateMicroUsd: number): number {
  if (pace.mode === "hard") return 0;
  const estimate = Math.max(1, Math.ceil(estimateMicroUsd));
  return Math.floor(Math.max(0, pace.allowanceMicroUsd - pace.spentTodayMicroUsd) / estimate);
}

/** Soft mode lowers office output limits (never below 256 tokens). */
export function pacedOutputTokens(pace: PaceState | undefined, base: number, settings: PacerSettings = DEFAULT_PACER_SETTINGS): number {
  return pace?.mode === "soft" ? Math.max(Math.min(256, base), Math.floor(base * settings.softOutputFactor)) : base;
}

/** Ledger key kind (prefix) -> task type for factory rows. Office rows are hashed and recorded separately. */
export function taskTypeOfKind(kind: string | undefined): PacerTaskType {
  switch (kind) {
    case "factory-admission": return "factory_admission";
    case "factory-select": return "factory_select";
    case "factory": return "factory_build";
    case "factory-review": return "factory_review";
    case "office": return "office_other";
    default: return "other";
  }
}

/** Office execution id -> task type (ids are assigned by trusted runners, never by models). */
export function taskTypeOfExecution(executionId: string): PacerTaskType {
  if (executionId.startsWith("review:")) return "office_review";
  if (executionId.startsWith("role-academy:")) return "academy_pair";
  if (executionId.startsWith("blackroom-academy:")) return "blackroom_pair";
  if (/^[0-9a-f-]{36}:(baseline|trained)$/.test(executionId)) return "capability_training";
  return "office_other";
}

// ---------- persisted history (officeExecution.creditPacer) ----------

const microUsd = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const costSchema = z.object({ count: z.number().int().min(0).max(1e9), microUsd, outputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
const alertSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/), kind: z.enum(["overspend_streak", "grant_threshold"]), at: z.string().datetime(), day: dayKey,
  streakDays: z.number().int().min(0).max(400).optional(), percent: z.number().int().min(0).max(100).optional(),
  allowanceMicroUsd: microUsd, spentTodayMicroUsd: microUsd, usedMicroUsd: microUsd, grantMicroUsd: microUsd, projectedTotalMicroUsd: microUsd }).strict();
export type PacerAlert = z.infer<typeof alertSchema>;
const ledgerSchema = z.object({
  updatedAt: z.string().datetime(),
  pace: z.object({ day: dayKey, mode: z.enum(["normal", "soft", "hard"]), allowanceMicroUsd: microUsd, spentTodayMicroUsd: microUsd, remainingMicroUsd: microUsd,
    grantMicroUsd: microUsd, usedMicroUsd: microUsd, daysLeft: z.number().int().min(1).max(10000), streak: z.number().int().min(0).max(400), projectedTotalMicroUsd: microUsd }).strict(),
  days: z.array(z.object({ day: dayKey, allowanceMicroUsd: microUsd, spentMicroUsd: microUsd, over: z.boolean() }).strict()).max(62),
  costs: z.record(dayKey, z.record(z.enum(PACER_TASK_TYPES), costSchema)),
  alerts: z.object({ notifiedStreakStart: dayKey.nullable(), thresholds: z.array(z.number().int().min(1).max(100)).max(10), log: z.array(alertSchema).max(20) }).strict(),
}).strict();
export type CreditPacerLedgerState = z.infer<typeof ledgerSchema>;
const stateSchema = z.object({ version: z.literal(1), ledgers: z.record(z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/), ledgerSchema) }).strict()
  .refine(value => Object.keys(value.ledgers).length <= 4, "PACER_LEDGERS_LIMIT");
export type CreditPacerState = z.infer<typeof stateSchema>;

export function parseCreditPacerState(raw: unknown): CreditPacerState {
  if (raw === undefined) return { version: 1, ledgers: {} };
  return stateSchema.parse(raw);
}

export type PacerCostSample = { taskType: PacerTaskType; microUsd: number; outputTokens: number; at: number };

/**
 * Pure office-worker step: records today's pace, the per-day history, cost per
 * task type (factory types from the ledger, office types from recorded samples)
 * and emits each alert at most once (once per overspend streak; once per
 * grant threshold). Returns the new alerts so the caller can notify.
 */
export function advanceCreditPacer(input: { state: unknown; snapshot: PacerSnapshot; now: number; samples?: readonly PacerCostSample[]; settings?: PacerSettings }):
  { state: CreditPacerState; alerts: PacerAlert[]; pace: PaceState } {
  const settings = input.settings ?? DEFAULT_PACER_SETTINGS, now = input.now, iso = new Date(now).toISOString();
  const state = parseCreditPacerState(input.state), id = input.snapshot.ledgerId;
  const pace = computePace(input.snapshot, now), days = pacerDays(input.snapshot, now).slice(-62);
  const previous = state.ledgers[id];
  // Factory costs per day are re-derived from the ledger every time (idempotent).
  const costs: CreditPacerLedgerState["costs"] = {};
  const keep = new Set(days.slice(-30).map(d => d.day));
  const add = (day: string, type: PacerTaskType, amount: number, tokens: number, count = 1) => {
    if (!keep.has(day)) return;
    const bucket = (costs[day] ??= {}), row = (bucket[type] ??= { count: 0, microUsd: 0, outputTokens: 0 });
    row.count += count; row.microUsd += amount; row.outputTokens += tokens;
  };
  for (const row of input.snapshot.rows) {
    const type = taskTypeOfKind(row.kind);
    if (type !== "office_other") add(row.createdAt.slice(0, 10), type, cost(row), 0);
  }
  // Office samples accumulate (they are not in the ledger by type); keep prior office buckets.
  for (const [day, bucket] of Object.entries(previous?.costs ?? {})) for (const [type, row] of Object.entries(bucket)) {
    if (!type.startsWith("factory_")) add(day, type as PacerTaskType, row.microUsd, row.outputTokens, row.count);
  }
  for (const sample of input.samples ?? []) if (!sample.taskType.startsWith("factory_")) add(dayOf(sample.at), sample.taskType, Math.max(0, Math.round(sample.microUsd)), Math.max(0, Math.round(sample.outputTokens)));
  const alerts: PacerAlert[] = [];
  const base = { at: iso, day: pace.day, allowanceMicroUsd: pace.allowanceMicroUsd, spentTodayMicroUsd: pace.spentTodayMicroUsd, usedMicroUsd: pace.usedMicroUsd,
    grantMicroUsd: pace.grantMicroUsd, projectedTotalMicroUsd: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, pace.projectedTotalMicroUsd)) };
  let notifiedStreakStart = previous?.alerts.notifiedStreakStart ?? null;
  if (pace.streak >= settings.alertDays && pace.streakStart && notifiedStreakStart !== pace.streakStart) {
    notifiedStreakStart = pace.streakStart;
    alerts.push({ id: `overspend:${id}:${pace.streakStart}`.slice(0, 120), kind: "overspend_streak", streakDays: pace.streak, ...base });
  }
  const thresholds = [...(previous?.alerts.thresholds ?? [])];
  const percent = pace.grantMicroUsd > 0 ? Math.floor((pace.usedMicroUsd * 100) / pace.grantMicroUsd) : 0;
  for (const t of settings.thresholds) if (percent >= t && !thresholds.includes(t)) {
    thresholds.push(t);
    alerts.push({ id: `grant:${id}:${t}`.slice(0, 120), kind: "grant_threshold", percent: t, ...base });
  }
  const ledger: CreditPacerLedgerState = {
    updatedAt: iso,
    pace: { day: pace.day, mode: pace.mode, allowanceMicroUsd: pace.allowanceMicroUsd, spentTodayMicroUsd: pace.spentTodayMicroUsd, remainingMicroUsd: pace.remainingMicroUsd,
      grantMicroUsd: pace.grantMicroUsd, usedMicroUsd: pace.usedMicroUsd, daysLeft: Math.min(10000, pace.daysLeft), streak: Math.min(400, pace.streak), projectedTotalMicroUsd: base.projectedTotalMicroUsd },
    days, costs,
    alerts: { notifiedStreakStart, thresholds: thresholds.sort((a, b) => a - b).slice(0, 10), log: [...alerts, ...(previous?.alerts.log ?? [])].slice(0, 20) },
  };
  const ledgers = { ...state.ledgers, [id]: ledger };
  // Bounded: keep the four most recently updated ledgers.
  const kept = Object.entries(ledgers).sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt)).slice(0, 4);
  return { state: stateSchema.parse({ version: 1, ledgers: Object.fromEntries(kept) }), alerts, pace };
}

export interface TaskEfficiency { taskType: PacerTaskType; count: number; avgMicroUsd: number; previousAvgMicroUsd: number | null; trend: "cheaper" | "same" | "pricier" | "new" }

/**
 * Cost-efficiency signal: average cost per run of each task type over the last
 * 7 recorded days vs the 7 before. Consumers use the measured average as their
 * admission estimate, and training prefers equal-quality outcomes that cost less.
 */
export function taskEfficiency(ledger: CreditPacerLedgerState | undefined, today: string): TaskEfficiency[] {
  if (!ledger) return [];
  const end = startOf(today), result: TaskEfficiency[] = [];
  const window = (from: number, to: number, type: string) => {
    let count = 0, total = 0;
    for (const [day, bucket] of Object.entries(ledger.costs)) { const at = startOf(day); const row = bucket[type as PacerTaskType]; if (row && at > from && at <= to) { count += row.count; total += row.microUsd; } }
    return { count, avg: count ? Math.round(total / count) : 0 };
  };
  for (const type of PACER_TASK_TYPES) {
    const recent = window(end - 7 * PACER_DAY_MS, end, type), earlier = window(end - 14 * PACER_DAY_MS, end - 7 * PACER_DAY_MS, type);
    if (!recent.count) continue;
    const trend = !earlier.count ? "new" : recent.avg < earlier.avg * 0.95 ? "cheaper" : recent.avg > earlier.avg * 1.05 ? "pricier" : "same";
    result.push({ taskType: type, count: recent.count, avgMicroUsd: recent.avg, previousAvgMicroUsd: earlier.count ? earlier.avg : null, trend });
  }
  return result;
}

/** Default admission estimates (micro-USD) until at least three runs were measured. */
export const DEFAULT_TASK_ESTIMATES: Record<PacerTaskType, number> = {
  office_review: 50_000, academy_pair: 60_000, blackroom_pair: 60_000, capability_training: 20_000, reviewer_academy: 100_000, self_heal_order: 1_000_000,
  factory_admission: 0, factory_select: 100_000, factory_build: 500_000, factory_review: 200_000, office_other: 50_000, other: 50_000,
};

/** Measured average over the last 14 recorded days (>= 3 runs), else the default. */
export function estimateTask(ledger: CreditPacerLedgerState | undefined, type: PacerTaskType, today: string): number {
  if (type === "self_heal_order") return estimateFactoryOrder(ledger, today);
  let count = 0, total = 0;
  const from = startOf(today) - 14 * PACER_DAY_MS;
  for (const [day, bucket] of Object.entries(ledger?.costs ?? {})) if (startOf(day) > from && bucket[type]) { count += bucket[type]!.count; total += bucket[type]!.microUsd; }
  return count >= 3 ? Math.max(1_000, Math.round(total / count)) : DEFAULT_TASK_ESTIMATES[type];
}

/** Measured factory provider cost per admitted order: (select + build + review) / selects, never below $1. */
export function estimateFactoryOrder(ledger: CreditPacerLedgerState | undefined, today: string): number {
  let orders = 0, total = 0;
  const from = startOf(today) - 14 * PACER_DAY_MS;
  for (const [day, bucket] of Object.entries(ledger?.costs ?? {})) {
    if (startOf(day) <= from) continue;
    orders += bucket.factory_select?.count ?? 0;
    total += (bucket.factory_select?.microUsd ?? 0) + (bucket.factory_build?.microUsd ?? 0) + (bucket.factory_review?.microUsd ?? 0);
  }
  // Floor at the default: orders that stop early (cheap selects) must never make a full build look cheap.
  return orders >= 3 ? Math.max(DEFAULT_TASK_ESTIMATES.self_heal_order, Math.round(total / orders)) : DEFAULT_TASK_ESTIMATES.self_heal_order;
}

/** Public, static view for the office header / status script: USD numbers, mode and streak only. */
export function creditPacerView(raw: unknown, now: number): { present: false } | { present: true; day: string; current: boolean; mode: PacerMode; allowanceUsd: number; spentTodayUsd: number;
  remainingUsd: number; grantUsd: number; usedPercent: number; daysLeft: number; streak: number; projectedTotalUsd: number; overDaysLast7: number } {
  try {
    const state = parseCreditPacerState(raw);
    const ledger = Object.values(state.ledgers).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    if (!ledger) return { present: false };
    const usd = (micro: number) => Math.round(micro / 10_000) / 100, p = ledger.pace;
    return { present: true, day: p.day, current: p.day === dayOf(now), mode: p.mode, allowanceUsd: usd(p.allowanceMicroUsd), spentTodayUsd: usd(p.spentTodayMicroUsd),
      remainingUsd: usd(p.remainingMicroUsd), grantUsd: usd(p.grantMicroUsd), usedPercent: p.grantMicroUsd ? Math.floor((p.usedMicroUsd * 100) / p.grantMicroUsd) : 0,
      daysLeft: p.daysLeft, streak: p.streak, projectedTotalUsd: usd(p.projectedTotalMicroUsd), overDaysLast7: ledger.days.slice(-7).filter(d => d.over).length };
  } catch { return { present: false }; }
}
