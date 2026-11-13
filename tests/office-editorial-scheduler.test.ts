import test from "node:test";
import assert from "node:assert/strict";
import {createEditorialExportCycle,officeEditorialSourceStatus} from "../server/office-editorial-scheduler";
import {createWebSourceExportCycle} from "../server/office-web-source-scheduler";
import type {EditorialSource} from "../server/office-editorial-source";
test("editorial export serializes reads and stop prevents a pending source from being persisted",async()=>{
 let release!:(source:EditorialSource)=>void,reads=0,writes=0;
 const cycle=createEditorialExportCycle({read:()=>{reads++;return new Promise(r=>release=r);},persist:async()=>{writes++;}});
 const pending=cycle.tick();assert.equal(await cycle.tick(),false);assert.equal(reads,1);cycle.stop();release({status:"available"} as EditorialSource);
 assert.equal(await pending,false);assert.equal(writes,0);assert.equal(await cycle.tick(),false);
});
test("editorial source failure remains isolated, redacted and cannot report ready",async()=>{
 let oldExports=0;
 const cycle=createEditorialExportCycle({read:async()=>{throw Error("private path and contents");},persist:async()=>{throw Error("unexpected write");}});
 assert.equal(await cycle.tick(),false);assert.equal(officeEditorialSourceStatus().status,"unavailable");assert.ok(!JSON.stringify(officeEditorialSourceStatus()).includes("private"));
 const existing=createWebSourceExportCycle({read:async()=>[],persist:async()=>{oldExports++;}});
 assert.equal(await existing.tick(),true);assert.equal(oldExports,1);
 const missing=createEditorialExportCycle({read:async()=>({status:"missing"} as EditorialSource),persist:async()=>{},now:()=>0});
 assert.equal(await missing.tick(),true);assert.equal(officeEditorialSourceStatus().status,"unavailable");assert.equal(officeEditorialSourceStatus().lastExportAt,"1970-01-01T00:00:00.000Z");
});
