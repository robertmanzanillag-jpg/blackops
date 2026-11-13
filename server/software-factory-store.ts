import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FactoryProject } from "./software-factory";
import type { OfficeCloudPool, OfficeCloudClient } from "./office-cloud-store";

export const factoryJobKinds = ["discover", "build", "simulate", "review", "deploy", "verify", "rollback", "evaluate"] as const;
const inputSchema = z.object({ key: z.string().min(1).max(200), projectId: z.string().min(1).max(200), kind: z.enum(factoryJobKinds), headSha: z.string().regex(/^[a-f0-9]{40,64}$/).optional(), payload: z.record(z.unknown()).default({}), reservedCents: z.number().int().min(0).max(10000), recoveryCents:z.number().int().min(0).max(10000).default(0) }).strict().refine(x=>x.recoveryCents<=x.reservedCents,"Recovery reserve exceeds total");
export type FactoryJobInput = z.input<typeof inputSchema>;
export interface FactoryJob extends z.output<typeof inputSchema> { id: string; ownerKey: string; month: string; status: string; createdAt: string; completedAt?: string; workerId?: string; fence?: string; leaseExpiresAt?: string; result?: unknown }
export interface FactoryOutcome { status: "completed" | "blocked" | "failed" | "unknown"; costCents: number; evidence?: unknown; reason?: string }
const ownerKey = (owner: string) => { if (!owner.trim()) throw new Error("FACTORY_OWNER_REQUIRED"); return createHash("sha256").update(owner).digest("hex"); };
const monthNow = () => new Date().toISOString().slice(0, 7);
const decode = (row: Record<string, unknown>): FactoryJob => ({ ...inputSchema.parse(row.input), id: String(row.id), ownerKey: String(row.owner_key), month: String(row.month), status: String(row.status), createdAt: new Date(row.created_at as string).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at as string).toISOString() : undefined, workerId: row.worker_id as string | undefined, fence: row.fence as string | undefined, leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at as string).toISOString() : undefined, result: row.result });
/** Prepared migration; never applied by web requests or worker startup. */
export function createSoftwareFactorySchemaSql() { return `
CREATE TABLE IF NOT EXISTS software_factory_controls (owner_key text PRIMARY KEY, paused boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS software_factory_budget (owner_key text NOT NULL, month text NOT NULL CHECK(month ~ '^\\d{4}-\\d{2}$'), fixed_cents integer NOT NULL CHECK(fixed_cents BETWEEN 0 AND 10000), spent_cents integer NOT NULL DEFAULT 0 CHECK(spent_cents>=0), reserved_cents integer NOT NULL DEFAULT 0 CHECK(reserved_cents>=0), PRIMARY KEY(owner_key,month));
CREATE TABLE IF NOT EXISTS software_factory_jobs (id uuid PRIMARY KEY, owner_key text NOT NULL, month text NOT NULL, input jsonb NOT NULL, request_hash text NOT NULL, job_key text NOT NULL, status text NOT NULL CHECK(status IN ('pending','running','completed','blocked','failed','unknown')), worker_id text, fence uuid, lease_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at timestamptz, result jsonb, UNIQUE(owner_key,job_key));
ALTER TABLE software_factory_jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
CREATE TABLE IF NOT EXISTS software_factory_findings(owner_key text NOT NULL,project_id text NOT NULL,finding_key text NOT NULL,job_id uuid NOT NULL,PRIMARY KEY(owner_key,project_id,finding_key));
CREATE INDEX IF NOT EXISTS software_factory_pending ON software_factory_jobs(created_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS software_factory_projects(owner_key text NOT NULL,id text NOT NULL,config jsonb NOT NULL,PRIMARY KEY(owner_key,id));
CREATE TABLE IF NOT EXISTS software_factory_workers(id text PRIMARY KEY,last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,capabilities jsonb NOT NULL DEFAULT '{}'::jsonb);
ALTER TABLE software_factory_workers ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;
`; }
export function createSoftwareFactoryStore(providedPool?: OfficeCloudPool) {
  let lazyPool: OfficeCloudPool | undefined = providedPool;
  const pool = async () => { if (!lazyPool) { const { Pool } = await import("pg"); const { resolveDatabaseConnectionString } = await import("./database-url"); lazyPool = new Pool({ connectionString: resolveDatabaseConnectionString(), allowExitOnIdle: true }) as unknown as OfficeCloudPool; } return lazyPool; };
  const transaction = async <T>(fn: (client: OfficeCloudClient) => Promise<T>) => { const client = await (await pool()).connect(); try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(83817421)"); const result = await fn(client); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); } };
  return {
    async initializeMonth(owner: string, month: string, fixedCents: number) { if (month !== monthNow() || !Number.isInteger(fixedCents) || fixedCents < 0 || fixedCents > 10000) throw new Error("FACTORY_INVALID_BUDGET"); return transaction(async c => { const key = ownerKey(owner); await c.query("INSERT INTO software_factory_controls(owner_key) VALUES($1) ON CONFLICT DO NOTHING", [key]); await c.query("INSERT INTO software_factory_budget(owner_key,month,fixed_cents) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [key, month, fixedCents]); const existing = await c.query("SELECT fixed_cents FROM software_factory_budget WHERE owner_key=$1 AND month=$2", [key, month]); if (Number(existing.rows[0]?.fixed_cents) !== fixedCents) throw new Error("FACTORY_FIXED_COST_IMMUTABLE"); }); },
    async enqueue(owner: string, raw: FactoryJobInput) { const input = inputSchema.parse(raw); if (JSON.stringify(input).length > 64000) throw new Error("FACTORY_INPUT_TOO_LARGE"); const key = ownerKey(owner); const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex"); return transaction(async c => {
      const previous = await c.query("SELECT * FROM software_factory_jobs WHERE owner_key=$1 AND job_key=$2", [key,input.key]); if (previous.rows[0]) { if (previous.rows[0].request_hash !== hash) throw new Error("FACTORY_IDEMPOTENCY_CONFLICT"); return decode(previous.rows[0]); }
      const month = monthNow(); const admitted = await c.query("UPDATE software_factory_budget SET reserved_cents=reserved_cents+$3 WHERE owner_key=$1 AND month=$2 AND fixed_cents+spent_cents+reserved_cents+$3<=10000 AND fixed_cents+spent_cents+reserved_cents<10000 RETURNING *", [key,month,input.reservedCents]); if (!admitted.rows.length) throw new Error("FACTORY_BUDGET_UNAVAILABLE");
      const result = await c.query("INSERT INTO software_factory_jobs(id,owner_key,month,input,request_hash,job_key,status) VALUES($1,$2,$3,$4::jsonb,$5,$6,'pending') RETURNING *",[randomUUID(),key,month,JSON.stringify(input),hash,input.key]); return decode(result.rows[0]); }); },
    async saveProject(owner: string, config: FactoryProject) { const schema = z.object({ id:z.string().min(1).max(200), repo:z.string().regex(/^[\w.-]+\/[\w.-]+$/),testCommand:z.string().max(2000),buildCommand:z.string().max(2000),stagingUrl:z.string().max(2000),productionUrl:z.string().max(2000),healthUrl:z.string().max(2000),rollbackCommand:z.string().max(2000),journeys:z.array(z.string().max(200)).max(100),automaticRelease:z.boolean(),providerSupportsRelease:z.boolean(),providerSupportsRollback:z.boolean(),rehearsalRunIds:z.array(z.string()).max(100),rollbackVerifiedAt:z.string().optional() }).strict(); const safe = schema.parse(config);
      // Registration cannot manufacture provider capabilities or rehearsal evidence.
      const stored = { ...safe, automaticRelease:false, providerSupportsRelease:false,providerSupportsRollback:false,rehearsalRunIds:[],rollbackVerifiedAt:undefined };
      await (await pool()).query("INSERT INTO software_factory_projects(owner_key,id,config) VALUES($1,$2,$3::jsonb) ON CONFLICT(owner_key,id) DO UPDATE SET config=EXCLUDED.config",[ownerKey(owner),safe.id,JSON.stringify(stored)]); return stored;
    },
    /** Operator-only reconciliation: resolves uncertainty, never retries the external operation. */
    async reconcile(owner:string,id:string,input:{actualCostCents:number;executionStopped:boolean;reason:string}) { if (!Number.isSafeInteger(input.actualCostCents)||input.actualCostCents<0||input.executionStopped!==true||!input.reason.trim()||input.reason.length>2000) throw new Error("FACTORY_RECONCILIATION_PROOF_REQUIRED"); return transaction(async c=>{
      const result=await c.query("UPDATE software_factory_jobs SET status='failed',result=$3::jsonb WHERE owner_key=$1 AND id=$2 AND status='unknown' RETURNING *",[ownerKey(owner),id,JSON.stringify({status:"failed",costCents:input.actualCostCents,reason:input.reason,reconciled:true,executionStopped:true})]);
      if(!result.rows[0])throw new Error("FACTORY_UNKNOWN_JOB_REQUIRED");const job=decode(result.rows[0]);
      await c.query("UPDATE software_factory_budget SET reserved_cents=reserved_cents-$3,spent_cents=spent_cents+$4 WHERE owner_key=$1 AND month=$2",[job.ownerKey,job.month,job.reservedCents,input.actualCostCents]);
      await c.query("UPDATE software_factory_controls SET paused=true WHERE owner_key=$1",[job.ownerKey]);return job;
    }); },
    /** Called only by deployment-owned adapter setup after live capability probes. */
    async configureProjectExecution(key:string,id:string,capabilities:{release:boolean;rollback:boolean;automaticRelease:boolean}) { if(!/^[a-f0-9]{64}$/.test(key))throw new Error("FACTORY_INVALID_OWNER_KEY");return transaction(async c=>{
      const selected=await c.query("SELECT config FROM software_factory_projects WHERE owner_key=$1 AND id=$2 FOR UPDATE",[key,id]);if(!selected.rows[0])throw new Error("FACTORY_PROJECT_MISSING");const project=selected.rows[0].config as FactoryProject;
      if(capabilities.automaticRelease) {
        if(!capabilities.release||!capabilities.rollback||new Set(project.rehearsalRunIds).size<3||!project.rollbackVerifiedAt||Date.now()-Date.parse(project.rollbackVerifiedAt)>86400000||Date.parse(project.rollbackVerifiedAt)>Date.now())throw new Error("FACTORY_PILOT_PROOF_REQUIRED");
        for(const proofId of project.rehearsalRunIds.slice(-3)) {const proof=await c.query("SELECT * FROM software_factory_jobs WHERE owner_key=$1 AND id=$2 AND status='completed'",[key,proofId]);const job=proof.rows[0]?decode(proof.rows[0]):undefined;const state=(job?.result as any)?.evidence?.pipelineState;if(!job||job.projectId!==id||job.kind!=="rollback"||state?.target!=="staging"||state?.verification?.healthy!==true||state?.rollback?.healthy!==true||state?.rollback?.restoredSha!==state?.candidate?.baseSha||!state?.candidate?.baseSha||state?.verification?.headSha!==state?.candidate?.headSha||job.headSha!==state?.candidate?.headSha)throw new Error("FACTORY_PILOT_PROOF_REQUIRED");}
      }
      const updated={...project,providerSupportsRelease:capabilities.release===true,providerSupportsRollback:capabilities.rollback===true,automaticRelease:capabilities.automaticRelease===true};await c.query("UPDATE software_factory_projects SET config=$3::jsonb WHERE owner_key=$1 AND id=$2",[key,id,JSON.stringify(updated)]);return updated;
    }); },
    async claimFinding(key:string,projectId:string,findingKey:string,jobId:string) { if(!/^[a-f0-9]{64}$/.test(key)||!findingKey||findingKey.length>200)throw new Error("FACTORY_INVALID_FINDING");const result=await (await pool()).query("INSERT INTO software_factory_findings(owner_key,project_id,finding_key,job_id) SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM software_factory_jobs WHERE id=$4 AND owner_key=$1 AND input->>'projectId'=$2) ON CONFLICT(owner_key,project_id,finding_key) DO UPDATE SET job_id=software_factory_findings.job_id RETURNING job_id",[key,projectId,findingKey,jobId]);return result.rows[0]?.job_id===jobId; },
    async recordValidation(key:string,projectId:string,rollbackJobId:string) { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("FACTORY_INVALID_OWNER_KEY"); return transaction(async c => {
      const run=await c.query("SELECT * FROM software_factory_jobs WHERE owner_key=$1 AND id=$2 AND status='completed'",[key,rollbackJobId]);
      const job=run.rows[0] ? decode(run.rows[0]) : undefined;
      const state=(job?.result as any)?.evidence?.pipelineState;
      if (!job || job.kind!=="rollback" || job.projectId!==projectId || state?.target!=="staging" || state?.verification?.healthy!==true || state?.rollback?.healthy!==true || state?.verification?.headSha!==state?.candidate?.headSha || state?.rollback?.restoredSha!==state?.candidate?.baseSha || !state?.candidate?.baseSha || job.headSha!==state?.candidate?.headSha) throw new Error("FACTORY_VALIDATION_PROOF_INVALID");
      const selected=await c.query("SELECT config FROM software_factory_projects WHERE owner_key=$1 AND id=$2 FOR UPDATE",[key,projectId]);
      if (!selected.rows[0]) throw new Error("FACTORY_PROJECT_MISSING");
      const config=selected.rows[0].config as FactoryProject;
      if(!job.completedAt || !Number.isFinite(Date.parse(job.completedAt)) || Date.now()-Date.parse(job.completedAt)>86400000 || Date.parse(job.completedAt)>Date.now())throw new Error("FACTORY_VALIDATION_PROOF_STALE");
      if(config.rehearsalRunIds.includes(job.id))return config;
      const updated={...config,rehearsalRunIds:[...new Set([...config.rehearsalRunIds,job.id])].slice(-100),rollbackVerifiedAt:job.completedAt};
      await c.query("UPDATE software_factory_projects SET config=$3::jsonb WHERE owner_key=$1 AND id=$2",[key,projectId,JSON.stringify(updated)]);return updated;
    }); },
    async getCompletedJob(key: string, id: string): Promise<FactoryJob | undefined> { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("FACTORY_INVALID_OWNER_KEY"); const result=await (await pool()).query("SELECT * FROM software_factory_jobs WHERE owner_key=$1 AND id=$2 AND status='completed'",[key,id]); return result.rows[0] ? decode(result.rows[0]) : undefined; },
    async projectByOwnerKey(key:string,id:string): Promise<FactoryProject | undefined> { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("FACTORY_INVALID_OWNER_KEY"); const result=await (await pool()).query("SELECT config FROM software_factory_projects WHERE owner_key=$1 AND id=$2",[key,id]); return result.rows[0]?.config as FactoryProject | undefined; },
    async projects(owner: string): Promise<FactoryProject[]> { return (await (await pool()).query("SELECT config FROM software_factory_projects WHERE owner_key=$1 ORDER BY id",[ownerKey(owner)])).rows.map(r => r.config as FactoryProject); },
    async list(owner: string) { return (await (await pool()).query("SELECT * FROM software_factory_jobs WHERE owner_key=$1 ORDER BY created_at DESC LIMIT 100",[ownerKey(owner)])).rows.map(decode); },
    async status(owner: string) { const key = ownerKey(owner); const month = monthNow(); const p = await pool(); const r = await p.query("SELECT b.*,c.paused FROM software_factory_budget b JOIN software_factory_controls c USING(owner_key) WHERE b.owner_key=$1 AND b.month=$2",[key,month]); const row = r.rows[0]; const workers = (await p.query("SELECT id,last_seen_at,capabilities FROM software_factory_workers WHERE last_seen_at > CURRENT_TIMESTAMP - interval '45 seconds'")).rows; return { configured: !!row, paused: row ? row.paused !== false : true, month, fixedCents: Number(row?.fixed_cents || 0), spentCents: Number(row?.spent_cents || 0), reservedCents: Number(row?.reserved_cents || 0), limitCents: 10000, workers }; },
    async setPaused(owner: string, paused: boolean) { if (typeof paused !== "boolean") throw new Error("FACTORY_INVALID_PAUSE"); await (await pool()).query("INSERT INTO software_factory_controls(owner_key,paused) VALUES($1,$2) ON CONFLICT(owner_key) DO UPDATE SET paused=EXCLUDED.paused",[ownerKey(owner),paused]); },
    async heartbeat(workerId: string, capabilities: Record<string, boolean> = {}) { await (await pool()).query("INSERT INTO software_factory_workers(id,capabilities) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP,capabilities=EXCLUDED.capabilities",[workerId,JSON.stringify(capabilities)]); },
    async idleState(): Promise<{ kind: "idle" | "unknown" | "pendingRecovery" } | { kind: "running"; leaseExpiresAt: string }> {
      const result = await (await pool()).query("SELECT status,lease_expires_at FROM software_factory_jobs WHERE status IN ('running','unknown') OR (status='pending' AND input->>'kind' IN ('verify','rollback')) ORDER BY CASE status WHEN 'unknown' THEN 0 WHEN 'running' THEN 1 ELSE 2 END,lease_expires_at ASC NULLS FIRST LIMIT 1");
      const row = result.rows[0];
      if (!row) return { kind: "idle" };
      if (row.status === "unknown") return { kind: "unknown" };
      if (row.status === "running") {
        const raw = row.lease_expires_at;
        const date = raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : undefined;
        return date && Number.isFinite(date.getTime()) ? { kind: "running", leaseExpiresAt: date.toISOString() } : { kind: "unknown" };
      }
      return { kind: "pendingRecovery" };
    },
    async claim(workerId: string) { return transaction(async c => {
      // Unknown outcomes also retain the global execution slot until operator reconciliation.
      const active = await c.query("SELECT id FROM software_factory_jobs WHERE status IN ('running','unknown') LIMIT 1"); if (active.rows.length) return undefined;
      const selected = await c.query("SELECT j.* FROM software_factory_jobs j JOIN software_factory_controls c USING(owner_key) JOIN software_factory_budget b ON b.owner_key=j.owner_key AND b.month=j.month WHERE j.status='pending' AND (j.result IS NULL OR j.result->'deferred' IS NULL OR (j.result->'deferred'->>'notBefore')::timestamptz<=CURRENT_TIMESTAMP) AND (c.paused=false OR j.input->>'kind' IN ('verify','rollback')) AND (j.month=$1 OR j.input->>'kind' IN ('verify','rollback')) AND b.fixed_cents+b.spent_cents+b.reserved_cents<=10000 ORDER BY CASE WHEN j.input->>'kind' IN ('verify','rollback') THEN 0 ELSE 1 END,j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED",[monthNow()]); if (!selected.rows[0]) return undefined;
      const result = await c.query("UPDATE software_factory_jobs SET status='running',worker_id=$2,fence=$3,lease_expires_at=CURRENT_TIMESTAMP+interval '10 minutes' WHERE id=$1 RETURNING *",[selected.rows[0].id,workerId,randomUUID()]); return decode(result.rows[0]); }); },
    async complete(job: FactoryJob, outcome: FactoryOutcome, next?: FactoryJobInput) { if (!Number.isSafeInteger(outcome.costCents) || outcome.costCents < 0 || !["completed","blocked","failed","unknown"].includes(outcome.status) || JSON.stringify(outcome).length > 200000) throw new Error("FACTORY_INVALID_OUTCOME"); return transaction(async c => {
      const result = await c.query("UPDATE software_factory_jobs SET status=$4,result=$5::jsonb,completed_at=CURRENT_TIMESTAMP WHERE id=$1 AND worker_id=$2 AND fence=$3 AND status='running' AND lease_expires_at>CURRENT_TIMESTAMP RETURNING *",[job.id,job.workerId,job.fence,outcome.status,JSON.stringify(outcome)]); if (!result.rows[0]) return false;
      const stored = decode(result.rows[0]);
      const protectedTransfer=stored.kind==="deploy" && next?.kind==="verify" || stored.kind==="verify" && next?.kind==="rollback";
      if (outcome.status!=="unknown" && stored.recoveryCents>0 && outcome.costCents>stored.reservedCents-stored.recoveryCents) throw new Error("FACTORY_RECOVERY_ESCROW_OVERRUN");
      if (stored.kind==="deploy" && outcome.status==="completed" && !protectedTransfer) throw new Error("FACTORY_VERIFICATION_REQUIRED");
      if(protectedTransfer && (!next || next.reservedCents>stored.reservedCents-outcome.costCents || next.reservedCents<stored.recoveryCents)) throw new Error("FACTORY_RECOVERY_ESCROW_INVALID");
      if (outcome.status !== "unknown") await c.query("UPDATE software_factory_budget SET reserved_cents=reserved_cents-$3,spent_cents=spent_cents+$4 WHERE owner_key=$1 AND month=$2",[stored.ownerKey,stored.month,stored.reservedCents,outcome.costCents]);
      // Actual overruns must be recorded, never concealed by clamping spend.
      if (outcome.costCents > stored.reservedCents) await c.query("UPDATE software_factory_controls SET paused=true WHERE owner_key=$1",[stored.ownerKey]);
      if (next && outcome.status === "completed" && outcome.costCents <= stored.reservedCents) {
        const input = inputSchema.parse({...next,key:stored.id+".next",projectId:stored.projectId});
        if(JSON.stringify(input).length>64000)throw new Error("FACTORY_INPUT_TOO_LARGE");
        const month = protectedTransfer ? stored.month : monthNow(); const admitted = await c.query("UPDATE software_factory_budget SET reserved_cents=reserved_cents+$3 WHERE owner_key=$1 AND month=$2 AND fixed_cents+spent_cents+reserved_cents+$3<=10000 RETURNING *",[stored.ownerKey,month,input.reservedCents]);
        if (admitted.rows.length) await c.query("INSERT INTO software_factory_jobs(id,owner_key,month,input,request_hash,job_key,status) VALUES($1,$2,$3,$4::jsonb,$5,$6,'pending')",[randomUUID(),stored.ownerKey,month,JSON.stringify(input),createHash("sha256").update(JSON.stringify(input)).digest("hex"),input.key]);
        else if(protectedTransfer) throw new Error("FACTORY_RECOVERY_ESCROW_TRANSFER_FAILED");
        else await c.query("UPDATE software_factory_jobs SET result=result || $2::jsonb WHERE id=$1",[stored.id,JSON.stringify({continuationBlocked:"FACTORY_BUDGET_UNAVAILABLE"})]);
      }
      return true; }); },
    /** Returns a claimed zero-cost job to the queue until notBefore. The budget
     * reservation is retained; no outcome, spend or continuation is recorded. */
    async defer(job: FactoryJob, input: { reason: string; notBefore: string }) { if (typeof input?.reason !== "string" || !/^[A-Z0-9_:]{1,200}$/.test(input.reason) || typeof input.notBefore !== "string" || !Number.isFinite(Date.parse(input.notBefore)) || new Date(Date.parse(input.notBefore)).toISOString() !== input.notBefore) throw new Error("FACTORY_INVALID_DEFERRAL"); return transaction(async c => {
      const result = await c.query("UPDATE software_factory_jobs SET status='pending',worker_id=NULL,fence=NULL,lease_expires_at=NULL,result=$4::jsonb WHERE id=$1 AND worker_id=$2 AND fence=$3 AND status='running' AND lease_expires_at>CURRENT_TIMESTAMP AND month=$5 AND $6::timestamptz>CURRENT_TIMESTAMP RETURNING id",[job.id,job.workerId,job.fence,JSON.stringify({deferred:{reason:input.reason,notBefore:input.notBefore}}),input.notBefore.slice(0,7),input.notBefore]);
      return !!result.rows[0]; }); },
    async expire() { const r = await (await pool()).query("UPDATE software_factory_jobs SET status='unknown',result='{}'::jsonb WHERE status='running' AND lease_expires_at<=CURRENT_TIMESTAMP RETURNING id"); return r.rows.length; },
  };
}
export const softwareFactoryStore = createSoftwareFactoryStore();
