import type { Express, Request, Response } from "express";
import type { LegacyKongSupervisionArchive } from "../shared/kong-supervisor";

export type KongSupervisorOwnerAuth = { requestUserId: (req: Request) => string | null; ownerUserId: () => string };
/** Where KONG desks are chatted with now (server/agent-chat.ts -> KONG office-orders). */
export const KONG_DESK_CHAT_PATH = "/api/agent-chat/:agentId/messages";
// The retired "Supervisor KONG": its stored conversation stays readable for the owner only; it no
// longer runs readiness reviews or answers messages. Another account must never read it.
export function registerKongSupervisorRoutes(app: Express, readArchive: () => Promise<LegacyKongSupervisionArchive>, auth: KongSupervisorOwnerAuth) {
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
      res.json({ ...(await readArchive()), chatPath: KONG_DESK_CHAT_PATH });
    } catch { res.status(503).json({ error: "No se pudo leer el historial del supervisor." }); }
  });
  app.post("/api/kong-supervisor/chat", (req, res) => {
    if (!allow(req, res)) return;
    res.status(410).json({ error: "El Supervisor KONG se retiró. Habla con el puesto KONG desde la oficina (chat del agente).", chatPath: KONG_DESK_CHAT_PATH });
  });
}
