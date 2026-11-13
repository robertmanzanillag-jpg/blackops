import {z} from "zod";
import {canonicalEvidenceDigest as digest} from "./evidence-json";
export const BUSINESS_ROLES=["automations","portfolio"] as const;
export type BusinessRole=typeof BUSINESS_ROLES[number];
export type BusinessQuery={query:(sql:string,params?:any[])=>Promise<{rows:any[]}>};
export type BusinessPool=BusinessQuery&{connect:()=>Promise<BusinessQuery&{release:()=>void}>};
const id=z.string().min(1).max(200),stamp=z.string().datetime(),decimal=z.string().regex(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/);
const definition=z.object({id,name:z.string().max(200),status:z.enum(["active","paused","failed","disabled"]),timezone:z.string().max(80),scheduleKind:z.string().max(80).nullable(),nextRunAt:stamp.nullable(),lastRunAt:stamp.nullable(),lastStatus:z.string().max(40).nullable(),failureCount:z.number().int().nonnegative(),requiresApproval:z.boolean(),permissionLevel:z.string().max(80)}).strict();
const run=z.object({id,automationId:id,status:z.enum(["success","failed","skipped","pending_approval"]),startedAt:stamp,finishedAt:stamp.nullable(),triggeredBy:z.string().max(80),failureCode:z.enum(["AUTH_REQUIRED","RATE_LIMITED","MISSING_CONNECTION","VALIDATION_FAILED","TIMEOUT","UNKNOWN"])}).strict();
const holding=z.object({id,symbol:z.string().min(1).max(40),quantity:decimal,avgBuyPrice:decimal,currency:z.string().regex(/^[A-Z]{3}$/)}).strict();
const trade=z.object({id,investmentId:id.nullable(),symbol:z.string().min(1).max(40),type:z.enum(["buy","sell"]),quantity:decimal,price:decimal,totalValue:decimal,currency:z.string().regex(/^[A-Z]{3}$/),date:stamp}).strict();
const common={version:z.literal(1),ownerKey:z.string().regex(/^[a-f0-9]{64}$/),observedAt:stamp,sourceDigest:z.string().regex(/^[a-f0-9]{64}$/)};
export const businessSourceSchema=z.discriminatedUnion("role",[
 z.object({...common,role:z.literal("automations"),definitions:z.array(definition).max(200),definitionTotal:z.number().int().nonnegative(),latestRuns:z.array(run).max(200)}).strict(),
 z.object({...common,role:z.literal("portfolio"),holdings:z.array(holding).max(200),holdingTotal:z.number().int().nonnegative(),transactions:z.array(trade).max(200),transactionTotal:z.number().int().nonnegative()}).strict(),
]);
export type BusinessSource=z.infer<typeof businessSourceSchema>;
export function validateBusinessSource(raw:unknown,owner:string,at:number):BusinessSource{
 const s=businessSourceSchema.parse(raw),{sourceDigest,...body}=s;if(!owner.trim()||s.ownerKey!==digest(owner)||sourceDigest!==digest(body)||!Number.isFinite(at)||Date.parse(s.observedAt)>at+30000||at-Date.parse(s.observedAt)>60000)throw Error("BUSINESS_SOURCE_INVALID");
 const unique=(rows:{id:string}[])=>new Set(rows.map(r=>r.id)).size===rows.length;
 if(s.role==="automations"){
  if(s.definitions.length!==Math.min(s.definitionTotal,200)||!unique(s.definitions)||!unique(s.latestRuns)||new Set(s.latestRuns.map(r=>r.automationId)).size!==s.latestRuns.length||s.latestRuns.some(r=>!s.definitions.some(d=>d.id===r.automationId)||Date.parse(r.startedAt)>at+30000||(r.finishedAt&&(Date.parse(r.finishedAt)<Date.parse(r.startedAt)||Date.parse(r.finishedAt)>at+30000))))throw Error("BUSINESS_SOURCE_INVALID");
 }else if(s.holdings.length!==Math.min(s.holdingTotal,200)||s.transactions.length!==Math.min(s.transactionTotal,200)||!unique(s.holdings)||!unique(s.transactions)||s.transactions.some(t=>Date.parse(t.date)>at+30000))throw Error("BUSINESS_SOURCE_INVALID");
 return s;
}
export const BUSINESS_SOURCE_SQL={
 definitions:`SELECT id,name,status,timezone,schedule->>'kind' AS "scheduleKind",next_run_at AT TIME ZONE 'UTC' AS "nextRunAt",last_run_at AT TIME ZONE 'UTC' AS "lastRunAt",last_status AS "lastStatus",failure_count AS "failureCount",requires_approval AS "requiresApproval",permission_level AS "permissionLevel",count(*) OVER() AS total FROM automation_definitions WHERE owner_user_id=$1 ORDER BY id LIMIT 200`,
 runs:`SELECT r.id,r.automation_id AS "automationId",r.status,r.started_at AT TIME ZONE 'UTC' AS "startedAt",r.finished_at AT TIME ZONE 'UTC' AS "finishedAt",r.triggered_by AS "triggeredBy",CASE WHEN r.metadata->>'code' IN ('AUTH_REQUIRED','RATE_LIMITED','MISSING_CONNECTION','VALIDATION_FAILED','TIMEOUT') THEN r.metadata->>'code' ELSE 'UNKNOWN' END AS "failureCode" FROM (SELECT id FROM automation_definitions WHERE owner_user_id=$1 ORDER BY id LIMIT 200) d JOIN LATERAL (SELECT * FROM automation_runs WHERE owner_user_id=$1 AND automation_id=d.id ORDER BY started_at DESC,id DESC LIMIT 1) r ON true ORDER BY d.id`,
 holdings:`SELECT id,symbol,quantity,avg_buy_price AS "avgBuyPrice",currency,count(*) OVER() AS total FROM investments WHERE user_id=$1 ORDER BY id LIMIT 200`,
 transactions:`SELECT id,investment_id AS "investmentId",symbol,type,quantity,price,total_value AS "totalValue",currency,date AT TIME ZONE 'UTC' AS date,count(*) OVER() AS total FROM transactions WHERE user_id=$1 ORDER BY date,id LIMIT 200`,
};
/** Consistent owner-bound SQL snapshot. No bootstrap, external prices or sends. */
export async function readBusinessSources(pool:BusinessPool,owner:string,role:BusinessRole,now=Date.now()):Promise<BusinessSource>{
 if(!owner.trim()||!BUSINESS_ROLES.includes(role))throw Error("BUSINESS_OWNER_REQUIRED");const db=await pool.connect();try{
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");await db.query("SET LOCAL statement_timeout='10s'");
  if(!(await db.query("SELECT id FROM users WHERE id=$1 LIMIT 1",[owner])).rows.length)throw Error("BUSINESS_OWNER_ABSENT");
  const read=async(sql:string)=>JSON.parse(JSON.stringify((await db.query(sql,[owner])).rows)) as any[];
  const clean=(rows:any[])=>rows.map(({total,...row})=>row);let body:any;
  if(role==="automations"){const definitions=await read(BUSINESS_SOURCE_SQL.definitions),latestRuns=await read(BUSINESS_SOURCE_SQL.runs);body={version:1,role,ownerKey:digest(owner),observedAt:new Date(now).toISOString(),definitions:clean(definitions),definitionTotal:Number(definitions[0]?.total||0),latestRuns};}
  else{const holdings=await read(BUSINESS_SOURCE_SQL.holdings),transactions=await read(BUSINESS_SOURCE_SQL.transactions);body={version:1,role,ownerKey:digest(owner),observedAt:new Date(now).toISOString(),holdings:clean(holdings),holdingTotal:Number(holdings[0]?.total||0),transactions:clean(transactions),transactionTotal:Number(transactions[0]?.total||0)};}
  const source=validateBusinessSource({...body,sourceDigest:digest(body)},owner,now);await db.query("COMMIT");return source;
 }catch{await db.query("ROLLBACK").catch(()=>undefined);throw Error("BUSINESS_SOURCE_UNAVAILABLE");}finally{db.release();}
}
