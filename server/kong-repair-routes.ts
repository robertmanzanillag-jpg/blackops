import { startConfiguredRepairPull, pullConfiguredRepairSources, configuredRepairPullStatus } from "./kong-repair-pull";
import type { Express, Request } from "express";
import { verifyRepairEnvelope, verifyWorkerEnvelope, verifyRepairStatus, signVerifiedRepair, type createKongRepairBridge } from "./kong-repair-bridge";
import { getKongRepairBridge, readKongRepairMakerHealth, readKongRepairGithubReadiness } from "./kong-repair-runtime";
import { getAuthenticatedCurrentUserId, getSystemUserId } from "./user-context";
import { officeSameOrigin } from "./office-routes";
export function registerKongRepairRoutes(app: Express, options: {
  resolve?: () => Promise<ReturnType<typeof createKongRepairBridge> | undefined>;
  owner?: (req: Request) => boolean; signingSecret?: () => string | undefined; handoffEnabled?: () => boolean; now?: () => number;
} = {}) {
  const resolve = options.resolve || getKongRepairBridge;
  if (!options.resolve) startConfiguredRepairPull();
  const owner = options.owner || ((req: Request) => !!getAuthenticatedCurrentUserId(req) && getAuthenticatedCurrentUserId(req) === getSystemUserId());
  const secret = options.signingSecret || (() => process.env.KONG_ASISTENTE_HMAC_SECRET);
  const handoffEnabled = options.handoffEnabled || (() => process.env.KONG_REPAIR_HANDOFF_ENABLED === "true" && /^[a-f0-9]{40}$/.test(process.env.KONG_REPAIR_CHECKER_ENGINE_COMMIT || ""));
  app.post("/api/integrations/kong/software-repairs", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const bridge = await resolve(); if (!bridge) return res.status(503).json({ code: "REPAIR_BRIDGE_DISABLED", accepted: false });
      const envelope = verifyRepairEnvelope(req.rawBody, req.get("x-kong-signature"), secret(), (options.now || Date.now)());
      const entry = await bridge.receive(envelope);
      // This is subscription handoff only, never a paid factory stage. A lost
      // GitHub acknowledgment stays dispatch_unknown; delivery retries cannot replay it.
      if (handoffEnabled()) await bridge.dispatch(entry.key).catch(() => undefined);
      return res.status(202).json({ accepted: true, status: "accepted", eventId: envelope.eventId, idempotencyKey: envelope.idempotencyKey });
    } catch { return res.status(409).json({ accepted: false, code: "REPAIR_REQUEST_UNCONFIRMED" }); }
  });
  app.post("/api/integrations/kong/software-repairs/status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const request = verifyRepairStatus(req.rawBody, req.get("x-kong-signature"), secret(), (options.now || Date.now)());
      const bridge = await resolve(); if (!bridge) return res.status(503).json({ code: "REPAIR_BRIDGE_DISABLED" });
      const prior = (await bridge.view()).entries.find(entry => entry.key === request.payload.key);
      if (!prior || prior.payload.sourceTaskId !== request.payload.sourceTaskId) return res.status(404).json({ code: "REPAIR_SOURCE_NOT_FOUND" });
      if (prior.status === "queued" && handoffEnabled()) await bridge.dispatch(prior.key).catch(() => undefined);
      const entry = (await bridge.sync(prior.key, request.payload.sourceStillPresent && request.payload.fingerprint === prior.payload.fingerprint))[0];
      return res.json({ code: "REPAIR_STATUS", key: entry.key, state: entry.status,
        closure: signVerifiedRepair(entry, secret()!, (options.now || Date.now)()) });
    } catch { return res.status(409).json({ code: "REPAIR_STATUS_UNCONFIRMED" }); }
  });
  app.post("/api/integrations/kong/software-repairs/worker", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (process.env.KONG_REPAIR_MAKER_ENABLED !== "true") return res.status(503).json({ code: "REPAIR_MAKER_DISABLED" });
      const request = verifyWorkerEnvelope(req.rawBody, req.get("x-kong-signature"), secret(), (options.now || Date.now)());
      const allowed = (process.env.KONG_REPAIR_WORKER_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
      if (!allowed.includes(request.payload.workerId)) return res.status(403).json({ code: "REPAIR_WORKER_NOT_ALLOWED" });
      const bridge = await resolve(); if (!bridge) return res.status(503).json({ code: "REPAIR_BRIDGE_DISABLED" });
      const entry = await bridge.worker(request);
      return res.json({ accepted: true, eventId: request.eventId, idempotencyKey: request.idempotencyKey,
        claim: entry ? { key: entry.key, fence: entry.maker?.fence, leaseExpiresAt: entry.maker?.expiresAt,
          repository: entry.payload.repository, baseBranch: "codex/kong-production-recovery-20261117", issueUrl: entry.issueUrl,
          sourceTaskId: entry.payload.sourceTaskId, errorId: entry.payload.errorId, summary: entry.payload.summary, status: entry.status } : null });
    } catch { return res.status(409).json({ code: "REPAIR_WORKER_UNCONFIRMED" }); }
  });
  app.get("/api/kong-repairs", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!owner(req)) return res.status(403).json({ code: "REPAIR_OWNER_REQUIRED" });
    const readiness = { bridgeEnabled: process.env.KONG_REPAIR_BRIDGE_ENABLED === "true", handoffRequested: process.env.KONG_REPAIR_HANDOFF_ENABLED === "true",
      handoffConfigured: handoffEnabled(), signingConfigured: (secret()?.length || 0) >= 32,
      enginePinned: /^[a-f0-9]{40}$/.test(process.env.KONG_REPAIR_CHECKER_ENGINE_COMMIT || ""),
      githubConnectionPossible: !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.REPLIT_CONNECTORS_HOSTNAME) };
    try { const bridge = await resolve(), github = await readKongRepairGithubReadiness();
      if (!bridge) return res.status(503).json({ code: "REPAIR_BRIDGE_DISABLED", readiness, github });
      const view = await bridge.view(), maker = await readKongRepairMakerHealth().catch(() => ({ state: "unavailable", workerConnected: false }));
      return res.json({ ...view, makerConsumer: maker.workerConnected ? `worker_${maker.state}` : view.makerConsumer, readiness, github, maker, pull: await configuredRepairPullStatus().catch(() => ({ code: "REPAIR_PULL_STATUS_UNAVAILABLE" })) }); }
    catch { return res.status(503).json({ code: "REPAIR_STATUS_UNAVAILABLE" }); }
  });
  app.post("/api/kong-repairs/pull", async (req, res) => {
    if (!owner(req) || !officeSameOrigin(req)) return res.status(403).json({ code: "REPAIR_OWNER_REQUIRED" });
    try { return res.json(await pullConfiguredRepairSources()); } catch { return res.status(503).json({ code: "REPAIR_PULL_UNCONFIRMED" }); }
  });
  app.post("/api/kong-repairs/:key/:action", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!owner(req) || !officeSameOrigin(req)) return res.status(403).json({ code: "REPAIR_OWNER_REQUIRED" });
    try {
      const bridge = await resolve(); if (!bridge) return res.status(503).json({ code: "REPAIR_BRIDGE_DISABLED" });
      if (req.params.action === "dispatch" && handoffEnabled()) return res.json(await bridge.dispatch(String(req.params.key)));
      if (req.params.action === "check" && Number.isSafeInteger(req.body?.prNumber)) return res.json(await bridge.check(String(req.params.key), req.body.prNumber));
      return res.status(400).json({ code: "REPAIR_ACTION_NOT_ENABLED" });
    } catch { return res.status(409).json({ code: "REPAIR_ACTION_UNCONFIRMED" }); }
  });
}
