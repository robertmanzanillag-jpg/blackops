import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm,utimes,access} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";

// End to end: the real Clippers producers (daily plan, automation cycle, metrics
// ingest) and the real office web-source reader/audit. The producers resolve
// clippers_workspace from process.cwd() at import time, so every test starts by
// wiping that workspace: no test depends on another one or on their order.
const root=await mkdtemp(path.join(tmpdir(),"clippers-office-sources-"));
const previousCwd=process.cwd();process.chdir(root);
process.env.DEFAULT_USER_ID="owner";delete process.env.OFFICE_SOURCE_DOCUMENTS_ENABLED;
const clippers=await import("../server/clippers-agent");
const {readWebRoleSources,auditWebRoleSource}=await import("../server/office-web-role-sources");
const {prepareOfficeSourceDocument,ForeignOfficeSourceDocumentError,projectOfficeSourceDocument}=await import("../server/office-source-documents");
test.after(async()=>{process.chdir(previousCwd);assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
const pool={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[]})};
const workspace=path.join(root,"clippers_workspace"),reportsDir=path.join(workspace,"reports"),metricsDir=path.join(workspace,"metrics");
async function freshWorkspace(){await rm(workspace,{recursive:true,force:true});}
const clippersSource=async(at=root)=>(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root:at})).find(s=>s.role==="clippers")!;
const audit=(source:Awaited<ReturnType<typeof clippersSource>>)=>auditWebRoleSource(source,"owner",Date.parse(source.observedAt));
const exists=async(file:string)=>access(file).then(()=>true,()=>false);
const csv="account,platform,clip_id,published_at,views,likes,comments,shares,saves\nsports,tiktok,clip-1,2026-11-18,1200,80,4,9,3\nsports,tiktok,clip-2,11/18/2026 10:00,300,10,1,0,0\n";

test("without analytics exports the automatic run never invents a metrics summary: clip_metrics stays missing",async()=>{
 await freshWorkspace();
 await clippers.runClipperDailyPlan({},"owner");
 await clippers.runClipperAutomationCycle({},"owner");
 assert.equal(await exists(path.join(metricsDir,"metrics-summary.json")),false);
 const source=await clippersSource();
 assert.deepEqual(source.provenance.map(p=>`${p.kind}:${p.status}`).sort(),["clip_metrics:missing","clip_reports:present","clip_reports:present"]);
 assert.ok(source.diagnostics.includes("SOURCE_MISSING"));assert.ok(!source.diagnostics.includes("SOURCE_INVALID"));
 assert.equal(audit(source).status,"blocked");
});

test("a run with real analytics exports is auditable and the metrics time is the data time, not the rebuild time",async()=>{
 await freshWorkspace();await mkdir(metricsDir,{recursive:true});
 const exportPath=path.join(metricsDir,"tiktok-export.csv");await writeFile(exportPath,csv);
 const measuredAt=new Date(Date.now()-3600000);await utimes(exportPath,measuredAt,measuredAt);
 await clippers.runClipperDailyPlan({},"owner");
 await clippers.runClipperAutomationCycle({},"owner");
 const source=await clippersSource();const p=source.provenance.find(p=>p.kind==="clip_metrics")!;
 assert.equal(p.status,"present");assert.equal(p.records,2);assert.equal(p.sourceAt,measuredAt.toISOString());
 assert.deepEqual(source.rows.filter(r=>r.kind==="clip_metric").map(r=>r.metrics.views).sort((a,b)=>a-b),[300,1200]);
 assert.ok(!JSON.stringify(source).includes("clip-1"));assert.ok(!source.diagnostics.includes("SOURCE_STALE"));
 const result=audit(source);assert.equal(result.status,"completed");assert.ok(result.diagnostics.includes("PLANS_NOT_EXECUTION"));assert.ok(result.diagnostics.includes("COLLECTED_METRICS_ONLY"));
});

test("an old analytics export is reported stale, never refreshed by the rebuild",async()=>{
 await freshWorkspace();await mkdir(metricsDir,{recursive:true});
 const exportPath=path.join(metricsDir,"tiktok-export.csv");await writeFile(exportPath,csv);
 const old=new Date(Date.now()-3*86400000);await utimes(exportPath,old,old);
 await clippers.runClipperAutomationCycle({},"owner");
 const source=await clippersSource();
 assert.equal(source.provenance.find(p=>p.kind==="clip_metrics")!.sourceAt,old.toISOString());assert.ok(source.diagnostics.includes("SOURCE_STALE"));
});

