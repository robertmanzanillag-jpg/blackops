// Owner-only HTTP API for the Social Hub. Factory/office agents call getSocialHub() in-process.
import type { Express, Request, Response } from "express";
import { NETWORK_CAPABILITIES, type SocialPostInput, type SocialPostStatus } from "@shared/social-hub";
import { getCurrentUserId, getSystemUserId } from "../user-context";
import { envCredentialStore, listEnvAccounts } from "./providers";
import { fileSocialHubStore, SocialHub, SocialHubValidationError } from "./scheduler";

let hub: SocialHub | undefined;

export function getSocialHub(): SocialHub {
  return hub ||= new SocialHub({
    store: fileSocialHubStore(),
    credentials: envCredentialStore(),
    publishingEnabled: process.env.SOCIAL_HUB_PUBLISHING_ENABLED === "true",
    autoApproveBrands: (process.env.SOCIAL_HUB_AUTO_APPROVE_BRANDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  });
}

/** For la fábrica / la oficina: queue a post. Lands in pending_approval unless the brand is pre-approved. */
export function queueAgentSocialPost(agent: string, input: Omit<SocialPostInput, "createdBy">) {
  return getSocialHub().create({ ...input, createdBy: agent.startsWith("factory:") || agent.startsWith("office:") ? agent : `office:${agent}` });
}

let timer: NodeJS.Timeout | undefined;
export function startSocialHubScheduler(intervalMs = 60_000) {
  if (timer || process.env.SOCIAL_HUB_SCHEDULER !== "on") return;
  timer = setInterval(() => { getSocialHub().runDue().catch((e) => console.error("[social-hub]", e?.message ?? e)); }, intervalMs);
  timer.unref?.();
}

export function registerSocialHubRoutes(app: Pick<Express, "get" | "post">, deps: { hub?: () => SocialHub; isOwner?: (req: Request) => boolean } = {}) {
  const getHub = deps.hub ?? getSocialHub;
  const isOwner = deps.isOwner ?? ((req: Request) => { try { return getCurrentUserId(req) === getSystemUserId(); } catch { return false; } });
  const h = (work: (req: Request) => unknown | Promise<unknown>) => async (req: Request, res: Response) => {
    if (!isOwner(req)) return res.status(403).json({ error: "Solo el propietario puede usar el Social Hub." });
    res.set("Cache-Control", "no-store");
    try { res.json(await work(req)); }
    catch (e) {
      if (e instanceof SocialHubValidationError) return res.status(400).json({ error: e.message, problems: e.problems });
      res.status(409).json({ error: e instanceof Error ? e.message : "Error" });
    }
  };

  app.get("/api/social-hub/networks", h(() => ({ capabilities: NETWORK_CAPABILITIES, accounts: listEnvAccounts(), publishingEnabled: process.env.SOCIAL_HUB_PUBLISHING_ENABLED === "true" })));
  app.get("/api/social-hub/posts", h((req) => getHub().list({ status: req.query.status as SocialPostStatus | undefined, brand: req.query.brand as string | undefined })));
  app.post("/api/social-hub/posts", h((req) => getHub().create({ ...(req.body as SocialPostInput), createdBy: "robert" })));
  app.post("/api/social-hub/posts/:id/approve", h((req) => getHub().approve(String(req.params.id))));
  app.post("/api/social-hub/posts/:id/cancel", h((req) => getHub().cancel(String(req.params.id))));
  app.post("/api/social-hub/posts/:id/reschedule", h((req) => getHub().reschedule(String(req.params.id), String(req.body?.publishAt))));
  app.post("/api/social-hub/posts/:id/publish-now", h((req) => getHub().publishNow(String(req.params.id))));
  app.get("/api/social-hub/best-time", h((req) => ({ at: getHub().bestTime(String(req.query.networks ?? "instagram").split(",") as any).toISOString() })));
}
