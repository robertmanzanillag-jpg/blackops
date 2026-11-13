import test from "node:test";
import assert from "node:assert/strict";
import {createWebSourceExportCycle,officeWebSourceStatus,warmOfficeWebSources} from "../server/office-web-source-scheduler";
test("export cycle is bounded to one local read and persists before reporting ready",async()=>{
 let reads=0,writes=0,release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);
 const cycle=createWebSourceExportCycle({read:async()=>{reads++;await wait;return [];},persist:async()=>{writes++;}});
 const first=cycle.tick();assert.equal(await cycle.tick(),false);assert.equal(writes,0);release();assert.equal(await first,true);assert.equal(reads,1);assert.equal(writes,1);assert.equal(officeWebSourceStatus().status,"ready");cycle.stop();assert.equal(await cycle.tick(),false);
});
test("failed persistence does not claim a new export or expose raw errors",async()=>{
 const before=officeWebSourceStatus().lastExportAt;const cycle=createWebSourceExportCycle({read:async()=>[],persist:async()=>{throw Error("PRIVATE_DATABASE_DETAILS");}});assert.equal(await cycle.tick(),false);assert.equal(officeWebSourceStatus().lastExportAt,before);assert.equal(officeWebSourceStatus().status,"unavailable");assert.doesNotMatch(JSON.stringify(officeWebSourceStatus()),/PRIVATE/);
});
test("warming source host sends only bounded GET health and rejects alternate origins/redirects",async()=>{
 let calls=0;const fetcher=(async(url:any,init:any)=>{calls++;assert.equal(String(url),"https://office.example/api/health");assert.equal(init.redirect,"error");assert.equal(init.body,undefined);assert.equal(init.headers,undefined);return new Response(JSON.stringify({officeSources:{enabled:true,status:"ready",lastExportAt:new Date().toISOString()}}));}) as typeof fetch;
 await warmOfficeWebSources("https://office.example",fetcher);assert.equal(calls,1);
 for(const origin of ["http://office.example","https://user:pass@office.example","https://office.example/path"])await assert.rejects(()=>warmOfficeWebSources(origin,fetcher));assert.equal(calls,1);
 await assert.rejects(()=>warmOfficeWebSources("https://office.example",(async()=>new Response(JSON.stringify({officeSources:{enabled:false,status:"disabled"}}))) as typeof fetch),/EXPORT_UNAVAILABLE/);
});


test("health exposes only failure stage and allowlisted codes, then clears diagnostic on success",async()=>{
 for(const stage of ["read","persist"] as const)for(const [error,expected] of [[Error("Canonical owner absent"),"SOURCE_OWNER_ABSENT"],[Error("Invalid web source provenance"),"SOURCE_PROVENANCE_INVALID"],[Error("Connection terminated due to connection timeout"),"SOURCE_CONNECTION_TIMEOUT"],[Error("Canonical owner absent SECRET"),"UNVERIFIED_EXPORT"],[Object.assign(Error("SECRET"),{code:"42P01"}),"42P01"],[Object.assign(Error("SECRET"),{name:"ZodError"}),"INVALID_SOURCE_SCHEMA"],[Object.assign(Error("SECRET"),{code:"SECRET_CODE",name:"SECRET_NAME"}),"UNVERIFIED_EXPORT"]] as const){
  const cycle=createWebSourceExportCycle({read:async()=>{if(stage==="read")throw error;return [];},persist:async()=>{throw error;}});
  assert.equal(await cycle.tick(),false);const status=officeWebSourceStatus();assert.equal(status.failureStage,stage);assert.equal(status.failureCode,expected);assert.doesNotMatch(JSON.stringify(status),/SECRET/);
 }
 await createWebSourceExportCycle({read:async()=>[],persist:async()=>{}}).tick();assert.equal(officeWebSourceStatus().failureStage,undefined);assert.equal(officeWebSourceStatus().failureCode,undefined);
});
test("export cycle recovers from a cold-start connection timeout through the bounded retry pool",async()=>{
 const {withConnectionRetry}=await import("../server/office-source-pool");
 let attempts=0;const pool=withConnectionRetry({query:async()=>{attempts++;if(attempts<3)throw Error("Connection terminated due to connection timeout");return {rows:[]};}},{sleep:async()=>undefined});
 assert.equal(await createWebSourceExportCycle({read:async()=>{await pool.query("SELECT 1");return [];},persist:async()=>{}}).tick(),true);assert.equal(attempts,3);assert.equal(officeWebSourceStatus().status,"ready");
 const exhausted=withConnectionRetry({query:async()=>{throw Error("Connection terminated due to connection timeout");}},{sleep:async()=>undefined});
 assert.equal(await createWebSourceExportCycle({read:async()=>{await exhausted.query("SELECT 1");return [];},persist:async()=>{}}).tick(),false);assert.equal(officeWebSourceStatus().failureCode,"SOURCE_CONNECTION_TIMEOUT");
 const queued=withConnectionRetry({query:async()=>{throw Error("timeout exceeded when trying to connect");}},{sleep:async()=>undefined});
 assert.equal(await createWebSourceExportCycle({read:async()=>[],persist:async()=>{await queued.query("SELECT 1");}}).tick(),false);assert.equal(officeWebSourceStatus().failureStage,"persist");assert.equal(officeWebSourceStatus().failureCode,"SOURCE_POOL_TIMEOUT");
});
