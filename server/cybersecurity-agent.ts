import type { AppIncident, AppProject, MonitoredProject } from "@shared/schema";
import { isGitHubConnected, listRepositories } from "./github-client";
import { storage } from "./storage";
import { escapeTelegramHtml, sendTelegramMessage } from "./telegram";
import { hasRealValue } from "./ceo-doctor-cli";

const AUTO_ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const lastAutomaticAlertByUser = new Map<string, { signature: string; sentAt: number }>();
const AUTOMATIC_ALERT_SIGNALS = new Set<CyberThreat["signal"]>(["uptime", "https", "incidents", "github"]);
const IMPORTANT_APP_REPO_KEYWORDS = ["blackops", "kong", "blackroom", "br-website", "dropkit"];
const LIKELY_APP_REPO_KEYWORDS = [
  "app",
  "site",
  "website",
  "web",
  "planner",
  "kong",
  "black",
  "room",
  "dropkit",
  "dashboard",
  "bot",
  "server",
  "client",
  "typescript",
  "javascript",
  "react",
  "node",
];

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return hasRealValue(token) ? token : null;
}

export type CyberThreatSeverity = "critical" | "high" | "medium" | "low";

export type CyberThreat = {
  id: string;
  appName: string;
  appUrl?: string | null;
  severity: CyberThreatSeverity;
  title: string;
  detail: string;
  recommendation: string;
  signal: "uptime" | "https" | "incidents" | "repo" | "coverage" | "priority" | "github";
};

export type CyberGithubRepoCheck = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
  language?: string | null;
  homepage?: string | null;
  htmlUrl: string;
  updatedAt?: string | null;
  pushedAt?: string | null;
  openIssuesCount?: number | null;
  connectedToMonitor: boolean;
  risk: CyberThreatSeverity;
  notes: string[];
};

export type CyberSkill = {
  id: string;
  name: string;
  priority: CyberThreatSeverity;
  helpsWith: string;
  nextStep: string;
};

export type CybersecurityScanResult = {
  scannedAt: string;
  totalApps: number;
  totalLegacyProjects: number;
  totalGithubRepos: number;
  githubConnected: boolean;
  githubError: string | null;
  threatCount: number;
  criticalCount: number;
  highCount: number;
  telegramSent: boolean;
  summary: string;
  threats: CyberThreat[];
  githubRepos: CyberGithubRepoCheck[];
  skills: CyberSkill[];
};

export type CyberInventoryImportResult = {
  imported: number;
  skipped: number;
  totalGithubRepos: number;
  githubConnected: boolean;
  apps: AppProject[];
  skippedRepos: Array<{
    fullName: string;
    reason: string;
  }>;
};

function severityRank(severity: CyberThreatSeverity): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}

function publicAppUrl(app: AppProject): string | null {
  return app.publicUrl || app.healthUrl || null;
}

function normalizeRepo(app: AppProject): string | null {
  if (app.githubRepo) return app.githubRepo;
  if (app.repoOwner && app.repoName) return `${app.repoOwner}/${app.repoName}`;
  return null;
}

function normalizeRepoValue(repo: string | null | undefined): string | null {
  return repo?.trim().toLowerCase() || null;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "app";
}

