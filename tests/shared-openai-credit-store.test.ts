import test from "node:test";
import assert from "node:assert/strict";
import { createSharedCreditTransaction, provisionSharedCreditStorage } from "../server/shared-openai-credit-store";
import { createSharedOpenAiCreditLedger } from "../server/shared-openai-credit-ledger";
import { executeWithinSharedCredits } from "../server/shared-openai-credit-execution";

test("shared durable namespace survives restart and lost acknowledgements without reissuing paid work", async () => {
  const rows = new Map<string, string>([["actual-user", '{"company":"untouched"}']]);
  let loseAcknowledgement = false;
  const store = { async transact(owner: string, change: (raw: string | null) => Promise<string>) {
    const raw = await change(rows.get(owner) ?? null); rows.set(owner, raw);
    if (loseAcknowledgement) { loseAcknowledgement = false; throw Error("lost commit acknowledgement"); }
    return raw;
  } };
  const make = () => createSharedOpenAiCreditLedger({ grant: { id: "verified-grant", accountScope: "org:project", availableMicroUsd: 100,
    observedAt: "2026-11-06T12:00:00Z", expiresAt: "2026-11-20T00:00:00Z", verificationEvidenceId: "operator-proof" },
    transact: createSharedCreditTransaction(store, "org:project"), now: () => new Date("2026-11-06T12:01:00Z"), maximumGrantObservationAgeMs: 300000 });
  await assert.rejects(make().initialize(), /NOT_PROVISIONED/);
  await provisionSharedCreditStorage(store, "org:project"); await make().initialize();
  await assert.rejects(provisionSharedCreditStorage(store, "org:project"), /ALREADY_EXISTS/);
  let calls = 0;
  const input = { key: "factory:job1", consumer: "factory" as const, requestSha256: "a".repeat(64), maximumMicroUsd: 70 };
  loseAcknowledgement = true;
  await assert.rejects(executeWithinSharedCredits(make(), input, async () => { calls++; return { value: "unexpected", actualMicroUsd: 20, evidenceId: "resp_a" }; }));
  await assert.rejects(executeWithinSharedCredits(make(), input, async () => { calls++; return { value: "unexpected", actualMicroUsd: 20, evidenceId: "resp_a" }; }), /ALREADY_ADMITTED/);
  assert.equal(calls, 0); assert.equal((await make().status()).reservedMicroUsd, 70);
  await assert.rejects(make().reserve({ ...input, key: "office:job2", consumer: "office", maximumMicroUsd: 31 }), /UNAVAILABLE/);
  assert.equal(rows.get("actual-user"), '{"company":"untouched"}');
});

test("provider uncertainty keeps credit and blocks subsequent Office/factory work", async () => {
  let raw: string | null = null;
  const store = { async transact(_owner: string, change: (value: string | null) => Promise<string>) { const next = await change(raw); raw = next; return next; } };
  await provisionSharedCreditStorage(store, "org");
  const ledger = createSharedOpenAiCreditLedger({ grant: { id: "g", accountScope: "org", availableMicroUsd: 100, observedAt: "2026-11-06T00:00:00Z", expiresAt: "2026-11-07T00:00:00Z", verificationEvidenceId: "proof" }, transact: createSharedCreditTransaction(store, "org"), now: () => new Date("2026-11-06T00:00:00Z"), maximumGrantObservationAgeMs: 1000 });
  await ledger.initialize();
  const input = { key: "office:1", consumer: "office" as const, requestSha256: "b".repeat(64), maximumMicroUsd: 20 };
  await assert.rejects(executeWithinSharedCredits(ledger, input, async () => { throw Error("provider secret must not escape"); }), /^Error: CREDIT_EXECUTION_UNCONFIRMED$/);
  assert.equal((await ledger.status()).reservedMicroUsd, 20);
  await assert.rejects(ledger.reserve({ ...input, key: "factory:1", consumer: "factory" }), /RECONCILIATION_REQUIRED/);
});
