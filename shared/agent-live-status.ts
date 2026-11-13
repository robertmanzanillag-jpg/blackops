// Live status for the agents building.
//
// Every agent maps to a cheap, read-only GET endpoint that already exists on the
// server. Endpoints that run full scans on GET (App QA, Cybersecurity) are NOT
// polled here; those agents read the stored developer-health dashboard instead
// and keep their full scan on demand from their own page.
//
// This module is pure (no React, no fetch) so it can be unit tested with node.

import { BLACKROOM_TEAM_IDS, blackRoomTeamActivity, blackRoomTeamProblems, blackRoomTeamStatusUrl, blackRoomTeamToLiveStatus } from "./blackroom-team";

export type AgentLiveState = "working" | "available" | "needs-setup" | "error" | "offline" | "checking";

export type AgentLiveStatus = {
  state: AgentLiveState;
  label: string;
  detail?: string;
  // Transport/configuration/idle states are not failures of assigned work.
  lifePenaltyExempt?: boolean;
  evidenceId?: string;
  // Short lines taken from the agent's real data, shown scrolling on its monitor.
  activity?: string[];
  // Concrete problems read from the agent's own data (a missed daily goal, a missing connector).
  problems?: string[];
  // "Activo · al día": last verified work finished inside its expected window with no failure.
  // Only set with state "available"; never means a live execution (see shared/office-on-duty.ts).
  onDuty?: { lastWorkAt: string; nextWorkAt?: string };
};

export type AgentProbe = {
  key: string;
  url: string;
  intervalMs: number;
  kind:
    | "calendar"
    | "ready-checks"
    | "github"
    | "claude-worker"
    | "dropshipping"
    | "marketing"
    | "portfolio"
    | "radio"
    | "clippers"
    | "automations"
    | "dev-health"
    | "legal"
    | "blackroom-videos"
    | "news"
    | "city-news"
    | "kong-videos"
    | "kong-metrics"
    | "blackroom-team";
  onDemandNote?: string;
  // city-news: which local-news lane (city) this desk owns.
  lane?: "miami-news" | "ny-news";
};

/** Availability and completed observations are not proof of a currently running
 * assignment. Keep execution scoring separate from visual activity. */
export function presentProbeStatus(probe:AgentProbe,status:AgentLiveStatus):AgentLiveStatus {
  if(status.state !== "working") return status;
  const labels:Partial<Record<AgentProbe["kind"],string>>={
    calendar:"Calendario conectado; sincronización actual sin verificar", "ready-checks":"Configuración disponible; ejecución sin verificar",
    github:"GitHub conectado; sin ejecución actual verificada", dropshipping:"Preparación disponible; orden no ejecutada",
    marketing:"Datos de clientes disponibles",portfolio:"Resumen de inversiones disponible",radio:"Eventos guardados disponibles",
    clippers:"Reporte del worker disponible; ejecución actual sin verificar",automations:"Resultados de ejecuciones anteriores",
    "dev-health":"Registro de salud disponible",news:"Ronda de noticias registrada; publicación sin verificar",
    "city-news":"Datos de la última ronda disponibles", "kong-videos":"Archivos de video existentes; edición actual sin verificar",
    legal:"Informe de revisión disponible", "blackroom-videos":"Reporte de videos disponible", "kong-metrics":"Métricas registradas disponibles",
    "blackroom-team":"Reporte del equipo Black Room disponible; ejecución actual sin verificar",
  };
  const label=probe.kind === "clippers" && status.label === "Ultima corrida OK" ? "Última ejecución completada; no está ejecutándose ahora" : labels[probe.kind] || "Información disponible; ejecución actual sin verificar";
  return {...status,state:"available",label,lifePenaltyExempt:true};
}

// One desk per city of the local-news agent (Metro Current). Same endpoint as "news", so no extra calls.
export const CITY_NEWS_AGENTS = [
  { id: "news:miami-news", lane: "miami-news" as const, city: "Miami", name: "Noticias Miami" },
  { id: "news:ny-news", lane: "ny-news" as const, city: "Nueva York", name: "Noticias Nueva York" },
];

const MINUTE = 60_000;
// Tolerated difference between the clock that built an observation and the clock that reads it.
export const CLOCK_SKEW_MS = 5_000;

