import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  WORKSPACE_INVITATION_TTL_MS,
  classifyPartnerRequest,
  invitationStatus,
  isBlackRoomOnlyOrder,
  isPartnerRedactedBody,
  partnerRedactedBody,
  partnerRedactedPaths,
  redactCouncilViewForPartner,
} from "../shared/workspace-access";
import { agentProbes, summarizeProbe } from "../shared/agent-live-status";
import {
  createMemoryWorkspaceAccessStore,
  createWorkspaceAccess,
  enforceWorkspaceAccess,
  generateInvitationToken,
  getRequestWorkspaceActor,
  hashInvitationToken,
  isActiveWorkspacePartner,
  registerWorkspaceAccessRoutes,
  requireOwner,
  requirePartnerOrOwner,
  resolveOwnerOrPartner,
  type WorkspaceAccess,
} from "../server/workspace-access";
import { getCurrentUserId } from "../server/user-context";
import { registerBlackRoomTeamRoutes } from "../server/blackroom-team-routes";
import { registerAgentCouncilRoutes } from "../server/agent-council-routes";
import { createAgentCouncil } from "../server/agent-council";
import { emptyCouncilState } from "../shared/agent-council";
import { BLACKROOM_TEAM_IDS, type BlackRoomTeamAgentModule, type BlackRoomTeamContext } from "../shared/blackroom-team";
import type { BlackRoomTeamAuditEntry } from "../server/blackroom-team/audit";

const START = Date.parse("2026-11-12T12:00:00Z");

function setup(options: { owners?: string[] } = {}) {
  let now = START;
  const store = createMemoryWorkspaceAccessStore();
  const owners = new Set(options.owners ?? ["robert"]);
  const access = createWorkspaceAccess({ store, now: () => now, isOwner: async (id) => owners.has(id), cacheMs: 0 });
  return { access, store, owners, tick: (ms: number) => { now += ms; }, now: () => now };
}

async function addPartner(access: WorkspaceAccess, userId = "socio-1", username = "socio") {
  const { token } = await access.createInvitation("robert");
  const invitation = await access.claimInvitation(token);
  await access.completeInvitation(invitation.id, { id: userId, username });
  return token;
}

async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** Test identity: the x-test-user header becomes req.user (what getCurrentUserId reads first). */
function fakeAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const user = req.header("x-test-user");
  if (user) (req as express.Request & { user?: { id: string } }).user = { id: user };
  next();
}

// ---------------------------------------------------------------------------
// Tokens, expiry, single use
// ---------------------------------------------------------------------------

test("invitation tokens are 32 random bytes in base64url and are stored only as sha256 hashes", async () => {
  const a = generateInvitationToken();
  const b = generateInvitationToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, "base64url").length, 32);
  assert.match(hashInvitationToken(a), /^[a-f0-9]{64}$/);
  assert.equal(hashInvitationToken(a), hashInvitationToken(a));

  const { access, store } = setup();
  const { token, invitation } = await access.createInvitation("robert");
  assert.equal(invitation.status, "open");
  assert.equal(Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt), WORKSPACE_INVITATION_TTL_MS);
  const raw = store.raw() || "";
  assert.equal(raw.includes(token), false, "raw token never persisted");
  assert.equal(raw.includes(hashInvitationToken(token)), true);
  const listed = JSON.stringify(await access.listInvitations());
  assert.equal(listed.includes(hashInvitationToken(token)), false, "list views never expose the hash");
  assert.equal(listed.includes(token), false);
});

test("invitations expire after 7 days, are single-use, and revoked ones cannot be used", async () => {
  const { access, tick } = setup();
  const { token } = await access.createInvitation("robert");
  assert.equal((await access.previewInvitation(token)).status, "open");
  assert.equal((await access.previewInvitation("x".repeat(43))).status, "invalid");
  assert.equal((await access.previewInvitation("bad token")).status, "invalid");

  // Single use: a second claim while the first is in flight fails; releasing re-opens it.
  const claim = await access.claimInvitation(token);
  await assert.rejects(access.claimInvitation(token), /ya se uso|vencio|revocada/);
  await access.releaseInvitationClaim(claim.id);
  const again = await access.claimInvitation(token);
  await access.completeInvitation(again.id, { id: "socio-1", username: "socio" });
  await assert.rejects(access.claimInvitation(token), /ya se uso|vencio|revocada/);
  assert.equal((await access.previewInvitation(token)).status, "unavailable");

  // Expiry.
  const second = await access.createInvitation("robert");
  tick(WORKSPACE_INVITATION_TTL_MS - 1);
  assert.equal((await access.previewInvitation(second.token)).status, "open");
  tick(2);
  assert.equal((await access.previewInvitation(second.token)).status, "unavailable");
  await assert.rejects(access.claimInvitation(second.token), /vencio/);

  // Revocation.
  const third = await access.createInvitation("robert");
  await access.revokeInvitation(third.invitation.id);
  await assert.rejects(access.claimInvitation(third.token), /revocada/);
  assert.equal((await access.listInvitations()).find((item) => item.id === third.invitation.id)?.status, "revoked");
});

