// Software Factory engineers as first-class agents of the main BlackOps company.
//
// Pure and deterministic (no IO). The factory runs its stages in GitHub Actions;
// this module only reads the durably recorded stage rows. Four careers, one per
// proposal stage, live in the MAIN company (never the KONG company) and follow
// the same rules as every other non-KONG career (shared/agent-company.ts):
// battery starts at 80, +6 per verified success, -10 per attributable failure,
// max 100, retirement only at 0 with >= 24 h tenure, then a successor generation
// that waits in the academy. Nothing here relaxes a factory guardrail.

import { advanceCompany, isKongCompanyAgent, type CompanyState } from "./agent-company";
import type { AgentLiveStatus } from "./agent-live-status";
import { isOnDutyWindow, ON_DUTY_DAY_MS, onDutyStatus } from "./office-on-duty";

export const FACTORY_DEPARTMENT = "Ingeniería / Fábrica";

export const FACTORY_AGENTS = [
  { id: "factory-scout", stage: "discover", name: "Fábrica · Scout", role: "Descubre la orden y selecciona archivos" },
  { id: "factory-builder", stage: "build", name: "Fábrica · Builder", role: "Construye el parche del PR borrador" },
  { id: "factory-qa", stage: "simulate", name: "Fábrica · QA", role: "Checks y simulación del candidato" },
  { id: "factory-reviewer", stage: "review", name: "Fábrica · Revisor", role: "Revisión independiente del PR" },
] as const;

export type FactoryAgentId = typeof FACTORY_AGENTS[number]["id"];
export type FactoryCareerStage = typeof FACTORY_AGENTS[number]["stage"];
export const FACTORY_AGENT_IDS: FactoryAgentId[] = FACTORY_AGENTS.map(agent => agent.id);
export const FACTORY_AGENT_NAMES: Record<FactoryAgentId, string> = Object.fromEntries(FACTORY_AGENTS.map(agent => [agent.id, agent.name])) as Record<FactoryAgentId, string>;
export const isFactoryAgentId = (id: string): id is FactoryAgentId => (FACTORY_AGENT_IDS as string[]).includes(id);
export function factoryAgentForStage(kind: string): FactoryAgentId | undefined {
  return FACTORY_AGENTS.find(agent => agent.stage === kind)?.id;
}
// Factory careers are main-company careers by construction.
for (const id of FACTORY_AGENT_IDS) if (isKongCompanyAgent(id)) throw Error("FACTORY_CAREER_IN_KONG_COMPANY");

/** The subset of a stored factory job this module reads. */
export type FactoryJobRow = {
  id: string; kind: string; status: string; ownerKey?: string;
  createdAt?: string; completedAt?: string; leaseExpiresAt?: string;
  payload?: Record<string, unknown>; result?: unknown;
};

const TERMINAL = ["completed", "failed", "blocked"] as const;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const validTime = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** One evidence id per job stage attempt. A repair is a new job id and attempt. */
export function factoryStageEvidenceId(job: Pick<FactoryJobRow, "id" | "kind" | "payload">): string {
  const attempts = Number(job.payload?.repairAttempts ?? 0);
  const attempt = Number.isSafeInteger(attempts) && attempts >= 0 && attempts <= 10 ? attempts : 0;
  return `factory:${job.id}:${job.kind}:${attempt}`;
}

// Attributable failures: the stage's own output was wrong. Everything else that
// is terminal (provider results, missing/stale sources, budget/credit, daily cap,
// infrastructure/transport, gates, operator reconciliation) is exempt.
const BUILDER_PATCH_DIAGNOSTICS = ["PATCH", "EDIT_PATH_NOT_ALLOWED", "OVERLAPPING_EDITS", "EDIT_LIMIT_EXCEEDED", "MALFORMED_JSON",
  "INVALID_EDIT_SHAPE", "INVALID_EDIT_TEXT", "NONUNIQUE_EDIT", "NON_TEXT_EDIT", "EMPTY_PATCH"];
