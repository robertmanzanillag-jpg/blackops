import type { Express, Request, Response } from "express";
import { z } from "zod";
import { KongOpsError } from "@shared/kong-operations";
import type { createKongOperations } from "./kong-operations";

export type KongOpsOwnerAuth = { requestUserId: (req: Request) => string | null; ownerUserId: () => string };

const holder = z.string().regex(/^[a-z0-9][a-z0-9:_-]{1,39}$/, "titular invalido");
const leaseId = z.string().regex(/^[A-Za-z0-9_-]{6,80}$/, "lease invalido");
const uuid = z.string().uuid();
const leaseBody = z.object({ action: z.enum(["claim", "release"]), holder, leaseId }).strict();
const publicationBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), holder, epoch: z.number().int().positive(), uuid, briefId: z.string().min(3).max(120), network: z.string().regex(/^[a-z]{2,20}$/) }).strict(),
  z.object({
    action: z.literal("attempt"),
    holder,
    epoch: z.number().int().positive(),
    uuid,
    outcome: z.enum(["submitted", "confirmed", "failed", "unknown"]),
    externalPostId: z.string().min(1).max(120).optional(),
    publishedAt: z.string().datetime({ offset: true }).optional(),
    error: z.string().max(200).optional(),
  }).strict(),
]);
const reconcileBody = z.object({
  posts: z.array(z.object({ postId: z.string().min(1).max(120), uuid: z.string().max(64).nullish(), text: z.string().max(5000).nullish(), network: z.string().max(30).nullish(), publishedAt: z.string().max(40).nullish() }).strict()).max(500),
}).strict();
const cardsBody = z.object({ cards: z.array(z.unknown()).min(1).max(50) }).strict();
// Rows already normalized by whoever read Metricool (same shape as parseMetricoolPostMetrics).
const count = z.number().finite().nonnegative();
const metricsBody = z.object({
  rows: z.array(z.object({
    network: z.string().regex(/^[a-z]{2,20}$/),
    postId: z.string().min(1).max(120).nullable(),
    queueItemId: z.string().max(120).nullable().optional(),
    contentHash: z.string().max(120).nullable().optional(),
    observedAt: z.string().max(40).nullable(),
    impressions: count, reach: count, videoViews: count, engagements: count, clicks: count, shares: count,
  }).strict()).max(2000),
}).strict();

/**
 * KONG operations from the Agents Office. Owner-only, like the KONG supervisor.
 * These routes coordinate the single external publisher; none of them publishes anything.
 */
export function registerKongOperationsRoutes(app: Express, ops: ReturnType<typeof createKongOperations>, auth: KongOpsOwnerAuth) {
  const allow = (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    try {
      const userId = auth.requestUserId(req);
      if (!userId) { res.status(401).json({ error: "Inicia sesion para operar KONG." }); return false; }
      if (userId !== auth.ownerUserId()) { res.status(403).json({ error: "La operacion de KONG pertenece al propietario." }); return false; }
      return true;
    } catch { res.status(503).json({ error: "No se pudo verificar el propietario." }); return false; }
  };
  // invalid/unknown_* -> 400; uuid_mismatch, lease_held, not_holder, stale_epoch, already_published -> 409.
  const fail = (res: Response, error: unknown) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).slice(0, 4).join("; ") });
    if (error instanceof KongOpsError) return res.status(error.code === "invalid" || error.code === "unknown_brief" || error.code === "unknown_publication" ? 400 : 409).json({ error: error.message, code: error.code });
    return res.status(503).json({ error: "No se pudo guardar. Intenta de nuevo." });
  };

  app.get("/api/kong-ops/state", async (req, res) => {
    if (!allow(req, res)) return;
    try { res.json(await ops.view()); } catch (error) { fail(res, error); }
  });
  // Venues / Promoters deliver verified cards to Videos KONG.
  app.post("/api/kong-ops/cards", async (req, res) => {
    if (!allow(req, res)) return;
    try { res.json(await ops.deliver(cardsBody.parse(req.body).cards)); } catch (error) { fail(res, error); }
  });
  // Single publisher: claim/renew or release the lease.
  app.post("/api/kong-ops/lease", async (req, res) => {
    if (!allow(req, res)) return;
    try {
      const body = leaseBody.parse(req.body);
      res.json({ lease: body.action === "claim" ? await ops.claim(body.holder, body.leaseId) : await ops.release(body.holder, body.leaseId) });
    } catch (error) { fail(res, error); }
  });
  // The holder reserves a UUID before publishing and reports each attempt.
  app.post("/api/kong-ops/publications", async (req, res) => {
    if (!allow(req, res)) return;
    try {
      const body = publicationBody.parse(req.body);
      const { action, ...input } = body;
      res.json({ publication: action === "plan" ? await ops.plan(input as never) : await ops.attempt(input as never) });
    } catch (error) { fail(res, error); }
  });
  // What really went out, so failed/unknown attempts are reconciled by UUID.
  app.post("/api/kong-ops/reconcile", async (req, res) => {
    if (!allow(req, res)) return;
    try { res.json(await ops.reconcile(reconcileBody.parse(req.body).posts)); } catch (error) { fail(res, error); }
  });
  // Metrics agent: per-post rows that the external publisher read from Metricool; the office never calls Metricool here.
  app.post("/api/kong-ops/metrics", async (req, res) => {
    if (!allow(req, res)) return;
    try { res.json({ results: await ops.measure(metricsBody.parse(req.body).rows) }); } catch (error) { fail(res, error); }
  });
}
