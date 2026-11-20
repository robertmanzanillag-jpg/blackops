import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import {guardFactoryOpenAiClient,guardFactoryOpenAiFetch} from '../server/factory-api-sdk';
import {fixtureFactoryInvocation} from './fixtures/factory-api-budget';
import {createRoutedOpenAI,InMemoryAiProviderLedger} from '../server/ai-model-router';
import {OpenAiLocalNewsTranslationAdapter} from '../server/clippers-local-news-translation';
const model='synthetic-model',price={model,inputNanoUsdPerToken:400,outputNanoUsdPerToken:1600,validUntil:'2027-01-01T00:00:00.000Z',evidenceSha256:'a'.repeat(64)};
const body=()=>({model,messages:[{role:'user' as const,content:'original text'}],max_completion_tokens:16});
const completion=()=>({id:'synthetic-response',object:'chat.completion',model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'synthetic result'}}],usage:{prompt_tokens:10,completion_tokens:5,prompt_tokens_details:{cached_tokens:0}}});
function fixture(pause=false){
 let release!:()=>void;const wait=pause?new Promise<void>(resolve=>{release=resolve;}):Promise.resolve();
 let admissions=0;const calls:{url:string;init:RequestInit;body:any}[]=[],authority=fixtureFactoryInvocation();
 const invoke=Object.assign(async(input:Parameters<typeof authority>[0])=>{admissions++;await wait;return authority(input);},{preflight:authority.preflight});
 const sdk=new OpenAI({apiKey:'synthetic-key-not-real',maxRetries:0,fetch:(async(url,init)=>{calls.push({url:String(url),init:init!,body:JSON.parse(String(init!.body))});return Response.json(completion());}) as typeof fetch});
 const client=guardFactoryOpenAiClient(sdk,{provider:'openai',invoke,price:()=>price});
 return {client,calls,invoke,admissions:()=>admissions,release:()=>release()};
}
test('real installed SDK cannot override validated request via requestOptions',async()=>{
 const f=fixture();
 for(const options of [{body:{...body(),max_completion_tokens:100000}},{query:{model:'other'}},{path:'/images/generations'},{method:'GET'},{stream:true},{headers:{Authorization:'synthetic-other'}},{maxRetries:9},{fetchOptions:{body:'override'}}]){
  await assert.rejects(f.client.chat.completions.create(body(),options as any),/REQUEST_OPTIONS_UNSUPPORTED/);
 }
 let getterReads=0;const options={get timeout(){getterReads++;return 1;}};
 await assert.rejects(f.client.chat.completions.create(body(),options),/REQUEST_OPTIONS_UNSUPPORTED/);
 assert.equal(getterReads,0);assert.equal(f.admissions(),0);assert.equal(f.calls.length,0);
});
test('SDK body, nested content and allowed options are immutable snapshots before first await',async()=>{
 const f=fixture(true),request=body(),options={timeout:1000};
 const pending=f.client.chat.completions.create(request,options);
 request.model='different-expensive-model';request.max_completion_tokens=100000;request.messages[0].content='mutated';options.timeout=100000;
 (options as any).body={model:'other',max_completion_tokens:100000};
 f.release();await pending;
 assert.equal(f.admissions(),1);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].body.model,model);assert.equal(f.calls[0].body.max_completion_tokens,16);assert.equal(f.calls[0].body.messages[0].content,'original text');
});
test('remote prompt/context and ambiguous dual output limits hold before SDK or reserve',async()=>{
 const f=fixture();
 for(const request of [{model,input:'local',max_output_tokens:16,prompt:{id:'remote-template',version:'1'}},{model,input:'local',max_output_tokens:16,previous_response_id:'remote-response'},{model,input:'local',max_output_tokens:16,conversation:'remote-conversation'},{model,input:[{id:'stored-item'}],max_output_tokens:16}])await assert.rejects(f.client.responses.create(request as any),/OPERATION_UNPRICED/);
 await assert.rejects(f.client.chat.completions.create({...body(),max_tokens:100000}),/REQUEST_UNBOUNDED/);
 assert.equal(f.admissions(),0);assert.equal(f.calls.length,0);
});
test('raw fetch uses the validated body/method/header snapshot despite caller mutation during admission',async()=>{
 const f=fixture(true),calls:any[]=[],headers=new Headers({Authorization:'synthetic-original'});
 const request:RequestInit={method:'POST',body:JSON.stringify({model,input:'original',max_output_tokens:16}),headers};
 const guarded=guardFactoryOpenAiFetch((async(url,init)=>{calls.push({url,init,body:JSON.parse(String(init?.body))});return Response.json({id:'synthetic-raw',status:'completed',model,usage:{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:0}},output:[]});}) as typeof fetch,{invoke:f.invoke,price});
 const pending=guarded('https://api.openai.com/v1/responses',request);
 request.method='DELETE';request.body=JSON.stringify({model:'expensive',input:'changed',max_output_tokens:100000});headers.set('Authorization','synthetic-mutated');
 f.release();await pending;
 assert.equal(calls.length,1);assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].body.model,model);assert.equal(calls[0].body.max_output_tokens,16);assert.equal(calls[0].body.input,'original');assert.equal(new Headers(calls[0].init.headers).get('Authorization'),'synthetic-original');
});
test('Clips uses the same normalized source for credential and billing-provider selection',()=>{
 for(const integration of ['   ','undefined','null','changeme']){
  const adapter=new OpenAiLocalNewsTranslationAdapter({env:{AI_INTEGRATIONS_OPENAI_API_KEY:integration,OPENAI_API_KEY:'synthetic-own',AI_INTEGRATIONS_OPENAI_BASE_URL:'https://integration.invalid/v1',OPENAI_BASE_URL:'https://own.invalid/v1'}});
  const client=(adapter as any).getClient();
  assert.equal(client.apiKey,'synthetic-own');assert.equal(client.baseURL,'https://own.invalid/v1');
 }
 const adapter=new OpenAiLocalNewsTranslationAdapter({env:{AI_INTEGRATIONS_OPENAI_API_KEY:' synthetic-integration ',OPENAI_API_KEY:'synthetic-own',AI_INTEGRATIONS_OPENAI_BASE_URL:'https://integration.invalid/v1'}});
 const client=(adapter as any).getClient();assert.equal(client.apiKey,'synthetic-integration');assert.equal(client.baseURL,'https://integration.invalid/v1');
});

