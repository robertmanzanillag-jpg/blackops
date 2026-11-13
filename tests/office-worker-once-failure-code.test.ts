import test from "node:test";
import assert from "node:assert/strict";
import { safeFailureCode } from "../script/office-worker-once";

test("one-shot failure codes never include free-text messages", () => {
  assert.equal(safeFailureCode(new Error("SHARED_CREDIT_CONFIG_REQUIRED")), "SHARED_CREDIT_CONFIG_REQUIRED");
  const dns = Object.assign(new Error("getaddrinfo ENOTFOUND db.secret-host.example"), { code: "ENOTFOUND" });
  assert.equal(safeFailureCode(dns), "CODE_ENOTFOUND");
  const auth = Object.assign(new Error('password authentication failed for user "owner"'), { code: "28P01" });
  assert.equal(safeFailureCode(auth), "CODE_28P01");
  assert.equal(safeFailureCode(new TypeError("postgresql://u:pw@host/db is invalid")), "CLASS_TypeError");
  assert.equal(safeFailureCode("raw string with secret"), "UNKNOWN");
  assert.equal(safeFailureCode(new Proxy({}, { getOwnPropertyDescriptor() { throw Error("x"); } })), "UNKNOWN");
});
