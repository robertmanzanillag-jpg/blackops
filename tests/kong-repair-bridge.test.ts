import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createKongRepairBridge, verifyRepairEnvelope, canonicalRepairJson, repairKey, KONG_REPAIR_REPOSITORY, type RepairEnvelope, type RepairProof, type WorkerEnvelope } from "../server/kong-repair-bridge";
const NOW = Date.parse("2026-11-18T00:00:00Z"), secret = "synthetic-only-signing-secret-123456789";
function envelope(): RepairEnvelope {
  const payload = { company: "kong" as const, repository: KONG_REPAIR_REPOSITORY, sourceTaskId: randomUUID(), errorId: randomUUID(),
    fingerprint: "a".repeat(64), generation: 1, evidence: { route: "/api/ready", httpMethod: "GET" as const, httpStatus: 503, errorClass: "TypeError", message: "TypeError: Cannot read length", locations: [{ filePath: "server/readiness.ts", lineNumber: 42 }] }, regressionScenario: "api_ready_contract" as const, summary: "Regression in a saved KONG report", reportedAt: new Date(NOW).toISOString() };
  return { schemaVersion: "1", eventType: "software_repair_request", eventId: randomUUID(), correlationId: randomUUID(), taskId: payload.sourceTaskId,
    issuedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 300000).toISOString(), nonce: randomUUID(), idempotencyKey: repairKey(payload), payload };
}
function signed(value: RepairEnvelope) { const raw = Buffer.from(canonicalRepairJson(value)); return { raw, signature: `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` }; }
function fixture() {
  const rows = new Map<string, string>(); let time = NOW; let tail = Promise.resolve(), handoffs = 0, lost = false;
  let proof: RepairProof = { repository: KONG_REPAIR_REPOSITORY, headSha: "a".repeat(40), mergeSha: "b".repeat(40), merged: true,
    maker: "maker", checker: "checker", checkerHeadSha: "a".repeat(40), checksPassed: true, appQaPassed: true,
    deployedSha: "b".repeat(40), deploymentReady: true, regressionPassed: true, observedAt: NOW };
  const store = { read: async (key: string) => rows.get(key) || null, transact: async (key: string, change: (raw: string | null) => Promise<string>) => {
    const job = tail.then(async () => { const next = await change(rows.get(key) || null); rows.set(key, next); return next; });
    tail = job.then(() => {}, () => {}); return job;
  } };
  const create = (extra: Partial<Parameters<typeof createKongRepairBridge>[0]> = {}) => createKongRepairBridge({ owner: "fixture-owner", store, now: () => time,
    createHandoff: async () => { handoffs++; if (lost) throw Error("lost acknowledgment"); return { repository: KONG_REPAIR_REPOSITORY, issueUrl: `https://github.com/${KONG_REPAIR_REPOSITORY}/issues/123` }; },
    readProof: async () => proof, readPaidState: async () => "blocked_unknown_credit", ...extra });
  return { create, rows, advance: (ms: number) => { time += ms; }, calls: () => handoffs, lose: () => { lost = true; }, proof: (patch: Partial<RepairProof>) => { proof = { ...proof, ...patch }; } };
}

test("signed canonical scoped requests reject wrong signature/company/repo/expiry and mutation", () => {
  const value = envelope(), good = signed(value);
  assert.deepEqual(verifyRepairEnvelope(good.raw, good.signature, secret, NOW), value);
  assert.throws(() => verifyRepairEnvelope(good.raw, good.signature, "wrong-secret-at-least-32-characters", NOW), /SIGNATURE/);
  assert.throws(() => verifyRepairEnvelope(good.raw, good.signature, secret, NOW + 300001), /ENVELOPE/);
  for (const patch of [{ company: "main" }, { repository: "robertmanzanillag-jpg/blackops" }]) {
    const bad = { ...value, payload: { ...value.payload, ...patch } } as RepairEnvelope, send = signed(bad);
    assert.throws(() => verifyRepairEnvelope(send.raw, send.signature, secret, NOW), /ENVELOPE/);
  }
  assert.throws(() => verifyRepairEnvelope(Buffer.from(good.raw.toString().replace("Regression", "Changed")), good.signature, secret, NOW), /SIGNATURE/);
});

