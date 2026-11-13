import {createHash,randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile,rename} from "node:fs/promises";
import path from "node:path";
import {createMarketingLearningStore,marketingLearningRunSchema,type SavedMarketingRun} from "./marketing-learning-store";
import {getMarketingCommandCenterSnapshot,runMarketingCommandCenterDay,withMarketingLearningContext,marketingCommandCenterDaySchema,marketingRequiresPostgres} from "./marketing-command-center";
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
type Store=Pick<ReturnType<typeof createMarketingLearningStore>,"read"|"prepare">;
export function createMarketingLearningService(store:Store,now:()=>number=Date.now){
 const snapshot=(owner:string,runs:SavedMarketingRun[])=>withMarketingLearningContext(owner,runs,getMarketingCommandCenterSnapshot);
 return {
  async get(owner:string){const runs=await store.read(owner);return {...snapshot(owner,runs||[]),ownerId:owner,history:{status:runs===null?"missing":"persisted",records:runs?.length||0}};},
  async prepare(owner:string,raw:unknown,key?:string){
   const parsed=marketingCommandCenterDaySchema.safeParse(raw);if(!parsed.success)throw Error("MARKETING_INPUT_INVALID");const input=parsed.data,at=new Date(now()).toISOString();
   if(key!==undefined&&!/^[a-zA-Z0-9:_-]{1,120}$/.test(key))throw Error("MARKETING_IDEMPOTENCY_KEY_INVALID");
   const identity=hash(JSON.stringify([key||at.slice(0,10),input.focusClientId]));
   const saved=await store.prepare(owner,identity,(runs,id)=>withMarketingLearningContext(owner,runs,()=>runMarketingCommandCenterDay(input).learning,{id,at}));
   return {status:"completed" as const,ownerId:owner,replayed:saved.replayed,summary:saved.run.summary,learning:saved.run,safety:{externalActionsBlocked:true,spentUsd:0,publishedExternally:0,clientDataMixed:false},snapshot:snapshot(owner,saved.runs)};
  },
 };
}
/** Development-only owner-isolated fallback. Legacy global files are never
 * automatically assigned to an authenticated owner. Production never calls it. */
export function createLocalMarketingLearningStore(root:string):Store{
 let queue:Promise<unknown>=Promise.resolve();
 const file=(owner:string)=>{if(!owner.trim())throw Error("MARKETING_OWNER_REQUIRED");return path.join(root,`${hash(owner)}.json`);};
 async function read(owner:string){try{const raw=JSON.parse(await readFile(file(owner),"utf8"));if(raw.ownerKey!==hash(owner)||raw.version!==1||!Array.isArray(raw.runs)||raw.runs.length>200)throw Error("MARKETING_HISTORY_INVALID");const runs=raw.runs.map((r:unknown)=>marketingLearningRunSchema.parse(r));if(new Set(runs.map((r:SavedMarketingRun)=>r.id)).size!==runs.length)throw Error("MARKETING_HISTORY_INVALID");return runs as SavedMarketingRun[];}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}}
 return {read,prepare(owner,key,build){const job=queue.then(async()=>{const runs=await read(owner)||[],id=`mkt-run-${hash(`${owner}:${key}`)}`,existing=runs.find(r=>r.id===id);if(existing)return {run:existing,runs,replayed:true};if(runs.length>=200)throw Error("MARKETING_HISTORY_FULL");const run=marketingLearningRunSchema.parse(build(runs,id));if(run.id!==id)throw Error("MARKETING_RUN_ID_MISMATCH");const next=[...runs,run],text=JSON.stringify({version:1,ownerKey:hash(owner),runs:next});if(Buffer.byteLength(text)>1000000)throw Error("MARKETING_HISTORY_FULL");await mkdir(root,{recursive:true});const target=file(owner),temporary=`${target}.${randomUUID()}.tmp`;await writeFile(temporary,text,{encoding:"utf8",flag:"wx"});await rename(temporary,target);return {run,runs:next,replayed:false};});queue=job.catch(()=>undefined);return job;}};
}
let durable:Promise<Store>|undefined,local:Store|undefined;
async function service(){
 if(marketingRequiresPostgres()){
  durable??=Promise.all([import("pg"),import("./database-url")]).then(([{Pool},{resolveDatabaseConnectionString}])=>createMarketingLearningStore(new Pool({connectionString:resolveDatabaseConnectionString(),max:2,allowExitOnIdle:true,connectionTimeoutMillis:10000,statement_timeout:10000})));
  return createMarketingLearningService(await durable);
 }
 local??=createLocalMarketingLearningStore(path.join(process.env.MARKETING_COMMAND_CENTER_LOCAL_ROOT||path.join(process.cwd(),"marketing_command_center_data"),"owners"));
 return createMarketingLearningService(local);
}
export const getMarketingCommandCenterForOwner=async(owner:string)=>(await service()).get(owner);
export const runMarketingCommandCenterForOwner=async(owner:string,input:unknown,key?:string)=>(await service()).prepare(owner,input,key);
