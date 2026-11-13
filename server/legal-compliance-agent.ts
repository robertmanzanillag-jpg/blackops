import type { AppProject, MonitoredProject } from "@shared/schema";
import { getRepositoryOverview, isGitHubConnected, listRepositories } from "./github-client";
import { storage } from "./storage";

export type LegalSeverity = "critico" | "revisar" | "info";

export type LegalRepoOverview = {
  full_name?: string;
  html_url?: string;
  homepage?: string | null;
  language?: string | null;
  pushed_at?: string | null;
  updated_at?: string | null;
  open_issues?: number | null;
  open_prs?: number | null;
  open_issues_count?: number | null;
  private?: boolean;
  archived?: boolean;
  disabled?: boolean;
  error?: string;
};

export type LegalConnectedTarget = {
  id: string;
  source: "developer_health" | "projects" | "github";
  appName: string;
  description?: string | null;
  url?: string | null;
  repo?: string | null;
  status?: string | null;
  environment?: string | null;
  priority?: string | null;
  tags?: unknown;
  github?: LegalRepoOverview | null;
};

export type LegalComplianceReport = {
  id: string;
  appName: string;
  source: LegalConnectedTarget["source"];
  repo: string;
  url?: string | null;
  ownerAgent: "Legal Main";
  scoutAgent: string;
  operatingModel: "central_review" | "app_scout_to_main";
  escalationPath: string[];
  severity: LegalSeverity;
  summary: string;
  checks: string[];
  riskAreas: string[];
  evidenceSources: string[];
  nextAction: string;
  disclaimer: string;
};

export type LegalComplianceRun = {
  generatedAt: string;
  totalTargets: number;
  githubConnected: boolean;
  githubError: string | null;
  sourceErrors: string[];
  summary: {
    critico: number;
    revisar: number;
    info: number;
  };
  reports: LegalComplianceReport[];
};

type LegalComplianceSources = {
  getAppProjects: (userId: string) => Promise<AppProject[]>;
  getMonitoredProjects: (userId: string) => Promise<MonitoredProject[]>;
  isGitHubConnected: () => Promise<boolean>;
  listRepositories: () => Promise<GithubListRepo[]>;
  getRepositoryOverview: (owner: string, repo: string) => Promise<LegalRepoOverview>;
};

type GithubListRepo = {
  id: number;
  name: string;
  full_name: string;
  description?: string | null;
  private?: boolean;
  archived?: boolean;
  disabled?: boolean;
  html_url?: string;
  homepage?: string | null;
  language?: string | null;
  pushed_at?: string | null;
  updated_at?: string | null;
  open_issues_count?: number | null;
};

function severityRank(severity: LegalSeverity) {
  return { critico: 3, revisar: 2, info: 1 }[severity];
}

function normalizeRepoName(repo?: string | null) {
  const cleaned = (repo || "").trim();
  return cleaned.includes("/") ? cleaned.toLowerCase() : "";
}

function repoFromApp(app: AppProject) {
  if (app.githubRepo) return app.githubRepo;
  if (app.repoOwner && app.repoName) return `${app.repoOwner}/${app.repoName}`;
  return null;
}

function textForTarget(target: LegalConnectedTarget) {
  return [
    target.appName,
    target.description,
    target.repo,
    target.url,
    target.environment,
    target.priority,
    Array.isArray(target.tags) ? target.tags.join(" ") : "",
  ].filter(Boolean).join(" ").toLowerCase();
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

function resolveLegalScout(target: LegalConnectedTarget) {
  const text = textForTarget(target);
  if (text.includes("kong")) return "Kong Legal Scout";
  if (text.includes("black room") || text.includes("blackroom") || text.includes("br-website")) return "Black Room Legal Scout";
  if (text.includes("clip")) return "Clippers Legal Scout";
  if (text.includes("deal") || text.includes("website") || text.includes("revenue") || text.includes("lead")) return "Revenue Legal Scout";
  if (text.includes("cyber") || text.includes("security")) return "Security Legal Scout";
  return "Legal Main";
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "object" && error && "code" in error && typeof (error as { code?: unknown }).code === "string") return (error as { code: string }).code;
  return fallback;
}

