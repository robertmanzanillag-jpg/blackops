import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {registerOfficeBusinessRoutes,readOfficeDeliverableAvailability} from "../server/office-business-routes";
import {createHash} from "node:crypto";
import type {BusinessWorkJob} from "../server/office-business-work";
test("availability reads only owner-scoped career admission fields and explains withheld work",async()=>{
 const rows=[{role:"automations",generation:2,battery:0,has_training:false,has_reconciliation:false},{role:"portfolio",generation:1,battery:100,has_training:false,has_reconciliation:false},{role:"news",generation:2,battery:80,training:2,has_training:true,has_reconciliation:false},{role:"revenue",generation:1,battery:26,has_training:false,has_reconciliation:true,reconciliation:{status:"needs_scope_qualification"}},{role:"news:ny-news",generation:1,battery:80,has_training:false,has_reconciliation:true,reconciliation:null},{role:"news:miami-news",generation:1,battery:80,has_training:true,training:null,has_reconciliation:false}];
 const roles=rows.map(r=>r.role),pool={query:async(sql:string,args:any[])=>{assert.ok(sql.startsWith("SELECT "));assert.deepEqual(args,[createHash('sha256').update('owner').digest('hex'),roles]);assert.ok(!sql.includes("memory"));return{rows};}};
 assert.deepEqual((await readOfficeDeliverableAvailability(pool,"owner",roles)).map(r=>[r.available,r.reason]),[[false,"depleted"],[true,"eligible_for_preparation"],[false,"training"],[false,"historical_score_unverified"],[false,"unverified"],[false,"training"]]);
 await assert.rejects(readOfficeDeliverableAvailability({query:async()=>({rows:[]})},"owner",roles),/UNAVAILABLE/);
});
test("business history requires authenticated canonical owner, is read-only and redacts failures",async t=>{
 const app=express();let reads=0,editorialReads=0,fail=false;let jobs:BusinessWorkJob[]=[];
 app.use((req,_res,next)=>{const id=req.header("fixture-owner");if(id)(req as any).user={id};next();});
 registerOfficeBusinessRoutes(app,{systemOwner:()=>"owner",read:async owner=>{assert.equal(owner,"owner");reads++;if(fail)throw Error("private database details");return{jobs};},readEditorial:async owner=>{assert.equal(owner,"owner");editorialReads++;if(fail)throw Error("private editorial details");return{jobs:jobs.map(j=>({...j,role:"news"}))};},now:()=>0});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/agents-office/business-work`;
 for(const [id,expected] of [[null,401],["other",403]] as const){const response=await fetch(url,{headers:id?{"fixture-owner":id}:{}});assert.equal(response.status,expected);assert.equal(response.headers.get("cache-control"),"no-store");}
 assert.equal(reads,0);
 const editorialUrl=url.replace("business-work","editorial-work");
 for(const [id,expected] of [[null,401],["other",403]] as const){const response=await fetch(editorialUrl,{headers:id?{"fixture-owner":id}:{}});assert.equal(response.status,expected);assert.equal(response.headers.get("cache-control"),"no-store");}
 assert.equal(editorialReads,0);
 const response=await fetch(url,{headers:{"fixture-owner":"owner"}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ownerId:"owner",checkedAt:"1970-01-01T00:00:00.000Z",jobs:[]});assert.equal(reads,1);
 const post=await fetch(url,{method:"POST",headers:{"fixture-owner":"owner"}});assert.equal(post.status,404);assert.equal(reads,1);
 jobs=[{id:"expired",role:"automations",generation:1,status:"running",slot:"1969-12-31",fence:"private-fence",startedAt:"1969-12-31T23:59:00.000Z",expiresAt:"1970-01-01T00:00:00.000Z"}];
 const expired=await(await fetch(url,{headers:{"fixture-owner":"owner"}})).json();assert.equal(expired.jobs[0].status,"unknown");assert.equal(expired.jobs[0].reason,"LEASE_EXPIRED");assert.equal(jobs[0].status,"running");assert.ok(!JSON.stringify(expired).includes("private-fence"));
 const editorial=await fetch(editorialUrl,{headers:{"fixture-owner":"owner"}});assert.equal(editorial.status,200);const editorialBody=await editorial.json();assert.equal(editorialBody.jobs[0].role,"news");assert.equal(editorialBody.jobs[0].status,"unknown");assert.ok(!JSON.stringify(editorialBody).includes("private-fence"));assert.equal(editorialReads,1);
 fail=true;const failed=await fetch(url,{headers:{"fixture-owner":"owner"}});assert.equal(failed.status,503);assert.equal(failed.headers.get("cache-control"),"no-store");assert.ok(!(await failed.text()).includes("private"));
 const editorialFailed=await fetch(editorialUrl,{headers:{"fixture-owner":"owner"}});assert.equal(editorialFailed.status,503);assert.equal(editorialFailed.headers.get("cache-control"),"no-store");assert.ok(!(await editorialFailed.text()).includes("private"));
});
test("Revenue previews expose completed HTML only to owner without source or admission side effects",async t=>{
 const app=express();let reads=0,failed=false,status="completed";
 app.use((req,_res,next)=>{const owner=req.header("fixture-owner");if(owner)(req as any).user={id:owner};next();});
 registerOfficeBusinessRoutes(app,{systemOwner:()=>"owner",readRevenue:async()=>{reads++;if(failed)throw Error("private prospect source");return{jobs:[{id:"preview",role:"revenue",generation:1,status,startedAt:"2026-11-07T00:00:00Z",expiresAt:"2026-11-07T00:01:00Z",artifact:{text:"Internal concept",html:"<h1>Internal concept</h1>"},source:{private:"source details"}}]};}});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/agents-office/revenue-work`;
 for(const [id,expected] of [[null,401],["other",403]] as const){const response=await fetch(url,{headers:id?{"fixture-owner":id}:{}});assert.equal(response.status,expected);assert.equal(response.headers.get("cache-control"),"no-store");}assert.equal(reads,0);
 const response=await fetch(url,{headers:{"fixture-owner":"owner"}});assert.equal(response.status,200);const body=await response.json();assert.equal(body.jobs[0].artifact.html,"<h1>Internal concept</h1>");assert.ok(!JSON.stringify(body).includes("source details"));
 status="blocked";const blocked=await(await fetch(url,{headers:{"fixture-owner":"owner"}})).json();assert.equal(blocked.jobs[0].artifact.html,undefined);
 failed=true;const failure=await fetch(url,{headers:{"fixture-owner":"owner"}});assert.equal(failure.status,503);assert.ok(!(await failure.text()).includes("private"));
 const count=reads;assert.equal((await fetch(url,{method:"POST",headers:{"fixture-owner":"owner"}})).status,404);assert.equal(reads,count);
});
