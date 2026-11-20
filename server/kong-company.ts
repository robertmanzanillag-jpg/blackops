import { advanceCompany, type CompanyState } from "../shared/agent-company";
import type { KongVitalityInput } from "../shared/agent-vitality";
import type { AgentLiveStatus } from "../shared/agent-live-status";
import { scoreOfficeKongSnapshot } from "../shared/office-kong-supervisor";
import type { OfficeKongAuditResult } from "./office-kong";
import { buildOfficeKongCollaboration, type OfficeKongCollaboration } from "./office-kong-collaboration";
import { WHATSAPP_AGENT_ID, WHATSAPP_CAREER_ID, whatsappOfficeView } from "../shared/whatsapp-office-agent";

// KONG agents (departments, system agents, the WhatsApp reader and the city jobs) have ONE career
// each, in the main company, with the same vida / Academia / automejora rules as every other agent.
// Everything here is driven only by KONG's own verified snapshot; nothing is sent to KONG.
//
// Turn per kind (what is measured vs "en espera, sin pérdida"):
// - scheduled agents and city jobs: measured against their own nextRunAt (+3 h grace);
//   a completed result earns +6 vida (+10 pts), a missed turn costs -3 once per turn,
//   a recorded failure (city job run record) costs -10 once per evidence id;
// - on_demand / idle / event_driven / disabled agents and agents with evidencePending: en espera;
// - snapshot stale, missing or unreadable (KONG down, invalid token): every KONG agent en espera.
export { isKongCompanyAgent, isKongSnapshotAgent } from "../shared/agent-company";
export type KongCompanyObservation = {
  company: CompanyState;
  evidenceAt: Record<string, string>;
  statuses: Record<string, { state: AgentLiveStatus["state"]; label: string; name?: string }>;
  observedAt: string | null;
  collaboration: OfficeKongCollaboration;
  /** Holds, observed ids and repeated blockers for the vida tick (shared/agent-vitality.ts). */
  vitality: KongVitalityInput;
  names: Record<string, string>;
};

const MAX_CREDIT_AGE_MS = 24 * 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;
/** Success and completion stamps written for the same round may differ by a few milliseconds. */
const SAME_ROUND_TOLERANCE_MS = 60_000;
/** A scheduled turn this far past without a start or completion counts as missed. */
export const KONG_MISSED_TURN_MS = 3 * 60 * 60_000;

type KongCityJob = OfficeKongAuditResult["evidence"]["cities"][number]["categories"][number];
export type KongCityJobOutcome = { completedAt?: string; withWarnings?: boolean; failedAt?: string; missedAt?: string };

/**
 * What the latest durable run record of one city job proves. Never inferred from polls or leases:
 * a running job, a disabled job, unverifiable dates or missing records prove nothing.
 */
export function kongCityJobOutcome(job: KongCityJob | undefined, snapshotTime: number, now: number, enabled = true): KongCityJobOutcome {
  if (!job || job.evidence !== "persisted" || !enabled || job.state === "disabled" || job.state === "running" || !Number.isFinite(snapshotTime)) return {};
  const parse = (value: string | null | undefined) => value == null ? null : Date.parse(value);
  const started = parse(job.lastStartedAt), completed = parse(job.lastRunAt), success = parse(job.lastSuccessAt), due = parse(job.nextRunAt);
  const limit = Math.min(now, snapshotTime + MAX_CLOCK_SKEW_MS);
  if ([started, completed, success, due].some(time => time !== null && !Number.isFinite(time)) ||
    [started, completed, success].some(time => time !== null && time > limit)) return {};
  const attemptsPending = typeof job.attemptsSinceSuccess === "number" && job.attemptsSinceSuccess > 0;
  // A closed attempt after the last success, with a recorded error or unresolved attempts, is a failure.
  if (completed !== null && (success === null || completed - success > SAME_ROUND_TOLERANCE_MS) && (started === null || started <= completed) &&
    (job.recordedFailure === true || attemptsPending) && now - completed <= MAX_CREDIT_AGE_MS) return { failedAt: job.lastRunAt! };
  const outcome: KongCityJobOutcome = {};
  if (success !== null && completed !== null && success <= completed + SAME_ROUND_TOLERANCE_MS && now - success <= MAX_CREDIT_AGE_MS) {
    outcome.completedAt = job.lastSuccessAt!;
    outcome.withWarnings = job.state === "attention" || job.issues.length > 0;
  }
  if (due !== null && snapshotTime - due > KONG_MISSED_TURN_MS && (started === null || started < due) && (completed === null || completed < due)) outcome.missedAt = job.nextRunAt!;
  return outcome;
}

