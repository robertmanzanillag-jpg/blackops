// BlackOps as a company: careers, points, battery, academy, CEO orders and personalities.
//
// Pure and deterministic ($0, no AI). The server runs `advanceCompany` once per council cycle
// with every agent's REAL status, and Robert's orders/feedback through the CEO channel.
// Points require a distinct verified execution, or an order closed with verified evidence.
// Availability, manual completion and repeated observations never score. A "fired" agent is
// replaced by a new hire that trains in the academy, and the Mechanic opens a repair proposal.

import type { AgentLiveState } from "./agent-live-status";

export type Personality = { nickname: string; traits: string[]; motto: string };

export type MemoryEntry = { at: string; text: string };

export type CareerScoreReconciliation = {version:1;status:"needs_scope_qualification";recordId:string;originalCareerDigest:string};

export type AgentCareer = {
  scoreReconciliation?: CareerScoreReconciliation;
  agentId: string;
  generation: number;
  nickname: string;
  points: number;
  battery: number;
  lastState: AgentLiveState | null;
  cyclesWorking: number;
  cyclesTotal: number;
  ordersDone: number;
  firedCount: number;
  hiredAt: string;
  memory: MemoryEntry[];
  inTrainingUntilGeneration?: number;
  // Skills earned from real work: graduating, orders closed with evidence, council lessons.
  skills?: AgentSkill[];
  reviewGuidance?: string[];
  lastEvaluatedAt?: string;
  evaluatedEvidenceIds?: string[];
  lastEvidenceId?: string;
  /** Quality signals already scored (approved/rejected posts, failed jobs...), so each counts once. */
  qualitySignalIds?: string[];
};

export type SkillSource = "academia" | "orden" | "leccion";
export type AgentSkill = { id: string; title: string; source: SkillSource; earnedAt: string; uses: number };
const MAX_SKILLS = 12;

/** Adds a skill, or counts one more use of a skill the agent already has. */
export function addSkill(career: AgentCareer, skill: { id: string; title: string; source: SkillSource }, at: string): AgentCareer {
  const skills = career.skills || [];
  const existing = skills.find((item) => item.id === skill.id);
  const next = existing
    ? skills.map((item) => (item.id === skill.id ? { ...item, uses: item.uses + 1 } : item))
    : [{ ...skill, earnedAt: at, uses: 1 }, ...skills];
  return { ...career, skills: next.sort((a, b) => b.uses - a.uses || b.earnedAt.localeCompare(a.earnedAt)).slice(0, MAX_SKILLS) };
}

export type Trainee = {
  id: string;
  forAgentId: string;
  role: string;
  nickname: string;
  startedAt: string;
  modulesDone: string[];
  knowledge: string[];
  graduatedAt?: string;
  evaluationClosedAt?: string;
  qualifiedAt?: string;
  purpose?: "incumbent" | "candidate";
  generation?: number;
  awaitingEvidence?: boolean;
  assessments?: AcademyAssessment[];
  executionBlocker?: string;
  curriculumSnapshot?: CurriculumModule[];

  // Tailored modules completed (id + title), turned into skills at graduation.
  learned?: Array<{ id: string; title: string }>;
};

/** Ids of agents created by the academy for a recurring kind of work ("Especialista en ..."). */
export const SPECIALIST_PREFIX = "specialist:";

/** One spelling for a topic everywhere: proposal key, specialist id, routing and curriculum. */
export function topicSlug(topic: string): string {
  return topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "general";
}
export function specialistIdFor(topic: string): string {
  return `${SPECIALIST_PREFIX}${topicSlug(topic)}`;
}
export function isSpecialistId(id: string): boolean {
  return id.startsWith(SPECIALIST_PREFIX);
}
/** "specialist:black-room" -> "black room". */
export function specialistTopicLabel(id: string): string {
  return id.slice(SPECIALIST_PREFIX.length).replace(/-/g, " ");
}


// Only trusted execution adapters may supply these records. Reading curriculum is not evidence.
export type AcademyAssessment = {
  scope?: "fixture" | "production" | "benchmark";
  profileId?: string;
  profileVersion?: string;
  runId: string;
  benchmarkId: string;
  curriculumVersion: string;
  completedAt: string;
  artifactId: string;
  passed: boolean;
  quality: number;
  incumbentQuality: number;
  errors: number;
  incumbentErrors: number;
  durationMs: number;
  incumbentDurationMs: number;
  cost: number;
  incumbentCost: number;
  costBasis?: "subscription_no_incremental_api_charge" | "measured_tokens_not_usd";
  artifacts?: { assignmentId: string; curriculumVersion: string; fixtureId: string; fixtureCode: string; incumbentText: string; candidateText: string; incumbentSessionId: string; candidateSessionId: string; profileId?: string; profileVersion?: string;
    incumbentPolicyVersion?: string; candidatePolicyVersion?: string; candidateMeasuredCost?: number; incumbentMeasuredCost?: number;
    candidateDurationMs?: number; incumbentDurationMs?: number; costBasis?: AcademyAssessment["costBasis"]; incumbentModel?: string; candidateModel?: string; provider?: string };
};

function validAssessment(a: unknown): a is AcademyAssessment {
  if (!a || typeof a !== "object") return false;
  const v = a as AcademyAssessment;
  return [v.runId, v.benchmarkId, v.curriculumVersion, v.artifactId].every(s => typeof s === "string" && s.trim().length > 0) &&
    typeof v.passed === "boolean" && typeof v.completedAt === "string" && Number.isFinite(Date.parse(v.completedAt)) &&
    [v.quality, v.incumbentQuality, v.errors, v.incumbentErrors, v.durationMs, v.incumbentDurationMs, v.cost, v.incumbentCost]
      .every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) && v.quality <= 100 && v.incumbentQuality <= 100;
}

export function recordAcademyAssessment(state: CompanyState, traineeId: string, assessment: AcademyAssessment): CompanyState {
  const trainee = state.trainees.find(t => t.id === traineeId && !t.graduatedAt && !t.evaluationClosedAt);
  if (!validAssessment(assessment)) return state;
  const values = [assessment.quality, assessment.incumbentQuality, assessment.errors, assessment.incumbentErrors,
    assessment.durationMs, assessment.incumbentDurationMs, assessment.cost, assessment.incumbentCost];
  if (!trainee || !validAssessment(assessment) || !assessment.runId || !assessment.benchmarkId || !assessment.curriculumVersion || !assessment.artifactId ||
      !Number.isFinite(Date.parse(assessment.completedAt)) || Date.parse(assessment.completedAt) < Date.parse(trainee.startedAt) ||
      values.some(v => !Number.isFinite(v) || v < 0) || assessment.quality > 100 || assessment.incumbentQuality > 100 ||
      (Array.isArray(trainee.assessments) && trainee.assessments.some(a => a?.runId === assessment.runId))) return state;
  return { ...state, trainees: state.trainees.map(t => t.id !== traineeId ? t : {
    ...t, assessments: [...(Array.isArray(t.assessments) ? t.assessments.filter(validAssessment) : []), { ...assessment }].slice(-20),
  }) };
}

