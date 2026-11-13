import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createSoftwareFactoryObjectStore, type FactoryObjectTransport } from "../server/software-factory-object-store";
const owner="fixture-owner", key=createHash("sha256").update(owner).digest("hex"),sha="a".repeat(40),base="b".repeat(40);
class MemoryTransport implements FactoryObjectTransport {
 body:string|undefined; generation=0; writes=0; conflicts=0; loseAck=false; failBeforeCommit=false;
 async read(){return this.body===undefined?undefined:{body:this.body,generation:String(this.generation)};}
 async compareAndSwap(expected:string|null,body:string):Promise<{kind:"written";generation:string}|{kind:"conflict"}>{
  this.writes++;if(this.failBeforeCommit){this.failBeforeCommit=false;throw Error("network uncertain");}
  if(this.conflicts>0){this.conflicts--;return {kind:"conflict"};}
  if(expected!==(this.body===undefined?null:String(this.generation)))return {kind:"conflict"};
  this.body=body;this.generation++;if(this.loseAck){this.loseAck=false;throw Error("response lost after commit");}return {kind:"written",generation:String(this.generation)};
 }
}
async function fixture(options:{maxBytes?:number;skew?:number;conflicts?:number;start?:string}={}){
 const transport=new MemoryTransport();let now=Date.parse(options.start??"2026-11-06T12:00:00Z");
 const store=createSoftwareFactoryObjectStore({transport,ledgerId:"private-factory",now:()=>new Date(now),maxClockSkewMs:options.skew??0,maxBytes:options.maxBytes,maxConflicts:options.conflicts});
 await store.initializeStore();await store.initializeMonth(owner,"2026-11",1000);await store.setPaused(owner,false);
 return {store,transport,get now(){return now;},set now(value:number){now=value;}};
}
const input=(id:string,reservedCents=100)=>({key:id,projectId:"pilot",kind:"build" as const,reservedCents,payload:{}});
const project={id:"pilot",repo:"fixture/pilot",testCommand:"test",buildCommand:"build",stagingUrl:"https://stage.example",productionUrl:"https://app.example",healthUrl:"https://app.example/health",rollbackCommand:"restore",journeys:["home"],automaticRelease:true,providerSupportsRelease:true,providerSupportsRollback:true,rehearsalRunIds:["forged"],rollbackVerifiedAt:new Date().toISOString()};

