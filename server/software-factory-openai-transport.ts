import {guardFactoryOpenAiFetch} from './factory-api-sdk';
import type {FactoryApiPrice,createFactoryApiInvocation} from './factory-api-invocation';
const authorityTransports=new WeakSet<Function>();
export const isFactoryAuthorityTransport=(request:Function)=>authorityTransports.has(request);
/** Private credential stays in the control process. Existing shared grants are
 * secondary; the Factory monetary gate and live parent fence are mandatory. */
export function createFactoryOpenAiTransport(key:string,transport:typeof fetch=fetch,
 options:{price?:FactoryApiPrice;invoke?:ReturnType<typeof createFactoryApiInvocation>}={}){
 if(!/^sk-[A-Za-z0-9_-]{20,300}$/.test(key))throw Error('FACTORY_OPENAI_CREDENTIAL_REQUIRED');
 const guarded=guardFactoryOpenAiFetch((async(url,init)=>{
  try{return await transport(url,{method:'POST',body:init?.body,signal:init?.signal,redirect:'error',credentials:'omit',
   headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'}});
  }catch{throw Error('FACTORY_OPENAI_TRANSPORT_UNCONFIRMED');}
 }) as typeof fetch,{consumer:'other',requireParent:true,...options});
 const request=async(url:string,init:RequestInit):Promise<Response>=>{
  let target:URL;try{target=new URL(url);}catch{throw Error('FACTORY_OPENAI_TRANSPORT_SCOPE_INVALID');}
  if(target.origin!=='https://api.openai.com'||target.username||target.password||target.search||target.hash||
   !['/v1/responses','/v1/responses/input_tokens'].includes(target.pathname)||init.method!=='POST'||!init.signal||
   typeof init.body!=='string'||!init.body||Buffer.byteLength(init.body)>1048576)throw Error('FACTORY_OPENAI_TRANSPORT_SCOPE_INVALID');
  init.signal.throwIfAborted();return guarded(target.href,init);
 };
 authorityTransports.add(request);return request;
}
