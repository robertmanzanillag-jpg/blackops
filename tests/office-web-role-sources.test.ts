import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readdir,readFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {readWebRoleSources,auditWebRoleSource,validateWebRoleSource,BLACKROOM_SOURCE_PROJECTION_SQL} from "../server/office-web-role-sources";
const now=Date.parse("2026-11-07T01:00:00Z"),at=new Date(now).toISOString(),old=new Date(now-172800000).toISOString();
const pool={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[]})};
async function fixture(t:any){const root=await mkdtemp(path.join(tmpdir(),"office-web-source-test-"));t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});return root;}
async function put(root:string,file:string,value:unknown){const name=path.join(root,file);await mkdir(path.dirname(name),{recursive:true});await writeFile(name,typeof value==="string"?value:JSON.stringify(value));}
const news=(count=1)=>({version:1,updatedAt:old,lastRunAt:old,queue:Array.from({length:count},(_,i)=>({id:`private:https://internal/customer-${i}`,lane:i%2?"ny-news":"miami-news",status:"quarantined",createdAt:old,approvalRequired:true,autoEligible:false,qualityScore:50,copy:"SECRET_CUSTOMER",sourceUrl:"https://private/token=secret"}))});

test("durable marketing history overrides ephemeral files, retains original time, and never falls back after DB failure",async t=>{
 const root=await fixture(t);await put(root,"marketing_command_center_data/learning-runs.json","corrupt local data");
 const saved=[{id:"durable",createdAt:old,focusClientId:"all",clientsReviewed:4,improvementsQueued:["private plan"],rulesUpdated:["private rule"],safetyBlocks:[]}];
 const read=async(marketingLearning:()=>Promise<unknown|null>)=>(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now,marketingLearning})).find(s=>s.role==="marketing-cmo")!;
 const valid=await read(async()=>saved);assert.equal(valid.rows[0].kind,"marketing_plan");assert.equal(valid.rows[0].sourceAt,old);assert.equal(valid.provenance[0].files,0);assert.equal(valid.provenance[0].records,1);assert.ok(!JSON.stringify(valid).includes("private plan"));
 assert.equal((await read(async()=>null)).provenance[0].status,"missing");assert.equal((await read(async()=>[])).provenance[0].empty,true);
 assert.equal((await read(async()=>{throw Error("private DB detail");})).provenance[0].status,"invalid");assert.equal((await read(async()=>({bad:true}))).provenance[0].status,"invalid");assert.equal((await read(async()=>[{...saved[0],createdAt:new Date(now+60000).toISOString()}])).provenance[0].status,"invalid");
 assert.equal(await readFile(path.join(root,"marketing_command_center_data/learning-runs.json"),"utf8"),"corrupt local data");
});
test("missing files remain missing, no bootstrap or filesystem writes, foreign owner rejected",async t=>{
 const root=await fixture(t);const sources=await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now});assert.equal(sources.length,7);assert.deepEqual(await readdir(root),[]);assert.ok(sources.every(s=>s.diagnostics.includes("SOURCE_MISSING")));assert.ok(sources.every(s=>auditWebRoleSource(s,"owner",now).status==="blocked"));
 let calls=0;await assert.rejects(()=>readWebRoleSources({pool:{query:async()=>{calls++;return {rows:[]};}},owner:"other",configuredOwner:"owner",root,now}));assert.equal(calls,0);
});
test("real news lanes remain stale, bounded and sanitized; genuine JSONB key order works",async t=>{
 const root=await fixture(t);await put(root,"clippers_workspace/local-news/state.json",news(205));const before=await readFile(path.join(root,"clippers_workspace/local-news/state.json"),"utf8");
 const sources=await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now}),all=sources.find(s=>s.role==="news")!,ny=sources.find(s=>s.role==="news:ny-news")!;
 assert.equal(all.total,205);assert.equal(all.rows.length,200);assert.equal(all.truncated,true);assert.equal(ny.total,102);assert.ok(ny.rows.every(r=>r.lane==="ny-news"));assert.ok(all.diagnostics.includes("SOURCE_STALE"));assert.equal(all.provenance[0].sourceAt,old);
 assert.ok(!JSON.stringify(sources).includes("SECRET_CUSTOMER"));assert.ok(!JSON.stringify(sources).includes("https://"));assert.equal(await readFile(path.join(root,"clippers_workspace/local-news/state.json"),"utf8"),before);
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;assert.equal(validateWebRoleSource(reorder(all),"owner").sourceDigest,all.sourceDigest);
 const changed=structuredClone(all);changed.rows[0].metrics.qualityScore=99;assert.throws(()=>validateWebRoleSource(changed,"owner"));assert.throws(()=>auditWebRoleSource(all,"owner",now+300001));
});
test("valid empty differs from corrupt or oversized sources and foreign report data never exports",async t=>{
 const root=await fixture(t);await put(root,"dropshipping_engine_data/products.json",[]);await put(root,"dropshipping_engine_data/suppliers.json","{bad");await put(root,"marketing_command_center_data/learning-runs.json","x".repeat(1048577));
 await put(root,"clippers_workspace/reports/one.json",{id:"x",userId:"other",createdAt:at,publishMode:"draft_only",plannedClips:[],summary:"private"});
 const sources=await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now}),drop=sources.find(s=>s.role==="dropshipping")!,marketing=sources.find(s=>s.role==="marketing-cmo")!;
 assert.equal(drop.provenance[0].status,"present");assert.equal(drop.provenance[0].empty,true);assert.equal(drop.provenance[1].status,"invalid");assert.ok(marketing.diagnostics.includes("SOURCE_LIMIT"));assert.equal(sources.find(s=>s.role==="clippers")!.rows.length,0);
});
test("remote queue reads existing SQL only, preserves old heartbeat and retry counts without session claim",async t=>{
 const root=await fixture(t),remote={version:1,updatedAt:old,device:{seenAt:old,queue:{updatedAt:old,totals:{queued:2,processing:0,retry:3,scheduled:1,completed:4,cancelled:0}},lastError:"secret",worker:{token:"secret"}},chatHistory:["private"]};
 const db={query:async(sql:string,args?:unknown[])=>{assert.ok(!/INSERT|UPDATE|CREATE/.test(sql));return {rows:sql.includes("FROM users")?[{id:args![0]}]:[{data:remote}]};}};
 const source=(await readWebRoleSources({pool:db,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="blackroom-videos")!;assert.ok(source.diagnostics.includes("RETRY_BACKLOG"));assert.ok(source.diagnostics.includes("SOURCE_STALE"));assert.ok(source.diagnostics.includes("NO_CURRENT_SESSION_PROOF"));assert.ok(!JSON.stringify(source).includes("secret"));assert.equal(source.rows[0].metrics.retry,3);
});
test("report enumeration and cumulative input bytes are bounded without creating directories",async t=>{
 const root=await fixture(t);for(let i=0;i<25;i++)await put(root,`clippers_workspace/reports/2026-11-07T00-00-${String(i).padStart(2,"0")}-000Z.json`,{id:`r${i}`,userId:"owner",createdAt:at,publishMode:"draft_only",plannedClips:[]});
 const source=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="clippers")!;assert.ok(source.diagnostics.includes("SOURCE_LIMIT"));assert.ok(source.rows.length<=20);assert.equal(auditWebRoleSource(source,"owner",now).completeCoverage,false);
});
test("existing empty report directory and null remote device are valid empty sources, never missing",async t=>{
 const root=await fixture(t);await mkdir(path.join(root,"clippers_workspace/reports"),{recursive:true});
 const db={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[{data:{version:1,updatedAt:at,device:null}}]})};
 const sources=await readWebRoleSources({pool:db,owner:"owner",configuredOwner:"owner",root,now});
 for(const [role,kind] of [["blackroom-videos","blackroom_remote"],["clippers","clip_reports"]]){const p=sources.find(s=>s.role===role)!.provenance.find(p=>p.kind===kind)!;assert.equal(p.status,"present");assert.equal(p.empty,true);assert.ok(p.digest);assert.equal(p.records,0);}
});
test("actual Clippers daily-plan and automation-cycle writer shapes are distinct, unknown files stay visible",async t=>{
 const root=await fixture(t),cycleId="2026-11-07T00-00-00-000Z",dailyId="2026-11-07T00-01-00-000Z";
 const totals={posts:1,dailyTargetPosts:2,weeklyTargetClips:14,backlogPosts:0,gapToDailyTarget:1,scheduled:0,readyForManual:0,blocked:1,draftReady:0,rightsReview:1,needsSource:0};
 await put(root,`clippers_workspace/reports/automation-cycle-${cycleId}.json`,{id:cycleId,userId:"owner",createdAt:at,automation:{id:cycleId,createdAt:at,status:"blocked",totals,posts:[{secret:"private",url:"https://private"}]}});
 const secondId="2026-11-07T00-02-00-000Z";await put(root,`clippers_workspace/reports/automation-cycle-${secondId}.json`,{id:secondId,userId:"owner",createdAt:at,automation:{id:secondId,createdAt:at,status:"blocked",totals,posts:[{}]}});
 await put(root,`clippers_workspace/reports/${dailyId}.json`,{id:dailyId,userId:"owner",createdAt:at,publishMode:"draft_only",plannedClips:[{customer:"private"}]});
 await put(root,"clippers_workspace/reports/other-contract.json",{unknown:"private"});
 const source=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="clippers")!;
 assert.deepEqual(source.rows.map(r=>r.kind).sort(),["clip_cycle","clip_cycle","clip_plan"]);assert.equal(source.rows.find(r=>r.kind==="clip_cycle")!.metrics.blocked,1);assert.ok(source.diagnostics.includes("SOURCE_INVALID"));assert.ok(!JSON.stringify(source).includes("private"));
 const audit=auditWebRoleSource(source,"owner",now);assert.equal(audit.metrics["clip_cycle:observations"],2);assert.equal(audit.metrics["clip_cycle:scheduled"],undefined);assert.equal(audit.metrics["clip_cycle:weeklyTargetClips"],undefined);
 const foreign=path.join(root,`clippers_workspace/reports/${dailyId}.json`);await writeFile(foreign,JSON.stringify({id:dailyId,userId:"other",createdAt:at,publishMode:"draft_only",plannedClips:[]}));
 const changed=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="clippers")!;assert.equal(changed.rows.filter(r=>r.kind==="clip_plan").length,0);
});
test("a fresh BlackRoom heartbeat never launders an old queue timestamp",async t=>{
 const root=await fixture(t);const db={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[{data:{version:1,updatedAt:at,device:{seenAt:at,queue:{updatedAt:old,totals:{queued:1,processing:0,retry:0,scheduled:0,completed:0,cancelled:0}}}}}]})};
 const source=(await readWebRoleSources({pool:db,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="blackroom-videos")!;assert.equal(source.rows[0].sourceAt,old);assert.equal(source.provenance[0].sourceAt,old);assert.equal(source.provenance[0].heartbeatAt,at);assert.ok(source.diagnostics.includes("SOURCE_STALE"));
});


