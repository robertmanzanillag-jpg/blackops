import {createHash} from "node:crypto";
import {canonicalEvidenceDigest} from "./evidence-json";
import {performance} from "node:perf_hooks";
import {enrollTrainee,type CompanyState} from "../shared/agent-company";
import type {OfficeRoleLifecycleState} from "../shared/office-role-lifecycle";
import type {CouncilState} from "../shared/agent-council";
import {evaluateRadioSlotPolicies,executeRadioSlotPolicy,RADIO_SLOT_BASELINE_POLICY,RADIO_SLOT_CANDIDATE_POLICY,type RadioSlotPolicyEvaluation} from "../shared/radio-slot-policies";
export const RADIO_TRAINING_MAX_FAMILY_MS=1000;
export type RadioTrainingMeasurement={benchmarkId:string;baselineDurationMs:number;candidateDurationMs:number};
export type RadioTrainingEvidence={evaluation:RadioSlotPolicyEvaluation;timings:RadioTrainingMeasurement[];costBasis:"no-provider-invocation";apiCalls:0};
export const radioEvidenceDigest=canonicalEvidenceDigest;
/** Recover only the exact pre-fix writer shape, after complete oracle validation.
 * Never rewrite a stored attestation or accept arbitrary key permutations. */
export function matchesRadioEvidenceDigest(evidence:RadioTrainingEvidence,digest:string):boolean {
 if(!validateRadioTrainingEvidence(evidence))return false;
 if(digest===radioEvidenceDigest(evidence))return true;
 const original={evaluation:evaluateRadioSlotPolicies(),timings:evidence.timings.map(t=>({benchmarkId:t.benchmarkId,baselineDurationMs:t.baselineDurationMs,candidateDurationMs:t.candidateDurationMs})),costBasis:"no-provider-invocation",apiCalls:0};
 return digest===createHash("sha256").update(JSON.stringify(original)).digest("hex");
}
export const radioIncumbentVersion=(generation:number)=>`${RADIO_SLOT_CANDIDATE_POLICY}:incumbent:${generation}`;
export function radioImplementationVersion(policyVersion:string,generation:number):string {
 if(policyVersion===`baseline:radio:${generation}`)return RADIO_SLOT_BASELINE_POLICY;
 if(policyVersion===radioIncumbentVersion(generation))return RADIO_SLOT_CANDIDATE_POLICY;
 throw new Error("Unsupported Radio runtime policy");
}
export type RadioTrainingReceipt={id:string;traineeId:string;generation:number;baselinePolicyVersion:string;appliedPolicyVersion:string;appliedAt:string;evidence:RadioTrainingEvidence;artifactId:string;scope:"radio-range-parser-only";firstVerifiedRunId?:string;firstVerifiedAt?:string;firstExecutionArtifactId?:string};
export function validRadioTrainingReceipt(input:unknown):input is RadioTrainingReceipt {
 const value=input as RadioTrainingReceipt;
 try{return Boolean(value && typeof value.id==="string" && value.id && typeof value.traineeId==="string" && value.traineeId && Number.isSafeInteger(value.generation) && value.generation>0 &&
  value.scope==="radio-range-parser-only" && Number.isFinite(Date.parse(value.appliedAt)) && value.baselinePolicyVersion===`baseline:radio:${value.generation}` && value.appliedPolicyVersion===radioIncumbentVersion(value.generation) &&
  matchesRadioEvidenceDigest(value.evidence,value.artifactId) &&
  (value.firstVerifiedRunId===undefined ? value.firstVerifiedAt===undefined && value.firstExecutionArtifactId===undefined : typeof value.firstVerifiedRunId==="string" && value.firstVerifiedRunId.length>0 && Number.isFinite(Date.parse(value.firstVerifiedAt || "")) && Date.parse(value.firstVerifiedAt!)>=Date.parse(value.appliedAt) && /^[a-f0-9]{64}$/.test(value.firstExecutionArtifactId || "")));}catch{return false;}
}
export async function resolveSavedRadioPolicy(userId:string,deps?:{owner:()=>string;read:()=>Promise<Pick<CouncilState,"officeExecution">>}):Promise<string> {
 const owner=deps?.owner || (await import("./user-context")).getSystemUserId;
 if(userId!==owner())return RADIO_SLOT_BASELINE_POLICY;
 const state=await (deps?.read || (async()=>await (await import("./agent-council")).getAgentCouncil().load()))();
 const role=state.officeExecution?.roles.roles.radio;
 if(!role || role.status==="unsupported")return RADIO_SLOT_BASELINE_POLICY;
 if(role.status!=="active" || !role.activePolicy || role.activePolicy.generation!==role.generation || role.leases.some(l=>l.status==="unknown"))throw new Error("Radio policy requires verified active holder");
 const version=radioImplementationVersion(role.activePolicy.version,role.generation);
 if(version===RADIO_SLOT_CANDIDATE_POLICY && !state.officeExecution?.internalWork?.radioTrainingHistory?.some(receipt=>validRadioTrainingReceipt(receipt) && receipt.generation===role.generation && receipt.appliedPolicyVersion===role.activePolicy!.version))throw new Error("Radio policy requires trusted qualification receipt");
 return version;
}

/** Executes both installed implementations against fixed independent expected
 * outputs. Wall time is measured, never inferred from module completion. */
