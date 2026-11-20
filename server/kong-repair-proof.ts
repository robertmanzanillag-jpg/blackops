import { createHash } from "node:crypto";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
/** The production verifier is installed and reviewed BEFORE a repair candidate.
 * Every non-builtin execution dependency is forbidden in the standalone script;
 * workflow actions must be pinned. Missing baseline sources fail closed. */
export function trustedProductionQaSources(input: { baselineWorkflow: string; deployedWorkflow: string; baselineScript: string; deployedScript: string }) {
  const { baselineWorkflow: workflow, baselineScript: script } = input;
  if (!workflow || !script || workflow.length > 65536 || script.length > 131072 ||
    digest(workflow) !== digest(input.deployedWorkflow) || digest(script) !== digest(input.deployedScript)) return false;
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gm)].map(match => match[1]);
  const runs = [...workflow.matchAll(/^\s*-?\s*run:\s*(.+)$/gm)].map(match => match[1].trim());
  if (!uses.length || uses.some(value => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[a-f0-9]{40}$/.test(value)) ||
    runs.length !== 1 || runs[0] !== "node scripts/kong-repair-production-qa.mjs") return false;
  if (/\b(?:require|eval|Function)\s*\(|\bimport\s*\(/.test(script)) return false;
  const imports = [...script.matchAll(/\b(?:import|export)\s+[^;]*?\bfrom\s*["']([^"']+)["']/g)].map(match => match[1]);
  if (imports.some(value => !value.startsWith("node:")) || /\bimport\s*["']/.test(script)) return false;
  return true;
}
export function independentAppQa(comment: { author_association?: string; user?: { login?: string }; body?: string | null }, maker: string, headSha: string, allowed: ReadonlySet<string>) {
  const actor = comment.user?.login || "", body = comment.body || "";
  return actor !== maker && allowed.has(actor) && ["OWNER", "MEMBER", "COLLABORATOR"].includes(comment.author_association || "") &&
    /\bapp\s*qa\b/i.test(body) && /\b(pass|passed|approved|aprobado)\b/i.test(body) && body.includes(headSha);
}

/** The trust root is the reviewed local parent publisher, outside the maker's
 * network/GitHub/parent-journal sandbox. This is process independence, not a
 * different GitHub login. The immutable receipt cannot be a maker output file. */
export async function parentCheckerReceipt(input: { key: string; sourceDigest?: string; sourceTaskId: string; baseSha?: string; engineSourceCommit?: string; headSha: string; prNumber: number; now: number },
  get: (repository: string, suffix: string) => Promise<any>): Promise<boolean> {
  try {
    if (!input.sourceDigest || !input.baseSha || !/^[a-f0-9]{40}$/.test(input.engineSourceCommit || "")) return false;
    const repo = "robertmanzanillag-jpg/kong-nightlife", digestKey = input.key.split(":")[1];
    if (!/^[a-f0-9]{64}$/.test(digestKey) || !/^[a-f0-9]{40}$/.test(input.headSha)) return false;
    const refName = `refs/heads/codex/repair-checker/${digestKey}/${input.headSha}`;
    const ref = await get(repo, `git/ref/${refName.slice(5)}`);
    if (ref.ref !== refName || !/^[a-f0-9]{40}$/.test(ref.object?.sha)) return false;
    const commit = await get(repo, `git/commits/${ref.object.sha}`);
    if (!Array.isArray(commit.parents) || commit.parents.length !== 0) return false;
    const tree = await get(repo, `git/trees/${commit.tree.sha}`);
    if (tree.truncated || tree.tree?.length !== 1 || tree.tree[0].path !== "receipt.json" || tree.tree[0].type !== "blob") return false;
    const blob = await get(repo, `git/blobs/${tree.tree[0].sha}`);
    if (blob.encoding !== "base64") return false;
    const raw = Buffer.from(blob.content, "base64").toString("utf8");
    if (Buffer.byteLength(raw) > 65536) return false;
    const receipt = JSON.parse(raw);
    const canonical = (value: any): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    if (canonical(receipt) !== raw.trim() || receipt.schemaVersion !== 1 || receipt.kind !== "kong_repair_parent_checker" || receipt.company !== "kong" || receipt.repository !== repo ||
      receipt.repairKey !== input.key || receipt.sourceDigest !== input.sourceDigest || receipt.sourceTaskId !== input.sourceTaskId || receipt.baseSha !== input.baseSha || receipt.headSha !== input.headSha || receipt.prNumber !== input.prNumber ||
      typeof receipt.makerInvocationId !== "string" || typeof receipt.checkerInvocationId !== "string" || !receipt.makerInvocationId || receipt.makerInvocationId === receipt.checkerInvocationId ||
      receipt.engine?.repository !== "robertmanzanillag-jpg/blackops" || receipt.engine?.sourceCommit !== input.engineSourceCommit || receipt.engine?.path !== "script/kong-repair-subscription-worker.mjs" ||
      !/^[a-f0-9]{64}$/.test(receipt.engine?.sha256 || "") || receipt.validation?.exitCode !== 0 || receipt.validation?.failures !== 0 || !Number.isSafeInteger(receipt.validation?.tests) || receipt.validation.tests < 1 ||
      !Array.isArray(receipt.validation.command) || !receipt.validation.command.length || !/^[a-f0-9]{64}$/.test(receipt.validation.tapSha256 || "") ||
      !/^[a-f0-9]{64}$/.test(receipt.validation.sandboxProfileHash || "") || !/^[a-f0-9]{64}$/.test(receipt.validation.sourceTreeDigest || "") ||
      !((receipt.review?.model === "gpt-6-luna" && receipt.review?.effort === "low") || (receipt.review?.model === "gpt-6.1-sol" && receipt.review?.effort === "medium")) ||
      receipt.review?.decision !== "approve" || receipt.review?.cliExitCode !== 0 || !Array.isArray(receipt.review?.findings) || receipt.review.findings.length !== 0 || !/^[a-f0-9]{64}$/.test(receipt.review?.outputSha256 || "")) return false;
    const age = input.now - Date.parse(receipt.createdAt); if (!Number.isFinite(age) || age < 0 || age > 86400000) return false;
    const engine = await get("robertmanzanillag-jpg/blackops", `contents/script/kong-repair-subscription-worker.mjs?ref=${input.engineSourceCommit}`);
    return engine.type === "file" && engine.encoding === "base64" && digest(Buffer.from(engine.content, "base64").toString("utf8")) === receipt.engine.sha256;
  } catch { return false; }
}

/** GitHub lists commit statuses newest first; old attempts do not revoke the
 * effective result of a newer status in the same context. */
export function effectiveCommitStatusesPass(statuses: Array<{ context?: string; state?: string }>) {
  const latest = new Map<string, string>();
  for (const status of statuses) {
    if (!status.context || !status.state) return false;
    if (!latest.has(status.context)) latest.set(status.context, status.state);
  }
  return [...latest.values()].every(state => state === "success");
}

export const MAKER_HEALTH_MAX_AGE_MS = 45 * 60000;
export function freshMakerHealth(value: Record<string, unknown>, now: number) {
  const poll = value.lastSuccessfulPollAt, age = typeof poll === "string" ? now - Date.parse(poll) : Infinity;
  const connected = Number.isFinite(age) && age >= 0 && age <= MAKER_HEALTH_MAX_AGE_MS;
  return { ...value, workerConnected: connected, state: connected ? value.state : "stale" };
}
