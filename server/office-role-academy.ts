import {randomUUID} from "node:crypto";
import {z} from "zod";
import {canonicalEvidenceDigest as digest} from "./evidence-json";
import {OFFICE_CURRICULUM_ROLES,ROLE_CURRICULUM_LIMITS,roleFixtures,buildRolePrompt,gradeRoleResponse,type OfficeCurriculumRole} from "./office-role-curricula";
import type {createAgentCouncil} from "./agent-council";
import type {OfficeOpenAIResult} from "./office-openai";

// These are transferable study instructions, not held-out fixture answers.
const LESSONS=["Cite only exact evidence identifiers present in the supplied source; never invent missing evidence.","Distinguish readiness, a completed internal artifact and verified delivery. A missing connector is not proof of agent misconduct.","Return exactly the required JSON schema and one permitted decision. Do not include a self-assigned score or perform external actions."];
const version=digest({curriculum:"evidence-triage-v1",graderVersion:1,lessons:LESSONS,manifest:OFFICE_CURRICULUM_ROLES.map(role=>({role,fixtures:roleFixtures(role),prompts:roleFixtures(role).map(f=>buildRolePrompt(role,f.id))}))});
const roleSchema=z.enum(OFFICE_CURRICULUM_ROLES as [OfficeCurriculumRole,...OfficeCurriculumRole[]]);
const resultSchema=z.object({text:z.string().max(8000),sessionId:z.string().regex(/^resp_/),completedAt:z.string().datetime(),provider:z.literal("openai"),model:z.string().min(1),usage:z.object({inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative(),totalTokens:z.number().int().nonnegative()}).strict(),durationMs:z.number().nonnegative().finite()}).strict();
const jobSchema=z.object({id:z.string().uuid(),fence:z.string().uuid(),role:roleSchema,generation:z.number().int().positive(),fixtureId:z.string(),curriculumVersion:z.literal(version),startedAt:z.string().datetime(),expiresAt:z.string().datetime(),status:z.enum(["running","completed","blocked","unknown"]),reason:z.string().max(160).optional(),completedAt:z.string().datetime().optional(),incumbent:resultSchema.optional(),candidate:resultSchema.optional(),artifactId:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export type RoleAcademyJob=z.infer<typeof jobSchema>;
export type RoleAcademyState={version:1;jobs:RoleAcademyJob[]};
const evidence=(job:RoleAcademyJob)=>({id:job.id,role:job.role,generation:job.generation,fixtureId:job.fixtureId,curriculumVersion:job.curriculumVersion,incumbent:job.incumbent,candidate:job.candidate});
export function parseRoleAcademy(raw:unknown):RoleAcademyState{
 if(raw===undefined)return {version:1,jobs:[]};
 const state=z.object({version:z.literal(1),jobs:z.array(jobSchema).max(200)}).strict().parse(raw);
 const ids=new Set<string>(),sessions=new Set<string>();
 for(const job of state.jobs){
  if(ids.has(job.id) || Date.parse(job.expiresAt)<=Date.parse(job.startedAt) || !roleFixtures(job.role).some(f=>f.id===job.fixtureId))throw Error("ROLE_ACADEMY_INVALID_ASSIGNMENT");ids.add(job.id);
  for(const result of [job.incumbent,job.candidate])if(result){if(sessions.has(result.sessionId) || result.usage.totalTokens!==result.usage.inputTokens+result.usage.outputTokens || Date.parse(result.completedAt)<Date.parse(job.startedAt)-30000 || Date.parse(result.completedAt)>Date.parse(job.expiresAt))throw Error("ROLE_ACADEMY_INVALID_RESULT");sessions.add(result.sessionId);}
  if(job.candidate && !job.incumbent)throw Error("ROLE_ACADEMY_MISSING_BASELINE");
  if(job.status==="completed" && (!job.incumbent || !job.candidate || job.incumbent.model!==job.candidate.model || !job.completedAt || Date.parse(job.completedAt)>Date.parse(job.expiresAt) || Date.parse(job.completedAt)<Date.parse(job.startedAt) || job.artifactId!==digest(evidence(job))))throw Error("ROLE_ACADEMY_INVALID_EVIDENCE");
 }
 return state;
}
export function roleAcademySummary(raw:unknown){
 const {jobs}=parseRoleAcademy(raw);
 return OFFICE_CURRICULUM_ROLES.map(role=>{
  const rows=jobs.filter(j=>j.role===role),latest=rows.at(-1),generation=latest?.generation;
  const completed=rows.filter(j=>j.status==="completed" && j.generation===generation);
  const comparisons=completed.map(j=>({id:j.id,fixtureId:j.fixtureId,completedAt:j.completedAt!,incumbent:gradeRoleResponse(role,j.fixtureId,j.incumbent!.text),candidate:gradeRoleResponse(role,j.fixtureId,j.candidate!.text),incumbentTokens:j.incumbent!.usage.totalTokens,candidateTokens:j.candidate!.usage.totalTokens,incumbentDurationMs:j.incumbent!.durationMs,candidateDurationMs:j.candidate!.durationMs,artifactId:j.artifactId!}));
  const qualityImproved=comparisons.length===3 && new Set(comparisons.map(c=>c.fixtureId)).size===3 && new Set(comparisons.map(c=>c.completedAt.slice(0,10))).size===3 && comparisons.every(c=>c.candidate.passed && c.candidate.quality>c.incumbent.quality && c.candidateDurationMs<=c.incumbentDurationMs);
  return {role,scope:"synthetic_narrow_skill" as const,status:latest?.status || "pending",reason:latest?.reason,completedPairs:comparisons.length,comparisons,qualityImproved,costComparison:"pending_priced_receipts" as const,candidateQualified:false as const,promoted:false as const,productionBlocker:"Requires comparable priced receipts, matching production capability, source and first verified execution. This training journal does not activate or replace a holder."};
 });
}
export type RoleAcademyCall={executionId:string;maxOutputTokens:number};
/** One pair at a time, at most one task per role/day, existing token + shared
 * monetary admission remains mandatory in the injected provider. An uncertain
 * call is retained, never automatically retried or charged to an agent's life. */
export function createRoleAcademyRunner(options:{council:Pick<ReturnType<typeof createAgentCouncil>,"updateOfficeExecution">;run:(prompt:string,call:RoleAcademyCall)=>Promise<OfficeOpenAIResult>;dailyPairs:number;now?:()=>number;shouldStop?:()=>boolean}){
 if(!Number.isSafeInteger(options.dailyPairs) || options.dailyPairs<1 || options.dailyPairs>14)throw Error("ROLE_ACADEMY_DAILY_LIMIT_REQUIRED");
 const now=options.now || Date.now;
 return {async tick(){
  if(options.shouldStop?.())return;
  const start=now(),id=randomUUID(),fence=randomUUID();let admitted:RoleAcademyJob|undefined;
  await options.council.updateOfficeExecution((state,company)=>{
   admitted=undefined;const parsed=parseRoleAcademy(state.roleAcademy);
   const jobs=parsed.jobs.map(j=>j.status==="running" && Date.parse(j.expiresAt)<=start?{...j,status:"unknown" as const,reason:"Interrupted evaluation; reconcile before retry."}:j);
   const next={...state,roleAcademy:{version:1 as const,jobs}};
   if(jobs.length>=200 || jobs.some(j=>j.status==="running") || company.academyJobs?.some(j=>j.status==="running") || state.capabilityTraining?.runs.some(r=>r.status==="running"))return next;
   if(jobs.filter(j=>start-Date.parse(j.startedAt)<86400000).length>=options.dailyPairs)return next;
   // Fair order: all roles receive their first pair before any receives a second.
   const roles=[...OFFICE_CURRICULUM_ROLES].sort((a,b)=>jobs.filter(j=>j.role===a).length-jobs.filter(j=>j.role===b).length);
   for(const role of roles){const career=company.careers[role];if(!career || career.inTrainingUntilGeneration)continue;
    const previous=jobs.filter(j=>j.role===role && j.generation===career.generation);
    if(previous.some(j=>["unknown","blocked"].includes(j.status) || start-Date.parse(j.startedAt)<86400000))continue;
    const fixture=roleFixtures(role).find(f=>!previous.some(j=>j.fixtureId===f.id));if(!fixture)continue;
    admitted={id,fence,role,generation:career.generation,fixtureId:fixture.id,curriculumVersion:version,startedAt:new Date(start).toISOString(),expiresAt:new Date(start+6*60000).toISOString(),status:"running"};
    return {...next,roleAcademy:{version:1 as const,jobs:[...jobs,admitted]}};
   }return next;
  });
  if(!admitted)return;const job:RoleAcademyJob=admitted;
  const save=async(subject:"incumbent"|"candidate",result:RoleAcademyJob["incumbent"])=>options.council.updateOfficeExecution((state,company)=>{
   const journal=parseRoleAcademy(state.roleAcademy),stored=journal.jobs.find(j=>j.id===job.id);
   if(!stored || stored.status!=="running" || stored.fence!==fence || stored[subject] || Date.parse(stored.expiresAt)<=now() || company.careers[job.role]?.generation!==job.generation)throw Error("ROLE_ACADEMY_ASSIGNMENT_CHANGED");
   const updated={...stored,[subject]:result};
   if(subject==="candidate"){updated.status="completed";updated.completedAt=new Date(now()).toISOString();updated.artifactId=digest(evidence(updated));}
   const next={version:1 as const,jobs:journal.jobs.map(j=>j.id===job.id?updated:j)};parseRoleAcademy(next);
   return {...state,roleAcademy:next};
  });
  try{
   for(const subject of ["incumbent","candidate"] as const){
    if(options.shouldStop?.() || now()>=Date.parse(job.expiresAt))throw Error("ROLE_ACADEMY_STOPPED");
    const began=now(),result=await options.run(buildRolePrompt(job.role,job.fixtureId,subject==="candidate"?LESSONS:[]),{executionId:`role-academy:${job.id}:${subject}`,maxOutputTokens:ROLE_CURRICULUM_LIMITS.maxOutputTokens});
    await save(subject,resultSchema.parse({...result,durationMs:Math.max(0,now()-began)}));
   }
  }catch(error){
   const safeCode=error && typeof error==="object" && "code" in error?String(error.code):"";
   const knownPreflight=["token_budget_exhausted","shared_credit_unavailable","shared_credit_exhausted"].includes(safeCode);
   await options.council.updateOfficeExecution(state=>{const journal=parseRoleAcademy(state.roleAcademy);return {...state,roleAcademy:{version:1,jobs:journal.jobs.map(j=>j.id===job.id && j.fence===fence && j.status==="running"?{...j,status:knownPreflight?"blocked":"unknown",reason:knownPreflight?"Existing budget or verified credits unavailable; no automatic budget increase.":"Execution unconfirmed; preserved results and reservations require reconciliation."}:j)}};});
  }
 }};
}
