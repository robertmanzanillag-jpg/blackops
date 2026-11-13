import { createHash } from "node:crypto";
import type { FactoryOrderProposal, FactoryOfficeReviewLink } from "../shared/software-factory-view";
import type { OfficeRun } from "./office-runtime";

/** Factory draft PR -> office reviewer handoff. This module never calls a
 * provider, never writes to GitHub, never merges, dispatches or closes orders.
 * It only enqueues one read-only office review per (factory job, exact head)
 * and links the stored verdict back to the order evidence for display. */
const PR = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/;
const SHA = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[a-zA-Z0-9:_-]{1,200}$/;
const ownerHash = (owner: string) => createHash("sha256").update(owner).digest("hex");

/** Permanent idempotency key: a UUID-shaped digest of (owner, factory job, head). */
export function factoryOfficeReviewKey(owner: string, factoryJobId: string, headSha: string): string {
  if (typeof owner !== "string" || !owner.trim() || !SAFE_ID.test(factoryJobId) || !SHA.test(headSha)) throw Error("FACTORY_OFFICE_REVIEW_KEY_INVALID");
  const digest = createHash("sha256").update(`office:factory-review:v1:${ownerHash(owner)}:${factoryJobId}:${headSha}`).digest();
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Only verified factory proposals with a recorded draft PR are eligible. */
function eligible(proposal: FactoryOrderProposal): boolean {
  return !!proposal && proposal.scope === "reviewed_proposal" && proposal.published === false && SAFE_ID.test(proposal.reviewJobId) &&
    typeof proposal.prUrl === "string" && PR.test(proposal.prUrl) && SHA.test(proposal.headSha) && proposal.headSha !== proposal.baseSha;
}

export type FactoryOfficeReviewEnqueue = (owner: string, input: { prUrl: string; key: string; maxPerDay: number }) => Promise<{ status: "enqueued" | "existing" | "daily_cap" }>;
export interface FactoryOfficeReviewSweepResult { enqueued: number; existing: number; capped: boolean; skipped: number }

/** Reconciliation sweep, run by the factory worker before order scheduling.
 * Crash-safe by construction: each eligible proposal maps to one permanent
 * key and the store insert is idempotent under the owner lock, so a crash at
 * any point is repaired by the next sweep without double enqueue. */
export function createFactoryOfficeReviewSweep(options: {
  owner: string;
  maxPerDay: number;
  readProposals: () => Promise<{ proposals: FactoryOrderProposal[]; status: "complete" | "partial" | "unavailable" }>;
  enqueue: FactoryOfficeReviewEnqueue;
}) {
  const { owner, maxPerDay } = options;
  if (typeof owner !== "string" || !owner.trim() || !Number.isSafeInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > 20 ||
    typeof options.readProposals !== "function" || typeof options.enqueue !== "function") throw Error("FACTORY_OFFICE_REVIEW_CONFIGURATION_INVALID");
  let active: Promise<FactoryOfficeReviewSweepResult> | undefined;
  const sweep = async (): Promise<FactoryOfficeReviewSweepResult> => {
    const out: FactoryOfficeReviewSweepResult = { enqueued: 0, existing: 0, capped: false, skipped: 0 };
    const read = await options.readProposals();
    if (!read || !Array.isArray(read.proposals) || read.status === "unavailable") return out;
    const seen = new Set<string>();
    const ordered = [...read.proposals].sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt) || String(a.reviewJobId).localeCompare(String(b.reviewJobId)));
    for (const proposal of ordered) {
      if (!eligible(proposal)) { out.skipped++; continue; }
      const key = factoryOfficeReviewKey(owner, proposal.reviewJobId, proposal.headSha);
      if (seen.has(key)) continue;
      seen.add(key);
      const result = await options.enqueue(owner, { prUrl: proposal.prUrl, key, maxPerDay });
      if (result?.status === "enqueued") out.enqueued++;
      else if (result?.status === "existing") out.existing++;
      else if (result?.status === "daily_cap") { out.capped = true; break; }
      else throw Error("FACTORY_OFFICE_REVIEW_ENQUEUE_UNCONFIRMED");
    }
    return out;
  };
  return () => active ||= sweep().finally(() => { active = undefined; });
}

/** Read-only display link. A verdict counts only when the stored office review
 * is bound to the same PR and the exact head recorded by the factory. */
export function linkFactoryOfficeReview(owner: string, proposal: FactoryOrderProposal, runs: readonly OfficeRun[]): FactoryOfficeReviewLink {
  if (!eligible(proposal)) return { status: "not_requested" };
  const key = factoryOfficeReviewKey(owner, proposal.reviewJobId, proposal.headSha);
  const run = runs.find(r => r.key === key && r.kind === "claude_review" && r.prUrl === proposal.prUrl);
  if (!run) return { status: "not_requested" };
  if (run.status === "accepted") return { status: "pending", runId: run.id };
  if (run.status === "running") return { status: "running", runId: run.id };
  if (run.status !== "completed") return { status: "failed", runId: run.id, ...(run.completedAt ? { completedAt: run.completedAt } : {}) };
  const review = run.review;
  if (!review || !run.sessionId || !run.completedAt) return { status: "failed", runId: run.id };
  if (review.prUrl !== proposal.prUrl || review.headSha !== proposal.headSha) return { status: "head_mismatch", runId: run.id, completedAt: run.completedAt };
  if (review.verdict === "pass" && review.findings.length) return { status: "failed", runId: run.id };
  return { status: review.verdict, findingsCount: review.findings.length, runId: run.id, completedAt: run.completedAt };
}

export function linkFactoryOfficeReviews(owner: string, proposals: readonly FactoryOrderProposal[], runs: readonly OfficeRun[] | undefined): FactoryOrderProposal[] {
  return proposals.map(proposal => ({ ...proposal, officeReview: runs ? linkFactoryOfficeReview(owner, proposal, runs) : { status: "unavailable" } }));
}
