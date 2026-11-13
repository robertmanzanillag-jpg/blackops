export {eligibleBusinessGeneration} from "./office-business-work";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {canonicalEvidenceDigest as digest} from "./evidence-json";
import type {BusinessPool} from './office-business-sources';
import {revenueCandidateVersion,readRevenuePreviewSource,validateRevenuePreviewSource,type RevenuePreviewSource} from './office-revenue-source';
import {buildOfficeRevenuePreview,type RevenuePreviewArtifact} from './office-revenue-artifact';
const BUSINESS_ROLES=['revenue'] as const;
type BusinessRole='revenue';
export const REVENUE_WORK_KIND="office_revenue_preview_v1",REVENUE_WORK_MAX_JOBS=200;
const TTL=60000,MAX_BYTES=4000000;
const RESERVE_BYTES=250000;
const jobSchema=z.object({id:z.string().uuid(),fence:z.string().uuid(),role:z.enum(BUSINESS_ROLES),generation:z.number().int().positive(),slot:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),startedAt:z.string().datetime(),expiresAt:z.string().datetime(),status:z.enum(["running","completed","blocked","unknown"]),completedAt:z.string().datetime().optional(),reason:z.enum(["SOURCE_UNAVAILABLE","NO_ELIGIBLE_CANDIDATE","LEASE_EXPIRED","HOLDER_CHANGED","HISTORY_CAPACITY","STOP_REQUESTED","ARTIFACT_LIMIT"]).optional(),source:z.unknown().optional(),artifact:z.unknown().optional(),proof:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export type RevenueWorkJob=Omit<z.infer<typeof jobSchema>,"source"|"artifact">&{source?:RevenuePreviewSource;artifact?:RevenuePreviewArtifact};
export type RevenueWorkState={version:1;ownerKey:string;jobs:RevenueWorkJob[]};
export function revenueWorkCapacity(state:RevenueWorkState){const usedBytes=Buffer.byteLength(JSON.stringify(state));return {reached:state.jobs.length>=REVENUE_WORK_MAX_JOBS||usedBytes>MAX_BYTES-RESERVE_BYTES,usedJobs:state.jobs.length,maxJobs:REVENUE_WORK_MAX_JOBS,usedBytes,maxBytes:MAX_BYTES,reserveBytes:RESERVE_BYTES};}
const proof=(job:RevenueWorkJob)=>{const {proof,...body}=job;return digest(body);};
export function parseRevenueWork(raw:unknown,owner:string):RevenueWorkState{
 if(!owner.trim())throw Error("BUSINESS_OWNER_REQUIRED");if(raw===undefined)return {version:1,ownerKey:digest(owner),jobs:[]};
 const value=z.object({version:z.literal(1),ownerKey:z.string(),jobs:z.array(jobSchema).max(REVENUE_WORK_MAX_JOBS)}).strict().parse(raw) as RevenueWorkState;
 if(value.ownerKey!==digest(owner)||Buffer.byteLength(JSON.stringify(value))>MAX_BYTES||new Set(value.jobs.map(j=>j.id)).size!==value.jobs.length||new Set(value.jobs.map(j=>j.fence)).size!==value.jobs.length||new Set(value.jobs.map(j=>`${j.role}:${j.slot}:${j.generation}`)).size!==value.jobs.length)throw Error("BUSINESS_HISTORY_INVALID");
 for(const job of value.jobs){const start=Date.parse(job.startedAt),end=Date.parse(job.expiresAt),complete=Date.parse(job.completedAt||"");
  if(end-start!==TTL||job.slot!==job.startedAt.slice(0,10))throw Error("BUSINESS_LEASE_INVALID");
  if(["running","unknown"].includes(job.status)){if(job.completedAt||job.artifact||job.source||job.proof)throw Error("BUSINESS_UNCERTAIN_ARTIFACT");continue;}
  if(!Number.isFinite(complete)||complete<start||complete>=end||job.proof!==proof(job))throw Error("BUSINESS_COMPLETION_INVALID");
  if(job.source||job.artifact){if(!job.source||!job.artifact||job.reason)throw Error("BUSINESS_ARTIFACT_MISSING");const source=validateRevenuePreviewSource(job.source,owner,complete);if(Date.parse(source.observedAt)<start||digest(buildOfficeRevenuePreview(source,owner,(job.artifact as RevenuePreviewArtifact).candidateId,complete))!==digest(job.artifact)||job.status!=="completed")throw Error("BUSINESS_ARTIFACT_INVALID");}
  else if(job.status!=="blocked"||!["SOURCE_UNAVAILABLE","NO_ELIGIBLE_CANDIDATE","ARTIFACT_LIMIT"].includes(job.reason||""))throw Error("BUSINESS_BLOCK_INVALID");
 }
 return value;
}
/** GET adapter: no generation lookup, schema creation, filesystem or writes. */
export async function readRevenueWork(pool:BusinessPool,owner:string):Promise<RevenueWorkState>{
 if(!owner.trim()||!(await pool.query("SELECT id FROM users WHERE id=$1 LIMIT 1",[owner])).rows.length)throw Error("BUSINESS_OWNER_ABSENT");
 const result=await pool.query("SELECT data FROM revenue_engine_state WHERE owner_user_id=$1 AND kind=$2",[owner,REVENUE_WORK_KIND]);return parseRevenueWork(result.rows[0]?.data,owner);
}

/** getGeneration must read canonical careers, never mutate council or invoke a
 * provider: it runs under the SAME owner advisory lock as council mutations.
 * Source reads execute outside that lock. No business action or model is called. */
export function createRevenueWorkRunner(options:{pool:BusinessPool;owner:string;getGeneration:(role:BusinessRole)=>Promise<number|null|undefined>;now?:()=>number;shouldStop?:()=>boolean;readSource?:(role:BusinessRole,at:number)=>Promise<RevenuePreviewSource>}){
 const {pool,owner}=options,now=options.now||Date.now;if(!owner.trim())throw Error("BUSINESS_OWNER_REQUIRED");
 async function mutate(change:(state:RevenueWorkState)=>Promise<RevenueWorkState>){const db=await pool.connect();try{
  await db.query("BEGIN");await db.query("SET LOCAL lock_timeout='5s'");await db.query("SET LOCAL statement_timeout='10s'");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[createHash('sha256').update(owner).digest('hex')]);
  if(!(await db.query("SELECT id FROM users WHERE id=$1 LIMIT 1",[owner])).rows.length)throw Error("BUSINESS_OWNER_ABSENT");
  const rows=await db.query("SELECT data FROM revenue_engine_state WHERE owner_user_id=$1 AND kind=$2 FOR UPDATE",[owner,REVENUE_WORK_KIND]);const before=parseRevenueWork(rows.rows[0]?.data,owner),after=parseRevenueWork(await change(structuredClone(before)),owner);
  if(digest(before)!==digest(after))await db.query("INSERT INTO revenue_engine_state(owner_user_id,kind,data,revision,updated_at) VALUES($1,$2,$3::jsonb,1,now()) ON CONFLICT(owner_user_id,kind) DO UPDATE SET data=EXCLUDED.data,revision=revenue_engine_state.revision+1,updated_at=now()",[owner,REVENUE_WORK_KIND,JSON.stringify(after)]);
  await db.query("COMMIT");return after;
 }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}finally{db.release();}}
 return {read:()=>readRevenueWork(pool,owner),async tick(){let completed=0;
  for(const role of BUSINESS_ROLES){if(options.shouldStop?.())break;let assigned:RevenueWorkJob|undefined;const started=now(),id=randomUUID(),fence=randomUUID();
   await mutate(async state=>{assigned=undefined;state={...state,jobs:state.jobs.map(j=>j.status==="running"&&Date.parse(j.expiresAt)<=started?{...j,status:"unknown" as const,reason:"LEASE_EXPIRED" as const}:j)};
    if(options.shouldStop?.()||state.jobs.some(j=>j.status==="running"||(j.status==="unknown"&&j.role===role))||revenueWorkCapacity(state).reached)return state;
    const generation=await options.getGeneration(role);if(!Number.isSafeInteger(generation)||!generation||generation<1||state.jobs.some(j=>j.role===role&&j.generation===generation&&j.slot===new Date(started).toISOString().slice(0,10)))return state;
    assigned={id,fence,role,generation,slot:new Date(started).toISOString().slice(0,10),startedAt:new Date(started).toISOString(),expiresAt:new Date(started+TTL).toISOString(),status:"running"};return {...state,jobs:[...state.jobs,assigned]};
   });
   if(!assigned)continue;const job=assigned as RevenueWorkJob;let source:RevenuePreviewSource|undefined,artifact:RevenuePreviewArtifact|undefined;
   let failureReason:"SOURCE_UNAVAILABLE"|"NO_ELIGIBLE_CANDIDATE"="SOURCE_UNAVAILABLE";
   let admitted=false;
   await mutate(async state=>{admitted=false;const current=state.jobs.find(j=>j.id===id);if(!current||current.fence!==fence||current.status!=="running")return state;
    const generation=await options.getGeneration(role),at=now(),reason=options.shouldStop?.()?"STOP_REQUESTED":at>=Date.parse(current.expiresAt)?"LEASE_EXPIRED":generation!==current.generation?"HOLDER_CHANGED":undefined;
    if(reason)return {...state,jobs:state.jobs.map(j=>j.id===id?{...j,status:"unknown" as const,reason}:j)};
    admitted=true;return state;
   });
   if(!admitted)continue;
   let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
   try{const prior=await readRevenueWork(pool,owner);const excluded=new Set(prior.jobs.filter(j=>j.status==='completed'&&j.artifact).map(j=>revenueCandidateVersion({id:j.artifact!.candidateId,updatedAt:j.artifact!.sourceUpdatedAt})));const remaining=Date.parse(job.expiresAt)-now();if(remaining<=0)throw Error("EXPIRED");source=await Promise.race([options.readSource?options.readSource(role,now()):readRevenuePreviewSource(pool,owner,now(),excluded),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(Error("EXPIRED"));},remaining);})]);const next=source.items.find(c=>!prior.jobs.some(j=>j.status==='completed'&&j.artifact?.candidateId===c.id&&j.artifact?.sourceUpdatedAt===c.updatedAt));
    if(next)artifact=buildOfficeRevenuePreview(source,owner,next.id,now());else {source=undefined;failureReason="NO_ELIGIBLE_CANDIDATE";}}catch{source=undefined;artifact=undefined;}finally{if(timer)clearTimeout(timer);}
   await mutate(async state=>{const current=state.jobs.find(j=>j.id===id);if(!current||current.fence!==fence||current.status!=="running")return state;const generation=await options.getGeneration(role),at=now();
    let next:RevenueWorkJob;if(timedOut||at>=Date.parse(current.expiresAt))next={...current,status:"unknown",reason:"LEASE_EXPIRED"};else if(generation!==current.generation)next={...current,status:"unknown",reason:"HOLDER_CHANGED"};else{next={...current,status:artifact?"completed":"blocked",completedAt:new Date(at).toISOString(),...(source&&artifact?{source,artifact}:{reason:failureReason})};next.proof=proof(next);
     if(Buffer.byteLength(JSON.stringify({...state,jobs:state.jobs.map(j=>j.id===id?next:j)}))>MAX_BYTES){next={...current,status:"blocked",reason:"ARTIFACT_LIMIT",completedAt:new Date(at).toISOString()};next.proof=proof(next);}
     completed++;}
    return {...state,jobs:state.jobs.map(j=>j.id===id?next:j)};
   });
  }
  return {completed};
 }};
}