function eligibleAcademyEvidence(trainee: Trainee, version: string, now: number): AcademyAssessment[] {
  return (Array.isArray(trainee.assessments) ? trainee.assessments : []).filter(a => validAssessment(a) && a.curriculumVersion === version &&
    Date.parse(a.completedAt) >= Date.parse(trainee.startedAt) && Date.parse(a.completedAt) <= now && now - Date.parse(a.completedAt) <= 7 * 86400000).slice(-3);
}

function readyForGraduation(trainee: Trainee, version: string, now: number): boolean {
  const recent = eligibleAcademyEvidence(trainee, version, now);
  return recent.length === 3 && new Set(recent.map(a => a.runId)).size === 3 && new Set(recent.map(a => a.artifactId)).size === 3 && new Set(recent.map(a => a.benchmarkId)).size === 3 && recent.every(a =>
    a.passed === true && a.quality >= 80 && a.errors === 0 &&
    (trainee.purpose === "incumbent" || (a.quality > a.incumbentQuality && a.errors <= a.incumbentErrors &&
      a.cost <= a.incumbentCost && a.durationMs <= a.incumbentDurationMs)));
}

export type OrderStatus = "en_curso" | "bloqueada" | "hecha";
export type CompanyOrder = {
  id: string;
  text: string;
  createdAt: string;
  assignees: Array<{ agentId: string; status: OrderStatus; note: string }>;
  doneAt?: string;
  // How it was closed: with a verifiable run (points) or by hand (record only, no points).
  closedBy?: "evidencia" | "robert";
  evidence?: OrderEvidence;
  // Set when the order came from a per-agent chat (shared/agent-chat-routing.ts): who received it
  // and, when that agent was not the right one, the deterministic reason it was handed off.
  chat?: { fromAgentId: string; handoff: boolean; reason: string; approvalRequired: boolean; requestId?: string };
  /** Who wrote the order: Robert (owner) or an invited partner ("socio"). Absent on older orders. */
  placedBy?: { userId: string; role: "owner" | "partner" };
  // Set only on system-authored orders from the office self-heal loop (server/office-self-heal.ts).
  // The text is a fixed template derived from finding codes and record ids; `chain` mirrors the
  // evidence (finding -> order -> factory job -> PR -> reviews -> re-audit). Never set by routes.
  selfHeal?: SelfHealOrderMarker;
};

export type SelfHealOrderMarker = {
  origin: "office-self-heal"; version: 1; entryId: string; key: string; attempt: 1 | 2;
  role: string; code: string; recordId: string; prNumber?: number;
  chain?: { status: string; readyToMerge: boolean; updatedAt: string; finding: Record<string, string>; failedReason?: string; prClosedAt?: string;
    factory?: Record<string, unknown>; preMerge?: Record<string, unknown>; postMerge?: Record<string, unknown> };
};

export type OrderEvidence = { ref: string; source: "automation_run"; summary: string; at: string };

export type CompanyState = {
  version: 1;
  careers: Record<string, AgentCareer>;
  trainees: Trainee[];
  orders: CompanyOrder[];
  events: MemoryEntry[];
  retiredCareers?: AgentCareer[];
  academyJobs?: AcademyJob[];
  /** Black Room academy journal (its own track, so it never blocks the reviewer's daily job). */
  blackroomAcademyJobs?: BlackRoomAcademyJob[];
};

/** One paired Black Room curriculum evaluation. Grades are computed on the server from fixed expectations. */
export type BlackRoomAcademyJob = {
  id: string; fence: string; traineeId: string; role: string; generation: number;
  fixtureId: string; fixtureDigest: string; curriculumVersion: string;
  /** A replacement for a fired agent has no incumbent to compare with: only the candidate runs. */
  replacement: boolean;
  startedAt: string; expiresAt: string;
  status: "running" | "completed" | "blocked" | "unknown";
  reason?: string; completedAt?: string;
  candidateQuality?: number; incumbentQuality?: number | null; passed?: boolean; artifactId?: string;
};

export type AcademyJob = {
  incumbentPolicyVersion?: string;
  candidatePolicyVersion?: string;
  id: string; traineeId: string; generation: number; curriculumVersion: string;
  benchmarkId: string; startedAt: string; expiresAt: string;
  status: "running" | "completed" | "blocked" | "unknown";
  reason?: string;
};

export type CurriculumModule = { id: string; title: string; summary: string };

export const BATTERY_MAX = 100;
const MAX_MEMORY = 12;
const MAX_ORDERS = 60;
const MAX_EVENTS = 40;
const MAX_TRAINEES = 30;
const MIN_TENURE_MS = 24 * 60 * 60_000;
function toMsSafe(value: string | undefined): number {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

// Points / battery per council cycle, by real state.
const DELTA: Record<AgentLiveState, { points: number; battery: number }> = {
  available: {points:0,battery:0},
  working: { points: 10, battery: 6 },
  // Configuration waits and absence of assigned work are not agent failures.
  "needs-setup": { points: 0, battery: 0 },
  error: { points: -5, battery: -10 },
  offline: { points: 0, battery: 0 },
  checking: { points: 0, battery: 0 },
};
// A scheduled turn that passed without any run: smaller than a recorded failure, scored once per turn.
const MISSED_TURN_DELTA = { points: -2, battery: -3 };

// An agent blocked only by missing setup (credentials, connectors) or by an infrastructure
// failure that is not its fault slowly recovers toward a neutral battery, so that a legacy low
// battery does not leave it one mistake away from being fired the day its setup arrives.
// Never above neutral (no points, no free credit) and never downward.
export const SETUP_NEUTRAL_BATTERY = 50;
export const SETUP_RECOVERY_PER_CYCLE = 2;
function blockedOnlyBySetup(status: { state: AgentLiveState; lifePenaltyExempt?: boolean }): boolean {
  return status.state === "needs-setup" || (status.state === "error" && status.lifePenaltyExempt === true);
}

const NICKNAMES = ["Vale", "Teo", "Luna", "Bruno", "Mia", "Leo", "Sofi", "Nico", "Ari", "Dani", "Gabo", "Emi", "Rafa", "Isa", "Tomi", "Cami", "Santi", "Paz", "Joaco", "Abril", "Iker", "Ema", "Thiago", "Zoe"];
const TRAITS = ["metodico", "curioso", "rapido", "detallista", "creativo", "competitivo", "calmado", "estratega", "directo", "obsesivo con la calidad", "colaborador", "esceptico"];
const MOTTOS = [
  "Si no hay evidencia, no paso.",
  "Primero entrego, despues celebro.",
  "Cada dia un poco mejor que ayer.",
  "Pregunto antes de romper algo.",
  "El dato manda.",
  "Equipo primero, ego despues.",
  "Lo simple escala.",
  "Nada sale sin revision.",
];

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return Math.abs(h);
}

