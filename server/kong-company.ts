import { advanceAcademy, advanceCompany, tailoredModules, type CompanyState, type CurriculumModule } from "../shared/agent-company";
import type { AgentLiveStatus } from "../shared/agent-live-status";
import { scoreOfficeKongSnapshot } from "../shared/office-kong-supervisor";
import type { OfficeKongAuditResult } from "./office-kong";
import { buildOfficeKongCollaboration, type OfficeKongCollaboration } from "./office-kong-collaboration";
import { WHATSAPP_AGENT_ID, WHATSAPP_CAREER_ID, whatsappOfficeView } from "../shared/whatsapp-office-agent";

export { isKongCompanyAgent } from "../shared/agent-company";
export type KongCompanyObservation = {
  company: CompanyState;
  evidenceAt: Record<string, string>;
  statuses: Record<string, { state: AgentLiveStatus["state"]; label: string; evidenceId?: string }>;
  observedAt: string | null;
  collaboration: OfficeKongCollaboration;
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

/** Work is credited once per completed result, never once per poll or heartbeat. */
export function advanceKongCompany(input: {
  company: CompanyState; evidenceAt: Record<string, string>; evidence?: OfficeKongAuditResult["evidence"];
  now: number; curriculum?: CurriculumModule[];
}): KongCompanyObservation {
  const supervision = scoreOfficeKongSnapshot(input.evidence, input.now);
  const statuses: KongCompanyObservation["statuses"] = {};
  const credited: Record<string, KongCompanyObservation["statuses"][string] & { missedTurn?: boolean }> = {};
  const roles: Record<string, string> = {};
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
  if (supervision.verified && input.evidence) {
    for (const raw of input.evidence.agents.filter(agent => agent.kind !== "city")) {
      if (raw.id === WHATSAPP_AGENT_ID) continue; // Only the validated reader contract can credit this external role.
      const id = `kong:${raw.id}`;
      roles[id] = raw.name;
      // A running label without a lease is not proof that a remote department is still executing.
      statuses[id] = { state: raw.state === "attention" ? "error" : "offline", label: raw.state === "disabled" ? "Deshabilitado" : "Sin ejecución vigente verificable" };
      // Report notes (coverage incidents) do not undo a completed run KONG itself reports as healthy; a blocker does.
      if (raw.state === "healthy" && raw.lastRunAt && input.now - Date.parse(raw.lastRunAt) >= 0 && input.now - Date.parse(raw.lastRunAt) <= MAX_CREDIT_AGE_MS && !raw.blocker) {
        observedAgents.add(id);
        statuses[id] = { state: "offline", label: "Resultado confirmado; esperando próximo turno" };
        credit(id, raw.lastRunAt, "working", "Resultado completado verificado en KONG");
      }
    }
    const reader = whatsappOfficeView(input.evidence.whatsappReader, input.now);
    roles[WHATSAPP_CAREER_ID] = "Vigilancia WhatsApp";
    statuses[WHATSAPP_CAREER_ID] = {
      state: reader.status === "reading" ? "working" : reader.status === "blocked" ? "needs-setup" : "checking",
      label: reader.label,
    };
    // Reading/heartbeats/blocked evidence are not completed work or confirmed failed assignments.
    // Preserve the existing once-per-result ledger; academy never replaces the external reader.
    if (reader.status === "recent") {
      observedAgents.add(WHATSAPP_CAREER_ID);
      credit(WHATSAPP_CAREER_ID, reader.evidence!.lastSuccessAt, "working", "Lectura completa verificada de cuatro grupos");
    }
    for (const city of supervision.cities) for (const score of city.categories) {
      const id = `kong-city:${city.id}:${score.category}`;
      const job = input.evidence.cities.find(item => item.id === city.id)?.categories.find(item => item.category === score.category);
      roles[id] = `${city.name} · ${score.category}`;
      if (job?.evidence === "persisted" && score.points !== null) observedAgents.add(id);
      statuses[id] = { state: score.state === "running" ? "working" : score.state === "failed" ? "error" : "offline", label: score.reason };
      // Credit follows the job's own run record, not the supervisor's display label: a round that closed
      // with coverage incidents ("attention") still completed real work.
      const outcome = kongCityJobOutcome(job, snapshotTime, input.now, input.evidence.cityAgentsEnabled);
      if (outcome.failedAt) credit(id, outcome.failedAt, "error", "KONG registra una falla en el último intento.");
      else if (!(outcome.completedAt && credit(id, outcome.completedAt, "working", outcome.withWarnings ? "Ronda completada con avisos de cobertura verificada en KONG" : "Resultado completado verificado en KONG")) && outcome.missedAt) {
        credit(id, outcome.missedAt, "error", "Turno programado vencido sin ejecución registrada.", true);
      }
    }
  }
  const newAgents = Object.fromEntries([...observedAgents].filter(id => !input.company.careers[id]).map(id => [id, { state: "checking" as const, label: "Sin resultados puntuados" }]));
  const initialized = advanceCompany(input.company, { now: input.now, statuses: newAgents, roles }).state;
  let company = advanceCompany(initialized, { now: input.now, statuses: credited, roles }).state;
  // Academy records only local curriculum study; it does not start or replace remote KONG workers.
  if (supervision.verified) company = advanceAcademy(company, trainee => [
    ...tailoredModules(company, trainee.forAgentId, { status: statuses[trainee.forAgentId], lessons: [] }),
    ...(input.curriculum || []),
  ], input.now);
  return { company, evidenceAt, statuses, observedAt: supervision.verified ? supervision.snapshotAt : null, collaboration };
}
