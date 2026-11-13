import type { Express, Request, Response } from "express";
import { KongConversationInputError, type createKongSupervisorConversation } from "./kong-supervisor-conversation";

export type KongSupervisorOwnerAuth = { requestUserId: (req: Request) => string | null; ownerUserId: () => string };
// The council is a single-owner system. Require both session auth and an owner
// match; another authenticated account must never read this conversation.
export function registerKongSupervisorRoutes(app: Express, conversation: ReturnType<typeof createKongSupervisorConversation>, auth: KongSupervisorOwnerAuth) {
  const allow = (req: Request, res: Response) => {
    try {
      const userId = auth.requestUserId(req);
      if (!userId) { res.status(401).json({ error: "Inicia sesion para acceder al supervisor." }); return false; }
      if (userId !== auth.ownerUserId()) { res.status(403).json({ error: "Esta conversacion pertenece al propietario del asistente." }); return false; }
      return true;
    } catch { res.status(503).json({ error: "No se pudo verificar el propietario del asistente." }); return false; }
  };
  app.get("/api/kong-supervisor/state", async (req, res) => {
    if (!allow(req, res)) return;
    try {
      res.set("Cache-Control", "no-store");
      res.json(await conversation.view());
    } catch { res.status(503).json({ error: "No se pudo leer el estado del supervisor." }); }
  });
  app.post("/api/kong-supervisor/chat", async (req, res) => {
    if (!allow(req, res)) return;
    try { res.json(await conversation.talk(req.body)); }
    catch (error) {
      res.status(error instanceof KongConversationInputError ? 400 : 503).json({ error: error instanceof KongConversationInputError ? error.message : "No se pudo guardar la conversacion. Intenta de nuevo." });
    }
  });
}
