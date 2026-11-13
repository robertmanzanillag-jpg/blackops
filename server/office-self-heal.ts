import { createHash } from "node:crypto";
import { z } from "zod";
import type { CompanyOrder, CompanyState } from "../shared/agent-company";
import { isKongCompanyAgent } from "../shared/agent-company";
import type { SelfHealAgentSummary, SelfHealOfficeView } from "../shared/office-self-heal-view";

/**
 * Office self-heal: detect -> fix -> verify.
 *
 * The daily role audits (server/office-role-work.ts) detect problems. For a
 * strict allowlist of SMALL code problems that the Software Factory can fix
 * inside its write scope, this module creates at most a few system-authored
 * company orders per UTC day. The text of those orders is a fixed template
 * built only from finding codes, record ids and validated integers, never from
 * free text read from GitHub, the web host or any other external source, so a
 * hostile PR title or log line cannot reach the factory as instructions.
 *
 * Every order then has to pass independent checkers before anything is
 * considered done:
 *   (a) the factory's own pinned checks plus its independent review (a
 *       proposal only exists when proposalEvidenceGate allowed it),
 *   (b) the office review handoff verdict on the exact PR head,
 *   (c) the next daily audits: before merge the fix PR itself must not show
 *       failing checks/conflicts and no new finding of higher severity may
 *       appear; after the PR leaves the open list the original finding must be
 *       gone. A failed check reopens the problem once (one retry), then it is
 *       escalated to the owner.
 *
 * Nothing here merges, deploys, dispatches, closes orders or calls a model.
 * `readyToMerge` is only a display flag: merging stays a human decision
 * (AGENTS.md). All functions that run inside council transactions are pure,
 * because the compare-and-swap store may replay them.
 */

export const SELF_HEAL_ORIGIN = "office-self-heal" as const;
export const SELF_HEAL_REPOSITORY = "robertmanzanillag-jpg/blackops";
export const SELF_HEAL_MAX_ATTEMPTS = 2;
/** Hard ceiling, deliberately below the factory's daily draft PR cap (5). */
export const SELF_HEAL_MAX_ORDERS_PER_DAY = 2;
export const SELF_HEAL_FACTORY_ADMISSION_WAIT_MS = 72 * 3600_000;
const MAX_ENTRIES = 100, MAX_NOTES = 60, MAX_BASELINE = 200, MAX_ORDERS = 60, MAX_EVENTS = 40;

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const day = (iso: string | number) => new Date(iso).toISOString().slice(0, 10);
const PR_URL = /^https:\/\/github\.com\/robertmanzanillag-jpg\/blackops\/pull\/([1-9][0-9]{0,8})$/;
const RECORD = /^[a-f0-9]{64}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const ROLE = /^[a-z][a-z0-9:-]{1,63}$/;

/** Allowlisted (role, code) pairs. Everything else is only counted as detected. */
export const SELF_HEAL_ALLOWLIST = {
  "github:FAILING_DEFAULT_BRANCH": { assignee: "github" },
  "code:PR_FAILING_CHECKS": { assignee: "code" },
} as const;
type AllowKey = keyof typeof SELF_HEAL_ALLOWLIST;

/** Findings that only say data or access is missing. They never become orders. */
export const SELF_HEAL_DATA_ABSENCE_CODES = new Set([
  "SOURCE_MISSING", "NO_RECORDS", "NO_SOURCE_RECORDS", "SOURCE_UNAVAILABLE", "SOURCE_INVALID", "SOURCE_STALE", "SOURCE_LIMIT", "SOURCE_TIME_UNKNOWN",
  "EXPORT_MISSING", "EXPORT_INVALID_OR_STALE", "CAPABILITY_UNAVAILABLE", "NO_REGISTERED_REPOSITORIES", "GITHUB_TOKEN_INVALID", "GITHUB_AUTH_REJECTED",
  "GITHUB_RATE_LIMITED", "GITHUB_TIMEOUT", "GITHUB_READ_DEADLINE", "GITHUB_NETWORK_ERROR", "GITHUB_UPSTREAM_ERROR", "GITHUB_RESPONSE_INVALID",
]);

const SEVERITY: Record<string, number> = {
  HIGH_RISK_AUTONOMY: 4,
  FAILING_DEFAULT_BRANCH: 3, PR_FAILING_CHECKS: 3, PR_CONFLICTED: 3, RECORDED_FAILURE: 3, COLLECTION_EXCEEDS_BOOKED: 3, REPOSITORIES_UNREADABLE: 3, INVALID_SOURCE_VALUES: 3,
  PR_NEEDS_REVIEW: 2, CHECKS_UNREADABLE: 2, WORKFLOW_UNREADABLE: 2, REPOSITORY_UNREADABLE: 2, REPOSITORY_ARCHIVED: 2, SCHEDULE_UNVERIFIED: 2, SAVED_RUN_TIME_PASSED: 2, DUPLICATE_SCOPE: 2,
};
export const selfHealSeverity = (code: string) => SELF_HEAL_DATA_ABSENCE_CODES.has(code) ? 0 : SEVERITY[code] ?? 1;
/** Fix-PR findings that fail the pre-merge re-audit regardless of severity. */
const FIX_PR_BLOCKING = new Set(["PR_FAILING_CHECKS", "PR_CONFLICTED", "CHECKS_UNREADABLE"]);
/** Factory outcomes that are infrastructure (budget, caps, pause, uncertainty), not a failed fix. */
const INFRASTRUCTURE = /CREDIT|BUDGET|DAILY|LIMIT|PAUSED|UNKNOWN|UNCONFIRMED|UNAVAILABLE|RECONCILIATION|DEADLINE|TIMEOUT/;

