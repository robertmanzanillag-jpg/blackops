import {ROLE_WORK_DEADLINE_ID} from "./software-factory-role-deadline";
import { createHash } from "node:crypto";
import { readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CompanyOrder } from "../shared/agent-company";
import type { FactoryEvidence } from "./software-factory";
import type { FactoryJobInput } from "./software-factory-store";
import { configuredSoftwareFactoryStore } from "./software-factory-store-provider";
import { loadSharedCreditRuntime } from "./shared-openai-credit-runtime";
import { getCouncilStore } from "./agent-council-store";
import { companyOrderJob, createCompanyOrderDiscovery, ASISTENTE_REPOSITORY } from "./software-factory-company";
import { createFactoryCompanyOrderScheduler } from "./software-factory-company-scheduler";
import { createTrustedFactoryProposalWorkerOptions } from "./software-factory-runtime";
import { createAsistenteFactoryBuild } from "./software-factory-asistente-build";
import { createAsistenteIndependentReview } from "./software-factory-asistente-review";
import { createAsistenteReviewSourceLoader } from "./software-factory-asistente-source";
import { createFactoryAsistenteGitHubClient, FACTORY_ASISTENTE_BASE_BRANCHES } from "./software-factory-github-client";
import { createAsistenteGitHubTransport } from "./software-factory-github-transport";
import { createFactoryOpenAiTransport } from "./software-factory-openai-transport";
import { createRoleAcceptanceArtifactReader } from "./software-factory-role-artifact";
import { createOfficeUiArtifactReader } from "./software-factory-office-ui-artifact";
import { ROLE_WORK_ACCEPTANCE_ID } from "./software-factory-role-acceptance";
import { FACTORY_DEFAULT_WRITE_ROOTS, FACTORY_MAX_DRAFT_PULL_REQUESTS_PER_DAY, FACTORY_MAX_FILES_PER_ORDER, utcDayStart, validateFactoryOrderPaths, validateFactoryWriteRoots } from "./software-factory-write-scope";
import type { FactoryJob } from "./software-factory-store";
import { createFactoryOfficeReviewSweep, type FactoryOfficeReviewEnqueue } from "./software-factory-office-review";
import { readFactoryOrderProposals } from "./software-factory-order-evidence";
import { COMPANY_ORDER_CHECKS_ID, createFactoryOrderFileSelector, isFactoryTestPath, listFactorySelectablePaths } from "./software-factory-company-auto";
import { isSelfHealOrder, isValidSelfHealOrder } from "./office-self-heal";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sha = z.string().regex(/^[a-f0-9]{40}$/), digest = z.string().regex(/^[a-f0-9]{64}$/);
const cents = z.number().int().min(1).max(100);
const configSchema = z.object({ owner: z.string().min(1).max(200), projectId: z.literal("asistente"), baseBranch: z.enum(FACTORY_ASISTENTE_BASE_BRANCHES),
    writeRoots: z.array(z.string().min(1).max(200)).min(1).max(16).default([...FACTORY_DEFAULT_WRITE_ROOTS]),
    maxFilesPerOrder: z.number().int().min(1).max(FACTORY_MAX_FILES_PER_ORDER).default(6),
    maxDraftPullRequestsPerDay: z.number().int().min(1).max(FACTORY_MAX_DRAFT_PULL_REQUESTS_PER_DAY).default(5),
    checks: z.object({ trigger: z.literal("push"), workflowId: z.number().int().positive(), workflowPath: z.literal(".github/workflows/factory-candidate-checks.yml"), workflowSha256: digest, jobName: z.string().min(1), testStep: z.string().min(1), buildStep: z.string().min(1), browserStep: z.string().min(1) }).strict(),
    allowGitHubResultsAzureHosts: z.boolean().default(false),
    archiveHosts: z.array(z.string().regex(/^[-a-z0-9]+\.blob\.core\.windows\.net$/)).min(1).max(10),
    reservations: z.object({ discover: cents, build: cents, simulate: cents, review: cents }).strict(), maxOutputTokens: z.number().int().min(16).max(8192), maxInputTokens: z.number().int().min(1).max(100000),
    orders: z.array(z.object({ id: z.string().min(1).max(200), revision: digest, baseSha: sha, kind: z.enum(["bug", "improvement"]), scenarioId: z.enum([ROLE_WORK_ACCEPTANCE_ID,ROLE_WORK_DEADLINE_ID]), paths: z.array(z.string().min(1).max(1000)).min(1).max(FACTORY_MAX_FILES_PER_ORDER) }).strict()).max(5),
    ui: z.object({ workflowSha256: digest, harnessSha256: digest, workflowId: z.number().int().positive() }).strict(),
    /** Automatic admission of eligible owner orders created at or after since.
     * Absent means disabled. Explicit orders[] mappings take precedence. */
    autoAdmit: z.object({ enabled: z.boolean(), since: z.string().datetime(), maxPerDay: z.number().int().min(1).max(FACTORY_MAX_DRAFT_PULL_REQUESTS_PER_DAY).optional(),
        /** Also admit system-authored office self-heal orders (fixed template, integrity-checked). Default false. */
        systemOrders: z.boolean().optional() }).strict().optional(),
}).strict().superRefine((config, issue) => {
    if (config.autoAdmit?.maxPerDay !== undefined && config.autoAdmit.maxPerDay > config.maxDraftPullRequestsPerDay) issue.addIssue({ code: "custom", path: ["autoAdmit", "maxPerDay"], message: "FACTORY_AUTO_ADMIT_LIMIT_INVALID" });
    // Code-owned denials apply even when configuration tries to widen scope.
    try { validateFactoryWriteRoots(config.writeRoots); } catch { issue.addIssue({ code: "custom", path: ["writeRoots"], message: "FACTORY_WRITE_ROOTS_INVALID" }); return; }
    config.orders.forEach((order, index) => {
        try { validateFactoryOrderPaths(order.paths, { roots: config.writeRoots, maxFiles: config.maxFilesPerOrder }); }
        catch { issue.addIssue({ code: "custom", path: ["orders", index, "paths"], message: "FACTORY_ORDER_PATHS_INVALID" }); return; }
        // The pipeline requires a permanent regression test in every candidate.
        if (!order.paths.some(isFactoryTestPath)) issue.addIssue({ code: "custom", path: ["orders", index, "paths"], message: "FACTORY_ORDER_TEST_PATH_REQUIRED" });
    });
});
export type AsistenteOperatorConfig = z.input<typeof configSchema>;
/** Strict noncredential operator configuration validation; no I/O or admission. */
export function validateAsistenteOperatorConfig(raw:unknown){return configSchema.parse(structuredClone(raw));}
/** Draft PRs (or possibly published, unreconciled builds) started or finished
 * in the current UTC day. Uses the bounded store listing and fails closed when
 * the window cannot prove the full day is covered. */
