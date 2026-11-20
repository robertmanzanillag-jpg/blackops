// Central office panel ("Panel central"): pure shaping of data the office already reads
// (live statuses, council careers and leaderboards, retired careers, company events, role work,
// KONG evidence). Nothing here fetches, scores or invents data; the rotation rule shown is the
// one in shared/agent-company.ts (battery 0 after the minimum tenure => replaced).

import type { AgentLiveStatus } from "@shared/agent-live-status";
import { isOnDuty } from "@shared/office-on-duty";
import {
  RECORDED_FAILURE_BATTERY_COST,
  REPLACEMENT_MIN_TENURE_MS,
  type AgentCareer,
  type CompanyState,
  type LeaderboardRow,
} from "@shared/agent-company";
import type { RoleWorkActivity } from "@shared/office-role-work-activity";

export const PANEL_SECTIONS = [
  { id: "blackops", name: "BlackOps · departamentos" },
  { id: "blackroom", name: "Black Room" },
  { id: "factory", name: "Fábrica de software" },
  { id: "academy", name: "Academia" },
  { id: "kong", name: "KONG · equipo central" },
  { id: "kong-cities", name: "KONG · ciudades" },
] as const;
export type PanelSectionId = (typeof PANEL_SECTIONS)[number]["id"];
export const isPanelSectionId = (value: unknown): value is PanelSectionId => PANEL_SECTIONS.some(section => section.id === value);

export type PanelCompany = "main" | "kong";
export type PanelDepartment = { id: string; name: string; color: string; agentIds: string[]; officeRing?: 1 | 2 | 3 };

/** Which panel section an office room belongs to (same rooms as the 3D office). */
export function sectionForDepartment(department: Pick<PanelDepartment, "id" | "officeRing">, company: PanelCompany): PanelSectionId {
  if (department.id === "academia" || department.id === "kong-academia") return "academy";
  if (company === "main") return department.id === "blackroom" ? "blackroom" : department.id === "fabrica" ? "factory" : "blackops";
  return department.officeRing === 2 || department.officeRing === 3 || department.id.startsWith("kong-city:") ? "kong-cities" : "kong";
}

// Same thresholds the office uses to paint battery (>60 green, >25 amber, otherwise red).
export const BATTERY_DANGER = 25;

export type PanelStatusKind = "working" | "on-duty" | "blocked" | "attention" | "idle" | "checking";
export const STATUS_KIND_LABEL: Record<PanelStatusKind, string> = {
  working: "Trabajando ahora",
  "on-duty": "Activo · al día",
  blocked: "Bloqueado",
  attention: "Necesita atención",
  idle: "En espera",
  checking: "Verificando",
};

export function panelStatusKind(status: AgentLiveStatus | undefined): PanelStatusKind {
  if (!status) return "checking";
  if (status.state === "working") return "working";
  if (isOnDuty(status)) return "on-duty";
  if (status.state === "error") return "blocked";
  if (status.state === "needs-setup" || (status.problems?.length ?? 0) > 0) return "attention";
  if (status.state === "checking") return "checking";
  return "idle";
}

export type PanelAgentInput = {
  id: string; name: string; role: string; status: AgentLiveStatus;
  city?: { lastWorkAt: string | null; nextWorkAt: string | null; blocker: string; snapshotAt: string | null };
  kongEvidence?: { lastRunAt: string | null; nextRunAt: string | null };
};

export type PanelRow = {
  id: string; name: string; role: string; company: PanelCompany; section: PanelSectionId;
  departmentId: string; departmentName: string; departmentColor: string;
  kind: PanelStatusKind; statusLabel: string; reason?: string;
  lastWorkAt: string | null; nextWorkAt: string | null;
  career?: Pick<AgentCareer, "nickname" | "points" | "battery" | "generation" | "firedCount">;
  inTraining: boolean;
  rank?: Pick<LeaderboardRow, "rank" | "title" | "reliability">;
};

const validIso = (value: string | null | undefined) => (value && Number.isFinite(Date.parse(value)) ? value : null);