test('router pins original request before secondary-ledger await and rejects remote references before translation',async()=>{const f=fixture(),ledger=new InMemoryAiProviderLedger();let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;}),reserve=ledger.reserve.bind(ledger);ledger.reserve=async input=>{await wait;return reserve(input);};const client=createRoutedOpenAI({tier:'standard',label:'binding',env:{AI_ROUTER_ENABLED:'true',OPENAI_API_KEY:'synthetic-own'},ledger,makeClient:()=>f.client,factoryInvocation:f.invoke,factoryPricing:()=>price});const original=body(),pending=client.chat.completions.create(original);original.max_completion_tokens=100000;original.messages[0].content='changed';release();await pending;assert.equal(f.calls[0].body.max_completion_tokens,16);assert.equal(f.calls[0].body.messages[0].content,'original text');const remote=createRoutedOpenAI({tier:'repetitive',label:'remote',env:{AI_ROUTER_ENABLED:'true',DEEPSEEK_API_KEY:'synthetic-deep',DEEPSEEK_MODEL:model},ledger:new InMemoryAiProviderLedger(),makeClient:()=>{throw Error('must not construct client');},factoryInvocation:f.invoke,factoryPricing:()=>price});for(const request of [{model,input:[{id:'stored'}],max_output_tokens:16},{model,prompt:{id:'stored-prompt'},input:'local',max_output_tokens:16}])await assert.rejects(remote.responses!.create(request),/OPERATION_UNPRICED/);assert.equal(f.calls.length,1);});