// ---------- normalized audits (built from the role-work journal) ----------

export type SelfHealAuditRecord = { repo: string; number?: number; draft?: boolean };
export type SelfHealObservedAudit = {
  role: string; jobId: string; completedAt: string; status: "completed" | "blocked"; completeCoverage: boolean; artifactId: string;
  findings: Array<{ code: string; recordId: string | null }>;
  records: Record<string, SelfHealAuditRecord>;
};

type JournalJob = { id?: unknown; role?: unknown; status?: unknown; completedAt?: unknown; artifactId?: unknown; audit?: any; webAudit?: any; source?: any };

/** Normalizes recorded role-work jobs. Reads only codes, record ids and the
 * validated repo/number/draft fields of GitHub rows; detail text is ignored. */
export function observeRoleAudits(journal: unknown): SelfHealObservedAudit[] {
  const jobs: JournalJob[] = Array.isArray((journal as { jobs?: unknown })?.jobs) ? (journal as { jobs: JournalJob[] }).jobs : [];
  const out: SelfHealObservedAudit[] = [];
  for (const job of jobs) {
    if (!job || (job.status !== "completed" && job.status !== "blocked") || typeof job.role !== "string" || !ROLE.test(job.role) || typeof job.id !== "string" || typeof job.completedAt !== "string" || !Number.isFinite(Date.parse(job.completedAt))) continue;
    const findings: SelfHealObservedAudit["findings"] = [], records: Record<string, SelfHealAuditRecord> = {};
    let completeCoverage = false;
    if (job.audit && Array.isArray(job.audit.findings)) {
      completeCoverage = job.audit.completeCoverage === true;
      for (const f of job.audit.findings) {
        if (!f || typeof f.code !== "string" || !CODE.test(f.code)) continue;
        const ids = Array.isArray(f.recordIds) ? f.recordIds.filter((id: unknown): id is string => typeof id === "string" && RECORD.test(id)) : [];
        if (!ids.length) findings.push({ code: f.code, recordId: null });
        for (const id of ids.slice(0, 50)) findings.push({ code: f.code, recordId: id });
      }
      for (const row of Array.isArray(job.source?.rows) ? job.source.rows : []) {
        if (!row || typeof row.id !== "string" || !RECORD.test(row.id) || typeof row.repo !== "string" || !/^[a-z0-9-]{1,39}\/[a-z0-9_.-]{1,100}$/.test(row.repo)) continue;
        records[row.id] = { repo: row.repo, ...(Number.isSafeInteger(row.number) && row.number > 0 ? { number: row.number } : {}), ...(typeof row.draft === "boolean" ? { draft: row.draft } : {}) };
      }
    } else if (job.webAudit && Array.isArray(job.webAudit.diagnostics)) {
      completeCoverage = job.webAudit.completeCoverage === true;
      for (const code of job.webAudit.diagnostics) if (typeof code === "string" && CODE.test(code)) findings.push({ code, recordId: null });
    } else continue;
    out.push({ role: job.role, jobId: job.id, completedAt: job.completedAt, status: job.status, completeCoverage, artifactId: typeof job.artifactId === "string" ? job.artifactId : "", findings, records });
  }
  return out.sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt) || a.jobId.localeCompare(b.jobId));
}

const latestByRole = (audits: readonly SelfHealObservedAudit[]) => {
  const map = new Map<string, SelfHealObservedAudit>();
  for (const a of audits) map.set(a.role, a); // audits are sorted ascending
  return map;
};
const findingKey = (f: { code: string; recordId: string | null }) => `${f.code}:${f.recordId ?? "-"}`;

// ---------- durable state ----------