export function buildLegalComplianceReport(target: LegalConnectedTarget): LegalComplianceReport {
  const text = textForTarget(target);
  const scoutAgent = resolveLegalScout(target);
  const operatingModel = scoutAgent === "Legal Main" ? "central_review" : "app_scout_to_main";
  const escalationPath = scoutAgent === "Legal Main" ? ["Legal Main"] : [scoutAgent, "Legal Main", "CEO"];
  const checks = [
    "Privacidad y datos de usuarios",
    "Terminos visibles o politica equivalente",
    "Consentimiento para formularios, tracking y mensajes externos",
  ];
  const riskAreas = ["privacy", "terms", "external_messaging"];
  const evidenceSources = [target.source];
  let severity: LegalSeverity = "info";
  let summary = "Revision general de privacidad, terminos, permisos, contenido y riesgos operativos.";
  let nextAction = "Mantener reporte semanal y revisar cualquier cambio que toque usuarios, pagos, mensajes, contenido o datos.";

  if (target.url) pushUnique(evidenceSources, "public_url");
  if (target.repo) pushUnique(evidenceSources, "github_repo");

  if (text.includes("kong")) {
    checks.push("Promoters, venues, mesas, eventos y acuerdos con terceros");
    riskAreas.push("contracts", "events", "consumer_claims");
    summary = "Kong requiere vigilancia legal por venues, promoters, mensajes externos, usuarios, eventos y cobros.";
    nextAction = "Enviar cambios de venues, promoters, mensajes externos y terminos al Legal central antes de publicar.";
    severity = "revisar";
  } else if (text.includes("black room") || text.includes("blackroom") || text.includes("br-website")) {
    checks.push("Copyright de flyers, media, musica, artistas y contenido promocional");
    riskAreas.push("copyright", "media_rights", "event_promotion");
    summary = "Black Room necesita revisar derechos de imagen/media, nombres de artistas, venues, eventos y textos publicos.";
    nextAction = "Antes de publicar assets o eventos, confirmar fuente permitida y copy sin promesas legales riesgosas.";
    severity = "revisar";
  } else if (text.includes("clip")) {
    checks.push("Derechos de uso de videos, reglas de plataformas y riesgo de strikes");
    riskAreas.push("copyright", "platform_terms", "automated_posting");
    summary = "Clippers puede tener riesgo alto si usa fuentes no permitidas o automatiza publicaciones sin permiso claro.";
    nextAction = "Crear allowlist de fuentes permitidas y bloquear autoposting si no hay permiso documentado.";
    severity = "critico";
  } else if (text.includes("deal") || text.includes("website") || text.includes("revenue") || text.includes("lead")) {
    checks.push("Claims comerciales, formularios, leads y consentimiento de contacto");
    riskAreas.push("advertising_claims", "lead_consent", "tracking");
    summary = "Websites y revenue funnels deben revisar claims, formularios, consentimiento y politicas antes de publicar.";
    nextAction = "Agregar checklist legal a cada landing: privacidad, terminos, contacto, claims y tracking.";
    severity = "revisar";
  }

  if (target.status === "down" || target.status === "offline" || target.status === "degraded") {
    checks.push("Estado tecnico con posible impacto a usuarios o obligaciones de soporte");
    riskAreas.push("service_reliability");
    severity = severity === "critico" ? "critico" : "revisar";
  }
  if (target.priority === "critical") {
    checks.push("App marcada como critical en Developer Health");
    riskAreas.push("critical_app_governance");
    severity = severity === "info" ? "revisar" : severity;
  }
  if (target.url && !target.url.startsWith("https://")) {
    checks.push("URL sin HTTPS: no usar para capturar datos personales o pagos");
    riskAreas.push("data_security");
    severity = "critico";
  }
  if (target.github?.private === false) {
    checks.push("Repo publico: revisar secretos, datos de clientes, tokens y assets licenciados");
    riskAreas.push("public_repo_exposure");
  }
  if (target.github?.archived || target.github?.disabled) {
    checks.push("Repo archivado/deshabilitado: revisar si la app aun esta activa o recibe usuarios");
    riskAreas.push("stale_system");
    severity = severity === "critico" ? "critico" : "revisar";
  }
  const openPrs = target.github?.open_prs;
  if (typeof openPrs === "number" && openPrs > 0) {
    checks.push(`${openPrs} PRs abiertos: revisar cambios legales antes de merge/publicacion`);
    riskAreas.push("release_review");
  }
  const openIssues = target.github?.open_issues ?? target.github?.open_issues_count;
  if (typeof openIssues === "number" && openIssues > 0) {
    checks.push(`${openIssues} issues abiertos: revisar bugs visibles, quejas o riesgos de privacidad`);
    riskAreas.push("open_issues");
  }
  if (target.github?.error) {
    checks.push("GitHub no respondio completo; falta contexto legal del repo");
    riskAreas.push("missing_repo_context");
    severity = severity === "critico" ? "critico" : "revisar";
  }
  if (!target.repo && target.source !== "github") {
    checks.push("Sin repo conectado: falta trazabilidad de cambios y aprobaciones");
    riskAreas.push("missing_repo");
    severity = severity === "critico" ? "critico" : "revisar";
  }

  return {
    id: `${target.source}-${target.id}`,
    appName: target.appName,
    source: target.source,
    repo: target.repo || target.url || "sin repo detectado",
    url: target.url,
    ownerAgent: "Legal Main",
    scoutAgent,
    operatingModel,
    escalationPath,
    severity,
    summary,
    checks,
    riskAreas: Array.from(new Set(riskAreas)),
    evidenceSources,
    nextAction,
    disclaimer: "Monitoreo operativo; no reemplaza revision de un abogado real.",
  };
}

