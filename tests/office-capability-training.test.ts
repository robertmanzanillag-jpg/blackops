import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createCapabilityTrainer,parseCapabilityTraining,capabilityTrainingSummary,capabilityRunSummary,prepareCapabilityCancellation,applyCapabilityCancellation,CAPABILITY_PROMPT_VERSION,type CapabilityTrainingState} from "../server/office-capability-training";
import {auditSavedRole} from "../server/office-role-audits";
import {sourceDigest as digest,PENDING_OFFICE_ROLES,type PendingOfficeRole} from "../server/office-role-snapshots";
import {parseRoleWork,type RoleWorkJob,type RoleWorkState} from "../server/office-role-work";
const NOW=Date.parse("2026-11-07T01:00:00Z"),owner="owner";
function realJob(at:number):RoleWorkJob{
 const sourceBody={version:1 as const,role:"control" as const,ownerKey:digest(owner),observedAt:new Date(at).toISOString(),total:1,rows:[{id:"permission1",scope:"publish",level:"autonomous",risk:"high",enabled:true}]},source={...sourceBody,sourceDigest:digest(sourceBody)};
 const audit=auditSavedRole("control",source,owner,at),job:RoleWorkJob={id:randomUUID(),fence:randomUUID(),role:"control",generation:1,slot:new Date(at).toISOString().slice(0,10),startedAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString(),completedAt:new Date(at).toISOString(),status:"completed",source,audit};
 job.artifactId=digest({id:job.id,role:job.role,generation:1,fence:job.fence,source,audit});return job;
}
const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
function fixture(mode:"improve"|"tie"|"costfail"|"late"|"regress"|"expensive"|"changed_during"|"pause"|"unadmitted"|"schema"="improve"){
 const sessionPrefix=randomUUID();let busy=false,stopped=false; let clock=NOW,state:CapabilityTrainingState=parseCapabilityTraining(undefined,owner),calls=0;const generations:Record<string,number>={control:1};let work:RoleWorkState={version:1,ownerKey:digest(owner),jobs:[realJob(NOW)]};const requests=new Map<string,any>();
 const trainer=createCapabilityTrainer({owner,maxCallsPerDay:2,now:()=>clock,shouldStop:()=>stopped,loadWork:async()=>parseRoleWork(work,owner),transact:async(change)=>{const next=change(structuredClone(state),generations,busy);state=parseCapabilityTraining(reorder(next),owner);return structuredClone(state);},run:async(raw,call)=>{
  calls++;const prompt=JSON.parse(raw),task=prompt.source,trained=prompt.lessons.length>0,holdout=task.id.startsWith("source-triage-holdout");
  if(mode==="unadmitted"&&holdout)throw Error("not admitted");
  if(mode==="pause"&&holdout&&!trained)stopped=true;
  assert.equal(prompt.promptVersion,CAPABILITY_PROMPT_VERSION);assert.equal(prompt.responseSchema.properties.scope.const,"source-triage-v1");
  assert.ok(!("expected" in prompt));assert.ok(prompt.lessons.every((l:string)=>!l.includes("heldout:")));
  const sourceIssue=task.issueCodes.some((c:string)=>["SOURCE_MISSING","SOURCE_STALE"].includes(c));let decision=task.sourceBlocked||sourceIssue?"review_source":task.issueCodes.length?"review_findings":"record_audit";
  if(!trained && holdout && mode!=="tie")decision=decision==="record_audit"?"review_source":"record_audit";
  const text=((!trained&&!holdout)&&mode!=="schema")||(trained&&!holdout&&mode==="regress")?"{}":JSON.stringify({scope:mode==="schema"?prompt.responseSchema.properties.scope.const:"source-triage-v1",evidenceIds:task.evidenceIds,issueCodes:task.issueCodes,decision});
  if(mode==="changed_during")generations.control=2;
  clock+=mode==="late"?360000:trained?1:2;
  const result={text,sessionId:`resp_${sessionPrefix}_${calls}`,provider:"openai" as const,model:"same-model",completedAt:new Date(clock).toISOString(),usage:{inputTokens:10,outputTokens:5,totalTokens:15}};requests.set(call.executionId,{result,trained});return result;
 },verifyCost:async request=>{if(mode==="costfail")throw Error("unpriced");return {receiptId:`ledger:${request.responseId}`,executionId:request.executionId,responseId:request.responseId,model:request.model,usage:request.usage,currency:"USD",usd:requests.get(request.executionId).trained?(mode==="expensive"?0.003:0.001):0.002};}});
 return {trainer,seedWork:(value:RoleWorkState)=>{work=parseRoleWork(value,owner);},setBusy:(v:boolean)=>{busy=v;},seed:(s:CapabilityTrainingState)=>{state=parseCapabilityTraining(s,owner);},state:()=>state,calls:()=>calls,setTime:(v:number)=>{clock=v;},generations,addJob:(at:number)=>{work={...work,jobs:[...work.jobs,realJob(at)]};}};
}
test("real incumbent errors generate bounded lessons; separate priced holdouts apply only narrow policy on next real task",async()=>{
 const f=fixture();await Promise.all([f.trainer.tick(),f.trainer.tick()]);assert.equal(f.calls(),1);let state=f.state();assert.equal(state.runs[0].kind,"production");assert.equal(state.policies.length,2);assert.deepEqual(state.policies.find(p=>p.status==="candidate")!.lessons,["invalid_output"]);
 for(let day=1;day<=3;day++){f.setTime(NOW+day*86400000);await f.trainer.tick();}
 state=f.state();assert.equal(state.runs.filter(r=>r.kind==="holdout").length,3);assert.equal(state.policies.find(p=>p.parentVersion!==null)!.status,"probation");
 const next=NOW+4*86400000;f.setTime(next);f.addJob(next);await f.trainer.tick();state=f.state();const active=state.policies.find(p=>p.parentVersion!==null)!;assert.equal(active.status,"active");assert.equal(state.runs.at(-1)!.policyVersion,active.version);assert.equal(state.runs.at(-1)!.kind,"production");assert.equal(state.runs.at(-1)!.generation,1);
 assert.ok(capabilityTrainingSummary(state,owner).every(s=>s.fullRolePromotion===false));assert.doesNotThrow(()=>parseCapabilityTraining(reorder(state),owner));
 const corrupt=structuredClone(state);corrupt.runs[0].trained!.cost.usd=999;assert.throws(()=>parseCapabilityTraining(corrupt,owner));
});
test("equal held-out quality is rejected without policy activation",async()=>{
 const f=fixture("tie");await f.trainer.tick();for(let day=1;day<=3;day++){f.setTime(NOW+day*86400000);await f.trainer.tick();}assert.equal(f.state().policies.find(p=>p.parentVersion!==null)!.status,"rejected");assert.equal(capabilityTrainingSummary(f.state(),owner).some(s=>s.comparisonQualified),false);
});
test("missing independent cost or late completion is unknown and never retried",async()=>{
 for(const mode of ["costfail","late"] as const){const f=fixture(mode);await f.trainer.tick();assert.equal(f.state().runs[0].status,"unknown");f.setTime(NOW+2*86400000);await f.trainer.tick();assert.equal(f.calls(),1);assert.ok(f.state().runs[0].unverifiedResult);}
});
test("changed holder cannot consume old-generation production audit or training budget",async()=>{
 const f=fixture();f.generations.control=2;await f.trainer.tick();assert.equal(f.calls(),0);assert.equal(f.state().runs.length,0);
});
test("higher measured cost prevents qualification and a failed first real application restores the parent policy",async()=>{
 for(const mode of ["expensive","regress"] as const){const f=fixture(mode);await f.trainer.tick();for(let day=1;day<=3;day++){f.setTime(NOW+day*86400000);await f.trainer.tick();}
  if(mode==="expensive"){assert.equal(f.state().policies.find(p=>p.parentVersion!==null)!.status,"rejected");continue;}
  const next=NOW+4*86400000;f.setTime(next);f.addJob(next);await f.trainer.tick();assert.equal(f.state().policies.find(p=>p.parentVersion!==null)!.status,"rejected");assert.equal(f.state().policies.find(p=>p.parentVersion===null)!.status,"active");
 }
});
test("holder changed during provider invocation cannot receive completion, and forged activation fails closed",async()=>{
 const f=fixture("changed_during");await f.trainer.tick();assert.equal(f.state().runs[0].status,"unknown");
 const training=fixture();await training.trainer.tick();const forged=structuredClone(training.state());forged.policies.find(p=>p.status==="candidate")!.status="active";assert.throws(()=>parseCapabilityTraining(forged,owner),/UNQUALIFIED/);
 const lessons=structuredClone(training.state());lessons.policies.find(p=>p.status==="candidate")!.lessons=["decision_mismatch"];assert.throws(()=>parseCapabilityTraining(lessons,owner));
});

