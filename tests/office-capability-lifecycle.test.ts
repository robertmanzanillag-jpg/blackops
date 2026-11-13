import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {replayCapabilityPolicyLife} from "../shared/office-capability-lifecycle";
import {capabilityLifecycleSummary} from "../server/office-capability-lifecycle";
import {createCapabilityTrainer,parseCapabilityTraining,gradeCapabilityTriage,CAPABILITY_PROMPT_VERSION,capabilityTrainingSummary} from "../server/office-capability-training";
import {sourceDigest as digest} from "../server/office-role-snapshots";
import {auditSavedRole} from "../server/office-role-audits";
import {parseRoleWork,type RoleWorkJob,type RoleWorkState} from "../server/office-role-work";

const owner="capability-owner",NOW=Date.parse("2026-11-07T00:00:00Z"),DAY=86400000;
const reorder=(value:any):any=>Array.isArray(value)?value.map(reorder):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).reverse().map(k=>[k,reorder(value[k])])):value;
function fixture(){
 let clock=NOW,calls=0,limit=1,failProbation=false,unknown=false;
 let state=parseCapabilityTraining(undefined,owner);
 let work:RoleWorkState={version:1,ownerKey:digest(owner),jobs:[]};
 const generations={control:1};
 function add(blocked=false){
  const body={version:1 as const,role:"control" as const,ownerKey:digest(owner),observedAt:new Date(clock).toISOString(),total:1,rows:[{id:"permission",scope:"publish",level:"autonomous",risk:"high",enabled:true}]};
  const source=blocked?undefined:{...body,sourceDigest:digest(body)},audit=auditSavedRole("control",source,owner,clock);
  const job:RoleWorkJob={id:randomUUID(),fence:randomUUID(),role:"control",generation:1,slot:new Date(clock).toISOString().slice(0,10),startedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+60000).toISOString(),completedAt:new Date(clock).toISOString(),status:blocked?"blocked":"completed",...(source?{source}:{}),audit};
  job.artifactId=digest({id:job.id,role:job.role,generation:1,fence:job.fence,...(source?{source}:{}),audit});work={...work,jobs:[...work.jobs,job]};return job.id;
 }
 const make=()=>createCapabilityTrainer({owner,maxCallsPerDay:limit,now:()=>clock,loadWork:async()=>parseRoleWork(work,owner),transact:async change=>{
  state=parseCapabilityTraining(reorder(change(structuredClone(state),generations)),owner);return structuredClone(state);
 },run:async raw=>{
  calls++;if(unknown)throw Error("infra unavailable");const prompt=JSON.parse(raw),task=prompt.source,trained=prompt.lessons.length>0;
  clock+=trained?1:2;const decision=task.sourceBlocked||task.issueCodes.some((c:string)=>["SOURCE_MISSING","SOURCE_STALE"].includes(c))?"review_source":task.issueCodes.length?"review_findings":"record_audit";
  return {text:!trained||(failProbation&&!task.id.startsWith("source-triage-holdout"))?"{}":JSON.stringify({scope:"source-triage-v1",evidenceIds:task.evidenceIds,issueCodes:task.issueCodes,decision}),sessionId:`resp_${randomUUID()}`,provider:"openai",model:"same-model",completedAt:new Date(clock).toISOString(),usage:{inputTokens:2,outputTokens:2,totalTokens:4}};
 },verifyCost:async request=>({...request,receiptId:`receipt:${request.responseId}`,currency:"USD",usd:0.001})});
 const summary=()=>capabilityLifecycleSummary(parseCapabilityTraining(state,owner),CAPABILITY_PROMPT_VERSION,gradeCapabilityTriage,work);
 return {make,add,state:()=>state,seed:(raw:unknown)=>{state=parseCapabilityTraining(raw,owner);},summary,calls:()=>calls,time:(day:number)=>{clock=NOW+day*DAY;},limit:(n:number)=>{limit=n;},fail:()=>{failProbation=true;},unknown:()=>{unknown=true;},generations};
}

test("eight verified attributable failures retire only the capability; strict successor transfers queued audit and verifies first actual execution",async()=>{
 const f=fixture();for(let day=0;day<8;day++){f.time(day);f.add();await Promise.all([f.make().tick(),f.make().tick()]);}
 const history=structuredClone(f.state().runs),parent=f.state().policies.find(p=>p.parentVersion===null)!;
 assert.equal(f.calls(),8);assert.equal(f.summary().find(p=>p.policyVersion===parent.version)!.status,"retired");
 f.time(8);const pending=f.add();await f.make().tick();assert.equal(f.calls(),8);assert.ok(f.summary()[0].pendingSourceJobIds!.includes(pending));assert.equal(capabilityTrainingSummary(f.state(),owner)[0].runtimeApplicable,false);
 // Reload/recreate a runner on each call. Same durable append-only journal.
 f.limit(2);for(let day=8;day<11;day++){f.time(day);await Promise.all([f.make().tick(),f.make().tick()]);}
 const successor=f.state().policies.find(p=>p.parentVersion!==null)!;assert.equal(successor.status,"probation");assert.equal(f.calls(),14);
 f.time(11);const later=f.add();await Promise.all([f.make().tick(),f.make().tick()]);
 assert.equal(f.calls(),15);assert.equal(f.state().runs.at(-1)!.policyVersion,successor.version);
 assert.equal(f.state().runs.at(-1)!.task.id,pending); // FIFO: new audits cannot starve transferred work.
 assert.equal(f.state().policies.find(p=>p.version===successor.version)!.status,"active");
 assert.equal(f.summary().find(p=>p.policyVersion===successor.version)!.firstVerifiedRunId,f.state().runs.at(-1)!.id);
 assert.deepEqual(f.state().runs.slice(0,8),history);assert.equal(f.generations.control,1);assert.ok(f.summary().every(s=>s.fullRoleReplacement===false));
 // Remaining queued audit retains its original provenance as well.
 f.time(12);await f.make().tick();assert.equal(f.state().runs.at(-1)!.task.id,later);
 assert.equal(f.summary().find(p=>p.policyVersion===successor.version)!.pendingSourceJobIds!.length,0);
});