test("restart and concurrent signed delivery deduplicate in durable storage, not process memory", async () => {
  const f = fixture(), a = f.create(), b = f.create(), request = envelope();
  await Promise.all([a.receive(request), b.receive(request)]);
  assert.equal((await a.view()).entries.length, 1);
  await Promise.all([a.dispatch(request.idempotencyKey), b.dispatch(request.idempotencyKey)]);
  assert.equal(f.calls(), 1);
  assert.equal((await f.create().view()).entries[0].status, "handoff_created");
  assert.equal((await a.view()).paidExecution, "blocked_unknown_credit");
  assert.equal((await a.view()).makerConsumer, "pending_no_maker");
});

test("nonce/event replay and changed payload cannot create or alter a repair", async () => {
  const f = fixture(), bridge = f.create(), first = envelope(); await bridge.receive(first);
  const second = envelope(); second.nonce = first.nonce;
  await assert.rejects(bridge.receive(second), /REPLAY/);
  await assert.rejects(bridge.receive({ ...first, payload: { ...first.payload, summary: "Changed" } }), /CONFLICT/);
  await bridge.receive({ ...first, eventId: randomUUID(), nonce: randomUUID() });
  assert.equal((await bridge.view()).entries.length, 1);
});

test("unknown GitHub acknowledgment never recreates an issue after restart or delivery retry", async () => {
  const f = fixture(), bridge = f.create(), request = envelope(); await bridge.receive(request); f.lose();
  await assert.rejects(bridge.dispatch(request.idempotencyKey));
  await f.create().receive(request); await f.create().dispatch(request.idempotencyKey);
  assert.equal(f.calls(), 1); assert.equal((await bridge.view()).entries[0].status, "dispatch_unknown");
});

test("a passing PR cannot close a repair before independent exact-head QA and real deploy/regression evidence", async () => {
  const f = fixture(), bridge = f.create(), request = envelope(); await bridge.receive(request); await bridge.dispatch(request.idempotencyKey);
  f.proof({ checker: "maker" }); assert.equal((await bridge.check(request.idempotencyKey, 99)).status, "awaiting_independent_review");
  f.proof({ checker: "checker", checkerHeadSha: "c".repeat(40) }); assert.equal((await bridge.check(request.idempotencyKey, 99)).status, "awaiting_independent_review");
  f.proof({ checkerHeadSha: "a".repeat(40), deployedSha: "c".repeat(40) }); assert.equal((await bridge.check(request.idempotencyKey, 99)).status, "awaiting_deployment");
  f.proof({ deployedSha: "b".repeat(40), regressionPassed: false }); assert.equal((await bridge.check(request.idempotencyKey, 99)).status, "awaiting_deployment");
  f.proof({ regressionPassed: true }); const verified = await bridge.check(request.idempotencyKey, 99);
  assert.equal(verified.status, "verified"); assert.equal(verified.verifiedDeploymentSha, "b".repeat(40));
  f.proof({ headSha: "d".repeat(40) }); const revoked = await bridge.check(request.idempotencyKey, 99);
  assert.equal(revoked.status, "awaiting_independent_review"); assert.equal(revoked.verifiedAt, undefined);
});

