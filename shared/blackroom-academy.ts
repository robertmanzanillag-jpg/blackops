// Black Room area of the academy: continuous enrollment, graduation with evidence and the
// summary the office UI shows. Pure and deterministic ($0); AI evaluations are recorded by the
// server runner (server/office-academy-blackroom.ts) through recordAcademyAssessment.
import {
  addSkill,
  enrollTrainee,
  recordAcademyAssessment,
  type AcademyAssessment,
  type AgentCareer,
  type CompanyState,
  type Trainee,
} from "./agent-company";
import { BLACKROOM_DEPARTMENT_ORDER, BLACKROOM_TEAM_IDS } from "./blackroom-team";

/** Roles with a Black Room curriculum (the six new agents plus radio; blackroom-videos keeps the general one). */
export const BLACKROOM_ACADEMY_ROLES: readonly string[] = [...BLACKROOM_TEAM_IDS, "radio"];
/** Distinct benchmark fixtures a trainee must pass before real work can graduate it. */
export const BLACKROOM_ACADEMY_REQUIRED_PASSES = 3;
/** At most this many Black Room trainees study at the same time (refreshers + replacements). */
export const BLACKROOM_ACADEMY_MAX_ACTIVE = 4;
const PRODUCTION_PREFIX = "blackroom-produccion:";
const WEEK_MS = 7 * 86_400_000;
const MAX_EVENTS = 40;

export function isBlackRoomAcademyMember(agentId: string): boolean {
  return (BLACKROOM_DEPARTMENT_ORDER as readonly string[]).includes(agentId);
}

const active = (trainee: Trainee) => !trainee.graduatedAt && !trainee.evaluationClosedAt;
const toMs = (value: string | undefined) => { const ms = value ? Date.parse(value) : NaN; return Number.isFinite(ms) ? ms : 0; };

/**
 * Keeps the Black Room roles in continuous training: each role with a working career gets one
 * weekly refresher ("incumbent") when it has no active trainee. Replacements of fired agents are
 * created by advanceCompany and always have priority (they count against the same cap).
 */
export function scheduleBlackRoomAcademy(state: CompanyState, roles: Record<string, string>, now: number, maxActive = BLACKROOM_ACADEMY_MAX_ACTIVE): CompanyState {
  const week = Math.floor(now / WEEK_MS);
  let next = state;
  const activeCount = () => next.trainees.filter((trainee) => active(trainee) && BLACKROOM_ACADEMY_ROLES.includes(trainee.forAgentId)).length;
  const careers = BLACKROOM_ACADEMY_ROLES.map((id) => state.careers[id]).filter((career): career is AgentCareer => Boolean(career && roles[career.agentId] && !career.inTrainingUntilGeneration && career.scoreReconciliation === undefined))
    // Least recently trained first, so every role gets its turn.
    .sort((a, b) => {
      const last = (id: string) => Math.max(0, ...state.trainees.filter((trainee) => trainee.forAgentId === id).map((trainee) => toMs(trainee.startedAt)));
      return last(a.agentId) - last(b.agentId) || a.agentId.localeCompare(b.agentId);
    });
  for (const career of careers) {
    if (activeCount() >= maxActive) break;
    if (next.trainees.some((trainee) => trainee.forAgentId === career.agentId && active(trainee))) continue;
    const id = `academy:blackroom:${career.agentId}:${career.generation}:${week}`;
    if (next.trainees.some((trainee) => trainee.id === id)) continue;
    next = enrollTrainee(next, { id, forAgentId: career.agentId, role: `${roles[career.agentId]} (academia Black Room)`, now });
    next = { ...next, trainees: next.trainees.map((trainee) => trainee.id === id ? { ...trainee, purpose: "incumbent" as const, generation: career.generation, nickname: career.nickname } : trainee) };
  }
  return next;
}

function benchmarkPasses(trainee: Trainee): AcademyAssessment[] {
  const byFixture = new Map<string, AcademyAssessment>();
  for (const assessment of trainee.assessments || []) {
    if (assessment.scope !== "benchmark" || !assessment.passed || assessment.quality < 80 || assessment.errors !== 0) continue;
    // A challenger must not be worse than the current holder on the same case.
    if (trainee.purpose === "incumbent" || assessment.incumbentQuality <= assessment.quality) byFixture.set(assessment.benchmarkId, assessment);
  }
  return [...byFixture.values()];
}