const ATTRIBUTABLE: Record<FactoryCareerStage, { failed: string[]; blocked: string[]; requiresSpend?: boolean }> = {
  // A selection the model answered (billed) that the code validator rejected.
  discover: { failed: [], blocked: ["FACTORY_AUTO_SELECTION_INVALID", "FACTORY_AUTO_SELECTION_PATHS_INVALID", "FACTORY_AUTO_SELECTION_PATH_DENIED",
    "FACTORY_AUTO_SELECTION_PATH_NOT_FOUND", "FACTORY_AUTO_SELECTION_TEST_PATH_REQUIRED"], requiresSpend: true },
  // An unusable patch, or a published candidate whose own checks failed.
  build: { failed: [...BUILDER_PATCH_DIAGNOSTICS.map(code => `FACTORY_REMOTE_BUILD_FAILED:${code}`), "FACTORY_ACTIONS_CHECK_FAILED", "FACTORY_REMOTE_CHECK_FAILED"],
    blocked: ["FACTORY_BUILD_CHECKS_FAILED", "FACTORY_PERMANENT_REGRESSION_TEST_REQUIRED"] },
  // QA and review stages report a verdict about someone else's work; a negative
  // verdict is the job done. A malformed independent review is stored exactly
  // like a rejection, so no job-level attributable failure is distinguishable.
  simulate: { failed: [], blocked: [] },
  review: { failed: [], blocked: [] },
};
// Legitimately empty work: nothing actionable to do is not a success to reward.
const EMPTY_COMPLETIONS = ["FACTORY_NO_ACTIONABLE_FINDING", "FACTORY_FINDING_ALREADY_TRACKED"];

export type FactoryStageOutcome = "success" | "attributable_failure" | "exempt";
export type FactoryStageClassification = { agentId: FactoryAgentId; evidenceId: string; outcome: FactoryStageOutcome; reason: string; completedAt: string };

/** Classifies a durably recorded terminal stage. Non-terminal rows (pending,
 * deferred, running, unknown) return undefined and are reconsidered later. */
export function classifyFactoryStageOutcome(job: FactoryJobRow): FactoryStageClassification | undefined {
  const agentId = factoryAgentForStage(job.kind);
  if (!agentId || !SAFE_ID.test(String(job.id)) || !(TERMINAL as readonly string[]).includes(job.status) || !validTime(job.completedAt)) return undefined;
  const result = job.result && typeof job.result === "object" ? job.result as { status?: unknown; reason?: unknown; costCents?: unknown } : {};
  if (result.status !== undefined && result.status !== job.status) return undefined;
  const reason = typeof result.reason === "string" ? result.reason.slice(0, 200) : "";
  const base = { agentId, evidenceId: factoryStageEvidenceId(job), completedAt: new Date(Date.parse(job.completedAt)).toISOString() };
  if (job.status === "completed") return { ...base, outcome: job.kind === "discover" && EMPTY_COMPLETIONS.includes(reason) ? "exempt" : "success", reason: reason || "FACTORY_STAGE_COMPLETED" };
  const rules = ATTRIBUTABLE[job.kind as FactoryCareerStage];
  const listed = (job.status === "failed" ? rules.failed : rules.blocked).includes(reason);
  const spent = typeof result.costCents === "number" && Number.isSafeInteger(result.costCents) && result.costCents > 0;
  return { ...base, outcome: listed && (!rules.requiresSpend || spent) ? "attributable_failure" : "exempt", reason: reason || `FACTORY_STAGE_${job.status.toUpperCase()}` };
}

export type FactoryLedgerOutcome = FactoryStageOutcome | "before_hire" | "in_training" | "frozen";
export type FactoryLedgerEntry = { evidenceId: string; jobId: string; agentId: FactoryAgentId; outcome: FactoryLedgerOutcome; reason: string; completedAt: string; generation: number; processedAt: string };
export type FactoryPresenceRecord = { lastJobStatus: string; lastWorkedAt: string; lastOutcome?: FactoryLedgerOutcome; observedAt: string };
export type FactoryCareerLedger = {
  version: 1;
  processed: FactoryLedgerEntry[];
  /** Jobs completed at or before this instant were evicted or predate retention and are never processed. */
  evictedThrough?: string;
  presence: Partial<Record<FactoryAgentId, FactoryPresenceRecord>>;
};
export const FACTORY_LEDGER_MAX = 500;

