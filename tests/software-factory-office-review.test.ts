import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFactoryOrderProposals } from "../server/software-factory-order-evidence";
import { createFactoryOfficeReviewSweep, factoryOfficeReviewKey, linkFactoryOfficeReview, linkFactoryOfficeReviews } from "../server/software-factory-office-review";
import { createOfficeCloudStore, type OfficeCloudPool, type OfficeCloudClient, type OfficeCloudQueryResult, type OfficeCloudRun } from "../server/office-cloud-store";
import { createOfficeCloudRuntime } from "../server/office-cloud-runtime";
import { createOfficeExecution } from "../server/office-execution";
import { createAgentCouncil, CouncilStateConflict } from "../server/agent-council";
import { emptyCouncilState } from "../shared/agent-council";
import { advanceCompany } from "../shared/agent-company";
import type { OfficeRun } from "../server/office-runtime";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const OWNER = "owner", ownerKey = createHash("sha256").update(OWNER).digest("hex");
const AT = "2026-11-07T01:00:00.000Z", BASE = "a".repeat(40), HEAD = "b".repeat(40), PR_URL = "https://github.com/example/repo/pull/1";

/** Same verified chain shape as the order-evidence tests: a factory draft PR
 * recorded in the build stage, carried through simulate and the factory review. */
function factoryChain(options: { prUrl?: string } = {}) {
  const revision = "c".repeat(64), key = `company-order:${hash(["asistente", "order", revision])}`;
  const project = { id: "asistente", repo: "example/repo", testCommand: "test", buildCommand: "build", journeys: ["regression"] } as any;
  const candidate = { projectId: "asistente", headSha: HEAD, baseSha: BASE, prUrl: options.prUrl ?? PR_URL, builderId: "builder", repairAttempts: 0, changedFiles: ["tests/regression.test.ts"] };
  const finding = { id: key, kind: "bug", request: "order", baseSha: BASE, artifactIds: [`company-order-sha256:${revision}`] };
  const evidence = ["tests", "simulation", "review"].map(kind => ({ projectId: "asistente", headSha: HEAD, baseSha: BASE, kind, passed: true, warnings: [], createdAt: AT, actorId: kind === "review" ? "independent" : "builder", artifactIds: ["artifact"], journeyIds: ["regression"], baselineJourneyIds: ["regression"], viewports: ["mobile", "desktop"], syntheticData: true, externalServicesMocked: true }));
  const jobs = ["discover", "build", "simulate", "review"].map((kind, i) => ({ id: kind, ownerKey, projectId: "asistente", kind, status: "completed", createdAt: AT, completedAt: AT, key: i ? `${["discover", "build", "simulate"][i - 1]}.next` : key, headSha: i > 1 ? HEAD : undefined,
    payload: i ? { previousJobId: ["discover", "build", "simulate"][i - 1] } : { companyOrder: { version: 1, company: "main", orderId: "order", revision } },
    result: { status: "completed", ...(kind === "review" ? { reason: "FACTORY_PR_REVIEWED_NOT_DEPLOYED" } : {}), evidence: { pipelineState: { version: 1, projectId: "asistente", rootJobId: "discover", target: "staging", repairAttempts: 0, finding, candidate: i ? candidate : undefined, evidence: evidence.slice(0, i) } } } }));
  const readProposals = () => readFactoryOrderProposals({ owner: OWNER, jobs: [jobs[3]] as any, projects: [project], now: Date.parse(AT) + 86_400_000, getCompletedJob: async (_key, id) => jobs.find(j => j.id === id) as any });
  return { jobs, readProposals };
}

