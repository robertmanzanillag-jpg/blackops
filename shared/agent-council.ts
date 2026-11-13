import type { OfficeKongCollaboration } from "../server/office-kong-collaboration";
// Agent council: zero-cost peer review between BlackOps agents.
//
// Pure, deterministic logic (no IO, no AI calls). The server wrapper in
// server/agent-council.ts collects real read-only data, runs these rules on a
// schedule, persists the state and submits proposals to the Trust Center, where
// Robert approves or rejects them. Nothing here edits code, skills or agents by
// itself: approved items become playbook lessons or PR-first handoff briefs.

import { agentProbes, summarizeProbe, type AgentLiveStatus } from "./agent-live-status";
import { emptyKongSupervision, parseKongSupervision, type KongSupervision } from "./kong-supervisor";
import { emptyCompanyState, parseCompanyState, separateLegacyKongCompany, type CompanyState } from "./agent-company";

export type Severity = "low" | "medium" | "high";
export type Verdict = "escalado" | "confirmado" | "descartado";

export type CouncilSkillDoc = {
  name: string;
  path: string;
  description: string;
  truncatedInChat: boolean;
  bodyChars: number;
  missingPaths: string[];
};

export type CouncilSignals = {
  now: number;
  clippers?: unknown;
  dropshipping?: unknown;
  marketing?: unknown;
  automationRuns?: unknown[];
  appProjects?: Array<{ id: string; name: string; status?: string | null }>;
  appIncidents?: Array<{ appProjectId?: string | null; status?: string | null; severity?: string | null; title?: string | null }>;
  skills?: CouncilSkillDoc[];
  skillsListedInClaudeMd?: string[];
  maxSkillBodyChars?: number;
};

export type CouncilFinding = {
  ruleId: string;
  reviewer: string;
  subject: string;
  severity: Severity;
  topic: string;
  claim: string;
  evidence: string[];
  defense: string;
  subjectSaysWorking: boolean;
  verdict: Verdict;
  rationale: string;
};

export type CouncilDebate = CouncilFinding & {
  key: string;
  firstSeen: string;
  lastSeen: string;
  streak: number;
  resolvedAt?: string;
};

export type ProposalKind = "lesson" | "skill_update" | "new_agent" | "repair";
export type ProposalStatus = "pending_submit" | "submitted" | "approved" | "applied" | "rejected" | "not_submitted";

export type CouncilProposal = {
  key: string;
  kind: ProposalKind;
  owner: string;
  title: string;
  description: string;
  evidence: string[];
  handoffBrief: string;
  createdAt: string;
  status: ProposalStatus;
  pendingActionId?: string;
  note?: string;
  closedAt?: string;
  lesson?: { ruleId: string; subject: string; label: string };
};

export type CouncilLesson = { key: string; ruleId: string; subject: string; label: string; approvedAt: string };

export type ScoutRelease = { repo: string; tag: string; url: string; publishedAt: string | null; skills: string[] };

export type CouncilState = {
  officeExecution?: { roles: import("./office-role-lifecycle").OfficeRoleLifecycleState; tokens: import("../server/office-token-budget").OfficeTokenBudgetState; internalWork?: import("../server/office-internal-work").InternalWorkState; roleAcademy?: import("../server/office-role-academy").RoleAcademyState; capabilityTraining?: import("../server/office-capability-training").CapabilityTrainingState; roleWork?: import("../server/office-role-work").RoleWorkState; factoryCareers?: import("./factory-office-agents").FactoryCareerLedger; selfHeal?: import("../server/office-self-heal").SelfHealState };
  version: 1;
  kongSupervision: KongSupervision;
  cycles: number;
  lastCycleAt: string | null;
  lastCycleError: string | null;
  debates: CouncilDebate[];
  resolvedDebates: CouncilDebate[];
  proposals: CouncilProposal[];
  lessons: CouncilLesson[];
  agentStates: Record<string, { working: boolean; since: string }>;
  scout: { lastRunAt: string | null; lastSeen: Record<string, string>; latest: ScoutRelease[]; error: string | null };
  company: CompanyState;
  kongCompany: CompanyState;
  /** Historical records only; never scored or advanced and never returned by the public view. */
  kongLegacyCompany: CompanyState;
  kongEvidenceAt: Record<string, string>;
  kongObservedAt: string | null;
  /** Last council attempt to read KONG: reason code only (never messages, bodies or secrets). */
  kongRead: { at: string; ok: boolean; code: string | null } | null;
  kongCollaboration: OfficeKongCollaboration;
  kongLastStatuses: Record<string, { state: AgentLiveStatus["state"]; label: string }>;
  lastStatuses: Record<string, { state: AgentLiveStatus["state"]; label: string }>;
};