const stamp = z.string().datetime();
const sha40 = z.string().regex(/^[a-f0-9]{40}$/);
const officeReviewSchema = z.object({ status: z.enum(["not_requested", "pending", "running", "pass", "block", "failed", "head_mismatch", "unavailable"]), findingsCount: z.number().int().min(0).max(1000).optional(), runId: z.string().max(200).optional() }).strict();
const factorySchema = z.object({
  observedAt: stamp, rootJobId: z.string().regex(/^[a-zA-Z0-9:_-]{1,200}$/), state: z.enum(["pending", "running", "blocked", "failed", "unknown", "proposal"]),
  reason: z.string().regex(/^[A-Z0-9_:]{1,120}$/).optional(), reviewJobId: z.string().regex(/^[a-zA-Z0-9:_-]{1,200}$/).optional(),
  prUrl: z.string().regex(PR_URL).optional(), baseSha: sha40.optional(), headSha: sha40.optional(), proposalCompletedAt: stamp.optional(),
  checks: z.literal("pass").optional(), independentReview: z.literal("pass").optional(), officeReview: officeReviewSchema.optional(),
}).strict();
const auditRefSchema = z.object({ jobId: z.string().max(200), completedAt: stamp, artifactId: z.string().max(64), passed: z.boolean(), reason: z.string().regex(/^[A-Z0-9_:]{1,120}$/).optional() }).strict();
const attemptSchema = z.object({
  n: z.number().int().min(1).max(SELF_HEAL_MAX_ATTEMPTS), orderId: z.string().regex(/^ord-sh-[a-f0-9]{20}$/), orderRevision: z.string().regex(/^[a-f0-9]{64}$/), createdAt: stamp,
  factory: factorySchema.optional(), preMerge: auditRefSchema.optional(), prClosedAt: stamp.optional(), postMerge: auditRefSchema.optional(),
  outcome: z.enum(["failed", "verified", "cleared"]).optional(), failedReason: z.string().regex(/^[A-Z0-9_:]{1,120}$/).optional(),
}).strict();
export const SELF_HEAL_STATUSES = ["ordered", "in_factory", "awaiting_office_review", "awaiting_reaudit", "ready_to_merge", "awaiting_post_merge_audit", "needs_owner", "retry_pending", "verified", "cleared", "escalated"] as const;
export type SelfHealStatus = typeof SELF_HEAL_STATUSES[number];
const TERMINAL: readonly SelfHealStatus[] = ["verified", "cleared", "escalated"];
const entrySchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/), key: z.string().regex(/^[a-f0-9]{64}$/), episode: z.number().int().min(1).max(1000),
  role: z.string().regex(ROLE), code: z.string().regex(CODE), recordId: z.string().regex(RECORD), severity: z.number().int().min(0).max(4),
  prNumber: z.number().int().positive().max(999999999).optional(),
  detectedAt: stamp, baseline: z.object({ jobId: z.string().max(200), artifactId: z.string().max(64), completedAt: stamp, findings: z.array(z.string().max(140)).max(MAX_BASELINE) }).strict(),
  status: z.enum(SELF_HEAL_STATUSES), reason: z.string().regex(/^[A-Z0-9_:]{1,120}$/).optional(), readyToMerge: z.boolean(),
  attempts: z.array(attemptSchema).min(1).max(SELF_HEAL_MAX_ATTEMPTS), updatedAt: stamp,
}).strict();
const noteSchema = z.object({ key: z.string().max(140), role: z.string().regex(ROLE), code: z.string().regex(CODE), firstSeenAt: stamp, lastSeenAt: stamp }).strict();
const stateSchema = z.object({ version: z.literal(1), ownerKey: z.string().regex(/^[a-f0-9]{64}$/), entries: z.array(entrySchema).max(MAX_ENTRIES), notes: z.array(noteSchema).max(MAX_NOTES) }).strict();

export type SelfHealFactoryObservation = z.infer<typeof factorySchema>;
export type SelfHealAttempt = z.infer<typeof attemptSchema>;
export type SelfHealEntry = z.infer<typeof entrySchema>;
export type SelfHealState = z.infer<typeof stateSchema>;

export function parseSelfHealState(value: unknown, owner: string): SelfHealState {
  if (typeof owner !== "string" || !owner.trim()) throw Error("SELF_HEAL_OWNER_REQUIRED");
  const ownerKey = digest(owner);
  if (value === undefined) return { version: 1, ownerKey, entries: [], notes: [] };
  const parsed = stateSchema.parse(value);
  if (parsed.ownerKey !== ownerKey) throw Error("SELF_HEAL_OWNER_MISMATCH");
  if (new Set(parsed.entries.map(e => e.id)).size !== parsed.entries.length) throw Error("SELF_HEAL_DUPLICATE_ENTRY");
  if (parsed.entries.filter(e => !TERMINAL.includes(e.status)).length !== new Set(parsed.entries.filter(e => !TERMINAL.includes(e.status)).map(e => e.key)).size) throw Error("SELF_HEAL_DUPLICATE_ACTIVE_KEY");
  return parsed;
}

// ---------- system orders ----------

export type SelfHealOrderMarker = NonNullable<CompanyOrder["selfHeal"]>;

/** Fixed template: only codes, the record id prefix, a validated PR number and
 * constants. Re-derived by the factory to verify integrity before admission. */
