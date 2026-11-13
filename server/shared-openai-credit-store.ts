import type { createCouncilStore } from "./agent-council-store";
import type { CreditTransaction, SharedCreditState } from "./shared-openai-credit-ledger";

type DurableStore = Pick<ReturnType<typeof createCouncilStore>, "transact">;
const namespace = (accountScope: string) => {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(accountScope)) throw Error("CREDIT_ACCOUNT_SCOPE_INVALID");
  return JSON.stringify(["shared-openai-credit-ledger-v1", accountScope]);
};

/** Uses the existing PostgreSQL row-lock transaction under a separate namespace.
 * Never reads/writes the user's council row, creates tables, or falls back to RAM. */
export function createSharedCreditTransaction(store: DurableStore, accountScope: string): CreditTransaction {
  const owner = namespace(accountScope);
  return async <T>(mutate: (state: SharedCreditState) => T): Promise<T> => {
    let result: T;
    await store.transact(owner, async raw => {
      if (raw === null) throw Error("CREDIT_STORAGE_NOT_PROVISIONED");
      const state = JSON.parse(raw) as SharedCreditState;
      if (state.grant && state.grant.accountScope !== accountScope) throw Error("CREDIT_STORAGE_SCOPE_MISMATCH");
      result = structuredClone(mutate(state));
      if (state.grant && state.grant.accountScope !== accountScope) throw Error("CREDIT_STORAGE_SCOPE_MISMATCH");
      return JSON.stringify(state);
    });
    return result!;
  };
}

/** Operator-only first installation. Do not call from startup, retry/recovery,
 * or requests: a missing previously initialized ledger must remain blocked. */
export async function provisionSharedCreditStorage(store: DurableStore, accountScope: string): Promise<void> {
  await store.transact(namespace(accountScope), async raw => {
    if (raw !== null) throw Error("CREDIT_STORAGE_ALREADY_EXISTS");
    return JSON.stringify({ version: 1, grant: null, reservations: [], lastObservedAt: null } satisfies SharedCreditState);
  });
}
