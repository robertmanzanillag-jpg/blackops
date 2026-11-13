import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAsistenteOperatorComposition, validateAsistenteOperatorConfig, type AsistenteOperatorConfig } from "../server/software-factory-asistente-operator";
import { createSharedOpenAiCreditLedger, type SharedCreditState, type CreditTransaction } from "../server/shared-openai-credit-ledger";
import { companyOrderJob } from "../server/software-factory-company";
import { validateFactoryWorkerOptions } from "../server/software-factory-runtime";
import type { CompanyOrder } from "../shared/agent-company";
const owner = "owner", ownerKey = createHash("sha256").update(owner).digest("hex"), at = new Date("2026-11-07T00:00:00Z");
const project: any = { id: "asistente", repo: "robertmanzanillag-jpg/blackops", testCommand: "npm test", buildCommand: "npm run build", automaticRelease: false, providerSupportsRelease: false, providerSupportsRollback: false, journeys: ["office-session-login", "office-company-navigation"] };
const order: CompanyOrder = { id: "approved", text: "Improve role work checks", createdAt: at.toISOString(), assignees: [{ agentId: "code", status: "en_curso", note: "" }] };
async function fixture() {
    let state: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] }, tail: Promise<unknown> = Promise.resolve();
    const transact: CreditTransaction = async (fn) => { const p = tail.then(() => { const copy = structuredClone(state), r = fn(copy); state = copy; return r; }); tail = p.catch(() => { }); return p; };
    const ledger = createSharedOpenAiCreditLedger({ transact, now: () => at, maximumGrantObservationAgeMs: 60000, grant: { id: "grant", accountScope: "same-account", availableMicroUsd: 1000000, observedAt: at.toISOString(), expiresAt: "2026-11-20T00:00:00Z", verificationEvidenceId: "verified" } });
    await ledger.initialize();
    const input = companyOrderJob(order, project, 1), revision = (input.payload!.companyOrder as any).revision;
    const config: AsistenteOperatorConfig = { owner, projectId: "asistente", baseBranch: "main", checks: { trigger: "push", workflowId: 1, workflowPath: ".github/workflows/factory-candidate-checks.yml", workflowSha256: "a".repeat(64), jobName: "isolated", testStep: "tests", buildStep: "build", browserStep: "browser" }, archiveHosts: ["fixture.blob.core.windows.net"], reservations: { discover: 1, build: 2, simulate: 1, review: 2 }, maxInputTokens: 1000, maxOutputTokens: 100, orders: [{ id: order.id, revision, baseSha: "b".repeat(40), kind: "improvement", scenarioId: "office-role-work-owner-cas-v1", paths: ["server/office-role-work.ts", "tests/office-role-work.test.ts"] }], ui: { workflowId: 1, workflowSha256: "a".repeat(64), harnessSha256: "c".repeat(64) } };
    let paused = false, lost = false, calls = 0;
    const jobs: any[] = [];
    const store: any = { status: async () => ({ configured: true, paused, limitCents: 10000, fixedCents: 0, spentCents: 0, reservedCents: 0 }), projectByOwnerKey: async (key: string) => { assert.equal(key, ownerKey); return project; }, list: async () => jobs, enqueue: async (o: string, i: any) => { assert.equal(o, owner); calls++; assert.equal((await ledger.status()).reservedMicroUsd, 40000); const job = { ...i, id: "job", ownerKey, status: "pending" }; jobs.push(job); if (lost)
            throw Error("LOST_ACK"); return job; } };
    const deps = { store, credits: { ledger, pricing: { model: "gpt-6-astra", inputNanoUsdPerToken: 1, outputNanoUsdPerToken: 1, validUntil: "2026-11-20T00:00:00Z" } }, readOrders: async () => [order], githubRequest: async () => { throw Error("NO_GITHUB_CALL_EXPECTED"); }, modelRequest: async () => { throw Error("NO_PAID_CALL_EXPECTED"); }, download: fetch, readUi: async () => { throw Error("NO_FAKE_SIMULATION"); }, now: () => at };
    return { config, deps, ledger, input, jobs, store, calls: () => calls, pause: () => { paused = true; }, lose: () => { lost = true; } };
}
test("operator composes real four-stage proposal runtime and zero-provider guarded idempotent admission", async () => {
    const f = await fixture(), operator = createAsistenteOperatorComposition(f.config, f.deps), worker = await operator.createFactoryWorkerOptions();
    validateFactoryWorkerOptions(worker);
    assert.equal(worker.store, f.deps.store);
    assert.equal(worker.releaseMode, "review-only");
    assert.equal(worker.discoveryMode, "company-orders-only");
    assert.deepEqual(Object.keys(worker.adapters!).sort(), ["build", "discover", "review", "simulate"]);
    const first = await operator.admitWithinCredits(owner, f.input);
    assert.equal((await f.ledger.status()).spentMicroUsd, 0);
    assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
    assert.deepEqual(await createAsistenteOperatorComposition(f.config, f.deps).admitWithinCredits(owner, f.input), first);
    assert.equal(f.calls(), 1);
});
test("lost enqueue acknowledgment retains admission hold and restart cannot replay it", async () => {
    const f = await fixture();
    f.lose();
    await assert.rejects(createAsistenteOperatorComposition(f.config, f.deps).admitWithinCredits(owner, f.input), /UNCONFIRMED/);
    assert.equal((await f.ledger.status()).reservedMicroUsd, 40000);
    assert.equal((await f.ledger.status()).uncertain, true);
    await assert.rejects(createAsistenteOperatorComposition(f.config, f.deps).admitWithinCredits(owner, f.input), /UNCONFIRMED/);
    assert.equal(f.calls(), 1);
});
test("operator blocks wrong owner, unmapped revision, paused factory and protected source configuration", async () => {
    const f = await fixture(), operator = createAsistenteOperatorComposition(f.config, f.deps);
    await assert.rejects(operator.admitWithinCredits("foreign", f.input), /OWNER_MISMATCH/);
    await assert.rejects(createAsistenteOperatorComposition({ ...f.config, orders: [] }, f.deps).admitWithinCredits(owner, f.input), /NOT_MAPPED/);
    f.pause();
    await assert.rejects(operator.admitWithinCredits(owner, f.input), /PAUSED/);
    assert.throws(() => createAsistenteOperatorComposition({ ...f.config, orders: [{ ...f.config.orders[0], paths: ["server/kong.ts", "tests/kong.test.ts"] }] }, f.deps));
    assert.throws(() => createAsistenteOperatorComposition({ ...f.config, sourcePaths: ["server/office-role-work.ts"] } as any, f.deps));
    assert.equal(f.calls(), 0);
    assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
});
test("an existing Office reservation blocks factory admission before queue mutation", async () => {
    const f = await fixture();
    await f.ledger.reserve({ key: "office", consumer: "office", maximumMicroUsd: 990000, requestSha256: "d".repeat(64) });
    await assert.rejects(createAsistenteOperatorComposition(f.config, f.deps).admitWithinCredits(owner, f.input));
    assert.equal(f.calls(), 0);
});
test("concurrent identical admissions enqueue at most once across separate operator instances", async () => {
    const f = await fixture();
    const a = createAsistenteOperatorComposition(f.config, f.deps), b = createAsistenteOperatorComposition(f.config, f.deps);
    const results = await Promise.allSettled([a.admitWithinCredits(owner, f.input), b.admitWithinCredits(owner, f.input)]);
    assert.equal(f.calls(), 1);
    assert.ok(results.some(r => r.status === "fulfilled"));
    assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
});