// Graduates are history and can be trimmed; someone still studying is never dropped.
function capTrainees(trainees: Trainee[]): Trainee[] {
  const studying = trainees.filter((trainee) => !trainee.graduatedAt && !trainee.evaluationClosedAt);
  const graduated = trainees.filter((trainee) => trainee.graduatedAt || trainee.evaluationClosedAt);
  return [...studying, ...graduated.slice(0, Math.max(0, MAX_TRAINEES - studying.length))];
}

function usedNicknames(careers: Record<string, AgentCareer>, trainees: Trainee[], exceptAgentId?: string): Set<string> {
  const used = new Set<string>();
  for (const career of Object.values(careers)) if (career.agentId !== exceptAgentId) used.add(career.nickname);
  for (const trainee of trainees) if (!trainee.graduatedAt && trainee.forAgentId !== exceptAgentId) used.add(trainee.nickname);
  return used;
}

/** Same deterministic pick as the personality, but never repeats a name already on the team. */
export function uniqueNickname(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) return preferred;
  const start = Math.max(0, NICKNAMES.indexOf(preferred));
  for (let i = 1; i <= NICKNAMES.length; i++) {
    const candidate = NICKNAMES[(start + i) % NICKNAMES.length];
    if (!used.has(candidate)) return candidate;
  }
  for (let n = 2; ; n++) if (!used.has(`${preferred} ${n}`)) return `${preferred} ${n}`;
}

export function personalityFor(agentId: string, generation: number): Personality {
  const seed = hash(`${agentId}#${generation}`);
  const first = TRAITS[seed % TRAITS.length];
  const second = TRAITS[(seed >> 5) % TRAITS.length];
  return {
    nickname: NICKNAMES[seed % NICKNAMES.length],
    traits: first === second ? [first] : [first, second],
    motto: MOTTOS[(seed >> 9) % MOTTOS.length],
  };
}

export function emptyCompanyState(): CompanyState {
  return { version: 1, careers: {}, trainees: [], orders: [], events: [], retiredCareers: [], academyJobs: [] };
}

export function parseCompanyState(value: unknown): CompanyState {
  const v = value as Partial<CompanyState> | null;
  if (!v || v.version !== 1 || !v.careers || typeof v.careers !== "object" || Array.isArray(v.careers) || !Array.isArray(v.trainees) || !Array.isArray(v.orders)) return emptyCompanyState();
  const careers: Record<string, AgentCareer> = {};
  for (const [id, career] of Object.entries(v.careers as Record<string, unknown>)) {
    const c = career as Partial<AgentCareer> | null;
    if (c && typeof c === "object" && typeof c.agentId === "string" && typeof c.nickname === "string" && Number.isFinite(c.points) && Number.isFinite(c.battery)) {
      careers[id] = { ...(c as AgentCareer), memory: Array.isArray(c.memory) ? c.memory : [] };
    }
  }
  const trainees = v.trainees.filter((t): t is Trainee => Boolean(t) && typeof t === "object" && typeof t.id === "string" && Array.isArray(t.modulesDone) && Array.isArray(t.knowledge)).map(t => ({ ...t, assessments: Array.isArray(t.assessments) ? t.assessments.filter(validAssessment) : [] }));
  const orders = v.orders.filter((o): o is CompanyOrder => Boolean(o) && typeof o === "object" && typeof o.id === "string" && typeof o.text === "string" && Array.isArray(o.assignees));
  const events = Array.isArray(v.events) ? v.events.filter((e) => Boolean(e) && typeof e === "object" && typeof e.text === "string") : [];
  const blackroomAcademyJobs = Array.isArray(v.blackroomAcademyJobs) ? v.blackroomAcademyJobs.filter((j): j is BlackRoomAcademyJob => Boolean(j) && typeof j === "object" &&
    [j.id, j.fence, j.traineeId, j.role, j.fixtureId, j.fixtureDigest, j.curriculumVersion].every(s => typeof s === "string" && s.length > 0) &&
    Number.isInteger(j.generation) && j.generation > 0 && Number.isFinite(Date.parse(j.startedAt)) && Number.isFinite(Date.parse(j.expiresAt)) &&
    ["running", "completed", "blocked", "unknown"].includes(j.status)).slice(-200) : undefined;
  return { version: 1, careers, trainees, orders, events,
    ...(blackroomAcademyJobs ? { blackroomAcademyJobs } : {}),
    retiredCareers: Array.isArray(v.retiredCareers) ? v.retiredCareers : [],
    academyJobs: Array.isArray(v.academyJobs) ? v.academyJobs.map((j, index) => {
      const valid = j && [j.id,j.traineeId,j.curriculumVersion,j.benchmarkId].every(s => typeof s === "string" && s.length > 0) &&
        Number.isInteger(j.generation) && j.generation > 0 && Number.isFinite(Date.parse(j.startedAt)) && Number.isFinite(Date.parse(j.expiresAt)) &&
        Date.parse(j.expiresAt) > Date.parse(j.startedAt) && ["running", "completed", "blocked", "unknown"].includes(j.status);
      return valid ? j : { id: `invalid-${index}`, traineeId: "invalid", generation: 1, curriculumVersion: "invalid", benchmarkId: "invalid",
        startedAt: "1970-01-01T00:00:00.000Z", expiresAt: "1970-01-01T00:00:01.000Z", status: "unknown" as const, reason: "INVALID_PERSISTED_ACADEMY_JOB" };
    }) : [],
  };
}

function remember(memory: MemoryEntry[], at: string, text: string) {
  return [{ at, text }, ...memory].slice(0, MAX_MEMORY);
}

