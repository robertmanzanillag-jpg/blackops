// Deterministic social-media report for the "Analiticas Black Room" agent.
// Pure: no fs, no fetch, no LLM. Input is the per-post samples Black Room already collects
// (Metricool CSV bridge stored in the remote-control state) plus the latest network-level
// coverage from the CEO's Metricool collection. Only metrics that were actually collected
// are reported; a network without data is labeled "missing", never filled with zeros.

export const BLACKROOM_ANALYTICS_TIMEZONE = "America/New_York";
export const BLACKROOM_ANALYTICS_NETWORKS = ["tiktok", "facebook", "youtube", "instagram"] as const;
export type BlackRoomAnalyticsReportNetwork = (typeof BLACKROOM_ANALYTICS_NETWORKS)[number];
export type BlackRoomAnalyticsWindow = "daily" | "weekly" | "monthly";

export const BLACKROOM_ANALYTICS_NETWORK_LABELS: Record<BlackRoomAnalyticsReportNetwork, string> = {
  tiktok: "TikTok",
  facebook: "Facebook",
  youtube: "YouTube",
  instagram: "Instagram",
};

/** Metrics summed per period. Rates are averaged separately. */
export const BLACKROOM_ANALYTICS_SUM_METRICS = ["views", "likes", "comments", "shares", "reach", "impressions"] as const;
export type BlackRoomAnalyticsSumMetric = (typeof BLACKROOM_ANALYTICS_SUM_METRICS)[number];

const METRIC_LABELS: Record<BlackRoomAnalyticsSumMetric | "posts", string> = {
  posts: "publicaciones",
  views: "vistas",
  likes: "likes",
  comments: "comentarios",
  shares: "compartidos",
  reach: "alcance",
  impressions: "impresiones",
};

const WINDOW_MS: Record<BlackRoomAnalyticsWindow, number> = { daily: 24 * 60 * 60_000, weekly: 7 * 24 * 60 * 60_000, monthly: 30 * 24 * 60 * 60_000 };
const PATTERN_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
const MIN_BUCKET_SAMPLES = 2;
const LOW_VIEW_THRESHOLD = 10;

export type BlackRoomAnalyticsSample = {
  id: string;
  views: number;
  publishedAt?: string;
  durationSeconds?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reach?: number;
  impressions?: number;
  engagementRate?: number;
  completionRate?: number;
  averageWatchSeconds?: number;
};

export type BlackRoomAnalyticsCoverage = {
  /** Total posts Metricool reported per network in the CEO's last collection. */
  networkSamples?: Record<string, number>;
  networkErrors?: Record<string, string>;
  checkedAt?: string | null;
};

export type BlackRoomAnalyticsInput = {
  window: BlackRoomAnalyticsWindow;
  now: Date;
  samplesByNetwork: Partial<Record<BlackRoomAnalyticsReportNetwork, BlackRoomAnalyticsSample[]>>;
  importedAtByNetwork?: Partial<Record<BlackRoomAnalyticsReportNetwork, string | null>>;
  coverage?: BlackRoomAnalyticsCoverage | null;
};

export type BlackRoomAnalyticsTotals = { posts: number } & Partial<Record<BlackRoomAnalyticsSumMetric, number>> & { engagementRate?: number };

export type BlackRoomAnalyticsDelta = { current: number; previous: number; change: number; changePct: number | null };

export type BlackRoomAnalyticsPost = {
  id: string;
  views: number;
  publishedAt: string;
  durationSeconds?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  engagementRate?: number;
};

export type BlackRoomAnalyticsBucket = { label: string; samples: number; medianViews: number };