test("operator permits bounded build output while preserving review ceiling and rejects invalid profiles",async()=>{
 const f=await fixture();
 const increased={...f.config,maxOutputTokens:8192};
 assert.equal(validateAsistenteOperatorConfig(increased).maxOutputTokens,8192);
 assert.doesNotThrow(()=>createAsistenteOperatorComposition(increased,f.deps));
 for(const config of [{...f.config,maxOutputTokens:8193},{...f.config,maxFilesPerOrder:9},{...f.config,ui:{...f.config.ui,workflowId:2}},{...f.config,ui:{...f.config.ui,workflowSha256:"d".repeat(64)}}])assert.throws(()=>createAsistenteOperatorComposition(config as AsistenteOperatorConfig,f.deps));
 assert.equal(f.calls(),0);
});

test("old settled admission missing from bounded history fails closed instead of recreating work",async()=>{
 const f=await fixture(),operator=createAsistenteOperatorComposition(f.config,f.deps);
 await operator.admitWithinCredits(owner,f.input);f.jobs.length=0;
 await assert.rejects(operator.admitWithinCredits(owner,f.input),/RECEIPT_UNAVAILABLE/);assert.equal(f.calls(),1);
});

test("lost zero-cost settlement acknowledgment cannot overwrite a settled admission or duplicate enqueue",async()=>{
 const f=await fixture(),original=f.ledger.settle;
 f.deps.credits.ledger={...f.ledger,settle:async input=>{await original(input);throw Error("SETTLEMENT_ACK_LOST");}};
 const operator=createAsistenteOperatorComposition(f.config,f.deps);
 await assert.rejects(operator.admitWithinCredits(owner,f.input),/UNCONFIRMED/);
 const status=await f.ledger.status();assert.equal(status.reservedMicroUsd,0);assert.equal(status.uncertain,false);
 assert.equal((await operator.admitWithinCredits(owner,f.input)).id,"job");assert.equal(f.calls(),1);
});

test("operator mapping validator accepts only independently verified known scenarios",async()=>{const f=await fixture();const config=structuredClone(f.config);config.orders[0].scenarioId="office-role-work-reader-deadline-v1";assert.equal(validateAsistenteOperatorConfig(config).orders[0].scenarioId,"office-role-work-reader-deadline-v1");assert.throws(()=>validateAsistenteOperatorConfig({...config,orders:[{...config.orders[0],scenarioId:"arbitrary-pass"}]}));});

test("artifact shard opt-in defaults off and rejects nonboolean configuration",async()=>{const f=await fixture();assert.equal(validateAsistenteOperatorConfig(f.config).allowGitHubResultsAzureHosts,false);assert.equal(validateAsistenteOperatorConfig({...f.config,allowGitHubResultsAzureHosts:true}).allowGitHubResultsAzureHosts,true);assert.throws(()=>validateAsistenteOperatorConfig({...f.config,allowGitHubResultsAzureHosts:"true"}));});

const testPath = "tests/office-role-work.test.ts";
const withPaths = (config: AsistenteOperatorConfig, paths: string[], extra: Partial<AsistenteOperatorConfig> = {}) => ({ ...config, ...extra, orders: [{ ...config.orders[0], paths }] });

test("write roots: defaults and allowlisted subfolders are accepted", async () => {
 const f = await fixture(), parsed = validateAsistenteOperatorConfig(f.config);
 assert.deepEqual(parsed.writeRoots, ["server/", "client/", "shared/", "tests/"]);
 assert.equal(parsed.maxFilesPerOrder, 6); assert.equal(parsed.maxDraftPullRequestsPerDay, 5);
 const narrowed = withPaths(f.config, ["server/office/role.ts", "client/src/pages/office.tsx", "shared/agent-company.ts", testPath], { writeRoots: ["server/office/", "client/src/", "shared/", "tests/"] });
 assert.deepEqual(validateAsistenteOperatorConfig(narrowed).orders[0].paths.length, 4);
 assert.doesNotThrow(() => createAsistenteOperatorComposition(narrowed, f.deps));
 // A path outside the narrowed roots is rejected even if it is under a default root.
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, ["server/other.ts", testPath], { writeRoots: ["server/office/", "tests/"] })));
 for (const roots of [[".github/"], ["script/"], ["server"], ["server/../"], ["/server/"], ["server/secrets/"], ["server/", "server/"], ["client/dist/"], []])
  assert.throws(() => validateAsistenteOperatorConfig({ ...f.config, writeRoots: roots }), undefined, JSON.stringify(roots));
 assert.equal(f.calls(), 0);
});

test("write denials are code-owned and rejected at configuration", async () => {
 const f = await fixture();
 const denied = [".github/workflows/x.yml", "server/.github/x.ts", ".claude/settings.json", ".agents/a.md", "credentials/x.ts", "server/secrets/x.ts", "server/migrations/001.ts", "drizzle/0001.sql", "server/node_modules/x.js", "client/dist/index.js",
  ".env", "server/.env.local", "server/key.pem", "server/id.key", "package.json", "client/package.json", "package-lock.json", "pnpm-lock.yaml", ".replit", "replit.nix", "drizzle.config.ts", "AGENTS.md", "CLAUDE.md", "server/AGENTS.md",
  "script/replit-deploy.ts", "server/../package.json", "../server/x.ts", "server/./x.ts", "/server/x.ts", "server\\x.ts", "server//x.ts", "server/x.ts ", "C:/server/x.ts", "server/software-factory-x.ts", "server/kong.ts", "docs/readme.md", "script/x.ts"];
 for (const path of denied) assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, [path, testPath])), undefined, path);
 assert.equal(f.calls(), 0);
});

