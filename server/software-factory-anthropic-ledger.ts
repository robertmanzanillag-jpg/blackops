import { createSharedOpenAiCreditLedger, type CreditTransaction, type SharedCreditState, type VerifiedCreditGrant } from "./shared-openai-credit-ledger";
import type { createCouncilStore } from "./agent-council-store";
import { ANTHROPIC_FACTORY_MODEL, ANTHROPIC_FACTORY_PRICES, ANTHROPIC_FACTORY_PRICING_VALID_UNTIL } from "./software-factory-anthropic";

type DurableStore = Pick<ReturnType<typeof createCouncilStore>, "transact" | "read">;
export const ANTHROPIC_FACTORY_ACCOUNT_SCOPE = "factory-anthropic";
export const ANTHROPIC_FACTORY_DEFAULT_MONTHLY_BUDGET_USD = 50;

/** On only when an Anthropic key is configured; FACTORY_ANTHROPIC_FALLBACK_ENABLED
 * "false" turns it off. Without a key the factory behaves exactly as before. */
export function factoryAnthropicFallbackEnabled(env: NodeJS.ProcessEnv) {
  return !!env.ANTHROPIC_API_KEY?.trim() && env.FACTORY_ANTHROPIC_FALLBACK_ENABLED?.trim().toLowerCase() !== "false";
}
/** Monthly cap in USD. Empty means the default; anything invalid fails closed. */
export function factoryAnthropicMonthlyBudgetMicroUsd(env: NodeJS.ProcessEnv) {
  const raw = env.FACTORY_ANTHROPIC_MONTHLY_BUDGET_USD?.trim();
  const usd = raw ? Number(raw) : ANTHROPIC_FACTORY_DEFAULT_MONTHLY_BUDGET_USD;
  if (!Number.isFinite(usd) || usd < 0 || usd > 10000) throw Error("FACTORY_ANTHROPIC_BUDGET_INVALID");
  return Math.floor(usd * 1000000);
}
const monthWindow = (now: Date) => {
  const at = now.getTime();
  if (!Number.isFinite(at)) throw Error("FACTORY_ANTHROPIC_CLOCK_UNVERIFIED");
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { month: start.toISOString().slice(0, 7), start: start.toISOString(), end: end.toISOString() };
};
/** One permanent row: holds, unknown outcomes, overruns and settled receipts
 * (including admission receipts) survive month boundaries. */