export const COUNCIL_CYCLE_MS = 15 * 60_000;
export const SCOUT_INTERVAL_MS = 24 * 60 * 60_000;
export const LESSON_STREAK = 3;
export const HELPER_AGENT_AFTER_MS = 7 * 24 * 60 * 60_000;
export const REJECTED_COOLDOWN_MS = 30 * 24 * 60 * 60_000;
const MAX_RESOLVED = 20;
const MAX_PROPOSALS = 60;
const MAX_OPEN_NEW_AGENT_PROPOSALS = 2;

// Public release feeds the Skills Scout watches. Free: GitHub's public API.
export const SCOUT_WATCHLIST: Array<{ repo: string; skills: string[]; why: string }> = [
  { repo: "anthropics/claude-code", skills: ["project-scout", "review-pr", "qa-gate", "pr-first-fix", "skill-scout"], why: "Cambios de Claude Code afectan como corren las skills y subagentes." },
  { repo: "openai/codex", skills: ["pr-first-fix", "review-pr"], why: "Codex hace los PR-first; sus cambios afectan el handoff." },
  { repo: "TanStack/query", skills: ["qa-gate"], why: "Libreria de datos del cliente." },
  { repo: "drizzle-team/drizzle-orm", skills: ["qa-gate"], why: "ORM de la base de datos." },
  { repo: "vitejs/vite", skills: ["qa-gate"], why: "Build del cliente." },
  { repo: "tailwindlabs/tailwindcss", skills: ["design-creative"], why: "Sistema de estilos de la UI." },
  { repo: "Shopify/cli", skills: ["marketing-autopilot"], why: "Herramientas de Shopify para Dropshipping CEO." },
];

export function emptyCouncilState(): CouncilState {
  return {
    version: 1,
    kongSupervision: emptyKongSupervision(),
    cycles: 0,
    lastCycleAt: null,
    lastCycleError: null,
    debates: [],
    resolvedDebates: [],
    proposals: [],
    lessons: [],
    agentStates: {},
    scout: { lastRunAt: null, lastSeen: {}, latest: [], error: null },
    company: emptyCompanyState(),
    kongCompany: emptyCompanyState(),
    kongLegacyCompany: emptyCompanyState(),
    kongEvidenceAt: {},
    kongObservedAt: null,
    kongRead: null,
    kongCollaboration: { verified: false, observedAt: null, totalFindings: 0, exchanges: [] },
    kongLastStatuses: {},
    lastStatuses: {},
  };
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const arr = (value: unknown): Json[] => (Array.isArray(value) ? (value.map(obj).filter(Boolean) as Json[]) : []);
// Database rows carry Date objects; JSON carries ISO strings. Accept both.
export function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return Number.NaN;
}
// Evidence ends up in the state file and the Trust Center: keep it short and never copy token-like strings.
export function safeText(value: unknown, max = 120): string {
  const raw = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  // UUIDs (record ids) stay readable; other long token-like strings are hidden.
  const cleaned = raw.replace(/[A-Za-z0-9_\-]{24,}/g, (match) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match) ? match : "[redactado]")).replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export function parseCouncilState(raw: string | null): CouncilState {
  if (!raw) return emptyCouncilState();
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Array.isArray(value.debates) || !Array.isArray(value.proposals) || !obj(value.scout)) return emptyCouncilState();
    const base = emptyCouncilState();
    const legacy = separateLegacyKongCompany(parseCompanyState(value.company), parseCompanyState(value.kongLegacyCompany));
    return {
      ...base,
      ...value,
      agentStates: obj(value.agentStates) ? value.agentStates : {},
      lessons: Array.isArray(value.lessons) ? value.lessons : [],
      resolvedDebates: Array.isArray(value.resolvedDebates) ? value.resolvedDebates : [],
      scout: { ...base.scout, ...value.scout, lastSeen: obj(value.scout.lastSeen) ? value.scout.lastSeen : {} },
      company: legacy.company,
      kongLegacyCompany: legacy.archived,
      kongCompany: parseCompanyState(value.kongCompany),
      kongEvidenceAt: Object.fromEntries(Object.entries(obj(value.kongEvidenceAt) || {}).filter(([, v]) => typeof v === "string" && Number.isFinite(Date.parse(v)))),
      kongCollaboration: obj(value.kongCollaboration) && Array.isArray(value.kongCollaboration.exchanges) ? value.kongCollaboration : base.kongCollaboration,
      kongObservedAt: typeof value.kongObservedAt === "string" ? value.kongObservedAt : null,
      kongRead: obj(value.kongRead) && typeof value.kongRead.at === "string" && typeof value.kongRead.ok === "boolean"
        ? { at: value.kongRead.at, ok: value.kongRead.ok, code: typeof value.kongRead.code === "string" ? value.kongRead.code.slice(0, 40) : null }
        : null,
      kongLastStatuses: obj(value.kongLastStatuses) ? value.kongLastStatuses : {},
      kongSupervision: parseKongSupervision(value.kongSupervision),
      lastStatuses: obj(value.lastStatuses) ? value.lastStatuses : {},
    };
  } catch {
    return emptyCouncilState();
  }
}

