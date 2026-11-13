// "Analiticas Black Room": read-only social-media report ("como estuvo todo").
//
// Data sources, cheap-first and read-only:
// 1. The Black Room remote-control state already stored by the Black Room panel: per-post samples
//    from the Metricool CSV bridge (analyticsImports) and the CEO's last Metricool collection
//    (ceo_schedule.analytics: posts seen and errors per network). No network call needed.
// 2. Optional live refresh (input.refresh === true and METRICOOL_USER_TOKEN set): reuses
//    collectBlackRoomMetricoolAnalytics through a fetch guard that only lets read-only Metricool
//    MCP calls through (tools/list, get... and list... tools). This agent never posts or schedules.
//
// The report itself is deterministic code (./blackroom-analytics/report.ts): no LLM.
import type {
  BlackRoomTeamAgentModule,
  BlackRoomTeamContext,
  BlackRoomTeamRunResult,
  BlackRoomTeamStatus,
} from "@shared/blackroom-team";
import { BLACKROOM_TEAM_WORKING_FRESH_MS } from "@shared/blackroom-team";
import {
  BLACKROOM_ANALYTICS_NETWORKS,
  blackRoomAnalyticsWindowLabel,
  buildBlackRoomAnalyticsReport,
  normalizeBlackRoomAnalyticsSamples,
  type BlackRoomAnalyticsCoverage,
  type BlackRoomAnalyticsReport,
  type BlackRoomAnalyticsReportNetwork,
  type BlackRoomAnalyticsSample,
  type BlackRoomAnalyticsWindow,
} from "./blackroom-analytics/report";

const ID = "blackroom-analytics" as const;
const HISTORY_LIMIT = 30;

export const BLACKROOM_ANALYTICS_TOKEN_NEED =
  "METRICOOL_USER_TOKEN (token de Metricool de Black Room) o importar los CSV de Metricool desde la Mac (POST /api/blackroom-agent/analytics/import)";

/** What the agent reads from the Black Room remote-control state (subset, untrusted). */
export type BlackRoomAnalyticsSourceState = {
  analyticsImports?: Partial<Record<string, { samples?: unknown; importedAt?: string } | undefined>>;
  commands?: unknown[];
} | null;

export type BlackRoomAnalyticsMetricoolCollector = (options: {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  now: Date;
  importedSamplesByNetwork: Partial<Record<string, BlackRoomAnalyticsSample[]>>;
}) => Promise<BlackRoomAnalyticsLiveResult>;

/** What the live Metricool collection returns (aggregates per network; per-post detail is not guaranteed). */
export type BlackRoomAnalyticsLiveResult = {
  networkSamples?: Record<string, number>;
  networkErrors?: Record<string, string>;
  lastCheckedAt?: string;
  networkMedianViews?: Record<string, number>;
  networkEngagementRate?: Record<string, number>;
  recommendedTimesByNetwork?: Record<string, string[]>;
};

export type BlackRoomAnalyticsDeps = {
  /** Reads the stored Black Room remote-control state. Must not create rows. */
  readSourceState?: () => Promise<BlackRoomAnalyticsSourceState>;
  /** Live Metricool collection (only used on refresh). */
  collectMetricool?: BlackRoomAnalyticsMetricoolCollector;
};

type HistoryEntry = {
  at: string;
  window: BlackRoomAnalyticsWindow;
  posts: number;
  views: number | null;
  networksWithData: BlackRoomAnalyticsReportNetwork[];
};

export type BlackRoomAnalyticsAgentState = {
  version: 1;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  /** Exact needs from the last run when it found no data at all. */
  lastNeeds: string[];
  lastReport: BlackRoomAnalyticsReport | null;
  /** Summary built from Metricool's live per-network totals when no per-post detail exists. */
  lastLiveSummary?: { at: string; text: string } | null;
  history: HistoryEntry[];
};

const EMPTY_STATE: BlackRoomAnalyticsAgentState = {
  version: 1,
  lastRunAt: null,
  lastOkAt: null,
  lastError: null,
  lastNeeds: [],
  lastReport: null,
  history: [],
};

function hasToken(env: BlackRoomTeamContext["env"]): boolean {
  const token = env.METRICOOL_USER_TOKEN;
  return typeof token === "string" && token.trim().length > 0 && !/^(replace|paste|your-|<)/i.test(token.trim());
}

