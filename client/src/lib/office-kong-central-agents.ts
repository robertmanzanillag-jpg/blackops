import type { OfficeKongAgent } from "../../../server/office-kong";
import type { OfficeCityAgent } from "./office-city-agents";

export const OFFICE_KONG_CENTRAL_SEATS = [
  { id: "kong-videos", nativeName: "Videos Kong", name: "Videos Kong", job: "Edición y entrega de videos de Kong", aliases: ["kong-videos", "videos kong"] },
  { id: "kong:KONG AI", nativeName: "KONG AI", name: "KONG AI", job: "IA de KONG", aliases: ["kong ai"] },
  { id: "kong:Promoters + Mesas", nativeName: "Promoters + Mesas", name: "Promotores + Mesas", job: "Promotores y mesas", aliases: ["promoters + mesas", "promotores + mesas"] },
  { id: "kong:Venues", nativeName: "Venues", name: "Venues", job: "Venues", aliases: ["venues"] },
  { id: "kong:Kong Legal", nativeName: "Kong Legal", name: "Kong Legal", job: "Revisión legal de KONG", aliases: ["kong legal"] },
] as const;

export type OfficeKongCentralSignalKind = "current" | "last-result" | "alert" | "unverified";

export interface OfficeKongCentralSignal {
  id: string;
  name: string;
  role: string;
  signal: OfficeKongCentralSignalKind;
  label: string;
  detail: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  snapshotAt: string | null;
  agent?: OfficeKongAgent;
}

const normalize = (value: string) => value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim().replace(/^kong:/, "");
const validTimestamp = (value: string | null) => value === null || Number.isFinite(Date.parse(value));

export function buildOfficeKongCentralSignals(
  agents: readonly OfficeKongAgent[] | undefined,
  generatedAt: string | undefined,
  now = Date.now(),
): OfficeKongCentralSignal[] {
  const snapshotTime = generatedAt ? Date.parse(generatedAt) : NaN;
  const snapshotFresh = Number.isFinite(snapshotTime) && now - snapshotTime >= -30_000 && now - snapshotTime <= 5 * 60_000;

  return OFFICE_KONG_CENTRAL_SEATS.map(seat => {
    const matches = (agents ?? []).filter(agent => agent.kind === "department" &&
      (seat.aliases.some(alias => alias === normalize(agent.id)) ||
       seat.aliases.some(alias => alias === normalize(agent.name))));
    const uniqueMatches = [...new Map(matches.map(agent => [agent.id, agent])).values()];
    const agent = uniqueMatches.length === 1 ? uniqueMatches[0] : undefined;
    const base = {
      id: seat.id, name: seat.name, role: seat.job,
      lastRunAt: agent?.lastRunAt ?? null, nextRunAt: agent?.nextRunAt ?? null,
      snapshotAt: Number.isFinite(snapshotTime) ? new Date(snapshotTime).toISOString() : null,
    };
    if (!agent) return { ...base, signal: "unverified", label: "Actividad sin verificar",
      detail: uniqueMatches.length > 1 ? "KONG Native devolvió identidades duplicadas para este puesto." : "No hay un registro de este puesto en la lectura autenticada de KONG Native." };
    if (!validTimestamp(agent.lastRunAt) || !validTimestamp(agent.nextRunAt) ||
      (agent.lastRunAt !== null && Date.parse(agent.lastRunAt) > now + 30_000)) {
      return { ...base, signal: "unverified", label: "Actividad sin verificar",
        detail: "KONG Native devolvió fechas ausentes o no verificables para este puesto.", agent };
    }
    if (!snapshotFresh) return { ...base, signal: "unverified", label: "Actividad sin verificar",
      detail: "La lectura de KONG Native no está vigente; no confirma una ejecución actual.", agent };
    if (agent.state === "running") return { ...base, signal: "current", label: "Ejecución actual reportada por KONG Native",
      detail: agent.responsibility || agent.nextAction || "KONG Native no detalla la tarea en curso.", agent };
    if (agent.state === "attention" || agent.state === "stale" || agent.state === "disabled") {
      return { ...base, signal: "alert", label: agent.state === "stale" ? "Aviso · resultado antiguo" :
        agent.state === "disabled" ? "Aviso · puesto deshabilitado" : "Aviso registrado por KONG Native",
        detail: [agent.blocker, ...agent.issues].filter(Boolean).join(" · ") || agent.nextAction, agent };
    }
    if (agent.state === "healthy" && agent.lastRunAt) return { ...base, signal: "last-result",
      label: "Último resultado registrado", detail: agent.nextAction || "KONG Native confirma un resultado reciente, no una ejecución actual.", agent };
    return { ...base, signal: "unverified", label: "Actividad sin verificar",
      detail: agent.blocker || "KONG Native no aporta evidencia suficiente para confirmar actividad actual.", agent };
  });
}

export function officeCityEvidenceNotice(agent: OfficeCityAgent): { kind: "failure" | "source-limit" | "coverage" | "warning"; label: string } | undefined {
  if (agent.recordedFailure === true) return { kind: "failure", label: "Fallo real registrado por KONG" };
  const issues = `${agent.status.label} ${agent.status.detail ?? ""} ${agent.blocker}`;
  if (/\b429\b|rate[\s-]*limit|l[ií]mite de consultas|fuente limit[oó] las consultas/i.test(issues)) {
    return { kind: "source-limit", label: "Límite de la fuente · no equivale a un fallo del puesto" };
  }
  if (/cobertura|coverage|fuentes? (?:ausentes|faltantes|sin verificar)|sin cobertura/i.test(issues)) {
    return { kind: "coverage", label: "Aviso de cobertura · no confirma un fallo de ejecución" };
  }
  if (agent.status.state === "needs-setup" || agent.status.state === "error") {
    return { kind: "warning", label: agent.status.state === "error" ? "Requiere revisar el estado registrado" : "Aviso operativo" };
  }
  return undefined;
}