export function levelFor(points: number) {
  if (points >= 1500) return "Lider";
  if (points >= 700) return "Senior";
  if (points >= 250) return "Semi-senior";
  return "Junior";
}

const STATE_WORDS: Record<AgentLiveState, string> = {
  available:"disponible sin ejecución actual",
  working: "trabajando",
  "needs-setup": "esperando configuracion",
  error: "con error",
  offline: "sin respuesta",
  checking: "verificando",
};

// One company tick: careers move with real states; empty batteries trigger a replacement.
export function advanceCompany(
  state: CompanyState,
  input: { now: number; statuses: Record<string, { state: AgentLiveState; label: string; evidenceId?: string; lifePenaltyExempt?: boolean; missedTurn?: boolean }>; roles: Record<string, string>; exempt?: string[] }
): { state: CompanyState; fired: Array<{ agentId: string; nickname: string; generation: number; reason: string }> } {
  const iso = new Date(input.now).toISOString();
  const careers: Record<string, AgentCareer> = { ...state.careers };
  const fired: Array<{ agentId: string; nickname: string; generation: number; reason: string }> = [];
  let trainees = [...state.trainees];
  let retiredCareers = [...(state.retiredCareers || [])];
  let events = [...state.events];

  for (const [agentId, status] of Object.entries(input.statuses)) {
    // Agents without an endpoint of their own are shown, but never scored, fired or ranked.
    if (input.exempt?.includes(agentId)) continue;
    const existing = careers[agentId];
    let career: AgentCareer = existing
      ? { ...existing }
      : {
          agentId,
          generation: 1,
          nickname: uniqueNickname(personalityFor(agentId, 1).nickname, usedNicknames(careers, trainees, agentId)),
          points: 0,
          battery: 80,
          lastState: null,
          cyclesWorking: 0,
          cyclesTotal: 0,
          ordersDone: 0,
          firedCount: 0,
          hiredAt: iso,
          memory: [{ at: iso, text: `Contratado como ${input.roles[agentId] || agentId}.` }],
        };
    // A preserved legacy score is not proof of misconduct or qualification.
    // Any reconciliation marker freezes career-wide scoring pending a separate,
    // explicitly evidenced qualification process. Never silently repair its life.
    if(career.scoreReconciliation !== undefined){careers[agentId]=career;continue;}
    if (blockedOnlyBySetup(status) && !career.inTrainingUntilGeneration && career.battery < SETUP_NEUTRAL_BATTERY) {
      career.battery = Math.min(SETUP_NEUTRAL_BATTERY, career.battery + SETUP_RECOVERY_PER_CYCLE);
      careers[agentId] = career;
      continue;
    }
    const evidence=status.evidenceId?.trim();
    if(career.evaluatedEvidenceIds !== undefined && (!Array.isArray(career.evaluatedEvidenceIds) || career.evaluatedEvidenceIds.some(id=>typeof id !== "string"))) { careers[agentId]=career;continue; }
    if (!evidence || evidence === career.lastEvidenceId || career.evaluatedEvidenceIds?.includes(evidence)) { careers[agentId] = career; continue; }
    // "checking" has no evidence yet, and a replacement in the academy is studying, not failing.
    if (status.state === "available" || status.state === "checking" || status.state === "needs-setup" || status.state === "offline" || status.lifePenaltyExempt || career.inTrainingUntilGeneration) {
      careers[agentId] = career;
      continue;
    }
    career.lastEvaluatedAt = iso;
    career.evaluatedEvidenceIds=[...(career.evaluatedEvidenceIds || []),...(career.lastEvidenceId && !career.evaluatedEvidenceIds?.includes(career.lastEvidenceId) ? [career.lastEvidenceId] : []),evidence];
    career.lastEvidenceId = evidence;
    const delta = status.missedTurn && status.state === "error" ? MISSED_TURN_DELTA : DELTA[status.state];
    career.points = Math.max(0, career.points + delta.points);
    career.battery = Math.max(0, Math.min(BATTERY_MAX, career.battery + delta.battery));
    career.cyclesTotal += 1;
    if (status.state === "working") career.cyclesWorking += 1;
    if (career.lastState !== status.state) {
      career.memory = remember(career.memory, iso, `Paso a ${STATE_WORDS[status.state]}: ${status.label}.`);
    }
    career.lastState = status.state;

    const exempt = input.exempt?.includes(agentId);
    // A new hire gets at least a day on the job before it can be fired again.
    if (!exempt && career.battery === 0 && input.now - toMsSafe(career.hiredAt) >= MIN_TENURE_MS) {
      const result = fireAndReplace({ careers, trainees, retiredCareers, events }, career, `Bateria en cero (${status.label}).`, input.roles, iso);
      ({ trainees, retiredCareers, events } = result);
      fired.push(result.fired);
      career = result.career;
    }
    careers[agentId] = career;
  }
  return { state: { ...state, careers, trainees, retiredCareers, events: events.slice(0, MAX_EVENTS) }, fired };
}

/** Retires a career at battery zero and starts its replacement in the academy (same rules for every cause). */
function fireAndReplace(
  current: { careers: Record<string, AgentCareer>; trainees: Trainee[]; retiredCareers: AgentCareer[]; events: MemoryEntry[] },
  career: AgentCareer,
  reason: string,
  roles: Record<string, string>,
  iso: string,
) {
  const agentId = career.agentId;
  const retiredCareers = [...current.retiredCareers, { ...career, memory: [...career.memory] }];
  const fired = { agentId, nickname: career.nickname, generation: career.generation, reason };
  const events = [{ at: iso, text: `El CEO despidio a ${career.nickname} (${roles[agentId] || agentId}). ${reason} Entra un reemplazo a la academia.` }, ...current.events];
  const nextGeneration = career.generation + 1;
  const replacement = { nickname: uniqueNickname(personalityFor(agentId, nextGeneration).nickname, usedNicknames(current.careers, current.trainees, agentId)) };
  const next: AgentCareer = {
    ...career,
    generation: nextGeneration,
    nickname: replacement.nickname,
    points: 0,
    battery: 60,
    firedCount: career.firedCount + 1,
    hiredAt: iso,
    inTrainingUntilGeneration: nextGeneration,
    memory: [{ at: iso, text: `Reemplaza a la generacion ${nextGeneration - 1}. Empieza en la academia.` }],
  };
  let trainees = current.trainees;
  if (!trainees.some((trainee) => trainee.id === `${agentId}#${nextGeneration}` && !trainee.graduatedAt)) {
    trainees = capTrainees([
      { id: `${agentId}#${nextGeneration}`, forAgentId: agentId, role: roles[agentId] || agentId, nickname: replacement.nickname, startedAt: iso, modulesDone: [], knowledge: [], generation: nextGeneration, purpose: "candidate" },
      ...trainees,
    ]);
  }
  return { career: next, trainees, retiredCareers, events, fired };
}

