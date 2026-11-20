// "Vida" (agent health 0-100) driven by verified output cadence.
//
// Pure and deterministic ($0, no AI, no IO). It reuses the existing career battery
// (shared/agent-company.ts) as the single "vida" number, and adds the one rule that was
// missing: an agent that produces no verified output within its expected cadence loses
// vida, once per missed window; a verified output recovers it. It never fires, replaces
// or deletes an agent: at 0 the agent is only flagged for the CEO/Robert (the Mechanic's
// existing repair proposal and the Trust Center approval stay the only way forward).
//
// What counts as verified output:
// - any career evaluation that ended in "working" with distinct evidence (factory stage
//   rows, Clippers receipts, internal work, Black Room approvals) -- already scored by
//   advanceCompany; here it only moves the cadence clock;
// - extra evidence supplied by the caller that no other path scores (office role-work jobs
//   completed with an artifact, the cloud streamer lane's run/post/observation receipts).
// What never counts: heartbeats, readiness, a configured seat, a plan, a manual close.
// What pauses the clock (no loss): an explicit setup hold (missing credentials or source,
// needs-setup, a life-penalty exemption) and the academy.
//
// KONG agents (`kong:*`, `kong-city:*`) follow the same vida rules, but their turn is KONG's own
// schedule (server/kong-company.ts scores +6 per verified run and -3 per missed nextRunAt, once
// per evidence id); here they get the same holds ("en espera"), academy pause, vida-0 flag and the
// repeated-blocker record that feeds automejora. No KONG snapshot this tick = everyone en espera.

import { BATTERY_MAX, isKongSnapshotAgent, type AgentCareer, type CompanyState, type MemoryEntry } from "./agent-company";
import { CLIPPERS_AGENTS } from "./clippers-office-agents";
import { FACTORY_AGENTS } from "./factory-office-agents";
import type { AgentLiveStatus } from "./agent-live-status";
import { onDutyStatus } from "./office-on-duty";

export const HOUR_MS = 60 * 60_000;
/** Vida recovered by one cycle with new verified output that no other rule scored. */
export const VITALITY_RECOVERY = 6;
/** Cost of one missed cadence window (same as a KONG missed turn: smaller than a recorded failure). */
export const VITALITY_MISS = { points: 2, battery: 3 } as const;
const MAX_CREDITED_IDS = 60;
const EVIDENCE_WINDOW_MS = 7 * 24 * HOUR_MS;
const MAX_MEMORY = 12;
const MAX_EVENTS = 40;
const MAX_PROPOSED_KEYS = 20;

/** Roles with a daily office role-work job (server/office-role-snapshots.ts PENDING_OFFICE_ROLES). */
export const DAILY_ROLE_WORK_ROLES = ["code", "news", "legal", "github", "control", "revenue", "clippers", "portfolio", "automations", "dropshipping", "news:ny-news", "marketing-cmo", "news:miami-news", "blackroom-videos"] as const;
/** Roles with a daily internal planning job (server/office-internal-work.ts; "ceo" is a coordinator). */
export const INTERNAL_WORK_ROLES = ["assistant", "radio"] as const;
const DAILY_ROLE_WORK = new Set<string>(DAILY_ROLE_WORK_ROLES);
const INTERNAL_WORK = new Set<string>(INTERNAL_WORK_ROLES);
const FACTORY_IDS = new Set<string>(FACTORY_AGENTS.map(agent => agent.id));
const CLIPPERS_IDS = new Set<string>(CLIPPERS_AGENTS.map(agent => agent.id));
/** Clippers lanes with a receipt feed (Mac ingest or the cloud streamer lane). Trends, supervisor and health have none. */
export const CLIPPERS_MEASURED = ["clippers-streamers", "clippers-editor", "clippers-checker", "clippers-publisher", "clippers-analytics", "clippers-learning"] as const;
const CLIPPERS_WITH_FEED = new Set<string>(CLIPPERS_MEASURED);
const isKong = (id: string) => id === "kong" || id.startsWith("kong:") || id.startsWith("kong-city:") || ["kong-videos", "kong-metrics", "kong-supervisor"].includes(id);

