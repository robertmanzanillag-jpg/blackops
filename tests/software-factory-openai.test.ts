import test from "node:test";
import assert from "node:assert/strict";
import {createOpenAiFactoryTextProvider} from "../server/software-factory-openai";
const model="fixture-model-2026-11-01";
const config={model,inputNanoUsdPerToken:1000,outputNanoUsdPerToken:4000,pricingValidUntil:"2026-12-01T00:00:00Z",now:()=>new Date("2026-11-06T00:00:00Z"),maxInputTokens:10000};
const input=()=>({instructions:"Review synthetic code",text:"fixture",maxOutputTokens:100,maxCostCents:1,signal:new AbortController().signal});
const json=(value:unknown)=>new Response(JSON.stringify(value));
const count=()=>json({object:"response.input_tokens",input_tokens:100});
const result=()=>({object:"response",model,status:"completed",error:null,incomplete_details:null,usage:{input_tokens:100,output_tokens:20,total_tokens:120},output:[{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:"verified text"}]}]});
test("counts identical prompt before bounded stateless generation and rounds cost upward",async()=>{
 const calls:{url:string;body:any}[]=[];
 const generate=createOpenAiFactoryTextProvider({...config,request:async(url,init)=>{assert.equal(init.redirect,"error");calls.push({url,body:JSON.parse(String(init.body))});return calls.length===1?count():json(result());}});
 assert.deepEqual(await generate(input()),{status:"completed",text:"verified text",costCents:1,inputTokens:100,outputTokens:20});
 assert.deepEqual(calls.map(c=>c.url),["https://api.openai.com/v1/responses/input_tokens","https://api.openai.com/v1/responses"]);
 assert.deepEqual(calls[0].body,{model,instructions:"Review synthetic code",input:"fixture"});
 assert.deepEqual(calls[1].body,{...calls[0].body,max_output_tokens:100,store:false,tools:[],stream:false,background:false,service_tier:"default",truncation:"disabled"});
});
test("worst-case output reservation blocks generation even when likely output is cheap",async()=>{
 let calls=0;const generate=createOpenAiFactoryTextProvider({...config,outputNanoUsdPerToken:1000000,request:async()=>{calls++;return count();}});
 assert.equal((await generate(input())).status,"blocked");assert.equal(calls,1);
});
test("expired pricing, aliases and cancelled work cannot generate",async()=>{
 let calls=0;const request=async()=>{calls++;return count();};
 assert.throws(()=>createOpenAiFactoryTextProvider({...config,request,model:"rolling-alias"}),/CONFIGURATION/);
 assert.throws(()=>createOpenAiFactoryTextProvider({...config,request,inputNanoUsdPerToken:0}),/CONFIGURATION/);
 assert.equal((await createOpenAiFactoryTextProvider({...config,request,pricingValidUntil:"2020-01-01"})(input())).status,"blocked");
 const c=new AbortController();c.abort();assert.equal((await createOpenAiFactoryTextProvider({...config,request})({...input(),signal:c.signal})).status,"blocked");assert.equal(calls,0);
});

