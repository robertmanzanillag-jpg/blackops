import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { advanceAcademy, advanceCompany, emptyCompanyState, enrollTrainee, parseCompanyState } from "../shared/agent-company";
import { createAcademyReviewRunner, reserveAcademyReview, commitAcademyReview } from "../server/office-academy-runner";
const NOW = Date.parse("2026-11-06T12:00:00Z");
const modules = [{id:"rules",title:"Rules",summary:"Review authorization, SQL and secrets"}];
function correctText(prompt: string) {
  const findings = prompt.includes("reviewer-heldout-v1:access")
    ? [{caseId:"r01",category:"authorization"},{caseId:"r02",category:"authorization"},{caseId:"r02",category:"secret_disclosure"}]
    : prompt.includes("reviewer-heldout-v1:data")
      ? [{caseId:"r04",category:"sql_injection"},{caseId:"r05",category:"command_injection"}]
      : [{caseId:"r07",category:"path_traversal"},{caseId:"r08",category:"secret_disclosure"}];
  return JSON.stringify({findings});
}
function setup() {
  let state = advanceCompany(emptyCompanyState(), {now:NOW,roles:{"claude-reviewer":"Reviewer"},statuses:{"claude-reviewer":{state:"working",label:"ready"}}}).state;
  state = enrollTrainee(state,{id:"candidate",forAgentId:"claude-reviewer",role:"Reviewer",now:NOW});
  return advanceAcademy(state,()=>modules,NOW);
}
test("paired real-executor protocol persists verifiable artifacts; versioned benchmark qualification never activates replacement by itself",async()=>{
  let state=setup(); let time=NOW; let calls=0;
  const run=createAcademyReviewRunner({now:()=>time,run:async prompt=>{
    calls++; time+=10;
    return {sessionId:`s${calls}`,text:calls%2?'{"findings":[]}':correctText(prompt),completedAt:new Date(time).toISOString()};
  }});
  for(let i=0;i<3;i++){
    time=NOW+i*86400000;
    const reserved=reserveAcademyReview(state,modules,time,`job-${i}`); state=reserved.state;
    assert.ok(reserved.job);
    const result=await run(state,reserved.job!);
    state=commitAcademyReview(state,reserved.job!,result,time);
    assert.equal(state.academyJobs!.at(-1)!.status,"completed");
    assert.equal(result.scope,"benchmark"); assert.equal(result.profileId,"reviewer-heldout"); assert.equal(result.profileVersion,"1");
    assert.equal(state.trainees[0].assessments!.at(-1)!.artifacts!.candidateSessionId,`s${calls}`);
  }
  state=advanceAcademy(state,()=>modules,time);
  assert.ok(state.trainees[0].qualifiedAt);
  assert.equal(state.trainees[0].graduatedAt,undefined);
  assert.equal(state.careers["claude-reviewer"].generation,1);
  assert.equal(calls,6);
});
test("reservations are bounded, expire without retry and unsupported roles explicitly block",()=>{
  let state=setup();
  state=enrollTrainee(state,{id:"other",forAgentId:"radio",role:"Radio",now:NOW});
  const reserved=reserveAcademyReview(state,modules,NOW,"first");
  assert.equal(reserveAcademyReview(reserved.state,modules,NOW,"duplicate").job,undefined);
  const expired=reserveAcademyReview(reserved.state,modules,NOW+86400000,"retry");
  assert.equal(expired.job,undefined);
  assert.equal(expired.state.academyJobs![0].status,"unknown");
  assert.match(expired.state.trainees.find(t=>t.id==="other")!.executionBlocker!,/No verified/);
  const completed={...reserved.state,academyJobs:reserved.state.academyJobs!.map(j=>({...j,status:"completed" as const}))};
  assert.equal(reserveAcademyReview(completed,modules,NOW+86400000,"first").job,undefined,"stored job IDs cannot be reused");
});
test("tampered artifact and late completion cannot add evidence",async()=>{
  const reserved=reserveAcademyReview(setup(),modules,NOW,"job");
  let calls=0;
  const runner=createAcademyReviewRunner({now:()=>NOW+100,run:async prompt=>({sessionId:`s${++calls}`,text:correctText(prompt),completedAt:new Date(NOW+100).toISOString()})});
  const result=await runner(reserved.state,reserved.job!);
  const tampered={...result,artifacts:{...result.artifacts,candidateText:'{"issues":[]}'}};
  assert.equal(commitAcademyReview(reserved.state,reserved.job!,tampered,NOW+100).academyJobs![0].status,"blocked");
  assert.equal(commitAcademyReview(reserved.state,reserved.job!,result,NOW+6*60000).academyJobs![0].status,"unknown");
});
test("equal-quality candidate is never promoted and malformed output fails qualification",async()=>{
  const reserved=reserveAcademyReview(setup(),modules,NOW,"job"); let calls=0;
  const runner=createAcademyReviewRunner({now:()=>NOW+100,run:async prompt=>({sessionId:`s${++calls}`,text:calls===1?correctText(prompt):'not json',completedAt:new Date(NOW+100).toISOString()})});
  const result=await runner(reserved.state,reserved.job!);
  assert.equal(result.passed,false);assert.equal(result.quality,0);assert.equal(result.incumbentQuality,100);
});