test("duplicate IDs invalidate affected report parts without suppressing six other role exports",async t=>{
 const root=await fixture(t),report={id:"repeated-report",userId:"owner",createdAt:at,publishMode:"draft_only",plannedClips:[]};
 for(const file of ["2026-11-07T00-00-00-000Z.json","2026-11-07T00-01-00-000Z.json"])await put(root,`clippers_workspace/reports/${file}`,report);
 const sources=await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now});
 assert.equal(sources.length,7);const affected=sources.find(s=>s.role==="clippers")!;
 assert.equal(affected.rows.length,0);assert.ok(affected.diagnostics.includes("SOURCE_INVALID"));assert.ok(affected.diagnostics.includes("PARTIAL_COVERAGE"));assert.equal(affected.provenance.filter(p=>p.kind==="clip_reports").every(p=>p.status==="invalid"),true);
 const audit=auditWebRoleSource(affected,"owner",now);assert.equal(audit.status,"blocked");assert.equal(audit.completeCoverage,false);
 for(const source of sources.filter(s=>s.role!=="clippers"))assert.equal(validateWebRoleSource(source,"owner").role,source.role);
});

test("duplicate rows inside one canonical file become invalid evidence, never silent deduplication",async t=>{
 const root=await fixture(t),item={id:"same",updatedAt:at,status:"research"};await put(root,"dropshipping_engine_data/products.json",[item,item]);
 const sources=await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now}),drop=sources.find(s=>s.role==="dropshipping")!;
 assert.equal(sources.length,7);assert.equal(drop.rows.length,0);assert.equal(drop.provenance.find(p=>p.kind==="products")!.status,"invalid");assert.equal(auditWebRoleSource(drop,"owner",now).completeCoverage,false);
});


