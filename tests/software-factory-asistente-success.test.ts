import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAsistenteFactoryBuild } from "../server/software-factory-asistente-build";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import type { FactoryProject } from "../server/software-factory";
import type { FactoryPipelineState } from "../server/software-factory-pipeline";

const gitHash = (type: string, bytes: Buffer) => createHash("sha1").update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
const blob = (text: string) => gitHash("blob", Buffer.from(text));
const subtree = (text: string) => gitHash("tree", Buffer.concat([Buffer.from("100644 agent-search.ts\0"), Buffer.from(blob(text), "hex")]));
const tree = (text: string) => gitHash("tree", Buffer.concat([Buffer.from("40000 server\0"), Buffer.from(subtree(text), "hex")]));

test("Asistente exact source to tested draft PR charges shared credit once and never enables release", async () => {
  const repository = "robertmanzanillag-jpg/blackops", baseBranch = "codex/office-integrated-repair-20261106";
  const base = "a".repeat(40), head = "b".repeat(40), at = "2026-11-06T12:00:00.000Z", now = () => new Date(at);
  const before = "export const count = 1;\n", after = "export const count = 2;\n";
  const patch = "diff --git a/server/agent-search.ts b/server/agent-search.ts\n--- a/server/agent-search.ts\n+++ b/server/agent-search.ts\n@@ -1,1 +1,1 @@\n-export const count = 1;\n+export const count = 2;\n";
  const patchSha = createHash("sha256").update(patch).digest("hex"), branch = `factory/${base}-${patchSha}`;
  const workflow = "trusted fixture workflow", workflowPath = ".github/workflows/factory-candidate-checks.yml";
  const calls: string[] = []; let pushed = false, checked = false, prCreated = false, modelCalls = 0;
  let credit: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] };
  const ledger = createSharedOpenAiCreditLedger({ grant: { id: "shared-grant", accountScope: "shared-account", availableMicroUsd: 100_000,
    observedAt: at, expiresAt: "2026-11-20T00:00:00.000Z", verificationEvidenceId: "operator-proof" }, now, maximumGrantObservationAgeMs: 1000,
    transact: async mutate => { const copy = structuredClone(credit), result = mutate(copy); credit = copy; return result; } });
  await ledger.initialize();
  // Existing Office spend must reduce this SAME ledger before factory execution.
  await ledger.reserve({ key: "office:review", consumer: "office", requestSha256: "c".repeat(64), maximumMicroUsd: 30_000 });
  await ledger.settle({ key: "office:review", actualMicroUsd: 20_000, evidenceId: "office-response" });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  const build = createAsistenteFactoryBuild({ ledger, baseBranch, maxFilesPerOrder: 6, maxOutputTokens: 1000, now, maxPolls: 1,
    checks: { workflowId: 7, workflowPath, workflowSha256: createHash("sha256").update(workflow).digest("hex"), jobName: "isolated", testStep: "test", buildStep: "build", browserStep: "browser" },
    model: { model: "gpt-4.1-mini-2025-04-14", inputNanoUsdPerToken: 400, outputNanoUsdPerToken: 1600,
      pricingValidUntil: "2026-11-20T00:00:00.000Z", now, maxInputTokens: 1000, request: async (url, init) => {
        modelCalls++; assert.equal(credit.reservations[1].status, "reserved"); assert.equal(credit.reservations[1].consumer, "factory");
        assert.equal(credit.reservations[1].reservedMicroUsd, 20_000); assert.equal(init.signal?.aborted, false);
        if (url.endsWith("/input_tokens")) { calls.push("count"); return json({ object: "response.input_tokens", input_tokens: 100 }); }
        calls.push("model"); const body = JSON.parse(String(init.body)); assert.deepEqual(body.tools, []); assert.equal(body.store, false);
        return json({ object: "response", model: body.model, status: "completed", usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
          output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({edits:[{path:"server/agent-search.ts",before,after}]}) }] }] });
      } },
    githubRequest: async (url, init) => {
      const prefix = `https://api.github.com/repos/${repository}`; assert.ok(url.startsWith(prefix));
      const route = url.slice(prefix.length), method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : undefined;
      if (method === "GET" && route === "") return json({ full_name: repository, private: false, archived: false, disabled: false, default_branch: "main" });
      if (method === "GET" && route.startsWith("/contents/")) return json({ type: "file", path: workflowPath, sha: blob(workflow), encoding: "base64", size: Buffer.byteLength(workflow), content: Buffer.from(workflow).toString("base64") });
      if (method === "GET" && route.startsWith("/git/ref/")) {
        const ref = decodeURIComponent(route.slice("/git/ref/".length));
        if (ref === `heads/${baseBranch}`) return json({ ref: `refs/${ref}`, object: { sha: base, type: "commit" } });
        assert.equal(ref, `heads/${branch}`); if (!pushed) return json({ message: "missing" }, 404);
        return json({ ref: `refs/${ref}`, object: { sha: head, type: "commit" } });
      }
      if (method === "GET" && route.startsWith("/git/commits/")) {
        const revision = route.slice("/git/commits/".length); assert.ok([base, head].includes(revision));
        return json({ sha: revision, tree: { sha: tree(revision === base ? before : after) }, parents: revision === base ? [] : [{ sha: base }], message: revision === base ? "baseline" : `Factory candidate ${patchSha}` });
      }
      if (method === "GET" && route.startsWith("/git/trees/")) return json({ sha: tree(before), truncated: false, tree: [
        { path: "server", type: "tree", mode: "040000", sha: subtree(before) }, { path: "server/agent-search.ts", type: "blob", mode: "100644", sha: blob(before), size: Buffer.byteLength(before) }] });
      if (method === "GET" && route.startsWith("/git/blobs/")) { assert.ok(route.endsWith(blob(before))); return json({ sha: blob(before), encoding: "base64", size: Buffer.byteLength(before), content: Buffer.from(before).toString("base64") }); }
      if (method === "POST" && route === "/git/blobs") { assert.equal(Buffer.from(body.content, "base64").toString(), after); return json({ sha: blob(after) }, 201); }
      if (method === "POST" && route === "/git/trees") { assert.equal(body.base_tree, tree(before)); assert.deepEqual(body.tree, [{ path: "server/agent-search.ts", sha: blob(after), type: "blob", mode: "100644" }]); return json({ sha: tree(after) }, 201); }
      if (method === "POST" && route === "/git/commits") { assert.deepEqual(body.parents, [base]); assert.equal(body.tree, tree(after)); return json({ sha: head }, 201); }
      if (method === "POST" && route === "/git/refs") { calls.push("push"); assert.equal(body.ref, `refs/heads/${branch}`); assert.equal(body.sha, head); pushed = true; return json({ ref: body.ref, object: { sha: head, type: "commit" } }, 201); }
      if (method === "GET" && route.startsWith("/actions/workflows/7/runs?")) { assert.equal(pushed, true); assert.ok(route.includes(`head_sha=${head}`)); return json({ total_count: 1, workflow_runs: [
        { id: 1, head_sha: head, head_branch: branch, event: "push", path: workflowPath, workflow_id: 7, run_attempt: 1, status: "completed", conclusion: "success", html_url: `https://github.com/${repository}/actions/runs/1`, repository: { full_name: repository, private: false }, head_repository: { full_name: repository } }] }); }
      if (method === "GET" && route.startsWith("/actions/runs/1/attempts/1/jobs?")) { calls.push("checks"); checked = true; return json({ total_count: 1, jobs: [
        { run_id: 1, head_sha: head, run_attempt: 1, name: "isolated", status: "completed", conclusion: "success", completed_at: at, labels: ["ubuntu-24.04"], steps: ["test", "build", "browser"].map(name => ({ name, status: "completed", conclusion: "success" })) }] }); }
      if (method === "GET" && route.startsWith("/pulls?")) return json([]);
      if (method === "POST" && route === "/pulls") { assert.equal(checked, true); assert.equal(body.draft, true); assert.equal(body.base, baseBranch); assert.equal(body.head, branch); assert.equal(prCreated, false); prCreated = true; calls.push("pr");
        return json({ number: 9, state: "open", draft: true, html_url: `https://github.com/${repository}/pull/9`, head: { ref: branch, sha: head, repo: { full_name: repository } }, base: { ref: baseBranch, repo: { full_name: repository } } }, 201); }
      throw Error(`Unexpected synthetic request: ${method} ${route}`);
    },
  });
  const project = { id: "asistente", repo: repository } as FactoryProject;
  const state = { version: 1, projectId: project.id, rootJobId: "root-order", repairAttempts: 0, finding: { baseSha: base, request: "Improve agent search", sourcePaths: ["server/agent-search.ts"] } } as FactoryPipelineState;
  const result = await build(project, state, { signal: new AbortController().signal, maxCostCents: 2 });
  assert.ok("candidate" in result, JSON.stringify(result));
  if (!("candidate" in result)) return;
  assert.equal(result.candidate.headSha, head); assert.equal(result.candidate.prUrl, `https://github.com/${repository}/pull/9`);
  assert.equal(result.candidate.risk, "unknown"); assert.equal(result.candidate.reversible, false);
  assert.equal(result.tests.headSha, head); assert.equal(result.costCents, 1);
  assert.deepEqual(calls, ["count", "model", "push", "checks", "pr"]);
  assert.equal((await ledger.status()).spentMicroUsd, 30_000); assert.equal((await ledger.status()).reservedMicroUsd, 0);
  await build(project, state, { signal: new AbortController().signal, maxCostCents: 2 });
  assert.equal(modelCalls, 2); assert.deepEqual(calls, ["count", "model", "push", "checks", "pr"]);
});