/**
 * A scored result of real work that is not a live state: a post approved or rejected by Robert or
 * the partner, a failed edit job, a published post above the team median. Each id scores once,
 * only for the current generation (hired before the outcome) and never while it is in the academy.
 */
export type QualitySignal = { id: string; agentId: string; at: string; points: number; battery: number; text: string };
const MAX_QUALITY_SIGNAL_IDS = 200;
const QUALITY_SIGNAL_WINDOW_MS = 7 * 24 * 60 * 60_000;

export function applyQualitySignals(
  state: CompanyState,
  signals: QualitySignal[],
  input: { now: number; roles: Record<string, string>; exempt?: string[] },
): { state: CompanyState; fired: Array<{ agentId: string; nickname: string; generation: number; reason: string }>; applied: string[] } {
  const iso = new Date(input.now).toISOString();
  const careers: Record<string, AgentCareer> = { ...state.careers };
  let trainees = [...state.trainees];
  let retiredCareers = [...(state.retiredCareers || [])];
  let events = [...state.events];
  const fired: Array<{ agentId: string; nickname: string; generation: number; reason: string }> = [];
  const applied: string[] = [];
  const ordered = [...signals].filter((signal) => signal && typeof signal.id === "string" && signal.id.trim() && Number.isFinite(signal.points) && Number.isFinite(signal.battery))
    .sort((a, b) => toMsSafe(a.at) - toMsSafe(b.at) || a.id.localeCompare(b.id));
  for (const signal of ordered) {
    if (input.exempt?.includes(signal.agentId)) continue;
    const existing = careers[signal.agentId];
    if (!existing || existing.scoreReconciliation !== undefined || existing.inTrainingUntilGeneration) continue;
    const at = toMsSafe(signal.at);
    // Old outcomes and the previous generation's outcomes never reach the current holder.
    if (!at || at > input.now + 5_000 || input.now - at > QUALITY_SIGNAL_WINDOW_MS || at < toMsSafe(existing.hiredAt)) continue;
    if ((existing.qualitySignalIds || []).includes(signal.id)) continue;
    let career: AgentCareer = {
      ...existing,
      points: Math.max(0, existing.points + Math.round(signal.points)),
      battery: Math.max(0, Math.min(BATTERY_MAX, existing.battery + Math.round(signal.battery))),
      qualitySignalIds: [...(existing.qualitySignalIds || []), signal.id].slice(-MAX_QUALITY_SIGNAL_IDS),
      memory: remember(existing.memory, iso, `${signal.text.slice(0, 140)} (${signal.points >= 0 ? "+" : ""}${Math.round(signal.points)} pts).`),
    };
    applied.push(signal.id);
    if (career.battery === 0 && input.now - toMsSafe(career.hiredAt) >= MIN_TENURE_MS) {
      const result = fireAndReplace({ careers, trainees, retiredCareers, events }, career, `Bateria en cero por calidad (${signal.text.slice(0, 80)}).`, input.roles, iso);
      ({ trainees, retiredCareers, events } = result);
      fired.push(result.fired);
      career = result.career;
    }
    careers[signal.agentId] = career;
  }
  if (!applied.length) return { state, fired, applied };
  return { state: { ...state, careers, trainees, retiredCareers, events: events.slice(0, MAX_EVENTS) }, fired, applied };
}

// Academy: each cycle every trainee studies one more real module; graduation puts it to work.
export function advanceAcademy(state: CompanyState, curriculum: (trainee: Trainee) => CurriculumModule[], now: number): CompanyState {
  const iso = new Date(now).toISOString();
  const careers = { ...state.careers };
  let events = [...state.events];
  const trainees = state.trainees.map((trainee) => {
    if (trainee.graduatedAt || trainee.evaluationClosedAt) return trainee;
    const currentCareer = careers[trainee.forAgentId];
    if (currentCareer && trainee.generation !== undefined && trainee.generation !== currentCareer.generation) {
      return { ...trainee, awaitingEvidence: true, executionBlocker: "Career generation changed; this course cannot update the current holder." };
    }
    const modules = curriculum(trainee);
    trainee = { ...trainee, curriculumSnapshot: modules.map(module => ({ ...module })) };
    const next = modules.find((module) => !trainee.modulesDone.includes(module.id));
    if (!next) {
      const version = JSON.stringify(modules.map(m => [m.id, m.title, m.summary]));
      if (!modules.length || !readyForGraduation(trainee, version, now)) return { ...trainee, awaitingEvidence: true };
      const currentEvidence = eligibleAcademyEvidence(trainee, version, now);
      if (currentEvidence.some(a => a.scope !== "production")) return { ...trainee, qualifiedAt: trainee.qualifiedAt || iso, awaitingEvidence: true, executionBlocker: "Fixture qualification complete; real work and runtime handoff still unverified." };
      let career = careers[trainee.forAgentId];
      // A specialist is a brand-new agent: it is created when it graduates.
      if (!career && trainee.forAgentId.startsWith(SPECIALIST_PREFIX)) {
        career = {
          agentId: trainee.forAgentId,
          generation: 1,
          nickname: trainee.nickname,
          points: 0,
          battery: 80,
          lastState: null,
          cyclesWorking: 0,
          cyclesTotal: 0,
          ordersDone: 0,
          firedCount: 0,
          hiredAt: iso,
          memory: [],
        };
      }
      if (career) {
        // What it studied about this job becomes its skills.
        for (const item of (trainee.learned || []).slice(0, 6)) career = addSkill(career, { id: item.id, title: item.title, source: "academia" }, iso);
        careers[trainee.forAgentId] = {
          ...career,
          inTrainingUntilGeneration: trainee.id === `${career.agentId}#${career.generation}` && (trainee.generation === undefined || trainee.generation === career.generation) ? undefined : career.inTrainingUntilGeneration,
          memory: remember(career.memory, iso, `Se graduo de la academia (${trainee.modulesDone.length} modulos, ${(trainee.learned || []).length} sobre este puesto) y entra a trabajar.`),
        };
      }
      events = [{ at: iso, text: `${trainee.nickname} se graduo como ${trainee.role}.` }, ...events];
      return { ...trainee, graduatedAt: iso, awaitingEvidence: false };
    }
    const tailored = isTailoredModule(next.id);
    return {
      ...trainee,
      modulesDone: [...trainee.modulesDone, next.id],
      knowledge: [`${next.title}: ${next.summary}`, ...trainee.knowledge].slice(0, 8),
      learned: tailored ? [...(trainee.learned || []), { id: next.id, title: next.title }].slice(-10) : trainee.learned,
    };
  });
  return { ...state, careers, trainees, events: events.slice(0, MAX_EVENTS) };
}