export type BlackRoomAnalyticsNetworkReport = {
  network: BlackRoomAnalyticsReportNetwork;
  label: string;
  status: "ok" | "sin-publicaciones" | "missing";
  missingReason?: string;
  /** Metrics with at least one real value in the compared periods. */
  metricsCollected: string[];
  /** Metrics that the source did not provide for this network. */
  metricsMissing: string[];
  current: BlackRoomAnalyticsTotals;
  previous: BlackRoomAnalyticsTotals;
  deltas: Record<string, BlackRoomAnalyticsDelta>;
  topPosts: BlackRoomAnalyticsPost[];
  bottomPosts: BlackRoomAnalyticsPost[];
  bestHours: BlackRoomAnalyticsBucket[];
  bestDurations: BlackRoomAnalyticsBucket[];
  lowViewPosts: number;
  undatedSamples: number;
  totalSamples: number;
  importedAt: string | null;
  metricoolPostsSeen?: number;
  metricoolError?: string;
};

export type BlackRoomAnalyticsReport = {
  window: BlackRoomAnalyticsWindow;
  windowLabel: string;
  generatedAt: string;
  timezone: string;
  period: { start: string; end: string };
  previousPeriod: { start: string; end: string };
  networks: Record<BlackRoomAnalyticsReportNetwork, BlackRoomAnalyticsNetworkReport>;
  networksWithData: BlackRoomAnalyticsReportNetwork[];
  networksMissing: BlackRoomAnalyticsReportNetwork[];
  totals: { current: BlackRoomAnalyticsTotals; previous: BlackRoomAnalyticsTotals; deltas: Record<string, BlackRoomAnalyticsDelta> };
  recommendations: string[];
  limitations: string[];
  /** Spanish plain-text report "como estuvo todo", ready to read in the office or chat. */
  text: string;
  /** Newest import/check time the numbers come from (null when unknown). */
  dataAsOf?: string | null;
  /** Latest publication date seen in any network (null when no dated post). */
  latestPostAt?: string | null;
  /** Set when the requested window had no posts and the report widened it. */
  requestedWindow?: BlackRoomAnalyticsWindow;
};

function finiteNonNegative(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

/** Normalizes untrusted stored samples; drops anything without an id and a real view count. */
export function normalizeBlackRoomAnalyticsSamples(value: unknown): BlackRoomAnalyticsSample[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: BlackRoomAnalyticsSample[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim().slice(0, 300) : "";
    const views = finiteNonNegative(record.views);
    if (!id || views === undefined || seen.has(id)) continue;
    seen.add(id);
    const sample: BlackRoomAnalyticsSample = { id, views: Math.floor(views) };
    if (typeof record.publishedAt === "string" && Number.isFinite(Date.parse(record.publishedAt))) sample.publishedAt = record.publishedAt;
    const duration = finiteNonNegative(record.durationSeconds);
    if (duration !== undefined && duration > 0 && duration <= 86_400) sample.durationSeconds = Math.round(duration);
    for (const key of ["likes", "comments", "shares", "reach", "impressions", "averageWatchSeconds"] as const) {
      const metric = finiteNonNegative(record[key]);
      if (metric !== undefined) sample[key] = metric;
    }
    for (const key of ["engagementRate", "completionRate"] as const) {
      const metric = finiteNonNegative(record[key]);
      if (metric !== undefined && metric <= 1) sample[key] = metric;
    }
    output.push(sample);
  }
  return output;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function totalsFor(samples: BlackRoomAnalyticsSample[], collected: Set<string>): BlackRoomAnalyticsTotals {
  const totals: BlackRoomAnalyticsTotals = { posts: samples.length };
  for (const metric of BLACKROOM_ANALYTICS_SUM_METRICS) {
    if (!collected.has(metric)) continue;
    totals[metric] = samples.reduce((sum, sample) => sum + (sample[metric] ?? 0), 0);
  }
  if (collected.has("engagementRate")) {
    const rates = samples.map((sample) => sample.engagementRate).filter((rate): rate is number => rate !== undefined);
    if (rates.length) totals.engagementRate = round(rates.reduce((a, b) => a + b, 0) / rates.length, 4);
  }
  return totals;
}

function deltaFor(current: number, previous: number): BlackRoomAnalyticsDelta {
  return {
    current,
    previous,
    change: round(current - previous, 4),
    changePct: previous > 0 ? round(((current - previous) / previous) * 100, 1) : null,
  };
}

function deltasFor(current: BlackRoomAnalyticsTotals, previous: BlackRoomAnalyticsTotals): Record<string, BlackRoomAnalyticsDelta> {
  const deltas: Record<string, BlackRoomAnalyticsDelta> = { posts: deltaFor(current.posts, previous.posts) };
  for (const key of [...BLACKROOM_ANALYTICS_SUM_METRICS, "engagementRate"] as const) {
    const a = current[key];
    const b = previous[key];
    if (a !== undefined && b !== undefined) deltas[key] = deltaFor(a, b);
  }
  return deltas;
}

function localHour(date: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: BLACKROOM_ANALYTICS_TIMEZONE, hour: "2-digit", hourCycle: "h23" }).format(date);
  return Number(hour) % 24;
}

