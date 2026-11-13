import { createHash } from "node:crypto";
import { FACTORY_POLICY } from "./software-factory";
import { createFactoryPipeline, type FactoryPipelineDependencies, type FactoryPipelineState } from "./software-factory-pipeline";
import { factoryJobKinds, type FactoryJob } from "./software-factory-store";
import { configuredSoftwareFactoryStore as softwareFactoryStore } from "./software-factory-store-provider";
import type { FactoryAdapter, FactoryWorkerOptions } from "./software-factory-worker";

export type TrustedFactoryStages = Required<Pick<FactoryPipelineDependencies, typeof factoryJobKinds[number]>>;
export interface FactoryRuntimeOptions {
  owner: string;
  stages: TrustedFactoryStages;
  reservations: FactoryPipelineDependencies["reservations"];
  store?: typeof softwareFactoryStore & { releaseHistory?(owner: string, projectId: string): Promise<FactoryJob[]> };
  promoteLearning?: FactoryPipelineDependencies["promoteLearning"];
  now?: () => Date;
}

/** Owner-scoped recent history only; ambiguous or superseded releases are not current. */
export function currentFactoryProductionDeployment(jobs: readonly FactoryJob[], projectId: string): FactoryJob | undefined {
  const releases = jobs.slice(0, 100).filter(job => job.projectId === projectId && ["deploy", "rollback"].includes(job.kind));
  if (new Set(releases.map(job => job.ownerKey)).size > 1 || releases.some(job => ["running", "unknown"].includes(job.status))) return undefined;
  const state = (job: FactoryJob) => (job.result as { evidence?: { pipelineState?: FactoryPipelineState } } | undefined)?.evidence?.pipelineState;
  const completed = releases.filter(job => job.status === "completed");
  if (completed.some(job => !state(job) || !Number.isFinite(Date.parse(job.completedAt ?? "")))) return undefined;
  const production = completed.filter(job => state(job)?.target === "production").sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!));
  const latest = production[0];
  if (!latest || latest.kind !== "deploy" || (production[1] && Date.parse(latest.completedAt!) === Date.parse(production[1].completedAt!))) return undefined;
  const s = state(latest)!;
  if (s.projectId !== projectId || s.candidate?.projectId !== projectId || !s.deployment?.id || s.deployment.target !== "production" || s.deployment.headSha !== latest.headSha || s.candidate.headSha !== latest.headSha) return undefined;
  return latest;
}

/** Compose operator-installed callbacks only. This does not supply providers,
 * migrate storage, authorize release, initialize costs, or unpause the factory. */
