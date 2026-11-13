import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readWorkerWebRoleSource,DATABASE_WEB_SOURCE_ROLES} from "../server/office-web-role-live";
import {readWebRoleSources,auditWebRoleSource,validateWebRoleSource,type WebRoleSource} from "../server/office-web-role-sources";
import {sourceDigest} from "../server/office-role-snapshots";
import {MARKETING_LEARNING_KIND} from "../server/marketing-learning-store";
import {withConnectionRetry,isTransientConnectionError} from "../server/office-source-pool";
import {prepareOfficeSourceDocument} from "../server/office-source-documents";

const now=Date.parse("2026-11-12T12:00:00Z"),recent=new Date(now-3600000).toISOString();
const remote={version:1,updatedAt:recent,device:{seenAt:recent,queue:{updatedAt:recent,totals:{queued:1,processing:0,retry:0,scheduled:2,completed:5,cancelled:0}},lastError:"secret"}};
const learning={version:1,ownerKey:createHash("sha256").update("owner").digest("hex"),runs:[{id:"run-1",createdAt:recent,focusClientId:"all",clientsReviewed:3,improvementsQueued:["private plan"],rulesUpdated:[],safetyBlocks:[],summary:"private summary"}]};
function db(options:{stored?:unknown;storedThrows?:boolean;remote?:unknown;learning?:unknown;failFirst?:number;documents?:any[];documentsMissing?:boolean}={}){
 const calls:string[]=[];let failures=options.failFirst??0;
 return {calls,pool:{query:async(sql:string,args?:unknown[])=>{
  calls.push(sql);assert.ok(!/INSERT|UPDATE|DELETE|CREATE/.test(sql),"worker observation must be read-only");
  if(failures>0){failures--;throw Error("Connection terminated due to connection timeout");}
  if(sql.includes("FROM users"))return {rows:args![0]==="owner"?[{id:"owner"}]:[]};
  if(sql.includes("office_web_role_sources")){if(options.storedThrows)throw Error("stored corrupt");return {rows:options.stored?[{source:options.stored}]:[]};}
  if(sql.includes("blackroom_remote_control"))return {rows:options.remote===undefined?[]:[{data:options.remote}]};
  if(sql.includes("office_source_documents")){if(options.documentsMissing)throw Object.assign(Error("relation missing"),{code:"42P01"});const reports=sql.includes("kind='clip_report'");return {rows:(options.documents||[]).filter(r=>(r.kind==="clip_report")===reports).map(r=>reports?{...r,total:(options.documents||[]).filter(x=>x.kind==="clip_report").length}:r)};}
  if(sql.includes("revenue_engine_state")){assert.equal(args![1],MARKETING_LEARNING_KIND);return {rows:options.learning===undefined?[]:[{data:options.learning}]};}
  throw Error(`unexpected ${sql}`);
 }}};
}
async function hostExport(observedAt:number,role:WebRoleSource["role"]="blackroom-videos"){const {pool}=db({remote});return (await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root:"/nonexistent-office-root",files:false,now:observedAt})).find(s=>s.role===role)!;}

