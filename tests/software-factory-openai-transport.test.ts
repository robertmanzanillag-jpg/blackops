import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createFactoryOpenAiTransport} from '../server/software-factory-openai-transport';
import {withFactoryApiParent} from '../server/factory-api-context';
import {fixtureFactoryInvocation} from './fixtures/factory-api-budget';
const model='synthetic-model',price={model,inputNanoUsdPerToken:400,outputNanoUsdPerToken:1600,validUntil:'2027-01-01T00:00:00.000Z',evidenceSha256:'a'.repeat(64)};
const parent=()=>({id:randomUUID(),fence:randomUUID(),status:'running',ownerKey:createHash('sha256').update('synthetic-owner').digest('hex')}) as any;
const body=()=>JSON.stringify({model,input:'synthetic requirements',max_output_tokens:32});
const output=()=>({id:'resp_synthetic',model,status:'completed',usage:{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:0}}});
test('model credential reaches only approved bounded Responses operation inside Factory escrow',async()=>{
 const job=parent(),key='sk-proj-'+'a'.repeat(50),signal=new AbortController().signal,calls:{url:string;init:RequestInit}[]=[];
 const request=createFactoryOpenAiTransport(key,(async(url,init)=>{calls.push({url:String(url),init:init!});return Response.json(output());}) as typeof fetch,{price,invoke:fixtureFactoryInvocation(undefined,job)});
 await withFactoryApiParent(job,()=>request('https://api.openai.com/v1/responses',{method:'POST',body:body(),signal,redirect:'follow',credentials:'include',headers:{Authorization:'untrusted',Cookie:'private','OpenAI-Project':'other','OpenAI-Organization':'other'}}));
 assert.equal(calls.length,1);const headers=new Headers(calls[0].init.headers);assert.equal(headers.get('Authorization'),`Bearer ${key}`);assert.equal(headers.get('Cookie'),null);assert.equal(headers.get('OpenAI-Project'),null);assert.equal(headers.get('OpenAI-Organization'),null);assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.signal?.aborted,false);
 await assert.rejects(withFactoryApiParent(job,()=>request('https://api.openai.com/v1/responses/input_tokens',{method:'POST',body:body(),signal})),/OPERATION_UNPRICED/);
 for(const url of ['https://example.com/v1/responses','http://api.openai.com/v1/responses','https://api.openai.com/v1/files','https://user@api.openai.com/v1/responses','https://api.openai.com/v1/responses?project=other','https://api.openai.com/v1/responses#secret','invalid'])await assert.rejects(request(url,{method:'POST',body:body(),signal}),/SCOPE_INVALID/);
 for(const init of [{method:'GET',body:body(),signal},{method:'POST',body:body()},{method:'POST',body:'x'.repeat(1048577),signal}])await assert.rejects(request('https://api.openai.com/v1/responses',init),/SCOPE_INVALID/);
 assert.equal(calls.length,1);
});
test('aborted or missing-parent calls make zero requests; dispatched error holds without retry/leak',async()=>{
 let calls=0;const job=parent(),request=createFactoryOpenAiTransport('sk-'+'b'.repeat(50),(async()=>{calls++;throw Error('sensitive provider detail');}) as typeof fetch,{price,invoke:fixtureFactoryInvocation(undefined,job)});
 await assert.rejects(request('https://api.openai.com/v1/responses',{method:'POST',body:body(),signal:AbortSignal.abort()}));assert.equal(calls,0);
 await assert.rejects(request('https://api.openai.com/v1/responses',{method:'POST',body:body(),signal:new AbortController().signal}),/PARENT_CONTEXT_UNAVAILABLE/);assert.equal(calls,0);
 await assert.rejects(withFactoryApiParent(job,()=>request('https://api.openai.com/v1/responses',{method:'POST',body:body(),signal:new AbortController().signal})),/^Error: FACTORY_API_EXECUTION_UNCONFIRMED$/);assert.equal(calls,1);
 await assert.rejects(withFactoryApiParent(job,()=>request('https://api.openai.com/v1/responses',{method:'POST',body:body(),signal:new AbortController().signal})),/UNKNOWN_HOLD/);assert.equal(calls,1);
});
test('Factory OpenAI path end to end: unbilled count transport + gated priced create with the provider\'s exact bodies',async()=>{
 const {createFactoryOpenAiCountTransport,routeFactoryOpenAiRequests}=await import('../server/software-factory-openai-count');
 const {createOpenAiFactoryTextProvider}=await import('../server/software-factory-openai');
 const job=parent(),key='sk-proj-'+'c'.repeat(50),calls:{url:string;init:RequestInit}[]=[];
 const raw=(async(url:string,init:RequestInit)=>{calls.push({url:String(url),init});return String(url).endsWith('/input_tokens')?Response.json({object:'response.input_tokens',input_tokens:10}):Response.json({...output(),model:'synthetic-model-2026-01-01',object:'response',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'ok'}]}],usage:{input_tokens:10,output_tokens:5,total_tokens:15,input_tokens_details:{cached_tokens:0}}});}) as typeof fetch;
 // The price must name the provider model for the gate.
 const gatedPrice={...price,model:'synthetic-model-2026-01-01'};
 const request2=routeFactoryOpenAiRequests(createFactoryOpenAiTransport(key,raw,{price:gatedPrice,invoke:fixtureFactoryInvocation(undefined,job)}),createFactoryOpenAiCountTransport(key,raw));
 const generate2=createOpenAiFactoryTextProvider({request:request2,model:'synthetic-model-2026-01-01',inputNanoUsdPerToken:400,outputNanoUsdPerToken:1600,pricingValidUntil:'2027-01-01T00:00:00.000Z',now:()=>new Date('2026-11-18T12:00:00.000Z'),maxInputTokens:1000});
 const result=await withFactoryApiParent(job,()=>generate2({instructions:'x',text:'synthetic requirements',maxOutputTokens:32,maxCostCents:5,signal:new AbortController().signal}));
 assert.equal(result.status,'completed');
 assert.equal(calls.length,2);assert.ok(calls[0].url.endsWith('/input_tokens'));assert.equal(new Headers(calls[0].init.headers).get('Authorization'),`Bearer ${key}`);assert.equal(calls[0].init.redirect,'error');
 // Count transport: parent-bound, prompt fields only.
 const count=createFactoryOpenAiCountTransport(key,raw),signal=new AbortController().signal,ok=JSON.stringify({model:'m',instructions:'x',input:'y'});
 await assert.rejects(count('https://api.openai.com/v1/responses/input_tokens',{method:'POST',body:ok,signal}),/PARENT_CONTEXT_UNAVAILABLE/);
 for(const extra of [{max_output_tokens:32},{stream:true},{store:false},{tools:[]},{background:false},{previous_response_id:'r'},{input:[{type:'input_file',file_url:'https://x.example/a.pdf'}]},{input:[{role:'user',content:'y'}]},{instructions:['x']},{instructions:{text:'x'}}])
  await assert.rejects(withFactoryApiParent(job,()=>count('https://api.openai.com/v1/responses/input_tokens',{method:'POST',body:JSON.stringify({...JSON.parse(ok),...extra}),signal})),/COUNT_SCOPE_INVALID/);
 await assert.rejects(withFactoryApiParent(job,()=>count('https://api.openai.com/v1/responses',{method:'POST',body:ok,signal})),/COUNT_SCOPE_INVALID/);
 assert.equal(calls.length,2);
 assert.throws(()=>createFactoryOpenAiCountTransport('bad'),/CREDENTIAL_REQUIRED/);
});
