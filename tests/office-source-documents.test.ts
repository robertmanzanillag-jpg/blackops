import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {canonicalOfficeSourcePath,persistOfficeSourceDocument,prepareOfficeSourceDocument,readOfficeSourceDocuments,OFFICE_SOURCE_DOCUMENT_SCHEMA_SQL,OFFICE_SOURCE_REPORT_RETENTION,type OfficeSourceDocumentSet,type StoredOfficeSourceEntry} from "../server/office-source-documents";
import {createOfficeSourceDocumentSync,mirrorOfficeSourceFile} from "../server/office-source-document-sync";
import {readWebRoleSources,auditWebRoleSource,validateWebRoleSource,CLIPPERS_NON_REPORT_FILES} from "../server/office-web-role-sources";
import {readWorkerWebRoleSource} from "../server/office-web-role-live";
import {sourceDigest} from "../server/office-role-snapshots";
import {parseOfficeSourceMigrateArgs,runOfficeSourceDocumentsMigration} from "../script/office-source-documents-migrate";

const now=Date.parse("2026-11-12T12:00:00Z"),at=new Date(now-3600000).toISOString();
const pool={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[]})};
async function fixture(t:any){const root=await mkdtemp(path.join(tmpdir(),"office-source-docs-"));t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});return root;}
async function put(root:string,file:string,value:unknown){const name=path.join(root,file);await mkdir(path.dirname(name),{recursive:true});await writeFile(name,typeof value==="string"?value:JSON.stringify(value));}
const products=[{id:"p1",updatedAt:at,status:"research",supplierUrl:"https://private/supplier?token=SECRET",notes:"PRIVATE"},{id:"p2",updatedAt:at,status:"blocked",costUsd:3}];
const suppliers=[{id:"s1",updatedAt:at,status:"approved_candidate",score:80,contactEmail:"private@example.com"}];
const social=[{id:"m1",createdAt:at,campaignId:"c1",postId:"post-1",platform:"tiktok",impressions:10,views:5,orders:1,revenueUsd:20,spendUsd:3,accessToken:"SECRET"}];
const news={version:1,updatedAt:at,lastRunAt:at,queue:[{id:"q1",lane:"ny-news",status:"quarantined",createdAt:at,approvalRequired:true,autoEligible:false,qualityScore:50,copy:"PRIVATE",sourceUrl:"https://private"},{id:"q2",lane:"miami-news",status:"auto_eligible",createdAt:at,approvalRequired:false,autoEligible:true,qualityScore:90,mediaUrl:"https://private"}],events:[{secret:"PRIVATE"}],metrics:[]};
const metrics={generatedAt:at,records:[{id:"r1",accountId:"a1",clipId:"c1",publishedAt:at,views:9,likes:1,comments:0,shares:0,saves:0,caption:"PRIVATE"}],files:[{path:"/private"}]};
const dailyKey="2026-11-12T10-00-00-000Z.json",cycleKey="automation-cycle-2026-11-12T10-01-00-000Z.json";
const totals={posts:1,dailyTargetPosts:2,weeklyTargetClips:14,backlogPosts:0,gapToDailyTarget:1,scheduled:0,readyForManual:0,blocked:1,draftReady:0,rightsReview:1,needsSource:0};
const daily={id:"2026-11-12T10-00-00-000Z",userId:"owner",createdAt:at,publishMode:"draft_only",plannedClips:[{customer:"PRIVATE"}],summary:"PRIVATE",reportPath:"/private"};
const cycle={id:"2026-11-12T10-01-00-000Z",userId:"owner",createdAt:at,summary:"PRIVATE",automation:{id:"2026-11-12T10-01-00-000Z",createdAt:at,status:"blocked",totals,posts:[{token:"SECRET"}],schedulePath:"/private"}};

function entry(kind:StoredOfficeSourceEntry["kind"],raw:unknown,key=""):StoredOfficeSourceEntry{const p=prepareOfficeSourceDocument(kind,raw,{owner:"owner",key});return {kind,key,status:p.status,document:p.document,oversized:false};}
function documentSet():OfficeSourceDocumentSet{return {singletons:{products:entry("products",products),suppliers:entry("suppliers",suppliers),social_metrics:entry("social_metrics",social),news_state:entry("news_state",news),clip_metrics:entry("clip_metrics",metrics)},reports:[entry("clip_report",daily,dailyKey),entry("clip_report",cycle,cycleKey)],reportTotal:2};}

