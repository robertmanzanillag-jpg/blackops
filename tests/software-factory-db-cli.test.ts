import assert from "node:assert/strict";
import test from "node:test";
import {
  creditLedgerOwner, currentMonth, factoryTableNames, ownerKeyFor, parseMigrateArgs, parseStatusArgs, safeErrorCode,
  shapeCreditSummary, shapeJobCounts, shapeProjects,
} from "../script/software-factory-db-cli";

test("derives every factory table from the prepared schema", () => {
  assert.deepEqual(factoryTableNames(), [
    "software_factory_controls", "software_factory_budget", "software_factory_jobs", "software_factory_findings",
    "software_factory_projects", "software_factory_workers",
  ]);
  assert.deepEqual(factoryTableNames("CREATE TABLE IF NOT EXISTS a (x int); CREATE TABLE IF NOT EXISTS a (x int);"), ["a"]);
});

test("migrate args: dry run by default, only --apply accepted", () => {
  assert.deepEqual(parseMigrateArgs([]), { apply: false });
  assert.deepEqual(parseMigrateArgs(["--apply"]), { apply: true });
  for (const bad of [["--apply", "--apply"], ["--force"], ["apply"], ["--apply=1"]]) assert.throws(() => parseMigrateArgs(bad), /^Error: ARGUMENT_INVALID$/);
});

test("status args: owner from flag or env, credit scope validated", () => {
  assert.deepEqual(parseStatusArgs([], {}), { owner: undefined, creditScope: undefined });
  assert.deepEqual(parseStatusArgs([], { SOFTWARE_FACTORY_OWNER_ID: " u1 " }), { owner: "u1", creditScope: undefined });
  assert.deepEqual(parseStatusArgs(["--owner=u2", "--credit-scope=org:main"], { SOFTWARE_FACTORY_OWNER_ID: "u1" }), { owner: "u2", creditScope: "org:main" });
  assert.throws(() => parseStatusArgs(["--owner=a", "--owner=b"], {}), /ARGUMENT_INVALID/);
  assert.throws(() => parseStatusArgs(["--apply"], {}), /ARGUMENT_INVALID/);
  assert.throws(() => parseStatusArgs(["--credit-scope=bad scope"], {}), /CREDIT_SCOPE_INVALID/);
});

test("safe error codes never contain free text", () => {
  assert.equal(safeErrorCode(new Error("FACTORY_SCHEMA_VERIFICATION_FAILED")), "FACTORY_SCHEMA_VERIFICATION_FAILED");
  assert.equal(safeErrorCode(Object.assign(new Error("getaddrinfo ENOTFOUND db.secret-host.example"), { code: "ENOTFOUND" })), "CODE_ENOTFOUND");
  assert.equal(safeErrorCode(Object.assign(new Error('relation "x" does not exist'), { code: "42P01" })), "CODE_42P01");
  assert.equal(safeErrorCode(new Error("connect to postgres://user:pass@host failed")), "CLASS_Error");
  assert.equal(safeErrorCode(new TypeError("boom")), "CLASS_TypeError");
  assert.equal(safeErrorCode(Object.assign(new Error("x"), { code: "has space", name: "bad name!" })), "UNKNOWN");
  assert.equal(safeErrorCode("string"), "UNKNOWN");
});

test("owner key and ledger namespace match the stores", () => {
  assert.equal(ownerKeyFor("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(creditLedgerOwner("s1"), '["shared-openai-credit-ledger-v1","s1"]');
  assert.equal(currentMonth(new Date("2026-11-12T10:00:00Z")), "2026-11");
});

test("projects expose only id and journeys; jobs flag running/unknown", () => {
  assert.deepEqual(shapeProjects([{ id: "p1", journeys: ["login", 3, "checkout"] }, { id: "p2", journeys: null }]),
    [{ id: "p1", journeys: ["login", "checkout"] }, { id: "p2", journeys: [] }]);
  assert.deepEqual(shapeJobCounts([{ status: "completed", count: 3 }, { status: "pending", count: "1" }]),
    { byStatus: { completed: 3, pending: 1 }, running: 0, unknown: 0, attentionRequired: false });
  assert.equal(shapeJobCounts([{ status: "unknown", count: 1 }]).attentionRequired, true);
  assert.equal(shapeJobCounts([{ status: "running", count: 1 }]).running, 1);
});

test("credit summary is shaped without evidence ids or reservation keys", () => {
  assert.deepEqual(shapeCreditSummary(null, "s1"), { provisioned: false });
  const grant = { id: "g1", accountScope: "s1", availableMicroUsd: 10_000_000, observedAt: "2026-11-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", verificationEvidenceId: "secret-evidence" };
  const row = (over: object) => ({ key: "k-secret", consumer: "factory", requestSha256: "a".repeat(64), reservedMicroUsd: 1_000_000, createdAt: "2026-11-02T00:00:00.000Z", status: "reserved", ...over });
  const state = { version: 1, grant, lastObservedAt: "2026-11-03T00:00:00.000Z", reservations: [
    row({ key: "a", status: "settled", actualMicroUsd: 1_500_000, settledAt: "2026-11-02T01:00:00.000Z", settlementEvidenceId: "e", reconciled: false }),
    row({ key: "b", status: "unknown" }),
  ] };
  const summary = shapeCreditSummary(JSON.stringify(state), "s1");
  assert.deepEqual(summary, { provisioned: true, initialized: true, grantId: "g1", expiresAt: "2027-01-01T00:00:00.000Z",
    spentUsd: 1.5, reservedUsd: 1, availableUsd: 7.5, uncertain: true, overrun: true });
  assert.doesNotMatch(JSON.stringify(summary), /secret/);
  assert.deepEqual(shapeCreditSummary(JSON.stringify(state), "other"), { provisioned: true, scopeMismatch: true });
  const empty = shapeCreditSummary(JSON.stringify({ version: 1, grant: null, reservations: [], lastObservedAt: null }), "s1");
  assert.equal(empty.provisioned && "initialized" in empty && empty.initialized, false);
});
