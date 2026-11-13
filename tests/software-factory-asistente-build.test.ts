import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAsistenteFactoryBuild } from "../server/software-factory-asistente-build";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import type { FactoryProject } from "../server/software-factory";
import type { FactoryPipelineState } from "../server/software-factory-pipeline";

test("Asistente composition reserves shared credit before model calls and accounts known incomplete usage", async () => {
 let clock='2026-11-06T12:00:00Z', expireAfterCounting=false, staleBase=false;
 const now=()=>new Date(clock), repo='robertmanzanillag-jpg/blackops', base='a'.repeat(40), tree='b'.repeat(40);
 const source=Buffer.from('export const count = 1;\n'), workflow=Buffer.from('trusted workflow fixture');
 const blob=createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
 const workflowPath='.github/workflows/factory-candidate-checks.yml';
 let state:SharedCreditState={version:1,grant:null,lastObservedAt:null,reservations:[]}, apiCalls=0, mutations=0;
 const ledger=createSharedOpenAiCreditLedger({grant:{id:'g',accountScope:'org',availableMicroUsd:20000,observedAt:now().toISOString(),expiresAt:'2026-11-20T00:00:00Z',verificationEvidenceId:'verified'},now,maximumGrantObservationAgeMs:1000,
  transact:async mutate=>{const copy=structuredClone(state);const value=mutate(copy);state=copy;return value;}});
 const build=createAsistenteFactoryBuild({ledger,baseBranch:'codex/office-integrated-repair-20261106',maxFilesPerOrder:6,maxOutputTokens:100,now,
  checks:{workflowId:1,workflowPath,workflowSha256:createHash('sha256').update(workflow).digest('hex'),jobName:'checks',testStep:'Tests',buildStep:'Build',browserStep:'Browser'},
  githubRequest:async(url,init)=>{
   if(init.method!=='GET'){mutations++;throw Error('unexpected publication');}
   const json=(data:unknown)=>new Response(JSON.stringify(data),{status:200});
   if(url.includes('/git/ref/'))return json({ref:'refs/heads/codex/office-integrated-repair-20261106',object:{type:'commit',sha:staleBase?'c'.repeat(40):base}});
   if(url.endsWith(repo))return json({full_name:repo,private:false,archived:false,disabled:false,default_branch:'main'});
   if(url.includes('/contents/'))return json({type:'file',path:workflowPath,sha:createHash('sha1').update(`blob ${workflow.length}\0`).update(workflow).digest('hex'),encoding:'base64',size:workflow.length,content:workflow.toString('base64')});
   if(url.includes('/git/commits/'))return json({sha:base,tree:{sha:tree},parents:[],message:'base'});
   if(url.includes('/git/trees/'))return json({sha:tree,truncated:false,tree:[{path:'server',type:'tree',mode:'040000',sha:'d'.repeat(40)},{path:'server/agent-search.ts',type:'blob',mode:'100644',sha:blob,size:source.length}]});
   assert.ok(url.endsWith(blob));return json({sha:blob,encoding:'base64',size:source.length,content:source.toString('base64')});
  },
  model:{model:'gpt-4.1-mini-2025-04-14',inputNanoUsdPerToken:400,outputNanoUsdPerToken:1600,maxInputTokens:12000,pricingValidUntil:'2026-12-20T00:00:00Z',now,
   request:async(url)=>{apiCalls++;if(expireAfterCounting && url.endsWith('/input_tokens')) clock='2026-11-20T00:00:00Z';assert.equal(state.reservations.at(-1)?.status,'reserved');return new Response(JSON.stringify(url.endsWith('/input_tokens')?{object:'response.input_tokens',input_tokens:10}:{object:'response',model:'gpt-4.1-mini-2025-04-14',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:10,output_tokens:100,total_tokens:110}}),{status:200});}},
 });
 const project={id:'asistente',repo} as FactoryProject;
 const input={version:1,projectId:'asistente',rootJobId:'order-root',repairAttempts:0,finding:{baseSha:base,request:'Improve agent search',sourcePaths:['server/agent-search.ts']}} as FactoryPipelineState;
 const context={signal:new AbortController().signal,maxCostCents:2};
 staleBase=true;
 const stale=await build(project,input,context);
 assert.equal('status' in stale && stale.status,'blocked');assert.equal(apiCalls,0);assert.equal(mutations,0);assert.equal(state.reservations.length,0);
 staleBase=false;
 const denied=await build(project,input,context);
 assert.equal('status' in denied && denied.status,'unknown',JSON.stringify(denied));assert.equal(apiCalls,0);assert.equal(mutations,0);
 await ledger.initialize();
 const attempted=await build(project,input,context);
 assert.equal('status' in attempted && attempted.status,'failed');assert.equal(apiCalls,2);assert.equal(mutations,0);
 assert.equal((await ledger.status()).spentMicroUsd,10000);
 await build(project,input,context);assert.equal(apiCalls,2);
 const foreign=await build({...project,repo:'owner/kong'},input,context);
 assert.equal('status' in foreign && foreign.status,'blocked');assert.equal(apiCalls,2);
 expireAfterCounting=true;
 const expired=await build(project,{...input,repairAttempts:1},{...context,maxCostCents:1});
 assert.equal('status' in expired && expired.status,'unknown');
 assert.equal(apiCalls,3,'credit expiry after counting must prevent generation despite current model pricing');
 assert.equal((await ledger.status()).reservedMicroUsd,10000);
});