function subjectStatus(agentId: string, body: unknown): AgentLiveStatus | null {
  const probe = agentProbes[agentId];
  if (!probe || body === undefined) return null;
  return summarizeProbe(probe, { ok: true, status: 200, body });
}

function decide(severity: Severity, subjectSaysWorking: boolean, evidence: string[]): { verdict: Verdict; rationale: string } {
  if (evidence.length === 0) return { verdict: "descartado", rationale: "El revisor no aporto evidencia; el CEO descarta el reclamo." };
  if (subjectSaysWorking && severity !== "low") {
    return { verdict: "escalado", rationale: "El agente dice que todo va bien pero su par encontro evidencia en contra: el CEO lo escala a Robert." };
  }
  if (!subjectSaysWorking) return { verdict: "confirmado", rationale: "El propio agente ya reporta el problema; el CEO confirma y lo deja en su cola." };
  return { verdict: "confirmado", rationale: "Hallazgo menor confirmado; se anota para mejorar el playbook." };
}

function finding(input: Omit<CouncilFinding, "verdict" | "rationale">): CouncilFinding {
  return { ...input, ...decide(input.severity, input.subjectSaysWorking, input.evidence) };
}

// Each rule: one agent reviews another agent's real output.
export function runCrossChecks(signals: CouncilSignals): CouncilFinding[] {
  const findings: CouncilFinding[] = [];
  const now = signals.now;

  // App QA reviews Clippers: a "completed" run that still has configuration blockers is not done.
  const clippers = obj(signals.clippers);
  if (clippers && text(clippers.status) === "completed") {
    const blockers = Array.isArray(clippers.configurationBlockers) ? (clippers.configurationBlockers as unknown[]).map((b) => safeText(b, 60)) : [];
    if (blockers.length > 0) {
      findings.push(finding({
        ruleId: "clippers-done-with-blockers",
        reviewer: "app-qa",
        subject: "clippers",
        severity: "high",
        topic: "Clippers reporta corrida OK con bloqueos",
        claim: `Clippers dice "completed" pero tiene ${blockers.length} bloqueo(s) de configuracion.`,
        evidence: blockers.map((b) => `Bloqueo: ${b}`),
        defense: safeText(obj(clippers.nextAction)?.message) || "Clippers no explica el bloqueo.",
        subjectSaysWorking: subjectStatus("clippers", clippers)?.state === "working",
      }));
    }
  }

  // CEO reviews Automations: failed runs and stuck approvals.
  if (signals.automationRuns) {
    const runs = arr(signals.automationRuns);
    const self = subjectStatus("automations", signals.automationRuns);
    const failed = runs.filter((run) => run.status === "failed" && now - toMs(run.startedAt) <= 26 * 3_600_000);
    if (failed.length > 0) {
      findings.push(finding({
        ruleId: "automations-failed-runs",
        reviewer: "ceo",
        subject: "automations",
        severity: "medium",
        topic: "Automatizaciones con corridas fallidas",
        claim: `${failed.length} corrida(s) fallaron en las ultimas 24 h.`,
        evidence: failed.slice(0, 3).map((run) => `${(text(run.automationId) || "").slice(0, 40) || "?"}: ${safeText(run.errorMessage) || "sin mensaje"}`),
        defense: "Autos registra el error en cada corrida.",
        subjectSaysWorking: self?.state === "working",
      }));
    }
    const stuck = runs.filter((run) => run.status === "pending_approval" && now - toMs(run.startedAt) > 48 * 3_600_000);
    if (stuck.length > 0) {
      findings.push(finding({
        ruleId: "automations-stuck-approvals",
        reviewer: "ceo",
        subject: "automations",
        severity: "medium",
        topic: "Aprobaciones estancadas",
        claim: `${stuck.length} corrida(s) esperan aprobacion hace mas de 48 h.`,
        evidence: stuck.slice(0, 3).map((run) => `${(text(run.automationId) || "").slice(0, 40) || "?"} desde ${new Date(toMs(run.startedAt)).toISOString()}`),
        defense: "Autos no puede seguir sin tu aprobacion.",
        subjectSaysWorking: self?.state === "working",
      }));
    }
  }

  // Cybersecurity reviews app health: status and incidents must agree.
  if (signals.appProjects) {
    const open = (signals.appIncidents || []).filter((incident) => ["open", "investigating", "pending_action"].includes(incident.status || ""));
    const downWithoutIncident = signals.appProjects.filter((app) => app.status === "down" && !open.some((incident) => incident.appProjectId === app.id));
    if (downWithoutIncident.length > 0) {
      findings.push(finding({
        ruleId: "app-down-without-incident",
        reviewer: "cybersecurity",
        subject: "control",
        severity: "high",
        topic: "Apps caidas sin incidente abierto",
        claim: `${downWithoutIncident.length} app(s) estan caidas y nadie abrio incidente.`,
        evidence: downWithoutIncident.slice(0, 4).map((app) => `${app.name}: caida`),
        defense: "Control vigila las apps registradas pero no abre incidentes solo.",
        subjectSaysWorking: true,
      }));
    }
    const healthyWithCritical = signals.appProjects.filter((app) => app.status === "healthy" && open.some((incident) => incident.appProjectId === app.id && incident.severity === "critical"));
    if (healthyWithCritical.length > 0) {
      findings.push(finding({
        ruleId: "app-healthy-with-critical",
        reviewer: "cybersecurity",
        subject: "control",
        severity: "medium",
        topic: "App sana con incidente critico",
        claim: "Hay apps marcadas sanas que tienen un incidente critico abierto.",
        evidence: healthyWithCritical.slice(0, 4).map((app) => `${app.name}: sana + incidente critico`),
        defense: "El chequeo de salud y el incidente vienen de fuentes distintas.",
        subjectSaysWorking: true,
      }));
    }
    const unchecked = signals.appProjects.filter((app) => !app.status || app.status === "unknown");
    if (unchecked.length > 0) {
      findings.push(finding({
        ruleId: "apps-without-health-evidence",
        reviewer: "app-qa",
        subject: "control",
        severity: "low",
        topic: "Apps sin evidencia de salud",
        claim: `${unchecked.length} app(s) nunca tuvieron chequeo de salud.`,
        evidence: unchecked.slice(0, 4).map((app) => `${app.name}: sin chequeo`),
        defense: "Faltan health URLs o el scheduler de salud no las alcanzo.",
        subjectSaysWorking: true,
      }));
    }
  }

  // Claude Reviewer verifies the skill documents the agents read.
  const truncated = (signals.skills || []).filter((skill) => skill.truncatedInChat);
  if (truncated.length > 0) {
    findings.push(finding({
      ruleId: "skills-truncated",
      reviewer: "claude-reviewer",
      subject: "skills-scout",
      severity: "medium",
      topic: `${truncated.length} skill(s) se cortan en el chat de BlackOps`,
      claim: `El puente de skills del chat (web y Telegram) recibe estas skills recortadas al limite de ${signals.maxSkillBodyChars ?? 900} caracteres; en Claude Code se leen completas.`,
      evidence: truncated.map((skill) => `${skill.path}: se recorta`),
      defense: "Las skills se escribieron para Claude Code, donde no hay recorte.",
      subjectSaysWorking: true,
    }));
  }
  for (const skill of signals.skills || []) {
    if (!skill.description) {
      findings.push(finding({
        ruleId: `skill-no-description:${skill.name}`,
        reviewer: "claude-reviewer",
        subject: "skills-scout",
        severity: "medium",
        topic: `Skill ${skill.name} sin descripcion`,
        claim: "Sin description el puente casi nunca la selecciona.",
        evidence: [`${skill.path}: frontmatter sin description`],
        defense: "Sin defensa.",
        subjectSaysWorking: true,
      }));
    }
    if (skill.missingPaths.length > 0) {
      findings.push(finding({
        ruleId: `skill-missing-paths:${skill.name}`,
        reviewer: "claude-reviewer",
        subject: "skills-scout",
        severity: "low",
        topic: `Skill ${skill.name} cita archivos que no existen`,
        claim: `${skill.path} menciona ${skill.missingPaths.length} archivo(s) que no estan en el repo.`,
        evidence: skill.missingPaths.slice(0, 4),
        defense: "Pueden ser archivos generados en runtime.",
        subjectSaysWorking: true,
      }));
    }
  }
  if (signals.skillsListedInClaudeMd && signals.skills) {
    const present = new Set(signals.skills.map((skill) => skill.name));
    const missing = signals.skillsListedInClaudeMd.filter((name) => !present.has(name));
    if (missing.length > 0) {
      findings.push(finding({
        ruleId: "claude-md-missing-skills",
        reviewer: "claude-reviewer",
        subject: "skills-scout",
        severity: "high",
        topic: "CLAUDE.md promete skills que no existen",
        claim: `CLAUDE.md lista ${missing.length} skill(s) sin carpeta en .claude/skills.`,
        evidence: missing.map((name) => `/${name}`),
        defense: "Sin defensa.",
        subjectSaysWorking: true,
      }));
    }
  }

  return findings;
}

