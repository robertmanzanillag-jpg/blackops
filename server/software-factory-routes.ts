import {readFactoryOrderProposals,readFactoryRecoveredBuild} from "./software-factory-order-evidence";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { getAuthenticatedCurrentUserId, getSystemUserId } from "./user-context";
import { officeSameOrigin } from "./office-routes";
import type { FactoryJob } from "./software-factory-store";
import type { FactoryPipelineState } from "./software-factory-pipeline";
import type { SoftwareFactoryView } from "../shared/software-factory-view";
import { FACTORY_POLICY, projectReadiness, proposalReadiness } from "./software-factory";
import { configuredSoftwareFactoryStore as softwareFactoryStore } from "./software-factory-store-provider";
import { companyOrderJob } from "./software-factory-company";
import type { CompanyOrder } from "../shared/agent-company";
import type {FactoryOfficeAdmission} from "./software-factory-office-connection";
import type { OfficeRun } from "./office-runtime";
import { linkFactoryOfficeReviews } from "./software-factory-office-review";

function pipelineState(job: FactoryJob): FactoryPipelineState | undefined {
  const result = job.result as { evidence?: { pipelineState?: FactoryPipelineState } } | undefined;
  const state = result?.evidence?.pipelineState;
  return state?.version === 1 && state.projectId === job.projectId && state.candidate?.projectId === job.projectId && state.candidate.headSha === job.headSha ? state : undefined;
}
function healthyVerification(job: FactoryJob, target: "production" | "staging") {
  const state = pipelineState(job);
  return job.kind === "verify" && job.status === "completed" && state?.target === target && state.verification?.healthy === true && state.verification.headSha === state.candidate?.headSha && state.deployment?.headSha === state.candidate?.headSha && state.deployment?.target === target;
}

function requireOwner(req: Request, res: Response): string | null {
  res.set("Cache-Control", "no-store");
  const id = getAuthenticatedCurrentUserId(req);
  if (!id) { res.status(401).json({ error: "Inicia sesión para consultar la fábrica." }); return null; }
  if (id !== getSystemUserId()) { res.status(403).json({ error: "La fábrica pertenece al propietario configurado." }); return null; }
  return id;
}

const pauseSchema = z.object({ paused: z.boolean() }).strict();
const projectSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  testCommand: z.string().trim().min(1).max(2000), buildCommand: z.string().trim().min(1).max(2000),
  stagingUrl: z.string().url().max(2000), productionUrl: z.string().url().max(2000), healthUrl: z.string().url().max(2000),
  rollbackCommand: z.string().trim().min(1).max(2000), journeys: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
}).strict();
const budgetSchema = z.object({ fixedCents: z.number().int().min(0).max(10_000) }).strict();

