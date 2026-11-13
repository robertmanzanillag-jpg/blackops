import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { createAgentCouncil } from "./agent-council";
import { reserveRoleExecution, completeRoleExecution } from "../shared/office-role-lifecycle";
import { advanceCompany } from "../shared/agent-company";
import {executeRadioSlotPolicy,RADIO_SLOT_CANDIDATE_POLICY} from "../shared/radio-slot-policies";
import {qualifyRadioIncumbent,radioImplementationVersion,radioEvidenceDigest,runRadioTrainingTrial,validRadioTrainingReceipt,type RadioTrainingReceipt} from "./office-radio-training";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const item = z.object({ id:z.string().min(1).max(200), title:z.string().max(500), scheduledAt:z.string().max(40).nullable(), priority:z.string().max(40), kind:z.string().max(80) }).strict();
const radioItem=z.object({id:z.string().min(1).max(200),title:z.string().max(500),scheduledAt:z.string().max(40),description:z.string().max(2000).nullable()}).strict();
const snapshotSchema = z.object({ ownerKey:z.string().regex(/^[a-f0-9]{64}$/), observedAt:z.string().datetime(), tasks:z.array(item).max(200), approvals:z.array(item).max(200), taskTotal:z.number().int().nonnegative(),approvalTotal:z.number().int().nonnegative(),radio:z.array(radioItem).max(200).optional(),radioTotal:z.number().int().nonnegative().optional() }).strict().refine(s=>Math.min(s.taskTotal,200)===s.tasks.length && Math.min(s.approvalTotal,200)===s.approvals.length && (s.radio===undefined?s.radioTotal===undefined:s.radioTotal!==undefined && Math.min(s.radioTotal,200)===s.radio.length));
export type InternalWorkSnapshot = z.infer<typeof snapshotSchema>;
const artifactSchema = z.object({ version:z.literal("internal-planning-v1"), role:z.enum(["ceo","assistant","radio"]), snapshot:snapshotSchema,
  implementationVersion:z.string().optional(),radioAssignments:z.array(z.object({id:z.string(),slot7:z.string().nullable(),slot8:z.string().nullable(),slot9:z.string().nullable()}).strict()).max(200).optional(),
  text:z.string().max(1000000), sourceHash:z.string().regex(/^[a-f0-9]{64}$/), includedIds:z.array(z.string()).max(400),
  evaluation:z.object({ selectedRecordCoverage:z.literal(1), inventedItems:z.literal(0), mode:z.literal("deterministic-contract") }).strict() }).strict();
const jobSchema = z.object({ id:z.string().uuid(), role:z.enum(["ceo","assistant","radio"]), slot:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fence:z.string().uuid(), policyVersion:z.string().min(1), generation:z.number().int().positive(), startedAt:z.string().datetime(), expiresAt:z.string().datetime(),
  status:z.enum(["running","completed","blocked","unknown"]), completedAt:z.string().datetime().optional(), reason:z.string().max(100).optional(),
  artifact:artifactSchema.optional(), artifactId:z.string().regex(/^[a-f0-9]{64}$/).optional(),training:z.custom<RadioTrainingReceipt>(validRadioTrainingReceipt).optional(),
  interruptedAttempts:z.array(z.object({fence:z.string().uuid(),startedAt:z.string().datetime(),expiresAt:z.string().datetime(),status:z.literal("unknown"),operatorAuditId:z.string().min(1).max(200),reconciledAt:z.string().datetime(),
   priorJob:z.object({id:z.string().uuid(),role:z.literal("radio"),slot:z.string(),policyVersion:z.string(),generation:z.number().int().positive(),status:z.enum(["running","unknown"]),reason:z.string().optional(),completedAt:z.string().optional()}).strict(),
   priorLease:z.object({executionId:z.string(),fence:z.string(),policyVersion:z.string(),generation:z.number(),startedAt:z.string(),expiresAt:z.string(),status:z.enum(["running","unknown"]),artifactId:z.string().optional(),completedAt:z.string().optional()}).strict()
  }).strict()).max(10).optional() }).strict();