/** Deterministic contract driver for the queries this feature adds (not PostgreSQL). */
class Pool implements OfficeCloudPool {
  rows: Record<string, any>[] = [];
  time = Date.parse("2026-11-08T10:00:00Z");
  inserts = 0;
  async connect(): Promise<OfficeCloudClient> { return { query: (sql, p) => this.query(sql, p), release: () => {} }; }
  async query(sql: string, p: unknown[] = []): Promise<OfficeCloudQueryResult> {
    const copy = (rows: Record<string, unknown>[]) => ({ rows: JSON.parse(JSON.stringify(rows)), rowCount: rows.length });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("office:owner-lock")) return copy([]);
    if (sql.includes("office:find-key")) return copy(this.rows.filter(r => r.owner_key === p[0] && r.idempotency_key === p[1]));
    if (sql.includes("office:factory-review-count")) {
      assert.match(sql, /input->>'source'='factory'/); assert.match(sql, /date_trunc\('day'/);
      const day = Date.parse(new Date(this.time).toISOString().slice(0, 10) + "T00:00:00Z");
      return copy([{ count: this.rows.filter(r => r.owner_key === p[0] && r.input.source === "factory" && Date.parse(r.created_at) >= day).length }]);
    }
    if (sql.includes("office:factory-review*/")) {
      const [id, owner_key, idempotency_key, request_hash, input] = p;
      if (this.rows.some(r => r.owner_key === owner_key && r.idempotency_key === idempotency_key)) return copy([]);
      this.inserts++;
      const row = { id, owner_key, idempotency_key, request_hash, input: JSON.parse(input as string), status: "pending", created_at: new Date(this.time++).toISOString() };
      this.rows.push(row); return copy([row]);
    }
    if (sql.includes("office:claim")) {
      const row = this.rows.find(r => r.status === "pending" && (!p[3] || (r.owner_key === p[3] && r.input.kind === "claude_review")));
      if (!row) return copy([]);
      Object.assign(row, { status: "running", worker_id: p[0], fence: p[1], lease_expires_at: new Date(this.time + Number(p[2])).toISOString(), started_at: new Date(this.time).toISOString() });
      return copy([row]);
    }
    if (sql.includes("office:complete")) {
      const row = this.rows.find(r => r.id === p[0] && r.worker_id === p[1] && r.fence === p[2] && r.status === "running");
      if (!row) return copy([]);
      Object.assign(row, { status: p[3], result: JSON.parse(p[4] as string), completed_at: new Date(this.time).toISOString() });
      return copy([row]);
    }
    if (sql.includes("office:list")) return copy(this.rows.filter(r => r.owner_key === p[0]).reverse());
    if (sql.includes("office:expire")) return copy([]);
    throw Error(`unexpected query ${sql.slice(0, 40)}`);
  }
}
const officeStore = (pool: Pool) => createOfficeCloudStore({ pool, leaseMs: 180_000 });
const enqueueVia = (store: ReturnType<typeof officeStore>) => (owner: string, input: { prUrl: string; key: string; maxPerDay: number }) => store.enqueueFactoryReview(owner, input);

test("published factory draft PR enqueues exactly one office review bound to the factory job and head", async () => {
  const f = factoryChain(), pool = new Pool(), store = officeStore(pool);
  const sweep = createFactoryOfficeReviewSweep({ owner: OWNER, maxPerDay: 5, readProposals: f.readProposals, enqueue: enqueueVia(store) });
  assert.deepEqual(await sweep(), { enqueued: 1, existing: 0, capped: false, skipped: 0 });
  assert.equal(pool.rows.length, 1);
  const row = pool.rows[0];
  assert.deepEqual(row.input, { kind: "claude_review", prUrl: PR_URL, key: factoryOfficeReviewKey(OWNER, "review", HEAD), source: "factory" });
  assert.equal(row.owner_key, ownerKey);
  // Restart / retry: the same permanent key returns the existing record and never inserts again.
  for (let i = 0; i < 3; i++) assert.deepEqual(await createFactoryOfficeReviewSweep({ owner: OWNER, maxPerDay: 5, readProposals: f.readProposals, enqueue: enqueueVia(store) })(), { enqueued: 0, existing: 1, capped: false, skipped: 0 });
  assert.equal(pool.inserts, 1);
  // Concurrent sweeps in one process share a single pass.
  const shared = createFactoryOfficeReviewSweep({ owner: OWNER, maxPerDay: 5, readProposals: f.readProposals, enqueue: enqueueVia(store) });
  const [a, b] = await Promise.all([shared(), shared()]);
  assert.equal(a, b); assert.equal(pool.inserts, 1);
  const decoded = (await store.list(OWNER))[0];
  assert.equal(decoded.source, "factory");
});

