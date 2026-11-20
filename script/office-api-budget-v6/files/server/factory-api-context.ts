import {AsyncLocalStorage} from 'node:async_hooks';
import type {FactoryJob} from './software-factory-store';
const storage=new AsyncLocalStorage<{ownerKey:string;jobId:string;fence:string;signal?:AbortSignal}>();
/** Only the durable worker installs this scope from its claimed row. It is
 * never taken from browser/model/repository input or mutable task payload. */
export function withFactoryApiParent<T>(job:FactoryJob,run:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!job.fence||job.status!=='running')throw Error('FACTORY_API_PARENT_FENCE_REQUIRED');
 return storage.run({ownerKey:job.ownerKey,jobId:job.id,fence:job.fence,...(signal?{signal}:{})},run);
}
export function currentFactoryApiParent(){return storage.getStore();}