test("projection keeps only audited fields and records invalid/limit states instead of masking them",()=>{
 const stored=[prepareOfficeSourceDocument("products",products,{owner:"owner"}),prepareOfficeSourceDocument("suppliers",suppliers,{owner:"owner"}),prepareOfficeSourceDocument("social_metrics",social,{owner:"owner"}),prepareOfficeSourceDocument("news_state",news,{owner:"owner"}),prepareOfficeSourceDocument("clip_metrics",metrics,{owner:"owner"}),prepareOfficeSourceDocument("clip_report",daily,{owner:"owner",key:dailyKey}),prepareOfficeSourceDocument("clip_report",cycle,{owner:"owner",key:cycleKey})];
 assert.ok(stored.every(s=>s.status==="present" && s.digest===sourceDigest(s.document)));
 const text=JSON.stringify(stored);for(const secret of ["SECRET","PRIVATE","https://","private@","/private","userId","campaignId","postId"])assert.ok(!text.includes(secret),secret);
 assert.deepEqual(stored[5].document,{type:"daily",id:sourceDigest(["clip_plan",daily.id]),createdAt:at,publishMode:"draft_only",plannedClips:1});
 const urlId=prepareOfficeSourceDocument("news_state",{...news,queue:[{...news.queue[0],id:"private:https://internal/customer-1?email=a@b.c"}]},{owner:"owner"});
 assert.equal(urlId.status,"present");assert.ok(!JSON.stringify(urlId).includes("internal"));assert.ok(!JSON.stringify(urlId).includes("@"));
 assert.equal(prepareOfficeSourceDocument("products","{bad",{owner:"owner"}).status,"invalid");
 assert.equal(prepareOfficeSourceDocument("clip_report",{...daily,userId:"other"},{owner:"owner",key:dailyKey}).status,"invalid");
 assert.equal(prepareOfficeSourceDocument("clip_report",daily,{owner:"owner",key:cycleKey}).status,"invalid");
 const huge=Array.from({length:10000},(_,i)=>({id:`product-${"x".repeat(80)}-${i}`,updatedAt:at,status:"research"}));
 const limited=prepareOfficeSourceDocument("products",huge,{owner:"owner"});assert.equal(limited.status,"limit");assert.equal(limited.document,null);assert.equal(limited.digest,null);
 for(const key of ["../x.json","other.json","metricool-approval-report.json"])assert.throws(()=>prepareOfficeSourceDocument("clip_report",daily,{owner:"owner",key}));
 assert.throws(()=>prepareOfficeSourceDocument("products",products,{owner:"owner",key:"x"}));
});

test("database documents give the same rows and digests as the files they mirror, and override ephemeral files",async t=>{
 const root=await fixture(t);
 await put(root,"dropshipping_engine_data/products.json",products);await put(root,"dropshipping_engine_data/suppliers.json",suppliers);await put(root,"dropshipping_engine_data/social_metrics.json",social);
 await put(root,"clippers_workspace/local-news/state.json",news);await put(root,"clippers_workspace/metrics/metrics-summary.json",metrics);
 await put(root,`clippers_workspace/reports/${dailyKey}`,daily);await put(root,`clippers_workspace/reports/${cycleKey}`,cycle);
 const fromFiles=await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now});
 const fromDb=await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root:"/nonexistent-office-root",files:false,now,sourceDocuments:async()=>documentSet()});
 for(const role of ["news","news:ny-news","news:miami-news","dropshipping","clippers"] as const){
  const a=fromFiles.find(s=>s.role===role)!,b=fromDb.find(s=>s.role===role)!;
  assert.deepEqual(b.rows,a.rows,role);assert.deepEqual(b.provenance.map(p=>[p.kind,p.status,p.digest,p.records,p.sourceAt]),a.provenance.map(p=>[p.kind,p.status,p.digest,p.records,p.sourceAt]),role);
  assert.ok(b.provenance.every(p=>p.files===0));assert.equal(auditWebRoleSource(b,"owner",now).status,"completed",role);assert.equal(validateWebRoleSource(b,"owner").sourceDigest,b.sourceDigest);
 }
 const marketing=fromDb.find(s=>s.role==="marketing-cmo")!;assert.equal(marketing.provenance.find(p=>p.kind==="social_metrics")!.status,"present");
 assert.ok(!JSON.stringify(fromDb).includes("PRIVATE"));
 // A corrupt ephemeral file never wins over the durable document on the web host.
 await put(root,"dropshipping_engine_data/products.json","{corrupt");
 const host=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now,sourceDocuments:async()=>documentSet()})).find(s=>s.role==="dropshipping")!;
 assert.equal(host.provenance.find(p=>p.kind==="products")!.status,"present");
 // Kinds without a durable copy fall back to files on the host only.
 const partial=documentSet();delete partial.singletons.suppliers;
 const hostPartial=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now,sourceDocuments:async()=>partial})).find(s=>s.role==="dropshipping")!;
 assert.equal(hostPartial.provenance.find(p=>p.kind==="suppliers")!.files,1);
 const workerPartial=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,files:false,now,sourceDocuments:async()=>partial})).find(s=>s.role==="dropshipping")!;
 assert.equal(workerPartial.provenance.find(p=>p.kind==="suppliers")!.status,"missing");assert.equal(auditWebRoleSource(workerPartial,"owner",now).status,"blocked");
});

