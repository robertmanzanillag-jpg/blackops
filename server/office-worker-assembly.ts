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
const protocolPool = requireProtocol ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, allowExitOnIdle: true, connectionTimeoutMillis: 10000, statement_timeout: 15000 , application_name: "blackops-office-protocol" }) : undefined;
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
// Daily credit pacer (server/credit-pacer.ts): spreads the shared grant over its remaining days.
// Every paid office consumer asks it before admitting work; it never reserves or calls a model.
// Without a shared credit ledger there is nothing to pace and the previous limits apply.
// A configured ledger that cannot be read FAILS CLOSED: the gate refuses all paced work.
const pacerRequired=!!process.env.OPENAI_SHARED_CREDIT_CONFIG;
const sharedCredits=academy && pacerRequired && process.env.AGENT_COUNCIL_STORAGE==="postgres"
  ? await (await import("./shared-openai-credit-runtime")).loadSharedCreditRuntime(process.env,()=>new Date()).catch(()=>{console.error("Office credit pacer unavailable: shared credit ledger not readable.");return undefined;})
  : undefined;
const pacerModule=await import("./credit-pacer-runtime");
const {taskTypeOfExecution}=await import("./credit-pacer");
const pacer=sharedCredits && academy?pacerModule.createCreditPacer({readSnapshot:()=>sharedCredits.ledger.paceSnapshot(),readHistory:pacerModule.councilPacerHistory(()=>academy!.load()),env:process.env}):undefined;
const pacerSync=pacer && academy?pacerModule.createCreditPacerSync({council:academy,pacer}):undefined;
// Measured cost samples (statistics only) from the result's usage, with the ledger's own pricing
// and rounding. Kept here so the pinned credit adapters (office-execution / office-shared-credits) stay unchanged.
const recordUsage=(executionId:string,result:unknown)=>{
  try{
    const usage=(result as {usage?:{inputTokens?:unknown;outputTokens?:unknown}}|undefined)?.usage,price=sharedCredits?.pricing;
    if(!pacer||!price||!usage||!Number.isSafeInteger(usage.inputTokens)||!Number.isSafeInteger(usage.outputTokens))return;
    const micro=Number((BigInt(usage.inputTokens as number)*BigInt(price.inputNanoUsdPerToken)+BigInt(usage.outputTokens as number)*BigInt(price.outputNanoUsdPerToken)+999n)/1000n);
    pacer.record({taskType:taskTypeOfExecution(executionId),microUsd:micro,outputTokens:usage.outputTokens as number,at:Date.now()});
  }catch{/* statistics only */}
};
const pacerGate=pacerModule.createPacerGate({pacer,required:pacerRequired});
if(pacerGate.refusing)console.error("Office credit pacer unavailable with a configured ledger: paid office work and new self-heal orders are refused this run.");
/** Fail closed: an unreadable pace admits no new paid work of that priority. */
const paceAllows=(priority:"standard"|"deferrable",taskType:import("./credit-pacer").PacerTaskType)=>pacerGate.allows(priority,taskType);
const syncPacer=async()=>{if(pacerSync){try{await pacerSync();}catch{console.error("Office credit pacer sync unconfirmed; it will be retried on the next cycle.");}}};
// Soft mode (read once per invocation; the cloud runs every 15 minutes) lowers the reviewer's output limit.
const reviewerEnv=pacer?{...process.env,OFFICE_OPENAI_MAX_OUTPUT_TOKENS:String(await pacerGate.outputTokens(Number(process.env.OFFICE_OPENAI_MAX_OUTPUT_TOKENS||"2048")))}:process.env;
const executionBase = reviewOnlyOwner && academy ? (await import("./office-execution")).createOfficeExecution(academy,reviewerEnv) : undefined;
// Reviewer tasks are standard priority: claimed only while today's allowance has room.
const execution = executionBase ? { ...executionBase, admission: pacerGate.admission(executionBase.admission) } : undefined;
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
// Self-heal is on by default; without real role audits it has nothing to verify, so it stays idle
// (static notice) instead of stopping the whole office run.
if(selfHealConfig.enabled && !roleWorkEnabled)console.error("Office self-heal idle: it requires real role audits (OFFICE_ROLE_WORK_ENABLED=true).");
// No fixed daily order cap: with the pacer, orders open while today's allowance can fund their
// measured factory cost (one per finding, deduped; the factory's own daily draft PR cap still applies).
const selfHealModule=await import("./office-self-heal");
const selfHeal=selfHealConfig.enabled && roleWork && academy?selfHealModule.createSelfHealRunner({council:academy,owner:getSystemUserId(),
  maxPerDay:pacerGate.governed?selfHealConfig.maxPerDay:Math.min(selfHealConfig.maxPerDay,selfHealModule.SELF_HEAL_UNPACED_ORDERS_PER_DAY),
  maxOpenOrders:selfHealConfig.maxOpenOrders,
  extraAudits:async()=>{const {readStreamerSelfHealAudits}=await import("./clippers-streamers-status");const {readCloudLanesSelfHealAudits}=await import("./clippers-cloud-lanes-status");
    const owner=getSystemUserId();const [streamers,lanes]=await Promise.all([readStreamerSelfHealAudits(owner),readCloudLanesSelfHealAudits(owner).catch(()=>[])]);return [...streamers,...lanes];},
  ...(pacerGate.governed?{fundableOrders:()=>pacerGate.fundable("self_heal_order")}:{})}):undefined;
