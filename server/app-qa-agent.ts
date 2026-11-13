import { buildMissionBreakdown, missionForRoute, routeMissionCoverage, type QaMissionBreakdown } from '../shared/app-qa-missions';
import type { AppErrorEvent, AppHealthCheck, AppIncident, AppProject } from "@shared/schema";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { hasRealValue } from "./ceo-doctor-cli";
import { isGitHubConnected, listRepositories } from "./github-client";
import { getDateKeyFromClock, getZonedClock } from "./scheduler-time";
import { escapeTelegramHtml, sendTelegramMessage, sendTelegramPhoto } from "./telegram";

export type AppQaSeverity = "critical" | "high" | "medium" | "low" | "info";
export type AppQaStatus = "pass" | "warn" | "fail";

export type AppQaFinding = {
  id: string;
  appName: string;
  area: string;
  severity: AppQaSeverity;
  title: string;
  detail: string;
  recommendation: string;
  sourceAgent: AppQaSubAgentId;
  url?: string | null;
  screenshotPath?: string | null;
};

export type AppQaSubAgentId =
  | "route-scout"
  | "link-click-scout"
  | "visual-click-scout"
  | "github-scout"
  | "api-scout"
  | "error-scout"
  | "improvement-scout";

export type AppQaSubAgentReport = {
  id: AppQaSubAgentId;
  name: string;
  status: AppQaStatus;
  summary: string;
  checked: number;
  findings: AppQaFinding[];
};

export type AppQaRouteProbe = {
  path: string;
  label: string;
  expectedClicks: string[];
  expectedControls?: string[];
  expectedControlGroups?: Array<{
    name: string;
    controls: string[];
    activationControls?: string[];
  }>;
  visualTextTabs?: string[];
  visualDisclosure?: { buttonName: string; panelSelector: string };
  status: AppQaStatus;
  notes: string[];
};

export type AppQaTargetContext = {
  kind: "developer_autopilot_pr" | "revenue_delivery_workspace";
  workspaceId?: string;
  clientName?: string;
  projectType?: string;
  repoFullName?: string;
  prUrl?: string;
  prHeadSha?: string;
  branchName?: string;
  routePath?: string;
  expectedControls?: string[];
};

export type AppQaScanResult = {
  scannedAt: string;
  targetContext?: AppQaTargetContext;
  totalApps: number;
  totalGithubRepos: number;
  totalGithubAppRepos: number;
  githubConnected: boolean;
  githubError: string | null;
  totalRoutes: number;
  totalChecks: number;
  failCount: number;
  warnCount: number;
  telegramSent: boolean;
  dailyDigestSent: boolean;
  summary: string;
  council: AppQaCouncilReport;
  subAgents: AppQaSubAgentReport[];
  routeMap: AppQaRouteProbe[];
  missionBreakdown?: QaMissionBreakdown;
  visualScans: AppQaVisualRouteScan[];
  githubApps: AppQaGithubRepoCheck[];
  bugPatrol: BugPatrolReport;
  findings: AppQaFinding[];
  improvementIdeas: AppQaFinding[];
};

export type BugPatrolHandoff = {
  findingId: string;
  appName: string;
  severity: AppQaSeverity;
  title: string;
  repoFullName: string | null;
  status: "created" | "codex_dispatched" | "skipped" | "failed";
  issueUrl?: string;
  issueNumber?: number;
  codexDispatchCommentUrl?: string;
  reason?: string;
};

export type BugPatrolReport = {
  enabled: boolean;
  scannedFindings: number;
  candidates: number;
  created: number;
  dispatched: number;
  skipped: number;
  failed: number;
  handoffs: BugPatrolHandoff[];
};

export type AppQaVisualRouteScan = {
  path: string;
  url: string;
  status: AppQaStatus | "pending";
  title?: string | null;
  consoleErrors: string[];
  clicked: string[];
  screenshotPath?: string | null;
  notes: string[];
};

export type AppQaCouncilReport = {
  name: "QA Council";
  status: AppQaStatus;
  summary: string;
  cadence: string[];
  activeSubAgents: Array<{
    id: AppQaSubAgentId;
    name: string;
    status: AppQaStatus;
    findings: number;
  }>;
  immediateActions: string[];
  nextSteps: string[];
};

export type AppQaGithubRepoCheck = {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  homepage?: string | null;
  language?: string | null;
  private: boolean;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
  updatedAt?: string | null;
  pushedAt?: string | null;
  openIssuesCount?: number | null;
  connectedToInventory: boolean;
  checkedUrl?: string | null;
  status: AppQaStatus;
  notes: string[];
};

const AUTO_ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const lastAutomaticAlertByUser = new Map<string, { signature: string; sentAt: number }>();
const lastDailyDigestByUser = new Map<string, string>();
const lastDailyVisualByUser = new Map<string, string>();
const lastBugPatrolHandoffByUser = new Map<string, Map<string, number>>();
const APP_QA_TIMEZONE = "America/New_York";
const DAILY_DIGEST_HOUR = 8;
const DEFAULT_VISUAL_HOURS = [8, 20];
const APP_QA_DEFAULT_INTERVAL_MINUTES = 30;
const BUG_PATROL_DEFAULT_COOLDOWN_HOURS = 24;
const VISUAL_SCREENSHOT_DIR = path.join(process.cwd(), ".app-qa-screenshots");
const SAFE_CLICK_TEXT_BLOCKLIST = [
  "delete",
  "remove",
  "logout",
  "salir",
  "publish",
  "publicar",
  "send",
  "enviar",
  "pay",
  "pagar",
  "confirm",
  "approve",
  "aprobar",
  "disconnect",
  "desconectar",
];
const LIKELY_APP_REPO_KEYWORDS = [
  "app",
  "site",
  "website",
  "web",
  "dashboard",
  "client",
  "server",
  "api",
  "bot",
  "shop",
  "store",
  "kong",
  "black",
  "room",
  "dropkit",
  "dropshipping",
  "planner",
  "portal",
];

type GithubRepo = Awaited<ReturnType<typeof listRepositories>>[number];
type AppQaVisualMode = "off" | "manual" | "daily" | "every_scan";

type AppQaContext = {
  app: AppProject;
  healthChecks: AppHealthCheck[];
  incidents: AppIncident[];
  errors: AppErrorEvent[];
};

const LOCAL_ROUTE_MAP: AppQaRouteProbe[] = [
  { path: "/", label: "Dashboard", expectedClicks: ["Ver agentes", "Herramientas"], status: "pass", notes: [] },
  { path: "/assistant", label: "Assistant", expectedClicks: ["Enviar mensaje"], status: "pass", notes: [] },
  { path: "/ceo", label: "CEO Dashboard", expectedClicks: ["Approvals", "Salud operacional"], status: "pass", notes: [] },
  { path: "/tools", label: "Tools", expectedClicks: ["Abrir herramienta", "Ajustes"], status: "pass", notes: [] },
  { path: "/agents-office", label: "Agents Office", expectedClicks: ["Dirección", "Ingeniería", "Contratar scout simulado", "Guardar", "Avanzar un día"], visualDisclosure: { buttonName: "Abrir Company World · simulación de departamentos (sin gasto real)", panelSelector: "#company-world .company-office" }, status: "pass", notes: [] },
  { path: "/projects", label: "Apps / Projects", expectedClicks: ["Agregar proyecto", "Check manual"], status: "pass", notes: [] },
  { path: "/cybersecurity-agent", label: "Cybersecurity Agent", expectedClicks: ["Escanear", "Importar apps"], status: "pass", notes: [] },
  { path: "/legal-compliance", label: "Legal Compliance", expectedClicks: ["Ver reportes"], status: "pass", notes: [] },
  { path: "/code-agent", label: "Code Agent", expectedClicks: ["Leer archivo", "Guardar cambio"], status: "pass", notes: [] },
  { path: "/github-agent", label: "GitHub Agent", expectedClicks: ["Revisar repo"], status: "pass", notes: [] },
  {
    path: "/revenue-engine",
    label: "Revenue Engine",
    expectedClicks: [
      "Guardar candidato publico",
      "Guardar connector review-only",
      "Preview batch",
      "Money sprint",
      "Copy packet",
      "Crear oportunidad",
      "Copy close",
      "Registrar deposito y vender",
      "Reply",
      "Deposit",
      "Crear workspace",
      "Copy brief",
      "Guardar workspace",
      "Create issue",
      "Revalidar con checks marcados",
      "Run App QA",
      "Registrar release gate",
      "Entregar aprobado",
      "Correr QA",
    ],
    expectedControls: ["Guardar candidato publico", "Guardar connector review-only", "Preview batch", "Money sprint", "Correr QA"],
    expectedControlGroups: [
      {
        name: "website_sales_packet",
        controls: ["Copy packet", "Crear oportunidad"],
        activationControls: ["Copy packet", "Crear oportunidad"],
      },
      {
        name: "website_closure",
        controls: ["Copy close", "Registrar deposito y vender", "Reply", "Deposit"],
        activationControls: ["Copy close", "Registrar deposito y vender"],
      },
      {
        name: "website_delivery_workspace",
        controls: ["Crear workspace", "Copy brief", "Guardar workspace"],
        activationControls: ["Crear workspace", "Copy brief", "Guardar workspace"],
      },
      {
        name: "website_release_gate",
        controls: ["Create issue", "Revalidar con checks marcados", "Run App QA", "Registrar release gate", "Entregar aprobado"],
        activationControls: ["Create issue", "Revalidar con checks marcados", "Run App QA", "Registrar release gate", "Entregar aprobado"],
      },
    ],
    visualTextTabs: ["Pipeline", "Leads", "QA entrega", "Outbox"],
    status: "pass",
    notes: ["Outcome, delivery, GitHub handoff and delivery controls are data-dependent and validated as grouped scenario controls when state is present."],
  },
  { path: "/dropshipping-ceo", label: "Dropshipping CEO", expectedClicks: ["Ciclo diario", "Launch pack"], status: "pass", notes: [] },
  { path: "/marketing-command-center", label: "Marketing HQ", expectedClicks: ["Run day", "Review analytics"], status: "pass", notes: [] },
  { path: "/portfolio", label: "Portfolio", expectedClicks: ["Ver inversion", "Actualizar datos"], status: "pass", notes: [] },
  { path: "/radio", label: "Radio", expectedClicks: ["Generar flyer", "Enviar resumen"], status: "pass", notes: [] },
  { path: "/promo-video", label: "Promo Video", expectedClicks: ["Importar videos", "Editar"], status: "pass", notes: [] },
  { path: "/clippers", label: "Clippers", expectedClicks: ["Preflight", "Publishing queue"], status: "pass", notes: [] },
  { path: '/dashboard', label: 'Dashboard (alias)', expectedClicks: ['Ver agentes', 'Herramientas'], status: 'pass', notes: [] },
  { path: '/revenue-engine/advanced', label: 'Revenue Engine avanzado', expectedClicks: ['Pipeline', 'QA entrega'], status: 'pass', notes: [] },
  { path: '/app-qa-agent', label: 'App QA Agent', expectedClicks: ['Correr patrulla', 'Cobertura y resultados por misión'], status: 'pass', notes: [] },
  { path: '/automations', label: 'Automation Manager', expectedClicks: ['Pausar', 'Reanudar'], status: 'pass', notes: [] },
  { path: '/portfolio/:symbol', label: 'Detalle de inversión', expectedClicks: ['Volver', 'Actualizar historial'], status: 'pass', notes: ['Ruta dinámica: validar con un símbolo real autorizado.'] },
  { path: '/news', label: 'Noticias públicas', expectedClicks: ['Ver edición'], status: 'pass', notes: [] },
  { path: '/news/miami', label: 'Noticias Miami', expectedClicks: ['Ver edición'], status: 'pass', notes: [] },
  { path: '/news/new-york', label: 'Noticias New York', expectedClicks: ['Ver edición'], status: 'pass', notes: [] },
  { path: '/news/article/:slug', label: 'Artículo público', expectedClicks: ['Volver a las noticias de hoy'], status: 'pass', notes: ['Ruta dinámica: validar con un artículo real autorizado.'] },
];

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return hasRealValue(token) ? token : null;
}

