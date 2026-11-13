import test from "node:test";
import assert from "node:assert/strict";
import {canonicalEvidenceDigest as digest} from "../server/evidence-json";
import {BUSINESS_SOURCE_SQL,readBusinessSources,type BusinessPool,type BusinessRole,type BusinessSource} from "../server/office-business-sources";
import {buildBusinessArtifact} from "../server/office-business-artifacts";
import {BUSINESS_WORK_KIND,eligibleBusinessGeneration,businessWorkCapacity,createBusinessWorkRunner,parseBusinessWork,readBusinessWork} from "../server/office-business-work";
import {randomUUID} from "node:crypto";
const NOW=Date.parse("2026-11-07T04:00:00Z"),owner="owner",iso=(at:number)=>new Date(at).toISOString();
function source(role:BusinessRole,at=NOW,override:any={}):BusinessSource{
 const body=role==="automations"?{version:1,ownerKey:digest(owner),role,observedAt:iso(at),definitionTotal:1,definitions:[{id:"automation",name:"Daily reminder",status:"active",timezone:"America/New_York",scheduleKind:"daily_time",nextRunAt:iso(at-10000),lastRunAt:iso(at-10000),lastStatus:"success",failureCount:1,requiresApproval:false,permissionLevel:"autonomous"}],latestRuns:[{id:"run",automationId:"automation",status:"failed",startedAt:iso(at-10000),finishedAt:iso(at-5000),triggeredBy:"scheduler",failureCode:"TIMEOUT"}],...override}:{version:1,ownerKey:digest(owner),role,observedAt:iso(at),holdingTotal:1,transactionTotal:2,holdings:[{id:"holding",symbol:"TEST",quantity:"0.3",avgBuyPrice:"10",currency:"USD"}],transactions:[{id:"trade1",investmentId:"holding",symbol:"TEST",type:"buy",quantity:"0.1",price:"0.2",totalValue:"0.02",currency:"USD",date:iso(at-10000)},{id:"trade2",investmentId:"holding",symbol:"TEST",type:"buy",quantity:"0.2",price:"0.2",totalValue:"0.04",currency:"USD",date:iso(at-5000)}],...override};return {...body,sourceDigest:digest(body)} as BusinessSource;
}
function database(){
 const records=new Map<string,any>(),queries:Array<{sql:string;params:any[]}>=[];let tail:Promise<void>=Promise.resolve();
 const read=async(sql:string,params:any[]=[]):Promise<{rows:any[]}>=>{queries.push({sql,params});if(sql.includes("FROM users"))return {rows:params[0]===owner?[{id:owner}]:[]};if(sql.startsWith("SELECT data FROM revenue_engine_state"))return {rows:records.has(params[0])?[{data:structuredClone(records.get(params[0]))}]:[]};throw Error("unexpected query");};
 const pool:BusinessPool={query:read,async connect(){let unlock:(()=>void)|undefined,pending:any;return {release(){unlock?.();},async query(sql,params=[]){
  if(sql.includes("pg_advisory_xact_lock")){const old=tail;tail=new Promise<void>(r=>{unlock=r;});await old;queries.push({sql,params});return {rows:[]};}
  if(sql.startsWith("INSERT INTO")){assert.equal(params[1],BUSINESS_WORK_KIND);pending={owner:params[0],state:JSON.parse(params[2])};return {rows:[]};}
  if(sql==="COMMIT"){if(pending)records.set(pending.owner,pending.state);return {rows:[]};}if(sql==="ROLLBACK"){pending=undefined;return {rows:[]};}if(sql.startsWith("BEGIN")||sql.startsWith("SET LOCAL"))return {rows:[]};return read(sql,params);
 }};}};return {pool,records,queries};
}

