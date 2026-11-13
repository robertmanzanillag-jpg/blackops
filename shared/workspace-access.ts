// Workspace access: owner (Robert) and partner ("socio") roles.
//
// Pure module (no fs, no fetch, no crypto, no React): the server middleware, the client office
// and the tests read the same route policy and redaction helpers.
//
// Policy for partners (deny by default):
// - "allow": Black Room team endpoints (statuses, runs, actions incl. publisher approve/reject),
//   Black Room CEO orders, the Black Room videos agent (status + chat) and the radio slots read.
// - "redact": read-only office probes of non-Black-Room agents. The server answers with a
//   redacted summary before the real handler runs, so no owner data is ever read for a partner.
// - "deny": everything else (KONG, finance/revenue/portfolio, settings, secrets, integrations,
//   deploys, code agents, workspace management, writes of any other kind).

import { agentProbes } from "./agent-live-status";
import { BLACKROOM_DEPARTMENT_ORDER, type BlackRoomTeamMemberId } from "./blackroom-team";

export const WORKSPACE_ROLES = ["owner", "partner"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Who did something. Recorded on Black Room approvals/actions and on CEO orders. */
export type WorkspaceActor = { userId: string; role: WorkspaceRole };

export const WORKSPACE_INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;
export const WORKSPACE_INVITATION_TOKEN_BYTES = 32;
export const WORKSPACE_INVITE_PATH_PREFIX = "/invite/";
export const WORKSPACE_MAX_OPEN_INVITATIONS = 20;
/** New invitations are refused once this many partners are active. */
export const WORKSPACE_MAX_ACTIVE_PARTNERS = 50;

export const PARTNER_SCOPE_NOTE = "Solo Robert";
/** An accept that crashed mid-way frees its claim after this long. */
export const WORKSPACE_INVITATION_CLAIM_MS = 2 * 60_000;

export type WorkspaceInvitation = {
  id: string;
  /** sha256 (hex) of the raw token; the raw token is shown once and never stored. */
  tokenHash: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string | null;
  usedBy?: string | null;
  /** Set while an accept is in flight (single-use claim); cleared if account creation fails. */
  claimedAt?: string | null;
  revokedAt?: string | null;
};

export type WorkspacePartner = {
  userId: string;
  username: string;
  /** Owner user id whose workspace the partner joined (Black Room data is read as this owner). */
  invitedBy: string;
  invitationId: string;
  joinedAt: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
};

export type WorkspaceAccessState = {
  version: 1;
  invitations: WorkspaceInvitation[];
  partners: WorkspacePartner[];
};

export function emptyWorkspaceAccessState(): WorkspaceAccessState {
  return { version: 1, invitations: [], partners: [] };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function iso(value: unknown): string | null {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
}

/** Validates stored state; unknown/garbled entries are dropped (never turned into access). */
export function parseWorkspaceAccessState(raw: unknown): WorkspaceAccessState {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const invitations: WorkspaceInvitation[] = [];
  for (const item of Array.isArray(body.invitations) ? body.invitations : []) {
    const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const id = text(entry.id), tokenHash = text(entry.tokenHash), createdBy = text(entry.createdBy), createdAt = iso(entry.createdAt), expiresAt = iso(entry.expiresAt);
    if (!id || !tokenHash || !/^[a-f0-9]{64}$/.test(tokenHash) || !createdBy || !createdAt || !expiresAt) continue;
    invitations.push({ id, tokenHash, createdBy, createdAt, expiresAt, usedAt: iso(entry.usedAt), usedBy: text(entry.usedBy), claimedAt: iso(entry.claimedAt), revokedAt: iso(entry.revokedAt) });
  }
  const partners: WorkspacePartner[] = [];
  for (const item of Array.isArray(body.partners) ? body.partners : []) {
    const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const userId = text(entry.userId), username = text(entry.username), invitedBy = text(entry.invitedBy), invitationId = text(entry.invitationId), joinedAt = iso(entry.joinedAt);
    if (!userId || !username || !invitedBy || !invitationId || !joinedAt) continue;
    partners.push({ userId, username, invitedBy, invitationId, joinedAt, revokedAt: iso(entry.revokedAt), revokedBy: text(entry.revokedBy) });
  }
  // Partner records are never dropped: losing one would silently erase a revocation (or the
  // partner sandbox) for that account. Growth is bounded by WORKSPACE_MAX_ACTIVE_PARTNERS at
  // invitation time instead.
  return { version: 1, invitations: invitations.slice(-200), partners };
}

export type InvitationStatus = "open" | "used" | "expired" | "revoked" | "claimed";

export function invitationStatus(invitation: WorkspaceInvitation, now: number): InvitationStatus {
  if (invitation.revokedAt) return "revoked";
  if (invitation.usedAt) return "used";
  if (!(Date.parse(invitation.expiresAt) > now)) return "expired";
  if (invitation.claimedAt && now - Date.parse(invitation.claimedAt) < WORKSPACE_INVITATION_CLAIM_MS) return "claimed";
  return "open";
}

/** A token is usable once: not revoked, not used, not claimed by another in-flight accept, not expired. */
export function isInvitationUsable(invitation: WorkspaceInvitation, now: number): boolean {
  return invitationStatus(invitation, now) === "open";
}

/** Raw tokens are base64url of >= 32 random bytes (43+ chars). Anything else is rejected before hashing. */
export function isWellFormedInvitationToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(token);
}

export function workspaceInviteLink(token: string, origin = ""): string {
  return `${origin.replace(/\/$/, "")}${WORKSPACE_INVITE_PATH_PREFIX}${token}`;
}

/** Public list views: never expose token hashes. */
export function invitationView(invitation: WorkspaceInvitation, now: number) {
  return { id: invitation.id, createdAt: invitation.createdAt, expiresAt: invitation.expiresAt, status: invitationStatus(invitation, now), usedAt: invitation.usedAt ?? null, usedBy: invitation.usedBy ?? null, revokedAt: invitation.revokedAt ?? null };
}
export function partnerView(partner: WorkspacePartner) {
  return { userId: partner.userId, username: partner.username, joinedAt: partner.joinedAt, active: !partner.revokedAt, revokedAt: partner.revokedAt ?? null };
}

// ---------------------------------------------------------------------------
// Black Room scope
// ---------------------------------------------------------------------------

export const BLACKROOM_SCOPE_AGENT_IDS: readonly BlackRoomTeamMemberId[] = BLACKROOM_DEPARTMENT_ORDER;

export function isBlackRoomScopeAgent(agentId: unknown): boolean {
  return typeof agentId === "string" && (BLACKROOM_SCOPE_AGENT_IDS as readonly string[]).includes(agentId);
}

/** An order is in the partner's scope only when every assignee is a Black Room member. */
export function isBlackRoomOnlyOrder(order: { assignees?: Array<{ agentId: string }> } | null | undefined): boolean {
  const assignees = order?.assignees || [];
  return assignees.length > 0 && assignees.every((assignee) => isBlackRoomScopeAgent(assignee.agentId));
}

// ---------------------------------------------------------------------------
// Route policy
// ---------------------------------------------------------------------------

export type PartnerRouteDecision =
  /** Pass to the real handler. actAsOwner: the handler reads the workspace owner's data (read-only Black Room views only). */
  | { kind: "allow"; actAsOwner?: boolean }
  /** Answer with a redacted summary; the real handler never runs. */
  | { kind: "redact" }
  | { kind: "deny" };

type Body = Record<string, unknown> | null | undefined;
type Rule = { method: "GET" | "POST"; pattern: RegExp; actAsOwner?: boolean; when?: (body: Body) => boolean };

const companyIsBlackRoom = (body: Body) => body?.company === "blackroom";

/** Explicit partner allowlist. Every route not listed here (and not a redacted probe) is denied. */
export const PARTNER_ALLOWED_ROUTES: readonly Rule[] = [
  { method: "GET", pattern: /^\/api\/workspace\/me$/ },
  // Black Room team (CEO, analytics, competition, publisher, scripts, website).
  { method: "GET", pattern: /^\/api\/blackroom-team$/ },
  { method: "GET", pattern: /^\/api\/blackroom-team\/[a-z0-9-]{1,60}\/status$/ },
  { method: "POST", pattern: /^\/api\/blackroom-team\/[a-z0-9-]{1,60}\/run$/ },
  { method: "POST", pattern: /^\/api\/blackroom-team\/[a-z0-9-]{1,60}\/action\/[a-z][a-z0-9-]{0,39}$/ },
  // Chat with the CEO Black Room (thread, messages, explicit approve/reject of publisher items).
  { method: "GET", pattern: /^\/api\/blackroom-ceo-chat$/ },
  { method: "POST", pattern: /^\/api\/blackroom-ceo-chat\/messages$/ },
  { method: "POST", pattern: /^\/api\/blackroom-ceo-chat\/approvals\/[a-z0-9_-]{1,120}\/(?:approve|reject)$/ },
  // Office: read-only council view (redacted for partners in the handler) and Black Room CEO orders.
  { method: "GET", pattern: /^\/api\/agent-council\/state$/ },
  { method: "POST", pattern: /^\/api\/agent-company\/orders$/, when: companyIsBlackRoom },
  { method: "POST", pattern: /^\/api\/agent-company\/orders\/[^/]{1,120}\/done$/, when: companyIsBlackRoom },
  // Existing Black Room members: videos agent (status + chat) and radio (read of the owner's slots).
  { method: "GET", pattern: /^\/api\/blackroom-agent$/ },
  { method: "POST", pattern: /^\/api\/blackroom-agent\/chat$/ },
  { method: "GET", pattern: /^\/api\/radio\/slots$/, actAsOwner: true },
];

/** Read-only office endpoints that a partner sees as a redacted summary instead of the owner's data. */
export const PARTNER_REDACTED_EXTRA_ROUTES: readonly string[] = [
  "/api/projects",
  "/api/projects/github-overview",
  "/api/legal-compliance/reports",
  "/api/agents-office/cities",
];

function probePaths(): string[] {
  return Object.values(agentProbes).map((probe) => probe.url.split("?")[0]);
}

export function partnerRedactedPaths(): string[] {
  const allowed = (path: string) => PARTNER_ALLOWED_ROUTES.some((rule) => rule.method === "GET" && rule.pattern.test(path));
  return Array.from(new Set([...probePaths(), ...PARTNER_REDACTED_EXTRA_ROUTES])).filter((path) => !allowed(path));
}

/** Decides what a partner may do with one request. Paths are matched exactly (no prefix match). */
export function classifyPartnerRequest(method: string, rawPath: string, body?: unknown): PartnerRouteDecision {
  const verb = String(method || "").toUpperCase();
  const path = (rawPath || "/").split("?")[0].replace(/\/+$/, "") || "/";
  // HEAD follows GET semantics in Express; OPTIONS never reaches handlers with data.
  const effective = verb === "HEAD" ? "GET" : verb;
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  for (const rule of PARTNER_ALLOWED_ROUTES) {
    if (rule.method !== effective || !rule.pattern.test(path)) continue;
    if (rule.when && !rule.when(payload)) continue;
    return rule.actAsOwner ? { kind: "allow", actAsOwner: true } : { kind: "allow" };
  }
  if (effective === "GET" && partnerRedactedPaths().includes(path)) return { kind: "redact" };
  return { kind: "deny" };
}

/** Body served to a partner for a redacted probe. Shaped so the office shows "Solo Robert". */
export function partnerRedactedBody(path: string) {
  return {
    redacted: true as const,
    scope: "owner" as const,
    path,
    error: PARTNER_SCOPE_NOTE,
    summary: "Vista de socio: el detalle de este agente es privado de Robert.",
  };
}

export function isPartnerRedactedBody(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && !Array.isArray(body) && (body as Record<string, unknown>).redacted === true && (body as Record<string, unknown>).scope === "owner");
}

