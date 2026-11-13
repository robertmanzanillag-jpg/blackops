import { factoryPatchDiagnostics } from "./software-factory-builder";
import { createGitHubFactoryChecks, type FactoryActionsClient, type FactoryActionsProfile } from "./software-factory-actions";
import { createHash } from "node:crypto";
import { mkdtemp, rm, readdir, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FactoryBuilderDependencies } from "./software-factory-builder";
import type { FactoryProject, FactoryCandidate } from "./software-factory";
import type { FactoryPipelineDependencies } from "./software-factory-pipeline";
import { createGitHubFactoryCandidatePublisher, validateFactoryPublicationPatch, type FactoryGitHubPublisherClient, type PreparedFactoryCandidate } from "./software-factory-github-publisher";
export type FactoryRemoteCheckResult = {
    status: "passed";
    costCents: number;
    projectId: string;
    baseSha: string;
    headSha: string;
    testPassed: true;
    buildPassed: true;
    actorId: string;
    artifactIds: string[];
    createdAt: string;
    regressionScenarioIds?: string[];
} | {
    status: "blocked" | "failed" | "unknown";
    costCents: number;
    reason?: string;
};
export type FactoryRemoteCheckContext = {
    signal: AbortSignal;
    maxCostCents: number;
};
export interface FactoryRemoteBuilderOptions {
    /** Operator-owned classifier with exact source and restoration proof. Defaults to unknown. */
    classifyCandidate?: (candidate: PreparedFactoryCandidate) => Promise<Pick<FactoryCandidate, "risk" | "reversible" | "affectsContracts" | "affectsData">>;
    exportSource: NonNullable<FactoryBuilderDependencies["exportSource"]>;
    generatePatch: NonNullable<FactoryBuilderDependencies["generatePatch"]>;
    prepareCandidate: (input: Parameters<NonNullable<FactoryBuilderDependencies["publishPullRequest"]>>[0]) => Promise<PreparedFactoryCandidate>;
    finalizeCandidate: (candidate: PreparedFactoryCandidate) => ReturnType<NonNullable<FactoryBuilderDependencies["publishPullRequest"]>>;
    preflight: (project: FactoryProject, baseSha: string, context: FactoryRemoteCheckContext) => Promise<{
        allowed: boolean;
    }>;
    verifyCandidate: (project: FactoryProject, candidate: PreparedFactoryCandidate, context: FactoryRemoteCheckContext) => Promise<FactoryRemoteCheckResult>;
    /** Verified upper bound for publication overhead. Zero must be explicitly configured. */
    publicationCostCents: number;
    now: () => Date;
}
const protectedName = /^(?:\.env(?:\..*)?|\.git|\.aws|\.ssh|credentials|secrets|node_modules|id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx)$/i;
async function inspect(root: string) {
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
        throw Error("FACTORY_REMOTE_SPECIAL_SOURCE");
    let files = 0, bytes = 0;
    async function visit(dir: string) {
        for (const name of await readdir(dir)) {
            if (protectedName.test(name) || /[\\:\x00-\x1f]/.test(name))
                throw Error("FACTORY_REMOTE_PROTECTED_SOURCE");
            const p = path.join(dir, name), s = await lstat(p);
            if (s.isSymbolicLink() || (!s.isFile() && !s.isDirectory()))
                throw Error("FACTORY_REMOTE_SPECIAL_SOURCE");
            if (++files > 10000 || (bytes += s.isFile() ? s.size : 0) > 16777216)
                throw Error("FACTORY_REMOTE_SOURCE_TOO_LARGE");
            if (s.isDirectory())
                await visit(p);
        }
    }
    await visit(root);
}
/** No repository commands run in the credential-bearing worker. Candidate push
 * can launch remote work, so eligibility precedes model spend and publication. */
