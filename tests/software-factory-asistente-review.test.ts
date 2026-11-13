import test from "node:test";
import assert from "node:assert/strict";
import { createAsistenteIndependentReview, type AsistenteReviewSource } from "../server/software-factory-asistente-review";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import type { FactoryProject } from "../server/software-factory";
import type { FactoryPipelineState } from "../server/software-factory-pipeline";

const repository = "robertmanzanillag-jpg/blackops", base = "a".repeat(40), head = "b".repeat(40);
const model = "gpt-4.1-mini-2025-04-14", at = "2026-11-06T12:00:00.000Z";
const project = { id: "asistente", repo: repository } as FactoryProject;
const state = { version: 1, projectId: project.id, rootJobId: "root-1", repairAttempts: 0,
  finding: { id: "order", request: "Fix agent search", baseSha: base, kind: "bug", regressionScenarioId: "search", artifactIds: ["reproduction"], sourcePaths: ["server/agent-search.ts", "tests/agent-search.test.ts"] },
  candidate: { projectId: project.id, baseSha: base, headSha: head, changedFiles: ["server/agent-search.ts", "tests/agent-search.test.ts"], builderId: "factory-remote-builder", risk: "unknown" },
} as FactoryPipelineState;
const source: AsistenteReviewSource = { repository, baseSha: base, headSha: head, changedFiles: [...state.candidate!.changedFiles],
  files: [{ path: "server/agent-search.ts", baseline: "old source", candidate: "new source" }, { path: "tests/agent-search.test.ts", baseline: "old test", candidate: "new test" }] };
async function fixture() {
  let clock = new Date(at), credit: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] };
  let calls = 0, loads = 0, answer = '{"passed":true,"warnings":[]}', status = "completed", mismatch = false, expire = false;
  let loaded = structuredClone(source);
  const now = () => clock;
  const ledger = createSharedOpenAiCreditLedger({ grant: { id: "grant", accountScope: "shared", availableMicroUsd: 100000, observedAt: at,
    expiresAt: "2026-11-20T00:00:00.000Z", verificationEvidenceId: "proof" }, now, maximumGrantObservationAgeMs: 1000,
    transact: async change => { const copy = structuredClone(credit), result = change(copy); credit = copy; return result; } });
  await ledger.initialize();
  const review = createAsistenteIndependentReview({ ledger, now, maxOutputTokens: 512, load: async (candidate, signal, paths) => {
    loads++; assert.deepEqual(paths, state.finding.sourcePaths); assert.equal(signal.aborted, false); assert.equal(candidate.headSha, head); return loaded;
  }, model: { model, inputNanoUsdPerToken: 400, outputNanoUsdPerToken: 1600, now, maxInputTokens: 12000, pricingValidUntil: "2026-12-20T00:00:00.000Z",
    request: async (url, init) => {
      calls++; assert.equal(credit.reservations.at(-1)?.status, "reserved"); assert.ok(credit.reservations.at(-1)?.key.startsWith("factory-review:"));
      const body = JSON.parse(String(init.body)); assert.match(body.instructions, /Independently review/); assert.match(body.input, /new source/);
      if (url.endsWith("/input_tokens")) { if (expire) clock = new Date("2026-11-20T00:00:00.000Z"); return Response.json({ object: "response.input_tokens", input_tokens: 100 }); }
      return Response.json({ object: "response", model: mismatch ? "other-model" : model, status,
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
        output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: answer }] }] });
    } } });
  return { ledger, review, credit: () => credit, calls: () => calls, loads: () => loads,
    source: (value: AsistenteReviewSource) => { loaded = value; }, answer: (value: string) => { answer = value; },
    status: (value: string) => { status = value; }, mismatch: () => { mismatch = true; }, expire: () => { expire = true; },
    run: (s = state, p = project, signal = new AbortController().signal) => review(p, s, { signal, maxCostCents: 2 }) };
}