test("database-backed role completes from a worker observation while the web host sleeps",async()=>{
 const {pool,calls}=db({remote,learning});
 const source=(await readWorkerWebRoleSource({pool,owner:"owner",configuredOwner:"owner",role:"blackroom-videos",now:()=>now}))!;
 assert.equal(source.observedAt,new Date(now).toISOString());assert.equal(validateWebRoleSource(source,"owner").sourceDigest,source.sourceDigest);
 const audit=auditWebRoleSource(source,"owner",now+5000);assert.equal(audit.status,"completed");assert.equal(source.provenance[0].sourceAt,recent);assert.equal(source.provenance[0].heartbeatAt,recent);
 assert.ok(source.diagnostics.includes("NO_CURRENT_SESSION_PROOF"));assert.ok(!JSON.stringify(source).includes("secret"));
 assert.ok(calls.some(c=>c.includes("office_web_role_sources")));
});
test("marketing-cmo observed from the database keeps the file-backed social metrics missing and blocked",async()=>{
 const {pool}=db({remote,learning});
 const source=(await readWorkerWebRoleSource({pool,owner:"owner",configuredOwner:"owner",role:"marketing-cmo",now:()=>now}))!;
 const learned=source.provenance.find(p=>p.kind==="marketing_learning")!,social=source.provenance.find(p=>p.kind==="social_metrics")!;
 assert.equal(learned.status,"present");assert.equal(learned.records,1);assert.equal(social.status,"missing");assert.equal(social.files,0);
 assert.ok(source.diagnostics.includes("SOURCE_MISSING"));assert.equal(auditWebRoleSource(source,"owner",now).status,"blocked");assert.ok(!JSON.stringify(source).includes("private"));
});
test("a fresh host export is preferred; a stale one is replaced only for database-backed roles",async()=>{
 const fresh=await hostExport(now-60000);
 const preferred=await readWorkerWebRoleSource({pool:db({stored:fresh,remote:null}).pool,owner:"owner",configuredOwner:"owner",role:"blackroom-videos",now:()=>now});
 assert.equal(preferred!.sourceDigest,fresh.sourceDigest);
 const stale=await hostExport(now-250000);
 const replaced=await readWorkerWebRoleSource({pool:db({stored:stale,remote}).pool,owner:"owner",configuredOwner:"owner",role:"blackroom-videos",now:()=>now});
 assert.equal(replaced!.observedAt,new Date(now).toISOString());
 // News is now database-backed: a stale host export is replaced by a worker observation.
 const news=await hostExport(now-3600000,"news");
 const observed=await readWorkerWebRoleSource({pool:db({stored:news}).pool,owner:"owner",configuredOwner:"owner",role:"news",now:()=>now});
 assert.equal(observed!.observedAt,new Date(now).toISOString());assert.equal(auditWebRoleSource(observed,"owner",now).status,"blocked");
 // Without durable documents (or before the migration) the observation stays honestly missing.
 for(const options of [{},{documentsMissing:true}]){const clippers=(await readWorkerWebRoleSource({pool:db(options).pool,owner:"owner",configuredOwner:"owner",role:"clippers",now:()=>now}))!;assert.ok(clippers.provenance.every(p=>p.status==="missing"&&p.files===0));}
 const dropped=(await readWorkerWebRoleSource({pool:db({storedThrows:true}).pool,owner:"owner",configuredOwner:"owner",role:"dropshipping",now:()=>now}))!;assert.equal(auditWebRoleSource(dropped,"owner",now).status,"blocked");
 const recovered=await readWorkerWebRoleSource({pool:db({storedThrows:true,remote}).pool,owner:"owner",configuredOwner:"owner",role:"blackroom-videos",now:()=>now});
 assert.equal(auditWebRoleSource(recovered,"owner",now).status,"completed");
 assert.deepEqual([...DATABASE_WEB_SOURCE_ROLES],["news","news:ny-news","news:miami-news","blackroom-videos","dropshipping","marketing-cmo","clippers"]);
});
test("marketing-cmo and dropshipping complete from durable documents while the web host sleeps",async()=>{
 const social=prepareOfficeSourceDocument("social_metrics",[{id:"m1",createdAt:recent,campaignId:"c",postId:"p",platform:"tiktok",impressions:1,views:1,orders:0,revenueUsd:0,spendUsd:0,token:"secret"}],{owner:"owner"});
 const products=prepareOfficeSourceDocument("products",[{id:"p1",updatedAt:recent,status:"research"}],{owner:"owner"}),suppliers=prepareOfficeSourceDocument("suppliers",[],{owner:"owner"});
 const documents=[social,products,suppliers].map(d=>({kind:d.kind,doc_key:d.key,status:d.status,document:d.document,oversized:false}));
 const marketing=(await readWorkerWebRoleSource({pool:db({remote,learning,documents}).pool,owner:"owner",configuredOwner:"owner",role:"marketing-cmo",now:()=>now}))!;
 assert.equal(auditWebRoleSource(marketing,"owner",now).status,"completed");assert.ok(!JSON.stringify(marketing).includes("secret"));
 const drop=(await readWorkerWebRoleSource({pool:db({documents}).pool,owner:"owner",configuredOwner:"owner",role:"dropshipping",now:()=>now}))!;
 assert.equal(auditWebRoleSource(drop,"owner",now).status,"completed");assert.equal(drop.rows.length,1);
});
test("database-only observation never touches files and rejects a foreign owner",async()=>{
 const sources=await readWebRoleSources({pool:db({remote}).pool,owner:"owner",configuredOwner:"owner",root:"/definitely/not/here",files:false,now});
 for(const role of ["news","news:ny-news","news:miami-news","dropshipping","clippers"])assert.equal(auditWebRoleSource(sources.find(s=>s.role===role),"owner",now).status,"blocked");
 assert.ok(sources.filter(s=>s.role!=="blackroom-videos").flatMap(s=>s.provenance).filter(p=>p.kind!=="marketing_learning").every(p=>p.status==="missing" && p.files===0));
 await assert.rejects(()=>readWorkerWebRoleSource({pool:db({remote}).pool,owner:"other",configuredOwner:"owner",role:"blackroom-videos",now:()=>now}));
 assert.equal(sourceDigest("owner"),sources[0].ownerKey);
});
test("connection retry is bounded, only for transient connection failures, and rethrows the original error",async()=>{
 const slept:number[]=[];const sleep=async(ms:number)=>{slept.push(ms);};
 const {pool,calls}=db({remote,failFirst:2});
 const retried=withConnectionRetry(pool,{sleep});assert.deepEqual((await retried.query("SELECT id FROM users WHERE id=$1",["owner"])).rows,[{id:"owner"}]);assert.deepEqual(slept,[1000,3000]);assert.equal(calls.length,3);
 const always=withConnectionRetry({query:async()=>{throw Error("Connection terminated due to connection timeout");}},{sleep,delaysMs:[1,1]});
 await assert.rejects(()=>always.query("SELECT 1"),/^Error: Connection terminated due to connection timeout$/);
 let attempts=0;const schema=withConnectionRetry({query:async()=>{attempts++;throw Object.assign(Error("relation missing"),{code:"42P01"});}},{sleep});
 await assert.rejects(()=>schema.query("SELECT 1"),(e:any)=>e.code==="42P01");assert.equal(attempts,1);
 for(const transient of [Object.assign(Error("x"),{code:"ECONNRESET"}),Object.assign(Error("x"),{code:"57P01"}),Error("Connection terminated unexpectedly"),Error("timeout exceeded when trying to connect")])assert.equal(isTransientConnectionError(transient),true);
 for(const other of [Error("Connection terminated due to connection timeout SECRET"),Object.assign(Error("x"),{code:"23505"}),null,"text"])assert.equal(isTransientConnectionError(other),false);
});