test("stored invalid, limit, oversized, malformed, future and failed reads are explicit evidence with no file fallback",async t=>{
 const root=await fixture(t);await put(root,"dropshipping_engine_data/products.json",products);await put(root,`clippers_workspace/reports/${dailyKey}`,daily);
 const read=async(set:()=>Promise<OfficeSourceDocumentSet|null>)=>(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now,sourceDocuments:set}));
 const status=(sources:any[],role:string,kind:string)=>sources.find((s:any)=>s.role===role).provenance.filter((p:any)=>p.kind===kind).map((p:any)=>p.status);
 const failed=await read(async()=>{throw Error("private DB detail");});
 assert.deepEqual(status(failed,"dropshipping","products"),["invalid"]);assert.deepEqual(status(failed,"clippers","clip_reports"),["invalid"]);assert.ok(!JSON.stringify(failed).includes("private DB detail"));
 const absent=await read(async()=>null);assert.equal(status(absent,"dropshipping","products")[0],"present");assert.equal(absent.find(s=>s.role==="dropshipping")!.provenance[0].files,1);
 const variants:Array<[Partial<StoredOfficeSourceEntry>,string]>=[[{status:"invalid",document:null},"invalid"],[{status:"limit",document:null},"limit"],[{oversized:true,document:null},"limit"],[{document:[{id:"p1",updatedAt:at,status:"research",extra:"PRIVATE"}]},"invalid"],[{document:[{id:"p1",updatedAt:new Date(now+60000).toISOString(),status:"research"}]},"invalid"]];
 for(const [change,expected] of variants){const set=documentSet();set.singletons.products={...set.singletons.products!,...change};assert.deepEqual(status(await read(async()=>set),"dropshipping","products"),[expected]);}
 const wrongType=documentSet();wrongType.reports=[{...wrongType.reports[1],key:dailyKey}];wrongType.reportTotal=1;assert.deepEqual(status(await read(async()=>wrongType),"clippers","clip_reports"),["invalid"]);
});

test("durable reports keep the provenance budget and mark truncation",async()=>{
 const set=documentSet();set.reports=Array.from({length:25},(_,i)=>{const id=`2026-11-12T09-00-${String(i).padStart(2,"0")}-000Z`;return entry("clip_report",{...daily,id},`${id}.json`);});set.reportTotal=40;
 const source=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root:"/nonexistent-office-root",files:false,now,sourceDocuments:async()=>set})).find(s=>s.role==="clippers")!;
 assert.ok(source.provenance.length<=20);assert.ok(source.provenance.some(p=>p.kind==="clip_reports"&&p.status==="limit"));assert.equal(auditWebRoleSource(source,"owner",now).completeCoverage,false);
 assert.equal(source.rows.filter(r=>r.kind==="clip_plan").length,source.provenance.filter(p=>p.kind==="clip_reports"&&p.status==="present").length);
});

