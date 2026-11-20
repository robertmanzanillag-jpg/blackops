// Automejora + Clippers academy, on top of the state that already exists ($0, no AI, no IO).
//
// 1) Evidence feeds for the vida rule (shared/agent-vitality.ts) that no other path scores:
//    - office role-work jobs completed with an artifact (officeExecution.roleWork);
//    - the cloud streamer lane (agent_council_state `clippers-streamers:<owner>`): discovery
//      runs, rendered/checked clips, Metricool-confirmed schedules, Metricool observations and
//      learning evaluations. Missing secrets/credentials become holds (no loss), never credit.
// 2) Clippers academy: lessons from measured Metricool performance (hook/caption variant per
//    destination, creators above/below the destination median), produced by
//    script/clippers-streamer-cloud-learning.mjs. Lessons become "academia" skills on the
//    agent that owns that decision, so each agent records what it learned.
// 3) Automejora proposals: a supported lesson, or a diagnostic that keeps repeating in an
//    agent's own daily work, becomes ONE council "lesson" proposal. It goes to the Trust Center
//    (pending_actions) and changes nothing until Robert approves; approval only records the
//    improvement as a skill. Bounded: at most 3 open at once, one per key.

import { addSkill, isKongSnapshotAgent, type CompanyState } from "./agent-company";
import type { CouncilProposal } from "./agent-council";
import { CLIPPERS_MEASURED, DAILY_ROLE_WORK_ROLES, INTERNAL_WORK_ROLES, type VitalityEvidence } from "./agent-vitality";
import { FACTORY_AGENTS } from "./factory-office-agents";
import { BLACKROOM_TEAM } from "./blackroom-team";

const ms = (value: unknown) => { const n = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(n) ? n : 0; };
const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const SAFE = /^[\w.:@\/-]{1,160}$/;

type RoleWorkLike = { id?: unknown; role?: unknown; status?: unknown; completedAt?: unknown; startedAt?: unknown; slot?: unknown; artifactId?: unknown; audit?: unknown; webAudit?: unknown };

/** Completed office role work with an artifact proof = verified output for that role. */
export function roleWorkVitalityEvidence(jobs: unknown): VitalityEvidence[] {
  if (!Array.isArray(jobs)) return [];
  return (jobs as RoleWorkLike[]).filter(job => job && job.status === "completed" && typeof job.artifactId === "string" && /^[a-f0-9]{64}$/.test(job.artifactId) && typeof job.role === "string" && ms(job.completedAt))
    .map(job => ({ id: `rolework:${job.artifactId}`, agentId: job.role as string, at: job.completedAt as string, label: "Trabajo diario de la oficina completado con artefacto" }));
}

const HOLD_WINDOW_MS = 30 * 3600_000;
type JobLike = { role?: unknown; status?: unknown; startedAt?: unknown };
function latestByRole(jobs: unknown): Map<string, JobLike> {
  const latest = new Map<string, JobLike>();
  if (!Array.isArray(jobs)) return latest;
  for (const job of jobs as JobLike[]) if (job && typeof job.role === "string" && (!latest.has(job.role) || ms(job.startedAt) >= ms(latest.get(job.role)!.startedAt))) latest.set(job.role, job);
  return latest;
}

/** Roles whose latest role-work job was blocked by a missing/invalid source: clock paused. */
export function roleWorkHolds(jobs: unknown, now: number): Record<string, string> {
  const holds: Record<string, string> = {};
  for (const [role, job] of latestByRole(jobs)) if (job.status === "blocked" && now - ms(job.startedAt) <= HOLD_WINDOW_MS) holds[role] = "fuente de datos ausente o sin registros";
  return holds;
}

/**
 * Agents whose pipeline is off, unassigned or unreadable never lose vida for inactivity: the
 * office downtime is not theirs. Data-driven (no env flags): a role with no job in ~30 h, a
 * vacant/unsupported seat, a factory with no stage this week, a Clippers lane with no state.
 */
