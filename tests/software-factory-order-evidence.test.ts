import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFactoryOrderProposals} from "../server/software-factory-order-evidence";
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex"),owner=createHash("sha256").update("owner").digest("hex");
function fixture(){
 const at="2026-11-07T01:00:00.000Z",base="a".repeat(40),head="b".repeat(40),revision="c".repeat(64),key=`company-order:${hash(["asistente","order",revision])}`;
 const project={id:"asistente",repo:"example/repo",testCommand:"test",buildCommand:"build",journeys:["regression"]} as any;
 const candidate={projectId:"asistente",headSha:head,baseSha:base,prUrl:"https://github.com/example/repo/pull/1",builderId:"builder",repairAttempts:0,changedFiles:["tests/regression.test.ts"]};
 const finding={id:key,kind:"bug",request:"PRIVATE order",baseSha:base,artifactIds:[`company-order-sha256:${revision}`]};
 const evidence=["tests","simulation","review"].map(kind=>({projectId:"asistente",headSha:head,baseSha:base,kind,passed:true,warnings:[],createdAt:at,actorId:kind==="review"?"independent":"builder",artifactIds:["PRIVATE artifact"],journeyIds:["regression"],baselineJourneyIds:["regression"],viewports:["mobile","desktop"],syntheticData:true,externalServicesMocked:true}));
 const jobs=["discover","build","simulate","review"].map((kind,i)=>({id:kind,ownerKey:owner,projectId:"asistente",kind,status:"completed",createdAt:at,completedAt:at,key:i?`${["discover","build","simulate"][i-1]}.next`:key,headSha:i>1?head:undefined,payload:i?{previousJobId:["discover","build","simulate"][i-1]}:{companyOrder:{version:1,company:"main",orderId:"order",revision}},result:{status:"completed",...(kind==="review"?{reason:"FACTORY_PR_REVIEWED_NOT_DEPLOYED"}:{}),evidence:{pipelineState:{version:1,projectId:"asistente",rootJobId:"discover",target:"staging",repairAttempts:0,finding,candidate:i?candidate:undefined,evidence:evidence.slice(0,i)}}}}));
 const run=(getRecoveredBuild?:any)=>readFactoryOrderProposals({owner:"owner",getRecoveredBuild,jobs:[jobs[3],jobs[3]] as any,projects:[project],now:Date.parse(at)+864000000,getCompletedJob:async(key,id)=>{assert.equal(key,owner);return jobs.find(j=>j.id===id) as any;}}).then(result=>result.proposals);
 return {jobs,project,run};
}
test("terminal chain exposes historical order proposal once without private payload or career/deployment credit",async()=>{const f=fixture(),result=await f.run();assert.equal(result.length,1);assert.equal(result[0].orderLink,"historical_unverified");assert.equal(result[0].published,false);assert.equal(result[0].careerCredit,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);});
test("foreign ownership, missing predecessors and unconfirmed terminal outcomes cannot become proposal evidence",async()=>{
 for(const mutate of [(f:any)=>f.jobs[1].ownerKey="foreign",(f:any)=>f.jobs[2].payload.previousJobId="missing",(f:any)=>f.jobs[3].status="unknown",(f:any)=>f.jobs[3].result.reason="other",(f:any)=>f.jobs[3].result.next={}]){const f=fixture();mutate(f);assert.deepEqual(await f.run(),[]);}
});
test("order revision, root, base/head and PR identity are fenced",async()=>{
 for(const mutate of [(f:any)=>f.jobs[0].payload.companyOrder.revision="d".repeat(64),(f:any)=>f.jobs[0].key="wrong",(f:any)=>f.jobs[2].headSha="d".repeat(40),(f:any)=>f.jobs[3].result.evidence.pipelineState.candidate.prUrl="javascript:alert(1)",(f:any)=>f.jobs[3].result.evidence.pipelineState.candidate.prUrl="https://github.com/other/repo/pull/1"]){const f=fixture();mutate(f);assert.deepEqual(await f.run(),[]);}
});
test("independent review, artifacts and complete simulation remain required",async()=>{
 for(const mutate of [(f:any)=>f.jobs[3].result.evidence.pipelineState.evidence[2].actorId="builder",(f:any)=>f.jobs[3].result.evidence.pipelineState.evidence[0].artifactIds=[],(f:any)=>f.jobs[3].result.evidence.pipelineState.evidence[1].viewports=["desktop"],(f:any)=>f.jobs[3].completedAt="bad"]){const f=fixture();mutate(f);assert.deepEqual(await f.run(),[]);}
});
test("empty journal performs no predecessor reads and exposes no inferred results",async()=>{assert.deepEqual(await readFactoryOrderProposals({owner:"owner",jobs:[],projects:[],getCompletedJob:async()=>{throw Error("must not read");}}),{proposals:[],status:"complete"});});

test("failed-build recovery requires the existing ledger verifier and exact rebase identity",async()=>{
 const f=fixture(),build=f.jobs[1] as any,original=structuredClone(f.jobs[0].result.evidence.pipelineState),oldBase=original.finding.baseSha,newBase="e".repeat(40);
 const failed:any={...structuredClone(build),id:"failed",kind:"build",status:"failed",reservedCents:10,headSha:undefined,result:{status:"failed",reason:"FACTORY_REMOTE_BUILD_FAILED:PATCH",costCents:1,evidence:{pipelineState:original}}};
 build.key="failed.repair";build.payload={previousJobId:"failed",repairAttempts:1,recovery:{rebase:{originalBaseSha:oldBase,targetBaseSha:newBase}}};
 for(const job of f.jobs.slice(1)){const s=job.result.evidence.pipelineState as any;s.finding={...s.finding,baseSha:newBase};s.candidate={...s.candidate,baseSha:newBase};s.evidence=s.evidence.map((e:any)=>({...e,baseSha:newBase}));}
 assert.deepEqual(await f.run(),[]);
 let calls=0;const verified=async(key:string,id:string,successor:string)=>{calls++;assert.equal(key,owner);assert.equal(id,"failed");assert.equal(successor,"build");return failed;};
 assert.equal((await f.run(verified)).length,1);assert.equal(calls,1);
 build.payload.recovery.rebase.originalBaseSha="f".repeat(40);assert.deepEqual(await f.run(verified),[]);
});

test("a stalled storage read returns unavailable within the overall budget and launches no later reads",async()=>{
 const f=fixture();let reads=0;const start=performance.now();
 const result=await readFactoryOrderProposals({owner:"owner",jobs:[f.jobs[3],{...f.jobs[3],id:"second"}] as any,projects:[f.project],readBudgetMs:20,getCompletedJob:async()=>{reads++;return await new Promise(()=>{});}});
 assert.equal(result.status,"unavailable");assert.deepEqual(result.proposals,[]);assert.equal(reads,1);assert.ok(performance.now()-start<1000);
});
