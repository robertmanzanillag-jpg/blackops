import { createHash } from "node:crypto";

export type LocalNewsGrowthVariantId = "utility" | "impact";
export type LocalNewsGrowthLanguage = "es" | "en";
export type LocalNewsGrowthScoutPattern = "breaking_alert" | "outcome" | "explainer" | "question" | "community_update" | "other";

export interface LocalNewsGrowthEvent {
  id: string;
  lane: "miami-news" | "ny-news";
  title: string;
  location: string;
  section: "traffic" | "weather" | "breaking" | "public_safety" | "local";
  editorialUrgency: "routine" | "developing" | "breaking";
  lifecycle: "active" | "resolved";
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
  qualityScore?: number;
}

export interface LocalNewsGrowthMetric {
  variantId?: LocalNewsGrowthVariantId | null;
  impressions: number;
  reach?: number;
  videoViews?: number;
  engagements: number;
  clicks: number;
  shares: number;
}

export interface LocalNewsCeoDecision {
  dailyMinimumPosts: 10;
  dailyTargetPosts: 10 | 12 | 14;
  performanceMode: "baseline" | "growing" | "breakout";
  observedImpressions: number;
  observedReach: number;
  observedVideoViews: number;
  observedDistribution: number;
  observedEngagementRate: number;
  preferredFormat: "video_first";
  learningRule: "observed_metrics_only";
}

