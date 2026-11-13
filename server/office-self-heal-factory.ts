import { createHash } from "node:crypto";
import type { CompanyState } from "../shared/agent-company";
import type { FactoryOrderProposal } from "../shared/software-factory-view";
import type { FactoryJob } from "./software-factory-store";
import { recordSelfHealFactory, type SelfHealFactoryObservation } from "./office-self-heal";

/** Factory worker side of the office self-heal loop (OFFICE_SELF_HEAL_ENABLED).
 *
 * Reads only rows the factory store already committed and the office review
 * verdicts already linked to verified proposals, then records the chain on the
 * matching self-heal attempt inside one council transaction. It never admits,
 * enqueues, writes to GitHub, merges, dispatches or calls a model. */
const SAFE_ID = /^[a-zA-Z0-9:_-]{1,200}$/;
const REASON = /^[A-Z0-9_]{1,100}$/;
type Observation = SelfHealFactoryObservation & { orderId: string; orderRevision: string };
const pipelineRoot = (job: FactoryJob) => ((job.result as { evidence?: { pipelineState?: { rootJobId?: unknown } } } | undefined)?.evidence?.pipelineState?.rootJobId);

/** Pure: one observation per company-order root job in the bounded listing. */
export function observeFactoryForSelfHeal(input: { owner: string; jobs: readonly FactoryJob[]; proposals: readonly FactoryOrderProposal[]; proposalStatus: "complete" | "partial" | "unavailable"; now: number }): Observation[] {
  const ownerKey = createHash("sha256").update(input.owner).digest("hex"), observedAt = new Date(input.now).toISOString();
  const jobs = input.jobs.filter(j => j?.ownerKey === ownerKey);
  const out: Observation[] = [];
  for (const root of jobs) {
    const source = root.payload?.companyOrder as { version?: unknown; company?: unknown; orderId?: unknown; revision?: unknown } | undefined;
    if (root.kind !== "discover" || !source || source.version !== 1 || source.company !== "main" || typeof source.orderId !== "string" || !source.orderId.startsWith("ord-sh-") || typeof source.revision !== "string" || !/^[a-f0-9]{64}$/.test(source.revision) || !SAFE_ID.test(root.id)) continue;
    const base = { orderId: source.orderId, orderRevision: source.revision, observedAt, rootJobId: root.id };
    const proposal = input.proposals.filter(p => p.orderId === source.orderId && p.orderRevision === source.revision).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0];
    if (proposal) {
      out.push({ ...base, state: "proposal", reviewJobId: proposal.reviewJobId, prUrl: proposal.prUrl, baseSha: proposal.baseSha, headSha: proposal.headSha, proposalCompletedAt: proposal.completedAt,
        // A verified proposal exists only when proposalEvidenceGate accepted passing checks and an independent review.
        checks: "pass", independentReview: "pass",
        ...(proposal.officeReview ? { officeReview: { status: proposal.officeReview.status, ...(proposal.officeReview.findingsCount !== undefined ? { findingsCount: proposal.officeReview.findingsCount } : {}), ...(proposal.officeReview.runId ? { runId: proposal.officeReview.runId } : {}) } } : {}) });
      continue;
    }
    const chain = jobs.filter(j => j.id === root.id || pipelineRoot(j) === root.id);
    const reasonOf = (j: FactoryJob) => { const r = (j.result as { reason?: unknown } | undefined)?.reason; return typeof r === "string" && REASON.test(r) ? r : undefined; };
    if (chain.some(j => j.status === "unknown")) { out.push({ ...base, state: "unknown" }); continue; }
    if (chain.some(j => j.status === "pending" || j.status === "running")) { out.push({ ...base, state: chain.some(j => j.status === "running") || chain.length > 1 ? "running" : "pending" }); continue; }
    const stopped = chain.find(j => j.status === "blocked" || j.status === "failed");
    if (stopped) { const reason = reasonOf(stopped); out.push({ ...base, state: stopped.status as "blocked" | "failed", ...(reason ? { reason } : {}) }); continue; }
    // Every stage completed but no verified proposal: only conclusive when the proposal read was complete.
    if (input.proposalStatus === "complete" && chain.length) {
      const last = [...chain].sort((a, b) => Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt))[0];
      const terminal = !(last.result as { next?: unknown } | undefined)?.next;
      if (terminal) { const reason = reasonOf(last); out.push({ ...base, state: "failed", reason: reason ?? "FACTORY_NO_VERIFIED_PROPOSAL" }); continue; }
    }
    out.push({ ...base, state: "running" });
  }
  return out;
}

export function createSelfHealFactorySync(options: {
  owner: string;
  council: { updateOfficeExecution(change: (execution: any, company: CompanyState) => any): Promise<unknown> };
  readJobs: () => Promise<readonly FactoryJob[]>;
  /** Verified proposals already linked to the office review verdict (linkFactoryOfficeReviews). */
  readProposals: () => Promise<{ proposals: FactoryOrderProposal[]; status: "complete" | "partial" | "unavailable" }>;
  now?: () => number;
}) {
  if (typeof options.owner !== "string" || !options.owner.trim() || typeof options.readJobs !== "function" || typeof options.readProposals !== "function" || typeof options.council?.updateOfficeExecution !== "function") throw Error("SELF_HEAL_FACTORY_CONFIGURATION_INVALID");
  const now = options.now || Date.now;
  let active: Promise<{ changed: boolean }> | undefined;
  const sync = async () => {
    const [jobs, read] = await Promise.all([options.readJobs(), options.readProposals()]);
    if (!Array.isArray(jobs) || !read || !Array.isArray(read.proposals)) throw Error("SELF_HEAL_FACTORY_READ_INVALID");
    const at = now();
    const observations = observeFactoryForSelfHeal({ owner: options.owner, jobs: structuredClone(jobs), proposals: structuredClone(read.proposals), proposalStatus: read.status, now: at });
    let changed = false;
    if (!observations.length) return { changed };
    await options.council.updateOfficeExecution((execution, company) => {
      if (execution.selfHeal === undefined) return execution;
      const result = recordSelfHealFactory({ state: execution.selfHeal, company, observations, journal: execution.roleWork, owner: options.owner, now: at });
      changed = result.changed;
      if (!result.changed) return execution;
      Object.assign(company, { orders: result.company.orders });
      return { ...execution, selfHeal: result.state };
    });
    return { changed };
  };
  return () => active ||= sync().finally(() => { active = undefined; });
}