function rpc(eventType: WorkerEnvelope["eventType"], payload: WorkerEnvelope["payload"]): WorkerEnvelope {
  return { schemaVersion: "1", eventType, eventId: randomUUID(), correlationId: randomUUID(), taskId: payload.workerId,
    issuedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 300000).toISOString(), nonce: randomUUID(), idempotencyKey: randomUUID(), payload };
}
test("maker claims are durable, fenced and one at a time; an issue is not running code", async () => {
  const f = fixture(), bridge = f.create(), request = envelope(); await bridge.receive(request); await bridge.dispatch(request.idempotencyKey);
  const claimRequest = rpc("software_repair_worker_claim", { workerId: "local-codex" });
  const claim = await bridge.worker(claimRequest); assert.equal(claim!.status, "maker_claimed");
  const replay = await f.create().worker(claimRequest); assert.equal(replay!.maker!.fence, claim!.maker!.fence);
  assert.equal(await bridge.worker(rpc("software_repair_worker_claim", { workerId: "local-codex" })), null);
  await assert.rejects(bridge.worker(rpc("software_repair_worker_started", { workerId: "wrong-worker", key: claim!.key, fence: claim!.maker!.fence })), /FENCE/);
  const started = rpc("software_repair_worker_started", { workerId: "local-codex", key: claim!.key, fence: claim!.maker!.fence });
  assert.equal((await bridge.worker(started))!.status, "maker_running");
  const completed = rpc("software_repair_worker_complete", { workerId: "local-codex", key: claim!.key, fence: claim!.maker!.fence, prNumber: 99, headSha: "a".repeat(40) });
  assert.equal((await bridge.worker(completed))!.status, "awaiting_checker");
  assert.equal((await f.create().worker(completed))!.status, "awaiting_checker");
  assert.equal(f.calls(), 1);
});
test("expired maker leases retain unknown work and cannot be claimed or acknowledged again", async () => {
  const f = fixture(), bridge = f.create(), request = envelope(); await bridge.receive(request); await bridge.dispatch(request.idempotencyKey);
  const rpcClaim = rpc("software_repair_worker_claim", { workerId: "local-codex" });
  const entry = await bridge.worker(rpcClaim); f.advance(3600001);
  await assert.rejects(f.create().worker(rpcClaim), /EXPIRED/);
  assert.equal(await bridge.worker(rpc("software_repair_worker_claim", { workerId: "other-codex" })), null);
  assert.equal((await bridge.view()).entries[0].status, "maker_unknown");
  await assert.rejects(bridge.worker(rpc("software_repair_worker_complete", { workerId: "local-codex", key: entry!.key, fence: entry!.maker!.fence, prNumber: 99, headSha: "a".repeat(40) })), /FENCE/);
});

test("a fresh signed envelope after lost acknowledgment and expiry resolves the same durable repair without replaying dispatch", async () => {
  const f = fixture(), bridge = f.create(), first = envelope(); await bridge.receive(first); await bridge.dispatch(first.idempotencyKey);
  f.advance(600001);
  const old = signed(first); assert.throws(() => verifyRepairEnvelope(old.raw, old.signature, secret, NOW + 600001), /ENVELOPE/);
  const next = { ...first, eventId: randomUUID(), nonce: randomUUID(), issuedAt: new Date(NOW + 600001).toISOString(), expiresAt: new Date(NOW + 900001).toISOString() };
  const message = signed(next); const verified = verifyRepairEnvelope(message.raw, message.signature, secret, NOW + 600001);
  await f.create().receive(verified); await f.create().dispatch(next.idempotencyKey);
  assert.equal((await bridge.view()).entries.length, 1); assert.equal(f.calls(), 1);
});

test("production QA cannot use candidate-modified workflows/scripts or a maker-authored QA comment", async () => {
  const { trustedProductionQaSources, independentAppQa } = await import("../server/kong-repair-proof");
  const workflow = `steps:\n  - uses: actions/checkout@${"a".repeat(40)}\n  - run: node scripts/kong-repair-production-qa.mjs\n`;
  const script = 'import assert from "node:assert/strict"; assert.equal((await fetch("https://kongnightlife.com/api/ready")).status, 200);';
  const baseline = { baselineWorkflow: workflow, deployedWorkflow: workflow, baselineScript: script, deployedScript: script };
  assert.equal(trustedProductionQaSources(baseline), true);
  assert.equal(trustedProductionQaSources({ ...baseline, deployedWorkflow: workflow + "# candidate edit" }), false);
  assert.equal(trustedProductionQaSources({ ...baseline, deployedScript: "console.log('pass')" }), false);
  assert.equal(trustedProductionQaSources({ ...baseline, baselineWorkflow: "", deployedWorkflow: "" }), false);
  assert.equal(trustedProductionQaSources({ ...baseline, baselineScript: 'import "./candidate-helper.mjs";', deployedScript: 'import "./candidate-helper.mjs";' }), false);
  const comment = { author_association: "OWNER", user: { login: "maker" }, body: `App QA PASS ${"a".repeat(40)}` };
  assert.equal(independentAppQa(comment, "maker", "a".repeat(40), new Set(["maker"])), false);
  assert.equal(independentAppQa({ ...comment, user: { login: "qa" } }, "maker", "a".repeat(40), new Set(["qa"])), true);
  assert.equal(independentAppQa({ ...comment, user: { login: "qa" } }, "maker", "b".repeat(40), new Set(["qa"])), false);
});