export function selfHealOrderText(marker: Pick<SelfHealOrderMarker, "role" | "code" | "recordId" | "attempt" | "prNumber">): string {
  const head = `[Auto-reparación de la oficina · intento ${marker.attempt}/${SELF_HEAL_MAX_ATTEMPTS}] Hallazgo ${marker.role}:${marker.code} (registro ${marker.recordId.slice(0, 16)}).`;
  const what = marker.code === "FAILING_DEFAULT_BRANCH"
    ? ` La última ejecución de Actions en la rama por defecto de ${SELF_HEAL_REPOSITORY} terminó en fallo.`
    : ` Checks fallidos en el PR borrador #${marker.prNumber} de ${SELF_HEAL_REPOSITORY}.`;
  return `${head}${what} Reproduce el fallo con las pruebas existentes, corrige la causa mínima dentro del alcance de escritura y añade una prueba de regresión. No cambies workflows, dependencias, secretos, permisos ni presupuestos. Termina en PR borrador; fusionar es decisión del dueño.`;
}

/** True only for a well-formed system order whose text is exactly the template. */
export function isValidSelfHealOrder(order: CompanyOrder): boolean {
  const m = order?.selfHeal;
  if (!m || m.origin !== SELF_HEAL_ORIGIN || m.version !== 1) return false;
  const allow = SELF_HEAL_ALLOWLIST[`${m.role}:${m.code}` as AllowKey];
  if (!allow || !RECORD.test(m.recordId) || ![1, 2].includes(m.attempt) || (m.code === "PR_FAILING_CHECKS") !== (Number.isSafeInteger(m.prNumber) && m.prNumber! > 0)) return false;
  if (order.assignees.length !== 1 || order.assignees[0].agentId !== allow.assignee || order.assignees.some(a => isKongCompanyAgent(a.agentId))) return false;
  const text = selfHealOrderText(m);
  return order.text === text && text.length <= 500 && !/kong/i.test(text);
}
export const isSelfHealOrder = (order: CompanyOrder) => order?.selfHeal !== undefined;

// ---------- transition logic ----------

const pullRecordId = (prUrl: string) => { const m = PR_URL.exec(prUrl); return m ? digest(["github-pr", SELF_HEAL_REPOSITORY, Number(m[1])]) : undefined; };
/** Same digest as server/office-role-snapshots.ts githubRecordId("pull_request", ...). */
export const selfHealPullRecordId = pullRecordId;

function newHigherSeverity(entry: SelfHealEntry, audit: SelfHealObservedAudit) {
  const baseline = new Set(entry.baseline.findings);
  return audit.findings.find(f => !baseline.has(findingKey(f)) && selfHealSeverity(f.code) > entry.severity);
}

