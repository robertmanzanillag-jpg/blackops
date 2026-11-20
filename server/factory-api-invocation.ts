import {currentFactoryApiParent} from "./factory-api-context";
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {FactoryApiReservation} from './software-factory-api-budget';
import type {softwareFactoryStore} from './software-factory-store';
export class FactoryApiBudgetError extends Error {
 constructor(code:string,readonly dispatched=false){super(code);}
}
const admissionCodes=new Set(["FACTORY_API_RECONCILIATION_REQUIRED","FACTORY_API_UNKNOWN_HOLD","FACTORY_API_BUDGET_EXHAUSTED","FACTORY_API_IDEMPOTENCY_CONFLICT","FACTORY_API_PARENT_FENCE_REQUIRED","FACTORY_API_PARENT_ESCROW_EXHAUSTED","FACTORY_API_DISPATCH_WINDOW_EXPIRED","FACTORY_API_EXECUTION_NOT_RESERVED","FACTORY_API_AUTHORITY_UNAVAILABLE","FACTORY_MONTH_UNINITIALIZED","FACTORY_API_EXECUTION_CANCELLED","FACTORY_API_PARENT_OWNER_MISMATCH"]);
export function factoryApiAdmissionError(error:unknown){
 const descriptor=error instanceof Error?Object.getOwnPropertyDescriptor(error,"message"):undefined;
 const code=descriptor&&"value" in descriptor?descriptor.value:undefined;
 return new FactoryApiBudgetError(typeof code==="string"&&admissionCodes.has(code)?code:"FACTORY_API_AUTHORITY_UNAVAILABLE");
}
const sha=z.string().regex(/^[a-f0-9]{64}$/),positive=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const factoryApiPriceSchema=z.object({model:z.string().min(1).max(200),inputNanoUsdPerToken:positive,
 outputNanoUsdPerToken:positive,cachedInputNanoUsdPerToken:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),validUntil:z.string().datetime(),evidenceSha256:sha}).strict();
export type FactoryApiPrice=z.infer<typeof factoryApiPriceSchema>;
export type FactoryApiUsage={model:string;responseId:string;inputTokens:number;outputTokens:number;cachedInputTokens:number};
type Store=Pick<typeof softwareFactoryStore,'reserveApi'|'settleApi'|'unknownApi'|'executionWindowApi'|'apiBudgetStatus'>;
export const apiEvidenceHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function microCost(price:FactoryApiPrice,input:number,output:number,cached:number){
 if(![input,output,cached].every(n=>Number.isSafeInteger(n)&&n>=0))throw new FactoryApiBudgetError('FACTORY_API_USAGE_UNVERIFIED');
 if(cached>input||(cached>0&&price.cachedInputNanoUsdPerToken===undefined))throw new FactoryApiBudgetError("FACTORY_API_CACHE_USAGE_UNPRICED");
 const cost=(BigInt(input-cached)*BigInt(price.inputNanoUsdPerToken)+BigInt(cached)*BigInt(price.cachedInputNanoUsdPerToken??0)+BigInt(output)*BigInt(price.outputNanoUsdPerToken)+999n)/1000n;
 if(cost>BigInt(Number.MAX_SAFE_INTEGER))throw new FactoryApiBudgetError('FACTORY_API_COST_OVERFLOW');return Number(cost);
}
/** Purely injected authority boundary. Never initializes or reconciles anything.
 * A dispatched exception/missing usage keeps full escrow and stops paid replay. */