export const agentProbes: Record<string, AgentProbe> = {
  // Calendar status calls Zoho when configured, so it is polled gently.
  assistant: { key: "calendar-status", url: "/api/calendar/status", intervalMs: 5 * MINUTE, kind: "calendar" },
  ceo: { key: "ceo-readiness", url: "/api/ceo/readiness", intervalMs: 2 * MINUTE, kind: "ready-checks" },
  revenue: { key: "revenue-readiness", url: "/api/stripe/revenue-readiness", intervalMs: 2 * MINUTE, kind: "ready-checks" },
  dropshipping: { key: "dropshipping-readiness", url: "/api/dropshipping-ceo/launch-readiness", intervalMs: 2 * MINUTE, kind: "dropshipping" },
  "marketing-cmo": { key: "marketing-snapshot", url: "/api/marketing-command-center", intervalMs: 2 * MINUTE, kind: "marketing" },
  code: { key: "github-status", url: "/api/github/status", intervalMs: 2 * MINUTE, kind: "github" },
  github: { key: "github-status", url: "/api/github/status", intervalMs: 2 * MINUTE, kind: "github" },
  "claude-reviewer": { key: "claude-worker", url: "/api/agents-office/connections", intervalMs: 2 * MINUTE, kind: "claude-worker" },
  portfolio: { key: "portfolio-summary", url: "/api/portfolio/summary", intervalMs: 2 * MINUTE, kind: "portfolio" },
  radio: { key: "radio-slots", url: "/api/radio/slots", intervalMs: 2 * MINUTE, kind: "radio" },
  clippers: { key: "clippers-runtime", url: "/api/clippers/runtime-status", intervalMs: MINUTE, kind: "clippers" },
  // Read-only runs list. /api/automation-manager/summary is avoided on purpose: it seeds defaults and
  // re-activates paused automations on every GET.
  automations: { key: "automation-runs", url: "/api/automation-runs?limit=25", intervalMs: MINUTE, kind: "automations" },
  cybersecurity: {
    key: "dev-health-dashboard",
    url: "/api/developer-health/dashboard",
    intervalMs: 2 * MINUTE,
    kind: "dev-health",
    onDemandNote: "Lee el registro de salud guardado; el escaneo completo de seguridad corre bajo demanda desde su pagina.",
  },
  "app-qa": {
    key: "dev-health-dashboard",
    url: "/api/developer-health/dashboard",
    intervalMs: 2 * MINUTE,
    kind: "dev-health",
    onDemandNote: "Lee el registro de salud guardado; el escaneo completo de QA corre bajo demanda desde su pagina.",
  },
  control: { key: "dev-health-dashboard", url: "/api/developer-health/dashboard", intervalMs: 2 * MINUTE, kind: "dev-health" },
  "blackroom-videos": { key: "blackroom-agent", url: "/api/blackroom-agent", intervalMs: 2 * MINUTE, kind: "blackroom-videos" },
  news: { key: "local-news-status", url: "/api/clippers/local-news/status", intervalMs: 2 * MINUTE, kind: "news" },
  "news:miami-news": { key: "local-news-status", url: "/api/clippers/local-news/status", intervalMs: 2 * MINUTE, kind: "city-news", lane: "miami-news" },
  "news:ny-news": { key: "local-news-status", url: "/api/clippers/local-news/status", intervalMs: 2 * MINUTE, kind: "city-news", lane: "ny-news" },
  "kong-videos": { key: "promo-video-status", url: "/api/promo-video/status", intervalMs: 5 * MINUTE, kind: "kong-videos" },
  // KONG metrics agent: results per confirmed publication (owner-only state; read-only here).
  "kong-metrics": { key: "kong-ops-state", url: "/api/kong-ops/state", intervalMs: 5 * MINUTE, kind: "kong-metrics" },
  // Not fetched by the building: it reuses the legal query the office page already runs.
  legal: { key: "legal-compliance-reports", url: "/api/legal-compliance/reports", intervalMs: MINUTE, kind: "legal" },
  // Black Room team (CEO, analiticas, competencia, publicador, guiones, website): one owner-only status each.
  ...Object.fromEntries(BLACKROOM_TEAM_IDS.map((id) => [id, { key: `blackroom-team:${id}`, url: blackRoomTeamStatusUrl(id), intervalMs: 2 * MINUTE, kind: "blackroom-team" as const }])),
};

export type ProbeResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; body: unknown }
  | { ok: false; status: 0; body: null; networkError: true };

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function missingChecks(checks: unknown): string[] {
  const obj = asObject(checks);
  if (!obj) return [];
  return Object.entries(obj)
    .filter(([, value]) => value === false || (asObject(value) && asObject(value)!.ok === false))
    .map(([name]) => name);
}