const blockerKey = (text: string) => text.toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#áéíóúñü ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

/** Why a non-city KONG agent has no turn to miss right now (null = measured against its nextRunAt). */
export function kongAgentHold(raw: { state: string; operationMode?: string; evidencePending?: boolean; nextRunAt: string | null }): string | null {
  if (raw.state === "disabled") return "deshabilitado en KONG";
  if (raw.evidencePending) return "KONG aún no publica la evidencia de su turno";
  if (raw.state === "idle" || raw.operationMode === "on_demand") return "servicio a pedido sin solicitudes nuevas";
  if (raw.operationMode === "event_driven") return "se activa por eventos, sin turno fijo";
  if (raw.operationMode !== "scheduled") return "KONG no publica un turno programado";
  if (!raw.nextRunAt || !Number.isFinite(Date.parse(raw.nextRunAt))) return "sin próximo turno verificable";
  return null;
}

/**
 * One KONG observation over the MAIN company. Work is credited once per completed result, never
 * once per poll or heartbeat. Without a verified fresh snapshot nothing is scored and every KONG
 * career is reported "en espera" (BlackOps not reading KONG is never the agent's fault).
 */
export function advanceKongCareers(input: {
  company: CompanyState; evidenceAt: Record<string, string>; evidence?: OfficeKongAuditResult["evidence"]; now: number;
}): KongCompanyObservation {
  const supervision = scoreOfficeKongSnapshot(input.evidence, input.now);
  const statuses: KongCompanyObservation["statuses"] = {};
  const credited: Record<string, { state: AgentLiveStatus["state"]; label: string; evidenceId?: string; missedTurn?: boolean }> = {};
  const roles: Record<string, string> = {};
  const holds: Record<string, string> = {};
  const blockers: KongVitalityInput["blockers"] = {};
  /** Seen in the snapshot (vida holds). */
  const seen = new Set<string>();
  /** Get a career now: only with a persisted run record or a credited result (registration is not evidence). */
  const observedAgents = new Set<string>();
  const evidenceAt = { ...input.evidenceAt };
  const collaboration = input.evidence ? buildOfficeKongCollaboration(input.evidence, input.now) : { verified: false, observedAt: null, totalFindings: 0, exchanges: [] };
  const credit = (id: string, at: string | null, status: AgentLiveStatus["state"], label: string, missedTurn = false) => {
    const time = at ? Date.parse(at) : NaN;
    if (!Number.isFinite(time) || time > input.now || time <= Date.parse(evidenceAt[id] || "1970-01-01")) return false;
    credited[id] = { state: status, label, evidenceId: missedTurn ? `${id}:missed:${at}` : `${id}:${at}`, ...(missedTurn ? { missedTurn: true } : {}) };
    evidenceAt[id] = at!;
    return true;
  };
  const snapshotTime = supervision.snapshotAt ? Date.parse(supervision.snapshotAt) : NaN;
  if (!supervision.verified || !input.evidence) {
    return { company: input.company, evidenceAt, statuses, observedAt: null, collaboration, names: {}, vitality: { observed: false, agents: [], holds: {}, blockers: {} } };
  }
  for (const raw of input.evidence.agents.filter(agent => agent.kind !== "city")) {
    if (raw.id === WHATSAPP_AGENT_ID) continue; // Only the validated reader contract can credit this external role.
    const id = `kong:${raw.id}`;
    roles[id] = raw.name;
    seen.add(id);
    const hold = kongAgentHold(raw);
    if (hold) holds[id] = hold;
    // KONG's agents contract has no failure record of its own: a blocker is a diagnostic for automejora, not a vida loss.
    if (raw.blocker && raw.blocker.trim()) blockers[id] = { key: blockerKey(raw.blocker) || "bloqueo", label: raw.blocker.trim().slice(0, 140) };
    // A running label without a lease is not proof that a remote department is still executing.
    statuses[id] = { state: raw.state === "attention" ? "error" : "offline", label: raw.state === "disabled" ? "Deshabilitado" : hold ? `En espera: ${hold}` : "Sin ejecución vigente verificable" };
    // Report notes (coverage incidents) do not undo a completed run KONG itself reports as healthy; a blocker does.
    const lastRun = raw.lastRunAt ? Date.parse(raw.lastRunAt) : NaN;
    if (raw.state === "healthy" && Number.isFinite(lastRun) && input.now - lastRun >= 0 && input.now - lastRun <= MAX_CREDIT_AGE_MS && !raw.blocker) {
      statuses[id] = { state: "offline", label: "Resultado confirmado; esperando próximo turno" };
      observedAgents.add(id);
      if (credit(id, raw.lastRunAt, "working", "Resultado completado verificado en KONG")) continue;
    }
    // Scheduled turn passed (+grace) with no run after it: one -3 charge per turn (its nextRunAt is the evidence id).
    if (!hold && raw.state !== "running" && Number.isFinite(snapshotTime)) {
      const due = Date.parse(raw.nextRunAt!);
      if (snapshotTime - due > KONG_MISSED_TURN_MS && (!Number.isFinite(lastRun) || lastRun < due)) credit(id, raw.nextRunAt, "error", "Turno programado vencido sin ejecución registrada.", true);
    }
  }
  const reader = whatsappOfficeView(input.evidence.whatsappReader, input.now);
  roles[WHATSAPP_CAREER_ID] = "Vigilancia WhatsApp";
  seen.add(WHATSAPP_CAREER_ID);
  statuses[WHATSAPP_CAREER_ID] = {
    state: reader.status === "reading" ? "working" : reader.status === "blocked" ? "needs-setup" : "checking",
    label: reader.label,
  };
  // The reader has no fixed turn in the contract: it is never charged for inactivity.
  holds[WHATSAPP_CAREER_ID] = reader.status === "blocked" ? "lector bloqueado por configuración" : "lector sin turno fijo publicado";
  // Reading/heartbeats/blocked evidence are not completed work or confirmed failed assignments.
  if (reader.status === "recent") observedAgents.add(WHATSAPP_CAREER_ID);
  if (reader.status === "recent") credit(WHATSAPP_CAREER_ID, reader.evidence!.lastSuccessAt, "working", "Lectura completa verificada de cuatro grupos");
  for (const city of supervision.cities) for (const score of city.categories) {
    const id = `kong-city:${city.id}:${score.category}`;
    const job = input.evidence.cities.find(item => item.id === city.id)?.categories.find(item => item.category === score.category);
    roles[id] = `${city.name} · ${score.category}`;
    seen.add(id);
    if (job?.evidence === "persisted" && score.points !== null) observedAgents.add(id);
    if (!input.evidence.cityAgentsEnabled) holds[id] = "agentes de ciudad deshabilitados en KONG";
    else if (!job || job.evidence !== "persisted") holds[id] = "sin registro persistido de su turno";
    else if (job.state === "disabled") holds[id] = "deshabilitado en KONG";
    statuses[id] = { state: score.state === "running" ? "working" : score.state === "failed" ? "error" : "offline", label: score.reason };
    // Credit follows the job's own run record, not the supervisor's display label: a round that closed
    // with coverage incidents ("attention") still completed real work.
    const outcome = kongCityJobOutcome(job, snapshotTime, input.now, input.evidence.cityAgentsEnabled);
    if (outcome.failedAt) {
      blockers[id] = { key: "falla registrada", label: "KONG registra una falla en el último intento" };
      credit(id, outcome.failedAt, "error", "KONG registra una falla en el último intento.");
    } else if (!(outcome.completedAt && credit(id, outcome.completedAt, "working", outcome.withWarnings ? "Ronda completada con avisos de cobertura verificada en KONG" : "Resultado completado verificado en KONG")) && outcome.missedAt) {
      credit(id, outcome.missedAt, "error", "Turno programado vencido sin ejecución registrada.", true);
    }
  }
  for (const [id, status] of Object.entries(statuses)) status.name = roles[id];
  // A career starts with the first persisted record or credited result, unscored (a missed turn or failure creates it when charged).
  const newAgents = Object.fromEntries([...observedAgents].filter(id => !input.company.careers[id]).map(id => [id, { state: "checking" as const, label: "Sin resultados puntuados" }]));
  const initialized = advanceCompany(input.company, { now: input.now, statuses: newAgents, roles }).state;
  const company = advanceCompany(initialized, { now: input.now, statuses: credited, roles }).state;
  return { company, evidenceAt, statuses, observedAt: supervision.snapshotAt, collaboration, names: roles,
    vitality: { observed: true, agents: [...seen], holds, blockers } };
}