export async function createTrustedFactoryWorkerOptions(options: FactoryRuntimeOptions): Promise<FactoryWorkerOptions> {
  if (typeof options.owner !== "string" || !options.owner.trim()) throw new Error("FACTORY_OWNER_REQUIRED");
  const owner = options.owner;
  const expectedKey = createHash("sha256").update(owner).digest("hex");
  const scope = (key: string) => { if (key !== expectedKey) throw new Error("FACTORY_RUNTIME_OWNER_MISMATCH"); };
  const stages = { ...options.stages };
  const reservations = { ...options.reservations };
  for (const kind of factoryJobKinds) {
    if (typeof stages[kind] !== "function") throw new Error(`FACTORY_STAGE_REQUIRED:${kind}`);
    if (!Number.isSafeInteger(reservations[kind]) || reservations[kind] < 1 || reservations[kind] > FACTORY_POLICY.monthlyLimitCents) throw new Error(`FACTORY_RESERVATION_INVALID:${kind}`);
  }
  if (reservations.deploy + reservations.verify + reservations.rollback > FACTORY_POLICY.monthlyLimitCents) throw new Error("FACTORY_RECOVERY_RESERVATION_INVALID");
  if (options.promoteLearning !== undefined && typeof options.promoteLearning !== "function") throw new Error("FACTORY_LEARNING_ADAPTER_INVALID");
  Object.freeze(reservations);
  const store: NonNullable<FactoryRuntimeOptions["store"]> = options.store ?? softwareFactoryStore;
  const status = await store.status(owner);
  if (!status.configured) throw new Error("FACTORY_FIXED_COST_RESERVATION_REQUIRED");
  if (status.limitCents !== FACTORY_POLICY.monthlyLimitCents || ![status.fixedCents, status.spentCents, status.reservedCents].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("FACTORY_BUDGET_UNVERIFIED");
  const pipeline = createFactoryPipeline({
    ...stages, reservations, now: options.now, promoteLearning: options.promoteLearning,
    project: async (key, id) => { scope(key); return store.projectByOwnerKey(key, id); },
    previous: async (key, id) => { scope(key); return store.getCompletedJob(key, id); },
    isCurrentDeployment: async (key, projectId, deployJobId) => {
      scope(key);
      if (!store.releaseHistory) return false;
      const jobs = await store.releaseHistory(owner, projectId);
      if (jobs.some(job => job.ownerKey !== key)) return false;
      return currentFactoryProductionDeployment(jobs, projectId)?.id === deployJobId;
    },
    claimFinding: async (key, projectId, findingKey, jobId) => { scope(key); return store.claimFinding(key, projectId, findingKey, jobId); },
    recordValidation: async (key, projectId, jobId) => { scope(key); await store.recordValidation(key, projectId, jobId); },
  });
  if (!pipeline.readiness().ready) throw new Error("FACTORY_PIPELINE_UNAVAILABLE");
  return {
    store, scheduleOwner: owner, discoveryReservationCents: reservations.discover, now: options.now,
    adapters: Object.fromEntries(factoryJobKinds.map(kind => [kind, {
      execute: async (...[job, context]: Parameters<FactoryAdapter["execute"]>) => {
        scope(job.ownerKey);
        return pipeline.adapters![kind]!.execute(job, context);
      },
    }])) as FactoryWorkerOptions["adapters"],
    releaseContext: async job => { scope(job.ownerKey); return pipeline.releaseContext!(job); },
  };
}

export type FactoryProposalRuntimeOptions=Pick<FactoryRuntimeOptions,"owner"|"store"|"now"> & {
  recoveryPrevious?: FactoryPipelineDependencies['recoveryPrevious'];
  scheduleCompanyOrders?: FactoryWorkerOptions["scheduleCompanyOrders"];
  stages:Required<Pick<FactoryPipelineDependencies,"discover"|"build"|"simulate"|"review">>;
  reservations:Record<"discover"|"build"|"simulate"|"review",number>;
};
/** Actual four-stage composition: no dummy deployment callbacks or release claims. */
export async function createTrustedFactoryProposalWorkerOptions(options:FactoryProposalRuntimeOptions):Promise<FactoryWorkerOptions>{
  if(!options.owner?.trim())throw Error("FACTORY_OWNER_REQUIRED");
  const owner=options.owner,key=createHash("sha256").update(owner).digest("hex");
  const scope=(actual:string)=>{if(actual!==key)throw Error("FACTORY_RUNTIME_OWNER_MISMATCH");};
  const kinds=["discover","build","simulate","review"] as const;
  for(const kind of kinds){if(typeof options.stages[kind]!=="function")throw Error(`FACTORY_STAGE_REQUIRED:${kind}`);if(!Number.isSafeInteger(options.reservations[kind]) || options.reservations[kind]<1 || options.reservations[kind]>FACTORY_POLICY.monthlyLimitCents)throw Error(`FACTORY_RESERVATION_INVALID:${kind}`);}
  const store=options.store || softwareFactoryStore,status=await store.status(owner);
  if(!status.configured)throw Error("FACTORY_FIXED_COST_RESERVATION_REQUIRED");
  if(status.limitCents!==FACTORY_POLICY.monthlyLimitCents || ![status.fixedCents,status.spentCents,status.reservedCents].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error("FACTORY_BUDGET_UNVERIFIED");
  // Zero denotes disabled stages, not an allowance or a working adapter.
  const reservations={...options.reservations,deploy:0,verify:0,rollback:0,evaluate:0};
  const pipeline=createFactoryPipeline({...Object.fromEntries(kinds.map(kind=>[kind,options.stages[kind]])),executionMode:"review-only",reservations,now:options.now,
    recoveryPrevious:options.recoveryPrevious ? async(actual,id,jobId)=>{scope(actual);return options.recoveryPrevious!(actual,id,jobId);} : undefined,
    project:async(actual,id)=>{scope(actual);return store.projectByOwnerKey(actual,id);},
    previous:async(actual,id)=>{scope(actual);return store.getCompletedJob(actual,id);},
    claimFinding:async(actual,id,finding,job)=>{scope(actual);return store.claimFinding(actual,id,finding,job);},
  });
  if(!pipeline.readiness().ready)throw Error("FACTORY_PIPELINE_UNAVAILABLE");
  return {store,scheduleOwner:owner,scheduleCompanyOrders:options.scheduleCompanyOrders,discoveryMode:"company-orders-only",releaseMode:"review-only",discoveryReservationCents:reservations.discover,now:options.now,
    adapters:Object.fromEntries(kinds.map(kind=>[kind,{execute:async(...[job,context]:Parameters<FactoryAdapter["execute"]>)=>{scope(job.ownerKey);return pipeline.adapters![kind]!.execute(job,context);}}]))};
}


/** Entry-point guard for any operator-installed module, including custom ones. */
export function validateFactoryWorkerOptions(config: unknown): asserts config is FactoryWorkerOptions {
  if (config === null || typeof config !== "object") throw new Error("FACTORY_WORKER_CONFIGURATION_REQUIRED");
  const value = config as Record<string, unknown>;
  if(value.releaseMode!==undefined && !["review-only","enabled"].includes(value.releaseMode as string))throw Error("FACTORY_RELEASE_MODE_INVALID");
  if(value.discoveryMode!==undefined && !["daily","company-orders-only"].includes(value.discoveryMode as string))throw Error("FACTORY_DISCOVERY_MODE_INVALID");
  if(value.scheduleCompanyOrders!==undefined && (typeof value.scheduleCompanyOrders!=="function" || value.discoveryMode!=="company-orders-only"))throw Error("FACTORY_COMPANY_SCHEDULER_INVALID");
  if (value.adapters === null || typeof value.adapters !== "object") throw new Error("FACTORY_EXECUTORS_UNAVAILABLE");
  const adapters = value.adapters as Record<string, unknown>;
  const proposalOnly=value.releaseMode==="review-only";
  if(proposalOnly && value.discoveryMode!=="company-orders-only")throw Error("FACTORY_EXPLICIT_ORDERS_REQUIRED");
  for (const kind of proposalOnly?["discover","build","simulate","review"]:factoryJobKinds) {
    const adapter = adapters[kind];
    if (adapter === null || typeof adapter !== "object" || typeof (adapter as Record<string, unknown>).execute !== "function") throw new Error(`FACTORY_STAGE_REQUIRED:${kind}`);
  }
  if (!proposalOnly && typeof value.releaseContext !== "function") throw new Error("FACTORY_TRUSTED_RELEASE_EVIDENCE_UNAVAILABLE");
  const reserve = value.discoveryReservationCents;
  if (typeof reserve !== "number" || !Number.isSafeInteger(reserve) || reserve < 1 || reserve > FACTORY_POLICY.monthlyLimitCents) throw new Error("FACTORY_DISCOVERY_COST_REQUIRED");
}