export function blackRoomDurationBucket(seconds: number): string {
  if (seconds <= 15) return "hasta 15s";
  if (seconds <= 30) return "16-30s";
  if (seconds <= 60) return "31-60s";
  if (seconds <= 180) return "1-3 min";
  return "mas de 3 min";
}

function rankBuckets(groups: Map<string, number[]>): BlackRoomAnalyticsBucket[] {
  return [...groups]
    .filter(([, views]) => views.length >= MIN_BUCKET_SAMPLES)
    .map(([label, views]) => ({ label, samples: views.length, medianViews: median(views) }))
    .sort((a, b) => b.medianViews - a.medianViews || b.samples - a.samples || a.label.localeCompare(b.label))
    .slice(0, 3);
}

function toPost(sample: BlackRoomAnalyticsSample): BlackRoomAnalyticsPost {
  const post: BlackRoomAnalyticsPost = { id: sample.id, views: sample.views, publishedAt: sample.publishedAt as string };
  if (sample.durationSeconds !== undefined) post.durationSeconds = sample.durationSeconds;
  if (sample.likes !== undefined) post.likes = sample.likes;
  if (sample.comments !== undefined) post.comments = sample.comments;
  if (sample.shares !== undefined) post.shares = sample.shares;
  if (sample.engagementRate !== undefined) post.engagementRate = sample.engagementRate;
  return post;
}

function emptyNetwork(network: BlackRoomAnalyticsReportNetwork, reason: string, importedAt: string | null): BlackRoomAnalyticsNetworkReport {
  return {
    network,
    label: BLACKROOM_ANALYTICS_NETWORK_LABELS[network],
    status: "missing",
    missingReason: reason,
    metricsCollected: [],
    metricsMissing: [...BLACKROOM_ANALYTICS_SUM_METRICS],
    current: { posts: 0 },
    previous: { posts: 0 },
    deltas: {},
    topPosts: [],
    bottomPosts: [],
    bestHours: [],
    bestDurations: [],
    lowViewPosts: 0,
    undatedSamples: 0,
    totalSamples: 0,
    importedAt,
  };
}

