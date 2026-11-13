import { randomUUID } from "node:crypto";
import type { FactoryJob, FactoryJobInput, FactoryOutcome } from "./software-factory-store";
import { configuredSoftwareFactoryStore as softwareFactoryStore } from "./software-factory-store-provider";
import { releaseGate, rehearsalGate, type FactoryProject, type FactoryCandidate, type FactoryEvidence } from "./software-factory";
/** deferUntil: a zero-cost blocked result may ask to be requeued (same UTC
 * month, at most 48h ahead). Without store support it stays a terminal block. */
export interface FactoryAdapterResult extends FactoryOutcome { next?: FactoryJobInput; deferUntil?: string }
export interface FactoryAdapter { execute(job: FactoryJob, context: { signal: AbortSignal; maxCostCents: number }): Promise<FactoryAdapterResult> }
export interface TrustedReleaseContext { target?: "staging" | "production"; recoveryBudget?: {verifyCents:number;rollbackCents:number}; project: FactoryProject; candidate: FactoryCandidate; evidence: FactoryEvidence[] }
export interface FactoryWorkerOptions {
  store?: typeof softwareFactoryStore; workerId?: string;
  adapters?: Partial<Record<FactoryJob["kind"], FactoryAdapter>>;
  /** Resolves evidence from trusted persisted executor results, never from request payload. */
  releaseContext?: (job: FactoryJob) => Promise<TrustedReleaseContext>;
  scheduleOwner?: string;
  discoveryReservationCents?: number;
  /** Company orders are admitted explicitly through the shared credit gate. */
  discoveryMode?: "daily" | "company-orders-only";
  scheduleCompanyOrders?: (owner: string) => Promise<void>;
  /** Operator policy, never a job payload. Stops both staging and production. */
  releaseMode?: "review-only" | "enabled";
  now?: () => Date;
}
export type FactoryTickResult = { kind: "progressed" | "idle" | "quarantined" } | { kind: "retry"; delayMs: number };
const transitions: Record<FactoryJob["kind"], FactoryJob["kind"][]> = { discover:["build"],build:["simulate"],simulate:["review","build"],review:["deploy","build"],deploy:["verify"],verify:["evaluate","rollback"],rollback:["evaluate"],evaluate:[] };
export function validateFactoryTransition(job: FactoryJob, result: FactoryAdapterResult) {
  const next = result.next;
  if(result.status==="completed" && job.kind==="deploy" && next?.kind!=="verify")throw new Error("FACTORY_VERIFICATION_REQUIRED");
  if(result.status!=="unknown" && job.recoveryCents>0 && result.costCents>job.reservedCents-job.recoveryCents)throw new Error("FACTORY_RECOVERY_ESCROW_OVERRUN");
  if (!next) return;
  if (result.status !== "completed" || next.projectId !== job.projectId || !transitions[job.kind].includes(next.kind)) throw new Error("FACTORY_INVALID_TRANSITION");
  if (["simulate","review","deploy","verify","rollback","evaluate"].includes(next.kind) && (!next.headSha || (job.kind !== "build" && job.headSha && next.headSha !== job.headSha))) throw new Error("FACTORY_VERSION_CHANGED");
  const attempts = Number(job.payload.repairAttempts ?? 0);
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > 2) throw new Error("FACTORY_REPAIR_LIMIT");
  next.payload = { ...next.payload, repairAttempts: next.kind === "build" && job.kind !== "discover" ? attempts + 1 : attempts };
  if (Number(next.payload.repairAttempts) > 2) throw new Error("FACTORY_REPAIR_LIMIT");
}
export function createSoftwareFactoryWorker(options: FactoryWorkerOptions = {}) {
  if(options.releaseMode!==undefined && !["review-only","enabled"].includes(options.releaseMode))throw Error("FACTORY_RELEASE_MODE_INVALID");
  if(options.discoveryMode!==undefined && !["daily","company-orders-only"].includes(options.discoveryMode))throw Error("FACTORY_DISCOVERY_MODE_INVALID");
  if(options.scheduleCompanyOrders!==undefined && (typeof options.scheduleCompanyOrders!=="function" || options.discoveryMode!=="company-orders-only"))throw Error("FACTORY_COMPANY_SCHEDULER_INVALID");
  const store = options.store || softwareFactoryStore;
  const workerId = options.workerId || `factory-${randomUUID()}`;
  const now = options.now || (() => new Date());
  const capabilities = () => Object.fromEntries(Object.entries(options.adapters || {}).map(([kind, adapter]) => [kind,
    typeof adapter?.execute === "function" && !(options.releaseMode === "review-only" && ["deploy", "verify", "rollback", "evaluate"].includes(kind))]));
  let maintaining = false; let busy = false; let quarantined = false; let active: AbortController | undefined; let deadline = 0;
  return {
    async maintain() {
      if (quarantined || maintaining) return;
      maintaining=true;
      try {
        if (busy && now().getTime() >= deadline) { quarantined=true; active?.abort(); }
        await store.expire();
        if (quarantined) return;
        if (!busy) {
          if(typeof store.idleState!=="function")throw Error("FACTORY_IDLE_STATE_UNVERIFIED");
          const state=await store.idleState();
          if(quarantined)return;
          if(state.kind==="unknown" || state.kind==="running" && (!Number.isFinite(Date.parse(state.leaseExpiresAt)) || Date.parse(state.leaseExpiresAt)<=now().getTime())) {
            quarantined=true;throw Error("FACTORY_IDLE_STATE_UNVERIFIED");
          }
        }
        if(busy && now().getTime()>=deadline){quarantined=true;active?.abort();}
        // Process presence only; capabilities still describe installed adapters.
        // Never claim a job or change publication readiness from a heartbeat.
        if(!quarantined && (!busy || active))await store.heartbeat(workerId,capabilities());
      } finally {maintaining=false;}
    },
    async schedule() {
      if (options.discoveryMode === "company-orders-only") {
        if(!options.scheduleCompanyOrders || !options.scheduleOwner || quarantined)return;
        const state=await store.status(options.scheduleOwner);
        if(state.paused || !state.configured)return;
        await options.scheduleCompanyOrders(options.scheduleOwner);return;
      }
      if (!options.scheduleOwner || !options.adapters?.discover) return;
      const reserve = options.discoveryReservationCents;
      if (!Number.isSafeInteger(reserve) || reserve! <= 0) throw new Error("FACTORY_DISCOVERY_COST_REQUIRED");
      const state = await store.status(options.scheduleOwner); if (state.paused || !state.configured) return;
      for (const project of await store.projects(options.scheduleOwner)) {
        await store.enqueue(options.scheduleOwner,{key:`daily:${project.id}:${now().toISOString().slice(0,10)}`,projectId:project.id,kind:"discover",reservedCents:reserve!,payload:{source:"daily"}});
      }
    },
    async tick(): Promise<FactoryTickResult> {
      if (quarantined) return { kind: "quarantined" };
      if (busy) return { kind: "retry", delayMs: 5000 }; busy=true; deadline=now().getTime()+30000;
      try {
        await store.expire(); const job = await store.claim(workerId);
        if (quarantined || now().getTime() >= deadline) { quarantined=true; return { kind: "quarantined" }; }
        if (!job) {
          // claim(undefined) also means another worker or an unknown outcome owns
          // the global slot. Only a second trusted queue check permits long sleep.
          if (typeof store.idleState !== "function") return { kind: "retry", delayMs: 5000 };
          const state = await store.idleState();
          if (state.kind === "unknown") { quarantined = true; return { kind: "quarantined" }; }
          if (state.kind === "running") {
            const remaining = Date.parse(state.leaseExpiresAt) - now().getTime();
            if (!Number.isFinite(remaining)) { quarantined = true; return { kind: "quarantined" }; }
            return { kind: "retry", delayMs: Math.max(1, Math.min(5000, remaining)) };
          }
          if (state.kind === "pendingRecovery") return { kind: "retry", delayMs: 5000 };
          return { kind: "idle" };
        }
        deadline=Date.parse(job.leaseExpiresAt || ""); if (!Number.isFinite(deadline) || deadline <= now().getTime()) {quarantined=true; return { kind: "quarantined" };}
        await store.heartbeat(workerId,capabilities());
        const block = async (reason: string): Promise<FactoryTickResult> => {
          if (!await store.complete(job, { status: "blocked", costCents: 0, reason })) quarantined = true;
          return { kind: quarantined ? "quarantined" : "progressed" };
        };
        let requiredRollbackCents: number | undefined;
        const adapter = options.adapters?.[job.kind];
        if (options.releaseMode === "review-only" && ["deploy", "verify", "rollback", "evaluate"].includes(job.kind)) {
          // A previous deployment may still need recovery. Never release its
          // escrow by completing a claimed recovery job as a zero-cost block.
          await store.complete(job,{status:"unknown",costCents:0,reason:"FACTORY_RELEASE_REQUIRES_OPERATOR_RECONCILIATION"});
          quarantined=true;return {kind:"quarantined"};
        }
        if (!adapter) return await block(`FACTORY_ADAPTER_UNAVAILABLE:${job.kind}`);
        if (job.kind === "deploy") {
          if (!options.releaseContext) return await block("FACTORY_TRUSTED_RELEASE_EVIDENCE_UNAVAILABLE");
          const context=await options.releaseContext(job); const gate=(context.target === "staging" ? rehearsalGate : releaseGate)(context.project,context.candidate,context.evidence,now().getTime());
          if (!gate.allowed || context.candidate.headSha !== job.headSha || context.project.id !== job.projectId) return await block(gate.reasons.join(",") || "FACTORY_RELEASE_IDENTITY_MISMATCH");
          const recovery=context.recoveryBudget;
          requiredRollbackCents=recovery?.rollbackCents;
          if(!recovery || ![recovery.verifyCents,recovery.rollbackCents].every(x=>Number.isSafeInteger(x)&&x>0) || job.recoveryCents!==recovery.verifyCents+recovery.rollbackCents || job.reservedCents<=job.recoveryCents) {
            return await block("FACTORY_RECOVERY_ESCROW_UNAVAILABLE");
          }
        }
        if (quarantined || now().getTime() >= deadline) { quarantined=true; return { kind: "quarantined" }; }
        active=new AbortController(); const controller=active;
        const timeout=setTimeout(() => {quarantined=true;controller.abort();},Math.max(1,deadline-now().getTime())); timeout.unref?.();
        try {
          let result: FactoryAdapterResult;
          try { result=await adapter.execute(job,{signal:controller.signal,maxCostCents:job.reservedCents-(job.recoveryCents || 0)}); }
          catch { result={status:"unknown",costCents:0,reason:"FACTORY_EXECUTION_UNCONFIRMED"}; }
          if (quarantined || controller.signal.aborted) { await store.expire(); return { kind: "quarantined" }; }
          try { validateFactoryTransition(job,result); if(job.kind==="deploy" && result.status==="completed" && result.next?.recoveryCents!==requiredRollbackCents)throw new Error("FACTORY_ROLLBACK_ESCROW_REQUIRED"); }
          catch { result={status:"unknown",costCents:0,reason:"FACTORY_INVALID_ADAPTER_RESULT"}; }
          if (options.releaseMode === "review-only" && job.kind === "review" && result.status === "completed" && result.next?.kind === "deploy") {
            const { next: _release, ...reviewed } = result;
            result = { ...reviewed, reason: "FACTORY_PR_REVIEWED_NOT_DEPLOYED" };
          }
          if (result.deferUntil !== undefined) {
            const { deferUntil, ...rest } = result, until = Date.parse(deferUntil), at = now().getTime();
            const notBefore = Number.isFinite(until) ? new Date(until).toISOString() : "";
            if (rest.status === "blocked" && rest.costCents === 0 && !rest.next && until > at && until - at <= 48 * 3600000 && notBefore.slice(0, 7) === job.month && typeof store.defer === "function") {
              if (!await store.defer(job, { reason: rest.reason || "FACTORY_DEFERRED", notBefore })) quarantined = true;
              return { kind: quarantined ? "quarantined" : "progressed" };
            }
            result = rest;
          }
          const {next,...outcome}=result;
          if (!await store.complete(job,outcome,next)) quarantined=true;
          if (outcome.status === "unknown") quarantined=true;
          return { kind: quarantined ? "quarantined" : "progressed" };
        } finally {clearTimeout(timeout);active=undefined;}
      } finally {busy=false;}
    },
    stop() { quarantined=true; active?.abort(); },
  };
}
