import {z} from "zod";
import type {AgentCareer,CareerScoreReconciliation} from "../shared/agent-company";
import {canonicalEvidenceDigest as digest} from "./evidence-json";
export const CAREER_RECONCILIATION_KIND="office_career_reconciliation_v1";
/** Repository proof of the scorer correction, NOT a claim about deployment time. */
export const CAREER_SCORER_CORRECTION=Object.freeze({revision:"fc7f319199725c20725110f9e32a47a8215ff55e",committedAt:"2026-11-06T20:31:42.000Z"});
const hash=z.string().regex(/^[a-f0-9]{64}$/),stamp=z.string().datetime(),id=z.string().min(1).max(200);
const careerSchema=z.object({agentId:id,generation:z.number().int().positive(),nickname:z.string(),battery:z.number().min(0).max(100),points:z.number().finite().nonnegative(),cyclesTotal:z.number().int().nonnegative(),cyclesWorking:z.number().int().nonnegative(),ordersDone:z.number().int().nonnegative(),firedCount:z.number().int().nonnegative(),hiredAt:stamp,lastState:z.string().nullable(),memory:z.array(z.object({at:stamp,text:z.string()})),lastEvaluatedAt:stamp.optional(),lastEvidenceId:z.string().optional()}).passthrough();
const snapshotSchema=z.object({kind:z.literal("locked_canonical_career_read"),ownerKey:hash,careerDigest:hash,stateRevision:z.number().int().nonnegative(),observedAt:stamp}).strict();
export type VerifiedCareerSnapshot=z.infer<typeof snapshotSchema>;
const reasonSchema=z.enum(["pre_correction_score_without_complete_ledger","unversioned_observation_score_without_evidence"]);
const recordSchema=z.object({id:hash,ownerKey:hash,agentId:id,generation:z.number().int().positive(),originalCareer:z.unknown(),originalCareerDigest:hash,reason:reasonSchema,status:z.literal("needs_scope_qualification"),recordedAt:stamp,operatorAuditId:id,correction:z.object({revision:z.literal(CAREER_SCORER_CORRECTION.revision),committedAt:z.literal(CAREER_SCORER_CORRECTION.committedAt)}).strict(),snapshot:snapshotSchema,fullRoleQualified:z.literal(false),batteryAdjusted:z.literal(false),promotionGranted:z.literal(false)}).strict();
export type CareerReconciliationRecord=Omit<z.infer<typeof recordSchema>,"originalCareer">&{originalCareer:AgentCareer};
export type CareerReconciliationLedger={version:1;ownerKey:string;records:CareerReconciliationRecord[]};
function validateOriginal(raw:unknown):AgentCareer{const parsed=careerSchema.parse(raw);if(parsed.scoreReconciliation!==undefined||Object.hasOwn(parsed,"evaluatedEvidenceIds")||parsed.cyclesTotal<1||parsed.cyclesWorking>parsed.cyclesTotal||Date.parse(parsed.hiredAt)>=Date.parse(CAREER_SCORER_CORRECTION.committedAt)||Buffer.byteLength(JSON.stringify(raw))>300000)throw Error("CAREER_NOT_UNVERIFIED_LEGACY");return structuredClone(raw) as AgentCareer;}
function legacyReason(career:AgentCareer):z.infer<typeof reasonSchema>{
 if(career.lastEvaluatedAt&&Date.parse(career.lastEvaluatedAt)>=Date.parse(career.hiredAt)&&Date.parse(career.lastEvaluatedAt)<Date.parse(CAREER_SCORER_CORRECTION.committedAt))return "pre_correction_score_without_complete_ledger";
 if(!career.lastEvaluatedAt&&!career.lastEvidenceId&&career.firedCount>0)return "unversioned_observation_score_without_evidence";
 throw Error("CAREER_LEGACY_PROVENANCE_INSUFFICIENT");
}
function recordDigest(record:Omit<CareerReconciliationRecord,"id">|CareerReconciliationRecord){const {id:_,...body}=record as CareerReconciliationRecord;return digest(body);}
export function parseCareerReconciliationLedger(raw:unknown,owner:string):CareerReconciliationLedger{
 if(!owner.trim())throw Error("CAREER_OWNER_REQUIRED");if(raw===undefined)return{version:1,ownerKey:digest(owner),records:[]};
 const state=z.object({version:z.literal(1),ownerKey:hash,records:z.array(recordSchema).max(100)}).strict().parse(raw) as CareerReconciliationLedger;
 if(state.ownerKey!==digest(owner)||Buffer.byteLength(JSON.stringify(state))>4000000||new Set(state.records.map(r=>`${r.agentId}:${r.generation}`)).size!==state.records.length)throw Error("CAREER_LEDGER_INVALID");
 for(const r of state.records){const original=validateOriginal(r.originalCareer);if(r.id!==recordDigest(r)||r.ownerKey!==state.ownerKey||r.originalCareerDigest!==digest(original)||r.agentId!==original.agentId||r.generation!==original.generation||r.reason!==legacyReason(original)||r.snapshot.ownerKey!==state.ownerKey||r.snapshot.careerDigest!==r.originalCareerDigest||Date.parse(r.recordedAt)<Date.parse(r.snapshot.observedAt)||Date.parse(r.recordedAt)-Date.parse(r.snapshot.observedAt)>30000||Date.parse(r.snapshot.observedAt)<Date.parse(CAREER_SCORER_CORRECTION.committedAt))throw Error("CAREER_RECORD_INVALID");}
 return state;
}
// The complete original remains archived. Ordinary order notes/training memory may
// evolve without invalidating the archive; protected score and holder fields may not.
function protectedCareerDigest(career:AgentCareer){return digest(Object.fromEntries(["agentId","generation","battery","points","cyclesTotal","cyclesWorking","ordersDone","firedCount","hiredAt","lastState","lastEvaluatedAt","lastEvidenceId","evaluatedEvidenceIds"].filter(key=>Object.hasOwn(career,key)).map(key=>[key,(career as unknown as Record<string,unknown>)[key]])));}
const markerFor=(r:CareerReconciliationRecord):CareerScoreReconciliation=>({version:1,status:"needs_scope_qualification",recordId:r.id,originalCareerDigest:r.originalCareerDigest});
/** Pure operator reconciliation. Caller must hold canonical owner advisory lock,
 * verify canonical career+state revision, and commit returned ledger AND marker
 * atomically. No storage, provider, scoring, qualification or admission happens here. */
