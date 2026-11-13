import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readRoleSnapshot,revenueDurableOwnerKey,SQL_AUDIT_ROLES} from "../server/office-role-snapshots";
test("every audit read binds canonical owner, projects safe fields and closes transaction",async()=>{
 for(const role of SQL_AUDIT_ROLES){const queries:Array<{sql:string,args?:unknown[]}>=[];let released=false;const pool={connect:async()=>({query:async(sql:string,args?:unknown[])=>{queries.push({sql,args});return {rows:sql.startsWith("SELECT id FROM users")?[{id:"owner"}]:sql.includes("clock_timestamp")?[{observed:new Date("2026-11-07T01:00:00Z")}]:[]};},release:()=>{released=true;}})};
 const source=await readRoleSnapshot(pool,"owner",role);assert.equal(source.total,0);assert.equal(released,true);assert.ok(queries.some(q=>q.sql.includes("READ ONLY")));assert.equal(queries.at(-1)!.sql,"COMMIT");
 for(const q of queries.filter(q=>q.sql.startsWith("SELECT")&&!q.sql.includes("clock_timestamp"))){assert.deepEqual(q.args,[role==="revenue"&&q.sql.includes("revenue_engine_state")?revenueDurableOwnerKey("owner"):"owner"]);assert.match(q.sql,/\$1/);assert.ok(!/SELECT \*|oauth|secret|notes|clientName/i.test(q.sql));}
 }
});
test("foreign owner or invalid database rows rollback and never masquerade as empty",async()=>{
 for(const wrongIdentity of [true,false]){let rollback=false,released=false;const pool={connect:async()=>({query:async(sql:string)=>{if(sql==="ROLLBACK")rollback=true;return {rows:sql.startsWith("SELECT id FROM users")?[{id:wrongIdentity?"other":"owner"}]:sql.includes("FROM investments")?[{id:"bad",total:1}]:[]};},release:()=>{released=true;}})};await assert.rejects(()=>readRoleSnapshot(pool,"owner","portfolio"));assert.equal(rollback,true);assert.equal(released,true);}
});

test("revenue ledger is read under the Revenue Engine durable owner key, not the raw user id",async()=>{
 const expected=`rev_${createHash("sha256").update("owner").digest("hex")}`;
 assert.equal(revenueDurableOwnerKey("owner"),expected);assert.equal(revenueDurableOwnerKey("  owner "),expected);assert.throws(()=>revenueDurableOwnerKey(" "));
 const row={id:"l1",kind:"website_sale",amountUsd:100,cashCollectedUsd:50,estimatedInternalCostUsd:5,updatedAt:"2026-11-07T00:59:00.000Z"};
 const pool={connect:async()=>({query:async(sql:string,args?:unknown[])=>({rows:sql.startsWith("SELECT id FROM users")?(args?.[0]==="owner"?[{id:"owner"}]:[]):sql.includes("clock_timestamp")?[{observed:new Date("2026-11-07T01:00:00Z")}]:sql.includes("revenue_engine_state")&&args?.[0]===expected?[{...row,total:1}]:[]}),release:()=>{}})};
 const source=await readRoleSnapshot(pool,"owner","revenue");assert.equal(source.total,1);assert.equal(source.rows.length,1);assert.equal((source.rows[0] as any).id,"l1");
});