function productionEvidence(trainee: Trainee): AcademyAssessment[] {
  return (trainee.assessments || []).filter((assessment) => assessment.scope === "production" && assessment.benchmarkId.startsWith(PRODUCTION_PREFIX));
}

/** Is the trainee replacing a fired holder (the career waits in the academy for this generation)? */
export function isBlackRoomReplacement(state: CompanyState, trainee: Trainee): boolean {
  const career = state.careers[trainee.forAgentId];
  return Boolean(career && career.inTrainingUntilGeneration === career.generation && trainee.id === `${career.agentId}#${career.generation}`);
}

/**
 * Graduation with evidence. A Black Room trainee graduates only when it (1) finished its
 * curriculum, (2) passed BLACKROOM_ACADEMY_REQUIRED_PASSES distinct benchmark cases graded on the
 * server, and (3) its role then produced a REAL run (a fresh "working" evidence id from the
 * agent's own lastRunAt, observed after the passes). The real run is recorded once as a
 * production assessment. A replacement then takes the job; a refresher adds skills.
 */
export function advanceBlackRoomAcademy(
  state: CompanyState,
  statuses: Record<string, { state: string; evidenceId?: string } | undefined>,
  now: number,
): CompanyState {
  const iso = new Date(now).toISOString();
  let next = state;
  for (const trainee of state.trainees) {
    if (!active(trainee) || !BLACKROOM_ACADEMY_ROLES.includes(trainee.forAgentId)) continue;
    const career = next.careers[trainee.forAgentId];
    if (!career || (trainee.generation !== undefined && trainee.generation !== career.generation)) continue;
    const course = trainee.curriculumSnapshot || [];
    if (!course.length || course.some((module) => !trainee.modulesDone.includes(module.id))) continue;
    const passes = benchmarkPasses(trainee);
    if (passes.length < BLACKROOM_ACADEMY_REQUIRED_PASSES) continue;
    const qualifiedAt = Math.max(...passes.map((pass) => toMs(pass.completedAt)));
    let current = next.trainees.find((item) => item.id === trainee.id)!;
    const status = statuses[trainee.forAgentId];
    const evidenceId = status?.state === "working" ? status.evidenceId?.trim() : undefined;
    const evidenceAt = evidenceId ? toMs(evidenceId.split(":").slice(2).join(":")) : 0;
    if (evidenceId && (evidenceAt === 0 || evidenceAt >= qualifiedAt) && !productionEvidence(current).some((item) => item.runId === evidenceId)) {
      next = recordAcademyAssessment(next, trainee.id, {
        scope: "production", runId: evidenceId, benchmarkId: `${PRODUCTION_PREFIX}${evidenceId}`, curriculumVersion: "blackroom-produccion",
        completedAt: iso, artifactId: evidenceId, passed: true, quality: 100, incumbentQuality: 0, errors: 0, incumbentErrors: 0,
        durationMs: 0, incumbentDurationMs: 0, cost: 0, incumbentCost: 0,
      });
      current = next.trainees.find((item) => item.id === trainee.id)!;
    }
    if (!productionEvidence(current).length) {
      next = { ...next, trainees: next.trainees.map((item) => item.id === trainee.id ? { ...item, qualifiedAt: item.qualifiedAt || iso, awaitingEvidence: true, executionBlocker: "Paso los casos de la academia Black Room; espera una ejecucion real verificada del puesto." } : item) };
      continue;
    }
    let graduated: AgentCareer = career;
    for (const item of (current.learned || []).slice(0, 6)) graduated = addSkill(graduated, { id: item.id, title: item.title, source: "academia" }, iso);
    const replacement = isBlackRoomReplacement(next, current);
    graduated = {
      ...graduated,
      inTrainingUntilGeneration: replacement ? undefined : graduated.inTrainingUntilGeneration,
      memory: [{ at: iso, text: `Se graduo en la academia Black Room (${passes.length} casos aprobados y una ejecucion real verificada).` }, ...graduated.memory].slice(0, 12),
    };
    next = {
      ...next,
      careers: { ...next.careers, [career.agentId]: graduated },
      trainees: next.trainees.map((item) => item.id === trainee.id ? { ...item, graduatedAt: iso, qualifiedAt: item.qualifiedAt || iso, awaitingEvidence: false, executionBlocker: undefined } : item),
      events: [{ at: iso, text: `${current.nickname} se graduo en la academia Black Room como ${current.role}.` }, ...next.events].slice(0, MAX_EVENTS),
    };
  }
  return next;
}

