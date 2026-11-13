import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { canRepair } from "./software-factory";
import { createSharedOpenAiCreditLedger, type SharedCreditState, type VerifiedCreditGrant } from "./shared-openai-credit-ledger";
import type { CouncilPool } from "./agent-council-store";
import type { FactoryJob, FactoryJobInput } from "./software-factory-store";
import type { FactoryPipelineState } from "./software-factory-pipeline";
import { FACTORY_DEFAULT_WRITE_ROOTS, FACTORY_MAX_FILES_PER_ORDER, validateFactoryOrderPaths } from "./software-factory-write-scope";

const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v==='object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
export const buildRecoveryDigest = (v: unknown) => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
const hash=buildRecoveryDigest;
const ownerHash = (v: string) => createHash("sha256").update(v).digest("hex");
const fail = (): never => { throw Error("FACTORY_BUILD_RECOVERY_UNVERIFIED"); };
const requestSchema = z.object({ failedJobId: z.string().uuid(), rootJobId: z.string().uuid(), baseSha: z.string().regex(/^[a-f0-9]{40}$/), attempt: z.number().int().min(0).max(1), reservedCents: z.number().int().min(1).max(100), sourcePaths: z.array(z.string()).min(1).max(FACTORY_MAX_FILES_PER_ORDER) }).strict();
export type FactoryBuildRecoveryRequest = z.infer<typeof requestSchema>;
export const buildRecoverySchemaSql = `CREATE TABLE IF NOT EXISTS software_factory_build_recoveries (
 owner_key text NOT NULL, failed_job_id uuid NOT NULL, successor_job_id uuid NOT NULL,
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), proof jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(owner_key,failed_job_id), UNIQUE(owner_key,successor_job_id)
);`;
// Mirror the reviewed harness data without importing its executable CLI into the
// production CJS bundle. A regression test requires exact equality with the CLI.
export const RECOVERY_HARNESS_FILES = ['script/software-factory-office-ui-acceptance.ts', 'script/software-factory-office-ui-fixture.mjs', 'script/software-factory-office-ui-oracle.mjs', 'script/software-factory-ui-console.mjs', 'script/software-factory-ui-static.mjs', 'script/software-factory-role-acceptance.ts', 'server/software-factory-role-acceptance.ts', 'server/software-factory-role-deadline.ts', 'server/office-role-snapshots.ts'];
export const RECOVERY_FIXED_PATHS = ['.github/workflows/factory-candidate-checks.yml', ...RECOVERY_HARNESS_FILES];
/** The job's persisted per-order selection plus the fixed workflow/harness files. */
export function recoveryEquivalentPaths(sourcePaths: readonly string[]): string[] {
    const selected = validateFactoryOrderPaths([...sourcePaths], { roots: [...FACTORY_DEFAULT_WRITE_ROOTS], maxFiles: FACTORY_MAX_FILES_PER_ORDER });
    return [...new Set([...selected, ...RECOVERY_FIXED_PATHS])];
}
type WorkflowBlobChange = { before: string; after: string };
type RebaseProof = { originalBaseSha: string; targetBaseSha: string; files: Array<[string, string]>; reviewedWorkflowBlobChange?: WorkflowBlobChange };
/** Reads immutable Git objects only; no checkout, fetch, shell or candidate execution. */
export async function verifyRecoveryRebase(repositoryPath: string, originalBaseSha: string, targetBaseSha: string, sourcePaths: readonly string[], reviewedWorkflowBlobChange?: WorkflowBlobChange): Promise<RebaseProof> {
    if (![originalBaseSha,targetBaseSha].every(s=>/^[a-f0-9]{40}$/.test(s))) fail();
    let equivalent: string[];
    try { equivalent = recoveryEquivalentPaths(sourcePaths); } catch { return fail(); }
    const run = promisify(execFile);
    const git = async (args: string[]) => (await run('git', ['-C',repositoryPath,...args], {windowsHide:true,timeout:10000,maxBuffer:16384})).stdout.trim();
    await git(['merge-base','--is-ancestor',originalBaseSha,targetBaseSha]);
    const exception=reviewedWorkflowBlobChange===undefined?undefined:z.object({before:z.string().regex(/^[a-f0-9]{40}$/),after:z.string().regex(/^[a-f0-9]{40}$/)}).strict().parse(reviewedWorkflowBlobChange);
    const files: Array<[string,string]> = [];let exceptionUsed=false;
    for (const file of equivalent) {
        const before=await git(['ls-tree',originalBaseSha,'--',file]),after=await git(['ls-tree',targetBaseSha,'--',file]);
        const matched=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(before);
        if (!matched || matched[2]!==file) fail();
        if(before!==after){
            const next=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(after);
            if(file!=='.github/workflows/factory-candidate-checks.yml'||!exception||!next||next[2]!==file||exception.before!==matched![1]||exception.after!==next[1])fail();
            exceptionUsed=true;
        }
        files.push([file,matched![1]]);
    }
    if(exception&&!exceptionUsed)fail();
    return {originalBaseSha,targetBaseSha,files,...(exception?{reviewedWorkflowBlobChange:exception}:{})};
}
function decode(row: Record<string, any>): FactoryJob {
    return { ...row.input, id: row.id, ownerKey: row.owner_key, month: row.month, status: row.status, createdAt: new Date(row.created_at).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined, result: row.result };
}
/** Only these known-cost prepublication diagnostics qualify. A provider output
 * limit has a settled receipt but no usable patch. Unknown execution and later
 * phases never qualify, and this predicate never schedules a retry. */
