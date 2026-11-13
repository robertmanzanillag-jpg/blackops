import { test } from "node:test";
import assert from "node:assert/strict";
import { createSoftwareFactoryWorker, validateFactoryTransition } from "../server/software-factory-worker";
import type { FactoryJob } from "../server/software-factory-store";
const sha="a".repeat(40);
const job = (kind:FactoryJob["kind"]="build"):FactoryJob => ({id:"job",ownerKey:"owner",projectId:"pilot",key:"key",kind,payload:{},headSha:sha,reservedCents:10,month:"2026-11",status:"running",createdAt:new Date().toISOString(),workerId:"w",fence:"f",leaseExpiresAt:new Date(Date.now()+600000).toISOString()});
function harness(task=job()) { const completions:any[]=[];let claims=0; const store={expire:async()=>0,heartbeat:async()=>{},claim:async()=>{claims++;return task;},complete:async(...args:any[])=>{completions.push(args);return true;}} as any; return {store,completions,get claims(){return claims;}}; }
test("missing builder blocks honestly without execution",async()=>{const h=harness();await createSoftwareFactoryWorker({store:h.store}).tick();assert.equal(h.completions[0][1].status,"blocked");assert.match(h.completions[0][1].reason,/ADAPTER_UNAVAILABLE:build/);});
test("adapter throws after potential external work: retain unknown, quarantine, no retry",async()=>{const h=harness();const w=createSoftwareFactoryWorker({store:h.store,adapters:{build:{execute:async()=>{throw Error("uncertain")}}}});await w.tick();await w.tick();assert.equal(h.claims,1);assert.equal(h.completions[0][1].status,"unknown");});
test("deployment cannot use payload claiming gate approval",async()=>{const task=job("deploy");task.payload={approved:true,evidence:"pass"};const h=harness(task);let called=false;await createSoftwareFactoryWorker({store:h.store,adapters:{deploy:{execute:async()=>{called=true;return {status:"completed",costCents:0}}}}}).tick();assert.equal(called,false);assert.match(h.completions[0][1].reason,/TRUSTED_RELEASE/);});
test("completed construction hands next simulation atomically to store",async()=>{const h=harness();await createSoftwareFactoryWorker({store:h.store,adapters:{build:{execute:async()=>({status:"completed",costCents:5,next:{key:"next",projectId:"pilot",kind:"simulate",headSha:sha,reservedCents:10}})}}}).tick();assert.equal(h.completions[0][2].kind,"simulate");assert.equal(h.completions[0][2].payload.repairAttempts,0);});
test("repair count cannot reset through model output",()=>{const task=job("review");task.payload.repairAttempts=2;assert.throws(()=>validateFactoryTransition(task,{status:"completed",costCents:0,next:{key:"next",projectId:"pilot",kind:"build",reservedCents:1,payload:{repairAttempts:0}}}),/REPAIR_LIMIT/);});
test("candidate SHA cannot change between simulation and review",()=>{assert.throws(()=>validateFactoryTransition(job("simulate"),{status:"completed",costCents:0,next:{key:"next",projectId:"pilot",kind:"review",headSha:"b".repeat(40),reservedCents:1}}),/VERSION_CHANGED/);});
test("discovery cannot skip directly to publication",()=>{assert.throws(()=>validateFactoryTransition(job("discover"),{status:"completed",costCents:0,next:{key:"next",projectId:"pilot",kind:"deploy",headSha:sha,reservedCents:1}}),/INVALID_TRANSITION/);});
test("daily discovery refuses unknown cost instead of assuming free",async()=>{const h=harness();const w=createSoftwareFactoryWorker({store:h.store,scheduleOwner:"owner",adapters:{discover:{execute:async()=>({status:"completed",costCents:0})}}});await assert.rejects(()=>w.schedule(),/DISCOVERY_COST_REQUIRED/);});
test("one active tick per process",async()=>{const h=harness();let finish!:()=>void;const pending=new Promise<void>(r=>finish=r);const w=createSoftwareFactoryWorker({store:h.store,adapters:{build:{execute:async()=>{await pending;return {status:"completed",costCents:0}}}}});const first=w.tick();await new Promise(r=>setImmediate(r));await w.tick();assert.equal(h.claims,1);finish();await first;});
function releaseFixture() {
 const time=new Date();
 const project={id:"pilot",repo:"owner/pilot",testCommand:"test",buildCommand:"build",stagingUrl:"https://stage.example.com",productionUrl:"https://prod.example.com",healthUrl:"https://prod.example.com/health",rollbackCommand:"restore",journeys:["navigation"],automaticRelease:true,providerSupportsRelease:true,providerSupportsRollback:true,rehearsalRunIds:["1","2","3"],rollbackVerifiedAt:time.toISOString()};
 const candidate={projectId:"pilot",headSha:sha,baseSha:"b".repeat(40),prUrl:"https://github.com/owner/pilot/pull/1",builderId:"builder",risk:"low" as const,reversible:true,changedFiles:["client/src/button.tsx"],affectsContracts:false,affectsData:false,repairAttempts:0};
 const evidence=(["tests","simulation","review"] as const).map(kind=>({projectId:"pilot",headSha:sha,baseSha:candidate.baseSha,kind,passed:true,warnings:[],createdAt:time.toISOString(),actorId:"checker",artifactIds:["proof"],journeyIds:["navigation"],baselineJourneyIds:["navigation"],viewports:["mobile","desktop"],syntheticData:true,externalServicesMocked:true}));
 return {project,candidate,evidence,recoveryBudget:{verifyCents:20,rollbackCents:30}};
}
test("worker releases with protected recovery escrow and limits provider to stage cost",async()=>{
 const task={...job("deploy"),reservedCents:150,recoveryCents:50};const h=harness(task);let allowance=0;
 await createSoftwareFactoryWorker({store:h.store,releaseContext:async()=>releaseFixture(),adapters:{deploy:{execute:async(_job,context)=>{allowance=context.maxCostCents;return {status:"completed",costCents:100,next:{key:"next",projectId:"pilot",kind:"verify",headSha:sha,reservedCents:50,recoveryCents:30}}}}}}).tick();
 assert.equal(allowance,100);assert.equal(h.completions[0][1].status,"completed");assert.equal(h.completions[0][2].reservedCents,50);assert.equal(h.completions[0][2].recoveryCents,30);
});
test("worker denies deployment with insufficient escrow before calling provider",async()=>{
 const task={...job("deploy"),reservedCents:140,recoveryCents:40};const h=harness(task);let called=false;
 await createSoftwareFactoryWorker({store:h.store,releaseContext:async()=>releaseFixture(),adapters:{deploy:{execute:async()=>{called=true;return {status:"completed",costCents:0}}}}}).tick();assert.equal(called,false);assert.equal(h.completions[0][1].reason,"FACTORY_RECOVERY_ESCROW_UNAVAILABLE");
});
test("provider cannot spend rollback escrow or drop it from continuation",async()=>{
 for(const bad of [{costCents:101,nextRecovery:30},{costCents:100,nextRecovery:0}]) {
 const h=harness({...job("deploy"),reservedCents:150,recoveryCents:50});await createSoftwareFactoryWorker({store:h.store,releaseContext:async()=>releaseFixture(),adapters:{deploy:{execute:async()=>({status:"completed",costCents:bad.costCents,next:{key:"next",projectId:"pilot",kind:"verify",headSha:sha,reservedCents:50,recoveryCents:bad.nextRecovery}})}}}).tick();assert.equal(h.completions[0][1].status,"unknown");assert.equal(h.completions[0][2],undefined);
 }
});