const roleExecution=roleAcademyEnabled && academy?(await import("./office-execution")).createOfficeExecution(academy,{...process.env,OPENAI_SHARED_CREDITS_REQUIRED:"true",OFFICE_OPENAI_MAX_OUTPUT_TOKENS:"1536"}):undefined;
const roleAcademy=roleExecution && academy?(await import("./office-role-academy")).createRoleAcademyRunner({council:academy,dailyPairs:Number(process.env.OFFICE_ROLE_ACADEMY_DAILY_PAIRS),shouldStop,run:async(prompt,call)=>{
  const result=await roleExecution.run(prompt,call.executionId);recordUsage(call.executionId,result);
  if(!("provider" in result) || result.provider!=="openai" || !("usage" in result))throw new Error("Role academy requires measured OpenAI execution.");
  return result as import("./office-openai").OfficeOpenAIResult;
}}):undefined;
// Black Room area of the academy: same measured, budget-admitted execution as the role academy,
// its own bounded daily pairs (OFFICE_BLACKROOM_ACADEMY_DAILY_PAIRS, 1..14). Off when unset.
const blackroomAcademy=roleExecution && academy && process.env.OFFICE_BLACKROOM_ACADEMY_DAILY_PAIRS?(await import("./office-academy-blackroom")).createBlackRoomAcademyRunner({council:academy,dailyPairs:Number(process.env.OFFICE_BLACKROOM_ACADEMY_DAILY_PAIRS),shouldStop,
  loadLessons:async()=>(await (await import("./blackroom-team/lessons")).syncBlackRoomLessons()).rules,
  run:async(prompt,call)=>{
  const result=await roleExecution.run(prompt,call.executionId);recordUsage(call.executionId,result);
  if(!("provider" in result) || result.provider!=="openai" || !("usage" in result))throw new Error("Black Room academy requires measured OpenAI execution.");
  return result as import("./office-openai").OfficeOpenAIResult;
}}):undefined;
const capabilityModule=capabilityEnabled?await import("./office-capability-training"):undefined;
const capabilityCredits=capabilityModule?sharedCredits ?? await (await import("./shared-openai-credit-runtime")).loadSharedCreditRuntime(process.env,()=>new Date()):undefined;
const capabilityExecution=capabilityCredits && academy?(await import("./office-execution")).createOfficeExecution(academy,{...process.env,OPENAI_SHARED_CREDITS_REQUIRED:"true",OFFICE_OPENAI_MAX_OUTPUT_TOKENS:"768"},Date.now,{sharedCredits:capabilityCredits}):undefined;
const capabilityTrainer=capabilityModule && capabilityCredits && capabilityExecution && academy?capabilityModule.createCapabilityTrainer({owner:getSystemUserId(),maxCallsPerDay:Number(process.env.OFFICE_CAPABILITY_MAX_CALLS_PER_DAY),shouldStop,model:process.env.OFFICE_OPENAI_MODEL||undefined,
 loadWork:async()=>{const state=await academy!.load();return (await import("./office-role-work")).parseRoleWork(state.officeExecution?.roleWork,getSystemUserId());},
 transact:async change=>{const saved=await academy!.updateOfficeExecution((state,company)=>{
  const current=capabilityModule.parseCapabilityTraining(state.capabilityTraining,getSystemUserId());
  const next=change(current,Object.fromEntries(Object.entries(company.careers).map(([role,career])=>[role,career.generation])),Boolean(company.academyJobs?.some(j=>j.status==="running") || state.roleAcademy?.jobs.some(j=>j.status==="running")));
  capabilityModule.parseCapabilityTraining(next,getSystemUserId());return {...state,capabilityTraining:next};
 });return saved.capabilityTraining!;},
 run:async(prompt,call)=>{const result=await capabilityExecution.run(prompt,call.executionId);recordUsage(call.executionId,result);if(!("provider" in result) || result.provider!=="openai" || !("usage" in result))throw Error("Measured OpenAI execution required");return result as import("./office-openai").OfficeOpenAIResult;},
 verifyCost:(await import("./office-training-receipts")).createTrainingReceiptReader(capabilityCredits),
}):undefined;
const worker = createOfficeCloudWorker({ scheduledKongOwner, reviewOnlyOwner, ...(options.workerId ? { workerId: options.workerId } : {}), ...(execution ? { execute: execution.execute, probeClaude: execution.probe, admission: execution.admission } : {}) });
const council = academy;
// The academy block below is the PC worker's fifteen-minute cycle, unchanged.
// Pacer priorities: role audits (free) and in-flight work are essential; reviewer tasks and
// self-heal orders are standard; academies and capability training are deferrable (soft mode waits).
const academyCycle = council ? async () => {
  await syncPacer();
  await council.runCycle();
  if (!shouldStop() && process.env.OFFICE_ACADEMY_EXECUTION_ENABLED === "true" && await paceAllows("deferrable","reviewer_academy")) await council.runAcademyCycle();
  if(internal && !shouldStop()) await internal.tick();
  if(businessWork && !shouldStop()) await businessWork.tick();
  if(revenueWork && !shouldStop()) await revenueWork.tick();
  if(webSourcesEnabled && !shouldStop()){try{await (await import("./office-web-source-scheduler")).warmOfficeWebSources(process.env.OFFICE_WEB_SOURCE_ORIGIN!);}catch{console.error("Office source host wake unconfirmed; audits will validate stored source freshness independently.");}}
  if(editorialWork && !shouldStop()) await editorialWork.tick();
  if(roleWork && !shouldStop()) await roleWork.tick();
  if(selfHeal && !shouldStop()){try{await selfHeal.tick();}catch{console.error("Office self-heal step unconfirmed; it will be reconciled on the next cycle.");}}
  if(roleAcademy && !shouldStop() && await paceAllows("deferrable","academy_pair")) await roleAcademy.tick();
  if(blackroomAcademy && !shouldStop() && await paceAllows("deferrable","blackroom_pair")) await blackroomAcademy.tick();
  // The web scheduler is disabled in this deployment. Preserve the
  // scout's durable daily cadence here; it only reads public releases.
  if (!shouldStop()) await council.runScout();
  await syncPacer();
} : undefined;
const capabilityTick = capabilityTrainer ? async () => {
  if(!(await paceAllows("deferrable","capability_training")))return;
  await capabilityTrainer.tick();
  if(pacer?.pendingSamples())await syncPacer();
} : undefined;
return { worker, checkProtocol, academyCycle, capabilityTick, runOnce, protocolPool, close: async () => { if(pacer?.pendingSamples())await syncPacer(); await protocolPool?.end(); } };
} catch (error) { await protocolPool?.end(); throw error; }
}
