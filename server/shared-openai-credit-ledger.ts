import { createHash } from "node:crypto";
import { z } from "zod";

const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/);
const timestamp = z.string().datetime();
const grantSchema = z.object({
  id: identifier, accountScope: identifier, availableMicroUsd: amount,
  observedAt: timestamp, expiresAt: timestamp, verificationEvidenceId: identifier,
}).strict();
export type VerifiedCreditGrant = z.infer<typeof grantSchema>;
const reservationSchema = z.object({
  key: identifier, consumer: z.enum(["office", "factory"]), requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reservedMicroUsd: amount.refine(value => value > 0), createdAt: timestamp,
  status: z.enum(["reserved", "unknown", "settled"]),
  unknownEvidenceId: identifier.optional(), actualMicroUsd: amount.optional(),
  settlementEvidenceId: identifier.optional(), settledAt: timestamp.optional(),
  reconciled: z.boolean().optional(), executionStopped: z.literal(true).optional(),
}).strict();
export type CreditReservation = z.infer<typeof reservationSchema>;
const stateSchema = z.object({
  version: z.literal(1), grant: grantSchema.nullable(),
  lastObservedAt: timestamp.nullable(), reservations: z.array(reservationSchema).max(5000),
}).strict();
export type SharedCreditState = z.infer<typeof stateSchema>;
/** Must run against ONE durable ledger shared by BOTH consumers. Serialize or CAS
 * the entire mutation, commit only on success, and return only the winning result.
 * No external side effects inside callbacks. CAS retries must start from fresh state.
 * Missing/deleted storage must fail, never silently recreate this envelope. */
export type CreditTransaction = <T>(mutate: (state: SharedCreditState) => T) => Promise<T>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(code: string): never { throw new Error(`CREDIT_${code}`); }

/** Local admission control, not a provider billing cap. A trusted operator must
 * verify available credits after ALL earlier charges/holds and bind accountScope.
 * External spend and other keys must be fenced or reconciled before enabling this.
 * One grant only: no monthly reset, refresh, top-up, payment or automatic bootstrap.
 * Prices/max tokens must conservatively bound a call before its reservation. */