export function pipelineHolds(input: {
  now: number; roleWorkJobs?: unknown; internalWorkJobs?: unknown; seats?: Record<string, { status?: string }>;
  factoryLedger?: unknown; streamerState?: unknown; streamerRead?: boolean; scoutLastRunAt?: string | null; scoutError?: string | null;
  /** Black Room outcomes (approvals, published posts, failures). No outcome in 72 h = a quiet period, not inactivity. */
  blackroomSignals?: Array<{ at?: string }>;
}): Record<string, string> {
  const holds: Record<string, string> = { ...roleWorkHolds(input.roleWorkJobs, input.now) };
  const recent = (job: JobLike | undefined) => Boolean(job && input.now - ms(job.startedAt) <= HOLD_WINDOW_MS);
  const roleWork = latestByRole(input.roleWorkJobs), internal = latestByRole(input.internalWorkJobs);
  for (const role of DAILY_ROLE_WORK_ROLES) {
    const seat = input.seats?.[role]?.status;
    if (seat === "vacant" || seat === "unsupported") holds[role] = "puesto vacante o sin adaptador de ejecución";
    else if (!recent(roleWork.get(role))) holds[role] ??= "trabajo diario de oficina apagado o sin turno asignado";
  }
  for (const role of INTERNAL_WORK_ROLES) if (!recent(internal.get(role))) holds[role] = "trabajo interno apagado o sin turno asignado";
  const ledger = isObj(input.factoryLedger) && Array.isArray(input.factoryLedger.processed) ? input.factoryLedger.processed : [];
  if (!ledger.some((entry: any) => isObj(entry) && input.now - ms(entry.completedAt) <= 7 * 24 * 3600_000)) for (const agent of FACTORY_AGENTS) holds[agent.id] = "la fábrica no tuvo etapas esta semana";
  const measured = CLIPPERS_MEASURED as readonly string[];
  if (input.streamerRead === false) for (const id of measured) holds[id] = "estado de Clippers no disponible";
  else {
    const raw = isObj(input.streamerState) ? input.streamerState : null;
    if (!raw || !isObj(raw.lastRun)) holds["clippers-streamers"] ??= "carril de streamers sin ejecuciones registradas";
    const c = raw && isObj(raw.cloudPublish) ? raw.cloudPublish : null;
    const last = c && isObj(c.lastRun) ? c.lastRun : null;
    if (!last || ["disabled", "kill_switch"].includes(last.status) || input.now - ms(last.at) > 7 * 24 * 3600_000)
      for (const id of measured.filter(id => id !== "clippers-streamers")) holds[id] ??= "publicador de Clippers en la nube apagado";
  }
  if (!input.scoutLastRunAt) holds["skills-scout"] = "sin primera revisión de releases";
  else if (input.scoutError) holds["skills-scout"] = "fallo de red o infraestructura al leer releases";
  if (!(input.blackroomSignals || []).some(signal => signal && input.now - ms(signal.at) <= 72 * 3600_000))
    for (const agent of BLACKROOM_TEAM) holds[agent.id] = "Black Room sin actividad registrada en 72 h";
  return holds;
}

const diagnosticsOf = (job: RoleWorkLike): string[] => {
  const pick = (a: unknown) => isObj(a) && Array.isArray(a.diagnostics) ? a.diagnostics.filter((d: unknown): d is string => typeof d === "string" && /^[A-Z0-9_]{2,60}$/.test(d)) : [];
  return [...new Set([...pick(job.audit), ...pick(job.webAudit)])];
};

