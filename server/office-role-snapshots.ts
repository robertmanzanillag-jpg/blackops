import {createHash} from "node:crypto";
import {z} from "zod";

export const PENDING_OFFICE_ROLES=["code","news","legal","github","control","revenue","clippers","portfolio","automations","dropshipping","news:ny-news","marketing-cmo","news:miami-news","blackroom-videos"] as const;
export type PendingOfficeRole=typeof PENDING_OFFICE_ROLES[number];
export const SQL_AUDIT_ROLES=["control","automations","portfolio","revenue","legal"] as const;
export type SqlAuditRole=typeof SQL_AUDIT_ROLES[number];
/** Read-only GitHub REST observations of the repositories registered in app_projects. */
export const GITHUB_AUDIT_ROLES=["github","code"] as const;
export type GithubAuditRole=typeof GITHUB_AUDIT_ROLES[number];
export type SnapshotRole=SqlAuditRole|GithubAuditRole;
export const GITHUB_MAX_REPOSITORIES=10,GITHUB_MAX_PULL_REQUESTS=30;
export const GITHUB_BLOCK_CODES=["NO_REGISTERED_REPOSITORIES","GITHUB_TOKEN_INVALID","GITHUB_AUTH_REJECTED","GITHUB_RATE_LIMITED","GITHUB_TIMEOUT","GITHUB_READ_DEADLINE","GITHUB_NETWORK_ERROR","GITHUB_UPSTREAM_ERROR","GITHUB_RESPONSE_INVALID"] as const;
export type GithubBlockCode=typeof GITHUB_BLOCK_CODES[number];
const s=z.string().max(500),date=z.string().datetime().nullable();
const githubRepo=z.string().regex(/^[a-z0-9-]{1,39}\/[a-z0-9_.-]{1,100}$/),count=z.number().int().nonnegative(),githubDate=z.string().datetime();
const githubState=z.string().regex(/^[a-z_]{1,40}$/);
const permission=z.enum(["read_only","draft_only","execute_after_approval","autonomous"]);
export const auditRows={
 control:z.object({id:s,scope:s,level:permission,risk:z.enum(["low","medium","high","critical"]),enabled:z.boolean()}).strict(),
 automations:z.object({id:s,status:z.enum(["active","paused","failed","disabled"]),failureCount:z.number().int().nonnegative(),nextRunAt:date,lastRunAt:date,lastStatus:z.enum(["success","failed","skipped","pending_approval"]).nullable(),requiresApproval:z.boolean(),level:permission}).strict(),
 portfolio:z.object({id:s,symbol:s,currency:s,quantity:s,avgBuyPrice:s}).strict(),
 revenue:z.object({id:s,kind:s,amountUsd:z.number().finite().nonnegative(),cashCollectedUsd:z.number().finite().nonnegative(),estimatedInternalCostUsd:z.number().finite().nonnegative(),updatedAt:z.string().datetime()}).strict(),
 legal:z.object({id:s,name:s,publicUrl:s.nullable(),repoOwner:s.nullable(),repoName:s.nullable(),environment:s}).strict(),
 github:z.object({id:s,repo:githubRepo,readable:z.boolean(),archived:z.boolean().nullable(),defaultBranch:s.nullable(),pushedAt:githubDate.nullable(),openIssues:count.nullable(),runsReadable:z.boolean(),latestRun:z.object({status:githubState,conclusion:githubState.nullable(),createdAt:githubDate}).strict().nullable()}).strict(),
 code:z.discriminatedUnion("kind",[
  z.object({id:s,kind:z.literal("pull_request"),repo:githubRepo,number:z.number().int().positive(),draft:z.boolean(),createdAt:githubDate,updatedAt:githubDate,mergeableState:githubState.nullable(),requestedReviewers:count,checks:z.object({total:count,failing:count,pending:count,passing:count}).strict().nullable()}).strict(),
  z.object({id:s,kind:z.literal("repository"),repo:githubRepo,readable:z.literal(false)}).strict(),
 ]),
};
const githubScope=z.object({blocked:z.enum(GITHUB_BLOCK_CODES).nullable(),truncated:z.boolean(),repositories:count}).strict();
export type GithubSnapshotScope=z.infer<typeof githubScope>;
const isGithubRole=(role:unknown):role is GithubAuditRole=>GITHUB_AUDIT_ROLES.includes(role as GithubAuditRole);
export function sourceDigest(value:unknown):string {
 const normalize=(v:any):any=>Array.isArray(v)?v.map(normalize):v && typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):v;
 return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}