test("shared academy admission and policy capacity fail closed without poisoning durable history",async()=>{
 const busy=fixture();busy.setBusy(true);await busy.trainer.tick();assert.equal(busy.calls(),0);busy.setBusy(false);await busy.trainer.tick();assert.equal(busy.calls(),1);
 const f=fixture();const state=parseCapabilityTraining(undefined,owner);for(let generation=2;generation<=100;generation++){const body={role:"control" as const,generation,parentVersion:null,lessons:[],trainingRunId:null};state.policies.push({...body,version:digest({capability:"source-triage-v1",...body}),status:"active"});}f.seed(state);await f.trainer.tick();assert.equal(f.calls(),1);assert.equal(f.state().policies.length,100);assert.equal(f.state().runs[0].status,"completed");assert.equal(f.state().policies.some(p=>p.status==="candidate"),false);parseCapabilityTraining(f.state(),owner);
});

test("all 14 current holders receive their first real audit before any candidate consumes paired calls",async()=>{
 let clock=NOW,calls=0,state=parseCapabilityTraining(undefined,owner);const generations=Object.fromEntries(PENDING_OFFICE_ROLES.map(role=>[role,1]));
 const job=(role:PendingOfficeRole,generation:number):RoleWorkJob=>{const audit=auditSavedRole(role,undefined,owner,clock),value:RoleWorkJob={id:randomUUID(),fence:randomUUID(),role,generation,slot:new Date(clock).toISOString().slice(0,10),startedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+60000).toISOString(),completedAt:new Date(clock).toISOString(),status:"blocked",audit};value.artifactId=digest({id:value.id,role,generation,fence:value.fence,audit});return value;};
 let work:RoleWorkState={version:1,ownerKey:digest(owner),jobs:PENDING_OFFICE_ROLES.map(role=>job(role,1))};
 const make=()=>createCapabilityTrainer({owner,maxCallsPerDay:14,now:()=>clock,loadWork:async()=>parseRoleWork(work,owner),transact:async(change)=>{state=parseCapabilityTraining(reorder(change(structuredClone(state),generations)),owner);return structuredClone(state);},run:async()=>{calls++;clock++;return {text:"{}",provider:"openai",model:"same-model",sessionId:`resp_fair_${calls}`,completedAt:new Date(clock).toISOString(),usage:{inputTokens:1,outputTokens:1,totalTokens:2}};},verifyCost:async request=>({...request,receiptId:`verified:${request.responseId}`,currency:"USD",usd:0.001})});
 for(let i=0;i<14;i++){await Promise.all([make().tick(),make().tick()]);assert.equal(calls,i+1);assert.equal(state.runs.every(r=>r.kind==="production"),true);}
 assert.equal(new Set(state.runs.map(r=>r.role)).size,14);assert.equal(state.policies.filter(p=>p.status==="candidate").length,14);const history=structuredClone(state.runs);
 await make().tick();assert.equal(calls,14);assert.deepEqual(state.runs,history);
 // Once all holders have a baseline, resume the existing paired schedule.
 clock=NOW+86400001;await make().tick();assert.equal(calls,16);assert.equal(state.runs.at(-1)!.kind,"holdout");
 // An unseen replacement generation gets its own baseline before old holdouts.
 const role=PENDING_OFFICE_ROLES[0];generations[role]=2;work={...work,jobs:[...work.jobs,job(role,2)]};await make().tick();assert.equal(calls,17);assert.equal(state.runs.at(-1)!.kind,"production");assert.equal(state.runs.at(-1)!.role,role);assert.equal(state.runs.at(-1)!.generation,2);assert.deepEqual(state.runs.slice(0,14),history);
});