/** Cloud streamer lane receipts and holds for the Clippers lane careers. */
export function streamerVitalityEvidence(raw: unknown, now: number): { evidence: VitalityEvidence[]; holds: Record<string, string> } {
  const evidence: VitalityEvidence[] = [], holds: Record<string, string> = {};
  if (!isObj(raw)) return { evidence, holds };
  const run = isObj(raw.lastRun) ? raw.lastRun : null;
  if (run && ms(run.at)) {
    const counts = isObj(run.counts) ? run.counts : {};
    if (["completed", "partial"].includes(run.status) && Number(counts.candidates) > 0) evidence.push({ id: `streamer-discovery:${run.at}`, agentId: "clippers-streamers", at: run.at, label: `Descubrimiento de streamers: ${Number(counts.candidates)} candidatos` });
    if (["skipped_missing_secrets", "held_credentials"].includes(run.status)) holds["clippers-streamers"] = "faltan credenciales de Twitch/YouTube";
  }
  const c = isObj(raw.cloudPublish) && raw.cloudPublish.version === 1 ? raw.cloudPublish : null;
  if (!c) return { evidence, holds };
  const last = isObj(c.lastRun) ? c.lastRun : null;
  if (last && ms(last.at)) {
    const counts = isObj(last.counts) ? last.counts : {};
    if (last.dryRun !== true && Number(counts.rendered) > 0) evidence.push({ id: `streamer-render:${last.at}`, agentId: "clippers-editor", at: last.at, label: `Clips renderizados: ${Number(counts.rendered)}` });
    if (last.dryRun !== true && Number(counts.scheduled) + Number(counts.blocked || 0) > 0) evidence.push({ id: `streamer-check:${last.at}`, agentId: "clippers-checker", at: last.at, label: "Revisión de crédito, política y destino antes de programar" });
    if (last.status === "held_missing_secrets") for (const id of ["clippers-editor", "clippers-checker", "clippers-publisher", "clippers-analytics"]) holds[id] = "faltan credenciales del publicador en la nube";
  }
  for (const post of Array.isArray(c.posts) ? c.posts.slice(-200) : []) {
    if (!isObj(post) || typeof post.id !== "string" || !SAFE.test(post.id)) continue;
    if (post.status === "scheduled" && typeof post.metricoolId === "string" && post.metricoolId) {
      const at = ms(post.attemptedAt) ? post.attemptedAt : last?.at;
      if (ms(at) && ms(at) <= now + 5_000) evidence.push({ id: `streamer-post:${post.id}`, agentId: "clippers-publisher", at, label: "Programación confirmada en Metricool" });
    }
    const obs = isObj(post.observation) ? post.observation : null;
    if (obs && Number.isSafeInteger(obs.views) && ms(obs.observedAt)) evidence.push({ id: `streamer-observation:${post.id}`, agentId: "clippers-analytics", at: obs.observedAt, label: `Métrica real de Metricool: ${obs.views} vistas` });
  }
  const learning = isObj(c.learning) ? c.learning : null;
  if (learning && ms(learning.evaluatedAt) && Number(learning.samples) >= 5) evidence.push({ id: `streamer-learning:${learning.evaluatedAt}`, agentId: "clippers-learning", at: learning.evaluatedAt, label: `Aprendizaje evaluado con ${Number(learning.samples)} publicaciones medidas` });
  return { evidence, holds };
}

export type ClippersLesson = {
  id: string; kind: "hook" | "creator"; agentIds: string[]; title: string; detail: string;
  supported: boolean; samples: number; evaluatedAt: string;
};