export function createFactoryRemotePipelineBuilder(options: FactoryRemoteBuilderOptions): NonNullable<FactoryPipelineDependencies["build"]> {
    const o = { ...options };
    if (!Number.isSafeInteger(o.publicationCostCents) || o.publicationCostCents < 0 || o.publicationCostCents > 10000)
        throw Error("FACTORY_REMOTE_PUBLICATION_COST_REQUIRED");
    return async (rawProject, state, context) => {
        const project = { ...rawProject }, baseSha = state.finding.baseSha, request = state.finding.request;
        const stopped = () => context.signal.throwIfAborted();
        let costCents = 0, uncertain = false, workspace: string | undefined;
        let phase = "INPUT";
        const result = (status: "blocked" | "failed" | "unknown", reason: string) => ({ status, costCents: status === "unknown" ? context.maxCostCents : costCents, reason });
        try {
            if ([o.exportSource, o.generatePatch, o.prepareCandidate, o.finalizeCandidate, o.preflight, o.verifyCandidate, o.now].some(f => typeof f !== "function"))
                return result("blocked", "FACTORY_REMOTE_ADAPTER_REQUIRED");
            if (!/^[a-f0-9]{40}$/.test(baseSha) || !request.trim() || !Number.isSafeInteger(context.maxCostCents) || context.maxCostCents <= o.publicationCostCents)
                return result("blocked", "FACTORY_REMOTE_INPUT_INVALID");
            stopped();
            if (!(await o.preflight(project, baseSha, context)).allowed)
                return result("blocked", "FACTORY_REMOTE_PREFLIGHT_BLOCKED");
            stopped();
            phase = "SOURCE";
            workspace = await mkdtemp(path.join(os.tmpdir(), "factory-remote-"));
            const exported = await o.exportSource(project.repo, baseSha, workspace);
            if (exported.sha !== baseSha)
                throw Error("FACTORY_REMOTE_SOURCE_IDENTITY");
            await inspect(workspace);
            stopped();
            phase = "MODEL";
            uncertain = true;
            const generated = await o.generatePatch({ repository: project.repo, baseSha, request, reservedCents: context.maxCostCents - o.publicationCostCents, testCommand: [], buildCommand: [] }, { workspace, maxCostCents: context.maxCostCents - o.publicationCostCents, signal: context.signal });
            if (!Number.isSafeInteger(generated.costCents) || generated.costCents < 0 || generated.costCents > context.maxCostCents - o.publicationCostCents)
                throw Error("FACTORY_REMOTE_COST_UNCONFIRMED");
            costCents = generated.costCents;
            uncertain = false;
            stopped();
            phase = "PATCH";
            if (!generated.patch && generated.diagnostic && factoryPatchDiagnostics.includes(generated.diagnostic))
                return result("failed", `FACTORY_REMOTE_BUILD_FAILED:${generated.diagnostic}`);
            const changedFiles = validateFactoryPublicationPatch(generated.patch);
            if (changedFiles.some(file => file.split("/")[0].toLowerCase() === ".github"))
                throw Error("FACTORY_REMOTE_WORKFLOW_CHANGE");
            const patchSha256 = createHash("sha256").update(generated.patch).digest("hex");
            uncertain = true;
            phase = "CANDIDATE";
            const candidate = await o.prepareCandidate({ repository: project.repo, baseSha, patch: generated.patch, expectedPatchSha256: patchSha256 });
            costCents += o.publicationCostCents;
            if (candidate.repository !== project.repo || candidate.baseSha !== baseSha || !/^[a-f0-9]{40}$/.test(candidate.headSha) || candidate.patchSha256 !== patchSha256 || JSON.stringify([...candidate.changedFiles].sort()) !== JSON.stringify([...changedFiles].sort()))
                throw Error("FACTORY_REMOTE_CANDIDATE_IDENTITY");
            stopped();
            phase = "CHECKS";
            const checked = await o.verifyCandidate(project, candidate, { signal: context.signal, maxCostCents: context.maxCostCents - costCents });
            if (checked.status === "unknown" || !Number.isSafeInteger(checked.costCents) || checked.costCents < 0 || checked.costCents > context.maxCostCents - costCents)
                throw Error("FACTORY_REMOTE_CHECK_UNCONFIRMED");
            costCents += checked.costCents;
            if (checked.status !== "passed") {
                uncertain = false;
                return result(checked.status, checked.reason ?? "FACTORY_REMOTE_CHECK_FAILED");
            }
            stopped();
            const age = o.now().getTime() - Date.parse(checked.createdAt);
            if (checked.projectId !== project.id || checked.baseSha !== baseSha || checked.headSha !== candidate.headSha || checked.testPassed !== true || checked.buildPassed !== true || !checked.actorId.trim() || !checked.artifactIds.length || checked.artifactIds.some(id => !id.trim()) || !Number.isFinite(age) || age < 0 || age > 3600000)
                throw Error("FACTORY_REMOTE_CHECK_IDENTITY");
            uncertain = true;
            phase = "PR";
            const published = await o.finalizeCandidate(candidate);
            if (published.headSha !== candidate.headSha || published.appliedPatchSha256 !== patchSha256 || (!published.prUrl.startsWith(`https://github.com/${project.repo}/pull/`) || !/^[1-9][0-9]*$/.test(published.prUrl.slice(`https://github.com/${project.repo}/pull/`.length))))
                throw Error("FACTORY_REMOTE_PR_IDENTITY");
            uncertain = false;
            // The PR and evidence are verified. A late abort cannot undo them.
            let classification: Pick<FactoryCandidate, "risk" | "reversible" | "affectsContracts" | "affectsData"> = { risk: "unknown", reversible: false, affectsContracts: true, affectsData: true };
            try {
                const classified = await o.classifyCandidate?.({ ...candidate, changedFiles: [...candidate.changedFiles] });
                if (classified && ["low", "high", "unknown"].includes(classified.risk) && [classified.reversible, classified.affectsContracts, classified.affectsData].every(x => typeof x === "boolean")) classification = classified;
            } catch { /* Preserve the verified PR while leaving release blocked. */ }
            return { costCents, candidate: { projectId: project.id, baseSha, headSha: candidate.headSha, prUrl: published.prUrl, builderId: "factory-remote-builder", risk: classification.risk, reversible: classification.reversible, affectsContracts: classification.affectsContracts, affectsData: classification.affectsData, changedFiles, repairAttempts: state.repairAttempts }, tests: { projectId: project.id, baseSha, headSha: candidate.headSha, kind: "tests", passed: true, warnings: [], actorId: checked.actorId, createdAt: checked.createdAt, artifactIds: checked.artifactIds, journeyIds: checked.regressionScenarioIds } };
        }
        catch {
            return result(uncertain ? "unknown" : "failed", uncertain ? "FACTORY_REMOTE_EXECUTION_UNCONFIRMED" : `FACTORY_REMOTE_BUILD_FAILED:${phase}`);
        }
        finally {
            if (workspace) {
                try {
                    await rm(workspace, { recursive: true, force: true });
                }
                catch {
                    return result("unknown", "FACTORY_REMOTE_CLEANUP_UNCONFIRMED");
                }
            }
        }
    };
}
/** Concrete GitHub composition. Both clients authenticate in trusted control-plane
 * code; source export and model generation remain explicit operator adapters. */