function buildNetworkReport(
  network: BlackRoomAnalyticsReportNetwork,
  samples: BlackRoomAnalyticsSample[],
  input: BlackRoomAnalyticsInput,
  periodStart: number,
  periodEnd: number,
  previousStart: number,
): BlackRoomAnalyticsNetworkReport {
  const importedAt = input.importedAtByNetwork?.[network] ?? null;
  const metricoolPostsSeen = finiteNonNegative(input.coverage?.networkSamples?.[network]);
  const metricoolError = input.coverage?.networkErrors?.[network]?.slice(0, 240);
  const withCoverage = (report: BlackRoomAnalyticsNetworkReport) => {
    if (metricoolPostsSeen !== undefined) report.metricoolPostsSeen = metricoolPostsSeen;
    if (metricoolError) report.metricoolError = metricoolError;
    return report;
  };
  if (!samples.length) {
    const reason = network === "instagram"
      ? "Instagram no esta conectado a la coleccion de Metricool de Black Room (solo TikTok, Facebook y YouTube)."
      : metricoolPostsSeen
        ? `Metricool vio ${metricoolPostsSeen} publicaciones, pero no hay detalle por publicacion: falta importar el CSV de Metricool de ${BLACKROOM_ANALYTICS_NETWORK_LABELS[network]}.`
        : `No hay metricas de ${BLACKROOM_ANALYTICS_NETWORK_LABELS[network]}: falta importar el CSV de Metricool o conectar la red en Metricool.`;
    return withCoverage(emptyNetwork(network, reason, importedAt));
  }
  const dated = samples.filter((sample) => sample.publishedAt && Date.parse(sample.publishedAt) <= periodEnd);
  const undatedSamples = samples.filter((sample) => !sample.publishedAt).length;
  const inRange = (sample: BlackRoomAnalyticsSample, start: number, end: number) => {
    const time = Date.parse(sample.publishedAt as string);
    return time >= start && time < end;
  };
  const current = dated.filter((sample) => inRange(sample, periodStart, periodEnd));
  const previous = dated.filter((sample) => inRange(sample, previousStart, periodStart));
  const compared = [...current, ...previous];
  const collected = new Set<string>(["views"]);
  for (const sample of compared) {
    for (const key of [...BLACKROOM_ANALYTICS_SUM_METRICS, "engagementRate"] as const) if (sample[key] !== undefined) collected.add(key);
  }
  const currentTotals = totalsFor(current, collected);
  const previousTotals = totalsFor(previous, collected);
  const ranked = [...current].sort((a, b) => b.views - a.views || a.id.localeCompare(b.id));
  const topPosts = ranked.slice(0, 3).map(toPost);
  const topIds = new Set(topPosts.map((post) => post.id));
  const bottomPosts = ranked.slice().reverse().filter((sample) => !topIds.has(sample.id)).slice(0, 3).map(toPost);
  const lookback = dated.filter((sample) => inRange(sample, periodEnd - PATTERN_LOOKBACK_MS, periodEnd));
  const byHour = new Map<string, number[]>();
  const byDuration = new Map<string, number[]>();
  for (const sample of lookback) {
    const hourLabel = `${String(localHour(new Date(sample.publishedAt as string))).padStart(2, "0")}:00`;
    (byHour.get(hourLabel) ?? byHour.set(hourLabel, []).get(hourLabel)!).push(sample.views);
    if (sample.durationSeconds !== undefined) {
      const bucket = blackRoomDurationBucket(sample.durationSeconds);
      (byDuration.get(bucket) ?? byDuration.set(bucket, []).get(bucket)!).push(sample.views);
    }
  }
  return withCoverage({
    network,
    label: BLACKROOM_ANALYTICS_NETWORK_LABELS[network],
    status: current.length ? "ok" : "sin-publicaciones",
    metricsCollected: [...collected],
    metricsMissing: BLACKROOM_ANALYTICS_SUM_METRICS.filter((metric) => !collected.has(metric)),
    current: currentTotals,
    previous: previousTotals,
    deltas: deltasFor(currentTotals, previousTotals),
    topPosts,
    bottomPosts,
    bestHours: rankBuckets(byHour),
    bestDurations: rankBuckets(byDuration),
    lowViewPosts: current.filter((sample) => sample.views <= LOW_VIEW_THRESHOLD).length,
    undatedSamples,
    totalSamples: samples.length,
    importedAt,
  });
}

