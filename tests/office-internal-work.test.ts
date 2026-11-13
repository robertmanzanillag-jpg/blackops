import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createInternalWorkRunner,prepareInternalArtifact,parseInternalWork,readInternalWorkSnapshot,type InternalWorkSnapshot } from "../server/office-internal-work";
import {recoverRadioReadOnly} from "../server/office-internal-work";
import {completeRoleExecution} from "../shared/office-role-lifecycle";
import { advanceCompany,emptyCompanyState } from "../shared/agent-company";
import { emptyRoleLifecycleState,reconcileRoleLifecycles } from "../shared/office-role-lifecycle";
import type { CouncilState } from "../shared/agent-council";
import { registerAgentCouncilRoutes } from "../server/agent-council-routes";
const NOW=Date.parse("2026-11-06T12:00:00Z"), owner="owner-one";
const key=createHash("sha256").update(JSON.stringify(owner)).digest("hex");
const source=():InternalWorkSnapshot=>({ownerKey:key,observedAt:new Date(NOW).toISOString(),taskTotal:1,approvalTotal:1,tasks:[{id:"task1",title:"Saved task",scheduledAt:"2026-11-06T23:30:00",priority:"high",kind:"meeting"}],approvals:[{id:"approval1",title:"Pending approval",scheduledAt:null,priority:"medium",kind:"email.send"}]});
const jsonbRoundtrip=(value:any):any=>Array.isArray(value)?value.map(jsonbRoundtrip):value && typeof value==="object"?Object.fromEntries(Object.keys(value).sort((a,b)=>a.length-b.length || a.localeCompare(b)).map(k=>[k,jsonbRoundtrip(value[k])])):value;
function fixture(includeRadio=false,jsonb=false){
  let clock=NOW;
  const company=advanceCompany(emptyCompanyState(),{now:NOW-1000,statuses:{ceo:{state:"working",label:"ready"},assistant:{state:"working",label:"ready"},...(includeRadio?{radio:{state:"working" as const,label:"ready"}}:{})},roles:{ceo:"CEO",assistant:"Assistant",...(includeRadio?{radio:"Radio"}:{})}}).state;
  let state:NonNullable<CouncilState["officeExecution"]>={roles:reconcileRoleLifecycles(emptyRoleLifecycleState(),company,NOW),tokens:{reservations:[]}};
  const council={async updateOfficeExecution(change:any){const proposed=change(structuredClone(state),company);state=jsonb?jsonbRoundtrip(proposed):structuredClone(proposed);return structuredClone(state);}};
  return {council,state:()=>state,company,now:()=>clock,setClock:(value:number)=>clock=value};
}
test("Radio incumbent qualification, policy assignment and first real saved-record result commit durably",async()=>{
 const f=fixture(true,true);let reads=0;
 const read=async()=>{reads++;return {...source(),observedAt:new Date(f.now()).toISOString(),radioTotal:1,radio:[{id:"radio1",title:"Radio",scheduledAt:"2026-11-08T19:00:00",description:"7-8PM DJ Alpha\n8-9PM DJ Beta\n9-10PM DJ Gamma"}]};};
 const make=()=>createInternalWorkRunner({council:f.council,owner,now:f.now,read});
 await Promise.all([make().tick(),make().tick()]);
 const work=parseInternalWork(f.state().internalWork),job=work.jobs.find(j=>j.role==="radio")!;
 assert.equal(job.status,"completed");assert.equal(job.artifact?.radioAssignments?.[0].slot7,"DJ Alpha");assert.equal(job.training?.scope,"radio-range-parser-only");
 assert.equal(work.radioTrainingHistory?.length,1);assert.equal(f.state().roles.roles.radio.generation,1);assert.equal(f.company.trainees.find(t=>t.id===job.training?.traineeId)?.assessments?.length,3);
  assert.equal(work.radioTrainingHistory?.[0].firstVerifiedRunId,job.id);assert.equal(work.radioTrainingHistory?.[0].firstExecutionArtifactId,job.artifactId);
 assert.equal(f.state().roles.roles.radio.leases.filter(l=>l.status==="completed").length,1);
 await make().tick();assert.equal(reads,3);
 f.setClock(NOW+86400000);await make().tick();assert.equal(reads,6);assert.equal(f.state().internalWork?.radioTrainingHistory?.length,1);
 const corrupted=structuredClone(f.state().internalWork)!;corrupted.radioTrainingHistory![0].generation=99;assert.throws(()=>parseInternalWork(corrupted));
  const wrongPolicy=structuredClone(f.state().internalWork)!;const radioJob=wrongPolicy.jobs.find(j=>j.role==="radio")!;radioJob.artifact=prepareInternalArtifact("radio",radioJob.artifact!.snapshot,"radio-slots-baseline-v1");radioJob.artifactId=createHash("sha256").update(JSON.stringify(radioJob.artifact)).digest("hex");assert.throws(()=>parseInternalWork(wrongPolicy),/policy mismatch/);
});
test("Radio source failure keeps trained incumbent active without inventing completed work or promoting vacancy",async()=>{
 const f=fixture(true);await createInternalWorkRunner({council:f.council,owner,now:f.now,read:async()=>source()}).tick();
 assert.equal(f.state().internalWork?.jobs.find(j=>j.role==="radio")?.status,"blocked");assert.equal(f.state().roles.roles.radio.status,"active");
 assert.equal(f.state().roles.roles.radio.leases.some(l=>l.status==="completed"),false);
 const vacant=fixture(true);vacant.state().roles.roles.radio.status="vacant";
 await createInternalWorkRunner({council:vacant.council,owner,now:vacant.now,read:async()=>source()}).tick();assert.equal(vacant.state().internalWork?.jobs.some(j=>j.role==="radio"),false);assert.equal(vacant.state().roles.roles.radio.status,"vacant");
});