export function registerSoftwareFactoryRoutes(app: Express, options: {
  store?: Pick<typeof softwareFactoryStore, "status" | "list" | "setPaused" | "initializeMonth" | "projects" | "saveProject"> & Partial<Pick<typeof softwareFactoryStore,"getCompletedJob">>;
  getRecoveredBuild?:typeof readFactoryRecoveredBuild;
  /** Read-only office journal used to link reviewer verdicts to proposals. */
  readOfficeReviews?: (owner: string) => Promise<OfficeRun[]>;
  now?: () => Date;
  resolveCompanyAdmission?:()=>Promise<FactoryOfficeAdmission|undefined>;
  // Installed by the trusted runtime only after the same ledger, credit guard and
  // Asistente worker are connected. Never enabled by a browser request.
  companyAdmission?: { reservationCents: number; readMainOrder(owner: string, id: string): Promise<CompanyOrder | undefined>;
    // Must atomically enforce the verified credit grant and expiry on the worker's
    // existing ledger. Generic monthly-budget enqueue is deliberately insufficient.
    admitWithinCredits: typeof softwareFactoryStore.enqueue };
} = {}) {
  const store = options.store ?? softwareFactoryStore;
  const now = options.now ?? (() => new Date());
  app.post("/api/software-factory/company-orders", async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;
    if (!officeSameOrigin(req)) return res.status(403).json({ error: "La solicitud debe salir de esta oficina." });
    const input = z.object({ company: z.literal("main"), orderId: z.string().min(1).max(200), projectId: z.string().min(1).max(100) }).strict().safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: "Selecciona una orden de la empresa principal y su proyecto." });
    let admission=options.companyAdmission;
    try { admission=admission || await options.resolveCompanyAdmission?.(); } catch { return res.status(503).json({error:"La conexión de la fábrica requiere revisión. No se ha admitido la orden."}); }
    if (!admission || typeof admission.admitWithinCredits !== "function") return res.status(503).json({ error: "El ejecutor de Asistente aún no está conectado. No se ha enviado ni cobrado la orden." });
    try {
      const project = (await store.projects(owner)).find(p => p.id === input.data.projectId);
      const order = await admission.readMainOrder(owner, input.data.orderId);
      if (!project || !order) return res.status(404).json({ error: "Orden o proyecto no disponible." });
      if (order.id !== input.data.orderId) throw Error("FACTORY_COMPANY_ORDER_MISMATCH");
      const job = await admission.admitWithinCredits(owner, companyOrderJob(order, project, admission.reservationCents));
      res.status(202).json({ jobId: job.id, status: job.status, orderId: order.id, delivered: false });
    } catch { res.status(409).json({ error: "No se confirmó la admisión. Revisa el alcance de la orden, el presupuesto y la conexión del ejecutor." }); }
  });
  app.get("/api/software-factory", async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;
    try {
      const [state, jobs, projects] = await Promise.all([store.status(owner), store.list(owner), store.projects(owner)]);
      const blockers: string[] = [];
      if (!state.configured) blockers.push("Registra el coste fijo del mes antes de ejecutar trabajos.");
      const remainingCents = Math.max(0, state.limitCents - state.fixedCents - state.spentCents - state.reservedCents);
      if (state.configured && remainingCents === 0) blockers.push("El presupuesto mensual está agotado o comprometido.");
      const stages = ["discover", "build", "simulate", "review", "deploy", "verify", "rollback", "evaluate"] as const;
      const activeWorkers = state.workers.filter(worker => {
        const seen = worker.last_seen_at;
        if (!(seen instanceof Date) && typeof seen !== "string" && typeof seen !== "number") return false;
        const age = now().getTime() - new Date(seen).getTime();
        return Number.isFinite(age) && age >= -30000 && age <= 45000;
      });
      if (!activeWorkers.length) blockers.push("No hay señal reciente del ejecutor de la fábrica.");
      const capabilities = stages.every(stage => activeWorkers.some(worker => {
        const reported = worker.capabilities;
        return reported !== null && typeof reported === "object" && !Array.isArray(reported)
          && (reported as Record<string, unknown>)[stage] === true;
      }));
      if (!capabilities) blockers.push("Faltan ejecutores configurados para completar todas las etapas.");
      if (!projects.length) blockers.push("Registra una aplicación con su entorno de ensayo y recuperación.");
      const eligible = projects.some(project => {
        const proofAge = now().getTime() - Date.parse(project.rollbackVerifiedAt ?? "");
        return projectReadiness(project).allowed && project.automaticRelease && new Set(project.rehearsalRunIds).size >= FACTORY_POLICY.minimumRehearsals && Number.isFinite(proofAge) && proofAge >= 0 && proofAge <= FACTORY_POLICY.evidenceMaxAgeMs;
      });
      if (projects.length && !eligible) blockers.push("La publicación automática requiere ensayos y recuperación verificados de una aplicación.");
      // Review-only (PR proposal) mode is reported separately. It never relaxes the
      // publication readiness above: deploy/verify/rollback/evaluate stay required there.
      const proposalBlockers: string[] = [];
      if (!state.configured) proposalBlockers.push("Registra el coste fijo del mes antes de ejecutar trabajos.");
      if (state.configured && remainingCents === 0) proposalBlockers.push("El presupuesto mensual está agotado o comprometido.");
      if (!activeWorkers.length) proposalBlockers.push("No hay señal reciente del ejecutor de la fábrica.");
      const proposalStages = ["discover", "build", "simulate", "review"] as const;
      if (activeWorkers.length && !proposalStages.every(stage => activeWorkers.some(worker => {
        const reported = worker.capabilities;
        return reported !== null && typeof reported === "object" && !Array.isArray(reported) && (reported as Record<string, unknown>)[stage] === true;
      }))) proposalBlockers.push("Faltan ejecutores de propuestas (descubrir, construir, simular y revisar).");
      if (!projects.some(project => proposalReadiness(project).allowed)) proposalBlockers.push("Registra una aplicación con repositorio, comandos de pruebas y construcción, y recorridos.");
      const proposalEvidence=store.getCompletedJob ? await readFactoryOrderProposals({owner,jobs,projects,getCompletedJob:(key,id)=>store.getCompletedJob!(key,id),getRecoveredBuild:options.getRecoveredBuild??(options.store?undefined:readFactoryRecoveredBuild),now:now().getTime()}) : {proposals:[],status:"unavailable" as const};
      let officeRuns: OfficeRun[] | undefined;
      const readOfficeReviews = options.readOfficeReviews ?? (options.store ? undefined : async (id: string) => (await import("./office-runtime")).officeRuntime.list(id));
      if (proposalEvidence.proposals.length && readOfficeReviews) { try { officeRuns = await readOfficeReviews(owner); } catch { officeRuns = undefined; } }
      const view: SoftwareFactoryView = {
        reviewedProposals:readOfficeReviews ? linkFactoryOfficeReviews(owner,proposalEvidence.proposals,officeRuns) : proposalEvidence.proposals,proposalEvidenceStatus:proposalEvidence.status,
        checkedAt: now().toISOString(), paused: state.paused,
        readiness: state.paused ? "paused" : blockers.length ? "blocked" : "available", blockers,
        proposal: { mode: "review-only", readiness: state.paused ? "paused" : proposalBlockers.length ? "blocked" : "available", blockers: proposalBlockers },
        budget: { month: state.month, limitCents: state.limitCents, fixedCents: state.fixedCents, spentCents: state.spentCents, reservedCents: state.reservedCents, remainingCents, configured: state.configured },
        metrics: {
          verifiedDeliveries: jobs.filter(job => healthyVerification(job, "production")).length,
          stagingVerifications: jobs.filter(job => healthyVerification(job, "staging")).length,
          regressions: jobs.filter(job => { const state = pipelineState(job); return job.kind === "verify" && job.status === "completed" && state?.verification && (state.verification.healthy !== true || state.verification.headSha !== state.candidate?.headSha); }).length,
          humanInterventions: null,
          rollbacks: jobs.filter(job => { const state = pipelineState(job); return job.kind === "rollback" && job.status === "completed" && state?.rollback?.healthy === true && state.rollback.restoredSha === state.candidate?.baseSha; }).length,
          blockedJobs: jobs.filter(job => job.status === "blocked" || job.status === "unknown").length,
          completedJobs: jobs.filter(job => job.status === "completed").length,
          averageCompletedCostCents: (() => {
            const completed = jobs.filter(job => job.status === "completed");
            const costs = completed.map(job => job.result && typeof job.result === "object" && "costCents" in job.result ? job.result.costCents : undefined);
            return costs.length && costs.every((cost): cost is number => typeof cost === "number" && Number.isSafeInteger(cost) && cost >= 0) ? Math.round(costs.reduce((sum, cost) => sum + cost, 0) / costs.length) : null;
          })(),
        },
        projects: projects.map(project => ({ id: project.id, repo: project.repo, readiness: projectReadiness(project).reasons, proposalReadiness: proposalReadiness(project).reasons, automaticRelease: project.automaticRelease })),
        jobs: jobs.slice(0, 50).map(job => {
          const result = job.result && typeof job.result === "object" ? job.result as Record<string, unknown> : {};
          const costCents = typeof result.costCents === "number" && Number.isSafeInteger(result.costCents) && result.costCents >= 0 ? result.costCents : null;
          const evidenceCount = Array.isArray(result.evidence) ? result.evidence.length : result.evidence && typeof result.evidence === "object" ? 1 : 0;
          const blocker = typeof result.reason === "string" && result.reason.startsWith("FACTORY_ADAPTER_UNAVAILABLE:") ? "Falta conectar el ejecutor de esta etapa." : job.status === "unknown" ? "Hay que reconciliar el resultado antes de continuar." : job.status === "blocked" ? "No se cumplieron los requisitos de ejecución o verificación." : undefined;
          // Static internal outcome codes only (FACTORY_* or snake_case gate reasons); any other text stays hidden.
          const reasonCode = job.status !== "completed" && typeof result.reason === "string" && result.reason.length <= 300 && result.reason.split(",").every(token => /^FACTORY_[A-Z0-9_]{1,100}(:[A-Za-z0-9_]{1,100})?$|^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(token)) ? result.reason : undefined;
          return { costCents, evidenceCount, ...(blocker ? { blocker } : {}), ...(reasonCode ? { reasonCode } : {}), id: job.id, projectId: job.projectId, kind: job.kind, status: job.status, createdAt: job.createdAt, ...(job.headSha ? { headSha: job.headSha } : {}) }; }),
      };
      res.json(view);
    } catch { res.status(503).json({ error: "No se pudo verificar el registro persistente de la fábrica. No se confirma actividad." }); }
  });
  app.post("/api/software-factory/projects", async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;
    if (!officeSameOrigin(req)) return res.status(403).json({ error: "La solicitud debe salir de esta oficina." });
    const input = projectSchema.safeParse(req.body);
    if (!input.success || (input.success && input.data.stagingUrl === input.data.productionUrl)) return res.status(400).json({ error: "Completa la aplicación y usa un entorno de ensayo diferente de producción. No se admiten pruebas de habilitación manuales." });
    try {
      const project = await store.saveProject(owner, { ...input.data, automaticRelease: false, providerSupportsRelease: false, providerSupportsRollback: false, rehearsalRunIds: [] });
      res.status(201).json({ id: project.id, automaticRelease: false });
    } catch { res.status(503).json({ error: "No se confirmó el registro de la aplicación." }); }
  });
  app.post("/api/software-factory/pause", async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;
    if (!officeSameOrigin(req)) return res.status(403).json({ error: "La solicitud debe salir de esta oficina." });
    const input = pauseSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: "Indica si deseas pausar la fábrica." });
    try { await store.setPaused(owner, input.data.paused); res.json({ paused: input.data.paused }); }
    catch { res.status(503).json({ error: "No se confirmó el cambio de pausa. Comprueba el estado antes de continuar." }); }
  });
  app.post("/api/software-factory/budget", async (req, res) => {
    const owner = requireOwner(req, res);
    if (!owner) return;
    if (!officeSameOrigin(req)) return res.status(403).json({ error: "La solicitud debe salir de esta oficina." });
    const input = budgetSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: "El coste fijo debe estar entre 0 y 100 USD, expresado en centavos." });
    try {
      const month = now().toISOString().slice(0, 7);
      await store.initializeMonth(owner, month, input.data.fixedCents);
      res.json({ month, configured: true });
    } catch { res.status(409).json({ error: "No se confirmó el presupuesto. El coste fijo no puede reemplazarse después de registrar el mes." }); }
  });
}
