// Today's office role work, as recorded by the office executor (cloud or PC) in
// the shared council state (officeExecution.roleWork). Pure, no IO.
//
// The panel used to read only live probes, and presentProbeStatus() demotes
// every probe "working" to "available", so "N de M en ejecución" was always 0
// even while the cloud worker completed role jobs. This module exposes the
// minimum public summary (role, status, times; never sources, audits or
// artifacts) and lets the panel show verified work without inventing any.

import type { AgentLiveStatus } from "./agent-live-status";
import { isOnDutyWindow, ON_DUTY_DAY_MS, onDutyStatus } from "./office-on-duty";

export type RoleWorkActivityStatus = "running" | "completed" | "blocked" | "unknown";
export type RoleWorkActivity = { agentId: string; status: RoleWorkActivityStatus; startedAt: string; expiresAt: string; completedAt?: string };
type RoleWorkJobLike = { role: string; status: string; slot: string; startedAt: string; expiresAt: string; completedAt?: string };

const STATUSES: readonly string[] = ["running", "completed", "blocked", "unknown"];
const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Latest role job of the current UTC day for each role (the executor runs one slot per role per day). */
export function roleWorkActivityView(jobs: readonly RoleWorkJobLike[] | undefined, now: number): RoleWorkActivity[] {
  const today = utcDay(now);
  const latest = new Map<string, RoleWorkActivity>();
  for (const job of jobs || []) {
    if (job.slot !== today || !STATUSES.includes(job.status) || !Number.isFinite(Date.parse(job.startedAt))) continue;
    const previous = latest.get(job.role);
    if (previous && Date.parse(previous.startedAt) >= Date.parse(job.startedAt)) continue;
    latest.set(job.role, {
      agentId: job.role, status: job.status as RoleWorkActivityStatus, startedAt: job.startedAt, expiresAt: job.expiresAt,
      ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    });
  }
  return [...latest.values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
}

/** Parses the public view field defensively (old servers omit it). */
export function parseRoleWorkActivity(value: unknown): RoleWorkActivity[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RoleWorkActivity => Boolean(item) && typeof item === "object"
    && typeof (item as RoleWorkActivity).agentId === "string" && STATUSES.includes((item as RoleWorkActivity).status)
    && typeof (item as RoleWorkActivity).startedAt === "string" && typeof (item as RoleWorkActivity).expiresAt === "string");
}

const hhmm = (iso: string) => {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC` : "";
};

export function isRoleWorkLive(activity: RoleWorkActivity | undefined, now: number) {
  return activity?.status === "running" && now < Date.parse(activity.expiresAt);
}

/** Overlays today's recorded role work on a desk status. Only a live lease makes a desk "working";
 * completed work marks a healthy desk on duty (still "available"); blocked work only adds a monitor line. External publishers
 * (offline + "Externo") are never shown as executing inside the office. */
export function applyRoleWorkActivity(status: AgentLiveStatus | undefined, activity: RoleWorkActivity | undefined, now: number): AgentLiveStatus | undefined {
  if (!activity) return status;
  const base: AgentLiveStatus = status || { state: "checking", label: "Verificando..." };
  const external = base.state === "offline" && base.label.startsWith("Externo");
  if (isRoleWorkLive(activity, now) && !external) {
    return { ...base, state: "working", label: "Ejecutando su trabajo del día", detail: `Turno del ejecutor de la oficina desde ${hhmm(activity.startedAt)}.`,
      activity: ["Ejecutando turno verificado", ...(base.activity || [])].slice(0, 4) };
  }
  const line = activity.status === "completed" ? `Trabajo verificado hoy · ${hhmm(activity.completedAt || activity.startedAt)}`
    : activity.status === "blocked" ? `Turno de hoy bloqueado · ${hhmm(activity.completedAt || activity.startedAt)}`
      : "Turno de hoy sin confirmar";
  const activityLines = [line, ...(base.activity || []).filter(item => item !== line)].slice(0, 4);
  // Completed today with no failure on the desk: on duty ("Activo · al día"), never "working".
  // Errors, setup warnings and external publishers are never upgraded.
  const completedAt = activity.completedAt || activity.startedAt;
  if (activity.status === "completed" && !external && base.state !== "error" && base.state !== "needs-setup"
    && completedAt.slice(0, 10) === utcDay(now) && isOnDutyWindow({ lastWorkAt: completedAt, maxAgeMs: ON_DUTY_DAY_MS, now })) {
    return { ...onDutyStatus({ lastWorkAt: completedAt, now, base, extra: "turno diario del ejecutor de la oficina" }), activity: activityLines };
  }
  return { ...base, activity: activityLines };
}

/** Counts desks with work completed today, among the given ids. */
export function countRoleWorkCompleted(activities: readonly RoleWorkActivity[], ids: readonly string[]) {
  const wanted = new Set(ids);
  return activities.filter(item => item.status === "completed" && wanted.has(item.agentId)).length;
}