export function countDraftPullRequestsToday(jobs: readonly FactoryJob[], now: Date, ownerKey: string, listLimit = 100): number {
    const since = Date.parse(utcDayStart(now));
    if (!Array.isArray(jobs)) throw Error("FACTORY_DRAFT_COUNT_UNVERIFIED");
    if (jobs.length >= listLimit && jobs.every(job => Date.parse(job.createdAt) >= since)) throw Error("FACTORY_DRAFT_COUNT_UNVERIFIED");
    return jobs.filter(job => {
        if (job.ownerKey !== ownerKey || job.kind !== "build") return false;
        const created = Date.parse(job.createdAt), completed = Date.parse(job.completedAt ?? "");
        if (!(created >= since || completed >= since)) return false;
        const result = job.result as { reconciled?: unknown; evidence?: { pipelineState?: { candidate?: { prUrl?: unknown } } } } | undefined;
        return typeof result?.evidence?.pipelineState?.candidate?.prUrl === "string" || job.status === "unknown" || result?.reconciled === true;
    }).length;
}
/** Automatic (not explicitly mapped) order admissions created in the current
 * UTC day. Fails closed like the draft count when the window is unprovable. */
export function countAutoAdmissionsToday(jobs: readonly FactoryJob[], now: Date, ownerKey: string, isMapped: (orderId: string, revision: string) => boolean, listLimit = 100): number {
    const since = Date.parse(utcDayStart(now));
    if (!Array.isArray(jobs) || (jobs.length >= listLimit && jobs.every(job => Date.parse(job.createdAt) >= since))) throw Error("FACTORY_AUTO_ADMISSION_COUNT_UNVERIFIED");
    return jobs.filter(job => {
        const source = job.payload?.companyOrder as { orderId?: unknown; revision?: unknown } | undefined;
        return job.ownerKey === ownerKey && job.kind === "discover" && Date.parse(job.createdAt) >= since && typeof source?.orderId === "string" && typeof source.revision === "string" && !isMapped(source.orderId, source.revision);
    }).length;
}
/** Admission-side variant: an unprovable count defers admission (no hold). */
function countDraftPullRequestsTodaySafe(jobs: readonly FactoryJob[], now: Date, ownerKey: string) { try { return countDraftPullRequestsToday(jobs, now, ownerKey); } catch { return Number.POSITIVE_INFINITY; } }
export type OperatorUiReader = (input: {
    projectId: string;
    baseSha: string;
    headSha: string;
    runId: number;
    signal: AbortSignal;
}) => Promise<FactoryEvidence>;
type Store = typeof configuredSoftwareFactoryStore;
const newestFirst = (a: CompanyOrder, b: CompanyOrder) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id);
type Credits = Awaited<ReturnType<typeof loadSharedCreditRuntime>>;
/** Concrete PR-only composition. All external handles originate in the trusted
 * launcher. Admission is a no-provider hold, not a promise of whole-job funding. */
