import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertFactoryCreditReady, factoryOnceFailure } from "../server/software-factory-diagnostics";

const now = Date.parse("2026-11-18T02:00:00Z");
const validUntil = "2026-11-19T00:00:00Z";
const ready = { uncertain: false, expired: false, overrun: false, availableMicroUsd: 1000000 };

test("an uncertain office hold refuses factory startup even with sufficient balance", () => {
  const budget = { ...ready, uncertain: true };
  const original = structuredClone(budget);
  let paidStageCalls = 0;
  assert.throws(() => {
    assertFactoryCreditReady(budget, 20000, validUntil, now);
    paidStageCalls++;
  }, /FACTORY_OPERATOR_CREDIT_UNCERTAIN/);
  assert.equal(paidStageCalls, 0);
  assert.deepEqual(budget, original);
});

test("each existing credit guard still refuses startup with a safe distinct code", () => {
  for (const [budget, required, pricing, time, code] of [
    [{ ...ready, expired: true }, 20000, validUntil, now, "CREDIT_EXPIRED"],
    [{ ...ready, overrun: true }, 20000, validUntil, now, "CREDIT_OVERRUN"],
    [{ ...ready, availableMicroUsd: 19999 }, 20000, validUntil, now, "CREDIT_INSUFFICIENT"],
    [ready, 20000, new Date(now).toISOString(), now, "PRICING_EXPIRED"],
    [ready, 20000, "invalid", now, "PRICING_EXPIRED"],
    [ready, 20000, validUntil, NaN, "PRICING_EXPIRED"],
    [{ ...ready, availableMicroUsd: NaN }, 20000, validUntil, now, "CREDIT_INSUFFICIENT"],
  ] as const) assert.throws(() => assertFactoryCreditReady(budget, required, pricing, time), new RegExp(code));
  assert.doesNotThrow(() => assertFactoryCreditReady(ready, ready.availableMicroUsd, validUntil, now));
});

test("Actions diagnostics never expose arbitrary errors, SQL details, identifiers or nested causes", () => {
  const secret = "postgres://private:password@host/db owner-private";
  const errors = [
    new Error(secret), { message: secret, stack: secret }, secret, null,
    Object.assign(new Error(secret), { code: "55P03", detail: secret, cause: new Error(secret) }),
    new Error("FACTORY_OPERATOR_CREDIT_UNCERTAIN " + secret),
    Object.defineProperty({}, "code", { get() { throw Error(secret); } }),
  ];
  for (const [index, error] of errors.entries()) {
    const report = factoryOnceFailure(error, "operator");
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(report.automaticReplay, false);
    assert.equal(report.code, index === 4 ? "FACTORY_DATABASE_LOCK_UNAVAILABLE" : "FACTORY_ONCE_UNAVAILABLE");
  }
  assert.deepEqual(factoryOnceFailure(new Error("FACTORY_OPERATOR_CREDIT_UNCERTAIN"), "operator"), {
    event: "factory_once_failure", phase: "operator", code: "FACTORY_OPERATOR_CREDIT_UNCERTAIN", automaticReplay: false,
  });
  let reads = 0;
  const changingMessage = Object.defineProperty(new Error(), "message", {
    get() { return ++reads === 1 ? "FACTORY_OPERATOR_CREDIT_UNCERTAIN" : secret; },
  });
  assert.equal(factoryOnceFailure(changingMessage, "operator").code, "FACTORY_ONCE_UNAVAILABLE");
  assert.equal(reads, 0);
});

test("the real launcher reports a rejected configuration without credentials or adapter loading", () => {
  const result = spawnSync(process.execPath, [...process.execArgv,
    fileURLToPath(new URL("../script/software-factory-once.ts", import.meta.url))], {
    env: {}, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr.trim()), {
    event: "factory_once_failure", phase: "configuration",
    code: "FACTORY_ONCE_CONFIGURATION_REQUIRED", automaticReplay: false,
  });
});
