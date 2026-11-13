import fs from "node:fs";
import {AsyncLocalStorage} from "node:async_hooks";
import path from "node:path";
import { z } from "zod";
import { getDropshippingCeoSnapshot } from "./dropshipping-ceo";

type MarketingClientStatus = "ready" | "active" | "needs_setup" | "needs_data" | "approval_locked" | "paused";
type MarketingClientPriority = "high" | "medium" | "low";

export const marketingCommandCenterDaySchema = z.object({
  focusClientId: z.string().trim().min(1).max(80).optional().default("all"),
});

type MarketingCommandCenterDayInput = z.infer<typeof marketingCommandCenterDaySchema>;

type MarketingLearningRun = {
  id: string;
  createdAt: string;
  focusClientId: string;
  clientsReviewed: number;
  improvementsQueued: string[];
  rulesUpdated: string[];
  safetyBlocks: string[];
  summary: string;
};

type MarketingClient = {
  id: string;
  name: string;
  clientType: "business" | "content_brand" | "internal_product" | "personal_brand" | "future_slot";
  ownerAgent: string;
  sourceAgent: string;
  status: MarketingClientStatus;
  priority: MarketingClientPriority;
  separationKey: string;
  detectedSources?: string[];
  marketingCapabilities?: string[];
  handoff?: {
    status: "ready" | "draft_only" | "needs_setup";
    inbound: string[];
    outbound: string[];
    dataBoundary: string;
  };
  mission: string;
  primaryAudience: string;
  channels: string[];
  currentFocus: string;
  budgetPolicy: {
    monthlyCapUsd: number;
    currentSpendUsd: number;
    spendMode: "organic_first" | "draft_only" | "approval_only" | "paused";
    rule: string;
  };
  approvalPolicy: {
    canDraftAutonomously: string[];
    requiresApproval: string[];
    blockedAlways: string[];
  };
  metrics: {
    revenueUsd: number;
    spendUsd: number;
    orders: number;
    campaigns: number;
    posts: number;
    signals: number;
    roas: number | null;
  };
  playbook: {
    brandVoice: string;
    contentPillars: string[];
    offerAngles: string[];
    postingCadence: string;
    successMetrics: string[];
  };
  nextActions: string[];
  risks: string[];
  learningRules: string[];
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

let learningRunsPathOverride: string | null = null;
let learningRunsLoaded = false;
const learningRuns: MarketingLearningRun[] = [];
const learningContext=new AsyncLocalStorage<{owner:string;runs:MarketingLearningRun[];id?:string;at?:string}>();
const currentRuns=()=>learningContext.getStore()?.runs || learningRuns;
export const marketingRequiresPostgres=()=>process.env.NODE_ENV==="production"||process.env.REPLIT_DEPLOYMENT==="1"||process.env.AGENT_COUNCIL_STORAGE==="postgres";
export function withMarketingLearningContext<T>(owner:string,runs:MarketingLearningRun[],work:()=>T,identity?:{id:string;at:string}):T{
 if(!owner.trim())throw Error("MARKETING_OWNER_REQUIRED");
 return learningContext.run({owner,runs:structuredClone(runs),...identity},work);
}


const marketingLearningRunPersistedSchema: z.ZodType<MarketingLearningRun, z.ZodTypeDef, unknown> = z.object({
  id: z.string(),
  createdAt: z.string(),
  focusClientId: z.string(),
  clientsReviewed: z.number(),
  improvementsQueued: z.array(z.string()),
  rulesUpdated: z.array(z.string()),
  safetyBlocks: z.array(z.string()),
  summary: z.string(),
});

function getLearningRunsPath() {
  return learningRunsPathOverride || process.env.MARKETING_COMMAND_CENTER_LEARNING_PATH || path.join(process.cwd(), "marketing_command_center_data", "learning-runs.json");
}

function readLearningRuns() {
  const filePath = getLearningRunsPath();
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = z.array(marketingLearningRunPersistedSchema).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("Marketing command center learning data is invalid.");
  return parsed.data;
}

function writeLearningRuns(items: MarketingLearningRun[]) {
  const filePath = getLearningRunsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

function loadLearningRuns() {
  if(learningContext.getStore())return;
  if(marketingRequiresPostgres())throw Error("MARKETING_DURABLE_CONTEXT_REQUIRED");
  if (learningRunsLoaded) return;
  learningRuns.splice(0, learningRuns.length, ...readLearningRuns());
  learningRunsLoaded = true;
}

function persistLearningRuns() {
  if(learningContext.getStore())return;
  writeLearningRuns(learningRuns);
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function safeSnapshot<T>(producer: () => T): T | null {
  try {
    return producer();
  } catch {
    return null;
  }
}

function learningRulesForClient(clientId: string, fallback: string[]) {
  const learnedRules = currentRuns()
    .filter((run) => run.focusClientId === "all" || run.focusClientId === clientId)
    .slice(-3)
    .flatMap((run) => run.rulesUpdated)
    .filter((rule) => rule.toLowerCase().includes(clientId.replace(/-/g, " ")) || rule.toLowerCase().includes("cliente") || runFocusMatchesRule(clientId, rule));
  return [...new Set([...learnedRules, ...fallback])].slice(0, 5);
}

function runFocusMatchesRule(clientId: string, rule: string) {
  const normalized = rule.toLowerCase();
  if (clientId === "black-room" && (normalized.includes("black room") || normalized.includes("radio") || normalized.includes("fiesta") || normalized.includes("flyer") || normalized.includes("promo"))) return true;
  if (clientId === "dropshipping" && normalized.includes("dropshipping")) return true;
  if (clientId === "kong" && normalized.includes("kong")) return true;
  if (clientId === "clipping" && normalized.includes("clip")) return true;
  return false;
}

function withReadyHandoff(client: MarketingClient): MarketingClient {
  const sourceMap: Record<string, string[]> = {
    "black-room": [
      "server/radio-agent.ts",
      "server/radio-template-agent.ts",
      "server/promo-video-agent.ts",
      "server/radio-video-edit-agent.ts",
      "server/blackroom-links.ts",
      "client/src/pages/radio.tsx",
      "client/src/pages/promo-video.tsx",
      "client/src/components/flyer-generator.tsx",
    ],
    dropshipping: ["server/dropshipping-ceo.ts", "client/src/pages/dropshipping-ceo.tsx"],
    kong: ["server/assistant.ts", "server/google-drive.ts", "client/src/pages/projects.tsx"],
    clipping: ["server/clippers-agent.ts", "client/src/pages/clippers.tsx"],
  };
  const capabilityMap: Record<string, string[]> = {
    "black-room": ["fiesta campaigns", "radio calendar", "flyers/templates", "promo videos", "event links", "DJ/promoter copy"],
    dropshipping: ["product hooks", "organic posts", "campaign drafts", "social metrics", "paid ads guard"],
    kong: ["venue messages", "promoter scripts", "table/reservation copy", "event notices", "privacy-safe follow-up"],
    clipping: ["clip captions", "account positioning", "source permission checks", "metrics import", "viral format tests"],
  };
  return {
    ...client,
    status: "ready",
    detectedSources: sourceMap[client.id] || [client.sourceAgent],
    marketingCapabilities: capabilityMap[client.id] || ["strategy", "content drafts", "analytics", "approval handoff"],
    handoff: {
      status: "ready",
      inbound: ["objetivo", "audiencia", "asset/contexto", "canales", "budget", "restricciones", "metricas"],
      outbound: ["brief", "posts", "hooks", "calendario", "risk check", "approval request", "learning rules"],
      dataBoundary: `${client.separationKey}: presupuesto, cuentas, assets, metricas y approvals separados.`,
    },
  };
}

function buildMarketingClients(): MarketingClient[] {
  const dropshipping = learningContext.getStore()?null:safeSnapshot(getDropshippingCeoSnapshot);
  const dropshippingMetrics = dropshipping?.metrics;
  const dropshippingSpend = dropshippingMetrics?.socialSpendUsd || 0;
  const dropshippingRevenue = dropshippingMetrics?.socialRevenueUsd || dropshippingMetrics?.totalRevenueUsd || 0;

  const coreClients: MarketingClient[] = [
    {
      id: "black-room",
      name: "Black Room (Fiesta + Radio)",
      clientType: "content_brand",
      ownerAgent: "Black Room / Radio",
      sourceAgent: "black-room",
      status: "ready",
      priority: "high",
      separationKey: "client:black-room",
      mission: "Manejar todo el marketing de Black Room: fiestas, radio, flyers, promo videos, links, stories y calendario de eventos.",
      primaryAudience: "Audiencia local de nightlife, DJs, promoters, venues, invitados y personas que reservan o entran por guestlist.",
      channels: ["Instagram", "TikTok", "Stories", "Flyers", "Promo videos", "Event links"],
      currentFocus: "Unificar fiestas y radio en un solo cliente con calendario, assets, links, copy y metricas por evento.",
      budgetPolicy: {
        monthlyCapUsd: 0,
        currentSpendUsd: 0,
        spendMode: "draft_only",
        rule: "Sin gasto automatico; crear assets y campanas en draft hasta approval por evento/canal.",
      },
      approvalPolicy: {
        canDraftAutonomously: ["copy de fiesta/radio", "flyers", "promo video briefs", "story plan", "DJ/promoter checklist", "link share copy"],
        requiresApproval: ["publicar", "usar imagen/audio/video de terceros", "contactar promoter", "hacer paid boost", "compartir link publico"],
        blockedAlways: ["usar media sin derechos", "anunciar fecha/venue/lineup sin confirmar", "prometer guestlist/acceso no aprobado"],
      },
      metrics: { revenueUsd: 0, spendUsd: 0, orders: 0, campaigns: 0, posts: 0, signals: 0, roas: null },
      playbook: {
        brandVoice: "Nightlife premium, claro, visual, con urgencia real y texto legible.",
        contentPillars: ["fiesta/evento", "radio/DJ slots", "flyers", "promo videos", "links/guestlist", "recaps"],
        offerAngles: ["guestlist open", "reserve your spot", "lineup ready", "tonight", "DM for access"],
        postingCadence: "Por evento: 7/3/1 dias antes, day-of y recap; radio/flyers segun calendario.",
        successMetrics: ["DMs", "clicks", "saves", "shares", "RSVPs", "attendance signal"],
      },
      nextActions: ["Crear calendario unico para fiesta y radio.", "Mantener flyers, promo videos y links como assets internos del mismo cliente.", "Registrar metricas por evento/post para que el CMO aprenda."],
      risks: ["copyright", "fecha/venue/lineup incorrecto", "link equivocado", "asset no aprobado", "publicar sin approval"],
      learningRules: learningRulesForClient("black-room", ["Black Room agrupa fiesta y radio; cada evento necesita fecha, venue, asset, CTA, link y approval antes de publicarse."]),
    },
    {
      id: "dropshipping",
      name: "Dropshipping",
      clientType: "business",
      ownerAgent: "Dropshipping CEO",
      sourceAgent: "dropshipping-ceo",
      status: "ready",
      priority: "high",
      separationKey: "client:dropshipping",
      mission: "Generar ventas de productos sin inventario, con contenido organico primero y gasto solo cuando Profit Guard lo permita.",
      primaryAudience: dropshipping?.marketingDepartment?.activeBrief?.primaryAudience || "Compradores impulsivos que quieren resolver problemas diarios.",
      channels: ["TikTok", "Instagram Reels", "YouTube Shorts", "Shopify SEO", "Email"],
      currentFocus: dropshipping?.marketingDepartment?.scorecard?.nextAction || "Elegir producto foco y crear batch organico.",
      budgetPolicy: {
        monthlyCapUsd: 100,
        currentSpendUsd: roundMoney(dropshippingSpend),
        spendMode: dropshippingSpend > dropshippingRevenue ? "paused" : "organic_first",
        rule: "No gastar mas de cash cobrado; ads solo con approval y evidencia de conversion.",
      },
      approvalPolicy: {
        canDraftAutonomously: ["hooks", "captions", "calendario organico", "briefs de UGC", "analisis de posts"],
        requiresApproval: ["publicar", "activar ads", "usar assets externos", "ordenar sample", "contactar proveedor"],
        blockedAlways: ["comprar inventario al por mayor", "prometer shipping no verificado", "usar marcas/copyright sin permiso"],
      },
      metrics: {
        revenueUsd: roundMoney(dropshippingRevenue),
        spendUsd: roundMoney(dropshippingSpend),
        orders: dropshippingMetrics?.socialOrders || dropshippingMetrics?.orders || 0,
        campaigns: dropshippingMetrics?.marketingCampaigns || 0,
        posts: dropshippingMetrics?.socialPosts || 0,
        signals: dropshippingMetrics?.queuedSocialPosts || dropshippingMetrics?.publishedSocialPosts || 0,
        roas: dropshippingSpend > 0 ? roundMoney(dropshippingRevenue / dropshippingSpend) : null,
      },
      playbook: {
        brandVoice: "Directo, claro, prueba visual, cero promesas exageradas.",
        contentPillars: ["problema visible", "antes/despues", "prueba social", "objeciones de shipping/precio"],
        offerAngles: ["resuelve dolor diario", "precio claro", "envio transparente", "producto probado antes de escalar"],
        postingCadence: "2-4 drafts organicos por dia hasta tener senales.",
        successMetrics: ["orders", "profit", "click-through", "hook retention", "refund risk"],
      },
      nextActions: [dropshipping?.marketingDepartment?.scorecard?.nextAction || "Crear batch organico de validacion.", "Separar posts por hook y canal para medir ganador.", "Pedir approval antes de publicar o gastar."],
      risks: ["claims de producto", "shipping lento", "proveedor sin backup", "gasto antes de ventas"],
      learningRules: learningRulesForClient("dropshipping", ["Organico primero; paid test solo si hay cash, margen y approval.", "Matar hooks sin clicks o sin add-to-cart despues de datos suficientes."]),
    },
    {
      id: "kong",
      name: "Kong",
      clientType: "internal_product",
      ownerAgent: "KONG AI",
      sourceAgent: "kong",
      status: "ready",
      priority: "high",
      separationKey: "client:kong",
      mission: "Manejar marketing de Kong para venues, promoters, mesas, reservas, eventos y mensajes operativos aprobados.",
      primaryAudience: "Promoters, venues, clientes de mesas y asistentes.",
      channels: ["Instagram", "WhatsApp drafts", "Email", "Event pages", "In-app notices"],
      currentFocus: "Definir segmentos y mensajes por venue/promoter sin usar datos personales sin approval.",
      budgetPolicy: {
        monthlyCapUsd: 0,
        currentSpendUsd: 0,
        spendMode: "draft_only",
        rule: "Sin mensajes externos hasta conectar contexto oficial y approvals.",
      },
      approvalPolicy: {
        canDraftAutonomously: ["event copy", "promoter message drafts", "FAQ", "follow-up scripts"],
        requiresApproval: ["contactar usuarios", "publicar evento", "usar datos de cliente", "hacer campana pagada"],
        blockedAlways: ["exponer datos personales", "prometer disponibilidad no confirmada"],
      },
      metrics: { revenueUsd: 0, spendUsd: 0, orders: 0, campaigns: 0, posts: 0, signals: 0, roas: null },
      playbook: {
        brandVoice: "Premium, claro, operativo, enfocado en reservas y confianza.",
        contentPillars: ["venue", "mesa", "experiencia", "promoter proof", "urgencia real"],
        offerAngles: ["reserva facil", "evento correcto", "seguimiento sin perder leads"],
        postingCadence: "Por evento y por venue, con checklist antes de publicar.",
        successMetrics: ["reservas", "responses", "show-up", "promoter confirmations"],
      },
      nextActions: ["Definir segmentos principales.", "Crear plantillas de mensaje por evento.", "Conectar Legal/Control para datos personales."],
      risks: ["privacidad", "datos incorrectos", "contacto sin permiso"],
      learningRules: learningRulesForClient("kong", ["Todo mensaje externo de Kong necesita segmento, CTA y permiso claro."]),
    },
    {
      id: "clipping",
      name: "Clipping",
      clientType: "content_brand",
      ownerAgent: "Clippers",
      sourceAgent: "clippers",
      status: "ready",
      priority: "high",
      separationKey: "client:clipping",
      mission: "Escalar clips con fuentes permitidas, cuentas separadas, metricas importadas y cero riesgo de strikes innecesarios.",
      primaryAudience: "Audiencias de clips por nicho: deportes, cultura, streamers, memes o highlights con permiso.",
      channels: ["TikTok", "Instagram Reels", "YouTube Shorts"],
      currentFocus: "Preparar sistema de cuentas, fuentes permitidas y metrics loop.",
      budgetPolicy: {
        monthlyCapUsd: 0,
        currentSpendUsd: 0,
        spendMode: "approval_only",
        rule: "No publicar ni crear cuentas externas sin permisos oficiales y approval.",
      },
      approvalPolicy: {
        canDraftAutonomously: ["caption drafts", "account positioning", "source checklists", "metrics templates"],
        requiresApproval: ["crear cuentas", "publicar clips", "usar fuente", "OAuth", "automatizar uploads"],
        blockedAlways: ["usar material sin permiso", "imitar marcas oficiales", "repostear contenido protegido sin rights"],
      },
      metrics: { revenueUsd: 0, spendUsd: 0, orders: 0, campaigns: 0, posts: 0, signals: 0, roas: null },
      playbook: {
        brandVoice: "Rapido, claro, nicho especifico, orientado a retencion.",
        contentPillars: ["hook inmediato", "momento fuerte", "contexto minimo", "loop final", "CTA suave"],
        offerAngles: ["watch time", "series", "cuenta por nicho", "repost permissionado"],
        postingCadence: "Drafts diarios; publicar solo despues de rights/connectors.",
        successMetrics: ["views", "retention", "shares", "strikes", "source permission rate"],
      },
      nextActions: ["Separar cuentas por nicho.", "Crear allowlist de fuentes.", "Importar metricas para activar optimizer."],
      risks: ["copyright", "strikes", "cuentas bloqueadas", "fuentes no permitidas"],
      learningRules: learningRulesForClient("clipping", ["Ningun clip escala sin fuente permitida y metricas importadas."]),
    },
  ];

  return coreClients.map(withReadyHandoff).map(client=>learningContext.getStore()?{...client,status:"needs_data" as const,handoff:client.handoff?{...client.handoff,status:"needs_setup" as const}:undefined}:client);
}

function buildSubagents(activeClients: number) {
  return [
    ["market-researcher", "Market Researcher", "Detecta audiencia, competidores, tendencias y oportunidades por cliente.", "active"],
    ["brand-strategist", "Brand Strategist", "Mantiene tono, posicionamiento y reglas de marca separadas por cliente.", "active"],
    ["offer-architect", "Offer Architect", "Convierte productos/servicios en ofertas claras con CTA y objeciones.", "active"],
    ["content-strategist", "Content Strategist", "Crea pilares, calendario y batches multicanal.", "active"],
    ["hook-copywriter", "Hook & Copywriter", "Escribe hooks, captions, scripts, CTAs y variaciones A/B.", "active"],
    ["creative-producer", "Creative Producer", "Genera briefs visuales, shot lists, UGC briefs y asset requests.", "draft_only"],
    ["social-scheduler", "Social Scheduler", "Organiza cola, frecuencia, approvals y estado por canal.", "approval_locked"],
    ["seo-distribution", "SEO / Distribution", "Adapta contenido a busqueda, keywords, hashtags y canales.", "active"],
    ["ads-strategist", "Paid Ads Strategist", "Prepara tests pagados con cap, kill-switch y Profit Guard.", "approval_locked"],
    ["analytics-attribution", "Analytics & Attribution", "Lee metricas, UTMs, ROAS, conversiones y senales por cliente.", "needs_signal"],
    ["cro-funnel", "CRO / Funnel QA", "Revisa landing, checkout, formularios, confianza y friccion.", "active"],
    ["retention-crm", "Retention / CRM", "Crea email/SMS/FAQ/follow-up drafts sin contactar hasta approval.", "draft_only"],
    ["community-listening", "Community Listening", "Convierte comentarios, DMs y objeciones en contenido y FAQ.", "needs_signal"],
    ["brand-legal-safety", "Brand / Legal Safety", "Bloquea claims, copyright, politicas, privacidad y mensajes riesgosos.", "active"],
    ["learning-optimizer", "Learning Optimizer", "Actualiza reglas, mata tests malos y repite ganadores.", activeClients > 0 ? "active" : "needs_signal"],
  ].map(([id, name, role, status]) => ({
    id,
    name,
    role,
    status,
    currentFocus:
      id === "learning-optimizer"
        ? `Revisando ${activeClients} cliente(s) activos y separando aprendizajes por cuenta.`
        : "Listo para trabajar por cliente sin mezclar cuentas, dinero ni metricas.",
    autonomousOutputs: ["drafts internos", "briefs", "calendarios", "analisis", "playbook updates"],
    approvalGates: ["publicar", "gastar", "contactar personas", "usar credenciales", "usar assets externos"],
  }));
}

function buildSkillStack() {
  return [
    ["audience-research", "Audience Research", "research", "ICP, dolores, objeciones, comunidades y lenguaje real."],
    ["competitor-intelligence", "Competitor Intelligence", "research", "Comparar competidores, ofertas, hooks, precios y formatos."],
    ["positioning", "Positioning", "strategy", "Definir promesa, diferenciador, proof y limite de claims."],
    ["offer-design", "Offer Design", "strategy", "Crear oferta, CTA, bonos, objeciones y pricing framing."],
    ["hook-copywriting", "Hook Copywriting", "creative", "Hooks, captions, scripts, headlines, CTAs y A/B variants."],
    ["ugc-briefing", "UGC Briefing", "creative", "Briefs para videos, shot lists, demos y pruebas visuales."],
    ["content-calendar", "Content Calendar", "ops", "Plan por cliente, canal, fecha, estado y approval."],
    ["social-seo", "Social SEO", "distribution", "Keywords, hashtags, search intent y metadata por plataforma."],
    ["paid-ads-profit-guard", "Paid Ads Profit Guard", "paid", "Budget caps, kill-switch, ROAS, cash collected y approval gates."],
    ["cro-funnel-audit", "CRO Funnel Audit", "conversion", "Landing, checkout, trust, forms, speed y friccion."],
    ["analytics-attribution", "Analytics Attribution", "analytics", "UTMs, metricas, winners, losers, ROAS y revenue signals."],
    ["experiment-design", "Experiment Design", "analytics", "Hipotesis, sample size simple, test windows y decision rules."],
    ["email-retention", "Email / Retention", "crm", "Flows, FAQ, abandon cart, follow-up y customer education drafts."],
    ["community-ops", "Community Ops", "community", "DM/comment playbooks, objeciones, FAQs y sentiment loops."],
    ["brand-safety", "Brand Safety", "safety", "Claims, copyright, privacy, platform policies y legal handoff."],
    ["automation-ops", "Automation Ops", "systems", "Runs diarios, reportes, queues, approvals y handoffs por Telegram."],
    ["learning-system", "Self-Improvement System", "learning", "Convierte resultados en reglas por cliente sin mezclar aprendizajes."],
  ].map(([id, name, category, usedFor]) => ({
    id,
    name,
    category,
    strength: "core",
    usedFor,
    autonomousOutputs: ["research", "draft", "analysis", "recommendation", "playbook update"],
    approvalGates: ["external action", "spend", "public post", "client contact"],
    improvementSignal: "Se ajusta con metricas reales, approvals y resultados por cliente.",
  }));
}

function buildWorkstreams(clients: MarketingClient[]) {
  return [
    {
      id: "client-intake",
      name: "Client intake",
      status: clients.length > 0 ? "active" : "blocked",
      owner: "Market Researcher",
      output: "Ficha separada por cliente: marca, canales, budget, approvals y metricas.",
      nextMove: "Completar datos faltantes de clientes en needs_setup/needs_data.",
    },
    {
      id: "content-production",
      name: "Content production",
      status: "active",
      owner: "Content Strategist",
      output: "Posts, hooks, scripts, briefs visuales y calendario por cliente.",
      nextMove: "Priorizar clientes high priority y mantener drafts internos.",
    },
    {
      id: "growth-experiments",
      name: "Growth experiments",
      status: clients.some((client) => client.metrics.signals > 0) ? "active" : "needs_data",
      owner: "Learning Optimizer",
      output: "Tests, reglas de kill/scale y aprendizajes por cliente.",
      nextMove: "Recoger metricas antes de recomendar paid scale.",
    },
    {
      id: "legal-safety",
      name: "Legal + safety",
      status: "active",
      owner: "Brand / Legal Safety",
      output: "Bloqueos de claims, copyright, privacidad, platform policy y aprobaciones.",
      nextMove: "Mantener todo gasto/publicacion/contacto detras de approval.",
    },
    {
      id: "reporting",
      name: "Reporting",
      status: "active",
      owner: "Analytics & Attribution",
      output: "Reporte por cliente y resumen ejecutivo para CEO/Telegram.",
      nextMove: "Separar revenue, spend, posts y decisiones por cliente.",
    },
  ];
}

function buildSelfImprovement(clients: MarketingClient[]) {
  const latestRun = currentRuns().at(-1) || null;
  return {
    status: "active",
    cadence: "daily_review_plus_after_each_campaign",
    latestRun,
    loops: [
      {
        id: "daily-learning-loop",
        name: "Daily learning loop",
        status: "active",
        steps: ["leer metricas", "comparar por cliente", "detectar ganador/perdedor", "actualizar regla", "crear siguiente test"],
      },
      {
        id: "weekly-client-review",
        name: "Weekly client review",
        status: "ready",
        steps: ["revisar objetivos", "limpiar canales", "consolidar aprendizajes", "ajustar calendario", "pedir decisiones"],
      },
      {
        id: "safe-scale-loop",
        name: "Safe scale loop",
        status: clients.some((client) => client.metrics.revenueUsd > client.metrics.spendUsd && client.metrics.revenueUsd > 0) ? "ready_after_approval" : "locked_until_signal",
        steps: ["validar revenue", "confirmar margen/cash", "definir cap", "crear kill-switch", "pedir approval"],
      },
    ],
    guardrails: [
      "No publicar, gastar, contactar ni usar credenciales sin approval.",
      "No mezclar metricas, budget, cuentas, audiencia o assets entre clientes.",
      "No usar claims legales, financieros, salud o shipping sin evidencia.",
      "No escalar paid ads sin cash cobrado, objetivo, cap y kill-switch.",
    ],
    improvementQueue: clients.flatMap((client) => client.nextActions.slice(0, 1).map((action) => `${client.name}: ${action}`)).slice(0, 8),
  };
}

function buildDetectedMarketingApps(clients: MarketingClient[]) {
  return clients.map((client) => ({
    clientId: client.id,
    clientName: client.name,
    status: "ready" as const,
    sourceAgent: client.sourceAgent,
    detectedSources: client.detectedSources || [],
    capabilities: client.marketingCapabilities || [],
    dataBoundary: client.handoff?.dataBoundary || `${client.separationKey}: datos separados.`,
  }));
}

export function getMarketingCommandCenterSnapshot() {
  loadLearningRuns();
  const clients = buildMarketingClients();
  const readyClients = clients.filter((client) => client.status === "ready").length;
  const activeClients = clients.filter((client) => client.status === "ready" || client.status === "active" || client.status === "approval_locked").length;
  const totalRevenueUsd = roundMoney(clients.reduce((sum, client) => sum + client.metrics.revenueUsd, 0));
  const totalSpendUsd = roundMoney(clients.reduce((sum, client) => sum + client.metrics.spendUsd, 0));
  const maxClients = 20;

  return {
    generatedAt: new Date().toISOString(),
    cmoAgent: {
      id: "marketing-cmo",
      name: "Marketing CMO",
      scope: "global",
      status: learningContext.getStore()?"needs_data":"active",
      reportsTo: "CEO",
      mandate: "Operar como agencia interna para todos los proyectos: crecer ventas, contenido y demanda sin mezclar clientes ni ejecutar acciones externas sin approval.",
    },
    capacity: {
      maxClients,
      activeClients: learningContext.getStore()?0:clients.length,
      openSlots: Math.max(0, maxClients - clients.length),
      operatingRule: "Puede manejar 20 clientes si cada cliente mantiene presupuesto, cuentas, calendario, metricas y approvals separados.",
    },
    globalScorecard: {
      clients: clients.length,
      readyClients,
      activeClients,
      totalRevenueUsd,
      totalSpendUsd,
      profitSignalUsd: roundMoney(totalRevenueUsd - totalSpendUsd),
      approvalsNeeded: clients.reduce((sum, client) => sum + (client.status === "approval_locked" ? 1 : 0), 0),
      learningRuns: currentRuns().length,
    },
    operatingModel: {
      mission: "Crear demanda y ventas para todos los trabajos de Robert como una agencia interna con subagentes especializados.",
      clientSeparationRules: [
        "Cada cliente tiene separationKey, budget, canales, metricas, approvals y playbook propio.",
        "Un aprendizaje se puede compartir solo como principio general; numeros, cuentas, assets y dinero no se mezclan.",
        "Cada publicacion, gasto, contacto externo u OAuth necesita approval explicito por cliente.",
      ],
      canRunAutonomously: ["research", "strategy", "hooks", "copy drafts", "creative briefs", "calendars", "analytics", "playbook updates", "reports"],
      requiresApproval: ["publicar", "gastar", "contactar clientes/proveedores", "usar credenciales", "usar assets externos", "activar automatizaciones externas"],
      blockedAlways: ["mezclar budgets", "mezclar cuentas", "usar datos privados sin permiso", "prometer resultados garantizados", "publicar contenido con copyright no permitido"],
    },
    subagents: buildSubagents(activeClients).map(agent=>learningContext.getStore()?{...agent,status:"planned"}:agent),
    skillStack: buildSkillStack(),
    clients,
    detectedMarketingApps: buildDetectedMarketingApps(clients).map(app=>learningContext.getStore()?{...app,status:"needs_setup"}:app),
    workstreams: buildWorkstreams(clients).map(work=>learningContext.getStore()?{...work,status:"planned"}:work),
    selfImprovement: learningContext.getStore()?{...buildSelfImprovement(clients),status:"preparation_only",loops:buildSelfImprovement(clients).loops.map(loop=>({...loop,status:"not_executed"}))}:buildSelfImprovement(clients),
    evidence: {mode:learningContext.getStore()?"saved_preparation_only":"legacy_local",metricsVerified:false,externalExecutionVerified:false},
    recentLearningRuns: [...currentRuns()].slice(-8).reverse(),
    executiveSummary: {
      headline: learningContext.getStore()?"Preparacion interna guardada; conexiones, metricas y ejecucion comercial sin verificar.":`Marketing CMO global activo con ${readyClients}/${clients.length} clientes internos ready.`,
      nextCommand:
        learningContext.getStore()?"Verificar fuentes y metricas antes de evaluar resultados; las recomendaciones guardadas son preparacion interna.":readyClients === clients.length
          ? "Todos los clientes detectados estan separados y ready; correr learning loop y preparar handoffs por cliente."
          : "Correr daily learning loop y preparar approvals por cliente.",
      budgetPosture: learningContext.getStore()?"Gasto e ingresos sin verificar; no se ejecutan pagos ni publicaciones.":totalSpendUsd > totalRevenueUsd ? "Proteger caja: spend mayor que revenue." : `Spend global ${money.format(totalSpendUsd)} contra revenue ${money.format(totalRevenueUsd)}.`,
    },
  };
}

export function runMarketingCommandCenterDay(input: Partial<MarketingCommandCenterDayInput> = {}) {
  const parsed = marketingCommandCenterDaySchema.parse(input);
  loadLearningRuns();
  const snapshot = getMarketingCommandCenterSnapshot();
  if(parsed.focusClientId!=="all"&&!snapshot.clients.some(c=>c.id===parsed.focusClientId))throw Error("MARKETING_CLIENT_UNKNOWN");
  const targetClients = parsed.focusClientId === "all"
    ? snapshot.clients
    : snapshot.clients.filter((client) => client.id === parsed.focusClientId);
  const clientsToReview = targetClients.length ? targetClients : snapshot.clients;
  const rulesUpdated = clientsToReview.map((client) => {
    if (client.metrics.orders > 0 || client.metrics.revenueUsd > 0) {
      return `${client.name}: repetir angulos que generen revenue y medir siguiente batch antes de subir gasto.`;
    }
    if (client.status === "needs_setup" || client.status === "needs_data") {
      return `${client.name}: completar datos base y metricas antes de pedir autoposting o paid ads.`;
    }
    return `${client.name}: mantener organic/draft testing y pedir approval solo para acciones externas.`;
  });
  const improvementsQueued = clientsToReview.flatMap((client) => client.nextActions.slice(0, 2).map((action) => `${client.name}: ${action}`));
  const safetyBlocks = [
    "Publicacion externa bloqueada.",
    "Gasto en ads bloqueado.",
    "Contacto a clientes/proveedores bloqueado.",
    "Uso de credenciales/OAuth bloqueado.",
    "Mezcla de datos entre clientes bloqueada.",
  ];
  const run: MarketingLearningRun = {
    id: learningContext.getStore()?.id || `mkt-run-${Date.now()}`,
    createdAt: learningContext.getStore()?.at || new Date().toISOString(),
    focusClientId: parsed.focusClientId,
    clientsReviewed: clientsToReview.length,
    improvementsQueued,
    rulesUpdated,
    safetyBlocks,
    summary: learningContext.getStore()?`Preparacion: ${clientsToReview.length} plantillas de cliente, ${rulesUpdated.length} recomendaciones y ${improvementsQueued.length} siguientes pasos guardados; no son aprendizaje validado ni tareas externas ejecutadas.`:`Marketing CMO reviso ${clientsToReview.length} cliente(s), actualizo ${rulesUpdated.length} regla(s) y dejo ${improvementsQueued.length} mejora(s) en cola sin ejecutar acciones externas.`,
  };
  currentRuns().push(run);
  persistLearningRuns();

  return {
    status: "completed" as const,
    summary: run.summary,
    safety: {
      externalActionsBlocked: true,
      spentUsd: 0,
      publishedExternally: 0,
      clientDataMixed: false,
    },
    learning: run,
    snapshot: getMarketingCommandCenterSnapshot(),
  };
}

export function setMarketingCommandCenterLearningPathForTests(value: string | null) {
  learningRunsPathOverride = value;
}

export function resetMarketingCommandCenterForTests() {
  learningRunsLoaded = false;
  learningRuns.splice(0, learningRuns.length);
}
