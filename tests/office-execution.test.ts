import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createOfficeExecution } from "../server/office-execution";
import { createAgentCouncil, CouncilStateConflict } from "../server/agent-council";
import { emptyCouncilState } from "../shared/agent-council";
import { advanceCompany } from "../shared/agent-company";
import type { OfficeCloudRun } from "../server/office-cloud-store";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const role = "claude-reviewer";
function fixture() {
  const initial = emptyCouncilState();
  initial.company = advanceCompany(initial.company, { now: NOW - 86400001, roles: { [role]: "Reviewer" }, statuses: { [role]: { state: "working", label: "Observed result" } } }).state;
  initial.company.careers[role].reviewGuidance = ["Verify account ownership"];
  let raw = JSON.stringify(initial), revision = 0;
  const make = () => createAgentCouncil({ now: () => NOW, userId: () => "owner", readState: async () => raw, writeState: async () => {},
    versioned: { read: async () => ({ raw, revision }), write: async (next, expected) => { if (expected !== revision) throw new CouncilStateConflict(); raw = next; return ++revision; } },
    collect: async () => ({}), submitProposal: async () => "", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {},
  });
  const task = (): OfficeCloudRun => ({ id: randomUUID(), key: randomUUID(), kind: "claude_review", prUrl: "https://github.com/a/b/pull/1", status: "running", createdAt: new Date(NOW).toISOString(), fence: randomUUID(), leaseExpiresAt: new Date(NOW + 180000).toISOString() });
  return { make, task };
}
const env = { OFFICE_REVIEW_PROVIDER: "openai", OFFICE_OPENAI_MODEL: "test-model", OPENAI_API_KEY: "test-only", OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT: "100000" };

test("durable admission binds active guidance, accounts usage and confirms actual review across restart", async () => {
  const f = fixture(); const council = f.make(); let request: any;
  const diff = "+const safe = true;";
  const execution = createOfficeExecution(council, env, () => NOW, {
    loadPr: async prUrl => ({ prUrl, headSha: "a".repeat(40), diff, diffSha256: createHash("sha256").update(diff).digest("hex") }),
    fetch: (async (_url, options) => { request = JSON.parse(String(options?.body)); return new Response(JSON.stringify({ id: "resp_test", model: "test-model", status: "completed", usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ verdict: "pass", summary: "Reviewed", findings: [] }) }] }] })); }) as typeof fetch,
  });
  const task = f.task(); assert.equal(await execution.admission.ready(), true);
  assert.equal(await execution.admission.begin(task), true);
  const restarted = createOfficeExecution(f.make(), env, () => NOW);
  assert.equal(await restarted.admission.ready(), false);
  const output = await execution.execute({ ...task, status: "running" });
  assert.match(request.input, /Verify account ownership/);
  assert.equal(output.provider, "openai");
  await execution.admission.finish(task, { ...output, status: "completed" });
  const loaded = await f.make().load();
  assert.equal(loaded.officeExecution!.tokens.reservations[0].result!.usage.totalTokens, 30);
  assert.equal(loaded.officeExecution!.roles.roles[role].leases[0].status, "completed");
  assert.equal(await restarted.admission.ready(), true);
  assert.equal("officeExecution" in await council.view(), false);
});

test("actual invalid reviews retire depleted holder; infrastructure failure never deducts life", async () => {
  const f = fixture(); const council = f.make();
  await council.updateOfficeExecution((state, company) => { company.careers[role].battery = 10; return state; });
  let execution = createOfficeExecution(council, env, () => NOW);
  const blocked = f.task(); assert.equal(await execution.admission.begin(blocked), true);
  await execution.admission.finish(blocked, { status: "blocked", error: { code: "quota_or_rate_limit", reason: "Provider unavailable" } });
  assert.equal((await council.load()).company.careers[role].battery, 10);
  execution = createOfficeExecution(f.make(), env, () => NOW);
  const failed = f.task(); assert.equal(await execution.admission.begin(failed), true);
  await execution.admission.finish(failed, { status: "failed", error: { code: "INVALID_REVIEW", reason: "Invalid output" } });
  const result = await council.load();
  assert.equal(result.company.careers[role].generation, 2);
  assert.equal(result.officeExecution!.roles.roles[role].status, "vacant");
  assert.equal(await createOfficeExecution(f.make(), env, () => NOW).admission.ready(), false);
});

test("simultaneous workers serialize role admission and missing explicit budget fails closed", async () => {
  const f = fixture();
  const a = createOfficeExecution(f.make(), env, () => NOW), b = createOfficeExecution(f.make(), env, () => NOW);
  assert.deepEqual((await Promise.all([a.admission.begin(f.task()), b.admission.begin(f.task())])).sort(), [false, true]);
  assert.throws(() => createOfficeExecution(f.make(), { ...env, OFFICE_OPENAI_MONTHLY_TOKEN_LIMIT: undefined }), /explicit_token_limit/);
});