export type InternalWorkJob = z.infer<typeof jobSchema>;
export type InternalWorkState = { version:1; jobs:InternalWorkJob[]; radioTrainingHistory?:RadioTrainingReceipt[] };
export function parseInternalWork(value:unknown):InternalWorkState {
  if(value === undefined) return {version:1,jobs:[]};
  const state=z.object({version:z.literal(1),jobs:z.array(jobSchema).max(100),radioTrainingHistory:z.array(z.custom<RadioTrainingReceipt>(validRadioTrainingReceipt)).max(100).optional()}).strict().parse(value);
  if(state.radioTrainingHistory && new Set(state.radioTrainingHistory.map(r=>r.id)).size!==state.radioTrainingHistory.length)throw new Error("Duplicate Radio training receipt");
  for(const job of state.jobs) {
    if(Date.parse(job.expiresAt)<=Date.parse(job.startedAt) || (job.status === "completed" && (!job.artifact || job.artifactId !== digest(job.artifact)))) throw new Error("Invalid internal work evidence");
    if(job.artifact && (job.artifact.role !== job.role || digest(job.artifact) !== digest(prepareInternalArtifact(job.role,job.artifact.snapshot,job.artifact.implementationVersion)))) throw new Error("Invalid internal work source");
    if(job.role==="radio" && job.artifact && job.artifact.implementationVersion!==radioImplementationVersion(job.policyVersion,job.generation))throw new Error("Radio artifact policy mismatch");
    if(job.training && (job.role!=="radio" || job.training.id!==job.id || job.training.generation!==job.generation || job.training.appliedPolicyVersion!==job.policyVersion))throw new Error("Invalid Radio training assignment");
  }
  if(new Set(state.jobs.map(j=>j.id)).size !== state.jobs.length || new Set(state.jobs.map(j=>`${j.role}:${j.slot}`)).size !== state.jobs.length) throw new Error("Duplicate internal work assignment");
  return state;
}

/** Exact saved records, without invented recurrence, live-sync, approval or sending claims. */
export function prepareInternalArtifact(role:"ceo"|"assistant"|"radio", raw:InternalWorkSnapshot,implementationVersion?:string) {
  const snapshot=snapshotSchema.parse(raw);
  if(role === "radio") {
    if(!implementationVersion || !snapshot.radio)throw new Error("Radio source or policy unavailable");
    const radioAssignments=snapshot.radio.map(row=>({id:row.id,...executeRadioSlotPolicy(implementationVersion,row.description).assignment}));
    if(new Set(radioAssignments.map(row=>row.id)).size!==radioAssignments.length)throw new Error("Duplicate radio source");
    const text=["Radio: revisión de horarios guardados",`Registros seleccionados: ${snapshot.radio.length}/${snapshot.radioTotal}. Fechas conservadas sin zona; no afirma sincronización ni eventos futuros.`,
      ...snapshot.radio.map((row,index)=>{const slots=radioAssignments[index];return `${row.id} | ${row.scheduledAt} | ${row.title}\n7: ${slots.slot7 || "sin asignación"}; 8: ${slots.slot8 || "sin asignación"}; 9: ${slots.slot9 || "sin asignación"}`;}),
      "No se contactó a DJs ni se modificó el calendario."].join("\n");
    return artifactSchema.parse({version:"internal-planning-v1",role,snapshot,implementationVersion,radioAssignments,text,sourceHash:digest(snapshot),includedIds:radioAssignments.map(row=>row.id),evaluation:{selectedRecordCoverage:1,inventedItems:0,mode:"deterministic-contract"}});
  }
  if(implementationVersion)throw new Error("Unexpected planning implementation");
  const records=role === "ceo" ? [...snapshot.tasks,...snapshot.approvals] : snapshot.tasks;
  const ids=records.map(row=>row.id);
  if(new Set(ids).size !== ids.length) throw new Error("Duplicate source record");
  const clean=(value:string)=>value.replace(/[\r\n\u0000-\u001f<>]/g," ");
  const text=[role === "ceo" ? "Resumen interno de tareas y aprobaciones pendientes" : "Agenda de tareas guardadas",
    "Fuente: registros guardados; no confirma sincronización actual. Fechas sin zona conservadas exactamente; no se expanden recurrencias.",
    "Aprobaciones: estados guardados, no autorización ni confirmación de vigencia; pueden estar aplazadas o vencidas.",
    `Selección acotada: ${snapshot.tasks.length}/${snapshot.taskTotal} tareas${role === "ceo" ? ` y ${snapshot.approvals.length}/${snapshot.approvalTotal} aprobaciones` : ""}. No representa todo el trabajo si faltan registros. Títulos limitados a 500 caracteres.`,
    ...records.map(row=>`[${clean(row.id)}] ${clean(row.title)} | ${row.scheduledAt || "sin fecha"} | ${clean(row.priority)} | ${clean(row.kind)}`),
    records.length ? "No se ha enviado, aprobado ni modificado ninguna acción." : "No hay registros pendientes en la consulta verificada."].join("\n");
  return artifactSchema.parse({version:"internal-planning-v1",role,snapshot,text,sourceHash:digest(snapshot),includedIds:ids,
    evaluation:{selectedRecordCoverage:1,inventedItems:0,mode:"deterministic-contract"}});
}

