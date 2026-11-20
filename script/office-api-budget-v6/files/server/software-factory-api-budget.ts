import { z } from "zod";

/** Monetary amounts are integer microUSD. Grants are secondary provider
 * constraints, never deposits into this monthly allowance. No I/O or bootstrap. */
export const FACTORY_API_LIMIT_MICRO_USD = 100_000_000;
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const instant = z.string().datetime();
const checkpointSchema = z.object({ month, evidenceSha256: sha, reconciledAt: instant,
  externalSpentMicroUsd: amount, externalReservedMicroUsd: amount, externalUnknownReservations: amount,
  complete: z.literal(true) }).strict();
const parentSchema = z.object({ jobId: z.string().uuid(), fence: z.string().uuid() }).strict();
export const factoryApiReservationSchema = z.object({ key: z.string().min(1).max(200), requestSha256: sha,
  maximumMicroUsd: amount.refine(n => n > 0 && n <= FACTORY_API_LIMIT_MICRO_USD),
  consumer: z.enum(["office", "academy", "clippers", "router", "other"]),
  parent: parentSchema.optional() }).strict();
const rowSchema = factoryApiReservationSchema.extend({ month, createdAt: instant,
  status: z.enum(["reserved", "settled", "unknown"]), actualMicroUsd: amount.optional(),
  settledAt: instant.optional(), evidenceSha256: sha.optional(), reportedOverrunMicroUsd: amount.optional(), overrunEvidenceSha256: sha.optional() }).strict();
export const factoryApiStateSchema = z.object({ version: z.literal(1),
  checkpoints: z.array(checkpointSchema), reservations: z.array(rowSchema) }).strict();
export type FactoryApiState = z.infer<typeof factoryApiStateSchema>;
export type FactoryApiReservation = z.input<typeof factoryApiReservationSchema>;
export type FactoryApiCheckpoint = z.input<typeof checkpointSchema>;
export type FactoryApiExposure = { configured: boolean; fixedCents: number; spentCents: number;
  reservedCents: number; unknown: boolean; parents: Array<{ jobId: string; fence?: string;
    status: string; maximumCents: number; leaseExpiresAt?: string }> };
export const emptyFactoryApiState = (): FactoryApiState => ({version: 1, checkpoints: [], reservations: []});
const safeSum = (values: number[]) => { const result = values.reduce((a,b) => a+b,0);
  if (!Number.isSafeInteger(result)) throw Error("FACTORY_API_AMOUNT_OVERFLOW"); return result; };
export function parseFactoryApiState(value: unknown): FactoryApiState {
  const state = factoryApiStateSchema.parse(value);
  if (new Set(state.checkpoints.map(c=>c.month)).size !== state.checkpoints.length ||
      new Set(state.reservations.map(r=>r.key)).size !== state.reservations.length) throw Error("FACTORY_API_LEDGER_CORRUPT");
  for (const row of state.reservations) {
    if ((row.reportedOverrunMicroUsd!==undefined || row.overrunEvidenceSha256!==undefined) &&
        (row.status!=="unknown" || !row.overrunEvidenceSha256 || row.reportedOverrunMicroUsd===undefined || row.reportedOverrunMicroUsd<=row.maximumMicroUsd)) throw Error("FACTORY_API_LEDGER_CORRUPT");
    if (row.status === "settled" && (row.actualMicroUsd === undefined || !row.settledAt || !row.evidenceSha256 || row.actualMicroUsd > row.maximumMicroUsd)) throw Error("FACTORY_API_LEDGER_CORRUPT");
    if (row.status !== "settled" && (row.actualMicroUsd !== undefined || row.settledAt || row.evidenceSha256)) throw Error("FACTORY_API_LEDGER_CORRUPT");
  }
  return state;
}
export function factoryApiBudgetStatus(state: FactoryApiState, exposure: FactoryApiExposure, now: string) {
  instant.parse(now); state = parseFactoryApiState(state);
  const period = now.slice(0,7), checkpoint = state.checkpoints.find(c=>c.month===period);
  for (const n of [exposure.fixedCents, exposure.spentCents, exposure.reservedCents]) amount.parse(n);
  const own = state.reservations.filter(r=>!r.parent);
  const spentMicroUsd = safeSum([exposure.spentCents * 10000, checkpoint?.externalSpentMicroUsd ?? 0,
    ...own.filter(r=>r.status==="settled" && (r.month===period || r.settledAt!.slice(0,7)===period)).map(r=>r.actualMicroUsd!)]);
  const reservedMicroUsd = safeSum([exposure.reservedCents * 10000, ...state.checkpoints.map(c=>c.externalReservedMicroUsd),
    ...own.filter(r=>r.status!=="settled").map(r=>Math.max(r.maximumMicroUsd,r.reportedOverrunMicroUsd??0))]);
  const fixedMicroUsd = exposure.fixedCents*10000;
  const unknown = exposure.unknown || state.checkpoints.some(c=>c.externalUnknownReservations>0) || state.reservations.some(r=>r.status==="unknown");
  const configured = exposure.configured && !!checkpoint;
  const used = safeSum([fixedMicroUsd,spentMicroUsd,reservedMicroUsd]);
  return {month:period, limitMicroUsd:FACTORY_API_LIMIT_MICRO_USD, fixedMicroUsd, spentMicroUsd,
    reservedMicroUsd, remainingMicroUsd:configured ? Math.max(0,FACTORY_API_LIMIT_MICRO_USD-used) : null,
    configured, unknown, paidAdmissionReady:configured && !unknown && used<FACTORY_API_LIMIT_MICRO_USD,
    reason:!exposure.configured ? "FACTORY_MONTH_UNINITIALIZED" : !checkpoint ? "FACTORY_API_RECONCILIATION_REQUIRED" : unknown ? "FACTORY_API_UNKNOWN_HOLD" : used>=FACTORY_API_LIMIT_MICRO_USD ? "FACTORY_API_BUDGET_EXHAUSTED" : "FACTORY_API_READY",
    reconciliationEvidenceSha256:checkpoint?.evidenceSha256 ?? null};
}
/** Explicit operator-only checkpoint; callers must first prove all external
 * historical spend/holds. The application never infers completeness from absence. */
