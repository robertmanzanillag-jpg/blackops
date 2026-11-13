import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createFactoryOfficeConnection} from "../server/software-factory-office-connection";
function fixture(){
 let imports=0,admissions=0,reads=0;
 const store={} as any;
 const order={id:"o",text:"Fix filters",createdAt:new Date().toISOString(),assignees:[]};
 const config={enabled:true,modulePath:path.resolve("operator/factory.mjs")};
 let module:any={createFactoryOfficeAdmission:async(input:any)=>({owner:input.owner,store:input.store,reservationCents:1,admitWithinCredits:async(owner:string,job:any)=>{assert.equal(owner,"owner");admissions++;return {...job,id:"job"};}})};
 const resolve=createFactoryOfficeConnection({store,owner:()=>"owner",configuration:()=>config,readMainOrder:async(owner,id)=>{assert.equal(owner,"owner");reads++;return id==="o"?order:undefined;},loadModule:async()=>{imports++;return module;}});
 return {resolve,config,store,order,setModule:(value:any)=>module=value,counts:()=>({imports,admissions,reads})};
}
test("configured office connection binds the actual store, owner and protected council reader",async()=>{
 const f=fixture(),c=(await f.resolve())!;const read=await c.readMainOrder("owner","o");read!.text="mutated";assert.equal(f.order.text,"Fix filters");await c.admitWithinCredits("owner",{} as any);assert.equal(await f.resolve(),c);assert.deepEqual(f.counts(),{imports:1,admissions:1,reads:1});await assert.rejects(()=>c.readMainOrder("other","o"),/OWNER_MISMATCH/);await assert.rejects(()=>c.admitWithinCredits("other",{} as any),/OWNER_MISMATCH/);
});
test("disabled connection never loads providers or generic enqueue",async()=>{const f=fixture();f.config.enabled=false;assert.equal(await f.resolve(),undefined);assert.equal(f.counts().imports,0);});
test("missing or mismatched credit admission fails closed",async()=>{
 for(const module of [{},{createFactoryOfficeAdmission:async()=>({store:{},owner:"owner",reservationCents:1,admitWithinCredits:()=>{}})},{createFactoryOfficeAdmission:async()=>({store:{},owner:"other",reservationCents:1,admitWithinCredits:()=>{}})}]){const f=fixture();f.setModule(module);await assert.rejects(f.resolve);assert.equal(f.counts().admissions,0);}
 const f=fixture();f.config.modulePath="relative/untrusted.mjs";await assert.rejects(f.resolve,/MODULE_REQUIRED/);assert.equal(f.counts().imports,0);
});
