import test from "node:test";
import assert from "node:assert/strict";
import { runSoftwareFactoryLoop, FACTORY_IDLE_POLL_MS, type FactoryLoopClock } from "../server/software-factory-loop";
import { createSoftwareFactoryWorker } from "../server/software-factory-worker";
import { createSoftwareFactoryStore, type FactoryJob } from "../server/software-factory-store";
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
class Clock implements FactoryLoopClock {
  time=Date.parse("2026-11-06T12:00:00Z"); serial=0;
  timers=new Map<number,{at:number;interval:number;fn:()=>void}>();
  setTimeout(fn:()=>void,ms:number){const id=++this.serial;this.timers.set(id,{at:this.time+ms,interval:0,fn});return id;}
  clearTimeout(id:unknown){this.timers.delete(id as number);}
  setInterval(fn:()=>void,ms:number){const id=++this.serial;this.timers.set(id,{at:this.time+ms,interval:ms,fn});return id;}
  clearInterval(id:unknown){this.timers.delete(id as number);}
  async advance(ms:number){const end=this.time+ms;for(;;){const next=[...this.timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;this.time=next[1].at;if(next[1].interval)next[1].at+=next[1].interval;else this.timers.delete(next[0]);next[1].fn();await flush();}this.time=end;await flush();}
}
function setup(clock:Clock, jobs:FactoryJob[]=[]) {
 const calls:string[]=[];
 const store={expire:async()=>{calls.push("expire");return 0;},heartbeat:async()=>{calls.push("heartbeat");},claim:async()=>{calls.push("claim");return jobs.shift();},idleState:async()=>{calls.push("idleState");return {kind:"idle"};},complete:async()=>{calls.push("complete");return true;}};
 return {calls,store,jobs};
}
function job(clock:Clock,kind:FactoryJob["kind"]="build"):FactoryJob{return {id:kind,key:kind,kind,projectId:"pilot",ownerKey:"owner",month:"2026-11",status:"running",payload:{},headSha:"a".repeat(40),reservedCents:10,recoveryCents:0,createdAt:new Date(clock.time).toISOString(),leaseExpiresAt:new Date(clock.time+60000).toISOString()};}
test("confirmed idle maintains process presence while claims remain hourly and stop clears timers",async()=>{
 const clock=new Clock(),f=setup(clock),shutdown=new AbortController();
 const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time)});
 const loop=runSoftwareFactoryLoop(worker,{clock,signal:shutdown.signal});await flush();
 assert.deepEqual(f.calls,["expire","idleState","heartbeat","expire","claim","idleState"]);assert.equal(clock.timers.size,2);
 await clock.advance(FACTORY_IDLE_POLL_MS-1);assert.equal(f.calls.filter(call=>call==="claim").length,1);assert.ok(f.calls.filter(call=>call==="heartbeat").length>200);
 await clock.advance(1);assert.equal(f.calls.filter(call=>call==="claim").length,2);
 shutdown.abort();await loop;assert.equal(clock.timers.size,0);
});
test("active job retains 15 second maintenance and lease abort without idle polling",async()=>{
 const clock=new Clock(),f=setup(clock,[job(clock)]),shutdown=new AbortController();let aborted=false;
 const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time),adapters:{build:{execute:async(_job,{signal})=>new Promise(resolve=>signal.addEventListener("abort",()=>{aborted=true;resolve({status:"unknown",costCents:0});},{once:true}))}}});
 const loop=runSoftwareFactoryLoop(worker,{clock,signal:shutdown.signal});await flush();
 assert.equal(f.calls.filter(call=>call==="heartbeat").length,2);
 await clock.advance(15000);assert.equal(f.calls.filter(call=>call==="heartbeat").length,3);
 await clock.advance(45000);await loop;
 assert.equal(aborted,true);assert.equal(f.calls.filter(call=>call==="claim").length,1);assert.equal(clock.timers.size,0);
});
test("verification and rollback follow immediately without a dormant interval",async()=>{
 const clock=new Clock(),f=setup(clock,[job(clock,"verify"),job(clock,"rollback")]),shutdown=new AbortController();const stages:string[]=[];
 const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time),adapters:{verify:{execute:async()=>{stages.push("verify");return {status:"completed",costCents:1,next:{key:"next",projectId:"pilot",kind:"rollback",headSha:"a".repeat(40),reservedCents:5}};}},rollback:{execute:async()=>{stages.push("rollback");return {status:"completed",costCents:1};}}}});
 const loop=runSoftwareFactoryLoop(worker,{clock,signal:shutdown.signal});await flush();
 assert.deepEqual(stages,["verify","rollback"]);assert.equal(f.calls.filter(call=>call==="claim").length,3);
 assert.deepEqual([...clock.timers.values()].map(timer=>timer.at-clock.time).sort((a,b)=>a-b),[15000,FACTORY_IDLE_POLL_MS]);shutdown.abort();await loop;
});
test("unknown global slot quarantines without heartbeat or recurring database calls",async()=>{
 const clock=new Clock(),f=setup(clock);f.store.idleState=async()=>({kind:"unknown"});
 const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time)});
 await runSoftwareFactoryLoop(worker,{clock,signal:new AbortController().signal});
 assert.equal(f.calls.includes("heartbeat"),false);assert.equal(clock.timers.size,0);
});
test("other active lease and pending recovery cannot cause an hourly sleep",async()=>{
 const clock=new Clock(),f=setup(clock);
 f.store.idleState=async()=>({kind:"running",leaseExpiresAt:new Date(clock.time+2000).toISOString()}) as any;
 const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time)});
 assert.deepEqual(await worker.tick(),{kind:"retry",delayMs:2000});
 f.store.idleState=async()=>({kind:"pendingRecovery"});assert.deepEqual(await worker.tick(),{kind:"retry",delayMs:5000});
});
test("stop during active execution forwards abort and leaves no loop timers",async()=>{
 const clock=new Clock(),f=setup(clock,[job(clock)]),shutdown=new AbortController();let aborted=false;
 const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time),adapters:{build:{execute:async(_job,{signal})=>new Promise(resolve=>signal.addEventListener("abort",()=>{aborted=true;resolve({status:"unknown",costCents:0});},{once:true}))}}});
 const loop=runSoftwareFactoryLoop(worker,{clock,signal:shutdown.signal});await flush();shutdown.abort();await loop;assert.equal(aborted,true);assert.equal(clock.timers.size,0);
});
test("durable idle inspection distinguishes queue blockers and rejects invalid lease proof",async()=>{
 let rows:any[]=[];const sql:string[]=[];
 const store=createSoftwareFactoryStore({query:async(query:string)=>{sql.push(query);return {rows};}} as any);
 assert.deepEqual(await store.idleState(),{kind:"idle"});
 rows=[{status:"unknown"}];assert.deepEqual(await store.idleState(),{kind:"unknown"});
 rows=[{status:"running",lease_expires_at:new Date("2026-11-06T12:00:00Z")}];assert.deepEqual(await store.idleState(),{kind:"running",leaseExpiresAt:"2026-11-06T12:00:00.000Z"});
 rows=[{status:"running",lease_expires_at:"bad"}];assert.deepEqual(await store.idleState(),{kind:"unknown"});
 rows=[{status:"pending"}];assert.deepEqual(await store.idleState(),{kind:"pendingRecovery"});
 assert.ok(sql.every(query=>query.includes("'verify','rollback'")));
});