export function debateKey(finding: Pick<CouncilFinding, "ruleId" | "subject">) {
  return `${finding.ruleId}|${finding.subject}`;
}

// Keeps a streak per debate across cycles; debates that stop showing up are resolved.
export function mergeDebates(previous: CouncilDebate[], findings: CouncilFinding[], now: number): { active: CouncilDebate[]; resolved: CouncilDebate[] } {
  const iso = new Date(now).toISOString();
  const byKey = new Map(previous.map((debate) => [debate.key, debate]));
  const active: CouncilDebate[] = [];
  const seen = new Set<string>();
  for (const item of findings) {
    const key = debateKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const prior = byKey.get(key);
    active.push({ ...item, key, firstSeen: prior?.firstSeen || iso, lastSeen: iso, streak: (prior?.streak || 0) + 1 });
  }
  const resolved = previous.filter((debate) => !seen.has(debate.key)).map((debate) => ({ ...debate, resolvedAt: iso }));
  return { active, resolved };
}

// Learned lessons change how the building reports an agent: an approved lesson turns a
// "working" claim into "requiere atencion" while its rule keeps firing.
export function applyLessons(debates: CouncilDebate[], lessons: CouncilLesson[]): Record<string, { label: string; detail: string }> {
  const overrides: Record<string, { label: string; detail: string }> = {};
  for (const debate of debates) {
    const lesson = lessons.find((item) => item.ruleId === debate.ruleId && item.subject === debate.subject);
    if (lesson && debate.verdict !== "descartado") overrides[debate.subject] = { label: lesson.label, detail: debate.claim };
  }
  return overrides;
}

