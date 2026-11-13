import { randomUUID } from "node:crypto";
import type { OfficeOpenAIResult } from "./office-openai";

export type OfficeTokenReservation = {
  id: string; month: string; model: string; reservedTokens: number; createdAt: string;
  status: "reserved" | "accounted";
  result?: Omit<OfficeOpenAIResult, "text">;
};
export type OfficeTokenBudgetState = { reservations: OfficeTokenReservation[] };
export class OfficeTokenBudgetError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "OfficeTokenBudgetError"; }
}
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
function validate(state: OfficeTokenBudgetState) {
  if (!state || !Array.isArray(state.reservations)) throw new OfficeTokenBudgetError("invalid_budget_state");
  const ids = new Set<string>(); const responses = new Set<string>();
  for (const row of state.reservations) {
    if (!row || !row.id || ids.has(row.id) || !/^\d{4}-\d{2}$/.test(row.month) || !row.model ||
      !integer(row.reservedTokens) || row.reservedTokens < 1 || !Number.isFinite(Date.parse(row.createdAt)) ||
      !["reserved", "accounted"].includes(row.status)) throw new OfficeTokenBudgetError("invalid_budget_state");
    ids.add(row.id);
    if (row.status === "reserved" && row.result !== undefined) throw new OfficeTokenBudgetError("invalid_budget_state");
    if (row.status === "accounted") {
      const r = row.result; const u = r?.usage;
      if (!r || r.provider !== "openai" || !r.sessionId?.startsWith("resp_") || responses.has(r.sessionId) || !r.model ||
        !Number.isFinite(Date.parse(r.completedAt)) || !u || !Object.values(u).every(integer) ||
        !integer(u.inputTokens) || !integer(u.outputTokens) || !integer(u.totalTokens) || u.totalTokens !== u.inputTokens + u.outputTokens) throw new OfficeTokenBudgetError("invalid_budget_state");
      responses.add(r.sessionId);
    }
  }
}

// The injected transaction must persist atomically (database lock or CAS).
// Never connect this to an unguarded in-memory cache or a best-effort file write.
export function createOfficeTokenBudget(options: {
  transact: (mutate: (state: OfficeTokenBudgetState) => void) => Promise<void>;
  limit: number; now?: () => Date;
}) {
  if (!integer(options.limit) || options.limit < 1) throw new OfficeTokenBudgetError("explicit_token_limit_required");
  const now = options.now || (() => new Date());
  return {
    async reserve(input: { model: string; promptBytes: number; maxOutputTokens: number }): Promise<string> {
      if (!input.model || !integer(input.promptBytes) || input.promptBytes < 1 || input.promptBytes > 65536 ||
        !integer(input.maxOutputTokens) || input.maxOutputTokens < 32 || input.maxOutputTokens > 4096) throw new OfficeTokenBudgetError("invalid_token_reservation");
      const createdAt = now().toISOString(); const month = createdAt.slice(0, 7); const id = randomUUID();
      // UTF-8 byte count bounds prompt tokens conservatively; retain extra room
      // for request framing. Actual metered usage is always recorded afterward.
      const reservedTokens = input.promptBytes + input.maxOutputTokens + 1024;
      await options.transact(state => {
        validate(state);
        if (state.reservations.some(row => row.id === id)) return;
        const spent = state.reservations.reduce((sum, row) => sum + (row.status === "reserved" ? row.reservedTokens : row.month === month ? row.result!.usage.totalTokens : 0), 0);
        if (!Number.isSafeInteger(spent) || spent + reservedTokens > options.limit) throw new OfficeTokenBudgetError("token_budget_exhausted");
        state.reservations.push({ id, month, model: input.model, reservedTokens, createdAt, status: "reserved" });
      });
      return id;
    },
    async recordUsage(id: string, result: Omit<OfficeOpenAIResult, "text">): Promise<void> {
      await options.transact(state => {
        validate(state);
        const row = state.reservations.find(r => r.id === id);
        if (!row) throw new OfficeTokenBudgetError("reservation_missing");
        if (row.status === "accounted") {
          if (JSON.stringify(row.result) !== JSON.stringify(result)) throw new OfficeTokenBudgetError("accounting_conflict");
          return;
        }
        // Snapshot result so subsequent caller mutation cannot alter accounting.
        row.result = JSON.parse(JSON.stringify(result)); row.status = "accounted";
        validate(state);
      });
    },
  };
}
