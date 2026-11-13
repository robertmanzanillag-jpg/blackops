import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createOfficeCloudRuntime, createOfficeCloudWorker } from "../server/office-cloud-runtime";
import { OfficeClaudeError } from "../server/office-claude";
import { OfficeKongError } from "../server/office-kong";
import type { officeCloudStore, OfficeCloudRun, OfficeCloudCompletion } from "../server/office-cloud-store";

const now = () => new Date().toISOString();

test("slow lifecycle admission cannot invoke a provider after cloud lease expires", async () => {
  let clock = Date.now(); let calls = 0;
  const f = fixture([makeRun({ kind: "claude_review" })]);
  const worker = createOfficeCloudWorker({ store: f.store, now: () => new Date(clock), execute: async () => { calls++; return {}; },
    admission: { ready: async () => true, begin: async () => { clock += 300000; return true; }, finish: async () => {} },
  });
  await assert.rejects(worker.tick(), /ADMISSION_OUTLIVED_LEASE/);
  assert.equal(calls, 0);
  await worker.tick(); assert.equal(calls, 0);
});

test("vacancy preserves queued task; a rejected unstarted reservation releases only its claim", async () => {
  const f = fixture([makeRun({ kind: "claude_review" })]); let ready = false; let calls = 0;
  const worker = createOfficeCloudWorker({ store: f.store, execute: async () => { calls++; return {}; },
    admission: { ready: async () => ready, begin: async () => false, finish: async () => {} },
  });
  await worker.tick(); assert.equal(f.rows[0].status, "pending");
  assert.equal(f.calls.some(c => c.method === "claim"), false);
  ready = true; await worker.tick(); assert.equal(f.rows[0].status, "pending"); assert.equal(calls, 0);
});

test("review-only advertised capability rejects unsupported chat before persistence", async () => {
  const f = fixture();
  f.store.getHeartbeat = async () => ({ workerId: "reviews", lastSeenAt: now(), capabilities: { reviewOnly: true, claude: { status: "ready", reason: "Reviews", checkedAt: now() }, kong: { status: "blocked", reason: "Unsupported", checkedAt: now() } } });
  await assert.rejects(createOfficeCloudRuntime(f.store).submit("owner", { kind: "claude_chat", message: "Chat", key: randomUUID() }), /solo admite/);
  assert.equal(f.rows.length, 0);
});
const makeRun = (patch: Partial<OfficeCloudRun> = {}): OfficeCloudRun => ({ id: randomUUID(), key: randomUUID(), kind: "claude_chat", message: "Question", status: "pending", createdAt: now(), ...patch });
function fixture(initial: OfficeCloudRun[] = []) {
  const rows = initial;
  const calls: { method: string; args: unknown[] }[] = [];
  const completions: OfficeCloudCompletion[] = [];
  let loseFence = false;
  const store: typeof officeCloudStore = {
    submit: async (userId, input) => {
      calls.push({ method: "submit", args: [userId, input] });
      const run = makeRun({ ...input }); rows.unshift(run); return run;
    },
    list: async userId => { calls.push({ method: "list", args: [userId] }); return [...rows]; },
    releaseUnstarted: async (id, workerId, fence) => {
      const run = rows.find(r => r.id === id && r.workerId === workerId && r.fence === fence && r.status === "running");
      if (!run) return false; run.status = "pending"; return true;
    },
    claim: async workerId => {
      calls.push({ method: "claim", args: [workerId] });
      const pending = rows.find(run => run.status === "pending");
      if (!pending) return undefined;
      Object.assign(pending, { status: "running", workerId, fence: randomUUID(), startedAt: now(), leaseExpiresAt: new Date(Date.now() + 180000).toISOString() });
      return { ...pending };
    },
    complete: async (id, workerId, fence, result) => {
      calls.push({ method: "complete", args: [id, workerId, fence, result] }); completions.push(result);
      if (loseFence) return undefined;
      const run = rows.find(row => row.id === id && row.workerId === workerId && row.fence === fence && row.status === "running");
      if (!run) return undefined;
      Object.assign(run, { status: result.status, result, completedAt: now() });
      return { ...run };
    },
    markExpiredUnknown: async () => { calls.push({ method: "markExpiredUnknown", args: [] }); return 0; },
    heartbeat: async workerId => { calls.push({ method: "heartbeat", args: [workerId] }); return { workerId, lastSeenAt: now() }; },
    getHeartbeat: async () => undefined,
  };
  return { rows, calls, completions, store, loseFence: () => { loseFence = true; } };
}

test("web submit validates and persists only; it never claims or executes tasks", async () => {
  const f = fixture(); const runtime = createOfficeCloudRuntime(f.store);
  const task = { kind: "claude_chat", message: "Question", key: randomUUID() };
  const submitted = await runtime.submit("owner", task);
  assert.equal(submitted.status, "accepted");
  assert.equal(f.rows[0].status, "pending");
  assert.deepEqual(f.calls.map(call => call.method), ["submit"]);
  assert.equal(f.calls[0].args[0], "owner");
  await assert.rejects(runtime.submit("owner", { ...task, sessionId: "client-forged" }));
  assert.equal(f.calls.length, 1);
});