test("per-order paths are bounded by maxFilesPerOrder and require a regression test path", async () => {
 const f = await fixture(), files = (n: number) => [testPath, ...Array.from({ length: n - 1 }, (_, i) => `server/office-${i}.ts`)];
 assert.doesNotThrow(() => validateAsistenteOperatorConfig(withPaths(f.config, files(6))));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, files(7))));
 assert.doesNotThrow(() => validateAsistenteOperatorConfig(withPaths(f.config, files(8), { maxFilesPerOrder: 8 })));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, files(9), { maxFilesPerOrder: 8 })));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, files(3), { maxFilesPerOrder: 2 })));
 for (const bad of [{ maxFilesPerOrder: 0 }, { maxFilesPerOrder: 9 }, { maxDraftPullRequestsPerDay: 0 }, { maxDraftPullRequestsPerDay: 11 }]) assert.throws(() => validateAsistenteOperatorConfig({ ...f.config, ...bad }));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, ["server/office-role-work.ts"])), /TEST_PATH_REQUIRED/);
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, [testPath, testPath])));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, [testPath, "TESTS/office-role-work.test.ts"])));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, [])));
 assert.throws(() => validateAsistenteOperatorConfig({ ...f.config, orders: [{ ...f.config.orders[0], paths: undefined }] }));
});

const prJob = (id: number, createdAt = at.toISOString(), extra: Record<string, unknown> = {}) => ({ id: `pr-${id}`, ownerKey, key: `k${id}`, projectId: "asistente", kind: "build", status: "completed", createdAt, completedAt: createdAt, reservedCents: 2, recoveryCents: 0, payload: {}, month: "2026-11",
 result: { status: "completed", costCents: 1, evidence: { pipelineState: { candidate: { prUrl: `https://github.com/robertmanzanillag-jpg/blackops/pull/${id}` } } } }, ...extra });

test("draft PR count is owner-wide per UTC day and fails closed on an unprovable window", async () => {
 const { countDraftPullRequestsToday } = await import("../server/software-factory-asistente-operator");
 const jobs: any[] = [prJob(1), prJob(2, "2026-11-06T23:59:59.000Z"), prJob(3, at.toISOString(), { kind: "review" }), prJob(4, at.toISOString(), { ownerKey: "f".repeat(64) }),
  prJob(5, at.toISOString(), { status: "unknown", result: {} }), prJob(6, at.toISOString(), { status: "failed", result: { status: "failed", costCents: 1, reconciled: true } }),
  prJob(7, at.toISOString(), { status: "failed", result: { status: "failed", costCents: 1 } })];
 assert.equal(countDraftPullRequestsToday(jobs, at, ownerKey), 3);
 assert.throws(() => countDraftPullRequestsToday(Array.from({ length: 100 }, (_, i) => prJob(100 + i, "2026-11-07T00:00:01.000Z", { kind: "simulate" })) as any, at, ownerKey), /UNVERIFIED/);
});

test("daily draft PR cap defers admission and the build stage before any provider credit", async () => {
 const f = await fixture();
 const config = { ...f.config, maxDraftPullRequestsPerDay: 5 };
 for (let i = 0; i < 5; i++) f.jobs.push(prJob(i));
 const worker = await createAsistenteOperatorComposition(config, f.deps).createFactoryWorkerOptions();
 // Admission: the order is left unadmitted (no credit hold, no queue write).
 await worker.scheduleCompanyOrders!(owner);
 assert.equal(f.calls(), 0); assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
 // Build: the sixth PR in the same UTC day is deferred to the next UTC midnight at zero cost.
 const finding = { id: f.input.key, kind: "improvement", regressionScenarioId: "office-role-work-owner-cas-v1", baseSha: "b".repeat(40), request: "x", artifactIds: ["a"], sourcePaths: ["server/office-role-work.ts", testPath] };
 const discover = { id: "11111111-1111-4111-8111-111111111111", ownerKey, projectId: "asistente", kind: "discover", status: "completed", key: f.input.key, payload: {}, reservedCents: 1, recoveryCents: 0, month: "2026-11", createdAt: at.toISOString(),
  result: { status: "completed", costCents: 0, evidence: { pipelineState: { version: 1, projectId: "asistente", rootJobId: "11111111-1111-4111-8111-111111111111", target: "staging", finding, evidence: [], repairAttempts: 0 } } } };
 f.store.getCompletedJob = async () => discover;
 const job: any = { id: "22222222-2222-4222-8222-222222222222", ownerKey, projectId: "asistente", kind: "build", key: `${discover.id}.next`, payload: { previousJobId: discover.id, repairAttempts: 0 }, reservedCents: 2, recoveryCents: 0, month: "2026-11", status: "running", createdAt: at.toISOString() };
 const sixth = await worker.adapters!.build!.execute(job, { signal: new AbortController().signal, maxCostCents: 2 });
 assert.equal(sixth.status, "blocked"); assert.equal(sixth.costCents, 0); assert.equal(sixth.reason, "FACTORY_DAILY_DRAFT_PR_LIMIT");
 assert.equal(sixth.deferUntil, "2026-11-08T00:00:00.000Z");
 assert.equal((await f.ledger.status()).reservedMicroUsd, 0); assert.equal((await f.ledger.status()).spentMicroUsd, 0);
 // Four PRs today: the build proceeds past the cap (and stops at the synthetic GitHub boundary, still before any credit).
 f.jobs.pop();
 const fifth = await worker.adapters!.build!.execute(job, { signal: new AbortController().signal, maxCostCents: 2 });
 assert.notEqual(fifth.reason, "FACTORY_DAILY_DRAFT_PR_LIMIT"); assert.equal(fifth.deferUntil, undefined);
 assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
});