export function checkpointFactoryApiMonth(state: FactoryApiState, exposure: FactoryApiExposure, raw: FactoryApiCheckpoint, now: string) {
  const input = checkpointSchema.parse(raw); instant.parse(now);
  if (!exposure.configured || input.month!==now.slice(0,7) || input.reconciledAt>now || exposure.unknown) throw Error("FACTORY_API_CHECKPOINT_UNPROVEN");
  const prior = state.checkpoints.find(c=>c.month===input.month);
  if (prior && JSON.stringify(prior)!==JSON.stringify(input)) throw Error("FACTORY_API_CHECKPOINT_IMMUTABLE");
  if (!prior) state.checkpoints.push(input);
  factoryApiBudgetStatus(state,exposure,now);
}
export function reserveFactoryApi(state: FactoryApiState, exposure: FactoryApiExposure, raw: FactoryApiReservation, now: string) {
  const input = factoryApiReservationSchema.parse(raw), prior = state.reservations.find(r=>r.key===input.key);
  if (prior) {
    const {month:_m,createdAt:_c,status:_s,actualMicroUsd:_a,settledAt:_t,evidenceSha256:_e,reportedOverrunMicroUsd:_o,overrunEvidenceSha256:_oe,...original} = prior;
    if (JSON.stringify(original)!==JSON.stringify(input)) throw Error("FACTORY_API_IDEMPOTENCY_CONFLICT");
    return {admitted:false, reservation:prior}; // A durable prior is NEVER a dispatch permit.
  }
  const status = factoryApiBudgetStatus(state,exposure,now);
  if (!status.configured || status.unknown || (!input.parent && !status.paidAdmissionReady)) throw Error(status.reason);
  if (input.parent) {
    if(safeSum([status.fixedMicroUsd,status.spentMicroUsd,status.reservedMicroUsd])>status.limitMicroUsd) throw Error("FACTORY_API_BUDGET_EXHAUSTED");
    const p=exposure.parents.find(p=>p.jobId===input.parent!.jobId && p.fence===input.parent!.fence);
    if (!p || p.status!=="running" || !p.leaseExpiresAt || p.leaseExpiresAt<=now) throw Error("FACTORY_API_PARENT_FENCE_REQUIRED");
    const allocated=safeSum(state.reservations.filter(r=>r.parent?.jobId===p.jobId).map(r=>r.status==="settled"?r.actualMicroUsd!:r.maximumMicroUsd));
    if (allocated+input.maximumMicroUsd>p.maximumCents*10000) throw Error("FACTORY_API_PARENT_ESCROW_EXHAUSTED");
  } else if (input.maximumMicroUsd>status.remainingMicroUsd!) throw Error("FACTORY_API_BUDGET_EXHAUSTED");
  const row: FactoryApiState["reservations"][number]={...input,month:status.month,createdAt:now,status:"reserved"};
  state.reservations.push(row); return {admitted:true,reservation:row};
}
export function settleFactoryApi(state: FactoryApiState, key: string, raw: {actualMicroUsd:number;evidenceSha256:string}, now: string) {
  const input=z.object({actualMicroUsd:amount,evidenceSha256:sha}).strict().parse(raw); instant.parse(now);
  const row=state.reservations.find(r=>r.key===key);
  if (!row) throw Error("FACTORY_API_RESERVATION_REQUIRED");
  if (row.status==="settled") {
    if (row.actualMicroUsd!==input.actualMicroUsd || row.evidenceSha256!==input.evidenceSha256) throw Error("FACTORY_API_SETTLEMENT_CONFLICT");
    return;
  }
  if (row.status!=="reserved") throw Error("FACTORY_API_UNKNOWN_REQUIRES_RECONCILIATION");
  if (input.actualMicroUsd>row.maximumMicroUsd) {
    Object.assign(row,{status:"unknown",reportedOverrunMicroUsd:input.actualMicroUsd,overrunEvidenceSha256:input.evidenceSha256});
    return {settled:false,reason:"FACTORY_API_RESERVATION_OVERRUN" as const};
  }
  Object.assign(row,input,{status:"settled",settledAt:now});
  return {settled:true};
}
export function unknownFactoryApi(state: FactoryApiState,key:string) {
  const row=state.reservations.find(r=>r.key===key); if (!row) throw Error("FACTORY_API_RESERVATION_REQUIRED");
  if(row.status!=="settled") row.status="unknown";
}