/** Advances the current attempt of one entry from the recorded evidence. */
function advance(entry: SelfHealEntry, audits: readonly SelfHealObservedAudit[], now: number): SelfHealEntry {
  if (TERMINAL.includes(entry.status) || entry.status === "retry_pending") return entry;
  const attempts = entry.attempts.map(a => ({ ...a }));
  const a = attempts[attempts.length - 1];
  const out: SelfHealEntry = { ...entry, attempts, readyToMerge: false };
  delete out.reason;
  const fail = (reason: string): SelfHealEntry => {
    a.outcome = "failed"; a.failedReason = reason;
    return { ...out, status: attempts.length < SELF_HEAL_MAX_ATTEMPTS ? "retry_pending" : "escalated", reason, readyToMerge: false };
  };
  const after = (iso: string, role: string, extra: (x: SelfHealObservedAudit) => boolean = () => true) => audits.filter(x => x.role === role && x.status === "completed" && Date.parse(x.completedAt) > Date.parse(iso) && extra(x));
  const f = a.factory;
  // The problem disappeared before any fix was proposed: verified by re-audit, nothing to merge.
  if (f?.state !== "proposal") {
    const later = after(a.createdAt, entry.role).at(-1);
    if (later && !later.findings.some(x => x.code === entry.code && x.recordId === entry.recordId)) { a.outcome = "cleared"; return { ...out, status: "cleared" }; }
  }
  if (!f) return now - Date.parse(a.createdAt) > SELF_HEAL_FACTORY_ADMISSION_WAIT_MS ? { ...out, status: "needs_owner", reason: "FACTORY_NOT_ADMITTED" } : { ...out, status: "ordered" };
  if (f.state === "pending" || f.state === "running") return { ...out, status: "in_factory" };
  if (f.state === "unknown") return { ...out, status: "needs_owner", reason: "FACTORY_OUTCOME_UNKNOWN" };
  if (f.state === "blocked" || f.state === "failed") {
    const reason = `FACTORY_${f.state.toUpperCase()}${f.reason ? `:${f.reason}` : ""}`.slice(0, 120);
    return f.reason && INFRASTRUCTURE.test(f.reason) ? { ...out, status: "needs_owner", reason } : fail(reason);
  }
  // Checker (a): a proposal only exists when the factory checks and the independent review passed.
  if (f.checks !== "pass" || f.independentReview !== "pass" || !f.prUrl || !f.proposalCompletedAt) return { ...out, status: "in_factory" };
  // Checker (b): office review verdict on the exact head.
  if (f.officeReview?.status === "block") return fail("OFFICE_REVIEW_BLOCK");
  const fixRecord = pullRecordId(f.prUrl)!;
  // Checker (c1): the next complete code audit sees the fix PR without failing checks/conflicts,
  // and the finding's own role shows no new finding of higher severity.
  const codeAudits = after(f.proposalCompletedAt, "code", x => x.completeCoverage);
  if (!a.preMerge && !a.prClosedAt) {
    const first = codeAudits[0];
    if (first) {
      if (!(fixRecord in first.records)) a.prClosedAt = first.completedAt;
      else {
        const bad = first.findings.find(x => x.recordId === fixRecord && FIX_PR_BLOCKING.has(x.code));
        const roleAudit = after(f.proposalCompletedAt, entry.role).at(-1);
        const higher = roleAudit ? newHigherSeverity(entry, roleAudit) : undefined;
        if (bad || higher || roleAudit) a.preMerge = { jobId: first.jobId, completedAt: first.completedAt, artifactId: first.artifactId, passed: !bad && !higher, ...(bad ? { reason: `FIX_PR_${bad.code}` } : higher ? { reason: `NEW_HIGHER_SEVERITY:${higher.code}` } : {}) };
        if (a.preMerge && !a.preMerge.passed) return fail(`PRE_MERGE_REAUDIT:${a.preMerge.reason}`.slice(0, 120));
      }
    }
  }
  if (!a.prClosedAt) {
    const closed = codeAudits.find(x => !(fixRecord in x.records));
    if (closed) a.prClosedAt = closed.completedAt;
  }
  if (!a.prClosedAt) {
    if (f.officeReview?.status !== "pass") return { ...out, status: "awaiting_office_review" };
    if (!a.preMerge?.passed) return { ...out, status: "awaiting_reaudit" };
    // Every checker passed: show the flag. Merging remains the owner's decision.
    return { ...out, status: "ready_to_merge", readyToMerge: true };
  }
  // Checker (c2): the next daily audit after the PR left the open list.
  const post = audits.filter(x => x.role === entry.role && x.status === "completed" && day(x.completedAt) > day(a.prClosedAt!)).at(0);
  if (!post) return { ...out, status: "awaiting_post_merge_audit" };
  const persists = post.findings.some(x => x.code === entry.code && x.recordId === entry.recordId);
  const higher = newHigherSeverity(entry, post);
  a.postMerge = { jobId: post.jobId, completedAt: post.completedAt, artifactId: post.artifactId, passed: !persists && !higher, ...(persists ? { reason: "ORIGINAL_FINDING_PERSISTS" } : higher ? { reason: `NEW_HIGHER_SEVERITY:${higher.code}` } : {}) };
  if (!a.postMerge.passed) return fail(`POST_MERGE_REAUDIT:${a.postMerge.reason}`.slice(0, 120));
  a.outcome = "verified";
  return { ...out, status: "verified" };
}

function buildOrder(entry: SelfHealEntry, n: 1 | 2, iso: string): CompanyOrder {
  const allow = SELF_HEAL_ALLOWLIST[`${entry.role}:${entry.code}` as AllowKey];
  const marker: SelfHealOrderMarker = { origin: SELF_HEAL_ORIGIN, version: 1, entryId: entry.id, key: entry.key, attempt: n, role: entry.role, code: entry.code, recordId: entry.recordId, ...(entry.prNumber ? { prNumber: entry.prNumber } : {}) };
  const text = selfHealOrderText(marker);
  if (text.length > 500 || /kong/i.test(text)) throw Error("SELF_HEAL_ORDER_TEMPLATE_INVALID");
  return {
    id: `ord-sh-${digest([entry.id, n]).slice(0, 20)}`, text, createdAt: iso,
    assignees: [{ agentId: allow.assignee, status: "en_curso", note: "Orden del sistema (auto-reparación de la oficina). Solo puede terminar en un PR borrador revisado; fusionar es decisión del dueño." }],
    selfHeal: marker,
  };
}
/** Same revision digest as server/software-factory-company.ts companyOrderJob. */
const orderRevision = (order: CompanyOrder) => digest([order.id, order.createdAt, order.text]);