test("zero-cost deferral requeues through the store instead of completing, and never becomes unknown",async()=>{
 const at=new Date("2026-11-07T10:00:00.000Z"),now=()=>at,deferUntil="2026-11-08T00:00:00.000Z";
 const run=async(result:any,withDefer=true,task=job())=>{const h=harness(task);const deferred:any[]=[];if(withDefer)h.store.defer=async(...args:any[])=>{deferred.push(args);return true;};
  const w=createSoftwareFactoryWorker({store:h.store,now,adapters:{build:{execute:async()=>result}}});task.leaseExpiresAt=new Date(at.getTime()+600000).toISOString();const tick=await w.tick();return {h,deferred,tick};};
 const ok=await run({status:"blocked",costCents:0,reason:"FACTORY_DAILY_DRAFT_PR_LIMIT",deferUntil});
 assert.equal(ok.h.completions.length,0);assert.deepEqual(ok.deferred[0][1],{reason:"FACTORY_DAILY_DRAFT_PR_LIMIT",notBefore:deferUntil});assert.equal(ok.tick.kind,"progressed");
 // Invalid deferrals fall back to a terminal zero-cost block (never unknown, never charged).
 for(const [result,withDefer] of [[{status:"blocked",costCents:0,reason:"X",deferUntil:"2026-12-01T00:00:00.000Z"},true],[{status:"blocked",costCents:1,reason:"X",deferUntil},true],[{status:"failed",costCents:0,reason:"X",deferUntil},true],[{status:"blocked",costCents:0,reason:"X",deferUntil:"2026-11-07T09:00:00.000Z"},true],[{status:"blocked",costCents:0,reason:"X",deferUntil:"2026-11-09T12:00:00.000Z"},true],[{status:"blocked",costCents:0,reason:"X",deferUntil},false]] as const){
  const r=await run(result,withDefer);assert.equal(r.deferred.length,0);assert.equal(r.h.completions.length,1);assert.notEqual(r.h.completions[0][1].status,"unknown");assert.equal("deferUntil" in r.h.completions[0][1],false);
 }
 // An unconfirmed deferral write quarantines the worker rather than replaying the job.
 const t=job();t.leaseExpiresAt=new Date(at.getTime()+600000).toISOString();
 const h=harness(t);h.store.defer=async()=>false;
 assert.equal((await createSoftwareFactoryWorker({store:h.store,now,adapters:{build:{execute:async()=>({status:"blocked",costCents:0,reason:"X",deferUntil})}}}).tick()).kind,"quarantined");
});