test("stop while claim is pending cannot advertise or execute the returned job", async()=>{
 const clock=new Clock(),f=setup(clock);let resolveClaim!:(value:FactoryJob)=>void;
 f.store.claim=async()=>new Promise(resolve=>{resolveClaim=resolve;});
 let executed=false;
 const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time),adapters:{build:{execute:async()=>{executed=true;return {status:"completed",costCents:0};}}}});
 const tick=worker.tick();await flush();worker.stop();resolveClaim(job(clock));
 assert.deepEqual(await tick,{kind:"quarantined"});assert.equal(executed,false);assert.equal(f.calls.includes("heartbeat"),false);
});
test("inflight maintenance cannot heartbeat after uncertain execution quarantines", async()=>{
 const clock=new Clock(),f=setup(clock,[job(clock)]);let finishAdapter!:()=>void,finishExpire!:(value:number)=>void;
 const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time),adapters:{build:{execute:async()=>new Promise(resolve=>{finishAdapter=()=>resolve({status:"unknown",costCents:0});})}}});
 const tick=worker.tick();await flush();
 f.store.expire=async()=>new Promise(resolve=>{finishExpire=resolve;});
 const maintain=worker.maintain();await flush();finishAdapter();assert.deepEqual(await tick,{kind:"quarantined"});
 finishExpire(0);await maintain;assert.equal(f.calls.filter(call=>call==="heartbeat").length,1);
});


test("idle maintenance is serialized and stop during lookup cannot renew presence",async()=>{
 const clock=new Clock(),f=setup(clock);let resolve!:()=>void;let reads=0;
 f.store.idleState=async()=>{reads++;await new Promise<void>(r=>{resolve=r;});return {kind:"idle"};};
 const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time)});
 const first=worker.maintain();await flush();await worker.maintain();assert.equal(reads,1);
 worker.stop();resolve();await first;await worker.maintain();assert.equal(f.calls.includes("heartbeat"),false);
});
test("unknown work discovered during hourly dormancy stops maintenance and all timers",async()=>{
 const clock=new Clock(),f=setup(clock);const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time)});
 const loop=runSoftwareFactoryLoop(worker,{clock,signal:new AbortController().signal});await flush();const count=f.calls.filter(x=>x==="heartbeat").length;
 f.store.idleState=async()=>({kind:"unknown"});await clock.advance(15000);await loop;
 assert.equal(f.calls.filter(x=>x==="heartbeat").length,count);assert.equal(clock.timers.size,0);
});
test("idle process heartbeat preserves read-only capabilities and never claims work",async()=>{
 const clock=new Clock(),f=setup(clock);let capabilities:any;
 (f.store as any).heartbeat=async(_id:any,c:any)=>{capabilities=c;};
 const adapter={execute:async()=>({status:"completed" as const,costCents:0})};
 const worker=createSoftwareFactoryWorker({store:f.store as any,now:()=>new Date(clock.time),releaseMode:"review-only",adapters:{build:adapter,deploy:adapter}});
 await worker.maintain();assert.deepEqual(capabilities,{build:true,deploy:false});assert.equal(f.calls.includes("claim"),false);
 f.store.idleState=async()=>({kind:"running",leaseExpiresAt:new Date(clock.time-1).toISOString()}) as any;
 await assert.rejects(worker.maintain(),/IDLE_STATE/);assert.deepEqual(await worker.tick(),{kind:"quarantined"});
});