export async function reconcileLegacyCareer(options:{owner:string;ledger:unknown;career:AgentCareer;expectedGeneration:number;expectedCareerDigest:string;expectedStateRevision:number;operatorAuditId:string;now:number;verifySnapshot:(request:{owner:string;agentId:string;generation:number;careerDigest:string})=>Promise<VerifiedCareerSnapshot>}):Promise<{ledger:CareerReconciliationLedger;career:AgentCareer;record:CareerReconciliationRecord;created:boolean}>{
 const state=parseCareerReconciliationLedger(options.ledger,options.owner),career=structuredClone(options.career);if(!Number.isFinite(options.now)||career.generation!==options.expectedGeneration)throw Error("CAREER_FENCE_CHANGED");
 const existing=state.records.find(r=>r.agentId===career.agentId&&r.generation===career.generation);
 if(existing){const {scoreReconciliation,...base}=career;if(!scoreReconciliation||digest(scoreReconciliation)!==digest(markerFor(existing))||protectedCareerDigest(base)!==protectedCareerDigest(existing.originalCareer)||options.expectedCareerDigest!==existing.originalCareerDigest)throw Error("CAREER_RECONCILIATION_CONFLICT");return {ledger:state,career,record:existing,created:false};}
 const original=validateOriginal(career),originalCareerDigest=digest(original);if(originalCareerDigest!==options.expectedCareerDigest)throw Error("CAREER_FENCE_CHANGED");const reason=legacyReason(original);
 const snapshot=snapshotSchema.parse(await options.verifySnapshot({owner:options.owner,agentId:career.agentId,generation:career.generation,careerDigest:originalCareerDigest}));
 if(snapshot.stateRevision!==options.expectedStateRevision||snapshot.ownerKey!==digest(options.owner)||snapshot.careerDigest!==originalCareerDigest||Date.parse(snapshot.observedAt)>options.now||options.now-Date.parse(snapshot.observedAt)>30000)throw Error("CAREER_SNAPSHOT_UNVERIFIED");
 const body={ownerKey:state.ownerKey,agentId:original.agentId,generation:original.generation,originalCareer:original,originalCareerDigest,reason,status:"needs_scope_qualification" as const,recordedAt:new Date(options.now).toISOString(),operatorAuditId:id.parse(options.operatorAuditId),correction:CAREER_SCORER_CORRECTION,snapshot,fullRoleQualified:false as const,batteryAdjusted:false as const,promotionGranted:false as const};const record={...body,id:recordDigest(body)};
 const ledger=parseCareerReconciliationLedger({...state,records:[...state.records,record]},options.owner);return {ledger,career:{...original,scoreReconciliation:markerFor(record)},record,created:true};
}
/** Cross-check the marker against its immutable archive before any integration
 * trusts it. Qualification remains absent; this never grants execution rights. */
export function validateCareerReconciliationMarker(career:AgentCareer,ledger:CareerReconciliationLedger,owner:string){const state=parseCareerReconciliationLedger(ledger,owner),r=state.records.find(x=>x.id===career.scoreReconciliation?.recordId);const {scoreReconciliation,...base}=career;if(!r||r.agentId!==career.agentId||r.generation!==career.generation||digest(scoreReconciliation)!==digest(markerFor(r))||protectedCareerDigest(base)!==protectedCareerDigest(r.originalCareer))throw Error("CAREER_RECONCILIATION_CONFLICT");return r;}