test("Asistente export failures and stage cancellation stop before any credit or model admission",async()=>{
 const repo="robertmanzanillag-jpg/blackops",base="a".repeat(40),tree="b".repeat(40),workflow="trusted",workflowPath=".github/workflows/factory-candidate-checks.yml",source="export const value=1;\n";
 const hash=(s:string)=>createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex");
 for(const mode of ["missing","unsafe","mismatch","abort"]){let credit=0,model=0,blobs=0;const controller=new AbortController();
  const build=createAsistenteFactoryBuild({ledger:{reserve:async()=>{credit++;throw Error("NOT_EXPECTED");}} as any,baseBranch:"main",maxFilesPerOrder:6,maxOutputTokens:100,now:()=>new Date("2026-11-07T00:00:00Z"),checks:{workflowId:1,workflowPath,workflowSha256:createHash("sha256").update(workflow).digest("hex"),jobName:"checks",testStep:"test",buildStep:"build",browserStep:"browser"},
   model:{model:"gpt-6-astra",inputNanoUsdPerToken:1,outputNanoUsdPerToken:1,maxInputTokens:1000,pricingValidUntil:"2026-11-20T00:00:00Z",now:()=>new Date("2026-11-07T00:00:00Z"),request:async()=>{model++;throw Error("NOT_EXPECTED");}},
   githubRequest:async(url,init)=>{assert.ok(init.signal);const json=(v:unknown)=>Response.json(v);
    if(url.includes("/git/ref/"))return json({ref:"refs/heads/main",object:{type:"commit",sha:base}});
    if(url.endsWith(repo))return json({full_name:repo,private:false,archived:false,disabled:false,default_branch:"main"});
    if(url.includes("/contents/"))return json({type:"file",path:workflowPath,sha:hash(workflow),encoding:"base64",size:workflow.length,content:Buffer.from(workflow).toString("base64")});
    if(url.includes("/commits/"))return json({sha:base,tree:{sha:tree},parents:[],message:"base"});
    if(url.includes("/trees/")){if(mode==="abort"){controller.abort();assert.equal(init.signal!.aborted,true);}return json({sha:tree,truncated:false,tree:[{path:"server",type:"tree",mode:"040000",sha:"c".repeat(40)},...(mode==="missing"?[]:[{path:mode==="unsafe"?"../escape":"server/role.ts",type:"blob",mode:"100644",sha:hash(source),size:source.length}])]});}
    blobs++;return json({sha:hash(source),encoding:"base64",size:source.length,content:Buffer.from("x".repeat(source.length)).toString("base64")});
   }});
  const result=await build({id:"asistente",repo} as FactoryProject,{version:1,projectId:"asistente",rootJobId:"root",repairAttempts:0,finding:{baseSha:base,request:"Fix role",sourcePaths:["server/role.ts"]}} as FactoryPipelineState,{signal:controller.signal,maxCostCents:1});
  assert.equal("status" in result&&result.status,"failed");assert.equal(credit,0);assert.equal(model,0);assert.equal(blobs,mode==="mismatch"?1:0);
 }
});

