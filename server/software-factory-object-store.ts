import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { factoryJobKinds, type FactoryJob, type FactoryJobInput, type FactoryOutcome, type softwareFactoryStore } from "./software-factory-store";
import type { FactoryProject } from "./software-factory";

export interface FactoryObjectTransport {
  /** Bytes and generation MUST describe the same immutable object snapshot. */
  read(): Promise<{ generation: string; body: string } | undefined>;
  /** null is create-only (ifGenerationMatch=0), never an unconditional write. */
  compareAndSwap(expectedGeneration: string | null, body: string): Promise<{ kind: "written"; generation: string } | { kind: "conflict" }>;
}
export interface FactoryObjectStoreOptions {
  transport: FactoryObjectTransport;
  ledgerId: string;
  /** Operator-verified synchronized clock shared with the worker. No system-clock fallback. */
  now: () => Date;
  /** Verified upper bound on clock error; completion/expiration use conservative margins. */
  maxClockSkewMs: number;
  maxBytes?: number;
  maxConflicts?: number;
}
const LIMIT = 10000, JOB_CAPACITY = 600000, RESULT_HEADROOM = 300000;
const inputSchema = z.object({ key:z.string().min(1).max(200),projectId:z.string().min(1).max(200),kind:z.enum(factoryJobKinds),headSha:z.string().regex(/^[a-f0-9]{40,64}$/).optional(),payload:z.record(z.unknown()).default({}),reservedCents:z.number().int().min(0).max(LIMIT),recoveryCents:z.number().int().min(0).max(LIMIT).default(0) }).strict().refine(x=>x.recoveryCents<=x.reservedCents);
const projectSchema = z.object({id:z.string().min(1).max(200),repo:z.string().regex(/^[\w.-]+\/[\w.-]+$/),testCommand:z.string().max(2000),buildCommand:z.string().max(2000),stagingUrl:z.string().max(2000),productionUrl:z.string().max(2000),healthUrl:z.string().max(2000),rollbackCommand:z.string().max(2000),journeys:z.array(z.string().max(200)).max(100),automaticRelease:z.boolean(),providerSupportsRelease:z.boolean(),providerSupportsRollback:z.boolean(),rehearsalRunIds:z.array(z.string()).max(100),rollbackVerifiedAt:z.string().optional()}).strict();
const keySchema=z.string().regex(/^[a-f0-9]{64}$/), integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const jobSchema=z.object({id:z.string().uuid(),ownerKey:keySchema,month:z.string().regex(/^\d{4}-\d{2}$/),input:inputSchema,requestHash:keySchema,status:z.enum(["pending","running","completed","blocked","failed","unknown"]),createdAt:z.string().datetime(),completedAt:z.string().datetime().optional(),workerId:z.string().max(200).optional(),fence:z.string().uuid().optional(),leaseExpiresAt:z.string().datetime().optional(),result:z.unknown().optional(),capacity:integer}).strict();
const ledgerSchema=z.object({version:z.literal(1),ledgerId:z.string().min(1).max(200),lastObservedAt:z.number().finite(),controls:z.array(z.object({ownerKey:keySchema,paused:z.boolean()}).strict()),budgets:z.array(z.object({ownerKey:keySchema,month:z.string().regex(/^\d{4}-\d{2}$/),fixedCents:integer,spentCents:integer,reservedCents:integer}).strict()),jobs:z.array(jobSchema),projects:z.array(z.object({ownerKey:keySchema,config:projectSchema}).strict()),findings:z.array(z.object({ownerKey:keySchema,projectId:z.string(),findingKey:z.string(),jobId:z.string().uuid()}).strict()),workers:z.array(z.object({id:z.string().min(1).max(200),last_seen_at:z.string().datetime(),capabilities:z.record(z.boolean())}).strict()),receipts:z.array(z.object({id:z.string().uuid(),hash:keySchema,result:z.unknown().optional()}).strict())}).strict();
type Ledger=z.infer<typeof ledgerSchema>; type StoredJob=Ledger["jobs"][number];
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ownerKey=(owner:string)=>{if(typeof owner!=="string"||!owner.trim())throw Error("FACTORY_OWNER_REQUIRED");return createHash("sha256").update(owner).digest("hex");};
const assertKey=(key:string)=>{keySchema.parse(key);};
const exposed=(job:StoredJob):FactoryJob=>({ ...clone(job.input),id:job.id,ownerKey:job.ownerKey,month:job.month,status:job.status,createdAt:job.createdAt,...(job.completedAt?{completedAt:job.completedAt}:{}),...(job.workerId?{workerId:job.workerId}:{}),...(job.fence?{fence:job.fence}:{}),...(job.leaseExpiresAt?{leaseExpiresAt:job.leaseExpiresAt}:{}),...(job.result!==undefined?{result:clone(job.result)}:{}) });
const capacity=(kind:FactoryJob["kind"])=>JOB_CAPACITY*(kind==="deploy"?3:kind==="verify"?2:1);
const open=(job:StoredJob)=>["pending","running","unknown"].includes(job.status);
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),"utf8");
function unique(items:unknown[], key:(item:any)=>string){const keys=items.map(key);if(new Set(keys).size!==keys.length)throw Error("FACTORY_LEDGER_CORRUPT");}
function validate(raw:unknown,ledgerId:string):Ledger {
 const state=ledgerSchema.parse(raw);if(state.ledgerId!==ledgerId)throw Error("FACTORY_LEDGER_IDENTITY_MISMATCH");
 unique(state.controls,x=>x.ownerKey);unique(state.budgets,x=>JSON.stringify([x.ownerKey,x.month]));unique(state.jobs,x=>x.id);unique(state.jobs,x=>JSON.stringify([x.ownerKey,x.input.key]));unique(state.projects,x=>JSON.stringify([x.ownerKey,x.config.id]));unique(state.findings,x=>JSON.stringify([x.ownerKey,x.projectId,x.findingKey]));unique(state.workers,x=>x.id);unique(state.receipts,x=>x.id);
 if(state.jobs.filter(j=>j.status==="running").length>1)throw Error("FACTORY_LEDGER_CORRUPT");
 for(const budget of state.budgets){if(budget.fixedCents>LIMIT||!state.controls.some(c=>c.ownerKey===budget.ownerKey))throw Error("FACTORY_LEDGER_CORRUPT");const reserved=state.jobs.filter(j=>j.ownerKey===budget.ownerKey&&j.month===budget.month&&open(j)).reduce((sum,j)=>sum+j.input.reservedCents,0);if(reserved!==budget.reservedCents)throw Error("FACTORY_LEDGER_RESERVATIONS_CORRUPT");}
 for(const job of state.jobs){if((open(job)&&job.capacity<(job.status==="unknown"?64000:RESULT_HEADROOM+JOB_CAPACITY*(job.input.kind==="deploy"?2:job.input.kind==="verify"?1:0)))||job.requestHash!==hash(job.input)||!state.budgets.some(b=>b.ownerKey===job.ownerKey&&b.month===job.month)||(!open(job)&&job.capacity!==0)||(job.status==="running"&&(!job.workerId||!job.fence||!job.leaseExpiresAt)))throw Error("FACTORY_LEDGER_CORRUPT");}
 return state;
}