test("the key changes with the exact head, so a new head is a new review and the old one is never reused", () => {
  const first = factoryOfficeReviewKey(OWNER, "review", HEAD), second = factoryOfficeReviewKey(OWNER, "review", "d".repeat(40));
  assert.notEqual(first, second);
  assert.equal(first, factoryOfficeReviewKey(OWNER, "review", HEAD));
  assert.notEqual(first, factoryOfficeReviewKey("other", "review", HEAD));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => factoryOfficeReviewKey(OWNER, "review", "not-a-sha"));
});

test("no enqueue without a recorded, verified draft PR", async () => {
  const pool = new Pool(), store = officeStore(pool);
  // Unverified chain (no PR recorded / foreign PR / unfinished factory review) yields no proposal.
  for (const mutate of [(f: any) => { delete f.jobs[3].result.evidence.pipelineState.candidate.prUrl; }, (f: any) => { f.jobs[3].result.evidence.pipelineState.candidate.prUrl = "https://github.com/other/repo/pull/1"; }, (f: any) => { f.jobs[3].status = "unknown"; }]) {
    const f = factoryChain(); mutate(f);
    assert.deepEqual(await createFactoryOfficeReviewSweep({ owner: OWNER, maxPerDay: 5, readProposals: f.readProposals, enqueue: enqueueVia(store) })(), { enqueued: 0, existing: 0, capped: false, skipped: 0 });
  }
  // Defensive: even a malformed proposal handed in directly is skipped.
  const bad = { orderId: "o", orderRevision: "c".repeat(64), reviewJobId: "review", projectId: "asistente", prUrl: "javascript:alert(1)", baseSha: BASE, headSha: HEAD, completedAt: AT, evidenceCount: 3, scope: "reviewed_proposal", orderLink: "historical_unverified", published: false, careerCredit: false } as const;
  assert.deepEqual(await createFactoryOfficeReviewSweep({ owner: OWNER, maxPerDay: 5, readProposals: async () => ({ proposals: [bad], status: "complete" }), enqueue: enqueueVia(store) })(), { enqueued: 0, existing: 0, capped: false, skipped: 1 });
  assert.deepEqual(await createFactoryOfficeReviewSweep({ owner: OWNER, maxPerDay: 5, readProposals: async () => ({ proposals: [], status: "unavailable" }), enqueue: async () => { throw Error("must not enqueue"); } })(), { enqueued: 0, existing: 0, capped: false, skipped: 0 });
  assert.equal(pool.rows.length, 0);
});

test("factory reviews are capped per UTC day at the factory daily draft PR limit", async () => {
  const pool = new Pool(), store = officeStore(pool);
  const proposal = (i: number) => ({ orderId: `o${i}`, orderRevision: "c".repeat(64), reviewJobId: `review-${i}`, projectId: "asistente", prUrl: `https://github.com/example/repo/pull/${i + 1}`, baseSha: BASE, headSha: HEAD, completedAt: new Date(Date.parse(AT) + i).toISOString(), evidenceCount: 3, scope: "reviewed_proposal" as const, orderLink: "historical_unverified" as const, published: false as const, careerCredit: false as const });
  const proposals = [0, 1, 2].map(proposal);
  const sweep = () => createFactoryOfficeReviewSweep({ owner: OWNER, maxPerDay: 2, readProposals: async () => ({ proposals, status: "complete" }), enqueue: enqueueVia(store) })();
  assert.deepEqual(await sweep(), { enqueued: 2, existing: 0, capped: true, skipped: 0 });
  assert.deepEqual(await sweep(), { enqueued: 0, existing: 2, capped: true, skipped: 0 });
  pool.time += 86_400_000;
  assert.deepEqual(await sweep(), { enqueued: 1, existing: 2, capped: false, skipped: 0 });
  assert.equal(pool.rows.length, 3);
  await assert.rejects(store.enqueueFactoryReview(OWNER, { prUrl: PR_URL, key: randomUUID(), maxPerDay: 0 }), /no es valida/);
});