/** Dedicated SQL snapshot: no storage fallback, global user counts, profile secrets or network connectors. */
export async function readInternalWorkSnapshot(pool:{connect:()=>Promise<{query:(sql:string,args?:unknown[])=>Promise<{rows:any[]}>;release:()=>void}>}, owner:string,includeRadio=false):Promise<InternalWorkSnapshot> {
  if(!owner.trim()) throw new Error("Owner required");
  const client=await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    const identity=await client.query("SELECT id FROM users WHERE id=$1",[owner]);
    if(identity.rows.length !== 1 || identity.rows[0].id !== owner) throw new Error("Canonical owner absent");
    const tasks=await client.query(`SELECT id, left(title,500) AS title, to_char(date,'YYYY-MM-DD"T"HH24:MI:SS') AS "scheduledAt", left(priority,40) AS priority, left(type,80) AS kind, count(*) OVER() AS total FROM tasks WHERE user_id=$1 AND completed=false ORDER BY CASE WHEN priority='high' THEN 0 ELSE 1 END,date,id LIMIT 200`,[owner]);
    const approvals=await client.query(`SELECT id, left(title,500) AS title, NULL AS "scheduledAt", left(risk_level,40) AS priority, left(action_type,80) AS kind, count(*) OVER() AS total FROM pending_actions WHERE user_id=$1 AND status IN ('pending','draft','edited') ORDER BY created_at,id LIMIT 200`,[owner]);
    const clock=await client.query("SELECT clock_timestamp() AS observed");
    const radio=includeRadio?await client.query(`SELECT id,left(title,500) AS title,to_char(date,'YYYY-MM-DD"T"HH24:MI:SS') AS "scheduledAt",description,count(*) OVER() AS total FROM tasks WHERE user_id=$1 AND external_source='google' AND (lower(title) LIKE '%radio%' OR lower(title) LIKE '%black room%') ORDER BY date DESC,id LIMIT 200`,[owner]):undefined;
    const project=(rows:any[])=>rows.map(({total,...row})=>row);
    const snapshot=snapshotSchema.parse({ownerKey:digest(owner),observedAt:new Date(clock.rows[0].observed).toISOString(),tasks:project(tasks.rows),approvals:project(approvals.rows),taskTotal:Number(tasks.rows[0]?.total ?? 0),approvalTotal:Number(approvals.rows[0]?.total ?? 0),...(radio?{radio:project(radio.rows),radioTotal:Number(radio.rows[0]?.total ?? 0)}:{})});
    await client.query("COMMIT"); return snapshot;
  } catch(error) {await client.query("ROLLBACK").catch(()=>{});throw error;} finally {client.release();}
}