/** One row per agent desk, grouped by the office rooms; careers come from the ledger of its company. */
export function buildPanelRows(input: {
  departments: Array<{ department: PanelDepartment; company: PanelCompany }>;
  agents: ReadonlyMap<string, PanelAgentInput>;
  careers: Record<PanelCompany, Record<string, AgentCareer>>;
  leaderboards: Record<PanelCompany, LeaderboardRow[]>;
  roleWork?: readonly RoleWorkActivity[];
}): PanelRow[] {
  const roleWork = new Map((input.roleWork || []).map(item => [item.agentId, item]));
  const rows: PanelRow[] = [];
  const seen = new Set<string>();
  for (const { department, company } of input.departments) {
    for (const id of department.agentIds) {
      const agent = input.agents.get(id);
      if (!agent || seen.has(id)) continue;
      seen.add(id);
      const status = agent.status;
      const kind = panelStatusKind(status);
      const career = input.careers[company][id];
      const rank = input.leaderboards[company].find(row => row.agentId === id);
      const work = roleWork.get(id);
      const reason = kind === "blocked" || kind === "attention"
        ? status.problems?.[0] || status.detail || agent.city?.blocker || undefined
        : undefined;
      rows.push({
        id, name: agent.name, role: agent.role, company, section: sectionForDepartment(department, company),
        departmentId: department.id, departmentName: department.name, departmentColor: department.color,
        kind, statusLabel: status.label, ...(reason ? { reason } : {}),
        lastWorkAt: validIso(status.onDuty?.lastWorkAt) || validIso(agent.city?.lastWorkAt) || validIso(agent.kongEvidence?.lastRunAt)
          || validIso(work?.status === "completed" ? work.completedAt || work.startedAt : undefined),
        nextWorkAt: validIso(status.onDuty?.nextWorkAt) || validIso(agent.city?.nextWorkAt) || validIso(agent.kongEvidence?.nextRunAt),
        ...(career ? { career: { nickname: career.nickname, points: career.points, battery: career.battery, generation: career.generation, firedCount: career.firedCount } } : {}),
        inTraining: Boolean(career?.inTrainingUntilGeneration),
        ...(rank ? { rank: { rank: rank.rank, title: rank.title, reliability: rank.reliability } } : {}),
      });
    }
  }
  return rows;
}

export type PanelCounters = { total: number; working: number; onDuty: number; active: number; blocked: number; attention: number };
export function panelCounters(rows: readonly PanelRow[]): PanelCounters {
  const count = (kind: PanelStatusKind) => rows.filter(row => row.kind === kind).length;
  const working = count("working");
  const onDuty = count("on-duty");
  return { total: rows.length, working, onDuty, active: working + onDuty, blocked: count("blocked"), attention: count("attention") };
}

export type GlobalRankingRow = LeaderboardRow & { company: PanelCompany; name: string };
/** Both ledgers in one table, ordered like `leaderboard()` (points, then battery, then id). Only real points rank. */
export function buildGlobalRanking(leaderboards: Record<PanelCompany, LeaderboardRow[]>, nameOf: (id: string) => string, limit = 10): GlobalRankingRow[] {
  return (["main", "kong"] as const)
    .flatMap(company => leaderboards[company].map(row => ({ ...row, company, name: nameOf(row.agentId) })))
    .filter(row => row.points > 0)
    .sort((a, b) => b.points - a.points || b.battery - a.battery || a.agentId.localeCompare(b.agentId))
    .slice(0, limit);
}

export type ReplaceableRow = {
  agentId: string; name: string; company: PanelCompany; nickname: string; generation: number; battery: number;
  /** Recorded failures left before the battery reaches 0 (each costs RECORDED_FAILURE_BATTERY_COST). */
  failuresLeft: number;
  failingNow: boolean;
  /** Battery 0 but still inside the minimum tenure: replaced at the first evaluation after this time. */
  protectedUntil: string | null;
};

/**
 * Agents the existing rotation rule could replace soon: careers that can still rotate (not frozen
 * by a score reconciliation, not in the academy, not exempt) with battery in the red band, or whose
 * desk reports a failure right now (a recorded failure costs battery).
 */