async function sharedCreditFixture(availableMicroUsd = 100_000) {
  const { createSharedOpenAiCreditLedger } = await import("../server/shared-openai-credit-ledger");
  let state: import("../server/shared-openai-credit-ledger").SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] };
  const ledger = createSharedOpenAiCreditLedger({ grant: { id: "office-shared-grant", accountScope: "common-account", availableMicroUsd,
    observedAt: new Date(NOW).toISOString(), expiresAt: "2026-11-20T00:00:00.000Z", verificationEvidenceId: "verified-proof" },
    now: () => new Date(NOW), maximumGrantObservationAgeMs: 1000,
    transact: async mutate => { const copy = structuredClone(state), result = mutate(copy); state = copy; return result; } });
  await ledger.initialize();
  return { ledger, pricing: { model: env.OFFICE_OPENAI_MODEL, inputNanoUsdPerToken: 400, outputNanoUsdPerToken: 1600, validUntil: "2026-11-20T00:00:00.000Z" } };
}

test("injected shared credits bind paid review to admitted job across restart and retain secondary tokens", async () => {
  const f = fixture(), council = f.make(), sharedCredits = await sharedCreditFixture();
  let calls = 0;
  const diff = "+const checked = true;";
  const deps = { sharedCredits,
    loadPr: async (prUrl: string) => ({ prUrl, headSha: "a".repeat(40), diff, diffSha256: createHash("sha256").update(diff).digest("hex") }),
    fetch: (async () => { calls++; return Response.json({ id: "resp_shared_review", model: env.OFFICE_OPENAI_MODEL, status: "completed",
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }, output: [{ type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify({ verdict: "pass", summary: "Reviewed", findings: [] }) }] }] }); }) as typeof fetch,
  };
  const execution = createOfficeExecution(council, env, () => NOW, deps), task = f.task();
  await assert.rejects(execution.run("Unassigned work"), /ASSIGNMENT_REQUIRED/); assert.equal(calls, 0);
  assert.equal(await execution.admission.begin(task), true);
  const result = await execution.execute(task);
  assert.equal(result.provider, "openai"); assert.equal(calls, 1);
  assert.equal((await sharedCredits.ledger.status()).spentMicroUsd, 24);
  assert.equal((await council.load()).officeExecution!.tokens.reservations[0].status, "accounted");
  await assert.rejects(execution.execute(task)); assert.equal(calls, 1);
  await execution.admission.finish(task, { ...result, status: "completed" });
  await assert.rejects(execution.run("No longer assigned"), /ASSIGNMENT_REQUIRED/);
  const restarted = createOfficeExecution(f.make(), env, () => NOW, deps);
  // Even explicit reuse of the immutable assignment cannot obtain another call.
  await assert.rejects(restarted.run("Another prompt", `review:${task.id}`)); assert.equal(calls, 1);
});

test("shared monetary exhaustion blocks before secondary admission or provider request", async () => {
  const f = fixture(), council = f.make(), sharedCredits = await sharedCreditFixture(1); let calls = 0;
  const execution = createOfficeExecution(council, env, () => NOW, { sharedCredits, fetch: (async () => { calls++; throw Error("must not execute"); }) as typeof fetch });
  await assert.rejects(execution.run("A bounded review", "academy:job:incumbent"));
  assert.equal(calls, 0); assert.equal((await sharedCredits.ledger.status()).reservedMicroUsd, 0);
  assert.equal((await council.load()).officeExecution?.tokens.reservations.length ?? 0, 0);
});

test("required shared-credit configuration and immutable assignment never fall back to token-only execution", async () => {
  const f = fixture(); let calls = 0;
  const execution = createOfficeExecution(f.make(), { ...env, OPENAI_SHARED_CREDITS_REQUIRED: "true" }, () => NOW,
    { fetch: (async () => { calls++; throw Error("must not execute"); }) as typeof fetch });
  await assert.rejects(execution.run("Review"), /ASSIGNMENT_REQUIRED/);
  await assert.rejects(execution.run("Review", "review:immutable-id"), /CONFIGURATION_REQUIRED/);
  assert.equal(calls, 0);
});

test("academy runner passes distinct stable assignment phases to the credit-limited provider", async () => {
  const { emptyCompanyState, enrollTrainee, advanceAcademy } = await import("../shared/agent-company");
  const { createAcademyReviewRunner, reserveAcademyReview } = await import("../server/office-academy-runner");
  const modules = [{ id: "rules", title: "Rules", summary: "Review ownership" }];
  let state = advanceCompany(emptyCompanyState(), { now: NOW, roles: { [role]: "Reviewer" }, statuses: { [role]: { state: "working", label: "ready" } } }).state;
  state = enrollTrainee(state, { id: "candidate", forAgentId: role, role: "Reviewer", now: NOW });
  state = advanceAcademy(state, () => modules, NOW);
  const reserved = reserveAcademyReview(state, modules, NOW, "stable-job"); assert.ok(reserved.job);
  const ids: (string | undefined)[] = [];
  const runner = createAcademyReviewRunner({ now: () => NOW, run: async (_prompt, id) => {
    ids.push(id); return { sessionId: `fixture-session-${ids.length}`, text: '{"findings":[]}', completedAt: new Date(NOW).toISOString() };
  } });
  await runner(reserved.state, reserved.job!); await runner(reserved.state, reserved.job!);
  assert.deepEqual(ids, ["academy:stable-job:incumbent", "academy:stable-job:candidate", "academy:stable-job:incumbent", "academy:stable-job:candidate"]);
});