export function trackAgentStates(previous: CouncilState["agentStates"], statuses: Record<string, AgentLiveStatus>, now: number) {
  const iso = new Date(now).toISOString();
  const next: CouncilState["agentStates"] = {};
  for (const [agentId, status] of Object.entries(statuses)) {
    const working = status.state === "working";
    const prior = previous[agentId];
    next[agentId] = prior && prior.working === working ? prior : { working, since: iso };
  }
  return next;
}

export function buildHandoffBrief(input: { title: string; goal: string; evidence: string[]; files?: string[]; constraints?: string[] }): string {
  return [
    `Tarea BlackOps (PR-first, costo $0 de API): ${input.title}`,
    "",
    `Objetivo: ${input.goal}`,
    "",
    "Evidencia del consejo de agentes:",
    ...input.evidence.map((line) => `- ${line}`),
    ...(input.files?.length ? ["", "Archivos a revisar:", ...input.files.map((file) => `- ${file}`)] : []),
    "",
    "Reglas:",
    "- Trabaja en una rama nueva y abre PR; no hagas merge ni deploy.",
    "- Corre npm run check, npm run build y el test relacionado.",
    ...(input.constraints || []).map((line) => `- ${line}`),
    "- Responde con: archivos cambiados, pruebas corridas y riesgos.",
  ].join("\n");
}

