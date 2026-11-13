// Black Room team: registry and module contract for the six Black Room agents
// (CEO, analytics, competition, publisher, scripts/editing, website).
//
// Pure module (no fs, no fetch, no React): the client office, the live-status probes,
// the server routes and the tests all read the same registry and parser.
//
// Safety contract for every module implementing BlackRoomTeamAgentModule:
// - Never publish, post, spend money or contact anyone automatically. Anything outward-facing is
//   returned as a BlackRoomTeamApproval (status "pending", dryRun true) for Robert to approve.
// - Report honestly: without the credential or data it needs, getStatus returns state "blocked"
//   with the exact need in `needs`. "working" only with real, recent evidence (lastRunAt).
// - Cheap-first: deterministic code first; any LLM use goes through the existing server helpers.

export const BLACKROOM_TEAM_IDS = [
  "blackroom-ceo",
  "blackroom-analytics",
  "blackroom-competition",
  "blackroom-publisher",
  "blackroom-scripts",
  "blackroom-website",
] as const;

export type BlackRoomTeamAgentId = (typeof BLACKROOM_TEAM_IDS)[number];

/** Existing Black Room agents the CEO also oversees (they keep their own probes and routes). */
export const BLACKROOM_LEGACY_MEMBER_IDS = ["blackroom-videos", "radio"] as const;
export type BlackRoomLegacyMemberId = (typeof BLACKROOM_LEGACY_MEMBER_IDS)[number];
export type BlackRoomTeamMemberId = BlackRoomTeamAgentId | BlackRoomLegacyMemberId;

/** Office department order: CEO first, then the new team, then the existing agents. */
export const BLACKROOM_DEPARTMENT_ORDER: readonly BlackRoomTeamMemberId[] = [...BLACKROOM_TEAM_IDS, ...BLACKROOM_LEGACY_MEMBER_IDS];

export type BlackRoomTeamScreen = "timeline" | "chart" | "code" | "list";

export type BlackRoomTeamRegistryEntry = {
  id: BlackRoomTeamAgentId;
  name: string;
  role: string;
  description: string;
  color: string;
  /** Shown in the office as the agent's data source. */
  sourceName: string;
  screen: BlackRoomTeamScreen;
};

export const BLACKROOM_TEAM: readonly BlackRoomTeamRegistryEntry[] = [
  {
    id: "blackroom-ceo",
    name: "CEO Black Room",
    role: "Dirige todo el equipo de Black Room",
    description: "Supervisa a analiticas, competencia, publicador, guiones, website, videos y radio; resume el estado del equipo y prioriza lo que Robert debe aprobar.",
    color: "#f0abfc",
    sourceName: "Equipo Black Room",
    screen: "list",
  },
  {
    id: "blackroom-analytics",
    name: "Analiticas Black Room",
    role: "Reporte de redes sociales",
    description: "Lee las metricas de redes de Black Room (Metricool) y entrega un reporte de como estuvo todo: alcance, vistas, interacciones y lo que mejor funciono.",
    color: "#c084fc",
    sourceName: "Metricool (lectura)",
    screen: "chart",
  },
  {
    id: "blackroom-competition",
    name: "Competencia Black Room",
    role: "Vigila a la competencia",
    description: "Sigue a la competencia de Black Room: que les funciona mejor, que eventos tienen y sus metricas publicas.",
    color: "#f472b6",
    sourceName: "Fuentes publicas de la competencia",
    screen: "chart",
  },
  {
    id: "blackroom-publisher",
    name: "Publicador Black Room",
    role: "Prepara y programa los posteos",
    description: "Prepara los posteos de Black Room para Metricool (principal) o Meta; nada se publica sin la aprobacion de Robert.",
    color: "#e879f9",
    sourceName: "Metricool / Meta (con aprobacion)",
    screen: "timeline",
  },
  {
    id: "blackroom-scripts",
    name: "Guiones y Edicion Black Room",
    role: "Ideas, guiones y edicion de videos",
    description: "Propone ideas y guiones para los videos de Black Room y prepara la edicion de los videos grabados que Robert envia.",
    color: "#a78bfa",
    sourceName: "Guiones y videos grabados",
    screen: "list",
  },
  {
    id: "blackroom-website",
    name: "Website Black Room",
    role: "Revisa el sitio web",
    description: "Revisa que el sitio web de Black Room este en linea, sin errores y actualizado.",
    color: "#22d3ee",
    sourceName: "Sitio web de Black Room",
    screen: "code",
  },
];

export const BLACKROOM_TEAM_BY_ID: Readonly<Record<BlackRoomTeamAgentId, BlackRoomTeamRegistryEntry>> = Object.fromEntries(
  BLACKROOM_TEAM.map((entry) => [entry.id, entry]),
) as Record<BlackRoomTeamAgentId, BlackRoomTeamRegistryEntry>;

export function isBlackRoomTeamAgentId(value: unknown): value is BlackRoomTeamAgentId {
  return typeof value === "string" && (BLACKROOM_TEAM_IDS as readonly string[]).includes(value);
}