function severityRank(severity: AppQaSeverity): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[severity];
}

function normalizeRepo(app: AppProject): string | null {
  if (app.githubRepo) return app.githubRepo.toLowerCase();
  if (app.repoOwner && app.repoName) return `${app.repoOwner}/${app.repoName}`.toLowerCase();
  return null;
}

function isLikelyGithubAppRepo(repo: GithubRepo): boolean {
  const homepage = repo.homepage?.trim();
  if (homepage && /^https?:\/\//i.test(homepage)) return true;
  const text = `${repo.name} ${repo.description || ""} ${repo.language || ""}`.toLowerCase();
  return LIKELY_APP_REPO_KEYWORDS.some((keyword) => text.includes(keyword));
}

function alertSignature(result: AppQaScanResult): string {
  return result.findings
    .filter((finding) => finding.severity === "critical" || finding.severity === "high")
    .map((finding) => `${finding.appName}:${finding.sourceAgent}:${finding.severity}:${finding.title}`)
    .sort()
    .join("|");
}

function shouldSendAutomaticAlert(userId: string, result: AppQaScanResult): boolean {
  const signature = alertSignature(result);
  if (!signature) return false;

  const previous = lastAutomaticAlertByUser.get(userId);
  const now = Date.now();
  if (previous?.signature === signature && now - previous.sentAt < AUTO_ALERT_COOLDOWN_MS) {
    return false;
  }

  lastAutomaticAlertByUser.set(userId, { signature, sentAt: now });
  return true;
}

function shouldSendDailyDigest(userId: string, now = new Date()): boolean {
  const clock = getZonedClock(now, APP_QA_TIMEZONE);
  if (clock.hour < DAILY_DIGEST_HOUR) return false;
  const dateKey = getDateKeyFromClock(clock);
  if (lastDailyDigestByUser.get(userId) === dateKey) return false;
  lastDailyDigestByUser.set(userId, dateKey);
  return true;
}

function isBugPatrolEnabled(): boolean {
  return (process.env.BUG_PATROL_ENABLED || "true").toLowerCase() !== "false";
}

function getBugPatrolCooldownMs(): number {
  const hours = Number(process.env.BUG_PATROL_COOLDOWN_HOURS || BUG_PATROL_DEFAULT_COOLDOWN_HOURS);
  const safeHours = Number.isFinite(hours) && hours >= 1 ? hours : BUG_PATROL_DEFAULT_COOLDOWN_HOURS;
  return safeHours * 60 * 60 * 1000;
}

function emptyBugPatrolReport(enabled = isBugPatrolEnabled()): BugPatrolReport {
  return {
    enabled,
    scannedFindings: 0,
    candidates: 0,
    created: 0,
    dispatched: 0,
    skipped: 0,
    failed: 0,
    handoffs: [],
  };
}

function isBugPatrolCandidate(finding: AppQaFinding): boolean {
  if (!["critical", "high"].includes(finding.severity)) return false;
  if (finding.sourceAgent === "improvement-scout" || finding.sourceAgent === "route-scout") return false;
  if (finding.title === "GitHub no conectado para App QA") return false;
  return true;
}

function appRepoFullName(app: AppProject | undefined): string | null {
  if (!app) return null;
  if (app.githubRepo?.trim()) return app.githubRepo.trim();
  if (app.repoOwner?.trim() && app.repoName?.trim()) return `${app.repoOwner.trim()}/${app.repoName.trim()}`;
  return null;
}

function bugPatrolSignature(finding: AppQaFinding, repoFullName: string | null): string {
  return [
    repoFullName || finding.appName,
    finding.sourceAgent,
    finding.severity,
    finding.title,
    finding.url || finding.area,
  ].join("|").toLowerCase();
}

function getBugPatrolUserMap(userId: string): Map<string, number> {
  let userMap = lastBugPatrolHandoffByUser.get(userId);
  if (!userMap) {
    userMap = new Map();
    lastBugPatrolHandoffByUser.set(userId, userMap);
  }
  return userMap;
}

function isBugPatrolHandoffOnCooldown(userId: string, signature: string, now = Date.now()): boolean {
  const userMap = getBugPatrolUserMap(userId);
  const previous = userMap.get(signature);
  return Boolean(previous && now - previous < getBugPatrolCooldownMs());
}

function markBugPatrolHandoffCreated(userId: string, signature: string, now = Date.now()): void {
  getBugPatrolUserMap(userId).set(signature, now);
}

function buildBugPatrolAutopilotMessage(finding: AppQaFinding, repoFullName: string): string {
  return [
    `arregla este bug en ${repoFullName}`,
    "",
    "Bug Patrol detecto un fallo real durante App QA.",
    `App: ${finding.appName}`,
    `Severidad: ${finding.severity}`,
    `Area: ${finding.area}`,
    `Titulo: ${finding.title}`,
    `Detalle: ${finding.detail}`,
    `URL: ${finding.url || "no disponible"}`,
    `Recomendacion QA: ${finding.recommendation}`,
    "",
    "Usa flujo PR-first. No hagas merge ni deploy sin aprobacion de Robert.",
  ].join("\n");
}

export async function runBugPatrolHandoffs(userId: string, apps: AppProject[], findings: AppQaFinding[]): Promise<BugPatrolReport> {
  if (!isBugPatrolEnabled()) return emptyBugPatrolReport(false);

  const appByName = new Map(apps.map((app) => [app.name.toLowerCase(), app]));
  const candidates = findings.filter(isBugPatrolCandidate);
  const handoffs: BugPatrolHandoff[] = [];

  for (const finding of candidates) {
    const app = appByName.get(finding.appName.toLowerCase());
    const repoFullName = appRepoFullName(app);
    const signature = bugPatrolSignature(finding, repoFullName);

    if (!repoFullName) {
      handoffs.push({
        findingId: finding.id,
        appName: finding.appName,
        severity: finding.severity,
        title: finding.title,
        repoFullName: null,
        status: "skipped",
        reason: "App sin repo GitHub conectado; agrega githubRepo o repoOwner/repoName en Developer Health.",
      });
      continue;
    }

    if (isBugPatrolHandoffOnCooldown(userId, signature)) {
      handoffs.push({
        findingId: finding.id,
        appName: finding.appName,
        severity: finding.severity,
        title: finding.title,
        repoFullName,
        status: "skipped",
        reason: `Handoff repetido en cooldown de ${Math.round(getBugPatrolCooldownMs() / 60 / 60 / 1000)}h.`,
      });
      continue;
    }

    // Developer Autopilot pulls in the storage/runtime graph. Keep it out of
    // App QA's module initialization so pure route/telemetry scouts and their
    // release-gate tests can start without waiting on production services.
    const { createDeveloperAutopilotHandoff } = await import("./developer-autopilot");
    const handoff = await createDeveloperAutopilotHandoff(
      userId,
      buildBugPatrolAutopilotMessage(finding, repoFullName),
      "app_qa",
    );

    if (handoff.status === "created" || handoff.status === "codex_dispatched") {
      markBugPatrolHandoffCreated(userId, signature);
      handoffs.push({
        findingId: finding.id,
        appName: finding.appName,
        severity: finding.severity,
        title: finding.title,
        repoFullName,
        status: handoff.status,
        issueUrl: handoff.issueUrl,
        issueNumber: handoff.issueNumber,
        codexDispatchCommentUrl: handoff.codexDispatchCommentUrl,
      });
      continue;
    }

    handoffs.push({
      findingId: finding.id,
      appName: finding.appName,
      severity: finding.severity,
      title: finding.title,
      repoFullName,
      status: "failed",
      reason: handoff.message,
    });
  }

  return {
    enabled: true,
    scannedFindings: findings.length,
    candidates: candidates.length,
    created: handoffs.filter((handoff) => handoff.status === "created").length,
    dispatched: handoffs.filter((handoff) => handoff.status === "codex_dispatched").length,
    skipped: handoffs.filter((handoff) => handoff.status === "skipped").length,
    failed: handoffs.filter((handoff) => handoff.status === "failed").length,
    handoffs,
  };
}

function getAppQaIntervalMs(): number {
  const everyMinutes = Number(process.env.APP_QA_INTERVAL_MINUTES || APP_QA_DEFAULT_INTERVAL_MINUTES);
  const safeMinutes = Number.isFinite(everyMinutes) && everyMinutes >= 5 ? everyMinutes : APP_QA_DEFAULT_INTERVAL_MINUTES;
  return safeMinutes * 60 * 1000;
}

function getVisualMode(): AppQaVisualMode {
  const raw = (process.env.APP_QA_VISUAL_MODE || "daily").toLowerCase();
  if (raw === "off" || raw === "manual" || raw === "daily" || raw === "every_scan") return raw;
  return "daily";
}

function getVisualHours(): number[] {
  const raw = process.env.APP_QA_VISUAL_HOURS || DEFAULT_VISUAL_HOURS.join(",");
  const hours = raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  const unique = Array.from(new Set(hours)).sort((a, b) => a - b);
  return unique.length ? unique : DEFAULT_VISUAL_HOURS;
}

function shouldRunDailyVisual(userId: string, now = new Date()): boolean {
  const clock = getZonedClock(now, APP_QA_TIMEZONE);
  if (!getVisualHours().includes(clock.hour)) return false;
  const visualKey = `${getDateKeyFromClock(clock)}-${clock.hour}`;
  if (lastDailyVisualByUser.get(userId) === visualKey) return false;
  lastDailyVisualByUser.set(userId, visualKey);
  return true;
}

function shouldRunVisualScout(input: {
  userId: string;
  notify: boolean;
  allowDailyDigest: boolean;
  targetContext?: AppQaTargetContext;
  now?: Date;
}): boolean {
  const mode = getVisualMode();
  if (mode === "off") return false;
  if (input.targetContext?.kind === "revenue_delivery_workspace") return true;
  if (mode === "every_scan") return true;
  if (mode === "manual") return input.notify;
  return input.notify || (input.allowDailyDigest && shouldRunDailyVisual(input.userId, input.now));
}

function buildSkippedVisualScoutReport(): AppQaSubAgentReport & { visualScans: AppQaVisualRouteScan[] } {
  return {
    id: "visual-click-scout",
    name: "Visual Click Scout",
    status: "pass",
    summary: `QA visual en modo ahorro (${getVisualMode()}); no corrio en esta patrulla ligera.`,
    checked: 0,
    findings: [],
    visualScans: [],
  };
}

function buildQaCouncil(input: {
  subAgents: AppQaSubAgentReport[];
  findings: AppQaFinding[];
  githubConnected: boolean;
  githubApps: AppQaGithubRepoCheck[];
  failCount: number;
  warnCount: number;
}): AppQaCouncilReport {
  const immediateActions = input.findings
    .filter((finding) => finding.severity === "critical" || finding.severity === "high")
    .slice(0, 5)
    .map((finding) => `${finding.appName}: ${finding.title} - ${finding.recommendation}`);
  const nextSteps: string[] = [];

  if (!input.githubConnected) {
    nextSteps.push("Conectar GitHub para que GitHub Scout revise todos los repos y detecte apps nuevos.");
  }

  const newGithubApps = input.githubApps.filter((repo) => !repo.connectedToInventory && !repo.archived && !repo.disabled);
  if (newGithubApps.length) {
    nextSteps.push(`Importar o registrar ${newGithubApps.length} repos tipo app que estan fuera de Developer Health.`);
  }

  if (input.findings.some((finding) => finding.title.includes("health") || finding.area.toLowerCase().includes("health"))) {
    nextSteps.push("Agregar o corregir health endpoints para apps de produccion.");
  }

  if (!nextSteps.length) {
    nextSteps.push("Mantener patrulla activa y subir a QA visual con navegador cuando haya cambios de UI.");
  }

  const status: AppQaStatus = input.failCount ? "fail" : input.warnCount ? "warn" : "pass";

  return {
    name: "QA Council",
    status,
    summary: input.failCount
      ? `QA Council bloqueo release: ${input.failCount} fallos altos/criticos y ${input.warnCount} avisos.`
      : input.warnCount
        ? `QA Council permite seguir, pero dejo ${input.warnCount} avisos para mejorar.`
        : "QA Council no encontro bloqueos en esta patrulla.",
    cadence: [
      `Patrulla ligera cada ${Math.round(getAppQaIntervalMs() / 60000)} min`,
      "Telegram inmediato para critical/high",
      "Digest diario desde las 8:00 America/New_York",
      `QA visual Playwright en modo ${getVisualMode()} (${getVisualHours().map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ")})`,
      "Sin IA ni APIs pagadas para QA",
    ],
    activeSubAgents: input.subAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      findings: agent.findings.length,
    })),
    immediateActions,
    nextSteps,
  };
}