export function recoverableFailedBuild(job: FactoryJob): FactoryPipelineState {
    const outcome = job.result as any, state = outcome?.evidence?.pipelineState as FactoryPipelineState;
    if (job.kind !== "build" || job.status !== "failed" || !job.completedAt || job.headSha || outcome?.status !== "failed" || !["FACTORY_REMOTE_BUILD_FAILED:PATCH", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_OUTPUT_LIMIT"].includes(outcome?.reason) || !Number.isSafeInteger(outcome.costCents) || outcome.costCents < 0 || outcome.costCents > job.reservedCents ||
        !state || state.version !== 1 || state.projectId !== "asistente" || job.projectId !== state.projectId || state.target !== "staging" || !canRepair(state.repairAttempts) || !Array.isArray(state.evidence) || state.evidence.length || state.candidate || state.deployment || state.verification || state.rollback || !state.finding || !/^[a-f0-9]{40}$/.test(state.finding.baseSha) || !state.finding.request?.trim() || !state.rootJobId) fail();
    return structuredClone(state);
}
function recoveryInput(failed: FactoryJob, state: FactoryPipelineState, reserve: number, receipt: { key: string; settlementEvidenceId?: string; requestSha256: string }, rebase: RebaseProof): FactoryJobInput {
    return { key: `${failed.id}.repair`, projectId: "asistente", kind: "build", reservedCents: reserve, recoveryCents: 0,
        payload: { previousJobId: failed.id, repairAttempts: state.repairAttempts + 1, recovery: { version: 1, rootJobId: state.rootJobId, baseSha: state.finding.baseSha, providerKey: receipt.key, receiptId: receipt.settlementEvidenceId, requestSha256: receipt.requestSha256, rebase } } };
}
function matchesRecovery(job: FactoryJob, failed: FactoryJob): boolean {
    const state = recoverableFailedBuild(failed), marker = job.payload?.recovery as any;
    return job.kind === "build" && job.ownerKey === failed.ownerKey && job.projectId === failed.projectId && job.key === `${failed.id}.repair` && job.payload.previousJobId === failed.id && job.payload.repairAttempts === state.repairAttempts + 1 && !job.headSha && job.recoveryCents === 0 && marker?.version === 1 && marker.rootJobId === state.rootJobId && marker.baseSha === state.finding.baseSha && marker.providerKey === `factory:${hash([state.projectId, state.rootJobId, state.repairAttempts])}` && typeof marker.receiptId === "string" && /^[a-f0-9]{64}$/.test(marker.requestSha256);
}
/** Explicit operator action; never called by scheduler/startup/model. Locks use
 * factory-global -> failed row -> credit namespace/row -> controls/root/budget.
 * Existing factory transactions never acquire credit locks; credit transactions
 * never acquire factory locks. No reverse nested order exists in those stores.
 * The shared credit row is read under its existing lock and NEVER rewritten. */
export async function enqueueFailedBuildRecovery(options: { pool: CouncilPool; owner: string; grant: VerifiedCreditGrant; request: FactoryBuildRecoveryRequest; repositoryPath: string; targetBaseSha: string; reviewedWorkflowBlobChange?: WorkflowBlobChange; now: () => Date }): Promise<FactoryJob> {
    const request = requestSchema.parse(options.request), owner = options.owner;
    if (!owner?.trim()) fail();
    const rebase = await verifyRecoveryRebase(options.repositoryPath,request.baseSha,options.targetBaseSha,request.sourcePaths,options.reviewedWorkflowBlobChange);
    const key = ownerHash(owner), c = await options.pool.connect();
    try {
        await c.query("BEGIN");
        await c.query("SET LOCAL lock_timeout = '10s'");
        await c.query("SET LOCAL statement_timeout = '30s'");
        await c.query("SELECT pg_advisory_xact_lock(83817421)");
        const failedRow = (await c.query("SELECT * FROM software_factory_jobs WHERE owner_key=$1 AND id=$2 FOR UPDATE", [key, request.failedJobId])).rows[0];
        if (!failedRow) fail();
        const failed = decode(failedRow), state = recoverableFailedBuild(failed);
        if (state.rootJobId !== request.rootJobId || state.finding.baseSha !== request.baseSha || state.repairAttempts !== request.attempt || !Array.isArray(state.finding.sourcePaths) || hash(state.finding.sourcePaths) !== hash(request.sourcePaths)) fail();
        const existing = (await c.query("SELECT * FROM software_factory_jobs WHERE owner_key=$1 AND job_key=$2", [key, `${failed.id}.repair`])).rows[0];
        if (existing) {
            const job = decode(existing);
            const approval=(await c.query("SELECT * FROM software_factory_build_recoveries WHERE owner_key=$1 AND failed_job_id=$2",[key,failed.id])).rows[0];
            if (!matchesRecovery(job, failed) || job.reservedCents !== request.reservedCents || approval?.successor_job_id!==job.id || approval.input_hash!==hash(jobInput(job)) || hash((job.payload.recovery as any).rebase)!==hash(rebase)) fail();
            await c.query("COMMIT"); return job;
        }
        const namespace = ownerHash(JSON.stringify(["shared-openai-credit-ledger-v1", options.grant.accountScope]));
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [namespace]);
        const credit = (await c.query("SELECT state FROM agent_council_state WHERE owner_key=$1 FOR UPDATE", [namespace])).rows[0]?.state as SharedCreditState | undefined;
        if (!credit) fail();
        const ledger = createSharedOpenAiCreditLedger({ grant: options.grant, now: options.now, maximumGrantObservationAgeMs: 60000, transact: async mutate => structuredClone(mutate(structuredClone(credit!))) });
        const budget = await ledger.status(), receipt = await ledger.settledReceipt(`factory:${hash([state.projectId, state.rootJobId, state.repairAttempts])}`);
        if (budget.expired || budget.uncertain || budget.overrun || budget.reservedMicroUsd !== 0 || budget.availableMicroUsd < request.reservedCents * 10000 || receipt.consumer !== "factory" || receipt.reconciled !== false || Math.ceil(receipt.actualMicroUsd! / 10000) !== (failed.result as any).costCents) fail();
        const control = (await c.query("SELECT paused FROM software_factory_controls WHERE owner_key=$1 FOR UPDATE", [key])).rows[0];
        if (control?.paused !== true) fail();
        const project = (await c.query("SELECT config FROM software_factory_projects WHERE owner_key=$1 AND id='asistente' FOR UPDATE", [key])).rows[0]?.config as any;
        if (!project || project.repo !== "robertmanzanillag-jpg/blackops" || project.automaticRelease || project.providerSupportsRelease || project.providerSupportsRollback) fail();
        const rootRow = (await c.query("SELECT * FROM software_factory_jobs WHERE owner_key=$1 AND id=$2", [key, state.rootJobId])).rows[0];
        const root = rootRow && decode(rootRow), rootState = (root?.result as any)?.evidence?.pipelineState;
        if (!root || root.status !== "completed" || root.kind !== "discover" || root.projectId !== state.projectId || !root.payload.companyOrder || rootState?.rootJobId !== root.id || rootState?.repairAttempts !== 0 || hash({...rootState?.finding,baseSha:state.finding.baseSha}) !== hash(state.finding)) fail();
        if ((await c.query("SELECT id FROM software_factory_jobs WHERE owner_key=$1 AND (status IN ('pending','running','unknown') OR input->>'previousJobId'=$2 OR input->'payload'->>'previousJobId'=$2)", [key, failed.id])).rows.length) fail();
        if (state.repairAttempts === 0 ? failed.key !== `${root.id}.next` || failed.payload.previousJobId !== root.id : failed.key !== `${failed.payload.previousJobId}.repair` || failed.payload.repairAttempts !== state.repairAttempts) fail();
        if (state.repairAttempts>0) {
            const prior=(await c.query("SELECT * FROM software_factory_build_recoveries WHERE owner_key=$1 AND successor_job_id=$2",[key,failed.id])).rows[0];
            if (!prior || prior.input_hash!==hash(jobInput(failed)) || (prior.proof as any)?.rebase?.targetBaseSha!==state.finding.baseSha) fail();
        }
        const input = recoveryInput(failed, state, request.reservedCents, receipt,rebase), month = options.now().toISOString().slice(0, 7);
        const admitted = await c.query("UPDATE software_factory_budget SET reserved_cents=reserved_cents+$3 WHERE owner_key=$1 AND month=$2 AND reserved_cents=0 AND fixed_cents+spent_cents+reserved_cents+$3<=10000 RETURNING *", [key, month, request.reservedCents]);
        if (!admitted.rows.length) fail();
        const inserted = await c.query("INSERT INTO software_factory_jobs(id,owner_key,month,input,request_hash,job_key,status) VALUES($1,$2,$3,$4::jsonb,$5,$6,'pending') RETURNING *", [randomUUID(), key, month, JSON.stringify(input), createHash('sha256').update(JSON.stringify(input)).digest('hex'), input.key]);
        if (!inserted.rows[0]) fail();
        const job = decode(inserted.rows[0]);
        await c.query("INSERT INTO software_factory_build_recoveries(owner_key,failed_job_id,successor_job_id,input_hash,proof) VALUES($1,$2,$3,$4,$5::jsonb)",[key,failed.id,job.id,hash(input),JSON.stringify({rebase,providerKey:receipt.key,receiptId:receipt.settlementEvidenceId,failedOutcomeHash:hash(failed.result)})]);
        await c.query("COMMIT"); return job;
    } catch (error) { await c.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { c.release(); }
}
function jobInput(job: FactoryJob): FactoryJobInput { return {key:job.key,projectId:job.projectId,kind:job.kind,reservedCents:job.reservedCents,recoveryCents:job.recoveryCents,payload:job.payload}; }
/** Installed operator lookup only. Normal completed-predecessor lookup is not
 * widened. A plain pending payload cannot authorize a failed predecessor. */
export async function loadFailedBuildRecovery(pool: CouncilPool, ownerKey: string, failedId: string, jobId: string): Promise<FactoryJob | undefined> {
    if (!/^[a-f0-9]{64}$/.test(ownerKey) || !z.string().uuid().safeParse(failedId).success || !z.string().uuid().safeParse(jobId).success) return undefined;
    const c = await pool.connect();
    try {
        const rows = (await c.query("SELECT * FROM software_factory_jobs WHERE owner_key=$1 AND id IN ($2,$3)", [ownerKey, failedId, jobId])).rows;
        const failed = rows.find(row => row.id === failedId), current = rows.find(row => row.id === jobId);
        if (!failed || !current) return undefined;
        const before = decode(failed), job = decode(current);
        const approval=(await c.query("SELECT * FROM software_factory_build_recoveries WHERE owner_key=$1 AND failed_job_id=$2",[ownerKey,failedId])).rows[0];
        const proof=approval?.proof as any,marker=job.payload.recovery as any;
        return matchesRecovery(job, before) && approval?.successor_job_id===job.id && approval.input_hash===hash(jobInput(job)) && proof?.failedOutcomeHash===hash(before.result) && hash(proof?.rebase)===hash(marker?.rebase) ? before : undefined;
    } finally { c.release(); }
}
