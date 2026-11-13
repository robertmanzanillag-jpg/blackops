import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,readdir,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createMarketingLearningStore,MARKETING_LEARNING_KIND,type MarketingPool} from "../server/marketing-learning-store";
import {createMarketingLearningService,createLocalMarketingLearningStore} from "../server/marketing-learning-service";
import {setMarketingCommandCenterLearningPathForTests,getMarketingCommandCenterSnapshot} from "../server/marketing-command-center";
const NOW=Date.parse("2026-11-07T03:00:00Z");
function fixture(){
 const data=new Map<string,unknown>(),queries:Array<{sql:string;params:any[]}>=[];let tail:Promise<void>=Promise.resolve(),failWrite=false,failCommit=false,loseAck=false;
 const query=async(sql:string,params:any[]=[]):Promise<{rows:any[]}>=>{
  queries.push({sql,params});if(sql.startsWith("SELECT id FROM users"))return {rows:["a","b"].includes(params[0])?[{id:params[0]}]:[]};
  if(sql.startsWith("SELECT data FROM revenue_engine_state"))return {rows:data.has(params[0])?[{data:structuredClone(data.get(params[0]))}]:[]};
  throw Error(`Unexpected read: ${sql}`);
 };
 const pool:MarketingPool={query,async connect(){let releaseLock:(()=>void)|undefined,pending:{owner:string;data:unknown}|undefined;return {release(){releaseLock?.();releaseLock=undefined;},async query(sql,params=[]){
  if(sql.includes("pg_advisory_xact_lock")){const old=tail;tail=new Promise<void>(resolve=>{releaseLock=resolve;});await old;queries.push({sql,params});return {rows:[]};}
  if(sql.startsWith("INSERT INTO")){queries.push({sql,params});if(failWrite)throw Error("private connection failure");pending={owner:params[0],data:JSON.parse(params[2])};return {rows:[]};}
  if(sql==="COMMIT"){if(failCommit)throw Error("commit failed");if(pending)data.set(pending.owner,pending.data);if(loseAck)throw Error("commit acknowledgement lost");return {rows:[]};}
  if(sql==="ROLLBACK"){pending=undefined;return {rows:[]};}
  if(sql==="BEGIN"||sql.startsWith("SET LOCAL"))return {rows:[]};return query(sql,params);
 }};}};
 return {pool,data,queries,failWrite:(value:boolean)=>{failWrite=value;},failCommit:(value:boolean)=>{failCommit=value;},loseAck:(value:boolean)=>{loseAck=value;}};
}

test("GET is read-only and missing; POST persists owner-bound preparation across instances and JSONB order",async()=>{
 const f=fixture(),service=createMarketingLearningService(createMarketingLearningStore(f.pool),()=>NOW);
 setMarketingCommandCenterLearningPathForTests(path.join(os.tmpdir(),"must-not-read-marketing","absent.json"));
 const before=await service.get("a");assert.equal(before.history.status,"missing");assert.equal(f.data.size,0);assert.equal(before.globalScorecard.readyClients,0);assert.equal(before.evidence.metricsVerified,false);
 const saved=await service.prepare("a",{focusClientId:"all"});assert.equal(saved.learning.clientsReviewed,4);assert.equal(saved.snapshot.globalScorecard.readyClients,0);assert.equal(saved.snapshot.subagents.every(a=>a.status==="planned"),true);
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;f.data.set("a",reorder(f.data.get("a")));
 const restarted=createMarketingLearningService(createMarketingLearningStore(f.pool),()=>NOW+1000),after=await restarted.get("a");assert.equal(after.history.status,"persisted");assert.deepEqual(after.recentLearningRuns,[saved.learning]);assert.equal((await restarted.get("b")).recentLearningRuns.length,0);
 assert.ok(f.queries.filter(q=>q.sql.includes("revenue_engine_state")).every(q=>q.params[1]===MARKETING_LEARNING_KIND));assert.ok(f.queries.every(q=>!q.sql.includes("CREATE TABLE")));
 const repeated=await restarted.prepare("a",{focusClientId:"all"});assert.equal(repeated.replayed,true);assert.equal(repeated.learning.id,saved.learning.id);
 setMarketingCommandCenterLearningPathForTests(null);
});