export function createGitHubActionsFactoryBuilder(options: {
    classifyCandidate?: FactoryRemoteBuilderOptions["classifyCandidate"];
    exportSource: FactoryRemoteBuilderOptions["exportSource"];
    generatePatch: FactoryRemoteBuilderOptions["generatePatch"];
    publisherClient: FactoryGitHubPublisherClient;
    actionsClient: FactoryActionsClient;
    repositories: Readonly<Record<string, {
        baseBranch: string;
        checks: FactoryActionsProfile;
    }>>;
    publicationCostCents: number;
    now: () => Date;
    maxPolls?: number;
    wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): NonNullable<FactoryPipelineDependencies["build"]> {
    const entries = Object.entries(options.repositories);
    const publisher = createGitHubFactoryCandidatePublisher({ client: options.publisherClient,
        repositories: Object.fromEntries(entries.map(([repo, profile]) => [repo, profile.baseBranch])) });
    const checks = createGitHubFactoryChecks({ client: options.actionsClient,
        repositories: Object.fromEntries(entries.map(([repo, profile]) => [repo, profile.checks])),
        now: options.now, maxPolls: options.maxPolls, wait: options.wait });
    return createFactoryRemotePipelineBuilder({ exportSource: options.exportSource, classifyCandidate: options.classifyCandidate,
        generatePatch: options.generatePatch, publicationCostCents: options.publicationCostCents,
        now: options.now, prepareCandidate: publisher.prepare, finalizeCandidate: publisher.finalize,
        preflight: async (project, baseSha, context) => ({ allowed: await checks.preflight(project.repo, baseSha, context.signal) }),
        verifyCandidate: checks.verifyCandidate });
}
