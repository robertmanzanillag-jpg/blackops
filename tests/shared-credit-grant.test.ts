import test from "node:test";
import assert from "node:assert/strict";
import { buildGrant, buildPricing, parseArgs, summarize } from "../script/shared-credit-grant";

const pricing = { model: "gpt-6.1-sol", "input-usd-per-million": "2", "output-usd-per-million": "10", "pricing-valid-until": "2026-12-01T00:00:00Z" };

test("pricing converts USD per million tokens to nano-USD per token", () => {
  assert.deepEqual(buildPricing(pricing), { model: "gpt-6.1-sol", inputNanoUsdPerToken: 2000, outputNanoUsdPerToken: 10000, validUntil: "2026-12-01T00:00:00.000Z" });
  assert.throws(() => buildPricing({ ...pricing, "input-usd-per-million": "0" }), /INPUT_PRICE_INVALID/);
  assert.throws(() => buildPricing({ ...pricing, model: "bad model" }), /MODEL_INVALID/);
});

test("grant uses whole micro-USD, a future expiry and the supplied scope", () => {
  const now = new Date("2026-11-12T08:00:00Z");
  const grant = buildGrant({ scope: "org:2026-11", id: "chatgpt-pro-2026-11", usd: "100", expires: "2026-11-20T00:00:00Z", evidence: "billing-ui" }, now);
  assert.equal(grant.availableMicroUsd, 100_000_000);
  assert.equal(grant.observedAt, now.toISOString());
  assert.equal(grant.accountScope, "org:2026-11");
  assert.throws(() => buildGrant({ scope: "s", id: "g", usd: "100", expires: "2026-11-01T00:00:00Z", evidence: "e" }, now), /EXPIRES_IN_PAST/);
  assert.throws(() => buildGrant({ scope: "s", id: "g", usd: "-1", expires: "2026-11-20T00:00:00Z", evidence: "e" }, now), /USD_INVALID/);
});

test("arguments: --apply only creates new ledgers and duplicate flags are rejected", () => {
  assert.equal(parseArgs(["new", "--scope=s", "--apply"]).apply, true);
  assert.throws(() => parseArgs(["status", "--scope=s", "--apply"]), /APPLY_ONLY_FOR_NEW/);
  assert.throws(() => parseArgs(["status", "--scope=s", "--scope=t"]), /ARGUMENT_INVALID/);
  assert.throws(() => parseArgs(["drop", "--scope=s"]), /USAGE/);
  assert.throws(() => parseArgs(["status", "--scope=bad scope"]), /SCOPE_INVALID/);
});

test("summary mirrors ledger totals and flags uncertain or overrun receipts", () => {
  const grant = { id: "g", accountScope: "s", availableMicroUsd: 100_000_000, observedAt: "2026-11-07T00:00:00Z", expiresAt: "2026-11-20T00:00:00Z", verificationEvidenceId: "e" };
  const summary = summarize({ version: 1, grant, lastObservedAt: "2026-11-12T00:00:00Z", reservations: [
    { key: "a", consumer: "factory", requestSha256: "a".repeat(64), reservedMicroUsd: 5_000_000, createdAt: "2026-11-08T00:00:00Z", status: "settled", actualMicroUsd: 1_250_000, settlementEvidenceId: "r1", settledAt: "2026-11-08T00:01:00Z", reconciled: false },
    { key: "b", consumer: "office", requestSha256: "b".repeat(64), reservedMicroUsd: 2_000_000, createdAt: "2026-11-09T00:00:00Z", status: "unknown", unknownEvidenceId: "u1" },
  ] });
  assert.equal(summary.spentUsd, 1.25);
  assert.equal(summary.reservedUsd, 2);
  assert.equal(summary.availableUsd, 96.75);
  assert.equal(summary.uncertain, true);
  assert.equal(summary.overrun, false);
  assert.deepEqual(summary.reservations, { "factory:settled": 1, "office:unknown": 1 });
});
