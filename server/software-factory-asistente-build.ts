import { createHash } from "node:crypto";
import { createFactoryAsistenteGitHubClient, createFactoryAsistenteGitHubSourceExporter, FACTORY_ASISTENTE_REPOSITORY, type FactoryAsistenteBaseBranch } from "./software-factory-github-client";
import { createFactoryRemotePipelineBuilder } from "./software-factory-remote-builder";
import {createGitHubFactoryChecks} from "./software-factory-actions";
import {createGitHubFactoryCandidatePublisher} from "./software-factory-github-publisher";
import { createOpenAiFactoryPatchGenerator } from "./software-factory-openai-builder";
import { createOpenAiFactoryTextProvider } from "./software-factory-openai";
import { factoryModelProviderArtifact, runFactoryModelCall, type FactoryModelRoute } from "./software-factory-model-routes";
import type { createSharedOpenAiCreditLedger } from "./shared-openai-credit-ledger";
import type { FactoryActionsProfile } from "./software-factory-actions";
import type { FactoryPipelineDependencies } from "./software-factory-pipeline";
import { COMPANY_ORDER_CHECKS_ID, companyOrderChecksAcceptance } from "./software-factory-company-auto";
import { FACTORY_DEFAULT_WRITE_ROOTS, FACTORY_MAX_DRAFT_PULL_REQUESTS_PER_DAY, FACTORY_MAX_FILES_PER_ORDER, utcDayStart, validateFactoryOrderPaths, validateFactoryWriteRoots } from "./software-factory-write-scope";

/** Concrete build-to-PR adapter. Does not install itself, enable a scheduler,
 * deploy, or claim low risk. Credentials stay in the two trusted transports. */