/** Academy lessons from measured Metricool performance (the cloud lane's own learning output). */
export function clippersAcademyLessons(raw: unknown): ClippersLesson[] {
  const c = isObj(raw) && isObj(raw.cloudPublish) ? raw.cloudPublish : null;
  const learning = c && isObj(c.learning) ? c.learning : null;
  if (!learning || !ms(learning.evaluatedAt)) return [];
  const evaluatedAt = learning.evaluatedAt as string;
  const lessons: ClippersLesson[] = [];
  for (const e of Array.isArray(learning.experiments) ? learning.experiments.slice(0, 30) : []) {
    if (!isObj(e) || typeof e.experimentId !== "string" || !SAFE.test(e.experimentId)) continue;
    const dest = e.experimentId.replace(/^streamer-hook:/, "");
    const variants = Array.isArray(e.variants) ? e.variants.filter(isObj) : [];
    const samples = variants.reduce((sum: number, v: any) => sum + (Number.isSafeInteger(v.samples) ? v.samples : 0), 0);
    if (e.winner && typeof e.winner === "string" && SAFE.test(e.winner)) {
      const lift = Number.isFinite(e.lift) ? Math.round(e.lift * 100) : null;
      lessons.push({ id: `clippers-hook:${dest}:${e.winner}`, kind: "hook", agentIds: ["clippers-editor", "clippers-learning"], supported: true, samples, evaluatedAt,
        title: `Hook/caption "${e.winner}" gana en ${dest}`, detail: `${lift !== null ? `+${lift}% de vistas medianas` : "Mejor mediana"} frente a la otra variante (${samples} publicaciones medidas en Metricool, ventana 24-48 h, sin caída de retención >10%).` });
    } else if (samples > 0) {
      lessons.push({ id: `clippers-hook:${dest}:pending`, kind: "hook", agentIds: ["clippers-learning"], supported: false, samples, evaluatedAt,
        title: `Prueba A/B de hook en ${dest}`, detail: `Aún sin ganador (${String(e.reason || "insufficient_samples").replace(/[^a-z_]/g, "")}); se necesitan ≥5 publicaciones medidas por variante y ≥20% de mejora.` });
    }
  }
  const observedByCreator = new Map<string, number>();
  for (const post of Array.isArray(c!.posts) ? c!.posts : []) if (isObj(post) && typeof post.creatorKey === "string" && isObj(post.observation) && Number.isSafeInteger(post.observation.views))
    observedByCreator.set(post.creatorKey, (observedByCreator.get(post.creatorKey) || 0) + 1);
  const boosts = isObj(learning.creatorBoost) ? Object.entries(learning.creatorBoost).filter(([k, v]) => SAFE.test(k) && Number.isFinite(v)) as Array<[string, number]> : [];
  for (const [creator, boost] of boosts.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)) {
    if (Math.abs(boost) < 0.3) continue;
    lessons.push({ id: `clippers-creator:${creator}:${boost > 0 ? "up" : "down"}`, kind: "creator", agentIds: ["clippers-streamers", "clippers-learning"], supported: true, samples: observedByCreator.get(creator) ?? 0, evaluatedAt,
      title: `${boost > 0 ? "Priorizar" : "Bajar prioridad de"} ${creator}`, detail: `Sus clips rinden ${boost > 0 ? "por encima" : "por debajo"} de la mediana de su destino (impulso ${boost > 0 ? "+" : ""}${boost}, ${observedByCreator.get(creator) ?? "≥3"} publicaciones medidas).` });
  }
  return lessons;
}

/** Supported lessons become "academia" skills of the agents that own the decision (once each). */
export function learnClippersLessons(company: CompanyState, lessons: ClippersLesson[], now: number): CompanyState {
  const iso = new Date(now).toISOString();
  let careers = company.careers;
  for (const lesson of lessons) {
    if (!lesson.supported) continue;
    for (const agentId of lesson.agentIds) {
      const career = careers[agentId];
      const skillId = `academia:${lesson.id}`;
      if (!career || career.inTrainingUntilGeneration || (career.skills || []).some(skill => skill.id === skillId)) continue;
      careers = { ...careers, [agentId]: { ...addSkill(career, { id: skillId, title: `Aprendió: ${lesson.title}`.slice(0, 80), source: "academia" }, iso),
        memory: [{ at: iso, text: `Academia Clippers: ${lesson.title}. ${lesson.detail}`.slice(0, 220) }, ...career.memory].slice(0, 12) } };
    }
  }
  return careers === company.careers ? company : { ...company, careers };
}

const DIAGNOSTIC_HINTS: Record<string, string> = {
  PR_STALE: "cerrar o actualizar los PR estancados", PR_CONFLICTED: "resolver los PR en conflicto", PR_FAILING_CHECKS: "arreglar los checks que fallan",
  STALE_REPOSITORY: "revisar los repositorios sin actividad", SOURCE_STALE: "refrescar su fuente de datos", SOURCE_MISSING: "conectar su fuente de datos",
  NO_SOURCE_RECORDS: "cargar los registros que audita", RECORDED_FAILURE: "corregir la causa de los fallos registrados", RECORDED_BLOCKS: "desbloquear lo que queda bloqueado",
  PLANS_NOT_EXECUTION: "convertir planes en ejecución verificable", COLLECTED_METRICS_ONLY: "cerrar el ciclo de métricas a decisiones", DOCUMENT_REVIEW_REQUIRED: "completar la revisión documental",
};
export const MAX_OPEN_SELF_IMPROVEMENT = 3;
export const SELF_IMPROVEMENT_PREFIX = "automejora:";
const OPEN = ["pending_submit", "submitted", "not_submitted", "approved"];
const COOLDOWN_MS = 14 * 24 * 3600_000;
const brief = (title: string, goal: string, evidence: string[]) => [
  `Tarea BlackOps (PR-first, costo $0 de API): ${title}`, "", `Objetivo: ${goal}`, "", "Evidencia:", ...evidence.map(line => `- ${line}`), "",
  "Reglas:", "- Trabaja en una rama nueva y abre PR; no hagas merge ni deploy.", "- Corre npm run check, npm run build y el test relacionado.",
  "- Sin gasto de API ni publicaciones externas sin aprobación de Robert.", "- Responde con: archivos cambiados, pruebas corridas y riesgos.",
].join("\n");