function hasOpenOrRecent(proposals: CouncilProposal[], key: string, now: number) {
  const existing = proposals.find((proposal) => proposal.key === key);
  if (!existing) return false;
  if (existing.status !== "rejected") return true;
  return now - Date.parse(existing.closedAt || existing.createdAt) < REJECTED_COOLDOWN_MS;
}

export function deriveProposals(state: CouncilState, statuses: Record<string, AgentLiveStatus>, now: number, agentNames: Record<string, string> = {}): CouncilProposal[] {
  const iso = new Date(now).toISOString();
  const created: CouncilProposal[] = [];
  const all = () => [...state.proposals, ...created];
  const nameOf = (id: string) => agentNames[id] || id;

  for (const debate of state.debates) {
    // Repeated conflict -> lesson for the subject's playbook.
    if (debate.verdict === "escalado" && debate.streak >= LESSON_STREAK && !debate.ruleId.startsWith("skill") && debate.ruleId !== "claude-md-missing-skills") {
      const key = `lesson:${debate.key}`;
      const alreadyLearned = state.lessons.some((lesson) => lesson.ruleId === debate.ruleId && lesson.subject === debate.subject);
      if (!alreadyLearned && !hasOpenOrRecent(all(), key, now)) {
        const label = `Requiere atencion: ${debate.topic.toLowerCase()}`;
        created.push({
          key,
          kind: "lesson",
          owner: debate.subject,
          title: `Leccion para ${nameOf(debate.subject)}: ${debate.topic}`,
          description: `${nameOf(debate.reviewer)} encontro lo mismo ${debate.streak} ciclos seguidos. Si apruebas, ${nameOf(debate.subject)} dejara de mostrarse como "trabajando" mientras esto pase.`,
          evidence: debate.evidence,
          handoffBrief: buildHandoffBrief({
            title: `Corregir de raiz: ${debate.topic}`,
            goal: `${debate.claim} Haz que ${nameOf(debate.subject)} lo detecte y lo reporte por si mismo.`,
            evidence: debate.evidence,
          }),
          createdAt: iso,
          status: "pending_submit",
          lesson: { ruleId: debate.ruleId, subject: debate.subject, label },
        });
      }
    }
    // Document problems -> concrete skill update proposal.
    if (debate.ruleId.startsWith("skill") || debate.ruleId === "claude-md-missing-skills") {
      const key = `skill:${debate.ruleId}`;
      if (!hasOpenOrRecent(all(), key, now)) {
        created.push({
          key,
          kind: "skill_update",
          owner: "skills-scout",
          title: debate.topic,
          description: debate.claim,
          evidence: debate.evidence,
          handoffBrief: buildHandoffBrief({
            title: debate.topic,
            goal: debate.ruleId === "skills-truncated"
              ? "Deja la skill bajo el limite del puente: mueve lo esencial (Purpose, Operating Rules, Output) arriba y resume el resto."
              : debate.claim,
            evidence: debate.evidence,
            files: debate.evidence.map((line) => line.split(":")[0]).filter((file) => file.endsWith(".md")),
            constraints: ["No cambies el nombre de la skill.", "Manten las reglas de seguridad y aprobacion."],
          }),
          createdAt: iso,
          status: "pending_submit",
        });
      }
    }
  }

  // Agent factory (CEO): hire a helper for agents stuck outside "working" for days.
  const openNewAgent = all().filter((proposal) => proposal.kind === "new_agent" && ["pending_submit", "submitted"].includes(proposal.status)).length;
  if (openNewAgent < MAX_OPEN_NEW_AGENT_PROPOSALS) {
    const candidates: CouncilProposal[] = [];
    for (const [agentId, info] of Object.entries(state.agentStates)) {
      if (info.working || now - Date.parse(info.since) < HELPER_AGENT_AFTER_MS) continue;
      const status = statuses[agentId];
      const name = nameOf(agentId);
      candidates.push({
        key: `new_agent:helper-${agentId}`,
        kind: "new_agent",
        owner: "ceo",
        title: `Contratar asistente de configuracion para ${name}`,
        description: `${name} lleva mas de 7 dias sin trabajar (${status?.label || "sin estado"}). El CEO propone un agente que guie y verifique esa configuracion paso a paso.`,
        evidence: [status?.label || "sin estado", status?.detail || "", `Sin trabajar desde ${info.since}`].filter(Boolean),
        handoffBrief: buildHandoffBrief({
          title: `Asistente de configuracion para ${name}`,
          goal: `Crear un checklist verificable (solo lectura) de lo que le falta a ${name} y mostrarlo en su ficha del edificio.`,
          evidence: [status?.label || "", status?.detail || ""].filter(Boolean),
          constraints: ["No guardar secretos en el repo.", "Sin gasto de API."],
        }),
        createdAt: iso,
        status: "pending_submit",
      });
    }
    for (const candidate of candidates) {
      if (openNewAgent + created.filter((proposal) => proposal.kind === "new_agent").length >= MAX_OPEN_NEW_AGENT_PROPOSALS) break;
      if (!hasOpenOrRecent(all(), candidate.key, now)) created.push(candidate);
    }
  }
  return created;
}