/** Actions are path segments: lowercase words with dashes, e.g. "approve", "reject", "import-csv". */
export function isBlackRoomTeamActionName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(value);
}

export function blackRoomTeamStatusUrl(id: BlackRoomTeamAgentId): string {
  return `/api/blackroom-team/${id}/status`;
}

// ---------------------------------------------------------------------------
// Module contract
// ---------------------------------------------------------------------------

export type BlackRoomTeamState = "working" | "available" | "blocked" | "idle";

export type BlackRoomTeamStatus = {
  id: BlackRoomTeamMemberId;
  state: BlackRoomTeamState;
  /** Short Spanish label for the office monitor, e.g. "Falta METRICOOL_USER_TOKEN". */
  label: string;
  summary: string;
  /** Exact missing credentials/data when blocked (Spanish). Empty when nothing is missing. */
  needs: string[];
  /** ISO time of the last completed run; required as evidence for state "working". */
  lastRunAt: string | null;
  metrics?: Record<string, number | string>;
  /** Pending approvals waiting for Robert (count only; details come from the agent's actions). */
  pendingApprovals?: number;
};

/**
 * Who triggered a run/action: Robert (owner) or an invited partner ("socio"). Structurally the
 * same as WorkspaceActor in shared/workspace-access.ts (kept here to avoid an import cycle).
 */
export type BlackRoomTeamActor = { userId: string; role: "owner" | "partner" };

/** Anything outward-facing (post, message, purchase, upload) waits here for Robert. */
export type BlackRoomTeamApproval = {
  id: string;
  agentId: BlackRoomTeamAgentId;
  kind: string;
  title: string;
  summary: string;
  payload: unknown;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string | null;
  /** Who approved/rejected it (owner or partner); null/absent for older items. */
  decidedBy?: BlackRoomTeamActor | null;
  /** Always true until Robert approves and an explicit live flag is configured. */
  dryRun: boolean;
};

export type BlackRoomTeamRunResult = {
  ok: boolean;
  summary: string;
  report?: unknown;
  needsApproval?: BlackRoomTeamApproval[];
  error?: string;
};

export type BlackRoomTeamEnv = Readonly<Record<string, string | undefined>>;

/** Per-agent JSON state bound to the agent's own file (atomic writes on the server). */
export type BlackRoomTeamStateStore = {
  load<T>(fallback: T): Promise<T>;
  save<T>(value: T): Promise<void>;
};

export type BlackRoomTeamContext = {
  agentId: BlackRoomTeamAgentId;
  env: BlackRoomTeamEnv;
  now: () => Date;
  fetch: typeof fetch;
  /** Directory holding the team's JSON state files (gitignored workspace). */
  dataDir: string;
  /** Owner user id when known (routes and council pass it); null in isolated tests. */
  userId: string | null;
  /** Who triggered this run/action (owner or partner); null for the council, schedulers and tests. */
  actor?: BlackRoomTeamActor | null;
  /** This agent's own JSON state file. */
  state: BlackRoomTeamStateStore;
  /** Status of another Black Room member (new team or legacy videos/radio); null when unavailable. */
  readTeammateStatus(id: BlackRoomTeamMemberId): Promise<BlackRoomTeamStatus | null>;
  /**
   * Rules this agent learned from real outcomes (posts rejected or approved, failed jobs, posts
   * above/below the team median, owner/partner feedback). Deterministic; empty when nothing was
   * learned yet. Optional so isolated tests can omit it.
   */
  readLessons?(): Promise<BlackRoomTeamLessonRule[]>;
};

/** One deterministic rule derived from recorded outcomes (server/blackroom-team/lessons.ts). */
export type BlackRoomTeamLessonRule = {
  id: string;
  agentId: BlackRoomTeamMemberId;
  /** "evitar": repeated rejections/failures; "repetir": what worked; "corregir": explicit feedback. */
  kind: "evitar" | "repetir" | "corregir";
  /** Spanish rule the agent (and its academy trainees) can apply. */
  text: string;
  /** How many recorded outcomes support it. */
  support: number;
  /** Ids of the outcomes behind the rule (evidence, never invented). */
  evidence: string[];
  updatedAt: string;
};

export type BlackRoomTeamActionHandler = (ctx: BlackRoomTeamContext, input: Record<string, unknown>) => Promise<BlackRoomTeamRunResult>;

export type BlackRoomTeamAgentModule = {
  id: BlackRoomTeamAgentId;
  getStatus(ctx: BlackRoomTeamContext): Promise<BlackRoomTeamStatus>;
  run(ctx: BlackRoomTeamContext, input?: Record<string, unknown>): Promise<BlackRoomTeamRunResult>;
  /** Agent-specific actions (e.g. approve, reject), reached via POST /api/blackroom-team/:id/action/:action. */
  actions?: Record<string, BlackRoomTeamActionHandler>;
};