// ---------------------------------------------------------------------------
// Council view redaction (GET /api/agent-council/state for partners)
// ---------------------------------------------------------------------------

type LooseCompany = { careers?: Record<string, { memory?: unknown[] } & Record<string, unknown>>; retiredCareers?: Array<{ agentId?: string; memory?: unknown[] } & Record<string, unknown>>; orders?: Array<{ assignees?: Array<{ agentId: string }> } & Record<string, unknown>>; events?: unknown[]; trainees?: Array<{ forAgentId?: string } & Record<string, unknown>> } & Record<string, unknown>;

/**
 * Keeps the office readable (careers, points, battery, leaderboard) but strips what belongs to
 * Robert: order texts and memories of non-Black-Room agents, company events, debates/proposals/
 * lessons about other agents and their status details.
 */
export function redactCouncilViewForPartner<T extends Record<string, unknown>>(view: T): T {
  const out: Record<string, unknown> = { ...view };
  const company = view.company as LooseCompany | undefined;
  if (company && typeof company === "object") {
    const careers: Record<string, unknown> = {};
    for (const [id, career] of Object.entries(company.careers || {})) {
      careers[id] = isBlackRoomScopeAgent(id) ? career : { ...career, memory: [], reviewGuidance: [] };
    }
    out.company = {
      ...company,
      careers,
      // Fired agents keep their full memory (Robert's order texts, finance/KONG status labels).
      retiredCareers: (company.retiredCareers || []).map((career) =>
        isBlackRoomScopeAgent(career?.agentId) ? career : { ...career, memory: [], reviewGuidance: [] }),
      orders: (company.orders || []).filter((order) => isBlackRoomOnlyOrder(order)),
      events: [],
      trainees: (company.trainees || []).filter((trainee) => isBlackRoomScopeAgent(trainee.forAgentId)),
      academyJobs: [],
    };
  }
  const bySubject = (key: string) => (item: unknown) => isBlackRoomScopeAgent((item as Record<string, unknown> | null)?.[key]);
  if (Array.isArray(view.debates)) out.debates = view.debates.filter(bySubject("subject"));
  if (Array.isArray(view.resolvedDebates)) out.resolvedDebates = view.resolvedDebates.filter(bySubject("subject"));
  if (Array.isArray(view.proposals)) out.proposals = view.proposals.filter(bySubject("owner"));
  if (Array.isArray(view.lessons)) out.lessons = view.lessons.filter(bySubject("subject"));
  if (view.overrides && typeof view.overrides === "object") {
    out.overrides = Object.fromEntries(Object.entries(view.overrides as Record<string, unknown>).filter(([id]) => isBlackRoomScopeAgent(id)));
  }
  if (view.lastStatuses && typeof view.lastStatuses === "object") {
    out.lastStatuses = Object.fromEntries(Object.entries(view.lastStatuses as Record<string, { state?: unknown; label?: unknown }>).map(([id, status]) =>
      [id, isBlackRoomScopeAgent(id) ? status : { state: status?.state, label: PARTNER_SCOPE_NOTE }]));
  }
  if (Array.isArray(view.executionReadiness)) out.executionReadiness = view.executionReadiness.filter(bySubject("agentId"));
  // The raw cycle error can name any probe (finance, KONG); partners only learn that it failed.
  if (typeof view.lastCycleError === "string" && view.lastCycleError) out.lastCycleError = "El ultimo ciclo del consejo tuvo un error.";
  // KONG is owner-only: drop its supervision records entirely for partners.
  delete out.kongSupervision;
  out.costUsd = 0;
  out.workspaceRole = "partner";
  return out as T;
}