export function isTailoredModule(id: string): boolean {
  return /^(puesto|orden|leccion):/.test(id);
}

/**
 * The part of the curriculum that is about THIS job, built from what actually happened:
 * why the previous holder was not working, the orders that reached the role, and the lessons the
 * council learned about it. Comes before the general docs.
 */
export function tailoredModules(
  state: CompanyState,
  forAgentId: string,
  input: { status?: { state: AgentLiveState; label: string }; lessons?: Array<{ key: string; subject: string; label: string }>; topic?: string } = {}
): CurriculumModule[] {
  const modules: CurriculumModule[] = [];
  if (input.status && input.status.state !== "working") {
    modules.push({ id: `puesto:${forAgentId}:estado`, title: "Por que este puesto no estaba trabajando", summary: input.status.label.slice(0, 160) });
  }
  const previous = state.careers[forAgentId];
  const failures = (previous?.memory || []).filter((entry) => /despedid|bateria|error|no puede|reemplaz/i.test(entry.text)).slice(0, 2);
  for (const [index, entry] of failures.entries()) {
    modules.push({ id: `puesto:${forAgentId}:historial-${index}`, title: "Historial del puesto", summary: entry.text.slice(0, 160) });
  }
  const topic = input.topic ? topicSlug(input.topic) : undefined;
  const orders = state.orders
    .filter((order) => order.assignees.some((assignee) => assignee.agentId === forAgentId) || (topic ? topicSlug(orderTopic(order.text)) === topic : false))
    .slice(0, 5);
  for (const order of orders) {
    modules.push({
      id: `orden:${order.id}`,
      title: `Orden: ${order.text.slice(0, 50)}`,
      summary: order.evidence ? `Se hizo con evidencia: ${order.evidence.summary}` : order.assignees.map((assignee) => assignee.note).join(" ").slice(0, 160),
    });
  }
  for (const lesson of (input.lessons || []).filter((item) => item.subject === forAgentId).slice(0, 3)) {
    modules.push({ id: `leccion:${lesson.key}`, title: `Leccion: ${lesson.label.slice(0, 60)}`, summary: "Aprobada por Robert en el Trust Center." });
  }
  return modules;
}