async function loadState(ctx: BlackRoomTeamContext): Promise<BlackRoomAnalyticsAgentState> {
  const raw = await ctx.state.load<Partial<BlackRoomAnalyticsAgentState> | null>(null);
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATE };
  return {
    ...EMPTY_STATE,
    ...raw,
    lastNeeds: Array.isArray(raw.lastNeeds) ? raw.lastNeeds.filter((need): need is string => typeof need === "string") : [],
    lastLiveSummary: raw.lastLiveSummary && typeof raw.lastLiveSummary === "object" && typeof raw.lastLiveSummary.text === "string" ? raw.lastLiveSummary : null,
    history: Array.isArray(raw.history) ? raw.history.slice(-HISTORY_LIMIT) : [],
  };
}

/**
 * Only read-only Metricool MCP traffic may pass: tools/list and tools/call of tools named get... or list....
 * Anything else (scheduling, publishing, other hosts) is refused before it leaves the server.
 */
export function createReadOnlyMetricoolFetch(inner: typeof fetch): typeof fetch {
  const guarded = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    let host = "";
    try { host = new URL(url).hostname; } catch { host = ""; }
    if (!/(^|\.)metricool\.com$/i.test(host)) throw new Error(`Analiticas Black Room solo lee Metricool; bloqueado: ${host || "url invalida"}`);
    const method = String(init?.method || "GET").toUpperCase();
    if (method !== "GET") {
      let body: any = null;
      try { body = typeof init?.body === "string" ? JSON.parse(init.body) : null; } catch { body = null; }
      const rpc = body?.method;
      const tool = String(body?.params?.name || "");
      const allowed = rpc === "tools/list" || (rpc === "tools/call" && /^(get|list)/i.test(tool));
      if (!allowed) throw new Error(`Analiticas Black Room es solo lectura; llamada bloqueada: ${rpc || method} ${tool}`.trim());
    }
    return inner(input, init);
  };
  return guarded as typeof fetch;
}

async function defaultReadSourceState(): Promise<BlackRoomAnalyticsSourceState> {
  const { readExistingBlackRoomRemoteControl } = await import("../blackroom-remote-control");
  return (await readExistingBlackRoomRemoteControl()) as unknown as BlackRoomAnalyticsSourceState;
}

const defaultCollectMetricool: BlackRoomAnalyticsMetricoolCollector = async (options) => {
  const { collectBlackRoomMetricoolAnalytics } = await import("../blackroom-growth-ceo");
  return collectBlackRoomMetricoolAnalytics({
    env: options.env,
    fetch: options.fetch,
    now: options.now,
    importedSamplesByNetwork: options.importedSamplesByNetwork as never,
  });
};

function coverageFromCommands(commands: unknown): BlackRoomAnalyticsCoverage | null {
  if (!Array.isArray(commands)) return null;
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const command = commands[index] as { type?: unknown; analytics?: any } | null;
    if (!command || command.type !== "ceo_schedule" || !command.analytics || typeof command.analytics !== "object") continue;
    return {
      networkSamples: command.analytics.networkSamples && typeof command.analytics.networkSamples === "object" ? command.analytics.networkSamples : undefined,
      networkErrors: command.analytics.networkErrors && typeof command.analytics.networkErrors === "object" ? command.analytics.networkErrors : undefined,
      checkedAt: typeof command.analytics.lastCheckedAt === "string" ? command.analytics.lastCheckedAt : null,
    };
  }
  return null;
}

function parseWindow(value: unknown): BlackRoomAnalyticsWindow | null {
  if (value === undefined || value === null || value === "") return "weekly";
  if (value === "daily" || value === "diario" || value === "dia") return "daily";
  if (value === "weekly" || value === "semanal" || value === "semana") return "weekly";
  if (value === "monthly" || value === "mensual" || value === "mes") return "monthly";
  return null;
}


const WIDER_WINDOWS: Record<BlackRoomAnalyticsWindow, BlackRoomAnalyticsWindow[]> = { daily: ["weekly", "monthly"], weekly: ["monthly"], monthly: [] };
const STALE_DATA_MS = 3 * 24 * 60 * 60_000;

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(value));
}

function shortDate(iso: string | null | undefined): string | null {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) ? new Date(at).toLocaleDateString("es", { day: "numeric", month: "short", timeZone: "America/New_York" }) : null;
}