/** `github` is present only for GitHub roles (absent keeps SQL digests unchanged). */
export type RoleSnapshot={version:1;role:SnapshotRole;ownerKey:string;observedAt:string;total:number;rows:Record<string,any>[];github?:GithubSnapshotScope;sourceDigest:string};
function githubCoverageValid(role:GithubAuditRole,total:number,rows:number,scope:GithubSnapshotScope){
 if(scope.blocked)return rows===0 && total===0 && !scope.truncated && (scope.blocked!=="NO_REGISTERED_REPOSITORIES" || scope.repositories===0);
 if(scope.repositories<1)return false;
 if(role==="github")return scope.repositories===total && scope.truncated===(total>GITHUB_MAX_REPOSITORIES) && rows===Math.min(total,GITHUB_MAX_REPOSITORIES);
 return rows===total && rows<=GITHUB_MAX_PULL_REQUESTS+GITHUB_MAX_REPOSITORIES && (scope.truncated || scope.repositories<=GITHUB_MAX_REPOSITORIES);
}
/** Stable record ids: the same repository/PR keeps its id across days and roles. */
export function githubRecordId(kind:"repository"|"pull_request",repo:string,number?:number){return sourceDigest(kind==="repository"?["github-repo",repo]:["github-pr",repo,number]);}
export function validateRoleSnapshot(input:RoleSnapshot,owner:string,now:number):RoleSnapshot {
 const github=input && isGithubRole(input.role);
 if(!owner.trim() || !Number.isFinite(now) || !input || input.version!==1 || (!SQL_AUDIT_ROLES.includes(input.role as SqlAuditRole) && !github) || input.ownerKey!==sourceDigest(owner) || !Number.isFinite(Date.parse(input.observedAt)) || Date.parse(input.observedAt)>now+30000 || now-Date.parse(input.observedAt)>300000 || !Number.isSafeInteger(input.total) || input.total<0 || !Array.isArray(input.rows) || (github?input.github===undefined:input.github!==undefined || input.rows.length!==Math.min(input.total,200)))throw new Error("Unverified audit source");
 const scope=github?githubScope.parse(input.github):undefined;
 if(scope && !githubCoverageValid(input.role as GithubAuditRole,input.total,input.rows.length,scope))throw new Error("Unverified audit source");
 const rows=input.rows.map(row=>auditRows[input.role].parse(row));
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error("Duplicate audit source");
 if(github && rows.some((r:any)=>r.id!==githubRecordId(r.kind==="pull_request"?"pull_request":"repository",r.repo,r.number)))throw new Error("Unverified audit source");
 const body={version:1 as const,role:input.role,ownerKey:input.ownerKey,observedAt:input.observedAt,total:input.total,rows,...(scope?{github:scope}:{})};
 if(sourceDigest(body)!==input.sourceDigest)throw new Error("Audit source digest mismatch");
 return {...body,sourceDigest:input.sourceDigest};
}
const timestamp=(field:string)=>`to_char(${field} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
// Static SQL only: no caller-controlled table, fields, owner interpolation, or secret columns.
/** The Revenue Engine stores its durable collections under its own owner key
 * (`rev_` + sha256 of the canonical user id), not the raw user id; see
 * buildRevenueDurableOwnerId in server/revenue-engine.ts. Querying the raw id
 * always returned zero ledger rows (NO_SOURCE_RECORDS). */
export function revenueDurableOwnerKey(owner:string):string {
 const canonical=owner.trim();if(!canonical)throw new Error("Revenue owner required");
 return `rev_${createHash("sha256").update(canonical).digest("hex")}`;
}
const queryOwner=(role:SqlAuditRole,owner:string)=>role==="revenue"?revenueDurableOwnerKey(owner):owner;
const queries:Record<SqlAuditRole,string>={
 control:`SELECT id,scope,permission_level AS level,risk_limit AS risk,enabled,count(*) OVER() AS total FROM assistant_permissions WHERE user_id=$1 ORDER BY id LIMIT 200`,
 automations:`SELECT id,status,failure_count AS "failureCount",${timestamp("next_run_at")} AS "nextRunAt",${timestamp("last_run_at")} AS "lastRunAt",last_status AS "lastStatus",requires_approval AS "requiresApproval",permission_level AS level,count(*) OVER() AS total FROM automation_definitions WHERE owner_user_id=$1 ORDER BY id LIMIT 200`,
 portfolio:`SELECT id,symbol,currency,quantity,avg_buy_price AS "avgBuyPrice",count(*) OVER() AS total FROM investments WHERE user_id=$1 ORDER BY id LIMIT 200`,
 legal:`SELECT id,name,public_url AS "publicUrl",repo_owner AS "repoOwner",repo_name AS "repoName",environment,count(*) OVER() AS total FROM app_projects WHERE user_id=$1 ORDER BY id LIMIT 200`,
 revenue:`SELECT entry->>'id' AS id,entry->>'kind' AS kind,(entry->>'amountUsd')::numeric::float8 AS "amountUsd",(entry->>'cashCollectedUsd')::numeric::float8 AS "cashCollectedUsd",(entry->>'estimatedInternalCostUsd')::numeric::float8 AS "estimatedInternalCostUsd",${timestamp("updated_at")} AS "updatedAt",count(*) OVER() AS total FROM revenue_engine_state CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(data)='array' THEN data ELSE '[null]'::jsonb END) AS entry WHERE owner_user_id=$1 AND kind='ledger' ORDER BY entry->>'id' LIMIT 200`,
};
export type AuditPool={connect:()=>Promise<{query:(sql:string,args?:unknown[])=>Promise<{rows:any[]}>;release:()=>void}>};
export async function readRoleSnapshot(pool:AuditPool,owner:string,role:SqlAuditRole):Promise<RoleSnapshot> {
 if(!owner.trim() || !SQL_AUDIT_ROLES.includes(role))throw new Error("Unsupported audit source");
 const client=await pool.connect();
 try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '10000ms'");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const identity=await client.query("SELECT id FROM users WHERE id=$1",[owner]);
  if(identity.rows.length!==1 || identity.rows[0].id!==owner)throw new Error("Canonical owner absent");
  const result=await client.query(queries[role],[queryOwner(role,owner)]);
  const clock=await client.query("SELECT clock_timestamp() AS observed");
  const rows=result.rows.map(({total,...row})=>auditRows[role].parse(row));
  const body={version:1 as const,role,ownerKey:sourceDigest(owner),observedAt:new Date(clock.rows[0].observed).toISOString(),total:Number(result.rows[0]?.total ?? 0),rows};
  const snapshot=validateRoleSnapshot({...body,sourceDigest:sourceDigest(body)},owner,Date.parse(body.observedAt));
  await client.query("COMMIT");return snapshot;
 }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}