/** Small-volume single-object ledger. No implicit bootstrap, pruning, provider
 * side effects, PostgreSQL fallback, or assumed billing cap. Capacity blocks new
 * work before it can consume in-flight result/recovery headroom. Receipts and
 * financial records are retained; eventual archival is an operator migration.
 * Host clock synchronization must be verified externally. GCS generations are
 * opaque concurrency tokens, NOT clocks. */
export function createSoftwareFactoryObjectStore(options:FactoryObjectStoreOptions): typeof softwareFactoryStore & {initializeStore():Promise<void>;releaseHistory(owner:string,projectId:string):Promise<FactoryJob[]>} {
 if(!options.transport||typeof options.transport.read!=="function"||typeof options.transport.compareAndSwap!=="function")throw Error("FACTORY_OBJECT_TRANSPORT_REQUIRED");
 if(typeof options.now!=="function"||!Number.isSafeInteger(options.maxClockSkewMs)||options.maxClockSkewMs<0||options.maxClockSkewMs>30000||!options.ledgerId.trim()||options.ledgerId.length>200)throw Error("FACTORY_OBJECT_CONFIGURATION_INVALID");
 const maxBytes=options.maxBytes??8*1024*1024,maxConflicts=options.maxConflicts??5;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>64*1024*1024||!Number.isSafeInteger(maxConflicts)||maxConflicts<0||maxConflicts>10)throw Error("FACTORY_OBJECT_CONFIGURATION_INVALID");
 const time=()=>{const value=options.now().getTime();if(!Number.isFinite(value))throw Error("FACTORY_CLOCK_UNVERIFIED");return value;};
 const month=(now:number)=>new Date(now).toISOString().slice(0,7);
 const read=async()=>{const snapshot=await options.transport.read();if(!snapshot)throw Error("FACTORY_LEDGER_MISSING");if(!/^[1-9][0-9]*$/.test(snapshot.generation)||typeof snapshot.body!=="string"||Buffer.byteLength(snapshot.body)>maxBytes)throw Error("FACTORY_LEDGER_CORRUPT");const state=validate(JSON.parse(snapshot.body),options.ledgerId);if(time()+options.maxClockSkewMs<state.lastObservedAt)throw Error("FACTORY_CLOCK_REGRESSED");return {...snapshot,state};};
 const fit=(state:Ledger)=>{if(bytes(state)+state.jobs.reduce((sum,j)=>sum+j.capacity,0)>maxBytes)throw Error("FACTORY_LEDGER_CAPACITY_EXHAUSTED");};
 type Context={now:number;capacityJobId?:string;allowResultCapacity?:boolean};
 async function mutate<T>(operation:string,args:unknown,reduce:(state:Ledger,context:Context)=>T):Promise<T>{
  const mutationId=randomUUID(),requestHash=hash([operation,args]);
  for(let attempt=0;attempt<=maxConflicts;attempt++){
   const {state,generation}=await read(),beforeSize=bytes(state),beforeBody=JSON.stringify(state);const prior=state.receipts.find(r=>r.id===mutationId);
   if(prior){if(prior.hash!==requestHash)throw Error("FACTORY_RECEIPT_MISMATCH");return prior.result===undefined?undefined as T:clone(prior.result) as T;}
   const context:Context={now:time()};const result=reduce(state,context);
   if(JSON.stringify(state)===beforeBody)return result===undefined?result:clone(result);
   state.lastObservedAt=Math.max(state.lastObservedAt,context.now);state.receipts.push({id:mutationId,hash:requestHash,...(result===undefined?{}:{result:clone(result)})});
   if(context.capacityJobId){const job=state.jobs.find(j=>j.id===context.capacityJobId);if(job&&open(job)){const growth=Math.max(0,bytes(state)-beforeSize);const protectedBytes=context.allowResultCapacity?0:RESULT_HEADROOM+JOB_CAPACITY*(job.input.kind==="deploy"?2:job.input.kind==="verify"?1:0);if(job.capacity-growth<protectedBytes)throw Error("FACTORY_LEDGER_RESULT_HEADROOM_REQUIRED");job.capacity-=growth;}}
   validate(state,options.ledgerId);fit(state);const body=JSON.stringify(state);
   let written:Awaited<ReturnType<FactoryObjectTransport["compareAndSwap"]>>;
   try{written=await options.transport.compareAndSwap(generation,body);}catch{
    // A timed-out conditional write may already be durable. A receipt is proof;
    // absence is not proof of failure, so never replay an ambiguous operation.
    try{const current=await read();const receipt=current.state.receipts.find(r=>r.id===mutationId&&r.hash===requestHash);if(receipt)return receipt.result===undefined?undefined as T:clone(receipt.result) as T;}catch{}
    throw Error("FACTORY_LEDGER_WRITE_UNCONFIRMED");
   }
   if(written.kind==="written"&&written.generation!==generation&&/^[1-9][0-9]*$/.test(written.generation))return result===undefined?result:clone(result);
   if(written.kind!=="conflict")throw Error("FACTORY_LEDGER_WRITE_UNCONFIRMED");
  }
  throw Error("FACTORY_LEDGER_CONTENTION");
 }
 const budget=(state:Ledger,key:string,m:string)=>{const row=state.budgets.find(b=>b.ownerKey===key&&b.month===m);if(!row)throw Error("FACTORY_BUDGET_UNAVAILABLE");return row;};
 // Preserve original-month escrow, but also constrain the month in which old
 // work can execute. Settlement cost is conservatively charged in full to its
 // settlement month; adapters do not provide a trustworthy split at midnight.
 const effectiveBudget=(state:Ledger,key:string,m:string)=>{
  const b=state.budgets.find(b=>b.ownerKey===key&&b.month===m);
  let spentCents=b?.spentCents??0,reservedCents=b?.reservedCents??0;
  for(const job of state.jobs){
   if(job.ownerKey!==key||job.month>=m)continue;
   if(open(job))reservedCents+=job.input.reservedCents;
   else if(job.completedAt?.slice(0,7)===m){
    const cost=(job.result as {costCents?:unknown})?.costCents;
    if(!Number.isSafeInteger(cost)||typeof cost!=="number"||cost<0)throw Error("FACTORY_LEDGER_COST_UNVERIFIED");
    spentCents+=cost;
   }
  }
  return {fixedCents:b?.fixedCents??0,spentCents,reservedCents};
 };
 const total=(b:{fixedCents:number;spentCents:number;reservedCents:number})=>b.fixedCents+b.spentCents+b.reservedCents;
 const control=(state:Ledger,key:string)=>{const row=state.controls.find(c=>c.ownerKey===key);if(!row)throw Error("FACTORY_BUDGET_UNAVAILABLE");return row;};
 const addJob=(state:Ledger,key:string,input:StoredJob["input"],m:string,now:number,protectedTransfer=false)=>{const b=budget(state,key,m),effective=protectedTransfer?b:effectiveBudget(state,key,m);if(total(effective)+input.reservedCents>LIMIT||total(effective)>=LIMIT)throw Error("FACTORY_BUDGET_UNAVAILABLE");const row:StoredJob={id:randomUUID(),ownerKey:key,month:m,input:clone(input),requestHash:hash(input),status:"pending",createdAt:new Date(now).toISOString(),capacity:capacity(input.kind)};b.reservedCents+=input.reservedCents;state.jobs.push(row);return row;};
 const proof=(state:Ledger,key:string,id:string,projectId:string)=>{const job=state.jobs.find(j=>j.id===id&&j.ownerKey===key&&j.status==="completed");const pipeline=(job?.result as any)?.evidence?.pipelineState;if(!job||job.input.kind!=="rollback"||job.input.projectId!==projectId||pipeline?.target!=="staging"||pipeline.verification?.healthy!==true||pipeline.rollback?.healthy!==true||pipeline.verification?.headSha!==pipeline.candidate?.headSha||pipeline.rollback?.restoredSha!==pipeline.candidate?.baseSha||!pipeline.candidate?.baseSha||job.input.headSha!==pipeline.candidate?.headSha)throw Error("FACTORY_VALIDATION_PROOF_INVALID");return job;};
 return {
  async initializeStore(){
   const initial:Ledger={version:1,ledgerId:options.ledgerId,lastObservedAt:time(),controls:[],budgets:[],jobs:[],projects:[],findings:[],workers:[],receipts:[]};fit(initial);
   if(await options.transport.read()){await read();return;}
   try{const result=await options.transport.compareAndSwap(null,JSON.stringify(initial));if(result.kind==="written"&&/^[1-9][0-9]*$/.test(result.generation))return;}catch{try{await read();return;}catch{}throw Error("FACTORY_LEDGER_BOOTSTRAP_UNCONFIRMED");}
   await read();
  },
  async initializeMonth(owner,m,fixedCents){const key=ownerKey(owner);if(m!==month(time())||!Number.isInteger(fixedCents)||fixedCents<0||fixedCents>LIMIT)throw Error("FACTORY_INVALID_BUDGET");await mutate("initializeMonth",[key,m,fixedCents],state=>{let existing=state.budgets.find(b=>b.ownerKey===key&&b.month===m);if(existing&&existing.fixedCents!==fixedCents)throw Error("FACTORY_FIXED_COST_IMMUTABLE");if(!state.controls.some(c=>c.ownerKey===key))state.controls.push({ownerKey:key,paused:true});if(!existing)state.budgets.push({ownerKey:key,month:m,fixedCents,spentCents:0,reservedCents:0});});},
  async enqueue(owner,raw){const key=ownerKey(owner),input=inputSchema.parse(raw);if(bytes(input)>64000)throw Error("FACTORY_INPUT_TOO_LARGE");return mutate("enqueue",[key,input],(state,{now})=>{const previous=state.jobs.find(j=>j.ownerKey===key&&j.input.key===input.key);if(previous){if(previous.requestHash!==hash(input))throw Error("FACTORY_IDEMPOTENCY_CONFLICT");return exposed(previous);}return exposed(addJob(state,key,input,month(now),now));});},
  async saveProject(owner,config){const key=ownerKey(owner),safe=projectSchema.parse(config);return mutate("saveProject",[key,safe],state=>{const stored={...safe,automaticRelease:false,providerSupportsRelease:false,providerSupportsRollback:false,rehearsalRunIds:[],rollbackVerifiedAt:undefined};const previous=state.projects.find(p=>p.ownerKey===key&&p.config.id===safe.id);if(previous)previous.config=stored;else state.projects.push({ownerKey:key,config:stored});return stored;});},
  async reconcile(owner,id,input){const key=ownerKey(owner);if(!Number.isSafeInteger(input.actualCostCents)||input.actualCostCents<0||input.executionStopped!==true||!input.reason.trim()||input.reason.length>2000)throw Error("FACTORY_RECONCILIATION_PROOF_REQUIRED");return mutate("reconcile",[key,id,input],(state,{now})=>{const job=state.jobs.find(j=>j.ownerKey===key&&j.id===id&&j.status==="unknown");if(!job)throw Error("FACTORY_UNKNOWN_JOB_REQUIRED");job.status="failed";job.completedAt=new Date(now).toISOString();job.capacity=0;job.result={status:"failed",costCents:input.actualCostCents,reason:input.reason,reconciled:true,executionStopped:true};const b=budget(state,key,job.month);b.reservedCents-=job.input.reservedCents;b.spentCents+=input.actualCostCents;control(state,key).paused=true;return exposed(job);});},
  async configureProjectExecution(key,id,capabilities){assertKey(key);return mutate("configureProjectExecution",[key,id,capabilities],(state,{now})=>{const project=state.projects.find(p=>p.ownerKey===key&&p.config.id===id)?.config;if(!project)throw Error("FACTORY_PROJECT_MISSING");if(capabilities.automaticRelease){const age=now-Date.parse(project.rollbackVerifiedAt??"");if(!capabilities.release||!capabilities.rollback||new Set(project.rehearsalRunIds).size<3||!Number.isFinite(age)||age< -options.maxClockSkewMs||age+options.maxClockSkewMs>86400000)throw Error("FACTORY_PILOT_PROOF_REQUIRED");for(const id of project.rehearsalRunIds.slice(-3))proof(state,key,id,project.id);}Object.assign(project,{providerSupportsRelease:capabilities.release===true,providerSupportsRollback:capabilities.rollback===true,automaticRelease:capabilities.automaticRelease===true});return project;});},
  async claimFinding(key,projectId,findingKey,jobId){assertKey(key);if(!findingKey||findingKey.length>200)throw Error("FACTORY_INVALID_FINDING");return mutate("claimFinding",[key,projectId,findingKey,jobId],(state,context)=>{const job=state.jobs.find(j=>j.id===jobId&&j.ownerKey===key&&j.input.projectId===projectId);if(!job)return false;const prior=state.findings.find(f=>f.ownerKey===key&&f.projectId===projectId&&f.findingKey===findingKey);if(prior)return prior.jobId===jobId;state.findings.push({ownerKey:key,projectId,findingKey,jobId});if(open(job))context.capacityJobId=jobId;return true;});},
  async recordValidation(key,projectId,id){assertKey(key);return mutate("recordValidation",[key,projectId,id],(state,{now})=>{const job=proof(state,key,id,projectId),project=state.projects.find(p=>p.ownerKey===key&&p.config.id===projectId)?.config;if(!project)throw Error("FACTORY_PROJECT_MISSING");const age=now-Date.parse(job.completedAt??"");if(!Number.isFinite(age)||age< -options.maxClockSkewMs||age+options.maxClockSkewMs>86400000)throw Error("FACTORY_VALIDATION_PROOF_STALE");if(!project.rehearsalRunIds.includes(id)){project.rehearsalRunIds=[...project.rehearsalRunIds,id].slice(-100);project.rollbackVerifiedAt=job.completedAt;}return project;});},
  async getCompletedJob(key,id){assertKey(key);const job=(await read()).state.jobs.find(j=>j.ownerKey===key&&j.id===id&&j.status==="completed");return job?exposed(job):undefined;},
  async projectByOwnerKey(key,id){assertKey(key);return (await read()).state.projects.find(p=>p.ownerKey===key&&p.config.id===id)?.config;},
  async projects(owner){const key=ownerKey(owner);return (await read()).state.projects.filter(p=>p.ownerKey===key).map(p=>p.config).sort((a,b)=>a.id.localeCompare(b.id));},
  async list(owner){const key=ownerKey(owner);return (await read()).state.jobs.filter(j=>j.ownerKey===key).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(exposed);},
  async releaseHistory(owner,projectId){
   const key=ownerKey(owner);if(typeof projectId!=="string"||!projectId.trim()||projectId.length>200)throw Error("FACTORY_PROJECT_REQUIRED");
   const jobs=(await read()).state.jobs.filter(j=>j.ownerKey===key&&j.input.projectId===projectId&&["deploy","rollback"].includes(j.input.kind)&&(["running","unknown"].includes(j.status)||(j.status==="completed"&&(j.result as {evidence?:{pipelineState?:{target?:string}}}|undefined)?.evidence?.pipelineState?.target==="production")));
   // Active/uncertain releases must never disappear behind later settled events.
   const rank=(j:StoredJob)=>["running","unknown"].includes(j.status)?1:0;
   return jobs.sort((a,b)=>rank(b)-rank(a)||(b.completedAt??b.createdAt).localeCompare(a.completedAt??a.createdAt)).slice(0,100).map(exposed);
  },
  async status(owner){const key=ownerKey(owner),state=(await read()).state,m=month(time()),b=state.budgets.find(b=>b.ownerKey===key&&b.month===m),c=state.controls.find(c=>c.ownerKey===key),effective=effectiveBudget(state,key,m);return {configured:!!b&&!!c,paused:c?.paused??true,month:m,...effective,limitCents:LIMIT,workers:state.workers.filter(w=>time()-Date.parse(w.last_seen_at)<45000).map(w=>({...w}))};},
  async setPaused(owner,paused){const key=ownerKey(owner);if(typeof paused!=="boolean")throw Error("FACTORY_INVALID_PAUSE");await mutate("setPaused",[key,paused],state=>{const c=state.controls.find(c=>c.ownerKey===key);if(c)c.paused=paused;else state.controls.push({ownerKey:key,paused});});},
  async heartbeat(workerId,capabilities={}){if(!workerId||workerId.length>200||bytes(capabilities)>4000)throw Error("FACTORY_WORKER_INVALID");z.record(z.boolean()).parse(capabilities);await mutate("heartbeat",[workerId,capabilities],(state,context)=>{const worker={id:workerId,last_seen_at:new Date(context.now).toISOString(),capabilities:clone(capabilities)};const i=state.workers.findIndex(w=>w.id===workerId);if(i<0)state.workers.push(worker);else state.workers[i]=worker;context.capacityJobId=state.jobs.find(j=>j.status==="running"&&j.workerId===workerId)?.id;});},
  async idleState(){const state=(await read()).state;if(state.jobs.some(j=>j.status==="unknown"))return {kind:"unknown"};const running=state.jobs.filter(j=>j.status==="running").sort((a,b)=>(a.leaseExpiresAt??"").localeCompare(b.leaseExpiresAt??""))[0];if(running)return {kind:"running",leaseExpiresAt:running.leaseExpiresAt!};if(state.jobs.some(j=>j.status==="pending"&&["verify","rollback"].includes(j.input.kind)))return {kind:"pendingRecovery"};return {kind:"idle"};},
  async claim(workerId){if(!workerId||workerId.length>200)throw Error("FACTORY_WORKER_INVALID");return mutate("claim",[workerId],(state,context)=>{if(state.jobs.some(j=>j.status==="running"||j.status==="unknown"))return undefined;const job=state.jobs.filter(j=>{if(j.status!=="pending")return false;const deferred=(j.result as {deferred?:{notBefore?:unknown}}|undefined)?.deferred;if(deferred&&!(typeof deferred.notBefore==="string"&&Date.parse(deferred.notBefore)<=context.now))return false;const recovery=["verify","rollback"].includes(j.input.kind),c=state.controls.find(c=>c.ownerKey===j.ownerKey),b=state.budgets.find(b=>b.ownerKey===j.ownerKey&&b.month===j.month);return c&&b&&(!c.paused||recovery)&&(j.month===month(context.now)||recovery)&&total(recovery?b:effectiveBudget(state,j.ownerKey,month(context.now)))<=LIMIT;}).sort((a,b)=>Number(!["verify","rollback"].includes(a.input.kind))-Number(!["verify","rollback"].includes(b.input.kind))||a.createdAt.localeCompare(b.createdAt))[0];if(!job)return undefined;job.status="running";job.workerId=workerId;job.fence=randomUUID();job.leaseExpiresAt=new Date(context.now+600000).toISOString();context.capacityJobId=job.id;return exposed(job);});},
  async complete(rawJob,outcome,next){if(!Number.isSafeInteger(outcome.costCents)||outcome.costCents<0||!["completed","blocked","failed","unknown"].includes(outcome.status)||bytes(outcome)>200000)throw Error("FACTORY_INVALID_OUTCOME");return mutate("complete",[rawJob.id,rawJob.workerId,rawJob.fence,outcome,next],(state,context)=>{const job=state.jobs.find(j=>j.id===rawJob.id&&j.workerId===rawJob.workerId&&j.fence===rawJob.fence&&j.status==="running"&&Date.parse(j.leaseExpiresAt!)>context.now+options.maxClockSkewMs);if(!job)return false;
   const protectedTransfer=job.input.kind==="deploy"&&next?.kind==="verify"||job.input.kind==="verify"&&next?.kind==="rollback";
   if(outcome.status!=="unknown"&&job.input.recoveryCents>0&&outcome.costCents>job.input.reservedCents-job.input.recoveryCents)throw Error("FACTORY_RECOVERY_ESCROW_OVERRUN");
   if(job.input.kind==="deploy"&&outcome.status==="completed"&&!protectedTransfer)throw Error("FACTORY_VERIFICATION_REQUIRED");
   if(protectedTransfer&&(!next||next.reservedCents>job.input.reservedCents-outcome.costCents||next.reservedCents<job.input.recoveryCents))throw Error("FACTORY_RECOVERY_ESCROW_INVALID");
   job.status=outcome.status;job.result=clone(outcome);job.completedAt=new Date(context.now).toISOString();if(outcome.status!=="unknown")job.capacity=0;else {context.capacityJobId=job.id;context.allowResultCapacity=true;}
   const b=budget(state,job.ownerKey,job.month);if(outcome.status!=="unknown"){b.reservedCents-=job.input.reservedCents;b.spentCents+=outcome.costCents;}if(outcome.costCents>job.input.reservedCents)control(state,job.ownerKey).paused=true;
   if(next&&outcome.status==="completed"&&outcome.costCents<=job.input.reservedCents){const input=inputSchema.parse({...next,key:job.id+".next",projectId:job.input.projectId});if(bytes(input)>64000)throw Error("FACTORY_INPUT_TOO_LARGE");const m=protectedTransfer?job.month:month(context.now),target=state.budgets.find(b=>b.ownerKey===job.ownerKey&&b.month===m);const available=protectedTransfer?target:effectiveBudget(state,job.ownerKey,m);if(target&&available&&total(available)+input.reservedCents<=LIMIT&&total(available)<LIMIT){const added=addJob(state,job.ownerKey,input,m,context.now,protectedTransfer);
     if(!protectedTransfer&&bytes(state)+state.jobs.reduce((sum,j)=>sum+j.capacity,0)+1024>maxBytes){state.jobs=state.jobs.filter(j=>j.id!==added.id);target.reservedCents-=input.reservedCents;job.result={...outcome,continuationBlocked:"FACTORY_LEDGER_CAPACITY_EXHAUSTED"};}}else if(protectedTransfer)throw Error("FACTORY_RECOVERY_ESCROW_TRANSFER_FAILED");else job.result={...outcome,continuationBlocked:"FACTORY_BUDGET_UNAVAILABLE"};}
   return true;
  });},
  /** Zero-cost requeue of a claimed job until notBefore; reservation retained. */
  async defer(rawJob,input){if(typeof input?.reason!=="string"||!/^[A-Z0-9_:]{1,200}$/.test(input.reason)||typeof input.notBefore!=="string"||!Number.isFinite(Date.parse(input.notBefore))||new Date(Date.parse(input.notBefore)).toISOString()!==input.notBefore)throw Error("FACTORY_INVALID_DEFERRAL");return mutate("defer",[rawJob.id,rawJob.workerId,rawJob.fence,input],(state,context)=>{const job=state.jobs.find(j=>j.id===rawJob.id&&j.workerId===rawJob.workerId&&j.fence===rawJob.fence&&j.status==="running"&&Date.parse(j.leaseExpiresAt!)>context.now+options.maxClockSkewMs);if(!job||job.month!==input.notBefore.slice(0,7)||Date.parse(input.notBefore)<=context.now)return false;
   job.status="pending";delete job.workerId;delete job.fence;delete job.leaseExpiresAt;job.result={deferred:{reason:input.reason,notBefore:input.notBefore}};return true;});},
  async expire(){return mutate("expire",[],(state,context)=>{let count=0;for(const job of state.jobs)if(job.status==="running"&&Date.parse(job.leaseExpiresAt!)<=context.now-options.maxClockSkewMs){job.status="unknown";job.result={};context.capacityJobId=job.id;context.allowResultCapacity=true;count++;}return count;});},
 };
}