export function selectReplaceable(input: {
  careers: Record<PanelCompany, Record<string, AgentCareer>>;
  statuses: ReadonlyMap<string, AgentLiveStatus | undefined>;
  isExempt: (agentId: string, company: PanelCompany) => boolean;
  nameOf: (id: string) => string;
  now: number;
}): ReplaceableRow[] {
  const rows: ReplaceableRow[] = [];
  for (const company of ["main", "kong"] as const) {
    for (const career of Object.values(input.careers[company])) {
      if (career.scoreReconciliation || career.inTrainingUntilGeneration || input.isExempt(career.agentId, company)) continue;
      // Same as the council: only an error with evidence and without a life-penalty exemption costs battery.
      const s = input.statuses.get(career.agentId);
      const failingNow = s?.state === "error" && !s.lifePenaltyExempt && Boolean(s.evidenceId?.trim());
      if (career.battery > BATTERY_DANGER && !failingNow) continue;
      const hired = Date.parse(career.hiredAt);
      const until = Number.isFinite(hired) ? hired + REPLACEMENT_MIN_TENURE_MS : NaN;
      rows.push({
        agentId: career.agentId, name: input.nameOf(career.agentId), company, nickname: career.nickname, generation: career.generation,
        battery: career.battery, failuresLeft: Math.ceil(career.battery / RECORDED_FAILURE_BATTERY_COST), failingNow,
        protectedUntil: career.battery === 0 && Number.isFinite(until) && until > input.now ? new Date(until).toISOString() : null,
      });
    }
  }
  return rows.sort((a, b) => a.battery - b.battery || Number(b.failingNow) - Number(a.failingNow) || a.agentId.localeCompare(b.agentId));
}

export type ReplacedRow = {
  agentId: string; name: string; company: PanelCompany; nickname: string; generation: number; points: number;
  replacedAt: string | null; reason: string | null; successor: { nickname: string; generation: number } | null;
};

/** Replacement history from the retired careers (lineage by generation) and the CEO's events. */
export function selectReplaced(input: { companies: Record<PanelCompany, CompanyState | undefined>; nameOf: (id: string) => string; limit?: number }): ReplacedRow[] {
  const rows: ReplacedRow[] = [];
  for (const company of ["main", "kong"] as const) {
    const state = input.companies[company];
    if (!state) continue;
    const retired = state.retiredCareers || [];
    for (const career of retired) {
      const successor = retired.find(item => item.agentId === career.agentId && item.generation === career.generation + 1)
        || (state.careers[career.agentId]?.generation === career.generation + 1 ? state.careers[career.agentId] : undefined);
      const event = state.events.find(item => item.text.startsWith(`El CEO despidio a ${career.nickname} `));
      const reason = event ? event.text.replace(/^El CEO despidio a [^.]*\)\.\s*/, "").replace(/\s*Entra un reemplazo a la academia\.?$/, "").trim() || null : null;
      rows.push({
        agentId: career.agentId, name: input.nameOf(career.agentId), company, nickname: career.nickname, generation: career.generation, points: career.points,
        replacedAt: validIso(successor?.hiredAt) || validIso(event?.at), reason,
        successor: successor ? { nickname: successor.nickname, generation: successor.generation } : null,
      });
    }
  }
  return rows
    .sort((a, b) => (b.replacedAt ? Date.parse(b.replacedAt) : 0) - (a.replacedAt ? Date.parse(a.replacedAt) : 0) || a.agentId.localeCompare(b.agentId))
    .slice(0, input.limit ?? 30);
}

export type PanelReport = { id: string; agentId: string | null; name: string; source: string; text: string; at: string | null; severity: "problem" | "warning" | "info" };

