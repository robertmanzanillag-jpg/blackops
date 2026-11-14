import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { councilOwnerKey, createCouncilStore, type CouncilPool } from "../server/agent-council-store";
import { buildPricing, ledgerOwner } from "../script/shared-credit-grant";
import { deriveConfig, run, selectGrant } from "../script/shared-credit-config-from-db";

const now = new Date("2026-11-13T12:00:00Z");
const grant = (scope: string, expiresAt = "2026-11-30T00:00:00Z") => ({ id: `grant-${scope}`, accountScope: scope, availableMicroUsd: 100_000_000,
  observedAt: "2026-11-07T00:00:00Z", expiresAt, verificationEvidenceId: "billing-ui-evidence" });
const ledgerRow = (scope: string, expiresAt?: string) => ({ ownerKey: councilOwnerKey(ledgerOwner(scope)), grant: grant(scope, expiresAt) });
const env = { DATABASE_URL: "postgres://user:sandboxsecret@db.internal:5432/prod", OFFICE_OPENAI_MODEL: "gpt-6.1-sol",
  OFFICE_SHARED_CREDIT_INPUT_USD_PER_MILLION: "2", OFFICE_SHARED_CREDIT_OUTPUT_USD_PER_MILLION: "10",
  OFFICE_SHARED_CREDIT_PRICING_VALID_UNTIL: "2026-12-31T00:00:00Z" };

/** In-memory agent_council_state that records every SQL statement. */
function fakePool(states: Record<string, unknown>) {
  const sql: string[] = [];
  const rows = Object.entries(states).map(([owner, state]) => ({ owner_key: councilOwnerKey(owner), state }));
  const pool: CouncilPool = { async connect() { return {
    async query(text: string, values?: unknown[]) {
      sql.push(text);
      if (!text.startsWith("SELECT")) return { rows: [] };
      const pick = (r: { owner_key: string; state: any }) => text.includes("AS grant")
        ? { owner_key: r.owner_key, grant: r.state.grant } : { state: r.state };
      if (values?.length) return { rows: rows.filter(r => r.owner_key === values[0]).map(pick) };
      return { rows: rows.filter(r => r.state?.grant && typeof r.state.grant === "object" && r.state.grant.accountScope).map(pick) };
    },
    release() {},
  }; } };
  return { pool, sql };
}

test("discovery: exactly one unexpired ledger is selected; 0, many or expired fail with static codes", () => {
  assert.equal(selectGrant([ledgerRow("org:a")], now).accountScope, "org:a");
  // A grant-shaped object in an unrelated council row (key is not the ledger owner hash) is ignored.
  assert.equal(selectGrant([ledgerRow("org:a"), { ownerKey: councilOwnerKey("user-1"), grant: grant("org:b") }], now).accountScope, "org:a");
  // Expired ledgers do not count towards ambiguity.
  assert.equal(selectGrant([ledgerRow("org:a"), ledgerRow("org:old", "2026-11-01T00:00:00Z")], now).accountScope, "org:a");
  assert.throws(() => selectGrant([], now), /^Error: LEDGER_NOT_FOUND$/);
  assert.throws(() => selectGrant([ledgerRow("org:a"), ledgerRow("org:b")], now), /LEDGER_AMBIGUOUS/);
  assert.throws(() => selectGrant([ledgerRow("org:a", "2026-11-13T12:00:00Z")], now), /GRANT_EXPIRED/);
  assert.throws(() => selectGrant([{ ownerKey: councilOwnerKey(ledgerOwner("org:a")), grant: null }], now), /LEDGER_NOT_FOUND/);
});

test("configured scope wins over discovery and is still validated", () => {
  const rows = [ledgerRow("org:a"), ledgerRow("org:b")];
  assert.equal(selectGrant(rows, now, "org:b").accountScope, "org:b");
  assert.throws(() => selectGrant(rows, now, "org:c"), /LEDGER_NOT_INITIALIZED/);
  assert.throws(() => selectGrant([ledgerRow("org:a", "2026-11-01T00:00:00Z")], now, "org:a"), /GRANT_EXPIRED/);
  assert.throws(() => selectGrant([{ ownerKey: councilOwnerKey(ledgerOwner("org:a")), grant: grant("org:x") }], now, "org:a"), /SCOPE_MISMATCH/);
});