export function createAsistenteFactoryBuild(options: {
  readAcceptance?: Parameters<typeof createGitHubFactoryChecks>[0]["readAcceptance"];
  ledger: ReturnType<typeof createSharedOpenAiCreditLedger>;
  githubRequest: (url: string, init: RequestInit) => Promise<Response>;
  model: Parameters<typeof createOpenAiFactoryTextProvider>[0];
  /** Ordered provider routes (e.g. OpenAI then Claude). Default: [ledger+model]. */
  routes?: readonly FactoryModelRoute[];
  baseBranch: FactoryAsistenteBaseBranch;
  /** Allowed roots; each job's persisted finding.sourcePaths must fit inside. */
  writeRoots?: readonly string[];
  maxFilesPerOrder: number;
  /** Durable owner-wide cap checked before export, model credit or publication. */
  dailyDraftLimit?: { maxPerDay: number; countToday(now: Date, signal: AbortSignal): Promise<number> };
  checks: FactoryActionsProfile;
  maxOutputTokens: number;
  now: () => Date;
  maxPolls?: number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): NonNullable<FactoryPipelineDependencies["build"]> {
  const roots = validateFactoryWriteRoots(options.writeRoots ?? [...FACTORY_DEFAULT_WRITE_ROOTS]), maxFiles = options.maxFilesPerOrder;
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > FACTORY_MAX_FILES_PER_ORDER) throw Error("FACTORY_ASISTENTE_SCOPE_CONFIGURATION_INVALID");
  const limit = options.dailyDraftLimit;
  if (limit && (typeof limit.countToday !== "function" || !Number.isSafeInteger(limit.maxPerDay) || limit.maxPerDay < 1 || limit.maxPerDay > FACTORY_MAX_DRAFT_PULL_REQUESTS_PER_DAY)) throw Error("FACTORY_DRAFT_LIMIT_INVALID");
  const repository = FACTORY_ASISTENTE_REPOSITORY;
  const clientFor=(signal:AbortSignal,paths:readonly string[])=>createFactoryAsistenteGitHubClient({request:async(url,init)=>{signal.throwIfAborted();return options.githubRequest(url,{...init,signal:init.signal?AbortSignal.any([signal,init.signal]):signal});},baseBranch:options.baseBranch,writePaths:paths,allowDispatch:options.checks.trigger==="workflow_dispatch"});
  const model = { ...options.model };
  const maxOutputTokens = options.maxOutputTokens;
  const routes: readonly FactoryModelRoute[] = options.routes?.length ? [...options.routes] : [{ provider: "openai", ledger: options.ledger, model }];
  const profile = { baseBranch: options.baseBranch, checks: { ...options.checks } };
  return async (project, state, context) => {
    if (project.repo !== repository || state.projectId !== project.id || !state.rootJobId || !Number.isSafeInteger(state.repairAttempts) || state.repairAttempts < 0) {
      return { status: "blocked", costCents: 0, reason: "FACTORY_ASISTENTE_SCOPE_INVALID" };
    }
    // Persisted per-order selection: replay, repair and recovery reuse it verbatim.
    let paths: string[];
    try { paths = validateFactoryOrderPaths(state.finding?.sourcePaths, { roots, maxFiles }); }
    catch { return { status: "blocked", costCents: 0, reason: "FACTORY_ASISTENTE_PATHS_INVALID" }; }
    if (limit) {
      const at = options.now(), tomorrow = new Date(Date.parse(utcDayStart(at)) + 86400000).toISOString();
      let used: number;
      try { used = await limit.countToday(at, context.signal); }
      catch { context.signal.throwIfAborted(); return { status: "blocked", costCents: 0, reason: "FACTORY_DAILY_DRAFT_PR_COUNT_UNAVAILABLE", deferUntil: new Date(at.getTime() + 3600000).toISOString() }; }
      if (!Number.isSafeInteger(used) || used < 0 || used >= limit.maxPerDay) return { status: "blocked", costCents: 0, reason: "FACTORY_DAILY_DRAFT_PR_LIMIT", deferUntil: tomorrow };
    }
    const client=clientFor(context.signal,paths);
    const exportSource:ReturnType<typeof createFactoryAsistenteGitHubSourceExporter>=async(repo,sha,destination)=>{
      const signal=AbortSignal.any([context.signal,AbortSignal.timeout(90000)]);
      return createFactoryAsistenteGitHubSourceExporter(clientFor(signal,paths),{sourcePaths:paths,signal})(repo,sha,destination);
    };
    const key = `factory:${createHash("sha256").update(JSON.stringify([project.id, state.rootJobId, state.repairAttempts])).digest("hex")}`;
    let used: { provider: string; model: string } | undefined;
    const generatePatch = createOpenAiFactoryPatchGenerator({ patchMode:"exactSourceEdits", sourcePaths: { [repository]: paths }, maxOutputTokens,
      generateText: async input => {
        const call = await runFactoryModelCall(routes, { key, input, unknownError: "FACTORY_MODEL_OUTCOME_UNKNOWN",
          requestSha256: m => createHash("sha256").update(JSON.stringify([m.model, input.instructions, input.text, input.maxOutputTokens, ("reasoningEffort" in m ? m.reasoningEffort : undefined) ?? null])).digest("hex"),
          evidenceId: requestSha256 => `factory-model:${requestSha256}:${createHash("sha256").update(key).digest("hex").slice(0, 16)}` });
        used = { provider: call.provider, model: call.model };
        return call.result;
      },
    });
    // Scenario is code-owned and persisted at discovery: automatic orders are
    // accepted by the authenticated isolated checks on the exact head; mapped
    // role-work orders keep their measured backend artifact reader.
    const readAcceptance = state.finding?.regressionScenarioId === COMPANY_ORDER_CHECKS_ID ? companyOrderChecksAcceptance : options.readAcceptance;
    const publisher=createGitHubFactoryCandidatePublisher({client,repositories:{[repository]:profile.baseBranch}});
    const checks=createGitHubFactoryChecks({client,repositories:{[repository]:profile.checks},readAcceptance,now:options.now,maxPolls:options.maxPolls,wait:options.wait});
    const build = createFactoryRemotePipelineBuilder({ exportSource,generatePatch,
      prepareCandidate:publisher.prepare,finalizeCandidate:publisher.finalize,verifyCandidate:checks.verifyCandidate,
      preflight:async(project,baseSha,context)=>{
        const [owner,repo]=repository.split("/");
        const ref=await client.git.getRef({owner,repo,ref:`heads/${profile.baseBranch}`});
        if(ref.data.ref!==`refs/heads/${profile.baseBranch}` || ref.data.object.sha!==baseSha)return {allowed:false};
        return {allowed:await checks.preflight(project.repo,baseSha,context.signal)};
      },publicationCostCents:0,now:options.now });
    const built = await build(project, state, context);
    // With provider routes configured, record which provider produced the patch
    // in the persisted test evidence (single-provider evidence is unchanged).
    if (used && options.routes?.length && "tests" in built && built.tests) built.tests = { ...built.tests, artifactIds: [...built.tests.artifactIds, factoryModelProviderArtifact(used)] };
    return built;
  };
}