test("fresh independent review binds every source version, shares builder spend and cannot repeat the call", async () => {
  const f = await fixture();
  await f.ledger.reserve({ key: "factory:builder", consumer: "factory", maximumMicroUsd: 10000, requestSha256: "c".repeat(64) });
  await f.ledger.settle({ key: "factory:builder", actualMicroUsd: 10000, evidenceId: "build-proof" });
  const result = await f.run(); assert.equal(result.evidence.passed, true); assert.equal(result.costCents, 1);
  assert.equal(result.evidence.baseSha, base); assert.equal(result.evidence.headSha, head); assert.notEqual(result.evidence.actorId, state.candidate!.builderId);
  assert.match(result.evidence.artifactIds[0], /^[a-f0-9]{64}$/); assert.equal(result.evidence.createdAt, at);
  assert.equal("risk" in result, false); assert.equal("next" in result, false);
  assert.equal((await f.ledger.status()).spentMicroUsd, 20000); assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
  await assert.rejects(f.run()); assert.equal(f.calls(), 2);
});

test("invalid source identity, omitted files, excessive content and self-review never call model", async () => {
  const invalidSources = [ { ...source, repository: "owner/kong" }, { ...source, headSha: base },
    { ...source, files: source.files.slice(0, 1) }, { ...source, changedFiles: [source.changedFiles[0]] },
    { ...source, files: [source.files[0], source.files[0]] },
    { ...source, files: [{ ...source.files[0], candidate: "x".repeat(100001) }, source.files[1]] } ];
  for (const invalid of invalidSources) { const f = await fixture(); f.source(invalid); await assert.rejects(f.run(), /SOURCE_MISMATCH/); assert.equal(f.calls(), 0); assert.equal(f.credit().reservations.length, 0); }
  for (const modified of [ { ...state, candidate: { ...state.candidate!, builderId: "asistente-independent-response-reviewer" } },
    { ...state, candidate: { ...state.candidate!, changedFiles: ["server/kong.ts"] } }, { ...state, repairAttempts: -1 },
    { ...state, finding: { ...state.finding, sourcePaths: undefined } }, { ...state, finding: { ...state.finding, sourcePaths: ["server/agent-search.ts"] } },
    { ...state, candidate: { ...state.candidate!, changedFiles: ["package.json"] }, finding: { ...state.finding, sourcePaths: ["package.json"] } } ]) {
    const f = await fixture(); await assert.rejects(f.run(modified), /CONTEXT_INVALID/); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
  }
});

test("known malformed or failed reviewer output settles usage but never approves", async () => {
  for (const text of ["not JSON", '{"passed":true,"warnings":["defect"]}', '{"passed":true,"warnings":[],"extra":true}', '{"passed":true,"warnings":[null]}']) {
    const f = await fixture(); f.answer(text); const result = await f.run();
    assert.equal(result.evidence.passed, false); assert.equal(result.costCents, 1); assert.equal((await f.ledger.status()).spentMicroUsd, 10000);
  }
  const f = await fixture(); f.status("incomplete"); const result = await f.run();
  assert.equal(result.evidence.passed, false); assert.equal(result.costCents, 1); assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
});

test("unknown billing and grant expiry after counting retain shared escrow", async () => {
  for (const mode of ["model", "expiry"]) {
    const f = await fixture(); if (mode === "model") f.mismatch(); else f.expire();
    await assert.rejects(f.run()); assert.equal(f.credit().reservations[0].status, "unknown");
    assert.equal((await f.ledger.status()).reservedMicroUsd, 20000); assert.equal((await f.ledger.status()).spentMicroUsd, 0);
    assert.equal(f.calls(), mode === "model" ? 2 : 1); await assert.rejects(f.run()); assert.equal(f.calls(), mode === "model" ? 2 : 1);
  }
});

test("aborted review cannot load source or reserve provider credit", async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.run(state, project, controller.signal)); assert.equal(f.loads(), 0); assert.equal(f.calls(), 0); assert.equal(f.credit().reservations.length, 0);
});
