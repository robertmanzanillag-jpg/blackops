import {recoverableFailedBuild,buildRecoveryDigest} from "./software-factory-build-recovery";
import {createHash} from "node:crypto";
import type {FactoryJob} from "./software-factory-store";
import {proposalEvidenceGate,type FactoryProject} from "./software-factory";
import type {FactoryPipelineState} from "./software-factory-pipeline";
import type {FactoryOrderProposal} from "../shared/software-factory-view";
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ownerHash=(owner:string)=>createHash("sha256").update(owner).digest("hex");
const safeId=(value:unknown):value is string=>typeof value==="string"&&/^[a-zA-Z0-9:_-]{1,200}$/.test(value);
const stateOf=(job:FactoryJob)=>(job.result as {evidence?:{pipelineState?:FactoryPipelineState}}|undefined)?.evidence?.pipelineState;
/** Reads bounded terminal chains only. No admission, order mutation, artifact fetch,
 * provider call, generation attribution or publication claim. */
export async function readFactoryOrderProposals(options:{owner:string;jobs:FactoryJob[];projects:FactoryProject[];getCompletedJob:(ownerKey:string,id:string)=>Promise<FactoryJob|undefined>;getRecoveredBuild?:(ownerKey:string,failedId:string,successorId:string)=>Promise<FactoryJob|undefined>;now?:number;readBudgetMs?:number;monotonicNow?:()=>number}):Promise<{proposals:FactoryOrderProposal[];status:"complete"|"unavailable"|"partial"}> {
 const owner=ownerHash(options.owner),seen=new Set<string>(),out:FactoryOrderProposal[]=[],now=options.now??Date.now();
 const clock=options.monotonicNow??(()=>performance.now()),budget=Math.min(5000,Math.max(1,options.readBudgetMs??5000)),deadline=clock()+budget;
 const answer=(status:"complete"|"unavailable"|"partial")=>({proposals:out,status});
 const storageFailure=Symbol("storage unavailable");
 const read=async<T>(operation:()=>Promise<T>):Promise<T>=>{
  const remaining=deadline-clock();if(remaining<=0)throw storageFailure;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation().catch(()=>{throw storageFailure;}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(storageFailure),remaining);})]);}finally{if(timer)clearTimeout(timer);}
 };
 if(!options.owner.trim()||!Number.isFinite(now))return answer("unavailable");
 for(const terminal of options.jobs.filter(j=>j.kind==="review"&&j.status==="completed").slice(0,20)){
  try{
   if(clock()>=deadline)throw storageFailure;
   if(seen.has(terminal.id))continue;seen.add(terminal.id);
   const result=terminal.result as {reason?:string;status?:string;next?:unknown};
   if(result?.reason!=="FACTORY_PR_REVIEWED_NOT_DEPLOYED"||result.status!=="completed"||result.next)continue;
   const project=options.projects.find(p=>p.id===terminal.projectId),state=stateOf(terminal),end=Date.parse(terminal.completedAt||"");
   if(!project||!state||!state.candidate||!Number.isFinite(end)||end>now||!proposalEvidenceGate(project,state.candidate,state.evidence,end).allowed)continue;
   const chain:FactoryJob[]=[];let rootFinding=state.finding;let job:FactoryJob|undefined=terminal;
   for(const kind of ["review","simulate","build","discover"] as const){
    if(!job||job.ownerKey!==owner||job.kind!==kind||job.status!=="completed"||(job.result as {status?:string})?.status!=="completed"||job.projectId!==project.id||!safeId(job.id))throw Error("unverified chain");
    const snapshot=stateOf(job),finished=Date.parse(job.completedAt||""),started=Date.parse(job.createdAt);
    if(!snapshot||snapshot.version!==1||snapshot.projectId!==project.id||snapshot.rootJobId!==state.rootJobId||buildRecoveryDigest(snapshot.finding)!==buildRecoveryDigest(kind==="discover"?rootFinding:state.finding)||!Number.isFinite(finished)||!Number.isFinite(started)||finished<started||finished>end)throw Error("unverified state");
    if(kind!=="discover"&&(buildRecoveryDigest(snapshot.candidate)!==buildRecoveryDigest(state.candidate)||(kind!=="build"&&job.headSha!==state.candidate.headSha)))throw Error("revision mismatch");
    const expectedCount={discover:0,build:1,simulate:2,review:3}[kind]!;
    if(snapshot.evidence.length!==expectedCount||buildRecoveryDigest(snapshot.evidence)!==buildRecoveryDigest(state.evidence.slice(0,expectedCount)))throw Error("evidence chain mismatch");
    const later=chain.at(-1);if(later&&(later.payload.previousJobId!==job.id||later.key!==`${job.id}.next`||Date.parse(later.createdAt)<finished))throw Error("broken predecessor");
    chain.push(job);
    if(kind==="build"&&job.key===`${job.payload.previousJobId}.repair`){
     if(!options.getRecoveredBuild)throw Error("missing recovery ledger");
     let successor:FactoryJob=job;
     for(let attempt=0;attempt<2;attempt++){
      const failedId=successor.payload.previousJobId;if(!safeId(failedId))throw Error("invalid recovery predecessor");
      const failed=await read(()=>options.getRecoveredBuild!(owner,failedId,successor.id));
      if(!failed||failed.ownerKey!==owner||failed.projectId!==project.id||failed.id!==failedId||successor.key!==`${failed.id}.repair`)throw Error("unverified recovery");
      const old=recoverableFailedBuild(failed),marker=successor.payload.recovery as {rebase?:{originalBaseSha?:string;targetBaseSha?:string}};
      if(old.rootJobId!==state.rootJobId||successor.payload.repairAttempts!==old.repairAttempts+1||marker?.rebase?.originalBaseSha!==old.finding.baseSha||marker.rebase.targetBaseSha!==rootFinding.baseSha||buildRecoveryDigest({...old.finding,baseSha:rootFinding.baseSha})!==buildRecoveryDigest(rootFinding)||!Number.isFinite(Date.parse(failed.completedAt!))||Date.parse(failed.completedAt!)>Date.parse(successor.createdAt))throw Error("recovery identity mismatch");
      rootFinding=old.finding;chain.push(failed);successor=failed;
      if(failed.key!==`${failed.payload.previousJobId}.repair`)break;
      if(attempt===1)throw Error("recovery limit");
     }
     job=successor;
    }
    if(kind!=="discover"){const previous:unknown=job?.payload.previousJobId;if(!safeId(previous))throw Error("missing predecessor");job=await read(()=>options.getCompletedJob(owner,previous));}
   }
   const root=chain.at(-1)!,source=root.payload.companyOrder as {version?:number;company?:string;orderId?:string;revision?:string}|undefined;
   if(root.id!==state.rootJobId||!source||source.version!==1||source.company!=="main"||!safeId(source.orderId)||!source.revision||!/^[a-f0-9]{64}$/.test(source.revision)||root.key!==`company-order:${hash([project.id,source.orderId,source.revision])}`||state.finding.id!==root.key||!state.finding.artifactIds.includes(`company-order-sha256:${source.revision}`)||state.finding.baseSha!==state.candidate.baseSha)continue;
   // Metadata is evidence registered by the trusted factory, not independent
   // verification of artifact bytes or of the current/deleted/edited office order.
   out.push({orderId:source.orderId,orderRevision:source.revision,reviewJobId:terminal.id,projectId:project.id,prUrl:state.candidate.prUrl,baseSha:state.candidate.baseSha,headSha:state.candidate.headSha,completedAt:terminal.completedAt!,evidenceCount:state.evidence.length,scope:"reviewed_proposal",orderLink:"historical_unverified",published:false,careerCredit:false});
  }catch(error){if(error===storageFailure)return answer(out.length?"partial":"unavailable");/* Malformed chains never become proof. */}
 }
 return answer("complete");
}

/** Read the existing PostgreSQL recovery receipt only. No migration or fallback
 * across operator-selected storage backends is allowed. */
let recoveryPool:import("./agent-council-store").CouncilPool|undefined;
export async function readFactoryRecoveredBuild(ownerKey:string,failedId:string,successorId:string){
 if((process.env.SOFTWARE_FACTORY_STORAGE_BACKEND||"postgres")!=="postgres"||process.env.SOFTWARE_FACTORY_STORE_MODULE)return undefined;
 if(!recoveryPool){const {Pool}=await import("pg"),{resolveDatabaseConnectionString}=await import("./database-url");recoveryPool=new Pool({connectionString:resolveDatabaseConnectionString(),max:1,allowExitOnIdle:true,connectionTimeoutMillis:5000,statement_timeout:5000}) as unknown as import("./agent-council-store").CouncilPool;}
 const {loadFailedBuildRecovery}=await import("./software-factory-build-recovery");return loadFailedBuildRecovery(recoveryPool,ownerKey,failedId,successorId);
}