export function createAsistenteOperatorComposition(raw: AsistenteOperatorConfig, deps: {
    store: Store;
    credits: Credits;
    readOrders: (owner: string) => Promise<CompanyOrder[]>;
    githubRequest: (url: string, init: RequestInit) => Promise<Response>;
    modelRequest: (url: string, init: RequestInit) => Promise<Response>;
    download: typeof fetch;
    readUi: OperatorUiReader;
    recoveryPrevious?: import('./software-factory-pipeline').FactoryPipelineDependencies['recoveryPrevious'];
    /** Optional office handoff (operator flag). Enqueues one read-only office
     * review per verified draft PR head; no factory provider call. */
    enqueueOfficeReview?: FactoryOfficeReviewEnqueue;
    /** Optional office career sweep (operator flag): scores committed stage rows
     * into the factory engineers' main-company careers. No provider call. */
    scoreOfficeCareers?: () => Promise<unknown>;
    /** Optional office self-heal evidence sync (OFFICE_SELF_HEAL_ENABLED). No provider call. */
    syncSelfHeal?: () => Promise<unknown>;
    log?: (message: string) => void;
    now: () => Date;
}) {
    const config = validateAsistenteOperatorConfig(raw), { store, credits, now } = deps;
    if (config.ui.workflowId !== config.checks.workflowId || config.ui.workflowSha256 !== config.checks.workflowSha256 || new Set(config.orders.map(o => o.id)).size !== config.orders.length || typeof deps.readUi !== "function")
        throw Error("FACTORY_OPERATOR_CONFIGURATION_INVALID");
    const owner = config.owner, ownerKey = createHash("sha256").update(owner).digest("hex");
    const client = createFactoryAsistenteGitHubClient({ request: deps.githubRequest, baseBranch: config.baseBranch, writePaths: [], allowDispatch: false });
    const project = async () => { const p = await store.projectByOwnerKey(ownerKey, config.projectId); if (!p || p.repo !== ASISTENTE_REPOSITORY || p.id !== config.projectId || p.automaticRelease || p.providerSupportsRelease || p.providerSupportsRollback || p.journeys.length !== 2 || !["office-session-login", "office-company-navigation"].every(j => p.journeys.includes(j)))
        throw Error("FACTORY_OPERATOR_PROJECT_INVALID"); return p; };
    const orders = async () => { const rows = structuredClone(await deps.readOrders(owner)); if (!Array.isArray(rows) || rows.length > 1000 || new Set(rows.map(o => o.id)).size !== rows.length)
        throw Error("FACTORY_OPERATOR_ORDERS_INVALID"); return rows; };
    const auto = config.autoAdmit?.enabled ? { since: Date.parse(config.autoAdmit.since), maxPerDay: config.autoAdmit.maxPerDay ?? config.maxDraftPullRequestsPerDay, systemOrders: config.autoAdmit.systemOrders === true } : undefined;
    const isMapped = (orderId: string, revision: string) => config.orders.some(m => m.id === orderId && m.revision === revision);
    /** An explicitly mapped id never falls back to automatic admission, even after an edit. */
    /** System self-heal orders need autoAdmit.systemOrders and an exact template match; owner orders are unchanged. */
    const autoEligible = (order: CompanyOrder) => !!auto && !config.orders.some(m => m.id === order.id) && Date.parse(order.createdAt) >= auto.since &&
        (isSelfHealOrder(order) ? auto.systemOrders && isValidSelfHealOrder(order) : true);
    const resolve = async (order: CompanyOrder) => { const p = await project(), input = companyOrderJob(order, p, config.reservations.discover), revision = (input.payload!.companyOrder as {
        revision: string;
    }).revision; const mapping = config.orders.find(m => m.id === order.id && m.revision === revision); if (mapping)
        return { input, revision, mapping }; if (autoEligible(order))
        return { input, revision, mapping: undefined }; throw Error("FACTORY_OPERATOR_ORDER_NOT_MAPPED"); };
    const admissionKey = (inputKey: string) => `factory-admission:${hash([owner, inputKey])}`;
    const settledAdmission = (inputKey: string) => credits.ledger.settledReceipt(admissionKey(inputKey)).then(() => true, () => false);
    const readMainOrder = async (requestOwner: string, id: string) => { if (requestOwner !== owner)
        throw Error("FACTORY_OPERATOR_OWNER_MISMATCH"); return (await orders()).find(o => o.id === id); };
    const admitWithinCredits = async (requestOwner: string, input: FactoryJobInput) => {
        if (requestOwner !== owner)
            throw Error("FACTORY_OPERATOR_OWNER_MISMATCH");
        const source = input.payload?.companyOrder as {
            orderId?: string;
        } | undefined;
        const order = source?.orderId ? await readMainOrder(owner, source.orderId) : undefined;
        if (!order)
            throw Error("FACTORY_OPERATOR_ORDER_REQUIRED");
        const resolved = await resolve(order), expected = resolved.input;
        if (hash(input) !== hash(expected))
            throw Error("FACTORY_OPERATOR_ADMISSION_MISMATCH");
        const state = await store.status(owner);
        if (!state.configured || state.paused)
            throw Error("FACTORY_OPERATOR_PAUSED");
        // New automatic admissions honor both daily caps before any credit hold.
        if (!resolved.mapping && auto && !(await settledAdmission(expected.key))) {
            const jobs = await store.list(owner), at = now();
            if (countDraftPullRequestsTodaySafe(jobs, at, ownerKey) >= config.maxDraftPullRequestsPerDay)
                throw Error("FACTORY_OPERATOR_DAILY_DRAFT_PR_LIMIT");
            let admittedToday: number;
            try { admittedToday = countAutoAdmissionsToday(jobs, at, ownerKey, isMapped); } catch { admittedToday = Number.POSITIVE_INFINITY; }
            if (admittedToday >= auto.maxPerDay)
                throw Error("FACTORY_OPERATOR_DAILY_AUTO_ADMISSION_LIMIT");
        }
        const key = admissionKey(expected.key), requestSha256 = hash(expected), maximumMicroUsd = (config.reservations.build + config.reservations.review) * 10000;
        const reservation = await credits.ledger.reserve({ key, consumer: "factory", requestSha256, maximumMicroUsd });
        if (!reservation.admitted) {
            if (reservation.reservation.status !== "settled")
                throw Error("FACTORY_OPERATOR_ADMISSION_UNCONFIRMED");
            const matches = (await store.list(owner)).filter(j => j.ownerKey === ownerKey && j.key === expected.key && j.projectId === config.projectId && j.kind === "discover");
            if (matches.length !== 1)
                throw Error("FACTORY_OPERATOR_ADMISSION_RECEIPT_UNAVAILABLE");
            return matches[0];
        }
        // If enqueue acknowledgement is lost, leave this exact hold untouched. No
        // automatic replay/reconciliation and no fabricated provider receipt.
        try {
            const job = await store.enqueue(owner, expected);
            if (job.ownerKey !== ownerKey || job.key !== expected.key || job.projectId !== config.projectId || job.kind !== "discover")
                throw Error("FACTORY_OPERATOR_ADMISSION_UNVERIFIED");
            await credits.ledger.settle({ key, actualMicroUsd: 0, evidenceId: `factory-admission-no-provider:${hash([owner, expected.key])}` });
            return job;
        } catch {
            // Unknown refers to queue/settlement acknowledgement, never a fabricated
            // provider call. A settled receipt cannot be overwritten by markUnknown.
            await credits.ledger.markUnknown(key, `factory-admission-no-provider-unconfirmed:${hash([owner, expected.key])}`).catch(() => undefined);
            throw Error("FACTORY_OPERATOR_ADMISSION_UNCONFIRMED");
        }
    };
    const readAcceptance = createRoleAcceptanceArtifactReader({ apiRequest: deps.githubRequest, download: deps.download, archiveHosts: config.archiveHosts, allowGitHubResultsAzureHosts: config.allowGitHubResultsAzureHosts, now: () => now().getTime() });
    const model = { request: deps.modelRequest, model: credits.pricing.model, inputNanoUsdPerToken: credits.pricing.inputNanoUsdPerToken, outputNanoUsdPerToken: credits.pricing.outputNanoUsdPerToken, pricingValidUntil: credits.pricing.validUntil, maxInputTokens: config.maxInputTokens, now };
    const buildModel = model.model === "gpt-6-astra" ? { ...model, reasoningEffort: "low" as const } : model;
    const draftsToday = async (at: Date, signal?: AbortSignal) => { signal?.throwIfAborted(); return countDraftPullRequestsToday(await store.list(owner), at, ownerKey); };
    const build = createAsistenteFactoryBuild({ ledger: credits.ledger, githubRequest: deps.githubRequest, model: buildModel, baseBranch: config.baseBranch, writeRoots: config.writeRoots, maxFilesPerOrder: config.maxFilesPerOrder, dailyDraftLimit: { maxPerDay: config.maxDraftPullRequestsPerDay, countToday: draftsToday }, checks: config.checks, maxOutputTokens: config.maxOutputTokens, readAcceptance, now });
    const review = createAsistenteIndependentReview({ ledger: credits.ledger, model, load: createAsistenteReviewSourceLoader(client, { writeRoots: config.writeRoots, maxFilesPerOrder: config.maxFilesPerOrder }), now, maxOutputTokens: Math.min(config.maxOutputTokens, 4096) });
    const selectFiles = createFactoryOrderFileSelector({ ledger: credits.ledger, model, roots: config.writeRoots, maxFiles: config.maxFilesPerOrder, maxOutputTokens: config.maxOutputTokens,
        listPaths: (baseSha, signal) => listFactorySelectablePaths(client, baseSha, config.writeRoots, signal) });
    const discover = createCompanyOrderDiscovery({ readMainOrder: id => readMainOrder(owner, id), resolveHead: async (repo, signal) => { signal.throwIfAborted(); if (repo !== ASISTENTE_REPOSITORY)
            throw Error("FACTORY_OPERATOR_REPOSITORY_INVALID"); return (await client.git.getRef({ owner: "robertmanzanillag-jpg", repo: "blackops", ref: `heads/${config.baseBranch}` })).data.object.sha; }, inspectOrder: async (order, baseSha, signal, budget) => { signal.throwIfAborted(); const { mapping, revision } = await resolve(order); if (!mapping) {
            // Automatic order: current head of the base branch, code-owned generic
            // scenario, and a validated, persisted file selection. The order text is
            // requirements only; scope, kind and acceptance are enforced here.
            const selected = await selectFiles({ orderId: order.id, revision, orderText: order.text, baseSha, maxCostCents: budget.maxCostCents, signal });
            if (selected.status !== "selected") return { blocked: selected.reason, costCents: selected.costCents };
            return { kind: selected.kind, regressionScenarioId: COMPANY_ORDER_CHECKS_ID, sourcePaths: selected.paths, costCents: selected.costCents };
        } if (baseSha !== mapping.baseSha)
            throw Error("FACTORY_OPERATOR_ACCEPTANCE_BASE_CHANGED"); return { kind: mapping.kind, regressionScenarioId: mapping.scenarioId, sourcePaths: [...mapping.paths] }; } });
    const schedule = createFactoryCompanyOrderScheduler({ owner, project, readOrders: async () => { const rows = await orders(), jobs = await store.list(owner), at = now(); if (countDraftPullRequestsTodaySafe(jobs, at, ownerKey) >= config.maxDraftPullRequestsPerDay) return [];
            const explicit = rows.filter(o => config.orders.some(m => m.id === o.id)).sort(newestFirst);
            if (!auto) return explicit;
            let admittedToday: number;
            try { admittedToday = countAutoAdmissionsToday(jobs, at, ownerKey, isMapped); } catch { admittedToday = Number.POSITIVE_INFINITY; }
            const p = await project(), automatic: CompanyOrder[] = [];
            for (const order of rows.filter(autoEligible).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))) {
                let input: FactoryJobInput;
                try { input = companyOrderJob(order, p, config.reservations.discover); } catch { continue; } // Ineligible (Kong, closed, too long, no engineering assignee).
                // Recent admissions stay visible so a pending one stops the scan;
                // older settled admissions are history and never re-admitted.
                if (jobs.some(j => j.ownerKey === ownerKey && j.kind === "discover" && j.key === input.key)) { automatic.push(order); continue; }
                if (await settledAdmission(input.key)) continue;
                if (admittedToday < auto.maxPerDay) automatic.push(order);
            }
            return [...explicit, ...automatic]; }, ordering: "as-read", ledger: credits.ledger, reservationCents: config.reservations.discover, admit: admitWithinCredits });
    // Reconciliation sweep over verified, recorded draft PRs: crash-safe because
    // every (factory job, head) maps to one permanent office idempotency key.
    const reviewSweep = deps.enqueueOfficeReview ? createFactoryOfficeReviewSweep({ owner, maxPerDay: config.maxDraftPullRequestsPerDay, enqueue: deps.enqueueOfficeReview,
        readProposals: async () => {
            const [jobs, projects] = await Promise.all([store.list(owner), store.projects(owner)]);
            return readFactoryOrderProposals({ owner, jobs, projects, getCompletedJob: (key, id) => store.getCompletedJob(key, id), getRecoveredBuild: deps.recoveryPrevious, now: now().getTime() });
        } }) : undefined;
    const scheduleWithReviews = async (requestOwner: string) => {
        if (requestOwner !== owner)
            throw Error("FACTORY_OPERATOR_OWNER_MISMATCH");
        // A review handoff failure never blocks or quarantines order scheduling.
        if (reviewSweep) await reviewSweep().catch(() => { deps.log?.("Factory office review handoff unconfirmed; it will be reconciled on the next sweep."); });
        // Same isolation: a career scoring failure never blocks or quarantines scheduling.
        if (deps.scoreOfficeCareers) await deps.scoreOfficeCareers().catch(() => { deps.log?.("Factory career scoring unconfirmed; it will be reconciled on the next sweep."); });
        // Same isolation: recording self-heal evidence never blocks scheduling.
        if (deps.syncSelfHeal) await deps.syncSelfHeal().catch(() => { deps.log?.("Office self-heal evidence unconfirmed; it will be reconciled on the next sweep."); });
        return schedule(requestOwner);
    };
    return { owner, store, reservationCents: config.reservations.discover, readMainOrder, admitWithinCredits, reviewSweep,
        async createFactoryWorkerOptions() { await project(); return createTrustedFactoryProposalWorkerOptions({ owner, store, now, recoveryPrevious:deps.recoveryPrevious, reservations: config.reservations, scheduleCompanyOrders: scheduleWithReviews, stages: { discover, build, review, simulate: async (p, state, context) => { if (!state.candidate || p.id !== config.projectId)
                    throw Error("FACTORY_OPERATOR_CANDIDATE_REQUIRED"); const tests = state.evidence.filter(e => e.kind === "tests" && e.passed && e.headSha === state.candidate!.headSha && e.baseSha === state.candidate!.baseSha); const urls = tests.flatMap(e => e.artifactIds).filter(id => /^https:\/\/github\.com\/robertmanzanillag-jpg\/blackops\/actions\/runs\/[1-9][0-9]*$/.test(id)); if (urls.length !== 1)
                    throw Error("FACTORY_OPERATOR_RUN_UNVERIFIED"); return { costCents: 0, evidence: await deps.readUi({ projectId: p.id, baseSha: state.candidate.baseSha, headSha: state.candidate.headSha, runId: Number(urls[0].split("/").pop()), signal: context.signal }) }; } } }); }
    };
}
async function privateFile(value: string | undefined, max: number) {
    if (!value || !path.isAbsolute(value))
        throw Error("FACTORY_OPERATOR_PRIVATE_PATH_REQUIRED");
    const resolved = await realpath(value), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    if (resolved === repo || resolved.startsWith(repo + path.sep) || (await lstat(value)).isSymbolicLink())
        throw Error("FACTORY_OPERATOR_PRIVATE_PATH_INVALID");
    const stat = await lstat(resolved);
    if (!stat.isFile() || stat.size > max)
        throw Error("FACTORY_OPERATOR_PRIVATE_FILE_INVALID");
    const text = await readFile(resolved, "utf8");
    if (Buffer.byteLength(text) > max)
        throw Error("FACTORY_OPERATOR_PRIVATE_FILE_INVALID");
    return text;
}
async function installed(store: Store) {
    const env = { ...process.env }, now = () => new Date();
    const config = validateAsistenteOperatorConfig(JSON.parse(await privateFile(env.SOFTWARE_FACTORY_OPERATOR_CONFIG, 65536)));
    if (env.SOFTWARE_FACTORY_OWNER_ID !== config.owner || env.DEFAULT_USER_ID !== config.owner)
        throw Error("FACTORY_OPERATOR_OWNER_MISMATCH");
    const credits = await loadSharedCreditRuntime(env, now);
    const budget = await credits.ledger.status();
    if (budget.expired || budget.uncertain || budget.overrun || budget.availableMicroUsd < (config.reservations.build + config.reservations.review) * 10000 || Date.parse(credits.pricing.validUntil) <= now().getTime())
        throw Error("FACTORY_OPERATOR_CREDIT_UNAVAILABLE");
    const githubRequest = createAsistenteGitHubTransport(env.SOFTWARE_FACTORY_GITHUB_TOKEN || "");
    const modelRequest = createFactoryOpenAiTransport(env.OPENAI_API_KEY || "");
    const readUi = createOfficeUiArtifactReader({ apiRequest: githubRequest, download: fetch, archiveHosts: config.archiveHosts, allowGitHubResultsAzureHosts: config.allowGitHubResultsAzureHosts, ...config.ui, now });
    let recoveryPool: import('pg').Pool | undefined;
    const recoveryPrevious=async(ownerKey:string,failedId:string,jobId:string)=>{
      if(env.SOFTWARE_FACTORY_STORAGE_BACKEND && env.SOFTWARE_FACTORY_STORAGE_BACKEND!=='postgres')throw Error('FACTORY_RECOVERY_POSTGRES_REQUIRED');
      if(!recoveryPool){const [{Pool},{resolveDatabaseConnectionString}]=await Promise.all([import('pg'),import('./database-url')]);recoveryPool=new Pool({connectionString:resolveDatabaseConnectionString(),allowExitOnIdle:true,max:1,connectionTimeoutMillis:10000,statement_timeout:15000});}
      const {loadFailedBuildRecovery}=await import('./software-factory-build-recovery');
      return loadFailedBuildRecovery(recoveryPool,ownerKey,failedId,jobId);
    };
    // Default off. When enabled, the factory only enqueues; the office review-only
    // worker (same owner) performs the review under its own credit ledger.
    let enqueueOfficeReview: FactoryOfficeReviewEnqueue | undefined;
    if (env.SOFTWARE_FACTORY_OFFICE_REVIEW_ENABLED === "true") {
        const { createOfficeCloudStore } = await import("./office-cloud-store");
        const office = createOfficeCloudStore();
        enqueueOfficeReview = (owner, input) => office.enqueueFactoryReview(owner, input);
    }
    // Default off. When enabled, the factory reconciles its committed stage rows
    // into the factory engineers' careers through the durable council transaction.
    let scoreOfficeCareers: (() => Promise<unknown>) | undefined;
    if (env.SOFTWARE_FACTORY_OFFICE_CAREERS_ENABLED === "true") {
        const [{ createFactoryCareerSweep }, { getAgentCouncil, setAgentCouncilUser }] = await Promise.all([import("./software-factory-office-careers"), import("./agent-council")]);
        setAgentCouncilUser(config.owner);
        scoreOfficeCareers = createFactoryCareerSweep({ owner: config.owner, council: getAgentCouncil(), readJobs: () => store.list(config.owner) });
    }
    // Default off. When enabled, the factory records each self-heal attempt's chain
    // (factory job -> PR -> independent + office review) on the council ledger.
    let syncSelfHeal: (() => Promise<unknown>) | undefined;
    if (env.OFFICE_SELF_HEAL_ENABLED === "true") {
        const [{ createSelfHealFactorySync }, { getAgentCouncil, setAgentCouncilUser }, { createOfficeCloudStore }, { linkFactoryOfficeReviews }] = await Promise.all([import("./office-self-heal-factory"), import("./agent-council"), import("./office-cloud-store"), import("./software-factory-office-review")]);
        setAgentCouncilUser(config.owner);
        const office = createOfficeCloudStore();
        syncSelfHeal = createSelfHealFactorySync({ owner: config.owner, council: getAgentCouncil(), readJobs: () => store.list(config.owner), readProposals: async () => {
            const [jobs, projects] = await Promise.all([store.list(config.owner), store.projects(config.owner)]);
            const read = await readFactoryOrderProposals({ owner: config.owner, jobs, projects, getCompletedJob: (key, id) => store.getCompletedJob(key, id), getRecoveredBuild: recoveryPrevious, now: now().getTime() });
            let runs: Awaited<ReturnType<typeof office.list>> | undefined;
            try { runs = await office.list(config.owner); } catch { runs = undefined; }
            return { proposals: linkFactoryOfficeReviews(config.owner, read.proposals, runs as any), status: read.status };
        } });
    }
    return createAsistenteOperatorComposition(config, { store, credits, githubRequest, modelRequest, download: fetch, readUi, recoveryPrevious, enqueueOfficeReview, scoreOfficeCareers, syncSelfHeal, log: message => console.error(message), now, readOrders: async (owner) => { const raw = await (await getCouncilStore()).read(owner); if (!raw)
            throw Error("FACTORY_OPERATOR_COUNCIL_MISSING"); const state = JSON.parse(raw); if (!Array.isArray(state.company?.orders))
            throw Error("FACTORY_OPERATOR_COUNCIL_INVALID"); return state.company.orders; } });
}
export async function createFactoryWorkerOptions({ store }: {
    store: Store;
}) { return (await installed(store)).createFactoryWorkerOptions(); }
export async function createFactoryOfficeAdmission({ owner, store }: {
    owner: string;
    store: Store;
}) { const composition = await installed(store); if (owner !== composition.owner)
    throw Error("FACTORY_OPERATOR_OWNER_MISMATCH"); return composition; }
/** Startup validation only: no order admission, provider call or configuration mutation. */
export async function preflightFactoryOperator({ store }: {
    store: Store;
}) { const composition = await installed(store); const options = await composition.createFactoryWorkerOptions(); return { owner: composition.owner, projectId: "asistente", releaseMode: options.releaseMode, discoveryMode: options.discoveryMode }; }