test("worker commits exactly one adapter result and strips its private lease from public state", async () => {
  const run = makeRun(); const f = fixture([run]);
  let calls = 0;
  const worker = createOfficeCloudWorker({ store: f.store, workerId: "cloud-worker", execute: async task => {
    calls++; assert.equal(task.id, run.id); assert.equal(task.status, "running");
    assert.equal("fence" in task, false); assert.equal("workerId" in task, false);
    return { text: "Executed answer", sessionId: "real-session" };
  } });
  await worker.tick();
  assert.equal(calls, 1);
  assert.deepEqual(f.calls.map(call => call.method), ["markExpiredUnknown", "heartbeat", "claim", "complete"]);
  assert.equal(f.completions[0].status, "completed");
  const publicRows = await createOfficeCloudRuntime(f.store).list("owner");
  assert.equal(publicRows[0].text, "Executed answer"); assert.equal(publicRows[0].sessionId, "real-session");
  for (const privateKey of ["result", "workerId", "fence", "leaseExpiresAt"]) assert.equal(privateKey in publicRows[0], false);
});

test("overlapping worker ticks cannot claim a second job while execution is active", async () => {
  const f = fixture([makeRun(), makeRun()]);
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let count = 0;
  const worker = createOfficeCloudWorker({ store: f.store, execute: async () => { count++; entered(); await gate; return { text: "Done", sessionId: "session" }; } });
  const first = worker.tick(); await started;
  await Promise.all([worker.tick(), worker.tick(), worker.tick()]);
  assert.equal(count, 1); assert.equal(f.calls.filter(call => call.method === "claim").length, 1);
  release(); await first;
  assert.equal(f.rows.filter(run => run.status === "pending").length, 1);
});

for (const error of [new OfficeClaudeError("blocked", "Login required"), new OfficeKongError("FORBIDDEN", "KONG access blocked")])
  test(`known adapter error becomes blocked: ${error.name}`, async () => {
    const f = fixture([makeRun()]);
    await createOfficeCloudWorker({ store: f.store, execute: async () => { throw error; } }).tick();
    assert.deepEqual(f.completions[0], { status: "blocked", error: { code: error.code, reason: error.message } });
    assert.equal(f.rows[0].status, "blocked");
  });

test("unknown adapter failure is sanitized and never recorded as successful execution", async () => {
  const f = fixture([makeRun()]);
  await createOfficeCloudWorker({ store: f.store, execute: async () => { throw new Error("secret-stderr-token"); } }).tick();
  assert.equal(f.rows[0].status, "failed"); assert.equal(f.completions[0].status, "failed");
  assert.equal(f.completions[0].error?.code, "EXECUTION_FAILED");
  assert.ok(!JSON.stringify(f.completions).includes("secret-stderr-token"));
});

test("lost completion fence raises uncertainty and never repeats the external execution", async () => {
  const f = fixture([makeRun()]); f.loseFence(); let count = 0;
  const worker = createOfficeCloudWorker({ store: f.store, execute: async () => { count++; return { text: "External outcome", sessionId: "session" }; } });
  await assert.rejects(worker.tick(), /OFFICE_COMPLETION_UNCONFIRMED/);
  assert.equal(f.rows[0].status, "running");
  await worker.tick();
  assert.equal(count, 1); assert.equal(f.completions.length, 1);
});

test("heartbeat/store failure prevents provider execution and releases worker tick guard", async () => {
  const f = fixture([makeRun()]); let count = 0; let fail = true;
  const original = f.store.heartbeat;
  f.store.heartbeat = async workerId => { if (fail) throw new Error("store unavailable"); return original(workerId); };
  const worker = createOfficeCloudWorker({ store: f.store, execute: async () => { count++; return { text: "Done", sessionId: "session" }; } });
  await assert.rejects(worker.tick()); assert.equal(count, 0);
  fail = false; await worker.tick(); assert.equal(count, 1);
});

test("cloud release evidence uses exact target and newest blocking review revokes prior pass", async () => {
  const prUrl = "https://github.com/owner/repo/pull/7"; const headSha = "a".repeat(40); const diffSha256 = "b".repeat(64);
  const review = { prUrl, headSha, diffSha256, verdict: "pass" as const, summary: "No blockers", findings: [] as string[] };
  const pass = makeRun({ kind: "claude_review", status: "completed", prUrl, completedAt: now(), result: { status: "completed", text: "Reviewed", sessionId: "session-pass", review } });
  const f = fixture([pass]); const runtime = createOfficeCloudRuntime(f.store);
  assert.equal((await runtime.getReview("owner", prUrl, headSha, diffSha256))?.id, pass.id);
  assert.equal(await runtime.getReview("owner", prUrl, headSha, "c".repeat(64)), undefined);
  assert.equal(await runtime.getReview("owner", prUrl, "d".repeat(40), diffSha256), undefined);
  f.rows.unshift(makeRun({ kind: "claude_review", status: "completed", prUrl, completedAt: now(), result: { status: "completed", text: "Blocker", sessionId: "session-block", review: { ...review, verdict: "block", findings: ["Bug"] } } }));
  assert.equal(await runtime.getReview("owner", prUrl, headSha, diffSha256), undefined);
});

test("cloud review expiry, absent session, and nonempty pass findings cannot approve", async () => {
  const prUrl = "https://github.com/owner/repo/pull/7"; const headSha = "a".repeat(40); const diffSha256 = "b".repeat(64);
  for (const patch of [
    { completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), sessionId: "session", findings: [] },
    { completedAt: now(), sessionId: "", findings: [] },
    { completedAt: now(), sessionId: "session", findings: ["Unresolved"] },
  ]) {
    const f = fixture([makeRun({ kind: "claude_review", status: "completed", prUrl, completedAt: patch.completedAt, result: { status: "completed", text: "Reviewed", sessionId: patch.sessionId, review: { prUrl, headSha, diffSha256, verdict: "pass", summary: "Reviewed", findings: patch.findings } } })]);
    assert.equal(await createOfficeCloudRuntime(f.store).getReview("owner", prUrl, headSha, diffSha256), undefined);
  }
});
