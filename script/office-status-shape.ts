// Pure shaping for script/office-status.ts. No database access, no env loading and no logging.
// Output is meant for PUBLIC logs: only fixed enum values, counts, dates and ages ever leave here.
// Every string that reaches the report is checked against an allow-list or a strict code pattern.
import { PENDING_OFFICE_ROLES, sourceDigest } from "../server/office-role-snapshots";
import { parseRoleWork } from "../server/office-role-work";
import { parseCapabilityTraining } from "../server/office-capability-training";
import { WEB_SOURCE_ROLES } from "../server/office-web-role-sources";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const code = /^[A-Z][A-Z0-9_]{1,60}$/;

export const todayUtc = (now: number) => new Date(now).toISOString().slice(0, 10);
export const monthUtc = (now: number) => new Date(now).toISOString().slice(0, 7);

/** Counts values by status; anything outside the allow-list is folded into "other" so free text never leaks. */
export function countByStatus(values: unknown[], allowed: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = typeof value === "string" && allowed.includes(value) ? value : "other";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const pick = (value: unknown, allowed: readonly string[]) => (typeof value === "string" && allowed.includes(value) ? value : value === undefined ? null : "other");
const codes = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === "string" && code.test(v)))].sort();

const JOB_STATUSES = ["running", "completed", "blocked", "unknown"] as const;
const JOB_REASONS = ["source_unavailable", "lease_or_generation_changed", "expired_no_automatic_retry", "web_export_missing", "web_export_unverified"] as const;

function journalValid(check: () => unknown): boolean { try { check(); return true; } catch { return false; } }

export function shapeRoleWork(raw: unknown, owner: string, now: number) {
  const today = todayUtc(now);
  const jobs = object(raw) ? list(raw.jobs).filter(object) : [];
  const roles = Object.fromEntries(PENDING_OFFICE_ROLES.map(role => {
    const mine = jobs.filter(job => job.role === role);
    const job = mine.find(item => item.slot === today);
    const slots = mine.map(item => item.slot).filter((s): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)).sort();
    const audit = job && object(job.webAudit) ? list(job.webAudit.diagnostics) : job && object(job.audit) ? list(job.audit.findings).map(f => (object(f) ? f.code : undefined)) : [];
    return [role, job
      ? { today: true, status: pick(job.status, JOB_STATUSES), reason: pick(job.reason, JOB_REASONS), diagnostics: codes(audit) }
      : { today: false, status: "none", lastSlot: slots.at(-1) ?? null }];
  }));
  return { present: raw !== undefined, valid: journalValid(() => parseRoleWork(raw, owner)), jobs: jobs.length, today, roles };
}

const RUN_STATUSES = ["running", "completed", "unknown", "cancelled"] as const;
const POLICY_STATUSES = ["active", "candidate", "probation", "rejected", "superseded"] as const;

export function shapeCapabilityTraining(raw: unknown, owner: string, now: number) {
  const today = todayUtc(now);
  const runs = object(raw) ? list(raw.runs).filter(object) : [];
  const policies = object(raw) ? list(raw.policies).filter(object) : [];
  return {
    present: raw !== undefined,
    valid: journalValid(() => parseCapabilityTraining(raw, owner)),
    runsToday: countByStatus(runs.filter(r => typeof r.startedAt === "string" && r.startedAt.slice(0, 10) === today).map(r => r.status), RUN_STATUSES),
    runsTotal: countByStatus(runs.map(r => r.status), RUN_STATUSES),
    policies: countByStatus(policies.map(p => p.status), POLICY_STATUSES),
  };
}

export function shapeReviewerAcademy(company: unknown) {
  const jobs = object(company) ? list(company.academyJobs).filter(object) : [];
  return {
    academyJobs: countByStatus(jobs.map(j => j.status), JOB_STATUSES),
    trainees: object(company) && Array.isArray(company.trainees) ? company.trainees.length : 0,
  };
}

export function shapeTokens(raw: unknown, now: number) {
  const month = monthUtc(now);
  const reservations = object(raw) ? list(raw.reservations).filter(object) : [];
  return { month, reservations: countByStatus(reservations.filter(r => r.month === month).map(r => r.status), ["reserved", "accounted"]) };
}

const isoOrNull = (value: unknown) => {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/** Rows come from a SELECT that never projects the worker id, only a cloud flag. */
export function shapeWorkers(rows: Array<{ cloud: unknown; last_seen_at: unknown }>) {
  return rows.map(row => ({ kind: row.cloud === true ? "cloud" as const : "other" as const, lastSeenAt: isoOrNull(row.last_seen_at) }));
}

const PROVENANCE_KINDS = ["news_state", "products", "suppliers", "marketing_learning", "social_metrics", "clip_reports", "clip_metrics", "blackroom_remote"] as const;
const PROVENANCE_STATUSES = ["present", "missing", "invalid", "limit"] as const;

export function shapeWebSources(rows: Array<{ role: unknown; observed_at: unknown; provenance: unknown }>, now: number) {
  return Object.fromEntries(WEB_SOURCE_ROLES.map(role => {
    const row = rows.find(item => item.role === role);
    if (!row) return [role, { stored: false }];
    const observedAt = isoOrNull(row.observed_at);
    return [role, {
      stored: true,
      ageSeconds: observedAt ? Math.round((now - Date.parse(observedAt)) / 1000) : null,
      provenance: list(row.provenance).filter(object).map(p => ({ kind: pick(p.kind, PROVENANCE_KINDS), status: pick(p.status, PROVENANCE_STATUSES) })),
    }];
  }));
}

/** office_web_role_sources is keyed by the JSON-string digest (sourceDigest), not the council key. */
export const webSourceOwnerKey = (owner: string) => sourceDigest(owner);

export function shapeCouncil(raw: string | null, owner: string, now: number) {
  if (raw === null) return { councilStateFound: false as const };
  const state = JSON.parse(raw) as Record<string, unknown>;
  const execution = object(state.officeExecution) ? state.officeExecution : undefined;
  return {
    councilStateFound: true as const,
    officeExecutionPresent: !!execution,
    roleWork: shapeRoleWork(execution?.roleWork, owner, now),
    capabilityTraining: shapeCapabilityTraining(execution?.capabilityTraining, owner, now),
    reviewerAcademy: shapeReviewerAcademy(state.company),
    tokens: shapeTokens(execution?.tokens, now),
  };
}

export function parseOwner(env: Record<string, string | undefined>): string {
  const owner = (env.DEFAULT_USER_ID ?? "").trim();
  if (!owner) throw new Error("DEFAULT_USER_ID_REQUIRED");
  if (owner.length > 500) throw new Error("OWNER_INVALID");
  return owner;
}