test("cooperative pause after baseline drains the reserved pair and forbids new work",async()=>{
 const f=fixture("pause");await f.trainer.tick();f.setTime(NOW+86400000);await f.trainer.tick();assert.equal(f.calls(),3);assert.equal(f.state().runs.at(-1)!.status,"completed");assert.ok(f.state().runs.at(-1)!.baseline);assert.ok(f.state().runs.at(-1)!.trained);f.setTime(NOW+2*86400000);await f.trainer.tick();assert.equal(f.calls(),3);
});
test("operator cancellation preserves zero-admission unknown history and rejects its candidate without retry",async()=>{
 const f=fixture("unadmitted");await f.trainer.tick();f.setTime(NOW+86400000);await f.trainer.tick();const before=structuredClone(f.state()),run=before.runs.at(-1)!;assert.equal(run.status,"unknown");assert.equal(run.baseline,undefined);assert.equal(run.unverifiedResult,undefined);
 const now=NOW+86400100,verify=async(request:any)=>({...request,verifiedAt:new Date(now).toISOString(),baselineNeverAdmitted:true as const,trainedNeverAdmitted:true as const,runtimeDrained:true as const,ledgerEvidenceId:"operator-locked-ledger-query",ledgerSnapshotSha256:"e".repeat(64)});
 const options={raw:before,owner,runId:run.id,fence:run.fence,operatorAuditId:"cancel-zero-1",now,verify};
 await assert.rejects(()=>prepareCapabilityCancellation({...options,verify:async request=>({...await verify(request),trainedNeverAdmitted:false as any})}));
 const approval=await prepareCapabilityCancellation(options),after=applyCapabilityCancellation(before,owner,approval,now);assert.equal(after.runs.length,before.runs.length);assert.equal(after.runs.at(-1)!.status,"cancelled");assert.equal(after.runs.at(-1)!.reason,run.reason);assert.equal(after.policies.find(p=>p.version===run.policyVersion)!.status,"rejected");assert.equal(after.policies.find(p=>p.version===run.baselineVersion)!.status,"active");assert.doesNotThrow(()=>parseCapabilityTraining(reorder(after),owner));
 assert.throws(()=>applyCapabilityCancellation(after,owner,approval,now));assert.throws(()=>applyCapabilityCancellation(before,owner,{...approval,fence:randomUUID()},now));assert.throws(()=>applyCapabilityCancellation(before,owner,approval,now+60001));
 const forged=structuredClone(after);forged.runs.at(-1)!.cancellation!.trainedExecutionId="different";assert.throws(()=>parseCapabilityTraining(forged,owner));
 f.seed(after);f.setTime(NOW+2*86400000);await f.trainer.tick();assert.equal(f.calls(),2);assert.equal(f.state().runs.length,2);
 const paid=fixture("late");await paid.trainer.tick();const uncertain=paid.state().runs[0];await assert.rejects(()=>prepareCapabilityCancellation({...options,raw:paid.state(),runId:uncertain.id,fence:uncertain.fence}));
});