export function createInternalWorkRunner(options:{council:Pick<ReturnType<typeof createAgentCouncil>,"updateOfficeExecution">;owner:string;read:(role:"ceo"|"assistant"|"radio")=>Promise<InternalWorkSnapshot>;now?:()=>number;shouldStop?:()=>boolean}) {
  const now=options.now || Date.now;
  return { async tick() {
    for(const role of ["ceo","assistant","radio"] as const) {
      if(options.shouldStop?.()) break;
      const start=now(),slot=new Date(start).toISOString().slice(0,10),id=randomUUID(),fence=randomUUID(); let assignment:InternalWorkJob|undefined;
      const trial=role==="radio"?runRadioTrainingTrial():undefined;
      await options.council.updateOfficeExecution((state,company)=>{
        assignment=undefined; const work=parseInternalWork(state.internalWork);
        const jobs=work.jobs.map(j=>j.status === "running" && Date.parse(j.expiresAt)<=start ? {...j,status:"unknown" as const,reason:"Interrupted; reconcile before retry"}:j);
        if(jobs.some(j=>j.role === role && (j.slot === slot || ["running","unknown"].includes(j.status)))) return {...state,internalWork:{...work,jobs}};
        const qualified=trial && (work.radioTrainingHistory?.length || 0)<100?qualifyRadioIncumbent(state.roles,company,trial,start,id):{roles:state.roles,company,receipt:undefined};
        const active=qualified.roles.roles[role]?.activePolicy;
        if(!active || (role!=="radio" && active.candidateId !== "baseline")) return state;
        if(role==="radio" && radioImplementationVersion(active.version,active.generation)===RADIO_SLOT_CANDIDATE_POLICY && ![...(work.radioTrainingHistory || []),...(qualified.receipt?[qualified.receipt]:[])].some(receipt=>validRadioTrainingReceipt(receipt) && receipt.generation===active.generation && receipt.appliedPolicyVersion===active.version))throw new Error("Radio policy missing qualification receipt");
        const reserved=reserveRoleExecution(qualified.roles,{roleId:role,policyVersion:active.version,executionId:id,fence,now:start,ttlMs:60000});
        if(!reserved.lease) return state;
        assignment={id,role,slot,fence,policyVersion:active.version,generation:active.generation,startedAt:new Date(start).toISOString(),expiresAt:new Date(start+60000).toISOString(),status:"running",...(qualified.receipt?{training:qualified.receipt}:{})};
        Object.assign(company,qualified.company);
        const retained=[...jobs.filter(j=>["running","unknown"].includes(j.status)),...jobs.filter(j=>!["running","unknown"].includes(j.status)).slice(-25)];
        return {...state,roles:reserved.state,internalWork:{...work,jobs:[...retained,assignment],...(qualified.receipt?{radioTrainingHistory:[...(work.radioTrainingHistory || []),qualified.receipt]}:{})}};
      });
      if(!assignment) continue;
      const job:InternalWorkJob=assignment; let artifact:ReturnType<typeof prepareInternalArtifact>|undefined;
      try {
        const source=await options.read(role); if(source.ownerKey !== digest(options.owner) || Date.parse(source.observedAt)<start-30000 || Date.parse(source.observedAt)>now()+30000) throw new Error("Source mismatch");
        artifact=prepareInternalArtifact(role,source,role==="radio"?radioImplementationVersion(job.policyVersion,job.generation):undefined);
      } catch { /* Source failure is not agent misconduct. Persist blocked evidence, never fabricated success. */ }
      await options.council.updateOfficeExecution((state,company)=>{
        const work=parseInternalWork(state.internalWork),stored=work.jobs.find(j=>j.id === job.id);
        if(!stored || stored.status !== "running" || stored.fence !== job.fence) throw new Error("Internal assignment lost");
        const end=now(),artifactId=artifact ? digest(artifact):digest({id:job.id,reason:"canonical_source_unavailable"});
        const result=completeRoleExecution(state.roles,{roleId:role,executionId:job.id,fence:job.fence,policyVersion:job.policyVersion,now:end,artifactId,success:!!artifact});
        const completed:InternalWorkJob=result.accepted ? {...job,status:artifact?"completed":"blocked",completedAt:new Date(end).toISOString(),...(artifact?{artifact,artifactId}:{reason:"canonical_source_unavailable"})} : {...job,status:"unknown",reason:"Lease or generation changed; reconcile"};
        if(result.accepted && artifact) Object.assign(company,advanceCompany(company,{now:end,roles:{[role]:role},statuses:{[role]:{state:"working",label:"Verified internal preparation",evidenceId:job.id}}}).state);
        const radioTrainingHistory=work.radioTrainingHistory?.map(receipt=>role==="radio" && result.accepted && artifact && !receipt.firstVerifiedRunId && receipt.appliedPolicyVersion===job.policyVersion ? {...receipt,firstVerifiedRunId:job.id,firstVerifiedAt:new Date(end).toISOString(),firstExecutionArtifactId:artifactId}:receipt);
        return {...state,roles:result.state,internalWork:{...work,...(radioTrainingHistory?{radioTrainingHistory}:{}),jobs:work.jobs.map(j=>j.id === job.id?completed:j)}};
      });
    }
  }};
}

/** Operator-only, read-only recovery. No route or scheduler calls this function.
 * Caller must independently stop/drain the old worker and retain an audit record.
 * The prior attempt remains unknown; only a fresh fenced read can prove success. */