function friendlyRepoName(repoName: string): string {
  return repoName
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferPriorityFromRepo(repo: GithubRepo): AppProject["priority"] {
  const text = `${repo.full_name} ${repo.description || ""} ${repo.homepage || ""}`.toLowerCase();
  if (IMPORTANT_APP_REPO_KEYWORDS.some((word) => text.includes(word))) {
    return "high";
  }
  if (text.includes("production") || text.includes("prod") || text.includes("website") || text.includes("app")) {
    return "normal";
  }
  return "normal";
}

function createThreat(
  appName: string,
  appUrl: string | null | undefined,
  signal: CyberThreat["signal"],
  severity: CyberThreatSeverity,
  title: string,
  detail: string,
  recommendation: string
): CyberThreat {
  return {
    id: `${appName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${signal}-${severity}`,
    appName,
    appUrl,
    signal,
    severity,
    title,
    detail,
    recommendation,
  };
}

export function analyzeAppProject(app: AppProject, incidents: AppIncident[]): CyberThreat[] {
  const url = publicAppUrl(app);
  const repo = normalizeRepo(app);
  const openIncidents = incidents.filter((incident) =>
    ["open", "investigating", "pending_action"].includes(incident.status)
  );
  const threats: CyberThreat[] = [];

  if (app.status === "down") {
    threats.push(createThreat(
      app.name,
      url,
      "uptime",
      app.priority === "critical" ? "critical" : "high",
      "App caída",
      "La app aparece como down en el Developer Health Center.",
      "Revisar deploy, logs y health endpoint; enviar alerta por Telegram hasta que vuelva online."
    ));
  }

  if (app.status === "degraded") {
    threats.push(createThreat(
      app.name,
      url,
      "uptime",
      "medium",
      "App degradada",
      "La app responde, pero con señales de degradación.",
      "Revisar últimos errores, tiempo de respuesta y cambios recientes antes de escalar tráfico."
    ));
  }

  if (app.environment === "production" && ["high", "critical"].includes(app.priority) && !app.publicUrl) {
    threats.push(createThreat(
      app.name,
      url,
      "coverage",
      app.priority === "critical" ? "high" : "medium",
      "App importante sin URL pública",
      "Está en producción con prioridad alta, pero no tiene publicUrl para revisar superficie externa.",
      "Agregar el dominio/deploy público real para que Cybersecurity pueda mapear HTTPS, uptime y exposición."
    ));
  }

  if (url && !url.startsWith("https://")) {
    threats.push(createThreat(
      app.name,
      url,
      "https",
      app.environment === "production" ? "high" : "medium",
      "URL sin HTTPS",
      "La URL pública o de health no usa HTTPS.",
      "Mover a HTTPS y evitar mandar tokens, webhooks o datos sensibles por HTTP."
    ));
  }

  if (app.environment === "production" && ["high", "critical"].includes(app.priority) && !app.healthUrl) {
    threats.push(createThreat(
      app.name,
      url,
      "coverage",
      app.priority === "critical" ? "high" : "medium",
      "App importante sin health URL",
      "Está marcada como prioridad alta o crítica pero no tiene endpoint de salud dedicado.",
      "Crear /health o endpoint equivalente para monitoreo rápido y alertas confiables."
    ));
  }

  if (app.environment === "production" && !repo) {
    threats.push(createThreat(
      app.name,
      url,
      "repo",
      "medium",
      "Repo no conectado",
      "No hay repo GitHub asociado a esta app de producción.",
      "Conectar repo para que Cybersecurity pueda revisar cambios, PRs y trazabilidad."
    ));
  }

  for (const incident of openIncidents.slice(0, 3)) {
    threats.push(createThreat(
      app.name,
      url,
      "incidents",
      incident.severity === "critical" ? "critical" : incident.severity === "high" ? "high" : "medium",
      incident.title,
      incident.summary || "Hay un incidente abierto sin resolver.",
      "Investigar incidente, documentar causa y cerrar solo después de verificar recuperación."
    ));
  }

  return threats;
}

export function analyzeLegacyProject(project: MonitoredProject): CyberThreat[] {
  const threats: CyberThreat[] = [];

  if (project.status === "offline") {
    threats.push(createThreat(
      project.name,
      project.url,
      "uptime",
      "high",
      "Proyecto fuera de línea",
      project.responseTime ? `Último response time: ${project.responseTime}ms.` : "No está respondiendo al monitor actual.",
      "Revisar hosting, dominio, deploy y logs. Mantener Telegram activo para caídas."
    ));
  }

  if (project.status === "degraded") {
    threats.push(createThreat(
      project.name,
      project.url,
      "uptime",
      "medium",
      "Proyecto lento o degradado",
      "El monitor detectó respuesta lenta o estado degradado.",
      "Revisar performance, errores recientes y límites del proveedor."
    ));
  }

  if (project.url && !project.url.startsWith("https://")) {
    threats.push(createThreat(
      project.name,
      project.url,
      "https",
      "high",
      "Proyecto sin HTTPS",
      "La URL monitoreada no usa HTTPS.",
      "Configurar certificado SSL antes de manejar usuarios, pagos, webhooks o credenciales."
    ));
  }

  return threats;
}

type GithubRepo = Awaited<ReturnType<typeof listRepositories>>[number];

function connectedRepoSet(apps: AppProject[], legacyProjects: MonitoredProject[]): Set<string> {
  const repos = new Set<string>();
  for (const app of apps) {
    const repo = normalizeRepo(app);
    if (repo) repos.add(repo.toLowerCase());
  }
  for (const project of legacyProjects) {
    if (project.githubRepo) repos.add(project.githubRepo.toLowerCase());
  }
  return repos;
}

function appRepoSet(apps: AppProject[]): Set<string> {
  const repos = new Set<string>();
  for (const app of apps) {
    const repo = normalizeRepo(app);
    if (repo) repos.add(repo.toLowerCase());
  }
  return repos;
}

function isLikelyAppRepo(repo: GithubRepo): boolean {
  const text = `${repo.name} ${repo.description || ""} ${repo.language || ""}`.toLowerCase();
  return LIKELY_APP_REPO_KEYWORDS.some((word) => text.includes(word));
}

function analyzeGithubRepo(repo: GithubRepo, connectedRepos: Set<string>): { check: CyberGithubRepoCheck; threats: CyberThreat[] } {
  const fullName = repo.full_name;
  const connectedToMonitor = connectedRepos.has(fullName.toLowerCase());
  const notes: string[] = [];
  const threats: CyberThreat[] = [];
  let risk: CyberThreatSeverity = "low";
  const likelyApp = isLikelyAppRepo(repo);

  if (repo.disabled) {
    risk = "high";
    notes.push("Repo disabled");
    threats.push(createThreat(
      fullName,
      repo.html_url,
      "github",
      "high",
      "Repo disabled en GitHub",
      "GitHub marca este repo como disabled.",
      "Revisar acceso, facturación, políticas o problemas de seguridad del repo."
    ));
  }

  if (repo.homepage && !repo.homepage.startsWith("https://")) {
    risk = severityRank(risk) < severityRank("high") ? "high" : risk;
    notes.push("Homepage sin HTTPS");
    threats.push(createThreat(
      fullName,
      repo.homepage,
      "https",
      "high",
      "Homepage de GitHub sin HTTPS",
      "El repo tiene homepage pública configurada sin HTTPS.",
      "Mover el dominio/deploy a HTTPS antes de manejar usuarios, pagos o webhooks."
    ));
  }

  if (!connectedToMonitor && likelyApp && !repo.fork && !repo.archived) {
    risk = severityRank(risk) < severityRank("medium") ? "medium" : risk;
    notes.push("No está conectado al monitor");
    threats.push(createThreat(
      fullName,
      repo.homepage || repo.html_url,
      "coverage",
      "medium",
      "Repo de app fuera del monitor",
      "Parece una app o website en GitHub, pero no está conectado a Developer Health ni Projects.",
      "Importarlo al inventario con URL pública, health URL, repo y prioridad."
    ));
  }

  if (!repo.homepage && likelyApp && !repo.archived && !repo.fork) {
    risk = severityRank(risk) < severityRank("low") ? "low" : risk;
    notes.push("Sin deploy/homepage pública");
  }

  if ((repo.open_issues_count || 0) >= 25 && !repo.archived) {
    risk = severityRank(risk) < severityRank("medium") ? "medium" : risk;
    notes.push(`${repo.open_issues_count} issues abiertos`);
  }

  if (repo.archived) {
    notes.push("Archivado");
  }

  if (!notes.length) notes.push("Sin señales básicas de riesgo");

  return {
    check: {
      id: repo.id,
      name: repo.name,
      fullName,
      private: repo.private,
      archived: repo.archived,
      disabled: repo.disabled,
      fork: repo.fork,
      language: repo.language,
      homepage: repo.homepage,
      htmlUrl: repo.html_url,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at,
      openIssuesCount: repo.open_issues_count,
      connectedToMonitor,
      risk,
      notes,
    },
    threats,
  };
}

function githubRepoToAppProjectInput(repo: GithubRepo) {
  const [repoOwner, repoName] = repo.full_name.split("/");
  const homepage = repo.homepage?.trim();
  const publicUrl = homepage && /^https?:\/\//i.test(homepage) ? homepage : null;

  return {
    name: friendlyRepoName(repo.name),
    slug: slugify(repo.name),
    description: repo.description || `Inventario importado desde GitHub: ${repo.full_name}`,
    environment: "production" as const,
    publicUrl,
    healthUrl: null,
    repoOwner: repoOwner || null,
    repoName: repoName || repo.name,
    githubRepo: repo.full_name,
    deploymentProvider: publicUrl ? "github-homepage" : null,
    deploymentId: null,
    testCommand: null,
    buildCommand: null,
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    priority: inferPriorityFromRepo(repo),
    ownerLabel: "Robert",
    tags: [
      "github-import",
      ...(publicUrl ? [] : ["needs-public-url"]),
      "needs-health-url",
      "needs-test-command",
      "needs-build-command",
    ],
  };
}

export async function importMissingGithubApps(userId: string): Promise<CyberInventoryImportResult> {
  const [apps, repos] = await Promise.all([
    storage.getAppProjects(userId),
    listRepositories(),
  ]);
  const existingAppRepos = appRepoSet(apps);
  const importedApps: AppProject[] = [];
  const skippedRepos: CyberInventoryImportResult["skippedRepos"] = [];
  let skipped = 0;

  for (const repo of repos) {
    const repoKey = normalizeRepoValue(repo.full_name);
    if (!repoKey) {
      skipped++;
      skippedRepos.push({ fullName: repo.full_name, reason: "Repo invalido" });
      continue;
    }

    if (existingAppRepos.has(repoKey)) {
      skipped++;
      skippedRepos.push({ fullName: repo.full_name, reason: "Ya existe en Developer Health" });
      continue;
    }

    if (repo.archived || repo.disabled || repo.fork || !isLikelyAppRepo(repo)) {
      skipped++;
      skippedRepos.push({ fullName: repo.full_name, reason: "No parece una app activa para monitoreo" });
      continue;
    }

    const created = await storage.createAppProject(userId, githubRepoToAppProjectInput(repo));
    existingAppRepos.add(repoKey);
    importedApps.push(created);
  }

  return {
    imported: importedApps.length,
    skipped,
    totalGithubRepos: repos.length,
    githubConnected: true,
    apps: importedApps,
    skippedRepos,
  };
}

export const __cybersecurityAgentInternals = {
  alertSignature,
  automaticAlertSignature,
  githubRepoToAppProjectInput,
  inferPriorityFromRepo,
  isLikelyAppRepo,
};

function recommendSkills(threats: CyberThreat[]): CyberSkill[] {
  const skills: CyberSkill[] = [
    {
      id: "attack-surface-map",
      name: "Attack Surface Mapper",
      priority: "high",
      helpsWith: "Mantener inventario de dominios, health URLs, repos, webhooks y apps críticas.",
      nextStep: "Conectar cada app importante con publicUrl, healthUrl, repo y prioridad.",
    },
    {
      id: "telegram-threat-brief",
      name: "Telegram Threat Brief",
      priority: "medium",
      helpsWith: "Mandarte reportes cortos y alertas urgentes cuando algo se cae o se ve riesgoso.",
      nextStep: "Usar el scan manual y luego activar reportes programados.",
    },
  ];

  if (threats.some((threat) => threat.signal === "https")) {
    skills.push({
      id: "tls-watch",
      name: "TLS / HTTPS Watch",
      priority: "high",
      helpsWith: "Detectar apps sin HTTPS o dominios que no deberían recibir datos sensibles.",
      nextStep: "Añadir revisión de certificados y fecha de expiración.",
    });
  }

  if (threats.some((threat) => threat.signal === "incidents" || threat.signal === "uptime")) {
    skills.push({
      id: "incident-responder",
      name: "Incident Responder",
      priority: "high",
      helpsWith: "Convertir caídas e incidentes en pasos claros: impacto, causa probable y siguiente acción.",
      nextStep: "Crear playbooks por app: Kong, Black Room, planner y nuevas apps.",
    });
  }

  if (threats.some((threat) => threat.signal === "repo" || threat.signal === "coverage")) {
    skills.push({
      id: "repo-security-review",
      name: "Repo Security Review",
      priority: "medium",
      helpsWith: "Revisar trazabilidad de cambios, ramas, PRs y checks antes de publicar.",
      nextStep: "Conectar todos los repos GitHub de apps críticas.",
    });
  }

  if (threats.some((threat) => threat.signal === "github")) {
    skills.push({
      id: "github-security-inventory",
      name: "GitHub Security Inventory",
      priority: "high",
      helpsWith: "Revisar todos los repos, detectar apps fuera del monitor y mantener trazabilidad.",
      nextStep: "Sincronizar GitHub en cada scan y promover repos importantes a Developer Health.",
    });
  }

  return skills.sort((a, b) => severityRank(b.priority) - severityRank(a.priority));
}

function formatTelegramReport(result: CybersecurityScanResult): string {
  const topThreats = result.threats.slice(0, 6);
  const threatLines = topThreats.length
    ? topThreats.map((threat) =>
        `• [${threat.severity.toUpperCase()}] ${threat.appName}: ${threat.title} — ${threat.recommendation}`
      ).join("\n")
    : "• No vi amenazas activas en este scan.";

  return escapeTelegramHtml(
    `🛡️ Cybersecurity Agent\n\n` +
    `${result.summary}\n\n` +
    `Apps revisadas: ${result.totalApps}\n` +
    `Projects legacy: ${result.totalLegacyProjects}\n` +
    `Repos GitHub: ${result.githubConnected ? result.totalGithubRepos : "no conectado"}\n` +
    `Amenazas: ${result.threatCount} (${result.criticalCount} críticas, ${result.highCount} altas)\n\n` +
    `${threatLines}\n\n` +
    `Skills sugeridas:\n${result.skills.slice(0, 4).map((skill) => `• ${skill.name}: ${skill.nextStep}`).join("\n")}`
  );
}

function alertSignature(result: CybersecurityScanResult): string {
  return result.threats
    .filter((threat) => threat.severity === "critical" || threat.severity === "high")
    .map((threat) => `${threat.appName}:${threat.signal}:${threat.severity}:${threat.title}`)
    .sort()
    .join("|");
}

function automaticAlertSignature(result: CybersecurityScanResult): string {
  return result.threats
    .filter((threat) => (
      (threat.severity === "critical" || threat.severity === "high") &&
      AUTOMATIC_ALERT_SIGNALS.has(threat.signal)
    ))
    .map((threat) => `${threat.appName}:${threat.signal}:${threat.severity}:${threat.title}`)
    .sort()
    .join("|");
}

function shouldSendAutomaticAlert(userId: string, result: CybersecurityScanResult): boolean {
  const signature = automaticAlertSignature(result);
  if (!signature) return false;

  const previous = lastAutomaticAlertByUser.get(userId);
  const now = Date.now();
  if (previous?.signature === signature && now - previous.sentAt < AUTO_ALERT_COOLDOWN_MS) {
    return false;
  }

  lastAutomaticAlertByUser.set(userId, { signature, sentAt: now });
  return true;
}

type CybersecurityScanOptions = {
  notify?: boolean;
  allowAutomaticAlert?: boolean;
};

function normalizeScanOptions(options: boolean | CybersecurityScanOptions): Required<CybersecurityScanOptions> {
  if (typeof options === "boolean") {
    return { notify: options, allowAutomaticAlert: options };
  }

  return {
    notify: Boolean(options.notify),
    allowAutomaticAlert: Boolean(options.allowAutomaticAlert),
  };
}

export async function runCybersecurityScan(
  userId: string,
  options: boolean | CybersecurityScanOptions = false
): Promise<CybersecurityScanResult> {
  const scanOptions = normalizeScanOptions(options);
  const [apps, legacyProjects, incidents] = await Promise.all([
    storage.getAppProjects(userId),
    storage.getMonitoredProjects(userId),
    storage.getAppIncidents(userId),
  ]);
  let githubConnected = false;
  let githubError: string | null = null;
  let githubRepoChecks: CyberGithubRepoCheck[] = [];
  let githubThreats: CyberThreat[] = [];

  try {
    githubConnected = await isGitHubConnected();
    if (githubConnected) {
      const repos = await listRepositories();
      const connectedRepos = connectedRepoSet(apps, legacyProjects);
      const repoAnalyses = repos.map((repo) => analyzeGithubRepo(repo, connectedRepos));
      githubRepoChecks = repoAnalyses.map((analysis) => analysis.check);
      githubThreats = repoAnalyses.flatMap((analysis) => analysis.threats);
    }
  } catch (error: any) {
    githubError = error.message || "No se pudo leer GitHub";
  }

  const threats = [
    ...apps.flatMap((app) => analyzeAppProject(app, incidents.filter((incident) => incident.appProjectId === app.id))),
    ...legacyProjects.flatMap(analyzeLegacyProject),
    ...githubThreats,
  ].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const result: CybersecurityScanResult = {
    scannedAt: new Date().toISOString(),
    totalApps: apps.length,
    totalLegacyProjects: legacyProjects.length,
    totalGithubRepos: githubRepoChecks.length,
    githubConnected,
    githubError,
    threatCount: threats.length,
    criticalCount: threats.filter((threat) => threat.severity === "critical").length,
    highCount: threats.filter((threat) => threat.severity === "high").length,
    telegramSent: false,
    summary: threats.length
      ? `Encontré ${threats.length} señales para revisar en apps, projects y GitHub. Prioridad: ${threats[0]?.severity.toUpperCase()}.`
      : "No encontré amenazas activas en las apps y repos conectados.",
    threats,
    githubRepos: githubRepoChecks.sort((a, b) => severityRank(b.risk) - severityRank(a.risk)),
    skills: recommendSkills(threats),
  };

  if (scanOptions.notify || (scanOptions.allowAutomaticAlert && shouldSendAutomaticAlert(userId, result))) {
    const telegramConfig = await storage.getTelegramConfig(userId);
    const botToken = getTelegramBotToken();
    if (telegramConfig?.enabled && telegramConfig.chatId && botToken) {
      result.telegramSent = await sendTelegramMessage(botToken, telegramConfig.chatId, formatTelegramReport(result));
    }
  }

  return result;
}

export function startCybersecurityScheduler(): void {
  const intervalMs = 15 * 60 * 1000;
  console.log("Cybersecurity agent scheduler started");

  setInterval(async () => {
    try {
      const configs = await storage.getEnabledTelegramConfigs();
      for (const config of configs) {
        await runCybersecurityScan(config.userId, { allowAutomaticAlert: true });
      }
    } catch (error) {
      console.error("Cybersecurity scheduler error:", error);
    }
  }, intervalMs);
}