/**
 * Self-improvement proposals (owner approval required). Sources: supported Clippers lessons and
 * diagnostics repeated on >= 3 distinct days in an agent's own role work during the last 7 days.
 */
export function deriveSelfImprovementProposals(input: {
  proposals: CouncilProposal[]; lessons: Array<{ key: string }>; roleWorkJobs?: unknown; clippersLessons?: ClippersLesson[]; now: number; names: Record<string, string>; exempt?: string[];
  /** Cooldowns stamped on careers survive proposal pruning (see stampSelfImprovementCooldowns). */
  company?: CompanyState;
}): CouncilProposal[] {
  const iso = new Date(input.now).toISOString();
  const created: CouncilProposal[] = [];
  const all = () => [...input.proposals, ...created];
  const openCount = () => all().filter(p => p.key.startsWith(SELF_IMPROVEMENT_PREFIX) && OPEN.includes(p.status)).length;
  const stamped = (agentId: string, key: string) => {
    const at = (input.company?.careers[agentId]?.vitality as { proposedKeys?: Record<string, string> } | undefined)?.proposedKeys?.[key];
    return Boolean(at && input.now - ms(at) < COOLDOWN_MS);
  };
  const blocked = (key: string) => input.lessons.some(lesson => lesson.key === key) || all().some(p => p.key === key && (OPEN.includes(p.status) || input.now - ms(p.closedAt || p.createdAt) < COOLDOWN_MS));
  const nameOf = (id: string) => input.names[id] || id;
  const push = (agentId: string, key: string, title: string, description: string, evidence: string[], goal: string, label: string, handoffBrief = brief(title, goal, evidence)) => {
    if (openCount() >= MAX_OPEN_SELF_IMPROVEMENT || blocked(key) || stamped(agentId, key) || input.exempt?.includes(agentId) || !input.names[agentId]) return;
    created.push({ key, kind: "lesson", owner: agentId, title, description, evidence, handoffBrief, createdAt: iso, status: "pending_submit",
      lesson: { ruleId: key, subject: agentId, label } });
  };
  for (const lesson of input.clippersLessons || []) {
    if (!lesson.supported) continue;
    const agentId = lesson.agentIds[0];
    push(agentId, `${SELF_IMPROVEMENT_PREFIX}${lesson.id}`, `Automejora de ${nameOf(agentId)}: ${lesson.title}`,
      `${nameOf(agentId)} aprendió de Metricool: ${lesson.detail} Si apruebas, queda como regla aprendida y el brief PR-first listo para fijarla.`,
      [lesson.title, lesson.detail, `Evaluado: ${lesson.evaluatedAt}`], `Fijar como regla de ${nameOf(agentId)}: ${lesson.title}. Mantener 20% de exploración y el crédito al creador.`, lesson.title);
  }
  if (Array.isArray(input.roleWorkJobs)) {
    const days = new Map<string, Set<string>>();
    for (const job of input.roleWorkJobs as RoleWorkLike[]) {
      if (!job || typeof job.role !== "string" || input.now - ms(job.startedAt) > 7 * 24 * 3600_000 || !["completed", "blocked"].includes(String(job.status))) continue;
      const day = typeof job.slot === "string" ? job.slot : String(job.startedAt).slice(0, 10);
      for (const code of diagnosticsOf(job)) { const k = `${job.role}|${code}`; days.set(k, new Set([...(days.get(k) || []), day])); }
    }
    for (const [k, set] of [...days.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))) {
      if (set.size < 3) continue;
      const [agentId, code] = k.split("|");
      const hint = DIAGNOSTIC_HINTS[code] || `resolver el diagnóstico ${code}`;
      push(agentId, `${SELF_IMPROVEMENT_PREFIX}${agentId}:${code}`, `Automejora de ${nameOf(agentId)}: ${hint}`,
        `${nameOf(agentId)} encontró ${code} en su propio trabajo ${set.size} días distintos esta semana y propone ${hint}. No cambia nada hasta que lo apruebes.`,
        [`Diagnóstico repetido: ${code}`, `Días: ${[...set].sort().join(", ")}`], `Que ${nameOf(agentId)} deje de repetir ${code}: ${hint}. Sin inventar datos; si falta una conexión, dilo.`, `Mejora: ${hint}`);
    }
  }
  // KONG agents: the same blocker reported by KONG's own snapshot for >= 3 days becomes ONE proposal.
  // Proposal only: approving it records the lesson as a skill of that career in BlackOps. Nothing is
  // sent to or changed in KONG (see kongImprovementApplyHook for the out-of-scope phase 3).
  for (const career of Object.values(input.company?.careers || {}).sort((a, b) => a.agentId.localeCompare(b.agentId))) {
    const blocker = career.vitality?.kongBlocker;
    if (!isKongSnapshotAgent(career.agentId) || !blocker || career.inTrainingUntilGeneration || input.now - ms(blocker.since) < KONG_BLOCKER_DAYS * 24 * 3600_000) continue;
    const agentId = career.agentId;
    const days = Math.floor((input.now - ms(blocker.since)) / (24 * 3600_000));
    const title = `Automejora de ${nameOf(agentId)}: resolver el bloqueo que KONG repite`;
    const evidence = [`KONG reporta el mismo bloqueo desde ${blocker.since} (${days} días)`, `Bloqueo: ${blocker.label}`];
    push(agentId, `${SELF_IMPROVEMENT_PREFIX}kong:${agentId}:${keyHash(blocker.key)}`, title,
      `${nameOf(agentId)} lleva ${days} días con el mismo bloqueo en KONG. Propuesta solamente: si apruebas, queda como lección aprendida en su carrera. No cambia nada en KONG.`,
      evidence, `Resolver en KONG el bloqueo repetido de ${nameOf(agentId)}.`, `Bloqueo repetido en KONG: ${blocker.label}`.slice(0, 140),
      [`Propuesta de automejora para un agente de KONG (solo lectura, $0): ${title}`, "", "Evidencia:", ...evidence.map(line => `- ${line}`), "",
        "Reglas:", "- Aprobar solo registra la lección en la carrera del agente dentro de BlackOps.", "- BlackOps no cambia KONG: aplicar la mejora en KONG es un paso aparte (fase 3) con su propio PR en el repo de KONG y aprobación de Robert."].join("\n"));
  }
  return created;
}
/** Days the same KONG blocker must repeat before an automejora proposal. */
export const KONG_BLOCKER_DAYS = 3;
const keyHash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
/**
 * TODO(fase 3, fuera de alcance): aplicar en KONG una automejora aprobada de un agente de KONG
 * (orden por /api/admin/ceo/office-orders o PR en el repo de KONG, siempre con aprobación de Robert).
 * Hoy es un no-op deliberado: BlackOps solo propone y registra la lección; nunca cambia KONG.
 */
export function kongImprovementApplyHook(_proposal: CouncilProposal): { applied: false; reason: string } {
  return { applied: false, reason: "Fase 3 pendiente: BlackOps no aplica cambios en KONG." };
}

/** Records each new automejora key on its owner's career, so the 14-day cooldown outlives pruned history. */
export function stampSelfImprovementCooldowns(company: CompanyState, created: CouncilProposal[], now: number): CompanyState {
  const iso = new Date(now).toISOString();
  let careers = company.careers;
  for (const proposal of created) {
    if (!proposal.key.startsWith(SELF_IMPROVEMENT_PREFIX)) continue;
    const career = careers[proposal.owner];
    if (!career?.vitality) continue;
    const keys = Object.entries({ ...(career.vitality.proposedKeys || {}), [proposal.key]: iso }).slice(-20);
    careers = { ...careers, [proposal.owner]: { ...career, vitality: { ...career.vitality, proposedKeys: Object.fromEntries(keys) } } };
  }
  return careers === company.careers ? company : { ...company, careers };
}