const LEDGER_OWNER = JSON.stringify(["factory-anthropic-budget-ledger-v2", ANTHROPIC_FACTORY_ACCOUNT_SCOPE]);
const GRANT_BASE = { id: "anthropic-factory-monthly-cap", accountScope: ANTHROPIC_FACTORY_ACCOUNT_SCOPE,
  observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2100-01-01T00:00:00.000Z", verificationEvidenceId: "operator-env-FACTORY_ANTHROPIC_MONTHLY_BUDGET_USD" } as const;
const emptyState = (): SharedCreditState => ({ version: 1, grant: { ...GRANT_BASE, availableMicroUsd: 0 }, reservations: [], lastObservedAt: GRANT_BASE.observedAt });
/** Settled spend of reservations created before this month: not part of the
 * current month's cap. Earlier reserved/unknown/overrun rows still count and
 * still force reconciliation (fail closed). */
function priorMonthsSpend(state: SharedCreditState, monthStart: string) {
  let spent = 0;
  for (const row of state.reservations) if (row.status === "settled" && Date.parse(row.createdAt) < Date.parse(monthStart)) spent += row.actualMicroUsd ?? 0;
  if (!Number.isSafeInteger(spent)) throw Error("CREDIT_TOTAL_OVERFLOW");
  return spent;
}
const checkGrant = (state: SharedCreditState) => {
  const g = state.grant;
  if (!g || g.id !== GRANT_BASE.id || g.accountScope !== GRANT_BASE.accountScope || g.observedAt !== GRANT_BASE.observedAt || g.expiresAt !== GRANT_BASE.expiresAt || g.verificationEvidenceId !== GRANT_BASE.verificationEvidenceId) throw Error("FACTORY_ANTHROPIC_LEDGER_MISMATCH");
};

/** Monthly cap enforced on current-month spend + all open holds:
 * grant = cap + settled spend of earlier months, fixed for this process's
 * month. After a month boundary this process admits no new call (reserve and
 * executionWindow fail closed with CREDIT_EXPIRED) until restarted, which
 * recomputes the grant; settling and recording outcomes keep working. The cap is re-read on each start,
 * so raising/lowering it takes effect without losing any spend or receipt. */
export async function createAnthropicFactoryLedger(options: { store: DurableStore; now: () => Date; capMicroUsd: number }) {
  const { store, now } = options, month = monthWindow(now());
  if (!Number.isSafeInteger(options.capMicroUsd) || options.capMicroUsd < 0) throw Error("FACTORY_ANTHROPIC_BUDGET_INVALID");
  const raw = await store.read(LEDGER_OWNER);
  const current: SharedCreditState = raw === null ? emptyState() : JSON.parse(raw);
  checkGrant(current);
  const grant: VerifiedCreditGrant = { ...GRANT_BASE, availableMicroUsd: options.capMicroUsd + priorMonthsSpend(current, month.start) };
  const transact: CreditTransaction = async <T>(mutate: (state: SharedCreditState) => T): Promise<T> => {
    let result: T;
    await store.transact(LEDGER_OWNER, async stored => {
      const state: SharedCreditState = stored === null ? emptyState() : JSON.parse(stored);
      checkGrant(state);
      state.grant!.availableMicroUsd = grant.availableMicroUsd;
      result = structuredClone(mutate(state));
      return JSON.stringify(state);
    });
    return result!;
  };
  const ledger = createSharedOpenAiCreditLedger({ grant, now, maximumGrantObservationAgeMs: 3600000, transact });
  // The month-scoped grant only gates NEW spend. settle/markUnknown/status and
  // receipts always work, so a call that straddles midnight is never stuck.
  const sameMonth = () => { if (monthWindow(now()).month !== month.month) throw Error("CREDIT_EXPIRED"); };
  return { ...ledger,
    reserve: async (input: Parameters<typeof ledger.reserve>[0]) => { sameMonth(); return ledger.reserve(input); },
    executionWindow: async (key: string, maxMs?: number) => { sameMonth(); return ledger.executionWindow(key, maxMs); },
    /** Daily pacer view of the CURRENT UTC month: the cap is the grant, and
     * rows are this month's plus older rows still reserved/unknown (open
     * holds). The permanent row's 2026..2100 window would otherwise spread
     * the cap over 74 years. */
    paceSnapshot: async () => {
      const base = await ledger.paceSnapshot(), w = monthWindow(now()), start = Date.parse(w.start);
      return { ...base, grantMicroUsd: options.capMicroUsd, observedAt: w.start, expiresAt: w.end,
        rows: base.rows.filter(row => Date.parse(row.createdAt) >= start || row.status !== "settled") };
    } };
}
/** Read-only (no row creation): the Claude ledger's row for one key, any month.
 * Used for admission history even when the fallback is not configured. */
export async function readAnthropicFactoryReservation(store: Pick<DurableStore, "read">, key: string) {
  const raw = await store.read(LEDGER_OWNER);
  if (raw === null) return null;
  const state: SharedCreditState = JSON.parse(raw);
  checkGrant(state);
  return state.reservations.find(row => row.key === key) ?? null;
}

export const anthropicFactoryPricing = () => ({ model: ANTHROPIC_FACTORY_MODEL, inputNanoUsdPerToken: ANTHROPIC_FACTORY_PRICES[ANTHROPIC_FACTORY_MODEL].input,
  outputNanoUsdPerToken: ANTHROPIC_FACTORY_PRICES[ANTHROPIC_FACTORY_MODEL].output, validUntil: ANTHROPIC_FACTORY_PRICING_VALID_UNTIL });

/** Same shape as loadSharedCreditRuntime: { ledger, pricing }. Requires the
 * same PostgreSQL council store; no in-memory fallback. */
export async function loadAnthropicFactoryRuntime(env: NodeJS.ProcessEnv, now: () => Date, store?: DurableStore) {
  if (!factoryAnthropicFallbackEnabled(env)) throw Error("FACTORY_ANTHROPIC_FALLBACK_DISABLED");
  if (!store && env.AGENT_COUNCIL_STORAGE !== "postgres") throw Error("FACTORY_ANTHROPIC_STORAGE_REQUIRED");
  const durable = store ?? await (await import("./agent-council-store")).getCouncilStore();
  const ledger = await createAnthropicFactoryLedger({ store: durable, now, capMicroUsd: factoryAnthropicMonthlyBudgetMicroUsd(env) });
  await ledger.status();
  return { ledger, pricing: anthropicFactoryPricing() };
}