test("heartbeat without queue capability is missing queue evidence, not an invalid device or completed work",async t=>{
 const root=await fixture(t);
 for(const queue of [{},{updatedAt:at,totals:{queued:1}}]){
 const db={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[{data:{version:1,updatedAt:at,device:{seenAt:at,queue}}}]})};
 const source=(await readWebRoleSources({pool:db,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="blackroom-videos")!;
 assert.equal(source.rows.length,0);assert.equal(source.provenance[0].heartbeatAt,at);assert.equal(source.provenance[0].sourceAt,null);assert.ok(source.diagnostics.includes("SOURCE_MISSING"));assert.ok(!source.diagnostics.includes("SOURCE_INVALID"));assert.equal(auditWebRoleSource(source,"owner",now).status,"blocked");
 }
});

test("unrelated report names cannot crowd out canonical reports; corrupt canonical reports remain visible",async t=>{
 const root=await fixture(t);for(let i=0;i<25;i++)await put(root,`clippers_workspace/reports/z-other-${i}.json`,{});
 const id="2026-11-07T00-00-00-000Z";await put(root,`clippers_workspace/reports/${id}.json`,{id,userId:"owner",createdAt:at,publishMode:"draft_only",plannedClips:[]});
 await put(root,"clippers_workspace/reports/2026-11-broken.json","invalid json");
 const source=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="clippers")!;
 assert.equal(source.rows.length,1);assert.ok(source.diagnostics.includes("SOURCE_INVALID"));assert.equal(auditWebRoleSource(source,"owner",now).status,"blocked");
});