test("reviewer verdict links back to the order evidence as read-only pass/fail with findings count", async () => {
  const f = factoryChain(), pool = new Pool(), store = officeStore(pool), runtime = createOfficeCloudRuntime(store);
  await createFactoryOfficeReviewSweep({ owner: OWNER, maxPerDay: 5, readProposals: f.readProposals, enqueue: enqueueVia(store) })();
  const { proposals } = await f.readProposals();
  assert.equal(linkFactoryOfficeReviews(OWNER, proposals, await runtime.list(OWNER))[0].officeReview!.status, "pending");
  assert.equal(linkFactoryOfficeReviews(OWNER, proposals, undefined)[0].officeReview!.status, "unavailable");
  // The review-only office worker claims it through the owner-scoped filter.
  const claimed = (await store.claim("office-cloud-test", { ownerId: OWNER, reviewOnly: true }))!;
  assert.equal(claimed.source, "factory");
  assert.equal(linkFactoryOfficeReviews(OWNER, proposals, await runtime.list(OWNER))[0].officeReview!.status, "running");
  const findings = ["Missing null check", "Unbounded loop"];
  await store.complete(claimed.id, "office-cloud-test", claimed.fence!, { status: "completed", text: "Blocked", sessionId: "s1", provider: "openai",
    review: { prUrl: PR_URL, headSha: HEAD, diffSha256: "e".repeat(64), verdict: "block", summary: "Blocked", findings } });
  const linked = linkFactoryOfficeReviews(OWNER, proposals, await runtime.list(OWNER))[0];
  assert.equal(linked.officeReview!.status, "block");
  assert.equal(linked.officeReview!.findingsCount, 2);
  assert.equal(linked.published, false); assert.equal(linked.careerCredit, false);
  assert.doesNotMatch(JSON.stringify(linked), /Missing null check/);
  // A verdict bound to another head is never attributed to this proposal.
  const runs = await runtime.list(OWNER);
  const moved = runs.map(r => ({ ...r, review: { ...r.review!, headSha: "d".repeat(40) } })) as OfficeRun[];
  assert.equal(linkFactoryOfficeReview(OWNER, proposals[0], moved).status, "head_mismatch");
  const pass = runs.map(r => ({ ...r, review: { ...r.review!, verdict: "pass", findings: [] } })) as OfficeRun[];
  assert.deepEqual({ ...linkFactoryOfficeReview(OWNER, proposals[0], pass), runId: undefined, completedAt: undefined }, { status: "pass", findingsCount: 0, runId: undefined, completedAt: undefined });
  // Manual reviews of the same PR without the factory key are not linked.
  assert.equal(linkFactoryOfficeReview(OWNER, proposals[0], runs.map(r => ({ ...r, key: randomUUID() }))).status, "not_requested");
});

