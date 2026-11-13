import test from "node:test";
import assert from "node:assert/strict";
import {createAgentCouncil,emptyCouncilState,setAgentCouncilUser,startAgentCouncilScheduler,systemUserId} from "../server/agent-council";
test("disabled web scheduler still reads durable state for configured owner without starting work",async()=>{
 const keys=["DEFAULT_USER_ID","AGENT_COUNCIL_ENABLED","ALLOW_DEV_USER_FALLBACK","NODE_ENV"];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  Object.assign(process.env,{DEFAULT_USER_ID:"configured-owner-fixture",AGENT_COUNCIL_ENABLED:"false",ALLOW_DEV_USER_FALLBACK:"false",NODE_ENV:"production"});
  await startAgentCouncilScheduler(); // Must not initialize a timer or require a scheduler-side setter.
  const state=emptyCouncilState();state.cycles=7;let reads=0,work=0;
  const council=createAgentCouncil({now:Date.now,userId:systemUserId,readState:async()=>{assert.equal(systemUserId(),"configured-owner-fixture");reads++;return JSON.stringify(state);},writeState:async()=>{throw new Error("No local writes");},transactState:async()=>{throw new Error("Read must not mutate");},collect:async()=>{work++;return {};},submitProposal:async()=>{throw new Error("No proposals");},getPendingActionStatus:async()=>null,fetchLatestRelease:async()=>null,log:()=>{}});
  assert.equal((await council.load()).cycles,7);assert.equal(reads,1);assert.equal(work,0);
  assert.throws(()=>setAgentCouncilUser("request-user"),/configured owner/);
  setAgentCouncilUser("configured-owner-fixture");
  delete process.env.DEFAULT_USER_ID;assert.throws(()=>systemUserId(),/DEFAULT_USER_ID/);
 }finally{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});