export function buildLegalComplianceRun(
  targets: LegalConnectedTarget[],
  githubConnected: boolean,
  githubError: string | null = null,
  sourceErrors: string[] = []
): LegalComplianceRun {
  const reports = targets
    .map(buildLegalComplianceReport)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.appName.localeCompare(b.appName));

  return {
    generatedAt: new Date().toISOString(),
    totalTargets: reports.length,
    githubConnected,
    githubError,
    sourceErrors,
    summary: {
      critico: reports.filter((report) => report.severity === "critico").length,
      revisar: reports.filter((report) => report.severity === "revisar").length,
      info: reports.filter((report) => report.severity === "info").length,
    },
    reports,
  };
}

export async function runLegalComplianceReports(userId: string): Promise<LegalComplianceRun> {
  return runLegalComplianceReportsWithSources(userId, {
    getAppProjects: (currentUserId) => storage.getAppProjects(currentUserId),
    getMonitoredProjects: (currentUserId) => storage.getMonitoredProjects(currentUserId),
    isGitHubConnected,
    listRepositories,
    getRepositoryOverview: async (owner, repo) => getRepositoryOverview(owner, repo) as Promise<LegalRepoOverview>,
  });
}

export async function runLegalComplianceReportsWithSources(
  userId: string,
  sources: LegalComplianceSources
): Promise<LegalComplianceRun> {
  const sourceErrors: string[] = [];
  const [apps, projects] = await Promise.all([
    sources.getAppProjects(userId).catch((error) => {
      sourceErrors.push(`developer_health: ${errorMessage(error, "unavailable")}`);
      return [] as AppProject[];
    }),
    sources.getMonitoredProjects(userId).catch((error) => {
      sourceErrors.push(`projects: ${errorMessage(error, "unavailable")}`);
      return [] as MonitoredProject[];
    }),
  ]);
  const repoOverviewByName = new Map<string, LegalRepoOverview>();
  const targets: LegalConnectedTarget[] = [];
  let githubConnected = false;
  let githubError: string | null = null;
  let githubRepos: GithubListRepo[] = [];

  try {
    githubConnected = await sources.isGitHubConnected();
    if (githubConnected) {
      githubRepos = await sources.listRepositories();
      for (const repo of githubRepos) {
        repoOverviewByName.set(repo.full_name.toLowerCase(), {
          full_name: repo.full_name,
          html_url: repo.html_url,
          homepage: repo.homepage,
          language: repo.language,
          pushed_at: repo.pushed_at,
          updated_at: repo.updated_at,
          open_issues_count: repo.open_issues_count,
          private: repo.private,
          archived: repo.archived,
          disabled: repo.disabled,
        });
      }
    }
  } catch (error) {
    githubError = errorMessage(error, "No se pudo leer GitHub");
    sourceErrors.push(`github: ${githubError}`);
  }

  const knownRepoNames = new Set<string>();
  const attachOverview = async (repo?: string | null): Promise<LegalRepoOverview | null> => {
    const normalized = normalizeRepoName(repo);
    if (!normalized) return null;
    knownRepoNames.add(normalized);
    const existing = repoOverviewByName.get(normalized);
    if (existing) return existing;
    if (!githubConnected) return { error: "GitHub no esta conectado" };
    const [owner, name] = normalized.split("/");
    try {
      const overview = await sources.getRepositoryOverview(owner, name);
      repoOverviewByName.set(normalized, overview);
      return overview;
    } catch (error) {
      return { error: errorMessage(error, "No se pudo leer el repo") };
    }
  };

  for (const app of apps) {
    const repo = repoFromApp(app);
    targets.push({
      id: app.id,
      source: "developer_health",
      appName: app.name,
      description: app.description,
      url: app.publicUrl || app.healthUrl,
      repo,
      status: app.status,
      environment: app.environment,
      priority: app.priority,
      tags: app.tags,
      github: await attachOverview(repo),
    });
  }

  for (const project of projects) {
    const repo = project.githubRepo;
    const duplicate = repo && targets.some((target) => normalizeRepoName(target.repo) === normalizeRepoName(repo));
    targets.push({
      id: project.id,
      source: "projects",
      appName: project.name,
      description: project.description,
      url: project.url,
      repo,
      status: project.status,
      github: duplicate ? repoOverviewByName.get(normalizeRepoName(repo)) || null : await attachOverview(repo),
    });
  }

  for (const repo of githubRepos) {
    const normalized = normalizeRepoName(repo.full_name);
    if (knownRepoNames.has(normalized)) continue;
    targets.push({
      id: String(repo.id),
      source: "github",
      appName: repo.name,
      description: repo.description,
      url: repo.homepage || repo.html_url,
      repo: repo.full_name,
      github: repoOverviewByName.get(normalized) || null,
    });
  }

  return buildLegalComplianceRun(targets, githubConnected, githubError, sourceErrors);
}