export function runRadioTrainingTrial(clock=()=>performance.now()):RadioTrainingEvidence {
 const evaluation=evaluateRadioSlotPolicies();
 const timings=evaluation.artifacts.map(family=>{
  const measure=(version:string)=>{const start=clock();for(const item of family.cases)executeRadioSlotPolicy(version,item.description);return clock()-start;};
  return {benchmarkId:family.benchmarkId,baselineDurationMs:measure(RADIO_SLOT_BASELINE_POLICY),candidateDurationMs:measure(RADIO_SLOT_CANDIDATE_POLICY)};
 });
 return {evaluation,timings,costBasis:"no-provider-invocation",apiCalls:0};
}
export function validateRadioTrainingEvidence(input:unknown):input is RadioTrainingEvidence {
 try {
 const value=input as RadioTrainingEvidence;
 const trusted=evaluateRadioSlotPolicies();
 return !!value && Object.keys(value).sort().join(",")==="apiCalls,costBasis,evaluation,timings" && value.costBasis === "no-provider-invocation" && value.apiCalls === 0 && radioEvidenceDigest(value.evaluation)===radioEvidenceDigest(trusted) && trusted.qualified &&
  Array.isArray(value.timings) && value.timings.length===3 && new Set(value.timings.map(t=>t.benchmarkId)).size===3 &&
  value.timings.every(t=>Object.keys(t).sort().join(",")==="baselineDurationMs,benchmarkId,candidateDurationMs" && trusted.artifacts.some(f=>f.benchmarkId===t.benchmarkId) && [t.baselineDurationMs,t.candidateDurationMs].every(ms=>Number.isFinite(ms) && ms>=0 && ms<=RADIO_TRAINING_MAX_FAMILY_MS));
 } catch {return false;}
}

/** Narrow incumbent skill update, not replacement. No vacant, probationary,
 * missing or uncertain holder can enter through this gate. Caller commits this
 * with its admitted role execution and full receipt in the same transaction. */
export function qualifyRadioIncumbent(roles:OfficeRoleLifecycleState,company:CompanyState,evidence:RadioTrainingEvidence,now:number,id:string):{roles:OfficeRoleLifecycleState;company:CompanyState;receipt?:RadioTrainingReceipt} {
 const role=roles.roles.radio,career=company.careers.radio;
 if(!id.trim() || !Number.isFinite(now) || !role || !career || career.inTrainingUntilGeneration || role.status!=="active" || role.generation!==career.generation ||
   role.activePolicy?.version!==`baseline:radio:${role.generation}` || role.leases.some(l=>["running","unknown"].includes(l.status)) || !validateRadioTrainingEvidence(evidence)) return {roles,company};
 const version=radioIncumbentVersion(role.generation),traineeId=`radio-incumbent-parser:${role.generation}:${RADIO_SLOT_CANDIDATE_POLICY}`;
 if(company.trainees.some(t=>t.id===traineeId) || role.policyHistory.some(p=>p.version===version))return {roles,company};
 const appliedAt=new Date(now).toISOString();
 let trained=enrollTrainee(company,{id:traineeId,forAgentId:"radio",role:"Radio: lectura de rangos horarios",now});
 if(!trained.trainees.some(t=>t.id===traineeId))return {roles,company};
 trained={...trained,trainees:trained.trainees.map(t=>t.id===traineeId?{...t,purpose:"incumbent",generation:role.generation,nickname:career.nickname,
   curriculumSnapshot:[{id:"radio-range-parser-v1",title:"Rangos horarios de Radio",summary:"Pruebas independientes de asignación exacta; sin contactos ni cambios de calendario."}],
   modulesDone:["radio-range-parser-v1"],knowledge:[RADIO_SLOT_CANDIDATE_POLICY],qualifiedAt:appliedAt,graduatedAt:appliedAt,awaitingEvidence:false,
   assessments:evidence.evaluation.artifacts.map(family=>{const timing=evidence.timings.find(row=>row.benchmarkId===family.benchmarkId)!;return {
    scope:"benchmark" as const,profileId:evidence.evaluation.profileId,profileVersion:evidence.evaluation.profileVersion,
    runId:`${id}:${family.benchmarkId}`,benchmarkId:family.benchmarkId,curriculumVersion:"radio-range-parser-v1",completedAt:appliedAt,
    artifactId:radioEvidenceDigest({family,timing}),passed:family.noRegression && family.strictImprovement,quality:family.candidateQuality,incumbentQuality:family.baselineQuality,
    errors:family.cases.filter(c=>!c.candidateCorrect).length,incumbentErrors:family.cases.filter(c=>!c.baselineCorrect).length,
    durationMs:timing.candidateDurationMs,incumbentDurationMs:timing.baselineDurationMs,cost:0,incumbentCost:0,
   };}),
   executionBlocker:"Solo habilidad de parser validada; primera ejecución guardada se verifica por separado."}:t)};
 const receipt:RadioTrainingReceipt={id,traineeId,generation:role.generation,baselinePolicyVersion:role.activePolicy.version,appliedPolicyVersion:version,appliedAt,evidence,artifactId:radioEvidenceDigest(evidence),scope:"radio-range-parser-only"};
 return {company:trained,receipt,roles:{...roles,roles:{...roles.roles,radio:{...role,
   activePolicy:{...role.activePolicy,version,candidateId:traineeId,curriculumVersion:"radio-range-parser-v1",createdAt:appliedAt,guidance:[RADIO_SLOT_CANDIDATE_POLICY],qualificationScope:"benchmark" as const},
   policyHistory:[...role.policyHistory,role.activePolicy],history:[...role.history,{at:appliedAt,event:"incumbent_parser_skill_updated_pending_execution",policyVersion:version,evidenceIds:evidence.evaluation.artifacts.map(a=>a.benchmarkId)}],
 }}}};
}