test("three equal-quality fixtures do not qualify a challenger",async()=>{
  let state=setup();let time=NOW;let calls=0;
  const run=createAcademyReviewRunner({now:()=>time,run:async prompt=>{time+=10; return {sessionId:`equal-${++calls}`,text:correctText(prompt),completedAt:new Date(time).toISOString()};}});
  for(let i=0;i<3;i++){time=NOW+i*86400000;const r=reserveAcademyReview(state,modules,time,`equal-job-${i}`);state=commitAcademyReview(r.state,r.job!,await run(r.state,r.job!),time);}
  state=advanceAcademy(state,()=>modules,time);
  assert.equal(state.trainees[0].qualifiedAt,undefined);assert.equal(state.trainees[0].graduatedAt,undefined);
});
test("corrupt persisted reservations quarantine execution instead of retrying",()=>{
  const reserved=reserveAcademyReview(setup(),modules,NOW,"bad");
  reserved.state.academyJobs![0].expiresAt="bad-date";
  const state=parseCompanyState(JSON.parse(JSON.stringify(reserved.state)));
  assert.equal(state.academyJobs![0].status,"unknown");
  assert.equal(reserveAcademyReview(state,modules,NOW+86400000).job,undefined);
});

test("tailored curriculum snapshot binds reservation and a changed course fences completion",async()=>{
  let state=setup();const tailored=[{id:"puesto:reviewer",title:"Specific role",summary:"Learn from last failure"},...modules];
  state=advanceAcademy(state,()=>tailored,NOW+1);
  const reserved=reserveAcademyReview(state,modules,NOW+2,"tailored");
  assert.equal(reserved.job!.curriculumVersion,JSON.stringify(tailored.map(m=>[m.id,m.title,m.summary])));
  let calls=0;const run=createAcademyReviewRunner({now:()=>NOW+100,run:async prompt=>({sessionId:`s${++calls}`,text:correctText(prompt),completedAt:new Date(NOW+100).toISOString()})});
  const result=await run(reserved.state,reserved.job!);
  reserved.state.trainees[0].curriculumSnapshot=[{...tailored[0],summary:"changed"},...modules];
  const next=commitAcademyReview(reserved.state,reserved.job!,result,NOW+100);
  assert.equal(next.academyJobs![0].status,"blocked");assert.equal(next.trainees[0].assessments?.length||0,0);
});

test("paired profile catches false positives on clean code and records multi-finding outputs",async()=>{
  const reserved=reserveAcademyReview(setup(),modules,NOW,"negative");let calls=0;
  const run=createAcademyReviewRunner({now:()=>NOW+100,run:async prompt=>{
    const output=JSON.parse(correctText(prompt));
    if(++calls===2) output.findings.push({caseId:"r03",category:"authorization"});
    return {sessionId:`negative-${calls}`,text:JSON.stringify(output),completedAt:new Date(NOW+100).toISOString()};
  }});
  const result=await run(reserved.state,reserved.job!);
  assert.equal(result.incumbentQuality,100);assert.equal(result.quality,75);assert.equal(result.passed,false);
  assert.equal(JSON.parse(result.artifacts.incumbentText).findings.filter((f:{caseId:string})=>f.caseId==="r02").length,2);
});

test("provider models and measured usage must be comparable; missing API usage is not free",async()=>{
  const reserved=reserveAcademyReview(setup(),modules,NOW,"usage");
  for(const mode of ["model-mismatch","missing-usage","missing-model","invalid-tokens"]){
    let calls=0;
    const run=createAcademyReviewRunner({now:()=>NOW+100,run:async prompt=>({
      sessionId:`api-${++calls}`,text:correctText(prompt),completedAt:new Date(NOW+100).toISOString(),provider:"openai",
      model:mode==="missing-model"?"":mode==="model-mismatch"&&calls===2?"different":"same",
      ...(mode==="missing-usage"&&calls===2?{}:{usage:{totalTokens:mode==="invalid-tokens"?NaN:12}}),
    })});
    await assert.rejects(run(reserved.state,reserved.job!),/INCOMPARABLE_COST_BASIS/);
  }
  let calls=0;
  const run=createAcademyReviewRunner({now:()=>NOW+100,run:async prompt=>({sessionId:`same-${++calls}`,text:correctText(prompt),completedAt:new Date(NOW+100).toISOString(),provider:"openai",model:"same",usage:{totalTokens:calls===1?12:10}})});
  const result=await run(reserved.state,reserved.job!);
  assert.equal(result.cost,10);assert.equal(result.incumbentCost,12);assert.equal(result.costBasis,"measured_tokens_not_usd");
  assert.equal(result.artifacts.provider,"openai");assert.equal(result.artifacts.candidateModel,result.artifacts.incumbentModel);
});

test("commit rejects unbound policy, legacy profile, tampered metrics and forged grades",async()=>{
  const reserved=reserveAcademyReview(setup(),modules,NOW,"fenced");
  reserved.job!.incumbentPolicyVersion="base-1";reserved.job!.candidatePolicyVersion="candidate-1";
  let calls=0;
  const run=createAcademyReviewRunner({now:()=>NOW+100,run:async prompt=>({sessionId:`fence-${++calls}`,text:correctText(prompt),completedAt:new Date(NOW+100).toISOString()})});
  const result=await run(reserved.state,reserved.job!);
  for(const changed of [{...result,quality:99},{...result,cost:1},{...result,durationMs:999},{...result,scope:"fixture" as const},{...result,profileVersion:"old"},{...result,completedAt:new Date(NOW-1).toISOString()},{...result,completedAt:new Date(NOW+101).toISOString()}]){
    assert.equal(commitAcademyReview(reserved.state,reserved.job!,changed,NOW+100).academyJobs![0].status,"blocked");
  }
  const artifacts={...result.artifacts,candidatePolicyVersion:"other"};
  const forged={...result,artifacts,artifactId:createHash("sha256").update(JSON.stringify(artifacts)).digest("hex")};
  assert.equal(commitAcademyReview(reserved.state,reserved.job!,forged,NOW+100).academyJobs![0].status,"blocked");
  assert.equal(commitAcademyReview(reserved.state,{...reserved.job!,candidatePolicyVersion:"other"},result,NOW+100),reserved.state);
});
