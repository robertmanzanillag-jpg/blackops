import test from "node:test";
import assert from "node:assert/strict";
import { createFactoryPipeline, createPipelineSimulator, createAppQaFactoryDiscovery, type FactoryPipelineDependencies, type FactoryPipelineState } from "../server/software-factory-pipeline";
import type { FactoryProject, FactoryEvidence } from "../server/software-factory";
import type { FactoryJob } from "../server/software-factory-store";
const now = new Date("2026-11-06T12:00:00Z"), head = "a".repeat(40), base = "b".repeat(40);

test("hourly verification requires current production lineage and preserves recovery escrow", async () => {
  const f=fixture({production:true});await f.run();
  const deployment=[...f.jobs.values()].find(j=>j.kind==='deploy')!;
  const original=JSON.parse(JSON.stringify(deployment));
  f.deps.reservations.verify=1;f.deps.reservations.rollback=1;
  let current=true, checks=0;
  f.deps.isCurrentDeployment=async(owner,project,id)=>{checks++;assert.equal(owner,'owner');assert.equal(project,'office');assert.equal(id,deployment.id);return current;};
  const health:FactoryJob={...deployment,id:'hourly',kind:'verify',status:'running',key:`${deployment.id}.health:2026-11-06T12`,payload:{previousJobId:deployment.id},reservedCents:2,recoveryCents:1};
  const execute=(job=health)=>f.pipeline.adapters![job.kind]!.execute(job,{signal:new AbortController().signal,maxCostCents:1});
  const healthy=await execute();assert.equal(healthy.status,'completed');assert.equal(healthy.next,undefined);assert.equal(checks,1);
  f.deps.verify=async()=>({costCents:1,verification:{healthy:false,headSha:head}});
  const failed=await execute();assert.equal(failed.next?.kind,'rollback');assert.equal(failed.next?.reservedCents,1);assert.equal(failed.next?.key,'hourly.next');
  f.jobs.set(health.id,{...health,status:'completed',result:failed});
  const recovery:FactoryJob={...health,...failed.next,id:'hourly-rollback',kind:'rollback',payload:failed.next!.payload!};
  const restored=await execute(recovery);assert.equal(restored.status,'completed');assert.equal(restored.next,undefined);
  current=false;await assert.rejects(execute(),/HEALTH_DEPLOYMENT_UNVERIFIED/);current=true;
  for(const key of [`${deployment.id}.health:2026-02-30T12`,`${deployment.id}.health:2026-11-06T24`,`${deployment.id}.health:2026-11-06T12Z`,'spoof.next'])await assert.rejects(execute({...health,key}),/CHAIN_UNTRUSTED/);
  await assert.rejects(execute({...health,kind:'rollback'}),/CHAIN_UNTRUSTED/);
  await assert.rejects(execute({...health,headSha:'c'.repeat(40)}),/VERSION_MISMATCH/);
  await assert.rejects(execute({...health,recoveryCents:0}),/HEALTH_DEPLOYMENT_UNVERIFIED/);
  (deployment.result as any).evidence.pipelineState.target='staging';await assert.rejects(execute(),/HEALTH_DEPLOYMENT_UNVERIFIED/);
  f.jobs.set(deployment.id,original);delete f.deps.isCurrentDeployment;await assert.rejects(execute(),/CHAIN_UNTRUSTED/);
});
function fixture(options: { failSimulation?: boolean; regress?: boolean; stale?: boolean; production?: boolean } = {}) {
  const jobs = new Map<string, FactoryJob>(); const findings = new Map<string, string>(); let serial = 0, findingSerial = 0; const calls: string[] = [];
  const project: FactoryProject = { id: "office", repo: "owner/office", testCommand: "npm test", buildCommand: "npm run build", rollbackCommand: "restore", stagingUrl: "https://staging.example.com", productionUrl: "https://example.com", healthUrl: "https://example.com/health", journeys: ["form"], providerSupportsRelease: true, providerSupportsRollback: true, automaticRelease: options.production || false, rehearsalRunIds: options.production ? ["a", "b", "c"] : [], rollbackVerifiedAt: now.toISOString() };
  const evidence = (state: FactoryPipelineState, kind: FactoryEvidence["kind"]): FactoryEvidence => ({ projectId: project.id, headSha: state.candidate!.headSha, baseSha: base, kind, passed: true, warnings: [], createdAt: options.stale ? "2020-01-01T00:00:00Z" : now.toISOString(), actorId: kind === "tests" ? "builder" : "checker", artifactIds: ["proof"], journeyIds: ["form"], baselineJourneyIds: ["form"], viewports: ["desktop", "mobile"], syntheticData: true, externalServicesMocked: true });
  const deps: FactoryPipelineDependencies = {
    project: async () => project, previous: async (owner, id) => { const job = jobs.get(id); return job?.ownerKey === owner ? job : undefined; }, now: () => now,
    claimFinding: async (_owner, _project, key, jobId) => { if (findings.has(key)) return findings.get(key) === jobId; findings.set(key, jobId); return true; },
    reservations: { discover: 5, build: 20, simulate: 5, review: 5, deploy: 5, verify: 5, rollback: 5, evaluate: 5 },
    discover: async () => ({ costCents: 1, finding: { id: `broken-form-${++findingSerial}`, kind: "bug", regressionScenarioId: "form", request: "Repair seeded form bug and retain its regression test", baseSha: base, artifactIds: ["qa-failure"] } }),
    build: async (_project, state) => { calls.push("build"); const candidate = { projectId: project.id, headSha: head, baseSha: base, prUrl: "https://github.com/owner/office/pull/1", builderId: "builder", risk: "low" as const, reversible: true, affectsContracts: false, affectsData: false, changedFiles: ["client/src/button.tsx", "tests/form.test.ts"], repairAttempts: 0 }; return { costCents: 2, candidate, tests: evidence({ ...state, candidate }, "tests") }; },
    simulate: async (_project, state) => ({ costCents: 1, evidence: { ...evidence(state, "simulation"), passed: !options.failSimulation } }),
    review: async (_project, state) => ({ costCents: 1, evidence: evidence(state, "review") }),
    deploy: async (_project, state) => { calls.push("deploy:" + state.target); return { costCents: 1, deployment: { id: "deployment", headSha: head, target: state.target } }; },
    verify: async () => ({ costCents: 1, verification: { healthy: !options.regress, headSha: head } }),
    rollback: async () => { calls.push("rollback"); return { costCents: 1, rollback: { healthy: true, restoredSha: base } }; },
    evaluate: async () => ({ costCents: 1, changesPolicy: false, cases: (["historical", "heldout"] as const).map(partition => ({ id: partition, partition, baselineScore: .5, candidateScore: .7, baselineSafetyFailures: 0, candidateSafetyFailures: 0 })) }),
    recordValidation: async (_owner, _project, id) => { assert.equal(jobs.get(id)?.kind, "rollback"); project.rehearsalRunIds.push(id); calls.push("validation"); },
  };
  const pipeline = createFactoryPipeline(deps);
  async function run() {
    let job: FactoryJob = { id: `job-${++serial}`, ownerKey: "owner", month: "2026-11", key: `daily:office:${serial}`, projectId: "office", kind: "discover", payload: {}, reservedCents: 5, recoveryCents: 0, status: "running", createdAt: now.toISOString() };
    const stages: string[] = [];
    for (let i = 0; i < 30; i++) {
      stages.push(job.kind);
      const result = await pipeline.adapters![job.kind]!.execute(job, { signal: new AbortController().signal, maxCostCents: job.reservedCents });
      jobs.set(job.id, { ...job, status: result.status, result });
      if (!result.next) return { stages, result, job };
      job = { ...result.next, payload: result.next.payload || {}, id: `job-${++serial}`, ownerKey: "owner", month: "2026-11", status: "running", createdAt: now.toISOString() } as FactoryJob;
    }
    throw new Error("LOOP");
  }
  return { pipeline, run, calls, project, deps, jobs };
}
test("three complete isolated rehearsal cycles each verify recovery and persist evidence", async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) assert.deepEqual((await f.run()).stages, ["discover", "build", "simulate", "review", "deploy", "verify", "rollback", "evaluate"]);
  assert.equal(new Set(f.project.rehearsalRunIds).size, 3);
  assert.equal(f.calls.filter(x => x === "rollback").length, 3);
  assert.equal(f.calls.filter(x => x === "deploy:production").length, 0);
});
test("production regression restores previous version and does not count as rehearsal", async () => {
  const f = fixture({ production: true, regress: true }); const run = await f.run();
  assert.equal(run.result.status, "completed"); assert.ok(f.calls.includes("rollback")); assert.ok(!f.calls.includes("validation"));
});
test("failed simulation permits only two repairs and never deploys", async () => {
  const f = fixture({ failSimulation: true }); const run = await f.run();
  assert.equal(run.result.status, "blocked"); assert.equal(run.result.reason, "FACTORY_REPAIR_LIMIT"); assert.equal(f.calls.filter(x => x === "build").length, 3); assert.ok(!f.calls.some(x => x.startsWith("deploy")));
});
test("stale proof blocks publication despite passing reported checks", async () => {
  const f = fixture({ stale: true }); const run = await f.run();
  assert.equal(run.result.status, "blocked"); assert.ok(!f.calls.some(x => x.startsWith("deploy")));
});
test("payload cannot manufacture predecessor evidence or cross owner", async () => {
  const f = fixture(); await f.run(); const previous = [...f.jobs.values()].find(j => j.kind === "review")!;
  const forged = { ...previous, id: "forged", kind: "deploy", key: previous.id + ".next", ownerKey: "attacker", headSha: head, payload: { previousJobId: previous.id, candidate: { risk: "low" } } } as FactoryJob;
  await assert.rejects(f.pipeline.releaseContext!(forged), /UNTRUSTED/);
  await assert.rejects(f.pipeline.releaseContext!({ ...forged, ownerKey: "owner", key: "arbitrary" }), /UNTRUSTED/);
});
test("missing real provider adapters report blocked rather than claiming operation", async () => {
  const f = fixture(); const pipeline = createFactoryPipeline({ ...f.deps, deploy: undefined });
  assert.deepEqual(pipeline.readiness().missing, ["deploy"]);
});
test("unchanged finding is deduplicated across daily scans", async () => {
  const f = fixture();
  const original = await f.deps.discover!(f.project, { signal: new AbortController().signal, maxCostCents: 5 });
  f.deps.discover = async () => original;
  await f.run(); const duplicate = await f.run();
  assert.deepEqual(duplicate.stages, ["discover"]); assert.equal(duplicate.result.reason, "FACTORY_FINDING_ALREADY_TRACKED");
});
test("bug repair cannot continue without a permanent regression test", async () => {
  const f = fixture(), build = f.deps.build!;
  f.deps.build = async (...args) => { const result = await build(...args); if ("status" in result) throw new Error("Unexpected failed fixture"); result.candidate.changedFiles = ["client/src/button.tsx"]; return result; };
  const run = await f.run(); assert.equal(run.result.reason, "FACTORY_PERMANENT_REGRESSION_TEST_REQUIRED"); assert.deepEqual(run.stages, ["discover", "build"]);
});
test("company improvement acceptance cannot bypass the permanent regression test gate", async () => {
  const f = fixture(), discover = f.deps.discover!, build = f.deps.build!;
  f.deps.discover = async (...args) => { const found = await discover(...args); found.finding!.kind = "improvement"; return found; };
  f.deps.build = async (...args) => { const built = await build(...args); if ("status" in built) throw Error("fixture"); built.candidate.changedFiles = ["client/src/button.tsx"]; return built; };
  const run = await f.run();
  assert.equal(run.result.reason, "FACTORY_PERMANENT_REGRESSION_TEST_REQUIRED");
  assert.deepEqual(run.stages, ["discover", "build"]);
});

