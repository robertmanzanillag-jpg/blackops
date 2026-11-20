import { createHash } from "node:crypto";
import { canonicalRepairJson, KONG_REPAIR_REPOSITORY, type RepairEntry } from "./kong-repair-bridge";
export interface SupersessionGit {
  readRef(ref: string): Promise<{ sha: string } | null>;
  readFence(sha: string): Promise<string | null>;
  createFence(content: string): Promise<string>;
  createRef(ref: string, sha: string): Promise<void>;
}
/** The same atomic ref claimed by the worker is the exclusion fence. Absence
 * alone never permits another generation. No overwrite/delete/force is allowed. */
export async function fenceUnclaimedRepair(entry: RepairEntry, next: { baseSha: string; engineSourceCommit: string }, git: SupersessionGit) {
  if (!entry.issueUrl || !entry.approvedBaseSha || !entry.sourceDigest || !entry.engineSourceCommit || entry.maker || entry.githubClaimRef ||
    !["handoff_created", "held_stale_base"].includes(entry.status) || (next.baseSha === entry.approvedBaseSha && next.engineSourceCommit === entry.engineSourceCommit) ||
    !/^[a-f0-9]{40}$/.test(next.baseSha) || !/^[a-f0-9]{40}$/.test(next.engineSourceCommit)) return { state: "held" as const };
  const ref = `refs/heads/codex/repair-claim/${entry.key.split(":")[1]}`;
  const payload = { version: 1, kind: "kong_repair_superseded_unclaimed", company: "kong", repository: KONG_REPAIR_REPOSITORY,
    repairKey: entry.key, sourceDigest: entry.sourceDigest, sourceTaskId: entry.payload.sourceTaskId,
    oldBaseSha: entry.approvedBaseSha, oldEngineSourceCommit: entry.engineSourceCommit, nextBaseSha: next.baseSha, nextEngineSourceCommit: next.engineSourceCommit };
  const canonical = canonicalRepairJson(payload), digest = createHash("sha256").update(canonical).digest("hex");
  const existing = await git.readRef(ref);
  if (existing) {
    if (existing.sha === entry.approvedBaseSha) return { state: "maker_claimed" as const, ref };
    const evidence = await git.readFence(existing.sha);
    return evidence === canonical ? { state: "superseded_unclaimed" as const, ref, digest } : { state: "held" as const };
  }
  const fenceSha = await git.createFence(canonical);
  try { await git.createRef(ref, fenceSha); }
  catch {
    // A lost acknowledgment is reconciled only from the exact immutable fence.
    const winner = await git.readRef(ref);
    if (!winner) return { state: "held" as const };
    if (winner.sha === entry.approvedBaseSha) return { state: "maker_claimed" as const, ref };
    if (await git.readFence(winner.sha) !== canonical) return { state: "held" as const };
  }
  return { state: "superseded_unclaimed" as const, ref, digest };
}
