import {ROLE_WORK_DEADLINE_ID} from "./software-factory-role-deadline";
import { assertFactoryCreditReady } from "./software-factory-diagnostics";
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
import type { FactoryModelRoute } from "./software-factory-model-routes";
import { createRoleAcceptanceArtifactReader } from "./software-factory-role-artifact";
import { createOfficeUiArtifactReader } from "./software-factory-office-ui-artifact";
import { ROLE_WORK_ACCEPTANCE_ID } from "./software-factory-role-acceptance";
import { FACTORY_DEFAULT_WRITE_ROOTS, FACTORY_MAX_DRAFT_PULL_REQUESTS_PER_DAY, FACTORY_MAX_FILES_PER_ORDER, utcDayStart, validateFactoryOrderPaths, validateFactoryWriteRoots } from "./software-factory-write-scope";
import type { FactoryJob } from "./software-factory-store";
import { createFactoryOfficeReviewSweep, type FactoryOfficeReviewEnqueue } from "./software-factory-office-review";
import { readFactoryOrderProposals } from "./software-factory-order-evidence";
import { COMPANY_ORDER_CHECKS_ID, createFactoryOrderFileSelector, isFactoryTestPath, listFactorySelectablePaths } from "./software-factory-company-auto";
import { isSelfHealOrder, isValidSelfHealOrder } from "./office-self-heal";
import type { CreditPacer } from "./credit-pacer-runtime";
import { blackopsApplicationName } from "./agent-council-store";
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
/**
 * The ONLY operator-config fields the workflow environment may change:
 * - FACTORY_AUTO_ADMIT_SYSTEM_ORDERS=true|false sets autoAdmit.systemOrders, only when
 *   autoAdmit already exists in the private config.
 * - FACTORY_DRAFT_PRS_PER_DAY=<1..FACTORY_MAX_DRAFT_PULL_REQUESTS_PER_DAY> (owner request,
 *   so the daily draft-PR cap can change without rewriting the private JSON) sets
 *   maxDraftPullRequestsPerDay and, when present, autoAdmit.maxPerDay. The code-level
 *   maximum still applies and the full schema validation runs after this override.
 * Neither ever enables automatic admission or changes paths, owner, budgets or any other
 * field. Any other value (or unset) leaves the private config unchanged.
 */
