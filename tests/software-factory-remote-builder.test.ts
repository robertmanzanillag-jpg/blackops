import { createResponsesFactoryBuild } from "../server/software-factory-responses-runtime";
import { createHash } from "node:crypto";
import type { FactoryGitHubPublisherClient } from "../server/software-factory-github-publisher";
import type { FactoryActionsClient } from "../server/software-factory-actions";
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import { createFactoryRemotePipelineBuilder, createGitHubActionsFactoryBuilder, type FactoryRemoteBuilderOptions } from "../server/software-factory-remote-builder";
import type { FactoryProject } from "../server/software-factory";
import type { FactoryPipelineState } from "../server/software-factory-pipeline";
const base = "a".repeat(40), head = "b".repeat(40), now = "2026-11-06T12:00:00Z";
const patch = "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n";
const project = { id: "pilot", repo: "owner/app" } as FactoryProject;
const state = { finding: { baseSha: base, request: "fix" }, repairAttempts: 0 } as FactoryPipelineState;
function fixture() {
    const calls: string[] = [], controller = new AbortController();
    let workspace = "";
    const options: FactoryRemoteBuilderOptions = { publicationCostCents: 0, now: () => new Date(now),
        preflight: async () => { calls.push("preflight"); return { allowed: true }; },
        exportSource: async (_repo, _sha, dir) => { workspace = dir; calls.push("export"); await writeFile(path.join(dir, "app.ts"), "old\n"); return { sha: base }; },
        generatePatch: async () => { calls.push("model"); return { patch, costCents: 2 }; },
        prepareCandidate: async (input) => { calls.push("prepare"); return { repository: input.repository, baseSha: base, headSha: head, patchSha256: input.expectedPatchSha256, treeSha: "c".repeat(40), branch: "factory/fixture", changedFiles: ["app.ts"] }; },
        verifyCandidate: async (_p, candidate, context) => { calls.push("verify"); assert.equal(context.maxCostCents, 8); return { status: "passed", costCents: 1, projectId: project.id, baseSha: base, headSha: candidate.headSha, testPassed: true, buildPassed: true, actorId: "trusted-actions", artifactIds: ["run-123"], createdAt: now }; },
        finalizeCandidate: async (candidate) => { calls.push("pr"); return { headSha: head, appliedPatchSha256: candidate.patchSha256, prUrl: "https://github.com/owner/app/pull/1" }; },
    };
    return { options, calls, controller, get workspace() { return workspace; }, run: () => createFactoryRemotePipelineBuilder(options)(project, state, { signal: controller.signal, maxCostCents: 10 }) };
}
test("PR opens only after exact remote test/build evidence; known costs add and workspace is removed", async () => {
    const f = fixture(), result = await f.run();
    assert.deepEqual(f.calls, ["preflight", "export", "model", "prepare", "verify", "pr"]);
    assert.equal(result.costCents, 3);
    assert.ok("candidate" in result);
    if ("candidate" in result) {
        assert.equal(result.candidate.risk, "unknown");
        assert.equal(result.tests.actorId, "trusted-actions");
        assert.equal(result.tests.createdAt, now);
    }
    await assert.rejects(access(f.workspace));
});
test("eligibility and protected exported source block before model or candidate side effects", async () => {
    const f = fixture();
    f.options.preflight = async () => ({ allowed: false });
    assert.equal((await f.run() as any).status, "blocked");
    assert.deepEqual(f.calls, []);
    const g = fixture();
    g.options.exportSource = async (_r, _s, dir) => { await writeFile(path.join(dir, ".env"), "synthetic"); return { sha: base }; };
    assert.equal((await g.run() as any).status, "failed");
    assert.equal(g.calls.includes("model"), false);
});
test("workflow patch is rejected before push while preserving model cost", async () => {
    const f = fixture();
    f.options.generatePatch = async () => ({ patch: patch.replaceAll("app.ts", ".github/workflows/check.yml"), costCents: 2 });
    const result = await f.run();
    assert.equal((result as any).status, "failed");
    assert.equal(result.costCents, 2);
    assert.equal(f.calls.includes("prepare"), false);
});
test("failed or wrong-version checks never open PR; unknown remote work retains all reservation", async () => {
    for (const mode of ["failed", "unknown", "wrong-head", "wrong-build", "throw"]) {
        const f = fixture(), original = f.options.verifyCandidate;
        f.options.verifyCandidate = async (...args) => {
            if (mode === "throw")
                throw Error("uncertain");
            if (mode === "failed" || mode === "unknown")
                return { status: mode, costCents: 1 };
            const result = await original(...args);
            return { ...result, ...(mode === "wrong-head" ? { headSha: base } : { buildPassed: false }) } as any;
        };
        const result = await f.run();
        assert.equal((result as any).status, mode !== "failed" ? "unknown" : "failed");
        assert.equal(result.costCents, mode !== "failed" ? 10 : 3);
        assert.equal(f.calls.includes("pr"), false);
    }
});
test("abort after candidate push cannot release reservation or open PR", async () => {
    const f = fixture(), prepare = f.options.prepareCandidate;
    f.options.prepareCandidate = async (input) => { const result = await prepare(input); f.controller.abort(); return result; };
    const result = await f.run();
    assert.equal((result as any).status, "unknown");
    assert.equal(result.costCents, 10);
    assert.equal(f.calls.includes("verify"), false);
    assert.equal(f.calls.includes("pr"), false);
});
test("lost PR response quarantines despite settled model and check cost", async () => {
    const f = fixture();
    f.options.finalizeCandidate = async () => { throw Error("lost response"); };
    const result = await f.run();
    assert.equal((result as any).status, "unknown");
    assert.equal(result.costCents, 10);
});
test("PR path suffix cannot masquerade as a verified pull request", async () => {
    const f = fixture(), finalize = f.options.finalizeCandidate;
    f.options.finalizeCandidate = async (candidate) => ({ ...await finalize(candidate), prUrl: "https://github.com/owner/app/pull/1/evil" });
    assert.equal((await f.run() as any).status, "unknown");
});
test("abort after a verified PR preserves the completed outcome", async () => {
    const f = fixture(), finalize = f.options.finalizeCandidate;
    f.options.finalizeCandidate = async (candidate) => { const result = await finalize(candidate); f.controller.abort(); return result; };
    const result = await f.run();
    assert.ok("candidate" in result);
    assert.equal(result.costCents, 3);
});
test("Responses composition counts tokens, generates patch and verifies GitHub before opening PR", async () => {
    const f = fixture(), calls: string[] = [];
    const gitHash = (type: string, bytes: Buffer) => createHash("sha1").update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
    const blob = (text: string) => gitHash("blob", Buffer.from(text));
    const tree = (text: string) => gitHash("tree", Buffer.concat([Buffer.from("100644 app.ts\0"), Buffer.from(blob(text), "hex")]));
    const patchHash = createHash("sha256").update(patch).digest("hex"), branch = `factory/${base}-${patchHash}`;
    const workflow = "synthetic trusted workflow", workflowPath = ".github/workflows/factory.yml";
    let pushed = false;
    const publisherClient: FactoryGitHubPublisherClient = { git: {
            getRef: async (args) => { if (args.ref === "heads/main")
                return { data: { ref: "refs/heads/main", object: { sha: base } } }; if (!pushed)
                throw Object.assign(Error("missing"), { status: 404 }); return { data: { ref: `refs/heads/${branch}`, object: { sha: head } } }; },
            getCommit: async (args) => ({ data: { sha: args.commit_sha, tree: { sha: tree(args.commit_sha === base ? "old\n" : "new\n") }, parents: args.commit_sha === base ? [] : [{ sha: base }], message: args.commit_sha === base ? "base" : `Factory candidate ${patchHash}` } }),
            getTree: async () => ({ data: { sha: tree("old\n"), truncated: false, tree: [{ path: "app.ts", type: "blob", mode: "100644", sha: blob("old\n") }] } }),
            getBlob: async () => ({ data: { sha: blob("old\n"), size: 4, encoding: "base64", content: Buffer.from("old\n").toString("base64") } }),
            createBlob: async (args) => ({ data: { sha: gitHash("blob", Buffer.from(args.content, "base64")) } }),
            createTree: async () => ({ data: { sha: tree("new\n") } }),
            createCommit: async () => ({ data: { sha: head } }),
            createRef: async (args) => { calls.push("push"); pushed = true; return { data: { ref: args.ref, object: { sha: args.sha } } }; },
        }, pulls: {
            list: async () => ({ data: [] }),
            create: async (args) => { calls.push("pr"); assert.equal(args.draft, true); return { data: { number: 1, state: "open", draft: true, html_url: "https://github.com/owner/app/pull/1", head: { ref: branch, sha: head, repo: { full_name: project.repo } }, base: { ref: "main", repo: { full_name: project.repo } } } }; },
        } };
    const actionsClient: FactoryActionsClient = { repos: {
            get: async () => { calls.push("eligibility"); return { data: { full_name: project.repo, private: false, archived: false, disabled: false } }; },
            getContent: async (args) => ({ data: { type: "file", path: args.path, encoding: "base64", size: Buffer.byteLength(workflow), content: Buffer.from(workflow).toString("base64") } }),
        }, actions: {
            listWorkflowRuns: async () => { calls.push("run"); assert.equal(pushed, true); return { data: { total_count: 1, workflow_runs: [{ id: 1, head_sha: head, head_branch: branch, event: "push", path: workflowPath, workflow_id: 7, run_attempt: 1, status: "completed", conclusion: "success", html_url: `https://github.com/${project.repo}/actions/runs/1`, repository: { full_name: project.repo, private: false }, head_repository: { full_name: project.repo } }] } }; },
            listJobsForWorkflowRunAttempt: async () => { calls.push("jobs"); return { data: { total_count: 1, jobs: [{ run_id: 1, head_sha: head, run_attempt: 1, name: "isolated", status: "completed", conclusion: "success", completed_at: now, labels: ["ubuntu-24.04"], steps: ["test", "build", "browser"].map(name => ({ name, status: "completed", conclusion: "success" })) }] } }; },
        } };
    const build = createResponsesFactoryBuild({
      model: {model:"gpt-4.1-mini-2025-04-14",inputNanoUsdPerToken:400,outputNanoUsdPerToken:1600,pricingValidUntil:"2026-11-07T00:00:00Z",now:()=>new Date(now),maxInputTokens:1000,
        request:async(url, init)=>{
          const body=JSON.parse(String(init.body));
          assert.ok(body.input.includes('old\\n'));
          if(url.endsWith('/input_tokens')){calls.push("count");return Response.json({object:"response.input_tokens",input_tokens:100});}
          calls.push("model");assert.equal(body.max_output_tokens,1000);assert.deepEqual(body.tools,[]);
          return Response.json({object:"response",model:body.model,status:"completed",usage:{input_tokens:100,output_tokens:100,total_tokens:200},output:[{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:patch}]}]});
        }},sourcePaths:{[project.repo]:["app.ts"]},maxOutputTokens:1000,
      github:{ exportSource: f.options.exportSource, publisherClient, actionsClient, publicationCostCents: 0, now: () => new Date(now), maxPolls: 1,
        repositories: { [project.repo]: { baseBranch: "main", checks: { workflowId: 7, workflowPath, workflowSha256: createHash("sha256").update(workflow).digest("hex"), jobName: "isolated", testStep: "test", buildStep: "build", browserStep: "browser" } } } } });
    const result = await build(project, state, { signal: f.controller.signal, maxCostCents: 10 });
    assert.ok("candidate" in result);
    assert.equal(result.costCents, 1);
    assert.ok(calls.indexOf("eligibility") < calls.indexOf("model"));
    assert.ok(calls.indexOf("count") < calls.indexOf("model"));
    assert.ok(calls.indexOf("model") < calls.indexOf("push"));
    assert.ok(calls.indexOf("jobs") < calls.indexOf("pr"));
});