/**
 * Expected cadence of verified output, or null when the agent has no verified evidence source
 * to measure (coordinators, observers, agents whose work is not recorded anywhere yet). A null
 * cadence never loses vida for inactivity; it still follows the existing error/approval rules.
 */
export function vitalityCadenceMs(agentId: string): number | null {
  if (agentId === "clippers-learning") return 7 * 24 * HOUR_MS;
  if (CLIPPERS_WITH_FEED.has(agentId)) return 48 * HOUR_MS;
  if (CLIPPERS_IDS.has(agentId)) return null;
  if (FACTORY_IDS.has(agentId)) return 7 * 24 * HOUR_MS;
  if (DAILY_ROLE_WORK.has(agentId) || INTERNAL_WORK.has(agentId)) return 26 * HOUR_MS;
  if (agentId === "skills-scout") return 72 * HOUR_MS;
  // The Black Room CEO coordinates its team (like the main CEO): no output of its own to measure.
  if (agentId === "blackroom-ceo") return null;
  if (agentId.startsWith("br-") || agentId.startsWith("blackroom-")) return 72 * HOUR_MS;
  return null;
}

export type CareerVitality = {
  /** Start of the current cadence clock (last verified output or evaluation, hire, first sight, end of a hold or office downtime). */
  anchorAt: string;
  /** Missed windows already charged for the current anchor (so each window costs once). */
  missesApplied: number;
  /** Last vitality tick: a gap longer than one cadence is office downtime and is never charged. */
  lastTickAt?: string;
  /** career.cyclesWorking already seen, so verified work that landed between rounds still counts. */
  seenCyclesWorking?: number;
  /** Vida removed by inactivity and not yet recovered by verified work (informational). */
  decayDebt?: number;
  /** Set when a missed-window charge itself brought vida to 0. While set (and vida is 0) the agent is never replaced automatically. */
  zeroByDecay?: string;
  lastVerifiedWorkAt?: string;
  lastVerifiedLabel?: string;
  /** Latest caller evidence already credited (ids and time), so a receipt never recovers twice. */
  lastCreditedAt?: string;
  creditedIds: string[];
  holdReason?: string;
  flaggedAt?: string;
  /** Cooldowns kept on the career (proposal history is pruned): vida-0 review and automejora keys. */
  flagProposedAt?: string;
  proposedKeys?: Record<string, string>;
  /** KONG agents: the blocker KONG keeps reporting and since when (feeds automejora proposals). */
  kongBlocker?: { key: string; label: string; since: string };
};

/** What the KONG snapshot of this tick says for the vida rule (server/kong-company.ts advanceKongCareers). */
export type KongVitalityInput = {
  /** False when the snapshot was missing, stale or unreadable: every KONG career is en espera. */
  observed: boolean;
  /** Career ids present in the snapshot. */
  agents: string[];
  /** id -> why it has no turn to miss now (on demand, idle, disabled, evidence pending, ...). */
  holds: Record<string, string>;
  blockers: Record<string, { key: string; label: string }>;
};
export const KONG_UNREAD_HOLD = "KONG sin lectura verificada: BlackOps no pudo leer su estado";

/** `clockOnly`: output already scored by another rule (e.g. Black Room quality signals): moves the clock, no extra vida. */
export type VitalityEvidence = { id: string; agentId: string; at: string; label: string; clockOnly?: boolean };

const ms = (value: string | undefined) => { const n = value ? Date.parse(value) : NaN; return Number.isFinite(n) ? n : 0; };
const remember = (memory: MemoryEntry[], at: string, text: string) => [{ at, text }, ...memory].slice(0, MAX_MEMORY);

export function parseVitality(value: unknown): CareerVitality | undefined {
  const v = value as Partial<CareerVitality> | null | undefined;
  if (!v || typeof v !== "object" || !Number.isFinite(Date.parse(String(v.anchorAt))) || !Number.isSafeInteger(v.missesApplied) || (v.missesApplied as number) < 0) return undefined;
  const proposedKeys = v.proposedKeys && typeof v.proposedKeys === "object" && !Array.isArray(v.proposedKeys)
    ? Object.fromEntries(Object.entries(v.proposedKeys).filter(([k, at]) => typeof k === "string" && typeof at === "string" && Number.isFinite(Date.parse(at))).slice(-MAX_PROPOSED_KEYS)) : undefined;
  return { ...v, anchorAt: v.anchorAt!, missesApplied: v.missesApplied!, creditedIds: Array.isArray(v.creditedIds) ? v.creditedIds.filter(id => typeof id === "string").slice(-MAX_CREDITED_IDS) : [],
    decayDebt: Number.isFinite(v.decayDebt) && (v.decayDebt as number) > 0 ? v.decayDebt : 0, ...(proposedKeys ? { proposedKeys } : {}) } as CareerVitality;
}
const clean = (v: CareerVitality) => Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined)) as CareerVitality;

