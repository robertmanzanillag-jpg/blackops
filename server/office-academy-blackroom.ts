import { createHash, randomUUID } from "node:crypto";
import { recordAcademyAssessment, type BlackRoomAcademyJob, type CompanyState } from "../shared/agent-company";
import { BLACKROOM_ACADEMY_ROLES, isBlackRoomReplacement } from "../shared/blackroom-academy";
import type { BlackRoomTeamLessonRule } from "../shared/blackroom-team";
import { academyCurriculumVersion } from "./office-academy-runner";
import {
  BLACKROOM_CURRICULUM_LIMITS,
  blackRoomFixtureDigest,
  blackRoomRoleFixtures,
  buildBlackRoomRolePrompt,
  gradeBlackRoomRoleResponse,
  isBlackRoomCurriculumRole,
  type BlackRoomRoleFixture,
} from "./office-role-blackroom-curricula";
import type { OfficeOpenAIResult } from "./office-openai";

/** Black Room academy runner: paired, read-only curriculum evaluations for Black Room trainees.
 * Cheap-first and bounded: at most `dailyPairs` jobs per 24 h (1..14, required), one at a time,
 * never while another academy track is running, through the injected `run` (the worker passes
 * the same measured, budget-admitted OpenAI execution the role academy uses; no new provider).
 * A replacement for a fired agent has no holder to compare with, so only the candidate runs.
 * A budget refusal blocks the job; an uncertain call is kept "unknown" and never retried. */
export type BlackRoomAcademyCouncil = {
  updateBlackRoomAcademy(change: (company: CompanyState, busy: boolean) => CompanyState): Promise<CompanyState>;
};
export type BlackRoomAcademyCall = { executionId: string; maxOutputTokens: number };

const LEASE_MS = 6 * 60_000;
const DAY_MS = 86_400_000;
const MAX_JOBS = 200;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function lessonsFor(rules: Record<string, BlackRoomTeamLessonRule[]> | undefined, role: string): BlackRoomTeamLessonRule[] {
  return Array.isArray(rules?.[role]) ? rules![role] : [];
}