test("discovery persists the mapped per-order selection into the job state", async () => {
 const f = await fixture(), base = "b".repeat(40);
 f.deps.githubRequest = async (url: string) => { assert.match(url, /\/git\/ref\/heads\/main$/); return Response.json({ ref: "refs/heads/main", object: { type: "commit", sha: base } }); };
 f.store.claimFinding = async () => true;
 const worker = await createAsistenteOperatorComposition(f.config, f.deps).createFactoryWorkerOptions();
 const job: any = { id: "33333333-3333-4333-8333-333333333333", ownerKey, projectId: "asistente", kind: "discover", key: f.input.key, payload: f.input.payload, reservedCents: 1, recoveryCents: 0, month: "2026-11", status: "running", createdAt: at.toISOString() };
 const found = await worker.adapters!.discover!.execute(job, { signal: new AbortController().signal, maxCostCents: 1 });
 assert.equal(found.status, "completed", JSON.stringify(found));
 assert.deepEqual((found.evidence as any).pipelineState.finding.sourcePaths, ["server/office-role-work.ts", testPath]);
 assert.equal(found.next?.kind, "build");
});

// ---------------------------------------------------------------------------
// Phase 3: automatic owner orders (autoAdmit), bounded file selection and the
// generic checks-based acceptance scenario.
import { COMPANY_ORDER_CHECKS_ID, companyOrderChecksAcceptance } from "../server/software-factory-company-auto";
import { createFactoryPipeline } from "../server/software-factory-pipeline";
import { proposalEvidenceGate } from "../server/software-factory";
const autoBase = "e".repeat(40), autoTree = "f".repeat(40), fixtureModel = "fixture-model-2026-01-01";
const listing = ["server/office-search.ts", "server/office-role-work.ts", "client/src/pages/office.tsx", "tests/office-search.test.ts", "tests/office-role-work.test.ts"];
const autoOrder = (id: string, createdAt: string, text = "Improve office search ranking"): CompanyOrder => ({ id, text, createdAt, assignees: [{ agentId: "code", status: "en_curso", note: "" }] });
async function autoFixture(options: { orders?: CompanyOrder[]; grant?: number; autoAdmit?: AsistenteOperatorConfig["autoAdmit"] | null; reply?: () => string; generation?: () => Promise<Response> } = {}) {
    const base = await fixture();
    let state: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] }, tail: Promise<unknown> = Promise.resolve();
    const transact: CreditTransaction = async (fn) => { const p = tail.then(() => { const copy = structuredClone(state), r = fn(copy); state = copy; return r; }); tail = p.catch(() => { }); return p; };
    const ledger = createSharedOpenAiCreditLedger({ transact, now: () => at, maximumGrantObservationAgeMs: 60000, grant: { id: "grant", accountScope: "same-account", availableMicroUsd: options.grant ?? 1000000, observedAt: at.toISOString(), expiresAt: "2026-11-20T00:00:00Z", verificationEvidenceId: "verified" } });
    await ledger.initialize();
    const orders = options.orders ?? [autoOrder("auto-1", at.toISOString())];
    const jobs: any[] = [];
    let enqueued = 0, modelCalls = 0, generations = 0, githubCalls = 0;
    const store: any = { status: async () => ({ configured: true, paused: false, limitCents: 10000, fixedCents: 0, spentCents: 0, reservedCents: 0 }), projectByOwnerKey: async () => project, list: async () => jobs,
        claimFinding: async () => true,
        enqueue: async (_o: string, i: any) => { enqueued++; const job = { ...i, id: `job-${enqueued}`, ownerKey, status: "pending", createdAt: at.toISOString() }; jobs.push(job); return job; } };
    const reply = options.reply ?? (() => JSON.stringify({ kind: "improvement", paths: ["server/office-search.ts", "tests/office-search.test.ts"] }));
    const deps = { ...base.deps, store, credits: { ledger, pricing: { model: fixtureModel, inputNanoUsdPerToken: 1, outputNanoUsdPerToken: 1, validUntil: "2026-11-20T00:00:00Z" } }, readOrders: async () => orders,
        githubRequest: async (url: string) => { githubCalls++;
            if (url.endsWith("/git/ref/heads/main")) return Response.json({ ref: "refs/heads/main", object: { type: "commit", sha: autoBase } });
            if (url.endsWith(`/git/commits/${autoBase}`)) return Response.json({ sha: autoBase, tree: { sha: autoTree } });
            if (url.endsWith(`/git/trees/${autoTree}?recursive=1`)) return Response.json({ sha: autoTree, truncated: false, tree: [...listing, "server/kong.ts", ".github/workflows/x.yml", "package.json", "docs/x.md"].map(path => ({ path, type: "blob", mode: "100644", sha: "1".repeat(40) })).concat([{ path: "server", type: "tree", mode: "040000", sha: "2".repeat(40) }]) });
            throw Error(`UNEXPECTED_GITHUB_${url}`); },
        modelRequest: async (url: string, init: RequestInit) => { modelCalls++; const body = JSON.parse(String(init.body));
            assert.equal(body.text.format.type, "json_schema"); assert.equal(body.text.format.strict, true);
            if (url.endsWith("/input_tokens")) return Response.json({ object: "response.input_tokens", input_tokens: 100 });
            generations++; if (options.generation) return options.generation();
            assert.ok(body.max_output_tokens <= 1024);
            return Response.json({ object: "response", model: fixtureModel, status: "completed", usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: reply() }] }] }); } };
    const config: AsistenteOperatorConfig = { ...base.config, orders: [], ...(options.autoAdmit === null ? {} : { autoAdmit: options.autoAdmit ?? { enabled: true, since: "2026-11-06T00:00:00Z" } }) };
    const discoverJob = (order: CompanyOrder) => { const input = companyOrderJob(order, project, 1); return { id: "44444444-4444-4444-8444-444444444444", ownerKey, projectId: "asistente", kind: "discover", key: input.key, payload: input.payload, reservedCents: 1, recoveryCents: 0, month: "2026-11", status: "running", createdAt: at.toISOString() } as any; };
    return { config, deps, ledger, jobs, store, orders, discoverJob, counts: () => ({ enqueued, modelCalls, generations, githubCalls }) };
}
const signal = () => new AbortController().signal;

