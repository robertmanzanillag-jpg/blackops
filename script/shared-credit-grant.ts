// Operator-only tool for the ONE shared OpenAI credit ledger used by the Office and the factory.
// It never loads repository .env files, never prints connection strings or keys, and never
// overwrites, refills or resets an existing grant. Without --apply it performs no writes.
//
//   status   --scope=S                       read-only balance of an existing ledger
//   config   --scope=S  <pricing>            read-only: print worker config JSON for the EXISTING grant
//   new      --scope=S --id=ID --usd=N --expires=ISO --evidence=E <pricing> [--apply]
//            provision + initialize a NEW ledger (fails if the scope already exists), then print config
//
//   <pricing> = --model=M --input-usd-per-million=N --output-usd-per-million=N --pricing-valid-until=ISO
import { getCouncilStore } from "../server/agent-council-store";
import { createSharedCreditTransaction, provisionSharedCreditStorage } from "../server/shared-openai-credit-store";
import { createSharedOpenAiCreditLedger, type SharedCreditState, type VerifiedCreditGrant } from "../server/shared-openai-credit-ledger";

const identifier = /^[A-Za-z0-9_.:-]{1,200}$/;
const MICRO = 1_000_000;

export function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  if (!["status", "config", "new"].includes(command)) throw Error("USAGE: status|config|new --scope=...");
  const options: Record<string, string> = {};
  let apply = false;
  for (const arg of rest) {
    if (arg === "--apply") { apply = true; continue; }
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1])) throw Error(`ARGUMENT_INVALID: ${arg.split("=")[0]}`);
    options[match[1]] = match[2];
  }
  if (!identifier.test(options.scope || "")) throw Error("SCOPE_INVALID");
  if (apply && command !== "new") throw Error("APPLY_ONLY_FOR_NEW");
  return { command: command as "status" | "config" | "new", options, apply };
}

function isoDate(value: string | undefined, name: string) {
  if (!value || !Number.isFinite(Date.parse(value))) throw Error(`${name}_INVALID`);
  return new Date(value).toISOString();
}

export function buildPricing(options: Record<string, string>) {
  const model = options.model;
  if (!model || !/^[A-Za-z0-9._-]{1,100}$/.test(model)) throw Error("MODEL_INVALID");
  // USD per million tokens -> nano-USD per token (1 USD/M = 1000 nano-USD per token).
  const perToken = (value: string | undefined, name: string) => {
    const usd = Number(value);
    const nano = Math.round(usd * 1000);
    if (!Number.isFinite(usd) || usd <= 0 || !Number.isSafeInteger(nano) || nano < 1) throw Error(`${name}_INVALID`);
    return nano;
  };
  return {
    model,
    inputNanoUsdPerToken: perToken(options["input-usd-per-million"], "INPUT_PRICE"),
    outputNanoUsdPerToken: perToken(options["output-usd-per-million"], "OUTPUT_PRICE"),
    validUntil: isoDate(options["pricing-valid-until"], "PRICING_VALID_UNTIL"),
  };
}

export function buildGrant(options: Record<string, string>, now: Date): VerifiedCreditGrant {
  if (!identifier.test(options.id || "")) throw Error("GRANT_ID_INVALID");
  if (!identifier.test(options.evidence || "")) throw Error("EVIDENCE_INVALID");
  const usd = Number(options.usd);
  const micro = Math.round(usd * MICRO);
  if (!Number.isFinite(usd) || usd <= 0 || usd > 10_000 || !Number.isSafeInteger(micro)) throw Error("USD_INVALID");
  const expiresAt = isoDate(options.expires, "EXPIRES");
  if (Date.parse(expiresAt) <= now.getTime()) throw Error("EXPIRES_IN_PAST");
  return { id: options.id, accountScope: options.scope, availableMicroUsd: micro, observedAt: now.toISOString(), expiresAt,
    verificationEvidenceId: options.evidence };
}

/** Pure, read-only balance computation; mirrors the ledger's own totals. */
export function summarize(state: SharedCreditState) {
  let spent = 0, reserved = 0;
  const counts: Record<string, number> = {};
  for (const row of state.reservations) {
    counts[`${row.consumer}:${row.status}`] = (counts[`${row.consumer}:${row.status}`] ?? 0) + 1;
    if (row.status === "settled") spent += row.actualMicroUsd ?? 0; else reserved += row.reservedMicroUsd;
  }
  const available = state.grant ? Math.max(0, state.grant.availableMicroUsd - spent - reserved) : 0;
  const usd = (micro: number) => Math.round(micro / 10_000) / 100;
  return {
    grantId: state.grant?.id ?? null, expiresAt: state.grant?.expiresAt ?? null,
    grantUsd: usd(state.grant?.availableMicroUsd ?? 0), spentUsd: usd(spent), reservedUsd: usd(reserved), availableUsd: usd(available),
    uncertain: state.reservations.some(row => row.status === "unknown"),
    overrun: state.reservations.some(row => row.status === "settled" && (row.actualMicroUsd ?? 0) > row.reservedMicroUsd),
    reservations: counts, lastObservedAt: state.lastObservedAt,
  };
}

const ledgerOwner = (scope: string) => JSON.stringify(["shared-openai-credit-ledger-v1", scope]);

async function readState(scope: string): Promise<SharedCreditState | null> {
  const raw = await (await getCouncilStore()).read(ledgerOwner(scope));
  return raw === null ? null : JSON.parse(raw) as SharedCreditState;
}

async function main() {
  const { command, options, apply } = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) throw Error("DATABASE_URL_REQUIRED");
  const scope = options.scope;

  if (command === "status" || command === "config") {
    const state = await readState(scope);
    if (!state || !state.grant) throw Error("LEDGER_NOT_INITIALIZED");
    if (state.grant.accountScope !== scope) throw Error("SCOPE_MISMATCH");
    console.log(JSON.stringify({ status: summarize(state) }));
    if (command === "config") console.log(`CONFIG_JSON=${JSON.stringify({ grant: state.grant, pricing: buildPricing(options) })}`);
    return;
  }

  const pricing = buildPricing(options);
  const preview = buildGrant(options, new Date());
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, grant: preview, pricing, existing: (await readState(scope)) !== null }));
    return;
  }
  const store = await getCouncilStore();
  await provisionSharedCreditStorage(store, scope); // throws CREDIT_STORAGE_ALREADY_EXISTS; never overwrites
  // observedAt is taken immediately before initialization so the ledger's freshness check passes.
  const grant = buildGrant(options, new Date());
  const ledger = createSharedOpenAiCreditLedger({ grant, transact: createSharedCreditTransaction(store, scope),
    now: () => new Date(), maximumGrantObservationAgeMs: 60_000 });
  await ledger.initialize();
  console.log(JSON.stringify({ applied: true, status: await ledger.status() }));
  console.log(`CONFIG_JSON=${JSON.stringify({ grant, pricing })}`);
}

if (process.argv[1]?.endsWith("shared-credit-grant.ts")) {
  void main().catch(error => {
    // Static codes only: never print driver errors, which can include connection details.
    const message = error instanceof Error && /^[A-Z_:]+[A-Za-z0-9_ :.-]*$/.test(error.message) ? error.message : "SHARED_CREDIT_TOOL_FAILED";
    console.error(message);
    process.exitCode = 1;
  }).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref());
}