export function createBlackRoomAcademyRunner(options: {
  council: BlackRoomAcademyCouncil;
  run: (prompt: string, call: BlackRoomAcademyCall) => Promise<OfficeOpenAIResult>;
  dailyPairs: number;
  /** Real lessons per agent (server/blackroom-team/lessons.ts); read before the reservation. */
  loadLessons?: () => Promise<Record<string, BlackRoomTeamLessonRule[]>>;
  now?: () => number;
  shouldStop?: () => boolean;
}) {
  if (!Number.isSafeInteger(options.dailyPairs) || options.dailyPairs < 1 || options.dailyPairs > 14) throw Error("BLACKROOM_ACADEMY_DAILY_LIMIT_REQUIRED");
  const now = options.now || Date.now;
  return {
    async tick(): Promise<void> {
      if (options.shouldStop?.()) return;
      const rules = await (options.loadLessons?.() ?? Promise.resolve({})).catch(() => ({} as Record<string, BlackRoomTeamLessonRule[]>));
      const start = now();
      const id = randomUUID();
      const fence = randomUUID();
      let admitted: { job: BlackRoomAcademyJob; fixtures: BlackRoomRoleFixture[]; fixture: BlackRoomRoleFixture; knowledge: string[] } | undefined;
      await options.council.updateBlackRoomAcademy((company, busy) => {
        admitted = undefined;
        const jobs = (company.blackroomAcademyJobs || []).map((job) => job.status === "running" && Date.parse(job.expiresAt) <= start
          ? { ...job, status: "unknown" as const, reason: "Evaluacion interrumpida; conciliar antes de reintentar." } : job);
        const next: CompanyState = { ...company, blackroomAcademyJobs: jobs.slice(-MAX_JOBS) };
        if (busy || jobs.some((job) => job.status === "running")) return next;
        if (jobs.filter((job) => start - Date.parse(job.startedAt) < DAY_MS).length >= options.dailyPairs) return next;
        // Fair order: replacements first (a fired job is empty), then the least evaluated role.
        const candidates = company.trainees
          .filter((trainee) => !trainee.graduatedAt && !trainee.evaluationClosedAt && BLACKROOM_ACADEMY_ROLES.includes(trainee.forAgentId))
          .sort((a, b) => Number(isBlackRoomReplacement(company, b)) - Number(isBlackRoomReplacement(company, a))
            || jobs.filter((job) => job.role === a.forAgentId).length - jobs.filter((job) => job.role === b.forAgentId).length
            || a.id.localeCompare(b.id));
        for (const trainee of candidates) {
          const role = trainee.forAgentId;
          const career = company.careers[role];
          const course = trainee.curriculumSnapshot || [];
          if (!isBlackRoomCurriculumRole(role) || !career || (trainee.generation !== undefined && trainee.generation !== career.generation)) continue;
          // Study first: the evaluation starts once every module of its curriculum is done.
          if (!course.length || course.some((module) => !trainee.modulesDone.includes(module.id))) continue;
          const mine = jobs.filter((job) => job.traineeId === trainee.id);
          // Uncertain calls wait for reconciliation; a budget refusal may be retried the next day.
          if (mine.some((job) => job.status === "unknown" || (job.status === "blocked" && start - Date.parse(job.startedAt) < DAY_MS))) continue;
          const fixtures = blackRoomRoleFixtures(role, lessonsFor(rules, role));
          const passed = new Set(mine.filter((job) => job.status === "completed" && job.passed).map((job) => job.fixtureId));
          const tried = new Map<string, number>();
          for (const job of mine.filter((item) => item.status === "completed")) tried.set(job.fixtureId, (tried.get(job.fixtureId) || 0) + 1);
          // Lesson cases first (real mistakes), then base cases; a failed case may be retried once.
          const fixture = [...fixtures.filter((item) => item.origin === "leccion"), ...fixtures.filter((item) => item.origin === "base")]
            .find((item) => !passed.has(item.id) && (tried.get(item.id) || 0) < 2);
          if (!fixture) continue;
          const job: BlackRoomAcademyJob = {
            id, fence, traineeId: trainee.id, role, generation: career.generation, fixtureId: fixture.id, fixtureDigest: blackRoomFixtureDigest(fixture),
            curriculumVersion: academyCurriculumVersion(course), replacement: isBlackRoomReplacement(company, trainee),
            startedAt: new Date(start).toISOString(), expiresAt: new Date(start + LEASE_MS).toISOString(), status: "running",
          };
          admitted = { job, fixtures, fixture, knowledge: [...trainee.knowledge, ...lessonsFor(rules, role).map((rule) => rule.text)] };
          return { ...next, blackroomAcademyJobs: [...next.blackroomAcademyJobs!, job].slice(-MAX_JOBS) };
        }
        return next;
      });
      if (!admitted) return;
      const { job, fixtures, fixture, knowledge } = admitted;
      const finish = (change: (company: CompanyState, stored: BlackRoomAcademyJob) => CompanyState) => options.council.updateBlackRoomAcademy((company) => {
        const stored = company.blackroomAcademyJobs?.find((item) => item.id === job.id);
        if (!stored || stored.fence !== fence || stored.status !== "running") return company;
        return change(company, stored);
      });
      try {
        const call = async (subject: "incumbent" | "candidate", lessons: string[]) => {
          if (options.shouldStop?.() || now() >= Date.parse(job.expiresAt)) throw Error("BLACKROOM_ACADEMY_STOPPED");
          const began = now();
          const result = await options.run(buildBlackRoomRolePrompt(fixtures, fixture.id, lessons), { executionId: `blackroom-academy:${job.id}:${subject}`, maxOutputTokens: BLACKROOM_CURRICULUM_LIMITS.maxOutputTokens });
          if (result.provider !== "openai" || !result.sessionId || !result.usage || !Number.isSafeInteger(result.usage.totalTokens)) throw Error("BLACKROOM_ACADEMY_UNMEASURED");
          return { result, durationMs: Math.max(1, now() - began), grade: gradeBlackRoomRoleResponse(fixture, result.text) };
        };
        // The holder answers with no study notes; the trainee with what it studied and the real lessons.
        const incumbent = job.replacement ? null : await call("incumbent", []);
        const candidate = await call("candidate", knowledge.slice(0, BLACKROOM_CURRICULUM_LIMITS.maxTrainingLessons));
        if (incumbent && (incumbent.result.sessionId === candidate.result.sessionId || incumbent.result.model !== candidate.result.model)) throw Error("BLACKROOM_ACADEMY_INCOMPARABLE");
        await finish((company, stored) => {
          const trainee = company.trainees.find((item) => item.id === stored.traineeId);
          const completedAt = new Date(now()).toISOString();
          if (!trainee || company.careers[stored.role]?.generation !== stored.generation || Date.parse(stored.expiresAt) <= now()) {
            return { ...company, blackroomAcademyJobs: company.blackroomAcademyJobs!.map((item) => item.id === job.id ? { ...item, status: "unknown" as const, reason: "La asignacion cambio durante la evaluacion." } : item) };
          }
          const artifactId = digest({ job: stored.id, fixture: stored.fixtureDigest, incumbent: incumbent?.result.text ?? null, candidate: candidate.result.text, sessions: [incumbent?.result.sessionId ?? null, candidate.result.sessionId] });
          let next = recordAcademyAssessment(company, trainee.id, {
            scope: "benchmark", profileId: "blackroom-academy", profileVersion: "1", runId: stored.id, benchmarkId: stored.fixtureId,
            curriculumVersion: stored.curriculumVersion, completedAt, artifactId, passed: candidate.grade.passed, quality: candidate.grade.quality,
            incumbentQuality: incumbent?.grade.quality ?? 0, errors: candidate.grade.errors.length, incumbentErrors: incumbent?.grade.errors.length ?? 0,
            durationMs: candidate.durationMs, incumbentDurationMs: incumbent?.durationMs ?? 0,
            cost: candidate.result.usage.totalTokens, incumbentCost: incumbent?.result.usage.totalTokens ?? 0, costBasis: "measured_tokens_not_usd",
          });
          next = { ...next, blackroomAcademyJobs: (next.blackroomAcademyJobs || []).map((item) => item.id === job.id ? {
            ...item, status: "completed" as const, completedAt, artifactId, passed: candidate.grade.passed, candidateQuality: candidate.grade.quality, incumbentQuality: incumbent ? incumbent.grade.quality : null,
          } : item) };
          return next;
        });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
        const budget = ["token_budget_exhausted", "shared_credit_unavailable", "shared_credit_exhausted"].includes(code);
        await finish((company) => ({ ...company, blackroomAcademyJobs: company.blackroomAcademyJobs!.map((item) => item.id === job.id ? {
          ...item, status: budget ? "blocked" as const : "unknown" as const,
          reason: budget ? "Presupuesto o creditos no disponibles; no se sube el presupuesto automaticamente." : "Ejecucion sin confirmar; conciliar antes de reintentar.",
        } : item) }));
      }
    },
  };
}