export type BlackRoomAcademyRow = {
  id: string;
  nickname: string;
  role: string;
  forAgentId: string;
  purpose: "refresco" | "reemplazo" | "aspirante";
  startedAt: string;
  modulesDone: number;
  modulesTotal: number;
  lessonsStudied: number;
  casesPassed: number;
  casesTried: number;
  averageQuality: number | null;
  realRuns: number;
  status: "estudiando" | "evaluando" | "espera ejecucion real" | "graduado" | "cerrado";
  graduatedAt: string | null;
};

export type BlackRoomAcademySummary = {
  rows: BlackRoomAcademyRow[];
  active: number;
  graduated: number;
  careers: Array<{ agentId: string; nickname: string; generation: number; points: number; battery: number; firedCount: number; inTraining: boolean }>;
  jobs: { today: number; running: number; blocked: number };
};

/** What the office shows in the "Academia Black Room" tab (only data already in the company state). */
export function blackRoomAcademySummary(state: CompanyState | null | undefined, now = Date.now()): BlackRoomAcademySummary {
  const trainees = (state?.trainees || []).filter((trainee) => isBlackRoomAcademyMember(trainee.forAgentId));
  const rows = trainees.map((trainee): BlackRoomAcademyRow => {
    const benchmarks = (trainee.assessments || []).filter((assessment) => assessment.scope === "benchmark");
    const passes = benchmarkPasses(trainee).length;
    const course = trainee.curriculumSnapshot || [];
    const done = course.length ? course.filter((module) => trainee.modulesDone.includes(module.id)).length : trainee.modulesDone.length;
    const replacement = Boolean(state && isBlackRoomReplacement(state, trainee));
    const status: BlackRoomAcademyRow["status"] = trainee.graduatedAt ? "graduado"
      : trainee.evaluationClosedAt ? "cerrado"
        : course.length && done < course.length ? "estudiando"
          : passes >= BLACKROOM_ACADEMY_REQUIRED_PASSES ? "espera ejecucion real" : "evaluando";
    return {
      id: trainee.id,
      nickname: trainee.nickname,
      role: trainee.role,
      forAgentId: trainee.forAgentId,
      purpose: replacement || /#\d+$/.test(trainee.id) ? "reemplazo" : trainee.purpose === "candidate" ? "aspirante" : "refresco",
      startedAt: trainee.startedAt,
      modulesDone: done,
      modulesTotal: course.length || trainee.modulesDone.length,
      lessonsStudied: trainee.modulesDone.filter((id) => id.startsWith("leccion:blackroom:")).length,
      casesPassed: passes,
      casesTried: new Set(benchmarks.map((assessment) => assessment.benchmarkId)).size,
      averageQuality: benchmarks.length ? Math.round(benchmarks.reduce((sum, assessment) => sum + assessment.quality, 0) / benchmarks.length) : null,
      realRuns: productionEvidence(trainee).length,
      status,
      graduatedAt: trainee.graduatedAt || null,
    };
  }).sort((a, b) => Number(a.status === "graduado") - Number(b.status === "graduado") || b.startedAt.localeCompare(a.startedAt));
  const careers = BLACKROOM_DEPARTMENT_ORDER.map((id) => state?.careers[id]).filter((career): career is AgentCareer => Boolean(career)).map((career) => ({
    agentId: career.agentId, nickname: career.nickname, generation: career.generation, points: career.points, battery: career.battery, firedCount: career.firedCount, inTraining: Boolean(career.inTrainingUntilGeneration),
  }));
  const jobs = state?.blackroomAcademyJobs || [];
  return {
    rows,
    active: rows.filter((row) => row.status !== "graduado" && row.status !== "cerrado").length,
    graduated: rows.filter((row) => row.status === "graduado").length,
    careers,
    jobs: { today: jobs.filter((job) => now - Date.parse(job.startedAt) < 86_400_000).length, running: jobs.filter((job) => job.status === "running").length, blocked: jobs.filter((job) => job.status === "blocked" || job.status === "unknown").length },
  };
}
