import {readMarketingLearning} from "./marketing-learning-store";
import {readWebRoleSources,type WebRoleSource} from "./office-web-role-sources";
import {persistWebRoleSources} from "./office-web-role-store";
import {readOfficeSourceDocuments} from "./office-source-documents";
import path from "node:path";
import {startOfficeEditorialExporter} from "./office-editorial-scheduler";
import {withConnectionRetry} from "./office-source-pool";
let publicStatus:{enabled:boolean;lastExportAt:string|null;status:"disabled"|"pending"|"ready"|"unavailable";failureStage?:"read"|"persist";failureCode?:string}={enabled:false,lastExportAt:null,status:"disabled"};
export const officeWebSourceStatus=()=>({...publicStatus});
function safeExportFailure(error:unknown):string {
 const value=error && typeof error==="object"?error as {code?:unknown;name?:unknown;message?:unknown}:{};
 const codes=["42P01","42703","42501","23505","23502","23514","40001","40P01","57014","53300","57P01","08001","08006","ECONNREFUSED","ECONNRESET","ENOTFOUND","ETIMEDOUT"];
 if(typeof value.code==="string"&&codes.includes(value.code))return value.code;
 if(value.name==="ZodError")return "INVALID_SOURCE_SCHEMA";
 const known:Record<string,string>={"Canonical owner absent":"SOURCE_OWNER_ABSENT","Configured owner required":"SOURCE_OWNER_INVALID","Invalid web source provenance":"SOURCE_PROVENANCE_INVALID","Web source row capability mismatch":"SOURCE_ROW_INVALID","Future web source":"SOURCE_FUTURE_TIMESTAMP","Connection terminated due to connection timeout":"SOURCE_CONNECTION_TIMEOUT","Connection terminated unexpectedly":"SOURCE_CONNECTION_CLOSED","timeout exceeded when trying to connect":"SOURCE_POOL_TIMEOUT"};
 if(typeof value.message==="string" && Object.hasOwn(known,value.message))return known[value.message];
 return "UNVERIFIED_EXPORT";
}
export function createWebSourceExportCycle(options:{read:()=>Promise<WebRoleSource[]>;persist:(sources:WebRoleSource[])=>Promise<void>;now?:()=>number}){
 let running=false,stopped=false;const now=options.now || Date.now;
 return {stop(){stopped=true;},async tick(){if(running || stopped)return false;running=true;let failureStage:"read"|"persist"="read";
  try{const sources=await options.read();if(stopped)return false;failureStage="persist";await options.persist(sources);publicStatus={enabled:true,lastExportAt:new Date(now()).toISOString(),status:"ready"};return true;}
  catch(error){publicStatus={...publicStatus,enabled:true,status:"unavailable",failureStage,failureCode:safeExportFailure(error)};return false;}finally{running=false;}
 }};
}
export const OFFICE_SOURCE_CONNECT_TIMEOUT_MS=20000;
let installed=false;
/** Host-owned read/export only: no agents, model calls or publishers are started. */
export async function startOfficeWebSourceExporter(){
 if(process.env.OFFICE_WEB_SOURCE_EXPORT_ENABLED!=="true" || installed)return;
 if(process.env.AGENT_COUNCIL_STORAGE!=="postgres")throw Error("Web sources require production PostgreSQL");
 const [{default:pg},{resolveDatabaseConnectionString},{getSystemUserId}]=await Promise.all([import("pg"),import("./database-url"),import("./user-context")]);
 // One connection only. A serverless database can take well over ten seconds
 // to accept the first connection after both it and this autoscaled host wake,
 // so allow a longer connect and a bounded retry of connection-level failures.
 const owner=getSystemUserId(),raw=new pg.Pool({connectionString:resolveDatabaseConnectionString(),max:1,allowExitOnIdle:true,connectionTimeoutMillis:OFFICE_SOURCE_CONNECT_TIMEOUT_MS,statement_timeout:10000});
 raw.on("error",()=>undefined);
 const pool={...withConnectionRetry(raw),connect:()=>raw.connect()};
 const env=Object.fromEntries(["CLIPPERS_LOCAL_NEWS_WORKSPACE","DROPSHIPPING_PRODUCTS_PATH","DROPSHIPPING_SUPPLIERS_PATH","DROPSHIPPING_SOCIAL_METRICS_PATH","MARKETING_COMMAND_CENTER_LEARNING_PATH"].map(key=>[key,process.env[key]]));
 const cycle=createWebSourceExportCycle({read:()=>readWebRoleSources({pool,owner,configuredOwner:owner,root:process.cwd(),env,marketingLearning:()=>readMarketingLearning(pool,owner),sourceDocuments:()=>readOfficeSourceDocuments(pool,owner)}),persist:sources=>persistWebRoleSources(pool,owner,owner,sources)});
 installed=true;publicStatus={enabled:true,lastExportAt:null,status:"pending"};
 await startOfficeEditorialExporter({pool,owner,workspaceDir:path.resolve(env.CLIPPERS_LOCAL_NEWS_WORKSPACE||path.join(process.cwd(),"clippers_workspace/local-news"))});
 await cycle.tick();const timer=setInterval(()=>{void cycle.tick();},60000);timer.unref();
}

/** Wakes the existing autoscaled source host before reading its shared exports.
 * No bearer keys, commands or private records are sent to the health endpoint. */
export async function warmOfficeWebSources(origin:string,transport:typeof fetch=fetch){
 const base=new URL(origin);if(base.protocol!=="https:" || base.origin!==origin || base.username || base.password)throw Error("OFFICE_SOURCE_ORIGIN_INVALID");
 for(let attempt=0;attempt<12;attempt++){
  const response=await transport(new URL("/api/health",base),{redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error("OFFICE_SOURCE_HOST_UNAVAILABLE");
  const body=await response.json();const sources=body?.officeSources;
  if(sources?.enabled===true && sources.status==="ready" && Date.now()-Date.parse(sources.lastExportAt)>=0 && Date.now()-Date.parse(sources.lastExportAt)<240000)return;
  if(sources?.enabled!==true || sources.status==="unavailable")throw Error("OFFICE_SOURCE_EXPORT_UNAVAILABLE");
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw Error("OFFICE_SOURCE_EXPORT_NOT_READY");
}