function scopedFixture(){
 const repo="robertmanzanillag-jpg/blackops",base="a".repeat(40),tree="b".repeat(40),workflow="trusted",workflowPath=".github/workflows/factory-candidate-checks.yml";
 const hash=(s:string)=>createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex");
 const files:Record<string,string>={"server/agent-search.ts":"export const a=1;\n","server/other.ts":"export const b=2;\n","tests/agent-search.test.ts":"test;\n"};
 const fetched:string[]=[];let credit=0,model=0,github=0;
 const make=(extra:Record<string,unknown>={})=>createAsistenteFactoryBuild({ledger:{reserve:async()=>{credit++;throw Error("CREDIT_STOP");},status:async()=>{credit++;throw Error("CREDIT_STOP");}} as any,baseBranch:"main",maxFilesPerOrder:6,maxOutputTokens:100,now:()=>new Date("2026-11-07T10:00:00Z"),
  checks:{workflowId:1,workflowPath,workflowSha256:createHash("sha256").update(workflow).digest("hex"),jobName:"checks",testStep:"test",buildStep:"build",browserStep:"browser"},
  model:{model:"fixture-model-2026-01-01",inputNanoUsdPerToken:1,outputNanoUsdPerToken:1,maxInputTokens:1000,pricingValidUntil:"2026-11-20T00:00:00Z",now:()=>new Date("2026-11-07T10:00:00Z"),request:async()=>{model++;throw Error("NOT_EXPECTED");}},
  githubRequest:async(url,init)=>{github++;if(init.method&&init.method!=="GET")throw Error("NO_WRITES");const json=(v:unknown)=>Response.json(v);
   if(url.includes("/git/ref/"))return json({ref:"refs/heads/main",object:{type:"commit",sha:base}});
   if(url.endsWith(repo))return json({full_name:repo,private:false,archived:false,disabled:false,default_branch:"main"});
   if(url.includes("/contents/"))return json({type:"file",path:workflowPath,sha:hash(workflow),encoding:"base64",size:workflow.length,content:Buffer.from(workflow).toString("base64")});
   if(url.includes("/commits/"))return json({sha:base,tree:{sha:tree},parents:[],message:"base"});
   if(url.includes("/trees/"))return json({sha:tree,truncated:false,tree:[{path:"server",type:"tree",mode:"040000",sha:"c".repeat(40)},{path:"tests",type:"tree",mode:"040000",sha:"d".repeat(40)},...Object.entries(files).map(([path,text])=>({path,type:"blob",mode:"100644",sha:hash(text),size:Buffer.byteLength(text)}))]});
   const sha=url.split("/").pop()!,entry=Object.entries(files).find(([,t])=>hash(t)===sha)!;fetched.push(entry[0]);
   return json({sha,encoding:"base64",size:Buffer.byteLength(entry[1]),content:Buffer.from(entry[1]).toString("base64")});
  },...extra} as any);
 const state=(sourcePaths:unknown,repairAttempts=0)=>({version:1,projectId:"asistente",rootJobId:"root",repairAttempts,finding:{baseSha:base,request:"Fix search",sourcePaths}} as FactoryPipelineState);
 return {make,state,fetched,project:{id:"asistente",repo} as FactoryProject,counts:()=>({credit,model,github})};
}

test("build exports only the persisted per-order selection, including on repair replays",async()=>{
 const f=scopedFixture(),build=f.make();
 for(const attempt of [0,1]){f.fetched.length=0;
  const result=await build(f.project,f.state(["server/agent-search.ts","tests/agent-search.test.ts"],attempt),{signal:new AbortController().signal,maxCostCents:1});
  assert.ok("status" in result);assert.deepEqual(f.fetched.sort(),["server/agent-search.ts","tests/agent-search.test.ts"]);}
 assert.equal(f.counts().model,0);
});

test("missing, denied, traversal or oversized persisted selections block before GitHub or credit",async()=>{
 const f=scopedFixture(),build=f.make();
 for(const paths of [undefined,[],["package.json"],[".github/workflows/x.yml"],["server/../package.json"],["server/.env"],["docs/x.md"],Array.from({length:7},(_,i)=>`server/f${i}.ts`)]){
  const result=await build(f.project,f.state(paths),{signal:new AbortController().signal,maxCostCents:1});
  assert.deepEqual(result,{status:"blocked",costCents:0,reason:"FACTORY_ASISTENTE_PATHS_INVALID"},JSON.stringify(paths));
 }
 const narrowed=f.make({writeRoots:["tests/"]});
 assert.equal((await narrowed(f.project,f.state(["server/agent-search.ts"]),{signal:new AbortController().signal,maxCostCents:1}) as any).reason,"FACTORY_ASISTENTE_PATHS_INVALID");
 assert.deepEqual(f.counts(),{credit:0,model:0,github:0});
 assert.throws(()=>f.make({maxFilesPerOrder:9}));assert.throws(()=>f.make({writeRoots:[".claude/"]}));
 assert.throws(()=>f.make({dailyDraftLimit:{maxPerDay:11,countToday:async()=>0}}));
});

test("daily draft PR cap defers the sixth build to the next UTC day with zero cost",async()=>{
 const f=scopedFixture();let seen:Date|undefined;
 const capped=f.make({dailyDraftLimit:{maxPerDay:5,countToday:async(now:Date)=>{seen=now;return 5;}}});
 const result=await capped(f.project,f.state(["server/agent-search.ts"]),{signal:new AbortController().signal,maxCostCents:1});
 assert.deepEqual(result,{status:"blocked",costCents:0,reason:"FACTORY_DAILY_DRAFT_PR_LIMIT",deferUntil:"2026-11-08T00:00:00.000Z"});
 assert.equal(seen?.toISOString(),"2026-11-07T10:00:00.000Z");
 const unavailable=f.make({dailyDraftLimit:{maxPerDay:5,countToday:async()=>{throw Error("STORE_DOWN");}}});
 assert.deepEqual(await unavailable(f.project,f.state(["server/agent-search.ts"]),{signal:new AbortController().signal,maxCostCents:1}),{status:"blocked",costCents:0,reason:"FACTORY_DAILY_DRAFT_PR_COUNT_UNAVAILABLE",deferUntil:"2026-11-07T11:00:00.000Z"});
 assert.deepEqual(f.counts(),{credit:0,model:0,github:0});
 const fifth=f.make({dailyDraftLimit:{maxPerDay:5,countToday:async()=>4}});
 await fifth(f.project,f.state(["server/agent-search.ts"]),{signal:new AbortController().signal,maxCostCents:1});
 assert.ok(f.counts().github>0);
});