/** The first routing keyword found in an order, used to group recurring kinds of work. */
// Brands say WHO the work is for; the topic should say WHAT the work is ("video", "legal", ...).
const BRAND_WORDS = new Set(["black room", "blackroom", "br", "kong"]);
function containsWord(text: string, word: string): boolean {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1])${escaped}([^a-z0-9\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]|$)`).test(text);
}

export function orderTopic(text: string): string {
  // Whole words only ("solicita" is not "cita", "producto" is not "pr"), accents ignored
  // ("campaña" = "campana"). Synonyms share one topic: the group's first word ("reel" -> "video").
  const lower = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let brand: string | null = null;
  for (const route of ROUTES) {
    const word = route.words.find((candidate) => containsWord(lower, candidate));
    if (!word) continue;
    const topic = route.words[0].trim();
    if (!BRAND_WORDS.has(topic)) return topic;
    brand = brand || topic;
  }
  return brand || "general";
}

export const SPECIALIST_MIN_ORDERS = 3;
const SPECIALIST_WINDOW_MS = 14 * 24 * 60 * 60_000;

/**
 * Recurring work nobody could take: 3+ orders on the same topic in 14 days whose assignees were
 * all blocked. The agent factory turns each into a "hire a specialist" proposal for Robert.
 */
export function specialistNeeds(state: CompanyState, now: number): Array<{ topic: string; orders: CompanyOrder[] }> {
  const groups = new Map<string, CompanyOrder[]>();
  for (const order of state.orders) {
    if (now - Date.parse(order.createdAt) > SPECIALIST_WINDOW_MS) continue;
    if (order.assignees.length && order.assignees.some((assignee) => assignee.status === "en_curso" || (assignee.status === "hecha" && order.closedBy === "evidencia"))) continue;
    const topic = orderTopic(order.text);
    if (topic === "general") continue;
    groups.set(topic, [...(groups.get(topic) || []), order]);
  }
  return [...groups.entries()].filter(([, orders]) => orders.length >= SPECIALIST_MIN_ORDERS).map(([topic, orders]) => ({ topic, orders }));
}

/** Skills from council lessons approved about an agent ("Corrige: ..."). */
export function learnLessons(state: CompanyState, lessons: Array<{ key: string; subject: string; label: string }>, now: number): CompanyState {
  const iso = new Date(now).toISOString();
  let careers = state.careers;
  for (const lesson of lessons) {
    const career = careers[lesson.subject];
    if (!career || (career.skills || []).some((skill) => skill.id === `leccion:${lesson.key}`)) continue;
    careers = { ...careers, [lesson.subject]: addSkill(career, { id: `leccion:${lesson.key}`, title: `Corrige: ${lesson.label.slice(0, 60)}`, source: "leccion" }, iso) };
  }
  return careers === state.careers ? state : { ...state, careers };
}

export function enrollTrainee(state: CompanyState, input: { id: string; forAgentId: string; role: string; now: number }): CompanyState {
  if (state.trainees.some((trainee) => trainee.id === input.id)) return state;
  const iso = new Date(input.now).toISOString();
  const nickname = uniqueNickname(personalityFor(input.id, 1).nickname, usedNicknames(state.careers, state.trainees));
  return {
    ...state,
    trainees: capTrainees([{ id: input.id, forAgentId: input.forAgentId, role: input.role, nickname, startedAt: iso, modulesDone: [], knowledge: [] }, ...state.trainees]),
    events: [{ at: iso, text: `${nickname} entro a la academia para ${input.role}.` }, ...state.events].slice(0, MAX_EVENTS),
  };
}

/** Bounded preparation queue. It never executes work, spends money or promotes a candidate.
 * Each incumbent gets a versioned refresher and a supervised challenger. Jobs stay pending
 * until a trusted evaluator records artifacts; unavailable execution must not count as study.
 */
export function scheduleAcademyTraining(state: CompanyState, roles: Record<string, string>, now: number, maxActive = 8): CompanyState {
  if (!Number.isSafeInteger(maxActive) || maxActive < 0 || maxActive > 30) return state;
  let next = state;
  const week = Math.floor(now / (7 * 86400000));
  const careers = Object.values(state.careers).filter(c => roles[c.agentId] && !c.inTrainingUntilGeneration)
    .sort((a, b) => {
      const last = (id: string) => Math.max(0, ...state.trainees.filter(t => t.forAgentId === id).map(t => toMsSafe(t.startedAt)));
      return Number(b.agentId === "claude-reviewer") - Number(a.agentId === "claude-reviewer") || last(a.agentId) - last(b.agentId) || a.agentId.localeCompare(b.agentId);
    });
  for (const career of careers) {
    for (const purpose of ["incumbent", "candidate"] as const) {
      if (next.trainees.filter(t => !t.graduatedAt && !t.evaluationClosedAt).length >= maxActive) return next;
      if (next.trainees.some(t => t.forAgentId === career.agentId && t.purpose === purpose && !t.graduatedAt && !t.evaluationClosedAt)) continue;
      const id = `academy:${career.agentId}:${career.generation}:${purpose}:${week}`;
      if (next.trainees.some(t => t.id === id)) continue;
      next = enrollTrainee(next, { id, forAgentId: career.agentId, role: roles[career.agentId], now });
      next = { ...next, trainees: next.trainees.map(t => t.id === id ? {
        ...t, purpose, generation: career.generation,
        nickname: purpose === "incumbent" ? career.nickname : t.nickname,
      } : t) };
    }
  }
  return next;
}

// CEO channel: deterministic routing from Robert's words to the right departments.
// Routes with `requires` only fire when the order also names that context (e.g. Black Room), so
// generic words like "reporte" or "web" do not pull the Black Room specialists into other work.
const BLACKROOM_CONTEXT = ["black room", "blackroom"];
export const ROUTES: Array<{ words: string[]; agents: string[]; requires?: string[] }> = [
  { words: ["analitica", "analytics", "metrica", "estadistica", "reporte", "insight", "alcance"], agents: ["blackroom-analytics"], requires: BLACKROOM_CONTEXT },
  { words: ["competencia", "competidor", "rival"], agents: ["blackroom-competition"], requires: BLACKROOM_CONTEXT },
  { words: ["postea", "postear", "posteo", "publica", "metricool", "meta ", "programa el post", "programar post"], agents: ["blackroom-publisher"], requires: BLACKROOM_CONTEXT },
  { words: ["guion", "script", "idea", "editar video", "edita el video", "edicion"], agents: ["blackroom-scripts"], requires: BLACKROOM_CONTEXT },
  { words: ["website", "web", "pagina", "sitio"], agents: ["blackroom-website"], requires: BLACKROOM_CONTEXT },
  { words: ["black room", "blackroom", "br "], agents: ["blackroom-ceo", "blackroom-videos", "radio"] },
  { words: ["kong"], agents: ["kong-videos"] },
  { words: ["video", "reel", "clip", "tiktok", "subir"], agents: ["clippers", "blackroom-videos", "kong-videos"] },
  { words: ["radio", "dj", "set"], agents: ["radio"] },
  { words: ["noticia", "news"], agents: ["news"] },
  { words: ["legal", "contrato", "termino", "privacidad", "copyright", "abogado"], agents: ["legal"] },
  { words: ["app", "bug", "error", "falla", "funcion", "pantalla", "monitor"], agents: ["app-qa", "code"] },
  { words: ["codigo", "github", "pr ", "deploy", "repo"], agents: ["code", "github", "claude-reviewer"] },
  { words: ["seguridad", "hack", "ataque", "contrasena"], agents: ["cybersecurity"] },
  { words: ["marketing", "campana", "anuncio", "ads", "metricool", "redes", "instagram"], agents: ["marketing-cmo"] },
  { words: ["venta", "cliente", "deal", "stripe", "cobro", "pago", "dinero"], agents: ["revenue"] },
  { words: ["tienda", "shopify", "producto", "dropshipping"], agents: ["dropshipping"] },
  { words: ["inversion", "accion", "portafolio", "bolsa", "crypto"], agents: ["portfolio"] },
  { words: ["agenda", "calendario", "reunion", "recordatorio", "cita"], agents: ["assistant"] },
  { words: ["automatiza", "automatizacion", "programa", "cada dia", "diario"], agents: ["automations"] },
  { words: ["skill", "mejorar", "aprender", "actualiza"], agents: ["skills-scout"] },
  { words: ["agente nuevo", "contrata", "crear agente", "subagente"], agents: ["agent-factory"] },
  { words: ["arregla", "repara", "no funciona", "caido", "roto"], agents: ["mechanic"] },
];

export function routeOrder(text: string, available: string[]): string[] {
  const normalized = ` ${text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")} `;
  const picked: string[] = [];
  for (const route of ROUTES) {
    if (route.requires && !route.requires.some((word) => normalized.includes(word))) continue;
    if (route.words.some((word) => normalized.includes(word))) {
      for (const agent of route.agents) if (available.includes(agent) && !picked.includes(agent)) picked.push(agent);
    }
  }
  if (picked.length === 0) return available.includes("assistant") ? ["assistant"] : available.slice(0, 1);
  return picked.slice(0, 4);
}

