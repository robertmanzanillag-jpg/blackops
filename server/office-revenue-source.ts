import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonicalEvidenceDigest as digest} from './evidence-json';
import type {BusinessPool} from './office-business-sources';

const text=(max:number)=>z.string().trim().min(1).max(max);
const stamp=z.string().datetime({offset:true});
const candidate=z.object({id:text(200),businessName:text(160),area:text(120),niche:text(120),websiteStatus:z.enum(['no_website','weak_website','has_website','unknown']),painPoint:z.string().max(500),sourceUrl:text(300),evidence:text(1200),verificationStatus:z.enum(['needs_review','verified_public','blocked']),publicEvidenceVerified:z.boolean(),updatedAt:stamp});
const proof=candidate.extend({verificationStatus:z.literal('verified_public'),publicEvidenceVerified:z.literal(true)}).strict();
export const revenuePreviewSourceSchema=z.object({version:z.literal(1),ownerKey:z.string().regex(/^[a-f0-9]{64}$/),observedAt:stamp,collections:z.array(z.object({kind:z.literal('publicLeadCandidates'),revision:z.number().int().positive(),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).length(1),items:z.array(proof).max(20),eligibleTotal:z.number().int().nonnegative(),diagnostics:z.array(z.enum(['NO_VERIFIED_MATCH','PARTIAL_SELECTION'])),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type RevenuePreviewSource=z.infer<typeof revenuePreviewSourceSchema>;
export const revenueCandidateVersion=(c:{id:string;updatedAt:string})=>digest([c.id,c.updatedAt]);
export function revenueOwnerKey(owner:string){if(!owner.trim())throw Error('REVENUE_OWNER_REQUIRED');return `rev_${createHash('sha256').update(owner.trim()).digest('hex')}`;}
export function safeRevenueEvidenceUrl(value:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.hostname.includes('.')&&!/(^|\.)(localhost|local|internal|test|invalid|example\.(com|net|org))$/.test(u.hostname)&&!/^\d|:|\[/.test(u.hostname)&&!/(replace|placeholder)/i.test(value);}catch{return false;}}
/** Reads already verified canonical records only. Verification is retained source evidence,
 * not a new HTTP verification or permission to contact the business. */
export function composeRevenuePreviewSource(owner:string,rows:Array<{kind:string;revision:number;data:unknown}>,now:number,excluded:ReadonlySet<string>=new Set()):RevenuePreviewSource{
 const kind='publicLeadCandidates' as const;
 if(rows.length!==1||rows[0].kind!==kind)throw Error('REVENUE_COLLECTION_MISSING');
 const row=rows[0],candidates=z.array(candidate).max(2000).parse(row.data);
 if(new Set(candidates.map(c=>c.id)).size!==candidates.length||candidates.some(c=>Date.parse(c.updatedAt)>now+30000))throw Error('REVENUE_COLLECTION_INVALID');
 const items=candidates.filter(c=>c.verificationStatus==='verified_public'&&c.publicEvidenceVerified&&safeRevenueEvidenceUrl(c.sourceUrl)&&c.evidence.length>=12&&!excluded.has(revenueCandidateVersion(c))&&![c.businessName,c.area,c.niche,c.evidence,c.painPoint].some(t=>/\b(example|placeholder|test business|replace me|REPLACE_PUBLIC)\b/i.test(t))).sort((a,b)=>a.id.localeCompare(b.id));
 const body={version:1 as const,ownerKey:digest(owner),observedAt:new Date(now).toISOString(),collections:[{kind,revision:row.revision,digest:digest(row.data)}],items:items.slice(0,20),eligibleTotal:items.length,diagnostics:items.length===0?['NO_VERIFIED_MATCH']:items.length>20?['PARTIAL_SELECTION']:[]};
 return validateRevenuePreviewSource({...body,sourceDigest:digest(body)},owner,now);
}

export function validateRevenuePreviewSource(raw:unknown,owner:string,now:number):RevenuePreviewSource{
 const value=revenuePreviewSourceSchema.parse(raw),{sourceDigest,...body}=value;
 if(value.ownerKey!==digest(owner)||sourceDigest!==digest(body)||!Number.isFinite(now)||Date.parse(value.observedAt)>now+30000||now-Date.parse(value.observedAt)>240000||new Set(value.collections.map(c=>c.kind)).size!==1||value.items.length!==Math.min(value.eligibleTotal,20)||new Set(value.items.map(i=>i.id)).size!==value.items.length||value.items.some(i=>!safeRevenueEvidenceUrl(i.sourceUrl)||Date.parse(i.updatedAt)>Date.parse(value.observedAt)+30000))throw Error('REVENUE_SOURCE_INVALID');
 return value;
}
export async function readRevenuePreviewSource(pool:BusinessPool,owner:string,now=Date.now(),excluded:ReadonlySet<string>=new Set()){
 const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL statement_timeout='10s'");
 if(!(await client.query('SELECT id FROM users WHERE id=$1 LIMIT 1',[owner])).rows.length)throw Error('REVENUE_OWNER_ABSENT');
 const result=await client.query("SELECT kind,revision,CASE WHEN octet_length(data::text)<=2097152 THEN data ELSE NULL END AS data FROM revenue_engine_state WHERE owner_user_id=$1 AND kind=ANY($2::text[]) ORDER BY kind",[revenueOwnerKey(owner),['publicLeadCandidates']]);
 const source=composeRevenuePreviewSource(owner,result.rows,now,excluded);await client.query('COMMIT');return source;
 }catch{await client.query('ROLLBACK').catch(()=>undefined);throw Error('REVENUE_SOURCE_UNAVAILABLE');}finally{client.release();}
}
