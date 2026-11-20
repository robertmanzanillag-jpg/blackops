import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { auditFailure, parseAuditInput, shapeCreditAudit, runCreditAudit, type AuditConfig } from "../script/office-credit-audit-core";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import { createCapabilityTrainer, parseCapabilityTraining } from "../server/office-capability-training";
import { auditSavedRole } from "../server/office-role-audits";
import { sourceDigest } from "../server/office-role-snapshots";
import type { RoleWorkJob } from "../server/office-role-work";

const owner = "private-owner", now = Date.parse("2026-11-18T00:32:00.000Z");
const privateText = "private-output-never-log";
const config: AuditConfig = { grant: { id: "private-grant", accountScope: "private-scope", availableMicroUsd: 1000000,
  observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), verificationEvidenceId: "private-evidence" },
  pricing: { model: "fixture-model", inputNanoUsdPerToken: 1000, outputNanoUsdPerToken: 2000, validUntil: new Date(now + 86400000).toISOString() } };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture(durableText = false, settled = false) {
  const body = { version: 1 as const, role: "control" as const, ownerKey: sourceDigest(owner), observedAt: new Date(now).toISOString(),
    total: 1, rows: [{ id: "private-source", scope: "publish", level: "autonomous", risk: "high", enabled: true }] };
  const source = { ...body, sourceDigest: sourceDigest(body) }, audit = auditSavedRole("control", source, owner, now);
  const job: RoleWorkJob = { id: randomUUID(), fence: randomUUID(), role: "control", generation: 1,
    slot: new Date(now).toISOString().slice(0, 10), startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString(),
    completedAt: new Date(now).toISOString(), status: "completed", source, audit };
  job.artifactId = sourceDigest({ id: job.id, role: job.role, generation: 1, fence: job.fence, source, audit });
  let training = parseCapabilityTraining(undefined, owner);
  const result = { text: privateText, sessionId: "resp_private", model: config.pricing.model, provider: "openai" as const,
    completedAt: new Date(now).toISOString(), usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
  await createCapabilityTrainer({ owner, maxCallsPerDay: 1, now: () => now,
    transact: async change => (training = change(structuredClone(training), { control: 1 })),
    loadWork: async () => ({ version: 1, ownerKey: sourceDigest(owner), jobs: [job] }),
    run: async () => { if (!durableText) throw Error("private-provider-error"); return result; },
    verifyCost: async () => { throw Error("private-cost-error"); },
  }).tick();
  let credit: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] };
  const ledger = createSharedOpenAiCreditLedger({ grant: config.grant, now: () => new Date(now), maximumGrantObservationAgeMs: 60000,
    transact: async change => { const copy = structuredClone(credit), value = change(copy); credit = copy; return value; } });
  await ledger.initialize();
  const key = `office:${hash(`${training.runs[0].id}:trained`)}`;
  await ledger.reserve({ key, consumer: "office", requestSha256: "a".repeat(64), maximumMicroUsd: 100 });
  if (settled) await ledger.settle({ key, actualMicroUsd: 20, evidenceId: result.sessionId });
  else await ledger.markUnknown(key, "private-unknown-proof");
  const { text: _text, ...metadata } = result;
  const tokens = { reservations: durableText ? [{ id: "private-token", month: "2026-11", model: result.model,
    reservedTokens: 100, createdAt: new Date(now).toISOString(), status: "accounted", result: metadata }] : [] };
  const council = { version: 1, officeExecution: { tokens, capabilityTraining: training } };
  return { council, credit, key, result };
}

function assertPublic(value: unknown, forbidden: string[]) {
  const output = JSON.stringify(value);
  for (const text of [...forbidden, owner, config.grant.accountScope, config.grant.id, privateText, config.pricing.model, "resp_private", "private-token"])
    assert.equal(output.includes(text), false, `private value leaked: ${text}`);
  const walk = (item: unknown) => {
    if (item && typeof item === "object") for (const value of Object.values(item)) walk(value);
    else if (typeof item === "string") assert.equal(item, "AUDIT_COMPLETE");
    else assert.ok(typeof item === "boolean" || (typeof item === "number" && Number.isSafeInteger(item)));
  };
  walk(value);
}