test("autoAdmit is strict, optional and disabled by default; caps are bounded by the draft PR cap", async () => {
    const f = await autoFixture({ autoAdmit: null });
    assert.equal(validateAsistenteOperatorConfig(f.config).autoAdmit, undefined);
    assert.equal(validateAsistenteOperatorConfig({ ...f.config, autoAdmit: { enabled: true, since: "2026-11-06T00:00:00Z", maxPerDay: 5 } }).autoAdmit?.maxPerDay, 5);
    for (const autoAdmit of [{ enabled: true }, { enabled: "yes", since: "2026-11-06T00:00:00Z" }, { enabled: true, since: "yesterday" }, { enabled: true, since: "2026-11-06T00:00:00Z", maxPerDay: 0 }, { enabled: true, since: "2026-11-06T00:00:00Z", maxPerDay: 6 }, { enabled: true, since: "2026-11-06T00:00:00Z", paths: ["server/x.ts"] }])
        assert.throws(() => validateAsistenteOperatorConfig({ ...f.config, autoAdmit } as any), undefined, JSON.stringify(autoAdmit));
    assert.equal(validateAsistenteOperatorConfig({ ...f.config, maxDraftPullRequestsPerDay: 8, autoAdmit: { enabled: true, since: "2026-11-06T00:00:00Z", maxPerDay: 8 } }).autoAdmit?.maxPerDay, 8);
});

test("auto admission off: unmapped orders are never admitted by the scheduler or the owner route", async () => {
    for (const autoAdmit of [null, { enabled: false, since: "2026-11-06T00:00:00Z" }] as const) {
        const f = await autoFixture({ autoAdmit }), operator = createAsistenteOperatorComposition(f.config, f.deps);
        await (await operator.createFactoryWorkerOptions()).scheduleCompanyOrders!(owner);
        await assert.rejects(operator.admitWithinCredits(owner, companyOrderJob(f.orders[0], project, 1)), /NOT_MAPPED/);
        assert.equal(f.counts().enqueued, 0); assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
    }
});

test("auto admission on: since filter, Kong rejection and oldest-first single admission per scan", async () => {
    const orders = [autoOrder("newest", "2026-11-06T20:00:00Z"), autoOrder("old", "2026-11-05T23:59:59Z"), autoOrder("kong-text", "2026-11-06T01:00:00Z", "Ajustar Kong"),
        { ...autoOrder("kong-agent", "2026-11-06T01:00:00Z"), assignees: [{ agentId: "kong", status: "en_curso", note: "" }, { agentId: "code", status: "en_curso", note: "" }] }, autoOrder("oldest-eligible", "2026-11-06T02:00:00Z")] as CompanyOrder[];
    const f = await autoFixture({ orders }), operator = createAsistenteOperatorComposition(f.config, f.deps), worker = await operator.createFactoryWorkerOptions();
    await worker.scheduleCompanyOrders!(owner);
    assert.deepEqual(f.jobs.map(j => j.payload.companyOrder.orderId), ["oldest-eligible"]);
    // The pending admission stops the next scan; once it settles, the next one follows.
    await worker.scheduleCompanyOrders!(owner); assert.equal(f.counts().enqueued, 1);
    f.jobs[0].status = "completed"; await worker.scheduleCompanyOrders!(owner);
    assert.deepEqual(f.jobs.map(j => j.payload.companyOrder.orderId), ["oldest-eligible", "newest"]);
    for (const kong of [orders[2], orders[3]]) assert.throws(() => companyOrderJob(kong, project, 1), /INELIGIBLE/);
    for (const id of ["kong-text", "kong-agent"]) await assert.rejects(operator.admitWithinCredits(owner, { ...companyOrderJob(orders[0], project, 1), payload: { companyOrder: { version: 1, company: "main", orderId: id, revision: "0".repeat(64) } } }), /INELIGIBLE/);
    await assert.rejects(operator.admitWithinCredits(owner, companyOrderJob(orders[1], project, 1)), /NOT_MAPPED/); // Before since.
    assert.equal(f.counts().enqueued, 2); assert.equal((await f.ledger.status()).reservedMicroUsd, 0); assert.equal(f.counts().modelCalls, 0);
    // An older settled admission that left the bounded window is history, never re-admitted.
    f.jobs[1].status = "completed"; f.jobs.splice(0, 1); await worker.scheduleCompanyOrders!(owner); assert.equal(f.counts().enqueued, 2);
});

test("system self-heal orders are admitted only with autoAdmit.systemOrders and an exact template", async () => {
    const { planSelfHeal } = await import("../server/office-self-heal");
    const { githubRecordId } = await import("../server/office-role-snapshots");
    const { emptyCompanyState } = await import("../shared/agent-company");
    const repoId = githubRecordId("repository", "robertmanzanillag-jpg/blackops");
    const journal = { jobs: [{ id: "g1", role: "github", status: "completed", completedAt: "2026-11-06T23:00:00Z", artifactId: "a".repeat(64), audit: { completeCoverage: true, findings: [{ code: "FAILING_DEFAULT_BRANCH", recordIds: [repoId], detail: "" }] }, source: { rows: [{ id: repoId, repo: "robertmanzanillag-jpg/blackops" }] } }] };
    const system = planSelfHeal({ state: undefined, company: emptyCompanyState(), journal, owner, now: Date.parse("2026-11-06T23:30:00Z"), maxPerDay: 1 }).created[0];
    const forged = { ...system, id: "ord-sh-forged", text: system.text.replace("añade una prueba", "omite la prueba") };
    for (const [systemOrders, expected] of [[undefined, 0], [false, 0], [true, 1]] as const) {
        const f = await autoFixture({ orders: [system, forged], autoAdmit: { enabled: true, since: "2026-11-06T00:00:00Z", ...(systemOrders === undefined ? {} : { systemOrders }) } });
        const operator = createAsistenteOperatorComposition(f.config, f.deps);
        await (await operator.createFactoryWorkerOptions()).scheduleCompanyOrders!(owner);
        assert.equal(f.counts().enqueued, expected, String(systemOrders));
        if (expected) assert.deepEqual(f.jobs.map(j => j.payload.companyOrder.orderId), [system.id]);
        else await assert.rejects(operator.admitWithinCredits(owner, companyOrderJob(system, project, 1)), /NOT_MAPPED/);
        await assert.rejects(operator.admitWithinCredits(owner, companyOrderJob(forged, project, 1)), /NOT_MAPPED/);
    }
    const baseConfig = (await autoFixture()).config;
    assert.throws(() => validateAsistenteOperatorConfig({ ...baseConfig, autoAdmit: { enabled: true, since: "2026-11-06T00:00:00Z", systemOrders: "yes" } } as any));
});

