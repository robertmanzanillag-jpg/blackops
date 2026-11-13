import test from "node:test";
import assert from "node:assert/strict";
import {persistWebRoleSources,readStoredWebRoleSource,OFFICE_WEB_ROLE_SOURCE_SCHEMA_SQL} from "../server/office-web-role-store";
import {sourceDigest} from "../server/office-role-snapshots";
import type {WebRoleSource} from "../server/office-web-role-sources";
function source():WebRoleSource{const body={version:1 as const,ownerKey:sourceDigest("owner"),role:"news" as const,observedAt:"2026-11-07T01:00:00Z",rows:[],total:0,truncated:false,provenance:[{kind:"news_state" as const,status:"missing" as const,sourceAt:null,digest:null,records:0,files:0,empty:false}],diagnostics:["SOURCE_MISSING" as const]};return {...body,sourceDigest:sourceDigest(body)};}
test("PG exporter store binds owner, exports migration without running it, and refuses lost CAS",async()=>{
 const calls:any[]=[];const pool={query:async(sql:string,args?:unknown[])=>{calls.push({sql,args});return {rows:sql.includes("FROM users")?[{id:"owner"}]:sql.startsWith("INSERT")?[{role:"news"}]:[{source:source()}]};}};
 await persistWebRoleSources(pool,"owner","owner",[source()]);assert.equal((await readStoredWebRoleSource(pool,"owner","owner","news"))!.role,"news");assert.ok(OFFICE_WEB_ROLE_SOURCE_SCHEMA_SQL.includes("CREATE TABLE"));assert.ok(!calls.some(c=>c.sql.includes("CREATE TABLE")));assert.deepEqual(calls.find(c=>c.sql.startsWith("INSERT")).args.slice(0,2),[sourceDigest("owner"),"news"]);
 await assert.rejects(()=>persistWebRoleSources({query:async sql=>({rows:sql.includes("FROM users")?[{id:"owner"}]:[]})},"owner","owner",[source()]));
 await assert.rejects(()=>readStoredWebRoleSource(pool,"other","owner","news"));
});