export interface LocalNewsGrowthPackage {
  zeroCost: true;
  experiment: "deterministic_observed_metrics";
  variantId: LocalNewsGrowthVariantId;
  headline: Record<LocalNewsGrowthLanguage, string>;
  headlineVariants: Record<LocalNewsGrowthVariantId, Record<LocalNewsGrowthLanguage, string>>;
  ownedArticleUrl: string | null;
  hashtags: string[];
  learningSignal: LocalNewsGrowthScoutPattern | null;
  ceoDecision: LocalNewsCeoDecision;
  facebookOptimization: {
    captionStyle: "compact_bilingual";
    sameDayPriority: true;
    originalContextRequired: true;
    maxHashtags: 2;
    targetCaptionCharacters: 1_600;
    qualifiedViewGoal: "watch_time_and_deep_engagement";
  };
  shortForm: {
    ready: true;
    format: "9:16";
    durationSeconds: 8;
    soundRequired: true;
    renderMode: "local_template";
    preferred: true;
    publishableVideoUrl: string | null;
    scenes: Array<{ startSecond: number; endSecond: number; text: string }>;
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function slugPart(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "local-update";
}

export function localNewsArticleSlug(eventId: string, lane: LocalNewsGrowthEvent["lane"]): string {
  const city = lane === "miami-news" ? "miami" : "new-york";
  const stableId = slugPart(eventId).slice(0, 48);
  return `${city}-update-${stableId}-${digest(eventId).slice(0, 8)}`;
}

function safeBaseUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function variantScore(metrics: LocalNewsGrowthMetric[]): { observations: number; score: number } {
  const totals = metrics.reduce((result, metric) => ({
    impressions: result.impressions + metric.impressions,
    videoViews: (result.videoViews || 0) + (metric.videoViews || 0),
    engagements: result.engagements + metric.engagements,
    clicks: result.clicks + metric.clicks,
    shares: result.shares + metric.shares,
  }), { impressions: 0, videoViews: 0, engagements: 0, clicks: 0, shares: 0 });
  const observations = Math.max(totals.impressions, totals.videoViews || 0);
  if (!observations) return { observations: 0, score: 0 };
  return {
    observations,
    score: (totals.clicks + totals.shares * 2 + totals.engagements * 0.25 + Math.min(totals.videoViews || 0, observations) * 0.1) / observations,
  };
}

export function buildLocalNewsCeoDecision(metrics: LocalNewsGrowthMetric[]): LocalNewsCeoDecision {
  const totals = metrics.reduce((result, metric) => ({
    impressions: result.impressions + metric.impressions,
    reach: (result.reach || 0) + (metric.reach || 0),
    videoViews: (result.videoViews || 0) + (metric.videoViews || 0),
    engagements: result.engagements + metric.engagements,
    clicks: result.clicks + metric.clicks,
    shares: result.shares + metric.shares,
  }), { impressions: 0, reach: 0, videoViews: 0, engagements: 0, clicks: 0, shares: 0 });
  const observedDistribution = Math.max(totals.impressions, totals.reach || 0, totals.videoViews || 0);
  const engagementRate = observedDistribution
    ? (totals.engagements + totals.clicks * 2 + totals.shares * 3) / observedDistribution
    : 0;
  const breakout = observedDistribution >= 1_000 && engagementRate >= 0.06;
  const growing = !breakout && observedDistribution >= 500 && engagementRate >= 0.03;
  return {
    dailyMinimumPosts: 10,
    dailyTargetPosts: breakout ? 14 : growing ? 12 : 10,
    performanceMode: breakout ? "breakout" : growing ? "growing" : "baseline",
    observedImpressions: totals.impressions,
    observedReach: totals.reach || 0,
    observedVideoViews: totals.videoViews || 0,
    observedDistribution,
    observedEngagementRate: Math.round(engagementRate * 10_000) / 10_000,
    preferredFormat: "video_first",
    learningRule: "observed_metrics_only",
  };
}

export function selectLocalNewsGrowthVariant(eventId: string, metrics: LocalNewsGrowthMetric[], scoutPattern?: LocalNewsGrowthScoutPattern | null): LocalNewsGrowthVariantId {
  const utility = variantScore(metrics.filter((metric) => metric.variantId === "utility"));
  const impact = variantScore(metrics.filter((metric) => metric.variantId === "impact"));
  if (utility.observations >= 100 && impact.observations >= 100 && utility.score !== impact.score) {
    return utility.score > impact.score ? "utility" : "impact";
  }
  if (scoutPattern === "explainer" || scoutPattern === "question") return "utility";
  if (scoutPattern === "breaking_alert" || scoutPattern === "outcome" || scoutPattern === "community_update") return "impact";
  return Number.parseInt(digest(eventId).slice(0, 2), 16) % 2 === 0 ? "utility" : "impact";
}

function sectionLabel(section: LocalNewsGrowthEvent["section"], language: LocalNewsGrowthLanguage): string {
  const labels = {
    traffic: { es: "Tráfico", en: "Traffic" },
    weather: { es: "Tiempo", en: "Weather" },
    breaking: { es: "Última hora", en: "Breaking" },
    public_safety: { es: "Seguridad pública", en: "Public safety" },
    local: { es: "Noticia local", en: "Local news" },
  } as const;
  return labels[section][language];
}

function headlines(event: LocalNewsGrowthEvent): LocalNewsGrowthPackage["headlineVariants"] {
  const statusEs = event.lifecycle === "resolved" ? "Resuelto" : sectionLabel(event.section, "es");
  const statusEn = event.lifecycle === "resolved" ? "Resolved" : sectionLabel(event.section, "en");
  return {
    utility: {
      es: `${statusEs} en ${event.location}: ${event.title}`,
      en: `${statusEn} in ${event.location}: ${event.title}`,
    },
    impact: {
      es: `Lo que debes saber en ${event.location}: ${event.title}`,
      en: `What to know in ${event.location}: ${event.title}`,
    },
  };
}

function hashtags(event: LocalNewsGrowthEvent): string[] {
  const city = event.lane === "miami-news" ? "#Miami" : "#NewYork";
  const section = {
    traffic: "#Trafico",
    weather: "#Tiempo",
    breaking: "#UltimaHora",
    public_safety: "#SeguridadPublica",
    local: "#NoticiasLocales",
  }[event.section];
  return [city, section];
}

export function buildLocalNewsGrowthPackage(
  event: LocalNewsGrowthEvent,
  metrics: LocalNewsGrowthMetric[],
  publicBaseUrl?: string,
  scoutPattern?: LocalNewsGrowthScoutPattern | null,
): LocalNewsGrowthPackage {
  const headlineVariants = headlines(event);
  const variantId = selectLocalNewsGrowthVariant(event.id, metrics, scoutPattern);
  const baseUrl = safeBaseUrl(publicBaseUrl);
  const ownedArticleUrl = baseUrl
    ? `${baseUrl}/news/article/${encodeURIComponent(localNewsArticleSlug(event.id, event.lane))}?lang=es&utm_source=metricool&utm_medium=organic_social&utm_campaign=local_news&utm_content=${variantId}`
    : null;
  const headline = headlineVariants[variantId];
  return {
    zeroCost: true,
    experiment: "deterministic_observed_metrics",
    variantId,
    headline,
    headlineVariants,
    ownedArticleUrl,
    hashtags: hashtags(event),
    learningSignal: scoutPattern || null,
    ceoDecision: buildLocalNewsCeoDecision(metrics),
    facebookOptimization: {
      captionStyle: "compact_bilingual",
      sameDayPriority: true,
      originalContextRequired: true,
      maxHashtags: 2,
      targetCaptionCharacters: 1_600,
      qualifiedViewGoal: "watch_time_and_deep_engagement",
    },
    shortForm: {
      ready: true,
      format: "9:16",
      durationSeconds: 8,
      soundRequired: true,
      renderMode: "local_template",
      preferred: true,
      publishableVideoUrl: event.mediaType === "video" ? event.mediaUrl || null : null,
      scenes: [
        { startSecond: 0, endSecond: 2, text: sectionLabel(event.section, "es").toUpperCase() },
        { startSecond: 2, endSecond: 6, text: headline.es },
        { startSecond: 6, endSecond: 8, text: "Detalles y fuente oficial en Metro Current" },
      ],
    },
  };
}

export const __localNewsGrowthInternals = { safeBaseUrl, variantScore, headlines, hashtags };