/**
 * One vitality tick over the main company. `holds` maps agentId -> reason for agents whose
 * pipeline is off or blocked only by setup (their clock pauses). `exempt` agents (paused,
 * external, no work of their own) and agents without a cadence are never touched.
 */
export function applyVitality(company: CompanyState, input: {
  now: number; evidence?: VitalityEvidence[]; holds?: Record<string, string>; exempt?: string[]; names?: Record<string, string>;
  /** KONG snapshot of this tick. Omitted = KONG careers are left untouched (e.g. tests of other lanes). */
  kong?: KongVitalityInput;
}): { state: CompanyState; flagged: string[]; recovered: string[]; decayed: string[] } {
  const iso = new Date(input.now).toISOString();
  const careers: Record<string, AgentCareer> = { ...company.careers };
  let events = [...company.events];
  const flagged: string[] = [], recovered: string[] = [], decayed: string[] = [];
  const evidenceBy = new Map<string, VitalityEvidence[]>();
  for (const item of input.evidence || []) {
    if (!item || typeof item.id !== "string" || !item.id || typeof item.agentId !== "string") continue;
    const at = ms(item.at);
    if (!at || at > input.now + 5_000 || input.now - at > EVIDENCE_WINDOW_MS) continue;
    evidenceBy.set(item.agentId, [...(evidenceBy.get(item.agentId) || []), item]);
  }
  for (const [agentId, original] of Object.entries(company.careers)) {
    const kong = isKongSnapshotAgent(agentId);
    if (kong && !input.kong) continue;
    const cadence = kong ? null : vitalityCadenceMs(agentId);
    if ((cadence === null && !kong) || (!kong && isKong(agentId)) || input.exempt?.includes(agentId) || original.scoreReconciliation !== undefined) continue;
    const name = input.names?.[agentId] || agentId;
    let career: AgentCareer = { ...original };
    const previous = parseVitality(career.vitality);
    let v: CareerVitality = previous ? { ...previous, creditedIds: [...previous.creditedIds] } : { anchorAt: iso, missesApplied: 0, creditedIds: [], decayDebt: 0, seenCyclesWorking: career.cyclesWorking };
    // The academy is study, not a missed turn.
    if (career.inTrainingUntilGeneration) { careers[agentId] = { ...career, vitality: clean({ ...v, anchorAt: iso, missesApplied: 0, lastTickAt: iso, holdReason: "academia" }) }; continue; }
    const hired = ms(career.hiredAt);
    let worked = false;

    // 1) Verified work already scored elsewhere ("working" + distinct evidence), even if a later
    //    error in the same gap overwrote lastState: cyclesWorking only grows on verified work.
    const seen = Number.isSafeInteger(v.seenCyclesWorking) ? v.seenCyclesWorking! : career.cyclesWorking;
    if (career.cyclesWorking > seen && career.lastEvaluatedAt && ms(career.lastEvaluatedAt) >= hired) {
      worked = true;
      if (ms(career.lastEvaluatedAt) > ms(v.lastVerifiedWorkAt)) { v.lastVerifiedWorkAt = career.lastEvaluatedAt; v.lastVerifiedLabel = "Trabajo verificado registrado en su carrera"; }
    }
    v.seenCyclesWorking = career.cyclesWorking;
    // 2) Caller evidence that no other rule scored: one recovery per cycle, each receipt once.
    const fresh = (evidenceBy.get(agentId) || [])
      .filter(item => ms(item.at) >= hired && !v.creditedIds.includes(item.id) && (!v.lastCreditedAt || ms(item.at) >= ms(v.lastCreditedAt)))
      .sort((a, b) => ms(a.at) - ms(b.at) || a.id.localeCompare(b.id));
    if (fresh.length) {
      worked = true;
      const latest = fresh[fresh.length - 1];
      const before = career.battery;
      if (fresh.some(item => !item.clockOnly)) career.battery = Math.min(BATTERY_MAX, career.battery + VITALITY_RECOVERY);
      v.creditedIds = [...v.creditedIds, ...fresh.map(item => item.id)].slice(-MAX_CREDITED_IDS);
      v.lastCreditedAt = latest.at;
      if (ms(latest.at) > ms(v.lastVerifiedWorkAt)) { v.lastVerifiedWorkAt = latest.at; v.lastVerifiedLabel = latest.label.slice(0, 140); }
      if (career.battery !== before) { career.memory = remember(career.memory, iso, `Recupera vida: ${latest.label.slice(0, 100)} (+${career.battery - before}).`); recovered.push(agentId); }
    }
    // Verified work repays the inactivity debt: from here a 0 is again the agent's own record.
    if (worked) v.decayDebt = 0;
    // 3) Cadence clock: latest of verified work, any evaluated outcome (an error already cost vida
    //    in that window), hire, first sight, the end of a hold, or the end of office downtime.
    const anchor = Math.max(ms(v.anchorAt), ms(v.lastVerifiedWorkAt), ms(career.lastEvaluatedAt), hired);
    if (anchor > ms(v.anchorAt)) v = { ...v, anchorAt: new Date(anchor).toISOString(), missesApplied: 0 };
    if (kong && input.kong) {
      // KONG turns are scored from the snapshot (missed nextRunAt = -3 once): no cadence decay here.
      const k = input.kong;
      const hold = !k.observed ? KONG_UNREAD_HOLD : k.holds[agentId] ?? (k.agents.includes(agentId) ? undefined : "ya no aparece en el estado de KONG");
      v = { ...v, anchorAt: iso, missesApplied: 0, holdReason: hold ? hold.slice(0, 120) : undefined };
      if (k.observed) {
        const blocker = k.blockers[agentId];
        v.kongBlocker = blocker ? (v.kongBlocker?.key === blocker.key ? v.kongBlocker : { key: blocker.key.slice(0, 80), label: blocker.label.slice(0, 140), since: iso }) : undefined;
      }
    } else {
      const hold = input.holds?.[agentId];
      const downtime = v.lastTickAt !== undefined && input.now - ms(v.lastTickAt) > cadence!;
      if (hold || downtime) {
        v = { ...v, anchorAt: iso, missesApplied: 0, holdReason: hold ? hold.slice(0, 120) : undefined };
      } else {
        if (v.holdReason) v = { ...v, holdReason: undefined };
        const missed = Math.max(0, Math.floor((input.now - ms(v.anchorAt)) / cadence!));
        // At most one window per tick: a backlog is never charged at once.
        if (missed > v.missesApplied) {
          const before = career.battery;
          career.battery = Math.max(0, career.battery - VITALITY_MISS.battery);
          career.points = Math.max(0, career.points - VITALITY_MISS.points);
          v.missesApplied += 1;
          if (before !== career.battery) {
            v.decayDebt = (v.decayDebt || 0) + (before - career.battery);
            if (career.battery === 0) v.zeroByDecay = iso;
            career.memory = remember(career.memory, iso, `Sin entregable verificado en ${Math.round(cadence! / HOUR_MS)} h: -${before - career.battery} de vida.`);
            decayed.push(agentId);
          }
        }
      }
    }
    // Verified work or any vida above 0 ends the inactivity protection: a later 0 is the agent's own record.
    if (worked || career.battery > 0) v.zeroByDecay = undefined;
    v.lastTickAt = iso;
    // 4) Vida 0: flag once for the CEO/Robert. Never fired, replaced or deleted from here.
    if (career.battery === 0 && !v.flaggedAt) {
      v.flaggedAt = iso;
      flagged.push(agentId);
      events = [{ at: iso, text: `Vida en cero: ${name} (${career.nickname}) necesita revision del CEO/Robert. No se borra ni se reemplaza automaticamente.` }, ...events];
    } else if (career.battery > 0 && v.flaggedAt) {
      v.flaggedAt = undefined;
    }
    careers[agentId] = { ...career, vitality: clean(v) };
  }
  return { state: { ...company, careers, events: events.slice(0, MAX_EVENTS) }, flagged, recovered, decayed };
}