/** Standard status for a module that is not built yet. */
export function underConstructionStatus(id: BlackRoomTeamAgentId): BlackRoomTeamStatus {
  return {
    id,
    state: "blocked",
    label: "En construccion",
    summary: `${BLACKROOM_TEAM_BY_ID[id].name} todavia no esta implementado.`,
    needs: ["Implementar el modulo del agente"],
    lastRunAt: null,
  };
}

// ---------------------------------------------------------------------------
// Status parsing (shared by the live-status probe and the CEO)
// ---------------------------------------------------------------------------

/** "working" needs a completed run within this window; older evidence reads as available. */
export const BLACKROOM_TEAM_WORKING_FRESH_MS = 26 * 60 * 60_000;
const SKEW_MS = 5_000;

const STATES: readonly BlackRoomTeamState[] = ["working", "available", "blocked", "idle"];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Validates an untrusted body as a BlackRoomTeamStatus; returns null for any other shape. */
export function parseBlackRoomTeamStatus(raw: unknown): BlackRoomTeamStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const id = text(body.id);
  const state = text(body.state) as BlackRoomTeamState | null;
  const label = text(body.label);
  if (!id || !state || !STATES.includes(state) || !label) return null;
  if (!isBlackRoomTeamAgentId(id) && !(BLACKROOM_LEGACY_MEMBER_IDS as readonly string[]).includes(id)) return null;
  const needs = Array.isArray(body.needs) ? body.needs.map(text).filter((need): need is string => Boolean(need)).slice(0, 10) : [];
  const lastRunAt = text(body.lastRunAt);
  const metrics: Record<string, number | string> = {};
  if (body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics)) {
    for (const [key, value] of Object.entries(body.metrics as Record<string, unknown>).slice(0, 20)) {
      if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "string") metrics[key] = value;
    }
  }
  const pending = typeof body.pendingApprovals === "number" && Number.isFinite(body.pendingApprovals) && body.pendingApprovals >= 0 ? Math.floor(body.pendingApprovals) : undefined;
  return {
    id: id as BlackRoomTeamMemberId,
    state,
    label,
    summary: text(body.summary) || "",
    needs,
    lastRunAt: lastRunAt && Number.isFinite(Date.parse(lastRunAt)) ? lastRunAt : null,
    ...(Object.keys(metrics).length ? { metrics } : {}),
    ...(pending !== undefined ? { pendingApprovals: pending } : {}),
  };
}

/** Same shape as AgentLiveStatus in shared/agent-live-status.ts (kept structural to avoid a cycle). */
export type BlackRoomTeamLiveStatus = {
  state: "working" | "available" | "needs-setup" | "error" | "offline" | "checking";
  label: string;
  detail?: string;
  lifePenaltyExempt?: boolean;
  evidenceId?: string;
};

/**
 * Maps the module contract to the office live status. "working" survives only with a recent,
 * non-future lastRunAt (and then carries an evidence id); everything else is exempt from penalties
 * because a missing credential or an idle queue is not a failure of assigned work.
 */
export function blackRoomTeamToLiveStatus(raw: unknown, now: number): BlackRoomTeamLiveStatus {
  const status = parseBlackRoomTeamStatus(raw);
  if (!status) return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido", detail: "La respuesta no trae el formato esperado." };
  const detail = [status.summary, status.needs.length ? `Necesita: ${status.needs.slice(0, 3).join(", ")}` : "", status.pendingApprovals ? `${status.pendingApprovals} por aprobar` : ""]
    .filter(Boolean).join(" · ") || undefined;
  switch (status.state) {
    case "blocked":
      return { state: "needs-setup", lifePenaltyExempt: true, label: status.label, detail };
    case "idle":
      return { state: "offline", lifePenaltyExempt: true, label: status.label, detail };
    case "available":
      return { state: "available", lifePenaltyExempt: true, label: status.label, detail };
    case "working": {
      const at = status.lastRunAt ? Date.parse(status.lastRunAt) : Number.NaN;
      const fresh = Number.isFinite(at) && at <= now + SKEW_MS && now - at <= BLACKROOM_TEAM_WORKING_FRESH_MS;
      if (!fresh) return { state: "available", lifePenaltyExempt: true, label: status.label, detail: [detail, "Sin ejecucion reciente verificada"].filter(Boolean).join(" · ") };
      return { state: "working", label: status.label, detail, evidenceId: `blackroom-team:${status.id}:${status.lastRunAt}` };
    }
  }
}

/** Short monitor lines taken only from the agent's own status. */
export function blackRoomTeamActivity(raw: unknown): string[] {
  const status = parseBlackRoomTeamStatus(raw);
  if (!status) return [];
  const metrics = Object.entries(status.metrics || {}).slice(0, 3).map(([key, value]) => `${key}: ${value}`);
  return [status.summary, ...metrics].filter(Boolean).slice(0, 4);
}

/** The agent's own reported needs, shown as problems. */
export function blackRoomTeamProblems(raw: unknown): string[] {
  const status = parseBlackRoomTeamStatus(raw);
  return status ? status.needs.slice(0, 5) : [];
}