// Skills Scout: first run records a baseline; afterwards each new release tag becomes one proposal.
export function diffScoutReleases(
  lastSeen: Record<string, string>,
  releases: Array<{ repo: string; tag: string; url: string; publishedAt: string | null }>,
  existing: CouncilProposal[],
  now: number
): { lastSeen: Record<string, string>; latest: ScoutRelease[]; proposals: CouncilProposal[] } {
  const iso = new Date(now).toISOString();
  const next = { ...lastSeen };
  const proposals: CouncilProposal[] = [];
  const latest: ScoutRelease[] = [];
  for (const release of releases) {
    const watch = SCOUT_WATCHLIST.find((item) => item.repo === release.repo);
    if (!watch || !release.tag) continue;
    latest.push({ ...release, skills: watch.skills });
    const previous = lastSeen[release.repo];
    next[release.repo] = release.tag;
    if (!previous || previous === release.tag) continue;
    const key = `scout:${release.repo}@${release.tag}`;
    if (existing.some((proposal) => proposal.key === key) || proposals.some((proposal) => proposal.key === key)) continue;
    proposals.push({
      key,
      kind: "skill_update",
      owner: "skills-scout",
      title: `Novedad: ${release.repo} ${release.tag}`,
      description: `${watch.why} Revisar si las skills ${watch.skills.join(", ")} necesitan cambios (antes: ${previous}).`,
      evidence: [release.url, `Antes: ${previous}`, `Ahora: ${release.tag}`],
      handoffBrief: buildHandoffBrief({
        title: `Actualizar skills por ${release.repo} ${release.tag}`,
        goal: `Lee las notas del release (${release.url}) y propone cambios concretos a: ${watch.skills.map((skill) => `.claude/skills/${skill}/SKILL.md`).join(", ")}. Si no hace falta cambiar nada, dilo.`,
        evidence: [release.url],
        constraints: ["Pega este brief en tu suscripcion (Claude o ChatGPT): no usa API de BlackOps.", "Manten cada skill bajo el limite del puente."],
      }),
      createdAt: iso,
      status: "pending_submit",
    });
  }
  return { lastSeen: next, latest, proposals };
}

export function hasProposal(state: CouncilState, key: string) {
  return state.proposals.some((proposal) => proposal.key === key);
}

export function applyApprovedProposal(state: CouncilState, key: string, now: number): CouncilState {
  const iso = new Date(now).toISOString();
  const proposal = state.proposals.find((item) => item.key === key);
  if (!proposal || proposal.status === "applied" || proposal.status === "rejected") return state;
  const lessons = proposal.kind === "lesson" && proposal.lesson && !state.lessons.some((lesson) => lesson.key === key)
    ? [...state.lessons, { key, ...proposal.lesson, approvedAt: iso }]
    : state.lessons;
  const note = proposal.kind === "lesson"
    ? "Leccion activa en el playbook del agente."
    : "Aprobado: el brief PR-first esta listo para pegar en tu suscripcion o en Codex.";
  return {
    ...state,
    lessons,
    proposals: state.proposals.map((item) => (item.key === key && item.status !== "rejected" ? { ...item, status: "applied", note, closedAt: iso } : item)),
  };
}