/** Public view of a career: drops the receipt-id ledger (internal dedupe state, payload size). */
export function publicCareerVitality(company: CompanyState): CompanyState {
  const careers = Object.fromEntries(Object.entries(company.careers).map(([id, career]) => {
    if (!career.vitality) return [id, career];
    const { creditedIds: _ids, proposedKeys: _keys, seenCyclesWorking: _seen, ...rest } = career.vitality;
    return [id, { ...career, vitality: rest as CareerVitality }];
  }));
  return { ...company, careers };
}

export type VitalityState = "trabajando" | "al_dia" | "atrasado" | "en_espera" | "en_academia" | "vida_cero" | "sin_entregable" | "sin_puntuar" | "sin_carrera";
export type VitalityRow = {
  agentId: string; name: string; group: string; state: VitalityState; label: string;
  vida: number | null; points: number | null; generation: number | null;
  cadenceHours: number | null; lastVerifiedWorkAt: string | null; lastVerifiedLabel: string | null;
  nextLossAt: string | null; flagged: boolean; learned: string[];
};

export function vitalityGroup(agentId: string): string {
  if (CLIPPERS_IDS.has(agentId)) return "Clippers / Orquesta";
  if (FACTORY_IDS.has(agentId)) return "Fábrica de software";
  if (agentId.startsWith("news")) return "Noticias";
  if (agentId.startsWith("blackroom") || agentId.startsWith("br-")) return "Black Room";
  if (["skills-scout", "agent-factory", "mechanic"].includes(agentId)) return "Consejo";
  if (agentId.startsWith("specialist:")) return "Academia";
  if (isKongSnapshotAgent(agentId)) return "KONG";
  return "Oficina";
}

