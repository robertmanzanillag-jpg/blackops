import type {SourcePool} from "./office-web-role-sources";

/** Messages node-postgres raises while a connection is being opened or is
 * lost before a result arrives (Neon/serverless cold starts, autoscaled
 * instance wake-ups). Never match free text beyond these exact strings. */
const TRANSIENT_MESSAGES=new Set(["Connection terminated due to connection timeout","Connection terminated unexpectedly","timeout exceeded when trying to connect"]);
const TRANSIENT_CODES=new Set(["ECONNREFUSED","ECONNRESET","ETIMEDOUT","EAI_AGAIN","EPIPE","57P01","57P03","08001","08006"]);
export function isTransientConnectionError(error:unknown):boolean {
 try{
  const value=error && typeof error==="object"?error as {code?:unknown;message?:unknown}:{};
  return (typeof value.code==="string" && TRANSIENT_CODES.has(value.code)) || (typeof value.message==="string" && TRANSIENT_MESSAGES.has(value.message));
 }catch{return false;}
}

/** Bounded retry for connection-level failures only. Callers must pass only
 * idempotent statements: the web-source exporter's owner checks and SELECTs,
 * and its guarded upsert (an identical observedAt+source is accepted again).
 * Schema, constraint, permission and validation errors are never retried, and
 * the last error is rethrown unchanged so failure codes keep their meaning. */
export function withConnectionRetry<P extends SourcePool>(pool:P,options:{delaysMs?:number[];sleep?:(ms:number)=>Promise<void>}={}):SourcePool {
 const delays=(options.delaysMs??[1000,3000]).slice(0,4),sleep=options.sleep??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
 return {async query(sql,args){
  for(let attempt=0;;attempt++){
   try{return await pool.query(sql,args);}
   catch(error){if(attempt>=delays.length || !isTransientConnectionError(error))throw error;await sleep(delays[attempt]);}
  }
 }};
}