test("known non-report Clippers artifacts are ignored by exact name; unknown files still invalidate the folder",async t=>{
 const root=await fixture(t);await put(root,`clippers_workspace/reports/${dailyKey}`,daily);
 for(const name of ["metricool-approval-report.json","clippers-external-closeout-pack.json","clippers-operational-readiness.json"])await put(root,`clippers_workspace/reports/${name}`,{private:"PRIVATE"});
 assert.ok(CLIPPERS_NON_REPORT_FILES.has("metricool-approval-report.json"));
 const ok=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="clippers")!;
 const reports=ok.provenance.filter(p=>p.kind==="clip_reports");assert.deepEqual(reports.map(p=>p.status),["present"]);assert.equal(ok.rows.filter(r=>r.kind==="clip_plan").length,1);assert.ok(!ok.diagnostics.includes("SOURCE_INVALID"));assert.ok(!JSON.stringify(ok).includes("PRIVATE"));
 await put(root,"clippers_workspace/reports/metricool-approval-report-copy.json",{});
 const bad=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="clippers")!;assert.ok(bad.provenance.some(p=>p.kind==="clip_reports"&&p.status==="invalid"));
 // A folder holding only known artifacts is a valid empty source.
 const root2=await fixture(t);await put(root2,"clippers_workspace/reports/clippers-external-closeout-pack.json",{});
 const empty=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root:root2,now})).find(s=>s.role==="clippers")!.provenance.find(p=>p.kind==="clip_reports")!;
 assert.equal(empty.status,"present");assert.equal(empty.empty,true);
});

test("write-through queue snapshots at write time, coalesces per document, keeps order and hides errors",async()=>{
 const writes:Array<{key:string;status:string;document:unknown;writtenAt:string}>=[];let clock=now,fail=false;
 const sync=createOfficeSourceDocumentSync({now:()=>clock,maxPending:3,persist:async(_owner,prepared,writtenAt)=>{if(fail)throw Object.assign(Error("password=SECRET host=private"),{code:"ECONNRESET"});writes.push({key:prepared.kind+prepared.key,status:prepared.status,document:prepared.document,writtenAt});return {written:true};}});
 const list=[{id:"p1",updatedAt:at,status:"research"}];
 assert.equal(sync.queue({kind:"products",raw:list}),true);list.push({id:"p2",updatedAt:at,status:"blocked"});
 assert.equal(sync.queue({kind:"products",raw:list}),true);assert.equal(sync.queue({kind:"suppliers",raw:"{bad"}),true);
 await sync.flush();
 assert.equal((writes[0].document as unknown[]).length,1,"first write snapshotted before mutation");
 assert.ok(writes.every((w,i)=>i===0||Date.parse(w.writtenAt)>Date.parse(writes[i-1].writtenAt)));assert.equal(writes.find(w=>w.key==="suppliers")!.status,"invalid");
 fail=true;sync.queue({kind:"products",raw:list});await sync.flush();const status=sync.status();assert.equal(status.failed,1);assert.equal(status.lastFailureCode,"ECONNRESET");assert.ok(!JSON.stringify(status).includes("SECRET"));
 assert.equal(sync.queue({kind:"clip_report",raw:daily,key:"../escape.json",owner:"owner"}),false);
 clock=now;fail=false;
});

