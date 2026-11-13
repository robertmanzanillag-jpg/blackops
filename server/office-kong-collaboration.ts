import { scoreOfficeKongSnapshot } from "../shared/office-kong-supervisor";
import type { OfficeKongAuditResult, OfficeKongCityCategory } from "./office-kong";

const MAX_EXCHANGES = 24;
const priority = { failed: 0, missed: 1, stale: 2, attention: 3 } as const;
type Kind = keyof typeof priority;

interface Exchange {
  id: string;
  cityId: string;
  category: OfficeKongCityCategory["category"];
  kind: Kind;
  evidenceAt: string;
  comments: [{ author: "supervisor"; text: string }, { author: "operations"; text: string }];
  proposal: { recipient: "ceo"; status: "proposed"; action: "review_city_improvement" | "review_reassignment"; text: string };
}

export interface OfficeKongCollaboration {
  verified: boolean;
  observedAt: string | null;
  totalFindings: number;
  exchanges: Exchange[];
}

function nextStep(kind: Kind, job: OfficeKongCityCategory): string {
  if (job.category === "sports" && job.issues.some(issue => /Ticketmaster.*\b429\b/i.test(issue))) {
    return "Propuesta: respetar el límite de Ticketmaster y revisar los calendarios oficiales disponibles antes del siguiente turno.";
  }
  if (job.issues.includes("La fuente limitó las consultas (HTTP 429).")) {
    return "Propuesta: respetar el límite de consultas de la fuente y revisar fuentes oficiales alternativas antes del siguiente turno.";
  }
  if (job.issues.some(issue => /paid discovery disabled/i.test(issue))) {
    return "Propuesta: revisar el inventario guardado y las fuentes públicas oficiales dentro del presupuesto actual.";
  }
  if (kind === "missed") return "Propuesta: comprobar el coordinador y la cola para este turno antes de pedir otro intento.";
  if (kind === "stale") return "Propuesta: revisar el próximo turno y confirmar que produzca un resultado vigente.";
  if (kind === "failed") return "Propuesta: revisar el error del intento registrado en KONG antes de pedir otro intento.";
  return "Propuesta: revisar el informe de este intento y verificar la cobertura en las fuentes oficiales.";
}

export function buildOfficeKongCollaboration(evidence: OfficeKongAuditResult["evidence"], nowMs = Date.now()): OfficeKongCollaboration {
  const supervision = scoreOfficeKongSnapshot(evidence, nowMs);
  const result: OfficeKongCollaboration = { verified: supervision.verified, observedAt: supervision.snapshotAt, totalFindings: 0, exchanges: [] };
  if (!supervision.verified || !supervision.snapshotAt || !evidence.cityAgentsEnabled) return result;

  const observedAt = Date.parse(supervision.snapshotAt);
  for (const [index, city] of evidence.cities.entries()) {
    for (const score of supervision.cities[index].categories) {
      const jobs = city.categories.filter(job => job.category === score.category);
      if (jobs.length !== 1 || jobs[0].evidence !== "persisted") continue;
      const [job] = jobs;
      const completedAt = job.lastRunAt === null ? NaN : Date.parse(job.lastRunAt);
      const startedAt = job.lastStartedAt === null ? null : Date.parse(job.lastStartedAt);
      const successAt = job.lastSuccessAt === null ? null : Date.parse(job.lastSuccessAt);
      const closed = Number.isFinite(completedAt) && completedAt <= observedAt &&
        (startedAt === null || startedAt <= completedAt) && (successAt === null || successAt <= completedAt);
      let kind: Kind;
      let evidenceAt: string | null;
      let report = score.reason;
      if (score.state === "failed") { kind = "failed"; evidenceAt = job.lastRunAt; }
      else if (score.state === "missed") { kind = "missed"; evidenceAt = job.nextRunAt; }
      else if (score.state === "stale") { kind = "stale"; evidenceAt = job.lastSuccessAt; }
      else if (job.state === "attention" && closed) {
        kind = "attention";
        evidenceAt = job.lastRunAt;
        report = score.state === "completed_with_warnings" ? score.reason : "El informe de una ejecución registrada en KONG requiere revisión.";
      } else continue;
      if (!evidenceAt) continue;

      const proposal = nextStep(kind, job);
      const attempts = job.attemptsSinceSuccess;
      const needsReassignmentReview = kind === "failed" && typeof attempts === "number" && Number.isSafeInteger(attempts) && attempts >= 2;
      if (needsReassignmentReview) report += ` KONG contabiliza ${attempts} intentos sin éxito registrado en esa secuencia.`;

      result.exchanges.push({
        id: JSON.stringify([city.id, job.category, kind, evidenceAt]),
        cityId: city.id, category: job.category, kind, evidenceAt,
        comments: [{ author: "supervisor", text: report }, { author: "operations", text: proposal }],
        proposal: { recipient: "ceo", status: "proposed", action: needsReassignmentReview ? "review_reassignment" : "review_city_improvement",
          text: needsReassignmentReview ? "Revisar si otro responsable debe atender este trabajo. " + proposal : proposal },
      });
    }
  }

  result.totalFindings = result.exchanges.length;
  result.exchanges.sort((a, b) => priority[a.kind] - priority[b.kind] || Date.parse(b.evidenceAt) - Date.parse(a.evidenceAt) || a.id.localeCompare(b.id));
  result.exchanges = result.exchanges.slice(0, MAX_EXCHANGES);
  return result;
}