test("durable release history is not displaced by more than one hundred health jobs",async()=>{
 const f=await fixture();await f.store.enqueue(owner,{...input('production',1),headSha:sha});
 const deployed=(await f.store.claim('worker'))!;
 await f.store.complete(deployed,{status:'completed',costCents:0,evidence:{pipelineState:{target:'production'}}});
 const ledger=JSON.parse(f.transport.body!),template=ledger.jobs[0];
 template.input.kind='deploy';template.requestHash=createHash('sha256').update(JSON.stringify(template.input)).digest('hex');
 for(let i=0;i<110;i++){
  const j=structuredClone(template);j.id=randomUUID();j.input={...j.input,key:`health-${i}`,kind:'verify',reservedCents:0,recoveryCents:0};j.requestHash=createHash('sha256').update(JSON.stringify(j.input)).digest('hex');j.createdAt=j.completedAt=new Date(f.now+i+1).toISOString();j.result={status:'completed',costCents:0};ledger.jobs.push(j);
 }
 f.transport.body=JSON.stringify(ledger);
 assert.equal((await f.store.list(owner)).some(j=>j.id===deployed.id),false);
 assert.deepEqual((await f.store.releaseHistory(owner,'pilot')).map(j=>j.id),[deployed.id]);
 assert.deepEqual(await f.store.releaseHistory('another-owner','pilot'),[]);
 assert.deepEqual(await f.store.releaseHistory(owner,'other-project'),[]);
 const rollback=structuredClone(template);rollback.id=randomUUID();rollback.input={...rollback.input,key:'restored',kind:'rollback',reservedCents:0,recoveryCents:0};rollback.requestHash=createHash('sha256').update(JSON.stringify(rollback.input)).digest('hex');rollback.createdAt=rollback.completedAt=new Date(f.now+200).toISOString();ledger.jobs.push(rollback);
 const unknown=structuredClone(rollback);unknown.id=randomUUID();unknown.input={...unknown.input,key:'uncertain'};unknown.requestHash=createHash('sha256').update(JSON.stringify(unknown.input)).digest('hex');unknown.status='unknown';unknown.capacity=64000;unknown.createdAt=new Date(f.now-1000).toISOString();delete unknown.completedAt;ledger.jobs.push(unknown);f.transport.body=JSON.stringify(ledger);
 assert.deepEqual((await f.store.releaseHistory(owner,'pilot')).map(j=>j.id),[unknown.id,rollback.id,deployed.id]);
});
test("missing store never bootstraps implicitly and malformed configuration is rejected",async()=>{
 const transport=new MemoryTransport(),store=createSoftwareFactoryObjectStore({transport,ledgerId:"factory",now:()=>new Date(),maxClockSkewMs:0});
 await assert.rejects(store.status(owner),/LEDGER_MISSING/);await assert.rejects(store.initializeMonth(owner,new Date().toISOString().slice(0,7),0),/LEDGER_MISSING/);assert.equal(transport.writes,0);
 assert.throws(()=>createSoftwareFactoryObjectStore({transport:undefined as any,ledgerId:"factory",now:()=>new Date(),maxClockSkewMs:0}),/TRANSPORT_REQUIRED/);
 await Promise.all([store.initializeStore(),store.initializeStore()]);assert.equal((await store.status(owner)).configured,false);
});
test("concurrent budget admission and claims retain one global slot",async()=>{
 const f=await fixture();const admissions=await Promise.allSettled([f.store.enqueue(owner,input("one",6000)),f.store.enqueue(owner,input("two",6000))]);
 assert.equal(admissions.filter(r=>r.status==="fulfilled").length,1);assert.equal((await f.store.status(owner)).reservedCents,6000);
 await f.store.enqueue(owner,input("three",100));const claims=await Promise.all([f.store.claim("worker-a"),f.store.claim("worker-b")]);assert.equal(claims.filter(Boolean).length,1);assert.equal((await f.store.idleState()).kind,"running");
});
test("lost conditional-write acknowledgment is reconciled by durable receipt without double reserve",async()=>{
 const f=await fixture();f.transport.loseAck=true;const first=await f.store.enqueue(owner,input("idempotent"));const again=await f.store.enqueue(owner,input("idempotent"));assert.equal(again.id,first.id);assert.equal((await f.store.status(owner)).reservedCents,100);
 await assert.rejects(f.store.enqueue(owner,input("idempotent",101)),/IDEMPOTENCY_CONFLICT/);
 const claimed=(await f.store.claim("worker"))!;f.transport.loseAck=true;assert.equal(await f.store.complete(claimed,{status:"completed",costCents:30}),true);assert.equal((await f.store.status(owner)).spentCents,30);
 assert.equal(await f.store.complete(claimed,{status:"completed",costCents:30}),false);assert.equal((await f.store.status(owner)).spentCents,30);
});
test("ambiguous uncommitted write is not automatically replayed and conflicts are bounded",async()=>{
 const f=await fixture({conflicts:2});let writes=f.transport.writes;f.transport.failBeforeCommit=true;
 await assert.rejects(f.store.enqueue(owner,input("ambiguous")),/WRITE_UNCONFIRMED/);assert.equal(f.transport.writes-writes,1);assert.equal((await f.store.status(owner)).reservedCents,0);
 writes=f.transport.writes;f.transport.conflicts=10;await assert.rejects(f.store.enqueue(owner,input("conflicted")),/CONTENTION/);assert.equal(f.transport.writes-writes,3);
});
test("lease fencing and unknown outcomes retain funds until explicit stopped reconciliation",async()=>{
 const f=await fixture();await f.store.enqueue(owner,input("lease"));const claimed=(await f.store.claim("worker"))!;
 assert.equal(await f.store.complete({...claimed,fence:"c".repeat(36)},{status:"completed",costCents:5}),false);
 f.now+=600001;assert.equal(await f.store.expire(),1);assert.equal((await f.store.idleState()).kind,"unknown");assert.equal(await f.store.claim("other"),undefined);assert.equal((await f.store.status(owner)).reservedCents,100);
 assert.equal(await f.store.complete(claimed,{status:"completed",costCents:5}),false);
 await assert.rejects(f.store.reconcile(owner,claimed.id,{actualCostCents:20,executionStopped:false,reason:"not stopped"}),/PROOF_REQUIRED/);
 await f.store.reconcile(owner,claimed.id,{actualCostCents:20,executionStopped:true,reason:"provider confirmed stopped"});const status=await f.store.status(owner);assert.equal(status.reservedCents,0);assert.equal(status.spentCents,20);assert.equal(status.paused,true);
});
test("deployment verification and rollback atomically transfer escrow despite pause and month rollover",async()=>{
 const f=await fixture({start:"2026-11-30T23:59:59Z"});await f.store.enqueue(owner,{...input("deploy",100),kind:"deploy",headSha:sha,recoveryCents:40});const deploy=(await f.store.claim("worker"))!;
 f.now+=2000;
 await f.store.setPaused(owner,true);
 assert.equal(await f.store.complete(deploy,{status:"completed",costCents:60},{...input("ignored",40),kind:"verify",headSha:sha,recoveryCents:20}),true);
 const verify=(await f.store.claim("worker"))!;assert.equal(verify.kind,"verify");assert.equal(verify.month,"2026-11");
 assert.equal(await f.store.complete(verify,{status:"completed",costCents:20},{...input("ignored",20),kind:"rollback",headSha:sha}),true);
 const rollback=(await f.store.claim("worker"))!;assert.equal(rollback.kind,"rollback");assert.equal(await f.store.complete(rollback,{status:"completed",costCents:20}),true);
 const ledger=JSON.parse(f.transport.body!);assert.equal(ledger.budgets[0].spentCents,100);assert.equal(ledger.budgets[0].reservedCents,0);
});
test("near capacity rejects new work but reserved completion and recovery still persist",async()=>{
 const f=await fixture({maxBytes:2100000});await f.store.enqueue(owner,{...input("deploy",100),kind:"deploy",headSha:sha,recoveryCents:40});
 await assert.rejects(f.store.enqueue(owner,input("too-many")),/CAPACITY_EXHAUSTED/);
 let filled=false;for(let i=0;i<150;i++){try{await f.store.heartbeat("idle-"+i,{["x".repeat(3000)]:true});}catch(error){assert.match(String(error),/CAPACITY_EXHAUSTED/);filled=true;break;}}assert.equal(filled,true);
 const deploy=(await f.store.claim("worker"))!;
 assert.equal(await f.store.complete(deploy,{status:"completed",costCents:60,evidence:"x".repeat(190000)},{...input("ignored",40),kind:"verify",headSha:sha,recoveryCents:20,payload:{content:"x".repeat(60000)}}),true);
 const verify=(await f.store.claim("worker"))!;assert.equal(await f.store.complete(verify,{status:"completed",costCents:20},{...input("ignored",20),kind:"rollback",headSha:sha}),true);
 const rollback=(await f.store.claim("worker"))!;assert.equal(await f.store.complete(rollback,{status:"completed",costCents:20}),true);assert.equal((await f.store.status(owner)).reservedCents,0);
});
test("corrupt reservations, malformed JSON and deleted ledger fail closed",async()=>{
 const f=await fixture();await f.store.enqueue(owner,input("reserved"));const good=f.transport.body!;const corrupt=JSON.parse(good);corrupt.budgets[0].reservedCents=0;f.transport.body=JSON.stringify(corrupt);await assert.rejects(f.store.status(owner),/RESERVATIONS_CORRUPT/);
 f.transport.body="{";await assert.rejects(f.store.status(owner));f.transport.body=undefined;await assert.rejects(f.store.enqueue(owner,input("new")),/LEDGER_MISSING/);
});
test("project registration cannot forge evidence and trusted rehearsal records enable release",async()=>{
 const f=await fixture({skew:1000});const registered=await f.store.saveProject(owner,project);assert.equal(registered.automaticRelease,false);assert.deepEqual(registered.rehearsalRunIds,[]);
 await assert.rejects(f.store.configureProjectExecution(key,"pilot",{release:true,rollback:true,automaticRelease:true}),/PILOT_PROOF/);
 for(let i=0;i<3;i++){await f.store.enqueue(owner,{...input("rehearsal-"+i),kind:"rollback",headSha:sha});const job=(await f.store.claim("worker"))!;await f.store.complete(job,{status:"completed",costCents:1,evidence:{pipelineState:{target:"staging",candidate:{baseSha:base,headSha:sha},verification:{healthy:true,headSha:sha},rollback:{healthy:true,restoredSha:base}}}});await f.store.recordValidation(key,"pilot",job.id);}
 assert.equal((await f.store.configureProjectExecution(key,"pilot",{release:true,rollback:true,automaticRelease:true})).automaticRelease,true);
 await assert.rejects(f.store.recordValidation(key,"pilot","not-a-proof"),/VALIDATION_PROOF/);
});
test("concurrent heartbeat and pause preserve both changes; idle checks do not write receipts",async()=>{
 const f=await fixture();await Promise.all([f.store.heartbeat("worker",{build:true}),f.store.setPaused(owner,true)]);const status=await f.store.status(owner);assert.equal(status.paused,true);assert.equal(status.workers.length,1);
 const writes=f.transport.writes;assert.equal(await f.store.claim("worker"),undefined);assert.equal(await f.store.expire(),0);assert.equal(f.transport.writes,writes);
});
test("trusted clock skew margins reject late completion and clock regression",async()=>{
 const f=await fixture({skew:1000});await f.store.enqueue(owner,input("clock"));const claimed=(await f.store.claim("worker"))!;f.now+=599500;
 assert.equal(await f.store.complete(claimed,{status:"completed",costCents:1}),false);f.now+=1000;assert.equal(await f.store.expire(),0);f.now+=1000;assert.equal(await f.store.expire(),1);
 f.now-=5000;await assert.rejects(f.store.status(owner),/CLOCK_REGRESSED/);
});