test("output equals `shared-credit-grant.ts config` for the same ledger and pricing; access is read-only", async () => {
  const state = { version: 1, grant: grant("org:a"), reservations: [], lastObservedAt: null };
  const { pool, sql } = fakePool({ [ledgerOwner("org:a")]: state, "user-1": { company: {} } });
  // What `config --scope=org:a --model=... --input-usd-per-million=2 ...` builds from the store.
  const stored = JSON.parse((await createCouncilStore(pool).read(ledgerOwner("org:a")))!);
  const expected = { grant: stored.grant, pricing: buildPricing({ model: "gpt-6.1-sol", "input-usd-per-million": "2",
    "output-usd-per-million": "10", "pricing-valid-until": "2026-12-31T00:00:00Z" }) };
  for (const scopeEnv of [{}, { OFFICE_SHARED_CREDIT_SCOPE: "org:a" }]) {
    const { config } = await deriveConfig(pool, { ...env, ...scopeEnv }, now);
    assert.equal(JSON.stringify(config), JSON.stringify(expected));
  }
  const derived = (await deriveConfig(pool, { ...env, OFFICE_SHARED_CREDIT_PRICING_MODEL: "gpt-other" }, now)).config;
  assert.equal(derived.pricing.model, "gpt-other");
  const reads = sql.flatMap((text, index) => text.includes("AS grant") ? [index] : []);
  assert.equal(reads.length, 3);
  for (const index of reads) assert.deepEqual([sql[index - 2], sql[index + 1]], ["BEGIN READ ONLY", "COMMIT"]);
  assert.ok(sql.every(text => !/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(text)));
  await assert.rejects(deriveConfig(pool, { ...env, OFFICE_SHARED_CREDIT_PRICING_VALID_UNTIL: "2026-11-01T00:00:00Z" }, now), /PRICING_EXPIRED/);
  await assert.rejects(deriveConfig(pool, { ...env, OFFICE_SHARED_CREDIT_SCOPE: "bad scope" }, now), /SCOPE_INVALID/);
});

test("run writes a 0600 file and logs only a static line", async () => {
  const { pool } = fakePool({ [ledgerOwner("org:a")]: { version: 1, grant: grant("org:a"), reservations: [], lastObservedAt: null } });
  const out = join(mkdtempSync(join(tmpdir(), "credit-")), "shared-credit.json");
  const lines: string[] = [];
  await run([`--out=${out}`], env, async () => pool, line => lines.push(line), now);
  assert.deepEqual(lines, ["shared credit config: written (discovered ledger)"]);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).grant.id, "grant-org:a");
  await assert.rejects(run([], env, async () => pool, () => undefined, now), /USAGE/);
  await assert.rejects(run([`--out=${out}`], { ...env, DATABASE_URL: "" }, async () => pool, () => undefined, now), /DATABASE_URL_REQUIRED/);
});

test("CLI failure prints a static code, never the connection string", () => {
  const out = join(mkdtempSync(join(tmpdir(), "credit-")), "shared-credit.json");
  const url = "postgres://leakuser:leakpassword123@127.0.0.1:1/leakdb";
  const result = spawnSync(process.execPath, ["--import", "tsx", "script/shared-credit-config-from-db.ts", `--out=${out}`], {
    env: { ...process.env, ...env, DATABASE_URL: url, OFFICE_SHARED_CREDIT_SCOPE: "org:a" }, encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 1);
  const printed = result.stdout + result.stderr;
  for (const secret of ["leakuser", "leakpassword123", "leakdb", "127.0.0.1", "org:a"]) assert.ok(!printed.includes(secret), secret);
  assert.match(result.stderr.trim(), /^[A-Z_:]+[A-Za-z0-9_ :.-]*$/);
});
