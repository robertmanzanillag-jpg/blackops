import {createHash} from "node:crypto";
import {z} from "zod";
export const MARKETING_LEARNING_KIND="marketing_command_center_learning_v1";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export const marketingLearningRunSchema=z.object({id:z.string().min(1).max(160),createdAt:z.string().datetime(),focusClientId:z.string().min(1).max(80),clientsReviewed:z.number().int().min(0).max(20),improvementsQueued:z.array(z.string().max(4000)).max(100),rulesUpdated:z.array(z.string().max(4000)).max(100),safetyBlocks:z.array(z.string().max(4000)).max(100),summary:z.string().max(8000)}).strict();
export type SavedMarketingRun=z.infer<typeof marketingLearningRunSchema>;
export type MarketingQuery={query:(sql:string,params?:any[])=>Promise<{rows:any[]}>};
export type MarketingPool=MarketingQuery&{connect:()=>Promise<MarketingQuery&{release:()=>void}>};
const stateSchema=z.object({version:z.literal(1),ownerKey:z.string().regex(/^[a-f0-9]{64}$/),runs:z.array(marketingLearningRunSchema).max(200)}).strict();
function ownerKey(owner:string){if(!owner.trim()||owner.length>200)throw Error("MARKETING_OWNER_REQUIRED");return hash(owner);}
function parse(raw:unknown,owner:string){const parsed=stateSchema.safeParse(raw);if(!parsed.success)throw Error("MARKETING_HISTORY_INVALID");const state=parsed.data;if(state.ownerKey!==ownerKey(owner)||new Set(state.runs.map(r=>r.id)).size!==state.runs.length||Buffer.byteLength(JSON.stringify(state))>1000000)throw Error("MARKETING_HISTORY_INVALID");return state;}
async function assertOwner(db:MarketingQuery,owner:string){ownerKey(owner);if(!(await db.query("SELECT id FROM users WHERE id=$1 LIMIT 1",[owner])).rows.length)throw Error("MARKETING_OWNER_ABSENT");}
/** Existing generic table, isolated namespace. No DDL, cache or filesystem. */
export async function readMarketingLearning(db:MarketingQuery,owner:string):Promise<SavedMarketingRun[]|null>{
 await assertOwner(db,owner);const result=await db.query("SELECT data FROM revenue_engine_state WHERE owner_user_id=$1 AND kind=$2",[owner,MARKETING_LEARNING_KIND]);
 return result.rows.length?parse(result.rows[0].data,owner).runs:null;
}
export function createMarketingLearningStore(pool:MarketingPool){
 async function transact<T>(owner:string,change:(runs:SavedMarketingRun[])=>{runs:SavedMarketingRun[];value:T;write:boolean}):Promise<T>{
  ownerKey(owner);const db=await pool.connect();try{
   await db.query("BEGIN");await db.query("SET LOCAL lock_timeout='5s'");await db.query("SET LOCAL statement_timeout='10s'");
   await assertOwner(db,owner);await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${MARKETING_LEARNING_KIND}:${owner}`]);
   const result=await db.query("SELECT data FROM revenue_engine_state WHERE owner_user_id=$1 AND kind=$2 FOR UPDATE",[owner,MARKETING_LEARNING_KIND]);
   const before=result.rows.length?parse(result.rows[0].data,owner).runs:[];
   const next=change(structuredClone(before)),state=parse({version:1,ownerKey:ownerKey(owner),runs:next.runs},owner);
   if(next.write)await db.query("INSERT INTO revenue_engine_state (owner_user_id,kind,data,revision,updated_at) VALUES ($1,$2,$3::jsonb,1,now()) ON CONFLICT (owner_user_id,kind) DO UPDATE SET data=EXCLUDED.data,revision=revenue_engine_state.revision+1,updated_at=now()",[owner,MARKETING_LEARNING_KIND,JSON.stringify(state)]);
   await db.query("COMMIT");return next.value;
  }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}finally{db.release();}
 }
 return {
  read:(owner:string)=>readMarketingLearning(pool,owner),
  async prepare(owner:string,key:string,build:(runs:SavedMarketingRun[],id:string)=>SavedMarketingRun){
   if(!/^[a-zA-Z0-9:_-]{1,160}$/.test(key))throw Error("MARKETING_IDEMPOTENCY_KEY_INVALID");
   const id=`mkt-run-${hash(`${owner}:${key}`)}`;
   return transact(owner,runs=>{const existing=runs.find(r=>r.id===id);if(existing)return {runs,write:false,value:{run:existing,runs,replayed:true}};
    const run=marketingLearningRunSchema.parse(build(runs,id));if(run.id!==id)throw Error("MARKETING_RUN_ID_MISMATCH");const next=[...runs,run];return {runs:next,write:true,value:{run,runs:next,replayed:false}};
   });
  },
  /** Operator-only complete records, never reconstructed from counts/screenshots. */
  async importHistory(owner:string,raw:unknown){const incoming=z.array(marketingLearningRunSchema).max(200).parse(raw);
   return transact(owner,runs=>{for(const run of incoming){const existing=runs.find(r=>r.id===run.id);if(existing){if(JSON.stringify(existing)!==JSON.stringify(run))throw Error("MARKETING_IMPORT_CONFLICT");}else runs.push(run);}return {runs,write:incoming.length>0,value:runs};});
  },
 };
}