function legacyState(raw:CapabilityTrainingState):CapabilityTrainingState{
 const copy=structuredClone(raw),versions=new Map<string,string>();
 copy.policies=copy.policies.map(p=>{const {version,status,promptVersion,origin,...body}=p;body.parentVersion=body.parentVersion?versions.get(body.parentVersion)!:null;const legacyVersion=digest({capability:"source-triage-v1",...body});versions.set(version,legacyVersion);return {...body,version:legacyVersion,status};});
 copy.runs=copy.runs.map(r=>{delete r.promptVersion;r.policyVersion=versions.get(r.policyVersion)!;if(r.baselineVersion)r.baselineVersion=versions.get(r.baselineVersion)!;if(r.cancellation){const {artifactId,cancellation,...prior}=r;r.cancellation.priorRunSha256=digest({...prior,status:"unknown"});}if(r.artifactId){const {artifactId,...body}=r;r.artifactId=digest(body);}return r;});return parseCapabilityTraining(copy,owner);
}
test("legacy instruction errors remain byte-stable history while corrected schema gets a fresh independent baseline",async()=>{
 const old=fixture();await old.trainer.tick();const legacy=legacyState(old.state()),before=JSON.stringify(legacy);assert.deepEqual(parseCapabilityTraining(legacy,owner),legacy);assert.match(capabilityRunSummary(legacy.runs[0]).promptLabel,/ambigüedad/);assert.equal(capabilityRunSummary(legacy.runs[0]).quality,0);
 const corrected=fixture("schema");corrected.seed(legacy);corrected.seedWork({version:1,ownerKey:digest(owner),jobs:[legacy.runs[0].sourceJob as RoleWorkJob]});await corrected.trainer.tick();const state=corrected.state();assert.equal(corrected.calls(),1);assert.equal(state.runs.at(-1)!.kind,"production");assert.equal(state.runs.at(-1)!.promptVersion,CAPABILITY_PROMPT_VERSION);assert.equal(capabilityRunSummary(state.runs.at(-1)!).promptLabel,"Instrucción corregida");assert.equal(capabilityRunSummary(state.runs.at(-1)!).quality,100);assert.equal(state.runs.at(-1)!.task.id,legacy.runs[0].task.id);assert.equal(state.policies.at(-1)!.origin,"instruction_correction");assert.equal(state.policies.at(-1)!.parentVersion,null);assert.equal(state.policies.filter(p=>p.promptVersion===CAPABILITY_PROMPT_VERSION&&p.status==="candidate").length,0);
 assert.equal(JSON.stringify({ ...legacy,policies:state.policies.slice(0,legacy.policies.length),runs:state.runs.slice(0,legacy.runs.length)}),before);assert.equal(capabilityTrainingSummary(state,owner).filter(p=>p.promptVersion==="source-triage-prompt-v1").some(p=>p.comparisonQualified||p.runtimeApplicable),false);
 corrected.setTime(NOW+2*86400000);await corrected.trainer.tick();assert.equal(corrected.calls(),1); // Old candidate is not resumed.
 const mixed=structuredClone(state);mixed.runs.at(-1)!.policyVersion=legacy.runs[0].policyVersion;assert.throws(()=>parseCapabilityTraining(mixed,owner),/ASSIGNMENT/);
});
test("version upgrade repeats all 14 audits but still counts every legacy call under the unchanged daily cap",async()=>{
 let clock=NOW,calls=0,schemaAware=false,state=parseCapabilityTraining(undefined,owner);const generations=Object.fromEntries(PENDING_OFFICE_ROLES.map(role=>[role,1]));
 const work:RoleWorkState={version:1,ownerKey:digest(owner),jobs:PENDING_OFFICE_ROLES.map(role=>{const audit=auditSavedRole(role,undefined,owner,clock),job:RoleWorkJob={id:randomUUID(),fence:randomUUID(),role,generation:1,slot:new Date(clock).toISOString().slice(0,10),startedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+60000).toISOString(),completedAt:new Date(clock).toISOString(),status:"blocked",audit};job.artifactId=digest({id:job.id,role,generation:1,fence:job.fence,audit});return job;})};
 const trainer=createCapabilityTrainer({owner,maxCallsPerDay:28,now:()=>clock,loadWork:async()=>work,transact:async(change)=>{state=parseCapabilityTraining(reorder(change(structuredClone(state),generations)),owner);return structuredClone(state);},run:async raw=>{calls++;clock++;const p=JSON.parse(raw);return {text:schemaAware?JSON.stringify({scope:p.responseSchema.properties.scope.const,evidenceIds:p.source.evidenceIds,issueCodes:p.source.issueCodes,decision:"review_source"}):"{}",provider:"openai",model:"same-model",sessionId:`resp_upgrade_${calls}`,completedAt:new Date(clock).toISOString(),usage:{inputTokens:1,outputTokens:1,totalTokens:2}};},verifyCost:async request=>({...request,receiptId:`verified:${request.responseId}`,currency:"USD",usd:0.001})});
 for(let i=0;i<14;i++)await trainer.tick();state=legacyState(state);const history=structuredClone(state);schemaAware=true;
 for(let i=0;i<14;i++)await trainer.tick();assert.equal(calls,28);assert.equal(state.runs.length,28);assert.equal(new Set(state.runs.filter(r=>r.promptVersion===CAPABILITY_PROMPT_VERSION).map(r=>r.role)).size,14);assert.equal(state.runs.every(r=>r.kind==="production"),true);assert.deepEqual(state.runs.slice(0,14),history.runs);assert.deepEqual(state.policies.slice(0,history.policies.length),history.policies);
 await trainer.tick();assert.equal(calls,28);
});
test("only independently proved zero-admission cancellation releases daily call slots, never unknown or completed pairs",async()=>{
 const cancelled=fixture("unadmitted");await cancelled.trainer.tick();cancelled.setTime(NOW+86400000);await cancelled.trainer.tick();const run=cancelled.state().runs.at(-1)!,now=NOW+86400100;
 const approval=await prepareCapabilityCancellation({raw:cancelled.state(),owner,runId:run.id,fence:run.fence,operatorAuditId:"budget-zero",now,verify:async request=>({...request,verifiedAt:new Date(now).toISOString(),baselineNeverAdmitted:true,trainedNeverAdmitted:true,runtimeDrained:true,ledgerEvidenceId:"locked-ledgers",ledgerSnapshotSha256:"d".repeat(64)})});cancelled.seed(reorder(applyCapabilityCancellation(cancelled.state(),owner,approval,now)));cancelled.addJob(NOW+86400000);await cancelled.trainer.tick();assert.equal(cancelled.calls(),3);assert.equal(cancelled.state().runs.at(-1)!.kind,"production");
 const completed=fixture();await completed.trainer.tick();completed.setTime(NOW+86400000);await completed.trainer.tick();completed.addJob(NOW+86400000);await completed.trainer.tick();assert.equal(completed.calls(),3);assert.equal(completed.state().runs.length,2);
 const unknown=fixture("unadmitted");await unknown.trainer.tick();unknown.setTime(NOW+86400000);await unknown.trainer.tick();unknown.addJob(NOW+86400000);await unknown.trainer.tick();assert.equal(unknown.calls(),2);assert.equal(unknown.state().runs.length,2);
});

