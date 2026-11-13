import {createHash,randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import type {Readable,Writable} from "node:stream";
export const ROLE_WORK_ACCEPTANCE_ID="office-role-work-owner-cas-v1";
export const ROLE_WORK_ASSERTIONS=["one-owner-reservation","completed-proof","restart-no-replay","foreign-owner-rejected","tamper-rejected","careers-unchanged"] as const;
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
/** Controller-owned assertions and state. A candidate only gets runtime RPCs;
 * it cannot write this controller's artifact or terminate this process. */
export async function measureRoleWorkAcceptance(runtime:{createRoleWorkRunner:Function;parseRoleWork:Function;remote?:boolean}){
 const started=performance.now(),at=Date.parse("2026-11-07T00:00:00Z"),owner=`factory-isolated-${randomUUID()}`;
 let state:any={roles:{version:1,roles:{control:{generation:1}}}},reads=0,source:any;
 const company:any={careers:{control:{generation:1,life:100}}},original=digest(company);
 let tail=Promise.resolve();
 const council={async updateOfficeExecution(change:Function){const next=tail.then(async()=>{state=stable(await change(structuredClone(state),company));return structuredClone(state);});tail=next.then(()=>undefined,()=>undefined);return next;}};
 const make=()=>runtime.createRoleWorkRunner({owner,council,now:()=>at,read:async(role:string)=>{reads++;if(role!=="control")throw Error("UNEXPECTED_ROLE");const body={version:1,role,ownerKey:digest(owner),observedAt:new Date(at).toISOString(),total:1,rows:[{id:randomUUID(),scope:"publish",level:"read_only",risk:"high",enabled:true}]};source={...body,sourceDigest:digest(body)};return source;}});
 const checks:Record<string,boolean>={};
 try{
  await Promise.all([make().tick(),make().tick()]);
  const journal=await runtime.parseRoleWork(state.roleWork,owner),job=journal.jobs[0];
  checks[ROLE_WORK_ASSERTIONS[0]]=reads===1&&journal.jobs.length===1&&job.role==="control"&&digest(journal)===digest(state.roleWork);
  checks[ROLE_WORK_ASSERTIONS[1]]=job?.status==="completed"&&digest(job.source)===digest(source)&&job.artifactId===digest({id:job.id,role:job.role,generation:job.generation,fence:job.fence,source:job.source,audit:job.audit});
  await make().tick();checks[ROLE_WORK_ASSERTIONS[2]]=reads===1&&(await runtime.parseRoleWork(stable(state.roleWork),owner)).jobs.length===1;
  try{await runtime.parseRoleWork(state.roleWork,`different-${randomUUID()}`);checks[ROLE_WORK_ASSERTIONS[3]]=false;}catch(error){if(runtime.remote&&(error as Error).message!=="QA_RUNTIME_REJECTED")throw error;checks[ROLE_WORK_ASSERTIONS[3]]=true;}
  const tampered=structuredClone(state.roleWork);tampered.jobs[0].source.rows[0].level="autonomous";
  try{await runtime.parseRoleWork(tampered,owner);checks[ROLE_WORK_ASSERTIONS[4]]=false;}catch(error){if(runtime.remote&&(error as Error).message!=="QA_RUNTIME_REJECTED")throw error;checks[ROLE_WORK_ASSERTIONS[4]]=true;}
  checks[ROLE_WORK_ASSERTIONS[5]]=digest(company)===original;
 }catch{/* Errors are bounded assertion failures; no raw environment/error data. */}
 return {scenarioId:ROLE_WORK_ACCEPTANCE_ID,kind:"backend-acceptance" as const,assertions:ROLE_WORK_ASSERTIONS.map(id=>({id,passed:checks[id]===true})),passed:ROLE_WORK_ASSERTIONS.every(id=>checks[id]===true),durationMs:performance.now()-started};
}
/** Bounded JSON RPC: no executable messages, unsolicited replies or console output.
 * UUID correlation prevents a child fabricating completion for another request. */
export function acceptanceRpc(input:Readable,output:Writable,handle:(op:string,value:any)=>Promise<any>){
 let buffer="",bytes=0,closed=false;const pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
 const close=()=>{if(closed)return;closed=true;for(const p of pending.values())p.reject(Error("QA_CHILD_UNCONFIRMED"));pending.clear();};
 const send=(v:any)=>{if(closed)throw Error("QA_RPC_CLOSED");const line=JSON.stringify(v)+"\n";if(Buffer.byteLength(line)>131072)throw Error("QA_RPC_LIMIT");output.write(line);};
 input.on("data",chunk=>{if(closed)return;bytes+=chunk.length;if(bytes>2097152){close();return;}buffer+=chunk.toString("utf8");if(Buffer.byteLength(buffer)>131072){close();return;}for(;!closed;){const end=buffer.indexOf("\n");if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const m=JSON.parse(line);if(!m||typeof m.id!=="string"||!/^[a-f0-9-]{36}$/.test(m.id))throw Error();if(m.type==="reply"){const p=pending.get(m.id);if(!p)throw Error();pending.delete(m.id);if(m.ok===true)p.resolve(m.value);else if(m.ok===false)p.reject(Error("QA_RUNTIME_REJECTED"));else throw Error();}else if(m.type==="request"&&typeof m.op==="string"){void handle(m.op,m.value).then(value=>send({type:"reply",id:m.id,ok:true,value}),()=>send({type:"reply",id:m.id,ok:false})).catch(close);}else throw Error();}catch{close();}}});
 input.once("end",close);input.once("error",close);output.once("error",close);
 return {close,request(op:string,value:any):Promise<any>{if(closed)return Promise.reject(Error("QA_RPC_CLOSED"));return new Promise((resolve,reject)=>{const id=randomUUID();pending.set(id,{resolve,reject});try{send({type:"request",id,op,value});}catch{pending.delete(id);reject(Error("QA_RPC_CLOSED"));}});}};
}
/** Connect the trusted harness to a separately isolated candidate runtime. */
export function remoteAcceptanceRuntime(input:Readable,output:Writable){
 const options=new Map<string,any>();let peer:ReturnType<typeof acceptanceRpc>;
 peer=acceptanceRpc(input,output,async(op,v)=>{
  const o=options.get(v?.runner);if(!o)throw Error("QA_RUNNER_UNKNOWN");
  if(op==="read")return o.read(v.role);
  if(op==="readWeb"&&typeof o.readWeb==="function")return o.readWeb(v.role);
  if(op==="transaction")return o.council.updateOfficeExecution(async(state:any,company:any)=>{const changed=await peer.request("mutate",{callback:v.callback,state,company});if(!changed||!changed.company||!changed.state)throw Error("QA_MUTATION_INVALID");for(const key of Object.keys(company))delete company[key];Object.assign(company,changed.company);return changed.state;});
  throw Error("QA_OPERATION_DENIED");
 });
 return {remote:true,close:peer.close,createRoleWorkRunner(o:any){const id=randomUUID();options.set(id,o);const ready=peer.request("create",{runner:id,owner:o.owner,now:o.now(),clockMode:o.clockMode,hasReadWeb:typeof o.readWeb==="function"});return {tick:async()=>{await ready;return peer.request("tick",{runner:id});}};},parseRoleWork:(state:any,owner:string)=>peer.request("parse",{state,owner})};
}
/** Guest bridge only. Candidate code executes here, never in the controller. */
export function serveAcceptanceRuntime(input:Readable,output:Writable,runtime:{createRoleWorkRunner:Function;parseRoleWork:Function;remote?:boolean}){
 const runners=new Map<string,any>(),callbacks=new Map<string,Function>();let peer:ReturnType<typeof acceptanceRpc>;
 peer=acceptanceRpc(input,output,async(op,v)=>{
  if(op==="create"){if(runners.size>=8||runners.has(v.runner))throw Error();const started=performance.now();runners.set(v.runner,runtime.createRoleWorkRunner({owner:v.owner,now:()=>v.now+(v.clockMode==="elapsed"?Math.floor(performance.now()-started):0),...(v.hasReadWeb?{readWeb:(role:string)=>peer.request("readWeb",{runner:v.runner,role})}:{}),read:(role:string)=>peer.request("read",{runner:v.runner,role}),council:{updateOfficeExecution:async(change:Function)=>{const callback=randomUUID();callbacks.set(callback,change);try{return await peer.request("transaction",{runner:v.runner,callback});}finally{callbacks.delete(callback);}}}}));return null;}
  if(op==="tick"){const runner=runners.get(v.runner);if(!runner)throw Error();await runner.tick();return null;}
  if(op==="parse")return runtime.parseRoleWork(v.state,v.owner);
  if(op==="mutate"){const callback=callbacks.get(v.callback);if(!callback)throw Error();return {state:callback(v.state,v.company),company:v.company};}
  throw Error("QA_OPERATION_DENIED");
 });return peer;
}


