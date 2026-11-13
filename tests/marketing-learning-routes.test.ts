import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {registerMarketingLearningRoutes} from "../server/marketing-learning-routes";
import {getCurrentUserId} from "../server/user-context";
import {z} from "zod";
test("marketing routes require request auth, never system owner, are no-store and redact failures",async t=>{
 const app=express();app.use(express.json());let called:string[]=[],corrupt=false;
 // Only this isolated fixture populates authenticated identity. No dev fallback.
 app.use((req,_res,next)=>{if(req.header("test-auth")==="a")(req as any).user={id:"a"};next();});
 registerMarketingLearningRoutes(app,{owner:getCurrentUserId,get:async owner=>{called.push(owner);if(corrupt)z.array(z.string()).parse({bad:true});return {ok:true} as any;},prepare:async(owner,input)=>{called.push(owner);if((input as any).focusClientId==="bad")throw Error("MARKETING_CLIENT_UNKNOWN");throw Error("SECRET_DATABASE_DETAIL");}});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/marketing-command-center`;
 const denied=await fetch(url);assert.equal(denied.status,401);assert.equal(denied.headers.get("cache-control"),"no-store");assert.equal(called.length,0);
 const get=await fetch(url,{headers:{"test-auth":"a"}});assert.equal(get.status,200);assert.equal(get.headers.get("cache-control"),"no-store");assert.deepEqual(called,["a"]);
 corrupt=true;const damaged=await fetch(url,{headers:{"test-auth":"a"}});assert.equal(damaged.status,503);assert.equal(damaged.headers.get("cache-control"),"no-store");assert.ok(!(await damaged.text()).includes("Zod"));
 for(const [input,status] of [[{focusClientId:"bad"},400],[{},503]] as const){const response=await fetch(`${url}/run-day`,{method:"POST",headers:{"test-auth":"a","content-type":"application/json"},body:JSON.stringify(input)});assert.equal(response.status,status);assert.equal(response.headers.get("cache-control"),"no-store");assert.ok(!(await response.text()).includes("SECRET"));}
});
