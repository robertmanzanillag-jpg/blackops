// "On duty" (Activo · al día): an agent whose last verified work finished inside
// its expected window and has no recorded failure. Agents run in short bursts
// (office cloud worker every 15 min, KONG jobs periodic), so an instant live
// lease is almost always absent; this keeps a healthy fleet from looking dead
// without claiming it is executing right now. Only a live lease is "working".
//
// On-duty desks keep state "available" (never upgrades scoring or the working
// animation) and carry `onDuty` so the office can paint and count them. Pure, no IO.

import type { AgentLiveStatus } from "./agent-live-status";

export const ON_DUTY_LABEL = "Activo · al día";
export const ON_DUTY_DAY_MS = 86_400_000;
const CLOCK_SKEW_MS = 30_000;
// Same grace the KONG supervisor uses before calling a scheduled turn "missed".
const MISSED_GRACE_MS = 15 * 60_000;

const parse = (value: string | null | undefined) => (typeof value === "string" ? Date.parse(value) : NaN);

/** HH:MM in the viewer's time zone (or the given one). Empty when the date is invalid. */
export function onDutyClock(iso: string, timeZone?: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  try {
    return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, ...(timeZone ? { timeZone } : {}) }).format(time);
  } catch {
    return new Date(time).toISOString().slice(11, 16);
  }
}

export type OnDutyWindowInput = {
  lastWorkAt: string | null | undefined;
  nextWorkAt?: string | null;
  // Maximum age of the last completed work (e.g. 2 intervals, or one day for daily roles).
  maxAgeMs: number;
  now: number;
};

/** True when the last completed work is recent enough and no scheduled turn was missed. */
export function isOnDutyWindow({ lastWorkAt, nextWorkAt, maxAgeMs, now }: OnDutyWindowInput): boolean {
  const last = parse(lastWorkAt);
  if (!Number.isFinite(last) || last > now + CLOCK_SKEW_MS) return false;
  if (!(maxAgeMs > 0) || now - last > maxAgeMs) return false;
  const next = parse(nextWorkAt);
  // A due turn that passed the grace period without a newer completion is a missed turn, not on duty.
  if (Number.isFinite(next) && next > last && now - next > MISSED_GRACE_MS) return false;
  return true;
}

/** Window for a periodic job: two intervals (the supervisor's stale threshold) or one day. */
export function onDutyMaxAge(intervalMs: number | null | undefined): number {
  return typeof intervalMs === "number" && Number.isSafeInteger(intervalMs) && intervalMs > 0 ? 2 * intervalMs : ON_DUTY_DAY_MS;
}

export function onDutyDetail(lastWorkAt: string, nextWorkAt: string | null | undefined, now: number, extra?: string, timeZone?: string): string {
  const next = parse(nextWorkAt);
  const parts = [`Último trabajo ${onDutyClock(lastWorkAt, timeZone)}`];
  if (Number.isFinite(next) && next > now) parts.push(`próximo turno ${onDutyClock(nextWorkAt!, timeZone)}`);
  if (extra) parts.push(extra);
  return parts.join(" · ");
}

/** Builds an on-duty desk status. Callers decide eligibility (no failure, fresh window). */
export function onDutyStatus(input: { lastWorkAt: string; nextWorkAt?: string | null; now: number; base?: AgentLiveStatus; extra?: string; label?: string }): AgentLiveStatus {
  const { lastWorkAt, nextWorkAt, now, base, extra, label } = input;
  return {
    ...(base || {}),
    state: "available",
    label: label || ON_DUTY_LABEL,
    detail: onDutyDetail(lastWorkAt, nextWorkAt, now, extra),
    onDuty: { lastWorkAt, ...(nextWorkAt ? { nextWorkAt } : {}) },
  };
}

export function isOnDuty(status: Pick<AgentLiveStatus, "state" | "onDuty"> | undefined): boolean {
  return status?.state === "available" && Boolean(status.onDuty);
}

/** Active = executing now (live lease) or on duty (fresh verified work, no failure). */
export function isActiveStatus(status: Pick<AgentLiveStatus, "state" | "onDuty"> | undefined): boolean {
  return status?.state === "working" || isOnDuty(status);
}

export function countActive(statuses: ReadonlyArray<Pick<AgentLiveStatus, "state" | "onDuty"> | undefined>): { active: number; working: number; total: number } {
  return {
    active: statuses.filter(isActiveStatus).length,
    working: statuses.filter(status => status?.state === "working").length,
    total: statuses.length,
  };
}

/** Room header: "N de M activos · K ejecutando ahora". */
export function activeSummary(statuses: ReadonlyArray<Pick<AgentLiveStatus, "state" | "onDuty"> | undefined>): string {
  const { active, working, total } = countActive(statuses);
  return `${active} de ${total} activos · ${working} ejecutando ahora`;
}

// Green-teal, distinct from the animated "working" emerald and the grey of idle/unknown desks.
export const ON_DUTY_COLOR = "#2dd4bf";
