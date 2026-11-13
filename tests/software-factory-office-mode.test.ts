import test from "node:test";
import assert from "node:assert/strict";
import {createSoftwareFactoryWorker} from "../server/software-factory-worker";
const sha="a".repeat(40);
function harness(kind:string){
 const results:any[]=[]; const heartbeats:any[]=[];
 const job={id:"j",ownerKey:"owner",projectId:"p",key:"k",kind,payload:{},headSha:sha,reservedCents:10,recoveryCents:0,month:"2026-11",status:"running",createdAt:new Date().toISOString(),workerId:"w",fence:"f",leaseExpiresAt:new Date(Date.now()+60000).toISOString()};
 return {results,heartbeats,store:{expire:async()=>0,claim:async()=>job,heartbeat:async(_id:string,c:any)=>heartbeats.push(c),complete:async(...args:any[])=>{results.push(args);return true;}} as any};
}
test("company-only mode never consults or admits daily discovery",async()=>{
 let calls=0;const store=new Proxy({}, {get(){return ()=>{calls++;throw Error("not allowed");};}}) as any;
 await createSoftwareFactoryWorker({store,scheduleOwner:"owner",discoveryMode:"company-orders-only",adapters:{discover:{execute:async()=>({status:"completed",costCents:0})}}}).schedule(); assert.equal(calls,0);
});
test("review-only stops before any staging or production enqueue and preserves review evidence",async()=>{
 const h=harness("review"); const evidence={pr:"https://github.com/o/r/pull/1",headSha:sha};
 const worker=createSoftwareFactoryWorker({store:h.store,releaseMode:"review-only",adapters:{review:{execute:async()=>({status:"completed",costCents:2,evidence,next:{kind:"deploy",key:"next",projectId:"p",headSha:sha,reservedCents:4}})},deploy:{execute:async()=>{throw Error("must not call");}}}});
 await worker.tick(); assert.equal(h.results[0][2],undefined); assert.deepEqual(h.results[0][1].evidence,evidence); assert.equal(h.results[0][1].reason,"FACTORY_PR_REVIEWED_NOT_DEPLOYED");assert.equal(h.heartbeats[0].deploy,false);
});
test("persisted release jobs cannot bypass review-only operator mode",async()=>{
 for(const kind of ["deploy","verify","rollback","evaluate"]){const h=harness(kind);let called=false;const worker=createSoftwareFactoryWorker({store:h.store,releaseMode:"review-only",adapters:{[kind]:{execute:async()=>{called=true;return {status:"completed",costCents:0};}}}});assert.equal((await worker.tick()).kind,"quarantined");assert.equal((await worker.tick()).kind,"quarantined");assert.equal(called,false);assert.equal(h.results.length,1);assert.equal(h.results[0][1].status,"unknown");assert.equal(h.results[0][1].reason,"FACTORY_RELEASE_REQUIRES_OPERATOR_RECONCILIATION");}
});
test("typos in mode configuration fail before any worker action",()=>{for(const option of [{releaseMode:"proposal-only"},{discoveryMode:"company-only"}])assert.throws(()=>createSoftwareFactoryWorker(option as any),/MODE_INVALID/);});
test("review-only still permits bounded repair instead of claiming a reviewed PR",async()=>{
 const h=harness("review");await createSoftwareFactoryWorker({store:h.store,releaseMode:"review-only",adapters:{review:{execute:async()=>({status:"completed",costCents:0,next:{kind:"build",key:"repair",projectId:"p",reservedCents:1}})}}}).tick();assert.equal(h.results[0][2].kind,"build");assert.equal(h.results[0][2].payload.repairAttempts,1);
});