test("near-full lease expiration spends its reserved capacity and zero protected capacity is corrupt",async()=>{
 const f=await fixture({maxBytes:800000});await f.store.enqueue(owner,input("capacity-expiry"));const claimed=(await f.store.claim("worker"))!;
 const before=JSON.parse(f.transport.body!);
 const exactCapacity=Buffer.byteLength(f.transport.body!)+before.jobs.reduce((sum:number,job:any)=>sum+job.capacity,0);
 const tight=createSoftwareFactoryObjectStore({transport:f.transport,ledgerId:"private-factory",now:()=>new Date(f.now),maxClockSkewMs:0,maxBytes:exactCapacity});
 f.now+=600001;assert.equal(await tight.expire(),1);const after=JSON.parse(f.transport.body!);
 assert.equal(after.jobs[0].status,"unknown");assert.ok(after.jobs[0].capacity<before.jobs[0].capacity);assert.equal((await f.store.status(owner)).reservedCents,100);
 after.jobs[0].capacity=0;f.transport.body=JSON.stringify(after);await assert.rejects(f.store.status(owner),/LEDGER_CORRUPT/);
});


test("old escrow and settlement costs constrain new-month admission without blocking rollback",async()=>{
 const f=await fixture({start:"2026-11-30T23:59:50Z"});
 await f.store.enqueue(owner,input("old-spend",8900));
 await f.store.complete((await f.store.claim("worker"))!,{status:"completed",costCents:8900});
 await f.store.enqueue(owner,{...input("boundary-deploy",100),kind:"deploy",headSha:sha,recoveryCents:100});
 const deploy=(await f.store.claim("worker"))!;
 f.now=Date.parse("2026-12-01T00:00:01Z");
 await f.store.initializeMonth(owner,"2026-12",0);
 assert.equal((await f.store.status(owner)).reservedCents,100);
 await assert.rejects(f.store.enqueue(owner,input("too-much",10000)),/BUDGET_UNAVAILABLE/);
 await f.store.enqueue(owner,input("new-month",9900));
 await f.store.complete(deploy,{status:"completed",costCents:0},{...input("verify",100),kind:"verify",headSha:sha,recoveryCents:60});
 const verify=(await f.store.claim("worker"))!;assert.equal(verify.kind,"verify");
 await f.store.setPaused(owner,true);
 await f.store.complete(verify,{status:"completed",costCents:40},{...input("rollback",60),kind:"rollback",headSha:sha});
 let state=await f.store.status(owner);assert.equal(state.spentCents,40);assert.equal(state.reservedCents,9960);
 const rollback=(await f.store.claim("worker"))!;assert.equal(rollback.kind,"rollback");
 await f.store.complete(rollback,{status:"completed",costCents:40});
 state=await f.store.status(owner);assert.equal(state.spentCents,80);assert.equal(state.reservedCents,9900);
 await assert.rejects(f.store.enqueue(owner,input("still-too-much",21)),/BUDGET_UNAVAILABLE/);
 await f.store.enqueue(owner,input("exact-remaining",20));
 f.now=Date.parse("2027-01-01T00:00:00Z");await f.store.initializeMonth(owner,"2027-01",0);
 state=await f.store.status(owner);assert.equal(state.spentCents,0);assert.equal(state.reservedCents,9920);
});