test("failed successor probation cannot resurrect a retired parent",async()=>{
 const f=fixture();for(let day=0;day<8;day++){f.time(day);f.add();await f.make().tick();}
 f.limit(2);for(let day=8;day<11;day++){f.time(day);await f.make().tick();}
 f.fail();f.time(11);f.add();await f.make().tick();const calls=f.calls();
 f.time(12);f.add();await f.make().tick();assert.equal(f.calls(),calls);assert.equal(f.state().policies.some(p=>["active","probation"].includes(p.status)),false);
 assert.ok(f.summary().some(s=>s.status==="retired"));assert.ok(f.summary().some(s=>s.pendingSourceJobIds!.length));
 assert.ok(f.summary().every(s=>s.capabilityStatus==="blocked_no_qualified_successor"));assert.ok(f.summary()[0].blockedReason?.includes("Preparation exhausted"));
});

test("local eligibility never claims a current generation without the council fence",async()=>{
 const f=fixture();f.add();await f.make().tick();
 const state=f.state(),args=[state,CAPABILITY_PROMPT_VERSION,gradeCapabilityTriage] as const;
 assert.equal(capabilityLifecycleSummary(...args)[0].localAdmissionEligible,true);
 assert.equal(capabilityLifecycleSummary(...args)[0].productionAdmissible,false);
 assert.equal(capabilityLifecycleSummary(...args,undefined,{control:2})[0].productionAdmissible,false);
 assert.equal(capabilityLifecycleSummary(...args,undefined,{control:1})[0].productionAdmissible,true);
});

test("source blocks and unknown infrastructure results never deduct capability life",async()=>{
 const f=fixture();for(let day=0;day<9;day++){f.time(day);f.add(true);await f.make().tick();}assert.equal(f.summary()[0].life,80);assert.equal(f.summary()[0].retiredAt,undefined);
 const uncertain=fixture();uncertain.add();uncertain.unknown();await uncertain.make().tick();uncertain.time(2);await uncertain.make().tick();assert.equal(uncertain.calls(),1);assert.equal(uncertain.summary()[0].life,80);assert.equal(uncertain.summary()[0].status,"execution_unresolved");
});

test("journal capacity blocks without pruning retirement evidence; deleting referenced feedback fails closed",async()=>{
 const f=fixture();for(let day=0;day<8;day++){f.time(day);f.add();await f.make().tick();}
 const state=structuredClone(f.state()),template=state.runs[7];
 for(let i=state.runs.length;i<200;i++){
  const r=structuredClone(template);r.id=randomUUID();r.fence=randomUUID();r.trained!.result.sessionId=`resp_cap_${i}`;r.trained!.cost.responseId=r.trained!.result.sessionId;r.trained!.cost.executionId=`${r.id}:trained`;r.trained!.cost.receiptId=`cap:${i}`;const {artifactId,...body}=r;r.artifactId=digest(body);state.runs.push(r);
 }
 f.seed(reorder(state));const before=structuredClone(f.state());f.time(300);f.limit(28);f.add();await f.make().tick();assert.deepEqual(f.state(),before);assert.equal(f.calls(),8);assert.equal(f.summary()[0].life,0);
 const removed=structuredClone(state);removed.runs.shift();assert.throws(()=>parseCapabilityTraining(removed,owner),/FEEDBACK_UNVERIFIED/);
 assert.equal(capabilityTrainingSummary(state,owner)[0].lifecycle!.queueEvidenceAvailable,false);
});

test("replay is order-independent, rejects duplicate receipt identity, and preserves retirement across subsequent evidence",()=>{
 const records=Array.from({length:8},(_,i)=>({runId:`run${i}`,artifactId:`proof${i}`,policyVersion:"policy",generation:1,startedAt:new Date(NOW+i*DAY).toISOString(),completedAt:new Date(NOW+i*DAY+1).toISOString(),outcome:"attributable_failure" as const}));
 const life=replayCapabilityPolicyLife("policy",1,records);assert.equal(life.life,0);assert.equal(life.retirementRunId,"run7");assert.deepEqual(replayCapabilityPolicyLife("policy",1,[...records].reverse()),life);
 assert.throws(()=>replayCapabilityPolicyLife("policy",1,[...records,records[0]]));assert.throws(()=>replayCapabilityPolicyLife("policy",2,records));
 const after=replayCapabilityPolicyLife("policy",1,[...records,{...records[7],runId:"success",artifactId:"new",startedAt:new Date(NOW+9*DAY).toISOString(),completedAt:new Date(NOW+9*DAY+1).toISOString(),outcome:"passed"}]);assert.equal(after.life,0);assert.equal(after.retirementRunId,"run7");
});
