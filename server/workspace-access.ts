// Workspace access: owner (Robert) + invited partners ("socios").
//
// Storage: the existing revenue_engine_state table (own owner key, no migration) in production,
// a git-ignored JSON file locally. Invitation tokens are 32 random bytes (base64url), stored only
// as sha256 hashes, single-use and valid for 7 days. Partner accounts are created through the
// existing local-auth path (same scrypt hashing, same signed cookie / session).
//
// Enforcement: enforceWorkspaceAccess runs right after requireAppUser for every /api request.
// A partner request is decided by classifyPartnerRequest (shared/workspace-access.ts): allow,
// redact (summary instead of owner data) or deny. Any route not explicitly allowed is denied.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import {
  BLACKROOM_SCOPE_AGENT_IDS,
  WORKSPACE_INVITATION_TOKEN_BYTES,
  WORKSPACE_INVITATION_TTL_MS,
  WORKSPACE_MAX_ACTIVE_PARTNERS,
  WORKSPACE_MAX_OPEN_INVITATIONS,
  PARTNER_SCOPE_NOTE,
  classifyPartnerRequest,
  emptyWorkspaceAccessState,
  invitationStatus,
  invitationView,
  isInvitationUsable,
  isWellFormedInvitationToken,
  parseWorkspaceAccessState,
  partnerRedactedBody,
  partnerView,
  workspaceInviteLink,
  type WorkspaceAccessState,
  type WorkspaceActor,
  type WorkspaceInvitation,
  type WorkspacePartner,
  type WorkspaceRole,
} from "@shared/workspace-access";
import { resolveDatabaseConnectionString } from "./database-url";
import { isPublicApiRequest, resolveCurrentUserId, resolveRequestApiPath } from "./user-context";

export type { WorkspaceActor, WorkspaceRole } from "@shared/workspace-access";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export function generateInvitationToken(): string {
  return randomBytes(WORKSPACE_INVITATION_TOKEN_BYTES).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Store (same pattern as server/kong-operations.ts)
// ---------------------------------------------------------------------------

export type WorkspaceAccessStore = {
  read: () => Promise<{ raw: string | null; revision: number | null }>;
  write: (raw: string, expectedRevision: number | null) => Promise<number>;
};
export class WorkspaceAccessConflict extends Error {}

const STATE_OWNER = "workspace-access";
const STATE_KIND = "access_state";
const DB_TIMEOUT_MS = 10_000;
const FILE = path.join(process.env.WORKSPACE_ACCESS_DATA_DIR || path.join(process.cwd(), "agent_office_data"), "workspace-access.json");

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`sin respuesta en ${ms / 1000}s`)), ms); })]).finally(() => clearTimeout(timer));
}

export function createMemoryWorkspaceAccessStore(initial: string | null = null): WorkspaceAccessStore & { raw(): string | null } {
  let raw = initial;
  let revision = initial === null ? 0 : 1;
  return {
    raw: () => raw,
    read: async () => ({ raw, revision: raw === null ? null : revision }),
    write: async (next, expected) => {
      if (expected !== (raw === null ? null : revision)) throw new WorkspaceAccessConflict("state conflict");
      raw = next;
      return ++revision;
    },
  };
}