test("auto admission honors maxPerDay and the draft PR cap with no credit hold", async () => {
    const orders = [autoOrder("a", "2026-11-06T01:00:00Z"), autoOrder("b", "2026-11-06T02:00:00Z")];
    const f = await autoFixture({ orders, autoAdmit: { enabled: true, since: "2026-11-06T00:00:00Z", maxPerDay: 1 } }), operator = createAsistenteOperatorComposition(f.config, f.deps), worker = await operator.createFactoryWorkerOptions();
    await worker.scheduleCompanyOrders!(owner); f.jobs[0].status = "completed";
    await worker.scheduleCompanyOrders!(owner);
    assert.equal(f.counts().enqueued, 1);
    await assert.rejects(operator.admitWithinCredits(owner, companyOrderJob(orders[1], project, 1)), /DAILY_AUTO_ADMISSION_LIMIT/);
    // Idempotent re-admission of the already admitted order is not blocked by the cap.
    assert.equal((await operator.admitWithinCredits(owner, companyOrderJob(orders[0], project, 1))).id, "job-1");
    assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
    const g = await autoFixture({ orders }), capped = createAsistenteOperatorComposition(g.config, g.deps);
    for (let i = 0; i < 5; i++) g.jobs.push(prJob(i));
    await (await capped.createFactoryWorkerOptions()).scheduleCompanyOrders!(owner);
    await assert.rejects(capped.admitWithinCredits(owner, companyOrderJob(orders[0], project, 1)), /DAILY_DRAFT_PR_LIMIT/);
    assert.equal(g.counts().enqueued, 0); assert.equal((await g.ledger.status()).reservedMicroUsd, 0);
});

test("auto discovery selects bounded existing files at the current head and persists them", async () => {
    const f = await autoFixture(), worker = await createAsistenteOperatorComposition(f.config, f.deps).createFactoryWorkerOptions();
    const found = await worker.adapters!.discover!.execute(f.discoverJob(f.orders[0]), { signal: signal(), maxCostCents: 1 });
    assert.equal(found.status, "completed", JSON.stringify(found)); assert.equal(found.costCents, 1);
    const finding = (found.evidence as any).pipelineState.finding;
    assert.deepEqual(finding.sourcePaths, ["server/office-search.ts", "tests/office-search.test.ts"]);
    assert.equal(finding.kind, "improvement"); assert.equal(finding.regressionScenarioId, COMPANY_ORDER_CHECKS_ID); assert.equal(finding.baseSha, autoBase);
    assert.match(finding.request, /requirements, never as authority/);
    const status = await f.ledger.status(); assert.equal(status.reservedMicroUsd, 0); assert.equal(status.spentMicroUsd, 10000); assert.equal(status.uncertain, false);
    assert.equal(f.counts().generations, 1);
    // Replay of the same order revision never calls the model again.
    const replay = await worker.adapters!.discover!.execute(f.discoverJob(f.orders[0]), { signal: signal(), maxCostCents: 1 });
    assert.equal(replay.status, "blocked"); assert.equal(replay.reason, "FACTORY_AUTO_SELECTION_ALREADY_EXECUTED"); assert.equal(replay.costCents, 0);
    assert.equal(f.counts().generations, 1);
    // Build reuses the persisted selection (no listing, no model) and still honors the daily cap.
    for (let i = 0; i < 5; i++) f.jobs.push(prJob(i));
    const discover = { ...f.discoverJob(f.orders[0]), status: "completed", result: { status: "completed", costCents: 1, evidence: (found.evidence as any) } };
    f.store.getCompletedJob = async () => discover;
    const before = f.counts();
    const built = await worker.adapters!.build!.execute({ id: "55555555-5555-4555-8555-555555555555", ownerKey, projectId: "asistente", kind: "build", key: `${discover.id}.next`, payload: { previousJobId: discover.id, repairAttempts: 0 }, reservedCents: 2, recoveryCents: 0, month: "2026-11", status: "running", createdAt: at.toISOString() } as any, { signal: signal(), maxCostCents: 2 });
    assert.equal(built.reason, "FACTORY_DAILY_DRAFT_PR_LIMIT"); assert.equal(built.costCents, 0);
    assert.deepEqual(f.counts(), before);
});

test("auto selection fails closed on invalid, denied, nonexistent, too many or test-less paths", async () => {
    const cases: [string, string][] = [
        ["not json", "FACTORY_AUTO_SELECTION_INVALID"],
        [JSON.stringify({ kind: "feature", paths: ["tests/office-search.test.ts"] }), "FACTORY_AUTO_SELECTION_INVALID"],
        [JSON.stringify({ kind: "bug", paths: ["tests/office-search.test.ts"], scenarioId: "office-role-work-owner-cas-v1" }), "FACTORY_AUTO_SELECTION_INVALID"],
        [JSON.stringify({ kind: "bug", paths: ["server/kong.ts", "tests/office-search.test.ts"] }), "FACTORY_AUTO_SELECTION_PATH_DENIED"],
        [JSON.stringify({ kind: "bug", paths: [".github/workflows/x.yml", "tests/office-search.test.ts"] }), "FACTORY_AUTO_SELECTION_PATH_DENIED"],
        [JSON.stringify({ kind: "bug", paths: ["server/missing.ts", "tests/office-search.test.ts"] }), "FACTORY_AUTO_SELECTION_PATH_NOT_FOUND"],
        [JSON.stringify({ kind: "bug", paths: [...listing, "server/a.ts", "server/b.ts"] }), "FACTORY_AUTO_SELECTION_PATHS_INVALID"],
        [JSON.stringify({ kind: "bug", paths: [] }), "FACTORY_AUTO_SELECTION_PATHS_INVALID"],
        [JSON.stringify({ kind: "bug", paths: ["server/office-search.ts"] }), "FACTORY_AUTO_SELECTION_TEST_PATH_REQUIRED"],
    ];
    for (const [text, reason] of cases) {
        const f = await autoFixture({ reply: () => text }), worker = await createAsistenteOperatorComposition(f.config, f.deps).createFactoryWorkerOptions();
        const found = await worker.adapters!.discover!.execute(f.discoverJob(f.orders[0]), { signal: signal(), maxCostCents: 1 });
        assert.equal(found.status, "blocked", text); assert.equal(found.reason, reason, text); assert.equal(found.next, undefined);
        assert.equal(found.costCents, 1, text); // Known billed selection; zero further cost.
        const status = await f.ledger.status(); assert.equal(status.uncertain, false); assert.equal(status.reservedMicroUsd, 0);
        assert.equal(f.counts().generations, 1);
    }
});