test("platform CSV publish dates in date-only or local formats are valid metric evidence",async()=>{
 await freshWorkspace();await mkdir(metricsDir,{recursive:true});await writeFile(path.join(metricsDir,"tiktok-export.csv"),csv);
 const {metrics}=await clippers.ingestClipperMetrics("owner");
 assert.equal(metrics.records.length,2);assert.equal(prepareOfficeSourceDocument("clip_metrics",metrics,{owner:"owner"}).status,"present");
});

test("manual ingest without exports still records an explicit empty summary (unchanged)",async()=>{
 await freshWorkspace();
 const {metrics}=await clippers.ingestClipperMetrics("owner");
 assert.equal(metrics.records.length,0);assert.equal(metrics.generatedAt,null);
 const p=(await clippersSource()).provenance.find(p=>p.kind==="clip_metrics")!;assert.equal(p.status,"present");assert.equal(p.empty,true);assert.equal(p.sourceAt,null);
});

test("Clippers worker artifacts and other users' reports do not invalidate the owner's report folder",async()=>{
 await freshWorkspace();
 await clippers.runClipperDailyPlan({},"owner");await clippers.runClipperAutomationCycle({},"owner");
 for(const name of ["metricool-autopilot-queue.json","metricool-autopilot-ledger.json","metricool-public-media-receipts.json","metricool-publication-reconciliation.json","streamer-growth-ceo.json","youtube-upload-ledger.json","campaign-draft-renderer.json"])await writeFile(path.join(reportsDir,name),JSON.stringify([{private:"PRIVATE"}]));
 await clippers.runClipperDailyPlan({},"someone-else");
 const source=await clippersSource();
 assert.ok(!source.diagnostics.includes("SOURCE_INVALID"));assert.ok(!JSON.stringify(source).includes("PRIVATE"));
 // The foreign plan is skipped, not exported: the owner's two reports remain.
 assert.deepEqual(source.provenance.filter(p=>p.kind==="clip_reports").map(p=>p.status),["present","present"]);assert.equal(source.rows.filter(r=>r.kind==="clip_plan").length,1);
 // An unknown artifact still marks the folder invalid (contract drift stays visible).
 await writeFile(path.join(reportsDir,"unexpected-contract.json"),"{}");
 const drift=await clippersSource();assert.ok(drift.provenance.some(p=>p.kind==="clip_reports"&&p.status==="invalid"));
});

test("only other users' reports is missing evidence for the owner; malformed foreign reports stay invalid",async()=>{
 const other=await mkdtemp(path.join(tmpdir(),"clippers-office-foreign-"));
 try{
  const dir=path.join(other,"clippers_workspace/reports");await mkdir(dir,{recursive:true});
  const id="2026-11-19T00-00-00-000Z",at=new Date(Date.now()-60000).toISOString(),daily=path.join(dir,`${id}.json`),cycle=path.join(dir,`automation-cycle-${id}.json`);
  const totals={posts:1,dailyTargetPosts:1,weeklyTargetClips:7,backlogPosts:0,gapToDailyTarget:0,scheduled:0,readyForManual:0,blocked:1,draftReady:0,rightsReview:0,needsSource:0};
  await writeFile(daily,JSON.stringify({id,userId:"someone-else",createdAt:at,publishMode:"draft_only",plannedClips:[]}));
  const only=(await clippersSource(other)).provenance.filter(p=>p.kind==="clip_reports");
  assert.deepEqual(only.map(p=>[p.status,p.empty]),[["missing",false]]);assert.equal(audit(await clippersSource(other)).status,"blocked");
  await writeFile(daily,JSON.stringify({id,userId:"someone-else",createdAt:at,publishMode:"draft_only"}));
  assert.ok((await clippersSource(other)).provenance.some(p=>p.kind==="clip_reports"&&p.status==="invalid"));
  await rm(daily);
  // Foreign cycle whose posts do not match its totals: integrity is checked before ownership.
  const brokenCycle={id,userId:"someone-else",createdAt:at,automation:{id,createdAt:at,status:"blocked",totals,posts:[]}};
  await writeFile(cycle,JSON.stringify(brokenCycle));
  assert.deepEqual((await clippersSource(other)).provenance.filter(p=>p.kind==="clip_reports").map(p=>p.status),["invalid"]);
  assert.throws(()=>projectOfficeSourceDocument("clip_report",brokenCycle,{owner:"owner",key:`automation-cycle-${id}.json`}),e=>!(e instanceof ForeignOfficeSourceDocumentError));
  assert.throws(()=>projectOfficeSourceDocument("clip_report",{...brokenCycle,automation:{...brokenCycle.automation,posts:[{}]}},{owner:"owner",key:`automation-cycle-${id}.json`}),ForeignOfficeSourceDocumentError);
 }finally{await rm(other,{recursive:true,force:true});}
});