/** Read-only roster of every registered main-company agent with its vida and real state. */
export function vitalityView(company: CompanyState | undefined, input: { now: number; names: Record<string, string>; exempt?: string[]; workingWindowMs?: number }): VitalityRow[] {
  const ids = [...new Set([...Object.keys(input.names), ...Object.keys(company?.careers || {})])].filter(id => !isKong(id) || isKongSnapshotAgent(id));
  return ids.map((agentId): VitalityRow => {
    const name = input.names[agentId] || agentId;
    const career = company?.careers[agentId];
    const cadence = vitalityCadenceMs(agentId);
    const group = vitalityGroup(agentId);
    const base = { agentId, name, group, cadenceHours: cadence === null ? null : Math.round(cadence / HOUR_MS) };
    if (!career) return { ...base, state: "sin_carrera", label: "Registrado; aún sin carrera ni entregables verificados", vida: null, points: null, generation: null, lastVerifiedWorkAt: null, lastVerifiedLabel: null, nextLossAt: null, flagged: false, learned: [] };
    const v = parseVitality(career.vitality);
    const last = v?.lastVerifiedWorkAt || (career.lastState === "working" ? career.lastEvaluatedAt : undefined) || null;
    const learned = (career.skills || []).slice(0, 4).map(skill => skill.title);
    const common = { ...base, vida: career.battery, points: career.points, generation: career.generation, lastVerifiedWorkAt: last, lastVerifiedLabel: v?.lastVerifiedLabel || null, learned };
    if (isKongSnapshotAgent(agentId)) {
      // KONG turn = KONG's own schedule: measured agents lose vida only for a missed nextRunAt or a recorded failure.
      if (career.inTrainingUntilGeneration) return { ...common, state: "en_academia", label: "En la academia: estudia, no pierde vida", nextLossAt: null, flagged: false };
      if (career.battery === 0) return { ...common, state: "vida_cero", label: "Vida en cero: revisión del CEO/Robert pendiente (no se borra)", nextLossAt: null, flagged: true };
      if (last && input.now - ms(last) <= 26 * HOUR_MS) return { ...common, state: "trabajando", label: "Entregó trabajo verificado en KONG recientemente", nextLossAt: null, flagged: false };
      if (v?.holdReason) return { ...common, state: "en_espera", label: `En espera (${v.holdReason}): no pierde vida`, nextLossAt: null, flagged: false };
      if (career.lastState === "error" && input.now - ms(career.lastEvaluatedAt) <= 26 * HOUR_MS) return { ...common, state: "atrasado", label: "Turno de KONG vencido o con falla registrada: pierde vida", nextLossAt: null, flagged: false };
      return { ...common, state: "al_dia", label: "Medido por su turno programado en KONG; sin entrega nueva todavía", nextLossAt: null, flagged: false };
    }
    if (input.exempt?.includes(agentId)) return { ...common, state: "sin_puntuar", label: "Pausado, externo o sin trabajo propio: no gana ni pierde vida", nextLossAt: null, flagged: false };
    if (cadence === null) return { ...common, state: "sin_entregable", label: "Coordina, observa o aún no tiene una fuente de entregables verificables: no pierde vida por inactividad", nextLossAt: null, flagged: false };
    if (career.inTrainingUntilGeneration) return { ...common, state: "en_academia", label: "En la academia: estudia, no pierde vida", nextLossAt: null, flagged: false };
    if (career.battery === 0) return { ...common, state: "vida_cero", label: "Vida en cero: revisión del CEO/Robert pendiente (no se borra)", nextLossAt: null, flagged: true };
    if (v?.holdReason) return { ...common, state: "en_espera", label: `En espera (${v.holdReason}): no pierde vida`, nextLossAt: null, flagged: false };
    const anchor = Math.max(ms(v?.anchorAt), ms(last || undefined), ms(career.hiredAt));
    const nextLoss = anchor + ((v?.missesApplied || 0) + 1) * cadence;
    const workingWindow = input.workingWindowMs ?? Math.min(cadence, 26 * HOUR_MS);
    if (last && input.now - ms(last) <= workingWindow) return { ...common, state: "trabajando", label: "Entregó trabajo verificado recientemente", nextLossAt: new Date(nextLoss).toISOString(), flagged: false };
    if ((v?.missesApplied || 0) > 0 || input.now - anchor > cadence) return { ...common, state: "atrasado", label: "Sin entregable verificado en su turno: pierde vida", nextLossAt: new Date(nextLoss).toISOString(), flagged: false };
    return { ...common, state: "al_dia", label: last ? "Dentro de su turno; sin entrega nueva todavía" : "Dentro de su primer turno; sin entrega verificada todavía", nextLossAt: new Date(nextLoss).toISOString(), flagged: false };
  }).sort((a, b) => a.group.localeCompare(b.group) || (a.vida ?? 101) - (b.vida ?? 101) || a.agentId.localeCompare(b.agentId));
}