test("a crashed accept frees its claim after two minutes", () => {
  const base = { id: "i", tokenHash: "a".repeat(64), createdBy: "robert", createdAt: new Date(START).toISOString(), expiresAt: new Date(START + WORKSPACE_INVITATION_TTL_MS).toISOString(), claimedAt: new Date(START).toISOString() };
  assert.equal(invitationStatus(base, START + 60_000), "claimed");
  assert.equal(invitationStatus(base, START + 3 * 60_000), "open");
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

test("role resolution: owner, partner (takes precedence), revoked partner, other users", async () => {
  const { access, owners } = setup();
  assert.equal(await access.getWorkspaceRole("robert"), "owner");
  assert.equal(await access.getWorkspaceRole("someone"), null);
  await addPartner(access, "socio-1");
  assert.equal(await access.getWorkspaceRole("socio-1"), "partner");
  assert.deepEqual(await resolveOwnerOrPartner("socio-1", access), { actor: { userId: "socio-1", role: "partner" }, contextUserId: "robert" });
  assert.deepEqual(await resolveOwnerOrPartner("robert", access), { actor: { userId: "robert", role: "owner" }, contextUserId: "robert" });
  assert.equal(await resolveOwnerOrPartner("someone", access), null);
  assert.equal(await resolveOwnerOrPartner(null, access), null);
  // Even if the owner rule matched the invited account, the partner record wins.
  owners.add("socio-1");
  assert.equal(await access.getWorkspaceRole("socio-1"), "partner");
  assert.equal(await isActiveWorkspacePartner("socio-1", access), true);

  await access.revokePartner("socio-1", "robert");
  const resolution = await access.resolve("socio-1");
  assert.equal(resolution.role, null);
  assert.equal(resolution.revoked, true);
  assert.equal(await resolveOwnerOrPartner("socio-1", access), null);
  assert.equal(await isActiveWorkspacePartner("socio-1", access), false);
  assert.equal((await access.listPartners())[0].active, false);
});

// ---------------------------------------------------------------------------
// Route policy
// ---------------------------------------------------------------------------

test("partner route policy: Black Room allowed, KONG/finance/settings/owner routes denied", () => {
  const allow = (method: string, path: string, body?: unknown) => assert.equal(classifyPartnerRequest(method, path, body).kind, "allow", `${method} ${path}`);
  const deny = (method: string, path: string, body?: unknown) => assert.equal(classifyPartnerRequest(method, path, body).kind, "deny", `${method} ${path}`);
  const redact = (path: string) => assert.equal(classifyPartnerRequest("GET", path).kind, "redact", path);

  allow("GET", "/api/workspace/me");
  allow("GET", "/api/blackroom-team");
  for (const id of BLACKROOM_TEAM_IDS) {
    allow("GET", `/api/blackroom-team/${id}/status`);
    allow("POST", `/api/blackroom-team/${id}/run`);
  }
  allow("POST", "/api/blackroom-team/blackroom-publisher/action/approve");
  allow("POST", "/api/blackroom-team/blackroom-publisher/action/reject");
  allow("GET", "/api/agent-council/state");
  allow("POST", "/api/agent-company/orders", { company: "blackroom", text: "x" });
  allow("POST", "/api/agent-company/orders/ord-1/done", { company: "blackroom" });
  allow("GET", "/api/blackroom-agent");
  allow("POST", "/api/blackroom-agent/chat");
  assert.deepEqual(classifyPartnerRequest("GET", "/api/radio/slots"), { kind: "allow", actAsOwner: true });
  allow("GET", "/api/blackroom-team?x=1");

  // CEO orders outside Black Room, council runs.
  deny("POST", "/api/agent-company/orders", { company: "main", text: "x" });
  deny("POST", "/api/agent-company/orders", { text: "x" });
  deny("POST", "/api/agent-company/orders", { company: "kong", text: "x" });
  deny("POST", "/api/agent-company/orders/ord-1/done", { company: "main" });
  deny("POST", "/api/agent-council/run");
  // KONG.
  deny("GET", "/api/agents-office/kong-snapshot");
  deny("GET", "/api/kong-supervisor/state");
  deny("POST", "/api/kong-ops/cards");
  deny("POST", "/api/kong-supervisor/chat");
  // Finance / revenue / portfolio.
  deny("GET", "/api/investments");
  deny("POST", "/api/investments");
  deny("GET", "/api/revenue-engine/state");
  deny("POST", "/api/stripe/checkout");
  deny("GET", "/api/transactions");
  // Settings, secrets, integrations, deploys, code agents, Telegram, calendar data.
  deny("GET", "/api/settings");
  deny("POST", "/api/telegram/config");
  deny("GET", "/api/tasks");
  deny("GET", "/api/calendar/events");
  deny("POST", "/api/github/dispatch");
  deny("POST", "/api/code-agent/run");
  deny("POST", "/api/deploy");
  deny("GET", "/api/google-drive/oauth/start");
  // Owner-only Black Room controls and workspace management.
  deny("POST", "/api/blackroom-agent/start");
  deny("POST", "/api/blackroom-agent/pause");
  deny("POST", "/api/blackroom-agent/work-now");
  deny("POST", "/api/blackroom-agent/analytics/refresh");
  deny("POST", "/api/workspace/invitations");
  deny("GET", "/api/workspace/invitations");
  deny("GET", "/api/workspace/partners");
  deny("DELETE", "/api/workspace/partners/socio-1");
  deny("POST", "/api/agents-office/contact-action", { action: "radio_analysis" });
  // Writes to allowed read paths and path tricks.
  deny("DELETE", "/api/blackroom-team");
  deny("POST", "/api/agent-council/state");
  deny("POST", "/api/radio/slots");
  deny("GET", "/API/blackroom-team");
  deny("GET", "/api/blackroom-team/../kong-ops/state");
  deny("POST", "/api/blackroom-team/blackroom-publisher/action/APPROVE");
  deny("GET", "/api/radio/analysis");

  // Read-only office probes of other agents are redacted, never opened.
  redact("/api/calendar/status");
  redact("/api/stripe/revenue-readiness");
  redact("/api/portfolio/summary");
  redact("/api/kong-ops/state");
  redact("/api/github/status");
  redact("/api/projects");
  redact("/api/agents-office/cities");
  redact("/api/automation-runs");
  assert.equal(classifyPartnerRequest("HEAD", "/api/portfolio/summary").kind, "redact");
  // Every office probe is either Black Room (allowed) or redacted.
  for (const probe of Object.values(agentProbes)) {
    const kind = classifyPartnerRequest("GET", probe.url).kind;
    assert.ok(kind === "allow" || kind === "redact", `${probe.url} -> ${kind}`);
  }
  assert.equal(partnerRedactedPaths().includes("/api/blackroom-agent"), false);
});

// ---------------------------------------------------------------------------
// Middleware end to end
// ---------------------------------------------------------------------------

test("middleware: partner reaches only the allowlist, gets redacted probes, and revocation is immediate", async (t) => {
  const { access } = setup();
  await addPartner(access, "socio-1");
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use(enforceWorkspaceAccess(access));
  let ownerDataRead = 0;
  app.get("/api/blackroom-team", (_req, res) => res.json({ ok: true, actor: getRequestWorkspaceActor(res) }));
  app.get("/api/portfolio/summary", (_req, res) => { ownerDataRead++; res.json({ totalValue: 123456 }); });
  app.get("/api/investments", (_req, res) => { ownerDataRead++; res.json([{ symbol: "PRIVATE" }]); });
  app.get("/api/radio/slots", (req, res) => res.json({ readAs: getCurrentUserId(req) }));
  app.post("/api/agent-company/orders", (req, res) => res.json({ company: req.body.company }));
  app.get("/api/workspace/me", (_req, res) => res.json({ reached: true }));
  const server = await listen(app);
  t.after(server.close);
  const call = (path: string, user: string, body?: unknown) => fetch(server.base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-test-user": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  const team = await call("/api/blackroom-team", "socio-1");
  assert.equal(team.status, 200);
  assert.deepEqual((await team.json()).actor, { userId: "socio-1", role: "partner" });

  const redacted = await call("/api/portfolio/summary", "socio-1");
  assert.equal(redacted.status, 200);
  const redactedBody = await redacted.json();
  assert.equal(isPartnerRedactedBody(redactedBody), true);
  assert.equal(JSON.stringify(redactedBody).includes("123456"), false);
  assert.equal(ownerDataRead, 0, "redacted probe never runs the owner handler");

  // Express matches routes case-insensitively; the gate must not be bypassed by casing or encoding.
  assert.equal((await call("/API/investments", "socio-1")).status, 403);
  assert.equal((await call("/Api/Portfolio/Summary", "socio-1")).status, 403);
  assert.equal((await call("/%61pi/investments", "socio-1")).status === 200, false);
  assert.equal(ownerDataRead, 0);
  const denied = await call("/api/investments", "socio-1");
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).reason, "partner_scope");
  assert.equal(ownerDataRead, 0);
  assert.equal((await call("/api/agent-company/orders", "socio-1", { company: "main", text: "x" })).status, 403);
  assert.equal((await (await call("/api/agent-company/orders", "socio-1", { company: "blackroom", text: "x" })).json()).company, "blackroom");
  assert.equal((await (await call("/api/radio/slots", "socio-1")).json()).readAs, "robert", "radio is read as the workspace owner");

  // The owner is not touched by the partner gate; unlisted accounts are refused (single-owner workspace).
  assert.equal((await call("/api/investments", "robert")).status, 200);
  assert.deepEqual((await (await call("/api/blackroom-team", "robert")).json()).actor, undefined);
  const unlisted = await call("/api/investments", "other-user");
  assert.equal(unlisted.status, 403);
  assert.equal((await unlisted.json()).reason, "workspace_member_only");
  assert.equal((await call("/api/workspace/me", "other-user")).status, 200, "the role endpoint stays readable");
  assert.equal(ownerDataRead, 1);

  // Revocation kills access on the very next request (only the role endpoint answers).
  await access.revokePartner("socio-1", "robert");
  const revoked = await call("/api/blackroom-team", "socio-1");
  assert.equal(revoked.status, 403);
  assert.equal((await revoked.json()).reason, "partner_revoked");
  assert.equal((await call("/api/portfolio/summary", "socio-1")).status, 403);
  assert.equal((await call("/api/workspace/me", "socio-1")).status, 200);
});

test("middleware fails closed for non-owners when the access store cannot be read", async (t) => {
  const access = createWorkspaceAccess({ store: { read: async () => { throw new Error("db down"); }, write: async () => 1 }, now: () => START, isOwner: async (id) => id === "robert", cacheMs: 0 });
  const app = express();
  app.use(fakeAuth);
  app.use(enforceWorkspaceAccess(access));
  app.get("/api/x", (_req, res) => res.json({ ok: true }));
  const server = await listen(app);
  t.after(server.close);
  const call = (user: string) => fetch(`${server.base}/api/x`, { headers: { "x-test-user": user } });
  assert.equal((await call("someone")).status, 503);
  // The owner keeps working through the owner rule alone.
  assert.equal((await call("robert")).status, 200);
});

test("requireOwner and requirePartnerOrOwner guards", async (t) => {
  const { access } = setup();
  await addPartner(access, "socio-1");
  const app = express();
  app.use(fakeAuth);
  app.get("/owner", requireOwner(access), (_req, res) => res.json(getRequestWorkspaceActor(res)));
  app.get("/blackroom", requirePartnerOrOwner(access), (_req, res) => res.json(getRequestWorkspaceActor(res)));
  const server = await listen(app);
  t.after(server.close);
  const call = (path: string, user?: string) => fetch(server.base + path, { headers: user ? { "x-test-user": user } : {} });
  assert.equal((await call("/owner")).status, 401);
  assert.equal((await call("/owner", "socio-1")).status, 403);
  assert.equal((await call("/owner", "someone")).status, 403);
  assert.deepEqual(await (await call("/owner", "robert")).json(), { userId: "robert", role: "owner" });
  assert.deepEqual(await (await call("/blackroom", "socio-1")).json(), { userId: "socio-1", role: "partner" });
  assert.equal((await call("/blackroom", "someone")).status, 403);
  await access.revokePartner("socio-1", "robert");
  assert.equal((await call("/blackroom", "socio-1")).status, 403);
});

// ---------------------------------------------------------------------------
// Invitation routes (owner-only management, public accept through local auth)
// ---------------------------------------------------------------------------

test("invitation routes: owner creates/lists/revokes, invitee accepts once with a local account", async (t) => {
  const { access } = setup();
  const users = new Map<string, { id: string; username: string; password: string }>();
  const signedIn: string[] = [];
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use(enforceWorkspaceAccess(access));
  await registerWorkspaceAccessRoutes(app, {
    access,
    isReservedUsername: (name) => name === "robert",
    auth: {
      enabled: () => true,
      hasSession: () => true,
      guards: [],
      createUser: async (username, password) => {
        if (users.has(username)) return { ok: false, reason: "username_taken" };
        const user = { id: `u-${users.size + 1}`, username, password: `scrypt$${password.length}` };
        users.set(username, user);
        return { ok: true, user };
      },
      signIn: async (_req, res, userId) => { signedIn.push(userId); res.cookie("blackops.uid", `signed-${userId}`); return true; },
    },
  });
  const server = await listen(app);
  t.after(server.close);
  const call = (method: string, path: string, user?: string, body?: unknown) => fetch(server.base + path, { method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  assert.equal((await call("POST", "/api/workspace/invitations", "someone")).status, 403);
  const created = await call("POST", "/api/workspace/invitations", "robert");
  assert.equal(created.status, 201);
  const { link, invitation } = await created.json();
  assert.match(link, /^\/invite\/[A-Za-z0-9_-]{43}$/);
  const token = link.slice("/invite/".length);
  assert.equal(invitation.status, "open");
  assert.equal(JSON.stringify(await (await call("GET", "/api/workspace/invitations", "robert")).json()).includes(token), false);

  assert.equal((await (await call("POST", "/api/workspace/invitations/preview", undefined, { token })).json()).status, "open");
  assert.equal((await call("POST", "/api/workspace/invitations/accept", undefined, { token, username: "robert", password: "longenough" })).status, 409, "owner usernames are reserved");
  assert.equal((await call("POST", "/api/workspace/invitations/accept", undefined, { token, username: "socio", password: "short" })).status, 400);
  assert.equal((await call("POST", "/api/workspace/invitations/accept", undefined, { token: "nope", username: "socio", password: "longenough" })).status, 400);
  const accepted = await call("POST", "/api/workspace/invitations/accept", undefined, { token, username: "Socio", password: "longenough" });
  assert.equal(accepted.status, 201);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.role, "partner");
  assert.equal(acceptedBody.user.username, "socio");
  assert.match(accepted.headers.get("set-cookie") || "", /blackops\.uid=signed-u-1/);
  assert.deepEqual(signedIn, ["u-1"]);
  assert.equal(await access.getWorkspaceRole("u-1"), "partner");

  // Single use.
  const reused = await call("POST", "/api/workspace/invitations/accept", undefined, { token, username: "otro", password: "longenough" });
  assert.equal(reused.status, 410);
  assert.equal(users.has("otro"), false);

  // A taken username releases the claim so the link still works.
  const second = await (await call("POST", "/api/workspace/invitations", "robert")).json();
  const secondToken = second.link.slice("/invite/".length);
  assert.equal((await call("POST", "/api/workspace/invitations/accept", undefined, { token: secondToken, username: "socio", password: "longenough" })).status, 409);
  assert.equal((await (await call("POST", "/api/workspace/invitations/preview", undefined, { token: secondToken })).json()).status, "open");

  // The partner cannot manage the workspace; the owner lists and revokes.
  assert.equal((await call("POST", "/api/workspace/invitations", "u-1")).status, 403);
  assert.equal((await call("GET", "/api/workspace/partners", "u-1")).status, 403);
  const me = await (await call("GET", "/api/workspace/me", "u-1")).json();
  assert.equal(me.role, "partner");
  assert.equal(me.canManagePartners, false);
  assert.equal((await (await call("GET", "/api/workspace/me", "robert")).json()).canManagePartners, true);
  const partners = (await (await call("GET", "/api/workspace/partners", "robert")).json()).partners;
  assert.deepEqual(partners.map((p: { username: string; active: boolean }) => [p.username, p.active]), [["socio", true]]);
  assert.equal((await call("DELETE", `/api/workspace/invitations/${second.invitation.id}`, "robert")).status, 200);
  assert.equal((await call("POST", "/api/workspace/invitations/accept", undefined, { token: secondToken, username: "nuevo", password: "longenough" })).status, 410);
  assert.equal((await call("DELETE", "/api/workspace/partners/u-1", "robert")).status, 200);
  assert.equal((await call("GET", "/api/workspace/me", "u-1")).status, 200);
  assert.equal((await (await call("GET", "/api/workspace/me", "u-1")).json()).revoked, true);
});

// ---------------------------------------------------------------------------
// Black Room team routes: partner runs actions, actor recorded
// ---------------------------------------------------------------------------

test("Black Room team routes: partner can approve in the publisher; actor reaches the context and the audit", async (t) => {
  const { access } = setup();
  await addPartner(access, "socio-1");
  const seen: Array<{ actor: BlackRoomTeamContext["actor"]; userId: string | null }> = [];
  const audit: BlackRoomTeamAuditEntry[] = [];
  const base = (id: (typeof BLACKROOM_TEAM_IDS)[number]): BlackRoomTeamAgentModule => ({
    id,
    getStatus: async (ctx) => ({ id, state: "available", label: "Listo", summary: "", needs: [], lastRunAt: null, metrics: { owner: String(ctx.userId) } }),
    run: async (ctx) => { seen.push({ actor: ctx.actor, userId: ctx.userId }); return { ok: true, summary: "corrido" }; },
    actions: { approve: async (ctx, input) => { seen.push({ actor: ctx.actor, userId: ctx.userId }); return { ok: true, summary: `aprobado ${String(input.id)}` }; } },
  });
  const modules = Object.fromEntries(BLACKROOM_TEAM_IDS.map((id) => [id, base(id)])) as never;
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use(enforceWorkspaceAccess(access));
  registerBlackRoomTeamRoutes(app, {
    requestUserId: (req) => req.header("x-test-user") || null,
    resolveActor: (userId) => resolveOwnerOrPartner(userId, access),
    modules,
    context: { readLegacyMember: async () => null, dataDir: "/nonexistent-not-used" },
    audit: async (entry) => { audit.push(entry); },
  });
  const server = await listen(app);
  t.after(server.close);
  const call = (method: string, path: string, user: string, body?: unknown) => fetch(server.base + path, { method, headers: { "content-type": "application/json", "x-test-user": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  const statuses = await (await call("GET", "/api/blackroom-team", "socio-1")).json();
  assert.equal(statuses.role, "partner");
  assert.equal(statuses.agents[0].metrics.owner, "robert", "partners work on the owner's Black Room data");
  const approved = await call("POST", "/api/blackroom-team/blackroom-publisher/action/approve", "socio-1", { id: "post-1" });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).summary, "aprobado post-1");
  assert.deepEqual(seen.at(-1), { actor: { userId: "socio-1", role: "partner" }, userId: "robert" });
  assert.equal(audit.length, 1);
  assert.deepEqual({ ...audit[0], at: "x" }, { at: "x", agentId: "blackroom-publisher", operation: "approve", actor: { userId: "socio-1", role: "partner" }, ok: true, targetId: "post-1", summary: "aprobado post-1" });

  assert.equal((await call("POST", "/api/blackroom-team/blackroom-ceo/run", "robert", {})).status, 200);
  assert.deepEqual(audit.at(-1)?.actor, { userId: "robert", role: "owner" });
  assert.equal((await call("POST", "/api/blackroom-team/blackroom-ceo/run", "someone", {})).status, 403);

  await access.revokePartner("socio-1", "robert");
  assert.equal((await call("POST", "/api/blackroom-team/blackroom-publisher/action/approve", "socio-1", { id: "post-1" })).status, 403);
  assert.equal(audit.length, 2);
});

test("the real publisher records who approved or rejected", async () => {
  const { default: publisher } = await import("../server/blackroom-team/blackroom-publisher");
  const now = new Date("2026-11-12T12:00:00Z");
  let saved: any = {
    version: 1,
    lastRunAt: null,
    lastRunSummary: null,
    items: [
      { id: "p1", agentId: "blackroom-publisher", kind: "metricool-post", title: "t", summary: "s", payload: { publicationDateTime: "2026-11-20T18:00:00", timezone: "America/New_York", networks: ["instagram"], caption: "c", channel: "metricool", media: [] }, createdAt: now.toISOString(), status: "pending", decidedAt: null, dryRun: true, dispatch: { state: "none", attempts: 0, updatedAt: null, lastError: null, receipt: null, partialReceipts: {}, dryRunPreview: null } },
      { id: "p2", agentId: "blackroom-publisher", kind: "metricool-post", title: "t", summary: "s", payload: { publicationDateTime: "2026-11-20T18:00:00", timezone: "America/New_York", networks: ["instagram"], caption: "c", channel: "metricool", media: [] }, createdAt: now.toISOString(), status: "pending", decidedAt: null, dryRun: true, dispatch: { state: "none", attempts: 0, updatedAt: null, lastError: null, receipt: null, partialReceipts: {}, dryRunPreview: null } },
    ],
  };
  const ctx = {
    agentId: "blackroom-publisher", env: {}, now: () => now, fetch: (async () => { throw new Error("no network"); }) as unknown as typeof fetch, dataDir: "/unused", userId: "robert",
    actor: { userId: "socio-1", role: "partner" as const },
    state: { load: async <T,>(fallback: T) => (saved ?? fallback) as T, save: async <T,>(value: T) => { saved = JSON.parse(JSON.stringify(value)); } },
    readTeammateStatus: async () => null,
  } satisfies BlackRoomTeamContext;
  const approve = await publisher.actions!.approve(ctx, { id: "p1" });
  assert.equal(approve.ok, true, approve.summary);
  assert.deepEqual(saved.items[0].decidedBy, { userId: "socio-1", role: "partner" });
  const reject = await publisher.actions!.reject({ ...ctx, actor: { userId: "robert", role: "owner" } }, { id: "p2" });
  assert.equal(reject.ok, true, reject.summary);
  assert.deepEqual(saved.items[1].decidedBy, { userId: "robert", role: "owner" });
});

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

test("redaction: council view for partners hides Robert's orders, memories and other agents' details", () => {
  const view = {
    company: {
      careers: {
        portfolio: { agentId: "portfolio", memory: [{ at: "t", text: "Orden del CEO: vender acciones privadas" }], reviewGuidance: ["secreto"] },
        "blackroom-publisher": { agentId: "blackroom-publisher", memory: [{ at: "t", text: "Orden del CEO: postear Black Room" }] },
      },
      orders: [
        { id: "o1", text: "Mover dinero de Stripe", assignees: [{ agentId: "revenue" }] },
        { id: "o2", text: "Postear el video de Black Room", assignees: [{ agentId: "blackroom-publisher" }, { agentId: "blackroom-ceo" }] },
        { id: "o3", text: "Mixta", assignees: [{ agentId: "radio" }, { agentId: "code" }] },
      ],
      events: [{ at: "t", text: "Robert pidio algo privado" }],
      trainees: [{ forAgentId: "portfolio" }, { forAgentId: "blackroom-scripts" }],
      retiredCareers: [
        { agentId: "revenue", memory: [{ at: "t", text: 'Orden del CEO: "cobrar factura privada"' }, { at: "t", text: "Paso a ocupado: Ingresos 98k" }], reviewGuidance: ["guia privada"] },
        { agentId: "radio", memory: [{ at: "t", text: "Radio despedida por bateria" }] },
      ],
    },
    lastCycleError: "kong-ops: token invalido para la cuenta privada",
    debates: [{ subject: "revenue", claim: "privado" }, { subject: "blackroom-ceo", claim: "ok" }],
    proposals: [{ owner: "code", title: "privado" }],
    lessons: [],
    lastStatuses: { portfolio: { state: "working", label: "Portafolio 1.2M" }, radio: { state: "available", label: "Radio lista" } },
    overrides: { portfolio: { label: "x", detail: "privado" } },
    kongSupervision: { reviews: [{ text: "KONG privado" }] },
    costUsd: 3.2,
  };
  const out = redactCouncilViewForPartner(view) as any;
  const text = JSON.stringify(out);
  for (const secret of ["vender acciones", "Mover dinero", "Robert pidio", "1.2M", "KONG privado", "secreto", "Mixta", "cobrar factura", "Ingresos 98k", "guia privada", "cuenta privada"]) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(out.company.orders.map((o: { id: string }) => o.id), ["o2"]);
  assert.equal(out.company.careers["blackroom-publisher"].memory.length, 1);
  assert.equal(out.company.careers.portfolio.memory.length, 0);
  assert.equal(out.company.retiredCareers.length, 2);
  assert.equal(out.company.retiredCareers[0].memory.length, 0, "retired non-Black-Room memory is stripped");
  assert.equal(out.company.retiredCareers[1].memory.length, 1, "retired Black Room memory stays");
  assert.equal(typeof out.lastCycleError, "string");
  assert.deepEqual(out.lastStatuses.portfolio, { state: "working", label: "Solo Robert" });
  assert.deepEqual(out.lastStatuses.radio, view.lastStatuses.radio);
  assert.deepEqual(out.debates, [{ subject: "blackroom-ceo", claim: "ok" }]);
  assert.equal(out.costUsd, 0);
  assert.equal(isBlackRoomOnlyOrder({ assignees: [] }), false);
});

test("redaction: the office shows a redacted probe as 'Solo Robert', exempt from penalties", () => {
  const body = partnerRedactedBody("/api/portfolio/summary");
  assert.equal(isPartnerRedactedBody(body), true);
  const status = summarizeProbe(agentProbes.portfolio, { ok: true, status: 200, body });
  assert.equal(status.state, "offline");
  assert.equal(status.label, "Solo Robert");
  assert.equal(status.lifePenaltyExempt, true);
  assert.equal(status.activity, undefined);
});

test("council routes: partner sees a redacted office, orders only the Black Room CEO and records who ordered", async (t) => {
  const state = emptyCouncilState();
  state.company.orders.push({ id: "private", text: "Revisar el portafolio privado", createdAt: new Date().toISOString(), assignees: [{ agentId: "portfolio", status: "en_curso", note: "" }] });
  let raw = JSON.stringify(state);
  const council = createAgentCouncil({ now: () => Date.now(), userId: () => "robert", readState: async () => raw, writeState: async (value) => { raw = value; }, collect: async () => ({}), submitProposal: async () => "fixture", getPendingActionStatus: async () => null, fetchLatestRelease: async () => null, log: () => {} });
  const app = express();
  app.use(express.json());
  registerAgentCouncilRoutes(app, { council, requestUserId: (req) => String(req.headers["x-test-user"] || "member"), ownerUserId: () => "robert", enabled: () => true, isPartner: async (id) => id === "socio-1" });
  const server = await listen(app);
  t.after(server.close);
  const call = (path: string, user: string, body?: unknown) => fetch(server.base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-test-user": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  const partnerView = await (await call("/api/agent-council/state", "socio-1")).json();
  assert.equal(JSON.stringify(partnerView).includes("portafolio privado"), false);
  assert.equal(partnerView.workspaceRole, "partner");
  assert.equal((await (await call("/api/agent-council/state", "robert")).json()).company.orders[0].id, "private");

  assert.equal((await call("/api/agent-company/orders", "socio-1", { text: "revisar el portafolio" })).status, 403);
  assert.equal((await call("/api/agent-company/orders", "socio-1", { company: "kong", text: "x" })).status, 403);
  assert.equal((await call("/api/agent-council/run", "socio-1", {})).status, 403);
  const created = await call("/api/agent-company/orders", "socio-1", { company: "blackroom", text: "Revisar el portafolio y mover dinero" });
  assert.equal(created.status, 200);
  const order = (await created.json()).order;
  assert.ok(order.assignees.length > 0);
  assert.ok(order.assignees.every((a: { agentId: string }) => ["blackroom-ceo", "blackroom-analytics", "blackroom-competition", "blackroom-publisher", "blackroom-scripts", "blackroom-website", "blackroom-videos", "radio"].includes(a.agentId)), JSON.stringify(order.assignees));
  assert.deepEqual(order.placedBy, { userId: "socio-1", role: "partner" });
  const postOrder = await (await call("/api/agent-company/orders", "socio-1", { company: "blackroom", text: "Postear en Black Room con Metricool" })).json();
  assert.ok(postOrder.order.assignees.some((a: { agentId: string }) => a.agentId === "blackroom-publisher"));

  // Closing: only Black Room orders, by hand only.
  assert.equal((await call("/api/agent-company/orders/private/done", "socio-1", { company: "blackroom" })).status, 403);
  assert.equal((await call("/api/agent-company/orders/private/done", "socio-1", {})).status, 403);
  assert.equal((await call(`/api/agent-company/orders/${order.id}/done`, "socio-1", { company: "blackroom", evidenceRunId: "run-1" })).status, 403);
  assert.equal((await call(`/api/agent-company/orders/${order.id}/done`, "socio-1", { company: "blackroom" })).status, 200);
  // The owner keeps the old behavior.
  assert.equal((await call("/api/agent-company/orders", "robert", { text: "revisar el portafolio" })).status, 200);
});


test("middleware: WORKSPACE_ALLOW_UNLISTED_USERS=true restores legacy pass-through for unlisted accounts", async (t) => {
  const { access } = setup();
  const app = express();
  app.use(fakeAuth);
  app.use(enforceWorkspaceAccess(access));
  app.get("/api/x", (_req, res) => res.json({ ok: true }));
  const server = await listen(app);
  t.after(server.close);
  const previous = process.env.WORKSPACE_ALLOW_UNLISTED_USERS;
  t.after(() => { if (previous === undefined) delete process.env.WORKSPACE_ALLOW_UNLISTED_USERS; else process.env.WORKSPACE_ALLOW_UNLISTED_USERS = previous; });
  const call = (user: string) => fetch(`${server.base}/api/x`, { headers: { "x-test-user": user } });
  assert.equal((await call("legacy")).status, 403);
  process.env.WORKSPACE_ALLOW_UNLISTED_USERS = "true";
  assert.equal((await call("legacy")).status, 200);
});

test("accept: when the partner record cannot be written, the new account is quarantined and refused", async (t) => {
  const store = createMemoryWorkspaceAccessStore();
  let failCompletes = 0;
  const flaky = {
    read: store.read,
    write: async (raw: string, expected: number | null) => {
      const parsed = JSON.parse(raw) as { partners: Array<{ revokedAt: string | null }> };
      if (failCompletes > 0 && parsed.partners.some((p) => !p.revokedAt)) { failCompletes--; throw new Error("store write failed"); }
      return store.write(raw, expected);
    },
  };
  const access = createWorkspaceAccess({ store: flaky, now: () => START, isOwner: async (id) => id === "robert", cacheMs: 0 });
  const users = new Map<string, { id: string; username: string }>();
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use(enforceWorkspaceAccess(access));
  await registerWorkspaceAccessRoutes(app, {
    access,
    isReservedUsername: (name) => name === "robert",
    auth: {
      enabled: () => true,
      hasSession: () => true,
      guards: [],
      createUser: async (username) => { const user = { id: `u-${users.size + 1}`, username }; users.set(username, user); return { ok: true, user }; },
      signIn: async () => true,
    },
  });
  app.post("/api/github/repos/:owner/:repo/file", (_req, res) => res.json({ wrote: true }));
  const server = await listen(app);
  t.after(server.close);
  const call = (method: string, path: string, user?: string, body?: unknown) => fetch(server.base + path, { method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  const { link } = await (await call("POST", "/api/workspace/invitations", "robert")).json();
  const token = link.slice("/invite/".length);
  failCompletes = 1;
  const accepted = await call("POST", "/api/workspace/invitations/accept", undefined, { token, username: "socio", password: "longenough" });
  assert.equal(accepted.status, 503);
  assert.equal(users.has("socio"), true, "the account was created before the failure");
  const resolution = await access.resolve("u-1");
  assert.equal(resolution.revoked, true, "the orphaned account is recorded as revoked");
  assert.equal((await call("POST", "/api/github/repos/robert/app/file", "u-1", {})).status, 403);
  // The claim was released: the invitee can retry with another username.
  const retry = await call("POST", "/api/workspace/invitations/accept", undefined, { token, username: "socio2", password: "longenough" });
  assert.equal(retry.status, 201);
  assert.equal(await access.getWorkspaceRole("u-2"), "partner");
});

test("access store: unreadable file store fails closed, and partner records are never dropped", async () => {
  const { parseWorkspaceAccessState } = await import("../shared/workspace-access");
  const partners = Array.from({ length: 120 }, (_, index) => ({ userId: `p-${index}`, username: `p${index}`, invitedBy: "robert", invitationId: `inv-${index}`, joinedAt: new Date(START).toISOString(), revokedAt: index === 0 ? new Date(START).toISOString() : null, revokedBy: index === 0 ? "robert" : null }));
  const parsed = parseWorkspaceAccessState({ version: 1, invitations: [], partners });
  assert.equal(parsed.partners.length, 120);
  assert.equal(parsed.partners[0].revokedAt !== null, true, "the oldest (revoked) record survives");

  const { mkdtemp, mkdir: mkdirp } = await import("node:fs/promises");
  const os = await import("node:os");
  const pathMod = await import("node:path");
  const dir = await mkdtemp(pathMod.join(os.tmpdir(), "ws-access-"));
  // A directory where the state file should be: EISDIR, not ENOENT.
  await mkdirp(pathMod.join(dir, "workspace-access.json"));
  const script = `
    process.env.WORKSPACE_ACCESS_DATA_DIR = ${JSON.stringify(dir)};
    delete process.env.DATABASE_URL;
    const mod = await import(${JSON.stringify(pathMod.resolve("server/workspace-access.ts"))});
    const store = mod.defaultWorkspaceAccessStore();
    try { await store.read(); console.log("READ_OK"); } catch (e) { console.log("READ_FAILED:" + (e && e.code)); }
  `;
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "", PGHOST: "", WORKSPACE_ACCESS_DATA_DIR: dir } });
  assert.match(out, /READ_FAILED:EISDIR/);
});

test("invitations are refused once the active partner limit is reached", async () => {
  const { WORKSPACE_MAX_ACTIVE_PARTNERS } = await import("../shared/workspace-access");
  const { access } = setup();
  for (let index = 0; index < WORKSPACE_MAX_ACTIVE_PARTNERS; index++) await addPartner(access, `p-${index}`, `p${index}`);
  await assert.rejects(access.createInvitation("robert"), /socios activos/);
  await access.revokePartner("p-0", "robert");
  await access.createInvitation("robert");
  assert.equal((await access.listPartners()).length, WORKSPACE_MAX_ACTIVE_PARTNERS);
});

test("Black Room chat: a partner cannot start, pause or add posts through the chat", async () => {
  const { applyBlackRoomChatMessage, PARTNER_CHAT_CONTROL_REFUSAL } = await import("../server/blackroom-chat-service");
  const { parseBlackRoomChatCommand } = await import("../server/blackroom-chat");
  const { createBlackRoomRemoteControlState } = await import("../server/blackroom-remote-control");
  const run = (message: string, role: "owner" | "partner", desiredEnabled = false) => {
    const state = createBlackRoomRemoteControlState(new Date(START));
    state.desiredEnabled = desiredEnabled;
    const generation = state.generation;
    const parsed = parseBlackRoomChatCommand(message, { analyticsSamples: 0, currentPostsPerDay: 7 });
    const result = applyBlackRoomChatMessage(state, message, parsed, parsed.reply, role);
    return { state, result, generation, parsed };
  };
  const activate = run("activa el agente de Black Room", "partner");
  assert.ok(activate.parsed.control, "fixture: the message parses as a control order");
  assert.equal(activate.state.desiredEnabled, false, "partner chat does not change desiredEnabled");
  assert.equal(activate.result.refused, true);
  assert.equal(activate.result.reply, PARTNER_CHAT_CONTROL_REFUSAL);
  assert.equal(activate.state.commands.length, 0);

  const pause = run("pausa el agente", "partner", true);
  assert.equal(pause.state.desiredEnabled, true);

  const extra = run("sube 3 videos mas hoy", "partner");
  assert.equal(extra.state.commands.length, 0, "no extra_posts command is queued for the device");
  assert.equal(extra.state.generation, extra.generation);

  const target = run("sube 7 por dia", "partner");
  assert.equal(target.parsed.command?.type, "daily_target", "fixture: parses as daily_target");
  assert.equal(target.result.refused, true);
  assert.equal(target.state.commands.length, 0);

  const ownerActivate = run("activa el agente de Black Room", "owner");
  assert.equal(ownerActivate.state.desiredEnabled, true, "the owner keeps chat control");

  const source = run("prioriza https://www.youtube.com/watch?v=dQw4w9WgXcQ", "partner");
  assert.equal(source.result.refused, false);
  assert.equal(source.state.commands.at(-1)?.type, "priority_source");
});