test("generic IDs without bounded diagnostic evidence are held before issue creation or model pickup", async () => {
  const f = fixture(), bridge = f.create(), request = envelope(); delete request.payload.evidence;
  await bridge.receive(request); const held = await bridge.dispatch(request.idempotencyKey);
  assert.equal(held.status, "blocked_insufficient_evidence"); assert.equal(f.calls(), 0);
  assert.equal(await bridge.worker(rpc("software_repair_worker_claim", { workerId: "local-codex" })), null);
});

test("trusted parent checker receipts require exact source/head, distinct invocation and the pinned engine bytes", async () => {
  const { parentCheckerReceipt } = await import("../server/kong-repair-proof");
  const { createHash } = await import("node:crypto");
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const request = envelope(), headSha = "a".repeat(40), baseSha = "b".repeat(40), engineCommit = "c".repeat(40), engine = "// reviewed parent engine outside candidate sandbox";
  const receipt = { schemaVersion: 1, kind: "kong_repair_parent_checker", company: "kong", repository: KONG_REPAIR_REPOSITORY,
    repairKey: request.idempotencyKey, sourceDigest: "d".repeat(64), sourceTaskId: request.payload.sourceTaskId, baseSha, headSha, prNumber: 99,
    makerInvocationId: "maker-process", checkerInvocationId: "independent-checker-process", engine: { repository: "robertmanzanillag-jpg/blackops", sourceCommit: engineCommit, path: "script/kong-repair-subscription-worker.mjs", sha256: digest(engine) },
    validation: { command: ["node", "--test", "server/test.ts"], sandboxProfileHash: "e".repeat(64), exitCode: 0, tests: 5, failures: 0, sourceTreeDigest: "f".repeat(64), tapSha256: "a".repeat(64) },
    review: { model: "gpt-6.1-sol", effort: "medium", decision: "approve", findings: [], outputSha256: "b".repeat(64), cliExitCode: 0 }, createdAt: new Date(NOW).toISOString() };
  const input = { key: request.idempotencyKey, sourceDigest: receipt.sourceDigest, sourceTaskId: request.payload.sourceTaskId, baseSha, engineSourceCommit: engineCommit, headSha, prNumber: 99, now: NOW };
  let current = structuredClone(receipt);
  const get = async (_repo: string, path: string) => {
    if (path.startsWith("git/ref/")) return { ref: `refs/heads/codex/repair-checker/${request.idempotencyKey.split(":")[1]}/${headSha}`, object: { sha: "1".repeat(40) } };
    if (path.startsWith("git/commits/")) return { parents: [], tree: { sha: "2".repeat(40) } };
    if (path.startsWith("git/trees/")) return { truncated: false, tree: [{ path: "receipt.json", type: "blob", sha: "3".repeat(40) }] };
    if (path.startsWith("git/blobs/")) return { encoding: "base64", content: Buffer.from(canonicalRepairJson(current)).toString("base64") };
    return { type: "file", encoding: "base64", content: Buffer.from(engine).toString("base64") };
  };
  assert.equal(await parentCheckerReceipt(input, get), true);
  current.review.model = "gpt-6-luna"; current.review.effort = "low"; assert.equal(await parentCheckerReceipt(input, get), true); current = structuredClone(receipt);
  for (const change of [(r: typeof receipt) => { r.checkerInvocationId = r.makerInvocationId; }, (r: typeof receipt) => { r.headSha = "9".repeat(40); },
    (r: typeof receipt) => { r.review.model = "gpt-6-luna"; }, (r: typeof receipt) => { r.review.effort = "low"; },
    (r: typeof receipt) => { r.engine.sha256 = "0".repeat(64); }, (r: typeof receipt) => { r.validation.tests = 0; }, (r: typeof receipt) => { r.review.decision = "changes_requested"; }]) {
    current = structuredClone(receipt); change(current); assert.equal(await parentCheckerReceipt(input, get), false);
  }
});