test("exact original text, token metadata and phase-key settled receipt count as positive evidence only", async () => {
  const f = await fixture(true, true), before = structuredClone(f);
  const report = await shapeCreditAudit(f.council, f.credit, owner, config, now + 400000);
  assert.equal(report.capability.unknownProductionRuns, 1);
  assert.equal(report.capability.durableResults, 1);
  assert.equal(report.capability.positiveEvidenceAtConfiguredPricing, 1);
  assert.equal(report.tokens.responseMatchesInConfiguredScope, 1);
  assert.equal(report.nonAuthorizing, true);
  assert.equal(report.durableTextRequired, true);
  assertPublic(report, [f.key, f.council.officeExecution.capabilityTraining.runs[0].id]);
  assert.deepEqual(f, before, "auditing cannot mutate either journal");
});

test("unknown hold without text or tokens never becomes absence proof or authority", async () => {
  const f = await fixture();
  const report = await shapeCreditAudit(f.council, f.credit, owner, config, now + 400000);
  assert.equal(report.capability.uncertainPhaseKeys, 1);
  assert.equal(report.capability.durableResults, 0);
  assert.equal(report.capability.positiveEvidenceAtConfiguredPricing, 0);
  assert.equal(report.historicalAbsenceProof, false);
  assert.equal(report.nonAuthorizing, true);
  assertPublic(report, [f.key]);
});

test("token usage alone cannot recover output or convert an unmatched scope into corruption", async () => {
  const f = await fixture(true, false);
  delete f.council.officeExecution.capabilityTraining.runs[0].unverifiedResult;
  const report = await shapeCreditAudit(f.council, f.credit, owner, config, now + 400000);
  assert.equal(report.tokens.unmatchedInConfiguredScope, 1);
  assert.equal(report.schemasValidated, true);
  assert.equal(report.capability.durableResults, 0);
  assert.equal(report.capability.positiveEvidenceAtConfiguredPricing, 0);
  assert.equal(report.nonAuthorizing, true);
});

test("price/model mismatch and a receipt for a different execution cannot provide positive evidence", async () => {
  const f = await fixture(true, true);
  const differentPricing = structuredClone(config); differentPricing.pricing.inputNanoUsdPerToken++;
  // Use a material change: micro-USD rounding is intentionally exact.
  differentPricing.pricing.inputNanoUsdPerToken *= 2;
  const report = await shapeCreditAudit(f.council, f.credit, owner, differentPricing, now + 400000);
  assert.equal(report.tokens.responseMatchesWithoutConfiguredPriceMatch, 1);
  assert.equal(report.capability.positiveEvidenceAtConfiguredPricing, 0);
  f.credit.reservations[0].key = `office:${"b".repeat(64)}`;
  const other = await shapeCreditAudit(f.council, f.credit, owner, config, now + 400000);
  assert.equal(other.tokens.responseMatchesInConfiguredScope, 1);
  assert.equal(other.capability.phaseKeysFound, 0);
  assert.equal(other.capability.positiveEvidenceAtConfiguredPricing, 0);
});

test("wrong scope/owner, invalid usage, duplicate rows and unknown fields fail with static errors", async () => {
  const original = await fixture(true, true);
  for (const change of [
    (f: typeof original) => { f.credit.grant!.accountScope = "different-private-scope"; },
    (f: typeof original) => { f.council.officeExecution.capabilityTraining.ownerKey = "wrong-owner"; },
    (f: typeof original) => { f.council.officeExecution.tokens.reservations[0].result.usage.totalTokens++; },
    (f: typeof original) => { f.council.officeExecution.tokens.reservations.push(structuredClone(f.council.officeExecution.tokens.reservations[0])); },
    (f: typeof original) => { Object.assign(f.council.officeExecution.tokens, { privateField: privateText }); },
  ]) {
    const f = structuredClone(original); change(f);
    await assert.rejects(shapeCreditAudit(f.council, f.credit, owner, config, now + 400000), /^Error: AUDIT_SCHEMA_OR_SCOPE_INVALID$/);
  }
});

async function databaseFixture(recovery = false, readOnly = "on") {
  const f = await fixture(), queries: string[] = [];
  const client = { query: async (sql: string, values?: unknown[]) => {
    queries.push(sql);
    if (sql.startsWith("SELECT pg_is_in_recovery")) return { rows: [{ recovery, read_only: readOnly, snapshot_at: new Date(now + 400000) }] };
    if (sql.startsWith("SELECT owner_key")) {
      assert.deepEqual(values, [[hash(owner), hash(JSON.stringify(["shared-openai-credit-ledger-v1", config.grant.accountScope]))]]);
      return { rows: [{ owner_key: hash(owner), state: f.council }, { owner_key: hash(JSON.stringify(["shared-openai-credit-ledger-v1", config.grant.accountScope])), state: f.credit }] };
    }
    assert.match(sql, /^(BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY|SET LOCAL (lock_timeout|statement_timeout) = \d+|ROLLBACK)$/);
    return { rows: [] };
  } };
  return { client, queries };
}