export async function recoverRadioReadOnly(options:{council:Pick<ReturnType<typeof createAgentCouncil>,"updateOfficeExecution">;owner:string;jobId:string;expectedFence:string;operatorAuditId:string;read:()=>Promise<InternalWorkSnapshot>;now?:()=>number}) {
 const now=options.now || Date.now,start=now(),fence=randomUUID();let admitted:InternalWorkJob|undefined;
 if(!Number.isFinite(start) || !options.owner.trim() || !options.operatorAuditId.trim() || options.operatorAuditId.length>200)throw new Error("Operator audit required");
 await options.council.updateOfficeExecution(state=>{
  admitted=undefined;
  const work=parseInternalWork(state.internalWork),job=work.jobs.find(j=>j.id===options.jobId),role=state.roles.roles.radio;
  const lease=role?.leases.find(l=>l.executionId===options.jobId);
  if(!job || job.role!=="radio" || !["running","unknown"].includes(job.status) || job.fence!==options.expectedFence || job.artifact || job.artifactId || job.completedAt || Date.parse(job.expiresAt)>start || (job.interruptedAttempts?.length || 0)>=10 ||
   !lease || !["running","unknown"].includes(lease.status) || lease.fence!==job.fence || lease.startedAt!==job.startedAt || lease.expiresAt!==job.expiresAt || lease.artifactId || lease.completedAt || Date.parse(lease.expiresAt)>start || lease.generation!==job.generation || lease.policyVersion!==job.policyVersion ||
   role.status!=="active" || role.generation!==job.generation || role.activePolicy?.version!==job.policyVersion || role.activePolicy.generation!==job.generation ||
   role.leases.some(l=>l.executionId!==job.id && ["running","unknown"].includes(l.status)) ||
   !work.radioTrainingHistory?.some(r=>validRadioTrainingReceipt(r) && r.generation===job.generation && r.appliedPolicyVersion===job.policyVersion))throw new Error("Radio recovery not eligible");
  const at=new Date(start).toISOString(),expiresAt=new Date(start+300000).toISOString();
  admitted={...job,fence,startedAt:at,expiresAt,status:"running",reason:undefined,completedAt:undefined,interruptedAttempts:[...(job.interruptedAttempts || []),{fence:job.fence,startedAt:job.startedAt,expiresAt:job.expiresAt,status:"unknown",operatorAuditId:options.operatorAuditId,reconciledAt:at,priorJob:{id:job.id,role:"radio",slot:job.slot,policyVersion:job.policyVersion,generation:job.generation,status:job.status as "running"|"unknown",reason:job.reason,completedAt:job.completedAt},priorLease:{...lease,status:lease.status as "running"|"unknown"}}]};
  return {...state,roles:{...state.roles,roles:{...state.roles.roles,radio:{...role,leases:role.leases.map(l=>l.executionId===job.id?{...l,fence,startedAt:at,expiresAt,status:"running" as const}:l),history:[...role.history,{at,event:"operator_read_only_recovery_prior_attempt_unknown",policyVersion:job.policyVersion,evidenceIds:[options.operatorAuditId,job.fence]}]}}},internalWork:{...work,jobs:work.jobs.map(j=>j.id===job.id?admitted!:j)}};
 });
 if(!admitted)throw new Error("Radio recovery not admitted");
 const job:InternalWorkJob=admitted;let artifact:ReturnType<typeof prepareInternalArtifact>|undefined;
 try {if(now()>=Date.parse(job.expiresAt))throw new Error("Recovery lease expired");const source=await options.read();if(source.ownerKey!==digest(options.owner) || Date.parse(source.observedAt)<start-30000 || Date.parse(source.observedAt)>now()+30000)throw new Error("Source mismatch");artifact=prepareInternalArtifact("radio",source,radioImplementationVersion(job.policyVersion,job.generation));}catch{/* Unknown prior attempt is retained; failed source is not misconduct. */}
 await options.council.updateOfficeExecution(state=>{
  const work=parseInternalWork(state.internalWork),stored=work.jobs.find(j=>j.id===job.id);
  if(!stored || stored.fence!==fence || stored.status!=="running")throw new Error("Radio recovery fence changed");
  const end=now(),artifactId=artifact?digest(artifact):digest({id:job.id,fence,reason:"canonical_source_unavailable"});
  const result=completeRoleExecution(state.roles,{roleId:"radio",executionId:job.id,fence,policyVersion:job.policyVersion,now:end,artifactId,success:!!artifact});
  const completed:InternalWorkJob=result.accepted?{...stored,status:artifact?"completed":"blocked",completedAt:new Date(end).toISOString(),...(artifact?{artifact,artifactId}:{reason:"canonical_source_unavailable"})}:{...stored,status:"unknown",reason:"Recovery lease or generation changed"};
  return {...state,roles:result.state,internalWork:{...work,jobs:work.jobs.map(j=>j.id===job.id?completed:j),radioTrainingHistory:work.radioTrainingHistory?.map(r=>result.accepted && artifact && !r.firstVerifiedRunId && r.generation===job.generation && r.appliedPolicyVersion===job.policyVersion?{...r,firstVerifiedRunId:job.id,firstVerifiedAt:new Date(end).toISOString(),firstExecutionArtifactId:artifactId}:r)}};
 });
 return {jobId:job.id,fence};
}