test("real factory review outcome is scored once through the existing reviewer lifecycle", async () => {
  const NOW = Date.parse("2026-11-06T12:00:00Z"), role = "claude-reviewer";
  const initial = emptyCouncilState();
  initial.company = advanceCompany(initial.company, { now: NOW - 86400001, roles: { [role]: "Reviewer" }, statuses: { [role]: { state: "working", label: "Observed result" } } }).state;
  let raw = JSON.stringify(initial), revision = 0;
  const council = () => createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async () => {},
    versioned: { read: async () => ({ raw, revision }), write: async (next, expected) => { if (expected !== revision) throw new CouncilStateConflict(); raw = next; return ++revision; } },
    collect: async () => ({}), submitProposal: async () => "", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  const env = { OFFICE_REVIEW_PROVIDER: "openai", OFFICE_OPENAI_MODEL: "test-model", OPENAI_API_KEY: "test-only", OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT: "100000" };
  const diff = "+const safe = true;";
  let calls = 0;
  const execution = createOfficeExecution(council(), env, () => NOW, {
    loadPr: async prUrl => ({ prUrl, headSha: HEAD, diff, diffSha256: createHash("sha256").update(diff).digest("hex") }),
    fetch: (async () => { calls++; return new Response(JSON.stringify({ id: "resp_test", model: "test-model", status: "completed", usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ verdict: "block", summary: "Found issues", findings: ["Missing test"] }) }] }] })); }) as typeof fetch,
  });
  const before = (await council().load()).company.careers[role].cyclesTotal;
  const task: OfficeCloudRun = { id: randomUUID(), key: factoryOfficeReviewKey(OWNER, "review", HEAD), kind: "claude_review", prUrl: PR_URL, source: "factory", status: "running", createdAt: new Date(NOW).toISOString(), fence: randomUUID(), leaseExpiresAt: new Date(NOW + 180000).toISOString() };
  assert.equal(await execution.admission.begin(task), true);
  const output = await execution.execute({ ...task, status: "running" } as OfficeRun);
  assert.equal(output.review!.headSha, HEAD); assert.equal(output.review!.verdict, "block");
  await execution.admission.finish(task, { ...output, status: "completed" } as any);
  const after = await council().load();
  assert.equal(calls, 1);
  assert.equal(after.company.careers[role].cyclesTotal, before + 1);
  assert.equal(after.company.careers[role].lastEvidenceId, task.id);
  const lifecycle = after.officeExecution!.roles.roles[role];
  assert.equal(lifecycle.leases.filter(l => l.executionId === task.id && l.status === "completed").length, 1);
  assert.equal(lifecycle.history.filter(h => h.event === "verified_execution").length, 1);
  // No promotion rule is invented: the active policy and assessments are untouched.
  assert.equal(lifecycle.assessments.length, 0);
  // A replayed completion is not accepted and never scores twice.
  await assert.rejects(createOfficeExecution(council(), env, () => NOW).admission.finish(task, { ...output, status: "completed" } as any));
  assert.equal((await council().load()).company.careers[role].cyclesTotal, before + 1);
});

test("factory dashboard shows the linked office verdict read-only and degrades when the office journal is unavailable", async t => {
  const express = (await import("express")).default;
  const { registerSoftwareFactoryRoutes } = await import("../server/software-factory-routes");
  const { createSignedLocalAuthCookieValue } = await import("../server/user-context");
  const saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "test", DEFAULT_USER_ID: OWNER, SESSION_SECRET: "factory-fixture-secret", ALLOW_DEV_USER_FALLBACK: "true" });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  const f = factoryChain(), project = { id: "asistente", repo: "example/repo", testCommand: "test", buildCommand: "build", journeys: ["regression"] };
  const pool = new Pool(), store = officeStore(pool), runtime = createOfficeCloudRuntime(store);
  await createFactoryOfficeReviewSweep({ owner: OWNER, maxPerDay: 5, readProposals: f.readProposals, enqueue: enqueueVia(store) })();
  const claimed = (await store.claim("office-cloud-test", { ownerId: OWNER, reviewOnly: true }))!;
  await store.complete(claimed.id, "office-cloud-test", claimed.fence!, { status: "completed", text: "Clean", sessionId: "s1", review: { prUrl: PR_URL, headSha: HEAD, diffSha256: "e".repeat(64), verdict: "pass", summary: "Clean", findings: [] } });
  let failing = false;
  const app = express(); app.use(express.json());
  registerSoftwareFactoryRoutes(app, {
    now: () => new Date(Date.parse(AT) + 86_400_000),
    readOfficeReviews: async owner => { if (failing) throw Error("db down"); return runtime.list(owner); },
    store: { status: async () => ({ configured: true, paused: false, month: "2026-11", limitCents: 10000, fixedCents: 0, spentCents: 0, reservedCents: 0, workers: [] }), list: async () => [f.jobs[3]], projects: async () => [project],
      getCompletedJob: async (_key: string, id: string) => f.jobs.find(j => j.id === id) } as any,
  });
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const read = async () => (await (await fetch(`${base}/api/software-factory`, { headers: { cookie: `blackops.uid=${createSignedLocalAuthCookieValue(OWNER)}` } })).json());
  const view = await read();
  assert.equal(view.reviewedProposals.length, 1);
  assert.equal(view.reviewedProposals[0].officeReview.status, "pass");
  assert.equal(view.reviewedProposals[0].officeReview.findingsCount, 0);
  assert.equal(view.reviewedProposals[0].published, false);
  failing = true;
  assert.equal((await read()).reviewedProposals[0].officeReview.status, "unavailable");
});
