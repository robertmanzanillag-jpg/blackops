import type { Express, Request, Response } from "express";
import { isBlackRoomTeamActionName, isBlackRoomTeamAgentId, type BlackRoomTeamAgentId, type BlackRoomTeamRunResult } from "@shared/blackroom-team";
import type { BlackRoomTeamAuditEntry } from "./blackroom-team/audit";
import {
  BLACKROOM_TEAM_MODULES,
  createBlackRoomTeamContext,
  getAllBlackRoomTeamStatuses,
  getBlackRoomTeamStatus,
  type BlackRoomTeamContextOptions,
  type BlackRoomTeamModules,
} from "./blackroom-team";
import path from "node:path";
import { getCurrentUserId } from "./user-context";
import { resolveOwnerOrPartner, type RequestActorResolution } from "./workspace-access";
import { appendBlackRoomTeamAudit } from "./blackroom-team/audit";
import { BLACKROOM_TEAM_DATA_DIR } from "./blackroom-team/state";

export type BlackRoomTeamRouteOptions = {
  /** Resolves the request's user id or null (no session). Defaults to getCurrentUserId. */
  requestUserId?: (req: Request) => string | null;
  /** Legacy owner-only check (tests). When given without resolveActor, only owners get in. */
  isOwner?: (userId: string) => Promise<boolean>;
  /**
   * Owner or active partner ("socio"). Defaults to resolveOwnerOrPartner (server/workspace-access.ts).
   * contextUserId is the workspace owner, so partners work on Robert's Black Room data.
   */
  resolveActor?: (userId: string) => Promise<RequestActorResolution | null>;
  modules?: BlackRoomTeamModules;
  context?: Omit<BlackRoomTeamContextOptions, "modules" | "userId" | "actor">;
  /** Audit sink for who ran what; defaults to <dataDir>/audit.json. */
  audit?: (entry: BlackRoomTeamAuditEntry) => Promise<void>;
  /** Busy set shared with the CEO chat; defaults to BLACKROOM_TEAM_RUNNING. */
  running?: Set<string>;
};

const MAX_INPUT_KEYS = 50;

/** Agents running right now, shared with the CEO chat so the same agent never runs twice at once. */
export const BLACKROOM_TEAM_RUNNING = new Set<string>();

function defaultRequestUserId(req: Request): string | null {
  try {
    return getCurrentUserId(req);
  } catch {
    return null;
  }
}

function inputFrom(body: unknown): Record<string, unknown> | null {
  if (body === undefined || body === null || body === "") return {};
  if (typeof body !== "object" || Array.isArray(body)) return null;
  return Object.keys(body as object).length > MAX_INPUT_KEYS ? null : (body as Record<string, unknown>);
}

function sendResult(res: Response, result: BlackRoomTeamRunResult) {
  // A run that did not complete is reported as such; the HTTP call itself succeeded.
  res.json(result);
}

/**
 * Black Room team (CEO, analiticas, competencia, publicador, guiones, website). Open to the owner
 * and to invited partners (socios): both can read statuses, run agents and call their actions,
 * including publisher approve/reject. Every run/action records who did it (userId + role).
 * None of these endpoints publishes or contacts anyone by itself: outward actions come back as
 * approvals, and dispatch keeps its own live-mode flags.
 */
export function registerBlackRoomTeamRoutes(app: Express, options: BlackRoomTeamRouteOptions = {}): void {
  const requestUserId = options.requestUserId ?? defaultRequestUserId;
  const resolveActor = options.resolveActor ?? (options.isOwner
    ? async (userId: string): Promise<RequestActorResolution | null> => (await options.isOwner!(userId)) ? { actor: { userId, role: "owner" }, contextUserId: userId } : null
    : (userId: string) => resolveOwnerOrPartner(userId));
  const modules = options.modules ?? BLACKROOM_TEAM_MODULES;
  const dataDir = options.context?.dataDir ?? path.resolve(process.cwd(), BLACKROOM_TEAM_DATA_DIR);
  const audit = options.audit ?? ((entry: BlackRoomTeamAuditEntry) => appendBlackRoomTeamAudit(dataDir, entry));
  const running = options.running ?? BLACKROOM_TEAM_RUNNING;

  const member = async (req: Request, res: Response): Promise<RequestActorResolution | null> => {
    res.set("Cache-Control", "no-store");
    try {
      const userId = requestUserId(req);
      if (!userId) { res.status(401).json({ error: "Inicia sesion para ver el equipo de Black Room." }); return null; }
      const resolution = await resolveActor(userId);
      if (!resolution) { res.status(403).json({ error: "El equipo de Black Room es solo para Robert y sus socios." }); return null; }
      return resolution;
    } catch {
      res.status(503).json({ error: "No se pudo verificar el acceso." });
      return null;
    }
  };
  const agentId = (req: Request, res: Response): BlackRoomTeamAgentId | null => {
    const id = req.params.id;
    if (!isBlackRoomTeamAgentId(id)) { res.status(404).json({ error: "Agente de Black Room desconocido." }); return null; }
    return id;
  };
  const contextOptions = (who: RequestActorResolution): BlackRoomTeamContextOptions => ({ ...options.context, modules, userId: who.contextUserId, actor: who.actor });

  app.get("/api/blackroom-team", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    res.json({ agents: await getAllBlackRoomTeamStatuses(contextOptions(who)), role: who.actor.role });
  });

  app.get("/api/blackroom-team/:id/status", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    const id = agentId(req, res);
    if (!id) return;
    res.json(await getBlackRoomTeamStatus(id, contextOptions(who)));
  });

  const execute = async (req: Request, res: Response, id: BlackRoomTeamAgentId, who: RequestActorResolution, operation: string, work: (input: Record<string, unknown>) => Promise<BlackRoomTeamRunResult>) => {
    const input = inputFrom(req.body);
    if (!input) return res.status(400).json({ error: "El cuerpo debe ser un objeto JSON." });
    if (running.has(id)) return res.status(409).json({ error: "Este agente ya esta trabajando. Espera a que termine." });
    running.add(id);
    let result: BlackRoomTeamRunResult | null = null;
    try {
      result = await work(input);
      sendResult(res, result);
    } catch (error) {
      result = { ok: false, summary: "La ejecucion fallo.", error: error instanceof Error ? error.message.slice(0, 200) : "sin detalle" };
      res.status(500).json(result);
    } finally {
      running.delete(id);
      const targetId = typeof input.id === "string" ? input.id.slice(0, 120) : undefined;
      await audit({ at: new Date().toISOString(), agentId: id, operation, actor: who.actor, ok: Boolean(result?.ok), ...(targetId ? { targetId } : {}), summary: result?.summary || "" })
        .catch((error) => console.warn("[blackroom-team] audit write failed:", error instanceof Error ? error.message : error));
    }
  };

  app.post("/api/blackroom-team/:id/run", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    const id = agentId(req, res);
    if (!id) return;
    await execute(req, res, id, who, "run", (input) => modules[id].run(createBlackRoomTeamContext(id, contextOptions(who)), input));
  });

  app.post("/api/blackroom-team/:id/action/:action", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    const id = agentId(req, res);
    if (!id) return;
    const name = req.params.action;
    const handler = isBlackRoomTeamActionName(name) && modules[id].actions && Object.prototype.hasOwnProperty.call(modules[id].actions, name) ? modules[id].actions![name] : undefined;
    if (!handler) return res.status(404).json({ error: "Accion desconocida para este agente." });
    await execute(req, res, id, who, name, (input) => handler(createBlackRoomTeamContext(id, contextOptions(who)), input));
  });
}