test("older unknown liabilities carry until stopped reconciliation then charge settlement month",async()=>{
 const f=await fixture({start:"2026-11-30T23:59:59Z"});await f.store.enqueue(owner,input("uncertain",500));
 const job=(await f.store.claim("worker"))!;await f.store.complete(job,{status:"unknown",costCents:0});
 f.now=Date.parse("2026-12-01T00:00:01Z");await f.store.initializeMonth(owner,"2026-12",0);
 assert.equal((await f.store.status(owner)).reservedCents,500);
 await assert.rejects(f.store.enqueue(owner,input("too-much",9501)),/BUDGET_UNAVAILABLE/);
 await f.store.reconcile(owner,job.id,{actualCostCents:400,executionStopped:true,reason:"provider confirmed full cost"});
 let state=await f.store.status(owner);assert.equal(state.reservedCents,0);assert.equal(state.spentCents,400);
 const attempts=await Promise.allSettled([f.store.enqueue(owner,input("a",6000)),f.store.enqueue(owner,input("b",6000))]);
 assert.equal(attempts.filter(x=>x.status==="fulfilled").length,1);
 f.now=Date.parse("2027-01-01T00:00:00Z");await f.store.initializeMonth(owner,"2027-01",0);
 state=await f.store.status(owner);assert.equal(state.spentCents,0);assert.equal(state.reservedCents,6000);
});