function buildDependencyUnavailableReport(
  id: Exclude<AppQaSubAgentId, "route-scout" | "visual-click-scout">,
  name: string,
  detail: string,
): AppQaSubAgentReport & Partial<{ githubApps: AppQaGithubRepoCheck[] }> {
  const syntheticApp = { name: "App QA" } as AppProject;
  const finding = createFinding(
    syntheticApp,
    id,
    "App QA data dependency",
    "critical",
    "App QA no pudo leer datos operativos",
    detail,
    "Restaurar la conexion de base de datos/storage y volver a correr App QA antes de aprobar el release.",
    "/app-qa-agent",
  );

  const report = {
    id,
    name,
    status: "fail" as const,
    summary: `${name} bloqueado porque App QA no pudo leer datos operativos.`,
    checked: 0,
    findings: [finding],
  };

  return id === "github-scout" ? { ...report, githubApps: [] } : report;
}

function describeAppQaStorageError(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors
      .map((inner) => inner instanceof Error ? inner.message : String(inner))
      .filter(Boolean);
    if (details.length) return details.join("; ");
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const text = String(error || "").trim();
  return text || "Storage unavailable";
}

function buildAppQaStorageUnavailableResult(error: unknown, startedAt = new Date(), targetContext?: AppQaTargetContext): AppQaScanResult {
  const detail = describeAppQaStorageError(error);
  const visualReport = buildSkippedVisualScoutReport();
  const githubReport = buildDependencyUnavailableReport("github-scout", "GitHub Scout", detail) as AppQaSubAgentReport & { githubApps: AppQaGithubRepoCheck[] };
  const subAgents: AppQaSubAgentReport[] = [
    analyzeRoutes(),
    buildDependencyUnavailableReport("link-click-scout", "Link + Click Scout", detail),
    visualReport,
    githubReport,
    buildDependencyUnavailableReport("api-scout", "API Scout", detail),
    buildDependencyUnavailableReport("error-scout", "Error Scout", detail),
    buildDependencyUnavailableReport("improvement-scout", "Improvement Scout", detail),
  ];
  const findings = subAgents.flatMap((agent) => agent.findings).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const failCount = findings.filter((finding) => ["critical", "high"].includes(finding.severity)).length;
  const warnCount = findings.filter((finding) => ["medium", "low"].includes(finding.severity)).length;
  const council = buildQaCouncil({
    subAgents,
    findings,
    githubConnected: false,
    githubApps: [],
    failCount,
    warnCount,
  });

  return {
    scannedAt: startedAt.toISOString(),
    targetContext,
    totalApps: 0,
    totalGithubRepos: 0,
    totalGithubAppRepos: 0,
    githubConnected: false,
    githubError: "App QA storage unavailable",
    totalRoutes: LOCAL_ROUTE_MAP.length,
    totalChecks: subAgents.reduce((sum, agent) => sum + agent.checked, 0),
    failCount,
    warnCount,
    telegramSent: false,
    dailyDigestSent: false,
    summary: `QA Agent bloqueo release: no pudo leer datos operativos (${detail}).`,
    council,
    subAgents,
    routeMap: LOCAL_ROUTE_MAP,
    missionBreakdown: buildMissionBreakdown(LOCAL_ROUTE_MAP, visualReport.visualScans, findings, getVisualBaseUrl()),
    visualScans: visualReport.visualScans,
    githubApps: [],
    bugPatrol: emptyBugPatrolReport(),
    findings,
    improvementIdeas: [],
  };
}

