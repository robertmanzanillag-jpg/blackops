/** Stateless text only. Trusted request must authenticate, honor AbortSignal,
 * and perform zero retries. Caller must durably reserve maxCostCents first and
 * retain that reservation on unknown; credits never discount ledger charges. */
export type FactoryTextResult =
 | {status:"completed";text:string;costCents:number;inputTokens:number;outputTokens:number}
 | {status:"blocked"|"failed"|"unknown";reason:string;costCents:number};
export function createOpenAiFactoryTextProvider(config:{
 request:(url:string,init:RequestInit)=>Promise<Response>;
 model:string;
 /** Operator verified upper-bound rates, including any long-context tier.
  * Integer nanodollars per token: $1/million tokens = 1000. */
 inputNanoUsdPerToken:number;outputNanoUsdPerToken:number;
 pricingValidUntil:string;now:()=>Date;maxInputTokens:number;
 timeoutMs?:number;maxResponseBytes?:number;
 reasoningEffort?:"low";
}) {
 const c={...config},timeout=c.timeoutMs??120000,byteLimit=c.maxResponseBytes??1048576;
 const positive=(n:unknown):n is number=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0;
 const nonnegative=(n:unknown):n is number=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0;
 const expiry=Date.parse(c.pricingValidUntil);
 // OpenAI lists gpt-6-astra itself under Snapshots (verified 2026-11-06):
 // https://developers.openai.com/api/docs/models/gpt-6-astra
 // Do not infer that every undated alias is pinned. Response identity must still
 // match exactly, and operator pricing expires independently of model naming.
 const pinnedModel=c.model==="gpt-6-astra"||/^[-a-zA-Z0-9.]+-\d{4}-\d{2}-\d{2}$/.test(c.model);
 if((c.reasoningEffort!==undefined&&(c.reasoningEffort!=="low"||c.model!=="gpt-6-astra"))||typeof c.request!=="function"||typeof c.now!=="function"||!pinnedModel||!positive(c.inputNanoUsdPerToken)||!positive(c.outputNanoUsdPerToken)||!positive(c.maxInputTokens)||!Number.isFinite(expiry)||!positive(timeout)||timeout>300000||!positive(byteLimit)||byteLimit>4194304)throw Error("FACTORY_OPENAI_CONFIGURATION_INVALID");
 const cost=(input:number,output:number)=>Number((BigInt(input)*BigInt(c.inputNanoUsdPerToken)+BigInt(output)*BigInt(c.outputNanoUsdPerToken)+9999999n)/10000000n);
 /** responseSchema (optional): strict JSON-schema output format. It only shapes
  * output; callers must still validate the parsed value in code. */
 return async function generateText(raw:{instructions:string;text:string;maxOutputTokens:number;maxCostCents:number;signal:AbortSignal;responseSchema?:{name:string;schema:Record<string,unknown>}}):Promise<FactoryTextResult>{
  const input={...raw};
  let format:unknown;
  if(input.responseSchema!==undefined){
   const r=input.responseSchema;let encoded="";
   try{encoded=JSON.stringify(r?.schema);}catch{encoded="";}
   if(!r||typeof r.name!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(r.name)||!r.schema||typeof r.schema!=="object"||Array.isArray(r.schema)||!encoded||Buffer.byteLength(encoded)>16384)return {status:"blocked",reason:"FACTORY_OPENAI_INPUT_INVALID",costCents:0};
   format={format:{type:"json_schema",name:r.name,strict:true,schema:JSON.parse(encoded)}};
  }
  const blocked=(reason:string):FactoryTextResult=>({status:"blocked",reason,costCents:0});
  if(typeof input.instructions!=="string"||typeof input.text!=="string"||!input.text.trim()||Buffer.byteLength(input.instructions)+Buffer.byteLength(input.text)>262144||!positive(input.maxOutputTokens)||input.maxOutputTokens<16||input.maxOutputTokens>128000||!positive(input.maxCostCents)||input.maxCostCents>10000||!input.signal)return blocked("FACTORY_OPENAI_INPUT_INVALID");
  const fresh=()=>{const now=c.now().getTime();return Number.isFinite(now)&&now<expiry;};
  if(!fresh())return blocked("FACTORY_OPENAI_PRICING_EXPIRED");
  if(input.signal.aborted)return blocked("FACTORY_OPENAI_CANCELLED");
  const controller=new AbortController(),abort=()=>controller.abort();
  input.signal.addEventListener("abort",abort,{once:true});
  const timer=setTimeout(abort,timeout);
  let submitted=false;
  async function post(endpoint:string,payload:unknown,limit:number){
   if(controller.signal.aborted)throw Error("cancelled");
   const response=await c.request("https://api.openai.com/v1/responses"+endpoint,{method:"POST",redirect:"error",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   if(!response.ok){await response.body?.cancel();throw Error("http");}
   const reader=response.body?.getReader();if(!reader)throw Error("empty");
   const chunks:Uint8Array[]=[];let size=0;
   for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw Error("size");}chunks.push(part.value);}
   if(controller.signal.aborted)throw Error("cancelled");
   return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
  }
  try {
   // Both calls receive the exact same model/instructions/text. No conversation,
   // previous response, tools, remote input or caller-supplied generation fields.
   const prompt={model:c.model,instructions:input.instructions,input:input.text,...(c.reasoningEffort?{reasoning:{effort:c.reasoningEffort}}:{}),...(format?{text:format}:{})};
   const counted=await post("/input_tokens",prompt,4096);
   if(counted?.object!=="response.input_tokens"||!nonnegative(counted.input_tokens)||counted.input_tokens>c.maxInputTokens)return blocked("FACTORY_OPENAI_COUNT_INVALID");
   if(cost(counted.input_tokens,input.maxOutputTokens)>input.maxCostCents)return blocked("FACTORY_OPENAI_BUDGET_UNAVAILABLE");
   if(!fresh()||controller.signal.aborted)return blocked("FACTORY_OPENAI_ADMISSION_EXPIRED");
   submitted=true;
   const response=await post("",{...prompt,max_output_tokens:input.maxOutputTokens,store:false,tools:[],stream:false,background:false,service_tier:"default",truncation:"disabled"},byteLimit);
   const usage=response?.usage;
   if(response?.object!=="response"||response.model!==c.model||!usage||!nonnegative(usage.input_tokens)||!nonnegative(usage.output_tokens)||!nonnegative(usage.total_tokens)||usage.total_tokens!==usage.input_tokens+usage.output_tokens)throw Error("usage");
   const costCents=cost(usage.input_tokens,usage.output_tokens);
   if(!Number.isSafeInteger(costCents)||usage.input_tokens!==counted.input_tokens||usage.output_tokens>input.maxOutputTokens||costCents>input.maxCostCents)throw Error("usage bounds");
   if(!["completed","failed","incomplete","cancelled"].includes(response.status))throw Error("execution still active");
   if(response.status!=="completed"||response.error||response.incomplete_details){
    const reason=response.status==="incomplete" ? (response.incomplete_details?.reason==="max_output_tokens" ? "FACTORY_OPENAI_OUTPUT_LIMIT" : "FACTORY_OPENAI_INCOMPLETE") : response.status==="cancelled" ? "FACTORY_OPENAI_RESPONSE_CANCELLED" : response.status==="failed" ? "FACTORY_OPENAI_RESPONSE_FAILED" : "FACTORY_OPENAI_NOT_COMPLETED";
    return {status:"failed",reason,costCents};
   }
   if(!Array.isArray(response.output))throw Error("output");
   let text="";
   for(const item of response.output){
    if(item.type==="reasoning")continue;
    if(item.type!=="message"||item.role!=="assistant"||item.status!=="completed"||!Array.isArray(item.content))throw Error("output type");
    for(const part of item.content){
     if(part.type==="refusal")return {status:"failed",reason:"FACTORY_OPENAI_REFUSAL",costCents};
     if(part.type!=="output_text"||typeof part.text!=="string")throw Error("content");
     text+=part.text;
    }
   }
   if(!text.trim())return {status:"failed",reason:"FACTORY_OPENAI_EMPTY_TEXT",costCents};
   return {status:"completed",text,costCents,inputTokens:usage.input_tokens,outputTokens:usage.output_tokens};
  }catch{return submitted?{status:"unknown",reason:"FACTORY_OPENAI_EXECUTION_UNCONFIRMED",costCents:0}:blocked("FACTORY_OPENAI_COUNT_UNAVAILABLE");}
  finally{clearTimeout(timer);input.signal.removeEventListener("abort",abort);}
 };
}