/** Latest problems and reports per agent, from data already on screen (newest first). */
export function buildReportsFeed(input: {
  rows: readonly PanelRow[];
  agents: ReadonlyMap<string, PanelAgentInput & { sourceName?: string }>;
  roleWork?: readonly RoleWorkActivity[];
  events?: Array<{ company: PanelCompany; at: string; text: string }>;
  limit?: number;
}): PanelReport[] {
  const reports: PanelReport[] = [];
  const nameOf = (id: string) => input.agents.get(id)?.name || id;
  for (const row of input.rows) {
    if (row.kind !== "blocked" && row.kind !== "attention") continue;
    const agent = input.agents.get(row.id);
    if (!agent) continue;
    const source = agent.city ? "Auditoría autenticada KONG" : row.company === "kong" || row.id.startsWith("kong:") ? "Lectura autenticada KONG" : agent.sourceName || "Monitor del agente";
    const at = validIso(agent.city?.snapshotAt) || row.lastWorkAt;
    const texts = [...new Set([...(agent.status.problems || []), ...(agent.status.problems?.length ? [] : [row.reason || agent.status.label])].filter(Boolean))].slice(0, 3);
    texts.forEach((text, index) => reports.push({ id: `${row.id}#${index}`, agentId: row.id, name: row.name, source, text, at, severity: row.kind === "blocked" ? "problem" : "warning" }));
  }
  for (const work of input.roleWork || []) {
    if (work.status !== "blocked") continue;
    reports.push({ id: `role-work:${work.agentId}`, agentId: work.agentId, name: nameOf(work.agentId), source: "Ejecutor de la oficina", text: "Turno de hoy bloqueado", at: validIso(work.completedAt || work.startedAt), severity: "problem" });
  }
  for (const [index, event] of (input.events || []).entries()) {
    reports.push({ id: `event:${event.company}:${index}`, agentId: null, name: event.company === "kong" ? "CEO KONG" : "CEO BlackOps", source: "Eventos de la empresa", text: event.text, at: validIso(event.at), severity: "info" });
  }
  const weight = { problem: 0, warning: 1, info: 2 } as const;
  return reports
    .sort((a, b) => (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0) || weight[a.severity] - weight[b.severity] || a.id.localeCompare(b.id))
    .slice(0, input.limit ?? 60);
}

/** Filters rows by section and free text (name, role, nickname, room, id, status, reason). */
export function filterPanelRows(rows: readonly PanelRow[], section: PanelSectionId | "all", query: string): PanelRow[] {
  const needle = query.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return rows.filter(row => (section === "all" || row.section === section) && (!needle || [row.id, row.name, row.role, row.career?.nickname, row.departmentName, row.statusLabel, row.reason]
    .some(value => value?.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(needle))));
}

/** Deep-link parameters: ?section=<blackops|kong|kong-cities|blackroom|factory|academy>&agent=<officeAgentId>. */
export function readPanelParams(search: string): { section: PanelSectionId | "all"; agent: string | null } {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const section = params.get("section");
  const agent = params.get("agent")?.trim() || null;
  return { section: isPanelSectionId(section) ? section : "all", agent: agent && agent.length <= 200 ? agent : null };
}

export type OfficeDeepLinkStep = { action: "wait" } | { action: "switch-wing" } | { action: "focus"; roomId: string } | { action: "give-up" };
/**
 * One step of the office deep link (?agent=<id>): switch to the KONG wing at most once, focus the
 * agent's room when it exists, and give up (never trap the user) once the data has settled without
 * that room or the user moved to the other wing.
 */
export function officeDeepLinkStep(input: {
  agentId: string; mainRoomId?: string; kongRoomId?: string; wing: "main" | "kong"; wingSwitched: boolean; settled: boolean;
}): OfficeDeepLinkStep {
  const wantsKong = !input.mainRoomId && (Boolean(input.kongRoomId) || /^kong(:|-city:)/.test(input.agentId));
  const target = wantsKong ? "kong" : "main";
  if (wantsKong && !input.wingSwitched && input.wing !== "kong") return { action: "switch-wing" };
  if (input.wing !== target) return { action: "give-up" };
  const roomId = target === "kong" ? input.kongRoomId : input.mainRoomId;
  if (roomId) return { action: "focus", roomId };
  return input.settled ? { action: "give-up" } : { action: "wait" };
}
