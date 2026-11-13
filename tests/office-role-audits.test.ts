import test from "node:test";
import assert from "node:assert/strict";
import {auditSavedRole} from "../server/office-role-audits";
import {sourceDigest,validateRoleSnapshot,PENDING_OFFICE_ROLES,type SqlAuditRole,type RoleSnapshot} from "../server/office-role-snapshots";
const now=Date.parse("2026-11-07T01:00:00Z");
function snap(role:SqlAuditRole,rows:any[],total=rows.length):RoleSnapshot{const body={version:1 as const,role,ownerKey:sourceDigest("owner"),observedAt:new Date(now).toISOString(),total,rows};return {...body,sourceDigest:sourceDigest(body)};}
test("exact production unsupported inventory and explicit external blocks",()=>{
 assert.equal(PENDING_OFFICE_ROLES.length,14);for(const role of ["news","news:ny-news","news:miami-news","blackroom-videos","code","github","marketing-cmo","clippers","dropshipping"] as const){const r=auditSavedRole(role,undefined,"owner",now);assert.equal(r.status,"blocked");assert.equal(r.total,null);assert.equal(r.findings[0].code,"CAPABILITY_UNAVAILABLE");}
});
test("owner, digest, freshness and coverage fail closed",()=>{
 const source=snap("portfolio",[{id:"p",symbol:"A",currency:"USD",quantity:"2",avgBuyPrice:"3"}]);
 assert.throws(()=>validateRoleSnapshot(source,"other",now));assert.throws(()=>validateRoleSnapshot(source,"owner",now+300001));assert.throws(()=>validateRoleSnapshot(source,"owner",now-30001));
 const changed=structuredClone(source);changed.rows[0].quantity="999";assert.throws(()=>validateRoleSnapshot(changed,"owner",now));
 assert.throws(()=>validateRoleSnapshot(snap("portfolio",source.rows,201),"owner",now));
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
 assert.equal(validateRoleSnapshot(reorder(source),"owner",now).sourceDigest,source.sourceDigest);
 assert.equal(auditSavedRole("portfolio",snap("portfolio",[]),"owner",now).status,"blocked");
});
test("portfolio computes cost basis per currency only and rejects malformed values",()=>{
 const rows=[{id:"1",symbol:"A",currency:"USD",quantity:"2",avgBuyPrice:"3"},{id:"2",symbol:"B",currency:"EUR",quantity:"4",avgBuyPrice:"5"}];
 const r=auditSavedRole("portfolio",snap("portfolio",rows),"owner",now);assert.deepEqual(r.metrics,{"costBasis:USD":6,"costBasis:EUR":20});assert.equal(r.findings[0].code,"MARKET_VALUE_UNVERIFIED");
 assert.equal(auditSavedRole("portfolio",snap("portfolio",[{...rows[0],quantity:"-2"}]),"owner",now).status,"blocked");
 const partial=auditSavedRole("portfolio",snap("portfolio",Array.from({length:200},(_,i)=>({...rows[0],id:String(i)})),250),"owner",now);assert.equal(partial.completeCoverage,false);assert.equal(partial.total,250);
});
test("control identifies conflicting scopes and high-risk autonomy",()=>{
 const row={id:"1",scope:"publish",level:"autonomous",risk:"high",enabled:true};const r=auditSavedRole("control",snap("control",[row,{...row,id:"2",level:"read_only"}]),"owner",now);
 assert.equal(r.metrics.enabledPermissions,2);assert.deepEqual(r.findings.map(f=>f.code),["HIGH_RISK_AUTONOMY","DUPLICATE_SCOPE"]);
 for(const bad of [{...row,level:"unknown"},{...row,risk:"unknown"}])assert.throws(()=>auditSavedRole("control",snap("control",[bad]),"owner",now));
});
test("automation differentiates consumed schedule from unconsumed past schedule without running tasks",()=>{
 const row={id:"1",status:"active",failureCount:2,nextRunAt:new Date(now-1000).toISOString(),lastRunAt:new Date(now).toISOString(),lastStatus:"failed",requiresApproval:true,level:"execute_after_approval"};
 const r=auditSavedRole("automations",snap("automations",[row]),"owner",now);assert.ok(r.findings.some(f=>f.code==="SCHEDULE_UNVERIFIED"));assert.ok(!r.findings.some(f=>f.code==="SAVED_RUN_TIME_PASSED"));
 for(const bad of [{...row,status:"unknown"},{...row,lastStatus:"running"},{...row,level:"unknown"}])assert.throws(()=>auditSavedRole("automations",snap("automations",[bad]),"owner",now));
});
test("revenue separates bookings, collected income and expenses, no fabricated profit",()=>{
 const row={id:"1",kind:"retainer",amountUsd:100,cashCollectedUsd:50,estimatedInternalCostUsd:10,updatedAt:new Date(now).toISOString()};
 const r=auditSavedRole("revenue",snap("revenue",[row,{...row,id:"2",kind:"expense",amountUsd:20}]),"owner",now);assert.deepEqual(r.metrics,{bookedIncomeUsd:100,collectedIncomeUsd:50,recordedExpensesUsd:20,uncollectedRecordedIncomeUsd:50});
 assert.equal(auditSavedRole("revenue",snap("revenue",[{...row,kind:"invented"}]),"owner",now).status,"blocked");
});
test("legal records concrete traceability gaps without certifying compliance",()=>{
 const r=auditSavedRole("legal",snap("legal",[{id:"a",name:"App",publicUrl:null,repoOwner:null,repoName:null,environment:"production"}]),"owner",now);assert.equal(r.findings.length,3);assert.equal(r.metrics.projectsInventoried,1);assert.match(r.scope,/no acredita/);
});
