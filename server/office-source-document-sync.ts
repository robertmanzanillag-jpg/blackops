import path from "node:path";
import {canonicalOfficeSourcePath,persistOfficeSourceDocument,prepareOfficeSourceDocument,type OfficeSourceDocumentKind,type PreparedOfficeSourceDocument,type SourceQuery} from "./office-source-documents";

/** Write-through from the existing producers (which keep writing their files
 * for backward compatibility). The document is validated and projected
 * synchronously when the file is written, so later in-memory mutation cannot
 * change it; persistence is asynchronous, serial and coalesced per document
 * (latest wins). A failure never breaks the producer and never logs details. */
type Pending={owner:string|null;prepared:PreparedOfficeSourceDocument;writtenAt:string};
export type OfficeSourceSyncStatus={enabled:boolean;written:number;skipped:number;failed:number;lastFailureCode?:string};
const SAFE_CODES=new Set(["42P01","42703","42501","23505","23502","23514","40001","40P01","57014","53300","57P01","08001","08006","ECONNREFUSED","ECONNRESET","ENOTFOUND","ETIMEDOUT"]);
function failureCode(error:unknown):string {
 const value=error && typeof error==="object"?error as {code?:unknown;message?:unknown}:{};
 if(typeof value.code==="string" && SAFE_CODES.has(value.code))return value.code;
 if(value.message==="Canonical owner absent")return "SOURCE_OWNER_ABSENT";
 return "UNVERIFIED_WRITE";
}
export function createOfficeSourceDocumentSync(options:{persist:(owner:string|null,prepared:PreparedOfficeSourceDocument,writtenAt:string)=>Promise<{written:boolean}>;now?:()=>number;maxPending?:number}){
 const now=options.now??Date.now,maxPending=options.maxPending??32,pending=new Map<string,Pending>();
 let running:Promise<void>|null=null,lastAt=0;const status:OfficeSourceSyncStatus={enabled:true,written:0,skipped:0,failed:0};
 async function drain(){
  while(pending.size){
   const [id,item]=pending.entries().next().value as [string,Pending];pending.delete(id);
   try{const result=await options.persist(item.owner,item.prepared,item.writtenAt);if(result.written)status.written++;else status.skipped++;}
   catch(error){status.failed++;status.lastFailureCode=failureCode(error);}
  }
 }
 return {
  /** Returns false when the document is not accepted (queue full or bad key). */
  queue(input:{kind:OfficeSourceDocumentKind;raw:unknown;owner?:string|null;key?:string}):boolean {
   const key=input.key??"",id=`${input.owner??""}\u0000${input.kind}\u0000${key}`;
   if(!pending.has(id) && pending.size>=maxPending){status.failed++;status.lastFailureCode="SYNC_QUEUE_FULL";return false;}
   let prepared:PreparedOfficeSourceDocument;
   try{prepared=prepareOfficeSourceDocument(input.kind,input.raw,{owner:input.owner??"",key});}catch{status.failed++;status.lastFailureCode="INVALID_DOCUMENT_KEY";return false;}
   // Strictly increasing per process so the DB guard keeps local write order.
   const at=Math.max(now(),lastAt+1);lastAt=at;
   pending.set(id,{owner:input.owner??null,prepared,writtenAt:new Date(at).toISOString()});
   if(!running)running=drain().finally(()=>{running=null;});
   return true;
  },
  flush:async()=>{while(running)await running;},
  status:():OfficeSourceSyncStatus=>({...status}),
 };
}

let shared:ReturnType<typeof createOfficeSourceDocumentSync>|null=null;
function enabled(env:NodeJS.ProcessEnv=process.env){return env.OFFICE_SOURCE_DOCUMENTS_ENABLED==="true" && env.AGENT_COUNCIL_STORAGE==="postgres";}
function sharedSync(){
 if(shared)return shared;
 let pool:Promise<SourceQuery>|null=null,owner:string|null=null;
 const connect=async():Promise<SourceQuery>=>{
  const [{default:pg},{resolveDatabaseConnectionString},{withConnectionRetry},{getSystemUserId}]=await Promise.all([import("pg"),import("./database-url"),import("./office-source-pool"),import("./user-context")]);
  owner=getSystemUserId();
  const raw=new pg.Pool({connectionString:resolveDatabaseConnectionString(),max:1,allowExitOnIdle:true,connectionTimeoutMillis:20000,statement_timeout:10000});
  raw.on("error",()=>undefined);
  return withConnectionRetry(raw);
 };
 shared=createOfficeSourceDocumentSync({persist:async(explicitOwner,prepared,writtenAt)=>{
  pool??=connect().catch(error=>{pool=null;throw error;});const db=await pool;
  return persistOfficeSourceDocument(db,explicitOwner??owner??"",prepared,writtenAt);
 }});
 return shared;
}

/** Called right after a producer wrote one of the canonical source files.
 * No-op unless OFFICE_SOURCE_DOCUMENTS_ENABLED=true with production PostgreSQL,
 * and only for the exact canonical path the office reader would read (tests and
 * alternate workspaces are never mirrored). owner defaults to the canonical
 * system user; Clippers reports pass the report's own userId. */
export function mirrorOfficeSourceFile(input:{kind:OfficeSourceDocumentKind;filePath:string;raw:unknown;owner?:string}):boolean {
 try{
  if(!enabled())return false;
  const key=input.kind==="clip_report"?path.basename(input.filePath):"";
  const canonical=canonicalOfficeSourcePath(input.kind,{root:process.cwd(),env:process.env,key:key||undefined});
  if(path.resolve(input.filePath)!==canonical)return false;
  return sharedSync().queue({kind:input.kind,raw:input.raw,owner:input.owner??null,key});
 }catch{return false;}
}
export function officeSourceDocumentSyncStatus():OfficeSourceSyncStatus {return shared?shared.status():{enabled:enabled(),written:0,skipped:0,failed:0};}