const REPAIR_OPEN = ["pending_submit", "submitted", "not_submitted", "approved"];
const FLAG_COOLDOWN_MS = 7 * 24 * HOUR_MS;
type Proposal = import("./agent-council").CouncilProposal;
const VIDA_KEY = /^repair:(.+)#vida-cero-g(\d+)-/;

/**
 * Vida 0 -> one owner review in the Trust Center (pending_actions), reusing the Mechanic's
 * "repair" proposal shape, its per-agent key prefix and its open-repair cap, so the two never
 * duplicate each other. `proposals` must include everything already created this round.
 * The cooldown is stamped on the career (proposal history is pruned). Approval only marks the
 * PR-first brief as ready; nothing is fired, replaced or deleted.
 */
export function deriveVitalityFlagProposals(company: CompanyState, proposals: Proposal[], now: number, names: Record<string, string> = {}, exempt: string[] = [], maxOpenRepairs = 3): { proposals: Proposal[]; company: CompanyState } {
  const iso = new Date(now).toISOString();
  const created: Proposal[] = [];
  let careers = company.careers;
  const all = () => [...proposals, ...created];
  const openRepairs = () => all().filter(p => p.kind === "repair" && REPAIR_OPEN.includes(p.status)).length;
  for (const career of Object.values(company.careers).sort((a, b) => a.agentId.localeCompare(b.agentId))) {
    const v = parseVitality(career.vitality);
    if (!v?.flaggedAt || career.battery !== 0 || isKong(career.agentId) || exempt.includes(career.agentId) || career.inTrainingUntilGeneration) continue;
    if (openRepairs() >= maxOpenRepairs) break;
    if (v.flagProposedAt && now - ms(v.flagProposedAt) < FLAG_COOLDOWN_MS) continue;
    const prefix = `repair:${career.agentId}#`;
    if (all().some(p => p.key.startsWith(prefix) && (REPAIR_OPEN.includes(p.status) || now - ms(p.closedAt || p.createdAt) < FLAG_COOLDOWN_MS))) continue;
    const name = names[career.agentId] || career.agentId;
    const evidence = [`Vida 0/100 desde ${v.flaggedAt}`, v.lastVerifiedWorkAt ? `Último entregable verificado: ${v.lastVerifiedWorkAt}` : "Sin entregable verificado registrado", `Turno esperado: ${Math.round((vitalityCadenceMs(career.agentId) || 0) / HOUR_MS)} h`];
    created.push({
      key: `${prefix}vida-cero-g${career.generation}-${iso.slice(0, 10)}`, kind: "repair", owner: "ceo",
      title: `Vida en cero: revisar a ${name}`,
      description: `${name} (${career.nickname}) se quedó sin vida porque no entregó trabajo verificado en sus turnos. El CEO pide tu revisión: reparar, reasignar o pausar. No se borra ni se reemplaza automáticamente.`,
      evidence,
      handoffBrief: [
        `Tarea BlackOps (PR-first, costo $0 de API): Revisar el agente ${name} (vida 0)`, "",
        `Objetivo: averigua por qué ${name} no produce entregables verificados y corrige la causa (configuración, conexión o código) sin inventar datos.`, "",
        "Evidencia:", ...evidence.map(line => `- ${line}`), "",
        "Reglas:", "- Trabaja en una rama nueva y abre PR; no hagas merge ni deploy.", "- Si falta una credencial o cuenta, dilo en vez de simularla.", "- Sin gasto de API.",
      ].join("\n"),
      createdAt: iso, status: "pending_submit",
    });
    careers = { ...careers, [career.agentId]: { ...career, vitality: clean({ ...v, flagProposedAt: iso }) } };
  }
  return { proposals: created, company: careers === company.careers ? company : { ...company, careers } };
}