export function createFactoryApiInvocation(options:{store:Store;owner:()=>string;now?:()=>Date}){
 const now=options.now??(()=>new Date());
 const invoke=async function invoke<T>(input:{executionId?:string;consumer:FactoryApiReservation['consumer'];
   requestSha256:string;price:FactoryApiPrice;promptBytes:number;maxOutputTokens:number;
   parent?:FactoryApiReservation['parent'];signal?:AbortSignal;
   call:(options:{signal:AbortSignal;maxRetries:0;timeout:number})=>Promise<T>;
   usage:(result:T)=>FactoryApiUsage}):Promise<T>{
  if(input.executionId!==undefined&&!/^[A-Za-z0-9_.:-]{1,200}$/.test(input.executionId))throw new FactoryApiBudgetError("FACTORY_API_ASSIGNMENT_REQUIRED");
  const price=factoryApiPriceSchema.parse(input.price);if(price.cachedInputNanoUsdPerToken!==undefined&&price.cachedInputNanoUsdPerToken>price.inputNanoUsdPerToken)throw new FactoryApiBudgetError("FACTORY_API_PRICING_UNVERIFIED");sha.parse(input.requestSha256);
  if(!Number.isSafeInteger(input.promptBytes)||input.promptBytes<0||input.promptBytes>1_048_576||
     !Number.isSafeInteger(input.maxOutputTokens)||input.maxOutputTokens<=0||input.maxOutputTokens>128000)throw new FactoryApiBudgetError('FACTORY_API_REQUEST_UNBOUNDED');
  const remaining=Date.parse(price.validUntil)-now().getTime();
  if(!Number.isFinite(remaining)||remaining<1)throw new FactoryApiBudgetError('FACTORY_API_PRICING_EXPIRED');
  if(input.signal?.aborted)throw new FactoryApiBudgetError("FACTORY_API_EXECUTION_CANCELLED");
  let owner:string;try{owner=options.owner();}catch(error){throw factoryApiAdmissionError(error);}
  const context=currentFactoryApiParent();
  if(context&&createHash("sha256").update(owner).digest("hex")!==context.ownerKey)throw new FactoryApiBudgetError("FACTORY_API_PARENT_OWNER_MISMATCH");
  if(context&&input.parent&&(context.jobId!==input.parent.jobId||context.fence!==input.parent.fence))throw new FactoryApiBudgetError("FACTORY_API_PARENT_CONTEXT_MISMATCH");
  const sourceSignal=context?.signal?(input.signal?AbortSignal.any([input.signal,context.signal]):context.signal):input.signal;
  if(sourceSignal?.aborted)throw new FactoryApiBudgetError("FACTORY_API_EXECUTION_CANCELLED");
  const parent=input.parent??(context?{jobId:context.jobId,fence:context.fence}:undefined);
  const key='api:'+apiEvidenceHash([input.consumer,input.executionId??randomUUID()]);
  const requestSha256=apiEvidenceHash([input.requestSha256,price,input.promptBytes,input.maxOutputTokens,parent??null]);
  const reservation=await options.store.reserveApi(owner,{key,consumer:input.consumer,requestSha256,
    maximumMicroUsd:Math.max(1,microCost(price,input.promptBytes+1024,input.maxOutputTokens,0)),...(parent?{parent}:{})}).catch(error=>{throw factoryApiAdmissionError(error);});
  if(!reservation.admitted)throw new FactoryApiBudgetError('FACTORY_API_DISPATCH_ALREADY_RESERVED');
  let dispatched=false;
  try{
   const windowStartedAt=now().getTime();
   const executionWindow=await options.store.executionWindowApi(owner,key);
   const elapsed=now().getTime()-windowStartedAt;
   if(!Number.isFinite(elapsed)||elapsed<0)throw Error("clock unverified");
   const deadline=Math.min(executionWindow-elapsed,Date.parse(price.validUntil)-now().getTime());
   if(!Number.isFinite(deadline)||deadline<1)throw Error('expired');
   const timeout=Math.floor(Math.min(120000,deadline)),signal=sourceSignal?AbortSignal.any([sourceSignal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
   signal.throwIfAborted();
   dispatched=true;
   const result=await input.call({signal,maxRetries:0,timeout});
   signal.throwIfAborted();if(now().getTime()>=Date.parse(price.validUntil))throw Error("expired");
   const usage=input.usage(result);
   if(usage.model!==price.model||typeof usage.responseId!=='string'||!usage.responseId||usage.responseId.length>300)throw Error('unverified');
   const actualMicroUsd=microCost(price,usage.inputTokens,usage.outputTokens,usage.cachedInputTokens);
   const settled=await options.store.settleApi(owner,key,{actualMicroUsd,evidenceSha256:apiEvidenceHash({requestSha256,price,usage})});
   if(settled?.settled===false)throw Error('overrun');
   return result;
  }catch{
   await options.store.unknownApi(owner,key).catch(()=>undefined);
   throw new FactoryApiBudgetError('FACTORY_API_EXECUTION_UNCONFIRMED',dispatched);
  }
 };
 return Object.assign(invoke,{async preflight(){try{const owner=options.owner(),context=currentFactoryApiParent();if(context?.signal?.aborted)throw new FactoryApiBudgetError("FACTORY_API_EXECUTION_CANCELLED");if(context&&createHash("sha256").update(owner).digest("hex")!==context.ownerKey)throw new FactoryApiBudgetError("FACTORY_API_PARENT_OWNER_MISMATCH");const status=await options.store.apiBudgetStatus(owner);const withinParent=context&&status.configured&&!status.unknown&&status.fixedMicroUsd+status.spentMicroUsd+status.reservedMicroUsd<=status.limitMicroUsd;if(!status.paidAdmissionReady&&!withinParent)throw new FactoryApiBudgetError(status.reason);}catch(error){throw factoryApiAdmissionError(error);}}});
}
const catalogSchema=z.object({version:z.literal(1),prices:z.array(factoryApiPriceSchema.extend({provider:z.enum(['openai','deepseek','gemini','integration'])})).max(100)}).strict();
export function configuredFactoryApiPrice(provider:string,model:string,configuration:string|undefined){
 if(!configuration)throw new FactoryApiBudgetError('FACTORY_API_PRICING_UNVERIFIED');
 let catalog:z.infer<typeof catalogSchema>;
 try{if(Buffer.byteLength(configuration)>65536)throw Error('size');catalog=catalogSchema.parse(JSON.parse(configuration));}catch{throw new FactoryApiBudgetError('FACTORY_API_PRICING_UNVERIFIED');}
 const matches=catalog.prices.filter(p=>p.provider===provider&&p.model===model);
 if(matches.length!==1)throw new FactoryApiBudgetError('FACTORY_API_PRICING_UNVERIFIED');
 const {provider:_provider,...price}=matches[0];return price;
}
export async function defaultFactoryApiInvocation(){
 const [{configuredSoftwareFactoryStore},{getSystemUserId}]=await Promise.all([import('./software-factory-store-provider'),import('./user-context')]);
 return createFactoryApiInvocation({store:configuredSoftwareFactoryStore,owner:getSystemUserId});
}