function formatTelegramReport(result: AppQaScanResult): string {
  const topFailures = result.findings
    .filter((finding) => finding.severity === "critical" || finding.severity === "high")
    .slice(0, 8);
  const topWarnings = result.findings
    .filter((finding) => finding.severity === "medium" || finding.severity === "low")
    .slice(0, Math.max(0, 8 - topFailures.length));

  const failureLines = topFailures.length
    ? topFailures.map((finding) =>
        `- [${finding.severity.toUpperCase()}] ${finding.appName}: ${finding.title}. ${finding.recommendation}`
      ).join("\n")
    : "- No hay fallos criticos/altos en esta patrulla.";

  const warningLines = topWarnings.length
    ? `\n\nAvisos/mejoras:\n${topWarnings.map((finding) =>
        `- [${finding.severity.toUpperCase()}] ${finding.appName}: ${finding.title}.`
      ).join("\n")}`
    : "";

  const agentLines = result.subAgents
    .map((agent) => `- ${agent.name}: ${agent.status.toUpperCase()} (${agent.findings.length} hallazgos)`)
    .join("\n");

  return escapeTelegramHtml(
    `App QA Agent\n\n` +
    `${result.summary}\n\n` +
    `Apps: ${result.totalApps}\n` +
    `Repos GitHub: ${result.githubConnected ? result.totalGithubRepos : "no conectado"}\n` +
    `Repos tipo app: ${result.totalGithubAppRepos}\n` +
    `Paginas: ${result.totalRoutes}\n` +
    `Checks: ${result.totalChecks}\n` +
    `Fallos altos/criticos: ${result.failCount}\n` +
    `Avisos: ${result.warnCount}\n` +
    `Bug Patrol handoffs: ${result.bugPatrol.created + result.bugPatrol.dispatched}\n\n` +
    `Fallos principales:\n${failureLines}${warningLines}\n\n` +
    `QA Council: ${result.council.status.toUpperCase()} - ${result.council.summary}\n\n` +
    `Subagentes:\n${agentLines}`
  );
}

function formatDailyDigest(result: AppQaScanResult): string {
  const healthyAgents = result.subAgents.filter((agent) => agent.status === "pass").length;
  const newRepos = result.githubApps.filter((repo) => !repo.connectedToInventory && !repo.archived && !repo.disabled);
  const topActions = result.council.immediateActions.length
    ? result.council.immediateActions.slice(0, 5).map((action) => `- ${action}`).join("\n")
    : "- No hay acciones urgentes.";
  const nextSteps = result.council.nextSteps.map((step) => `- ${step}`).join("\n");

  return escapeTelegramHtml(
    `App QA Daily Digest\n\n` +
    `${result.council.summary}\n\n` +
    `Apps inventario: ${result.totalApps}\n` +
    `Repos GitHub: ${result.githubConnected ? result.totalGithubRepos : "no conectado"}\n` +
    `Repos tipo app: ${result.totalGithubAppRepos}\n` +
    `Repos nuevos/fuera inventario: ${newRepos.length}\n` +
    `Subagentes sanos: ${healthyAgents}/${result.subAgents.length}\n` +
    `Fallos altos/criticos: ${result.failCount}\n` +
    `Avisos: ${result.warnCount}\n\n` +
    `Bug Patrol:\n` +
    `- Handoffs creados: ${result.bugPatrol.created}\n` +
    `- Codex despachado: ${result.bugPatrol.dispatched}\n` +
    `- Saltados/pendientes: ${result.bugPatrol.skipped}\n` +
    `- Fallidos: ${result.bugPatrol.failed}\n\n` +
    `Acciones urgentes:\n${topActions}\n\n` +
    `Siguientes pasos:\n${nextSteps}`
  );
}

async function sendVisualFailureScreenshots(botToken: string, chatId: string, result: AppQaScanResult): Promise<void> {
  const screenshots = result.findings
    .filter((finding) => finding.sourceAgent === "visual-click-scout" && finding.screenshotPath)
    .slice(0, 3);

  for (const finding of screenshots) {
    await sendTelegramPhoto(
      botToken,
      chatId,
      finding.screenshotPath!,
      escapeTelegramHtml(`${finding.title}\n${finding.appName}: ${finding.area}\n${finding.recommendation}`)
    );
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "qa";
}

function statusFromFindings(findings: AppQaFinding[]): AppQaStatus {
  if (findings.some((finding) => finding.severity === "critical" || finding.severity === "high")) return "fail";
  if (findings.length) return "warn";
  return "pass";
}

function createFinding(
  app: AppProject,
  sourceAgent: AppQaSubAgentId,
  area: string,
  severity: AppQaSeverity,
  title: string,
  detail: string,
  recommendation: string,
  url?: string | null,
  screenshotPath?: string | null
): AppQaFinding {
  return {
    id: `${slug(app.name)}-${sourceAgent}-${slug(title)}`,
    appName: app.name,
    area,
    severity,
    title,
    detail,
    recommendation,
    sourceAgent,
    url,
    screenshotPath: screenshotPath || null,
  };
}

function publicAppUrl(app: AppProject): string | null {
  return app.publicUrl || app.healthUrl || null;
}

function isValidUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getVisualBaseUrl(): string | null {
  const raw = process.env.APP_QA_BASE_URL || process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || null;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return null;
  }
}

function screenshotName(routePath: string): string {
  const clean = routePath.replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "") || "home";
  return `${clean}-${Date.now()}.png`;
}

function isSafeVisualClick(text: string, href: string | null): boolean {
  const lower = `${text} ${href || ""}`.toLowerCase();
  if (!href || !href.startsWith("/")) return false;
  return !SAFE_CLICK_TEXT_BLOCKLIST.some((blocked) => lower.includes(blocked));
}

async function loadPlaywright(): Promise<any | null> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    return await dynamicImport("playwright");
  } catch {
    return null;
  }
}

function resolveChromiumExecutablePath(): string | undefined {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (configured && existsSync(configured)) return configured;

  const candidates = ["chromium", "chromium-browser", "google-chrome", "chrome"];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const binary of candidates) {
      const candidatePath = path.join(dir, binary);
      if (existsSync(candidatePath)) return candidatePath;
    }
  }

  return undefined;
}

