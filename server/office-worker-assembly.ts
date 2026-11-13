import { createOfficeCloudWorker } from "./office-cloud-runtime";
import { getSystemUserId } from "./user-context";
import { assertOfficeProtocolReady } from "./office-protocol";
import pg from "pg";

/**
 * Shared, reviewed wiring for the office executor. Used unchanged by the
 * long-running PC worker (script/office-worker.ts) and by the bounded cloud
 * invocation (script/office-worker-once.ts). It never loads repository .env
 * files; the PC entrypoint keeps its own env-loader import.
 */
export async function assembleOfficeWorker(options: { shouldStop: () => boolean; workerId?: string }) {
const shouldStop = options.shouldStop;
if (process.env.OFFICE_WORKER_ENABLED !== "true") throw new Error("OFFICE_WORKER_ENABLED=true is required for the dedicated office worker.");
const internalEnabled=process.env.OFFICE_INTERNAL_WORK_ENABLED === "true";
const roleWorkEnabled=process.env.OFFICE_ROLE_WORK_ENABLED === "true";
const webSourcesEnabled=process.env.OFFICE_WEB_SOURCES_ENABLED === "true";
if(webSourcesEnabled && (!roleWorkEnabled || !process.env.OFFICE_WEB_SOURCE_ORIGIN))throw new Error("Web source origin and role work must be configured together.");
const roleAcademyEnabled=process.env.OFFICE_ROLE_ACADEMY_ENABLED === "true";
const capabilityEnabled=process.env.OFFICE_CAPABILITY_TRAINING_ENABLED === "true";
if(capabilityEnabled && (!roleWorkEnabled || process.env.OFFICE_REVIEW_PROVIDER!=="openai" || !process.env.OPENAI_SHARED_CREDIT_CONFIG))throw new Error("Capability training requires real role audits and shared credit admission.");
if(roleAcademyEnabled && (process.env.OFFICE_REVIEW_PROVIDER!=="openai" || !process.env.OPENAI_SHARED_CREDIT_CONFIG))throw new Error("Role academy requires the verified shared credit ledger.");
const requireProtocol = roleWorkEnabled || roleAcademyEnabled || internalEnabled || process.env.OFFICE_REVIEW_PROVIDER === "openai" || process.env.OFFICE_WORKER_REVIEW_ONLY === "true" || process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true";
if (requireProtocol && process.env.AGENT_COUNCIL_STORAGE !== "postgres") throw new Error("Dedicated council storage is required.");
const protocolPool = requireProtocol ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, allowExitOnIdle: true, connectionTimeoutMillis: 10000, statement_timeout: 15000 }) : undefined;
const checkProtocol = async () => {
  if (protocolPool) await assertOfficeProtocolReady(protocolPool, getSystemUserId(), process.env.OFFICE_EXPECTED_WEB_REVISION || "");
};
try {
await checkProtocol();
let scheduledKongOwner: string | undefined;
if (process.env.OFFICE_KONG_AUDIT_SCHEDULE_ENABLED === "true") {
  try { scheduledKongOwner = getSystemUserId(); }
  catch { console.error("Recurring KONG audits require a configured office owner"); }
}
const reviewOnlyOwner = process.env.OFFICE_WORKER_REVIEW_ONLY === "true" ? getSystemUserId() : undefined;
const runOnce = process.env.OFFICE_WORKER_RUN_ONCE === "true";
if (runOnce && !reviewOnlyOwner) throw new Error("Single-pass workers require OFFICE_WORKER_REVIEW_ONLY=true.");
let academy: Awaited<ReturnType<typeof import("./agent-council")["getAgentCouncil"]>> | undefined;
if (roleWorkEnabled || roleAcademyEnabled || internalEnabled || process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true" || reviewOnlyOwner) {
  const module = await import("./agent-council");
  module.setAgentCouncilUser(getSystemUserId());
  academy = module.getAgentCouncil();
}
if (process.env.OFFICE_REVIEW_PROVIDER === "openai" && !reviewOnlyOwner) throw new Error("OpenAI requires the owner-scoped review-only worker.");
const execution = reviewOnlyOwner && academy ? (await import("./office-execution")).createOfficeExecution(academy) : undefined;
const internalModule=internalEnabled ? await import("./office-internal-work"):undefined;
const internal=internalModule && academy && protocolPool ? internalModule.createInternalWorkRunner({council:academy,owner:getSystemUserId(),read:role=>internalModule.readInternalWorkSnapshot(protocolPool,getSystemUserId(),role==="radio"),shouldStop}):undefined;
const businessModule=internalEnabled ? await import("./office-business-work"):undefined;
const businessWork=businessModule && academy && protocolPool ? businessModule.createBusinessWorkRunner({pool:protocolPool,owner:getSystemUserId(),getGeneration:async role=>businessModule.eligibleBusinessGeneration((await academy!.load()).company.careers[role]),shouldStop}):undefined;
const editorialWork=businessModule && academy && protocolPool && webSourcesEnabled ? (await import("./office-editorial-work")).createEditorialWorkRunner({pool:protocolPool,owner:getSystemUserId(),configuredOwner:getSystemUserId(),getGeneration:async role=>businessModule.eligibleBusinessGeneration((await academy!.load()).company.careers[role]),shouldStop}):undefined;
const revenueWork=businessModule && academy && protocolPool ? (await import("./office-revenue-work")).createRevenueWorkRunner({pool:protocolPool,owner:getSystemUserId(),getGeneration:async role=>businessModule.eligibleBusinessGeneration((await academy!.load()).company.careers[role]),shouldStop}):undefined;
const roleWork=roleWorkEnabled && academy && protocolPool?(await import("./office-role-work")).createRoleWorkRunner({council:academy,owner:getSystemUserId(),read:role=>import("./office-role-snapshots").then(module=>module.readRoleSnapshot(protocolPool,getSystemUserId(),role)),readGithub:role=>import("./office-github-role-source").then(module=>module.readGithubRoleSnapshot({pool:protocolPool,owner:getSystemUserId(),role,token:process.env.GITHUB_TOKEN||null})),...(webSourcesEnabled?{readWeb:(role:import("./office-web-role-sources").WebSourceRole)=>import("./office-web-role-live").then(module=>module.readWorkerWebRoleSource({pool:protocolPool,owner:getSystemUserId(),configuredOwner:getSystemUserId(),role}))}:{}),shouldStop}):undefined;
// Self-heal (default off): turns allowlisted small code findings into bounded system orders and
// verifies the fix with the next daily audits. Requires role audits; never merges or deploys.
const selfHealConfig=(await import("./office-self-heal")).selfHealSettings(process.env);
if(selfHealConfig.enabled && !roleWorkEnabled)throw new Error("Office self-heal requires real role audits (OFFICE_ROLE_WORK_ENABLED=true).");
const selfHeal=selfHealConfig.enabled && roleWork && academy?(await import("./office-self-heal")).createSelfHealRunner({council:academy,owner:getSystemUserId(),maxPerDay:selfHealConfig.maxPerDay}):undefined;
const roleExecution=roleAcademyEnabled && academy?(await import("./office-execution")).createOfficeExecution(academy,{...process.env,OPENAI_SHARED_CREDITS_REQUIRED:"true",OFFICE_OPENAI_MAX_OUTPUT_TOKENS:"1536"}):undefined;
const roleAcademy=roleExecution && academy?(await import("./office-role-academy")).createRoleAcademyRunner({council:academy,dailyPairs:Number(process.env.OFFICE_ROLE_ACADEMY_DAILY_PAIRS),shouldStop,run:async(prompt,call)=>{
  const result=await roleExecution.run(prompt,call.executionId);
  if(!("provider" in result) || result.provider!=="openai" || !("usage" in result))throw new Error("Role academy requires measured OpenAI execution.");
  return result as import("./office-openai").OfficeOpenAIResult;
}}):undefined;
// Black Room area of the academy: same measured, budget-admitted execution as the role academy,
// its own bounded daily pairs (OFFICE_BLACKROOM_ACADEMY_DAILY_PAIRS, 1..14). Off when unset.
const blackroomAcademy=roleExecution && academy && process.env.OFFICE_BLACKROOM_ACADEMY_DAILY_PAIRS?(await import("./office-academy-blackroom")).createBlackRoomAcademyRunner({council:academy,dailyPairs:Number(process.env.OFFICE_BLACKROOM_ACADEMY_DAILY_PAIRS),shouldStop,
  loadLessons:async()=>(await (await import("./blackroom-team/lessons")).syncBlackRoomLessons()).rules,
  run:async(prompt,call)=>{
  const result=await roleExecution.run(prompt,call.executionId);
  if(!("provider" in result) || result.provider!=="openai" || !("usage" in result))throw new Error("Black Room academy requires measured OpenAI execution.");
  return result as import("./office-openai").OfficeOpenAIResult;
}}):undefined;
const capabilityModule=capabilityEnabled?await import("./office-capability-training"):undefined;
const capabilityCredits=capabilityModule?await (await import("./shared-openai-credit-runtime")).loadSharedCreditRuntime(process.env,()=>new Date()):undefined;
const capabilityExecution=capabilityCredits && academy?(await import("./office-execution")).createOfficeExecution(academy,{...process.env,OPENAI_SHARED_CREDITS_REQUIRED:"true",OFFICE_OPENAI_MAX_OUTPUT_TOKENS:"768"},Date.now,{sharedCredits:capabilityCredits}):undefined;
const capabilityTrainer=capabilityModule && capabilityCredits && capabilityExecution && academy?capabilityModule.createCapabilityTrainer({owner:getSystemUserId(),maxCallsPerDay:Number(process.env.OFFICE_CAPABILITY_MAX_CALLS_PER_DAY),shouldStop,
 loadWork:async()=>{const state=await academy!.load();return (await import("./office-role-work")).parseRoleWork(state.officeExecution?.roleWork,getSystemUserId());},
 transact:async change=>{const saved=await academy!.updateOfficeExecution((state,company)=>{
  const current=capabilityModule.parseCapabilityTraining(state.capabilityTraining,getSystemUserId());
  const next=change(current,Object.fromEntries(Object.entries(company.careers).map(([role,career])=>[role,career.generation])),Boolean(company.academyJobs?.some(j=>j.status==="running") || state.roleAcademy?.jobs.some(j=>j.status==="running")));
  capabilityModule.parseCapabilityTraining(next,getSystemUserId());return {...state,capabilityTraining:next};
 });return saved.capabilityTraining!;},
 run:async(prompt,call)=>{const result=await capabilityExecution.run(prompt,call.executionId);if(!("provider" in result) || result.provider!=="openai" || !("usage" in result))throw Error("Measured OpenAI execution required");return result as import("./office-openai").OfficeOpenAIResult;},
 verifyCost:(await import("./office-training-receipts")).createTrainingReceiptReader(capabilityCredits),
}):undefined;
const worker = createOfficeCloudWorker({ scheduledKongOwner, reviewOnlyOwner, ...(options.workerId ? { workerId: options.workerId } : {}), ...(execution ? { execute: execution.execute, probeClaude: execution.probe, admission: execution.admission } : {}) });
const council = academy;
// The academy block below is the PC worker's fifteen-minute cycle, unchanged.
const academyCycle = council ? async () => {
  await council.runCycle();
  if (!shouldStop() && process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true") await council.runAcademyCycle();
  if(internal && !shouldStop()) await internal.tick();
  if(businessWork && !shouldStop()) await businessWork.tick();
  if(revenueWork && !shouldStop()) await revenueWork.tick();
  if(webSourcesEnabled && !shouldStop()){try{await (await import("./office-web-source-scheduler")).warmOfficeWebSources(process.env.OFFICE_WEB_SOURCE_ORIGIN!);}catch{console.error("Office source host wake unconfirmed; audits will validate stored source freshness independently.");}}
  if(editorialWork && !shouldStop()) await editorialWork.tick();
  if(roleWork && !shouldStop()) await roleWork.tick();
  if(selfHeal && !shouldStop()){try{await selfHeal.tick();}catch{console.error("Office self-heal step unconfirmed; it will be reconciled on the next cycle.");}}
  if(roleAcademy && !shouldStop()) await roleAcademy.tick();
  if(blackroomAcademy && !shouldStop()) await blackroomAcademy.tick();
  // The web scheduler is disabled in this deployment. Preserve the
  // scout's durable daily cadence here; it only reads public releases.
  if (!shouldStop()) await council.runScout();
} : undefined;
const capabilityTick = capabilityTrainer ? () => capabilityTrainer.tick() : undefined;
return { worker, checkProtocol, academyCycle, capabilityTick, runOnce, protocolPool, close: async () => { await protocolPool?.end(); } };
} catch (error) { await protocolPool?.end(); throw error; }
}