test("known operational outages and ordinary startup 503 stay unresolved without consuming a model handoff", async () => {
  for (const patch of [{ errorCode: "ECONNRESET" }, { errorCode: "42P01" }, { errorCode: "42703" }, { errorCode: "55P03" }, { errorClass: "Error", errorCode: undefined }]) {
    const f = fixture(), bridge = f.create(), request = envelope(); Object.assign(request.payload.evidence!, patch); if (request.payload.evidence!.errorCode === undefined) delete request.payload.evidence!.errorCode;
    const send = signed(request); assert.deepEqual(verifyRepairEnvelope(send.raw, send.signature, secret, NOW), request);
    await bridge.receive(request); assert.equal((await bridge.dispatch(request.idempotencyKey)).status, "blocked_operational_condition"); assert.equal(f.calls(), 0);
    assert.equal((await bridge.view()).entries[0].status, "blocked_operational_condition");
  }
});

test("SQLSTATE format compatibility rejects malformed codes without expanding operational classification", async () => {
  for (const errorCode of ["42p01", "42P0", "42P010", "4P001", "42_P1", "42703\n", "42P01 extra", "_ERR", "A"]) {
    const request = envelope(); request.payload.evidence!.errorCode = errorCode; const send = signed(request);
    assert.throws(() => verifyRepairEnvelope(send.raw, send.signature, secret, NOW), /INVALID_ENVELOPE/);
  }
  const f = fixture(), bridge = f.create(), request = envelope(); request.payload.evidence!.errorCode = "22003";
  const send = signed(request); verifyRepairEnvelope(send.raw, send.signature, secret, NOW);
  await bridge.receive(request); assert.equal((await bridge.dispatch(request.idempotencyKey)).status, "handoff_created");
  assert.equal(f.calls(), 1, "another valid SQLSTATE is not silently added to the operational block set");
});

test("unclaimed refresh is fenced against maker races and reconciles a lost fence acknowledgment", async () => {
  const { fenceUnclaimedRepair } = await import("../server/kong-repair-refresh");
  const request = envelope(), baseSha = "a".repeat(40), engineSourceCommit = "b".repeat(40), next = { baseSha: "c".repeat(40), engineSourceCommit };
  const entry = { key: request.idempotencyKey, payload: request.payload, payloadHash: "d".repeat(64), eventId: request.eventId, nonce: request.nonce,
    status: "handoff_created" as const, receivedAt: new Date(NOW).toISOString(), issueUrl: `https://github.com/${KONG_REPAIR_REPOSITORY}/issues/1`, approvedBaseSha: baseSha, engineSourceCommit, sourceDigest: "e".repeat(64) };
  for (const winner of ["maker", "fence", "lost_ack"] as const) {
    let ref: { sha: string } | null = null, content = "", creates = 0;
    const git = { readRef: async () => ref, readFence: async () => content,
      createFence: async (value: string) => { content = value; return "f".repeat(40); },
      createRef: async (_ref: string, sha: string) => { creates++; ref = { sha: winner === "maker" ? baseSha : sha }; if (winner !== "fence") throw Error("atomic ref race or lost acknowledgment"); } };
    const result = await fenceUnclaimedRepair(entry, next, git);
    assert.equal(result.state, winner === "maker" ? "maker_claimed" : "superseded_unclaimed");
    assert.equal(creates, 1);
    if (winner === "lost_ack") { assert.equal((await fenceUnclaimedRepair(entry, next, git)).state, "superseded_unclaimed"); assert.equal(creates, 1); }
    let touched = false;
    const protectedGit = { ...git, readRef: async () => { touched = true; return ref; } };
    assert.equal((await fenceUnclaimedRepair({ ...entry, status: "maker_unknown" }, next, protectedGit)).state, "held");
    assert.equal(touched, false);
  }
});