export function emptyFactoryCareerLedger(): FactoryCareerLedger { return { version: 1, processed: [], presence: {} }; }

/** Strict parse of the persisted ledger; invalid content throws (fail closed, like other office journals). */
export function parseFactoryCareerLedger(value: unknown): FactoryCareerLedger {
  if (value === undefined) return emptyFactoryCareerLedger();
  const v = value as FactoryCareerLedger;
  if (!v || typeof v !== "object" || v.version !== 1 || !Array.isArray(v.processed) || v.processed.length > FACTORY_LEDGER_MAX || !v.presence || typeof v.presence !== "object" || Array.isArray(v.presence) ||
    (v.evictedThrough !== undefined && !validTime(v.evictedThrough))) throw Error("FACTORY_CAREER_LEDGER_INVALID");
  const outcomes: FactoryLedgerOutcome[] = ["success", "attributable_failure", "exempt", "before_hire", "in_training", "frozen"];
  const seen = new Set<string>();
  for (const e of v.processed) {
    if (!e || typeof e.evidenceId !== "string" || seen.has(e.evidenceId) || !SAFE_ID.test(e.jobId) || !isFactoryAgentId(e.agentId) || !outcomes.includes(e.outcome) ||
      typeof e.reason !== "string" || !validTime(e.completedAt) || !validTime(e.processedAt) || !Number.isSafeInteger(e.generation) || e.generation < 0) throw Error("FACTORY_CAREER_LEDGER_INVALID");
    seen.add(e.evidenceId);
  }
  for (const [id, p] of Object.entries(v.presence)) {
    if (!isFactoryAgentId(id) || !p || typeof p.lastJobStatus !== "string" || !validTime(p.lastWorkedAt) || !validTime(p.observedAt) ||
      (p.lastOutcome !== undefined && !outcomes.includes(p.lastOutcome))) throw Error("FACTORY_CAREER_LEDGER_INVALID");
  }
  return structuredClone(v);
}

const isRunning = (job: FactoryJobRow, now: number) => job.status === "running" && validTime(job.leaseExpiresAt) && Date.parse(job.leaseExpiresAt) > now;

/**
 * Applies durably recorded factory stage outcomes to the main company through
 * the existing advanceCompany evidence path. Idempotent per job stage attempt
 * (evidence id): replays, restarts and concurrent sweeps never score twice.
 * Also hires missing factory careers (no score) and persists last observed presence.
 */
