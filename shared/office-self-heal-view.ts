// Public, client-safe shape of the office self-heal summary (server/office-self-heal.ts).
// Counts only: never record ids, PR URLs, audit details or order text.

export type SelfHealAgentSummary = { agentId: string; detected: number; repairing: number; verified: number; needsOwner: number; readyToMerge: number };
export type SelfHealOfficeView = { enabled: boolean; agents: SelfHealAgentSummary[] };

const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);

/** Defensive parse of the public view field (older servers omit it). */
export function parseSelfHealView(value: unknown): SelfHealOfficeView {
  const v = value as Partial<SelfHealOfficeView> | null | undefined;
  if (!v || typeof v !== "object" || !Array.isArray(v.agents)) return { enabled: false, agents: [] };
  return {
    enabled: v.enabled === true,
    agents: v.agents.filter((a): a is SelfHealAgentSummary => Boolean(a) && typeof a === "object" && typeof (a as SelfHealAgentSummary).agentId === "string")
      .map(a => ({ agentId: a.agentId, detected: count(a.detected), repairing: count(a.repairing), verified: count(a.verified), needsOwner: count(a.needsOwner), readyToMerge: count(a.readyToMerge) })),
  };
}

/** One monitor line per agent, in the owner's words. */
export function selfHealLine(s: SelfHealAgentSummary): string {
  const ready = s.readyToMerge ? ` (${s.readyToMerge} listo${s.readyToMerge === 1 ? "" : "s"} para fusionar: decide el dueño)` : "";
  return `Problemas: ${s.detected} detectados · ${s.repairing} en reparación · ${s.verified} reparados y verificados · ${s.needsOwner} necesitan al dueño${ready}`;
}

export function selfHealTotals(view: SelfHealOfficeView, ids?: readonly string[]): Omit<SelfHealAgentSummary, "agentId"> {
  const rows = ids ? view.agents.filter(a => ids.includes(a.agentId)) : view.agents;
  return rows.reduce((t, a) => ({ detected: t.detected + a.detected, repairing: t.repairing + a.repairing, verified: t.verified + a.verified, needsOwner: t.needsOwner + a.needsOwner, readyToMerge: t.readyToMerge + a.readyToMerge }),
    { detected: 0, repairing: 0, verified: 0, needsOwner: 0, readyToMerge: 0 });
}