/** Mirrors the evidence chain onto each system order (finding -> order -> factory job -> PR -> reviews -> re-audit). */
function mirror(company: CompanyState, state: SelfHealState): CompanyOrder[] {
  const byOrder = new Map<string, { entry: SelfHealEntry; attempt: SelfHealAttempt }>();
  for (const entry of state.entries) for (const attempt of entry.attempts) byOrder.set(attempt.orderId, { entry, attempt });
  return company.orders.map(order => {
    const hit = order.selfHeal ? byOrder.get(order.id) : undefined;
    if (!hit || order.selfHeal!.entryId !== hit.entry.id) return order;
    const current = hit.entry.attempts.at(-1)!.orderId === order.id;
    const chain = {
      status: current ? hit.entry.status : (hit.attempt.outcome === "failed" ? "retried" as const : hit.entry.status),
      readyToMerge: current && hit.entry.readyToMerge,
      finding: { role: hit.entry.role, code: hit.entry.code, recordId: hit.entry.recordId, detectedAt: hit.entry.detectedAt, auditJobId: hit.entry.baseline.jobId, auditArtifactId: hit.entry.baseline.artifactId },
      ...(hit.attempt.factory ? { factory: hit.attempt.factory } : {}),
      ...(hit.attempt.preMerge ? { preMerge: hit.attempt.preMerge } : {}),
      ...(hit.attempt.prClosedAt ? { prClosedAt: hit.attempt.prClosedAt } : {}),
      ...(hit.attempt.postMerge ? { postMerge: hit.attempt.postMerge } : {}),
      ...(hit.attempt.failedReason ? { failedReason: hit.attempt.failedReason } : {}),
      updatedAt: hit.entry.updatedAt,
    };
    return { ...order, selfHeal: { ...order.selfHeal!, chain } };
  });
}

/**
 * Office worker step (pure; run inside the council transaction after the daily
 * role audits). Advances every open entry, records data-absence notes, opens at
 * most `maxPerDay` new or retry orders per UTC day and mirrors the evidence.
 */
export function planSelfHeal(input: { state: unknown; company: CompanyState; journal: unknown; owner: string; now: number; maxPerDay: number }): { state: SelfHealState; company: CompanyState; created: CompanyOrder[] } {
  const { owner, now } = input;
  if (!Number.isSafeInteger(input.maxPerDay) || input.maxPerDay < 1 || input.maxPerDay > SELF_HEAL_MAX_ORDERS_PER_DAY) throw Error("SELF_HEAL_DAILY_CAP_INVALID");
  if (!Number.isFinite(now)) throw Error("SELF_HEAL_CLOCK_INVALID");
  const iso = new Date(now).toISOString(), today = day(now);
  const state = parseSelfHealState(input.state, owner);
  const audits = observeRoleAudits(input.journal), latest = latestByRole(audits);
  // 1. Advance open entries; escalated ones clear when the owner fixed the problem.
  let entries = state.entries.map(entry => {
    if (entry.status === "escalated") {
      const later = audits.filter(x => x.role === entry.role && x.status === "completed" && Date.parse(x.completedAt) > Date.parse(entry.updatedAt)).at(-1);
      return later && !later.findings.some(x => x.code === entry.code && x.recordId === entry.recordId) ? { ...entry, status: "cleared" as const, updatedAt: iso } : entry;
    }
    const next = advance(entry, audits, now);
    return JSON.stringify(next) === JSON.stringify(entry) ? entry : { ...next, updatedAt: iso };
  });
  // 2. Data-absence notes: the owner must provide data/access; never an order.
  const notes = new Map(state.notes.map(n => [n.key, n]));
  for (const [role, audit] of latest) {
    const present = new Set(audit.findings.filter(f => SELF_HEAL_DATA_ABSENCE_CODES.has(f.code)).map(f => f.code));
    for (const code of present) { const key = `${role}:${code}`, old = notes.get(key); notes.set(key, { key, role, code, firstSeenAt: old?.firstSeenAt ?? iso, lastSeenAt: iso }); }
    for (const [key, note] of notes) if (note.role === role && !present.has(note.code)) notes.delete(key);
  }
  // 3. New orders and retries, at most maxPerDay per UTC day (counted from the durable ledger).
  let budget = input.maxPerDay - entries.reduce((n, e) => n + e.attempts.filter(a => day(a.createdAt) === today).length, 0);
  const created: CompanyOrder[] = [];
  const fixPrs = new Set(entries.flatMap(e => e.attempts.map(a => a.factory?.prUrl ? pullRecordId(a.factory.prUrl) : undefined)).filter(Boolean));
  entries = entries.map(entry => {
    if (entry.status !== "retry_pending" || budget <= 0) return entry;
    budget--;
    const order = buildOrder(entry, 2, iso); created.push(order);
    const { reason: _previous, ...rest } = entry;
    return { ...rest, status: "ordered" as const, readyToMerge: false, attempts: [...entry.attempts, { n: 2, orderId: order.id, orderRevision: orderRevision(order), createdAt: iso }], updatedAt: iso };
  });
  const candidates: Array<{ audit: SelfHealObservedAudit; code: string; recordId: string; prNumber?: number }> = [];
  for (const [role, audit] of latest) {
    if (audit.status !== "completed") continue;
    for (const f of audit.findings) {
      if (!f.recordId || !SELF_HEAL_ALLOWLIST[`${role}:${f.code}` as AllowKey] || SELF_HEAL_DATA_ABSENCE_CODES.has(f.code)) continue;
      const record = audit.records[f.recordId];
      if (!record || record.repo !== SELF_HEAL_REPOSITORY || /kong/i.test(record.repo)) continue;
      if (f.code === "PR_FAILING_CHECKS" && (record.draft !== true || !record.number || fixPrs.has(f.recordId))) continue;
      candidates.push({ audit, code: f.code, recordId: f.recordId, ...(f.code === "PR_FAILING_CHECKS" ? { prNumber: record.number } : {}) });
    }
  }
  candidates.sort((a, b) => selfHealSeverity(b.code) - selfHealSeverity(a.code) || `${a.audit.role}:${a.code}:${a.recordId}`.localeCompare(`${b.audit.role}:${b.code}:${b.recordId}`));
  for (const c of candidates) {
    if (budget <= 0) break;
    const key = digest(["self-heal:v1", c.audit.role, c.code, c.recordId]);
    const same = entries.filter(e => e.key === key);
    if (same.some(e => e.status !== "verified" && e.status !== "cleared")) continue; // Idempotent: open or escalated.
    const episode = same.reduce((n, e) => Math.max(n, e.episode), 0) + 1;
    const id = digest([key, episode]).slice(0, 24);
    const entry: SelfHealEntry = { id, key, episode, role: c.audit.role, code: c.code, recordId: c.recordId, severity: selfHealSeverity(c.code), ...(c.prNumber ? { prNumber: c.prNumber } : {}),
      detectedAt: iso, baseline: { jobId: c.audit.jobId, artifactId: c.audit.artifactId, completedAt: c.audit.completedAt, findings: [...new Set(c.audit.findings.map(findingKey))].slice(0, MAX_BASELINE) },
      status: "ordered", readyToMerge: false, attempts: [], updatedAt: iso } as unknown as SelfHealEntry;
    const order = buildOrder(entry, 1, iso); created.push(order);
    entry.attempts = [{ n: 1, orderId: order.id, orderRevision: orderRevision(order), createdAt: iso }];
    entries.push(entry); budget--;
  }
  // 4. Bounded history: never drop open work.
  const open = entries.filter(e => !TERMINAL.includes(e.status));
  const closed = entries.filter(e => TERMINAL.includes(e.status)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, Math.max(0, MAX_ENTRIES - open.length));
  const kept = new Set([...open, ...closed].map(e => e.id));
  const next: SelfHealState = { version: 1, ownerKey: state.ownerKey, entries: entries.filter(e => kept.has(e.id)), notes: [...notes.values()].slice(0, MAX_NOTES) };
  if (open.length > MAX_ENTRIES) throw Error("SELF_HEAL_LEDGER_REQUIRES_RECONCILIATION");
  stateSchema.parse(next);
  let company: CompanyState = input.company;
  if (created.length) {
    company = { ...company,
      orders: [...created, ...company.orders].slice(0, MAX_ORDERS),
      events: [...created.map(o => ({ at: iso, text: `Auto-reparación: orden del sistema ${o.selfHeal!.role}:${o.selfHeal!.code} (intento ${o.selfHeal!.attempt}/${SELF_HEAL_MAX_ATTEMPTS}).` })), ...company.events].slice(0, MAX_EVENTS) };
  }
  return { state: next, company: { ...company, orders: mirror(company, next) }, created };
}

