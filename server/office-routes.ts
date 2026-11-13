import type { Express, Request, Response } from "express";
import { getAuthenticatedCurrentUserId, getSystemUserId } from "./user-context";
import { officeRuntime, officeTaskSchema, usesOfficeCloudRuntime } from "./office-runtime";
import { probeOfficeClaude } from "./office-claude";
import { OfficeKongError, probeOfficeKong, loadOfficeKongDirectory, runOfficeKongReadOnly, type OfficeKongAuditResult, type OfficeKongCityDirectoryEntry } from "./office-kong";
import { buildOfficeKongCollaboration } from "./office-kong-collaboration";

function owner(req: Request, res: Response): string | null {
  const userId = getAuthenticatedCurrentUserId(req);
  if (!userId) { res.status(401).json({ error: "Inicia sesion para ejecutar agentes." }); return null; }
  if (userId !== getSystemUserId()) {
    res.status(403).json({ error: "La conexion de agentes pertenece al propietario configurado." });
    return null;
  }
  return userId;
}

export function officeSameOrigin(req: Pick<Request, "get" | "protocol">): boolean {
  const origin = req.get("origin");
  if (!origin || !req.get("content-type")?.startsWith("application/json")) return false;
  try {
    const allowed = new URL(process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`);
    return new URL(origin).origin === allowed.origin;
  } catch { return false; }
}

export function registerOfficeRoutes(app: Express, dependencies: {
  runtime?: Pick<typeof officeRuntime, "list" | "submit">;
  claudeProbe?: typeof probeOfficeClaude;
  kongProbe?: typeof probeOfficeKong;
  directoryReader?: typeof loadOfficeKongDirectory;
  snapshotReader?: typeof runOfficeKongReadOnly;
  analyzeRadio?: typeof import("./radio-agent").analyzeRadioEvents;
  loadPullRequest?: typeof import("./office-github").loadOfficePullRequest;
  now?: () => number;
} = {}) {
  const runtime = dependencies.runtime || officeRuntime;
  const workerDisabled = () => process.env.OFFICE_WORKER_ENABLED === "false";
  let probe: { expiresAt: number; promise: Promise<unknown> } | undefined;
  let directory: { expiresAt: number; promise: Promise<OfficeKongCityDirectoryEntry[]> } | undefined;
  const now = dependencies.now || Date.now;
  let snapshot: { expiresAt: number; value: OfficeKongAuditResult } | undefined;
  let snapshotPending: Promise<OfficeKongAuditResult> | undefined;
  let retrySnapshotAt = 0;
  let snapshotFailureCode = "UNAVAILABLE";
  app.post("/api/agents-office/contact-action", async (req, res) => {
    const userId = owner(req, res);
    if (!userId) return;
    if (!officeSameOrigin(req)) return res.status(403).json({ error: "La solicitud debe salir de esta oficina." });
    res.set("Cache-Control", "no-store");
    const { action, prUrl } = req.body ?? {};
    try {
      if (action === "radio_analysis") {
        const analyzeRadioEvents = dependencies.analyzeRadio ?? (await import("./radio-agent")).analyzeRadioEvents;
        const result = await analyzeRadioEvents(userId);
        return res.json({ agentId: "radio", checkedAt: new Date(now()).toISOString(), summary: `Radio analizó ${result.totalEvents} eventos. ${result.eventsWithEmptySlots} tienen horarios vacíos.` });
      }
      if (action === "github_pull_request" && typeof prUrl === "string" && prUrl.length <= 300) {
        const { loadOfficePullRequest, parseOfficePrUrl } = await import("./office-github");
        try { parseOfficePrUrl(prUrl); } catch { return res.status(400).json({ error: "Usa el enlace canónico de un PR de GitHub." }); }
        const result = await (dependencies.loadPullRequest ?? loadOfficePullRequest)(prUrl);
        return res.json({ agentId: "github", checkedAt: new Date(now()).toISOString(), summary: `GitHub comprobó el PR ${result.prUrl}. Revisión exacta: ${result.headSha}. Huella del diff: ${result.diffSha256}.` });
      }
      return res.status(400).json({ error: "Esa acción individual no está disponible." });
    } catch {
      return res.status(503).json({ error: "El servicio del agente no pudo completar la consulta." });
    }
  });
  app.get("/api/agents-office/kong-snapshot", async (req, res) => {
    try {
      if (!owner(req, res)) return;
      res.set("Cache-Control", "no-store");
      let value = snapshot && snapshot.expiresAt > now() ? snapshot.value : undefined;
      if (!value) {
        if (retrySnapshotAt > now()) throw new Error("KONG_SNAPSHOT_BACKOFF");
        snapshotPending ||= Promise.resolve().then(dependencies.snapshotReader || runOfficeKongReadOnly)
          .then(value => { snapshot = { expiresAt: now() + 45_000, value }; retrySnapshotAt = 0; return value; })
          .catch(error => {
            retrySnapshotAt = now() + 30_000;
            snapshotFailureCode = error instanceof OfficeKongError ? error.code : "UNAVAILABLE";
            throw error;
          })
          .finally(() => { snapshotPending = undefined; });
        value = await snapshotPending;
      }
      res.json({ ...value, collaboration: buildOfficeKongCollaboration(value.evidence, now()) });
    } catch {
      res.set("Retry-After", String(Math.max(1, Math.ceil((retrySnapshotAt - now()) / 1000))));
      res.status(503).json({ error: "No se pudo consultar la actividad registrada de KONG.", code: snapshotFailureCode });
    }
  });
  app.get("/api/agents-office/cities", async (req, res) => {
    try {
      if (!owner(req, res)) return;
      res.set("Cache-Control", "no-store");
      if (!directory || directory.expiresAt < Date.now()) {
        const pending = (dependencies.directoryReader || loadOfficeKongDirectory)().catch(error => {
          if (directory?.promise === pending) directory = undefined;
          throw error;
        });
        directory = { expiresAt: Date.now() + 30 * 60_000, promise: pending };
      }
      res.json(await directory.promise);
    } catch { res.status(503).json({ error: "No se pudo consultar el directorio de ciudades de KONG." }); }
  });
  app.get("/api/agents-office/connections", async (req, res) => {
    try {
      if (!owner(req, res)) return;
      res.set("Cache-Control", "no-store");
      if (workerDisabled()) {
        const checkedAt = new Date(now()).toISOString();
        res.json({
          workerEnabled: false,
          worker: { status: "blocked", reason: "El ejecutor está desactivado.", checkedAt },
          claude: { status: "blocked", reason: "Claude necesita el ejecutor.", checkedAt },
          kong: { status: "blocked", reason: "Consulta la actividad de KONG en el panel.", checkedAt },
        });
        return;
      }
      if (!probe || probe.expiresAt < Date.now()) {
        probe = {
          expiresAt: Date.now() + 30_000,
          promise: usesOfficeCloudRuntime()
            ? import("./office-cloud-runtime").then(module => module.probeOfficeWorker()).then(({ capabilities, ...worker }) => ({ ...capabilities, worker }))
            : Promise.all([(dependencies.claudeProbe || probeOfficeClaude)(), (dependencies.kongProbe || probeOfficeKong)()])
              .then(([claude, kong]) => ({ claude, kong, worker: { status: "ready", reason: "Ejecutor local; no acredita servicio continuo en la nube.", checkedAt: new Date().toISOString() } })),
        };
      }
      res.json(await probe.promise);
    } catch { res.status(503).json({ error: "No se pudo verificar la conexion de agentes." }); }
  });
  app.get("/api/agents-office/runs", async (req, res) => {
    try {
      const userId = owner(req, res);
      if (!userId) return;
      res.set("Cache-Control", "no-store");
      res.json(await runtime.list(userId));
    } catch { res.status(503).json({ error: "El registro de ejecuciones no esta disponible." }); }
  });
  app.post("/api/agents-office/runs", async (req, res) => {
    try {
      const userId = owner(req, res);
      if (!userId) return;
      if (!officeSameOrigin(req)) return res.status(403).json({ error: "La solicitud debe salir de esta oficina." });
      if (workerDisabled()) return res.status(503).json({ error: "El ejecutor está desactivado. No se registró la tarea." });
      const input = officeTaskSchema.safeParse(req.body);
      if (!input.success) return res.status(400).json({ error: "La tarea no es valida." });
      const run = await runtime.submit(userId, input.data);
      res.status(run.status === "accepted" || run.status === "running" ? 202 : 200).json(run);
    } catch (error) {
      const code = (error as { code?: string }).code;
      res.status(code === "IDEMPOTENCY_CONFLICT" ? 409 : 503).json({ error: "No se pudo registrar la tarea. Comprueba el registro antes de volver a enviarla.", code });
    }
  });
}
