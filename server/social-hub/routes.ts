// Owner-only HTTP API for the Social Hub. Factory/office agents call getSocialHub() in-process.
import type { Express, Request, Response } from "express";
import { NETWORK_CAPABILITIES, SOCIAL_NETWORKS, type SocialNetwork, type SocialPostInput, type SocialPostStatus } from "@shared/social-hub";
import { getCurrentUserId, getSystemUserId } from "../user-context";
import { envCredentialStore, listEnvAccounts } from "./providers";
import { buildAuthUrl, completeOAuth, loadTokens, oauthConfigured, oauthCredentialStore, OAUTH_APPS, removeToken } from "./oauth";
import { hydrateSocialHub, kvFlush } from "./persist";
import { persistentSocialHubStore, SocialHub, SocialHubValidationError } from "./scheduler";

let hub: SocialHub | undefined;

export function getSocialHub(): SocialHub {
  return hub ||= new SocialHub({
    store: persistentSocialHubStore(),
    credentials: oauthCredentialStore(envCredentialStore()),
    publishingEnabled: process.env.SOCIAL_HUB_PUBLISHING_ENABLED === "true",
    autoApproveBrands: (process.env.SOCIAL_HUB_AUTO_APPROVE_BRANDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  });
}

/** For la fábrica / la oficina: queue a post. Lands in pending_approval unless the brand is pre-approved. */
export async function queueAgentSocialPost(agent: string, input: Omit<SocialPostInput, "createdBy">) {
  await socialHubReady();
  return getSocialHub().create({ ...input, createdBy: agent.startsWith("factory:") || agent.startsWith("office:") ? agent : `office:${agent}` });
}

let ready: Promise<void> | undefined;
/** Loads queue + tokens from Postgres once. Every route and the scheduler wait for it. */
export function socialHubReady(): Promise<void> {
  return ready ||= hydrateSocialHub().catch((e) => { ready = undefined; throw e; });
}

let timer: NodeJS.Timeout | undefined;
export function startSocialHubScheduler(intervalMs = 60_000) {
  socialHubReady().catch((e) => console.error("[social-hub] no pude cargar el almacenamiento:", e?.message ?? e));
  if (timer || process.env.SOCIAL_HUB_SCHEDULER !== "on") return;
  let tick = 0;
  timer = setInterval(() => {
    // Metrics every 6 hours (360 ticks) to stay inside API quotas.
    if (++tick % 360 === 0) socialHubReady().then(() => getSocialHub().collectMetrics()).catch((e) => console.error("[social-hub metrics]", e?.message ?? e));
    socialHubReady().then(() => getSocialHub().runDue()).catch((e) => console.error("[social-hub]", e?.message ?? e));
  }, intervalMs);
  timer.unref?.();
}

export function registerSocialHubRoutes(app: Pick<Express, "get" | "post">, deps: { hub?: () => SocialHub; isOwner?: (req: Request) => boolean } = {}) {
  const getHub = deps.hub ?? getSocialHub;
  const isOwner = deps.isOwner ?? ((req: Request) => { try { return getCurrentUserId(req) === getSystemUserId(); } catch { return false; } });
  const h = (work: (req: Request) => unknown | Promise<unknown>) => async (req: Request, res: Response) => {
    if (!isOwner(req)) return res.status(403).json({ error: "Solo el propietario puede usar el Social Hub." });
    res.set("Cache-Control", "no-store");
    try { await socialHubReady(); res.json(await work(req)); await kvFlush(); }
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
  app.get("/api/social-hub/analytics", h((req) => getHub().analytics(Number(req.query.days ?? 30))));
  app.post("/api/social-hub/analytics/refresh", h(() => getHub().collectMetrics()));
  // ---- Conectar cuentas ----
  const asNetwork = (v: unknown): SocialNetwork => {
    if (!SOCIAL_NETWORKS.includes(v as SocialNetwork)) throw new Error("Red desconocida");
    return v as SocialNetwork;
  };
  app.get("/api/social-hub/connections", h(() => {
    let tokens: ReturnType<typeof loadTokens> = [];
    try { tokens = loadTokens(); } catch { tokens = []; }
    return {
      apps: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, { ready: oauthConfigured(n), needs: [OAUTH_APPS[n].clientIdEnv, OAUTH_APPS[n].clientSecretEnv] }])),
      connected: tokens.map((t) => ({ network: t.network, accountId: t.accountId, label: t.label, connectedAt: t.connectedAt, expiresAt: t.expiresAt })),
    };
  }));
  app.get("/api/social-hub/oauth/start/:network", async (req, res) => {
    if (!isOwner(req)) return res.status(403).send("Solo el propietario puede conectar cuentas.");
    try { await socialHubReady(); res.redirect(buildAuthUrl(asNetwork(req.params.network))); }
    catch (e) { res.status(400).send(e instanceof Error ? e.message : "Error"); }
  });
  // The callback is protected by the one-time state created in /start (which is owner-only).
  app.get("/api/social-hub/oauth/callback", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    try {
      if (req.query.error) throw new Error(String(req.query.error_description ?? req.query.error));
      await socialHubReady();
      const rows = await completeOAuth(String(req.query.state ?? ""), String(req.query.code ?? ""));
      await kvFlush();
      res.type("html").send(`<meta charset="utf-8"><h2>Conectado ✅</h2><ul>${rows.map((r) => `<li>${esc(r.network)}: ${esc(r.label)}</li>`).join("")}</ul><p>Ya puedes cerrar esta pestaña.</p>`);
    } catch (e) {
      res.status(400).type("html").send(`<meta charset="utf-8"><h2>No se pudo conectar</h2><p>${esc(e instanceof Error ? e.message : "Error")}</p>`);
    }
  });
  app.post("/api/social-hub/connections/:network/:accountId/disconnect", h((req) => { removeToken(asNetwork(req.params.network), String(req.params.accountId)); return { ok: true }; }));
  app.get("/api/social-hub/best-time", h((req) => ({ at: getHub().bestTime(String(req.query.networks ?? "instagram").split(",") as any).toISOString() })));
}