export function applyFactoryStageOutcomes(input: { company: CompanyState; ledger: FactoryCareerLedger; jobs: readonly FactoryJobRow[]; ownerKey: string; now: number }):
  { company: CompanyState; ledger: FactoryCareerLedger; scored: FactoryLedgerEntry[] } {
  const iso = new Date(input.now).toISOString();
  let company = input.company;
  const ledger: FactoryCareerLedger = structuredClone(input.ledger);
  // Hire: same initial career as any other agent (battery 80), never scored here.
  const missing = FACTORY_AGENT_IDS.filter(id => !company.careers[id]);
  if (missing.length) company = advanceCompany(company, { now: input.now, roles: FACTORY_AGENT_NAMES,
    statuses: Object.fromEntries(missing.map(id => [id, { state: "available" as const, label: "Contratado en la fábrica" }])) }).state;
  const done = new Set(ledger.processed.map(entry => entry.evidenceId));
  const scored: FactoryLedgerEntry[] = [];
  const jobs = input.jobs.filter(job => job && job.ownerKey === input.ownerKey && factoryAgentForStage(job.kind));
  const terminal = jobs.map(job => ({ job, c: classifyFactoryStageOutcome(job) }))
    .filter((item): item is { job: FactoryJobRow; c: FactoryStageClassification } => !!item.c)
    .sort((a, b) => Date.parse(a.c.completedAt) - Date.parse(b.c.completedAt) || a.job.id.localeCompare(b.job.id));
  for (const { job, c } of terminal) {
    if (done.has(c.evidenceId) || (ledger.evictedThrough && Date.parse(c.completedAt) <= Date.parse(ledger.evictedThrough))) continue;
    const career = company.careers[c.agentId];
    let outcome: FactoryLedgerOutcome = c.outcome;
    if (Date.parse(c.completedAt) < Date.parse(career.hiredAt)) outcome = "before_hire"; // previous (retired) generation or pre-hire history
    else if (career.scoreReconciliation !== undefined) outcome = "frozen";
    else if (career.inTrainingUntilGeneration && c.outcome !== "exempt") outcome = "in_training";
    else if (c.outcome !== "exempt") {
      company = advanceCompany(company, { now: input.now, roles: FACTORY_AGENT_NAMES, statuses: {
        [c.agentId]: { state: c.outcome === "success" ? "working" : "error", label: `Etapa ${job.kind} de la fábrica: ${c.reason}`, evidenceId: c.evidenceId },
      } }).state;
    }
    const entry: FactoryLedgerEntry = { evidenceId: c.evidenceId, jobId: job.id, agentId: c.agentId, outcome, reason: c.reason, completedAt: c.completedAt, generation: career.generation, processedAt: iso };
    ledger.processed.push(entry); done.add(c.evidenceId);
    if (outcome === "success" || outcome === "attributable_failure") scored.push(entry);
  }
  if (ledger.processed.length > FACTORY_LEDGER_MAX) {
    const evicted = ledger.processed.splice(0, ledger.processed.length - FACTORY_LEDGER_MAX);
    const latest = Math.max(...evicted.map(e => Date.parse(e.completedAt)), ledger.evictedThrough ? Date.parse(ledger.evictedThrough) : 0);
    ledger.evictedThrough = new Date(latest).toISOString();
  }
  // Last observed presence per stage: a running lease, else the latest recorded completion.
  for (const agent of FACTORY_AGENTS) {
    const own = jobs.filter(job => job.kind === agent.stage);
    const running = own.find(job => isRunning(job, input.now));
    const latest = own.filter(job => validTime(job.completedAt) && (TERMINAL as readonly string[]).includes(job.status))
      .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))[0];
    const previous = ledger.presence[agent.id];
    const lastOutcome = latest ? ledger.processed.find(e => e.jobId === latest.id)?.outcome : undefined;
    if (running) ledger.presence[agent.id] = { lastJobStatus: "running", lastWorkedAt: iso, observedAt: iso, ...(previous?.lastOutcome ? { lastOutcome: previous.lastOutcome } : {}) };
    else if (latest && (!previous || Date.parse(latest.completedAt!) >= Date.parse(previous.lastWorkedAt)))
      ledger.presence[agent.id] = { lastJobStatus: latest.status, lastWorkedAt: new Date(Date.parse(latest.completedAt!)).toISOString(), observedAt: iso, ...(lastOutcome ? { lastOutcome } : {}) };
    // A lease observed earlier that ended without a newer recorded completion stays unconfirmed.
    else if (previous) ledger.presence[agent.id] = { ...previous, lastJobStatus: previous.lastJobStatus === "running" ? "observed_running" : previous.lastJobStatus, observedAt: iso };
  }
  return { company, ledger, scored };
}

export type FactoryAgentView = {
  agentId: FactoryAgentId; name: string; role: string; stage: FactoryCareerStage; department: typeof FACTORY_DEPARTMENT;
  state: "working" | "idle"; source: "live" | "persisted" | "none";
  lastWorkedAt?: string; lastJobStatus?: string; lastOutcome?: FactoryLedgerOutcome; observedAt?: string;
  live: "available" | "unavailable" | "not_read";
};

