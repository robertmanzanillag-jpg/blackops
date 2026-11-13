import test from "node:test";
import assert from "node:assert/strict";
import {createRoleAcademyRunner,parseRoleAcademy,roleAcademySummary} from "../server/office-role-academy";
import {roleFixtures} from "../server/office-role-curricula";
const NOW=Date.parse("2026-11-06T12:00:00Z");
function setup(){let time=NOW;const company:any={careers:{code:{generation:1}},academyJobs:[]};let state:any={roles:{version:1,roles:{}},tokens:{reservations:[]}};let chain=Promise.resolve();const calls:any[]=[];
 const council:any={updateOfficeExecution:async(fn:any)=>{const task=chain.then(()=>{state=fn(structuredClone(state),company);return structuredClone(state);});chain=task.then(()=>{},()=>{});return task;}};
 const run=async(prompt:string,call:any)=>{calls.push(call);const p=JSON.parse(prompt);const f=roleFixtures(p.role).find(f=>f.id===p.fixtureId)!;time+=10;return {text:JSON.stringify({version:1,role:p.role,fixtureId:p.fixtureId,...f.expected}),provider:"openai" as const,model:"fixture-model",sessionId:`resp_${calls.length}`,completedAt:new Date(time).toISOString(),usage:{inputTokens:10,outputTokens:10,totalTokens:20}};};
 return {council,company,calls,run,now:()=>time,setTime:(n:number)=>time=n,state:()=>state,setState:(n:any)=>state=n};
}
test("all calls have unique stable assignment identities, saved evidence survives JSONB ordering, and ties never qualify",async()=>{
 const h=setup(),runner=createRoleAcademyRunner({...h,dailyPairs:14});
 for(let i=0;i<3;i++){h.setTime(NOW+i*86400000);await runner.tick();}
 assert.equal(h.calls.length,6);assert.equal(new Set(h.calls.map(c=>c.executionId)).size,6);assert.match(h.calls[0].executionId,/:incumbent$/);assert.match(h.calls[1].executionId,/:candidate$/);
 assert.equal(roleAcademySummary(h.state().roleAcademy).find(r=>r.role==="code")!.candidateQualified,false);
 assert.equal(roleAcademySummary(h.state().roleAcademy).find(r=>r.role==="code")!.completedPairs,3);
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v && typeof v==="object"?Object.fromEntries(Object.keys(v).sort().reverse().map(k=>[k,reorder(v[k])])):v;
 assert.equal(parseRoleAcademy(reorder(h.state().roleAcademy)).jobs.length,3);
 await runner.tick();assert.equal(h.calls.length,6);
});
test("concurrent ticks cannot call a provider twice and restart does not repeat a completed fixture",async()=>{
 const h=setup(),a=createRoleAcademyRunner({...h,dailyPairs:14}),b=createRoleAcademyRunner({...h,dailyPairs:14});await Promise.all([a.tick(),b.tick()]);assert.equal(h.calls.length,2);await createRoleAcademyRunner({...h,dailyPairs:14}).tick();assert.equal(h.calls.length,2);
});
test("candidate interruption preserves incumbent, marks unknown and never retries or changes life",async()=>{
 const h=setup();let attempted=0;const run=async(p:string,c:any)=>{if(++attempted===2)throw Error("network unknown");return h.run(p,c);};const runner=createRoleAcademyRunner({...h,run,dailyPairs:14});await runner.tick();assert.equal(h.state().roleAcademy.jobs[0].status,"unknown");assert.ok(h.state().roleAcademy.jobs[0].incumbent);h.setTime(NOW+86400000);await runner.tick();assert.equal(attempted,2);assert.deepEqual(h.company.careers,{code:{generation:1}});
});
test("known preflight budget refusal blocks without inventing consumption or results",async()=>{
 const h=setup();await createRoleAcademyRunner({...h,run:async()=>{throw Object.assign(Error("budget"),{code:"token_budget_exhausted"});},dailyPairs:1}).tick();assert.equal(h.state().roleAcademy.jobs[0].status,"blocked");assert.equal(h.state().roleAcademy.jobs[0].incumbent,undefined);
});
test("late result and generation changes cannot complete a training assignment",async()=>{
 for(const mutation of ["late","generation"]){const h=setup();const run=async(p:string,c:any)=>{const r=await h.run(p,c);if(mutation==="late")h.setTime(NOW+7*60000);else h.company.careers.code.generation=2;return r;};await createRoleAcademyRunner({...h,run,dailyPairs:1}).tick();assert.equal(h.state().roleAcademy.jobs[0].status,"unknown");assert.equal(h.state().roleAcademy.jobs[0].candidate,undefined);}
});
test("tampered response/usage and reused provider sessions are rejected",async()=>{
 const h=setup();await createRoleAcademyRunner({...h,dailyPairs:1}).tick();const original=h.state().roleAcademy;
 for(const mutate of [(j:any)=>j.candidate.text="{}",(j:any)=>j.candidate.usage.totalTokens=999,(j:any)=>j.candidate.sessionId=j.incumbent.sessionId]){const data=structuredClone(original);mutate(data.jobs[0]);assert.throws(()=>parseRoleAcademy(data));}
});
test("reviewer already running reserves concurrency and daily budget holds across roles",async()=>{
 const h=setup();h.company.careers.github={generation:1};h.company.academyJobs=[{status:"running"}];const r=createRoleAcademyRunner({...h,dailyPairs:1});await r.tick();assert.equal(h.calls.length,0);h.company.academyJobs=[];await r.tick();await r.tick();assert.equal(h.calls.length,2);assert.equal(h.state().roleAcademy.jobs.length,1);
});
