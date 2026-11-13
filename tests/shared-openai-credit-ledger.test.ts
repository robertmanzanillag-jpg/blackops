import test from "node:test";
import assert from "node:assert/strict";
import { createSharedOpenAiCreditLedger, type CreditTransaction, type SharedCreditState, type VerifiedCreditGrant } from "../server/shared-openai-credit-ledger";

const grant: VerifiedCreditGrant = { id: "grant-1", accountScope: "openai-project-1", availableMicroUsd: 1_000_000,
  observedAt: "2026-11-06T12:00:00.000Z", expiresAt: "2026-11-20T00:00:00.000Z", verificationEvidenceId: "operator-proof-1" };
const input = (key: string, maximumMicroUsd = 600_000, consumer: "office" | "factory" = "office") => ({ key, maximumMicroUsd, consumer, requestSha256: "a".repeat(64) });
function fixture() {
  let state: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] };
  let time = new Date(grant.observedAt), tail: Promise<unknown> = Promise.resolve(), loseAck = false;
  const transact: CreditTransaction = async change => {
    const operation = tail.then(() => {
      const copy = structuredClone(state), result = change(copy);
      state = copy;
      if (loseAck) { loseAck = false; throw Error("LOST_ACK"); }
      return result;
    });
    tail = operation.catch(() => {}); return operation;
  };
  const config = { grant, transact, now: () => time, maximumGrantObservationAgeMs: 60_000 };
  return { ledger: createSharedOpenAiCreditLedger(config), config, state: () => structuredClone(state), corrupt: (f: (s: SharedCreditState) => void) => f(state),
    time: (value: string) => { time = new Date(value); }, loseAck: () => { loseAck = true; } };
}

test("explicit grant bootstrap is required and concurrent Office/factory admissions share one balance", async () => {
  const f = fixture();
  await assert.rejects(f.ledger.reserve(input("first")), /NOT_INITIALIZED/);
  await f.ledger.initialize();
  const results = await Promise.allSettled([f.ledger.reserve(input("office")), f.ledger.reserve(input("factory", 600_000, "factory"))]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await f.ledger.status()).reservedMicroUsd, 600_000);
  assert.equal(f.state().reservations.length, 1);
});

test("receipt inspection never admits execution or changes unresolved holds",async()=>{
 const f=fixture();await f.ledger.initialize();
 await assert.rejects(f.ledger.settledReceipt("missing"),/SETTLED_RECEIPT_REQUIRED/);
 await f.ledger.reserve(input("paid"));await assert.rejects(f.ledger.settledReceipt("paid"),/SETTLED_RECEIPT_REQUIRED/);
 await f.ledger.settle({key:"paid",actualMicroUsd:50,evidenceId:"resp_paid"});
 const receipt=await f.ledger.settledReceipt("paid");assert.equal(receipt.actualMicroUsd,50);receipt.actualMicroUsd=0;
 assert.equal((await f.ledger.settledReceipt("paid")).actualMicroUsd,50);assert.equal((await f.ledger.reserve(input("paid"))).admitted,false);
 await f.ledger.reserve(input("unknown",100));await f.ledger.markUnknown("unknown","lost");
 await assert.rejects(f.ledger.settledReceipt("unknown"),/SETTLED_RECEIPT_REQUIRED/);assert.equal((await f.ledger.status()).reservedMicroUsd,100);
});