test("auto selection with unavailable credit blocks at zero cost without any provider call", async () => {
    const f = await autoFixture({ grant: 5000 }), worker = await createAsistenteOperatorComposition(f.config, f.deps).createFactoryWorkerOptions();
    const found = await worker.adapters!.discover!.execute(f.discoverJob(f.orders[0]), { signal: signal(), maxCostCents: 1 });
    assert.equal(found.status, "blocked"); assert.equal(found.reason, "FACTORY_AUTO_SELECTION_CREDIT_UNAVAILABLE"); assert.equal(found.costCents, 0);
    assert.equal(f.counts().modelCalls, 0);
    const g = await autoFixture(); await g.ledger.reserve({ key: "office", consumer: "office", maximumMicroUsd: 10000, requestSha256: "d".repeat(64) }); await g.ledger.markUnknown("office", "lost");
    const blocked = await (await createAsistenteOperatorComposition(g.config, g.deps).createFactoryWorkerOptions()).adapters!.discover!.execute(g.discoverJob(g.orders[0]), { signal: signal(), maxCostCents: 1 });
    assert.equal(blocked.reason, "FACTORY_AUTO_SELECTION_CREDIT_UNAVAILABLE"); assert.equal(g.counts().modelCalls, 0);
});

test("unknown selection outcome keeps the hold and is never replayed", async () => {
    const f = await autoFixture({ generation: async () => { throw Error("CONNECTION_RESET_AFTER_SUBMIT"); } }), worker = await createAsistenteOperatorComposition(f.config, f.deps).createFactoryWorkerOptions();
    await assert.rejects(worker.adapters!.discover!.execute(f.discoverJob(f.orders[0]), { signal: signal(), maxCostCents: 1 }), /OUTCOME_UNKNOWN/);
    let status = await f.ledger.status(); assert.equal(status.uncertain, true); assert.equal(status.reservedMicroUsd, 10000);
    await assert.rejects(worker.adapters!.discover!.execute(f.discoverJob(f.orders[0]), { signal: signal(), maxCostCents: 1 }), /OUTCOME_UNKNOWN/);
    status = await f.ledger.status(); assert.equal(status.reservedMicroUsd, 10000);
    assert.equal(f.counts().generations, 1);
});

test("mapped orders keep precedence: pinned base, mapped scenario and paths, no selection call", async () => {
    const f = await autoFixture(), input = companyOrderJob(f.orders[0], project, 1), revision = (input.payload!.companyOrder as any).revision;
    const config = { ...f.config, orders: [{ id: f.orders[0].id, revision, baseSha: autoBase, kind: "bug" as const, scenarioId: "office-role-work-owner-cas-v1" as const, paths: ["server/office-role-work.ts", testPath] }] };
    const found = await (await createAsistenteOperatorComposition(config, f.deps).createFactoryWorkerOptions()).adapters!.discover!.execute(f.discoverJob(f.orders[0]), { signal: signal(), maxCostCents: 1 });
    const finding = (found.evidence as any).pipelineState.finding;
    assert.equal(finding.regressionScenarioId, "office-role-work-owner-cas-v1"); assert.deepEqual(finding.sourcePaths, ["server/office-role-work.ts", testPath]); assert.equal(found.costCents, 0);
    assert.equal(f.counts().modelCalls, 0);
    // An explicitly mapped id with an edited revision never falls back to automatic admission.
    const edited = { ...f.orders[0], text: "Improve office search ranking v2" };
    await assert.rejects(createAsistenteOperatorComposition(config, { ...f.deps, readOrders: async () => [edited] }).admitWithinCredits(owner, companyOrderJob(edited, project, 1)), /NOT_MAPPED/);
});

