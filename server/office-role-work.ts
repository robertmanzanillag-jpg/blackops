import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {createAgentCouncil} from "./agent-council";
import {auditSavedRole,type RoleAudit} from "./office-role-audits";
import {GITHUB_AUDIT_ROLES,PENDING_OFFICE_ROLES,SQL_AUDIT_ROLES,sourceDigest,validateRoleSnapshot,type GithubAuditRole,type PendingOfficeRole,type RoleSnapshot,type SqlAuditRole} from "./office-role-snapshots";
import {WEB_SOURCE_ROLES,auditWebRoleSource,validateWebRoleSource,type WebRoleSource,type WebSourceRole} from "./office-web-role-sources";

type WebWorkAudit=ReturnType<typeof auditWebRoleSource>|ReturnType<typeof missingWebAudit>;
function missingWebAudit(role:PendingOfficeRole,invalid=false){return {role,capability:"exported-source-audit-v1",status:"blocked" as const,selected:0,total:null,completeCoverage:false,counts:{},metrics:{},diagnostics:[invalid?"EXPORT_INVALID_OR_STALE":"EXPORT_MISSING"],scope:"No hay una exportación canónica vigente; no acredita ejecución ni entrenamiento."};}
export type RoleWorkJob={id:string;role:PendingOfficeRole;generation:number;slot:string;fence:string;startedAt:string;expiresAt:string;status:"running"|"completed"|"blocked"|"unknown";completedAt?:string;reason?:string;source?:RoleSnapshot;audit?:RoleAudit;webSource?:WebRoleSource;webAudit?:WebWorkAudit;artifactId?:string};
export type RoleWorkState={version:1;ownerKey:string;jobs:RoleWorkJob[]};
const jobSchema=z.object({id:z.string().uuid(),role:z.enum(PENDING_OFFICE_ROLES),generation:z.number().int().positive(),slot:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),fence:z.string().uuid(),startedAt:z.string().datetime(),expiresAt:z.string().datetime(),status:z.enum(["running","completed","blocked","unknown"]),completedAt:z.string().datetime().optional(),reason:z.enum(["source_unavailable","lease_or_generation_changed","expired_no_automatic_retry","web_export_missing","web_export_unverified"]).optional(),source:z.unknown().optional(),audit:z.unknown().optional(),webSource:z.unknown().optional(),webAudit:z.unknown().optional(),artifactId:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
const ttl=60000;
const proof=(job:Pick<RoleWorkJob,"id"|"role"|"generation"|"fence"|"source"|"audit"|"webSource"|"webAudit">)=>sourceDigest({id:job.id,role:job.role,generation:job.generation,fence:job.fence,...(job.source?{source:job.source}:{}),audit:job.audit,...(job.webSource?{webSource:job.webSource}:{}),...(job.webAudit?{webAudit:job.webAudit}:{})});

/** Historical validation uses the recorded completion clock. Aging a valid
 * report must not make the entire durable journal unreadable tomorrow. */
export function parseRoleWork(value:unknown,owner:string):RoleWorkState {
 if(!owner.trim())throw new Error("Role audit owner required");
 if(value===undefined)return {version:1,ownerKey:sourceDigest(owner),jobs:[]};
 const parsed=z.object({version:z.literal(1),ownerKey:z.string(),jobs:z.array(jobSchema).max(256)}).strict().parse(value);
 if(parsed.ownerKey!==sourceDigest(owner))throw new Error("Role audit owner mismatch");
 const jobs=parsed.jobs as RoleWorkJob[];
 if(new Set(jobs.map(j=>j.id)).size!==jobs.length || new Set(jobs.map(j=>j.fence)).size!==jobs.length || new Set(jobs.map(j=>`${j.role}:${j.slot}`)).size!==jobs.length)throw new Error("Duplicate role audit assignment");
 for(const job of jobs){
  const start=Date.parse(job.startedAt),end=Date.parse(job.expiresAt),completed=job.completedAt?Date.parse(job.completedAt):NaN;
  if(end-start!==ttl || job.slot!==job.startedAt.slice(0,10))throw new Error("Invalid role audit lease");
  if((job.webSource!==undefined || job.webAudit!==undefined) && (job.source!==undefined || job.audit!==undefined || !WEB_SOURCE_ROLES.includes(job.role as WebSourceRole)))throw new Error("Mixed role audit compartments");
  if(["running","unknown"].includes(job.status)){
   if(job.audit!==undefined || job.source!==undefined || job.webSource!==undefined || job.webAudit!==undefined || job.artifactId!==undefined || job.completedAt!==undefined)throw new Error("Unfinished role audit cannot contain proof");
  }else{
   if(!Number.isFinite(completed) || completed<start || completed>=end || (!job.audit && !job.webAudit) || !job.artifactId)throw new Error("Missing role audit proof");
   if(job.webAudit){
    if(job.webSource && (job.webSource.role!==job.role || Date.parse(job.webSource.observedAt)<start-300000))throw new Error("Web export assignment mismatch");
    if(!job.webSource && !["web_export_missing","web_export_unverified"].includes(job.reason||""))throw new Error("Missing export block reason");
    const expected=job.webSource?auditWebRoleSource(job.webSource,owner,completed):missingWebAudit(job.role,job.reason==="web_export_unverified");
    if(sourceDigest(expected)!==sourceDigest(job.webAudit) || expected.status!==job.status || job.artifactId!==proof(job))throw new Error("Web role audit proof mismatch");
    continue;
   }
   if(job.source){if(job.source.role!==job.role || Date.parse(job.source.observedAt)<start-30000)throw new Error("Role audit source assignment mismatch");validateRoleSnapshot(job.source,owner,completed);}
   const expected=auditSavedRole(job.role,job.source,owner,completed,{sourceAttempted:job.reason==="source_unavailable"});
   if(sourceDigest(expected)!==sourceDigest(job.audit) || job.status!==expected.status || job.artifactId!==proof(job))throw new Error("Role audit proof mismatch");
  }
 }
 return {version:1,ownerKey:parsed.ownerKey,jobs};
}

export function createRoleWorkRunner(options:{council:Pick<ReturnType<typeof createAgentCouncil>,"updateOfficeExecution">;owner:string;read:(role:SqlAuditRole)=>Promise<RoleSnapshot>;readGithub?:(role:GithubAuditRole)=>Promise<RoleSnapshot>;readWeb?:(role:WebSourceRole)=>Promise<WebRoleSource|null>;now?:()=>number;shouldStop?:()=>boolean}) {
 const now=options.now || Date.now;
 return {async tick(){
  for(const role of PENDING_OFFICE_ROLES){
   if(options.shouldStop?.())break;
   const start=now(),slot=new Date(start).toISOString().slice(0,10),id=randomUUID(),fence=randomUUID();let assignment:RoleWorkJob|undefined;
   await options.council.updateOfficeExecution((state,company)=>{
    assignment=undefined;
    const journal=parseRoleWork(state.roleWork,options.owner);
    const jobs:RoleWorkJob[]=journal.jobs.map(j=>j.status==="running" && Date.parse(j.expiresAt)<=start?{...j,status:"unknown" as const,reason:"expired_no_automatic_retry"}:j);
    const career=company.careers[role],holder=state.roles.roles[role];
    if(!career || !holder || holder.generation!==career.generation || jobs.some(j=>j.role===role && (j.slot===slot || ["running","unknown"].includes(j.status))))return {...state,roleWork:{...journal,jobs}};
    // Retain a bounded completed history, but never discard uncertain work.
    const finished=jobs.filter(j=>!["running","unknown"].includes(j.status)).slice(-55);
    const retained=jobs.filter(j=>["running","unknown"].includes(j.status)||finished.some(f=>f.id===j.id));
    if(retained.length>=256)throw new Error("Role audit journal requires reconciliation");
    assignment={id,role,generation:career.generation,slot,fence,startedAt:new Date(start).toISOString(),expiresAt:new Date(start+ttl).toISOString(),status:"running"};
    return {...state,roleWork:{...journal,jobs:[...retained,assignment]}};
   });
   if(!assignment)continue;
   const job:RoleWorkJob=assignment;let source:RoleSnapshot|undefined,sourceFailed=false,webSource:WebRoleSource|undefined,webInvalid=false;
   let timedOut=false;
   // Bound the wait, not just admission. The losing read has no journal
   // callback; Promise.race also consumes a late rejection.
   const readWithinLease=async<T>(read:()=>Promise<T>):Promise<T>=>{
    const remaining=Date.parse(job.expiresAt)-now();
    if(remaining<=0){timedOut=true;throw new Error("Read lease expired");}
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
     return await Promise.race([
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(new Error("Read lease expired"));},remaining);}),
      Promise.resolve().then(read),
     ]);
    }finally{if(timer!==undefined)clearTimeout(timer);}
   };
   const webMode=!!options.readWeb && WEB_SOURCE_ROLES.includes(role as WebSourceRole);
   const githubMode=!!options.readGithub && GITHUB_AUDIT_ROLES.includes(role as GithubAuditRole);
   if(SQL_AUDIT_ROLES.includes(role as SqlAuditRole) || githubMode){
    try {
     if(options.shouldStop?.() || now()>=Date.parse(job.expiresAt))throw new Error("Read not admitted");
     source=await readWithinLease(()=>githubMode?options.readGithub!(role as GithubAuditRole):options.read(role as SqlAuditRole));
     if(source.role!==role || Date.parse(source.observedAt)<start-30000)throw new Error("Source assignment mismatch");
     validateRoleSnapshot(source,options.owner,now());
    }catch{source=undefined;sourceFailed=true;}
   }
   if(webMode){
    try{if(options.shouldStop?.() || now()>=Date.parse(job.expiresAt))throw new Error("Read not admitted");const exported=await readWithinLease(()=>options.readWeb!(role as WebSourceRole));if(exported){webSource=validateWebRoleSource(exported,options.owner);if(webSource.role!==role || Date.parse(webSource.observedAt)<start-300000)throw new Error("Web source mismatch");auditWebRoleSource(webSource,options.owner,now());}}
    catch{webSource=undefined;webInvalid=true;}
   }
   await options.council.updateOfficeExecution((state,company)=>{
    const journal=parseRoleWork(state.roleWork,options.owner),stored=journal.jobs.find(j=>j.id===job.id);
    if(!stored || stored.fence!==fence || stored.status!=="running")return state;
    const end=now(),holder=state.roles.roles[role],career=company.careers[role];
    let done:RoleWorkJob;
    if(timedOut || end>=Date.parse(stored.expiresAt)){done={...stored,status:"unknown",reason:"expired_no_automatic_retry"};}
    else if(end<start || holder?.generation!==job.generation || career?.generation!==job.generation){done={...stored,status:"unknown",reason:"lease_or_generation_changed"};}
    else if(webMode){
     let verified=webSource,invalid=webInvalid,webAudit:WebWorkAudit;
     try{webAudit=verified?auditWebRoleSource(verified,options.owner,end):missingWebAudit(role,invalid);}catch{verified=undefined;invalid=true;webAudit=missingWebAudit(role,true);}
     done={...stored,status:webAudit.status==="completed"?"completed":"blocked",completedAt:new Date(end).toISOString(),webAudit,...(verified?{webSource:verified}:{reason:invalid?"web_export_unverified":"web_export_missing"})};done.artifactId=proof(done);
    }else {
     // Recompute inside the short transaction so historical evidence binds the
     // actual completion clock, including data-age and schedule findings.
     let audit:RoleAudit,verifiedSource=source,failed=sourceFailed;
     try{audit=auditSavedRole(role,verifiedSource,options.owner,end,{sourceAttempted:failed});}catch{verifiedSource=undefined;failed=true;audit=auditSavedRole(role,undefined,options.owner,end,{sourceAttempted:true});}
     done={...stored,status:audit.status,completedAt:new Date(end).toISOString(),...(verifiedSource?{source:verifiedSource}:{}),audit,...(failed?{reason:"source_unavailable"}:{})};
     done.artifactId=proof(done);
    }
    return {...state,roleWork:{...journal,jobs:journal.jobs.map(j=>j.id===job.id?done:j)}};
   });
  }
 }};
}
