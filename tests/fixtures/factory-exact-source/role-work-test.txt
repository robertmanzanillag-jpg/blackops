import test from "node:test";
import assert from "node:assert/strict";
import {createRoleWorkRunner,parseRoleWork} from "../server/office-role-work";
import {PENDING_OFFICE_ROLES,sourceDigest,type RoleSnapshot,type SqlAuditRole} from "../server/office-role-snapshots";
import type {WebRoleSource} from "../server/office-web-role-sources";
const NOW=Date.parse("2026-11-07T01:00:00Z"),owner="owner";
const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
function fixture(){let clock=NOW,state:any={roles:{version:1,roles:Object.fromEntries(PENDING_OFFICE_ROLES.map(role=>[role,{generation:1}]))}};const company:any={careers:Object.fromEntries(PENDING_OFFICE_ROLES.map(role=>[role,{generation:1}]))};
 const council:any={async updateOfficeExecution(change:any){state=reorder(change(structuredClone(state),company));return structuredClone(state);}};
 return {now:()=>clock,setNow:(v:number)=>clock=v,state:()=>state,company,council};}
function snapshot(role:SqlAuditRole,now:number):RoleSnapshot{const rows:any={control:[{id:"c",scope:"publish",level:"read_only",risk:"high",enabled:true}],automations:[{id:"a",status:"active",failureCount:0,nextRunAt:null,lastRunAt:null,lastStatus:null,requiresApproval:true,level:"execute_after_approval"}],portfolio:[{id:"p",symbol:"A",currency:"USD",quantity:"2",avgBuyPrice:"5"}],revenue:[{id:"r",kind:"retainer",amountUsd:20,cashCollectedUsd:10,estimatedInternalCostUsd:0,updatedAt:new Date(now).toISOString()}],legal:[{id:"l",name:"App",publicUrl:null,repoOwner:null,repoName:null,environment:"production"}]};const body={version:1 as const,role,ownerKey:sourceDigest(owner),observedAt:new Date(now).toISOString(),total:1,rows:rows[role]};return {...body,sourceDigest:sourceDigest(body)};}
test("durable competing runners reserve once per role/day, preserve JSONB proof and restart history",async()=>{
 const f=fixture();let reads=0;const make=()=>createRoleWorkRunner({owner,council:f.council,now:f.now,read:async role=>{reads++;return snapshot(role,f.now());}});
 await Promise.all([make().tick(),make().tick()]);let journal=parseRoleWork(f.state().roleWork,owner);assert.equal(journal.jobs.length,14);assert.equal(reads,5);assert.equal(journal.jobs.filter(j=>j.status==="completed").length,5);assert.equal(journal.jobs.filter(j=>j.status==="blocked").length,9);
 await make().tick();assert.equal(reads,5);f.setNow(NOW+86400000);assert.equal(parseRoleWork(f.state().roleWork,owner).jobs.length,14);await make().tick();journal=parseRoleWork(f.state().roleWork,owner);assert.equal(journal.jobs.length,28);assert.equal(reads,10);
 assert.throws(()=>parseRoleWork(f.state().roleWork,"other"));const corrupted=structuredClone(journal);corrupted.jobs.find(j=>j.role==="portfolio")!.source!.rows[0].quantity="999";assert.throws(()=>parseRoleWork(corrupted,owner));
});
test("expired audit is uncertain, protected across day boundaries and never retried automatically",async()=>{
 const f=fixture();let reads=0;const runner=createRoleWorkRunner({owner,council:f.council,now:f.now,read:async role=>{reads++;if(role==="legal")f.setNow(f.now()+60000);return snapshot(role,f.now());}});
 await runner.tick();let job=parseRoleWork(f.state().roleWork,owner).jobs.find(j=>j.role==="legal")!;assert.equal(job.status,"unknown");assert.equal(job.audit,undefined);assert.equal(job.source,undefined);
 const before=reads;f.setNow(f.now()+86400000);await runner.tick();assert.equal(reads-before,4);job=parseRoleWork(f.state().roleWork,owner).jobs.find(j=>j.role==="legal")!;assert.equal(job.status,"unknown");
});
test("source errors are redacted blocks, can be checked tomorrow, and never mutate careers",async()=>{
 const f=fixture(),careers=structuredClone(f.company.careers);const runner=createRoleWorkRunner({owner,council:f.council,now:f.now,read:async()=>{throw new Error("secret-password");}});await runner.tick();
 assert.ok(!JSON.stringify(f.state()).includes("secret-password"));assert.equal(parseRoleWork(f.state().roleWork,owner).jobs.every(j=>j.status==="blocked"),true);assert.deepEqual(f.company.careers,careers);
 f.setNow(NOW+86400000);await runner.tick();assert.equal(parseRoleWork(f.state().roleWork,owner).jobs.length,28);
});
test("changed generation cannot receive previous holder's audit result; stop prevents new admissions",async()=>{
 const f=fixture();await createRoleWorkRunner({owner,council:f.council,now:f.now,read:async role=>{if(role==="legal")f.company.careers.legal.generation=2;return snapshot(role,f.now());}}).tick();assert.equal(parseRoleWork(f.state().roleWork,owner).jobs.find(j=>j.role==="legal")!.status,"unknown");
 const empty=fixture();await createRoleWorkRunner({owner,council:empty.council,now:empty.now,shouldStop:()=>true,read:async()=>{throw Error("must not read");}}).tick();assert.equal(empty.state().roleWork,undefined);
});
function webNews(role:"news"|"news:ny-news"|"news:miami-news",observed:number):WebRoleSource {
 const old=new Date(observed-172800000).toISOString(),lane=role==="news:ny-news"?"ny-news" as const:"miami-news" as const;
 const body={version:1 as const,ownerKey:sourceDigest(owner),role,observedAt:new Date(observed).toISOString(),rows:[{id:sourceDigest("item"),kind:"news_queue" as const,state:"quarantined" as const,sourceAt:old,lane,metrics:{qualityScore:50,approvalRequired:1,autoEligible:0}}],total:1,truncated:false,provenance:[{kind:"news_state" as const,status:"present" as const,sourceAt:old,digest:sourceDigest("original"),records:1,files:1,empty:false}],diagnostics:["SOURCE_STALE" as const,"RECORDED_BLOCKS" as const]};return {...body,sourceDigest:sourceDigest(body)};
}
test("web exports persist full old provenance separately, retain legacy v1 jobs and survive JSONB/restart",async()=>{
 const f=fixture(),read=async(role:SqlAuditRole)=>snapshot(role,f.now());await createRoleWorkRunner({council:f.council,owner,now:f.now,read}).tick();
 const legacy=structuredClone(f.state().roleWork),oldHash=legacy.jobs.find((j:any)=>j.role==="news").artifactId;
 f.setNow(NOW+86400000);let reads=0;const runner=createRoleWorkRunner({council:f.council,owner,now:f.now,read,readWeb:async role=>{reads++;return role.startsWith("news")?webNews(role as "news",f.now()-60000):null;}});
 await Promise.all([runner.tick(),runner.tick()]);const journal=parseRoleWork(reorder(f.state().roleWork),owner),news=journal.jobs.filter(j=>j.role==="news");assert.equal(reads,7);assert.equal(news[0].artifactId,oldHash);assert.equal(news[0].audit?.status,"blocked");assert.equal(news[1].status,"completed");assert.equal(news[1].audit,undefined);assert.equal(news[1].source,undefined);assert.ok(news[1].webAudit?.diagnostics.includes("SOURCE_STALE"));assert.equal(news[1].webSource!.provenance[0].sourceAt,new Date(f.now()-60000-172800000).toISOString());
 const absent=journal.jobs.filter(j=>j.role==="clippers").at(-1)!;assert.equal(absent.status,"blocked");assert.deepEqual(absent.webAudit?.diagnostics,["EXPORT_MISSING"]);
 const mixed=structuredClone(journal);mixed.jobs.find(j=>j.id===news[1].id)!.source=snapshot("portfolio",f.now());assert.throws(()=>parseRoleWork(mixed,owner),/compartments/);
 const tampered=structuredClone(journal);tampered.jobs.find(j=>j.id===news[1].id)!.webSource!.rows[0].metrics.qualityScore=100;assert.throws(()=>parseRoleWork(tampered,owner));
 f.setNow(f.now()+86400000);assert.doesNotThrow(()=>parseRoleWork(f.state().roleWork,owner));
});
test("stale, foreign or wrong-role exports block without raw errors and late results remain unknown",async()=>{
 for(const mode of ["stale","foreign","wrong","late"]){const f=fixture();await createRoleWorkRunner({council:f.council,owner,now:f.now,read:async role=>snapshot(role,f.now()),readWeb:async role=>{
  if(role!=="news")return null;const source=webNews("news",mode==="stale"?f.now()-300001:f.now());if(mode==="foreign")source.ownerKey=sourceDigest("other");if(mode==="wrong")source.role="news:ny-news";if(mode==="late")f.setNow(f.now()+60000);return source;
 }}).tick();const job=parseRoleWork(f.state().roleWork,owner).jobs.find(j=>j.role==="news")!;assert.equal(job.status,mode==="late"?"unknown":"blocked");if(mode!=="late")assert.deepEqual(job.webAudit?.diagnostics,["EXPORT_INVALID_OR_STALE"]);else assert.equal(job.webSource,undefined);}
});