function sumTotals(reports: BlackRoomAnalyticsNetworkReport[], side: "current" | "previous"): BlackRoomAnalyticsTotals {
  const totals: BlackRoomAnalyticsTotals = { posts: 0 };
  for (const report of reports) {
    totals.posts += report[side].posts;
    for (const metric of BLACKROOM_ANALYTICS_SUM_METRICS) {
      const value = report[side][metric];
      if (value !== undefined) totals[metric] = (totals[metric] ?? 0) + value;
    }
  }
  return totals;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-US", { maximumFractionDigits: 1 }).format(value);
}

function formatDelta(delta: BlackRoomAnalyticsDelta | undefined): string {
  if (!delta) return "";
  if (delta.changePct === null) return delta.previous === 0 && delta.current > 0 ? " (nuevo vs 0 antes)" : " (sin cambio)";
  const sign = delta.changePct > 0 ? "+" : "";
  return ` (${sign}${formatNumber(delta.changePct)}% vs periodo anterior)`;
}

/** 3-5 concrete, data-backed recommendations. Fallbacks are about getting data, never invented insights. */
export function buildBlackRoomAnalyticsRecommendations(reports: BlackRoomAnalyticsNetworkReport[], window: BlackRoomAnalyticsWindow): string[] {
  const recommendations: string[] = [];
  const periodName = window === "daily" ? "ayer" : window === "weekly" ? "la semana anterior" : "el mes anterior";
  const withData = reports.filter((report) => report.status !== "missing");
  const drops = withData
    .filter((report) => (report.deltas.views?.changePct ?? 0) <= -20)
    .sort((a, b) => (a.deltas.views!.changePct! - b.deltas.views!.changePct!));
  for (const report of drops.slice(0, 1)) {
    const top = report.topPosts[0];
    recommendations.push(`${report.label}: las vistas bajaron ${formatNumber(Math.abs(report.deltas.views!.changePct!))}% frente a ${periodName}. Revisa el gancho de los primeros 3 segundos${top ? ` y repite el estilo del mejor post (${top.id}, ${formatNumber(top.views)} vistas)` : ""}.`);
  }
  const growth = withData
    .filter((report) => (report.deltas.views?.changePct ?? 0) >= 20 && report.topPosts.length)
    .sort((a, b) => (b.deltas.views!.changePct! - a.deltas.views!.changePct!));
  for (const report of growth.slice(0, 1)) {
    recommendations.push(`${report.label}: las vistas subieron ${formatNumber(report.deltas.views!.changePct!)}%. Haz 2-3 variaciones del mejor post (${report.topPosts[0].id}, ${formatNumber(report.topPosts[0].views)} vistas) esta semana.`);
  }
  const cadenceDrop = withData.find((report) => report.previous.posts >= 2 && report.current.posts < report.previous.posts * 0.6);
  if (cadenceDrop) {
    recommendations.push(`${cadenceDrop.label}: publicaste ${cadenceDrop.current.posts} veces vs ${cadenceDrop.previous.posts} en ${periodName}. Recupera la cadencia antes de cambiar el contenido.`);
  }
  const hourWinner = withData.filter((report) => report.bestHours.length).sort((a, b) => b.bestHours[0].medianViews - a.bestHours[0].medianViews)[0];
  if (hourWinner) {
    const best = hourWinner.bestHours[0];
    recommendations.push(`${hourWinner.label}: publica cerca de las ${best.label} (hora de Nueva York); en los ultimos 30 dias esa hora tiene la mediana mas alta (${formatNumber(best.medianViews)} vistas en ${best.samples} posts).`);
  }
  const durationWinner = withData.filter((report) => report.bestDurations.length).sort((a, b) => b.bestDurations[0].medianViews - a.bestDurations[0].medianViews)[0];
  if (durationWinner) {
    const best = durationWinner.bestDurations[0];
    recommendations.push(`${durationWinner.label}: los videos de ${best.label} rinden mejor (mediana ${formatNumber(best.medianViews)} vistas en ${best.samples} posts). Prioriza esa duracion en los proximos cortes.`);
  }
  const lowViews = withData.filter((report) => report.lowViewPosts >= 2).sort((a, b) => b.lowViewPosts - a.lowViewPosts)[0];
  if (lowViews && recommendations.length < 5) {
    recommendations.push(`${lowViews.label}: ${lowViews.lowViewPosts} posts del periodo quedaron con ${LOW_VIEW_THRESHOLD} vistas o menos. Revisa titulo, portada y si la red los esta limitando.`);
  }
  const silent = withData.find((report) => report.status === "sin-publicaciones");
  if (silent && recommendations.length < 5) {
    recommendations.push(`${silent.label}: no hubo publicaciones en el periodo. Programa al menos un post (con aprobacion) para no perder alcance.`);
  }
  const missing = reports.filter((report) => report.status === "missing" && report.network !== "instagram");
  if (missing.length && recommendations.length < 5) {
    recommendations.push(`Importa el CSV de Metricool de ${missing.map((report) => report.label).join(", ")} para poder medir esas redes; hoy no hay datos reales.`);
  }
  if (recommendations.length < 3 && reports.some((report) => report.network === "instagram" && report.status === "missing")) {
    recommendations.push("Si Black Room publica en Instagram, conectalo en Metricool para incluirlo en el reporte.");
  }
  const undated = withData.find((report) => report.undatedSamples > 0);
  if (recommendations.length < 3 && undated) {
    recommendations.push(`${undated.label}: ${undated.undatedSamples} publicaciones no traen fecha en el CSV; exporta el CSV con la columna de fecha para compararlas por periodo.`);
  }
  if (recommendations.length < 3) {
    recommendations.push("Junta al menos 2 publicaciones por hora y por duracion para que el reporte pueda recomendar horarios y duraciones con evidencia.");
  }
  if (recommendations.length < 3) {
    recommendations.push("Vuelve a pedir el reporte despues de la proxima importacion de Metricool para comparar contra este periodo.");
  }
  return recommendations.slice(0, 5);
}