test("a newer passing status supersedes its failed attempt without hiding another failing context", async () => {
  const { effectiveCommitStatusesPass } = await import("../server/kong-repair-proof");
  assert.equal(effectiveCommitStatusesPass([{ context: "ci", state: "success" }, { context: "ci", state: "failure" }]), true);
  assert.equal(effectiveCommitStatusesPass([{ context: "ci", state: "failure" }, { context: "ci", state: "success" }]), false);
  assert.equal(effectiveCommitStatusesPass([{ context: "ci", state: "success" }, { context: "security", state: "pending" }]), false);
});

test("cached worker health loses its connection at the freshness deadline without another network read", async () => {
  const { freshMakerHealth } = await import("../server/kong-repair-proof");
  const value = { state: "idle", workerConnected: true, lastSuccessfulPollAt: new Date(NOW).toISOString(), sourceCount: 0 };
  assert.equal(freshMakerHealth(value, NOW + 2699000).workerConnected, true);
  assert.equal(freshMakerHealth(value, NOW + 2701000).workerConnected, false);
  assert.equal(freshMakerHealth(value, NOW + 2701000).state, "stale");
});

test("a failed read-only GitHub preflight stays retryable before any issue write reservation", async () => {
  const f = fixture(), base = f.create(), request = envelope(); await base.receive(request);
  let ready = false, posts = 0;
  const bridge = createKongRepairBridge({ owner: "fixture-owner", store: { read: async key => f.rows.get(key) || null, transact: async (key, change) => { const next = await change(f.rows.get(key) || null); f.rows.set(key, next); return next; } }, now: () => NOW,
    prepareHandoff: async () => { if (!ready) throw Error("private connector 403"); return async () => { posts++; return { repository: KONG_REPAIR_REPOSITORY, issueUrl: `https://github.com/${KONG_REPAIR_REPOSITORY}/issues/77` }; }; },
    createHandoff: async () => { throw Error("preflighted path expected"); }, readProof: async () => { throw Error("unused"); }, readPaidState: async () => "unavailable" });
  const held = await bridge.dispatch(request.idempotencyKey); assert.equal(held.status, "blocked_no_github"); assert.equal(held.handoffStartedAt, undefined); assert.equal(posts, 0);
  ready = true; assert.equal((await bridge.dispatch(request.idempotencyKey)).status, "handoff_created"); assert.equal(posts, 1);
});


test("verified issue closure quarantines a lost comment acknowledgment and reconciles without duplicate publication", async () => {
  const f = fixture(), request = envelope(); let prepares = 0, posts = 0, recorded = false, issueClosed = false, readsFail = false;
  const bridge = f.create({ prepareCloseHandoff: async () => {
    prepares++; if (readsFail) throw Error("read-only unavailable");
    return async allowCreate => {
      if (!recorded && allowCreate) { posts++; recorded = true; throw Error("comment acknowledgment lost"); }
      if (!recorded) return { closed: false, beforeState: "open" };
      const beforeState = issueClosed ? "closed" as const : "open" as const; issueClosed = true;
      return { closed: true, beforeState, proofCommentUrl: `https://github.com/${KONG_REPAIR_REPOSITORY}/issues/123#issuecomment-1` };
    };
  } });
  await bridge.receive(request); await bridge.dispatch(request.idempotencyKey);
  await bridge.reconcileClosure(request.idempotencyKey); assert.equal(prepares, 0);
  f.proof({ regressionRunId: 100 }); readsFail = true;
  assert.equal((await bridge.check(request.idempotencyKey, 99)).githubClosure?.state, "pending"); assert.equal(posts, 0);
  readsFail = false;
  const first = await bridge.reconcileClosure(request.idempotencyKey); assert.equal(first?.status, "verified"); assert.equal(first?.githubClosure?.state, "unknown"); assert.equal(posts, 1);
  const recovered = await bridge.reconcileClosure(request.idempotencyKey); assert.equal(recovered?.githubClosure?.state, "closed"); assert.equal(posts, 1);
  const verifiedAt = recovered?.verifiedAt; f.advance(1000); f.proof({ observedAt: NOW + 1000 });
  const rechecked = await bridge.check(request.idempotencyKey, 99); assert.equal(rechecked.githubClosure?.state, "closed"); assert.equal(rechecked.verifiedAt, verifiedAt); assert.equal(posts, 1);
});
