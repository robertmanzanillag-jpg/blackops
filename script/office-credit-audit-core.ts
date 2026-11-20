import { createHash } from "node:crypto";
import { z } from "zod";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import { parseCapabilityTraining } from "../server/office-capability-training";

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/);
const amount = z.number().int().nonnegative().safe();
const stamp = z.string().datetime();
const usage = z.object({ inputTokens: amount, outputTokens: amount, totalTokens: amount }).strict()
  .refine(value => value.totalTokens === value.inputTokens + value.outputTokens);
const metadata = z.object({ sessionId: z.string().regex(/^resp_/), model: z.string().min(1),
  provider: z.literal("openai"), completedAt: stamp, usage }).strict();
const tokensSchema = z.object({ reservations: z.array(z.object({ id: z.string().min(1), month: z.string().regex(/^\d{4}-\d{2}$/),
  model: z.string().min(1), reservedTokens: amount.refine(value => value > 0), createdAt: stamp,
  status: z.enum(["reserved", "accounted"]), result: metadata.optional() }).strict()) }).strict();
const configSchema = z.object({ grant: z.object({ id: identifier, accountScope: identifier, availableMicroUsd: amount,
  observedAt: stamp, expiresAt: stamp, verificationEvidenceId: identifier }).strict(),
  pricing: z.object({ model: z.string().min(1), inputNanoUsdPerToken: amount.refine(value => value > 0),
    outputNanoUsdPerToken: amount.refine(value => value > 0), validUntil: stamp }).strict() }).strict();