/** Read-only presence: working only while a stage lease is live in the store. */
export function factoryAgentsView(input: { ledger?: FactoryCareerLedger; liveJobs?: readonly FactoryJobRow[] | "unavailable"; ownerKey?: string; now: number }): FactoryAgentView[] {
  const live = Array.isArray(input.liveJobs) ? input.liveJobs.filter(job => job && (!input.ownerKey || job.ownerKey === input.ownerKey)) : undefined;
  return FACTORY_AGENTS.map((agent): FactoryAgentView => {
    const persisted = input.ledger?.presence[agent.id];
    const own = live?.filter(job => job.kind === agent.stage) || [];
    const running = own.some(job => isRunning(job, input.now));
    const latest = own.filter(job => validTime(job.completedAt)).sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))[0];
    const liveNewer = latest && (!persisted || persisted.lastJobStatus === "running" || Date.parse(latest.completedAt!) > Date.parse(persisted.lastWorkedAt));
    const base = { agentId: agent.id, name: agent.name, role: agent.role, stage: agent.stage, department: FACTORY_DEPARTMENT as typeof FACTORY_DEPARTMENT,
      live: input.liveJobs === "unavailable" ? "unavailable" as const : live ? "available" as const : "not_read" as const };
    if (running) return { ...base, state: "working" as const, source: "live" as const, lastJobStatus: "running", ...(persisted?.lastWorkedAt ? { lastWorkedAt: persisted.lastWorkedAt } : {}) };
    if (liveNewer) return { ...base, state: "idle" as const, source: "live" as const, lastJobStatus: latest!.status, lastWorkedAt: new Date(Date.parse(latest!.completedAt!)).toISOString() };
    if (persisted) return { ...base, state: "idle" as const, source: "persisted" as const, lastJobStatus: persisted.lastJobStatus === "running" ? "observed_running" : persisted.lastJobStatus,
      lastWorkedAt: persisted.lastWorkedAt, observedAt: persisted.observedAt, ...(persisted.lastOutcome ? { lastOutcome: persisted.lastOutcome } : {}) };
    return { ...base, state: "idle" as const, source: "none" as const };
  });
}

const OUTCOME_WORDS: Record<FactoryLedgerOutcome, string> = {
  success: "etapa verificada (+6)", attributable_failure: "fallo atribuible (-10)", exempt: "sin puntuar (no atribuible)",
  before_hire: "antes de su contratacion", in_training: "en academia (sin puntuar)", frozen: "carrera congelada",
};
const shortTime = (value: string) => new Date(Date.parse(value)).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** Office status for a factory engineer. "working" only from a live stage lease; never optimistic. */
export function factoryAgentStatus(view: FactoryAgentView | undefined, council: "loading" | "ready" | "error", now = Date.now()): AgentLiveStatus {
  if (!view) return council === "error" ? { state: "offline", label: "Sin conexion con el consejo" } : council === "loading" ? { state: "checking", label: "Verificando..." } : { state: "available", label: "Sin trabajo registrado de la fabrica" };
  const last = view.lastWorkedAt ? `Ultimo trabajo: ${shortTime(view.lastWorkedAt)}` : "Sin trabajo registrado";
  const outcome = view.lastOutcome ? ` · ${OUTCOME_WORDS[view.lastOutcome]}` : "";
  const live = view.live === "unavailable" ? "Lectura en vivo de la fabrica no disponible; se muestra la ultima observacion." : view.live === "not_read" ? "Ultima observacion guardada por la fabrica." : undefined;
  if (view.state === "working") return { state: "working", label: `Trabajando: etapa ${view.stage} en curso`, detail: "Lease vivo de la fabrica (GitHub Actions).", activity: [`Etapa ${view.stage} en curso`, last] };
  const activity = [last, ...(view.lastJobStatus ? [`Estado: ${view.lastJobStatus}`] : [])];
  // Completed stage in the last day without an attributable failure: on duty, never "working".
  if (view.lastJobStatus === "completed" && view.lastWorkedAt && view.lastOutcome !== "attributable_failure"
    && isOnDutyWindow({ lastWorkAt: view.lastWorkedAt, maxAgeMs: ON_DUTY_DAY_MS, now })) {
    return { ...onDutyStatus({ lastWorkAt: view.lastWorkedAt, now, extra: [`etapa ${view.stage}`, view.lastOutcome ? OUTCOME_WORDS[view.lastOutcome] : "", live || ""].filter(Boolean).join(" · ") }), activity };
  }
  return { state: "available", label: `${last}${outcome}`, ...(live ? { detail: live } : {}), activity };
}
