import type { Express } from "express";
import { OrderEvidenceError, getAgentCouncil, isAgentCouncilEnabled, setAgentCouncilUser } from "./agent-council";
import { getCurrentUserId, getSystemUserId } from "./user-context";
import { agentProbes, summarizeProbe } from "@shared/agent-live-status";
import { createKongSupervisorConversation } from "./kong-supervisor-conversation";
import { registerKongSupervisorRoutes } from "./kong-supervisor-routes";
import {capabilityTrainingSummary,capabilityRunSummary} from "./office-capability-training";
import { createHash } from "node:crypto";
import { factoryAgentForStage, type FactoryJobRow } from "@shared/factory-office-agents";
import { redactChatActivity } from "@shared/agent-chat-routing";

const FACTORY_LIVE_CACHE_MS = 30_000;
const FACTORY_LIVE_TIMEOUT_MS = 3_000;
/** Read-only: the same owner-scoped list the factory dashboard already reads. Never claims, completes or writes. */
async function readFactoryJobsReal(owner: string): Promise<FactoryJobRow[]> {
  const { configuredSoftwareFactoryStore } = await import("./software-factory-store-provider");
  return configuredSoftwareFactoryStore.list(owner) as Promise<FactoryJobRow[]>;
}
import { isBlackRoomOnlyOrder, redactCouncilViewForPartner } from "@shared/workspace-access";

const MANUAL_RUN_MIN_INTERVAL_MS = 60_000;