export function summarizeProbe(probe: AgentProbe, result: ProbeResult | undefined, now: number = Date.now()): AgentLiveStatus {
  // Partner ("socio") view: the server answered with a redacted summary (shared/workspace-access.ts).
  const redacted = result?.ok ? asObject(result.body) : null;
  if (redacted?.redacted === true && redacted.scope === "owner") {
    return { state: "offline", label: "Solo Robert", detail: str(redacted.summary) || "Vista de socio: el detalle de este agente es privado.", lifePenaltyExempt: true };
  }
  const status = summarizeStatus(probe, result, now);
  if(!status.evidenceId) status.lifePenaltyExempt=true;
  // Activity comes only from a real JSON body; an error state still shows what the agent saw (e.g. the failed run).
  if (!result || !result.ok || result.body === null || result.body === undefined) return status;
  const activity = extractActivity(probe, result.body, now).filter(Boolean).slice(0, 4);
  const problems = extractProblems(probe, result.body).slice(0, 5);
  return { ...status, ...(activity.length ? { activity } : {}), ...(problems.length ? { problems } : {}) };
}

const PLATFORM_NAMES: Record<string, string> = { facebook: "Facebook", x: "X", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", threads: "Threads" };

// Problems come only from fields the agent itself reports; nothing is guessed.
function extractProblems(probe: AgentProbe, raw: unknown): string[] {
  if (probe.kind === "blackroom-team") return blackRoomTeamProblems(raw);
  if (probe.kind === "blackroom-videos") {
    const actions = asObject(asObject(raw)?.operations)?.actions;
    return (Array.isArray(actions) ? actions : []).map((action) => str(asObject(action)?.message) || "").filter(Boolean);
  }
  if (probe.kind !== "city-news" || !probe.lane) return [];
  const body = asObject(raw);
  const problems: string[] = [];
  const accounts = asObject(asObject(asObject(asObject(body?.editorial)?.dailyPublishing)?.accounts)?.[probe.lane]);
  for (const [platform, value] of Object.entries(accounts || {})) {
    const account = asObject(value);
    const deficit = num(account?.deficit) ?? 0;
    if (deficit > 0) problems.push(`${PLATFORM_NAMES[platform] || platform}: ${num(account?.queuedToday) ?? 0}/${num(account?.target) ?? "?"} hoy (faltan ${deficit})`);
  }
  const connectors = Array.isArray(body?.connectors) ? (body!.connectors as unknown[]).map(asObject).filter(Boolean) as Json[] : [];
  const missing = connectors.filter((connector) => connector.lane === probe.lane && connector.configured === false).map((connector) => str(connector.id) || "fuente");
  if (missing.length) problems.push(`Fuentes sin configurar: ${missing.slice(0, 3).join(", ")}`);
  const coverage = asObject(body?.coverage);
  const traffic = probe.lane === "miami-news" ? str(coverage?.miamiTraffic) : str(coverage?.nyTraffic);
  if (traffic === "not_configured") problems.push("Trafico sin cobertura configurada");
  return problems;
}

function clip(text: string, max = 48) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function hoursAgo(iso: string | null, now: number): string | null {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
}

const stateWord: Record<string, string> = {
  ready: "listo",
  warning: "aviso",
  blocked: "bloqueado",
  healthy: "sana",
  degraded: "degradada",
  down: "caida",
  unknown: "sin chequeo",
  success: "OK",
  failed: "fallo",
  skipped: "saltada",
  pending_approval: "esperando aprobacion",
  draft_only: "borradores",
  needs_setup: "falta setup",
  critico: "critico",
  revisar: "revisar",
  info: "info",
};
const word = (value: unknown) => {
  const text = str(value);
  return text ? stateWord[text] || text : "";
};

export function extractActivity(probe: AgentProbe, raw: unknown, now: number = Date.now()): string[] {
  const body = asObject(raw);
  const list = (value: unknown) => (Array.isArray(value) ? (value as unknown[]).map(asObject).filter(Boolean) as Json[] : []);
  switch (probe.kind) {
    case "calendar":
      return [body?.google === true ? "Google Calendar sincronizando" : "", body?.zoho === true ? "Zoho Calendar sincronizando" : ""];
    case "ready-checks": {
      if (Array.isArray(body?.checks)) return list(body!.checks).map((check) => clip(`${check.status === "ready" ? "OK" : "Pendiente"}: ${str(check.label) || str(check.id) || "check"}`));
      const checks = asObject(body?.checks);
      return checks ? Object.entries(checks).map(([name, value]) => `${value === true ? "OK" : "Pendiente"}: ${name}`) : [];
    }
    case "github": {
      const login = str(asObject(body?.user)?.login);
      return login ? [`Sesion GitHub @${login}`, "Leyendo repos, PRs y CI"] : [];
    }
    case "claude-worker":
      return [];
    case "dropshipping": {
      const readiness = asObject(body?.launchReadiness);
      const blockers = Array.isArray(readiness?.blockers) ? (readiness!.blockers as unknown[]).map(str).filter(Boolean) as string[] : [];
      return [str(readiness?.summary) ? clip(str(readiness?.summary)!) : "", ...blockers.map((b) => clip(b))];
    }
    case "marketing":
      return list(body?.clients).map((client) => clip(`${str(client.name) || "Cliente"}: ${word(client.status)}`));
    case "portfolio":
      return list(body?.topDailyGainers).map((item) => `${str(item.symbol) || "?"} ${num(item.dailyChange) !== null ? `${num(item.dailyChange)! >= 0 ? "+" : ""}${num(item.dailyChange)!.toFixed(2)}` : ""}`.trim());
    case "radio":
      return list(raw).map((slot) => clip(`${str(slot.dateStr) || "Evento"}: ${[slot.slot7, slot.slot8, slot.slot9].map(str).filter(Boolean).join(", ") || "slots libres"}`));
    case "clippers": {
      const lastRun = asObject(body?.lastExecution);
      const last = hoursAgo(str(lastRun?.finishedAt) || str(lastRun?.startedAt), now);
      return [
        `Worker: ${str(body?.status) || "?"}`,
        last ? `Ultima corrida ${last}` : "",
        str(body?.failedStage) ? `Etapa con problema: ${str(body?.failedStage)}` : "",
        str(asObject(body?.nextAction)?.message) ? clip(str(asObject(body?.nextAction)?.message)!) : "",
      ];
    }
    case "automations":
      return list(raw).map((run) => clip(`${word(run.status)} · ${str(run.resultSummary) || str(run.errorMessage) || "corrida"} · ${hoursAgo(str(run.startedAt), now) || ""}`));
    case "dev-health":
      return list(body?.apps).map((app) => clip(`${str(app.name) || "App"}: ${word(app.status)}`));
    case "legal":
      return list(body?.reports).map((report) => clip(`${str(report.appName) || "App"}: ${word(report.severity)}`));
    case "blackroom-videos": {
      const operations = asObject(body?.operations);
      if (operations) {
        const worker = asObject(operations.worker);
        const learning = asObject(operations.learning);
        return [
          worker?.online === true ? "Publicador existente conectado; no se crea otro publicador" : "Publicador desconectado: la oficina no puede editar sin el trabajador",
          ...["tiktok", "facebook", "youtube"].map((network) => {
            const evidence = asObject(learning?.[network]);
            return `${network}: ${str(evidence?.status) || "sin evidencia"} · ${num(evidence?.exactAttributed) ?? 0} resultados asociados`;
          }),
        ];
      }
      const totals = asObject(asObject(body?.agent)?.totals);
      const online = asObject(body?.remote)?.online === true;
      return [
        online ? "Dispositivo de publicacion en linea" : "Dispositivo de publicacion desconectado",
        totals ? `Cola: ${num(totals.queued) ?? 0} en espera · ${num(totals.processing) ?? 0} editando` : "",
        totals ? `${num(totals.scheduled) ?? 0} programados · ${num(totals.completed) ?? 0} publicados` : "",
      ];
    }
    case "blackroom-team":
      return blackRoomTeamActivity(raw).map((line) => clip(line));
    case "kong-metrics": {
      const results = Array.isArray(body?.results) ? (body!.results as unknown[]).map(asObject).filter(Boolean) as Json[] : [];
      return results.slice(0, 3).map((result) => `${str(result.title) || "Publicacion"} · ${str(result.network)}: ${num(result.impressions) ?? 0} vistas, ${num(result.engagements) ?? 0} interacciones`);
    }
    case "city-news": {
      const lane = asObject(asObject(body?.lanes)?.[probe.lane || ""]);
      return [
        str(body?.lastRunAt) ? `Ultima ronda ${hoursAgo(str(body?.lastRunAt), now)}` : "Sin rondas todavia",
        lane ? `${num(lane.active) ?? 0} noticias activas · ${num(lane.resolved) ?? 0} resueltas` : "",
        lane ? `${num(lane.queued) ?? 0} posts en cola de esta ciudad` : "",
      ];
    }
    case "news": {
      const queue = asObject(body?.queue);
      const events = asObject(body?.events);
      return [
        str(body?.lastRunAt) ? `Ultima ronda ${hoursAgo(str(body?.lastRunAt), now)}` : "Sin rondas todavia",
        events ? `${num(events.active) ?? 0} noticias activas` : "",
        queue ? `${num(queue.total) ?? 0} en cola · ${num(queue.approvalRequired) ?? 0} esperan aprobacion` : "",
      ];
    }
    case "kong-videos": {
      const outputs = list(body?.outputVideos).sort((a, b) => (str(b.modifiedAt) || "").localeCompare(str(a.modifiedAt) || ""));
      return [
        `${outputs.length} videos editados · ${list(body?.inputVideos).length} por editar`,
        ...outputs.slice(0, 3).map((video) => clip(`${str(video.name) || "video"} · ${hoursAgo(str(video.modifiedAt), now) || ""}`)),
      ];
    }
  }
}

function newsNeverRanDetail(body: Json | null): string {
  const scheduler = asObject(body?.scheduler);
  if (scheduler?.enabled === false) return "El programador de noticias esta desactivado (CLIPPERS_LOCAL_NEWS_SCHEDULER_ENABLED=false).";
  if (str(scheduler?.lastError)) return `El programador fallo: ${clip(str(scheduler?.lastError)!, 120)}`;
  if (scheduler && scheduler.started !== true) return "El programador de noticias no arranco en esta instancia.";
  return "El agente de noticias no ha corrido nunca.";
}

function summarizeStatus(probe: AgentProbe, result: ProbeResult | undefined, now: number): AgentLiveStatus {
  if (!result) return { state: "checking", label: "Verificando..." };
  if ("networkError" in result) {
    return { state: "offline", lifePenaltyExempt: true, label: "Servidor sin respuesta", detail: "No se pudo contactar el backend de BlackOps." };
  }
  if (result.status === 401) {
    return { state: "needs-setup", label: "Requiere sesion", detail: "Inicia sesion en BlackOps para ver su estado." };
  }
  if (result.status === 403) {
    return { state: "needs-setup", label: "Sin permiso", detail: "Tu usuario no tiene acceso a este agente." };
  }
  const body = asObject(result.body);
  const bodyError = body ? str(body.error) : null;
  if (!result.ok || bodyError) {
    return { state: "error", lifePenaltyExempt: true, label: "Con error", detail: bodyError || `El endpoint respondio ${result.status}.` };
  }
  // A 200 without JSON (SPA fallback, empty body) is never proof of work.
  if (result.body === null || result.body === undefined) {
    return { state: "error", lifePenaltyExempt: true, label: "Respuesta no valida", detail: "El endpoint no devolvio JSON." };
  }

  switch (probe.kind) {
    case "calendar": {
      const google = body?.google === true;
      const zoho = body?.zoho === true;
      if (!google && !zoho) return { state: "needs-setup", label: "Calendario sin conectar", detail: "Conecta Google Calendar o Zoho." };
      return { state: "working", label: "Agenda sincronizada", detail: [google && "Google", zoho && "Zoho"].filter(Boolean).join(" + ") };
    }
    case "ready-checks": {
      // CEO readiness: { ready, status: "ready" | "warning" | "blocked", checks: [{ label, status }] }.
      // Revenue readiness: { ready, checks: { name: boolean } }.
      const listed = Array.isArray(body?.checks)
        ? (body!.checks as unknown[]).map(asObject).filter((check): check is Json => Boolean(check) && check!.status !== "ready")
        : null;
      const pending = listed ? listed.map((check) => str(check.label) || str(check.id) || "check").filter(Boolean) as string[] : missingChecks(body?.checks);
      const detail = pending.length ? `Pendiente: ${pending.slice(0, 3).join(", ")}${pending.length > 3 ? "..." : ""}` : undefined;
      if (body?.ready === true) return { state: "working", label: "Operativo" };
      const status = str(body?.status);
      if (status === "warning") return { state: "working", label: "Operativo con avisos", detail };
      if (status === "blocked" || body?.ready === false) return { state: "needs-setup", label: "Falta configuracion", detail };
      return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido", detail: "La respuesta no trae el formato esperado." };
    }
    case "github": {
      if (body?.connected !== true) return { state: "needs-setup", label: "GitHub sin conectar", detail: str(body?.reason) || "Configura GITHUB_TOKEN (o GH_TOKEN) o conecta el conector GitHub de Replit." };
      const login = str(asObject(body.user)?.login);
      return { state: "working", label: "Conectado a GitHub", detail: login ? `@${login}` : undefined };
    }
    case "claude-worker": {
      if (body?.workerEnabled === false) return { state: "offline", label: "Ejecutor de Claude desactivado" };
      if (asObject(body?.worker)?.status !== "ready" || asObject(body?.claude)?.status !== "ready") {
        return { state: "needs-setup", label: "Claude sin ejecutor verificado" };
      }
      return { state: "offline", label: "Claude disponible bajo demanda", detail: "La conexión está lista. La actividad se confirma en el registro de ejecuciones." };
    }
    case "dropshipping": {
      const readiness = asObject(body?.launchReadiness);
      const status = str(readiness?.status);
      const summary = str(readiness?.summary) || undefined;
      const profitGuardStatus = str(asObject(asObject(body?.snapshot)?.profitGuard)?.status);
      if (status === "blocked_safety") {
        // The server also uses blocked_safety when no product/supplier is reviewed yet; only a spend pause is a real stop.
        return profitGuardStatus === "pause_spend"
          ? { state: "error", label: "Gasto pausado por Profit Guard", detail: summary }
          : { state: "needs-setup", label: "Falta producto o supplier", detail: summary };
      }
      if (status === "blocked_needs_accounts") return { state: "needs-setup", label: "Faltan cuentas", detail: summary };
      if (status === "ready_for_test_order") return { state: "working", label: "Listo para orden de prueba", detail: summary };
      if (status === "pre_account_ready") return { state: "working", label: "Modo pre-cuentas", detail: summary };
      return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido", detail: "La respuesta no trae el formato esperado." };
    }
    case "marketing": {
      const scorecard = asObject(body?.globalScorecard);
      const clients = num(scorecard?.clients);
      const ready = num(scorecard?.readyClients) ?? 0;
      const approvals = num(scorecard?.approvalsNeeded) ?? 0;
      if (clients === null) return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido", detail: "La respuesta no trae el formato esperado." };
      if (clients === 0) return { state: "needs-setup", label: "Sin clientes detectados" };
      return {
        state: "working",
        label: `${ready}/${clients} clientes listos`,
        detail: approvals ? plural(approvals, "aprobacion pendiente", "aprobaciones pendientes") : undefined,
      };
    }
    case "portfolio": {
      if (num(body?.totalValue) === null) return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido" };
      if (!Array.isArray(body?.distribution) || body!.distribution.length === 0) return { state: "needs-setup", label: "Sin inversiones cargadas" };
      return { state: "working", label: "Siguiendo inversiones" };
    }
    case "radio": {
      const slots = Array.isArray(result.body) ? result.body.length : null;
      if (slots === null) return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido" };
      if (slots === 0) return { state: "offline", label: "En espera", detail: "No hay eventos de radio proximos en el calendario." };
      return { state: "working", label: "Programando radio", detail: plural(slots, "evento proximo", "eventos proximos") };
    }
    case "clippers": {
      // States: running | completed | blocked | stale | never_run. nextAction is { code, message }.
      const status = str(body?.status) || str(body?.state);
      const next = str(asObject(body?.nextAction)?.message) || str(body?.nextAction) || undefined;
      const blockers = Array.isArray(body?.configurationBlockers) ? body!.configurationBlockers.length : 0;
      if (status === "never_run") return { state: "needs-setup", label: "Worker nunca corrio", detail: next };
      if (status === "blocked") return { state: "needs-setup", label: "Worker bloqueado", detail: next };
      if (status === "stale") return { state: "needs-setup", label: "Worker detenido", detail: next };
      if (status === "running") return { state: "working", label: "Procesando clips", detail: next };
      if (status === "completed") {
        return blockers > 0
          ? { state: "needs-setup", label: "Corrio, con bloqueos", detail: next }
          : { state: "working", label: "Ultima corrida OK", detail: next };
      }
      return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido", detail: next };
    }
    case "automations": {
      // /api/automation-runs: newest-first list of { status, startedAt }.
      if (!Array.isArray(result.body)) return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido" };
      const runs = (result.body as unknown[]).map(asObject).filter(Boolean) as Json[];
      const dayAgo = now - 26 * 60 * 60_000;
      const recent = runs.filter((run) => {
        const started = Date.parse(str(run.startedAt) || "");
        // Skipped runs did no work; pending approvals are counted separately.
        return Number.isFinite(started) && started >= dayAgo && (run.status === "success" || run.status === "failed");
      });
      const failed = recent.filter((run) => run.status === "failed").length;
      const pending = runs.filter((run) => run.status === "pending_approval").length;
      const extra = pending ? plural(pending, "aprobacion pendiente", "aprobaciones pendientes") : undefined;
      const latest = [...recent].sort((a,b) => Date.parse(str(b.startedAt) || "") - Date.parse(str(a.startedAt) || ""));
      const failedRun = latest.find(run => run.status === "failed");
      const runEvidence = (run: Json) => {
        const started=Date.parse(str(run.startedAt) || ""),finished=Date.parse(str(run.finishedAt) || "");
        return str(run.id) && Number.isFinite(started) && Number.isFinite(finished) && finished>=started && finished<=now ? `automation:${str(run.id)}` : undefined;
      };
      // A stored failure alone does not establish agent misconduct. Only explicit
      // output-validation failures are scoreable; unknown/connector failures wait
      // for diagnosis, while remaining visible as errors.
      const attributable=(run:Json)=>{
        const metadata=asObject(run.metadata), code=str(metadata?.errorCode);
        const error=str(run.errorMessage) || "";
        if(/connector|not connected|credential|oauth|token|quota|rate.?limit|timeout|timed out|network|database|ECONN|ENOTFOUND|HTTP\s*(401|403|429|5\d\d)/i.test(error)) return false;
        return metadata?.failureKind === "agent_output" && ["INVALID_REVIEW","INVALID_RESULT","OUTPUT_VALIDATION_FAILED","TASK_REQUIREMENT_FAILED"].includes(code || "");
      };
      if (failed > 0) {
        const blame = attributable(failedRun!);
        // A connector/infrastructure failure names its cause so Robert can fix the setup, not the agent.
        const cause = !blame && str(failedRun!.errorMessage) ? `Causa: ${clip(str(failedRun!.errorMessage)!, 90)}` : undefined;
        return { state: "error", evidenceId: runEvidence(failedRun!), lifePenaltyExempt: !blame, label: plural(failed, "corrida fallida", "corridas fallidas"), detail: [cause, extra].filter(Boolean).join(" · ") || undefined };
      }
      if (recent.length === 0) return { state: "offline", label: "Sin corridas en 24 h", detail: extra };
      return { state: "working", evidenceId: runEvidence(latest[0]), label: `${plural(recent.length, "corrida", "corridas")} en 24 h`, detail: extra };
    }
    case "dev-health": {
      const summary = asObject(body?.summary);
      const apps = num(summary?.totalApps) ?? 0;
      const critical = num(summary?.criticalIncidents) ?? 0;
      const open = num(summary?.openIncidents) ?? 0;
      const down = num(summary?.down) ?? 0;
      const note = probe.onDemandNote;
      const degraded = num(summary?.degraded) ?? 0;
      const unknown = num(summary?.unknown) ?? 0;
      if (!summary) return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido", detail: note };
      if (apps === 0) return { state: "needs-setup", label: "Sin apps registradas", detail: note };
      // Findings about the apps need Robert's attention; they don't mean the agent itself is broken.
      if (critical > 0) return { state: "needs-setup", label: plural(critical, "incidente critico", "incidentes criticos"), detail: note };
      if (down > 0) return { state: "needs-setup", label: plural(down, "app caida", "apps caidas"), detail: note };
      if (unknown === apps) return { state: "needs-setup", label: "Apps sin chequeos de salud", detail: note };
      if (degraded > 0) return { state: "needs-setup", label: plural(degraded, "app degradada", "apps degradadas"), detail: note };
      return {
        state: "working",
        label: open > 0 ? `${plural(open, "incidente abierto", "incidentes abiertos")}` : `${plural(apps, "app sana", "apps sanas")}`,
        detail: note,
      };
    }
    case "blackroom-videos": {
      const operations = asObject(body?.operations);
      if (operations) {
        const worker = asObject(operations.worker);
        const age = now - Date.parse(str(operations.checkedAt) || "");
        // The observation is built a few ms after the reader took its clock (and browser/server clocks
        // differ slightly): a small negative age is the same fresh observation, not stale evidence.
        if (!Number.isFinite(age) || age < -CLOCK_SKEW_MS || age > 90_000) return { state: "needs-setup", label: "Evidencia desactualizada" };
        if (operations.state === "paused") return { state: "checking", label: "BlackRoom pausado", detail: "Se respeta la pausa; la supervision no inicia publicaciones." };
        if (worker?.online !== true) return { state: "needs-setup", label: "Publicador desconectado" };
        if (operations.state === "blocked") return { state: "needs-setup", label: "BlackRoom requiere atencion" };
        // Activity is visible, but must not earn repeated career points until a
        // durable, single-use completion receipt is connected to company scoring.
        if (operations.state === "working" && worker?.processing === true && str(worker.progressEventId)) return { state: "checking", label: "Actividad reciente · resultado pendiente", detail: "No otorga puntos ni declara una publicacion completada." };
        return { state: "checking", label: "Conectado · sin avance confirmado", detail: "Una cola preparada no demuestra trabajo nuevo ni aprendizaje." };
      }
      const agent = asObject(body?.agent);
      const totals = asObject(agent?.totals);
      const online = asObject(body?.remote)?.online === true;
      if (!totals) return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido" };
      const active = (num(totals.processing) ?? 0) + (num(totals.queued) ?? 0) + (num(totals.retry) ?? 0);
      if (!online) return { state: "needs-setup", label: "Publicador desconectado", detail: "El dispositivo que sube los videos de Black Room no esta en linea." };
      if ((num(totals.retry) ?? 0) > 0) return { state: "error", label: `${num(totals.retry)} videos reintentando` };
      if (active === 0 && (num(totals.scheduled) ?? 0) === 0) return { state: "offline", label: "Cola vacia", detail: "No hay videos de Black Room pendientes." };
      return { state: "checking", label: `${active} en cola · avance sin verificar`, detail: "Falta evidencia reciente del trabajador; no se otorgan puntos por tener cola." };
    }
    case "blackroom-team":
      return blackRoomTeamToLiveStatus(result.body, now);
    case "kong-metrics": {
      const status = asObject(asObject(body?.status)?.["kong-metrics"]);
      const state = str(status?.state);
      if (state === "needs-setup") return { state, label: str(status?.label) || "Sin datos" };
      // Legacy servers may say "working" for a fresh metrics snapshot. Reading
      // that same snapshot again is not new work and must not earn career points.
      if (state === "checking" || state === "working") return { state: "checking", label: str(status?.label) || "Metricas disponibles", detail: "Datos disponibles; no acredita trabajo nuevo ni puntos por cada lectura." };
      return { state: "error", label: "Estado de metricas ilegible" };
    }
    case "city-news": {
      const last = Date.parse(str(body?.lastRunAt) || "");
      const lane = asObject(asObject(body?.lanes)?.[probe.lane || ""]);
      if (body?.bootstrapped === false) return { state: "needs-setup", label: "Sin configurar", detail: newsNeverRanDetail(body) };
      if (!lane) return { state: "error", label: "Ciudad sin datos", detail: "El estado de noticias no trae esta ciudad." };
      if (!Number.isFinite(last)) return { state: "needs-setup", label: "Sin rondas todavia" };
      // A quiet city is not a failure: the desk is working if its rounds are fresh.
      if (now - last > 26 * 60 * 60_000) return { state: "needs-setup", label: "Sin rondas en 24 h" };
      const active = num(lane.active) ?? 0;
      const queued = num(lane.queued) ?? 0;
      return { state: "working", label: active || queued ? `${active} noticias · ${queued} en cola` : "Vigilando: sin noticias activas" };
    }
    case "news": {
      const last = Date.parse(str(body?.lastRunAt) || "");
      if (body?.bootstrapped === false) return { state: "needs-setup", label: "Sin configurar", detail: newsNeverRanDetail(body) };
      if (!Number.isFinite(last)) return { state: "needs-setup", label: "Sin rondas todavia" };
      if (now - last > 26 * 60 * 60_000) return { state: "needs-setup", label: "Sin rondas en 24 h" };
      return { state: "working", label: "Publicando noticias" };
    }
    case "kong-videos": {
      if (!Array.isArray(body?.outputVideos)) return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido" };
      const videos = Array.isArray(body?.outputVideos) ? (body!.outputVideos as unknown[]).map(asObject).filter(Boolean) as Json[] : [];
      const newest = videos.map((video) => Date.parse(str(video.modifiedAt) || "")).filter(Number.isFinite).sort((a, b) => b - a)[0];
      if (!newest) return { state: "needs-setup", label: "Sin videos editados", detail: "Agrega videos fuente para que edite los de Kong." };
      if (now - newest > 48 * 60 * 60_000) return { state: "offline", label: "Sin videos nuevos en 48 h" };
      return { state: "working", label: "Editando videos de Kong" };
    }
    case "legal": {
      const summary = asObject(body?.summary);
      const critical = num(summary?.critico) ?? 0;
      const review = num(summary?.revisar) ?? 0;
      const targets = num(body?.totalTargets) ?? 0;
      if (!summary) return { state: "error", lifePenaltyExempt: true, label: "Estado desconocido" };
      if (critical > 0) return { state: "needs-setup", label: plural(critical, "riesgo critico", "riesgos criticos"), detail: review ? `${review} por revisar` : undefined };
      if (targets === 0) return { state: "needs-setup", label: "Sin apps que revisar" };
      if (body?.githubConnected === false) return { state: "needs-setup", label: "GitHub sin conectar", detail: `Revisando ${plural(targets, "app", "apps")} sin datos de GitHub` };
      return { state: "working", label: `Revisando ${plural(targets, "app", "apps")}`, detail: review ? `${review} por revisar` : undefined };
    }
  }
}

export async function runProbe(url: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return response.ok ? { ok: true, status: response.status, body } : { ok: false, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null, networkError: true };
  }
}
