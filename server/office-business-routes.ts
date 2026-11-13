import type {Express} from "express";
import {getAuthenticatedCurrentUserId,getSystemUserId} from "./user-context";
import {createHash} from "node:crypto";
type HistoryJob={id:string;role:string;generation:number;status:string;startedAt:string;expiresAt:string;completedAt?:string;reason?:string;artifact?:{text:string;html?:string}};
type BusinessHistory={jobs:HistoryJob[];capacity?:{reached:boolean;usedJobs:number;maxJobs:number};availability?:Array<{role:string;available:boolean;reason:string}>};
let poolPromise:Promise<import("pg").Pool>|undefined;
function historyPool(){return poolPromise??=(async()=>{const {Pool}=await import("pg");const {resolveDatabaseConnectionString}=await import("./database-url");return new Pool({connectionString:resolveDatabaseConnectionString(),max:1,allowExitOnIdle:true,connectionTimeoutMillis:5000,statement_timeout:10000});})();}
export async function readOfficeDeliverableAvailability(pool:{query:(sql:string,params:any[])=>Promise<{rows:any[]}>},owner:string,roles:string[]){
 if(!owner.trim())throw Error("CAREER_OWNER_REQUIRED");
 const result=await pool.query("SELECT requested.role, state #> ARRAY['company','careers',requested.role,'generation'] AS generation, state #> ARRAY['company','careers',requested.role,'battery'] AS battery, state #> ARRAY['company','careers',requested.role,'inTrainingUntilGeneration'] AS training, state #> ARRAY['company','careers',requested.role,'scoreReconciliation'] AS reconciliation, COALESCE((state #> ARRAY['company','careers',requested.role]) ? 'scoreReconciliation',false) AS has_reconciliation, COALESCE((state #> ARRAY['company','careers',requested.role]) ? 'inTrainingUntilGeneration',false) AS has_training FROM agent_council_state CROSS JOIN unnest($2::text[]) AS requested(role) WHERE owner_key=$1",[createHash('sha256').update(owner).digest('hex'),roles]);
 if(result.rows.length!==roles.length)throw Error("CAREER_STATE_UNAVAILABLE");
 return result.rows.map(row=>{const reason=row.has_reconciliation?(row.reconciliation?.status==="needs_scope_qualification"?"historical_score_unverified":"unverified"):row.has_training?"training":!Number.isSafeInteger(row.generation)||row.generation<1||!Number.isFinite(row.battery)?"unverified":row.battery<=0?"depleted":"eligible_for_preparation";return{role:row.role,available:reason==="eligible_for_preparation",reason};});
}
async function readAvailability(owner:string,roles:string[]){return readOfficeDeliverableAvailability(await historyPool(),owner,roles);}
async function readHistory(owner:string):Promise<BusinessHistory>{
 const {readBusinessWork,businessWorkCapacity}=await import("./office-business-work");
 const history=await readBusinessWork(await historyPool(),owner);
 const {reached,usedJobs,maxJobs}=businessWorkCapacity(history);
 return {jobs:history.jobs,capacity:{reached,usedJobs,maxJobs},availability:await readAvailability(owner,["automations","portfolio"])};
}
async function readEditorial(owner:string):Promise<BusinessHistory>{
 const {readEditorialWork,editorialWorkCapacity}=await import("./office-editorial-work");
 const history=await readEditorialWork(await historyPool(),owner),{reached,usedJobs,maxJobs}=editorialWorkCapacity(history);
 return {jobs:history.jobs,capacity:{reached,usedJobs,maxJobs},availability:await readAvailability(owner,["news","news:ny-news","news:miami-news"])};
}
async function readRevenue(owner:string):Promise<BusinessHistory>{
 const {readRevenueWork,revenueWorkCapacity}=await import("./office-revenue-work");
 const history=await readRevenueWork(await historyPool(),owner),{reached,usedJobs,maxJobs}=revenueWorkCapacity(history);
 return {jobs:history.jobs,capacity:{reached,usedJobs,maxJobs},availability:await readAvailability(owner,["revenue"])};
}
/** Authenticated history only. Opening the panel never starts work or alters records. */
export function registerOfficeBusinessRoutes(app:Pick<Express,"get">,deps:{read?:typeof readHistory;readEditorial?:typeof readHistory;readRevenue?:typeof readHistory;systemOwner?:()=>string;now?:()=>number}={}){
 const routes=[{path:"business-work",read:deps.read??readHistory},{path:"editorial-work",read:deps.readEditorial??readEditorial},{path:"revenue-work",read:deps.readRevenue??readRevenue}];
 for(const route of routes)app.get(`/api/agents-office/${route.path}`,async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const owner=getAuthenticatedCurrentUserId(req);
  if(!owner)return res.status(401).json({error:"Inicia sesión para consultar los entregables."});
  try{
   if(owner!==(deps.systemOwner??getSystemUserId)())return res.status(403).json({error:"Los entregables pertenecen al propietario de esta oficina."});
   const history=await route.read(owner);
   const checkedAt=(deps.now??Date.now)();
   const jobs=history.jobs.map(({id,role,generation,status,startedAt,expiresAt,completedAt,reason,artifact})=>{
    const expired=status==="running"&&Date.parse(expiresAt)<=checkedAt;
    return {id,role,generation,status:expired?"unknown":status,startedAt,completedAt,reason:expired?"LEASE_EXPIRED":reason,...(artifact?{artifact:{text:artifact.text,...(route.path==="revenue-work"&&status==="completed"&&artifact.html?{html:artifact.html}:{})}}:{})};
   });
   return res.json({ownerId:owner,checkedAt:new Date(checkedAt).toISOString(),jobs,...(history.capacity?{capacity:history.capacity}:{}),...(history.availability?{availability:history.availability}:{})});
  }catch{return res.status(503).json({error:"No se pudo verificar el historial de entregables."});}
 });
}