/** Existing Factory work still uses its original cents escrow. Once the API
 * authority exists, new positive escrows share its exact remaining capacity. */
export function assertFactoryApiJobAdmission(state: FactoryApiState, exposure: FactoryApiExposure, maximumCents: number, now: string) {
  amount.parse(maximumCents);
  const status=factoryApiBudgetStatus(state,exposure,now);
  if (!status.paidAdmissionReady || maximumCents*10000>status.remainingMicroUsd!) throw Error(status.paidAdmissionReady?"FACTORY_API_BUDGET_EXHAUSTED":status.reason);
}
/** A parent cannot free its monetary escrow while a child outcome is unknown,
 * nor settle for less than all its exact verified children already consumed. */
export function assertFactoryApiParentSettlement(state:FactoryApiState,jobId:string,status:string,costCents:number) {
  if(status==="unknown")return;
  const children=state.reservations.filter(r=>r.parent?.jobId===jobId);
  if(children.some(r=>r.status!=="settled"))throw Error("FACTORY_API_PARENT_CHILD_UNCONFIRMED");
  const actual=safeSum(children.map(r=>r.actualMicroUsd!));
  if(costCents*10000<actual)throw Error("FACTORY_API_PARENT_COST_UNDERSTATED");
}

/** A dispatch permit is short lived and must be rechecked immediately before
 * the single provider operation. A reserved row is not a reusable bearer token. */
export function factoryApiExecutionWindow(state:FactoryApiState,exposure:FactoryApiExposure,key:string,now:string){
 const status=factoryApiBudgetStatus(state,exposure,now),row=state.reservations.find(r=>r.key===key);
 if(!row||row.status!=="reserved")throw Error("FACTORY_API_EXECUTION_NOT_RESERVED");
 if(!status.configured||status.unknown)throw Error(status.reason);
 if(safeSum([status.fixedMicroUsd,status.spentMicroUsd,status.reservedMicroUsd])>status.limitMicroUsd)throw Error("FACTORY_API_BUDGET_EXHAUSTED");
 const age=Date.parse(now)-Date.parse(row.createdAt);if(!Number.isFinite(age)||age<0||age>=120000)throw Error("FACTORY_API_DISPATCH_WINDOW_EXPIRED");
 let remaining=120000-age;
 if(row.parent){const p=exposure.parents.find(p=>p.jobId===row.parent!.jobId&&p.fence===row.parent!.fence);
  if(!p||p.status!=="running"||!p.leaseExpiresAt)throw Error("FACTORY_API_PARENT_FENCE_REQUIRED");
  remaining=Math.min(remaining,Date.parse(p.leaseExpiresAt)-Date.parse(now));
 }
 if(!Number.isFinite(remaining)||remaining<1)throw Error("FACTORY_API_DISPATCH_WINDOW_EXPIRED");return Math.floor(remaining);
}
