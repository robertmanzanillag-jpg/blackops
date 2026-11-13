import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTrustedFactoryWorkerOptions, currentFactoryProductionDeployment, validateFactoryWorkerOptions, type TrustedFactoryStages } from "../server/software-factory-runtime";
import { factoryJobKinds, type FactoryJob, type softwareFactoryStore } from "../server/software-factory-store";
const owner = "fixture-owner", key = createHash("sha256").update(owner).digest("hex");
const context = { signal: new AbortController().signal, maxCostCents: 5 };

test("hourly health accepts only the latest visible completed production deployment",async()=>{
 const f=fixture(), sha='a'.repeat(40),base='b'.repeat(40);
 const previous:any={id:'deployment',ownerKey:key,projectId:'pilot',kind:'deploy',status:'completed',headSha:sha,completedAt:'2026-11-06T12:00:00Z',result:{evidence:{pipelineState:{version:1,projectId:'pilot',target:'production',candidate:{projectId:'pilot',headSha:sha,baseSha:base},deployment:{id:'release',headSha:sha,target:'production'},evidence:[]}}}};
 f.options.store.getCompletedJob=async()=>previous;
 let listed:any[]=[previous];
 (f.options.store as typeof f.options.store & {releaseHistory:unknown}).releaseHistory=async (raw:string,projectId:string)=>{assert.equal(raw,owner);assert.equal(projectId,'pilot');return listed;};
 const runtime=await createTrustedFactoryWorkerOptions(f.options);
 const health:FactoryJob={...job,id:'health',kind:'verify',headSha:sha,key:'deployment.health:2026-11-06T12',payload:{previousJobId:'deployment'},reservedCents:10,recoveryCents:5};
 assert.equal((await runtime.releaseContext!(health)).candidate.headSha,sha);
 listed=[{...previous,id:'newer',completedAt:'2026-11-06T13:00:00Z'},previous];await assert.rejects(runtime.releaseContext!(health),/HEALTH_DEPLOYMENT_UNVERIFIED/);
 listed=[];await assert.rejects(runtime.releaseContext!(health),/HEALTH_DEPLOYMENT_UNVERIFIED/);
 listed=[{...previous,completedAt:undefined}];await assert.rejects(runtime.releaseContext!(health),/HEALTH_DEPLOYMENT_UNVERIFIED/);
 const restored=JSON.parse(JSON.stringify(previous));restored.id='restoration';restored.kind='rollback';restored.completedAt='2026-11-06T12:30:00Z';restored.result.evidence.pipelineState.rollback={healthy:true,restoredSha:base};
 listed=[restored,previous];assert.equal(currentFactoryProductionDeployment(listed,'pilot'),undefined);await assert.rejects(runtime.releaseContext!(health),/HEALTH_DEPLOYMENT_UNVERIFIED/);
 // Newer completed deployment supersedes a previous restoration.
 const redeployed={...previous,id:'redeployed',completedAt:'2026-11-06T13:00:00Z'};
 assert.equal(currentFactoryProductionDeployment([redeployed,restored,previous],'pilot')?.id,'redeployed');
 for(const kind of ['deploy','rollback'])for(const status of ['running','unknown']){
   listed=[{...previous,id:'conflict',kind,status},previous];
   assert.equal(currentFactoryProductionDeployment(listed,'pilot'),undefined);
   await assert.rejects(runtime.releaseContext!(health),/HEALTH_DEPLOYMENT_UNVERIFIED/);
 }
 assert.equal(currentFactoryProductionDeployment([{...restored,completedAt:previous.completedAt},previous],'pilot'),undefined);
 assert.equal(currentFactoryProductionDeployment(Array.from({length:100},(_,i)=>({...job,id:String(i),projectId:'other'})).concat(previous),'pilot'),undefined);
 delete (f.options.store as any).releaseHistory;await assert.rejects(runtime.releaseContext!(health),/HEALTH_DEPLOYMENT_UNVERIFIED/);
});
const job: FactoryJob = { id:"discovery", ownerKey:key, projectId:"pilot", kind:"discover", key:"daily", month:"2026-11", status:"running", createdAt:new Date().toISOString(), payload:{}, reservedCents:5, recoveryCents:0 };
function fixture() {
  const calls: unknown[][] = [];
  const project = { id:"pilot",repo:"fixture/pilot",testCommand:"test",buildCommand:"build",rollbackCommand:"restore",stagingUrl:"https://stage.example",productionUrl:"https://app.example",healthUrl:"https://app.example/health",journeys:["home"],automaticRelease:false,providerSupportsRelease:true,providerSupportsRollback:true,rehearsalRunIds:[] };
  const stages = Object.fromEntries(factoryJobKinds.map(kind => [kind, async () => { throw Error("unexpected " + kind); }])) as TrustedFactoryStages;
  stages.discover = async () => ({costCents:1,finding:{id:"bug",kind:"bug",regressionScenarioId:"home",request:"Fix home",baseSha:"a".repeat(40),artifactIds:["proof"]}});
  const reservations = Object.fromEntries(factoryJobKinds.map(kind => [kind,5])) as Record<typeof factoryJobKinds[number],number>;
  const store = {
    status:async (raw:string)=>{calls.push(["status",raw]);return {configured:true,paused:true,limitCents:10000,fixedCents:2000,spentCents:0,reservedCents:0};},
    projectByOwnerKey:async (...args:unknown[])=>{calls.push(["project",...args]);return project;},
    getCompletedJob:async (...args:unknown[])=>{calls.push(["previous",...args]);return undefined;},
    claimFinding:async (...args:unknown[])=>{calls.push(["claim",...args]);return true;},
    recordValidation:async (...args:unknown[])=>{calls.push(["validation",...args]);return project;},
  } as unknown as typeof softwareFactoryStore;
  return {options:{owner,stages,reservations,store},calls};
}
test("trusted runtime wires raw owner scheduling and hashed durable scope", async () => {
  const f=fixture(), runtime=await createTrustedFactoryWorkerOptions(f.options);
  assert.equal(runtime.scheduleOwner,owner); assert.equal(runtime.store,f.options.store); assert.equal(runtime.discoveryReservationCents,5);
  const result=await runtime.adapters!.discover!.execute(job,context);
  assert.equal(result.next?.kind,"build");
  assert.deepEqual(f.calls[0],["status",owner]); assert.deepEqual(f.calls[1],["project",key,"pilot"]);
  assert.deepEqual(f.calls[2].slice(0,3),["claim",key,"pilot"]); assert.equal(f.calls[2][4],job.id);
  await assert.rejects(runtime.releaseContext!({...job,kind:"deploy",payload:{previousJobId:"trusted-predecessor"}}),/FACTORY_CHAIN_UNTRUSTED/);
  assert.deepEqual(f.calls.at(-1),["previous",key,"trusted-predecessor"]);
});
test("runtime rejects foreign owners before consulting storage or providers",async()=>{
 const f=fixture(), runtime=await createTrustedFactoryWorkerOptions(f.options); f.calls.length=0;
 await assert.rejects(runtime.adapters!.discover!.execute({...job,ownerKey:"b".repeat(64)},context),/OWNER_MISMATCH/);
 await assert.rejects(runtime.releaseContext!({...job,ownerKey:"b".repeat(64)}),/OWNER_MISMATCH/);
 assert.deepEqual(f.calls,[]);
});
test("all stage callbacks and valid recovery reservations are mandatory at startup",async()=>{
 for(const kind of factoryJobKinds){for(const callback of [undefined,true]){const f=fixture(); (f.options.stages as any)[kind]=callback;await assert.rejects(createTrustedFactoryWorkerOptions(f.options),/STAGE_REQUIRED/);assert.deepEqual(f.calls,[]);}}
 for(const value of [0,-1,1.5,NaN,10001]){const f=fixture();f.options.reservations.build=value;await assert.rejects(createTrustedFactoryWorkerOptions(f.options),/RESERVATION_INVALID/);}
 const f=fixture();f.options.reservations.deploy=9999;await assert.rejects(createTrustedFactoryWorkerOptions(f.options),/RECOVERY_RESERVATION_INVALID/);
});
test("runtime preserves configured reservations against later caller mutation",async()=>{
 const f=fixture(), runtime=await createTrustedFactoryWorkerOptions(f.options);f.options.reservations.build=9999;f.options.stages.discover=async()=>{throw Error("mutated");};
 assert.equal((await runtime.adapters!.discover!.execute(job,context)).next?.reservedCents,5);
});
test("uninitialized or unverifiable budget blocks startup without assuming free costs",async()=>{
 const f=fixture();f.options.store.status=async()=>({configured:false}) as any;
 await assert.rejects(createTrustedFactoryWorkerOptions(f.options),/FIXED_COST_RESERVATION_REQUIRED/);
 f.options.store.status=async()=>({configured:true,limitCents:10000,fixedCents:undefined,spentCents:0,reservedCents:0}) as any;
 await assert.rejects(createTrustedFactoryWorkerOptions(f.options),/BUDGET_UNVERIFIED/);
});


test("entrypoint validator rejects partial or noncallable adapters and missing release proof",async()=>{
 const runtime=await createTrustedFactoryWorkerOptions(fixture().options);
 assert.doesNotThrow(()=>validateFactoryWorkerOptions(runtime));
 for(const kind of factoryJobKinds) assert.throws(()=>validateFactoryWorkerOptions({...runtime,adapters:{...runtime.adapters,[kind]:{execute:true}}}),/STAGE_REQUIRED/);
 assert.throws(()=>validateFactoryWorkerOptions({...runtime,releaseContext:undefined}),/TRUSTED_RELEASE_EVIDENCE/);
 for(const discoveryReservationCents of [undefined,0,-1,1.5,10001]) assert.throws(()=>validateFactoryWorkerOptions({...runtime,discoveryReservationCents}),/DISCOVERY_COST/);
 assert.throws(()=>validateFactoryWorkerOptions(null),/CONFIGURATION_REQUIRED/);
});