/** An unsubmitted vida-0 review whose agent recovered or was replaced no longer applies: close it. */
export function closeStaleVitalityFlags(proposals: Proposal[], company: CompanyState, now: number): Proposal[] {
  const iso = new Date(now).toISOString();
  return proposals.map(p => {
    const match = p.key.match(VIDA_KEY);
    if (!match || !["pending_submit", "not_submitted", "submitted"].includes(p.status)) return p;
    const career = company.careers[match[1]];
    if (career && career.generation === Number(match[2]) && career.battery === 0) return p;
    return { ...p, status: "withdrawn" as const, closedAt: iso, note: career && career.generation === Number(match[2]) ? "Ya no aplica: el agente recuperó vida con trabajo verificado." : "Ya no aplica: el puesto cambió de generación." };
  });
}

/** Office desk status from a vitality row. Recent verified work is "on duty", never "executing now". */
export function vitalityLiveStatus(row: VitalityRow | undefined, now: number): AgentLiveStatus {
  if (!row) return { state: "checking", label: "Verificando..." };
  const vida = row.vida === null ? "" : ` · vida ${row.vida}/100`;
  if (row.state === "trabajando" && row.lastVerifiedWorkAt) return onDutyStatus({ lastWorkAt: row.lastVerifiedWorkAt, now, extra: `${row.lastVerifiedLabel || "entregable verificado"}${vida}` });
  if (row.state === "en_espera") return { state: "needs-setup", label: row.label, detail: `Sin pérdida de vida mientras espera${vida}` };
  if (row.state === "vida_cero") return { state: "available", label: "Vida 0: revisión del CEO/Robert", detail: row.label, problems: ["Vida en cero: no entrega trabajo verificado"] };
  if (row.state === "atrasado") return { state: "available", label: `Perdiendo vida${vida}`, detail: row.label, problems: ["Sin entregable verificado en su turno"] };
  return { state: "available", label: `${row.label}${vida}` };
}