test("fixture launch attestation is required and cleanup runs on refusal", async () => {
  const f = fixture(); await f.run(); const state = (([...f.jobs.values()].find(j => j.kind === "build")!.result as any).evidence.pipelineState) as FactoryPipelineState;
  let closed = false, ran = false;
  const simulator = createPipelineSimulator({ artifactRoot: "/tmp/unused", launch: async () => ({ input: { projectId: "office", baseline: { headSha: base, baseUrl: "http://127.0.0.1:8000/" }, candidate: { headSha: head, baseUrl: "http://127.0.0.1:8001/" }, scenarios: [] }, attestation: { baseSha: base, headSha: head, isolated: true, productionSecretsAbsent: false, outboundNetworkBlocked: true }, close: async () => { closed = true; } }), run: async () => { ran = true; throw new Error("must not run"); } });
  await assert.rejects(simulator(f.project, state, { signal: new AbortController().signal, maxCostCents: 5 }), /ATTESTATION/);
  assert.equal(closed, true); assert.equal(ran, false);
});
test("release continuation reserves verification and recovery before deployment", async () => {
  const f = fixture(); await f.run();
  const deploy = [...f.jobs.values()].find(j => j.kind === "deploy")!;
  assert.equal(deploy.reservedCents, 15); assert.equal(deploy.recoveryCents, 10);
  const verify = [...f.jobs.values()].find(j => j.kind === "verify")!;
  assert.equal(verify.reservedCents, 10); assert.equal(verify.recoveryCents, 5);
});
test("App QA discovery prioritizes reproducible findings without generating new agents", async () => {
  const f = fixture();
  const discover = createAppQaFactoryDiscovery({ snapshot: async () => ({ projectId: "office", baseSha: base, artifactId: "qa-report", costCents: 1, findings: [{ id: "visual", appName: "office", area: "button", severity: "low", title: "Style", detail: "Contrast", recommendation: "Improve contrast", sourceAgent: "improvement-scout" }, { id: "form", appName: "office", area: "form", severity: "high", title: "Form broken", detail: "Fails on submit", recommendation: "Fix form", sourceAgent: "error-scout" }] }), reproduction: async (_project, finding) => finding.id === "form" ? "form" : undefined });
  const found = await discover(f.project, { signal: new AbortController().signal, maxCostCents: 5 });
  assert.deepEqual(found.findings?.map(finding => finding.id), ["form", "visual"]);
  assert.equal(found.finding?.id, "form"); assert.equal(found.finding?.regressionScenarioId, "form");
});


test("tracked first finding cannot starve another finding on the same revision", async () => {
  const f = fixture();
  const initial = await f.deps.discover!(f.project, { signal: new AbortController().signal, maxCostCents: 5 });
  f.deps.discover = async () => ({ costCents: 1, findings: [initial.finding!, { ...initial.finding!, id: "second-bug" }] });
  await f.run();
  const second = await f.run();
  assert.ok(second.stages.includes("build"));
  assert.equal((second.result.evidence as any).pipelineState.finding.id, "second-bug");
  assert.equal((await f.run()).result.reason, "FACTORY_FINDING_ALREADY_TRACKED");
});

test("settled build failures retain their status and billed cost", async () => {
  for (const status of ["failed", "blocked", "unknown"] as const) {
    const f = fixture();
    f.deps.build = async () => ({ status, costCents: 7, reason: "FACTORY_BUILD_" + status.toUpperCase() });
    const run = await f.run();
    assert.deepEqual(run.stages, ["discover", "build"]);
    assert.equal(run.result.status, status);
    assert.equal(run.result.costCents, 7);
    assert.equal(run.result.next, undefined);
  }
});