export type AuditConfig = z.infer<typeof configSchema>;
export function parseAuditInput(env: Record<string, string | undefined>, args: readonly string[]) {
  try {
    if (args.length || !env.DEFAULT_USER_ID?.trim() || env.DEFAULT_USER_ID.length > 500 ||
      !env.OPENAI_SHARED_CREDIT_CONFIG_JSON || Buffer.byteLength(env.OPENAI_SHARED_CREDIT_CONFIG_JSON) > 16384) throw Error();
    return { owner: env.DEFAULT_USER_ID.trim(), config: configSchema.parse(JSON.parse(env.OPENAI_SHARED_CREDIT_CONFIG_JSON)) };
  } catch { throw Error("AUDIT_INPUT_INVALID"); }
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const phaseKey = (id: string, side: string) => `office:${digest(`${id}:${side}`)}`;
const equalUsage = (a: z.infer<typeof usage>, b: z.infer<typeof usage>) =>
  a.inputTokens === b.inputTokens && a.outputTokens === b.outputTokens && a.totalTokens === b.totalTokens;

/** Pure snapshot comparison. Never loads the writer runtime or provider. Current
 * prices classify matches only; unmatched history is never a zero-charge proof. */
export async function shapeCreditAudit(council: unknown, credit: unknown, owner: string, config: AuditConfig, now: number) {
  try {
    config = configSchema.parse(config);
    const execution = z.object({ version: z.literal(1), officeExecution: z.object({
      tokens: tokensSchema, capabilityTraining: z.unknown(),
    }).passthrough() }).passthrough().parse(council).officeExecution;
    const tokens = execution.tokens.reservations;
    const ids = new Set<string>(), responses = new Set<string>();
    for (const token of tokens) {
      if (ids.has(token.id) || (token.status === "accounted") !== !!token.result) throw Error();
      ids.add(token.id);
      if (token.result) { if (responses.has(token.result.sessionId)) throw Error(); responses.add(token.result.sessionId); }
    }
    if (!Object.hasOwn(execution, "capabilityTraining") || execution.capabilityTraining === undefined) throw Error();
    const training = parseCapabilityTraining(execution.capabilityTraining, owner);
    // Reuse the real ledger validator against a disposable clone. status() here
    // cannot issue SQL or persist lastObservedAt: no durable adapter is supplied.
    const snapshot = structuredClone(credit) as SharedCreditState;
    const ledger = createSharedOpenAiCreditLedger({ grant: config.grant, now: () => new Date(now), maximumGrantObservationAgeMs: 60000,
      transact: async change => structuredClone(change(structuredClone(snapshot))) });
    await ledger.status();
    const settled = snapshot.reservations.filter(row => row.consumer === "office" && row.status === "settled");
    const accounted = tokens.filter(row => row.status === "accounted");
    const price = config.pricing;
    const micro = (result: z.infer<typeof metadata>) => (BigInt(result.usage.inputTokens) * BigInt(price.inputNanoUsdPerToken) +
      BigInt(result.usage.outputTokens) * BigInt(price.outputNanoUsdPerToken) + 999n) / 1000n;
    let responseMatches = 0, configuredPriceMatches = 0;
    for (const token of accounted) {
      const receipt = settled.find(row => row.settlementEvidenceId === token.result!.sessionId);
      if (!receipt) continue;
      responseMatches++;
      if (token.result!.model === price.model && BigInt(receipt.actualMicroUsd!) === micro(token.result!)) configuredPriceMatches++;
    }
    const unknown = training.runs.filter(run => run.status === "unknown");
    let phaseKeysFound = 0, settledPhaseKeys = 0, uncertainPhaseKeys = 0, durableResults = 0, unattributedDurableResults = 0, positiveEvidence = 0, tokensInWindows = 0;
    for (const run of unknown) {
      if (run.kind === "holdout" && !run.baseline && run.unverifiedResult?.text.trim()) unattributedDurableResults++;
      tokensInWindows += tokens.filter(token => Date.parse(token.createdAt) >= Date.parse(run.startedAt) && Date.parse(token.createdAt) <= Date.parse(run.expiresAt)).length;
      for (const side of run.kind === "holdout" ? ["baseline", "trained"] as const : ["trained"] as const) {
        const receipt = snapshot.reservations.find(row => row.key === phaseKey(run.id, side));
        if (receipt) phaseKeysFound++;
        if (receipt?.status === "settled") settledPhaseKeys++;
        if (receipt?.status === "unknown" || receipt?.status === "reserved") uncertainPhaseKeys++;
        // An untagged partial holdout result cannot be assigned to a phase merely
        // by response order; production has exactly one trained phase.
        const measured = run[side];
        const result = measured?.result || (side === "trained" && (run.kind === "production" || !!run.baseline) ? run.unverifiedResult : undefined);
        if (!result?.text.trim()) continue;
        durableResults++;
        const token = accounted.find(row => row.result!.sessionId === result.sessionId);
        if (receipt?.status === "settled" && receipt.consumer === "office" && !receipt.reconciled &&
          receipt.settlementEvidenceId === result.sessionId && result.model === price.model && BigInt(receipt.actualMicroUsd!) === micro(result) &&
          (!measured || (measured.cost.receiptId === receipt.key && measured.cost.usd === receipt.actualMicroUsd! / 1000000)) &&
          token?.result?.model === result.model && token.result.completedAt === result.completedAt && equalUsage(token.result.usage, result.usage)) positiveEvidence++;
      }
    }
    return { code: "AUDIT_COMPLETE", readOnly: true, nonAuthorizing: true, schemasValidated: true, scopeVerified: true,
      historicalAbsenceProof: false, durableTextRequired: true, configuredPricingCurrent: now < Date.parse(price.validUntil),
      tokens: { total: tokens.length, accounted: accounted.length, reserved: tokens.length - accounted.length,
        responseMatchesInConfiguredScope: responseMatches, unmatchedInConfiguredScope: accounted.length - responseMatches,
        matchesAtConfiguredPricing: configuredPriceMatches, responseMatchesWithoutConfiguredPriceMatch: responseMatches - configuredPriceMatches },
      shared: { settledOfficeReceipts: settled.length, unknownReservations: snapshot.reservations.filter(row => row.status === "unknown").length },
      capability: { unknownRuns: unknown.length, unknownProductionRuns: unknown.filter(run => run.kind === "production").length,
        phaseKeysFound, settledPhaseKeys, uncertainPhaseKeys, durableResults, unattributedDurableResults, positiveEvidenceAtConfiguredPricing: positiveEvidence,
        tokenRowsInUnknownRunWindows: tokensInWindows } };
  } catch { throw Error("AUDIT_SCHEMA_OR_SCOPE_INVALID"); }
}

export interface AuditClient { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
export async function runCreditAudit(client: AuditClient, input: { owner: string; config: AuditConfig }) {
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL lock_timeout = 2000");
    await client.query("SET LOCAL statement_timeout = 15000");
    const state = (await client.query("SELECT pg_is_in_recovery() AS recovery, current_setting('transaction_read_only') AS read_only, CURRENT_TIMESTAMP AS snapshot_at")).rows[0];
    if (state?.recovery !== false || state.read_only !== "on") throw Error("AUDIT_PRIMARY_READ_ONLY_REQUIRED");
    const ownerKey = digest(input.owner), scopeKey = digest(JSON.stringify(["shared-openai-credit-ledger-v1", input.config.grant.accountScope]));
    const rows = (await client.query("SELECT owner_key, state FROM agent_council_state WHERE owner_key = ANY($1::text[])", [[ownerKey, scopeKey]])).rows;
    if (rows.length !== 2) throw Error("AUDIT_STATE_REQUIRED");
    return { ...await shapeCreditAudit(rows.find(row => row.owner_key === ownerKey)?.state,
      rows.find(row => row.owner_key === scopeKey)?.state, input.owner, input.config, new Date(state.snapshot_at as string).getTime()), primary: true };
  } finally { await client.query("ROLLBACK"); }
}

/** Fixed public error categories; arbitrary database/provider text stays private. */
export function auditFailure(error: unknown) {
  const allowed = ["AUDIT_INPUT_INVALID", "AUDIT_PRIMARY_READ_ONLY_REQUIRED", "AUDIT_STATE_REQUIRED", "AUDIT_SCHEMA_OR_SCOPE_INVALID"];
  let code = "AUDIT_UNAVAILABLE";
  try {
    const value = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : undefined;
    if (typeof value === "string" && allowed.includes(value)) code = value;
  } catch { /* Untrusted accessors/proxies cannot affect the report. */ }
  return { code, readOnly: true, nonAuthorizing: true };
}