test("database snapshot uses the primary, repeatable read, read-only queries and always rollback", async () => {
  const f = await databaseFixture();
  const report = await runCreditAudit(f.client, { owner, config });
  assert.equal(report.primary, true);
  assert.equal(f.queries[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(f.queries.at(-1), "ROLLBACK");
  assert.equal(f.queries.some(sql => /COMMIT|FOR UPDATE|INSERT|DELETE|UPDATE|CREATE|ALTER/.test(sql)), false);
  assertPublic(report, []);
  for (const [recovery, readOnly] of [[true, "on"], [false, "off"]] as const) {
    const rejected = await databaseFixture(recovery, readOnly);
    await assert.rejects(runCreditAudit(rejected.client, { owner, config }), /AUDIT_PRIMARY_READ_ONLY_REQUIRED/);
    assert.equal(rejected.queries.at(-1), "ROLLBACK");
    assert.equal(rejected.queries.some(sql => sql.startsWith("SELECT owner_key")), false);
  }
  const broken = await databaseFixture();
  const client = { query: async (sql: string, values?: unknown[]) => {
    if (sql.startsWith("SELECT owner_key")) throw Error("private-db-detail");
    return broken.client.query(sql, values);
  } };
  await assert.rejects(runCreditAudit(client, { owner, config }), /private-db-detail/);
  assert.equal(broken.queries.at(-1), "ROLLBACK");
});

test("input accepts only explicit configuration and no apply flag; CLI fails safely with an empty environment", () => {
  assert.deepEqual(parseAuditInput({ DEFAULT_USER_ID: owner, OPENAI_SHARED_CREDIT_CONFIG_JSON: JSON.stringify(config) }, []), { owner, config });
  for (const [env, args] of [[{}, []], [{ DEFAULT_USER_ID: owner, OPENAI_SHARED_CREDIT_CONFIG_JSON: privateText }, []],
    [{ DEFAULT_USER_ID: owner, OPENAI_SHARED_CREDIT_CONFIG_JSON: JSON.stringify(config) }, ["--apply"]]] as const)
    assert.throws(() => parseAuditInput(env, args), /^Error: AUDIT_INPUT_INVALID$/);
  const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(new URL("../script/office-credit-audit.ts", import.meta.url))],
    { env: {}, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr.trim()), { code: "AUDIT_INPUT_INVALID", readOnly: true, nonAuthorizing: true });
});

test("manual action receives no provider key and retains reviewed-source and migration confirmation guards", async () => {
  const workflow = await readFile(new URL("../.github/workflows/factory-ops.yml", import.meta.url), "utf8");
  const step = workflow.split(/^      - /m).find(step => step.startsWith("name: Audit office credit evidence"))!;
  assert.match(step, /if: inputs.action == 'office-credit-audit'/);
  assert.match(step, /secrets.OPENAI_SHARED_CREDIT_CONFIG_JSON/);
  assert.doesNotMatch(step, /OPENAI_API_KEY|GITHUB_TOKEN|FACTORY_DATABASE_URL|--apply|loadSharedCreditRuntime/);
  assert.match(workflow, /ref: \$\{\{ needs.config.outputs.OFFICE_SOURCE_REF \}\}/);
  assert.match(workflow, /inputs.confirm != 'APLICAR'/);
  assert.match(workflow, /permissions:\n  contents: read/);
});

test("failure reports expose only static categories without invoking error accessors", () => {
  let reads = 0;
  const error = Object.defineProperty(new Error(), "message", { get() { reads++; return privateText; } });
  assert.deepEqual(auditFailure(error), { code: "AUDIT_UNAVAILABLE", readOnly: true, nonAuthorizing: true });
  assert.equal(reads, 0);
  assert.equal(auditFailure(new Error(privateText)).code, "AUDIT_UNAVAILABLE");
  assert.equal(auditFailure(new Error("AUDIT_SCHEMA_OR_SCOPE_INVALID")).code, "AUDIT_SCHEMA_OR_SCOPE_INVALID");
});