test("generic acceptance is satisfied only by checks on the exact head and the gate still needs independent review", async () => {
    const accepted = await companyOrderChecksAcceptance({ runId: 7, baseSha: "a".repeat(40), headSha: "b".repeat(40), signal: signal() });
    assert.deepEqual(accepted.regressionScenarioIds, [COMPANY_ORDER_CHECKS_ID]);
    await assert.rejects(companyOrderChecksAcceptance({ runId: 7, baseSha: "a".repeat(40), headSha: "a".repeat(40), signal: signal() }));
    const candidate: any = { projectId: "asistente", baseSha: "a".repeat(40), headSha: "b".repeat(40), prUrl: "https://github.com/robertmanzanillag-jpg/blackops/pull/9", builderId: "factory-remote-builder", risk: "unknown", reversible: true, changedFiles: ["server/office-search.ts", "tests/office-search.test.ts"], affectsContracts: false, affectsData: false, repairAttempts: 0 };
    const now = at.getTime(), ev = (kind: string, extra: any = {}) => ({ projectId: "asistente", baseSha: candidate.baseSha, headSha: candidate.headSha, kind, passed: true, warnings: [], createdAt: at.toISOString(), actorId: "checker", artifactIds: ["x"], ...extra });
    const sim = ev("simulation", { syntheticData: true, externalServicesMocked: true, viewports: ["mobile", "desktop"], journeyIds: project.journeys, baselineJourneyIds: project.journeys });
    const full: any = { ...project, testCommand: "npm test", buildCommand: "npm run build" };
    assert.ok(proposalEvidenceGate(full, candidate, [ev("tests", { journeyIds: [COMPANY_ORDER_CHECKS_ID] }), sim] as any, now).reasons.includes("review_evidence_missing_or_failed"));
    assert.ok(proposalEvidenceGate(full, candidate, [ev("tests"), sim, ev("review", { actorId: candidate.builderId })] as any, now).reasons.includes("independent_review_required"));
    assert.ok(proposalEvidenceGate(full, candidate, [sim, ev("review")] as any, now).reasons.includes("tests_evidence_missing_or_failed"));
    assert.equal(proposalEvidenceGate(full, candidate, [ev("tests"), sim, ev("review")] as any, now).allowed, true);
    // Build stage: the generic scenario must come from the checks and a test file must change.
    const finding = { id: "f", kind: "improvement" as const, regressionScenarioId: COMPANY_ORDER_CHECKS_ID, request: "x", baseSha: candidate.baseSha, artifactIds: ["a"], sourcePaths: candidate.changedFiles };
    const discover = { id: "d", ownerKey, projectId: "asistente", kind: "discover", status: "completed", key: "k", payload: {}, result: { status: "completed", costCents: 0, evidence: { pipelineState: { version: 1, projectId: "asistente", rootJobId: "d", target: "staging", finding, evidence: [], repairAttempts: 0 } } } };
    for (const [tests, changed, expected] of [[[], candidate.changedFiles, "FACTORY_PERMANENT_REGRESSION_TEST_REQUIRED"], [[COMPANY_ORDER_CHECKS_ID], ["server/office-search.ts"], "FACTORY_PERMANENT_REGRESSION_TEST_REQUIRED"], [[COMPANY_ORDER_CHECKS_ID], candidate.changedFiles, undefined]] as const) {
        const pipeline = createFactoryPipeline({ executionMode: "review-only", project: async () => full, previous: async () => discover as any, claimFinding: async () => true, reservations: { discover: 1, build: 1, simulate: 1, review: 1, deploy: 1, verify: 1, rollback: 1, evaluate: 1 },
            discover: async () => ({ costCents: 0 }), simulate: async () => ({ costCents: 0, evidence: sim as any }), review: async () => ({ costCents: 0, evidence: ev("review") as any }),
            build: async () => ({ costCents: 0, candidate: { ...candidate, changedFiles: [...changed] }, tests: ev("tests", { journeyIds: [...tests] }) as any }), now: () => at });
        const out = await pipeline.adapters.build!.execute({ id: "b", ownerKey, projectId: "asistente", kind: "build", key: "d.next", payload: { previousJobId: "d", repairAttempts: 0 }, reservedCents: 1, recoveryCents: 0 } as any, { signal: signal(), maxCostCents: 1 });
        assert.equal(out.reason, expected); assert.equal(out.status, expected ? "blocked" : "completed");
    }
});
test("office review handoff sweep runs before order scheduling, is off by default and never blocks scheduling", async () => {
    // Disabled: no office review dependency means no proposal read at all.
    let f = await fixture(), reads = 0;
    f.store.projects = async () => { reads++; return [project]; };
    f.store.getCompletedJob = async () => undefined;
    let worker = await createAsistenteOperatorComposition(f.config, f.deps).createFactoryWorkerOptions();
    await worker.scheduleCompanyOrders!(owner);
    assert.equal(reads, 0);
    assert.equal(f.calls(), 1);
    // Enabled: the sweep reads verified proposals first; nothing recorded means no enqueue.
    f = await fixture(); reads = 0;
    const order: string[] = [];
    f.store.projects = async () => { reads++; order.push("sweep"); return [project]; };
    f.store.getCompletedJob = async () => undefined;
    const enqueue = f.store.enqueue; f.store.enqueue = async (...args: any[]) => { order.push("schedule"); return enqueue(...args); };
    let enqueued = 0;
    const composition = createAsistenteOperatorComposition(f.config, { ...f.deps, enqueueOfficeReview: async () => { enqueued++; return { status: "enqueued" as const }; } });
    worker = await composition.createFactoryWorkerOptions();
    await worker.scheduleCompanyOrders!(owner);
    assert.deepEqual(order, ["sweep", "schedule"]);
    assert.equal(enqueued, 0);
    await assert.rejects(worker.scheduleCompanyOrders!("someone-else"), /OWNER_MISMATCH/);
    // A failing handoff is logged and reconciled later; scheduling still runs.
    f = await fixture();
    f.store.projects = async () => { throw Error("OFFICE_DB_DOWN"); };
    f.store.getCompletedJob = async () => undefined;
    const logs: string[] = [];
    worker = await createAsistenteOperatorComposition(f.config, { ...f.deps, log: (m: string) => logs.push(m), enqueueOfficeReview: async () => { throw Error("unreachable"); } }).createFactoryWorkerOptions();
    await worker.scheduleCompanyOrders!(owner);
    assert.equal(f.calls(), 1);
    assert.equal(logs.length, 1);
});

test("office career scoring sweep runs before order scheduling, is off by default and never blocks scheduling", async () => {
    let f = await fixture();
    let worker = await createAsistenteOperatorComposition(f.config, f.deps).createFactoryWorkerOptions();
    await worker.scheduleCompanyOrders!(owner);
    assert.equal(f.calls(), 1);
    f = await fixture();
    const order: string[] = [];
    const enqueue = f.store.enqueue; f.store.enqueue = async (...args: any[]) => { order.push("schedule"); return enqueue(...args); };
    worker = await createAsistenteOperatorComposition(f.config, { ...f.deps, scoreOfficeCareers: async () => { order.push("careers"); } }).createFactoryWorkerOptions();
    await worker.scheduleCompanyOrders!(owner);
    assert.deepEqual(order, ["careers", "schedule"]);
    f = await fixture();
    const logs: string[] = [];
    worker = await createAsistenteOperatorComposition(f.config, { ...f.deps, log: (m: string) => logs.push(m), scoreOfficeCareers: async () => { throw Error("COUNCIL_DOWN"); } }).createFactoryWorkerOptions();
    await worker.scheduleCompanyOrders!(owner);
    assert.equal(f.calls(), 1);
    assert.match(logs.join("\n"), /career scoring unconfirmed/);
});

test("operator config accepts the production integration base branch and rejects unlisted branches", async () => {
    const f = await fixture();
    for (const baseBranch of ["main", "codex/office-integrated-repair-20261106", "claude/integration-20261111"])
        assert.equal(validateAsistenteOperatorConfig({ ...f.config, baseBranch }).baseBranch, baseBranch);
    for (const baseBranch of ["claude/integration-20261110", "claude/other", "factory/x", "master", ""])
        assert.throws(() => validateAsistenteOperatorConfig({ ...f.config, baseBranch }), undefined, baseBranch);
    const operator = createAsistenteOperatorComposition({ ...f.config, baseBranch: "claude/integration-20261111" }, f.deps);
    validateFactoryWorkerOptions(await operator.createFactoryWorkerOptions());
});