test("portfolio artifact performs exact decimal reconciliation and separates unexplained fees from corrections",()=>{
 const baseline=buildBusinessArtifact(source("portfolio"),owner,NOW);assert.equal(baseline.status,"completed");assert.equal(baseline.calculations["position:holding:ledgerQuantity"],"0.3");assert.equal(baseline.calculations["position:holding:difference"],"0");assert.equal(baseline.calculations["recordedCostBasis:USD"],"3");assert.equal(baseline.findings.length,0);assert.ok(baseline.text.includes("ni recomienda operaciones"));
 const changed=source("portfolio");if(changed.role!=="portfolio")throw Error();changed.transactions[0].totalValue="0.021";changed.holdings[0].quantity="0.4";const {sourceDigest,...body}=changed;const report=buildBusinessArtifact({...body,sourceDigest:digest(body)},owner,NOW);
 assert.equal(report.calculations["position:holding:difference"],"0.1");assert.ok(report.findings.some(f=>f.code==="RECORDED_AMOUNT_DIFFERENCE"&&f.detail.includes("0.001")&&f.nextAction.includes("comisiones")));assert.ok(report.findings.some(f=>f.code==="POSITION_LEDGER_DIFFERENCE"&&f.closureCheck.includes("evidencia")));
});
test("empty/incomplete portfolio never claims reconciliation; unresolved links do not mix currencies or owners",()=>{
 const empty=buildBusinessArtifact(source("portfolio",NOW,{holdings:[],holdingTotal:0,transactions:[],transactionTotal:0}),owner,NOW);assert.equal(empty.status,"blocked");
 const data=source("portfolio");if(data.role!=="portfolio")throw Error();data.transactions[0].investmentId="foreign-position";data.transactions[1].currency="EUR";const {sourceDigest,...body}=data;const artifact=buildBusinessArtifact({...body,sourceDigest:digest(body)},owner,NOW);assert.equal(artifact.findings.filter(f=>f.code==="POSITION_LINK_UNRESOLVED").length,2);assert.equal(artifact.calculations["position:holding:ledgerQuantity"],undefined);
 const holdings=Array.from({length:200},(_,i)=>({...data.holdings[0],id:`h${i}`}));assert.equal(buildBusinessArtifact(source("portfolio",NOW,{holdings,holdingTotal:201}),owner,NOW).status,"blocked");
 assert.throws(()=>buildBusinessArtifact(data,"other",NOW));assert.throws(()=>buildBusinessArtifact(source("portfolio",NOW,{holdings:[{...data.holdings[0],quantity:"NaN"}]}),owner,NOW));
});
test("automation repair document cites real run, safe action and closure check; approval is legitimate wait",()=>{
 const report=buildBusinessArtifact(source("automations"),owner,NOW);assert.equal(report.status,"completed");const failure=report.findings.find(f=>f.code==="FAILED_EXECUTION")!;assert.deepEqual(failure.recordIds,["automation","run"]);assert.ok(failure.nextAction.includes("efectos externos"));assert.ok(failure.closureCheck.includes("ejecucion real"));assert.ok(report.findings.some(f=>f.code==="SUMMARY_RECEIPT_MISMATCH"));assert.ok(report.findings.some(f=>f.code==="NEXT_SCHEDULE_UNVERIFIED"));
 const original=source("automations");if(original.role!=="automations")throw Error();const waiting=buildBusinessArtifact(source("automations",NOW,{latestRuns:[{...original.latestRuns[0],status:"pending_approval",finishedAt:null}]}),owner,NOW);assert.ok(waiting.findings.some(f=>f.code==="WAITING_APPROVAL"));assert.equal(waiting.findings.some(f=>f.code==="FAILED_EXECUTION"),false);
 const missing=buildBusinessArtifact(source("automations",NOW,{definitions:[],definitionTotal:0,latestRuns:[]}),owner,NOW);assert.equal(missing.status,"blocked");
});
test("two concurrent durable runners reserve once, persist readable artifacts and survive JSONB/restart",async()=>{
 const f=database();let calls=0;const make=()=>createBusinessWorkRunner({pool:f.pool,owner,now:()=>NOW,getGeneration:async()=>1,readSource:async role=>{calls++;return source(role);}});
 assert.deepEqual((await readBusinessWork(f.pool,owner)).jobs,[]);assert.equal(f.records.size,0);
 await Promise.all([make().tick(),make().tick()]);const journal=await make().read();assert.equal(journal.jobs.length,2);assert.equal(calls,2);assert.ok(journal.jobs.every(j=>j.artifact?.text&&j.status==="completed"&&j.artifact.validation.externalActions===0));
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;f.records.set(owner,reorder(f.records.get(owner)));await make().tick();assert.equal(calls,2);assert.equal((await make().read()).jobs.length,2);
 const corrupt=structuredClone(journal);corrupt.jobs[0].artifact!.text="invented completion";assert.throws(()=>parseBusinessWork(corrupt,owner));assert.throws(()=>parseBusinessWork(journal,"other"));assert.ok(f.queries.every(q=>!q.sql.includes("CREATE TABLE")));
});
test("late or replaced holder result is unknown, preserved and never automatically retried",async()=>{
 for(const mode of ["late","holder"]){const f=database();let clock=NOW,generation=1,calls=0;const runner=createBusinessWorkRunner({pool:f.pool,owner,now:()=>clock,getGeneration:async role=>role==="automations"?generation:null,readSource:async role=>{calls++;const s=source(role);if(mode==="late")clock+=60000;else generation=2;return s;}});
  await runner.tick();assert.equal((await runner.read()).jobs[0].status,"unknown");assert.equal((await runner.read()).jobs[0].artifact,undefined);clock+=86400000;await runner.tick();assert.equal(calls,1);assert.equal((await runner.read()).jobs.length,1);
 }
});
test("slow admission never starts source reads and slow completion generation lookup respects lease",async()=>{
 for(const slowAt of [1,3]){const f=database();let clock=NOW,lookups=0,calls=0;const runner=createBusinessWorkRunner({pool:f.pool,owner,now:()=>clock,getGeneration:async role=>{if(role!=="automations")return null;lookups++;if(lookups===slowAt)clock+=60000;return 1;},readSource:async role=>{calls++;return source(role,clock);}});await runner.tick();assert.equal(calls,slowAt===1?0:1);assert.equal((await runner.read()).jobs[0].status,"unknown");}
});
test("unknown automation does not starve portfolio and pause drains already admitted read",async()=>{
 const f=database();let clock=NOW,stopped=false;const runner=createBusinessWorkRunner({pool:f.pool,owner,now:()=>clock,getGeneration:async()=>1,readSource:async role=>{const result=source(role,clock);if(role==="automations")clock+=60000;return result;}});await runner.tick();const jobs=(await runner.read()).jobs;assert.equal(jobs[0].status,"unknown");assert.equal(jobs[1].status,"completed");
 const second=database(),draining=createBusinessWorkRunner({pool:second.pool,owner,now:()=>NOW,shouldStop:()=>stopped,getGeneration:async()=>1,readSource:async role=>{stopped=true;return source(role);}});await draining.tick();assert.equal((await draining.read()).jobs.length,1);assert.equal((await draining.read()).jobs[0].status,"completed");
});
test("source failure is redacted blocked work; tomorrow may inspect anew without mutating existing receipts",async()=>{
 const f=database();let clock=NOW;const runner=createBusinessWorkRunner({pool:f.pool,owner,now:()=>clock,getGeneration:async()=>1,readSource:async()=>{throw Error("secret connection string");}});
 await runner.tick();const first=await runner.read();assert.equal(first.jobs.length,2);assert.ok(first.jobs.every(j=>j.status==="blocked"&&!j.artifact));assert.ok(!JSON.stringify(first).includes("secret"));clock+=86400000;await runner.tick();const second=await runner.read();assert.equal(second.jobs.length,4);assert.deepEqual(second.jobs.slice(0,2),first.jobs);
});
test("journal capacity stops admission without deleting historical jobs",async()=>{
 const f=database(),state=parseBusinessWork(undefined,owner);for(let i=0;i<200;i++){const start=NOW-i*86400000,body={id:randomUUID(),fence:randomUUID(),role:"automations" as const,generation:1,slot:iso(start).slice(0,10),startedAt:iso(start),expiresAt:iso(start+60000),completedAt:iso(start),status:"blocked" as const,reason:"SOURCE_UNAVAILABLE" as const};state.jobs.push({...body,proof:digest(body)});}
 f.records.set(owner,parseBusinessWork(state,owner));const capacity=businessWorkCapacity(state);assert.equal(capacity.reached,true);assert.equal(capacity.usedJobs,200);assert.equal(capacity.usedBytes,Buffer.byteLength(JSON.stringify(state)));let reads=0;
 await createBusinessWorkRunner({pool:f.pool,owner,now:()=>NOW+86400000,getGeneration:async()=>1,readSource:async role=>{reads++;return source(role);}}).tick();assert.equal(reads,0);assert.deepEqual(await readBusinessWork(f.pool,owner),state);
});
test("hung readonly source reaches deadline; its later result cannot overwrite unknown",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});const f=database();let release!:(source:BusinessSource)=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const runner=createBusinessWorkRunner({pool:f.pool,owner,now:()=>NOW,getGeneration:async role=>role==="automations"?1:null,readSource:async()=>{entered();return new Promise(resolve=>{release=resolve;});}});
 const pending=runner.tick();await started;t.mock.timers.tick(60000);await pending;assert.equal((await runner.read()).jobs[0].status,"unknown");release(source("automations"));await Promise.resolve();assert.equal((await runner.read()).jobs[0].artifact,undefined);
});
test("SQL capture selects owner-bound records in a read-only transaction and excludes raw errors/notes",async()=>{
 const calls:Array<{sql:string;params:any[]}>=[];const input=source("portfolio");if(input.role!=="portfolio")throw Error();
 const pool:BusinessPool={query:async()=>({rows:[]}),connect:async()=>({release(){},query:async(sql,params=[])=>{calls.push({sql,params});if(sql.includes("FROM users"))return {rows:[{id:owner}]};if(sql===BUSINESS_SOURCE_SQL.holdings)return {rows:input.holdings.map(r=>({...r,total:"1"}))};if(sql===BUSINESS_SOURCE_SQL.transactions)return {rows:input.transactions.map(r=>({...r,date:new Date(r.date),total:"2"}))};return {rows:[]};}})};
 const read=await readBusinessSources(pool,owner,"portfolio",NOW);assert.deepEqual(read,input);assert.ok(calls.some(c=>c.sql.includes("REPEATABLE READ READ ONLY")));assert.ok(calls.filter(c=>c.sql.includes("FROM users")||c.sql.includes("FROM investments")||c.sql.includes("FROM transactions")).every(c=>c.params[0]===owner));assert.ok(!BUSINESS_SOURCE_SQL.runs.includes("error_message"));assert.ok(!BUSINESS_SOURCE_SQL.transactions.includes("notes"));
});

