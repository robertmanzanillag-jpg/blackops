import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {canonicalEvidenceDigest as digest} from "./evidence-json";
import type {BusinessPool} from "./office-business-sources";
import {EDITORIAL_ROLES,readStoredEditorialSource,validateEditorialSource,type EditorialRole,type EditorialSource} from "./office-editorial-source";
import {prepareEditorialDelivery,type EditorialDelivery} from "./office-editorial-artifacts";
export const EDITORIAL_WORK_KIND="office_editorial_work_v1",EDITORIAL_WORK_MAX_JOBS=200;
const TTL=60000,MAX_BYTES=4000000;
const RESERVE_BYTES=250000;
const jobSchema=z.object({id:z.string().uuid(),fence:z.string().uuid(),role:z.enum(EDITORIAL_ROLES),generation:z.number().int().positive(),slot:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),startedAt:z.string().datetime(),expiresAt:z.string().datetime(),status:z.enum(["running","completed","blocked","unknown"]),completedAt:z.string().datetime().optional(),reason:z.enum(["SOURCE_UNAVAILABLE","LEASE_EXPIRED","HOLDER_CHANGED","HISTORY_CAPACITY","STOP_REQUESTED","ARTIFACT_LIMIT"]).optional(),source:z.unknown().optional(),artifact:z.unknown().optional(),proof:z.string().regex(/^[a-f0-9]{64}$/).optional(),recoveryOf:z.string().uuid().optional(),recoveryParentProof:z.string().regex(/^[a-f0-9]{64}$/).optional(),recoverySourceDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),operatorAuditId:z.string().min(1).max(200).optional()}).strict();
export type EditorialWorkJob=Omit<z.infer<typeof jobSchema>,"source"|"artifact">&{source?:EditorialSource;artifact?:EditorialDelivery};
export type EditorialWorkState={version:1;ownerKey:string;jobs:EditorialWorkJob[]};
export function editorialWorkCapacity(state:EditorialWorkState){const usedBytes=Buffer.byteLength(JSON.stringify(state));return {reached:state.jobs.length>=EDITORIAL_WORK_MAX_JOBS||usedBytes>MAX_BYTES-RESERVE_BYTES,usedJobs:state.jobs.length,maxJobs:EDITORIAL_WORK_MAX_JOBS,usedBytes,maxBytes:MAX_BYTES,reserveBytes:RESERVE_BYTES};}
const proof=(job:EditorialWorkJob)=>{const {proof,...body}=job;return digest(body);};
export function parseEditorialWork(raw:unknown,owner:string):EditorialWorkState{
 if(!owner.trim())throw Error("EDITORIAL_OWNER_REQUIRED");if(raw===undefined)return {version:1,ownerKey:digest(owner),jobs:[]};
 const value=z.object({version:z.literal(1),ownerKey:z.string(),jobs:z.array(jobSchema).max(EDITORIAL_WORK_MAX_JOBS)}).strict().parse(raw) as EditorialWorkState;
 if(value.ownerKey!==digest(owner)||Buffer.byteLength(JSON.stringify(value))>MAX_BYTES||new Set(value.jobs.map(j=>j.id)).size!==value.jobs.length||new Set(value.jobs.map(j=>j.fence)).size!==value.jobs.length||new Set(value.jobs.filter(j=>!j.recoveryOf).map(j=>`${j.role}:${j.slot}:${j.generation}`)).size!==value.jobs.filter(j=>!j.recoveryOf).length||new Set(value.jobs.filter(j=>j.recoveryOf).map(j=>j.recoveryOf)).size!==value.jobs.filter(j=>j.recoveryOf).length)throw Error("EDITORIAL_HISTORY_INVALID");
 for(const job of value.jobs){const start=Date.parse(job.startedAt),end=Date.parse(job.expiresAt),complete=Date.parse(job.completedAt||"");
  const recoveryFields=[job.recoveryOf,job.recoveryParentProof,job.recoverySourceDigest,job.operatorAuditId];
  if(recoveryFields.some(v=>v!==undefined)){
   const parent=value.jobs.find(j=>j.id===job.recoveryOf);
   if(recoveryFields.some(v=>v===undefined)||!job.operatorAuditId?.trim()||!parent||parent.recoveryOf||parent.status!=="blocked"||parent.proof!==job.recoveryParentProof||parent.role!==job.role||parent.generation!==job.generation||parent.slot!==job.slot||Date.parse(parent.completedAt||"")>start||parent.source?.sourceDigest===job.recoverySourceDigest||(job.source&&job.source.sourceDigest!==job.recoverySourceDigest))throw Error("EDITORIAL_RECOVERY_INVALID");
  }
  if(end-start!==TTL||job.slot!==job.startedAt.slice(0,10))throw Error("EDITORIAL_LEASE_INVALID");
  if(["running","unknown"].includes(job.status)){if(job.completedAt||job.artifact||job.source||job.proof)throw Error("EDITORIAL_UNCERTAIN_ARTIFACT");continue;}
  if(!Number.isFinite(complete)||complete<start||complete>=end||job.proof!==proof(job))throw Error("EDITORIAL_COMPLETION_INVALID");
  if(job.source||job.artifact){if(!job.source||!job.artifact||job.reason)throw Error("EDITORIAL_ARTIFACT_MISSING");const source=validateEditorialSource(job.source,owner);if(digest(prepareEditorialDelivery(source,owner,job.role,complete))!==digest(job.artifact)||job.artifact.status!==job.status||(job.recoveryOf&&(job.status!=="completed"||!job.artifact.drafts.length)))throw Error("EDITORIAL_ARTIFACT_INVALID");}
  else if(job.status!=="blocked"||!["SOURCE_UNAVAILABLE","ARTIFACT_LIMIT"].includes(job.reason||""))throw Error("EDITORIAL_BLOCK_INVALID");
 }
 return value;
}
/** GET adapter: no generation lookup, schema creation, filesystem or writes. */
export async function readEditorialWork(pool:BusinessPool,owner:string):Promise<EditorialWorkState>{
 if(!owner.trim()||!(await pool.query("SELECT id FROM users WHERE id=$1 LIMIT 1",[owner])).rows.length)throw Error("EDITORIAL_OWNER_ABSENT");
 const result=await pool.query("SELECT data FROM revenue_engine_state WHERE owner_user_id=$1 AND kind=$2",[owner,EDITORIAL_WORK_KIND]);return parseEditorialWork(result.rows[0]?.data,owner);
}