test("operator-only Radio recovery retains interruption, rotates fence once, and proves only the fresh read",async()=>{
 const f=fixture(true,true),read=async()=>({...source(),observedAt:new Date(f.now()).toISOString(),radioTotal:1,radio:[{id:"radio1",title:"Radio",scheduledAt:"2026-11-08T19:00:00",description:"7-8PM DJ Alpha"}]});
 await createInternalWorkRunner({council:f.council,owner,now:f.now,read}).tick();
 const job=f.state().internalWork!.jobs.find(j=>j.role==="radio")!,lease=f.state().roles.roles.radio.leases.find(l=>l.executionId===job.id)!;
 job.status="running";delete job.artifact;delete job.artifactId;delete job.completedAt;
 lease.status="running";delete lease.artifactId;delete lease.completedAt;
 const receipt=f.state().internalWork!.radioTrainingHistory![0];delete receipt.firstVerifiedRunId;delete receipt.firstVerifiedAt;delete receipt.firstExecutionArtifactId;
 const original=structuredClone(job),originalLease=structuredClone(lease);let reads=0;
 const options={council:f.council,owner,jobId:job.id,expectedFence:job.fence,operatorAuditId:"operator-paused-drained-1",now:f.now,read:async()=>{reads++;return read();}};
 await assert.rejects(()=>recoverRadioReadOnly(options),/not eligible/);assert.equal(reads,0);
 f.setClock(NOW+300001);
 await assert.rejects(()=>recoverRadioReadOnly({...options,expectedFence:"stale"}),/not eligible/);
 lease.startedAt=new Date(NOW-1).toISOString();await assert.rejects(()=>recoverRadioReadOnly(options),/not eligible/);lease.startedAt=originalLease.startedAt;
 lease.artifactId="unexpected";await assert.rejects(()=>recoverRadioReadOnly(options),/not eligible/);delete lease.artifactId;
 assert.equal(reads,0);
 const results=await Promise.allSettled([recoverRadioReadOnly(options),recoverRadioReadOnly(options)]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(reads,1);
 const work=parseInternalWork(jsonbRoundtrip(f.state().internalWork)),done=work.jobs.find(j=>j.id===job.id)!;
 assert.equal(done.status,"completed");assert.notEqual(done.fence,original.fence);assert.equal(done.interruptedAttempts?.length,1);
 assert.equal(done.interruptedAttempts![0].status,"unknown");assert.deepEqual(done.interruptedAttempts![0].priorLease,originalLease);assert.equal(done.interruptedAttempts![0].startedAt,original.startedAt);
 assert.equal(work.radioTrainingHistory![0].firstVerifiedRunId,job.id);assert.equal(work.radioTrainingHistory![0].firstExecutionArtifactId,done.artifactId);
 const late=completeRoleExecution(f.state().roles,{roleId:"radio",executionId:job.id,fence:original.fence,policyVersion:job.policyVersion,now:f.now(),artifactId:"late",success:true});assert.equal(late.accepted,false);
 await assert.rejects(()=>recoverRadioReadOnly({...options,expectedFence:done.fence}),/not eligible/);
});
test("canonical planning includes exact saved records, no sending or live-calendar claims",()=>{
  const ceo=prepareInternalArtifact("ceo",source()),assistant=prepareInternalArtifact("assistant",source());
  assert.deepEqual(ceo.includedIds,["task1","approval1"]);assert.deepEqual(assistant.includedIds,["task1"]);
  assert.match(assistant.text,/2026-11-06T23:30:00/);assert.match(ceo.text,/No se ha enviado/);
  assert.equal(ceo.evaluation.mode,"deterministic-contract");
  const empty=prepareInternalArtifact("assistant",{...source(),tasks:[],taskTotal:0});assert.match(empty.text,/No hay registros/);
  assert.throws(()=>prepareInternalArtifact("assistant",{...source(),tasks:[]}));
  assert.throws(()=>prepareInternalArtifact("ceo",{...source(),tasks:Array(201).fill(source().tasks[0])}));
  const tasks=Array.from({length:200},(_,i)=>({...source().tasks[0],id:`t${i}`,title:"t".repeat(500)}));
  const approvals=tasks.map((row,i)=>({...row,id:`a${i}`}));
  const bounded=prepareInternalArtifact("ceo",{...source(),tasks,approvals,taskTotal:401,approvalTotal:201});assert.match(bounded.text,/200\/401 tareas/);assert.equal(bounded.includedIds.length,400);
});
test("internal artifact route refuses other users before loading private state",async()=>{
  const handlers=new Map<string,any>();let reads=0;
  const app={get:(path:string,handler:any)=>handlers.set(path,handler),post:()=>{}};
  registerAgentCouncilRoutes(app as any,{council:{async load(){reads++;return {officeExecution:{roles:{roles:{reviewer:{activePolicy:{candidateId:"incumbent1"}}}},internalWork:{version:1,jobs:[]}},company:{academyJobs:[{id:"assessment1",traineeId:"incumbent1",status:"completed",startedAt:new Date(NOW).toISOString(),benchmarkId:"fixture1"}],trainees:[{id:"incumbent1",forAgentId:"reviewer",purpose:"incumbent",assessments:[{runId:"assessment1",quality:90,incumbentQuality:80,passed:true,scope:"benchmark",artifacts:{candidateText:"PRIVATE_PROMPT_MUST_NOT_LEAK"}}]}]}};}} as any,requestUserId:(req:any)=>req.user,ownerUserId:()=>owner});
  const response=()=>({code:200,body:undefined as any,headers:{} as any,set(key:string,value:string){this.headers[key]=value;return this;},status(code:number){this.code=code;return this;},json(value:any){this.body=value;return this;}});
  const denied=response();await handlers.get("/api/agent-council/internal-work")({user:"other-owner"},denied);assert.equal(denied.code,403);assert.equal(reads,0);
  const allowed=response();await handlers.get("/api/agent-council/internal-work")({user:owner},allowed);assert.equal(reads,1);assert.equal(allowed.headers["Cache-Control"],"no-store");assert.deepEqual(allowed.body.jobs,[]);assert.equal(allowed.body.academy[0].purpose,"incumbent");assert.equal(allowed.body.academy[0].policyCurrentlyApplied,true);assert.equal(allowed.body.academy[0].assessment.quality,90);assert.doesNotMatch(JSON.stringify(allowed.body),/PRIVATE_PROMPT/);
});
test("concurrent runners and restart complete one daily slot per role with immutable evidence",async()=>{
  const f=fixture();let reads=0;
  const make=()=>createInternalWorkRunner({council:f.council,owner,now:f.now,read:async()=>{reads++;return source();}});
  await Promise.all([make().tick(),make().tick()]);await make().tick();
  assert.equal(reads,2);const jobs=parseInternalWork(f.state().internalWork).jobs;assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.status === "completed"));
  const corrupt=structuredClone(f.state().internalWork)!;corrupt.jobs[0].artifact!.text="invented";assert.throws(()=>parseInternalWork(corrupt));
});
test("failed or foreign source is blocked without life penalty or output",async()=>{
  const f=fixture();await createInternalWorkRunner({council:f.council,owner,now:f.now,read:async()=>({...source(),ownerKey:"a".repeat(64)})}).tick();
  assert.ok(f.state().internalWork!.jobs.every(j=>j.status === "blocked" && !j.artifact));
  assert.ok(Object.values(f.state().roles.roles).every(r=>r.generation === 1));
});
test("lease expiry preserves uncertain fence across days and prevents same-role retry",async()=>{
  const f=fixture();let reads=0;
  await createInternalWorkRunner({council:f.council,owner,now:f.now,read:async()=>{reads++;f.setClock(f.now()+61000);return {...source(),observedAt:new Date(f.now()).toISOString()};}}).tick();
  assert.ok(f.state().internalWork!.jobs.every(j=>j.status === "unknown"));
  f.setClock(NOW+86400000);await createInternalWorkRunner({council:f.council,owner,now:f.now,read:async()=>{reads++;return source();}}).tick();assert.equal(reads,2);
});
test("source SQL binds owner on every private query and rolls back oversized results",async()=>{
  const queries:Array<{sql:string,args?:unknown[]}> = [];let released=false;
  const pool={async connect(){return {async query(sql:string,args?:unknown[]){queries.push({sql,args});if(sql.includes("FROM users")) return {rows:[{id:owner}]};if(sql.includes("FROM tasks"))return {rows:source().tasks.map(row=>({...row,total:1}))};if(sql.includes("FROM pending_actions"))return {rows:source().approvals.map(row=>({...row,total:1}))};if(sql.includes("clock_timestamp"))return {rows:[{observed:new Date(NOW)}]};return {rows:[]};},release(){released=true;}};}};
  assert.deepEqual(await readInternalWorkSnapshot(pool,owner),source());assert.ok(released);
  for(const q of queries.filter(q=>/FROM (users|tasks|pending_actions)/.test(q.sql))) assert.deepEqual(q.args,[owner]);
  assert.match(queries[0].sql,/READ ONLY/);assert.ok(!queries.some(q=>/INSERT|UPDATE|DELETE/.test(q.sql)));
  const oversized={async connect(){const client=await pool.connect();return {...client,async query(sql:string,args?:unknown[]){if(sql.includes("FROM tasks"))return {rows:Array(201).fill(source().tasks[0])};return client.query(sql,args);}};}};
  await assert.rejects(()=>readInternalWorkSnapshot(oversized,owner));assert.equal(queries.at(-1)!.sql,"ROLLBACK");
});
test("Radio SQL stays owner-scoped and preserves exact saved description/date without external sync",async()=>{
 const queries:Array<{sql:string,args?:unknown[]}>=[];
 const raw={id:"radio-id",title:"Radio",scheduledAt:"2026-11-01T01:30:00",description:"7-8PM Alpha",total:"1"};
 const pool={async connect(){return {async query(sql:string,args?:unknown[]){queries.push({sql,args});if(sql.includes("FROM users"))return {rows:[{id:owner}]};if(sql.includes("external_source='google'"))return {rows:[raw]};if(sql.includes("clock_timestamp"))return {rows:[{observed:new Date(NOW)}]};return {rows:[]};},release(){}};}};
 const snapshot=await readInternalWorkSnapshot(pool,owner,true);assert.deepEqual(snapshot.radio,[{id:raw.id,title:raw.title,scheduledAt:raw.scheduledAt,description:raw.description}]);assert.equal(snapshot.radioTotal,1);
 const radioQuery=queries.find(q=>q.sql.includes("external_source='google'"))!;assert.deepEqual(radioQuery.args,[owner]);assert.match(radioQuery.sql,/user_id=\$1/);assert.doesNotMatch(radioQuery.sql,/UPDATE|INSERT|DELETE/);
});
