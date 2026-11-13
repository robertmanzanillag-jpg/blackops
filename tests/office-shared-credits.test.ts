import test from "node:test";
import assert from "node:assert/strict";
import { createCreditLimitedOfficeRun } from "../server/office-shared-credits";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import { createOfficeTokenBudget, type OfficeTokenBudgetState } from "../server/office-token-budget";

const model = "gpt-4.1-mini-2025-04-14", initialTime = "2026-11-06T12:00:00.000Z", expiry = "2026-11-20T00:00:00.000Z";
const response = () => ({ id: "resp_fixture", model, status: "completed", usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
  output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Verified fixture" }] }] });
async function fixture() {
  let time = new Date(initialTime), credit: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] };
  let tokens: OfficeTokenBudgetState = { reservations: [] }, calls = 0, fail = false, expireBeforeRequest = false, loseSettlementAck = false;
  let body: any = response();
  const ledger = createSharedOpenAiCreditLedger({ grant: { id: "g", accountScope: "shared-account", availableMicroUsd: 1_000_000,
    observedAt: initialTime, expiresAt: expiry, verificationEvidenceId: "verified-grant-proof" }, now: () => time, maximumGrantObservationAgeMs: 1000,
    transact: async mutate => { const copy = structuredClone(credit), result = mutate(copy); credit = copy;
      if (loseSettlementAck && credit.reservations[0]?.status === "settled") { loseSettlementAck = false; throw Error("lost commit ack"); }
      return result;
    } });
  await ledger.initialize();
  const tokenBudget = createOfficeTokenBudget({ limit: 100_000, now: () => time,
    transact: async mutate => { const copy = structuredClone(tokens); mutate(copy); tokens = copy; } });
  const run = createCreditLimitedOfficeRun({ ledger, now: () => time,
    env: { OFFICE_REVIEW_PROVIDER: "openai", OFFICE_OPENAI_MODEL: model, OFFICE_OPENAI_MAX_OUTPUT_TOKENS: "32", OPENAI_API_KEY: "synthetic-test-key" },
    pricing: { model, inputNanoUsdPerToken: 400, outputNanoUsdPerToken: 1600, validUntil: "2026-12-20T00:00:00.000Z" },
    authorizeTokens: async limits => { const id = await tokenBudget.reserve(limits); if (expireBeforeRequest) time = new Date(expiry); return id; },
    recordTokens: (id, metadata) => tokenBudget.recordUsage(id, metadata),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      calls++; assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init?.signal?.aborted, false);
      assert.equal(credit.reservations[0].status, "reserved"); assert.equal(tokens.reservations[0].status, "reserved");
      if (fail) throw Error("private-provider-detail");
      return Response.json(body);
    }) as typeof fetch,
  });
  return { run, ledger, credit: () => credit, tokens: () => tokens, calls: () => calls,
    body: (value: unknown) => { body = value; }, fail: () => { fail = true; }, expire: () => { expireBeforeRequest = true; }, loseAck: () => { loseSettlementAck = true; } };
}

test("Office exact usage settles common money and secondary tokens before returning output", async () => {
  const f = await fixture(); const result = await f.run("Review synthetic work", "assignment:phase1");
  assert.equal(result.text, "Verified fixture"); assert.equal(f.calls(), 1);
  assert.equal((await f.ledger.status()).spentMicroUsd, 56); assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
  assert.equal(f.tokens().reservations[0].status, "accounted");
  await assert.rejects(f.run("Review synthetic work", "assignment:phase1")); assert.equal(f.calls(), 1);
  await assert.rejects(f.run("Different request", "assignment:phase1")); assert.equal(f.calls(), 1);
});

test("known terminal incomplete output still settles exact usage without claiming successful work", async () => {
  const f = await fixture(); f.body({ ...response(), status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] });
  await assert.rejects(f.run("Review synthetic work", "assignment:incomplete"), /^Error: OFFICE_CREDIT_EXECUTION_UNCONFIRMED$/);
  assert.equal(f.calls(), 1); assert.equal((await f.ledger.status()).spentMicroUsd, 56);
  assert.equal((await f.ledger.status()).reservedMicroUsd, 0); assert.equal(f.tokens().reservations[0].status, "accounted");
});

test("unknown network or model mismatch retains both holds and never repeats paid calls", async () => {
  for (const reason of ["network", "model"] as const) {
    const f = await fixture(); if (reason === "network") f.fail(); else f.body({ ...response(), model: "unpriced-model" });
    await assert.rejects(f.run("Review synthetic work", "assignment:uncertain"), /^Error: OFFICE_CREDIT_EXECUTION_UNCONFIRMED$/);
    assert.equal(f.credit().reservations[0].status, "unknown"); assert.equal(f.tokens().reservations[0].status, "reserved");
    assert.ok((await f.ledger.status()).reservedMicroUsd > 0); assert.equal((await f.ledger.status()).spentMicroUsd, 0);
    await assert.rejects(f.run("Review synthetic work", "assignment:uncertain"));
    await assert.rejects(f.run("Next request", "assignment:next")); assert.equal(f.calls(), 1);
  }
});

test("grant expiry after token admission blocks network despite still-current pricing", async () => {
  const f = await fixture(); f.expire(); await assert.rejects(f.run("Review synthetic work", "assignment:expired"));
  assert.equal(f.calls(), 0); assert.equal(f.credit().reservations[0].status, "unknown");
  assert.equal((await f.ledger.status()).spentMicroUsd, 0); assert.ok((await f.ledger.status()).reservedMicroUsd > 0);
});

test("lost money settlement acknowledgment cannot cause another provider call", async () => {
  const f = await fixture(); f.loseAck(); await assert.rejects(f.run("Review synthetic work", "assignment:ack"));
  assert.equal((await f.ledger.status()).spentMicroUsd, 56); assert.equal(f.tokens().reservations[0].status, "reserved");
  await assert.rejects(f.run("Review synthetic work", "assignment:ack")); assert.equal(f.calls(), 1);
});

test("active provider execution with partial usage must retain money and token holds", async () => {
  for (const status of ["in_progress", "queued", "unknown_future_status"]) {
    const f = await fixture(); f.body({ ...response(), status, output: [] });
    await assert.rejects(f.run("Review synthetic work", "assignment:active"));
    assert.equal(f.credit().reservations[0].status, "unknown"); assert.equal(f.tokens().reservations[0].status, "reserved");
    assert.equal((await f.ledger.status()).spentMicroUsd, 0); assert.ok((await f.ledger.status()).reservedMicroUsd > 0);
  }
});