function createEditorialMutator(pool:BusinessPool,owner:string){
 return async function mutate(change:(state:EditorialWorkState)=>Promise<EditorialWorkState>){const db=await pool.connect();try{
  await db.query("BEGIN");await db.query("SET LOCAL lock_timeout='5s'");await db.query("SET LOCAL statement_timeout='10s'");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[createHash('sha256').update(owner).digest('hex')]);
  if(!(await db.query("SELECT id FROM users WHERE id=$1 LIMIT 1",[owner])).rows.length)throw Error("EDITORIAL_OWNER_ABSENT");
  const rows=await db.query("SELECT data FROM revenue_engine_state WHERE owner_user_id=$1 AND kind=$2 FOR UPDATE",[owner,EDITORIAL_WORK_KIND]);const before=parseEditorialWork(rows.rows[0]?.data,owner),after=parseEditorialWork(await change(structuredClone(before)),owner);
  if(digest(before)!==digest(after))await db.query("INSERT INTO revenue_engine_state(owner_user_id,kind,data,revision,updated_at) VALUES($1,$2,$3::jsonb,1,now()) ON CONFLICT(owner_user_id,kind) DO UPDATE SET data=EXCLUDED.data,revision=revenue_engine_state.revision+1,updated_at=now()",[owner,EDITORIAL_WORK_KIND,JSON.stringify(after)]);
  await db.query("COMMIT");return after;
 }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}finally{db.release();}}
}

/** getGeneration must read canonical careers, never mutate council or invoke a
 * provider: it runs under the SAME owner advisory lock as council mutations.
 * Source reads execute outside that lock. No business action or model is called. */