export function createOrder(
  state: CompanyState,
  input: {
    text: string; now: number; statuses: Record<string, { state: AgentLiveState; label: string }>; available: string[]; names: Record<string, string>;
    /** Explicit assignees (filtered to `available`). When any remain, they replace the text routing. */
    assignees?: string[];
  }
): { state: CompanyState; order: CompanyOrder } {
  const iso = new Date(input.now).toISOString();
  const text = input.text.trim().slice(0, 500);
  const explicit = [...new Set((input.assignees || []).filter((id) => input.available.includes(id)))];
  const assigneeIds = explicit.length ? explicit : routeOrder(text, input.available);
  const order: CompanyOrder = {
    id: `ord-${input.now.toString(36)}-${hash(text).toString(36).slice(0, 4)}`,
    text,
    createdAt: iso,
    assignees: [
      ...assigneeIds,
      // Specialists created by the academy take the orders whose topic is exactly theirs
      // (not when the caller named the assignees explicitly).
      ...(explicit.length ? [] : Object.keys(state.careers).filter((id) => isSpecialistId(id) && id === specialistIdFor(orderTopic(text)))),
    ].map((agentId) => {
      const status = input.statuses[agentId];
      const specialist = isSpecialistId(agentId);
      const working = status?.state === "working" || specialist;
      return {
        agentId,
        status: working ? "en_curso" : "bloqueada",
        note: specialist
          ? "Anotada para el especialista de este tema. Nadie la ejecuta solo: se cierra con evidencia de una ejecucion exitosa."
          : working
          ? "Asignada a un agente activo. Queda anotada: los agentes no ejecutan ordenes solos; se cierra con evidencia de una ejecucion exitosa."
          : `Asignada, pero el agente no esta trabajando (${status?.label || "sin estado reciente"}). Hay que arreglarlo antes.`,
      };
    }),
  };
  const careers = { ...state.careers };
  for (const assignee of order.assignees) {
    const career = careers[assignee.agentId];
    if (career) careers[assignee.agentId] = { ...career, memory: remember(career.memory, iso, `Orden del CEO: "${text.slice(0, 80)}" (${assignee.status === "en_curso" ? "en curso" : "bloqueada"}).`) };
  }
  const who = order.assignees.map((assignee) => input.names[assignee.agentId] || assignee.agentId).join(", ");
  return {
    order,
    state: {
      ...state,
      careers,
      orders: [order, ...state.orders].slice(0, MAX_ORDERS),
      events: [{ at: iso, text: `El CEO asigno "${text.slice(0, 60)}" a ${who}.` }, ...state.events].slice(0, MAX_EVENTS),
    },
  };
}

// Robert confirms an order is done: assignees that had it in progress earn points.
export function evidenceAlreadyUsed(state: CompanyState, ref: string): boolean {
  return state.orders.some((order) => order.evidence?.ref === ref);
}

// Points need proof: a verified run (checked by the server) that was not used for another order,
// and only for agents that were actually working when the order came in. Closing by hand only records it.
export function completeOrder(state: CompanyState, orderId: string, now: number, evidence?: OrderEvidence): CompanyState {
  const iso = new Date(now).toISOString();
  const order = state.orders.find((item) => item.id === orderId);
  if (!order || order.doneAt) return state;
  const verified = Boolean(evidence) && !evidenceAlreadyUsed(state, evidence!.ref);
  const careers = { ...state.careers };
  for (const assignee of order.assignees) {
    const career = careers[assignee.agentId];
    if (!career || career.scoreReconciliation !== undefined) continue;
    const earned = verified && assignee.status === "en_curso" ? 25 : 0;
    const skilled = earned ? addSkill(career, { id: `orden:${orderTopic(order.text)}`, title: `Ejecuta: ${orderTopic(order.text)}`, source: "orden" }, iso) : career;
    careers[assignee.agentId] = {
      ...skilled,
      points: career.points + earned,
      battery: earned ? Math.min(BATTERY_MAX, career.battery + 10) : career.battery,
      ordersDone: career.ordersDone + (earned ? 1 : 0),
      memory: remember(
        career.memory,
        iso,
        earned
          ? `Orden "${order.text.slice(0, 60)}" cerrada con evidencia (${evidence!.summary.slice(0, 40)}): +${earned} puntos.`
          : verified
            ? `La orden "${order.text.slice(0, 60)}" se cerro con evidencia, pero yo no estaba trabajando (0 puntos).`
            : `La orden "${order.text.slice(0, 60)}" se cerro a mano, sin evidencia (0 puntos).`
      ),
    };
  }
  return {
    ...state,
    careers,
    orders: state.orders.map((item) =>
      item.id === orderId
        ? { ...item, doneAt: iso, closedBy: verified ? "evidencia" : "robert", ...(verified ? { evidence } : {}), assignees: item.assignees.map((a) => ({ ...a, status: "hecha" as const })) }
        : item
    ),
  };
}

export type LeaderboardRow = { agentId: string; nickname: string; points: number; battery: number; level: string; rank: number; title: string; reliability: number };

export function leaderboard(state: CompanyState, exclude: string[] = ["ceo"]): LeaderboardRow[] {
  const rows = Object.values(state.careers)
    .filter((career) => !exclude.includes(career.agentId))
    .sort((a, b) => b.points - a.points || b.battery - a.battery || a.agentId.localeCompare(b.agentId))
    .map((career, index) => ({
      agentId: career.agentId,
      nickname: career.nickname,
      points: career.points,
      battery: career.battery,
      level: levelFor(career.points),
      rank: index + 1,
      // The best agent becomes the deputy, right under the CEO.
      title: index === 0 && career.points > 0 ? "Subdirector/a (debajo del CEO)" : levelFor(career.points),
      reliability: career.cyclesTotal ? Math.round((career.cyclesWorking / career.cyclesTotal) * 100) : 0,
    }));
  return rows;
}

/** KONG has its own company ledger; these ids must never advance in BlackOps. */
export const isKongCompanyAgent = (id: string) => id === "kong" || id.startsWith("kong:") || id.startsWith("kong-city:") || ["kong-videos", "kong-metrics", "kong-supervisor"].includes(id);

/** Quarantine old unproven scores and academy records without relabelling them as new evidence. */
export function separateLegacyKongCompany(company: CompanyState, archived: CompanyState) {
  const legacyCareers = Object.fromEntries(Object.entries(company.careers).filter(([id]) => isKongCompanyAgent(id)));
  const legacyTrainees = company.trainees.filter(item => isKongCompanyAgent(item.forAgentId));
  const legacyOrders = company.orders.filter(item => item.assignees.some(assignee => isKongCompanyAgent(assignee.agentId)));
  const dedupe = <T extends { id: string }>(items: T[]) => [...new Map(items.map(item => [item.id, item])).values()];
  return {
    company: {
      ...company,
      careers: Object.fromEntries(Object.entries(company.careers).filter(([id]) => !isKongCompanyAgent(id))),
      trainees: company.trainees.filter(item => !isKongCompanyAgent(item.forAgentId)),
      orders: company.orders.filter(item => !legacyOrders.includes(item) || item.assignees.some(assignee => !isKongCompanyAgent(assignee.agentId)))
        .map(item => ({ ...item, assignees: item.assignees.filter(assignee => !isKongCompanyAgent(assignee.agentId)) })),
    },
    archived: {
      ...archived,
      careers: { ...archived.careers, ...legacyCareers },
      trainees: dedupe([...archived.trainees, ...legacyTrainees]),
      orders: dedupe([...archived.orders, ...legacyOrders]),
    },
  };
}
