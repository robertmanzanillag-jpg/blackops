import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createFactoryCompanyOrderScheduler} from "../server/software-factory-company-scheduler";
import {createSoftwareFactoryWorker} from "../server/software-factory-worker";
import {createSharedOpenAiCreditLedger, type SharedCreditState, type CreditTransaction} from "../server/shared-openai-credit-ledger";
import type {CompanyOrder} from "../shared/agent-company";
import type {FactoryProject} from "../server/software-factory";
import type {FactoryJob,FactoryJobInput} from "../server/software-factory-store";
const owner="main-owner", ownerKey=createHash("sha256").update(owner).digest("hex");
const project={id:"asistente",repo:"robertmanzanillag-jpg/blackops"} as FactoryProject;
const order=(id:string):CompanyOrder=>({id,text:"Improve agent search",createdAt:"2026-11-06T12:00:00Z",assignees:[{agentId:"code",status:"en_curso",note:""}]});
async function fixture(){
 let state:SharedCreditState={version:1,grant:null,lastObservedAt:null,reservations:[]};
 const transact:CreditTransaction=async change=>{const copy=structuredClone(state),result=change(copy);state=copy;return result;};
 let now=new Date("2026-11-06T12:00:00Z");
 const ledger=createSharedOpenAiCreditLedger({transact,now:()=>now,maximumGrantObservationAgeMs:60000,grant:{id:"grant",accountScope:"shared-account",availableMicroUsd:100000,observedAt:now.toISOString(),expiresAt:"2026-11-07T00:00:00Z",verificationEvidenceId:"operator-proof"}});
 await ledger.initialize();
 const admissions:FactoryJobInput[]=[];
 const receipt=(input:FactoryJobInput,status="pending")=>({...input,ownerKey,status}) as FactoryJob;
 const make=(orders:CompanyOrder[],admit: (owner:string,input:FactoryJobInput)=>Promise<FactoryJob>=async(o,i)=>{assert.equal(o,owner);admissions.push(i);return receipt(i);})=>createFactoryCompanyOrderScheduler({owner,project:async()=>project,readOrders:async o=>{assert.equal(o,owner);return orders;},ledger,reservationCents:2,admit});
 return {ledger,admissions,receipt,make,expire:()=>{now=new Date("2026-11-08T00:00:00Z");}};
}
test("scheduler consults shared Office/factory balance and blocks expired or uncertain credit",async()=>{
 for(const mode of ["spent","unknown","expired"]){const f=await fixture();
  if(mode==="expired")f.expire();else{await f.ledger.reserve({key:"office-call",consumer:"office",maximumMicroUsd:90000,requestSha256:"a".repeat(64)});if(mode==="unknown")await f.ledger.markUnknown("office-call","lost-receipt");}
  await assert.rejects(f.make([order("a")])(owner),/CREDIT_UNAVAILABLE/);assert.equal(f.admissions.length,0);
 }
});
test("owner and eligibility filters exclude Kong and non-engineering orders",async()=>{
 const f=await fixture(),valid=order("valid"),closed={...order("closed"),doneAt:"2026-11-06T12:00:00Z"};
 const scan=f.make([{...order("kong"),text:"Improve Kong"},{...order("marketing"),assignees:[{agentId:"marketing-cmo",status:"en_curso",note:""}]},closed,valid]);
 await assert.rejects(scan("another-owner"),/OWNER_MISMATCH/);await scan(owner);
 assert.equal(f.admissions.length,1);assert.equal((f.admissions[0].payload!.companyOrder as any).orderId,"valid");assert.doesNotMatch(JSON.stringify(f.admissions),/Improve agent search/);
});
test("overlapping scans coalesce and restarted scans retain durable admission keys",async()=>{
 const f=await fixture();let unblock!:()=>void;const wait=new Promise<void>(resolve=>{unblock=resolve;});let calls=0;const keys:string[]=[];
 const admit=async(_o:string,i:FactoryJobInput)=>{calls++;keys.push(i.key);await wait;return f.receipt(i);};
 const scan=f.make([order("a")],admit),first=scan(owner),second=scan(owner);unblock();await Promise.all([first,second]);assert.equal(calls,1);
 await f.make([order("a")],admit)(owner);assert.equal(calls,2);assert.equal(keys[0],keys[1]);
});
test("settled orders advance, but unknown receipts and lost acknowledgments stop the scan",async()=>{
 for(const status of ["completed","failed","blocked","unknown","lost"]){const f=await fixture();const seen:string[]=[];
  const scan=f.make([order("a"),order("b")],async(_o,i)=>{const id=(i.payload!.companyOrder as any).orderId;seen.push(id);if(id==="a"&&status==="lost")throw Error("LOST_ACK");return f.receipt(i,id==="a"?status:"pending");});
  if(["unknown","lost"].includes(status)){await assert.rejects(scan(owner));assert.deepEqual(seen,["a"]);}else{await scan(owner);assert.deepEqual(seen,["a","b"]);}
 }
});
test("admission identity cannot cross owner, project, key or kind",async()=>{
 for(const change of [{ownerKey:"foreign"},{projectId:"other"},{key:"other"},{kind:"build"}]){const f=await fixture();await assert.rejects(f.make([order("a")],async(_o,i)=>({...f.receipt(i),...change}) as FactoryJob)(owner),/ADMISSION_UNVERIFIED/);}
});
test("company worker respects pause and configuration without falling back to daily work",async()=>{
 for(const state of [{paused:true,configured:true},{paused:false,configured:false},{paused:false,configured:true}]){let hooks=0,statusCalls=0;
  const store=new Proxy({status:async(o:string)=>{assert.equal(o,owner);statusCalls++;return state;}},{get(target,key){if(key in target)return target[key as keyof typeof target];return ()=>{throw Error("DAILY_OR_OTHER_STORE_ACCESS");};}}) as any;
  await createSoftwareFactoryWorker({store,scheduleOwner:owner,discoveryMode:"company-orders-only",scheduleCompanyOrders:async o=>{assert.equal(o,owner);hooks++;}}).schedule();
  assert.equal(statusCalls,1);assert.equal(hooks,!state.paused&&state.configured?1:0);
  await createSoftwareFactoryWorker({store,scheduleOwner:owner,discoveryMode:"company-orders-only"}).schedule();assert.equal(statusCalls,1);
 }
});