test("classifier cannot replace verified identity and failures preserve the PR", async () => {
  const f=fixture();
  f.options.classifyCandidate=async()=>({risk:'low',reversible:true,affectsContracts:false,affectsData:false,headSha:'evil',builderId:'evil',prUrl:'evil'});
  const r=await f.run(); assert.ok('candidate' in r);
  if('candidate' in r){assert.equal(r.candidate.headSha,head);assert.equal(r.candidate.builderId,'factory-remote-builder');assert.equal(r.candidate.prUrl,'https://github.com/owner/app/pull/1');assert.equal(r.candidate.risk,'low');}
  f.options.classifyCandidate=async()=>{throw Error('unavailable');};
  const unknown=await f.run();assert.ok('candidate' in unknown);if('candidate' in unknown)assert.equal(unknown.candidate.risk,'unknown');
});


test("empty patches report only allowlisted diagnostics while preserving known model cost", async () => {
  for (const diagnostic of ["PROVIDER_NOT_COMPLETED", "MALFORMED_JSON", "EDIT_PATH_NOT_ALLOWED", "OVERLAPPING_EDITS", "EDIT_LIMIT_EXCEEDED", "secret/raw-provider-response"]) {
    const f = fixture();
    f.options.generatePatch = async () => ({ patch: "", costCents: 1, diagnostic: diagnostic as any });
    const result = await f.run() as any;
    assert.equal(result.status, "failed"); assert.equal(result.costCents, 1);
    assert.equal(result.reason, diagnostic === "secret/raw-provider-response" ? "FACTORY_REMOTE_BUILD_FAILED:PATCH" : `FACTORY_REMOTE_BUILD_FAILED:${diagnostic}`);
    assert.equal(f.calls.includes("prepare"), false);
  }
});
