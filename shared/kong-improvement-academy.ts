// Academia skills learned from KONG improvements that Robert approved and merged ($0, no AI, no IO).
// Same pattern as learnClippersLessons in shared/agent-self-improvement.ts: a supported lesson becomes an
// "academia" skill (once each) on the agents that did the work, plus one memory line.
import { addSkill, type CompanyState } from "./agent-company";

export type KongImprovementLesson = {
  id: string; agentIds: string[]; title: string; detail: string; supported: true; samples: number; evaluatedAt: string;
};

const SAFE_ID = /[^A-Za-z0-9_.:-]/g;

export function lessonFromMergedImprovement(input: { prNumber: number; headSha: string; title: string; agents: Array<{ id: string; name: string; verdict: string }>; mergedAt: string }): KongImprovementLesson {
  const passed = input.agents.filter(agent => agent.verdict === "pass" || agent.verdict === "warn");
  return {
    id: `kong-mejora:${input.prNumber}:${input.headSha.slice(0, 7)}`,
    agentIds: ["kong-improvement-scouts", ...passed.map(agent => `kong-mirror:${agent.id.replace(SAFE_ID, "")}`)].slice(0, 12),
    title: input.title.slice(0, 70),
    detail: `Mejora KONG probada por ${input.agents.length} agentes en el Mirror Lab y aprobada por Robert (PR #${input.prNumber}).`,
    supported: true, samples: input.agents.length, evaluatedAt: input.mergedAt,
  };
}

/** Adds each lesson once as an academia skill of the agents that exist in the company. */
export function learnKongImprovementLessons(company: CompanyState, lessons: KongImprovementLesson[], now: number): CompanyState {
  const iso = new Date(now).toISOString();
  let careers = company.careers;
  for (const lesson of lessons) {
    for (const agentId of lesson.agentIds) {
      const career = careers[agentId];
      const skillId = `academia:${lesson.id}`;
      if (!career || career.inTrainingUntilGeneration || (career.skills || []).some(skill => skill.id === skillId)) continue;
      careers = { ...careers, [agentId]: { ...addSkill(career, { id: skillId, title: `Aprendió: ${lesson.title}`.slice(0, 80), source: "academia" }, iso),
        memory: [{ at: iso, text: `Academia KONG: ${lesson.title}. ${lesson.detail}`.slice(0, 220) }, ...career.memory].slice(0, 12) } };
    }
  }
  return careers === company.careers ? company : { ...company, careers };
}
