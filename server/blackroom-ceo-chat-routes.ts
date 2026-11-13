import type { Express, Request, Response } from "express";
import path from "node:path";
import type { BlackRoomTeamActor } from "@shared/blackroom-team";
import { appendBlackRoomTeamAudit, type BlackRoomTeamAuditEntry } from "./blackroom-team/audit";
import { BLACKROOM_TEAM_DATA_DIR } from "./blackroom-team/state";
import { BLACKROOM_TEAM_RUNNING } from "./blackroom-team-routes";
import { CeoChatBusyError, CeoChatInputError, createCeoChat, type CeoChat, type CeoChatDeps } from "./blackroom-ceo-chat";
import { getCurrentUserId } from "./user-context";
import { getWorkspaceAccess, resolveOwnerOrPartner, type RequestActorResolution } from "./workspace-access";

export type BlackRoomCeoChatRouteOptions = {
  requestUserId?: (req: Request) => string | null;
  /** Owner or active partner; defaults to resolveOwnerOrPartner (server/workspace-access.ts). */
  resolveActor?: (userId: string) => Promise<RequestActorResolution | null>;
  /** Display name stored on each message (partner username; "Robert" for the owner). */
  authorName?: (actor: BlackRoomTeamActor) => Promise<string>;
  chat?: CeoChat;
  deps?: CeoChatDeps;
};

function defaultRequestUserId(req: Request): string | null {
  try {
    return getCurrentUserId(req);
  } catch {
    return null;
  }
}

async function defaultAuthorName(actor: BlackRoomTeamActor): Promise<string> {
  if (actor.role === "owner") return "Robert";
  try {
    const resolution = await getWorkspaceAccess().resolve(actor.userId);
    return resolution.partner?.username || "Socio";
  } catch {
    return "Socio";
  }
}

/**
 * Chat with the CEO Black Room. Owner and active partners only (also listed in
 * PARTNER_ALLOWED_ROUTES so the global partner gate lets partners through). Both see the same
 * thread; every message records who wrote it. Approve/reject here is an explicit click on a
 * publisher item: the CEO never approves by itself.
 */
export function registerBlackRoomCeoChatRoutes(app: Express, options: BlackRoomCeoChatRouteOptions = {}): void {
  const requestUserId = options.requestUserId ?? defaultRequestUserId;
  const resolveActor = options.resolveActor ?? ((userId: string) => resolveOwnerOrPartner(userId));
  const authorName = options.authorName ?? defaultAuthorName;
  const dataDir = options.deps?.dataDir ?? path.resolve(process.cwd(), BLACKROOM_TEAM_DATA_DIR);
  const chat = options.chat ?? createCeoChat({
    running: BLACKROOM_TEAM_RUNNING,
    audit: (entry: BlackRoomTeamAuditEntry) => appendBlackRoomTeamAudit(dataDir, entry),
    ...options.deps,
    dataDir,
  });

  const member = async (req: Request, res: Response): Promise<RequestActorResolution | null> => {
    res.set("Cache-Control", "no-store");
    try {
      const userId = requestUserId(req);
      if (!userId) { res.status(401).json({ error: "Inicia sesion para hablar con el CEO de Black Room." }); return null; }
      const resolution = await resolveActor(userId);
      if (!resolution) { res.status(403).json({ error: "El chat con el CEO de Black Room es solo para Robert y sus socios.", reason: "workspace_member_only" }); return null; }
      return resolution;
    } catch {
      res.status(503).json({ error: "No se pudo verificar el acceso." });
      return null;
    }
  };

  app.get("/api/blackroom-ceo-chat", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    try {
      res.json({ ...(await chat.view(who.contextUserId)), role: who.actor.role, me: who.actor.userId });
    } catch {
      res.status(500).json({ error: "No pude leer la conversacion con el CEO." });
    }
  });

  app.post("/api/blackroom-ceo-chat/messages", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    try {
      const name = await authorName(who.actor).catch(() => (who.actor.role === "owner" ? "Robert" : "Socio"));
      res.json(await chat.sendMessage({ text: (req.body as { text?: unknown } | undefined)?.text, actor: who.actor, authorName: name, contextUserId: who.contextUserId }));
    } catch (error) {
      if (error instanceof CeoChatInputError) return res.status(400).json({ error: error.message });
      if (error instanceof CeoChatBusyError) return res.status(409).json({ error: error.message });
      res.status(500).json({ error: "El CEO no pudo procesar el mensaje." });
    }
  });

  app.post("/api/blackroom-ceo-chat/approvals/:id/:decision", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    try {
      const name = await authorName(who.actor).catch(() => (who.actor.role === "owner" ? "Robert" : "Socio"));
      const outcome = await chat.decideApproval({ id: req.params.id, decision: req.params.decision, actor: who.actor, authorName: name, contextUserId: who.contextUserId });
      res.status(outcome.result.ok ? 200 : 422).json(outcome);
    } catch (error) {
      if (error instanceof CeoChatInputError) return res.status(400).json({ error: error.message });
      res.status(500).json({ error: "No se pudo registrar la decision." });
    }
  });
}