/** One readable paragraph for the chat: period, totals per network, best post and how fresh the data is. */
export function friendlyAnalyticsSummary(report: BlackRoomAnalyticsReport, now: Date, liveConnected: boolean): string {
  const parts: string[] = [];
  const label = blackRoomAnalyticsWindowLabel(report.window);
  if (report.requestedWindow) {
    const asked = report.requestedWindow === "daily" ? "En las ultimas 24 horas no hubo publicaciones nuevas" : "En los ultimos 7 dias no hubo publicaciones nuevas";
    const last = shortDate(report.latestPostAt);
    parts.push(`${asked}${last ? ` (la ultima fue el ${last})` : ""}, asi que te muestro los ${label}.`);
  }
  const views = report.totals.current.views;
  parts.push(`${label[0].toUpperCase()}${label.slice(1)}: ${report.totals.current.posts} publicaciones${views !== undefined ? ` y ${compact(views)} vistas` : ""}.`);
  const byNetwork = report.networksWithData
    .map((network) => report.networks[network])
    .filter((entry) => entry.current.posts > 0)
    .sort((a, b) => (b.current.views ?? 0) - (a.current.views ?? 0))
    .map((entry) => `${entry.label} ${compact(entry.current.views ?? 0)} vistas (${entry.current.posts} posts)`);
  if (byNetwork.length) parts.push(`Por red: ${byNetwork.join(" · ")}.`);
  const best = report.networksWithData
    .flatMap((network) => report.networks[network].topPosts.slice(0, 1).map((post) => ({ post, label: report.networks[network].label })))
    .sort((a, b) => b.post.views - a.post.views)[0];
  if (best) parts.push(`Mejor post: ${best.label}, ${compact(best.post.views)} vistas${shortDate(best.post.publishedAt) ? ` (${shortDate(best.post.publishedAt)})` : ""}.`);
  const missing = report.networksMissing.map((network) => report.networks[network].label);
  if (missing.length) parts.push(`Sin datos de: ${missing.join(", ")}.`);
  const asOf = report.dataAsOf ? Date.parse(report.dataAsOf) : Number.NaN;
  if (Number.isFinite(asOf) && now.getTime() - asOf > STALE_DATA_MS) {
    parts.push(`Ojo: estos numeros son de Metricool al ${shortDate(report.dataAsOf)}. ${liveConnected ? "La actualizacion en vivo no trajo datos nuevos." : "Para tenerlos al dia hay que conectar Metricool en vivo (METRICOOL_USER_TOKEN)."}`);
  } else if (shortDate(report.dataAsOf)) {
    parts.push(`Datos de Metricool al ${shortDate(report.dataAsOf)}.`);
  }
  return parts.join(" ");
}