// Read-only view + a rate-limited manual cycle. Both sit behind requireAppUser (server/index.ts).
export function registerAgentCouncilRoutes(app: Express, dependencies: {
  council?: ReturnType<typeof getAgentCouncil>;
  requestUserId?: typeof getCurrentUserId;
  ownerUserId?: typeof getSystemUserId;
  enabled?: typeof isAgentCouncilEnabled;
  /** Read-only factory stage rows for live presence (owner only). Tests inject a fake. */
  readFactoryJobs?: (owner: string) => Promise<readonly FactoryJobRow[]>;
  now?: () => number;
  /** Active partner ("socio") check; defaults to server/workspace-access.ts. */
  isPartner?: (userId: string) => Promise<boolean>;
} = {}) {
  const councilInstance = () => dependencies.council ?? getAgentCouncil();
  const requestUserId = dependencies.requestUserId ?? getCurrentUserId;
  const ownerUserId = dependencies.ownerUserId ?? getSystemUserId;
  const enabled = dependencies.enabled ?? isAgentCouncilEnabled;
  const now = dependencies.now ?? Date.now;
  const readFactoryJobs = dependencies.readFactoryJobs ?? readFactoryJobsReal;
  let factoryCache: { at: number; jobs: FactoryJobRow[] | "unavailable" } | undefined;
  // Minimal projection: stage, status and lease/completion times only. No payloads, results or provider output.
  const liveFactoryJobs = async (owner: string): Promise<FactoryJobRow[] | "unavailable"> => {
    if (factoryCache && now() - factoryCache.at < FACTORY_LIVE_CACHE_MS) return factoryCache.jobs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let jobs: FactoryJobRow[] | "unavailable";
    try {
      const rows = await Promise.race([readFactoryJobs(owner), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("timeout")), FACTORY_LIVE_TIMEOUT_MS); })]);
      jobs = Array.isArray(rows) ? rows.filter(job => job && factoryAgentForStage(job.kind)).slice(0, 100).map(job => ({ id: String(job.id), kind: job.kind, status: job.status, ownerKey: job.ownerKey,
        ...(job.completedAt ? { completedAt: job.completedAt } : {}), ...(job.leaseExpiresAt ? { leaseExpiresAt: job.leaseExpiresAt } : {}) })) : "unavailable";
    } catch { jobs = "unavailable"; } finally { clearTimeout(timer); }
    factoryCache = { at: now(), jobs };
    return jobs;
  };
  const isPartner = dependencies.isPartner ?? (async (userId: string) => (await import("./workspace-access")).isActiveWorkspacePartner(userId));
  const partnerRequest = async (req: Parameters<typeof requestUserId>[0]) => {
    const userId = requestUserId(req);
    return userId !== ownerUserId() && await isPartner(userId);
  };
  // Supervisor KONG (PR #315): owner-only chat and read-only readiness review.
  // It reads the Kong video status; it never edits, publishes or runs commercial orders.
  const kongConversation = createKongSupervisorConversation({
    now: () => Date.now(),
    commit: (change) => councilInstance().updateKongSupervision(change),
    read: () => councilInstance().readKongSupervision(),
    readVideoStatus: async () => {
      const { getPromoVideoStatus } = await import("./promo-video-agent");
      const body = await getPromoVideoStatus(ownerUserId());
      return summarizeProbe(agentProbes["kong-videos"], { ok: true, status: 200, body: JSON.parse(JSON.stringify(body ?? null)) });
    },
  });
  registerKongSupervisorRoutes(app, kongConversation, {
    requestUserId: (req) => {
      try {
        return requestUserId(req);
      } catch {
        return null;
      }
    },
    ownerUserId: () => ownerUserId(),
  });

  app.get("/api/agent-council/state", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const isOwner = requestUserId(req) === ownerUserId();
      const owner = isOwner ? ownerUserId() : "";
      // Owner only: a read-only live lease read (the factory runs in GitHub Actions; this never writes).
      const view = await councilInstance().view(isOwner ? { factoryLiveJobs: await liveFactoryJobs(owner), factoryOwnerKey: createHash("sha256").update(owner).digest("hex") } : undefined);
      const partner = await partnerRequest(req);
      if (!isOwner) {
        view.kongCompany = { version: 1, careers: {}, trainees: [], orders: [], events: [] };
        view.kongLeaderboard = [];
        view.kongPersonalities = {};
        view.kongLastStatuses = {};
        view.kongEvidenceAt = {};
        view.kongObservedAt = null;
        view.kongRead = null;
        view.kongCollaboration = { verified: false, observedAt: null, totalFindings: 0, exchanges: [] };
        view.roleWorkToday = [];
        // Owner-only per-agent chat: orders, hand-off events and hand-off memory never reach other users.
        view.company = redactChatActivity(view.company);
      }
      // Partners see the office (careers, points, battery) but not Robert's orders, memories or details.
      res.json(partner ? redactCouncilViewForPartner(view as unknown as Record<string, unknown>) : view);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to read agent council" });
    }
  });

  app.get("/api/agent-council/internal-work", async (req,res)=>{
    res.set("Cache-Control","no-store");
    try {
      if(requestUserId(req)!==ownerUserId()) return res.status(403).json({error:"Solo el propietario puede leer los resúmenes internos."});
      const state=await councilInstance().load();
      const academy=(state.company?.academyJobs || []).slice(-20).reverse().map(job=>{
        const trainee=state.company.trainees.find(t=>t.id===job.traineeId);
        const assessment=trainee?.assessments?.find(a=>a.runId===job.id);
        return {id:job.id,agentId:trainee?.forAgentId || "unknown",purpose:trainee?.purpose || "candidate",
          policyCurrentlyApplied:Boolean(trainee && state.officeExecution?.roles.roles[trainee.forAgentId]?.activePolicy?.candidateId === trainee.id),
          status:job.status,startedAt:job.startedAt,reason:job.reason,
          benchmarkId:job.benchmarkId,...(assessment?{assessment:{passed:assessment.passed,quality:assessment.quality,incumbentQuality:assessment.incumbentQuality,completedAt:assessment.completedAt,scope:assessment.scope || "benchmark"}}:{})};
      });
      const radioAcademy=(state.officeExecution?.internalWork?.radioTrainingHistory || []).map(receipt=>({id:receipt.id,agentId:"radio",purpose:"incumbent",status:"completed",startedAt:receipt.appliedAt,
        policyCurrentlyApplied:state.officeExecution?.roles.roles.radio?.activePolicy?.version===receipt.appliedPolicyVersion,
        benchmarkId:receipt.evidence.evaluation.profileId,
        reason:`Solo parser de rangos horarios; misma persona y generación. ${receipt.firstVerifiedRunId?"Primera ejecución con registros guardados verificada.":"Primera ejecución con registros guardados todavía no confirmada."}`,
        assessment:{passed:receipt.evidence.evaluation.qualified,quality:Math.min(...receipt.evidence.evaluation.artifacts.map(a=>a.candidateQuality)),incumbentQuality:Math.min(...receipt.evidence.evaluation.artifacts.map(a=>a.baselineQuality)),scope:"benchmark",completedAt:receipt.appliedAt},
      }));
      const roleWork=(state.officeExecution?.roleWork?.jobs || []).slice(-28).reverse().map(job=>({id:job.id,role:job.role,status:job.status,startedAt:job.startedAt,completedAt:job.completedAt,reason:job.reason,artifactId:job.artifactId,audit:job.audit,webAudit:job.webAudit}));
      const capabilityTraining={policies:capabilityTrainingSummary(state.officeExecution?.capabilityTraining,ownerUserId(),Object.fromEntries(Object.entries(state.company.careers).map(([id,career])=>[id,career.generation]))),runs:(state.officeExecution?.capabilityTraining?.runs || []).slice(-28).reverse().map(capabilityRunSummary)};
      return res.json({...state.officeExecution?.internalWork || {version:1,jobs:[]},roleWork,capabilityTraining,roleAcademy:roleAcademySummary(state.officeExecution?.roleAcademy),academy:[...radioAcademy,...academy].sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)).slice(0,20)});
    } catch {return res.status(503).json({error:"No se pudo verificar el trabajo interno."});}
  });

  // CEO channel: Robert writes, the CEO routes the order to the right agents ($0, no AI).
  app.post("/api/agent-company/orders", async (req, res) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text) return res.status(400).json({ error: "Escribe la orden para el CEO." });
      if (text.length > 500) return res.status(400).json({ error: "La orden es muy larga (maximo 500 caracteres)." });
      const council = councilInstance();
      if (req.body?.company !== undefined && !["main", "kong", "blackroom"].includes(req.body.company)) return res.status(400).json({ error: "Empresa no válida." });
      const scope = req.body?.company === "kong" ? "kong" : req.body?.company === "blackroom" ? "blackroom" : "main";
      if (scope === "kong" && requestUserId(req) !== ownerUserId()) return res.status(403).json({ error: "Solo el propietario puede gestionar KONG." });
      const partner = await partnerRequest(req);
      if (partner && scope !== "blackroom") return res.status(403).json({ error: "Solo Robert. Como socio puedes dar ordenes al CEO de Black Room." });
      const state = await council.placeOrder(text, scope, { userId: requestUserId(req), role: partner ? "partner" : requestUserId(req) === ownerUserId() ? "owner" : null });
      res.json({ order: (scope === "kong" ? state.kongCompany : state.company).orders[0] });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "No se pudo crear la orden" });
    }
  });

  app.post("/api/agent-company/orders/:id/done", async (req, res) => {
    try {
      const raw = (req.body as { evidenceRunId?: unknown } | undefined)?.evidenceRunId;
      const evidenceRunId = typeof raw === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(raw) ? raw : undefined;
      if (raw !== undefined && raw !== null && raw !== "" && !evidenceRunId) return res.status(400).json({ error: "Evidencia no valida." });
      if (req.body?.company !== undefined && !["main", "kong", "blackroom"].includes(req.body.company)) return res.status(400).json({ error: "Empresa no válida." });
      const requested = req.body?.company === "kong" ? "kong" : req.body?.company === "blackroom" ? "blackroom" : "main";
      if (requested === "kong" && requestUserId(req) !== ownerUserId()) return res.status(403).json({ error: "Solo el propietario puede gestionar KONG." });
      const partner = await partnerRequest(req);
      if (partner && requested !== "blackroom") return res.status(403).json({ error: "Solo Robert. Como socio puedes cerrar ordenes del equipo de Black Room." });
      if (requested === "blackroom") {
        const current = await councilInstance().load();
        const order = current.company.orders.find((item) => item.id === String(req.params.id));
        if (!order) return res.status(404).json({ error: "Orden no encontrada" });
        if (!isBlackRoomOnlyOrder(order)) return res.status(403).json({ error: "Solo Robert. Esa orden no es del equipo de Black Room." });
        // Partners close by hand (record only, no points): evidence runs belong to Robert's account.
        if (partner && evidenceRunId) return res.status(403).json({ error: "Solo Robert puede cerrar con evidencia." });
      }
      const scope = requested === "kong" ? "kong" : "main";
      const state = await councilInstance().finishOrder(String(req.params.id), evidenceRunId, requestUserId(req), scope);
      res.json({ order: (scope === "kong" ? state.kongCompany : state.company).orders.find((order) => order.id === req.params.id) || null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cerrar la orden";
      res.status(error instanceof OrderEvidenceError ? 422 : message === "Orden no encontrada" ? 404 : 500).json({ error: message });
    }
  });

  app.post("/api/agent-council/run", async (req, res) => {
    try {
      if (await partnerRequest(req)) return res.status(403).json({ error: "Solo Robert puede reunir al consejo." });
    } catch {
      return res.status(503).json({ error: "No se pudo verificar el acceso." });
    }
    try {
      if (!enabled()) {
        return res.status(409).json({ error: "El consejo esta apagado (AGENT_COUNCIL_ENABLED=false)." });
      }
      setAgentCouncilUser(ownerUserId());
      const council = councilInstance();
      const current = await council.load();
      const last = current.lastCycleAt ? Date.parse(current.lastCycleAt) : 0;
      if (Date.now() - last < MANUAL_RUN_MIN_INTERVAL_MS) {
        return res.status(429).json({ error: "El consejo acaba de reunirse; espera un minuto." });
      }
      if (requestUserId(req) !== ownerUserId()) return res.status(403).json({ error: "Solo el propietario puede ejecutar el consejo." });
      await council.runCycle({ force: true });
      res.json(await council.view());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to run agent council" });
    }
  });
}
import {roleAcademySummary} from "./office-role-academy";