export function createSharedOpenAiCreditLedger(options: {
  grant: VerifiedCreditGrant; transact: CreditTransaction; now: () => Date;
  maximumGrantObservationAgeMs: number;
}) {
  const grant = grantSchema.parse(structuredClone(options.grant));
  const transact = options.transact, now = options.now, maximumAge = options.maximumGrantObservationAgeMs;
  if (typeof transact !== "function" || typeof now !== "function" || !Number.isSafeInteger(maximumAge) || maximumAge < 1 || maximumAge > 3600000 ||
    Date.parse(grant.expiresAt) <= Date.parse(grant.observedAt)) fail("CONFIGURATION_INVALID");

  function validate(state: SharedCreditState) {
    stateSchema.parse(state);
    if (state.grant && hash(grantSchema.parse(state.grant)) !== hash(grant)) fail("GRANT_MISMATCH");
    if (!state.grant && (state.reservations.length || state.lastObservedAt !== null)) fail("CORRUPT");
    if (state.grant && (!state.lastObservedAt || Date.parse(state.lastObservedAt) < Date.parse(grant.observedAt))) fail("CORRUPT");
    const keys = new Set<string>(), receipts = new Set<string>();
    for (const row of state.reservations) {
      if (keys.has(row.key)) fail("CORRUPT"); keys.add(row.key);
      if (Date.parse(row.createdAt) < Date.parse(grant.observedAt) || Date.parse(row.createdAt) >= Date.parse(grant.expiresAt) || Date.parse(row.createdAt) > Date.parse(state.lastObservedAt!)) fail("CORRUPT");
      if (row.status === "settled") {
        if (row.actualMicroUsd === undefined || !row.settlementEvidenceId || !row.settledAt || typeof row.reconciled !== "boolean" ||
          Date.parse(row.settledAt) < Date.parse(row.createdAt) || Date.parse(row.settledAt) > Date.parse(state.lastObservedAt!) ||
          (row.reconciled ? row.executionStopped !== true || !row.unknownEvidenceId : row.executionStopped !== undefined || row.unknownEvidenceId !== undefined)) fail("CORRUPT");
        if (receipts.has(row.settlementEvidenceId)) fail("CORRUPT"); receipts.add(row.settlementEvidenceId);
      } else if (row.actualMicroUsd !== undefined || row.settlementEvidenceId !== undefined || row.settledAt !== undefined || row.reconciled !== undefined || row.executionStopped !== undefined ||
        (row.status === "unknown" ? !row.unknownEvidenceId : row.unknownEvidenceId !== undefined)) fail("CORRUPT");
    }
  }
  function totals(state: SharedCreditState) {
    let spent = 0n, reserved = 0n;
    for (const row of state.reservations) {
      if (row.status === "settled") spent += BigInt(row.actualMicroUsd!);
      else reserved += BigInt(row.reservedMicroUsd);
    }
    if (spent + reserved > BigInt(Number.MAX_SAFE_INTEGER)) fail("TOTAL_OVERFLOW");
    return { spentMicroUsd: Number(spent), reservedMicroUsd: Number(reserved), availableMicroUsd: Math.max(0, grant.availableMicroUsd - Number(spent + reserved)),
      uncertain: state.reservations.some(row => row.status === "unknown"), overrun: state.reservations.some(row => row.status === "settled" && row.actualMicroUsd! > row.reservedMicroUsd) };
  }
  async function transaction<T>(change: (state: SharedCreditState, at: string) => T, bootstrap = false) {
    return transact(state => {
      validate(state);
      const date = now(), millis = date.getTime();
      if (!Number.isFinite(millis) || (state.lastObservedAt && millis < Date.parse(state.lastObservedAt))) fail("CLOCK_UNVERIFIED");
      if (!bootstrap && !state.grant) fail("NOT_INITIALIZED");
      const at = date.toISOString();
      const result = change(state, at);
      state.lastObservedAt = at;
      validate(state); totals(state);
      return structuredClone(result);
    });
  }
  return {
    async initialize() {
      return transaction((state, at) => {
        if (state.grant) return;
        const age = Date.parse(at) - Date.parse(grant.observedAt);
        if (age < 0 || age > maximumAge || Date.parse(at) >= Date.parse(grant.expiresAt)) fail("GRANT_NOT_FRESH");
        state.grant = structuredClone(grant);
      }, true);
    },
    async status() {
      return transaction((state, at) => ({ grantId: grant.id, ...totals(state), expired: Date.parse(at) >= Date.parse(grant.expiresAt) }));
    },
    /** Trusted consumers can verify one already-settled receipt. Reading it
     * grants no execution authority and never releases an uncertain hold. */
    async settledReceipt(key: string) {
      identifier.parse(key);
      return transaction(state => {
        const row=state.reservations.find(item=>item.key===key);
        if(!row || row.status!=="settled")fail("SETTLED_RECEIPT_REQUIRED");
        return row;
      });
    },
    async executionWindow(key: string) {
      identifier.parse(key);
      await transaction((state, at) => {
        if (state.reservations.find(row => row.key === key)?.status !== "reserved") fail("RESERVATION_UNAVAILABLE");
        const budget = totals(state);
        if (budget.uncertain || budget.overrun) fail("RECONCILIATION_REQUIRED");
        if (Date.parse(at) >= Date.parse(grant.expiresAt)) fail("EXPIRED");
      });
      // Recheck after the durable transaction returns, not before its I/O wait.
      const remainingMs = Date.parse(grant.expiresAt) - now().getTime();
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) fail("EXPIRED");
      return Math.min(remainingMs, 120000);
    },
    async reserve(input: { key: string; consumer: "office" | "factory"; requestSha256: string; maximumMicroUsd: number }) {
      const data = z.object({ key: identifier, consumer: z.enum(["office", "factory"]), requestSha256: z.string().regex(/^[a-f0-9]{64}$/), maximumMicroUsd: amount.refine(value => value > 0) }).strict().parse(input);
      return transaction((state, at) => {
        const existing = state.reservations.find(row => row.key === data.key);
        if (existing) {
          if (existing.consumer !== data.consumer || existing.requestSha256 !== data.requestSha256 || existing.reservedMicroUsd !== data.maximumMicroUsd) fail("IDEMPOTENCY_CONFLICT");
          // An existing receipt NEVER authorizes execution again, even after a
          // lost reserve acknowledgement. Reconcile that call explicitly.
          return { admitted: false, reservation: existing };
        }
        const budget = totals(state);
        if (Date.parse(at) >= Date.parse(grant.expiresAt)) fail("EXPIRED");
        if (budget.uncertain || budget.overrun) fail("RECONCILIATION_REQUIRED");
        if (data.maximumMicroUsd > budget.availableMicroUsd) fail("UNAVAILABLE");
        if (state.reservations.length >= 5000) fail("CAPACITY_REQUIRED");
        const row: CreditReservation = { key: data.key, consumer: data.consumer, requestSha256: data.requestSha256,
          reservedMicroUsd: data.maximumMicroUsd, createdAt: at, status: "reserved" };
        state.reservations.push(row);
        return { admitted: true, reservation: row };
      });
    },
    async markUnknown(key: string, evidenceId: string) {
      identifier.parse(key); identifier.parse(evidenceId);
      return transaction(state => {
        const row = state.reservations.find(item => item.key === key);
        if (!row || row.status === "settled") fail("RESERVATION_UNAVAILABLE");
        if (row.unknownEvidenceId && row.unknownEvidenceId !== evidenceId) fail("IDEMPOTENCY_CONFLICT");
        row.status = "unknown"; row.unknownEvidenceId = evidenceId;
      });
    },
    async settle(input: { key: string; actualMicroUsd: number; evidenceId: string; reconciliation?: { executionStopped: true } }) {
      const data = z.object({ key: identifier, actualMicroUsd: amount, evidenceId: identifier,
        reconciliation: z.object({ executionStopped: z.literal(true) }).strict().optional() }).strict().parse(input);
      return transaction((state, at) => {
        const row = state.reservations.find(item => item.key === data.key);
        if (!row) fail("RESERVATION_UNAVAILABLE");
        if (row.status === "settled") {
          if (row.actualMicroUsd !== data.actualMicroUsd || row.settlementEvidenceId !== data.evidenceId || row.reconciled !== !!data.reconciliation) fail("IDEMPOTENCY_CONFLICT");
          return;
        }
        if ((row.status === "unknown") !== !!data.reconciliation) fail("STOPPED_RECONCILIATION_REQUIRED");
        row.status = "settled"; row.actualMicroUsd = data.actualMicroUsd; row.settlementEvidenceId = data.evidenceId;
        row.settledAt = at; row.reconciled = !!data.reconciliation;
        if (data.reconciliation) row.executionStopped = true;
        // Record real overruns rather than discarding paid usage. Subsequent
        // admissions fail closed; unknown/overspend cannot manufacture credits.
      });
    },
  };
}