test("ambiguous COMMIT acknowledgement never reports success; retry reads the same committed identity",async()=>{
 const f=fixture(),service=createMarketingLearningService(createMarketingLearningStore(f.pool),()=>NOW);f.loseAck(true);await assert.rejects(()=>service.prepare("a",{},"lost-ack"));assert.equal(f.data.size,1);f.loseAck(false);const retried=await service.prepare("a",{},"lost-ack");assert.equal(retried.replayed,true);assert.equal((await service.get("a")).history.records,1);
});

test("concurrent same-key POSTs produce one durable run; owner/focus/day have separate identities",async()=>{
 const f=fixture();const make=(at=NOW)=>createMarketingLearningService(createMarketingLearningStore(f.pool),()=>at);
 const results=await Promise.all(Array.from({length:6},()=>make().prepare("a",{focusClientId:"all"},"retry-key")));
 assert.equal(new Set(results.map(r=>r.learning.id)).size,1);assert.equal(results.filter(r=>!r.replayed).length,1);
 const focus=await make().prepare("a",{focusClientId:"kong"},"retry-key"),other=await make().prepare("b",{focusClientId:"all"},"retry-key");assert.notEqual(focus.learning.id,results[0].learning.id);assert.notEqual(other.learning.id,results[0].learning.id);
 const day1=await make().prepare("a",{focusClientId:"all"}),day2=await make(NOW+86400000).prepare("a",{focusClientId:"all"});assert.notEqual(day1.learning.id,day2.learning.id);
 assert.equal((await make().get("a")).history.records,4);assert.equal((await make().get("b")).history.records,1);
});

test("write/commit failures roll back and never return completed or contaminate subsequent reads",async()=>{
 for(const mode of ["write","commit"]){const f=fixture(),service=createMarketingLearningService(createMarketingLearningStore(f.pool),()=>NOW);
  if(mode==="write")f.failWrite(true);else f.failCommit(true);
  await assert.rejects(()=>service.prepare("a",{}));assert.equal(f.data.size,0);assert.equal((await service.get("a")).history.records,0);
  f.failWrite(false);f.failCommit(false);const saved=await service.prepare("a",{});assert.equal(saved.replayed,false);assert.equal((await service.prepare("a",{})).replayed,true);assert.equal((await service.get("a")).history.records,1);
 }
});

test("invalid owners/history/focus fail closed; explicit complete-history import is idempotent and conflict safe",async()=>{
 const f=fixture(),store=createMarketingLearningStore(f.pool),service=createMarketingLearningService(store,()=>NOW);
 await assert.rejects(()=>service.get("foreign"),/OWNER_ABSENT/);await assert.rejects(()=>service.prepare("a",{focusClientId:"unknown"}),/CLIENT_UNKNOWN/);assert.equal(f.data.size,0);
 const saved=await service.prepare("a",{});await store.importHistory("a",[saved.learning]);assert.equal((await store.read("a"))!.length,1);
 await assert.rejects(()=>store.importHistory("a",[{...saved.learning,summary:"different"}]),/IMPORT_CONFLICT/);assert.equal((await store.read("a"))![0].summary,saved.learning.summary);
 const foreign=structuredClone(f.data.get("a"));f.data.set("b",foreign);await assert.rejects(()=>service.get("b"),/HISTORY_INVALID/);
 f.data.set("a",{version:1,ownerKey:"wrong",runs:[]});await assert.rejects(()=>service.get("a"));
});

test("local fallback is owner-scoped and read-only until POST; production synchronous global access fails closed",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"marketing-store-")),root=path.join(dir,"owners");try{
  const service=createMarketingLearningService(createLocalMarketingLearningStore(root),()=>NOW);await service.get("a");assert.deepEqual(await readdir(dir),[]);
  const result=await service.prepare("a",{});assert.equal((await service.get("b")).recentLearningRuns.length,0);const reloaded=createMarketingLearningService(createLocalMarketingLearningStore(root),()=>NOW);assert.equal((await reloaded.prepare("a",{})).learning.id,result.learning.id);
  const files=await readdir(root);assert.equal(files.length,1);new TextDecoder("utf-8",{fatal:true}).decode(await readFile(path.join(root,files[0])));
  const previous=process.env.NODE_ENV;process.env.NODE_ENV="production";try{assert.throws(()=>getMarketingCommandCenterSnapshot(),/DURABLE_CONTEXT_REQUIRED/);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
 }finally{await rm(dir,{recursive:true,force:true});}
});