export function finishCycle(state: CouncilState, input: {
  findings: CouncilFinding[];
  statuses: Record<string, AgentLiveStatus>;
  now: number;
  agentNames?: Record<string, string>;
}): CouncilState {
  const { active, resolved } = mergeDebates(state.debates, input.findings, input.now);
  const proposalsInCooldown = state.proposals.filter(
    (proposal) => proposal.status !== "rejected" || input.now - Date.parse(proposal.closedAt || proposal.createdAt) < REJECTED_COOLDOWN_MS
  );
  const next: CouncilState = {
    ...state,
    proposals: proposalsInCooldown,
    cycles: state.cycles + 1,
    lastCycleAt: new Date(input.now).toISOString(),
    lastCycleError: null,
    debates: active,
    resolvedDebates: [...resolved, ...state.resolvedDebates].slice(0, MAX_RESOLVED),
    agentStates: trackAgentStates(state.agentStates, input.statuses, input.now),
  };
  const proposals = deriveProposals(next, input.statuses, input.now, input.agentNames);
  return { ...next, proposals: pruneProposals([...proposals, ...next.proposals]) };
}

// Open proposals are never dropped (dropping them would let the same proposal be created twice).
export function pruneProposals(proposals: CouncilProposal[]): CouncilProposal[] {
  const open = proposals.filter((proposal) => ["pending_submit", "submitted", "approved", "not_submitted"].includes(proposal.status));
  const closed = proposals.filter((proposal) => !open.includes(proposal));
  return [...open, ...closed.slice(0, Math.max(0, MAX_PROPOSALS - open.length))];
}

export const MAX_OPEN_REPAIR_PROPOSALS = 3;
const REPAIR_COOLDOWN_MS = 7 * 24 * 60 * 60_000;
const REPAIR_OPEN = ["pending_submit", "submitted", "not_submitted", "approved"];

// The Mechanic: an agent below 30% battery that is not working gets ONE open repair proposal
// (PR-first brief with what its own endpoint says is wrong), at most 3 open at once.
// Agents without an endpoint of their own (exempt) are never "repaired". $0: no AI, no code edits.
export function deriveRepairProposals(
  state: CouncilState,
  statuses: Record<string, AgentLiveStatus>,
  now: number,
  names: Record<string, string> = {},
  exempt: string[] = []
): CouncilProposal[] {
  const iso = new Date(now).toISOString();
  const created: CouncilProposal[] = [];
  const openRepairs = () => [...state.proposals, ...created].filter((proposal) => proposal.kind === "repair" && REPAIR_OPEN.includes(proposal.status)).length;
  for (const career of Object.values(state.company.careers)) {
    if (exempt.includes(career.agentId)) continue;
    const status = statuses[career.agentId];
    if (!status || status.state === "working" || status.state === "checking" || career.inTrainingUntilGeneration) continue;
    if (career.battery >= 30) continue;
    if (openRepairs() >= MAX_OPEN_REPAIR_PROPOSALS) break;
    const prefix = `repair:${career.agentId}#`;
    const previous = [...state.proposals, ...created].filter((proposal) => proposal.key.startsWith(prefix));
    if (previous.some((proposal) => REPAIR_OPEN.includes(proposal.status) || now - toMs(proposal.closedAt || proposal.createdAt) < REPAIR_COOLDOWN_MS)) continue;
    const key = `${prefix}${iso.slice(0, 10)}`;
    const name = names[career.agentId] || career.agentId;
    const evidence = [`Estado: ${status.label}`, status.detail || "", `Bateria ${career.battery}% · ${career.points} puntos`].filter(Boolean);
    created.push({
      key,
      kind: "repair",
      owner: "mechanic",
      title: `Reparar a ${name}`,
      description: `El Mecanico detecto que ${name} (${career.nickname}) no esta trabajando y se esta quedando sin bateria. Si apruebas, queda listo el brief para repararlo.`,
      evidence,
      handoffBrief: buildHandoffBrief({
        title: `Reparar el agente ${name}`,
        goal: `Haz que ${name} vuelva a trabajar. Su propio estado dice: ${status.label}${status.detail ? ` (${status.detail})` : ""}. Corrige la causa (configuracion, conexion o codigo) sin inventar datos.`,
        evidence,
        constraints: ["Si falta una credencial o cuenta, dilo en vez de simularla.", "Sin gasto de API."],
      }),
      createdAt: iso,
      status: "pending_submit",
    });
  }
  return created;
}