export function blackRoomAnalyticsWindowLabel(window: BlackRoomAnalyticsWindow): string {
  return window === "daily" ? "ultimas 24 horas" : window === "weekly" ? "ultimos 7 dias" : "ultimos 30 dias";
}

/** Newest moment the data reflects: latest import / Metricool check (cumulative views are as of then). */
export function blackRoomAnalyticsDataAsOf(input: Pick<BlackRoomAnalyticsInput, "importedAtByNetwork" | "coverage">): string | null {
  const stamps = [...Object.values(input.importedAtByNetwork ?? {}), input.coverage?.checkedAt ?? null]
    .map((value) => (typeof value === "string" ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  return stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
}

export function buildBlackRoomAnalyticsReport(input: BlackRoomAnalyticsInput): BlackRoomAnalyticsReport {
  const periodEnd = input.now.getTime();
  const span = WINDOW_MS[input.window];
  const periodStart = periodEnd - span;
  const previousStart = periodStart - span;
  const networkReports = BLACKROOM_ANALYTICS_NETWORKS.map((network) => buildNetworkReport(
    network,
    normalizeBlackRoomAnalyticsSamples(input.samplesByNetwork[network] ?? []),
    input,
    periodStart,
    periodEnd,
    previousStart,
  ));
  const networks = Object.fromEntries(networkReports.map((report) => [report.network, report])) as BlackRoomAnalyticsReport["networks"];
  const withData = networkReports.filter((report) => report.status !== "missing");
  const current = sumTotals(withData, "current");
  const previous = sumTotals(withData, "previous");
  const recommendations = buildBlackRoomAnalyticsRecommendations(networkReports, input.window);
  const windowLabel = blackRoomAnalyticsWindowLabel(input.window);
  const limitations = [
    "Metricool y el CSV dan el valor acumulado mas reciente de cada post: los posts del periodo anterior tuvieron mas tiempo para sumar vistas.",
    "Las publicaciones se asignan al periodo por su fecha de publicacion.",
  ];
  if (networkReports.some((report) => report.undatedSamples > 0)) limitations.push("Las publicaciones sin fecha no entran en la comparacion por periodo.");
  if (input.coverage?.checkedAt) limitations.push(`Cobertura de Metricool tomada de la ultima revision del CEO (${input.coverage.checkedAt}).`);

  const lines: string[] = [];
  lines.push(`Reporte de redes de Black Room - ${windowLabel} (hora de Nueva York).`);
  if (!withData.length) {
    lines.push("No hay metricas reales de ninguna red para este reporte.");
  } else {
    const totalViews = current.views ?? 0;
    lines.push(`En total: ${current.posts} publicaciones y ${formatNumber(totalViews)} vistas${formatDelta(deltasFor(current, previous).views)}.`);
  }
  for (const report of networkReports) {
    if (report.status === "missing") {
      lines.push(`- ${report.label}: sin datos. ${report.missingReason}`);
      continue;
    }
    const parts = [`${report.current.posts} ${METRIC_LABELS.posts}${formatDelta(report.deltas.posts)}`];
    for (const metric of BLACKROOM_ANALYTICS_SUM_METRICS) {
      const value = report.current[metric];
      if (value !== undefined) parts.push(`${formatNumber(value)} ${METRIC_LABELS[metric]}${formatDelta(report.deltas[metric])}`);
    }
    lines.push(`- ${report.label}: ${parts.join(", ")}.`);
    if (report.topPosts[0]) lines.push(`  Mejor post: ${report.topPosts[0].id} con ${formatNumber(report.topPosts[0].views)} vistas.`);
    if (report.bottomPosts[0]) lines.push(`  Post mas flojo: ${report.bottomPosts[0].id} con ${formatNumber(report.bottomPosts[0].views)} vistas.`);
    if (report.bestHours[0]) lines.push(`  Mejor hora (30 dias): ${report.bestHours.map((bucket) => `${bucket.label} (${formatNumber(bucket.medianViews)})`).join(", ")}.`);
    if (report.bestDurations[0]) lines.push(`  Mejor duracion (30 dias): ${report.bestDurations.map((bucket) => `${bucket.label} (${formatNumber(bucket.medianViews)})`).join(", ")}.`);
    if (report.metricsMissing.length) lines.push(`  No medido por la fuente: ${report.metricsMissing.map((metric) => METRIC_LABELS[metric as BlackRoomAnalyticsSumMetric] ?? metric).join(", ")}.`);
  }
  lines.push("Recomendaciones:");
  recommendations.forEach((recommendation, index) => lines.push(`${index + 1}. ${recommendation}`));

  return {
    window: input.window,
    windowLabel,
    generatedAt: input.now.toISOString(),
    timezone: BLACKROOM_ANALYTICS_TIMEZONE,
    period: { start: new Date(periodStart).toISOString(), end: new Date(periodEnd).toISOString() },
    previousPeriod: { start: new Date(previousStart).toISOString(), end: new Date(periodStart).toISOString() },
    networks,
    networksWithData: withData.map((report) => report.network),
    networksMissing: networkReports.filter((report) => report.status === "missing").map((report) => report.network),
    totals: { current, previous, deltas: deltasFor(current, previous) },
    recommendations,
    limitations,
    text: lines.join("\n"),
    dataAsOf: blackRoomAnalyticsDataAsOf(input),
    latestPostAt: latestPublishedAt(input),
  };
}

function latestPublishedAt(input: BlackRoomAnalyticsInput): string | null {
  let latest = Number.NaN;
  for (const network of BLACKROOM_ANALYTICS_NETWORKS) {
    for (const sample of normalizeBlackRoomAnalyticsSamples(input.samplesByNetwork[network] ?? [])) {
      const at = sample.publishedAt ? Date.parse(sample.publishedAt) : Number.NaN;
      if (Number.isFinite(at) && at <= input.now.getTime() && !(at <= latest)) latest = at;
    }
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}