export function applyFactoryOperatorEnvOverride<T extends { maxDraftPullRequestsPerDay?: number; autoAdmit?: { systemOrders?: boolean; maxPerDay?: number } }>(config: T, env: Record<string, string | undefined>): T {
    let next = config;
    const raw = env.FACTORY_AUTO_ADMIT_SYSTEM_ORDERS?.trim();
    if ((raw === "true" || raw === "false") && next.autoAdmit) next = { ...next, autoAdmit: { ...next.autoAdmit, systemOrders: raw === "true" } };
    const perDayRaw = env.FACTORY_DRAFT_PRS_PER_DAY?.trim();
    const perDay = perDayRaw && /^\d{1,2}$/.test(perDayRaw) ? Number(perDayRaw) : NaN;
    if (Number.isSafeInteger(perDay) && perDay >= 1 && perDay <= FACTORY_MAX_DRAFT_PULL_REQUESTS_PER_DAY) {
        next = { ...next, maxDraftPullRequestsPerDay: perDay, ...(next.autoAdmit ? { autoAdmit: { ...next.autoAdmit, ...(next.autoAdmit.maxPerDay !== undefined ? { maxPerDay: perDay } : {}) } } : {}) };
    }
    return next;
}
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
    /** Optional daily credit pacer: NEW admissions (owner or system orders) are standard
     * priority and wait while today's allowance cannot fund the order's estimate.
     * Admitted jobs keep running (their stages are essential; only the ledger limits them). */
    pacer?: CreditPacer;
    log?: (message: string) => void;
    now: () => Date;
    /** Which provider credits/modelRequest belong to. Default "openai". */
    provider?: "openai" | "anthropic";
    /** Claude fallback (own ledger + transport), tried when OpenAI cannot admit/start a call. */
    fallback?: { ledger: Credits["ledger"]; pricing: Credits["pricing"]; request: (url: string, init: RequestInit) => Promise<Response> };
    /** Other ledgers whose admission rows still count as history. */
    priorLedgers?: Credits["ledger"][];
    /** Read-only admission history (e.g. every Claude ledger row, any month). */
    admissionHistory?: ((key: string) => Promise<{ status: string } | null>)[];
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
    // Admission receipts survive provider switches and month boundaries: every
    // other provider ledger and read-only history source is consulted.
    const otherHistory = [...(deps.priorLedgers ?? []).filter(l => l !== credits.ledger).map(l => (key: string) => l.reservation(key)), ...(deps.admissionHistory ?? [])];
    const otherAdmission = async (key: string) => { for (const read of otherHistory) { const row = await read(key); if (row) return row; } return null; };
    const settledAdmission = async (inputKey: string) => {
        if (await credits.ledger.settledReceipt(admissionKey(inputKey)).then(() => true, () => false)) return true;
        return (await otherAdmission(admissionKey(inputKey)))?.status === "settled";
    };
    /** Config reservation (discover + build + review) is the ceiling; a lower measured average is preferred. */
    const orderEstimateMicroUsd = async () => { const ceiling = (config.reservations.discover + config.reservations.build + config.reservations.review) * 10000;
        const measured = await deps.pacer!.estimate("self_heal_order").catch(() => ceiling); return Math.min(ceiling, measured); };
    const paceAdmits = async () => { if (!deps.pacer) return true; try { return (await deps.pacer.allow("standard", "self_heal_order", await orderEstimateMicroUsd())).allowed; } catch { return false; } };
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
        // New admissions wait for the daily credit pace before any credit hold.
        if (deps.pacer && !(await settledAdmission(expected.key)) && !(await paceAdmits()))
            throw Error("FACTORY_OPERATOR_DAILY_CREDIT_PACE");
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
        // An admission already recorded on another provider's ledger is never
        // admitted again here: settled -> return that job; held -> unconfirmed.
        const elsewhere = await otherAdmission(key);
        const reservation = elsewhere ? { admitted: false as const, reservation: elsewhere } : await credits.ledger.reserve({ key, consumer: "factory", requestSha256, maximumMicroUsd });
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
    // Provider routes: OpenAI first, then Claude; or Claude alone when the
    // OpenAI shared credit could not be admitted at startup. Undefined keeps
    // the exact single-provider behavior.
    const claudeModel = (pricing: Credits["pricing"], request: (url: string, init: RequestInit) => Promise<Response>) => ({ request, model: pricing.model, inputNanoUsdPerToken: pricing.inputNanoUsdPerToken, outputNanoUsdPerToken: pricing.outputNanoUsdPerToken, pricingValidUntil: pricing.validUntil, maxInputTokens: config.maxInputTokens, now, effort: "high" as const });
    const claudeRoute: FactoryModelRoute | undefined = deps.provider === "anthropic" ? { provider: "anthropic", ledger: credits.ledger, model: claudeModel(credits.pricing, deps.modelRequest), historyLedgers: [...(deps.priorLedgers ?? [])] }
        : deps.fallback ? { provider: "anthropic", ledger: deps.fallback.ledger, model: claudeModel(deps.fallback.pricing, deps.fallback.request) } : undefined;
    const routesFor = (openAiModel: typeof model): FactoryModelRoute[] | undefined => deps.provider === "anthropic" ? [claudeRoute!]
        : claudeRoute ? [{ provider: "openai", ledger: credits.ledger, model: openAiModel }, claudeRoute] : undefined;
    const draftsToday = async (at: Date, signal?: AbortSignal) => { signal?.throwIfAborted(); return countDraftPullRequestsToday(await store.list(owner), at, ownerKey); };
    const build = createAsistenteFactoryBuild({ ledger: credits.ledger, githubRequest: deps.githubRequest, model: buildModel, baseBranch: config.baseBranch, writeRoots: config.writeRoots, maxFilesPerOrder: config.maxFilesPerOrder, dailyDraftLimit: { maxPerDay: config.maxDraftPullRequestsPerDay, countToday: draftsToday }, checks: config.checks, maxOutputTokens: config.maxOutputTokens, readAcceptance, now, routes: routesFor(buildModel) });
    const review = createAsistenteIndependentReview({ ledger: credits.ledger, model, load: createAsistenteReviewSourceLoader(client, { writeRoots: config.writeRoots, maxFilesPerOrder: config.maxFilesPerOrder }), now, maxOutputTokens: Math.min(config.maxOutputTokens, 4096), routes: routesFor(model) });
    const selectFiles = createFactoryOrderFileSelector({ ledger: credits.ledger, model, routes: routesFor(model), roots: config.writeRoots, maxFiles: config.maxFilesPerOrder, maxOutputTokens: config.maxOutputTokens,
        listPaths: (baseSha, signal) => listFactorySelectablePaths(client, baseSha, config.writeRoots, signal) });
    const discover = createCompanyOrderDiscovery({ readMainOrder: id => readMainOrder(owner, id), resolveHead: async (repo, signal) => { signal.throwIfAborted(); if (repo !== ASISTENTE_REPOSITORY)
            throw Error("FACTORY_OPERATOR_REPOSITORY_INVALID"); return (await client.git.getRef({ owner: "robertmanzanillag-jpg", repo: "blackops", ref: `heads/${config.baseBranch}` })).data.object.sha; }, inspectOrder: async (order, baseSha, signal, budget) => { signal.throwIfAborted(); const { mapping, revision } = await resolve(order); if (!mapping) {
            // Automatic order: current head of the base branch, code-owned generic
            // scenario, and a validated, persisted file selection. The order text is
            // requirements only; scope, kind and acceptance are enforced here.
            const selected = await selectFiles({ orderId: order.id, revision, orderText: order.text, baseSha, maxCostCents: budget.maxCostCents, signal });
            if (selected.status !== "selected") return { blocked: selected.reason, costCents: selected.costCents };
            return { kind: selected.kind, regressionScenarioId: COMPANY_ORDER_CHECKS_ID, sourcePaths: selected.paths, costCents: selected.costCents, ...(selected.modelProvider ? { modelProvider: selected.modelProvider } : {}) };
        } if (baseSha !== mapping.baseSha)
            throw Error("FACTORY_OPERATOR_ACCEPTANCE_BASE_CHANGED"); return { kind: mapping.kind, regressionScenarioId: mapping.scenarioId, sourcePaths: [...mapping.paths] }; } });
    const schedule = createFactoryCompanyOrderScheduler({ owner, project, readOrders: async () => { const rows = await orders(), jobs = await store.list(owner), at = now(); if (countDraftPullRequestsTodaySafe(jobs, at, ownerKey) >= config.maxDraftPullRequestsPerDay) return [];
            // Daily credit pace reached: no new admission today (already admitted jobs continue).
            if (!(await paceAdmits())) return [];
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
/** Startup OpenAI credit conditions that switch the run to Claude: the credit
 * is unavailable, expired, exhausted or uncertain, the config is missing, or
 * the key is missing. Integrity failures (corrupt/mismatched/unprovisioned
 * ledger, invalid config) halt instead of switching providers. */
const OPENAI_STARTUP_FALLBACK_CODES = new Set([
    "FACTORY_OPERATOR_CREDIT_UNAVAILABLE", "FACTORY_OPERATOR_CREDIT_UNCERTAIN", "FACTORY_OPERATOR_CREDIT_EXPIRED",
    "FACTORY_OPERATOR_CREDIT_OVERRUN", "FACTORY_OPERATOR_CREDIT_INSUFFICIENT", "FACTORY_OPERATOR_PRICING_EXPIRED",
    "CREDIT_RUNTIME_CONFIGURATION_REQUIRED", "CREDIT_NOT_INITIALIZED", "CREDIT_EXPIRED", "FACTORY_OPENAI_CREDENTIAL_REQUIRED",
]);
const errorCode = (error: unknown) => { try { const m = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message")?.value : undefined; return typeof m === "string" && /^[A-Z][A-Z0-9_]{2,99}$/.test(m) ? m : undefined; } catch { return undefined; } };
/** Provider selection at startup. OpenAI stays first whenever its shared
 * credit admits the job's worst case; on a fallback condition Claude runs the
 * job alone under its own ledger, which must itself pass the same admission
 * checks (fail closed over cap). Without the Claude flag/key, OpenAI errors
 * propagate exactly as before. Logs carry only code-owned codes. */
export async function resolveFactoryModelCredits(input: { env: NodeJS.ProcessEnv; now: () => Date; requiredMicroUsd: number;
    /** createRequest is separate so a missing OpenAI key still leaves the
     * loaded OpenAI ledger available as admission history. */
    loadOpenAi: () => Promise<{ credits: Credits; createRequest: () => (url: string, init: RequestInit) => Promise<Response> }>;
    loadAnthropic: () => Promise<{ credits: Credits; modelRequest: (url: string, init: RequestInit) => Promise<Response> }>;
    log?: (message: string) => void; }) {
    const { factoryAnthropicFallbackEnabled } = await import("./software-factory-anthropic-ledger");
    const enabled = factoryAnthropicFallbackEnabled(input.env);
    let openAi: { credits: Credits; modelRequest: (url: string, init: RequestInit) => Promise<Response> } | undefined, openAiLedger: Credits["ledger"] | undefined, openAiError: unknown;
    try {
        const loaded = await input.loadOpenAi();
        openAiLedger = loaded.credits.ledger;
        assertFactoryCreditReady(await loaded.credits.ledger.status(), input.requiredMicroUsd, loaded.credits.pricing.validUntil, input.now().getTime());
        openAi = { credits: loaded.credits, modelRequest: loaded.createRequest() };
    } catch (error) {
        if (!enabled || !OPENAI_STARTUP_FALLBACK_CODES.has(errorCode(error) ?? "")) throw error;
        openAiError = error;
    }
    if (!enabled) return { provider: "openai" as const, credits: openAi!.credits, modelRequest: openAi!.modelRequest };
    if (openAiError === undefined) {
        // OpenAI admitted: Claude is the per-call fallback. A Claude setup
        // failure never blocks the OpenAI path.
        try {
            const claude = await input.loadAnthropic();
            return { provider: "openai" as const, credits: openAi!.credits, modelRequest: openAi!.modelRequest, fallback: { ledger: claude.credits.ledger, pricing: claude.credits.pricing, request: claude.modelRequest }, priorLedgers: [claude.credits.ledger] };
        } catch (error) { input.log?.(`Factory Claude fallback unavailable (${errorCode(error) ?? "FACTORY_ANTHROPIC_FALLBACK_UNAVAILABLE"}); continuing with OpenAI only.`); return { provider: "openai" as const, credits: openAi!.credits, modelRequest: openAi!.modelRequest }; }
    }
    // Surface the real code-owned cause (never exception text or data).
    const claude = await input.loadAnthropic().catch(error => { const code = errorCode(error); throw Error(code && /^(?:FACTORY_ANTHROPIC_|CREDIT_)/.test(code) ? (code.startsWith("CREDIT_") ? `FACTORY_ANTHROPIC_${code}` : code) : "FACTORY_ANTHROPIC_FALLBACK_UNAVAILABLE"); });
    try { assertFactoryCreditReady(await claude.credits.ledger.status(), input.requiredMicroUsd, claude.credits.pricing.validUntil, input.now().getTime()); }
    catch (error) { throw Error(`FACTORY_ANTHROPIC_${(errorCode(error) ?? "CREDIT_UNAVAILABLE").replace(/^FACTORY_OPERATOR_/, "")}`); }
    input.log?.(`Factory OpenAI credit unavailable (${errorCode(openAiError)}); this run uses the Claude fallback ledger.`);
    return { provider: "anthropic" as const, credits: claude.credits, modelRequest: claude.modelRequest, priorLedgers: openAiLedger ? [openAiLedger] : [] };
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
    const config = validateAsistenteOperatorConfig(applyFactoryOperatorEnvOverride(JSON.parse(await privateFile(env.SOFTWARE_FACTORY_OPERATOR_CONFIG, 65536)), env));
    if (env.SOFTWARE_FACTORY_OWNER_ID !== config.owner || env.DEFAULT_USER_ID !== config.owner)
        throw Error("FACTORY_OPERATOR_OWNER_MISMATCH");
    const selected = await resolveFactoryModelCredits({ env, now, requiredMicroUsd: (config.reservations.build + config.reservations.review) * 10000, log: message => console.error(message),
        loadOpenAi: async () => {
            const credits = await loadSharedCreditRuntime(env, now);
            // Monetary gate price: the operator catalog when configured, else the
            // shared-credit pricing (cached input conservatively at the full rate).
            const { configuredFactoryApiPrice, apiEvidenceHash } = await import("./factory-api-invocation");
            const base = { ...credits.pricing, cachedInputNanoUsdPerToken: credits.pricing.inputNanoUsdPerToken };
            const price = env.FACTORY_API_PRICING_CONFIG ? configuredFactoryApiPrice("openai", credits.pricing.model, env.FACTORY_API_PRICING_CONFIG) : { ...base, evidenceSha256: apiEvidenceHash(base) };
            const { createFactoryOpenAiCountTransport, routeFactoryOpenAiRequests } = await import("./software-factory-openai-count");
            return { credits, createRequest: () => routeFactoryOpenAiRequests(createFactoryOpenAiTransport(env.OPENAI_API_KEY || "", fetch, { price }), createFactoryOpenAiCountTransport(env.OPENAI_API_KEY || "")) };
        },
        loadAnthropic: async () => {
            const [{ loadAnthropicFactoryRuntime }, { createFactoryAnthropicTransport }] = await Promise.all([import("./software-factory-anthropic-ledger"), import("./software-factory-anthropic")]);
            const modelRequest = createFactoryAnthropicTransport(env.ANTHROPIC_API_KEY?.trim() || "");
            return { credits: await loadAnthropicFactoryRuntime(env, now), modelRequest };
        } });
    const { credits, modelRequest } = selected;
    // Daily credit pacer over the selected ledger; estimates use the office's persisted cost history.
    const { createCreditPacer, councilPacerHistory } = await import("./credit-pacer-runtime");
    const pacer = createCreditPacer({ readSnapshot: () => credits.ledger.paceSnapshot(), env, now: () => now().getTime(),
        readHistory: councilPacerHistory(async () => { const raw = await (await getCouncilStore()).read(config.owner); return raw ? JSON.parse(raw) : {}; }) });
    const githubRequest = createAsistenteGitHubTransport(env.SOFTWARE_FACTORY_GITHUB_TOKEN || "");
    const readUi = createOfficeUiArtifactReader({ apiRequest: githubRequest, download: fetch, archiveHosts: config.archiveHosts, allowGitHubResultsAzureHosts: config.allowGitHubResultsAzureHosts, ...config.ui, now });
    let recoveryPool: import('pg').Pool | undefined;
    const recoveryPrevious=async(ownerKey:string,failedId:string,jobId:string)=>{
      if(env.SOFTWARE_FACTORY_STORAGE_BACKEND && env.SOFTWARE_FACTORY_STORAGE_BACKEND!=='postgres')throw Error('FACTORY_RECOVERY_POSTGRES_REQUIRED');
      if(!recoveryPool){const [{Pool},{resolveDatabaseConnectionString}]=await Promise.all([import('pg'),import('./database-url')]);recoveryPool=new Pool({connectionString:resolveDatabaseConnectionString(),allowExitOnIdle:true,max:1,connectionTimeoutMillis:10000,statement_timeout:15000,application_name:blackopsApplicationName("factory-asistente")});}
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
    return createAsistenteOperatorComposition(config, { store, credits, githubRequest, modelRequest, provider: selected.provider,
        ...("fallback" in selected && selected.fallback ? { fallback: selected.fallback } : {}), ...("priorLedgers" in selected ? { priorLedgers: selected.priorLedgers } : {}),
        // Claude admission rows (any month) count as history even when the
        // fallback is off or failed to load; read-only, never creates the row.
        admissionHistory: selected.provider === "anthropic" ? [] : [async key => (await import("./software-factory-anthropic-ledger")).readAnthropicFactoryReservation(await getCouncilStore(), key)], download: fetch, readUi, recoveryPrevious, enqueueOfficeReview, scoreOfficeCareers, syncSelfHeal, pacer, log: message => console.error(message), now, readOrders: async (owner) => { const raw = await (await getCouncilStore()).read(owner); if (!raw)
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
