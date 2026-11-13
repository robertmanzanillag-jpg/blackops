import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, rename, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOfficeRuntime, OfficeRuntimeError, officeTaskSchema, type OfficeRun } from "../server/office-runtime";
import { OfficeClaudeError } from "../server/office-claude";

const prUrl = "https://github.com/owner/repo/pull/7";
const diff = "diff --git a/a.ts b/a.ts\n+safe change";
const pr = { prUrl, headSha: "a".repeat(40), diff, diffSha256: createHash("sha256").update(diff).digest("hex") };
const answer = { text: "Real response", sessionId: "actual-session", completedAt: new Date().toISOString() };
const request = () => ({ kind: "claude_chat" as const, key: randomUUID(), message: "Hello" });
const fixture = async (t: { after: (fn: () => Promise<void>) => void }) => {
  const root = await mkdtemp(path.join(tmpdir(), "office-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, rootDir: path.join(root, "journal") };
};
const untilTerminal = async (runtime: ReturnType<typeof createOfficeRuntime>, userId = "owner") => {
  for (let n = 0; n < 200; n++) {
    const runs = await runtime.list(userId);
    if (runs.length && runs.every(run => !["accepted", "running"].includes(run.status))) return runs[0];
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("task did not finish");
};

test("accepted task is durable before dispatch; running and completed reflect actual work", async t => {
  const { rootDir } = await fixture(t);
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const providerPromise = new Promise<void>(resolve => { release = resolve; });
  const runtime = createOfficeRuntime({ rootDir, claude: async () => {
    const files = await readdir(rootDir);
    const disk = JSON.parse(await readFile(path.join(rootDir, files.find(file => file.endsWith(".json"))!), "utf8"));
    assert.equal(disk[0].status, "running");
    entered(); await providerPromise; return answer;
  } });
  const accepted = await runtime.submit("owner", request());
  assert.equal(accepted.status, "accepted");
  await enteredPromise;
  assert.equal((await runtime.list("owner"))[0].status, "running");
  release();
  const completed = await untilTerminal(runtime);
  assert.equal(completed.status, "completed");
  assert.equal(completed.sessionId, answer.sessionId);
  assert.equal(completed.text, answer.text);
});

test("concurrent duplicate admissions launch once; reused mismatched key conflicts", async t => {
  const { rootDir } = await fixture(t);
  let calls = 0;
  const runtime = createOfficeRuntime({ rootDir, claude: async () => { calls++; return answer; } });
  const task = request();
  const results = await Promise.all(Array.from({ length: 20 }, () => runtime.submit("owner", task)));
  assert.equal(new Set(results.map(run => run.id)).size, 1);
  await untilTerminal(runtime);
  assert.equal(calls, 1);
  await assert.rejects(runtime.submit("owner", { ...task, message: "different" }), (error: unknown) => error instanceof OfficeRuntimeError && error.code === "IDEMPOTENCY_CONFLICT");
});

test("owners have isolated histories and idempotency namespaces; provider queue has one owner", async t => {
  const { rootDir } = await fixture(t);
  let active = 0;
  let peak = 0;
  const runtime = createOfficeRuntime({ rootDir, claude: async () => {
    active++; peak = Math.max(active, peak); await new Promise(resolve => setTimeout(resolve, 5)); active--; return answer;
  } });
  const task = request();
  const [a, b] = await Promise.all([runtime.submit("alice/../../bob", task), runtime.submit("bob", task)]);
  assert.notEqual(a.id, b.id);
  assert.equal((await runtime.list("alice/../../bob")).length, 1);
  assert.equal((await runtime.list("other")).length, 0);
  await untilTerminal(runtime, "alice/../../bob"); await untilTerminal(runtime, "bob");
  assert.equal(peak, 1);
  assert.ok((await readdir(rootDir)).every(file => /^[a-f0-9]{64}\.json$/.test(file)));
});

test("startup marks interrupted accepted/running tasks without retrying", async t => {
  const { rootDir } = await fixture(t);
  const first = createOfficeRuntime({ rootDir, claude: async () => answer });
  await first.list("owner");
  const ownerHash = createHash("sha256").update("owner").digest("hex");
  const records: OfficeRun[] = ["accepted", "running"].map(status => ({ ...request(), id: randomUUID(), status: status as "accepted" | "running", createdAt: new Date().toISOString() }));
  await writeFile(path.join(rootDir, `${ownerHash}.json`), JSON.stringify(records));
  let calls = 0;
  const restarted = createOfficeRuntime({ rootDir, claude: async () => { calls++; return answer; } });
  const recovered = await restarted.list("owner");
  assert.equal(recovered.length, 2);
  assert.ok(recovered.every(run => run.status === "failed" && run.error?.code === "INTERRUPTED"));
  assert.equal(calls, 0);
  assert.equal((await restarted.submit("owner", { kind: records[0].kind, message: records[0].message, key: records[0].key })).status, "failed");
});

test("provider errors are blocked safely, unknown errors never become completion", async t => {
  const { rootDir } = await fixture(t);
  const runtime = createOfficeRuntime({ rootDir, claude: async () => { throw new OfficeClaudeError("blocked", "Subscription login required"); } });
  await runtime.submit("owner", request());
  const blocked = await untilTerminal(runtime);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.error?.code, "blocked");
  assert.equal(blocked.sessionId, undefined);
  const other = createOfficeRuntime({ rootDir: path.join(rootDir, "other"), claude: async () => { throw new Error("secret-provider-stderr"); } });
  await other.submit("owner", request());
  const failed = await untilTerminal(other);
  assert.equal(failed.status, "failed");
  assert.ok(!JSON.stringify(failed).includes("secret-provider-stderr"));
});

test("invalid provider success cannot create completed chat", async t => {
  const { rootDir } = await fixture(t);
  const runtime = createOfficeRuntime({ rootDir, claude: async () => ({ ...answer, sessionId: "" }) });
  await runtime.submit("owner", request());
  assert.equal((await untilTerminal(runtime)).status, "failed");
});

test("exact PR review is verified twice, journaled, and available only to its owner/head", async t => {
  const { rootDir } = await fixture(t);
  let loads = 0;
  const runtime = createOfficeRuntime({ rootDir, loadPr: async url => { assert.equal(url, prUrl); loads++; return pr; }, claude: async prompt => {
    assert.ok(prompt.includes(pr.headSha)); assert.ok(prompt.includes(pr.diff));
    return { ...answer, text: '{"verdict":"pass","summary":"No blockers found","findings":[]}' };
  } });
  await runtime.submit("owner", { kind: "claude_review", key: randomUUID(), prUrl });
  const done = await untilTerminal(runtime);
  assert.equal(done.status, "completed"); assert.equal(loads, 2);
  assert.equal(done.review?.diffSha256, pr.diffSha256);
  assert.equal((await runtime.getReview("owner", prUrl, pr.headSha, pr.diffSha256))?.id, done.id);
  assert.equal(await runtime.getReview("other", prUrl, pr.headSha, pr.diffSha256), undefined);
  assert.equal(await runtime.getReview("owner", prUrl, "b".repeat(40), pr.diffSha256), undefined);
});

test("changed PR head or diff invalidates a completed review attempt", async t => {
  const { rootDir } = await fixture(t);
  let loads = 0;
  const runtime = createOfficeRuntime({ rootDir, loadPr: async () => (++loads === 1 ? pr : { ...pr, headSha: "b".repeat(40) }), claude: async () => ({ ...answer, text: '{"verdict":"pass","summary":"Clear","findings":[]}' }) });
  await runtime.submit("owner", { kind: "claude_review", key: randomUUID(), prUrl });
  const done = await untilTerminal(runtime);
  assert.equal(done.status, "failed"); assert.equal(done.error?.code, "PR_CHANGED");
  assert.equal(await runtime.getReview("owner", prUrl, pr.headSha, pr.diffSha256), undefined);
});

test("review verdict must be strict JSON with no unsupported evidence fields", async t => {
  const { rootDir } = await fixture(t);
  const runtime = createOfficeRuntime({ rootDir, loadPr: async () => pr, claude: async () => ({ ...answer, text: '{"verdict":"pass","summary":"Clear","findings":[],"testsPassed":true}' }) });
  await runtime.submit("owner", { kind: "claude_review", key: randomUUID(), prUrl });
  const done = await untilTerminal(runtime);
  assert.equal(done.status, "failed"); assert.equal(done.error?.code, "INVALID_REVIEW");
});

test("blocking review completes as evidence but never approves release", async t => {
  const { rootDir } = await fixture(t);
  const runtime = createOfficeRuntime({ rootDir, loadPr: async () => pr, claude: async () => ({ ...answer, text: '{"verdict":"block","summary":"Fix authorization","findings":["Missing ownership check"]}' }) });
  await runtime.submit("owner", { kind: "claude_review", key: randomUUID(), prUrl });
  assert.equal((await untilTerminal(runtime)).review?.verdict, "block");
  assert.equal(await runtime.getReview("owner", prUrl, pr.headSha, pr.diffSha256), undefined);
});

test("base/diff changes invalidate review even when the PR head is unchanged", async t => {
  const { rootDir } = await fixture(t);
  const runtime = createOfficeRuntime({ rootDir, loadPr: async () => pr, claude: async () => ({ ...answer, text: '{"verdict":"pass","summary":"Clear","findings":[]}' }) });
  await runtime.submit("owner", { kind: "claude_review", key: randomUUID(), prUrl });
  await untilTerminal(runtime);
  assert.equal(await runtime.getReview("owner", prUrl, pr.headSha, "b".repeat(64)), undefined);
  assert.ok(await runtime.getReview("owner", prUrl, pr.headSha, pr.diffSha256));
});

test("newer completed blocking review revokes older pass on the identical target", async t => {
  const { rootDir } = await fixture(t);
  let verdict: "pass" | "block" = "pass";
  const runtime = createOfficeRuntime({ rootDir, loadPr: async () => pr, claude: async () => ({ ...answer, text: JSON.stringify({ verdict, summary: "Reviewed", findings: verdict === "pass" ? [] : ["New blocker"] }) }) });
  await runtime.submit("owner", { kind: "claude_review", key: randomUUID(), prUrl });
  await untilTerminal(runtime);
  assert.ok(await runtime.getReview("owner", prUrl, pr.headSha, pr.diffSha256));
  verdict = "block";
  await runtime.submit("owner", { kind: "claude_review", key: randomUUID(), prUrl });
  await untilTerminal(runtime);
  assert.equal(await runtime.getReview("owner", prUrl, pr.headSha, pr.diffSha256), undefined);
});

test("review older than 24 hours cannot approve release", async t => {
  const { rootDir } = await fixture(t);
  const runtime = createOfficeRuntime({ rootDir, loadPr: async () => pr, claude: async () => ({ ...answer, text: '{"verdict":"pass","summary":"Clear","findings":[]}' }) });
  await runtime.submit("owner", { kind: "claude_review", key: randomUUID(), prUrl }); await untilTerminal(runtime);
  const file = path.join(rootDir, (await readdir(rootDir)).find(file => file.endsWith(".json"))!);
  const records = JSON.parse(await readFile(file, "utf8")); records[0].completedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); await writeFile(file, JSON.stringify(records));
  assert.equal(await createOfficeRuntime({ rootDir }).getReview("owner", prUrl, pr.headSha, pr.diffSha256), undefined);
});

test("initial persistence failure dispatches no provider", async t => {
  const { root } = await fixture(t);
  const file = path.join(root, "not-a-directory"); await writeFile(file, "blocked");
  let calls = 0;
  const runtime = createOfficeRuntime({ rootDir: file, claude: async () => { calls++; return answer; } });
  await assert.rejects(runtime.submit("owner", request()), (error: unknown) => error instanceof OfficeRuntimeError && error.code === "PERSISTENCE_FAILED");
  assert.equal(calls, 0);
});

test("completion persistence failure never reports a successful run", async t => {
  const { rootDir } = await fixture(t);
  let ended!: () => void;
  const providerDone = new Promise<void>(resolve => { ended = resolve; });
  const runtime = createOfficeRuntime({ rootDir, claude: async () => {
    await rename(rootDir, `${rootDir}-old`); await writeFile(rootDir, "blocked"); ended(); return answer;
  } });
  await runtime.submit("owner", request()); await providerDone;
  await new Promise(resolve => setTimeout(resolve, 20));
  await assert.rejects(runtime.list("owner"), (error: unknown) => error instanceof OfficeRuntimeError && error.code === "PERSISTENCE_FAILED");
});

test("request schema rejects client execution evidence and unsafe PR URLs", () => {
  for (const input of [
    { ...request(), sessionId: "forged" }, { kind: "claude_review", key: randomUUID(), prUrl: "https://evil.example/pull/7" },
    { kind: "claude_review", key: randomUUID(), prUrl: `${prUrl}?token=secret` }, { ...request(), message: "x".repeat(16001) },
  ]) assert.equal(officeTaskSchema.safeParse(input).success, false);
});

test("cloud execution reuses trusted execution without creating a local journal", async t => {
  const { rootDir } = await fixture(t);
  const runtime = createOfficeRuntime({ rootDir, claude: async () => answer });
  const result = await runtime.executeForCloud({ ...request(), id: randomUUID(), status: "running", createdAt: new Date().toISOString() });
  assert.equal(result.text, answer.text);
  assert.equal(result.sessionId, answer.sessionId);
  await assert.rejects(access(rootDir));
});

test("KONG audit records verified evidence without pretending to start its agents", async t => {
  const { rootDir } = await fixture(t);
  const generatedAt = new Date().toISOString();
  const runtime = createOfficeRuntime({ rootDir, kong: async () => ({ text: "Read-only audit", completedAt: generatedAt, evidence: { generatedAt, agents: [] } }) });
  await runtime.submit("owner", { kind: "kong_audit", key: randomUUID() });
  const done = await untilTerminal(runtime);
  assert.equal(done.status, "completed");
  assert.equal(done.evidence?.generatedAt, generatedAt);
  assert.equal(done.sessionId, undefined);
});

test("unverified PR diff never reaches Claude", async t => {
  const { rootDir } = await fixture(t);
  let calls = 0;
  const runtime = createOfficeRuntime({ rootDir, loadPr: async () => ({ ...pr, diffSha256: "0".repeat(64) }), claude: async () => { calls++; return answer; } });
  await runtime.submit("owner", { kind: "claude_review", key: randomUUID(), prUrl });
  assert.equal((await untilTerminal(runtime)).error?.code, "INVALID_PR_EVIDENCE");
  assert.equal(calls, 0);
});

test("journal retention stays bounded while accepted work is never evicted", async t => {
  const { rootDir } = await fixture(t);
  const runtime = createOfficeRuntime({ rootDir, claude: async () => answer });
  await runtime.list("owner");
  const ownerHash = createHash("sha256").update("owner").digest("hex");
  const records = Array.from({ length: 200 }, () => ({ ...request(), id: randomUUID(), status: "completed", createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), text: "Earlier result", sessionId: "old-session" }));
  await writeFile(path.join(rootDir, `${ownerHash}.json`), JSON.stringify(records));
  const restarted = createOfficeRuntime({ rootDir, claude: async () => answer });
  await restarted.submit("owner", request());
  await untilTerminal(restarted);
  const retained = await restarted.list("owner");
  assert.equal(retained.length, 200);
  assert.ok(!retained.some(run => run.id === records[0].id));
});
