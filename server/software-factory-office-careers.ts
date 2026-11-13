import { createHash } from "node:crypto";
import type { createAgentCouncil } from "./agent-council";
import { applyFactoryStageOutcomes, parseFactoryCareerLedger, type FactoryJobRow } from "../shared/factory-office-agents";

/** Factory stage outcomes -> main-company careers (lives) of the factory engineers.
 *
 * Reconciliation sweep run by the factory worker before order scheduling, the
 * same crash-safe pattern as the office review handoff: it reads only stage rows
 * the factory store has already committed (completed/failed/blocked with a
 * completion time) and applies them inside one durable council transaction.
 * The ledger of processed evidence ids is written in that same transaction, so
 * a crash before commit is repaired by the next sweep and a crash after commit
 * never scores twice. No provider call, no GitHub write, no factory guardrail
 * (draft PRs, write scope, daily cap, credit ledger) is read or changed. */
export function createFactoryCareerSweep(options: {
  owner: string;
  council: Pick<ReturnType<typeof createAgentCouncil>, "updateOfficeExecution">;
  readJobs: () => Promise<readonly FactoryJobRow[]>;
  now?: () => number;
}) {
  if (typeof options.owner !== "string" || !options.owner.trim() || typeof options.readJobs !== "function" || typeof options.council?.updateOfficeExecution !== "function") throw Error("FACTORY_CAREER_SWEEP_CONFIGURATION_INVALID");
  const ownerKey = createHash("sha256").update(options.owner).digest("hex");
  const now = options.now || Date.now;
  let active: Promise<{ scored: number; processed: number }> | undefined;
  const sweep = async () => {
    const jobs = await options.readJobs();
    if (!Array.isArray(jobs)) throw Error("FACTORY_CAREER_JOBS_UNAVAILABLE");
    const snapshot = structuredClone(jobs.filter(job => job?.ownerKey === ownerKey));
    let scored = 0, processed = 0;
    await options.council.updateOfficeExecution((state, company) => {
      // CAS may replay this callback: it is a pure function of the stored state and the snapshot.
      const at = now();
      const ledger = parseFactoryCareerLedger(state.factoryCareers);
      const result = applyFactoryStageOutcomes({ company, ledger, jobs: snapshot, ownerKey, now: at });
      const before = new Set(ledger.processed.map(entry => entry.evidenceId));
      scored = result.scored.length; processed = result.ledger.processed.filter(entry => !before.has(entry.evidenceId)).length;
      Object.assign(company, result.company);
      return { ...state, factoryCareers: result.ledger };
    });
    return { scored, processed };
  };
  return () => active ||= sweep().finally(() => { active = undefined; });
}