/** Production: Postgres (existing revenue_engine_state table, own owner key, no migration). Locally: a file. */
export function defaultWorkspaceAccessStore(): WorkspaceAccessStore {
  let hasDatabase = false;
  try {
    hasDatabase = Boolean(resolveDatabaseConnectionString());
  } catch {
    hasDatabase = false;
  }
  if (!hasDatabase) {
    let revision = 0;
    return {
      // Only a missing file means "no state yet". Any other read error must reach the fail-closed path.
      read: async () => ({
        raw: await readFile(FILE, "utf8").catch((error: NodeJS.ErrnoException) => (error?.code === "ENOENT" ? null : Promise.reject(error))),
        revision,
      }),
      write: async (raw, expected) => {
        if (expected !== null && expected !== revision) throw new WorkspaceAccessConflict("state conflict");
        await mkdir(path.dirname(FILE), { recursive: true });
        const tmp = `${FILE}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(tmp, raw, { encoding: "utf8", mode: 0o600 });
        await rename(tmp, FILE);
        return ++revision;
      },
    };
  }
  const adapter = async () => {
    const [{ db }, { createDrizzleRevenueEngineStateAdapter }] = await Promise.all([import("./db"), import("./revenue-engine-state-store")]);
    return createDrizzleRevenueEngineStateAdapter(db);
  };
  return {
    async read() {
      const rows = await withTimeout((await adapter()).loadCollections(STATE_OWNER), DB_TIMEOUT_MS);
      const row = rows.find((item) => item.kind === STATE_KIND);
      return row ? { raw: JSON.stringify(row.data), revision: row.revision } : { raw: null, revision: null };
    },
    async write(raw, expectedRevision) {
      try {
        const row = await withTimeout(
          (await adapter()).upsertCollection({ ownerUserId: STATE_OWNER, kind: STATE_KIND, data: JSON.parse(raw), ...(expectedRevision === null ? {} : { expectedRevision }), updatedAt: new Date() }),
          DB_TIMEOUT_MS,
        );
        return row.revision;
      } catch (error) {
        if (error instanceof Error && /state conflict/i.test(error.message)) throw new WorkspaceAccessConflict(error.message);
        throw error;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type WorkspaceAccessResolution = {
  /** "owner", "partner", or null for any other signed-in user (denied by enforceWorkspaceAccess unless WORKSPACE_ALLOW_UNLISTED_USERS=true). */
  role: WorkspaceRole | null;
  /** True when the user was a partner and the owner revoked the access. Every /api call is refused. */
  revoked: boolean;
  /** The workspace owner whose data the user acts on (the partner's inviter; the owner itself). */
  ownerUserId: string | null;
  partner?: WorkspacePartner;
};

export class WorkspaceAccessError extends Error {
  constructor(public code: "invalid_token" | "invitation_unavailable" | "too_many_invitations" | "not_found", message: string) {
    super(message);
  }
}

export type WorkspaceAccessDeps = {
  store: WorkspaceAccessStore;
  now: () => number;
  isOwner: (userId: string) => Promise<boolean>;
  /** Cross-instance staleness bound for role lookups. Writes on this instance invalidate at once. */
  cacheMs?: number;
  randomToken?: () => string;
};

export function createWorkspaceAccess(deps: WorkspaceAccessDeps) {
  const cacheMs = deps.cacheMs ?? 2_000;
  const randomToken = deps.randomToken ?? generateInvitationToken;
  let cache: { at: number; state: WorkspaceAccessState } | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function readFresh(): Promise<{ state: WorkspaceAccessState; revision: number | null }> {
    const { raw, revision } = await deps.store.read();
    const state = raw === null ? emptyWorkspaceAccessState() : parseWorkspaceAccessState(JSON.parse(raw));
    cache = { at: deps.now(), state };
    return { state, revision };
  }

  async function load(): Promise<WorkspaceAccessState> {
    if (cache && cacheMs > 0 && deps.now() - cache.at < cacheMs) return cache.state;
    return (await readFresh()).state;
  }

  /** Serialized on this instance; revision-checked across instances (retried on conflict). */
  function mutate<T>(change: (state: WorkspaceAccessState) => T): Promise<T> {
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        const { state, revision } = await readFresh();
        const draft = structuredClone(state);
        const result = change(draft);
        try {
          await deps.store.write(JSON.stringify(draft), revision);
          cache = { at: deps.now(), state: draft };
          return result;
        } catch (error) {
          cache = null;
          if (error instanceof WorkspaceAccessConflict && attempt < 3) continue;
          throw error;
        }
      }
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }

  function partnerRecord(state: WorkspaceAccessState, userId: string): WorkspacePartner | undefined {
    for (let index = state.partners.length - 1; index >= 0; index--) if (state.partners[index].userId === userId) return state.partners[index];
    return undefined;
  }

  /** Partner records take precedence over the owner rule: an invited account is never an owner. */
  async function resolve(userId: string, options: { skipOwnerCheck?: boolean } = {}): Promise<WorkspaceAccessResolution> {
    const partner = partnerRecord(await load(), userId);
    if (partner) {
      if (partner.revokedAt) return { role: null, revoked: true, ownerUserId: null, partner };
      return { role: "partner", revoked: false, ownerUserId: partner.invitedBy, partner };
    }
    if (!options.skipOwnerCheck && await deps.isOwner(userId)) return { role: "owner", revoked: false, ownerUserId: userId };
    return { role: null, revoked: false, ownerUserId: null };
  }

  async function getWorkspaceRole(userId: string): Promise<WorkspaceRole | null> {
    return (await resolve(userId)).role;
  }

  async function createInvitation(ownerUserId: string) {
    const token = randomToken();
    if (!isWellFormedInvitationToken(token)) throw new Error("Token de invitacion invalido");
    const now = deps.now();
    const invitation: WorkspaceInvitation = {
      id: `inv-${randomUUID()}`,
      tokenHash: hashInvitationToken(token),
      createdBy: ownerUserId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + WORKSPACE_INVITATION_TTL_MS).toISOString(),
      usedAt: null,
      usedBy: null,
      claimedAt: null,
      revokedAt: null,
    };
    await mutate((state) => {
      if (state.invitations.filter((item) => isInvitationUsable(item, now)).length >= WORKSPACE_MAX_OPEN_INVITATIONS) {
        throw new WorkspaceAccessError("too_many_invitations", "Hay demasiadas invitaciones abiertas. Revoca alguna antes de crear otra.");
      }
      if (state.partners.filter((item) => !item.revokedAt).length >= WORKSPACE_MAX_ACTIVE_PARTNERS) {
        throw new WorkspaceAccessError("too_many_invitations", "Ya hay demasiados socios activos. Revoca alguno antes de invitar a otro.");
      }
      state.invitations.push(invitation);
    });
    return { token, invitation: invitationView(invitation, now) };
  }

  async function listInvitations() {
    const now = deps.now();
    return (await readFresh()).state.invitations.slice().reverse().map((item) => invitationView(item, now));
  }

  async function listPartners() {
    return (await readFresh()).state.partners.slice().reverse().map(partnerView);
  }

  async function revokeInvitation(id: string) {
    const now = deps.now();
    return mutate((state) => {
      const invitation = state.invitations.find((item) => item.id === id);
      if (!invitation) throw new WorkspaceAccessError("not_found", "No encontre esa invitacion.");
      if (!invitation.usedAt && !invitation.revokedAt) invitation.revokedAt = new Date(now).toISOString();
      return invitationView(invitation, now);
    });
  }

  /** Revocation is immediate on this instance (cache replaced) and within cacheMs elsewhere. */
  async function revokePartner(userId: string, revokedBy: string) {
    const now = deps.now();
    return mutate((state) => {
      const partner = partnerRecord(state, userId);
      if (!partner) throw new WorkspaceAccessError("not_found", "No encontre a ese socio.");
      if (!partner.revokedAt) {
        partner.revokedAt = new Date(now).toISOString();
        partner.revokedBy = revokedBy;
      }
      return partnerView(partner);
    });
  }

  function findByToken(state: WorkspaceAccessState, token: unknown): WorkspaceInvitation | undefined {
    if (!isWellFormedInvitationToken(token)) return undefined;
    const hash = hashInvitationToken(token);
    return state.invitations.find((item) => item.tokenHash === hash);
  }

  async function previewInvitation(token: unknown) {
    const invitation = findByToken((await readFresh()).state, token);
    if (!invitation) return { status: "invalid" as const };
    const status = invitationStatus(invitation, deps.now());
    return { status: status === "open" ? "open" as const : "unavailable" as const, expiresAt: status === "open" ? invitation.expiresAt : null };
  }

  /** Single-use claim: only one accept can hold an open invitation at a time. */
  async function claimInvitation(token: unknown): Promise<WorkspaceInvitation> {
    if (!isWellFormedInvitationToken(token)) throw new WorkspaceAccessError("invalid_token", "El enlace de invitacion no es valido.");
    const now = deps.now();
    return mutate((state) => {
      const invitation = findByToken(state, token);
      if (!invitation) throw new WorkspaceAccessError("invalid_token", "El enlace de invitacion no es valido.");
      if (!isInvitationUsable(invitation, now)) throw new WorkspaceAccessError("invitation_unavailable", "Esta invitacion ya se uso, vencio o fue revocada. Pide a Robert un enlace nuevo.");
      invitation.claimedAt = new Date(now).toISOString();
      return { ...invitation };
    });
  }

  async function releaseInvitationClaim(id: string) {
    await mutate((state) => {
      const invitation = state.invitations.find((item) => item.id === id);
      if (invitation && !invitation.usedAt) invitation.claimedAt = null;
    });
  }

  async function completeInvitation(id: string, user: { id: string; username: string }) {
    const now = new Date(deps.now()).toISOString();
    return mutate((state) => {
      const invitation = state.invitations.find((item) => item.id === id);
      if (!invitation) throw new WorkspaceAccessError("not_found", "No encontre esa invitacion.");
      invitation.usedAt = now;
      invitation.usedBy = user.id;
      invitation.claimedAt = null;
      const partner: WorkspacePartner = { userId: user.id, username: user.username, invitedBy: invitation.createdBy, invitationId: invitation.id, joinedAt: now, revokedAt: null, revokedBy: null };
      state.partners.push(partner);
      return partnerView(partner);
    });
  }

  /**
   * Compensation when an invitation accept created the account but could not record the partner:
   * writes a revoked partner record for that account so it can never act as an unlisted user,
   * and releases the claim so the invitee can try again. Retried; throws if it never lands.
   */
  async function quarantineOrphanedAccount(invitationId: string, user: { id: string; username: string }, attempts = 3) {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const now = new Date(deps.now()).toISOString();
        await mutate((state) => {
          const invitation = state.invitations.find((item) => item.id === invitationId);
          if (invitation && !invitation.usedAt) invitation.claimedAt = null;
          const existing = partnerRecord(state, user.id);
          if (existing) {
            if (!existing.revokedAt) { existing.revokedAt = now; existing.revokedBy = "system:accept_failed"; }
            return;
          }
          state.partners.push({ userId: user.id, username: user.username, invitedBy: invitation?.createdBy || "system", invitationId, joinedAt: now, revokedAt: now, revokedBy: "system:accept_failed" });
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  /** The owner rule alone (used when the access store is unreachable). */
  const isOwner = (userId: string) => deps.isOwner(userId);

  return { load, resolve, isOwner, getWorkspaceRole, createInvitation, listInvitations, listPartners, revokeInvitation, revokePartner, previewInvitation, claimInvitation, releaseInvitationClaim, completeInvitation, quarantineOrphanedAccount };
}

export type WorkspaceAccess = ReturnType<typeof createWorkspaceAccess>;

let defaultAccess: WorkspaceAccess | null = null;

export function getWorkspaceAccess(): WorkspaceAccess {
  if (defaultAccess) return defaultAccess;
  defaultAccess = createWorkspaceAccess({
    store: defaultWorkspaceAccessStore(),
    now: () => Date.now(),
    isOwner: async (userId) => (await import("./single-user-owner")).isConfiguredSingleUserOwner(userId),
  });
  return defaultAccess;
}

/** Role of a user in the workspace: "owner", "partner" or null (revoked partners are null). */
export async function getWorkspaceRole(userId: string, access: WorkspaceAccess = getWorkspaceAccess()): Promise<WorkspaceRole | null> {
  return access.getWorkspaceRole(userId);
}

// ---------------------------------------------------------------------------
// Request helpers and middleware
// ---------------------------------------------------------------------------

type WorkspaceLocals = { workspaceActor?: WorkspaceActor; workspaceOwnerUserId?: string };

/** The actor the workspace middleware (or requireOwner / requirePartnerOrOwner) attached to this request. */
export function getRequestWorkspaceActor(res: Response): WorkspaceActor | undefined {
  return (res.locals as WorkspaceLocals).workspaceActor;
}

export type RequestActorResolution = {
  actor: WorkspaceActor;
  /** Whose data the request works on: the owner itself, or the partner's inviting owner. */
  contextUserId: string;
};

/**
 * Resolves the signed-in user as owner or active partner. Returns null for anybody else
 * (no session, revoked partner, other accounts). Use for routes in the Black Room scope.
 */
export async function resolveOwnerOrPartner(userId: string | null, access: WorkspaceAccess = getWorkspaceAccess()): Promise<RequestActorResolution | null> {
  if (!userId) return null;
  const resolution = await access.resolve(userId);
  if (resolution.role === "owner") return { actor: { userId, role: "owner" }, contextUserId: userId };
  if (resolution.role === "partner" && resolution.ownerUserId) return { actor: { userId, role: "partner" }, contextUserId: resolution.ownerUserId };
  return null;
}

function json403(res: Response, error: string, reason: string) {
  res.set("Cache-Control", "no-store");
  res.status(403).json({ error, reason });
}

/** Owner-only route guard (workspace management, anything outside the partner scope). */
export function requireOwner(access?: WorkspaceAccess): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = resolveCurrentUserId(req);
    if (!userId) return void res.status(401).json({ error: "Inicia sesion.", reason: "missing_user_context" });
    try {
      const resolution = await (access ?? getWorkspaceAccess()).resolve(userId);
      if (resolution.role !== "owner") return json403(res, `${PARTNER_SCOPE_NOTE}: esta seccion es solo para el owner.`, "owner_only");
      (res.locals as WorkspaceLocals).workspaceActor = { userId, role: "owner" };
      (res.locals as WorkspaceLocals).workspaceOwnerUserId = userId;
      next();
    } catch {
      res.status(503).json({ error: "No se pudo verificar el acceso." });
    }
  };
}

/** Guard for routes in the Black Room scope: owner or active partner; sets res.locals.workspaceActor. */
export function requirePartnerOrOwner(access?: WorkspaceAccess): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = resolveCurrentUserId(req);
    if (!userId) return void res.status(401).json({ error: "Inicia sesion.", reason: "missing_user_context" });
    try {
      const resolution = await resolveOwnerOrPartner(userId, access ?? getWorkspaceAccess());
      if (!resolution) return json403(res, "Solo Robert y sus socios pueden usar esta seccion.", "workspace_member_only");
      (res.locals as WorkspaceLocals).workspaceActor = resolution.actor;
      (res.locals as WorkspaceLocals).workspaceOwnerUserId = resolution.contextUserId;
      next();
    } catch {
      res.status(503).json({ error: "No se pudo verificar el acceso." });
    }
  };
}

/**
 * Legacy escape hatch: WORKSPACE_ALLOW_UNLISTED_USERS=true lets signed-in users who are neither
 * the owner nor a partner through unfiltered (the pre-partner behavior). Off by default.
 */
function allowsUnlistedUsers(): boolean {
  return process.env.WORKSPACE_ALLOW_UNLISTED_USERS === "true";
}

/**
 * Global partner gate (mounted right after requireAppUser). Owners pass through
 * unchanged; partners only reach the explicit allowlist, redacted probes get a summary, and
 * everything else is 403. Revoked partners are refused on every /api route, and any other signed-in
 * account (neither owner nor active partner) is refused too unless WORKSPACE_ALLOW_UNLISTED_USERS=true.
 */
export function enforceWorkspaceAccess(access?: WorkspaceAccess): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Express routing is case-insensitive: "/API/x" reaches "/api/x" handlers, so match the same way.
    let lowered = req.path.toLowerCase();
    try { lowered = decodeURIComponent(req.path).toLowerCase(); } catch { /* keep the raw path */ }
    if (!lowered.startsWith("/api") && !req.path.toLowerCase().startsWith("/api")) return next();
    if (isPublicApiRequest(req)) return next();
    const userId = resolveCurrentUserId(req);
    if (!userId) return next();
    const service = access ?? getWorkspaceAccess();
    let resolution: WorkspaceAccessResolution;
    try {
      resolution = await service.resolve(userId, { skipOwnerCheck: true });
    } catch {
      // Cannot tell whether this user is a partner: only the owner continues.
      try {
        if (await service.isOwner(userId)) return next();
      } catch { /* fall through */ }
      res.set("Cache-Control", "no-store");
      return void res.status(503).json({ error: "No se pudo verificar el acceso. Intenta de nuevo.", reason: "workspace_access_unavailable" });
    }
    if (resolution.revoked) {
      // The role endpoint stays readable so the client can tell the user why everything is closed.
      if (req.method === "GET" && resolveRequestApiPath(req).split("?")[0] === "/api/workspace/me") return next();
      return json403(res, "Tu acceso de socio fue revocado.", "partner_revoked");
    }
    if (resolution.role !== "partner" || !resolution.ownerUserId) {
      // Single-owner workspace: only the owner and active partners may use the API. Any other
      // signed-in account (for example one left behind by a failed invitation accept) is refused.
      if (allowsUnlistedUsers()) return next();
      let owner = false;
      try {
        owner = await service.isOwner(userId);
      } catch {
        res.set("Cache-Control", "no-store");
        return void res.status(503).json({ error: "No se pudo verificar el acceso. Intenta de nuevo.", reason: "workspace_access_unavailable" });
      }
      if (owner) return next();
      if (req.method === "GET" && resolveRequestApiPath(req).split("?")[0].toLowerCase() === "/api/workspace/me") return next();
      return json403(res, "Esta cuenta no tiene acceso a este espacio de trabajo.", "workspace_member_only");
    }

    const apiPath = resolveRequestApiPath(req);
    const decision = classifyPartnerRequest(req.method, apiPath, req.body);
    if (decision.kind === "redact") {
      res.set("Cache-Control", "no-store");
      return void res.json(partnerRedactedBody(apiPath.split("?")[0]));
    }
    if (decision.kind === "deny") {
      return json403(res, `${PARTNER_SCOPE_NOTE}. Como socio puedes ver la oficina y trabajar con el equipo de Black Room.`, "partner_scope");
    }
    (res.locals as WorkspaceLocals).workspaceActor = { userId, role: "partner" };
    (res.locals as WorkspaceLocals).workspaceOwnerUserId = resolution.ownerUserId;
    if (decision.actAsOwner) {
      // Read-only Black Room views (radio slots): the handler reads the workspace owner's data.
      (req as Request & { user?: { id: string } }).user = { id: resolution.ownerUserId };
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export type WorkspaceAccessRouteOptions = {
  access?: WorkspaceAccess;
  /** Local-auth hooks; defaults to server/local-auth.ts (same hashing, cookie and session). */
  auth?: {
    enabled: () => boolean;
    hasSession: (req: Request) => boolean;
    createUser: (username: string, password: string) => Promise<{ ok: true; user: { id: string; username: string } } | { ok: false; reason: "username_taken" }>;
    signIn: (req: Request, res: Response, userId: string) => Promise<boolean>;
    guards: RequestHandler[];
  };
  isReservedUsername?: (username: string) => boolean;
};

const ACCEPT_USERNAME = /^[a-z0-9][a-z0-9._-]{1,79}$/;

export async function registerWorkspaceAccessRoutes(app: Express, options: WorkspaceAccessRouteOptions = {}): Promise<void> {
  const access = () => options.access ?? getWorkspaceAccess();
  const localAuth = options.auth ? null : await import("./local-auth");
  const auth = options.auth ?? {
    enabled: localAuth!.isLocalAuthEnabled,
    hasSession: localAuth!.hasLocalAuthSession,
    createUser: localAuth!.createLocalAuthUser,
    signIn: localAuth!.signInLocalAuthUser,
    guards: [localAuth!.requireSameOriginAuthRequest, localAuth!.requireJsonAuthRequest, localAuth!.localAuthRateLimit],
  };
  const isReserved = options.isReservedUsername ?? (await import("./single-user-owner")).isReservedOwnerUsername;
  const ownerOnly = requireOwner(options.access);
  const noStore: RequestHandler = (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); };
  const fail = (res: Response, error: unknown) => {
    if (error instanceof WorkspaceAccessError) {
      const status = error.code === "not_found" ? 404 : error.code === "too_many_invitations" ? 429 : 410;
      return res.status(status).json({ error: error.message, reason: error.code });
    }
    res.status(500).json({ error: "No se pudo completar la operacion." });
  };

  app.get("/api/workspace/me", noStore, async (req, res) => {
    const userId = resolveCurrentUserId(req);
    if (!userId) return res.status(401).json({ error: "Inicia sesion." });
    try {
      const resolution = await access().resolve(userId);
      res.json({
        role: resolution.role,
        revoked: resolution.revoked,
        canManagePartners: resolution.role === "owner",
        blackRoomScope: resolution.role === "partner" ? [...BLACKROOM_SCOPE_AGENT_IDS] : null,
      });
    } catch {
      res.status(503).json({ error: "No se pudo verificar el acceso." });
    }
  });

  app.post("/api/workspace/invitations", noStore, ownerOnly, async (req, res) => {
    try {
      const ownerUserId = getRequestWorkspaceActor(res)!.userId;
      const { token, invitation } = await access().createInvitation(ownerUserId);
      // Relative link: the client prefixes its own origin. The raw token is returned only here, once.
      res.status(201).json({ invitation, link: workspaceInviteLink(token) });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/workspace/invitations", noStore, ownerOnly, async (_req, res) => {
    try { res.json({ invitations: await access().listInvitations() }); } catch (error) { fail(res, error); }
  });

  app.delete("/api/workspace/invitations/:id", noStore, ownerOnly, async (req, res) => {
    try { res.json({ invitation: await access().revokeInvitation(String(req.params.id)) }); } catch (error) { fail(res, error); }
  });

  app.get("/api/workspace/partners", noStore, ownerOnly, async (_req, res) => {
    try { res.json({ partners: await access().listPartners() }); } catch (error) { fail(res, error); }
  });

  app.delete("/api/workspace/partners/:userId", noStore, ownerOnly, async (req, res) => {
    try { res.json({ partner: await access().revokePartner(String(req.params.userId), getRequestWorkspaceActor(res)!.userId) }); } catch (error) { fail(res, error); }
  });

  // Public (no session yet). The token travels in the JSON body, never in a logged URL.
  app.post("/api/workspace/invitations/preview", noStore, ...auth.guards, async (req, res) => {
    try { res.json(await access().previewInvitation(req.body?.token)); } catch (error) { fail(res, error); }
  });

  app.post("/api/workspace/invitations/accept", noStore, ...auth.guards, async (req, res) => {
    if (!auth.enabled()) return res.status(403).json({ error: "El acceso con usuario y contrasena esta desactivado." });
    if (!auth.hasSession(req)) return res.status(500).json({ error: "Session middleware is not configured" });
    const token = req.body?.token;
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!isWellFormedInvitationToken(token)) return res.status(400).json({ error: "El enlace de invitacion no es valido.", reason: "invalid_token" });
    if (!ACCEPT_USERNAME.test(username)) return res.status(400).json({ error: "El usuario debe tener entre 2 y 80 caracteres: letras, numeros, punto, guion o guion bajo." });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "La contrasena debe tener entre 8 y 200 caracteres." });
    if (isReserved(username)) return res.status(409).json({ error: "Ese usuario no esta disponible." });

    let invitation: WorkspaceInvitation;
    try {
      invitation = await access().claimInvitation(token);
    } catch (error) { return fail(res, error); }

    let created: Awaited<ReturnType<typeof auth.createUser>>;
    try {
      created = await auth.createUser(username, password);
    } catch {
      await access().releaseInvitationClaim(invitation.id).catch(() => undefined);
      return res.status(500).json({ error: "No se pudo crear la cuenta." });
    }
    if (!created.ok) {
      await access().releaseInvitationClaim(invitation.id).catch(() => undefined);
      return res.status(409).json({ error: "Ese usuario ya existe. Elige otro." });
    }
    let partner: Awaited<ReturnType<WorkspaceAccess["completeInvitation"]>>;
    try {
      partner = await access().completeInvitation(invitation.id, created.user);
    } catch {
      // The account exists but is not a recorded partner. Quarantine it (revoked partner record) so it
      // can never sign in as an unlisted user; enforceWorkspaceAccess also denies unlisted users.
      await access().quarantineOrphanedAccount(invitation.id, created.user).catch(() => undefined);
      return res.status(503).json({ error: "No se pudo completar la invitacion. Pide a Robert un enlace nuevo.", reason: "invitation_not_completed" });
    }
    try {
      if (!await auth.signIn(req, res, created.user.id)) return res.status(500).json({ error: "La cuenta se creo, pero no se pudo iniciar sesion. Entra con tu usuario." });
      res.status(201).json({ authenticated: true, sessionBacked: true, usingDevFallback: false, user: { id: created.user.id, username: created.user.username }, role: "partner", partner });
    } catch (error) { fail(res, error); }
  });
}

/** True only for an active (not revoked) partner. Reads the access store, never the owner rule. */
export async function isActiveWorkspacePartner(userId: string, access: WorkspaceAccess = getWorkspaceAccess()): Promise<boolean> {
  return (await access.resolve(userId, { skipOwnerCheck: true })).role === "partner";
}