test("documented undated Astra snapshot retains exact identity and all budget gates",async()=>{
 for(const responseModel of ["gpt-6-astra","gpt-6-astra-latest"]){
  let calls=0;const generate=createOpenAiFactoryTextProvider({...config,model:"gpt-6-astra",request:async(_url,init)=>{
   assert.equal(JSON.parse(String(init.body)).model,"gpt-6-astra");return ++calls===1?count():json({...result(),model:responseModel});
  }});
  assert.equal((await generate(input())).status,responseModel==="gpt-6-astra"?"completed":"unknown");assert.equal(calls,2);
 }
 for(const alias of ["gpt-6-astra-latest","gpt-6.1-sol","gpt-4.1"]){
  assert.throws(()=>createOpenAiFactoryTextProvider({...config,model:alias,request:async()=>count()}),/CONFIGURATION/);
 }
 let calls=0;const capped=createOpenAiFactoryTextProvider({...config,model:"gpt-6-astra",outputNanoUsdPerToken:1000000,request:async()=>{calls++;return count();}});
 assert.equal((await capped(input())).status,"blocked");assert.equal(calls,1);
});
test("missing usage, changed model, exceeded cap and ambiguous HTTP never become success or retry",async()=>{
 for(const response of [()=>json({...result(),status:"in_progress"}),()=>json({...result(),usage:null}),()=>json({...result(),model:"other"}),()=>json({...result(),usage:{input_tokens:101,output_tokens:20,total_tokens:121}}),()=>json({...result(),usage:{input_tokens:100,output_tokens:101,total_tokens:201}}),()=>new Response("private provider error",{status:503}),()=>{throw Error("lost acknowledgment");}]){
  let calls=0;const generate=createOpenAiFactoryTextProvider({...config,request:async()=>++calls===1?count():response()});
  const outcome=await generate(input());assert.deepEqual(outcome,{status:"unknown",reason:"FACTORY_OPENAI_EXECUTION_UNCONFIRMED",costCents:0});assert.equal(calls,2);
 }
});
test("known incomplete and refusal outcomes preserve nonzero cost",async()=>{
 for(const response of [{...result(),status:"incomplete",incomplete_details:{reason:"max_output_tokens"}},{...result(),output:[{type:"message",role:"assistant",status:"completed",content:[{type:"refusal",refusal:"no"}]}]}]){
  let calls=0;const generate=createOpenAiFactoryTextProvider({...config,request:async()=>++calls===1?count():json(response)});
  const outcome=await generate(input());assert.equal(outcome.status,"failed");assert.equal(outcome.costCents,1);
 }
});
test("malformed count blocks paid call; oversized paid response retains unknown reservation",async()=>{
 let calls=0;let generate=createOpenAiFactoryTextProvider({...config,request:async()=>{calls++;return json({input_tokens:100});}});
 assert.equal((await generate(input())).status,"blocked");assert.equal(calls,1);
 calls=0;generate=createOpenAiFactoryTextProvider({...config,maxResponseBytes:20,request:async()=>++calls===1?count():json(result())});
 assert.equal((await generate(input())).status,"unknown");assert.equal(calls,2);
});
test("timeout after submission is unknown and cancellation between calls prevents generation",async()=>{
 let calls=0;const generate=createOpenAiFactoryTextProvider({...config,timeoutMs:10,request:async(_url,init)=>{calls++;if(calls===1)return count();return new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener("abort",()=>reject(Error("aborted")),{once:true}));}});
 assert.equal((await generate(input())).status,"unknown");assert.equal(calls,2);
 const controller=new AbortController();calls=0;
 const cancel=createOpenAiFactoryTextProvider({...config,request:async()=>{calls++;controller.abort();return count();}});
 assert.equal((await cancel({...input(),signal:controller.signal})).status,"blocked");assert.equal(calls,1);
});


test("terminal diagnostics are static and never include provider error details",async()=>{
 for(const [status,details,expected] of [
  ["incomplete",{reason:"max_output_tokens"},"FACTORY_OPENAI_OUTPUT_LIMIT"],
  ["incomplete",{reason:"PRIVATE_DETAIL"},"FACTORY_OPENAI_INCOMPLETE"],
  ["failed",null,"FACTORY_OPENAI_RESPONSE_FAILED"],
  ["cancelled",null,"FACTORY_OPENAI_RESPONSE_CANCELLED"],
 ] as const){
  let calls=0;const generate=createOpenAiFactoryTextProvider({...config,request:async()=>++calls===1?count():json({...result(),status,incomplete_details:details,error:{message:"PRIVATE_DETAIL"}})});
  const outcome=await generate(input());assert.equal(outcome.status,"failed");assert.equal(outcome.costCents,1);
  assert.equal("reason" in outcome && outcome.reason,expected);assert.ok(!JSON.stringify(outcome).includes("PRIVATE_DETAIL"));
 }
});


test("explicit Astra low reasoning preserves exact count and the 81-cent maximum output admission",async()=>{
 const calls:any[]=[];
 const settings={...config,model:"gpt-6-astra",reasoningEffort:"low" as const,maxInputTokens:32000,inputNanoUsdPerToken:12500,outputNanoUsdPerToken:50000};
 const generate=createOpenAiFactoryTextProvider({...settings,request:async(url,init)=>{const body=JSON.parse(String(init.body));calls.push(body);if(url.endsWith("/input_tokens")){assert.deepEqual(body.reasoning,{effort:"low"});return json({object:"response.input_tokens",input_tokens:32000});}assert.deepEqual(body.reasoning,{effort:"low"});assert.equal(body.max_output_tokens,8192);return json({...result(),model:settings.model,usage:{input_tokens:32000,output_tokens:8192,total_tokens:40192}});}});
 const bounded={...input(),maxOutputTokens:8192,maxCostCents:81};
 const completed=await generate(bounded);assert.equal(completed.status,"completed");assert.equal(completed.costCents,81);assert.equal(calls.length,2);
 calls.length=0;assert.equal((await generate({...bounded,maxCostCents:80})).status,"blocked");assert.equal(calls.length,1);
 assert.throws(()=>createOpenAiFactoryTextProvider({...settings,model,request:async()=>count()}),/CONFIGURATION/);
 assert.throws(()=>createOpenAiFactoryTextProvider({...settings,reasoningEffort:"high" as any,request:async()=>count()}),/CONFIGURATION/);
});