export function createEditorialWorkRunner(options:{pool:BusinessPool;owner:string;configuredOwner:string;getGeneration:(role:EditorialRole)=>Promise<number|null|undefined>;now?:()=>number;shouldStop?:()=>boolean;readSource?:(role:EditorialRole,at:number)=>Promise<EditorialSource>}){
 const {pool,owner}=options,now=options.now||Date.now;if(!owner.trim()||owner!==options.configuredOwner)throw Error("EDITORIAL_OWNER_REQUIRED");
 const mutate=createEditorialMutator(pool,owner);
 return {read:()=>readEditorialWork(pool,owner),async tick(){let completed=0;
  for(const role of EDITORIAL_ROLES){if(options.shouldStop?.())break;let assigned:EditorialWorkJob|undefined;const started=now(),id=randomUUID(),fence=randomUUID();
   await mutate(async state=>{assigned=undefined;state={...state,jobs:state.jobs.map(j=>j.status==="running"&&Date.parse(j.expiresAt)<=started?{...j,status:"unknown" as const,reason:"LEASE_EXPIRED" as const}:j)};
    if(options.shouldStop?.()||state.jobs.some(j=>j.status==="running"||(j.status==="unknown"&&j.role===role))||editorialWorkCapacity(state).reached)return state;
    const generation=await options.getGeneration(role);if(!Number.isSafeInteger(generation)||!generation||generation<1||state.jobs.some(j=>j.role===role&&j.generation===generation&&j.slot===new Date(started).toISOString().slice(0,10)))return state;
    assigned={id,fence,role,generation,slot:new Date(started).toISOString().slice(0,10),startedAt:new Date(started).toISOString(),expiresAt:new Date(started+TTL).toISOString(),status:"running"};return {...state,jobs:[...state.jobs,assigned]};
   });
   if(!assigned)continue;const job=assigned as EditorialWorkJob;let source:EditorialSource|undefined,artifact:EditorialDelivery|undefined;
   let admitted=false;
   await mutate(async state=>{admitted=false;const current=state.jobs.find(j=>j.id===id);if(!current||current.fence!==fence||current.status!=="running")return state;
    const generation=await options.getGeneration(role),at=now(),reason=options.shouldStop?.()?"STOP_REQUESTED":at>=Date.parse(current.expiresAt)?"LEASE_EXPIRED":generation!==current.generation?"HOLDER_CHANGED":undefined;
    if(reason)return {...state,jobs:state.jobs.map(j=>j.id===id?{...j,status:"unknown" as const,reason}:j)};
    admitted=true;return state;
   });
   if(!admitted)continue;
   let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
   try{const remaining=Date.parse(job.expiresAt)-now();if(remaining<=0)throw Error("EXPIRED");source=(await Promise.race([options.readSource?options.readSource(role,now()):readStoredEditorialSource(pool,owner,options.configuredOwner),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(Error("EXPIRED"));},remaining);})]))||undefined;if(!source)throw Error("MISSING");artifact=prepareEditorialDelivery(source,owner,role,now());}catch{source=undefined;artifact=undefined;}finally{if(timer)clearTimeout(timer);}
   await mutate(async state=>{const current=state.jobs.find(j=>j.id===id);if(!current||current.fence!==fence||current.status!=="running")return state;const generation=await options.getGeneration(role),at=now();
    let next:EditorialWorkJob;if(timedOut||at>=Date.parse(current.expiresAt))next={...current,status:"unknown",reason:"LEASE_EXPIRED"};else if(generation!==current.generation)next={...current,status:"unknown",reason:"HOLDER_CHANGED"};else{next={...current,status:artifact?.status||"blocked",completedAt:new Date(at).toISOString(),...(source&&artifact?{source,artifact}:{reason:"SOURCE_UNAVAILABLE" as const})};next.proof=proof(next);
     if(Buffer.byteLength(JSON.stringify({...state,jobs:state.jobs.map(j=>j.id===id?next:j)}))>MAX_BYTES){next={...current,status:"blocked",reason:"ARTIFACT_LIMIT",completedAt:new Date(at).toISOString()};next.proof=proof(next);}
     completed++;}
    return {...state,jobs:state.jobs.map(j=>j.id===id?next:j)};
   });
  }
  return {completed};
 }};
}

/** Explicit operator-only recovery. No route, timer or ordinary tick calls this.
 * Keep the blocked original intact; a recovery is a new fenced attempt, never a
 * publication, promotion, generation reset or an exception to evidence checks. */
