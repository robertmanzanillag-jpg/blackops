import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createTrustedFactoryProposalWorkerOptions,validateFactoryWorkerOptions} from "../server/software-factory-runtime";
import type {FactoryJob} from "../server/software-factory-store";
for(const invalid of ["none","self-review","stale","empty","coverage"])
test(`proposal runtime four real stages retain evidence gate: ${invalid}`,async()=>{
 const owner="owner",ownerKey=createHash("sha256").update(owner).digest("hex"),base="a".repeat(40),head="b".repeat(40),at=new Date().toISOString();
 const jobs=new Map<string,FactoryJob>(),calls:string[]=[];
 const project:any={id:"p",repo:"owner/repo",testCommand:"test",buildCommand:"build",journeys:["form"],automaticRelease:false,providerSupportsRelease:false,providerSupportsRollback:false,rehearsalRunIds:[]};
 const proof=(kind:any)=>({kind,projectId:"p",baseSha:base,headSha:head,passed:true,warnings:[],createdAt:invalid==="stale"?"2020-01-01T00:00:00Z":at,actorId:kind==="tests" || invalid==="self-review"?"builder":"independent-checker",artifactIds:invalid==="empty"?[]:[`proof-${kind}`],journeyIds:invalid==="coverage" && kind==="simulation"?[]:["form"],baselineJourneyIds:["form"],viewports:["desktop","mobile"],syntheticData:true,externalServicesMocked:true});
 const stages={discover:async()=>{calls.push("discover");return {costCents:0,finding:{id:"f",kind:"bug" as const,regressionScenarioId:"form",request:"Repair form",baseSha:base,artifactIds:["report"]}};},build:async()=>{calls.push("build");return {costCents:0,candidate:{projectId:"p",headSha:head,baseSha:base,prUrl:"https://github.com/owner/repo/pull/1",builderId:"builder",risk:"low" as const,reversible:true,changedFiles:["client/src/form.tsx","tests/form.test.ts"],affectsContracts:false,affectsData:false,repairAttempts:0},tests:proof("tests")};},simulate:async()=>{calls.push("simulate");return {costCents:0,evidence:proof("simulation")};},review:async()=>{calls.push("review");return {costCents:0,evidence:proof("review")};}};
 const store:any={status:async()=>({configured:true,limitCents:10000,fixedCents:0,spentCents:0,reservedCents:0}),projectByOwnerKey:async()=>project,getCompletedJob:async(key:string,id:string)=>key===ownerKey?jobs.get(id):undefined,claimFinding:async()=>true};
 const runtime=await createTrustedFactoryProposalWorkerOptions({owner,store,stages,reservations:{discover:1,build:1,simulate:1,review:1}});
 validateFactoryWorkerOptions(runtime);assert.deepEqual(Object.keys(runtime.adapters!).sort(),["build","discover","review","simulate"]);assert.equal(runtime.releaseContext,undefined);assert.equal(runtime.releaseMode,"review-only");assert.equal(runtime.discoveryMode,"company-orders-only");
 let job:FactoryJob={id:"0",ownerKey,projectId:"p",key:"order",kind:"discover",payload:{},reservedCents:1,recoveryCents:0,month:"2026-11",status:"running",createdAt:at};
 for(let i=0;i<4;i++){const outcome=await runtime.adapters![job.kind]!.execute(job,{signal:new AbortController().signal,maxCostCents:1});assert.equal(outcome.status,i===3 && invalid!=="none"?"blocked":"completed");jobs.set(job.id,{...job,status:outcome.status,result:outcome});if(i===3){assert.equal(outcome.next,undefined);if(invalid==="none")assert.equal(outcome.reason,"FACTORY_PR_REVIEWED_NOT_DEPLOYED");else assert.notEqual(outcome.reason,"FACTORY_PR_REVIEWED_NOT_DEPLOYED");}else{assert.ok(outcome.next);job={...job,...outcome.next,payload:outcome.next!.payload!,id:String(i+1)};}}
 assert.deepEqual(calls,["discover","build","simulate","review"]);
 await assert.rejects(()=>runtime.adapters!.discover!.execute({...job,kind:"discover",ownerKey:"foreign"},{signal:new AbortController().signal,maxCostCents:1}),/OWNER_MISMATCH/);
});
test("proposal startup refuses missing genuine stages and unsafe daily admission mode",async()=>{
 await assert.rejects(()=>createTrustedFactoryProposalWorkerOptions({owner:"o",stages:{} as any,reservations:{discover:1,build:1,simulate:1,review:1}}),/STAGE_REQUIRED/);
 assert.throws(()=>validateFactoryWorkerOptions({adapters:{},releaseMode:"review-only",discoveryMode:"daily"}),/EXPLICIT_ORDERS/);
 for(const option of [{releaseMode:"proposal-only"},{discoveryMode:"company-only"}])assert.throws(()=>validateFactoryWorkerOptions({adapters:{},...option}),/MODE_INVALID/);
});