test("mirror is a no-op unless enabled with production PostgreSQL and the canonical path",()=>{
 const saved={a:process.env.OFFICE_SOURCE_DOCUMENTS_ENABLED,b:process.env.AGENT_COUNCIL_STORAGE};
 try{
  delete process.env.OFFICE_SOURCE_DOCUMENTS_ENABLED;assert.equal(mirrorOfficeSourceFile({kind:"products",filePath:canonicalOfficeSourcePath("products",{root:process.cwd(),env:process.env}),raw:[]}),false);
  process.env.OFFICE_SOURCE_DOCUMENTS_ENABLED="true";process.env.AGENT_COUNCIL_STORAGE="file";assert.equal(mirrorOfficeSourceFile({kind:"products",filePath:canonicalOfficeSourcePath("products",{root:process.cwd(),env:process.env}),raw:[]}),false);
  process.env.AGENT_COUNCIL_STORAGE="postgres";assert.equal(mirrorOfficeSourceFile({kind:"products",filePath:path.join(tmpdir(),"products.json"),raw:[]}),false);
 }finally{for(const [k,v] of [["OFFICE_SOURCE_DOCUMENTS_ENABLED",saved.a],["AGENT_COUNCIL_STORAGE",saved.b]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
 assert.equal(canonicalOfficeSourcePath("news_state",{root:"/app",env:{CLIPPERS_LOCAL_NEWS_WORKSPACE:"/data/news"}}),"/data/news/state.json");
 assert.equal(canonicalOfficeSourcePath("clip_report",{root:"/app",key:dailyKey}),`/app/clippers_workspace/reports/${dailyKey}`);
 assert.throws(()=>canonicalOfficeSourcePath("clip_report",{root:"/app",key:"../x.json"}));
 assert.deepEqual(parseOfficeSourceMigrateArgs([]),{apply:false});assert.deepEqual(parseOfficeSourceMigrateArgs(["--apply"]),{apply:true});assert.throws(()=>parseOfficeSourceMigrateArgs(["--force"]));
});

// Real PostgreSQL 16: set OFFICE_SOURCE_TEST_DATABASE_URL to a fresh, disposable database.
const url=process.env.OFFICE_SOURCE_TEST_DATABASE_URL;
test("PostgreSQL: dry-run/apply migration, guarded upsert, owner isolation, constraints, retention and worker audit",{skip:!url},async t=>{
 const pg=(await import("pg")).default;const db=new pg.Pool({connectionString:url,max:2});t.after(()=>db.end());
 await db.query("DROP TABLE IF EXISTS office_source_documents");await db.query("DROP TABLE IF EXISTS office_web_role_sources");await db.query("CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY)");await db.query("INSERT INTO users(id) VALUES('owner'),('other') ON CONFLICT DO NOTHING");
 assert.equal(await readOfficeSourceDocuments(db,"owner"),null,"absent table reads as no documents");
 const client=await db.connect();try{
  assert.equal((await runOfficeSourceDocumentsMigration(client,false)).applied,false);
  assert.equal((await db.query("SELECT 1 FROM pg_tables WHERE tablename='office_source_documents'")).rows.length,0,"dry run rolled back");
  assert.equal((await runOfficeSourceDocumentsMigration(client,true)).applied,true);
  assert.equal((await runOfficeSourceDocumentsMigration(client,true)).applied,true,"idempotent");
 }finally{client.release();}
 const t1=new Date(now-60000).toISOString(),t2=new Date(now-30000).toISOString(),t0=new Date(now-90000).toISOString();
 const first=await persistOfficeSourceDocument(db,"owner",prepareOfficeSourceDocument("products",products,{owner:"owner"}),t1,now);assert.deepEqual(first,{written:true,revision:1});
 assert.equal((await persistOfficeSourceDocument(db,"owner",prepareOfficeSourceDocument("products",products,{owner:"owner"}),t2,now)).written,false,"identical content is a no-op");
 assert.equal((await persistOfficeSourceDocument(db,"owner",prepareOfficeSourceDocument("products",[],{owner:"owner"}),t0,now)).written,false,"older write never rolls back");
 assert.deepEqual(await persistOfficeSourceDocument(db,"owner",prepareOfficeSourceDocument("products","{bad",{owner:"owner"}),t2,now),{written:true,revision:2});
 assert.deepEqual(await persistOfficeSourceDocument(db,"owner",prepareOfficeSourceDocument("products",products,{owner:"owner"}),new Date(now-20000).toISOString(),now),{written:true,revision:3});
 await assert.rejects(()=>persistOfficeSourceDocument(db,"ghost",prepareOfficeSourceDocument("products",products,{owner:"ghost"}),t2,now),/Canonical owner absent/);
 await assert.rejects(()=>persistOfficeSourceDocument(db,"owner",prepareOfficeSourceDocument("products",products,{owner:"owner"}),new Date(now+60000).toISOString(),now),/write time/);
 const tampered={...prepareOfficeSourceDocument("products",products,{owner:"owner"}),document:[{id:"p1",updatedAt:at,status:"research",secret:"x"}]};await assert.rejects(()=>persistOfficeSourceDocument(db,"owner",tampered,t2,now));
 await assert.rejects(()=>db.query("INSERT INTO office_source_documents(owner_key,kind,doc_key,status,document,digest,written_at) VALUES($1,'products','','present',NULL,NULL,now())",[sourceDigest("owner")]),(e:any)=>e.code==="23514");
 await assert.rejects(()=>db.query("INSERT INTO office_source_documents(owner_key,kind,doc_key,status,written_at) VALUES($1,'clip_report','x.json','invalid',now())",[sourceDigest("owner")]),(e:any)=>e.code==="23514");
 await assert.rejects(()=>db.query("INSERT INTO office_source_documents(owner_key,kind,doc_key,status,written_at) VALUES($1,'tokens','','invalid',now())",[sourceDigest("owner")]),(e:any)=>e.code==="23514");
 for(const [kind,raw] of [["suppliers",suppliers],["social_metrics",social],["news_state",news],["clip_metrics",metrics]] as const)await persistOfficeSourceDocument(db,"owner",prepareOfficeSourceDocument(kind,raw,{owner:"owner"}),t2,now);
 for(let i=0;i<OFFICE_SOURCE_REPORT_RETENTION+5;i++){const id=`2026-11-12T08-${String(Math.floor(i/60)).padStart(2,"0")}-${String(i%60).padStart(2,"0")}-000Z`;await persistOfficeSourceDocument(db,"owner",prepareOfficeSourceDocument("clip_report",{...daily,id},{owner:"owner",key:`${id}.json`}),t2,now);}
 await persistOfficeSourceDocument(db,"owner",prepareOfficeSourceDocument("clip_report",cycle,{owner:"owner",key:cycleKey}),t2,now);
 assert.equal(Number((await db.query("SELECT count(*) FROM office_source_documents WHERE kind='clip_report'")).rows[0].count),OFFICE_SOURCE_REPORT_RETENTION,"bounded retention");
 assert.equal((await db.query("SELECT 1 FROM office_source_documents WHERE doc_key=$1",[cycleKey])).rows.length,1,"newest report retained");
 await persistOfficeSourceDocument(db,"other",prepareOfficeSourceDocument("suppliers",[],{owner:"other"}),t2,now);
 const set=(await readOfficeSourceDocuments(db,"owner"))!;assert.equal(set.reportTotal,OFFICE_SOURCE_REPORT_RETENTION);assert.equal(set.singletons.suppliers!.status,"present");assert.equal((set.singletons.suppliers!.document as unknown[]).length,1,"owner isolation");
 const raw=JSON.stringify((await db.query("SELECT document FROM office_source_documents")).rows);for(const secret of ["SECRET","PRIVATE","https://","private@"])assert.ok(!raw.includes(secret),secret);
 // The worker observes every web role from the database while the web host sleeps.
 const readOnly={query:async(sql:string,args?:unknown[])=>{assert.ok(!/INSERT|UPDATE|DELETE|CREATE/i.test(sql),"worker is read-only");return db.query(sql,args as any[]);}};
 await db.query("CREATE TABLE IF NOT EXISTS blackroom_remote_control(id text PRIMARY KEY,data jsonb)");await db.query("CREATE TABLE IF NOT EXISTS revenue_engine_state(owner_user_id text,kind text,data jsonb,revision int,updated_at timestamptz,PRIMARY KEY(owner_user_id,kind))");
 for(const role of ["news","news:ny-news","news:miami-news","dropshipping","clippers"] as const){
  const source=(await readWorkerWebRoleSource({pool:readOnly,owner:"owner",configuredOwner:"owner",role,now:()=>now}))!;
  assert.equal(validateWebRoleSource(source,"owner").role,role);assert.ok(source.provenance.every(p=>p.files===0));
  if(role!=="clippers")assert.equal(auditWebRoleSource(source,"owner",now).status,"completed",role);
  else{assert.ok(source.provenance.some(p=>p.status==="limit"));assert.ok(source.rows.some(r=>r.kind==="clip_cycle"));}
 }
 assert.ok(OFFICE_SOURCE_DOCUMENT_SCHEMA_SQL.startsWith("CREATE TABLE IF NOT EXISTS office_source_documents"));
});