/**
 * Factory worker step (pure; run inside the council transaction). Records what
 * the factory and the office reviewer observed for each current attempt and
 * re-derives the status. It never creates orders.
 */
export function recordSelfHealFactory(input: { state: unknown; company: CompanyState; observations: ReadonlyArray<SelfHealFactoryObservation & { orderId: string; orderRevision: string }>; journal: unknown; owner: string; now: number }): { state: SelfHealState; company: CompanyState; changed: boolean } {
  const state = parseSelfHealState(input.state, input.owner), iso = new Date(input.now).toISOString();
  const audits = observeRoleAudits(input.journal);
  let changed = false;
  const entries = state.entries.map(entry => {
    if (TERMINAL.includes(entry.status) || entry.status === "retry_pending") return entry;
    const a = entry.attempts.at(-1)!;
    const obs = input.observations.filter(o => o.orderId === a.orderId && o.orderRevision === a.orderRevision).sort((x, y) => Date.parse(y.observedAt) - Date.parse(x.observedAt))[0];
    if (!obs) return entry;
    const { orderId: _o, orderRevision: _r, ...factory } = obs;
    const parsed = factorySchema.safeParse(factory);
    if (!parsed.success) return entry;
    const strip = (x?: SelfHealFactoryObservation) => x ? JSON.stringify({ ...x, observedAt: "" }) : "";
    if (strip(a.factory) === strip(parsed.data)) return entry;
    changed = true;
    const withFactory = { ...entry, attempts: [...entry.attempts.slice(0, -1), { ...a, factory: parsed.data }] };
    return { ...advance(withFactory, audits, input.now), updatedAt: iso };
  });
  const next: SelfHealState = { ...state, entries };
  stateSchema.parse(next);
  return { state: next, company: changed ? { ...input.company, orders: mirror(input.company, next) } : input.company, changed };
}