const NETWORK_LABELS: Record<string, string> = { tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube", instagram: "Instagram" };

/** Readable totals from Metricool's live collection: posts tracked, median views, engagement, best hours. */
export function liveTotalsSummary(live: BlackRoomAnalyticsLiveResult): string | null {
  const samples = live.networkSamples ?? {};
  const networks = Object.keys(samples).filter((network) => Number(samples[network]) > 0);
  if (!networks.length) return null;
  const parts = networks
    .sort((a, b) => (live.networkMedianViews?.[b] ?? 0) - (live.networkMedianViews?.[a] ?? 0))
    .map((network) => {
      const bits = [`${samples[network]} posts`];
      const median = live.networkMedianViews?.[network];
      if (Number.isFinite(median)) bits.push(`mediana ${compact(Number(median))} vistas por post`);
      const engagement = live.networkEngagementRate?.[network];
      if (Number.isFinite(engagement)) bits.push(`engagement ${(Number(engagement) * (Number(engagement) <= 1 ? 100 : 1)).toFixed(1)}%`);
      const times = live.recommendedTimesByNetwork?.[network]?.slice(0, 2);
      if (times?.length) bits.push(`mejores horas ${times.join(" y ")}`);
      return `${NETWORK_LABELS[network] ?? network}: ${bits.join(", ")}`;
    });
  const errors = Object.entries(live.networkErrors ?? {}).filter(([network]) => !networks.includes(network)).map(([network]) => NETWORK_LABELS[network] ?? network);
  const when = shortDate(live.lastCheckedAt);
  return `Metricool en vivo${when ? ` (${when})` : ""}: ${parts.join(" · ")}.${errors.length ? ` Sin datos de: ${errors.join(", ")}.` : ""}`;
}

export function createBlackRoomAnalyticsAgent(deps: BlackRoomAnalyticsDeps = {}): BlackRoomTeamAgentModule {
  const readSourceState = deps.readSourceState ?? defaultReadSourceState;
  const collectMetricool = deps.collectMetricool ?? defaultCollectMetricool;

  async function run(ctx: BlackRoomTeamContext, input: Record<string, unknown> = {}): Promise<BlackRoomTeamRunResult> {
    const window = parseWindow(input.window);
    if (!window) return { ok: false, summary: "Ventana no valida: usa \"daily\" o \"weekly\".", error: "invalid_window" };
    const now = ctx.now();
    const state = await loadState(ctx);
    const sourceErrors: string[] = [];

    let source: BlackRoomAnalyticsSourceState = null;
    try {
      source = await readSourceState();
    } catch (error) {
      sourceErrors.push(`No pude leer el estado de Black Room: ${error instanceof Error ? error.message.slice(0, 160) : "sin detalle"}`);
    }
    const samplesByNetwork: Partial<Record<BlackRoomAnalyticsReportNetwork, BlackRoomAnalyticsSample[]>> = {};
    const importedAtByNetwork: Partial<Record<BlackRoomAnalyticsReportNetwork, string | null>> = {};
    for (const network of BLACKROOM_ANALYTICS_NETWORKS) {
      const imported = source?.analyticsImports?.[network];
      samplesByNetwork[network] = normalizeBlackRoomAnalyticsSamples(imported?.samples);
      importedAtByNetwork[network] = typeof imported?.importedAt === "string" ? imported.importedAt : null;
    }
    let coverage = coverageFromCommands(source?.commands);
    let live: BlackRoomAnalyticsLiveResult | null = null;

    if (input.refresh === true) {
      if (!hasToken(ctx.env)) {
        sourceErrors.push("No actualice Metricool en vivo: falta METRICOOL_USER_TOKEN.");
      } else {
        try {
          live = await collectMetricool({
            env: ctx.env as NodeJS.ProcessEnv,
            fetch: createReadOnlyMetricoolFetch(ctx.fetch),
            now,
            importedSamplesByNetwork: samplesByNetwork,
          });
          coverage = { networkSamples: live.networkSamples, networkErrors: live.networkErrors, checkedAt: live.lastCheckedAt ?? now.toISOString() };
        } catch (error) {
          sourceErrors.push(`Metricool en vivo fallo: ${error instanceof Error ? error.message.slice(0, 200) : "sin detalle"}`);
        }
      }
    }

    // A window without any new post says nothing useful ("0 publicaciones"): widen it to the
    // next window that has posts, and say so, unless the caller asked for the exact window.
    let report = buildBlackRoomAnalyticsReport({ window, now, samplesByNetwork, importedAtByNetwork, coverage });
    if (input.autoExpand !== false && report.networksWithData.length && report.totals.current.posts === 0) {
      for (const wider of WIDER_WINDOWS[window]) {
        const candidate = buildBlackRoomAnalyticsReport({ window: wider, now, samplesByNetwork, importedAtByNetwork, coverage });
        if (candidate.totals.current.posts > 0) {
          report = { ...candidate, requestedWindow: window };
          break;
        }
      }
    }
    if (sourceErrors.length) report.limitations.push(...sourceErrors);
    const hasData = report.networksWithData.length > 0;
    const needs = hasData ? [] : [
      hasToken(ctx.env)
        ? "Importar los CSV de Metricool de Black Room desde la Mac (POST /api/blackroom-agent/analytics/import): Metricool no dejo detalle por publicacion."
        : BLACKROOM_ANALYTICS_TOKEN_NEED,
    ];
    const at = now.toISOString();
    const next: BlackRoomAnalyticsAgentState = {
      version: 1,
      lastRunAt: at,
      lastOkAt: hasData ? at : state.lastOkAt,
      lastError: hasData ? null : (sourceErrors[0] ?? "No hay metricas reales de ninguna red."),
      lastNeeds: needs,
      lastReport: hasData ? report : state.lastReport,
      history: [...state.history, {
        at,
        window,
        posts: report.totals.current.posts,
        views: report.totals.current.views ?? null,
        networksWithData: report.networksWithData,
      }].slice(-HISTORY_LIMIT),
    };
    await ctx.state.save(next);

    if (!hasData) {
      // No per-post detail, but Metricool live may still have real totals per network: report those.
      const liveText = live ? liveTotalsSummary(live) : null;
      if (liveText) {
        const latest = await loadState(ctx);
        await ctx.state.save({ ...latest, lastOkAt: at, lastError: null, lastNeeds: [], lastLiveSummary: { at, text: liveText } });
        return {
          ok: true,
          summary: `${liveText} Para ver el detalle por post (mejores y peores, por dia) hacen falta los CSV de Metricool con fecha de publicacion.`,
          report: { ...report, liveTotals: live },
        };
      }
      const why = sourceErrors.length ? ` (${sourceErrors.join(" ")})` : "";
      return {
        ok: false,
        summary: `No tengo metricas reales de tus redes todavia${why}. Falta: ${needs[0]}`,
        report,
        error: "no_data",
      };
    }
    return {
      ok: true,
      summary: friendlyAnalyticsSummary(report, now, hasToken(ctx.env)),
      report,
    };
  }

  async function getStatus(ctx: BlackRoomTeamContext): Promise<BlackRoomTeamStatus> {
    const state = await loadState(ctx);
    const nowMs = ctx.now().getTime();
    const report = state.lastReport;
    const metrics: Record<string, number | string> = {};
    if (report) {
      metrics.ventana = report.window === "daily" ? "diaria" : report.window === "weekly" ? "semanal" : "mensual";
      metrics.publicaciones = report.totals.current.posts;
      if (report.totals.current.views !== undefined) metrics.vistas = report.totals.current.views;
      metrics.redesConDatos = report.networksWithData.length;
      metrics.redesSinDatos = report.networksMissing.length;
    }
    const lastOk = state.lastOkAt ? Date.parse(state.lastOkAt) : Number.NaN;
    const fresh = Number.isFinite(lastOk) && lastOk <= nowMs && nowMs - lastOk <= BLACKROOM_TEAM_WORKING_FRESH_MS;
    const lastRunFailed = Boolean(state.lastRunAt && state.lastRunAt !== state.lastOkAt);

    if (!report && fresh && !lastRunFailed && state.lastLiveSummary) {
      return { id: ID, state: "working", label: "Totales de Metricool al dia", summary: state.lastLiveSummary.text, needs: [], lastRunAt: state.lastOkAt };
    }
    if (report && fresh && !lastRunFailed) {
      const missing = report.networksMissing.map((network) => report.networks[network].label);
      return {
        id: ID,
        state: "working",
        label: "Reporte al dia",
        summary: `Ultimo reporte (${report.windowLabel}): ${report.totals.current.posts} publicaciones en ${report.networksWithData.length} redes.${missing.length ? ` Sin datos: ${missing.join(", ")}.` : ""}`,
        needs: [],
        lastRunAt: state.lastOkAt,
        metrics,
      };
    }
    if (!hasToken(ctx.env) && !report) {
      return {
        id: ID,
        state: "blocked",
        label: "Falta Metricool",
        summary: "Todavia no hay reporte y falta METRICOOL_USER_TOKEN. Si ya importaste los CSV de Metricool, pide el reporte para leerlos.",
        needs: state.lastNeeds.length ? state.lastNeeds : [BLACKROOM_ANALYTICS_TOKEN_NEED],
        lastRunAt: state.lastOkAt,
      };
    }
    if (lastRunFailed && !report) {
      return {
        id: ID,
        state: "blocked",
        label: "Sin datos de redes",
        summary: state.lastError ?? "El ultimo reporte no encontro metricas reales.",
        needs: state.lastNeeds,
        lastRunAt: null,
      };
    }
    return {
      id: ID,
      state: "available",
      label: report ? "Listo para actualizar" : "Listo para el primer reporte",
      summary: report
        ? `Ultimo reporte con datos: ${state.lastOkAt}.${lastRunFailed && state.lastError ? ` El ultimo intento fallo: ${state.lastError}` : ""}`
        : "Metricool configurado; pide el reporte diario o semanal.",
      needs: [],
      lastRunAt: state.lastOkAt,
      ...(report ? { metrics } : {}),
    };
  }

  return {
    id: ID,
    getStatus,
    run,
    actions: {
      "daily-report": (ctx, input) => run(ctx, { ...input, window: "daily" }),
      "weekly-report": (ctx, input) => run(ctx, { ...input, window: "weekly" }),
      "monthly-report": (ctx, input) => run(ctx, { ...input, window: "monthly" }),
      async "last-report"(ctx) {
        const state = await loadState(ctx);
        if (!state.lastReport) return { ok: false, summary: "Todavia no hay un reporte con datos reales.", error: "no_report" };
        return { ok: true, summary: `Ultimo reporte: ${state.lastReport.generatedAt} (${state.lastReport.windowLabel}).`, report: state.lastReport };
      },
      async history(ctx) {
        const state = await loadState(ctx);
        return { ok: true, summary: `${state.history.length} reportes guardados.`, report: state.history };
      },
    },
  };
}

const agent = createBlackRoomAnalyticsAgent();
export default agent;