test("object ledger deferral requeues a claimed job at zero cost until notBefore, within its month",async()=>{
 const f=await fixture();await f.store.enqueue(owner,input("deferred",200));const job=(await f.store.claim("worker"))!;
 const tomorrow="2026-11-07T00:00:00.000Z";
 assert.equal(await f.store.defer({...job,fence:randomUUID()},{reason:"FACTORY_DAILY_DRAFT_PR_LIMIT",notBefore:tomorrow}),false);
 assert.equal(await f.store.defer(job,{reason:"FACTORY_DAILY_DRAFT_PR_LIMIT",notBefore:"2026-12-01T00:00:00.000Z"}),false,"cross-month deferral is refused");
 await assert.rejects(f.store.defer(job,{reason:"lower case",notBefore:tomorrow}));
 assert.equal(await f.store.defer(job,{reason:"FACTORY_DAILY_DRAFT_PR_LIMIT",notBefore:tomorrow}),true);
 assert.equal(await f.store.complete(job,{status:"completed",costCents:1}),false);
 const status=await f.store.status(owner);assert.equal(status.reservedCents,200);assert.equal(status.spentCents,0);
 assert.equal(await f.store.claim("worker"),undefined);assert.deepEqual(await f.store.idleState(),{kind:"idle"});
 f.now=Date.parse(tomorrow);const again=(await f.store.claim("worker"))!;assert.equal(again.id,job.id);
 assert.equal(await f.store.complete(again,{status:"completed",costCents:3}),true);assert.equal((await f.store.status(owner)).spentCents,3);
});