test("UTC database wall timestamps are projected with explicit timezone for Windows workers",async()=>{
 const {types}=await import("pg"); const old=process.env.TZ;
 try{for(const zone of ["UTC","America/New_York"]){process.env.TZ=zone;assert.equal(types.getTypeParser(1184)("2026-11-07 04:00:00+00").toISOString(),"2026-11-07T04:00:00.000Z");}}
 finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
 for(const [key,columns] of [["definitions",["next_run_at","last_run_at"]],["runs",["r.started_at","r.finished_at"]],["transactions",["date"]]] as const){for(const column of columns)assert.ok(BUSINESS_SOURCE_SQL[key].includes(`${column} AT TIME ZONE 'UTC' AS`));}
});

test("unapproved or retired careers cannot start or complete business work",async()=>{
 for(const career of [undefined,{generation:1,battery:0},{generation:1,battery:100,inTrainingUntilGeneration:1}])assert.equal(eligibleBusinessGeneration(career),undefined);
 assert.equal(eligibleBusinessGeneration({generation:2,battery:80}),2);
 assert.equal(eligibleBusinessGeneration({generation:2,battery:80,scoreReconciliation:{version:1,status:"needs_scope_qualification",recordId:"a".repeat(64),originalCareerDigest:"b".repeat(64)}}),undefined);
 for(const phase of ["before","during"]){const f=database();let eligible=phase!=="before",reads=0;
 const runner=createBusinessWorkRunner({pool:f.pool,owner,now:()=>NOW,getGeneration:async role=>role==="automations"&&eligible?1:undefined,readSource:async role=>{reads++;eligible=false;return source(role);}});
 await runner.tick();const state=await runner.read();assert.equal(reads,phase==="before"?0:1);
 if(phase==="before")assert.equal(state.jobs.length,0);else{assert.equal(state.jobs[0].reason,"HOLDER_CHANGED");assert.equal(state.jobs[0].status,"unknown");assert.equal(state.jobs[0].artifact,undefined);}
 }
});