test("lost admission acknowledgment and process restart never authorize a duplicate paid call", async () => {
  const f = fixture(); await f.ledger.initialize(); f.loseAck();
  await assert.rejects(f.ledger.reserve(input("same")), /LOST_ACK/);
  const restarted = createSharedOpenAiCreditLedger(f.config);
  const repeated = await restarted.reserve(input("same")); assert.equal(repeated.admitted, false);
  assert.equal((await restarted.status()).reservedMicroUsd, 600_000);
  await assert.rejects(restarted.reserve({ ...input("same"), consumer: "factory" }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(restarted.reserve({ ...input("same"), requestSha256: "b".repeat(64) }), /IDEMPOTENCY_CONFLICT/);
});

test("unknown execution retains full hold and requires stopped proof; settlement survives lost ack", async () => {
  const f = fixture(); await f.ledger.initialize(); await f.ledger.reserve(input("call"));
  await f.ledger.markUnknown("call", "timeout-proof"); await f.ledger.markUnknown("call", "timeout-proof");
  await assert.rejects(f.ledger.reserve(input("next", 1, "factory")), /RECONCILIATION_REQUIRED/);
  await assert.rejects(f.ledger.settle({ key: "call", actualMicroUsd: 300_000, evidenceId: "usage-1" }), /STOPPED_RECONCILIATION/);
  assert.equal((await f.ledger.status()).reservedMicroUsd, 600_000);
  const settlement = { key: "call", actualMicroUsd: 300_000, evidenceId: "usage-1", reconciliation: { executionStopped: true as const } };
  f.loseAck(); await assert.rejects(f.ledger.settle(settlement), /LOST_ACK/); await f.ledger.settle(settlement);
  assert.equal((await f.ledger.status()).spentMicroUsd, 300_000);
  assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
  await assert.rejects(f.ledger.settle({ ...settlement, actualMicroUsd: 0 }), /IDEMPOTENCY_CONFLICT/);
});

test("expiry and month rollover never refill credit; expiry still permits usage settlement", async () => {
  const f = fixture(); await f.ledger.initialize(); await f.ledger.reserve(input("call"));
  f.time("2026-12-01T00:00:00.000Z"); await f.ledger.initialize();
  await assert.rejects(f.ledger.reserve(input("new", 1)), /EXPIRED/);
  await f.ledger.settle({ key: "call", actualMicroUsd: 400_000, evidenceId: "usage-expired" });
  const status = await f.ledger.status(); assert.equal(status.expired, true); assert.equal(status.spentMicroUsd, 400_000);
  assert.equal(status.availableMicroUsd, 600_000);
});

test("overspend is recorded honestly and permanently blocks further admission", async () => {
  const f = fixture(); await f.ledger.initialize(); await f.ledger.reserve(input("call", 100_000));
  await f.ledger.settle({ key: "call", actualMicroUsd: 1_200_000, evidenceId: "overrun" });
  const status = await f.ledger.status(); assert.equal(status.spentMicroUsd, 1_200_000); assert.equal(status.availableMicroUsd, 0); assert.equal(status.overrun, true);
  await assert.rejects(f.ledger.reserve(input("next", 1)), /RECONCILIATION_REQUIRED/);
});

test("corrupt state, receipt reuse, changed grant and regressing clock fail closed", async () => {
  const f = fixture(); await f.ledger.initialize();
  for (const key of ["a", "b"]) await f.ledger.reserve(input(key, 10));
  await f.ledger.settle({ key: "a", actualMicroUsd: 5, evidenceId: "unique-response" });
  await assert.rejects(f.ledger.settle({ key: "b", actualMicroUsd: 5, evidenceId: "unique-response" }), /CORRUPT/);
  assert.equal(f.state().reservations[1].status, "reserved");
  const altered = createSharedOpenAiCreditLedger({ ...f.config, grant: { ...grant, availableMicroUsd: 2_000_000 } });
  await assert.rejects(altered.initialize(), /GRANT_MISMATCH/);
  f.time("2026-11-06T11:59:59.000Z"); await assert.rejects(f.ledger.status(), /CLOCK_UNVERIFIED/);
  f.time(grant.observedAt); f.corrupt(state => { state.reservations[1].actualMicroUsd = 0; });
  await assert.rejects(f.ledger.reserve(input("c", 1)), /CORRUPT/);
});

test("unverified timestamps, malformed units and stale bootstrap cannot create an allowance", async () => {
  const f = fixture(); f.time("2026-11-06T12:02:00.000Z");
  await assert.rejects(f.ledger.initialize(), /GRANT_NOT_FRESH/); assert.equal(f.state().grant, null);
  assert.throws(() => createSharedOpenAiCreditLedger({ ...f.config, grant: { ...grant, availableMicroUsd: 1.5 } }));
  assert.throws(() => createSharedOpenAiCreditLedger({ ...f.config, grant: { ...grant, expiresAt: grant.observedAt } }), /CONFIGURATION_INVALID/);
  f.time(grant.observedAt); await f.ledger.initialize();
  await assert.rejects(f.ledger.reserve(input("fraction", 0.5)));
  await assert.rejects(f.ledger.reserve(input("negative", -1)));
  const mutable = structuredClone(grant), ledger = createSharedOpenAiCreditLedger({ ...f.config, grant: mutable }); mutable.availableMicroUsd = 9_000_000;
  assert.equal((await ledger.status()).availableMicroUsd, 1_000_000);
});


test("JSONB key reordering preserves immutable grant identity without accepting changed values", async () => {
  const f = fixture(); await f.ledger.initialize(); await f.ledger.reserve(input("before", 100));
  f.corrupt(state => { state.grant = Object.fromEntries(Object.entries(state.grant!).reverse()) as VerifiedCreditGrant; });
  const reopened = createSharedOpenAiCreditLedger(f.config);
  await reopened.initialize();
  assert.equal((await reopened.status()).reservedMicroUsd, 100);
  assert.equal((await reopened.reserve(input("after", 100, "factory"))).admitted, true);
  f.corrupt(state => { state.grant!.verificationEvidenceId = "different-proof"; });
  await assert.rejects(reopened.status(), /GRANT_MISMATCH/);
});