test("malformed queue values remain invalid while preserving independently valid heartbeat",async t=>{
 const root=await fixture(t),totals={queued:0,processing:0,retry:0,scheduled:0,completed:0,cancelled:0};
 for(const queue of [{updatedAt:new Date(now+60000).toISOString(),totals},{updatedAt:at,totals:{...totals,retry:-1}},{updatedAt:"bad",totals},{updatedAt:new Date(now+60000).toISOString(),totals:{}},{updatedAt:at,totals:{...totals,queued:"1"}}]){
 const db={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[{data:{version:1,updatedAt:at,device:{seenAt:at,queue}}}]})};
 const source=(await readWebRoleSources({pool:db,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="blackroom-videos")!;
 assert.equal(source.rows.length,0);assert.equal(source.provenance[0].heartbeatAt,at);assert.ok(source.diagnostics.includes("SOURCE_INVALID"));
 }
});

test("report provenance budget retains every selected source and explicit truncation",async t=>{
 const root=await fixture(t);
 for(let i=0;i<20;i++){const id=`2026-11-07T00-00-${String(i).padStart(2,"0")}-000Z`;await put(root,`clippers_workspace/reports/${id}.json`,{id,userId:"owner",createdAt:at,publishMode:"draft_only",plannedClips:[]});}
 const source=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="clippers")!;
 assert.equal(source.rows.length,18);assert.equal(source.provenance.length,20);assert.equal(source.provenance.filter(p=>p.status==="present").length,18);assert.ok(source.provenance.some(p=>p.status==="limit"));assert.equal(auditWebRoleSource(source,"owner",now).completeCoverage,false);
});


test("remote SQL projects canonical queue before size guard; oversized unrelated history cannot hide stale queue",async t=>{
 const root=await fixture(t),remote={version:1,updatedAt:at,device:{seenAt:old,queue:{updatedAt:old,totals:{queued:11,processing:0,retry:0,scheduled:12,completed:253,cancelled:13},analytics:"x".repeat(2408629)}}};
 assert.ok(Buffer.byteLength(JSON.stringify(remote))>2_400_000);
 const sql=BLACKROOM_SOURCE_PROJECTION_SQL;
 assert.ok(sql.startsWith("WITH projected AS (SELECT CASE"));assert.ok(sql.endsWith("AS data FROM projected"));assert.ok(sql.includes("FROM blackroom_remote_control WHERE id=$1"));
 assert.ok(sql.includes("WHERE key IN ('queued','processing','retry','scheduled','completed','cancelled')"));
 assert.ok(sql.includes("WHERE key IN ('seenAt','queue')"));assert.ok(sql.includes("WHERE key IN ('updatedAt','totals')"));assert.ok(sql.includes("<=4096"));
 assert.ok(!sql.includes("analytics"));assert.ok(!sql.includes("SELECT data FROM blackroom_remote_control"));
 // DB-shaped result of the inspected projection; SQL is not executed by this fixture.
 const db={query:async(query:string,args?:unknown[])=>{if(query.includes("FROM users"))return {rows:[{id:args![0]}]};assert.equal(query,sql);assert.deepEqual(args,["blackroom-primary"]);return {rows:[{data:{version:remote.version,updatedAt:remote.updatedAt,device:{seenAt:remote.device.seenAt,queue:{updatedAt:remote.device.queue.updatedAt,totals:remote.device.queue.totals}}}}]};}};
 const source=(await readWebRoleSources({pool:db,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="blackroom-videos")!;
 assert.equal(source.rows[0].metrics.completed,253);assert.equal(source.rows[0].sourceAt,old);assert.ok(source.diagnostics.includes("SOURCE_STALE"));assert.ok(source.diagnostics.includes("NO_CURRENT_SESSION_PROOF"));assert.ok(!source.diagnostics.includes("SOURCE_INVALID"));assert.ok(!JSON.stringify(source).includes("analytics"));
});