test("historically qualified legacy policies stay historical and cannot control corrected-version work",async()=>{
 const f=fixture();await f.trainer.tick();for(let day=1;day<=3;day++){f.setTime(NOW+day*86400000);await f.trainer.tick();}const legacy=legacyState(f.state());assert.equal(legacy.policies.at(-1)!.status,"probation");
 const current=fixture("schema");current.seed(legacy);current.seedWork({version:1,ownerKey:digest(owner),jobs:[legacy.runs[0].sourceJob as RoleWorkJob]});current.setTime(NOW+5*86400000);await current.trainer.tick();assert.equal(current.calls(),1);assert.equal(current.state().runs.at(-1)!.kind,"production");assert.equal(current.state().policies.at(-1)!.origin,"instruction_correction");assert.deepEqual(current.state().policies.slice(0,legacy.policies.length),legacy.policies);assert.equal(capabilityTrainingSummary(current.state(),owner).filter(p=>!p.instructionCorrected).some(p=>p.runtimeApplicable||p.comparisonQualified),false);
 const mixed=structuredClone(current.state()),oldPair=mixed.runs.find(r=>r.kind==="holdout")!;oldPair.promptVersion=CAPABILITY_PROMPT_VERSION;assert.throws(()=>parseCapabilityTraining(mixed,owner),/ASSIGNMENT/);
});
test("a measured partial pair cannot be zero-call cancelled or discounted",async()=>{
 const f=fixture();await f.trainer.tick();f.setTime(NOW+86400000);await f.trainer.tick();const partial=structuredClone(f.state()),run=partial.runs.at(-1)!;run.status="unknown";delete run.trained;delete run.artifactId;f.seed(partial);let verified=false;
 await assert.rejects(()=>prepareCapabilityCancellation({raw:partial,owner,runId:run.id,fence:run.fence,operatorAuditId:"not-zero",now:NOW+86400100,verify:async()=>{verified=true;throw Error("must not verify a paid phase as absent");}}));assert.equal(verified,false);f.addJob(NOW+86400000);await f.trainer.tick();assert.equal(f.calls(),3);assert.equal(f.state().runs.length,2);
});