export async function recoverEditorialPreparation(options:{pool:BusinessPool;owner:string;configuredOwner:string;parentId:string;expectedParentProof:string;expectedSourceDigest:string;expectedGeneration:number;operatorAuditId:string;getGeneration:(role:EditorialRole)=>Promise<number|null|undefined>;now?:()=>number;shouldStop?:()=>boolean;readSource?:(role:EditorialRole,at:number)=>Promise<EditorialSource|null>}){
 const {pool,owner}=options,now=options.now||Date.now;
 if(!owner.trim()||owner!==options.configuredOwner||!options.operatorAuditId.trim()||options.operatorAuditId.length>200||!Number.isSafeInteger(options.expectedGeneration)||options.expectedGeneration<1||![options.expectedParentProof,options.expectedSourceDigest].every(h=>/^[a-f0-9]{64}$/.test(h)))throw Error("EDITORIAL_RECOVERY_REQUEST_INVALID");
 const mutate=createEditorialMutator(pool,owner),id=randomUUID(),fence=randomUUID();let assigned:EditorialWorkJob|undefined;
 await mutate(async state=>{assigned=undefined;const parent=state.jobs.find(j=>j.id===options.parentId),at=now();
  if(options.shouldStop?.()||!parent||parent.recoveryOf||parent.status!=="blocked"||parent.proof!==options.expectedParentProof||parent.generation!==options.expectedGeneration||parent.slot!==new Date(at).toISOString().slice(0,10)||Date.parse(parent.completedAt||"")>at||parent.source?.sourceDigest===options.expectedSourceDigest||state.jobs.some(j=>j.recoveryOf===parent.id||j.status==="running"||(j.role===parent.role&&j.status==="unknown"))||editorialWorkCapacity(state).reached)throw Error("EDITORIAL_RECOVERY_NOT_ELIGIBLE");
  if(await options.getGeneration(parent.role)!==parent.generation)throw Error("EDITORIAL_RECOVERY_HOLDER_CHANGED");
  const start=now();if(new Date(start).toISOString().slice(0,10)!==parent.slot||options.shouldStop?.())throw Error("EDITORIAL_RECOVERY_NOT_ELIGIBLE");
  assigned={id,fence,role:parent.role,generation:parent.generation,slot:parent.slot,startedAt:new Date(start).toISOString(),expiresAt:new Date(start+TTL).toISOString(),status:"running",recoveryOf:parent.id,recoveryParentProof:parent.proof,recoverySourceDigest:options.expectedSourceDigest,operatorAuditId:options.operatorAuditId};
  return {...state,jobs:[...state.jobs,assigned]};
 });
 if(!assigned)throw Error("EDITORIAL_RECOVERY_NOT_ADMITTED");const job=assigned as EditorialWorkJob;let admitted=false,source:EditorialSource|undefined,artifact:EditorialDelivery|undefined,timedOut=false;
 await mutate(async state=>{admitted=false;const current=state.jobs.find(j=>j.id===id);if(!current||current.fence!==fence||current.status!=="running")return state;
  const generation=await options.getGeneration(job.role),at=now(),reason=options.shouldStop?.()?"STOP_REQUESTED":at>=Date.parse(current.expiresAt)?"LEASE_EXPIRED":generation!==current.generation?"HOLDER_CHANGED":undefined;
  if(reason)return{...state,jobs:state.jobs.map(j=>j.id===id?{...j,status:"unknown" as const,reason}:j)};admitted=true;return state;
 });
 if(admitted){let timer:ReturnType<typeof setTimeout>|undefined;
  try{const remaining=Date.parse(job.expiresAt)-now();if(remaining<=0){timedOut=true;throw Error("EXPIRED");}
   source=(await Promise.race([options.readSource?options.readSource(job.role,now()):readStoredEditorialSource(pool,owner,options.configuredOwner),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(Error("EXPIRED"));},remaining);})]))||undefined;
   if(!source||source.sourceDigest!==options.expectedSourceDigest)throw Error("SOURCE_CHANGED");artifact=prepareEditorialDelivery(source,owner,job.role,now());if(artifact.status!=="completed"||!artifact.drafts.length)throw Error("NO_DRAFTS");
  }catch{source=undefined;artifact=undefined;}finally{if(timer)clearTimeout(timer);}
  await mutate(async state=>{const current=state.jobs.find(j=>j.id===id);if(!current||current.fence!==fence||current.status!=="running")return state;
   const generation=await options.getGeneration(job.role),at=now();let next:EditorialWorkJob;
   if(timedOut||at>=Date.parse(current.expiresAt))next={...current,status:"unknown",reason:"LEASE_EXPIRED"};
   else if(generation!==current.generation)next={...current,status:"unknown",reason:"HOLDER_CHANGED"};
   else{if(source&&artifact){artifact=prepareEditorialDelivery(source,owner,job.role,at);if(artifact.status!=="completed"||!artifact.drafts.length){source=undefined;artifact=undefined;}}
    next={...current,status:artifact?"completed":"blocked",completedAt:new Date(at).toISOString(),...(source&&artifact?{source,artifact}:{reason:"SOURCE_UNAVAILABLE" as const})};next.proof=proof(next);
    if(Buffer.byteLength(JSON.stringify({...state,jobs:state.jobs.map(j=>j.id===id?next:j)}))>MAX_BYTES){next={...current,status:"blocked",reason:"ARTIFACT_LIMIT",completedAt:new Date(at).toISOString()};next.proof=proof(next);}
   }
   return {...state,jobs:state.jobs.map(j=>j.id===id?next:j)};
  });
 }
 const saved=await readEditorialWork(pool,owner);const result=saved.jobs.find(j=>j.id===id);if(!result)throw Error("EDITORIAL_RECOVERY_UNCONFIRMED");return result;
}