// ---------- read-only office view ----------

const REPAIRING: readonly SelfHealStatus[] = ["ordered", "in_factory", "awaiting_office_review", "awaiting_reaudit", "awaiting_post_merge_audit", "retry_pending"];
const NEEDS_OWNER: readonly SelfHealStatus[] = ["ready_to_merge", "needs_owner", "escalated"];
const VERIFIED_WINDOW_MS = 30 * 86400_000;

/** Public counts per agent. Never includes record ids, PR URLs or audit details. Never throws. */
export function selfHealOfficeView(selfHeal: unknown, roleWork: unknown, now: number, enabled: boolean): SelfHealOfficeView {
  const agents = new Map<string, SelfHealAgentSummary>();
  const row = (agentId: string) => { let r = agents.get(agentId); if (!r) agents.set(agentId, r = { agentId, detected: 0, repairing: 0, verified: 0, needsOwner: 0, readyToMerge: 0 }); return r; };
  try {
    for (const [role, audit] of latestByRole(observeRoleAudits(roleWork))) { const n = new Set(audit.findings.map(findingKey)).size; if (n) row(role).detected += n; }
    const value = selfHeal as Partial<SelfHealState> | undefined;
    for (const e of Array.isArray(value?.entries) ? value!.entries : []) {
      if (!e || typeof e.role !== "string" || !ROLE.test(e.role) || !SELF_HEAL_STATUSES.includes(e.status)) continue;
      const r = row(e.role);
      if (REPAIRING.includes(e.status)) r.repairing++;
      else if (NEEDS_OWNER.includes(e.status)) { r.needsOwner++; if (e.status === "ready_to_merge" && e.readyToMerge === true) r.readyToMerge++; }
      else if ((e.status === "verified" || e.status === "cleared") && now - Date.parse(e.updatedAt) <= VERIFIED_WINDOW_MS) r.verified++;
    }
    for (const n of Array.isArray(value?.notes) ? value!.notes : []) if (n && typeof n.role === "string" && ROLE.test(n.role)) row(n.role).needsOwner++;
  } catch { return { enabled, agents: [] }; }
  return { enabled, agents: [...agents.values()].filter(r => !isKongCompanyAgent(r.agentId)).sort((a, b) => a.agentId.localeCompare(b.agentId)) };
}

// ---------- runners ----------

type OfficeCouncil = { updateOfficeExecution(change: (execution: any, company: CompanyState) => any): Promise<unknown> };

/** Reads OFFICE_SELF_HEAL_* settings. Disabled unless OFFICE_SELF_HEAL_ENABLED=true. */
export function selfHealSettings(env: Record<string, string | undefined>): { enabled: false } | { enabled: true; maxPerDay: number } {
  if (env.OFFICE_SELF_HEAL_ENABLED !== "true") return { enabled: false };
  const raw = env.OFFICE_SELF_HEAL_MAX_ORDERS_PER_DAY ?? "1", maxPerDay = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > SELF_HEAL_MAX_ORDERS_PER_DAY) throw Error("OFFICE_SELF_HEAL_MAX_ORDERS_PER_DAY must be 1 or 2.");
  return { enabled: true, maxPerDay };
}

/** Office worker tick, run after the daily role audits. One durable council
 * transaction; the callback is pure so a CAS replay is harmless. */
export function createSelfHealRunner(options: { council: OfficeCouncil; owner: string; maxPerDay: number; now?: () => number }) {
  if (typeof options.owner !== "string" || !options.owner.trim() || typeof options.council?.updateOfficeExecution !== "function") throw Error("SELF_HEAL_CONFIGURATION_INVALID");
  if (!Number.isSafeInteger(options.maxPerDay) || options.maxPerDay < 1 || options.maxPerDay > SELF_HEAL_MAX_ORDERS_PER_DAY) throw Error("SELF_HEAL_DAILY_CAP_INVALID");
  const now = options.now || Date.now;
  let active: Promise<{ created: number }> | undefined;
  const tick = async () => {
    let created = 0;
    const at = now();
    await options.council.updateOfficeExecution((execution, company) => {
      const result = planSelfHeal({ state: execution.selfHeal, company, journal: execution.roleWork, owner: options.owner, now: at, maxPerDay: options.maxPerDay });
      created = result.created.length;
      // Same established pattern as the factory career sweep: company changes
      // are committed in the same transaction as the office execution ledger.
      Object.assign(company, { orders: result.company.orders, events: result.company.events });
      return { ...execution, selfHeal: result.state };
    });
    return { created };
  };
  return { tick: () => active ||= tick().finally(() => { active = undefined; }) };
}
