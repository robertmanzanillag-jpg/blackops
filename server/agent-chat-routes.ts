import type { Express, Request, Response } from "express";
import { AgentChatInputError, AgentChatNotFound, createAgentChatService, createChatStorageThreadStore } from "./agent-chat";
import { getCurrentUserId, getSystemUserId } from "./user-context";

type Service = ReturnType<typeof createAgentChatService>;

// Owner-only, like the KONG supervisor chat: session auth AND owner match. Sits behind requireAppUser too.
export function registerAgentChatRoutes(app: Pick<Express, "get" | "post">, deps: {
  service?: (ownerId: string) => Service | Promise<Service>;
  requestUserId?: (req: Request) => string | null;
  ownerUserId?: () => string;
} = {}) {
  const requestUserId = deps.requestUserId ?? ((req: Request) => { try { return getCurrentUserId(req); } catch { return null; } });
  const ownerUserId = deps.ownerUserId ?? getSystemUserId;
  let cached: Promise<Service> | undefined;
  const service = deps.service ?? ((owner: string) => cached ||= (async () => {
    const [{ getAgentCouncil }, { chatStorage }, { createAgentChatModel }] = await Promise.all([
      import("./agent-council"), import("./replit_integrations/chat/storage"), import("./agent-chat-model")]);
    const council = getAgentCouncil();
    return createAgentChatService({ store: createChatStorageThreadStore(chatStorage, owner), council, model: createAgentChatModel(council) });
  })());
  const allow = (req: Request, res: Response) => {
    try {
      const userId = requestUserId(req);
      if (!userId) { res.status(401).json({ error: "Inicia sesión para hablar con los agentes." }); return null; }
      const owner = ownerUserId();
      if (userId !== owner) { res.status(403).json({ error: "Los chats de agentes pertenecen al propietario del asistente." }); return null; }
      return owner;
    } catch { res.status(503).json({ error: "No se pudo verificar el propietario." }); return null; }
  };
  const handle = (work: (svc: Service, req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    const owner = allow(req, res);
    if (!owner) return;
    res.set("Cache-Control", "no-store");
    try { res.json(await work(await service(owner), req)); }
    catch (error) {
      if (error instanceof AgentChatInputError) return res.status(400).json({ error: error.message });
      if (error instanceof AgentChatNotFound) return res.status(404).json({ error: error.message });
      res.status(503).json({ error: "No se pudo completar la conversación. Intenta de nuevo." });
    }
  };
  app.get("/api/agent-chat/agents", handle(svc => svc.agents().then(agents => ({ agents }))));
  app.get("/api/agent-chat/handoffs", handle(svc => svc.handoffs().then(handoffs => ({ handoffs }))));
  app.get("/api/agent-chat/:agentId/threads", handle((svc, req) => svc.threads(req.params.agentId).then(threads => ({ threads }))));
  app.post("/api/agent-chat/:agentId/threads", handle((svc, req) => svc.createThread(req.params.agentId, req.body?.title).then(thread => ({ thread }))));
  app.get("/api/agent-chat/:agentId/threads/:threadId", handle((svc, req) => svc.thread(req.params.agentId, req.params.threadId)));
  app.post("/api/agent-chat/:agentId/messages", handle((svc, req) => svc.send(req.params.agentId, req.body)));
}