function normalizeVisualText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasExpectedVisualControl(bodyText: string, expectedControl: string): boolean {
  const normalizedBody = normalizeVisualText(bodyText);
  const normalizedControl = normalizeVisualText(expectedControl);
  if (!normalizedControl) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedControl)}($|[^a-z0-9])`).test(normalizedBody);
}

function findMissingExpectedVisualControls(bodyText: string, expectedClicks: string[]): string[] {
  return expectedClicks.filter((click) => !hasExpectedVisualControl(bodyText, click));
}

function countExpectedVisualControls(route: AppQaRouteProbe): number {
  const groupedControls = (route.expectedControlGroups || []).reduce(
    (sum, group) => sum + group.controls.length,
    0,
  );
  return (route.expectedControls?.length || 0) + groupedControls;
}

type VisualRouteTextSnapshot = {
  label: string;
  bodyText: string;
};

function evaluateExpectedVisualControls(bodyText: string, route: AppQaRouteProbe): string[] {
  return evaluateExpectedVisualControlSnapshots([{ label: "visible", bodyText }], route);
}

function evaluateExpectedVisualControlSnapshots(snapshots: VisualRouteTextSnapshot[], route: AppQaRouteProbe): string[] {
  const notes: string[] = [];
  const combinedBodyText = snapshots.map((snapshot) => snapshot.bodyText).join("\n");
  const missingExpectedControls = findMissingExpectedVisualControls(combinedBodyText, route.expectedControls || []);

  if (missingExpectedControls.length) {
    notes.push(`Controles esperados no visibles: ${missingExpectedControls.join(", ")}`);
  }

  for (const group of route.expectedControlGroups || []) {
    for (const snapshot of snapshots) {
      const activationControls = group.activationControls || group.controls;
      const activationVisible = activationControls.some((control) =>
        !findMissingExpectedVisualControls(snapshot.bodyText, [control]).length
      );
      if (!activationVisible) continue;

      const missingGroupControls = findMissingExpectedVisualControls(snapshot.bodyText, group.controls);
      if (missingGroupControls.length) {
        notes.push(`Controles de escenario ${group.name} incompletos en ${snapshot.label}: ${missingGroupControls.join(", ")}`);
      }
    }
  }

  return notes;
}

async function collectVisualRouteTextSnapshots(page: any, route: AppQaRouteProbe): Promise<VisualRouteTextSnapshot[]> {
  const snapshots: VisualRouteTextSnapshot[] = [];
  const readBody = async (label: string) => {
    const text = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).trim();
    if (text) snapshots.push({ label, bodyText: text });
  };

  await readBody("initial");
  if (route.visualDisclosure) {
    const disclosure = page.getByRole("button", { name: route.visualDisclosure.buttonName, exact: true });
    if (await disclosure.count()) {
      await disclosure.click({ timeout: 5000 });
      await page.locator(route.visualDisclosure.panelSelector).waitFor({ state: "visible", timeout: 5000 });
      await readBody(route.visualDisclosure.buttonName);
    }
  }
  for (const tabLabel of route.visualTextTabs || []) {
    const tab = page.getByRole("tab", { name: tabLabel }).first();
    if (!(await tab.count().catch(() => 0))) continue;
    await tab.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(100).catch(() => undefined);
    await readBody(tabLabel);
  }

  const restoreTabLabel = route.visualTextTabs?.[0];
  if (restoreTabLabel) {
    const restoreTab = page.getByRole("tab", { name: restoreTabLabel }).first();
    if (await restoreTab.count().catch(() => 0)) {
      await restoreTab.click({ timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(100).catch(() => undefined);
    }
  }

  return snapshots;
}

function isVisualAuthScreen(bodyText: string): boolean {
  const normalized = normalizeVisualText(bodyText);
  return normalized.includes("blackops ceo")
    && normalized.includes("password")
    && (normalized.includes("entrar") || normalized.includes("crear cuenta"));
}

export async function probeAppQaUrl(url: string, timeoutMs = 5000, health = false, transport: typeof fetch = fetch): Promise<{ ok: boolean; statusCode?: number; responseTimeMs: number; error?: string }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await transport(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (response.status === 405 || response.status === 403) {
      response = await transport(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    const destination = new URL(response.url || url);
    const auth = destination.hostname === "replit.com" && ["/silent-auth", "/login", "/__replshield"].includes(destination.pathname);
    const htmlHealth = health && /text\/html/i.test(response.headers.get("content-type") || "");
    return {
      ok: response.ok && !auth && !htmlHealth,
      statusCode: response.status,
      responseTimeMs: Date.now() - startedAt,
      ...(auth ? { error: "authentication_required" } : htmlHealth ? { error: "health_returned_html" } : {}),
    };
  } catch (error: any) {
    return {
      ok: false,
      responseTimeMs: Date.now() - startedAt,
      error: error?.name === "AbortError" ? "Timeout" : error?.message || "Request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
const probeUrl = probeAppQaUrl;

export function analyzeRoutes(routes = LOCAL_ROUTE_MAP): AppQaSubAgentReport {
  const findings: AppQaFinding[] = [];
  const syntheticApp = {
    name: "ASITENTE",
  } as AppProject;

  for (const route of routes) {
    if (!route.path.startsWith("/")) {
      findings.push(createFinding(
        syntheticApp,
        "route-scout",
        route.label,
        "high",
        "Ruta mal formada",
        `${route.label} usa un path que no empieza con slash: ${route.path}.`,
        "Corregir el path antes de exponerlo en navegacion.",
        route.path
      ));
    }
    if (!route.expectedClicks.length) {
      findings.push(createFinding(
        syntheticApp,
        "route-scout",
        route.label,
        "low",
        "Ruta sin acciones esperadas",
        `${route.label} no tiene clicks esperados para QA.`,
        "Definir acciones clave para que el subagente pueda detectar botones o flows faltantes.",
        route.path
      ));
    }
  }

  const coverage = routeMissionCoverage(routes);
  for (const routePath of [...coverage.unclassifiedPaths, ...coverage.duplicatePaths]) {
    findings.push(createFinding(syntheticApp, 'route-scout', 'Cobertura por misión', 'high', 'Ruta sin clasificación única', `La ruta ${routePath} es desconocida o está duplicada.`, 'Asignar una misión explícita y conservar una única entrada de inventario.', routePath));
  }
  return {
    id: "route-scout",
    name: "Route Scout",
    status: statusFromFindings(findings),
    summary: findings.length
      ? `Mapa de rutas con ${findings.length} puntos por completar.`
      : `Mapa local listo: ${routes.length} paginas, ${routes.reduce((sum, route) => sum + route.expectedClicks.length, 0)} clicks esperados y ${routes.reduce((sum, route) => sum + countExpectedVisualControls(route), 0)} controles visuales.`,
    checked: routes.length,
    findings,
  };
}

export function analyzeAppTelemetry(contexts: AppQaContext[]): AppQaSubAgentReport {
  const findings = contexts.flatMap(({ app, healthChecks, incidents, errors }) => {
    const appFindings: AppQaFinding[] = [];
    const recentFailures = healthChecks.filter((check) => check.status === "failed").slice(0, 3);
    const openIncidents = incidents.filter((incident) => ["open", "investigating", "pending_action"].includes(incident.status));
    const highErrors = errors.filter((event) => ["error", "fatal"].includes(event.level)).slice(0, 5);

    for (const check of recentFailures) {
      appFindings.push(createFinding(
        app,
        "error-scout",
        "Health checks",
        "high",
        "Health check fallando",
        `${check.checkedUrl || app.name} fallo${check.statusCode ? ` con status ${check.statusCode}` : ""}. ${check.errorMessage || ""}`.trim(),
        "Revisar logs/deploy y repetir el check antes de mandar trafico.",
        check.checkedUrl
      ));
    }

    for (const incident of openIncidents.slice(0, 5)) {
      appFindings.push(createFinding(
        app,
        "error-scout",
        "Incidents",
        incident.severity === "critical" ? "critical" : incident.severity === "high" ? "high" : "medium",
        incident.title,
        incident.summary || "Incidente abierto sin resumen operativo.",
        "Asignar owner, reproducir el error y cerrar solo despues de verificar la recuperacion.",
        publicAppUrl(app)
      ));
    }

    for (const event of highErrors) {
      appFindings.push(createFinding(
        app,
        "error-scout",
        "Runtime errors",
        event.level === "fatal" ? "critical" : "high",
        event.title,
        event.message || `Error ${event.requestMethod || ""} ${event.requestPath || ""}`.trim(),
        "Agrupar por fingerprint, confirmar impacto de usuario y crear fix si se repite.",
        event.requestPath || publicAppUrl(app)
      ));
    }

    return appFindings;
  });

  return {
    id: "error-scout",
    name: "Error Scout",
    status: statusFromFindings(findings),
    summary: findings.length
      ? `Encontro ${findings.length} senales de errores, incidents o health checks fallando.`
      : "Sin errores abiertos en la telemetria conectada.",
    checked: contexts.reduce((sum, context) => sum + context.healthChecks.length + context.incidents.length + context.errors.length, 0),
    findings,
  };
}

export function analyzeImprovementIdeas(apps: AppProject[], routes = LOCAL_ROUTE_MAP): AppQaSubAgentReport {
  const findings: AppQaFinding[] = [];
  const syntheticApp = { name: "ASITENTE" } as AppProject;
  const productAreas = new Set(routes.map((route) => route.path.split("/")[1] || "dashboard"));

  if (!apps.length) {
    findings.push(createFinding(
      syntheticApp,
      "improvement-scout",
      "Inventory",
      "medium",
      "No hay apps en Developer Health",
      "El QA Agent puede revisar mejor cuando cada app tiene publicUrl, healthUrl, repo y prioridad.",
      "Importar repos/apps desde GitHub o crear los proyectos principales en Apps.",
      "/projects"
    ));
  }

  if (!productAreas.has("app-qa-agent")) {
    findings.push(createFinding(
      syntheticApp,
      "improvement-scout",
      "QA loop",
      "info",
      "Inventariar el punto de acceso de App QA",
      "El corredor visual existe, pero su página de control no está incluida en este inventario de rutas.",
      "Incluir /app-qa-agent en el inventario y verificar sus controles con una sesión real.",
      "/app-qa-agent"
    ));
  }

  const coverage = routeMissionCoverage(routes);
  if (coverage.unclassifiedPaths.length || coverage.duplicatePaths.length || coverage.missingPaths.length) {
    findings.push(createFinding(syntheticApp, 'improvement-scout', 'Cobertura por misión', 'low', 'Clasificación por misiones incompleta', `Sin misión: ${coverage.unclassifiedPaths.join(', ') || 'ninguna'}. Duplicadas: ${coverage.duplicatePaths.join(', ') || 'ninguna'}. Sin inventariar: ${coverage.missingPaths.join(', ') || 'ninguna'}.`, 'Completar la clasificación y el inventario; mantener visibles cobertura y resultados por misión.', '/app-qa-agent'));
  }

  for (const app of apps.filter((app) => app.environment === "production" && app.priority !== "low")) {
    if (!app.healthUrl) {
      findings.push(createFinding(
        app,
        "improvement-scout",
        "Observability",
        "medium",
        "Agregar health endpoint",
        `${app.name} esta en produccion sin healthUrl dedicada.`,
        "Crear /health con status de DB, auth basica, jobs criticos y version de deploy.",
        publicAppUrl(app)
      ));
    }

    if (!app.testCommand || !app.buildCommand) {
      findings.push(createFinding(
        app,
        "improvement-scout",
        "Release metadata",
        "medium",
        "Agregar comandos de test/build",
        `${app.name} esta en produccion sin testCommand/buildCommand completos para handoffs PR-first.`,
        "Guardar los comandos exactos de test y build en Developer Health para que Codex/App QA puedan verificar cada release.",
        publicAppUrl(app)
      ));
    }
  }

  return {
    id: "improvement-scout",
    name: "Improvement Scout",
    status: statusFromFindings(findings.filter((finding) => finding.severity !== "info")),
    summary: findings.length ? `${findings.length} ideas accionables para subir calidad del app.` : "Sin ideas urgentes; mantener monitoreo.",
    checked: apps.length + routes.length,
    findings,
  };
}

type VisualClickScoutDependencies = {
  loadPlaywright?: () => Promise<any | null>;
};

export async function runVisualClickScout(
  routes = LOCAL_ROUTE_MAP,
  dependencies: VisualClickScoutDependencies = {},
): Promise<AppQaSubAgentReport & { visualScans: AppQaVisualRouteScan[] }> {
  const baseUrl = getVisualBaseUrl();
  const syntheticApp = { name: "Visual QA" } as AppProject;
  const visualScans: AppQaVisualRouteScan[] = [];
  const findings: AppQaFinding[] = [];

  if (!baseUrl) {
    findings.push(createFinding(
      syntheticApp,
      "visual-click-scout",
      "Visual QA setup",
      "high",
      "APP_QA_BASE_URL no configurado",
      "Visual Click Scout necesita una URL base para abrir el app con navegador.",
      "Configurar APP_QA_BASE_URL, por ejemplo http://127.0.0.1:5000 en local o el dominio de produccion.",
      null
    ));
    return {
      id: "visual-click-scout",
      name: "Visual Click Scout",
      status: "fail",
      summary: "No pude correr QA visual porque APP_QA_BASE_URL no esta configurado.",
      checked: 0,
      findings,
      visualScans,
    };
  }

  const playwright = await (dependencies.loadPlaywright ?? loadPlaywright)();

  if (!playwright?.chromium) {
    findings.push(createFinding(
      syntheticApp,
      "visual-click-scout",
      "Visual QA setup",
      "high",
      "Playwright no instalado",
      "Visual Click Scout no encontro el paquete playwright en node_modules.",
      "Instalar Playwright y Chromium: npm install playwright && npx playwright install chromium.",
      baseUrl
    ));
    return {
      id: "visual-click-scout",
      name: "Visual Click Scout",
      status: "fail",
      summary: "Playwright no esta instalado; QA visual queda pendiente.",
      checked: 0,
      findings,
      visualScans,
    };
  }

  await mkdir(VISUAL_SCREENSHOT_DIR, { recursive: true });
  let browser: any;
  try {
    const executablePath = resolveChromiumExecutablePath();
    browser = await playwright.chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (error: any) {
    findings.push(createFinding(
      syntheticApp,
      "visual-click-scout",
      "Visual QA setup",
      "high",
      "Chromium no disponible",
      `Visual Click Scout encontro Playwright, pero no pudo arrancar Chromium: ${error?.message || "browser launch failed"}.`,
      "Instalar Chromium en el runtime (por ejemplo pkgs.chromium en Replit/Nix) o ejecutar npx playwright install chromium antes de activar QA visual.",
      baseUrl
    ));
    return {
      id: "visual-click-scout",
      name: "Visual Click Scout",
      status: "fail",
      summary: "Playwright esta instalado, pero Chromium no pudo arrancar; QA visual queda pendiente.",
      checked: 0,
      findings,
      visualScans,
    };
  }

  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      ignoreHTTPSErrors: true,
    });

    // Authentication must come from a backend session; localStorage is not evidence.

    for (const route of routes) {
      const url = new URL(route.path, baseUrl).toString();
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const clicked: string[] = [];
      const notes: string[] = [];
      let status: AppQaStatus | "pending" = "pass";
      let screenshotPath: string | null = null;
      let title: string | null = null;

      page.on("console", (message: any) => {
        if (message.type?.() === "error") {
          consoleErrors.push(message.text?.() || "Console error");
        }
      });
      page.on("pageerror", (error: Error) => {
        consoleErrors.push(error.message);
      });

      try {
        const response = await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
        title = await page.title().catch(() => null);
        const statusCode = response?.status?.() || 0;
        const bodySnapshots = await collectVisualRouteTextSnapshots(page, route);
        const bodyText = bodySnapshots.map((snapshot) => snapshot.bodyText).join("\n");

        if (statusCode >= 400) {
          status = "fail";
          notes.push(`HTTP ${statusCode}`);
        }

        if (isVisualAuthScreen(bodyText)) {
          notes.push("Verificación pendiente: no hay una sesión autorizada para esta ruta protegida.");
          findings.push(createFinding(
            syntheticApp, "visual-click-scout", route.label, "medium",
            "Verificación visual pendiente de sesión",
            `${route.label} (${route.path}) mostró el acceso. La página protegida no fue verificada.`,
            "Ejecutar la comprobación con una sesión de backend autorizada. No contar el login como evidencia de la ruta.",
            url
          ));
          visualScans.push({ path: route.path, url, status: "pending", title, consoleErrors, clicked: [], screenshotPath: null, notes });
          await page.close().catch(() => undefined);
          continue;
        }
        if (bodyText.length < 10) {
          status = "fail";
          notes.push("Pagina en blanco o casi vacia");
        }
        if (consoleErrors.length) {
          status = "fail";
          notes.push(`${consoleErrors.length} errores de consola`);
        }
        const controlNotes = evaluateExpectedVisualControlSnapshots(bodySnapshots, route);
        if (controlNotes.length) {
          status = "fail";
          notes.push(...controlNotes);
        }

        const links = page.locator('a[href^="/"]');
        const totalLinks = Math.min(await links.count().catch(() => 0), 12);
        for (let index = 0; index < totalLinks && clicked.length < 3; index++) {
          const link = links.nth(index);
          const text = ((await link.innerText().catch(() => "")) || "").trim();
          const href = await link.getAttribute("href").catch(() => null);
          if (!isSafeVisualClick(text, href)) continue;
          await link.click({ timeout: 3000 }).catch((error: Error) => {
            status = "fail";
            notes.push(`Click fallo: ${text || href} (${error.message})`);
          });
          clicked.push(text || href || "link interno");
          await page.goBack({ waitUntil: "networkidle", timeout: 5000 }).catch(() => undefined);
        }
      } catch (error: any) {
        status = "fail";
        notes.push(error?.message || "Fallo abriendo pagina");
      }

      if (consoleErrors.length && status !== 'fail') {
        status = 'fail';
        notes.push(`${consoleErrors.length} errores de consola durante navegación`);
      }
      if (status === "fail") {
        screenshotPath = path.join(VISUAL_SCREENSHOT_DIR, screenshotName(route.path));
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
        findings.push(createFinding(
          syntheticApp,
          "visual-click-scout",
          route.label,
          "high",
          "QA visual fallo",
          `${route.label} (${route.path}) fallo en navegador: ${notes.join("; ") || "error visual"}.`,
          "Abrir screenshot, revisar consola/ruta y corregir el componente o endpoint que rompe la pagina.",
          url,
          screenshotPath
        ));
      }

      visualScans.push({
        path: route.path,
        url,
        status,
        title,
        consoleErrors,
        clicked,
        screenshotPath,
        notes: notes.length ? notes : ["Visual OK"],
      });
      await page.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  return {
    id: "visual-click-scout",
    name: "Visual Click Scout",
    status: statusFromFindings(findings),
    summary: `QA visual: ${visualScans.filter(scan => scan.status !== "pending").length} rutas verificadas; ${visualScans.filter(scan => scan.status === "pending").length} pendientes de sesión; ${visualScans.filter(scan => scan.status === "fail").length} fallos.`,
    checked: visualScans.filter(scan => scan.status !== "pending").length,
    findings,
    visualScans,
  };
}

export async function analyzeGithubAppRepos(
  apps: AppProject[],
  repos: GithubRepo[],
  probe = probeUrl,
): Promise<AppQaSubAgentReport & { githubApps: AppQaGithubRepoCheck[] }> {
  const connectedAppsByRepo = new Map(apps.map((app) => [normalizeRepo(app), app]).filter(([repo]) => Boolean(repo)) as Array<[string, AppProject]>);
  const connectedRepos = new Set(connectedAppsByRepo.keys());
  const findings: AppQaFinding[] = [];
  const githubApps: AppQaGithubRepoCheck[] = [];
  const syntheticApp = { name: "GitHub" } as AppProject;
  const likelyRepos = repos.filter((repo) => isLikelyGithubAppRepo(repo) && !repo.fork);

  for (const repo of likelyRepos) {
    const connectedToInventory = connectedRepos.has(repo.full_name.toLowerCase());
    const connectedApp = connectedAppsByRepo.get(repo.full_name.toLowerCase());
    const inventoryUrl = connectedApp ? publicAppUrl(connectedApp) : null;
    const homepage = repo.homepage?.trim() || null;
    const notes: string[] = [];
    let status: AppQaStatus = "pass";
    let checkedUrl: string | null = null;

    if (repo.disabled) {
      status = "fail";
      notes.push("Repo disabled");
      findings.push(createFinding(
        syntheticApp,
        "github-scout",
        "GitHub inventory",
        "high",
        "Repo disabled en GitHub",
        `${repo.full_name} aparece disabled en GitHub.`,
        "Revisar acceso, facturacion o restricciones del repo antes de depender de ese app.",
        repo.html_url
      ));
    }

    if (repo.archived) {
      status = status === "fail" ? status : "warn";
      notes.push("Archivado");
    }

    if (!connectedToInventory && !repo.archived && !repo.disabled) {
      status = status === "fail" ? status : "warn";
      notes.push("Nuevo/fuera de Developer Health");
      findings.push(createFinding(
        syntheticApp,
        "github-scout",
        "GitHub inventory",
        "medium",
        "Repo app fuera del inventario",
        `${repo.full_name} parece una app en GitHub, pero App QA todavia no la tiene conectada como App Project.`,
        "Importarlo o agregarlo en Apps con publicUrl, healthUrl, repo y prioridad para que quede bajo patrulla completa.",
        homepage || repo.html_url
      ));
    }

    if (!homepage && !inventoryUrl && !repo.archived && !repo.disabled) {
      status = status === "fail" ? status : "warn";
      notes.push("Sin homepage/deploy");
      findings.push(createFinding(
        syntheticApp,
        "github-scout",
        "GitHub deploy",
        connectedToInventory ? "low" : "medium",
        "Repo app sin URL publica en GitHub",
        `${repo.full_name} parece app, pero no tiene homepage/deploy configurado en GitHub.`,
        "Agregar homepage o conectar publicUrl/healthUrl en Apps para que el QA pueda entrar y revisar.",
        repo.html_url
      ));
    }

    if (homepage || inventoryUrl) {
      const urlToCheck = homepage || inventoryUrl!;
      checkedUrl = urlToCheck;
      if (!homepage && inventoryUrl) {
        notes.push("URL conectada en Developer Health");
      }
      if (!isValidUrl(urlToCheck)) {
        status = "fail";
        notes.push(homepage ? "Homepage invalida" : "URL inventario invalida");
        findings.push(createFinding(
          syntheticApp,
          "github-scout",
          "GitHub deploy",
          "high",
          homepage ? "Homepage invalida en GitHub" : "URL de inventario invalida",
          `${repo.full_name} tiene URL invalida: ${urlToCheck}.`,
          "Corregir homepage en GitHub o la URL real en Apps.",
          repo.html_url
        ));
      } else {
        if (!urlToCheck.startsWith("https://")) {
          status = "fail";
          notes.push(homepage ? "Homepage sin HTTPS" : "URL inventario sin HTTPS");
          findings.push(createFinding(
            syntheticApp,
            "github-scout",
            "GitHub deploy",
            "high",
            homepage ? "Homepage sin HTTPS" : "URL de inventario sin HTTPS",
            `${repo.full_name} publica ${urlToCheck} sin HTTPS.`,
            "Mover el deploy a HTTPS antes de manejar usuarios, sesiones, pagos o webhooks.",
            urlToCheck
          ));
        }

        const probeResult = await probe(urlToCheck);
        if (!probeResult.ok) {
          status = "fail";
          notes.push(`Homepage fallo: ${probeResult.statusCode || probeResult.error || "sin status"}`);
          findings.push(createFinding(
            syntheticApp,
            "github-scout",
            "GitHub deploy",
            "high",
            "Homepage de repo no responde bien",
            `${repo.full_name} apunta a ${urlToCheck}, pero respondio ${probeResult.statusCode || probeResult.error || "sin status"} en ${probeResult.responseTimeMs}ms.`,
            "Revisar deploy/dominio y actualizar GitHub homepage o Apps si la URL cambio.",
            urlToCheck
          ));
        } else if (probeResult.responseTimeMs > 3000) {
          status = status === "fail" ? status : "warn";
          notes.push(`Homepage lenta: ${probeResult.responseTimeMs}ms`);
          findings.push(createFinding(
            syntheticApp,
            "github-scout",
            "GitHub deploy",
            "medium",
            "Homepage lenta desde GitHub",
            `${repo.full_name} respondio en ${probeResult.responseTimeMs}ms.`,
            "Revisar cold starts, assets y servidor del deploy.",
            urlToCheck
          ));
        } else {
          notes.push(`Homepage ok: ${probeResult.statusCode}`);
        }
      }
    }

    if ((repo.open_issues_count || 0) >= 25 && !repo.archived) {
      status = status === "fail" ? status : "warn";
      notes.push(`${repo.open_issues_count} issues abiertos`);
    }

    if (!notes.length) notes.push("Sin senales basicas de riesgo");

    githubApps.push({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      homepage,
      language: repo.language,
      private: repo.private,
      archived: repo.archived,
      disabled: repo.disabled,
      fork: repo.fork,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at,
      openIssuesCount: repo.open_issues_count,
      connectedToInventory,
      checkedUrl,
      status,
      notes,
    });
  }

  return {
    id: "github-scout",
    name: "GitHub Scout",
    status: statusFromFindings(findings),
    summary: findings.length
      ? `Reviso ${likelyRepos.length} repos que parecen apps y encontro ${findings.length} hallazgos.`
      : `GitHub Scout reviso ${likelyRepos.length} repos tipo app sin fallos principales.`,
    checked: likelyRepos.length,
    findings,
    githubApps,
  };
}

function buildGithubDisconnectedReport(error: string | null): AppQaSubAgentReport & { githubApps: AppQaGithubRepoCheck[] } {
  const syntheticApp = { name: "GitHub" } as AppProject;
  const findings = [
    createFinding(
      syntheticApp,
      "github-scout",
      "GitHub connection",
      "high",
      "GitHub no conectado para App QA",
      error || "App QA no pudo leer los repos de GitHub en esta patrulla.",
      "Conectar GitHub para que el agente revise todos los apps actuales y los repos nuevos automaticamente.",
      "/github-agent"
    ),
  ];

  return {
    id: "github-scout",
    name: "GitHub Scout",
    status: "fail",
    summary: "GitHub no esta disponible; no pude revisar repos nuevos ni apps fuera del inventario.",
    checked: 0,
    findings,
    githubApps: [],
  };
}

async function analyzeLinksAndClicks(apps: AppProject[]): Promise<AppQaSubAgentReport> {
  const findings: AppQaFinding[] = [];
  let checked = 0;

  for (const app of apps) {
    const url = publicAppUrl(app);
    if (!url) {
      findings.push(createFinding(
        app,
        "link-click-scout",
        "Coverage",
        app.environment === "production" ? "medium" : "low",
        "App sin URL para entrar",
        "No hay publicUrl ni healthUrl para que el subagente se meta a revisar.",
        "Agregar URL publica o staging URL para que pueda probar paginas y clicks.",
        null
      ));
      continue;
    }

    if (!isValidUrl(url)) {
      findings.push(createFinding(
        app,
        "link-click-scout",
        "Links",
        "high",
        "URL invalida",
        `${url} no es una URL HTTP/HTTPS valida.`,
        "Corregir publicUrl/healthUrl en Apps.",
        url
      ));
      continue;
    }

    checked++;
    if (!url.startsWith("https://") && app.environment === "production") {
      findings.push(createFinding(
        app,
        "link-click-scout",
        "Links",
        "high",
        "Produccion sin HTTPS",
        `${app.name} esta expuesta con URL no segura: ${url}.`,
        "Mover a HTTPS antes de manejar sesiones, pagos, webhooks o datos de usuario.",
        url
      ));
    }

    const probe = await probeUrl(url);
    if (!probe.ok) {
      findings.push(createFinding(
        app,
        "link-click-scout",
        "Page load",
        probe.error === "authentication_required" ? "medium" : "high",
        probe.error === "authentication_required" ? "Pagina requiere comprobacion autenticada" : "Pagina principal no responde bien",
        `${url} respondio ${probe.error || probe.statusCode || "sin status"} en ${probe.responseTimeMs}ms.`,
        probe.error === "authentication_required" ? "Verificar con una sesion autorizada sin retirar la proteccion de acceso." : "Revisar deploy, dominio, auth gate y logs del servidor.",
        url
      ));
    } else if (probe.responseTimeMs > 3000) {
      findings.push(createFinding(
        app,
        "link-click-scout",
        "Performance",
        "medium",
        "Pagina lenta",
        `${url} respondio en ${probe.responseTimeMs}ms.`,
        "Revisar cold starts, assets pesados y endpoints iniciales.",
        url
      ));
    }
  }

  return {
    id: "link-click-scout",
    name: "Link + Click Scout",
    status: statusFromFindings(findings),
    summary: findings.length
      ? `Reviso ${checked} URLs y encontro ${findings.length} problemas o huecos.`
      : `URLs base revisadas sin fallos. Clicks esperados inventariados para ${LOCAL_ROUTE_MAP.length} paginas locales.`,
    checked,
    findings,
  };
}

async function analyzeApis(apps: AppProject[]): Promise<AppQaSubAgentReport> {
  const findings: AppQaFinding[] = [];
  let checked = 0;

  for (const app of apps) {
    if (!app.healthUrl) continue;
    checked++;
    if (!isValidUrl(app.healthUrl)) {
      findings.push(createFinding(
        app,
        "api-scout",
        "Health endpoint",
        "high",
        "Health URL invalida",
        `${app.healthUrl} no es una URL valida.`,
        "Corregir el healthUrl para que el monitor pueda probarlo.",
        app.healthUrl
      ));
      continue;
    }

    const probe = await probeUrl(app.healthUrl, 5000, true);
    if (!probe.ok) {
      findings.push(createFinding(
        app,
        "api-scout",
        "Health endpoint",
        probe.error === "authentication_required" ? "medium" : "critical",
        probe.error === "authentication_required" ? "Health requiere acceso autenticado" : "Health endpoint sin evidencia valida",
        `${app.healthUrl} respondio ${probe.error || probe.statusCode || "sin status"} en ${probe.responseTimeMs}ms.`,
        probe.error === "authentication_required" ? "Configurar una comprobacion autenticada; no desactivar la privacidad ni interpretar la pagina de acceso como salud de la app." : "Tratarlo como bloqueo de release hasta confirmar que la app esta saludable.",
        app.healthUrl
      ));
    }
  }

  const appsWithoutHealth = apps.filter((app) => app.environment === "production" && ["high", "critical"].includes(app.priority) && !app.healthUrl);
  for (const app of appsWithoutHealth) {
    findings.push(createFinding(
      app,
      "api-scout",
      "Health endpoint",
      "medium",
      "App importante sin API de salud",
      "No hay healthUrl para verificar backend, base de datos o jobs.",
      "Crear endpoint /health y conectarlo en Developer Health.",
      publicAppUrl(app)
    ));
  }

  return {
    id: "api-scout",
    name: "API Scout",
    status: statusFromFindings(findings),
    summary: findings.length ? `APIs/health checks con ${findings.length} hallazgos.` : "Health endpoints conectados responden correctamente.",
    checked,
    findings,
  };
}

export async function runAppQaScan(
  userId: string,
  notify = false,
  recordHistory = false,
  allowDailyDigest = false,
  targetContext?: AppQaTargetContext,
): Promise<AppQaScanResult> {
  const startedAt = new Date();
  let apps: AppProject[];
  let storage: typeof import("./storage").storage;
  try {
    ({ storage } = await import("./storage"));
    apps = await storage.getAppProjects(userId);
  } catch (error) {
    const unavailableResult = buildAppQaStorageUnavailableResult(error, startedAt, targetContext);
    if (recordHistory) {
      await recordAppQaHistory(userId, unavailableResult, startedAt);
    }
    return unavailableResult;
  }
  let githubConnected = false;
  let githubError: string | null = null;
  let totalGithubRepos = 0;
  let githubReport: AppQaSubAgentReport & { githubApps: AppQaGithubRepoCheck[] };

  try {
    githubConnected = await isGitHubConnected();
    if (githubConnected) {
      const repos = await listRepositories();
      totalGithubRepos = repos.length;
      githubReport = await analyzeGithubAppRepos(apps, repos);
    } else {
      githubError = "GitHub no conectado";
      githubReport = buildGithubDisconnectedReport(githubError);
    }
  } catch (error: any) {
    githubError = error?.message || "No se pudo leer GitHub";
    githubReport = buildGithubDisconnectedReport(githubError);
  }

  const contexts = await Promise.all(apps.map(async (app) => ({
    app,
    healthChecks: await storage.getAppHealthChecks(app.id, 20),
    incidents: await storage.getAppIncidentsForProject(app.id),
    errors: await storage.getAppErrorEvents(app.id, 20),
  })));
  const visualReport = (notify || recordHistory || allowDailyDigest) && shouldRunVisualScout({ userId, notify, allowDailyDigest, targetContext, now: startedAt })
    ? await runVisualClickScout()
    : buildSkippedVisualScoutReport();

  const subAgents = [
    analyzeRoutes(),
    await analyzeLinksAndClicks(apps),
    visualReport,
    githubReport,
    await analyzeApis(apps),
    analyzeAppTelemetry(contexts),
    analyzeImprovementIdeas(apps),
  ];

  const findings = subAgents.flatMap((agent) => agent.findings).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const improvementIdeas = findings.filter((finding) => finding.sourceAgent === "improvement-scout");
  const failCount = findings.filter((finding) => ["critical", "high"].includes(finding.severity)).length;
  const warnCount = findings.filter((finding) => ["medium", "low"].includes(finding.severity)).length;
  const bugPatrol = recordHistory
    ? await runBugPatrolHandoffs(userId, apps, findings)
    : emptyBugPatrolReport();
  const council = buildQaCouncil({
    subAgents,
    findings,
    githubConnected,
    githubApps: githubReport.githubApps,
    failCount,
    warnCount,
  });

  const result: AppQaScanResult = {
    scannedAt: new Date().toISOString(),
    targetContext,
    totalApps: apps.length,
    totalGithubRepos,
    totalGithubAppRepos: githubReport.githubApps.length,
    githubConnected,
    githubError,
    totalRoutes: LOCAL_ROUTE_MAP.length,
    totalChecks: subAgents.reduce((sum, agent) => sum + agent.checked, 0),
    failCount,
    warnCount,
    telegramSent: false,
    dailyDigestSent: false,
    summary: failCount
      ? `QA Agent encontro ${failCount} bloqueos altos y ${warnCount} avisos.`
      : warnCount
        ? `QA Agent no vio bloqueos altos, pero dejo ${warnCount} mejoras/avisos.`
        : "QA Agent no encontro bloqueos en rutas, URLs, APIs ni telemetria conectada.",
    council,
    subAgents,
    routeMap: LOCAL_ROUTE_MAP,
    missionBreakdown: buildMissionBreakdown(LOCAL_ROUTE_MAP, visualReport.visualScans, findings, getVisualBaseUrl()),
    visualScans: visualReport.visualScans,
    githubApps: githubReport.githubApps,
    bugPatrol,
    findings,
    improvementIdeas,
  };

  // Passive status scans must neither send alerts nor consume alert cooldown.
  if (notify || (recordHistory && shouldSendAutomaticAlert(userId, result))) {
    const telegramConfig = await storage.getTelegramConfig(userId);
    const botToken = getTelegramBotToken();
    if (telegramConfig?.enabled && telegramConfig.chatId && botToken) {
      result.telegramSent = await sendTelegramMessage(botToken, telegramConfig.chatId, formatTelegramReport(result));
      if (result.telegramSent) {
        await sendVisualFailureScreenshots(botToken, telegramConfig.chatId, result);
      }
    }
  }

  if (allowDailyDigest && shouldSendDailyDigest(userId)) {
    const telegramConfig = await storage.getTelegramConfig(userId);
    const botToken = getTelegramBotToken();
    if (telegramConfig?.enabled && telegramConfig.chatId && botToken) {
      result.dailyDigestSent = await sendTelegramMessage(botToken, telegramConfig.chatId, formatDailyDigest(result));
    }
  }

  if (recordHistory) {
    await recordAppQaHistory(userId, result, startedAt);
  }

  return result;
}

async function recordAppQaHistory(userId: string, result: AppQaScanResult, startedAt: Date): Promise<void> {
  try {
    const { recordScheduledAutomationRun } = await import("./automation-registry");
    await recordScheduledAutomationRun(userId, "app-qa-council", startedAt, {
      status: "success",
      resultSummary: result.summary,
      metadata: {
        scannedAt: result.scannedAt,
        councilStatus: result.council.status,
        failCount: result.failCount,
        warnCount: result.warnCount,
        totalApps: result.totalApps,
        totalGithubRepos: result.totalGithubRepos,
        totalGithubAppRepos: result.totalGithubAppRepos,
        githubConnected: result.githubConnected,
        telegramSent: result.telegramSent,
        dailyDigestSent: result.dailyDigestSent,
        targetContext: result.targetContext,
        bugPatrol: {
          enabled: result.bugPatrol.enabled,
          candidates: result.bugPatrol.candidates,
          created: result.bugPatrol.created,
          dispatched: result.bugPatrol.dispatched,
          skipped: result.bugPatrol.skipped,
          failed: result.bugPatrol.failed,
          handoffs: result.bugPatrol.handoffs.map((handoff) => ({
            appName: handoff.appName,
            title: handoff.title,
            severity: handoff.severity,
            repoFullName: handoff.repoFullName,
            status: handoff.status,
            issueUrl: handoff.issueUrl,
            reason: handoff.reason,
          })),
        },
        subAgents: result.subAgents.map((agent) => ({
          id: agent.id,
          status: agent.status,
          findings: agent.findings.length,
        })),
      },
    });
  } catch (error) {
    console.error("App QA history error:", error);
  }
}

export function startAppQaScheduler(): void {
  const intervalMs = getAppQaIntervalMs();
  console.log(`App QA agent scheduler started (${Math.round(intervalMs / 60000)} min, visual=${getVisualMode()})`);

  setInterval(async () => {
    try {
      const { storage } = await import("./storage");
      const configs = await storage.getEnabledTelegramConfigs();
      await Promise.all(configs.map((config) => runAppQaScan(config.userId, false, true, true)));
    } catch (error) {
      console.error("App QA scheduler error:", error);
    }
  }, intervalMs);
}

export const __appQaAgentInternals = {
  LOCAL_ROUTE_MAP,
  buildMissionBreakdown,
  routeMissionCoverage,
  analyzeRoutes,
  analyzeAppTelemetry,
  analyzeGithubAppRepos,
  analyzeImprovementIdeas,
  buildAppQaStorageUnavailableResult,
  buildQaCouncil,
  emptyBugPatrolReport,
  formatDailyDigest,
  formatTelegramReport,
  evaluateExpectedVisualControlSnapshots,
  evaluateExpectedVisualControls,
  findMissingExpectedVisualControls,
  isBugPatrolCandidate,
  isLikelyGithubAppRepo,
  isVisualAuthScreen,
  resolveChromiumExecutablePath,
  runBugPatrolHandoffs,
  runVisualClickScout,
  shouldRunVisualScout,
  shouldSendDailyDigest,
  shouldSendAutomaticAlert,
  isValidUrl,
};
